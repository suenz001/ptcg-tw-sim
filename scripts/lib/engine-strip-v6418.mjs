/**
 * v6.418：engine.ts 相對前一版（v6.417）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.414 **之前**。
 *
 * 【v6.418 對 engine.ts 的唯一一組改動】
 *   `take-prize-choose` 登記 `PENDING_REFRESH_ON_POP` refresher —— 本版讓「取獎賞」的 picker
 *   可以排進 `pendingChainQueue`，取出時必須重算候選與 `remaining`（v6.215 的契約）。
 *
 * ⚠ 改動用 `// >>> v6418-xxx` / `// <<< v6418-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip418.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6418_PAIRS = [
  [
    "// >>> v6418-prize-picker-refresh\n// ⭐⭐⭐v6.418：`take-prize-choose` 從 `pendingChainQueue` 取出時重算候選（v6.215 的機制）。\n//\n// 【為什麼一定要有】v6.418 讓「取獎賞」的 picker 可以排隊（原本已有 pending 就自動取，\n//   會剝奪玩家指定的權利）。但排隊期間獎賞區可能已經被別的路徑動過：\n//   ・獎賞被取光 ⇒ 這一筆沒有對象了 ⇒ 回 `sel: null` 丟掉（v6.215 的契約）。\n//   ・`remaining` 比現有獎賞數還多 ⇒ 夾制，否則 resolver 會一直續開到空轉。\n//   ・已經沒有正面朝上的了 ⇒ 問也沒意義（蓋著的彼此無差異）⇒ 直接自動取完、丟掉這一筆。\n// ⚠ 依 v6.215 契約：refresher **只准改 `params`**，\n//   `type`／`effectKey`／`minCount`／`maxCount`／`actorIdx`／`sourcePlayerIdx` 一律照抄。\nPENDING_REFRESH_ON_POP.set('take-prize-choose', (state, sel, pool) => {\n  const idx = sel.actorIdx as 0 | 1;\n  const prizes = state.players[idx]?.prizes ?? [];\n  if (prizes.length === 0) return { state, sel: null };\n  const want = (sel.params?.remaining as number) ?? 1;\n  const remaining = Math.min(Math.max(1, want), prizes.length);\n  if (!prizes.some(c => c.faceUp)) {\n    // 沒有正面朝上的了 ⇒ 蓋著的彼此無差異，直接自動取完（與 resolver 尾端同一套語意）\n    const front = prizes.slice(0, remaining).map(c => c.iid);\n    return { state: takeSpecificPrizes(state, idx, front, pool), sel: null };\n  }\n  return {\n    state,\n    sel: {\n      ...sel,\n      params: {\n        ...sel.params,\n        remaining,\n        titleOverride: `取獎賞：還需取 ${remaining} 張。可指定翻正面的獎賞,或選「隨機取一張蓋著的」由系統代抽`,\n        options: buildPrizeTakeOptions(prizes, pool),\n      },\n    },\n  };\n});\n// <<< v6418-prize-picker-refresh\n",
    ""
  ]
];

/**
 * 把 v6.418 對 engine.ts 的合法改動逐字還原回前一版（v6.417）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6418Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6418_PAIRS.length; i++) {
    const [cur, base] = V6418_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6418Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip418.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
