/**
 * v2.149 — 4 組新預組（超級長耳兔 / 蜜集大蛇 / 火伊布 / 祭典樂舞）的特性實裝
 *
 * 內含：
 *   - 熟成充能（蜜集大蛇ex）：1 回 1 次，手牌 1 張基本【草】能量附寶可夢 + 回 30 HP
 *   - 衝衝鼓（啪咚猴）：戰鬥位有「祭典樂舞」特性 → 1 回 1 次，從牌庫選 1 張卡加手牌 + 重洗
 *   - 搜尋寶石（貓頭夜鷹）：進化的當回合，若場上有「太晶」寶可夢 → 從牌庫選 ≤2 張訓練家
 *   - 祭典樂舞（裹蜜蟲/角金魚/金魚王/綿綿泡芙）：被動，場上有祭典會場 → 招式可使用 2 次
 *     簡化實作：第 1 次招式打完後，若條件成立，turnPhase 不切到 'end'，玩家可再 attack 一次
 *
 * 引擎側已處理：
 *   - 提升進化（伊布）— EVOLVE handler / getEvolvableTargets bypass isFirstTurn + justPlaced
 *   - 虹色DNA（伊布ex）— EVOLVE handler / getEvolvableTargets 從伊布進化的 ex 可放此寶
 *   - 璀璨結晶（Tool ACE SPEC）— canAffordAttack 太晶 -1 能量
 */

import type { CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regA,
  addLog, updatePlayer, withPending,
  shuffle,
} from '../_shared';
import { isBasicEnergyOfType } from '../../engine';

// ══════════════════════════════════════════════════════════════════════════════
// 蜜集大蛇ex｜熟成充能（特性）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時可使用 1 次。從自己的手牌選擇 1 張『基本【草】能量』卡，
//   附於自己的寶可夢身上。然後，將附上那張卡的寶可夢恢復 30 HP。」
//
// 流程：
//   1) regA gate: 手牌有基本【草】能量 + 場上有寶可夢
//   2) reg: auto-pick 第 1 張基本【草】能量（其實大多數玩家也只有同種能量），
//          開 heal-target 讓玩家選附加目標
//   3) resolver: 把指定能量從手牌移到目標寶可夢 + 該寶可夢回血 30
regA('蜜集大蛇ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const grassIdx = p.hand.findIndex(c => isBasicEnergyOfType(pool.get(c.cardId), 'Grass'));
  if (grassIdx < 0) return addLog(st, '熟成充能：手牌無基本【草】能量', idx);
  if (!p.active && p.bench.length === 0) return addLog(st, '熟成充能：場上無寶可夢', idx);
  const energyInst = p.hand[grassIdx];
  let s = addLog(st, '熟成充能：選 1 隻寶可夢，附上基本【草】能量並回 30 HP', idx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'serperior-mature-charge',
    params: { energyIid: energyInst.iid, titleOverride: '熟成充能：選擇要附能量+回 30 HP 的寶可夢' },
  });
});

