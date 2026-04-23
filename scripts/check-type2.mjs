import { load } from 'cheerio';
fetch('https://asia.pokemon-card.com/tw/card-search/detail/17151/').then(r=>r.text()).then(h=>{
  const $ = load(h);
  console.log('--- .cardType text ---');
  console.log($('.cardType').text());
  console.log('--- .type text ---');
  console.log($('.type').text());
  console.log('--- h1 html ---');
  console.log($('h1').html());
  console.log('--- header area html ---');
  console.log($('.card-detail').html()?.substring(0, 500));
});
