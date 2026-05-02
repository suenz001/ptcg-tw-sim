const fs = require('fs');

// ══════════════════════════════════════════════════════════════════
// 1. effects.ts — 轉換 BENCH_PLACE_TRIGGERS.set('鐵蟻ex') → ABILITY_EFFECTS.set
//              — 新增 ON_PLAY/EVOLVE sets + promptPlayAbilities + resolver
// ══════════════════════════════════════════════════════════════════
let ef = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/effects.ts', 'utf8');

// 1a. 轉換鐵蟻ex BENCH_PLACE_TRIGGERS → ABILITY_EFFECTS
// 使用 regex 以避免 line ending 差異
ef = ef.replace(
  /BENCH_PLACE_TRIGGERS\.set\('鐵蟻ex', \(st, idx\) => \{([\s\S]*?)return updatePlayer\(st, oppIdx, p => \{\s*\n\s*const top = p\.deck\.slice\(0, 1\);\s*\n\s*return \{ \.\.\.p, deck: p\.deck\.slice\(1\), discard: \[\.\.\.p\.discard, \.\.\.top\] \};\s*\n\s*\}\);\s*\n\}\);/,
  `ABILITY_EFFECTS.set('鐵蟻ex|突然削退', (st, aIdx, pool, inst) => {
  const oppIdx = (1 - aIdx) as 0 | 1;
  if (st.players[oppIdx].deck.length === 0) {
    return addLog(st, '突然削退：對手牌庫為空', aIdx);
  }
  st = addLog(st, '突然削退：丟對手牌庫頂 1 張', aIdx);
  return updatePlayer(st, oppIdx, p => {
    const top = p.deck.slice(0, 1);
    return { ...p, deck: p.deck.slice(1), discard: [...p.discard, ...top] };
  });
});`
);

// 1b. 附加新導出集合 + 函式（加在檔案最末）
ef += `

// ══════════════════════════════════════════════════════════════════════════════
// v2.320 — 手牌上場 / 進化時主動提示特性機制
// ══════════════════════════════════════════════════════════════════════════════

/** 從手牌放置於備戰區時可觸發的特性名稱（playedFromHand gate） */
export const ON_PLAY_FROM_HAND_ABILITIES = new Set([
  '殺手鐧捕捉',
  '狂挖',
  '經驗法則',
  '沉雪',
  '迅速游標',
  '突然削退',
]);

/** 從手牌進化時可觸發的特性名稱（evolvedThisTurn gate） */
export const ON_EVOLVE_FROM_HAND_ABILITIES = new Set([
  '龐克練肌',
  '精神抽出',
  '搜尋寶石',
  '能量舞步',
  '脫殼',
  '增長繭',
]);

/**
 * 詢問玩家是否要使用剛上場/剛進化的寶可夢的特性。
 * 透過 modal-choice pending 讓玩家二選一（使用/不使用），
 * 選擇「使用」後 resolver 會呼叫已註冊的 ABILITY_EFFECTS。
 */
export function askUsePlayAbility(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  inst: CardInstance,
  abilityName: string,
  abilityKey: string
): GameState {
  const cardName = pool.get(inst.cardId)?.name ?? '?';
  return withPending(state, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'resolve-play-ability-prompt',
    params: {
      label: \`是否使用 \${cardName} 的「\${abilityName}」特性？\`,
      options: [
        { id: 'yes', text: '使用特性' },
        { id: 'no', text: '不使用' }
      ],
      abilityKey,
      targetIid: inst.iid
    }
  });
}

regR('resolve-play-ability-prompt', (state, actorIdx, selectedIids, params, pool) => {
  const choice = selectedIids[0] ?? 'no';
  if (choice !== 'yes') {
    return state; // 選擇不使用，直接繼續
  }
  const abilityKey = params?.abilityKey as string;
  const targetIid = params?.targetIid as string;
  const fn = ABILITY_EFFECTS.get(abilityKey);
  if (!fn) return state;

  const player = state.players[actorIdx];
  const inst = player.active?.iid === targetIid ? player.active : player.bench.find(c => c.iid === targetIid);
  if (!inst) return state;

  return fn(state, actorIdx, pool, inst);
});

/**
 * 在寶可夢上場（PLAY_BASIC）或進化（EVOLVE）後呼叫。
 * 掃描該寶可夢的 abilities，若有符合 ON_PLAY/EVOLVE 清單且 gate 條件滿足，
 * 則彈出 modal-choice 詢問玩家是否發動特性。
 */
export function promptPlayAbilities(
  state: GameState,
  aIdx: 0 | 1,
  card: Card,
  inst: CardInstance,
  pool: Map<string, Card>,
  isEvolve: boolean
): GameState {
  if (!card.abilities) return state;
  for (let i = 0; i < card.abilities.length; i++) {
    const ab = card.abilities[i];
    // ABILITY_EFFECTS 的 key 是 'pokemonName|abilityIndex'
    const key = \`\${card.name}|\${i}\`;
    if (!ABILITY_EFFECTS.has(key)) continue;

    const isPlay = ON_PLAY_FROM_HAND_ABILITIES.has(ab.name);
    const isEvolveAb = ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name);

    if (!isEvolve && isPlay) {
      // gate 檢查：沉雪需要場上有競技場
      if (ab.name === '沉雪' && !state.activeStadium) continue;
      // gate 檢查：經驗法則需要手牌有基本【鬥】能量
      if (ab.name === '經驗法則') {
        const hasFight = state.players[aIdx].hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc?.subtype === 'Basic' && (cc.pokemonType === 'Fighting' || /【鬥】/.test(cc.name));
        });
        if (!hasFight) continue;
      }
      // gate 檢查：突然削退需要對手牌庫不為空
      if (ab.name === '突然削退') {
        const oppIdx = (1 - aIdx) as 0 | 1;
        if (state.players[oppIdx].deck.length === 0) continue;
      }
      return askUsePlayAbility(state, aIdx, pool, inst, ab.name, key);
    }

    if (isEvolve && isEvolveAb) {
      // gate 檢查：搜尋寶石需要場上有太晶寶可夢 + 牌庫不空
      if (ab.name === '搜尋寶石') {
        const field = [...(state.players[aIdx].active ? [state.players[aIdx].active] : []), ...state.players[aIdx].bench];
        const hasTera = field.some(c => pool.get(c!.cardId)?.tags?.includes('太晶'));
        if (!hasTera) continue;
        if (state.players[aIdx].deck.length === 0) continue;
      }
      // gate 檢查：精神抽出需要牌庫不空
      if (ab.name === '精神抽出' && state.players[aIdx].deck.length === 0) continue;
      return askUsePlayAbility(state, aIdx, pool, inst, ab.name, key);
    }
  }
  return state;
}
`;

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/effects.ts', ef);
console.log('[OK] effects.ts updated');


