/**
 * Test multiple cards to see the discrepancy between the HTML .alpha class 
 * and the actual card image regulation mark.
 */
import { load } from 'cheerio';

const testCards = [
  { id: '13153', name: '寶可夢捕捉器 SVQP', expected: 'G' },
  { id: '13173', name: '粉碎之錘 SVQL', expected: 'G' },
  { id: '12741', name: '裁判 SV9a 083/063', expected: 'G' },
  { id: '18376', name: '傷藥 MJ', expected: 'G' },
  { id: '10304', name: '寶可夢捕捉器 SV5a', expected: 'H' },
  { id: '12720', name: '裁判 SV9a 062/063', expected: 'G or H' },
  { id: '17114', name: '傷藥 MC 643', expected: 'G' },
  // Known good H-mark cards for comparison
  { id: '9612', name: 'SV5K card 1', expected: 'H' },
];

async function check(card) {
  const url = `https://asia.pokemon-card.com/tw/card-search/detail/${card.id}/`;
  const res = await fetch(url);
  const html = await res.text();
  const $ = load(html);
  
  // Get the .alpha class text
  const alphaMark = $('span.alpha').text().trim() || 'NOT FOUND';
  
  // Get the card image URL to check if we can see the mark
  const cardImg = $('img.pokemon-img, .pokemon-img img, .pokemon-card img').first();
  const imgSrc = cardImg.attr('src') || 'NOT FOUND';
  
  // Check the expansion mark image  
  const expImg = $('img[src*="mark"]').first();
  const expSrc = expImg.attr('src') || 'NOT FOUND';
  
  console.log(`${card.name} (ID ${card.id}): .alpha="${alphaMark}" expected="${card.expected}" expImg="${expSrc}"`);
}

for (const card of testCards) {
  await check(card);
}
