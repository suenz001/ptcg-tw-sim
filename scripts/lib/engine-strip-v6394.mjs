/**
 * v6.394：engine.ts 相對前一版的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * 【為什麼要有這支檔】
 * 站內有兩支守衛對 engine.ts 做「位元組釘」（剝除後必須逐字等於 BASE）：
 *   ・test-v6265-phantom-start-race.mjs 的 F4c（BASE = v6.309）
 *   ・test-v6375-a1-fieldwide-asof.mjs 的 F0b（BASE = v6.374）
 * 兩支的 BASE 不同、剝除鏈也不同，但**每一版的還原內容是同一份**。
 * v6.394 起，新版本的還原器寫在這裡、兩支守衛各自 import —— 不要再各抄一份。
 *
 * ⚠ 呼叫端拿到的字串必須已經 normEol（LF）：BASE blob 一律 LF，工作樹是 CRLF。
 * ⚠ fail-closed：每一組錨點都必須在來源裡**恰好命中 1 次**，否則直接 throw
 *   （還原器過期時要大聲炸開，不可以靜默回傳原字串讓守衛以為「沒有改動」）。
 *
 * 【v6.394 對 engine.ts 的合法改動】站長裁示 ④「tsc 排一版清」：55 條型別錯誤清成 0。
 * 這個檔案裡的 7 組全部是**型別層**的修正，沒有一條改變執行期行為：
 *   ① oIdx 窄化（上一行已經 `if (oIdx < 0) return true;`）
 *   ② pendingSelection 統一成 undefined（全站其餘 4 處都是 undefined，只有這裡塞 null）
 *   ③ updatedActive 標上 CardInstance ＋ `!`（spread 可能為 null 的值會讓欄位全變 optional，
 *      那一行原本是 10 條 tsc 錯誤的單一源頭）
 *   ④⑤⑥ applyDefenderReductionsBlockA 的 defender.active 三處斷言
 *   ⑦⑧ isMegaExCard 的兩個呼叫點改用 `?.`（isMegaExCard 刻意不做型別述詞，見 selection-filter 的註解）
 */

/** [本版的樣子, BASE 的樣子]；順序無關，每一組都必須恰好命中 1 次。 */
const V6394_PAIRS = [
  [
    "    // \u26a0 \u4e0a\u4e00\u884c\u5df2\u7d93 `if (oIdx < 0) return true;` \u21d2 \u9019\u88e1\u53ea\u53ef\u80fd\u662f 0 \u6216 1\uff08TS \u5c0d `< 0` \u4e0d\u6703\u81ea\u52d5\u7a84\u5316 literal union\uff09\u3002\n"
    + "    return isAbilityHolderEffective(state, i, c, oIdx as 0 | 1, abName, loc, pool);\n",
    "    return isAbilityHolderEffective(state, i, c, oIdx, abName, loc, pool);\n",
  ],
  [
    "        // \u26a0 \u5168\u7ad9 pendingSelection \u7684\u300c\u6e05\u9664\u300d\u5beb\u6cd5\u662f undefined\uff08\u5176\u9918 4 \u8655\u90fd\u662f\uff09\uff0c\u53ea\u6709\u9019\u88e1\u585e null\u3002\n"
    + "        //   \u5169\u8005\u5c0d `if (state.pendingSelection)` \u7b49\u50f9\uff0c\u4f46\u5e8f\u5217\u5316\u6642 null \u6703\u88ab\u4e0a\u50b3\u3001undefined \u4e0d\u6703 \u21d2 \u7d71\u4e00\u3002\n"
    + "        pendingSelection: _picked ?? undefined,\n",
    "        pendingSelection: _picked,\n",
  ],
  [
    "      // \u26a0\u26a0 defenderState.active \u7684\u578b\u5225\u662f `CardInstance | null`\u3002spread \u4e00\u500b\u53ef\u80fd\u662f null \u7684\u503c\uff0c\n"
    + "      //   \u6703\u8b93 TS \u628a\u5c55\u958b\u5f8c\u7684**\u6bcf\u4e00\u500b\u6b04\u4f4d**\u90fd\u8b8a\u6210 optional \u2014\u2014 \u9019\u4e00\u884c\u66fe\u7d93\u662f 10 \u689d tsc \u932f\u8aa4\u7684\u55ae\u4e00\u6e90\u982d\u3002\n"
    + "      //   \u524d\u63d0\u672c\u4f86\u5c31\u6210\u7acb\uff1a\u4e0a\u9762 6400 \u5df2\u7d93\u62ff defenderState.active \u53bb\u8dd1 getAllAttachedTools\u3002\n"
    + "      const updatedActive: CardInstance = { ...defenderState.active!, damage: newDamage };\n",
    "      const updatedActive = { ...defenderState.active, damage: newDamage };\n",
  ],
  [
    "        && defender.active!.fossilOnField\n",
    "        && defender.active.fossilOnField\n",
  ],
  [
    "    if (baseDamage > 0 && defender.active!.takeExtraDamageThisTurn) {\n"
    + "      const extra = defender.active!.takeExtraDamageThisTurn;\n",
    "    if (baseDamage > 0 && defender.active.takeExtraDamageThisTurn) {\n"
    + "      const extra = defender.active.takeExtraDamageThisTurn;\n",
  ],
  [
    "      const defenderCardForTool = pool.get(defender.active!.cardId);\n",
    "      const defenderCardForTool = pool.get(defender.active.cardId);\n",
  ],
  [
    "      return isMegaExCard(c) && c?.pokemonType === 'Colorless';\n",
    "      return isMegaExCard(c) && c.pokemonType === 'Colorless';\n",
  ],
  [
    "          return isMegaExCard(cc) && cc?.pokemonType === 'Grass';\n",
    "          return isMegaExCard(cc) && cc.pokemonType === 'Grass';\n",
  ],
];

/**
 * 把 v6.394 對 engine.ts 的合法改動逐字還原回前一版的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6394Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6394_PAIRS.length; i++) {
    const [cur, base] = V6394_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6394Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（必須恰好 1 次）—— 還原器過期了，請比對 engine.ts 的實際內容。錨點開頭：'
        + cur.slice(0, 60).replace(/\n/g, '\\n'));
    }
    t = t.split(cur).join(base);
  }
  return t;
}

/** 還原器涵蓋幾組改動（給守衛做哨兵用）。 */
export const V6394_PAIR_COUNT = V6394_PAIRS.length;