#!/usr/bin/env node
/**
 * v6.510 守衛：深色主題的牌組編輯器「內建預組」清單看不清楚
 *   （站長 2026-10-07：「深色模式的編輯牌組裡面的預設牌組的字太淡了 根本看不清楚」）。
 *
 * 根因：.preset-list li 的淡橙底（#fff5e6）是淺色主題寫死的；深色主題的字是淺色 ⇒ 淺字配淺底（對比約 1.1:1）。
 * 修法：深色主題的未選中預組列改用色票 --ui-bg-sunken；淺色主題照舊淡橙底；選中那一列照舊用主題的強調底。
 *
 * 【S】靜態：深色規則存在、只讀色票、用 :not(.active) 不蓋掉選中列；淺色的淡橙底還在
 * 【E】真瀏覽器（build/）：390 手機與 1280 網頁版、深色：預組列文字對比 ≥ 4.5；淺色：底色仍是淡橙（零回歸）；
 *      深色選中列仍是強調底（不是凹陷底）
 * 【H】HEAD-FAIL：靜態判準餵 v6.509 必紅
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.509。
const BASE_SHA = '7be9a6f6';
const P = 'src/routes/decks/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const RULE = ":global(html[data-theme='dark']) .preset-list li:not(.active) { background: var(--ui-bg-sunken); }";
function judge(src) {
  const css = ((src.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1]).replace(/\/\*[\s\S]*?\*\//g, '');
  return {
    S1: css.includes(RULE),
    S2: css.includes('.preset-list li { background: #fff5e6; }'),
  };
}

console.log('【S】靜態');
const cur = judge(readFileSync(join(ROOT, P), 'utf8').replace(/\r\n/g, '\n'));
ok('★★★[S1] 深色主題：未選中的預組列改用色票凹陷底（:not(.active) 不蓋掉選中列）', cur.S1);
ok('★★[S2] 淺色主題的淡橙底照舊（唯讀提示不變）', cur.S2);

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = readBaseBlob(ROOT, BASE_SHA, P);
  if (rb.ok) { const b = judge(rb.out.replace(/\r\n/g, '\n')); ok('★★[H1] v6.509 沒有深色規則 ⇒ S1 在 BASE 必紅、S2 在 BASE 成立', !b.S1 && b.S2, JSON.stringify(b)); }
  else shallowSkip('v6510 H', '讀不到 BASE blob');
} else shallowSkip('v6510 H', '需要 v6.509 commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.510') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.510');
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
    // 量測：打開預組區塊，取第一列未選中的預組（文字顏色、列底色、對比）；再把它設成選中列量底色
    const measure = async (theme, vw) => {
      const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, serviceWorkers: 'block', colorScheme: theme });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/decks`, { waitUntil: 'load' });
      await pg.waitForSelector('.preset-list li', { state: 'attached', timeout: 15000 }).catch(() => {});
      const r = await pg.evaluate(() => {
        const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const d = document.querySelector('details.preset-section'); if (d) d.open = true;
        const lis = [...document.querySelectorAll('.preset-list li')];
        const li = lis.find((x) => !x.classList.contains('active'));
        if (!li) return { n: lis.length };
        const name = li.querySelector('.deck-name') || li;
        const bg = getComputedStyle(li).backgroundColor, color = getComputedStyle(name).color;
        const L1 = lum(color), L2 = lum(bg);
        li.classList.add('active');   // 選中列：主題規則的強調底仍要生效（不被本版的凹陷底蓋掉）
        const activeBg = getComputedStyle(li).backgroundColor;
        li.classList.remove('active');
        return { n: lis.length, bg, color, activeBg, cr: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2) };
      });
      await ctx.close();
      return r;
    };
    try {
      for (const vw of [390, 1280]) {
        const dk = await measure('dark', vw), lt = await measure('light', vw);
        ok(`★★★[E1-${vw}] 深色：預組列文字對比 ≥ 4.5（原本淺字配淡橙底約 1.1）`, dk.n > 0 && dk.cr >= 4.5, JSON.stringify(dk));
        ok(`★★[E2-${vw}] 深色：選中的預組列仍是強調底（與未選中不同色）`, dk.n > 0 && dk.activeBg !== dk.bg && dk.activeBg !== 'rgb(255, 245, 230)', JSON.stringify(dk));
        ok(`★★[E3-${vw}] 淺色：預組列仍是淡橙底、文字對比 ≥ 4.5（零回歸）`, lt.n > 0 && lt.bg === 'rgb(255, 245, 230)' && lt.cr >= 4.5, JSON.stringify(lt));
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.510 牌組編輯器預組清單深色對比：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
