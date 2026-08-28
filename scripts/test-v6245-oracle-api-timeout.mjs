// v6.245 守衛：休閒對戰 `oracleApi()` 逾時保護 —— 全部斷言到**行為層**（實跑，不是 grep 字串）
//
// ── 這一版在修什麼 ────────────────────────────────────────────────────────
// nginx 慢請求 log（2026-08-26/27 實測）：
//   `60.001 - 408 /api/rooms/W6JC PUT`（upstream_response_time="-" ⇒ 請求從沒送到 node）×45 筆
//   `86.954 0.007 409 /api/rooms/XTCT PUT request_length=48285`（上行 ~4.4 kbps）
// 而 `oracleApi` —— 休閒對戰所有請求的唯一出口 —— 沒有 AbortController、沒有任何 timeout，
// `await fetch` 掛住時三個 tick 迴圈（oraclePollRoom / oraclePollMessages / subscribeOpenRooms）
// 都是「await 完才排下一發」⇒ **輪詢永久停擺**、畫面沒有任何錯誤訊息（＝「按了沒反應」）。
//
// ── 這支守衛怎麼證明 ──────────────────────────────────────────────────────
//  0. 掃描器自我驗證 + 呼叫點枚舉（Rule 25 下限斷言）
//  1. [HEAD-FAIL] 永不 resolve 的 fetch stub：BASE 版必須掛住；現行版必須逾時並丟出
//     `isOracleTimeout(err) === true`
//  2. [正對照] 200ms 就回的 stub：修前修後**完全相同**（回傳值、fetch 次數、沒有多等）
//  3. [豁免對照] 40 秒才回的 stub：預設 30s 會被砍；帶 60s 逃生口的**不可**被砍
//  4. [401 重試] 第一發 401、第二發 200 ⇒ 必須成功，且第二發用的是**新的 signal**
//  5. [204/304/409] 回傳值與 BASE 逐字一致
//  6. [oracleTx] 逾時走既有 409 重試路徑：**先重新拉最新盤面再對新盤面重做**，且有次數上限
//  7. [pushWithRetry] 逾時 ⇒ 不原樣重送（只送 1 次）；一般錯誤 ⇒ 仍重試 3 次
//  8. [突變測試] 逾時值改 0 / 拿掉 clearTimeout / 拿掉 _timedOut 判別 / 拿掉 signal ⇒ 必須翻紅
//
// ⚠ 時間全部走**虛擬時鐘**（注入的 setTimeout/clearTimeout），所以「40 秒」是瞬間的。
// Run: node scripts/test-v6245-oracle-api-timeout.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OC_PATH = join(ROOT, 'src/lib/game/oracle-client.ts');
const RO_PATH = join(ROOT, 'src/lib/game/room-oracle.ts');
const GP_PATH = join(ROOT, 'src/routes/game/+page.svelte');
const DK_PATH = join(ROOT, 'src/routes/decks/+page.svelte');
const OC = readFileSync(OC_PATH, 'utf8');
const RO = readFileSync(RO_PATH, 'utf8');
const GP = readFileSync(GP_PATH, 'utf8');
const DK = readFileSync(DK_PATH, 'utf8');
// v6.244 的 sha（只用來拿 BASE 對照；CI 是 fetch-depth:1 淺複製 ⇒ 拿不到就跳過，不 fail-open 成假綠）
const BASE_SHA = '5fbfb616ce96dee44d18e1f019f125c3fc477c63';

let pass = 0, fail = 0;
const T = async (n, f) => { try { await f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const ok = (c, m) => assert.ok(c, m);

// esbuild：抓不到就直接紅（fail-open 會變成假綠）
const esbuild = await import('esbuild');

// ══════════════════════════════════════════════════════════════════════════
// 共用：把 oracle-client.ts 變成可在 new Function 內實跑的 CJS 模組
// ══════════════════════════════════════════════════════════════════════════
function prepModule(src) {
  const out = src
    .replace(/^import \{ noteServerTime, getServerClockOffsetMs \} from '\.\/server-clock';$/m,
      'const noteServerTime = (): boolean => false; const getServerClockOffsetMs = (): number | null => null;')
    .replace("((import.meta as any).env?.VITE_ORACLE_API_URL as string) || ''", "'http://t.local'")
    .replace("((import.meta as any).env?.VITE_BACKEND_MODE as string) === 'oracle'", 'true');
  // 掃描器下限斷言（Rule 25）：三處替換都必須真的發生，否則等於在測一份沒被準備好的原始碼
  assert.ok(!out.includes('server-clock'), 'prepModule 沒換掉 server-clock import');
  assert.ok(!out.includes('import.meta'), 'prepModule 沒換掉 import.meta.env');
  assert.ok(out.length > 15000, 'prepModule 產出只有 ' + out.length + ' 字元，抽取器壞了？');
  return out;
}
function compile(src) {
  return esbuild.transformSync(prepModule(src), { loader: 'ts', format: 'cjs' }).code;
}

// ── 虛擬時鐘 ───────────────────────────────────────────────────────────────
const realSetImmediate = setImmediate;
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  const cleared = [];
  const vSetTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; };
  const vClearTimeout = (id) => { cleared.push(id); timers.delete(id); };
  const drain = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => realSetImmediate(r)); };
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      await drain();
      let best = null, bestId = -1;
      for (const [id, t] of timers) if (t.at <= target && (!best || t.at < best.at)) { best = t; bestId = id; }
      if (!best) break;
      now = best.at; timers.delete(bestId); best.fn();
    }
    now = target; await drain();
  }
  return { vSetTimeout, vClearTimeout, advance, drain, cleared, timers, nowRef: () => now };
}

