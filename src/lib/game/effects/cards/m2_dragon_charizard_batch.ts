/**
 * v2.340 — M2/M2a Dragonite + Charizard/Camerupt focused batch
 *
 * Cards covered:
 * - 超級快龍ex｜天空搬運 / 龍之滑翔
 * - 哈克龍｜進化指引
 * - 花舞鳥ex｜激動渦輪
 * - 超級噴火龍Xex｜烈獄狂火X
 * - 超級噴火駝ex｜炙燒
 * - 火恐龍 SVQL｜大字爆炎（user explicitly requested this G-reg card）
 */
import type { Card } from '$lib/cards/types';
import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  ATTACK_PRE_DISCARD_CHOICE,
  addLog,
  clearActiveEffects,
  regA,
  regPre,
  regPost,
  regR,
  shuffle,
  updatePlayer,
  withPending,
} from '../_shared';

function cardName(pool: Map<string, Card>, inst: CardInstance | null | undefined): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '?') : '?';
}

function isBasicEnergyOf(card: Card | undefined, type: string, label: string): boolean {
  return !!card && card.supertype === 'Energy' && card.subtype === 'Basic'
    && (card.pokemonType === type || card.name.includes(label));
}

function providesFireEnergy(card: Card | undefined): boolean {
  // Basic【火】 and future Fire-providing special-energy names are accepted by text/name.
  return !!card && card.supertype === 'Energy'
    && (card.pokemonType === 'Fire' || card.name.includes('【火】'));
}

function isEvolutionPokemon(card: Card | undefined): boolean {
  if (!card || card.supertype !== 'Pokemon') return false;
  return card.stage === 'Stage1' || card.stage === 'Stage2'
    || card.subtype === 'Stage1' || card.subtype === 'Stage2'
    || card.subtype === 'ex' && ((card.stage as string) === 'Stage1' || (card.stage as string) === 'Stage2');
}

function selfField(p: PlayerState): CardInstance[] {
  return [...(p.active ? [p.active] : []), ...p.bench];
}

function hasOwnFireMegaEx(st: GameState, idx: 0 | 1, pool: Map<string, Card>): boolean {
  return selfField(st.players[idx]).some(inst => {
    const c = pool.get(inst.cardId);
    return !!c && c.name.startsWith('超級') && c.name.endsWith('ex') && c.pokemonType === 'Fire';
  });
}

// ── 超級快龍ex｜天空搬運 ─────────────────────────────────────────────────────
// 在自己的回合時可使用1次。將自己的戰鬥寶可夢與備戰寶可夢互換。
regA('超級快龍ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  if (!p.active) return st;
  if (p.bench.length === 0) return addLog(st, '天空搬運：沒有備戰寶可夢可互換', idx);
  return withPending(addLog(st, '天空搬運：選擇 1 隻備戰寶可夢與戰鬥寶可夢互換', idx), {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'sky-carry-switch',
    params: { validIids: p.bench.map(b => b.iid) },
  });
});

regR('sky-carry-switch', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const p = st.players[idx];
  if (!p.active || !targetIid) return st;
  const bIdx = p.bench.findIndex(b => b.iid === targetIid);
  if (bIdx < 0) return st;
  const oldActive = clearActiveEffects(p.active);
  const newActive = p.bench[bIdx];
  const newBench = [...p.bench];
  newBench[bIdx] = oldActive;
  const s = addLog(st, `天空搬運：${cardName(pool, newActive)} 與 ${cardName(pool, oldActive)} 互換`, idx);
  return updatePlayer(s, idx, pl => ({ ...pl, active: newActive, bench: newBench }));
});