regR('serperior-mature-charge', (st, idx, iids, params, pool) => {
  if (iids.length !== 1) return st;
  const targetIid = iids[0];
  const energyIid = params?.energyIid as string;
  if (!energyIid) return st;
  let s = updatePlayer(st, idx, p => {
    const energyInstIdx = p.hand.findIndex(c => c.iid === energyIid);
    if (energyInstIdx < 0) return p;
    const energy = p.hand[energyInstIdx];
    const newHand = p.hand.filter((_, i) => i !== energyInstIdx);
    const attachAndHeal = (poke: CardInstance): CardInstance => ({
      ...poke,
      energyAttached: [...poke.energyAttached, energy],
      damage: Math.max(0, poke.damage - 30),
    });
    if (p.active?.iid === targetIid) {
      return { ...p, hand: newHand, active: attachAndHeal(p.active) };
    }
    return {
      ...p,
      hand: newHand,
      bench: p.bench.map(b => b.iid === targetIid ? attachAndHeal(b) : b),
    };
  });
  // log target name
  const all = [s.players[idx].active, ...s.players[idx].bench].filter((c): c is CardInstance => !!c);
  const target = all.find(c => c.iid === targetIid);
  const tname = target ? pool.get(target.cardId)?.name ?? '?' : '?';
  return addLog(s, `熟成充能：將基本【草】能量附於 ${tname}，回復 30 HP`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 啪咚猴｜衝衝鼓（特性）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若自己的戰鬥寶可夢為擁有特性『祭典樂舞』的寶可夢，則在自己的回合時可使用 1 次。
//   從自己的牌庫任意選擇 1 張卡加入手牌。並且重洗牌庫。」
//
// gate：active.cardId.abilities 含 name='祭典樂舞'
regG('啪咚猴', (st, idx, pool) => {
  const active = st.players[idx].active;
  if (!active) return false;
  const card = pool.get(active.cardId);
  return !!card?.abilities?.some(a => a.name === '祭典樂舞');
});
regA('啪咚猴', 0, (st, idx, pool) => {
  const active = st.players[idx].active;
  if (!active) return st;
  const card = pool.get(active.cardId);
  if (!card?.abilities?.some(a => a.name === '祭典樂舞')) {
    return addLog(st, '衝衝鼓：戰鬥位不是祭典樂舞寶可夢', idx);
  }
  if (st.players[idx].deck.length === 0) {
    return addLog(st, '衝衝鼓：牌庫為空', idx);
  }
  let s = addLog(st, '衝衝鼓：從牌庫選 1 張卡加入手牌（重洗）', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Any',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 貓頭夜鷹｜搜尋寶石（特性 — 進化時觸發）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，若自己的場上有『太晶』寶可夢，
//   則可使用 1 次。從自己的牌庫選擇最多 2 張訓練家卡，在給對手看過後加入手牌。並且重洗牌庫。」
//
// Gate：
//   - cardInst.evolvedThisTurn (本回合剛從手牌使出進化)
//   - 場上有寶可夢身上有 '太晶' tag
//
// 註：engine.ts getUsableAbilities 對 evolvedThisTurn 有預設不允許的閘門，需在
//   引擎側加白名單（同 合金建造 / 鋁鋼橋龍ex pattern）。我們在 effects.ts 註冊的
//   regA 是「能解析這個特性」，但 engine 的 evolveThisTurn whitelist 必須包括
//   '搜尋寶石'。本 v2.149 在 engine.ts:1612 附近加白名單擴充。
regA('貓頭夜鷹', 0, (st, idx, pool, cardInst) => {
  if (!cardInst?.evolvedThisTurn) {
    return addLog(st, '搜尋寶石：只能在從手牌使出並進化的當回合使用', idx);
  }
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  const hasTera = all.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
  if (!hasTera) {
    return addLog(st, '搜尋寶石：自己場上無「太晶」寶可夢', idx);
  }
  if (st.players[idx].deck.length === 0) {
    return addLog(st, '搜尋寶石：牌庫為空', idx);
  }
  const max = Math.min(2, st.players[idx].deck.length);
  let s = addLog(st, `搜尋寶石：從牌庫選 ≤${max} 張訓練家卡加入手牌（重洗）`, idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'AnyTrainer',
    minCount: 0, maxCount: max,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 祭典樂舞（裹蜜蟲 / 角金魚 / 金魚王 / 綿綿泡芙 — 被動）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若場上有『祭典會場』，則這隻寶可夢可使用持有的招式 2 次。
//   （若對手的戰鬥寶可夢因第 1 次的招式而【昏厥】了，則在下一隻寶可夢放置後，
//   使用第 2 次的招式。）」
//
// 簡化實裝：
//   引擎 ATTACK handler 末尾，若 attacker 有 '祭典樂舞' 特性 + 場上有 '祭典會場'
//   + 還沒做過第 2 次 → 將 turnPhase 保持 'main' 並設 flag festivalDanceUsed[aIdx]=true
//   讓玩家能再打一次同隻寶可夢。第 2 次打完正常切 'end'。END_TURN 重置 flag。
//   詳細處理見 engine.ts ATTACK handler 末尾 + types.ts。
//
// 此檔不註冊 regA — 純被動，attack flow 直接讀 ability。

// ══════════════════════════════════════════════════════════════════════════════
// v2.150 大吾的巨金怪 deck 特性 — 金屬信號 / X啟動 / 皇帝之勢
// ══════════════════════════════════════════════════════════════════════════════
// 皇帝之勢（帝王拿波ex M2 058）— 在 effects.ts 的 hasEffectShield helper 處理
//   （與薄霧能量同類，完全免疫對手招式效果）。

// ── 蓋諾賽克特ex｜金屬信號（regA）──────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。從自己的牌庫選擇最多 2 張【鋼】屬性的進化寶可夢卡，
//   在給對手看過後加入手牌。並且重洗牌庫。」
// 實作：deck-search 用 'Pokemon' 寬 filter，resolver 內 validate 鋼屬性 + 進化階段
regA('蓋諾賽克特ex', 0, (st, idx, pool) => {
  const cand = st.players[idx].deck.filter(c => {
    const card = pool.get(c.cardId);
    if (card?.supertype !== 'Pokemon') return false;
    if (card.pokemonType !== 'Metal') return false;
    return card.stage === 'Stage1' || card.stage === 'Stage2';
  });
  if (cand.length === 0) return addLog(st, '金屬信號：牌庫中無【鋼】進化寶可夢', idx);
  const max = Math.min(2, cand.length);
  let s = addLog(st, `金屬信號：從牌庫選 ≤${max} 張【鋼】進化寶可夢加入手牌（重洗）`, idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage1Or2:Metal',
    minCount: 0, maxCount: max,
    effectKey: 'search-to-hand-reshuffle',
    params: { titleOverride: '金屬信號：選 ≤2 張【鋼】進化寶可夢加入手牌' },
  });
});

// ── 大吾的巨金怪ex｜X啟動（regA）──────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。從自己的牌庫選擇『基本【超】能量』卡與『基本【鋼】能量』卡
//   最多各 1 張，以任意方式附於自己的【超】或者【鋼】寶可夢身上。並且重洗牌庫。」
//
// 流程：
//   1. 選 1 張基本【超】能量（可跳過）
//   2. 選 1 張基本【鋼】能量（可跳過）
//   3. resolver：把選的能量自動分配到自己的【超】或【鋼】寶可夢（簡化：附到 active）
//   4. 重洗牌庫
//
// 簡化策略：直接把選的能量都附到 active（如果 active 是 超 或 鋼）；否則附到第 1 隻可附的備戰寶可夢。
//   不開額外 pending 讓玩家挑目標 — 否則 UI 流程過於複雜。
regA('大吾的巨金怪ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const psyEnergyCount = p.deck.filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Psychic')).length;
  const metEnergyCount = p.deck.filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Metal')).length;
  if (psyEnergyCount === 0 && metEnergyCount === 0) {
    return addLog(st, 'X啟動：牌庫中無基本【超】或基本【鋼】能量', idx);
  }
  // 場上必須有 超 或 鋼 寶可夢
  const hasTarget = [p.active, ...p.bench].some(c => {
    if (!c) return false;
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Psychic' || card?.pokemonType === 'Metal';
  });
  if (!hasTarget) return addLog(st, 'X啟動：場上無【超】或【鋼】寶可夢', idx);
  let s = addLog(st, 'X啟動：選 ≤1 張基本【超】能量 → ≤1 張基本【鋼】能量（自動附於【超】或【鋼】寶可夢）', idx);
  // Step 1: 先選 超能量
  if (psyEnergyCount > 0) {
    return withPending(s, {
      type: 'deck-search',
      actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'Energy:Psychic',
      minCount: 0, maxCount: 1,
      effectKey: 'metagross-x-start-psy',
      params: { titleOverride: 'X啟動 (1/2)：選 ≤1 張基本【超】能量' },
    });
  }
  // 沒超能量 → 直接走鋼
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Metal',
    minCount: 0, maxCount: 1,
    effectKey: 'metagross-x-start-met-only',
    params: { titleOverride: 'X啟動 (2/2)：選 ≤1 張基本【鋼】能量' },
  });
});

// Step 2: 選完超能量 → 開鋼能量
regR('metagross-x-start-psy', (st, idx, iids, _params, pool) => {
  let s = st;
  // 把選的超能量留著，先標記在 params 之後再 commit
  const psyChosenIid: string | null = iids[0] ?? null;
  const metEnergyCount = s.players[idx].deck.filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Metal')).length;
  if (metEnergyCount === 0) {
    // 沒鋼能量 → 直接 commit psy
    return commitMetagrossEnergy(s, idx, psyChosenIid, null, pool);
  }
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Metal',
    minCount: 0, maxCount: 1,
    effectKey: 'metagross-x-start-met',
    params: {
      psyChosenIid,
      titleOverride: 'X啟動 (2/2)：選 ≤1 張基本【鋼】能量',
    },
  });
});

regR('metagross-x-start-met', (st, idx, iids, params, pool) => {
  const metChosenIid: string | null = iids[0] ?? null;
  const psyChosenIid = (params?.psyChosenIid as string | null | undefined) ?? null;
  return commitMetagrossEnergy(st, idx, psyChosenIid, metChosenIid, pool);
});

regR('metagross-x-start-met-only', (st, idx, iids, _params, pool) => {
  const metChosenIid: string | null = iids[0] ?? null;
  return commitMetagrossEnergy(st, idx, null, metChosenIid, pool);
});

function commitMetagrossEnergy(
  st: import('../../types').GameState,
  idx: 0 | 1,
  psyIid: string | null,
  metIid: string | null,
  pool: Map<string, Card>,
): import('../../types').GameState {
  let s = st;
  const p = s.players[idx];
  // 找目標寶可夢：active 優先（若是【超】或【鋼】），否則 bench 第 1 隻【超/鋼】
  const findTarget = (forType: 'Psychic' | 'Metal'): CardInstance | null => {
    if (p.active) {
      const card = pool.get(p.active.cardId);
      if (card?.pokemonType === forType || card?.pokemonType === 'Psychic' || card?.pokemonType === 'Metal') {
        return p.active;
      }
    }
    for (const b of p.bench) {
      const card = pool.get(b.cardId);
      if (card?.pokemonType === 'Psychic' || card?.pokemonType === 'Metal') return b;
    }
    return null;
  };
  // 把選好的能量從 deck 移除，附到目標
  const energyMoves: Array<{ iid: string; targetIid: string }> = [];
  if (psyIid) {
    const target = findTarget('Psychic');
    if (target) energyMoves.push({ iid: psyIid, targetIid: target.iid });
  }
  if (metIid) {
    const target = findTarget('Metal');
    if (target) energyMoves.push({ iid: metIid, targetIid: target.iid });
  }
  if (energyMoves.length === 0 && (psyIid || metIid)) {
    // 沒可附目標但有選能量 — 把能量回到 deck 重洗
    s = updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s, 'X啟動：場上無可附能量的【超/鋼】寶可夢，能量留回牌庫並重洗', idx);
  }
  s = updatePlayer(s, idx, pl => {
    const movedIids = energyMoves.map(m => m.iid);
    const energies = pl.deck.filter(c => movedIids.includes(c.iid));
    const newDeck = pl.deck.filter(c => !movedIids.includes(c.iid));
    // 附加到目標
    const attachToInst = (poke: CardInstance): CardInstance => {
      const matched = energies.filter(e => energyMoves.some(m => m.iid === e.iid && m.targetIid === poke.iid));
      if (matched.length === 0) return poke;
      return { ...poke, energyAttached: [...poke.energyAttached, ...matched] };
    };
    return {
      ...pl,
      deck: shuffle(newDeck),
      active: pl.active ? attachToInst(pl.active) : null,
      bench: pl.bench.map(attachToInst),
    };
  });
  const moveDescs = energyMoves.map(m => {
    const e = pool.get(s.players[idx].deck.find(d => d.iid === m.iid)?.cardId ?? '')?.name
      ?? (m.iid === psyIid ? '基本【超】能量' : '基本【鋼】能量');
    const targetCard = [s.players[idx].active, ...s.players[idx].bench].find(c => c?.iid === m.targetIid);
    const tname = targetCard ? pool.get(targetCard.cardId)?.name ?? '?' : '?';
    return `${e}→${tname}`;
  });
  return addLog(s, `X啟動：${moveDescs.join('、')}（重洗牌庫）`, idx);
}
