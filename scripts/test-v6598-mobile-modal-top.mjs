#!/usr/bin/env node
/**
 * v6.598 守衛：手機彈出視窗的上緣不可以跑進狀態列底下；關閉鈕一直按得到
 *
 * 站長 2026-10-24 iPhone 截圖（牌組公布欄明細）：視窗頂端跑進狀態列底下、標題被模糊、✕ 很難按；並要求全站手機排版檢查。
 *   真兇：.modal-backdrop 用 align-items:center，而 .modal 是 content-box（上下內距 34px 加在 max-height 外面）
 *   ⇒ 視窗永遠比可用高度高 34px，置中後上緣被推出 17px（iPhone 模擬：上緣 58 < 狀態列 59＋16）；
 *   iOS Safari 的 100vh 比看得到的高度大時更嚴重。長牌組往下捲時 ✕ 也跟著捲走。
 *   其他頁的參考寫法（/decks、/cards 預覽視窗）：align-items:flex-start＋視窗 margin:auto ⇒ 上緣不會被推出去。
 *
 * 【S】靜態：牌組公布欄明細／投稿／大圖、/cards 卡片視窗、/decks 預覽視窗、兩頁卡圖放大、錦標賽名人堂／戰報、私聊面板、測抽
 *      （視窗都是 content-box ⇒ dvh 那一行要把自己的內距一起扣掉；不改 border-box 以免桌機變窄）
 * 【B】真瀏覽器（build/）：iPhone 393×852、模擬動態島安全區（上 59px、下 34px）：
 *      B1 公布欄明細：上緣 ≥ 狀態列＋16、下緣 ≤ 底部橫條上方、✕ 44×44 在畫面內；往下捲 ✕ 仍在畫面內且在狀態列下面
 *      B2 內容比畫面高很多（模擬 iOS 100vh 偏大）：上緣仍不被推出去
 *      B3 /cards 卡片視窗：同 B1（往下捲 ✕ 仍在）；B4 桌機 1366×768：✕ 位置與原本 absolute 時相同（距視窗上、右各 16px）
 * 【H】HEAD-FAIL：BASE（v6.597）上 S1～S4 逐條紅；B1～B3 拿到 BASE 的 build 上跑三條全紅（明細上緣 58、超高時 -1457、/cards 下緣 868 且捲動後 ✕ 不見）
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { loadLivePool } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '7e26ff39';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const FILES = { dp: 'src/routes/deck-posts/+page.svelte', cards: 'src/routes/cards/+page.svelte', decks: 'src/routes/decks/+page.svelte', game: 'src/routes/game/+page.svelte', dm: 'src/routes/friends/DmPanel.svelte' };
const read = (rel, sha) => { if (!sha) return normEol(readFileSync(join(ROOT, rel), 'utf8')); const b = readBaseBlob(ROOT, sha, rel); return b.ok ? normEol(b.out) : ''; };
// 取出一條 CSS 規則（選擇器字面開頭到第一個 }）
const rule = (src, sel) => { const i = src.indexOf(sel + ' {'); const j = i >= 0 ? src.indexOf('}', i) : -1; return i >= 0 && j > i ? src.slice(i, j) : ''; };
const rule1 = (src, sel) => { const i = src.indexOf(sel + '{'); const j = i >= 0 ? src.indexOf('}', i) : -1; return i >= 0 && j > i ? src.slice(i, j) : ''; };

function staticChecks(sha) {
  const r = {};
  const dp = read(FILES.dp, sha), cards = read(FILES.cards, sha), decks = read(FILES.decks, sha), game = read(FILES.game, sha), dm = read(FILES.dm, sha);
  // S1 公布欄明細／投稿視窗：flex-start＋margin:auto＋border-box＋dvh；標題列 sticky、✕ 44；大圖同樣不往上推
  const bd = rule(dp, '  .modal-backdrop'), md = rule(dp, '  .modal');
  r.S1 = /align-items: flex-start;/.test(bd) && /padding-top: calc\(var\(--safe-top, 0px\) \+ 16px\);/.test(bd)
    && /margin: auto;/.test(md) && !/box-sizing: border-box;/.test(md) && /max-height: calc\(100dvh - var\(--safe-top, 0px\) - var\(--safe-bottom, 0px\) - 32px - 34px\);/.test(md)
    && /\.modal-head \{ position: sticky; top: -16px;[^}]*background: inherit;/.test(dp) && /\.modal-head \.close \{ min-width: 44px; min-height: 44px;/.test(dp)
    && /\.dpz-backdrop \{[^}]*align-items: flex-start;/.test(dp) && /\.dpz \{[^}]*margin: auto;/.test(dp);
  // S2 /cards 卡片視窗、/decks 預覽視窗：✕ sticky、視窗 border-box＋dvh（下緣讓開底部橫條）
  const cl = rule(cards, '  .close'), mi = rule(cards, '  .modalInner'), pc = rule(decks, '  .pv-close'), pi = rule(decks, '  .pv-inner');
  const mo = rule(cards, '  .modal'), po = rule(decks, '  .pv-overlay');
  r.S2 = /position: sticky;/.test(cl) && /top: -0\.5rem;/.test(cl) && /position: sticky;/.test(pc) && /top: -0\.25rem;/.test(pc)
    && [mo, po].every((x) => /padding-bottom: calc\(var\(--safe-bottom, 0px\) \+ 1rem\);/.test(x))
    && [mi, pi].every((x) => !/box-sizing: border-box;/.test(x) && /max-height: calc\(100dvh - var\(--safe-top, 0px\) - var\(--safe-bottom, 0px\) - 2rem - 3rem\);/.test(x));
  // S3 兩頁卡圖放大：上下讓開安全區、圖高用 dvh
  r.S3 = [cards, decks].every((s) => { const lo = rule(s, '  .lightboxOverlay'), li = rule(s, '  .lightboxImg');
    return /padding-top: calc\(var\(--safe-top, 0px\) \+ 1rem\);/.test(lo) && /padding-bottom: calc\(var\(--safe-bottom, 0px\) \+ 1rem\);/.test(lo) && /max-height: calc\(100dvh - var\(--safe-top, 0px\) - var\(--safe-bottom, 0px\) - 2rem\);/.test(li); });
  // S4 錦標賽名人堂視窗、私聊面板關閉鈕
  const hb = rule1(game, '  .hof-modal-backdrop '), hm = rule1(game, '  .hof-modal ');
  const ohs = read('src/lib/decks/OpeningHandSim.svelte', sha);
  r.S4 = /align-items: flex-start;/.test(hb) && /padding-top: calc\(var\(--safe-top, 0px\) \+ 16px\);/.test(hb) && /margin: auto;/.test(hm)
    && /max-height: min\(86dvh, calc\(100dvh - var\(--safe-top, 0px\) - var\(--safe-bottom, 0px\) - 32px - 30px\)\);/.test(hm)
    && /\.hof-modal > \.tourn-bracket-head \{ position: sticky; top: -14px;[^}]*background: inherit;/.test(game) && /\.hof-modal-x \{ min-width: 44px; min-height: 44px; margin: -12px -10px -1px 0; \}/.test(game)
    && /\.dm-close \{[^}]*min-width: 44px; min-height: 44px;/.test(dm)
    && /\.ohs-overlay \{[^}]*padding: calc\(var\(--safe-top, 0px\) \+ 1\.5rem\) 0\.75rem calc\(var\(--safe-bottom, 0px\) \+ 1\.5rem\);/.test(ohs);
  return r;
}
const S = staticChecks(null);
ok('★★★ S1 牌組公布欄視窗：flex-start＋margin:auto（放不下也不把上緣推出去）、dvh 扣掉內距（不改 border-box、桌機寬度不變）、標題列 sticky、✕ 44×44；大圖同', S.S1 === true);
ok('★★ S2 /cards 卡片視窗、/decks 預覽視窗：✕ 固定在右上角（sticky，負 top 回到原位置）、dvh 扣掉內距（桌機寬度不變）、遮罩下方讓開底部橫條', S.S2 === true);
ok('★★ S3 /cards、/decks 卡圖放大：上下讓開狀態列與底部橫條、圖高用 dvh', S.S3 === true);
ok('★★ S4 錦標賽名人堂／戰報視窗不往上緣外推、dvh 扣內距、標題列 sticky、✕ 44×44；私聊面板 ✕ 44×44；測抽底部讓開底部橫條', S.S4 === true);

// ── B：真瀏覽器 ──
const BUILD = process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const chromium = pwChromium('v6.598');
  const browser = chromium ? await pwLaunchWith(chromium, 'v6.598') : null;
  if (!browser) shallowSkip('B（沒有可用的 Chromium）');
  else {
    const POOL = loadLivePool(ROOT);
    const entries = [...POOL.values()].filter((c) => c.imageUrl).slice(0, 45).map((c) => ({ cardId: String(c.id), count: 1 }));
    const POST = { id: 'dp_x', authorName: '小烏龜', deckName: '草', notes: '雷霆草', archetype: '奇諾栗鼠', cardTotal: 45, likeCount: 1, downloadCount: 2, commentCount: 0, createdAt: 1761264000000, tournament: null, entries };
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/api/deck-posts/dp_x') return j({ post: POST });
      if (u.pathname === '/api/deck-posts') return j({ posts: [POST], total: 1 });
      if (u.pathname.startsWith('/api/deck-posts-comments')) return j({ comments: [], hasMore: false });
      if (u.pathname.startsWith('/api/')) return j({});
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((rs) => srv.listen(0, rs));
    const port = srv.address().port;
    const W = 393, H = 852, ST = 59, SB = 34;
    async function open(path, extraCss = '') {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: W, height: H }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(() => { try { localStorage.setItem('ptcg_ui_theme', 'dark'); } catch { /* */ } });
      await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"><rect width="245" height="342" fill="#4a6"/></svg>' }));
      await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' });
      // 模擬動態島機種：只能覆寫全站唯一來源的變數（env() 在桌機瀏覽器量不到）
      await pg.addStyleTag({ content: `:root{--safe-top:${ST}px !important;--safe-bottom:${SB}px !important;}` + extraCss });
      return { ctx, pg, errs };
    }
    const rect = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
    const scroll = (pg, sel, y) => pg.evaluate(([s, v]) => { const e = document.querySelector(s); if (e) e.scrollTop = v; }, [sel, y]);
    const res = {};
    try {
      // B1／B2 公布欄明細
      for (const [k, css] of [['B1', ''], ['B2', '.modal{max-height:none !important}']]) {
        const { ctx, pg, errs } = await open('/deck-posts?post=dp_x', css);
        await pg.waitForSelector('.deck-table section', { timeout: 30000 }); await pg.waitForTimeout(500);
        const m = await rect(pg, '.modal'), c0 = await rect(pg, '.modal-head .close');
        await scroll(pg, '.modal', 900); await pg.waitForTimeout(250);
        const c1 = await rect(pg, '.modal-head .close');
        res[k] = { m, c0, c1, errs: errs.slice(0, 2) };
        await ctx.close();
      }
      // B3 /cards 卡片視窗
      { const { ctx, pg } = await open('/cards');
        await pg.getByText('全部 H / I / J 卡牌').first().click().catch(() => {});
        await pg.waitForSelector('.cardBtn', { timeout: 30000 }); await pg.locator('.cardBtn').first().click(); await pg.waitForSelector('.modalInner'); await pg.waitForTimeout(500);
        const m = await rect(pg, '.modalInner'), c0 = await rect(pg, '.modalInner .close');
        await scroll(pg, '.modalInner', 99999); await pg.waitForTimeout(250);
        res.B3 = { m, c0, c1: await rect(pg, '.modalInner .close') };
        await ctx.close(); }
      // B4 桌機 1366×768：✕ 位置與原本 absolute（top/right:1rem）時相同
      { const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 768 } });
        await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"/>' }));
        await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
        const pg = await ctx.newPage(); await pg.goto(`http://localhost:${port}/cards`, { waitUntil: 'load' });
        await pg.getByText('全部 H / I / J 卡牌').first().click().catch(() => {});
        await pg.waitForSelector('.cardBtn', { timeout: 30000 }); await pg.locator('.cardBtn').first().click(); await pg.waitForSelector('.modalInner'); await pg.waitForTimeout(500);
        res.B4 = { m: await rect(pg, '.modalInner'), c: await rect(pg, '.modalInner .close') };
        await ctx.close(); }
    } finally { await browser.close(); srv.close(); }
    const closeOk = (c) => c && c.t >= ST && c.b <= H - SB && c.w >= 44 && c.h >= 44;
    const b1 = res.B1;
    ok('★★★ B1 公布欄明細（iPhone、動態島）：上緣在狀態列＋16 以下、下緣在底部橫條上方；✕ 44×44 在畫面內，往下捲仍在且不進狀態列',
      !!b1.m && b1.m.t >= ST + 16 - 1 && b1.m.b <= H - SB - 16 + 1 && closeOk(b1.c0) && closeOk(b1.c1) && b1.errs.length === 0, JSON.stringify(b1));
    ok('★★★ B2 內容比畫面高很多（模擬 iOS 100vh 偏大）：視窗上緣仍在狀態列以下（不被置中推出去）', !!res.B2.m && res.B2.m.t >= ST + 16 - 1 && closeOk(res.B2.c0), JSON.stringify(res.B2));
    const b3 = res.B3;
    ok('★★ B3 /cards 卡片視窗：上緣在狀態列以下、下緣在底部橫條上方；往下捲 ✕ 仍在畫面內且不進狀態列',
      !!b3.m && b3.m.t >= ST && b3.m.b <= H - SB - 16 + 1 && closeOk(b3.c0) && closeOk(b3.c1), JSON.stringify(b3));
    const b4 = res.B4;
    ok('★★ B4 桌機 1366×768 /cards：✕ 距視窗上緣、右緣各 16px（與原本 absolute 時相同）', !!b4.m && !!b4.c && Math.abs(b4.c.t - b4.m.t - 16) <= 1 && Math.abs(b4.m.r - b4.c.r - 16) <= 1, JSON.stringify(b4));
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const bS = staticChecks(BASE_SHA);
  const red = ['S1', 'S2', 'S3', 'S4'].filter((k) => bS[k] !== true);
  ok('★★★ HEAD-FAIL：BASE（v6.597）上 S1～S4 逐條紅', red.length === 4, red.join(','));
}
console.log(`\n=== v6.598 手機彈出視窗上緣／關閉鈕：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
