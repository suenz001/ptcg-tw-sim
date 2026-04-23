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
    if (c.sourceUrl) {
      allCards.push({ file: f, card: c });
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
console.log(`Auditing ${urls.length} unique URLs for regulation marks...`);

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
      const alpha = $('.alpha').first().text().trim();
      const mark = (alpha && /^[A-Z]$/.test(alpha)) ? alpha : null;
      results.push({ url, mark });
    } catch (e) {
      console.log(`Error fetching ${url}: ${e.message}`);
    }
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
  const fixMap = new Map();
  
  for (const res of results) {
    const items = urlMap.get(res.url);
    for (const item of items) {
      const { file, card } = item;
      
      if (res.mark && res.mark !== card.regulationMark) {
        console.log(`Mismatch: ${card.name} (${card.id}) in ${file} | JSON: ${card.regulationMark} | Web: ${res.mark}`);
        card.regulationMark = res.mark;
        mismatches++;
        if (!fixMap.has(file)) fixMap.set(file, new Set());
        fixMap.get(file).add(card.id);
      }
    }
  }
  console.log(`Found ${mismatches} regulation mark mismatches.`);
  
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
             if (matched && matched.card.regulationMark) {
               fc.regulationMark = matched.card.regulationMark;
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
