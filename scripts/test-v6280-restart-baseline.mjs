// v6.280 守衛 —— 幻影 setup 防護的門檻（`lastAdoptedRestartCount`）換房沒重設
//
// ── 這一版在修什麼（線上實測，不是推論）──────────────────────────────────
// 2026-08-31 16:52 房 PVK8，同一秒鐘兩位玩家的指紋互為直接證據：
//   ・玩家 I（seat 0）：`phase=playing turn=4 logLen=101`，`casual-phantom-adopt`
//     帶 `won:true / readyMs:1 / Δ createdAtSrv = +332,516ms`；
//   ・對手（seat 1）：早 687ms 送出 `casual-forfeit-claim`，`board{phase:setup, turn:1,
//     logLen:4}`、`claim{granted:true, idleSec:90}`。
//   ⇒ 兩人當下在**兩局不同的局**裡：一個凍在舊局的第 4 回合，一個已經在新的 setup 局裡等滿 90 秒。
//
// 機制：對手在對局中發起「重新開局」→ `room-oracle.checkAndAcceptRestart` 在 status 仍
// `playing` 時把房間 gameState 換成新的 setup 局。玩家 I 的 client 被 `resolveRoomUpdate`
// 的 `phantom-setup` 防護反覆 reject ⇒ 畫面凍在 turn 4；對手在新局裡滿足 `_waitingOnOpp`
// 的 setup 分支 ⇒ 90 秒後 `claimOpponentForfeit` granted ⇒ 房間寫進 game-over。
// 玩家 I 這次收到「不同 id ＋ game-over」⇒ phantom 防護不適用（它只擋 `phase==='setup'`）
// ⇒ 直接 adopt ⇒ **盤面被換掉、而且他已經輸了**。
//
// 必要條件（本守衛【B】逐步重現）：`lastAdoptedRestartCount` 是 **per-page** 的變數，
// 卻承載 **per-room** 的語意 —— 而且 `seat 0` 是 v5.749 的指定建局者
// （建局 commit 成功直接 `game = _pendingGame`，**不經過 adopt**）⇒ 換到新房之後
// 那個門檻永遠不會被重寫 ⇒ 新房的第一次 restart（count 1）必然被 `1 <= 1` 擋掉。
//
// ── 這支守衛的紀律（本專案已連續踩到十種「守衛安慰劑」）────────────────────
//   ・【B】是**行為端**：把 `+page.svelte` 的 `startRoomSubscription` 重設段、
//     `handleRoomUpdate` 的門檻重設段與 decision switch **原文抽出來、esbuild 轉譯、真的執行**，
//     再用「A 房重新開局 → 換到 B 房 → 對手在對局中 restart → 對手宣告棄權」整串驅動它。
//     抽取器對 BASE／HEAD 都適用 ⇒ 【A】拿真 BASE blob 跑同一組 fixture **必須紅**。
//   ・【C】純述詞的判準（含 fail-closed 兩條）。
//   ・【D】接線＋**枚舉**：`lastAdoptedRestartCount` 的寫入點恰為 2 個、順序在 resolveRoomUpdate 之前。
//   ・【E】不可破壞：`resolveRoomUpdate` / `shouldSkipStalePush` 以內嵌 sha256 錨定
//     （history-free ⇒ 淺複製下仍然真的在守）。
//   ・【F】指紋：新欄位**行為端**驗證，並枚舉「送出點數量」證明零額外請求。
//   ・【G】突變測試：每一條主張都要能被弄紅。
//   ・只捕捉 assert.AssertionError（其他例外一律炸出來）。
// Run: node scripts/test-v6280-restart-baseline.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
/** 突變測試：跑起來**必須**紅在指定那一條。沒紅 ⇒ 這條守衛是安慰劑。 */
function mustBreak(name, run) {
  let red = null;
  try { run(); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = e.message.split('\n')[0].slice(0, 92); }
  if (red !== null) { console.log('  OK   ' + name + '（如預期紅：' + red + '）'); pass++; return; }
  console.log('  FAIL ' + name + ' :: 突變後竟然還是綠的 —— 這條守衛沒有在守');
  fail++;
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
function balanced(s) { let d = 0; for (const c of s) { if (c === '{') d++; else if (c === '}') d--; } return d; }

// ══════════════════════════════════════════════════════════════════════════
// 抽取器（Rule 25：掃描器自己要先被驗；每一段都有下限斷言＋括號配對檢查）
// ══════════════════════════════════════════════════════════════════════════
const A_SUB = '  function startRoomSubscription() {';
const A_SUB_END = '    unsubRoom?.();';
const A_SEED = '    roomData = room;\n';
const A_SEED_END = '    (globalThis as any).__ptcgLB = ';
const A_DEC = '      const decision = resolveRoomUpdate(game, incoming, {';
const A_DEC_END = '        default:\n          return;\n      }\n';
const A_NOTE = '  function _casualNotePhantomAdopt(';
const A_NOTE_END = "      _tSendClientDiag('casual-phantom-adopt');\n    } catch { /* 診斷絕不影響對戰 */ }\n  }\n";
const A_PAY = "      phantom: (reason === 'casual-phantom-adopt' && _casualPhantom";
const A_PAY_END = '\n        : null),\n';

/** `startRoomSubscription()` 的**前綴**（＝所有「進房重設」的敘述列）。BASE 抽到的就是 BASE 的行為。 */
function subResetBlock(src) {
  const i = src.indexOf(A_SUB); ok(i > 0, '抓不到 startRoomSubscription 起點');
  const j = src.indexOf(A_SUB_END, i); ok(j > i, '抓不到 startRoomSubscription 的 unsubRoom 錨點');
  const blk = src.slice(i + A_SUB.length, j);
  ok(blk.includes('_onlineReadyAt = 0;'), 'startRoomSubscription 前綴抽錯了（沒有 v6.274 的 grace 歸零）');
  ok(balanced(blk) === 0, 'startRoomSubscription 前綴括號沒配對（抽取器壞了）');
  return blk;
}

/** `handleRoomUpdate` 開頭「roomData = room;」到麵包屑之間（＝門檻重設段；BASE 只有一行）。 */
function seedBlock(src) {
  const i = src.indexOf(A_SEED); ok(i > 0, '抓不到 handleRoomUpdate 的 roomData = room 錨點');
  const j = src.indexOf(A_SEED_END, i); ok(j > i, '抓不到 v5.350 卡頓麵包屑錨點');
  const blk = src.slice(i, j);
  ok(blk.includes('roomData = room;'), '門檻重設段抽錯了');
  ok(balanced(blk) === 0, '門檻重設段括號沒配對（抽取器壞了）: ' + balanced(blk));
  return blk;
}

/** `resolveRoomUpdate` 呼叫 ＋ 整個 decision switch（版本無關）。 */
function decisionBlock(src) {
  const i = src.indexOf(A_DEC); ok(i > 0, '抓不到 resolveRoomUpdate 呼叫錨點');
  const j = src.indexOf(A_DEC_END, i); ok(j > i, '抓不到 decision switch 結尾錨點');
  const blk = src.slice(i, j + A_DEC_END.length);
  ok(blk.includes("case 'adopt':") && blk.includes("case 'reject':"), 'decision switch 抽錯了');
  ok(balanced(blk) === 0, 'decision switch 括號沒配對（抽取器壞了）: ' + balanced(blk));
  return blk;
}

/** `_casualNotePhantomAdopt()` 全文（指紋的唯一判定點）。 */
function noteFn(src) {
  const i = src.indexOf(A_NOTE); ok(i > 0, '抓不到 _casualNotePhantomAdopt');
  const j = src.indexOf(A_NOTE_END, i); ok(j > i, '抓不到 _casualNotePhantomAdopt 結尾');
  const blk = src.slice(i, j + A_NOTE_END.length);
  ok(blk.includes('_casualPhantom = {'), '_casualNotePhantomAdopt 抽錯了');
  ok(balanced(blk) === 0, '_casualNotePhantomAdopt 括號沒配對（抽取器壞了）: ' + balanced(blk));
  return blk;
}

/** payload 裡的 `phantom:` 那一個欄位（含 v6.280 新欄位）。 */
function phantomField(src) {
  const i = src.indexOf(A_PAY); ok(i > 0, '抓不到 payload 的 phantom 欄位');
  const j = src.indexOf(A_PAY_END, i); ok(j > i, '抓不到 phantom 欄位結尾');
  const blk = src.slice(i, j + A_PAY_END.length);
  ok(blk.includes('_startGameWon'), 'phantom 欄位抽錯了');
  ok(balanced(blk) === 0, 'phantom 欄位括號沒配對（抽取器壞了）: ' + balanced(blk));
  return blk;
}

// ══════════════════════════════════════════════════════════════════════════
// 行為端 harness：把上面五段真的組起來執行
// ══════════════════════════════════════════════════════════════════════════
function loadSG(srcText) {
  const code = transformSync(srcText, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const mod = { exports: {} };
  // sync-guards 只 import 引擎的兩支開局收尾 helper（merge-setup 路徑會用到）。
  // 這裡給恆等函式即可 —— 本守衛量的是「決策」，不是引擎內部。
  const req = () => new Proxy({}, { get: () => (x) => x });
  new Function('module', 'exports', 'require', code)(mod, mod.exports, req);
  return mod.exports;
}

function makeSim(src, sgMod, opts = {}) {
  const frag = [
    'function enterRoom(code) {',
    '  game = null; roomData = null; roomCode = code;',   // leaveOnlineGame / handleJoinRoom 的既有行為
    subResetBlock(src),
    '}',
    'function onRoom(room) {',
    seedBlock(src),
    '  const incoming = room.gameState;',
    '  const _sfxPrevGame = game;',
    '  const _emitCasualSfx = () => {};',
    '  if (!incoming) return;',
    decisionBlock(src),
    '}',
    noteFn(src),
    'function buildPhantomPayload(reason) {',
    '  return ({',
    phantomField(src),
    '  }).phantom;',
    '}',
  ].join('\n');
  let js;
  try { js = transformSync(frag, { loader: 'ts', target: 'node18' }).code; }
  catch (e) { throw new assert.AssertionError({ message: '抽出來的片段轉譯失敗：' + e.message }); }

  const prologue = `
  let game = null, roomData = null, roomCode = '', myPlayerIndex = ${opts.myPlayerIndex === null ? 'null' : String(opts.myPlayerIndex ?? 0)};
  let lastAdoptedRestartCount = 0, _restartBaselineRoom = null;
  let lastSeenUndoApplyAt = 0, _activeGameId = null, _onlineReadyAt = 0;
  let _unpushedState = null, _repushAttempts = 0, undoSnapshot = null, undoActionDesc = null;
  let undoAwaitingResponse = false, undoDeniedThisSnapshot = false;
  let floatingEvoMenu = null, floatingRetreatMenu = null, selectedEnergyIid = null;
  let prizeAnimKey = [0, 0], arrivingIids = new Set(), justArrivedIids = new Set();
  let _casualPhantom = null, _casualPhantomSent = false;
  let _rejPhantomSetup = 0, _startGameCalls = 0;
  let _startGameWon = null, _startGameReadyMs = -1;
  const pool = new Map();
  const { resolveRoomUpdate } = env.sg;
  const nextRestartBaseline = env.sg.nextRestartBaseline;   // BASE 沒有這支 ⇒ undefined（BASE 的碼也不會呼叫它）
  const unsubRoom = null, unsubMessages = null;
  const subscribeRoom = () => null, subscribeMessages = () => null;
  const startHeartbeat = () => {};
  const setTimeout = (fn) => 0;
  const document = { visibilityState: env.vis };
  const pushTracked = () => Promise.resolve();
  const tryPromoteToMainForFestival = (g) => g;
  const _tSendClientDiag = (r) => { env.sent.push(r); env.payloads.push(buildPhantomPayload(r)); };
  const console = { log() {}, warn(a, b) { env.warns.push(String(b)); }, error() {} };
  `;
  const epilogue = `
  return {
    enterRoom, onRoom,
    setGame: (g) => { game = g; },
    getGame: () => game,
    lastAdopted: () => lastAdoptedRestartCount,
    baselineRoom: () => _restartBaselineRoom,
    rejCount: () => _rejPhantomSetup,
    // BASE 沒有 _rejPhantomSetup 這個欄位 ⇒ 跨版本的判準一律用 console.warn 的原文
    //   （[Online] reject snapshot: phantom-setup），那一行 BASE／HEAD 逐字相同。
    rejWarns: () => env.warns.filter((w) => w === 'phantom-setup').length,
    bumpStartGameCalls: () => { _startGameCalls++; },
  };`;
  const env = { sg: sgMod, sent: [], payloads: [], warns: [], vis: opts.vis ?? 'visible' };
  let api;
  try { api = new Function('env', prologue + js + epilogue)(env); }
  catch (e) { throw new assert.AssertionError({ message: 'harness 載不起來：' + e.message }); }
  return { ...api, env };
}

const SGMOD = loadSG(SG);

// ── fixture：房間更新 ──────────────────────────────────────────────────────
let _srvClock = 1000000;
const G = (id, phase, extra = {}) => ({
  id, phase, turn: 1, log: [], createdAt: (_srvClock += 1000), createdAtSrv: _srvClock,
  players: [{ hand: [] }, { hand: [] }],
  setupDone: [false, false], mulliganRevealConfirmed: [true, true],
  pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false],
  pendingPrizes: [0, 0], ...extra,
});
const R = (status, restartCount, gs) => ({
  status, restartProposalCount: restartCount, gameState: gs ?? null,
  seats: [{ uid: 'U1' }, { uid: 'U2' }], restartProposed: {}, rematchReady: {},
});

/**
 * ⭐⭐⭐ D 的完整情境（seat 0）：
 *   ① A 房：seat 0 自己建局（不經 adopt）→ 對手提議重新開局 → 雙方同意 → adopt 新 setup 局
 *      ⇒ 這一步把 `lastAdoptedRestartCount` 墊到 1（**唯一**的寫入點）。
 *   ② 換到 B 房（leaveOnlineGame 清 game/roomData → handleJoinRoom → startRoomSubscription）。
 *   ③ B 房：seat 0 又是自己建局（不經 adopt）⇒ BASE 上門檻仍是 1。
 *   ④ 對手在**對局中**發起重新開局 ⇒ 房間 restartProposalCount 1、gameState 換成新的 setup 局。
 *   ⑤ 對手在新局裡等滿閒置秒數 ⇒ 伺服器寫進 game-over（不同 id、winner = 對手）。
 */
function runScenarioD(src, sgMod) {
  const sim = makeSim(src, sgMod, { myPlayerIndex: 0 });
  // ⭐ 逐發記錄「這一發之後，本地的局 id 有沒有跟上房間的局 id」。
  //   凍住的症狀就是這裡開始長期不一致（BASE：從 B 房的 restart 那一發起一直分歧）。
  const drift = [];
  const _onRoom = sim.onRoom;
  sim.onRoom = (room) => {
    _onRoom(room);
    if (room.gameState) drift.push(sim.getGame()?.id === room.gameState.id);
  };

  // ① A 房
  sim.enterRoom('AAAA');
  sim.onRoom(R('lobby', 0, null));
  const a1 = G('A-GAME-1', 'playing');
  sim.setGame(a1);                                     // seat 0 建局：直接 game = _pendingGame
  sim.onRoom(R('playing', 0, a1));
  const a2 = G('A-GAME-2', 'setup');                   // A 房的重新開局
  sim.onRoom(R('playing', 1, a2));
  const afterA = { adopted: sim.getGame()?.id, lastAdopted: sim.lastAdopted() };

  // ② 換到 B 房
  sim.enterRoom('PVK8');
  sim.onRoom(R('lobby', 0, null));

  // ③ B 房：seat 0 自己建局
  const b1 = G('B-GAME-1', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(b1);
  sim.onRoom(R('playing', 0, b1));

  // ④ 對手在對局中「重新開局」
  const b2 = G('B-GAME-2', 'setup', { turn: 1, log: new Array(4).fill('x') });
  sim.onRoom(R('playing', 1, b2));
  sim.onRoom(R('playing', 1, b2));                     // 輪詢會再送好幾發
  sim.onRoom(R('playing', 1, b2));
  const afterRestart = { id: sim.getGame()?.id, phase: sim.getGame()?.phase, rej: sim.rejWarns() };

  // ⑤ 對手宣告棄權 ⇒ 房間變成 game-over
  const b3 = { ...b2, id: 'B-GAME-3', phase: 'game-over', winner: 1, log: new Array(6).fill('x') };
  sim.onRoom(R('ended', 1, b3));
  const final = { id: sim.getGame()?.id, phase: sim.getGame()?.phase, winner: sim.getGame()?.winner };
  return { sim, afterA, afterRestart, final, driftCount: drift.filter((x) => !x).length, drift };
}

console.log('\n【B】行為端：抽 +page.svelte 原文執行「A 房重新開局 → 換 B 房 → B 房重新開局」');
T('B1 A 房的重新開局照樣採納（既有行為沒被動到）', () => {
  const r = runScenarioD(PAGE, SGMOD);
  assert.strictEqual(r.afterA.adopted, 'A-GAME-2', 'A 房的 restart 應該被採納');
  assert.strictEqual(r.afterA.lastAdopted, 1, 'adopt setup 局之後門檻應記成 1');
});
T('B2 ⭐⭐⭐ 換到 B 房後，B 房的第一次重新開局必須被採納（不可凍在舊局）', () => {
  const r = runScenarioD(PAGE, SGMOD);
  assert.strictEqual(r.afterRestart.rej, 0,
    `B 房的重新開局被 phantom-setup 擋了 ${r.afterRestart.rej} 次 —— 玩家的畫面凍在上一局`);
  assert.strictEqual(r.afterRestart.id, 'B-GAME-2',
    `B 房重新開局後本地局應是 B-GAME-2，實際 ${r.afterRestart.id}（＝凍住了）`);
});
T('B3 ⭐⭐⭐ 整串更新裡本地從來沒有與房間分歧（＝畫面沒有任何一刻是凍住的）', () => {
  const r = runScenarioD(PAGE, SGMOD);
  assert.strictEqual(r.driftCount, 0,
    `有 ${r.driftCount} 發更新之後本地的局與房間的局不同（逐發：${JSON.stringify(r.drift)}）`
    + ' —— 那就是玩家看到的「凍住」；對手正是在這段期間把閒置秒數等滿的');
});
T('B4 換房之後門檻確實跟著新房重設（記在新房號上）', () => {
  const r = runScenarioD(PAGE, SGMOD);
  assert.strictEqual(r.sim.baselineRoom(), 'PVK8', '門檻應該登記在 B 房，實際 ' + r.sim.baselineRoom());
});

console.log('\n【B-正對照】真正的幻影 setup 局仍然被擋（防護沒有被關掉）');
/** 開局 createGame race 殘留的幻影 setup 局：restartProposalCount 完全沒有動過。 */
function runPhantomRace(src, sgMod) {
  const sim = makeSim(src, sgMod, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8');
  sim.onRoom(R('lobby', 0, null));
  const g1 = G('CANON', 'playing', { turn: 3, log: new Array(40).fill('x') });
  sim.setGame(g1);
  sim.onRoom(R('playing', 0, g1));
  const ghost = G('GHOST', 'setup');
  sim.onRoom(R('playing', 0, ghost));   // ⚠ restartProposalCount 仍是 0
  return sim;
}
T('P-a ⭐⭐⭐ 沒有 restart 的幻影 setup 局照樣被 reject（本版最重要的正對照）', () => {
  const sim = runPhantomRace(PAGE, SGMOD);
  assert.strictEqual(sim.getGame()?.id, 'CANON', '幻影 setup 局竟然被採納了 —— 防護被關掉了');
  // ⚠ 用 console.warn 的原文計數（BASE／HEAD 都有）—— 拿 HEAD 才有的 _rejPhantomSetup
  //   當判準會讓這條正對照在 BASE 上變成假紅，掩蓋「防護本來就在」這件事。
  assert.strictEqual(sim.rejWarns(), 1, '應該記到 1 次 phantom-setup 拒收，實際 ' + sim.rejWarns());
});
T('P-a2 ⭐ 重整回同一間房（count 已是 2）之後，count 2 的幻影局仍被擋（不是 fail-open 設 0）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8');
  sim.onRoom(R('playing', 2, null));                 // 重整後第一發：房間已經 restart 過兩次
  const g1 = G('CANON', 'playing', { turn: 3, log: new Array(40).fill('x') });
  sim.setGame(g1);
  assert.strictEqual(sim.lastAdopted(), 2,
    '重整回房時門檻應該對齊房間當下的 restartProposalCount（設 0 是 fail-open），實際 ' + sim.lastAdopted());
  sim.onRoom(R('playing', 2, G('GHOST', 'setup')));
  assert.strictEqual(sim.getGame()?.id, 'CANON', 'count 2 的幻影 setup 局竟然被採納了（fail-open）');
});
T('P-b ⭐ roomCode 還不知道時 fail-closed 保留舊值（不是設 0）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('AAAA');
  sim.onRoom(R('playing', 3, null));
  assert.strictEqual(sim.lastAdopted(), 3, 'A 房的門檻應是 3');
  sim.enterRoom('');                                  // 房號未知
  sim.onRoom(R('playing', 0, null));
  assert.strictEqual(sim.lastAdopted(), 3,
    '房號未知時必須保留舊值（fail-closed），實際被改成 ' + sim.lastAdopted());
  assert.strictEqual(sim.baselineRoom(), null, '房號未知時不可以把 baselineRoom 認成某一間房');
});
T('P-c ⭐ 同一間房的後續更新不會把 adopt 記下的門檻洗掉（只重設一次）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8');
  sim.onRoom(R('lobby', 0, null));
  const g1 = G('CANON', 'playing', { turn: 2, log: new Array(20).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('playing', 1, G('NEW', 'setup')));     // 合法 restart → adopt → 門檻記成 1
  assert.strictEqual(sim.getGame()?.id, 'NEW',
    '合法的重新開局沒有被採納（實際 ' + sim.getGame()?.id + '）—— 重設寫成「每一發都重設」就會這樣：'
    + '門檻在同一發被先拉到房間的新 count，resolveRoomUpdate 再看就永遠是 count <= 門檻');
  assert.strictEqual(sim.lastAdopted(), 1, 'adopt 之後門檻應是 1');
  sim.onRoom(R('playing', 1, sim.getGame()));         // 同一間房的下一發
  assert.strictEqual(sim.lastAdopted(), 1, '同一間房的後續更新竟然把門檻洗掉了，實際 ' + sim.lastAdopted());
});
T('P-d ⭐ 正常對局（沒換房、沒 restart）逐發行為不變：不 reject、不改門檻', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8');
  sim.onRoom(R('lobby', 0, null));
  const g = G('CANON', 'playing', { turn: 1, log: [] });
  sim.setGame(g);
  for (let i = 1; i <= 40; i++) {
    const nx = { ...g, turn: i, log: new Array(i * 2).fill('x') };
    sim.onRoom(R('playing', 0, nx));
    assert.strictEqual(sim.getGame()?.id, 'CANON', '第 ' + i + ' 發竟然換局了');
  }
  assert.strictEqual(sim.rejCount(), 0, '正常對局不該有任何 phantom-setup 拒收');
  assert.strictEqual(sim.lastAdopted(), 0, '正常對局門檻應維持 0');
  assert.strictEqual(sim.env.sent.length, 0, '正常對局不該送出任何診斷（實際 ' + sim.env.sent.length + ' 發）');
});

