/**
 * v6.402：engine.ts 相對前一版（v6.401）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（IRON_RULES Rule 54）：本版是「v6.402 的樣子 → v6.401 的樣子」，
 *   所以呼叫端必須由新到舊：stripV6402Engine → stripV6401Engine → stripV6400Engine → stripV6398Engine。
 *
 * 用法與 engine-strip-v6398 / v6400 / v6401 相同，三處各自 import 同一份：
 *   ・test-v6265-phantom-start-race.mjs 的 F4c／F4d
 *   ・test-v6375-a1-fieldwide-asof.mjs 的 F0b
 *   ・test-v6371-guard-hygiene.mjs 的探針（模組層相依）
 *
 * 【v6.402 對 engine.ts 的 12 組合法改動】主題是「同一個判準只能有一份」（Rule 38）：
 *   ① import 中央述詞六支
 *   ② 龐克頭盔觸發判準 → 中央 punkHelmetReflectDamageFor（與 effects 狙擊管線同一份）
 *   ③ TOOL_DEFENSE_REDUCE_BY_TYPE 觸發判準 → 中央 toolDefenseByTypeApplies（同上）
 *   ④ 豪邁炸彈 KO 路徑 gate → 中央 luxuryBombGateOk（與 TOOL_ON_DAMAGED 同一份）
 *   ⑤ 伏特【雷】能量 holder 屬性 → 中央 fieldPokemonHasType（場上有效屬性）
 *   ⑥ 燃料【火】能量 holder 屬性 → 同上
 *   ⑦⑧ 重試徽章 ×2（resolver 內擲幣 / ATTACK 末端）holder 屬性 → 同上
 *   ⑨ getEffectiveHP 內 inline 的 owner 推導 ＋ ctx 組裝 → 中央 fieldOwnerIdxOf／specialEnergyHolderCtx
 *   ⑩ SPECIAL_ENERGY_RETREAT_MOD 呼叫端補中央 ctx（磁鐵【鋼】能量改讀有效屬性）
 *
 * ⚠ 這十組**全部是零行為變化**：三張會改變有效屬性的卡（狠辣椒ex＝印刷【火】、小碎鑽＝印刷【鬥】、
 *   鐵轍跡＝印刷【鋼】且需要 G 標的「驅勁能量 未來」）在 H/I/J 都命不中上述任何一個屬性條件；
 *   化石在場上是【無】只對重試徽章有理論影響，而化石沒有招式 ⇒ 不可達。
 */

