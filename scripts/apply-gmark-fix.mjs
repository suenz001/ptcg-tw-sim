/**
 * apply-gmark-fix.mjs
 * 
 * Fix regulation marks for G-mark cards that were wrongly tagged as H/I/J.
 * 
 * Strategy:
 * 1. Build a set of ALL G-mark card names from existing DB + known G trainers
 * 2. For each card with one of these names, set regulationMark = 'G'
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Step 1: Collect all G-mark names from existing DB
const gMarkNames = new Set();
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.regulationMark === 'G') gMarkNames.add(c.name);
  }
}

// Step 2: Add known G-mark trainer/energy cards that have NO G-mark copy in DB
// These are cards originally printed in SV1~SV3 era (or sv-P promos) with G regulation
const KNOWN_G_CARDS = [
  '寶可夢捕捉器', '粉碎之錘', '裁判', '傷藥',
  '博士的研究',    // Dr. Research (Arven version is G)
  '奇樹',          // Kiki (from sv1)
  '厲害釣竿',      // Super Rod (from sv2)
  '派帕',          // Pepper (from sv1)
  '夜光能量',      // Luminous Energy (from sv1)
  '寶可夢中心的小姐', // Nurse Joy (G era)
  '打工仔',        // Worker (G era)
  '超級球',        // Ultra Ball (from sv1) - already in gMarkNames
  '反擊捕捉器',    // Counter Catcher
  '大地之容器',    // Earth Vessel
  '超級能量回收', // Super Energy Retrieval
  '能量貼紙',      // Energy Sticker
  '豪華斗篷',      // Luxury Cape
  '高科技雷達',    // Hi-Tech Radar  
  '噴射能量',      // Jet Energy
  '勇氣護符',      // Brave Charm
];

for (const name of KNOWN_G_CARDS) {
  gMarkNames.add(name);
}

console.log(`Total G-mark names: ${gMarkNames.size}`);
console.log([...gMarkNames].sort().join('\n'));

// Step 3: Fix all cards
let totalFixed = 0;
for (const f of files) {
  const fp = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = false;

  for (const c of cards) {
    if (gMarkNames.has(c.name) && c.regulationMark !== 'G') {
      console.log(`FIX ${f}: ${c.name} (${c.id}) ${c.collectorNumber} ${c.regulationMark} → G`);
      c.regulationMark = 'G';
      changed = true;
      totalFixed++;
    }
  }

  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(cards, null, 2) + '\n', 'utf8');
  }
}

console.log(`\nFixed ${totalFixed} cards to G mark.`);

// Verify final distribution
const marks = {};
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    const m = c.regulationMark || 'none';
    marks[m] = (marks[m] || 0) + 1;
  }
}
console.log('\nFinal regulation mark distribution:', marks);
