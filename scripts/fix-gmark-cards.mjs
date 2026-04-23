/**
 * fix-gmark-cards.mjs
 * 
 * The official website's .alpha class always returns "J" which is WRONG.
 * The official "Standard" regulation search includes G-mark reprints too.
 * 
 * So we need a manual mapping approach. We know:
 * - G-mark cards are cards originally from the SV base era (sv1-sv3, promo sv-p)
 * - Common G-mark trainer reprints in mixed sets: 寶可夢捕捉器, 粉碎之錘, 
 *   裁判, 傷藥, 博士的研究, 奇樹, 厲害釣竿, 派帕, etc.
 * 
 * Strategy: Build a "G-mark card name" list by:
 * 1. Identify all cards currently marked G in our DB
 * 2. Any other card with the SAME name should also be G
 * 3. Cross-reference with known G-mark trainer cards from the SV era
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Step 1: Collect all unique card names that have G mark
const gMarkNames = new Set();
const allCards = [];

for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    allCards.push({ ...c, file: f });
    if (c.regulationMark === 'G') {
      gMarkNames.add(c.name);
    }
  }
}

console.log('=== Known G-mark card names ===');
console.log([...gMarkNames].sort().join('\n'));
console.log(`\nTotal unique G-mark names: ${gMarkNames.size}`);

// Step 2: Find all cards with these names that are NOT marked G
console.log('\n=== Cards with G-mark names but wrong mark ===');
const wrongMark = [];
for (const c of allCards) {
  if (gMarkNames.has(c.name) && c.regulationMark !== 'G') {
    wrongMark.push(c);
    console.log(`${c.file} ${c.id} ${c.name} ${c.collectorNumber} mark=${c.regulationMark} → should be G`);
  }
}
console.log(`\nTotal cards to fix: ${wrongMark.length}`);

// Step 3: Also add known G-mark trainer cards that might not have any G-mark copy
// These are well-known SV-era G-mark trainers
const KNOWN_G_TRAINERS = [
  '寶可夢捕捉器', '粉碎之錘', '裁判', '傷藥', '博士的研究',
  '奇樹', '厲害釣竿', '派帕', '夜光能量',
  '寶可夢中心的小姐', '打工仔'
];

console.log('\n=== Checking known G-trainers not yet in G-mark list ===');
for (const name of KNOWN_G_TRAINERS) {
  if (!gMarkNames.has(name)) {
    // Check if we have this card at all
    const found = allCards.filter(c => c.name === name);
    if (found.length > 0) {
      console.log(`"${name}" exists but NOT marked G. Current marks: ${found.map(c => c.regulationMark).join(', ')}`);
    }
  }
}
