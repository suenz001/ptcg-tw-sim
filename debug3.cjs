const fs = require('fs');
const en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

// Find 只列出在 or 只有
const idx1 = en.indexOf('ABILITY_EFFECTS');
const idx2 = en.indexOf('ABILITY_EFFECTS', idx1 + 1);
const idx3 = en.indexOf('ABILITY_EFFECTS', idx2 + 1);

console.log('ABILITY_EFFECTS occurrences:');
let pos = 0;
while (true) {
  const i = en.indexOf('ABILITY_EFFECTS', pos);
  if (i === -1) break;
  const lineStart = en.lastIndexOf('\n', i) + 1;
  const lineEnd = en.indexOf('\n', i);
  console.log(`  at ${i}: ${en.substring(lineStart, lineEnd).trim()}`);
  pos = i + 1;
}

// Find the forEach
const forEachIdx = en.indexOf('card.abilities.forEach((ab, abIdx)');
console.log('\nforEach at:', forEachIdx);
if (forEachIdx > -1) {
  console.log('context:', JSON.stringify(en.substring(forEachIdx, forEachIdx + 250)));
}
