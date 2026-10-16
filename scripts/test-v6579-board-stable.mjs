#!/usr/bin/env node
/**
 * v6.579 守衛：盤面在對局中不跳動（站長 2026-10-16：「1. 一起修」——Fable／桌墊／經典版也要固定）
 *   實測三個來源（藍桌墊本來就 0 位移）：
 *   ① 昏厥離場的縮小淡出動畫（out:scale）播放時舊卡還佔位、新的空位已出現 ⇒ 戰鬥區瞬間兩倍高（經典版 215→413px）
 *      ⇒ outScaleAbs：動畫開始時把離場那張改 absolute 疊在原位
 *   ② 手牌上的操作提示（⚡ 拖曳附加…）只在自己回合出現 ⇒ 手牌卡長高一行、手牌列變高、盤面上推 16px
 *      ⇒ 提示改成疊在卡圖下緣（v6579-hand-hint-overlay）
 *   ③ 桌墊版空戰鬥場比實卡高 7px ⇒ 同樣的上內距與框線（v6579-tabletop-empty-same-h）
 *
 *   【S】靜態：S1 兩處離場動畫改用 outScaleAbs；S2 提示疊放；S3 桌墊版空位同高
 *   【E】真瀏覽器：同一局、四種版面各打兩個回合，每 50ms 量一次盤面、我方／對手戰鬥區、手牌列的位置
 *     E1 四種版面換回合時位置變動一律 ≤ 0.5px（E0 確認取樣期間真的換過回合；AI 對局不一定會昏厥，昏厥另由 U 組與 E5 守）
 *     E5 把真的 outScaleAbs 注入真頁面模擬昏厥：經典版 ≤0.5px、其他版面 ≤2.5px
 *     E2 我方戰鬥區高度不會瞬間變兩倍（最大 ≤ 最小 × 1.2）
 *     E4 手牌出現操作提示 ⇒ 手牌列與盤面不動；EM 自驗：提示改回佔版面 ⇒ 真的會推高
 *   【H】HEAD-FAIL：S1～S3 餵 BASE（v6.578）必紅
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.578。
const BASE_SHA = '5c1ac72400e6302a2f5336ff4411c7dc15da7876';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
function scenS(src) {
  return {
    S1: /function outScaleAbs\(node: HTMLElement,/.test(src) && (src.match(/out:outScaleAbs=\{\{/g) || []).length === 2 && !/out:scale=\{\{ duration: 3[26]0, start: 0\.55, opacity: 0 \}\}/.test(src)
      && /node\.style\.position = 'absolute';/.test(src) && /return scale\(node, params\);/.test(src),
    S2: /\.hand-card \.hand-hint\{ position:absolute; left:3px; right:3px; bottom:calc\(\.25rem \+ 1\.1rem \+ 2px\);[^}]*white-space:nowrap;/.test(src) && src.includes('.hand-name{ height:1.1rem; line-height:1.1rem; }'),
    S3: src.includes('.playmat.layout-tabletop .active-card.active-empty{ padding-top:.3rem !important; border-width:1px !important; }'),
    S4: src.includes('.playmat:not(.layout-tabletop):not(.layout-fable) .my-active-zone > .zone-label-sm{ min-height:1.7rem; }'),
  };
}
const LABEL = { S1: '★★★ S1 昏厥離場動畫改用 outScaleAbs（動畫期間不佔版面）', S2: '★★★ S2 手牌操作提示疊在卡圖上（不佔版面）', S3: '★★ S3 桌墊版空戰鬥場與實卡同高', S4: '★★ S4 經典版「我的出場」標籤列固定留出撤退鈕的高度' };
const R = scenS(SRC);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true);
console.log('【H】HEAD-FAIL（BASE v6.578）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6579 HEAD-FAIL', '需要歷史 commit');
else { const x = readBaseBlob(ROOT, BASE_SHA, REL); const B = scenS(x.ok ? x.out.replace(/\r\n/g, '\n') : ''); for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.578：${k} 紅`, B[k] !== true); }

// 【U】outScaleAbs 本體的行為（審查 P1-1／P1-2）：把頁面裡哨兵之間的那一份「原封」抽出來，編進一個最小 Svelte 元件，
//   在真瀏覽器裡實際觸發「昏厥 → 空位」與「退場被中斷又救回來」。對局 E 組抓不到昏厥（AI 對局取樣窗口很難剛好碰到），所以這裡是主防線。
const fnOf = (src) => { const a = src.indexOf('// >>> v6579-out-abs'), b = src.indexOf('// <<< v6579-out-abs'); return a >= 0 && b > a ? src.slice(a, b) : null; };
async function buildMini(fnTs, tag) {
  const { compile } = await import(join(ROOT, 'node_modules/svelte/src/compiler/index.js'));
  const { transform, build } = await import('esbuild');
  const fnJs = (await transform(fnTs, { loader: 'ts' })).code;
  const app = `<script>\nimport { scale } from 'svelte/transition';\n${fnJs}\nlet active = $state({ name: 'A' });\nwindow.__set = (v) => { active = v; };\n</script>\n`
    + `<div id="zone" style="position:relative;padding:10px;border:1px solid #888;width:300px">\n{#if active}\n`
    + `<div id="card" class="active-card" style="padding:8px;border:2px solid red;min-height:100px" onclick={() => { window.__clicked = (window.__clicked || 0) + 1; }} role="presentation" out:outScaleAbs={{ duration: 360, start: 0.55, opacity: 0 }}>{active.name}</div>\n`
    + `{:else}\n<div class="active-card active-empty" style="padding:20px 8px;border:1px dashed #888;min-height:60px">（無出場）</div>\n{/if}\n</div>\n`;
  const js = compile(app, { generate: 'client', filename: 'Mini.svelte' }).js.code;
  const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'v6579-' + tag + '-'));
  wf(join(dir, 'Mini.js'), js);
  wf(join(dir, 'entry.js'), `import { mount } from 'svelte'; import App from './Mini.js'; mount(App, { target: document.body });`);
  const out = await build({ entryPoints: [join(dir, 'entry.js')], bundle: true, write: false, format: 'iife', nodePaths: [join(ROOT, 'node_modules')], conditions: ['browser'], logLevel: 'error' });
  return out.outputFiles[0].text;
}
async function runMini(browser, code) {
  const pg = await browser.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await pg.addScriptTag({ content: code }); await pg.waitForSelector('#card');
  const zoneH = () => pg.evaluate(() => document.getElementById('zone').getBoundingClientRect().height);
  const r = {};
  r.h0 = await zoneH();
  // ① 昏厥：A 退場、空位出現 ⇒ 退場期間戰鬥區高度不可以變成「舊卡＋空位」
  const cardBox0 = await pg.evaluate(() => { const b = document.getElementById('card').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await pg.evaluate(() => window.__set(null)); await pg.waitForTimeout(60);
  r.hDuring = await zoneH();
  r.cardDuring = await pg.evaluate(() => { const e = document.getElementById('card'); if (!e) return null; const b = e.getBoundingClientRect(); return { cs: getComputedStyle(e).position }; });
  await pg.waitForTimeout(500);
  r.cardGone = await pg.evaluate(() => !document.getElementById('card'));
  r.hAfterKO = await zoneH();   // 退場完、只剩空位：空位應與剛離場的卡同高
  r.box0 = cardBox0;
  // ② 退場被中斷：A 退場 60ms 內又回來（回放來回／悔棋）⇒ Svelte 沿用同一個節點；inline 樣式必須還原、點得到
  await pg.evaluate(() => window.__set({ name: 'B' })); await pg.waitForTimeout(500);
  await pg.evaluate(() => window.__set(null)); await pg.waitForTimeout(60);
  await pg.evaluate(() => window.__set({ name: 'C' })); await pg.waitForTimeout(500);
  r.afterAbort = await pg.evaluate(() => { const e = document.getElementById('card'); if (!e) return null; const b = e.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { pos: getComputedStyle(e).position, pe: getComputedStyle(e).pointerEvents, style: e.getAttribute('style'), hit: hit === e || e.contains(hit) }; });
  r.hAfterAbort = await zoneH();
  // ③ 中斷過之後再昏厥一次：仍然不佔版面（Svelte 會快取轉場設定 ⇒ 必須每次退場都重新量）
  await pg.evaluate(() => window.__set(null)); await pg.waitForTimeout(60);
  r.hDuring2 = await zoneH();
  await pg.waitForTimeout(500);
  r.errs = errs; await pg.close();
  return r;
}

console.log('\n【E】真瀏覽器');
const BUILD = join(ROOT, 'build');
{
  const chromiumU = pwChromium('v6.579 outScaleAbs 單元');
  const fnCur = fnOf(SRC);
  ok('★★[U 前提] 抽得到 v6579-out-abs 哨兵之間的函式', !!fnCur && fnCur.includes('function outScaleAbs('));
  const bU = chromiumU && fnCur ? await pwLaunchWith(chromiumU, 'v6.579 outScaleAbs 單元') : null;
  if (bU) {
    const empH = 60 + 40 + 2;   // 空位：min-height 60＋上下內距 40＋框線 2（content-box）
    const judge = (r) => ({
      U1: r.hDuring <= r.h0 + 1 && r.cardDuring && r.cardDuring.cs === 'absolute' && r.cardGone,
      U2: !!r.afterAbort && r.afterAbort.pos === 'static' && r.afterAbort.pe !== 'none' && r.afterAbort.hit,
      U3: r.hDuring2 <= r.h0 + 1,
    });
    const rc = await runMini(bU, await buildMini(fnCur, 'cur'));
    const rm0 = await runMini(bU, await buildMini("// >>> v6579-out-abs\nfunction outScaleAbs(node, params) { return scale(node, params); }\n", 'mut0'));
    const J = judge(rc);
    ok('★★★[U1] 昏厥退場期間戰鬥區不會變成「舊卡＋空位」兩倍高、離場卡是 absolute、動畫完就移除', J.U1, JSON.stringify({ h0: rc.h0, hDuring: rc.hDuring, cd: rc.cardDuring, gone: rc.cardGone }));
    ok('★★★[U2] 退場被中斷、節點被沿用 ⇒ inline 樣式還原（不再 absolute／pointer-events:none）、點得到', J.U2, JSON.stringify(rc.afterAbort));
    ok('★★★[U3] 中斷過之後再昏厥一次 ⇒ 仍然不佔版面（每次退場都重新量）', J.U3, JSON.stringify({ h0: rc.h0, hDuring2: rc.hDuring2 }));
    ok('★[U4] 最小元件零錯誤', rc.errs.length === 0, rc.errs.join(' | '));
    ok('★★★[U5] 昏厥後的空戰鬥場與剛離場的卡同高（補位前後戰鬥區高度不變）', Math.abs(rc.hAfterKO - rc.h0) <= 1, JSON.stringify({ h0: rc.h0, hAfterKO: rc.hAfterKO }));
    ok('★★[U5M] 自驗：沒有這一層時空位與卡片不同高（U5 不是恆真）', Math.abs(rm0.hAfterKO - rm0.h0) > 5, JSON.stringify({ h0: rm0.h0, hAfterKO: rm0.hAfterKO }));
    // UM 自驗：換成一般 scale（沒有 absolute 那一層）⇒ U1 必紅（量測真的看得到兩倍高）
    const rm = rm0;
    ok('★★[UM] 自驗：退場動畫改回一般 scale ⇒ U1 翻紅（戰鬥區真的變高）', !judge(rm).U1 && rm.hDuring > rm.h0 + empH * 0.5, JSON.stringify({ h0: rm.h0, hDuring: rm.hDuring }));
    // HEAD-FAIL：v6.578 沒有 outScaleAbs；審查前的第一版（立即套用、沒有還原）⇒ U2 必紅
    const firstDraft = "// >>> v6579-out-abs\nfunction outScaleAbs(node, params) { try { const top = node.offsetTop, left = node.offsetLeft, w = node.offsetWidth, h = node.offsetHeight;\n"
      + " node.style.position = 'absolute'; node.style.top = top + 'px'; node.style.left = left + 'px'; node.style.width = w + 'px'; node.style.height = h + 'px'; node.style.margin = '0'; node.style.pointerEvents = 'none'; node.style.zIndex = '1'; } catch {}\n return scale(node, params); }\n";
    const rd = await runMini(bU, await buildMini(firstDraft, 'draft'));
    ok('★★[UH] 審查前的第一版（不還原樣式）⇒ U2 紅（守衛抓得到 P1-1）', !judge(rd).U2, JSON.stringify(rd.afterAbort));
    await bU.close();
  }
}
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.579 盤面不跳動') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.579 盤面不跳動');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 1024 } });
      // 卡圖一律回假圖（不連外網）；固定亂數種子 ⇒ 每次都是同一局
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      await ctx.addInitScript((LY) => {
        let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
        localStorage.setItem('ptcg_battle_layout', LY);
      }, 'blue');
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
      await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
      await pg.click('.mode-card');
                const sels = pg.locator('main.lobby select');
      await sels.nth(0).selectOption('__preset_tactic_dragonite__');
      await sels.nth(1).selectOption('__preset_tactic_gardevoir__');
      const start = pg.locator('button.btn-primary', { hasText: '開始' });
      await start.waitFor({ state: 'visible', timeout: 30000 });
      for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
      await start.click();
      // 設置：把第一張可拖的基礎寶可夢拖上戰鬥位，按「準備完成」；之後一路處理系統視窗，直到輪到玩家 1（出現「跳過攻擊」）
      await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 });
      await pg.waitForTimeout(1500);
      const drag = async (from, to) => {
        const a = await from.boundingBox(), z = await to.boundingBox(); if (!a || !z) return;
        await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down();
        await pg.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 - 10, { steps: 3 });
        await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(700);
      };
      await drag(pg.locator('.hand-card.draggable').first(), pg.locator('.my-active-zone'));
      // 審查 P1-2：備戰也放滿（最多 3 隻）⇒ 戰鬥寶可夢昏厥時是「補位」而不是直接輸掉，取樣窗口才會經歷真的昏厥／補位
      for (let b = 0; b < 3; b++) { const c = pg.locator('.hand-card.draggable'); if (!(await c.count())) break; await drag(c.first(), pg.locator('.zone-bench').last()); }
      await pg.mouse.move(5, 500);
      const sysBtn = pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成/ });
      let myTurn = false;
      for (let w = 0; w < 90 && !myTurn; w++) {
        myTurn = await pg.locator('button:visible', { hasText: '跳過攻擊' }).count() > 0 && await pg.locator('.turn-res').count() > 0;
        if (!myTurn) { if (await sysBtn.count()) await sysBtn.first().click().catch(() => {}); await pg.waitForTimeout(700); }
      }
    ok('[E 前提] 開局成功、輪到玩家 1', myTurn);
    if (myTurn) {
      // （不再把選擇視窗藏起來：藏起來的話，昏厥補位等必答的選擇按不到，整局會停在同一回合——審查 P1-2）
      await pg.setViewportSize({ width: 1376, height: 958 }); await pg.waitForTimeout(300);
      const startSample = () => pg.evaluate(() => { window.__s = []; const r = (q) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect() : null; };
        window.__t = setInterval(() => { const a = r('.my-active-zone'); window.__s.push({ pm: r('.playmat')?.top, me: a?.top, meH: a?.height, op: r('.opponent-row .zone-active')?.top, hd: r('.hand-strip')?.top, hh: document.querySelectorAll('.hand-card .hand-hint').length, hs: r('.hand-scroll')?.height, al: [...document.querySelectorAll('.my-active-zone > *, .my-active-zone .btn-retreat')].map((e) => e.className.split(' ')[0] + ':' + (e.getBoundingClientRect().height).toFixed(1) + ':' + getComputedStyle(e).display).join(','), ti: ((document.querySelector('.battle-header')?.textContent || '').match(/回合\s*(\d+)/) || [])[1] || '' }); }, 50); });
      const stopSample = () => pg.evaluate(() => { clearInterval(window.__t); return window.__s; });
      // 打一個完整來回：按「跳過攻擊／結束回合」→ 對手（AI）回合 → 一路處理系統視窗，直到又輪到我（最多 25 秒）
      const sysSel = () => pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成|確認/ });
      const myTurnNow = async () => (await pg.locator('button:visible:not([disabled])', { hasText: '跳過攻擊' }).count()) > 0;
      let koSeen = 0;
      const play = async (n) => {
        for (let k = 0; k < n; k++) {
          const btn = pg.locator('button:visible:not([disabled])', { hasText: /結束回合|跳過攻擊/ });
          if (await btn.count()) await btn.first().click({ timeout: 2000 }).catch(() => {});
          await pg.waitForTimeout(600);
          for (let w = 0; w < 60; w++) { const sb = sysSel(); if (await sb.count()) await sb.first().click({ timeout: 2000 }).catch(() => {});
            else if (await pg.locator('.retreat-modal:visible .retreat-card').count()) {   // 昏厥後補位：點第一隻 → 確定上場
              await pg.locator('.retreat-modal:visible .retreat-card').first().click({ timeout: 1500, position: { x: 10, y: 40 } }).catch(() => {});
              await pg.locator('.retreat-modal:visible button.btn-act.primary:not([disabled])').first().click({ timeout: 1500 }).catch(() => {}); koSeen++;
            } else { const pick = pg.locator('.selection-overlay:visible .sel-card:not(.disabled), .selection-overlay:visible [data-iid]').first(); if (await pick.count()) await pick.click({ timeout: 1500 }).catch(() => {}); } if (w > 2 && await myTurnNow()) break; await pg.waitForTimeout(400); }
          await pg.waitForTimeout(600);
          if (process.env.V6579_DEBUG && !(await myTurnNow())) { await pg.screenshot({ path: '/tmp/v6579-stuck.png' }); console.log('DBG stuck', JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim().slice(0, 16) + (b.disabled ? '(x)' : '')).slice(0, 40)))); }
        }
      };
      const spread = (S, k) => { const v = S.map((x) => x[k]).filter((x) => typeof x === 'number'); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
      // 審查 P1-2：版面選單收在「對戰版面（測試）」摺疊區裡，而且 Escape 關不掉設定視窗 ⇒ 第一版其實從沒換過版面、也點不到「結束回合」。
      //   ⇒ 打開設定 → 展開對戰版面 → 換選單 → 按設定視窗的 ✕ 關掉；最後用 playmat 的 class 驗證真的換成功。
      const layoutOk = (layout) => pg.evaluate((v) => { const c = document.querySelector('.playmat')?.classList; if (!c) return false;
        return v === 'classic' ? !c.contains('layout-tabletop') && !c.contains('layout-fable') && !c.contains('layout-blue')
          : v === 'tabletop' ? c.contains('layout-tabletop') : v === 'fable' ? c.contains('layout-fable') && !c.contains('layout-blue') : c.contains('layout-blue'); }, layout);
      const setLayout = async (layout) => {
        await pg.locator('.settings-chip').first().click({ timeout: 3000 }).catch(() => {});
        await pg.waitForTimeout(300);
        if (!(await pg.locator('select:visible:has(option[value="tabletop"])').count())) await pg.locator('summary:visible', { hasText: '對戰版面' }).first().click({ timeout: 3000 }).catch(() => {});
        await pg.waitForTimeout(200);
        await pg.evaluate((v) => { const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'tabletop')); if (sel) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, layout);
        await pg.waitForTimeout(300);
        // 關掉設定視窗：找「含畫面縮放」那個視窗裡的 ✕
        await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === '✕' && (x.closest('[role=dialog], .modal, .modal-card, .settings-modal, div')?.parentElement?.textContent || '').includes('畫面縮放')); b?.click(); });
        await pg.waitForTimeout(400);
        if (await pg.locator('select:visible:has(option[value="tabletop"])').count()) await pg.keyboard.press('Escape').catch(() => {});
        await pg.waitForTimeout(300);
        return (await layoutOk(layout)) && !(await pg.locator('select:visible:has(option[value="tabletop"])').count());
      };
      // E4／EM：直接在一張手牌上加一行提示（與「自己回合才出現」同一種元素），量手牌列與盤面是否移動
      const addHint = () => pg.evaluate(() => { const c = document.querySelector('.hand-scroll > .hand-card'); const ref = document.querySelector('.hand-card .hand-name'); if (!c || !ref) return false;
        const svc = [...ref.classList].find((x) => /^svelte-/.test(x)) || ''; const h = document.createElement('span'); h.className = 'hand-hint hl v6579-hint ' + svc; h.textContent = '⚡ 拖到備戰發動特性／🔺 拖到進化目標'; c.appendChild(h); return true; });
      const rmHint = () => pg.evaluate(() => document.querySelectorAll('.v6579-hint').forEach((e) => e.remove()));
      const tops = () => pg.evaluate(() => ({ hd: document.querySelector('.hand-strip').getBoundingClientRect().top, pm: document.querySelector('.playmat').getBoundingClientRect().height }));
      {
        const emDiff = {};
        for (const lay of ['classic', 'tabletop', 'fable']) {
          ok(`★★[E 前提] 換到 ${lay} 成功、設定視窗已關閉`, await setLayout(lay));
          const a = await tops(); const okh = await addHint(); await pg.waitForTimeout(150); const b = await tops(); await rmHint();
          ok(`★★★[E4] ${lay}：手牌出現操作提示 ⇒ 手牌列與盤面不動`, okh && Math.abs(b.hd - a.hd) <= 0.5 && Math.abs(b.pm - a.pm) <= 0.5, JSON.stringify({ a, b }));
          // 先量（提示疊放中），再「把提示改回佔版面＋確保至少一張有提示」後量：對局中手牌可能早已有真的提示，所以基準要在改樣式之前取
          const c = await tops(); const tag = await pg.addStyleTag({ content: '.hand-card .hand-hint{ position:static !important; }' });
          await addHint(); await pg.waitForTimeout(150); const d = await tops(); await rmHint(); await tag.evaluate((n) => n.remove());
          emDiff[lay] = Math.round(Math.abs(d.hd - c.hd) * 10) / 10;
        }
        // 經典版的手牌卡高度本來就由卡圖撐住（提示佔版面也不會推高）；Fable／桌面版才是站長看到跳動的版面
        ok('★★[EM] 自驗：提示改回佔版面 ⇒ Fable 版手牌列真的會被推高（E4 不是恆真）', emDiff.fable > 8, JSON.stringify(emDiff));
      }
      let turnsSeen = 0;
      // E5（複審 P1-A／P2-A）：把哨兵內的 outScaleAbs（原封、轉成 JS）注入真頁面，對「我方戰鬥場」模擬一次昏厥：
      //   在實卡後面插入同 class 的空位 → 呼叫 outScaleAbs 的延遲函式 → 把實卡藏起來（等同動畫結束移除）⇒ 量我方戰鬥區 top／高度。
      //   用的是各版面真的 CSS（桌面版 max-height !important、Fable 尺寸…），最小元件抓不到的版面差異在這裡抓。
      const { transform: _tf } = await import('esbuild');
      const fnJsPage = (await _tf(fnOf(SRC) || '', { loader: 'ts' })).code;
      const simKO = () => pg.evaluate((code) => {
        const card = document.querySelector('.my-active-zone .active-card.mine-active'); if (!card) return { err: 'no card' };
        const zone = document.querySelector('.my-active-zone'); const R = () => { const b = zone.getBoundingClientRect(); return { top: b.top, h: b.height }; };
        const svc = [...card.classList].filter((x) => /^svelte-/.test(x));
        const before = R(); const origDisp = card.style.display;
        // 對「實卡的複製品」操作（複審 P3）：真卡先藏起來、複製品放在原位 ⇒ 函式掛的監看跟著複製品一起丟掉，不留在真卡上
        const twin = card.cloneNode(true); card.after(twin); card.style.display = 'none';
        const emp = document.createElement('div'); emp.className = ['active-card', 'active-empty', ...svc].join(' '); emp.textContent = '（無出場）'; twin.after(emp);
        const scale = () => ({}); const fn = new Function('scale', code + '\nreturn outScaleAbs;')(scale);
        fn(twin, {})();
        const during = R(); twin.style.display = 'none'; const after = R();
        emp.remove(); twin.remove(); card.style.display = origDisp;
        const restored = R();
        return { before, during, after, restored };
      }, fnJsPage);
      for (const layout of ['classic', 'tabletop', 'fable', 'blue']) {
        ok(`★★[E 前提] 換到 ${layout} 成功、設定視窗已關閉`, await setLayout(layout));
        {
          const k = await simKO(); const d = (a, b) => Math.max(Math.abs(a.top - b.top), Math.abs(a.h - b.h));
          // 經典版用實測高度貼齊 ⇒ 0.5px；其他版面靠各自 CSS 對齊（桌面版內容盒差約 2px）⇒ 2.5px
          const tolK = layout === 'classic' ? 0.5 : 2.5;
          ok(`★★★[E5] ${layout}：模擬昏厥（空位出現、離場卡退場中、退場完）我方戰鬥區位置與高度變動 ≤ ${tolK}px`, !k.err && d(k.during, k.before) <= tolK && d(k.after, k.before) <= tolK, JSON.stringify(k));
        }
        if (process.env.V6579_DEBUG) { await pg.screenshot({ path: '/tmp/v6579-' + layout + '.png' }); console.log('DBG', layout, JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim().slice(0, 14) + (b.disabled ? '(x)' : '')).slice(0, 40)))); }
        await startSample(); await play(1); const S = await stopSample();
        const tol = 0.5;   // 經典版的撤退鈕標籤列與空位高度也修了（v6.579 審查後）⇒ 四種版面一律 0.5px
        if (process.env.V6579_DEBUG) { let prev = null; for (const x of S) { const k = JSON.stringify([x.me, x.meH, x.op, x.hd]); if (k !== prev) { console.log('DBG', layout, k, x.ti, x.hh, x.al); prev = k; } } }
        const sp = { pm: spread(S, 'pm'), me: spread(S, 'me'), op: spread(S, 'op'), hd: spread(S, 'hd') };
        const H = S.map((x) => x.meH).filter((x) => typeof x === 'number' && x > 0);
        // 審查 P1-2 前提：取樣期間真的換過回合（手牌提示出現過、也消失過）⇒ 根因②在這段取樣裡真的發生過，E1 不是量一個靜止的盤面
        const HH = S.map((x) => x.hh); const TI = [...new Set(S.map((x) => x.ti).filter(Boolean))];
        const moved = TI.length >= 2 || (Math.min(...HH) === 0 && Math.max(...HH) > 0);
        turnsSeen += moved ? 1 : 0;
        console.log(`  （${layout}：取樣期間${moved ? '有' : '沒有'}換回合 ${JSON.stringify({ turns: TI, hintMin: Math.min(...HH), hintMax: Math.max(...HH) })}）`);
        ok(`★★★[E1] ${layout}：對局中盤面／戰鬥區／手牌列位置變動 ≤ ${tol}px（${S.length} 次取樣）`, S.length > 40 && Object.values(sp).every((v) => v <= tol), JSON.stringify(sp));
        ok(`★★[E2] ${layout}：我方戰鬥區高度不會瞬間變兩倍`, H.length > 0 && Math.max(...H) <= Math.min(...H) * 1.2, JSON.stringify({ min: Math.min(...H), max: Math.max(...H) }));
      }
      // E0 前提（審查 P1-2）：至少三種版面的取樣窗口裡真的換過回合（手牌提示出現又消失、或回合數變了）⇒ E1／E2 不是量一個靜止的盤面
      ok('★★[E0 前提] 至少三種版面在取樣期間真的換過回合', turnsSeen >= 3, String(turnsSeen));
      console.log(`  （取樣期間我方補位 ${koSeen} 次）`);
    }
    ok('[E3] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
    await browser.close(); srv.close();
  }
}
console.log(`\n=== v6.579 盤面在對局中不跳動：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
