#!/usr/bin/env node
/**
 * v6.213 守衛 ④：手機版牌組編輯器 —— 不再左右滑動、聚焦輸入框不再放大
 *
 * 玩家回報
 * ──────────────────────────────────────────────────────────────────────────
 *   「手機版玩家使用牌組編輯器的畫面**有時可以左右滑動**，而且還有玩家反應
 *     **有時候比例會放大**。」
 *
 * 真因（兩件事，各自獨立）
 * ──────────────────────────────────────────────────────────────────────────
 *  (A) 左右滑動 ＝ **CSS Grid blowout**。
 *      `.layout` 桌機那行早就寫了 `minmax(0, 1fr)`（有人已經知道這個坑），
 *      但 `@media (max-width: 900px)` 的手機那行只有 `1fr`。
 *      `1fr` 展開是 `minmax(auto, 1fr)` —— **最小值是內容的 min-content**，
 *      所以只要欄位裡任一子元素的 min-content 比視窗寬，軌道就會被撐大，
 *      連帶把 `.layout` / `main` 一起撐出視窗 ⇒ 整頁可以橫向捲。
 *      撐大它的具體來源（本檔第 2 節逐條鎖住）：
 *        ・`.pk-search-row` 是 flex 且**沒有** wrap，裡面是「輸入框（min-content ＝
 *          它的內建尺寸，預設 size=20）」＋「flex-shrink:0 的模式下拉（選項文字 nowrap）」；
 *        ・`.pk-set-select` 桌機寫死 `max-width: 260px`，手機可用寬度可能比它還窄。
 *      ⇒ 比照 /cards（v6.044 的 `repeat(N, minmax(0, 1fr))`）＋ `flex-wrap: wrap`
 *        ＋ `min-width: 0` 三件套。
 *  (B) 比例放大 ＝ **iOS Safari 對 font-size < 16px 的表單控制項，聚焦時自動放大畫面**。
 *      牌組編輯器裡 `.pk-search` 0.88rem、`.pk-mode-select` 0.78rem、
 *      `.pk-set-select` 0.82rem、`.text-area` 0.85rem、`.auth-form input` 0.95rem
 *      —— 全部 < 16px。
 *      ⚠ app.html 早就有 `user-scalable=no, maximum-scale=1`，但 iOS 10 之後
 *        Safari **不保證遵守**，而且那兩個值本身有無障礙代價 ⇒ 不可以依賴、也不加碼。
 *      ⇒ 只在手機分支把這些控制項的字級提到 **16px**（用 px 不用 rem：門檻是
 *        瀏覽器寫死的 16 CSS px，使用者調小根字級的話 1rem 會靜默失效）。
 *
 * 這支守衛怎麼避免自己說謊
 * ──────────────────────────────────────────────────────────────────────────
 *   [HEAD-FAIL]  還原成 v6.212 會 FAIL。
 *   [正對照]     **桌機分支逐字未動** —— 把所有 @media 區塊整段切掉之後的 CSS，
 *                取 sha256 指紋鎖死。⚠ v6.213 第二輪 opus 審查抓到：原本這一節只寫了
 *                四條「不得出現本版新增宣告」的否定式，桌機隨便改成什麼樣子（實測把
 *                `.picker` 改成 `width:3000px` ）它照樣全綠 —— 那是**假綠**。
 *                指紋鎖才是真的逐字證明；要刻意改桌機時，把新指紋填進來並在 commit 說明。
 *   [自我驗證]   解析器（切 @media / 取宣告）自己先驗一遍，否則「找不到 ⇒ 綠」。
 *   [順序]       新規則必須排在被覆寫的舊規則**之後**（同權重後者勝；排前面＝靜默失效）。
 *
 * Run: node scripts/test-v6213-mobile-deck-editor.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DECKS = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
const CARDS = readFileSync(join(ROOT, 'src/routes/cards/+page.svelte'), 'utf8');
const APPHTML = readFileSync(join(ROOT, 'src/app.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' — ' + extra : '')); } };

// ── CSS 小解析器（只做這支守衛需要的事，並且自己先驗過）──────────────────
/** 保長度地把 CSS 註解換成空白。
 *  ⚠ 非做不可：選擇器前面若有註解，土法解析會把「註解 + 選擇器」當成一整個選擇器
 *    ⇒ 該條規則永遠找不到 ⇒ 斷言靜默變綠。保長度是為了讓字元位置（排序用）仍然正確。 */
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
  // ⚠ 不可以用 lastIndexOf('<style>') —— 註解裡若提到這個字串就會抓錯位置，
  //   而抓錯的結果是「CSS 只剩幾百字元 ⇒ 每一條斷言都找不到東西 ⇒ 假訊號」。
  //   ⇒ 一律鎖「行首的 <style>」，並用最後一個 </style> 收尾。
  const m = /^<style>/m.exec(src);
  const j = src.lastIndexOf('</style>');
  return (m && j > m.index) ? src.slice(m.index + 7, j) : '';
}
/** 把所有 @media 區塊切出來（回傳 {cond, body, at} 陣列），並回傳「拿掉全部 @media 之後」的 CSS。 */
function splitMedia(css) {
  const blocks = [];
  let out = '';
  let i = 0;
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
/** 取某個選擇器在某段 CSS 裡的所有宣告區塊。
 *  ⚠ 用手寫的括號配對走訪，不用正則 —— 正則的 lastIndex 會把相鄰規則的邊界吃掉，
 *    結果是「找不到 ⇒ 斷言變成永遠綠」。解析器自己在第 0 節有正對照。 */
function rulesFor(css, selector) {
  const out = [];
  let i = 0, selStart = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      let d = 1, j = i + 1;
      while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
      const selText = css.slice(selStart, i);
      const body = css.slice(i + 1, j - 1);
      const sels = selText.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (sels.includes(selector)) out.push({ sels, body, at: selStart + (selText.length - selText.trimStart().length) });
      i = j; selStart = j; continue;
    }
    if (ch === '}') { i++; selStart = i; continue; }
    i++;
  }
  return out;
}
/** 走遍整份 CSS（含 @media 內部）取出所有規則，位置是**相對整份 CSS 的絕對位置**。
 *  ⚠ rulesFor 不會進到 @media 裡面，而本版新增的規則全都在 @media 內 ——
 *    排序斷言若用 rulesFor 就會「找不到 ⇒ 假綠」。 */
