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
    if (c.supertype === 'Pokemon' && c.subtype !== 'Other') {
      allCards.push({ file: f, card: c });
    }
  }
}

// Deduplicate by sourceUrl to save requests
const urlMap = new Map();
for (const item of allCards) {
  if (item.card.sourceUrl) {
    if (!urlMap.has(item.card.sourceUrl)) {
      urlMap.set(item.card.sourceUrl, []);
    }
    urlMap.get(item.card.sourceUrl).push(item);
  }
}

const urls = Array.from(urlMap.keys());
console.log(`Auditing ${urls.length} unique Pokemon URLs for stage and evolvesFrom...`);

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2', 'V-UNION': 'V-UNION' };
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

async function processBatch(batch) {
  const promises = batch.map(async (url) => {
    try {
      const html = await fetchUrl(url);
      const $ = load(html);
      
      const h1Lines = $('h1').first().text().trim().split('\n').map(s => s.trim()).filter(Boolean);
      const webStage = h1Lines.length >= 2 ? (stageMap[h1Lines[0]] || h1Lines[0]) : null;
      
      const detailText = $('.card-detail, .pokemon-info, .card-info, .detail').text() || $('body').text();
      const evoMatch = detailText.match(/從「([^」]+)」進化/);
      let webEvo = evoMatch ? evoMatch[1] : null;
      
      results.push({ url, webStage, webEvo });
    } catch (e) {
      console.log(`Error fetching ${url}: ${e.message}`);
    }
    
    progress++;
    if (progress % 100 === 0) {
      console.log(`Progress: ${progress} / ${urls.length}`);
    }
  });
  
  await Promise.all(promises);
}

async function run() {
  const BATCH_SIZE = 20;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    await processBatch(batch);
  }
  
  // Now compare
  let mismatches = 0;
  let fixes = 0;
  const fixMap = new Map(); // file -> cards to fix
  
  for (const res of results) {
    const items = urlMap.get(res.url);
    for (const item of items) {
      const { file, card } = item;
      const currentStage = card.stage || 'Basic';
      const currentEvo = card.evolvesFrom || null;
      
      let changed = false;
      
      // Stage mismatch check
      // Some special cards like V, ex might be Basic even if their normal form is not, Svelte logic handles subtype well.
      // We only care if the explicit 'stage' property differs from the Web's explicit H1 stage for Stage1/Stage2
      if (res.webStage && ['Basic', 'Stage1', 'Stage2'].includes(res.webStage) && currentStage !== res.webStage) {
        // Special case: Mega we already fixed manually
        if (!card.name.startsWith('超級')) {
          console.log(`[STAGE] ${card.name} (${card.id}): ${currentStage} -> ${res.webStage}`);
          card.stage = res.webStage;
          changed = true;
        }
      }
      
      // Evo mismatch check
      // Ignore if webEvo is null but currentEvo has something (some promos have no evo info on page)
      if (res.webEvo && currentEvo !== res.webEvo) {
        // Clean webEvo of 'ex' etc just to be sure
        let cleanEvo = res.webEvo.replace(/ex$/, '').replace(/GX$/, '').replace(/V$/, '').trim();
        if (currentEvo !== cleanEvo && currentEvo !== res.webEvo) {
          console.log(`[EVO] ${card.name} (${card.id}): ${currentEvo} -> ${cleanEvo}`);
          card.evolvesFrom = cleanEvo;
          changed = true;
        }
      }
      
      if (changed) {
        mismatches++;
        if (!fixMap.has(file)) fixMap.set(file, new Set());
        fixMap.get(file).add(card.id);
      }
    }
  }
  
  console.log(`Found ${mismatches} mismatches.`);
  
  if (mismatches > 0) {
    for (const [file, idSet] of fixMap.entries()) {
      const fp = path.join(DIR, file);
      const fileCards = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const fc of fileCards) {
        if (idSet.has(fc.id)) {
          // Find the updated card in items
          for (const url of urls) {
             const items = urlMap.get(url);
             const matched = items.find(x => x.card.id === fc.id);
             if (matched) {
               fc.stage = matched.card.stage;
               fc.evolvesFrom = matched.card.evolvesFrom;
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
