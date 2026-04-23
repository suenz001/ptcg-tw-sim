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

// Deduplicate by sourceUrl
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
console.log(`Auditing ${urls.length} unique Pokemon URLs...`);

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
      
      // Look for explicit evolution info only in .evolution div to avoid Ability text
      let webEvo = null;
      const evoDiv = $('.evolution').first();
      if (evoDiv.length) {
         const names = evoDiv.find('a, span').map((_, el) => $(el).text().trim()).get().filter(Boolean);
         const targetName = h1Lines[h1Lines.length - 1]; // e.g. "賽富豪"
         const idx = names.lastIndexOf(targetName);
         if (idx > 0) {
            webEvo = names[idx - 1];
         }
      }
      
      results.push({ url, webStage, webEvo });
    } catch (e) {
      console.log(`Error fetching ${url}: ${e.message}`);
    }
    
    progress++;
    if (progress % 500 === 0) {
      console.log(`Progress: ${progress} / ${urls.length}`);
    }
  });
  
  await Promise.all(promises);
}

async function run() {
  const BATCH_SIZE = 30;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    await processBatch(batch);
  }
  
  let mismatches = 0;
  let fixes = 0;
  const fixMap = new Map();
  
  for (const res of results) {
    const items = urlMap.get(res.url);
    for (const item of items) {
      const { file, card } = item;
      const currentStage = card.stage || 'Basic';
      const currentEvo = card.evolvesFrom || null;
      
      let changed = false;
      
      if (res.webStage && ['Basic', 'Stage1', 'Stage2'].includes(res.webStage) && currentStage !== res.webStage) {
        if (!card.name.startsWith('超級')) { // Skip Megas
          console.log(`[STAGE] ${card.name} (${card.id}): ${currentStage} -> ${res.webStage}`);
          card.stage = res.webStage;
          changed = true;
        }
      }
      
      // Clean webEvo
      if (res.webEvo) {
         let cleanEvo = res.webEvo.replace(/[<>]/g, '').replace(/ex$/, '').replace(/GX$/, '').replace(/V$/, '').trim();
         // Basic pokemon never evolve FROM something (except special mechanics like MEGA, which we skip here)
         if (card.stage !== 'Basic' && currentEvo !== cleanEvo) {
            console.log(`[EVO] ${card.name} (${card.id}): ${currentEvo} -> ${cleanEvo}`);
            card.evolvesFrom = cleanEvo;
            changed = true;
         }
      } else {
         // if webEvo is null but it's Stage1/Stage2, we leave currentEvo alone if it exists.
      }
      
      // Remove evolvesFrom if Basic (and not Mega)
      if (card.stage === 'Basic' && !card.name.startsWith('超級') && card.evolvesFrom) {
         console.log(`[CLEAN EVO] ${card.name} (${card.id}): removed evolvesFrom (${card.evolvesFrom}) because it's Basic`);
         delete card.evolvesFrom;
         changed = true;
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
          for (const url of urls) {
             const items = urlMap.get(url);
             const matched = items.find(x => x.card.id === fc.id);
             if (matched) {
               fc.stage = matched.card.stage;
               if (matched.card.evolvesFrom) fc.evolvesFrom = matched.card.evolvesFrom;
               else delete fc.evolvesFrom;
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
