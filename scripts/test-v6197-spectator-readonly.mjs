// ⭐⭐⭐v6.197 守衛：「觀戰者（以及任何認不出座位的人）一個操作按鈕都不可以有」
//   跑法：node scripts/test-v6197-spectator-readonly.mjs
//
// 玩家回報：進「一般對戰（休閒線上）」的觀戰，按「離開」時冒出「投降」的按鈕，
//   甚至有時候按得到「攻擊 / 結束回合」。
// 真因不是某顆按鈕忘了 gate，而是舊述詞是 fail-open 的：
//     isSpectator = isTournSpectator || (mode==='online' && (mySeatIdx >= 2 || isAdminMode))
//   「認不出自己的座位」(mySeatIdx === -1) 這個**不確定**狀態被歸成「玩家」。
//   而 mySeatIdx 真的會變成 -1：oracle-client 在 401 時會靜默重新匿名登入、換到一個
//   全新的 uid（v5.628），畫面端的 myUid 卻只在 onMount 取過一次。
//
// ⚠⚠ 這支刻意不是只驗字串存在（本專案反覆踩「斷言有呼叫某函式 ≠ 那件事發生了」）：
//   把 viewer-role.ts / 桌機頂欄條件 / 手機直式 isMyTurn / onLeave 分流 /
//   surrenderLeave / leaveOnlineGame / oraclePollRoom / leaveRoom 這幾段**會被打包出去的
//   原始碼**切出來、剝掉 TS 型別後**真的跑起來**，斷言的是行為不是字面。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => readFileSync(join(ROOT, p), 'utf8');
const VR   = R('src/lib/game/viewer-role.ts');
const PAGE = R('src/routes/game/+page.svelte');
const MOB  = R('src/routes/game/MobilePortraitBattle.svelte');
const OC   = R('src/lib/game/oracle-client.ts');
const RO   = R('src/lib/game/room-oracle.ts');
const RF   = R('src/lib/game/room.ts');
const SRV  = R('oracle-admin/server_admin_patch.js');

let pass = 0; const fails = [];
const T = (name, fn) => { try { fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };
const TA = async (name, fn) => { try { await fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };
const ts = (s) => transformSync(s, { loader: 'ts' }).code;

function slice(src, from, to, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, '找不到起始錨點（守衛需同步更新）：' + label);
  const j = src.indexOf(to, i + from.length);
  assert.ok(j > i, '找不到結束錨點：' + label);
  return src.slice(i, j + to.length);
}
/** 剝註解 —— 否定型斷言一律先剝，否則「註解裡提到舊寫法」會被誤判成還在用（本專案教訓） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── 0) 工具自我驗證（掃描器自己要先被驗）─────────────────────────────
T('0a 剝註解器：行註解真的被剝掉', () => {
  assert.equal(stripComments('a=1; // mySeatIdx >= 2\nb=2;').includes('mySeatIdx >= 2'), false);
});
T('0b 剝註解器：區塊註解真的被剝掉', () => {
  assert.equal(stripComments('/* mySeatIdx >= 2 */ const z=1;').includes('mySeatIdx >= 2'), false);
});
T('0c 剝註解器：不會誤剝正常程式碼', () => {
  assert.ok(stripComments('const y = 3;\nconst x = a ? 1 : 2;').includes('const y = 3'));
});
T('0d slice：錨點不存在會拋（守衛不會靜默通過）', () => {
  assert.throws(() => slice('abc', 'zzz', 'q', 'self-test'));
});

