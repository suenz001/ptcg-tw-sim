/**
 * fix-regmark-by-image.mjs
 * 
 * Downloads each card's image and checks the bottom-left corner for the
 * regulation mark letter (G, H, I, J). Uses pixel color analysis to determine
 * the letter.
 * 
 * Actually, a simpler approach: download the card image and look at a specific
 * region. BUT this requires canvas/sharp which may not be available.
 * 
 * SIMPLEST approach: Use the card search API to check the official regulation.
 * Let's try the card-search API.
 */
import { load } from 'cheerio';

// The official search API might have regulation info
// Let's try: https://asia.pokemon-card.com/tw/card-search/list/?pageNo=1&regulation=1
// regulation=1 is Standard, regulation=2 is Expanded

async function getStandardCardIds() {
  const ids = new Set();
  let page = 1;
  const maxPages = 200;
  
  while (page <= maxPages) {
    const url = `https://asia.pokemon-card.com/tw/card-search/list/?pageNo=${page}&regulation=1`;
    console.log(`Fetching Standard page ${page}...`);
    const res = await fetch(url);
    if (!res.ok) break;
    const html = await res.text();
    const $ = load(html);
    
    // Find card links
    const links = $('a[href*="/card-search/detail/"]');
    if (links.length === 0) break;
    
    links.each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/detail\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    
    console.log(`  Found ${links.length} cards, total ${ids.size}`);
    
    // Check if there's a next page
    const hasNext = $('a.next, .pagination .next, [class*="next"]').length > 0;
    if (!hasNext && links.length < 20) break;
    
    page++;
    await new Promise(r => setTimeout(r, 200));
  }
  
  return ids;
}

// Actually, let's just check a few cards to understand if the API response includes
// regulation mark info
async function checkApiResponse() {
  // Check if card search list page has regulation info per card
  const url = 'https://asia.pokemon-card.com/tw/card-search/list/?pageNo=1&regulation=1';
  const res = await fetch(url);
  const html = await res.text();
  const $ = load(html);
  
  // Look for any regulation mark info in the list
  const firstCard = $('a[href*="/card-search/detail/"]').first();
  const cardContainer = firstCard.closest('li, .card-item, .pokemon-card');
  console.log('Card container HTML:', cardContainer.html()?.substring(0, 500));
  
  // Also check if there are any regulation-related classes
  $('[class*="alpha"], [class*="regulation"], [class*="mark"]').each((i, el) => {
    if (i < 5) {
      console.log(`Class: ${$(el).attr('class')}, Text: ${$(el).text().trim().substring(0, 30)}`);
    }
  });
}

checkApiResponse();
