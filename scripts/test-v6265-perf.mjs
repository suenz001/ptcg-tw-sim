// v6.265 效能量測：本版對玩家端的成本必須是**零額外請求、零新計時器、量不出來的 CPU**。
//
// ⚠ Rule 31／32：「程式碼變多」不等於變慢，但**效能結論一律要附量測腳本**。
//   這支跑三件事，全部是真原始碼實跑：
//     ①`room-oracle.ts` 的 `oracleTxFlagged`：同一批呼叫，BASE 與本版的 **GET/PUT 次數逐字相同**；
//     ②`_casualNotePhantomAdopt`：一般對局 100,000 次盤面更新的**總耗時**與**送出次數**；
//     ③新程式碼的靜態成本：判定函式裡不得出現計時器／網路／序列化。
// ⚠ 上限刻意訂得寬（10ms／10 萬次 ＝ 每次 <0.1µs 量級的純比較），
//   目的是抓「有人不小心在熱路徑放了昂貴的東西」，不是把 CI 綁在某台機器的絕對速度上。
// Run: node scripts/test-v6265-perf.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '3fd89b566d729ccddebb3014cdcb9d3cd4bd8fd5';
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);

function loadRoomOracle(srcText, server) {
  const code = transformSync(srcText, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const stubs = {
    './oracle-client': {
      oracleAuth: async () => ({ uid: 'U1' }), oracleApi: async () => ({}),
      oracleGetRoom: async () => server.get(), oracleUpsertRoom: async (c, d, v) => server.put(d, v),
      oracleDeleteRoom: async () => {}, oracleListRooms: async () => [], oraclePollRoom: () => () => {},
      oracleListMessages: async () => [], oracleCurrentUid: () => 'U1', oracleListRoomsCombined: async () => [],
      ROOMS_UNCHANGED: Symbol('u'), ROOMS_COMBINED_UNSUPPORTED: Symbol('c'),
      isOracleTimeout: () => false, isOracleUploadBudgetTimeout: () => false,
      ORACLE_SIDEEFFECT_TIMEOUT_MS: 60000,
    },
    '$lib/firebase': { auth: { currentUser: null } },
    './engine': { createGame: () => ({ id: 'x', phase: 'setup' }) },
    './sync-guards': { shouldSkipStalePush: () => false },
    '$lib/ui/stale-keep': { adoptOrKeep: (p, n) => ({ data: n ?? p, stale: n == null }) },
    './room': { SEAT_LAYOUT_VERSION: 1, TOTAL_SEATS: 10, SPECTATOR_SEATS: 8, HEARTBEAT_STALE_MS: 1,
      generateRoomCode: () => 'AAAA', findMySeatIdx: () => 0, countDeckCards: () => 60,
      bothPlayersReady: () => true, isSeatStale: () => false, LOBBY_HOST_AWAY_MS: 1,
      LOBBY_HOST_STALE_MS: 1, hostPresence: () => 'ok', isLobbyHostDead: () => false, isLobbyTooOld: () => false },
  };
  const mod = { exports: {} };
  const f = new Function('module', 'exports', 'require', 'console', 'setTimeout', code + '\nreturn module.exports;');
  return f(mod, mod.exports, (id) => stubs[id], { warn() {}, error() {}, log() {} }, (fn) => fn());
}
function counter(initial) {
  let doc = { ...initial, _version: 1 };
  const c = { gets: 0, puts: 0 };
  return { c, doc: () => doc,
    get: async () => { c.gets++; return { ...doc }; },
    put: async (d) => { c.puts++; doc = { ...d, _version: doc._version + 1 }; return { ok: true, version: doc._version, room: { ...doc } }; } };
}

console.log('\n══ v6.265 效能量測（零額外請求）══');
const LOBBY = { _id: 'R', status: 'lobby', gameState: null, seats: [{ ready: true, deckEntries: [], name: 'a' }, { ready: true, deckEntries: [], name: 'b' }], heartbeats: {} };
const PLAYING = { ...LOBBY, status: 'playing', gameState: { id: 'g', phase: 'playing', log: [] } };

let BASE_RO = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room-oracle.ts'); BASE_RO = r.ok ? r.out : null; }

await T('① BASE 與本版：同一批 API 呼叫的 GET／PUT 次數**完全相同**（零額外請求）', async () => {
  if (!BASE_RO) { shallowSkip('① 與 BASE 的請求次數對照', '② ③ 不需要歷史，仍在守'); return; }
  const runAll = async (src) => {
    const out = {};
    const jobs = [
      ['startGame', LOBBY, (M) => M.startGame('R', { id: 'g', phase: 'setup' })],
      ['pushGameState', PLAYING, (M) => M.pushGameState('R', { id: 'g', phase: 'playing', log: [1] })],
      ['pushUndoRollback', PLAYING, (M) => M.pushUndoRollback('R', { id: 'g', phase: 'playing', log: [] })],
      ['heartbeat', PLAYING, (M) => M.heartbeat('R', 0)],
      ['checkAndAcceptRematch', { ...PLAYING, rematchReady: { 0: true, 1: true } }, (M) => M.checkAndAcceptRematch('R')],
      ['checkAndAcceptRestart', { ...PLAYING, restartProposed: { 0: true, 1: true } }, (M) => M.checkAndAcceptRestart('R', new Map())],
      ['checkAndAcceptReturnToRoom', { ...PLAYING, returnRoomProposed: { 0: true, 1: true } }, (M) => M.checkAndAcceptReturnToRoom('R')],
    ];
    for (const [name, init, run] of jobs) {
      const s = counter(init); await run(loadRoomOracle(src, s)); out[name] = { ...s.c };
    }
    return out;
  };
  const b = await runAll(BASE_RO), n = await runAll(RO);
  assert.deepStrictEqual(n, b, '請求次數與 BASE 不同：\n  BASE=' + JSON.stringify(b) + '\n  本版=' + JSON.stringify(n));
  console.log('        七支 API 的 GET/PUT 次數：' + JSON.stringify(n));
});

// ── ② 一般對局熱路徑：_casualNotePhantomAdopt 十萬次 ────────────────────────
function makeNote(src) {
  const c = src.indexOf('  const CASUAL_DIAG_REASONS'); ok(c > 0, '抓不到 CASUAL_DIAG_REASONS');
  const c2 = src.indexOf('  const CASUAL_SLOW_PUSH_P95_MS', c);
  const a = src.indexOf('  /** ⭐v6.261 診斷回傳的**唯一**送出點');
  const b = src.indexOf('  // v5.618：手動/自動「重新同步」', a);
  ok(a > 0 && b > a, '抓不到休閒診斷函式群');
  const js = transformSync(src.slice(c, c2) + '\n' + src.slice(a, b), { loader: 'ts', target: 'node18' }).code;
  const posts = [];
  const prologue = `
  let isTournament = false, isTournSpectator = false, mode = 'online', roomCode = 'ROOM';
  let firebaseUser = { isAnonymous: false }, _casualDiagSent = 0;
  let game = { id: 'g', phase: 'playing', turn: 3, log: [] }, roomData = { idleTimeoutSec: 180 };
  let _casualPushSamples = [], _casualPushFail = 0, _casualSlowSent = false, _casualClaimSent = false;
  let _casualSampleRoom = '', _casualSampleArmed = false, _casualSampleSent = false, _casualClaimGranted = null;
  let _casualPhantomSent = false, _casualPhantom = null, _startGameWon = null, _startGameReadyMs = -1;
  let mySeatIdx = 0, myPlayerIndex = 0, battleLayout = 'classic', lastAdoptedRestartCount = 0;
  const VERSION = '6.265', CASUAL_SLOW_PUSH_P95_MS = 5000, CASUAL_PUSH_MIN_CALLS = 10, PERF_SAMPLE_RATE = 0.1;
  const tApi = async (p, body) => { posts.push(body); return {}; };
  const _sampleStats = () => null, _pushSample = () => {}, oldestPushInFlightAgeMs = () => -1;
  const document = { visibilityState: 'visible' }, window = { innerWidth: 1, innerHeight: 1 }, navigator = { userAgent: 'x' };
  const _tSendClientDiag = (r) => { _casualDiagSend(r, Date.now()); };
  `;
  const fn = new Function('posts', prologue + js + '\nreturn _casualNotePhantomAdopt;')(posts);
  return { fn, posts };
}
await T('② 一般對局 100,000 次盤面採納：0 發請求，且總耗時 < 50ms（每次 <0.5µs 量級）', () => {
  const { fn, posts } = makeNote(PAGE);
  const local = { id: 'game-A' }, incoming = { id: 'game-A' };
  fn('adopt', local, incoming, 0);                     // 暖機
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100000; i++) fn('adopt', local, incoming, 0);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`        100,000 次：${ms.toFixed(2)} ms（每次 ${(ms * 1000 / 100000).toFixed(3)} µs），送出 ${posts.length} 發`);
  ok(posts.length === 0, '一般對局竟然送了 ' + posts.length + ' 發請求');
  ok(ms < 50, '總耗時 ' + ms.toFixed(2) + ' ms —— 熱路徑上有昂貴的東西');
});
await T('③ 判定函式的靜態成本：沒有計時器／網路／序列化／await（每次盤面更新都會跑到）', () => {
  const body = PAGE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1);
  const i = body.indexOf('function _casualNotePhantomAdopt(');
  ok(i > 0, '抓不到 _casualNotePhantomAdopt');
  let d = 0, k = body.indexOf('{', i), end = k;
  for (; k < body.length; k++) { if (body[k] === '{') d++; else if (body[k] === '}') { d--; if (!d) { end = k; break; } } }
  const seg = body.slice(i, end + 1);
  ok(seg.length > 200, '抽出來只有 ' + seg.length + ' 字元 —— 抽取器壞了');
  for (const bad of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch(', 'await ', 'JSON.stringify', 'structuredClone'])
    ok(!seg.includes(bad), '判定函式裡出現 ' + bad);
});

console.log(`\n=== v6.265 效能：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
