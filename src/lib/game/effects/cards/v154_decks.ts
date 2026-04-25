/**
 * v2.154 — 9 組新預組（土龍多龍 / 大竺葵 / 太陽伊布 / 巨金怪 / 水牛超級袋獸 /
 *   莉莉艾的皮皮 / 超級妙蛙花 / 超級袋獸阿勃梭魯 / 青銅鐘多龍）的特性 + 訓練家實裝
 *
 * 引擎側已處理（直接 inline 在 engine.ts 或 effects.ts 的 PASSIVE_*）：
 *   - 捲牆（爆炸頭水牛）— engine.ts 戰傷階段加 inline 檢查（場上 ≥2 + 【無】基礎 → -60）
 *   - 鈷藍指令（鐵頭殼ex）— PASSIVE_ATTACK_BONUS map（自己未來 +20，鐵頭殼ex 除外）
 *
 * 本檔內含：
 *   - 日光轉移（超級妙蛙花ex）— regA 不限次：移自己場上某寶可夢的基本【草】能量到另一隻
 *   - 金屬製造者（金屬怪）— regA 1 回 1 次：peek top 4，選任意數量基本【鋼】能量附寶
 *   - 玻璃喇叭（Trainer Item）— gate 太晶在場 + 自己備戰【無】寶 ≥1 + 棄牌有基本能量
 *   - 超大冰淇淋（Trainer Item）— 戰鬥寶身上 ≥3 能量 → 回 80 HP
 */

import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regA,
  addLog, updatePlayer, withPending,
  shuffle,
} from '../_shared';
import { isBasicEnergyOfType, totalEnergyUnits } from '../../engine';

