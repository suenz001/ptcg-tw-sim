// v6.224 守衛：/api/decode-tw-deck/:code 官網 fetch 逾時保護
//
// 背景（nginx 計時 log 2026-08-23）：一筆 11.974 秒才回 200 的請求，全部耗在 node
//   等待官網外部 I/O。Node 的 fetch 預設沒有時間上限 → 官網掛住時玩家無限期乾等。
// 本守衛把 server_admin_patch.js 的 registerTwDeckImport IIFE 抽出來，在 node:vm
//   沙盒內【實際執行】handler：
//   A. 行為級逾時驗證 — fetch 替身真的掛住（只有收到 abort 才 reject），觸發逾時
//      timer 後 handler 必須回 504 與玩家看得懂的訊息（不是 AbortError 原文）。
//      ⚠ HEAD-FAIL：BASE 版沒傳 signal 也沒 timer → fetch 永遠 pending → handler
//      永不回應 → 紅（行為級，不是「字串不存在」）。
//   B. 成功路徑逐字不變 — 同一份輸入在【BASE 版】與【現行版】各跑一次，
//      200/400/404/422/429/500/快取命中 的回應 deep-equal。
//   C. 限流方向 — 第 6 次請求回 429 且 fetch 替身只被叫 5 次（限流在昂貴 fetch 之前）。
//   D. 前端（src/routes/decks/+page.svelte）— fetch 帶 signal、前端逾時 > 後端逾時、
//      AbortError 有玩家看得懂的訊息（行為端測不到 Svelte 元件，這部分靜態斷言）。
//
// 突變測試（外部以 V6224_SAP / V6224_DECKS 指向突變檔重跑）：
//   M1 拿掉 signal 傳遞、M2 拿掉 AbortError 特判、M3 拿掉 clearTimeout、
//   M4 逾時改 10 秒（會把實測 12 秒的慢成功切成失敗）、M5 前端逾時 <= 後端 → 都必須紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import assert from 'node:assert';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAP_PATH = process.env.V6224_SAP || join(ROOT, 'oracle-admin/server_admin_patch.js');
const DECKS_PATH = process.env.V6224_DECKS || join(ROOT, 'src/routes/decks/+page.svelte');
// BASE 對照版（成功路徑逐字不變的基準）— v6.223 的 sha
const BASE_SHA = 'a7dbc1549a63be48bfd80251c380c43658b921c4';

