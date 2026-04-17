// Card pool loader — used by the deck editor to look up cards by id,
// search by name, and enumerate cards per set.
//
// We fetch each set's JSON lazily the first time it's needed and keep the
// results in module-level memory. The deck editor often needs the *whole*
// Standard pool (to validate / resolve card ids), so `loadAllSets()` fans
// out the per-set loads in parallel.

import { base } from '$app/paths';
import type { Card, SetSummary } from './types';

const setCache = new Map<string, Card[]>();
let indexCache: SetSummary[] | null = null;
const inflight = new Map<string, Promise<Card[]>>();

export async function loadIndex(
  fetchFn: typeof fetch = fetch
): Promise<SetSummary[]> {
  if (indexCache) return indexCache;
  const res = await fetchFn(`${base}/cards/index.json`);
  if (!res.ok) throw new Error(`Failed to load index.json: HTTP ${res.status}`);
  indexCache = (await res.json()) as SetSummary[];
  return indexCache;
}

export async function loadSet(
  setCode: string,
  fetchFn: typeof fetch = fetch
): Promise<Card[]> {
  const cached = setCache.get(setCode);
  if (cached) return cached;
  const pending = inflight.get(setCode);
  if (pending) return pending;

  const p = (async () => {
    const res = await fetchFn(`${base}/cards/${setCode}.json`);
    if (!res.ok) throw new Error(`Set ${setCode} not found (HTTP ${res.status})`);
    const cards = (await res.json()) as Card[];
    setCache.set(setCode, cards);
    inflight.delete(setCode);
    return cards;
  })();
  inflight.set(setCode, p);
  return p;
}

/** Load every set listed in index.json in parallel. */
export async function loadAllSets(
  fetchFn: typeof fetch = fetch
): Promise<Card[]> {
  const index = await loadIndex(fetchFn);
  const batches = await Promise.all(
    index.map((s) => loadSet(s.code, fetchFn))
  );
  return batches.flat();
}

/** Build a Map<cardId, Card> for quick lookup during validation. */
export function buildCardIndex(cards: Card[]): Map<string, Card> {
  const m = new Map<string, Card>();
  for (const c of cards) m.set(c.id, c);
  return m;
}
