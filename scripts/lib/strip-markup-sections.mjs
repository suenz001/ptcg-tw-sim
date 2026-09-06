// ⭐ 中央 helper：Svelte／HTML 原始碼的「模板 ／ HTML 註解 ／ script／style 區段」三層切分，
//   一律以**等長空白**取代（保留字元位移、行號、\r），給所有要對「模板區」或「CSS／腳本區」做斷言的守衛共用。
//
// ── 沿革（同一支剝除器連續四版被突變推翻；每一版檔頭都寫了「方向保證」，每一版都被證明是錯的）──
//   v6.310  區塊正則 /\/\*[\s\S]*?\*\//g       → `//` 註解裡的 `/api/x/*` 一路吃掉 176 行（假綠）
//   v6.311  行首是註解就丟整行                → `/* 註解 */ 程式碼` 整行被吃（假綠）
//   v6.316/317 先剝 HTML 註解、再抽區段       → 註解剝除也套在 script 內容上：JS 字串 '<!--' … '-->'
//                                             把中間的 import 整段空白化（三支守衛假綠，三道護欄都沒響）
//   v6.318  單趟行級狀態機：註解只在模板層認；區段只在行首開、只在行首收
//                                             → 「行首」與 Svelte 對「頂層 script／style」的定義沒對齊：檔首 BOM、
//                                               `<!-- x --><script>` 同一行、`</div><style>` 三種 Svelte 5 實測會編譯的形狀
//                                               全被當模板 ⇒ sections=0 ⇒ test-v6297 的相依圖把整棵子樹靜默剪掉（假綠）
//   v6.319（本版）① OPEN 允許檔首 BOM；② 「行首」改成「本行到此為止只有空白／已剝掉的註解／已剝掉的區段」；
//                 ③ 護欄⑦：剝完的模板層若還殘留 <script／<style 開頭標籤字面，數量與位置必須與呼叫端的 allowResidual 逐一對上
//                   （預設零條）—— 不管狀態機對「開頭」的定義還有什麼沒對齊，開頭標籤字面都不可能**靜默**留在模板層。
//   v6.320（本版）審查者行為端實證：護欄⑦只看**開頭**字面 ⇒ 兩種 Svelte 5.55 會 compile() 的形狀仍能靜默變模板：
//     ⛔-1 <style> 內的 CSS 註解 `/*\n</style>\n*/`：Svelte read_style 找 </style 之前會先吃掉 /* … */ 與 <!-- … -->
//         （node_modules/svelte/src/compiler/phases/1-parse/read/style.js 的 allow_comment_or_whitespace），helper 的 section 狀態
//         不看 CSS 註解 ⇒ 在註解裡的行首 </style> 提前收尾，後面整段 CSS（含 @media）流進模板層；殘留開頭字面 0、段數 1、比段數的裁判也綠。
//         （JS 同型 `/*\n</script>\n*/` Svelte 會報 Unterminated comment ⇒ build 紅，不算洞。）
//     ⛔-2 模板屬性值／表達式裡的 `<!--`（<p title="<!--">、{'<!--'}）：Svelte 當屬性值（AST Comment＝0）；helper 進 comment 狀態，
//         檔案後面若另有 `-->`，中間的 <script>／<style> 連內容、連收尾字面一起被當註解空白化 ⇒ 模板層零殘留、段數少一段；
//         後面沒有 `-->` 時紅在護欄①（沒有收尾）。
//     ⑧ 殘留字面改成「開頭＋收尾」都算（RESIDUAL_RE 加 `\/?`）：被提前收尾的區段，它真正的 </tag> 留在模板層（⛔-1 第 9 行）⇒ 紅。
//     ⑨ HTML 註解文字裡出現 </script／</style **收尾**字面 ⇒ 紅：⛔-2 被吞掉的區段，收尾字面在註解文字裡。
//        開頭字面在註解裡仍合法（方向 A；friends/+page.svelte 的說明註解提到 <style> 五次），只有收尾字面才是「註解吞了區段」的指紋。
//     ⑦⑧⑨ 共用 allowResidual；GAME_INLINE_STYLE 延長成整串（同一字串裡的開頭與收尾都在宣告範圍內）。
//     自驗 5-2 裁判從「比段數」改成「比範圍（start/end/innerStart/innerEnd）＋ 比每一個 HTML 註解的位移」（v6.320 實量 14 支 .svelte 13 支逐位相同，
//     唯一差異 friends/+page.svelte 的 <svelte:head><style> 釘成精確位移例外）。
//   ⚠ 仍沒有封住、只列明不宣稱的形狀：(a) 屬性值裡的 <!-- 到下一個 --> 之間**只有模板正文**（沒有區段）⇒ 只靠護欄③的比例擋；
//     (b) 多行區段裡不在行首的 </tag>（Svelte script 在那裡就收）⇒ helper 的區段比 Svelte 長，只有 5-2 的範圍裁判對 repo 檔會紅。
//   ⚠ 本檔檔頭只描述規則，不做任何方向宣稱；每一條規則能擋什麼，以 scripts/test-lib-strip-markup-sections.mjs
//     的突變（方向 A：註解含區段標籤字面；方向 B：腳本含註解字面；方向 C：BOM／同行註解／非行首頂層標籤）為準，突變沒紅就是這裡有洞。
//   ⚠ `</div><style>`（頂層但前面有別的標籤）Svelte 允許、prettier 不會產生、本站禁用此寫法：狀態機**不**認它
//     （要認就得追蹤元素深度，那是另一台掃描器與另一批洞），由護欄⑦擋成紅燈（fail-closed），不會靜默當模板。
//
// ── 狀態機規則（逐行、逐段）─────────────────────────────────────────────────
//   狀態：template ｜ comment ｜ opentag ｜ section
//   template：
//     a. 「行首」出現 <script 或 <style（不分大小寫）⇒ 進 opentag。
//        「行首」＝本行到此為止的輸出只有空白（含檔首 BOM）、已剝掉的註解、已剝掉的區段（v6.319）。
//        ⇒ `\uFEFF<script>`／`<!-- x --><script>`／`<script>a</script><script module>` 都算開頭（Svelte 5.55 parse() 同判）。
//        ⚠ 前面有任何模板正文（例：`<div>`、`</div>`、`{@html '`）的標籤字面**不**認為區段：
//          `<div><style>` 是巢狀元素（Svelte 也當模板）；`</div><style>` 由護欄⑦擋；`{@html '<style>'}` 由呼叫端 allowResidual 宣告。
//     b. 其餘文字掃 <!--：找得到同一行的 --> ⇒ 只空白化那一段；找不到 ⇒ 進 comment，本行剩餘空白化。
//   comment：找 -->；找不到整行空白化；找到 ⇒ 空白化到 --> 為止，剩餘回到 template 規則 b。
//        ⚠ 在 comment 狀態**不看**區段標籤 ⇒ 註解裡提到 <style>／</style> 字面不會開／關區段（方向 A）。
//   opentag：找開頭標籤的 >（允許屬性跨行）；`/>` 自閉合 ⇒ 空區段直接收；否則進 section。
//   section：只認兩種收尾：① 與開頭標籤**同一行**的 </tag>；② 之後某一行**行首**的 </tag>。
//        ⚠ 在 section 狀態**不看** <!-- ⇒ 腳本／樣式裡的字串 '<!--'／'-->' 不會被當註解（方向 B）。
//        ⚠ 多行區段裡不在行首的 </tag> 不算收尾 ⇒ 區段會一路吃到下一個行首收尾或檔尾；
//          檔尾 ⇒ 炸（未收尾）；行首再開同一種標籤 ⇒ 炸（巢狀）。全站 22 支 .svelte／.html 的收尾都在行首（v6.318 實掃）。
//
// ── 護欄（Rule 25：掃描器自身要先驗）──────────────────────────────────────────
//   ① 未收尾的 HTML 註解／區段 ⇒ 炸。                ② 單段註解 > maxCommentLines（預設 150）⇒ 炸。
//   ③ **單一**註解吃掉的非空白字元 ÷ **模板層**（區段已扣除、含註解）的非空白字元 > maxCommentRatio（預設 40%）⇒ 炸。
//      只在模板層 ≥ minTemplateForRatio（預設 200 個非空白字元）時套用 —— 幾十個字的內嵌樣本不談比例。
//      ⚠ v6.317 的分母是整檔（含 script＋style），模板只佔 game 的 23% ⇒ 註解把整個模板吃光也到不了 50%，那條護欄無牙。
//      ⚠ 用「單一註解」而不是「全部註解合計」：事故形狀是一段註解吃掉一大片；合計比例在 friends/+page.svelte 這種
//        「模板很小、說明註解很多」的合法檔已達 57%（v6.318 實量），拿合計當門檻不是誤紅就是無牙。
//   ④ 輸出長度與行數必須與輸入完全相同。          ⑤ mustKeep／mustDrop 正反對照，且**每個字串必須先在原檔存在**
//      （v6.317 的 mustDrop 寫成 '.prize-view-modal {'，原檔是無空格的 '.prize-view-modal{' ⇒ 反對照恆真）。
//   ⑥ minSections：呼叫端可要求至少找到幾個區段。
//   ⑦⑧ 殘留標籤字面（v6.319 開頭／v6.320 加收尾）：模板層每一個殘留的 <script／<style／</script／</style 字面都必須落在
//      allowResidual 某一條字串的範圍內，且每一條 allowResidual 至少蓋到一處殘留（沒蓋到＝白名單過期；每條字串必須含標籤字面、在原檔恰一處）。
//      全站唯一一條：game/+page.svelte 的 `{@html '<style>html, body { … }</style>'}` 整串（GAME_INLINE_STYLE，Svelte parse() 判它在 fragment 不在 css）。
//   ⑨ HTML 註解文字裡的 </script／</style 收尾字面（v6.320）：同樣必須落在 allowResidual 範圍內，否則紅（註解吞了區段的指紋）。
//   已知答案表（固定 blob、獨立 Python 實作量出後手抄）在 scripts/test-lib-strip-markup-sections.mjs。
import assert from 'node:assert';

