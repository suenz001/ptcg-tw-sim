const fs = require('fs');
const en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

// Find the exact bytes around getUsableAbilities
const idx = en.indexOf('只有註冊在 ABILITY_EFFECTS 才需要特殊處理');
console.log('found at:', idx);
if (idx > -1) {
  console.log('context:', JSON.stringify(en.substring(idx - 80, idx + 120)));
}
