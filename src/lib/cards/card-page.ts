// ⭐v6.483 卡片「單卡頁」（/card/{id}/，建置期預渲染的 SEO 頁）連結判準。
//
// 單卡頁只為「標準環境、玩家看得到」的卡產生（$lib/server/cardIndex.ts 的 getStdCardIds）。
//   ⚠ 建置期用的是**程式內建的預設卡牌政策**（DEFAULT_CARD_POLICY，建置時不會去讀後台政策），
//     所以這裡也用預設政策判斷，而不是執行期的 isCardMarkStandardLegal（後台改政策時兩者會不同，
//     用執行期判準會連到不存在的頁面）。兩者是否一致由 test-v6483 對全部真實卡逐張比對。
import { isHiddenFromPlayers } from './visibility';
import { DEFAULT_CARD_POLICY } from './regulation';

/** 這張卡有沒有單卡頁（＝建置期有預渲染）。 */
export function hasCardPage(card: { id?: string | number | null; regulationMark?: string | null } | null | undefined): boolean {
  if (!card || card.id == null || card.id === '') return false;
  if (isHiddenFromPlayers(card.id)) return false;
  const m = card.regulationMark;
  return !!m && DEFAULT_CARD_POLICY.allowedMarks.includes(m);
}

/** 單卡頁的站內路徑（含 base、結尾斜線）；沒有單卡頁回 null。 */
export function cardPageHref(base: string, card: { id?: string | number | null; regulationMark?: string | null } | null | undefined): string | null {
  return hasCardPage(card) ? `${base}/card/${encodeURIComponent(String(card!.id))}/` : null;
}
