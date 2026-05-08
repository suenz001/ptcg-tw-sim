/**
 * v2.149 — 4 組新預組（超級長耳兔 / 蜜集大蛇 / 火伊布 / 祭典樂舞）的特性實裝
 *
 * 內含：
 *   - 熟成充能（蜜集大蛇ex）：1 回 1 次，手牌 1 張基本【草】能量附寶可夢 + 回 30 HP
 *   - 衝衝鼓（啪咚猴）：戰鬥位有「祭典樂舞」特性 → 1 回 1 次，從牌庫選 1 張卡加手牌 + 重洗
 *   - 搜尋寶石（貓頭夜鷹）：進化的當回合，若場上有「太晶」寶可夢 → 從牌庫選 ≤2 張訓練家
 *   - 祭典樂舞（裹蜜蟲/角金魚/金魚王/綿綿泡芙）：被動，場上有祭典會場 → 招式可使用 2 次
 *     實作策略（不再簡化）：第 1 次招式打完後，若條件成立，turnPhase 不切到 'end'，玩家可再 attack 一次
 *
 * 引擎側已處理：
 *   - 提升進化（伊布）— EVOLVE handler / getEvolvableTargets bypass isFirstTurn + justPlaced
 *   - 虹色DNA（伊布ex）— EVOLVE handler / getEvolvableTargets 從伊布進化的 ex 可放此寶
 *   - 璀璨結晶（Tool ACE SPEC）— canAffordAttack 太晶 -1 能量
 */

import type { CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regA, regPre,
  addLog, updatePlayer, withPending,
  shuffle,
} from '../_shared';
import { isBasicEnergyOfType } from '../../engine';
import { startEnergyChain } from './v158_energy_chain';

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
    // v2.993：卡面「選 1 張」mandatory；deck.length 已 gate > 0 → minCount: 1
    minCount: 1, maxCount: 1,
    // v2.993：衝衝鼓卡面無「給對手看過」→ 用私下版 resolver
    effectKey: 'search-generic-to-hand-private',
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
// 實作策略（不再簡化）：
//   引擎 ATTACK handler 末尾，若 attacker 有 '祭典樂舞' 特性 + 場上有 '祭典會場'
//   + 還沒做過第 2 次 → 先設 flag festivalDanceUsed[aIdx]=true。
//   若沒有待選擇/待取獎/待補戰鬥位，立即回到 main；若第 1 次 KO 對手戰鬥位，
//   則在 TAKE_PRIZES + SEND_NEW_ACTIVE 後回到 main，讓玩家使用第 2 次招式。
//   第 2 次打完正常切 'end'。END_TURN 重置 flag。
//   詳細處理見 engine.ts startFestivalDanceSecondAttackWindow / maybeResumeFestivalDanceSecondAttack。
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
  if (st.players[idx].deck.length === 0) return addLog(st, '金屬信號：牌庫為空', idx);
  st = addLog(st, '金屬信號：從牌庫選最多 2 張【鋼】進化寶可夢加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage1Or2:Metal',
    minCount: 0, maxCount: 2,
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
//   3. resolver：v2.158 升級為 startEnergyChain — 玩家逐張選目標（不再簡化附 active）
//   4. 重洗牌庫
//
// v2.158 之後的策略（不再簡化）：commitMetagrossEnergy 把選的能量先搬到 discard，
//   然後啟動 v158_energy_chain 讓玩家逐張選目標寶可夢（限定【超】或【鋼】，可含 active）。
regA('大吾的巨金怪ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, 'X啟動：牌庫為空', idx);
  // 場上必須有 超 或 鋼 寶可夢
  const hasTarget = [p.active, ...p.bench].some(c => {
    if (!c) return false;
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Psychic' || card?.pokemonType === 'Metal';
  });
  if (!hasTarget) return addLog(st, 'X啟動：場上無【超】或【鋼】寶可夢', idx);
  
  st = addLog(st, 'X啟動：從牌庫搜尋基本【超】能量與基本【鋼】能量各最多 1 張（自動附於【超】或【鋼】寶可夢）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Psychic',
    minCount: 0, maxCount: 1,
    effectKey: 'metagross-x-start-psy',
    params: { titleOverride: 'X啟動 (1/2)：選 ≤1 張基本【超】能量' },
  });
});

// Step 2: 選完超能量 → 開鋼能量
regR('metagross-x-start-psy', (st, idx, iids, _params, pool) => {
  let s = st;
  // 把選的超能量留著，先標記在 params 之後再 commit
  const psyChosenIid: string | null = iids[0] ?? null;
  
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

function commitMetagrossEnergy(
  st: import('../../types').GameState,
  idx: 0 | 1,
  psyIid: string | null,
  metIid: string | null,
  pool: Map<string, Card>,
): import('../../types').GameState {
  // v2.158：升級為玩家自選分配 — 把選的能量先從 deck 移到 discard，呼叫 v158 chain
  //   讓玩家逐張選目標（限定【超】或【鋼】寶可夢；可含 active）
  const moved: string[] = [];
  if (psyIid) moved.push(psyIid);
  if (metIid) moved.push(metIid);
  if (moved.length === 0) {
    return addLog(st, 'X啟動：未選任何能量', idx);
  }
  // 移到 discard（暫存供 chain attach 用），同時 reshuffle deck
  let s = updatePlayer(st, idx, pl => {
    const movedSet = new Set(moved);
    const energies = pl.deck.filter(c => movedSet.has(c.iid));
    const newDeck = pl.deck.filter(c => !movedSet.has(c.iid));
    return {
      ...pl,
      deck: shuffle(newDeck),
      discard: [...pl.discard, ...energies],
    };
  });
  // 啟動 chain：source='discard'（已搬好），scope='any-own'，filter=【超】或【鋼】
  return startEnergyChain(s, idx, moved, {
    label: 'X啟動',
    source: 'discard',
    scope: 'any-own',
    filterType: ['Psychic', 'Metal'],
  }, pool);
}

// ══════════════════════════════════════════════════════════════════════════════
// v2.462 蜜集大蛇ex｜蜜糖風暴（招式）— 修永遠只 30 點 bug
// 卡面：「30+ 增加自己的所有寶可夢身上附加的【草】能量的數量×30 點傷害。」
// 公式：30 + 30 × Σ(自方所有寶可夢身上 pokemonType==='Grass' 的能量數)
// 之前無 regPre → 引擎只取 parseInt('30+') = 30，沒套+N 公式
// ══════════════════════════════════════════════════════════════════════════════
regPre('蜜集大蛇ex|蜜糖風暴', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const allOwn: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  let grassCount = 0;
  for (const pk of allOwn) {
    for (const e of pk.energyAttached) {
      const ec = pool.get(e.cardId);
      // 廣義【草】能量：基本【草】 + 名稱含【草】(如富裕能量等多色不算，需嚴格用 pokemonType)
      if (ec?.pokemonType === 'Grass') grassCount++;
    }
  }
  return { state, damage: 30 + grassCount * 30 };
});
