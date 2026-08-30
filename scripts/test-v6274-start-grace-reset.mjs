// v6.274 守衛 —— 開局 grace 計時（`_onlineReadyAt`）的陳舊值：「再來一局」時 P2 的 6 秒 fallback 被擊穿
//
// ── 這一版在修什麼 ────────────────────────────────────────────────────────
// v5.749 的「決定性建局者」是這樣設計的：seat 0 立刻建局，seat 1 只有在「雙方就緒且房間
// 還沒有局」持續 6 秒之後才 fallback 建局 ⇒ 正常情況下只有 seat 0 會 createGame，
// 房間的 canonical 局唯一，開局重洗的競態整類消失。
//
// 但 grace 的起算點 `_onlineReadyAt` **只在 `checkAndStartOnlineGame()` 裡歸零**，
// 而那支函式**只在「房間是 lobby ＋雙方就緒」時才會被 `handleRoomUpdate` 呼叫**
// ⇒ 它裡面那三條歸零（非 lobby／已有盤面／未雙就緒）在真實流程裡跑不到；
// 第四條早退 `haveLocalGame` 又是在 `shouldAttemptStartGame` 內部擋的，呼叫端在它之前
// 就已經把 `_onlineReadyAt` 寫成「這一刻」⇒ 也不歸零。
// ⇒ 第一局開打之後 `_onlineReadyAt` 凍在「第一局雙就緒的那一刻」；「再來一局」時
//   `readyElapsedMs` ＝上一局的整場時間 ⇒ seat 1 的 6 秒 grace 被瞬間擊穿
//   ⇒ **雙端同時 createGame ⇒ 開局重洗競態重生**。
// 線上證據（8/30 的 casual-phantom-adopt 指紋，readyMs）：
//   169,596 / 397,304 / 597,965 / 1,164,572 / 1,300,430 / 1,314,882 ms（2.8 分鐘～22 分鐘）。
//
// ── 這支守衛的紀律（本專案已連續踩到九次「守衛安慰劑」）────────────────────
//   ・【B】是**行為端**：把 `+page.svelte` 裡 `handleRoomUpdate` 的尾段與
//     `checkAndStartOnlineGame()` **原文抽出來、用 esbuild 轉譯、真的執行**，
//     再用一整段房間更新序列（開局→對戰 10 分鐘→再來一局）驅動它。
//     抽取器對 BASE／HEAD 都適用（BASE 沒有歸零那幾行 ⇒ 抽到的就是 BASE 的行為）
//     ⇒ 【A】拿真 BASE blob 跑同一組 fixture **必須紅**，而且紅在「seat 1 竟然建局了」。
//   ・【D】接線：光有中央述詞沒接上等於沒改 ⇒ 逐一斷言呼叫點與**順序**。
//   ・【E】不可破壞：`resolveRoomUpdate` / `shouldSkipStalePush` / `shouldAttemptStartGame`
//     三段以內嵌 sha256 錨定（history-free，淺複製下也真的在守）。
//   ・只捕捉 assert.AssertionError（其他例外一律炸出來）。
// Run: node scripts/test-v6274-start-grace-reset.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '65553fb6c68992f719c80d82620e9d68298b43ca';   // v6.273（本版的前一版）
const PAGE_PATH = 'src/routes/game/+page.svelte';
const SG_PATH = 'src/lib/game/sync-guards.ts';
const PAGE = readFileSync(join(ROOT, PAGE_PATH), 'utf8');
const SG = readFileSync(join(ROOT, SG_PATH), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
const T = (n, fn) => {
  try { fn(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
/** 突變測試：跑起來**必須**紅在指定那一條。沒紅 ⇒ 守衛是安慰劑。 */
function mustBreak(name, run) {
  let red = null;
  try { run(); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = e.message.split('\n')[0].slice(0, 88); }
  if (red !== null) { console.log('  OK   ' + name + '（如預期紅：' + red + '）'); pass++; return; }
  console.log('  FAIL ' + name + ' :: 突變後竟然還是綠的 —— 這條守衛沒有在守');
  fail++;
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

// ══════════════════════════════════════════════════════════════════════════
// 抽取器（Rule 25：掃描器自己要先被驗；每一段都有下限斷言＋括號配對檢查）
// ══════════════════════════════════════════════════════════════════════════
const A_LOBBY_RESET = "    // v3.96 房間 status 從 'playing'/'ended' → 'lobby' + game=null：雙方都 ready 後 reset 的同步點";
const A_V272 = '    // v2.72：雙方 P1/P2 都 ready → P1 或 P2 任一 client 都可觸發 startGame';
const A_HRU_END = '\n  }\n\n  // v5.894：對戰按牌組載入';
const A_CSG = '  function checkAndStartOnlineGame() {';
const A_CSG_END = '\n  }\n\n  /**\n   * v6.055 建局逾時看門狗。';

function balanced(s) { let d = 0; for (const c of s) { if (c === '{') d++; else if (c === '}') d--; } return d; }

/** 「房間回到 lobby ⇒ 清 local game」那一小段（BASE／HEAD 逐字相同）。 */
function lobbyResetBlock(src) {
  const i = src.indexOf(A_LOBBY_RESET); ok(i > 0, '抓不到 v3.96 lobby-reset 區塊');
  const j = src.indexOf('\n    }\n', i); ok(j > i, '抓不到 lobby-reset 區塊終點');
  const blk = src.slice(i, j + 7);
  ok(blk.includes('game = null;'), 'lobby-reset 區塊抽錯了（沒有 game = null）');
  ok(balanced(blk) === 0, 'lobby-reset 區塊括號沒配對（抽取器壞了）');
  return blk;
}

/**
 * `handleRoomUpdate` 的**尾段**：從「grace 歸零」那一行（HEAD）或 v2.72 錨點（BASE）
 * 一路到函式結尾。⚠ 版本無關：BASE 沒有歸零那幾行 ⇒ 抽到的就是 BASE 的真實行為。
 */
function hruTail(src) {
  const end = src.indexOf(A_HRU_END); ok(end > 0, '抓不到 handleRoomUpdate 結尾錨點');
  const v272 = src.lastIndexOf(A_V272, end); ok(v272 > 0, '抓不到 v2.72 建局呼叫錨點');
  const g = src.lastIndexOf('shouldResetStartGrace(', end);
  let start = v272;
  if (g > 0 && g < v272) start = src.lastIndexOf('\n', g) + 1;   // 行首
  const blk = src.slice(start, end);   // 到函式結尾的 '\n  }' 之前（尾段自己是完整的敘述列）
  ok(blk.includes('checkAndStartOnlineGame();'), 'handleRoomUpdate 尾段抽錯了（沒有建局呼叫）');
  ok(balanced(blk) === 0, 'handleRoomUpdate 尾段括號沒配對（抽取器壞了）: ' + balanced(blk));
  return blk;
}

/** `checkAndStartOnlineGame()` 全文。 */
function csgFn(src) {
  const i = src.indexOf(A_CSG); ok(i > 0, '抓不到 checkAndStartOnlineGame 起點');
  const j = src.indexOf(A_CSG_END, i); ok(j > i, '抓不到 checkAndStartOnlineGame 終點');
  const blk = src.slice(i, j + 5);
  ok(blk.includes('shouldAttemptStartGame({'), 'checkAndStartOnlineGame 抽錯了');
  ok(balanced(blk) === 0, 'checkAndStartOnlineGame 括號沒配對（抽取器壞了）: ' + balanced(blk));
  return blk;
}

/** `handleRoomUpdate` 全文（只給【D】的順序斷言用）。 */
function hruAll(src) {
  const i = src.indexOf('  function handleRoomUpdate(room: Room | null) {'); ok(i > 0, '抓不到 handleRoomUpdate');
  const j = src.indexOf(A_HRU_END, i); ok(j > i, '抓不到 handleRoomUpdate 結尾');
  return src.slice(i, j);
}

// ══════════════════════════════════════════════════════════════════════════
// 行為端 harness：把上面三段真的組起來執行
// ══════════════════════════════════════════════════════════════════════════
function makeSim(src, sgMod, opts = {}) {
  const frag = [
    'function onRoom(room) {',
    '  roomData = room;',
    '  const idx = room.seats.findIndex((s) => !!s.uid && s.uid === myUid);',
    lobbyResetBlock(src),
    '  if (room.gameState && !game) { game = { id: room.gameState.id }; }',   // harness：模擬盤面採納
    hruTail(src),
    '}',
    csgFn(src),
  ].join('\n');
  let js;
  try { js = transformSync(frag, { loader: 'ts', target: 'node18' }).code; }
  catch (e) { throw new assert.AssertionError({ message: '抽出來的片段轉譯失敗：' + e.message }); }

  const prologue = `
  let _onlineReadyAt = 0, game = null, roomData = null, mySeatIdx = -1;
  let _poolRetry = 0, onlineError = '', _startGameWon = null, _startGameReadyMs = -1;
  const poolReady = true, roomCode = 'ROOM', forceLegacyOpeningParam = false;
  const myUid = env.myUid, pool = new Map();
  const { shouldAttemptStartGame, shouldResetStartGrace } = env.sg;
  const bothPlayersReady = env.bothPlayersReady;
  const Date = { now: () => env.now() };
  const deckEntriesAllInPool = () => true;
  const ensurePoolForDeckEntries = async () => {};
  const createGame = () => ({ id: 'G' + (++env.seq) });
  const startGame = (rc, g) => { env.built.push({ t: env.now(), id: g.id, readyMs: _startGameReadyMs }); return Promise.resolve(true); };
  const playSfx = () => {}, staggerSfx = () => {};
  const setTimeout = () => 0;
  const console = { log() {}, warn() {}, error() {} };
  `;
  const epilogue = `
  return {
    onRoom,
    csg: checkAndStartOnlineGame,
    readyAt: () => _onlineReadyAt,
    setGame: (g) => { game = g; },
    setRoom: (r) => { roomData = r; },
    getGame: () => game,
  };`;
  const env = {
    myUid: opts.myUid ?? 'U2', seq: 0, built: [],
    _t: opts.t0 ?? 1000000, now() { return this._t; },
    sg: sgMod, bothPlayersReady: opts.bothPlayersReady,
  };
  let api;
  try { api = new Function('env', prologue + js + epilogue)(env); }
  catch (e) { throw new assert.AssertionError({ message: 'harness 載不起來：' + e.message }); }
  return { ...api, env, adv: (ms) => { env._t += ms; }, built: () => env.built };
}

/** 把某一版的 sync-guards.ts 載成模組（BASE 版沒有 shouldResetStartGrace ⇒ 就是沒有）。 */
function loadSG(srcText) {
  const code = transformSync(srcText, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}));
  return mod.exports;
}
const SGMOD = loadSG(SG);
const bothPlayersReady = (seats) => !!(seats[0].uid && seats[1].uid && seats[0].ready && seats[1].ready
  && (seats[0].deckEntries || []).length === 60 && (seats[1].deckEntries || []).length === 60);

const DECK = Array.from({ length: 60 }, (_, i) => ({ cardId: 'c' + i, count: 1 }));
const seat = (uid, ready) => ({ uid, ready, deckEntries: DECK, name: uid });
const R = (status, ready, gs) => ({
  status, gameState: gs ?? null,
  seats: [seat('U1', ready), seat('U2', ready), {}, {}],
});

/**
 * 一整場的房間更新序列：開局 → 對戰 durMs → 再來一局 → 雙方再度就緒。
 * 回傳「第二次雙就緒那一刻為止」這個 client 一共嘗試建局幾次。
 */
function runRematchScenario(src, sgMod, myUid, durMs) {
  const sim = makeSim(src, sgMod, { myUid, bothPlayersReady });
  sim.onRoom(R('lobby', false));                        // ① 進房，還沒準備
  sim.onRoom(R('lobby', true));                         // ② 雙方就緒
  const afterFirst = sim.built().length;
  sim.adv(300);
  sim.onRoom(R('playing', true, { id: 'CANON-1' }));    // ③ canonical 局進來
  sim.adv(durMs);                                       // ④ 打完一整場
  sim.onRoom(R('playing', true, { id: 'CANON-1' }));
  sim.onRoom(R('lobby', false));                        // ⑤ 再來一局：房間重設（ready 清掉）
  sim.adv(1500);
  sim.onRoom(R('lobby', true));                         // ⑥ 雙方再度就緒 ← bug 就在這一刻
  return { sim, afterFirst, total: sim.built().length, built: sim.built() };
}

console.log('\n【B】行為端：抽出 handleRoomUpdate 尾段＋checkAndStartOnlineGame 真的執行');
T('B1 再來一局時 seat 1 **不會**立刻建局（grace 是新鮮的）', () => {
  const r = runRematchScenario(PAGE, SGMOD, 'U2', 600000);
  assert.strictEqual(r.afterFirst, 0, 'seat 1 在第一局雙就緒當下就不該建局');
  assert.strictEqual(r.total, 0,
    `seat 1 在「再來一局」雙就緒的那一刻竟然建局了（建局紀錄 ${JSON.stringify(r.built)}）`
    + ' —— grace 用到了上一局的陳舊起點');
});
T('B2 正對照：seat 0 兩局都正常立刻建局，且 readyMs 都很小', () => {
  const r = runRematchScenario(PAGE, SGMOD, 'U1', 600000);
  assert.strictEqual(r.afterFirst, 1, 'seat 0 第一局應立刻建局');
  assert.strictEqual(r.total, 2, 'seat 0 再來一局也應立刻建局');
  for (const b of r.built) assert.ok(b.readyMs >= 0 && b.readyMs < 1000, 'seat 0 的 readyMs 不該是大數字：' + b.readyMs);
});
T('B3 正對照：P1 沒建局時 seat 1 仍會在 6 秒後 fallback（保護沒被關掉）', () => {
  const sim = makeSim(PAGE, SGMOD, { myUid: 'U2', bothPlayersReady });
  sim.onRoom(R('lobby', false));
  sim.onRoom(R('lobby', true));
  assert.strictEqual(sim.built().length, 0, '雙就緒當下不該建局');
  sim.adv(2000); sim.onRoom(R('lobby', true));
  assert.strictEqual(sim.built().length, 0, '才 2 秒不該建局');
  sim.adv(4500); sim.onRoom(R('lobby', true));
  assert.strictEqual(sim.built().length, 1, '雙就緒滿 6.5 秒後 seat 1 應該 fallback 建局');
  assert.ok(sim.built()[0].readyMs >= 6000, 'fallback 的 readyMs 應 >= 6000，實際 ' + sim.built()[0].readyMs);
});
T('B4 正對照：第二局的 fallback 仍在（新鮮的 6 秒，不是永遠不建）', () => {
  const r = runRematchScenario(PAGE, SGMOD, 'U2', 600000);
  assert.strictEqual(r.total, 0, '再來一局當下不該建局');
  r.sim.adv(6500); r.sim.onRoom(R('lobby', true));
  assert.strictEqual(r.sim.built().length, 1, '第二局雙就緒滿 6.5 秒後 seat 1 仍應 fallback 建局');
});
T('B5 haveLocalGame 擋下建局之後，下一次 grace 計時是新鮮的', () => {
  const sim = makeSim(PAGE, SGMOD, { myUid: 'U2', bothPlayersReady });
  sim.setRoom(R('lobby', true)); sim.setGame({ id: 'LOCAL-1' });
  sim.csg();                                    // 本地已有局 ⇒ 擋下
  assert.strictEqual(sim.readyAt(), 0, 'haveLocalGame 擋下時 _onlineReadyAt 必須歸零，實際 ' + sim.readyAt());
  assert.strictEqual(sim.built().length, 0, '本地已有局時不該建局');
  sim.adv(900000);                              // 過了 15 分鐘，本地局才被清掉
  sim.setGame(null); sim.csg();
  assert.strictEqual(sim.readyAt(), sim.env.now(), '本地局清掉後的計時起點必須是「這一刻」');
  assert.strictEqual(sim.built().length, 0, 'seat 1 才剛起算 grace，不該建局');
});
T('B6 對戰進行中（status playing）grace 計時必須是歸零狀態', () => {
  const sim = makeSim(PAGE, SGMOD, { myUid: 'U2', bothPlayersReady });
  sim.onRoom(R('lobby', false)); sim.onRoom(R('lobby', true));
  sim.adv(300); sim.onRoom(R('playing', true, { id: 'CANON-1' }));
  assert.strictEqual(sim.readyAt(), 0, '房間進入 playing 之後 _onlineReadyAt 必須歸零，實際 ' + sim.readyAt());
});

console.log('\n【C】中央述詞：shouldResetStartGrace 是 shouldAttemptStartGame 四條早退的完全補集');
T('C1 回 true ⇒ shouldAttemptStartGame 對任何 seat／任何 elapsed 都必回 false', () => {
  ok(typeof SGMOD.shouldResetStartGrace === 'function', 'sync-guards 沒有匯出 shouldResetStartGrace');
  let n = 0, resetTrue = 0;
  for (const roomStatus of ['lobby', 'playing', 'ended']) {
    for (const hasGameState of [false, true]) {
      for (const bothReady of [false, true]) {
        for (const haveLocalGame of [false, true]) {
          const o = { roomStatus, hasGameState, bothReady, haveLocalGame };
          const reset = SGMOD.shouldResetStartGrace(o);
          n++;
          if (!reset) continue;
          resetTrue++;
          for (const mySeat of [-1, 0, 1]) {
            for (const readyElapsedMs of [0, 5999, 6000, 999999]) {
              const attempt = SGMOD.shouldAttemptStartGame({ ...o, mySeat, readyElapsedMs });
              assert.strictEqual(attempt, false,
                `歸零卻仍會建局：${JSON.stringify({ ...o, mySeat, readyElapsedMs })}`);
            }
          }
        }
      }
    }
  }
  assert.strictEqual(n, 24, '掃描器壞了？組合數應為 24，實際 ' + n);
  assert.ok(resetTrue >= 20, '掃描器壞了？回 true 的組合太少：' + resetTrue);
});
T('C2 正對照：回 false 的組合恰好就是「lobby ＋無盤面＋雙就緒＋本地無局」', () => {
  let falses = [];
  for (const roomStatus of ['lobby', 'playing', 'ended'])
    for (const hasGameState of [false, true])
      for (const bothReady of [false, true])
        for (const haveLocalGame of [false, true]) {
          const o = { roomStatus, hasGameState, bothReady, haveLocalGame };
          if (!SGMOD.shouldResetStartGrace(o)) falses.push(o);
        }
  assert.strictEqual(falses.length, 1, '回 false 的組合應恰好 1 種，實際 ' + JSON.stringify(falses));
  assert.deepStrictEqual(falses[0],
    { roomStatus: 'lobby', hasGameState: false, bothReady: true, haveLocalGame: false });
});
T('C3 正對照：那一種組合下 seat 0 立刻可建、seat 1 要等滿 6 秒', () => {
  const o = { roomStatus: 'lobby', hasGameState: false, bothReady: true, haveLocalGame: false };
  assert.strictEqual(SGMOD.shouldAttemptStartGame({ ...o, mySeat: 0, readyElapsedMs: 0 }), true);
  assert.strictEqual(SGMOD.shouldAttemptStartGame({ ...o, mySeat: 1, readyElapsedMs: 5999 }), false);
  assert.strictEqual(SGMOD.shouldAttemptStartGame({ ...o, mySeat: 1, readyElapsedMs: 6000 }), true);
});

console.log('\n【D】接線：中央述詞真的被接到兩個消費點，而且順序正確');
T('D1 +page.svelte 有 import shouldResetStartGrace', () => {
  ok(/import\s*\{[^}]*\bshouldResetStartGrace\b[^}]*\}\s*from\s*'\$lib\/game\/sync-guards'/s.test(PAGE),
    '+page.svelte 沒有從 sync-guards import shouldResetStartGrace');
});
T('D2 handleRoomUpdate 內有歸零，且在「lobby ⇒ game = null」之後、建局呼叫之前', () => {
  const h = hruAll(PAGE);
  const iReset = h.indexOf('shouldResetStartGrace(');
  const iNull = h.indexOf('game = null;');
  const iCall = h.indexOf('checkAndStartOnlineGame();');
  ok(iReset > 0, 'handleRoomUpdate 裡沒有呼叫 shouldResetStartGrace');
  ok(iNull > 0 && iNull < iReset, '歸零必須在「房間回到 lobby ⇒ game = null」之後');
  ok(iCall > iReset, '歸零必須在 checkAndStartOnlineGame() 之前，否則等於沒歸零');
  ok(/\}\)\)\s*_onlineReadyAt = 0;/.test(h.slice(iReset, iCall)), '歸零的結果沒有寫回 _onlineReadyAt');
});
T('D3 checkAndStartOnlineGame 內在起算之前先判歸零（haveLocalGame 那條）', () => {
  const c = csgFn(PAGE);
  const iReset = c.indexOf('shouldResetStartGrace(');
  const iStart = c.indexOf('if (_onlineReadyAt === 0) _onlineReadyAt = Date.now();');
  ok(iReset > 0, 'checkAndStartOnlineGame 裡沒有呼叫 shouldResetStartGrace');
  ok(iStart > iReset, '歸零判斷必須在「起算 grace」那一行之前');
  ok(c.slice(iReset, iStart).includes('haveLocalGame: !!game'), '沒有把本地局的狀態餵進去');
});
T('D5 進入／換房時 grace 計時從頭起算（_onlineReadyAt 是 per-page，不跟著房間走）', () => {
  const i = PAGE.indexOf('  function startRoomSubscription() {');
  ok(i > 0, '抓不到 startRoomSubscription');
  const j = PAGE.indexOf('\n  }\n', i); ok(j > i, '抓不到 startRoomSubscription 結尾');
  const body = PAGE.slice(i, j);
  ok(body.includes('_onlineReadyAt = 0;'), 'startRoomSubscription 沒有把 grace 計時歸零');
  ok(body.indexOf('_onlineReadyAt = 0;') < body.indexOf('unsubRoom?.();'),
    '歸零應在重新訂閱之前（同一個進房動作的第一件事）');
});
T('D4 handleRoomUpdate 的歸零用的是這一發 room（不是可能還沒更新的 roomData）', () => {
  const h = hruAll(PAGE);
  const i = h.indexOf('shouldResetStartGrace(');
  const seg = h.slice(i, i + 320);
  ok(seg.includes('roomStatus: room.status'), '應讀這一發 room.status');
  ok(seg.includes('hasGameState: !!room.gameState'), '應讀這一發 room.gameState');
  ok(seg.includes('bothPlayersReady(room.seats)'), '應讀這一發 room.seats');
});

