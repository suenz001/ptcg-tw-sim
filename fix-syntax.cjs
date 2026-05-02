const fs = require('fs');

let ef = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/effects.ts', 'utf8');
ef = ef.replace('});\r\n});\r\n\r\n// 螺釘地鼠', '});\r\n\r\n// 螺釘地鼠');
ef = ef.replace('});\n});\n\n// 螺釘地鼠', '});\n\n// 螺釘地鼠');
fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/effects.ts', ef);

let md = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/effects/cards/maroon_dragon_deck.ts', 'utf8');
md = md.replace('from \'../../effects\';\r\n\r\n\r\n});\r\n\r\n// ── 黑夜魔靈', 'from \'../../effects\';\r\n\r\n// ── 黑夜魔靈');
md = md.replace('from \'../../effects\';\n\n\n});\n\n// ── 黑夜魔靈', 'from \'../../effects\';\n\n// ── 黑夜魔靈');
fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/effects/cards/maroon_dragon_deck.ts', md);

console.log('Fixed syntax');
