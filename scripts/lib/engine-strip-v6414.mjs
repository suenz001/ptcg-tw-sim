/**
 * v6.414：engine.ts 相對前一版（v6.413）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.413 **之前**。
 *
 * 【v6.414 對 engine.ts 的改動】招式限定的下回合加傷／「傷害改為 N」覆寫：
 *   ・攻擊宣告時把招式名記進 `_attackTimeAttackName`（與其他 `_attackTime*` 同一個設定點）
 *   ・對應的最終清除
 *   ・END_TURN promote 一併搬招式名與覆寫欄位
 *   ・END_TURN 清除器涵蓋新的四個欄位
 *
 * ⚠ 改動都用 `// >>> v6414-xxx` / `// <<< v6414-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip414.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6414_PAIRS = [
  [
    "    // v5.325 太古防壁 attack-time 能量快照 — 卡面「能量為 N 個以下」依【發動攻擊宣告時】\n    //   攻擊方能量單位數計，不計入招式自身條件丟棄（判例：三重冰霜類自丟能量招式仍以開打前計）。\n    const attackTimeAttackerEnergyUnits = totalEnergyUnits(attacker.active.energyAttached, pool, state, aIdx, attacker.active);\n    workingState = { ...workingState, _attackTimeAttackerEnergyUnits: attackTimeAttackerEnergyUnits };\n    // >>> v6414-attack-time-attack-name-set\n    // ⭐⭐⭐v6.414：本次攻擊宣告的招式名 —— 招式限定的下回合加傷／覆寫要靠它比對。\n    //   ⚠ 刻意沿用**同一個**設定點（Rule 38：不另開 ATTACK 起點 hook），\n    //     這樣延後結算／狙擊路徑讀到的也是同一份快照。\n    workingState = { ...workingState, _attackTimeAttackName: attack.name };\n    // <<< v6414-attack-time-attack-name-set\n    // >>> v6373-as-of-declaration-holders-set\n    // ⭐⭐⭐v6.373 站長裁定 A-3（逐字：「凡是有這種類似的狀況，請你都比照 謝米［特性］花之帷幔\n    //   的判定邏輯」）：上面那 5 份 boolean 快照只記「宣告當時生沒生效」，分不出持有者後來是\n    //   **昏厥離場**（仍算數）還是**被主動移出場**（不算數 —— 仙子伊布ex｜天仙石 把對手備戰\n",
    "    // v5.325 太古防壁 attack-time 能量快照 — 卡面「能量為 N 個以下」依【發動攻擊宣告時】\n    //   攻擊方能量單位數計，不計入招式自身條件丟棄（判例：三重冰霜類自丟能量招式仍以開打前計）。\n    const attackTimeAttackerEnergyUnits = totalEnergyUnits(attacker.active.energyAttached, pool, state, aIdx, attacker.active);\n    workingState = { ...workingState, _attackTimeAttackerEnergyUnits: attackTimeAttackerEnergyUnits };\n    // >>> v6373-as-of-declaration-holders-set\n    // ⭐⭐⭐v6.373 站長裁定 A-3（逐字：「凡是有這種類似的狀況，請你都比照 謝米［特性］花之帷幔\n    //   的判定邏輯」）：上面那 5 份 boolean 快照只記「宣告當時生沒生效」，分不出持有者後來是\n    //   **昏厥離場**（仍算數）還是**被主動移出場**（不算數 —— 仙子伊布ex｜天仙石 把對手備戰\n"
  ],
  [
    "      }\n      if (c.damageBonusPending && c.damageBonusPending > 0) {\n        n = { ...n, damageBonusThisTurn: (n.damageBonusThisTurn ?? 0) + c.damageBonusPending };\n        delete n.damageBonusPending;\n        // >>> v6414-promote-attack-name\n        // ⭐v6.414：招式限定旗標與數值**配對搬運**（少搬一邊＝限定失效或永久殘留）。\n        if (c.damageBonusPendingAttackName) {\n          n = { ...n, damageBonusThisTurnAttackName: c.damageBonusPendingAttackName };\n          delete n.damageBonusPendingAttackName;\n        }\n        // <<< v6414-promote-attack-name\n      }\n      // >>> v6414-promote-override\n      // ⭐v6.414：步哨鼠｜聚氣的「傷害**改為** N」覆寫（與加傷是不同語意，不可相加）。\n      if (c.damageOverridePending && c.damageOverridePending > 0) {\n        n = { ...n, damageOverrideThisTurn: c.damageOverridePending };\n        delete n.damageOverridePending;\n        if (c.damageOverridePendingAttackName) {\n          n = { ...n, damageOverrideThisTurnAttackName: c.damageOverridePendingAttackName };\n          delete n.damageOverridePendingAttackName;\n        }\n      }\n      // <<< v6414-promote-override\n      if (c.cantRetreatPendingSelf) {\n        n = { ...n, cantRetreatNextTurn: true };\n        delete n.cantRetreatPendingSelf;\n      }\n",
    "      }\n      if (c.damageBonusPending && c.damageBonusPending > 0) {\n        n = { ...n, damageBonusThisTurn: (n.damageBonusThisTurn ?? 0) + c.damageBonusPending };\n        delete n.damageBonusPending;\n      }\n      if (c.cantRetreatPendingSelf) {\n        n = { ...n, cantRetreatNextTurn: true };\n        delete n.cantRetreatPendingSelf;\n      }\n"
  ],
  [
    "      return n;\n    };\n    // 清除目前玩家 active/bench 上殘留的 damageBonusThisTurn（若攻擊未命中用掉）\n    const clearDmgBonusThisTurn = (c: CardInstance): CardInstance => {\n      // >>> v6414-clear-attack-scoped\n      // ⭐v6.414：招式限定的招式名與「改為 N」覆寫也要一起清 —— 少清一邊會殘留到下一個回合。\n      //   ⚠ 進入條件改成「四個欄位任一存在」：原本只看 damageBonusThisTurn，\n      //     覆寫型（沒有 damageBonusThisTurn）會整個漏清。\n      if (!c.damageBonusThisTurn && !c.damageBonusThisTurnAttackName\n        && !c.damageOverrideThisTurn && !c.damageOverrideThisTurnAttackName) return c;\n      const n = { ...c };\n      delete n.damageBonusThisTurn;\n      delete n.damageBonusThisTurnAttackName;\n      delete n.damageOverrideThisTurn;\n      delete n.damageOverrideThisTurnAttackName;\n      return n;\n      // <<< v6414-clear-attack-scoped\n    };\n    // v2.92：於 aIdx 方清除本回合已消耗完的 blockedAttackNamesThisTurn\n    const clearBlockedAttackThisTurn = (c: CardInstance): CardInstance => {\n      if (!c.blockedAttackNamesThisTurn || c.blockedAttackNamesThisTurn.length === 0) return c;\n",
    "      return n;\n    };\n    // 清除目前玩家 active/bench 上殘留的 damageBonusThisTurn（若攻擊未命中用掉）\n    const clearDmgBonusThisTurn = (c: CardInstance): CardInstance => {\n      if (!c.damageBonusThisTurn) return c;\n      const n = { ...c }; delete n.damageBonusThisTurn; return n;\n    };\n    // v2.92：於 aIdx 方清除本回合已消耗完的 blockedAttackNamesThisTurn\n    const clearBlockedAttackThisTurn = (c: CardInstance): CardInstance => {\n      if (!c.blockedAttackNamesThisTurn || c.blockedAttackNamesThisTurn.length === 0) return c;\n"
  ],
  [
    "    const cleared = { ...next };\n    delete cleared._attackTimeAttackerEnergyUnits;\n    next = cleared;\n  }\n  // >>> v6414-attack-time-attack-name-clear\n  // ⭐v6.414：本次攻擊的招式名快照 同步清除（與上面同一個時機）。\n  if (next._attackTimeAttackName !== undefined && !next.pendingSelection) {\n    const cleared = { ...next };\n    delete cleared._attackTimeAttackName;\n    next = cleared;\n  }\n  // <<< v6414-attack-time-attack-name-clear\n\n  // v5.335：集中偵測「自方戰鬥寶可夢於自己回合回到自己備戰區」→ 觸發 ON_RETREAT_TO_BENCH 類特性\n  //   （海豚俠｜全能變身 / 鋼炮臂蝦｜返回重載）。原本只有 RETREAT handler inline 觸發；衝浪手 /\n  //   寶可夢交替 / 急進開關 / 頂尖捕捉器 / 烏栗 等互換 supporter/item/招式 走 swap helper 沒觸發\n",
    "    const cleared = { ...next };\n    delete cleared._attackTimeAttackerEnergyUnits;\n    next = cleared;\n  }\n\n  // v5.335：集中偵測「自方戰鬥寶可夢於自己回合回到自己備戰區」→ 觸發 ON_RETREAT_TO_BENCH 類特性\n  //   （海豚俠｜全能變身 / 鋼炮臂蝦｜返回重載）。原本只有 RETREAT handler inline 觸發；衝浪手 /\n  //   寶可夢交替 / 急進開關 / 頂尖捕捉器 / 烏栗 等互換 supporter/item/招式 走 swap helper 沒觸發\n"
  ]
];

/**
 * 把 v6.414 對 engine.ts 的合法改動逐字還原回前一版（v6.413）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6414Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6414_PAIRS.length; i++) {
    const [cur, base] = V6414_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6414Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip414.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
