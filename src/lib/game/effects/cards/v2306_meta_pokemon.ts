import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { ABILITY_EFFECTS, addLog, drawCards, updatePlayer, withPending, RESOLVERS, regR, regA, regAByName,
  getOwnBenchLimit,
} from '../_shared';
/**
 * v2.306 Meta Pokemon (H, I, J)
 */

// ── 吉雉雞ex (Fezandipiti ex) ──────────────────────────────────────────────────
regA('吉雉雞ex', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (p.abilityNamesUsedThisTurn?.includes('扭轉乾坤')) {
    return addLog(state, '扭轉乾坤：在這個回合已經使出了其他的「扭轉乾坤」，無法使用', aIdx);
  }
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const abilityKO = state.oppAbilityKOdMeInLastOppTurn?.[aIdx] ?? 0;
  if (attackKO === 0 && abilityKO === 0) {
    return addLog(state, '扭轉乾坤：上個對手回合沒有自己的寶可夢被擊倒，無法使用', aIdx);
  }
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    abilityNamesUsedThisTurn: [...(p.abilityNamesUsedThisTurn ?? []), '扭轉乾坤'],
  }));
  const instInPlay = s.players[aIdx].active?.iid === inst.iid 
    ? s.players[aIdx].active 
    : s.players[aIdx].bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  s = addLog(s, '吉雉雞ex：使用特性「扭轉乾坤」，從牌庫抽 3 張卡', aIdx);
  return drawCards(s, aIdx, 3);
});

// ── 厄鬼椪 碧草面具ex (Teal Mask Ogerpon ex) ─────────────────────────────────────────
regA('厄鬼椪 碧草面具ex', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  const hasGrass = p.hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && (card.pokemonType === 'Grass' || card.name.includes('【草】'));
  });
  if (!hasGrass) return addLog(state, '碧綠之舞：手牌沒有基本【草】能量，無法使用', aIdx);
  let s = addLog(state, '厄鬼椪 碧草面具ex：使用特性「碧綠之舞」，選擇手牌的 1 張基本【草】能量', aIdx);
  const instInPlay = s.players[aIdx].active?.iid === inst.iid 
    ? s.players[aIdx].active 
    : s.players[aIdx].bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  return withPending(s, {
    type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 1, maxCount: 1,
    filter: 'BasicEnergy:Grass', effectKey: 'teal-dance-attach',
    // v3.62 titleOverride：是「附於碧草面具ex」不是丟棄
    params: { targetIid: inst.iid, titleOverride: '碧綠之舞：選 1 張手牌基本【草】能量附於碧草面具ex' }
  });
});
regR('teal-dance-attach', (state, actorIdx, selectedIids, params) => {
  if (selectedIids.length === 0) return state;
  const targetIid = String(params?.targetIid ?? '');
  const energyIid = selectedIids[0];
  const p = state.players[actorIdx];
  const energyIndex = p.hand.findIndex(c => c.iid === energyIid);
  if (energyIndex === -1) return state;
  const energyInst = p.hand[energyIndex];
  let newHand = [...p.hand];
  newHand.splice(energyIndex, 1);
  let s = updatePlayer(state, actorIdx, player => {
    const p2 = { ...player, hand: newHand };
    if (p2.active?.iid === targetIid) {
      p2.active = { ...p2.active, energyAttached: [...p2.active.energyAttached, energyInst] };
    } else {
      const bIdx = p2.bench.findIndex(b => b.iid === targetIid);
      if (bIdx >= 0) {
        const newBench = [...p2.bench];
        newBench[bIdx] = { ...newBench[bIdx], energyAttached: [...newBench[bIdx].energyAttached, energyInst] };
        p2.bench = newBench;
      }
    }
    return p2;
  });
  s = addLog(s, '碧綠之舞：將基本【草】能量附於厄鬼椪 碧草面具ex身上，然後從牌庫抽 1 張卡', actorIdx);
  return drawCards(s, actorIdx, 1);
});
import { regPre, regPost, shuffle, countAttachedEnergyAsUnits } from '../_shared';
const flipCoin = () => Math.random() < 0.5;
// v4.959：用 countAttachedEnergyAsUnits — 認新衝天能量 on Stage2 = 2 個。
regPre('厄鬼椪 碧草面具ex|萬葉陣雨', (state, aIdx, pool) => {
  const p1 = state.players[0];
  const p2 = state.players[1];
  const e1 = p1.active ? countAttachedEnergyAsUnits(p1.active, pool) : 0;
  const e2 = p2.active ? countAttachedEnergyAsUnits(p2.active, pool) : 0;
  const bonus = (e1 + e2) * 30;
  const total = 30 + bonus;
  return { state: addLog(state, `萬葉陣雨：雙方戰鬥寶可夢身上共有 ${e1 + e2} 個能量，+${bonus} 傷害 → ${total} 傷害`, aIdx), damage: total };
});

