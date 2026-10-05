#!/usr/bin/env node
/**
 * v6.480 守衛：卡牌資料庫與牌組編輯器的網頁版（≥1024px）操作優化。
 *   ① 卡牌資料庫：滑鼠停在卡上 0.25 秒後放大 1.2 倍（規則在 v6475-desktop-theme 的 min-width:1024px 內）；
 *      1024 寬時最邊欄放大也不會冒出橫向捲軸。
 *   ② 卡牌資料庫：篩選面板捲出畫面後，頂端列下方浮出迷你搜尋列（$lib/cards/CardsMiniBar.svelte），
 *      搜尋字串與面板同一份；捲回來就收起；手機不建觀察器、不顯示。
 *   ③ 牌組編輯器：找卡面板 sticky 在頂端列下方、高度不超過視窗（規則在 v6476-desktop-theme 內）；手機不變。
 * HEAD-FAIL：同一份靜態判準餵 v6.479 必須紅。
 * Run: node scripts/test-v6480-cards-decks-desktop.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.479。
const BASE_SHA = 'b14950dc';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const blk = (src, tag) => (src.match(new RegExp('/\\* >>> ' + tag + ' \\*/[\\s\\S]*?/\\* <<< ' + tag + ' \\*/')) || [''])[0];
function judge(get) {
  const r = {};
  const C = get('src/routes/cards/+page.svelte');
  const b5 = blk(C, 'v6475-desktop-theme');
  r.S1 = /\.cardBtn:hover \{ z-index: 3; transform: scale\(1\.2\); transition-delay: 0\.25s; \}/.test(b5);
  r.S2 = C.includes("import CardsMiniBar from '$lib/cards/CardsMiniBar.svelte';") && /<CardsMiniBar bind:query count=\{filtered\.length\} target=\{controlsEl\}/.test(C) && C.includes('<div class="controls" bind:this={controlsEl}>');
  const M = get('src/lib/cards/CardsMiniBar.svelte');
  r.S3 = !!M && /matchMedia\('\(min-width: 1024px\)'\)\.matches\) return;/.test(M) && /new IntersectionObserver/.test(M) && /\.cmb \{ display: none; \}/.test(M);
  const D = get('src/routes/decks/+page.svelte');
  const b6 = blk(D, 'v6476-desktop-theme');
  r.S4 = /\.picker \{\n\s*position: sticky;/.test(b6) && /overflow-y: auto;/.test(b6) && /\.picker-list \{ max-height: none;/.test(b6);
  return r;
}
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 卡牌資料庫：懸停放大規則在網頁版主題區塊（min-width:1024px）內', J.S1);
ok('★★★[S2] 卡牌資料庫：迷你搜尋列與面板共用 query、觀察的是篩選面板', J.S2);
ok('★★[S3] 迷你搜尋列元件：只在網頁版建觀察器、基底不顯示', J.S3);
ok('★★★[S4] 牌組編輯器：找卡面板 sticky＋放不下時自己捲（在 v6476 區塊內）', J.S4);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.479 全紅', !B.S1 && !B.S2 && !B.S3 && !B.S4, JSON.stringify(B));
} else shallowSkip('v6480 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.480') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.480');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    const open = async (w, h, path, mobile = false) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForSelector(path.startsWith('/decks') ? '.picker' : '.cardBtn', { timeout: 20000 }).catch(() => {}); await pg.waitForTimeout(800);
      return { ctx, pg };
    };
    try {
      let { ctx, pg } = await open(1440, 900, '/cards?set=ALL');
      await pg.hover('.cardBtn >> nth=1'); await pg.waitForTimeout(700);
      const T = await pg.evaluate(() => getComputedStyle(document.querySelectorAll('.cardBtn')[1]).transform);
      await pg.mouse.move(5, 5); await pg.waitForTimeout(500);
      const T0 = await pg.evaluate(() => getComputedStyle(document.querySelectorAll('.cardBtn')[1]).transform);
      ok('★★★[E1] 1440：停在卡上會放大 1.2 倍、移開恢復', /^matrix\(1\.2, 0, 0, 1\.2,/.test(T) && (T0 === 'none' || /^matrix\(1, 0, 0, 1,/.test(T0)), T + ' / ' + T0);
      // 迷你搜尋列：捲到面板上方 → 出現；打字同步；捲回頂端 → 收起
      const has0 = await pg.evaluate(() => !!document.querySelector('.cmb'));
      await pg.evaluate(() => window.scrollTo(0, 900)); await pg.waitForTimeout(500);
      const has1 = await pg.evaluate(() => !!document.querySelector('.cmb') && getComputedStyle(document.querySelector('.cmb')).position === 'fixed');
      if (has1) { await pg.fill('.cmb-input', '寶'); await pg.waitForTimeout(400); }
      const sync = await pg.evaluate(() => document.querySelector('.controls input[type=search]')?.value);
      await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(500);
      const has2 = await pg.evaluate(() => !!document.querySelector('.cmb'));
      await ctx.close();
      ok('★★★[E2] 1440：面板捲出去才浮出迷你搜尋列、打字與面板同步、捲回頂端收起', !has0 && has1 && sync === '寶' && !has2, JSON.stringify({ has0, has1, sync, has2 }));
      ({ ctx, pg } = await open(1024, 768, '/cards?set=ALL'));
      const edge = await pg.evaluate(() => { const bs = [...document.querySelectorAll('.cardBtn')]; const top = bs[0].getBoundingClientRect().top; const row = bs.filter((b) => Math.abs(b.getBoundingClientRect().top - top) < 2); return row.length; });
      await pg.hover('.cardBtn >> nth=0'); await pg.waitForTimeout(700);
      const sw1 = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await pg.hover(`.cardBtn >> nth=${edge - 1}`); await pg.waitForTimeout(700);
      const sw2 = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await ctx.close();
      ok('★★★[E3] 1024：最左與最右一欄放大都不會冒出橫向捲軸', sw1 <= 0 && sw2 <= 0 && edge >= 4, JSON.stringify({ edge, sw1, sw2 }));
      ({ ctx, pg } = await open(390, 844, '/cards?set=ALL', true));
      await pg.evaluate(() => window.scrollTo(0, 1500)); await pg.waitForTimeout(500);
      const MB = await pg.evaluate(() => !!document.querySelector('.cmb'));
      await ctx.close();
      ok('★★★[E4] 手機 390：捲下去也沒有迷你搜尋列', !MB);
      ({ ctx, pg } = await open(1440, 900, '/decks'));
      await pg.click('.preset-summary'); await pg.waitForTimeout(300);
      await pg.locator('.preset-list li button').first().click(); await pg.waitForTimeout(1200);
      await pg.evaluate(() => window.scrollTo(0, 1200)); await pg.waitForTimeout(500);
      const P = await pg.evaluate(() => { const r = document.querySelector('.picker').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, sy: Math.round(scrollY) }; });
      await ctx.close();
      ok('★★★[E5] 1440 牌組編輯器：捲到下方時找卡面板仍貼在頂端列下方、整塊在畫面內', P.sy > 300 && P.top >= 60 && P.top <= 80 && P.bottom <= P.vh, JSON.stringify(P));
      ({ ctx, pg } = await open(390, 844, '/decks', true));
      const MP = await pg.evaluate(() => getComputedStyle(document.querySelector('.picker')).position);
      await ctx.close();
      ok('★★★[E6] 手機 390 牌組編輯器：找卡面板維持一般排版（不 sticky）', MP === 'static', MP);
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
