#!/usr/bin/env node
/**
 * v6.501 守衛：牌組編輯器「🎲 測抽」視窗在手機上固定佔滿畫面、按鈕位置固定（玩家回報 2026-10-06）。
 *   玩家：「在手機上會因為文字或內容關係，彈窗的高度會變長變短，導致在手機上就不好直覺的一直按，必須要去滑動視窗去操作按鈕」。
 *   站長：「按鈕都在固定的位置讓玩家可以一直按」。
 *
 * 【S】靜態：手牌／獎賞卡包在 .ohs-body（可捲），按鈕列在它外面；手機 @media 裡視窗是 100dvh 的直式 flex、
 *      body flex:1＋overflow-y:auto、按鈕列不換行且固定高度；獎賞卡一列 6 張。
 * 【E】真瀏覽器：390×844、375×667 開測抽 ⇒ 視窗高度＝畫面高度；連抽 5 張、翻開獎賞、重新洗牌之後，
 *      三顆按鈕的位置（top／left／height）與一開始完全相同，而且整顆都在畫面內；1440 桌機維持原本的置中卡片（不佔滿）。
 * HEAD-FAIL：靜態判準餵 v6.500 必須紅。
 * Run: node scripts/test-v6501-opening-sim-mobile-fixed.mjs
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.500。
const BASE_SHA = 'c8c3b33e';
const FILE = 'src/lib/decks/OpeningHandSim.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function judge(src) {
  const r = {};
  const mk = src.slice(0, src.indexOf('<style>'));
  const iBody = mk.indexOf('<div class="ohs-body">');
  const iHand = mk.indexOf('<h4 class="ohs-h">手牌');
  const iPrize = mk.indexOf('<div class="ohs-grid ohs-prizes">');
  const iAct = mk.indexOf('<div class="ohs-actions">');
  // .ohs-body 在手牌之前開、在按鈕列之前收（按鈕列不在可捲區裡）
  const between = iPrize > 0 && iAct > iPrize ? mk.slice(iPrize, iAct) : '';
  r.S1 = iBody > 0 && iHand > iBody && iPrize > iHand && iAct > iPrize && (between.match(/<\/div>/g) || []).length >= 2;
  const css = src.slice(src.indexOf('<style>'));
  const m = css.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n  \}/);
  const mq = m ? m[1] : '';
  r.S2 = /\.ohs-inner \{[^}]*height: 100dvh;[^}]*display: flex; flex-direction: column;/.test(mq)
    && /\.ohs-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/.test(mq)
    && /\.ohs-actions \{ flex: 0 0 auto; flex-wrap: nowrap;/.test(mq)
    && /\.ohs-btn \{[^}]*height: 52px;/.test(mq);
  r.S3 = /\.ohs-prizes \{ grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); \}/.test(mq);
  return r;
}
console.log('【S】靜態');
const C = judge(rd(FILE));
ok('★★★[S1] 手牌與獎賞卡包在 .ohs-body，按鈕列在它外面', C.S1);
ok('★★★[S2] 手機：視窗 100dvh 直式 flex、中間可捲、按鈕列不換行且固定高度', C.S2);
ok('★[S3] 手機：獎賞卡一列 6 張', C.S3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const b = readBaseBlob(ROOT, BASE_SHA, FILE);
  const B = judge(b.ok ? b.out.replace(/\r\n/g, '\n') : '');
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.500 全紅', !B.S1 && !B.S2 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6501 S0：HEAD-FAIL', '需要 BASE commit');

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
      for (const [w, h, mobile] of [[390, 844, true], [375, 667, true], [1440, 900, false]]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
        await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/decks`, { waitUntil: 'load' }); await pg.waitForSelector('.preset-summary', { timeout: 20000 });
        await pg.click('.preset-summary'); await pg.waitForTimeout(300);
        await pg.locator('.preset-list li button').first().click(); await pg.waitForTimeout(1200);
        await pg.click('text=🎲 測抽'); await pg.waitForTimeout(600);
        const pos = () => pg.evaluate(() => [...document.querySelectorAll('.ohs-actions .ohs-btn')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.height), Math.round(r.bottom)]; }));
        const inner = () => pg.evaluate(() => { const r = document.querySelector('.ohs-inner').getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; });
        const p0 = await pos(); const i0 = await inner();
        for (let i = 0; i < 5; i++) { await pg.click('.ohs-btn:has-text("再抽 1 張")'); await pg.waitForTimeout(80); }
        await pg.click('.ohs-link'); await pg.waitForTimeout(300);
        const p1 = await pos(); const i1 = await inner();
        const hand = await pg.evaluate(() => document.querySelectorAll('.ohs-grid')[0].querySelectorAll('.ohs-card').length);
        await pg.click('.ohs-btn.primary'); await pg.waitForTimeout(200);
        const p2 = await pos();
        await ctx.close();
        const tag = `${w}×${h}`;
        if (mobile) {
          ok(`★★★[E1] ${tag}：視窗高度＝畫面高度（不隨內容變）`, i0.top === 0 && i0.h === h && i1.h === h, JSON.stringify({ i0, i1 }));
          ok(`★★★[E2] ${tag}：連抽 5 張（${hand} 張）、翻開獎賞、重新洗牌後，三顆按鈕位置完全不動`, hand === 12 && JSON.stringify(p0) === JSON.stringify(p1) && JSON.stringify(p0) === JSON.stringify(p2), JSON.stringify({ p0, p1, p2 }));
          ok(`★★[E3] ${tag}：三顆按鈕在同一列、整顆都在畫面內、高度 52`, p0.length === 3 && p0.every((b) => b[0] === p0[0][0] && b[2] === 52 && b[3] <= h), JSON.stringify(p0));
        } else {
          ok(`★★[E4] ${tag}：桌機維持置中卡片（不佔滿畫面）`, i0.top > 0 && i0.h < h, JSON.stringify(i0));
        }
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.501 測抽手機版固定版面：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
