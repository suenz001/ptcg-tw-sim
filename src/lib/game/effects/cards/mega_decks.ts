/**
 * 三組超級進化預組卡效果（v2.100+ 起陸續實裝）：
 *   - 奧利瓦ex（草系 Stage2 Mega）
 *   - 鋁鋼橋龍ex（鋼系 Stage1 Mega）
 *   - 超級寶石海星ex / 超級雪妖女ex（水系 Mega 混合）
 *
 * 每張卡嚴格按 static/cards/*.json 的 rulesText 實裝；遇到卡面描述需要
 * 新 engine infra 時會在註解寫明、先 deferred（不再簡化，per feedback_effect_implementation_sop）。
 */

import type { CardInstance, PlayerState, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regA, regPre, regPost,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle, discardHand,
  healResolver, recordOppKO, getAllAttachedTools,
} from '../_shared';
import {
  hitBenchPickPost, canApplyAttackEffectToTarget, resolveBenchGuard,
  passiveImmunityDamageBlock,
  passiveCoinImmunity,
  TOOL_ATTACK_BONUS, PASSIVE_ATTACK_BONUS, PASSIVE_ATTACK_NO_STACK,
  JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS,
  // v5.190：中立中心對非規則寶可夢免疫招式傷害（玩家回報奧利瓦ex 油之機關槍）
  wouldNeutralCenterBlock,
} from '../../effects';
import { isBasicEnergyOfType, getEffectiveHP } from '../../engine';  // v5.091
import { dispatchEnergyDistributePending } from './v158_energy_chain';
import { addPendingPrize } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 奧利瓦ex ｜ 芳香射擊（160 + 自身清特殊狀態）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將這隻寶可夢的特殊狀態全部恢復。」（基礎 160）
regPre('奧利瓦ex|芳香射擊', (s) => ({ state: s, damage: 160 }));
regPost('奧利瓦ex|芳香射擊', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att || !att.status) return state;
  const name = pool.get(att.cardId)?.name ?? '?';
  const newActive: CardInstance = { ...att, status: undefined };
  const players = [...state.players] as typeof state.players;
  players[aIdx] = { ...state.players[aIdx], active: newActive };
  return addLog({ ...state, players },
    `芳香射擊：${name} 的特殊狀態全部恢復`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級雪妖女ex ｜ 怨言（傷害 = 對手手牌張數 × 50）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「造成對手的手牌的張數×50點傷害。」
regPre('超級雪妖女ex|怨言', (state, aIdx) => {
  const oppHandCount = state.players[(1 - aIdx) as 0 | 1].hand.length;
  const dmg = oppHandCount * 50;
  const s = addLog(state,
    `怨言：對手手牌 ${oppHandCount} 張 → 造成 ${dmg} 點傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級寶石海星ex ｜ 星雲光束（210，不計算弱點/抵抗力/附加效果）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「這個招式的傷害不計算弱點・抵抗力與對手的戰鬥寶可夢身上的附加效果。」
regPre('超級寶石海星ex|星雲光束', (state) => ({
  state,
  damage: 210,
  skipWeakRes: true,
  skipDefEffects: true,
}));

// ══════════════════════════════════════════════════════════════════════════════
// 超級寶石海星ex ｜ 噴射打擊（120 + 選 1 隻對手備戰寶可夢 50 傷）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「對手的1隻備戰寶可夢也受到50點傷害。[在備戰區不計算弱點・抵抗力。]」
regPre('超級寶石海星ex|噴射打擊', (state) => ({ state, damage: 120 }));
regPost('超級寶石海星ex|噴射打擊', (state, aIdx) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 50, '噴射打擊'));

// ══════════════════════════════════════════════════════════════════════════════
// 超級大嘴娃ex ｜ 貪心（傷害 = 自己已取獎賞數 × 80）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「造成自己已經獲得的獎賞卡的張數×80點傷害。」
// 「已取獎賞」= 6 - 自己剩餘獎賞數。初始 6 張 → 已取 0；取到最後 1 張 → 已取 5。
regPre('超級大嘴娃ex|貪心', (state, aIdx) => {
  const remaining = state.players[aIdx].prizes.length;
  const taken = Math.max(0, 6 - remaining);
  const dmg = taken * 80;
  const s = addLog(state,
    `貪心：自己已取獎賞 ${taken} 張 → 造成 ${dmg} 點傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級大嘴娃ex ｜ 大啃咬（基礎 260；若對手戰鬥位有傷害指示物 → 改為 30）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若對手的戰鬥寶可夢身上放置有傷害指示物，則這個招式的傷害改為『30』點。」
// 反直覺設計：對手越肉、HP 越受創時，大啃咬反而變弱。
regPre('超級大嘴娃ex|大啃咬', (state, aIdx, pool) => {
  const defActive = state.players[(1 - aIdx) as 0 | 1].active;
  const hasDamage = defActive && defActive.damage > 0;
  const dmg = hasDamage ? 30 : 260;
  const defName = defActive ? (pool.get(defActive.cardId)?.name ?? '?') : '?';
  const s = addLog(state,
    hasDamage
      ? `大啃咬：對手 ${defName} 身上有傷害指示物 → 傷害改為 30`
      : `大啃咬：對手 ${defName} 無傷害指示物 → 260 傷害`,
    aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 旋轉洛托姆 ｜ 突擊著地（70，若場上沒有競技場卡則招式失敗）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若場上沒有競技場卡，則這個招式失敗。」
regPre('旋轉洛托姆|突擊著地', (state, aIdx) => {
  if (!state.activeStadium) {
    const s = addLog(state, '突擊著地：場上無競技場卡，招式失敗', aIdx);
    return { state: s, damage: 0 };
  }
  return { state, damage: 70 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 奧利紐 ｜ 營養素（0 傷，選 1 隻自己寶可夢恢復 40 HP）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將自己的1隻寶可夢恢復「40」HP。」
regPre('奧利紐|營養素', (s) => ({ state: s, damage: 0 }));
regPost('奧利紐|營養素', (state, aIdx) => {
  const p = state.players[aIdx];
  // 可選目標：active + 有傷害的 bench（heal-target pending）
  const candidates = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  if (candidates.length === 0) return state;
  // 若全隊無人受傷則 skip（卡面沒要求必須選，但選了沒差）— 還是開讓玩家確認
  const s = addLog(state, '營養素：選擇 1 隻自己的寶可夢恢復 40 HP', aIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'nutrient-heal-40',
    params: { healAmount: 40 },
  });
});
// resolver 沿用 _shared 的 healResolver（讀 params.healAmount）
regR('nutrient-heal-40', healResolver);

// ══════════════════════════════════════════════════════════════════════════════
// 鋁鋼橋龍ex ｜ 金屬防禦強化（220 + 下個對手回合自身弱點消除）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在下個對手的回合，這隻寶可夢的弱點全部消除。」（基礎 220）
regPre('鋁鋼橋龍ex|金屬防禦強化', (s) => ({ state: s, damage: 220 }));
regPost('鋁鋼橋龍ex|金屬防禦強化', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const name = pool.get(p.active.cardId)?.name ?? '?';
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = {
    ...p,
    active: { ...p.active, weaknessDisabledNextTurn: true },
  };
  return addLog({ ...state, players },
    `金屬防禦強化：${name} 在下個對手回合弱點消除`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 鋁鋼橋龍 ｜ 塗層攻擊（120 + 下個對手回合不受【基礎】寶可夢招式傷害）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害。」（120）
regPre('鋁鋼橋龍|塗層攻擊', (s) => ({ state: s, damage: 120 }));
regPost('鋁鋼橋龍|塗層攻擊', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const name = pool.get(p.active.cardId)?.name ?? '?';
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = {
    ...p,
    active: { ...p.active, immuneToBasicAttackNextTurn: true },
  };
  return addLog({ ...state, players },
    `塗層攻擊：${name} 在下個對手回合不受【基礎】寶可夢招式傷害`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 吉普索（Supporter）— 從棄牌選 ≤2 張基本【鋼】能量附於自己 1 隻【鋼】寶可夢
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「從自己的棄牌區選擇最多 2 張『基本【鋼】能量』卡，附於自己的 1 隻【鋼】寶可夢身上。」
// 實裝：chained pending：discard-search 'Energy:Metal' 0-2 → heal-target 選【鋼】寶可夢附加。
// 參考過度放電 pattern（effects.ts: overvolt-attach-pick-target / overvolt-attach-commit）。
regG('吉普索', (st, idx, pool) => {
  // 棄牌區有基本鋼能量 + 場上有鋼寶可夢
  const hasMetalEnergy = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Metal');
  });
  const hasMetalPoke = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .some(c => pool.get(c.cardId)?.pokemonType === 'Metal');
  return hasMetalEnergy && hasMetalPoke;
});
reg('吉普索', (st, idx, pool) => {
  const cand = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Metal');
  });
  const maxPick = Math.min(2, cand.length);
  const s = addLog(st, `吉普索：從棄牌區選 0-${maxPick} 張基本【鋼】能量`, idx);
  return withPending(s, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Metal', minCount: 0, maxCount: maxPick,
    effectKey: 'gypso-pick-energies',
  });
});
regR('gypso-pick-energies', (st, idx, energyIids, _params, pool) => {
  if (energyIids.length === 0) {
    return addLog(st, '吉普索：未選擇能量', idx);
  }
  // 找自己場上所有鋼寶可夢
  const metalPokes = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .filter(c => pool.get(c.cardId)?.pokemonType === 'Metal');
  if (metalPokes.length === 0) {
    return addLog(st, '吉普索：場上無【鋼】寶可夢，能量留在棄牌區', idx);
  }
  if (metalPokes.length === 1) {
    // 只有 1 隻 → 直接附加
    const target = metalPokes[0];
    const tName = pool.get(target.cardId)?.name ?? '?';
    const energies = st.players[idx].discard.filter(c => energyIids.includes(c.iid));
    const s = addLog(st, `吉普索：將 ${energies.length} 張基本【鋼】能量附於 ${tName}`, idx);
    return updatePlayer(s, idx, pl => {
      const rest = pl.discard.filter(c => !energyIids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
      }
      return { ...pl, discard: rest,
        bench: pl.bench.map(c => c.iid === target.iid ? { ...c, energyAttached: [...c.energyAttached, ...energies] } : c) };
    });
  }
  // 多隻鋼寶可夢 → chained heal-target 選附加目標（複用 pending UI）
  const validIids = metalPokes.map(c => c.iid);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'gypso-attach-commit',
    params: { energyIids, validIids },
  });
});
regR('gypso-attach-commit', (st, idx, iids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tCard = pool.get(target.cardId);
  if (tCard?.pokemonType !== 'Metal') {
    return addLog(st, '吉普索：目標非【鋼】寶可夢，取消附加', idx);
  }
  const energies = p.discard.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  const s = addLog(st, `吉普索：將 ${energies.length} 張基本【鋼】能量附於 ${tCard.name}`, idx);
  return updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => !energyIids.includes(c.iid));
    if (pl.active && pl.active.iid === targetIid) {
      return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
    }
    return { ...pl, discard: rest,
      bench: pl.bench.map(c => c.iid === targetIid ? { ...c, energyAttached: [...c.energyAttached, ...energies] } : c) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 滿充的體貼（Supporter）— 1 隻超級進化ex HP 全恢復 + 能量放回手牌
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將自己的 1 隻『超級進化寶可夢【ex】』的 HP 全部恢復。然後，將恢復的寶可夢身上附加的能量卡全部放回手牌。」
// 實裝：heal-target pending + validIids 限定超級 ex（名稱以「超級」開頭 + subtype=ex）
regG('滿充的體貼', (st, idx, pool) => {
  return [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .some(c => {
      const card = pool.get(c.cardId);
      return card?.subtype === 'ex' && card.name.startsWith('超級');
    });
});
reg('滿充的體貼', (st, idx, pool) => {
  const megaExs = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.subtype === 'ex' && card.name.startsWith('超級');
    });
  if (megaExs.length === 0) return addLog(st, '滿充的體貼：場上無超級進化寶可夢ex', idx);
  const validIids = megaExs.map(c => c.iid);
  const s = addLog(st, '滿充的體貼：選 1 隻超級進化ex（HP 全恢復 + 能量回手牌）', idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'max-affection',
    params: { validIids },
  });
});
regR('max-affection', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tName = pool.get(target.cardId)?.name ?? '?';
  const energyCount = target.energyAttached.length;
  const s = addLog(st,
    `滿充的體貼：${tName} HP 全恢復，${energyCount} 張能量放回手牌`, idx);
  return updatePlayer(s, idx, pl => {
    const isActive = pl.active?.iid === targetIid;
    const cleansed: CardInstance = {
      ...(isActive ? pl.active! : pl.bench.find(c => c.iid === targetIid)!),
      damage: 0,
      energyAttached: [],
    };
    const energies = target.energyAttached;
    return {
      ...pl,
      active: isActive ? cleansed : pl.active,
      bench: isActive ? pl.bench : pl.bench.map(c => c.iid === targetIid ? cleansed : c),
      hand: [...pl.hand, ...energies],
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 青木的手法（Supporter）— 棄手牌 → 搜寶/支/基能各 1 加手牌 + 洗牌
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將自己的手牌全部丟棄，從自己的牌庫選擇『寶可夢』卡『支援者』卡『基本能量』卡各 1 張，
//        在給對手看過後加入手牌。並且重洗牌庫。」
// 實裝：3 階段 chained deck-search（Pokemon / Supporter / BasicEnergy），每段 0-1（牌庫找不到可 Skip），
// 最後洗牌。參考小光（v2.22）的 3 階段 pattern。
regG('青木的手法', (st, idx) => st.players[idx].deck.length > 0);
reg('青木的手法', (st, idx) => {
  // Step 0：手牌全棄
  let s = discardHand(st, idx);
  s = addLog(s, '青木的手法：丟棄所有手牌，依序搜尋 1 寶可夢 / 1 支援者 / 1 基本能量', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'aoki-phase1',
  });
});
regR('aoki-phase1', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `青木的手法（寶可夢）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '青木的手法（寶可夢）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter',
    minCount: 0, maxCount: 1,
    effectKey: 'aoki-phase2',
  });
});
regR('aoki-phase2', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `青木的手法（支援者）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '青木的手法（支援者）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'aoki-phase3',
  });
});
regR('aoki-phase3', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `青木的手法（基本能量）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '青木的手法（基本能量）：未選擇', idx);
  }
  // 洗牌
  return updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 稜鏡塔（Stadium）resolver — 棄 2 張手牌後抽 1 張
// （USE_STADIUM handler 在 engine.ts 設 pending，effectKey='prism-tower-draw1'）
// ══════════════════════════════════════════════════════════════════════════════
regR('prism-tower-draw1', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const drawn = p.deck.slice(0, 1);
    return {
      ...p,
      hand: [...newHand, ...drawn],
      deck: p.deck.slice(1),
      discard: [...p.discard, ...toDiscard],
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 鋁鋼橋龍ex ｜ 合金建造（進化時 ability：棄牌搜最多 2 張基本鋼能量附鋼寶）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。從自己的棄牌區選擇
//   最多 2 張『基本【鋼】能量』卡，以任意方式附於自己的【鋼】寶可夢身上。」
// Gate：只能在剛進化的當回合使用（由 engine getUsableAbilities 的 evolvedThisTurn 白名單處理）。
// 流程同吉普索（共用 alloy-forge-pick → alloy-forge-commit chain）。
regA('鋁鋼橋龍ex', 0, (st, idx, pool, cardInst) => {
  if (!cardInst?.evolvedThisTurn) {
    return addLog(st, '合金建造：只能在從手牌使出並進化的當回合使用', idx);
  }
  // v2.218 Bug fix：基本能量卡 JSON 通常 pokemonType=undefined，必須加 name fallback
  // （與 v2.121 filter 修法同 root cause — 老版基本能量 scraper 沒抓 pokemonType）
  const cand = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Metal');
  });
  if (cand.length === 0) return addLog(st, '合金建造：棄牌區無基本【鋼】能量', idx);
  const metalPokes = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .filter(c => pool.get(c.cardId)?.pokemonType === 'Metal');
  if (metalPokes.length === 0) return addLog(st, '合金建造：場上無【鋼】寶可夢', idx);
  const maxPick = Math.min(2, cand.length);
  const s = addLog(st, `合金建造：從棄牌選 0-${maxPick} 張基本【鋼】能量`, idx);
  return withPending(s, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Metal', minCount: 0, maxCount: maxPick,
    effectKey: 'alloy-forge-pick',
  });
});
regR('alloy-forge-pick', (st, idx, energyIids, _params, pool) => {
  if (energyIids.length === 0) return addLog(st, '合金建造：未選擇能量', idx);
  const metalPokes = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .filter(c => pool.get(c.cardId)?.pokemonType === 'Metal');
  if (metalPokes.length === 0) return addLog(st, '合金建造：場上無【鋼】寶可夢，能量留在棄牌區', idx);
  if (metalPokes.length === 1) {
    // 只有 1 隻鋼寶可夢 → 全部附加（無分配選擇可言）
    const target = metalPokes[0];
    const tName = pool.get(target.cardId)?.name ?? '?';
    const energies = st.players[idx].discard.filter(c => energyIids.includes(c.iid));
    const s = addLog(st, `合金建造：將 ${energies.length} 張基本【鋼】能量附於 ${tName}`, idx);
    return updatePlayer(s, idx, pl => {
      const rest = pl.discard.filter(c => !energyIids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
      }
      return { ...pl, discard: rest,
        bench: pl.bench.map(c => c.iid === target.iid ? { ...c, energyAttached: [...c.energyAttached, ...energies] } : c) };
    });
  }
  // v2.87 多隻鋼寶可夢 + 全部能量同屬性（基本【鋼】）→ 改用 +/- 計數器 UI。
  return dispatchEnergyDistributePending(
    addLog(st, `合金建造：請以「+/-」分配 ${energyIids.length} 張【鋼】能量到 ${metalPokes.length} 隻【鋼】寶可夢`, idx),
    idx, energyIids, metalPokes.map(c => c.iid), { label: '合金建造', energyType: 'Metal' });
});
// v2.87：alloy-forge-commit 已被 v87-energy-distribute-flat 取代。
regR('alloy-forge-commit', (st, _idx, _iids, _params, _pool) => st);

// ══════════════════════════════════════════════════════════════════════════════
// 旋轉洛托姆 ｜ 風扇呼喚（首回合限定特性）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「只有在自己的最初回合可使用 1 次。從自己的牌庫選擇最多 3 張 HP 為『100』以下的
//   【無】寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。」
// v3.874：state.turn 在「後攻方 END_TURN」才 +1（engine.ts:5737），所以
//   state.turn=1 涵蓋雙方第 1 個動作回合（先攻 1st + 後攻 1st）
//   state.turn=2 涵蓋雙方第 2 個動作回合（先攻 2nd + 後攻 2nd）
//   原 gate `turn > 2` 誤把第 2 動作回合放行 → 改 `turn > 1` 才正確限「最初回合」。
regA('旋轉洛托姆', 0, (st, idx) => {
  if (st.turn > 1) {
    return addLog(st, '風扇呼喚：只能在自己的最初回合使用', idx);
  }
  if (st.players[idx].deck.length === 0) {
    return addLog(st, '風扇呼喚：牌庫已空', idx);
  }
  const s = addLog(st, '風扇呼喚：從牌庫選 0-3 張 HP≤100 的【無】寶可夢加手牌', idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'ColorlessPokeHP100', minCount: 0, maxCount: 3,
    effectKey: 'fan-call-hand',
  });
});
regR('fan-call-hand', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.96：卡面「給對手看過」→ 公開卡名給對手 log（PTCG 防作弊驗證）
    st = addLog(st, `風扇呼喚：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '風扇呼喚：未選擇寶可夢', idx);
  }
  return updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 奧利瓦ex ｜ 油之機關槍（選 6 次目標 × 20 傷，可選同一隻多次，不計弱抵）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「選擇 6 次對手的寶可夢，對所選的所有寶可夢不計算弱點・抵抗力，
//   造成其選擇次數×20 點傷害。（1 隻可選擇 2 次以上。）」
// 實裝：damage-distribute pending with includeActive=true（可選對手任意寶可夢 含戰鬥場），
//   totalCounters=6, counterDamage=20。傷害以指示物形式放置（不經 weakness pipeline）。
regPre('奧利瓦ex|油之機關槍', (s) => ({ state: s, damage: 0, skipWeakRes: true, skipDefEffects: true }));
regPost('奧利瓦ex|油之機關槍', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];
  if (!dp.active && dp.bench.length === 0) return state;
  const s = addLog(state, '油之機關槍：將 6 次 20 傷自由分配到對手任意寶可夢', aIdx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 6,
    effectKey: 'olive-oil-distribute',
    params: {
      totalCounters: 6, placedCounters: 0, counterDamage: 20,
      label: '油之機關槍', includeActive: true,
    },
  });
});
// v3.994 計算 attacker 對某 target 的傷害加成（道具 + 場上 passive 特性）
//   嚴格只套已 audit 確認的 buff（7 個 TOOL_ATTACK_BONUS + 4 個 PASSIVE_ATTACK_BONUS）。
//   阻礙之塔 gate（道具失效）、監視塔【無】寶可夢特性擋、PASSIVE_ATTACK_NO_STACK dedup
//   都比照 engine.ts ATTACK pipeline 同邏輯（line 3447~3500）。
function computeOliveOilBuff(
  st: GameState,
  actorIdx: 0 | 1,
  defenderInst: CardInstance,
  defenderCard: Card | undefined,
  pool: Map<string, Card>,
): number {
  const attacker = st.players[actorIdx];
  if (!attacker.active) return 0;
  const attackerCard = pool.get(attacker.active.cardId);
  if (!attackerCard) return 0;
  // v3.994：TOOL/PASSIVE_ATTACK_BONUS 簽名要求 defCard 為 Card（非 undefined）；
  // defenderCard undefined 表示 pool lookup 失敗 — 罕見邊界，返回 0。
  if (!defenderCard) return 0;
  let bonus = 0;
  // 阻礙之塔 / 監視塔 gate
  const stadium = st.activeStadium;
  const stadiumCard = stadium ? pool.get(stadium.cardId) : undefined;
  const toolsJammed = !!stadiumCard && JAMMING_TOWER_STADIUMS.has(stadiumCard.name);
  const watchtowerActive = !!stadiumCard && ROCKET_WATCHTOWER_STADIUMS.has(stadiumCard.name);
  // 1. TOOL_ATTACK_BONUS — iterate attacker 道具
  if (!toolsJammed) {
    for (const t of getAllAttachedTools(attacker.active)) {
      const atkTool = pool.get(t.cardId);
      if (!atkTool) continue;
      const fn = TOOL_ATTACK_BONUS.get(atkTool.name);
      if (!fn) continue;
      const b = fn(attackerCard, attacker.active, defenderCard, defenderInst);
      if (b > 0) bonus += b;
    }
  }
  // 2. PASSIVE_ATTACK_BONUS — iterate attacker 場上所有寶可夢的 abilities
  const processedNoStack = new Set<string>();
  const attAll: CardInstance[] = [
    ...(attacker.active ? [attacker.active] : []),
    ...attacker.bench,
  ];
  for (const inst of attAll) {
    const c = pool.get(inst.cardId);
    if (!c?.abilities) continue;
    // 監視塔擋【無】寶可夢被動特性
    if (watchtowerActive && c.pokemonType === 'Colorless') continue;
    for (const ab of c.abilities) {
      const fn = PASSIVE_ATTACK_BONUS.get(ab.name);
      if (!fn) continue;
      if (PASSIVE_ATTACK_NO_STACK.has(ab.name) && processedNoStack.has(ab.name)) continue;
      const b = fn(attackerCard, defenderCard, st, actorIdx, pool);
      if (b > 0) {
        if (PASSIVE_ATTACK_NO_STACK.has(ab.name)) processedNoStack.add(ab.name);
        bonus += b;
      }
    }
  }
  return bonus;
}

// resolver：v3.994 改為 per-target batch（aggregate counts），buff 對每個 target 一次性套
//   PTCG 規則：極限腰帶 +50 是「對該目標寶可夢的整批傷害一次套用」，不是每個 counter 都加。
//   範例：選 6 次同隻 ex → 6×20 (=120) + 50 (極限腰帶) = 170 傷害（與官方 QA 一致）
regR('olive-oil-distribute', (st, actorIdx, selectedIids, params, pool) => {
  const totalCounters = (params?.totalCounters as number) ?? 6;
  const placedBefore = (params?.placedCounters as number) ?? 0;
  const counterDamage = (params?.counterDamage as number) ?? 20;
  const label = (params?.label as string) ?? '油之機關槍';
  const dIdx = (1 - actorIdx) as 0 | 1;
  if (selectedIids.length === 0) return st;

  // aggregate 每個 iid 被選擇的次數（一隻可多次選 — 卡面允許）
  const counts = new Map<string, number>();
  for (const iid of selectedIids) counts.set(iid, (counts.get(iid) ?? 0) + 1);
  const placedThisBatch = selectedIids.length;  // 全部 counter 計入消耗（含被擋的，比照 dragapult 溢出邏輯）

  let s: GameState = st;
  const koNames: string[] = [];
  let morePrizes = 0;
  const blockedTargetsOO = new Set<string>();

  for (const [iid, count] of counts) {
    const defender = s.players[dIdx];
    const target = defender.active?.iid === iid ? defender.active
      : defender.bench.find(c => c.iid === iid);
    if (!target) continue;
    const targetCard = pool.get(target.cardId);

    // v4.18：移除 v2.89 在此加的 canApplyAttackEffectToTarget check（語意錯誤，比照 v3.894 bench-hit-N 修法）。
    //   油之機關槍卡面：「不計算弱點・抵抗力，造成其選擇次數×20 點傷害」— 屬於【招式傷害 attack-damage】，
    //   不是【招式效果 attack-effect】。薄霧能量 / 對戰圓形 / 皇帝之勢 / 硬岩能量 / 抵抗之幕 等只擋招式效果，不擋傷害。
    //   玩家回報：奧利瓦 vs 附【薄霧能量】寶可夢 → 油之機關槍對其無效（誤判）。
    // v5.190：加中立中心 check — 對 active+bench 都擋（奧利瓦ex 是規則寶可夢，對非規則寶可夢應該擋）
    //   玩家回報：場上有中立中心時，奧利瓦ex 油之機關槍應該對非規則寶可夢都不會受到傷害
    //   既有實作 active target 完全沒檢查中立中心 → bug
    const attackerInst = s.players[actorIdx].active;
    const attackerCard = attackerInst ? pool.get(attackerInst.cardId) : undefined;
    if (wouldNeutralCenterBlock(s, pool, attackerCard, targetCard)) {
      if (!blockedTargetsOO.has(iid)) {
        blockedTargetsOO.add(iid);
        s = addLog(s, `${label}：${targetCard?.name ?? '?'} 中立中心競技場 效果（免疫此招式傷害）`, actorIdx);
      }
      continue;
    }
    // v5.367：條件式完全免疫特性（神秘石居 等）對 active+bench 都要擋 —
    //   油之機關槍是【ex 寶可夢招式傷害】，神秘石居/神秘守護 卡面「不受對手 ex 招式傷害」應免疫。
    {
      const piOO = passiveImmunityDamageBlock(s, actorIdx, targetCard, pool);
      if (piOO.blocked) {
        if (!blockedTargetsOO.has(iid)) {
          blockedTargetsOO.add(iid);
          s = addLog(s, `${label}：${targetCard?.name ?? '?'} ${piOO.reason}（免疫此招式傷害）`, actorIdx);
        }
        continue;
      }
    }
    // v3.993 招式傷害免疫（attack-damage — only bench；active 不受花之帷幔保護）
    if (defender.active?.iid !== iid) {
      const guardOOdmg = resolveBenchGuard(s, pool, actorIdx, targetCard, 'attack-damage');
      if (guardOOdmg.blocked) {
        if (!blockedTargetsOO.has(iid)) {
          blockedTargetsOO.add(iid);
          s = addLog(s, `${label}：${targetCard?.name ?? '?'} ${guardOOdmg.reason}（免疫此招式傷害）`, actorIdx);
        }
        continue;
      }
    }

    // v5.368：順滑大衣等擲幣型免疫 — active+bench 皆適用，真結算擲幣
    {
      const coinOO = passiveCoinImmunity(s, actorIdx, targetCard, pool);
      s = coinOO.state;
      if (coinOO.immune) {
        if (!blockedTargetsOO.has(iid)) {
          blockedTargetsOO.add(iid);
          s = addLog(s, `${label}：${targetCard?.name ?? '?'} 擲幣免疫（正面）（免疫此招式傷害）`, actorIdx);
        }
        continue;
      }
    }
    // v3.994 計算最終傷害：base × count + attacker buff（per-target 一次套用）
    const baseAmt = counterDamage * count;
    const buff = computeOliveOilBuff(s, actorIdx, target, targetCard, pool);
    const finalDmg = baseAmt + buff;

    const buffLog = buff > 0 ? `+${buff}=${finalDmg}` : '';
    s = addLog(s, `${label}：${targetCard?.name ?? '?'} 受 ${count}×${counterDamage}=${baseAmt}${buffLog} 傷害`, actorIdx);

    const newDmg = target.damage + finalDmg;
    const tHp = getEffectiveHP(target, pool, st);  // v5.091

    if (tHp > 0 && newDmg >= tHp) {
      // KO
      const ko: CardInstance[] = [
        { ...target, damage: newDmg }, ...target.energyAttached,
        ...(target.toolAttached ? [target.toolAttached] : []),
        ...(target.evolvedFromStack ?? []),
      ];
      const prizes = targetCard?.name?.endsWith('ex') ? (targetCard.name.startsWith('超級') ? 3 : 2) : 1;
      morePrizes += prizes;
      koNames.push(targetCard?.name ?? '?');
      const players = [...s.players] as [PlayerState, PlayerState];
      if (defender.active?.iid === iid) {
        players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...ko] };
      } else {
        players[dIdx] = {
          ...defender,
          bench: defender.bench.filter(c => c.iid !== iid),
          discard: [...defender.discard, ...ko],
        };
      }
      s = { ...s, players };
      // v2.246：油之機關槍 = 招式 KO
      s = recordOppKO(s, dIdx, targetCard, 'attack');
    } else {
      const players = [...s.players] as [PlayerState, PlayerState];
      const newDef = { ...defender };
      if (defender.active?.iid === iid) {
        newDef.active = { ...defender.active!, damage: newDmg };
      } else {
        newDef.bench = defender.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c);
      }
      players[dIdx] = newDef;
      s = { ...s, players };
    }
  }

  if (koNames.length > 0) {
    s = addLog(s, `${label}：${koNames.join('、')} 被擊倒！+${morePrizes} 張獎勵牌`, null);
    s = addPendingPrize(s, actorIdx, morePrizes);
  }

  const placedAfter = placedBefore + placedThisBatch;
  const remaining = Math.max(0, totalCounters - placedAfter);
  const defAfter = s.players[dIdx];
  const stillHasTarget = !!defAfter.active || defAfter.bench.length > 0;
  if (remaining > 0 && stillHasTarget) {
    return withPending(s, {
      type: 'damage-distribute',
      actorIdx: actorIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: remaining,
      effectKey: 'olive-oil-distribute',
      params: { totalCounters, placedCounters: placedAfter, counterDamage, label, includeActive: true },
    });
  }
  return addLog(s, `${label}：總計放置 ${placedAfter} 個 ${counterDamage} 傷`, actorIdx);
});