console.log('\n【E】不可破壞：三段收斂邏輯逐字未變（內嵌 sha256，淺複製下也在守）');
function seg(src, a, b, what) {
  const i = src.indexOf(a); ok(i > 0, '抓不到 ' + what + ' 起點');
  const j = src.indexOf(b, i + a.length); ok(j > i, '抓不到 ' + what + ' 終點');
  return src.slice(i, j);
}
T('E1 resolveRoomUpdate 的收斂邏輯零接觸', () => {
  const s = seg(SG, 'export function resolveRoomUpdate(', '\nexport function ', 'resolveRoomUpdate');
  assert.strictEqual(sha(s), '01e66ee6c49ef9c4', 'resolveRoomUpdate 被改動了（本版明訂零接觸）：' + sha(s));
});
T('E2 shouldSkipStalePush 零接觸', () => {
  const s = seg(SG, 'export function shouldSkipStalePush(', '\nexport function ', 'shouldSkipStalePush');
  assert.strictEqual(sha(s), '74a7d17953add946', 'shouldSkipStalePush 被改動了（本版明訂零接觸）：' + sha(s));
});
T('E3 shouldAttemptStartGame 本體零接觸（只在它後面新增述詞）', () => {
  const s = seg(SG, 'export function shouldAttemptStartGame(', '\n}\n', 'shouldAttemptStartGame');
  assert.strictEqual(sha(s), 'fa7cdb3f220d6738', 'shouldAttemptStartGame 被改動了：' + sha(s));
});
T('E4 casual-phantom-adopt 的判定條件零接觸', () => {
  const s = seg(PAGE, '  function _casualNotePhantomAdopt(', '\n  }\n', '_casualNotePhantomAdopt');
  assert.strictEqual(sha(s), '5749ce4e44cc67be', 'casual-phantom-adopt 判定被改動了：' + sha(s));
});

