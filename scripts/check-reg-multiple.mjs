import { load } from 'cheerio';

async function checkReg(url) {
  const html = await fetch(url).then(r=>r.text());
  const $ = load(html);
  console.log(url, '-> alpha:', $('.alpha').text().trim());
}

checkReg('https://asia.pokemon-card.com/tw/card-search/detail/17151/');
checkReg('https://asia.pokemon-card.com/tw/card-search/detail/12304/');
checkReg('https://asia.pokemon-card.com/tw/card-search/detail/13163/');
