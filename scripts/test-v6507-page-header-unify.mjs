#!/usr/bin/env node
/**
 * v6.507 守衛：全站頁首結構統一＋手機底部導覽列補「🏠 首頁」（站長 2026-10-07）。
 *   站長（逐字）：「牌組編輯器、對戰、錦標賽 上方 排版的方式明顯不一致耶，例如帳號和標題的順序」
 *   「我的意思是你要針對這些不同時期ai做出來的排版，做一個一致性的統一規劃，你上一版本沒有做到阿」；選定「照這個規劃做」：
 *     第 1 層 標題（左）＋本頁捷徑（右）／第 2 層 副標／第 3 層 帳號列（只在需要登入的頁，永遠在卡片最底部）；頁籤在卡片正下方。
 *   以及「手機板現在沒有辦法回到網站首頁了??」「按下下方公佈欄按鈕的時候，下方的選單還是會跳一下」。
 *
 * 【S】靜態：共用元件 PageHeader／AccountBar 的層次順序；七個頁首都改用它；舊的分散寫法（頁內「← 首頁」、auth-dashboard、
 *      tourn-who、auth-user）都不在了；錦標賽帳號列的顯示條件與舊的「已登入」那一行相同；底部導覽列第一顆是首頁、頁面最少一個畫面高
 * 【R】實際渲染元件（svelte 伺服器端編譯）：帳號列的文字、按鈕順序、匿名／未存檔／處理中；頁首四個區塊的順序
 * 【E】真瀏覽器（build/）：390／1440 六個頁面的頁首卡片頂端、標題高度一致；頁首裡沒有回首頁的連結；牌組編輯器的帳號列在卡片最底部；
 *      手機底部導覽列第一顆是首頁（在首頁時亮起）；公布欄載入中頁面也至少一個畫面高
 * 【H】HEAD-FAIL：同一批靜態判準餵 v6.506 全紅
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.506（admin v1.78 在它之後，只動 admin／伺服器）。
const BASE_SHA = '64cf7c50';
const rd = (r) => { try { return readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const noCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const markupOf = (s) => noCmt(s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, ''));

const PAGES = ['src/routes/decks/+page.svelte', 'src/routes/deck-posts/+page.svelte', 'src/routes/cards/+page.svelte',
  'src/routes/friends/+page.svelte', 'src/routes/game/+page.svelte'];

function judge(get) {
  const r = {};
  const PH = get('src/lib/ui/PageHeader.svelte'), AB = get('src/lib/ui/AccountBar.svelte');
  const phm = markupOf(PH);
  const iRow = phm.indexOf('<div class="ph-row">'), iT = phm.indexOf('<h1 class="ph-title">'), iA = phm.indexOf('<div class="ph-actions">');
  const iS = phm.indexOf('<p class="ph-sub">'), iC = phm.indexOf('<div class="ph-account">');
  // S1：頁首元件的層次：第 1 層（標題→捷徑，同一列）→ 第 2 層副標 → 第 3 層帳號列（最後）
  r.S1 = iRow > 0 && iT > iRow && iA > iT && iS > iA && iC > iS && phm.lastIndexOf('</header>') > iC;
  // S2：每個頁首都用共用元件（牌組編輯器、公布欄、卡牌資料庫×2、好友、對戰模式選擇／本機／線上、錦標賽）
  const n = (f, re) => (noCmt(get(f)).match(re) || []).length;   // 只剝 HTML 註解（好友頁的註解裡有樣式標籤字樣，整段剝會切歪）
  r.S2 = n(PAGES[0], /<PageHeader /g) === 1 && n(PAGES[1], /<PageHeader /g) === 1 && n(PAGES[2], /<PageHeader /g) === 2
    && n(PAGES[3], /<PageHeader /g) === 1 && n(PAGES[4], /<PageHeader /g) === 4;
  // S3：舊的分散寫法都不在標記裡了（頁內 ← 首頁、錦標賽 ← 回到首頁、三份 auth-dashboard、tourn-who）
  const all = PAGES.map((f) => markupOf(get(f))).join('\n');
  r.S3 = !/href="\{base\}\/"\s+class="back"|class="back"\s+href="\{base\}\/"/.test(all) && !all.includes('tourn-home-btn')
    && !all.includes('class="auth-dashboard"') && !all.includes('class="tourn-who"') && !all.includes('class="auth-user"');
  // S4：帳號列只有一份（AccountBar）：牌組編輯器、對戰大廳（lobbyAccount 三畫面共用）、錦標賽（條件與舊的「已登入」相同）
  const G = get(PAGES[4]);
  r.S4 = /<AccountBar /.test(markupOf(get(PAGES[0])))
    && (markupOf(G).match(/account=\{firebaseUser \? lobbyAccount : undefined\}/g) || []).length === 3
    && G.includes("account={tStep !== 'waiting' && !isAnonymous && firebaseUser ? tournAccount : undefined}")
    && /\{#snippet tournAccount\(\)\}\s*<AccountBar [^>]*onSignOut=\{tournLogout\}/.test(G)
    && /onSignOut = undefined/.test(AB) && AB.includes("const syncLabel = $derived(");
  // S5：手機底部導覽列第一顆是首頁；頁面最少一個畫面高（公布欄載入中頁面太短 ⇒ 網址列伸縮 ⇒ 導覽列跳）
  const NAV = get('src/lib/SiteBottomNav.svelte');
  const links = [...markupOf(NAV).matchAll(/<a class="sbn-link[^"]*"[^>]*href="\{base\}([^"]*)"/g)].map((m) => m[1]);
  r.S5 = links[0] === '/' && links.length === 6 && NAV.includes(':global(html:not([data-battle-view]) body) { min-height: 100vh; }');
  return r;
}

console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] 頁首元件的層次：標題→捷徑（同一列）→副標→帳號列（最底）', C.S1);
ok('★★★[S2] 九個頁首都改用共用元件 PageHeader（牌組、公布欄、卡牌×2、好友、對戰×3、錦標賽）', C.S2);
ok('★★★[S3] 舊的分散寫法都不在了（頁內 ← 首頁、← 回到首頁、auth-dashboard、tourn-who、auth-user）', C.S3);
ok('★★★[S4] 帳號列只有一份 AccountBar；錦標賽帳號列的條件＝舊的「已登入」那一行（等待進場／匿名不顯示）', C.S4);
ok('★★★[S5] 手機底部導覽列第一顆是首頁（共 6 顆）、頁面最少一個畫面高', C.S5);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((f) => { const b = readBaseBlob(ROOT, BASE_SHA, f); return b.ok ? b.out.replace(/\r\n/g, '\n') : ''; });
  const red = Object.entries(B).filter(([, v]) => !v).map(([k]) => k);
  console.log('  （HEAD-FAIL 逐條：v6.506 紅了 ' + red.join('、') + '）');
  ok('★★[H0] HEAD-FAIL：同一份判準餵 v6.506，S1～S5 全紅', red.length === 5, JSON.stringify(B));
} else shallowSkip('v6507 H0', '需要 BASE commit');

// ── 【R】實際渲染元件 ──────────────────────────────────────────────
console.log('\n【R】實際渲染元件（svelte 伺服器端）');
{
  const { compile } = await import('svelte/compiler');
  const { render } = await import('svelte/server');
  const { createRawSnippet } = await import('svelte');
  const tmp = [];
  const load = async (rel, tag) => {
    const out = compile(rd(rel), { generate: 'server', filename: rel }).js.code;
    const p = join(ROOT, `.v6507-${tag}.mjs`); writeFileSync(p, out); tmp.push(p);
    return (await import(pathToFileURL(p).href)).default;
  };
  try {
    const AB = await load('src/lib/ui/AccountBar.svelte', 'ab');
    const PH = await load('src/lib/ui/PageHeader.svelte', 'ph');
    const html = (C, props) => render(C, { props }).body.replace(/<!--[^>]*-->/g, '');
    const fn = () => {};
    const btns = (h) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
    const h1 = html(AB, { email: 'a@b.tw', syncStatus: 'synced', onChangePassword: fn, onSignOut: fn });
    ok('★★★[R1] 登入：左邊「☁️ 已同步」＋email，右邊依序「🔑 更改密碼」「登出」',
      h1.indexOf('☁️ 已同步') > 0 && h1.indexOf('✉️ a@b.tw') > h1.indexOf('☁️ 已同步') && JSON.stringify(btns(h1)) === JSON.stringify(['🔑 更改密碼', '登出']), h1);
    const h2 = html(AB, { anonymous: true, syncStatus: 'idle', onCreateAccount: fn, onChangePassword: fn, onSignOut: fn });
    ok('★★★[R2] 匿名：只有「建立帳號」（沒有更改密碼／登出）、顯示「⬜ 本機」', JSON.stringify(btns(h2)) === JSON.stringify(['建立帳號']) && h2.includes('⬜ 本機') && h2.includes('👤 匿名'), h2);
    const h3 = html(AB, { email: 'a@b.tw', syncStatus: 'synced', unsaved: 2, onSignOut: fn });
    ok('★★[R3] 牌組未存檔 2 個 ⇒「📝 未存檔 (2)」（蓋過已同步）；沒給改密碼函式就不出現那顆', h3.includes('📝 未存檔 (2)') && !h3.includes('已同步') && JSON.stringify(btns(h3)) === JSON.stringify(['登出']), h3);
    const h4 = html(AB, { email: 'a@b.tw', busy: true, onChangePassword: fn, onSignOut: fn });
    ok('★★[R4] 錦標賽：不顯示同步狀態（syncStatus 沒給）；處理中按鈕不能按', !h4.includes('sync-pill') && (h4.match(/<button[^>]*disabled/g) || []).length === 2, h4);
    const h5 = html(AB, { syncStatus: 'error', syncError: '連不上' });
    ok('★[R5] 離線：「⚠️ 離線（hover 看原因）」，滑鼠停留顯示原因', h5.includes('⚠️ 離線') && h5.includes('title="連不上"'), h5);
    const sn = (t) => createRawSnippet(() => ({ render: () => `<span>${t}</span>` }));
    const p1 = html(PH, { title: '🧩 牌組編輯器', sub: '副標文字', actions: sn('捷徑X'), account: sn('帳號Y'), cls: 'page-head' });
    const o = ['🧩 牌組編輯器', '捷徑X', '副標文字', '帳號Y'].map((t) => p1.indexOf(t));
    ok('★★★[R6] 頁首渲染順序：標題 → 捷徑 → 副標 → 帳號列，外層保留 page-head 類別', o.every((v, i) => v > 0 && (i === 0 || v > o[i - 1])) && /<header class="ph page-head/.test(p1), p1);
    const p2 = html(PH, { title: 'T' });
    ok('★★[R7] 沒給的層不渲染（沒有空的捷徑／副標／帳號列外框）', !/ph-actions|ph-sub|ph-account/.test(p2), p2);
  } finally { for (const p of tmp) { try { unlinkSync(p); } catch { /* */ } } }
}

