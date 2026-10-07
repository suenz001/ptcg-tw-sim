#!/usr/bin/env node
/**
 * v6.478 守衛：網頁版主題第五步。
 *   ① 淺色主題的對戰／錦標賽大廳：大廳外的四個視窗（錦標賽／休閒版本閘、棄權確認、帳號管理、改密碼）也換成淺色
 *      ⇒ scripts/gen-lobby-light.py 新增 MODAL_STARTS，產生段含 .tourn-vergate／.pv-inner 的淺色覆寫（不加 .lobby 祖先）。
 *   ② 深色主題全站統一成對戰大廳的墨綠 #162816（原本首頁等頁是 #0f1f17，切頁有色差）。
 *   ③ 載入畫面（app.html 的 #app-splash）：網頁版 ≥1024px 且深色主題 ⇒ 墨綠底，免得每次進站先閃白；手機、淺色維持白底。
 * HEAD-FAIL：同一份靜態判準餵 v6.477 必須紅。
 * Run: node scripts/test-v6478-modals-dark-unify.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';   // ⭐v6.511 色票唯一讀取點（不寫死色碼）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.477。
const BASE_SHA = '52483ddb';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ⭐v6.499（Rule 40）：大廳淺色前綴拿掉 data-ui-wide（手機也套），意圖（視窗淺底、不掛 .lobby 祖先）不變
const PRE = ":global(html[data-theme='light']:not([data-battle-view]))";
function judge(get) {
  const r = {};
  const G = get('src/routes/game/+page.svelte');
  const blk = (G.match(/\/\* >>> v6477-lobby-light \*\/[\s\S]*?\/\* <<< v6477-lobby-light \*\//) || [''])[0];
  // 版本閘視窗：底色換成淺色（亮度高），而且「不」掛在 .lobby 底下（視窗是 .lobby 的兄弟節點，加了祖先就套不到）
  const vg = blk.split('\n').find((l) => l.includes(PRE + ' .tourn-vergate {')) || '';
  const bg = (vg.match(/background: #([0-9a-f]{6})/) || [])[1];
  r.S1 = !!bg && parseInt(bg.slice(0, 2), 16) > 0xd0 && !vg.includes('.lobby');
  r.S2 = blk.split('\n').some((l) => l.includes(PRE + ' .pv-inner') && !l.includes('.lobby'));
  const L = get('src/routes/+layout.svelte');
  const dk = (L.match(/:global\(html\[data-theme='dark'\]\) \{[\s\S]*?\n  \}/) || [''])[0];
  // ⭐v6.511（Rule 40）：深色色票提亮一階 ⇒ 不再釘 #162816；意圖「全站深色同一個墨綠（載入畫面＝深色 --ui-bg）、頂端列有自己的深色」改成兩邊互相比對
  const dkBg = (dk.match(/--ui-bg: (#[0-9a-f]{6});/) || [])[1];
  r.S3 = !!dkBg && /--ui-topbar-bg: #[0-9a-f]{6};/.test(dk) && get('src/app.html').includes('#app-splash.dark{background:' + dkBg);
  const A = get('src/app.html');
  r.S4 = /#app-splash\.dark\{background:#[0-9a-f]{6}/.test(A) && /s\.classList\.add\('dark'\)/.test(A) && A.includes("matchMedia('(min-width: 1024px)')") && A.includes("localStorage.getItem('ptcg_ui_theme')");
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] 淺色大廳產生段：.tourn-vergate 換淺底、而且不掛 .lobby 祖先', C.S1);
ok('★★★[S2] 淺色大廳產生段：帳號管理／改密碼的 .pv-inner 有覆寫', C.S2);
ok('★★★[S3] 深色色票統一：載入畫面的深色底＝深色 --ui-bg、頂端列有深色值', C.S3);
ok('★★★[S4] app.html 載入畫面：≥1024px＋深色（與 site-theme 同一判準）掛 .dark 墨綠底', C.S4);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.477 全紅', !B.S1 && !B.S2 && !B.S3 && !B.S4, JSON.stringify(B));
} else shallowSkip('v6478 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.478') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.478');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    const lum = (rgb) => { const m = String(rgb).match(/\d+/g); if (!m) return -1; const [r, g, b] = m.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const open = async (w, h, theme, path, { mobile = false, blockApp = false } = {}) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      // 擋掉 /_app/ ⇒ app 不會啟動、不會移除載入畫面 ⇒ 量得到載入畫面本身
      if (blockApp) await ctx.route(/\/_app\//, (r) => r.abort());
      if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); if (!blockApp) pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(blockApp ? 300 : 1500);
      return { ctx, pg };
    };
    const splash = (pg) => pg.evaluate(() => { const s = document.getElementById('app-splash'); return s ? { bg: getComputedStyle(s).backgroundColor, dark: s.classList.contains('dark') } : null; });
    // 照對戰頁的標記插一個版本閘視窗（真實觸發要連錦標賽伺服器），量它的底色
    const vergate = (pg) => pg.evaluate(() => {
      const mc = document.querySelector('.mode-card'); if (!mc) return null;
      const h = [...mc.classList].find((c) => c.startsWith('svelte-'));
      const d = document.createElement('div');
      d.innerHTML = `<div class="tourn-vergate-mask ${h}"><div class="tourn-vergate ${h}"><div class="tvg-title ${h}">需要更新</div><div class="tvg-body ${h}">內文<span class="tvg-note ${h}">附註</span></div></div></div>`;
      (document.querySelector('.lobby')?.parentElement || document.body).appendChild(d.firstElementChild);
      const v = document.querySelector('.tourn-vergate');
      return { bg: getComputedStyle(v).backgroundColor, title: getComputedStyle(v.querySelector('.tvg-title')).color };
    });
    try {
      let { ctx, pg } = await open(1440, 900, 'dark', '/', { blockApp: true });
      const S1 = await splash(pg); await ctx.close();
      ok('★★★[E1] 1440 深色：載入畫面是墨綠底 #162816', S1?.dark === true && S1.bg === uiColor(ROOT, 'dark', '--ui-bg'), JSON.stringify(S1));
      ({ ctx, pg } = await open(1440, 900, 'light', '/', { blockApp: true }));
      const S2 = await splash(pg); await ctx.close();
      ok('★★[E2] 1440 淺色：載入畫面維持白底', S2?.dark === false && S2.bg === 'rgb(255, 255, 255)', JSON.stringify(S2));
      ({ ctx, pg } = await open(390, 844, 'dark', '/', { mobile: true, blockApp: true }));
      const S3 = await splash(pg); await ctx.close();
      ok('★★★[E3] 手機 390 深色：載入畫面維持白底（手機不變）', S3?.dark === false && S3.bg === 'rgb(255, 255, 255)', JSON.stringify(S3));
      ({ ctx, pg } = await open(1440, 900, 'light', '/game'));
      const V1 = await vergate(pg); await ctx.close();
      ok('★★★[E4] 1440 淺色：版本閘視窗是淺底深字', !!V1 && lum(V1.bg) > 220 && lum(V1.title) < 80, JSON.stringify(V1));
      ({ ctx, pg } = await open(1440, 900, 'dark', '/game'));
      const V2 = await vergate(pg); await ctx.close();
      ok('★★[E5] 1440 深色：版本閘視窗維持原本深藍（#1e2530）', V2?.bg === 'rgb(30, 37, 48)', JSON.stringify(V2));
      ({ ctx, pg } = await open(390, 844, 'light', '/game', { mobile: true }));
      const V3 = await vergate(pg); await ctx.close();
      // ⭐v6.499（Rule 40）：站長要求手機淺色大廳也是淺底 ⇒ 大廳狀態下的視窗跟網頁版一樣是淺底深字
      ok('★★★[E6] 手機 390 淺色：版本閘視窗也是淺底深字（v6.499 起與網頁版一致）', !!V3 && lum(V3.bg) > 220 && lum(V3.title) < 80, JSON.stringify(V3));
      ({ ctx, pg } = await open(1440, 900, 'dark', '/cards'));
      const body = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor); await ctx.close();
      ok('★★[E7] 1440 深色 /cards：底色與對戰大廳同為深色 --ui-bg', body === uiColor(ROOT, 'dark', '--ui-bg'), body);
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
