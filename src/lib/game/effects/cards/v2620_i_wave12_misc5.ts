/**
 * v2.62 I 標 Wave 12 — 雜項第五批（約 35 張）
 *
 * 擲幣反面失敗 / 棄能量大招 / 擲到反面×K / 自身/對手 ×K / 對手獎賞 / 治癒批次 等
 */

import type { CardInstance, PlayerState } from '../../types';
import { countOneEnergy } from '../../effects';
import { regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle,
  getOwnBenchLimit,
} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ══════════════════════════════════════════════════════════════════════════════
function coinTailsFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) return { state: addLog(state, `${label}：反面 → 招式失敗`, aIdx), damage: 0 };
    return { state: addLog(state, `${label}：正面 → ${base} 傷害`, aIdx), damage: base };
  };
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a || a.energyAttached.length === 0) return state;
    const attName = pool.get(a.cardId)?.name ?? '?';
    return updatePlayer(
      addLog(state, `${label}：${attName} 丟棄全部能量（${a.energyAttached.length} 個）`, aIdx),
      aIdx, p => {
        if (!p.active) return p;
        return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...p.active.energyAttached] };
      },
    );
  };
}

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (!a || a.energyAttached.length === 0) return state;
    const discardCount = Math.min(n, a.energyAttached.length);
    return updatePlayer(
      addLog(state, `${label}：自身丟棄 ${discardCount} 個能量`, aIdx),
      aIdx, p => {
        if (!p.active) return p;
        const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - discardCount);
        const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - discardCount);
        return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
      },
    );
  };
}

