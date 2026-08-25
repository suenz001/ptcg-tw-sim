// v6.230 守衛：/api/encode-tw-deck 三段外部 fetch 逾時保護
//
// 背景：匯出官網牌組代碼的 handler 內有三個接續的 await fetch 打寶可夢官網
//   （① GET deck-build/ 拿 token ② POST beforecheck/ 驗證 ③ POST register/ 發行），
//   BASE(v6.229) 全部沒有逾時 —— 任一段掛住玩家無限期乾等，且三段接續風險更高。
//   實測（nginx 計時 log 2026-08-25）成功案例三段合計 1.2~1.4 秒；同一官網主機在
//   匯入端（v6.224）實測過 11.974 秒仍成功 → 單段逾時沿用 20 秒（Rule 37），
//   另設 50 秒總預算：要守的排序是「後端總預算 50s < 前端逾時 55s < Cloudflare 邊緣 ~100s」
//   （nginx /api/ 為 proxy_read_timeout 24h，不構成上限；v6.231 更正依據）。
// 本守衛把 server_admin_patch.js 的 registerTwDeckExport IIFE 抽出來，在 node:vm
//   沙盒內【實際執行】handler：
//   A. 行為級逾時驗證 —— fetch 替身真的掛住（只有收到 abort 才 reject）：
//      A1/A2/A3 三段各自掛住 → 都必須在逾時後中止、回 504、訊息分得出是哪一段、
//      且【不會繼續打後面的段】。⚠ HEAD-FAIL：BASE 沒有 timer → handler 永不回應 → 紅。
//      A4 成功路徑不留 timer handle；A5 總預算行為驗證（假時鐘）；A6 常數安全區間。
//   B+C. 成功路徑與各錯誤分支（400/422/429/502×5/500）在【BASE 版】與【現行版】
//      各跑一次，回應 deep-equal（成功路徑逐字不變）。
//   D. 前端（src/routes/decks/+page.svelte）—— fetch 帶 signal、前端逾時 > 後端總預算、
//      AbortError 特判成人話、clearTimeout 收尾（Svelte 元件行為端測不到，靜態斷言）。
//
// 突變測試（外部以 V6230_SAP / V6230_DECKS 指向突變檔重跑，都必須紅）：
//   M1 拿掉第二段的 signal、M2 拿掉 AbortError 特判、M3 拿掉 finally 的 clearTimeout、
//   M4 單段逾時改 10 秒（會把實測 12 秒級的慢成功切成失敗）、
//   M5 前端逾時 ≤ 後端總預算、M6 總預算改到 60 秒以上（超過前端逾時 55s）或 40 秒以下。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAP_PATH = process.env.V6230_SAP || join(ROOT, 'oracle-admin/server_admin_patch.js');
const DECKS_PATH = process.env.V6230_DECKS || join(ROOT, 'src/routes/decks/+page.svelte');
// BASE 對照版（成功路徑逐字不變的基準）— v6.229 的 sha
const BASE_SHA = '503d1e06d2979156e390a5cef76b28d60a66880b';

