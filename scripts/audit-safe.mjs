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
console.log(`Checking ${urls.length} URLs for stage mismatches...`);

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
      results.push({ url, webStage });
    } catch (e) {}
    progress++;
    if (progress % 500 === 0) console.log(`Progress: ${progress} / ${urls.length}`);
  });
  await Promise.all(promises);
}

async function run() {
  const BATCH_SIZE = 30;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    await processBatch(urls.slice(i, i + BATCH_SIZE));
  }
  
  let mismatches = 0;
  for (const res of results) {
    const items = urlMap.get(res.url);
    for (const item of items) {
      const { file, card } = item;
      const currentStage = card.stage || 'Basic';
      
      if (res.webStage && ['Basic', 'Stage1', 'Stage2'].includes(res.webStage) && currentStage !== res.webStage) {
        // Skip Mega ex since we handled them
        if (!card.name.startsWith('超級')) {
          console.log(`Mismatch: ${card.name} (${card.id}) in ${file} | JSON: ${currentStage} | Web: ${res.webStage}`);
          mismatches++;
        }
      }
    }
  }
  console.log(`Found ${mismatches} stage mismatches.`);
}
run();