function allRules(css, base = 0, out = []) {
  let i = 0, selStart = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      let d = 1, j = i + 1;
      while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
      const selText = css.slice(selStart, i);
      const body = css.slice(i + 1, j - 1);
      if (/^\s*@/.test(selText)) allRules(body, base + i + 1, out);
      else {
        const sels = selText.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
        out.push({ sels, body, at: base + selStart + (selText.length - selText.trimStart().length) });
      }
      i = j; selStart = j; continue;
    }
    if (ch === '}') { i++; selStart = i; continue; }
    i++;
  }
  return out;
}
const decl = (body, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(body);
  return m ? m[1].trim() : null;
};

console.log('0) 解析器自我驗證（找不到就綠 ＝ 最會騙人的守衛）');
{
  const t = 'a{color:red}@media (max-width: 600px){b{color:blue} c,d{x:1}}e{q:2}';
  const s = splitMedia(t);
  ok('[自我驗證] splitMedia 切得出 @media 且剩餘 CSS 正確',
    s.blocks.length === 1 && s.blocks[0].cond === '@media (max-width: 600px)'
    && s.withoutMedia.includes('a{color:red}') && s.withoutMedia.includes('e{q:2}')
    && !s.withoutMedia.includes('color:blue'), JSON.stringify(s.blocks.map((b) => b.cond)));
  ok('[自我驗證] rulesFor 找得到單一選擇器、相鄰規則與逗號選擇器',
    rulesFor(t, 'a').length === 1 && rulesFor(t, 'e').length === 1
    && rulesFor(s.blocks[0].body, 'b').length === 1
    && rulesFor(s.blocks[0].body, 'c').length === 1
    && rulesFor(s.blocks[0].body, 'd').length === 1,
    JSON.stringify([rulesFor(t, 'a').length, rulesFor(t, 'e').length, rulesFor(s.blocks[0].body, 'b').length]));
  ok('[自我驗證] rulesFor 對不存在的選擇器回空陣列（不是亂比中）', rulesFor(t, 'zzz').length === 0);
  ok('[自我驗證] decl 取得出宣告值', decl('color:red;font-size:16px', 'font-size') === '16px');
  ok('[自我驗證] decl 對不存在的宣告回 null', decl('color:red', 'font-size') === null);
}
// 手機上會被玩家聚焦的控制項（<input> / <select> / <textarea>）。
// ⚠ 這份清單是**逐一對著 markup 的 <input>/<select>/<textarea> 列出來的**，
//   不是隨便挑幾個 —— 少列一個就等於留一個會放大的入口。
const FOCUSABLE = ['.pk-search', '.pk-mode-select', '.pk-set-select', '.deck-title', '.text-area', '.bm-code', '.auth-form input'];
const CSS_RAW = styleBlock(DECKS);
const CSS = stripCssComments(CSS_RAW);
ok('[前提] 抓得到 /decks 的 <style> 區塊', CSS.length > 20000, String(CSS.length));
const SP = splitMedia(CSS);
ok('[前提] /decks 有多個 @media 區塊', SP.blocks.length >= 7, String(SP.blocks.length));

