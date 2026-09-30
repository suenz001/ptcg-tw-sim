#!/usr/bin/env node
/**
 * v6.453 守衛：選擇視窗（picker）實際量測——把 v6.448～v6.453 定下的尺寸「釘住」
 *   （調查報告第三節第 6 步：光看 CSS 字串守不到「最後算出來多寬」，這支用真的瀏覽器量）
 *
 * 做法：抽出對戰頁的完整樣式區塊（與 test-v6285 同一個 lib），配上最小的視窗 markup（class 與真頁面一致），
 *   在 4 種畫面量：桌機 1440×900、筆電 1366×657、手機直式 390×844、手機橫式 844×390。
 *   ⚠ 沒有 Playwright／瀏覽器的機器（CI）⇒ 醒目 ENV-SKIP（scripts/lib/pw.mjs 的統一閘）；CSS 字串級的判準由 test-v6448～v6453 守。
 *
 * 釘住的東西
 *   桌機：S 480／M 760／L 960 寬；可選卡圖 96px；視窗不超出畫面；高度 ≤ 85%；按鈕列「次要在左、主要在右」且看得到
 *   手機直式：全寬貼底；卡片 4 張一列、寶可夢 3 隻一列、卡圖不超出格子；按鈕等寬 ≥ 44px 高
 *   手機橫式：選擇視窗 ≤ 580 寬、高度 ≤ 90%
 * HEAD-FAIL：同一批量測餵 v6.447（統一化之前）的樣式，必須大量不成立。
 *
 * Run: node scripts/test-v6453-picker-measure.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCss, pageHtml } from './lib/zoom-modal-fixture.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ 統一化之前的最後一版（v6.447），必須是留在 main 上的那一顆（IRON_RULES Rule 45）
const PRE_SHA = '5b77a3f6e4708346b672b5f8e0e8c32d8d4a0d50';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// 卡圖：868×1212 的 SVG（與官方卡圖同比例），不需要網路
const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#3a6"/></svg>');
const cards = (n) => Array.from({ length: n }, (_, i) => `<div class="sel-card-wrap"><button class="sel-card"><img src="${IMG}" alt="c${i}"/><span class="sel-name">卡片${i}</span></button></div>`).join('');
const footer = `<div class="sel-footer"><button class="btn-act primary" id="f-primary">確定</button><button class="btn-act secondary" id="f-secondary">跳過</button></div>`;
const FIX = {
  M: `<div class="selection-overlay"><div class="selection-modal" id="m"><div class="sel-header"><h3>從牌庫選擇</h3><p class="sel-hint">選 0～2 張</p></div><div class="sel-grid" id="grid">${cards(8)}</div>${footer}</div></div>`,
  S: `<div class="selection-overlay"><div class="selection-modal pk-s" id="m"><div class="sel-header"><h3>選擇效果</h3></div><div class="modal-choice-list"><div class="modal-choice-row"><button class="btn-act modal-choice-btn">選項一</button></div></div>${footer}</div></div>`,
  TALL: `<div class="selection-overlay"><div class="selection-modal" id="m"><div class="sel-header"><h3>選擇要丟棄的能量</h3></div><div class="sel-grid sel-grid-energy" id="grid">${cards(24)}</div>${footer}</div></div>`,
  RETREAT: `<div class="selection-overlay"><div class="selection-modal retreat-modal" id="m"><div class="sel-header"><h3>選擇換入的寶可夢</h3></div><div class="retreat-grid" id="grid">${Array.from({ length: 5 }, (_, i) => `<div class="retreat-card"><button class="retreat-pick"><img src="${IMG}" alt="p${i}"/><div class="retreat-name">寶可夢${i}</div><div class="retreat-hp">HP 70/70</div></button></div>`).join('')}</div>${footer}</div></div>`,
  L: `<div class="zoom-overlay"><div class="zoom-modal discard-modal" id="m"><button class="zoom-close">✕</button><h3 class="discard-title">棄牌區</h3><div class="sel-grid" id="grid">${cards(9)}</div></div></div>`,
};
const VPS = {
  d1440: { width: 1440, height: 900, mobile: false },
  d1366: { width: 1366, height: 657, mobile: false },
  m390: { width: 390, height: 844, mobile: true },
  l844: { width: 844, height: 390, mobile: true },
};

async function measure(browser, css, fixName, vpName) {
  const vp = VPS[vpName];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(pageHtml(css, FIX[fixName]), { waitUntil: 'load' });
  const r = await pg.evaluate(() => {
    const R = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height), r: Math.round(q.right), b: Math.round(q.bottom) }; };
    const m = document.getElementById('m');
    const imgs = [...document.querySelectorAll('#grid img')];
    const cells = [...document.querySelectorAll('#grid > *')];
    const firstTop = cells.length ? Math.round(cells[0].getBoundingClientRect().top) : null;
    const perRow = cells.filter((c) => Math.round(c.getBoundingClientRect().top) === firstTop).length;
    // 卡圖是否超出自己的格子（疊到隔壁）
    const overflowing = cells.filter((c) => { const img = c.querySelector('img'); if (!img) return false; const a = c.getBoundingClientRect(), b = img.getBoundingClientRect(); return b.right > a.right + 0.5 || b.left < a.left - 0.5; }).length;
    return { m: R(m), img: imgs.length ? R(imgs[0]) : null, perRow, overflowing, primary: R(document.getElementById('f-primary')), secondary: R(document.getElementById('f-secondary')), vw: innerWidth, vh: innerHeight };
  });
  await ctx.close();
  return r;
}

// 每條判準：[名稱, 取量測的 (fix, vp), (r) => boolean]
const CHECKS = [
  ['★★★[桌機 M] 一般選擇視窗 760 寬、置中、在畫面內', 'M', 'd1440', (r) => r.m.w === 760 && Math.abs(r.m.x + r.m.w / 2 - r.vw / 2) <= 1 && r.m.y >= 0 && r.m.b <= r.vh],
  ['★★★[桌機 卡圖] 可選卡圖 96px、不超出格子', 'M', 'd1440', (r) => r.img && r.img.w === 96 && r.overflowing === 0],
  ['★★[桌機 按鈕列] 次要在左、主要在右', 'M', 'd1440', (r) => r.secondary && r.primary && r.secondary.x < r.primary.x && r.primary.r <= r.m.r],
  ['★★★[桌機 S] 選項／數字視窗 480 寬', 'S', 'd1440', (r) => r.m.w === 480],
  ['★★★[桌機 L] 棄牌區 960 寬、卡圖 96', 'L', 'd1440', (r) => r.m.w === 960 && r.img && r.img.w === 96 && r.overflowing === 0],
  ['★★[桌機 寶可夢] 撤退／補位視窗 760 寬、卡圖 96', 'RETREAT', 'd1440', (r) => r.m.w === 760 && r.img && r.img.w === 96],
  ['★★★[筆電 1366×657] 內容很多時視窗高 ≤ 85%、不超出畫面、「確定」仍在畫面內', 'TALL', 'd1366', (r) => r.m.h <= Math.ceil(r.vh * 0.85) + 1 && r.m.y >= 0 && r.m.b <= r.vh && r.primary && r.primary.b <= r.vh && r.primary.y >= r.m.y],
  ['★★★[手機直式] 全寬、貼齊畫面下緣', 'M', 'm390', (r) => r.m.w === r.vw && r.m.x === 0 && r.m.b === r.vh],
  ['★★★[手機直式] 卡片 4 張一列、卡圖不超出格子', 'M', 'm390', (r) => r.perRow === 4 && r.overflowing === 0],
  ['★★[手機直式] 能量卡也是 4 張一列、高度 ≤ 85%', 'TALL', 'm390', (r) => r.perRow === 4 && r.overflowing === 0 && r.m.h <= Math.ceil(r.vh * 0.85) + 1],
  ['★★★[手機直式] 寶可夢 3 隻一列', 'RETREAT', 'm390', (r) => r.perRow === 3 && r.overflowing === 0],
  ['★★[手機直式] 按鈕等寬、至少 44px 高，次要在左', 'M', 'm390', (r) => r.primary && r.secondary && Math.abs(r.primary.w - r.secondary.w) <= 1 && r.primary.h >= 44 && r.secondary.x < r.primary.x],
  ['★★[手機直式] 棄牌區也是全寬貼底', 'L', 'm390', (r) => r.m.w === r.vw && r.m.b === r.vh && r.overflowing === 0],
  ['★★[手機橫式] 選擇視窗 ≤ 580 寬、高度 ≤ 90%、在畫面內', 'TALL', 'l844', (r) => r.m.w <= 580 && r.m.h <= Math.ceil(r.vh * 0.9) + 1 && r.m.y >= 0 && r.m.b <= r.vh],
];

async function runAll(browser, css) {
  const cache = new Map(); const out = [];
  for (const [name, fix, vp, fn] of CHECKS) {
    const key = fix + '@' + vp;
    if (!cache.has(key)) cache.set(key, await measure(browser, css, fix, vp));
    const r = cache.get(key); let v = false;
    try { v = !!fn(r); } catch { v = false; }
    out.push({ name, v, r, key });
  }
  return out;
}

const CSS = extractCss(SRC);
ok('[前提] 抽得到對戰頁樣式區塊', CSS.length > 200000, String(CSS.length));

const chromium = pwChromium('v6.453 picker 量測');
if (!chromium) {
  console.log('  ⚠⚠ ENV-SKIP：這台機器沒有 Playwright —— 量測沒有跑（CSS 字串級判準由 test-v6448～v6453 守）');
} else {
  const browser = await pwLaunchWith(chromium, 'v6.453 picker 量測');
  if (!browser) {
    console.log('  ⚠⚠ ENV-SKIP：瀏覽器啟動失敗 —— 量測沒有跑');
  } else {
    try {
      console.log('A) 目前的樣式：每一條量測都成立');
      const cur = await runAll(browser, CSS);
      for (const c of cur) ok(c.name, c.v, c.key + ' ' + JSON.stringify({ m: c.r.m, img: c.r.img && c.r.img.w, perRow: c.r.perRow, ov: c.r.overflowing, p: c.r.primary, s: c.r.secondary }));

      console.log('\nB) HEAD-FAIL：同一批量測餵 v6.447（統一化之前）');
      if (!hasBaseCommit(ROOT, PRE_SHA)) {
        shallowSkip('v6453 B：HEAD-FAIL 量測', '需要 v6.447 commit');
      } else {
        const rb = readBaseBlob(ROOT, PRE_SHA, REL);
        ok('[前提] 讀得到 v6.447 的對戰頁', rb.ok);
        if (rb.ok) {
          const base = await runAll(browser, extractCss(rb.out.replace(/\r\n/g, '\n')));
          const reds = base.filter((c) => !c.v).length;
          // 統一化之前：M 是 722、S 不存在、L 968、卡圖 64、手機貼頂、格子自動欄數……⇒ 絕大部分量測不成立
          ok('★★★[HEAD-FAIL] v6.447 的樣式至少 10 / ' + CHECKS.length + ' 條量測不成立（量測真的量得到差別）', reds >= 10, reds + ' 條不成立：' + base.filter((c) => c.v).map((c) => '（仍成立）' + c.name).join(' ｜ '));
          ok('★★[HEAD-FAIL] 其中「桌機 M 760」「手機卡片 4 張一列」「手機貼底」三條在 v6.447 一定不成立',
            ['★★★[桌機 M] 一般選擇視窗 760 寬、置中、在畫面內', '★★★[手機直式] 卡片 4 張一列、卡圖不超出格子', '★★★[手機直式] 全寬、貼齊畫面下緣'].every((n) => base.find((c) => c.name === n && !c.v)));
        }
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.453 picker 實際量測: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6453-picker-measure ===');
process.exit(fail ? 1 : 0);
