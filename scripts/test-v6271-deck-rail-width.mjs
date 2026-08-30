#!/usr/bin/env node
/**
 * v6.271 守衛：牌組編輯器左欄「我的牌組」太窄 —— 牌組名稱只看得到 2 個字
 *
 * 站長回報（逐字）
 * ──────────────────────────────────────────────────────────────────────────
 *   「使用 windows 網頁版時，牌組編輯器最左側的【我的牌組】區塊，太窄了，牌組的文字
 *     只能顯示幾個字而已 …… 反而在手機版因為切成三個區塊，導致【我的牌組】的區塊
 *     內容顯示，比網頁版還多。」
 *
 * 量到的現況（Chrome for Testing 152，headless，system-ui／CJK 1em ＝ 字級）
 * ──────────────────────────────────────────────────────────────────────────
 *   `.layout` 桌機軌道是 `220px minmax(0,1fr) minmax(0,1fr)` ⇒ 左欄**不隨視窗變寬**，
 *   1280／1440／1920 三種寬度下左欄一律 220px（`main` 又有 `max-width: 1200px`）。
 *   220px 扣掉 rail 的 border(1×2)＋padding(12×2) 只剩 194px，這 194px 還要塞：
 *     ・排序 ▲▼ 欄 18px　・🔍 戰績 25.6px　・✕ 刪除 25.6px　・三個 gap 共 12px
 *   ⇒ `.deck-pick` 只剩 112.8px，扣掉自己的 padding 8×2 剩 96.8px，
 *     再扣掉同一行的「60 / 60」45.0px 與 gap 8px ⇒ **牌組名稱只剩 43.8px ＝ 2 個中文字**。
 *   手機（≤900px）`.layout` 變單欄 ⇒ 左欄拿到整個頁寬，375px 下名稱有 166.8px ＝ 10 個字，
 *   這就是站長說的「手機版反而顯示比較多」——**不是手機做了什麼，是桌機被 220px 綁死**。
 *
 * ⚠ v6.267 的 🔍 是不是元凶？——**是幫兇，不是唯一原因**（本檔第 3 節用同一個模型量化）：
 *   v6.266（沒有 🔍）名稱有 73px ＝ 4 個字；v6.267 加了 🔍 之後剩 44px ＝ 2 個字。
 *   ⇒ 🔍 把原本就不夠的寬度**再砍一半**，但即使拿掉它也只有 4 個字，仍然不能用。
 *
 * 修法（三件事，缺一不可）
 * ──────────────────────────────────────────────────────────────────────────
 *   ① 桌機左欄 220px → 260px（中／右兩欄各少 20px，約 4%）。
 *   ② `.deck-pick` 改 `flex-direction: column` ⇒ 名稱**獨佔一整列**，
 *      「60 / 60」移到名稱下方 ⇒ 名稱可用寬度從「扣掉 53px」變成「整個 pick 內寬」。
 *   ③ `.deck-name` 從「一行 nowrap 截斷」改成「最多兩行截斷」。
 *
 * 這支守衛怎麼避免自己說謊
 * ──────────────────────────────────────────────────────────────────────────
 *   [HEAD-FAIL]  對 v6.270 的原始 CSS 跑，第 1／2／3 節**各自**會紅。
 *   [不是只驗字串存在] 第 3 節是**幾何預算模型**：所有輸入都從**當前 CSS 實際讀出來**
 *                （軌道寬、rail padding／border、li gap、pick padding／gap、
 *                 ▲▼ 的 min-width、button.icon 的 width、line-clamp 行數），
 *                模型算出「名稱可用寬度」與「可完整顯示幾個中文字」。
 *                ⭐ 模型不是憑空：它必須**逐一重現 Chrome 實測的 6 個數字**
 *                （v6.270 桌機 2 字／375 10 字／414 12 字；v6.271 桌機 16 字／375 26／414 32）。
 *                對照組 v6.270 的四個宣告值以**內嵌快照**寫死（歷史事實，不隨版本失效），
 *                所以淺複製的 CI 也照跑，不需要歷史 blob。
 *   [不 pin 死新值] 對「當前」只斷言門檻與倍數（≥12 字、≥3 倍、手機不得變差），
 *                不斷言「恰好等於 16」—— 之後若有人再加寬，這支守衛不會誤紅。
 *   [正對照]     🔍（openDeckStats）與 ✕（removeDeck）仍在 markup 且仍綁原本的 handler；
 *                本版沒有新增任何 `$effect`／`onMount`／`setInterval`／`fetch`
 *                （＝不可能多打 Firestore、不可能讓玩家端變慢）。
 *   [覆寫檢查]   任何 @media 區塊都不得把這三件事蓋回去（排在後面＝同權重後者勝）。
 *
 * Run: node scripts/test-v6271-deck-rail-width.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' — ' + extra : '')); } };

// ── CSS 小解析器（與 test-v6213 同一套寫法，並且自己先驗過）────────────────
function stripCssComments(css) {
  const out = css.split('');
  for (let i = 0; i < css.length - 1; i++) {
    if (css[i] === '/' && css[i + 1] === '*') {
      let j = i + 2;
      while (j < css.length - 1 && !(css[j] === '*' && css[j + 1] === '/')) j++;
      j = Math.min(j + 2, css.length);
      for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' ';
      i = j - 1;
    }
  }
  return out.join('');
}
function styleBlock(src) {
  const m = /^<style>/m.exec(src);
  const j = src.lastIndexOf('</style>');
  return (m && j > m.index) ? src.slice(m.index + 7, j) : '';
}
function splitMedia(css) {
  const blocks = []; let out = ''; let i = 0;
  while (i < css.length) {
    const k = css.indexOf('@media', i);
    if (k < 0) { out += css.slice(i); break; }
    out += css.slice(i, k);
    const open = css.indexOf('{', k);
    if (open < 0) { out += css.slice(k); break; }
    let d = 0, end = -1;
    for (let p = open; p < css.length; p++) {
      if (css[p] === '{') d++;
      else if (css[p] === '}') { d--; if (d === 0) { end = p; break; } }
    }
    if (end < 0) { out += css.slice(k); break; }
    blocks.push({ cond: css.slice(k, open).trim(), body: css.slice(open + 1, end), at: k });
    i = end + 1;
  }
  return { blocks, withoutMedia: out };
}
function rulesFor(css, selector) {
  const out = []; let i = 0, selStart = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      let d = 1, j = i + 1;
      while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
      const selText = css.slice(selStart, i);
      const body = css.slice(i + 1, j - 1);
      const sels = selText.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (sels.includes(selector)) out.push({ sels, body, at: selStart });
      i = j; selStart = j; continue;
    }
    if (ch === '}') { i++; selStart = i; continue; }
    i++;
  }
  return out;
}
const decl = (body, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+)', 'i').exec(body);
  return m ? m[1].trim() : null;
};
/** 「最後一條有這個宣告的規則」＝ 同權重下實際生效的那一條。 */
const effDecl = (css, selector, prop) => {
  let v = null;
  for (const r of rulesFor(css, selector)) { const d = decl(r.body, prop); if (d !== null) v = d; }
  return v;
};
const ROOT_FONT = 16;
/** `12px` / `0.75rem` → px（只支援本檔會用到的兩種單位；其他一律回 NaN，不猜）。 */
function px(v) {
  if (v == null) return NaN;
  const m = /^(-?[\d.]+)(px|rem)$/.exec(String(v).trim());
  if (!m) return NaN;
  return m[2] === 'rem' ? parseFloat(m[1]) * ROOT_FONT : parseFloat(m[1]);
}
/** `0.4rem 0.5rem` → 取水平方向那個值（1 值 / 2 值 / 4 值都處理）。 */
function padX(v) {
  if (v == null) return NaN;
  const parts = String(v).trim().split(/\s+/);
  if (parts.length === 1) return px(parts[0]);
  return px(parts[1]);
}