/** 可被辨識的區段標籤。 */
export const SECTION_TAGS = ['script', 'style'];
const OPEN_RE = /^[ \t\uFEFF]*<(script|style)\b/i;      // \uFEFF：檔首 BOM（Svelte 照樣把後面的 <script> 當腳本）
const RESIDUAL_RE = /<\/?(script|style)\b/gi;        // v6.320：開頭與收尾字面都算殘留（護欄⑧）
const CLOSE_LITERAL_RE = /<\/(script|style)\b/gi;     // 護欄⑨：HTML 註解文字裡的收尾字面
/** 本行到此為止的輸出只有空白（含 BOM）／已剝掉的註解或區段 ⇒ 仍算「行首」。 */
const atLineStart = (out) => /^[\s\uFEFF]*$/.test(out);

/**
 * 全站唯一被允許殘留在模板層的標籤字面：src/routes/game/+page.svelte 的 svelte:head 內
 * `{@html '<style>html, body { … }</style>'}` 整串 —— 它是 JS 字串字面，Svelte parse() 把它放在 fragment（不是 css），
 * 剝除器當模板文字是對的。掃 game/+page.svelte 的呼叫端一律傳 allowResidual: [GAME_INLINE_STYLE]。
 * ⚠ v6.320 延長成整串：護欄⑧把收尾字面也算殘留，同一字串裡的 <style> 與 </style> 都要落在宣告範圍內。
 * 行為端證明：scripts/test-lib-strip-markup-sections.mjs 5-2 用 svelte/compiler parse() 逐檔比對區段**範圍**與註解位移，0-9 用內嵌樣本驗同一形狀。
 */
