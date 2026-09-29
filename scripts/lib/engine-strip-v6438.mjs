/**
 * v6.438：engine.ts 相對前一版（v6.437；v6.438 前一顆 25391a6a 的 engine.ts 與 v6.437 相同）的「合法改動」還原器
 *   —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.437 **之前**（本版是最新的一版）。
 *
 * 【v6.438 對 engine.ts 的改動】（行內改動 ⇒ 逐字宣告 [本版, 前一版]）
 *   移除私有集合 SECOND_PLAYER_FIRST_TURN_ONLY 與 ATTACK handler／getAvailableAttacks 的兩處判斷；
 *   「只可在後攻玩家的最初回合使用」改走中央 ATTACK_USE_PRECONDITION（借招候選也問同一份，站長 2026-09-29 裁定的原則）。
 *
 * 本檔的錨點由腳本從實際 diff 擷取（difflib），並**當場驗證還原後逐字等於前一版**，不是手打。
 */

/** [本版的樣子, 前一版的樣子]；每一組都必須恰好命中 1 次。 */
const V6438_PAIRS = [
  [
    "      //   故「turn === 1 且行動者是後攻方」＝ 後攻玩家的最初回合。與 items_misc.ts v4.940\n      //   幫忙鈴／悠哉尾草棒 的修法（改用 st.turn）同一慣例。\n      // ⭐v6.438：判準搬進中央 ATTACK_USE_PRECONDITION（attack-use-precondition.ts 的 secondPlayerFirstTurnOnlyBlock），\n      //   由下方的 per-attack 使用前提統一判（借招候選也問同一份）。\n      // >>> v6350-attack-precondition\n      // ⭐⭐v6.350 中央 per-attack 使用前提（`ATTACK_USE_PRECONDITION`）。\n",
    "      //   故「turn === 1 且行動者是後攻方」＝ 後攻玩家的最初回合。與 items_misc.ts v4.940\n      //   幫忙鈴／悠哉尾草棒 的修法（改用 st.turn）同一慣例。\n      if (attackName && SECOND_PLAYER_FIRST_TURN_ONLY.has(attackName)) {\n        const isSecondPlayer = aIdx !== state.firstPlayerIdx;\n        if (state.turn !== 1 || !isSecondPlayer) {\n          return addLog(state,\n            `${atkName}：「${attackName}」只能在後攻方最初回合使用`,\n            aIdx);\n        }\n      }\n      // >>> v6350-attack-precondition\n      // ⭐⭐v6.350 中央 per-attack 使用前提（`ATTACK_USE_PRECONDITION`）。\n"
  ],
  [
    "//   (同 canRetreat/getRetreatBlockReason 各寫一份的反模式)。提升為模組級單一來源,\n//   引擎拒絕(ATTACK)與 UI 反白(getAvailableAttacks)永遠引用同一份,不會分歧。\n// ⭐v6.438：集合移除 —— 改在卡片檔登記 regAttackPrecondition（判準 secondPlayerFirstTurnOnlyBlock，leaf 模組\n//   attack-use-precondition.ts），ATTACK handler／getAvailableAttacks／借招候選三處共用同一份。\n// ⭐v6.435 玩家層級招式冷卻（天仙石／渾沌匍匐）的集合與中央述詞搬到 leaf 模組 player-attack-cooldown.ts：\n//   借招家族的中央候選枚舉（copy-attack.ts）也要問同一個判準（站長裁定：借不到冷卻中的天仙石），\n",
    "//   (同 canRetreat/getRetreatBlockReason 各寫一份的反模式)。提升為模組級單一來源,\n//   引擎拒絕(ATTACK)與 UI 反白(getAvailableAttacks)永遠引用同一份,不會分歧。\nconst SECOND_PLAYER_FIRST_TURN_ONLY = new Set<string>(['絕叫', '慢芬香']);\n// ⭐v6.435 玩家層級招式冷卻（天仙石／渾沌匍匐）的集合與中央述詞搬到 leaf 模組 player-attack-cooldown.ts：\n//   借招家族的中央候選枚舉（copy-attack.ts）也要問同一個判準（站長裁定：借不到冷卻中的天仙石），\n"
  ],
  [
    "      // ⭐ v6.103：判準與引擎端一起從 isFirstTurn 改為 turn === 1（原寫法永遠 false，見上方詳解）。\n      //   兩端**必須同步改**，否則會出現「按鈕亮著但送出被擋」或反之。\n      //   ⭐v6.438：判準搬進中央 ATTACK_USE_PRECONDITION（上方 v6350 區塊已判，借招候選也問同一份）。\n      // v5.010：bench-fill 類招式（如「呼朋引伴」放基礎寶可夢到備戰）— 備戰滿時禁用\n      //   原本只在 regPost 內做檢查（attack 已 fire、log「備戰區已滿」），\n",
    "      // ⭐ v6.103：判準與引擎端一起從 isFirstTurn 改為 turn === 1（原寫法永遠 false，見上方詳解）。\n      //   兩端**必須同步改**，否則會出現「按鈕亮著但送出被擋」或反之。\n      if (SECOND_PLAYER_FIRST_TURN_ONLY.has(atk.name)) {\n        const isSecondPlayer = state.activePlayerIndex !== state.firstPlayerIdx;\n        if (state.turn !== 1 || !isSecondPlayer) return -1;\n      }\n      // v5.010：bench-fill 類招式（如「呼朋引伴」放基礎寶可夢到備戰）— 備戰滿時禁用\n      //   原本只在 regPost 內做檢查（attack 已 fire、log「備戰區已滿」），\n"
  ]
];

export function stripV6438Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6438_PAIRS.length; i++) {
    const [cur, base] = V6438_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6438Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請依實際 diff 重新擷取錨點。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
