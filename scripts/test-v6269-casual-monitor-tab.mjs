#!/usr/bin/env node
/**
 * v6.269 守衛 — admin 📡 監控分頁的「🎮 休閒對戰批」子表 ＋ dump 彙總段的重複計算修正
 *
 * 背景：
 *   ① v6.261 把休閒對戰接上診斷指紋，但**刻意沒有**把休閒批加進 admin 的 📡 分頁
 *      （怕動到既有數字口徑），只做在 dump 的【②-e】區塊 ⇒ 站長每次要看得跑 dump-monitor.bat。
 *      ⚠ 而且 v6.261 備好的 `?mode=casual` **只換掉了 120 筆明細的來源** ——
 *        byReason 走 `_aggAll.filter(!isCasualReason)`、sampleRttRows 寫死 `mode:{$ne:'casual'}`
 *        ⇒ 帶那個參數拿不到任何休閒**統計**。本版補一條完全獨立的伺服器路徑。
 *   ② dump 的 `byReason` 彙總段只濾 `isSampleReason`、**沒濾** `isCasualReason`
 *      ⇒ casual-slow-push / casual-forfeit-claim 同時落進【②】與【②-e】＝重複計算。
 *
 * ⚠⚠ 本檔的紀律（歷史上踩過**八次**守衛安慰劑）：
 *   ・能實跑的一律實跑（把函式抽出來餵資料，不是只驗字串存在）；
 *   ・DOM／行為層斷言（v6.154 的教訓：22 條守衛全綠但分頁根本打不開）；
 *   ・否定型一律配正對照；
 *   ・「逐位元未動」用**內嵌 sha256**（淺複製下也在守）；
 *   ・只捕捉 assert.AssertionError（其他例外一律讓它炸出來，不可被當成 PASS）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import * as cheerio from 'cheerio';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const DUMPSRC = readFileSync(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const DUMP = (await import('node:module')).createRequire(import.meta.url)(
  join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'));

const BASE_SHA = '1f3a7baa69207c6a88fe42d8ca18d1f906578b56';   // v6.268

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;   // ⚠ 非斷言例外一律讓它炸：吞掉就是安慰劑
  }
}
async function TA(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;
  }
}

// ── 取原始碼片段（大括號配對，不是 regex 猜）────────────────────────────────
// ⚠⚠ HEAD-FAIL 紀律：在 BASE（v6.268）上跑時這些錨點通通不存在。抽不到就丟
//   AssertionError（不是 Error）⇒ **每一條各自紅**，而不是整支在第一個缺口就中止。
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new assert.AssertionError({ message: '括號沒配對：' + anchor });
}
function blockSrc(src, anchor, endMark) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new assert.AssertionError({ message: '找不到結尾：' + endMark });
  return src.slice(i, j + endMark.length);
}
function constLine(src, name) {
  const m = new RegExp('^\\s*const ' + name + ' = [^\\n]*$', 'm').exec(src);
  if (!m) throw new assert.AssertionError({ message: '找不到常數：' + name });
  return m[0].trim().replace(/\s*\/\/.*$/, '');
}

console.log('\n══ v6.269 admin 📡 分頁的 🎮 休閒子表 ══');

// ══════════════════════════════════════════════════════════════════════════
// ① 後端：`?mode=casual` 的真實現況 ＋ 本版新增的獨立路徑
// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 後端 ?mode=casual 與獨立路徑');
T('[複驗] v6.261 的 `?mode=casual` 入口確實存在（本版沿用，不是重造）', () => {
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  assert.ok(i > 0, '找不到 clientdiag 讀取端點');
  const seg = SRV.slice(i, i + 7200);
  assert.ok(/const _wantCasual = String\(req\.query\.mode \|\| ''\) === 'casual';/.test(seg), '沒有 ?mode=casual 入口');
  assert.ok(/q\.mode = _wantCasual \? 'casual' : \{ \$ne: 'casual' \};/.test(seg), 'mode 分帳被動過');
});
T('★★★[複驗／本版的理由] v6.261 的 `?mode=casual` **只換掉 rows 的來源**，統計三塊都寫死排除休閒', () => {
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  const seg = SRV.slice(i, i + 7600);
  // 這三條在 BASE 與本版都成立 —— 它們正是「帶了參數也拿不到休閒統計」的證據，
  // 也是本版**不可以**去動它們（動了錦標賽口徑就變）的理由。
  assert.ok(/const agg = _aggAll\.filter\(function \(a\) \{ return !isCasualReason\(a\._id\); \}\)/.test(seg),
    'byReason 的來源不再排除休閒 ⇒ 錦標賽的指紋表會被污染');
  assert.ok(/mode: \{ \$ne: 'casual' \}, reason: \{ \$in: SAMPLE_REASONS \}/.test(seg),
    '健康對照組的查詢沒有排除休閒');
  assert.ok(/reason: 'slow-rtt'/.test(seg), 'slowRtt 的查詢被動過');
});
T('★★★[本版] 休閒批走**早退**的獨立路徑（錦標賽那一整段完全不會執行到）', () => {
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  const seg = SRV.slice(i, i + 7600);
  assert.ok(/if \(_wantCasual\) \{/.test(seg), '沒有休閒的早退分支 ⇒ ?mode=casual 仍然拿不到統計（BASE 上必紅）');
  assert.ok(/return res\.json\(await _cb\(TCDIAG, since, hours\)\);/.test(seg), '早退沒有回休閒報表');
  const iEarly = seg.indexOf('if (_wantCasual) {');
  const iAgg = seg.indexOf('const _aggAll = await TCDIAG.aggregate(');
  assert.ok(iEarly > 0 && iAgg > iEarly, '早退排在錦標賽的 aggregate 之後 ⇒ 休閒也會付那一發查詢的成本');
});
T('★★★[跨 IIFE] helper 與中央 adminScanYield 同一個 closure，消費端走 app.locals 且 **fail-closed**', () => {
  // ⚠ 這一條是本版實際踩到的坑：`_buildCasualDiagReport` 一開始寫在檔尾的錦標賽 IIFE 裡，
  //   而中央 adminScanYield 在 firebase-admin 區塊內 ⇒ 執行到就 ReferenceError
  //   （node --check 過、既有守衛 test-admin-helper-scope 的 acorn 掃描抓到）。
  const iYield = SRV.indexOf('function adminScanYield(n) {');
  const iDef = SRV.indexOf('async function _buildCasualDiagReport(coll, since, hours) {');
  const iIIFE = SRV.indexOf('  (function registerMatchRecords() {');
  const iTourn = SRV.indexOf('\n(async () => {');
  assert.ok(iYield > 0 && iDef > 0 && iIIFE > 0 && iTourn > 0, '定位錨點抓不到（BASE 上必紅）');
  assert.ok(iDef > iYield, 'helper 定義在 adminScanYield 之前');
  assert.ok(iDef < iIIFE, 'helper 沒有和 adminScanYield 在同一個 closure（會 ReferenceError）');
  assert.ok(iDef < iTourn, 'helper 掉進檔尾的錦標賽 IIFE 了');
  assert.ok(/app\.locals\._buildCasualDiagReport = _buildCasualDiagReport;/.test(SRV), '沒有掛上 app.locals 橋接');
  const seg = SRV.slice(SRV.indexOf("app.get('/api/tournament/admin/clientdiag'"), SRV.indexOf("app.get('/api/tournament/admin/clientdiag'") + 7600);
  assert.ok(/const _cb = \(app\.locals \|\| \{\}\)\._buildCasualDiagReport;/.test(seg),
    '消費端沒有在 handler 執行時才取（註冊時取會拿到 undefined）');
  assert.ok(/if \(typeof _cb !== 'function'\) return res\.status\(503\)/.test(seg),
    '取不到 helper 時沒有 fail-closed ⇒ 可能退回去跑一份沒有讓路節拍的掃描');
});
T('★★★[權限] 休閒明細含玩家 email ⇒ 讀取端必須有 isTournAdmin gate（而且在早退之前）', () => {
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  const seg = SRV.slice(i, i + 7600);
  const iGate = seg.indexOf('if (!isTournAdmin(id)) return res.status(403)');
  const iEarly = seg.indexOf('if (_wantCasual) {');
  assert.ok(iGate > 0, '讀取端沒有管理員 gate');
  assert.ok(iEarly > iGate, '休閒早退排在管理員 gate 之前 ⇒ 任何人都拿得到玩家 email');
});
T('★★[容量] 本版沒有新增端點、collection、索引（休閒批共用既有那一張表）', () => {
  assert.ok(!/app\.(get|post)\('\/api\/[^']*casual[^']*'/.test(SRV), '出現了休閒專用端點');
  const cols = [...SRV.matchAll(/db\.collection\('([A-Za-z]+)'\)/g)].map((m) => m[1]);
  assert.ok(!cols.some((c) => /casual/i.test(c)), '出現了休閒專用 collection');
  assert.equal((SRV.match(/TCDIAG\.createIndex\(/g) || []).length, 1, 'tournamentClientDiag 多了索引');
  assert.ok(/TCDIAG\.createIndex\(\{ ts: 1 \}, \{ expireAfterSeconds: 604800 \}\)/.test(SRV), 'TTL 索引被動過');
});

// ══════════════════════════════════════════════════════════════════════════
// ② 伺服器端彙總：把 `_buildCasualDiagReport` 抽出來**實跑**
// ══════════════════════════════════════════════════════════════════════════
console.log('\n② 伺服器端彙總（實跑，餵假 collection）');

function srvHarness(mutate) {
  const parts = [
    constLine(SRV, 'ADMIN_SCAN_YIELD_EVERY'),
    fnSrc(SRV, 'function adminScanYield(n) {'),
    constLine(SRV, 'CASUAL_DIAG_SCAN_CAP'),
    constLine(SRV, 'CASUAL_DIAG_ROWS_SHOWN'),
    fnSrc(SRV, 'function _casualUaShort(ua) {'),
    fnSrc(SRV, 'function _casualQuant(arr, q) {'),
    fnSrc(SRV, 'async function _buildCasualDiagReport(coll, since, hours) {'),
  ].join('\n');
  const body = mutate ? mutate(parts) : parts;
  const src = body + '\nreturn { _buildCasualDiagReport, _casualQuant, _casualUaShort, CAP: CASUAL_DIAG_SCAN_CAP, EVERY: ADMIN_SCAN_YIELD_EVERY };';
  return new Function(src)();
}
/** 假的 mongo collection：忠實重現「批內 next() 是已解決的 promise」（v6.242 的關鍵事實）。 */
function fakeColl(rows) {
  return {
    find(q) {
      const sel = rows.filter((r) => r.ts >= q.ts.$gte && r.mode === q.mode);
      let lim = Infinity;
      const chain = {
        sort() { return chain; },
        limit(n) { lim = n; return chain; },
        _i: 0,
        async hasNext() { return chain._i < Math.min(sel.length, lim); },
        async next() { return sel[chain._i++]; },
      };
      return chain;
    },
  };
}
const NOW = 1756500000000;
function mkRow(o) {
  const diag = o.diagRaw !== undefined ? o.diagRaw : JSON.stringify({
    reason: o.reason, mode: 'casual', ver: o.ver || '6.264',
    push: o.push === null ? undefined : (o.push || { n: 30, p50: 400, p95: 700, max: 900, fail: 0, inflight: 0 }),
    claim: o.claim === undefined ? null : o.claim,
    board: { phase: 'playing', turn: 5, logLen: 80, seat: 0, spectator: false },
    env: { ua: o.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', hc: 8, dm: 8 },
  });
  return { ts: o.ts || NOW, uid: o.uid, email: o.uid + '@x', room: o.room || 'AB12',
    reason: o.reason, mode: 'casual', diag, truncated: !!o.truncated, rawLen: o.rawLen || null };
}
// ⭐ fixture 依站長給的 2026-08-30 dump（212 筆 / 112 人）的**結構**縮小重建。
const FIX = [
  mkRow({ uid: 'a', reason: 'casual-slow-push', push: { n: 30, p50: 1000, p95: 7200, max: 9100, fail: 2 } }),
  mkRow({ uid: 'b', reason: 'casual-slow-push', push: { n: 30, p50: 400, p95: 6000, max: 102600, fail: 3 } }),
  mkRow({ uid: 'c', reason: 'casual-perf-sample', ver: '6.267', push: { n: 20, p50: 300, p95: 500, max: 700, fail: 0 }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }),
  mkRow({ uid: 'd', reason: 'casual-forfeit-claim', claim: { granted: true, idleSec: 180 }, push: { n: 12, p50: 200, p95: 300, max: 400, fail: 0 }, ua: 'Mozilla/5.0 (Linux; Android 14)' }),
  mkRow({ uid: 'e', reason: 'casual-forfeit-claim', claim: { granted: false, idleSec: 180 }, push: { n: 12, p50: 250, p95: 350, max: 450, fail: 1 } }),
  mkRow({ uid: 'a', reason: 'casual-phantom-adopt', push: { n: 15, p50: 500, p95: 800, max: 1000, fail: 0 } }),
  // 被截斷的一列（合法 JSON 切一半）——truncated 要算得出來，而且不可以讓整支炸掉
  mkRow({ uid: 'f', reason: 'casual-slow-push', diagRaw: '{"reason":"casual-slow-push","push":{"p95"', truncated: true, rawLen: 9000 }),
];
let REPORT = null;
await TA('★★★[核心] 休閒彙總實跑：筆數／人數／截斷／指紋次數', async () => {
  const h = srvHarness(null);
  REPORT = await h._buildCasualDiagReport(fakeColl(FIX), NOW - 3600000, 24);
  assert.equal(REPORT.rows, 7, '筆數 ' + REPORT.rows);
  assert.equal(REPORT.players, 6, '人數 ' + REPORT.players + '（uid a 出現兩次，只能算一人）');
  assert.equal(REPORT.truncated, 1, '截斷數 ' + REPORT.truncated);
  assert.equal(REPORT.casualApi, 1, '缺少 casualApi 哨兵 ⇒ 舊伺服器與「真的 0 筆」分不開');
  const by = Object.fromEntries(REPORT.byReason.map((r) => [r.reason, r.n]));
  assert.deepEqual(by, { 'casual-slow-push': 3, 'casual-forfeit-claim': 2, 'casual-perf-sample': 1, 'casual-phantom-adopt': 1 });
  assert.ok(REPORT.byReason[0].n >= REPORT.byReason[REPORT.byReason.length - 1].n, 'byReason 沒有依次數排序');
});
T('★★★[核心] 上行分佈：失敗那幾發**沒有**進 p50/p95，但要單獨累加', () => {
  assert.ok(REPORT, '沒有報表可驗');
  const pu = REPORT.push;
  assert.equal(pu.rowsWithPush, 6, '有 push 欄的列數 ' + pu.rowsWithPush + '（截斷那列解析不出來，不算）');
  assert.equal(pu.fail, 6, '失敗累計 ' + pu.fail + '（2+3+0+0+1+0）');
  assert.equal(pu.p95max, 7200, 'p95 最差 ' + pu.p95max);
  assert.equal(pu.maxmax, 102600, '單發最久 ' + pu.maxmax);
  // p50 中位數：[200,250,300,400,500,1000] ⇒ quant(0.5)=第 3 個(0-based)=400
  assert.equal(pu.p50med, 400, 'p50 中位數 ' + pu.p50med);
  // p95 中位數：[300,350,500,800,6000,7200] ⇒ 800
  assert.equal(pu.p95med, 800, 'p95 中位數 ' + pu.p95med);
});
T('★★★[核心] 棄權宣告：granted / rejected / unknown 三分，rejected ＝宣告者的畫面是舊的', () => {
  assert.ok(REPORT, '沒有報表可驗');
  assert.deepEqual(REPORT.forfeitClaim, { total: 2, granted: 1, rejected: 1, unknown: 0 });
});
T('★★[核心] 版本／平台分佈算得出來（平台判準逐字對齊 dump 的 uaShort）', () => {
  assert.ok(REPORT, '沒有報表可驗');
  const ver = Object.fromEntries(REPORT.byVersion.map((v) => [v.ver, v.n]));
  assert.equal(ver['6.264'], 5); assert.equal(ver['6.267'], 1); assert.equal(ver['(未知)'], 1, '截斷列的版本要記成(未知)不是消失');
  const plat = Object.fromEntries(REPORT.byPlatform.map((v) => [v.platform, v.n]));
  assert.equal(plat['Windows'], 4); assert.equal(plat['iOS / Safari 系'], 1); assert.equal(plat['Android'], 1);
  assert.equal(plat['(未知)'], 1);
});
T('★★[口徑] _casualUaShort 與 dump 的 uaShort 對同一批 UA 給相同答案', () => {
  const h = srvHarness(null);
  const uas = ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'Mozilla/5.0 (Linux; Android 14)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
    'Mozilla/5.0 (X11; Linux x86_64)', '', null, 'SomethingElse/1.0'];
  // dump 的 uaShort 沒有匯出 ⇒ 從原始碼抽出來跑（兩邊跑的是各自的出貨碼）
  const dumpUa = new Function(fnSrc(DUMPSRC, 'function uaShort(ua) {') + '\nreturn uaShort;')();
  for (const u of uas) assert.equal(h._casualUaShort(u), dumpUa(u), 'UA 判準漂移：' + u);
});
await TA('★★[韌性] 空資料／全壞掉的 payload 都不炸，而且 0 筆時 casualApi 仍在（＝分得出舊伺服器）', async () => {
  const h = srvHarness(null);
  const empty = await h._buildCasualDiagReport(fakeColl([]), NOW - 3600000, 24);
  assert.equal(empty.rows, 0); assert.equal(empty.players, 0);
  assert.equal(empty.casualApi, 1, '0 筆時哨兵不見了 ⇒ 畫面會把「沒有回報」誤報成「伺服器舊版」');
  assert.equal(empty.push.p50med, null, '沒有樣本時中位數不是 null');
  const junk = await h._buildCasualDiagReport(fakeColl([
    { ts: NOW, uid: 'z', reason: 'casual-slow-push', mode: 'casual', diag: 'not json at all' },
    { ts: NOW, mode: 'casual', reason: '', diag: '' },
  ]), NOW - 3600000, 24);
  assert.equal(junk.rows, 2); assert.equal(junk.truncated, 2);
  assert.equal(junk.byReason.find((r) => r.reason === '(未標)').n, 1, '空 reason 沒有正規化成 (未標)');
});
await TA('★★★[上限] 硬上限：超過 CAP 就只算最近那批，而且 capped 要如實回報（不可靜默截斷）', async () => {
  const h = srvHarness(null);
  const many = [];
  for (let i = 0; i < h.CAP + 500; i++) many.push(mkRow({ uid: 'u' + (i % 50), reason: 'casual-slow-push', ts: NOW - i }));
  const rep = await h._buildCasualDiagReport(fakeColl(many), NOW - 86400000, 24);
  assert.equal(rep.scanned, h.CAP, '掃了 ' + rep.scanned + ' 筆（上限 ' + h.CAP + '）');
  assert.equal(rep.capped, true, 'capped 沒有如實回報 ⇒ 統計失真而沒人知道');
  assert.equal(rep.scanCap, h.CAP);
  // 正對照：沒超過上限時 capped 必須是 false（證明上面不是恆真）
  const few = await h._buildCasualDiagReport(fakeColl(FIX), NOW - 3600000, 24);
  assert.equal(few.capped, false, '正對照失敗：7 筆也被標成 capped');
});
await TA('★★[明細] 明細有筆數上限（診斷資料會累積），但統計仍算整個掃描範圍', async () => {
  const h = srvHarness(null);
  const many = [];
  for (let i = 0; i < 400; i++) many.push(mkRow({ uid: 'u' + i, reason: 'casual-slow-push', ts: NOW - i }));
  const rep = await h._buildCasualDiagReport(fakeColl(many), NOW - 86400000, 24);
  assert.equal(rep.list.length, 120, '明細 ' + rep.list.length + ' 筆');
  assert.equal(rep.rows, 400, '統計被明細上限截斷了（' + rep.rows + '）⇒ 數字失真');
  assert.equal(rep.players, 400);
});

