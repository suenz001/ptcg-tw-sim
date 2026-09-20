/**
 * v6.413：engine.ts 相對前一版（v6.412）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.410 **之前**。
 *
 * 【v6.413 對 engine.ts 的唯一一組改動】
 *   `_attackSelfPenalty`（招致削傷在「本次攻擊」內的快照）要在每次 ATTACK 開頭重置，
 *   與既有的 `_attackerActiveBonusDone` 同一個 reset 物件字面量裡。
 *
 * ⚠ 改動用 `// >>> v6413-xxx` / `// <<< v6413-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip413.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6413_PAIRS = [
  [
    "      // >>> v6413-attack-self-penalty-reset\n      // ⭐v6.413：招致削傷的「本次攻擊快照」也要每次攻擊重置，\n      //   否則上一招的 -N 會漏到這一招（旗標本身早就被消耗掉了）。\n      _attackSelfPenalty: undefined,\n      // <<< v6413-attack-self-penalty-reset\n",
    ""
  ]
];

/**
 * 把 v6.413 對 engine.ts 的合法改動逐字還原回前一版（v6.412）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6413Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6413_PAIRS.length; i++) {
    const [cur, base] = V6413_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6413Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip413.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