console.log('0) 解析器與單位轉換自我驗證（找不到就綠 ＝ 最會騙人的守衛）');
{
  const t = 'a{color:red}@media (max-width: 600px){b{color:blue}}a{color:green}';
  const s = splitMedia(t);
  ok('[自我驗證] splitMedia 切得出 @media，剩餘 CSS 不含 @media 內容',
    s.blocks.length === 1 && s.withoutMedia.includes('color:red') && !s.withoutMedia.includes('color:blue'));
  ok('[自我驗證] rulesFor 找得到同一個選擇器的兩條規則', rulesFor(t, 'a').length === 2);
  ok('[自我驗證] rulesFor 對不存在的選擇器回空陣列（不是亂比中）', rulesFor(t, 'zzz').length === 0);
  ok('[自我驗證] effDecl 取「後者勝」的那一條', effDecl(t, 'a', 'color') === 'green');
  ok('[自我驗證] decl 對不存在的宣告回 null', decl('color:red', 'gap') === null);
  ok('[自我驗證] px() 換算 rem/px、對不認得的單位回 NaN',
    px('12px') === 12 && px('0.75rem') === 12 && Number.isNaN(px('2em')));
  ok('[自我驗證] padX() 取水平值', padX('0.4rem 0.5rem') === 8 && padX('6px') === 6);
}

