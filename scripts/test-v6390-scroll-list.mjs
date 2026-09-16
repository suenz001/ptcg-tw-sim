#!/usr/bin/env node
/**
 * v6.390 守衛：可捲清單收斂到中央 utility（站長交辦「順手收斂」）
 *
 * ⚠ 這一版的風險**不是**「改錯高度」，而是 v6.389 剛踩過的那個：
 *   個別規則排在群組規則之後、同特異度 ⇒ 個別規則裡只要還留著 max-height／overflow-y，
 *   群組規則就**整條變成死碼**，而「字串存在」型的守衛會全綠。
 *   ⇒ 本守衛用 scripts/lib/css-cascade.mjs 真的跑一次 CSS 串接，斷言
 *     「**實際勝出的那條宣告來自群組規則**」（比 fullSel，不是比片段）。
 *
 * 【0】fixture：解析器活著、選擇器白名單 fail-closed
 * 【A】字串契約：群組規則的選擇器清單與四件套
 * 【B】⭐⭐ 行為層：13 個情境的 computed max-height／overflow-y／來源規則
 * 【C】⭐⭐⭐ HEAD-FAIL：對 BASE(v6.389a) 的 +page.svelte 跑同一組，必須大量翻紅
 * 【D】在 npm test chain 裡
 *
 * ⚠ 誠實聲明：沒有瀏覽器，所以這支守衛驗的是「串接算出來是哪一條」，
 *   不是「畫在螢幕上長什麼樣」。捲動手感（touch-action／overscroll-behavior 的實際效果）
 *   只能靠站長在測試站手機上看。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, cascade, cascadeEffective, matchOne, styleBlockOf } from './lib/css-cascade.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46：禁 pathname.slice
const SELF = 'scripts/test-v6390-scroll-list.mjs';
const PAGE = 'src/routes/game/+page.svelte';
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：
//   驗法 `git branch -a --contains b520b922` 要印得出 main。
const BASE_SHA = 'b520b92216b5cfbb577cc7eee2a25f340056b0ec';   // v6.389a（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

const SRC = readFileSync(join(ROOT, PAGE), 'utf8');

// ── 常數 ────────────────────────────────────────────────────────────────────
const LISTS = ['mlog-list', 'reorder-deck-wrap', 'copy-attack-list', 'sel-grid', 'full-deck-list', 'rocket-command-scroll', 'retreat-grid'];
const GROUP_SEL = '.scroll-list, ' + LISTS.map((c) => '.' + c).join(', ');
const MEDIA_P = '@media (max-width: 600px) and (orientation: portrait)';
const MEDIA_L = '@media (max-width: 950px) and (orientation: landscape)';
const VAR_MH = 'var(--scroll-list-max, 60vh)';
// ⭐ fail-closed 白名單：**所有**「最右複合選擇器含到這 8 個 class」的規則。
//   新增／刪除任何一條都會讓 F3 翻紅，逼人回來重新想串接，而不是默默多一條蓋掉群組規則。
const EXPECTED = [
  '|.mlog-list',
  '|.reorder-deck-wrap',
  '|' + GROUP_SEL,
  '|.copy-attack-list',
  '|.sel-grid',                       // 17319：早期那條 display:flex（已被 18009 的 display:grid 蓋掉，無 max-height）
  '|.sel-grid',                       // 18009：本體
  '|.full-deck-list',
  '|.rocket-command-scroll',
  '|.sel-grid.sel-grid-energy',
  '|.retreat-grid',
  '|.discard-modal .sel-grid',
  '|.prize-view-modal .sel-grid',
  MEDIA_P + '|.retreat-grid',
  MEDIA_P + '|.sel-grid',
  MEDIA_P + '|.sel-grid.sel-grid-energy',
  MEDIA_L + '|.sel-grid',
];

// ═══════════════════════════════════════════════════════════════════════════
console.log('【0】fixture');
// ═══════════════════════════════════════════════════════════════════════════
const sb = styleBlockOf(SRC);
chk('F0 抓得到 <style> 區塊', !!sb && sb.css.length > 100000, String(sb ? sb.css.length : -1));
const RULES = parseCss(sb.css);
// ⚠⚠ 這個門檻原本寫 3000，是**安慰劑**（v6.391 審查者 🔴-2）：當時 styleBlockOf 用 indexOf
//   ⇒ 切到 `{@html '…'}` 那個假標籤 ⇒ 把 4,900 行 markup 當 CSS 解析出 3,668 條垃圾規則，
//   門檻靠垃圾才過得了。lastIndexOf 修好之後真 CSS 只有約 1,637 條（v6.391 現查，Rule 46）。
chk('F0b 解析出大量規則（解析器沒有在第一個 } 就停）', RULES.length > 1400, String(RULES.length));
chk('F0b2 ⭐⭐ 切出來的是真的樣式區塊（沒有把 markup 當 CSS）',
  !sb.css.includes('<div') && !sb.css.includes('onclick=') && sb.css.includes('.tourn-tabs'),
  String(RULES.length));
// ★ 哨兵：解析器真的在讀這份 CSS（不是回傳固定結果）
//   ⚠ 不可以用 GROUP_SEL 去 replace 原始 css —— 原始檔是**逐行**寫的，
//     GROUP_SEL 是 parseCss 正規化（\s+→單一空格）之後的樣子，replace 會靜默不命中 ⇒ 哨兵變恆真。
chk('F0c ★ 哨兵：把群組規則的第一個選擇器改名之後，解析結果就找不到它了',
  parseCss(sb.css.replace('.scroll-list,', '.__nope__,')).filter((r) => r.sel === GROUP_SEL).length === 0
  && RULES.filter((r) => r.sel === GROUP_SEL).length === 1);

// F1：所有「最右含目標 class」的選擇器都必須是本模擬器支援的形態（fail-closed）
{
  const re = new RegExp('\\.(?:scroll-list|' + LISTS.join('|') + ')(?![\\w-])');
  const rightmostHits = [];
  const unsupported = [];
  // ⚠ 一條規則只登記一次（群組規則有 8 個片段，逐片段 push 會變成 8 筆）；
  //   也**不可以**去重 —— 去重的話「多補一條一模一樣的 .sel-grid{max-height:99vh}」
  //   （v6.389 死規則的成因）就會被 Set 吃掉、F2 永遠綠（突變測試 M8 抓到）。
  for (const r of RULES) {
    const hit = r.sel.split(',').map((x) => x.trim()).filter((t) => {
      const toks = t.replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/).filter(Boolean);
      return re.test(toks[toks.length - 1]);               // 最右含目標 class ⇒ 會影響這些元素
    });
    if (!hit.length) continue;
    rightmostHits.push((r.at.join(' ') || '') + '|' + r.sel);
    // ⚠ 探測用的 self **必須**帶上最右複合選擇器的 class（v6.391 審查者 🟡-3）：
    //   matchOne 在「最右不 match」時就提早回 -1，祖先端的不支援形態（element／邏輯偽類）
    //   根本走不到那幾個 null 檢查 ⇒ fail-open，F1 永遠綠。
    for (const t of hit) {
      const rightmost = t.replace(/\s*[>+~]\s*/g, ' ').split(/\s+/).pop();
      const selfClasses = new Set((rightmost.match(/\.[\w-]+/g) || []).map((x) => x.slice(1)));
      if (matchOne(t, { self: selfClasses, ancestors: [], media: [] }) === null) unsupported.push(t);
    }
  }
  chk('F1 ⭐ 沒有一條規則用到本模擬器不支援的選擇器形態（fail-closed）',
    unsupported.length === 0, JSON.stringify(unsupported));
  const got = rightmostHits.slice().sort();
  const want = EXPECTED.slice().sort();
  chk('F2 ⭐⭐ 影響這 8 個 class 的規則集合就是白名單那一份（多一條少一條都要回來重想串接）',
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify({ 多出來: got.filter((x) => !want.includes(x)), 少掉了: want.filter((x) => !got.includes(x)) }));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】字串契約：群組規則本身');
// ═══════════════════════════════════════════════════════════════════════════
const group = RULES.filter((r) => r.sel === GROUP_SEL);
chk('A1 ⭐ 群組規則**恰好一條**，選擇器就是 .scroll-list ＋ 那 7 個清單 class', group.length === 1, String(group.length));
if (group.length === 1) {
  const d = group[0].decls;
  for (const [p, v] of [
    ['min-height', '0'],
    ['overflow-y', 'auto'],
    ['overscroll-behavior', 'contain'],
    ['-webkit-overflow-scrolling', 'touch'],
    ['touch-action', 'pan-y pinch-zoom'],   // ⭐v6.391 審查者 🟡-1：補回 pinch-zoom（卡圖清單不能失去雙指縮放）
    ['max-height', VAR_MH],
  ]) chk('A2 群組規則有 ' + p + ':' + v, d[p]?.value === v, JSON.stringify(d[p] ?? null));
  // ⚠ decls 存的是**值**（'60vh'），不是 'max-height:60vh' —— 早一版寫成比對含屬性名的字串，
  //   結果這條永遠綠（突變測試 M3 抓到）。正面表列才守得住。
  chk('A2b ⭐ 群組規則自己不可以寫死高度（高度只能來自 --scroll-list-max）',
    /^var\(\s*--scroll-list-max\b/.test(group[0].decls['max-height']?.value ?? ''),
    JSON.stringify(group[0].decls['max-height'] ?? null));
}

// A3 ⭐ 這 7 個 class 的「單一 class 規則」不得再自己寫 max-height／overflow
// ⚠ 只看**頂層**的單一 class 規則。@media 內的覆寫是刻意的（v5.299 的 .retreat-grid !important），
//   而且 media 覆寫多一條少一條由 F2 白名單守、實際勝負由【B】的串接守。
for (const c of LISTS) {
  const own = RULES.filter((r) => r.sel === '.' + c && r.at.length === 0);
  chk('A3z .' + c + ' 確實有頂層個別規則可檢查（不是因為找不到所以空過）', own.length >= 1, String(own.length));
  const bad = own.filter((r) => r.decls['max-height'] || r.decls['overflow-y'] || r.decls['overflow']);
  chk('A3 .' + c + ' 的頂層個別規則沒有自己寫 max-height／overflow（寫了就會把群組規則蓋成死碼）',
    bad.length === 0, JSON.stringify(bad.map((r) => r.decls)));
}

// A4 ⭐ 「現查數字」制度化：註解宣稱的遷移後條數，必須等於守衛當場數出來的
{
  const n = RULES.filter((r) => /auto/.test(r.decls['overflow-y']?.value ?? '') && r.decls['max-height']).length;
  const claimed = Number((SRC.match(/那 18 條會剩 \*\*(\d+) 條\*\*/) || [])[1]);
  chk('A4 ⭐⭐ 註解宣稱的「遷移後剩 N 條」＝守衛當場數出來的條數（Rule 46 制度化）',
    Number.isFinite(claimed) && claimed === n, JSON.stringify({ 註解: claimed, 現查: n }));
  const inLists = RULES.filter((r) => /auto/.test(r.decls['overflow-y']?.value ?? '') && r.decls['max-height'])
    .filter((r) => r.sel !== GROUP_SEL && LISTS.some((c) => r.sel === '.' + c));
  chk('A4b ⭐ 那 N 條裡**沒有一條**屬於被遷移的 7 個清單 class', inLists.length === 0,
    JSON.stringify(inLists.map((r) => r.sel)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 行為層：真的跑一次 CSS 串接，看「誰贏了」');
// ═══════════════════════════════════════════════════════════════════════════
const ctxOf = (self, ancestors = [], media = []) => ({
  self: new Set(self), ancestors: ancestors.map((a) => new Set(a)), media,
});

/**
 * 回傳 {mh, oy, cv, mn, resolved, unsupported}。
 * ⚠ 一律走 cascadeEffective（簡寫也算進來，原本手寫的 overflow vs overflow-y 合併搬進 lib 了）
 *   ＋ 收集 onUnsupported —— v6.391 審查者 🟡-3／🟡-4：原本直接用 cascade，遇到模擬器
 *   不支援的選擇器會**靜默忽略**，那條規則若在瀏覽器裡會贏，守衛就給出假綠。
 */
function computeFor(rules, ctx) {
  const uns = [];
  // ⚠ 只收「**最右**複合選擇器的 class 全都在 ctx.self 裡」的不支援 ——
  //   整份 CSS 有一大堆 `.bench-slot img{max-height:…}`／`:global(…)` 也帶著我們查的屬性，
  //   它們的最右根本不可能 match 這幾個清單元素，全收會讓這條斷言變成「永遠紅」。
  const on = (r, sel) => {
    const rightmost = sel.replace(/\s*[>+~]\s*/g, ' ').split(/\s+/).filter(Boolean).pop() || '';
    const cls = (rightmost.match(/\.[\w-]+/g) || []).map((x) => x.slice(1));
    if (!cls.length || !cls.every((c) => ctx.self.has(c))) return;
    uns.push(sel + ' @' + (r.at.join(' ') || 'top'));
  };
  const mh = cascadeEffective(rules, 'max-height', ctx, on);
  const oy = cascadeEffective(rules, 'overflow-y', ctx, on);
  const cv = cascadeEffective(rules, '--scroll-list-max', ctx, on);
  const mn = cascadeEffective(rules, 'min-height', ctx, on);
  return {
    mh, oy, cv, mn, unsupported: [...new Set(uns)],
    resolved: mh?.value === VAR_MH ? (cv?.value ?? '60vh') : (mh?.value ?? null),
  };
}

// [名稱, ctx, 期望高度, 期望 max-height 來源 fullSel, 期望 overflow-y]
const SEL_MODAL = ['selection-modal'];
const SCENES = [
  ['B1 .mlog-list（桌機）', ctxOf(['mlog-list']), '62vh', GROUP_SEL, 'auto'],
  ['B2 .reorder-deck-wrap', ctxOf(['reorder-deck-wrap']), '60vh', GROUP_SEL, 'auto'],
  ['B3 .copy-attack-list（招式 picker）', ctxOf(['copy-attack-list']), '60vh', GROUP_SEL, 'auto'],
  ['B4 .sel-grid（一般選擇 modal，桌機）', ctxOf(['sel-grid'], [SEL_MODAL]), '52vh', GROUP_SEL, 'auto'],
  ['B5 .full-deck-list', ctxOf(['full-deck-list']), '60vh', GROUP_SEL, 'auto'],
  ['B6 .rocket-command-scroll（火箭隊指令 picker）', ctxOf(['rocket-command-scroll']), '60vh', GROUP_SEL, 'auto'],
  ['B7 .retreat-grid（桌機）', ctxOf(['retreat-grid']), '58vh', GROUP_SEL, 'auto'],
  ['B8 .discard-modal .sel-grid（棄牌區，桌機）', ctxOf(['sel-grid'], [['discard-modal']]), '72vh', GROUP_SEL, 'auto'],
  ['B9 .sel-grid（手機直式）', ctxOf(['sel-grid'], [SEL_MODAL], [MEDIA_P]), '50vh', GROUP_SEL, 'auto'],
  ['B10 .sel-grid（橫式窄螢幕）', ctxOf(['sel-grid'], [SEL_MODAL], [MEDIA_L]), '46vh', GROUP_SEL, 'auto'],
  // ⭐ 現況登記：手機直式下棄牌區仍是 72vh（.discard-modal .sel-grid 特異度 (0,2,0) 贏過 media 的 (0,1,0)）
  ['B11 .discard-modal .sel-grid（手機直式仍是 72vh，特異度勝）', ctxOf(['sel-grid'], [['discard-modal']], [MEDIA_P]), '72vh', GROUP_SEL, 'auto'],
];
for (const [name, ctx, wantH, wantFrom, wantOy] of SCENES) {
  const r = computeFor(RULES, ctx);
  chk(name + ' → ⭐ 沒有任何相關規則是模擬器不支援的形態（fail-closed）', r.unsupported.length === 0, JSON.stringify(r.unsupported));
  chk(name + ' → max-height 解析為 ' + wantH, r.resolved === wantH, JSON.stringify({ got: r.resolved, mh: r.mh?.value }));
  chk(name + ' → ⭐ 勝出的 max-height 來自**群組規則**（不是個別規則，否則群組是死碼）',
    r.mh?.fullSel === wantFrom && r.mh?.value === VAR_MH, JSON.stringify({ from: r.mh?.fullSel, value: r.mh?.value }));
  chk(name + ' → overflow-y 勝出值 ' + wantOy + ' 且來自群組規則',
    r.oy?.value === wantOy && r.oy?.fullSel === wantFrom, JSON.stringify({ v: r.oy?.value, from: r.oy?.fullSel }));
}

// B12／B13：兩條刻意保留不動的高特異度覆寫，**必須仍然贏**
{
  const r = computeFor(RULES, ctxOf(['sel-grid'], [['prize-view-modal']]));
  chk('B12 ⭐ .prize-view-modal .sel-grid 仍然是 max-height:none（不捲、不限高）',
    r.mh?.value === 'none' && r.mh?.fullSel === '.prize-view-modal .sel-grid', JSON.stringify({ v: r.mh?.value, from: r.mh?.fullSel }));
  chk('B12b ⭐ 且 overflow 仍被覆寫成 visible（群組的 overflow-y:auto 不可以贏）',
    r.oy?.value === 'visible', JSON.stringify(r.oy));
  // ⭐v6.391 審查者 🔴-1：min-height 是 v6.390 新加的屬性，覆寫如果只蓋 max-height／overflow，
  //   min-height 就會留在群組規則的 0 ⇒ 這個「刻意不捲」的元素會被 flex 壓縮、內容溢出。
  chk('B12c ⭐⭐ 且 min-height 必須是 auto（不可以留在群組規則的 0）',
    r.mn?.value === 'auto', JSON.stringify(r.mn));
}
{
  const r = computeFor(RULES, ctxOf(['retreat-grid'], [], [MEDIA_P]));
  chk('B13 ⭐ 手機直式的 .retreat-grid 仍然是 max-height:none !important（v5.299 解雙層滑捲衝突）',
    r.mh?.value === 'none' && r.mh?.important === true, JSON.stringify(r.mh));
  chk('B13b ⭐ 且 overflow-y 仍是 visible !important', r.oy?.value === 'visible' && r.oy?.important === true, JSON.stringify(r.oy));
  // ⭐⭐v6.391 審查者 🔴-1：.retreat-grid 在手機直式是 .selection-modal（display:flex; column）的
  //   **直接子元素**（現查 markup 12567／12628／14136／14141）＝ flex item。
  //   flex item 的 min-height:auto ＝ min-content ⇒ 不會被壓縮，內容撐高由外層 modal 去捲
  //   （v5.299＋v6.122 的設計）。留在群組規則的 0 就會被壓縮、內容溢出蓋到 sticky 的 .sel-footer
  //   ＝ v5.299 修掉的那個玩家回報會回來。
  chk('B13c ⭐⭐ 且 min-height 必須是 auto !important（v5.299 的雙層滑捲設計）',
    r.mn?.value === 'auto' && r.mn?.important === true, JSON.stringify(r.mn));
}

// B14：觸控四件套真的套到每一個清單上（不是只寫在群組規則裡沒人吃到）
for (const c of LISTS) {
  const ctx = ctxOf([c]);
  const got = {};
  for (const p of ['min-height', 'overscroll-behavior', '-webkit-overflow-scrolling', 'touch-action']) {
    const w = cascadeEffective(RULES, p, ctx);
    got[p] = w ? w.value + '@' + (w.fullSel === GROUP_SEL ? 'group' : w.fullSel) : null;
  }
  chk('B14 .' + c + ' 吃到完整的觸控四件套（且都來自群組規則）',
    got['min-height'] === '0@group' && got['overscroll-behavior'] === 'contain@group'
    && got['-webkit-overflow-scrolling'] === 'touch@group' && got['touch-action'] === 'pan-y pinch-zoom@group',
    JSON.stringify(got));
}

// ⭐v6.391 審查者 🟡-12：`.copy-attack-list rocket-command-scroll` 是**同時掛兩個**被遷移 class
//   的真實 DOM（現查 markup 13858／13867）。兩邊都設 --scroll-list-max ⇒ 這是一場同特異度的
//   順序競賽，值一旦被調成不同就會有一個是死的，而單一 class 的情境測不出來。
{
  const r = computeFor(RULES, ctxOf(['copy-attack-list', 'rocket-command-scroll']));
  chk('B15 ⭐ 同時掛 copy-attack-list ＋ rocket-command-scroll 的清單：仍是 60vh、來源仍是群組規則',
    r.resolved === '60vh' && r.mh?.fullSel === GROUP_SEL && r.oy?.value === 'auto',
    JSON.stringify({ h: r.resolved, from: r.mh?.fullSel, oy: r.oy?.value }));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】⭐⭐ IRON_RULES Rule 48：註解裡不可以有樣式標籤的開頭字面');
// ═══════════════════════════════════════════════════════════════════════════
// v6.390 第一版在 CSS 註解裡寫了一次那個字面，7 支守衛同時翻紅（訊息全是「抽不到 CSS 規則」）。
// 真因：那些守衛取樣式區塊用的是 lastIndexOf ⇒ 註解裡的字面把區塊起點往後推。
{
  const TAG = '<' + 'style';   // ⚠ 本檔自己也不寫出完整字面（雖然 .mjs 不受影響，但別養壞習慣）
  const last = SRC.lastIndexOf(TAG);
  const block = SRC.slice(last);
  chk('G1 ⭐⭐ Rule 48：lastIndexOf 取到的就是真正的樣式區塊',
    block.startsWith(TAG + '>') && block.includes('.tourn-tabs {') && block.includes('</' + 'style>'),
    JSON.stringify(SRC.slice(last, last + 50)));
  // ★ 正對照：人工在**真標籤之後**的 CSS 註解裡塞一個字面 ⇒ G1 的判準必須跟著壞掉，
  //   否則 G1 是恆真式（這正是 7 支守衛翻紅時的實際情形）。
  const poisoned = SRC.replace('.copy-attack-modal{', '/* ' + TAG + '> */ .copy-attack-modal{');
  chk('G1b ★ 正對照：註解裡塞一個開頭字面 ⇒ 區塊起點就會被推走（.tourn-tabs 抽不到）',
    poisoned !== SRC && !poisoned.slice(poisoned.lastIndexOf(TAG)).includes('.tourn-tabs {'));
}
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐⭐ HEAD-FAIL：BASE(v6.389a) 必須大量翻紅');
// ═══════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6.390【C】HEAD-FAIL', '需要歷史 commit');
} else {
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE);
  if (!b.ok) chk('C1 讀得到 BASE 的 +page.svelte', false, 'readBaseBlob 失敗');
  else {
    // ★ 哨兵：BASE 真的是活的檔案（不是空字串讓下面恆真）
    chk('C0 ★ 哨兵：BASE 的 +page.svelte 是活的（有 .scroll-list 與 .sel-grid）',
      b.out.length > 100000 && b.out.includes('.scroll-list{') && b.out.includes('.sel-grid{'), String(b.out.length));
    const bsb = styleBlockOf(b.out);
    const BR = parseCss(bsb.css);
    chk('C1 BASE 沒有本版的群組規則', BR.filter((r) => r.sel === GROUP_SEL).length === 0);
    // ⚠ v6.391 審查者 🟡-6：原本把「高度紅」與「來源紅」加在一起比 `reds >= 11`，
    //   而 C1 一旦成立，「來源紅」對 11 個情境**必定**全中 ⇒ 那個不等式是恆真式、零資訊量。
    //   ⇒ 拆成兩個分項：來源必須 11/11 紅（HEAD-FAIL 的本體）、
    //     高度必須 0/11 紅（正對照：這一版**不准**改到任何一個實際高度）。
    let sourceReds = 0, heightReds = 0;
    const heightDiff = [];
    for (const [name, ctx, wantH] of SCENES) {
      const r = computeFor(BR, ctx);
      if (!(r.mh?.fullSel === GROUP_SEL && r.mh?.value === VAR_MH)) sourceReds++;
      if (r.resolved !== wantH) { heightReds++; heightDiff.push(name + ':' + r.resolved + '≠' + wantH); }
    }
    chk('C2 ⭐⭐⭐ BASE 上「max-height 來自群組規則」這 ' + SCENES.length + ' 條**一條都不成立**',
      sourceReds === SCENES.length, String(sourceReds) + '/' + SCENES.length);
    chk('C2b ★ 正對照：BASE 上這 ' + SCENES.length + ' 個情境的**實際高度與現在完全相同**（本版沒有改到任何高度）',
      heightReds === 0, JSON.stringify(heightDiff));
    // ⚠ 同樣收緊（🟡-6）：原本「沒有值」與「有值但來源不同」都算紅 ⇒ 資訊量低。
    //   BASE 上這 7 個 class 連一條 overscroll-behavior 都沒有，斷言就寫成 null。
    const hasOB = LISTS.filter((c) => !!cascadeEffective(BR, 'overscroll-behavior', ctxOf([c])));
    chk('C3 ⭐⭐ BASE 上這 7 個 class **一條 overscroll-behavior 都沒有**', hasOB.length === 0, JSON.stringify(hasOB));
    // ★ 正對照：BASE 上「刻意保留的兩條覆寫」本來就成立 ⇒ 不可以因為讀錯檔就全紅
    const pv = computeFor(BR, ctxOf(['sel-grid'], [['prize-view-modal']]));
    chk('C4 ★ 正對照：BASE 上 .prize-view-modal .sel-grid 本來就是 none（守衛不是「什麼都紅」）',
      pv.mh?.value === 'none', JSON.stringify(pv.mh));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const chain = String(pkg.scripts?.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('D1 ⭐ scripts.test 裡**恰好**有本檔一次',
    chain.filter((s) => s === 'node ' + SELF).length === 1,
    String(chain.filter((s) => s === 'node ' + SELF).length));
}

console.log(`\n=== v6.390 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
