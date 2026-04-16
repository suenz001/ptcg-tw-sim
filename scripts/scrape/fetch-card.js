/**
 * CLI: fetch one or more cards by numeric ID and print parsed JSON.
 * Usage:
 *   node scripts/scrape/fetch-card.js 12780 12845 12848 12904
 */

import { parseCard } from './parse-card.js';

const BASE = 'https://asia.pokemon-card.com';

async function fetchAndParse(id) {
  const url = `${BASE}/tw/card-search/detail/${id}/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return parseCard(html, id, url);
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Usage: node fetch-card.js <id> [<id>...]');
  process.exit(1);
}

const results = [];
for (const id of ids) {
  try {
    const card = await fetchAndParse(id);
    results.push(card);
  } catch (e) {
    console.error(`[${id}] ${e.message}`);
  }
}

console.log(JSON.stringify(results, null, 2));
