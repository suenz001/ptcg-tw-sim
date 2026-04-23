/**
 * audit-regmark-full.mjs
 * 
 * Since the official website's .alpha class is UNRELIABLE (it returns "J" for
 * everything), we need a different approach to determine the correct regulation mark.
 * 
 * Strategy: Use the card IMAGE to determine the regulation mark.
 * The mark is printed at the bottom-left of every card image.
 * We can download the card image and check the bottom-left pixel area.
 * 
 * BUT a much simpler approach: use the KNOWN regulation mark from the card's
 * original set. Cards that are reprints in promo/special sets should keep their
 * original regulation mark. We can look up the card name in our existing database
 * and find the "earliest" appearance with a correct mark.
 * 
 * Actually, the most reliable approach for promo/mixed sets is to check
 * the card image directly. Let me use a visual approach.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Known G-mark cards that are reprinted in H/I/J sets.
// These cards originally come from the SV (Scarlet & Violet) era with G regulation.
// In Japanese, G regulation = "G レギュレーション" = released before sv4/sv5 era.
// Key identifier: these are cards with names that match classic Trainer cards
// that were originally printed with G mark but got reprinted in newer sets.

// Let's first scan what sets have mixed marks
const setMarkStats = {};
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const marks = {};
  for (const c of cards) {
    const m = c.regulationMark || 'none';
    marks[m] = (marks[m] || 0) + 1;
  }
  setMarkStats[f] = marks;
}

console.log('=== Set Regulation Mark Distribution ===');
for (const [set, marks] of Object.entries(setMarkStats)) {
  const markStr = Object.entries(marks).map(([m, c]) => `${m}:${c}`).join(', ');
  console.log(`${set}: ${markStr}`);
}

// Known promo/mixed sets that likely have G-mark reprints
const MIXED_SETS = ['SVQP.json', 'SVQL.json', 'SV9a.json', 'MJ.json', 'MC.json', 
                    'SV5a.json', 'SVOD.json', 'SVOM.json', 'MBD.json', 'MBG.json', 'M-P.json'];

console.log('\n=== Cards in mixed/promo sets ===');
for (const f of MIXED_SETS) {
  const fp = path.join(DIR, f);
  if (!fs.existsSync(fp)) continue;
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  console.log(`\n--- ${f} (${cards.length} cards) ---`);
  for (const c of cards) {
    console.log(`  ${c.collectorNumber} ${c.name} mark=${c.regulationMark}`);
  }
}
