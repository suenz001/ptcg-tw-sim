#!/usr/bin/env node
/**
 * v6.618 守衛：手機版單卡頁（/card/[id]）讓開 iPhone 動態島＋右上角 ✕ 回到卡牌瀏覽
 *
 * 站長 2026-11-02：「手機版，單卡頁的圖片顯示上方部分太多，導致會被iphone動態島擋住(或是被模糊處理)，
 *   也沒有X的關閉按鈕返回原本的卡變瀏覽頁面，請參考卡片檢視的頁面的做法」
 *
 * 【L】行為（esbuild 打包 $lib/cards/card-page.ts 的 cardPageBackTarget 實跑）
 *   L1 上一頁是同站 /cards（含 ?set=…&card=…、結尾斜線、base 前綴）且還有上一頁 ⇒ history.back()
 *   L2 其他情況一律到「這張卡所屬卡包」的卡牌列表：沒有上一頁、別的網站、站內其他頁、/cardsX、壞網址、只有 1 筆歷史
 *   L3 卡包代號會 encodeURIComponent
 *   L4 cardPagePrevUrl：整頁載入用 referrer、站內換頁用 from、popstate 沿用該筆歷史紀錄記下的值（審查 P2-1）
 * 【S】靜態（剝註解後）
 *   S1 單卡頁：✕ 只在掛載後、非網頁版時渲染（斷點讀 site-theme 的 WIDE_QUERY，不另寫一份 1024）；onclick 走 cardPageBackTarget（判準只有一份）
 *   S2 單卡頁：上一頁＝afterNavigate 的 from 優先、整頁載入才用 document.referrer
 *   S3 樣式：手機頁首 padding-top 加 var(--safe-top)、✕ 是 fixed 且 top 讀 var(--safe-top)；不新增 @media、不寫 env(safe-area…)
 * 【B】真瀏覽器（本機 build；沙盒沒有 build ⇒ SHALLOW-SKIP；模擬動態島：把全站唯一來源 --safe-top 設成 59px）
 *   B1 手機：麵包屑與 ✕ 都在動態島（59px）下面、✕ 在視窗內且可點（≥44px）、頁面不橫向捲動
 *   B2 手機往下捲：✕ 仍在同一個位置
 *   B3 卡片視窗 →「📄 單卡頁」→ ✕ ⇒ 回到 /cards?set=SVI&card=11330，視窗重新打開
 *   B4 直接進單卡頁 → ✕ ⇒ 到 /cards?set=SVI
 *   B5 網頁版（1280）：沒有 ✕、麵包屑位置與沒有安全區時相同（網頁版一個像素都不變）
 *   B6 直接進單卡頁 → 點麵包屑到 /cards → 返回 → ✕ ⇒ /cards?set=SVI（審查 P2-1：修正前會 history.back() 離開網站）
 * 【H】HEAD-FAIL：BASE（95ad48cd＝v6.617）上 L1、L2、L4、S1、S2、S3 紅
 */
import { readFileSync, existsSync, createReadStream, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '95ad48cd';   // v6.617（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };

const P_CARD = 'src/routes/card/[id]/+page.svelte';
const P_LIB = 'src/lib/cards/card-page.ts';
const strip = (s) => (s == null ? null : stripCommentsBlankChecked(s.replace(/\r\n/g, '\n')));
const rd = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };
const styleOf = (s) => { const i = s.lastIndexOf('<' + 'style>'); return i < 0 ? '' : s.slice(i, s.indexOf('</' + 'style>', i)); };

