// ⭐v6.497 守衛：手機版優化（站長清單 2026-10-06，順序 2 → 3 → 1 → 5 → 4 → 7）
//
// 【A】$lib/mobile-filters 純函式（已選項數、按鈕文字）
// 【B】/cards：手機篩選收合 —— 五組篩選全部在 {#if showFilters} 內；showFilters＝!窄螢幕 || 展開；按鈕只在窄螢幕渲染
// 【C】/decks 找卡區：同上（七列：分類／標籤／屬性／階段／賽季／常用／卡包）；賽季預設不算已選
// 【D】全站底部導覽列：<1024px 顯示、牌桌畫面（html[data-battle-view]）收起、頁面底部預留空間、五個連結＝NAV_ITEMS
// 【E】觸控目標（第 5 項）與卡名字級（第 4 項）只寫在手機區塊
// 【F】首頁功能卡手機改兩欄（第 7 項）
// 行為端（真瀏覽器 390×844）在開發時以建置後的網站實測：/cards 卡片從約 950px 提前到 236px、各頁 scrollWidth＝390、
//   底部導覽列在七個頁面都出現；本守衛釘住結構，避免日後改動靜默拿掉。
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' :: ' + (e && e.message)); } };
const rd = (p) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };

console.log('【A】純函式');
let MF = null;
try {
  const dir = mkdtempSync(join(tmpdir(), 'v6497-'));
  await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/mobile-filters.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'm.mjs'), logLevel: 'silent' });
  MF = await import(pathToFileURL(join(dir, 'm.mjs')).href);
} catch { /* HEAD：模組不存在 ⇒ 下面逐條紅 */ }
const F = (n) => (typeof MF?.[n] === 'function' ? MF[n] : () => { throw new Error(`${n} 不存在`); });
T('A1 已選項數＝各組 Set 大小相加＋布林條件', () => {
  assert.equal(F('countActiveFilters')([new Set([1, 2]), new Set(), new Set([3])], [true, false, true]), 5);
});
T('A2 按鈕文字：0 項只寫「篩選」、有選才寫項數；展開／收起箭頭', () => {
  assert.equal(F('filterToggleLabel')(0, false), '篩選 ▼');
  assert.equal(F('filterToggleLabel')(3, true), '篩選（已選 3 項） ▲');
});
T('A3 斷點與兩頁既有的手機 @media 一致（max-width: 600px）', () => assert.equal(MF?.MOBILE_FILTER_QUERY, 'max-width: 600px'));

// 取出 {#if showFilters} … {/if}<!-- v6497-mobile-filter-toggle --> 之間的標記
function foldedBlock(src) {
  const a = src.indexOf('{#if showFilters}');
  const b = src.indexOf('{/if}<!-- v6497-mobile-filter-toggle -->');
  return a > 0 && b > a ? src.slice(a, b) : '';
}