let pass = 0, fail = 0;
const T = async (n, f) => { try { await f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 抽出 registerTwDeckExport IIFE（錨點式，不做通用括號配對）──
function extractIife(src) {
  const start = src.indexOf('(function registerTwDeckExport()');
  assert.ok(start >= 0, '找不到 registerTwDeckExport IIFE 起點');
  const anchor = src.indexOf('endpoint POST /api/encode-tw-deck registered', start);
  assert.ok(anchor > start, '找不到 IIFE 尾端錨點');
  const end = src.indexOf('})();', anchor);
  assert.ok(end > anchor, '找不到 IIFE 收尾 })();');
  const iife = src.slice(start, end + '})();'.length);
  // 掃描器下限斷言（Rule 25）：抽出的不該是空殼
  assert.ok(iife.length > 4000, 'IIFE 只有 ' + iife.length + ' chars，抽取器壞了？');
  assert.ok(iife.includes("app.post('/api/encode-tw-deck'"), 'IIFE 內沒有路由註冊');
  return iife;
}

// ── 沙盒：實際執行 IIFE，拿到 handler ──
function buildSandbox(iife, fakeDate) {
  const routes = {};
  const timers = [];            // { id, fn, ms }
  const cleared = [];
  let timerSeq = 0;
  const box = { fetchCalls: [], fetchImpl: null };
  const sandbox = {
    app: { post(p, fn) { routes[p] = fn; }, get() {} },
    fetch: (...a) => { box.fetchCalls.push(a); return box.fetchImpl(...a); },
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { cleared.push(id); },
    AbortController,
    URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
  };
  if (fakeDate) sandbox.Date = fakeDate;   // 假時鐘（僅 A5 總預算測試用；handler 只用 Date.now()）
  vm.createContext(sandbox);
  vm.runInContext(iife, sandbox, { filename: 'registerTwDeckExport.vm.js' });
  const handler = routes['/api/encode-tw-deck'];
  assert.ok(typeof handler === 'function', '路由 handler 沒被註冊');
  return { handler, timers, cleared, box };
}

const ENTRIES = [
  { cardId: '12345', cardName: '皮卡丘ex', count: 4 },
  { cardId: '67890', cardName: '基本雷能量', count: 10 },
];
function makeReq(entries, ip) {
  return { headers: { 'x-forwarded-for': ip }, ip, body: { entries } };
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
async function call(sb, entries, ip, realWaitMs = 300) {
  const { res, finished } = makeRes();
  sb.handler(makeReq(entries, ip), res);
  return Promise.race([finished, sleep(realWaitMs).then(() => null)]);
}

// ── fetch 替身（依 URL 分派三段；hangSteps 內的段掛住，只有收到 abort 才 reject）──
const TOKEN_HTML = '<form><input type="hidden" name="token" value="TOK123"></form>';
function stepFetch(overrides = {}, hangSteps = []) {
  const stepOf = (url) => url.includes('beforecheck/') ? 2 : url.includes('register/') ? 3 : 1;
  return (url, opts) => {
    const n = stepOf(String(url));
    if (hangSteps.includes(n)) {
      return new Promise((_resolve, reject) => {
        const sig = opts && opts.signal;
        if (!sig) return;       // 沒傳 signal（BASE / 突變 M1）→ 永遠 pending
        const onAbort = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e); };
        if (sig.aborted) onAbort(); else sig.addEventListener('abort', onAbort);
      });
    }
    if (overrides[n]) return overrides[n](url, opts);
    if (n === 1) return Promise.resolve({
      ok: true, status: 200,
      headers: { getSetCookie: () => ['PHPSESSID=abc123; path=/'], get: () => null },
      text: async () => TOKEN_HTML,
    });
    if (n === 2) return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: { code: 200, errors: [] } }) });
    return Promise.resolve({
      ok: false, status: 302,
      headers: { get: (k) => String(k).toLowerCase() === 'location' ? '/tw/deck-build/code/?deckCode=AbCdEf-GhIjKl-MnOpQr' : null },
    });
  };
}

// ── 對一份 source 跑「行為快照」（BASE 與現行版共用，供逐字對照）──
async function behaviorSnapshot(iife) {
  const snap = {};
  { const sb = buildSandbox(iife); sb.box.fetchImpl = stepFetch();
    snap.ok = await call(sb, ENTRIES, '10.0.0.1');
    snap.okFetchCalls = sb.box.fetchCalls.length; }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = stepFetch();
    snap.emptyDeck = await call(sb, [], '10.0.0.2');
    snap.badCardId = await call(sb, [{ cardId: 'abc', cardName: 'X', count: 1 }], '10.0.0.3');
    snap.badFetchCalls = sb.box.fetchCalls.length; }
  { const sb = buildSandbox(iife); sb.box.fetchImpl = stepFetch();
    const seq = [];
    for (let i = 0; i < 4; i++) seq.push(await call(sb, ENTRIES, '10.9.9.9'));
    snap.rate4th = seq[3];                                  // 3/min → 第 4 次 429
    snap.rateFetchCalls = sb.box.fetchCalls.length; }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 1: async () => ({ ok: false, status: 500 }) });
    snap.s1http = await call(sb, ENTRIES, '10.0.1.1'); }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 1: async () => ({ ok: true, status: 200, headers: { getSetCookie: () => [], get: () => null }, text: async () => '<html>維護中</html>' }) });
    snap.s1noToken = await call(sb, ENTRIES, '10.0.1.2'); }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 2: async () => ({ ok: false, status: 503 }) });
    snap.s2http = await call(sb, ENTRIES, '10.0.1.3'); }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 2: async () => ({ ok: true, status: 200, json: async () => ({ success: { code: 200, errors: ['卡牌張數不足60張。'] } }) }) });
    snap.s2reject = await call(sb, ENTRIES, '10.0.1.4'); }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 3: async () => ({ ok: true, status: 200, headers: { get: () => null } }) });
    snap.s3not302 = await call(sb, ENTRIES, '10.0.1.5'); }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 3: async () => ({ ok: false, status: 302, headers: { get: (k) => String(k).toLowerCase() === 'location' ? '/tw/deck-build/' : null } }) });
    snap.s3noCode = await call(sb, ENTRIES, '10.0.1.6'); }
  { const sb = buildSandbox(iife);
    sb.box.fetchImpl = stepFetch({ 1: async () => { const e = new Error('connect ECONNREFUSED 1.2.3.4:443'); e.name = 'TypeError'; throw e; } });
    snap.err500 = await call(sb, ENTRIES, '10.0.1.7'); }
  return snap;
}

