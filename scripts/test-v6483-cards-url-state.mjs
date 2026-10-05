#!/usr/bin/env node
/**
 * v6.483 守衛：卡牌資料庫的搜尋／篩選條件寫進網址＋卡片視窗連到單卡頁（站長同意的建議 #1）。
 *   【L】$lib/cards/url-state：讀寫往返一致、不認得的值忽略、保留 set 參數、預設條件不寫任何參數。
 *   【P】$lib/cards/card-page：hasCardPage 與建置期預渲染範圍（getStdCardIds：未下架＋預設政策的標準標記）對全部真實卡逐張相同。
 *   【E】真瀏覽器：搜尋／勾選後網址跟著變；開卡片 ⇒ 網址帶 card；重新整理 ⇒ 條件與卡片視窗都還原；
 *        「單卡頁」連到存在的預渲染頁；關掉視窗 ⇒ card 參數拿掉；卡包列表頁不寫任何參數。
 * HEAD-FAIL：靜態判準餵 v6.482 必須紅。
 * Run: node scripts/test-v6483-cards-url-state.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.482。
const BASE_SHA = '91965609';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function judge(get) {
  const s = get('src/routes/cards/+page.svelte');
  return {
    S1: s.includes("from '$lib/cards/url-state'") && /readCardsUrlState\(location\.search/.test(s) && /replaceState\(location\.pathname \+ next/.test(s),
    S2: s.includes("from '$lib/cards/card-page'") && /class="cardPageLink" href=\{selectedPageHref\}/.test(s),
  };
}
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 卡牌資料庫：進頁讀網址、條件變動以 replaceState 寫回', J.S1);
ok('★★★[S2] 卡牌資料庫：卡片視窗有單卡頁連結（判準走 $lib/cards/card-page）', J.S2);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.482 全紅', !B.S1 && !B.S2, JSON.stringify(B));
} else shallowSkip('v6483 S0：HEAD-FAIL', '需要 BASE commit');

const { build } = await import('esbuild');
const load = async (f) => { const o = await build({ entryPoints: [join(ROOT, f)], bundle: true, format: 'esm', write: false, platform: 'neutral' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const U = await load('src/lib/cards/url-state.ts');
const P = await load('src/lib/cards/card-page.ts');
const V = await load('src/lib/cards/visibility.ts');

console.log('\n【L】網址讀寫');
{
  const AL = { cat: ['Pokemon', 'Item'], tag: ['ACE SPEC'], type: ['Fire', 'Water'], stage: ['Basic'], mark: ['H', 'I', 'J'] };
  const st = { q: '皮卡丘 ex', mode: 'keyword', scope: 'attacks', cat: ['Pokemon'], tag: [], type: ['Water', 'Fire'], stage: ['Basic'], mark: ['J'], card: '18367' };
  const s1 = U.writeCardsUrlSearch('?set=ALL', st);
  const back = U.readCardsUrlState(s1, AL);
  ok('★★★[L1] 寫入再讀回＝同一組條件（多選順序不拘）；set 參數保留', new URLSearchParams(s1).get('set') === 'ALL' && back.q === st.q && back.mode === 'keyword' && back.scope === 'attacks' && back.cat.join() === 'Pokemon' && [...back.type].sort().join() === 'Fire,Water' && back.mark.join() === 'J' && back.card === '18367', s1 + ' ⇒ ' + JSON.stringify(back));
  ok('★★★[L2] 預設條件不寫任何參數（一般瀏覽網址與以前相同）', U.writeCardsUrlSearch('?set=MJ', { q: '  ', mode: 'normal', scope: 'all', cat: [], tag: [], type: [], stage: [], mark: [], card: null }) === '?set=MJ');
  const bad = U.readCardsUrlState('?q=x&m=hack&s=zzz&cat=Pokemon,Evil,Pokemon&type=<script>&card=../../x', AL);
  ok('★★★[L3] 網址被亂改：不認得的值一律忽略、不會壞', bad.mode === 'normal' && bad.scope === 'all' && bad.cat.join() === 'Pokemon' && bad.type.length === 0 && bad.card === null, JSON.stringify(bad));
  ok('★★[L4] 非關鍵字模式不寫範圍參數；搜尋字有長度上限', !U.writeCardsUrlSearch('', { ...st, mode: 'normal' }).includes('s=') && U.readCardsUrlState('?q=' + 'a'.repeat(500), AL).q.length === U.URL_Q_MAX);
}

console.log('\n【P】單卡頁判準＝建置期預渲染範圍');
{
  const cards = [];
  for (const f of readdirSync(join(ROOT, 'static/cards'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const d = JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8'));
    if (Array.isArray(d)) for (const c of d) if (c && c.id != null) cards.push(c);
  }
  // 建置期（$lib/server/cardIndex.ts getStdCardIds）的判準：未下架＋預設政策的標準標記
  const STD = new Set(['H', 'I', 'J']);
  let diff = 0, yes = 0; const ex = [];
  for (const c of cards) {
    const build = !V.isHiddenFromPlayers(String(c.id)) && !!c.regulationMark && STD.has(c.regulationMark);
    const a = P.hasCardPage(c); if (a) yes++;
    if (a !== build) { diff++; if (ex.length < 3) ex.push(c.id); }
  }
  ok('★★★[P1] hasCardPage 與預渲染範圍逐張相同（不會連到不存在的頁）', cards.length > 3000 && diff === 0, JSON.stringify({ n: cards.length, diff, ex }));
  ok('[P2] 正對照：有單卡頁的卡數量合理（不是全部 false）', yes > 2000, String(yes));
  ok('[P3] 建置期判準仍是「未下架＋isCardMarkStandardLegal」（改了要同步這支）', /if \(isHiddenFromPlayers\(id\)\) continue;/.test(rd('src/lib/server/cardIndex.ts')) && /isCardMarkStandardLegal\(c\.regulationMark\)\) ids\.push\(id\)/.test(rd('src/lib/server/cardIndex.ts')) && /allowedMarks: Object\.freeze\(\['H', 'I', 'J'\]\)/.test(rd('src/lib/cards/regulation.ts')));
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.483') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.483');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) { res.writeHead(404, { 'content-type': 'text/html' }); createReadStream(join(BUILD, '404.html')).pipe(res); return; }
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    try {
      for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
        await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/cards`, { waitUntil: 'load' }); await pg.waitForTimeout(1200);
        const idx = new URL(pg.url()).search;
        await pg.goto(`http://localhost:${port}/cards?set=ALL`, { waitUntil: 'load' }); await pg.waitForSelector('.cardBtn', { timeout: 20000 });
        await pg.waitForTimeout(600);
        const clean = new URL(pg.url()).search;
        await pg.fill('.controls input[type=search]', '皮卡丘 ex'); await pg.waitForTimeout(800);
        const u1 = new URL(pg.url());
        await pg.locator('.cardBtn').first().click(); await pg.waitForTimeout(700);
        const u2 = new URL(pg.url());
        const href = await pg.getAttribute('.cardPageLink', 'href');
        await pg.goto(u2.href, { waitUntil: 'load' }); await pg.waitForSelector('.cardBtn', { timeout: 20000 }); await pg.waitForTimeout(800);
        const R = await pg.evaluate(() => ({ q: document.querySelector('.controls input[type=search]').value, modal: !!document.querySelector('.modalInner') }));
        await pg.locator('.close').first().click(); await pg.waitForTimeout(700);
        const u3 = new URL(pg.url());
        let cardOk = false;
        if (href) { const r = await pg.request.get(`http://localhost:${port}${href}`); cardOk = r.status() === 200 && (await r.text()).includes('<title>'); }
        await ctx.close();
        const tag = mobile ? '手機 390' : '1280';
        ok(`★★★[E1] ${tag}：卡包列表與剛進卡片列表時網址沒有多餘參數`, idx === '' && clean === '?set=ALL', JSON.stringify({ idx, clean }));
        ok(`★★★[E2] ${tag}：搜尋後網址帶 q、開卡片帶 card，set 保留`, u1.searchParams.get('q') === '皮卡丘 ex' && u1.searchParams.get('set') === 'ALL' && !!u2.searchParams.get('card'), u1.search + ' / ' + u2.search);
        ok(`★★★[E3] ${tag}：重新整理 ⇒ 搜尋字與卡片視窗都還原`, R.q === '皮卡丘 ex' && R.modal, JSON.stringify(R));
        ok(`★★[E4] ${tag}：關掉視窗 ⇒ card 參數拿掉、搜尋字還在`, !u3.searchParams.get('card') && u3.searchParams.get('q') === '皮卡丘 ex', u3.search);
        ok(`★★★[E5] ${tag}：「單卡頁」連到存在的預渲染頁`, !!href && /^\/card\/[^/]+\/$/.test(href) && cardOk, String(href));
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