console.log('【B】/cards');
const CARDS = rd('src/routes/cards/+page.svelte');
const cb = foldedBlock(CARDS);
T('B1 五組篩選（分類／標籤／屬性／階段／賽季）全部在收合區塊內', () => {
  assert.ok(cb.length > 500 && cb.length < 6000, '收合區塊錨點失效：長度 ' + cb.length);
  for (const cls of ['class="filters"', 'filters tagFilters', 'filters typeFilters', 'filters stageFilters', 'filters markFilters']) {
    assert.ok(cb.includes(cls), '收合區塊裡找不到 ' + cls);
  }
  // 區塊外不可以還有篩選列（否則手機上收不起來）
  const outside = CARDS.replace(cb, '');
  assert.ok(!/<div class="filters/.test(outside), '收合區塊外還有篩選列');
});
T('B2 showFilters＝!窄螢幕 || 展開（桌機永遠展開）', () => {
  assert.match(CARDS, /const narrowView = new MediaQuery\(MOBILE_FILTER_QUERY, false\);/);
  assert.match(CARDS, /const showFilters = \$derived\(!narrowView\.current \|\| filtersOpen\);/);
});
T('B3 收合按鈕只在窄螢幕渲染、計數涵蓋五組', () => {
  assert.match(CARDS, /\{#if narrowView\.current\}\s*<button type="button" class="filterToggle"/);
  assert.match(CARDS, /countActiveFilters\(\[selectedCategories, selectedTags, selectedTypes, selectedStages, selectedRegMarks\]\)/);
});

console.log('【C】/decks 找卡區');
const DECKS = rd('src/routes/decks/+page.svelte');
const db = foldedBlock(DECKS);
T('C1 七列（分類～卡包）全部在收合區塊內，區塊外沒有篩選列', () => {
  assert.ok(db.length > 500 && db.length < 8000, '收合區塊錨點失效：長度 ' + db.length);
  assert.equal((db.match(/class="pk-chip-row"/g) || []).length, 7);
  assert.ok(db.includes('pk-set-select'), '卡包下拉要一起收');
  assert.ok(!/class="pk-chip-row"/.test(DECKS.replace(db, '')), '收合區塊外還有篩選列');
});
T('C2 showFilters 同一判準；按鈕只在窄螢幕', () => {
  assert.match(DECKS, /const showFilters = \$derived\(!narrowView\.current \|\| filtersOpen\);/);
  assert.match(DECKS, /\{#if narrowView\.current\}\s*<button type="button" class="pk-filter-toggle"/);
});
T('C3 賽季維持預設（全部容許的標）不算已選；常用與卡包算', () => {
  assert.match(DECKS, /return same \? new Set\(\) : selectedRegMarks;/);
  assert.match(DECKS, /\[favoritesOnly, setFilter !== ''\]/);
});
T('C4 本頁不新增 $effect／onMount（效能守衛的量測口徑）—— 收合用 MediaQuery，不是 effect', () => {
  const fold = /\/\/ >>> v6497-mobile-filter-fold\n([\s\S]*?)\/\/ <<< v6497-mobile-filter-fold/.exec(DECKS)?.[1] ?? '';
  assert.ok(fold.length > 100, '哨兵錨點失效');
  const code = fold.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\$effect|onMount|setTimeout|setInterval|fetch\(/.test(code));
});

console.log('【D】底部導覽列');
const NAV = rd('src/lib/SiteBottomNav.svelte');
const LAYOUT = rd('src/routes/+layout.svelte');
const THEME = rd('src/lib/site-theme.ts');
T('D1 layout 在頂端列同一個條件下掛底部導覽列（admin 不顯示）', () => {
  assert.match(LAYOUT, /\{#if topBarOn\}\n  <SiteTopBar[^\n]*\/>\n  <SiteBottomNav pathname=\{curPath\} \{base\} \/>\n\{\/if\}/);
});
const css = /<style>([\s\S]*?)<\/style>/.exec(NAV)?.[1] ?? '';
T('D2 只在 <1024px 顯示（網頁版有頂端列）', () => {
  assert.match(css, /^\s*\.sbn \{ display: none; \}/m);
  assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*?\.sbn \{\s*display: flex;/);
});
T('D3 牌桌畫面收起、且牌桌畫面不預留底部空間', () => {
  assert.match(css, /:global\(html\[data-battle-view\]\) \.sbn \{ display: none; \}/);
  assert.match(css, /:global\(html:not\(\[data-battle-view\]\) body\) \{ padding-bottom: calc\(56px \+ var\(--safe-bottom, 0px\)\); \}/);
  assert.match(css, /height: calc\(56px \+ var\(--safe-bottom, 0px\)\);/, '導覽列高度與預留空間要一致');
});
T('D4 連結與網頁版頂端列同一份 NAV_ITEMS（五個、順序相同）', () => {
  const navHrefs = [...THEME.matchAll(/\{ href: '([^']+)', label:/g)].map((m) => m[1]);
  const got = [...NAV.matchAll(/href="\{base\}([^"]+)"/g)].map((m) => m[1]);
  assert.equal(navHrefs.length, 5);
  assert.deepEqual(got, navHrefs);
});
T('D5 安全區讀全站唯一來源 --safe-bottom（不自己寫 env()）', () => {
  assert.ok(!/env\(safe-area/.test(css));
});

console.log('【E】觸控目標與字級（只在手機區塊）');
const v6439Block = /\/\* >>> v6439-cards-mobile \*\/([\s\S]*?)\/\* <<< v6439-cards-mobile \*\//.exec(CARDS)?.[1] ?? '';
T('E1 /cards：展開後篩選鈕至少 36px；卡號／卡名 12px 以上（都在 ≤600px 區塊）', () => {
  assert.match(v6439Block, /\.filter \{ min-height: 36px;/);
  assert.match(v6439Block, /\.cardLabel \{ font-size: 12\.5px;/);
  assert.match(v6439Block, /\.cardLabel \.num \{ font-size: 12px; \}/);
});
const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n  \}/.exec(DECKS)?.[1] ?? '';
T('E2 /decks：篩選鈕 36px、按鈕／輸入框 40px；排序鈕 36px、卡片小鈕 40px（觸控分支）', () => {
  assert.match(DECKS, /\.pk-chip \{ min-height: 36px; box-sizing: border-box; \}/);
  assert.match(DECKS, /\.to-board, \.auth-btn, button\.small, \.deck-title, \.pk-search, \.pk-set-select \{ min-height: 40px;/);
  assert.match(coarse, /\.deck-reorder-btn \{ min-width: 36px; min-height: 36px;/);
  assert.match(coarse, /button\.icon, \.picker-list li button\.icon \{ min-width: 40px; min-height: 40px; \}/);
});
const HOME = rd('src/routes/+page.svelte');
const home720 = /@media \(max-width: 720px\) \{([\s\S]*?)\n  \}/.exec(HOME)?.[1] ?? '';
T('E3 首頁：強制更新鈕 40px、行內連結放大可點範圍（版面不動）', () => {
  assert.match(home720, /\.hard-refresh-btn \{ min-height: 40px; \}/);
  assert.match(home720, /\.link-btn \{ padding: 10px 4px; margin: -10px -4px; \}/);
  assert.match(home720, /changelog-archive-link a\) \{ display: inline-block; padding: 10px 6px; margin: -10px -6px; \}/);
});

console.log('【F】首頁功能卡兩欄');
T('F1 手機（≤720px）功能卡兩欄小方塊；奇數張時最後一張橫跨兩欄', () => {
  assert.match(home720, /\.hm-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(home720, /\.hm-card:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1;/);
  // 原本的一欄規則被兩欄規則覆寫（排在後面）
  const i1 = home720.indexOf('.hm-grid { grid-template-columns: 1fr;');
  const i2 = home720.indexOf('.hm-grid { grid-template-columns: repeat(2');
  assert.ok(i1 >= 0 && i2 > i1, '兩欄規則必須排在原本的一欄規則之後');
});

console.log(`\n=== v6.497 手機版優化：${pass} PASS / ${fail} FAIL ===`);
if (fail) process.exit(1);