// ── 叉字蝠 (Crobat) ──────────────────────────────────────────────────────────────
// v4.4995 重構：用 regAByName 註冊（key = cardName|abilityName）— 解決同名卡撞 key。
//   - 叉字蝠|夜間工作 (M4 050/091 + M-P-J)：從牌庫挑 1 張放牌庫頂
//   - 叉字蝠|怨影使者 (SV6a 029)：本回合打過阿杏的秘招 → 抽到滿 8 張（同檔下方新增）
// 兩個 ability 用 abilityName 自然分流，不再撞 key。v4.4994 的 defensive check 移除。
regAByName('叉字蝠', '夜間工作', (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (p.active?.iid !== inst.iid) return addLog(state, '夜間工作：這隻寶可夢不在戰鬥場上，無法使用', aIdx);
  if (p.active) p.active.abilityUsedThisTurn = true;
  let s = addLog(state, '叉字蝠：使用特性「夜間工作」，從牌庫選擇 1 張卡', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 1,  // v3.997：玩家可不選
    effectKey: 'crobat-night-work', params: { titleOverride: '夜間工作：從牌庫任意選擇 1 張卡放回牌庫頂' }
  });
});
// ── 叉字蝠｜怨影使者（SV6a 029 / id 10611）─────────────────────────────────
// v4.4995：實裝。卡面「在這個回合，若從手牌使出了『阿杏的秘招』，則在自己的回合時可使用 1 次。
//          從牌庫抽卡直到自己的手牌滿 8 張為止。」
// v4.76 修正：原 gate 多加了「戰鬥場」限制（v4.4995 違反 Rule 15 腦補），
//   但卡面**沒寫**戰鬥場限制。叉字蝠在備戰位也能用。
//   gate: akyoSecretPlayedThisTurn + 牌庫不空 + 該寶可夢未用過特性（getUsableAbilities 已 gate）
//   effect: 抽到手牌 ≥ 8 張為止（或牌庫抽光）
regAByName('叉字蝠', '怨影使者', (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (!p.akyoSecretPlayedThisTurn) return addLog(state, '怨影使者：本回合尚未從手牌打出『阿杏的秘招』', aIdx);
  // v4.76：標記「此 inst 本回合用過特性」— 不論 inst 在 active 或 bench
  state = updatePlayer(state, aIdx, pl => ({
    ...pl,
    active: pl.active?.iid === inst.iid ? { ...pl.active, abilityUsedThisTurn: true } : pl.active,
    bench: pl.bench.map(b => b.iid === inst.iid ? { ...b, abilityUsedThisTurn: true } : b),
  }));
  // 抽到手牌滿 8 張為止（取最新 state）
  const p2 = state.players[aIdx];
  const targetHandSize = 8;
  const toDraw = Math.max(0, targetHandSize - p2.hand.length);
  const actualDraw = Math.min(toDraw, p2.deck.length);
  if (actualDraw === 0) return addLog(state, `怨影使者：手牌已 ≥ ${targetHandSize} 張或牌庫為空，無需抽牌`, aIdx);
  let s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    hand: [...pl.hand, ...pl.deck.slice(0, actualDraw)],
    deck: pl.deck.slice(actualDraw),
  }));
  return addLog(s, `怨影使者：從牌庫抽 ${actualDraw} 張（手牌補到 ${p2.hand.length + actualDraw} 張）`, aIdx);
});

regR('crobat-night-work', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(s, '夜間工作：未選擇任何卡，牌庫已重洗', actorIdx);
  }
  const targetIid = selectedIids[0];
  const p = state.players[actorIdx];
  const idxInDeck = p.deck.findIndex(c => c.iid === targetIid);
  if (idxInDeck === -1) return state;
  const targetInst = p.deck[idxInDeck];
  let newDeck = [...p.deck];
  newDeck.splice(idxInDeck, 1);
  newDeck = shuffle(newDeck);
  newDeck.unshift(targetInst);
  let s = updatePlayer(state, actorIdx, p => ({ ...p, deck: newDeck }));
  return addLog(s, '夜間工作：重洗剩餘牌庫，並將所選的卡放回牌庫上方', actorIdx);
});
regPre('叉字蝠|毒音波', (state, aIdx, pool) => ({ state, damage: 80 }));
// v2.92：改用 statusPost('poisoned') — 內含薄霧/硬岩/皇帝之勢/抵抗之幕/泡沫/祭典會場 全套免疫檢查
regPost('叉字蝠|毒音波', statusPost('poisoned'));

