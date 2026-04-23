/**
 * apply-gmark-surgical.mjs
 * 
 * ONLY fix the specific cards that are VISUALLY CONFIRMED as G-mark.
 * We do NOT use card name matching. We use specific card IDs.
 * 
 * User confirmed G-mark cards:
 * - 寶可夢捕捉器 SVQP 017/023 (ID 13153)
 * - 粉碎之錘 SVQL 013/022 (ID 13173) 
 * - 裁判 SV9a 083/063 (ID 12741)
 * - 傷藥 MJ 017/022 (ID 18376)
 * 
 * For other promo/starter deck cards, they share the same promo printing
 * context, so cards from the same promo set batch are also likely G-mark
 * IF they are classic trainer cards that existed in the G-mark era.
 * 
 * But we will be CONSERVATIVE and only fix confirmed ones + the same 
 * card IDs in MC.json (which is a master collection of all cards).
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';

// Confirmed G-mark card IDs (visually verified from card images)
const CONFIRMED_G_IDS = new Set([
  // User-reported cards
  '13153', // 寶可夢捕捉器 SVQP 017/023
  '13173', // 粉碎之錘 SVQL 013/022
  '13177', // 寶可夢捕捉器 SVQL 017/022 (same set as 粉碎之錘)
  '12741', // 裁判 SV9a 083/063
  '12720', // 裁判 SV9a 062/063 (same set, same card different number)
  '12717', // 寶可夢捕捉器 SV9a 059/063 (same set)
  '18376', // 傷藥 MJ 017/022

  // MC.json duplicates of the same cards (MC is a master collection)
  '17114', // 傷藥 MC 643/742
  '17115', // 粉碎之錘 MC 644/742
  '17136', // 寶可夢捕捉器 MC 665/742
  '17182', // 裁判 MC 711/742
  '18307', // 傷藥 MC 643/742 (duplicate)
  '18308', // 粉碎之錘 MC 644/742 (duplicate)
  '18314', // 寶可夢捕捉器 MC 665/742 (duplicate)
  '18323', // 裁判 MC 711/742 (duplicate)
]);

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
let totalFixed = 0;

for (const f of files) {
  const fp = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = false;

  for (const c of cards) {
    if (CONFIRMED_G_IDS.has(String(c.id)) && c.regulationMark !== 'G') {
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
console.log('Final regulation mark distribution:', marks);
