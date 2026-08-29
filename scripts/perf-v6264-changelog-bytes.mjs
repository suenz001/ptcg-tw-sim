// v6.264 量測腳本（Rule 32：效能數字必須附可重跑的腳本）。
//
// 量三件**可歸因**的事，BASE(v6.263) vs HEAD：
//   ① 每次開啟首頁要下載的 changelog 位元組（changelog.html 是 network-first，帶 ?v= 每版都重抓）
//   ② SW install 時預快取的 changelog 位元組（PRECACHE 收 static/ 全部，除非列進 HEAVY_MEDIA）
//   ③ 同樣內容經 gzip 後的位元組（實際上線走 Cloudflare 的 br/gzip，raw 位元組不是玩家看到的數字）
//
// ⚠⚠ Rule 36：**位元組減量 ≠ 延遲減量**。下面第 ④ 段刻意跑一次 loopback 計時，
//   就是要顯示「在沒有頻寬瓶頸的地方，這個差值量不出來」——
//   本版的價值是**結構性的**（守衛上限只剩 4 bytes、下一則必爆），位元組是副產品。
//   要宣稱「玩家會變快」必須拿線上 dump 的分段時間來講，不是拿這裡的數字。
//
// 用法：node scripts/perf-v6264-changelog-bytes.mjs [BASE_SHA]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { readBaseBlob, hasBaseCommit } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'ff7ef443a7dd38e48cf0659d8f5e52fe1acf3806';
const B = (s) => Buffer.byteLength(s, 'utf8');
const GZ = (s) => gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + 'KB';

const headHome = readFileSync(join(ROOT, 'static/changelog.html'), 'utf8');
const bodiesPath = join(ROOT, 'static/changelog-bodies.html');
const headBodies = existsSync(bodiesPath) ? readFileSync(bodiesPath, 'utf8') : '';

let baseHome = null;
if (hasBaseCommit(ROOT, BASE)) {
  const r = readBaseBlob(ROOT, BASE, 'static/changelog.html');
  if (r.ok) baseHome = r.out;
}
if (!baseHome) {
  console.log('⚠⚠ 拿不到 BASE ' + BASE.slice(0, 8) + ' 的 changelog.html（淺複製）—— 只印 HEAD 的絕對值。');
}

console.log('\n① 每次開啟首頁要下載的 changelog（network-first，帶 ?v= 每版重抓）');
const row = (name, raw, gz) => console.log(`   ${name.padEnd(26)} ${String(raw).padStart(7)} bytes (${kb(raw).padStart(7)})  gzip ${String(gz).padStart(6)} bytes`);
if (baseHome) row('BASE changelog.html', B(baseHome), GZ(baseHome));
row('HEAD changelog.html', B(headHome), GZ(headHome));
if (baseHome) {
  const d = B(baseHome) - B(headHome), dg = GZ(baseHome) - GZ(headHome);
  console.log(`   ⇒ 每次進站少下載 ${d} bytes（-${(d / B(baseHome) * 100).toFixed(1)}%）；gzip 後少 ${dg} bytes（-${(dg / GZ(baseHome) * 100).toFixed(1)}%）`);
}
if (headBodies) {
  row('HEAD bodies（展開才抓）', B(headBodies), GZ(headBodies));
  console.log('   ⚠ 這一份只有玩家展開「較舊的條目」時才會抓，而且整份只抓一次。');
}

console.log('\n② SW install 預快取的 changelog 位元組（PRECACHE 收 static/ 全部，除非列進 HEAVY_MEDIA）');
const SW = readFileSync(join(ROOT, 'src/service-worker.ts'), 'utf8');
const bodiesExcluded = /HEAVY_MEDIA[^\n]*changelog-bodies/.test(SW);
const headInstall = B(headHome) + (bodiesExcluded ? 0 : B(headBodies));
if (baseHome) row('BASE install', B(baseHome), GZ(baseHome));
row('HEAD install', headInstall, 0);
console.log('   bodies 是否被排除在 PRECACHE 之外：' + (bodiesExcluded ? '是（用到才快取）' : '⚠ 否 —— 等於白做'));
if (baseHome) console.log(`   ⇒ 每位訪客的首次安裝／每次版本更新少抓 ${B(baseHome) - headInstall} bytes`);

console.log('\n③ 參考：實際上線由 Cloudflare 壓縮（br/gzip），玩家看到的是 gzip 那一欄的量級。');

console.log('\n④ ⚠⚠ Rule 36 對照：同一份內容在 loopback 上的取得時間（沒有頻寬瓶頸 ⇒ 差值應該量不出來）');
const serve = (payload) => new Promise((resolve) => {
  const srv = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(payload); });
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});
async function timeFetch(payload, n = 200) {
  const srv = await serve(payload);
  const port = srv.address().port;
  const ts = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await (await fetch(`http://127.0.0.1:${port}/x?i=${i}`)).text();
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  srv.close();
  ts.sort((a, b) => a - b);
  return { p50: ts[Math.floor(n * 0.5)], p95: ts[Math.floor(n * 0.95)] };
}
if (baseHome) {
  const a = await timeFetch(baseHome), b2 = await timeFetch(headHome);
  console.log(`   BASE(${kb(B(baseHome))})  p50 ${a.p50.toFixed(3)}ms  p95 ${a.p95.toFixed(3)}ms`);
  console.log(`   HEAD(${kb(B(headHome))})  p50 ${b2.p50.toFixed(3)}ms  p95 ${b2.p95.toFixed(3)}ms`);
  console.log('   ⇒ 這個數字**不可以**拿去對玩家宣稱「快了多少」：loopback 沒有頻寬與 RTT 瓶頸。');
}
console.log('');
