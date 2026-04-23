import { load } from 'cheerio';
fetch('https://asia.pokemon-card.com/tw/card-search/detail/17151/').then(r=>r.text()).then(h=>{
  const $ = load(h);
  console.log(h.substring(h.indexOf('<body'), h.indexOf('</body') + 7));
});