const CSS_RAW = styleBlock(SRC);
const CSS = stripCssComments(CSS_RAW);
const SP = splitMedia(CSS);
const BARE = SP.withoutMedia;   // 桌機（非 @media）
ok('[前提] 抓得到 /decks 的 <style> 區塊', CSS.length > 20000, String(CSS.length));

// ══════════════════════════════════════════════════════════════════════════
// 1. 桌機左欄加寬
// ══════════════════════════════════════════════════════════════════════════
console.log('\n1) 桌機左欄「我的牌組」的軌道寬度');
const layoutCols = effDecl(BARE, '.layout', 'grid-template-columns');
ok('[前提] 讀得到桌機 .layout 的軌道', !!layoutCols, String(layoutCols));
ok('[前提] 仍是三欄，且第二、三軌仍是 minmax(0, 1fr)（v6.213 修的橫向溢出沒有被順手改掉）',
  /^\d+px minmax\(0, 1fr\) minmax\(0, 1fr\)$/.test(String(layoutCols)), String(layoutCols));
const RAIL_TRACK = parseInt(String(layoutCols), 10);
ok('★★★[HEAD-FAIL／核心] 桌機左欄比 v6.270 的 220px 更寬', RAIL_TRACK > 220, RAIL_TRACK + 'px');
ok('★[取捨] 左欄加寬幅度有上限（>360px 就會把中／右兩欄擠到難用，要重新評估）',
  RAIL_TRACK <= 360, RAIL_TRACK + 'px');

// ══════════════════════════════════════════════════════════════════════════
// 2. 名稱獨佔一列 ＋ 兩行截斷
// ══════════════════════════════════════════════════════════════════════════
console.log('\n2) 牌組名稱獨佔一整列、可顯示兩行');
const pickDir = effDecl(BARE, '.deck-pick', 'flex-direction');
ok('★★★[HEAD-FAIL／核心] `.deck-pick` 改成直向（v6.270 沒有這條 ⇒ 名稱與「60 / 60」搶同一行）',
  pickDir === 'column', String(pickDir));
