#!/usr/bin/env node
/**
 * v6.499 守衛：手機／平板淺色主題的對戰大廳、錦標賽大廳、好友頁改淺底（牌桌不變）。
 *   站長回報（2026-10-06）：「手機版的淺色主題，在對戰和錦標賽的時候，背景依然是深綠色」。
 *
 * 【A】$lib/site-theme 的 isLobbyRoute：只有 /game、/tournament、/friends（含 base、結尾斜線、.html）
 * 【B】layout：依 isLobbyRoute 在 <html> 掛 data-ui-lobby；淺色＋非牌桌時以 !important 蓋回淺底，
 *      而且這條**不在** min-width:1024px 裡（手機才吃得到）
 * 【C】對戰頁大廳淺色哨兵、好友面板淺色色票都不再限網頁版（前綴無 data-ui-wide、好友哨兵無 @media）
 * 【D】底部導覽列不再對 /game、/tournament 強制深色（只看主題）
 * 【E】真瀏覽器 390×844：淺色 /game、/tournament、/friends 是淺底；/cards 的手機淺色底色不受影響；
 *      深色 /game 維持墨綠；淺色但掛上 data-battle-view（牌桌）立刻回墨綠；底部導覽列在淺色大廳是淺色
 * HEAD-FAIL：同一份靜態判準餵 v6.498 逐條紅（Rule 41：缺席的函式用哨兵，不整支 throw）。
 * Run: node scripts/test-v6499-mobile-light-lobby.mjs
 */
import { readFileSync, existsSync, mkdtempSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.498。
const BASE_SHA = '097b5850';
const esbuild = createRequire(import.meta.url)('esbuild');
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

console.log('【A】isLobbyRoute');
async function loadTheme(src) {
  const dir = mkdtempSync(join(tmpdir(), 'v6499-'));
  try {
    await esbuild.build({
      stdin: { contents: src, resolveDir: join(ROOT, 'src/lib'), loader: 'ts' },
      bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 't.mjs'), logLevel: 'silent',
      alias: { '$lib': join(ROOT, 'src/lib') },
    });
    return await import(pathToFileURL(join(dir, 't.mjs')).href);
  } catch { return null; }
}
const MISSING = Symbol('missing');
function lobbyCases(M) {
  const f = typeof M?.isLobbyRoute === 'function' ? M.isLobbyRoute : () => MISSING;
  const yes = [['/game', ''], ['/tournament', ''], ['/friends', ''], ['/ptcg-tw-sim/game', '/ptcg-tw-sim'], ['/tournament/', ''], ['/friends.html', '']];
  const no = [['/', ''], ['/cards', ''], ['/decks', ''], ['/deck-posts', ''], ['/card/123', ''], ['/game/x', ''], ['/admin', ''], ['/gamex', '']];
  return { yes: yes.every(([p, b]) => f(p, b) === true), no: no.every(([p, b]) => f(p, b) === false) };
}
const CUR = lobbyCases(await loadTheme(rd('src/lib/site-theme.ts')));
ok('★★★[A1] /game、/tournament、/friends（含 base、結尾斜線、.html）都是墨綠底大廳', CUR.yes);
ok('★★★[A2] 其他頁（首頁、卡牌、牌組、公布欄、單卡、/game 子路徑、admin、字首相同的路徑）都不是', CUR.no);