console.log('\n【C】中央純述詞 nextRestartBaseline 的判準');
T('C1 sync-guards 有匯出 nextRestartBaseline', () => {
  ok(typeof SGMOD.nextRestartBaseline === 'function', 'sync-guards 沒有匯出 nextRestartBaseline');
});
T('C2 換房 ⇒ 用新房伺服器端的 restartProposalCount 當基準（不是 0）', () => {
  const r = SGMOD.nextRestartBaseline({ baselineRoom: 'AAAA', roomCode: 'PVK8', roomRestartCount: 2, lastAdoptedRestartCount: 5 });
  assert.strictEqual(r.baselineRoom, 'PVK8');
  assert.strictEqual(r.lastAdoptedRestartCount, 2, '應對齊新房的 count');
});
T('C3 同房 ⇒ 原值一個字都不動', () => {
  const r = SGMOD.nextRestartBaseline({ baselineRoom: 'PVK8', roomCode: 'PVK8', roomRestartCount: 9, lastAdoptedRestartCount: 3 });
  assert.strictEqual(r.baselineRoom, 'PVK8');
  assert.strictEqual(r.lastAdoptedRestartCount, 3);
});
T('C4 fail-closed：roomCode 空 ⇒ 保留舊值', () => {
  const r = SGMOD.nextRestartBaseline({ baselineRoom: null, roomCode: '', roomRestartCount: 0, lastAdoptedRestartCount: 7 });
  assert.strictEqual(r.lastAdoptedRestartCount, 7, '房號未知時不可以改門檻');
  assert.strictEqual(r.baselineRoom, null);
});
T('C5 fail-closed：roomRestartCount 不是有限數 ⇒ 保留舊值', () => {
  for (const bad of [undefined, null, NaN, Infinity, 'x']) {
    const r = SGMOD.nextRestartBaseline({ baselineRoom: null, roomCode: 'PVK8', roomRestartCount: bad, lastAdoptedRestartCount: 4 });
    assert.strictEqual(r.lastAdoptedRestartCount, 4, 'roomRestartCount=' + String(bad) + ' 時不可以改門檻');
    assert.strictEqual(r.baselineRoom, null, 'roomRestartCount=' + String(bad) + ' 時不可以認房');
  }
});
T('C6 純函式：不改入參、同輸入同輸出', () => {
  const inp = { baselineRoom: 'A', roomCode: 'B', roomRestartCount: 1, lastAdoptedRestartCount: 9 };
  const snap = JSON.stringify(inp);
  const a = SGMOD.nextRestartBaseline(inp), b = SGMOD.nextRestartBaseline(inp);
  assert.strictEqual(JSON.stringify(inp), snap, 'nextRestartBaseline 改到了入參');
  assert.deepStrictEqual(a, b);
});

