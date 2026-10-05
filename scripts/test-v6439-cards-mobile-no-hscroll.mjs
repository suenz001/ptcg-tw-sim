#!/usr/bin/env node
/**
 * v6.439 守衛：手機版卡牌資料庫（/cards 卡包頁）不可以左右滑動、「一般搜尋」不可以超出畫面
 *
 * 站長回報（2026-09-29，iPhone 截圖）
 * ──────────────────────────────────────────────────────────────────────────
 *   「手機版的這個畫面可以左右滑動，而且一般搜尋的按鈕超出頁面了；
 *     其他手機版面都有把左右的滑動鎖住。」
 *
 * 真因（Playwright 實量，寬 320／375／390／430 都一樣）
 * ──────────────────────────────────────────────────────────────────────────
 *   整頁唯一超出視窗的元素就是搜尋列：`.modeSelect` 右緣固定落在 435px ⇒ scrollWidth 435。
 *     ・`.searchRow` 寫死 `min-width: 320px`（再加 .controls 左右 1rem padding）；
 *     ・`input[type='search']` 寫死 `min-width: 240px`；
 *     ・`<select>` 寬度＝最長選項，flex 子項自動最小寬度是 min-content ⇒ 縮不下來。
 *   修法比照牌組編輯器 v6.213（test-v6213-mobile-deck-editor）：手機分支補 `min-width: 0`、
 *   下拉給上限、會聚焦的控制項字級 16px（iOS 聚焦 <16px 會自動放大 ⇒ 放大後又能左右拖）。
 *
 * 這支守衛怎麼避免自己說謊
 * ──────────────────────────────────────────────────────────────────────────
 *   [A 靜態]     用中央 css-cascade 模擬器問「手機上實際勝出的是哪一條宣告」，不是只比字串
 *                （v6.389 踩過：規則寫在前面被同權重的舊規則蓋掉 ⇒ 死碼，字串比對照樣綠）。
 *                input[type='search'] 是屬性選擇器、模擬器不支援 ⇒ 改用「文件順序」逐條驗。
 *   [B 正對照]   把本版的 `>>> v6439-cards-mobile` 哨兵區塊剝掉之後，整檔必須逐位元等於 BASE
 *                ⇒ 桌機與其他頁面內容一個字元都沒動；並斷言「剝除後真的有變」（剝除器過期會靜默 no-op）。
 *   [C 行為端]   真瀏覽器：用本頁的完整 CSS ＋ 從 markup 抽出來的真實搜尋列（placeholder／選項字樣
 *                逐字取自原始碼），量 scrollWidth 與下拉右緣。
 *                ⭐ HEAD-FAIL：同一個夾具換成 BASE 的 CSS 必須量得到溢出 —— 量不到＝夾具本身是安慰劑。
 *
 * Run: node scripts/test-v6439-cards-mobile-no-hscroll.mjs
 */
import { V6464_CARDS_PAIRS, revertPairs } from './lib/revert-v6464-thumbs.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, cascade } from './lib/css-cascade.mjs';
import { cssOf } from './lib/svelte-style-block.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/cards/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8');

// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）。
//   驗法：`git branch -a --contains <sha>` 一定要印得出 main。
//   這顆是 v6.438 之後 main 上最新的 commit（IRON_RULES Rule 71 文件 commit，src/ 與 v6.438 相同）。
const BASE_SHA = '27917ebacc5f6969b1764caab2dcc03d91aaaf88';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); }
};

const M600 = '@media (max-width: 600px)';
const MOBILE = { media: [M600] };           // 手機情境：≤600px 的 @media 生效
const DESKTOP = { media: [] };              // 桌機情境：沒有任何 @media 生效
const ctxOf = (cls, ancestors, env) => ({ self: new Set(cls), ancestors: ancestors.map((a) => new Set(a)), media: env.media });