// ── 【E】真瀏覽器 ──────────────────────────────────────────────
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.507') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.507');
  if (browser) {
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    // 公布欄的清單 API 故意延遲回應 ⇒ 量得到「載入中」那一刻的頁面高度
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (u.pathname.startsWith('/api/')) { setTimeout(() => { res.writeHead(404); res.end(); }, 3000); return; }
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    try {
      for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
        const got = {};
        for (const path of ['/cards', '/decks', '/deck-posts', '/game', '/tournament', '/friends']) {
          const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
          await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
          const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
          await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
          got[path] = await pg.evaluate(() => {
            const ph = document.querySelector('header.ph'); const t = ph?.querySelector('h1.ph-title');
            const vis = (a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 0;
            const kids = ph ? [...ph.children].map((c) => c.className.split(' ')[0]) : [];
            return { top: ph ? Math.round(ph.getBoundingClientRect().top) : null, h1: t ? Math.round(t.getBoundingClientRect().top) : null,
              home: ph ? [...ph.querySelectorAll('a')].filter((a) => /^\/?$/.test(a.getAttribute('href') || '') && vis(a)).length : -1, kids,
              radius: ph ? getComputedStyle(ph).borderTopLeftRadius : null };
          });
          await ctx.close();
        }
        const tag = String(w);
        const vals = Object.values(got);
        ok(`★★★[E1] ${tag}：六頁的頁首卡片頂端與標題高度都一樣（切頁時標題不跳）`, vals.every((v) => v.top !== null && v.top === vals[0].top && v.h1 === vals[0].h1), JSON.stringify(got));
        ok(`★★[E2] ${tag}：頁首是卡片（${mobile ? 14 : 16}px 圓角）、裡面沒有回首頁的連結`, vals.every((v) => v.radius === (mobile ? '14px' : '16px') && v.home === 0), JSON.stringify(got));
        ok(`★★★[E3] ${tag}：牌組編輯器頁首三層：標題列 → 副標 → 帳號列（最底）`, JSON.stringify(got['/decks'].kids) === JSON.stringify(['ph-row', 'ph-sub', 'ph-account']), JSON.stringify(got['/decks'].kids));
        if (mobile) ok(`★★[E4] ${tag}：頁首卡片頂端 12px`, vals[0].top === 12, String(vals[0].top));
      }
      // 手機底部導覽列：首頁鈕、公布欄載入中頁面高度
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await pg.waitForTimeout(1200);
      const nav = await pg.evaluate(() => [...document.querySelectorAll('.sbn .sbn-link')].map((a) => [a.getAttribute('href'), a.classList.contains('active'), a.textContent.trim()]));
      ok('★★★[E5] 手機底部導覽列第一顆是「🏠 首頁」、在首頁時亮起', nav[0] && nav[0][0] === '/' && nav[0][1] === true && nav[0][2].includes('首頁') && nav.filter((x) => x[1]).length === 1, JSON.stringify(nav));
      await pg.click('.sbn-link:has-text("公布欄")'); await pg.waitForTimeout(600);
      const hh = await pg.evaluate(() => ({ doc: document.documentElement.scrollHeight, vh: innerHeight, path: location.pathname, homeActive: document.querySelector('.sbn-home')?.classList.contains('active') }));
      ok('★★★[E6] 公布欄還在載入中：頁面高度已經超過一個畫面（網址列不會因為頁面太短而伸縮，導覽列不跳）', hh.path === '/deck-posts' && hh.doc > hh.vh && hh.homeActive === false, JSON.stringify(hh));
      await ctx.close();
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.507 全站頁首統一＋手機首頁鈕：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
