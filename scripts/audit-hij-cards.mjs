import fs from 'node:fs';
import path from 'node:path';

const cardsDir = 'static/cards';
const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.json'));

const allCards = [];
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(cardsDir, f), 'utf8'));
  for (const c of data) allCards.push(c);
}

// dedupe by name (keep first occurrence — multiple sets can have same card)
const byName = new Map();
for (const c of allCards) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}

// Collect H/I/J trainers + special energies
const targets = [];
for (const [name, copies] of byName.entries()) {
  // a card is H/I/J if any copy has that mark (or set-default)
  const marks = new Set(copies.map(c => c.regulationMark).filter(Boolean));
  const inHIJ = ['H','I','J'].some(m => marks.has(m));
  if (!inHIJ) continue;
  const sample = copies[0];
  const isTrainer = sample.supertype === 'Trainer';
  const isSpecialEnergy = sample.supertype === 'Energy' && sample.subtype !== 'Basic';
  if (!isTrainer && !isSpecialEnergy) continue;
  targets.push({
    name,
    supertype: sample.supertype,
    subtype: sample.subtype,
    marks: [...marks].sort().join('/'),
    rulesText: sample.rulesText || '',
    sets: copies.map(c => c.setCode).join(','),
  });
}

targets.sort((a, b) => {
  const ord = { Trainer: 0, Energy: 1 };
  if (ord[a.supertype] !== ord[b.supertype]) return ord[a.supertype] - ord[b.supertype];
  const subOrd = { Supporter:0, Item:1, PokemonTool:2, Stadium:3 };
  const sa = subOrd[a.subtype] ?? 99, sb = subOrd[b.subtype] ?? 99;
  if (sa !== sb) return sa - sb;
  return a.name.localeCompare(b.name);
});

console.log(`Total H/I/J trainers + special energies: ${targets.length}`);
const counts = {};
for (const t of targets) {
  const k = `${t.supertype}/${t.subtype}`;
  counts[k] = (counts[k] || 0) + 1;
}
console.log(JSON.stringify(counts, null, 2));

fs.writeFileSync('/tmp/hij_targets.json', JSON.stringify(targets, null, 2));
