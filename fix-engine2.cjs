const fs = require('fs');
let en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

const NL = en.includes('\r\n') ? '\r\n' : '\n';

// 3a. Import
const importTarget = `  flipCoinsWithLog,${NL}} from './effects';`;
const importReplace = `  flipCoinsWithLog,${NL}  promptPlayAbilities,${NL}  ON_PLAY_FROM_HAND_ABILITIES,${NL}  ON_EVOLVE_FROM_HAND_ABILITIES,${NL}} from './effects';`;

if (en.includes(importTarget)) {
  en = en.replace(importTarget, importReplace);
  console.log('[OK] import updated');
} else {
  console.log('[SKIP] import target not found');
}

// 3b. PLAY_BASIC
const playTarget = `    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);${NL}    return afterPlace;${NL}  }`;
const playReplace = `    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);${NL}    ${NL}    // v2.320 新增：自動提示「從手牌放置於備戰區時」的特性${NL}    afterPlace = promptPlayAbilities(afterPlace, aIdx, card, placed, pool, false);${NL}    ${NL}    return afterPlace;${NL}  }`;

if (en.includes(playTarget)) {
  en = en.replace(playTarget, playReplace);
  console.log('[OK] PLAY_BASIC updated');
} else {
  console.log('[SKIP] PLAY_BASIC target not found');
}

// 3c. EVOLVE
const evoTarget = `    players[aIdx] = attacker;${NL}    return addLog(${NL}      { ...state, players },${NL}      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,${NL}      aIdx${NL}    );${NL}  }`;
const evoReplace = `    players[aIdx] = attacker;${NL}    let afterEvolve = addLog(${NL}      { ...state, players },${NL}      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,${NL}      aIdx${NL}    );${NL}    ${NL}    // v2.320 新增：自動提示「從手牌進化時」的特性${NL}    afterEvolve = promptPlayAbilities(afterEvolve, aIdx, evoCard, evolved, pool, true);${NL}    ${NL}    return afterEvolve;${NL}  }`;

if (en.includes(evoTarget)) {
  en = en.replace(evoTarget, evoReplace);
  console.log('[OK] EVOLVE updated');
} else {
  console.log('[SKIP] EVOLVE target not found');
}

// 3d. getUsableAbilities
const usableTarget = `    card.abilities.forEach((ab, abIdx) => {${NL}      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理${NL}      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;`;
const usableReplace = `    card.abilities.forEach((ab, abIdx) => {${NL}      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理${NL}      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;${NL}      ${NL}      // v2.320 新機制：如果是「打出/進化時自動提示」的特性，不在手動清單顯示${NL}      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;`;

if (en.includes(usableTarget)) {
  en = en.replace(usableTarget, usableReplace);
  console.log('[OK] getUsableAbilities updated');
} else {
  console.log('[SKIP] getUsableAbilities target not found');
}

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', en);
console.log('\n=== engine.ts done ===');