export const GAME_INLINE_STYLE = "{@html '<style>html, body { margin: 0; background-color: #162816 !important; min-height: 100vh; }</style>'}";
const closeAtLineStart = (tag) => new RegExp('^[ \\t]*<\\/' + tag + '\\s*>', 'i');
const closeAnywhere = (tag) => new RegExp('<\\/' + tag + '\\s*>', 'ig');

/** 等長空白化（保留 \n 與 \r）。⚠ 以 UTF-16 code unit 為單位，emoji 會變成兩個空白。 */
export const blank = (s) => s.replace(/[^\n\r]/g, ' ');
/** 舊介面相容：用正則挑出來的片段等長空白化。 */
export const blankOut = (s, re) => s.replace(re, (m) => blank(m));
/** 非空白字元數（UTF-16 code unit 計）。已知答案表用同一口徑。 */
export const nonWs = (s) => s.replace(/\s/g, '').length;

/**
 * 單趟行級狀態機（純掃描，只有「未收尾／巢狀」兩種硬錯誤）。
 * @param {string} src
 * @returns {{ template: string,
 *             sections: Array<{ tag: string, line: number, start: number, end: number, innerStart: number, innerEnd: number, full: string, inner: string }>,
 *             comments: Array<{ line: number, lines: number, start: number, end: number, text: string }> }}
 *   template ＝ 註解與所有區段（含標籤）等長空白化後的全文。
 */