// ── 妖火紅狐 (Delphox) ────────────────────────────────────────────────────────────
regA('妖火紅狐', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  const hasFire = p.hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && (card.pokemonType === 'Fire' || card.name.includes('【火】'));
  });
  if (!hasFire) return addLog(state, '閃焰魔法：手牌沒有基本【火】能量，無法使用', aIdx);
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = addLog(state, '妖火紅狐：使用特性「閃焰魔法」，選擇手牌的 1 張基本【火】能量丟棄', aIdx);
  return withPending(s, {
    type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 1, maxCount: 1,
    filter: 'BasicEnergy:Fire', effectKey: 'delphox-flare-magic',
  });
});
regR('delphox-flare-magic', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) return addLog(state, '閃焰魔法：未選擇能量', actorIdx);
  const energyIid = selectedIids[0];
  const p = state.players[actorIdx];
  const energyIndex = p.hand.findIndex(c => c.iid === energyIid);
  if (energyIndex === -1) return state;
  const energyInst = p.hand[energyIndex];
  let newHand = [...p.hand];
  newHand.splice(energyIndex, 1);
  let s = updatePlayer(state, actorIdx, player => ({
    ...player, hand: newHand, discard: [...player.discard, energyInst]
  }));
  const handCount = newHand.length;
  if (handCount >= 7) return addLog(s, '閃焰魔法：已丟棄能量，但手牌已達 7 張以上，不抽卡', actorIdx);
  const drawCount = 7 - handCount;
  s = addLog(s, `閃焰魔法：已丟棄能量，從牌庫抽 ${drawCount} 張卡（直到滿 7 張）`, actorIdx);
  return drawCards(s, actorIdx, drawCount);
});
// v4.958+v4.959：能量風暴 — 雙方全場「能量數」(units) × 30。
// v4.959 refactor：用 _shared.countAttachedEnergyAsUnits helper（取代 v4.958 inline）。
regPre('妖火紅狐|能量風暴', (state, aIdx, pool) => {
  let energyCount = 0;
  for (const p of state.players) {
    for (const poke of [p.active, ...p.bench]) {
      if (!poke) continue;
      energyCount += countAttachedEnergyAsUnits(poke, pool);
    }
  }
  const dmg = energyCount * 30;
  return { state: addLog(state, `能量風暴：雙方全場共有 ${energyCount} 個能量 → ${dmg} 傷害`, aIdx), damage: dmg };
});

// ── 噗噗豬 (Grumpig) ─────────────────────────────────────────────────────────────
regA('噗噗豬', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '能量舞步：牌庫沒有卡片，無法使用', aIdx);
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  const count = Math.min(4, p.deck.length);
  const top4 = p.deck.slice(0, count);
  const basicEnergies = top4.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (basicEnergies.length === 0) {
    let s = addLog(state, `噗噗豬：使用特性「能量舞步」，牌庫上方 ${count} 張卡中沒有基本能量，將其放回牌庫並重洗`, aIdx);
    return updatePlayer(s, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  let s = addLog(state, `噗噗豬：使用特性「能量舞步」，查看牌庫上方 ${count} 張卡，發現 ${basicEnergies.length} 張基本能量`, aIdx);
  return withPending(s, {
    type: 'reorder-deck-top', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: basicEnergies.length,
    effectKey: 'grumpig-energy-dance-pick',
    params: {
      titleOverride: '選擇要附加的基本能量卡',
      candidateIids: basicEnergies.map(c => c.iid),
      allowDiscard: true,
      allViewedIids: top4.map(c => c.iid),
    }
  });
});
regR('grumpig-energy-dance-pick', (state, actorIdx, selectedIids, params, pool) => {
  const allViewedIids = ((params?.allViewedIids as string[] | undefined) ?? []);
  const p = state.players[actorIdx];
  let newDeck = [...p.deck];
  const viewedCards = [];
  for (const iid of allViewedIids) {
    const idx = newDeck.findIndex(c => c.iid === iid);
    if (idx !== -1) {
      viewedCards.push(newDeck[idx]);
      newDeck.splice(idx, 1);
    }
  }
  const selectedCards = viewedCards.filter(c => selectedIids.includes(c.iid));
  const unselectedCards = viewedCards.filter(c => !selectedIids.includes(c.iid));
  newDeck = shuffle([...newDeck, ...unselectedCards]);
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: newDeck }));
  if (selectedCards.length === 0) return addLog(s, '能量舞步：未選擇附加任何能量，剩餘卡放回牌庫並重洗', actorIdx);
  s = updatePlayer(s, actorIdx, pl => ({ ...pl, discard: [...pl.discard, ...selectedCards] }));
  const allPokes = [...(s.players[actorIdx].active ? [s.players[actorIdx].active] : []), ...s.players[actorIdx].bench];
  s = addLog(s, `能量舞步：選擇了 ${selectedCards.length} 張基本能量，請選擇附加目標`, actorIdx);
  return withPending(s, {
    type: 'heal-target', actorIdx: actorIdx, sourcePlayerIdx: actorIdx, minCount: 1, maxCount: 1,
    effectKey: 'grumpig-energy-dance-distribute',
    params: { energyIids: selectedCards.map(c => c.iid), validIids: allPokes.map(c => c.iid), totalCount: selectedCards.length, placedCount: 0 }
  });
});
regR('grumpig-energy-dance-distribute', (state, actorIdx, selectedIids, params, pool) => {
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []);
  const totalCount = (params?.totalCount as number | undefined) ?? energyIids.length;
  const placedCount = (params?.placedCount as number | undefined) ?? 0;
  if (energyIids.length === 0) return state;
  const currentEnergyIid = energyIids[0];
  const restIids = energyIids.slice(1);
  const targetIid = selectedIids[0];
  const p = state.players[actorIdx];
  const energy = p.discard.find(c => c.iid === currentEnergyIid);
  if (!energy) return state;
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  const tCard = target ? pool.get(target.cardId) : null;
  const tName = tCard?.name ?? '?';
  let s = addLog(state, `能量舞步：第 ${placedCount + 1}/${totalCount} 張能量附於 ${tName}`, actorIdx);
  s = updatePlayer(s, actorIdx, pl => {
    const rest = pl.discard.filter(c => c.iid !== currentEnergyIid);
    if (pl.active?.iid === targetIid) {
      return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } };
    }
    return { ...pl, discard: rest, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, energyAttached: [...c.energyAttached, energy] } : c) };
  });
  if (restIids.length === 0) return s;
  const allPokes = [...(s.players[actorIdx].active ? [s.players[actorIdx].active] : []), ...s.players[actorIdx].bench];
  return withPending(s, {
    type: 'heal-target', actorIdx: actorIdx, sourcePlayerIdx: actorIdx, minCount: 1, maxCount: 1,
    effectKey: 'grumpig-energy-dance-distribute',
    params: { energyIids: restIids, validIids: allPokes.map(c => c.iid), totalCount, placedCount: placedCount + 1 }
  });
});
regPre('噗噗豬|念動彈', (state, aIdx, pool) => ({ state, damage: 60 }));