console.log('\n【D】接線＋枚舉：門檻的寫入點與順序');
T('D1 `lastAdoptedRestartCount` 的**寫入點恰為 2 個**（adopt 路徑＋本版的重設）', () => {
  const all = [...PAGE.matchAll(/(let\s+)?lastAdoptedRestartCount\s*=(?!=)/g)];
  const decl = all.filter((m) => m[1]);
  const writes = all.filter((m) => !m[1]);
  assert.strictEqual(decl.length, 1, '宣告應恰為 1 處，實際 ' + decl.length);
  assert.strictEqual(writes.length, 2,
    '寫入點應恰為 2 個（adopt 路徑＋本版的重設；多出來的一定要有理由），實際 ' + writes.length);
});
T('D2 重設必須走中央述詞 nextRestartBaseline（不可以在頁面裡另寫一份條件）', () => {
  ok(PAGE.includes('nextRestartBaseline({'), '+page.svelte 沒有呼叫 nextRestartBaseline');
  ok(/import\s*\{[^}]*nextRestartBaseline[^}]*\}\s*from\s*'\$lib\/game\/sync-guards'/s.test(PAGE),
    'nextRestartBaseline 沒有從 sync-guards import（＝另外抄了一份）');
});
T('D3 ⭐ 重設必須在 resolveRoomUpdate **之前**（晚一步等於這一發還是用舊門檻）', () => {
  const seed = PAGE.indexOf('nextRestartBaseline({');
  const dec = PAGE.indexOf('const decision = resolveRoomUpdate(');
  ok(seed > 0 && dec > 0, '抓不到兩個錨點');
  ok(seed < dec, '門檻重設竟然排在 resolveRoomUpdate 之後 —— 等於沒重設');
});
T('D4 ⭐ `startRoomSubscription()` 必須把 baselineRoom 標成未知（重新訂閱同一間房也要重來）', () => {
  const blk = subResetBlock(PAGE);
  ok(/_restartBaselineRoom\s*=\s*null\s*;/.test(blk),
    'startRoomSubscription 沒有重設 _restartBaselineRoom —— 重整回同一間房會沿用陳舊門檻');
});
T('D5 ⭐ `startRoomSubscription()` 裡**不可以**直接把門檻設成 0（那是 fail-open）', () => {
  const blk = subResetBlock(PAGE);
  ok(!/lastAdoptedRestartCount\s*=\s*0/.test(blk),
    'startRoomSubscription 把門檻直接設 0 了 —— 之後任何幻影 setup 局都會被放行');
});
T('D6 v6.274 的 `_onlineReadyAt = 0` 仍在同一段（沒有被本版擠掉）', () => {
  ok(/_onlineReadyAt\s*=\s*0\s*;/.test(subResetBlock(PAGE)), 'v6.274 的 grace 歸零不見了');
});