// ── 超級快龍ex｜龍之滑翔 ─────────────────────────────────────────────────────
// 330；選擇2個這隻寶可夢身上附加的能量，將其丟棄。
ATTACK_PRE_DISCARD_CHOICE.set('超級快龍ex|龍之滑翔', {
  min: 2, max: 2, scope: 'attacker', baseDamage: 330, damagePerEnergy: 0,
});
regPre('超級快龍ex|龍之滑翔', (state, aIdx, _pool, action) => {
  let s = state;
  const p = state.players[aIdx];
  const all = p.active?.energyAttached ?? [];
  const selected = action?.discardedEnergyIids && action.discardedEnergyIids.length > 0
    ? action.discardedEnergyIids.slice(0, 2)
    : all.slice(-2).map(e => e.iid); // AI/headless fallback：丟最後 2 個自身能量
  if (selected.length > 0) {
    const chosenSet = new Set(selected);
    s = updatePlayer(state, aIdx, pl => {
      if (!pl.active) return pl;
      const discarded = pl.active.energyAttached.filter(e => chosenSet.has(e.iid));
      return {
        ...pl,
        active: { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => !chosenSet.has(e.iid)) },
        discard: [...pl.discard, ...discarded],
      };
    });
    s = addLog(s, `龍之滑翔：丟棄 ${Math.min(2, selected.length)} 個自身能量`, aIdx);
  }
  return { state: s, damage: 330 };
});

// ── 哈克龍｜進化指引 ─────────────────────────────────────────────────────────
// 若這隻寶可夢身上附有能量卡，1/回合，牌庫搜 1 張進化寶可夢加手。
regA('哈克龍', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const src = cardInst ? selfField(p).find(c => c.iid === cardInst.iid) : p.active;
  if (!src) return st;
  if (src.energyAttached.length === 0) return addLog(st, '進化指引：這隻哈克龍身上沒有附加能量', idx);
  const cand = p.deck.filter(c => isEvolutionPokemon(pool.get(c.cardId)));
  // v3.853: 即使 cand=0 也仍開 picker — 讓玩家查看牌庫剩餘卡（Iron Rule 14）
  return withPending(addLog(st, '進化指引：從牌庫選擇 1 張進化寶可夢加入手牌', idx), {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'EvolutionPokemon', minCount: 0, maxCount: 1,
    effectKey: 'dragonair-evolution-guide',
    params: { validIids: cand.map(c => c.iid) },
  });
});

regR('dragonair-evolution-guide', (st, idx, iids, _params, pool) => {
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(st, '進化指引：未選擇任何卡', idx);
  const s = addLog(st, `進化指引：選擇 ${picked.length} 張進化寶可夢加入手牌`, idx);
  return updatePlayer(s, idx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !iids.includes(c.iid))),
    hand: [...p.hand, ...picked],
  }));
});

// ── 花舞鳥ex｜激動渦輪 ───────────────────────────────────────────────────────
// 若自己場上有【火】超級進化ex，可不限次數：手牌 1 張基本火能量附於備戰【火】寶可夢。
regA('花舞鳥ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  if (!hasOwnFireMegaEx(st, idx, pool)) return addLog(st, '激動渦輪：場上沒有【火】屬性的超級進化寶可夢ex', idx);
  const energies = p.hand.filter(c => isBasicEnergyOf(pool.get(c.cardId), 'Fire', '【火】'));
  if (energies.length === 0) return addLog(st, '激動渦輪：手牌沒有基本【火】能量', idx);
  const targets = p.bench.filter(b => pool.get(b.cardId)?.pokemonType === 'Fire');
  if (targets.length === 0) return addLog(st, '激動渦輪：備戰區沒有【火】寶可夢', idx);
  return withPending(addLog(st, '激動渦輪：選 1 張手牌基本【火】能量', idx), {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Fire', minCount: 1, maxCount: 1,
    effectKey: 'exciting-turbo-pick-target',
    // v3.62 titleOverride：picker 預設 title 是「選擇手牌」中性語，
    //   這裡改成講清楚動詞「選 1 張手牌基本【火】能量（接著選備戰目標附於該位）」。
    params: {
      validIids: energies.map(e => e.iid),
      validTargetIids: targets.map(t => t.iid),
      titleOverride: '激動渦輪：選 1 張手牌基本【火】能量（接著選備戰目標附於該位）',
    },
  });
});

