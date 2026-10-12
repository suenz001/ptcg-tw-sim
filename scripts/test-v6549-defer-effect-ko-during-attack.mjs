#!/usr/bin/env node
/**
 * v6.549 守衛（站長 2026-10-12 第 10 項「要改」；官方 PTCG_RULES L2198 櫻花魚｜漸強波 × 耿鬼ex｜侵蝕詛咒：
 *   「此情況應先處理招式『漸強波』造成的傷害，再處理櫻花魚的[昏厥]」）：
 *   招式進行中從手牌附能 → 侵蝕詛咒把寶可夢放到 HP 0 ⇒ 招式處理完才判昏厥（中央 v6549-defer-effect-ko／v6549-drain-effect-ko）；
 *   漸強波的附能反應改回附能當下觸發；吃飽先／嫩葉之恩改成「附能 → 反應 → 然後回復」。
 * 【H】BASE（v6.548）：NEW 紅、正對照綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.548。
const BASE_SHA = 'b3bbd137';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => 'HIJ'.includes(c.regulationMark || '?');
const byName = (n) => { for (const c of pool.values()) if (c.name === n && HIJ(c)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const EN = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Colorless: '水' };
const ID = { filler: '19178', W: byName('基本【水】能量'), G: byName('基本【草】能量'),
  sakura: '12775', gengar: '16916', leaf: '16508', snorlax: '17038' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6549-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = (p0 = {}, p1 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: s.pendingSelection.actorIdx, senderIdx: s.pendingSelection.actorIdx, pendingToken: s.pendingSelection.token });
  const msgs = (s) => s.log.map((l) => (typeof l === 'string' ? l : l.message ?? '')).join('\n');
  const on = (pl, iid) => (pl.active?.iid === iid ? pl.active : pl.bench.find((c) => c.iid === iid)) ?? null;
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // 櫻花魚（身上 1 張水）手牌 5 張水 ⇒ 漸強波全部附上；對手戰鬥場耿鬼ex（身上 gDmg 傷害）
  const crescendo = (gDmg, o = {}) => {
    const sk = inst(ID.sakura, { energyAttached: many(ID.W, 1) }); const g = inst(ID.gengar, { damage: gDmg });
    const p0 = { active: sk, hand: many(ID.W, 5) }, p1 = { active: g };
    if (o.b0) p0.bench = o.b0; if (o.b1) p1.bench = o.b1;
    if (o.pr0 !== undefined) p0.prizes = many(ID.W, o.pr0).map((c, i) => (o.faceUp0 && i === 0 ? { ...c, faceUp: true } : c));
    if (o.pr1 !== undefined) p1.prizes = many(ID.W, o.pr1);
    let s = act(mk(p0, p1), { type: 'ATTACK', attackIndex: 0 });
    if (s.pendingSelection?.effectKey === 'sakura-crescendo-attach') s = res(s, s.players[0].hand.map((c) => c.iid));
    return { s, sk, g };
  };
  T('CRES_KO_BOTH', () => { const { s, sk, g } = crescendo(140);
    return { sakura: !!on(s.players[0], sk.iid), gengar: !!on(s.players[1], g.iid), pr0: s.players[0].prizes.length, pr1: s.players[1].prizes.length,
      q: s._pendingEffectKo ?? null, deferLog: /招式處理完後才判定昏厥/.test(msgs(s)) }; });
  T('CRES_GEN_ALIVE', () => { const { s, sk, g } = crescendo(0);
    return { sakura: !!on(s.players[0], sk.iid), gDmg: on(s.players[1], g.iid)?.damage ?? -1, pr1: s.players[1].prizes.length }; });
  // 審查 P2-1：雙方都只剩 1 張獎賞 ⇒ 耿鬼ex 與櫻花魚在同一個昏厥檢查點一起昏厥、同時取完 ⇒ 平手（v6.419／v6.420 裁定）
  T('CRES_LAST_BOTH', () => { const { s, sk } = crescendo(140, { pr0: 1, pr1: 1 });
    return { phase: s.phase, draw: s.isDraw === true, winner: s.winner ?? null, sakura: !!on(s.players[0], sk.iid), pr1: s.players[1].prizes.length }; });
  // 審查 P2-2：雙方都沒有備戰、P1 的獎賞是正面朝上（開 take-prize-choose）⇒ 一樣平手，終局盤面不留 HP 0 的櫻花魚與佇列
  T('CRES_FACEUP_NOBENCH', () => { let { s, sk } = crescendo(140, { b0: [], b1: [], pr0: 6, faceUp0: true });
    let g = 0; while (s.pendingSelection && s.phase === 'playing' && g++ < 4) { const o = s.pendingSelection.params?.options?.[0]?.id; s = res(s, o ? [o] : []); }
    return { phase: s.phase, draw: s.isDraw === true, winner: s.winner ?? null, sakura: !!on(s.players[0], sk.iid), q: s._pendingEffectKo ?? null }; });
  // 葉伊布｜嫩葉之恩：備戰（身上 d0 傷害）附 1 張草 ⇒ 侵蝕詛咒 → 然後全回復
  const leaf = (d0) => {
    const lf = inst(ID.leaf, { energyAttached: many(ID.G, 1) }); const b = inst(ID.leaf, { damage: d0 });
    let s = act(mk({ active: lf, bench: [b], hand: many(ID.G, 1) }, { active: inst(ID.gengar) }), { type: 'ATTACK', attackIndex: 0 });
    let g = 0; while (s.pendingSelection && g++ < 4) s = res(s, s.pendingSelection.effectKey === 'bench-hand-attach-fullheal-pick-energy' ? s.players[0].hand.map((c) => c.iid) : [b.iid]);
    const bb = on(s.players[0], b.iid);
    return { alive: !!bb, dmg: bb?.damage ?? -1, pr1: s.players[1].prizes.length, savedLog: /不會昏厥/.test(msgs(s)) };
  };
  T('LEAF_LETHAL', () => leaf(100));
  T('LEAF_ZERO', () => leaf(0));
  // 卡比獸｜吃飽先：戰鬥場（身上 d0 傷害）附 1 張水 ⇒ 侵蝕詛咒 → 然後回 60
  const snorlax = (d0) => {
    const k = inst(ID.snorlax, { damage: d0, energyAttached: many(ID.W, 1) });
    let s = act(mk({ active: k, hand: many(ID.W, 1) }, { active: inst(ID.gengar) }), { type: 'ATTACK', attackIndex: 0 });
    if (s.pendingSelection?.effectKey === 'self-active-hand-attach-heal') s = res(s, s.players[0].hand.map((c) => c.iid));
    const kk = on(s.players[0], k.iid);
    return { alive: !!kk, dmg: kk?.damage ?? -1 };
  };
  T('SNORLAX_ZERO', () => snorlax(0));
  T('SNORLAX_HIGH', () => snorlax(140));   // 正對照：回 60 ≥ 詛咒 20 的情況，兩種順序同為 100
  // 正對照：不在招式中（手動附能）⇒ 照舊當場昏厥，不寫延後字樣
  T('MANUAL_ATTACH', () => {
    const a = inst(ID.filler); const hp = Number(pool.get(ID.filler).hp); a.damage = hp - 20;
    const e = inst(ID.W);
    const s = act(mk({ active: a, hand: [e] }, { active: inst(ID.gengar) }), { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: a.iid });
    return { gone: !on(s.players[0], a.iid), pr1: s.players[1].prizes.length, deferLog: /招式處理完後才判定昏厥/.test(msgs(s)) };
  });
  return out;
}

const judge = (r) => ({
  CRES_KO_BOTH: !!r.CRES_KO_BOTH && r.CRES_KO_BOTH.sakura === false && r.CRES_KO_BOTH.gengar === false && r.CRES_KO_BOTH.pr0 === 4
    && r.CRES_KO_BOTH.pr1 === 5 && r.CRES_KO_BOTH.q === null && r.CRES_KO_BOTH.deferLog === true,
  CRES_GEN_ALIVE: !!r.CRES_GEN_ALIVE && r.CRES_GEN_ALIVE.sakura === false && r.CRES_GEN_ALIVE.gDmg === 180 && r.CRES_GEN_ALIVE.pr1 === 5,
  CRES_LAST_BOTH: !!r.CRES_LAST_BOTH && r.CRES_LAST_BOTH.phase === 'game-over' && r.CRES_LAST_BOTH.draw === true && r.CRES_LAST_BOTH.sakura === false && r.CRES_LAST_BOTH.pr1 === 0,
  CRES_FACEUP_NOBENCH: !!r.CRES_FACEUP_NOBENCH && r.CRES_FACEUP_NOBENCH.phase === 'game-over' && r.CRES_FACEUP_NOBENCH.draw === true
    && r.CRES_FACEUP_NOBENCH.sakura === false && r.CRES_FACEUP_NOBENCH.q === null,
  LEAF_LETHAL: !!r.LEAF_LETHAL && r.LEAF_LETHAL.alive === true && r.LEAF_LETHAL.dmg === 0 && r.LEAF_LETHAL.pr1 === 6 && r.LEAF_LETHAL.savedLog === true,
  LEAF_ZERO: !!r.LEAF_ZERO && r.LEAF_ZERO.alive === true && r.LEAF_ZERO.dmg === 0,
  SNORLAX_ZERO: !!r.SNORLAX_ZERO && r.SNORLAX_ZERO.alive === true && r.SNORLAX_ZERO.dmg === 0,
  SNORLAX_HIGH: !!r.SNORLAX_HIGH && r.SNORLAX_HIGH.alive === true && r.SNORLAX_HIGH.dmg === 100,
  MANUAL_ATTACH: !!r.MANUAL_ATTACH && r.MANUAL_ATTACH.gone === true && r.MANUAL_ATTACH.pr1 === 5 && r.MANUAL_ATTACH.deferLog === false,
});
const LABEL = {
  CRES_KO_BOTH: '★★★ 漸強波附 5 張水、這一下打倒耿鬼ex ⇒ 侵蝕詛咒仍在附能當下觸發、櫻花魚在招式處理完後昏厥（雙方各取獎賞；官方 L2198）',
  CRES_GEN_ALIVE: '★ 正對照（零回歸）：耿鬼ex 沒被打倒 ⇒ 漸強波照樣造成 180、櫻花魚昏厥',
  CRES_LAST_BOTH: '★★★ 雙方都剩最後 1 張獎賞 ⇒ 兩隻一起昏厥、同時取完 ⇒ 平手（審查 P2-1）',
  CRES_FACEUP_NOBENCH: '★★★ 雙方無備戰＋正面朝上獎賞的取獎視窗 ⇒ 平手、終局不留 HP 0 的櫻花魚與佇列（審查 P2-2）',
  LEAF_LETHAL: '★★★ 嫩葉之恩：備戰 100 傷附草能量 ⇒ 詛咒放到 HP 0 → 然後全回復 ⇒ 不昏厥、傷害 0',
  LEAF_ZERO: '★★★ 嫩葉之恩：附能 → 詛咒 → 然後全回復 ⇒ 詛咒的指示物被回復掉（原本先回血後詛咒，留 20）',
  SNORLAX_ZERO: '★★★ 吃飽先：附能 → 詛咒 → 然後回 60 ⇒ 傷害 0（原本留 20）',
  SNORLAX_HIGH: '★ 正對照：吃飽先回 60 ≥ 詛咒 20 ⇒ 兩種順序同為 100',
  MANUAL_ATTACH: '★ 正對照：不在招式中（手動附能）⇒ 照舊當場昏厥、不寫延後字樣',
};
const NEW = ['CRES_KO_BOTH', 'CRES_LAST_BOTH', 'CRES_FACEUP_NOBENCH', 'LEAF_LETHAL', 'LEAF_ZERO', 'SNORLAX_ZERO'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6549b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src scripts static/cards | tar -x -C "${tmp}" && ln -s "${join(ROOT, 'node_modules')}" "${tmp}/node_modules"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.548：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.548：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6549 H', '需要 v6.548 commit');

console.log(`\n=== v6.549 招式中附能反應的昏厥延到招式結束：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
