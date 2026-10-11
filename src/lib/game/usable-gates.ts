/**
 * ⭐v6.528「效果完全無法執行 ⇒ 不能使用」的張數型判準（leaf 模組，只放純函式，不 import 任何東西 ⇒ 不會循環）。
 *   engine getUsableAbilities（按鈕亮不亮）與卡片檔（真的發動時的拒絕）共用同一份，避免兩端分岔。
 *   依據一律是官方 Q&A（PTCG_RULES.md 行號附在各函式）。
 */

/** 狂歡浪舞鴨｜快節奏：手牌 0 張付不出代價；官方 Q&A（PTCG_RULES L1891）「自己的手牌有6張以上時…」「不可以。」 */
export function quickRhythmUsable(handCount: number): boolean {
  return handCount >= 1 && handCount <= 5;
}

/** 彩粉蝶｜大飛翅：官方 Q&A（PTCG_RULES L2814／L2816）對手牌庫 0、手牌 ≥1 ⇒ 可以；對手手牌 0 ⇒ 不可以。 */
export function bigWingUsable(oppHandCount: number): boolean {
  return oppHandCount > 0;
}
