#!/usr/bin/env node
/**
 * v6.578 守衛（站長 2026-10-16 裁定）
 *   ②「一起改成用浮在上方的可關閉可拖曳的視窗顯示」：對戰中的提醒堆疊本身可以拖（use:modalDrag clamp:'contain'），✕ 照常可按
 *   ③「要」：線上／錦標賽頁首標籤一多，新版桌墊／Fable 版在 1366 以下不可以把 ⚙️ 設定、⛶ 全螢幕、本回合資源擠出畫面
 *
 *   【S】靜態：S1 提醒堆疊掛 use:modalDrag（contain、wholeNode）且包在固定位置的外層；S2 頁首標籤區可縮、設定／全螢幕／本回合時間不縮
 *   【E】真瀏覽器（build/）
 *     D1 拖曳提醒 ⇒ 跟著移動、盤面不動；D2 拖到畫面外 ⇒ 被夾回畫面內；D3 拖過之後提醒裡的按鈕照常可按
 *     H1 新版桌墊與 Fable 版 × 6 種寬度，頁首塞進線上會出現的標籤：設定、全螢幕、本回合資源都在畫面內、頁首不用橫捲
 *     H2 頁首高度與盤面位置不變（只縮標籤，不換行）
 *     HM 自驗：標籤區改回不能縮 ⇒ H1 真的會紅；HM2 自驗：視角工具列改回可縮 ⇒ 按鈕被切真的會紅
 *     D4 觸控拖曳（CDP touch 事件）
 *   【H】HEAD-FAIL：S1、S2 餵 BASE（v6.577）必紅
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.577。
const BASE_SHA = '54ddf9e2e9c5b783b1c1785934519e770d9fa399';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
function scenS(src) {
  return {
    S1: src.includes(`  <div class="battle-notice-wrap">\n  <div class="battle-notice-stack" role="presentation" use:modalDrag={{ clamp: 'contain', wholeNode: true, threshold: 6, overlay: false }}>`)
      && /\.battle-notice-wrap\{ position:fixed;[^}]*pointer-events:none; \}/.test(src),
    S2: src.includes(".battle-root:has(.playmat.layout-fable) .battle-header > .status-chips{ flex:0 1 auto; min-width:0; overflow:hidden;")
      && src.includes(".battle-root:has(.playmat.layout-fable) .battle-header > .status-chips > :is(.settings-chip, .fs-chip, .timer-chip, .spec-toolbar){ flex:none; min-width:auto; }"),
  };
}
const LABEL = { S1: '★★★ S1 提醒堆疊是可拖曳的浮動視窗（use:modalDrag contain），外層固定位置', S2: '★★★ S2 頁首標籤區可縮；設定／全螢幕／計時器／觀戰視角按鈕不縮' };
const R = scenS(SRC);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true);
console.log('【H】HEAD-FAIL（BASE v6.577）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6578 HEAD-FAIL', '需要歷史 commit');
else { const x = readBaseBlob(ROOT, BASE_SHA, REL); const B = scenS(x.ok ? x.out.replace(/\r\n/g, '\n') : ''); for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.577：${k} 紅`, B[k] !== true); }

console.log('\n【E】真瀏覽器');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.578 浮動提醒＋頁首') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.578 浮動提醒＋頁首');
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
      await pg.mouse.move(5, 500);
      const sysBtn = pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成/ });
      let myTurn = false;
      for (let w = 0; w < 90 && !myTurn; w++) {
        myTurn = await pg.locator('button:visible', { hasText: '跳過攻擊' }).count() > 0 && await pg.locator('.turn-res').count() > 0;
        if (!myTurn) { if (await sysBtn.count()) await sysBtn.first().click().catch(() => {}); await pg.waitForTimeout(700); }
      }
    ok('[E 前提] 開局成功、輪到玩家 1', myTurn);
    if (myTurn) {
      await pg.addStyleTag({ content: '.selection-overlay,.modal-overlay{display:none!important}' });
      await pg.setViewportSize({ width: 1376, height: 958 }); await pg.waitForTimeout(300);
      // ── D：拖曳提醒（借用頁面上的 net-warn-x 按鈕樣式：複製一顆有 svelte class 的按鈕進去，量「按得到」）
      const injected = await pg.evaluate(() => { const s = document.querySelector('.battle-notice-stack'); if (!s) return false;
        const sc = [...s.classList].find((c) => /^svelte-/.test(c)) || '';
        const d = document.createElement('div'); d.className = 'v6578-fake ' + sc; d.style.cssText = 'background:#16324a;color:#fff;width:100%;box-sizing:border-box;';
        d.textContent = '📶 對手的連線目前不穩定（已有 100 秒沒有連上伺服器）—— 不是你的網路、也不是網站故障。';
        const b = document.createElement('button'); b.id = 'v6578-btn'; b.textContent = '✕'; b.onclick = () => { window.__v6578Clicked = (window.__v6578Clicked || 0) + 1; }; d.appendChild(b); s.appendChild(d); return true; });
      await pg.waitForTimeout(200);
      const rr = () => pg.evaluate(() => { const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; }; return { n: r('.v6578-fake'), pm: r('.playmat'), W: innerWidth, H: innerHeight }; });
      const a = await rr();
      await pg.mouse.move(a.n.l + 30, a.n.t + 8); await pg.mouse.down(); await pg.mouse.move(a.n.l + 80, a.n.t + 80, { steps: 5 }); await pg.mouse.move(a.n.l + 230, a.n.t + 330, { steps: 10 }); await pg.mouse.up(); await pg.waitForTimeout(250);
      const b = await rr();
      ok('★★★[D1] 拖曳提醒 ⇒ 跟著移動、盤面不動', injected && b.n.t - a.n.t > 250 && b.n.l - a.n.l > 150 && Math.abs(b.pm.t - a.pm.t) <= 0.5, JSON.stringify({ a: a.n, b: b.n }));
      await pg.mouse.move(b.n.l + 30, b.n.t + 8); await pg.mouse.down(); await pg.mouse.move(b.n.l + 2000, b.n.t + 2000, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(250);
      const c = await rr();
      ok('★★★[D2] 拖到畫面外 ⇒ 被夾回畫面內（✕ 一定按得到）', c.n.l >= -1 && c.n.r <= c.W + 1 && c.n.t >= -1 && c.n.b <= c.H + 1, JSON.stringify(c.n));
      await pg.click('#v6578-btn');
      ok('★★[D3] 拖過之後提醒裡的按鈕照常可按（不被當成拖曳）', (await pg.evaluate(() => window.__v6578Clicked || 0)) === 1);
      // D4（審查 P2-2）：觸控拖曳（手機）——用 CDP 送真的 touch 事件
      {
        const cdp = await pg.context().newCDPSession(pg);
        const t0 = await rr();
        const x0 = Math.round(t0.n.l + 40), y0 = Math.round(t0.n.t + 8);
        const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
        await tp('touchStart', x0, y0); for (let k = 1; k <= 10; k++) await tp('touchMove', x0 - 10 * k, y0 + 15 * k); await tp('touchEnd'); await pg.waitForTimeout(250);
        const t1 = await rr();
        ok('★★[D4] 觸控拖曳（手機）⇒ 提醒跟著移動', Math.abs(t1.n.t - t0.n.t) > 60 || Math.abs(t1.n.l - t0.n.l) > 40, JSON.stringify({ t0: t0.n, t1: t1.n }));
        await cdp.detach().catch(() => {});
      }
      await pg.evaluate(() => document.querySelectorAll('.v6578-fake').forEach((e) => e.remove()));
      // ── H：頁首塞線上標籤
      // 審查 P2-3：用兩組真實組合（玩家：身分／送出中／等待／場地／房號；觀戰：觀戰中／視角工具列（span 包三顆按鈕）／場地／房號）
      const SETS = { player: [['role-chip', '我是 P1 · 先手'], ['syncing-chip', '⏳ 送出中…'], ['wait-chip', '⏳ 等待對手行動中（點此重新同步）'], ['stadium-chip', '🏟 頂尖之頂 🔍'], ['room-chip', '🔑 ABCD']],
        spec: [['spec-chip', '👀 觀戰中（看 P1）'], ['spec-toolbar', null], ['stadium-chip', '🏟 頂尖之頂 🔍'], ['room-chip', '🔑 ABCD']] };
      const crowd = (pg, set) => pg.evaluate((T) => { const sc = document.querySelector('.battle-header > .status-chips'); const v = sc && sc.querySelector('.version-chip'); if (!v) return false;
        const svc = [...v.classList].find((c) => /^svelte-/.test(c)) || '';
        for (const [cls, t] of T.slice().reverse()) {
          if (cls === 'spec-toolbar') { const tb = document.createElement('span'); tb.className = 'spec-toolbar v6578-chip ' + svc;
            for (const lb of ['看 P1', '看 P2', '自動切換']) { const b = document.createElement('button'); b.className = 'spec-btn ' + svc; b.textContent = lb; tb.appendChild(b); } sc.insertBefore(tb, sc.firstChild); continue; }
          const c = v.cloneNode(true); c.classList.remove('version-chip'); c.classList.add(cls, 'v6578-chip'); c.textContent = t; sc.insertBefore(c, sc.firstChild); }
        return true; }, SETS[set]);
      const hm = (pg) => pg.evaluate(() => { const W = innerWidth, out = []; const hd = document.querySelector('.battle-header');
        if (hd.scrollWidth > hd.clientWidth + 1) out.push(`頁首要橫捲 ${hd.scrollWidth}>${hd.clientWidth}`);
        for (const q of ['.battle-header .settings-chip', '.battle-header .fs-chip', '.battle-header .res-item']) for (const e of document.querySelectorAll(q)) { const b = e.getBoundingClientRect(); if (b.width === 0) continue; if (b.left < -1 || b.right > W + 1) out.push(q + ' 在畫面外 ' + Math.round(b.left) + '~' + Math.round(b.right)); }
        // 觀戰視角按鈕要完整露出（在標籤區的可見範圍內）；計時器不可以被切（inline-flex 沒有「…」）
        const scb = document.querySelector('.battle-header > .status-chips')?.getBoundingClientRect();
        for (const e of document.querySelectorAll('.battle-header .spec-btn')) { const b = e.getBoundingClientRect(); const tb = e.closest('.spec-toolbar')?.getBoundingClientRect(); if (!scb || !tb || b.left < scb.left - 1 || b.right > scb.right + 1 || b.left < tb.left - 1 || b.right > tb.right + 1 || b.right > W + 1) out.push('視角按鈕被切「' + e.textContent + '」'); }
        for (const e of document.querySelectorAll('.battle-header .timer-chip')) { if (getComputedStyle(e).display === 'none') continue; if (e.scrollWidth > e.clientWidth + 1) out.push('計時器被切 ' + e.className.replace(/svelte-\w+/g, '').trim()); }
        return { out, hh: hd.getBoundingClientRect().height, pm: document.querySelector('.playmat').getBoundingClientRect().top }; });
      for (const layout of ['blue', 'fable']) {
        if (!(await pg.locator('select:has(option[value="tabletop"])').count())) await pg.locator('.settings-chip').first().click().catch(() => {});
        await pg.waitForTimeout(300);
        await pg.evaluate((v) => { const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'tabletop')); if (sel) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, layout);
        await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(500);
        const bad = [], shift = [];
        for (const w of [1024, 1112, 1180, 1280, 1366, 1440]) {
          await pg.setViewportSize({ width: w, height: 800 }); await pg.waitForTimeout(300);
          for (const set of ['player', 'spec']) {
            const g0 = await hm(pg); const okc = await crowd(pg, set); await pg.waitForTimeout(200); const g1 = await hm(pg);
            if (!okc) bad.push(w + ' 塞不進標籤');
            for (const x of g1.out) bad.push(`${w}／${set}：${x}`);
            // 觀戰的視角按鈕比標籤高一點（觀戰者一進場就有、整場不變，不是對局中的跳動）⇒ H2 只量玩家組合
            if (set === 'player' && (Math.abs(g1.hh - g0.hh) > 0.5 || Math.abs(g1.pm - g0.pm) > 0.5)) shift.push(`${w}／${set}：頁首 ${g0.hh}→${g1.hh} 盤面 ${g0.pm}→${g1.pm}`);
            if (set === 'spec' && layout === 'blue' && w === 1024) {
              const tag = await pg.addStyleTag({ content: '.battle-header > .status-chips > .spec-toolbar{ flex:0 1 24px !important; min-width:0 !important; overflow:hidden !important; }' }); await pg.waitForTimeout(200);
              const gs = await hm(pg); await tag.evaluate((n) => n.remove());
              ok('★★[HM2] 自驗：視角工具列改回可縮 ⇒ 按鈕被切的判準真的會紅', gs.out.some((x) => /視角按鈕被切/.test(x)), JSON.stringify(gs.out.slice(0, 2)));
            }
            await pg.evaluate(() => document.querySelectorAll('.v6578-chip').forEach((e) => e.remove()));
          }
          if (layout === 'blue' && w === 1112) {
            const tag = await pg.addStyleTag({ content: '.battle-header > .status-chips, .battle-header > .status-chips > *{ flex-shrink:0 !important; min-width:auto !important; }' }); await pg.waitForTimeout(200);
            await crowd(pg, 'player'); await pg.waitForTimeout(200);
            const gm = await hm(pg); await tag.evaluate((n) => n.remove());
            ok('★★[HM] 自驗：標籤區改回不能縮 ⇒ 設定／全螢幕真的會被擠出畫面（量測不是恆真）', gm.out.length > 0, JSON.stringify(gm.out.slice(0, 2)));
          }
          await pg.evaluate(() => document.querySelectorAll('.v6578-chip').forEach((e) => e.remove()));
        }
        ok(`★★★[H1] ${layout}：頁首塞滿玩家／觀戰的真實標籤，設定／全螢幕／本回合資源在畫面內、視角按鈕完整、計時器不被切、頁首不用橫捲（6 種寬度）`, bad.length === 0, bad.slice(0, 4).join(' ｜ '));
        ok(`★★[H2] ${layout}：頁首高度與盤面位置不變（玩家組合）`, shift.length === 0, shift.slice(0, 3).join(' ｜ '));
      }
    }
    ok('[E5] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
    await browser.close(); srv.close();
  }
}
console.log(`\n=== v6.578 浮動可拖曳提醒＋頁首不擠出設定：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
