#!/usr/bin/env node
/**
 * v6.468 守衛：全站 audit（2026-10-03）第二批 —— 介面（全部是純 CSS／屬性，不影響載入速度）
 *
 *   ① /game 本機雙人設定頁：手機（360／390／412）出現橫向捲軸、「由 AI 控制」被推出畫面
 *      ⇐ 手機版 grid 用 1fr（最小寬＝內容寬），被牌組下拉的長選項文字撐到 461px。改 minmax(0,1fr)＋卡片／下拉可縮。
 *   ② 首頁「版本更新記錄」標題前有兩個箭頭（通用 summary::before 也套到外層）。
 *   ③ /deck-posts、/friends 沒有指定字型 ⇒ 顯示成襯線體（Windows 繁中是新細明體）。
 *   ④ /deck-posts 列表作者名稱很長時日期被折成兩行。
 *   ⑤ 觸控裝置：各頁「← 首頁」可點範圍放大（padding＋等量負 margin，版面不動）；/decks 的 ▲▼ 與 ＋／−／☆ 放大。
 *   ⑥ 表單欄位補 aria-label；幾處小字灰色太淡（對比 <3.3）調深。
 *
 * 判準：原始碼判準（標 HEAD-FAIL 的在 BASE 上必須不成立）＋ 真瀏覽器 E（需要 build/）。
 * Run: node scripts/test-v6468-site-audit-ui.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.467。
const BASE_SHA = 'd6acb6e8';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const FILES = {
  game: 'src/routes/game/+page.svelte', home: 'src/routes/+page.svelte', dp: 'src/routes/deck-posts/+page.svelte',
  fr: 'src/routes/friends/+page.svelte', decks: 'src/routes/decks/+page.svelte', cards: 'src/routes/cards/+page.svelte', card: 'src/routes/card/[id]/+page.svelte',
};
function load(getter) { const o = {}; for (const [k, p] of Object.entries(FILES)) { try { o[k] = getter(p); } catch { o[k] = ''; } } return o; }
const CUR = load(rd);
const css = (src) => { const i = src.lastIndexOf('<' + 'style'); return i < 0 ? '' : src.slice(i).replace(/\/\*[\s\S]*?\*\//g, ''); };
const COARSE_BACK = /\n  ([^{}\n]+) \{ display: inline-block; padding: 10px 8px; margin: -10px -8px; \}/;

const CHECKS = [
  ['★★★[①] 手機版本機設定 grid 用 minmax(0, 1fr)；卡片與下拉可以比選項文字窄', true, (S) =>
    /\.player-setup \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/.test(css(S.game))
    && /\.setup-card\{ min-width:0; \}/.test(css(S.game)) && /\.name-input,\.setup-card select\{ min-width:0; max-width:100%; box-sizing:border-box; \}/.test(css(S.game))],
  ['★★[②] 首頁外層「版本更新記錄」不再套通用箭頭', true, (S) => /\.changelog-outer > summary::before \{ content: none; \}/.test(css(S.home))],
  ['★★[③] /deck-posts、/friends 的 main 指定無襯線字型', true, (S) =>
    [S.dp, S.fr].every((s) => /main \{\s*font-family: system-ui, -apple-system, 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;/.test(css(s)))],
  ['★[④] /deck-posts 列表日期不換行、作者名稱省略號', true, (S) =>
    /\.row2 \.date \{ white-space: nowrap; flex-shrink: 0; \}/.test(css(S.dp)) && /\.row2 \.author \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/.test(css(S.dp))],
  ['★★[⑤] 放大「← 首頁」可點範圍（五頁）且不移動版面（padding 與負 margin 等量；不包 @media）', true, (S) =>
    [['cards', '.back'], ['dp', '.back, .to-decks'], ['fr', '.back'], ['card', '.crumb a']].every(([k, sel]) => { const m = COARSE_BACK.exec(css(S[k])); return !!m && m[1].trim() === sel; })
    // /decks 的桌機 CSS 有逐字指紋守衛（test-v6213）⇒ 這條只放在觸控分支
    && /@media \(pointer: coarse\) \{[^@]*\n    \.back \{ display: inline-block; padding: 10px 8px; margin: -10px -8px; \}\n  \}/.test(css(S.decks))],
  // ⭐v6.497（Rule 40）：站長手機清單第 5 項再放大到 36×36／40×40 ⇒ 判準改成「至少」（數字往上合法、往下才紅），意圖不變
  ['★★[⑤b] /decks 觸控裝置：▲▼ 至少 30×26、＋／−／☆ 至少 34×34（含手機版特異度較高的那條）', true, (S) => {
    const m = /@media \(pointer: coarse\) \{[\s\S]*?\.deck-reorder-btn \{ min-width: (\d+)px; min-height: (\d+)px; font-size: 0\.75rem; \}\s*button\.icon, \.picker-list li button\.icon \{ min-width: (\d+)px; min-height: (\d+)px; \}/.exec(css(S.decks));
    return !!m && +m[1] >= 30 && +m[2] >= 26 && +m[3] >= 34 && +m[4] >= 34;
  }],
  ['★[⑥] 表單欄位有 aria-label（本機設定的名稱與牌組、登入、牌組頁、公布欄搜尋）', true, (S) =>
    ['aria-label="玩家 1 名稱"', 'aria-label="玩家 2 名稱"', 'aria-label="玩家 1 牌組"', 'aria-label="玩家 2 牌組"', 'aria-label="Email"', 'aria-label="密碼"'].every((a) => S.game.includes(a))
    && ['aria-label="牌組名稱"', 'aria-label="搜尋卡牌"', 'aria-label="卡包篩選"'].every((a) => S.decks.includes(a)) && S.dp.includes('aria-label="搜尋牌組"')],
  ['★[⑥b] 小字灰色調深（首頁頁尾聲明、版本標籤、卡片頁頁尾、卡包發售日）', true, (S) =>
    /\.disclaimer \{[^}]*color: #666;/.test(css(S.home)) && /\.version \{[^}]*color: #5a5566;/.test(css(S.home))
    && /\.foot \{ margin-top: 18px; font-size: 12px; color: #666;/.test(css(S.card)) && /\.setDate \{[^}]*color: #6b7280;/.test(css(S.cards))],
  ['[範圍] 牌組頁空狀態不再說「左側」（手機上牌組清單在上方）', true, (S) => S.decks.includes('請從牌組清單選擇或新增牌組。') && !S.decks.includes('請從左側選擇')],
];
function runAll(S) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(S); } catch { r = false; } return { name, headFail, r }; }); }

console.log('【S】原始碼');
for (const c of runAll(CUR)) ok(c.name, c.r);
console.log('\n【H】HEAD-FAIL：同一批判準餵 v6.467');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6468 H：HEAD-FAIL', '需要 BASE commit');
else {
  const BASE = load((p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); if (!r.ok) throw new Error('no'); return r.out.replace(/\r\n/g, '\n'); });
  const wrong = runAll(BASE).filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.467 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.468 介面') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.468 介面');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    try {
      const errs = [];
      const res360 = [];
      for (const w of [360, 390]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 760 }, isMobile: true, hasTouch: true });
        await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io/, (r) => r.abort());
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
        await pg.click('.mode-card');
        await pg.waitForSelector('.player-setup', { timeout: 20000 });
        await pg.waitForTimeout(800);
        const m = await pg.evaluate(() => {
          const ai = document.querySelector('label.ai-toggle'); const r = ai ? ai.getBoundingClientRect() : null;
          return { sw: document.documentElement.scrollWidth, iw: innerWidth, aiRight: r ? Math.round(r.right) : null };
        });
        res360.push({ w, ...m });
        await ctx.close();
      }
      ok('★★★[E1] 手機 360／390：本機設定頁沒有橫向捲軸，「由 AI 控制」在畫面內', res360.every((m) => m.sw <= m.iw && (m.aiRight == null || m.aiRight <= m.iw)), JSON.stringify(res360));
      const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
      await ctx2.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg2 = await ctx2.newPage(); pg2.on('pageerror', (e) => errs.push(e.message));
      await pg2.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
      await pg2.waitForSelector('.changelog-outer > summary', { timeout: 20000 });
      const before = await pg2.evaluate(() => getComputedStyle(document.querySelector('.changelog-outer > summary'), '::before').content);
      ok('★★[E2] 首頁「版本更新記錄」外層 summary 沒有通用箭頭', before === 'none' || before === 'normal', before);
      await pg2.goto(`http://localhost:${port}/deck-posts`, { waitUntil: 'load' }); await pg2.waitForTimeout(800);
      const ff = await pg2.evaluate(() => getComputedStyle(document.querySelector('main')).fontFamily);
      ok('★[E3] /deck-posts 的 main 用無襯線字型', /system-ui|sans-serif/.test(ff), ff);
      await ctx2.close();
      ok('[E4] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.468 全站 audit（介面）: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6468-site-audit-ui ===');
process.exit(fail ? 1 : 0);