// ── 1) 中央述詞 viewer-role.ts：實跑求值 ─────────────────────────────
let VRM = null;
T('1a 中央模組可載入且匯出三支述詞', () => {
  VRM = new Function(ts(VR).replace(/export\s+/g, '') +
    '\n; return { isViewerSpectator, canViewerAct, isSeatUnknownOnline };')();
  assert.equal(typeof VRM.isViewerSpectator, 'function');
  assert.equal(typeof VRM.canViewerAct, 'function');
  assert.equal(typeof VRM.isSeatUnknownOnline, 'function');
});
const SPEC = (v) => VRM.isViewerSpectator(v);
const ACT  = (v) => VRM.canViewerAct(v);
// ⚠⚠ 3/4/5 三組行為端斷言**不可以**直接用中央模組求值 —— 那只證明「新模組是對的」，
//   證不到「畫面真的接上了它」。這裡把 +page.svelte 裡 isSpectator / canAct 的**實際運算式**
//   切出來求值，接線沒接上就會在這裡爆掉（本專案教訓：只驗字串存在擋不住接線沒接上）。
function pageExpr(name) {
  const line = slice(PAGE, 'const ' + name + ' = $derived(', '\n', name + ' 定義');
  const expr = line.slice(line.indexOf('$derived(') + '$derived('.length, line.lastIndexOf(');'));
  return new Function('isViewerSpectator', 'canViewerAct', 'isSeatUnknownOnline',
    'mode', 'mySeatIdx', 'myPlayerIndex', 'isTournSpectator', 'isTReplay', 'isAdminMode',
    'return (' + expr + ');');
}
let _pSpec = null, _pAct = null;
T('1a2 畫面端 isSpectator / canAct 的運算式可求值', () => { _pSpec = pageExpr('isSpectator'); _pAct = pageExpr('canAct'); });
const PSPEC = (v) => _pSpec(VRM.isViewerSpectator, VRM.canViewerAct, VRM.isSeatUnknownOnline,
  v.mode, v.mySeatIdx, v.myPlayerIndex, !!v.isTournSpectator, !!v.isTReplay, !!v.isAdminMode);
const PACT = (v) => _pAct(VRM.isViewerSpectator, VRM.canViewerAct, VRM.isSeatUnknownOnline,
  v.mode, v.mySeatIdx, v.myPlayerIndex, !!v.isTournSpectator, !!v.isTReplay, !!v.isAdminMode);
const S_CASUAL_SPEC   = { mode: 'online', mySeatIdx: 2, myPlayerIndex: null };
const S_SEAT_UNKNOWN  = { mode: 'online', mySeatIdx: -1, myPlayerIndex: null };
const S_TOURN_SPEC    = { mode: 'online', mySeatIdx: 2, myPlayerIndex: null, isTournSpectator: true };
const S_REPLAY        = { mode: 'online', mySeatIdx: 2, myPlayerIndex: null, isTournSpectator: true, isTReplay: true };
const S_ADMIN         = { mode: 'online', mySeatIdx: 0, myPlayerIndex: 0, isAdminMode: true };
const S_P1            = { mode: 'online', mySeatIdx: 0, myPlayerIndex: 0 };
const S_P2            = { mode: 'online', mySeatIdx: 1, myPlayerIndex: 1 };
const S_LOCAL         = { mode: 'local',  mySeatIdx: -1, myPlayerIndex: null };
const S_AI            = { mode: 'local',  mySeatIdx: -1, myPlayerIndex: 0 };
const S_MISMATCH      = { mode: 'online', mySeatIdx: 1, myPlayerIndex: 0 };

T('1b 休閒觀戰位（seat 2）⇒ 觀戰、不可操作', () => { assert.equal(SPEC(S_CASUAL_SPEC), true); assert.equal(ACT(S_CASUAL_SPEC), false); });
T('1c ⭐認不出座位（seat -1）⇒ fail-closed 當觀戰、不可操作', () => { assert.equal(SPEC(S_SEAT_UNKNOWN), true); assert.equal(ACT(S_SEAT_UNKNOWN), false); });
T('1d 錦標賽觀戰 ⇒ 不可操作', () => assert.equal(ACT(S_TOURN_SPEC), false));
T('1e 回放 ⇒ 不可操作', () => assert.equal(ACT(S_REPLAY), false));
T('1f admin 隱身觀戰 ⇒ 不可操作', () => assert.equal(ACT(S_ADMIN), false));
T('1g 座位與 playerIndex 對不起來 ⇒ 不可操作', () => assert.equal(ACT(S_MISMATCH), false));
T('1h 正對照：真的 P1 ⇒ 可操作', () => { assert.equal(SPEC(S_P1), false); assert.equal(ACT(S_P1), true); });
T('1i 正對照：真的 P2 ⇒ 可操作', () => assert.equal(ACT(S_P2), true));
T('1j 正對照：本機雙人 ⇒ 可操作（沒有觀戰概念）', () => assert.equal(ACT(S_LOCAL), true));
T('1k 正對照：AI 對戰 ⇒ 可操作', () => assert.equal(ACT(S_AI), true));
T('1l isSeatUnknownOnline：只在線上且非觀戰／回放時為真', () => {
  assert.equal(VRM.isSeatUnknownOnline(S_SEAT_UNKNOWN), true);
  assert.equal(VRM.isSeatUnknownOnline(S_CASUAL_SPEC), false);
  assert.equal(VRM.isSeatUnknownOnline(S_LOCAL), false);
  assert.equal(VRM.isSeatUnknownOnline(S_REPLAY), false);
});

