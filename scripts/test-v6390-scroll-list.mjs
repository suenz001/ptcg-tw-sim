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
import { parseCss, cascade, matchOne, styleBlockOf } from './lib/css-cascade.mjs';
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
chk('F0b 解析出大量規則（解析器沒有在第一個 } 就停）', RULES.length > 3000, String(RULES.length));
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
    for (const t of hit) if (matchOne(t, { self: new Set(), ancestors: [], media: [] }) === null) unsupported.push(t);
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
    ['touch-action', 'pan-y'],
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

/** 回傳 {mh, src, resolved, oy, oyFrom}：max-height 勝出者、來源規則、解析後的實際高度、overflow-y 勝出者 */
function computeFor(rules, ctx) {
  const mh = cascade(rules, 'max-height', ctx);
  const ov = cascade(rules, 'overflow', ctx);
  const oy = cascade(rules, 'overflow-y', ctx);
  const cv = cascade(rules, '--scroll-list-max', ctx);
  // overflow 簡寫會蓋掉 overflow-y（同 important 時比特異度／順序）
  let eff = oy;
  if (ov && (!oy || (ov.important && !oy.important) || (ov.important === oy.important && (ov.spec > oy.spec || (ov.spec === oy.spec && ov.order > oy.order))))) eff = ov;
  return {
    mh, oy: eff, cv,
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
}
{
  const r = computeFor(RULES, ctxOf(['retreat-grid'], [], [MEDIA_P]));
  chk('B13 ⭐ 手機直式的 .retreat-grid 仍然是 max-height:none !important（v5.299 解雙層滑捲衝突）',
    r.mh?.value === 'none' && r.mh?.important === true, JSON.stringify(r.mh));
  chk('B13b ⭐ 且 overflow-y 仍是 visible !important', r.oy?.value === 'visible' && r.oy?.important === true, JSON.stringify(r.oy));
}

// B14：觸控四件套真的套到每一個清單上（不是只寫在群組規則裡沒人吃到）
for (const c of LISTS) {
  const ctx = ctxOf([c]);
  const got = {};
  for (const p of ['min-height', 'overscroll-behavior', '-webkit-overflow-scrolling', 'touch-action']) {
    const w = cascade(RULES, p, ctx);
    got[p] = w ? w.value + '@' + (w.fullSel === GROUP_SEL ? 'group' : w.fullSel) : null;
  }
  chk('B14 .' + c + ' 吃到完整的觸控四件套（且都來自群組規則）',
    got['min-height'] === '0@group' && got['overscroll-behavior'] === 'contain@group'
    && got['-webkit-overflow-scrolling'] === 'touch@group' && got['touch-action'] === 'pan-y@group',
    JSON.stringify(got));
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
    let reds = 0, total = 0;
    for (const [name, ctx, wantH] of SCENES) {
      const r = computeFor(BR, ctx);
      total += 2;
      if (r.resolved !== wantH) reds++;                                   // 高度（BASE 大多仍相同 ⇒ 這半不一定紅）
      if (!(r.mh?.fullSel === GROUP_SEL && r.mh?.value === VAR_MH)) reds++; // 來源（BASE **必定**全紅）
    }
    chk('C2 ⭐⭐⭐ BASE 上「max-height 來自群組規則」這 ' + SCENES.length + ' 條**全部**不成立',
      reds >= SCENES.length, JSON.stringify({ reds, total }));
    let touchRed = 0;
    for (const c of LISTS) {
      const w = cascade(BR, 'overscroll-behavior', ctxOf([c]));
      if (!w || w.fullSel !== GROUP_SEL) touchRed++;
    }
    chk('C3 ⭐⭐ BASE 上這 7 個 class **一個都沒有**吃到 overscroll-behavior',
      touchRed === LISTS.length, String(touchRed));
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
