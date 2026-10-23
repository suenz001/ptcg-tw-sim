// ⭐v6.594 牌組卡片的顯示順序（唯一一份，IRON_RULES Rule 38）
//
// 站長 2026-10-23：牌組公布欄明細的排序「要依據類型，寶可夢 → 物品 → 支援者 → 競技場 → 能量」，
//   並選擇「共用一份」：牌組編輯器（/decks 的 activeEntries，v5.363 起的順序，匯出圖片也用它）與
//   牌組公布欄明細（/deck-posts）都呼叫這裡，以後改順序只改這一個地方，兩頁不會不一致。
//
// 規則（v6.594 逐字搬自 /decks v5.363）：
//   寶可夢 → 物品（含化石等其他訓練家）→ 支援者 → 競技場 → 能量；同一類依卡名（zh-Hant）。
// ⭐v6.597 站長裁定（2026-10-24）：寶可夢道具從物品分出來，排在物品後面（官方構築表也是「物品／寶可夢道具」同一欄）：
//   寶可夢 0 → 物品 1 → 寶可夢道具 2 → 支援者 3 → 競技場 4 → 能量 5。牌組編輯器、匯出圖片、牌組公布欄一起改（仍是同一份）。

import type { Card } from '$lib/cards/types';

type RankCard = Pick<Card, 'supertype' | 'subtype'>;

/** 類型序號（數字越小越前面） */
export const DECK_RANK = { pokemon: 0, item: 1, tool: 2, supporter: 3, stadium: 4, energy: 5 } as const;

/** 是不是寶可夢道具（卡片資料的 subtype 是 'PokemonTool'；維護中的卡包沒有別的寫法——test-v6211 禁止拿卡庫不存在的字面量比對） */
export function isPokemonToolCard(c: Pick<Card, 'supertype' | 'subtype'>): boolean {
  return c.supertype === 'Trainer' && c.subtype === 'PokemonTool';
}

/** 類型序號：寶可夢 0／物品 1／寶可夢道具 2／支援者 3／競技場 4／能量 5 */
export function deckCardRank(c: RankCard): number {
  if (c.supertype === 'Pokemon') return DECK_RANK.pokemon;
  if (c.supertype === 'Trainer') {
    if (c.subtype === 'Supporter') return DECK_RANK.supporter;
    if (c.subtype === 'Stadium') return DECK_RANK.stadium;
    if (isPokemonToolCard(c)) return DECK_RANK.tool;
    return DECK_RANK.item;  // 物品（含化石等其他訓練家）
  }
  return DECK_RANK.energy;  // 能量
}

/** 兩張卡的先後：先比類型，再比卡名 */
export function compareDeckCards(a: Pick<Card, 'supertype' | 'subtype' | 'name'>, b: Pick<Card, 'supertype' | 'subtype' | 'name'>): number {
  const r = deckCardRank(a) - deckCardRank(b);
  if (r !== 0) return r;
  return a.name.localeCompare(b.name, 'zh-Hant');
}
