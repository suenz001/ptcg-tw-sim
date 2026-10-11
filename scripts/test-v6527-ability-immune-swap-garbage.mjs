#!/usr/bin/env node
/**
 * v6.527 守衛：化隱／光之翼「不受對手特性的效果影響」再收斂兩件事（站長 2026-10-11 裁定）。
 *
 * 【G】灰塵山｜垃圾洩氣（「對手身上附有寶可夢道具卡的戰鬥寶可夢使用的招式的傷害 -20」）：
 *      站長：「也不生效，化隱 光之翼不會受到對手特性影響」。減傷對象是攻擊方 ⇒ 攻擊方有化隱／光之翼就不減。
 *      兩條路徑都要測：engine 主管線（打戰鬥位，applyAction ATTACK）與 effects 備戰管線（dealAttackDamageToTarget 打備戰）。
 *      每條都有正對照：一般攻擊方附道具照 -20。
 * 【S】特性「選擇 1 隻對手的備戰寶可夢，與戰鬥寶可夢互換」：站長「改成跟大力捕捉器一樣」（官方 Q&A：可以選，但不會互換）。
 *      挑戰角擊、媚惑引誘（站長點名）＋母親的誘引、繁星花紋（卡面同型，一併收斂）＋大力捕捉器（既有，零回歸）。
 *      S1 化隱的備戰列在候選、immuneIids 恰好標出它；S2 選它 ⇒ 不互換（媚惑引誘也不混亂任何一隻）；
 *      S3 選一般的備戰 ⇒ 照常互換（媚惑引誘新上場的混亂）；S4 繁星花紋的剩餘 HP ≤ 90 條件仍有效。
 * 【H】BASE（v6.526）：G 的化隱／光之翼兩條、S1／S2 的四張新收斂卡逐條紅；正對照兩版都綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.526。
const BASE_SHA = '0da255cd';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

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
  W: byName('基本【水】能量'), L: byName('基本【雷】能量'), P: byName('基本【超】能量'), filler: '19178',
  garbage: withAbility('灰塵山', '垃圾洩氣'), tool: '14467' /* 氣球（PokemonTool） */,
  hideAtk: withAbility('怨影娃娃', '化隱') /* 垂吊 10，無 picker ⇒ engine 主管線 */,
  doll: withAbility('詛咒娃娃', '化隱'), fairy: withAbility('超級皮可西ex', '光之翼'), raikou: '19167',
  sniper: '14443', lapras: '14085' /* 拉普拉斯ex HP210 */, plain: '14086',
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
if (!missing.length && pool.get(ID.tool)?.subtype !== 'PokemonTool') missing.push('tool 不是寶可夢道具');
const HIDDEN_HP = Number(pool.get(ID.doll)?.hp);   // 詛咒娃娃（化隱）HP80 ≤ 90 ⇒ 繁星花紋可選
const SWAP = [
  ['鐵掌力士', '大力捕捉器', false],
  ['赫普的毛毛角羊', '挑戰角擊', true],
  ['花潔夫人', '媚惑引誘', true],
  ['尼多后', '母親的誘引', true],
  ['安瓢蟲', '繁星花紋', true],
];

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6527-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\n`
    + `export { dealAttackDamageToTarget } from '${p('src/lib/game/effects')}';\n`
    + `export { getAbilityFn, RESOLVERS } from '${p('src/lib/game/effects/_shared')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const en = (id, k) => Array.from({ length: k }, () => inst(id));
  const tool = () => inst(ID.tool);
  const out = {};
  // ── G-engine：攻擊方打灰塵山（戰鬥位）。回傳 [無道具, 有道具] 的傷害 ──
  const engineHit = (mkAtk, attackIndex) => [false, true].map((withTool) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const atk = mkAtk(); if (withTool) atk.toolAttached = tool();
    let s = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: en(ID.W, 10), discard: [], prizes: en(ID.W, 6), bench: [], active: atk },
        { ...s0.players[1], hand: [], deck: en(ID.W, 10), discard: [], prizes: en(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.garbage) },
      ] };
    s = M.applyAction(s, { type: 'ATTACK', attackIndex, actorIdx: 0, discardedEnergyIids: [] }, pool);
    let g = 0;
    while (s.pendingSelection && g++ < 4) {   // 「若希望」型 picker 一律選 0（minCount 允許的最少）
      const ps = s.pendingSelection;
      const sel = ps.type === 'modal-choice' ? ['no'] : (ps.params?.validIids ?? []).slice(0, ps.minCount || 0);
      s = M.applyAction(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token }, pool);
    }
    const d = s.players[1].active;
    // 「垃圾洩氣…無效」log 行數（Fable 審查 P2-1：沒附道具不該寫、有道具恰好 1 行）
    const nLog = (s.log || []).filter((l) => { const t = JSON.stringify(l); return t.includes('垃圾洩氣') && t.includes('無效'); }).length;
    return { dmg: d && d.cardId === ID.garbage ? d.damage : 'KO', nLog };
  });
  try {
    const pack = (a) => ({ dmg: a.map((x) => x.dmg), nLog: a.map((x) => x.nLog) });
    out.Ge_hide = pack(engineHit(() => inst(ID.hideAtk, { energyAttached: en(ID.P, 1) }), 0));
    const fc = pool.get(ID.fairy); const ai = fc.attacks.findIndex((a) => a.name === '射攻月亮');
    out.Ge_fairy = pack(engineHit(() => inst(ID.fairy, { energyAttached: fc.attacks[ai].cost.map((t) => inst(t === 'Psychic' ? ID.P : ID.W)) }), ai));
    out.Ge_ctl = pack(engineHit(() => inst(ID.raikou, { energyAttached: en(ID.L, 3) }), 0));
  } catch (e) { out.GeErr = e.message.split('\n')[0]; }
  // ── G-bench：攻擊方（戰鬥位）狙擊對手備戰 50，灰塵山在對手備戰 ──
  const benchHit = (atkId, withTool) => {
    const atk = inst(atkId, { toolAttached: withTool ? tool() : undefined });
    const tgt = inst(ID.lapras);
    const st = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
      players: [{ name: 'P1', active: atk, bench: [], hand: [], deck: [], discard: [], prizes: [1] },
        { name: 'P2', active: inst(ID.lapras), bench: [tgt, inst(ID.garbage)], hand: [], deck: [], discard: [], prizes: [1] }] };
    const r = M.dealAttackDamageToTarget(st, 0, tgt.iid, 50, pool, { kind: 'attack-damage', label: '狙擊', noWeakness: true });
    return r.players[1].bench.find((b) => b.iid === tgt.iid)?.damage ?? -1;
  };
  try {
    out.Gb_doll = [benchHit(ID.doll, false), benchHit(ID.doll, true)];
    out.Gb_fairy = [benchHit(ID.fairy, false), benchHit(ID.fairy, true)];
    out.Gb_ctl = [benchHit(ID.sniper, false), benchHit(ID.sniper, true)];
  } catch (e) { out.GbErr = e.message.split('\n')[0]; }
  // ── S：特性互換 ──
  const useAbility = (cn, an, oppBench) => {
    const userId = withAbility(cn, an);
    const user = inst(userId);
    const st = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
      players: [{ name: 'A', active: user, bench: [], hand: [], deck: en(ID.W, 5), discard: [], prizes: [] },
        { name: 'B', active: inst(ID.plain), bench: oppBench, hand: [], deck: en(ID.W, 5), discard: [], prizes: [] }] };
    const fn = M.getAbilityFn(cn, an, 0);
    if (!fn) return { st, r: null };
    const old = Math.random; Math.random = () => 0.1;   // 擲幣一律正面
    try { return { st, r: fn(st, 0, pool, user) }; } finally { Math.random = old; }
  };
  const resolve = (r, pick) => {
    const ps = r.pendingSelection;
    return M.RESOLVERS.get(ps.effectKey)({ ...r, pendingSelection: null }, ps.actorIdx ?? 0, [pick], ps.params, pool);
  };
  const confused = (c) => !!c && JSON.stringify([c.status, c.secondaryStatus, c.tertiaryStatus, c.specialConditions]).includes('confused');
  for (const [cn, an] of SWAP) {
    const o = (out[an] = {});
    try {
      // S1／S2：備戰＝[化隱, 一般]
      const hid = inst(ID.doll), oth = inst(ID.filler);
      const { st, r } = useAbility(cn, an, [hid, oth]);
      const ps = r && r.pendingSelection;
      o.S1 = { pending: ps && ps.type, valid: ps?.params?.validIids ?? null, immune: ps?.params?.immuneIids ?? null, hid: hid.iid, oth: oth.iid };
      if (ps && (ps.params?.validIids || []).includes(hid.iid)) {
        const rr = resolve(r, hid.iid);
        o.S2 = { active: rr.players[1].active?.iid, origActive: st.players[1].active.iid, hidOnBench: rr.players[1].bench.some((b) => b.iid === hid.iid),
          conf: confused(rr.players[1].active) || rr.players[1].bench.some(confused),
          log: (rr.log || []).some((l) => JSON.stringify(l).includes('不受對手特性的效果影響，不會互換')) };
      } else o.S2 = { notSelectable: true };
      // S3：選一般的備戰 ⇒ 照常互換
      const hid3 = inst(ID.doll), oth3 = inst(ID.filler);
      const u3 = useAbility(cn, an, [hid3, oth3]);
      if (u3.r && u3.r.pendingSelection) {
        const rr = resolve(u3.r, oth3.iid);
        o.S3 = { swapped: rr.players[1].active?.iid === oth3.iid, conf: confused(rr.players[1].active) };
      } else o.S3 = { noPending: true };
      // S4（繁星花紋）：HP 210 的拉普拉斯ex 不可選
      if (an === '繁星花紋') {
        const big = inst(ID.lapras), hid4 = inst(ID.doll);
        const u4 = useAbility(cn, an, [big, hid4]);
        const v = u4.r?.pendingSelection?.params?.validIids || [];
        o.S4 = { bigListed: v.includes(big.iid), hidListed: v.includes(hid4.iid) };
      }
    } catch (e) { o.err = e.message.split('\n')[0]; }
  }
  return out;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const judge = (r) => {
  const j = {
    // 化隱／光之翼：附道具與否傷害相同（且確實打到）
    Ge_hide: !!r.Ge_hide && typeof r.Ge_hide.dmg[0] === 'number' && r.Ge_hide.dmg[0] > 0 && r.Ge_hide.dmg[1] === r.Ge_hide.dmg[0],
    Ge_fairy: !!r.Ge_fairy && typeof r.Ge_fairy.dmg[0] === 'number' && r.Ge_fairy.dmg[0] > 0 && r.Ge_fairy.dmg[1] === r.Ge_fairy.dmg[0],
    Ge_ctl: !!r.Ge_ctl && typeof r.Ge_ctl.dmg[0] === 'number' && r.Ge_ctl.dmg[1] === r.Ge_ctl.dmg[0] - 20,
    // log：沒附道具 0 行、有道具恰好 1 行（化隱／光之翼）；一般攻擊方兩種都 0 行
    GeLog: !!r.Ge_hide && !!r.Ge_fairy && !!r.Ge_ctl && eq(r.Ge_hide.nLog, [0, 1]) && eq(r.Ge_fairy.nLog, [0, 1]) && eq(r.Ge_ctl.nLog, [0, 0]),
    Gb_doll: eq(r.Gb_doll, [50, 50]),
    Gb_fairy: eq(r.Gb_fairy, [50, 50]),
    Gb_ctl: eq(r.Gb_ctl, [50, 30]),
  };
  for (const [, an, isNew] of SWAP) {
    const o = r[an] || {};
    j[an + ':S1'] = !!o.S1 && o.S1.pending === 'opp-bench-choose' && Array.isArray(o.S1.valid) && o.S1.valid.includes(o.S1.hid) && o.S1.valid.includes(o.S1.oth)
      && eq(o.S1.immune, [o.S1.hid]);
    j[an + ':S2'] = !!o.S2 && o.S2.active === o.S2.origActive && o.S2.hidOnBench === true && o.S2.conf === false && o.S2.log === true;
    j[an + ':S3'] = !!o.S3 && o.S3.swapped === true && (an === '媚惑引誘' ? o.S3.conf === true : true);
    if (an === '繁星花紋') j[an + ':S4'] = !!o.S4 && o.S4.bigListed === false;   // HP 條件本身（化隱可選由 S1 驗）
    j[an + ':_new'] = isNew;
  }
  return j;
};

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
ok('前置：化隱的詛咒娃娃 HP ≤ 90（繁星花紋可選）', HIDDEN_HP > 0 && HIDDEN_HP <= 90, HIDDEN_HP);
for (const [cn, an] of SWAP) ok(`前置：卡庫有 ${cn}｜${an}`, !!withAbility(cn, an));
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
console.log('實測：' + JSON.stringify(H));
ok('★★★[G-engine] 化隱怨影娃娃（垂吊）附道具打灰塵山：不減', J.Ge_hide, JSON.stringify([H.Ge_hide, H.GeErr]));
ok('★★★[G-engine] 光之翼超級皮可西ex 附道具打灰塵山：不減', J.Ge_fairy, JSON.stringify(H.Ge_fairy));
ok('★★[G-engine 正對照] 一般攻擊方（雷電獸）附道具照 -20', J.Ge_ctl, JSON.stringify(H.Ge_ctl));
ok('★★★[G-log] 戰鬥位「垃圾洩氣…無效」log：沒附道具 0 行、有道具恰好 1 行；一般攻擊方 0 行', J.GeLog, JSON.stringify([H.Ge_hide, H.Ge_fairy, H.Ge_ctl].map((x) => x && x.nLog)));
ok('★★★[G-bench] 化隱詛咒娃娃附道具打備戰：不減（50）', J.Gb_doll, JSON.stringify([H.Gb_doll, H.GbErr]));
ok('★★★[G-bench] 光之翼超級皮可西ex 附道具打備戰：不減（50）', J.Gb_fairy, JSON.stringify(H.Gb_fairy));
ok('★★[G-bench 正對照] 一般攻擊方附道具照 -20（30）', J.Gb_ctl, JSON.stringify(H.Gb_ctl));
for (const [cn, an] of SWAP) {
  const o = H[an] || {};
  ok(`★★★[S1] ${cn}｜${an}：化隱的備戰列在候選、immuneIids 恰好標出它`, J[an + ':S1'], JSON.stringify([o.S1, o.err]));
  ok(`★★★[S2] ${cn}｜${an}：選化隱的備戰 ⇒ 不互換、不混亂、log 據實`, J[an + ':S2'], JSON.stringify(o.S2));
  ok(`★★[S3 正對照] ${cn}｜${an}：選一般的備戰照常互換${an === '媚惑引誘' ? '（新上場混亂）' : ''}`, J[an + ':S3'], JSON.stringify(o.S3));
  if (an === '繁星花紋') ok('★★[S4] 繁星花紋：剩餘 HP 210 的不可選（卡面 HP 條件仍有效）', J[an + ':S4'], JSON.stringify(o.S4));
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6527b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    const red = ['Ge_hide', 'Ge_fairy', 'GeLog', 'Gb_doll', 'Gb_fairy'];
    const green = ['Ge_ctl', 'Gb_ctl'];
    for (const [, an, isNew] of SWAP) {
      if (isNew) red.push(an + ':S1', an + ':S2'); else green.push(an + ':S1', an + ':S2');
      green.push(an + ':S3');
      if (an === '繁星花紋') green.push(an + ':S4');
    }
    for (const k of red) ok(`★★★[H] v6.526：${k} 紅`, BJ[k] === false, JSON.stringify(BJ[k]));
    for (const k of green) ok(`★[H 正對照] v6.526：${k} 綠（兩版都對）`, BJ[k] === true, JSON.stringify(BJ[k]));
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6527 H', '需要 v6.526 commit');

console.log(`\n=== v6.527 化隱×垃圾洩氣／特性互換：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
