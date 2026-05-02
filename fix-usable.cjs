const fs = require('fs');
let en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

const NL = '\r\n';

const usableTarget = `    card.abilities.forEach((ab, abIdx) => {${NL}      // 只列出在 ABILITY_EFFECTS 中有登錄的主動特性${NL}      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;`;
const usableReplace = `    card.abilities.forEach((ab, abIdx) => {${NL}      // 只列出在 ABILITY_EFFECTS 中有登錄的主動特性${NL}      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;${NL}      ${NL}      // v2.320 新機制：如果是「打出/進化時自動提示」的特性，不在手動清單顯示${NL}      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;`;

if (en.includes(usableTarget)) {
  en = en.replace(usableTarget, usableReplace);
  console.log('[OK] getUsableAbilities updated');
} else {
  console.log('[FAIL] target not found');
}

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', en);