const sapSrc = readFileSync(SAP_PATH, 'utf8');
const iife = extractIife(sapSrc);
const longTimers = (sb) => sb.timers.filter(t => t.ms >= 1000);

// ════ A. 行為級逾時驗證（HEAD-FAIL 核心：三段各自掛住都要能中止）════
async function hangStep(n) {
  const sb = buildSandbox(iife); sb.box.fetchImpl = stepFetch({}, [n]);
  const pending = call(sb, ENTRIES, '10.2.2.' + n, 400);
  await sleep(50);   // 讓 handler 跑到第 n 段 fetch
  const armed = longTimers(sb);
  assert.ok(armed.length >= 1, '第 ' + n + ' 段掛住了，但 handler 沒註冊任何逾時 timer（fetch 沒有時間上限）');
  const t = armed[armed.length - 1];   // 目前 in-flight 的那段
  // 同官網主機實測過 11.974 秒慢成功（v6.224）：逾時 < 15s 會把「慢但能成功」切成失敗；
  // 前端逾時 55s／Cloudflare 邊緣 ~100s：單段逾時 ≥ 60s 等於玩家先被前端切斷。
  assert.ok(t.ms >= 15000 && t.ms < 60000, '逾時 ' + t.ms + 'ms 不在 [15s, 60s) 安全區間');
  const callsBefore = sb.box.fetchCalls.length;
  assert.strictEqual(callsBefore, n, '掛住前應恰好打了 ' + n + ' 段官網（實際 ' + callsBefore + '）');
  t.fn();                              // 模擬時間到（timer 真的執行 abort）
  const out = await pending;
  assert.ok(out, '逾時 timer 觸發後 handler 仍然沒有回應（永遠掛住）');
  assert.strictEqual(out.status, 504, '逾時應回 504，實際 ' + out.status);
  assert.ok(out.body && typeof out.body.error === 'string', '沒有 error 訊息');
  assert.ok(!/abort/i.test(out.body.error), '訊息不得含 AbortError 原文：' + out.body.error);
  assert.ok(out.body.error.includes('官網回應太慢'), '訊息應含「官網回應太慢」，實際：' + out.body.error);
  await sleep(20);
  assert.strictEqual(sb.box.fetchCalls.length, n, '第 ' + n + ' 段逾時後不得繼續打後面的段（實際打了 ' + sb.box.fetchCalls.length + ' 段）');
  return out.body.error;
}
let msg1 = '', msg2 = '', msg3 = '';
await T('A1 第一段（官網頁面）掛住 → 逾時中止、回 504、不打第二三段', async () => { msg1 = await hangStep(1); });
await T('A2 第二段（牌組驗證）掛住 → 逾時中止、回 504、不打第三段', async () => { msg2 = await hangStep(2); });
await T('A3 第三段（牌組發行）掛住 → 逾時中止、回 504、並提醒可能已發行成功', async () => {
  msg3 = await hangStep(3);
  assert.ok(msg3.includes('可能已'), '第三段有副作用（官網已收到發行請求），訊息應提醒「可能已」發行成功：' + msg3);
});
await T('A3b 三段的逾時訊息必須分得出是哪一段（兩兩不同）', async () => {
  assert.ok(msg1 && msg2 && msg3, '前三個測試沒拿到訊息');
  assert.ok(msg1 !== msg2 && msg2 !== msg3 && msg1 !== msg3,
    '訊息無法分辨段落：[' + msg1 + '] / [' + msg2 + '] / [' + msg3 + ']');
  // 前兩段沒有副作用，不得出現「可能已發行」的誤導
  assert.ok(!msg1.includes('可能已') && !msg2.includes('可能已'), '前兩段尚未發行，訊息不得提「可能已」發行');
});
await T('A4 成功路徑不留 timer handle（三段的 timer 全部被 clearTimeout）', async () => {
  const sb = buildSandbox(iife); sb.box.fetchImpl = stepFetch();
  const out = await call(sb, ENTRIES, '10.2.3.1');
  assert.ok(out && out.status === 200, '成功路徑壞了：' + JSON.stringify(out));
  const armed = longTimers(sb);
  assert.ok(armed.length >= 3, '三段各自都應有逾時 timer 保護（實際 ' + armed.length + ' 個）');
  await sleep(20);   // finally 在 res.json 之後才跑完
  for (const t of armed) assert.ok(sb.cleared.includes(t.id), '成功後 timer #' + t.id + ' 沒被 clearTimeout（handle 殘留）');
});
await T('A5 總預算行為驗證：前兩段耗掉 38 秒後，第三段的逾時必須被剩餘預算壓縮', async () => {
  let fakeNow = 1000000;
  const fakeDate = { now: () => fakeNow };
  const sb = buildSandbox(iife, fakeDate);
  sb.box.fetchImpl = stepFetch({
    1: async () => { fakeNow += 19000; return { ok: true, status: 200, headers: { getSetCookie: () => ['PHPSESSID=a'], get: () => null }, text: async () => TOKEN_HTML }; },
    2: async () => { fakeNow += 19000; return { ok: true, status: 200, json: async () => ({ success: { code: 200, errors: [] } }) }; },
  }, [3]);
  const pending = call(sb, ENTRIES, '10.2.4.1', 400);
  await sleep(50);
  const armed = longTimers(sb);
  assert.ok(armed.length >= 3, '三段 timer 沒齊（' + armed.length + '）—— 沒有逐段各自計時？');
  const t3 = armed[armed.length - 1];
  // 單段值仍是 20s，但總預算（<60s）扣掉已耗的 38s 後剩不到 20s ⇒ 第三段必須被壓縮。
  assert.ok(t3.ms < 20000, '第三段逾時 ' + t3.ms + 'ms 沒被總預算壓縮（三段各 20s 相加會超過前端逾時 55s）');
  assert.ok(t3.ms >= 1, '剩餘預算計算錯誤（' + t3.ms + 'ms）');
  t3.fn();
  const out = await pending;
  assert.ok(out && out.status === 504, '預算耗盡後仍應回 504');
});
await T('A6 常數安全區間：單段 20s（Rule 37）、總預算 [40s, 60s)', async () => {
  const step = iife.match(/STEP_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*1000/);
  assert.ok(step, '找不到 STEP_TIMEOUT_MS = N * 1000');
  assert.ok(Number(step[1]) >= 15 && Number(step[1]) < 60,
    '單段逾時 ' + step[1] + 's 不在 [15s, 60s)（實測過 12 秒級慢成功；且不得達前端逾時上限）');
  const total = iife.match(/TOTAL_BUDGET_MS\s*=\s*(\d+)\s*\*\s*1000/);
  assert.ok(total, '找不到 TOTAL_BUDGET_MS = N * 1000（沒有總預算）');
  assert.ok(Number(total[1]) >= 40 && Number(total[1]) < 60,
    '總預算 ' + total[1] + 's 不在 [40s, 60s)：低於 40s 可能切掉「三段都慢但能成功」（3×12s=36s），達 60s 會超過前端逾時 55 秒、玩家先被前端切斷');
  assert.ok(Number(total[1]) > Number(step[1]), '總預算必須大於單段逾時');
});

