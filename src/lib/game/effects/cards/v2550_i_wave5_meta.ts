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
import { countEnergyTypeHostAware } from '../../effects';
import { defCantRetreatNextPost } from '../../effects'; // v5.802 中央禁撤退(免疫gate)
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
// v5.802：本地 defCantRetreatNextPost 移除，改用 effects.ts 中央版(含免疫 gate)。

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
  // v5.688：改用中央 countEnergyTypeHostAware — 認列古舊/稜鏡等「視為水」特殊能量。
  const count = countEnergyTypeHostAware(a, 'Water', pool);
  const dmg = count * 30;
  const s = addLog(state, `水炮迴旋：自身水能量 ${count} 個 → ${count}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('拉普拉斯ex|水炮迴旋', selfSwapPost('水炮迴旋'));

// ══════════════════════════════════════════════════════════════════════════════
// 4. 千面避役|水射擊 — 110 + 自身棄 1 能量
// ══════════════════════════════════════════════════════════════════════════════
regPre('千面避役|水射擊', (s) => ({ state: s, damage: 110 }));
// v5.397：千面避役|水射擊 改由 effects.ts registerSelfDiscardMultiply 處理(units+picker)；移除此重複 regPost(原本會多丟1張 double-discard)

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
// 卡面：「從自己的牌庫選擇最多 3 張基本能量卡，將其展示給對手看，以任意方式
//        附於自己的備戰寶可夢身上 並且重洗牌庫」
// v3.49：原 max 限為 min(3, basicE, bench)；卡面是 ≤3（不限備戰數）+ 任意分配
// v3.57：玩家回報 — 選了不同屬性能量（如水1+鬥2）時，UI 應該按屬性分波詢問
//        （水一波、鬥一波，每波 +/- counter）。改用通用 v158-energy-chain-start
//        helper（source='deck' 自動 reshuffle、scope='bench-only' 限備戰、
//        混屬性自動走 v3.57 加的「按屬性分波」path、同屬性走原本 +/- counter
//        快徑、單目標自動全附）。移除自製 wave5-flame-turbo-* resolver。
// ══════════════════════════════════════════════════════════════════════════════
regPre('閃焰王牌|閃焰渦輪', (s) => ({ state: s, damage: 50 }));
regPost('閃焰王牌|閃焰渦輪', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const basicEnergies = player.deck.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (basicEnergies.length === 0 || player.bench.length === 0) {
    // v5.495：牌庫非空時仍開 deck-search picker 讓玩家檢視整副牌庫 + 重洗（PTCG 隱藏資訊規則：
    //   「搜尋牌庫」即使無可附加目標也要讓玩家看過牌庫、對手知道搜尋過）。filter:'any' 顯示全牌庫、
    //   maxCount:0 只能檢視（deck-search 一律可【不選】不卡死），確認後 search-to-hand-reshuffle 重洗。
    if (player.deck.length === 0) return addLog(state, '閃焰渦輪：牌庫已空', aIdx);
    const sv = addLog(state, '閃焰渦輪：牌庫無基本能量或備戰無寶可夢；檢視牌庫後重洗', aIdx);
    return withPending(sv, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'any', minCount: 0, maxCount: 0,
      effectKey: 'search-to-hand-reshuffle',
      params: { label: '閃焰渦輪（檢視牌庫）' },
    });
  }
  const max = Math.min(3, basicEnergies.length);
  const s = addLog(state, `閃焰渦輪：從牌庫挑 0~${max} 張基本能量（任意方式分配給備戰寶可夢）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: max,
    effectKey: 'v158-energy-chain-start',
    params: {
      label: '閃焰渦輪',
      source: 'deck',
      scope: 'bench-only',
      filterType: 'Any',
    },
  });
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
