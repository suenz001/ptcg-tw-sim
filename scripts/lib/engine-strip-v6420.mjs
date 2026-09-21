/**
 * v6.420：engine.ts 相對前一版（v6.419）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.419 **之前**。
 *
 * 【v6.420 對 engine.ts 的唯一一組改動】
 *   `judgeEndgameV6361` 的「單方取完獎賞」分支：取完的那一方若**自己**沒有可上場的寶可夢
 *   ⇒ 雙方各自滿足一個勝利條件 ⇒ 平手（站長裁定）。**修改型**。
 *
 * ⚠ 改動用 `// >>> v6420-xxx` / `// <<< v6420-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip420.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6420_PAIRS = [
  [
    "    // >>> v6420-prize-and-no-mon-draw\n    // ⭐⭐⭐v6.420（站長裁定，逐字）：「單方取完6張獎賞、而同一瞬間該方自己也沒有寶可夢可上場，\n    //   如果攻擊方因此沒有能上場的寶可夢，應該判定為雙方平手（一方拿完獎賞卡，但自己卻沒有寶可夢可以上場）」。\n    //   ⇒ 取完獎賞的那一方（w）若自己 `noMon[w]`，則**雙方各自滿足一個勝利條件**\n    //     （w 取完獎賞、對手依放置規則獲勝）⇒ 同時達成 ⇒ 平手。\n    //   ⚠ 對手沒有寶可夢（`noMon[1 - w]`）的情形**不變**：兩個條件都指向 w 勝。\n    //   ⚠ 這一段只在 `withPrizeRule`（重判）時走得到，與「雙方都取完」那一格互斥（上面已 return）。\n    if (out[0] || out[1]) {\n      const w: 0 | 1 = out[0] ? 0 : 1;\n      if (noMon[w]) {\n        return { over: true, winner: null,\n          reason: `${ps[w].name} 取得所有獎賞卡，但同時沒有可上場的寶可夢` };\n      }\n      return { over: true, winner: w, reason: `${ps[w].name} 取得所有獎賞卡` };\n    }\n    // <<< v6420-prize-and-no-mon-draw\n",
    "    if (out[0]) return { over: true, winner: 0, reason: `${ps[0].name} 取得所有獎賞卡` };\n    if (out[1]) return { over: true, winner: 1, reason: `${ps[1].name} 取得所有獎賞卡` };\n"
  ]
];

/**
 * 把 v6.420 對 engine.ts 的合法改動逐字還原回前一版（v6.419）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6420Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6420_PAIRS.length; i++) {
    const [cur, base] = V6420_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6420Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip420.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