// ── fetch 替身 ─────────────────────────────────────────────────────────────
function mkRes(r) {
  return {
    status: r.status, ok: r.status >= 200 && r.status < 300,
    headers: { get: () => null },
    json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
    text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
  };
}
/** plan(rec, n) → { delayMs, status, body }；delayMs = Infinity ⇒ 永遠不 resolve（黑洞） */
function makeFetch(clock, plan) {
  const calls = [];
  const fn = (url, init) => new Promise((resolve, reject) => {
    const rec = { url, init: init || {}, signal: init && init.signal, abortedAt: null };
    calls.push(rec);
    const p = plan(rec, calls.length);
    if (p.delayMs !== Infinity) clock.vSetTimeout(() => resolve(mkRes(p)), p.delayMs);
    if (rec.signal) {
      rec.signal.addEventListener('abort', () => {
        rec.abortedAt = clock.nowRef();
        const e = new Error('The operation was aborted.'); e.name = 'AbortError';
        reject(e);
      });
    }
  });
  fn.calls = calls;
  return fn;
}

function loadModule(srcText, clock, fetchImpl, opts = {}) {
  const code = compile(srcText);
  const mod = { exports: {} };
  const store = opts.noCache ? {} : { ptcg_oracle_token: 'T0', ptcg_oracle_uid: 'U0' };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const f = new Function('module', 'exports', 'fetch', 'AbortController', 'setTimeout',
    'clearTimeout', 'localStorage', 'console', 'Symbol', code);
  f(mod, mod.exports, fetchImpl, AbortController, clock.vSetTimeout, clock.vClearTimeout,
    localStorage, { warn() {}, error() {}, log() {} }, Symbol);
  return mod.exports;
}
/** 把一個 promise 包成「不會炸掉行程」的觀察器 */
function watch(p) {
  const st = { done: false, value: undefined, err: undefined };
  p.then((v) => { st.done = true; st.value = v; }, (e) => { st.done = true; st.err = e; });
  return st;
}

// ══════════════════════════════════════════════════════════════════════════
console.log('① 掃描器自我驗證 + 呼叫點枚舉（哪些呼叫走 oracleApi、誰被豁免）');
// ══════════════════════════════════════════════════════════════════════════
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
          .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