let pass = 0, fail = 0;
const T = async (n, f) => { try { await f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 抽出 registerTwDeckImport IIFE（錨點式，不做通用括號配對）──
function extractIife(src) {
  const start = src.indexOf('(function registerTwDeckImport()');
  assert.ok(start >= 0, '找不到 registerTwDeckImport IIFE 起點');
  const anchor = src.indexOf("endpoint /api/decode-tw-deck/:code registered", start);
  assert.ok(anchor > start, '找不到 IIFE 尾端錨點');
  const end = src.indexOf('})();', anchor);
  assert.ok(end > anchor, '找不到 IIFE 收尾 })();');
  const iife = src.slice(start, end + '})();'.length);
  // 掃描器下限斷言（Rule 25）：抽出的不該是空殼
  assert.ok(iife.length > 3000, 'IIFE 只有 ' + iife.length + ' chars，抽取器壞了？');
  assert.ok(iife.includes("app.get('/api/decode-tw-deck/:code'"), 'IIFE 內沒有路由註冊');
  return iife;
}

// ── 沙盒：實際執行 IIFE，拿到 handler ──
function buildSandbox(iife) {
  const routes = {};
  const timers = [];            // { id, fn, ms }
  const cleared = [];
  let timerSeq = 0;
  const box = {
    fetchCalls: [],
    fetchImpl: null,            // 由測試情境注入
  };
  const sandbox = {
    app: { get(p, fn) { routes[p] = fn; } },
    fetch: (...a) => { box.fetchCalls.push(a); return box.fetchImpl(...a); },
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { cleared.push(id); },
    AbortController,
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(iife, sandbox, { filename: 'registerTwDeckImport.vm.js' });
  const handler = routes['/api/decode-tw-deck/:code'];
  assert.ok(typeof handler === 'function', '路由 handler 沒被註冊');
  return { handler, timers, cleared, box };
}

function makeReq(code, ip) {
  return { params: { code }, headers: { 'x-forwarded-for': ip }, ip };
}
function makeRes() {
  let done; const finished = new Promise(r => { done = r; });
  const res = {
    statusCode: 200,
    status(n) { this.statusCode = n; return this; },
    // ⚠ body 產自 vm realm（prototype 不同會讓 deepStrictEqual 誤判）→ JSON 正規化
    json(obj) { done({ status: this.statusCode, body: obj == null ? obj : JSON.parse(JSON.stringify(obj)) }); return this; },
  };
  return { res, finished };
}
// 呼叫 handler，最多等 realWaitMs 真實毫秒；沒回應就回 null（＝掛住）
async function call(sb, code, ip, realWaitMs = 300) {
  const { res, finished } = makeRes();
  sb.handler(makeReq(code, ip), res);
  return Promise.race([finished, sleep(realWaitMs).then(() => null)]);
}

// ── fetch 替身 ──
const hangFetch = (url, opts) => new Promise((_resolve, reject) => {
  const sig = opts && opts.signal;
  if (!sig) return;             // 沒傳 signal（BASE / 突變 M1）→ 永遠 pending
  const onAbort = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e); };
  if (sig.aborted) onAbort(); else sig.addEventListener('abort', onAbort);
});
const SAMPLE_HTML = [
  '<table><tr><td><a href="/tw/card-search/detail/12345/">皮卡丘ex</a></td><td>M4 002/083</td><td>4</td></tr>',
  '<tr><td><a href="/tw/card-search/detail/67890/">基本雷能量</a></td><td>SVE 004/008</td><td>10</td></tr></table>',
].join('\n');
const okFetch = async () => ({ ok: true, status: 200, text: async () => SAMPLE_HTML });
const notFoundFetch = async () => ({ ok: false, status: 404, text: async () => '' });
const garbageFetch = async () => ({ ok: true, status: 200, text: async () => '<html>維護中</html>' });
const connRefusedFetch = async () => { const e = new Error('connect ECONNREFUSED 1.2.3.4:443'); e.name = 'TypeError'; throw e; };

const C = (i) => 'AAAA' + String(i).padStart(2, '0') + '-BBBBBB-CCCCCC'; // 合法格式（首段恰 6 碼）

// ── 對一份 source 跑「行為快照」（BASE 與現行版共用，供逐字對照）──
async function behaviorSnapshot(iife) {
  const snap = {};
  { const sb = buildSandbox(iife); sb.box.fetchImpl = okFetch;
    snap.ok1 = await call(sb, C(1), '10.0.0.1');
    snap.ok2 = await call(sb, C(1), '10.0.0.1');           // 快取命中
    snap.okFetchCalls = sb.box.fetchCalls.length; }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = okFetch;
    snap.badFormat = await call(sb, 'not-a-code', '10.0.0.2');
    snap.badFormatFetchCalls = sb.box.fetchCalls.length; }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = notFoundFetch;
    snap.http404 = await call(sb, C(2), '10.0.0.3'); }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = garbageFetch;
    snap.parse422 = await call(sb, C(3), '10.0.0.4'); }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = connRefusedFetch;
    snap.err500 = await call(sb, C(4), '10.0.0.5'); }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = okFetch;
    const seq = [];
    for (let i = 10; i < 16; i++) seq.push(await call(sb, C(i), '10.9.9.9'));
    snap.rate6th = seq[5];
    snap.rateFetchCalls = sb.box.fetchCalls.length; }
  return snap;
}

const sapSrc = readFileSync(SAP_PATH, 'utf8');
const iife = extractIife(sapSrc);

// ════ A. 行為級逾時驗證（HEAD-FAIL 核心）════
await T('A1 官網掛住時：handler 必須註冊逾時 timer（15s ≤ 逾時 < 60s）', async () => {
  const sb = buildSandbox(iife); sb.box.fetchImpl = hangFetch;
  const pending = call(sb, C(20), '10.1.1.1', 250);
  await sleep(30);   // 讓 handler 跑到 fetch
  const t = sb.timers.find(x => x.ms >= 1000);
  assert.ok(t, '官網掛住了，但 handler 沒註冊任何逾時 timer（fetch 沒有時間上限）');
  // 12 秒慢成功實測存在（nginx log 11.974s → 200）：逾時 < 15s 會把原本能成功的匯入切成失敗；
  // nginx proxy 預設 60s：逾時 ≥ 60s 等於沒有保護。
  assert.ok(t.ms >= 15000 && t.ms < 60000, '逾時 ' + t.ms + 'ms 不在 [15s, 60s) 安全區間');
  await pending; // 收尾
});
await T('A2 觸發逾時後：handler 真的中止並回 504（不是繼續掛著）', async () => {
  const sb = buildSandbox(iife); sb.box.fetchImpl = hangFetch;
  const pending = call(sb, C(21), '10.1.1.2', 400);
  await sleep(30);
  const t = sb.timers.find(x => x.ms >= 1000);
  assert.ok(t, '沒有逾時 timer 可觸發（BASE 行為：永遠掛住）');
  t.fn();                                   // 模擬時間到（timer 真的執行 abort）
  const out = await pending;
  assert.ok(out, '逾時 timer 觸發後 handler 仍然沒有回應');
  assert.strictEqual(out.status, 504, '逾時應回 504，實際 ' + out.status);
});
await T('A3 逾時訊息對玩家有意義（不是 AbortError 原文）', async () => {
  const sb = buildSandbox(iife); sb.box.fetchImpl = hangFetch;
  const pending = call(sb, C(22), '10.1.1.3', 400);
  await sleep(30);
  const t = sb.timers.find(x => x.ms >= 1000);
  assert.ok(t, '沒有逾時 timer');
  t.fn();
  const out = await pending;
  assert.ok(out && out.body && typeof out.body.error === 'string', '沒有 error 訊息');
  assert.ok(out.body.error.includes('官網回應太慢'), '訊息應含「官網回應太慢」，實際：' + out.body.error);
  assert.ok(!/abort/i.test(out.body.error), '訊息不得含 AbortError 原文：' + out.body.error);
});
await T('A4 成功路徑不留 timer handle（clearTimeout 必須被呼叫）', async () => {
  const sb = buildSandbox(iife); sb.box.fetchImpl = okFetch;
  const out = await call(sb, C(23), '10.1.1.4');
  assert.ok(out && out.status === 200, '成功路徑壞了');
  const t = sb.timers.find(x => x.ms >= 1000);
  assert.ok(t, '成功路徑也應有逾時 timer 保護');
  assert.ok(sb.cleared.includes(t.id), '成功後沒 clearTimeout（timer handle 殘留）');
});

