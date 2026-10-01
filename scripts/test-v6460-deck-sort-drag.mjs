#!/usr/bin/env node
/**
 * v6.460 守衛：牌組編輯器「我的牌組」拖曳排序（玩家建議，站長 2026-10-01 轉述）
 *
 * v5.311～v5.319 九版拖曳都失敗的原因（commit 訊息歸納）：拖曳途中即時重排 ⇒ 手指底下的 <li> 被搬走、
 *   pointer capture 掉、放不下（stuck）；手機 pointer 事件被捲動吃掉。本版的設計就是針對這兩點：
 *   拖曳途中清單**一個節點都不動**（浮起複本＋插入線），**放手才改一次**順序；觸控走 touch 事件＋長按。
 *
 * 【S】靜態（HEAD-FAIL 對 v6.459）
 *   S1 中央模組存在並匯出 deckSortDrag／insertSlot／finalIndex／moveIdTo
 *   S2 牌組編輯器的「我的牌組」掛上 action、列帶 data-deck-sort-item＋data-deck-id；▲▼ 保留
 *   S3 放手改順序走 persistDeckOrder（與 ▲▼ 同一條存檔／雲端同步路）
 * 【U】純函式
 * 【D】行為（esbuild 把模組打進測試頁、真的滑鼠與手指；沒有瀏覽器 ⇒ ENV-SKIP）
 *   D1 ⭐⭐⭐滑鼠拖 A 到 D 下面 ⇒ 放手後順序 BCDA…、onMove 只呼叫一次；**拖曳途中清單 0 個 DOM 變動**（九版失敗的根因）
 *   D2 滑鼠點一下（沒拖）⇒ 不改順序、click 照常送到列上（選牌組）
 *   D3 放手後馬上點別列 ⇒ 那一下 click 不能被吃掉（實測 600ms 吞 click 的回歸）
 *   D4 手機：快速滑動（沒長按）⇒ 頁面捲動、順序不變
 *   D5 ⭐⭐⭐手機：長按 E 再拖到最上 ⇒ EABCD…；拖曳中頁面不捲（touchmove 被擋）
 *   D6 手機：長按後原地放開 ⇒ 不改順序；拖到畫面底緣 ⇒ 自動往下捲、放到後面
 *   D7 收尾：Esc／touchcancel 取消 ⇒ 順序不變、浮起複本與插入線零殘留、原列透明度還原
 *   D8 按在排除的小按鈕（▲▼／×）上 ⇒ 不會啟動拖曳
 *
 * Run: node scripts/test-v6460-deck-sort-drag.mjs
 */
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.459。
const BASE_SHA = '8bd9453f0efdd789bc27badf6e4401b064de40dc';
const MOD = 'src/lib/deck-sort-drag.ts';
const DECKS = 'src/routes/decks/+page.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

