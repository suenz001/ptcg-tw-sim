// ⭐ 中央 helper：Svelte／HTML 原始碼的「剝 HTML 註解 → 剝（或抽出）script／style 區段」，
//   一律以**等長空白**取代（保留字元位移與行號），給所有要對「模板區」或「CSS 區」做斷言的守衛共用。
//
// ── 為什麼需要它（v6.317，第三起同型事故）────────────────────────────────────
//   test-v6190 的 templateOnly() 原本的順序是「先剝 script → 再剝 style → 最後剝 HTML 註解」。
//   只要有一段 HTML 註解裡**提到**樣式標籤的字面，非貪婪的 style 正則就會從那段註解一路吃到
//   真正的樣式收尾標籤 ⇒ 整段模板被清空（實測 game/+page.svelte 從 184,279 個非空白字元剩 30、
//   MobilePortraitBattle.svelte 從 22,587 剩 8）⇒ 之後所有「某段 DOM 在某情境會不會渲染」的斷言全變恆真。
//   同一族的 script 抽取（test-v6288／v6296／v6297）方向相反（會多抽、不會少抽），但形狀一樣，一併收斂。
//
// ── 做法 ─────────────────────────────────────────────────────────────────
//   1. **先**把 HTML 註解等長空白化（每段註解有行數與比例護欄，見下）。
//   2. 再找區段：開頭標籤必須在**行首**（允許前導空白），收尾取最近的一個。
//      ⚠ 行首限制是刻意的：模板裡 `{@html '…'}` 字串字面內的樣式標籤不在行首，不會被當成區段
//      （v6.316 之前那個字面會被算進 CSS，審查者指出過；這裡順手排除，不另加特例）。
//   3. templateOnly()：把區段等長空白化；sectionInner()：把區段內文抽出來（給 CSS／import 掃描）。
//
// ── 護欄（Rule 25：掃描器自身要先驗；⚠ 不宣稱「絕不會少算」，只列出實際擋得住的形狀）──
//   ① 每段 HTML 註解 ≤ maxCommentLines（預設 150）且必須有收尾；未收尾＝吃到檔尾 ⇒ 炸。
//   ② 註解合計吃掉的非空白字元 ≤ maxCommentRatio（預設 50%）⇒ 否則炸。
//   ③ 輸出長度與行數必須與輸入完全相同（位移／行號才可信）。
//   ④ mustKeep／mustDrop 正反對照：剝完之後某些字串必須還在／必須不見。
//   ⑤ minSections：呼叫端可要求至少找到幾個區段（抽不到＝抽取器壞了，不是「沒有」）。
//   已知答案表（固定 blob 量出、手抄）在 scripts/test-lib-strip-markup-sections.mjs。
import assert from 'node:assert';

export const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** 等長空白化（保留換行）。⚠ 以 UTF-16 code unit 為單位（JS 字串長度），emoji 會變成兩個空白。 */
export const blankOut = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '));

/** 非空白字元數（UTF-16 code unit 計）。已知答案表用同一口徑。 */
export const nonWs = (s) => s.replace(/\s/g, '').length;

/** 區段正則：開頭標籤在行首（允許前導空白）、收尾取最近的一個。 */
export function sectionRe(tag) {
  assert.ok(/^[a-z]+$/.test(tag), 'sectionRe：tag 必須是小寫字母，實得 ' + tag);
  return new RegExp('^[ \\t]*<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gm');
}

/**
 * 先剝 HTML 註解（等長空白化），帶護欄。
 * @returns {{ out: string, comments: Array<{ line: number, lines: number }> }}
 */
