/**
 * v6.261 守衛 — 休閒對戰的診斷指紋（casual-*）
 *
 * 背景：`_tSendClientDiag` 從 v0.77 起開頭就是
 *   `if (!isTournament || isTournSpectator || !tActiveRoom) return;`
 *   ⇒ tournamentClientDiag（含 v6.213 的健康對照組）**只涵蓋錦標賽路徑**，
 *   而休閒對戰佔全站 94% 流量 ⇒「dump 裡沒有」不等於「沒發生」。
 *
 * ⚠⚠ 本檔的紀律（歷史上踩過七次守衛安慰劑）：
 *   ・能實跑的一律實跑（把函式抽出來餵資料，不是只驗字串存在）；
 *   ・「錦標賽逐字不變」用**與 BASE blob 逐字元比對**來證明，不是「有這個字串」；
 *   ・每一條否定型都配正對照；
 *   ・只捕捉 assert.AssertionError（其他例外一律讓它炸出來，不可被當成 PASS）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { transform } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const DUMPSRC = readFileSync(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const DUMP = (await import('node:module')).createRequire(import.meta.url)(
  join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;   // ⚠ 非斷言例外一律讓它炸：把它吞掉就是安慰劑
  }
}
async function TA(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;
  }
}

// ── 取原始碼片段的小工具（大括號配對，不是 regex 猜）──────────────────────
// ⚠⚠ HEAD-FAIL 紀律：在 BASE（v6.260）上跑時這些錨點通通不存在。
//   抽不到就 throw AssertionError（不是 Error）—— 這樣**每一條各自紅**，
//   而不是整支腳本在第一個缺口就中止（那樣就看不出「哪幾條真的守到東西」）。
const MISSING = [];
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) { MISSING.push(anchor); throw new assert.AssertionError({ message: '找不到錨點：' + anchor }); }
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new assert.AssertionError({ message: '括號沒配對：' + anchor });
}
function softFn(src, anchor) { try { return fnSrc(src, anchor); } catch { return null; } }

console.log('\n══ v6.261 休閒對戰診斷指紋 ══');

// ══════════════════════════════════════════════════════════════════════════
// ① ⭐⭐⭐ 正對照：錦標賽側的 payload 與 BASE **逐字元相同**
// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 錦標賽側逐字不變（正對照：現有 dump 的口徑不可因本版改變）');
// ⭐⭐⭐「錦標賽逐字不變」用**兩條互為備援的判準**證明，而且**兩條都拿不到就直接紅**
//   （CI 是 fetch-depth:1 淺複製 ⇒ 守衛絕不可以 fail-open／靜默 SKIP）：
//     ①本機／完整複製：直接把 BASE blob 的同一段抽出來逐字元比對；
//     ②任何環境：比對 v6.261 當下算出來的 sha256（未來若要**刻意**改錦標賽 payload，
//       必須連同這個常數一起改 —— 那正是「口徑改變」該被看見的地方）。
const BASE_SHA = '28339fa46aea6d88b5df7ea7befa31358a57dd59';
const TOURN_PAYLOAD_SHA256 = '6e5e7aff9ac958d4ebf162e4702e5ba8c4e64f8e9b3be1e8828b63e45496a5ae';
function tournPayloadBlock(src) {
  const fi = src.indexOf('function _tSendClientDiag(');
  assert.ok(fi > 0, '找不到 _tSendClientDiag');
  const pi = src.indexOf('const payload = {', fi);
  assert.ok(pi > fi, '找不到錦標賽 payload');
  // 到 payload 送出為止（BASE 是 `void tApi(`，本版是 `_tPostClientDiag(`）
  const e1 = src.indexOf('void tApi(', pi), e2 = src.indexOf('_tPostClientDiag(payload);', pi);
  const end = (e2 > 0 && (e1 < 0 || e2 < e1)) ? e2 : e1;
  assert.ok(end > pi, '找不到 payload 的送出點');
  return src.slice(pi, end);
}
let BASE_PAGE = null;
try {
  BASE_PAGE = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':src/routes/game/+page.svelte'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch { BASE_PAGE = null; }
T('★★★[核心／正對照] 錦標賽 payload 區塊逐字元未變（dump 的口徑不可因本版改變）', () => {
  const cur = tournPayloadBlock(PAGE);
  assert.ok(cur.length > 1500, '抽取器抽到的區塊太短（' + cur.length + '）⇒ 下面的比對會變成恆真式');
  const sha = createHash('sha256').update(cur, 'utf8').digest('hex');
  let checked = 0;
  if (BASE_PAGE) { assert.equal(cur, tournPayloadBlock(BASE_PAGE), '與 BASE blob 逐字元比對不符'); checked++; }
  assert.equal(sha, TOURN_PAYLOAD_SHA256, 'sha256 不符（' + sha + '）'); checked++;
  assert.ok(checked >= 1, '兩條判準都沒跑到 ⇒ 這是 fail-open，不可以');
  console.log('     判準數 ' + checked + '（BASE blob ' + (BASE_PAGE ? '有' : '拿不到，只驗 sha256') + '）');
});
T('★★[自我驗證] 上面那條不是恆真：改一個字元 sha256 就會不同', () => {
  const cur = tournPayloadBlock(PAGE);
  assert.notEqual(createHash('sha256').update(cur + ' ', 'utf8').digest('hex'), TOURN_PAYLOAD_SHA256);
});
T('★★[核心] 錦標賽的三道閘（isTournament／觀戰／tActiveRoom）一個字都沒動', () => {
  assert.ok(PAGE.includes('if (!isTournament || isTournSpectator || !tActiveRoom) return;'),
    '錦標賽的閘被改掉了');
});
T('★★[核心] `/clientdiag` 的送出點仍然只有兩處（本版不准另開管線）', () => {
  const nSites = (PAGE.match(/tApi\('\/clientdiag'/g) || []).length;
  assert.equal(nSites, 2, '送出點變成 ' + nSites + ' 處');
  assert.ok(/function _tPostClientDiag\(payload: any\): void \{/.test(PAGE), '沒有收斂到單一送出點 helper');
});
T('★[核心] 沒有新增任何端點（休閒批走既有的 /clientdiag）', () => {
  assert.ok(!/tApi\('\/casual/.test(PAGE) && !/'\/api\/casual/.test(PAGE), '+page.svelte 出現了新端點');
  assert.ok(!/app\.(get|post)\('\/api\/(tournament\/)?casual(diag|clientdiag)?'/.test(SRV),
    '伺服器出現了休閒專用端點');
});
T('★[核心] 沒有新增 collection（休閒批寫進既有的 tournamentClientDiag）', () => {
  const news = [...SRV.matchAll(/db\.collection\('([A-Za-z]+)'\)/g)].map((m) => m[1]);
  assert.ok(!news.some((c) => /casual/i.test(c)), '出現了休閒專用 collection：' + news.filter((c) => /casual/i.test(c)));
});

// ══════════════════════════════════════════════════════════════════════════
// ② client 端行為（實跑）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n② client 端：把休閒批的四支函式真的跑起來');

const CONSTS = ['CASUAL_DIAG_REASONS', 'CASUAL_DIAG_MAX_PER_PAGE', 'CASUAL_SLOW_PUSH_P95_MS',
  'CASUAL_PUSH_MIN_CALLS', 'PERF_SAMPLE_RATE'];
const constMiss = [];
const constLines = CONSTS.map((k) => {
  const m = new RegExp('^\\s*const ' + k + ' = [^\\n]*$', 'm').exec(PAGE);
  if (!m) { constMiss.push(k); return ''; }
  return m[0].trim().replace(/\s*\/\/.*$/, '');
}).filter(Boolean).join('\n');

const PRELUDE = `
  let isTournament = false, isTournSpectator = false;
  let mode = 'online', roomCode = 'AB12';
  let myPlayerIndex = 0, mySeatIdx = 0;
  let firebaseUser = { isAnonymous: false };
  let game = { phase: 'playing', turn: 7, log: new Array(120).fill(0) };
  let roomData = { idleTimeoutSec: 180 };
  let battleLayout = 'classic';
  const VERSION = '6.261';
  const document = { visibilityState: 'visible' };
  const window = { innerWidth: 1280, innerHeight: 800 };
  const navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TESTUA', hardwareConcurrency: 8, deviceMemory: 8 };
  let __forceRnd = null;
  const Math = Object.create(globalThis.Math);
  Math.random = () => (__forceRnd === null ? globalThis.Math.random() : __forceRnd);
  const __posted = [];
  function _tPostClientDiag(p) { __posted.push(p); }
  function _tSendClientDiag(reason) { _casualDiagSend(reason, Date.now()); }
  function oldestPushInFlightAgeMs() { return 0; }
${constLines}
`;
const CLIENT_ANCHORS = [
  'function _sampleStats(src: number[]): _PStat | null {',
  'function _pushSample(arr: number[], ms: number): void {',
  'function _casualDiagSend(reason: string, now: number): boolean {',
  'function _casualDiagPayload(reason: string, now: number): any {',
  'function _casualRecordPush(ms: number, ok: boolean): void {',
  'function _casualDiagReset(): void {',
];
const CLIENT_PARTS = CLIENT_ANCHORS.map((a) => softFn(PAGE, a));
const SETUP_OK = CLIENT_PARTS.every(Boolean) && constMiss.length === 0;
const SETUP_WHY = '出貨碼缺少：' + [...constMiss, ...CLIENT_ANCHORS.filter((a, i) => !CLIENT_PARTS[i])].join('、');
const CLIENT_FNS = CLIENT_PARTS.filter(Boolean).join('\n');
const EXPORTS = `
  return {
    _casualDiagSend, _casualDiagPayload, _casualRecordPush, _casualDiagReset,
    posted: () => __posted.slice(), clearPosted: () => { __posted.length = 0; },
    set: (k, v) => {
      if (k === 'rnd') __forceRnd = v;
      else if (k === 'isTournament') isTournament = v;
      else if (k === 'isTournSpectator') isTournSpectator = v;
      else if (k === 'mode') mode = v;
      else if (k === 'roomCode') roomCode = v;
      else if (k === 'myPlayerIndex') myPlayerIndex = v;
      else if (k === 'firebaseUser') firebaseUser = v;
      else throw new Error('unknown key ' + k);
    },
    get: (k) => ({ _casualPushSamples, _casualPushFail, _casualDiagSent, _casualSlowSent,
      _casualSampleArmed, _casualSampleSent, _casualSampleRoom, _casualClaimGranted })[k],
    setClaim: (v) => { _casualClaimGranted = v; },
  };
`;
// 本檔宣告的 let（在 +page.svelte 是模組層級變數）
const STATE_DECL = `
  let _casualPushSamples = [], _casualPushFail = 0, _casualDiagSent = 0;
  let _casualSlowSent = false, _casualClaimSent = false;
  let _casualSampleRoom = '', _casualSampleArmed = false, _casualSampleSent = false;
  let _casualClaimGranted = null;
`;
async function mkClient(mutate) {
  if (!SETUP_OK) throw new assert.AssertionError({ message: SETUP_WHY });
  const body = mutate ? mutate(CLIENT_FNS) : CLIENT_FNS;
  const ts = PRELUDE + STATE_DECL + body + EXPORTS;
  const js = (await transform(ts, { loader: 'ts', target: 'node20' })).code;
  return new Function(js)();
}
let H = null;
try { H = await mkClient(null); } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; }
function need() {
  if (!H) throw new assert.AssertionError({ message: SETUP_WHY });
  return H;
}
T('[前提] 六支休閒函式與五個常數都抽得到（BASE 上必紅：那時候根本還沒有這些東西）', () => {
  assert.ok(SETUP_OK, SETUP_WHY);
  assert.ok(/CASUAL_DIAG_MAX_PER_PAGE = \d+/.test(constLines) && /CASUAL_SLOW_PUSH_P95_MS = \d+/.test(constLines),
    constLines);
});
T('★★★[核心] 錦標賽的 reason 完全走不進休閒分支（return false ⇒ 原路徑照跑）', () => {
  for (const r of ['slow-rtt', 'stale-version', 'invisible-hand', 'perf-sample', 'manual-sync',
    'setup-watchdog-repeat', 'stale-board-drop', 'action-forbidden', 'setup-stalled-both-done']) {
    assert.equal(need()._casualDiagSend(r, Date.now()), false, r + ' 被休閒分支攔走了');
  }
  assert.equal(need().posted().length, 0);
});
T('★★★[核心] 休閒的 reason **一律** return true（絕不可以掉回錦標賽那條路）', () => {
  need().clearPosted();
  need().set('isTournament', true);   // 最惡劣：旗標亂掉
  for (const r of ['casual-slow-push', 'casual-perf-sample', 'casual-forfeit-claim']) {
    assert.equal(need()._casualDiagSend(r, Date.now()), true, r + ' 竟然掉回錦標賽路徑（payload 會是一整包 null）');
  }
  assert.equal(need().posted().length, 0, '錦標賽模式下不該送出休閒指紋');
  need().set('isTournament', false);
});
T('★★★[零額外負擔] 匿名／未登入一律**連送都不送**（伺服器一定丟棄 ⇒ 送了就是白付一發請求）', () => {
  need().clearPosted();
  need().set('firebaseUser', { isAnonymous: true });
  need()._casualDiagSend('casual-slow-push', Date.now());
  need().set('firebaseUser', null);
  need()._casualDiagSend('casual-slow-push', Date.now());
  assert.equal(need().posted().length, 0, '匿名玩家也送出去了');
  need().set('firebaseUser', { isAnonymous: false });
  need()._casualDiagSend('casual-slow-push', Date.now());
  assert.equal(need().posted().length, 1, '正對照失敗：已登入玩家反而送不出去 ⇒ 上面那條是恆真式');
});
T('★★★[零額外負擔] 本機／大廳／觀戰一律不送', () => {
  need().clearPosted();
  need().set('mode', 'local'); need()._casualDiagSend('casual-slow-push', Date.now());
  need().set('mode', 'online'); need().set('roomCode', ''); need()._casualDiagSend('casual-slow-push', Date.now());
  need().set('roomCode', 'AB12'); need().set('isTournSpectator', true); need()._casualDiagSend('casual-slow-push', Date.now());
  assert.equal(need().posted().length, 0);
  need().set('isTournSpectator', false);
  need()._casualDiagSend('casual-slow-push', Date.now());
  assert.equal(need().posted().length, 1, '正對照失敗');
});

await TA('★★★[上限] 每個頁面實例最多 CASUAL_DIAG_MAX_PER_PAGE 發（送再多次也停在上限）', async () => {
  const h = await mkClient(null);
  const mCap = /CASUAL_DIAG_MAX_PER_PAGE = (\d+)/.exec(constLines);
  assert.ok(mCap, '抓不到 CASUAL_DIAG_MAX_PER_PAGE');
  const CAP = Number(mCap[1]);
  for (let i = 0; i < 500; i++) h._casualDiagSend('casual-slow-push', Date.now());
  assert.equal(h.posted().length, CAP, '實際送了 ' + h.posted().length + ' 發（上限 ' + CAP + '）');
  assert.ok(CAP <= 10, '上限被放到 ' + CAP + ' —— 休閒是 94% 流量，上限必須小');
});

await TA('★★★[取樣率] 沒中籤的那 90% 一發都不送（骰子固定 0.99）', async () => {
  const h = await mkClient(null);
  h.set('rnd', 0.99);
  for (let i = 0; i < 300; i++) h._casualRecordPush(120, true);
  assert.equal(h.posted().length, 0, JSON.stringify(h.posted().map((p) => p.reason)));
  assert.equal(h.get('_casualSampleArmed'), false);
});
await TA('★★★[取樣率] 中籤者：滿 CASUAL_PUSH_MIN_CALLS 發才送，而且一整場只送一發', async () => {
  const h = await mkClient(null);
  const mMin = /CASUAL_PUSH_MIN_CALLS = (\d+)/.exec(constLines);
  assert.ok(mMin, '抓不到 CASUAL_PUSH_MIN_CALLS');
  const MIN = Number(mMin[1]);
  h.set('rnd', 0.001);
  for (let i = 0; i < MIN - 1; i++) h._casualRecordPush(120, true);
  assert.equal(h.posted().length, 0, '太早送（只量到開局那幾發）');
  h._casualRecordPush(120, true);
  assert.deepEqual(h.posted().map((p) => p.reason), ['casual-perf-sample']);
  for (let i = 0; i < 500; i++) h._casualRecordPush(120, true);
  assert.equal(h.posted().length, 1, '一場送了 ' + h.posted().length + ' 發');
});
await TA('★★★[分母污染] 骰子每場只擲一次：同一場中途改骰子不影響（換房才重擲）', async () => {
  const h = await mkClient(null);
  h.set('rnd', 0.001);
  for (let i = 0; i < 5; i++) h._casualRecordPush(120, true);
  h.set('rnd', 0.99);
  for (let i = 0; i < 50; i++) h._casualRecordPush(120, true);
  assert.equal(h.posted().length, 1, '同一場內重擲了骰子 ⇒ 實際機率不是 PERF_SAMPLE_RATE');
  h.set('roomCode', 'ZZ99');
  for (let i = 0; i < 50; i++) h._casualRecordPush(120, true);
  assert.equal(h.posted().length, 1, '換房後用 0.99 的骰子竟然還中籤');
  assert.equal(h.get('_casualSampleRoom'), 'ZZ99', '換房沒有重擲');
});
await TA('★★★[分母污染] 全檔只有一處把 _casualSampleArmed 指派成 Math.random（第二處＝機率就不是那個數）', () => {
  assert.equal((PAGE.match(/_casualSampleArmed = Math\.random\(\)/g) || []).length, 1);
  assert.equal((PAGE.match(/_casualSampleArmed = /g) || []).length, 3,
    '宣告 + 擲骰 + 清乾淨，應為 3 處');
});

await TA('★★★[slow-push] p95 沒到門檻不送；到門檻送一發、而且只送一發', async () => {
  const h = await mkClient(null);
  const mTh = /CASUAL_SLOW_PUSH_P95_MS = (\d+)/.exec(constLines);
  assert.ok(mTh, '抓不到 CASUAL_SLOW_PUSH_P95_MS');
  const TH = Number(mTh[1]);
  h.set('rnd', 0.99);   // 不中籤 ⇒ 只可能是 slow-push
  for (let i = 0; i < 30; i++) h._casualRecordPush(TH - 1, true);
  assert.equal(h.posted().length, 0, '沒到門檻就送了 ⇒ 正常玩家會被整批報進來');
  const h2 = await mkClient(null);
  h2.set('rnd', 0.99);
  for (let i = 0; i < 30; i++) h2._casualRecordPush(TH + 500, true);
  assert.deepEqual(h2.posted().map((p) => p.reason), ['casual-slow-push']);
  for (let i = 0; i < 200; i++) h2._casualRecordPush(TH + 500, true);
  assert.equal(h2.posted().length, 1, '一場送了 ' + h2.posted().length + ' 發');
});
await TA('★★★[統計紀律] 失敗／逾時的推送不進 p50/p95（會把分佈整個灌爆），但 fail 要單獨數', async () => {
  const h = await mkClient(null);
  h.set('rnd', 0.99);
  for (let i = 0; i < 20; i++) h._casualRecordPush(120000, false);   // 20 發逾時
  assert.equal(h.get('_casualPushSamples').length, 0, '逾時的往返被記進樣本了');
  assert.equal(h.get('_casualPushFail'), 20);
  assert.equal(h.posted().length, 0, '逾時竟然觸發了 slow-push（那是 p95 的定義被污染）');
});
await TA('★★[換局] _casualDiagReset 清乾淨，但 per-page 硬上限刻意不清', async () => {
  const h = await mkClient(null);
  h.set('rnd', 0.001);
  for (let i = 0; i < 20; i++) h._casualRecordPush(120, true);
  const sentBefore = h.get('_casualDiagSent');
  h._casualDiagReset();
  assert.equal(h.get('_casualPushSamples').length, 0);
  assert.equal(h.get('_casualSampleRoom'), '');
  assert.equal(h.get('_casualSampleSent'), false);
  assert.equal(h.get('_casualDiagSent'), sentBefore, 'per-page 上限被清掉了 ⇒ 上限形同虛設');
});

// ── payload 內容與體積 ────────────────────────────────────────────────────
console.log('\n③ payload：欄位、體積、隱私');
let PAYLOAD = null;
T('[前提] 產得出 payload', () => {
  need().clearPosted();
  need().setClaim(false);
  need()._casualDiagSend('casual-forfeit-claim', Date.now());
  PAYLOAD = need().posted()[0];
  assert.ok(PAYLOAD && PAYLOAD.reason === 'casual-forfeit-claim');
});
T('★★★[分帳] payload 帶 mode:casual，而且 reason 一定是 casual- 前綴', () => {
  assert.ok(PAYLOAD, '沒有 payload 可驗');
  assert.equal(PAYLOAD.mode, 'casual');
  const mR = /CASUAL_DIAG_REASONS = (\[[^\]]*\])/.exec(constLines);
  assert.ok(mR, '抓不到 CASUAL_DIAG_REASONS');
  for (const r of JSON.parse(mR[1].replace(/'/g, '"'))) {
    assert.equal(typeof DUMP.isCasualReason, 'function', 'dump 沒有匯出 isCasualReason（BASE 上必紅）');
    assert.ok(DUMP.isCasualReason(r), r + ' 沒有 casual- 前綴 ⇒ 會被錯算進錦標賽批');
  }
});
T('★★★[核心欄位] 上行（push）與棄權宣告（claim）都帶得出來', () => {
  assert.ok(PAYLOAD, '沒有 payload 可驗');
  assert.ok(PAYLOAD.push && typeof PAYLOAD.push.p95 === 'number' && typeof PAYLOAD.push.fail === 'number');
  assert.equal(PAYLOAD.claim.granted, false, 'granted 沒有如實帶出來 ⇒ 分不出「真掛機」與「我的畫面舊」');
});
T('★★[欄位互斥] claim 只有 casual-forfeit-claim 才有值（其他一律 null，不是缺席）', () => {
  need().clearPosted();
  need()._casualDiagSend('casual-slow-push', Date.now());
  const p = need().posted()[0];
  assert.ok('claim' in p, 'claim 欄位缺席 ⇒ 讀的人分不出「沒有這件事」與「舊 client」');
  assert.equal(p.claim, null);
});
T('★★★[流量紅線] 單發 payload 位元組數要小（休閒是 94% 流量）', () => {
  assert.ok(PAYLOAD, '沒有 payload 可驗');
  const bytes = Buffer.byteLength(JSON.stringify(PAYLOAD), 'utf8');
  console.log('     實測單發 payload = ' + bytes + ' bytes');
  assert.ok(bytes < 1200, '單發 payload ' + bytes + ' bytes，太大了');
  assert.ok(bytes > 150, '小到不合理（' + bytes + '）⇒ 上面那條可能是恆真式');
});
T('★★★[隱私] payload 不含 email／暱稱／牌組／卡名（uid 與 email 由伺服器自己寫，讀取端要管理員）', () => {
  assert.ok(PAYLOAD, '沒有 payload 可驗');
  const s = JSON.stringify(PAYLOAD);
  for (const bad of ['email', 'Email', 'name', 'deck', 'Deck', 'card', 'hand', 'prize']) {
    assert.ok(!s.includes('"' + bad), 'payload 出現了 ' + bad + ' 欄位：' + s.slice(0, 300));
  }
  assert.ok(!/_casualDiagPayload[\s\S]{0,2200}(firebaseUser\.email|myName|oppName|deckEntries)/.test(PAGE),
    '_casualDiagPayload 讀了玩家可辨識資料');
});
T('★[隱私] 沒有在玩家看得到的地方新增任何欄位（讀取端只有 admin）', () => {
  const seg = SRV.slice(SRV.indexOf("app.get('/api/tournament/admin/clientdiag'"), SRV.indexOf("app.get('/api/tournament/admin/clientdiag'") + 900);
  assert.ok(/if \(!isTournAdmin\(id\)\) return res\.status\(403\)/.test(seg), '讀取端沒有管理員 gate');
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 接線：pushTracked / confirmClaimForfeit / _tSendClientDiag（都實跑）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 接線（實跑，不是只驗字串存在）');
await TA('★★★[接線] pushTracked 的 finally 真的把耗時記進休閒樣本（成功與失敗都要）', async () => {
  const src = [
    'let _pushInFlightMarks = []; let __rec = [];',
    fnSrc(PAGE, 'function _beginPushTrack(): PushMark {'),
    fnSrc(PAGE, 'function _endPushTrack(m: PushMark): void {'),
    'function _casualRecordPush(ms, ok) { __rec.push([ms, ok]); }',
    fnSrc(PAGE, 'async function pushTracked(code: string, st: GameState): Promise<void> {'),
    fnSrc(PAGE, 'async function pushUndoTracked(code: string, st: GameState): Promise<void> {'),
    'return { pushTracked, pushUndoTracked, rec: () => __rec, marks: () => _pushInFlightMarks.length,',
    '  setPush: (f) => { pushGameState = f; pushUndoRollback = f; } };',
  ].join('\n');
  const ts = 'type PushMark = { at: number };\nlet pushGameState: any, pushUndoRollback: any;\n' + src;
  const js = (await transform(ts, { loader: 'ts', target: 'node20' })).code;
  const h = new Function(js)();
  h.setPush(async () => {});
  await h.pushTracked('R', {});
  assert.equal(h.rec().length, 1, 'pushTracked 完全沒有記錄（＝遙測根本沒接上）');
  assert.equal(h.rec()[0][1], true, '成功的推送被記成失敗');
  assert.ok(typeof h.rec()[0][0] === 'number' && h.rec()[0][0] >= 0, '耗時不是數字');
  h.setPush(async () => { throw new Error('boom'); });
  await h.pushTracked('R', {}).catch(() => {});
  assert.equal(h.rec().length, 2, '失敗的推送沒有被記錄');
  assert.equal(h.rec()[1][1], false, '失敗的推送被記成成功 ⇒ p95 會被逾時灌爆');
  await h.pushUndoTracked('R', {}).catch(() => {});
  assert.equal(h.rec().length, 3, '悔棋 rollback 的推送沒有接上');
  assert.equal(h.marks(), 0, '在途標記沒有被還原（v6.248 的保護被本版弄壞了）');
});
await TA('★★★[接線] confirmClaimForfeit 真的送出 casual-forfeit-claim，且 granted 如實記錄', async () => {
  const body = fnSrc(PAGE, 'async function confirmClaimForfeit() {');
  const src = [
    "let roomCode = 'AB12', mySeatIdx = 0, showForfeitConfirm = true, oppInactivityWarn = true;",
    'let _casualClaimSent = false, _casualClaimGranted = null, _forceAdoptNext = false, _lastActionAt = 0;',
    'let unsubRoom = null, myPlayerIndex = 0; const __sent = []; let __grant = true;',
    'function _tSendClientDiag(r) { __sent.push(r); }',
    'async function claimOpponentForfeit() { return __grant; }',
    'function subscribeRoom() { return () => {}; }',
    'function handleRoomUpdate() {} function casualWaitingSelfInput() { return false; }',
    'function alert() {}',
    body,
    'return { confirmClaimForfeit, sent: () => __sent, granted: () => _casualClaimGranted,',
    '  setGrant: (v) => { __grant = v; }, reset: () => { _casualClaimSent = false; __sent.length = 0; } };',
  ].join('\n');
  const js = (await transform(src, { loader: 'ts', target: 'node20' })).code;
  const h = new Function(js)();
  await h.confirmClaimForfeit();
  assert.deepEqual(h.sent(), ['casual-forfeit-claim'], '棄權宣告沒有送出指紋 ⇒ 永遠量不到頻率');
  assert.equal(h.granted(), true);
  await h.confirmClaimForfeit();
  assert.equal(h.sent().length, 1, '每場只該送一次（實際 ' + h.sent().length + '）');
  h.reset(); h.setGrant(false);
  await h.confirmClaimForfeit();
  assert.deepEqual(h.sent(), ['casual-forfeit-claim']);
  assert.equal(h.granted(), false, 'granted=false（我的畫面是舊的）沒有被如實記錄 ⇒ 兩種成因分不開');
});
await TA('★★★[接線] 編譯輸出裡 _tSendClientDiag 的第一件事就是 mode 分派（在錦標賽三道閘之前）', async () => {
  const m = /<script lang="ts">([\s\S]*?)\n<\/script>/.exec(PAGE);
  assert.ok(m, '抽不到 <script> 區塊');
  const js = (await transform(m[1], { loader: 'ts', target: 'node20' })).code;
  const fi = js.indexOf('function _tSendClientDiag');
  assert.ok(fi > 0, '編譯輸出找不到 _tSendClientDiag');
  const seg = js.slice(fi, fi + 900);
  const iCasual = seg.indexOf('_casualDiagSend('), iGate = seg.indexOf('tActiveRoom');
  assert.ok(iCasual > 0, '編譯輸出裡沒有 mode 分派 ⇒ 接線沒接上（只驗原始碼字串擋不住這件事）');
  assert.ok(iGate > 0 && iCasual < iGate,
    'mode 分派排在錦標賽的閘之後 ⇒ 休閒指紋永遠被 `!isTournament` 擋掉（＝白做）');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 伺服器端（實跑 handler）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ 伺服器端：mode 欄位與分帳');
T('★★★[分帳] 寫入時由伺服器自己從 reason 推導 mode（不採信 client 送的 mode 欄位）', () => {
  const i = SRV.indexOf("app.post('/api/tournament/clientdiag'");
  const seg = SRV.slice(i, i + 1800);
  assert.ok(/mode: isCasualReason\(\(req\.body && req\.body\.reason\)\) \? 'casual' : 'tournament'/.test(seg),
    'insertOne 沒有寫 mode，或不是從 reason 推導');
  assert.ok(!/mode: String\(\(req\.body && req\.body\.mode\)/.test(seg), '採信了 client 送上來的 mode（可被偽造）');
});
T('★★★[分帳／逐字不變] admin 端點預設排除休閒，且**把沒有 mode 欄位的舊列收進錦標賽批**', () => {
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  const seg = SRV.slice(i, i + 6800);
  assert.ok(/q\.mode = _wantCasual \? 'casual' : \{ \$ne: 'casual' \};/.test(seg),
    '預設沒有排除休閒，或用了 `mode: "tournament"`（那會把 v6.260 以前的舊列整批漏掉）');
  assert.ok(/const _wantCasual = String\(req\.query\.mode \|\| ''\) === 'casual';/.test(seg),
    '沒有 ?mode=casual 的入口');
  assert.ok(/const agg = _aggAll\.filter\(function \(a\) \{ return !isCasualReason\(a\._id\); \}\)/.test(seg),
    'byReason 的來源沒有把休閒濾掉 ⇒ 錦標賽的指紋表會被休閒污染');
  assert.ok(/q\.reason = \{ \$nin: SAMPLE_REASONS \};/.test(seg), 'v6.213 的取樣排除被弄壞了');
  assert.ok(/mode: \{ \$ne: 'casual' \}, reason: \{ \$in: SAMPLE_REASONS \}/.test(seg),
    '健康對照組的查詢沒有補 mode 條件 ⇒ 休閒取樣會混進錦標賽的對照組');
});
T('★★★[容量] 沒有新增索引、也沒有改 TTL（休閒批共用既有的 7 天 TTL）', () => {
  assert.ok(/TCDIAG\.createIndex\(\{ ts: 1 \}, \{ expireAfterSeconds: 604800 \}\)/.test(SRV), 'TTL 索引被動過');
  assert.equal((SRV.match(/TCDIAG\.createIndex\(/g) || []).length, 1,
    'tournamentClientDiag 多了索引（寫入放大換不到可觀測收益，現量級是毫秒級掃描）');
});
await TA('★★★[行為] 把寫入 handler 抽出來實跑：休閒 reason 寫 mode=casual、錦標賽寫 tournament', async () => {
  const h = fnSrc(SRV, "app.post('/api/tournament/clientdiag', async (req, res) => {");
  const src = [
    'const docs = []; const _cdiagThrottle = new Map();',
    "const SAMPLE_REASONS = ['perf-sample', 'casual-perf-sample'];",
    "const CASUAL_REASON_PREFIX = 'casual-';",
    "function isCasualReason(r) { return String(r || '').indexOf(CASUAL_REASON_PREFIX) === 0; }",
    'const TCDIAG = { insertOne: async (d) => { docs.push(d); } };',
    'async function tournIdentity() { return { uid: "u1", email: "a@b.c" }; }',
    fnSrc(SRV, 'function _cdiagPack(body) {'),
    'const app = { post: (p, fn) => { globalThis.__h = fn; } };',
    h + ');',   // fnSrc 只抓到大括號區塊，補回 app.post(...) 的收尾
    'return { run: (body) => globalThis.__h({ body }, { json: () => {} }), docs: () => docs, thr: _cdiagThrottle };',
  ].join('\n');
  const hh = new Function(src)();
  await hh.run({ reason: 'casual-slow-push', room: 'AB12' });
  await hh.run({ reason: 'slow-rtt', room: 'R1' });
  await hh.run({ reason: 'casual-perf-sample', room: 'CD34' });
  const d = hh.docs();
  assert.equal(d.length, 3, '寫了 ' + d.length + ' 筆（節流不該擋不同 reason）');
  assert.deepEqual(d.map((x) => x.mode), ['casual', 'tournament', 'casual']);
  // 正對照：同一個 (uid, reason) 在 60 秒內再送一次必須被既有節流擋掉（本版沒有動節流）
  await hh.run({ reason: 'casual-slow-push', room: 'AB12' });
  assert.equal(hh.docs().length, 3, 'per-(uid,reason) 60 秒節流沒有擋住重送');
  // 反向正對照：換一個 reason 就擋不住（證明上面那條不是「什麼都擋」的恆真式）
  await hh.run({ reason: 'casual-forfeit-claim', room: 'AB12' });
  assert.equal(hh.docs().length, 4, '節流變成不分 reason 一律擋 ⇒ 真訊號會被吃掉（v6.160 的教訓）');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ dump 端：三分流 + 防「相加」
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ dump 端：三分流與防相加');
T('★★★[三分流] casual-perf-sample 必須落進 casual 批，不可落進錦標賽的健康對照組', () => {
  const rows = [
    { reason: 'slow-rtt', uid: 'u1', diag: '{}' },
    { reason: 'perf-sample', uid: 'u2', diag: '{}' },
    { reason: 'casual-perf-sample', uid: 'u3', diag: '{}' },
    { reason: 'casual-slow-push', uid: 'u4', diag: '{}' },
    { reason: 'casual-forfeit-claim', uid: 'u5', diag: '{}' },
    { reason: '', uid: 'u6', diag: '{}' },
  ];
  const sp = DUMP.splitDiagRows(rows);
  assert.ok(sp && Array.isArray(sp.casual), 'splitDiagRows 沒有回第三批 casual（BASE 上必紅）');
  assert.equal(sp.anomaly.length, 2, '錦標賽異常批被污染了：' + JSON.stringify(sp.anomaly.map((r) => r.reason)));
  assert.equal(sp.sample.length, 1, '錦標賽健康對照組被污染了：' + JSON.stringify(sp.sample.map((r) => r.reason)));
  assert.equal(sp.casual.length, 3);
  assert.equal(sp.anomaly.length + sp.sample.length + sp.casual.length, rows.length, '有列被吃掉或重複');
  assert.ok(sp.casual.every((r) => DUMP.isCasualReason(r.reason)));
});
T('★[三分流] 空輸入不炸', () => {
  assert.ok(Array.isArray(DUMP.splitDiagRows(null).casual), 'null 輸入沒有回 casual 陣列（BASE 上必紅）');
  assert.ok(Array.isArray(DUMP.splitDiagRows([]).casual), '空陣列輸入沒有回 casual 陣列');
  assert.equal(DUMP.splitDiagRows(null).casual.length, 0);
  assert.equal(DUMP.splitDiagRows([]).casual.length, 0);
});
T('★★★[彙總] casualSummary 實跑：上行分佈、失敗數、棄權宣告的 granted/rejected 都算得出來', () => {
  const mk = (uid, reason, push, claim) => ({
    ts: Date.now(), uid, email: uid + '@x', room: 'AB12', reason,
    diag: JSON.stringify({ reason, mode: 'casual', ver: '6.261', push, claim: claim || null,
      board: { phase: 'playing', turn: 5, logLen: 80, seat: 0, spectator: false },
      env: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', hc: 4, dm: 4 } }),
  });
  assert.equal(typeof DUMP.casualSummary, 'function', 'dump 沒有匯出 casualSummary（BASE 上必紅）');
  const s = DUMP.casualSummary([
    mk('a', 'casual-slow-push', { n: 30, p50: 900, p95: 7200, max: 9100, fail: 2, inflight: 0 }),
    mk('b', 'casual-forfeit-claim', { n: 12, p50: 300, p95: 400, max: 600, fail: 0, inflight: 0 }, { granted: false, idleSec: 180 }),
    mk('c', 'casual-forfeit-claim', { n: 20, p50: 200, p95: 300, max: 400, fail: 1, inflight: 0 }, { granted: true, idleSec: 180 }),
  ]);
  assert.equal(s.rows, 3); assert.equal(s.players, 3);
  assert.equal(s.push.rowsWithPush, 3);
  assert.equal(s.push.fail, 3, '失敗次數沒有累加');
  assert.deepEqual(s.push.p95.slice().sort((x, y) => x - y), [300, 400, 7200]);
  assert.deepEqual(s.forfeitClaim, { total: 2, granted: 1, rejected: 1, unknown: 0 });
  assert.ok(s.byReason.length === 2 && s.byVersion[0].ver === '6.261');
});
T('★[彙總] 空輸入／壞掉的 payload 都不炸（截斷列要算進 truncated）', () => {
  assert.equal(typeof DUMP.casualSummary, 'function', 'dump 沒有匯出 casualSummary（BASE 上必紅）');
  assert.equal(DUMP.casualSummary([]).rows, 0);
  assert.equal(DUMP.casualSummary(null).rows, 0);
  const s = DUMP.casualSummary([{ ts: 1, uid: 'x', reason: 'casual-slow-push', diag: '{"reason":"casual-slow-push","push":{"p95"' }]);
  assert.equal(s.truncated, 1);
});
T('★★★[防相加] main() 真的三分流，而且既有統計吃的仍然是錦標賽那兩批', () => {
  const strip = DUMPSRC.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/const rawCasual = _split\.casual;/.test(strip), 'main() 沒有接第三批');
  assert.ok(/const casual = casualSummary\(rawCasual\);/.test(strip), '有 helper 沒接＝白寫');
  assert.ok(/\n\s*casual: casual,/.test(strip), 'JSON 沒有寫出 casual 區塊');
  assert.ok(/const raw = _split\.anomaly;/.test(strip) && /const rawSample = _split\.sample;/.test(strip),
    '既有兩批的接線被動掉了');
});
T('★★★[防相加] dump 摘要與 admin 都明講「絕不可以相加」', () => {
  assert.ok(DUMPSRC.includes('絕不可以**跟上面【②】【②-d】的任何數字相加'), 'dump 摘要沒有防相加的警告');
  assert.ok(DUMPSRC.includes('【②-e 🎮 休閒對戰批'), 'dump 摘要沒有休閒批的區塊');
  assert.ok(DUMPSRC.includes('是三個不同的陣列'), 'dump 沒有講清楚 JSON 裡是三個陣列');
  assert.ok(ADMIN.includes('兩批的數字永遠不可以相加'), 'admin 沒有防相加的警告');
});
T('★★[誠實] 休閒批 0 筆時不可以被讀成「休閒都很順」', () => {
  assert.ok(DUMPSRC.includes('這**不是**「休閒都很順」'), 'dump 沒有講清楚 0 筆的三種可能');
});
T('★★[口徑] dump 與伺服器的 SAMPLE_REASONS／casual 前綴逐字相同', () => {
  const m = /const SAMPLE_REASONS = (\[[^\]]*\]);/.exec(SRV);
  assert.ok(m, '抓不到伺服器的 SAMPLE_REASONS');
  assert.deepEqual(DUMP.SAMPLE_REASONS, JSON.parse(m[1].replace(/'/g, '"')));
  const p = /const CASUAL_REASON_PREFIX = '([^']+)';/.exec(SRV);
  assert.ok(p, '抓不到伺服器的 CASUAL_REASON_PREFIX（BASE 上必紅）');
  assert.equal(DUMP.CASUAL_REASON_PREFIX, p[1]);
});
T('★[admin] client 送的三種休閒指紋，admin 都有白話說明', () => {
  for (const r of ['casual-slow-push', 'casual-perf-sample', 'casual-forfeit-claim']) {
    assert.ok(new RegExp("'" + r + "': \\[").test(ADMIN), 'admin 缺少 ' + r + ' 的說明');
  }
});
T('★[test chain] 本守衛與量測腳本都在 package.json 的 test 裡（不在 chain 裡＝沒有保護）', () => {
  assert.ok(PKG.scripts.test.includes('test-v6261-casual-clientdiag.mjs'), '守衛沒進 test chain');
  assert.ok(PKG.scripts.test.includes('test-v6261-perf.mjs'), '量測腳本沒進 test chain');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑦ 突變測試（每一個都必須紅在**預期那一條**）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ 突變測試');
async function mutant(name, mutate, probe) {
  if (!SETUP_OK) { fail++; console.log('  FAIL [突變] ' + name + ' ⇒ 跑不了（' + SETUP_WHY + '）'); return; }
  let red = false, why = '';
  try { await probe(await mkClient(mutate)); }
  catch (e) { if (e instanceof assert.AssertionError) { red = true; why = e.message; } else throw e; }
  if (red) { pass++; console.log('  PASS [突變] ' + name + ' ⇒ 紅（' + why.slice(0, 70) + '）'); }
  else { fail++; console.log('  FAIL [突變] ' + name + ' ⇒ 竟然全綠 ⇒ 守衛沒測到這件事'); }
}
await mutant('休閒 reason 掉回錦標賽路徑（return true → return false）',
  (s) => s.replace('if (isTournament || isTournSpectator) return true;', 'if (isTournament || isTournSpectator) return false;'),
  (h) => {
    h.set('isTournament', true);
    assert.equal(h._casualDiagSend('casual-slow-push', Date.now()), true, '掉回錦標賽路徑了');
  });
await mutant('骰子改成每發都擲（機率就不再是 PERF_SAMPLE_RATE）',
  (s) => s.replace('      if (!ok) { _casualPushFail++; return; }',
    '      _casualSampleArmed = Math.random() < PERF_SAMPLE_RATE;\n      if (!ok) { _casualPushFail++; return; }'),
  (h) => {
    h.set('rnd', 0.001);
    for (let i = 0; i < 5; i++) h._casualRecordPush(120, true);
    h.set('rnd', 0.99);
    for (let i = 0; i < 50; i++) h._casualRecordPush(120, true);
    assert.equal(h.posted().length, 1, '同一場內重擲了骰子');
  });
await mutant('拿掉 per-page 硬上限（休閒是 94% 流量，上限沒了就是流量風險）',
  (s) => s.replace('if (_casualDiagSent >= CASUAL_DIAG_MAX_PER_PAGE) return true;', ''),
  (h) => {
    for (let i = 0; i < 500; i++) h._casualDiagSend('casual-slow-push', Date.now());
    assert.ok(h.posted().length <= 10, '送了 ' + h.posted().length + ' 發');
  });
await mutant('匿名玩家也送（伺服器一定丟棄 ⇒ 純粹白付請求）',
  (s) => s.replace('if (!firebaseUser || firebaseUser.isAnonymous) return true;', ''),
  (h) => {
    h.set('firebaseUser', { isAnonymous: true });
    h._casualDiagSend('casual-slow-push', Date.now());
    assert.equal(h.posted().length, 0, '匿名也送出去了');
  });
await mutant('把逾時的推送也記進樣本（p95 會被 120 秒灌爆）',
  (s) => s.replace('if (!ok) { _casualPushFail++; return; }', 'if (!ok) { _casualPushFail++; }'),
  (h) => {
    h.set('rnd', 0.99);
    for (let i = 0; i < 20; i++) h._casualRecordPush(120000, false);
    assert.equal(h.get('_casualPushSamples').length, 0, '逾時被記進樣本了');
  });
await mutant('slow-push 每場送多發（一場對戰就能洗版）',
  (s) => s.replace('{ _casualSlowSent = true; _tSendClientDiag(\'casual-slow-push\'); }',
    '{ _tSendClientDiag(\'casual-slow-push\'); }'),
  (h) => {
    h.set('rnd', 0.99);
    for (let i = 0; i < 30; i++) h._casualRecordPush(60000, true);
    assert.equal(h.posted().length, 1, '送了 ' + h.posted().length + ' 發');
  });
// dump 端的突變（改順序 ⇒ 休閒的健康樣本會混進錦標賽的對照組）
{
  const src = DUMPSRC;
  const hasSplit = src.includes('if (isCasualReason(r && r.reason)) { casual.push(r); continue; }');
  const mutated = src.replace(
    "    if (isCasualReason(r && r.reason)) { casual.push(r); continue; }\n",
    '');
  let red = false;
  if (!hasSplit) { fail++; console.log('  FAIL [突變] dump 三分流順序顛倒 ⇒ 跑不了（出貨碼還沒有三分流）'); }
  else {
  try {
    const f = new Function('SAMPLE_REASONS', 'CASUAL_REASON_PREFIX',
      fnSrc(mutated, 'function splitDiagRows(rows) {')
      + "\nfunction isSampleReason(r) { return SAMPLE_REASONS.indexOf(String(r || '')) >= 0; }"
      + "\nfunction isCasualReason(r) { return String(r || '').indexOf(CASUAL_REASON_PREFIX) === 0; }"
      + '\nreturn splitDiagRows;')(DUMP.SAMPLE_REASONS, DUMP.CASUAL_REASON_PREFIX);
    const sp = f([{ reason: 'casual-perf-sample', uid: 'x' }]);
    assert.equal(sp.sample.length, 0, '休閒的健康樣本混進錦標賽對照組了');
  } catch (e) { if (e instanceof assert.AssertionError) red = true; else throw e; }
  if (red) { pass++; console.log('  PASS [突變] dump 三分流順序顛倒 ⇒ 紅'); }
  else { fail++; console.log('  FAIL [突變] dump 三分流順序顛倒 ⇒ 竟然全綠'); }
  }
}

console.log('\n=== v6.261 休閒對戰診斷指紋: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