function judge(get) {
  const r = {};
  const L = get('src/routes/+layout.svelte');
  r.B1 = /import \{[^}]*\bisLobbyRoute\b[^}]*\} from '\$lib\/site-theme';/.test(L)
    && L.includes('const lobbyOn = $derived(isLobbyRoute(curPath, base));')
    && /if \(lobbyOn\) document\.documentElement\.setAttribute\('data-ui-lobby', ''\);\n\s+else document\.documentElement\.removeAttribute\('data-ui-lobby'\);/.test(L);
  // 規則存在，且位置在網頁版 min-width:1024px 區塊之外（該區塊結束於 v6498 哨兵之前的 "\n  }\n"）
  const RULE = ":global(html[data-ui-lobby][data-theme='light']:not([data-battle-view])),\n  :global(html[data-ui-lobby][data-theme='light']:not([data-battle-view]) body) { background-color: var(--ui-bg) !important; }";
  const iRule = L.indexOf(RULE);
  const iMedia = L.indexOf('@media (min-width: 1024px) {\n    :global(html[data-ui-themed] body)');
  const iMediaEnd = iMedia < 0 ? -1 : L.indexOf('\n  }\n', iMedia);
  r.B2 = iRule > 0 && iMedia > 0 && iMediaEnd > 0 && iRule > iMediaEnd;
  const G = get('src/routes/game/+page.svelte');
  const blk = (G.match(/\/\* >>> v6477-lobby-light \*\/[\s\S]*?\/\* <<< v6477-lobby-light \*\//) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');
  r.C1 = blk.length > 10000 && !blk.includes('data-ui-wide') && (blk.match(/:global\(html\[data-theme='light'\]:not\(\[data-battle-view\]\)\) /g) || []).length >= 150;
  const F = get('src/lib/friends/FriendsPanel.svelte');
  const fb = (F.match(/\/\* >>> v6477-friends-light \*\/[\s\S]*?\/\* <<< v6477-friends-light \*\//) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');
  r.C2 = fb.includes(":global(html[data-theme='light']:not([data-battle-view])) .fr-panel {") && !fb.includes('@media');
  const N = get('src/lib/SiteBottomNav.svelte');
  r.D1 = N.includes('<nav class="sbn" aria-label="主要功能">') && !/class:dark=/.test(N) && !/\.sbn\.dark\b/.test(N);
  return r;
}
console.log('【B～D】靜態');
const C = judge(rd);
ok('★★★[B1] layout 依 isLobbyRoute 在 <html> 掛／拿掉 data-ui-lobby', C.B1);
ok('★★★[B2] 淺色＋非牌桌時以 !important 蓋回淺底，且不在 min-width:1024px 裡（手機吃得到）', C.B2);
ok('★★★[C1] 對戰頁大廳淺色哨兵前綴不含 data-ui-wide（≥150 條）', C.C1);
ok('★★[C2] 好友面板淺色色票不再包 @media', C.C2);
ok('★★[D1] 底部導覽列不再對 /game、/tournament 強制深色', C.D1);
// 突變：把 lobby 規則搬回 min-width:1024px 裡 ⇒ B2 必紅
{
  const L = rd('src/routes/+layout.svelte');
  const RULE = ":global(html[data-ui-lobby][data-theme='light']:not([data-battle-view])),\n  :global(html[data-ui-lobby][data-theme='light']:not([data-battle-view]) body) { background-color: var(--ui-bg) !important; }";
  const iMedia = L.indexOf('@media (min-width: 1024px) {\n    :global(html[data-ui-themed] body)');
  const mut = L.replace(RULE + '\n', '').slice(0, iMedia + 28) + '\n    ' + RULE.replace('\n  ', '\n    ') + L.replace(RULE + '\n', '').slice(iMedia + 28);
  const J = judge((p) => (p === 'src/routes/+layout.svelte' ? mut : rd(p)));
  ok('★★[M1] 突變：淺底規則搬回網頁版區塊 ⇒ B2 翻紅', mut !== L && J.B2 === false);
}

if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  const BA = lobbyCases(await loadTheme(g('src/lib/site-theme.ts')));
  const reds = Object.entries({ ...B, A1: BA.yes }).filter(([, v]) => !v).map(([k]) => k);
  console.log('  （HEAD-FAIL 逐條：v6.498 紅了 ' + reds.join('、') + '）');
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.498，A1／B1／B2／C1／C2／D1 全紅', ['A1', 'B1', 'B2', 'C1', 'C2', 'D1'].every((k) => reds.includes(k)), reds.join(','));
} else shallowSkip('v6499 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.499 mobile light lobby') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.499 mobile light lobby');
  if (browser) {
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
    const open = async (theme, path) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      return { ctx, pg };
    };
    const bodyBg = (pg) => pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const LIGHT = 'rgb(243, 245, 244)', GREEN = 'rgb(22, 40, 22)';
    try {
      const got = {};
      for (const path of ['/game', '/tournament', '/friends']) {
        const { ctx, pg } = await open('light', path);
        got[path] = { body: await bodyBg(pg), lobby: await pg.evaluate(() => document.documentElement.hasAttribute('data-ui-lobby')) };
        if (path === '/game') {
          got.card = await pg.evaluate(() => { const e = document.querySelector('.mode-card'); return e ? getComputedStyle(e).backgroundColor : null; });
          got.nav = await pg.evaluate(() => { const e = document.querySelector('.sbn'); return e ? getComputedStyle(e).backgroundColor : null; });
          await pg.evaluate(() => document.documentElement.setAttribute('data-battle-view', '')); await pg.waitForTimeout(100);
          got.battle = await bodyBg(pg);
        }
        await ctx.close();
      }
      ok('★★★[E1] 手機淺色 /game、/tournament、/friends 都是淺底（data-ui-lobby 有掛）',
        ['/game', '/tournament', '/friends'].every((p) => got[p].body === LIGHT && got[p].lobby), JSON.stringify(got));
      ok('★★[E2] 手機淺色 /game 模式卡是白卡、底部導覽列是淺色', got.card === 'rgb(255, 255, 255)' && /^rgba\(255, 255, 255/.test(got.nav || ''), JSON.stringify({ card: got.card, nav: got.nav }));
      ok('★★★[E3] 掛上 data-battle-view（牌桌）⇒ 立刻回墨綠', got.battle === GREEN, got.battle);
      let { ctx, pg } = await open('dark', '/game');
      const D = await bodyBg(pg); await ctx.close();
      ok('★★[E4] 手機深色 /game 維持墨綠', D === GREEN, D);
      ({ ctx, pg } = await open('light', '/cards'));
      const Cd = { body: await bodyBg(pg), lobby: await pg.evaluate(() => document.documentElement.hasAttribute('data-ui-lobby')) }; await ctx.close();
      ok('★★★[E5] 手機淺色 /cards 不受影響（不是大廳、底色不是 --ui-bg）', Cd.lobby === false && Cd.body !== LIGHT, JSON.stringify(Cd));
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.499 手機淺色大廳：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
