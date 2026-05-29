// Local persistence for decks. Pure localStorage for now — swap in Firestore
// later without touching callers by keeping this API stable.

import type { Deck } from './types';
import { migrateCardId, migrateDeck } from './cardIdMigration';

const KEY = 'ptcg-tw-sim:decks';

function browserOnly<T>(fallback: T, fn: () => T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// v5.301: cardId migration helper 已搬到 cardIdMigration.ts (migrateDeck export)
//   v5.300 在 storage.ts 內定義 migrateDeck 但 loadDecks 沒呼叫 → 玩家舊牌組仍顯示 jp_id
//   v5.301 修法: 改 import migrateDeck, loadDecks 內 return 時自動 map
export function loadDecks(): Deck[] {
  return browserOnly<Deck[]>([], () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // v5.301: 自動 jp_id → tw_id migration (M5 等已從日版升級為台版)
    return parsed.map(migrateDeck);
  });
}

export function saveDecks(decks: Deck[]): void {
  browserOnly<void>(undefined, () => {
    localStorage.setItem(KEY, JSON.stringify(decks));
  });
}

export function upsertDeck(deck: Deck): Deck[] {
  const decks = loadDecks();
  const i = decks.findIndex((d) => d.id === deck.id);
  const next = { ...deck, updatedAt: new Date().toISOString() };
  if (i >= 0) decks[i] = next;
  else decks.push(next);
  saveDecks(decks);
  return decks.map(migrateDeck);
}

export function deleteDeck(id: string): Deck[] {
  const next = loadDecks().filter((d) => d.id !== id);
  saveDecks(next);
  return next;
}

export function newDeck(name = '新牌組'): Deck {
  const now = new Date().toISOString();
  return {
    id: randomId(),
    name,
    entries: [],
    createdAt: now,
    updatedAt: now
  };
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
