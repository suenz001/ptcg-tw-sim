// Local persistence for decks. Pure localStorage for now — swap in Firestore
// later without touching callers by keeping this API stable.

import type { Deck } from './types';
import { migrateCardId, migrateDeck } from './cardIdMigration';

const KEY = 'ptcg-tw-sim:decks';

export type LocalSaveResult = { ok: true } | { ok: false; error: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e || '本機儲存失敗');
}

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
// v5.352：依玩家自訂 order 排序；未設 order 者（order=undefined）視為極大值排後面，
//   並以 createdAt 為 tiebreak（未排序過的使用者維持原本 createdAt 排序，無回歸）。
export function sortDecks(decks: Deck[]): Deck[] {
  const M = Number.MAX_SAFE_INTEGER;
  return [...decks].sort((a, b) =>
    ((a.order ?? M) - (b.order ?? M)) || a.createdAt.localeCompare(b.createdAt));
}

export function loadDecks(): Deck[] {
  return browserOnly<Deck[]>([], () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // v5.301: 自動 jp_id → tw_id migration (M5 等已從日版升級為台版)
    // v5.352：依自訂 order 排序
    return sortDecks(parsed.map(migrateDeck));
  });
}

/** 寫入本機牌組並回報是否成功（絕不靜默吞掉 QuotaExceeded / 寫入權限錯誤）。 */
export function saveDecksChecked(decks: Deck[]): LocalSaveResult {
  if (typeof localStorage === 'undefined') return { ok: true };
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function saveDecks(decks: Deck[]): boolean {
  return saveDecksChecked(decks).ok;
}

export function upsertDeckChecked(deck: Deck): { decks: Deck[]; save: LocalSaveResult } {
  const decks = loadDecks();
  const i = decks.findIndex((d) => d.id === deck.id);
  const next = { ...deck, updatedAt: new Date().toISOString() };
  if (i >= 0) decks[i] = next;
  else decks.push(next);
  const save = saveDecksChecked(decks);
  return { decks: decks.map(migrateDeck), save };
}

export function upsertDeck(deck: Deck): Deck[] {
  return upsertDeckChecked(deck).decks;
}

export function deleteDeckChecked(id: string): { decks: Deck[]; save: LocalSaveResult } {
  const next = loadDecks().filter((d) => d.id !== id);
  const save = saveDecksChecked(next);
  return { decks: next, save };
}

export function deleteDeck(id: string): Deck[] {
  return deleteDeckChecked(id).decks;
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