console.log('【S】靜態');
const CHECKS = [
  ['S1 中央模組存在並匯出 deckSortDrag／insertSlot／finalIndex／moveIdTo', (f) => {
    const s = f(MOD);
    return ['deckSortDrag', 'insertSlot', 'finalIndex', 'moveIdTo'].every((n) => new RegExp('export function ' + n + '\\b').test(s));
  }],
  ['S2 「我的牌組」掛上 action、列帶 data-deck-sort-item＋data-deck-id；▲▼ 備援還在', (f) => {
    const s = f(DECKS);
    return /<aside class="rail" use:deckSortDrag=\{\{[^}]*onMove: moveDeckTo/.test(s)
      && /<li class:active=\{d\.id === activeId\} data-deck-sort-item data-deck-id=\{d\.id\}>/.test(s)
      && /moveDeckUp\(d\.id\)/.test(s) && /moveDeckDown\(d\.id\)/.test(s)
      && /import \{ deckSortDrag, moveIdTo \} from '\$lib\/deck-sort-drag'/.test(s);
  }],
  ['S3 放手改順序走 persistDeckOrder（與 ▲▼ 同一條存檔／雲端同步路）', (f) => {
    const s = f(DECKS);
    const i = s.indexOf('function moveDeckTo(');
    if (i < 0) return false;
    const body = s.slice(i, s.indexOf('\n  }\n', i));
    return /moveIdTo\(decks, deckId, toIndex\)/.test(body) && /persistDeckOrder\(/.test(body);
  }],
];
for (const [n, fn] of CHECKS) { let r = false, err; try { r = !!fn(rd); } catch (e) { err = e.message; } ok(n, r, err); }

console.log('\n【S】HEAD-FAIL（v6.459）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6460 HEAD-FAIL', '需要 v6.459 commit');
else {
  const base = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); if (!r.ok) throw new Error('BASE 沒有 ' + p); return r.out.replace(/\r\n/g, '\n'); };
  const wrong = CHECKS.filter(([, fn]) => { let r = false; try { r = !!fn(base); } catch { r = false; } return r; }).map(([n]) => n);
  ok('★★★[HEAD-FAIL] S1～S3 在 v6.459 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
}

console.log('\n【U】純函式');
const bundle = existsSync(join(ROOT, MOD))
  ? await build({ entryPoints: [join(ROOT, MOD)], bundle: true, format: 'iife', globalName: 'DSD', write: false, logLevel: 'error', target: 'es2020' })
  : null;
const JS = bundle ? bundle.outputFiles[0].text : '';
let DSD = null;
if (JS) { const g = {}; new Function('window', 'navigator', 'document', JS + '\nwindow.DSD = DSD;')(g, {}, undefined); DSD = g.DSD; }
if (!DSD) ok('U0 模組打包得起來', false, '沒有 ' + MOD);
else {
  ok('U1 insertSlot：第一列中線以上 0、最後一列中線以下 n、中間照中線切', DSD.insertSlot([10, 30, 50], 5) === 0 && DSD.insertSlot([10, 30, 50], 31) === 2 && DSD.insertSlot([10, 30, 50], 99) === 3 && DSD.insertSlot([10, 30, 50], 30) === 1);
  ok('U2 finalIndex：自己後面的槽要減 1（自己那格空出來）', DSD.finalIndex(0, 4) === 3 && DSD.finalIndex(4, 0) === 0 && DSD.finalIndex(2, 3) === 2 && DSD.finalIndex(2, 2) === 2);
  const A = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  ok('U3 moveIdTo：搬移正確、位置沒變／id 不在 ⇒ 回原陣列（同一個參考，呼叫端據此不存檔）',
    DSD.moveIdTo(A, 'a', 2).map((x) => x.id).join('') === 'bcad' && DSD.moveIdTo(A, 'd', 0).map((x) => x.id).join('') === 'dabc'
    && DSD.moveIdTo(A, 'b', 1) === A && DSD.moveIdTo(A, 'zz', 0) === A && DSD.moveIdTo(A, 'a', 99).map((x) => x.id).join('') === 'bcda');
}

console.log('\n【D】行為（真的滑鼠與手指）');
const ROWS = 'ABCDEFGHIJKL'.split('');
const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font:16px sans-serif} .pad{height:180px;background:#eee}
ul.deck-list{list-style:none;margin:0;padding:8px;display:flex;flex-direction:column;gap:4px}
ul.deck-list li{display:flex;align-items:center;gap:4px;height:44px;border:1px solid #ccc;border-radius:4px}
.deck-pick{flex:1;height:100%;text-align:left} .tail{height:900px}
</style></head><body><div class="pad"></div><aside id="rail"><ul class="deck-list" id="ul">${ROWS.map((n) =>
  `<li data-deck-sort-item data-deck-id="${n}"><button class="deck-reorder-btn">▲</button><button class="deck-pick">牌組${n}</button><button class="icon">×</button></li>`).join('')}</ul></aside><div class="tail"></div>
<script>${JS}
window.__order = ${JSON.stringify(ROWS)}; window.__moves = []; window.__clicks = []; window.__mut = 0; window.__during = 0;
function render(){ const ul = document.getElementById('ul'); const map = {}; for (const li of ul.children) map[li.dataset.deckId] = li; for (const id of window.__order) ul.appendChild(map[id]); }
window.__act = DSD.deckSortDrag(document.getElementById('rail'), { itemSelector: 'ul.deck-list > li[data-deck-sort-item]', exclude: '.deck-reorder-btn, .icon',
  onMove(id, to) { window.__moves.push([id, to]); const arr = window.__order.filter((x) => x !== id); arr.splice(to, 0, id); window.__order = arr; render(); } });
document.getElementById('ul').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) window.__clicks.push(li.dataset.deckId); });
new MutationObserver((ms) => { window.__mut += ms.length; if (document.documentElement.classList.contains('deck-sorting')) window.__during += ms.length; }).observe(document.getElementById('ul'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
</script></body></html>`;
const chromium = JS ? pwChromium('v6.460 牌組拖曳排序') : null;
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.460 牌組拖曳排序');
  if (browser) {
    try {
      const order = (pg) => pg.evaluate(() => window.__order.join(''));
      const rowAt = (pg, i) => pg.evaluate((i) => { const r = document.getElementById('ul').children[i].getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height / 2, h: r.height }; }, i);
      const residue = (pg) => pg.evaluate(() => document.querySelectorAll('[data-deck-sort-ghost],[data-deck-sort-line]').length + (document.documentElement.classList.contains('deck-sorting') ? 100 : 0));
      // ── 滑鼠 ──
      {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
        const pg = await ctx.newPage(); await pg.setContent(HTML, { waitUntil: 'load' });
        const a = await rowAt(pg, 0), d = await rowAt(pg, 3);
        await pg.mouse.move(a.x, a.y); await pg.mouse.down();
        for (let k = 1; k <= 12; k++) { await pg.mouse.move(a.x, a.y + (d.y + d.h * 0.3 - a.y) * k / 12); await pg.waitForTimeout(16); }
        const mid = await pg.evaluate(() => ({ ghost: document.querySelectorAll('[data-deck-sort-ghost]').length, src: document.getElementById('ul').children[0].style.opacity, during: window.__during, moves: window.__moves.length }));
        await pg.mouse.up(); await pg.waitForTimeout(100);
        const r1 = { order: await order(pg), moves: await pg.evaluate(() => window.__moves), clicks: await pg.evaluate(() => window.__clicks.slice()), res: await residue(pg) };
        ok('★★★[D1] 滑鼠拖 A 到 D 下面 ⇒ BCDA…，onMove 只呼叫一次、放手那一下 click 不算選牌組、零殘留',
          r1.order === 'BCDAEFGHIJKL' && r1.moves.length === 1 && r1.clicks.length === 0 && r1.res === 0, JSON.stringify(r1));
        ok('★★★[D1] 拖曳途中：有浮起複本、原列變淡、**清單 0 個 DOM 變動**、還沒呼叫 onMove（九版失敗的根因）',
          mid.ghost === 1 && mid.src === '0.35' && mid.during === 0 && mid.moves === 0, JSON.stringify(mid));
        const f = await rowAt(pg, 5);
        await pg.mouse.click(f.x, f.y); await pg.waitForTimeout(100);
        ok('★★[D3] 放手後馬上點別列 ⇒ click 照常送達（不可以被「吃掉放手 click」的保險誤吞）',
          (await pg.evaluate(() => window.__clicks.slice())).join('') === 'F' && (await order(pg)) === 'BCDAEFGHIJKL');
        const g = await rowAt(pg, 6);
        await pg.mouse.move(g.x, g.y); await pg.mouse.down(); await pg.mouse.move(g.x + 2, g.y + 2); await pg.mouse.up(); await pg.waitForTimeout(100);
        ok('★★[D2] 滑鼠點一下（移動 < 5px）⇒ 不改順序、click 照常送到列上', (await order(pg)) === 'BCDAEFGHIJKL' && (await pg.evaluate(() => window.__clicks.slice())).join('') === 'FG');
        // Esc 取消
        const b2 = await rowAt(pg, 1), e2 = await rowAt(pg, 7);
        await pg.mouse.move(b2.x, b2.y); await pg.mouse.down();
        for (let k = 1; k <= 8; k++) { await pg.mouse.move(b2.x, b2.y + (e2.y - b2.y) * k / 8); await pg.waitForTimeout(16); }
        await pg.keyboard.press('Escape'); await pg.mouse.up(); await pg.waitForTimeout(100);
        ok('★★[D7] 拖到一半按 Esc ⇒ 取消（順序不變）、零殘留、原列透明度還原',
          (await order(pg)) === 'BCDAEFGHIJKL' && (await residue(pg)) === 0 && (await pg.evaluate(() => document.getElementById('ul').children[1].style.opacity)) === '');
        // 排除的小按鈕
        const x0 = await pg.evaluate(() => { const r = document.querySelector('#ul li:nth-child(2) .icon').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await pg.mouse.move(x0.x, x0.y); await pg.mouse.down();
        for (let k = 1; k <= 8; k++) { await pg.mouse.move(x0.x, x0.y + 30 * k); await pg.waitForTimeout(16); }
        const ex = await pg.evaluate(() => document.querySelectorAll('[data-deck-sort-ghost]').length);
        await pg.mouse.up(); await pg.waitForTimeout(100);
        ok('★[D8] 按在 × 這類排除的小按鈕上拖 ⇒ 不啟動拖曳', ex === 0 && (await order(pg)) === 'BCDAEFGHIJKL', 'ghost=' + ex);
        await ctx.close();
      }
      // ── 手指 ──
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });
        const pg = await ctx.newPage(); await pg.setContent(HTML, { waitUntil: 'load' });
        const cdp = await ctx.newCDPSession(pg);
        const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y }] });
        const sy = () => pg.evaluate(() => Math.round(scrollY));
        const c = await rowAt(pg, 2);
        await T('touchStart', c.x, c.y);
        for (let k = 1; k <= 10; k++) { await T('touchMove', c.x, c.y - 25 * k); await pg.waitForTimeout(16); }
        await T('touchEnd'); await pg.waitForTimeout(900);
        ok('★★★[D4] 快速滑動（沒長按）⇒ 頁面捲動、順序不變、沒有浮起複本', (await sy()) > 100 && (await order(pg)) === 'ABCDEFGHIJKL' && (await residue(pg)) === 0, 'scrollY=' + (await sy()));
        await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(200);
        const e = await rowAt(pg, 4), a = await rowAt(pg, 0);
        await T('touchStart', e.x, e.y); await pg.waitForTimeout(420);
        for (let k = 1; k <= 12; k++) { await T('touchMove', e.x, e.y + (a.y - a.h * 0.4 - e.y) * k / 12); await pg.waitForTimeout(16); }
        const midT = await pg.evaluate(() => ({ during: window.__during, y: Math.round(scrollY), ghost: document.querySelectorAll('[data-deck-sort-ghost]').length }));
        await T('touchEnd'); await pg.waitForTimeout(200);
        ok('★★★[D5] 長按 E 再拖到最上 ⇒ EABCD…；拖曳中頁面不捲、清單 0 個 DOM 變動、零殘留',
          (await order(pg)) === 'EABCDFGHIJKL' && midT.y === 0 && midT.during === 0 && midT.ghost === 1 && (await residue(pg)) === 0, JSON.stringify(midT) + ' ' + (await order(pg)));
        const f = await rowAt(pg, 3);
        await T('touchStart', f.x, f.y); await pg.waitForTimeout(420); await T('touchEnd'); await pg.waitForTimeout(200);
        ok('★★[D6] 長按後原地放開 ⇒ 不改順序', (await order(pg)) === 'EABCDFGHIJKL' && (await pg.evaluate(() => window.__moves.length)) === 1);
        const g = await rowAt(pg, 1);
        await T('touchStart', g.x, g.y); await pg.waitForTimeout(420);
        for (let k = 1; k <= 8; k++) { await T('touchMove', g.x, g.y + (690 - g.y) * k / 8); await pg.waitForTimeout(16); }
        await pg.waitForTimeout(1500); await T('touchMove', g.x, 691); await pg.waitForTimeout(50);
        const y2 = await sy();
        await T('touchEnd'); await pg.waitForTimeout(200);
        ok('★★[D6] 拖到畫面底緣 ⇒ 自動往下捲、A 被放到最後', y2 > 100 && (await order(pg)) === 'EBCDFGHIJKLA', 'scrollY=' + y2 + ' ' + (await order(pg)));
        await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(200);
        const h = await rowAt(pg, 2);
        await T('touchStart', h.x, h.y); await pg.waitForTimeout(420);
        for (let k = 1; k <= 6; k++) { await T('touchMove', h.x, h.y + 40 * k); await pg.waitForTimeout(16); }
        await T('touchCancel'); await pg.waitForTimeout(200);
        ok('★★[D7] touchcancel（例如來電、系統手勢）⇒ 取消、順序不變、零殘留', (await order(pg)) === 'EBCDFGHIJKLA' && (await residue(pg)) === 0);
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.460 牌組拖曳排序: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6460-deck-sort-drag ===');
process.exit(fail ? 1 : 0);
