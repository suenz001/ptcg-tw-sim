#!/usr/bin/env node
/**
 * v6.574 守衛：兩個顯示問題（站長 2026-10-16）
 *   ①「windows網頁版手牌顯示的張數，不該被過長的玩家名稱阻礙顯示(尤其使用ipad版的時候)」
 *      根因：頁首「✋ 名稱 手牌 N 張」是同一段文字，藍桌墊／Fable 版的 chip 允許縮到 0、超出用「…」⇒ 名稱一長，被切掉的是尾巴的張數。
 *      修法：名稱、張數拆兩欄（inline-grid：名稱 minmax(1.6em, max-content) 最多 9em、張數不縮）；（chip 與外框的 min-width 維持原樣：審查實測改 min-content 量不出差別）。
 *   ②「社群自辦歷屆冠軍…淺色模式的時候，【社群】兩個字的底色和字的對比太近」
 *      根因：大廳行內 style 只轉了字色（#dff→#1a5a5a），深色底 #2a6a55 沒轉 ⇒ 1.24:1。
 *
 *   【S】靜態
 *     S1 頁首 chip 拆成 hc-name／hc-num，張數不在可截斷的那一欄
 *     S2 大廳每一個行內 background:#…，在淺色主題下的字色對底色 ≥ 4.5（字色、底色都套用淺色覆寫後計算）
 *   【E】真瀏覽器（需要 build/ 與 Chromium）：四種桌機版面 × 9 種視窗，玩家名稱 40 字
 *     E1 每個手牌張數 chip 沒有被截斷（scrollWidth ≤ clientWidth）
 *     E2 「手牌 N 張」整段在 chip、外框（.hand-counts）與視窗內
 *     E3 頁首不需要橫向捲動（藍桌墊／Fable；經典版與桌墊版頁首本來就可橫向捲動，只驗 E1／E2 的 chip 本身）
 *     EM 自驗：chip 改回單段文字（display:inline）⇒ E1 必紅
 *     E5 擁擠頁首（塞一個 1400px 假項目）張數仍完整
 *   【H】HEAD-FAIL：S1、S2 餵 BASE（v6.573）必紅
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.573。
const BASE_SHA = '4c6381de';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');

const lum = (h) => { const n = parseInt(h.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex6 = (h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h).toLowerCase();
const PRE = ":global(html[data-theme='light']:not([data-battle-view])) .lobby";
function scenS(src) {
  const r = {};
  const chip = /<span class="chip hand-count-chip"[^>]*>\s*<span class="hc-name">✋ \{pl\.name \?\? `P\$\{pi\+1\}`\}<\/span><span class="hc-num">手牌 \{pl\.hand\.length\} 張<\/span>/.test(src);
  const css = /\.hand-count-chip\{ display:inline-grid; grid-template-columns:minmax\(1\.6em, max-content\) max-content;/.test(src)
    && /\.hand-count-chip \.hc-name\{ min-width:0; max-width:9em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; \}/.test(src)
    && /\.hand-count-chip \.hc-num\{ white-space:nowrap; \}/.test(src);   // 審查 P2：張數那一欄不換行也要釘住
  r.S1 = chip && css; r.S1n = JSON.stringify({ chip, css });
  // S2：大廳行內深底
  let a = -1, b = -1;
  try { a = src.indexOf("{#if isTournament && tStep !== 'playing'}"); b = src.indexOf('<div class="battle-root"'); } catch { /* */ }
  const lob = a >= 0 && b > a ? src.slice(a, b) : '';
  const bad = []; let n = 0;
  for (const m of lob.matchAll(/style="([^"]*)"/g)) {
    const st = m[1];
    const bg = (st.match(/background:\s*(#[0-9a-fA-F]{3,6})\b/) || [])[1]; if (!bg) continue;
    const fg = (st.match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,6})\b/) || [])[1]; if (!fg) continue;
    n++;
    const ob = (src.match(new RegExp(`\\[style\\*="background:${bg}"\\] \\{ background: (#[0-9a-fA-F]{6}) !important; \\}`)) || [])[1];
    const of = (src.match(new RegExp(`\\[style\\*="color:${fg}"\\] \\{ color: (#[0-9a-fA-F]{6}) !important; \\}`)) || [])[1];
    const c = cr(hex6(of ?? fg), hex6(ob ?? bg));
    if (c < 4.5) bad.push(`${fg}/${bg} → ${of ?? fg}/${ob ?? bg} = ${c.toFixed(2)}`);
  }
  r.S2 = n >= 1 && bad.length === 0; r.S2n = JSON.stringify({ n, bad });
  return r;
}
const LABEL = {
  S1: '★★★ S1 頁首手牌 chip 拆成「名稱（可縮成…）」與「手牌 N 張（不縮）」兩欄',
  S2: '★★★ S2 大廳行內深色底（例：社群歷屆冠軍的【社群】）在淺色主題下字色對底色 ≥ 4.5',
};
const R = scenS(SRC);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);
console.log('【H】HEAD-FAIL（BASE v6.573）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6574 HEAD-FAIL', '需要歷史 commit');
else {
  const x = readBaseBlob(ROOT, BASE_SHA, REL);
  const B = scenS(x.ok ? x.out.replace(/\r\n/g, '\n') : '');
  for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.573：${k} 紅`, B[k] !== true, String(B[k + 'n']).slice(0, 200));
}

console.log('\n【E】真瀏覽器：四種桌機版面 × 9 種視窗，玩家名稱 40 字');
const LONG = 'ThisIsAVeryLongPlayerNickname_超長暱稱測試';
const VPS = [['iPad Pro 13 橫', 1376, 958], ['iPad Pro 11 橫', 1194, 760], ['iPad 10.5 橫', 1112, 760], ['iPad mini 橫', 1133, 670],
  ['iPad Pro 13 直', 1032, 1302], ['iPad Pro 11 直', 834, 1120], ['13 吋＠150%', 1280, 632], ['15.6 吋', 1366, 657], ['17 吋', 1920, 970]];
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.574 手牌張數') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.574 手牌張數');
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
    const measure = (pg, strict) => pg.evaluate((strict) => {
      const W = innerWidth, out = { e1: [], e2: [], e3: [] };
      const hd = document.querySelector('.battle-header');
      if (hd && hd.scrollWidth > hd.clientWidth + 1) out.e3.push(`頁首要橫向捲動 ${hd.scrollWidth}>${hd.clientWidth}`);
      const chips = [...document.querySelectorAll('.battle-header .hand-count-chip')];
      if (chips.length !== 2) out.e2.push('手牌 chip 數量 ' + chips.length);
      for (const el of chips) {
        if (el.scrollWidth > el.clientWidth + 1) out.e1.push(`被截斷「${el.textContent.trim().replace(/\s+/g, ' ')}」${el.scrollWidth}>${el.clientWidth}`);
        const n = el.querySelector('.hc-num'); const box = el.closest('.hand-counts');
        if (!n) { out.e2.push('沒有 .hc-num'); continue; }
        const q = n.getBoundingClientRect(), c = el.getBoundingClientRect(), p = box.getBoundingClientRect();
        if (!/手牌 \d+ 張/.test(n.textContent)) out.e2.push('張數文字不對：' + n.textContent);
        if (q.left < c.left - 1 || q.right > c.right + 1 || q.left < p.left - 1 || q.right > p.right + 1 || (strict && (q.left < -1 || q.right > W + 1)))
          out.e2.push(`張數被切到 num[${q.left | 0},${q.right | 0}] chip[${c.left | 0},${c.right | 0}] box[${p.left | 0},${p.right | 0}]`);
      }
      return out;
    }, strict);
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
        await pg.fill('input[aria-label="玩家 1 名稱"]', LONG);
        await pg.fill('input[aria-label="玩家 2 名稱"]', LONG + '二').catch(() => {});
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
        // 同一局切換四種版面（走設定裡的版面下拉選單同一個 onchange ⇒ setBattleLayout），省掉每種版面重開一局
        for (const layout of ['blue', 'fable', 'tabletop', 'classic']) {
          await pg.setViewportSize({ width: 1376, height: 958 }); await pg.waitForTimeout(300);
          // 版面下拉選單在「⚙️ 設定」面板裡：沒開就先開
          if (!(await pg.locator('select:has(option[value="tabletop"])').count())) await pg.locator('.settings-chip').first().click().catch(() => {});
          await pg.waitForTimeout(300);
          const switched = await pg.evaluate((v) => {
            const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'blue') && [...x.options].some((o) => o.value === 'tabletop'));
            if (!sel) return false; sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
          }, layout);
          await pg.setViewportSize({ width: 1376, height: 958 }); await pg.waitForTimeout(600);
          // ⭐審查 P3：藍桌墊同時帶 layout-fable ⇒ Fable 要排除 layout-blue 才分得出來
          const on = await pg.evaluate((v) => v === 'classic' ? !document.querySelector('.playmat.layout-blue, .playmat.layout-fable, .playmat.layout-tabletop') : v === 'fable' ? !!document.querySelector('.playmat.layout-fable:not(.layout-blue)') : !!document.querySelector('.playmat.layout-' + v), layout);
          ok(`[E 前提] 切到 ${layout} 版面`, switched && on);
          // 經典版／桌墊版的頁首本來就允許橫向捲動（桌墊版 <1200 會退回、經典版頁首可滑），這兩種只驗 chip 本身；藍桌墊／Fable 才驗「在視窗內、不用捲動」
          const STRICT = layout === 'blue' || layout === 'fable';
          const all = { e1: [], e2: [], e3: [] };
          for (const [nm, w, h] of VPS) {
            await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(300);
            const m = await measure(pg, STRICT);
            for (const k of Object.keys(all)) for (const x of m[k]) all[k].push(`${nm} ${w}×${h}：${x}`);
          }
          ok(`★★★[E1] ${layout}：手牌張數 chip 沒有被截斷（9 種視窗）`, all.e1.length === 0, all.e1.slice(0, 4).join(' ｜ '));
          ok(`★★★[E2] ${layout}：「手牌 N 張」整段在 chip／外框${STRICT ? '／視窗' : ''}內`, all.e2.length === 0, all.e2.slice(0, 4).join(' ｜ '));
          if (STRICT) ok(`★★[E3] ${layout}：頁首不需要橫向捲動`, all.e3.length === 0, all.e3.slice(0, 4).join(' ｜ '));
          if (layout === 'blue') {
            await pg.setViewportSize({ width: 1112, height: 760 });
            const tag = await pg.addStyleTag({ content: '.battle-header .hand-count-chip{ display:inline-block !important; min-width:0 !important; max-width:180px !important; text-overflow:ellipsis !important; white-space:nowrap !important; } .hand-count-chip .hc-name{ max-width:none !important; }' });
            await pg.waitForTimeout(400);
            const mm = await measure(pg, true);
            ok('★★[EM] 自驗：chip 改回單段文字＋可縮 ⇒ E1 真的會紅（量測不是恆真）', mm.e1.length > 0 || mm.e2.length > 0, JSON.stringify(mm).slice(0, 200));
            await tag.evaluate((n) => n.remove());
            // ⭐審查（Opus 5.5）P2：擁擠頁首（線上／錦標賽多出計時器、房號、身分 chip）。頁首塞一個 1400px 的假項目：張數仍要完整。
            //   （審查指出 chip／外框改 min-width:min-content 量不出差別——.hand-counts 的 flex-shrink 只有 .05，頁首會先溢出而不是把它縮掉 ⇒ 那兩行已撤回，不留死碼）
            const crowd = await pg.evaluate(() => { const hd = document.querySelector('.battle-header'); const x = document.createElement('span'); x.id = 'v6574-crowd'; x.style.cssText = 'flex:0 0 1400px;height:4px;'; hd.appendChild(x); return true; });
            await pg.waitForTimeout(300);
            const mc = await measure(pg, false);
            ok('★★★[E5] 擁擠頁首：外框被擠到極限時「手牌 N 張」仍完整（不截斷、在 chip 與外框內）', crowd && mc.e1.length === 0 && mc.e2.length === 0, JSON.stringify(mc).slice(0, 240));
            await pg.evaluate(() => document.getElementById('v6574-crowd')?.remove());
          }
        }
      }
      ok('[E4] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    await browser.close(); srv.close();
  }
}
console.log(`\n=== v6.574 手牌張數不被長名稱擋住＋淺色社群標籤：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