console.log('\n【E】不可破壞：收斂邏輯以內嵌 sha256 錨定（history-free，淺複製下仍在守）');
function fnBody(src, sig, endSig) {
  const i = src.indexOf(sig); ok(i > 0, '抓不到 ' + sig);
  const j = src.indexOf(endSig, i); ok(j > i, '抓不到 ' + sig + ' 的結尾');
  return src.slice(i, j);
}
T('E1 resolveRoomUpdate 一個字都沒有動', () => {
  const body = fnBody(SG, 'export function resolveRoomUpdate(', '\nexport function mergeSetupMonotonic(');
  assert.strictEqual(sha(body), '01e66ee6c49ef9c4',
    'resolveRoomUpdate 被改了（本版明令零接觸）—— 實際 ' + sha(body));
});
T('E2 shouldSkipStalePush 一個字都沒有動', () => {
  const body = fnBody(SG, 'export function shouldSkipStalePush(', '\n/**');
  assert.strictEqual(sha(body), '6c9264e113f3e084',
    'shouldSkipStalePush 被改了（站長還沒裁定）—— 實際 ' + sha(body));
});
T('E3 phantom 防護的判準條文逐字未變（只擋 incoming.phase===setup）', () => {
  ok(SG.includes("if (local.phase === 'playing'\n        && incoming.phase === 'setup'\n"
    + "        && (ctx.roomRestartCount ?? 0) <= (ctx.lastAdoptedRestartCount ?? 0)) {"),
    'phantom 防護的條文被改了 —— 本版只動門檻的來源，不動判準');
});