// ══════════════════════════════════════════════════════════════════════════
// 1. ④-A 橫向溢出：軌道不可以再是 `1fr`
// ══════════════════════════════════════════════════════════════════════════
console.log('\n1) ④-A 橫向捲動：grid 軌道');
{
  const m900 = SP.blocks.filter((b) => /max-width:\s*900px/.test(b.cond));
  ok('[前提] 找得到 900px 的 @media 區塊', m900.length === 1, String(m900.length));
  const r = m900.length ? rulesFor(m900[0].body, '.layout') : [];
  ok('[前提] 900px 區塊裡有 .layout 規則', r.length === 1, String(r.length));
  const v = r.length ? decl(r[0].body, 'grid-template-columns') : null;
  ok('★★★[HEAD-FAIL／核心④] 手機的 .layout 軌道是 `minmax(0, 1fr)`（`1fr` 的最小值是 min-content ⇒ 會被撐出視窗）',
    v === 'minmax(0, 1fr)', String(v));
  // 桌機那行是「本來就對」的參照組 —— 它必須維持原樣。
  const rd = rulesFor(SP.withoutMedia, '.layout');
  const vd = rd.length ? decl(rd[0].body, 'grid-template-columns') : null;
  // ⚠ v6.271 刻意把第一軌從 220px 加寬到 260px（左欄「我的牌組」太窄，牌組名稱只看得到 2 個字）。
  //   這裡不只比字串，還多鎖兩件事，讓這條**不會因為更新而變鬆**：
  //     ① 第二、三軌仍然是 minmax(0, 1fr)（＝v6.213 修的橫向溢出沒有被順手改掉）；
  //     ② 第一軌**只准更寬、不准更窄**（≥ 220px）—— 再被改窄回去就是回歸。
  ok('[正對照] 桌機的 .layout 仍是三欄，且第二、三軌仍是 minmax(0, 1fr)',
    /^\d+px minmax\(0, 1fr\) minmax\(0, 1fr\)$/.test(String(vd)), String(vd));
  ok('★★[v6.271] 桌機第一軌（左欄「我的牌組」）不得比 v6.270 的 220px 更窄',
    !!vd && parseInt(vd, 10) >= 220, String(vd));
  ok('★★★[HEAD-FAIL／v6.271] 桌機第一軌已加寬（v6.270 是 220px）',
    vd === '260px minmax(0, 1fr) minmax(0, 1fr)', String(vd));
}
{
  // /cards 的做法（本版就是照抄它）：v6.044 的 repeat(N, minmax(0, 1fr))
  const cc = splitMedia(stripCssComments(styleBlock(CARDS)));
  const m600 = cc.blocks.filter((b) => /max-width:\s*600px/.test(b.cond));
  const hit = m600.some((b) => /repeat\(\s*\d+\s*,\s*minmax\(0,\s*1fr\)\s*\)/.test(b.body));
  ok('[參照組] 卡牌資料庫 /cards 手機分支用的就是 `repeat(N, minmax(0, 1fr))`（本版照它的做法）', hit);
}

