// v6.656：只按卡片印刷資料篩選，與對戰中特性是否被消除無關。
import rarityIndex from './rarity-index.json';
import type { Card } from './types';

export type RarityFilter = 'all' | 'rare' | 'regular';
export type AbilityFilter = 'all' | 'yes' | 'no';
export type TraitSelections = { rarity: RarityFilter; ability: AbilityFilter };
const rareIds: ReadonlySet<string> = new Set(Object.values(rarityIndex.groups).flat());

/** 稀有度由官方檢索索引提供；未列為特殊稀有度的卡片（含未標稀有度特典卡）歸一般卡。 */
export function isRarePrinting(card: Pick<Card, 'id'>): boolean {
  return rareIds.has(String(card.id));
}

/** 「無特性」僅指寶可夢，不把訓練家／能量卡當成無特性寶可夢。 */
export function matchesCardTraits(card: Card, rarity: RarityFilter, ability: AbilityFilter): boolean {
  if (rarity !== 'all' && isRarePrinting(card) !== (rarity === 'rare')) return false;
  if (ability === 'all') return true;
  if (card.supertype !== 'Pokemon') return false;
  return (Array.isArray(card.abilities) && card.abilities.length > 0) === (ability === 'yes');
}

export function readTraitFilterSearch(search: string): TraitSelections {
  const sp = new URLSearchParams(search), rarity = sp.get('rarity'), ability = sp.get('ability');
  return {
    rarity: rarity === 'rare' || rarity === 'regular' ? rarity : 'all',
    ability: ability === 'yes' || ability === 'no' ? ability : 'all',
  };
}

export function writeTraitFilterSearch(search: string, traits: TraitSelections): string {
  const sp = new URLSearchParams(search);
  if (traits.rarity === 'all') sp.delete('rarity'); else sp.set('rarity', traits.rarity);
  if (traits.ability === 'all') sp.delete('ability'); else sp.set('ability', traits.ability);
  const qs = sp.toString();
  return qs ? '?' + qs : '';
}
