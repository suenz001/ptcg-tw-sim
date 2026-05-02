const fs = require('fs');
const en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

console.log('has flipCoinsWithLog:', en.includes('flipCoinsWithLog'));
console.log('has CRLF:', en.includes('\r\n'));
console.log('has LF only:', en.includes('\n') && !en.includes('\r\n'));

const idx = en.indexOf("from './effects'");
console.log('import at char:', idx);
if (idx > -1) {
  console.log('context:', JSON.stringify(en.substring(idx - 200, idx + 30)));
}

// Check the exact import block
const importMatch = en.match(/flipCoinsWithLog[\s\S]{0,50}from '\.\/effects'/);
console.log('\nimport match:', importMatch ? importMatch[0] : 'NOT FOUND');

// Check PLAY_BASIC return
const playBasicMatch = en.match(/applyBenchPlaceSideEffects[\s\S]{0,100}return afterPlace/);
console.log('\nPLAY_BASIC match:', playBasicMatch ? playBasicMatch[0].substring(0, 100) : 'NOT FOUND');

// Check EVOLVE return
const evolveMatch = en.match(/進化為[\s\S]{0,100}return afterEvolve|return addLog/);
console.log('\nEVOLVE match:', evolveMatch ? evolveMatch[0].substring(0, 100) : 'NOT FOUND');