console.log('\n【F】指紋：新欄位行為端驗證＋零額外請求');
T('F1 ⭐ localId/incomingId 的前 8 碼真的送得出去（v6.265 已存、只差送出）', () => {
  const sim = runPhantomRace(PAGE, SGMOD);            // 幻影局被擋 ⇒ 不會發指紋
  assert.strictEqual(sim.env.sent.length, 0, '被 reject 的路徑不該發指紋');
  const sim2 = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim2.enterRoom('PVK8'); sim2.onRoom(R('lobby', 0, null));
  const g1 = G('LOCAL-1234567890', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim2.setGame(g1); sim2.onRoom(R('playing', 0, g1));
  const g2 = { ...G('INCOM-0987654321', 'game-over'), winner: 1, turn: 9, log: new Array(6).fill('x') };
  sim2.onRoom(R('ended', 0, g2));
  assert.deepStrictEqual(sim2.env.sent, ['casual-phantom-adopt'], '應該送出一發 casual-phantom-adopt');
  const p = sim2.env.payloads[0];
  assert.strictEqual(p.localId8, 'LOCAL-12', 'localId8 應是前 8 碼，實際 ' + p.localId8);
  assert.strictEqual(p.incomingId8, 'INCOM-09', 'incomingId8 應是前 8 碼，實際 ' + p.incomingId8);
});
T('F2 ⭐⭐ incPhase/incTurn/incLogLen/incWinner 能直接坐實「換進來的是 game-over」', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 0, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  const g2 = { ...G('I', 'game-over'), winner: 1, turn: 9, log: new Array(6).fill('x') };
  sim.onRoom(R('ended', 0, g2));
  const p = sim.env.payloads[0];
  assert.strictEqual(p.incPhase, 'game-over', 'incPhase 錯：' + p.incPhase);
  assert.strictEqual(p.incTurn, 9, 'incTurn 錯：' + p.incTurn);
  assert.strictEqual(p.incLogLen, 6, 'incLogLen 錯：' + p.incLogLen);
  assert.strictEqual(p.incWinner, 1, 'incWinner 錯：' + p.incWinner);
});
T('F3 ⭐ roomStatus/restartCount/lastAdopted 帶得出來（判得出「門檻帶著舊房的值」）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 3, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 3, g1));
  sim.onRoom(R('ended', 3, { ...G('I', 'game-over'), winner: 1 }));
  const p = sim.env.payloads[0];
  assert.strictEqual(p.roomStatus, 'ended', 'roomStatus 錯：' + p.roomStatus);
  assert.strictEqual(p.restartCount, 3, 'restartCount 錯：' + p.restartCount);
  assert.strictEqual(p.lastAdopted, 3, 'lastAdopted 錯：' + p.lastAdopted);
});
T('F4 ⭐ rejPhantomSetup 累計得出來（＞0 ＝畫面曾經凍住）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 0, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('playing', 0, G('GHOST1', 'setup')));
  sim.onRoom(R('playing', 0, G('GHOST2', 'setup')));
  assert.strictEqual(sim.rejCount(), 2, '應累計 2 次，實際 ' + sim.rejCount());
  sim.onRoom(R('ended', 0, { ...G('I', 'game-over'), winner: 1 }));
  assert.strictEqual(sim.env.payloads[0].rejPhantomSetup, 2,
    'rejPhantomSetup 沒送出來：' + sim.env.payloads[0].rejPhantomSetup);
});
T('F5 ⭐ benign=spectator 是**標記**不是排除（觀戰者的那一發照樣要送）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: null });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 0, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('ended', 0, { ...G('I', 'game-over'), winner: 1 }));
  assert.strictEqual(sim.env.sent.length, 1, '觀戰者的指紋被丟掉了 —— 分母會不誠實');
  assert.strictEqual(sim.env.payloads[0].benign, 'spectator', 'benign 沒標成 spectator');
  const sim2 = makeSim(PAGE, SGMOD, { myPlayerIndex: 0 });
  sim2.enterRoom('PVK8'); sim2.onRoom(R('lobby', 0, null));
  const h = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim2.setGame(h); sim2.onRoom(R('playing', 0, h));
  sim2.onRoom(R('ended', 0, { ...G('I', 'game-over'), winner: 1 }));
  assert.strictEqual(sim2.env.payloads[0].benign, null, '玩家不該被標成 spectator');
});
T('F6 ⭐ vis 帶得出來（分辨「分頁在背景」這一類成因）', () => {
  const sim = makeSim(PAGE, SGMOD, { myPlayerIndex: 0, vis: 'hidden' });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 0, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('ended', 0, { ...G('I', 'game-over'), winner: 1 }));
  assert.strictEqual(sim.env.payloads[0].vis, 'hidden', 'vis 錯：' + sim.env.payloads[0].vis);
});
T('F7 ⭐⭐⭐ 零額外請求：整份 +page.svelte 的診斷送出點數量必須不變', () => {
  // 送出的**唯一**出口是 _tPostClientDiag；它的呼叫點只能有 1 個（在 _casualDiagSend 裡）。
  const post = (PAGE.match(/_tPostClientDiag\(/g) || []).length;
  assert.strictEqual(post, 3,
    '_tPostClientDiag 應恰為「1 個定義 ＋ 2 個呼叫（錦標賽批／休閒批）」，實際 ' + post
    + ' —— 數字變了代表多（或少）了一個送出點，本版明令零額外請求');
  // 本版沒有新增任何 _tSendClientDiag 呼叫點（v6.279 有 9 個：定義 1 ＋ 呼叫 8）。
  const send = (PAGE.match(/_tSendClientDiag\(/g) || []).length;
  assert.strictEqual(send, 15, '_tSendClientDiag 的出現次數變了（＝多了送出點），實際 ' + send);
  // 本版一行 tApi 都沒有新增（錦標賽零接觸）。
  const tapi = (PAGE.match(/\btApi\(/g) || []).length;
  assert.strictEqual(tapi, 37, 'tApi 的呼叫點數量變了（錦標賽必須零接觸），實際 ' + tapi);
  const fet = (PAGE.match(/\bfetch\(/g) || []).length;
  assert.strictEqual(fet, 3, 'fetch 的呼叫點數量變了，實際 ' + fet);
});
T('F8 ⭐ 指紋只讀既有 state：本版動過的每一段裡都沒有 fetch/計時器/await/送出點', () => {
  const blk = noteFn(PAGE) + phantomField(PAGE) + seedBlock(PAGE) + subResetBlock(PAGE);
  for (const bad of ['_tPostClientDiag(', 'tApi(']) {
    ok(!blk.includes(bad), '本版動過的區塊裡出現了「' + bad + '」—— 那就是新的請求');
  }
  for (const bad of ['fetch(', 'setInterval', 'setTimeout', 'await ', 'XMLHttpRequest', 'sendBeacon']) {
    ok(!blk.includes(bad), '指紋判定點出現了「' + bad + '」—— 那就不是零成本了');
  }
});

console.log('\n【A】HEAD-FAIL：拿真 BASE blob 跑同一組 fixture 必須紅');
const BASE_SHA_CANDIDATES = [
  '8d366f9c880301091e4668fed8268d4dc22804a3',   // v6.279（本版的前一版）
];
let basePage = null, baseSg = null;
for (const s of BASE_SHA_CANDIDATES) {
  if (!hasBaseCommit(ROOT, s)) continue;
  const p = readBaseBlob(ROOT, s, PAGE_PATH), g = readBaseBlob(ROOT, s, SG_PATH);
  if (p.ok && g.ok) { basePage = p.out; baseSg = g.out; break; }
}
if (!basePage) {
  shallowSkip('【A】BASE blob 對照（D 情境在 BASE 上必須凍住）',
    '同一件事另由【G】的突變測試涵蓋（history-free）');
} else {
  const BASESG = loadSG(baseSg);
  T('A1 ⭐⭐⭐ BASE 上：換房後 B 房的重新開局被 phantom-setup 擋住（畫面凍住）', () => {
    const r = runScenarioD(basePage, BASESG);
    assert.ok(r.afterRestart.rej > 0,
      'BASE 竟然沒有擋 —— 這支守衛沒有在守那個 bug（實際拒收 ' + r.afterRestart.rej + ' 次）');
    assert.strictEqual(r.afterRestart.id, 'B-GAME-1', 'BASE 上本地局應該還凍在 B-GAME-1');
    assert.ok(r.driftCount > 0, 'BASE 上本地應該與房間分歧過（實際 ' + r.driftCount + ' 發）');
    console.log('       ↳ BASE 重現：拒收 ' + r.afterRestart.rej + ' 次、與房間分歧 ' + r.driftCount
      + ' 發、最後盤面 ' + r.final.id + '/' + r.final.phase + ' winner=' + r.final.winner);
  });
  T('A2 ⭐⭐⭐ BASE 上：對手宣告棄權後盤面被換成 game-over（玩家什麼都沒做就輸了）', () => {
    const r = runScenarioD(basePage, BASESG);
    assert.strictEqual(r.final.phase, 'game-over', 'BASE 的事故重現不成立');
    assert.strictEqual(r.final.winner, 1, 'BASE 上贏的應該是對手');
  });
  T('A3 正對照：BASE 上 A 房（第一間房）的重新開局是正常的 —— 只有換房才壞', () => {
    const r = runScenarioD(basePage, BASESG);
    assert.strictEqual(r.afterA.adopted, 'A-GAME-2', 'BASE 的 A 房行為應正常');
  });
  T('A4 BASE 上沒有 nextRestartBaseline，也沒有 _restartBaselineRoom', () => {
    ok(typeof BASESG.nextRestartBaseline !== 'function', 'BASE 竟然已經有 nextRestartBaseline');
    ok(!basePage.includes('_restartBaselineRoom'), 'BASE 竟然已經有 _restartBaselineRoom');
  });
}

console.log('\n【G】突變測試（history-free：淺複製下這一整節照樣在守）');
/** 把 HEAD 的 +page.svelte 改回「沒有重設」的樣子。 */
function mutRemoveSeed(src) {
  const blk = seedBlock(src);
  return src.replace(blk, '    roomData = room;\n');
}
mustBreak('G1 拿掉 handleRoomUpdate 的門檻重設 ⇒ B2 必紅', () => {
  const r = runScenarioD(mutRemoveSeed(PAGE), SGMOD);
  assert.strictEqual(r.afterRestart.rej, 0, 'B 房的重新開局被擋了 ' + r.afterRestart.rej + ' 次');
});
mustBreak('G2 把重設改成 fail-open 的「設 0」⇒ P-a2 必紅（count 2 的幻影局被放行）', () => {
  const mut = PAGE.replace('lastAdoptedRestartCount = _rb.lastAdoptedRestartCount;',
    'lastAdoptedRestartCount = 0;');
  ok(mut !== PAGE, '突變沒套用上（錨點漂移）');
  const sim = makeSim(mut, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8');
  sim.onRoom(R('playing', 2, null));
  const g1 = G('CANON', 'playing', { turn: 3, log: new Array(40).fill('x') });
  sim.setGame(g1);
  sim.onRoom(R('playing', 2, G('GHOST', 'setup')));
  assert.strictEqual(sim.getGame()?.id, 'CANON', 'count 2 的幻影 setup 局竟然被採納了（fail-open）');
});
mustBreak('G3 把中央述詞改成「每一發都重設」⇒ P-c 必紅（連合法的重新開局都會被自己擋掉）', () => {
  const mutSg = SG.replace('  if (opts.baselineRoom === opts.roomCode) return keep;  // 同一間房 → 不重設', '');
  ok(mutSg !== SG, '突變沒套用上（錨點漂移）');
  const sim = makeSim(PAGE, loadSG(mutSg), { myPlayerIndex: 0 });
  sim.enterRoom('PVK8');
  sim.onRoom(R('lobby', 0, null));
  const g1 = G('CANON', 'playing', { turn: 2, log: new Array(20).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('playing', 1, G('NEW', 'setup')));
  assert.strictEqual(sim.getGame()?.id, 'NEW',
    '合法的重新開局沒有被採納（實際 ' + sim.getGame()?.id + '）');
});
mustBreak('G4 把 phantom 防護整條拿掉 ⇒ P-a 必紅（真正的幻影局被放行）', () => {
  const mutSg = SG.replace("    if (local.phase === 'playing'\n        && incoming.phase === 'setup'\n"
    + '        && (ctx.roomRestartCount ?? 0) <= (ctx.lastAdoptedRestartCount ?? 0)) {\n'
    + "      return { kind: 'reject', reason: 'phantom-setup' };\n    }\n", '');
  ok(mutSg !== SG, '突變沒套用上（錨點漂移）');
  const sim = runPhantomRace(PAGE, loadSG(mutSg));
  assert.strictEqual(sim.getGame()?.id, 'CANON', '幻影 setup 局竟然被採納了 —— 防護被關掉了');
});
mustBreak('G5 拿掉 startRoomSubscription 的 _restartBaselineRoom 重設 ⇒ D4 必紅', () => {
  const mut = PAGE.replace('    _restartBaselineRoom = null;\n    unsubRoom?.();', '    unsubRoom?.();');
  ok(mut !== PAGE, '突變沒套用上（錨點漂移）');
  const blk = subResetBlock(mut);
  ok(/_restartBaselineRoom\s*=\s*null\s*;/.test(blk),
    'startRoomSubscription 沒有重設 _restartBaselineRoom');
});
mustBreak('G6 把新欄位 incPhase 從 payload 拿掉 ⇒ F2 必紅', () => {
  const mut = PAGE.replace('incPhase: _casualPhantom.incPhase, ', '');
  ok(mut !== PAGE, '突變沒套用上（錨點漂移）');
  const sim = makeSim(mut, SGMOD, { myPlayerIndex: 0 });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 0, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('ended', 0, { ...G('I', 'game-over'), winner: 1, turn: 9, log: new Array(6).fill('x') }));
  const p = sim.env.payloads[0];
  assert.strictEqual(p.incPhase, 'game-over', 'incPhase 錯：' + p.incPhase);
});
mustBreak('G7 把 benign 改成「觀戰者直接不送」⇒ F5 必紅（分母不誠實）', () => {
  const mut = PAGE.replace('      if (_casualPhantomSent) return;',
    '      if (myPlayerIndex === null) return;\n      if (_casualPhantomSent) return;');
  ok(mut !== PAGE, '突變沒套用上（錨點漂移）');
  const sim = makeSim(mut, SGMOD, { myPlayerIndex: null });
  sim.enterRoom('PVK8'); sim.onRoom(R('lobby', 0, null));
  const g1 = G('L', 'playing', { turn: 4, log: new Array(101).fill('x') });
  sim.setGame(g1); sim.onRoom(R('playing', 0, g1));
  sim.onRoom(R('ended', 0, { ...G('I', 'game-over'), winner: 1 }));
  assert.strictEqual(sim.env.sent.length, 1, '觀戰者的指紋被丟掉了 —— 分母會不誠實');
});

console.log('\n【H】守衛自己有進 test chain（只加進 iron-rules-audit.sh 等於沒加）');
T('H1 package.json 的 test chain 有跑這一支', () => {
  ok(String(PKG.scripts?.test || '').includes('test-v6280-restart-baseline.mjs'),
    'package.json 的 test 沒有串這支守衛');
});

console.log(`\nv6.280 restart-baseline 守衛：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
