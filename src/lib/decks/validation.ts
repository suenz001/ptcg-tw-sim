// PTCG Standard deck validation.
// Rules implemented:
//   - Exactly 60 cards total.
//   - At most 4 cards with the same name, except Basic Energy which is unlimited.
//   - At least 1 Basic Pokémon (otherwise you can't legally start the game).
//   - Every card must be Standard-legal (regulationMark in H/I/J).
//   - 一副牌最多只能放 1 張 ACE SPEC 卡（不管 Trainer 還是 Energy，全部共用 1 張
//     的名額；例如：不公印章 + 富裕能量 算 2 張 ACE SPEC → 違規）。
//
// We key the "same name" check off Card.name. That matches real tournament
// rules — copies across different sets still count together, and reprints
// with identical zh-TW names are one entry.

import type { Card } from '$lib/cards/types';
import type { Deck, DeckValidationResult } from './types';

const STANDARD_MARKS = new Set(['H', 'I', 'J']);

export function isBasicEnergy(card: Card): boolean {
  return card.supertype === 'Energy' && card.subtype === 'Basic';
}

/**
 * ACE SPEC 是 PTCG 特殊規則卡（不公印章、頂尖捕捉器、富裕能量、古舊能量 等）。
 * 一副牌無論 trainer/energy 只能放 1 張。tag 由 scraper 透過官網 list filter
 * （trainersTag=104 / energiesTag=104）統一補上；參見 tag-filters.js。
 */
export function isAceSpec(card: Card): boolean {
  return !!card.tags?.includes('ACE SPEC');
}

export function isBasicPokemon(card: Card): boolean {
  // 「基礎寶可夢」= 沒有 evolvesFrom 的寶可夢卡。
  // ex 基礎（subtype === 'ex'）同樣算基礎，不能用 subtype === 'Basic' 判斷。
  // 道具卡（subtype === 'Other'）是 Pokemon supertype 但非寶可夢，排除。
  if (card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false;
  return !card.evolvesFrom;
}

export function validateDeck(
  deck: Deck,
  cardsById: Map<string, Card>
): DeckValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  let total = 0;
  let basicPokemonCount = 0;
  const byName = new Map<string, number>();
  const missingIds: string[] = [];

  for (const entry of deck.entries) {
    const card = cardsById.get(entry.cardId);
    if (!card) {
      missingIds.push(entry.cardId);
      continue;
    }
    total += entry.count;

    if (!isBasicEnergy(card)) {
      byName.set(card.name, (byName.get(card.name) ?? 0) + entry.count);
    }
    if (isBasicPokemon(card)) basicPokemonCount += entry.count;

    if (card.regulationMark && !STANDARD_MARKS.has(card.regulationMark)) {
      issues.push(`${card.name} 為 ${card.regulationMark} 標，已退出標準賽`);
    }
  }

  if (missingIds.length) {
    issues.push(`牌組中有 ${missingIds.length} 張卡片查無資料（卡池可能已更新）`);
  }

  if (total !== 60) {
    issues.push(`牌組需要恰好 60 張（目前 ${total} 張）`);
  }

  for (const [name, n] of byName) {
    if (n > 4) issues.push(`${name} 不得超過 4 張（目前 ${n}）`);
  }

  if (basicPokemonCount === 0) {
    issues.push('牌組至少需要 1 隻基礎寶可夢');
  }

  // ACE SPEC：一副牌全部共用 1 張的名額（Trainer + Energy 合計 ≤ 1）。
  const aceSpecNames: string[] = [];
  let aceSpecTotal = 0;
  for (const entry of deck.entries) {
    const card = cardsById.get(entry.cardId);
    if (!card || !isAceSpec(card)) continue;
    aceSpecTotal += entry.count;
    aceSpecNames.push(`${card.name}×${entry.count}`);
  }
  if (aceSpecTotal > 1) {
    issues.push(`ACE SPEC 卡一副牌最多 1 張（目前 ${aceSpecTotal} 張：${aceSpecNames.join('、')}）`);
  }

  return {
    totalCount: total,
    legal: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * 計算目前牌組內已放入的 ACE SPEC 總張數（跨卡名累計）。
 * UI 用這個值決定「+」按鈕是否要禁用。
 */
export function aceSpecCount(
  deck: Deck,
  cardsById: Map<string, Card>
): number {
  let n = 0;
  for (const entry of deck.entries) {
    const card = cardsById.get(entry.cardId);
    if (card && isAceSpec(card)) n += entry.count;
  }
  return n;
}

/**
 * Returns the maximum allowed copies of a given card.
 * Used by the UI to block "+" presses beyond the legal limit.
 * - 基本能量：無上限
 * - ACE SPEC：同名 1 張（另外整副牌只能放 1 張 ACE SPEC — 由 deck-wide
 *   guard 處理，不在這裡）
 * - 其他：4
 */
export function maxCopies(card: Card): number {
  if (isBasicEnergy(card)) return Infinity;
  if (isAceSpec(card)) return 1;
  return 4;
}