// ════ B+C. 成功路徑與各分支「逐字不變」（BASE 對照）════
const cur = await behaviorSnapshot(iife);
await T('B1 成功路徑：解析出 2 種卡、count 正確、cached 旗標正確', async () => {
  assert.ok(cur.ok1 && cur.ok1.status === 200, '第一次匯入失敗');
  assert.strictEqual(cur.ok1.body.entries.length, 2);
  assert.deepStrictEqual(cur.ok1.body.entries.map(e => e.count), [4, 10]);
  assert.strictEqual(cur.ok1.body.cached, false);
  assert.strictEqual(cur.ok2.body.cached, true, '第二次同 code 應命中 5 分鐘快取');
  assert.strictEqual(cur.okFetchCalls, 1, '快取命中不應再打官網（實際 fetch ' + cur.okFetchCalls + ' 次）');
});
// ⚠⚠ v6.263：這裡原本是
//     `catch { console.log('（拿不到 BASE blob，跳過對照）'); return; }`
//   —— CI（actions/checkout@v4 預設 fetch-depth:1 的淺複製）拿不到 BASE blob，
//   於是這一條**條數不變、無 SKIP 字樣、整體綠燈**，實際上從來沒有在守（實測確認）。
//   改成【內嵌 BASE 行為快照】：淺複製下照樣逐分支比對，條數不變且真的在守。
//   下面的 B2b 再負責證明「這份內嵌值不是憑空捏的」。
const BASE_SNAPSHOT = {
  "ok1": {
    "status": 200,
    "body": {
      "code": "AAAA01-BBBBBB-CCCCCC",
      "entries": [
        {
          "cardId": "12345",
          "name": "皮卡丘ex",
          "setCode": "M4",
          "collectorNumber": "002/083",
          "count": 4
        },
        {
          "cardId": "67890",
          "name": "基本雷能量",
          "setCode": "SVE",
          "collectorNumber": "004/008",
          "count": 10
        }
      ],
      "cached": false
    }
  },
  "ok2": {
    "status": 200,
    "body": {
      "code": "AAAA01-BBBBBB-CCCCCC",
      "entries": [
        {
          "cardId": "12345",
          "name": "皮卡丘ex",
          "setCode": "M4",
          "collectorNumber": "002/083",
          "count": 4
        },
        {
          "cardId": "67890",
          "name": "基本雷能量",
          "setCode": "SVE",
          "collectorNumber": "004/008",
          "count": 10
        }
      ],
      "cached": true
    }
  },
  "okFetchCalls": 1,
  "badFormat": {
    "status": 400,
    "body": {
      "error": "代碼格式錯誤（應為 XXXXXX-XXXXXX-XXXXXX）"
    }
  },
  "badFormatFetchCalls": 0,
  "http404": {
    "status": 404,
    "body": {
      "error": "官網回應異常 (HTTP 404)"
    }
  },
  "parse422": {
    "status": 422,
    "body": {
      "error": "HTML 解析失敗（可能代碼無效或官網結構變動）"
    }
  },
  "err500": {
    "status": 500,
    "body": {
      "error": "無法連線到官網: connect ECONNREFUSED 1.2.3.4:443"
    }
  },
  "rate6th": {
    "status": 429,
    "body": {
      "error": "請求過於頻繁，請稍候再試（每分鐘最多 5 次）"
    }
  },
  "rateFetchCalls": 5
};
const SNAP_KEYS = ['ok1', 'ok2', 'badFormat', 'http404', 'parse422', 'err500', 'rate6th'];
const cmpSnap = (a, b, tag) => {
  for (const k of SNAP_KEYS) assert.deepStrictEqual(a[k], b[k], tag + '：分支 ' + k + ' 的回應不一致');
  assert.strictEqual(a.okFetchCalls, b.okFetchCalls, tag + '：快取行為改變');
  assert.strictEqual(a.rateFetchCalls, b.rateFetchCalls, tag + '：限流消耗位置改變');
};
await T('B2 與 BASE(v6.223) 行為快照 deep-equal（400/404/422/429/500/快取全分支）', async () => {
  cmpSnap(cur, BASE_SNAPSHOT, '與 BASE 內嵌快照');
});
await T('B2b 內嵌快照的真實性：拿得到歷史時必須與現算的 BASE 逐欄相同', async () => {
  const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  if (!b.ok) {
    // ⚠ 只有「內嵌值 vs 現算值」這一層驗證會跳過；上面的 B2 仍然完整在守。
    shallowSkip('v6.224 B2b：內嵌 BASE 快照的重算驗證', 'B2 已用內嵌快照完整比對，本條只驗內嵌值本身');
    return;
  }
  const baseSnap = await behaviorSnapshot(extractIife(b.out));
  cmpSnap(BASE_SNAPSHOT, baseSnap, '內嵌快照 vs 現算 BASE');
});
await T('C1 限流在昂貴 fetch 之前：第 6 次回 429 且官網只被打 5 次', async () => {
  assert.ok(cur.rate6th && cur.rate6th.status === 429, '第 6 次應 429，實際 ' + (cur.rate6th && cur.rate6th.status));
  assert.strictEqual(cur.rateFetchCalls, 5, '限流沒有擋在 fetch 前（fetch 被叫 ' + cur.rateFetchCalls + ' 次）');
});
await T('C2 400/404/422/500 各分支原樣', async () => {
  assert.strictEqual(cur.badFormat.status, 400);
  assert.strictEqual(cur.badFormatFetchCalls, 0, '格式錯誤不應打官網');
  assert.strictEqual(cur.http404.status, 404);
  assert.strictEqual(cur.parse422.status, 422);
  assert.strictEqual(cur.err500.status, 500);
  assert.ok(cur.err500.body.error.startsWith('無法連線到官網'), '一般連線錯誤訊息應原樣');
});

