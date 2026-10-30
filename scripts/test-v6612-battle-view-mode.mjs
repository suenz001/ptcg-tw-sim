#!/usr/bin/env node
/**
 * v6.612 守衛：筆電矮螢幕不再被當成手機（站長 2026-10-30：「用筆電的螢幕，似乎還是會顯示手機版的畫面，沒辦法顯示出 windows 網頁版」）
 *
 * 真因：對戰頁舊規則「瀏覽器可用畫面的寬或高只要有一邊 ≤ 600 就是手機」。筆電扣掉工作列／分頁列／網址列後可用高度常不到 600
 *   （站長的筆電 1366×768、1920×1080 大圖示：125%／150% 縮放 ⇒ 約 1093×520、1280×590）⇒ 被當成手機橫放。
 * 修法（站長同意「改判斷＋加手動開關」）：唯一判準 src/lib/game/battle-view-mode.ts
 *   ・寬 ≤ 600 ⇒ 一定手機版（手動也改不了）；玩家手動選「手機版／電腦版」⇒ 照選；
 *   ・自動：高 ≤ 600 時還要主要是手指觸控（pointer: coarse）才算手機 ⇒ 手機橫放仍手機版、筆電（滑鼠／觸控板）走電腦版；平板直立開關（v6.313）照舊。
 *   ・設定 modal 多「🖥️ 對戰畫面：自動／電腦版／手機版」（寬 ≤ 600 不顯示），存 localStorage 'ptcg_battle_view_mode'。
 *
 * 【U】模組：尺寸 × 指標 × 模式矩陣
 * 【S】對戰頁接線（抽出真程式片段執行）：computeIsPortraitMobile 走模組且帶 coarse 與模式；初始化在 onResize 之前、只認合法值；setter 寫 key＋派發 resize；
 *      isSmallScreen＝真手機、isNarrowScreen＝寬 ≤ 600；設定選單在 {#if !isNarrowScreen} 內、三個選項
 * 【B】真瀏覽器（build/）：1093×520、1280×590 滑鼠 ⇒ 電腦版桌墊；844×390 觸控 ⇒ 手機版；手動「手機版」在筆電 ⇒ 手機版；手動「電腦版」在觸控橫放 ⇒ 電腦版；500×800 選電腦版仍手機版
 * 【H】HEAD-FAIL：BASE（v6.611）上 U、S、B 的筆電情境逐條紅
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '30094e83';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

async function loadMod(srcRoot) {
  const p = join(srcRoot, 'src/lib/game/battle-view-mode.ts');
  if (!existsSync(p)) return null;
  const code = (await build({ entryPoints: [p], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

function unitChecks(M) {
  const r = {};
  if (!M) return r;
  const D = M.decideMobileBattle;
  // U1 自動模式：筆電矮螢幕（滑鼠）⇒ 電腦版；觸控的手機（直／橫）⇒ 手機版；窄視窗 ⇒ 手機版；平板／桌機照舊
  const laptop = [[1093, 520], [1280, 590], [1366, 600], [1536, 600]];
  r.U1 = laptop.every(([w, h]) => D(w, h, false, false, 'auto') === false)
    && [[844, 390], [932, 430], [390, 844], [430, 932]].every(([w, h]) => D(w, h, false, true, 'auto') === true)
    // 審查 P2：寬 601～1023 又矮的滑鼠視窗（半邊視窗、小視窗）維持手機版（電腦版在這裡手牌會被推出畫面）
    && [[900, 500], [640, 590], [950, 600], [1023, 600]].every(([w, h]) => D(w, h, false, false, 'auto') === true) && D(1024, 600, false, false, 'auto') === false
    && D(500, 800, false, false, 'auto') === true && D(600, 1000, false, false, 'auto') === true && D(601, 1000, false, false, 'auto') === false
    && D(1366, 1024, false, true, 'auto') === false && D(1920, 1080, false, false, 'auto') === false
    && D(820, 1180, false, true, 'auto') === false && D(820, 1180, true, true, 'auto') === true && D(1180, 820, true, true, 'auto') === false;
  // U2 手動：手機版一律手機；電腦版一律電腦——但寬 ≤ 600 仍是手機（電腦版放不下）
  r.U2 = D(1920, 1080, false, false, 'mobile') === true && D(1093, 520, false, false, 'mobile') === true
    && D(844, 390, false, true, 'desktop') === false && D(820, 1180, true, true, 'desktop') === false
    && D(500, 800, false, false, 'desktop') === true && D(390, 844, false, true, 'desktop') === true;
  // U3 isPhoneSized／normalize／常數
  r.U3 = M.isPhoneSized(1093, 520, false) === false && M.isPhoneSized(1093, 520, true) === true && M.isPhoneSized(600, 2000, false) === true
    && M.normalizeBattleViewMode('desktop') === 'desktop' && M.normalizeBattleViewMode('mobile') === 'mobile'
    && ['auto', null, undefined, '', 'Desktop', 1].every((x) => M.normalizeBattleViewMode(x) === 'auto')
    && M.BATTLE_VIEW_MODE_KEY === 'ptcg_battle_view_mode' && M.MOBILE_EDGE === 600 && M.DESKTOP_SHORT_MIN_W === 1024;
  // U4（審查 P3）coarsePointerNow：查的是 '(pointer: coarse)'、照傳 matches；matchMedia 不存在或丟例外 ⇒ false（CI 沒有 build 也守得到）
  const saved = globalThis.matchMedia, q = [];
  try {
    globalThis.matchMedia = (x) => { q.push(x); return { matches: true }; }; const a = M.coarsePointerNow();
    globalThis.matchMedia = (x) => { q.push(x); return { matches: false }; }; const b = M.coarsePointerNow();
    globalThis.matchMedia = () => { throw new Error('x'); }; const c = M.coarsePointerNow();
    delete globalThis.matchMedia; const d = M.coarsePointerNow();
    r.U4 = a === true && b === false && c === false && d === false && q.every((x) => x === '(pointer: coarse)') && q.length === 2;
  } finally { if (saved) globalThis.matchMedia = saved; else delete globalThis.matchMedia; }
  return r;
}

function staticChecks(G, M) {
  const r = {};
  // S1 computeIsPortraitMobile：抽出來執行，注入真模組與可控的指標／模式
  const m = /function computeIsPortraitMobile\(w: number, h: number, force: boolean\): boolean \{([\s\S]*?)\n  \}/.exec(G);
  if (m && M) {
    const f = new Function('decideMobileBattle', 'coarsePointerNow', 'battleViewMode', 'w', 'h', 'force', m[1]);
    const run = (w, h, coarse, mode) => f(M.decideMobileBattle, () => coarse, mode, w, h, false);
    r.S1 = run(1093, 520, false, 'auto') === false && run(844, 390, true, 'auto') === true && run(1093, 520, false, 'mobile') === true && run(844, 390, true, 'desktop') === false;
  } else r.S1 = false;
  // S2 初始化：在 onResize 之前讀，只認合法值
  const iInit = G.indexOf("try { battleViewMode = normalizeBattleViewMode(localStorage.getItem(BATTLE_VIEW_MODE_KEY)); } catch { /* ignore */ }");
  const iResize = G.indexOf('    const onResize = () => {');
  r.S2 = iInit > 0 && iResize > iInit;
  // S3 setter：抽出來執行 ⇒ 寫 key、存消毒後的值、派發 resize
  const sm = /function setBattleViewMode\(m: string\) \{([\s\S]*?)\n  \}/.exec(G);
  if (sm && M) {
    const runSet = (v) => { const store = {}, ev = []; const st = new Function('v', 'store', 'ev', 'normalizeBattleViewMode', 'BATTLE_VIEW_MODE_KEY', `let battleViewMode = null; const m = v;
      const localStorage = { setItem: (k, x) => { store[k] = x; } }; const window = { dispatchEvent: (e) => { ev.push(e.type); return true; } }; const Event = class { constructor(t) { this.type = t; } };
      (() => {${sm[1]}\n})(); return battleViewMode;`)(v, store, ev, M.normalizeBattleViewMode, M.BATTLE_VIEW_MODE_KEY); return { st, store, ev }; };
    const a = runSet('desktop'), b = runSet('亂值');
    r.S3 = a.st === 'desktop' && a.store.ptcg_battle_view_mode === 'desktop' && a.ev.join() === 'resize' && b.st === 'auto' && b.store.ptcg_battle_view_mode === 'auto';
  } else r.S3 = false;
  // S4 onResize：isSmallScreen＝真手機、isNarrowScreen＝寬 ≤ 600、isPortraitMobile 走單一來源
  r.S4 = /isSmallScreen = isPhoneSized\(w, h, coarsePointerNow\(\)\);\s*isNarrowScreen = w <= MOBILE_EDGE;\s*isPortraitMobile = computeIsPortraitMobile\(w, h, forceMobileBattleUI\);/.test(G);
  // S5 設定選單：在 {#if !isNarrowScreen} 內、三個選項、接 setBattleViewMode
  r.S5 = /\{#if !isNarrowScreen\}[\s\S]{0,300}<select id="battle-view-mode" value=\{battleViewMode\} onchange=\{\(e\) => setBattleViewMode\(e\.currentTarget\.value\)\}>\s*<option value="auto">自動（依螢幕判斷）<\/option>\s*<option value="desktop">電腦版<\/option>\s*<option value="mobile">手機版<\/option>\s*<\/select>[\s\S]{0,40}<\/div>\s*\{\/if\}/.test(G);
  // S6（審查 P3）平板直立開關只在「自動」時顯示；主要指標改變時也重算（matchMedia change → onResize，卸載時移除）
  r.S6 = /\{#if !isSmallScreen && battleViewMode === 'auto'\}/.test(G)
    && /_pointerMq = matchMedia\('\(pointer: coarse\)'\); _pointerMq\.addEventListener\('change', onResize\);/.test(G) && /_pointerMq\?\.removeEventListener\('change', onResize\)/.test(G);
  return r;
}

const M = await loadMod(ROOT);
const U = unitChecks(M);
ok('★★★ U1 自動：筆電矮螢幕（滑鼠、寬 ≥ 1024）電腦版、寬不到 1024 的矮視窗維持手機版；觸控手機直／橫手機版；窄視窗手機版；平板與平板直立開關照舊', U.U1 === true);
ok('★★★ U2 手動：手機版一律手機；電腦版一律電腦；寬 ≤ 600 仍是手機', U.U2 === true);
ok('★★ U3 isPhoneSized／normalize／key／門檻', U.U3 === true);
ok('★★ U4 coarsePointerNow：查 (pointer: coarse)、照傳結果、沒有／例外 ⇒ false', U.U4 === true);
const G = R('src/routes/game/+page.svelte');
const S = staticChecks(G, M);
ok('★★★ S1 computeIsPortraitMobile 抽出執行：走模組、帶指標與模式', S.S1 === true);
ok('★★ S2 畫面模式在 onResize 之前讀好（第一幀不跳）', S.S2 === true);
ok('★★★ S3 setter 抽出執行：存消毒後的值、寫 key、派發 resize', S.S3 === true);
ok('★★ S4 onResize：isSmallScreen＝真手機、isNarrowScreen＝寬 ≤ 600、isPortraitMobile 走單一來源', S.S4 === true);
ok('★★ S5 設定「🖥️ 對戰畫面」三選一，寬 ≤ 600 不顯示', S.S5 === true);
ok('★★ S6 平板直立開關只在自動模式顯示；指標改變也重算', S.S6 === true);

// ── B：真瀏覽器 ──
const BUILD = join(ROOT, 'build');
let B = null;
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const chromium = pwChromium('v6.612');
  const browser = chromium ? await pwLaunchWith(chromium, 'v6.612') : null;
  if (!browser) shallowSkip('B（沒有可用的 Chromium）');
  else {
    // 復盤檔：AI 對打幾步拿一個對戰中的盤面（匯入後就是真的對戰畫面）
    const mod = await buildAiBundle(ROOT); const pool = loadLivePool(ROOT);
    const agents = [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)];
    let snap = null, n = 0;
    playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents, seed: 7, firstPlayer: firstPlayerOf(7), maxSteps: 400,
      onStep: (st, act, next) => { if (!snap && next && next.phase === 'playing' && ++n === 30) snap = JSON.parse(JSON.stringify(next)); } });
    const tmp = mkdtempSync(join(tmpdir(), 'v6612-'));
    const FIX = join(tmp, 'f.ptcgreplay');
    snap.log = [];
    writeFileSync(FIX, JSON.stringify({ format: 'ptcg-tw-sim-replay', v: 1, finalLog: [], finalState: null, snapshots: [{ turn: snap.turn, activePlayerIndex: snap.activePlayerIndex, logLen: 0, state: snap }],
      meta: { kind: 'online', gameId: snap.id, p1name: 'P1', p2name: 'P2', winnerName: null, finalTurn: snap.turn, savedAt: Date.now(), appVersion: 't', viewerSeat: null, revealed: true } }));
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((rs) => srv.listen(0, rs));
    const port = srv.address().port;
    B = {};
    try {
      for (const [tag, w, h, touch, mode] of [['laptop1093', 1093, 520, false, null], ['laptop1280', 1280, 590, false, null], ['halfWin', 900, 500, false, null], ['phoneLand', 844, 390, true, null],
        ['laptopForceMobile', 1093, 520, false, 'mobile'], ['phoneLandForceDesktop', 844, 390, true, 'desktop'], ['narrowForceDesktop', 500, 800, false, 'desktop']]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
        await ctx.addInitScript((m) => { try { if (m) localStorage.setItem('ptcg_battle_view_mode', m); } catch { /* */ } }, mode);
        await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"/>' }));
        await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.replay-lobby input[type=file]', { state: 'attached', timeout: 60000 });
        await pg.locator('.replay-lobby input[type=file]').setInputFiles(FIX);
        await pg.waitForFunction(() => !!document.querySelector('.mp') || !!document.querySelector('.playmat'), null, { timeout: 30000 });
        await pg.waitForTimeout(500);
        B[tag] = await pg.evaluate(() => ({ mobile: !!document.querySelector('.mp'), desktop: !!document.querySelector('.playmat'), coarse: matchMedia('(pointer: coarse)').matches }));
        B[tag].errs = errs.length;
        await ctx.close();
      }
    } finally { await browser.close(); srv.close(); rmSync(tmp, { recursive: true, force: true }); }
    const d = (t) => B[t] && B[t].desktop && !B[t].mobile && B[t].errs === 0, m = (t) => B[t] && B[t].mobile && !B[t].desktop && B[t].errs === 0;
    ok('★★★ B1 筆電 1093×520、1280×590（滑鼠）⇒ 電腦版', d('laptop1093') && d('laptop1280'), JSON.stringify([B.laptop1093, B.laptop1280]));
    ok('★★★ B1b 寬不到 1024 的矮滑鼠視窗（900×500）⇒ 維持手機版（電腦版手牌會被推出畫面）', m('halfWin'), JSON.stringify(B.halfWin));
    ok('★★★ B2 手機橫放 844×390（觸控）⇒ 仍是手機版', m('phoneLand') && B.phoneLand.coarse === true, JSON.stringify(B.phoneLand));
    ok('★★★ B3 手動：筆電選手機版 ⇒ 手機版；手機橫放選電腦版 ⇒ 電腦版；500 寬選電腦版仍手機版', m('laptopForceMobile') && d('phoneLandForceDesktop') && m('narrowForceDesktop'), JSON.stringify([B.laptopForceMobile, B.phoneLandForceDesktop, B.narrowForceDesktop]));
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6612h-'));
  try {
    const bM = await loadMod(tmp);   // BASE 沒有模組 ⇒ null
    const bU = unitChecks(bM);
    const bG = normEol(readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte').out);
    const bS = staticChecks(bG, M);   // 用現行模組跑 BASE 頁面：頁面不帶指標與模式 ⇒ 筆電仍判成手機
    const red = [...['U1', 'U2', 'U3', 'U4'].filter((k) => bU[k] !== true), ...['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].filter((k) => bS[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.611）上 U1～U4、S1～S6 逐條紅', red.length === 10, red.join(','));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.612 筆電電腦版判斷／對戰畫面模式：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
