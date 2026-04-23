/**
 * fix-regmark-via-image-ocr.mjs
 * 
 * Since the official website's .alpha class is WRONG (always "J"),
 * we need to read the regulation mark directly from the card image.
 * 
 * The regulation mark appears in the bottom-left corner of the card.
 * We'll use sharp to crop that region and analyze the pixel patterns.
 * 
 * For each card in our database, we download the image, crop the
 * bottom-left 60x40 pixel area, and use pixel heuristics to determine
 * if it's G, H, I, or J.
 * 
 * Actually, let me try a different approach first: use the card-search
 * API with different regulation filters to determine which cards belong
 * to which regulation.
 * 
 * The API supports:
 *   regulation=1 → Standard (H, I, J)  
 *   regulation=2 → Expanded (all)
 *   regulation=3 → Other
 * 
 * If a card appears in regulation=1 (Standard), it's H/I/J.
 * If it only appears in regulation=2 or 3, it might be G or earlier.
 * 
 * But this still doesn't tell us exactly G vs H vs I vs J...
 * 
 * BEST approach: Since we have the card images anyway, let's compare
 * the regulation mark pixel region to reference images of G, H, I, J.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';

// Let's take an entirely different approach. 
// We know that the PTCG API/site has a concept of "Standard" regulation.
// Cards in Standard = H + I + J marks.
// Cards NOT in Standard but in Expanded = G and earlier.
//
// So let's:
// 1. Fetch ALL card IDs from the Standard regulation (regulation=1)
// 2. Any card in our DB that is NOT in Standard → it's G mark
// 3. For H vs I vs J within Standard, we use the set code mapping

// But wait - some mixed sets have G, H, I cards mixed together.
// The set code alone won't work. We need per-card regulation.
//
// Actually, the user said to CHECK the card image. Let me just look at the
// detail page more carefully - maybe there IS regulation mark info somewhere
// we haven't found.

async function deepCheckDetailPage(id) {
  const url = `https://asia.pokemon-card.com/tw/card-search/detail/${id}/`;
  const res = await fetch(url);
  const html = await res.text();
  
  // Search for single letters G, H, I, J in specific contexts
  // The .alpha span gives wrong results.
  // Let's look for JavaScript data or API calls
  
  // Check for JSON data embedded in the page
  const jsonMatches = html.match(/\{[^{}]*"regulat[^{}]*\}/g);
  if (jsonMatches) {
    for (const m of jsonMatches) {
      console.log(`JSON with regulation in ${id}:`, m.substring(0, 200));
    }
  }
  
  // Check for __NEXT_DATA__ or similar
  const nextData = html.match(/__NEXT_DATA__[^{]*(\{.+?\})\s*<\/script>/);
  if (nextData) {
    console.log('NEXT_DATA found');
  }
  
  // Check for window.__data or similar
  const windowData = html.match(/window\.__\w+\s*=\s*(\{.+?\});/);
  if (windowData) {
    console.log('Window data found');
  }
  
  // Check for API endpoints
  const apiMatches = html.match(/api[^"']*card[^"']*/gi);
  if (apiMatches) {
    console.log('API endpoints:', [...new Set(apiMatches)]);
  }
  
  return html;
}

// Check the "not in standard" approach
async function checkNotStandard() {
  // Fetch page 1 of "Other" regulation (regulation=3)
  const url = 'https://asia.pokemon-card.com/tw/card-search/list/?pageNo=1&regulation=3';
  const res = await fetch(url);
  const html = await res.text();
  const $ = load(html);
  
  const links = $('a[href*="/card-search/detail/"]');
  console.log(`\n"Other" regulation cards (page 1): ${links.length} cards`);
  links.each((i, el) => {
    if (i < 10) {
      const href = $(el).attr('href') || '';
      console.log('  ', href);
    }
  });
}

async function main() {
  // Test a known G-mark card and a known H-mark card
  console.log('=== Checking G-mark card (寶可夢捕捉器 SVQP) ===');
  await deepCheckDetailPage('13153');
  
  console.log('\n=== Checking H-mark card (SV5K #1) ===');
  await deepCheckDetailPage('9612');
  
  console.log('\n=== Checking Standard vs Other ===');
  await checkNotStandard();
}

main();
