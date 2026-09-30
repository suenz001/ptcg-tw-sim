#!/usr/bin/env node
/**
 * v6.456 守衛：「若希望，選擇 N 個能量…。這個情況下，〔追加效果〕」的全有或全無門檻——中央述詞 preDiscardOptInThreshold
 *
 * 玩家回報（站長 2026-09-30，附 PTCG 搜判）：
 *   狐大盜附 2 個惡能量，用「技能大盜」借對手 厄鬼椪 水井面具ex 的「激流水泵」——
 *   官方：雖然放不回 3 個，但把 2 個放回牌庫並重洗，對手 1 隻備戰寶可夢也受到 120。
 *   本站：確認鈕按不下去（只能選「不啟用」打 100）。
 *
 * 根因：同一個門檻寫了三份（IRON_RULES Rule 38 型態）——
 *   引擎（v155_attacks 的 _hydroPumpRequired）＝min(3, 身上能量)  ← 本來就對
 *   畫面（+page 的 _computeExactRequired）＝寫死「3，只有太晶＋璀璨結晶才 2」 ← 借招只 2 能量永遠湊不滿；
 *                                          太晶＋璀璨結晶＋3 能量時反而放行 2、引擎要 3 ⇒ 按了確認只打 100
 *   AI（ai.ts）＝同畫面、而且用張數比                                   ← 特殊能量／借招時與引擎不一致
 * 修法：spec 宣告 optInThreshold:3，三端一律呼叫中央 preDiscardOptInThreshold(spec, 這次出招者可付單位)＝min(N, 可付)。
 *
 * Run: node scripts/test-v6456-optin-threshold-central.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.455。
const BASE_SHA = 'd3797b7979e7422ce1a977439f70a743fcb51861';
const F = { page: 'src/routes/game/+page.svelte', ai: 'src/lib/game/ai.ts', v155: 'src/lib/game/effects/cards/v155_attacks.ts', shared: 'src/lib/game/effects/_shared.ts' };
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const strip = (s, name) => { try { return stripCommentsBlankChecked(s, name); } catch { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); } };

// ── esbuild harness（本版的引擎／中央述詞）──
const S = join(ROOT, '.x6456-s.js'), E = join(ROOT, '.x6456-e.ts'), O = join(ROOT, '.x6456-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { getAIAction } from './src/lib/game/ai';\nexport * as SH from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const FOX = '19196', PUMP = '10452', DARK = '17214', WATER = '12248', CRYSTAL = '17151';
ok('[前提] 卡池讀得到 狐大盜／厄鬼椪 水井面具ex（激流水泵是第 2 招）／基本【惡】能量', pool.get(FOX)?.name === '狐大盜' && pool.get(PUMP)?.attacks?.[1]?.name === '激流水泵' && pool.get(DARK)?.name === '基本【惡】能量');

console.log('\nA) 中央述詞 preDiscardOptInThreshold');
const T = M.SH?.preDiscardOptInThreshold;
const SPEC = M.SH?.ATTACK_PRE_DISCARD_CHOICE?.get('厄鬼椪 水井面具ex|激流水泵');
ok('★★★[A1] 中央述詞存在', typeof T === 'function');
ok('★★★[A2] 激流水泵的 spec 宣告 optInThreshold:3（門檻由卡片宣告，不由呼叫端認招式名）', SPEC?.optInThreshold === 3, JSON.stringify(SPEC));
if (typeof T === 'function' && SPEC) {
  ok('★★★[A3] 身上 2 個 ⇒ 門檻 2（官方：放回全部也算「這個情況下」）', T(SPEC, 2) === 2);
  ok('★★[A4] 身上 3／5 個 ⇒ 門檻 3（有 3 個以上就必須放回 3 個）', T(SPEC, 3) === 3 && T(SPEC, 5) === 3);
  ok('★[A5] 身上 1 個 ⇒ 門檻 1；負數夾成 0', T(SPEC, 1) === 1 && T(SPEC, -2) === 0);
  ok('★★[A6] spec 沒宣告門檻 ⇒ undefined（不是這一型的招式不受影響）', T({ min: 0, max: 3, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0 }, 2) === undefined && T(undefined, 2) === undefined);
}

console.log('\nB) 引擎完整流程（applyAction → RESOLVE_SELECTION）');
let n = 0; const I = (cid, e = []) => ({ iid: 'i' + (++n), cardId: cid, damage: 0, energyAttached: e });
function play({ attacker, attackerEnergies, discard, copy }) {
  const opp = I(PUMP, [I(WATER)]); const ob = I(FOX);
  const act = I(attacker, attackerEnergies);
  const st = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: undefined, setupDone: [true, true],
    players: [{ name: 'A', active: act, bench: [], hand: [], deck: [I(FOX)], discard: [], prizes: [I(FOX), I(FOX)] },
      { name: 'B', active: opp, bench: [ob], hand: [], deck: [I(FOX)], discard: [], prizes: [I(FOX), I(FOX)] }] };
  const action = { type: 'ATTACK', attackIndex: copy ? 0 : 1, actorIdx: 0, discardedEnergyIids: discard(act) };
  if (copy) action.copyAttackChoice = { pokeIid: opp.iid, attackIndex: 1 };
  let s = M.applyAction(st, action, pool);
  const benchPicker = s.pendingSelection?.type === 'opp-bench-choose';
  if (s.pendingSelection) s = M.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [ob.iid], pendingToken: s.pendingSelection.token }, pool);
  const hitBench = (s.players[1].bench.find((b) => b.iid === ob.iid)?.damage ?? 0) >= 100 || s.players[1].discard.some((c) => c.iid === ob.iid);
  return { benchPicker, hitBench, left: s.players[0].active?.energyAttached.length ?? -1 };
}
const r2 = play({ attacker: FOX, attackerEnergies: [I(DARK), I(DARK)], discard: (a) => a.energyAttached.map((e) => e.iid), copy: true });
ok('★★★[B1] 狐大盜 2 惡能量借激流水泵、放回 2 個 ⇒ 開備戰選擇、備戰受 120、能量回牌庫（官方搜判）', r2.benchPicker && r2.hitBench && r2.left === 0, JSON.stringify(r2));
const r2b = play({ attacker: FOX, attackerEnergies: [I(DARK), I(DARK)], discard: () => [], copy: true });
ok('★★[B2] 同盤面選「不啟用」（送 []）⇒ 不打備戰、能量不動', !r2b.benchPicker && !r2b.hitBench && r2b.left === 2, JSON.stringify(r2b));
const r3 = play({ attacker: FOX, attackerEnergies: [I(DARK), I(DARK), I(DARK)], discard: (a) => a.energyAttached.slice(0, 2).map((e) => e.iid), copy: true });
ok('★★[B3] 身上 3 個卻只放回 2 個 ⇒ 不成立（有 3 個就要放回 3 個）、能量不動', !r3.benchPicker && !r3.hitBench && r3.left === 3, JSON.stringify(r3));

console.log('\nC) 三端共用同一支（靜態；HEAD-FAIL 對 v6.455）');
function uiThresholdFn(src) {
  const i = src.indexOf('  function _computeExactRequired('); if (i < 0) return '';
  const j = src.indexOf('\n  }\n', i); return j > i ? src.slice(i, j) : '';
}
function aiBlock(src) {
  const i = src.indexOf('    let aiDiscardedEnergyIids: string[] | undefined;'); const j = src.indexOf('    // ⭐v6.430（批次 C）每一招都打不動', i);
  return i > 0 && j > i ? src.slice(i, j) : '';
}
function hydroFn(src) {
  const i = src.indexOf('function _hydroPumpRequired('); const j = src.indexOf('\n}\n', i); return i > 0 && j > i ? src.slice(i, j) : '';
}
const CHECKS = [
  ['★★★[C1] 畫面的門檻呼叫中央述詞、不認招式名／璀璨結晶', true, (s) => {
    const b = strip(uiThresholdFn(s.page), 'ui'); return b.length > 20 && /preDiscardOptInThreshold\(spec, _maxDiscardAmount\(spec\)\)/.test(b) && !/激流水泵|璀璨結晶|太晶/.test(b);
  }],
  ['★★[C2] 畫面兩個開窗點（自己出招、借招收尾）都用 spec 算門檻', true, (s) => (s.page.match(/_computeExactRequired\(spec\)/g) || []).length === 2 && !/_computeExactRequired\(atk/.test(s.page)],
  ['★★★[C3] AI 自動付款呼叫中央述詞、不再寫死 璀璨結晶／3', true, (s) => {
    const b = strip(aiBlock(s.ai), 'ai'); return /preDiscardOptInThreshold\(_spec, avail\)/.test(b) && /optInThreshold/.test(b) && !/璀璨結晶|激流水泵/.test(b);
  }],
  ['★★[C4] 引擎的 _hydroPumpRequired 呼叫中央述詞（不再就地 Math.min(3, …)）', true, (s) => {
    const b = strip(hydroFn(s.v155), 'v155'); return /preDiscardOptInThreshold\(HYDRO_PUMP_SPEC, totalUnits\)/.test(b) && !/Math\.min\(3/.test(b);
  }],
  ['★[C5] 中央述詞只定義一次（_shared.ts）', true, (s) => (s.shared.match(/export function preDiscardOptInThreshold\(/g) || []).length === 1],
  // ⭐ 審查（fable）指出：只鎖 helper 不鎖消費點＝安慰劑（把確認鈕的比較改成字面 3 時守衛全綠）⇒ 三個消費點逐一釘住、且不得出現字面門檻
  ['[C6前提] 消費點①：勾選時的達標上限讀 exactRequired（不寫死數字）', false, (s) =>
    s.page.includes('        const gate = (preAttackDiscard.exactRequired !== undefined && preAttackDiscard.exactRequired > 0)\n          ? preAttackDiscard.exactRequired\n          : min;')],
  ['[C6前提] 消費點②：確認時的門檻讀 exactRequired', false, (s) =>
    s.page.includes('    if (exactRequired !== undefined && amount !== 0 && amount < exactRequired) return;')],
  ['[C6前提] 消費點③：畫面的確認鈕可按判準讀 req（＝exactRequired）', false, (s) =>
    s.page.includes('    {@const req = preAttackDiscard.exactRequired}\n    {@const exactOk = req === undefined ? true : pickedAmount >= req}')],
  ['★[C7] 門檻為 0 時不顯示「不啟用」（兩鈕結果相同）；確認鈕的目前值用能量單位', true, (s) =>
    s.page.includes('{#if spec.min === 0 && req !== 0}') && s.page.includes('目前 {pickedAmount}/{req}）')],
];
const CUR = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, rd(f)]));
const runAll = (src) => CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; });
for (const c of runAll(CUR)) ok(c.name, c.r);
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6456 C HEAD-FAIL', '需要 v6.455 commit');
else {
  const base = {}; let all = true;
  for (const [k, f] of Object.entries(F)) { const r = readBaseBlob(ROOT, BASE_SHA, f); if (!r.ok) all = false; else base[k] = r.out.replace(/\r\n/g, '\n'); }
  ok('[前提] 讀得到 v6.455 的四個檔案', all);
  if (all) {
    const res = runAll(base);
    const wrongPass = res.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] C1～C5 在 v6.455 全部不成立（逐條：' + res.map((c) => (c.r ? '成立' : '紅') + '：' + c.name.slice(0, 14)).join('；') + '）', wrongPass.length === 0, wrongPass.join(' ｜ '));
    // 行為端的 HEAD 對照：v6.455 的畫面門檻對「狐大盜 2 能量」給 3（寫死），引擎給 2 ⇒ 兩端不一致（本版修掉的就是這個）
    ok('★★[HEAD 對照] v6.455 的畫面門檻寫死 3（非太晶一律 3）＝與引擎 min(3, 2)=2 不一致', /if \(!isTera\) return 3;/.test(base.page));
  }
}

console.log('\nD) AI 行為（getAIAction；AI 付款門檻與引擎同一支）');
function aiPick(energyCount, withCrystal, opts = {}) {
  const es = opts.energies ? opts.energies() : Array.from({ length: energyCount }, () => I(WATER));
  const me = I(PUMP, es); if (withCrystal) me.toolAttached = I(CRYSTAL);
  const st = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: undefined, setupDone: [true, true],
    players: [{ name: 'AI', active: me, bench: opts.bench ? opts.bench() : [], hand: [], deck: [I(FOX), I(FOX)], discard: [], prizes: [I(FOX), I(FOX)] },
      { name: 'B', active: I(FOX), bench: [I(FOX)], hand: [], deck: [I(FOX)], discard: [], prizes: [I(FOX), I(FOX)] }] };
  const act = M.getAIAction(st, pool, 0);
  return { type: act?.type, idx: act?.attackIndex, n: act?.discardedEnergyIids?.length ?? 0 };
}
const a2 = aiPick(2, true), a3 = aiPick(3, true), a4 = aiPick(4, false);
ok('[D前提] AI 會使出激流水泵（第 2 招）', a2.type === 'ATTACK' && a2.idx === 1 && a3.idx === 1 && a4.idx === 1, JSON.stringify({ a2, a3, a4 }));
ok('★★[D1] 太晶＋璀璨結晶＋2 能量 ⇒ AI 放回 2 個（門檻＝min(3,2)）', a2.n === 2, JSON.stringify(a2));
ok('★★★[D2] 太晶＋璀璨結晶＋3 能量 ⇒ AI 放回 3 個（v6.455 寫死「璀璨結晶＝2」⇒ 只放 2、引擎要 3、備戰打不到）', a3.n === 3, JSON.stringify(a3));
ok('★★[D3] 4 能量 ⇒ AI 只放回 3 個（最小組合）', a4.n === 3, JSON.stringify(a4));
// ⭐ 複審建議：單位維度（host-aware）——備戰有大竺葵（繁茂：基本草各算 2 個）；戰鬥位 水＋草＋草 ⇒ 可付 5、門檻 3
//   ⇒ 最小組合＝2 張草（4 個）；若 AI 用「張數」算會放回 3 張（這條守的是 avail／need 讀能量單位，不是張數）
const GRASS = '11173', BLOOM = '14025';
const aB = aiPick(0, false, { energies: () => [I(WATER), I(GRASS), I(GRASS)], bench: () => [I(BLOOM)] });
ok('★★[D4] 繁茂在場：水＋草＋草 ⇒ AI 放回 2 張草（能量單位 4 ≥ 3；最小組合）', aB.type === 'ATTACK' && aB.idx === 1 && aB.n === 2, JSON.stringify(aB));
// 張數 < 3 但單位 ≥ 3 才分得出「用張數 vs 用單位」：太晶＋璀璨結晶、繁茂在場、身上 水＋草（2 張＝3 個）
//   ⇒ 門檻 min(3, 3)=3 ⇒ 兩張都要放回；若 AI 用張數算（avail=2 ⇒ 門檻 2）會只放回 1 張草、引擎要 3 ⇒ 備戰打不到
const aC = aiPick(0, true, { energies: () => [I(WATER), I(GRASS)], bench: () => [I(BLOOM)] });
ok('★★★[D5] 繁茂在場＋璀璨結晶：水＋草（2 張＝3 個）⇒ AI 兩張都放回（門檻以能量單位計）', aC.type === 'ATTACK' && aC.idx === 1 && aC.n === 2, JSON.stringify(aC));

console.log(`\n=== v6.456 若希望全有或全無門檻中央化: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6456-optin-threshold-central ===');
process.exit(fail ? 1 : 0);