// ── 鐵面忍者 (Ninjask) ────────────────────────────────────────────────────────────
regA('鐵面忍者', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  // v3.80：getOwnBenchLimit 支援零之大空洞（5→8）
  if (p.bench.length >= getOwnBenchLimit(state, aIdx, pool)) return addLog(state, '脫殼：備戰區已滿，無法放置寶可夢', aIdx);
  const hasShedinja = p.deck.length > 0;
  if (!hasShedinja) {
    let s = addLog(state, '脫殼：牌庫為空', aIdx);
    return updatePlayer(s, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = addLog(state, '鐵面忍者：使用特性「脫殼」，從牌庫選擇 1 張「脫殼忍者」放置於備戰區', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 1,
    filter: 'Pokemon:Name=脫殼忍者', effectKey: 'ninjask-shed-skin', // v3.995：minCount → 0 在下方
  });
});
regR('ninjask-shed-skin', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, '脫殼：未選擇寶可夢，牌庫已重洗', actorIdx);
  }
  const targetIid = selectedIids[0];
  const p = state.players[actorIdx];
  const idx = p.deck.findIndex(c => c.iid === targetIid);
  if (idx === -1) return state;
  const targetInst = p.deck[idx];
  const targetCard = pool.get(targetInst.cardId);
  if (targetCard?.name !== '脫殼忍者') return addLog(state, '脫殼：選擇的不是「脫殼忍者」，取消操作', actorIdx);
  let newDeck = [...p.deck];
  newDeck.splice(idx, 1);
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(newDeck), bench: [...pl.bench, targetInst] }));
  return addLog(s, '脫殼：將「脫殼忍者」放置於備戰區，並重洗牌庫', actorIdx);
});
import { selfSwapPost, statusPost } from '../../effects';
const selfBouncePost = (name: string) => {
  return (state: GameState, aIdx: 0|1) => {
    // v2.991：拆能量、道具、進化棧底逐一回手牌（與 effects.ts selfReturnToHandPost 一致）
    let s = updatePlayer(state, aIdx, pl => {
      if (!pl.active) return pl;
      const inst = pl.active;
      const returning: CardInstance[] = [
        { ...inst, damage: 0, energyAttached: [], toolAttached: undefined,
          status: undefined, evolvedFromStack: undefined,
          evolvedThisTurn: undefined, justPlaced: undefined, playedFromHand: undefined,
          movedToActiveThisTurn: undefined, damageBonusThisTurn: undefined,
          damageReduceNextHit: undefined, abilityUsedThisTurn: undefined,
          cantAttackThisTurn: undefined, cantAttackPending: undefined,
          cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
          damageBonusPending: undefined },
        ...inst.energyAttached,
        ...(inst.toolAttached ? [inst.toolAttached] : []),
        ...(inst.evolvedFromStack ?? []),
      ];
      return { ...pl, hand: [...pl.hand, ...returning], active: null };
    });
    return addLog(s, `${name}：將這隻寶可夢與附加的卡全部放回手牌`, aIdx);
  };
};
const deckSearchToHandA = (maxCount: number, filter: string, name: string) => {
  return (state: GameState, aIdx: 0|1, pool: Map<string, Card>, inst: CardInstance | undefined) => {
  if (!inst) return state;
    const p = state.players[aIdx];
    const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
    if (instInPlay) instInPlay.abilityUsedThisTurn = true;
    let s = addLog(state, `使用特性「${name}」，從牌庫選擇最多 ${maxCount} 張卡加入手牌`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount,
      filter, effectKey: `deck-search-to-hand-a-${name}`
    });
  };
};

