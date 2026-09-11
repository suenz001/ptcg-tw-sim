// ⭐⭐⭐ v6.333「已進卡庫、但**不開放對戰**」的卡包（守衛端唯一來源）。
//
// **站長 2026-09-09 裁定（兩句）**：
//   ①「M6a 可查卡，但暫不開放組牌」
//   ②「m6a 全部的卡的功能都不要實裝」
// ⇒ M6a「30th CELEBRATION」是**純資料**：玩家在卡牌資料庫查得到、【無標】篩選鈕也用得到，
//   但牌組編輯器不給選、牌組合法性檢查會擋，卡效果一律不做。
//
// ⚠⚠ 為什麼一定要擋（公平性，不是功能缺口）：
//   引擎結算招式是 `const preFn = ATTACK_PRE.get(key); if (preFn) {…}` ——
//   **沒有 handler 就直接套卡面傷害、效果整段跳過、對戰紀錄一個字都不寫**
//   （訓練家有 isTrainerPendingImplementation 擋、特性沒實裝按鈕不會出現，唯獨招式沒有閘）。
//   實測：M6a 之前「live H/I/J 有效果的招式 1691 招、未實裝 0」是站上**從沒破過的不變量**；
//   M6a 一進來就是 96 招未實裝，其中 15 招是**代價型**效果（自傷／下回合鎖招／丟光自己的能量），
//   沒實裝＝單方面對出招者有利，卡片會比實體卡更強。
//
// ⚠ 用途只有一個：讓「照卡面枚舉」的卡效果守衛把這些卡包排除在枚舉範圍外 ——
//   它們**永遠不會**出現在任何一場對戰裡，要求它們有實作沒有意義。
//   ⇒ 這不是把洞放著：`test-v6333` 有一條斷言「**不在這份清單裡**的 live H/I/J 卡，
//     未實裝招式／特性必須是 0」，把站上原本的不變量明確釘住（比原本更強）。
//
// ⚠⚠ 這份清單必須與 `src/lib/cards/regulation.ts` 的 `DEFAULT_CARD_POLICY.lockedSets` 永遠相同
//   （v6.340 起 runtime 的「暫不開放」清單可由後台調整，但**程式內建預設值**仍然是這一份；
//    守衛端枚舉卡效果時看的就是預設值 —— 後台臨時開放某個卡包不代表卡效果已經實裝）
//   （一個給 runtime、一個給守衛；跨 .ts/.mjs 沒辦法共用同一個 export，
//    同 version.ts 與 admin.html SITE_VERSION_HINT 的處理方式）。
//   `test-v6333` 有逐項比對，漂移就會紅。

/** 已進卡庫、但不開放對戰（不可組牌、卡效果不實裝）的卡包代號。 */
export const DECK_LOCKED_SETS = new Set(['M6a']);

/** 這張卡是不是來自「不開放對戰」的卡包？ */
export function isDeckLockedCard(card) {
  return !!card && DECK_LOCKED_SETS.has(String(card.setCode));
}

/**
 * 給「以卡名／效果名枚舉」的守衛用：持有這個效果名的 live H/I/J 卡，是不是**每一張**
 * 都來自不開放對戰的卡包？
 * ⚠ 只要有任何一張是可對戰的卡，就回 false（照樣要求列管）——這是收緊，不是整包放過。
 */
export function allCarriersDeckLocked(cards) {
  const list = [...cards];
  return list.length > 0 && list.every((c) => isDeckLockedCard(c));
}
