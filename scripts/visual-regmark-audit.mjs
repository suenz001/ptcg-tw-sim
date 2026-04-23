/**
 * visual-regmark-audit.mjs
 * 
 * For cards in mixed/promo sets, we download the card image and visually
 * check which regulation mark is on it. Since we can't do OCR easily,
 * we'll use a different approach: check ONLY the user-reported cards
 * and cards in known promo/starter sets that have suspiciously wrong marks.
 * 
 * We focus on cards currently marked as J (from .alpha fallback) that
 * are in sets known to contain G/H cards.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Sets that are PURE - all cards have the same mark (verified by set era)
// These should NOT be touched.
const PURE_SETS = {
  // H-mark pure sets (SV era 2, released 2024 H1-H2)
  'SV5K.json': 'H', 'SV5M.json': 'H', 'SV5a.json': 'H',
  'SV6.json': 'H', 'SV6a.json': 'H',
  'SV7.json': 'H', 'SV7a.json': 'H',
  'SV8.json': 'H', 'SV8a.json': 'H',
  // I-mark pure sets (SV era 3, released 2024-2025)
  'SV9.json': 'I', 'SV9a.json': 'I',
  'SV10.json': 'I',
  'SV11B.json': 'I', 'SV11W.json': 'I',
  'SV12.json': 'I', 'SV12a.json': 'I',
  // J-mark pure sets (SV era 4, released 2025+)
  'M1L.json': 'J', 'M1S.json': 'J',
  'M2.json': 'J', 'M2a.json': 'J',
  'M3.json': 'J', 'M4.json': 'J',
};

// Mixed sets where cards can have different marks
const MIXED_SETS = [
  'SVQP.json', 'SVQL.json', 'MJ.json', 'MC.json', 'M-P.json',
  'SVOD.json', 'SVOM.json', 'MBD.json', 'MBG.json',
];

// For mixed sets, list all cards currently marked J that might be wrong
console.log('=== Cards in MIXED sets currently marked J ===');
for (const f of MIXED_SETS) {
  const fp = path.join(DIR, f);
  if (!fs.existsSync(fp)) continue;
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const jCards = cards.filter(c => c.regulationMark === 'J');
  if (jCards.length === 0) continue;
  console.log(`\n--- ${f} ---`);
  for (const c of jCards) {
    console.log(`  ${c.id} ${c.collectorNumber} ${c.name} mark=J  img=${c.imageUrl}`);
  }
}

// Also check: are there any J-mark cards in PURE H or I sets?
console.log('\n\n=== J-mark cards in PURE H/I sets (should not exist) ===');
for (const [setFile, expectedMark] of Object.entries(PURE_SETS)) {
  const fp = path.join(DIR, setFile);
  if (!fs.existsSync(fp)) continue;
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const c of cards) {
    if (c.regulationMark && c.regulationMark !== expectedMark) {
      console.log(`  ${setFile}: ${c.id} ${c.collectorNumber} ${c.name} mark=${c.regulationMark} (expected ${expectedMark})`);
    }
  }
}