// v2.961: 修揭示資訊 bug — 此 resolver 共用 3 張卡（芳香精｜收集香氣、
// 象牙豬ex｜毛象搬運、萌芽鹿｜四季變換），三張卡卡面都有「給對手看過」字樣，
// 因此 log 必須公開具體卡名（per Iron Rule 8）。
// effectKey 格式：'deck-search-to-hand-a-{abilityName}' — 從 effectKey 反推 ability name 作為 log prefix。
const __genericDeckSearchResolverFactory = (abilityName: string) => {
  return (state: GameState, actorIdx: 0|1, selectedIids: string[], params: any, pool: Map<string, Card>) => {
    if (selectedIids.length === 0) {
      let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
      return addLog(s, `${abilityName}：未選擇卡片，牌庫已重洗`, actorIdx);
    }
    const p = state.players[actorIdx];
    const targets = p.deck.filter(c => selectedIids.includes(c.iid));
    let newDeck = p.deck.filter(c => !selectedIids.includes(c.iid));
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(newDeck), hand: [...pl.hand, ...targets] }));
    // Iron Rule 8：卡面有「給對手看過」→ addLog 公開具體卡名（防作弊驗證 filter 限制）
    const names = targets.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    return addLog(s, `${abilityName}：將「${names}」加入手牌，並重洗牌庫（給對手看）`, actorIdx);
  };
};
RESOLVERS.set('deck-search-to-hand-a-收集香氣', __genericDeckSearchResolverFactory('收集香氣'));
RESOLVERS.set('deck-search-to-hand-a-毛象搬運', __genericDeckSearchResolverFactory('毛象搬運'));
RESOLVERS.set('deck-search-to-hand-a-四季變換', __genericDeckSearchResolverFactory('四季變換'));
regPre('鐵面忍者|急速折返', (state, aIdx, pool) => ({ state, damage: 90 }));
regPost('鐵面忍者|急速折返', selfSwapPost('急速折返'));

// ── 貓鼬探長 (Gumshoos) ───────────────────────────────────────────────────────────
regA('貓鼬探長', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (p.hand.length === 0) return addLog(state, '蒐證：手牌為空，無法使用', aIdx);
  if (p.deck.length === 0) return addLog(state, '蒐證：牌庫為空，無法使用', aIdx);
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = addLog(state, '貓鼬探長：使用特性「蒐證」，選擇 1 張手牌與牌庫上方的卡互換', aIdx);
  return withPending(s, {
    type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 1, maxCount: 1,
    effectKey: 'gumshoos-investigate', params: { titleOverride: '選擇 1 張手牌與牌庫上方的卡互換' }
  });
});
regR('gumshoos-investigate', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) return addLog(state, '蒐證：未選擇手牌', actorIdx);
  const handIid = selectedIids[0];
  const p = state.players[actorIdx];
  const handIdx = p.hand.findIndex(c => c.iid === handIid);
  if (handIdx === -1) return state;
  const handInst = p.hand[handIdx];
  const deckInst = p.deck[0];
  let newHand = [...p.hand];
  newHand.splice(handIdx, 1, deckInst);
  let newDeck = [...p.deck];
  newDeck[0] = handInst;
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, hand: newHand, deck: newDeck }));
  return addLog(s, '蒐證：已將手牌與牌庫上方的卡互換', actorIdx);
});
regPre('貓鼬探長|咬住', (state, aIdx, pool) => ({ state, damage: 50 }));

// ── 光電傘蜥 (Heliolisk) ──────────────────────────────────────────────────────────
regA('光電傘蜥', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (!p.carnelliPlayedThisTurn) return addLog(state, '頸傘發電：這個回合沒有使出「卡娜莉」，無法使用', aIdx);
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = addLog(state, '光電傘蜥：使用特性「頸傘發電」，從牌庫選擇最多 2 張基本【雷】能量', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 2,
    filter: 'BasicEnergy:Lightning', effectKey: 'heliolisk-frill-generation', params: { targetIid: inst.iid }
  });
});
regR('heliolisk-frill-generation', (state, actorIdx, selectedIids, params, pool) => {
  const p = state.players[actorIdx];
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, '頸傘發電：未選擇能量，牌庫已重洗', actorIdx);
  }
  const targetIid = String(params?.targetIid ?? '');
  const energies = p.deck.filter(c => selectedIids.includes(c.iid));
  let newDeck = p.deck.filter(c => !selectedIids.includes(c.iid));
  let s = updatePlayer(state, actorIdx, pl => {
    let p2 = { ...pl, deck: shuffle(newDeck) };
    if (p2.active?.iid === targetIid) {
      p2.active = { ...p2.active, energyAttached: [...p2.active.energyAttached, ...energies] };
    } else {
      const bIdx = p2.bench.findIndex(b => b.iid === targetIid);
      if (bIdx >= 0) {
        const bench = [...p2.bench];
        bench[bIdx] = { ...bench[bIdx], energyAttached: [...bench[bIdx].energyAttached, ...energies] };
        p2.bench = bench;
      }
    }
    return p2;
  });
  return addLog(s, `頸傘發電：將 ${energies.length} 張基本【雷】能量附於光電傘蜥身上，並重洗牌庫`, actorIdx);
});
regPre('光電傘蜥|強大伏特', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const count = p.active ? p.active.energyAttached.length : 0;
  let heads = 0;
  for (let i = 0; i < count; i++) if (flipCoin()) heads++;
  const dmg = heads * 70;
  return { state: addLog(state, `強大伏特：擲 ${count} 次硬幣，出現 ${heads} 次正面 → ${dmg} 傷害`, aIdx), damage: dmg };
});

