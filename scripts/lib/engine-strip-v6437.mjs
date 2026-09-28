/**
 * v6.437：engine.ts 相對前一版（v6.436 ＝ v6.435 的 engine.ts，v6.436 沒有動 engine.ts）的「合法改動」還原器
 *   —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.435 **之前**（本版是最新的一版）。
 *
 * 【v6.437 對 engine.ts 的改動】（行內改動 ⇒ 逐字宣告 [本版, 前一版]）
 *   USE_ABILITY：使用特性的那一隻一律換成新物件（不限次數特性也一樣），並把新物件交給特性函式
 *   （特性函式就地改實體不會再改到傳進來的舊 state；純函式修正）。
 *
 * 本檔的錨點由腳本從實際 diff 擷取（difflib），並**當場驗證還原後逐字等於前一版**，不是手打。
 */

/** [本版的樣子, 前一版的樣子]；每一組都必須恰好命中 1 次。 */
const V6437_PAIRS = [
  [
    "    // 標記已使用（不限次數特性跳過）\n    const updatedPlayers = [...state.players] as [PlayerState, PlayerState];\n    const updatedP = { ...updatedPlayers[aIdx] };\n    // ⭐v6.437 使用特性的那一隻**一律換成新物件**（不限次數特性也一樣，只是不蓋「已使用」）：\n    //   有 10 個特性函式寫著 `instInPlay.abilityUsedThisTurn = true`（就地改實體）——實體若沿用舊 state 的物件，\n    //   就會連傳進來的舊 state 一起改（引擎是純函式；AI 試打、回放、錦標賽樂觀更新回滾都會讀到壞資料）。\n    //   換成新物件後，特性函式從 state 找到的就是這個新物件，就地改只會落在新 state 上。\n    //   並且把這個新物件（而不是舊 state 的 targetPoke）交給特性函式當 inst 參數。\n    const _markUsed = !UNLIMITED_USE_ABILITY_NAMES.has(ability.name);\n    let _actingInst: CardInstance = targetPoke;\n    const markUsed = (c: CardInstance): CardInstance => {\n      if (c.iid !== action.iid) return c;\n      _actingInst = _markUsed ? { ...c, abilityUsedThisTurn: true } : { ...c };\n      return _actingInst;\n    };\n    updatedP.active = updatedP.active ? markUsed(updatedP.active) : null;\n    updatedP.bench = updatedP.bench.map(markUsed);\n    // v2.91 → v2.93 修正：只有白名單特性（月光循環/使者衝刺）才記錄到\n    // abilityNamesUsedThisTurn；一般特性的「每回合 1 次」由 per-instance\n    // 的 abilityUsedThisTurn flag 負責。\n",
    "    // 標記已使用（不限次數特性跳過）\n    const updatedPlayers = [...state.players] as [PlayerState, PlayerState];\n    const updatedP = { ...updatedPlayers[aIdx] };\n    if (!UNLIMITED_USE_ABILITY_NAMES.has(ability.name)) {\n      const markUsed = (c: CardInstance): CardInstance =>\n        c.iid === action.iid ? { ...c, abilityUsedThisTurn: true } : c;\n      updatedP.active = updatedP.active ? markUsed(updatedP.active) : null;\n      updatedP.bench = updatedP.bench.map(markUsed);\n    }\n    // v2.91 → v2.93 修正：只有白名單特性（月光循環/使者衝刺）才記錄到\n    // abilityNamesUsedThisTurn；一般特性的「每回合 1 次」由 per-instance\n    // 的 abilityUsedThisTurn flag 負責。\n"
  ],
  [
    "    );\n    // 傳入觸發此特性的 CardInstance（以 iid 辨識），避免 ability 實作用\n    // name 掃場而在「同回合多隻同名寶可夢發動」時誤中第一隻。\n    return abilityFn(newState, aIdx, pool, _actingInst);\n  }\n\n  // ── v3.07 Deferred Wave D — 從手牌棄 1 張卡觸發場上特性 ────────────────────\n",
    "    );\n    // 傳入觸發此特性的 CardInstance（以 iid 辨識），避免 ability 實作用\n    // name 掃場而在「同回合多隻同名寶可夢發動」時誤中第一隻。\n    return abilityFn(newState, aIdx, pool, targetPoke);\n  }\n\n  // ── v3.07 Deferred Wave D — 從手牌棄 1 張卡觸發場上特性 ────────────────────\n"
  ]
];

export function stripV6437Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6437_PAIRS.length; i++) {
    const [cur, base] = V6437_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6437Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請依實際 diff 重新擷取錨點。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
