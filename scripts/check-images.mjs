import { load } from 'cheerio';
async function test(url) {
  const html = await fetch(url).then(r=>r.text());
  const $ = load(html);
  console.log(url);
  console.log('.cardType img:', $('.cardType img').attr('alt'), $('.cardType img').attr('src'));
  console.log('.type img:', $('.type img').attr('alt'), $('.type img').attr('src'));
  console.log('.commonHeader img:', $('.commonHeader img').attr('alt'), $('.commonHeader img').attr('src'));
}
test('https://asia.pokemon-card.com/tw/card-search/detail/12420/');
test('https://asia.pokemon-card.com/tw/card-search/detail/12449/');
