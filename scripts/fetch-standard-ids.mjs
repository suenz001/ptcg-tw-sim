/**
 * Fetch all Standard regulation card IDs from the official site.
 * Cards NOT in this list but in our DB → likely G mark.
 */
import { load } from 'cheerio';

async function fetchStandardIds() {
  const ids = new Set();
  
  for (let page = 1; page <= 300; page++) {
    const url = `https://asia.pokemon-card.com/tw/card-search/list/?pageNo=${page}&regulation=1`;
    const res = await fetch(url);
    if (!res.ok) { console.log(`Page ${page}: HTTP ${res.status}`); break; }
    const html = await res.text();
    const $ = load(html);
    
    const links = $('a[href*="/card-search/detail/"]');
    if (links.length === 0) {
      console.log(`Page ${page}: no cards found, stopping.`);
      break;
    }
    
    links.each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/detail\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    
    if (page % 10 === 0) console.log(`Page ${page}: total ${ids.size} standard card IDs`);
    
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`\nTotal Standard card IDs: ${ids.size}`);
  return ids;
}

const stdIds = await fetchStandardIds();

// Now check our DB
import fs from 'node:fs';
const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

let notInStd = 0;
let inStd = 0;

for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
  for (const c of cards) {
    if (stdIds.has(String(c.id))) {
      inStd++;
    } else {
      notInStd++;
      if (c.regulationMark !== 'G') {
        console.log(`NOT in Standard but mark=${c.regulationMark}: ${f} ${c.id} ${c.name} ${c.collectorNumber}`);
      }
    }
  }
}

console.log(`\nIn Standard: ${inStd}, Not in Standard: ${notInStd}`);
