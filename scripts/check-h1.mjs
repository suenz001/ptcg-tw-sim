import { load } from 'cheerio';
const urls = [
  'https://asia.pokemon-card.com/tw/card-search/detail/14425/', // 超級噴火龍Xex
  'https://asia.pokemon-card.com/tw/card-search/detail/13970/', // 超級噴火駝ex
  'https://asia.pokemon-card.com/tw/card-search/detail/14052/', // 超級雷電獸ex
  'https://asia.pokemon-card.com/tw/card-search/detail/14038/', // 超級暴雪王ex
  'https://asia.pokemon-card.com/tw/card-search/detail/18516/'  // 超級甲賀忍蛙ex
];
for (const url of urls) {
  const html = await fetch(url).then(r => r.text());
  const $ = load(html);
  console.log('---', url, '---');
  console.log($('h1').text().trim().replace(/\n+/g,' '));
}