await T('⭐⭐ oracleApi 的呼叫點只在 oracle-client.ts 與 room-oracle.ts，且數量 ≥ 10（下限斷言）', () => {
  const hits = [];
  for (const [name, src] of [['oracle-client.ts', OC], ['room-oracle.ts', RO], ['game/+page.svelte', GP], ['decks/+page.svelte', DK]]) {
    const body = stripComments(src);
    const re = /(?<![A-Za-z0-9_$])oracleApi\s*[<(]/g;
    let m; while ((m = re.exec(body))) hits.push(name);
  }
  const byFile = hits.reduce((a, f) => (a[f] = (a[f] || 0) + 1, a), {});
  // 定義 oracleApi 那一行本身也會被算到（oracle-client.ts），所以下限用 10（9 個 wrapper + 遞迴 + 定義 + room-oracle 1）
  ok(hits.length >= 10, '只掃到 ' + hits.length + ' 個 oracleApi 呼叫點 —— 掃描器壞了？' + JSON.stringify(byFile));
  ok(!byFile['decks/+page.svelte'], 'decks 頁不該走 oracleApi（tw-deck 匯入/匯出有自己的 50 秒預算）');
  ok(!byFile['game/+page.svelte'], 'game 頁不該直接呼叫 oracleApi');
});
await T('⭐⭐⭐ /api/encode-tw-deck 與 /api/decode-tw-deck **不走** oracleApi（v6.230/6.231 的 50 秒預算不可被 30 秒打死）', () => {
  const body = stripComments(DK);
  ok(/decode-tw-deck/.test(body) && /encode-tw-deck/.test(body), '掃描器抓不到 tw-deck 端點 —— 檔案結構變了？');
  for (const ep of ['decode-tw-deck', 'encode-tw-deck']) {
    const i = body.indexOf(ep);
    const around = body.slice(Math.max(0, i - 400), i + 200);
    ok(/await fetch\(/.test(around), ep + ' 附近沒有裸 fetch（改走 oracleApi 了？那 50 秒預算會被 30 秒打死）');
    ok(!/oracleApi/.test(around), ep + ' 走了 oracleApi —— 必須豁免');
  }
  ok(/twImportAbort/.test(body) || /signal:/.test(body), 'tw-deck 匯入沒有自己的 AbortController');
});
await T('⭐⭐⭐ 長輪詢（wait=1）只在錦標賽 tApi，**不走** oracleApi（伺服器會故意掛 25 秒）', () => {
  const g = stripComments(GP);
  const i = g.indexOf("'&wait=1'");
  ok(i > 0, '抓不到長輪詢的 wait=1 —— 掃描器壞了？');
  const line = g.slice(g.lastIndexOf('\n', i - 200) + 1, g.indexOf('\n', i + 200));
  ok(/tApi\(/.test(line), '長輪詢不是走 tApi：' + line.trim().slice(0, 120));
  ok(!/oracleApi/.test(line), '長輪詢走了 oracleApi —— 30 秒會把伺服器故意掛起的 25 秒砍掉');
  ok(!/wait=1|longPoll|T_LP_CLIENT_TIMEOUT_MS/.test(stripComments(OC)),
    'oracle-client.ts 出現長輪詢字樣 —— 休閒側若有長輪詢必須另外豁免');
});
await T('⭐ 逾時常數：預設 30 秒、副作用型 60 秒（Rule 37：> 實測最慢成功案例；健康中位數 273ms）', () => {
  ok(/export const ORACLE_API_TIMEOUT_MS = 30000;/.test(OC), '預設逾時不是 30000');
  ok(/export const ORACLE_SIDEEFFECT_TIMEOUT_MS = 60000;/.test(OC), '副作用型逾時不是 60000');
});
// ⭐⭐⭐v6.246 弱點修正（獨立審查者【問題5】之二）：原本 takeSeat 與 startGame 共用同一個
//   錨點字串 `}, { timeoutMs: ORACLE_SIDEEFFECT_TIMEOUT_MS });`，**分不出是誰缺**，只靠 n >= 5
//   的計數兜底 —— 拿掉其中一個、另一個多寫一次，守衛照樣全綠。
//   ⇒ 改成「先切出每個函式的 body，再逐一斷言」，並保留下限斷言當第二道（Rule 25）。
function fnBody(src, decl, label) {
  const i = src.indexOf(decl);
  assert.ok(i >= 0, '抽不到 ' + label + ' 的宣告（錨點：' + decl + '）');
  // 函式結尾＝下一個「行首就是 }」的位置（頂層函式一律頂格收尾）
  const j = src.indexOf('\n}\n', i);
  assert.ok(j > i, '抽不到 ' + label + ' 的結尾');
  const out = src.slice(i, j + 3);
  assert.ok(out.length >= 120, label + ' 只抽到 ' + out.length + ' 字元 —— 抽取器壞了？');
  return out;
}
await T('⭐⭐ 「失敗有狀態副作用」的四個呼叫點**逐一**都帶了 60 秒逃生口（建房／進場／入座／開局）', () => {
  const b = stripComments(RO);
  // 正對照：抽取器真的分得出四個不同的 body（長度互異、彼此不包含）
  const bodies = {};
  for (const [fnName, decl] of [['createRoom', 'export async function createRoom('],
                                ['joinRoom', 'export async function joinRoom('],
                                ['takeSeat', 'export async function takeSeat('],
                                ['startGame', 'export async function startGame(']]) {
    bodies[fnName] = fnBody(b, decl, fnName);
  }
  ok(!bodies.takeSeat.includes('export async function startGame('),
    '抽取器把 takeSeat 與 startGame 切在一起了 —— 又變回「分不出誰缺」');
  ok(!bodies.startGame.includes('export async function takeSeat('), '同上（反向）');
  for (const fnName of Object.keys(bodies)) {
    ok(bodies[fnName].includes('ORACLE_SIDEEFFECT_TIMEOUT_MS'),
      fnName + ' 的函式本體裡沒有 60 秒逃生口');
  }
  // ⭐ 負對照：把 takeSeat body 內的逃生口抽掉，這條斷言必須翻紅（證明它不是安慰劑）
  ok(!bodies.takeSeat.replace(/ORACLE_SIDEEFFECT_TIMEOUT_MS/g, 'X').includes('ORACLE_SIDEEFFECT_TIMEOUT_MS'),
    '負對照本身壞了');
  const n = (b.match(/ORACLE_SIDEEFFECT_TIMEOUT_MS/g) || []).length;
  ok(n >= 5, '只有 ' + n + ' 處用到 ORACLE_SIDEEFFECT_TIMEOUT_MS（1 import + 4 呼叫點）');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('② [HEAD-FAIL] 永不 resolve 的 fetch stub');
// ══════════════════════════════════════════════════════════════════════════
let baseOC = null;
try {
  baseOC = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':src/lib/game/oracle-client.ts'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch { baseOC = null; }
// CI 是淺複製拿不到 BASE ⇒ 用「把逾時機制拿掉」的突變版當等價 BASE（同時就是突變測試 M1）
function mutateRemoveTimeout(src) {
  return src
    .replace(/const _to = setTimeout\([^\n]*\n/, 'const _to = 0;\n')
    .replace(/\n      signal: _ac\.signal,/, '')
    .replace(/const \{ token \} = await oracleAuth\(_ac\.signal\);/, 'const { token } = await oracleAuth();');
}
await T('⭐⭐⭐ HEAD-FAIL：BASE 版（無逾時）遇到黑洞會**永遠掛住**（推進 10 分鐘仍未 settle）', async () => {
  const src = baseOC || mutateRemoveTimeout(OC);
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: Infinity }));
  const m = loadModule(src, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA', { method: 'PUT', body: { x: 1 } }));
  await clock.advance(600000);
  ok(!st.done, 'BASE 版竟然 settle 了（' + JSON.stringify(st.err && st.err.message) + '）—— 對照組失效，這支守衛在測空氣');
  ok(f.calls.length === 1, 'BASE 版送出的請求數不是 1：' + f.calls.length);
});
await T('⭐⭐⭐ 現行版：同一個黑洞 stub，30 秒必須 abort 並丟出 isOracleTimeout=true 的錯誤', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: Infinity }));
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA', { method: 'PUT', body: { x: 1 } }));
  await clock.advance(29000);
  ok(!st.done, '29 秒就被砍了（預設應為 30 秒）');
  await clock.advance(2000);
  ok(st.done && st.err, '30 秒後仍沒 settle —— 逾時沒生效');
  ok(m.isOracleTimeout(st.err) === true, '逾時錯誤沒有 oracleTimeout 標記：' + st.err.message);
  ok(/連線逾時/.test(st.err.message), 'AbortError 原文沒被特判成人話：' + st.err.message);
  ok(f.calls[0].abortedAt === 30000, '實際 abort 時刻是 ' + f.calls[0].abortedAt + '（預期 30000）');
  ok(f.calls.length === 1, '逾時後又自己重送了（calls=' + f.calls.length + '）—— 會變成每 30 秒砍一次');
});
await T('⭐⭐ 逾時後 UI 一定解得開：oracleApi **reject**（不是永遠 pending）⇒ 呼叫端的 finally 會跑', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: Infinity }));
  const m = loadModule(OC, clock, f);
  let finallyRan = false;
  const st = watch((async () => { try { return await m.oracleApi('/api/rooms/AAAA'); } finally { finallyRan = true; } })());
  await clock.advance(31000);
  ok(finallyRan === true, '呼叫端的 finally 沒有執行 —— 這正是「按了沒反應」的成因');
  ok(st.err && m.isOracleTimeout(st.err), '沒有丟出逾時錯誤');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('③ [正對照] 正常 200ms 回應：修前修後行為完全相同');