console.log('\n2) ④-A 橫向捲動：撐大軌道的兩個具體來源');
{
  const m600 = SP.blocks.filter((b) => {
    const m = /max-width:\s*(\d+)px/.exec(b.cond);
    return !!m && Number(m[1]) <= 600;
  });
  ok('[前提] 找得到手機（max-width ≤ 600px）的 @media 區塊', m600.length >= 2, String(m600.length));
  const body600 = m600.map((b) => b.body).join('\n');

  const rowRules = rulesFor(body600, '.pk-search-row');
  ok('★★★[HEAD-FAIL／核心④] 手機的搜尋列可以換行（`flex-wrap: wrap`，比照 /cards 的 .controls）',
    rowRules.some((r) => decl(r.body, 'flex-wrap') === 'wrap'));
  const searchRules = rulesFor(body600, '.pk-search');
  ok('★★★[HEAD-FAIL／核心④] 搜尋輸入框可以縮到 0（flex 子項的自動最小尺寸是 min-content，不設 min-width:0 就縮不下去）',
    searchRules.some((r) => decl(r.body, 'min-width') === '0'));
  const setRules = rulesFor(body600, '.pk-set-select');
  ok('★★[HEAD-FAIL／核心④] 卡包下拉在手機不再被寫死 260px',
    setRules.some((r) => decl(r.body, 'max-width') === '100%'));
  // 正對照：桌機那三條**原樣不動**
  ok('[正對照] 桌機的 .pk-search 仍然沒有 min-width、字級仍是 0.88rem',
    (() => { const r = rulesFor(SP.withoutMedia, '.pk-search'); return r.length === 1 && decl(r[0].body, 'min-width') === null && decl(r[0].body, 'font-size') === '0.88rem'; })());
  ok('[正對照] 桌機的 .pk-set-select 仍然是 max-width: 260px',
    (() => { const r = rulesFor(SP.withoutMedia, '.pk-set-select'); return r.length === 1 && decl(r[0].body, 'max-width') === '260px'; })());
  ok('[正對照] 桌機的 .pk-search-row 仍然沒有 flex-wrap（＝一行放不下就溢出，桌機本來就夠寬）',
    (() => { const r = rulesFor(SP.withoutMedia, '.pk-search-row'); return r.length === 1 && decl(r[0].body, 'flex-wrap') === null; })());
}