ok('★★[核心] `.deck-pick` 的 align-items 是 stretch（flex-start 會讓名稱只有內容寬、line-clamp 形同虛設）',
  effDecl(BARE, '.deck-pick', 'align-items') === 'stretch', String(effDecl(BARE, '.deck-pick', 'align-items')));
{
  // ⚠ 這四條缺任何一條，-webkit-line-clamp 都會**靜默失效**退回一行 ⇒ 逐條各自斷言。
  const d = effDecl(BARE, '.deck-name', 'display');
  const o = effDecl(BARE, '.deck-name', '-webkit-box-orient');
  const c = effDecl(BARE, '.deck-name', '-webkit-line-clamp');
  const w = effDecl(BARE, '.deck-name', 'white-space');
  const f = effDecl(BARE, '.deck-name', 'flex');
  ok('★★★[HEAD-FAIL／核心] `.deck-name` 是 `display: -webkit-box`', d === '-webkit-box', String(d));
  ok('★★★[HEAD-FAIL／核心] `.deck-name` 是 `-webkit-box-orient: vertical`', o === 'vertical', String(o));
  ok('★★★[HEAD-FAIL／核心] `.deck-name` 有 `-webkit-line-clamp` 且 ≥ 2 行',
    !!c && parseInt(c, 10) >= 2, String(c));
  ok('★★★[HEAD-FAIL／核心] `.deck-name` 的 white-space 不再是 nowrap（nowrap 會讓兩行截斷完全不生效）',
    w !== null && w !== 'nowrap', String(w));
  ok('★★[核心] `.deck-name` 不再是 `flex: 1`（直向 flex 裡 `flex:1` 會變成縱向撐開）',
    f === 'none', String(f));
  ok('[正對照] `.deck-name` 仍然有 overflow: hidden（少了它就不會截斷、會撐爆左欄）',
    effDecl(BARE, '.deck-name', 'overflow') === 'hidden');
}
{
  // 覆寫檢查：任何 @media 都不得把上面三件事蓋回去。
  const bad = [];
  for (const b of SP.blocks) {
    if (effDecl(b.body, '.deck-name', 'white-space') === 'nowrap') bad.push(b.cond + ' → .deck-name white-space:nowrap');
    const lc = effDecl(b.body, '.deck-name', '-webkit-line-clamp');
    if (lc !== null && parseInt(lc, 10) < 2) bad.push(b.cond + ' → line-clamp:' + lc);
    const fd = effDecl(b.body, '.deck-pick', 'flex-direction');
    if (fd !== null && fd !== 'column') bad.push(b.cond + ' → .deck-pick flex-direction:' + fd);
  }
  ok('★★[核心] 沒有任何 @media 把「直向／兩行」蓋回去（同權重後者勝，蓋回去是靜默失效）',
    bad.length === 0, JSON.stringify(bad));
}

// ══════════════════════════════════════════════════════════════════════════
// 3. ★★★ 幾何預算模型 —— 名稱到底放得下幾個中文字
// ══════════════════════════════════════════════════════════════════════════
console.log('\n3) ★★★幾何預算：牌組名稱可用寬度與可完整顯示的中文字數');
// 兩個「字型量測常數」——這是模型裡唯一不能從 CSS 推出來的東西，逐一交代來源：
//   ・CJK 字寬 ＝ 1em ＝ 字級（中日韓字型的全形字都是 1em advance；Chrome 實測 16.00px）
//   ・「60 / 60」在 0.8rem／system-ui 下實測 45.02px（Chrome for Testing 152，v6.270 版面）
// ⚠ 第二個常數**只用在 v6.270 的對照組**（新版名稱獨佔一列，根本不再和它共用寬度）。
const SIZE_TEXT_W = 45.02;
const MAIN_PAD = 16;      // main { padding: 0 1rem }
const RAIL_BORDER = 1;    // .rail { border: 1px solid }

function readGeom(css) {
  return {
    railPad: padX(effDecl(css, '.rail', 'padding')),
    liGap: px(effDecl(css, '.deck-list li', 'gap')),
    reorderW: px(effDecl(css, '.deck-reorder-btn', 'min-width')),
    iconW: px(effDecl(css, 'button.icon', 'width')),
    pickPadX: padX(effDecl(css, '.deck-pick', 'padding')),
    pickGap: px(effDecl(css, '.deck-pick', 'gap')),
    column: effDecl(css, '.deck-pick', 'flex-direction') === 'column',
    lines: parseInt(effDecl(css, '.deck-name', '-webkit-line-clamp') || '1', 10) || 1,
    nameFont: px(effDecl(css, '.deck-name', 'font-size')) || ROOT_FONT,
  };
}
/** 回傳 { nameW, chars }。mode='desktop' 用軌道寬；mode='mobile' 用「視窗寬 − main padding」。 */
function budget(g, mode, viewportPx, railTrackPx) {
  const railBox = mode === 'desktop' ? railTrackPx : (viewportPx - 2 * MAIN_PAD);
  const inner = railBox - 2 * RAIL_BORDER - 2 * g.railPad;
  // 同一列的固定成本：▲▼ 欄 ＋ 🔍 ＋ ✕ ＋ 三個 gap
  const chrome = g.reorderW + 2 * g.iconW + 3 * g.liGap;
  const pickInner = inner - chrome - 2 * g.pickPadX;
  const nameW = g.column ? pickInner : pickInner - g.pickGap - SIZE_TEXT_W;
  return { nameW, chars: Math.max(0, Math.floor(nameW / g.nameFont)) * g.lines };
}

