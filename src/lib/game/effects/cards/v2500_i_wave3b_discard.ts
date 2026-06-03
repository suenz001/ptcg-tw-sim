/**
 * v2.5 I 標 Wave 3b — 棄能量類批次實裝
 *
 * 涵蓋 ~17 張 I 標寶可夢招式，按 pattern 分組：
 *
 *   A. 棄自身固定 N 個能量大攻擊（10 張）
 *   B. 棄自身全部能量（2 張）
 *   C. 棄對手戰鬥場 1 個能量（4 張）
 *   D. 棄競技場 +N（2 張）
 *   E. 棄手牌指定能量門檻（1 張）
 *
 * 復用 effects.ts 既有 helper 概念但不 export（重複實作 inline，與 v2.49 同 pattern）
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer,
} from '../_shared';
import type { AttackPostFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 棄自身 N 個能量（從尾端取）
// ══════════════════════════════════════════════════════════════════════════════
function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) {
      return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    }
    const attName = pool.get(att.cardId)?.name ?? '?';
    const discardCount = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：${attName} 丟棄 ${discardCount} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - discardCount);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - discardCount);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) {
      return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    }
    const attName = pool.get(att.cardId)?.name ?? '?';
    const s = addLog(state, `${label}：${attName} 丟棄全部能量（${att.energyAttached.length} 個）`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: 棄對手戰鬥場 1 個能量（filter='any' / 'special'）
// ══════════════════════════════════════════════════════════════════════════════
function discardOppActiveEnergyPost(
  label: string,
  filter: 'any' | 'special' = 'any',
): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active) return state;
    const defName = pool.get(defender.active.cardId)?.name ?? '?';
    const energies = defender.active.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${defName} 沒有可丟的能量`, aIdx);
    }
    let targetIdx = -1;
    for (let i = energies.length - 1; i >= 0; i--) {
      const card = pool.get(energies[i].cardId);
      if (filter === 'special') {
        if (card?.supertype === 'Energy' && card.subtype === 'Special') { targetIdx = i; break; }
      } else { targetIdx = i; break; }
    }
    if (targetIdx < 0) {
      return addLog(state, `${label}：${defName} 無${filter === 'special' ? '特殊' : ''}能量可丟`, aIdx);
    }
    const discarded = energies[targetIdx];
    const newEnergies = [...energies.slice(0, targetIdx), ...energies.slice(targetIdx + 1)];
    const energyName = pool.get(discarded.cardId)?.name ?? '能量';
    const s = addLog(state, `${label}：${defName} 丟棄 1 張${filter === 'special' ? '特殊' : ''}能量（${energyName}）`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return { ...p, active: { ...p.active, energyAttached: newEnergies }, discard: [...p.discard, discarded] };
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: 棄場上競技場
// ══════════════════════════════════════════════════════════════════════════════
function discardStadiumPostInline(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    if (!state.activeStadium) {
      return addLog(state, `${label}：場上無競技場`, aIdx);
    }
    const removed: CardInstance = { ...state.activeStadium };
    const stadiumName = pool.get(removed.cardId)?.name ?? '?';
    const ownerIdx = state.activeStadiumOwnerIdx;
    // v2.994 修 tsc error：GameState 沒有 string index signature，改用 undefined 賦值
    //  （activeStadium / activeStadiumOwnerIdx 在 types.ts 都是 optional）
    let s: typeof state = { ...state, activeStadium: undefined, activeStadiumOwnerIdx: undefined };
    if (ownerIdx === 0 || ownerIdx === 1) {
      s = updatePlayer(s, ownerIdx, p => ({ ...p, discard: [...p.discard, removed] }));
    }
    return addLog(s, `${label}：場上競技場（${stadiumName}）丟棄到棄牌區`, aIdx);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. A 棄自身固定 N 個能量（10 張）
// ══════════════════════════════════════════════════════════════════════════════
const SELF_DISC_N: Array<[string, number, number]> = [
  // v5.395：全部「選擇N個能量丟棄」卡已移至 effects.ts registerSelfDiscardMultiply(units+picker)
  // v5.394：蓋歐卡漩渦波/象牙豬暴雪刀鋒/噴火駝力量踩踏 移至 effects.ts registerSelfDiscardMultiply(units+picker)
  // [key, dmg, n]
];
for (const [key, dmg, n] of SELF_DISC_N) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfDiscardNEnergyPost(n, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. B 棄自身全部能量（2 張）
// ══════════════════════════════════════════════════════════════════════════════
const SELF_DISC_ALL: Array<[string, number]> = [
  ['洛托姆ex|十萬伏特', 130],
  ['超級拉帝亞斯ex|幻想脈衝', 300],
];
for (const [key, dmg] of SELF_DISC_ALL) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfDiscardAllEnergyPost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. C 棄對手戰鬥場 1 個能量（4 張）
// ══════════════════════════════════════════════════════════════════════════════
const OPP_DISC_ENERGY: Array<[string, number, 'any' | 'special']> = [
  ['浮潛鼬|潮旋', 30, 'any'],
  ['瑪俐的滑滑小子|咬碎', 50, 'any'],
  ['火箭隊的班基拉斯|打穿衝撞', 180, 'any'],
  ['勾帕路翁|神聖刀鋒', 20, 'special'],
];
for (const [key, dmg, filter] of OPP_DISC_ENERGY) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, discardOppActiveEnergyPost(atkName, filter));
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. D 棄競技場 +N（2 張）— 場上有競技場才 +N，並丟棄
// ══════════════════════════════════════════════════════════════════════════════
// 象牙豬|摧毀 120+ 場上有競技場 +120 + 丟棄
regPre('象牙豬|摧毀', (state, aIdx, _pool) => {
  const cond = !!state.activeStadium;
  const dmg = 120 + (cond ? 120 : 0);
  const s = addLog(state, `摧毀：${cond ? '場上有競技場 +120' : '無競技場'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('象牙豬|摧毀', discardStadiumPostInline('摧毀'));

// 超級摔角鷹人ex|筋斗強襲 120+ 場上有競技場 +140 + 丟棄
regPre('超級摔角鷹人ex|筋斗強襲', (state, aIdx, _pool) => {
  const cond = !!state.activeStadium;
  const dmg = 120 + (cond ? 140 : 0);
  const s = addLog(state, `筋斗強襲：${cond ? '場上有競技場 +140' : '無競技場'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('超級摔角鷹人ex|筋斗強襲', discardStadiumPostInline('筋斗強襲'));

// ══════════════════════════════════════════════════════════════════════════════
// 5. E 棄手牌指定 N 張能量門檻（1 張：蘭螳花|花切舞）
// 卡面：「從手牌將 2 張『基本【草】能量』卡丟棄。若無法丟棄 2 張，則此招失敗」
// ══════════════════════════════════════════════════════════════════════════════
regPre('蘭螳花|花切舞', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const grassEnergies = player.hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Grass' || /【草】/.test(card.name));
  });
  if (grassEnergies.length < 2) {
    return { state: addLog(state, '花切舞：手牌不足 2 張基本【草】能量，招式失敗', aIdx), damage: 0 };
  }
  // 丟棄前 2 張（簡化：自動從尾端取）
  const toDisc = grassEnergies.slice(grassEnergies.length - 2);
  const toDiscIids = new Set(toDisc.map(c => c.iid));
  const s = addLog(state, '花切舞：丟棄手牌 2 張基本【草】能量', aIdx);
  return {
    state: updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscIids.has(c.iid)),
      discard: [...p.discard, ...toDisc],
    })),
    damage: 130,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// 統計：A:9 + B:2 + C:4 + D:2 + E:1 = 18 張 I 標寶可夢招式批次實裝
// ══════════════════════════════════════════════════════════════════════════════

// 輔助：unused import 防護
export type _v2500Sentinel = PlayerState;
