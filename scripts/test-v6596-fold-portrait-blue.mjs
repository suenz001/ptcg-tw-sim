#!/usr/bin/env node
/**
 * v6.596 守衛：直立大螢幕（Samsung Galaxy Z Fold 8 展開、直向 iPad）的對戰版面填滿畫面＋已擲完硬幣的提示
 *
 * 站長 2026-10-24：玩家回報 Fold 8 展開時「無法充分利用版面」（經典版只用到上半個畫面）。
 *   站長裁定：直立大螢幕預設新版桌墊；並要求確認「競技場卡的位置與使用競技場的按鈕」有留。
 *   另外 v6.595 審查 P3-2（站長同意照建議）：停在「已擲完硬幣、等選擇」時，其他按鈕按了要有提示。
 *
 * 【U】預設版面判準（battle-layout-default.ts，唯一一份）尺寸矩陣
 * 【S】接線：對戰頁 onMount 用它決定預設；填滿規則寫在既有的 max-width:1023px 區塊裡（不新增媒體查詢）；
 *      紀錄 contain:size；dispatch 在送出前擋下並提示；提示列放在版面分支之外
 * 【B】真瀏覽器（build/）：沒選過版面 ⇒ 704×830／860×880 是新版桌墊、1000×700 仍是經典版；選過經典版的照舊；
 *      場上有競技場（夜間學院）時，704×830、860×880、768×1024、744×1059、820×1180 整頁剛好一個畫面（不捲動）、
 *      競技場卡與「使用競技場」鈕在畫面內、不與手牌／紀錄／行動鈕重疊，手牌完整在畫面內
 * 【H】HEAD-FAIL：BASE（v6.595）上 U1、U2、S1～S6 逐條紅。B 是行為端：拿掉 contain:size 重新 build ⇒ B3 在 704×830、860×880 紅（整頁 917／925 高、手牌出畫面），
 *      不在這支裡另外 build BASE（太慢），由突變測試證明。
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '641eb9fe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));
const MOD = 'src/lib/game/battle-layout-default.ts';

async function loadDefault(src, name = 'defaultBattleLayout') {
  if (src == null) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6596-'));
  try {
    const f = join(tmp, 'm.ts'), o = join(tmp, 'm.mjs');
    (await import('node:fs')).writeFileSync(f, src);
    await build({ entryPoints: [f], outfile: o, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    return (await import(pathToFileURL(o).href))[name] ?? null;
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── U：尺寸矩陣 ──
const MATRIX = [
  [[704, 830], 'blue', 'Fold 8 展開（直立）'], [[860, 880], 'blue', 'Fold 8 Ultra 展開（接近正方形）'], [[768, 1024], 'blue', 'iPad 直向'],
  [[744, 1059], 'blue', 'iPad mini 直向'], [[820, 1180], 'blue', 'iPad Air 直向'],
  [[880, 800], 'classic', '接近正方形但寬 ≤950 的橫向（舊的手機橫放規則會切掉行動鈕，審查 P1-1）'], [[703, 676], 'classic', '寬 ≤950 的橫向（審查 P1-1）'],
  [[940, 850], 'classic', '寬 ≤950 的橫向'], [[1000, 920], 'blue', '寬 >950、接近正方形的橫向'], [[704, 704], 'blue', '正方形'],
  [[1000, 700], 'classic', '窄的橫向視窗'], [[900, 780], 'classic', '橫向（高 < 寬×0.9）'], [[1024, 600], 'blue', '寬 ≥1024（v6.446）'],
  [[1366, 768], 'blue', '筆電'], [[1920, 1080], 'blue', '桌機'], [[390, 844], 'classic', '手機（走手機版，不讀這個值）'], [[600, 900], 'classic', '短邊 600 ⇒ 手機'],
  [[0, 0], 'classic', '量不到尺寸'], [[NaN, 800], 'classic', 'NaN'],
];
function unitChecks(fn) {
  if (typeof fn !== 'function') return { U1: false, U1n: 'MISSING' };
  const bad = MATRIX.filter(([[w, h], want]) => fn(w, h) !== want).map(([[w, h], want, n]) => `${n} ${w}×${h} 應為 ${want} 實為 ${fn(w, h)}`);
  return { U1: bad.length === 0, U1n: bad.join('；') };
}

// ── U2：打開選擇視窗前「雙方場上的卡都已載入」的判準（attack-gate.ts 唯一一份，v6.596 審查 P2-1）──
function unit2(fn) {
  if (typeof fn !== 'function') return false;
  const st = { players: [{ active: { cardId: 'a' }, bench: [{ cardId: 'b' }, null] }, { active: { cardId: 'c' }, bench: [{ cardId: 'd' }] }] };
  const has = (set) => (id) => set.includes(id);
  return fn(st, 0, has(['a', 'b', 'c', 'd'])) === true
    && fn(st, 0, has(['a', 'b', 'c'])) === false          // 對手備戰缺卡（借招候選）
    && fn(st, 0, has(['b', 'c', 'd'])) === false          // 出招方自己缺卡
    && fn({ players: [{ active: null, bench: [] }, { active: { cardId: 'c' } }] }, 0, () => true) === false   // 出招方沒有戰鬥寶可夢
    && fn({ players: [{ active: { cardId: 'a' } }, { active: null, bench: null }] }, 0, has(['a'])) === true   // bench 缺欄位／對手戰鬥位空
    && fn(null, 0, () => true) === false;
}

// ── S：接線 ──
function staticChecks(PAGE) {
  const r = {};
  const p = stripCommentsBlank(PAGE);
  r.S1 = /import \{ defaultBattleLayout \} from '\$lib\/game\/battle-layout-default';/.test(p)
    && /else if \(typeof window !== 'undefined' && defaultBattleLayout\(window\.innerWidth, window\.innerHeight\) === 'blue'\) battleLayout = 'blue';/.test(p)
    && !/window\.innerWidth >= 1024\) battleLayout = 'blue'/.test(p);
  // 填滿規則：在既有的 @media (max-width: 1023px) 區塊裡（不新增媒體查詢）
  // ⭐v6.614（Rule 40）：區塊第一行的 Fable 後備規則加上了 :not(.layout-blue)（新版桌墊 <1024 改用電腦版格線）⇒ 兩種寫法都認
  let mq = PAGE.indexOf('  @media (max-width: 1023px){\n    .playmat.layout-fable{ --card-w-cap:9999px;');
  if (mq < 0) mq = PAGE.indexOf('  @media (max-width: 1023px){\n    .playmat.layout-fable:not(.layout-blue){ --card-w-cap:9999px;');
  const blkEnd = mq > 0 ? PAGE.indexOf('\n  }\n', mq) : -1;
  const blk = mq > 0 && blkEnd > mq ? PAGE.slice(mq, blkEnd) : '';
  const fill = blk.slice(blk.indexOf('/* >>> v6596-blue-portrait-fill */'), blk.indexOf('/* <<< v6596-blue-portrait-fill */'));
  r.S2 = blk.length > 2000 && fill.length > 300
    && /\.battle-root:has\(\.playmat\.layout-blue\) > \.playmat\.layout-blue\.layout-fable\{ flex:1 0 auto; grid-template-rows:auto minmax\(0, 1fr\) auto; \}/.test(fill)
    && /\.playmat\.layout-blue\.layout-fable \.action-bar > \.log-col\{[^}]*flex:1 1 240px;[^}]*min-height:120px;[^}]*contain:size; \}/.test(fill);
  // ⭐v6.614（Rule 40）：站長 2026-10-31 裁定新版桌墊 <1024 改用電腦版格線，v6596 填滿段已移除。
  //   本條要守的意圖（直立大螢幕剛好一個畫面：對戰區吃滿剩餘高度、紀錄的內容多寡不可撐高整頁）改由 v6614 哨兵承擔：
  //   整頁鎖在一個畫面＋紀錄欄 contain:size。只接受這一種替代（逐字比對），B3 的實測量測一條都不改。
  if (!r.S2) {
    const a = blk.indexOf('/* >>> v6614-blue-narrow-desktop */'), b = blk.indexOf('/* <<< v6614-blue-narrow-desktop */');
    const seg = a > 0 && b > a ? blk.slice(a, b) : '';
    r.S2 = blk.length > 2000 && seg.length > 300
      && seg.includes('.battle-root:has(.playmat.layout-blue){ height:100vh; height:100dvh; min-height:0; overflow:hidden; }')
      && seg.includes('.battle-root:has(.playmat.layout-blue) .playmat.layout-blue.layout-fable .action-bar > .log-col{ contain:size; min-height:0; }');
  }
  // dispatch：canAct 之後、錦標賽送出之前就擋（錦標賽也走這裡）
  const d0 = p.indexOf('async function dispatch(');
  const dBody = d0 > 0 ? p.slice(d0, p.indexOf('const prevState = game;', d0)) : '';
  const iGate = dBody.indexOf("if (attackGateLocked && action.type !== 'ATTACK') { gateNudge(); return; }");
  r.S3 = iGate > dBody.indexOf('if (!canAct) {') && iGate > 0 && iGate < dBody.indexOf('if (isTournament) { await tournamentDispatch(action); return; }');
  // 提示列：在 {#if isPortraitMobile …}{:else}…{/if} 版面分支之外（v6.167 教訓：畫在錯的分支＝有一種版面永遠看不到）
  const iBar = p.indexOf('{#if attackGateLocked && !attackGatePickerOpen}');
  // v6.190 的獎賞卡檢視註明它在版面分支之外；提示列緊接在它前面、中間只有空白 ⇒ 同一層（分支之外）
  const gapTxt = PAGE.slice(PAGE.indexOf('<!-- <<< v6596-gate-banner-markup -->') + 38, PAGE.indexOf('<!-- ⭐⭐⭐v6.190 獎賞卡檢視（回放限定）'));
  r.S4 = iBar > 0 && /<button class="restart-cancel-btn gate-reopen-btn" disabled=\{!attackGateReady\} onclick=\{reopenGatePicker\}>/.test(p)
    && /if \(!game \|\| !attackGateLocked \|\| attackGatePickerOpen \|\| !attackGateReady\) return;/.test(p)
    && /const attackGateReady = \$derived\(!!game && gateFieldCardsLoaded\(game, game\.activePlayerIndex, \(id\) => pool\.has\(id\)\)\);/.test(p)
    && /if \(!game \|\| !gateFieldCardsLoaded\(game, game\.activePlayerIndex, \(id\) => _pool\.has\(id\)\)\) return;/.test(p)
    && (p.match(/\{#if attackGateLocked && !attackGatePickerOpen\}/g) || []).length === 1
    && PAGE.indexOf('<!-- <<< v6596-gate-banner-markup -->') > 0 && /^\s*$/.test(gapTxt);
  // S5 旋轉提示：新版桌墊不顯示（站長 2026-10-24 裁定）；S6 從沒選過版面 ⇒ 寬度改變時重算預設、不寫回 localStorage
  r.S5 = p.includes("{#if game && game.phase !== 'game-over' && !isSpectator && !isPortraitMobile && battleLayout !== 'blue'}") && (p.match(/<div class="rotate-prompt">/g) || []).length === 1;
  const rz = p.slice(p.indexOf('const onResize = () => {'), p.indexOf('window.addEventListener(\'resize\', onResize);'));
  r.S6 = /if \(w !== _layoutDefaultW\) \{\s*_layoutDefaultW = w;\s*try \{\s*const _savedL = localStorage\.getItem\('ptcg_battle_layout'\);\s*if \(!_savedL\) battleLayout = defaultBattleLayout\(w, h\);/.test(rz) && !/localStorage\.setItem/.test(rz);
  return r;
}

const U = unitChecks(await loadDefault(existsSync(join(ROOT, MOD)) ? R(MOD) : null));
ok('★★★ U1 預設版面判準：直立／接近正方形的大螢幕（寬<1024、短邊>600、高≥寬×0.9）⇒ 新版桌墊；窄橫向 ⇒ 經典版；≥1024 ⇒ 新版桌墊', U.U1 === true, U.U1n);
ok('★★★ U2 打開選擇視窗前「雙方場上的卡都已載入」判準（自動接回與提示列按鈕共用）', unit2(await loadDefault(R('src/lib/game/attack-gate.ts'), 'gateFieldCardsLoaded')));
const PAGE = R('src/routes/game/+page.svelte');
const S = staticChecks(PAGE);
ok('★★★ S1 對戰頁 onMount 的預設版面改問 defaultBattleLayout（不再只看寬 ≥1024）；只影響沒選過版面的玩家', S.S1 === true);
ok('★★★ S2 填滿規則寫在既有的 max-width:1023px 區塊裡：對戰區吃滿剩餘高度、紀錄放到行動列右邊並 contain:size', S.S2 === true);
ok('★★ S3 已擲完硬幣時，dispatch 在送出前（含錦標賽）擋下非出招動作並提示', S.S3 === true);
ok('★★ S4 提示列與「打開選擇視窗」鈕只有一份、放在版面分支之外；卡片沒載完時停用（接回與按鈕都問同一個判準）', S.S4 === true);
ok('★★★ S5 新版桌墊不顯示「請將裝置旋轉至橫向」遮罩（站長裁定）；其他版面照舊', S.S5 === true);
ok('★★ S6 從沒選過版面 ⇒ 視窗寬度改變（Fold 展開、旋轉）重算預設；只看寬度（螢幕鍵盤不觸發）、不寫回 localStorage', S.S6 === true);

// ── B：真瀏覽器 ──
async function browserChecks(buildDir) {
  const r = { ran: false };
  if (!existsSync(join(buildDir, '404.html'))) return r;
  const chromium = pwChromium('v6.596 Fold');
  if (!chromium) return r;
  const browser = await pwLaunchWith(chromium, 'v6.596 Fold');
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
  const port = srv.address().port;
  // 開一局 vs AI（雙方呼呼王「呆呆王」預組，牌組有 4 張夜間學院），把手上的夜間學院打出去
  async function openGame(vp, layout, seed, ctxOpts = {}) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, ...ctxOpts });
    await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
    await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
    await ctx.addInitScript(([l, sd]) => { let x = sd; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; if (l) localStorage.setItem('ptcg_battle_layout', l); }, [layout, seed]);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
    await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
    await pg.click('.mode-card');
    const sels = pg.locator('main.lobby select');
    await sels.nth(0).selectOption('__preset_slowking__'); await sels.nth(1).selectOption('__preset_slowking__');
    const start = pg.locator('button.btn-primary', { hasText: '開始' }); await start.waitFor({ state: 'visible', timeout: 30000 });
    for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
    await start.click();
    await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 }); await pg.waitForTimeout(1200);
    const drag = async (from, tx, ty) => { const a = await from.boundingBox(); if (!a) return; await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down(); await pg.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 - 10, { steps: 3 }); await pg.mouse.move(tx, ty, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(700); };
    const z = await pg.locator('.my-active-zone').boundingBox();
    if (z) await drag(pg.locator('.hand-card.draggable').first(), z.x + z.width / 2, z.y + z.height / 2);
    await pg.mouse.move(5, 300);
    const sysBtn = pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成/ });
    let myTurn = false;
    for (let w = 0; w < 90 && !myTurn; w++) { myTurn = await pg.locator('button:visible', { hasText: '跳過攻擊' }).count() > 0; if (!myTurn) { if (await sysBtn.count()) await sysBtn.first().click().catch(() => {}); await pg.waitForTimeout(700); } }
    return { ctx, pg, errs, myTurn, drag, sysBtn };
  }
  const cls = (pg) => pg.evaluate(() => ({ blue: !!document.querySelector('.playmat.layout-blue'), classic: !document.querySelector('.playmat.layout-fable') && !document.querySelector('.playmat.layout-tabletop') }));
  try {
    // B1 預設版面（初始視窗就是該尺寸）
    for (const [vp, want, key] of [[{ width: 704, height: 830 }, 'blue', 'B1a'], [{ width: 860, height: 880 }, 'blue', 'B1b'], [{ width: 1000, height: 700 }, 'classic', 'B1c'], [{ width: 880, height: 800 }, 'classic', 'B1d']]) {
      const g = await openGame(vp, null, 7);
      const c = await cls(g.pg);
      r[key] = g.myTurn && (want === 'blue' ? c.blue : c.classic); r[key + 'n'] = JSON.stringify({ myTurn: g.myTurn, ...c, errs: g.errs.slice(0, 2) });
      await g.ctx.close();
    }
    // B4 觸控平板直立（hasTouch＋isMobile）：新版桌墊不蓋旋轉遮罩、整頁剛好一個畫面；選經典版的照舊有遮罩（正對照）
    const touch = { hasTouch: true, isMobile: true };
    const rot = (pg) => pg.evaluate(() => { const e = document.querySelector('.rotate-prompt'); return !!e && getComputedStyle(e).display !== 'none'; });
    r.B4 = true; const b4 = {};
    for (const vp of [{ width: 704, height: 830 }, { width: 768, height: 1024 }]) {
      const g = await openGame(vp, null, 7, touch);
      const m = await g.pg.evaluate(() => ({ blue: !!document.querySelector('.playmat.layout-blue'), sh: document.documentElement.scrollHeight, H: innerHeight }));
      const shown = await rot(g.pg);
      b4[vp.width + 'x' + vp.height] = { myTurn: g.myTurn, ...m, rotate: shown };
      if (!(g.myTurn && m.blue && !shown && m.sh <= m.H + 1)) r.B4 = false;
      await g.ctx.close();
    }
    { const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 768, height: 1024 }, ...touch });
      await ctx.addInitScript(() => { localStorage.setItem('ptcg_battle_layout', 'classic'); });
      const pg = await ctx.newPage(); await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
      await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 }); await pg.click('.mode-card');
      const sels = pg.locator('main.lobby select'); await sels.nth(0).selectOption('__preset_slowking__'); await sels.nth(1).selectOption('__preset_slowking__');
      const start = pg.locator('button.btn-primary', { hasText: '開始' }); for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500); await start.click();
      await pg.waitForTimeout(4000);
      b4.classicRotate = await rot(pg); if (!b4.classicRotate) r.B4 = false; await ctx.close(); }
    r.B4n = JSON.stringify(b4);
    // B5 從封面螢幕（手機版）展開成大螢幕：沒選過版面 ⇒ 換成新版桌墊（審查 P2-2）
    { const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, ...touch });
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"/>' }));
      const pg = await ctx.newPage(); await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
      await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 }); await pg.click('.mode-card');
      const sels = pg.locator('main.lobby select'); await sels.nth(0).selectOption('__preset_slowking__'); await sels.nth(1).selectOption('__preset_slowking__');
      const start = pg.locator('button.btn-primary', { hasText: '開始' }); for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500); await start.click();
      const mobile = await pg.waitForSelector('.mp', { timeout: 60000 }).then(() => true, () => false);
      await pg.setViewportSize({ width: 704, height: 830 }); await pg.waitForTimeout(1200);
      const c = await cls(pg); r.B5 = mobile && c.blue; r.B5n = JSON.stringify({ mobile, ...c }); await ctx.close(); }
    // B2 選過經典版的玩家照舊
    { const g = await openGame({ width: 704, height: 830 }, 'classic', 7); const c = await cls(g.pg); r.B2 = g.myTurn && c.classic; await g.ctx.close(); }
    // B3 場上有競技場時的填滿量測（找一個開局手上有夜間學院的種子）
    let g = null, seedUsed = 0;
    for (let seed = 9; seed < 21 && !g; seed++) {
      const t = await openGame({ width: 704, height: 830 }, 'blue', seed);
      if (t.myTurn && await t.pg.locator('.hand-card', { hasText: '夜間學院' }).count()) { g = t; seedUsed = seed; } else await t.ctx.close();
    }
    r.B3pre = !!g;
    if (g) {
      const { pg } = g;
      const pm = await pg.locator('.playmat').boundingBox();
      await g.drag(pg.locator('.hand-card', { hasText: '夜間學院' }).first(), pm.x + pm.width / 2, pm.y + pm.height * 0.45);
      for (let k = 0; k < 5; k++) { if (await g.sysBtn.count()) { await g.sysBtn.first().click().catch(() => {}); await pg.waitForTimeout(500); } }
      r.B3stad = await pg.locator('.stadium-display').count() === 1 && await pg.locator('.stadium-btn').count() === 1;
      const res = {};
      for (const [w, h] of [[704, 830], [860, 880], [768, 1024], [744, 1059], [820, 1180]]) {
        await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(700);
        res[w + 'x' + h] = await pg.evaluate(() => {
          const W = innerWidth, H = innerHeight, de = document.documentElement, issues = [];
          const R = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
          const inView = (b) => b && b.l >= -1 && b.t >= -1 && b.r <= W + 1 && b.b <= H + 1;
          const ov = (a, b) => a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
          if (de.scrollHeight > H + 1 || de.scrollWidth > W + 1) issues.push(`整頁 ${de.scrollWidth}×${de.scrollHeight} 比視窗大`);
          const st = R('.stadium-display'), sb = R('.stadium-btn'), hand = R('.hand-strip'), log = R('.action-bar > .log-col'), acts = R('.action-bar > .action-btns'), my = R('.my-row'), opp = R('.opponent-row');
          for (const [n, b] of [['競技場卡', st], ['使用競技場鈕', sb], ['手牌', hand], ['紀錄', log], ['我方場地', my], ['對手場地', opp]]) if (!inView(b)) issues.push(n + ' 不在畫面內');
          if (ov(st, hand) || ov(st, log) || ov(st, acts) || ov(st, my) || ov(st, opp)) issues.push('競技場卡與其他區塊重疊');
          if (ov(sb, hand) || ov(sb, log) || ov(sb, my)) issues.push('使用競技場鈕與其他區塊重疊');
          if (ov(log, my) || ov(log, opp) || ov(log, hand)) issues.push('紀錄蓋到場地或手牌');
          if (log && log.b - log.t < 110) issues.push('紀錄太矮 ' + Math.round(log.b - log.t));
          if (hand && hand.b < H - 30) issues.push(`手牌下面還空 ${Math.round(H - hand.b)}px（沒有填滿）`);
          return issues;
        });
      }
      r.B3 = Object.values(res).every((x) => x.length === 0); r.B3n = JSON.stringify(res) + ' seed=' + seedUsed;
      await g.ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  return r;
}
const BUILD = process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const B = await browserChecks(BUILD);
  if (!B.ran) shallowSkip('B（沒有可用的 Chromium）');
  else {
    ok('★★★ B1a 沒選過版面、704×830（Fold 8 展開）⇒ 新版桌墊', B.B1a === true, B.B1an);
    ok('★★ B1b 沒選過版面、860×880（接近正方形）⇒ 新版桌墊', B.B1b === true, B.B1bn);
    ok('★★ B1c 沒選過版面、1000×700（窄的橫向視窗）⇒ 仍是經典版（零回歸）', B.B1c === true, B.B1cn);
    ok('★★★ B1d 沒選過版面、880×800（寬 ≤950 的橫向）⇒ 經典版（審查 P1-1：新版桌墊會被舊的手機橫放規則切掉行動鈕）', B.B1d === true, B.B1dn);
    ok('★★ B2 選過經典版的玩家在 704×830 仍是經典版（預設值不蓋玩家的選擇）', B.B2 === true);
    ok('★★★ B4 觸控平板直立（704×830、768×1024）：新版桌墊不蓋旋轉遮罩、整頁一個畫面；選經典版的照舊有遮罩（正對照）', B.B4 === true, B.B4n);
    ok('★★★ B5 從封面螢幕（390×844 手機版）展開成 704×830：沒選過版面 ⇒ 換成新版桌墊', B.B5 === true, B.B5n);
    ok('[前提] 找得到開局手上有夜間學院的局，打出後場上有競技場卡與「使用競技場」鈕', B.B3pre === true && B.B3stad === true);
    ok('★★★ B3 場上有競技場時，704×830／860×880／768×1024／744×1059／820×1180 剛好一個畫面：競技場卡與按鈕、手牌、紀錄、雙方場地都在畫面內且不重疊，手牌貼底', B.B3 === true, B.B3n);
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const bp = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  const bm = readBaseBlob(ROOT, BASE_SHA, MOD);
  const bU = unitChecks(await loadDefault(bm.ok ? normEol(bm.out) : null));
  const bS = bp.ok ? staticChecks(normEol(bp.out)) : {};
  const bA = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/attack-gate.ts');
  const bU2 = unit2(bA.ok ? await loadDefault(normEol(bA.out), 'gateFieldCardsLoaded') : null);
  const red = [...(bU.U1 !== true ? ['U1'] : []), ...(bU2 !== true ? ['U2'] : []), ...['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].filter((k) => bS[k] !== true)];
  ok('★★★ HEAD-FAIL：BASE（v6.595）上 U1、U2、S1～S6 逐條紅', red.length === 8, red.join(','));
}

console.log(`\n=== v6.596 直立大螢幕新版桌墊填滿／擲幣後提示：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
