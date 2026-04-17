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
  MJ:   'New Trainer Journey',
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

// Cover art for every set. Verified 2026-04-17.
//   - Archive hero images: HEAD 200 confirmed
//   - Card images: official pokemon-card.com/tw card art
//     (001 card of set, or the set's featured EX Pokémon)
const ARCHIVE = 'https://asia.pokemon-card.com/tw/archive/special/card';
const CARD_IMG = 'https://asia.pokemon-card.com/tw/card-img';
const SET_COVER_URLS = {
  // ── H mark ──────────────────────────────────────────────────────────
  // SV5K + SV5M share the sv5 archive page (「狂野之力」「異度審判」dual release)
  SV5K: `${ARCHIVE}/sv5/assets/images/hero-visual.jpg`,
  SV5M: `${ARCHIVE}/sv5/assets/images/hero-visual.jpg`,
  // SV5a, SV6a, SV7a have no archive page → use 001 card (cover Pokémon)
  SV5a: `${CARD_IMG}/tw00010248.png`,   // 001 蔓藤怪
  SV6:  `${ARCHIVE}/sv6/assets/images/hero-visual.jpg`,
  SV6a: `${CARD_IMG}/tw00010583.png`,   // 001 電電蟲
  SV7:  `${ARCHIVE}/sv7/assets/images/hero-visual.jpg`,
  SV7a: `${CARD_IMG}/tw00011031.png`,   // 001 蛋蛋
  SV8:  `${ARCHIVE}/sv8/assets/images/hero-visual.jpg`,
  SV8a: `${ARCHIVE}/sv8a/assets/images/hero-pack.png`,
  MJ:   `${CARD_IMG}/tw00018360.png`,   // 001 凱羅斯 (New Trainer Journey)
  // ── I mark ──────────────────────────────────────────────────────────
  SV9:   `${ARCHIVE}/sv9/assets/images/hero-visual.jpg`,
  SV9a:  `${CARD_IMG}/tw00012659.png`,  // 001 <阿響的>凱羅斯
  SV10:  `${ARCHIVE}/sv10/assets/images/hero-visual.jpg`,
  // SV11B + SV11W share the sv11 archive page (「漆黑伏特」「純白閃焰」dual release)
  SV11B: `${ARCHIVE}/sv11/assets/images/hero-visual.png`,
  SV11W: `${ARCHIVE}/sv11/assets/images/hero-visual.png`,
  M1S:   `${ARCHIVE}/m1/assets/images/hero-visual.jpg`,
  M1L:   `${ARCHIVE}/m1/assets/images/hero-visual.jpg`,
  M2:    `${ARCHIVE}/m2/assets/images/hero-visual.png`,
  M2a:   `${ARCHIVE}/m2a/assets/images/hero-pkg.png`,
  MBD:   `${CARD_IMG}/tw00014110.png`,  // 超級蒂安希ex (user-requested fallback)
  MBG:   `${CARD_IMG}/tw00014131.png`,  // 超級耿鬼ex (user-requested fallback)
  // ── J mark ──────────────────────────────────────────────────────────
  MC:    `${ARCHIVE}/mc/assets/images/home/image_package.png`,
  M3:    `${ARCHIVE}/m3/assets/images/hero-visual.png`,
  M4:    `${ARCHIVE}/m4/assets/images/hero-img-01-y25ri.png`,
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
