#!/usr/bin/env node
/**
 * fix-mega-stages.mjs — Fix the 'stage' property of Mega Pokemon based on what they evolve from.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon') allCards.push(c);
}

// Map of Pokemon names to their stage
const nameToStage = new Map();
allCards.forEach(c => {
  if (c.stage && !nameToStage.has(c.name)) nameToStage.set(c.name, c.stage);
});

console.log('=== Fixing Mega Stages ===');
let fixed = 0;

for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let mod = false;
  
  for (const c of cards) {
    if (!c.name?.startsWith('超級')) continue;
    
    // Some Megas don't evolve from anything (Restored / specific mechanics, or just Basic Megas in old sets)
    // Actually, all Megas we just fixed should have evolvesFrom unless they are Basic
    if (!c.evolvesFrom) continue;
    
    const preStage = nameToStage.get(c.evolvesFrom);
    if (!preStage) {
      console.log(`WARNING: Cannot find stage for ${c.evolvesFrom} (predecessor of ${c.name})`);
      continue;
    }
    
    let correctStage;
    if (preStage === 'Basic') correctStage = 'Stage1';
    else if (preStage === 'Stage1') correctStage = 'Stage2';
    else {
      console.log(`WARNING: Predecessor ${c.evolvesFrom} has stage ${preStage}, what should ${c.name} be?`);
      correctStage = 'Stage2'; // Fallback
    }
    
    if (c.stage !== correctStage) {
      console.log(`${f} ${c.id} ${c.name}: stage ${c.stage} -> ${correctStage} (evolves from ${c.evolvesFrom} which is ${preStage})`);
      c.stage = correctStage;
      mod = true;
      fixed++;
    }
  }
  
  if (mod) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}

console.log(`\nFixed ${fixed} Mega card stages.`);
