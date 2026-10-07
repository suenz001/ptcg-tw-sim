#!/usr/bin/env node
/**
 * v6.505 守衛：全站版面統一 第 2 步——對戰演練／錦標賽大廳的頁首與模式卡片比照其他頁（站長 2026-10-07）。
 * 【S】$lib/LobbyUnify.svelte 只有樣式、每條規則都帶 html:not([data-battle-view])（牌桌不受影響）、顏色只讀 --ui-*；
 *      對戰頁 import 並掛上（只多兩行）
 * 【E】390／1440、淺色／深色：/game 模式選擇與 /tournament 的頁首是卡片（手機 14px、網頁版 16px 圓角）、
 *      看不到「← 首頁／← 回到首頁」、模式卡片是 --ui-bg-elev 底＋--ui-border 框；手機頁首頂端 12px；
 *      掛上 data-battle-view（牌桌）⇒ 這些樣式全部不成立
 * HEAD-FAIL：靜態判準餵 v6.504 必須紅。
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';   // ⭐v6.511 色票唯一讀取點（不寫死色碼）
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.504。
const BASE_SHA = '176086e6';
const rd = (r) => { try { return readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
function judge(get) {
  const r = {};
  const C = get('src/lib/LobbyUnify.svelte');
  const css = (C.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [...css.matchAll(/:global\(([^{}]*?)\)\s*\{/g)].map((m) => m[1]);
  const markup = C.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  r.S1 = sels.length >= 8 && sels.every((s) => s.startsWith('html:not([data-battle-view])')) && markup === '' && !/<script/.test(C);
  r.S2 = css.length > 0 && !/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(css);
  const G = get('src/routes/game/+page.svelte');
  r.S3 = G.includes("  import LobbyUnify from '$lib/LobbyUnify.svelte';") && G.includes('</svelte:head>\n<LobbyUnify />\n');
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] LobbyUnify 只有樣式、每條都帶 html:not([data-battle-view])（≥8 條）', C.S1);
ok('★★[S2] 顏色只讀 --ui-* 色票（沒有寫死色碼）', C.S2);
ok('★★★[S3] 對戰頁 import 並掛上', C.S3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((f) => { const b = readBaseBlob(ROOT, BASE_SHA, f); return b.ok ? b.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[S0] HEAD-FAIL：v6.504 全紅', !B.S1 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6505 S0', '需要 BASE commit');
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.505') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.505');
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
    const probe = (pg) => pg.evaluate(() => {
      const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
      // ⭐v6.507（Rule 40）：頁首改用共用元件 PageHeader（<header class="ph">，不再是 main.lobby 的直接子 h1）。
      //   意圖不變：頁首是卡片、手機頂端 12px。E5（牌桌畫面）改看模式卡片：牌桌時大廳根本不渲染，頁首元件也沒有牌桌樣式可言，
      //   LobbyUnify「只在非牌桌生效」的意圖由模式卡片的顏色規則承擔（見 E5）。
      const h = document.querySelector('main.lobby .ph'); const cs = h ? getComputedStyle(h) : null;
      const mc = document.querySelector('.mode-card'); const ms = mc ? getComputedStyle(mc) : null;
      return { top: h ? Math.round(h.getBoundingClientRect().top) : null, radius: cs?.borderTopLeftRadius, border: cs?.borderTopWidth,
        home: [...document.querySelectorAll('a')].filter((a) => /^\/?$/.test(a.getAttribute('href') || '') && a.closest('main') && vis(a)).length,
        card: ms ? [ms.backgroundColor, ms.borderTopColor, ms.borderTopLeftRadius] : null };
    });
    try {
      for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
        for (const theme of ['light', 'dark']) {
          for (const path of ['/game', '/tournament']) {
            const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
            await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
            await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
            const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
            await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
            const A = await probe(pg);
            await pg.evaluate(() => document.documentElement.setAttribute('data-battle-view', '')); await pg.waitForTimeout(100);
            const B = await probe(pg);
            await ctx.close();
            const tag = `${w} ${theme} ${path}`;
            ok(`★★★[E1] ${tag}：頁首是卡片（${mobile ? 14 : 16}px 圓角、1px 框）`, A.radius === (mobile ? '14px' : '16px') && A.border === '1px', JSON.stringify(A));
            ok(`★★★[E2] ${tag}：看不到回首頁的連結／按鈕`, A.home === 0, JSON.stringify(A));
            if (mobile) ok(`★★[E3] ${tag}：手機頁首頂端 12px（與其他頁一致）`, A.top === 12, String(A.top));
            if (path === '/game') {
              const BG = uiColor(ROOT, theme, '--ui-bg-elev'), BD = uiColor(ROOT, theme, '--ui-border');   // ⭐v6.511（Rule 40）讀現行色票
              ok(`★★[E4] ${tag}：模式卡片是 --ui-bg-elev 底＋--ui-border 框、14px 圓角`, A.card && A.card[0] === BG && A.card[1] === BD && A.card[2] === '14px', JSON.stringify(A.card));
            }
            if (path === '/game') ok(`★★★[E5] ${tag}：掛上 data-battle-view（牌桌）⇒ LobbyUnify 的模式卡片樣式不成立`, !!B.card && B.card[2] !== '14px', JSON.stringify(B.card));
          }
        }
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== v6.505 全站版面統一（第 2 步：大廳）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
