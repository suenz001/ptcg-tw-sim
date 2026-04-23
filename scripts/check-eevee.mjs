import { load } from 'cheerio';
const html = await fetch('https://asia.pokemon-card.com/tw/card-search/detail/17037/').then(r=>r.text());
const $ = load(html);
console.log('H1:', $('h1').text().trim().replace(/\n+/g,' '));
const detailText = $('.card-detail, .pokemon-info, .card-info, .detail').text() || $('body').text();
const evoMatch = detailText.match(/從「([^」]+)」進化/);
console.log('Evo:', evoMatch ? evoMatch[1] : null);
