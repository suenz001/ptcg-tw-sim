// ⭐v6.594 牌組卡片的顯示順序（唯一一份，IRON_RULES Rule 38）
//
// 站長 2026-10-23：牌組公布欄明細的排序「要依據類型，寶可夢 → 物品 → 支援者 → 競技場 → 能量」，
//   並選擇「共用一份」：牌組編輯器（/decks 的 activeEntries，v5.363 起的順序，匯出圖片也用它）與
//   牌組公布欄明細（/deck-posts）都呼叫這裡，以後改順序只改這一個地方，兩頁不會不一致。
//
// 規則（逐字搬自 /decks v5.363，行為不變）：
//   寶可夢 0 → 物品 1（含道具／化石等其他訓練家物品）→ 支援者 2 → 競技場 3 → 能量 4；同一類依卡名（zh-Hant）。

import type { Card } from '$lib/cards/types';

type RankCard = Pick<Card, 'supertype' | 'subtype'>;

/** 類型序號：寶可夢 0／物品 1／支援者 2／競技場 3／能量 4 */
export function deckCardRank(c: RankCard): number {
  if (c.supertype === 'Pokemon') return 0;
  if (c.supertype === 'Trainer') {
    if (c.subtype === 'Supporter') return 2;
    if (c.subtype === 'Stadium') return 3;
    return 1;  // 物品（含工具 / 化石 等其他訓練家物品）
  }
  return 4;  // 能量
}

/** 兩張卡的先後：先比類型，再比卡名 */
export function compareDeckCards(a: Pick<Card, 'supertype' | 'subtype' | 'name'>, b: Pick<Card, 'supertype' | 'subtype' | 'name'>): number {
  const r = deckCardRank(a) - deckCardRank(b);
  if (r !== 0) return r;
  return a.name.localeCompare(b.name, 'zh-Hant');
}