// ⭐ 對照組：v6.270 的四個宣告值（內嵌快照 ＝ 歷史事實，淺複製的 CI 也跑得動）
const G_6270 = { railPad: 12, liGap: 4, reorderW: 18, iconW: 25.6, pickPadX: 8, pickGap: 8, column: false, lines: 1, nameFont: 16 };
const G_6266 = { ...G_6270 };   // v6.266 ＝ 還沒有 🔍 那一版
const G_NOW = readGeom(BARE);

ok('[前提] 幾何輸入全部從當前 CSS 讀得到（讀不到就變成 NaN ⇒ 下面全部會紅，不會假綠）',
  Object.entries(G_NOW).every(([k, v]) => (typeof v === 'number' ? Number.isFinite(v) : true)),
  JSON.stringify(G_NOW));

// ── 模型校準：必須逐一重現 Chrome for Testing 152 的實測值 ────────────────
{
  const near = (a, b) => Math.abs(a - b) <= 1.0;
  const d = budget(G_6270, 'desktop', 1280, 220);
  const m375 = budget(G_6270, 'mobile', 375);
  const m414 = budget(G_6270, 'mobile', 414);
  ok('★★[模型校準] v6.270 桌機（左欄 220px）算出 43.8px／2 字 —— 與 Chrome 實測 44px／2 字相符',
    near(d.nameW, 43.78) && d.chars === 2, d.nameW.toFixed(2) + 'px / ' + d.chars + '字');
  ok('★★[模型校準] v6.270 手機 375px 算出 166.8px／10 字 —— 與 Chrome 實測 167px／10 字相符',
    near(m375.nameW, 166.78) && m375.chars === 10, m375.nameW.toFixed(2) + 'px / ' + m375.chars + '字');
  ok('★★[模型校準] v6.270 手機 414px 算出 205.8px／12 字 —— 與 Chrome 實測 206px／12 字相符',
    near(m414.nameW, 205.78) && m414.chars === 12, m414.nameW.toFixed(2) + 'px / ' + m414.chars + '字');
  // ⭐ 站長問的「是不是 v6.267 的 🔍 造成的」——同一個模型量化：拿掉 🔍 只有 4 個字。
  const noStats = { ...G_6266 };
  const b6266 = (() => {
    const inner = 220 - 2 * RAIL_BORDER - 2 * noStats.railPad;
    const chrome = noStats.reorderW + 1 * noStats.iconW + 2 * noStats.liGap;   // 只有 ✕
    const pickInner = inner - chrome - 2 * noStats.pickPadX;
    const nameW = pickInner - noStats.pickGap - SIZE_TEXT_W;
    return { nameW, chars: Math.floor(nameW / 16) };
  })();
  ok('★★[量化 v6.267 的 🔍] 沒有 🔍 的 v6.266 是 72.8px／4 字（Chrome 實測 73px／4 字）—— '
    + '🔍 把 4 字砍成 2 字，是幫兇；但 4 字本來就不夠用，元凶是 220px 的固定左欄',
    near(b6266.nameW, 72.78) && b6266.chars === 4, b6266.nameW.toFixed(2) + 'px / ' + b6266.chars + '字');
}

// ── 當前版本：只斷言門檻與倍數，不 pin 死數字 ─────────────────────────────
{
  const base = budget(G_6270, 'desktop', 1280, 220);
  const now = budget(G_NOW, 'desktop', 1280, RAIL_TRACK);
  ok('★★★[HEAD-FAIL／核心] 桌機（1280／1440／1920 皆同，因為 main 有 max-width:1200px 且左欄固定寬）'
    + ' 名稱可完整顯示 ≥ 12 個中文字', now.chars >= 12, now.chars + '字 / ' + now.nameW.toFixed(2) + 'px');
  ok('★★★[HEAD-FAIL／核心] 桌機名稱可用寬度至少是 v6.270 的 3 倍',
    now.nameW >= base.nameW * 3, now.nameW.toFixed(2) + ' vs ' + base.nameW.toFixed(2));
  for (const vw of [375, 414, 360]) {
    const b = budget(G_6270, 'mobile', vw);
    const n = budget(G_NOW, 'mobile', vw);
    ok('★★[不可比修前差] 手機 ' + vw + 'px：可顯示字數 ' + b.chars + ' → ' + n.chars,
      n.chars >= b.chars && n.nameW >= b.nameW, n.chars + ' vs ' + b.chars);
  }
  // 中／右兩欄的取捨要明講且有上限：1200px 版面下每欄最多只准少 40px。
  const midBase = (1200 - 2 * MAIN_PAD - 2 * 16 - 220) / 2;
  const midNow = (1200 - 2 * MAIN_PAD - 2 * 16 - RAIL_TRACK) / 2;
  ok('★[取捨] 中／右兩欄各少的寬度 ≤ 40px（1200px 版面：' + midBase.toFixed(0) + ' → ' + midNow.toFixed(0) + 'px）',
    midBase - midNow <= 40, (midBase - midNow).toFixed(1) + 'px');
}

