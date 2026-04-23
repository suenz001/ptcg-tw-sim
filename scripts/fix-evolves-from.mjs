#!/usr/bin/env node
/**
 * fix-evolves-from.mjs — 修正所有 evolvesFrom 指向同名卡的錯誤
 *
 * 問題：
 * 1. ex 卡的 evolvesFrom 指向同名非 ex 版本（如 耿鬼ex → 耿鬼）
 *    正確應是 耿鬼ex → 鬼斯通（跟非 ex 的耿鬼一樣）
 * 2. 非 ex 卡的 evolvesFrom 指向自己（GX strip 後產生的 self-reference）
 *
 * 修正邏輯：找到同名非 ex 版本的 evolvesFrom，用它取代。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Load all cards
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) allCards.push({ card: c, file: f });
}

// Build "clean" evolvesFrom lookup: name → evolvesFrom
// Only from cards that DON'T self-reference and DON'T point to same-name
const cleanEvo = new Map();
for (const { card: c } of allCards) {
  if (c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;
  const baseName = c.name.replace(/ex$/, '').trim();
  // Skip self-referencing or same-name-ex references
  if (c.evolvesFrom === c.name) continue;
  if (c.evolvesFrom === baseName && c.name !== baseName) continue;
  // This card has a correct evolvesFrom
  if (!cleanEvo.has(c.name)) cleanEvo.set(c.name, c.evolvesFrom);
}

console.log(`Clean evolvesFrom lookup: ${cleanEvo.size} entries`);

// Find and fix problematic cards
const fixes = [];
for (const { card: c, file: f } of allCards) {
  if (c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;
  const baseName = c.name.replace(/ex$/, '').trim();

  // Case 1: self-referencing (e.g., 貓鼬探長 → 貓鼬探長)
  // Case 2: ex pointing to same-name non-ex (e.g., 耿鬼ex → 耿鬼)
  const isSelfRef = c.evolvesFrom === c.name;
  const isSameNameEx = c.evolvesFrom === baseName && c.name !== baseName;

  if (!isSelfRef && !isSameNameEx) continue;

  // Look up the correct evolvesFrom from clean lookup
  // For ex cards: look up baseName (e.g., 耿鬼ex → look up 耿鬼)
  // For self-ref: look up the card's own name from a different card
  const lookupName = isSameNameEx ? baseName : c.name;
  const correctEvo = cleanEvo.get(lookupName);

  if (correctEvo) {
    fixes.push({
      file: f, id: c.id, name: c.name, setCode: c.setCode,
      oldEvo: c.evolvesFrom, newEvo: correctEvo,
      stage: c.stage
    });
    c.evolvesFrom = correctEvo;
  } else {
    console.log(`WARN: ${c.setCode} ${c.id} ${c.name}: evolvesFrom=${c.evolvesFrom} — no clean lookup found`);
  }
}

console.log(`\nFixed ${fixes.length} cards:`);
fixes.forEach(f => console.log(`  ${f.setCode} ${f.id} ${f.name}: ${f.oldEvo} → ${f.newEvo} (stage=${f.stage})`));

// Write back
let filesModified = 0;
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const fixesInFile = fixes.filter(x => x.file === f);
  if (fixesInFile.length === 0) continue;

  for (const fix of fixesInFile) {
    const card = cards.find(c => c.id === fix.id);
    if (card) card.evolvesFrom = fix.newEvo;
  }

  fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
  filesModified++;
}

console.log(`\nFiles modified: ${filesModified}`);

// Verification: check for remaining self-references or same-name issues
console.log('\n=== Post-fix verification ===');
let remaining = 0;
for (const { card: c } of allCards) {
  if (c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;
  const baseName = c.name.replace(/ex$/, '').trim();
  if (c.evolvesFrom === c.name || (c.evolvesFrom === baseName && c.name !== baseName)) {
    console.log(`  STILL BAD: ${c.setCode} ${c.id} ${c.name}: evolvesFrom=${c.evolvesFrom}`);
    remaining++;
  }
}
console.log(remaining === 0 ? 'All clean!' : `${remaining} cards still have issues`);
