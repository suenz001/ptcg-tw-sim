/**
 * 回歸測試網：撤退費計算中央收斂（v5.473）
 * 背景：撤退費原散在 3 個 engine 函式(RETREAT handler / computeActiveRetreatCostFor / getRetreatCost)
 *   + UI 各自重算，改一個漏其他(天空徑線初始化 v5.471/472 連環漏修；鼓擊更是 getRetreatCost/
 *   computeActiveRetreatCostFor 長期漏算)。收斂：computeActiveRetreatCostFor 為唯一中央，
 *   RETREAT handler + getRetreatCost + UI 全呼叫它。改撤退費修正只改中央一處。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.rc-e.ts'), O = join(ROOT, '.rc-o.mjs'), S = join(ROOT, '.rc-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { createGame, applyAction, getRetreatCost, computeActiveRetreatCostFor } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getRetreatCost, computeActiveRetreatCostFor } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const CID = { ubo: '17976', r2: '14087', latias: '14735', tetsu: '16753', grav: '10990', water: '14102', def: '13163', char: '14416'/*小火龍|一身輕,retreat2*/, bramble: '16826'/*振翼髮|暗夜羽擊 passive*/ };
let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const base = () => createGame({ name: 'P1', entries: [{ cardId: CID.def, count: 1 }] }, { name: 'P2', entries: [{ cardId: CID.def, count: 1 }] }, pool);
function mk(activeInst, bench = [], oppActive = CID.def) {
  const s = base();
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { ...s.players[0], hand: [], deck: [inst(CID.def)], discard: [], prizes: Array.from({ length: 6 }, () => inst(CID.def)), active: activeInst, bench: bench.length ? bench : [inst(CID.def)] },
      { ...s.players[1], hand: [], deck: [inst(CID.def)], discard: [], prizes: Array.from({ length: 6 }, () => inst(CID.def)), active: inst(oppActive), bench: [] }] };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✅', n); pass++; } catch (e) { console.log('  ❌', n + ':', e.message); fail++; } };

T('base：烏波 retreat 1 → getRetreatCost=1 / central=1', () => {
  const st = mk(inst(CID.ubo, [en(CID.water)]));
  assert.equal(getRetreatCost(st, pool), 1);
  assert.equal(computeActiveRetreatCostFor(st, 0, pool), 1);
});
T('鼓擊 +2（retreatCostIncreaseThisTurn）→ getRetreatCost=3 / central=3（修好的長期漏算）', () => {
  const st = mk(inst(CID.ubo, [en(CID.water)], { retreatCostIncreaseThisTurn: 2 }));
  assert.equal(getRetreatCost(st, pool), 3, 'getRetreatCost 含鼓擊');
  assert.equal(computeActiveRetreatCostFor(st, 0, pool), 3, '幻影迷宮用的 central 也含鼓擊');
});
T('天空徑線：拉帝亞斯ex 在備戰 → getRetreatCost=0', () => {
  const st = mk(inst(CID.ubo, []), [inst(CID.latias), inst(CID.def)]);
  assert.equal(getRetreatCost(st, pool), 0);
});
T('天空徑線被初始化消除：對手鐵荊棘ex → getRetreatCost=1（顯示恢復）', () => {
  const st = mk(inst(CID.ubo, []), [inst(CID.latias), inst(CID.def)], CID.tetsu);
  assert.equal(getRetreatCost(st, pool), 1);
  assert.equal(computeActiveRetreatCostFor(st, 0, pool), 1);
});
T('重力之玉（道具雙方+1）附 active → 烏波 1+1=2', () => {
  const st = mk(inst(CID.ubo, [en(CID.water), en(CID.water)], { toolAttached: { iid: 't1', cardId: CID.grav, damage: 0, energyAttached: [] } }));
  assert.equal(getRetreatCost(st, pool), 2);
});
T('RETREAT 行為一致：鼓擊使 cost=3，2 能量撤退失敗 / 3 能量成功', () => {
  const benchPromote = inst(CID.def);
  // 2 能量 < cost 3 → 失敗
  const st2 = mk(inst(CID.ubo, [en(CID.water), en(CID.water)], { retreatCostIncreaseThisTurn: 2 }), [benchPromote, inst(CID.def)]);
  const n2 = applyAction(st2, { type: 'RETREAT', newActiveIid: st2.players[0].bench[0].iid }, pool);
  assert.equal(n2.players[0].active?.cardId, CID.ubo, '2 能量 < cost 3 → 撤退失敗 active 不變');
  // 3 能量 → 成功
  const st3 = mk(inst(CID.ubo, [en(CID.water), en(CID.water), en(CID.water)], { retreatCostIncreaseThisTurn: 2 }), [inst(CID.def), inst(CID.def)]);
  const bIid = st3.players[0].bench[0].iid;
  const n3 = applyAction(st3, { type: 'RETREAT', newActiveIid: bIid }, pool);
  assert.notEqual(n3.players[0].active?.cardId, CID.ubo, '3 能量 ≥ cost 3 → 撤退成功');
});
// ── v5.648：免撤退費特性被「特性消除」壓制時應失效（Wilson 報：對手振翼髮暗夜羽擊在場時小火龍一身輕仍免撤退）──
T('一身輕(0能量) + 對手普通 → 撤退費 0（特性生效，控制組）', () => {
  const st = mk(inst(CID.char, []), [inst(CID.def), inst(CID.def)], CID.def);
  assert.equal(computeActiveRetreatCostFor(st, 0, pool), 0, '一身輕 0能量應免撤退');
  assert.equal(getRetreatCost(st, pool), 0);
});
T('★一身輕(0能量) + 對手振翼髮｜暗夜羽擊在戰鬥場 → 撤退費=base 2（特性被消除，bug 修正）', () => {
  const st = mk(inst(CID.char, []), [inst(CID.def), inst(CID.def)], CID.bramble);
  assert.equal(computeActiveRetreatCostFor(st, 0, pool), 2, '一身輕被暗夜羽擊消除→回 base 撤退費 2');
  assert.equal(getRetreatCost(st, pool), 2);
});
T('一身輕(身上有1能量) + 對手普通 → 撤退費 2（一身輕本就不觸發，確保 0 是來自特性）', () => {
  const st = mk(inst(CID.char, [en(CID.water)]), [inst(CID.def), inst(CID.def)], CID.def);
  assert.equal(computeActiveRetreatCostFor(st, 0, pool), 2, '有能量→一身輕不觸發→base 2');
});
console.log(`\n撤退費中央收斂：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
