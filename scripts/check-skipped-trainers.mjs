import { load } from 'cheerio';
async function test(url) {
  const html = await fetch(url).then(r=>r.text());
  const $ = load(html);
  console.log(url);
  console.log('H3s:', $('h3').map((_,el)=>$(el).text().trim()).get());
}
test('https://asia.pokemon-card.com/tw/card-search/detail/12420/');
test('https://asia.pokemon-card.com/tw/card-search/detail/12449/');
