/**
 * Deep-dive into HTML to find regulation mark clues beyond .alpha
 */
import { load } from 'cheerio';

// A known G-mark card
const url = 'https://asia.pokemon-card.com/tw/card-search/detail/13153/';
const res = await fetch(url);
const html = await res.text();
const $ = load(html);

// Dump the entire right-side detail section
const rightDetail = $('.right-pokemon-detail, .pokemon-detail-right, .pokemon-card-detail').first();
console.log('=== Right detail HTML ===');
console.log(rightDetail.html()?.substring(0, 3000) || 'NOT FOUND');

// Also check for hidden/data attributes
$('[data-regulation], [data-mark], [data-alpha]').each((_, el) => {
  console.log('Data attr:', $(el).attr('data-regulation') || $(el).attr('data-mark') || $(el).attr('data-alpha'));
});

// Check script tags for regulation data
$('script').each((_, el) => {
  const text = $(el).html() || '';
  if (/regulation|regmark|alpha/i.test(text)) {
    console.log('Script with regulation:', text.substring(0, 500));
  }
});

// Check the full page for any "G" occurrence near "regulation"
const fullText = html;
const gMatches = [...fullText.matchAll(/regulation.{0,50}/gi)];
console.log('\n=== "regulation" context in full HTML ===');
for (const m of gMatches) {
  console.log(m[0]);
}

// Look at the pokemon card image URL - maybe the card image itself has the mark encoded
const cardImgs = $('img');
console.log('\n=== All images ===');
cardImgs.each((_, el) => {
  const src = $(el).attr('src') || '';
  if (src.includes('pokemon') || src.includes('card')) {
    console.log(src);
  }
});
