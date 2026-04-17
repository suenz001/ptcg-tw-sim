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

// Official zh-TW expansion names from asia.pokemon-card.com/tw/.
// Verified 2026-04-17 via archive pages + card detail pages.
// Only standard-legal sets (H / I / J marks).
const SET_NAMES = {
  // H mark
  SV5K: '狂野之力',
  SV5M: '異度審判',
  SV5a: '緋紅薄霧',
  SV6:  '變幻假面',
  SV6a: '黑夜漫遊者',
  SV7:  '星晶奇跡',
  SV7a: '樂園騰龍',
  SV8:  '超電突圍',
  SV8a: '太晶慶典ex',
  MJ:   '新人冒險旅程',
  // I mark
  SV9:   '對戰搭檔',
  SV9a:  '熱風競技場',
  SV10:  '火箭隊的榮耀',
  SV11B: '漆黑伏特',
  SV11W: '純白閃焰',
  M1S:   '超級交響樂',
  M1L:   '超級勇氣',
  M2:    '烈獄狂火X',
  M2a:   '超級進化夢想ex',
  MBD:   '超級蒂安希ex',
  MBG:   '超級耿鬼ex',
  // J mark
  MC: '超級進化初階牌組100',
  M3: '虛無歸零',
  M4: '忍者飛旋',
};

// Official pack art images from asia.pokemon-card.com/tw/archive/special/card/
// Verified via HTTP HEAD (all return 200). Fallback to first-card image if absent.
const BASE = 'https://asia.pokemon-card.com/tw/archive/special/card';
const SET_COVER_URLS = {
  // H mark
  SV6:  `${BASE}/sv6/assets/images/hero-visual.jpg`,
  SV7:  `${BASE}/sv7/assets/images/hero-visual.jpg`,
  SV8:  `${BASE}/sv8/assets/images/hero-visual.jpg`,
  SV8a: `${BASE}/sv8a/assets/images/hero-pack.png`,
  // I mark
  SV9:  `${BASE}/sv9/assets/images/hero-visual.jpg`,
  SV10: `${BASE}/sv10/assets/images/hero-visual.jpg`,
  M1S:  `${BASE}/m1/assets/images/hero-visual.jpg`,
  M1L:  `${BASE}/m1/assets/images/hero-visual.jpg`,
  M2:   `${BASE}/m2/assets/images/hero-visual.png`,
  M2a:  `${BASE}/m2a/assets/images/hero-pkg.png`,
  // J mark
  MC:   `${BASE}/mc/assets/images/home/image_package.png`,
  M3:   `${BASE}/m3/assets/images/hero-visual.png`,
  M4:   `${BASE}/m4/assets/images/hero-img-01-y25ri.png`,
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
    // Use the official pack art if we have it; fall back to first card's image.
    const coverUrl = SET_COVER_URLS[code] ?? cards[0]?.imageUrl ?? '';
    return {
      code,
      name: SET_NAMES[code] ?? code,
      regulationMark: SET_REGULATION_MARK[code] ?? null,
      cardCount: cards.length,
      supertypeCounts,
      coverImageUrl: coverUrl,
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