// ══════════════════════════════════════════════════════════════════════════
await T('⭐⭐⭐ 200ms 回應：BASE 與現行版的回傳值、fetch 次數、完成時刻完全一致', async () => {
  const plan = () => ({ delayMs: 200, status: 200, body: { room: { _id: 'AAAA', _version: 7 } } });
  const run = async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, plan);
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA'));
    let at = null;
    for (let t = 0; t < 1200 && at === null; t += 50) { await clock.advance(50); if (st.done) at = clock.nowRef(); }
    return { st, at, n: f.calls.length, cleared: clock.cleared.length, live: clock.timers.size };
  };
  const a = await run(baseOC || mutateRemoveTimeout(OC));
  const b = await run(OC);
  ok(!a.st.err && !b.st.err, '正常路徑竟然出錯：' + (a.st.err || b.st.err));
  assert.deepStrictEqual(b.st.value, a.st.value, '正常路徑回傳值變了');
  ok(a.n === 1 && b.n === 1, '正常路徑的請求數變了：BASE=' + a.n + ' 新=' + b.n + ' —— 絕不可多發請求');
  ok(a.at === b.at, '正常路徑變慢了：BASE 在 ' + a.at + 'ms 完成、新版 ' + b.at + 'ms —— 絕不可多等');
  // 突變測試（拿掉 clearTimeout）會在這裡被抓到：成功之後不可以還留著武裝中的計時器
  ok(b.live === 0, '成功回來之後還留著 ' + b.live + ' 顆計時器 —— clearTimeout 沒放在 finally（計時器洩漏）');
  ok(b.cleared >= 1, 'clearTimeout 一次都沒被呼叫');
});
await T('⭐ 正常路徑沒有多任何一次 await：oracleApi 內只有一次 fetch（含 auth 快取命中）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: 10, status: 200, body: { ok: true } }));
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA'));
  await clock.advance(100);
  ok(st.done && !st.err, '沒完成：' + (st.err && st.err.message));
  ok(f.calls.length === 1, 'fetch 被呼叫 ' + f.calls.length + ' 次（預期 1）');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('④ [豁免對照] 40 秒才回的 stub：預設 30s 砍掉、帶 60s 逃生口不可被砍');
// ══════════════════════════════════════════════════════════════════════════
await T('⭐⭐⭐ 40 秒回應：預設(30s)被砍；opts.timeoutMs=60000 必須**成功**（建房／進場／入座／開局）', async () => {
  const plan = () => ({ delayMs: 40000, status: 200, body: { ok: true, version: 2 } });
  const runWith = async (opts) => {
    const clock = makeClock();
    const f = makeFetch(clock, plan);
    const m = loadModule(OC, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA', opts));
    await clock.advance(45000);
    return { st, m };
  };
  const dflt = await runWith({ method: 'PUT', body: { data: {} } });
  ok(dflt.st.err && dflt.m.isOracleTimeout(dflt.st.err), '預設 30 秒沒有把 40 秒的回應砍掉');
  const esc = await runWith({ method: 'PUT', body: { data: {} }, timeoutMs: 60000 });
  ok(!esc.st.err, '帶了 60 秒逃生口卻還是被砍：' + (esc.st.err && esc.st.err.message));
  assert.deepStrictEqual(esc.st.value, { ok: true, version: 2 }, '逃生口路徑的回傳值不對');
});
await T('⭐⭐ oracleUpsertRoom 真的把 opts.timeoutMs 傳給 oracleApi（不是只宣告了參數）', async () => {
  const clock = makeClock();
  const seen = [];
  const f = makeFetch(clock, () => ({ delayMs: 40000, status: 200, body: { ok: true, room: { _id: 'A', updatedAt: 1 } } }));
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleUpsertRoom('aaaa', { x: 1 }, 3, { timeoutMs: 60000 }));
  await clock.advance(45000);
  ok(st.done && !st.err, 'oracleUpsertRoom 的 60 秒逃生口沒接上：' + (st.err && st.err.message));
  const st2 = watch(m.oracleUpsertRoom('aaaa', { x: 1 }, 3));
  await clock.advance(45000);
  ok(st2.err && m.isOracleTimeout(st2.err), '不帶 opts 時沒有退回 30 秒預設');
  void seen;
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑤ [不可破壞] 401 重試 / 204 / 304 / 409');
// ══════════════════════════════════════════════════════════════════════════
await T('⭐⭐⭐ 401 → 重新登入 + 重試一次成功，且第二發用的是**新的、未被 abort 的 signal**', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, (rec, n) => {
    if (rec.url.includes('/api/auth/anonymous')) return { delayMs: 5, status: 200, body: { uid: 'U9', token: 'T9' } };
    return n === 1 ? { delayMs: 5, status: 401, body: 'jwt expired' }
                   : { delayMs: 5, status: 200, body: { room: { _id: 'AAAA' } } };
  });
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA'));
  await clock.advance(200);
  ok(st.done && !st.err, '401 重試路徑壞了：' + (st.err && st.err.message));
  assert.deepStrictEqual(st.value, { room: { _id: 'AAAA' } }, '401 重試後的回傳值不對');
  const api = f.calls.filter((c) => c.url.includes('/api/rooms/'));
  ok(api.length === 2, '401 之後不是重試一次（實際 ' + api.length + ' 次）');
  ok(api[0].signal && api[1].signal, '有一發沒有帶 signal');
  ok(api[0].signal !== api[1].signal, '重試沿用了同一顆 AbortSignal —— 已 abort 的 signal 會讓重試直接死掉');
  ok(api[1].signal.aborted === false, '重試那一發拿到的是已經 abort 的 signal');
});
await T('⭐⭐ 401 重試進行中，**第一發的計時器不可以**再把第二發標成逾時', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, (rec, n) => {
    if (rec.url.includes('/api/auth/anonymous')) return { delayMs: 1, status: 200, body: { uid: 'U9', token: 'T9' } };
    return n === 1 ? { delayMs: 1, status: 401, body: 'x' } : { delayMs: 40000, status: 200, body: { room: {} } };
  });
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA', { timeoutMs: 60000 }));
  await clock.advance(50000);
  ok(st.done && !st.err, '重試那一發被外層計時器誤殺了：' + (st.err && st.err.message));
});
await T('⭐⭐ 204（房間版本未變）仍回 undefined；304 仍丟錯；409 仍把 json 交給 caller', async () => {
  const mk = async (status, body) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: 5, status, body }));
    const m = loadModule(OC, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA'));
    await clock.advance(50);
    return st;
  };
  const s204 = await mk(204, '');
  ok(s204.done && s204.err === undefined && s204.value === undefined, '204 不再回 undefined');
  const s304 = await mk(304, '');
  ok(s304.err && /304/.test(s304.err.message), '304 safety net 壞了');
  ok(!/oracleTimeout/.test(String(s304.err.oracleTimeout)) && s304.err.oracleTimeout !== true, '304 被誤標成逾時');
  const s409 = await mk(409, { conflict: true, currentVersion: 12, room: null });
  assert.deepStrictEqual(s409.value, { conflict: true, currentVersion: 12, room: null }, '409 沒有把 json 交給 caller');
});
await T('⭐⭐ 別人丟的 AbortError **不可**被誤判成逾時（_timedOut 旗標）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: Infinity }));
  // 外部在 1 秒時自己 abort（模擬「別的來源」）：用 fetch 替身直接 reject 一顆 AbortError
  const f2 = (url, init) => new Promise((_res, rej) => {
    f.calls.push({ url, init });
    clock.vSetTimeout(() => { const e = new Error('aborted by someone else'); e.name = 'AbortError'; rej(e); }, 1000);
  });
  f2.calls = f.calls;
  const m = loadModule(OC, clock, f2);
  const st = watch(m.oracleApi('/api/rooms/AAAA'));
  await clock.advance(2000);
  ok(st.err, '沒有丟錯');
  ok(m.isOracleTimeout(st.err) === false, '別人的 AbortError 被誤判成逾時 —— _timedOut 旗標沒生效');
  ok(st.err.name === 'AbortError', '原始錯誤被吃掉了');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑥ [oracleTx] 逾時走既有 409 重試路徑：先重新拉最新盤面，再對新盤面重做');
// ══════════════════════════════════════════════════════════════════════════
function extractBlock(src, startAnchor, endAnchor, minLen, label) {
  const i = src.indexOf(startAnchor);
  assert.ok(i >= 0, '抽不到 ' + label + ' 的起點（錨點：' + startAnchor.slice(0, 48) + '）');
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  assert.ok(j > i, '抽不到 ' + label + ' 的終點');
  const out = src.slice(i, j + endAnchor.length);
  assert.ok(out.length >= minLen, label + ' 只抽到 ' + out.length + ' 字元（下限 ' + minLen + '）—— 抽取器壞了？');
  return out;
}
function loadTx(roSrc, clock) {
  const block = extractBlock(roSrc, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
  const js = esbuild.transformSync(block, { loader: 'ts' }).code;
  const gets = [], puts = [];
  const state = { room: { _id: 'AAAA', _version: 1, gameState: { log: [1] } } };
  const ctx = {
    oracleGetRoom: async (code) => { gets.push({ code, v: state.room._version }); return JSON.parse(JSON.stringify(state.room)); },
    oracleUpsertRoom: null, // 由情境注入
    isOracleTimeout: (e) => !!(e && e.oracleTimeout === true),
    // ⭐v6.246 新增：oracleTx 用它判「這個逾時是因為 body 大而放寬過預算的那種」
    isOracleUploadBudgetTimeout: (e) => !!(e && e.oracleUploadBudget === true),
  };
  const make = (upsert) => {
    ctx.oracleUpsertRoom = async (code, data, ver, opts) => { puts.push({ code, data, ver, opts }); return upsert(puts.length, data, ver, opts); };
    return new Function('oracleGetRoom', 'oracleUpsertRoom', 'isOracleTimeout', 'isOracleUploadBudgetTimeout', 'setTimeout',
      js + '\n;return oracleTx;')(
      (c) => ctx.oracleGetRoom(c), (a, b, c, d) => ctx.oracleUpsertRoom(a, b, c, d), ctx.isOracleTimeout,
      ctx.isOracleUploadBudgetTimeout, clock.vSetTimeout);
  };
  return { make, gets, puts, state };
}
const TO = () => { const e = new Error('連線逾時（30 秒沒有回應）'); e.oracleTimeout = true; return e; };

await T('⭐⭐⭐ PUT 逾時 → **重新拉最新盤面**再對新盤面重做（不是原樣重送同一包）', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const seenIn = [];
  const oracleTx = tx.make((n) => { if (n === 1) { tx.state.room = { _id: 'AAAA', _version: 9, gameState: { log: [1, 2, 3] } }; throw TO(); } return { ok: true, room: tx.state.room }; });
  const st = watch(oracleTx('AAAA', (d) => { seenIn.push(d._version); return { ...d, touched: true }; }));
  await clock.advance(5000);
  ok(st.done && !st.err, 'oracleTx 沒有從逾時中復原：' + (st.err && st.err.message));
  ok(tx.gets.length === 2, '逾時後沒有重新拉盤面（GET 次數 ' + tx.gets.length + '，預期 2）');
  assert.deepStrictEqual(seenIn, [1, 9], 'fn 不是對**新**盤面重跑（看到的版本序列 ' + JSON.stringify(seenIn) + '）');
  ok(tx.puts[1].ver === 9, '第二發 PUT 帶的 expectedVersion 還是舊的：' + tx.puts[1].ver);
});
await T('⭐⭐⭐ 次數上限：連續逾時最多只吃掉 1 次重試（PUT 恰好 2 次）就把錯誤丟給呼叫端＝解鎖 UI', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make(() => { throw TO(); });
  const st = watch(oracleTx('AAAA', (d) => ({ ...d, touched: true })));
  await clock.advance(30000);
  ok(st.done && st.err, '連續逾時竟然沒有把錯誤丟出來 —— UI 會一直鎖著');
  ok(st.err.oracleTimeout === true, '丟出來的不是逾時錯誤：' + st.err.message);
  ok(tx.puts.length === 2, 'PUT 送了 ' + tx.puts.length + ' 次（上限應為 2）—— 自我重呼叫失控');
});
await T('⭐⭐ 退避：逾時重試前有等待（不是立刻重送）', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make((n) => { if (n === 1) throw TO(); return { ok: true, room: tx.state.room }; });
  const st = watch(oracleTx('AAAA', (d) => d));
  await clock.advance(100);
  ok(tx.puts.length === 1, '逾時後 100ms 內就重送了 —— 沒有退避');
  await clock.advance(2000);
  ok(st.done && !st.err, '退避之後沒有完成：' + (st.err && st.err.message));
});
await T('⭐⭐ 409 conflict 的既有路徑逐字不變：仍重試 5 次、退避 50/100/150/200ms', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make(() => ({ conflict: true, currentVersion: 3, room: null }));
  const st = watch(oracleTx('AAAA', (d) => d));
  await clock.advance(5000);
  ok(st.err && /max retries exhausted/.test(st.err.message), '409 用盡重試後的錯誤變了：' + (st.err && st.err.message));
  ok(tx.puts.length === 5, '409 的重試次數變了：' + tx.puts.length + '（應為 5）');
  ok(tx.gets.length === 5, '409 每一輪都必須重新拉盤面，實際 GET ' + tx.gets.length + ' 次');
});
await T('⭐⭐ 非逾時的例外（例如網路 5xx）**不吃**逾時額度，直接往上拋（行為與 v6.244 相同）', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make(() => { throw new Error('oracleApi /api/rooms/AAAA → 500: boom'); });
  const st = watch(oracleTx('AAAA', (d) => d));
  await clock.advance(5000);
  ok(st.err && /500/.test(st.err.message), '一般錯誤沒有原樣往上拋：' + (st.err && st.err.message));
  ok(tx.puts.length === 1, '一般錯誤竟然被重送了 ' + tx.puts.length + ' 次');
});
await T('⭐ opts.timeoutMs 從 oracleTx 一路傳到 oracleUpsertRoom（進場/入座/開局的逃生口）', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make(() => ({ ok: true, room: tx.state.room }));
  const st = watch(oracleTx('AAAA', (d) => d, { timeoutMs: 60000 }));
  await clock.advance(100);
  ok(st.done && !st.err, 'oracleTx 帶 opts 時壞了');
  assert.deepStrictEqual(tx.puts[0].opts, { timeoutMs: 60000 }, 'opts 沒傳到 oracleUpsertRoom：' + JSON.stringify(tx.puts[0].opts));
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑦ [pushWithRetry] 逾時不原樣重送 40~48KB；一般錯誤仍重試 3 次');
// ══════════════════════════════════════════════════════════════════════════
function loadPushWithRetry(gpSrc, clock) {
  const block = extractBlock(gpSrc, '  const PUSH_RETRY_MAX = 3;', '\n    return false;\n  }', 500, 'pushWithRetry');
  const js = esbuild.transformSync(block.replace(/: GameState/g, '').replace(/: string/g, '').replace(/: Promise<boolean>/g, ''),
    { loader: 'ts' }).code;
  assert.ok(/isOracleTimeout\(/.test(block), 'pushWithRetry 內沒有 isOracleTimeout 判別 —— 逾時仍會原樣重送');
  const pushes = [];
  const make = (impl) => {
    const box = { _unpushedState: null, _repushAttempts: 0 };
    // ⭐v6.261 抽取視窗（PUSH_RETRY_MAX → pushWithRetry 結尾）含 pushTracked／pushUndoTracked，
    //   而它們的 finally 多了一行休閒遙測 `_casualRecordPush()`。這裡注入 no-op：
    //   ⚠ 少了它會是**最會誤導人的失敗**——ReferenceError 被 pushWithRetry 的 catch 吞掉，
    //     看起來像「逾時後竟然重送了 3 次」（實測本版就先踩過一次）。
    //   遙測本身由 scripts/test-v6261-casual-clientdiag.mjs 實跑驗證，這裡只要它不擋路。
    const fn = new Function('pushGameState', 'isOracleTimeout', 'console', 'setTimeout', 'box', '_casualRecordPush',
      'let _unpushedState = null, _repushAttempts = 0;\n' + js +
      '\n;return { fn: pushWithRetry, get u() { return _unpushedState; }, get r() { return _repushAttempts; } };')(
      async (c, s) => { pushes.push({ c, s }); return impl(pushes.length); },
      (e) => !!(e && e.oracleTimeout === true),
      { warn() {}, error() {} }, clock.vSetTimeout, box, () => {});
    return fn;
  };
  return { make, pushes };
}
await T('⭐⭐⭐ 逾時 ⇒ pushGameState 只送 1 次（不原樣重送）；一般錯誤 ⇒ 仍送 3 次', async () => {
  const clock = makeClock();
  const a = loadPushWithRetry(GP, clock);
  const h1 = a.make(() => { throw TO(); });
  const st1 = watch(h1.fn('AAAA', { id: 'g1' }));
  await clock.advance(5000);
  ok(st1.done && st1.value === false, '逾時路徑沒回 false');
  ok(a.pushes.length === 1, '逾時後仍重送了 ' + a.pushes.length + ' 次 —— 4.4kbps 玩家會被每 30 秒砍一次');

  const clock2 = makeClock();
  const b = loadPushWithRetry(GP, clock2);
  const h2 = b.make(() => { throw new Error('500: boom'); });
  const st2 = watch(h2.fn('AAAA', { id: 'g1' }));
  await clock2.advance(5000);
  ok(st2.done && st2.value === false, '一般錯誤路徑沒回 false');
  ok(b.pushes.length === 3, '一般錯誤的重試次數變了：' + b.pushes.length + '（v6.212 起是 3）');
});
await T('⭐ 成功路徑不變：第一發就成功 ⇒ 只送 1 次且回 true', async () => {
  const clock = makeClock();
  const a = loadPushWithRetry(GP, clock);
  const h = a.make(() => undefined);
  const st = watch(h.fn('AAAA', { id: 'g1' }));
  await clock.advance(100);
  ok(st.done && st.value === true, '成功路徑回傳值變了：' + JSON.stringify(st.value));
  ok(a.pushes.length === 1, '成功路徑送了 ' + a.pushes.length + ' 次');
});
await T('⭐⭐ 逾時後靠**既有**自癒收斂：decideStuckSelfHeal 在額度用完時走 force-adopt（拉最新盤面讓玩家重做）', () => {
  const sg = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
  const block = extractBlock(sg, 'export function decideStuckSelfHeal(', '\n}', 120, 'decideStuckSelfHeal');
  const js = esbuild.transformSync(block.replace('export ', ''), { loader: 'ts' }).code;
  const f = new Function(js + '\n;return decideStuckSelfHeal;')();
  assert.deepStrictEqual(f({ hasUnpushedLocal: true, repushAttempts: 0 }), { kind: 'repush' }, '本地領先時應先重推');
  assert.deepStrictEqual(f({ hasUnpushedLocal: true, repushAttempts: 2 }), { kind: 'force-adopt' }, '重推額度用完應 force-adopt');
  assert.deepStrictEqual(f({ hasUnpushedLocal: false, repushAttempts: 0 }), { kind: 'force-adopt' }, '沒有未推送的手應直接拉最新盤面');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑧ [突變測試] 逾時值改 0 / 拿掉 clearTimeout / 拿掉 _timedOut 判別 / 拿掉 signal');
// ══════════════════════════════════════════════════════════════════════════
// ⭐⭐⭐v6.246 弱點修正（獨立審查者【問題5】之一）：原本這裡是**無差別 try/catch**，
//   任何例外都被算成「突變被抓到」。實測：把 esbuild 換成平台不符的版本（沙盒裡就會發生），
//   M1~M4 **全部假 OK** —— 突變測試無聲變成安慰劑（IRON_RULES Rule 25 同型）。
//   ⇒ 兩道修正：
//     (1) **基準線必須先綠**：同一個 probe 先跑**未突變**的原始碼，它必須通過。
//         工具鏈壞掉（esbuild 平台不符 / 抽取器壞掉 / 少注入相依）時基準線會先紅，
//         而不是讓突變測試假 OK。
//     (2) **紅在預期的那一條**：突變後丟出來的訊息必須符合 expectRe，
//         不可以是「隨便一個例外」（例如 `X is not defined`、`Transform failed`）。
const TOOLCHAIN_RE = /Transform failed|esbuild|is not defined|is not a function|Cannot read|ENOENT|另一個平台|another platform/i;
async function mutantMustBreak(label, mutate, probe, expectRe) {
  ok(expectRe instanceof RegExp, '突變 ' + label + ' 沒有給「預期紅在哪一條」的樣式');
  const src = mutate(OC);
  ok(src !== OC, '突變 ' + label + ' 沒有真的改到原始碼 —— 突變測試在測空氣');
  // (1) 基準線：未突變的原始碼跑同一個 probe 必須通過
  try {
    await probe(OC);
  } catch (e) {
    throw new Error('突變「' + label + '」的**基準線**就紅了（' + e.message
      + '）—— 這代表工具鏈或 probe 壞掉，突變測試在測空氣，不是在測突變');
  }
  // (2) 突變後必須紅，且紅在預期的那一條
  let broke = false, why = '';
  try { await probe(src); } catch (e) { broke = true; why = e.message; }
  ok(broke, '突變「' + label + '」竟然通過了 —— 對應的守衛是安慰劑');
  ok(!TOOLCHAIN_RE.test(why),
    '突變「' + label + '」紅的是**工具鏈錯誤**而不是被測行為：' + why);
  ok(expectRe.test(why),
    '突變「' + label + '」紅在別條斷言上（預期 ' + expectRe + '）：' + why);
  return why;
}
await T('⭐⭐⭐ M1 逾時值改成 0 ⇒ 正對照（200ms 正常回應）必須翻紅', async () => {
  await mutantMustBreak('ORACLE_API_TIMEOUT_MS = 0', (s) => s.replace('ORACLE_API_TIMEOUT_MS = 30000', 'ORACLE_API_TIMEOUT_MS = 0'), async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: 200, status: 200, body: { room: {} } }));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA'));
    await clock.advance(1000);
    ok(st.done && !st.err, '正常 200ms 的請求被砍了：' + (st.err && st.err.message));
  }, /正常 200ms 的請求被砍了/);
});
await T('⭐⭐⭐ M2 拿掉 finally 的 clearTimeout ⇒ 「計時器洩漏」斷言必須翻紅', async () => {
  await mutantMustBreak('remove clearTimeout(_to) in finally',
    (s) => s.replace('  } finally {\n    // ⚠ 一定要在 finally：少了它，每一發成功的請求都留一顆計時器（洩漏）。\n    clearTimeout(_to);\n  }', '  }'),
    async (src) => {
      const clock = makeClock();
      const f = makeFetch(clock, () => ({ delayMs: 200, status: 200, body: { room: {} } }));
      const m = loadModule(src, clock, f);
      const st = watch(m.oracleApi('/api/rooms/AAAA'));
      await clock.advance(500);
      ok(st.done && !st.err, '沒完成');
      ok(clock.timers.size === 0, '成功回來之後還留著 ' + clock.timers.size + ' 顆計時器 —— clearTimeout 沒放在 finally');
    }, /顆計時器/);
});
await T('⭐⭐⭐ M3 拿掉 _timedOut 判別 ⇒ 「別人的 AbortError 被誤判成逾時」必須翻紅', async () => {
  // ⚠v6.246：這一行在 oracleAuth 與 oracleApi **各有一份**，字串版 replace 只會換掉第一個
  //   （＝ oracleAuth），probe 測的卻是 oracleApi ⇒ 突變會「存活」。改用全域替換。
  await mutantMustBreak('drop _timedOut guard', (s) => s.replaceAll('if (_timedOut && _isAbortError(e))', 'if (_isAbortError(e))'), async (src) => {
    const clock = makeClock();
    const calls = [];
    const f2 = (url) => new Promise((_r, rej) => { calls.push(url); clock.vSetTimeout(() => { const e = new Error('someone else'); e.name = 'AbortError'; rej(e); }, 1000); });
    const m = loadModule(src, clock, f2);
    const st = watch(m.oracleApi('/api/rooms/AAAA'));
    await clock.advance(2000);
    ok(m.isOracleTimeout(st.err) === false, '別人的 AbortError 被誤判成逾時');
  }, /被誤判成逾時/);
});
await T('⭐⭐⭐ M4 fetch 不帶 signal ⇒ HEAD-FAIL（黑洞掛住）必須翻紅', async () => {
  await mutantMustBreak('drop signal from fetch', (s) => s.replace('\n      cache: \'no-store\',\n      signal: _ac.signal,', '\n      cache: \'no-store\','), async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: Infinity }));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA'));
    await clock.advance(60000);
    ok(st.done && st.err && m.isOracleTimeout(st.err), '黑洞沒有被逾時砍掉');
  }, /黑洞沒有被逾時砍掉/);
});
await T('⭐⭐ M5 oracleTx 的逾時重試上限改成 5 ⇒ 「PUT 恰好 2 次」必須翻紅', async () => {
  const src = RO.replace('const TX_TIMEOUT_RETRY_MAX = 1;', 'const TX_TIMEOUT_RETRY_MAX = 5;');
  ok(src !== RO, '突變沒改到東西');
  const clock = makeClock();
  const tx = loadTx(src, clock);
  const oracleTx = tx.make(() => { throw TO(); });
  const st = watch(oracleTx('AAAA', (d) => d));
  await clock.advance(60000);
  void st;
  ok(tx.puts.length !== 2, '突變後 PUT 仍是 2 次 —— 上限斷言是安慰劑');
});

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' v6.245 oracleApi 逾時守衛：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