// ══════════════════════════════════════════════════════════════════
// 2. maroon_dragon_deck.ts — 移除 BENCH_PLACE_TRIGGERS.set('喵喵ex')
// ══════════════════════════════════════════════════════════════════
let md = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/effects/cards/maroon_dragon_deck.ts', 'utf8');

// 移除整個 BENCH_PLACE_TRIGGERS.set('喵喵ex'...) 區塊
md = md.replace(
  /\/\/ ── 喵喵ex｜殺手鐧捕捉 — 上備戰時查看牌庫，選 1 張支援者加手牌，洗牌庫 ──────[\s\S]*?\}\);\s*\n\s*\n/,
  ''
);

// 移除 BENCH_PLACE_TRIGGERS import（如果沒有其他使用者的話）
md = md.replace(
  /  BENCH_PLACE_TRIGGERS,\n/,
  ''
);

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/effects/cards/maroon_dragon_deck.ts', md);
console.log('[OK] maroon_dragon_deck.ts updated');


// ══════════════════════════════════════════════════════════════════
// 3. engine.ts — import 新函式 + 在 PLAY_BASIC/EVOLVE 結尾呼叫 + 隱藏手動清單
// ══════════════════════════════════════════════════════════════════
let en = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', 'utf8');

// 3a. 加入 import
en = en.replace(
  `  flipCoinsWithLog,\n} from './effects';`,
  `  flipCoinsWithLog,\n  promptPlayAbilities,\n  ON_PLAY_FROM_HAND_ABILITIES,\n  ON_EVOLVE_FROM_HAND_ABILITIES,\n} from './effects';`
);

// 3b. PLAY_BASIC — 在 return afterPlace 前加入 promptPlayAbilities
en = en.replace(
  `    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);\n    return afterPlace;\n  }`,
  `    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);\n    \n    // v2.320 新增：自動提示「從手牌放置於備戰區時」的特性\n    afterPlace = promptPlayAbilities(afterPlace, aIdx, card, placed, pool, false);\n    \n    return afterPlace;\n  }`
);

// 3c. EVOLVE — 改 return addLog → let afterEvolve = addLog + promptPlayAbilities + return
en = en.replace(
  `    players[aIdx] = attacker;\n    return addLog(\n      { ...state, players },\n      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,\n      aIdx\n    );\n  }`,
  `    players[aIdx] = attacker;\n    let afterEvolve = addLog(\n      { ...state, players },\n      \`\${attacker.name} 的 \${baseCard.name} 進化為 \${evoCard.name}！\`,\n      aIdx\n    );\n    \n    // v2.320 新增：自動提示「從手牌進化時」的特性\n    afterEvolve = promptPlayAbilities(afterEvolve, aIdx, evoCard, evolved, pool, true);\n    \n    return afterEvolve;\n  }`
);

// 3d. getUsableAbilities — 隱藏自動提示的特性不出現在手動清單
en = en.replace(
  `    card.abilities.forEach((ab, abIdx) => {\n      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理\n      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;`,
  `    card.abilities.forEach((ab, abIdx) => {\n      // 只有註冊在 ABILITY_EFFECTS 才需要特殊處理\n      if (!ABILITY_EFFECTS.has(\`\${card.name}|\${abIdx}\`)) return;\n      \n      // v2.320 新機制：如果是「打出/進化時自動提示」的特性，不在手動清單顯示\n      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;`
);

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/engine.ts', en);
console.log('[OK] engine.ts updated');

console.log('\n=== All 3 files updated successfully ===');
