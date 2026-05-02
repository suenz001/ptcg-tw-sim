const fs = require('fs');
const en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

console.log('includes promptPlayAbilities:', en.includes('promptPlayAbilities'));
console.log('includes ON_PLAY_FROM_HAND:', en.includes('ON_PLAY_FROM_HAND_ABILITIES'));
console.log('includes afterEvolve:', en.includes('afterEvolve'));

// Check near the import
const importIdx = en.indexOf("from './effects'");
if (importIdx > -1) {
  console.log('\nimport block:');
  console.log(en.substring(importIdx - 300, importIdx + 30));
}
