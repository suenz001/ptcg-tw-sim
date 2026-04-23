import { load } from 'cheerio';
const html = await fetch('https://asia.pokemon-card.com/tw/card-search/detail/17151/').then(r=>r.text());
const $ = load(html);
console.log('Class alpha:', $('.alpha').text().trim());
console.log('Class regulationLabel:', $('.regulationLabel').text().trim());
console.log('Class regulation:', $('.regulation').text().trim());
