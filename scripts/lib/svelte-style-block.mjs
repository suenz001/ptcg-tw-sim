/**
 * scripts/lib/svelte-style-block.mjs
 * ⭐⭐⭐ 「Svelte 檔案的樣式區塊在哪裡」的**單一判準**（IRON_RULES Rule 38）。
 *
 * 【為什麼要有這個檔】v6.391 現查：這個判準被抄在 **29 個呼叫點**（20+ 支守衛／量測工具）裡，
 * 全部是自己寫 `src.lastIndexOf('<' + 'style')`。後果有三：
 *   ① 其中一份寫成 `indexOf` 就會**靜默切歪**（css-cascade.mjs 踩過）——
 *      `+page.svelte` 的 <svelte:head> 裡有一段 `{@html '…'}` 注入樣式，
 *      那個開頭字面排在真標籤**之前**，用 indexOf 會把中間 4,900 行 markup／JS 當成 CSS。
 *   ② 一旦有人在註解裡寫出開頭字面，**29 個呼叫點會一起壞**，而且訊息全是
 *      「抽不到 CSS 規則」，看起來像 CSS 壞了（v6.390 第一版就這樣同時紅了 7 支）。
 *   ③ 沒有任何一份有 fail-closed —— 切歪了照樣回傳，守衛拿垃圾去比對還會亮綠燈。
 *
 * ⚠⚠ 本檔自己**不可以**寫出開頭字面（用 '<' + 'style' 組出來）—— 這個檔也會被自己掃到。
 * ⚠ 全部 API 在找不到／切歪時一律 **throw**，不回傳可疑值（fail-closed）。
 */

const OPEN = '<' + 'style';
const CLOSE = '</' + 'style>';

/** 開頭標籤的位移。＝ 舊寫法的 `src.lastIndexOf(開頭字面)`。找不到就炸。 */
export function styleTagIndex(src, what = 'svelte 檔') {
  const s = String(src);
  const i = s.lastIndexOf(OPEN);
  if (i < 0) throw new Error(what + ' 找不到樣式區塊的開頭標籤');
  // ⭐⭐ IRON_RULES Rule 48 的中央化：開頭標籤不可以落在註解裡。
  //   有人在 CSS／JS 註解裡寫出開頭字面，lastIndexOf 就會被推到那裡
  //   ⇒ 它前面的規則全部抽不到，而且訊息看起來像 CSS 壞了（v6.390 同時紅了 7 支）。
  //   判準：標籤之前最後一個 `/*` 要是沒有對應的 `*/`，就是落在註解裡。
  //   ⚠ 這個判準對「字串裡的 /*」會誤判 —— 但方向是 fail-closed（誤紅），
  //     而且本 repo 現況不會誤紅（test-v6392 B8 反面對照在守）。
  const before = s.slice(0, i);
  const lastOpen = before.lastIndexOf('/*');
  const lastClose = before.lastIndexOf('*/');
  if (lastOpen > lastClose) {
    throw new Error(what + ' 的樣式區塊開頭標籤落在註解裡（IRON_RULES Rule 48）：'
      + '註解裡不可以寫出樣式標籤的開頭字面，寫「樣式區塊」四個字就好。');
  }
  return i;
}

/** 結束標籤的位移。＝ 舊寫法的 `src.lastIndexOf(結束字面)`。 */
export function styleEndIndex(src, what = 'svelte 檔') {
  const i = String(src).lastIndexOf(CLOSE);
  if (i < 0) throw new Error(what + ' 找不到樣式區塊的結束標籤');
  return i;
}

/**
 * 從開頭標籤起到檔尾。＝ 舊寫法的 `src.slice(src.lastIndexOf(開頭字面))`。
 * ⚠ 含開頭標籤本身（很多守衛的正則是靠這個錨定的，所以刻意保留舊語意）。
 */
export function styleBlockOf(src, what = 'svelte 檔') {
  const a = styleTagIndex(src, what);
  const block = String(src).slice(a);
  assertLooksLikeStyleBlock(block, what);
  return block;
}

/** 純 CSS 內容（不含標籤）。＝ `slice(indexOf('>', open) + 1, lastIndexOf(結束字面))`。 */
export function cssOf(src, what = 'svelte 檔') {
  const s = String(src);
  const a = styleTagIndex(s, what);
  const gt = s.indexOf('>', a);
  const e = styleEndIndex(s, what);
  if (gt < 0 || e <= gt) throw new Error(what + ' 的樣式區塊起訖不合理');
  const css = s.slice(gt + 1, e);
  assertLooksLikeStyleBlock(css + CLOSE, what);   // 補回結束標籤再驗，判準與 styleBlockOf 一致
  return css;
}

/** 樣式區塊**之前**的部分（markup ＋ script）。＝ `src.slice(0, src.lastIndexOf(開頭字面))`。 */
export function markupBeforeStyle(src, what = 'svelte 檔') {
  return String(src).slice(0, styleTagIndex(src, what));
}

/**
 * fail-closed 判準：正確切出來的區塊裡，結束標籤**只會出現一次**（就是最後那個）。
 * 出現兩次以上 ⇒ 起點取到了更前面的假標籤（`{@html '…'}` 注入的那一段）。
 * ⚠ 不可以拿 `<div` 或條件區塊字面當判準 —— CSS 註解裡本來就寫得到那些字
 *   （現查：.tourn-nt 的註解就有條件區塊與 `<p class="warn">`）。
 */
export function assertLooksLikeStyleBlock(block, what = 'svelte 檔') {
  const n = String(block).split(CLOSE).length - 1;
  if (n !== 1) {
    throw new Error(what + ' 的樣式區塊切歪了：區塊內出現 ' + n + ' 個結束標籤'
      + '（正確切法只會有 1 個）。最可能的原因是用了 indexOf 而不是 lastIndexOf，'
      + '或是有人在註解裡寫出了開頭字面。');
  }
}
