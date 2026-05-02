const fs = require('fs');
let code = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

const target1 = `    // 觸發「放到備戰區」特性（例：喵喵ex｜殺手鐧捕捉）
    // 火箭隊的監視塔：【無】屬寶可夢的特性全部消除，跳過此觸發
    const placeFn = BENCH_PLACE_TRIGGERS.get(card.name);
    if (placeFn && !isColorlessAbilityBlocked(afterPlace, card, pool)) {
      afterPlace = placeFn(afterPlace, aIdx, pool);
    }
    // v2.119 險惡廢墟：改走統一 helper（同時被 pokemon_search / six_decks 等 resolver 呼叫）
    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);
    return afterPlace;
  }`;

const replace1 = `    // 觸發「放到備戰區」特性（例：喵喵ex｜殺手鐧捕捉）
    // 火箭隊的監視塔：【無】屬寶可夢的特性全部消除，跳過此觸發
    const placeFn = BENCH_PLACE_TRIGGERS.get(card.name);
    if (placeFn && !isColorlessAbilityBlocked(afterPlace, card, pool)) {
      afterPlace = placeFn(afterPlace, aIdx, pool);
    }
    // v2.119 險惡廢墟：改走統一 helper（同時被 pokemon_search / six_decks 等 resolver 呼叫）
    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);
    
    // v2.320 新增：自動提示「從手牌放置於備戰區時」的特性
    afterPlace = promptPlayAbilities(afterPlace, aIdx, card, placed, pool, false);
    
    return afterPlace;
  }`;

const target2 = `    players[aIdx] = attacker;
    return addLog(
      { ...state, players },
      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,
      aIdx
    );
  }`;

const replace2 = `    players[aIdx] = attacker;
    let afterEvolve = addLog(
      { ...state, players },
      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,
      aIdx
    );
    
    // v2.320 新增：自動提示「從手牌進化時」的特性
    afterEvolve = promptPlayAbilities(afterEvolve, aIdx, evoCard, evolved, pool, true);
    
    return afterEvolve;
  }`;

const target3 = `    card.abilities.forEach((ab, abIdx) => {
      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理
      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;`;

const replace3 = `    card.abilities.forEach((ab, abIdx) => {
      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理
      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;
      
      // v2.320 新機制：如果是「打出/進化時自動提示」的特性，不在手動清單顯示
      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;`;

code = code.replace(target1, replace1);
code = code.replace(target2, replace2);
code = code.replace(target3, replace3);

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', code);
console.log('Replaced successfully');