console.log('\n【A】HEAD-FAIL：對真 BASE blob 跑同一組 fixture 必須紅');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【A】對真 BASE blob 的 HEAD-FAIL', '由【F】的突變測試涵蓋同一件事');
} else {
  const bp = readBaseBlob(ROOT, BASE_SHA, PAGE_PATH);
  const bs = readBaseBlob(ROOT, BASE_SHA, SG_PATH);
  T('A1 BASE 的 sync-guards 沒有 shouldResetStartGrace（確認 BASE 抓對了）', () => {
    ok(bp.ok && bs.ok, '讀不到 BASE blob');
    ok(!bs.out.includes('shouldResetStartGrace'), 'BASE 竟然已經有這支函式？BASE_SHA 抓錯了');
  });
  T('A2 BASE：再來一局時 seat 1 會被陳舊 grace 擊穿而立刻建局（原 bug 重現）', () => {
    const baseSG = loadSG(bs.out);
    const r = runRematchScenario(bp.out, baseSG, 'U2', 600000);
    assert.strictEqual(r.afterFirst, 0, 'BASE 第一局也不該建局');
    assert.ok(r.total >= 1, 'BASE 竟然沒重現原 bug —— fixture 沒測到那件事');
    assert.ok(r.built[0].readyMs >= 600000,
      'BASE 的 readyMs 應該是上一局的整場時間，實際 ' + r.built[0].readyMs);
  });
  T('A3 BASE：本地已有局時 grace 不歸零（第二個缺口重現）', () => {
    const baseSG = loadSG(bs.out);
    const sim = makeSim(bp.out, baseSG, { myUid: 'U2', bothPlayersReady });
    sim.setRoom(R('lobby', true)); sim.setGame({ id: 'LOCAL-1' });
    sim.csg();
    assert.notStrictEqual(sim.readyAt(), 0, 'BASE 竟然歸零了？');
  });
}

