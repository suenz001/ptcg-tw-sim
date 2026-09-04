// ⭐ v6.311 中央 helper：「先剝註解、再做字串計數」—— 給所有用
//   `text.split(token).length - 1` 當守衛的腳本共用，別再各自重刻。
//
// ── 為什麼需要它（兩起實證事故）────────────────────────────────────────────
//  (1) 假紅：test-v6277【Gc】把 game/+page.svelte 裡一行**註解**提到的
//      `loadDecksFromCloud` 算成 Firestore 呼叫點（2 → 3），在完整 git 歷史下誤紅。
//  (2) 假綠（更危險）：第 13 種守衛安慰劑 —— 用 `/\/\*[\s\S]*?\*\//g` 剝區塊註解，
//      `//` 註解裡的 `/api/tournament/*` 被當成區塊開頭，**一路吃掉 176 行真程式碼**
//      （v6.310 的 game/+page.svelte :208～:384；server_admin_patch.js 更有一段吃 543 行）。
//      吃掉之後什麼都數不到 ⇒ 「恰一處」「零引用」這類斷言全變恆真。
//
// ── 這支 helper 刻意**只做行級排除、不做跨行區塊狀態機**────────────────────
//   丟掉「trim 後以 `//`、`/*`、`*`、`<!--` 開頭」的**整行**。其餘一律保留。
//   ⇒ 改不動的只有「同一行程式碼尾巴的註解」與「區塊註解裡不以 * 開頭的續行」，
//      方向是**保守**（最多把註解多算成程式碼 ⇒ 誤紅），**絕不會少算程式碼 ⇒ 誤綠**。
//   ⚠⚠ 千萬不要在這裡加回 block regex —— 1.4MB 的 svelte 檔裡滿是網址、正則、字串。
//
// ── 三道護欄（Rule 25：掃描器自身要先驗）───────────────────────────────────
//   stripCommentsChecked() 每次都會：
//     ① 長度護欄：剝完必須 ≥ minRatio（預設 50%）的原長，否則就是「一路吃掉」事故；
//     ② 正對照：mustKeep 裡的每個字串剝完必須還在（例如真呼叫點 'loadDecksFromCloud('）；
//     ③ 空輸入／非字串直接炸（AssertionError）。
//   呼叫端另外要有**已知答案表**（剝完後每個 token 的確切數字寫死在斷言裡，
//   不是拿新碼算期望值 —— 那是恆真斷言）。
import assert from 'node:assert';

/** 一行是不是「整行註解」。⚠ 只看行首（trim 後），不解析字串／正則／網址。 */
export const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*|<!--)/;

/**
 * 行級剝註解：丟掉整行註解，保留其他所有行（含行尾註解）。
 * 純函式、無護欄 —— 守衛請改用 stripCommentsChecked()。
 */
export function stripCommentLines(src) {
  return String(src).split('\n').filter((l) => !COMMENT_LINE_RE.test(l)).join('\n');
}

/**
 * 帶護欄的剝註解。
 * @param {string} src
 * @param {{ label?: string, minRatio?: number, mustKeep?: string[] }} [opt]
 *   label     —— 錯誤訊息用（哪個檔）
 *   minRatio  —— 剝完長度 / 原長 的下限（預設 0.5；註解特別多的小檔可以明寫低一點）
 *   mustKeep  —— 正對照：剝完之後這些字串必須還在（放「真呼叫點」的樣子）
 * @returns {string}
 */
export function stripCommentsChecked(src, { label = '', minRatio = 0.5, mustKeep = [] } = {}) {
  const tag = label ? label + '：' : '';
  assert.ok(typeof src === 'string' && src.length > 0, tag + '剝註解的輸入不是非空字串（讀錯檔？）');
  assert.ok(minRatio > 0 && minRatio <= 1, tag + 'minRatio 必須在 (0, 1]，實得 ' + minRatio);
  const out = stripCommentLines(src);
  const ratio = out.length / src.length;
  assert.ok(ratio >= minRatio,
    tag + '剝註解後只剩 ' + (ratio * 100).toFixed(1) + '%（護欄 ≥ ' + (minRatio * 100) + '%）⇒ 剝除器吃掉太多，這是「一路吃掉」事故（第 13 種安慰劑）');
  for (const k of mustKeep) {
    assert.ok(out.includes(k), tag + '剝註解後正對照「' + k + '」不見了 ⇒ 剝除器吃到真程式碼');
  }
  return out;
}

/**
 * 剝註解之後逐 token 計數：{ [token]: 出現次數 }。
 * 計數本身仍是純字串 split（跟原本守衛一樣），只是輸入先過 stripCommentsChecked()。
 */
export function countTokensStripped(src, tokens, opt) {
  assert.ok(Array.isArray(tokens) && tokens.length > 0, 'countTokensStripped：tokens 是空的');
  const t = stripCommentsChecked(src, opt);
  const o = {};
  for (const k of tokens) o[k] = t.split(k).length - 1;
  return o;
}
