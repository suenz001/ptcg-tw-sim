/**
 * Build static/cards/index.json — a small summary of every scraped set.
 *
 * This lets the frontend show a set picker without having to load every
 * per-set JSON upfront.
 *
 * Run: node scripts/build-sets-index.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_REGULATION_MARK } from './regulation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CARDS_DIR = path.join(REPO_ROOT, 'static', 'cards');

// Human-readable zh-TW expansion names. Covers the sets we explicitly scrape;
// anything else falls back to just the code.
// Kept here (not in the scraper) because it's display metadata, not card data.
// Only standard-legal sets (H / I / J marks). G-mark sets removed.
const SET_NAMES = {
  SV5M: '水君',
  SV5K: '雷公',
  SV5a: '賽場激鬥',
  SV6: '變幻的假面',
  SV6a: '夜晚的鐵拳',
  SV7: '樂園的龍咆哮',
  SV7a: '百合根',
  SV8: '超電磁閃光',
  SV8a: '熱風的競技場',
  SV9: '戰鬥伙伴',
  SV9a: '黑暗的王者',
  SV10: '火箭隊的榮耀',
  SV11W: '白熱的仕女',
  SV11B: '黑炎的指導者',
  M1S: 'Mega 進化',
  M1L: 'Mega 旋律',
  M2: 'Mega 之星',
  M2a: 'Mega 彩焰',
  M3: 'Mega 天際',
  M4: 'Mega 火力',
  MBD: 'Mega 增強包 D',
  MBG: 'Mega 增強包 G',
  MC: 'Mega Classic',
  MJ: 'Mega Jumbo'
};

function countBy(cards, key) {
  const out = {};
  for (const c of cards) out[c[key]] = (out[c[key]] || 0) + 1;
  return out;
}

function main() {
  if (!fs.existsSync(CARDS_DIR)) {
    console.error('No static/cards/ directory found. Run a scrape first.');
    process.exit(1);
  }
  const files = fs
    .readdirSync(CARDS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json');

  const sets = files.map((file) => {
    const code = file.replace(/\.json$/, '');
    const cards = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, file), 'utf8'));
    const supertypeCounts = countBy(cards, 'supertype');
    // Use the first card's image as the set's cover art
    const coverCard = cards[0];
    return {
      code,
      name: SET_NAMES[code] ?? code,
      regulationMark: SET_REGULATION_MARK[code] ?? null,
      cardCount: cards.length,
      supertypeCounts,
      coverImageUrl: coverCard?.imageUrl ?? '',
      scrapedAt: cards[0]?.scrapedAt ?? null
    };
  });

  // Sort SV sets numerically, then M sets, then everything else
  sets.sort((a, b) => {
    const rank = (c) => {
      if (c.startsWith('SV')) return 0;
      if (c.startsWith('M')) return 1;
      return 2;
    };
    const ra = rank(a.code);
    const rb = rank(b.code);
    if (ra !== rb) return ra - rb;
    return a.code.localeCompare(b.code, 'en', { numeric: true });
  });

  const indexPath = path.join(CARDS_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(sets, null, 2));
  console.error(`Wrote ${sets.length} sets to ${indexPath}`);
  for (const s of sets) {
    console.error(`  ${s.code.padEnd(7)} ${String(s.cardCount).padStart(4)}  ${s.name}`);
  }
}

main();
