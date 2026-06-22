/**
 * 回歸測試網：「下個對手回合 -N」(damageReduceNextHit) 的回合過期收斂（v5.651）
 * 背景：防護充能(蓋諾賽克特ex)等用 active.damageReduceNextHit 表示「下個對手回合受招式 -N」，
 *   但此旗標原是「被打才消費」型、無回合過期 → 對手該回合沒攻擊它就殘留到日後某次被打才 -N
 *   （玩家報：蓋諾賽克特ex 上回合沒攻擊卻仍 -30）。修法：END_TURN 清除 nextIdx(設旗標方)的 damageReduceNextHit。
 *   生命週期：擁有者回合設 → 存活進「下個對手回合」→ 該對手回合結束(=擁有者下回合開始)時清除。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.pc-e.ts'), O = join(ROOT, '.pc-o.mjs'), S = join(ROOT, '.pc-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GENE = '14779' /*蓋諾賽克特ex*/, DEF = '13163';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const base = () => createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
// activePlayerIndex = 即將「結束回合」的玩家；p0Extra 套在 P0 的 active
function mk(activePlayerIndex, p0Extra = {}) {
  const s = base();
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(GENE, p0Extra), bench: [inst(DEF)] },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF), bench: [inst(DEF)] }] };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✅', n); pass++; } catch (e) { console.log('  ❌', n + ':', e.message); fail++; } };

T('設旗標方(P0)回合結束 → damageReduceNextHit 存活進「下個對手回合」', () => {
  // P0 剛用防護充能設 -30，P0 結束回合 → 進 P1(對手)回合，旗標必須還在
  const st = mk(0, { damageReduceNextHit: 30 });
  const n = applyAction(st, { type: 'END_TURN' }, pool);
  assert.equal(n.players[0].active.damageReduceNextHit, 30, '設旗標方回合結束後旗標應存活(護下個對手回合)');
});

T('★ 對手回合結束(=設旗標方下回合開始) → 清除殘留 damageReduceNextHit（bug 修正）', () => {
  // P0 在上一個自己回合設了 -30，保護的是 P1 這個回合；P1 沒攻擊 P0、現在 P1 結束回合 → 應清除
  const st = mk(1, { damageReduceNextHit: 30 });
  const n = applyAction(st, { type: 'END_TURN' }, pool);
  assert.equal(n.players[0].active.damageReduceNextHit, undefined, '對手回合結束未消費的旗標應被清除，不可殘留到下一輪');
});

T('控制組：沒有旗標時 END_TURN 不會無中生有', () => {
  const st = mk(1, {});
  const n = applyAction(st, { type: 'END_TURN' }, pool);
  assert.equal(n.players[0].active.damageReduceNextHit, undefined);
});

T('retaliateCountersOnNextHit:設旗標方回合結束→存活進對手回合', () => {
  const st = mk(0, { retaliateCountersOnNextHit: 12 });
  const n = applyAction(st, { type: 'END_TURN' }, pool);
  assert.equal(n.players[0].active.retaliateCountersOnNextHit, 12, '設旗標方回合結束後應存活');
});
T('★retaliateCountersOnNextHit:對手回合結束→清除殘留(v5.657 修正)', () => {
  const st = mk(1, { retaliateCountersOnNextHit: 12 });
  const n = applyAction(st, { type: 'END_TURN' }, pool);
  assert.equal(n.players[0].active.retaliateCountersOnNextHit, undefined, '對手回合結束未消費應清除,不可殘留');
});

console.log(`\n防護充能旗標回合過期：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
