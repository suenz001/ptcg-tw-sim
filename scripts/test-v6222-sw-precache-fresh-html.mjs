// v6.222 守衛：SW install 預快取 HTML 必須**強制回源**（cache:'reload'），舊版 HTML 不得被存進 precache。
//
// 真實事故（站長手機實測，2026-08-23）：按「強制更新版本」→ 變 6.221 → 關閉 App 再開 → 退回 6.219。
//   根因鏈：正式站 `/` 等 HTML 回應**沒有 Cache-Control** ⇒ 瀏覽器套啟發式新鮮度（RFC 9111 §4.2.2）；
//   `cache.add(url)` 功能等同 `fetch(url)` ＋ `cache.put`（MDN Cache.add），fetch 預設 cache 模式
//   會**先查瀏覽器 HTTP 快取** ⇒ 新版 SW install 把 HTTP 快取裡的舊首頁存進新 cache ⇒
//   冷啟動 cache-first 回舊 HTML → 舊 chunk hash → 版本退回。hardRefreshNow() 清得掉 Cache API、
//   清不掉 HTTP 快取，所以「強制更新一下子有效，重開又變舊」。
//
// 本守衛是**行為級**（v6.154 教訓：只驗字串存在擋不住「接線沒接上」）：
//   用 esbuild 把 src/service-worker.ts 打包成可在 Node 執行的 bundle，接上：
//   ① 假的 ServiceWorkerGlobalScope（攔 install listener）
//   ② 假的 Cache API（add() 依規範等同 fetch→put）
//   ③ **假的瀏覽器 HTTP 快取層**：cache 模式不是 'reload'/'no-cache'/'no-store' 就回「舊版內容」
//   然後真的 dispatch install，斷言存進 precache 的是新版內容、發出的 Request.cache === 'reload'。
//   最後做**突變測試**：把 cache:'reload' 改掉重跑，斷言假 HTTP 快取層真的會下毒（守衛必須抓得到）。
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW_SRC_PATH = join(ROOT, 'src/service-worker.ts');
const TMP = mkdtempSync(join(tmpdir(), 'sw-guard-'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ── $service-worker 虛擬模組（涵蓋所有策略維度的最小樣本）────────────────────────
//   build＝hash 命名不可變資源；files＝static/（含重媒體與一個會 fetch 失敗的檔）；
//   prerendered＝HTML（含 /card/ SEO 頁，v5.966 不可預快取）。
const STUB_SW_MODULE = `
export const build = ['/_app/immutable/entry/app.abc123.js'];
export const files = ['/manifest.json', '/cards/data.json', '/covers/big.png', '/music/bgm.mp3', '/changelog-archive.html', '/fail-on-purpose'];
export const prerendered = ['/', '/tournament', '/cards', '/sitemap-cards.xml', '/card/14086/', '/card/14086/__data.json'];
export const version = 'guardver';
`;

async function bundleSW(sourceText, tag) {
  const entry = join(TMP, `sw-${tag}.ts`);
  writeFileSync(entry, sourceText);
  const stub = join(TMP, `stub-${tag}.js`);
  writeFileSync(stub, STUB_SW_MODULE);
  const out = join(TMP, `sw-${tag}.bundle.mjs`);
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true, format: 'esm', platform: 'neutral', target: 'node18',
    alias: { '$service-worker': stub, '$lib': join(ROOT, 'src/lib') },
    logLevel: 'error',
  });
  return out;
}

// ── 假環境：SW global ＋ Cache API ＋ 假 HTTP 快取層 ─────────────────────────────
const ORIGIN = 'https://sim.test';
// 「瀏覽器 HTTP 快取」：這些路徑存有**舊版**內容（無 Cache-Control ⇒ 啟發式仍新鮮）。
// 對 hash 命名的 build 資源而言，HTTP 快取命中是正確且省流量的（內容不可變）。
const HTTP_CACHE = new Map([
  ['/', 'OLD_HTML_v6219'],
  ['/tournament', 'OLD_HTML_v6219_T'],
  ['/cards', 'OLD_HTML_v6219_C'],
  ['/_app/immutable/entry/app.abc123.js', 'IMMUTABLE_JS'],
  ['/cards/data.json', 'CACHED_JSON_WITHIN_MAXAGE'],
  ['/sitemap-cards.xml', 'CACHED_SITEMAP_563KB'],
]);
const BYPASS_MODES = new Set(['reload', 'no-cache', 'no-store']);