export function scanMarkup(src, { label = '' } = {}) {
  const tag = label ? label + '：' : '';
  assert.ok(typeof src === 'string' && src.length > 0, tag + '輸入不是非空字串（讀錯檔？）');
  const lines = src.split('\n');
  const outLines = new Array(lines.length);
  const sections = [], comments = [];
  let state = 'template';
  let cur = null;    // 進行中的區段
  let cmt = null;    // 進行中的註解
  let offset = 0;    // 本行第一個字元在 src 的位移
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let out = '', pos = 0;
    while (pos < line.length) {
      if (state === 'comment') {
        const k = line.indexOf('-->', pos);
        if (k < 0) { out += blank(line.slice(pos)); pos = line.length; break; }
        out += blank(line.slice(pos, k + 3));
        comments.push({ line: cmt.line, lines: i - cmt.lineIdx + 1, start: cmt.start, end: offset + k + 3, text: src.slice(cmt.start, offset + k + 3) });
        cmt = null; pos = k + 3; state = 'template';
        continue;
      }
      if (state === 'opentag') {
        const k = line.indexOf('>', pos);
        if (k < 0) { out += blank(line.slice(pos)); pos = line.length; break; }
        out += blank(line.slice(pos, k + 1));
        const selfClosing = line.slice(pos, k).trimEnd().endsWith('/');
        pos = k + 1;
        cur.innerStart = offset + k + 1;
        if (selfClosing) {
          sections.push(finish(src, cur, cur.innerStart, offset + k + 1));
          cur = null; state = 'template';
        } else state = 'section';
        continue;
      }
      if (state === 'section') {
        let ci = -1, clen = 0;
        if (cur.lineIdx === i) {
          const re = closeAnywhere(cur.tag); re.lastIndex = pos;
          const m = re.exec(line);
          if (m) { ci = m.index; clen = m[0].length; }
        } else if (pos === 0) {
          const m = line.match(closeAtLineStart(cur.tag));
          if (m) { ci = m[0].indexOf('<'); clen = m[0].length - ci; }
        }
        if (ci < 0) {
          if (pos === 0 && cur.lineIdx !== i) {
            const o = line.match(OPEN_RE);
            assert.ok(!(o && o[1].toLowerCase() === cur.tag),
              tag + '第 ' + (i + 1) + ' 行行首又開了 <' + cur.tag + '>，但第 ' + cur.line + ' 行開的區段還沒收尾（巢狀／上一段的收尾不在行首）');
          }
          out += blank(line.slice(pos)); pos = line.length; break;
        }
        out += line.slice(pos, ci) === '' ? '' : blank(line.slice(pos, ci));
        out += blank(line.slice(ci, ci + clen));
        sections.push(finish(src, cur, offset + ci, offset + ci + clen));
        cur = null; pos = ci + clen; state = 'template';
        continue;
      }
      // template
      if (atLineStart(out)) {              // v6.319：pos===0 ⇒ 「本行到此為止只有空白／已剝掉的註解或區段」
        const o = line.slice(pos).match(OPEN_RE);
        if (o) {
          const ts = pos + o[0].indexOf('<');
          out += line.slice(pos, ts);       // 前導空白／BOM 原樣留在模板層
          cur = { tag: o[1].toLowerCase(), line: i + 1, lineIdx: i, start: offset + ts, innerStart: -1 };
          const next = pos + o[0].length;   // 停在標籤名之後，opentag 狀態接著找 >
          out += blank(line.slice(ts, next));
          pos = next;
          state = 'opentag';
          continue;
        }
      }
      const c = line.indexOf('<!--', pos);
      if (c < 0) { out += line.slice(pos); pos = line.length; break; }
      out += line.slice(pos, c);
      const e = line.indexOf('-->', c + 4);
      if (e < 0) {
        cmt = { line: i + 1, lineIdx: i, start: offset + c };
        out += blank(line.slice(c)); pos = line.length; state = 'comment';
        break;
      }
      out += blank(line.slice(c, e + 3));
      comments.push({ line: i + 1, lines: 1, start: offset + c, end: offset + e + 3, text: line.slice(c, e + 3) });
      pos = e + 3;
    }
    assert.strictEqual(out.length, line.length, tag + '第 ' + (i + 1) + ' 行等長空白化壞了（' + out.length + ' ≠ ' + line.length + '）');
    outLines[i] = out;
    offset += line.length + 1;
  }
  assert.ok(state !== 'comment', tag + '第 ' + (cmt && cmt.line) + ' 行的 HTML 註解沒有收尾（吃到檔尾）');
  assert.ok(state === 'template', tag + '第 ' + (cur && cur.line) + ' 行開的 <' + (cur && cur.tag) + '> 區段沒有收尾（吃到檔尾；多行區段的收尾必須在行首）');
  const template = outLines.join('\n');
  assert.strictEqual(template.length, src.length, tag + '剝完長度變了（等長空白化壞了）');
  return { template, sections, comments };
}
function finish(src, cur, innerEnd, end) {
  return { tag: cur.tag, line: cur.line, start: cur.start, end, innerStart: cur.innerStart, innerEnd,
    full: src.slice(cur.start, end), inner: src.slice(cur.innerStart, innerEnd) };
}

