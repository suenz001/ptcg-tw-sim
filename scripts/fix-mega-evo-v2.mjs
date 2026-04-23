#!/usr/bin/env node
/**
 * fix-mega-evo-v2.mjs — Fix base ex cards missing evolvesFrom + Mega ex cards
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Load all Pokemon
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon') allCards.push(c);
}

// Step 1: Find base ex cards that should have evolvesFrom but don't
// These are ex cards with stage != Basic but no evolvesFrom
const brokenBaseEx = new Map(); // name → sourceUrl
for (const c of allCards) {
  if (c.subtype !== 'ex') continue;
  if (c.name.startsWith('超級')) continue;
  if (c.evolvesFrom) continue; // Already has evolvesFrom
  if (c.stage === 'Basic') continue; // Basic ex - correct to have no evolvesFrom
  if (!brokenBaseEx.has(c.name)) brokenBaseEx.set(c.name, c.sourceUrl);
}

// Also find ex cards where evolvesFrom is missing and stage is unknown
// Check by seeing if non-ex version exists and is not Basic
for (const c of allCards) {
  if (c.subtype !== 'ex' || c.name.startsWith('超級') || c.evolvesFrom) continue;
  const baseName = c.name.replace(/ex$/, '').trim();
  const nonEx = allCards.find(x => x.name === baseName && x.stage && x.stage !== 'Basic');
  if (nonEx && !brokenBaseEx.has(c.name)) {
    brokenBaseEx.set(c.name, c.sourceUrl);
  }
}

console.log(`Step 1: Found ${brokenBaseEx.size} base ex cards missing evolvesFrom:`);
for (const [name] of brokenBaseEx) console.log(`  ${name}`);

// Step 2: Fetch these from the official website
const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };
const exFixes = new Map(); // name → { correctEvo, correctStage }

for (const [name, url] of brokenBaseEx) {
  if (!url) { console.log(`  SKIP ${name}: no sourceUrl`); continue; }
  console.log(`\nFetching ${name}: ${url}`);
  const resp = await fetch(url);
  const html = await resp.text();
  const $ = load(html);

  const h1Lines = $('h1').first().text().trim().split('\n').map(s => s.trim()).filter(Boolean);
  const correctStage = h1Lines.length >= 2 ? (stageMap[h1Lines[0]] || null) : null;

  const evo = $('.evolution').first();
  let correctEvo = null;
  if (evo.length) {
    const names = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
      .filter(s => s && s.length > 0);
    console.log(`  Chain: ${JSON.stringify(names)}`);

    const cardName = h1Lines[h1Lines.length - 1] || name;
    let idx = names.findIndex(n => n === cardName);
    if (idx < 0) idx = names.findIndex(n => n === name);
    const baseName = name.replace(/ex$/, '').trim();

    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const clean = names[i].replace(/[<>]/g, '').replace(/GX$/, '').replace(/ex$/, '').trim();
        if (clean !== baseName) {
          correctEvo = names[i].replace(/[<>]/g, '').replace(/GX$/, '');
          break;
        }
      }
    }
  }

  exFixes.set(name, { correctEvo, correctStage });
  console.log(`  → stage=${correctStage}, evolvesFrom=${correctEvo}`);
  await new Promise(r => setTimeout(r, 300));
}

// Step 3: Apply base ex fixes
console.log('\n=== Applying base ex fixes ===');
let baseFixed = 0;
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;
  for (const c of cards) {
    if (c.supertype !== 'Pokemon') continue;
    const fix = exFixes.get(c.name);
    if (!fix) continue;
    if (!c.evolvesFrom && fix.correctEvo) {
      console.log(`  ${f} ${c.id} ${c.name}: evo (none) → ${fix.correctEvo}`);
      c.evolvesFrom = fix.correctEvo;
      modified = true;
      baseFixed++;
    }
    if (fix.correctStage && c.stage !== fix.correctStage) {
      c.stage = fix.correctStage;
      modified = true;
    }
  }
  if (modified) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}
console.log(`Base ex fixed: ${baseFixed}`);

// Step 4: Now fix Mega ex cards — rebuild lookup and fix all Megas pointing to ex
console.log('\n=== Fixing Mega ex evolvesFrom ===');
// Reload data
const allCards2 = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon') allCards2.push(c);
}
const nameToEvo = new Map();
allCards2.forEach(c => { if (c.evolvesFrom && !nameToEvo.has(c.name)) nameToEvo.set(c.name, c.evolvesFrom); });

let megaFixed = 0;
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;
  for (const c of cards) {
    if (!c.name?.startsWith('超級') || !c.evolvesFrom) continue;
    // Follow chain until we reach a non-ex, non-same-species card
    let currentEvo = c.evolvesFrom;
    const megaBase = c.name.replace(/^超級/, '').replace(/ex$/, '').replace(/[XY]$/, '').trim();
    for (let i = 0; i < 10; i++) {
      const cleanCur = currentEvo.replace(/ex$/, '').replace(/GX$/, '').trim();
      // If current is an ex/GX variant or same species, follow its evolvesFrom
      if (cleanCur === megaBase || currentEvo.endsWith('ex') || currentEvo.endsWith('GX')) {
        const next = nameToEvo.get(currentEvo);
        if (next) { currentEvo = next; } else break;
      } else break;
    }
    if (currentEvo !== c.evolvesFrom) {
      console.log(`  ${f} ${c.id} ${c.name}: ${c.evolvesFrom} → ${currentEvo}`);
      c.evolvesFrom = currentEvo;
      modified = true;
      megaFixed++;
    }
  }
  if (modified) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}
console.log(`Mega fixed: ${megaFixed}`);

// Final verification
console.log('\n=== Final state of all Mega cards ===');
const seen = new Set();
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (!c.name?.startsWith('超級') || c.supertype !== 'Pokemon') continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const evo = c.evolvesFrom || '(none)';
    const bad = evo.endsWith('ex') ? ' ← STILL WRONG' : '';
    console.log(`${c.name.padEnd(16)} stage=${String(c.stage).padEnd(7)} evo=${evo}${bad}`);
  }
}
