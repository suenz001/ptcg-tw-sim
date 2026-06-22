/**
 * v2.155 — 補實裝 20 個 preset 主力 ex 招式
 *
 * 起因：v2.155 之前 audit-data.mjs 的「未實裝招式」誤標，把所有有 effect 但
 * 純未實裝的招式統統當成「純傷害不需註冊」。實際上 v2.149/v2.154 新加的 9 組 preset
 * 主力 ex 多數招式都漏實裝。本檔集中補完。
 *
 * 修法：audit-data.mjs 已分類（v2.155）— 純傷害 vs 有 effect 但漏實裝。本檔處理後者。
 *
 * 實裝對照：
 *   1. 連續拳（火箭隊的袋獸ex）          coinHeadsMultiplyPre(4, 30)
 *   2. 跳躍扣殺（超級長耳兔ex）          damage 160 + skipDefEffects
 *   3. 巨型花束（超級大竺葵ex）          damage 70 + 自身草能量×50
 *   4. 惡棍衝擊（火箭隊的袋獸ex）        damage 120 + 該回合用過火箭隊支援者+100
 *   5. 鐵羽毛（帝王拿波ex）              damage 210 + 下次受傷-60
 *   6. 防護充能（蓋諾賽克特ex）          damage 150 + 下次受傷-30
 *   7. 金屬斬（堅盾劍怪）                damage 230 + cantAttackPending
 *   8. 燃燒充能（火伊布ex）              damage 130 + Post 牌庫搜≤2基本能量自附寶
 *   9. 電電充能（電電蟲）                damage 0 + Post 牌庫搜草+雷各≤2 能量
 *  10. 時間輪轉（時拉比）                damage 0 + Post 牌庫搜≤3 草寶/競技場到手牌
 *  11. 朋友呼喚（波加曼）                damage 0 + Post 牌庫搜 1 張支援者到手牌
 *  12. 樂呵呵之吻（迷唇娃）              damage 0 + Post 牌庫搜≤2 基本超能量附備戰
 *  13. 阿賽斯特萊石（太陽伊布ex）        damage 0 + Post 對手所有進化退化（進化卡回對手牌庫並洗）
 *  14. 雀躍（捲捲耳）                    damage 0 + Post 與備戰互換
 *  15. 天仙石（仙子伊布ex）              damage 0 + Post opp-bench 2 隻回對手牌庫 + 下回合鎖「天仙石」（v2.157）
 *  16. 時間爆炸（帝牙盧卡）              damage 80 + modal-choice：玩家選棄全能量則 +80（v2.156）
 *  17. 破壞潮旋（洛奇亞ex）              damage 140 + 擲幣到反 → 棄對手戰鬥位 N 能量
 *  18. 激流水泵（厄鬼椪 水井面具ex）     damage 100 + modal-choice：玩家選棄 3 能量則 對手備戰 120（v2.156）
 *  19. 音波拆裂（超級盔甲鳥ex）          自身全能量回牌庫並洗 + 對手 1 隻寶可夢受 220（玩家選戰鬥/備戰，v2.157）
 *  20. 精神尖槍（代歐奇希斯）            damage 120 + 若能量單位≥cost+2 → 對手備戰 1 隻 120
 *
 * v2.156：時間爆炸 / 激流水泵 升級為真正 modal-choice — 用 ATTACK_PRE_DISCARD_CHOICE
 *   讓 UI 彈出能量挑選 modal，玩家自己決定要不要執行 option（之前是自動執行）。
 *   配合 engine.ts 把 action 也傳給 ATTACK_POST，讓 POST 能讀同一 chosenIids。
 *
 * v2.157：音波拆裂 / 天仙石 升級為符合卡面
 *   - 音波拆裂：玩家可選戰鬥位/備戰位（用 opp-poke-choose + clone-strike-multi-hit）
 *   - 天仙石 cooldown：blockedAttackNamesNextTurn 只鎖招式名（不鎖整隻寶可夢）
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  regPre, regPost, regR,
  shuffle, addLog, withPending, updatePlayer,
  ATTACK_PRE_DISCARD_CHOICE,
  getAllAttachedTools, getEnergyDiscardUnits, clearActiveEffects, countAttachedEnergyAsUnits,
} from '../_shared';
import {
  coinHeadsMultiplyPre,
  hitBenchPickPost,
  flipCoinsWithLog,
  hasBloomOnField,
} from '../../effects';
import { countEnergy } from '../../engine';
import { startEnergyChain } from './v158_energy_chain';

// ══════════════════════════════════════════════════════════════════════════════
// (1) 連續拳（火箭隊的袋獸ex）— coin×30 4 次
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的袋獸ex|連續拳', coinHeadsMultiplyPre(4, 30, '連續拳'));

// ══════════════════════════════════════════════════════════════════════════════
// (2) 跳躍扣殺（超級長耳兔ex）— 160，不計算對手附加效果
// ══════════════════════════════════════════════════════════════════════════════
regPre('超級長耳兔ex|跳躍扣殺', (state) => ({
  state,
  damage: 160,
  skipDefEffects: true,
}));

// ══════════════════════════════════════════════════════════════════════════════
// (3) 巨型花束（超級大竺葵ex）— 70 + 自身草能量×50
// ══════════════════════════════════════════════════════════════════════════════
// v4.796：改用 countEnergy（host-aware）— 正確處理新衝天能量
//   背景：JSON 中基本【草】能量的 pokemonType 是 null。v4.791 用 countOneEnergy 解決
//   pokemonType=null fallback；但該 helper 不認特殊能量的「2 任意屬性」效果。
//   改用 engine 的 countEnergy(host-aware)：
//     - 新衝天能量 on Stage2 寶可夢 → 提供「各屬性 ×2」（含【草】×2）
//     - 1 基本【草】能量 → 【草】×1
//     - 結果：1 草 + 1 新衝天 on 超級大竺葵 ex (Stage2) → 草 count = 3 → 70 + 3×50 = 220
//   也已內建處理稜鏡能量 / 燃火能量等。
regPre('超級大竺葵ex|巨型花束', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 70 };
  // v5.255：補 bloom (大竺葵|繁茂) inline 計算 — 自方場上有繁茂時, 基本【草】能量算 2 個
  //   countEnergy() 內建 host-aware 特殊能量 (稜鏡/新衝天/燃火), 但不認繁茂.
  //   修法仿 effects.ts:6243 selfAllEnergyMultiplyPre 的 inline bloom 邏輯.
  // v5.601：改走中央 hasBloomOnField（繁茂被暗夜羽擊等消除時不算）
  const bloom = hasBloomOnField(state, aIdx, pool);
  let grassCount = 0;
  if (!bloom) {
    grassCount = countEnergy(att, pool).get('Grass') ?? 0;
  } else {
    // bloom 啟用: iterate 自身 energyAttached, 基本【草】 +2, 其他依 countEnergy 提供的【草】數 +N
    //   single-energy host-aware: 每張 energy 看 countEnergy 對單張的【草】貢獻
    //   單張 inst: 套用 host-aware 後的【草】數 (e.g. 稜鏡 on Basic = 1 草; 新衝天 on Stage2 = 2 草)
    for (const e of att.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') continue;
      // 是否為基本【草】 (pokemonType=Grass 或 name 含【草】)
      const isBasicGrass = ec.subtype === 'Basic'
        && (ec.pokemonType === 'Grass' || /【草】/.test(ec.name ?? ''));
      if (isBasicGrass) {
        grassCount += 2;  // bloom: 基本【草】算 2
      } else {
        // 非基本【草】: 用單張 host-aware 計算對【草】貢獻
        //   暫用模擬 single-energy CardInstance 算 countEnergy
        const singleInst = { ...att, energyAttached: [e] };
        grassCount += countEnergy(singleInst, pool).get('Grass') ?? 0;
      }
    }
  }
  const bonus = grassCount * 50;
  const dmg = 70 + bonus;
  const bloomLog = bloom ? '（繁茂×2 套用基本【草】）' : '';
  const s = addLog(state, `巨型花束：自身【草】能量 ${grassCount} 個${bloomLog} → 70 + ${bonus} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// (4) 惡棍衝擊（火箭隊的袋獸ex）— 120 + 該回合用過火箭隊支援者+100
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的袋獸ex|惡棍衝擊', (state, aIdx) => {
  const used = state.players[aIdx].rocketSupporterPlayedThisTurn;
  const dmg = used ? 220 : 120;
  const s = addLog(state,
    used
      ? '惡棍衝擊：本回合已用過火箭隊支援者 → 120 + 100 = 220'
      : '惡棍衝擊：本回合未用火箭隊支援者 → 120',
    aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// (5) 鐵羽毛（帝王拿波ex）— 210 + 下次受傷 -60
// ══════════════════════════════════════════════════════════════════════════════
regPre('帝王拿波ex|鐵羽毛', (state) => ({ state, damage: 210 }));
regPost('帝王拿波ex|鐵羽毛', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, damageReduceNextHit: 60 };
  players[aIdx] = att;
  return addLog({ ...state, players }, '鐵羽毛：下次受到招式傷害 -60', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (6) 防護充能（蓋諾賽克特ex）— 150 + 下次受傷 -30
// ══════════════════════════════════════════════════════════════════════════════
regPre('蓋諾賽克特ex|防護充能', (state) => ({ state, damage: 150 }));
regPost('蓋諾賽克特ex|防護充能', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, damageReduceNextHit: 30 };
  players[aIdx] = att;
  return addLog({ ...state, players }, '防護充能：下次受到招式傷害 -30', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (7) 金屬斬（堅盾劍怪）— 230 + 下回合無法使用招式
// ══════════════════════════════════════════════════════════════════════════════
regPre('堅盾劍怪|金屬斬', (state) => ({ state, damage: 230 }));
regPost('堅盾劍怪|金屬斬', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, cantAttackPending: true };
  players[aIdx] = att;
  return addLog({ ...state, players }, '金屬斬：下回合無法使用招式', aIdx);
});

// ── 大吾的金屬怪｜金屬斬（SVOD 12587）— 70（base，from JSON）+ 下回合無法使用招式
// 卡面：「在下個自己的回合，這隻寶可夢無法使用招式。」
// damage 由 JSON 直接讀（70），只需 regPost 設 cantAttackPending flag。
// v2.216 audit-all-preset-effects.mjs 偵測出（同名招式但卡名不同）。
regPost('大吾的金屬怪|金屬斬', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, cantAttackPending: true };
  players[aIdx] = att;
  return addLog({ ...state, players }, '金屬斬：下回合無法使用招式', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (8) 燃燒充能（火伊布ex）— 130 + 從牌庫搜最多 2 張基本能量，玩家逐張選目標附寶
// ══════════════════════════════════════════════════════════════════════════════
// v2.158：升級為玩家自選分配（之前簡化為均附 active）
regPre('火伊布ex|燃燒充能', (state) => ({ state, damage: 130 }));
regPost('火伊布ex|燃燒充能', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '燃燒充能：牌庫為空', aIdx);
  const max = Math.min(2, player.deck.length);
  const s = addLog(state, `燃燒充能：從牌庫選 ≤${max} 張基本能量（接著逐張選目標）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: max,
    effectKey: 'v158-energy-chain-start',
    params: { label: '燃燒充能', source: 'deck', scope: 'any-own', filterType: 'Any' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (9) 電電充能（電電蟲）— 0 傷 + 從牌庫搜【草】最多 2 張、再搜【雷】最多 2 張
// ══════════════════════════════════════════════════════════════════════════════
// v2.305 升級：兩段式——先選草（≤2），再選雷（≤2），確實符合「各最多 2 張」卡面規則
regPre('電電蟲|電電充能', (state) => ({ state, damage: 0 }));
regPost('電電蟲|電電充能', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '電電充能：牌庫為空', aIdx);
  const maxGrass = Math.min(2, player.deck.length);
  const s = addLog(state, `電電充能：選最多 ${maxGrass} 張基本【草】能量（接著選最多 2 張基本【雷】）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:Grass',
    minCount: 0, maxCount: maxGrass,
    effectKey: 'v155-bugcharge-grass',
    params: { label: '電電充能' },
  });
});

// 電電充能 第一段 resolver：草選完 → 開第二段選雷
regR('v155-bugcharge-grass', (st, aIdx, grassIids, params, pool) => {
  const label = String(params?.label ?? '電電充能');
  const player = st.players[aIdx];
  const maxLightning = Math.min(2, player.deck.length);
  if (maxLightning === 0) {
    if (grassIids.length === 0) {
      st = updatePlayerInline(st, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
      return addLog(st, `${label}：未選擇任何能量`, aIdx);
    }
    return startEnergyChain(st, aIdx, grassIids, {
      label, source: 'deck', scope: 'any-own', filterType: 'Any',
    }, pool);
  }
  const s = addLog(st, `${label}：已選 ${grassIids.length} 張【草】，接著選最多 ${maxLightning} 張基本【雷】能量`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:Lightning',
    minCount: 0, maxCount: maxLightning,
    effectKey: 'v155-bugcharge-lightning',
    params: { label, grassIids },
  });
});

// 電電充能 第二段 resolver：雷選完 → 合併草+雷 → 進 startEnergyChain
regR('v155-bugcharge-lightning', (st, aIdx, lightningIids, params, pool) => {
  const label = String(params?.label ?? '電電充能');
  const grassIids = (params?.grassIids as string[]) ?? [];
  const allIids = [...grassIids, ...lightningIids];
  if (allIids.length === 0) {
    st = updatePlayerInline(st, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(st, `${label}：未選擇任何能量`, aIdx);
  }
  const s = addLog(st, `${label}：共選 ${grassIids.length} 張【草】+ ${lightningIids.length} 張【雷】，開始附能`, aIdx);
  return startEnergyChain(s, aIdx, allIids, {
    label, source: 'deck', scope: 'any-own', filterType: 'Any',
  }, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// (10) 時間輪轉（時拉比）— 0 傷 + 從牌庫搜【草】寶或競技場最多 3 張到手牌
// ══════════════════════════════════════════════════════════════════════════════
regPre('時拉比|時間輪轉', (state) => ({ state, damage: 0 }));
regPost('時拉比|時間輪轉', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '時間輪轉：牌庫為空', aIdx);
  const max = Math.min(3, player.deck.length);
  let s = addLog(state, `時間輪轉：從牌庫選 ≤${max} 張【草】寶可夢/競技場到手牌`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'GrassPokemonOrStadium',
    minCount: 0, maxCount: max,
    effectKey: 'search-to-hand-reshuffle',
    params: { titleOverride: '時間輪轉：選 ≤3 張【草】寶可夢/競技場到手牌' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (11) 朋友呼喚（波加曼）— 0 傷 + 從牌庫搜 1 張支援者到手牌
// ══════════════════════════════════════════════════════════════════════════════
regPre('波加曼|朋友呼喚', (state) => ({ state, damage: 0 }));
regPost('波加曼|朋友呼喚', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '朋友呼喚：牌庫為空', aIdx);
  let s = addLog(state, '朋友呼喚：從牌庫搜 1 張支援者到手牌（重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Supporter',
    minCount: 0, maxCount: 1,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (12) 樂呵呵之吻（迷唇娃）— 0 傷 + 從牌庫搜≤2 基本超能量，附於「同 1 隻」備戰
// ══════════════════════════════════════════════════════════════════════════════
// v3.9999 修 Rule 7：原 v2.158 用 v158 chain 逐張選 target → 玩家可分散到不同寶可夢
//   違反卡面「附於 1 隻備戰寶可夢身上」(明文「1 隻」單數)。
//   改用新 chain：deck-search → bench-choose（1 隻）→ 全部能量附到那 1 隻。
regPre('迷唇娃|樂呵呵之吻', (state) => ({ state, damage: 0 }));
regPost('迷唇娃|樂呵呵之吻', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.bench.length === 0) return addLog(state, '樂呵呵之吻：備戰區無寶可夢', aIdx);
  if (player.deck.length === 0) return addLog(state, '樂呵呵之吻：牌庫為空', aIdx);
  const max = Math.min(2, player.deck.length);
  const s = addLog(state, `樂呵呵之吻：從牌庫選 ≤${max} 張基本【超】能量（將附於 1 隻備戰）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:Psychic',
    minCount: 0, maxCount: max,
    effectKey: 'kissy-deck-pick-then-target',
    params: { titleOverride: '樂呵呵之吻：從牌庫選最多 2 張基本【超】能量（接著選 1 隻備戰）' },
  });
});
// v3.9999 chain step 1：deck 選完 → 把能量搬到 attacker.discard，開 bench-choose
regR('kissy-deck-pick-then-target', (st, aIdx, energyIids, _params, _pool) => {
  if (energyIids.length === 0) {
    // 玩家未選 → 重洗牌庫結束
    return updatePlayer(addLog(st, '樂呵呵之吻：未選擇能量，重洗牌庫', aIdx), aIdx, p => ({
      ...p, deck: shuffle(p.deck),
    }));
  }
  // 把能量從 deck 搬到 discard 暫存，重洗剩餘 deck
  st = updatePlayer(st, aIdx, p => {
    const picked: CardInstance[] = [];
    let remDeck = p.deck;
    for (const iid of energyIids) {
      const e = remDeck.find(c => c.iid === iid);
      if (e) {
        picked.push(e);
        remDeck = remDeck.filter(c => c.iid !== iid);
      }
    }
    return { ...p, deck: shuffle(remDeck), discard: [...p.discard, ...picked] };
  });
  // 開 bench-choose picker（只選 1 隻備戰）
  return withPending(addLog(st, `樂呵呵之吻：選 1 隻備戰寶可夢將 ${energyIids.length} 張能量全部附上`, aIdx), {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'kissy-attach-all-to-target',
    params: {
      energyIids,
      titleOverride: '樂呵呵之吻：選 1 隻備戰寶可夢（將附上所有選到的能量）',
    },
  });
});
regR('kissy-attach-all-to-target', (st, aIdx, iids, params, pool) => {
  const targetIid = iids[0];
  const energyIids = (params?.energyIids as string[]) ?? [];
  if (!targetIid || energyIids.length === 0) return st;
  const player = st.players[aIdx];
  const targetPoke = player.active?.iid === targetIid ? player.active : player.bench.find(b => b.iid === targetIid);
  const targetName = targetPoke ? (pool.get(targetPoke.cardId)?.name ?? '?') : '?';
  st = updatePlayer(st, aIdx, p => {
    const energies = p.discard.filter(c => energyIids.includes(c.iid));
    const remDiscard = p.discard.filter(c => !energyIids.includes(c.iid));
    const attach = (poke: CardInstance) => poke.iid === targetIid
      ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
      : poke;
    return {
      ...p,
      discard: remDiscard,
      active: p.active ? attach(p.active) : null,
      bench: p.bench.map(attach),
    };
  });
  return addLog(st, `樂呵呵之吻：${energyIids.length} 張基本【超】能量全附到 ${targetName}`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (13) 阿賽斯特萊石（太陽伊布ex）— 0 傷 + 對手所有進化寶可夢退化
// ══════════════════════════════════════════════════════════════════════════════
regPre('太陽伊布ex|阿賽斯特萊石', (state) => ({ state, damage: 0 }));
regPost('太陽伊布ex|阿賽斯特萊石', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dPlayer = state.players[dIdx];
  // 找所有「進化寶可夢」（active + bench 中 stage===Stage1/Stage2）
  type Slot = { kind: 'active' } | { kind: 'bench'; idx: number };
  const targets: { iid: string; slot: Slot }[] = [];
  if (dPlayer.active) {
    const card = pool.get(dPlayer.active.cardId);
    if (card?.stage === 'Stage1' || card?.stage === 'Stage2') {
      targets.push({ iid: dPlayer.active.iid, slot: { kind: 'active' } });
    }
  }
  dPlayer.bench.forEach((b, idx) => {
    const card = pool.get(b.cardId);
    if (card?.stage === 'Stage1' || card?.stage === 'Stage2') {
      targets.push({ iid: b.iid, slot: { kind: 'bench', idx } });
    }
  });
  if (targets.length === 0) {
    return addLog(state, '阿賽斯特萊石：對手場上無進化寶可夢', aIdx);
  }

  // 對每隻 target：取 evolvedFromStack 最頂的進化卡 → 放回對手 deck，並用 evolvedFromStack 倒退一階
  let s = state;
  let returnedCount = 0;
  s = updatePlayerInline(s, dIdx, p => {
    const newDeckExtras: typeof p.deck = [];
    const downgrade = (poke: CardInstance): CardInstance => {
      if (!poke.evolvedFromStack || poke.evolvedFromStack.length === 0) return poke;
      // evolvedFromStack 結構：較底部 → 較頂部；最後一個是「目前形態」前一階
      const stack = [...poke.evolvedFromStack];
      const prev = stack.pop()!;
      // 把目前 cardId（最頂進化卡）放回對手牌庫。
      // 必須給回牌庫的「實體卡」新的唯一 iid；同一條進化鏈可能被多次退化，
      // 若固定使用 `${poke.iid}_evo_returned`，Stage1/Stage2 會在手牌/牌庫中撞 iid，
      // 導致 EVOLVE 以 toIid 找到錯的卡。
      newDeckExtras.push({
        iid: `${poke.iid}_evo_returned_${poke.cardId}_${Math.random().toString(36).slice(2, 8)}`,
        cardId: poke.cardId,
        energyAttached: [],
        damage: 0
      });
      returnedCount++;
      // 退化為 prev：cardId 變回前一階
      // v2.261 Bug C-13：退化規則 — 保留 damage / energy / tool（PDF §II-C-13），
      //   但清除特殊狀態與附加效果。
      // v3.9998 修：原 v2.261 設 evolvedThisTurn:true 防「本回合再進化」，
      //   但這 flag 只在「當前玩家」END_TURN 清（clearTurnFlags 只跑 aIdx）。
      //   阿賽斯特萊石作用對象是「對手」寶可夢 → 對手 START_TURN 時 flag 仍 true
      //   → 對手回合不能進化，違反 PTCG 規則（跨回合應失效）。
      //   修法：不設此 flag。本回合對方寶可夢沒有「進化動作」（不是他回合），
      //   所以即使移除 flag 也不會發生「本回合自我連續進化」問題。
      // v5.672：清狀態+附加效果改用中央 clearActiveEffects(原只清 7 旗標,漏其餘;PDF §II-C-13)。
      return {
        ...clearActiveEffects({ ...poke, cardId: prev.cardId }),
        evolvedFromStack: stack.length > 0 ? stack : undefined,
        evolvedFromIid: stack.length > 0 ? stack[stack.length - 1].iid : undefined,
        evolvedThisTurn: undefined, // v3.9998 對手退化不設(否則殘留誤擋其進化)
      };
    };
    let active = p.active;
    let bench = p.bench;
    for (const t of targets) {
      if (t.slot.kind === 'active' && active) {
        active = downgrade(active);
      } else if (t.slot.kind === 'bench') {
        const benchIdx = t.slot.idx;
        bench = bench.map((b, i) => i === benchIdx ? downgrade(b) : b);
      }
    }
    return { ...p, active, bench, deck: shuffle([...p.deck, ...newDeckExtras]) };
  });
  return addLog(s, `阿賽斯特萊石：對手 ${returnedCount} 隻進化寶可夢退化（進化卡回對手牌庫並洗）`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (14) 雀躍（捲捲耳）— 0 傷 + 與備戰互換
// ══════════════════════════════════════════════════════════════════════════════
regPre('捲捲耳|雀躍', (state) => ({ state, damage: 0 }));
regPost('捲捲耳|雀躍', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (player.bench.length === 0) return addLog(state, '雀躍：備戰區無寶可夢可換', aIdx);
  let s = addLog(state, '雀躍：選 1 隻備戰寶可夢與戰鬥位互換', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v155-self-swap-active',
  });
});

regR('v155-self-swap-active', (st, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  st = updatePlayerInline(st, aIdx, p => {
    const benchIdx = p.bench.findIndex(b => b.iid === targetIid);
    if (benchIdx < 0 || !p.active) return p;
    const oldActive = p.active;
    // v4.978：set movedToActiveThisTurn — 振翅高飛/潔淨支援/金屬之路 等特性 gate 需要
    const newActive = { ...p.bench[benchIdx], movedToActiveThisTurn: true };
    const newBench = [...p.bench];
    newBench[benchIdx] = clearActiveEffects(oldActive);
    return { ...p, active: newActive, bench: newBench };
  });
  return addLog(st, '雀躍：戰鬥位與備戰互換完成', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (15) 天仙石（仙子伊布ex）— 0 傷 + 對手 2 隻備戰回對手牌庫 + 下回合鎖「天仙石」
// ══════════════════════════════════════════════════════════════════════════════
// v2.157：cooldown 從「鎖整隻」精修為「只鎖天仙石招式名」（用 blockedAttackNamesNextTurn）
regPre('仙子伊布ex|天仙石', (state) => ({ state, damage: 0 }));
regPost('仙子伊布ex|天仙石', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dPlayer = state.players[dIdx];
  if (dPlayer.bench.length === 0) {
    return addLog(state, '天仙石：對手備戰區無寶可夢', aIdx);
  }
  const pickCount = Math.min(2, dPlayer.bench.length);
  let s = addLog(state, `天仙石：選 ${pickCount} 隻對手備戰寶可夢回對手牌庫並重洗`, aIdx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: pickCount, maxCount: pickCount,
    effectKey: 'v155-tianxianstone-return',
  });
});

regR('v155-tianxianstone-return', (st, aIdx, iids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (iids.length === 0) return st;
  const ret = new Set(iids);
  // 把那 N 隻備戰寶可夢「整個」(本體+附加能量+進化鏈所有卡) 全回對手牌庫並洗
  st = updatePlayerInline(st, dIdx, p => {
    const newDeckExtras: typeof p.deck = [];
    const newBench = p.bench.filter(b => {
      if (!ret.has(b.iid)) return true;
      // 取進化鏈：底部進化卡 + 附加能量 + 自身 cardId
      const allCardIds: string[] = [];
      if (b.evolvedFromStack) {
        for (const ev of b.evolvedFromStack) allCardIds.push(ev.cardId);
      }
      allCardIds.push(b.cardId);
      for (const cid of allCardIds) {
        newDeckExtras.push({ iid: b.iid + '_ret_' + cid, cardId: cid, energyAttached: [], damage: 0 });
      }
      for (const e of b.energyAttached) newDeckExtras.push(e);
      return false;
    });
    return { ...p, bench: newBench, deck: shuffle([...p.deck, ...newDeckExtras]) };
  });
  // v2.157：cooldown 精修 — 只鎖「天仙石」招式名而非整隻寶可夢的所有招式
  st = updatePlayerInline(st, aIdx, p => {
    if (!p.active) return p;
    const cur = p.active.blockedAttackNamesNextTurn ?? [];
    return {
      ...p,
      active: { ...p.active, blockedAttackNamesNextTurn: [...cur, '天仙石'] },
    };
  });
  return addLog(st, `天仙石：${iids.length} 隻對手備戰回對手牌庫並重洗；下回合無法再使用「天仙石」`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (16) 時間爆炸（帝牙盧卡）— 80 + 玩家可選棄全部能量回牌庫並重洗 → +80
// ══════════════════════════════════════════════════════════════════════════════
// v2.156：升級為真正 modal-choice — 用 ATTACK_PRE_DISCARD_CHOICE 讓 UI 彈出能量挑選 modal。
//   玩家不選任何能量 → 80（不執行 option）
//   玩家選任意 ≥1 個能量 → 視為「想執行 option」，PRE 強制棄全部能量回牌庫並洗 + 160 傷害
// 卡面要求棄「全部」能量，所以實裝為 binary（不允許半棄）。
ATTACK_PRE_DISCARD_CHOICE.set('帝牙盧卡|時間爆炸', {
  min: 0, max: null, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0,
  verb: 'return-to-deck', // 卡面：「將能量卡全部放回牌庫並重洗」
});
regPre('帝牙盧卡|時間爆炸', (state, aIdx, _pool, action) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 80 };
  const allEnergies = att.energyAttached;
  const chosenIids = action?.discardedEnergyIids ?? [];
  // 不選 → 80；無能量 → 也是 80
  if (chosenIids.length === 0 || allEnergies.length === 0) {
    return { state: addLog(state, '時間爆炸：未棄能量 → 80', aIdx), damage: 80 };
  }
  // 選了 ≥1 個 → 視為玩家想執行 option，依卡面強制棄全部
  const s2 = updatePlayerInline(state, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      deck: shuffle([...p.deck, ...allEnergies]),
    };
  });
  const log = addLog(s2, `時間爆炸：將自身 ${allEnergies.length} 個能量回牌庫並重洗 → 80 + 80 = 160`, aIdx);
  return { state: log, damage: 160 };
});

// ══════════════════════════════════════════════════════════════════════════════
// (17) 破壞潮旋（洛奇亞ex）— 140 + 擲幣到反 → 棄對手戰鬥位 N 能量
// ══════════════════════════════════════════════════════════════════════════════
regPre('洛奇亞ex|破壞潮旋', (state) => ({ state, damage: 140 }));
regPost('洛奇亞ex|破壞潮旋', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dActive = state.players[dIdx].active;
  if (!dActive || dActive.energyAttached.length === 0) {
    return addLog(state, '破壞潮旋：對手戰鬥位無能量', aIdx);
  }
  let heads = 0;
  let s0: GameState = state;
  while (true) {
    const r = flipCoinsWithLog(s0, 1, '破壞潮旋', aIdx);
    s0 = r.state;
    if (r.heads === 0) break;
    heads++;
  }
  state = s0;
  if (heads === 0) {
    return addLog(state, '破壞潮旋：第 1 次擲就反面 → 不丟能量', aIdx);
  }
  const discardCount = Math.min(heads, dActive.energyAttached.length);
  const discarded = dActive.energyAttached.slice(0, discardCount);
  const remaining = dActive.energyAttached.slice(discardCount);
  let s = updatePlayerInline(state, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : p.active,
    discard: [...p.discard, ...discarded],
  }));
  return addLog(s, `破壞潮旋：擲幣 ${heads} 次正面 → 丟對手戰鬥位 ${discardCount} 個能量`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// (18) 激流水泵（厄鬼椪 水井面具ex）— 100 + 玩家可選棄 3 能量 → 對手備戰 1 隻 120
// ══════════════════════════════════════════════════════════════════════════════
// v2.156：升級為 modal-choice — UI 顯示能量挑選 modal（min=0 max=3）。
//   玩家選 0 ~ 2 個 → 不執行 option（傷害 100，能量不動）
//   玩家選滿 3 個 → 執行 option：棄 3 個指定能量回牌庫並洗 + 對手備戰 1 隻受 120
// PRE 階段棄能量；POST 階段讀同一 action 觸發 hitBenchPickPost。
ATTACK_PRE_DISCARD_CHOICE.set('厄鬼椪 水井面具ex|激流水泵', {
  min: 0, max: 3, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0,
  verb: 'return-to-deck', // 卡面：「將 3 個能量放回牌庫並重洗」
  countMode: 'units',  // v4.14：卡面「3 個」用 units 解讀，1 張燃火/新衝天等特殊能量可達標
});
// v5.653 helper：啟用備戰 120 所需放回的「能量單位數」= min(3, 身上能量總單位)。
//   卡面「選擇 3 個能量放回牌庫」；官方 QA：身上不足 3 個時放回「全部」也成立並觸發備戰 120
//   （附 2 能量+璀璨結晶 → 放回 2 個可）。
//   ⚠ 璀璨結晶只減「使用招式的費用」(太晶 -1)，不改本效果放回張數；2 個能成立是因「只有 2 個、放回全部」，
//     並非「需求被 -1」。原 v3.875 特判「璀璨結晶→放回 2」會讓 crystal+3 能量者只放 2 留 1 仍觸發 120(錯)，
//     故移除特判，改純 min(3, 原始總單位)。扮晶晶酒 借招者亦同此通則(依借者身上能量)。
function _hydroPumpRequired(totalUnits: number): number {
  return Math.min(3, totalUnits);
}

regPre('厄鬼椪 水井面具ex|激流水泵', (state, aIdx, pool, action) => {
  const att = state.players[aIdx].active;
  const chosenIids = action?.discardedEnergyIids ?? [];
  if (!att) {
    return { state: addLog(state, '激流水泵：戰鬥場無寶可夢 → 100', aIdx), damage: 100 };
  }
  // v5.653：required = min(3, 原始附加能量總單位)。PRE 階段能量都還在 att 上 → 原始總量 = att 全部。
  const originalUnits = att.energyAttached.reduce((s, e) => s + getEnergyDiscardUnits(e.cardId, att, pool, state, aIdx), 0);
  const required = _hydroPumpRequired(originalUnits);
  // v4.14：units mode — 累計 units 而非張數
  const chosenInsts = att.energyAttached.filter(e => chosenIids.includes(e.iid));
  const chosenUnits = chosenInsts.reduce((s, e) => s + getEnergyDiscardUnits(e.cardId, att, pool, state, aIdx), 0);
  if (chosenUnits < required) {
    return { state: addLog(state, `激流水泵：未放回足夠能量（需 ${required}、目前 ${chosenUnits}）→ 100`, aIdx), damage: 100 };
  }
  // 棄玩家選的 required 個（取前 required 個 — UI 已限制 max）
  const allowed = new Set(att.energyAttached.map(e => e.iid));
  // v4.14：units mode — 不再 slice(0, required) 而是接受玩家選的全部（玩家已自己限最小組合）
  const chosenSet = new Set(chosenIids.filter(id => allowed.has(id)));
  const discarded = att.energyAttached.filter(e => chosenSet.has(e.iid));
  const remaining = att.energyAttached.filter(e => !chosenSet.has(e.iid));
  // 累計 units 判斷是否達標
  const totalUnits = discarded.reduce((s, e) => s + getEnergyDiscardUnits(e.cardId, att, pool, state, aIdx), 0);
  if (totalUnits < required) {
    return { state: addLog(state, '激流水泵：能量挑選異常 → 100', aIdx), damage: 100 };
  }
  const s2 = updatePlayerInline(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : p.active,
    deck: shuffle([...p.deck, ...discarded]),
  }));
  return {
    // v4.4993：卡面是「放回牌庫」非「丟棄」，log 字眼「棄」改「放」避免誤導
    state: addLog(s2, `激流水泵：放 ${required} 個能量回自身牌庫並重洗 → 戰鬥位 100 + 對手備戰 1 隻受 120`, aIdx),
    damage: 100,
  };
});
regPost('厄鬼椪 水井面具ex|激流水泵', (state, aIdx, pool, action) => {
  // v2.156：POST 也讀 action — 玩家有放滿 required 個才觸發備戰打擊
  // v3.875：required 依 璀璨結晶 動態判斷
  // v4.4993 Fix：PRE 已把選的能量從 active.energyAttached 移到 deck（line 625-629），
  //   POST 改在 deck 內找 chosenIids 對應 inst — 若在 active 找會 0 → fail → picker 不開。
  //   iid 不變、inst 仍在（只是位置從 attached 變 deck），units 計算結果等價。
  const att = state.players[aIdx].active;
  const chosenIids = action?.discardedEnergyIids ?? [];
  if (!att) return state;
  // v4.14：units mode — 累計 units 判斷
  // v4.4993：改在 deck 內找（PRE 已把能量 shuffle 進 deck）
  const p = state.players[aIdx];
  const chosenInsts = p.deck.filter(e => chosenIids.includes(e.iid));
  const chosenUnits = chosenInsts.reduce((s, e) => s + getEnergyDiscardUnits(e.cardId, att, pool, state, aIdx), 0);
  // v5.653：required = min(3, 原始總單位)。POST 時選的能量已移進 deck → 原始 = 剩餘(att 上) + 已放回(chosen)。
  const remainingUnits = att.energyAttached.reduce((s, e) => s + getEnergyDiscardUnits(e.cardId, att, pool, state, aIdx), 0);
  const required = _hydroPumpRequired(remainingUnits + chosenUnits);
  if (chosenUnits < required) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) {
    return addLog(state, '激流水泵：對手備戰無寶可夢（已棄能量但無 bench 目標）', aIdx);
  }
  return hitBenchPickPost(state, aIdx, 'opp', 1, 120, '激流水泵');
});

// ══════════════════════════════════════════════════════════════════════════════
// (19) 音波拆裂（超級盔甲鳥ex）— 自身全能量回牌庫 + 對手 1 隻寶可夢受 220
// ══════════════════════════════════════════════════════════════════════════════
// v2.157：升級為玩家可選戰鬥位/備戰位（之前簡化為只打戰鬥位）
//   PRE: 棄自身能量回牌庫並洗（強制），主招式 damage=0（用 picker 套傷害）
//   POST: 觸發 opp-poke-choose picker → clone-strike-multi-hit resolver
//     resolver 已支援「戰鬥場套弱抗、備戰位不計」（卡面註明 [在備戰區不計算弱點・抵抗力]）
regPre('超級盔甲鳥ex|音波拆裂', (state, aIdx) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 0 };
  if (att.energyAttached.length === 0) {
    return { state: addLog(state, '音波拆裂：自身無能量', aIdx), damage: 0 };
  }
  const energies = att.energyAttached;
  const s = updatePlayerInline(state, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      deck: shuffle([...p.deck, ...energies]),
    };
  });
  return {
    state: addLog(s, `音波拆裂：自身 ${energies.length} 個能量回牌庫並重洗`, aIdx),
    damage: 0,
  };
});
regPost('超級盔甲鳥ex|音波拆裂', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dPlayer = state.players[dIdx];
  const targetCount = (dPlayer.active ? 1 : 0) + dPlayer.bench.length;
  if (targetCount === 0) {
    return addLog(state, '音波拆裂：對手場上無寶可夢', aIdx);
  }
  const s = addLog(state, '音波拆裂：選對手 1 隻寶可夢造成 220 傷害（戰鬥場計弱抗、備戰位不計）', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'clone-strike-multi-hit', // v2.129 通用 resolver
    params: { dmg: 220, label: '音波拆裂' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (20) 精神尖槍（代歐奇希斯）— 120 + 若能量單位≥cost+2 → 對手備戰 1 隻 120
// ══════════════════════════════════════════════════════════════════════════════
regPre('代歐奇希斯|精神尖槍', (state) => ({ state, damage: 120 }));
regPost('代歐奇希斯|精神尖槍', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  const card = pool.get(att.cardId);
  if (!card) return state;
  // 找「精神尖槍」這個招式的 cost 長度
  const atk = card.attacks?.find(a => a.name === '精神尖槍');
  const costLen = atk?.cost?.length ?? 3;
  // v5.541：改用中央 host-aware countAttachedEnergyAsUnits（燃火附進化=3、火箭隊=2、新衝天Stage2=2）
  const unitCount = countAttachedEnergyAsUnits(att, pool, state, aIdx);
  if (unitCount < costLen + 2) {
    return addLog(state, `精神尖槍：能量 ${unitCount} 不滿 cost+2（${costLen + 2}）→ 不觸發備戰打擊`, aIdx);
  }
  return hitBenchPickPost(state, aIdx, 'opp', 1, 120, '精神尖槍');
});

// ══════════════════════════════════════════════════════════════════════════════
// helpers — 本檔 inline，避免跨檔依賴
// ══════════════════════════════════════════════════════════════════════════════

function updatePlayerInline(
  state: GameState,
  idx: 0 | 1,
  fn: (p: PlayerState) => PlayerState
): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[idx] = fn(players[idx]);
  return { ...state, players };
}

// v5.443：clearActiveEffectsInline 已收斂到中央 clearActiveEffects(_shared.ts)。
