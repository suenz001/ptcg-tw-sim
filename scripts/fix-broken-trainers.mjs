import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// Map of card name -> { supertype, subtype } for properly classified Trainer cards
const correctMap = new Map();

// First pass: build the map of correct classifications
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.supertype === 'Trainer') {
      correctMap.set(c.name, { supertype: c.supertype, subtype: c.subtype });
    }
  }
}

let fixes = 0;

// Second pass: fix misclassified cards
for (const f of files) {
  const fp = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = false;
  
  for (const c of cards) {
    // If it's a Pokemon/Other (which is our fallback when H3 is broken)
    if (c.supertype === 'Pokemon' && c.subtype === 'Other') {
      // Look up its correct classification by name
      if (correctMap.has(c.name)) {
        const correct = correctMap.get(c.name);
        // Only fix if it's supposed to be something else (e.g. Item or Supporter)
        // Wait, if it's supposed to be PokemonTool, we just change it to Trainer/PokemonTool
        console.log(`Fixing ${c.name} (${c.id}) in ${f}: ${c.supertype}/${c.subtype} -> ${correct.supertype}/${correct.subtype}`);
        
        c.supertype = correct.supertype;
        c.subtype = correct.subtype;
        delete c.hp;
        delete c.pokemonType;
        delete c.stage;
        delete c.weakness;
        delete c.resistance;
        delete c.retreatCost;
        
        changed = true;
        fixes++;
      }
    }
  }
  
  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(cards, null, 2) + '\n', 'utf8');
  }
}

console.log(`Done. Fixed ${fixes} broken Trainer cards using name matching.`);