regR('exciting-turbo-pick-target', (st, idx, iids, params, _pool) => {
  const energyIid = iids[0];
  const validTargetIids = (params?.validTargetIids as string[]) ?? [];
  if (!energyIid) return st;
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'exciting-turbo-commit',
    params: { energyIid, validIids: validTargetIids },
  });
});

regR('exciting-turbo-commit', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string | undefined;
  const targetIid = iids[0];
  if (!energyIid || !targetIid) return st;
  const p = st.players[idx];
  const energy = p.hand.find(c => c.iid === energyIid);
  const target = p.bench.find(b => b.iid === targetIid);
  if (!energy || !target) return st;
  const eCard = pool.get(energy.cardId);
  const tCard = pool.get(target.cardId);
  if (!isBasicEnergyOf(eCard, 'Fire', '【火】') || tCard?.pokemonType !== 'Fire') return st;
  const s = addLog(st, `激動渦輪：將基本【火】能量附於 ${tCard.name}`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== energyIid),
    bench: pl.bench.map(b => b.iid === targetIid ? { ...b, energyAttached: [...b.energyAttached, energy] } : b),
  }));
});

// ── 超級噴火駝ex｜炙燒 ─────────────────────────────────────────────────────
// 80+；若對手戰鬥寶可夢【灼傷】，+160。
regPre('超級噴火駝ex|炙燒', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const burned = state.players[dIdx].active?.status === 'burned';
  return { state, damage: burned ? 240 : 80 };
});

// ── 超級噴火龍Xex｜烈獄狂火X ────────────────────────────────────────────────
// 丟棄自己場上任意數量的【火】能量卡，造成張數 ×90。
ATTACK_PRE_DISCARD_CHOICE.set('超級噴火龍Xex|烈獄狂火X', {
  min: 0, max: null, scope: 'any-own', baseDamage: 0, damagePerEnergy: 90,
});
regPre('超級噴火龍Xex|烈獄狂火X', (state, aIdx, pool, action) => {
  const p = state.players[aIdx];
  const chosen = action?.discardedEnergyIids;
  const eligibleIds = new Set<string>();
  for (const pk of selfField(p)) {
    for (const e of pk.energyAttached) {
      if (providesFireEnergy(pool.get(e.cardId))) eligibleIds.add(e.iid);
    }
  }
  const toDiscardIds = new Set(
    chosen && chosen.length > 0
      ? chosen.filter(id => eligibleIds.has(id))
      : Array.from(eligibleIds) // AI/headless fallback: discard all eligible Fire energies
  );
  let discardedCount = 0;
  let s = updatePlayer(state, aIdx, pl => {
    const discard: CardInstance[] = [];
    const strip = (pk: CardInstance): CardInstance => {
      const gone = pk.energyAttached.filter(e => toDiscardIds.has(e.iid));
      discard.push(...gone);
      return { ...pk, energyAttached: pk.energyAttached.filter(e => !toDiscardIds.has(e.iid)) };
    };
    const active = pl.active ? strip(pl.active) : null;
    const bench = pl.bench.map(strip);
    discardedCount = discard.length;
    return {
      ...pl,
      active,
      bench,
      discard: [...pl.discard, ...discard],
    };
  });
  const damage = discardedCount * 90;
  s = addLog(s, `烈獄狂火X：丟棄 ${discardedCount} 張【火】能量 → ${damage} 傷害`, aIdx);
  return { state: s, damage };
});

// ── 火恐龍 SVQL｜大字爆炎 ───────────────────────────────────────────────────
// G-reg normally outside project scope, but this exact card was explicitly requested.
regPost('火恐龍|大字爆炎', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const energy = p.active.energyAttached[p.active.energyAttached.length - 1];
  if (!energy) return state;
  const s = addLog(state, `大字爆炎：丟棄 ${pool.get(energy.cardId)?.name ?? '1 個能量'}`, aIdx);
  return updatePlayer(s, aIdx, pl => ({
    ...pl,
    active: pl.active ? { ...pl.active, energyAttached: pl.active.energyAttached.slice(0, -1) } : null,
    discard: [...pl.discard, energy],
  }));
});
