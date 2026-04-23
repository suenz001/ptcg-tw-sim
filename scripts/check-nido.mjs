import { load } from 'cheerio';
const html = await fetch('https://asia.pokemon-card.com/tw/card-search/detail/16908/').then(r=>r.text());
const $ = load(html);
console.log('H1:', $('h1').text().trim().replace(/\n+/g,' '));
console.log('Evolution div:', $('.evolution').text().replace(/\s+/g, ' '));
