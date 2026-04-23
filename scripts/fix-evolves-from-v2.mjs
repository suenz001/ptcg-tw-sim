#!/usr/bin/env node
/**
 * fix-evolves-from-v2.mjs — 從官網重新解析進化鏈，修正 evolvesFrom + stage
 */

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Load all Pokemon cards
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.supertype === 'Pokemon') allCards.push({ card: c, file: f });
  }
}

// Find all problematic species
const problemSpecies = new Map();
for (const { card: c } of allCards) {
  if (!c.evolvesFrom) continue;
  const baseName = c.name.replace(/ex$/, '').trim();
  if (c.evolvesFrom !== c.name && !(c.evolvesFrom === baseName && c.name !== baseName)) continue;
  if (!problemSpecies.has(baseName)) {
    problemSpecies.set(baseName, c.sourceUrl);
  }
}

console.log(`Found ${problemSpecies.size} species to fix\n`);

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };
const speciesFixes = new Map();

for (const [baseName, url] of problemSpecies) {
  try {
    console.log(`Fetching ${baseName}: ${url}`);
    const resp = await fetch(url);
    const html = await resp.text();
    const $ = load(html);

    // Parse H1
    const h1Text = $('h1').first().text().trim();
    const h1Lines = h1Text.split('\n').map(s => s.trim()).filter(Boolean);
    let correctStage = null;
    if (h1Lines.length >= 2) {
      correctStage = stageMap[h1Lines[0]] || null;
    }

    // Parse .evolution
    const evo = $('.evolution').first();
    let correctEvo = null;
    if (evo.length) {
      const names = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
        .filter(s => s && s.length > 0);
      
      // Find the card name in chain (try exact match, then ex version)
      const cardName = h1Lines.length >= 2 ? h1Lines[h1Lines.length - 1] : baseName;
      let idx = names.findIndex(n => n === cardName);
      if (idx < 0) idx = names.findIndex(n => n === baseName + 'ex');
      if (idx < 0) idx = names.findIndex(n => n === baseName);

      if (idx > 0) {
        let prev = names[idx - 1].replace(/[<>]/g, '').replace(/GX$/, '');
        const prevBase = prev.replace(/ex$/, '').trim();
        // If previous is same species, skip to idx-2
        if (prevBase === baseName && idx >= 2) {
          prev = names[idx - 2].replace(/[<>]/g, '').replace(/GX$/, '');
        }
        correctEvo = prev;
      }
    }

    speciesFixes.set(baseName, { correctEvo, correctStage });
    console.log(`  → stage=${correctStage}, evolvesFrom=${correctEvo}`);

    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
  }
}

// Apply fixes to ALL JSON files
console.log('\n=== Applying fixes ===');
let totalFixed = 0;
let stageFixed = 0;

for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;

  for (const c of cards) {
    if (c.supertype !== 'Pokemon') continue;
    const baseName = c.name.replace(/ex$/, '').trim();
    const fix = speciesFixes.get(baseName);
    if (!fix) continue;

    // Fix evolvesFrom
    if (c.evolvesFrom) {
      const isWrong = c.evolvesFrom === c.name || (c.evolvesFrom === baseName && c.name !== baseName);
      if (isWrong && fix.correctEvo) {
        console.log(`  ${f} ${c.id} ${c.name}: evo ${c.evolvesFrom} → ${fix.correctEvo}`);
        c.evolvesFrom = fix.correctEvo;
        modified = true;
        totalFixed++;
      }
    }

    // Fix stage (for ALL cards of this species, not just problematic ones)
    if (fix.correctStage && c.stage !== fix.correctStage) {
      console.log(`  ${f} ${c.id} ${c.name}: stage ${c.stage} → ${fix.correctStage}`);
      c.stage = fix.correctStage;
      modified = true;
      stageFixed++;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
  }
}

console.log(`\nevolvesFrom fixed: ${totalFixed}, stage fixed: ${stageFixed}`);

// Final verification
console.log('\n=== Final verification ===');
let remaining = 0;
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;
    const baseName = c.name.replace(/ex$/, '').trim();
    if (c.evolvesFrom === c.name || (c.evolvesFrom === baseName && c.name !== baseName)) {
      console.log(`  STILL BAD: ${f} ${c.id} ${c.name}: evo=${c.evolvesFrom}`);
      remaining++;
    }
  }
}
console.log(remaining === 0 ? 'All clean!' : `${remaining} cards still have issues`);