// ── 遠古巨蜓ex (Yanmega ex) ───────────────────────────────────────────────────────
regA('遠古巨蜓ex', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (p.active?.iid !== inst.iid) return addLog(state, '振翅高飛：這隻寶可夢不在戰鬥場上，無法使用', aIdx);
  if (!p.active.movedToActiveThisTurn) return addLog(state, '振翅高飛：這個回合沒有從備戰區放置於戰鬥場，無法使用', aIdx);
  if (p.active) p.active.abilityUsedThisTurn = true;
  let s = addLog(state, '遠古巨蜓ex：使用特性「振翅高飛」，從牌庫選擇最多 3 張基本【草】能量', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 3,
    filter: 'BasicEnergy:Grass', effectKey: 'yanmega-fluttering-flight',
  });
});
regR('yanmega-fluttering-flight', (state, actorIdx, selectedIids, params, pool) => {
  const p = state.players[actorIdx];
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, '振翅高飛：未選擇能量，牌庫已重洗', actorIdx);
  }
  const energies = p.deck.filter(c => selectedIids.includes(c.iid));
  let newDeck = p.deck.filter(c => !selectedIids.includes(c.iid));
  let s = updatePlayer(state, actorIdx, pl => {
    let p2 = { ...pl, deck: shuffle(newDeck) };
    if (p2.active) {
      p2.active = { ...p2.active, energyAttached: [...p2.active.energyAttached, ...energies] };
    }
    return p2;
  });
  return addLog(s, `振翅高飛：將 ${energies.length} 張基本【草】能量附於戰鬥場的遠古巨蜓ex身上，並重洗牌庫`, actorIdx);
});
regPre('遠古巨蜓ex|噴射旋風', (state, aIdx, pool) => ({ state, damage: 210 }));
regPost('遠古巨蜓ex|噴射旋風', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length < 3) return addLog(state, '噴射旋風：戰鬥寶可夢身上沒有足夠的能量可以轉移', aIdx);
  if (p.bench.length === 0) return addLog(state, '噴射旋風：沒有備戰寶可夢可轉移能量', aIdx);
  let s = addLog(state, '噴射旋風：選擇 3 個能量轉移到 1 隻備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'active-energy-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 3, maxCount: 3,
    effectKey: 'yanmega-jet-tornado-pick-energy', params: { titleOverride: '選擇 3 個要轉移的能量' }
  });
});
regR('yanmega-jet-tornado-pick-energy', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) return state;
  let s = addLog(state, `噴射旋風：已選擇 3 個能量，請選擇轉移目標`, actorIdx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: actorIdx, sourcePlayerIdx: actorIdx, minCount: 1, maxCount: 1,
    effectKey: 'yanmega-jet-tornado-move-energy', params: { energyIids: selectedIids, titleOverride: '選擇要將能量轉移過去的備戰寶可夢' }
  });
});
regR('yanmega-jet-tornado-move-energy', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) return state;
  const targetIid = selectedIids[0];
  const energyIids = (params?.energyIids as string[]) ?? [];
  let s = updatePlayer(state, actorIdx, pl => {
    if (!pl.active) return pl;
    const movingEnergies = pl.active.energyAttached.filter(c => energyIids.includes(c.iid));
    const keptEnergies = pl.active.energyAttached.filter(c => !energyIids.includes(c.iid));
    return {
      ...pl, active: { ...pl.active, energyAttached: keptEnergies },
      bench: pl.bench.map(b => b.iid === targetIid ? { ...b, energyAttached: [...b.energyAttached, ...movingEnergies] } : b)
    };
  });
  const targetName = pool.get(s.players[actorIdx].bench.find(b => b.iid === targetIid)?.cardId ?? '')?.name ?? '?';
  return addLog(s, `噴射旋風：將 3 個能量轉移到備戰的 ${targetName}`, actorIdx);
});

