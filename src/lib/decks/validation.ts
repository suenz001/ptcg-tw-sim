// PTCG Standard deck validation.
// Rules implemented:
//   - Exactly 60 cards total.
//   - At most 4 cards with the same name, except Basic Energy which is unlimited.
//   - At least 1 Basic Pokémon (otherwise you can't legally start the game).
//   - Every card must be Standard-legal (regulationMark in H/I/J).
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

export function isBasicPokemon(card: Card): boolean {
  return card.supertype === 'Pokemon' && card.subtype === 'Basic';
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

  return {
    totalCount: total,
    legal: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Returns the maximum allowed copies of a given card.
 * Used by the UI to block "+" presses beyond the legal limit.
 */
export function maxCopies(card: Card): number {
  return isBasicEnergy(card) ? Infinity : 4;
}