/**
 * 帶護欄的掃描：未收尾／超長註解／註解比例（分母＝模板層）／長度行數。
 * @param {string} src
 * @param {{ label?: string, maxCommentLines?: number, maxCommentRatio?: number, minTemplateForRatio?: number }} [opt]
 * @returns {{ template: string, sections: Array, comments: Array, commentRatio: number, commentTotalRatio: number }}
 *   commentRatio ＝ 最大單一註解 ÷ 模板層；commentTotalRatio ＝ 全部註解合計 ÷ 模板層（只回報，不斷言）
 */
export function scanMarkupChecked(src, { label = '', maxCommentLines = 150, maxCommentRatio = 0.4, minTemplateForRatio = 200, allowResidual = [] } = {}) {
  const tag = label ? label + '：' : '';
  assert.ok(Number.isInteger(maxCommentLines) && maxCommentLines > 0, tag + 'maxCommentLines 必須是正整數');
  assert.ok(maxCommentRatio > 0 && maxCommentRatio <= 1, tag + 'maxCommentRatio 必須在 (0, 1]');
  assert.ok(Array.isArray(allowResidual) && allowResidual.every((a) => typeof a === 'string' && a.length > 0), tag + 'allowResidual 必須是非空字串陣列');
  const r = scanMarkup(src, { label });
  // 護欄⑦⑧（v6.319／v6.320）：模板層殘留的開頭**與收尾**標籤字面 ⇔ 呼叫端宣告的 allowResidual 逐條對上
  const spans = allowResidual.map((a) => {
    assert.ok(new RegExp(RESIDUAL_RE.source, 'i').test(a), tag + 'allowResidual「' + a + '」本身不含 <script／<style／</script／</style 字面 ⇒ 白名單寫錯');
    const n = src.split(a).length - 1;
    assert.strictEqual(n, 1, tag + 'allowResidual「' + a + '」在原檔出現 ' + n + ' 次（必須恰一處）⇒ 白名單過期或打錯字');
    const at = src.indexOf(a);
    return { a, at, end: at + a.length };
  });
  const lineOf = (at) => src.slice(0, at).split('\n').length;
  const covered = (at) => spans.some((s) => s.at <= at && at < s.end);
  const residual = [...r.template.matchAll(RESIDUAL_RE)].map((m) => ({ at: m.index, kind: m[0][1] === '/' ? '收尾' : '開頭', line: lineOf(m.index), text: src.slice(m.index, m.index + 60).split('\n')[0] }));
  const uncovered = residual.filter((x) => !covered(x.at));
  assert.strictEqual(uncovered.length, 0,
    tag + '剝完的模板層還殘留 ' + uncovered.length + ' 處 <script／<style 標籤字面（開頭 ' + uncovered.filter((x) => x.kind === '開頭').length + '／收尾 ' + uncovered.filter((x) => x.kind === '收尾').length + '；不在 allowResidual 裡）：'
      + uncovered.slice(0, 8).map((x) => '第 ' + x.line + ' 行' + x.kind + '「' + x.text + '」').join('；')
      + ' ⇒ 開頭字面＝剝除器沒把它當區段（BOM／同行註解之後／</tag> 之後是剝除器的洞；字串字面請以 allowResidual 宣告並附行為端證明）；'
      + '收尾字面＝某一段區段被**提前收尾**（例：<style> 裡的 CSS 註解 /* </style> */，Svelte 會跳過註解、剝除器不會）⇒ 後面的內容已流進模板層');
  // 護欄⑨（v6.320）：HTML 註解文字裡的收尾字面 ＝ 註解吞了一段區段（屬性值／表達式裡的 <!-- 讓剝除器提前進入註解狀態）
  const inComment = [];
  for (const c of r.comments) for (const m of c.text.matchAll(CLOSE_LITERAL_RE)) inComment.push({ at: c.start + m.index, cmtLine: c.line, line: lineOf(c.start + m.index), text: c.text.slice(m.index, m.index + 60).split('\n')[0] });
  const swallowed = inComment.filter((x) => !covered(x.at));
  assert.strictEqual(swallowed.length, 0,
    tag + '第 ' + (swallowed[0] && swallowed[0].cmtLine) + ' 行開的 HTML 註解文字裡有 </script／</style 收尾字面（' + swallowed.slice(0, 4).map((x) => '第 ' + x.line + ' 行「' + x.text + '」').join('；')
      + '）⇒ 這段「註解」吞掉了一整段區段（模板屬性值／表達式裡的 <!-- 讓剝除器提前進入註解狀態，Svelte 把它當屬性值）；'
      + '若真的是註解裡寫收尾字面（本站禁用），請以 allowResidual 宣告並附行為端證明');
  for (const s of spans) {
    const hit = residual.filter((x) => s.at <= x.at && x.at < s.end).length + inComment.filter((x) => s.at <= x.at && x.at < s.end).length;
    assert.ok(hit >= 1, tag + 'allowResidual「' + s.a.slice(0, 40) + '…」沒有蓋到任何殘留標籤字面（模板層與註解都沒有）⇒ 白名單過期（那條字面已經變成真區段或已刪除），請刪掉');
  }
  for (const c of r.comments) {
    assert.ok(c.lines <= maxCommentLines,
      tag + '第 ' + c.line + ' 行開的 HTML 註解長達 ' + c.lines + ' 行（護欄 ≤ ' + maxCommentLines + '）⇒ 疑似「一路吃掉」事故');
  }
  const sectionNonWs = r.sections.reduce((n, s) => n + nonWs(s.full), 0);
  const templateWithCmt = nonWs(src) - sectionNonWs;             // 模板層（含註解）的非空白字元
  let cmtNonWs = 0, big = null, bigN = 0;
  for (const c of r.comments) { const n = nonWs(c.text); cmtNonWs += n; if (n > bigN) { bigN = n; big = c; } }
  const commentRatio = templateWithCmt === 0 ? 0 : bigN / templateWithCmt;
  const commentTotalRatio = templateWithCmt === 0 ? 0 : cmtNonWs / templateWithCmt;
  assert.ok(templateWithCmt < minTemplateForRatio || commentRatio <= maxCommentRatio,
    tag + '第 ' + (big && big.line) + ' 行開的 HTML 註解吃掉了模板層 ' + (commentRatio * 100).toFixed(1) + '% 的非空白字元（護欄 ≤ ' + (maxCommentRatio * 100) + '%，分母是扣掉 script／style 之後的模板）');
  assert.strictEqual(r.template.split('\n').length, src.split('\n').length, tag + '剝完行數變了');
  return { ...r, commentRatio, commentTotalRatio, residual };
}

