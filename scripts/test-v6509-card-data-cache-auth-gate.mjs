#!/usr/bin/env node
/**
 * v6.509 守衛：卡包資料改用內容當快取依據＋錦標賽不再先閃登入畫面（2026-10-07）
 *   站長（逐字）：「卡包資料改用內容當快取依據：卡片資料沒變就不用重新下載。以後只有補新卡包時才會重抓」。
 *   玩家回報（站長轉述）：手機「按下錦標賽後畫面停在登入畫面，要等一段時間才會進入錦標賽」「幾乎每次都會」。
 *   實測（站長電腦 Chrome、已登入）：開頁後 Firebase 才去讀回帳號並連 Google 驗證（accounts:lookup 0.4 秒），
 *   這段期間 firebaseUser 是 null ⇒ isAnonymous 為 true ⇒ 錦標賽先顯示「請登入」表單。
 *
 * 【S】靜態：卡包資料網址一律走 $lib/cards/data-url（不再帶網站版本號）；SW 有跨版本保留的卡包資料快取；
 *      錦標賽在第一次收到登入狀態前顯示「確認登入狀態中」（8 秒保險）；layout 空閒時預熱 Firebase
 * 【U】實跑：cardDataHashes()＝檔案 sha1 前 10 碼、內容一改雜湊就變；cardDataVer 有雜湊用雜湊、沒有退回版本號；
 *      cachesToDelete 保留卡包資料快取；staleCardDataUrls 只挑同路徑不同 ?v=
 * 【E】真瀏覽器（build/）：卡包網址帶內容雜湊；Service Worker 把卡包存進專用快取、換雜湊時刪掉舊的；
 *      錦標賽（登入服務被擋）先顯示「確認登入狀態中」、沒有登入表單，8 秒後才出現表單
 * 【H】HEAD-FAIL：靜態判準餵 v6.508 全紅
 */
