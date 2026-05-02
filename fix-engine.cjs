const fs = require('fs');
let code = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

const tEvolve = `    players[aIdx] = attacker;
    return addLog(
      { ...state, players },
      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,
      aIdx
    );
  }`;

const rEvolve = `    players[aIdx] = attacker;
    let afterEvolve = addLog(
      { ...state, players },
      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,
      aIdx
    );
    
    // v2.320 新增：自動提示「從手牌進化時」的特性
    afterEvolve = promptPlayAbilities(afterEvolve, aIdx, evoCard, evolved, pool, true);
    
    return afterEvolve;
  }`;

const tGetUsable = `    card.abilities.forEach((ab, abIdx) => {
      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理
      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;`;

const rGetUsable = `    card.abilities.forEach((ab, abIdx) => {
      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理
      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;
      
      // v2.320 新機制：如果是「打出/進化時自動提示」的特性，不在手動清單顯示
      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;`;

code = code.replace(tEvolve, rEvolve);
code = code.replace(tGetUsable, rGetUsable);

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', code);
console.log('Replaced EVOLVE and getUsableAbilities');