// ── 甲殼繭 / 盾甲繭 (Silcoon / Cascoon) ──────────────────────────────────────────
const silcoonCascoonAbility = (state: GameState, aIdx: 0|1, pool: Map<string, Card>, inst: CardInstance | undefined) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  // v3.80：getOwnBenchLimit
  if (p.bench.length >= getOwnBenchLimit(state, aIdx, pool)) return addLog(state, '增長繭：備戰區已滿，無法放置寶可夢', aIdx);
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = addLog(state, '增長繭：從牌庫選擇 1 張「甲殼繭」或者「盾甲繭」放置於備戰區', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 1,
    filter: 'Pokemon:Names=甲殼繭,盾甲繭', effectKey: 'silcoon-growth-cocoon', // v3.995：minCount → 0 在下方
    params: { titleOverride: '選擇 1 張「甲殼繭」或者「盾甲繭」' }
  });
};
regA('甲殼繭', 0, silcoonCascoonAbility);
// v2.94 移除：盾甲繭|增長繭 — JSON 無此 abilities，dead code
regR('silcoon-growth-cocoon', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, '增長繭：未選擇寶可夢，牌庫已重洗', actorIdx);
  }
  const targetIid = selectedIids[0];
  const p = state.players[actorIdx];
  const idx = p.deck.findIndex(c => c.iid === targetIid);
  if (idx === -1) return state;
  const targetInst = p.deck[idx];
  const targetCard = pool.get(targetInst.cardId);
  if (targetCard?.name !== '甲殼繭' && targetCard?.name !== '盾甲繭') return addLog(state, '增長繭：選擇的不是「甲殼繭」或「盾甲繭」，取消操作', actorIdx);
  let newDeck = [...p.deck];
  newDeck.splice(idx, 1);
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(newDeck), bench: [...pl.bench, targetInst] }));
  return addLog(s, `增長繭：將「${targetCard.name}」放置於備戰區，並重洗牌庫`, actorIdx);
});
regPre('甲殼繭|撞擊', (state, aIdx, pool) => ({ state, damage: 30 }));
regPre('盾甲繭|交替', (state, aIdx, pool) => ({ state, damage: 0 }));
regPost('盾甲繭|交替', selfSwapPost('交替'));

// ── 象牙豬ex (Mamoswine ex)
regA('象牙豬ex', 0, deckSearchToHandA(1, 'Pokemon:Any', '毛象搬運'));
regPre('象牙豬ex|雷鳴行進', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const count = p.bench.filter(c => {
    const card = pool.get(c.cardId);
    return card?.subtype === 'Stage 2';
  }).length;
  const bonus = count * 40;
  return { state: addLog(state, `雷鳴行進：備戰區有 ${count} 隻【2階進化】寶可夢 → 增加 ${bonus} 傷害`, aIdx), damage: 180 + bonus };
});

// ── 米立龍 (Tatsugiri) ───────────────────────
regA('米立龍', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  if (p.active?.iid !== inst.iid) return addLog(state, '集客：這隻寶可夢不在戰鬥場上，無法使用', aIdx);
  if (p.deck.length === 0) return addLog(state, '集客：牌庫為空', aIdx);
  if (p.active) p.active.abilityUsedThisTurn = true;
  const count = Math.min(6, p.deck.length);
  const top6 = p.deck.slice(0, count);
  const supporters = top6.filter(c => pool.get(c.cardId)?.subtype === 'Supporter');
  if (supporters.length === 0) {
    let s = addLog(state, `集客：牌庫上方 ${count} 張卡中沒有支援者，將其放回牌庫並重洗`, aIdx);
    return updatePlayer(s, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  let s = addLog(state, `集客：查看牌庫上方 ${count} 張卡，選擇 1 張支援者加入手牌`, aIdx);
  return withPending(s, {
    type: 'reorder-deck-top', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 1,
    effectKey: 'tatsugiri-attract-customers',
    params: {
      titleOverride: '選擇 1 張支援者加入手牌',
      candidateIids: supporters.map(c => c.iid),
      allowDiscard: true,
      allViewedIids: top6.map(c => c.iid),
    }
  });
});
regR('tatsugiri-attract-customers', (state, actorIdx, selectedIids, params, pool) => {
  const allViewedIids = ((params?.allViewedIids as string[] | undefined) ?? []);
  const p = state.players[actorIdx];
  let newDeck = [...p.deck];
  const viewedCards = [];
  for (const iid of allViewedIids) {
    const idx = newDeck.findIndex(c => c.iid === iid);
    if (idx !== -1) {
      viewedCards.push(newDeck[idx]);
      newDeck.splice(idx, 1);
    }
  }
  const selectedCards = viewedCards.filter(c => selectedIids.includes(c.iid));
  const unselectedCards = viewedCards.filter(c => !selectedIids.includes(c.iid));
  newDeck = shuffle([...newDeck, ...unselectedCards]);
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: newDeck }));
  if (selectedCards.length === 0) return addLog(s, '集客：未選擇支援者，剩餘卡放回牌庫並重洗', actorIdx);
  s = updatePlayer(s, actorIdx, pl => ({ ...pl, hand: [...pl.hand, selectedCards[0]] }));
  const cardName = pool.get(selectedCards[0].cardId)?.name ?? '?';
  return addLog(s, `集客：將「${cardName}」加入手牌，並重洗牌庫`, actorIdx);
});