// 擲到反面為止 ×K
function coinUntilTailsMultiplyPre(base: number, perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let heads = 0;
    for (let i = 0; i < 20; i++) {
      if (Math.random() < 0.5) heads++;
      else break;
    }
    const dmg = base + heads * perHead;
    const s = addLog(state, `${label}：擲到反面為止 → ${heads} 次正面 = ${base} + ${heads}×${perHead} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// 自身能量數 ×K
function selfTotalEnergyPre(base: number, perEnergy: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    const count = a?.energyAttached.length ?? 0;
    const dmg = base + count * perEnergy;
    const s = addLog(state, `${label}：自身能量 ${count} 個 → ${base} + ${count}×${perEnergy} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

function selfTypeEnergyPre(
  base: number, perEnergy: number,
  type: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    // v4.55：改用 countOneEnergy — 涵蓋 pokemonType=null 基本能量 (看卡名【X】fallback)
    const count = countOneEnergy(a, type, pool);
    const dmg = base + count * perEnergy;
    const s = addLog(state, `${label}：自身 ${type} 能量 ${count} 個 → ${base} + ${count}×${perEnergy} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

function oppActiveEnergyCountPre(base: number, perEnergy: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const count = def?.energyAttached.length ?? 0;
    const dmg = base + count * perEnergy;
    const s = addLog(state, `${label}：對手戰鬥場能量 ${count} 個 → ${base} + ${count}×${perEnergy} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

function oppActiveCounterCountPre(base: number, perCounter: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const counters = def ? Math.floor((def.damage ?? 0) / 10) : 0;
    const dmg = base + counters * perCounter;
    const s = addLog(state, `${label}：對手戰鬥場指示物 ${counters} 個 → ${base} + ${counters}×${perCounter} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// v3.22：改用 nextOwnAttackPenalty（attacker-side debuff）。
function defNextAtkReducePost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, nextOwnAttackPenalty: n };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${label}：對手下次招式傷害 -${n}`, aIdx);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 擲幣反面失敗（3 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('泥偶小人|全力拳', coinTailsFailPre(60, '全力拳'));
regPre('電電蟲|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('步哨鼠|必殺門牙', coinTailsFailPre(80, '必殺門牙'));

// ══════════════════════════════════════════════════════════════════════════════
// 2. 棄全部能量大招（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('水晶燈火靈|燃燒盡', (s) => ({ state: s, damage: 180 }));
regPost('水晶燈火靈|燃燒盡', selfDiscardAllEnergyPost('燃燒盡'));

regPre('大吾的念力土偶|黏土爆破', (s) => ({ state: s, damage: 220 }));
regPost('大吾的念力土偶|黏土爆破', selfDiscardAllEnergyPost('黏土爆破'));

// ══════════════════════════════════════════════════════════════════════════════
// 3. 棄 N 個能量大招（4 張）
// ══════════════════════════════════════════════════════════════════════════════




// ══════════════════════════════════════════════════════════════════════════════
// 4. 自方備戰數 ×K（1 張）— 奇諾栗鼠|朋友之環
// ══════════════════════════════════════════════════════════════════════════════
regPre('奇諾栗鼠|朋友之環', (state, aIdx, _pool) => {
  const benchN = state.players[aIdx].bench.length;
  const dmg = 20 + benchN * 20;
  const s = addLog(state, `朋友之環：自方備戰 ${benchN} 隻 → 20 + ${benchN}×20 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 擲到反面 ×K（4 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('斗笠菇|傷害衝刺', coinUntilTailsMultiplyPre(30, 50, '傷害衝刺'));
regPre('凍原熊|連續頭錘', coinUntilTailsMultiplyPre(0, 50, '連續頭錘'));
regPre('章魚桶|狂擊', coinUntilTailsMultiplyPre(0, 90, '狂擊'));
regPre('泥驢仔|奔進', coinUntilTailsMultiplyPre(0, 40, '奔進'));

// ══════════════════════════════════════════════════════════════════════════════
// 6. 擲 N 次硬幣 +K（1 張）— 派拉斯特|橫掃剪
// ══════════════════════════════════════════════════════════════════════════════
regPre('派拉斯特|橫掃剪', (state, aIdx, _pool) => {
  let heads = 0;
  for (let i = 0; i < 2; i++) if (Math.random() < 0.5) heads++;
  const dmg = 60 + heads * 30;
  const s = addLog(state, `橫掃剪：擲 2 次 → ${heads} 正面 → 60 + ${heads}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 自身能量 ×K（4 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('雙刃丸|能量硬殼', selfTotalEnergyPre(0, 30, '能量硬殼'));
regPre('大劍鬼|能量斬', selfTotalEnergyPre(30, 50, '能量斬'));
regPre('吼鯨王|水炮', selfTypeEnergyPre(10, 50, 'Water', '水炮'));
regPre('瑪俐的莫魯貝可|扣殺輪', selfTypeEnergyPre(20, 40, 'Darkness', '扣殺輪'));

// ══════════════════════════════════════════════════════════════════════════════
// 8. 對手戰鬥場能量 ×K（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的以歐路普|精神強念', oppActiveEnergyCountPre(40, 40, '精神強念'));
regPre('大宇怪|精神強念', oppActiveEnergyCountPre(80, 30, '精神強念'));

// ══════════════════════════════════════════════════════════════════════════════
// 9. 對手戰鬥場指示物 ×K（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('伽勒爾 堵攔熊|傷疤嚎叫', oppActiveCounterCountPre(0, 70, '傷疤嚎叫'));
regPre('鬃岩狼人|抓擊獠牙', oppActiveCounterCountPre(40, 40, '抓擊獠牙'));

// ══════════════════════════════════════════════════════════════════════════════
// 10. 上對手回合得獎賞 ×60（1 張）— 夠讚狗|算帳
// ══════════════════════════════════════════════════════════════════════════════
regPre('夠讚狗|算帳', (state, aIdx, _pool) => {
  // 用既有 state.oppPrizesTakenInLastOppTurn?[aIdx] 機制（如果有），否則用差值
  // 簡化：用 state.oppAttackKOdMeInLastOppTurn 作為近似（每 KO 對手得 1 獎賞）
  // 但對手獎賞含「對手 ex KO」的雙倍。簡化為使用同一旗標。
  const taken = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const bonus = taken * 60;
  const s = addLog(state, `算帳：上對手回合對手得獎賞 ${taken} 張 → 80 + ${taken}×60 = ${80 + bonus}`, aIdx);
  return { state: s, damage: 80 + bonus };
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 對手獎賞剩 4/3 失敗（1 張）— 赫普的古月鳥|浮躁噴吐
// ══════════════════════════════════════════════════════════════════════════════
regPre('赫普的古月鳥|浮躁噴吐', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const remaining = state.players[dIdx].prizes.length;
  const cond = (remaining === 4 || remaining === 3);
  if (!cond) {
    return { state: addLog(state, `浮躁噴吐：對手剩餘獎賞 ${remaining} 張（不是 4 或 3） → 失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, `浮躁噴吐：對手剩餘獎賞 ${remaining} 張 → 120 傷害`, aIdx), damage: 120 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 對手下回合 -N（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('象徵鳥|反射壁', (s) => ({ state: s, damage: 0 }));
regPost('象徵鳥|反射壁', defNextAtkReducePost(40, '反射壁'));

regPre('赫普的稚山雀|恐怖視線', (s) => ({ state: s, damage: 0 }));
regPost('赫普的稚山雀|恐怖視線', defNextAtkReducePost(20, '恐怖視線'));

// ══════════════════════════════════════════════════════════════════════════════
// 13. 自方所有基礎寶可夢回 100 HP（1 張）— 保母蟲|治癒襁褓
// ══════════════════════════════════════════════════════════════════════════════
regPre('保母蟲|治癒襁褓', (s) => ({ state: s, damage: 0 }));
regPost('保母蟲|治癒襁褓', (state, aIdx, pool) => {
  return updatePlayer(
    addLog(state, '治癒襁褓：自方所有基礎寶可夢各回 100 HP', aIdx),
    aIdx, p => {
      const isBasic = (cardId: string): boolean => {
        const c = pool.get(cardId);
        return !!c && c.supertype === 'Pokemon' && !c.evolvesFrom
          && c.subtype !== 'Stage1' && c.subtype !== 'Stage2';
      };
      return {
        ...p,
        active: p.active && isBasic(p.active.cardId)
          ? { ...p.active, damage: Math.max(0, (p.active.damage ?? 0) - 100) }
          : p.active,
        bench: p.bench.map(b => isBasic(b.cardId)
          ? { ...b, damage: Math.max(0, (b.damage ?? 0) - 100) }
          : b),
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 對手戰鬥場無指示物失敗（1 張）— 野蠻鱸魚|堆積之牙
// ══════════════════════════════════════════════════════════════════════════════
regPre('野蠻鱸魚|堆積之牙', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const cond = !!def && (def.damage ?? 0) > 0;
  if (!cond) {
    return { state: addLog(state, '堆積之牙：對手戰鬥寶可夢無指示物 → 失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, '堆積之牙：對手戰鬥寶可夢有指示物 → 50 傷害', aIdx), damage: 50 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. 撤退費 ×30 減（1 張）— 投摔鬼|背負上投
// ══════════════════════════════════════════════════════════════════════════════
regPre('投摔鬼|背負上投', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const card = def ? pool.get(def.cardId) : undefined;
  const retreatCost = card?.retreatCost?.length ?? 0;
  const dmg = Math.max(0, 120 - retreatCost * 30);
  const s = addLog(state, `背負上投：對手撤退費 ${retreatCost} 個 → 120 - ${retreatCost}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 自方場上進化寶可夢數 ×40（1 張）— 人造細胞卵|進化金勾臂
// ══════════════════════════════════════════════════════════════════════════════
regPre('人造細胞卵|進化金勾臂', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  let count = 0;
  for (const pk of all) {
    const card = pool.get(pk.cardId);
    if (card?.evolvesFrom) count++;
  }
  const dmg = 40 + count * 40;
  const s = addLog(state, `進化金勾臂：自方場上進化寶可夢 ${count} 隻 → 40 + ${count}×40 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. 對手棄牌區物品數 ×30（1 張）— 原蓋海龜|遠古碎藻
// ══════════════════════════════════════════════════════════════════════════════
regPre('原蓋海龜|遠古碎藻', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  let count = 0;
  for (const c of opp.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Trainer' && card.subtype === 'Item') count++;
  }
  const dmg = count * 30;
  const s = addLog(state, `遠古碎藻：對手棄牌區物品 ${count} 張 → ${count}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. skipDefEffects（1 張）— 凱路迪歐ex|音波刀鋒
// ══════════════════════════════════════════════════════════════════════════════
regPre('凱路迪歐ex|音波刀鋒', (s) => ({ state: s, damage: 120, skipDefEffects: true }));

// ══════════════════════════════════════════════════════════════════════════════
// 19. 擲幣狀態（1 張）— 鴨嘴炎獸|灼燒
// ══════════════════════════════════════════════════════════════════════════════
regPre('鴨嘴炎獸|灼燒', (s) => ({ state: s, damage: 90 }));
regPost('鴨嘴炎獸|灼燒', (state, aIdx, _pool) => {
  const heads = Math.random() < 0.5;
  let s = addLog(state, `灼燒：擲 1 次 → ${heads ? '正面 → 對手戰鬥場灼傷' : '反面，無附加'}`, aIdx);
  if (!heads) return s;
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, secondaryStatus: 'burned' as const } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. 擲 3 全正 KO 對手（1 張）— 火箭隊的椰蛋樹|三重強念
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的椰蛋樹|三重強念', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的椰蛋樹|三重強念', (state, aIdx, _pool) => {
  const flips = [Math.random() < 0.5, Math.random() < 0.5, Math.random() < 0.5];
  const allHeads = flips.every(f => f);
  let s = addLog(state, `三重強念：擲 3 次 → ${flips.map(f => f ? '正' : '反').join('/')}`, aIdx);
  if (!allHeads) return s;
  // 全正面 → 對手選 1 寶可夢直接 KO
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const targets: string[] = [];
  if (opp.active) targets.push(opp.active.iid);
  for (const b of opp.bench) targets.push(b.iid);
  if (targets.length === 0) return s;
  s = addLog(s, '三重強念：全正面 → 選 1 隻對手寶可夢直接昏厥', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave12-ko-target',
    params: { validIids: targets },
  });
});

regR('wave12-ko-target', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  return updatePlayer(
    addLog(state, '三重強念：選定寶可夢直接昏厥', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active && p.active.iid === targetIid ? { ...p.active, damage: 99999 } : p.active,
      bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: 99999 } : b),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. 對手 2 隻備戰各 N（3 張）
// ══════════════════════════════════════════════════════════════════════════════
function snipeNoppPokemonPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    const targets: string[] = [];
    if (opp.active) targets.push(opp.active.iid);
    for (const b of opp.bench) targets.push(b.iid);
    if (targets.length === 0) return state;
    const s = addLog(state, `${label}：選 2 隻對手寶可夢，各受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: Math.min(2, targets.length), maxCount: Math.min(2, targets.length),
      effectKey: 'wave12-snipe-2-flat',
      params: { amount, label, validIids: targets },
    });
  };
}

regR('wave12-snipe-2-flat', (state, aIdx, iids, params, _pool) => {
  const amount = (params?.amount as number | undefined) ?? 0;
  const label = (params?.label as string | undefined) ?? '雙重狙擊';
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const set = new Set(iids);
  return updatePlayer(
    addLog(state, `${label}：選定 ${iids.length} 隻寶可夢各受到 ${amount} 點傷害`, aIdx),
    dIdx, p => ({
      ...p,
      active: p.active && set.has(p.active.iid) ? { ...p.active, damage: (p.active.damage ?? 0) + amount } : p.active,
      bench: p.bench.map(b => set.has(b.iid) ? { ...b, damage: (b.damage ?? 0) + amount } : b),
    }),
  );
});

regPre('超級麻麻鰻魚王ex|爆裂彈', (s) => ({ state: s, damage: 0 }));
regPost('超級麻麻鰻魚王ex|爆裂彈', snipeNoppPokemonPost(60, '爆裂彈'));

regPre('電擊魔獸ex|二重伏特', (s) => ({ state: s, damage: 0 }));
regPost('電擊魔獸ex|二重伏特', snipeNoppPokemonPost(50, '二重伏特'));

regPre('大吾的盔甲鳥|雙音波', (s) => ({ state: s, damage: 0 }));
regPost('大吾的盔甲鳥|雙音波', snipeNoppPokemonPost(50, '雙音波'));

// ══════════════════════════════════════════════════════════════════════════════
// 22. 牌庫搜物品 / 競技場 (3 張)
// ══════════════════════════════════════════════════════════════════════════════
function deckSearchTrainerSubtypePost(
  filter: 'Item' | 'Stadium',
  effectKeyName: string,
  filterStr: string,
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const valid = player.deck.filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Trainer' && card.subtype === filter;
    });
    if (valid.length === 0) {
      return updatePlayer(
        addLog(state, `${label}：牌庫無 ${filter}；重洗`, aIdx),
        aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
      );
    }
    const s = addLog(state, `${label}：從牌庫挑 1 張 ${filter} 加手牌（重洗）`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr,
      minCount: 0, maxCount: 1,  // v3.996：玩家可不選
      effectKey: effectKeyName,
    });
  };
}

regR('wave12-deck-take-trainer', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '搜尋未選擇；重洗', aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  return updatePlayer(
    addLog(state, `從牌庫挑 ${iids.length} 張卡加手牌；重洗`, aIdx),
    aIdx, p => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
    },
  );
});

regPre('火箭隊的咩利羊|籌備', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的咩利羊|籌備', deckSearchTrainerSubtypePost('Item', 'wave12-deck-take-trainer', 'Item', '籌備'));

regPre('探探鼠|籌備', (s) => ({ state: s, damage: 0 }));
regPost('探探鼠|籌備', deckSearchTrainerSubtypePost('Item', 'wave12-deck-take-trainer', 'Item', '籌備'));

regPre('赫普的沙包蛇|築窩', (s) => ({ state: s, damage: 0 }));
regPost('赫普的沙包蛇|築窩', deckSearchTrainerSubtypePost('Stadium', 'wave12-deck-take-trainer', 'Stadium', '築窩'));

// ══════════════════════════════════════════════════════════════════════════════
// 23. 牌庫挑 ≤2 基礎寶可夢放備戰（1 張）— N的迷你冰|呼朋引伴
// 復用 v2.55 的 wave5-place-basic-bench resolver
// ══════════════════════════════════════════════════════════════════════════════
regPre('N的迷你冰|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('N的迷你冰|呼朋引伴', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // v3.80：支援零之大空洞
  const benchSpace = Math.max(0, getOwnBenchLimit(state, aIdx, pool) - player.bench.length);
  if (benchSpace === 0) return addLog(state, '呼朋引伴：備戰已滿', aIdx);
  if (player.deck.length === 0) return addLog(state, '呼朋引伴：牌庫已空', aIdx);
  const max = Math.min(2, benchSpace);
  const s = addLog(state, `呼朋引伴：從牌庫挑 0~${max} 張基礎寶可夢放備戰`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: max,
    effectKey: 'wave5-place-basic-bench',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 24. 棄對手戰鬥場 1 張【火】能量（1 張）— 鴨寶寶|消火
// ══════════════════════════════════════════════════════════════════════════════
regPre('鴨寶寶|消火', (s) => ({ state: s, damage: 0 }));
regPost('鴨寶寶|消火', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return state;
  // v4.55：改用 countOneEnergy fallback 邏輯 (匹配 pokemonType 或 卡名【火】) — 涵蓋基本能量
  let fireIdx = -1;
  for (let i = def.energyAttached.length - 1; i >= 0; i--) {
    const c = pool.get(def.energyAttached[i].cardId);
    if (c && (c.pokemonType === 'Fire' || /【火】/.test(c.name))) {
      fireIdx = i;
      break;
    }
  }
  if (fireIdx < 0) return addLog(state, '消火：對手戰鬥場無火能量可棄', aIdx);
  return updatePlayer(
    addLog(state, '消火：棄對手戰鬥場 1 張【火】能量', aIdx),
    dIdx, p => {
      if (!p.active) return p;
      const newEnergies = [...p.active.energyAttached.slice(0, fireIdx), ...p.active.energyAttached.slice(fireIdx + 1)];
      return {
        ...p,
        active: { ...p.active, energyAttached: newEnergies },
        discard: [...p.discard, p.active.energyAttached[fireIdx]],
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 輔助：unused import 防護
export type _v2620Sentinel = PlayerState;
type _APT = AttackPostFn;