export function blankHtmlCommentsChecked(src, { label = '', maxCommentLines = 150, maxCommentRatio = 0.5 } = {}) {
  const tag = label ? label + '：' : '';
  assert.ok(typeof src === 'string' && src.length > 0, tag + '輸入不是非空字串（讀錯檔？）');
  assert.ok(Number.isInteger(maxCommentLines) && maxCommentLines > 0, tag + 'maxCommentLines 必須是正整數');
  assert.ok(maxCommentRatio > 0 && maxCommentRatio <= 1, tag + 'maxCommentRatio 必須在 (0, 1]');
  const comments = [];
  for (const m of src.matchAll(HTML_COMMENT_RE)) {
    const line = src.slice(0, m.index).split('\n').length;
    const lines = m[0].split('\n').length;
    comments.push({ line, lines });
    assert.ok(lines <= maxCommentLines,
      tag + '第 ' + line + ' 行開的 HTML 註解長達 ' + lines + ' 行（護欄 ≤ ' + maxCommentLines + '）⇒ 疑似「一路吃掉」事故');
  }
  // 未收尾：最後一個開頭標記之後找不到收尾標記
  const lastOpen = src.lastIndexOf('<!--');
  if (lastOpen >= 0) {
    assert.ok(src.indexOf('-->', lastOpen + 4) >= 0,
      tag + '第 ' + src.slice(0, lastOpen).split('\n').length + ' 行的 HTML 註解沒有收尾（吃到檔尾）');
  }
  const out = blankOut(src, HTML_COMMENT_RE);
  const before = nonWs(src), after = nonWs(out);
  assert.ok(before === 0 || (before - after) / before <= maxCommentRatio,
    tag + 'HTML 註解吃掉了 ' + (((before - after) / before) * 100).toFixed(1) + '% 的非空白字元（護欄 ≤ ' + (maxCommentRatio * 100) + '%）');
  assert.strictEqual(out.length, src.length, tag + '剝註解後長度變了（等長空白化壞了）');
  return { out, comments };
}

/**
 * 找出所有 tag 區段（**先**剝 HTML 註解再找）。
 * @returns {{ out: string, sections: Array<{ line: number, start: number, end: number, full: string, inner: string }> }}
 *   out ＝ 剝掉 HTML 註解後的全文（區段仍在）。
 */
export function markupSections(src, tag, opt = {}) {
  const { out } = blankHtmlCommentsChecked(src, opt);
  const sections = [];
  for (const m of out.matchAll(sectionRe(tag))) {
    sections.push({ line: out.slice(0, m.index).split('\n').length, start: m.index, end: m.index + m[0].length, full: m[0], inner: m[1] });
  }
  const min = opt.minSections ?? 0;
  assert.ok(sections.length >= min,
    (opt.label ? opt.label + '：' : '') + '只找到 ' + sections.length + ' 個 ' + tag + ' 區段（下限 ' + min + '）⇒ 抽取器壞了？（開頭標籤必須在行首）');
  return { out, sections };
}

/**
 * 只留模板：HTML 註解 → script → style 依序等長空白化。
 * @param {string} src
 * @param {{ label?: string, tags?: string[], mustKeep?: string[], mustDrop?: string[], minSections?: number,
 *           maxCommentLines?: number, maxCommentRatio?: number }} [opt]
 *   minSections —— 套用在**每一個** tag（預設 0；Svelte 元件檔建議給 1）
 */
export function templateOnly(src, opt = {}) {
  const { tags = ['script', 'style'], mustKeep = [], mustDrop = [], label = '' } = opt;
  const t = label ? label + '：' : '';
  let out = blankHtmlCommentsChecked(src, opt).out;
  for (const tag of tags) {
    const { sections } = markupSections(out, tag, { ...opt, maxCommentRatio: 1 });   // 註解已剝，比例護欄不再適用
    for (const s of sections) out = out.slice(0, s.start) + s.full.replace(/[^\n]/g, ' ') + out.slice(s.end);
  }
  assert.strictEqual(out.length, src.length, t + '剝完長度變了（等長空白化壞了）');
  assert.strictEqual(out.split('\n').length, src.split('\n').length, t + '剝完行數變了');
  for (const k of mustKeep) assert.ok(out.includes(k), t + '剝完之後正對照「' + k + '」不見了 ⇒ 剝除器吃到模板');
  for (const k of mustDrop) assert.ok(!out.includes(k), t + '剝完之後「' + k + '」還在 ⇒ 區段沒剝乾淨');
  return out;
}

/**
 * 抽出所有 tag 區段的內文（先剝 HTML 註解），以 '\n' 串接。給 CSS 掃描（style）與 import 掃描（script）用。
 */
export function sectionInner(src, tag, opt = {}) {
  const { sections } = markupSections(src, tag, opt);
  const joined = sections.map((s) => s.inner).join('\n');
  const t = opt.label ? opt.label + '：' : '';
  for (const k of opt.mustKeep ?? []) assert.ok(joined.includes(k), t + tag + ' 區段內文找不到正對照「' + k + '」⇒ 抽取器壞了');
  return joined;
}
