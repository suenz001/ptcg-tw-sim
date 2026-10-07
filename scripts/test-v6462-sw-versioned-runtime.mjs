#!/usr/bin/env node
/**
 * v6.462 守衛：帶 ?v=版本 的資料檔（卡包 JSON／card-set-map／changelog.html／ai-playbooks）
 *   ① install **不再**預快取（原本存的是無 query 的鍵，前端永遠帶 ?v= 來抓 ⇒ 從沒命中，純白工 551KB gzip）
 *   ② 執行期行為與 v6.461 以前**完全相同**：第一次 network 並寫入、同 URL 第二次 cache-first 零請求
 *
 * 由來：fable 5.1 獨立審查＋本機 Playwright 實測（2026-10-01）：
 *   precache 裡有 /cards/M2.json，fetch('/cards/M2.json?v=6.461') 照樣打回伺服器；第二次 fetch 0 個請求（由執行期寫入命中）。
 *
 * 作法（行為級，比照 test-v6222）：esbuild 打包真的 src/service-worker.ts，接假 SW global、假 Cache API
 *   （match 依規範**連 query 一起比**）、假網路；真的 dispatch install 與 fetch 事件。
 *
 *   A1 install 不抓任何版本化資料檔（cards／card-set-map／changelog.html／ai-playbooks）
 *   A2 install 照舊抓 app 本體（build、manifest、首頁 HTML）—— 沒有把 precache 整個拿掉
 *   B1 /cards/X.json?v=1 第一次：打網路並寫入快取
 *   B2 同 URL 第二次：**0 個網路請求**（cache-first）
 *   B3 card-set-map／changelog.html／ai-playbooks 同上
 *   B4 版本變了（?v=2）：打網路（不會拿到舊版資料）
 *   B5 沒有 v 參數：network-first（每次打網路；不會被永久快取釘住）
 *   B6 離線時：同 URL 已快取 ⇒ 回快取
 *   H  HEAD-FAIL：v6.461 的 SW 在 install 會抓 /cards/X.json（無 query）——本版要修掉的白工
 *   突變（實跑）：M1 拿掉 cache-first 的 VERSIONED_DATA 條件 ⇒ B2 紅；M2 拿掉 searchParams.has('v') ⇒ B5 紅
 *
 * Run: node scripts/test-v6462-sw-versioned-runtime.mjs
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.461。
const BASE_SHA = '1a01b4a5687ada08a2a16706ce958b1ec7839a86';
const SW_PATH = 'src/service-worker.ts';
const TMP = mkdtempSync(join(tmpdir(), 'sw6462-'));
const ORIGIN = 'https://sim.test';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const STUB = `
export const build = ['/_app/immutable/entry/app.abc.js'];
export const files = ['/manifest.json', '/icons/icon-192.png', '/cards/index.json', '/cards/M2.json', '/cards/SV9.json', '/card-set-map.json', '/changelog.html', '/changelog-bodies.html', '/ai-playbooks/x.json', '/covers/a.png'];
export const prerendered = ['/', '/tournament'];
export const version = 'g6462';
`;

let seq = 0;
async function bundle(src) {
  const tag = String(++seq);
  const entry = join(TMP, `sw${tag}.ts`); writeFileSync(entry, src);
  const stub = join(TMP, `stub${tag}.js`); writeFileSync(stub, STUB);
  const out = join(TMP, `sw${tag}.mjs`);
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'neutral', target: 'node18',
    alias: { '$service-worker': stub, '$lib': join(ROOT, 'src/lib') }, logLevel: 'error' });
  return out;
}

// 假環境：Cache API（match 比完整 URL，含 query —— 規範預設 ignoreSearch:false）＋ 假網路
async function boot(bundlePath) {
  const net = []; let offline = false;
  const store = new Map();
  const keyOf = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  globalThis.fetch = async (r) => {
    const u = keyOf(r); net.push(u.replace(ORIGIN, ''));
    if (offline) throw new TypeError('offline');
    return new Response('BODY:' + u, { status: 200 });
  };
  const cache = {
    async add(r) { const res = await globalThis.fetch(r); store.set(keyOf(r), await res.text()); },
    async put(r, res) { store.set(keyOf(r), await res.text()); },
    async match(r) { const k = keyOf(r); return store.has(k) ? new Response(store.get(k)) : undefined; },
  };
  const listeners = {};
  globalThis.self = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    skipWaiting: () => {}, location: new URL(ORIGIN + '/service-worker.js'),
    registration: { scope: ORIGIN + '/' }, clients: { claim: async () => {}, matchAll: async () => [] },
  };
  globalThis.caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async (r) => cache.match(r) };
  await import(pathToFileURL(bundlePath).href + '?t=' + Date.now() + seq);
  const ev = { waitUntil(p) { this._p = p; } };
  for (const fn of listeners.install) fn(ev);
  await ev._p;
  const installNet = net.splice(0);
  async function get(path) {
    const req = new Request(ORIGIN + path);
    let resp; const fe = { request: req, respondWith(p) { resp = p; } };
    const before = net.length;
    for (const fn of listeners.fetch) fn(fe);
    if (!resp) return { bypass: true, net: 0 };
    let body = null; try { body = await (await resp).text(); } catch { body = null; }
    return { body, net: net.length - before };
  }
  return { installNet, get, setOffline: (v) => { offline = v; } };
}

const VERSIONED = ['/cards/index.json', '/cards/M2.json', '/cards/SV9.json', '/card-set-map.json', '/changelog.html', '/ai-playbooks/x.json'];
const SRC = readFileSync(join(ROOT, SW_PATH), 'utf8');

async function runMain(src, label) {
  const sw = await boot(await bundle(src));
  const r = {};
  r.A1 = VERSIONED.filter((p) => sw.installNet.includes(p));
  r.A2 = ['/_app/immutable/entry/app.abc.js', '/manifest.json', '/'].every((p) => sw.installNet.includes(p));
  const b1 = await sw.get('/cards/M2.json?v=1'); const b2 = await sw.get('/cards/M2.json?v=1');
  r.B1 = b1.net === 1 && b1.body === 'BODY:' + ORIGIN + '/cards/M2.json?v=1'; r.B2 = b2.net;
  r.B3 = [];
  for (const p of ['/card-set-map.json?v=1', '/changelog.html?v=1', '/ai-playbooks/x.json?v=1', '/cards/index.json?v=1']) { await sw.get(p); const s = await sw.get(p); r.B3.push(s.net); }
  r.B4 = (await sw.get('/cards/M2.json?v=2')).net;
  await sw.get('/cards/SV9.json'); r.B5 = (await sw.get('/cards/SV9.json')).net;
  sw.setOffline(true); r.B6 = (await sw.get('/cards/M2.json?v=1')).body; sw.setOffline(false);
  return r;
}

console.log('【主】現行 SW');
const m = await runMain(SRC);
ok('★★★[A1] install 不抓任何版本化資料檔（原本白抓 48 個卡包＋對照表）', m.A1.length === 0, JSON.stringify(m.A1));
ok('★★[A2] install 照舊抓 app 本體（build／manifest／首頁）', m.A2);
ok('★★[B1] 第一次 /cards/M2.json?v=1：打網路一次並回正確內容', m.B1);
ok('★★★[B2] 同 URL 第二次：0 個網路請求（cache-first，與 v6.461 以前玩家實際得到的行為相同）', m.B2 === 0, m.B2);
ok('★★[B3] card-set-map／changelog.html／ai-playbooks／index.json 第二次同樣 0 請求', m.B3.every((n) => n === 0), JSON.stringify(m.B3));
ok('★★★[B4] 版本變了（?v=2）⇒ 打網路（不會拿到舊版資料）', m.B4 === 1, m.B4);
ok('★★[B5] 沒有 v 參數 ⇒ network-first（每次打網路，不被快取釘住）', m.B5 === 1, m.B5);
ok('★[B6] 離線：已快取的同 URL 回快取內容', m.B6 === 'BODY:' + ORIGIN + '/cards/M2.json?v=1', m.B6);

console.log('\n【H】HEAD-FAIL：v6.461 的 SW');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = readBaseBlob(ROOT, BASE_SHA, SW_PATH);
  if (rb.ok) {
    const b = await runMain(rb.out);
    ok('★★★[H] v6.461 install 抓了無 query 的卡包（本版要修的白工）⇒ A1 在 BASE 必紅', b.A1.includes('/cards/M2.json'), JSON.stringify(b.A1));
    ok('★[H2] 而 v6.461 的執行期第二次也是 0 請求（證明本版沒有改變玩家實際的快取行為）', b.B2 === 0, b.B2);
  } else shallowSkip('v6462 H', '讀不到 BASE blob');
} else shallowSkip('v6462 H', '需要 v6.461 commit');

console.log('\n【突變】');
const M1 = SRC.replace("PRECACHE.includes(url.pathname) || (VERSIONED_DATA(url.pathname) && url.searchParams.has('v'))", 'PRECACHE.includes(url.pathname)');
ok('[M1 自驗] 突變有套上', M1 !== SRC);
// ⭐v6.509（Rule 40）：卡包資料（/cards/*.json、card-set-map.json）改由專用的內容雜湊快取先接手，
//   不再經過這個一般的版本化條件 ⇒ 拿掉它時改觀察仍走這條的 changelog.html（B3[1]）與 ai-playbooks（B3[2]）。意圖不變。
if (M1 !== SRC) { const r = await runMain(M1); ok('★★[M1] 拿掉 cache-first 的版本化條件 ⇒ changelog／ai-playbooks 第二次必紅（每次都打網路）', r.B3[1] !== 0 && r.B3[2] !== 0, JSON.stringify(r.B3)); }
const M2 = SRC.replace("(VERSIONED_DATA(url.pathname) && url.searchParams.has('v'))", 'VERSIONED_DATA(url.pathname)');
ok('[M2 自驗] 突變有套上', M2 !== SRC);
if (M2 !== SRC) { const r = await runMain(M2); ok('★★[M2] 拿掉「必須有 v 參數」⇒ B5 必紅（無版本請求被快取釘住）', r.B5 === 0, r.B5); }

rmSync(TMP, { recursive: true, force: true });
console.log(`\n=== v6.462 SW 版本化資料檔改執行期快取: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6462-sw-versioned-runtime ===');
process.exit(fail ? 1 : 0);
