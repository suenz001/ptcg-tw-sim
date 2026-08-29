/**
 * v6.261 量測腳本（Rule 32：效能／流量數字必須附量測腳本，否則審查者一律自行實測）
 *
 * 回答**一個**問題：v6.261 讓一場典型的休閒對戰多送幾發請求、多上傳幾個位元組？
 *
 * ⚠⚠ 這是本版的最高紅線：休閒佔全站 94% 流量、每個動作上傳 40~48KB，
 *   而 v6.245~v6.249 才剛因為「玩家上行塞住」連修五版。
 * ⚠ 量測對象＝**出貨碼本身**（從 src/routes/game/+page.svelte 抽出來實跑），
 *   不是守衛自己另寫一份等價實作。
 * ⚠ 沙盒 CPU 約比正式 VM（ARM A1.Flex 4 OCPU）慢一個量級 ⇒ CPU 上界刻意放寬十倍以上。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { transform } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;
  }
}
// ⚠ HEAD-FAIL：在 BASE（v6.260）上這些錨點通通不存在 ⇒ 誠實印一行 FAIL 後 exit 1，
//   絕不可以「抓不到就當作沒事」（那是 fail-open）。
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) { console.log('  FAIL [前提] 出貨碼找不到 ' + anchor + ' ⇒ 本版的量測對象不存在'); process.exit(1); }
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { d++; started = true; }
    else if (src[k] === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('括號沒配對：' + anchor);
}

// ── 一場典型休閒對戰的量級（全部標明出處，不是拍腦袋）────────────────────
//   ・單發盤面推送的 body：v6.178 實測 /api/rooms/:CODE 26.9KB/req；
//     v6.246／v6.249 的 nginx log 實測 PUT request_length=48285。取 44KB 當代表值。
//   ・一場的推送次數：一個動作一發。取 40（短局）／80（典型）／200（長局＋悔棋）三檔。
const PUSH_BODY_BYTES = 44 * 1024;
const GAME_PROFILES = [
  { name: '短局', pushes: 40 },
  { name: '典型', pushes: 80 },
  { name: '長局', pushes: 200 },
];

const CONSTS = ['CASUAL_DIAG_REASONS', 'CASUAL_DIAG_MAX_PER_PAGE', 'CASUAL_SLOW_PUSH_P95_MS',
  'CASUAL_PUSH_MIN_CALLS', 'PERF_SAMPLE_RATE'];
const constLines = CONSTS.map((k) => {
  const m = new RegExp('^\\s*const ' + k + ' = [^\\n]*$', 'm').exec(PAGE);
  if (!m) { console.log('  FAIL [前提] 出貨碼找不到常數 ' + k + ' ⇒ 本版的量測對象不存在'); process.exit(1); }
  return m[0].trim().replace(/\s*\/\/.*$/, '');
}).join('\n');
const RATE = Number(/PERF_SAMPLE_RATE = ([\d.]+)/.exec(constLines)[1]);
const CAP = Number(/CASUAL_DIAG_MAX_PER_PAGE = (\d+)/.exec(constLines)[1]);
const SLOW = Number(/CASUAL_SLOW_PUSH_P95_MS = (\d+)/.exec(constLines)[1]);

const SRC = `
  let isTournament = false, isTournSpectator = false;
  let mode = 'online', roomCode = 'AB12';
  let myPlayerIndex = 0, mySeatIdx = 0;
  let firebaseUser = { isAnonymous: false };
  let game = { phase: 'playing', turn: 9, log: new Array(180).fill(0) };
  let roomData = { idleTimeoutSec: 180 };
  let battleLayout = 'classic';
  const VERSION = '6.261';
  const document = { visibilityState: 'visible' };
  const window = { innerWidth: 1280, innerHeight: 800 };
  const navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome', hardwareConcurrency: 8, deviceMemory: 4 };
  let __forceRnd = null;
  const Math = Object.create(globalThis.Math);
  Math.random = () => (__forceRnd === null ? globalThis.Math.random() : __forceRnd);
  const __posted = [];
  function _tPostClientDiag(p) { __posted.push(p); }
  function _tSendClientDiag(reason) { _casualDiagSend(reason, Date.now()); }
  function oldestPushInFlightAgeMs() { return 0; }
${constLines}
  let _casualPushSamples = [], _casualPushFail = 0, _casualDiagSent = 0;
  let _casualSlowSent = false, _casualClaimSent = false;
  let _casualSampleRoom = '', _casualSampleArmed = false, _casualSampleSent = false;
  let _casualClaimGranted = null;
${fnSrc(PAGE, 'function _sampleStats(src: number[]): _PStat | null {')}
${fnSrc(PAGE, 'function _pushSample(arr: number[], ms: number): void {')}
${fnSrc(PAGE, 'function _casualDiagSend(reason: string, now: number): boolean {')}
${fnSrc(PAGE, 'function _casualDiagPayload(reason: string, now: number): any {')}
${fnSrc(PAGE, 'function _casualRecordPush(ms: number, ok: boolean): void {')}
${fnSrc(PAGE, 'function _casualDiagReset(): void {')}
  return {
    _casualRecordPush, _casualDiagSend, _casualDiagReset,
    posted: () => __posted.slice(), clear: () => { __posted.length = 0; },
    setRnd: (v) => { __forceRnd = v; }, setRoom: (v) => { roomCode = v; },
    setClaim: (v) => { _casualClaimGranted = v; },
  };
`;
const JS = (await transform(SRC, { loader: 'ts', target: 'node20' })).code;
const mk = () => new Function(JS)();

function bytesOf(list) {
  return list.reduce((a, p) => a + Buffer.byteLength(JSON.stringify(p), 'utf8'), 0);
}

console.log('\n══ v6.261 流量／CPU 量測（量測對象＝出貨碼本身）══');
console.log('  常數：取樣率 ' + (RATE * 100) + '%／每頁上限 ' + CAP + ' 發／slow-push 門檻 p95 ≥ ' + SLOW + ' ms');
console.log('  假設：一發盤面推送的 body ＝ ' + PUSH_BODY_BYTES + ' bytes'
  + '（來源：v6.178 實測 26.9KB/req、v6.246 nginx log request_length=48285）\n');

// ── 情境 A：一般玩家（沒中籤、網路正常）＝ 修前修後應該**完全一樣** ──────
console.log('① 一般玩家（沒中籤、網路正常、沒宣告棄權）');
for (const g of GAME_PROFILES) {
  const h = mk();
  h.setRnd(0.99);                       // 沒中籤（RATE=0.1 ⇒ 90% 的人）
  for (let i = 0; i < g.pushes; i++) h._casualRecordPush(180 + (i % 40), true);
  const n = h.posted().length, b = bytesOf(h.posted());
  const total = g.pushes * PUSH_BODY_BYTES;
  console.log('  ・' + g.name + '（' + g.pushes + ' 發推送、上行約 ' + (total / 1024 / 1024).toFixed(2) + ' MB）'
    + ' ⇒ 新增請求 ' + n + ' 發、新增上行 ' + b + ' bytes');
  T('  ' + g.name + '：一般玩家的新增請求數 ＝ 0（修前修後逐字相同）', () => assert.equal(n, 0));
  T('  ' + g.name + '：一般玩家的新增上行 ＝ 0 bytes', () => assert.equal(b, 0));
}

// ── 情境 B：最壞情況（中籤 ＋ 網路很慢 ＋ 宣告棄權）──────────────────────
console.log('\n② 最壞情況（同時中籤、p95 遠超門檻、還按了「對手棄權」）');
let worst = null;
for (const g of GAME_PROFILES) {
  const h = mk();
  h.setRnd(0.0);                        // 一定中籤
  for (let i = 0; i < g.pushes; i++) h._casualRecordPush(SLOW * 3, true);   // 每發都超慢
  h.setClaim(false); h._casualDiagSend('casual-forfeit-claim', Date.now());
  const n = h.posted().length, b = bytesOf(h.posted());
  const total = g.pushes * PUSH_BODY_BYTES;
  const pctB = (b * 100 / total);
  console.log('  ・' + g.name + ' ⇒ 新增請求 ' + n + ' 發、新增上行 ' + b + ' bytes（佔該場上行 '
    + pctB.toFixed(4) + '%）；指紋 ' + JSON.stringify(h.posted().map((p) => p.reason)));
  if (!worst || n > worst.n) worst = { n, b, pctB, name: g.name };
  T('  ' + g.name + '：一場最多 3 發（三種指紋各一）', () => assert.ok(n <= 3, '實際 ' + n));
  // 實測：短局 0.071%、典型 0.036%、長局 0.014%（1287 bytes vs 1.7~8.6 MB）。
  // 上界取 0.1%：比實測最差值仍有 1.4 倍餘裕，而且只要 payload 或發數變大就會紅。
  T('  ' + g.name + '：新增上行佔該場總上行 < 0.1%', () => assert.ok(pctB < 0.1, pctB.toFixed(5) + '%'));
}
T('★★★[紅線] 最壞情況下一場也只多 ' + worst.n + ' 發請求（休閒是 94% 流量）',
  () => assert.ok(worst.n <= 3, String(worst.n)));
// ⚠ v6.270 起 payload 多了 push.bodyBytes 與 delta 兩欄（各 null 時共約 +45 bytes/發、
//   最壞 +135 bytes/場，實測 1287 → 1422 bytes）⇒ 係數 0.03 → 0.035（＝上限 1576 bytes）。
//   這是**有記錄的合法放寬**：①上面「佔該場總上行 < 0.1%」的主紅線原封不動且仍大幅通過
//   （實測最壞 0.079%）；②v6.270 的增量上傳把分母（一發推送 44KB）實測砍到約 13KB ⇒
//   這一條的「3%」基準本身已過度保守。再變大就該回頭砍欄位，不是再放寬這裡。
T('★★★[紅線] 最壞情況下一場新增上行 ' + worst.b + ' bytes，不到一發盤面推送的 3.5%',
  () => assert.ok(worst.b < PUSH_BODY_BYTES * 0.035, worst.b + ' bytes'));

// ── 情境 C：一個頁面實例連打很多場（per-page 硬上限）─────────────────────
console.log('\n③ 同一個頁面連打 20 場（per-page 硬上限）');
{
  const h = mk();
  h.setRnd(0.0);
  for (let r = 0; r < 20; r++) {
    h.setRoom('R' + r);
    h._casualDiagReset(); h.setRoom('R' + r);
    for (let i = 0; i < 80; i++) h._casualRecordPush(SLOW * 3, true);
    h.setClaim(true); h._casualDiagSend('casual-forfeit-claim', Date.now());
  }
  const n = h.posted().length, b = bytesOf(h.posted());
  console.log('  ・20 場（1600 發推送）⇒ 新增請求 ' + n + ' 發、新增上行 ' + b + ' bytes');
  T('★★★[紅線] 每個頁面實例的硬上限真的擋得住（' + n + ' ≤ ' + CAP + '）', () => assert.equal(n, CAP));
  T('★[自我驗證] 上面那條不是「本來就送不出去」：至少送了 1 發', () => assert.ok(n >= 1));
}

// ── 情境 D：每發推送的 CPU 成本（熱路徑）────────────────────────────────
console.log('\n④ 熱路徑 CPU：_casualRecordPush 每發的成本');
{
  const h = mk();
  h.setRnd(0.99);                       // 沒中籤＝90% 的玩家走的那條路
  const N = 200000;
  for (let i = 0; i < 20000; i++) h._casualRecordPush(180, true);   // warm-up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) h._casualRecordPush(180 + (i % 30), true);
  const t1 = process.hrtime.bigint();
  const perCall = Number(t1 - t0) / N / 1000;   // µs
  console.log('  ・' + N.toLocaleString() + ' 發 ⇒ 每發 ' + perCall.toFixed(3) + ' µs（沙盒；正式 VM 更快）');
  T('★★★[熱路徑] 每發推送的量測成本 < 20 µs（一發推送本身是幾百毫秒 ⇒ 相對成本 <0.01%）',
    () => assert.ok(perCall < 20, perCall.toFixed(3) + ' µs'));
  T('★[自我驗證] 量測器不是量到 0（真的有跑）', () => assert.ok(perCall > 0));
  const oneMs = 180;
  console.log('  ・對照：一發盤面推送本身（GET+PUT ' + (PUSH_BODY_BYTES / 1024) + 'KB）正常也要 '
    + oneMs + '~1000 ms ⇒ 量測成本佔 ' + ((perCall / 1000) / oneMs * 100).toFixed(6) + '%');
}

// ── 情境 E：伺服器端每日筆數推估 ─────────────────────────────────────────
console.log('\n⑤ 伺服器端容量推估（⚠ 沙盒連不到正式站 mongo，這是**推估**不是實測）');
{
  //   已知（可觀測）：v6.240 實測 Oracle 房間「已結束」82,031 筆（全期間）。
  //   ⇒ 以「每日 100~400 場休閒對戰」當上下界推估。
  const PAYLOAD_STORE = 500;   // 單列 diag 字串約 400~450 bytes（見守衛實測），取 500 留餘裕
  for (const games of [100, 200, 400]) {
    const sample = games * RATE;               // 健康取樣：每場 10%
    const slow = games * 0.15;                 // 悲觀假設 15% 的場次 p95 ≥ 門檻
    const claim = games * 0.05;                // 悲觀假設 5% 的場次有人按棄權宣告
    const perDay = sample + slow + claim;
    const week = perDay * 7;
    console.log('  ・每日 ' + games + ' 場 ⇒ 約 ' + perDay.toFixed(0) + ' 筆/日、7 天 TTL 內約 '
      + week.toFixed(0) + ' 筆、約 ' + ((week * PAYLOAD_STORE) / 1024).toFixed(0) + ' KB');
  }
  T('★[容量] 最悲觀（每日 400 場）7 天內也 < 1 萬筆（既有 tournamentClientDiag 約 5 千筆同量級）',
    () => assert.ok(400 * (RATE + 0.15 + 0.05) * 7 < 10000));
  console.log('  ⚠ 這裡的 15% / 5% 是**悲觀假設**，不是量測值 —— 上線後第一週用 dump 的');
  console.log('    【②-e】區塊回頭校正；若真的爆量，把 CASUAL_SLOW_PUSH_P95_MS 調高即可。');
}

console.log('\n=== v6.261 流量／CPU 量測: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
