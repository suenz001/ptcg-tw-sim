// ⭐ 中央 helper：Svelte／HTML 原始碼的「模板 ／ HTML 註解 ／ script／style 區段」三層切分，
//   一律以**等長空白**取代（保留字元位移、行號、\r），給所有要對「模板區」或「CSS／腳本區」做斷言的守衛共用。
//
// ── 沿革（同一支剝除器連續四版被突變推翻；每一版檔頭都寫了「方向保證」，每一版都被證明是錯的）──
//   v6.310  區塊正則 /\/\*[\s\S]*?\*\//g       → `//` 註解裡的 `/api/x/*` 一路吃掉 176 行（假綠）
//   v6.311  行首是註解就丟整行                → `/* 註解 */ 程式碼` 整行被吃（假綠）
//   v6.316/317 先剝 HTML 註解、再抽區段       → 註解剝除也套在 script 內容上：JS 字串 '<!--' … '-->'
//                                             把中間的 import 整段空白化（三支守衛假綠，三道護欄都沒響）
//   v6.318（本版）單趟行級狀態機：註解只在**模板層**認；區段只在**行首**開、只在**行首**收。
//   ⚠ 本檔檔頭只描述規則，不做任何方向宣稱；每一條規則能擋什麼，以 scripts/test-lib-strip-markup-sections.mjs
//     的突變（方向 A：註解含區段標籤字面；方向 B：腳本含註解字面）為準，突變沒紅就是這裡有洞。
//
// ── 狀態機規則（逐行、逐段）─────────────────────────────────────────────────
//   狀態：template ｜ comment ｜ opentag ｜ section
//   template：
//     a. 行首（允許前導空白／tab）出現 <script 或 <style（不分大小寫）⇒ 進 opentag。
//        ⚠ 不在行首的標籤字面（例：{@html '<style>…</style>'}）是模板文字，不是區段。
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
//   已知答案表（固定 blob、獨立 Python 實作量出後手抄）在 scripts/test-lib-strip-markup-sections.mjs。
import assert from 'node:assert';

/** 可被辨識的區段標籤。 */
export const SECTION_TAGS = ['script', 'style'];
const OPEN_RE = /^[ \t]*<(script|style)\b/i;
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
      if (pos === 0) {
        const o = line.match(OPEN_RE);
        if (o) {
          const ts = o[0].indexOf('<');
          out += line.slice(0, ts);
          cur = { tag: o[1].toLowerCase(), line: i + 1, lineIdx: i, start: offset + ts, innerStart: -1 };
          pos = ts + o[0].length - ts;      // 停在標籤名之後，opentag 狀態接著找 >
          out += blank(line.slice(ts, pos));
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
export function scanMarkupChecked(src, { label = '', maxCommentLines = 150, maxCommentRatio = 0.4, minTemplateForRatio = 200 } = {}) {
  const tag = label ? label + '：' : '';
  assert.ok(Number.isInteger(maxCommentLines) && maxCommentLines > 0, tag + 'maxCommentLines 必須是正整數');
  assert.ok(maxCommentRatio > 0 && maxCommentRatio <= 1, tag + 'maxCommentRatio 必須在 (0, 1]');
  const r = scanMarkup(src, { label });
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
  return { ...r, commentRatio, commentTotalRatio };
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
