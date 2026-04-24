import fs from 'node:fs';
const files = fs.readdirSync('static/cards').filter(f => f.endsWith('.json') && f !== 'index.json');
const energyCards = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync('static/cards/' + f, 'utf8'));
  for (const c of d) {
    if (c.supertype === 'Energy') {
      energyCards.push({ name: c.name, subtype: c.subtype, pokemonType: c.pokemonType, set: f.replace('.json', ''), text: (c.text || '').substring(0, 120) });
    }
  }
}
const unique = new Map();
for (const e of energyCards) { if (!unique.has(e.name)) unique.set(e.name, e); }
for (const [n, e] of [...unique.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${e.subtype}\t${n}\ttype=${e.pokemonType || 'none'}\t${e.text}`);
}

// Also check: are there any Fairy-type Pokemon?
let fairyCount = 0;
for (const f of files) {
  const d = JSON.parse(fs.readFileSync('static/cards/' + f, 'utf8'));
  for (const c of d) {
    if (c.pokemonType === 'Fairy') fairyCount++;
  }
}
console.log('\nFairy-type Pokemon count:', fairyCount);