// ── 2) +page.svelte 的 isSpectator 真的收斂到中央述詞 ────────────────
const PAGE_NC = stripComments(PAGE);
T('2a isSpectator 由中央述詞產生', () => {
  assert.match(PAGE_NC, /const isSpectator = \$derived\(isViewerSpectator\(\{/);
});
T('2b ⭐舊的 fail-open 字面（mySeatIdx >= 2）已從 isSpectator 定義中消失', () => {
  const def = slice(PAGE_NC, 'const isSpectator = $derived(', '\n', 'isSpectator 定義');
  assert.equal(def.includes('mySeatIdx >= 2'), false, 'isSpectator 仍在用 fail-open 的 mySeatIdx >= 2');
});
T('2c isSpectator 的輸入含全部 6 個欄位（少傳一個就是新的 fail-open 破口）', () => {
  const def = slice(PAGE_NC, 'const isSpectator = $derived(', '\n', 'isSpectator 定義');
  for (const k of ['mode', 'mySeatIdx', 'myPlayerIndex', 'isTournSpectator', 'isTReplay', 'isAdminMode']) {
    assert.ok(def.includes(k), 'isSpectator 少傳欄位：' + k);
  }
});
T('2d dispatch（所有動作的唯一出口）問的是中央述詞 canAct', () => {
  const d = slice(PAGE_NC, 'async function dispatch(', 'if (isTournament) { await tournamentDispatch(action); return; }', 'dispatch 開頭');
  assert.ok(d.includes('if (!canAct)'), 'dispatch 沒有用 canAct 擋');
  assert.ok(d.indexOf('if (!canAct)') < d.indexOf('if (isTournament)'), 'canAct 的擋線必須在任何盤面處理之前');
});
T('2e initiateAttack 也問 canAct（copy-attack 的本地選單也不可以開）', () => {
  const d = slice(PAGE_NC, 'function initiateAttack(attackIndex: number) {', 'const eff =', 'initiateAttack 開頭');
  assert.ok(d.includes('if (!canAct) return;'));
});

// ── 3) 桌機頂欄「🏳 投降離開」— 行為端求值 ──────────────────────────
T('3a 桌機頂欄：觀戰／認不出座位一律不出現投降鈕；真玩家照常出現', () => {
  const blk = slice(PAGE, '<button class="small-back" onclick={surrenderLeave}>', '</button>', '桌機投降鈕');
  const head = PAGE.slice(Math.max(0, PAGE.indexOf(blk) - 400), PAGE.indexOf(blk));
  const m = head.match(/\{#if ([^}]*isSpectator[^}]*)\}\s*$/);
  assert.ok(m, '找不到包住投降鈕的 {#if …isSpectator…}');
  const cond = new Function('mode', 'isSpectator', 'return (' + m[1] + ');');
  const shows = (st) => !!cond(st.mode, PSPEC(st));
  assert.equal(shows(S_CASUAL_SPEC), false, '休閒觀戰仍看得到投降鈕');
  assert.equal(shows(S_SEAT_UNKNOWN), false, '⭐認不出座位仍看得到投降鈕（回報的症狀）');
  assert.equal(shows(S_TOURN_SPEC), false);
  assert.equal(shows(S_REPLAY), false);
  assert.equal(shows(S_P1), true, '正對照：真玩家的投降鈕被誤擋');
  assert.equal(shows(S_P2), true, '正對照：真玩家的投降鈕被誤擋');
});

T('3b 桌機休閒觀戰有專屬「離開觀戰」鈕（會真的呼叫 leaveRoom 釋放觀戰位）', () => {
  const blk = slice(PAGE, '<button class="small-back" onclick={surrenderLeave}>', '{/if}', '桌機頂欄離開區');
  assert.ok(blk.includes('onclick={leaveOnlineGame}'),
    '桌機休閒觀戰仍只有 <a> 首頁 ⇒ 整頁換掉、走不到 leaveRoom ⇒ 8 個觀戰位會被殘留佔滿');
  const m = blk.match(/\{:else if ([^}]+)\}/);
  assert.ok(m, '找不到休閒觀戰分支');
  const cond = new Function('mode', 'isTournSpectator', 'isTReplay', 'isAdminMode', 'return (' + m[1] + ');');
  assert.equal(cond('online', false, false, false), true, '休閒觀戰看不到離開觀戰鈕');
  assert.equal(cond('online', true, false, false), false, '錦標賽觀戰有專屬 tourn-return-bar，不該用這顆');
  assert.equal(cond('online', true, true, false), false, '回放不該出現離開觀戰鈕');
  assert.equal(cond('online', false, false, true), false, 'admin 隱身觀戰沒有座位，不該走 leaveRoom');
  assert.equal(cond(null, false, false, false), false, '本機／AI 不該出現離開觀戰鈕');
});

// ── 4) 手機直式 isMyTurn — 行為端求值（攻擊／結束回合的總開關）──────
T('4a 手機直式：isMyTurn 對觀戰／認不出座位者在兩種 activePlayerIndex 下都必須是 false', () => {
  const line = slice(MOB, 'let isMyTurn = $derived(', ');', '手機 isMyTurn');
  const expr = line.slice(line.indexOf('$derived(') + '$derived('.length, line.lastIndexOf(')'));
  const f = new Function('isSpectator', 'game', 'myIdx', 'return (' + expr + ');');
  // 觀戰視角 auto ⇒ 父層的 myIdx 會跟著 activePlayerIndex；認不出座位時父層退回 myPlayerIndex ?? 0
  for (const ap of [0, 1]) {
    assert.equal(f(PSPEC(S_CASUAL_SPEC), { activePlayerIndex: ap }, ap), false, '休閒觀戰 isMyTurn=true (ap=' + ap + ')');
    assert.equal(f(PSPEC(S_SEAT_UNKNOWN), { activePlayerIndex: ap }, 0), false, '⭐認不出座位 isMyTurn=true (ap=' + ap + ')');
    assert.equal(f(PSPEC(S_TOURN_SPEC), { activePlayerIndex: ap }, ap), false);
    assert.equal(f(PSPEC(S_REPLAY), { activePlayerIndex: ap }, ap), false);
  }
  // 正對照：真玩家該輪到誰就是誰
  assert.equal(f(PSPEC(S_P1), { activePlayerIndex: 0 }, 0), true, '正對照：真玩家 P1 的回合被誤擋');
  assert.equal(f(PSPEC(S_P1), { activePlayerIndex: 1 }, 0), false);
  assert.equal(f(PSPEC(S_P2), { activePlayerIndex: 1 }, 1), true, '正對照：真玩家 P2 的回合被誤擋');
  assert.equal(f(PSPEC(S_LOCAL), { activePlayerIndex: 0 }, 0), true, '正對照：本機雙人被誤擋');
});
T('4b 手機直式：準備／完成補抽兩顆 setup 鈕仍帶 !isSpectator', () => {
  const nc = stripComments(MOB);
  const a = slice(nc, "{#if isSetup && !game.setupDone[myIdx]", '}', 'setup 準備鈕條件');
  const b = slice(nc, '{:else if isSetup && game.mulliganPostBenchOpen?.[myIdx]', '}', 'setup 補抽鈕條件');
  assert.ok(a.includes('!isSpectator'), '準備鈕少了 !isSpectator');
  assert.ok(b.includes('!isSpectator'), '完成補抽鈕少了 !isSpectator');
});

// ── 5) 「離開」按鈕的分流 — 行為端實跑 ──────────────────────────────
T('5a 按「離開」時：觀戰／認不出座位一律不進投降流程', () => {
  const h = slice(PAGE, 'onLeave={() => {', '}}', 'onLeave 分流');
  const body = h.slice(h.indexOf('{', h.indexOf('=>')) + 1, h.lastIndexOf('}}'));
  const run = (st) => {
    const calls = [];
    const f = new Function('mode', 'isSpectator', 'isTournSpectator', 'tLeaveSpectate', 'leaveOnlineGame',
      'surrenderLeave', '__set', body.replace(/\bgame = null; mode = null;/g, '__set("localReset");'));
    f(st.mode, PSPEC(st), !!st.isTournSpectator,
      () => calls.push('tLeaveSpectate'), () => calls.push('leaveOnlineGame'),
      () => calls.push('surrenderLeave'), (x) => calls.push(x));
    return calls;
  };
  assert.deepEqual(run(S_CASUAL_SPEC), ['leaveOnlineGame'], '休閒觀戰按離開沒走離開房間');
  assert.deepEqual(run(S_SEAT_UNKNOWN), ['leaveOnlineGame'], '⭐認不出座位按離開走到了投降（回報的症狀）');
  assert.deepEqual(run(S_TOURN_SPEC), ['tLeaveSpectate']);
  assert.deepEqual(run(S_P1), ['surrenderLeave'], '正對照：真玩家按離開應走投降確認');
  assert.deepEqual(run(S_LOCAL), ['localReset'], '正對照：本機雙人按離開應直接回大廳');
});
T('5b surrenderLeave 第二道閘：不可操作的人連 confirm 都不該看到', () => {
  const fn = slice(PAGE, 'function surrenderLeave() {', "leaveOnlineGame();\n  }", 'surrenderLeave');
  const body = fn.slice(fn.indexOf('{') + 1, fn.lastIndexOf('}'));
  const run = (st) => {
    const calls = [];
    new Function('canAct', 'mode', 'isTournSpectator', 'confirm', 'isTournament', 'tForfeitAndLeave',
      'leaveOnlineGame', 'tLeaveSpectate', body)(
      PACT(st), st.mode, !!st.isTournSpectator,
      () => { calls.push('confirm'); return true; },
      false, () => calls.push('tForfeitAndLeave'),
      () => calls.push('leaveOnlineGame'), () => calls.push('tLeaveSpectate'));
    return calls;
  };
  assert.equal(run(S_CASUAL_SPEC).includes('confirm'), false, '觀戰者看到了投降確認');
  assert.equal(run(S_SEAT_UNKNOWN).includes('confirm'), false, '⭐認不出座位看到了投降確認');
  assert.equal(run(S_TOURN_SPEC).includes('confirm'), false);
  assert.equal(run(S_P1)[0], 'confirm', '正對照：真玩家投降的確認視窗不見了');
});

// ── 6) leaveOnlineGame：離開的過程中不可以還停在對戰頁 ───────────────
await TA('6a leaveOnlineGame：打網路之前盤面/座位已經清乾淨', async () => {
  const fn = slice(PAGE, 'async function leaveOnlineGame() {', "mode = 'online';\n  }", 'leaveOnlineGame');
  const body = fn.slice(fn.indexOf('{') + 1, fn.lastIndexOf('}'));
  let snap = null;
  const src = `
    let unsubRoom = null, unsubMessages = null, heartbeatTimer = null;
    let roomCode = 'ABCD', roomData = { seats: [] }, game = { phase: 'playing' };
    let chatMessages = [1], chatInput = 'x', onlineStep = 'room', showCreateForm = false;
    let onlineError = '', myPlayerIndex = null, mySeatIdx = 5, myDeckId = 'd', roomNameInput = '';
    let mode = 'online';
    const stopHeartbeat = () => {};
    const localStorage = { getItem: () => null };
    const leaveRoom = async () => { __snap({ game, mySeatIdx, roomCode, roomData, onlineStep }); };
    return (async () => { ${body} \n return { game, mySeatIdx, mode, onlineStep }; })();`;
  const out = await new Function('__snap', src)((x) => { snap = x; });
  assert.ok(snap, 'leaveRoom 沒有被呼叫（守衛失效）');
  assert.equal(snap.game, null, '⭐await leaveRoom 期間盤面還在（離開途中仍停在對戰頁）');
  assert.equal(snap.mySeatIdx, -1, '⭐await leaveRoom 期間座位還沒清（身分半清狀態）');
  assert.equal(snap.roomData, null);
  assert.equal(snap.onlineStep, 'join');
  assert.equal(out.game, null);
  assert.equal(out.mode, 'online', '正對照：離開後仍留在線上大廳');
});

// ── 7) oraclePollRoom：unsubscribe 之後在路上的那一發不可以再 callback ─
await TA('7a oraclePollRoom：unsub 後在途回應不得 callback', async () => {
  // v6.212：oraclePollRoom 現在會呼叫同檔的 shouldDeliverRoomPoll ⇒ 一起抽進來，
  //   不要在測試裡重寫一份（重寫＝判準漂移，產品碼改了測試還會綠）。
  const fn = slice(OC, 'export function shouldDeliverRoomPoll(', '\n}\n', 'shouldDeliverRoomPoll')
    + '\n' + slice(OC, 'export function oraclePollRoom(', '\n}\n', 'oraclePollRoom');
  let release = null;
  const src = ts(fn).replace(/export\s+/g, '') + `
    ; return oraclePollRoom;`;
  const ROOM_UNCHANGED = Symbol('u');
  const oracleGetRoom = () => new Promise((res) => { release = () => res({ _version: 7 }); });
  const poll = new Function('ROOM_UNCHANGED', 'oracleGetRoom', src)(ROOM_UNCHANGED, oracleGetRoom);
  const got = [];
  const unsub = poll('ABCD', (r) => got.push(r), 10);
  await new Promise((r) => setTimeout(r, 5));
  unsub();                       // 玩家按了離開
  assert.ok(release, '測試樁沒接上（守衛失效）');
  release();                     // 在路上的那一發現在才回來
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.length, 0, '⭐unsub 之後在途回應仍把房間 callback 回去（會把人彈回對戰頁）');
});
await TA('7b 正對照：沒 unsub 時該 callback 還是要 callback', async () => {
  // v6.212：oraclePollRoom 現在會呼叫同檔的 shouldDeliverRoomPoll ⇒ 一起抽進來，
  //   不要在測試裡重寫一份（重寫＝判準漂移，產品碼改了測試還會綠）。
  const fn = slice(OC, 'export function shouldDeliverRoomPoll(', '\n}\n', 'shouldDeliverRoomPoll')
    + '\n' + slice(OC, 'export function oraclePollRoom(', '\n}\n', 'oraclePollRoom');
  const src = ts(fn).replace(/export\s+/g, '') + '\n; return oraclePollRoom;';
  const ROOM_UNCHANGED = Symbol('u');
  const oracleGetRoom = async () => ({ _version: 3 });
  const poll = new Function('ROOM_UNCHANGED', 'oracleGetRoom', src)(ROOM_UNCHANGED, oracleGetRoom);
  const got = [];
  const unsub = poll('ABCD', (r) => got.push(r), 5);
  await new Promise((r) => setTimeout(r, 30));
  unsub();
  assert.ok(got.length >= 1, '正常輪詢的 callback 被誤擋');
});

// ── 8) leaveRoom：觀戰位真的被還回去（且不碰 P1/P2 的棄賽語義）──────
await TA('8a room-oracle.leaveRoom：對戰中的觀戰者離開 ⇒ 座位釋放', async () => {
  const fn = slice(RO, 'export async function leaveRoom(roomCode: string): Promise<void> {', '\n}\n', 'oracle leaveRoom');
  const src = ts(fn).replace(/export\s+/g, '') + '\n; return leaveRoom;';
  const mk = (status, seatIdx) => {
    // 另一位玩家固定坐 P1/P2 其中一席 ⇒ 房間不會因為「全空」而被刪掉（lobby 正對照要看得到清座位）
    const otherIdx = seatIdx === 0 ? 1 : 0;
    const seats = Array.from({ length: 10 }, (_, i) => ({ role: i < 2 ? 'p' + (i + 1) : 'spectator', uid: i === seatIdx ? 'ME' : (i === otherIdx ? 'OTHER' : null), name: null, deckEntries: null, ready: false }));
    return { _id: 'ABCD', status, seats, gameState: status === 'playing' ? { players: [{}, {}], log: [], turn: 1 } : null };
  };
  const run = async (status, seatIdx) => {
    let cur = mk(status, seatIdx); const ops = [];
    const leaveRoom = new Function('oracleCurrentUid', 'oracleGetRoom', 'findMySeatIdx', 'computeMemberUids',
      'oracleTx', 'oracleDeleteRoom', 'console', src)(
      () => 'ME', async () => cur,
      (seats, uid) => seats.findIndex((s) => s.uid === uid),
      (seats) => seats.filter((s) => s.uid).map((s) => s.uid),
      async (_c, f) => { cur = f(cur); ops.push('tx'); return cur; },
      async () => { ops.push('del'); }, console);
    await leaveRoom('ABCD');
    return { cur, ops };
  };
  const spec = await run('playing', 3);
  assert.equal(spec.cur.seats[3].uid, null, '⭐對戰中的觀戰位離開後仍被佔著');
  assert.equal(spec.cur.status, 'playing', '觀戰者離開不可以動到房間狀態');
  const p1 = await run('playing', 0);
  assert.equal(p1.cur.seats[0].uid, 'ME', '正對照：P1 在 playing 離場不可以清座位（要保留給 rematch）');
  assert.equal(p1.cur.status, 'ended', '正對照：P1 在 playing 離場應走棄賽判對手勝');
  const lob = await run('lobby', 1);
  assert.equal(lob.cur.seats[1].uid, null, '正對照：lobby 離場照舊清座位');
});
T('8b room.ts（Firebase 後端）逐行同步了同一條規則', () => {
  const nc = stripComments(RF);
  const fn = slice(nc, 'export async function leaveRoom(roomCode: string): Promise<void> {', '\n}\n', 'firebase leaveRoom');
  assert.ok(fn.includes("if (data.status !== 'lobby') {"), 'room.ts 沒有同步觀戰位釋放');
  assert.ok(fn.includes('if (myIdx < 2) return;'), 'room.ts 的觀戰位釋放沒有限定 >= 2');
});

// ── 9) 身分變動要通知出去（mySeatIdx 變 -1 的真因）──────────────────
T('9a oracle-client 匯出 onOracleUidChange，且兩條取得 uid 的路徑都走中央 setter', () => {
  const nc = stripComments(OC);
  assert.ok(nc.includes('export function onOracleUidChange('), '沒有身分變動通知');
  assert.ok(nc.includes('_setUid(cachedUid)'), 'localStorage 快取路徑沒走中央 setter');
  assert.ok(nc.includes('_setUid(uid)'), '新簽發路徑沒走中央 setter');
  assert.equal((nc.match(/_uid = uid;/g) || []).length, 1, '仍有繞過 _setUid 直接寫 _uid 的路徑');
});
T('9b ⭐身分變動訂閱只「補空白」，絕不取代一個進行中的身分（防止修過頭）', () => {
  const line = slice(PAGE, 'onOracleUidChange((uid) =>', ');', '身分變動訂閱');
  const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
  const run = (cur, incoming) =>
    new Function('uid', 'let myUid = ' + JSON.stringify(cur) + ';' + body + '; return myUid;')(incoming);
  assert.equal(run(null, 'U1'), 'U1', 'onMount 取身分失敗留下的空白沒有被補上');
  assert.equal(run('U0', 'U1'), 'U0',
    '⭐把進行中的身分換成 401 重登後的新 uid ＝ 座位裡存的還是舊 uid ⇒ 親手把對戰中的 P1/P2 鎖成唯讀');
});
T('9b2 訂閱有解除（不解除 ⇒ 每次重進 /game 疊一個 listener）', () => {
  const nc = stripComments(PAGE);
  assert.ok(nc.includes('_unsubOracleUid = onOracleUidChange('), '沒有保留解除函式');
  assert.ok(nc.includes('_unsubOracleUid?.();'), 'onDestroy 沒有解除訂閱');
});
T('9c 認不出座位時畫面有顯性提示（不可以只是靜靜收掉按鈕）', () => {
  assert.ok(stripComments(PAGE).includes('{#if seatUnknown}'), '沒有「認不出座位」的顯性提示');
});

// ── 10) 伺服器端縱深防禦（錦標賽）──────────────────────────────────
T('10a 錦標賽 /action：不在座位上的人一律 403', () => {
  const nc = stripComments(SRV);
  const h = slice(nc, "app.post('/api/tournament/action'", 'const gs = doc.gameState;', '/action handler');
  assert.ok(h.includes('const seat = doc.seats.indexOf(pid);'), '/action 沒有由伺服器導出座位');
  assert.ok(/if \(seat < 0\) return res\.status\(403\)/.test(h), '/action 沒有拒絕非座位者（觀戰者）');
});
T('10b 錦標賽 /match/forfeit：只找得到「自己」的對戰（無法投降別人的局）', () => {
  const nc = stripComments(SRV);
  const h = slice(nc, "app.post('/api/tournament/match/forfeit'", 'const mySeat =', '/forfeit handler');
  assert.ok(h.includes('{ p1uid: id.uid }') && h.includes('{ p2uid: id.uid }'), '/forfeit 沒有綁定呼叫者身分');
});

console.log('\n=== v6.197 觀戰唯讀守衛 ===');
console.log('PASS ' + pass + ' / FAIL ' + fails.length);
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
