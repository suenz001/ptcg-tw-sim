/**
 * fix-cards-v285.mjs
 * 
 * 1. Fix specific regulation marks (user-reported)
 * 2. Revert MC cards back to J (they were wrongly changed to G)
 * 3. Add G-mark for SVQL/SVQP/MJ promo cards
 * 4. Remove duplicate collector number cards in M2a and MC
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';

// ── Step 1: Fix regulation marks ──

// Cards that should be G (promo/starter deck reprints)
const SET_TO_G = [
  { file: 'SVQL.json', id: '13175' },   // 高級球 015/022
  { file: 'SVQP.json', id: '13151' },   // 高級球 015/023
  { file: 'SVQP.json', id: '13152' },   // 寶可夢交替 016/023
  { file: 'MJ.json',   id: '18378' },   // 寶可夢交替 019/022
];

// Cards that should be J (MC reprinted with J mark, NOT G)
const SET_TO_J = [
  '17114', '17115', '17136', '17182',   // MC first copies
  '18307', '18308', '18314', '18323',   // MC duplicate copies
];

// Apply mark fixes
for (const { file, id } of SET_TO_G) {
  const fp = path.join(DIR, file);
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const c of cards) {
    if (String(c.id) === id) {
      console.log(`G-fix: ${file} ${c.name} (${c.id}) ${c.collectorNumber} ${c.regulationMark} → G`);
      c.regulationMark = 'G';
    }
  }
  fs.writeFileSync(fp, JSON.stringify(cards, null, 2) + '\n');
}

// Revert MC cards back to J
{
  const fp = path.join(DIR, 'MC.json');
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const jSet = new Set(SET_TO_J);
  for (const c of cards) {
    if (jSet.has(String(c.id))) {
      console.log(`J-fix: MC.json ${c.name} (${c.id}) ${c.collectorNumber} ${c.regulationMark} → J`);
      c.regulationMark = 'J';
    }
  }
  fs.writeFileSync(fp, JSON.stringify(cards, null, 2) + '\n');
}

// ── Step 2: Remove duplicates in M2a and MC ──

function dedup(file) {
  const fp = path.join(DIR, file);
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const before = cards.length;
  
  // Keep first occurrence of each collector number
  const seen = new Set();
  const unique = [];
  for (const c of cards) {
    const key = c.collectorNumber;
    if (seen.has(key)) {
      // Skip duplicate
      continue;
    }
    seen.add(key);
    unique.push(c);
  }
  
  const removed = before - unique.length;
  console.log(`\nDedup ${file}: ${before} → ${unique.length} (removed ${removed} duplicates)`);
  
  fs.writeFileSync(fp, JSON.stringify(unique, null, 2) + '\n');
  return removed;
}

dedup('M2a.json');
dedup('MC.json');

// ── Step 3: Update index.json card counts ──
const indexPath = path.join(DIR, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
for (const s of index) {
  const fp = path.join(DIR, `${s.code}.json`);
  if (fs.existsSync(fp)) {
    const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (s.count !== cards.length) {
      console.log(`Index update: ${s.code} count ${s.count} → ${cards.length}`);
      s.count = cards.length;
    }
  }
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');

// Final stats
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
const marks = {};
let total = 0;
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  total += cards.length;
  for (const c of cards) {
    const m = c.regulationMark || 'none';
    marks[m] = (marks[m] || 0) + 1;
  }
}
console.log(`\nTotal cards: ${total}`);
console.log('Regulation mark distribution:', marks);
