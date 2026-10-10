#!/usr/bin/env node
/**
 * v6.519 守衛：官方 Q&A 比對第一批（站長 2026-10-10：「請你上網查詢比對一下官方的判例 卡牌規則等等內容 有沒有和我們網站系統不符的地方」）。
 *   來源：台灣官方 Q&A 資料庫 asia.pokemon-card.com/tw/rules/search（標準賽制，2026-10-10 全量 1127 條），
 *   扣掉站內規則書已收錄與 V 系後的 115 條（深淵之瞳 70＋綠寶石風暴 45）逐條實跑，不符者在這裡修。
 *
 * 【A】胖嘟嘟｜深海抽出：牌庫 0 張時不可以使用（不在可用清單、USE_ABILITY 不吃次數）；牌庫 1 張可以
 * 【B】雷電獸｜音波刀鋒「不計算對手的戰鬥寶可夢身上的附加效果」：撲身頭擊的「受傷 +100」不算 ⇒ 110；
 *      對照：閃光屏障（沒有這段字）照樣 +100
 * 【C】攻擊方不受對手特性效果影響（化隱／光之翼）時，「對手的戰鬥寶可夢使用的招式的傷害 -N」不生效：
 *      詛咒娃娃（化隱）、超級皮可西ex（光之翼）打火炎獅不 -30；對照：沒有化隱的攻擊方照 -30、
 *      化隱打蒂安希ex（鑽石膜：作用在持有者自己）照 -30
 * 【D】鐵掌力士｜大力捕捉器：可以選化隱的備戰寶可夢，但不會互換；選一般寶可夢照常互換
 * 【H】HEAD-FAIL：同樣的盤面餵 v6.518 的引擎逐條紅
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.518。
const BASE_SHA = '67085dc8';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ── 卡池（官方卡面）──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => { for (const c of pool.values()) if (c.name === n) return String(c.id); return null; };
const withAbility = (cardName, abName) => { for (const c of pool.values()) if (c.name === cardName && (c.abilities || []).some((a) => a.name === abName)) return String(c.id); return null; };
const ID = {
  W: byName('基本【水】能量'), L: byName('基本【雷】能量'), D: byName('基本【惡】能量'), M: byName('基本【鋼】能量'), P: byName('基本【超】能量'),
  dorado: withAbility('胖嘟嘟', '深海抽出'), raikou: '19167', mastiff: '19200', tank: '19207', filler: '19178',
  doll: withAbility('詛咒娃娃', '化隱'), litleo: withAbility('火炎獅', '威嚇之牙'), diancie: '14110',
  fairy: withAbility('超級皮可西ex', '光之翼'), hariyama: withAbility('鐵掌力士', '大力捕捉器'), makuhita: null,
  sinistea: withAbility('斯魔茶', '化隱'),
};
for (const c of pool.values()) if (c.name === '幕下力士') { ID.makuhita = String(c.id); break; }
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

// ── 打包引擎（HEAD 或 BASE 的 src 樹）──
async function loadEngine(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6519-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, `export { applyAction, createGame, getUsableAbilities } from '${join(srcRoot, 'src/lib/game/engine').replace(/\\/g, '/')}';\nimport '${join(srcRoot, 'src/lib/game/effects').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const en = (t, k) => Array.from({ length: k }, () => inst(ID[t]));
  const mk = ({ a0, b0 = [], a1, b1 = [], hand0 = [], deck0 }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: hand0, deck: deck0 ?? en('W', 10), discard: [], prizes: en('W', 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: en('W', 10), discard: [], prizes: en('W', 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const resolveFirst = (s, pick) => {
    let g = 0;
    while (s.pendingSelection && g++ < 4) {
      const ps = s.pendingSelection;
      const sel = ps.type === 'modal-choice' ? ['yes'] : (pick ? pick(ps) : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0)));
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.playerIdx ?? ps.actorIdx ?? 0, pendingToken: ps.token });
    }
    return s;
  };
  const out = {};
  try {
    // A 深海抽出
    for (const k of [0, 1]) {
      const dr = inst(ID.dorado);
      const s = mk({ a0: dr, a1: inst(ID.filler), hand0: [inst(ID.W)], deck0: en('W', k) });
      const u = M.getUsableAbilities(s, pool) || [];
      const listed = JSON.stringify(u).includes(dr.iid);
      const s2 = act(s, { type: 'USE_ABILITY', iid: dr.iid, abilityIndex: 0 });
      out['A' + k] = { listed, consumed: s2 !== s && !!(s2.players[0].active?.abilityUsedThisTurn || (s2.players[0].abilityNamesUsedThisTurn || []).includes?.('深海抽出')) };
    }
  } catch (e) { out.Aerr = e.message; }
  try {
    // B 音波刀鋒：獒教父真的用撲身頭擊（帶旗標），換回合後雷電獸攻擊
    const afterHeadbutt = (atkIdx) => {
      let s = mk({ a0: inst(ID.tank, { energyAttached: en('M', 1) }), b0: [inst(ID.filler)], a1: inst(ID.mastiff, { energyAttached: en('D', 3) }), b1: [inst(ID.filler)] });
      s = { ...s, activePlayerIndex: 1 };
      s = act(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 1 });
      s = resolveFirst(s);
      if (s.turnPhase !== 'main' || s.activePlayerIndex !== 0) { s = act(s, { type: 'END_TURN' }); if (s.turnPhase === 'draw') s = act(s, { type: 'DRAW_CARD' }); }
      s = { ...s, players: [{ ...s.players[0], active: inst(ID.raikou, { energyAttached: en('L', 3) }) }, s.players[1]] };
      const t = resolveFirst(act(s, { type: 'ATTACK', attackIndex: atkIdx }));
      const m = t.players[1].active;
      return { dmg: m && m.cardId === ID.mastiff ? m.damage : 'KO' };
    };
    out.B = afterHeadbutt(1); out.Bctl = afterHeadbutt(0);
  } catch (e) { out.Berr = e.message; }
  try {
    // C 化隱／光之翼 對 威嚇之牙
    const doll = (opp) => {
      const s = mk({ a0: inst(ID.doll, { energyAttached: en('P', 1) }), a1: opp, deck0: [inst(ID.W), inst(ID.W), inst(ID.W)] });
      const t = resolveFirst(act(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0, discardedEnergyIids: [] }), (ps) => (ps.params?.validIids ?? []).slice(0, ps.minCount || 0));
      return t.players[1].active?.damage ?? 'KO';
    };
    out.C1 = doll(inst(ID.litleo));
    out.C3 = doll(inst(ID.diancie));
    const fc = pool.get(ID.fairy); const ai = fc.attacks.findIndex((a) => a.name === '射攻月亮');
    const s = mk({ a0: inst(ID.fairy, { energyAttached: fc.attacks[ai].cost.map((t) => inst(t === 'Psychic' ? ID.P : ID.W)) }), a1: inst(ID.litleo, { damage: 0 }) });
    const t = resolveFirst(act(s, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }));
    out.C2 = { dmg: t.players[1].active?.damage ?? 'KO', base: Number(String(fc.attacks[ai].damage).replace(/\D/g, '')) || 0 };
    // 對照：沒有化隱的攻擊方（雷電獸 閃光屏障 50）打火炎獅 ⇒ -30
    const s4 = mk({ a0: inst(ID.raikou, { energyAttached: en('L', 3) }), a1: inst(ID.litleo) });
    out.C4 = resolveFirst(act(s4, { type: 'ATTACK', attackIndex: 0 })).players[1].active?.damage ?? 'KO';
  } catch (e) { out.Cerr = e.message; }
  try {
    // D 大力捕捉器
    const run = (pickImmune) => {
      const base = inst(ID.makuhita), evo = inst(ID.hariyama), smt = inst(ID.sinistea), oth = inst(ID.filler);
      let s = mk({ a0: base, hand0: [evo], a1: inst(ID.filler), b1: [smt, oth] });
      s = act(s, { type: 'EVOLVE', fromIid: base.iid, toIid: evo.iid });
      let listed = null;
      s = resolveFirst(s, (ps) => { listed = (ps.params?.validIids ?? []).includes(smt.iid); return [pickImmune ? smt.iid : oth.iid]; });
      return { listed, active: s.players[1].active?.iid, smt: smt.iid, oth: oth.iid };
    };
    out.D1 = run(true); out.D2 = run(false);
  } catch (e) { out.Derr = e.message; }
  return out;
}

const judge = (r) => ({
  A: !!r.A0 && !!r.A1 && r.A0.listed === false && r.A0.consumed === false && r.A1.listed === true,
  B: !!r.B && r.B.dmg === 110 && r.Bctl && r.Bctl.dmg === 'KO',
  C: r.C1 === 80 && !!r.C2 && r.C2.dmg === r.C2.base && r.C3 === 50 && r.C4 === 20,
  D: !!r.D1 && r.D1.listed === true && r.D1.active !== r.D1.smt && r.D2.active === r.D2.oth,
});

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
console.log('fixture：' + JSON.stringify(ID));
const HM = await loadEngine(ROOT);
const H = scenarios(HM), J = judge(H);
console.log('實測：' + JSON.stringify(H));
ok('★★★[A] 深海抽出：牌庫 0 張不在可用清單、硬送也不吃次數；牌庫 1 張可用', J.A, JSON.stringify([H.A0, H.A1, H.Aerr]));
ok('★★★[B] 音波刀鋒不計撲身頭擊的 +100 ⇒ 110；對照：閃光屏障 50＋100 擊倒 140 HP 的獒教父', J.B, JSON.stringify([H.B, H.Bctl, H.Berr]));
ok('★★★[C] 化隱詛咒娃娃打火炎獅＝80、光之翼超級皮可西ex 打火炎獅不減；對照：化隱打鑽石膜照 -30（50）、一般攻擊方打火炎獅照 -30（20）', J.C, JSON.stringify([H.C1, H.C2, H.C3, H.C4, H.Cerr]));
ok('★★[D] 大力捕捉器：化隱的備戰在候選裡、選了不互換；選一般寶可夢照常互換', J.D, JSON.stringify([H.D1, H.D2, H.Derr]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6519b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await loadEngine(tmp);
    const B = scenarios(BM), BJ = judge(B);
    ok('★★★[H1] v6.518：A、B、C、D 逐條紅（而且不是例外）', !BJ.A && !BJ.B && !BJ.C && !BJ.D && !B.Aerr && !B.Berr && !B.Cerr && !B.Derr, JSON.stringify({ BJ, B }));
  } catch (e) { ok('★★★[H1] BASE 引擎可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6519 H', '需要 v6.518 commit');

console.log(`\n=== v6.519 官方 Q&A 第一批：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
