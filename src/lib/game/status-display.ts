// ⭐v6.556 特殊狀態顯示的唯一出口（圖示＋官方用詞）。
//
// 為什麼要收斂：
//   1. 對戰頁與手機版原本各自寫了十幾份「poisoned ? '☠️ 中毒' : burned ? … : paralyzed ? '⚡ 麻痺' : …」三元式，
//      其中備戰區的小標籤把「不認得的值」也一律顯示成 ⚡ ⇒ 和附能提示的 ⚡ 長得一樣，玩家分不出來。
//   2. 用詞漂移：大部分寫「燒傷」，台灣官方卡面（static/cards）一律是「灼傷」（灼傷 92 次、燒傷 0 次）。
//   3. 手機版與放大檢視的第二狀態槽寫成「secondary==='poisoned' || tertiary==='poisoned' ? 中毒」
//      ⇒ 第二槽灼傷、第三槽中毒時，第二個標籤也顯示「中毒」（中毒出現兩次、灼傷消失）；放大檢視則完全沒有第三槽。
//
// 這支是 leaf 模組（只 import 型別），對戰頁、手機版、日後任何顯示狀態的地方都從這裡取，不要再就地寫三元式。

import type { SpecialCondition } from './types';

/** 五種特殊狀態的圖示（只認這五個鍵）。 */
export const STATUS_ICON: Readonly<Record<SpecialCondition, string>> = Object.freeze({
  poisoned: '☠️',
  burned: '🔥',
  asleep: '💤',
  confused: '😵',
  paralyzed: '⚡',
});

/** 五種特殊狀態的台灣官方用詞（與卡面一致）。 */
export const STATUS_NAME: Readonly<Record<SpecialCondition, string>> = Object.freeze({
  poisoned: '中毒',
  burned: '灼傷',
  asleep: '睡眠',
  confused: '混亂',
  paralyzed: '麻痺',
});

/** 不認得的狀態值（舊存檔、伺服器送來的髒資料）用的圖示：刻意不用 ⚡，避免和附能提示混淆。 */
export const UNKNOWN_STATUS_ICON = '❓';

function isKnown(s: unknown): s is SpecialCondition {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(STATUS_ICON, s);
}

/** 只要圖示（備戰區小標籤、撤退視窗、手機選擇視窗）。 */
export function statusIcon(s: string | null | undefined): string {
  if (!s) return '';
  return isKnown(s) ? STATUS_ICON[s] : UNKNOWN_STATUS_ICON;
}

/** 圖示＋中文（戰鬥位標籤、放大檢視）。不認得的值照原字串顯示並加 ❓，方便玩家回報。 */
export function statusLabel(s: string | null | undefined): string {
  if (!s) return '';
  return isKnown(s) ? `${STATUS_ICON[s]} ${STATUS_NAME[s]}` : `${UNKNOWN_STATUS_ICON} ${s}`;
}

/** 依序列出三個狀態槽（status → secondaryStatus → tertiaryStatus）實際有的值，去掉空槽與重複。 */
export function statusSlots(
  inst: { status?: string | null; secondaryStatus?: string | null; tertiaryStatus?: string | null } | null | undefined,
): string[] {
  if (!inst) return [];
  const out: string[] = [];
  for (const s of [inst.status, inst.secondaryStatus, inst.tertiaryStatus]) {
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