console.log('\n【F】突變測試（每一條都必須紅在指定那一條）');
mustBreak('F1 拿掉 handleRoomUpdate 的歸零 ⇒ B1 必紅', () => {
  const mut = PAGE.replace(/    if \(shouldResetStartGrace\(\{\n      roomStatus: room\.status[\s\S]*?\}\)\) _onlineReadyAt = 0;\n/, '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const r = runRematchScenario(mut, SGMOD, 'U2', 600000);
  assert.strictEqual(r.total, 0, 'seat 1 在再來一局那一刻建局了');
});
mustBreak('F2 拿掉 checkAndStartOnlineGame 的 haveLocalGame 歸零 ⇒ B5 必紅', () => {
  const mut = PAGE.replace(/    if \(shouldResetStartGrace\(\{ roomStatus: roomData\.status[\s\S]*?haveLocalGame: !!game \}\)\) \{ _onlineReadyAt = 0; return; \}\n/, '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const sim = makeSim(mut, SGMOD, { myUid: 'U2', bothPlayersReady });
  sim.setRoom(R('lobby', true)); sim.setGame({ id: 'LOCAL-1' });
  sim.csg();
  assert.strictEqual(sim.readyAt(), 0, 'haveLocalGame 擋下時 _onlineReadyAt 必須歸零');
});
mustBreak('F3 把述詞改成永遠不歸零 ⇒ B1 必紅', () => {
  const mut = SG.replace(
    "  return opts.roomStatus !== 'lobby' || opts.hasGameState || !opts.bothReady || opts.haveLocalGame;",
    '  return false;');
  assert.notStrictEqual(mut, SG, '突變沒生效');
  const r = runRematchScenario(PAGE, loadSG(mut), 'U2', 600000);
  assert.strictEqual(r.total, 0, 'seat 1 在再來一局那一刻建局了');
});
mustBreak('F4 把述詞改成永遠歸零 ⇒ B3 的 fallback 正對照必紅', () => {
  const mut = SG.replace(
    "  return opts.roomStatus !== 'lobby' || opts.hasGameState || !opts.bothReady || opts.haveLocalGame;",
    '  return true;');
  assert.notStrictEqual(mut, SG, '突變沒生效');
  const sim = makeSim(PAGE, loadSG(mut), { myUid: 'U2', bothPlayersReady });
  sim.onRoom(R('lobby', false)); sim.onRoom(R('lobby', true));
  sim.adv(6500); sim.onRoom(R('lobby', true));
  assert.strictEqual(sim.built().length, 1, 'P2 的 6 秒 fallback 被關掉了');
});
mustBreak('F5 把 P2 的 grace 從 6000 改成 0 ⇒ B1 必紅（守衛真的在看 grace）', () => {
  const mut = SG.replace('opts.readyElapsedMs >= (opts.fallbackGraceMs ?? 6000)',
    'opts.readyElapsedMs >= (opts.fallbackGraceMs ?? 0)');
  assert.notStrictEqual(mut, SG, '突變沒生效');
  const r = runRematchScenario(PAGE, loadSG(mut), 'U2', 600000);
  assert.strictEqual(r.total, 0, 'seat 1 在再來一局那一刻建局了');
});
mustBreak('F6 把歸零挪到建局呼叫之後 ⇒ D2 的順序斷言必紅', () => {
  const m = /    if \(shouldResetStartGrace\(\{\n      roomStatus: room\.status[\s\S]*?\}\)\) _onlineReadyAt = 0;\n/.exec(PAGE);
  assert.ok(m, '突變沒生效');
  const mut = PAGE.replace(m[0], '') .replace('      checkAndStartOnlineGame();\n', '      checkAndStartOnlineGame();\n' + m[0]);
  const h = hruAll(mut);
  const iReset = h.indexOf('shouldResetStartGrace(');
  const iCall = h.indexOf('checkAndStartOnlineGame();');
  ok(iReset > 0, 'handleRoomUpdate 裡沒有呼叫 shouldResetStartGrace');
  ok(iCall > iReset, '歸零必須在 checkAndStartOnlineGame() 之前，否則等於沒歸零');
});

mustBreak('F7 拿掉 startRoomSubscription 的歸零 ⇒ D5 必紅', () => {
  const mut = PAGE.replace(/    \/\/ ⭐v6\.274：進入／換一間房[\s\S]*?    _onlineReadyAt = 0;\n/, '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const i = mut.indexOf('  function startRoomSubscription() {');
  const j = mut.indexOf('\n  }\n', i);
  const body = mut.slice(i, j);
  ok(body.includes('_onlineReadyAt = 0;'), 'startRoomSubscription 沒有把 grace 計時歸零');
});

console.log('\n【G】守衛自己要在 test chain 裡（iron-rules-audit 是 continue-on-error，擋不了 deploy）');
T('G1 package.json 的 test chain 有這一支', () => {
  ok(String(PKG.scripts.test).includes('test-v6274-start-grace-reset.mjs'),
    'package.json 的 test chain 沒有 test-v6274-start-grace-reset.mjs');
});

console.log(`\nv6.274 grace 歸零守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