// ══════════════════════════════════════════════════════════════════════════
// 0. 前提與模擬器自我驗證
// ══════════════════════════════════════════════════════════════════════════
console.log('0) 前提');
const CSS = cssOf(SRC, REL);
ok('[前提] 抓得到 /cards 的樣式區塊', CSS.length > 15000, String(CSS.length));
const RULES = parseCss(CSS);
ok('[前提] 解析得出大量規則', RULES.length > 100, String(RULES.length));
{
  // 自我驗證：模擬器在桌機情境下必須讀得到「本來就有」的 min-width: 320px ——
  //   讀不到＝模擬器／選擇器對不上，後面所有斷言都會變成「找不到 ⇒ 綠」。
  const d = cascade(RULES, 'min-width', ctxOf(['searchRow'], [['controls']], DESKTOP));
  ok('[自我驗證] 桌機的 .searchRow 仍讀得到 min-width: 320px（模擬器有在工作）', !!d && d.value === '320px', JSON.stringify(d && d.value));
}

// ══════════════════════════════════════════════════════════════════════════
// A. 靜態：手機上實際勝出的宣告
// ══════════════════════════════════════════════════════════════════════════
console.log('\nA) 手機（≤600px）實際勝出的宣告');
{
  const row = cascade(RULES, 'min-width', ctxOf(['searchRow'], [['controls']], MOBILE));
  ok('★★★[HEAD-FAIL] 手機的 .searchRow 可以縮（min-width: 0；BASE 是寫死 320px）', !!row && row.value === '0', JSON.stringify(row && row.value));
  const sel = (p) => cascade(RULES, p, ctxOf(['modeSelect'], [['searchRow'], ['controls']], MOBILE));
  ok('★★★[HEAD-FAIL] 手機的「一般搜尋」下拉可以縮（min-width: 0）', (sel('min-width') || {}).value === '0', JSON.stringify(sel('min-width')));
  ok('★★[HEAD-FAIL] 手機的「一般搜尋」下拉有寬度上限（max-width: 40%）', (sel('max-width') || {}).value === '40%', JSON.stringify(sel('max-width')));
  ok('★★[HEAD-FAIL] 手機的「一般搜尋」下拉字級 16px（iOS 聚焦放大的門檻，須用 px）', (sel('font-size') || {}).value === '16px', JSON.stringify(sel('font-size')));
  // 正對照：桌機不受影響
  const dsel = cascade(RULES, 'font-size', ctxOf(['modeSelect'], [['searchRow'], ['controls']], DESKTOP));
  ok('[正對照] 桌機的下拉字級仍是 0.85rem', !!dsel && dsel.value === '0.85rem', JSON.stringify(dsel && dsel.value));
}
{
  // input[type='search'] 是屬性選擇器，cascade 模擬器刻意不支援（fail-closed）⇒ 改用文件順序逐條驗：
  //   同權重時後出現者勝，所以手機那條必須排在桌機那條之後，且宣告值正確。
  const inp = RULES.filter((r) => r.sel === "input[type='search']");
  const desk = inp.filter((r) => r.at.length === 0);
  const mob = inp.filter((r) => r.at.length === 1 && r.at[0] === M600 && r.decls['min-width']);
  const mobFont = RULES.filter((r) => r.at.length === 1 && r.at[0] === M600
    && r.sel.split(',').map((x) => x.trim()).includes("input[type='search']") && r.decls['font-size']);
  ok('[前提] 桌機的 input[type=\'search\'] 規則恰好一條，且是 min-width: 240px', desk.length === 1 && (desk[0].decls['min-width'] || {}).value === '240px',
    JSON.stringify(desk.map((r) => r.decls['min-width'])));
  ok('★★★[HEAD-FAIL] 手機分支有 input[type=\'search\'] { min-width: 0 }', mob.length === 1 && mob[0].decls['min-width'].value === '0',
    JSON.stringify(mob.map((r) => r.decls['min-width'])));
  ok('★★[順序] 手機那條排在桌機那條之後（排前面＝同權重被蓋掉、靜默失效）', mob.length === 1 && desk.length === 1 && mob[0].order > desk[0].order);
  ok('★★[HEAD-FAIL] 手機的搜尋輸入框字級 16px', mobFont.some((r) => r.decls['font-size'].value === '16px'),
    JSON.stringify(mobFont.map((r) => r.decls['font-size'])));
}

