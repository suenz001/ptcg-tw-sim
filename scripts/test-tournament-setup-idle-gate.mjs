// v0.67 錦標賽 setup 階段閒置判負 gate 驗證（丞龍 vs 承瀚 實例）。
// 抽出 server_admin_patch.js 內真正的 currentActorSeat，複製新舊兩版進場 gate，驗證：
//   新版：setup 掛著方(未進場) + 對手在線 → 判掛著方敗；HEAD 舊版(both-entered)會 skip → HEAD FAIL。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const patch = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

// 抽出 currentActorSeat 函式本體（brace-match）
const start = patch.indexOf('function currentActorSeat(gs) {');
assert(start >= 0, '找不到 currentActorSeat');
let i = patch.indexOf('{', start), depth = 0, end = -1;
for (; i < patch.length; i++) { if (patch[i] === '{') depth++; else if (patch[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } } }
const fnSrc = patch.slice(start, end);
const currentActorSeat = eval('(' + fnSrc + ')');

// gate 述詞：回傳「是否允許判負」
function allowJudge(gs, entered, version) {
  const actor = currentActorSeat(gs);
  const e0 = !!(entered && entered[0]), e1 = !!(entered && entered[1]);
  let allow = e0 && e1;
  if (version === 'new') {
    if (!allow && gs.phase === 'setup' && (actor === 0 || actor === 1)) {
      const oppEntered = actor === 0 ? e1 : e0;
      if (oppEntered) allow = true;
    }
  }
  return { actor, allow };
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// 丞龍(0)已鋪好準備+進場; 承瀚(1)掛著沒鋪沒進場
const setupHang = { phase: 'setup', setupDone: [true, false], mulliganCounts: [0, 0] };

T('新版：承瀚 setup 掛著(未進場)+丞龍在線 → actor=承瀚(1)、允許判負', () => {
  const { actor, allow } = allowJudge(setupHang, [true, false], 'new');
  assert.equal(actor, 1, 'actor 應為承瀚(1)');
  assert.equal(allow, true, '新版應允許判負(判承瀚)');
  assert.equal(1 - actor, 0, '勝方應為丞龍(0)');
});
T('HEAD 舊版：同情境 both-entered gate → 不判(HEAD FAIL 對照)', () => {
  const { allow } = allowJudge(setupHang, [true, false], 'head');
  assert.equal(allow, false, 'HEAD 版此情境會 skip（正是漏洞）');
});
T('控制：雙方都沒進場的 setup → 不判(交未進場處理)', () => {
  const { actor, allow } = allowJudge({ phase: 'setup', setupDone: [false, false], mulliganCounts: [0, 0] }, [false, false], 'new');
  assert.equal(actor, -1, '雙方都沒鋪 → -1');
  assert.equal(allow, false, '雙方都沒進場不判');
});
T('控制：對局中(playing)單方未進場 → 新版仍不判(暫緩範圍)', () => {
  const gs = { phase: 'playing', activePlayerIndex: 0, players: [{ active: {} }, { active: {} }], pendingSelection: null, pendingPrizes: [0, 0] };
  const { allow } = allowJudge(gs, [true, false], 'new');
  assert.equal(allow, false, 'playing 非 setup → 維持 both-entered，不判');
});
T('控制：雙方都進場的 setup 掛著 → 新舊都判(既有行為不變)', () => {
  const a = allowJudge(setupHang, [true, true], 'new').allow;
  const b = allowJudge(setupHang, [true, true], 'head').allow;
  assert.equal(a, true); assert.equal(b, true);
});

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
