// v0.60 錦標賽閒置判負:setup 階段「等對方補抽」不該雙敗 — currentActorSeat 先判 mulligan 待辦者
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
// 抽出 currentActorSeat 函式(brace 配對)
const start = src.indexOf('function currentActorSeat(gs) {');
assert(start >= 0, '找不到 currentActorSeat');
let i = src.indexOf('{', start), depth = 0, end = -1;
for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } } }
const fnText = src.slice(start, end);
const currentActorSeat = new Function('return (' + fnText + ')')();

let pass = 0, fail = 0; const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const setup = (o) => ({ phase: 'setup', setupDone: [false, false], pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [false, false], ...o });

T('【核心】dump 實況:P0等待、P1(RICE)欠補抽+未確認揭示 → 判 P1(1) 非雙敗(-1)', () => {
  const gs = setup({ setupDone: [false, false], pendingMulliganDraw: [0, 2], mulliganRevealConfirmed: [true, false] });
  assert.equal(currentActorSeat(gs), 1, '應只判 P1(RICE) 該動作');
});
T('P0 欠補抽、P1 已完成 → 判 P0(0)', () => {
  assert.equal(currentActorSeat(setup({ pendingMulliganDraw: [2, 0], mulliganRevealConfirmed: [false, true] })), 0);
});
T('兩邊都欠 mulligan(都沒確認揭示) → 雙方都該動(-1)', () => {
  assert.equal(currentActorSeat(setup({ mulliganRevealConfirmed: [false, false] })), -1);
});
T('mulligan 都完成、僅 P1 還沒選出場(setupDone) → 判 P1(1)', () => {
  assert.equal(currentActorSeat(setup({ setupDone: [true, false] })), 1);
});
T('mulligan 都完成、雙方都還沒選出場 → 雙方都該動(-1)', () => {
  assert.equal(currentActorSeat(setup({ setupDone: [false, false] })), -1);
});
T('mulligan 都完成、雙方都選好(理論上會 advance,防呆) → -1', () => {
  assert.equal(currentActorSeat(setup({ setupDone: [true, true] })), -1);
});
// playing 回歸
T('回歸:playing 輪到 P1 無 pending → 1', () => {
  assert.equal(currentActorSeat({ phase: 'playing', activePlayerIndex: 1, players: [{ active: {} }, { active: {} }] }), 1);
});
T('回歸:playing pendingSelection actorIdx=0 → 0', () => {
  assert.equal(currentActorSeat({ phase: 'playing', activePlayerIndex: 1, pendingSelection: { actorIdx: 0 }, players: [{ active: {} }, { active: {} }] }), 0);
});
T('回歸:game-over → null', () => { assert.equal(currentActorSeat({ phase: 'game-over' }), null); });

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