// ══════════════════════════════════════════════════════════════════════════
// ③ ⭐⭐ 事件迴圈：絕不可拖累錦標賽（pm2 fork_mode 單 instance）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ 事件迴圈實測（Rule 32：效能數字必附量測腳本 —— 就是這一段）');
/** 跑掃描的同時用 setImmediate ticker 量「事件迴圈拿回控制權」的次數與間隔。 */
async function measure(h, rows) {
  let ticks = 0, last = process.hrtime.bigint();
  const gaps = [];
  let running = true;
  const tick = () => {
    if (!running) return;
    const now = process.hrtime.bigint();
    gaps.push(Number(now - last) / 1e6); last = now; ticks++;
    setImmediate(tick);
  };
  setImmediate(tick);
  await new Promise((r) => setImmediate(r));   // 先讓 ticker 起跑
  ticks = 0; gaps.length = 0; last = process.hrtime.bigint();
  const t0 = process.hrtime.bigint();
  const rep = await h._buildCasualDiagReport(fakeColl(rows), NOW - 86400000, 24);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  running = false;
  gaps.sort((a, b) => a - b);
  const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0);
  return { rep, ticks, ms, max: gaps.length ? gaps[gaps.length - 1] : ms, p99: q(0.99), p50: q(0.5) };
}
const BENCH_ROWS = [];
for (let i = 0; i < 5000; i++) BENCH_ROWS.push(mkRow({ uid: 'u' + (i % 200), reason: 'casual-slow-push', ts: NOW - i }));
let M_YIELD = null;
await TA('★★★[事件迴圈] 有讓路：5000 筆掃描期間事件迴圈至少拿回控制權 CAP/200 次', async () => {
  const h = srvHarness(null);
  M_YIELD = await measure(h, BENCH_ROWS);
  console.log('     實測（沙盒，正式 VM 約快 10 倍）：總耗時 ' + M_YIELD.ms.toFixed(1) + ' ms、'
    + '讓路 ' + M_YIELD.ticks + ' 次、阻塞 p50 ' + M_YIELD.p50.toFixed(2) + ' ms / p99 '
    + M_YIELD.p99.toFixed(2) + ' ms / max ' + M_YIELD.max.toFixed(2) + ' ms');
  const expect = Math.floor(5000 / h.EVERY);
  assert.ok(M_YIELD.ticks >= expect - 2, '只讓路了 ' + M_YIELD.ticks + ' 次（預期 ≥ ' + (expect - 2) + '）');
  assert.ok(M_YIELD.p99 < 60, '阻塞 p99 ' + M_YIELD.p99.toFixed(2) + ' ms 太久（沙盒門檻 60ms）');
});
T('★★★[事件迴圈／自我驗證] 量測器不是恆真：ticks 與 p99 都真的量到東西', () => {
  assert.ok(M_YIELD, '沒有量測結果');
  assert.ok(M_YIELD.ticks > 5, 'ticker 只跑了 ' + M_YIELD.ticks + ' 次 ⇒ 量測器本身壞了');
  assert.ok(M_YIELD.ms > 0.5, '掃描快到量不出來（' + M_YIELD.ms + ' ms）⇒ 上面的門檻是恆真式');
});

