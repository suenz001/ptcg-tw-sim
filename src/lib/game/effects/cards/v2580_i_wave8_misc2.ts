/**
 * v2.58 I 標 Wave 8 — 條件 +N 第二批 / 失敗條件 / 自方支援
 *
 *  ~25 張 I 標寶可夢招式 effect 實裝
 *
 *   A. 自方場上能量條件 +N (3 張)
 *   B. 對手異常 / 自身能量條件 +N (3 張)
 *   C. 對手下回合 -N (2 張)
 *   D. 自身回手牌 / 回牌庫類 (1 張)
 *   E. 簡單放指示物 (1 張)
 *   F. 擲幣反面失敗 (2 張)
 *   G. 條件式失敗 (2 張)
 *   H. 自方治癒批次 (2 張)
 *   I. 上對手回合招式 KO 自方 +N (2 張)
 *   J. 對手下回合無法撤退 (1 張)
 *   K. 擲幣 immune (1 張)
 *   L. 場上同類數量 ×K (3 張)
 *   M. 牌庫搜寶可夢加備戰/手牌 (2 張)
 *   N. 棄自身能量倍率 (1 張)
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 自方場上某屬性能量總數 ≥ N 條件 +K
// ══════════════════════════════════════════════════════════════════════════════
function fieldEnergyCountConditionPre(
  base: number, bonus: number, energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  threshold: number, label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
    let count = 0;
    for (const pk of all) {
      for (const e of pk.energyAttached) {
        if (pool.get(e.cardId)?.pokemonType === energyType) count++;
      }
    }
    const cond = count >= threshold;
    const dmg = cond ? base + bonus : base;
    const s = addLog(state, `${label}：自方場上 ${energyType} 能量 ${count} 個（門檻 ${threshold}）${cond ? `→ +${bonus}` : ''} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 對手戰鬥場下回合受招式 -N
function defNextAtkReducePost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, damageReduceNextHit: n };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${label}：對手下次招式傷害 -${n}`, aIdx);
  };
}

// helper: 對手戰鬥場下回合無法撤退
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

// helper: 擲幣反面失敗
function coinTailsFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) {
      return { state: addLog(state, `${label}：反面 → 招式失敗`, aIdx), damage: 0 };
    }
    return { state: addLog(state, `${label}：正面 → ${base} 傷害`, aIdx), damage: base };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// A. 自方場上能量條件 +N (3 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('水君|水晶墜落', fieldEnergyCountConditionPre(30, 90, 'Water', 4, '水晶墜落'));
regPre('炎帝|閃焰墜落', fieldEnergyCountConditionPre(30, 90, 'Fire', 4, '閃焰墜落'));

// 哥達鴨|水炮 60+ 自身水能量 ×20
regPre('哥達鴨|水炮', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 60 };
  let count = 0;
  for (const e of a.energyAttached) {
    if (pool.get(e.cardId)?.pokemonType === 'Water') count++;
  }
  const dmg = 60 + count * 20;
  const s = addLog(state, `水炮：自身水能量 ${count} 個 → 60 + ${count}×20 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// B. 對手異常條件 +N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('敗露球菇|險惡回應', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const cond = !!def && (!!def.status || !!def.secondaryStatus);
  const dmg = 30 + (cond ? 120 : 0);
  const s = addLog(state, `險惡回應：對手戰鬥寶可夢 ${cond ? '處於特殊狀態 → +120' : '無特殊狀態'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// C. 對手下回合 -N (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('捲捲耳|撒嬌', (s) => ({ state: s, damage: 0 }));
regPost('捲捲耳|撒嬌', defNextAtkReducePost(20, '撒嬌'));

regPre('布撥|叫聲', (s) => ({ state: s, damage: 0 }));
regPost('布撥|叫聲', defNextAtkReducePost(30, '叫聲'));

// ══════════════════════════════════════════════════════════════════════════════
// D. 自身回牌庫並重洗 (1 張)
// 烈腿蝗|跳躍射擊 150 + 自身連附加全部回牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('烈腿蝗|跳躍射擊', (s) => ({ state: s, damage: 150 }));
regPost('烈腿蝗|跳躍射擊', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '跳躍射擊：自身連附加卡全部放回自己牌庫並重洗', aIdx),
    aIdx, p => {
      if (!p.active) return p;
      const a = p.active;
      const returning: CardInstance[] = [
        { ...a, damage: 0, energyAttached: [], toolAttached: undefined,
          status: undefined, secondaryStatus: undefined,
          evolvedFromStack: undefined, evolvedThisTurn: undefined,
          justPlaced: undefined, playedFromHand: undefined, movedToActiveThisTurn: undefined,
          damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
          abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
          cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
          damageBonusPending: undefined, takeExtraDamageThisTurn: undefined, takeExtraDamageNextTurn: undefined,
          blockedAttackNamesNextTurn: undefined,
        },
        ...a.energyAttached,
        ...(a.toolAttached ? [a.toolAttached] : []),
        ...(a.evolvedFromStack ?? []),
      ];
      return { ...p, active: null, deck: shuffle([...p.deck, ...returning]) };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// E. 簡單放指示物 (1 張)
// 納噬草|悄聲加害 0 + 對手 1 隻寶可夢放 1 指示物
// ══════════════════════════════════════════════════════════════════════════════
regPre('納噬草|悄聲加害', (s) => ({ state: s, damage: 0 }));
regPost('納噬草|悄聲加害', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const targets: string[] = [];
  if (opp.active) targets.push(opp.active.iid);
  for (const b of opp.bench) targets.push(b.iid);
  if (targets.length === 0) return state;
  const s = addLog(state, '悄聲加害：選 1 隻對手寶可夢放置 1 個傷害指示物（10 點傷害）', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave6-snipe-any-opp-flat',  // 復用 v2.56 的 resolver
    params: { amount: 10, label: '悄聲加害', validIids: targets },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// F. 擲幣反面失敗 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('淚眼蜥|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('蛇紋熊|偷襲', coinTailsFailPre(30, '偷襲'));

// ══════════════════════════════════════════════════════════════════════════════
// G. 條件式失敗 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 噴火駝|炙燒灼傷 110 — 對手戰鬥場無【灼傷】則招式失敗
regPre('噴火駝|炙燒灼傷', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const cond = !!def && (def.status === 'burned' || def.secondaryStatus === 'burned');
  if (!cond) {
    return { state: addLog(state, '炙燒灼傷：對手戰鬥寶可夢未【灼傷】，招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, '炙燒灼傷：對手戰鬥寶可夢有【灼傷】 → 110 傷害', aIdx), damage: 110 };
});

// 恰雷姆|七度踢腿 150 — 手牌不是 7 張則失敗
regPre('恰雷姆|七度踢腿', (state, aIdx, _pool) => {
  const handCount = state.players[aIdx].hand.length;
  if (handCount !== 7) {
    return { state: addLog(state, `七度踢腿：手牌 ${handCount} 張（非 7 張）→ 招式失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, '七度踢腿：手牌恰好 7 張 → 150 傷害', aIdx), damage: 150 };
});

// ══════════════════════════════════════════════════════════════════════════════
// H. 自方治癒批次 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 風妖精|治癒棉絮 0 — 1 隻備戰寶可夢回滿 HP
regPre('風妖精|治癒棉絮', (s) => ({ state: s, damage: 0 }));
regPost('風妖精|治癒棉絮', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.bench.length === 0) {
    return addLog(state, '治癒棉絮：備戰區無寶可夢', aIdx);
  }
  const wounded = player.bench.filter(b => (b.damage ?? 0) > 0);
  if (wounded.length === 0) {
    return addLog(state, '治癒棉絮：備戰區無受傷寶可夢', aIdx);
  }
  const s = addLog(state, '治癒棉絮：選 1 隻備戰寶可夢回滿 HP', aIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave8-heal-full-bench',
    params: { validIids: wounded.map(b => b.iid) },
  });
});

regR('wave8-heal-full-bench', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(
    addLog(state, `治癒棉絮：選定備戰寶可夢回復至滿 HP`, aIdx),
    aIdx, p => ({
      ...p,
      bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: 0 } : b),
    }),
  );
});

// 阿響的鳳王ex|閃耀羽毛 160 + 自方所有寶可夢各回 50 HP
regPre('阿響的鳳王ex|閃耀羽毛', (s) => ({ state: s, damage: 160 }));
regPost('阿響的鳳王ex|閃耀羽毛', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '閃耀羽毛：自方所有寶可夢各回復 50 HP', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damage: Math.max(0, (p.active.damage ?? 0) - 50) } : null,
      bench: p.bench.map(b => ({ ...b, damage: Math.max(0, (b.damage ?? 0) - 50) })),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// I. 上對手回合招式 KO 自方 +N (2 張)
// 用既有 state.oppAttackKOdMeInLastOppTurn 機制
// ══════════════════════════════════════════════════════════════════════════════
regPre('阿響的凱羅斯|一力反攻', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 100 : 0;
  const s = tookPrize
    ? addLog(state, '一力反攻：上對手回合自方寶可夢被招式 KO → +100', aIdx) : state;
  return { state: s, damage: 70 + bonus };
});

regPre('赫普的朽木妖|恐怖復仇', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 100 : 0;
  const s = tookPrize
    ? addLog(state, '恐怖復仇：上對手回合自方寶可夢被招式 KO → +100', aIdx) : state;
  return { state: s, damage: 30 + bonus };
});

// ══════════════════════════════════════════════════════════════════════════════
// J. 對手下回合無法撤退 (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('赫普的朽木妖|窮追不捨', (s) => ({ state: s, damage: 90 }));
regPost('赫普的朽木妖|窮追不捨', defCantRetreatNextPost('窮追不捨'));

// ══════════════════════════════════════════════════════════════════════════════
// K. 擲幣 immune (1 張) — 赫普的小木靈|躍起閃避
// ══════════════════════════════════════════════════════════════════════════════
regPre('赫普的小木靈|躍起閃避', (s) => ({ state: s, damage: 10 }));
regPost('赫普的小木靈|躍起閃避', (state, aIdx, _pool) => {
  const heads = Math.random() < 0.5;
  let s = addLog(state, `躍起閃避：擲 1 次硬幣 → ${heads ? '正面' : '反面'}`, aIdx);
  if (!heads) return s;
  return updatePlayer(
    addLog(s, '躍起閃避：正面 → 自身下回合免疫招式傷害', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageReduceNextHit: 9999 } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// L. 場上同類數量 ×K (3 張)
// ══════════════════════════════════════════════════════════════════════════════
// 帕底亞 肯泰羅|憤怒猛撞 — 自方場上有指示物的「肯泰羅」寶可夢數 ×40
regPre('帕底亞 肯泰羅|憤怒猛撞', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  let count = 0;
  for (const pk of all) {
    if ((pk.damage ?? 0) === 0) continue;
    const card = pool.get(pk.cardId);
    if (!card) continue;
    if (card.name.includes('肯泰羅')) count++;
  }
  const dmg = count * 40;
  const s = addLog(state, `憤怒猛撞：自方場上有指示物的肯泰羅 ${count} 隻 → ${count}×40 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 胖可丁|輪唱 40× 自方場上有「輪唱」招式的寶可夢數
regPre('胖可丁|輪唱', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  let count = 0;
  for (const pk of all) {
    const card = pool.get(pk.cardId);
    if (card?.attacks?.some(a => a.name === '輪唱')) count++;
  }
  const dmg = count * 40;
  const s = addLog(state, `輪唱：自方場上有「輪唱」招式的寶可夢 ${count} 隻 → ${count}×40 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 青銅鐘|道具擊落 40× 雙方場上「寶可夢道具」數
regPre('青銅鐘|道具擊落', (state, aIdx, _pool) => {
  let count = 0;
  for (const p of state.players) {
    const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
    for (const pk of all) {
      if (pk.toolAttached) count++;
    }
  }
  const dmg = count * 40;
  const s = addLog(state, `道具擊落：雙方場上寶可夢道具 ${count} 個 → ${count}×40 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// M. 牌庫搜寶可夢 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 托戈德瑪爾|尋找朋友 0 — 從牌庫挑 1 寶可夢加手 + 重洗
regPre('托戈德瑪爾|尋找朋友', (s) => ({ state: s, damage: 0 }));
regPost('托戈德瑪爾|尋找朋友', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) {
    return addLog(state, '尋找朋友：牌庫已空', aIdx);
  }
  const s = addLog(state, '尋找朋友：從牌庫挑 1 張寶可夢加手牌（重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 1, maxCount: 1,
    effectKey: 'wave5-add-pokemon-to-hand',  // 復用 v2.55 resolver
  });
});

// 洛托姆|洛托呼喚 0 — 從牌庫挑「洛托姆」名稱寶可夢任意數量放備戰 + 重洗
regPre('洛托姆|洛托呼喚', (s) => ({ state: s, damage: 0 }));
regPost('洛托姆|洛托呼喚', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // 計算備戰可放空位
  const benchSpace = Math.max(0, 5 - player.bench.length);
  if (benchSpace === 0) {
    return addLog(state, '洛托呼喚：備戰區已滿', aIdx);
  }
  // 找牌庫中名字含「洛托姆」的寶可夢
  const lotomIids = player.deck
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Pokemon' && card.name.includes('洛托姆');
    })
    .map(c => c.iid);
  if (lotomIids.length === 0) {
    return addLog(state, '洛托呼喚：牌庫中無「洛托姆」寶可夢', aIdx);
  }
  const max = Math.min(benchSpace, lotomIids.length);
  const s = addLog(state, `洛托呼喚：從牌庫挑 0~${max} 張「洛托姆」寶可夢放備戰`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon:NamePrefix=洛托姆',
    minCount: 0, maxCount: max,
    effectKey: 'wave5-place-basic-bench',  // 復用 v2.55 resolver（其實是放任意寶可夢的）
    params: { validIids: lotomIids },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// N. 棄自身能量倍率 (1 張)
// 阿響的熔岩蝸牛|熔岩爆炸 70× 棄自身火能量數（最多 5）
// ══════════════════════════════════════════════════════════════════════════════
regPre('阿響的熔岩蝸牛|熔岩爆炸', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 0 };
  // 算自身火能量
  let fireCount = 0;
  for (const e of a.energyAttached) {
    if (pool.get(e.cardId)?.pokemonType === 'Fire') fireCount++;
  }
  const discardCount = Math.min(5, fireCount);
  const dmg = discardCount * 70;
  const s = addLog(state, `熔岩爆炸：自身火能量 ${fireCount} 個（最多棄 5 → ${discardCount}），${discardCount}×70 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

regPost('阿響的熔岩蝸牛|熔岩爆炸', (state, aIdx, pool) => {
  // 從尾端棄火能量最多 5 個
  const a = state.players[aIdx].active;
  if (!a) return state;
  let toDiscard = 5;
  const newEnergies: CardInstance[] = [];
  const discarded: CardInstance[] = [];
  for (let i = a.energyAttached.length - 1; i >= 0; i--) {
    const e = a.energyAttached[i];
    if (toDiscard > 0 && pool.get(e.cardId)?.pokemonType === 'Fire') {
      discarded.unshift(e);
      toDiscard--;
    } else {
      newEnergies.unshift(e);
    }
  }
  if (discarded.length === 0) return state;
  return updatePlayer(
    addLog(state, `熔岩爆炸：自身丟棄 ${discarded.length} 張火能量到棄牌區`, aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: newEnergies } : null,
      discard: [...p.discard, ...discarded],
    }),
  );
});

// 輔助：unused import 防護
export type _v2580Sentinel = PlayerState;
type _APT = AttackPostFn;
