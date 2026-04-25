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
