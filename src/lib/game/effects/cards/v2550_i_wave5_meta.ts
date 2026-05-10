/**
 * v2.55 I 標 Wave 5 — Meta 卡 + 重要互動
 *
 *  1. 流氓鱷ex|窮追不捨 (80 + 對手下回合無法撤退)
 *  2. 流氓鱷ex|強力啃咬 (140+ 自身有道具 +140)
 *  3. 拉普拉斯ex|水炮迴旋 (×水能量數 + 自身換場)
 *  4. 千面避役|水射擊 (110 + 自身棄 1 能量)
 *  5. 蒼炎刃鬼|煉獄斬 (220 + 手牌 4 張基本火 / 失敗)
 *  6. 奇魯莉安|呼喚信號 (從牌庫選 ≤3 寶可夢加手 + 重洗)
 *  7. 閃焰王牌|閃焰渦輪 (50 + 牌庫挑 ≤3 基本能量附備戰)
 *  8. 巨翅飛魚|呼朋引伴 (從牌庫挑 ≤2 基礎寶可夢放備戰)
 *  9. 蓋歐卡|逆流 (棄牌區基本水能量數 ×20，然後放回牌庫)
 *
 * 共 9 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';
import type { AttackPostFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 自身換場
// ══════════════════════════════════════════════════════════════════════════════
function selfSwapPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) {
      return addLog(state, `${label}：備戰區無寶可夢可互換`, aIdx);
    }
    const s = addLog(state, `${label}：選 1 隻備戰寶可夢與戰鬥場互換`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: 1,
      effectKey: 'self-swap-active-bench',
      params: { label },
    });
  };
}

// 自身下回合無法撤退（對手）— defCantRetreatNextPost equivalent inline
function defCantRetreatNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantRetreatNextTurn: true };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${label}：對手戰鬥寶可夢下回合無法撤退`, aIdx);
  };
}

// 自身棄 N 個能量（從尾端取）
function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const discardCount = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：自身丟棄 ${discardCount} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - discardCount);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - discardCount);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 流氓鱷ex|窮追不捨 — 80 + 對手下回合無法撤退
// ══════════════════════════════════════════════════════════════════════════════
regPre('流氓鱷ex|窮追不捨', (s) => ({ state: s, damage: 80 }));
regPost('流氓鱷ex|窮追不捨', defCantRetreatNextPost('窮追不捨'));

// ══════════════════════════════════════════════════════════════════════════════
// 2. 流氓鱷ex|強力啃咬 — 140 + 自身有道具 +140
// ══════════════════════════════════════════════════════════════════════════════
regPre('流氓鱷ex|強力啃咬', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const hasTool = !!a?.toolAttached;
  const dmg = 140 + (hasTool ? 140 : 0);
  const s = addLog(state, `強力啃咬：${hasTool ? '身上有道具 +140' : '無道具'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 拉普拉斯ex|水炮迴旋 — 水能量數 ×30 + 自身換場
// ══════════════════════════════════════════════════════════════════════════════
regPre('拉普拉斯ex|水炮迴旋', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 0 };
  let count = 0;
  for (const e of a.energyAttached) {
    if (pool.get(e.cardId)?.pokemonType === 'Water') count++;
  }
  const dmg = count * 30;
  const s = addLog(state, `水炮迴旋：自身水能量 ${count} 個 → ${count}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('拉普拉斯ex|水炮迴旋', selfSwapPost('水炮迴旋'));

// ══════════════════════════════════════════════════════════════════════════════
// 4. 千面避役|水射擊 — 110 + 自身棄 1 能量
// ══════════════════════════════════════════════════════════════════════════════
regPre('千面避役|水射擊', (s) => ({ state: s, damage: 110 }));
regPost('千面避役|水射擊', selfDiscardNEnergyPost(1, '水射擊'));

// ══════════════════════════════════════════════════════════════════════════════
// 5. 蒼炎刃鬼|煉獄斬 — 220 + 手牌 4 基本火能量丟棄；無法則失敗
// ══════════════════════════════════════════════════════════════════════════════
regPre('蒼炎刃鬼|煉獄斬', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const fireEnergies = player.hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Fire' || /【火】/.test(card.name));
  });
  if (fireEnergies.length < 4) {
    return { state: addLog(state, '煉獄斬：手牌不足 4 張基本【火】能量，招式失敗', aIdx), damage: 0 };
  }
  const toDisc = fireEnergies.slice(fireEnergies.length - 4);
  const toDiscIids = new Set(toDisc.map(c => c.iid));
  const s = addLog(state, '煉獄斬：丟棄手牌 4 張基本【火】能量', aIdx);
  return {
    state: updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscIids.has(c.iid)),
      discard: [...p.discard, ...toDisc],
    })),
    damage: 220,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 奇魯莉安|呼喚信號 — 0 + 從牌庫選 ≤3 寶可夢卡加手 + 重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('奇魯莉安|呼喚信號', (s) => ({ state: s, damage: 0 }));
regPost('奇魯莉安|呼喚信號', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) {
    return addLog(state, '呼喚信號：牌庫已空', aIdx);
  }
  const s = addLog(state, '呼喚信號：從牌庫挑 0~3 張寶可夢加手牌（重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 3,
    effectKey: 'wave5-add-pokemon-to-hand',
  });
});

regR('wave5-add-pokemon-to-hand', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(
      addLog(state, '呼喚信號：未選擇；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
    );
  }
  return updatePlayer(
    addLog(state, `呼喚信號：選 ${iids.length} 張寶可夢加手牌；重洗牌庫`, aIdx),
    aIdx, p => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 閃焰王牌|閃焰渦輪 — 50 + 從牌庫挑 ≤3 基本能量「以任意方式附給備戰」
// v3.49：原 max 限為 min(3, basicE, bench)；卡面是 ≤3（不限備戰數）+ 任意分配
// ══════════════════════════════════════════════════════════════════════════════
regPre('閃焰王牌|閃焰渦輪', (s) => ({ state: s, damage: 50 }));
regPost('閃焰王牌|閃焰渦輪', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const basicEnergies = player.deck.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (basicEnergies.length === 0 || player.bench.length === 0) {
    return addLog(state, '閃焰渦輪：牌庫無基本能量或備戰無寶可夢；重洗牌庫', aIdx);
  }
  // v3.49：上限 3（卡面），不再限制 ≤ bench.length
  const max = Math.min(3, basicEnergies.length);
  const s = addLog(state, `閃焰渦輪：從牌庫挑 0~${max} 張基本能量（將以任意方式分配給備戰寶可夢）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: max,
    effectKey: 'wave5-flame-turbo-attach',
  });
});

regR('wave5-flame-turbo-attach', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(
      addLog(state, '閃焰渦輪：未選擇能量；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
    );
  }
  // v3.49：選了能量 → 開 step2 energy-distribute 讓玩家任意分配給備戰寶可夢
  const player = state.players[aIdx];
  const validIids = player.bench.map(b => b.iid);
  if (validIids.length === 0) {
    // 防護：原本 step1 guard 已擋備戰=0，但跨回合可能變動
    return addLog(state, '閃焰渦輪：備戰已無寶可夢，能量留在牌庫；重洗', aIdx);
  }
  const s = addLog(state,
    `閃焰渦輪：選擇要將 ${iids.length} 張基本能量分別附到哪隻備戰寶可夢（可全部給同一隻）`, aIdx);
  return withPending(s, {
    type: 'energy-distribute',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: iids.length, maxCount: iids.length,
    effectKey: 'wave5-flame-turbo-distribute',
    params: {
      label: '閃焰渦輪',
      energyIids: iids,
      validIids,
      totalCount: iids.length,
      placedCount: 0,
      energyTypeName: '',
    },
  });
});

// v3.49：step2 resolver — 把選好的能量從牌庫移到指定備戰寶可夢身上，最後重洗剩餘牌庫
regR('wave5-flame-turbo-distribute', (state, aIdx, selectedIids, params, pool) => {
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []);
  if (selectedIids.length === 0 || energyIids.length === 0) {
    return updatePlayer(
      addLog(state, '閃焰渦輪：未分配；能量留在牌庫並重洗', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
    );
  }
  const useCount = Math.min(selectedIids.length, energyIids.length);
  let s: GameState = state;
  const tally = new Map<string, number>();
  for (let i = 0; i < useCount; i++) {
    const targetIid = selectedIids[i];
    const energyIid = energyIids[i];
    const p = s.players[aIdx];
    const energyInst = p.deck.find(c => c.iid === energyIid);
    if (!energyInst) continue;
    const target = p.bench.find(b => b.iid === targetIid);
    if (!target) continue;
    s = updatePlayer(s, aIdx, pl => ({
      ...pl,
      deck: pl.deck.filter(c => c.iid !== energyIid),
      bench: pl.bench.map(b => b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, energyInst] }
        : b),
    }));
    tally.set(targetIid, (tally.get(targetIid) ?? 0) + 1);
  }
  // 最後重洗牌庫（卡面：「並且重洗牌庫」）
  s = updatePlayer(s, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  const parts: string[] = [];
  for (const [iid, n] of tally) {
    const tInst = s.players[aIdx].bench.find(c => c.iid === iid);
    const name = tInst ? (pool.get(tInst.cardId)?.name ?? '?') : '?';
    parts.push(`${name}×${n}`);
  }
  return addLog(s, `閃焰渦輪：${parts.join('、')}（共 ${useCount} 張）；重洗牌庫`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 巨翅飛魚|呼朋引伴 — 0 + 從牌庫挑 ≤2 基礎寶可夢放備戰
// ══════════════════════════════════════════════════════════════════════════════
regPre('巨翅飛魚|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('巨翅飛魚|呼朋引伴', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) {
    return addLog(state, '呼朋引伴：牌庫已空', aIdx);
  }
  // 計算備戰剩餘空位（含零之大空洞下 8 上限的可能）
  const benchLimit = 5;  // 簡化用 5（getBenchLimit 在 engine，這裡保守取 5）
  const benchSpace = Math.max(0, benchLimit - player.bench.length);
  if (benchSpace === 0) {
    return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  }
  const max = Math.min(2, benchSpace);
  const s = addLog(state, `呼朋引伴：從牌庫挑 0~${max} 張基礎寶可夢放備戰；重洗`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: max,
    effectKey: 'wave5-place-basic-bench',
  });
});

regR('wave5-place-basic-bench', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(
      addLog(state, '呼朋引伴：未選擇；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
    );
  }
  return updatePlayer(
    addLog(state, `呼朋引伴：${iids.length} 隻基礎寶可夢放置於備戰；重洗牌庫`, aIdx),
    aIdx, p => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      const newBench = [
        ...p.bench,
        ...picked.map(c => ({ ...c, justPlaced: true, damage: 0 })),
      ];
      return { ...p, deck: shuffle(rest), bench: newBench };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 蓋歐卡|逆流 — 棄牌區所有基本【水】能量數 ×20，然後放回牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('蓋歐卡|逆流', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // 找棄牌區所有基本水能量
  const waterEnergies = player.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Water' || /【水】/.test(card.name));
  });
  const dmg = waterEnergies.length * 20;
  const s = addLog(state, `逆流：棄牌區基本【水】能量 ${waterEnergies.length} 張 → ${waterEnergies.length}×20 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

regPost('蓋歐卡|逆流', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const waterIids: string[] = [];
  for (const c of player.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic'
        && (card.pokemonType === 'Water' || /【水】/.test(card.name))) {
      waterIids.push(c.iid);
    }
  }
  if (waterIids.length === 0) return state;
  const set = new Set(waterIids);
  return updatePlayer(
    addLog(state, `逆流：將 ${waterIids.length} 張基本【水】能量從棄牌區放回牌庫並重洗`, aIdx),
    aIdx, p => {
      const moved = p.discard.filter(c => set.has(c.iid));
      const rest = p.discard.filter(c => !set.has(c.iid));
      return { ...p, discard: rest, deck: shuffle([...p.deck, ...moved]) };
    },
  );
});

// 輔助：unused import 防護
export type _v2550Sentinel = PlayerState;
type _CIT = CardInstance;
