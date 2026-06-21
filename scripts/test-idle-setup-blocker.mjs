// v0.62 setup 階段「誰該動作」(閒置判負/UI 提示共用):放出場階段 mulligan 較少方先放(較多方等);雙方 setupDone 後才揭示確認/補抽
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const start = src.indexOf('function currentActorSeat(gs) {');
assert(start >= 0, '找不到 currentActorSeat');
let i = src.indexOf('{', start), depth = 0, end = -1;
for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } } }
const currentActorSeat = new Function('return (' + src.slice(start, end) + ')')();
let pass = 0, fail = 0; const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const su = (o) => ({ phase: 'setup', setupDone: [false, false], mulliganCounts: [0, 0], pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [false, false], ...o });

T('【dump 實況】123456(P0)重抽2/RICE(P1)0,皆未準備 → RICE(較少,先放)該動=1', () => {
  assert.equal(currentActorSeat(su({ mulliganCounts: [2, 0], setupDone: [false, false], pendingMulliganDraw: [0, 2], mulliganRevealConfirmed: [true, false] })), 1);
});
T('較少方(RICE,1)已準備、較多方(123456,0)還沒 → 換較多方 123456=0', () => {
  assert.equal(currentActorSeat(su({ mulliganCounts: [2, 0], setupDone: [false, true] })), 0);
});
T('同 mulligan、雙方都沒準備 → 都該動(-1)', () => {
  assert.equal(currentActorSeat(su({ mulliganCounts: [0, 0], setupDone: [false, false] })), -1);
});
T('同 mulligan、僅 P0 準備好 → P1 該動=1', () => {
  assert.equal(currentActorSeat(su({ mulliganCounts: [0, 0], setupDone: [true, false] })), 1);
});
T('雙方都 setupDone、RICE(1) 還欠補抽 → RICE 該動=1', () => {
  assert.equal(currentActorSeat(su({ setupDone: [true, true], pendingMulliganDraw: [0, 2], mulliganRevealConfirmed: [true, false] })), 1);
});
T('雙方都 setupDone、兩邊都欠確認揭示 → -1', () => {
  assert.equal(currentActorSeat(su({ setupDone: [true, true], mulliganRevealConfirmed: [false, false] })), -1);
});
T('雙方都 setupDone、無待辦(理論上會 advance) → -1', () => {
  assert.equal(currentActorSeat(su({ setupDone: [true, true] })), -1);
});
// playing 回歸
T('回歸:playing 輪到 P1 → 1', () => assert.equal(currentActorSeat({ phase: 'playing', activePlayerIndex: 1, players: [{ active: {} }, { active: {} }] }), 1));
T('回歸:playing pendingSelection actorIdx=0 → 0', () => assert.equal(currentActorSeat({ phase: 'playing', activePlayerIndex: 1, pendingSelection: { actorIdx: 0 }, players: [{ active: {} }, { active: {} }] }), 0));
T('回歸:game-over → null', () => assert.equal(currentActorSeat({ phase: 'game-over' }), null));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
