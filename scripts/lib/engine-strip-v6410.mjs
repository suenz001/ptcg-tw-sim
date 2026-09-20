/**
 * v6.410：engine.ts 相對前一版（v6.409）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.408 **之前**。
 *   v6.410 把 engine 的三個祭典樂舞 local 函式整段刪掉；v6.408 的還原內容（被刪掉的 185 行
 *   inline 加成）裡含有對首擊判定的呼叫 ⇒ 先還原 v6.410（函式定義與呼叫端名字回到舊樣子），
 *   v6.408 才會在正確的底稿上找到自己的錨點。
 *
 * 【v6.410 對 engine.ts 的五組改動】主題：祭典樂舞／祭典會場的判準**收斂成一份**。
 *   原本站內有兩份首擊判定（engine 的 local ＋ effects.ts 的逐字複製，註解自承
 *   「effects.ts 不能 import engine」），以及三份「祭典會場」場地名比對
 *   ⇒ 安慰劑型態 11（判準兩份）：針對其中一份寫的守衛，突變另一份不會翻紅。
 *   本版把判準下沉到新的 leaf `src/lib/game/festival.ts`（只 import types 與 defense，
 *   engine／effects 兩邊都能 import、無循環依賴），行為零改變。
 *
 * ⚠ 五處改動都用 `// >>> v6410-xxx` / `// <<< v6410-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip410.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6410_PAIRS = [
  [
    "// >>> v6410-festival-central-import\n// ⭐⭐⭐v6.410：祭典樂舞／祭典會場的判準收斂成**一份**（IRON_RULES Rule 38）。\n//   原本 engine 這裡有 hasFestivalDanceActive / 首擊判定 / hasFestivalVenue\n//   三個 local 實作，而 effects.ts 另有一份逐字複製的本地版\n//   （註解自承「effects.ts 不能 import engine」）⇒ 判準兩份＝安慰劑型態 11。\n//   下沉到 leaf `./festival`（只 import types 與 defense，兩邊都能 import、無循環）。\nimport { hasFestivalDanceActive, hasFestivalVenue, isFestivalDanceFirstAttack } from './festival';\n// <<< v6410-festival-central-import\n",
    ""
  ],
  [
    "// >>> v6410-festival-central-removed\n// ⭐⭐⭐v6.410：原本這裡的三個 local 定義（持有生效特性／首擊判定／場地判定）\n//   已整段下沉到 `./festival`（見檔頭 import 哨兵）。\n//   ⚠ 行為零改變：\n//     ・持有生效特性：原本先 `card?.abilities?.some(...)` 再走中央述詞；\n//       中央述詞 hasEffectiveAbilityByInst 自己**第一行**就做同一個比對 ⇒ 前置檢查是冗餘的。\n//     ・首擊判定：原本 inline 比對「祭典會場」，現改呼叫 hasFestivalVenue\n//       （同一個判準原本三份：engine 的 hasFestivalVenue、engine 的 inline、effects 的 inline）。\n//     ・呼叫端名稱完全不變，只有首擊判定去掉底線前綴改叫 `isFestivalDanceFirstAttack`。\n// <<< v6410-festival-central-removed\n\n",
    "function hasFestivalDanceActive(state: GameState, idx: 0 | 1, pool: Map<string, Card>): boolean {\n  const active = state.players[idx].active;\n  const card = active ? pool.get(active.cardId) : null;\n  if (!card?.abilities?.some(a => a.name === '祭典樂舞')) return false;\n  // ⭐ v6.202：原本只比對特性名，**沒問特性此刻有沒有被消除**（v6.196 那一族的漏網）。\n  //   祭典樂舞持有者一定在戰鬥場（是使用招式的那隻）⇒ 招式版暗夜羽擊（abilityNullifiedThisTurn）\n  //   與 passive 振翼髮｜暗夜羽擊 都打得到它。改走 v6.196 中央述詞（不另建第四份）。\n  //   ⚠ 傳說的熔岩洞打不到本特性：祭典樂舞的成立條件是場上有「祭典會場」，\n  //     兩張都是競技場卡、不可能同時在場（唯一場地槽 state.activeStadium）。\n  return hasEffectiveAbilityByInst(state, idx, active, pool, '祭典樂舞');\n}\n\n/**\n * v5.226 偵測「本次攻擊是祭典樂舞會觸發第二次的第一次攻擊」。\n * 用於 attack pipeline 內保留一次性 flag（鐵羽毛 / 下回合加傷 等）給第二次攻擊。\n * 條件：攻擊者有祭典樂舞特性 + 場上祭典會場 + 還沒記為 used + 還沒用過 second attack。\n */\nfunction _isFestivalDanceFirstAttack(\n  state: GameState,\n  aIdx: 0 | 1,\n  pool: Map<string, Card>,\n): boolean {\n  const attacker = state.players[aIdx].active;\n  if (!attacker) return false;\n  const card = pool.get(attacker.cardId);\n  // ⭐ v6.202：同 hasFestivalDanceActive —— 原本只比對特性名，沒問特性是否被消除。\n  if (!hasEffectiveAbilityByInst(state, aIdx, attacker, pool, '祭典樂舞')) return false;\n  const stadiumCard = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;\n  if (stadiumCard?.name !== '祭典會場') return false;\n  if (state.festivalDanceUsedThisTurn?.[aIdx]) return false;\n  if (state.festivalDanceSecondAttackUsed?.[aIdx]) return false;\n  return true;\n}\n\nfunction hasFestivalVenue(state: GameState, pool: Map<string, Card>): boolean {\n  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;\n  return stadium?.name === '祭典會場';\n}\n\n"
  ],
  [
    "        // >>> v6410-festival-central-chongchong\n        // ⭐⭐⭐v6.410：這裡原本是「前置 some(特性名) ＋ 中央述詞」——與本版刪掉的\n        //   engine local 「持有生效祭典樂舞」述詞**逐字同型**（Rule 38 的同一筆債）。\n        //   改呼叫中央述詞；行為零改變（前置 some 是冗餘的，理由見 festival.ts 檔頭）。\n        //   ⚠ 這裡讀的是**戰鬥位另一隻**的特性（啡咚猴在備戰），上游 getUsableAbilities 那道\n        //     isAbilityHolderEffective 只驗「啡咚猴自己的衝衝鼓」，蓋不到這一條 ⇒ 必須自己問。\n        if (!player.active) return;\n        if (!hasFestivalDanceActive(state, state.activePlayerIndex as 0 | 1, pool)) return;\n        // <<< v6410-festival-central-chongchong\n",
    "        if (!player.active) return;\n        const activeCard = pool.get(player.active.cardId);\n        const isFestival = activeCard?.abilities?.some(a => a.name === '祭典樂舞');\n        if (!isFestival) return;\n        // ⭐ v6.202：原本只接 isAbilityNullifiedByPassive（初始化／振翼髮 passive／黏著束縛），\n        //   漏掉招式版暗夜羽擊（abilityNullifiedThisTurn）、火箭隊的監視塔、傳說的熔岩洞。\n        //   ⚠ 這裡讀的是**戰鬥位另一隻**的特性（啪咚猴在備戰），上游 getUsableAbilities 那道\n        //     isAbilityHolderEffective 只驗「啪咚猴自己的衝衝鼓」，蓋不到這一條 ⇒ 必須自己問。\n        if (!hasEffectiveAbilityByInst(state, state.activePlayerIndex as 0 | 1, player.active, pool, '祭典樂舞')) return;\n"
  ],
  [
    "// >>> v6410-festival-dead-code-removed\n// ⭐v6.410：原本這裡有 `canResumeFestivalDanceSecondAttack`（v5.211），\n// 全檔只有定義、**0 個呼叫端**（獨立審查查證）⇒ 死碼。\n// 它是這一族判準的一部分，本版正在收斂這一族 ⇒ 順手刪掉，\n// 不讓它日後變成「看起來有人在用的第二份判準」。\n// <<< v6410-festival-dead-code-removed\n",
    "function canResumeFestivalDanceSecondAttack(\n  state: GameState,\n  idx: 0 | 1,\n  pool: Map<string, Card>,\n): boolean {\n  const oppIdx = (1 - idx) as 0 | 1;\n  return state.phase === 'playing'\n    && state.turnPhase === 'end'\n    && !state.pendingSelection\n    && !hasAnyPendingPrize(state)\n    && state.players[idx].active !== null\n    && state.players[oppIdx].active !== null\n    && hasFestivalDanceActive(state, idx, pool)\n    && hasFestivalVenue(state, pool);\n}\n\n"
  ],
  [
    "      // >>> v6410-festival-central-call\n      if (!isFestivalDanceFirstAttack(state, aIdx, pool)) {\n      // <<< v6410-festival-central-call\n",
    "      if (!_isFestivalDanceFirstAttack(state, aIdx, pool)) {\n"
  ]
];

/**
 * 把 v6.410 對 engine.ts 的合法改動逐字還原回前一版（v6.409）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6410Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6410_PAIRS.length; i++) {
    const [cur, base] = V6410_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6410Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip410.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
