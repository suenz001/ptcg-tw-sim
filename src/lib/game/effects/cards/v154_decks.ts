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
import { hasEffectivePokemonType } from '../../effects';  // v6.208 中央「場上有效屬性」述詞（化石在場上是【無】）
import {
  reg, regR, regG, regA,
  addLog, updatePlayer, withPending,
  shuffle,
  deckWithCardsToBottom, rejectAbilityUse } from '../_shared';
import { isBasicEnergyOfType, totalEnergyUnits } from '../../engine';
import { startEnergyChain } from './v158_energy_chain';

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
// v6.131 移除死碼：regG 只有 canPlayTrainer（出訓練家卡）會查；超級妙蛙花ex 是**寶可夢**，
//   特性 gate 走 engine 的 getUsableAbilities（'日光轉移'，同版已補上「場上需 ≥2 隻」）。
regA('超級妙蛙花ex', 0, (st, idx, pool) => {
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  const sourceIids = all
    .filter(c => c.energyAttached.some(e => isBasicEnergyOfType(pool.get(e.cardId), 'Grass')))
    .map(c => c.iid);
  if (sourceIids.length === 0) return rejectAbilityUse(st, '日光轉移：場上無寶可夢附有基本【草】能量', idx);
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
// v2.158：升級為玩家自選分配 — top 4 leftover 仍洗回牌庫底；選的鋼能量先暫存到
//   discard 然後呼叫 v158 chain，玩家逐張選自己的【鋼】寶可夢（active+bench）。
// v6.131 移除死碼：`regG` 註冊進 TRAINER_GUARDS，只有 canPlayTrainer（出訓練家卡）會查。
//   金屬怪是**寶可夢**，它的特性 gate 走 engine 的 getUsableAbilities ⇒ 這條永遠不會被呼叫。
//   （deck > 0 的條件 engine 那邊本來就有。）新增 lint Check Y 防再犯。
regA('金屬怪', 0, (st, idx, _pool) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return rejectAbilityUse(st, '金屬製造者：牌庫為空', idx);
  // v4.29：移除「場上必須有【鋼】寶可夢」誤限制 — 卡面：「以任意方式附於自己的
  //   寶可夢身上」沒屬性限制，玩家可附給任何自己場上的寶可夢（含【無】等）。
  //   gate 只需 deck>0 即可；active 一定存在所以場上必有目標。
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
  // v2.158：升級為玩家自選分配
  //   1. top 4 中沒選的洗回牌庫底（不變）
  //   2. 選的鋼能量先暫存到 discard
  //   3. 呼叫 v158 chain 讓玩家逐張選【鋼】寶可夢分配
  const top4Iids = (params?.top4Iids as string[]) ?? [];
  let s = updatePlayer(st, idx, p => {
    const top4 = p.deck.filter(c => top4Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top4Iids.includes(c.iid));
    // 驗證選的卡是基本【鋼】能量
    const validEnergies = top4.filter(c => energyIids.includes(c.iid) && isBasicEnergyOfType(pool.get(c.cardId), 'Metal'));
    const leftover = top4.filter(c => !validEnergies.some(e => e.iid === c.iid));
    // leftover（top4 中沒選的）洗一洗放牌庫底；選的能量暫存 discard
    return {
      ...p,
      // v6.124 收斂：卡面「將剩餘卡全部翻回反面並重洗，放回牌庫下方」（只洗那 4 張裡沒選的）
      deck: deckWithCardsToBottom(rest, leftover, 'shuffled'),
      discard: [...p.discard, ...validEnergies],
    };
  });
  if (energyIids.length === 0) {
    return addLog(s, '金屬製造者：未選擇能量（4 張全洗回牌庫底）', idx);
  }
  // 啟動 chain — source='discard'（已搬好），scope='any-own'
  // v4.29：filterType 'Metal' → 'Any'（卡面無限制屬性，可附給任何自己寶可夢，含【無】）
  return startEnergyChain(s, idx, energyIids, {
    label: '金屬製造者',
    source: 'discard',
    scope: 'any-own',
    filterType: 'Any',
  }, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 超大冰淇淋（Item）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將自己的身上附有 3 個以上能量的戰鬥寶可夢恢復『80』HP。」
// v2.263：修 sim crash — totalEnergyUnits 第 1 參數是 CardInstance[] (energyAttached)，
//   原本傳整個 active CardInstance 會在 for...of 時 throw "not iterable"。
regG('超大冰淇淋', (st, idx, pool) => {
  const active = st.players[idx].active;
  if (!active) return false;
  // v5.251：補 damage > 0 gate — 滿血時無治療效果不可使用 (PDF §II-E-1-k-iv)
  if (active.damage <= 0) return false;
  return totalEnergyUnits(active.energyAttached, pool, st, idx, active) >= 3;
});
reg('超大冰淇淋', (st, idx, pool) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '超大冰淇淋：戰鬥位無寶可夢', idx);
  // v5.251：defensive gate — 滿血時無效果
  if (p.active.damage <= 0) {
    return addLog(st, '超大冰淇淋：戰鬥寶可夢已滿血，無治療對象', idx);
  }
  if (totalEnergyUnits(p.active.energyAttached, pool, st, idx, p.active) < 3) {
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
// v2.158：升級為玩家自選分配 — 玩家逐張選備戰【無】寶可夢分配（v5.228 起走本檔的專屬 resolver，
//   ⚠ v6.208 更正：舊註解寫「用 v158-energy-chain filterType='Colorless'」，全站早已沒有這個用法）。
// ⭐ v6.208：卡面「自己的**備戰區的【無】寶可夢**」＝場上有效屬性 ⇒ 化石（在場上是【無】）也算。
regG('玻璃喇叭', (st, idx, pool) => {
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  const hasTera = all.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
  if (!hasTera) return false;
  // 至少 1 隻【無】備戰
  const colorlessBench = st.players[idx].bench.filter(b => hasEffectivePokemonType(st, idx, b, pool.get(b.cardId), pool, 'Colorless'));
  if (colorlessBench.length === 0) return false;
  // 棄牌區至少 1 張基本能量
  const basicEnergyDiscard = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  return basicEnergyDiscard;
});
reg('玻璃喇叭', (st, idx, pool) => {
  const colorlessBench = st.players[idx].bench.filter(b => hasEffectivePokemonType(st, idx, b, pool.get(b.cardId), pool, 'Colorless'));
  if (colorlessBench.length === 0) return addLog(st, '玻璃喇叭：備戰無【無】寶可夢', idx);
  const max = Math.min(2, colorlessBench.length);
  const energyCount = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }).length;
  if (energyCount === 0) return addLog(st, '玻璃喇叭：棄牌區無基本能量', idx);
  const s = addLog(st, `玻璃喇叭：從棄牌區選 ≤${Math.min(max, energyCount)} 張基本能量（接著逐張選備戰【無】目標）`, idx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: Math.min(max, energyCount),
    // v5.228：改用專屬 resolver 強制「每隻備戰最多 1 張」(卡面「各 1 張」)
    effectKey: 'glass-trumpet-start',
    params: { label: '玻璃喇叭' },
  });
});

// v5.228 glass-trumpet-start: 玩家挑完 0-2 張基本能量後，逐張開 picker 附給不同【無】備戰
//   pickedIids = 玩家挑的能量 iid 陣列（仍在 discard 中）
regR('glass-trumpet-start', (st, idx, pickedIids, _params, pool) => {
  if (pickedIids.length === 0) return addLog(st, '玻璃喇叭：未挑選能量', idx);
  return openGlassTrumpetPicker(st, idx, pickedIids, [], pool);
});

// v5.228 glass-trumpet-attach: picker 選 1 隻【無】備戰 → 附 1 張能量 → 開下一個
//   params: { energyIid, remaining, usedTargetIids }
regR('glass-trumpet-attach', (st, idx, iids, params, pool) => {
  if (iids.length === 0) return addLog(st, '玻璃喇叭：未選目標', idx);
  const energyIid = String(params?.energyIid ?? '');
  const remaining = (params?.remaining as string[]) ?? [];
  const usedTargetIids = (params?.usedTargetIids as string[]) ?? [];
  const targetIid = iids[0];

  // 附 1 張能量
  const target = st.players[idx].bench.find(b => b.iid === targetIid);
  const energy = st.players[idx].discard.find(e => e.iid === energyIid);
  if (!target || !energy) {
    return addLog(st, '玻璃喇叭：目標或能量遺失，略過', idx);
  }
  st = updatePlayer(st, idx, p => ({
    ...p,
    discard: p.discard.filter(e => e.iid !== energyIid),
    bench: p.bench.map(b => b.iid === targetIid
      ? { ...b, energyAttached: [...b.energyAttached, energy] }
      : b),
  }));
  const tname = pool.get(target.cardId)?.name ?? '?';
  const ename = pool.get(energy.cardId)?.name ?? '能量';
  st = addLog(st, `玻璃喇叭：將「${ename}」附到 ${tname}`, idx);

  // 還有剩餘能量 → 開下一個 picker，排除已用 target
  const newUsed = [...usedTargetIids, targetIid];
  if (remaining.length === 0) return st;
  return openGlassTrumpetPicker(st, idx, remaining, newUsed, pool);
});

function openGlassTrumpetPicker(
  st: GameState,
  idx: 0 | 1,
  remainingEnergies: string[],
  usedTargetIids: string[],
  pool: Map<string, Card>,
): GameState {
  // 候選備戰 = 【無】屬性 + 不在 usedTargetIids 內
  const candidates = st.players[idx].bench.filter(b => {
    if (usedTargetIids.includes(b.iid)) return false;
    return hasEffectivePokemonType(st, idx, b, pool.get(b.cardId), pool, 'Colorless');
  });
  if (candidates.length === 0) {
    return addLog(st,
      `玻璃喇叭：場上已無可附【無】備戰（剩 ${remainingEnergies.length} 張能量留在棄牌區）`,
      idx);
  }
  const nextEnergyIid = remainingEnergies[0];
  const rest = remainingEnergies.slice(1);
  const energyInst = st.players[idx].discard.find(e => e.iid === nextEnergyIid);
  const ename = energyInst ? (pool.get(energyInst.cardId)?.name ?? '能量') : '能量';
  return withPending(
    addLog(st, `玻璃喇叭：選 1 隻【無】備戰附「${ename}」（剩 ${remainingEnergies.length} 張待附）`, idx),
    {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'glass-trumpet-attach',
      params: {
        energyIid: nextEnergyIid,
        remaining: rest,
        usedTargetIids,
        validIids: candidates.map(c => c.iid),
        titleOverride: `玻璃喇叭：將「${ename}」附到哪一隻【無】備戰？`,
      },
    },
  );
}