const mustExist = (src, keys, tag, what) => {
  for (const k of keys) assert.ok(src.includes(k), tag + what + '「' + k + '」在原檔根本不存在 ⇒ 對照字串打錯字（反對照恆真）');
};

/**
 * 找出某一種 tag 的全部區段。
 * @returns {{ template: string, sections: Array }}
 */
export function markupSections(src, tag, opt = {}) {
  assert.ok(SECTION_TAGS.includes(tag), 'markupSections：tag 只能是 ' + SECTION_TAGS.join('／') + '，實得 ' + tag);
  const r = scanMarkupChecked(src, opt);
  const sections = r.sections.filter((s) => s.tag === tag);
  const min = opt.minSections ?? 0;
  assert.ok(sections.length >= min,
    (opt.label ? opt.label + '：' : '') + '只找到 ' + sections.length + ' 個 ' + tag + ' 區段（下限 ' + min + '）⇒ 抽取器壞了？（開頭標籤必須在行首）');
  return { template: r.template, sections };
}

/**
 * 只留模板：HTML 註解與 tags 裡的區段（含標籤）等長空白化。
 * @param {string} src
 * @param {{ label?: string, tags?: string[], mustKeep?: string[], mustDrop?: string[], minSections?: number,
 *           maxCommentLines?: number, maxCommentRatio?: number }} [opt]
 *   minSections —— 套用在**每一個** tag（預設 0；Svelte 元件檔建議給 1）
 */