// ══════════════════════════════════════════════════════════════════════════════
// 超級妙蛙花ex｜日光轉移（特性，不限次）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時，可不限次數使用。選擇 1 個自己的場上寶可夢身上附加的
//   『基本【草】能量』，改附於自己的其他寶可夢身上。」
//
// 兩步流程：
//   Step 1：bench-choose（含 active）— 選來源寶可夢（必須有基本草能量）
//   Step 2：bench-choose — 選目標寶可夢（不能是來源同一隻）
//   Resolver：把來源的 1 張基本草能量 auto-pick 移到目標
regG('超級妙蛙花ex', (st, idx, pool) => {
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  return all.some(c => c.energyAttached.some(e => isBasicEnergyOfType(pool.get(e.cardId), 'Grass')));
});
regA('超級妙蛙花ex', 0, (st, idx, pool) => {
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  const sourceIids = all
    .filter(c => c.energyAttached.some(e => isBasicEnergyOfType(pool.get(e.cardId), 'Grass')))
    .map(c => c.iid);
  if (sourceIids.length === 0) return addLog(st, '日光轉移：場上無寶可夢附有基本【草】能量', idx);
  if (all.length < 2) return addLog(st, '日光轉移：場上至少要 2 隻寶可夢', idx);
  let s = addLog(st, '日光轉移：選擇移出能量的寶可夢（來源）', idx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'sunlight-transfer-source',
    params: {
      validIids: sourceIids,
      titleOverride: '日光轉移 (1/2)：選擇要移出基本【草】能量的寶可夢',
    },
  });
});
regR('sunlight-transfer-source', (st, idx, iids, _params, pool) => {
  if (iids.length !== 1) return st;
  const sourceIid = iids[0];
  // Step 2：選目標（不能與 source 相同）
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  const targetIids = all.filter(c => c.iid !== sourceIid).map(c => c.iid);
  if (targetIids.length === 0) return addLog(st, '日光轉移：場上沒有其他寶可夢可附', idx);
  let s = addLog(st, '日光轉移：選擇接收能量的寶可夢（目標）', idx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'sunlight-transfer-target',
    params: {
      validIids: targetIids,
      sourceIid,
      titleOverride: '日光轉移 (2/2)：選擇接收能量的寶可夢',
    },
  });
});
regR('sunlight-transfer-target', (st, idx, iids, params, pool) => {
  if (iids.length !== 1) return st;
  const targetIid = iids[0];
  const sourceIid = params?.sourceIid as string | undefined;
  if (!sourceIid) return st;
  let s = updatePlayer(st, idx, p => {
    // 找來源，移 1 張基本草能量
    const moveOne = (poke: CardInstance): { poke: CardInstance; energy: CardInstance | null } => {
      const grassIdx = poke.energyAttached.findIndex(e => isBasicEnergyOfType(pool.get(e.cardId), 'Grass'));
      if (grassIdx < 0) return { poke, energy: null };
      const energy = poke.energyAttached[grassIdx];
      const newE = poke.energyAttached.filter((_, i) => i !== grassIdx);
      return { poke: { ...poke, energyAttached: newE }, energy };
    };
    const attachOne = (poke: CardInstance, energy: CardInstance): CardInstance => ({
      ...poke,
      energyAttached: [...poke.energyAttached, energy],
    });
    let energyMoved: CardInstance | null = null;
    let newActive = p.active;
    let newBench = p.bench;
    // 移出 source 的 1 張草
    if (p.active?.iid === sourceIid) {
      const r = moveOne(p.active);
      newActive = r.poke;
      energyMoved = r.energy;
    } else {
      newBench = p.bench.map(b => {
        if (b.iid !== sourceIid || energyMoved) return b;
        const r = moveOne(b);
        energyMoved = r.energy;
        return r.poke;
      });
    }
    if (!energyMoved) return p;  // 無能量可移（不應發生但防呆）
    // 附到 target
    if (newActive?.iid === targetIid) {
      newActive = attachOne(newActive, energyMoved);
    } else {
      newBench = newBench.map(b => b.iid === targetIid ? attachOne(b, energyMoved!) : b);
    }
    return { ...p, active: newActive, bench: newBench };
  });
  // log target name
  const all = [s.players[idx].active, ...s.players[idx].bench].filter((c): c is CardInstance => !!c);
  const sourceCard = all.find(c => c.iid === sourceIid);
  const targetCard = all.find(c => c.iid === targetIid);
  const sname = sourceCard ? pool.get(sourceCard.cardId)?.name ?? '?' : '?';
  const tname = targetCard ? pool.get(targetCard.cardId)?.name ?? '?' : '?';
  return addLog(s, `日光轉移：將 1 張基本【草】能量從 ${sname} 移到 ${tname}`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 金屬怪｜金屬製造者（特性，1 回 1 次）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時可使用 1 次。查看自己的牌庫上方 4 張卡，
//   從其中選擇任意數量的『基本【鋼】能量』卡，以任意方式附於自己的寶可夢身上。
//   將剩餘卡全部翻回反面並重洗，放回牌庫下方。」
//
// 簡化策略：自動把選的鋼能量附到自己的【鋼】寶可夢（active 優先，否則 bench）
//   不開額外目標選擇 modal。剩餘卡洗一洗放牌庫底。
regG('金屬怪', (st, idx) => {
  return st.players[idx].deck.length > 0;
});
regA('金屬怪', 0, (st, idx, pool) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '金屬製造者：牌庫為空', idx);
  // 場上必須有【鋼】寶可夢可附
  const metalPokes = [p.active, ...p.bench].filter((c): c is CardInstance => {
    if (!c) return false;
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Metal';
  });
  if (metalPokes.length === 0) return addLog(st, '金屬製造者：場上無【鋼】寶可夢', idx);
  const top4 = p.deck.slice(0, 4);
  const top4Iids = top4.map(c => c.iid);
  let s = addLog(st, `金屬製造者：查看牌庫上方 ${top4.length} 張，選任意數量基本【鋼】能量`, idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicMetalEnergy:TOP4',
    minCount: 0, maxCount: top4.length,
    effectKey: 'metal-maker-attach',
    params: {
      top4Iids,
      titleOverride: '金屬製造者：選任意數量基本【鋼】能量附寶可夢（剩餘洗到牌庫底）',
    },
  });
});
regR('metal-maker-attach', (st, idx, energyIids, params, pool) => {
  const top4Iids = (params?.top4Iids as string[]) ?? [];
  let s = updatePlayer(st, idx, p => {
    const top4 = p.deck.filter(c => top4Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top4Iids.includes(c.iid));
    // 驗證選的卡是基本【鋼】能量
    const validEnergies = top4.filter(c => energyIids.includes(c.iid) && isBasicEnergyOfType(pool.get(c.cardId), 'Metal'));
    const leftover = top4.filter(c => !validEnergies.some(e => e.iid === c.iid));
    // 把選的鋼能量自動附到 active（如果是 Metal），否則 bench 第 1 隻 Metal
    let newActive = p.active;
    let newBench = p.bench;
    if (validEnergies.length > 0) {
      const pickTarget = (): { isActive: boolean; idx: number } | null => {
        if (newActive && pool.get(newActive.cardId)?.pokemonType === 'Metal') {
          return { isActive: true, idx: 0 };
        }
        const benchIdx = newBench.findIndex(b => pool.get(b.cardId)?.pokemonType === 'Metal');
        if (benchIdx >= 0) return { isActive: false, idx: benchIdx };
        return null;
      };
      const t = pickTarget();
      if (t) {
        if (t.isActive && newActive) {
          newActive = { ...newActive, energyAttached: [...newActive.energyAttached, ...validEnergies] };
        } else {
          newBench = newBench.map((b, i) => i === t.idx ? { ...b, energyAttached: [...b.energyAttached, ...validEnergies] } : b);
        }
      }
    }
    // 剩餘 + 牌庫其餘 — leftover 放牌庫底（洗一洗），rest 放回原位
    const newDeck = [...rest, ...shuffle(leftover)];
    return { ...p, active: newActive, bench: newBench, deck: newDeck };
  });
  if (energyIids.length === 0) {
    return addLog(s, '金屬製造者：未選擇能量（4 張全洗回牌庫底）', idx);
  }
  return addLog(s, `金屬製造者：選 ${energyIids.length} 張基本【鋼】能量附寶可夢，剩餘洗回牌庫底`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 超大冰淇淋（Item）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將自己的身上附有 3 個以上能量的戰鬥寶可夢恢復『80』HP。」
regG('超大冰淇淋', (st, idx, pool) => {
  const active = st.players[idx].active;
  if (!active) return false;
  return totalEnergyUnits(active, pool) >= 3;
});
reg('超大冰淇淋', (st, idx, pool) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '超大冰淇淋：戰鬥位無寶可夢', idx);
  if (totalEnergyUnits(p.active, pool) < 3) {
    return addLog(st, '超大冰淇淋：戰鬥寶可夢身上不足 3 個能量', idx);
  }
  const name = pool.get(p.active.cardId)?.name ?? '?';
  return updatePlayer(addLog(st, `超大冰淇淋：${name} 回復 80 HP`, idx), idx, pl => {
    if (!pl.active) return pl;
    return { ...pl, active: { ...pl.active, damage: Math.max(0, pl.active.damage - 80) } };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 玻璃喇叭（Item）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「這張卡只有在自己的場上有『太晶』寶可夢時才可使用。
//   選擇最多 2 隻自己的備戰區的【無】寶可夢，從棄牌區附給那些寶可夢各 1 張基本能量卡。」
//
// 簡化：用 discard-search 選 ≤2 張基本能量；resolver 自動分配給 bench 上的【無】寶可夢
//   （AI 友善 — 不再開 bench-choose 二次 modal）
regG('玻璃喇叭', (st, idx, pool) => {
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  const hasTera = all.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
  if (!hasTera) return false;
  // 至少 1 隻【無】備戰
  const colorlessBench = st.players[idx].bench.filter(b => pool.get(b.cardId)?.pokemonType === 'Colorless');
  if (colorlessBench.length === 0) return false;
  // 棄牌區至少 1 張基本能量
  const basicEnergyDiscard = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  return basicEnergyDiscard;
});
reg('玻璃喇叭', (st, idx, pool) => {
  const colorlessBench = st.players[idx].bench.filter(b => pool.get(b.cardId)?.pokemonType === 'Colorless');
  if (colorlessBench.length === 0) return addLog(st, '玻璃喇叭：備戰無【無】寶可夢', idx);
  const max = Math.min(2, colorlessBench.length);
  const energyCount = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }).length;
  if (energyCount === 0) return addLog(st, '玻璃喇叭：棄牌區無基本能量', idx);
  let s = addLog(st, `玻璃喇叭：從棄牌區選 ≤${Math.min(max, energyCount)} 張基本能量附給【無】備戰`, idx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: Math.min(max, energyCount),
    effectKey: 'glass-trumpet-attach',
    params: { titleOverride: '玻璃喇叭：選 ≤2 張基本能量附給備戰【無】寶可夢' },
  });
});
regR('glass-trumpet-attach', (st, idx, energyIids, _params, pool) => {
  if (energyIids.length === 0) return addLog(st, '玻璃喇叭：未選擇能量', idx);
  let s = updatePlayer(st, idx, p => {
    const energies = p.discard.filter(c => energyIids.includes(c.iid));
    const newDiscard = p.discard.filter(c => !energyIids.includes(c.iid));
    // 自動分配到備戰【無】寶可夢（按順序，每隻最多 1 張）
    const colorlessBenchIdx = p.bench
      .map((b, i) => ({ b, i, type: pool.get(b.cardId)?.pokemonType }))
      .filter(x => x.type === 'Colorless')
      .map(x => x.i);
    const newBench = [...p.bench];
    for (let k = 0; k < energies.length && k < colorlessBenchIdx.length; k++) {
      const benchI = colorlessBenchIdx[k];
      newBench[benchI] = {
        ...newBench[benchI],
        energyAttached: [...newBench[benchI].energyAttached, energies[k]],
      };
    }
    return { ...p, discard: newDiscard, bench: newBench };
  });
  return addLog(s, `玻璃喇叭：將 ${energyIids.length} 張基本能量附給備戰【無】寶可夢`, idx);
});