async function runInstall(bundlePath, { throwingRequest = false } = {}) {
  const fetchLog = [];
  const OrigRequest = globalThis.Request;
  async function httpFetch(req) {
    const path = new URL(req.url).pathname;
    fetchLog.push({ path, cacheMode: req.cache });
    if (path === '/fail-on-purpose') throw new TypeError('network fail');
    if (!BYPASS_MODES.has(req.cache) && HTTP_CACHE.has(path)) {
      return new Response(HTTP_CACHE.get(path), { status: 200 }); // 走 HTTP 快取＝可能是舊版
    }
    return new Response('FRESH:' + path, { status: 200 });
  }
  const store = new Map();
  const fakeCache = {
    // 規範語義：add(request) ≡ fetch(request) 成功後 put（MDN Cache.add）
    async add(info) {
      const req = info instanceof OrigRequest
        ? info
        : new OrigRequest(new URL(String(info), ORIGIN).href);
      const res = await httpFetch(req);
      if (!res || res.status !== 200) throw new TypeError('bad response');
      store.set(new URL(req.url).pathname, await res.text());
    },
    async match() { return undefined; },
    async put() {},
  };
  const listeners = {};
  globalThis.self = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    skipWaiting: () => { globalThis.__skipWaiting = true; },
    location: new URL(ORIGIN + '/service-worker.js'),
    registration: { scope: ORIGIN + '/' },
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  globalThis.caches = {
    open: async () => fakeCache,
    keys: async () => [],
    delete: async () => true,
    match: async () => undefined,
  };
  globalThis.__skipWaiting = false;
  if (throwingRequest) {
    // 模擬「不支援 RequestInit.cache 而丟例外」的舊瀏覽器：install 仍不得掛掉
    globalThis.Request = class {
      constructor(url, init) {
        if (init && 'cache' in init) throw new TypeError('cache option unsupported');
        return new OrigRequest(url, init);
      }
    };
  }
  try {
    await import(pathToFileURL(bundlePath).href + '?t=' + Date.now());
    assert.ok(listeners.install && listeners.install.length === 1, 'install listener 應恰好註冊 1 個');
    const ev = { waitUntil(p) { this._p = p; } };
    for (const fn of listeners.install) fn(ev);
    await ev._p; // allSettled 語義下必須 resolve；reject 即 install 失敗（v5.354 事故）
  } finally {
    globalThis.Request = OrigRequest;
  }
  return { fetchLog, store, skipWaiting: globalThis.__skipWaiting };
}

const SRC = readFileSync(SW_SRC_PATH, 'utf8');
const bundleMain = await bundleSW(SRC, 'main');
const main = await runInstall(bundleMain);

// ── 主守衛（在 v6.221 BASE 上必須紅：HEAD-FAIL）────────────────────────────────
T('掃描器自驗：install 有真的跑、抓了足夠多的資源（下限斷言，Rule 25）', () => {
  assert.ok(main.fetchLog.length >= 5, `只發出 ${main.fetchLog.length} 個請求，harness 壞了？`);
  assert.ok(main.store.size >= 5, `precache 只存了 ${main.store.size} 筆`);
  assert.ok(main.skipWaiting, 'skipWaiting 不見了（v6.221 既有行為）');
});

T('⭐⭐⭐prerendered HTML 必須以 cache:\'reload\' 強制回源（Request 行為層，非字串）', () => {
  for (const p of ['/', '/tournament', '/cards']) {
    const hit = main.fetchLog.find((e) => e.path === p);
    assert.ok(hit, `install 沒抓 ${p}`);
    assert.equal(hit.cacheMode, 'reload',
      `${p} 的 Request.cache 是 '${hit.cacheMode}' —— cache.add 預設會吃瀏覽器 HTTP 快取的舊 HTML`);
  }
});