// ══════════════════════════════════════════════════════════════════════════
// B. 正對照：除了本版哨兵區塊，整檔逐位元等於 BASE
// ══════════════════════════════════════════════════════════════════════════
console.log('\nB) 桌機與其他內容逐字未動');
const STRIP_RE = /\n  \/\* >>> v6439-cards-mobile \*\/[\s\S]*?\/\* <<< v6439-cards-mobile \*\//;
// ⭐ LATER（IRON_RULES Rule 40：之後版本的合法改動逐字登記、逐字還原，鎖不變鬆）
//   v6.457：彈出視窗整頁捲動鎖（Rule 76）—— import 一行、兩個遮罩掛 use:pageScrollLock、.modalInner 加 overscroll-behavior:contain。
const LATER = [
  // ⭐v6.483（Rule 40）：搜尋／篩選條件寫進網址、卡片視窗加單卡頁連結與複製連結（import、狀態還原與寫回、連結列與其樣式）
  ["  import { replaceState } from '$app/navigation';\n  import { readCardsUrlState, writeCardsUrlSearch } from '$lib/cards/url-state';   // ⭐v6.483 搜尋／篩選條件寫進網址\n  import { cardPageHref } from '$lib/cards/card-page';   // ⭐v6.483 卡片視窗連到單卡頁\n", ""],
  ["\n  // ⭐v6.483 搜尋／篩選條件寫進網址（$lib/cards/url-state）：進頁時讀回一次，之後條件一變就（延遲 300ms）\n  //   用 replaceState 改網址 ⇒ 重新整理、按返回再回來、把網址傳給別人都會是同一組條件；不新增瀏覽紀錄。\n  //   ⚠ 只在卡片列表（data.mode==='set'）做；卡包列表頁（沒有 ?set=）不寫。\n  //   ⚠ 寫網址用 query（不是 debouncedQuery）：進頁還原的搜尋字要 150ms 後才進 debouncedQuery，用它會先把 q 洗掉。\n  let _urlRestored = false;\n  function restoreFromUrl() {\n    if (_urlRestored || data.mode !== 'set' || typeof location === 'undefined') return;\n    _urlRestored = true;\n    const st = readCardsUrlState(location.search, {\n      cat: CATEGORY_ORDER, tag: TAG_ORDER, type: ENERGY_ORDER, stage: STAGE_ORDER, mark: regMarkFilterKeys(),\n    });\n    query = st.q; debouncedQuery = st.q;\n    searchMode = st.mode; keywordScope = st.scope;\n    selectedCategories = new Set(st.cat as CategoryKey[]);\n    selectedTags = new Set(st.tag as TagKey[]);\n    selectedTypes = new Set(st.type as EnergyType[]);\n    selectedStages = new Set(st.stage as StageKey[]);\n    selectedRegMarks = new Set(st.mark as RegMarkKey[]);\n    if (st.card) { const c = setCards.find((x) => String(x.id) === st.card); if (c) selected = c; }\n  }\n  restoreFromUrl();\n  $effect(() => {\n    if (data.mode !== 'set') return;\n    const st = {\n      q: query, mode: searchMode, scope: keywordScope,\n      cat: [...selectedCategories], tag: [...selectedTags], type: [...selectedTypes],\n      stage: [...selectedStages], mark: [...selectedRegMarks], card: selected ? String(selected.id) : null,\n    };\n    const id = setTimeout(() => {\n      try {\n        const next = writeCardsUrlSearch(location.search, st);\n        if (next !== location.search) replaceState(location.pathname + next + location.hash, {});\n      } catch { /* 路由還沒準備好等情況：不寫網址，不影響畫面 */ }\n    }, 300);\n    return () => clearTimeout(id);\n  });\n  // ⭐v6.483 卡片視窗的「單卡頁」連結與複製連結\n  const selectedPageHref = $derived(selected ? cardPageHref(base, selected) : null);\n  let linkCopied = $state(false);\n  async function copyCardLink() {\n    const url = selectedPageHref ? location.origin + selectedPageHref : location.href;\n    try { await navigator.clipboard.writeText(url); linkCopied = true; setTimeout(() => { linkCopied = false; }, 1500); }\n    catch { linkCopied = false; }\n  }\n", ""],
  ["            <!-- ⭐v6.483 單卡頁連結＋複製連結（沒有單卡頁的卡：複製的是目前這個資料庫網址，開起來一樣會打開這張卡） -->\n            <p class=\"footLinks\">\n              {#if selectedPageHref}<a class=\"cardPageLink\" href={selectedPageHref}>📄 單卡頁</a>{/if}\n              <button type=\"button\" class=\"copyLinkBtn\" onclick={copyCardLink}>{linkCopied ? '✓ 已複製' : '🔗 複製連結'}</button>\n            </p>\n", ""],
  ["  /* ⭐v6.483 單卡頁連結＋複製連結 */\n  .footLinks { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.9rem; margin: 0.6rem 0 0; font-size: 0.95rem; }\n  .cardPageLink { font-weight: 700; color: #2563eb; text-decoration: none; }\n  .cardPageLink:hover { text-decoration: underline; }\n  .copyLinkBtn { padding: 0.3rem 0.8rem; border-radius: 999px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; font-size: 0.9rem; cursor: pointer; }\n", ""],
  // ⭐v6.481（Rule 40）：搜尋語法改呼叫共用實作 $lib/cards/search-query（import、編譯一次的 compiledQuery、filter 尾段、搜尋框 title）
  ["  import { compileCardQuery, cardSearchFields, SEARCH_SYNTAX_HINT } from '$lib/cards/search-query';   // ⭐v6.481 搜尋語法（兩頁共用）\n", ""],
  ["  // ⭐v6.481 搜尋字串只在改變時編譯一次（不是每張卡各編譯一次）\n  const compiledQuery = $derived(compileCardQuery(debouncedQuery));\n", ""],
  ["      // ⭐v6.481 搜尋語法（空白＝而且、|＝或、-＝排除、引號、/正規表示式/）：唯一實作在 $lib/cards/search-query.ts，\n      //   與牌組編輯器共用；只打一個詞時結果與改版前逐張相同（唯一例外：卡號改不分大小寫，只多不少；test-v6481 C1 用全部真實卡資料比對）。\n      return compiledQuery.test(cardSearchFields(c, searchMode, keywordScope));\n", "      // v2.184：兩種搜尋模式；v4.954：keyword 模式再細分 scope\n      if (searchMode === 'keyword') {\n        // v4.954：依 keywordScope 限定搜尋範圍\n        let haystack: string[];\n        if (keywordScope === 'attacks') {\n          // 只搜招式名 + 招式效果敘述\n          haystack = (c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']);\n        } else if (keywordScope === 'abilities') {\n          // 只搜特性 label（種類）+ 特性名 + 特性效果敘述\n          haystack = (c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']);\n        } else {\n          // 'all' — 全文搜尋：卡名 / 卡號 / 招式 / 特性 / rulesText / evolvesFrom（原行為）\n          haystack = [\n            c.name,\n            c.collectorNumber,\n            c.evolvesFrom ?? '',\n            c.rulesText ?? '',\n            ...(c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']),\n            ...(c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']),\n          ];\n        }\n        return haystack.some(s => s && s.toLowerCase().includes(q));\n      }\n      // normal 模式（原行為）：只搜卡名 / 卡號 / 招式名 / 特性名\n      return (\n        c.name.toLowerCase().includes(q) ||\n        c.collectorNumber.includes(q) ||\n        (c.attacks ?? []).some((a) => a.name.toLowerCase().includes(q)) ||\n        (c.abilities ?? []).some((a) => a.name.toLowerCase().includes(q))\n      );\n"],
  ["        title={SEARCH_SYNTAX_HINT}\n", ""],
  // ⭐v6.480（Rule 40）：網頁版迷你搜尋列（元件在 $lib/cards/CardsMiniBar.svelte，手機不顯示）——import、狀態、bind:this、元件一行
  ["  import CardsMiniBar from '$lib/cards/CardsMiniBar.svelte';   // ⭐v6.480 網頁版：篩選面板捲出畫面後浮出迷你搜尋列\n", ""],
  ["  let controlsEl = $state<HTMLElement | null>(null);   // ⭐v6.480 迷你搜尋列用來判斷篩選面板是否捲出畫面\n", ""],
  ["<div class=\"controls\" bind:this={controlsEl}>", "<div class=\"controls\">"],
  ["  <CardsMiniBar bind:query count={filtered.length} target={controlsEl} placeholder=\"搜尋卡名、招式名、特性名、卡號（與上方搜尋框同步）\" />\n", ""],
  ["  import { pageScrollLock } from '$lib/page-scroll-lock'; // ⭐v6.457 彈出視窗開著時手機不捲到背景（中央）\n", ''],
  ['<div use:pageScrollLock class="modal" role="dialog"', '<div class="modal" role="dialog"'],
  ['      class="lightboxOverlay" use:pageScrollLock\n', '      class="lightboxOverlay"\n'],
  ['    overscroll-behavior: contain; /* ⭐v6.457 捲到底不把整頁帶走（桌機滾輪／手機手指都是） */\n', ''],
  // ⭐v6.468 全站 audit：發售日灰字調深、「← 首頁」可點範圍放大（版面不動）——difflib 產生、逐位元還原 v6.467
  ["    font-size: 0.72rem;\n    color: #6b7280;   /* ⭐v6.468 #9ca3af 對白底對比 2.5，小字看不清 */\n    font-variant-numeric: tabular-nums;\n", "    font-size: 0.72rem;\n    color: #9ca3af;\n    font-variant-numeric: tabular-nums;\n"],
  ["\n  /* ⭐v6.468（全站 audit）：「← 首頁」只有 16～21px 高，手機上很難點。用 padding＋等量負 margin 放大可點範圍，\n     版面位置一點都不動（純文字連結、沒有底色或框線 ⇒ 桌機看起來也完全一樣）。\n     ⚠ 刻意不包 @media：本頁的 @media 數量有守衛在釘（手機／桌機不靠斷點切版），而這條在桌機也無害。 */\n  .back { display: inline-block; padding: 10px 8px; margin: -10px -8px; }\n</style>", "</style>"],
];
// ⭐v6.464（Rule 40）：本版把資料庫格子的卡圖改用縮圖（src={cardThumb(…)}＋import），先用共用還原表還原成 v6.463 再剝哨兵；其餘仍須逐位元等於 BASE。
let stripped = revertPairs(SRC.replace(/\r\n/g, '\n'), V6464_CARDS_PAIRS).replace(STRIP_RE, '');
// ⭐v6.475（Rule 40）：網頁版主題＋版面整塊包在 v6475-desktop-theme 哨兵裡（全部在 min-width:1024px 內，手機不變）
//   ⇒ 整塊拿掉即逐位元還原 v6.474；內容由 test-v6475-theme-pages 鎖。哨兵必須恰好一塊（被刪＝剝除器靜默 no-op ⇒ 紅）。
{
  const RE6475 = /\n  \/\* >>> v6475-desktop-theme \*\/[\s\S]*?\/\* <<< v6475-desktop-theme \*\//g;
  const n6475 = (stripped.match(RE6475) || []).length;
  ok('[LATER 前提] v6.475 網頁版主題哨兵恰好一塊', n6475 === 1, 'n=' + n6475);
  stripped = stripped.replace(RE6475, '');
}
for (const [a, b] of LATER) {
  const n = stripped.split(a).length - 1;
  ok('[LATER 前提] 登記的後續改動恰好出現一次：' + a.trim().slice(0, 50), n === 1, 'n=' + n);
  stripped = stripped.replace(a, b);
}
ok('[剝除器] 找得到 v6439 哨兵區塊（剝除後真的有變；哨兵被刪＝剝除器靜默 no-op）', stripped !== SRC);
ok('[剝除器] 哨兵區塊恰好一個', (SRC.match(/>>> v6439-cards-mobile/g) || []).length === 1 && (SRC.match(/<<< v6439-cards-mobile/g) || []).length === 1);
let BASE_SRC = null;
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6439 B：剝除哨兵後與 BASE 逐位元比對', '需要 BASE commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 BASE 的 /cards 頁', r.ok && r.out.length > 40000, String(r.ok));
  if (r.ok) {
    // ⚠ 與 CRLF／LF 無關：兩邊都以 LF 比（工作樹在 Windows 可能是 CRLF）。
    const norm = (s) => s.replace(/\r\n/g, '\n');
    BASE_SRC = norm(r.out);
    ok('★★★[正對照] 剝掉 v6439 哨兵區塊後，/cards 頁與 BASE 逐位元相同（桌機一個字元都沒動）', norm(stripped) === BASE_SRC);
    ok('★★★[HEAD-FAIL] BASE 上沒有這個修正（BASE 就是回報的那一版）', !BASE_SRC.includes('v6439-cards-mobile'));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// C. 行為端：真瀏覽器量 scrollWidth（含 BASE 的 HEAD-FAIL 對照）
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC) 行為端：真瀏覽器量 scrollWidth');
/** 從 markup 逐字抽出真實的搜尋列（placeholder 取「一般」那句、所有 <option> 原文） */
function fixtureOf(src) {
  const m = /<div class="searchRow">([\s\S]*?)<\/select>\s*<\/div>/.exec(src);
  if (!m) return null;
  const ph = /\? '([^']+)'/.exec(m[1]);
  const opts = [...m[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((x) => [x[1], x[2]]);
  if (!ph || opts.length < 4) return null;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return '<header><a class="back" href="#">← 卡包列表</a><h1>ALL<span class="setTitleName">全部 H / I / J 卡牌</span></h1>'
    + '<p class="meta">共 5222 張卡 · 顯示 6 張</p></header>'
    + '<div class="controls"><div class="searchRow">'
    + `<input type="search" placeholder="${esc(ph[1])}" value="回轉" aria-label="搜尋">`
    + '<select class="modeSelect" aria-label="搜尋模式">'
    + opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')
    + '</select></div></div>';
}
const FIX = fixtureOf(SRC);
ok('[前提] 從 markup 抽得出搜尋列（placeholder＋全部選項）', !!FIX, FIX ? FIX.length : 'null');
const chromium = pwChromium('v6.439 【C】/cards 手機橫向溢出量測');
if (chromium && FIX) {
  const browser = await pwLaunchWith(chromium, 'v6.439 【C】/cards 手機橫向溢出量測');
  if (browser) {
    try {
      const measure = async (css, w) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });
        const pg = await ctx.newPage();
        await pg.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">'
          + '<style>body{margin:0;background:#f4f4f6}</style><style>' + css + '</style></head><body>' + FIX + '</body></html>');
        const r = await pg.evaluate(() => ({
          inner: window.innerWidth,
          sw: document.documentElement.scrollWidth,
          selRight: document.querySelector('.modeSelect').getBoundingClientRect().right,
          inpW: document.querySelector('input[type=search]').getBoundingClientRect().width,
        }));
        await ctx.close();
        // ⚠ isMobile 的 layout viewport 會被過寬的內容撐大（BASE 實測 innerWidth 變成 435）⇒
        //   一律拿「設定的裝置寬 w」比，不可以拿 innerWidth 比（那樣 BASE 也會綠＝安慰劑）。
        return { w, ...r };
      };
      for (const w of [320, 375, 390, 430]) {
        const r = await measure(CSS, w);
        ok(`★★★[HEAD-FAIL／核心] 寬 ${w}：整頁不可以左右滑動（scrollWidth ≤ 視窗寬）`, r.sw <= r.w && r.inner === r.w, JSON.stringify(r));
        ok(`★★★[HEAD-FAIL／核心] 寬 ${w}：「一般搜尋」下拉完整在畫面內`, r.selRight <= r.w + 0.5, JSON.stringify(r));
        ok(`★[可用性] 寬 ${w}：搜尋輸入框仍有可用寬度（≥ 140px）`, r.inpW >= 140, JSON.stringify(r));
      }
      // 桌機正對照：1280 寬時搜尋列版面照舊（輸入框仍吃 240px 以上）
      const dsk = await measure(CSS, 1280);
      ok('[正對照] 桌機 1280 寬：不溢出、輸入框 ≥ 240px', dsk.sw <= dsk.w && dsk.inpW >= 240, JSON.stringify(dsk));
      // ⭐ 反安慰劑：同一個夾具換成 BASE 的 CSS，必須量得到溢出 —— 否則夾具根本重現不了 bug
      if (BASE_SRC) {
        const b = await measure(cssOf(BASE_SRC, 'BASE ' + REL), 390);
        ok('★★★[反安慰劑] 同一個夾具套 BASE 的 CSS，在寬 390 必定溢出（夾具確實重現得了站長回報的 bug）',
          b.sw > b.w && b.selRight > b.w, JSON.stringify(b));
      } else {
        shallowSkip('v6439 C：BASE CSS 反安慰劑對照', '需要 BASE commit');
      }
    } finally {
      await browser.close();
    }
  }
}

console.log(`\n=== v6.439 /cards 手機不可左右滑動: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6439-cards-mobile-no-hscroll ===');
process.exit(fail ? 1 : 0);
