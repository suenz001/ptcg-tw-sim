import { load } from 'cheerio';
const url = 'https://asia.pokemon-card.com/tw/card-search/detail/14425/';
fetch(url).then(r=>r.text()).then(html=>{
  const $ = load(html);
  console.log('--- H1 ---');
  console.log($('h1').text().trim());
  console.log('--- .evolution ---');
  console.log($('.evolution').text().replace(/\s+/g, ' '));
  console.log('--- card image text ---');
  // Sometimes evolution text is in an image alt or specific meta div
  console.log('Evolution info is usually not in text on PTCG Asia site, it might be an image. Let me check the DOM structure for evolution specific classes.');
  
  // Try to find the stage from the evolution class
  const evoItems = $('.evolution li');
  console.log('Evo list items: ' + evoItems.length);
  evoItems.each((i, el) => {
    console.log(`Item ${i}:`, $(el).text().replace(/\s+/g, ' ').trim());
  });
  
  // Actually, PTCG Asia official site puts the exact stage string in h1.
});