// ══════════════════════════════════════════════════════════════════════════
// ④ ⭐⭐ 錦標賽區塊：內嵌 sha256 逐位元未動
// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 錦標賽區塊逐位元未動（內嵌 sha256，淺複製下也在守）');
const TOURN_REGION_SHA256 = '14011f938d8484843c07087c1c632bcb9f1bede15ca6c5add0f839827c50d2ec';
function tournRegion(src) {
  const i = src.indexOf("app.get('/api/tournament/admin/clientdiag'");
  if (i < 0) throw new assert.AssertionError({ message: '找不到 clientdiag 端點' });
  const a = src.indexOf('        if (req.query.reason) q.reason = String(req.query.reason);', i);
  if (a < 0) throw new assert.AssertionError({ message: '找不到錦標賽區塊的起點' });
  const b = src.indexOf('\n      } catch (e) { res.status(500).json({ error: e.message }); }\n    });', a);
  if (b < 0) throw new assert.AssertionError({ message: '找不到錦標賽區塊的終點' });
  return src.slice(a, b);
}
T('★★★[核心] 錦標賽的 byReason／slowRtt／sample／rows 那一整段 sha256 與 v6.268 相同', () => {
  const cur = tournRegion(SRV);
  assert.ok(cur.length > 4000, '抽到的區塊只有 ' + cur.length + ' 字元 ⇒ 下面的比對會變成恆真式');
  const sha = createHash('sha256').update(cur, 'utf8').digest('hex');
  let checked = 0;
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
    if (b.ok) { assert.equal(cur, tournRegion(b.out), '與 BASE blob 逐字元比對不符'); checked++; }
  }
  if (!checked) shallowSkip('v6269 ④ 與 BASE blob 逐字元比對', '同一件事由內嵌 sha256 涵蓋，不 fail-open');
  assert.equal(sha, TOURN_REGION_SHA256, 'sha256 不符（' + sha + '）⇒ 錦標賽口徑被動到了');
  checked++;
  console.log('     判準數 ' + checked + '（區塊 ' + cur.length + ' 字元）');
});
T('★★[自我驗證] 上面那條不是恆真：多一個空白 sha256 就不同', () => {
  assert.notEqual(createHash('sha256').update(tournRegion(SRV) + ' ', 'utf8').digest('hex'), TOURN_REGION_SHA256);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ ⭐⭐⭐ admin.html：分頁**真的打得開**（DOM 層，不是字串存在）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ admin 📡 分頁：DOM／行為層（v6.154 的教訓）');
function adminHarness(mutate, mutateLoad) {
  const parts = [
    'const window = { monHours: 24, SITE_VERSION_HINT: "6.269" };',
    fnSrc(ADMIN, 'function escapeHtml(s) {'),
    blockSrc(ADMIN, 'const MON_REASON_INFO = {', '\n};\n'),
    fnSrc(ADMIN, 'function monReasonInfo(reason) {'),
    fnSrc(ADMIN, 'function monMs(v) {'),
    fnSrc(ADMIN, 'function monStat(st, key) {'),
    fnSrc(ADMIN, 'function monPerfCells(r) {'),
    fnSrc(ADMIN, 'function monStaleBadge(r) {'),
    fnSrc(ADMIN, 'function monSampleBlock(dg) {'),
    fnSrc(ADMIN, 'function monCasualBlock(cg) {'),
    fnSrc(ADMIN, 'window.verLE = function (a, b) {') + ';',
    'const verLE = window.verLE;',
  ].join('\n');
  const body = mutate ? mutate(parts) : parts;
  const src = [
    'const __el = { innerHTML: "" }; const __asked = [];',
    'const document = { getElementById: (id) => { __asked.push(id); return id === "tab-monitor" ? __el : null; } };',
    'let __resp = {};',
    'async function api(u) { const k = Object.keys(__resp).find((x) => u.includes(x)); return k ? __resp[k] : { error: "404" }; }',
    body,
    (mutateLoad ? mutateLoad(fnSrc(ADMIN, 'async function loadMonitor() {')) : fnSrc(ADMIN, 'async function loadMonitor() {')),
    'return { loadMonitor, monCasualBlock, html: () => __el.innerHTML, asked: () => __asked.slice(),',
    '  setResp: (r) => { __resp = r; } };',
  ].join('\n');
  return new Function(src)();
}
// admin 端拿到的休閒 payload（＝伺服器 _buildCasualDiagReport 的實際輸出，不是手寫假資料）
const CG = REPORT;
const DG = { hours: 24, byReason: [{ reason: 'slow-rtt', n: 12, players: 4 }], slowRtt: [], rows: [], sample: { reasons: ['perf-sample'], n: 3, players: 2, perf: [] } };

T('[前提] admin.html 抽得出 monCasualBlock 與 loadMonitor（BASE 上必紅：那時候沒有 monCasualBlock）', () => {
  const h = adminHarness(null);
  assert.equal(typeof h.monCasualBlock, 'function');
  assert.equal(typeof h.loadMonitor, 'function');
});
await TA('★★★[DOM] 分頁真的打得開：loadMonitor 寫進 #tab-monitor，而且裡面有 #mon-casual 且**被填入**', async () => {
  const h = adminHarness(null);
  h.setResp({ 'clientdiag?mode=casual': CG, 'clientdiag?hours': DG, longpoll: { config: {} }, redact: { enabled: false } });
  await h.loadMonitor();
  assert.ok(h.asked().includes('tab-monitor'), 'loadMonitor 沒有去抓 #tab-monitor（抓的是 ' + h.asked() + '）');
  assert.ok(ADMIN.includes('<div id="tab-monitor" class="tab-content"'), 'admin.html 裡根本沒有 #tab-monitor 這個容器');
  const $ = cheerio.load(h.html());
  assert.equal($('#mon-casual').length, 1, '渲染結果裡沒有 #mon-casual 容器（＝子表沒有接上）');
  assert.equal($('#mon-casual-body').length, 1, '#mon-casual 裡沒有內容容器 #mon-casual-body');
  const bodyTxt = $('#mon-casual-body').text();
  assert.ok(bodyTxt.length > 200, '#mon-casual-body 是空的（' + bodyTxt.length + ' 字）⇒ 容器有了但沒被填入');
  assert.ok(/合計\s*7 筆 \/ 6 人/.test(bodyTxt), '子表沒有畫出合計：' + bodyTxt.slice(0, 120));
  assert.ok(bodyTxt.includes('7.2 秒'), 'p95 最差（7200ms）沒有畫出來：' + bodyTxt.slice(0, 200));
  assert.ok(/伺服器擋下\s*1\s*次/.test(bodyTxt.replace(/\s+/g, ' ')), '棄權宣告的 rejected 沒有畫出來');
  assert.ok($('#mon-casual table').length >= 1, '指紋次數表沒有畫出來');
});
await TA('★★★[DOM／不可消失] 錦標賽讀不到／沒有異常時，🎮 休閒子表**照畫**（最容易再犯的同型錯誤）', async () => {
  for (const [why, resp] of [
    ['錦標賽端點 403/舊版', { 'clientdiag?mode=casual': CG }],
    ['錦標賽 0 異常', { 'clientdiag?mode=casual': CG, 'clientdiag?hours': { hours: 24, byReason: [], rows: [] } }],
  ]) {
    const h = adminHarness(null);
    h.setResp(resp);
    await h.loadMonitor();
    const $ = cheerio.load(h.html());
    assert.equal($('#mon-casual').length, 1, why + ' 時休閒子表整塊不見了');
    assert.ok($('#mon-casual-body').text().includes('合計'), why + ' 時休閒子表是空的');
  }
});
await TA('★★★[DOM] 休閒子表是 🩺 那一框的**兄弟**，不是巢狀在裡面（巢狀＝錦標賽那框收合就一起不見）', async () => {
  const h = adminHarness(null);
  h.setResp({ 'clientdiag?mode=casual': CG, 'clientdiag?hours': DG });
  await h.loadMonitor();
  const $ = cheerio.load(h.html());
  const el = $('#mon-casual');
  assert.equal(el.length, 1);
  assert.equal(el.parents('#mon-casual').length, 0);
  // 🩺 那一框以 h3「🩺 玩家端回報的異常」為記號；休閒不可以在它的子樹裡
  const anomalyBox = $('h3').filter((i, e) => $(e).text().includes('玩家端回報的異常')).parent();
  assert.equal(anomalyBox.length, 1, '找不到 🩺 那一框 ⇒ 這條斷言失效');
  assert.equal(anomalyBox.find('#mon-casual').length, 0, '休閒子表被巢狀進 🩺 那一框裡了');
});
await TA('★★★[誠實] 舊伺服器（沒有 casualApi 哨兵）要明講「伺服器還是舊版」，不可以顯示成 0 筆', async () => {
  const h = adminHarness(null);
  const $old = cheerio.load(h.monCasualBlock(null));
  assert.equal($old('#mon-casual-body').length, 1, '舊伺服器路徑沒有畫出容器');
  assert.ok($old('#mon-casual-body').text().includes('伺服器還是舊版'), '舊伺服器沒有明講');
  assert.ok(!$old('#mon-casual-body').text().includes('合計 0 筆'), '把舊伺服器顯示成「0 筆」⇒ 站長會以為休閒都很順');
  // 正對照：真的 0 筆時要顯示「沒有任何休閒回報」＋三種可能，而不是「伺服器還是舊版」
  const zero = { casualApi: 1, rows: 0, players: 0, truncated: 0, byReason: [], byVersion: [], byPlatform: [],
    push: { rowsWithPush: 0 }, forfeitClaim: { total: 0 }, list: [] };
  const $z = cheerio.load(h.monCasualBlock(zero));
  const t = $z('#mon-casual-body').text();
  assert.ok(!t.includes('伺服器還是舊版'), '正對照失敗：真的 0 筆卻說伺服器舊版');
  assert.ok(t.includes('休閒都很順'), '0 筆時沒有講清楚「這不是休閒都很順」：' + t.slice(0, 160));
});
await TA('★★[韌性] 缺欄位的 payload 不可以讓整個分頁炸掉（舊列／截斷列一定會出現）', async () => {
  const h = adminHarness(null);
  for (const bad of [{ casualApi: 1 }, { casualApi: 1, rows: 3, byReason: null, push: null, forfeitClaim: null, list: null },
    { casualApi: 1, rows: 1, byReason: [{ reason: 'constructor', n: 1 }], list: [{ ts: NOW, reason: 'constructor' }], push: {}, forfeitClaim: {} }]) {
    const out = h.monCasualBlock(bad);
    assert.equal(typeof out, 'string');
    assert.ok(cheerio.load(out)('#mon-casual-body').length === 1, '缺欄位時容器不見了：' + JSON.stringify(bad).slice(0, 60));
  }
});
T('★★★[判讀紀律] 四條警語**印在畫面上**（不是只寫在註解裡）', () => {
  const h = adminHarness(null);
  const txt = cheerio.load(h.monCasualBlock(CG))('#mon-casual').text().replace(/\s+/g, '');
  for (const [what, re] of [
    ['母體不同、不可相加', /絕不可以跟上面錦標賽的任何數字相加或互相比較/],
    ['母體只含已登入 email', /只有已登入email帳號的休閒玩家會送/],
    ['倖存者偏差', /上行完全爆掉的人在這裡看不見/],
    ['棄權是頻率下界', /頻率下界，?不是上界/],
  ]) assert.ok(re.test(txt), '畫面上沒有「' + what + '」這條警語');
  // 這幾條必須在**警語區**（cg 為何都要有），不是只在有資料時才出現
  const txtOld = cheerio.load(h.monCasualBlock(null))('#mon-casual').text().replace(/\s+/g, '');
  assert.ok(/絕不可以跟上面錦標賽的任何數字相加或互相比較/.test(txtOld), '伺服器舊版時警語整塊不見');
});
T('★★[接線] loadMonitor 真的多打了一發 ?mode=casual，而且用 _ok() 判舊伺服器（不是 .catch 死碼）', () => {
  const seg = fnSrc(ADMIN, 'async function loadMonitor() {');
  assert.ok(seg.includes("api('/api/tournament/admin/clientdiag?mode=casual&hours=' + window.monHours)"),
    'loadMonitor 沒有打 ?mode=casual（BASE 上必紅）');
  assert.ok(/const lp = _ok\(_r\[0\]\)[^\n]*cg = _ok\(_r\[5\]\)/.test(seg), 'cg 沒有經過 _ok() 包裝');
  assert.ok(seg.includes('html += monCasualBlock(cg);'), 'monCasualBlock 定義了卻沒有被呼叫＝白寫');
});
T('★[版本提示] admin.html 的 SITE_VERSION_HINT 與 version.ts 一致（**不寫死版本號**，每一版都在守）', () => {
  const mv = /export const VERSION = '([\d.]+)';/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'));
  const ma = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(ADMIN);
  assert.ok(mv && ma, '讀不到版本字串');
  assert.strictEqual(ma[1], mv[1], 'admin.html hint 沒跟著 version.ts 同步');
});
T('★[原型鏈] 指紋說明查表仍走 hasOwnProperty（reason 可能是 constructor / __proto__）', () => {
  assert.ok(ADMIN.includes('Object.prototype.hasOwnProperty.call(MON_REASON_INFO, reason)'), '查表沒有防原型鏈');
});
T('★[誠實] MON_REASON_INFO 開頭那段「休閒不會出現在本分頁」的註解已經更新（本版起會出現）', () => {
  assert.ok(!ADMIN.includes('這三則**預設不會出現在本分頁**'), '註解還在說謊（本版起休閒有自己的區塊）');
  assert.ok(ADMIN.includes('v6.269 起休閒批有**自己的**區塊'), '註解沒有指向新區塊');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ dump：彙總段的三分流（行為端）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ dump 彙總段三分流（實跑）');
const AGG_FIX = [
  { _id: 'slow-rtt', n: 12, uids: ['u1', 'u2'] },
  { _id: 'stale-version', n: 43, uids: ['u3'] },
  { _id: 'perf-sample', n: 88, uids: ['u4', 'u5'] },
  { _id: 'casual-slow-push', n: 50, uids: ['c1', 'c2'] },
  { _id: 'casual-forfeit-claim', n: 39, uids: ['c3'] },
  { _id: 'casual-perf-sample', n: 122, uids: ['c4'] },
  { _id: 'casual-phantom-adopt', n: 1, uids: ['c5'] },
  { _id: null, n: 2, uids: ['u6'] },
];
T('★★★[核心] splitAggRows 實跑：休閒的每一則都不可以落進錦標賽的異常批或健康對照組', () => {
  assert.equal(typeof DUMP.splitAggRows, 'function', 'dump 沒有匯出 splitAggRows（BASE 上必紅）');
  const sp = DUMP.splitAggRows(AGG_FIX);
  assert.deepEqual(sp.anomaly.map((a) => a._id), ['slow-rtt', 'stale-version', null]);
  assert.deepEqual(sp.sample.map((a) => a._id), ['perf-sample']);
  assert.deepEqual(sp.casual.map((a) => a._id).sort(),
    ['casual-forfeit-claim', 'casual-perf-sample', 'casual-phantom-adopt', 'casual-slow-push']);
  // 互斥且窮盡
  assert.equal(sp.anomaly.length + sp.sample.length + sp.casual.length, AGG_FIX.length, '有列被吃掉或重複');
  assert.ok(sp.anomaly.every((a) => !DUMP.isCasualReason(a._id)));
  assert.ok(sp.sample.every((a) => !DUMP.isCasualReason(a._id)));
});
T('★[韌性] splitAggRows 空／null 輸入不炸', () => {
  assert.equal(typeof DUMP.splitAggRows, 'function', 'dump 沒有匯出 splitAggRows（BASE 上必紅）');
  for (const v of [null, undefined, []]) {
    const sp = DUMP.splitAggRows(v);
    assert.equal(sp.anomaly.length + sp.sample.length + sp.casual.length, 0);
  }
});
T('★★★[彙總段接線] main() 的 byReason／sampleAgg 真的走 splitAggRows（抽出來實跑，不是驗字串）', () => {
  const seg = blockSrc(DUMPSRC, '  const _aggSplit = splitAggRows(agg);', 'const sampleAgg = _aggSplit.sample.map(_aggFmt);');
  const run = new Function('agg', 'splitAggRows', 'reasonLabel',
    seg + '\nreturn { byReason: byReason, sampleAgg: sampleAgg };');
  const out = run(AGG_FIX, DUMP.splitAggRows, DUMP.reasonLabel);
  const names = out.byReason.map((r) => r.reason);
  for (const bad of ['casual-slow-push', 'casual-forfeit-claim', 'casual-perf-sample', 'casual-phantom-adopt']) {
    assert.ok(!names.includes(bad), '【② 錦標賽異常】仍然列了 ' + bad + ' ⇒ 重複計算沒修掉');
  }
  assert.deepEqual(names, ['stale-version', 'slow-rtt', '(未標)'], '錦標賽那幾則的內容或排序被改掉了：' + names);
  assert.deepEqual(out.sampleAgg.map((r) => r.reason), ['perf-sample'], '健康對照組被休閒污染');
});
T('★★★[口徑不變／變化量] 錦標賽那幾則的 n 與 players **逐項不變**，只有休閒那幾則消失', () => {
  const seg = blockSrc(DUMPSRC, '  const _aggSplit = splitAggRows(agg);', 'const sampleAgg = _aggSplit.sample.map(_aggFmt);');
  const cur = new Function('agg', 'splitAggRows', 'reasonLabel', seg + '\nreturn byReason;')(
    AGG_FIX, DUMP.splitAggRows, DUMP.reasonLabel);
  // v6.261~v6.268 的舊寫法（重建，用來算變化量）
  const old = AGG_FIX.filter((a) => !DUMP.isSampleReason(a._id))
    .map((a) => ({ reason: a._id || '(未標)', n: a.n, players: (a.uids || []).length }))
    .sort((x, y) => y.n - x.n);
  const oldMap = Object.fromEntries(old.map((r) => [r.reason, r]));
  for (const r of cur) {
    assert.ok(oldMap[r.reason], '出現了舊版沒有的指紋：' + r.reason);
    assert.equal(r.n, oldMap[r.reason].n, r.reason + ' 的次數變了');
    assert.equal(r.players, oldMap[r.reason].players, r.reason + ' 的人數變了');
  }
  const gone = old.filter((r) => !cur.some((c) => c.reason === r.reason));
  assert.deepEqual(gone.map((r) => r.reason).sort(),
    ['casual-forfeit-claim', 'casual-phantom-adopt', 'casual-slow-push'],
    '消失的不是（也不只是）休閒那三則：' + JSON.stringify(gone.map((r) => r.reason)));
  const delta = gone.reduce((s, r) => s + r.n, 0);
  assert.equal(delta, 90, '重複計算的變化量應為 50+39+1=90，實得 ' + delta);
  console.log('     【②】的變化量：-' + gone.length + ' 列 / -' + delta + ' 次（本 fixture 依 2026-08-30 dump 的實際數字）');
});
T('★★[對帳] dump 摘要有「逐列相加 ≠ 合計」的自我對帳（下次再犯立刻看得見）', () => {
  const strip = DUMPSRC.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/const _sumN = byReason\.reduce\(/.test(strip), '摘要沒有對帳');
  assert.ok(/if \(_sumN !== rows\.length\)/.test(strip), '對帳沒有比對合計');
});
T('★★[既有三分流不可退化] splitDiagRows（明細那一路）仍然正確', () => {
  const sp = DUMP.splitDiagRows([
    { reason: 'slow-rtt' }, { reason: 'perf-sample' }, { reason: 'casual-perf-sample' },
    { reason: 'casual-slow-push' }, { reason: '' },
  ]);
  assert.equal(sp.anomaly.length, 2);
  assert.equal(sp.sample.length, 1);
  assert.equal(sp.casual.length, 2);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑦ 玩家端零改動
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ 玩家端零改動');
T('★★★[零改動] 本版沒有把任何新符號洩漏進玩家端（src/ 與 static/ 都不該認識這些名字）', () => {
  const names = ['monCasualBlock', '_buildCasualDiagReport', 'splitAggRows', 'CASUAL_DIAG_SCAN_CAP', 'casualApi'];
  const hits = [];
  for (const n of names) {
    try {
      const out = execFileSync('grep', ['-rl', '--include=*', n, join(ROOT, 'src'), join(ROOT, 'static')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (out.trim()) hits.push(n + ' → ' + out.trim().split('\n').join(','));
    } catch { /* grep 無命中 exit 1 */ }
  }
  assert.deepEqual(hits, [], '玩家端出現了本版的新符號：' + hits.join(' | '));
});
T('★★[零改動／不需歷史] 玩家端的建置根本碰不到 oracle-admin/（改 admin 不可能改到玩家的 bundle）', () => {
  // ⚠ 上一條要歷史 blob，淺複製下會 SHALLOW-SKIP ⇒ 這一條是**不需要歷史**的備援判準。
  let hits = '';
  try {
    hits = execFileSync('grep', ['-rl', 'oracle-admin', join(ROOT, 'src'), join(ROOT, 'static')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* 無命中 */ }
  assert.equal(hits, '', '玩家端引用了 oracle-admin：' + hits);
  // 正對照：掃描器真的掃得到東西（否則上面是恆真式）
  let ctl = '';
  try {
    ctl = execFileSync('grep', ['-rl', 'VERSION', join(ROOT, 'src/lib')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* */ }
  assert.ok(ctl.length > 0, '掃描器連 VERSION 都掃不到 ⇒ 上面那條是恆真式');
});
T('★★★[零改動／逐位元] src/ 與 static/ 底下**只有 version.ts** 與 v6.268 不同', () => {
  // ⚠ 這一條只在**本版當下**有意義（下一版一定會動 src/）⇒ 版本一往前走就停用，
  //   否則它會從 v6.270 起永遠紅、逼下一棒去刪守衛（那才是真正的災難）。
  //   ⭐ 停用是明講的，不是靜默 return —— 而且 ⑦a/⑦b 兩條durable 判準永遠在守。
  const VER = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'));
  assert.ok(VER, '讀不到 version.ts');
  if (VER[1] !== '6.269') {
    console.log('     （本條只在 v6.269 當下有效，現在是 v' + VER[1] + ' ⇒ 停用；⑦a/⑦b 仍在守）');
    return;
  }
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('v6269 ⑦ src/static 逐檔 blob 比對', '同一件事由上一條的符號掃描部分涵蓋（但那條較弱）');
    return;
  }
  const listed = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', BASE_SHA, '--', 'src', 'static'],
    { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n');
  assert.ok(listed.length > 500, 'BASE 只列出 ' + listed.length + ' 個檔 ⇒ 掃描器壞了');
  const diff = [];
  for (const line of listed) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!m) continue;
    let cur;
    try {
      cur = execFileSync('git', ['-C', ROOT, 'hash-object', '--', m[2]], { encoding: 'utf8' }).trim();
    } catch { diff.push(m[2] + '(讀不到)'); continue; }
    if (cur !== m[1]) diff.push(m[2]);
  }
  assert.deepEqual(diff, ['src/lib/version.ts'], '玩家端有非預期的改動：' + diff.join(', '));
});

// ══════════════════════════════════════════════════════════════════════════
// ⑧ 突變測試（每一個都必須紅在**預期那一條**）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ 突變測試（沒紅就先假設守衛沒測到）');
async function mutant(name, run) {
  let red = false, why = '';
  try { await run(); }
  catch (e) { if (e instanceof assert.AssertionError) { red = true; why = e.message; } else throw e; }
  if (red) { pass++; console.log('  PASS [突變] ' + name + ' ⇒ 紅（' + why.slice(0, 80) + '）'); }
  else { fail++; console.log('  FAIL [突變] ' + name + ' ⇒ **沒紅**（守衛沒測到這件事）'); }
}
await mutant('M1 拿掉每 200 筆的讓路 ⇒ 事件迴圈整批被擋住', async () => {
  const h = srvHarness((s) => s.replace('const _y = adminScanYield(scanned); if (_y) await _y;', ''));
  const m = await measure(h, BENCH_ROWS);
  console.log('     （突變體實測：讓路 ' + m.ticks + ' 次、max 阻塞 ' + m.max.toFixed(1) + ' ms）');
  assert.ok(m.ticks >= Math.floor(5000 / h.EVERY) - 2, '只讓路了 ' + m.ticks + ' 次');
});
await mutant('M2 把讓路改成 await null（microtask，對 I/O 完全沒幫助）', async () => {
  const h = srvHarness((s) => s.replace('const _y = adminScanYield(scanned); if (_y) await _y;', 'await null;'));
  const m = await measure(h, BENCH_ROWS);
  assert.ok(m.ticks >= Math.floor(5000 / h.EVERY) - 2, '只讓路了 ' + m.ticks + ' 次');
});
await mutant('M3 拿掉硬上限 .limit(CAP) ⇒ 資料量爆掉時會整批掃', async () => {
  const h = srvHarness((s) => s.replace('.limit(CASUAL_DIAG_SCAN_CAP)', ''));
  const many = [];
  for (let i = 0; i < h.CAP + 500; i++) many.push(mkRow({ uid: 'u' + (i % 50), reason: 'casual-slow-push', ts: NOW - i }));
  const rep = await h._buildCasualDiagReport(fakeColl(many), NOW - 86400000, 24);
  assert.equal(rep.scanned, h.CAP, '掃了 ' + rep.scanned + ' 筆（上限 ' + h.CAP + '）');
});
await mutant('M4 把失敗的推送也算進 p95（分佈會被逾時灌爆）', async () => {
  const h = srvHarness((s) => s.replace(
    'if (typeof ph.fail === \'number\' && isFinite(ph.fail)) out.push.fail += ph.fail;',
    'if (typeof ph.fail === \'number\' && isFinite(ph.fail)) { out.push.fail += ph.fail; for (let i = 0; i < ph.fail; i++) p95s.push(120000); }'));
  const rep = await h._buildCasualDiagReport(fakeColl(FIX), NOW - 3600000, 24);
  assert.equal(rep.push.p95max, 7200, 'p95 最差 ' + rep.push.p95max);
});
await mutant('M5 用「rows===0」當舊伺服器判準（會把「真的沒有回報」講成「伺服器沒部署」）', async () => {
  const h = adminHarness((s) => s.replace(
    "if (!cg || typeof cg.casualApi !== 'number') {", 'if (!cg || !cg.rows) {'));
  const zero = { casualApi: 1, rows: 0, players: 0, truncated: 0, byReason: [], byVersion: [], byPlatform: [],
    push: { rowsWithPush: 0 }, forfeitClaim: { total: 0 }, list: [] };
  const t = cheerio.load(h.monCasualBlock(zero))('#mon-casual-body').text();
  assert.ok(!t.includes('伺服器還是舊版'), '真的 0 筆卻說伺服器舊版');
});
await mutant('M6 把休閒子表搬進「錦標賽有異常」那個分支（沒異常的那幾天會整塊消失）', async () => {
  // ⭐ 真突變：把無條件的 `html += monCasualBlock(cg);` 搬進 else 分支的尾端。
  const h = adminHarness(null, (src) => {
    const call = "  html += monCasualBlock(cg);\n";
    assert.ok(src.includes(call), '突變體找不到 monCasualBlock 的呼叫 ⇒ 這條突變測試本身失效');
    const inBranch = "    html += '</div></details>';\n  }";
    assert.ok(src.includes(inBranch), '突變體找不到 else 分支的尾端');
    return src.replace(call, '').replace(inBranch, "    html += '</div></details>';\n    html += monCasualBlock(cg);\n  }");
  });
  h.setResp({ 'clientdiag?mode=casual': CG, 'clientdiag?hours': { hours: 24, byReason: [], rows: [] } });
  await h.loadMonitor();
  assert.equal(cheerio.load(h.html())('#mon-casual').length, 1, '錦標賽 0 異常時休閒子表整塊不見了');
});
await mutant('M9 拿掉 app.locals 取不到時的 fail-closed（會退成沒有讓路節拍的掃描）', async () => {
  const seg = SRV.slice(SRV.indexOf("app.get('/api/tournament/admin/clientdiag'"), SRV.indexOf("app.get('/api/tournament/admin/clientdiag'") + 7600);
  const mutated = seg.replace(/\n\s*if \(typeof _cb !== 'function'\) return res\.status\(503\)[^\n]*/, '');
  assert.notEqual(mutated, seg, '突變沒有套用 ⇒ 這條突變測試本身失效');
  assert.ok(/if \(typeof _cb !== 'function'\) return res\.status\(503\)/.test(mutated),
    '取不到 helper 時沒有 fail-closed');
});
await mutant('M7 彙總段回退成 v6.261 的舊寫法（只濾 isSampleReason）⇒ 重複計算回來', async () => {
  const run = new Function('agg', 'isSampleReason', 'reasonLabel', `
    const byReason = agg.filter(function (a) { return !isSampleReason(a._id); })
      .map(function (a) { return { reason: a._id || '(未標)', n: a.n }; });
    return byReason;`);
  const names = run(AGG_FIX, DUMP.isSampleReason, DUMP.reasonLabel).map((r) => r.reason);
  for (const bad of ['casual-slow-push', 'casual-forfeit-claim']) {
    assert.ok(!names.includes(bad), '【② 錦標賽異常】仍然列了 ' + bad);
  }
});
await mutant('M8 錦標賽區塊被動一個字元 ⇒ sha256 必須翻紅', async () => {
  const mutated = SRV.replace('        const rows = await TCDIAG.find(q).sort({ ts: -1 }).limit(120).toArray();',
    '        const rows = await TCDIAG.find(q).sort({ ts: -1 }).limit(121).toArray();');
  assert.notEqual(mutated, SRV, '突變沒有套用 ⇒ 這條突變測試本身失效');
  const sha = createHash('sha256').update(tournRegion(mutated), 'utf8').digest('hex');
  assert.equal(sha, TOURN_REGION_SHA256, 'sha256 不符（' + sha + '）');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑨ test chain
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ test chain');
T('★[test chain] 本守衛在 package.json 的 test 裡（只加進 iron-rules-audit 等於沒加）', () => {
  assert.ok(PKG.scripts.test.includes('test-v6269-casual-monitor-tab.mjs'), '守衛沒進 test chain');
});

console.log('\n── v6.269 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ──');
process.exit(fail ? 1 : 0);
