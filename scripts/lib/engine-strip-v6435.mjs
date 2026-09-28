/**
 * v6.435：engine.ts 相對前一版（v6.434 ＝ v6.428 的 engine.ts，v6.429～v6.434 沒有動 engine.ts）的「合法改動」還原器
 *   —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.428 **之前**（本版是最新的一版）。
 *
 * 【v6.435 對 engine.ts 的改動】（行內改動，無法用哨兵框 ⇒ 逐字宣告 [本版, 前一版]）
 *   玩家層級招式冷卻的集合 PLAYER_LEVEL_ATTACK_COOLDOWN、中央述詞 isPlayerLevelAttackOnCooldown 與 ancientKey
 *   搬到 leaf 模組 player-attack-cooldown.ts（借招候選 copy-attack.ts 也要問同一個判準，而它不可 import engine.ts）；
 *   engine.ts 改成 import ＋ re-export，ATTACK handler 與 getAvailableAttacks 的呼叫點不變。
 *   另：FINISH_SETUP 放獎賞卡改用 slice（舊寫法 player.deck.shift() 會連傳進來的舊 state 一起改；純函式修正）。
 *
 * 本檔的錨點由腳本從實際 diff 擷取（difflib），並**當場驗證還原後逐字等於前一版**，不是手打。
 */