// ════ B+C. 成功路徑與各分支「逐字不變」（BASE 對照）════
const cur = await behaviorSnapshot(iife);
await T('B1 成功路徑：三段都打、拿到 deckCode 與張數統計', async () => {
  assert.ok(cur.ok && cur.ok.status === 200, '匯出成功路徑壞了：' + JSON.stringify(cur.ok));
  assert.deepStrictEqual(cur.ok.body, { deckCode: 'AbCdEf-GhIjKl-MnOpQr', totalKinds: 2, totalCards: 14 });
  assert.strictEqual(cur.okFetchCalls, 3, '成功路徑應恰好打官網 3 次（實際 ' + cur.okFetchCalls + '）');
});
await T('B2 與 BASE(v6.229) 行為快照 deep-equal（400/422/429/502×4/500 全分支）', async () => {
  let baseSrc;
  try {
    baseSrc = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':oracle-admin/server_admin_patch.js'],
      { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch { console.log('    （拿不到 BASE blob，跳過對照 — 沙盒外環境）'); return; }
  const baseSnap = await behaviorSnapshot(extractIife(baseSrc));
  for (const k of ['ok', 'emptyDeck', 'badCardId', 'rate4th', 's1http', 's1noToken', 's2http', 's2reject', 's3not302', 's3noCode', 'err500']) {
    assert.deepStrictEqual(cur[k], baseSnap[k], '分支 ' + k + ' 的回應與 BASE 不一致');
  }
  assert.strictEqual(cur.okFetchCalls, baseSnap.okFetchCalls, '官網呼叫次數改變');
  assert.strictEqual(cur.rateFetchCalls, baseSnap.rateFetchCalls, '限流消耗位置改變');
});
await T('C1 限流在昂貴 fetch 之前：第 4 次回 429 且官網只被打 9 次（3 次成功 × 3 段）', async () => {
  assert.ok(cur.rate4th && cur.rate4th.status === 429, '第 4 次應 429，實際 ' + (cur.rate4th && cur.rate4th.status));
  assert.strictEqual(cur.rateFetchCalls, 9, '限流沒有擋在 fetch 前（fetch 被叫 ' + cur.rateFetchCalls + ' 次）');
});
await T('C2 400/422/502/500 各分支原樣', async () => {
  assert.strictEqual(cur.emptyDeck.status, 400);
  assert.strictEqual(cur.badCardId.status, 400);
  assert.strictEqual(cur.badFetchCalls, 0, '驗證失敗不應打官網');
  assert.strictEqual(cur.s1http.status, 502);
  assert.strictEqual(cur.s1noToken.status, 502);
  assert.strictEqual(cur.s2http.status, 502);
  assert.strictEqual(cur.s2reject.status, 422);
  assert.deepStrictEqual(cur.s2reject.body.officialErrors, ['卡牌張數不足60張。'], '官網拒絕清單應原樣轉交');
  assert.strictEqual(cur.s3not302.status, 502);
  assert.strictEqual(cur.s3noCode.status, 502);
  assert.strictEqual(cur.err500.status, 500);
  assert.ok(cur.err500.body.error.startsWith('無法連線到官網'), '一般連線錯誤訊息應原樣');
});

// ════ D. 前端（decks/+page.svelte）════
const deckSrc = readFileSync(DECKS_PATH, 'utf8');
const feStart = deckSrc.indexOf('async function exportToTwOfficialCode');
const feBody = feStart >= 0 ? deckSrc.slice(feStart, deckSrc.indexOf('async function copyExportedCode')) : '';
await T('D1 前端 encode-tw-deck 的 fetch 必須帶 signal（否則前端逾時是空話）', async () => {
  assert.ok(feStart >= 0, '找不到 exportToTwOfficialCode');
  assert.ok(feBody.includes('/api/encode-tw-deck'), '函式內找不到 encode-tw-deck fetch');
  assert.ok(/signal\s*:\s*twExportAbort\.signal/.test(feBody), '前端 fetch 沒帶 signal —— 玩家端仍會無限等待');
});
await T('D2 前端逾時必須「稍長於」後端總預算（否則玩家先斷、看到錯的訊息）', async () => {
  const total = iife.match(/TOTAL_BUDGET_MS\s*=\s*(\d+)\s*\*\s*1000/);
  assert.ok(total, '後端找不到 TOTAL_BUDGET_MS = N * 1000');
  const fe = feBody.match(/twExportAbort\.abort\(\)\s*,\s*(\d+)\s*\*\s*1000/);
  assert.ok(fe, '前端找不到匯出逾時 setTimeout');
  assert.ok(Number(fe[1]) > Number(total[1]),
    '前端逾時 ' + fe[1] + 's 必須 > 後端總預算 ' + total[1] + 's');
});
await T('D3 前端 AbortError 有玩家看得懂的訊息 + clearTimeout 收尾', async () => {
  assert.ok(/AbortError/.test(feBody), '前端 catch 沒特判 AbortError');
  assert.ok(feBody.includes('回應太慢'), '前端逾時訊息應含「回應太慢」');
  assert.ok(/clearTimeout\(\s*twExportTimer\s*\)/.test(feBody), '前端沒 clearTimeout（timer 殘留）');
});

console.log(`\ntest-v6230-deck-export-timeout: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
