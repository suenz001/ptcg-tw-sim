#!/usr/bin/env node
/**
 * v6.476 守衛：牌組編輯器（/decks）與牌組公布欄（/deck-posts）接上網頁版淺色／深色主題＋版面優化。
 *   ① THEMED_ROUTES 含 /decks、/deck-posts（layout 依此掛 data-ui-themed ⇒ 整頁底色跟主題）。
 *   ② 兩頁的新規則各自包在一個 v6476-desktop-theme 哨兵裡，而且整塊在 min-width:1024px 內 ⇒ 手機不變；
 *      /decks 的桌機指紋（test-v6213，只取 @media 以外）因此不動。
 *   ③ 網頁版有頂端列 ⇒ 兩頁頁首的「← 首頁」收起；/deck-posts 投稿列表兩欄。
 *   ④ 真瀏覽器：深色時三欄面板／視窗是深色、文字淺色；手機 390 完全沿用舊樣式。
 * HEAD-FAIL：同一份靜態判準餵 v6.475 必須紅。
 * Run: node scripts/test-v6476-decks-posts-theme.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';   // ⭐v6.511 色票唯一讀取點（不寫死色碼）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.475。
const BASE_SHA = '37b8db6a';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function judge(get) {
  const r = {};
  const ST = get('src/lib/site-theme.ts');
  const m = ST.match(/THEMED_ROUTES: readonly RegExp\[\] = \[([^\n]*)\];/);
  r.S1 = !!m && m[1].includes('/^\\/decks$/') && m[1].includes('/^\\/deck-posts$/');
  for (const [k, p, back] of [['S2', 'src/routes/decks/+page.svelte', '.page-head > .back { display: none; }'], ['S3', 'src/routes/deck-posts/+page.svelte', '.page-head > .back { display: none; }']]) {
    const src = get(p);
    const blocks = src.match(/\n  \/\* >>> v6476-desktop-theme \*\/\n[\s\S]*?\n  \/\* <<< v6476-desktop-theme \*\/\n/g) || [];
    const b = blocks[0] || '';
    // 哨兵恰好一塊；塊內只有註解＋一個 min-width:1024px（不得有區塊外的規則）；收起「← 首頁」
    const body = b.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    r[k] = blocks.length === 1 && /^@media \(min-width: 1024px\) \{[\s\S]*\n  \}$/.test(body) && body.includes(back) && /var\(--ui-/.test(body);
  }
  r.S4 = /\.post-list \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(get('src/routes/deck-posts/+page.svelte'));
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] THEMED_ROUTES 含 /decks、/deck-posts', C.S1);
ok('★★★[S2] /decks：v6476 哨兵恰好一塊、整塊是 min-width:1024px、讀 --ui-*、收起「← 首頁」', C.S2);
ok('★★★[S3] /deck-posts：同上', C.S3);
ok('★★[S4] /deck-posts 網頁版投稿列表兩欄', C.S4);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.475 全紅', !B.S1 && !B.S2 && !B.S3 && !B.S4, JSON.stringify(B));
} else shallowSkip('v6476 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.476 decks theme') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.476 decks theme');
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
    // ⭐v6.507（Rule 40）：頁首改用共用元件 PageHeader，「← 首頁」不是藏起來而是從標記拿掉了 ⇒ 原本量 `.page-head > .back` 的 display
//   會拿到 null。意圖不變（頁首裡看不到回首頁的連結）⇒ 改成「頁首裡有沒有看得見、指向首頁的連結」：沒有 ⇒ 'none'。
const homeLinkInHead = (pg) => pg.evaluate(() => [...document.querySelectorAll('.page-head a')]
  .some((a) => /^\/?$/.test(a.getAttribute('href') || '') && getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 0) ? 'shown' : 'none');
const lum = (rgb) => { const m = String(rgb).match(/\d+/g); if (!m) return -1; const [r, g, b] = m.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const open = async (w, h, theme, path, mobile = false) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      return { ctx, pg };
    };
    const css = (pg, sel, prop) => pg.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
    try {
      let { ctx, pg } = await open(1440, 900, 'dark', '/decks');
      const D = { body: await css(pg, 'body', 'backgroundColor'), rail: await css(pg, '.rail', 'backgroundColor'), picker: await css(pg, '.picker', 'backgroundColor'), h1: await css(pg, '.page-head h1', 'color'), back: await homeLinkInHead(pg), chip: await css(pg, '.pk-chip:not(.active)', 'color') };
      await ctx.close();
      // ⭐v6.511／v6.512（Rule 40）：色票調亮／調暗一階後，亮度門檻放寬到仍可區分深淺、精確值改讀現行色票（意圖不變）
      ok('★★★[E1] /decks 深色：底色、三欄面板深色，標題與篩選文字淺色，「← 首頁」收起', lum(D.body) < 60 && lum(D.rail) < 80 && lum(D.picker) < 80 && lum(D.h1) > 200 && lum(D.chip) > 200 && D.back === 'none', JSON.stringify(D));
      ({ ctx, pg } = await open(1440, 900, 'light', '/deck-posts'));
      const P = { body: await css(pg, 'body', 'backgroundColor'), head: await css(pg, '.page-head', 'borderTopLeftRadius'), back: await homeLinkInHead(pg) };
      await ctx.close();
      ok('★★[E2] /deck-posts 淺色：主題底色、頁首卡片、「← 首頁」收起', lum(P.body) > 215 && P.head === '16px' && P.back === 'none', JSON.stringify(P));
      // ⭐v6.498（Rule 40，站長手機清單第 6 項「深色主題目前只有電腦版：手機沒有切換鈕、系統深色時仍是淺色」）：
      //   手機深色改成吃主題色 ⇒ 原本「手機深色也維持舊樣式」的判準拆成兩條：淺色＝顏色與版面全部維持舊樣式；深色＝版面維持、顏色吃主題。
      const md = async (scheme) => {
        ({ ctx, pg } = await open(390, 844, scheme, '/decks', true));
        const r = { body: await css(pg, 'body', 'backgroundColor'), rail: await css(pg, '.rail', 'backgroundColor'), radius: await css(pg, '.rail', 'borderTopLeftRadius'), back: await homeLinkInHead(pg) };
        await ctx.close(); return r;
      };
      const M = await md('light'), MD = await md('dark');
      // ⭐v6.504（Rule 40）：站長要求全站版面統一（以電腦版綠色系為基準、手機拿掉「← 首頁」）⇒ 手機淺色也吃 --ui-* 色票；版面（寬度、圓角、排列）不變。
      ok('★★★[E3] 手機 390 淺色：/decks 白面板、8px 圓角不變；底色吃主題、「← 首頁」收起（v6.504）', M.body === uiColor(ROOT, 'light', '--ui-bg') && M.rail === uiColor(ROOT, 'light', '--ui-bg-elev') && M.radius === '8px' && M.back === 'none', JSON.stringify(M));
      ok('★★[E3b] 手機 390 深色：/decks 8px 圓角不變、顏色吃深色主題、「← 首頁」收起（v6.504）', MD.body === uiColor(ROOT, 'dark', '--ui-bg') && MD.rail === uiColor(ROOT, 'dark', '--ui-bg-elev') && MD.radius === '8px' && MD.back === 'none', JSON.stringify(MD));
      const mp = async (scheme) => {
        ({ ctx, pg } = await open(390, 844, scheme, '/deck-posts', true));
        const r = { body: await css(pg, 'body', 'backgroundColor'), back: await homeLinkInHead(pg), head: await css(pg, '.page-head', 'borderTopLeftRadius') };
        await ctx.close(); return r;
      };
      const MP = await mp('light'), MPD = await mp('dark');
      ok('★★[E4] 手機 390 淺色：/deck-posts 底色吃主題、頁首是卡片、「← 首頁」收起（v6.504）', MP.body === uiColor(ROOT, 'light', '--ui-bg') && MP.back === 'none' && MP.head !== '0px', JSON.stringify(MP));
      ok('★★[E4b] 手機 390 深色：/deck-posts 底色吃深色主題、頁首是卡片、「← 首頁」收起（v6.504）', MPD.body === uiColor(ROOT, 'dark', '--ui-bg') && MPD.back === 'none' && MPD.head !== '0px', JSON.stringify(MPD));
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
