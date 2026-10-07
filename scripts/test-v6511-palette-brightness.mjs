#!/usr/bin/env node
/**
 * v6.511 守衛：全站色票亮度調整（玩家回饋「淺色太亮、深色又太暗」；站長看過預覽圖後回「可以」）。
 *
 * 【S】靜態（判準不寫死色碼，只驗「方向」與「可讀性」；具體值以 layout 為準）
 *   S1 淺色：--ui-bg／--ui-bg-elev 比 v6.510 暗（卡片不再是純白）
 *   S2 深色：--ui-bg／--ui-bg-elev／--ui-bg-sunken 比 v6.510 亮
 *   S3 兩個主題：主文字、說明文字、連結對 bg／elev／sunken 三種底的對比都 ≥ 4.5
 *   S4 深色大廳（對戰／錦標賽／好友頁）整頁底改讀色票、牌桌畫面不套；手機底部導覽列讀色票；載入畫面深色底＝深色 --ui-bg
 * 【E】真瀏覽器（build/，手機 390）：淺色首頁底＝淺色 --ui-bg、導覽列＝--ui-topbar-bg；深色 /game、/tournament、/friends 底＝深色 --ui-bg；
 *      掛上 data-battle-view（牌桌）仍是原本墨綠 rgb(22, 40, 22)；深色好友面板底＝深色 --ui-bg
 * 【H】HEAD-FAIL：S1、S2、S4 餵 v6.510 必紅
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.510。
const BASE_SHA = '4bbe0f83';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// 相對亮度（WCAG）
const relLum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// v6.510 的值（只用來判斷「方向」：本版之後再調色也不會因為這裡寫死而誤紅，除非又調回原本的亮度）
const V6510 = { light: { bg: '#f3f5f4', elev: '#ffffff' }, dark: { bg: '#162816', elev: '#1e3521', sunken: '#102010' } };

function palette(layout) {
  const blk = (head) => { let i = layout.indexOf(head); while (i >= 0 && !/^[^}]*--ui-bg:/.test(layout.slice(i + head.length))) i = layout.indexOf(head, i + 1);
    const o = {}; if (i < 0) return o; for (const m of layout.slice(i, layout.indexOf('\n  }', i)).matchAll(/(--ui-[\w-]+):\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o; };
  const light = blk(':global(:root) {');
  return { light, dark: { ...light, ...blk(":global(html[data-theme='dark']) {") } };
}
function judge(get) {
  const L = get('src/routes/+layout.svelte'), P = palette(L), r = {};
  const hex = (t, k) => /^#[0-9a-f]{6}$/i.test(P[t][k] || '') ? P[t][k] : null;
  r.S1 = !!hex('light', '--ui-bg') && relLum(hex('light', '--ui-bg')) < relLum(V6510.light.bg) - 0.05 && relLum(hex('light', '--ui-bg-elev')) < relLum(V6510.light.elev) - 0.05;
  r.S2 = !!hex('dark', '--ui-bg') && relLum(hex('dark', '--ui-bg')) > relLum(V6510.dark.bg) * 1.4 && relLum(hex('dark', '--ui-bg-elev')) > relLum(V6510.dark.elev) * 1.4
    && relLum(hex('dark', '--ui-bg-sunken')) > relLum(V6510.dark.sunken) * 1.4;
  const crs = [];
  for (const t of ['light', 'dark']) for (const fg of ['--ui-text', '--ui-text-muted', '--ui-link']) for (const bg of ['--ui-bg', '--ui-bg-elev', '--ui-bg-sunken']) {
    const a = hex(t, fg), b = hex(t, bg); crs.push(a && b ? contrast(a, b) : 0);
  }
  r.S3 = crs.length === 18 && crs.every((c) => c >= 4.5); r.minCr = Math.min(...crs).toFixed(2);
  const N = get('src/lib/SiteBottomNav.svelte'), F = get('src/lib/friends/FriendsPanel.svelte'), A = get('src/app.html');
  r.S4 = L.includes(":global(html[data-ui-lobby][data-theme='dark']:not([data-battle-view]) body) { background-color: var(--ui-bg) !important; }")
    && N.includes('background: var(--ui-topbar-bg);') && N.includes(":global(html[data-theme='dark']) .sbn { background: var(--ui-topbar-bg);")
    && F.includes(":global(html[data-theme='dark']:not([data-battle-view])) .fr-panel:not(.embed) { background: var(--ui-bg); }")
    && !!hex('dark', '--ui-bg') && A.includes('#app-splash.dark{background:' + hex('dark', '--ui-bg'));
  return r;
}
const rd = (p) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };

console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] 淺色：整頁底與卡片底比 v6.510 暗（卡片不再是純白）', C.S1);
ok('★★★[S2] 深色：整頁底、卡片底、凹陷底都比 v6.510 亮', C.S2);
ok('★★★[S3] 兩個主題的主文字／說明文字／連結，對三種底的對比都 ≥ 4.5', C.S3, '最低 ' + C.minCr);
ok('★★[S4] 深色大廳整頁底讀色票（牌桌不套）、底部導覽列讀色票、好友頁深色底、載入畫面深色＝深色 --ui-bg', C.S4);

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[H1] v6.510：S1、S2、S4 全紅；S3 在 v6.510 也成立（本版沒有犧牲可讀性）', !B.S1 && !B.S2 && !B.S4 && B.S3, JSON.stringify(B));
} else shallowSkip('v6511 H', '需要 v6.510 commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.511') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.511');
  if (browser) {
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) { const h = p.replace(/\/$/, '') + '.html'; p = existsSync(h) ? h : join(BUILD, '404.html'); }
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    const open = async (theme, path) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: theme });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      return { ctx, pg };
    };
    const body = (pg) => pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
    try {
      let { ctx, pg } = await open('light', '/');
      const home = { body: await body(pg), nav: await pg.evaluate(() => { const e = document.querySelector('.sbn'); return e ? getComputedStyle(e).backgroundColor : null; }) };
      await ctx.close();
      ok('★★★[E1] 淺色首頁：底＝淺色 --ui-bg、底部導覽列＝--ui-topbar-bg（不再是純白）',
        home.body === uiColor(ROOT, 'light', '--ui-bg') && home.nav === uiColor(ROOT, 'light', '--ui-topbar-bg') && home.nav !== 'rgb(255, 255, 255)', JSON.stringify(home));
      const D = {};
      for (const path of ['/game', '/tournament', '/friends']) {
        ({ ctx, pg } = await open('dark', path));
        D[path] = await body(pg);
        if (path === '/friends') D.panel = await pg.evaluate(() => { const e = document.querySelector('.fr-panel'); return e ? getComputedStyle(e).backgroundColor : null; });
        if (path === '/game') { await pg.evaluate(() => document.documentElement.setAttribute('data-battle-view', '')); await pg.waitForTimeout(100); D.battle = await body(pg); }
        await ctx.close();
      }
      const DB = uiColor(ROOT, 'dark', '--ui-bg');
      ok('★★★[E2] 深色 /game、/tournament、/friends 整頁底＝深色 --ui-bg（不再是寫死的最暗墨綠）', D['/game'] === DB && D['/tournament'] === DB && D['/friends'] === DB, JSON.stringify(D));
      ok('★★[E3] 深色好友面板底＝深色 --ui-bg', D.panel === DB, JSON.stringify(D));
      ok('★★★[E4] 牌桌畫面（data-battle-view）仍是原本墨綠 rgb(22, 40, 22)', D.battle === 'rgb(22, 40, 22)', D.battle);
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.511 全站色票亮度調整：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