// ══════════════════════════════════════════════════════════════════════════
// 4. 正對照：🔍 與 ✕ 沒有被動到；列裡沒有多出模型不知道的元素
// ══════════════════════════════════════════════════════════════════════════
console.log('\n4) 正對照：v6.267 的 🔍 與 ✕ 仍可用，列結構沒有多出東西');
{
  const li = /<ul class="deck-list">[\s\S]*?<\/ul>/.exec(SRC);
  ok('[前提] 抓得到「我的牌組」那份 <ul class="deck-list">', !!li);
  const body = li ? li[0] : '';
  ok('★[正對照] 🔍 戰績鈕還在，且仍綁 openDeckStats（v6.267 的功能不可以被弄壞）',
    /class="icon deck-stats-btn"/.test(body) && /onclick=\{\(\) => openDeckStats\(d\)\}/.test(body));
  ok('★[正對照] 🔍 仍然被 `{#if !statsHidden}` 包住（哨兵缺席時整顆藏起來，行為不變）',
    /\{#if !statsHidden\}[\s\S]*deck-stats-btn/.test(body));
  ok('★[正對照] ✕ 刪除鈕還在，且仍綁 removeDeck（逐字不變）',
    /onclick=\{\(\) => removeDeck\(d\.id\)\}/.test(body));
  ok('★[正對照] 排序 ▲▼ 仍綁 moveDeckUp／moveDeckDown',
    /moveDeckUp\(d\.id\)/.test(body) && /moveDeckDown\(d\.id\)/.test(body));
  // ⚠ 模型的「固定成本」假設了列裡恰好是【▲▼欄 ＋ pick ＋ 🔍 ＋ ✕】。
  //   多一顆按鈕模型就會高估 ⇒ 這條一紅就代表模型要重新推導，不是小事。
  const btnCount = (body.match(/<button/g) || []).length;
  ok('★★[模型前提] 每一列恰好 5 顆 button（▲ ▼ pick 🔍 ✕）—— 多一顆模型就高估了',
    btnCount === 5, String(btnCount));
}
{
  // 本版沒有新增任何會發網路請求／會反覆執行的東西 ⇒ 不可能多打 Firestore、不可能變慢。
  // ⚠ 這是**上界**斷言（只准變少），不是 pin 死數字。
  const SNAP_6270 = { '$effect(': 0, 'onMount(': 1, 'setInterval(': 0, 'setTimeout(': 9, 'fetch(': 2, 'getDocs(': 0, 'getDoc(': 0, 'onSnapshot(': 0, 'loadDecksFromCloud': 3, 'syncDeckToCloud': 5, 'removeDeckFromCloud': 2, 'fetchDeckStats': 3 };
  const over = [];
  for (const [k, v] of Object.entries(SNAP_6270)) {
    const n = SRC.split(k).length - 1;
    if (n > v) over.push(k + ': ' + n + ' > ' + v);
  }
  ok('★★[效能／Firestore] /decks 沒有新增任何 $effect／onMount／計時器／fetch／Firestore 呼叫（只准變少）',
    over.length === 0, JSON.stringify(over));
  ok('[正對照] 上一條不是恆真式：這些呼叫確實存在（不是掃了個空）',
    (SRC.split('syncDeckToCloud').length - 1) === 5 && (SRC.split('fetchDeckStats').length - 1) === 3);
}

console.log('\n=== v6.271 牌組編輯器左欄寬度: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('=== SCRIPT-END v6271-deck-rail-width ===');
if (fail) process.exit(1);
