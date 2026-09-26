/**
 * v6.428：engine.ts 相對前一版（v6.427）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.427 **之前**（本版是最新的一版）。
 *
 * 【v6.428 對 engine.ts 的改動】（行內改動，無法用哨兵框 ⇒ 逐字宣告 [本版, 前一版]）
 *   玩家層級招式冷卻（仙子伊布ex｜天仙石、騎拉帝納｜渾沌匍匐）收斂成中央述詞
 *   isPlayerLevelAttackOnCooldown，ATTACK handler 與 getAvailableAttacks 共用同一份
 *   （舊版只有 ATTACK handler 判 ⇒ 招式按鈕亮著、按下去才被擋，AI 也把它當候選）；
 *   另新增遊戲層級 attackNamesUsedThisTurn／LastSelfTurn 的蓋章與 END_TURN promote（用過的那一隻離場後仍冷卻）。
 *
 * 本檔的錨點由腳本從實際 diff 擷取（difflib，3 行上下文），並**當場驗證還原後逐字等於前一版**，不是手打。
 */

/** [本版的樣子, 前一版的樣子]；每一組都必須恰好命中 1 次。 */
const V6428_PAIRS = [
  [
    "\n      // v5.967 玩家層級招式冷卻(天仙石)：自己全場任一隻上個自己回合用過此招 → 禁用(卡面「自己的寶可夢」)。\n      //   讀中央 attackUsedLastSelfTurn(招式結算自動蓋章、不隨撤退/換位/離場清除)，涵蓋撤退再回、第二張同名卡。\n      //   ⭐v6.428 判準收斂到中央 isPlayerLevelAttackOnCooldown（getAvailableAttacks 共用同一份，Rule 38）\n      if (isPlayerLevelAttackOnCooldown(state, aIdx, attackName)) {\n        return addLog(state,\n          `${atkName}：上個自己的回合已使用過「${attackName}」，本回合無法使用`,\n          aIdx);\n      }\n\n      // v2.219 — 後攻方最初回合限定招式（吼叫尾ex｜絕叫、甜甜螢｜慢芬香）\n",
    "\n      // v5.967 玩家層級招式冷卻(天仙石)：自己全場任一隻上個自己回合用過此招 → 禁用(卡面「自己的寶可夢」)。\n      //   讀中央 attackUsedLastSelfTurn(招式結算自動蓋章、不隨撤退/換位/離場清除)，涵蓋撤退再回、第二張同名卡。\n      if (attackName && PLAYER_LEVEL_ATTACK_COOLDOWN.has(attackName)) {\n        const _ownP = state.players[aIdx];\n        const _usedByOwn = [_ownP.active, ..._ownP.bench].some((c) => c?.attackUsedLastSelfTurn === attackName);\n        if (_usedByOwn) {\n          return addLog(state,\n            `${atkName}：上個自己的回合已使用過「${attackName}」，本回合無法使用`,\n            aIdx);\n        }\n      }\n\n      // v2.219 — 後攻方最初回合限定招式（吼叫尾ex｜絕叫、甜甜螢｜慢芬香）\n",
  ],
  [
    "        const newPlayers = [...newState.players] as [PlayerState, PlayerState];\n        newPlayers[aIdx] = { ...newPlayers[aIdx], active: { ...curAtk, attackUsedThisTurn: attack.name } };\n        newState = { ...newState, players: newPlayers };\n        // ⭐v6.428 玩家層級同步蓋章（天仙石／渾沌匍匐「自己的寶可夢使出了X」）：\n        //   實體欄位會隨那一隻離場（昏厥、回手、放回牌庫、退化）一起消失 ⇒ 冷卻被繞過；\n        //   另記在遊戲層級 {p1,p2}（Firestore 禁巢狀陣列，同 ancientAttackedIidsThisTurn），存活至離場後。\n        {\n          const _k = ancientKey(aIdx);\n          const _prevUsed = newState.attackNamesUsedThisTurn ?? { p1: [], p2: [] };\n          newState = { ...newState, attackNamesUsedThisTurn: { ..._prevUsed, [_k]: [...(_prevUsed[_k] ?? []), attack.name] } };\n        }\n        // v5.911 輪番狂攻:記錄「古代」寶可夢本回合使招的 iid(遊戲層級,存活至 KO 離場後)\n        const _atkCard = pool.get(curAtk.cardId);\n        if (_atkCard?.tags?.includes('古代')) {\n",
    "        const newPlayers = [...newState.players] as [PlayerState, PlayerState];\n        newPlayers[aIdx] = { ...newPlayers[aIdx], active: { ...curAtk, attackUsedThisTurn: attack.name } };\n        newState = { ...newState, players: newPlayers };\n        // v5.911 輪番狂攻:記錄「古代」寶可夢本回合使招的 iid(遊戲層級,存活至 KO 離場後)\n        const _atkCard = pool.get(curAtk.cardId);\n        if (_atkCard?.tags?.includes('古代')) {\n",
  ],
  [
    "          return { ..._prev, [_k]: _cur[_k] ?? [] };\n        })(),\n        ancientAttackedIidsThisTurn: { p1: [], p2: [] },\n        // ⭐v6.428 玩家層級招式紀錄：結束方的 ThisTurn → LastSelfTurn（保留另一方的 LastSelfTurn），清 ThisTurn\n        attackNamesUsedLastSelfTurn: (() => {\n          const _prev = state.attackNamesUsedLastSelfTurn ?? { p1: [], p2: [] };\n          const _cur = state.attackNamesUsedThisTurn ?? { p1: [], p2: [] };\n          const _k = ancientKey(aIdx);\n          return { ..._prev, [_k]: _cur[_k] ?? [] };\n        })(),\n        attackNamesUsedThisTurn: { p1: [], p2: [] },\n        oppAbilityKOdMeInLastOppTurn: state.oppAbilityKOdMeThisTurn ?? [0, 0],\n        oppAttackKOdMyRocketInLastOppTurn: state.oppAttackKOdMyRocketThisTurn ?? [0, 0],\n        oppAbilityKOdMyRocketInLastOppTurn: state.oppAbilityKOdMyRocketThisTurn ?? [0, 0],\n",
    "          return { ..._prev, [_k]: _cur[_k] ?? [] };\n        })(),\n        ancientAttackedIidsThisTurn: { p1: [], p2: [] },\n        oppAbilityKOdMeInLastOppTurn: state.oppAbilityKOdMeThisTurn ?? [0, 0],\n        oppAttackKOdMyRocketInLastOppTurn: state.oppAttackKOdMyRocketThisTurn ?? [0, 0],\n        oppAbilityKOdMyRocketInLastOppTurn: state.oppAbilityKOdMyRocketThisTurn ?? [0, 0],\n",
  ],
  [
    "//   v6.069 騎拉帝納｜渾沌匍匐（M6）：「在上個自己的回合，若自己的寶可夢使用了『渾沌匍匐』，\n//   則無法使用這個招式」—— 主詞是「自己的寶可夢」非「這隻寶可夢」，同 天仙石。\nconst PLAYER_LEVEL_ATTACK_COOLDOWN = new Set<string>(['天仙石', '渾沌匍匐']);\n// ⭐v6.428 中央述詞：玩家層級冷卻中嗎？（ATTACK handler 與 getAvailableAttacks 共用同一份）\n//   舊版只在 ATTACK handler 判 ⇒ getAvailableAttacks 仍列為可用 ⇒ 招式按鈕亮著、按下去才被擋，\n//   AI 也會把它當候選（批次 B2 診斷抓到）。\n//   卡面主詞「自己的寶可夢」使出了X ⇒ **玩家層級的事實**：用過的那一隻就算已經離場\n//   （昏厥、回手、放回牌庫、退化成不帶蓋章的實體）也照樣冷卻（fable 審查實測舊版會被繞過）。\n//   ⇒ 讀遊戲層級 attackNamesUsedLastSelfTurn；再併看場上實體的 attackUsedLastSelfTurn\n//     （v6.428 以前開始、還在進行中的對局沒有遊戲層級紀錄，保留舊判準當退路）。\nexport function isPlayerLevelAttackOnCooldown(\n  state: GameState, pIdx: 0 | 1, attackName: string | undefined | null,\n): boolean {\n  if (!attackName || !PLAYER_LEVEL_ATTACK_COOLDOWN.has(attackName)) return false;\n  if ((state.attackNamesUsedLastSelfTurn?.[ancientKey(pIdx)] ?? []).includes(attackName)) return true;\n  const p = state.players[pIdx];\n  return [p.active, ...p.bench].some((c) => c?.attackUsedLastSelfTurn === attackName);\n}\n\n/** 列出目前行動玩家可使用的招式（已滿足能量需求 + 未被狀態/效果封鎖的） */\n// ══════════════════════════════════════════════════════════════════════════════\n",
    "//   v6.069 騎拉帝納｜渾沌匍匐（M6）：「在上個自己的回合，若自己的寶可夢使用了『渾沌匍匐』，\n//   則無法使用這個招式」—— 主詞是「自己的寶可夢」非「這隻寶可夢」，同 天仙石。\nconst PLAYER_LEVEL_ATTACK_COOLDOWN = new Set<string>(['天仙石', '渾沌匍匐']);\n\n/** 列出目前行動玩家可使用的招式（已滿足能量需求 + 未被狀態/效果封鎖的） */\n// ══════════════════════════════════════════════════════════════════════════════\n",
  ],
  [
    "      // <<< v6350-attack-precondition-ui\n      // v2.92：單招下回合禁用（例：超級勇氣）— UI 層反白禁按\n      if (player.active!.blockedAttackNamesThisTurn?.includes(atk.name)) return -1;\n      // ⭐v6.428 玩家層級冷卻（仙子伊布ex｜天仙石、騎拉帝納｜渾沌匍匐）— 與 ATTACK handler 同一個述詞\n      if (isPlayerLevelAttackOnCooldown(state, state.activePlayerIndex as 0 | 1, atk.name)) return -1;\n      // v2.219：後攻方最初回合限定招式（吼叫尾ex｜絕叫、甜甜螢｜慢芬香）— UI 層反白\n      // ⭐ v6.103：判準與引擎端一起從 isFirstTurn 改為 turn === 1（原寫法永遠 false，見上方詳解）。\n      //   兩端**必須同步改**，否則會出現「按鈕亮著但送出被擋」或反之。\n",
    "      // <<< v6350-attack-precondition-ui\n      // v2.92：單招下回合禁用（例：超級勇氣）— UI 層反白禁按\n      if (player.active!.blockedAttackNamesThisTurn?.includes(atk.name)) return -1;\n      // v2.219：後攻方最初回合限定招式（吼叫尾ex｜絕叫、甜甜螢｜慢芬香）— UI 層反白\n      // ⭐ v6.103：判準與引擎端一起從 isFirstTurn 改為 turn === 1（原寫法永遠 false，見上方詳解）。\n      //   兩端**必須同步改**，否則會出現「按鈕亮著但送出被擋」或反之。\n",
  ],
];

/**
 * 把 v6.428 對 engine.ts 的合法改動逐字還原回前一版（v6.427）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6428Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6428_PAIRS.length; i++) {
    const [cur, base] = V6428_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6428Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請依實際 diff 重新擷取錨點。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
