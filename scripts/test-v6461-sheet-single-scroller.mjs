#!/usr/bin/env node
/**
 * v6.461 守衛：手機選擇視窗（底部 sheet）裡**只有 sheet 本身**是捲動盒
 *
 * 玩家回報（站長 2026-10-01，兩位玩家；站長本人的手機正常）：手機牌庫搜尋「卡片區滑不動，只有右邊縫隙滑得動」。
 * 根因：v6.450 在 sheet 裡只把清單的高度上限拿掉（--scroll-list-max:none），清單本身仍是
 *   overflow-y:auto＋overscroll-behavior:contain 的捲動盒 —— 捲不動、卻擋在真正會捲的 sheet 前面。
 *   Chrome 會跳過這種盒子；WebKit（iPhone 上所有瀏覽器）與較舊的 Android WebView 會把它當捲動邊界 ⇒ 手勢停在格子裡。
 *   這個差異在雲端的 Chromium 重現不出來（我們只有 Chromium）⇒ 判準改成量「結構」：sheet 裡除了 sheet 自己，
 *   **不可以有任何**計算後 overflow-y 是 auto／scroll 的元素（不論瀏覽器怎麼處理巢狀捲動盒，這個結構都不會卡）。
 *
 * 【M】手機直式 375×812（真的 +page.svelte CSS、Playwright 量 computed style；沒有瀏覽器 ⇒ ENV-SKIP）
 *   M1 牌庫搜尋（格子＋牌庫全覽清單＋按鈕列）：sheet 裡唯一的捲動盒是 .selection-modal
 *   M2 撤退／寶可夢選擇（.retreat-grid）、借招清單（.copy-attack-list）：同上
 *   M3 棄牌區檢視（.discard-modal）：唯一的捲動盒是 .discard-modal
 *   M4 真手指在卡片上往上拖 ⇒ sheet 捲動（Chromium 正對照，確認沒有把捲動整個拿掉）
 *   M5 HEAD-FAIL：同一份 markup 套 v6.460 的 CSS ⇒ 格子本身是捲動盒（M1 在 BASE 必紅）
 * 【D】桌機 1366×768：清單照舊自己捲（站長 2026-09-30 桌機規則「卡片區上滾輪只捲卡片」不受影響）
 *
 * 突變（實跑）：只改 overscroll 不改 overflow ⇒ M1～M3 紅；拿掉 discard 那一條 ⇒ M3 紅。
 *   ⚠ 等價突變（誠實標記）：拿掉 .retreat-grid 那一條 M2 仍綠 —— 手機直式另有一條既有的 .retreat-grid 覆寫已經讓它不是捲動盒，
 *     本版把它列進來只是讓「sheet 裡的清單一律不是捲動盒」寫在同一處。
 *
 * Run: node scripts/test-v6461-sheet-single-scroller.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { extractCss } from './lib/zoom-modal-fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.460。
const BASE_SHA = '540e05401b3e6e8aa32de20db0db359f86679482';
const PAGE = 'src/routes/game/+page.svelte';
const CUR_CSS = extractCss(readFileSync(join(ROOT, PAGE), 'utf8').replace(/\r\n/g, '\n'));
let BASE_CSS = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, PAGE); if (r.ok) BASE_CSS = extractCss(r.out.replace(/\r\n/g, '\n')); }

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const CARD = (i) => `<div class="sel-card-wrap"><button class="sel-zoom">🔍</button><button class="sel-card"><div style="width:100%;aspect-ratio:63/88;background:#345"></div><span class="sel-name">卡片${i}</span></button></div>`;
const FIX = {
  deckSearch: `<div class="selection-overlay"><div class="selection-modal" id="m">
    <div class="sel-header"><h3>從牌庫選擇</h3></div><p class="muted small">選 0～1 張（寶可夢）</p>
    <div class="sel-grid" id="g">${Array.from({ length: 40 }, (_, i) => CARD(i)).join('')}</div>
    <details class="full-deck-view" open><summary>📖 查看牌庫剩餘全部</summary><div class="full-deck-list">${Array.from({ length: 20 }, (_, i) => CARD(i)).join('')}</div></details>
    <div class="sel-footer"><button class="btn-act secondary">不選（跳過）</button><button class="btn-act primary">確定（0張）</button></div></div></div>`,
  retreat: `<div class="selection-overlay"><div class="selection-modal retreat-modal" id="m">
    <div class="sel-header"><h3>選擇寶可夢</h3></div>
    <div class="retreat-grid" id="g">${Array.from({ length: 30 }, (_, i) => `<button class="retreat-pick"><div style="width:100%;aspect-ratio:63/88;background:#345"></div>寶可夢${i}</button>`).join('')}</div>
    <div class="copy-attack-list">${Array.from({ length: 10 }, (_, i) => `<div class="copy-attack-poke">招式${i}</div>`).join('')}</div>
    <div class="sel-footer"><button class="btn-act primary">確定</button></div></div></div>`,
  discard: `<div class="zoom-overlay"><div class="zoom-modal discard-modal" id="m"><button class="zoom-close">✕</button>
    <h3 class="discard-title">🗑 棄牌區（40 張）</h3><div class="sel-grid" id="g">${Array.from({ length: 40 }, (_, i) => CARD(i)).join('')}</div></div></div>`,
};
const html = (css, body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
const scrollBoxes = (pg) => pg.evaluate(() => {
  const m = document.getElementById('m');
  return [m, ...m.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => (e.id ? '#' + e.id + ' ' : '') + e.className);
});

const chromium = pwChromium('v6.461 手機 sheet 單一捲動盒');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.461 手機 sheet 單一捲動盒');
  if (browser) {
    try {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
      const pg = await ctx.newPage();
      console.log('【M】手機直式 375×812');
      for (const [k, label, expect] of [['deckSearch', 'M1 牌庫搜尋', 'selection-modal'], ['retreat', 'M2 撤退／借招', 'selection-modal'], ['discard', 'M3 棄牌區檢視', 'discard-modal']]) {
        await pg.setContent(html(CUR_CSS, FIX[k]), { waitUntil: 'load' });
        const sb = await scrollBoxes(pg);
        const tall = await pg.evaluate(() => { const m = document.getElementById('m'); return m.scrollHeight > m.clientHeight + 50; });
        ok(`★★★[${label}] sheet 裡唯一的捲動盒是 ${expect}（內容確實比 sheet 高）`, tall && sb.length === 1 && sb[0].includes(expect), JSON.stringify(sb));
      }
      // M4 真手指
      await pg.setContent(html(CUR_CSS, FIX.deckSearch), { waitUntil: 'load' });
      const cdp = await ctx.newCDPSession(pg);
      const p = await pg.evaluate(() => { const r = document.querySelectorAll('#g .sel-card')[5].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y + 150 }] });
      for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y + 150 - 25 * i }] }); await pg.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(1000);
      const st = await pg.evaluate(() => ({ m: Math.round(document.getElementById('m').scrollTop), g: Math.round(document.getElementById('g').scrollTop) }));
      ok('★★[M4] 真手指在卡片上往上拖 ⇒ sheet 捲動（正對照：捲動沒有被拿掉）', st.m > 100 && st.g === 0, JSON.stringify(st));
      if (BASE_CSS) {
        await pg.setContent(html(BASE_CSS, FIX.deckSearch), { waitUntil: 'load' });
        const sb0 = await scrollBoxes(pg);
        ok('★★★[M5 HEAD-FAIL] v6.460 的 CSS：格子本身也是捲動盒（玩家回報的結構）⇒ M1 在 BASE 必紅', sb0.length > 1 && sb0.some((s) => s.includes('sel-grid')), JSON.stringify(sb0));
      } else shallowSkip('v6461 M5', '需要 v6.460 commit');
      await ctx.close();
      console.log('\n【D】桌機 1366×768');
      const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const pg2 = await ctx2.newPage();
      await pg2.setContent(html(CUR_CSS, FIX.deckSearch), { waitUntil: 'load' });
      const d = await pg2.evaluate(() => { const g = document.getElementById('g'); const cs = getComputedStyle(g); return { ov: cs.overflowY, ob: cs.overscrollBehaviorY, own: g.scrollHeight > g.clientHeight }; });
      ok('★★[D1] 桌機：卡片格子照舊自己捲（overflow auto＋contain、內容溢出）—— 桌機規則不受影響', d.ov === 'auto' && d.ob === 'contain' && d.own, JSON.stringify(d));
      await ctx2.close();
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.461 手機 sheet 單一捲動盒: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6461-sheet-single-scroller ===');
process.exit(fail ? 1 : 0);
