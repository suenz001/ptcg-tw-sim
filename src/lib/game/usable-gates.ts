/**
 * ⭐v6.528「效果完全無法執行 ⇒ 不能使用」的張數型判準（leaf 模組，只放純函式，不 import 任何東西 ⇒ 不會循環）。
 *   engine getUsableAbilities（按鈕亮不亮）與卡片檔（真的發動時的拒絕）共用同一份，避免兩端分岔。
 *   依據一律是官方 Q&A（PTCG_RULES.md 行號附在各函式）。
 */
import type { Card } from '$lib/cards/types';

/** 狂歡浪舞鴨｜快節奏：手牌 0 張付不出代價；官方 Q&A（PTCG_RULES L1891）「自己的手牌有6張以上時…」「不可以。」 */
export function quickRhythmUsable(handCount: number): boolean {
  return handCount >= 1 && handCount <= 5;
}

/** 彩粉蝶｜大飛翅：官方 Q&A（PTCG_RULES L2814／L2816）對手牌庫 0、手牌 ≥1 ⇒ 可以；對手手牌 0 ⇒ 不可以。 */
export function bigWingUsable(oppHandCount: number): boolean {
  return oppHandCount > 0;
}

/**
 * 海豚俠ex｜全能靈魂（rule marker，v2.997 起；v6.528 搬到這個 leaf，讓 engine／effects／ai／畫面共用同一份）。
 *   卡面：「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上。」
 *   官方 Q&A（PTCG_RULES L1745）：「因競技場卡『壯偉碩木』的效果，可以將波普海豚進化為擁有特性『全能靈魂』的海豚俠ex嗎？」「不可以。」
 *   ⇒ 從手牌打出、從牌庫進化（壯偉碩木等）一律不可以。
 */
export function isAllPowerSoulBlocked(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.name !== '海豚俠ex') return false;
  return card.abilities?.some(a => a.name === '全能靈魂') ?? false;
}
