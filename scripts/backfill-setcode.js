/**
 * Backfill the `setCode` field for cards where the scraper couldn't extract it
 * from the card detail page (the mark image URL didn't match the regex for
 * M-series and some SV sets).
 *
 * Strategy: the source of truth is the filename — static/cards/{CODE}.json.
 * If a card has an empty setCode, set it to the filename's code.
 *
 * Also ensures `regulationMark` is consistent with the set code (re-applies
 * the lookup table so any card that was missed by an earlier backfill is fixed).
 *
 * Run: node scripts/backfill-setcode.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_REGULATION_MARK } from './regulation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CARDS_DIR = path.join(REPO_ROOT, 'static', 'cards');

function main() {
  const files = fs
    .readdirSync(CARDS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json');

  let totalFixed = 0;

  for (const file of files) {
    const code = file.replace(/\.json$/, '');
    const filePath = path.join(CARDS_DIR, file);
    const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let changed = 0;
    for (const card of cards) {
      if (!card.setCode) {
        card.setCode = code;
        changed++;
      }
      // Re-apply regulation mark (in case any card was missed)
      const mark = SET_REGULATION_MARK[card.setCode ?? code];
      if (mark && card.regulationMark !== mark) {
        card.regulationMark = mark;
        changed++;
      }
    }

    if (changed > 0) {
      fs.writeFileSync(filePath, JSON.stringify(cards, null, 2));
      console.error(`${code}: fixed ${changed} field(s)`);
      totalFixed += changed;
    } else {
      console.error(`${code}: OK`);
    }
  }

  console.error(`\nDone. Total fields fixed: ${totalFixed}`);
}

main();