export function templateOnly(src, opt = {}) {
  const { tags = SECTION_TAGS, mustKeep = [], mustDrop = [], label = '' } = opt;
  const t = label ? label + '：' : '';
  for (const tag of tags) assert.ok(SECTION_TAGS.includes(tag), t + 'templateOnly：tags 只能是 ' + SECTION_TAGS.join('／'));
  const r = scanMarkupChecked(src, opt);
  let out = r.template;
  const min = opt.minSections ?? 0;
  for (const tag of tags) {
    const n = r.sections.filter((s) => s.tag === tag).length;
    assert.ok(n >= min, t + '只找到 ' + n + ' 個 ' + tag + ' 區段（下限 ' + min + '）⇒ 抽取器壞了？（開頭標籤必須在行首）');
  }
  // 不在 tags 裡的區段要放回去（呼叫端只想剝其中一種）
  for (const s of r.sections) if (!tags.includes(s.tag)) out = out.slice(0, s.start) + s.full + out.slice(s.end);
  assert.strictEqual(out.length, src.length, t + '剝完長度變了（等長空白化壞了）');
  mustExist(src, mustKeep, t, '正對照');
  mustExist(src, mustDrop, t, '反對照');
  for (const k of mustKeep) assert.ok(out.includes(k), t + '剝完之後正對照「' + k + '」不見了 ⇒ 剝除器吃到模板');
  for (const k of mustDrop) assert.ok(!out.includes(k), t + '剝完之後「' + k + '」還在 ⇒ 區段沒剝乾淨');
  return out;
}

/**
 * 抽出某一種 tag 全部區段的內文，以 '\n' 串接。給 CSS 掃描（style）與 import 掃描（script）用。
 * ⚠ 區段內文**原樣**回傳（裡面的 <!-- 不是註解、不會被動）。
 */
export function sectionInner(src, tag, opt = {}) {
  const { sections } = markupSections(src, tag, opt);
  const joined = sections.map((s) => s.inner).join('\n');
  const t = opt.label ? opt.label + '：' : '';
  mustExist(src, opt.mustKeep ?? [], t, '正對照');
  for (const k of opt.mustKeep ?? []) assert.ok(joined.includes(k), t + tag + ' 區段內文找不到正對照「' + k + '」⇒ 抽取器壞了');
  return joined;
}
