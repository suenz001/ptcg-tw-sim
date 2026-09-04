// v6.265 守衛 —— 開局 CAS 競態：`startGame` 的 won 判定（練習模式「手牌無預警重洗」的真因）
//
// ── 這一版在修什麼 ────────────────────────────────────────────────────────
// `oracleTx` 是**重試迴圈**（409 CAS 輸掉 / 逾時 → 重新拉盤面 → 對新盤面重跑 closure → 再寫）。
// 但四支呼叫端的旗標（`started` / `didReset`）都宣告在 `oracleTx` **外面**且每個 attempt
// **不歸零** ⇒ 只要任何一輪跑到那一行，回傳值就永遠 true。
//   ⇒ `startGame` 的輸家也以為自己贏了 ⇒ 採用自己的 phantom 局
//   ⇒ 幾秒後 canonical 局（不同 id）由輪詢送到 ⇒ `resolveRoomUpdate` 判 adopt
//   ⇒ **手牌整份被換掉＝玩家回報的「無預警重洗」**。
// Firestore 版（room.ts 的 runTransaction）回傳值取自最終那一輪 closure ⇒ 語意本來就是對的
//   ⇒ github.io 測試站永遠重現不了，只有 .com 正式站（room-oracle）會發生。
//
// ── 這支守衛的紀律（本專案已連續踩到八次「守衛安慰劑」）────────────────────
//   ・能實跑的一律實跑：room-oracle.ts 用 esbuild 轉 CJS、stub 掉 oracle-client **真的跑 startGame**；
//     +page.svelte 的 handleRoomUpdate 盤面區塊與整組休閒診斷函式也是**抽出來真的跑**；
//   ・HEAD-FAIL 對**真 BASE blob**（拿不到就用等價突變版，絕不 fail-open）；
//   ・每一條否定型都配正對照；
//   ・只捕捉 assert.AssertionError（其他例外一律炸出來）。
// Run: node scripts/test-v6265-phantom-start-race.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { transform, transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '3fd89b566d729ccddebb3014cdcb9d3cd4bd8fd5';   // v6.264（本版的前一版）
// ⚠⚠ v6.267 修正一個**一直沒有人發現的守衛過期**：`oracle-admin/server_admin_patch.js`
//   在 **v6.266**（套牌戰績伺服器端）被合法改過，但下面 F4 仍拿 v6.264 的 blob 逐字比對
//   ⇒ 只要物件庫拿得到歷史就必紅。CI 是 `fetch-depth: 1` 淺複製 ⇒ 一直靜默 shallowSkip、
//   從 v6.266 起這一條其實**沒有在守**。⇒ 改成「每個檔各自釘在最後一次合法改動的那一版」。
const BASE_SHA_V6266 = '63104f4e4c6d8dfc03d04f64369d0cc6f727b4e8';
// ⚠ v6.270 發現：server_admin_patch.js 在 v6.268（delta-put middleware）與 v6.269（休閒監控子表）
//   都被合法改過，但這條 F4 仍釘在 v6.266 —— 而 CI 淺複製、沙盒 git archive 都沒有歷史，
//   這條從 v6.268 起**其實沒有在守**（守衛只在「有完整歷史的環境」才會生效的又一例）。
//   ⇒ pin 前移到 v6.269（最後一次合法改動）；v6.270 本身不動 server_admin_patch.js，
//     其整檔 sha 由 test-v6270 的 B3 以內嵌 sha256 錨定（history-free，CI 上真的在守）。
const BASE_SHA_V6269 = 'd9f9b4351b5642095d59d7a2db9037064989855a';
// ⚠ v6.275 又一次發現同型過期（第三次）：server_admin_patch.js 在 v6.272／v6.275 被合法改過
//   （admin 端 Firestore/Auth 讀取減量）、sync-guards.ts 在 v6.274 被合法改過
//   （shouldResetStartGrace）—— F4/F5 的 pin 沒跟著前移，在有完整歷史的環境必紅。
//   ⇒ ①sync-guards/F5 的 pin 前移到 v6.274（那版的改動由 test-v6274 全面接管守備）；
//     ②server_admin_patch.js 改鎖**守護意圖本體**：錦標賽區塊（第一支 /api/tournament 起至檔尾）
//       的內嵌 sha256（與 test-v6272/test-v6275 同值，history-free、CI 上真的在守，
//       且 admin 區塊的合法演化不再需要每版回來改 pin）。
const BASE_SHA_V6274 = '4edf9e7f8ec13892d9abd4d22d9f675fbc6b8b54';
// ⭐ v6.310：v6.309 改了 sync-guards.ts（setupSeatRank 每座位同源合併）與 engine.ts（互動式建局結算），這兩個檔的整檔 pin 在那一版就過期了
//   （沙盒不是 git repo ⇒ 沒發現）。改法：sync-guards 的守備交給 test-v6274 E1/E2（resolveRoomUpdate／shouldSkipStalePush 本體 seg sha，錨點已前移）
//   ＋ 本檔 F5 改成「resolveRoomUpdate 本體與 v6.309 blob 的同一段逐字相同」（不 pin 整檔）；engine.ts 前移到 v6.309、剝掉 v6.310 的三行註解。
const BASE_SHA_V6309 = '039625c870f5243548d54c20abb1139bc34acc53';
// ⚠ v6.276 對錦標賽區塊做了 6 處**純 additive** 插入（報名/歸檔帶 deckId）⇒ 重釘；
//   「只有那 6 處」由 test-v6276 的 revert-diff 證明（還原後 sha 回到 34a8448b…）。
const TOURN_TAIL_SHA256_V6276 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';
const RO_PATH = 'src/lib/game/room-oracle.ts';
const RO = readFileSync(join(ROOT, RO_PATH), 'utf8');
const ROOM = readFileSync(join(ROOT, 'src/lib/game/room.ts'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
/** 突變測試：跑起來**必須**紅在指定那一條。沒紅 ⇒ 守衛是安慰劑。 */
async function mustBreak(name, run) {
  let red = null;
  try { await run(); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = e.message.split('\n')[0].slice(0, 78); }
  if (red !== null) { console.log('  OK   ' + name + '（如預期紅：' + red + '）'); pass++; return; }
  console.log('  FAIL ' + name + ' :: 突變後竟然還是綠的 —— 這條守衛沒有在守');
  fail++;
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                              .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

// ══════════════════════════════════════════════════════════════════════════
// 共用：把 room-oracle.ts 變成可實跑的 CJS 模組（stub 掉所有外部相依）
// ══════════════════════════════════════════════════════════════════════════
function loadRoomOracle(srcText, server) {
  const code = transformSync(srcText, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const stubs = {
    './oracle-client': {
      oracleAuth: async () => ({ uid: 'U1' }), oracleApi: async () => ({}),
      oracleGetRoom: async (c) => server.get(c),
      oracleUpsertRoom: async (c, d, v, o) => server.put(c, d, v, o),
      oracleDeleteRoom: async () => {}, oracleListRooms: async () => [],
      oraclePollRoom: () => () => {}, oracleListMessages: async () => [],
      oracleCurrentUid: () => 'U1', oracleListRoomsCombined: async () => [],
      ROOMS_UNCHANGED: Symbol('u'), ROOMS_COMBINED_UNSUPPORTED: Symbol('c'),
      isOracleTimeout: (e) => !!(e && e.__timeout),
      isOracleUploadBudgetTimeout: (e) => !!(e && e.__uploadBudget),
      ORACLE_SIDEEFFECT_TIMEOUT_MS: 60000,
    },
    '$lib/firebase': { auth: { currentUser: null } },
    './engine': { createGame: () => ({ id: 'restart-' + (server.restartSeq = (server.restartSeq || 0) + 1), phase: 'setup' }) },
    './sync-guards': { shouldSkipStalePush: () => false },
    '$lib/ui/stale-keep': { adoptOrKeep: (p, n) => ({ data: n ?? p, stale: n == null }) },
    './room': {
      SEAT_LAYOUT_VERSION: 1, TOTAL_SEATS: 10, SPECTATOR_SEATS: 8, HEARTBEAT_STALE_MS: 1,
      generateRoomCode: () => 'AAAA', findMySeatIdx: () => 0, countDeckCards: () => 60,
      bothPlayersReady: () => true, isSeatStale: () => false,
      LOBBY_HOST_AWAY_MS: 1, LOBBY_HOST_STALE_MS: 1, hostPresence: () => 'ok',
      isLobbyHostDead: () => false, isLobbyTooOld: () => false,
    },
  };
  const mod = { exports: {} };
  const req = (id) => { if (!(id in stubs)) throw new Error('未預期的 import：' + id); return stubs[id]; };
  const f = new Function('module', 'exports', 'require', 'console', 'setTimeout',
    code + '\nreturn module.exports;');
  return f(mod, mod.exports, req, { warn() {}, error() {}, log() {} }, (fn) => fn());
}

/**
 * 假伺服器：CAS（`_version`）＋可注入的 409／逾時腳本。
 * @param echoGameState false ＝ PUT 的 ok 回應**不**把 gameState 帶回來（模擬舊伺服器／回應被裁切）
 */
function makeServer(initial, plan, { echoGameState = true } = {}) {
  let doc = { ...initial, _version: 5 };
  const log = []; let n = 0;
  const echo = (d) => (echoGameState ? { ...d } : (() => { const c = { ...d }; delete c.gameState; return c; })());
  return {
    log, doc: () => doc, puts: () => n,
    get: async () => { log.push(`GET v${doc._version} ${doc.gameState ? doc.gameState.id : 'null'}`); return { ...doc }; },
    put: async (c, data, expected) => {
      n++;
      const act = plan(n, doc);
      if (act === 'timeout') { log.push(`PUT#${n} → TIMEOUT`); const e = new Error('timeout'); e.__timeout = true; throw e; }
      if (act && act.landAndTimeout) {
        doc = { ...data, _version: doc._version + 1 };
        log.push(`PUT#${n} → 送達但回應逾時（房間＝${doc.gameState ? doc.gameState.id : 'null'}）`);
        const e = new Error('timeout'); e.__timeout = true; throw e;
      }
      if (act && act.otherWrites) {
        doc = { ...doc, ...act.otherWrites, _version: doc._version + 1 };
        log.push(`PUT#${n} → CONFLICT（房間被寫成 ${doc.gameState ? doc.gameState.id : 'null'}）`);
        return { conflict: true, currentVersion: doc._version, room: echo(doc) };
      }
      if (expected !== undefined && expected !== doc._version) {
        log.push(`PUT#${n} → CONFLICT（版本不符）`);
        return { conflict: true, currentVersion: doc._version, room: echo(doc) };
      }
      doc = { ...data, _version: doc._version + 1 };
      log.push(`PUT#${n} → OK（房間 gameState=${doc.gameState ? doc.gameState.id : 'null'}）`);
      return { ok: true, version: doc._version, room: echo(doc) };
    },
  };
}
const LOBBY = { _id: 'ROOM', status: 'lobby', gameState: null, seats: [], heartbeats: {} };
const MINE = { id: 'game-A', phase: 'setup', createdAt: 1000, createdAtSrv: 1000 };
const THEIRS = { id: 'game-B', phase: 'setup', createdAt: 1001, createdAtSrv: 1001 };

/** 四種情境（① 409 ② 逾時 ③ 無衝突 ④ 我方 PUT 送達但回應逾時）。 */
const PLANS = {
  conflict409: () => (n) => (n === 1 ? { otherWrites: { status: 'playing', gameState: THEIRS } } : null),
  timeout: () => (n, doc) => {
    if (n === 1) { doc.status = 'playing'; doc.gameState = THEIRS; doc._version++; return 'timeout'; }
    return null;
  },
  clean: () => () => null,
  landedButTimedOut: () => (n) => (n === 1 ? { landAndTimeout: true } : null),
};
async function runStart(srcText, planName, opts = {}) {
  const srv = makeServer(LOBBY, PLANS[planName](), opts);
  const M = loadRoomOracle(srcText, srv);
  const won = await M.startGame('ROOM', MINE);
  return { won, canonical: srv.doc().gameState ? srv.doc().gameState.id : null, log: srv.log, puts: srv.puts(), M, srv };
}

// ── BASE(v6.264) 對照：拿得到就用真 blob；淺複製時用等價突變版（絕不 fail-open）──────
let baseRO = null;
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const r = readBaseBlob(ROOT, BASE_SHA, RO_PATH);
  baseRO = r.ok ? r.out : null;
}
/** 把 v6.265 的兩個機制改回 v6.264 的樣子（＝等價 BASE，也是突變素材）。 */
function revertToBase(s) {
  return s
    .replace(/    \/\/ ⭐⭐⭐v6\.265【結構性複驗】[\s\S]*?    return marked;\n/,
      '    return marked;\n')
    .replace('    marked = false;                          // ⭐ 每個 attempt 重判：旗標絕不可以跨輪殘留\n', '');
}
const BASE_RO = baseRO || revertToBase(RO);
const BASE_KIND = baseRO ? '真 BASE blob' : '等價突變版（CI 淺複製）';
if (!baseRO) shallowSkip('【A】對真 BASE blob 的 HEAD-FAIL', '改用等價突變版，斷言照跑（不是靜默跳過）');

console.log('\n══ v6.265 開局 CAS 競態：startGame 的 won 判定 ══');
console.log('\n【0】harness 自我驗證（Rule 25：掃描器／harness 自己要先被驗過）');
await T('0-1 BASE 與本版都載得起來，而且「無衝突」情境兩邊都只發 1 次 PUT（harness 沒壞）', async () => {
  const a = await runStart(BASE_RO, 'clean'), b = await runStart(RO, 'clean');
  ok(a.puts === 1 && b.puts === 1, `PUT 次數 BASE=${a.puts} 本版=${b.puts}`);
  ok(a.canonical === 'game-A' && b.canonical === 'game-A', '無衝突時房間 canonical 不是 game-A');
});
await T('0-2 假伺服器的 CAS 真的會擋（正對照：版本不符必回 conflict）', async () => {
  const srv = makeServer(LOBBY, () => null);
  const r1 = await srv.put('ROOM', { ...LOBBY, gameState: MINE }, 999);
  ok('conflict' in r1, '版本不符竟然寫成功了 —— 假伺服器沒有 CAS，【A】整節都是假的');
  const r2 = await srv.put('ROOM', { ...LOBBY, gameState: MINE }, 5);
  ok('ok' in r2, '版本相符卻寫不進去');
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n【A】HEAD-FAIL：對 ${BASE_KIND} 必須紅，本版必須綠（每一條各自紅）`);
// ══════════════════════════════════════════════════════════════════════════
await T('A1 ⭐⭐⭐【409】attempt1 標記後輸掉 CAS ⇒ BASE 誤判 won=true（輸家以為自己贏了）', async () => {
  const b = await runStart(BASE_RO, 'conflict409');
  ok(b.canonical === 'game-B', '情境沒建立起來：房間 canonical 是 ' + b.canonical);
  ok(b.won === true, 'BASE 竟然沒有誤判（won=' + b.won + '）—— HEAD-FAIL 不成立，這條守衛沒有在守');
  console.log('        BASE 重現：' + b.log.join(' | ') + ' ⇒ won=' + b.won);
});
await T('A2 ⭐⭐⭐【409】本版必須判 won=false（房間 canonical 是對手那一局）', async () => {
  const n = await runStart(RO, 'conflict409');
  ok(n.canonical === 'game-B', '情境沒建立起來');
  ok(n.won === false, '本版仍然誤判 won=' + n.won);
});
await T('A3 ⭐⭐⭐【逾時】attempt1 標記後 PUT 逾時、重試時房間已是對手的局 ⇒ BASE 誤判 won=true', async () => {
  const b = await runStart(BASE_RO, 'timeout');
  ok(b.canonical === 'game-B', '情境沒建立起來：' + b.canonical);
  ok(b.won === true, 'BASE 竟然沒有誤判（won=' + b.won + '）');
  console.log('        BASE 重現：' + b.log.join(' | ') + ' ⇒ won=' + b.won);
});
await T('A4 ⭐⭐⭐【逾時】本版必須判 won=false', async () => {
  const n = await runStart(RO, 'timeout');
  ok(n.canonical === 'game-B', '情境沒建立起來');
  ok(n.won === false, '本版仍然誤判 won=' + n.won);
});
await T('A5 ⭐⭐【409＋伺服器沒回 gameState】fail-safe 路徑：BASE 誤判、本版仍判 false', async () => {
  const b = await runStart(BASE_RO, 'conflict409', { echoGameState: false });
  const n = await runStart(RO, 'conflict409', { echoGameState: false });
  ok(b.won === true, 'BASE 在 fail-safe 情境沒有誤判');
  ok(n.won === false, '本版在「伺服器沒把 gameState 回傳」時判成 ' + n.won + ' —— per-attempt 歸零沒生效');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【B】正對照 (a)(b)(c)：功能沒被關掉、Firestore 版沒被動、一般對局逐位元不變');
// ══════════════════════════════════════════════════════════════════════════
await T('B1 (a) 真的贏的那一方 won 仍是 true（沒有把建局功能關掉）', async () => {
  const n = await runStart(RO, 'clean');
  ok(n.won === true, '真正的贏家被判成 ' + n.won + ' —— 建局功能被關掉了');
  ok(n.canonical === 'game-A');
});
await T('B1b (a) 伺服器沒回 gameState 時，真正的贏家**照樣**是 true（fail-safe 不可以把功能關掉）', async () => {
  const n = await runStart(RO, 'clean', { echoGameState: false });
  ok(n.won === true, 'fail-safe 情境下贏家被判成 ' + n.won);
});
await T('B1c (a) 我方 PUT 送達、只是回應逾時 ⇒ 房間就是我這一局 ⇒ won 必須是 true', async () => {
  const n = await runStart(RO, 'landedButTimedOut');
  ok(n.canonical === 'game-A', '情境沒建立起來');
  ok(n.won === true, '房間 canonical 明明是我這一局，卻判成 ' + n.won);
});
await T('B2 (b) Firestore 版 room.ts 的 startGame 與 BASE **逐字元相同**（它是對的，不可以被改壞）', () => {
  const cur = (() => { const i = ROOM.indexOf('export async function startGame('); ok(i > 0, '抓不到 room.ts 的 startGame');
    const j = ROOM.indexOf('\n}\n', i); ok(j > i, 'startGame 結尾定位不到'); return ROOM.slice(i, j + 3); })();
  ok(cur.includes('runTransaction'), 'Firestore 版竟然不再用 runTransaction —— 語意被換掉了');
  ok(!cur.includes('oracleTxFlagged'), 'Firestore 版被塞進 oracle 專用的 helper');
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('B2 對 BASE 的逐字比對', '上面兩條結構斷言仍在守'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room.ts');
  ok(b.ok, '讀不到 BASE 的 room.ts');
  // ⚠ v6.267 收窄：原本比對**整份檔案**，但這一條要守的是「Firestore 版的 startGame 不可以被
  //   改壞」；整份檔案的比對會讓「同一個檔案裡別的函式被合法改動」（v6.267 的 seats[].deckId）
  //   誤紅。⇒ 改成只對 **startGame 這一段**做逐字比對 —— 範圍更準、強度不變。
  const baseFn = (() => { const i = b.out.indexOf('export async function startGame(');
    ok(i > 0, 'BASE 的 room.ts 抓不到 startGame'); const j = b.out.indexOf('\n}\n', i); return b.out.slice(i, j + 3); })();
  ok(baseFn.length > 500, 'BASE 的 startGame 只抽到 ' + baseFn.length + ' 字元 —— 抽取器壞了？');
  assert.strictEqual(cur, baseFn, 'src/lib/game/room.ts 的 startGame 被動過了（Firestore 版必須逐字不變）');
});
await T('B3 (c) 一般對局（沒有任何衝突）：請求序列與 BASE **逐字相同**、PUT 次數相同', async () => {
  const b = await runStart(BASE_RO, 'clean'), n = await runStart(RO, 'clean');
  assert.deepStrictEqual(n.log, b.log, '一般對局的請求序列被改變了');
  assert.strictEqual(n.puts, b.puts);
  assert.strictEqual(n.won, b.won);
});
await T('B4 (c) 其餘 25 支 oracleTx 呼叫端的請求行為與 BASE 相同（heartbeat／推盤面／悔棋各跑一次）', async () => {
  const cases = [
    ['heartbeat', (M) => M.heartbeat('ROOM', 0)],
    ['pushGameState', (M) => M.pushGameState('ROOM', { ...MINE, phase: 'playing', log: [] })],
    ['pushUndoRollback', (M) => M.pushUndoRollback('ROOM', { ...MINE, phase: 'playing', log: [] })],
    ['requestUndo', (M) => M.requestUndo('ROOM', 0, 'x')],
    ['clearUndoRequest', (M) => M.clearUndoRequest('ROOM')],
  ];
  for (const [name, run] of cases) {
    const sb = makeServer({ ...LOBBY, status: 'playing', gameState: { ...MINE, phase: 'playing', log: [] } }, () => null);
    const sn = makeServer({ ...LOBBY, status: 'playing', gameState: { ...MINE, phase: 'playing', log: [] } }, () => null);
    await run(loadRoomOracle(BASE_RO, sb));
    await run(loadRoomOracle(RO, sn));
    assert.deepStrictEqual(sn.log, sb.log, name + ' 的請求序列與 BASE 不同');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【C】同型缺口全站枚舉：不得再有「旗標宣告在 oracleTx 重試迴圈外」');
// ══════════════════════════════════════════════════════════════════════════
/** 掃 oracleTx 的每一個呼叫，抓出「closure 內賦值、但宣告在 closure 外」的變數。 */
function scanExternalFlags(src) {
  const matchPair = (s, i, o, c) => { let d = 0; for (; i < s.length; i++) { if (s[i] === o) d++; else if (s[i] === c) { d--; if (!d) return i; } } return -1; };
  const calls = [];
  for (const m of src.matchAll(/oracleTx\(/g)) {
    const op = m.index + m[0].length - 1;
    const cl = matchPair(src, op, '(', ')');
    const span = src.slice(op, cl + 1);
    const ln = src.slice(0, m.index).split('\n').length;
    const am = /=>\s*([{(])/.exec(span);
    if (!am) { calls.push({ ln, kind: 'no-arrow', ext: [] }); continue; }
    if (am[1] === '(') { calls.push({ ln, kind: 'expr-body', ext: [] }); continue; }   // 物件箭頭：結構上沒有語句
    const bs = op + am.index + am[0].length - 1;
    const body = src.slice(bs + 1, matchPair(src, bs, '{', '}'));
    const decl = new Set([...body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1]));
    const assigned = [...new Set([...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=(?!=|>)/g)].map((x) => x[1]))]
      .filter((v) => !decl.has(v));
    // ⭐ 合格條件：closure 的**第一個語句**就是把該旗標歸零（＝每個 attempt 重判）。
    //   這正是 v6.265 的中央 helper `oracleTxFlagged` 在做的事 —— 它是唯一合格的樣本。
    const first = /^\s*([A-Za-z_$][\w$]*)\s*=\s*false\s*;/.exec(body);
    const resetVar = first ? first[1] : null;
    const ext = assigned.filter((v) => v !== resetVar);
    calls.push({ ln, kind: 'block-body', ext, resetVar });
  }
  return calls;
}
// ⭐⭐ history-free 的內嵌樣本：v6.264 那四個呼叫點的**實際形狀**（含物件展開、型別斷言、多行 body）。
//   淺複製的 CI 拿不到 BASE blob，但掃描器仍然必須被驗過 —— 所以判準放在這裡，不放在歷史上。
const BASE_SHAPES = [
  ['startGame', 'started', `    let started = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      if (data.status !== 'lobby') return data;
      if (data.gameState) return data;
      started = true;
      return { ...data, gameState: JSON.parse(JSON.stringify(gameState)), status: 'playing' };
    }, { timeoutMs: ORACLE_SIDEEFFECT_TIMEOUT_MS });`],
  ['checkAndAcceptRematch', 'didReset', `    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const ready = data.rematchReady ?? {};
      if (!ready[0] || !ready[1]) return data;
      const newSeats = data.seats.map(s => ({ ...s, ready: false }));
      didReset = true;
      return { ...data, gameState: null, seats: newSeats } as unknown as RoomData;
    });`],
  ['checkAndAcceptRestart', 'didReset', `    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const p = data.restartProposed ?? {};
      if (!p[0] || !p[1]) return data;
      const newGame = createGame({ name: 'a', entries: [] }, { name: 'b', entries: [] }, pool, {});
      didReset = true;
      return { ...data, gameState: JSON.parse(JSON.stringify(newGame)) } as unknown as RoomData;
    });`],
  ['checkAndAcceptReturnToRoom', 'didReset', `    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const p = data.returnRoomProposed ?? {};
      if (!p[0] || !p[1]) return data;
      didReset = true;
      return { ...data, status: 'lobby', gameState: null } as unknown as RoomData;
    });`],
];
await T('C0 ⭐⭐ 掃描器自我驗證（history-free）：v6.264 那四個形狀**每一個**都要被抓到', () => {
  for (const [name, flag, sample] of BASE_SHAPES) {
    const found = scanExternalFlags(stripComments(sample)).filter((c) => c.ext.length);
    ok(found.length === 1, name + ' 的形狀抓到 ' + found.length + ' 處（應為 1）—— 掃描器漏看這一種寫法');
    ok(found[0].ext.includes(flag), name + ' 抓到的旗標是 ' + found[0].ext + '（應為 ' + flag + '）');
  }
});
await T('C0-blob ⭐ 對**真 BASE blob** 必須抓到恰 4 處（淺複製時大聲跳過，不 fail-open）', () => {
  if (!baseRO) { shallowSkip('C0-blob 對真 BASE blob 的四處枚舉', 'C0 的內嵌樣本已覆蓋同樣四種形狀'); return; }
  const found = scanExternalFlags(stripComments(baseRO)).filter((c) => c.ext.length);
  ok(found.length === 4, '在真 BASE blob 上抓到 ' + found.length + ' 處（應為 4）：'
    + JSON.stringify(found.map((c) => 'L' + c.ln + ':' + c.ext)));
  const names = new Set(found.flatMap((c) => c.ext));
  ok(names.has('started') && names.has('didReset'), '抓到的不是那四個旗標：' + [...names]);
});
await T('C0a 掃描器正對照：closure 第一行歸零的樣本**不可以**被判成違規（否則 C1 是恆真）', () => {
  const good = `await oracleTx('R', (data) => { f = false; if (x) return data; f = true; return data; });`;
  const bad = `await oracleTx('R', (data) => { if (x) return data; f = true; return data; });`;
  ok(scanExternalFlags(good)[0].ext.length === 0, '合格樣本被誤判成違規 —— 掃描器過嚴，C1 會是恆假');
  ok(scanExternalFlags(bad)[0].ext.length === 1, '違規樣本沒被抓到 —— 掃描器過鬆，C1 會是恆真');
});
await T('C0b 掃描器下限斷言：oracleTx 的呼叫點必須 ≥ 25 個（掃描器壞掉時不可以「全部通過」）', () => {
  const all = scanExternalFlags(stripComments(RO));
  ok(all.length >= 25, '只掃到 ' + all.length + ' 個 oracleTx 呼叫 —— 掃描器壞了');
  ok(all.some((c) => c.kind === 'expr-body'), '一個物件箭頭都沒認出來 —— 掃描器的分支沒被走到');
});
await T('C1 ⭐⭐⭐ 本版：room-oracle.ts 已經**一處都不剩**', () => {
  const found = scanExternalFlags(stripComments(RO)).filter((c) => c.ext.length);
  ok(found.length === 0, '還有 ' + found.length + ' 處旗標寫在重試迴圈外：'
    + JSON.stringify(found.map((c) => 'L' + c.ln + ':' + c.ext)));
});
await T('C2 ⭐ 四支呼叫端都收斂到同一個 helper（不是三處各寫一套）', () => {
  const body = stripComments(RO);
  const n = (body.match(/oracleTxFlagged\(/g) || []).length;
  ok(n === 5, 'oracleTxFlagged 出現 ' + n + ' 次（1 個定義 + 4 個呼叫端 = 5）');
  for (const fnName of ['startGame', 'checkAndAcceptRematch', 'checkAndAcceptRestart', 'checkAndAcceptReturnToRoom']) {
    const i = body.indexOf('export async function ' + fnName + '(');
    ok(i > 0, '抓不到 ' + fnName);
    const seg = body.slice(i, i + 2600);
    ok(seg.includes('oracleTxFlagged('), fnName + ' 沒有走中央 helper');
  }
});
await T('C3 ⭐ 三支 checkAndAccept* 的行為：409 重試後「最後一輪沒做事」就必須回 false', async () => {
  // 情境：attempt1 看到雙方都同意 → 標記；PUT 輸掉 CAS，且對手已把提案清掉 ⇒ attempt2 不該再做
  const mk = (src, field) => {
    const init = { ...LOBBY, status: 'playing', gameState: { ...MINE, phase: 'playing', log: [] },
      seats: [{ ready: true, deckEntries: [], name: 'a' }, { ready: true, deckEntries: [], name: 'b' }],
      [field]: { 0: true, 1: true } };
    const srv = makeServer(init, (n, doc) => (n === 1 ? { otherWrites: { [field]: null } } : null));
    return { srv, M: loadRoomOracle(src, srv) };
  };
  for (const [fnName, field] of [['checkAndAcceptRematch', 'rematchReady'],
                                 ['checkAndAcceptRestart', 'restartProposed'],
                                 ['checkAndAcceptReturnToRoom', 'returnRoomProposed']]) {
    const b = mk(BASE_RO, field), n = mk(RO, field);
    const rb = await (fnName === 'checkAndAcceptRestart' ? b.M[fnName]('ROOM', new Map()) : b.M[fnName]('ROOM'));
    const rn = await (fnName === 'checkAndAcceptRestart' ? n.M[fnName]('ROOM', new Map()) : n.M[fnName]('ROOM'));
    ok(rb === true, fnName + ' 在 BASE 上竟然沒有誤判（回 ' + rb + '）—— HEAD-FAIL 不成立');
    ok(rn === false, fnName + ' 本版仍然誤判（回 ' + rn + '）');
  }
});
await T('C3b ⭐ 正對照：三支 checkAndAccept* 在**沒有衝突**時仍然回 true', async () => {
  for (const [fnName, field] of [['checkAndAcceptRematch', 'rematchReady'],
                                 ['checkAndAcceptRestart', 'restartProposed'],
                                 ['checkAndAcceptReturnToRoom', 'returnRoomProposed']]) {
    const init = { ...LOBBY, status: 'playing', gameState: { ...MINE, phase: 'playing', log: [] },
      seats: [{ ready: true, deckEntries: [], name: 'a' }, { ready: true, deckEntries: [], name: 'b' }], [field]: { 0: true, 1: true } };
    const srv = makeServer(init, () => null);
    const M = loadRoomOracle(RO, srv);
    const r = await (fnName === 'checkAndAcceptRestart' ? M[fnName]('ROOM', new Map()) : M[fnName]('ROOM'));
    ok(r === true, fnName + ' 在無衝突時回了 ' + r + ' —— 功能被關掉了');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【D】休閒診斷指紋 casual-phantom-adopt：抽出真函式實跑（不是驗字串）');
// ══════════════════════════════════════════════════════════════════════════
const DIAG_A = '  /** ⭐v6.261 診斷回傳的**唯一**送出點';
const DIAG_B = '  // v5.618：手動/自動「重新同步」';
function diagBlock(src) {
  const i = src.indexOf(DIAG_A); ok(i > 0, '抓不到休閒診斷函式群的起點');
  const j = src.indexOf(DIAG_B, i); ok(j > i, '抓不到休閒診斷函式群的終點');
  const c = src.indexOf('  const CASUAL_DIAG_REASONS'); ok(c > 0, '抓不到 CASUAL_DIAG_REASONS');
  const c2 = src.indexOf('  const CASUAL_SLOW_PUSH_P95_MS', c); ok(c2 > c, '抓不到常數區的終點');
  return src.slice(c, c2) + '\n' + src.slice(i, j);
}
/** 把休閒診斷那一整組函式抽出來，在受控 scope 裡真的跑。 */
function makeDiag(src, env) {
  const js = transformSync(diagBlock(src), { loader: 'ts', target: 'node18' }).code;
  const prologue = `
  let isTournament = env.isTournament, isTournSpectator = env.isTournSpectator ?? false;
  let mode = env.mode, roomCode = env.roomCode, firebaseUser = env.firebaseUser;
  let _casualDiagSent = 0, game = env.game, roomData = env.roomData;
  let _casualPushSamples = [], _casualPushFail = 0, _casualSlowSent = false, _casualClaimSent = false;
  let _casualSampleRoom = '', _casualSampleArmed = false, _casualSampleSent = false, _casualClaimGranted = null;
  let _casualPhantomSent = false, _casualPhantom = null;
  let _startGameWon = env._startGameWon ?? null, _startGameReadyMs = env._startGameReadyMs ?? -1;
  let mySeatIdx = 0, myPlayerIndex = 0, battleLayout = 'classic';
  let lastAdoptedRestartCount = env.lastAdoptedRestartCount ?? 0;
  // v6.280 起 payload 的 phantom 區塊會帶這兩個純計數指紋（stub；語義見 test-v6280）
  let _rejPhantomSetup = env._rejPhantomSetup ?? 0, _startGameCalls = env._startGameCalls ?? 0;
  const VERSION = '6.265';
  const CASUAL_SLOW_PUSH_P95_MS = 5000, CASUAL_PUSH_MIN_CALLS = 10, PERF_SAMPLE_RATE = 0.1;
  const tApi = env.tApi;
  const _sampleStats = () => null, _pushSample = () => {}, oldestPushInFlightAgeMs = () => -1;
  const document = { visibilityState: 'visible' }, window = { innerWidth: 1, innerHeight: 1 }, navigator = { userAgent: 'x' };
  const _tSendClientDiag = (reason) => { if (_casualDiagSend(reason, Date.now())) return; env.tournamentPath(reason); };
  `;
  // ⚠ HEAD-FAIL 紀律：BASE 上沒有 `_casualNotePhantomAdopt` —— 用 `typeof` 取（對未宣告識別字安全），
  //   讓**每一條**斷言各自紅，而不是整支腳本在建構期就 ReferenceError 崩掉。
  const epilogue = `
  return { _casualDiagSend, _casualDiagPayload, _casualDiagReset, _tSendClientDiag,
           _casualNotePhantomAdopt: (typeof _casualNotePhantomAdopt === 'function' ? _casualNotePhantomAdopt : null),
           sentCount: () => _casualDiagSent, phantomSent: () => _casualPhantomSent };`;
  let api;
  try { api = new Function('env', prologue + js + epilogue)(env); }
  catch (e) { throw new assert.AssertionError({ message: '休閒診斷函式群載不起來：' + e.message }); }
  const note = api._casualNotePhantomAdopt;
  api._casualNotePhantomAdopt = (...a) => {
    if (typeof note !== 'function') throw new assert.AssertionError({ message: '+page.svelte 沒有 _casualNotePhantomAdopt（本版的新判定點不存在）' });
    return note(...a);
  };
  return api;
}
function diagEnv(over = {}) {
  const posts = [], tournHits = [];
  const env = Object.assign({
    isTournament: false, mode: 'online', roomCode: 'ROOM',
    firebaseUser: { isAnonymous: false },
    game: { id: 'game-A', phase: 'playing', turn: 3, log: [] },
    roomData: { idleTimeoutSec: 180 }, _startGameWon: true, _startGameReadyMs: 7200,
    lastAdoptedRestartCount: 0,
    tApi: async (p, body) => { posts.push({ p, bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'), body }); return {}; },
    tournamentPath: (r) => { tournHits.push(r); },
  }, over);
  return { env, posts, tournHits };
}
await T('D0 harness 自我驗證：既有的 casual-slow-push 走得通、且不會掉進錦標賽路徑（正對照）', () => {
  const { env, posts, tournHits } = diagEnv();
  const d = makeDiag(PAGE, env);
  d._tSendClientDiag('casual-slow-push');
  ok(posts.length === 1, '既有指紋送出 ' + posts.length + ' 發 —— harness 壞了，下面全部不可信');
  ok(tournHits.length === 0, '休閒指紋掉進錦標賽路徑');
  ok(posts[0].body.mode === 'casual' && posts[0].body.reason === 'casual-slow-push');
});
await T('D1 ⭐⭐⭐（d）一般玩家 **0 發／0 bytes**：同一局前進 200 次，一發都不送', () => {
  const { env, posts } = diagEnv();
  const d = makeDiag(PAGE, env);
  for (let i = 0; i < 200; i++) d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-A' }, 0);
  ok(posts.length === 0, '一般對局竟然送了 ' + posts.length + ' 發');
  ok(posts.reduce((a, b) => a + b.bytes, 0) === 0, '一般對局的上行不是 0 bytes');
});
await T('D1b ⭐⭐（d）非 adopt 的判決（merge-prize／merge-setup／reject）一律不送', () => {
  const { env, posts } = diagEnv();
  const d = makeDiag(PAGE, env);
  for (const k of ['merge-prize', 'merge-setup', 'reject', 'apply-undo', 'ignore'])
    d._casualNotePhantomAdopt(k, { id: 'game-A' }, { id: 'game-B' }, 0);
  ok(posts.length === 0, 'kind=' + '非 adopt' + ' 竟然送了 ' + posts.length + ' 發');
});
await T('D1c ⭐⭐（d）本地沒有局（剛進場／剛重整）採納任何盤面都不送', () => {
  const { env, posts } = diagEnv();
  const d = makeDiag(PAGE, env);
  d._casualNotePhantomAdopt('adopt', null, { id: 'game-B' }, 0);
  ok(posts.length === 0, '本地無局竟然送了 ' + posts.length + ' 發');
});
await T('D1d ⭐⭐（d）雙方同意的「重新開局」不送（restartProposalCount 遞增＝合法）', () => {
  const { env, posts } = diagEnv({ lastAdoptedRestartCount: 0 });
  const d = makeDiag(PAGE, env);
  d._casualNotePhantomAdopt('adopt', { id: 'game-A', phase: 'playing' }, { id: 'game-R', phase: 'setup' }, 1);
  ok(posts.length === 0, '合法重新開局竟然送了 ' + posts.length + ' 發');
});
await T('D2 ⭐⭐⭐ 真的發生 phantom adopt 時**必須**送一發，而且帶得出四項證據（否定型的正對照）', () => {
  const { env, posts } = diagEnv();
  const d = makeDiag(PAGE, env);
  d._casualNotePhantomAdopt('adopt', { id: 'game-A', createdAtSrv: 1000 }, { id: 'game-B', createdAtSrv: 1001 }, 0);
  ok(posts.length === 1, '應送 1 發，實際 ' + posts.length);
  const b = posts[0].body;
  assert.strictEqual(b.reason, 'casual-phantom-adopt');
  assert.strictEqual(b.mode, 'casual');
  ok(b.phantom, 'payload 沒有 phantom 區塊');
  assert.strictEqual(b.phantom.won, true, 'wonStartGame 沒帶出來');
  assert.strictEqual(b.phantom.readyMs, 7200, 'readyElapsedMs 沒帶出來');
  assert.strictEqual(b.phantom.localSrv, 1000);
  assert.strictEqual(b.phantom.incomingSrv, 1001);
});
await T('D3 ⭐ 每場最多一發（重複發生不會變成回報噪音）', () => {
  const { env, posts } = diagEnv();
  const d = makeDiag(PAGE, env);
  for (let i = 0; i < 10; i++) d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-' + i }, 0);
  ok(posts.length === 1, '送了 ' + posts.length + ' 發（每場只該 1 發）');
  d._casualDiagReset();
  d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-Z' }, 0);
  ok(posts.length === 2, '換局後旗標沒有清乾淨（實際 ' + posts.length + ' 發）');
});
await T('D4 ⭐⭐ 匿名／未登入、非 online、觀戰一律不送（v6.261 的四道保證沒有被繞過）', () => {
  for (const over of [{ firebaseUser: null }, { firebaseUser: { isAnonymous: true } },
                      { mode: 'local' }, { roomCode: '' }, { isTournSpectator: true }]) {
    const { env, posts, tournHits } = diagEnv(over);
    const d = makeDiag(PAGE, env);
    d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-B' }, 0);
    ok(posts.length === 0, JSON.stringify(over) + ' 竟然送了 ' + posts.length + ' 發');
    ok(tournHits.length === 0, JSON.stringify(over) + ' 掉進錦標賽路徑');
  }
});
await T('D5 ⭐⭐ 隱私：payload 不含 email／暱稱／牌組／卡名（沿用 v6.261 的紀律）', () => {
  const { env, posts } = diagEnv();
  const d = makeDiag(PAGE, env);
  d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-B' }, 0);
  const s = JSON.stringify(posts[0].body);
  for (const bad of ['email', 'deckEntries', 'cardId', 'displayName', 'nickname'])
    ok(!s.includes(bad), 'payload 出現 ' + bad);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【E】接線：把 handleRoomUpdate 的盤面區塊抽出來真的跑（v6.154 教訓）');
// ══════════════════════════════════════════════════════════════════════════
const HRU_A = "    if (room.gameState) {\n      const incoming = room.gameState;";
const HRU_B = "\n    // v2.72：雙方 P1/P2 都 ready";
function hruBlock(src) {
  const i = src.indexOf(HRU_A); ok(i > 0, '抓不到 handleRoomUpdate 的盤面區塊起點');
  const j = src.indexOf(HRU_B, i); ok(j > i, '抓不到盤面區塊終點');
  const blk = src.slice(i, j);
  let d = 0; for (const c of blk) { if (c === '{') d++; else if (c === '}') d--; }
  ok(d === 0, '盤面區塊的大括號沒配對（抽取器壞了）');
  return blk;
}
const SG = await (async () => {
  const { build } = await import('esbuild');
  const out = join(ROOT, 'scripts/.v6265-sync-guards.mjs');
  await build({ entryPoints: [join(ROOT, 'src/lib/game/sync-guards.ts')], outfile: out, bundle: true,
    format: 'esm', platform: 'neutral', target: 'node18', alias: { $lib: join(ROOT, 'src/lib') }, logLevel: 'error' });
  const m = await import(out + '?t=' + Date.now());
  const { unlinkSync } = await import('node:fs'); try { unlinkSync(out); } catch { /* ignore */ }
  return m;
})();
function makeHandler(src, state, hooks) {
  const js = transformSync(hruBlock(src), { loader: 'ts', target: 'node18' }).code;
  const prologue = `
  let game = state.game, lastSeenUndoApplyAt = state.lastSeenUndoApplyAt ?? 0, _forceAdoptNext = state._forceAdoptNext ?? false;
  let _activeGameId = state._activeGameId ?? null, myPlayerIndex = state.myPlayerIndex ?? 0;
  let lastAdoptedRestartCount = state.lastAdoptedRestartCount ?? 0, roomCode = 'ROOM';
  let _unpushedState = state._unpushedState ?? null, _repushAttempts = state._repushAttempts ?? 0;
  let undoSnapshot = state.undoSnapshot ?? null, undoActionDesc = null, undoAwaitingResponse = false, undoDeniedThisSnapshot = false;
  let floatingEvoMenu = null, floatingRetreatMenu = null, selectedEnergyIid = null;
  let prizeAnimKey = [0, 0], arrivingIids = new Set(), justArrivedIids = new Set();
  const pool = new Map();
  const { resolveRoomUpdate, isStaleFinishedGame } = hooks.SG;
  const playSfx = () => {}, staggerSfx = () => {}, detectSpectatorStateDiffSfx = () => {};
  const pushTracked = async () => {}, tryPromoteToMainForFestival = (g) => g;
  const _casualNotePhantomAdopt = hooks.note;
  const console = { warn() {}, log() {}, error() {} };
  function apply(room) {
  `;
  const epilogue = `
  }
  return { apply, snap: () => ({ gameId: game && game.id, lastSeenUndoApplyAt, _unpushedState, _repushAttempts }) };`;
  try { return new Function('state', 'hooks', prologue + js + epilogue)(state, hooks); }
  catch (e) { throw new assert.AssertionError({ message: 'handleRoomUpdate 盤面區塊載不起來：' + e.message }); }
}
const G = (id, log, extra = {}) => ({ id, phase: 'playing', log, createdAt: 1000, createdAtSrv: 1000,
  players: [{ prizes: [] }, { prizes: [] }], pendingPrizes: [0, 0], setupDone: [true, true], ...extra });

await T('E0 harness 自我驗證：一般對局（同一局前進一手）盤面真的被採納了', () => {
  const notes = [];
  const h = makeHandler(PAGE, { game: G('g1', [1, 2]) }, { SG, note: (...a) => notes.push(a) });
  h.apply({ gameState: G('g1', [1, 2, 3]), lastUndoApplyAt: 0, restartProposalCount: 0 });
  assert.strictEqual(h.snap().gameId, 'g1', '一般前進沒有被採納 —— harness 壞了');
});
await T('E1 ⭐⭐⭐ 接線：phantom adopt 真的呼叫到指紋判定點，而且帶的是「換掉前的本地局」', () => {
  const notes = [];
  const h = makeHandler(PAGE, { game: G('game-A', [5]) }, { SG, note: (...a) => notes.push(a) });
  h.apply({ gameState: G('game-B', [5], { createdAtSrv: 1001 }), lastUndoApplyAt: 0, restartProposalCount: 0 });
  assert.strictEqual(h.snap().gameId, 'game-B', '盤面沒有被換掉 —— 情境沒建立起來');
  const hit = notes.filter((n) => n[0] === 'adopt' && n[1] && n[2] && n[1].id !== n[2].id);
  assert.strictEqual(hit.length, 1, '指紋判定點沒有被呼叫（實際 ' + notes.length + ' 次呼叫）');
  assert.strictEqual(hit[0][1].id, 'game-A', '傳進去的不是「換掉前」的本地局');
  assert.strictEqual(hit[0][2].id, 'game-B');
  assert.strictEqual(hit[0][3], 0, 'restartProposalCount 沒有傳進去');
});
await T('E2 ⭐⭐⭐【4】重整後首發：`lastSeenUndoApplyAt` 立刻對齊房間（不再多走一次 apply-undo）', () => {
  const h = makeHandler(PAGE, { game: null, lastSeenUndoApplyAt: 0 }, { SG, note: () => {} });
  h.apply({ gameState: G('g1', [1, 2, 3]), lastUndoApplyAt: 5000, restartProposalCount: 0 });
  assert.strictEqual(h.snap().lastSeenUndoApplyAt, 5000, '首發採納後 marker 沒有對齊房間');
  // 玩家做了一手、還沒推上去（_unpushedState 有值）；下一發輪詢送來同一份盤面
  const h2 = makeHandler(PAGE, { game: G('g1', [1, 2, 3]), lastSeenUndoApplyAt: 5000,
    _unpushedState: G('g1', [1, 2, 3, 4]), _repushAttempts: 1 }, { SG, note: () => {} });
  h2.apply({ gameState: G('g1', [1, 2, 3]), lastUndoApplyAt: 5000, restartProposalCount: 0 });
  ok(h2.snap()._unpushedState !== null, 'v6.212 的「本地領先重推」快照被 apply-undo 清掉了');
});
await T('E3 ⭐⭐ 正對照：真正的悔棋（房間時戳**再度變大**）仍然要走 apply-undo 並清掉快照', () => {
  const h = makeHandler(PAGE, { game: G('g1', [1, 2, 3]), lastSeenUndoApplyAt: 5000,
    _unpushedState: G('g1', [1, 2, 3, 4]), _repushAttempts: 2 }, { SG, note: () => {} });
  h.apply({ gameState: G('g1', [1, 2]), lastUndoApplyAt: 9000, restartProposalCount: 0 });
  assert.strictEqual(h.snap().lastSeenUndoApplyAt, 9000, '悔棋 marker 沒有推進');
  assert.strictEqual(h.snap()._unpushedState, null, '悔棋之後沒有把作廢的未推送快照清掉（v6.212 的要求）');
  assert.strictEqual(h.snap()._repushAttempts, 0);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【F】錦標賽零接觸 ＋ 伺服器端零改動');
// ══════════════════════════════════════════════════════════════════════════
await T('F1 ⭐⭐⭐ 錦標賽路徑：新指紋一律被休閒閘攔下，永遠不會走到 _tSendClientDiag 的錦標賽段', () => {
  const { env, posts, tournHits } = diagEnv();
  const d = makeDiag(PAGE, env);
  d._tSendClientDiag('casual-phantom-adopt');
  ok(tournHits.length === 0, '新指紋掉進錦標賽路徑：' + tournHits);
  ok(posts.length === 1 || posts.length === 0, '送出次數異常 ' + posts.length);
  // 正對照：錦標賽自己的指紋**不會**被休閒閘吃掉
  const { env: e2, posts: p2, tournHits: t2 } = diagEnv();
  const d2 = makeDiag(PAGE, e2);
  d2._tSendClientDiag('stale-version');
  ok(t2.length === 1 && p2.length === 0, '錦標賽指紋被休閒閘攔截了（tourn=' + t2.length + ' posts=' + p2.length + '）');
});
await T('F2 ⭐⭐ 兩份 reason 清單互斥（休閒的 4 個一律 casual- 前綴；錦標賽指紋一個都不在裡面）', () => {
  const m = /const CASUAL_DIAG_REASONS = \[([\s\S]*?)\];/.exec(PAGE);
  ok(m, '抓不到 CASUAL_DIAG_REASONS');
  const list = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  // ⚠ v6.270 合法新增 'casual-delta-fuse'（PUT 上行增量的熔斷指紋；仍是 casual- 前綴）。
  // ⚠ v6.309 合法新增 'casual-setup-adopt-loss'（setup→playing 採納讓我方座位倒退＝補抽被洗回；仍是 casual- 前綴）。
  assert.deepStrictEqual(list, ['casual-slow-push', 'casual-perf-sample', 'casual-forfeit-claim', 'casual-phantom-adopt', 'casual-delta-fuse', 'casual-setup-adopt-loss']);
  for (const r of list) ok(r.startsWith('casual-'), r + ' 沒有 casual- 前綴 ⇒ 伺服器會把它算進錦標賽批');
  for (const t of ['slow-rtt', 'stale-version', 'invisible-hand', 'manual-sync', 'perf-sample', 'stale-board-drop'])
    ok(!list.includes(t), '錦標賽指紋 ' + t + ' 跑進休閒清單');
});
await T('F3 ⭐⭐⭐ 伺服器端**零改動**：分帳只看 `casual-` 前綴，新指紋不需要 server 先上', () => {
  const i = SRV.indexOf('function isCasualReason(');
  ok(i > 0, '抓不到伺服器的 isCasualReason');
  const seg = SRV.slice(i, SRV.indexOf('\n', i) + 1);
  const f = new Function('CASUAL_REASON_PREFIX', seg + '\nreturn isCasualReason;')('casual-');
  ok(f('casual-phantom-adopt') === true, '伺服器不會把新指紋算成休閒批 ⇒ 這一版就必須 server 先上');
  ok(f('stale-version') === false, '伺服器把錦標賽指紋算成休閒批了（正對照）');
  ok(!SRV.includes('casual-phantom-adopt'), '伺服器端出現硬寫的新指紋名稱 ⇒ 已經不是零改動');
  const SAMPLE = /const SAMPLE_REASONS = \[([^\]]*)\]/.exec(SRV);
  ok(SAMPLE && !SAMPLE[1].includes('phantom'), '新指紋被誤加進健康對照組 SAMPLE_REASONS（會污染分母）');
});
await T('F4 ⭐⭐⭐ 錦標賽的同步／盤面路徑**一行都沒動**：本版只改 room-oracle.ts 與休閒區塊', () => {
  // 錦標賽走 tApi('/action')／tAdopt／decideBoardAdopt，與 room-oracle.ts 完全無關
  ok(!RO.includes('tournament') && !RO.includes('/action'), 'room-oracle.ts 出現錦標賽相關字樣');
  if (!hasBaseCommit(ROOT, BASE_SHA) || !hasBaseCommit(ROOT, BASE_SHA_V6266)) {
    shallowSkip('F4 對 BASE 的逐字比對', '上一條結構斷言仍在守'); return;
  }
  // ⚠ v6.267：每個檔各自釘在**最後一次合法改動的那一版**（見檔頭 BASE_SHA_V6266 的說明）。
  // ⚠ v6.270：oracle-client.ts 合法新增了 delta-put 區塊與兩行哨兵記錄（test-v6270 全面接管
  //   那一塊的守備）。這裡沿用 v6.267 對 F4 自己的修法：把已知的合法新增**剝掉**之後，
  //   其餘仍必須逐字等於 v6.264 的 blob —— 動到別的地方照樣紅。
  const stripV6270 = (src) => {
    const a = src.indexOf('\n// ── ⭐⭐⭐v6.270 休閒 PUT 上行增量【階段 2：client 端】');
    const eMark = '// <<< v6270-delta-put-client-core\n';
    const e = src.indexOf(eMark);
    let t = (a >= 0 && e > a) ? src.slice(0, a) + src.slice(e + eMark.length) : src;
    t = t.split("    _noteDeltaPutSentinel(res);   // ⭐v6.270 delta-PUT 哨兵：以最近一次 GET 的 {room} 回應為準\n").join('');
    t = t.split("    _noteDeltaPutSentinel(res);   // ⭐v6.270 輪詢的 GET 也算「最近一次」（哨兵消失＝伺服器撤掉 kill switch）\n").join('');
    return t;
  };
  // ⚠ v6.280：sync-guards.ts 合法新增了純述詞 `nextRestartBaseline`（幻影 setup 防護的門檻
  //   改成跟著房間走；由 test-v6280 全面接管那一塊的守備，且 resolveRoomUpdate 一個字沒動）。
  //   沿用 v6.267／v6.270 對 F4 的既有修法：把**已知的合法新增**用哨兵剝掉之後，
  //   其餘仍必須逐字等於 BASE 的 blob —— 動到別的地方照樣紅。
  const stripV6280 = (src) => {
    const a = src.indexOf('// >>> v6280-restart-baseline-core\n');
    const eMark = '// <<< v6280-restart-baseline-core\n\n';
    const e = src.indexOf(eMark);
    return (a >= 0 && e > a) ? src.slice(0, a) + src.slice(e + eMark.length) : src;
  };
  // ⭐ v6.275：server_admin_patch.js 改鎖錦標賽 tail 的 sha256（見檔頭說明）
  {
    const srvCur = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
    const ti = srvCur.indexOf("app.get('/api/tournament");
    ok(ti > 0, 'server_admin_patch.js 找不到第一支 /api/tournament 端點');
    const hex = createHash('sha256').update(srvCur.slice(ti), 'utf8').digest('hex');
    assert.strictEqual(hex, TOURN_TAIL_SHA256_V6276,
      'server_admin_patch.js 的錦標賽區塊被動到了（tail sha256 不符）');
  }
  // ⭐ v6.310：engine.ts 的合法改動只有 tryAdvanceToPlaying 硬 gate 上方的三行註解（哨兵剝掉之後必須逐字等於 v6.309 blob）
  const stripV6310Engine = (src) => src.replace(
    "  //   ⚠ v6.310 標註：**目前不可達（死碼）**—— 上一行 `isOpeningInProgress` 與 `ensureOpeningFinalized` 用的是同一個判準\n"
    + "  //   （effectiveOpeningDone），雙定案一通過，`ensureOpeningFinalized` 必已寫下 openingFinalized。留著純粹是防**未來**有人把\n"
    + "  //   兩邊的判準改成不同（或 finalizeOpening 不再寫旗標）：那時寧可卡住也不吃補抽。它現在**零保護力**，不要把它當成守備。\n", '');
  for (const [p, sha] of [['src/lib/game/oracle-client.ts', BASE_SHA],
                          ['src/lib/game/engine.ts', BASE_SHA_V6309]]) {
    const b = readBaseBlob(ROOT, sha, p);
    ok(b.ok, '讀不到 BASE 的 ' + p);
    const raw = readFileSync(join(ROOT, p), 'utf8');
    const cur = p === 'src/lib/game/oracle-client.ts' ? stripV6270(raw)
      : (p === 'src/lib/game/engine.ts' ? (() => { const s = stripV6310Engine(raw); ok(s !== raw, 'v6.310 的三行註解哨兵不在 engine.ts 裡（剝除器過期）'); return s; })() : raw);
    assert.strictEqual(cur, b.out, p + ' 被改動了（本版不該碰它）');
  }
  // sync-guards.ts：整檔比對已由 test-v6274 E1/E2（本體 seg sha）接管；這裡只確認那兩支守衛還在 test chain 裡（不是靜默消失）
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
  ok(pkg.includes('node scripts/test-v6274-start-grace-reset.mjs'), 'test-v6274 不在 test chain ⇒ sync-guards 的本體守備沒人接');
});
await T('F5 ⭐⭐⭐ `resolveRoomUpdate` 的收斂邏輯逐字未動（長期記憶明訓：動它會造成死結）', () => {
  const cur = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
  ok(cur.includes('export function resolveRoomUpdate('), '抓不到 resolveRoomUpdate');
  if (!hasBaseCommit(ROOT, BASE_SHA_V6309)) { shallowSkip('F5 對 BASE 的逐字比對', ''); return; }
  const b = readBaseBlob(ROOT, BASE_SHA_V6309, 'src/lib/game/sync-guards.ts');
  // ⭐ v6.310：只比 resolveRoomUpdate 本體（與 test-v6274 E1 同一種切法），不 pin 整檔 —— 整檔 pin 每改一次 sync-guards 就靜默失效。
  const seg = (src) => { const a = src.indexOf('export function resolveRoomUpdate('); ok(a >= 0, '抓不到 resolveRoomUpdate'); const e = src.indexOf('\nexport function ', a + 1); return src.slice(a, e > a ? e : undefined); };
  assert.strictEqual(seg(cur), seg(b.out), 'resolveRoomUpdate 本體被動過了');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【G】效能：零額外請求、零新計時器');
// ══════════════════════════════════════════════════════════════════════════
await T('G1 ⭐⭐⭐ 一般對局 1000 次盤面更新：新程式碼一發請求都不發（實跑計數）', () => {
  const posts = [];
  const { env } = diagEnv({ tApi: async (p, b) => { posts.push(b); return {}; } });
  const d = makeDiag(PAGE, env);
  const h = makeHandler(PAGE, { game: G('g1', [1]) },
    { SG, note: (...a) => d._casualNotePhantomAdopt(...a) });
  for (let i = 2; i < 1002; i++) h.apply({ gameState: G('g1', Array.from({ length: i }, (_, k) => k)),
    lastUndoApplyAt: 0, restartProposalCount: 0 });
  ok(posts.length === 0, '一般對局送了 ' + posts.length + ' 發請求');
});
await T('G2 ⭐⭐ 新程式碼沒有引入任何計時器／網路呼叫（只有純比較與一次可選的 fire-and-forget）', () => {
  const body = stripComments(PAGE);
  const i = body.indexOf('function _casualNotePhantomAdopt(');
  ok(i > 0, '抓不到 _casualNotePhantomAdopt');
  let d = 0, k = body.indexOf('{', i), end = k;
  for (; k < body.length; k++) { if (body[k] === '{') d++; else if (body[k] === '}') { d--; if (!d) { end = k; break; } } }
  const seg = body.slice(i, end + 1);
  for (const bad of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch(', 'await ', 'JSON.stringify'])
    ok(!seg.includes(bad), '判定函式裡出現 ' + bad + ' —— 它跑在每一次盤面更新上');
  ok(seg.includes('local.id === incoming.id'), '早退判準不見了（每次更新都要做的是這個純比較）');
});
await T('G3 ⭐ room-oracle 的中央 helper 沒有新增任何請求（PUT/GET 次數與 BASE 相同）', async () => {
  for (const plan of ['clean', 'conflict409', 'timeout', 'landedButTimedOut']) {
    const b = await runStart(BASE_RO, plan), n = await runStart(RO, plan);
    assert.strictEqual(n.puts, b.puts, plan + ' 的 PUT 次數變了（BASE ' + b.puts + ' → ' + n.puts + '）');
    assert.strictEqual(n.log.length, b.log.length, plan + ' 的請求總數變了');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【H】守衛自身進了 test chain（v6.263：CI 真正的保護面只有 deploy.yml 的 npm test）');
// ══════════════════════════════════════════════════════════════════════════
await T('H1 ⭐⭐ 本守衛與 perf 腳本都在 package.json 的 test chain 裡', () => {
  const t = PKG.scripts.test;
  ok(t.includes('scripts/test-v6265-phantom-start-race.mjs'), 'test-v6265 沒進 test chain');
  ok(t.includes('scripts/test-v6265-perf.mjs'), 'test-v6265-perf 沒進 test chain');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【I】突變測試（沒紅 = 守衛是安慰劑）');
// ══════════════════════════════════════════════════════════════════════════
await mustBreak('I1 拿掉 `marked = false` 的 per-attempt 歸零 → 【A5】fail-safe 情境必須紅', async () => {
  const mut = RO.replace('    marked = false;                          // ⭐ 每個 attempt 重判：旗標絕不可以跨輪殘留\n', '');
  assert.notStrictEqual(mut, RO, '突變沒生效（來源找不到那一行）');
  const n = await runStart(mut, 'conflict409', { echoGameState: false });
  ok(n.won === false, '本版在「伺服器沒把 gameState 回傳」時判成 ' + n.won);
});
await mustBreak('I2 拿掉結構性複驗（只留旗標）→ 【B1c】「PUT 送達但回應逾時」必須紅', async () => {
  const mut = RO.replace(/    const finalId = [\s\S]*?\n    \}\n/, '');
  assert.notStrictEqual(mut, RO, '突變沒生效');
  const n = await runStart(mut, 'landedButTimedOut');
  ok(n.won === true, '房間 canonical 明明是我這一局，卻判成 ' + n.won);
});
await mustBreak('I3 把 `finalId === gameState.id` 改成 `!==` → 【B1】真正的贏家必須紅', async () => {
  const mut = RO.replace('return finalId === gameState.id;', 'return finalId !== gameState.id;');
  assert.notStrictEqual(mut, RO, '突變沒生效');
  const n = await runStart(mut, 'clean');
  ok(n.won === true, '真正的贏家被判成 ' + n.won + ' —— 建局功能被關掉了');
});
await mustBreak('I4 拿掉 fail-safe 的型別守衛（伺服器沒回 gameState 也硬比）→ 【B1b】必須紅', async () => {
  const mut = RO.replace("    if (typeof finalId === 'string' && typeof gameState.id === 'string') {\n      return finalId === gameState.id;\n    }\n    return marked;",
    '    return finalId === gameState.id;');
  assert.notStrictEqual(mut, RO, '突變沒生效');
  const n = await runStart(mut, 'clean', { echoGameState: false });
  ok(n.won === true, 'fail-safe 情境下贏家被判成 ' + n.won);
});
await mustBreak('I5 把一支 checkAndAccept* 改回舊寫法 → 【C1】枚舉必須紅', async () => {
  const mut = RO.replace(`    const { marked: didReset } = await oracleTxFlagged(roomCode.toUpperCase(), (data, mark) => {
      const p = data.returnRoomProposed ?? {};`,
    `    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const p = data.returnRoomProposed ?? {};`).replace(`      const newSeats = data.seats.map(s => ({ ...s, ready: false }));
      mark();
      return {
        ...data,
        // v5.183: status 'waiting' → 'lobby'`, `      const newSeats = data.seats.map(s => ({ ...s, ready: false }));
      didReset = true;
      return {
        ...data,
        // v5.183: status 'waiting' → 'lobby'`);
  assert.notStrictEqual(mut, RO, '突變沒生效');
  const found = scanExternalFlags(stripComments(mut)).filter((c) => c.ext.length);
  ok(found.length === 0, '還有 ' + found.length + ' 處旗標寫在重試迴圈外');
});
await mustBreak('I6 拿掉「每場一次」旗標 → 【D3】必須紅（會變成回報噪音）', () => {
  const mut = PAGE.replace('      if (_casualPhantomSent) return;\n      _casualPhantomSent = true;\n', '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const { env, posts } = diagEnv();
  const d = makeDiag(mut, env);
  for (let i = 0; i < 10; i++) d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-' + i }, 0);
  ok(posts.length === 1, '送了 ' + posts.length + ' 發（每場只該 1 發）');
});
await mustBreak('I7 拿掉「合法重新開局」的排除 → 【D1d】必須紅（正常玩家會開始回報）', () => {
  const mut = PAGE.replace("      if (incoming.phase === 'setup' && roomRestartCount > (lastAdoptedRestartCount ?? 0)) return;\n", '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const { env, posts } = diagEnv();
  const d = makeDiag(mut, env);
  d._casualNotePhantomAdopt('adopt', { id: 'game-A', phase: 'playing' }, { id: 'game-R', phase: 'setup' }, 1);
  ok(posts.length === 0, '合法重新開局竟然送了 ' + posts.length + ' 發');
});
await mustBreak('I8 拿掉 `local.id === incoming.id` 早退 → 【D1】一般玩家 0 發必須紅', () => {
  const mut = PAGE.replace('      if (local.id === incoming.id) return;\n', '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const { env, posts } = diagEnv();
  const d = makeDiag(mut, env);
  for (let i = 0; i < 200; i++) d._casualNotePhantomAdopt('adopt', { id: 'game-A' }, { id: 'game-A' }, 0);
  ok(posts.length === 0, '一般對局竟然送了 ' + posts.length + ' 發');
});
await mustBreak('I9 拿掉重整後的 marker 對齊 → 【E2】必須紅（重整後第一手的自癒快照被清掉）', () => {
  const mut = PAGE.replace(/      if \(!game\) lastSeenUndoApplyAt = Math\.max\([^\n]*\n/, '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const h = makeHandler(mut, { game: null, lastSeenUndoApplyAt: 0 }, { SG, note: () => {} });
  h.apply({ gameState: G('g1', [1, 2, 3]), lastUndoApplyAt: 5000, restartProposalCount: 0 });
  assert.strictEqual(h.snap().lastSeenUndoApplyAt, 5000, '首發採納後 marker 沒有對齊房間');
});
await mustBreak('I10 把新指紋從休閒白名單拿掉 → 【F1】必須紅（會掉進錦標賽 payload 那條路）', () => {
  const mut = PAGE.replace(", 'casual-phantom-adopt'];", '];');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const { env, tournHits } = diagEnv();
  const d = makeDiag(mut, env);
  d._tSendClientDiag('casual-phantom-adopt');
  ok(tournHits.length === 0, '新指紋掉進錦標賽路徑：' + tournHits);
});

console.log(`\n=== v6.265 開局 CAS 競態：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