import { readFileSync, existsSync, createReadStream, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.508。
const BASE_SHA = '6e130e66';
const rd = (r) => { try { return readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function judge(get) {
  const r = {};
  const pool = get('src/lib/cards/pool.ts'), cardsPage = get('src/routes/cards/+page.ts');
  r.S1 = /cardDataUrl\(base, 'cards\/index\.json'\)/.test(pool) && /cardDataUrl\(base, `cards\/\$\{setCode\}\.json`\)/.test(pool)
    && /cardDataUrl\(base, 'card-set-map\.json'\)/.test(pool) && !/\?v=\$\{VERSION\}/.test(pool)
    && /cardDataUrl\(base, `cards\/\$\{s\.code\}\.json`\)/.test(cardsPage) && !/\?v=\$\{VERSION\}/.test(cardsPage);
  const vc = get('vite.config.js');
  r.S2 = /export function cardDataHashes\(/.test(vc) && /define: \{ __CARD_DATA_HASHES__: JSON\.stringify\(cardDataHashes\(\)\) \}/.test(vc);
  const sw = get('src/service-worker.ts');
  r.S3 = /if \(isCardDataPath\(url\.pathname\) && url\.searchParams\.has\('v'\)\) \{/.test(sw) && sw.includes('caches.open(CARD_DATA_CACHE)')
    && sw.includes('staleCardDataUrls(keys, event.request.url)') && sw.indexOf('// >>> v6509-card-data-cache') < sw.indexOf('async function respond()');
  const g = get('src/routes/game/+page.svelte');
  const iGate = g.indexOf('{:else if !tAuthResolved}'), iAnon = g.indexOf('{:else if isAnonymous}\n      <p class="tourn-gate">');
  r.S4 = iGate > 0 && iAnon > iGate && iAnon - iGate < 300 && /firebaseUser = u;\n\s+tAuthResolved = true;/.test(g)
    && /setTimeout\(\(\) => \{ if \(!tAuthResolved\) tAuthResolved = true; \}, 8000\);/.test(g);
  r.S5 = get('src/routes/+layout.svelte').includes("import('$lib/firebase')");
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] 卡包資料網址一律走 cardDataUrl（pool.ts、卡牌資料庫），不再帶網站版本號', C.S1);
ok('★★★[S2] 建置時算卡包內容雜湊並注入（__CARD_DATA_HASHES__）', C.S2);
ok('★★★[S3] Service Worker：卡包資料走專用快取（cache-first、換雜湊刪舊的），在一般快取處理之前', C.S3);
ok('★★★[S4] 錦標賽：第一次收到登入狀態前顯示「確認登入狀態中」（在登入表單之前判斷），8 秒保險', C.S4);
ok('★★[S5] layout 空閒時預熱 Firebase（從首頁點進錦標賽時登入狀態已就緒）', C.S5);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((f) => { const b = readBaseBlob(ROOT, BASE_SHA, f); return b.ok ? b.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[S0] HEAD-FAIL：S1～S5 在 v6.508 全紅', Object.values(B).every((v) => !v), JSON.stringify(B));
} else shallowSkip('v6509 S0', '需要 BASE commit');

console.log('\n【U】實跑');
{
  const { cardDataHashes } = await import(pathToFileURL(join(ROOT, 'vite.config.js')).href);
  const h = cardDataHashes(ROOT);
  const sha = (p) => createHash('sha1').update(readFileSync(join(ROOT, p))).digest('hex').slice(0, 10);
  ok('★★★[U1] cardDataHashes：每個卡包＋卡片對照表都有雜湊，＝檔案 sha1 前 10 碼', Object.keys(h).length > 30 && h['cards/index.json'] === sha('static/cards/index.json')
    && h['card-set-map.json'] === sha('static/card-set-map.json'), Object.keys(h).length);
  const tmp = mkdtempSync(join(tmpdir(), 'v6509-'));
  try {
    mkdirSync(join(tmp, 'static', 'cards'), { recursive: true });
    writeFileSync(join(tmp, 'static', 'cards', 'A.json'), '[1]'); writeFileSync(join(tmp, 'static', 'cards', 'B.json'), '[2]');
    const h1 = cardDataHashes(tmp);
    writeFileSync(join(tmp, 'static', 'cards', 'A.json'), '[1,2]');
    const h2 = cardDataHashes(tmp);
    ok('★★★[U2] 只有內容改了的檔案換雜湊（A 變、B 不變）', h1['cards/A.json'] !== h2['cards/A.json'] && h1['cards/B.json'] === h2['cards/B.json'], JSON.stringify([h1, h2]));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const S = join(ROOT, '.v6509-s.js'), E = join(ROOT, '.v6509-e.ts'), O = join(ROOT, '.v6509-o.mjs');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, "export { cardDataVer, cardDataUrl } from './src/lib/cards/data-url';\nexport { cachesToDelete, CARD_DATA_CACHE, isCardDataPath, staleCardDataUrls } from './src/lib/sw-policy';\nexport { VERSION } from './src/lib/version';");
  try {
    // Rule 41：舊版沒有 data-url.ts ⇒ 打包失敗時 U3～U5 各自翻紅，不整支 throw
    let M = null;
    try {
      await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
      M = await import(pathToFileURL(O).href);
    } catch (e) { console.log('  （打包失敗：' + String(e.message).split('\n')[0].slice(0, 120) + '）'); }
    const MISSING = () => { throw new Error('MISSING'); };
    const safe = (f) => { try { return f(); } catch { return false; } };
    if (!M) M = { cardDataVer: MISSING, cachesToDelete: MISSING, staleCardDataUrls: MISSING, isCardDataPath: MISSING };
    ok('★★★[U3] cardDataVer：有雜湊 ⇒ c＋雜湊；沒有 ⇒ 退回網站版本號', safe(() => M.cardDataVer('cards/M3.json', { 'cards/M3.json': 'abc' }) === 'cabc'
      && M.cardDataVer('cards/X.json', { 'cards/M3.json': 'abc' }) === M.VERSION && M.cardDataVer('cards/M3.json', null) === M.VERSION));
    ok('★★★[U4] cachesToDelete：卡包資料快取跨版本保留，其他規則不變（保留現行＋前一版）',
      safe(() => JSON.stringify(M.cachesToDelete(['ptcg-tw-sim-5', 'ptcg-tw-sim-6', 'ptcg-tw-sim-7', M.CARD_DATA_CACHE, 'other'], 'ptcg-tw-sim-7').sort()) === JSON.stringify(['other', 'ptcg-tw-sim-5'])));
    const u = 'https://x.tw/cards/M3.json?v=cnew';
    ok('★★[U5] staleCardDataUrls 只挑同路徑、不同 ?v= 的舊網址；isCardDataPath 認得卡包與對照表（含 base path）',
      safe(() => JSON.stringify(M.staleCardDataUrls(['https://x.tw/cards/M3.json?v=cold', 'https://x.tw/cards/M2.json?v=cold', u], u)) === JSON.stringify(['https://x.tw/cards/M3.json?v=cold'])
      && M.isCardDataPath('/cards/M3.json') && M.isCardDataPath('/ptcg-tw-sim/card-set-map.json') && !M.isCardDataPath('/cards/M3.png') && !M.isCardDataPath('/changelog.html')));
  } finally { for (const p of [S, E, O]) { try { rmSync(p); } catch { /* */ } } }
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.509') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.509');
  if (browser) {
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const hits = [];
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (u.pathname.startsWith('/cards/') || u.pathname === '/card-set-map.json') hits.push(u.pathname + u.search);
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    try {
      const { cardDataHashes } = await import(pathToFileURL(join(ROOT, 'vite.config.js')).href);
      const H = cardDataHashes(ROOT);
      // ① 卡包網址帶內容雜湊；Service Worker 把它存進專用快取、第二次不再回源
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/cards?set=M3`, { waitUntil: 'load' });
      await pg.evaluate(async () => { await navigator.serviceWorker.ready; });
      await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(1500);   // 第二次：SW 已接管
      const want = `/cards/M3.json?v=c${H['cards/M3.json']}`;
      ok('★★★[E1] 卡包網址帶內容雜湊（不是網站版本號）', hits.includes(want), JSON.stringify(hits.slice(0, 4)));
      const n1 = hits.filter((h) => h === want).length;
      await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(1500);
      const n2 = hits.filter((h) => h === want).length;
      const keys = await pg.evaluate(async () => (await (await caches.open('ptcg-tw-sim-carddata')).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search));
      ok('★★★[E2] Service Worker 把卡包存進專用快取，之後重新整理不再回源', keys.includes(want) && n2 === n1, JSON.stringify({ n1, n2, keys: keys.slice(0, 3) }));
      // ③ 換雜湊（模擬補新卡）⇒ 舊網址被刪掉、只留新的
      const pruned = await pg.evaluate(async (w) => {
        const c = await caches.open('ptcg-tw-sim-carddata');
        await fetch('/cards/M3.json?v=cNEWHASH00');
        const ks = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search).filter((k) => k.startsWith('/cards/M3.json'));
        return ks;
      }, want);
      ok('★★[E3] 同一個卡包換了新雜湊 ⇒ 舊的那一筆從快取刪掉（不會無限長大）', JSON.stringify(pruned) === JSON.stringify(['/cards/M3.json?v=cNEWHASH00']), JSON.stringify(pruned));
      await ctx.close();
      // ④ 錦標賽：模擬「手機上已登入的玩家」—— 瀏覽器裡存著登入資料（IndexedDB），
      //    Firebase 開頁時要先向 Google 驗證一次（accounts:lookup）才會回報登入狀態；手機上這一步要好幾秒。
      //    mode='slow'：驗證 4 秒後才回（網路錯誤 ⇒ Firebase 保留原登入）；mode='hang'：永遠不回；mode='fresh'：沒有登入資料。
      const API_KEY = 'AIzaSyAH5IsKlGyHWWCWKKliDIvOqfevJQW8qhs';
      const tourn = async (mode, times) => {
        const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
        // ⚠ Playwright 後註冊的 route 先比對 ⇒ 一般外部服務先擋，identitytoolkit 的延遲規則後註冊
        await c2.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const p2 = await c2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
        await p2.goto(`http://localhost:${port}/tournament`, { waitUntil: 'load' });
        if (mode !== 'fresh') {
          await p2.evaluate(async (k) => {
            const now = Date.now();
            const user = { uid: 'u_v6509', email: 'v6509@example.com', emailVerified: true, isAnonymous: false, providerData: [{ providerId: 'password', uid: 'v6509@example.com', email: 'v6509@example.com', displayName: null, phoneNumber: null, photoURL: null }],
              stsTokenManager: { refreshToken: 'r', accessToken: 'a', expirationTime: now + 3600e3 }, createdAt: String(now), lastLoginAt: String(now), apiKey: k, appName: '[DEFAULT]' };
            const db = await new Promise((res, rej) => { const q = indexedDB.open('firebaseLocalStorageDb', 1); q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('firebaseLocalStorage')) q.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
            await new Promise((res, rej) => { const t = db.transaction('firebaseLocalStorage', 'readwrite'); t.objectStore('firebaseLocalStorage').put({ fbase_key: `firebase:authUser:${k}:[DEFAULT]`, value: user }); t.oncomplete = res; t.onerror = () => rej(t.error); });
            db.close();
          }, API_KEY);
          await c2.route(/identitytoolkit|securetoken/, (r) => { if (mode === 'slow') setTimeout(() => r.abort().catch(() => {}), 4000); /* hang：永遠不回 */ });
          await p2.reload({ waitUntil: 'load' });
        }
        const snaps = []; let t0 = 0;
        for (const t of times) { await p2.waitForTimeout(t - t0); t0 = t;
          snaps.push(await p2.evaluate(() => ({ wait: document.body.innerText.includes('正在確認登入狀態'), gate: !!document.querySelector('.tourn-gate') }))); }
        await c2.close();
        return snaps;
      };
      const [s1, s2] = await tourn('slow', [2000, 6500]);
      ok('★★★[E4] 已登入玩家、登入驗證還沒回來：顯示「正在確認登入狀態」，不顯示登入表單', s1.wait && !s1.gate, JSON.stringify(s1));
      ok('★★★[E5] 驗證回來後直接進錦標賽（不經過登入表單、不殘留確認中）', !s2.wait && !s2.gate, JSON.stringify(s2));
      const [h1] = await tourn('hang', [9500]);
      ok('★★[E6] 8 秒都等不到登入狀態 ⇒ 照舊顯示登入表單（不會卡死在確認中）', !h1.wait && h1.gate, JSON.stringify(h1));
      const [f1] = await tourn('fresh', [1500]);
      ok('★★[E7] 沒有登入資料的新玩家：很快就顯示登入表單（零回歸）', !f1.wait && f1.gate, JSON.stringify(f1));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.509 卡包資料內容快取＋錦標賽登入閘：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