// ════ D. 前端（decks/+page.svelte）════
const deckSrc = readFileSync(DECKS_PATH, 'utf8');
await T('D1 前端 decode-tw-deck 的 fetch 必須帶 signal（否則前端逾時是空話）', async () => {
  const m = deckSrc.match(/fetch\(`\$\{apiUrl\}\/api\/decode-tw-deck\/\$\{code\}`([^)]*)\)/);
  assert.ok(m, '找不到前端 decode-tw-deck fetch 呼叫');
  assert.ok(/signal\s*:/.test(m[1]), '前端 fetch 沒帶 signal —— 玩家端仍會無限等待');
});
await T('D2 前端逾時必須「稍長於」後端逾時（否則玩家先斷、看到錯的訊息）', async () => {
  const be = iife.match(/FETCH_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*1000/);
  assert.ok(be, '後端找不到 FETCH_TIMEOUT_MS = N * 1000');
  const fe = deckSrc.match(/twImportAbort\.abort\(\)\s*,\s*(\d+)\s*\*\s*1000/);
  assert.ok(fe, '前端找不到匯入逾時 setTimeout');
  assert.ok(Number(fe[1]) > Number(be[1]),
    '前端逾時 ' + fe[1] + 's 必須 > 後端 ' + be[1] + 's');
});
await T('D3 前端 AbortError 有玩家看得懂的訊息 + clearTimeout 收尾', async () => {
  const fnStart = deckSrc.indexOf('async function importFromTwOfficialCode');
  assert.ok(fnStart >= 0, '找不到 importFromTwOfficialCode');
  const fnBody = deckSrc.slice(fnStart, deckSrc.indexOf('async function exportToTwOfficialCode'));
  assert.ok(/AbortError/.test(fnBody), '前端 catch 沒特判 AbortError');
  assert.ok(fnBody.includes('官網回應太慢'), '前端逾時訊息應含「官網回應太慢」');
  assert.ok(/clearTimeout\(\s*twImportTimer\s*\)/.test(fnBody), '前端沒 clearTimeout（timer 殘留）');
});

console.log(`\ntest-v6224-deck-import-timeout: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