/** [本版的樣子, 前一版的樣子]；每一組都必須恰好命中 1 次。 */
const V6435_PAIRS = [
  [
    " *   - M3 多人連線時只需傳送動作序列\n */\n\nimport { ancientKey, isPlayerLevelAttackOnCooldown } from './player-attack-cooldown';   // ⭐v6.435 leaf（玩家層級冷卻唯一判準）\nimport { modalChoicePayloadValid } from './selection-ui';   // >>> v6331-modal-choice-payload-import\nimport type { Card, EnergyType, Attack } from '$lib/cards/types';\n// v5.988：平穩境地述詞改從 v3001 既有安全 import 取得(移除此處早期反向 import 卡檔 v3080，杜絕 module-init TDZ)\n",
    " *   - M3 多人連線時只需傳送動作序列\n */\n\nimport { modalChoicePayloadValid } from './selection-ui';   // >>> v6331-modal-choice-payload-import\nimport type { Card, EnergyType, Attack } from '$lib/cards/types';\n// v5.988：平穩境地述詞改從 v3001 既有安全 import 取得(移除此處早期反向 import 卡檔 v3080，杜絕 module-init TDZ)\n"
  ],
  [
    " * （`Nested arrays are not supported`）→ 線上對局根本存不進房間。\n * 因此這類欄位一律用 `{ p1, p2 }`，並用這個 helper 把 seat index 轉成 key。\n */\n// ⭐v6.435 ancientKey 搬到 leaf 模組 player-attack-cooldown.ts（借招候選也要用同一個冷卻判準，\n//   copy-attack.ts 不可 import engine.ts）；這裡 re-export，既有 `import { ancientKey } from './engine'` 不受影響。\nexport { ancientKey };\n\n// ══════════════════════════════════════════════════════════════════════════════\n// v6.051 互動式開局（閃焰王牌｜瞬間爆發力）\n",
    " * （`Nested arrays are not supported`）→ 線上對局根本存不進房間。\n * 因此這類欄位一律用 `{ p1, p2 }`，並用這個 helper 把 seat index 轉成 key。\n */\nexport function ancientKey(idx: 0 | 1): 'p1' | 'p2' {\n  return idx === 0 ? 'p1' : 'p2';\n}\n\n// ══════════════════════════════════════════════════════════════════════════════\n// v6.051 互動式開局（閃焰王牌｜瞬間爆發力）\n"
  ],
  [
    "  if (action.type === 'FINISH_SETUP') {\n    if (!player.active) return state; // 必須選出場才能完成\n    // 設置獎賞卡（各 6 張）\n    // ⭐v6.435 純函式修正：player 只是淺拷貝，舊寫法 `player.deck.shift()` 會連**傳進來的舊 state** 的牌庫陣列一起改\n    //   （舊 state 的牌庫少 6 張、獎賞卡卻還是空的 ⇒ 6 張卡從舊 state 憑空消失；AI 試打、回放、樂觀更新回滾拿舊 state 都會讀到壞資料）。\n    //   改用 slice 產生新陣列；取牌順序（從牌庫最上方依序取 6 張）與舊寫法完全相同。\n    const prizes: CardInstance[] = player.deck.slice(0, 6);\n    player.deck = player.deck.slice(prizes.length);\n    player.prizes = prizes;\n    const newDone = [...state.setupDone] as [boolean, boolean];\n    newDone[pIdx] = true;\n",
    "  if (action.type === 'FINISH_SETUP') {\n    if (!player.active) return state; // 必須選出場才能完成\n    // 設置獎賞卡（各 6 張）\n    const prizes: CardInstance[] = [];\n    for (let i = 0; i < 6; i++) {\n      const top = player.deck.shift();\n      if (top) prizes.push(top);\n    }\n    player.prizes = prizes;\n    const newDone = [...state.setupDone] as [boolean, boolean];\n    newDone[pIdx] = true;\n"
  ],
  [
    "//   (同 canRetreat/getRetreatBlockReason 各寫一份的反模式)。提升為模組級單一來源,\n//   引擎拒絕(ATTACK)與 UI 反白(getAvailableAttacks)永遠引用同一份,不會分歧。\nconst SECOND_PLAYER_FIRST_TURN_ONLY = new Set<string>(['絕叫', '慢芬香']);\n// ⭐v6.435 玩家層級招式冷卻（天仙石／渾沌匍匐）的集合與中央述詞搬到 leaf 模組 player-attack-cooldown.ts：\n//   借招家族的中央候選枚舉（copy-attack.ts）也要問同一個判準（站長裁定：借不到冷卻中的天仙石），\n//   而 copy-attack.ts 不可 import engine.ts（成環）。ATTACK handler 與 getAvailableAttacks 照舊呼叫同一個述詞。\nexport { isPlayerLevelAttackOnCooldown };\n\n/** 列出目前行動玩家可使用的招式（已滿足能量需求 + 未被狀態/效果封鎖的） */\n// ══════════════════════════════════════════════════════════════════════════════\n",
    "//   (同 canRetreat/getRetreatBlockReason 各寫一份的反模式)。提升為模組級單一來源,\n//   引擎拒絕(ATTACK)與 UI 反白(getAvailableAttacks)永遠引用同一份,不會分歧。\nconst SECOND_PLAYER_FIRST_TURN_ONLY = new Set<string>(['絕叫', '慢芬香']);\n// v5.967 玩家層級招式冷卻：卡面「若『自己的寶可夢』上個自己的回合使出了X，則無法使用」(非「這隻寶可夢」)。\n//   仙子伊布ex｜天仙石 屬此類。舊實作把冷卻鎖在 attacker instance(blockedAttackNamesNextTurn)，會被撤退／\n//   換位／第二張同名卡繞過。改在招式禁用 gate 掃自己全場的中央 attackUsedLastSelfTurn(招式結算自動蓋章、\n//   不隨離場清除)判定，任一隻上個自己回合用過此招即禁用。\n//   v6.069 騎拉帝納｜渾沌匍匐（M6）：「在上個自己的回合，若自己的寶可夢使用了『渾沌匍匐』，\n//   則無法使用這個招式」—— 主詞是「自己的寶可夢」非「這隻寶可夢」，同 天仙石。\nconst PLAYER_LEVEL_ATTACK_COOLDOWN = new Set<string>(['天仙石', '渾沌匍匐']);\n// ⭐v6.428 中央述詞：玩家層級冷卻中嗎？（ATTACK handler 與 getAvailableAttacks 共用同一份）\n//   舊版只在 ATTACK handler 判 ⇒ getAvailableAttacks 仍列為可用 ⇒ 招式按鈕亮著、按下去才被擋，\n//   AI 也會把它當候選（批次 B2 診斷抓到）。\n//   卡面主詞「自己的寶可夢」使出了X ⇒ **玩家層級的事實**：用過的那一隻就算已經離場\n//   （昏厥、回手、放回牌庫、退化成不帶蓋章的實體）也照樣冷卻（fable 審查實測舊版會被繞過）。\n//   ⇒ 讀遊戲層級 attackNamesUsedLastSelfTurn；再併看場上實體的 attackUsedLastSelfTurn\n//     （v6.428 以前開始、還在進行中的對局沒有遊戲層級紀錄，保留舊判準當退路）。\nexport function isPlayerLevelAttackOnCooldown(\n  state: GameState, pIdx: 0 | 1, attackName: string | undefined | null,\n): boolean {\n  if (!attackName || !PLAYER_LEVEL_ATTACK_COOLDOWN.has(attackName)) return false;\n  if ((state.attackNamesUsedLastSelfTurn?.[ancientKey(pIdx)] ?? []).includes(attackName)) return true;\n  const p = state.players[pIdx];\n  return [p.active, ...p.bench].some((c) => c?.attackUsedLastSelfTurn === attackName);\n}\n\n/** 列出目前行動玩家可使用的招式（已滿足能量需求 + 未被狀態/效果封鎖的） */\n// ══════════════════════════════════════════════════════════════════════════════\n"
  ]
];

export function stripV6435Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6435_PAIRS.length; i++) {
    const [cur, base] = V6435_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6435Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請依實際 diff 重新擷取錨點。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
