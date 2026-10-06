#!/usr/bin/env node
/**
 * v6.503 守衛：手機底部導覽列切到「公布欄」時畫面往上跳（站長回報 2026-10-07）。
 *   原因：公布欄手機頂端只留 10px，標題比牌組編輯器（24px）高一截，切頁時看起來像整頁往上跳。
 * 【S】公布欄手機 main 頂端留白 24px（保留 safe-top）
 * 【E】390×844：從卡牌／牌組／首頁經底部導覽列切到公布欄，標題與牌組編輯器的標題同一高度、捲動位置 0
 * HEAD-FAIL：靜態判準餵 v6.502 必須紅。
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.502。
const BASE_SHA = 'f5e7287e';
const FILE = 'src/routes/deck-posts/+page.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const judge = (src) => /@media \(max-width: 600px\) \{[\s\S]*?main \{\s*padding: calc\(24px \+ var\(--safe-top, 0px\)\)/.test(src);
console.log('【S】靜態');
ok('★★★[S1] 公布欄手機頂端留白 24px（保留 safe-top）', judge(rd(FILE)));
if (hasBaseCommit(ROOT, BASE_SHA)) { const b = readBaseBlob(ROOT, BASE_SHA, FILE); ok('★★[S0] HEAD-FAIL：v6.502 為紅', !judge(b.ok ? b.out : '')); }
else shallowSkip('v6503 S0', '需要 BASE commit');
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.501') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.501');
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
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      const top = () => pg.evaluate(() => ({ h1: Math.round(document.querySelector('h1').getBoundingClientRect().top), y: Math.round(scrollY), path: location.pathname }));
      await pg.goto(`http://localhost:${port}/decks`, { waitUntil: 'load' }); await pg.waitForTimeout(1200);
      const D = await top();
      const got = [];
      for (const from of ['/cards', '/decks', '/']) {
        await pg.goto(`http://localhost:${port}${from}`, { waitUntil: 'load' }); await pg.waitForTimeout(1000);
        await pg.evaluate(() => scrollTo(0, 400));
        await pg.click('.sbn-link:has-text("公布欄")'); await pg.waitForTimeout(1000);
        got.push({ from, ...(await top()) });
      }
      await ctx.close();
      ok('★★★[E1] 從卡牌／牌組／首頁切到公布欄：標題與牌組編輯器同一高度、捲動位置 0',
        got.every((g) => g.path === '/deck-posts' && g.h1 === D.h1 && g.y === 0), JSON.stringify({ D, got }));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== v6.503 公布欄切頁不跳：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