// ── L：行為 ──
// 把 card-page.ts（可換成 BASE 版本）打包成 ESM 實跑；同一份判準餵現行版與 BASE（Rule 38）。
async function loadLib(src) {
  // ⚠ 用 stdin 打包、不在 src/ 底下寫暫存檔（審查 P3-6：平行跑全套時別的守衛可能掃到）
  const dir = mkdtempSync(join(tmpdir(), 'v6618-'));
  const out = join(dir, 'o.mjs');
  await build({ stdin: { contents: src, resolveDir: join(ROOT, 'src/lib/cards'), loader: 'ts', sourcefile: 'card-page.ts' },
    outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent', alias: { '$lib': join(ROOT, 'src/lib') } });
  return import(pathToFileURL(out).href);
}
function libChecks(M) {
  const f = typeof M?.cardPageBackTarget === 'function' ? M.cardPageBackTarget : null;
  const r = { L1: false, L2: false, L3: false, L4: false, detail: [] };
  // L4：上一頁網址的來源（審查 P2-1：popstate 倒退回本頁時 from 是「下一頁」，不可以拿來當上一頁）
  const pv = typeof M?.cardPagePrevUrl === 'function' ? M.cardPagePrevUrl : null;
  if (pv) {
    const O2 = 'https://www.ptcg-tw-sim.com';
    const l4 = [
      pv({ type: 'enter', fromHref: null }, O2 + '/cards?set=SVI&card=1', '') === O2 + '/cards?set=SVI&card=1',   // 整頁載入 ⇒ referrer
      pv({ type: 'link', fromHref: O2 + '/decks' }, O2 + '/cards?set=SVI', '') === O2 + '/decks',                 // 用戶端導航 ⇒ from 優先（referrer 是舊值）
      pv({ type: 'popstate', fromHref: O2 + '/cards?set=SVI' }, '', '') === '',                                  // 倒退回本頁：from 是下一頁 ⇒ 不可採用
      pv({ type: 'popstate', fromHref: O2 + '/decks' }, '', O2 + '/cards?set=SVI&card=1') === O2 + '/cards?set=SVI&card=1',   // 沿用這筆紀錄記下的值
      pv({ type: 'goto', fromHref: null }, '', 'x') === '',
    ];
    r.L4 = l4.every(Boolean); if (!r.L4) r.detail.push('L4 ' + JSON.stringify(l4));
  } else r.detail.push('沒有 cardPagePrevUrl');
  if (!f) { r.detail.push('沒有 cardPageBackTarget'); return r; }
  const O = 'https://www.ptcg-tw-sim.com';
  const call = (prevUrl, extra = {}) => f({ prevUrl, origin: O, base: '', historyLength: 3, setCode: 'SVI', ...extra });
  const isBack = (t) => t && t.kind === 'back';
  const goSvi = (t, href = '/cards?set=SVI') => t && t.kind === 'go' && t.href === href;
  const l1 = [
    isBack(call(O + '/cards?set=SVI&card=11330')),
    isBack(call(O + '/cards')),
    isBack(call(O + '/cards/?set=ALL')),
    isBack(f({ prevUrl: 'https://suenz001.github.io/ptcg-tw-sim/cards?set=SVI', origin: 'https://suenz001.github.io', base: '/ptcg-tw-sim', historyLength: 2, setCode: 'SVI' })),
  ];
  r.L1 = l1.every(Boolean); if (!r.L1) r.detail.push('L1 ' + JSON.stringify(l1));
  const l2 = [
    goSvi(call('')),                                              // 沒有上一頁（搜尋引擎／書籤）
    goSvi(call('https://www.google.com/search?q=x')),             // 別的網站
    goSvi(call(O + '/decks')),                                    // 站內其他頁
    goSvi(call(O + '/card/123/')),                                // 從另一張單卡頁來
    goSvi(call(O + '/cardsX')),                                   // 前綴相同但不是 /cards
    goSvi(call('not a url')),                                     // 壞網址
    goSvi(call(O + '/cards?set=SVI', { historyLength: 1 })),     // 另開新分頁（沒有上一頁可退）
    goSvi(f({ prevUrl: 'https://suenz001.github.io/cards', origin: 'https://suenz001.github.io', base: '/ptcg-tw-sim', historyLength: 2, setCode: 'SVI' }), '/ptcg-tw-sim/cards?set=SVI'),   // base 不符
  ];
  r.L2 = l2.every(Boolean); if (!r.L2) r.detail.push('L2 ' + JSON.stringify(l2));
  const t3 = f({ prevUrl: '', origin: O, base: '', historyLength: 1, setCode: 'M-P J&x' });
  r.L3 = !!t3 && t3.kind === 'go' && t3.href === '/cards?set=' + encodeURIComponent('M-P J&x');
  if (!r.L3) r.detail.push('L3 ' + JSON.stringify(t3));
  return r;
}

// ── S：靜態 ──
function staticChecks(read) {
  const r = {};
  const card = strip(read(P_CARD)) ?? '';
  const st = styleOf(card);
  r.S1 = /import \{ cardPageBackTarget, cardPagePrevUrl \} from '\$lib\/cards\/card-page'/.test(card)
    && /import \{ WIDE_QUERY \} from '\$lib\/site-theme'/.test(card)
    && /matchMedia\(WIDE_QUERY\)/.test(card) && !/1024/.test(card.slice(0, card.indexOf('<' + 'style>')))
    && /\{#if showClose\}<button class="close" type="button" onclick=\{closePage\}/.test(card)
    && /let showClose = \$state\(false\)/.test(card)
    && /function closePage\(\) \{\s*const t = cardPageBackTarget\(\{[^}]*\}\);\s*if \(t\.kind === 'back'\) history\.back\(\); else goto\(t\.href\);/.test(card);
  // S2：上一頁的判準只走 cardPagePrevUrl（行為由 L4 守），且每筆歷史紀錄用 snapshot 記住
  r.S2 = /afterNavigate\(\(nav\) => \{[^]*?prevUrl = cardPagePrevUrl\(\{ type: nav\.type, fromHref:[^]*?document\.referrer[^]*?prevUrl\)/.test(card)
    && /export const snapshot = \{\s*capture: \(\) => prevUrl,\s*restore:/.test(card) && !/nav\.from\?\.url \? nav\.from\.url\.href : \(document\.referrer/.test(card);
  const mediaN = (st.match(/@media/g) || []).length;
  r.mediaN = mediaN;
  r.S3 = /\n  \.card-page \{ max-width: 760px; margin: 0 auto; padding: calc\(16px \+ var\(--safe-top, 0px\)\) 18px 48px;/.test(st)
    && /\.has-close \{ padding-right: 52px; \}/.test(st) && /<nav class="crumb" class:has-close=\{showClose\}>/.test(card) && /<h1 class:has-close=\{showClose\}>/.test(card)
    && /\.close \{\s*position: fixed;\s*top: calc\(var\(--safe-top, 0px\) \+ 8px\);/.test(st)
    && !/env\(safe-area/.test(card);
  return r;
}

const BUILD = process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
async function browserChecks(buildDir) {
  const r = { ran: false };
  const chromium = pwChromium('v6.618 單卡頁 ✕');
  if (!chromium) return r;
  const browser = await pwLaunchWith(chromium, 'v6.618 單卡頁 ✕');
  if (!browser) return r;
  r.ran = true;
  const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = join(buildDir, decodeURIComponent(u.pathname));
    if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) p = join(buildDir, '404.html');
    res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
  });
  await new Promise((rs) => srv.listen(0, rs));
  const B = `http://localhost:${srv.address().port}`;
  const SAFE = 59;   // iPhone 15 的動態島安全區
  const ctxOf = async (vp, { mobile = true, safe = SAFE } = {}) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
    // Chromium 的 env(safe-area-inset-top) 永遠是 0 ⇒ 直接覆寫 layout 的唯一來源 --safe-top
    if (safe) await ctx.addInitScript((s) => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = `html:root{--safe-top:${s}px !important}`; document.head.appendChild(st); }); }, safe);
    await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
    await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
    return ctx;
  };
  const MOB = { width: 393, height: 852 };
  const geo = (pg) => pg.evaluate(() => {
    const c = document.querySelector('button.close'); const cr = document.querySelector('.crumb');
    const cb = c ? c.getBoundingClientRect() : null; const rb = cr.getBoundingClientRect();
    const hit = c ? document.elementFromPoint(cb.left + cb.width / 2, cb.top + cb.height / 2) : null;
    // 文字本身的方框（Range 取行內文字框；區塊元素的 getClientRects 會含右側讓位的 padding，不能拿來量）
    const textRects = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()]; };
    const textHit = c ? [...document.querySelectorAll('.crumb, h1')].some((el) => textRects(el).some((t) => t.width > 0 && t.right > cb.left && t.left < cb.right && t.bottom > cb.top && t.top < cb.bottom)) : false;
    return { textHit, close: cb && { top: cb.top, left: cb.left, right: cb.right, bottom: cb.bottom, w: cb.width, h: cb.height }, hitIsClose: !!c && (hit === c || c.contains(hit)),
      crumbTop: rb.top, h1Top: document.querySelector('h1').getBoundingClientRect().top, hScroll: document.documentElement.scrollWidth > innerWidth + 1, vw: innerWidth };
  });
  try {
    { const ctx = await ctxOf(MOB); const pg = await ctx.newPage();
      await pg.goto(B + '/card/11330/', { waitUntil: 'load' }); await pg.waitForSelector('button.close', { timeout: 60000 });
      const g = await geo(pg);
      r.B1 = !!g.close && g.close.top >= SAFE && g.crumbTop >= SAFE && g.h1Top >= SAFE && g.close.right <= g.vw && g.close.w >= 44 && g.close.h >= 44 && g.hitIsClose && !g.hScroll && !g.textHit;
      r.B1n = JSON.stringify(g);
      await pg.evaluate(() => scrollTo(0, 800)); await pg.waitForTimeout(300);
      const g2 = await geo(pg);
      r.B2 = !!g2.close && Math.abs(g2.close.top - g.close.top) < 1 && g2.hitIsClose && (await pg.evaluate(() => scrollY)) > 300;
      r.B2n = JSON.stringify(g2.close);
      await ctx.close(); }
    { const ctx = await ctxOf(MOB); const pg = await ctx.newPage();
      await pg.goto(B + '/cards?set=SVI&card=11330', { waitUntil: 'load' });
      await pg.waitForSelector('.cardPageLink', { timeout: 60000 }); await pg.click('.cardPageLink');
      await pg.waitForSelector('button.close', { timeout: 60000 }); const mid = pg.url();
      await pg.click('button.close');
      await pg.waitForFunction(() => location.pathname.startsWith('/cards') && document.querySelector('.modalInner'), null, { timeout: 30000 }).catch(() => {});
      const after = await pg.evaluate(() => ({ path: location.pathname, q: location.search, modal: !!document.querySelector('.modalInner') }));
      r.B3 = /\/card\/11330\/$/.test(mid) && after.path.replace(/\/$/, '') === '/cards' && after.q === '?set=SVI&card=11330' && after.modal;
      r.B3n = JSON.stringify({ mid, after });
      await ctx.close(); }
    { const ctx = await ctxOf(MOB); const pg = await ctx.newPage();
      await pg.goto(B + '/card/11330/', { waitUntil: 'load' }); await pg.waitForSelector('button.close', { timeout: 60000 });
      await pg.click('button.close');
      await pg.waitForFunction(() => location.pathname.startsWith('/cards'), null, { timeout: 30000 }).catch(() => {});
      const after = await pg.evaluate(() => ({ path: location.pathname, q: location.search }));
      r.B4 = after.path.replace(/\/$/, '') === '/cards' && after.q === '?set=SVI';
      r.B4n = JSON.stringify(after);
      await ctx.close(); }
    { const ctx = await ctxOf(MOB); const pg = await ctx.newPage();
      await pg.goto(B + '/card/11330/', { waitUntil: 'load' }); await pg.waitForSelector('button.close', { timeout: 60000 });
      await pg.click('.crumb a[href*="cards?set="]');
      await pg.waitForFunction(() => location.pathname.startsWith('/cards'), null, { timeout: 30000 }).catch(() => {});
      await pg.goBack(); await pg.waitForSelector('button.close', { timeout: 60000 }).catch(() => {});
      const mid = pg.url();
      await pg.click('button.close').catch(() => {});
      await pg.waitForFunction(() => location.pathname.startsWith('/cards'), null, { timeout: 15000 }).catch(() => {});
      const after = pg.url();
      r.B6 = /\/card\/11330\/$/.test(mid) && /\/cards\/?\?set=SVI$/.test(after.replace(B, ''));
      r.B6n = JSON.stringify({ mid, after });
      await ctx.close(); }
    { const res = [];
      for (const safe of [SAFE, 0]) {
        const ctx = await ctxOf({ width: 1280, height: 860 }, { mobile: false, safe }); const pg = await ctx.newPage();
        await pg.goto(B + '/card/11330/', { waitUntil: 'load' }); await pg.waitForSelector('.crumb', { timeout: 60000 });
        await pg.waitForFunction(() => document.documentElement.hasAttribute('data-ui-wide'), null, { timeout: 30000 }).catch(() => {});
        await pg.waitForTimeout(500);
        res.push(await pg.evaluate(() => ({ wide: document.documentElement.hasAttribute('data-ui-wide'), n: document.querySelectorAll('button.close').length, crumb: document.querySelector('.crumb').getBoundingClientRect().top - document.querySelector('main.card-page').getBoundingClientRect().top })));   // 相對於頁面本體（頂端列本身會讓開安全區，與本版無關）
        await ctx.close();
      }
      // 網頁版：沒有 ✕；安全區不影響本頁版面（網頁版不套手機規則；頂端列自己讓開安全區，所以量相對於 main 的位置）
      r.B5 = res.every((x) => x.wide && x.n === 0) && Math.abs(res[0].crumb - res[1].crumb) < 0.5;
      r.B5n = JSON.stringify(res); }
  } finally { await browser.close(); srv.close(); }
  return r;
}

// ── 執行 ──
console.log('【L】行為：cardPageBackTarget');
const LCUR = libChecks(await loadLib(rd(P_LIB)));
ok('★★★ L1 上一頁是同站 /cards 且還有上一頁 ⇒ 返回上一頁（回到原本的卡包／篩選／視窗）', LCUR.L1, LCUR.detail.join(' | '));
ok('★★★ L2 其他情況（直接進入、外站、站內其他頁、/cardsX、壞網址、新分頁）⇒ 到該卡包的卡牌列表', LCUR.L2, LCUR.detail.join(' | '));
ok('★ L3 卡包代號會編碼', LCUR.L3, LCUR.detail.join(' | '));
ok('★★★ L4 上一頁來源：整頁載入用 referrer、站內換頁用 from、返回／前進沿用該筆紀錄記下的值（不採用 popstate 的 from）', LCUR.L4, LCUR.detail.join(' | '));
// 正對照：判準抓得到「一律 history.back()」與「只看前綴」這兩種寫壞的版本
{
  const bad1 = libChecks({ cardPageBackTarget: () => ({ kind: 'back' }) });
  const bad2 = libChecks({ cardPageBackTarget: (o) => (o.prevUrl.includes('/cards') ? { kind: 'back' } : { kind: 'go', href: `${o.base}/cards?set=${o.setCode}` }) });
  ok('★ L 正對照：一律返回上一頁 ⇒ L2 紅；只看「含 /cards」且不編碼 ⇒ L2／L3 紅', bad1.L2 === false && bad2.L2 === false && bad2.L3 === false);
}

console.log('【S】靜態');
const S = staticChecks(rd);
ok('★★★ S1 ✕ 只在掛載後且非網頁版時出現（斷點讀 WIDE_QUERY），點了走 cardPageBackTarget', S.S1);
ok('★★ S2 上一頁只走 cardPagePrevUrl，且用 snapshot 讓每筆歷史紀錄記住自己的上一頁', S.S2);
let baseMedia = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const b = readBaseBlob(ROOT, BASE_SHA, P_CARD); if (b.ok) baseMedia = (styleOf(strip(b.out)).match(/@media/g) || []).length; }
ok('★★★ S3 手機頁首讓開 --safe-top、✕ 是 fixed 且讀 --safe-top；不寫 env(safe-area…)', S.S3);
if (baseMedia == null) shallowSkip('S4 @media 數量（缺 BASE）'); else ok('★★ S4 不新增 @media（與上一版相同）', S.mediaN === baseMedia, `${S.mediaN} vs ${baseMedia}`);
ok('★ S 正對照：拿掉 --safe-top 讓位必須紅', staticChecks((p) => (p === P_CARD ? rd(p).replace('padding: calc(16px + var(--safe-top, 0px)) 18px 48px;', 'padding: 16px 18px 48px;') : rd(p))).S3 === false);

console.log('【B】真瀏覽器');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const R = await browserChecks(BUILD);
  if (!R.ran) shallowSkip('B（沒有可用的 Chromium）');
  else {
    ok('★★★ B1 手機（動態島 59px）：麵包屑、卡名、✕ 都在安全區下方；✕ ≥44px、在視窗內、點得到、不壓到麵包屑／卡名文字；不橫向捲動', R.B1 === true, R.B1n);
    ok('★★ B2 往下捲 ✕ 仍固定在右上角', R.B2 === true, R.B2n);
    ok('★★★ B3 卡片視窗 →「📄 單卡頁」→ ✕ ⇒ 回到 /cards?set=SVI&card=11330 且視窗打開', R.B3 === true, R.B3n);
    ok('★★★ B4 直接進單卡頁 → ✕ ⇒ /cards?set=SVI', R.B4 === true, R.B4n);
    ok('★★ B5 網頁版：沒有 ✕、安全區不影響版面', R.B5 === true, R.B5n);
    ok('★★★ B6 直接進單卡頁 → 點麵包屑到卡牌資料庫 → 返回 → ✕ ⇒ /cards?set=SVI（不可以 history.back() 離開網站；審查 P2-1）', R.B6 === true, R.B6n);
  }
}

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const bR = (p) => { const b = readBaseBlob(ROOT, BASE_SHA, p); return b.ok ? b.out : null; };
  let bL = { L1: false, L2: false, L3: false };
  try { bL = libChecks(await loadLib(bR(P_LIB))); } catch { /* BASE 打包失敗也算紅（Rule 41：不整支 throw） */ }
  const bS = staticChecks(bR);
  const reds = { L1: !bL.L1, L2: !bL.L2, L4: !bL.L4, S1: !bS.S1, S2: !bS.S2, S3: !bS.S3 };
  ok('★★★ HEAD-FAIL：BASE 上 L1、L2、L4、S1、S2、S3 全紅', Object.values(reds).every(Boolean), JSON.stringify(reds));
}

console.log(`\n=== v6.618 單卡頁手機 ✕／動態島：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
