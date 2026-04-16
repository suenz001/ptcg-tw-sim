import { base } from '$app/paths';
import type { Card, SetSummary } from '$lib/cards/types';

/**
 * Loads either:
 *  - the set index (list of all sets) when no `?set=` query is present
 *  - a single set's cards when `?set=SV10` is present
 *
 * Both results come from static/cards/*.json, fetched at runtime.
 */
export async function load({ fetch, url }) {
  const setCode = url.searchParams.get('set');

  if (!setCode) {
    const res = await fetch(`${base}/cards/index.json`);
    if (!res.ok) throw new Error(`Failed to load sets index: HTTP ${res.status}`);
    const sets: SetSummary[] = await res.json();
    return { mode: 'index' as const, sets };
  }

  // Validate setCode looks legitimate (avoid letting arbitrary strings hit static)
  if (!/^[A-Za-z0-9]+$/.test(setCode)) {
    throw new Error(`Invalid set code: ${setCode}`);
  }

  const res = await fetch(`${base}/cards/${setCode}.json`);
  if (!res.ok) throw new Error(`Set ${setCode} not found (HTTP ${res.status})`);
  const cards: Card[] = await res.json();
  return { mode: 'set' as const, setCode, cards };
}
