import type { Deck } from './types';
export type PresetCatalogData = { presetsApi: 1; revision: number; decks: Deck[] };
/** 網路與localStorage同一份防損壞檢查，空陣列有效。 */
export function parsePresetCatalog(value: unknown): PresetCatalogData | null {
  const d = value as any;
  if (d?.presetsApi !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 1 || !Array.isArray(d.decks) || d.decks.length > 300) return null;
  const ids = new Set();
  for (const deck of d.decks) {
    if (!deck || typeof deck.id !== 'string' || !deck.id.startsWith('__preset_') || ids.has(deck.id) || typeof deck.name !== 'string' || !Array.isArray(deck.entries) || deck.entries.length > 60) return null;
    ids.add(deck.id);
    if (!deck.entries.every((e: any) => e && typeof e.cardId === 'string' && /^\d+$/.test(e.cardId) && Number.isInteger(e.count) && e.count > 0 && e.count <= 60)) return null;
  }
  return d;
}