// ══════════════════════════════════════════════════════════════════════════
// 3. ④-B iOS 聚焦自動放大：手機的表單控制項字級 ≥ 16px
// ══════════════════════════════════════════════════════════════════════════
console.log('\n3) ④-B 聚焦時比例被放大');
{
  // 手機上會被玩家聚焦的控制項（<input> / <select> / <textarea>）。
  // ⚠ 這份清單是**逐一對著 markup 的 <input>/<select>/<textarea> 列出來的**，
  //   不是隨便挑幾個 —— 少列一個就等於留一個會放大的入口。
  // （FOCUSABLE 定義在檔案上方，排序斷言也要用）
  // 取「最後一條會套到它、且有 font-size 的手機規則」= 實際生效的那一條。
  // ⚠ v6.213 第二輪 opus 審查抓到：原本只掃 `max-width: 600px` 這一種條件字串
  //   ⇒ 有人之後加一個 `@media (max-width: 400px)` 把字級蓋回去，這一節完全看不到（實測全綠）。
  //   ⇒ 改成掃**所有 max-width ≤ 600px** 的區塊（400/480/600… 一律涵蓋）。
  const mobileBlocks = SP.blocks.filter((b) => {
    const m = /max-width:\s*(\d+)px/.exec(b.cond);
    return !!m && Number(m[1]) <= 600;
  });
  ok('[前提] 找得到手機（max-width ≤ 600px）的 @media 區塊', mobileBlocks.length >= 2, String(mobileBlocks.length));
  for (const sel of FOCUSABLE) {
    // 依 @media 區塊在原檔中的位置排序，取最後一條有 font-size 的（同權重後者勝）
    const ordered = mobileBlocks.slice().sort((a, b) => a.at - b.at);
    let eff = null;
    for (const blk of ordered) for (const r of rulesFor(blk.body, sel)) { const f = decl(r.body, 'font-size'); if (f) eff = f; }
    ok('★★★[HEAD-FAIL／核心④] 手機上 `' + sel + '` 的字級是 16px（iOS < 16px 會在聚焦時放大整個畫面）',
      eff === '16px', String(eff));
  }
  // ⚠ 順序：新規則必須在被覆寫者之後，否則同權重下會被蓋掉而**靜默失效**。
  // ⚠ 錨點刻意**不**用註解裡的字串（註解已經被剝掉了，而且註解也不是「生效的東西」）。
  //   用新規則本身的位置：它是唯一一條 `font-size: 16px` 的規則。
  const ALL = allRules(CSS);
  const newRules = ALL.filter((r) => decl(r.body, 'font-size') === '16px');
  ok('[前提] 找得到 v6.213 的新規則（整份 CSS 只有這一條 16px）', newRules.length === 1, String(newRules.length));
  ok('[前提] 那一條規則涵蓋全部 7 個可聚焦控制項（少列一個＝留一個會放大的入口）',
    newRules.length === 1 && FOCUSABLE.every((x) => newRules[0].sels.includes(x)),
    newRules.length ? JSON.stringify(newRules[0].sels) : '');
  const iNew = newRules.length ? newRules[0].at : -1;
  // ⭐ v6.213 第二輪審查補：新規則**之後**不得再有任何規則把這些控制項的字級蓋回去
  //   （不論在哪個 @media、哪個斷點）。這條才是真正防「被後面覆寫」的鎖。
  {
    const later = allRules(CSS).filter((r) => r.at > iNew
      && FOCUSABLE.some((sel) => r.sels.includes(sel)) && decl(r.body, 'font-size'));
    ok('★★★[核心④] v6.213 之後沒有任何規則再把可聚焦控制項的字級蓋回去（不論哪個斷點）',
      later.length === 0, JSON.stringify(later.map((r) => r.sels.join(',') + ' ' + decl(r.body, 'font-size'))));
  }
  for (const sel of ['.pk-search', '.deck-title', '.text-area', '.auth-form input']) {
    // ⚠ 只看**排在新區塊之前**的舊規則 —— 新區塊自己也含這些選擇器，
    //   不排除的話 lastOld 會等於新區塊自己的位置，這條就永遠紅（而且理由是錯的）。
    const olds = ALL.filter((r) => r.sels.includes(sel) && decl(r.body, 'font-size') && r.at < iNew);
    ok('[前提] `' + sel + '` 在新區塊之前確實有一條較小的字級（否則這條沒有意義）', olds.length >= 1);
    const lastOld = olds.length ? Math.max(...olds.map((r) => r.at)) : -1;
    ok('★★[核心④] 新規則排在舊的 `' + sel + '` 字級之後（排前面 ＝ 同權重被蓋掉、靜默失效）',
      iNew > lastOld, 'new@' + iNew + ' oldLast@' + lastOld);
  }
}
{
  // ⚠ 站長明確交代：不要亂加 user-scalable=no。
  //   它**本來就已經在** app.html（不是這一版加的），而且 iOS 10 之後不保證被遵守。
  //   這條守衛鎖的是「本版沒有加碼、也沒有把它當成解法」。
  const vp = /<meta name="viewport" content="([^"]*)"/.exec(APPHTML);
  ok('[前提] 抓得到 viewport meta', !!vp);
  ok('★[核心④] 本版**沒有**去動 viewport（user-scalable/maximum-scale 維持 v6.212 原樣，不加碼）',
    vp && vp[1] === 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no',
    vp && vp[1]);
  ok('★[核心④] 修法沒有依賴 viewport：註解明講 iOS 10 之後不保證遵守', CSS_RAW.includes('不保證遵守'));
}

