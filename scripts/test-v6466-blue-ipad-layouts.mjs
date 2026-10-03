#!/usr/bin/env node
/**
 * v6.466 守衛：新版桌墊（battleLayout === 'blue'）在 iPad 與 12～17 吋筆電上的版面
 *
 * 站長交辦（2026-10-02）：確認新版桌墊在 iPad Pro 13／12.9／11、iPad Air 13、iPad 10.5、iPad mini 8.3
 *   以及 12～17 吋筆電能不能正常顯示，有問題就調校。
 *
 * 實測（Playwright 真的開一局、固定亂數種子，28 種視窗，iPad 扣掉 Safari 列、筆電扣掉瀏覽器列）找到三個問題：
 *   ① 頁首一整排不換行、總寬約 1250px ⇒ 視窗 <1250 時右邊被切掉（頁首只能橫向滑，沒人會發現）：
 *      iPad 11／10.5／mini 橫向看不到「填能／支援者／撤退」；iPad 直向連「⚙️ 設定」「⛶ 全螢幕」都在畫面外。
 *   ② 對戰紀錄開著時，📜 收合鈕（58px 高、固定在紀錄欄左上角）蓋住紀錄最上面兩三行（所有尺寸都有）。
 *   ③ <1024 直排後備時，.action-bar 沿用基礎樣式 height:180px，裝不下「行動鈕＋滿寬紀錄（最高 220px）」
 *      ⇒ 紀錄蓋到「我方」那一列；戰鬥框右側那一欄（道具縮圖）伸出框外蓋到獎賞／備戰框。
 *
 * 判準
 *   【S】原始碼（餵 BASE＝v6.465 時標 ★HEAD-FAIL 的必須不成立 ⇒ 證明判準抓得到當時的問題）
 *     S1 頁首是具名容器 blhdr，而且只在新版桌墊（選擇器帶 .layout-blue）宣告 ⇒ 下面的 @container 只會作用在新版桌墊
 *     S2 三段 @container blhdr（<1280／<1100／<900）照設計收東西；任何一段都不准收「設定／全螢幕／本回合時間／手牌張數」
 *     S3 v6466 區塊在 @container 以外的每一條選擇器都 scope 在 .layout-blue 底下（不外洩到經典版／Fable 版）
 *     S4 收合鈕讓位：紀錄欄用外距讓出（不是內距：紀錄欄是捲動容器，內距捲一下就被蓋）；<1024 後備還原外距
 *     S5 後備直排：行動列高度 auto；戰鬥框右側保留道具欄寬度
 *     S6 本頁 @media 數量沒有增加（test-v6187／v6195 的約束；本版改用 @container）
 *   【E】真瀏覽器（需要 build/ 與 Chromium，否則 ENV-SKIP）：固定亂數種子開一局 AI 對戰，等到輪到玩家 1（頁首出現本回合資源），
 *        依序縮放成 10 種代表性視窗，每一種都要：
 *     E1 頁首不需要橫向捲動；「⚙️ 設定」「⛶ 全螢幕」與每一個本回合資源都在畫面內
 *     E2 手牌張數 chip 沒有被「…」截斷（張數是重點）
 *     E3 頁面沒有捲軸；主要區塊（牌堆／備戰／戰鬥／獎賞／手牌／紀錄／行動）都在畫面內、互不重疊
 *     E4 📜 收合鈕（看得到時）不與紀錄欄重疊
 *     E5 頁面零錯誤
 *     EM 自驗突變：① 頁首回到 v6.465 行為（拿掉容器、項目不縮）⇒ iPad 10.5 橫向的 E1 必須變紅；
 *        ② 紀錄欄不讓位 ⇒ E4 必須變紅 ⇒ 證明量測抓得到
 *
 * Run: node scripts/test-v6466-blue-ipad-layouts.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { cssOf } from './lib/svelte-style-block.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.465 之後的 main（7d1450a0，只加了卡表守衛）
const BASE_SHA = '7d1450a0';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** v6466 區塊（去註解）；沒有就回空字串 */
const blockOf = (src) => { const m = /\/\* >>> v6466-blue-ipad \*\/([\s\S]*?)\/\* <<< v6466-blue-ipad \*\//.exec(src); return m ? stripCss(m[1]) : ''; };
const fallbackOf = (src) => { const m = /\/\* >>> v6442-blue-fallback \*\/([\s\S]*?)\/\* <<< v6442-blue-fallback \*\//.exec(src); return m ? stripCss(m[1]) : ''; };
/** 拆出 @container blhdr (max-width: Npx){ … } ⇒ [{ max, body }]，以及剩下的頂層規則 */
function splitContainers(css) {
  const out = []; let rest = css; const re = /@container\s+blhdr\s*\(max-width:\s*(\d+)px\)\s*\{/g; let m;
  while ((m = re.exec(css))) {
    let i = re.lastIndex, d = 1; while (i < css.length && d > 0) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; }
    const whole = css.slice(m.index, i); out.push({ max: +m[1], body: css.slice(re.lastIndex, i - 1) }); rest = rest.replace(whole, '');
  }
  return { tiers: out, rest };
}
const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((x) => ({ sels: x[1].split(',').map((s) => s.trim()).filter(Boolean), body: x[2] }));
const hidden = (tier) => rulesOf(tier.body).filter((r) => /display\s*:\s*none/.test(r.body)).flatMap((r) => r.sels);
const NEVER_HIDE = ['settings-chip', 'fs-chip', 'timer-turn', 'hand-count', 'turn-res', 'res-ic', 'status-chips', 'small-back'];

const CHECKS = [
  ['★★★[S1] 頁首是具名容器 blhdr，只在新版桌墊宣告', true, (src) => {
    const b = blockOf(src); const decl = rulesOf(b).filter((r) => /container\s*:\s*blhdr\s*\/\s*inline-size/.test(r.body));
    // v6.470（Rule 40，意圖不變）：Fable 版比照宣告的那一份只准出現在 v6470-fable-ipad 哨兵內、選擇器限 .battle-root:has(.playmat.layout-fable) .battle-header（內容由 test-v6470 鎖），其餘地方仍只准一份
    const css0 = cssOf(src, REL).replace(/  \/\* >>> v6470-fable-ipad \*\/[\s\S]*?  \/\* <<< v6470-fable-ipad \*\/\n/, '');
    const everywhere = (stripCss(css0).match(/container(?:-name)?\s*:\s*blhdr\b/g) || []).length;
    return decl.length === 1 && decl[0].sels.every((s) => s.includes('.layout-blue') && /\.battle-header$/.test(s)) && everywhere === 1;
  }],
  ['★★★[S2a] 三段 @container blhdr：<1280 收「可用／已用」與 P1／P2 累計時間', true, (src) => {
    const t = splitContainers(blockOf(src)).tiers.find((x) => x.max === 1279); if (!t) return false; const h = hidden(t);
    return h.includes('.res-st') && h.includes('.timer-p1') && h.includes('.timer-p2');
  }],
  ['★★[S2b] <1100 資源只留圖示（收 .res-lb）', true, (src) => { const t = splitContainers(blockOf(src)).tiers.find((x) => x.max === 1099); return !!t && hidden(t).includes('.res-lb'); }],
  ['★★[S2c] <900 收版本／總時間／房號／階段', true, (src) => {
    const t = splitContainers(blockOf(src)).tiers.find((x) => x.max === 899); if (!t) return false; const h = hidden(t);
    return ['.version-chip', '.timer-total', '.room-chip', '.phase-tag'].every((x) => h.includes(x));
  }],
  ['★★★[S2d] 任何一段都不收「設定／全螢幕／本回合時間／手牌張數／資源圖示」', true, (src) => {
    const { tiers } = splitContainers(blockOf(src)); if (tiers.length !== 3) return false;
    return tiers.every((t) => hidden(t).every((s) => !NEVER_HIDE.some((k) => s.includes(k))));
  }],
  ['★★[S2e] 回合文字可縮（min-width:0＋省略號）；手牌張數幾乎不縮（flex-shrink ≤ 0.1）', true, (src) => {
    const r = rulesOf(splitContainers(blockOf(src)).rest);
    const ti = r.find((x) => x.sels.some((s) => s.endsWith('.battle-header > .turn-info')));
    const hc = r.find((x) => x.sels.some((s) => s.endsWith('.battle-header > .hand-counts')));
    const shrink = hc && /flex\s*:\s*0\s+([\d.]+)\s+auto/.exec(hc.body);
    return !!ti && /min-width\s*:\s*0/.test(ti.body) && /text-overflow\s*:\s*ellipsis/.test(ti.body) && !!shrink && +shrink[1] <= 0.1;
  }],
  ['★★[S3] v6466 區塊在 @container 以外的每一條選擇器都 scope 在 .layout-blue', false, (src) => {
    const r = rulesOf(splitContainers(blockOf(src)).rest); return r.length >= 8 && r.every((x) => x.sels.every((s) => s.includes('.layout-blue')));
  }],
  ['★★★[S4a] 📜 收合鈕讓位：紀錄欄用外距（margin-top）讓出，不用內距', true, (src) => {
    const r = rulesOf(splitContainers(blockOf(src)).rest);
    const lc = r.find((x) => x.sels.some((s) => s.includes(':not(.log-collapsed)') && s.endsWith('.action-bar > .log-col')));
    const m = lc && /margin-top\s*:\s*(\d+)px/.exec(lc.body);
    return !!m && +m[1] >= 28 && !/padding-top/.test(lc.body);
  }],
  ['★★[S4b] 收合鈕改成橫向小鈕，頂端跟著頁首（含 --safe-top）', true, (src) => {
    const r = rulesOf(splitContainers(blockOf(src)).rest);
    const tb = r.find((x) => x.sels.some((s) => s.includes(':not(.log-collapsed)') && s.endsWith('.log-toggle-btn')));
    return !!tb && /flex-direction\s*:\s*row/.test(tb.body) && /top\s*:\s*calc\(44px \+ var\(--safe-top, 0px\)\)/.test(tb.body);
  }],
  ['★★[S4c] <1024 後備還原紀錄欄外距（收合鈕在直排本來就隱藏）', true, (src) => /:not\(\.log-collapsed\) > \.action-bar > \.log-col\{ margin-top:0; \}/.test(fallbackOf(src))],
  ['★★★[S5a] <1024 後備：行動列高度 auto（紀錄不再蓋到我方那一列）', true, (src) => /\.playmat\.layout-blue\.layout-fable > \.action-bar\{ height:auto; \}/.test(fallbackOf(src))],
  ['★★[S5b] <1024 後備：戰鬥框右側保留道具欄（padding-right 用 --active-w）', true, (src) => /\.my-row > \.zone-active\{ padding-right:calc\(var\(--active-w\) \* \.42 \+ \d+px\); \}/.test(fallbackOf(src))],
  ['★[S5c] <1024 後備：先攻／後攻小標浮起（不再佔列首一欄）', true, (src) => /\.my-row > \.turn-order-chip\{ position:absolute;/.test(fallbackOf(src))],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('【S】原始碼');
ok('[前提] 讀得到對戰頁與 v6466 區塊', SRC.length > 900000 && blockOf(SRC).length > 800);
for (const c of runAll(SRC)) ok(c.name, c.r);
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6466 S：HEAD-FAIL 比對', '需要 v6.465 commit');
else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.465 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = r.out.replace(/\r\n/g, '\n');
    const wrong = runAll(base).filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.465 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
    const nMedia = (s) => (stripCss(cssOf(s, REL)).match(/@media/g) || []).length;
    ok('★★[S6] 本頁 @media 數量沒有增加（改用 @container）', nMedia(SRC) === nMedia(base), `${nMedia(base)} → ${nMedia(SRC)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】真瀏覽器：固定種子開一局，量 10 種視窗');
const VPS = [
  ['iPad Pro 13 橫（Safari）', 1376, 958], ['iPad Pro 11 橫（Safari）', 1194, 760], ['iPad 10.5 橫（Safari）', 1112, 760],
  ['iPad mini 橫（Safari）', 1133, 670], ['iPad Pro 13 直（Safari）', 1032, 1302], ['iPad Pro 11 直（Safari）', 834, 1120],
  ['iPad mini 直（Safari）', 744, 1059], ['13 吋 1920×1080＠150%', 1280, 632], ['15.6 吋 1366×768', 1366, 657], ['17 吋 1920×1080', 1920, 970],
];
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.466 新版桌墊 iPad／筆電') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.466 新版桌墊 iPad／筆電');
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
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 1024 } });
      // 卡圖一律回假圖（不連外網）；固定亂數種子 ⇒ 每次都是同一局
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      await ctx.addInitScript(() => {
        let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
        localStorage.setItem('ptcg_battle_layout', 'blue');
      });
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
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
      ok('[E 前提] 開局成功、輪到玩家 1（頁首有本回合資源）', myTurn);
      if (myTurn) {
        await pg.addStyleTag({ content: '.selection-overlay,.modal-overlay{display:none!important}' });
        const measure = () => pg.evaluate(() => {
          const W = innerWidth, H = innerHeight, de = document.documentElement, issues = { e1: [], e2: [], e3: [], e4: [] };
          const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
          const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
          const name = (el) => el.className.replace(/svelte-\w+/g, '').trim().split(/\s+/)[0];
          const inView = (r) => r.l >= -1 && r.t >= -1 && r.r <= W + 1 && r.b <= H + 1;
          const hd = document.querySelector('.battle-header');
          if (hd.scrollWidth > hd.clientWidth + 1) issues.e1.push(`頁首要橫向捲動 ${hd.scrollWidth}>${hd.clientWidth}`);
          for (const el of document.querySelectorAll('.battle-header .settings-chip, .battle-header .fs-chip, .battle-header .res-item')) {
            if (!vis(el)) { issues.e1.push(name(el) + ' 不見了'); continue; } if (!inView(R(el))) issues.e1.push(name(el) + ' 在畫面外 ' + JSON.stringify(R(el)));
          }
          if (!document.querySelector('.battle-header .res-item')) issues.e1.push('沒有本回合資源');
          for (const el of document.querySelectorAll('.battle-header .hand-count-chip')) if (el.scrollWidth > el.clientWidth + 1) issues.e2.push('手牌張數被截斷「' + el.textContent.trim() + '」');
          if (de.scrollWidth > W + 1 || de.scrollHeight > H + 1) issues.e3.push(`頁面有捲軸 ${de.scrollWidth}×${de.scrollHeight}`);
          const zones = [...document.querySelectorAll('.zone-pile, .zone-bench, .zone-active, .zone-prizes, .hand-strip, .log-col, .action-btns, .battle-header')].filter(vis);
          for (const z of zones) if (!inView(R(z))) issues.e3.push(name(z) + ' 在畫面外');
          for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
            const a = R(zones[i]), b = R(zones[j]); const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            if (ox > 2 && oy > 2) issues.e3.push(`${name(zones[i])} × ${name(zones[j])} 重疊 ${ox | 0}×${oy | 0}`);
          }
          const tb = document.querySelector('.log-toggle-btn'), lc = document.querySelector('.log-col');
          if (tb && lc && vis(tb) && vis(lc)) { const a = R(tb), b = R(lc); if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) issues.e4.push('📜 收合鈕壓在紀錄欄上'); }
          return issues;
        });
        const all = { e1: [], e2: [], e3: [], e4: [] };
        for (const [nm, w, h] of VPS) {
          await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(500);
          const m = await measure();
          for (const k of Object.keys(all)) for (const x of m[k]) all[k].push(`${nm} ${w}×${h}：${x}`);
        }
        ok('★★★[E1] 頁首不用橫向捲動；設定／全螢幕／本回合資源都在畫面內（10 種視窗）', all.e1.length === 0, all.e1.slice(0, 6).join(' ｜ '));
        ok('★★[E2] 手牌張數沒有被截斷', all.e2.length === 0, all.e2.slice(0, 6).join(' ｜ '));
        ok('★★★[E3] 沒有捲軸；主要區塊都在畫面內、互不重疊', all.e3.length === 0, all.e3.slice(0, 6).join(' ｜ '));
        ok('★★[E4] 📜 收合鈕不壓在紀錄欄上', all.e4.length === 0, all.e4.slice(0, 6).join(' ｜ '));
        // 自驗突變 1：頁首回到 v6.465 行為（拿掉容器、所有項目不縮）⇒ iPad 10.5 橫向的 E1 必須抓到
        await pg.setViewportSize({ width: 1112, height: 760 });
        let tag = await pg.addStyleTag({ content: '.battle-header{ container-type:normal !important; } .battle-header > *{ flex-shrink:0 !important; }' });
        await pg.waitForTimeout(500);
        const mm = await measure();
        ok('★★[EM1] 自驗：頁首回到 v6.465 行為後，iPad 10.5 橫向的 E1 真的會紅（量測不是恆真）', mm.e1.length > 0, JSON.stringify(mm.e1.slice(0, 2)));
        await tag.evaluate((n) => n.remove());
        // 自驗突變 2：紀錄欄不讓位（v6.465 行為）⇒ E4 必須抓到
        await pg.setViewportSize({ width: 1376, height: 958 });
        tag = await pg.addStyleTag({ content: '.playmat.layout-blue .action-bar > .log-col{ margin-top:0 !important; } .playmat.layout-blue .log-toggle-btn{ top:52px !important; }' });
        await pg.waitForTimeout(500);
        const m2 = await measure();
        ok('★★[EM2] 自驗：紀錄欄不讓位時，E4 真的會紅', m2.e4.length > 0, JSON.stringify(m2.e4));
        await tag.evaluate((n) => n.remove());
      }
      ok('[E5] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.466 新版桌墊 iPad／筆電: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6466-blue-ipad-layouts ===');
process.exit(fail ? 1 : 0);
