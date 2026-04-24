/**
 * 三組超級進化預組卡效果（v2.100+ 起陸續實裝）：
 *   - 奧利瓦ex（草系 Stage2 Mega）
 *   - 鋁鋼橋龍ex（鋼系 Stage1 Mega）
 *   - 超級寶石海星ex / 超級雪妖女ex（水系 Mega 混合）
 *
 * 每張卡嚴格按 static/cards/*.json 的 rulesText 實裝；遇到卡面描述需要
 * 新 engine infra 時會在註解寫明、先 deferred、不做簡化版（feedback_effect_implementation_sop）。
 */

import type { CardInstance, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regPre, regPost,
  addLog, updatePlayer, withPending, shuffle, discardHand,
  healResolver,
} from '../_shared';
import { hitBenchPickPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 奧利瓦ex ｜ 芳香射擊（160 + 自身清特殊狀態）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將這隻寶可夢的特殊狀態全部恢復。」（基礎 160）
regPre('奧利瓦ex|芳香射擊', (s) => ({ state: s, damage: 160 }));
regPost('奧利瓦ex|芳香射擊', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att || !att.status) return state;
  const name = pool.get(att.cardId)?.name ?? '?';
  const newActive: CardInstance = { ...att, status: null };
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
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Metal';
  });
  const hasMetalPoke = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench]
    .some(c => pool.get(c.cardId)?.pokemonType === 'Metal');
  return hasMetalEnergy && hasMetalPoke;
});
reg('吉普索', (st, idx, pool) => {
  const cand = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Metal';
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