/** [本版的樣子, BASE(v6.401) 的樣子]；順序無關，每一組都必須恰好命中 1 次。 */
const V6402_PAIRS = [
  // ① import 中央述詞
  [
    [
      '  hasEffectivePokemonType,    // v6.207 同上（單一屬性版）',
      '  // >>> v6402-engine-imports',
      '  fieldPokemonHasType,            // ⭐v6.402 場上屬性比對唯一入口（呼叫端免自己 pool.get）',
      '  punkHelmetReflectDamageFor,     // ⭐v6.402 龐克頭盔唯一判準',
      '  toolDefenseByTypeApplies,       // ⭐v6.402 屬性條件型防禦道具唯一判準',
      '  luxuryBombGateOk,               // ⭐v6.402 豪邁炸彈唯一 gate',
      '  fieldOwnerIdxOf,                // ⭐v6.402 inst 在誰的場上（唯一一份推導）',
      '  fieldSlotOf,                    // ⭐v6.402 inst 在誰的場上＋哪個位置（同上，含 loc）',
      '  specialEnergyHolderCtx,         // ⭐v6.402 特殊能量 holder gate 脈絡的唯一建構點',
      '  // <<< v6402-engine-imports',
    ].join('\n'),
    '  hasEffectivePokemonType,    // v6.207 同上（單一屬性版）',
  ],
  // ② 龐克頭盔
  [
    [
      '    // >>> v6402-punk-helmet-engine',
      '    // ⭐v6.402：觸發判準收斂到中央 punkHelmetReflectDamageFor（與 effects 狙擊／多目標管線同一份）。',
      '    let punkReflectDamage = punkHelmetReflectDamageFor(',
      '      workingState, dIdx, defPlayers[dIdx].active, pool,',
      '      { toolsJammed, damageDealt: baseDamage },',
      '    );',
      '    // <<< v6402-punk-helmet-engine',
    ].join('\n'),
    [
      '    let punkReflectDamage = 0;',
      '    {',
      '      const defenderStatePre = defPlayers[dIdx];',
      '      const defToolCardPre = defenderStatePre.active?.toolAttached',
      '        ? pool.get(defenderStatePre.active.toolAttached.cardId) : null;',
      '      const defActiveCardPre = defenderStatePre.active ? pool.get(defenderStatePre.active.cardId) : null;',
      "      if (!toolsJammed && baseDamage > 0 && defToolCardPre?.name === '龐克頭盔' && defActiveCardPre?.pokemonType === 'Darkness') {",
      '        punkReflectDamage = 40;',
      '      }',
      '    }',
    ].join('\n'),
  ],
  // ③ TOOL_DEFENSE_REDUCE_BY_TYPE
  [
    [
      '        const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get(defTool.name);',
      '        // >>> v6402-tool-defense-by-type-engine',
      '        // ⭐v6.402：觸發判準（攻擊方屬性 ＋ holder 屬性）收斂到中央 toolDefenseByTypeApplies，',
      '        //   與 effects.ts 備戰／狙擊管線共用**同一份**（v6.207 時是兩份逐字重複 ⇒ Rule 38）。',
      '        // <<< v6402-tool-defense-by-type-engine',
      '        if (defense && baseDamage > 0',
      '            && toolDefenseByTypeApplies(workingState, defense, aIdx, attacker.active, attackerCard,',
      '                                        dIdx, defender.active, defenderCardForTool, pool)) {',
      '          {',
    ].join('\n'),
    [
      '        const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get(defTool.name);',
      '        // ⭐ v6.207：攻擊方屬性與 holder 屬性都改走中央有效屬性述詞（與 effects.ts 備戰管線同步）。',
      '        if (defense && baseDamage > 0',
      '            && getEffectivePokemonTypes(workingState, aIdx, attacker.active, attackerCard, pool)',
      '                 .some(t => defense.types.includes(t as EnergyType))) {',
      '          const _holderTypes = defense.holderTypes;',
      '          const holderOk = !_holderTypes',
      '            || getEffectivePokemonTypes(workingState, dIdx, defender.active, defenderCardForTool, pool)',
      '                 .some(t => _holderTypes.includes(t as EnergyType));',
      '          if (holderOk) {',
    ].join('\n'),
  ],
  // ④ 豪邁炸彈（KO 路徑）
  [
    [
      '      // >>> v6402-luxury-bomb-engine',
      '      // ⭐v6.402：gate 收斂到中央 luxuryBombGateOk（與 TOOL_ON_DAMAGED.豪邁炸彈 同一份）。',
      '      // <<< v6402-luxury-bomb-engine',
      "      if (!toolsJammed && onKOToolNames.some(c => c.name === '豪邁炸彈')) {",
      '        const lbAtk = newState.players[aIdx].active;',
      '        const lbAtkCard = lbAtk ? pool.get(lbAtk.cardId) : null;',
      '        if (lbAtk && luxuryBombGateOk(baseDamage, lbAtkCard ?? undefined, defenderCard ?? undefined)) {',
    ].join('\n'),
    [
      "      if (!toolsJammed && baseDamage >= 240 && onKOToolNames.some(c => c.name === '豪邁炸彈')) {",
      '        const lbAtk = newState.players[aIdx].active;',
      '        const lbAtkCard = lbAtk ? pool.get(lbAtk.cardId) : null;',
      '        const lbAtkIsMega = isMegaExCard(lbAtkCard ?? undefined);',
      '        const lbDefIsMega = isMegaExCard(defenderCard ?? undefined);',
      '        if (lbAtk && lbAtkIsMega && !lbDefIsMega) {',
    ].join('\n'),
  ],
  // ⑤ 伏特【雷】能量
  [
    [
      '    // >>> v6402-volt-lightning-engine',
      '    // ⭐v6.402「附有這張卡的【雷】寶可夢」＝場上**有效**屬性（中央述詞）。',
      "    if (baseDamage > 0 && fieldPokemonHasType(workingState, aIdx, attacker.active, pool, 'Lightning')) {",
      '    // <<< v6402-volt-lightning-engine',
    ].join('\n'),
    "    if (baseDamage > 0 && attackerCard.pokemonType === 'Lightning') {",
  ],
  // ⑥ 燃料【火】能量
  [
    [
      '    // >>> v6402-fuel-fire-holder',
      '    // ⭐v6.402「附有這張卡的【火】寶可夢」＝場上**有效**屬性（中央述詞）。',
      "    const fuelFireSnapshotIids: string[] = fieldPokemonHasType(state, aIdx, attacker.active, pool, 'Fire')",
      '    // <<< v6402-fuel-fire-holder',
      '      ? attacker.active.energyAttached',
    ].join('\n'),
    [
      "    const fuelFireSnapshotIids: string[] = attackerCard?.pokemonType === 'Fire'",
      '      ? attacker.active.energyAttached',
    ].join('\n'),
  ],
  // ⑦ 重試徽章（resolver 內擲幣）
  [
    [
      '        // >>> v6402-retry-badge-resolver',
      '        // ⭐v6.402「附有這張卡的【無】寶可夢」＝場上**有效**屬性（中央述詞）。',
      "        if (!fieldPokemonHasType(newState, actorIdx, _rbInst, pool, 'Colorless')) {",
      '        // <<< v6402-retry-badge-resolver',
    ].join('\n'),
    "        if (_rbCard?.pokemonType !== 'Colorless') {",
  ],
  // ⑧ 重試徽章（ATTACK 末端）
  [
    [
      '      // >>> v6402-retry-badge-attack-end',
      '      // ⭐v6.402「附有這張卡的【無】寶可夢」＝場上**有效**屬性（中央述詞）。',
      "      const isColorless = fieldPokemonHasType(newState, aIdx, atkInst, pool, 'Colorless');",
      '      // <<< v6402-retry-badge-attack-end',
    ].join('\n'),
    "      const isColorless = atkCard?.pokemonType === 'Colorless';",
  ],
  // ⑨ getEffectiveHP 的 owner 推導 ＋ ctx 組裝
  [
    [
      '  // >>> v6402-hp-ctx-central',
      '  // ⭐v6.402：owner 推導與 ctx 組裝原本在這裡 inline 各寫一份 ⇒ 收斂到中央',
      '  //   fieldOwnerIdxOf／specialEnergyHolderCtx（全站唯一一份，Rule 38）。',
      '  const _v6206OwnerIdx = fieldOwnerIdxOf(state, inst);',
      '  const _v6206EnergyCtx = specialEnergyHolderCtx(state, _v6206OwnerIdx, inst, pool);',
      '  // <<< v6402-hp-ctx-central',
    ].join('\n'),
    [
      '  const _v6206OwnerIdx = ((): 0 | 1 | undefined => {',
      '    if (!state) return undefined;',
      '    for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {',
      '      const p = state.players[k];',
      '      if (p?.active && p.active.iid === inst.iid) return k;',
      '      if (p?.bench?.some(b => b.iid === inst.iid)) return k;',
      '    }',
      '    return undefined;',
      '  })();',
      '  const _v6206EnergyCtx = {',
      '    state, ownerIdx: _v6206OwnerIdx, inst, pool,',
      '    effectiveTypes: getEffectivePokemonTypes(state, _v6206OwnerIdx, inst, card, pool),',
      '  };',
    ].join('\n'),
  ],
  // ⑩ SPECIAL_ENERGY_RETREAT_MOD 呼叫端補 ctx（ctx 在迴圈外算一次）
  [
    [
      '  if (card) {',
      '    // >>> v6402-retreat-mod-ctx',
      '    // ⭐v6.402：磁鐵【鋼】能量的 holder gate 改問場上有效屬性（中央 ctx）。',
      '    //   ⚠ ctx 在**迴圈外**算一次 —— 它與「是哪一張能量」無關，放進迴圈會讓每張能量',
      '    //     重跑一次全場特性掃描（審查 Y5）。',
      '    const _v6402RetreatCtx = specialEnergyHolderCtx(state, playerIdx, player.active, pool);',
      '    // <<< v6402-retreat-mod-ctx',
      '    for (const e of player.active.energyAttached) {',
      '      const ec = pool.get(e.cardId);',
      '      if (!ec) continue;',
      '      const fn = SPECIAL_ENERGY_RETREAT_MOD.get(ec.name);',
      '      if (!fn) continue;',
      '      const r = fn(card, player.active, _v6402RetreatCtx);',
    ].join('\n'),
    [
      '  if (card) {',
      '    for (const e of player.active.energyAttached) {',
      '      const ec = pool.get(e.cardId);',
      '      if (!ec) continue;',
      '      const fn = SPECIAL_ENERGY_RETREAT_MOD.get(ec.name);',
      '      if (!fn) continue;',
      '      const r = fn(card, player.active);',
    ].join('\n'),
  ],
  // ⑫ getEffectiveAttacks（古空棘魚｜潛入記憶）的第三份 owner 推導
  [
    [
      '  // >>> v6402-dive-memory-owner-central',
      '  // ⭐v6.402：這是 engine 裡「inst 在誰的場上」的**第三份** inline 推導',
      '  //   （另兩份在 getEffectiveHP，已收）。語義與中央 fieldOwnerIdxOf 完全相同',
      '  //   （每一方先 active 後 bench、player0 優先、找不到回 undefined）⇒ 一併收斂（Rule 38）。',
      '  const ownerIdx = fieldOwnerIdxOf(state, inst);',
      '  // <<< v6402-dive-memory-owner-central',
    ].join('\n'),
    [
      '  let ownerIdx: 0 | 1 | undefined;',
      '  if (state.players[0].active?.iid === inst.iid || state.players[0].bench.some(b => b.iid === inst.iid)) {',
      '    ownerIdx = 0;',
      '  } else if (state.players[1].active?.iid === inst.iid || state.players[1].bench.some(b => b.iid === inst.iid)) {',
      '    ownerIdx = 1;',
      '  }',
    ].join('\n'),
  ],
  // ⑪ getEffectiveHP 內 hpAbilityEffective 的 owner＋位置推導
  [
    [
      '  const hpAbilityEffective = (i: CardInstance, c: Card, abName: string): boolean => {',
      '    if (!state) return true;',
      '    // >>> v6402-hp-ability-slot-central',
      '    // ⭐v6.402：owner ＋ 位置的推導收斂到中央 fieldSlotOf（收斂前這裡是第三份 inline 迴圈）。',
      '    //   找不到（不在任一方場上）⇒ 沿用舊行為 return true，一個字都沒放寬。',
      '    const _slot = fieldSlotOf(state, i);',
      '    if (!_slot) return true;',
      '    return isAbilityHolderEffective(state, i, c, _slot.ownerIdx, abName, _slot.loc, pool);',
      '    // <<< v6402-hp-ability-slot-central',
      '  };',
    ].join('\n'),
    [
      '  const hpAbilityEffective = (i: CardInstance, c: Card, abName: string): boolean => {',
      '    if (!state) return true;',
      '    let oIdx: 0 | 1 | -1 = -1;',
      "    let loc: 'active' | 'bench' = 'bench';",
      '    for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {',
      '      const p = state.players[k];',
      "      if (p.active && p.active.iid === i.iid) { oIdx = k; loc = 'active'; break; }",
      "      if (p.bench.some(b => b.iid === i.iid)) { oIdx = k; loc = 'bench'; break; }",
      '    }',
      '    if (oIdx < 0) return true;',
      '    // ⚠ 上一行已經 `if (oIdx < 0) return true;` ⇒ 這裡只可能是 0 或 1（TS 對 `< 0` 不會自動窄化 literal union）。',
      '    return isAbilityHolderEffective(state, i, c, oIdx as 0 | 1, abName, loc, pool);',
      '  };',
    ].join('\n'),
  ],
];

/**
 * 把 v6.402 對 engine.ts 的合法改動逐字還原回前一版（v6.401）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6402Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6402_PAIRS.length; i++) {
    const [cur, base] = V6402_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6402Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請對照本版 engine.ts 更新 V6402_PAIRS。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