// ══════════════════════════════════════════════════════════════════════════
// 4. ★★★ 正對照：桌機版面「逐字未動」的機器證明
// ══════════════════════════════════════════════════════════════════════════
console.log('\n4) ★★★正對照：桌機 CSS 逐字未動');
{
  // 這一版對 /decks 的改動只有兩處：
  //   ①`@media (max-width: 900px)` 內 .layout 的軌道；
  //   ②檔尾新增一整個 `@media (max-width: 600px)` 區塊。
  // 兩者都在 @media 內 ⇒ **把所有 @media 整段拿掉之後的 CSS，必須與 v6.212 完全相同**。
  // 這裡用「非 @media 部分的宣告總數與字元數」當指紋：任何桌機改動都會讓它變。
  const bare = SP.withoutMedia.replace(/\s+/g, ' ').trim();
  ok('[前提] 非 @media 的桌機 CSS 抓得到且份量正常', bare.length > 15000, String(bare.length));
  // ⭐⭐⭐ 真正的逐字證明：把整段桌機 CSS 取指紋。
  //   ⚠ 這一條**只有在刻意要改桌機版面時**才准更新（更新時務必在 commit 訊息說明改了什麼）。
  //   ⚠ 指紋是對「壓過空白之後」的字串取的 ⇒ 純排版／註解調整不會誤紅，
  //     但任何**宣告的增刪改**都會紅。
  //   ⚠⚠ 這個值是**在 v6.212（BASE efd6979202da62748d4fb24154ebb8c16001dbd1）上算出來的**，
  //     v6.213 算出來一模一樣 —— 這就是「桌機一個宣告都沒動」的逐字證明，不是自己跟自己比。
  //   ⚠⚠ **v6.267 刻意更新了這個指紋**：`/decks` 新增了「套牌戰績」modal 的桌機樣式
  //     （`.ds-backdrop` ~ `.ds-notes`）。為了讓這把鎖不因為更新而變弱，下面多加一條：
  //     **把 v6.267 新增的那一段整組拿掉之後，必須逐字還原回 v6.212 的指紋**
  //     ⇒ 「桌機只多了那一段、其餘一個宣告都沒動」仍然是逐字證明。
  const DESKTOP_SHA_V6212 = '6ac52437ce962826';   // v6.212 ＝ v6.213 ＝ … ＝ v6.266（bare.length = 25315）
  const DESKTOP_SHA_V6267 = '4a2669f933bf118e';   // v6.267 ＝ … ＝ v6.270（bare.length = 26776）
  const DESKTOP_SHA = '26605e17e71776c4';   // v6.271（bare.length = 26937）
  const bareSha = createHash('sha256').update(bare).digest('hex').slice(0, 16);
  ok('★★★[正對照／逐字證明] 桌機（非 @media）CSS 的 sha256 指紋沒有變 —— 只有本版刻意做的那幾處',
    bareSha === DESKTOP_SHA && bare.length === 26937, bareSha + ' / len=' + bare.length);
  // ⭐⭐⭐ v6.271 刻意改桌機（左欄 220→260px、牌組名稱改兩行）。為了讓這把鎖**不因為更新而變鬆**，
  //   這裡不是「換一個新指紋就算了」，而是把本版**逐字的四處宣告編輯**做**反向還原**，
  //   還原後必須逐字回到 v6.267 的指紋 ⇒「桌機除了這四處，一個宣告都沒動」仍然是逐字證明。
  //   ⚠ 若之後有人再改桌機而沒有登記在這張表裡，還原後的指紋就對不上 ⇒ 直接紅。
  const V6271_REVERSALS = [
    ['grid-template-columns: 260px minmax(0, 1fr) minmax(0, 1fr);',
     'grid-template-columns: 220px minmax(0, 1fr) minmax(0, 1fr);'],
    ['.deck-pick { flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; justify-content: center; align-items: stretch; gap: 0.1rem; background: transparent; border: none; padding: 0.35rem 0.5rem;',
     '.deck-pick { flex: 1; min-width: 0; text-align: left; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; background: transparent; border: none; padding: 0.4rem 0.5rem;'],
    ['.deck-name { font-weight: 500; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; text-overflow: ellipsis; white-space: normal; overflow-wrap: anywhere; line-height: 1.25; min-width: 0; flex: none; }',
     '.deck-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }'],
    ['.deck-size { color: #888; font-size: 0.75rem; line-height: 1.15; flex-shrink: 0; white-space: nowrap; }',
     '.deck-size { color: #888; font-size: 0.8rem; flex-shrink: 0; white-space: nowrap; }'],
  ];
  let REV_V6271 = bare, _allOne = true;
  for (const [a, b] of V6271_REVERSALS) {
    const n = REV_V6271.split(a).length - 1;
    if (n !== 1) { _allOne = false; console.log('    這一處在桌機 CSS 裡出現 ' + n + ' 次（應為 1）：' + a.slice(0, 60)); }
    REV_V6271 = REV_V6271.replace(a, b);
  }
  ok('[前提] v6.271 登記的四處桌機編輯，每一處在桌機 CSS 裡都恰好出現一次（抓不到 ⇒ 下一條會是假綠）', _allOne);
  const revSha = createHash('sha256').update(REV_V6271).digest('hex').slice(0, 16);
  ok('★★★[正對照／逐字證明] 把 v6.271 那四處還原之後，桌機 CSS 逐字回到 v6.267',
    revSha === DESKTOP_SHA_V6267 && REV_V6271.length === 26776, revSha + ' / len=' + REV_V6271.length);
  // ⭐⭐⭐ v6.267 新增：把套牌戰績那一段拿掉之後，必須逐字回到 v6.212 的指紋。
  const V6267_BLOCK = /\.ds-backdrop \{[^]*?\.ds-notes \{[^}]*\}/;
  ok('[前提] 抓得到 v6.267 新增的那一段桌機 CSS（抓不到 ⇒ 下一條會變成恆真）',
    V6267_BLOCK.test(SP.withoutMedia));
  // ⚠ v6.271 起：這一條要接在「已經還原成 v6.267」的字串（REV_V6271）上，
  //   否則還帶著 v6.271 的四處編輯，永遠對不上 v6.212 的指紋。
  const bare212 = REV_V6271.replace(V6267_BLOCK, '').replace(/\s+/g, ' ').trim();
  const sha212 = createHash('sha256').update(bare212).digest('hex').slice(0, 16);
  ok('★★★[正對照／逐字證明] 拿掉 v6.267 那一段之後，桌機 CSS 逐字還原回 v6.212',
    sha212 === DESKTOP_SHA_V6212 && bare212.length === 25315, sha212 + ' / len=' + bare212.length);
  // 逐條列出這一版**唯一**允許出現在非 @media 區的新字串（應為空）。
  ok('★★★[正對照] 桌機（非 @media）CSS 裡完全沒有本版新增的任何宣告',
    !bare.includes('flex-wrap: wrap; } .pk-search') && !/\.pk-search\s*\{[^}]*min-width:\s*0/.test(bare)
    && !/\.pk-set-select\s*\{[^}]*max-width:\s*100%/.test(bare)
    && !/font-size:\s*16px/.test(bare));
  ok('[正對照] 上一條不是恆真式：整份 CSS 裡確實有 16px 字級（只是全部關在手機區塊裡）',
    (CSS.match(/font-size:\s*16px/g) || []).length >= 1
    && (bare.match(/font-size:\s*16px/g) || []).length === 0,
    'CSS=' + (CSS.match(/font-size:\s*16px/g) || []).length + ' bare=' + (bare.match(/font-size:\s*16px/g) || []).length);
  // 新區塊只能有一個 @media，而且只有 ≤600px
  const _iNewBlk = (() => { const r = allRules(CSS).filter((x) => decl(x.body, 'font-size') === '16px'); return r.length ? r[0].at : CSS.length; })();
  const newBlockCond = SP.blocks.filter((b) => b.at < _iNewBlk && b.at + b.body.length + 40 > _iNewBlk).map((b) => b.cond);
  ok('★★★[正對照] 包住新規則的 @media 只在 ≤600px 生效（桌機根本不會套用）',
    newBlockCond.length === 1 && /max-width:\s*600px/.test(newBlockCond[0]), JSON.stringify(newBlockCond));
}

console.log('\n=== v6.213 ④ 手機版牌組編輯器: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('=== SCRIPT-END v6213-mobile-deck-editor ===');
if (fail) process.exit(1);
