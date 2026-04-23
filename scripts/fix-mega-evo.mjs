#!/usr/bin/env node
/**
 * fix-mega-evolves-from.mjs — 修正超級進化ex的evolvesFrom
 * 
 * 規則：超級進化ex和普通ex是同一階段的替代版本，不是互相進化的關係。
 * 例如：甲賀忍蛙ex 和 超級甲賀忍蛙ex 都從 呱頭蛙 進化。
 * 
 * 所以超級進化ex的evolvesFrom應該等於對應普通ex的evolvesFrom，
 * 而不是指向普通ex本身。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Load all Pokemon
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.supertype === 'Pokemon') allCards.push({ card: c, file: f });
  }
}

// Build lookup: name → evolvesFrom (for finding base ex cards' evolvesFrom)
const nameToEvo = new Map();
for (const { card: c } of allCards) {
  if (c.evolvesFrom && !nameToEvo.has(c.name)) {
    nameToEvo.set(c.name, c.evolvesFrom);
  }
}

// Find all Mega cards and fix their evolvesFrom
console.log('=== Fixing Mega evolution evolvesFrom ===\n');
const fixes = [];

for (const { card: c, file: f } of allCards) {
  if (!c.name.startsWith('超級')) continue;
  if (!c.evolvesFrom) continue;
  
  // If evolvesFrom points to an ex card, redirect to the ex card's evolvesFrom
  // Keep following the chain until we reach a non-ex, non-same-name card
  let currentEvo = c.evolvesFrom;
  let iterations = 0;
  
  while (iterations < 5) {
    // If currentEvo is an ex card or same species, follow its evolvesFrom
    const targetEvo = nameToEvo.get(currentEvo);
    if (!targetEvo) break; // Dead end - no further chain
    
    // Check if currentEvo is an ex card or GX card that should be skipped
    const isExVariant = currentEvo.endsWith('ex');
    const isGXVariant = currentEvo.endsWith('GX');
    const isSameSpecies = currentEvo.replace(/ex$/, '').replace(/GX$/, '').trim() === 
                          c.name.replace(/^超級/, '').replace(/ex$/, '').replace(/[XY]$/, '').trim();
    
    if (isExVariant || isGXVariant || isSameSpecies) {
      currentEvo = targetEvo;
      iterations++;
    } else {
      break; // We've reached a different species at a lower stage - this is correct
    }
  }
  
  if (currentEvo !== c.evolvesFrom) {
    fixes.push({ card: c, file: f, oldEvo: c.evolvesFrom, newEvo: currentEvo });
    console.log(`${c.name} (${c.setCode} ${c.id}): ${c.evolvesFrom} → ${currentEvo} (stage=${c.stage})`);
  }
}

console.log(`\nTotal fixes: ${fixes.length}`);

// Also fix Mega cards where evolvesFrom points to a non-ex same-species card
// (like 超級噴火駝ex → 噴火駝, 超級暴雪王ex → 暴雪王)
// These might already be correct if the base species is Stage1 evolving from Basic
// Let's verify: if evolvesFrom card is same stage as the Mega, it's wrong
console.log('\n=== Checking non-ex Mega evolvesFrom ===');
for (const { card: c } of allCards) {
  if (!c.name.startsWith('超級') || !c.evolvesFrom) continue;
  if (c.evolvesFrom.endsWith('ex')) continue; // Already handled above
  
  // Find the evolvesFrom card's stage
  const evoCard = allCards.find(e => e.card.name === c.evolvesFrom);
  if (evoCard && evoCard.card.stage === c.stage) {
    // Same stage! This means evolvesFrom is wrong (pointing to same-stage non-ex)
    // Should point to evoCard's own evolvesFrom
    const correctEvo = evoCard.card.evolvesFrom;
    if (correctEvo && correctEvo !== c.evolvesFrom) {
      console.log(`${c.name}: ${c.evolvesFrom} (${evoCard.card.stage}) → ${correctEvo}`);
      fixes.push({ card: c, file: '', oldEvo: c.evolvesFrom, newEvo: correctEvo });
    }
  }
}

// Apply all fixes
console.log('\n=== Applying fixes ===');
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;
  
  for (const c of cards) {
    if (!c.name?.startsWith('超級')) continue;
    const fix = fixes.find(fx => fx.card.id === c.id && fx.card.name === c.name);
    if (fix) {
      c.evolvesFrom = fix.newEvo;
      modified = true;
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
    console.log(`  Wrote ${f}`);
  }
}

// Final verification
console.log('\n=== Verification: all Mega cards ===');
// Reload
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (!c.name?.startsWith('超級') || c.supertype !== 'Pokemon') continue;
    if (!c.evolvesFrom) continue;
    // Check if evolvesFrom still points to an ex card
    if (c.evolvesFrom.endsWith('ex')) {
      console.log(`  STILL WRONG: ${c.setCode} ${c.id} ${c.name}: evo=${c.evolvesFrom}`);
    }
  }
}

// Show final state of unique Mega cards
console.log('\n=== Final state ===');
const seen = new Set();
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (!c.name?.startsWith('超級') || c.supertype !== 'Pokemon') continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    console.log(`${c.name.padEnd(16)} stage=${String(c.stage).padEnd(7)} evo=${c.evolvesFrom || '(none)'}`);
  }
}
