/**
 * One-time script: backfill regulationMark into every card JSON
 * based on the setCode → mark mapping table.
 *
 * Run: node scripts/backfill-marks.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_REGULATION_MARK } from './regulation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.join(__dirname, '..', 'static', 'cards');

const files = fs.readdirSync(CARDS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'index.json');

let totalCards = 0;
let updated = 0;

for (const file of files) {
  const code = file.replace(/\.json$/, '');
  const mark = SET_REGULATION_MARK[code];
  if (!mark) {
    console.error(`⚠ Unknown set code: ${code} — skipping`);
    continue;
  }

  const filePath = path.join(CARDS_DIR, file);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = false;

  for (const card of cards) {
    totalCards++;
    if (card.regulationMark !== mark) {
      card.regulationMark = mark;
      changed = true;
      updated++;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(cards, null, 2));
    console.error(`  ✓ ${code.padEnd(7)} ${String(cards.length).padStart(4)} cards → ${mark}`);
  } else {
    console.error(`  - ${code.padEnd(7)} ${String(cards.length).padStart(4)} cards (already ${mark})`);
  }
}

console.error(`\nDone. ${updated}/${totalCards} cards updated.`);
