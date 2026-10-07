#!/usr/bin/env node
/**
 * v6.477 守衛：網頁版淺色主題延伸到對戰大廳、錦標賽大廳、好友頁（牌桌不變）。
 *   ① THEMED_ROUTES 含 /game、/tournament、/friends。
 *   ② 對戰頁的 v6477-lobby-light 哨兵：恰好一塊、整塊是 min-width:1024px；每一條選擇器都以
 *      :global(html[data-theme='light']:not([data-battle-view])) 開頭（⇒ 牌桌畫面、深色主題、手機都不吃）；
 *      只碰顏色類屬性（不碰尺寸 ⇒ 版面零位移）；「產生器產生的那段」必須等於 scripts/gen-lobby-light.py 對現行檔案的輸出
 *      （哨兵裡不能夾帶別的東西，也不能改了大廳配色卻忘了重跑產生器）。
 *   ③ 好友面板（FriendsPanel）的 v6477-friends-light 哨兵：只換 --fr-* 色票、同一個前綴、min-width:1024px。
 *   ④ layout：淺色主題且不是牌桌畫面時，以 !important 蓋過大廳／好友頁自己 <svelte:head> 鋪的墨綠底。
 *   ⑤ 真瀏覽器：淺色 /game 大廳是淺底白卡；掛上 data-battle-view（牌桌）立刻回墨綠；深色維持墨綠；手機不變。
 * HEAD-FAIL：同一份靜態判準餵 v6.476 必須紅。
 * Run: node scripts/test-v6477-lobby-light.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';   // ⭐v6.511 色票唯一讀取點（不寫死色碼）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.476。
const BASE_SHA = '51bc47db';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
// ⭐v6.499（Rule 40）：站長回報手機淺色主題的對戰／錦標賽大廳仍是深綠 ⇒ 大廳淺色改成手機也套，前綴拿掉 data-ui-wide。
//   本支原本的意圖（只碰顏色、非牌桌、深色不變、產生器一致）不變；「手機維持墨綠」那條（E5）依站長新要求反轉。
const PRE = ":global(html[data-theme='light']:not([data-battle-view]))";   // 大廳（對戰頁不能加 @media）
const PRE_FR = ":global(html[data-theme='light']:not([data-battle-view]))";                // 好友面板（本身在 min-width:1024px 內）
const COLOR_PROPS = /^(color|background|background-color|border|border-color|border-(top|bottom|left|right)(-color)?|outline-color|box-shadow)$/;

function lobbyBlock(src) {
  const m = src.match(/\n  \/\* >>> v6477-lobby-light \*\/\n[\s\S]*?\n  \/\* <<< v6477-lobby-light \*\/\n/g) || [];
  return { n: m.length, b: m[0] || '' };
}
function judge(get) {
  const r = {};
  const ST = get('src/lib/site-theme.ts');
  const m = ST.match(/THEMED_ROUTES: readonly RegExp\[\] = \[([^\n]*)\];/);
  r.S1 = !!m && ['/^\\/game$/', '/^\\/tournament$/', '/^\\/friends$/'].every((x) => m[1].includes(x));
  const GAME = get('src/routes/game/+page.svelte');
  const { n, b } = lobbyBlock(GAME);
  const body = b.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const rules = [...body.matchAll(/\n    ([^{}\n]+) \{ ([^{}]*) \}/g)];
  r.S2 = n === 1 && !/@media/.test(body) && rules.length >= 150
    && rules.every((x) => x[1].split(', ').every((sel) => sel.startsWith(PRE + ' ')))
    && rules.every((x) => x[2].split(';').map((d) => d.trim()).filter(Boolean).every((d) => COLOR_PROPS.test(d.split(':')[0].trim())));
  const FP = get('src/lib/friends/FriendsPanel.svelte');
  const fb = FP.match(/\n  \/\* >>> v6477-friends-light \*\/\n([\s\S]*?)\n  \/\* <<< v6477-friends-light \*\//);
  const fbody = fb ? fb[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
  const decls = [...fbody.matchAll(/\n\s+(--[\w-]+|[\w-]+): /g)].map((x) => x[1]);
  // ⭐v6.499（Rule 40）：好友面板淺色色票改成手機也套 ⇒ 不再包 min-width:1024px（哨兵內不可有 @media）
  r.S3 = !!fb && !fbody.includes('@media') && fbody.includes(PRE_FR + ' .fr-panel {') && decls.length >= 15 && decls.every((d) => d.startsWith('--fr-'));
  const LAYOUT = get('src/routes/+layout.svelte');
  r.S4 = /:global\(html\[data-ui-themed\]\[data-theme='light'\]:not\(\[data-battle-view\]\)\),\n    :global\(html\[data-ui-themed\]\[data-theme='light'\]:not\(\[data-battle-view\]\) body\) \{ background-color: var\(--ui-bg\) !important; \}/.test(LAYOUT);
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] THEMED_ROUTES 含 /game、/tournament、/friends', C.S1);
ok('★★★[S2] 對戰頁大廳淺色哨兵：一塊、零 @media（本頁 @media 數量被釘死）、每條都帶「淺色＋非牌桌」前綴、只碰顏色屬性、≥150 條', C.S2);
ok('★★★[S2b] layout 依 matchMedia(min-width:1024px) 掛 <html data-ui-wide>（初始化就掛、斷點與頂端列一致）',
  /export const WIDE_QUERY = '\(min-width: 1024px\)';/.test(rd('src/lib/site-theme.ts')) && /if \(typeof document !== 'undefined'\) trackWideAttr\(\);/.test(rd('src/routes/+layout.svelte'))
  && rd('src/routes/+layout.svelte').indexOf('trackWideAttr();') < rd('src/routes/+layout.svelte').indexOf('onMount('));
ok('★★[S3] 好友面板淺色：只換 --fr-* 色票、同一前綴（v6.499 起手機也套，不包 @media）', C.S3);
ok('★★★[S4] layout：淺色且非牌桌時以 !important 蓋過大廳／好友頁的墨綠底', C.S4);
// 行內 style 的字色：產生器只掃樣式區 ⇒ 大廳標記裡每一種行內 `color:#xxx` 都必須有手調覆寫（錦標賽排名表；Fable 5.1 審查阻擋項）
{
  const G = rd('src/routes/game/+page.svelte');
  const lob = G.slice(G.indexOf("{#if isTournament && tStep !== 'playing'}"), G.indexOf('<div class="battle-root"'));
  const inl = new Set();
  for (const m of lob.matchAll(/style="([^"]*)"/g)) for (const c of m[1].matchAll(/(?<![\w-])color\s*:\s*#[0-9a-fA-F]{3,6}/g)) inl.add(c[0]);
  const { b } = lobbyBlock(G);
  const miss = [...inl].filter((c) => !b.includes(`${PRE} .lobby [style*="${c}"] { color: #`));
  ok('★★★[S6] 大廳每一種行內字色（' + inl.size + ' 種）都有淺色覆寫（!important 蓋過行內 style）', inl.size >= 5 && miss.length === 0, miss.join(' ｜ '));
  ok('★★[S7] 深色 color-scheme 不套到牌桌（:not([data-battle-view])）', rd('src/routes/+layout.svelte').includes(":global(html[data-ui-themed][data-theme='dark']:not([data-battle-view])) { color-scheme: dark; }"));
}
// 產生器一致性：哨兵內「手調」之前那段 ＝ 產生器對現行檔案的輸出
{
  let out = '';
  try { out = execFileSync('python3', [join(ROOT, 'scripts/gen-lobby-light.py'), join(ROOT, 'src/routes/game/+page.svelte')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { out = null; }
  if (out === null) console.log('  ENV-SKIP S5（沒有 python3）');
  else {
    const { b } = lobbyBlock(rd('src/routes/game/+page.svelte'));
    const MK = '    /* ── 產生器輸出（勿手改）── */\n';
    const gen = b.indexOf(MK) < 0 ? '' : b.slice(b.indexOf(MK) + MK.length, b.indexOf('\n    /* ── 手調'));
    ok('★★★[S5] 哨兵內產生的那段 ＝ scripts/gen-lobby-light.py 的輸出（沒夾帶、沒漏重跑）', gen.trim() === out.trim() && out.trim().length > 10000, `gen=${gen.length} out=${out.length}`);
  }
}
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.476 全紅', !B.S1 && !B.S2 && !B.S3 && !B.S4, JSON.stringify(B));
} else shallowSkip('v6477 S0：HEAD-FAIL', '需要 BASE commit');
// 突變：前綴少了 :not([data-battle-view]) ⇒ S2 必紅（牌桌會被染成淺色）
{
  const G = rd('src/routes/game/+page.svelte');
  const mut = G.replace(PRE + ' .tourn-tab {', ":global(html[data-theme='light']) .tourn-tab {");   // ⭐v6.499：改讀 PRE（前綴已不含 data-ui-wide）
  const J = judge((p) => (p === 'src/routes/game/+page.svelte' ? mut : rd(p)));
  ok('★★[M1] 突變：任一條拿掉「非牌桌」條件 ⇒ S2 翻紅', mut !== G && J.S2 === false);
  const mut2 = G.replace(/(\.mode-card \{ background: var\(--ui-bg-elev\);)/, '$1 padding: 0;');
  const J2 = judge((p) => (p === 'src/routes/game/+page.svelte' ? mut2 : rd(p)));
  ok('★★[M2] 突變：哨兵裡夾帶尺寸屬性 ⇒ S2 翻紅', mut2 !== G && J2.S2 === false);
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.477 lobby light') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.477 lobby light');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
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
    const css = (pg, sel, prop) => pg.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
    try {
      let { ctx, pg } = await open(1440, 900, 'light', '/game');
      const L = { body: await css(pg, 'body', 'backgroundColor'), card: await css(pg, '.mode-card', 'backgroundColor'), title: await css(pg, '.lobby', 'color') };
      await pg.evaluate(() => document.documentElement.setAttribute('data-battle-view', ''));
      await pg.waitForTimeout(100);
      const Bv = { body: await css(pg, 'body', 'backgroundColor'), card: await css(pg, '.mode-card', 'backgroundColor') };
      await ctx.close();
      ok('★★★[E1] 淺色 /game 大廳：淺底、白色模式卡、深色字', L.body === uiColor(ROOT, 'light', '--ui-bg') && L.card === uiColor(ROOT, 'light', '--ui-bg-elev') && L.title === 'rgb(15, 15, 15)', JSON.stringify(L));
      ok('★★★[E2] 掛上 data-battle-view（牌桌畫面）⇒ 立刻回到原本的墨綠底與深色卡', Bv.body === 'rgb(22, 40, 22)' && Bv.card !== 'rgb(255, 255, 255)', JSON.stringify(Bv));
      ({ ctx, pg } = await open(1440, 900, 'dark', '/game'));
      const D = { body: await css(pg, 'body', 'backgroundColor'), card: await css(pg, '.mode-card', 'backgroundColor') };
      await ctx.close();
      // ⭐v6.511（Rule 40，站長看過預覽圖同意「深色提亮一階」）：深色大廳整頁底改讀色票（牌桌畫面 E2 仍是原本墨綠）
      ok('★★[E3] 深色 /game 大廳是深色色票底（墨綠色調）、模式卡不是淺色', D.body === uiColor(ROOT, 'dark', '--ui-bg') && D.card !== uiColor(ROOT, 'light', '--ui-bg-elev'), JSON.stringify(D));
      ({ ctx, pg } = await open(1440, 900, 'light', '/friends'));
      const F = { body: await css(pg, 'body', 'backgroundColor'), bg: await pg.evaluate(() => getComputedStyle(document.querySelector('.fr-panel')).getPropertyValue('--fr-bg').trim()) };
      await ctx.close();
      ok('★★[E4] 淺色 /friends：淺底、好友面板換成淺色色票', F.body === uiColor(ROOT, 'light', '--ui-bg') && (F.bg === 'var(--ui-bg)' || F.bg === uiColor(ROOT, 'light', '--ui-bg') || F.bg.toLowerCase() === '#dde3df'), JSON.stringify(F));
      ({ ctx, pg } = await open(390, 844, 'light', '/game', true));
      const M = { body: await css(pg, 'body', 'backgroundColor'), card: await css(pg, '.mode-card', 'backgroundColor') };
      await ctx.close();
      // ⭐v6.499（Rule 40）：站長要求手機淺色也是淺底 ⇒ 反轉成淺底白卡
      ok('★★★[E5] 手機 390 淺色：/game 大廳也是淺底、白色模式卡（v6.499）', M.body === uiColor(ROOT, 'light', '--ui-bg') && M.card === uiColor(ROOT, 'light', '--ui-bg-elev'), JSON.stringify(M));
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
