#!/usr/bin/env node
/**
 * v6.475 守衛：網頁版主題第二步（站長 2026-10-05 驗收 v6.474 的五點回饋）。
 *   ① 對戰演練／錦標賽兩張主要動作卡在淺色主題不可以是深綠（改讀 --ui-cta-*）。
 *   ② 頂端列跟著主題：淺色＝白底深字、深色＝深底淺字（讀 --ui-topbar-*）。
 *   ③ /game、/tournament 的大廳也顯示頂端列；牌桌畫面由對戰頁掛 <html data-battle-view> 收起
 *      （對戰頁用 $derived 布林＋$effect 寫屬性、onDestroy 拿掉；判準在 $lib/site-theme 的 isBattleView）。
 *   ④ 卡牌資料庫、單卡頁接上淺深主題（THEMED_ROUTES）＋網頁版版面優化，全部在 min-width:1024px 內 ⇒ 手機不變。
 *
 * 判準：靜態接線＋真瀏覽器（build/）量 computed style。HEAD-FAIL：BASE（v6.474）的頂端列寫死深綠、首頁 CTA 寫死深綠。
 * Run: node scripts/test-v6475-theme-pages.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';   // ⭐v6.511 色票唯一讀取點（不寫死色碼）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.474。
const BASE_SHA = '70cbb85d';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const stripC = (x) => x.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const styleOf = (src) => stripC(src.slice(src.lastIndexOf('<style>')));

// 判準（同一份餵現行版與 BASE）
function judgeStatic(get) {
  const TB = styleOf(get('src/lib/SiteTopBar.svelte'));
  const HOME = styleOf(get('src/routes/+page.svelte'));
  const r = {};
  // ② 頂端列不可寫死任何底色／字色（全部讀 --ui-topbar-*）
  const stbBlock = (TB.match(/\n    \.stb \{[^}]*\}/) || [''])[0];
  r.S1 = /background: var\(--ui-topbar-bg\);/.test(stbBlock) && !/background: #/.test(stbBlock)
    && /\.stb-name \{[^}]*color: var\(--ui-topbar-text\);/.test(TB) && /\.stb-link \{[^}]*color: var\(--ui-topbar-muted\);/.test(TB);
  // ① 首頁主要動作卡讀 --ui-cta-*，不寫死深綠
  const cta = [...HOME.matchAll(/\.hm-card-game, \.hm-card-tourn \{[^}]*\}/g)].map((m) => m[0]).find((b) => /background/.test(b)) || '';
  r.S2 = /background: var\(--ui-cta-bg\);/.test(cta) && /border-color: var\(--ui-cta-border\);/.test(cta) && !/#0f2a1c|#1f4a33/.test(cta);
  return r;
}
console.log('【S】靜態接線');
const CUR = judgeStatic(rd);
ok('★★★[S1] 頂端列底色／字色全部讀 --ui-topbar-*（不寫死深綠）', CUR.S1);
ok('★★★[S2] 首頁對戰／錦標賽卡讀 --ui-cta-*（不寫死深綠）', CUR.S2);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judgeStatic(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.474 必須紅（頂端列與 CTA 寫死深綠）', !B.S1 && !B.S2, JSON.stringify(B));
} else shallowSkip('v6475 S0：HEAD-FAIL', '需要 BASE commit');

const LAYOUT = rd('src/routes/+layout.svelte');
const tokLight = (LAYOUT.match(/:global\(:root\) \{\n    --ui-bg:[^}]*\}/) || [''])[0];
const tokDark = (LAYOUT.match(/:global\(html\[data-theme='dark'\]\) \{[^}]*\}/) || [''])[0];
const NEED = ['--ui-topbar-bg', '--ui-topbar-text', '--ui-topbar-muted', '--ui-topbar-hover', '--ui-topbar-border', '--ui-cta-bg', '--ui-cta-text', '--ui-cta-border', '--ui-cta-desc', '--ui-cta-icon-bg', '--ui-input-bg', '--ui-chip-active-bg', '--ui-chip-active-text'];
ok('★★[S3] 新色票淺色、深色兩套都有定義（少一個深色就會吃到淺色值）', NEED.every((k) => tokLight.includes(k + ':') && tokDark.includes(k + ':')), NEED.filter((k) => !tokLight.includes(k + ':') || !tokDark.includes(k + ':')).join());
// ⭐v6.511（Rule 40）：淺色主題整組降一階（站長看過預覽圖同意）⇒ 頂端列改「淺色（不是深綠）」、主要動作卡起色＝--ui-accent-soft；意圖（淺色主題不是深綠）不變
ok('★★[S4] 淺色主題頂端列是淺底、主要動作卡不是深色', (() => { const m = /--ui-topbar-bg: #([0-9a-f]{6});/.exec(tokLight); return !!m && parseInt(m[1].slice(2, 4), 16) > 200; })() && /--ui-cta-bg: linear-gradient\(135deg, var\(--ui-accent-soft\)|--ui-cta-bg: linear-gradient\(135deg, #d3e8dc/.test(tokLight));

const GAME = rd('src/routes/game/+page.svelte');
ok('★★★[S5] 對戰頁：$derived 布林（盤面更新不重寫屬性）＋$effect 寫 data-battle-view＋onDestroy 拿掉',
  GAME.includes("import { isBattleView, setBattleViewAttr } from '$lib/site-theme';")
  && /const _v6475BattleView = \$derived\(isBattleView\([^\n]*, base, isTournament, tStep, !!game\)\);\n  \$effect\(\(\) => \{ setBattleViewAttr\(_v6475BattleView\); \}\);\n(?:  \/\/[^\n]*\n)*  onDestroy\(\(\) => setBattleViewAttr\(false\)\);/.test(GAME));
ok('★★[S6] 頂端列在 data-battle-view 時收起（只在網頁版區塊內）', /@media \(min-width: 1024px\) \{[\s\S]*:global\(html\[data-battle-view\]\) \.stb \{ display: none; \}/.test(styleOf(rd('src/lib/SiteTopBar.svelte'))));
// ④ 卡牌頁／單卡頁的新規則只在 min-width:1024px
for (const [nm, p, head] of [['卡牌資料庫', 'src/routes/cards/+page.svelte', '@media (min-width: 1024px) {\n    header, .markSection'], ['單卡頁', 'src/routes/card/[id]/+page.svelte', '@media (min-width: 1024px) {\n    .card-page {']]) {
  const st = styleOf(rd(p));
  const i = st.indexOf(head);
  ok(`★★[S7] ${nm}：主題規則集中在一個 min-width:1024px 區塊、區塊外沒有 --ui-* 變數`, i > 0 && !/var\(--ui-/.test(st.slice(0, i)));
}
ok('★[S8] 卡牌頁網頁版收起「← 首頁」、保留「← 卡包列表」', /\.back\[href\$="\/"\] \{ display: none; \}/.test(styleOf(rd('src/routes/cards/+page.svelte'))));

// ── 真瀏覽器 ──────────────────────────────────────────────────────────
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.475 theme pages') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.475 theme pages');
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
    const open = async (w, h, theme, path, mobile = false) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      return { ctx, pg };
    };
    // 亮度（0～255）：判斷「淺色／深色」不綁死確切色碼
    const lum = (rgb) => { const m = String(rgb).match(/\d+/g); if (!m) return -1; const [r, g, b] = m.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const css = (pg, sel, prop) => pg.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
    try {
      let { ctx, pg } = await open(1440, 900, 'light', '/');
      const L = { bar: await css(pg, '.stb', 'backgroundColor'), barText: await css(pg, '.stb-name', 'color'), cta: await css(pg, '.hm-card-game', 'backgroundImage'), ctaTitle: await css(pg, '.hm-card-game .hm-title', 'color') };
      await ctx.close();
      ok('★★★[E1] 淺色：頂端列白底深字、對戰卡是淡色漸層深字', lum(L.bar) > 225 && lum(L.barText) < 80 && /linear-gradient/.test(L.cta || '') && (L.cta || '').includes(uiColor(ROOT, 'light', '--ui-accent-soft').slice(4, -1)) && lum(L.ctaTitle) < 80, JSON.stringify(L));
      ({ ctx, pg } = await open(1440, 900, 'dark', '/'));
      const D = { bar: await css(pg, '.stb', 'backgroundColor'), barText: await css(pg, '.stb-name', 'color'), ctaTitle: await css(pg, '.hm-card-game .hm-title', 'color') };
      await ctx.close();
      ok('★★[E2] 深色：頂端列深底淺字、對戰卡淺字', lum(D.bar) < 55 && lum(D.barText) > 200 && lum(D.ctaTitle) > 200, JSON.stringify(D));
      // 卡牌資料庫（卡包頁＋卡片頁）、單卡頁：深色時面板是深色、文字淺色
      ({ ctx, pg } = await open(1440, 900, 'dark', '/cards?set=M6'));
      await pg.waitForTimeout(800);
      const C = { body: await css(pg, 'body', 'backgroundColor'), panel: await css(pg, '.controls', 'backgroundColor'), h1: await css(pg, 'header h1', 'color'), tile: await css(pg, '.cardBtn', 'backgroundColor'), name: await css(pg, '.cardLabel .name', 'color'), back: await css(pg, '.back', 'display') };
      await ctx.close();
      ok('★★★[E3] /cards?set= 深色：底色、篩選面板、卡片格都是深色，文字淺色；「← 卡包列表」仍在', lum(C.body) < 60 && lum(C.panel) < 80 && lum(C.tile) < 80 && lum(C.h1) > 200 && lum(C.name) > 200 && C.back !== 'none', JSON.stringify(C));
      ({ ctx, pg } = await open(1440, 900, 'light', '/cards'));
      const CI = { body: await css(pg, 'body', 'backgroundColor'), set: await css(pg, '.setTile:not(.setTileAll)', 'backgroundColor'), home: await pg.evaluate(() => [...document.querySelectorAll('header.ph a')].some((a) => /^\/?$/.test(a.getAttribute('href') || '') && getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 0) ? 'shown' : 'none') };
      // ⭐v6.507（Rule 40）：頁首改用共用元件，「← 首頁」從標記拿掉（不是藏起來）⇒ 改量「頁首裡看得見、指向首頁的連結」；意圖不變。
      await ctx.close();
      ok('★★[E4] /cards 卡包列表淺色：白卡；網頁版「← 首頁」收起', lum(CI.body) > 215 && lum(CI.set) > 230 && CI.home === 'none', JSON.stringify(CI));
      ({ ctx, pg } = await open(1440, 900, 'dark', '/card/19378/'));
      const K = { body: await css(pg, 'body', 'backgroundColor'), box: await css(pg, '.body', 'backgroundColor'), disp: await css(pg, '.body', 'display'), td: await css(pg, '.info td', 'color'), img: await css(pg, '.img', 'width') };
      await ctx.close();
      ok('★★[E5] 單卡頁深色：資料卡深色、表格文字淺色、卡圖 340px、兩欄 grid', lum(K.body) < 60 && lum(K.box) < 80 && lum(K.td) > 200 && K.img === '340px' && K.disp === 'grid', JSON.stringify(K));
      // 手機：卡牌頁與單卡頁完全沿用舊樣式（不吃主題）
      // ⭐v6.498（Rule 40，站長手機清單第 6 項「深色主題目前只有電腦版：手機沒有切換鈕、系統深色時仍是淺色」）：
      //   手機深色改成吃主題色 ⇒ 原本「手機深色也維持舊樣式」的判準拆成兩條：淺色＝顏色與版面全部維持舊樣式；深色＝版面維持、顏色吃主題。
      const mc = async (scheme) => {
        ({ ctx, pg } = await open(390, 844, scheme, '/cards?set=M6', true));
        await pg.waitForTimeout(800);
        const r = { body: await css(pg, 'body', 'backgroundColor'), radius: await css(pg, '.controls', 'borderTopLeftRadius'), panel: await css(pg, '.controls', 'backgroundColor') };
        await ctx.close(); return r;
      };
      const MC = await mc('light'), MCD = await mc('dark');
      // ⭐v6.504（Rule 40）：站長要求全站版面統一（以電腦版綠色系為基準、手機拿掉「← 首頁」）⇒ 手機淺色也吃 --ui-* 色票；版面（寬度、圓角、排列）不變。
      ok('★★★[E6] 手機 390 淺色：/cards 底色與篩選區吃主題色票、版面不變（v6.504）', MC.body === uiColor(ROOT, 'light', '--ui-bg') && MC.radius === '0px' && MC.panel === uiColor(ROOT, 'light', '--ui-bg-elev'), JSON.stringify(MC));
      ok('★★[E6b] 手機 390 深色：/cards 版面維持（篩選區 0 圓角），顏色吃深色主題', MCD.body === uiColor(ROOT, 'dark', '--ui-bg') && MCD.radius === '0px' && MCD.panel === uiColor(ROOT, 'dark', '--ui-bg-elev'), JSON.stringify(MCD));
      const mk = async (scheme) => {
        ({ ctx, pg } = await open(390, 844, scheme, '/card/19378/', true));
        const r = { box: await css(pg, '.body', 'backgroundColor'), disp: await css(pg, '.body', 'display'), page: await css(pg, '.card-page', 'maxWidth') };
        await ctx.close(); return r;
      };
      const MK = await mk('light'), MKD = await mk('dark');
      ok('★★[E7] 手機 390 淺色：單卡頁版面不變（flex、760 上限），底色吃主題（v6.504）', MK.disp === 'flex' && MK.page === '760px' && MK.box === uiColor(ROOT, 'light', '--ui-bg-elev'), JSON.stringify(MK));
      ok('★★[E7b] 手機 390 深色：單卡頁版面維持（flex、760 上限），顏色吃深色主題', MKD.disp === 'flex' && MKD.page === '760px' && MKD.box === uiColor(ROOT, 'dark', '--ui-bg-elev'), JSON.stringify(MKD));
      // 錦標賽大廳也有頂端列（active＝錦標賽）
      ({ ctx, pg } = await open(1440, 900, 'light', '/tournament'));
      const T = { disp: await css(pg, '.stb', 'display'), act: await pg.evaluate(() => [...document.querySelectorAll('.stb-link.active')].map((a) => a.textContent).join()), bv: await pg.evaluate(() => document.documentElement.hasAttribute('data-battle-view')) };
      await ctx.close();
      ok('★★[E8] /tournament 大廳顯示頂端列、目前頁＝錦標賽、沒有 data-battle-view', T.disp === 'block' && T.act === '錦標賽' && !T.bv, JSON.stringify(T));
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
