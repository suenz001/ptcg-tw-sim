import { load } from 'cheerio';

async function checkH3(url) {
  const html = await fetch(url).then(r=>r.text());
  const $ = load(html);
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get();
  console.log(url, '-> h3s:', h3s);
}

// 璀璨結晶 (Tool)
checkH3('https://asia.pokemon-card.com/tw/card-search/detail/17151/');
// 博士的研究 (Supporter)
checkH3('https://asia.pokemon-card.com/tw/card-search/detail/13156/');
// 寶可夢交替 (Item)
checkH3('https://asia.pokemon-card.com/tw/card-search/detail/13151/');
