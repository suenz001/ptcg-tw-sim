#!/usr/bin/env node
/**
 * v6.504 守衛：全站版面統一 第 1 步（站長 2026-10-07：「每個功能都是在不同次更新做的…排版、色調都弄得一致」；
 *   選定「以電腦版現有綠色系為基準」「手機拿掉 ← 首頁、電腦統一」「版本號只留首頁與頂端列」）。
 * 【S】五頁的 v6498 色票區塊前綴改成手機不分深淺；卡牌／牌組／公布欄／好友頁有 v6504-unify 區塊；layout 手機淺色底色
 * 【E】390×844 淺色、深色：卡牌資料庫／牌組編輯器／公布欄／好友頁的頁首都是同一種卡片（14px 圓角、有框線）、頂端同一高度、
 *      看不到「← 首頁」與版本號、底色＝--ui-bg；1440 桌機：牌組／公布欄／好友頁看不到版本號，卡牌／牌組頁首仍是 16px 圓角（桌機版面不動）
 * HEAD-FAIL：靜態判準餵 v6.503 逐條紅。
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.503。
const BASE_SHA = '99fa08a2';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const P = ':global(html:not([data-ui-wide]))';
const PAGES5 = ['src/routes/+page.svelte', 'src/routes/cards/+page.svelte', 'src/routes/card/[id]/+page.svelte', 'src/routes/decks/+page.svelte', 'src/routes/deck-posts/+page.svelte'];
function judge(get) {
  const r = {};
  r.S1 = PAGES5.every((f) => { const b = (get(f).match(/  \/\* >>> v6498-mobile-dark \*\/\n[\s\S]*?  \/\* <<< v6498-mobile-dark \*\//) || [''])[0];
    return b.length > 500 && !b.includes("html[data-theme='dark']:not([data-ui-wide])") && b.split(P).length > 10; });
  const blk = (f) => (get(f).match(/\/\* >>> v6504-unify \*\/[\s\S]*?\/\* <<< v6504-unify \*\//) || [''])[0];
  r.S2 = blk('src/routes/cards/+page.svelte').includes(P + ' .back[href$="/"] { display: none; }')
    && blk('src/routes/decks/+page.svelte').includes(P + ' .page-head > .back { display: none; }')
    && blk('src/routes/decks/+page.svelte').includes(':global(html) .version-tag { display: none; }')
    && blk('src/routes/deck-posts/+page.svelte').includes(P + ' .page-head > .back { display: none; }')
    && blk('src/routes/friends/+page.svelte').includes('.page-head > .back, .version-tag { display: none; }');
  r.S3 = get('src/routes/+layout.svelte').includes(":global(html[data-ui-themed][data-theme='light']:not([data-ui-wide]):not([data-battle-view]) body) { background: var(--ui-bg); color: var(--ui-text); }");
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] 五頁的色票區塊改成手機不分深淺（前綴 html:not([data-ui-wide])）', C.S1);
ok('★★★[S2] 四頁的 v6504-unify：手機收起「← 首頁」、版本號收起', C.S2);
ok('★★[S3] layout：手機淺色底色是 --ui-bg', C.S3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((f) => { const b = readBaseBlob(ROOT, BASE_SHA, f); return b.ok ? b.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[S0] HEAD-FAIL：v6.503 全紅', !B.S1 && !B.S2 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6504 S0', '需要 BASE commit');
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.504') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.504');
  if (browser) {
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
    const HEAD = { '/cards': 'header:has(h1)', '/decks': '.page-head', '/deck-posts': '.page-head', '/friends': '.page-head' };
    const probe = (pg, sel) => pg.evaluate((s) => {
      const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
      const h = document.querySelector(s); const cs = h ? getComputedStyle(h) : null;
      return { top: h ? Math.round(h.getBoundingClientRect().top) : null, radius: cs?.borderTopLeftRadius, border: cs?.borderTopWidth,
        back: [...document.querySelectorAll('a.back')].filter((a) => /\/$/.test(a.getAttribute('href') || '') && vis(a)).length,
        ver: [...document.querySelectorAll('.version-tag')].filter(vis).length, body: getComputedStyle(document.body).backgroundColor };
    }, sel);
    try {
      for (const theme of ['light', 'dark']) {
        const got = {};
        for (const [path, sel] of Object.entries(HEAD)) {
          const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
          await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
          await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
          const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
          await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1200);
          got[path] = await probe(pg, sel);
          await ctx.close();
        }
        const BG = theme === 'light' ? 'rgb(243, 245, 244)' : 'rgb(22, 40, 22)';
        const v = Object.values(got);
        ok(`★★★[E1] 手機 ${theme}：四頁頁首都是同一種卡片（14px 圓角、有框線）`, v.every((g) => g.radius === '14px' && g.border === '1px'), JSON.stringify(got));
        ok(`★★★[E2] 手機 ${theme}：四頁頁首頂端同一高度`, v.every((g) => g.top === v[0].top) && v[0].top <= 16, JSON.stringify(v.map((g) => g.top)));
        ok(`★★★[E3] 手機 ${theme}：看不到「← 首頁」與版本號`, v.every((g) => g.back === 0 && g.ver === 0), JSON.stringify(v.map((g) => [g.back, g.ver])));
        ok(`★★[E4] 手機 ${theme}：底色都是 --ui-bg`, v.every((g) => g.body === BG), JSON.stringify(v.map((g) => g.body)));
      }
      const dk = {};
      for (const [path, sel] of Object.entries(HEAD)) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
        await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1200);
        dk[path] = await probe(pg, sel);
        await ctx.close();
      }
      ok('★★[E5] 1440：牌組／公布欄／好友頁看不到版本號、看不到「← 首頁」', Object.values(dk).every((g) => g.ver === 0 && g.back === 0), JSON.stringify(dk));
      ok('★★[E6] 1440：卡牌資料庫、牌組編輯器的頁首仍是網頁版的 16px 圓角（桌機版面不動）', dk['/cards'].radius === '16px' && dk['/decks'].radius === '16px', JSON.stringify(dk));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== v6.504 全站版面統一（第 1 步）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
