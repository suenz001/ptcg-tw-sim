import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import http from 'node:http';
import https from 'node:https';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.supertype === 'Trainer' || (c.supertype === 'Pokemon' && c.subtype === 'Other')) {
      if (c.sourceUrl) {
        allCards.push({ file: f, card: c });
      }
    }
  }
}

const urlMap = new Map();
for (const item of allCards) {
  if (!urlMap.has(item.card.sourceUrl)) {
    urlMap.set(item.card.sourceUrl, []);
  }
  urlMap.get(item.card.sourceUrl).push(item);
}

const urls = Array.from(urlMap.keys());
console.log(`Auditing ${urls.length} unique URLs for Trainer classification...`);

const results = [];
let progress = 0;

async function fetchUrl(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { agent: url.startsWith('https') ? httpsAgent : httpAgent });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function classifyTrainerOrEnergyByH3(html) {
  const $ = load(html);
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get();
  for (const text of h3s) {
    const t = text.replace(/\s+/g, '');
    if (t.includes('支援者卡')) return { supertype: 'Trainer', subtype: 'Supporter' };
    if (t.includes('競技場卡')) return { supertype: 'Trainer', subtype: 'Stadium' };
    if (t.includes('寶可夢道具')) return { supertype: 'Trainer', subtype: 'PokemonTool' };
    if (t.includes('物品卡')) return { supertype: 'Trainer', subtype: 'Item' };
    if (t.includes('特殊能量卡')) return { supertype: 'Energy', subtype: 'Special' };
    if (t.includes('基本能量卡')) return { supertype: 'Energy', subtype: 'Basic' };
  }
  return null;
}

async function processBatch(batch) {
  const promises = batch.map(async (url) => {
    try {
      const html = await fetchUrl(url);
      const classification = classifyTrainerOrEnergyByH3(html);
      results.push({ url, classification });
    } catch (e) {
      console.log(`Error fetching ${url}: ${e.message}`);
    }
    progress++;
    if (progress % 100 === 0) console.log(`Progress: ${progress} / ${urls.length}`);
  });
  await Promise.all(promises);
}

async function run() {
  const BATCH_SIZE = 30;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    await processBatch(urls.slice(i, i + BATCH_SIZE));
  }
  
  let mismatches = 0;
  const fixMap = new Map();
  
  for (const res of results) {
    if (!res.classification) continue;
    const items = urlMap.get(res.url);
    for (const item of items) {
      const { file, card } = item;
      
      const expectedSuper = res.classification.supertype;
      const expectedSub = res.classification.subtype;
      
      // I manually set some cards to Trainer/Tool earlier, it should be PokemonTool.
      const currentSub = card.subtype === 'Tool' ? 'PokemonTool' : card.subtype;
      
      if (card.supertype !== expectedSuper || currentSub !== expectedSub) {
        console.log(`Mismatch: ${card.name} (${card.id}) in ${file} | JSON: ${card.supertype}/${card.subtype} | Web: ${expectedSuper}/${expectedSub}`);
        card.supertype = expectedSuper;
        card.subtype = expectedSub;
        // Clean up pokemon fields if it was incorrectly parsed as Pokemon
        if (expectedSuper === 'Trainer') {
          delete card.hp;
          delete card.pokemonType;
          delete card.stage;
          delete card.weakness;
          delete card.resistance;
          delete card.retreatCost;
        }
        mismatches++;
        if (!fixMap.has(file)) fixMap.set(file, new Set());
        fixMap.get(file).add(card.id);
      }
    }
  }
  console.log(`Found ${mismatches} Trainer classification mismatches.`);
  
  if (mismatches > 0) {
    let fixes = 0;
    for (const [file, idSet] of fixMap.entries()) {
      const fp = path.join(DIR, file);
      const fileCards = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const fc of fileCards) {
        if (idSet.has(fc.id)) {
          for (const url of urls) {
             const items = urlMap.get(url);
             const matched = items.find(x => x.card.id === fc.id);
             if (matched) {
               fc.supertype = matched.card.supertype;
               fc.subtype = matched.card.subtype;
               if (fc.supertype === 'Trainer') {
                 delete fc.hp;
                 delete fc.pokemonType;
                 delete fc.stage;
                 delete fc.weakness;
                 delete fc.resistance;
                 delete fc.retreatCost;
               }
             }
          }
        }
      }
      fs.writeFileSync(fp, JSON.stringify(fileCards, null, 2) + '\n', 'utf8');
      fixes += idSet.size;
    }
    console.log(`Fixed ${fixes} cards in JSON files.`);
  }
}

run().catch(console.error);
