#!/usr/bin/env node
/**
 * v6.617 守衛：卡牌資料的「出自於卡包」改成卡包封面卡片＋連到該卡包
 *
 * 站長 2026-11-02 轉述玩家建議：「卡牌資料頁中，「出自於卡包」項目建議加入卡裨資料庫那種的卡包封面圖，
 *   還有附上連結跳轉去該卡包的資料頁。在手機查卡牌出處感覺有點麻煩……」
 * 站長看過預覽後：「1.設計可以 2.依你的建議文字完全換掉」。
 *
 * 【S】靜態（剝註解後比對）
 *   S1 卡牌資料庫頁（/cards）的卡片視窗用 SetSourceCard，舊的「出自於卡包【…】」文字與 .footSet 樣式都不在了
 *   S2 正在看的就是同一個卡包 ⇒ href 是 null（只顯示、不連結）；不同卡包 ⇒ 連到 /cards?set=代號
 *   S5 封面網址只有一份（$lib/cards/cover-url 的 coverUrl，卡包列表與元件共用）；單卡頁張數扣掉下架卡（applyHiddenCountsToSets）
 *   S3 單卡頁（/card/[id]）用同一個元件，卡包摘要由伺服器端 getSetSummary 給（Rule 38：元件只有一份）
 *   S4 SVI 卡包封面是卡圖（card-img/tw000…png），不是 v6.616 誤填的官網商品小圖
 * 【B】真瀏覽器（本機 build；沙盒沒有 build ⇒ SHALLOW-SKIP）
 *   B1 /cards?set=ALL 開卡片視窗：出處卡片是連結、href＝?set=SVI、有封面圖與卡包名；點了到 SVI 卡包的列表
 *      （⚠ .modalInner 會 stopPropagation ⇒ 是整頁導航，同既有「📄 單卡頁」連結；審查 P2-2）
 *   B2 /cards?set=SVI 開同一張卡：出處卡片不是連結、標「目前瀏覽中」
 *   B3 手機 390 寬（三種情境：連結、深色主題下的長卡包名、同卡包）的**版面**：卡片整個在視窗內、頁面不橫向捲動、
 *      日期等每一段都不被拆成兩行、SVI 的資訊列同一行、可點高度 ≥44px（不驗顏色；顏色只讀 --ui-* 色票）
 *   B5 單卡頁的「N 張」＝/cards 該卡包的張數（M-P-J 有下架卡：index 141、玩家看到 139；審查 P2-1）
 *   B4 單卡頁：電腦版卡包卡片在右欄（資料表正下方、卡圖右邊）；手機版接在表格後；連結指到該卡包
 * 【H】HEAD-FAIL：BASE（c430b6ac）上 S1／S3／S4／S5 紅
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'c430b6ac';   // v6.616＋鐵律 Rule 90（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };

const P_CARDS = 'src/routes/cards/+page.svelte';
const P_CARD = 'src/routes/card/[id]/+page.svelte';
const P_CARD_SRV = 'src/routes/card/[id]/+page.server.ts';
const P_COMP = 'src/lib/components/SetSourceCard.svelte';
const P_IDX = 'static/cards/index.json';
const strip = (s) => (s == null ? null : stripCommentsBlankChecked(s.replace(/\r\n/g, '\n')));

function staticChecks(read) {
  const r = {};
  const cards = strip(read(P_CARDS)), card = strip(read(P_CARD)), srv = strip(read(P_CARD_SRV)), comp = strip(read(P_COMP));
  // S1
  r.S1 = !!cards && /import SetSourceCard from '\$lib\/components\/SetSourceCard\.svelte'/.test(cards)
    && /<SetSourceCard\s+set=\{setByCode\[selected\.setCode\]\}/.test(cards)
    && !/出自於卡包【/.test(cards) && !/\.footSet\b/.test(cards);
  // S2：同卡包 ⇒ null；不同 ⇒ /cards?set=…（整頁導航，見元件註解）
  r.S2 = !!cards && /href=\{selected\.setCode === data\.setCode \? null : `\$\{base\}\/cards\?set=\$\{encodeURIComponent\(selected\.setCode\)\}`\}/.test(cards)
    && !!comp && /\{#if href\}\s*<a class="ssc"/.test(comp) && /目前瀏覽中/.test(comp);
  // S3
  r.S3 = !!card && !!srv && /import SetSourceCard from '\$lib\/components\/SetSourceCard\.svelte'/.test(card)
    && /<SetSourceCard set=\{data\.set\} href=\{`\$\{base\}\/cards\?set=\$\{encodeURIComponent\(card\.setCode\)\}`\}/.test(card)
    && /getSetSummary\(String\(card\.setCode\)\)/.test(srv);
  // S4
  let idx = null; try { idx = JSON.parse(read(P_IDX)); } catch { /* */ }
  const svi = idx?.find((e) => e.code === 'SVI');
  r.S4 = !!svi && /^https:\/\/asia\.pokemon-card\.com\/tw\/card-img\/tw\d{8}\.png$/.test(svi.coverImageUrl ?? '');
  // S5
  const ci = strip(read('src/lib/server/cardIndex.ts'));
  r.S5 = !!cards && !!comp && !!ci && /import \{ coverUrl \} from '\$lib\/cards\/cover-url'/.test(cards) && !/function coverUrl\(/.test(cards)
    && /import \{ coverUrl, type SetLite \} from '\$lib\/cards\/cover-url'/.test(comp) && !/function cover\w*\(/.test(comp)
    && /applyHiddenCountsToSets\(JSON\.parse\(readFileSync\(join\(DIR, 'index\.json'\)/.test(ci);
  return r;
}
const rd = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };
const S = staticChecks(rd);
console.log('【S】靜態');
ok('★★★ S1 卡片視窗改用 SetSourceCard，舊「出自於卡包【…】」文字與 .footSet 樣式已移除', S.S1);
ok('★★★ S2 同卡包只顯示（標目前瀏覽中）、不同卡包連到 /cards?set=代號', S.S2);
ok('★★ S5 封面網址只有一份、單卡頁張數扣掉下架卡', S.S5);
ok('★★ S3 單卡頁用同一個元件，卡包摘要來自伺服器 getSetSummary', S.S3);
ok('★★ S4 SVI 封面是卡圖（不是官網商品小圖）', S.S4);
// 正對照：判準抓得到「舊文字還在」
ok('★ S1 正對照：把舊文字塞回去必須紅', staticChecks((p) => (p === P_CARDS ? rd(p) + '\n<p class="footSet">出自於卡包【X】</p>' : rd(p))).S1 === false);

// ── B：真瀏覽器 ──
async function browserChecks(buildDir) {
  const r = { ran: false };
  const chromium = pwChromium('v6.617 出自於卡包');
  if (!chromium) return r;
  const browser = await pwLaunchWith(chromium, 'v6.617 出自於卡包');
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
  const open = async (url, vp, { touch = false, dark = false } = {}) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, colorScheme: dark ? 'dark' : 'light', ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
    await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
    const pg = await ctx.newPage();
    await pg.goto(B + url, { waitUntil: 'load' });
    await pg.waitForSelector('.ssc', { timeout: 60000 });
    return { ctx, pg };
  };
  // 版面量測（同一支函式給所有情境用）
  const measure = (pg) => pg.evaluate(() => {
    const el = document.querySelector('.ssc'); const box = el.getBoundingClientRect();
    const modal = document.querySelector('.modalInner');
    const mb = modal ? modal.getBoundingClientRect() : { left: 0, right: innerWidth };
    const segs = [...el.querySelectorAll('.ssc-seg')].map((s) => s.getClientRects().length);
    const img = el.querySelector('img.ssc-cover');
    const meta = el.querySelector('.ssc-meta'); const fs = parseFloat(getComputedStyle(meta).fontSize);
    const metaOneLine = meta.getBoundingClientRect().height <= fs * 1.8;   // 代號·發售日·張數 在同一行
    return {
      tag: el.tagName, href: el.getAttribute('href'), name: el.querySelector('.ssc-name')?.textContent ?? '',
      here: !!el.querySelector('.ssc-here'), cover: img ? img.getAttribute('src') : null,
      left: box.left, right: box.right, h: box.height, mL: mb.left, mR: mb.right,
      hScroll: document.documentElement.scrollWidth > innerWidth + 1, segLines: segs, metaOneLine,
    };
  });
  try {
    // B1：ALL 檢視 ⇒ 連結
    { const { ctx, pg } = await open('/cards?set=ALL&card=11330', { width: 1366, height: 900 });
      const m = await measure(pg);
      await pg.click('a.ssc'); await pg.waitForFunction(() => location.search.includes('set=SVI') && document.querySelector('.cardBtn'), null, { timeout: 30000 });
      await pg.waitForTimeout(800);
      const after = await pg.evaluate(() => ({ q: location.search, modal: !!document.querySelector('.modalInner'), sub: document.querySelector('.ph-sub')?.textContent ?? '' }));
      r.B1 = m.tag === 'A' && /\/cards\?set=SVI$/.test(m.href) && m.name === 'Trianers Camp' && /card-img\/tw00011307\.png$/.test(m.cover ?? '')
        && /(^|&|\?)set=SVI(&|$)/.test(after.q) && after.modal === false && /共 58 張卡/.test(after.sub);   // 真的到了 SVI 卡包的列表
      r.B1n = JSON.stringify({ m, after }); await ctx.close(); }
    // B2：同卡包 ⇒ 只顯示
    { const { ctx, pg } = await open('/cards?set=SVI&card=11330', { width: 1366, height: 900 });
      const m = await measure(pg);
      r.B2 = m.tag === 'DIV' && m.href === null && m.here === true && m.name === 'Trianers Camp';
      r.B2n = JSON.stringify(m); await ctx.close(); }
    // B3：手機 390（淺色連結、深色長名、同卡包）
    { const res = [];
      for (const [url, dark] of [['/cards?set=ALL&card=11330', false], ['/cards?set=ALL&card=11105', true], ['/cards?set=SVI&card=11330', false]]) {
        const { ctx, pg } = await open(url, { width: 390, height: 844 }, { touch: true, dark });
        await pg.locator('.ssc').scrollIntoViewIfNeeded();
        const m = await measure(pg); res.push({ url, ...m }); await ctx.close();
      }
      r.B3 = res.every((m) => m.left >= m.mL - 0.5 && m.right <= m.mR + 0.5 && !m.hScroll && m.segLines.length >= 2 && m.segLines.every((n) => n === 1) && m.h >= 44)
        && res[1].name.startsWith('ex特別組合') && res[0].metaOneLine && res[2].metaOneLine;   // SVI 兩種情境（含「目前瀏覽中」）代號·發售日·張數 要在同一行
      r.B3n = JSON.stringify(res); }
    // B4：單卡頁
    { const { ctx, pg } = await open('/card/11330/', { width: 1366, height: 900 });
      const d = await pg.evaluate(() => {
        const s = document.querySelector('.ssc').getBoundingClientRect(), img = document.querySelector('.card-page .img').getBoundingClientRect(), t = document.querySelector('.info').getBoundingClientRect();
        return { sL: s.left, sT: s.top, imgR: img.right, tB: t.bottom, tL: t.left, href: document.querySelector('.ssc').getAttribute('href') };
      });
      await ctx.close();
      const mob = await open('/card/11330/', { width: 390, height: 844 }, { touch: true });
      const mm = await mob.pg.evaluate(() => {
        const s = document.querySelector('.ssc').getBoundingClientRect(), t = document.querySelector('.info').getBoundingClientRect();
        return { sT: s.top, tB: t.bottom, sR: s.right, hScroll: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      await mob.ctx.close();
      r.B4 = d.sL >= d.imgR && Math.abs(d.sL - d.tL) < 1 && d.sT >= d.tB - 1 && d.sT - d.tB < 30 && /\/cards\?set=SVI$/.test(d.href)
        && mm.sT >= mm.tB - 1 && mm.sR <= 390 && !mm.hScroll;
      r.B4n = JSON.stringify({ d, mm }); }
    // B5：M-P-J 單卡頁的張數＝/cards 的張數（有下架卡的卡包）
    { const mpj = JSON.parse(readFileSync(join(ROOT, 'static/cards/M-P-J.json'), 'utf8'));
      const id = mpj.map((c) => String(c.id)).find((x) => existsSync(join(buildDir, 'card', x, 'index.html')));
      const { ctx, pg } = await open(`/card/${id}/`, { width: 1366, height: 900 });
      const pageN = await pg.evaluate(() => Number((document.querySelector('.ssc-meta')?.textContent.match(/(\d+) 張/) || [])[1]));
      await ctx.close();
      const c2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
      await c2.route(/pokemon-card\.com|ptcg-tw-sim-img|firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
      const p2 = await c2.newPage(); await p2.goto(B + '/cards?set=M-P-J', { waitUntil: 'load' }); await p2.waitForSelector('.cardBtn', { timeout: 60000 });
      const listN = await p2.evaluate(() => Number((document.querySelector('.ph-sub')?.textContent.match(/共 (\d+) 張卡/) || [])[1]));
      await c2.close();
      r.B5 = !!id && pageN > 0 && pageN === listN && pageN < mpj.length;   // M-P-J 有下架卡 ⇒ 必須比檔案張數少
      r.B5n = JSON.stringify({ id, pageN, listN, file: mpj.length}); }
  } finally { await browser.close(); srv.close(); }
  return r;
}
const BUILD = process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
console.log('【B】真瀏覽器');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const R = await browserChecks(BUILD);
  if (!R.ran) shallowSkip('B（沒有可用的 Chromium）');
  else {
    ok('★★★ B1 ALL 檢視：出處卡片是連結（?set=SVI、封面、卡包名），點了到該卡包的列表（共 58 張）', R.B1 === true, R.B1n);
    ok('★★★ B2 同卡包：不是連結、標「目前瀏覽中」', R.B2 === true, R.B2n);
    ok('★★★ B3 手機 390 版面（連結／深色長名／同卡包）：卡片在視窗內、不橫向捲動、每段不拆行、SVI 的資訊列同一行、高度 ≥44px', R.B3 === true, R.B3n);
    ok('★★ B4 單卡頁：電腦版在右欄資料表正下方、手機接在表格後、連到該卡包', R.B4 === true, R.B4n);
    ok('★★★ B5 單卡頁的「N 張」＝/cards 該卡包的張數（M-P-J 扣掉下架卡）', R.B5 === true, R.B5n);
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const bS = staticChecks((p) => { const b = readBaseBlob(ROOT, BASE_SHA, p); return b.ok ? b.out : null; });
  ok('★★★ HEAD-FAIL：BASE 上 S1、S3、S4、S5 紅', bS.S1 !== true && bS.S3 !== true && bS.S4 !== true && bS.S5 !== true, JSON.stringify(bS));
}

console.log(`\n=== v6.617 出自於卡包（封面＋連結）：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
