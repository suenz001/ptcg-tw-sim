import { load } from 'cheerio';
fetch('https://asia.pokemon-card.com/tw/card-search/detail/17151/').then(r=>r.text()).then(h=>{
  const $ = load(h);
  console.log('--- title ---');
  console.log($('title').text());
  console.log('--- img src ---');
  console.log($('.card-img img').attr('src'));
  console.log('--- raw header ---');
  console.log($('.card-detail-info').text().trim().replace(/\n+/g,' '));
  console.log('--- class list ---');
  console.log($('body').attr('class'));
});
