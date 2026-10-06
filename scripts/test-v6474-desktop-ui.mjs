#!/usr/bin/env node
/**
 * v6.474 守衛：網頁版（≥1024px）介面強化第一階段 —— 全站頂端列＋淺色／深色主題＋首頁兩欄。
 *   站長：「網頁版為了迎合手機版而顯得簡陋」「全站主色調兩種都做」。
 *
 * 必須守住的事：
 *   ① 規則單一來源 $lib/site-theme.ts（純函式實跑＋突變）：
 *      ・頂端列：/game、/tournament（沿用 viewport-zoom 的 isBattleRoute）與 /admin 不顯示，其他頁顯示。
 *      ・目前所在頁：/card/123 算「卡牌資料庫」；/deck-posts 不可被誤判成 /decks。
 *      ・主題：玩家選過用玩家的，沒選過跟作業系統；壞值當沒選過。
 *   ② 手機與平板（<1024px）一個像素都不變：頂端列預設 display:none、首頁新規則全部在 min-width:1024px 內；
 *      真瀏覽器量：390 寬首頁 main 仍是 680 上限單欄、頂端列不佔空間。
 *   ③ 不增加冷進站往返：layout 這個每頁必載節點不可用 {#each}、SiteTopBar 的 props 不可給預設值
 *      （兩者都會讓 Svelte 執行期被拆成新 chunk 塞進第一批預載；v6.474 實作時在 HTTP/1.1 下實測多一輪往返）；
 *      logo 用 app.html 載入畫面同一個 URL（瀏覽器已有）。
 *   ④ 主題在 layout 初始化就寫 <html data-theme>（不放 onMount ⇒ 不閃）；已接主題的頁面由 layout 掛 <html data-ui-themed>，網頁版底色跟著主題（離開就拿掉）。
 *   ⑤ 真瀏覽器（build/）：1440 寬頂端列 56px、首頁兩欄、切換鈕翻轉並記住、深色底色生效；/game 沒有頂端列；
 *      /cards 有頂端列但沒有切換鈕（還沒接上主題的頁面按了沒反應只會讓人困惑）。
 *
 * Run: node scripts/test-v6474-desktop-ui.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createRequire } from 'node:module';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.473 之後的 LICENSE commit。
const BASE_SHA = '2fae442b';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;

const VZ = rd('src/lib/viewport-zoom.ts');
function loadTheme(src) {
  if (!src) return null;
  try {
    const body = ts2js(VZ.replace(/^export /gm, '') + '\n' + src.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, ''));
    return new Function(body + '\n;return { THEME_KEY, THEMED_ROUTES, NAV_ITEMS, stripBase, showTopBar, isThemedRoute, activeNavHref, parseStoredTheme, resolveTheme, isBattleView: typeof isBattleView === "function" ? isBattleView : null };')();
  } catch (e) { return null; }
}

// 規則判準（同一份判準同時餵現行版、BASE、突變版）
function judge(M) {
  const r = {};
  if (!M) return { A0: false };
  r.A0 = true;
  // ⭐v6.475 起：/game、/tournament 的大廳也顯示頂端列（牌桌畫面另由 data-battle-view 收起，見 A8）
  const hidden = [['/admin', ''], ['/admin/feedbacks', ''], ['/b/admin/feedbacks', '/b']];
  const shown = [['/', ''], ['/cards', ''], ['/card/19378/', ''], ['/decks', ''], ['/deck-posts', ''], ['/friends', ''], ['/game', ''], ['/tournament', ''], ['/administrator', ''], ['/b/', '/b'], ['/b/cards', '/b'], ['/b/game', '/b']];
  r.A1 = hidden.every(([p, b]) => M.showTopBar(p, b) === false) && shown.every(([p, b]) => M.showTopBar(p, b) === true);
  r.A2 = M.activeNavHref('/cards', '') === '/cards' && M.activeNavHref('/card/19378/', '') === '/cards'
    && M.activeNavHref('/deck-posts', '') === '/deck-posts' && M.activeNavHref('/decks', '') === '/decks'
    && M.activeNavHref('/', '') === '' && M.activeNavHref('/friends', '') === '' && M.activeNavHref('/b/tournament', '/b') === '/tournament'
    && M.activeNavHref('/cardsx', '') === '';
  // 已接主題的頁面（v6.477 起全站：首頁、卡牌、單卡、牌組、公布欄、對戰大廳、錦標賽大廳、好友）；後台不在清單；
  //   牌桌畫面另由 data-battle-view 排除（見 test-v6477-lobby-light）
  r.A3 = M.isThemedRoute('/', '') && M.isThemedRoute('/b/', '/b') && M.isThemedRoute('/b', '/b') && M.isThemedRoute('/cards', '') && M.isThemedRoute('/card/19378/', '')
    && M.isThemedRoute('/game', '') && M.isThemedRoute('/tournament', '') && M.isThemedRoute('/friends', '')
    && !M.isThemedRoute('/cardsx', '') && !M.isThemedRoute('/admin', '') && !M.isThemedRoute('/admin/feedbacks', '');
  // 牌桌畫面判準：只在對戰路由；錦標賽看 tStep、休閒看有沒有盤面
  r.A8 = !!M.isBattleView && M.isBattleView('/game', '', false, 'lobby', true) === true && M.isBattleView('/game', '', false, 'lobby', false) === false
    && M.isBattleView('/tournament', '', true, 'playing', false) === true && M.isBattleView('/tournament', '', true, 'lobby', true) === false
    && M.isBattleView('/tournament', '', true, 'waiting', true) === false && M.isBattleView('/b/game', '/b', false, 'lobby', true) === true
    && M.isBattleView('/cards', '', false, 'lobby', true) === false;
  r.A4 = M.parseStoredTheme('dark') === 'dark' && M.parseStoredTheme('light') === 'light' && M.parseStoredTheme('Dark') === null
    && M.parseStoredTheme(null) === null && M.parseStoredTheme('') === null
    && M.resolveTheme(null, true) === 'dark' && M.resolveTheme(null, false) === 'light'
    && M.resolveTheme('light', true) === 'light' && M.resolveTheme('dark', false) === 'dark';
  r.A5 = Array.isArray(M.NAV_ITEMS) && M.NAV_ITEMS.map((x) => x.href).join(',') === '/cards,/decks,/deck-posts,/game,/tournament';
  return r;
}

console.log('【A】規則單一來源 src/lib/site-theme.ts（純函式實跑）');
const ST = existsSync(join(ROOT, 'src/lib/site-theme.ts')) ? rd('src/lib/site-theme.ts') : '';
const M = loadTheme(ST);
const J = judge(M);
ok('★★★[A0] 規則模組存在且可執行', J.A0);
ok('★★★[A1] 頂端列：對戰頁（含 base、子路徑）與後台不顯示；其他頁顯示（/gamer、/administrator 不誤判）', !!J.A1);
ok('★★[A2] 目前所在頁：/card/123 算卡牌資料庫、/deck-posts 不誤判成 /decks、首頁沒有 active', !!J.A2);
ok('★★[A3] 已接主題：全站（含對戰／錦標賽大廳、好友）；後台不在清單', !!J.A3);
ok('★★★[A8] 牌桌畫面判準：休閒＝有盤面、錦標賽＝tStep playing；非對戰路由一律否', !!J.A8);
ok('★★[A4] 主題：玩家選過用玩家的、沒選過跟作業系統、壞值當沒選過', !!J.A4);
ok('★[A5] 導覽項目＝首頁五個入口、同順序', !!J.A5);
ok('★★[A6] 牌桌畫面判準沿用 viewport-zoom 的 isBattleRoute（不另寫一份）', /import \{ isBattleRoute \} from '\$lib\/viewport-zoom'/.test(ST) && /if \(!isBattleRoute\(pathname, base\)\) return false;/.test(ST));

// HEAD-FAIL：同一份判準餵 BASE 必須紅（BASE 沒有這套規則）
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = loadTheme(g('src/lib/site-theme.ts'));
  const JB = judge(B);
  const baseLayout = g('src/routes/+layout.svelte');
  ok('★★[A7] HEAD-FAIL：BASE 沒有規則模組、layout 也沒有頂端列', !JB.A0 && !/SiteTopBar/.test(baseLayout));
} else shallowSkip('v6474 A7：HEAD-FAIL', '需要 BASE commit');

// 突變：每一刀都必須讓對應的判準翻紅（證明判準不是安慰劑）
console.log('\n【M】突變');
const muts = [
  ['M1 拿掉後台排除', (s) => s.replace("return !/^\\/admin(?:\\/|$)/.test(p);", 'return true;'), 'A1'],
  ['M2 卡牌比對拿掉單數 card', (s) => s.replace("match: /^\\/cards?(?:\\/|$)/", "match: /^\\/cards(?:\\/|$)/"), 'A2'],
  ['M3 牌組比對拿掉邊界', (s) => s.replace("match: /^\\/decks(?:\\/|$)/", "match: /^\\/deck/"), 'A2'],
  ['M4 主題無視玩家選擇', (s) => s.replace("return stored ?? (systemPrefersDark ? 'dark' : 'light');", "return systemPrefersDark ? 'dark' : 'light';"), 'A4'],
  ['M5 後台也算已接主題', (s) => s.replace('THEMED_ROUTES: readonly RegExp[] = [', 'THEMED_ROUTES: readonly RegExp[] = [/^\\/admin$/, '), 'A3'],
  ['M6 牌桌判準不分錦標賽', (s) => s.replace("return tournament ? tStep === 'playing' : hasGame;", 'return hasGame;'), 'A8'],
  ['M7 牌桌判準不限對戰路由', (s) => s.replace('if (!isBattleRoute(pathname, base)) return false;', ''), 'A8'],
];
for (const [name, f, key] of muts) {
  const s2 = f(ST);
  const changed = s2 !== ST;
  const Jm = judge(loadTheme(s2));
  ok(`[${name}] 突變有套上且 ${key} 翻紅`, changed && Jm[key] === false, JSON.stringify({ changed, v: Jm[key] }));
}

// ── 靜態：手機不變、不多 chunk、接線 ─────────────────────────────────────
console.log('\n【S】手機版不變／不多一輪往返／接線');
const TB = existsSync(join(ROOT, 'src/lib/SiteTopBar.svelte')) ? rd('src/lib/SiteTopBar.svelte') : '';
const LAYOUT = rd('src/routes/+layout.svelte');
const HOME = rd('src/routes/+page.svelte');
const stripC = (x) => x.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tbStyle = stripC(TB.slice(TB.indexOf('<style>')));
const tbMarkup = stripC(TB.slice(0, TB.indexOf('<style>')));
ok('★★★[S1] 頂端列預設 display:none，只在 min-width:1024px 才 display:block', /\n  \.stb \{ display: none; \}/.test(tbStyle)
  && /@media \(min-width: 1024px\) \{\n    \.stb \{\n      display: block;/.test(tbStyle)
  && (tbStyle.match(/\.stb \{[^}]*display: block/g) || []).length === 1
  && tbStyle.indexOf('.stb { display: none; }') < tbStyle.indexOf('@media'));
ok('★★★[S2] 頂端列沒有 {#each}、props 沒有預設值（否則 Svelte 執行期被拆成新 chunk 進第一批預載）',
  !/\{#each/.test(tbMarkup) && /let \{ pathname, base, version, theme, ontoggle \}: \{/.test(tbMarkup) && !/let \{[^}]*=[^}]*\} = \$props\(\)/.test(tbMarkup));
// 頂端列逐條寫出的連結必須與 NAV_ITEMS 一致（單一來源的另一半）
const links = [...tbMarkup.matchAll(/class="stb-link" class:active=\{active === '([^']+)'\} href="\{base\}([^"]+)" aria-current=\{active === '([^']+)' \? 'page' : undefined\}>([^<]+)<\/a>/g)];
const navOk = M && links.length === M.NAV_ITEMS.length && links.every((m, i) => m[1] === M.NAV_ITEMS[i].href && m[2] === M.NAV_ITEMS[i].href && m[3] === M.NAV_ITEMS[i].href && m[4] === M.NAV_ITEMS[i].label);
ok('★★[S3] 頂端列的五條連結與 NAV_ITEMS 的 href／文字逐條相同、都帶 {base}', !!navOk, String(links.length));
ok('★★[S4] logo 用 app.html 載入畫面同一個 URL（瀏覽器已有，不多發請求）',
  rd('src/app.html').includes('%sveltekit.assets%/icons/icon-192.png?v=6.183') && TB.includes('src="{base}/icons/icon-192.png?v=6.183"') && HOME.includes('src="{base}/icons/icon-192.png?v=6.183"'));
ok('★★★[S5] layout 在初始化就套主題（不在 onMount 裡）、頂端列在 children 之前、只在 topBarOn 時渲染',
  /let uiTheme = \$state<UiTheme>\(typeof document !== 'undefined' \? applyTheme\(\) : 'light'\);/.test(LAYOUT)
  && LAYOUT.indexOf('applyTheme()') < LAYOUT.indexOf('onMount(')
  // ⭐v6.497（Rule 40）：同一個 {#if topBarOn} 區塊內另掛手機／平板的底部導覽列（<1024px 才顯示，見 test-v6497 D）；意圖（頂端列在 children 之前、只在 topBarOn 渲染）不變
  && /\{#if topBarOn\}\n  <SiteTopBar pathname=\{curPath\} \{base\} version=\{VERSION\} theme=\{uiTheme\} ontoggle=\{toggleUiTheme\} \/>\n(?:  <SiteBottomNav pathname=\{curPath\} \{base\} \/>\n)?\{\/if\}\n\n\{@render children\(\)\}/.test(LAYOUT));
ok('★[S6] layout 不新增 {#each}（每頁必載節點）', !/\{#each/.test(LAYOUT));
ok('★★[S12] 頂端列避開 iOS 安全區：讀全站唯一來源 --safe-top（不自己寫 env()）', /padding-top: var\(--safe-top, 0px\);/.test(tbStyle) && !/env\(safe-area/.test(tbStyle));
// 首頁：v6.474 的版面規則全部在 min-width:1024px 區塊內
const HSTYLE = stripC(HOME.slice(HOME.lastIndexOf('<style>')));
const iMq = HSTYLE.indexOf('@media (min-width: 1024px) {\n    main {');
const deskBlock = iMq > 0 ? HSTYLE.slice(iMq, HSTYLE.indexOf('\n  }\n', iMq)) : '';
const outside = HSTYLE.slice(0, iMq);
ok('★★★[S7] 首頁兩欄 grid 只在 min-width:1024px 內；區塊外的 main 仍是 680 單欄', iMq > 0 && /grid-template-columns: minmax\(0, 1fr\) 360px;/.test(deskBlock)
  && /\n  main \{\n    max-width: 680px;/.test(outside) && !/grid-template-areas/.test(outside));
ok('★★[S8] hero logo 預設 display:none（手機不出現）', /\n  \.hm-logo \{ display: none; \}/.test(outside));
ok('★★[S9] 首頁不改 DOM 順序（手機版區塊順序＝DOM 順序）：入口 → 社群 → 影片 → 更新記錄 → 回饋 → 免責',
  (() => { const k = ['<nav class="hm-grid"', '<section class="community-section">', '<HomeVideo ', '<section class="changelog-section"', '<section class="feedback-section">', '<footer class="disclaimer">'].map((x) => HOME.indexOf(x)); return k.every((v, i) => v > 0 && (i === 0 || v > k[i - 1])); })());
ok('★★[S10] 網頁版底色由 layout 依路由掛 data-ui-themed 統一切換（首頁不自己在 <svelte:head> 放 <style>：test-lib-strip-markup-sections 只容許 friends 一個例外）',
  !/<svelte:head>/.test(HOME) && /if \(themedOn\) document\.documentElement\.setAttribute\('data-ui-themed', ''\);\n    else document\.documentElement\.removeAttribute\('data-ui-themed'\);/.test(LAYOUT)
  && /@media \(min-width: 1024px\) \{\n    :global\(html\[data-ui-themed\] body\) \{ background: var\(--ui-bg\); \}/.test(LAYOUT));
ok('★[S11] 裝整段文字的容器不設 flex/grid（v6.030）：changelog 規則沒有 display:flex/grid', !/\.changelog-list :global\((details|summary)\) \{[^}]*display: (flex|grid)/.test(deskBlock));

// Svelte 編譯（兩支元件）
try {
  const req = createRequire(import.meta.url);
  const { compile } = req('svelte/compiler');
  for (const [nm, src] of [['SiteTopBar', TB], ['+layout', LAYOUT], ['+page', HOME]]) {
    const r = compile(src, { generate: 'client', filename: nm + '.svelte' });
    ok(`[C] ${nm}.svelte 可編譯`, !!r.js?.code);
    if (nm === 'SiteTopBar') ok('★★[C1] SiteTopBar 編譯結果不用 $.prop（不給預設值）', !/\$\.prop\(\$\$props/.test(r.js.code));
  }
} catch (e) { ok('[C] Svelte 編譯', false, e.message.slice(0, 200)); }

// ── 真瀏覽器（build/）──────────────────────────────────────────────────
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
// ⭐ 根因判準（Fable 5.1 審查建議）：S2／C1 只守這兩個檔，別處踩同一個坑（例如 layout 之後新增的子元件用了 {#each}）
//   一樣會讓第一批 modulepreload 變多、冷進站多一輪往返 ⇒ 直接量 build/index.html 的 modulepreload 數。
//   v6.473（BASE）與 v6.474 都是 12 條；要調高上限必須先量冷進站時間。
if (existsSync(join(BUILD, 'index.html'))) {
  const n = (readFileSync(join(BUILD, 'index.html'), 'utf8').match(/rel="modulepreload"/g) || []).length;
  ok('★★[E0] 首頁第一批 modulepreload ≤ 12（每多一條都可能多一輪往返）', n > 0 && n <= 12, String(n));
}
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.474 desktop ui') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.474 desktop ui');
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
    const errs = [];
    const open = async (w, h, theme, path, mobile = false) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      return { ctx, pg };
    };
    const probe = (pg) => pg.evaluate(() => {
      const stb = document.querySelector('.stb'); const main = document.querySelector('main');
      const cs = main ? getComputedStyle(main) : null;
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        stb: stb ? { disp: getComputedStyle(stb).display, h: Math.round(stb.getBoundingClientRect().height) } : null,
        toggle: !!document.querySelector('.stb-theme'),
        active: [...document.querySelectorAll('.stb-link.active')].map((a) => a.textContent),
        mainDisp: cs && cs.display, cols: cs && cs.gridTemplateColumns, maxW: cs && cs.maxWidth,
        body: getComputedStyle(document.body).backgroundColor,
        logo: (() => { const l = document.querySelector('.hm-logo'); return l ? getComputedStyle(l).display : null; })(),
      };
    });
    try {
      // 1440 淺色
      let { ctx, pg } = await open(1440, 900, 'light', '/');
      const L = await probe(pg);
      ok('★★★[E1] 1440 淺色：頂端列 56px（含底線 57）、首頁兩欄（右欄 360）、logo 出現、底色淺', L.theme === 'light' && L.stb?.disp === 'block' && L.stb.h >= 56 && L.stb.h <= 57
        && L.mainDisp === 'grid' && / 360px$/.test(L.cols || '') && L.logo === 'block' && L.body === 'rgb(243, 245, 244)', JSON.stringify(L));
      // 切換鈕：翻成深色、存起來、重新整理後仍是深色
      await pg.click('.stb-theme'); await pg.waitForTimeout(300);
      const afterClick = await pg.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), s: localStorage.getItem('ptcg_ui_theme'), bg: getComputedStyle(document.body).backgroundColor }));
      await ctx.close();
      ok('★★★[E2] 按切換鈕：立刻變深色（底色 #162816；v6.478 起全站統一墨綠，原 #0f1f17）並記住', afterClick.t === 'dark' && afterClick.s === 'dark' && afterClick.bg === 'rgb(22, 40, 22)', JSON.stringify(afterClick));
      // 沒選過 ⇒ 跟作業系統（模擬深色系統）
      {
        const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
        await ctx2.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const p2 = await ctx2.newPage(); await p2.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await p2.waitForTimeout(1200);
        const t = await p2.evaluate(() => document.documentElement.getAttribute('data-theme'));
        await ctx2.close();
        ok('★★[E3] 沒選過主題、作業系統是深色 ⇒ 深色', t === 'dark', String(t));
      }
      // /cards（v6.475 已接主題）：有頂端列、active＝卡牌資料庫、有切換鈕、深色底色生效
      ({ ctx, pg } = await open(1440, 900, 'dark', '/cards'));
      const C = await probe(pg); await ctx.close();
      ok('★★[E4] /cards：有頂端列、目前頁＝卡牌資料庫、有切換鈕、深色底色生效', C.stb?.disp === 'block' && C.active.join() === '卡牌資料庫' && C.toggle && C.body === 'rgb(22, 40, 22)', JSON.stringify(C));
      // 首頁 → 站內點進 /friends（v6.477 起已接主題）：淺色主題下好友頁的墨綠底（頁面 <svelte:head> 以 !important 注入）被淺底蓋過
      ({ ctx, pg } = await open(1440, 900, 'light', '/'));
      // 站內導頁（SvelteKit 攔截 <a> 點擊做客戶端路由；頂端列沒有好友連結 ⇒ 臨時插一個再點）
      await pg.evaluate(() => { const a = document.createElement('a'); a.href = (document.querySelector('.stb-brand')?.getAttribute('href') || '/').replace(/\/$/, '') + '/friends'; a.textContent = 'go'; document.body.appendChild(a); a.click(); });
      await pg.waitForTimeout(1500);
      const nav = await pg.evaluate(() => ({ path: location.pathname, bg: getComputedStyle(document.body).backgroundColor, act: [...document.querySelectorAll('.stb-link.active')].map((a) => a.textContent).join(), themed: document.documentElement.hasAttribute('data-ui-themed') }));
      await ctx.close();
      ok('★★★[E5] 首頁（淺色）站內點到 /friends：仍是已接主題、底色淺色（蓋過頁面自己的墨綠 !important）、沒有 active', /\/friends$/.test(nav.path) && nav.bg === 'rgb(243, 245, 244)' && nav.act === '' && nav.themed, JSON.stringify(nav));
      // /game 大廳：有頂端列（active＝對戰演練）；掛上 data-battle-view（牌桌畫面）時收起
      ({ ctx, pg } = await open(1440, 900, 'light', '/game'));
      const G = await probe(pg);
      const gAttr = await pg.evaluate(() => document.documentElement.hasAttribute('data-battle-view'));
      await pg.evaluate(() => document.documentElement.setAttribute('data-battle-view', ''));
      const gHidden = await pg.evaluate(() => getComputedStyle(document.querySelector('.stb')).display);
      await ctx.close();
      ok('★★★[E6] /game 大廳顯示頂端列、還沒開局時沒有 data-battle-view；牌桌畫面（data-battle-view）時收起', G.stb?.disp === 'block' && G.active.join() === '對戰演練' && !gAttr && gHidden === 'none', JSON.stringify({ stb: G.stb, gAttr, gHidden }));
      // 手機 390：頂端列不佔空間、首頁仍是 680 單欄、logo 不顯示
      ({ ctx, pg } = await open(390, 844, 'dark', '/', true));
      const Mo = await probe(pg); await ctx.close();
      ok('★★★[E7] 手機 390：頂端列 display:none、main 是 block 680 上限、logo 不顯示、底色維持 #f4f4f6', Mo.stb?.disp === 'none' && Mo.mainDisp === 'block' && Mo.maxW === '680px' && Mo.logo === 'none' && Mo.body === 'rgb(244, 244, 246)', JSON.stringify(Mo));
      // 平板 1000：同手機（臨界值以下不變）
      ({ ctx, pg } = await open(1000, 800, 'dark', '/'));
      const T = await probe(pg); await ctx.close();
      ok('★★[E8] 1000 寬（<1024）：完全沿用舊版面', T.stb?.disp === 'none' && T.mainDisp === 'block' && T.maxW === '680px', JSON.stringify(T));
      // 臨界值 1024（iPad 第 9 代橫向）：必須已經是新版面 —— min-width 的差一錯誤就在這裡出事
      ({ ctx, pg } = await open(1024, 768, 'light', '/'));
      const B1024 = await probe(pg); await ctx.close();
      ok('★★[E10] 1024 寬（臨界值）：頂端列出現、首頁兩欄', B1024.stb?.disp === 'block' && B1024.mainDisp === 'grid', JSON.stringify(B1024));
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
