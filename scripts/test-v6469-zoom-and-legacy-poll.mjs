#!/usr/bin/env node
/**
 * v6.469 守衛：
 *   ① 雙指放大只在對戰畫面（/game、/tournament）禁止；其他頁（非 iOS）可以兩指放大（WCAG 1.4.4）。
 *      ・app.html 原文不動（JS 掛掉時＝舊行為；test-v6213 另外釘原文）。
 *      ・iOS 一律不動（iOS Safari 本來就無視 user-scalable=no；maximum-scale=1 在 iOS 的作用是點輸入框不自動放大）。
 *      ・layout 用 afterNavigate 每次導頁（含第一次載入）套用 ⇒ 從可縮放頁回到對戰頁會重新鎖回。
 *   ② 休閒大廳列表「舊協定」退路（伺服器不支援合併查詢時）：分頁隱藏後回前景也立刻補抓
 *      （v6.467 只在合併模式補抓 ⇒ 舊協定最多晚 10 秒；Fable 審查 v6.467 第 3 點）；且在途時不疊發。
 *
 * 判準：純函式實跑 ＋ 抽出 subscribeOpenRooms 實跑（HEAD-FAIL：同一判準餵 v6.468 必須紅）＋ 真瀏覽器 E（需要 build/）。
 * Run: node scripts/test-v6469-zoom-and-legacy-poll.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.468／server v1.54 收尾。
const BASE_SHA = 'aed34895';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;
function extractFn(src, name) {
  const i = src.indexOf('export function ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n}', i);
  return src.slice(i, j + 2).replace(/^export /, '');
}
const LOCKED_APP = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no';

// ── ① viewport 規則（純函式實跑）───────────────────────────────────────────
console.log('【A】viewport 規則（實跑 src/lib/viewport-zoom.ts）');
const VZ = existsSync(join(ROOT, 'src/lib/viewport-zoom.ts')) ? rd('src/lib/viewport-zoom.ts') : '';
let M = null;
try { M = new Function(ts2js(VZ.replace(/^export /gm, '')) + '\n;return { VIEWPORT_LOCKED, VIEWPORT_ZOOMABLE, isBattleRoute, isIOSLike, desiredViewport };')(); } catch (e) { M = null; }
ok('★★★[A0] 規則模組存在且可執行', !!M);
if (M) {
  ok('★★[A1] 鎖定版與 app.html 逐字相同（對戰頁維持原行為）', M.VIEWPORT_LOCKED === LOCKED_APP && rd('src/app.html').includes(`content="${LOCKED_APP}"`));
  ok('★★[A2] 可縮放版沒有 maximum-scale／user-scalable，其餘相同', M.VIEWPORT_ZOOMABLE === 'width=device-width, initial-scale=1, viewport-fit=cover');
  const battle = ['/game', '/game/', '/game.html', '/tournament', '/tournament/x', '/b/game', '/b/tournament'];
  const other = ['/', '/cards', '/decks', '/deck-posts', '/friends', '/card/123', '/gamer', '/games', '/tournaments', '/x/game'];
  ok('★★[A3] 對戰路由判定（含 base path、.html、子路徑；/gamer、/games 不算）',
    battle.every((p) => M.isBattleRoute(p, p.startsWith('/b/') ? '/b' : '')) && other.every((p) => !M.isBattleRoute(p, '')), '');
  ok('★★[A4] 非 iOS：對戰頁鎖、其他頁可縮放', M.desiredViewport('/game', '', false) === LOCKED_APP && M.desiredViewport('/cards', '', false) === M.VIEWPORT_ZOOMABLE);
  ok('★★[A5] iOS（含 iPadOS 偽裝 Mac）一律不動', M.desiredViewport('/cards', '', true) === null
    && M.isIOSLike('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5)
    && M.isIOSLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)
    && !M.isIOSLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)
    && !M.isIOSLike('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5));
}
const LAYOUT = rd('src/routes/+layout.svelte');
ok('★★[A6] layout 用 afterNavigate 每次導頁套用（含 base）', /afterNavigate\(\(nav\) => \{ try \{ applyViewportFor\([^;]*, base\); \} catch/.test(LAYOUT) && LAYOUT.includes("from '$lib/viewport-zoom'"));

// ── ② 舊協定回前景補抓（抽 subscribeOpenRooms 實跑）──────────────────────
console.log('\n【B】舊協定退路：隱藏→回前景');
async function runLegacy(src) {
  const body = extractFn(src, 'filterAndSortOpenRooms') + '\n' + extractFn(src, 'subscribeOpenRooms');
  const js = ts2js(body);
  const listeners = [];
  const doc = { visibilityState: 'hidden', addEventListener: (t, h) => listeners.push(h), removeEventListener: (t, h) => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); } };
  const delays = []; let cleared = 0; let legacyCalls = 0; let combinedCalls = 0;
  let holdRelease = null; let hold = false;
  const fakeSet = (cb, d) => { delays.push(d); return 7; };
  const fakeClear = () => { cleared++; };
  const U = Symbol('u'), N = Symbol('n');
  const combined = async () => { combinedCalls++; return N; };   // 伺服器不支援合併 ⇒ 走舊協定
  const legacyList = async () => { legacyCalls++; if (hold) await new Promise((r) => { holdRelease = r; }); return []; };
  const sub = new Function('oracleListRoomsCombined', 'oracleListRooms', 'ROOMS_UNCHANGED', 'ROOMS_COMBINED_UNSUPPORTED', 'adoptOrKeep', 'SEAT_LAYOUT_VERSION', 'isLobbyHostDead', 'isLobbyTooOld', 'setTimeout', 'clearTimeout', 'console', 'document',
    js + '\n;return subscribeOpenRooms;')(combined, legacyList, U, N, (l, c) => ({ data: c !== null ? c : l }), 2, () => false, () => false, fakeSet, fakeClear, { warn() {} }, doc);
  const unsub = sub(() => {});
  await new Promise((r) => setTimeout(r, 15));
  const out = { firstDelays: [...delays], legacyBefore: legacyCalls };
  // 回前景 ⇒ 期望立刻補抓（兩支舊端點各一發）
  doc.visibilityState = 'visible'; for (const h of [...listeners]) h();
  await new Promise((r) => setTimeout(r, 15));
  out.legacyAfterVisible = legacyCalls; out.cleared = cleared;
  // 在途時再切一次前景：不可疊發
  hold = true; doc.visibilityState = 'hidden';
  doc.visibilityState = 'visible'; for (const h of [...listeners]) h();     // 觸發一發（掛住）
  await new Promise((r) => setTimeout(r, 5));
  const mid = legacyCalls;
  for (const h of [...listeners]) h();                                    // 在途中再來一次
  await new Promise((r) => setTimeout(r, 5));
  out.overlap = legacyCalls - mid;
  hold = false; holdRelease && holdRelease(); holdRelease && holdRelease();
  await new Promise((r) => setTimeout(r, 15));
  unsub(); out.listenersLeft = listeners.length;
  return out;
}
const CUR_ROOM = rd('src/lib/game/room-oracle.ts');
const legacyOk = (r) => r && r.firstDelays[0] === 10000 && r.legacyAfterVisible === r.legacyBefore + 2 && r.cleared >= 1 && r.overlap === 0 && r.listenersLeft === 0;
let cur = null; try { cur = await runLegacy(CUR_ROOM); } catch (e) { cur = { err: e.message }; }
ok('★★★[B1] 舊協定：隱藏時 10 秒一發；回前景立刻補抓；在途時不疊發；取消訂閱移除監聽', legacyOk(cur), JSON.stringify(cur));

// ── HEAD-FAIL ─────────────────────────────────────────────────────────────
console.log('\n【H】HEAD-FAIL：同一判準餵 v6.468');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6469 H：HEAD-FAIL', '需要 BASE commit');
else {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  ok('★★★[H1] v6.468 沒有規則模組、layout 沒有套用', g('src/lib/viewport-zoom.ts') === '' && !/applyViewportFor/.test(g('src/routes/+layout.svelte')));
  let base = null; try { base = await runLegacy(g('src/lib/game/room-oracle.ts')); } catch (e) { base = { err: e.message }; }
  ok('★★★[H2] v6.468 的舊協定回前景不補抓（B1 判準在 BASE 必須紅）', !legacyOk(base), JSON.stringify(base));
}

// ── E：真瀏覽器 ───────────────────────────────────────────────────────────
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.469 viewport') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.469 viewport');
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
    const vp = (pg) => pg.evaluate(() => document.querySelector('meta[name="viewport"]').getAttribute('content'));
    try {
      const errs = [];
      const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, userAgent: ANDROID });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/cards`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      const vCards = await vp(pg);
      await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      const vGame = await vp(pg);
      // 站內導頁：/game → 首頁（客戶端路由）→ 回 /game
      await pg.evaluate(() => { const a = document.querySelector('a[href$="/"], a[href="./"], a[href=".."]'); if (a) a.click(); else history.back(); });
      await pg.waitForTimeout(1500);
      const pathAfter = await pg.evaluate(() => location.pathname);
      const vHomeClient = await vp(pg);
      await pg.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await pg.waitForTimeout(1200);
      const vHome = await vp(pg);
      await pg.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => /\/game$/.test(x.getAttribute('href') || '')); if (a) a.click(); });
      await pg.waitForTimeout(1500);
      const pathGame2 = await pg.evaluate(() => location.pathname); const vGame2 = await vp(pg);
      ok('★★★[E1] Android：/cards 可縮放、/game 鎖定', vCards === 'width=device-width, initial-scale=1, viewport-fit=cover' && vGame === LOCKED_APP, JSON.stringify({ vCards, vGame }));
      ok('★★[E2] Android：首頁可縮放；站內點進 /game 後重新鎖回', vHome === 'width=device-width, initial-scale=1, viewport-fit=cover' && /\/game$/.test(pathGame2) && vGame2 === LOCKED_APP, JSON.stringify({ vHome, pathGame2, vGame2, pathAfter, vHomeClient }));
      await ctx.close();
      const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
      const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IOS });
      await ctx2.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg2 = await ctx2.newPage(); pg2.on('pageerror', (e) => errs.push(e.message));
      await pg2.goto(`http://localhost:${port}/cards`, { waitUntil: 'load' }); await pg2.waitForTimeout(1500);
      ok('★★[E3] iOS：/cards 維持 app.html 原樣（點輸入框不自動放大）', (await vp(pg2)) === LOCKED_APP);
      await ctx2.close();
      ok('[E4] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.469 雙指放大／舊協定補抓: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6469-zoom-and-legacy-poll ===');
process.exit(fail ? 1 : 0);
