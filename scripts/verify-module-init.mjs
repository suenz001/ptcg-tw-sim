#!/usr/bin/env node
/**
 * verify-module-init — 真正「執行」vite/rollup build 產物，抓 module-init 期崩潰(尤其循環相依 TDZ)。
 *
 * 背景(v5.989 事故)：engine.ts 反向 import 卡檔 → 循環相依 → rollup 模組初始化順序 TDZ →
 *   對戰頁白屏。node 測試(esbuild bundle 初始化順序不同)+ deploy 綠(vite build 只打包不執行)皆抓不到。
 *   本 script 直接 import 正式 build 產物、逐一執行每個 route 的 chunk(app.nodes[i]()),以與正式站
 *   完全相同的 ESM 初始化語意重現模組圖 → 任何 module-init throw(含 TDZ)即 fail。
 *
 * 用法：先 `npm run build`,再 `node scripts/verify-module-init.mjs`(deploy.yml 於 build 後、upload 前跑)。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ── 極小 DOM/瀏覽器 shim(ssr=false SPA 難免 module-scope 摸 DOM;缺什麼補這裡,禁改用忽略清單)──
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop, addEventListener: noop,
  removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
  children: [], dataset: {} });
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;
globalThis.document ??= {
  addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, createElement: el, createElementNS: el, createTextNode: () => ({}),
  head: el(), body: el(), documentElement: el(), cookie: '', title: '', readyState: 'complete',
  visibilityState: 'visible', location: { href: 'http://localhost/', pathname: '/', search: '', hash: '' },
};
globalThis.navigator ??= { userAgent: 'node-verify-module-init', serviceWorker: undefined, language: 'zh-TW', onLine: true };
globalThis.location ??= document.location;
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop, clear: noop, key: () => null, length: 0 };
globalThis.sessionStorage ??= globalThis.localStorage;
globalThis.matchMedia ??= () => ({ matches: false, media: '', addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
globalThis.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame ??= noop;
globalThis.scrollTo ??= noop;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { define: noop, get: () => undefined };
globalThis.CSS ??= { supports: () => false, escape: (s) => s };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMM = join(ROOT, 'build/_app/immutable');
function findEntry() {
  const entryDir = join(IMM, 'entry');
  let dir; try { dir = readdirSync(entryDir); } catch { throw new Error(`找不到 build/_app/immutable/entry — 先跑 npm run build`); }
  const app = dir.find((f) => /^app\..*\.js$/.test(f));
  if (!app) throw new Error('entry 目錄找不到 app.*.js');
  return join(entryDir, app);
}

const t0 = Date.now();
let appEntry;
try { appEntry = findEntry(); } catch (e) { console.error('❌ verify-module-init:', e.message); process.exit(1); }

const app = await import(pathToFileURL(appEntry).href);
if (!Array.isArray(app.nodes)) {
  console.error('❌ verify-module-init: app.nodes 不是陣列(SvelteKit 結構變更?);keys=' + Object.keys(app).join(','));
  process.exit(1);
}

let ok = 0; const failures = [];
for (let i = 0; i < app.nodes.length; i++) {
  const load = app.nodes[i];
  if (typeof load !== 'function') { ok++; continue; }
  try { await load(); ok++; }
  catch (err) {
    const msg = String(err && (err.stack || err.message || err));
    failures.push({ i, msg });
  }
}

if (failures.length === 0) {
  console.log(`✅ verify-module-init：${ok} 個 route node 模組初始化全部成功（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  process.exit(0);
}
console.error(`❌ verify-module-init：${failures.length} 個 route node 在模組初始化時拋錯（build 綠 ≠ 能跑！）\n`);
for (const f of failures) {
  console.error(`  node[${f.i}]: ${f.msg.slice(0, 500)}`);
  if (/Cannot access .+ before initialization/.test(f.msg)) {
    console.error(`    ⚠ 這是 module-init 循環相依 TDZ！多半是底層模組(engine/effects)反向 import 卡檔造成的初始化順序問題。`);
    console.error(`    → 查最近新增/改動的 import 方向；把 helper 下沉 _shared/leaf；禁 revert 亂槍。見 feedback-build-fail-debug-lessons ⑧。`);
  }
}
process.exit(1);