T('⭐⭐⭐舊版 HTML 不得被存進 precache（假 HTTP 快取層有舊版時仍須存到新版）', () => {
  for (const p of ['/', '/tournament', '/cards']) {
    const got = main.store.get(p);
    assert.equal(got, 'FRESH:' + p,
      `${p} 存進 precache 的是 '${String(got).slice(0, 30)}' —— 舊版 HTML 進了新 cache，冷啟動會退版`);
  }
});

T('⭐build（hash 不可變）不得強制回源 —— 保留 HTTP 快取、install 不多花流量', () => {
  const hit = main.fetchLog.find((e) => e.path === '/_app/immutable/entry/app.abc123.js');
  assert.ok(hit, 'build 資源沒被預快取');
  assert.notEqual(hit.cacheMode, 'reload', 'hash 命名資源強制回源＝每天白抓 ~9MB');
  assert.equal(main.store.get('/_app/immutable/entry/app.abc123.js'), 'IMMUTABLE_JS');
});

T('⭐files（cards JSON 等）沿用預設語義 —— 不因本修而多抓 ~4MB', () => {
  const hit = main.fetchLog.find((e) => e.path === '/cards/data.json');
  assert.ok(hit, '/cards/data.json 沒被預快取');
  assert.notEqual(hit.cacheMode, 'reload');
});

T('⭐/sitemap-cards.xml（563KB 爬蟲用）不得強制回源 —— install 不多抓 563KB', () => {
  const hit = main.fetchLog.find((e) => e.path === '/sitemap-cards.xml');
  assert.ok(hit, 'sitemap 應照舊被預快取（維持 v6.221 行為）');
  assert.notEqual(hit.cacheMode, 'reload', 'sitemap 不是 app 殼層，強制回源只是白花流量');
});

T('⭐v5.966／v5.365／v6.100 策略不可破壞：/card/、covers、music、changelog-archive 不預快取', () => {
  for (const p of ['/card/14086/', '/card/14086/__data.json', '/covers/big.png', '/music/bgm.mp3', '/changelog-archive.html']) {
    assert.ok(!main.fetchLog.some((e) => e.path === p), `${p} 不該在 install 被抓`);
    assert.ok(!main.store.has(p), `${p} 不該進 precache`);
  }
});

T('⭐v5.354 容錯不可破壞：單一 URL fetch 失敗不得讓整個 install 失敗', () => {
  // runInstall 已 await waitUntil：走到這裡代表 install resolve 了；再驗其他檔案照常入庫
  assert.ok(!main.store.has('/fail-on-purpose'), '失敗的 URL 不該入庫');
  assert.equal(main.store.get('/manifest.json'), 'FRESH:/manifest.json', '其他檔案應照常入庫');
});

// ── 舊瀏覽器退路：RequestInit.cache 丟例外時 install 仍須成功（退回 v6.221 語義）──
const legacy = await runInstall(bundleMain, { throwingRequest: true });
T('⭐不支援 cache 選項的舊瀏覽器：install 不得掛掉（退回預設語義）', () => {
  assert.ok(legacy.store.has('/'), '舊瀏覽器下首頁仍應被預快取');
});

// ── 突變測試（正對照）：拿掉 cache:\'reload\' → 假 HTTP 快取層必須真的下毒 ─────────
const MUTATED = SRC.replace(/cache:\s*(['"])reload\1/g, "cache: 'default'");
if (MUTATED === SRC) {
  // BASE（v6.221）本來就沒有 reload —— 主守衛已紅，突變測試不適用
  console.log('SKIP 突變測試：來源沒有 cache:\'reload\'（HEAD-FAIL 情境）');
} else {
  const mut = await runInstall(await bundleSW(MUTATED, 'mutated'));
  T('⭐⭐突變測試：拿掉 reload 後，假 HTTP 快取層必須觀察到舊版被下毒（證明守衛抓得到）', () => {
    assert.equal(mut.store.get('/'), 'OLD_HTML_v6219',
      '突變後 precache 竟然還是新版 —— 假 HTTP 快取層失效，主守衛是安慰劑');
    const hit = mut.fetchLog.find((e) => e.path === '/');
    assert.notEqual(hit.cacheMode, 'reload', '突變沒生效');
  });
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
