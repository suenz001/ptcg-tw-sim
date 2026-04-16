import { base } from '$app/paths';
import type { Card } from '$lib/cards/types';

/** Load the SV10 card list from static/cards/SV10.json. */
export async function load({ fetch }) {
  const res = await fetch(`${base}/cards/SV10.json`);
  if (!res.ok) throw new Error(`Failed to load SV10.json: HTTP ${res.status}`);
  const cards: Card[] = await res.json();
  return { cards, setCode: 'SV10' };
}