// ── 喵喵ex (Meowth ex) ───────────────────────
// v2.94 移除 喵喵ex 殺手鐧捕捉 dead code — 真正實裝在 maroon_dragon_deck.ts 的 regA('喵喵ex', 0, ...)
regR('meowth-ex-trump-catch', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, '殺手鐧捕捉：未選擇支援者，牌庫已重洗', actorIdx);
  }
  const targetIid = selectedIids[0];
  const p = state.players[actorIdx];
  const idx = p.deck.findIndex(c => c.iid === targetIid);
  if (idx === -1) return state;
  const targetInst = p.deck[idx];
  let newDeck = [...p.deck];
  newDeck.splice(idx, 1);
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(newDeck), hand: [...pl.hand, targetInst] }));
  const cardName = pool.get(targetInst.cardId)?.name ?? '?';
  return addLog(s, `殺手鐧捕捉：將「${cardName}」加入手牌，並重洗牌庫`, actorIdx);
});
regPre('喵喵ex|夾尾巴逃跑', (state, aIdx, pool) => ({ state, damage: 60 }));
regPost('喵喵ex|夾尾巴逃跑', selfBouncePost('夾尾巴逃跑'));

// ── 芳香精 (Aromatisse) ───────────────────────
regA('芳香精', 0, deckSearchToHandA(2, 'BasicEnergy:Psychic', '收集香氣'));
regPre('芳香精|踩踏', (state, aIdx, pool) => ({ state, damage: 50 }));
regPost('芳香精|踩踏', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const dmg = p.active.damage ?? 0;
  if (dmg === 0) return state;
  const heal = Math.min(30, dmg);
  let s = updatePlayer(state, aIdx, pl => ({
    ...pl, active: { ...pl.active!, damage: dmg - heal }
  }));
  return addLog(s, `踩踏：恢復了 ${heal} 點傷害`, aIdx);
});

// ── 莉佳的蔓藤怪 (Erika's Tangela) ───────────────────────
regA('莉佳的蔓藤怪', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  const instInPlay = p.active?.iid === inst.iid ? p.active : p.bench.find(c => c.iid === inst.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = addLog(state, '莉佳的蔓藤怪：使用特性「百花齊放」，從牌庫選擇 1 張「莉佳的」寶可夢加入手牌', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 1, maxCount: 1,
    effectKey: 'erikas-tangela-hundred-flowers', params: { titleOverride: '選擇 1 張「莉佳的」寶可夢加入手牌' }
  });
});
regR('erikas-tangela-hundred-flowers', (state, actorIdx, selectedIids, params, pool) => {
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, '百花齊放：未選擇寶可夢，牌庫已重洗', actorIdx);
  }
  const targetIid = selectedIids[0];
  const p = state.players[actorIdx];
  const idx = p.deck.findIndex(c => c.iid === targetIid);
  if (idx === -1) return state;
  const targetInst = p.deck[idx];
  const targetCard = pool.get(targetInst.cardId);
  if (!targetCard?.name?.startsWith('莉佳的')) {
    return addLog(state, '百花齊放：選擇的不是「莉佳的」寶可夢，取消操作', actorIdx);
  }
  let newDeck = [...p.deck];
  newDeck.splice(idx, 1);
  let s = updatePlayer(state, actorIdx, pl => ({ ...pl, deck: shuffle(newDeck), hand: [...pl.hand, targetInst] }));
  return addLog(s, `百花齊放：將「${targetCard.name}」加入手牌，並重洗牌庫`, actorIdx);
});
regPre('莉佳的蔓藤怪|藤蔓攻擊', (state, aIdx, pool) => ({ state, damage: 50 }));
regPost('莉佳的蔓藤怪|藤蔓攻擊', (state, aIdx, pool) => {
  // v2.92：擲幣正面則走 statusPost('paralyzed')（內含完整免疫檢查）
  if (flipCoin()) {
    const s = addLog(state, '藤蔓攻擊：擲硬幣 — 正面', aIdx);
    return statusPost('paralyzed')(s, aIdx, pool);
  }
  return addLog(state, '藤蔓攻擊：擲硬幣 — 反面，無附加狀態', aIdx);
});

// ── 萌芽鹿 (Sawsbuck) ───────────────────────
regA('萌芽鹿', 0, deckSearchToHandA(1, 'Trainer:Stadium', '四季變換'));
regPre('萌芽鹿|強攻', (state, aIdx, pool) => ({ state, damage: 110 }));
