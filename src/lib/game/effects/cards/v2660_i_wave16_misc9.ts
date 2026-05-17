/**
 * v2.66 I 標 Wave 16 — 雜項第九批（30 張）
 *
 * 涵蓋：
 *   - 簡單條件 +N (4 張)
 *   - 場上條件 ×N (3 張)
 *   - 棄能量類 (3 張)
 *   - 對手不可撤退 (2 張)
 *   - 自身免疫 (1 張)
 *   - recharge / 下回合 (2 張)
 *   - 對手手牌操作 (2 張)
 *   - 雙狀態 / 自選狀態 (3 張)
 *   - 自身互換 (1 張)
 *   - 對手能量操作 (2 張)
 *   - 條件失敗 (2 張)
 *   - 火箭隊招式 (1 張)
 *   - 牌庫挑 (1 張)
 *   - 自方回滿 HP (1 張)
 *   - 棄牌區能量轉移 (1 張)
 *   - 雜 (1 張)
 */

import { regPre, regPost, regR, addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  getOwnBenchLimit,
} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, flipCoinsWithLog, statusPost, selfHitPost as effectsSelfHitPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ══════════════════════════════════════════════════════════════════════════════

function defCantRetreatNextPost(): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(state, (1 - aIdx) as 0|1, p => ({
      ...p,
      active: p.active ? { ...p.active, cantRetreatNextTurn: true } : null,
    }));
  };
}

function rechargePost(attackName: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), attackName],
      } : null,
    }));
  };
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    const s = addLog(state, `${label}：自身丟棄全部能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    const k = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：自身丟棄 ${k} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

// 對手 N 隻備戰 各受 amount
function snipeNOppBenchAutoPost(amount: number, count: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    const realCount = Math.min(count, opp.bench.length);
    const s = addLog(state, `${label}：選 ${realCount} 隻對手備戰各受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: realCount, maxCount: realCount,
      effectKey: 'wave16-snipe-multi',
      params: { amount, label },
    });
  };
}
regR('wave16-snipe-multi', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  const dIdx = (1 - aIdx) as 0 | 1;
  const set = new Set(iids);
  return updatePlayer(state, dIdx, p => ({
    ...p,
    bench: p.bench.map(b => set.has(b.iid) ? { ...b, damage: (b.damage ?? 0) + amount } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. 簡單條件 +N（4 張）
// ══════════════════════════════════════════════════════════════════════════════

// 恰雷姆｜七度踢腿 — 自手牌 = 7 才出 150 否則失敗
regPre('恰雷姆|七度踢腿', (state, aIdx, _pool) => {
  const handN = state.players[aIdx].hand.length;
  if (handN !== 7) {
    return { state: addLog(state, `七度踢腿：自手牌 ${handN} 張 ≠ 7 → 招式失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, '七度踢腿：自手牌 = 7 → 150', aIdx), damage: 150 };
});

// 恰雷姆｜合氣掌 50+ — 自身能量數 = 對手戰鬥場能量數時 +120
regPre('恰雷姆|合氣掌', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const d = state.players[(1-aIdx) as 0|1].active;
  const aE = a?.energyAttached.length ?? 0;
  const dE = d?.energyAttached.length ?? 0;
  if (aE === dE) {
    return { state: addLog(state, `合氣掌：能量數同 ${aE} → 50+120 = 170`, aIdx), damage: 170 };
  }
  return { state: addLog(state, `合氣掌：能量數 ${aE} vs ${dE} → 50`, aIdx), damage: 50 };
});

// 雙彈瓦斯｜瘋狂炸彈 50+ — 簡化純 50（「上回合用了充滿瓦斯」狀態追蹤過於複雜）
regPre('雙彈瓦斯|瘋狂炸彈', (s) => ({ state: s, damage: 50 }));

// 泥巴魚｜泥巴伏特 20+ — 自身有【鬥】能量時 +20
regPre('泥巴魚|泥巴伏特', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 20 };
  const hasFighting = a.energyAttached.some(e => pool.get(e.cardId)?.pokemonType === 'Fighting');
  if (hasFighting) return { state: addLog(state, '泥巴伏特：有鬥能量 → 20+20 = 40', aIdx), damage: 40 };
  return { state: addLog(state, '泥巴伏特：無鬥能量 → 20', aIdx), damage: 20 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 場上條件 ×N（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 火箭隊的雙彈瓦斯｜一併爆炸 40× — 雙方場上含「瓦斯彈/雙彈瓦斯」名稱寶可夢數
regPre('火箭隊的雙彈瓦斯|一併爆炸', (state, aIdx, pool) => {
  let count = 0;
  for (const idx of [0, 1] as const) {
    const p = state.players[idx];
    for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
      const card = pool.get(c.cardId);
      if (card?.name?.includes('瓦斯彈') || card?.name?.includes('雙彈瓦斯')) count++;
    }
  }
  const dmg = count * 40;
  return { state: addLog(state, `一併爆炸：場上瓦斯數 ${count} → ${count}×40 = ${dmg}`, aIdx), damage: dmg };
});

// 石居蟹｜抓狂 10× — 自身傷害指示物 ×10
regPre('石居蟹|抓狂', (state, aIdx, _pool) => {
  const counters = Math.floor((state.players[aIdx].active?.damage ?? 0) / 10);
  const dmg = counters * 10;
  return { state: addLog(state, `抓狂：自身指示物 ${counters} 個 → ${counters}×10 = ${dmg}`, aIdx), damage: dmg };
});

// 堅果啞鈴｜強力鞭打 — 對手 1 隻寶可夢，受到自身能量數 ×20（不計弱抗）
regPre('堅果啞鈴|強力鞭打', (s) => ({ state: s, damage: 0, skipWeakRes: true }));
regPost('堅果啞鈴|強力鞭打', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const eN = a?.energyAttached.length ?? 0;
  const amount = eN * 20;
  if (amount === 0) return addLog(state, '強力鞭打：自身無能量', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0 && !state.players[dIdx].active) return state;
  const s = addLog(state, `強力鞭打：選 1 隻對手寶可夢受 ${amount}`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave16-hit-any-opp',
    params: { amount },
  });
});
regR('wave16-hit-any-opp', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  return updatePlayer(state, dIdx, p => {
    if (p.active && p.active.iid === targetIid) {
      return { ...p, active: { ...p.active, damage: (p.active.damage ?? 0) + amount } };
    }
    return { ...p, bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: (b.damage ?? 0) + amount } : b) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 棄能量類（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 電蜘蛛｜放電 — 棄全雷能量, ×50
regPre('電蜘蛛|放電', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 0 };
  let lightning = 0;
  for (const e of a.energyAttached) {
    if (pool.get(e.cardId)?.pokemonType === 'Lightning') lightning++;
  }
  const dmg = lightning * 50;
  return { state: addLog(state, `放電：自身雷能量 ${lightning} 個 → ×50 = ${dmg}`, aIdx), damage: dmg };
});
regPost('電蜘蛛|放電', (state, aIdx, pool) => {
  // 棄全雷能量
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const lightning = p.active.energyAttached.filter(e => pool.get(e.cardId)?.pokemonType === 'Lightning');
    const remaining = p.active.energyAttached.filter(e => pool.get(e.cardId)?.pokemonType !== 'Lightning');
    return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...lightning] };
  });
});

// 雙尾怪手｜雙尾 — 棄 2 能量, 對手 2 隻備戰各 60（不計弱抗）
regPre('雙尾怪手|雙尾', (s) => ({ state: s, damage: 0, skipWeakRes: true }));
regPost('雙尾怪手|雙尾', (state, aIdx, pool) => {
  let s = selfDiscardNEnergyPost(2, '雙尾')(state, aIdx, pool);
  return snipeNOppBenchAutoPost(60, 2, '雙尾')(s, aIdx, pool);
});

// 雪絨蛾｜極寒旋風 90 — 簡化純 90（移轉自能量到備戰過於複雜）
regPre('雪絨蛾|極寒旋風', (s) => ({ state: s, damage: 90 }));

// ══════════════════════════════════════════════════════════════════════════════
// 4. 對手不可撤退（2 張）
// ══════════════════════════════════════════════════════════════════════════════

const NO_RETREAT: Array<[string, number]> = [
  ['駒刀小兵|窮追不捨', 10],
  ['沙鈴仙人掌|窮追不捨', 20],
];
for (const [key, dmg] of NO_RETREAT) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, defCantRetreatNextPost());
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. 自身免疫（1 張）— 小嘴蝸｜硬殼一擊 20 — 擲幣正面下回合不受招式傷害
// ══════════════════════════════════════════════════════════════════════════════
regPre('小嘴蝸|硬殼一擊', (s) => ({ state: s, damage: 20 }));
regPost('小嘴蝸|硬殼一擊', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '硬殼一擊', aIdx);
  if (r.heads === 0) return addLog(r.state, '硬殼一擊：反面，無免疫', aIdx);
  // 利用既有 damageReduceNextHit (既有機制 -200) 設置完全免疫近似 → 設一個極大值
  return updatePlayer(
    addLog(r.state, '硬殼一擊：正面 → 下回合不受招式傷害（用 -999 模擬）', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageReduceNextHit: 999 } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. recharge / 下回合（2 張）
// ══════════════════════════════════════════════════════════════════════════════

regPre('流氓熊貓|力量衝撞', (s) => ({ state: s, damage: 160 }));
regPost('流氓熊貓|力量衝撞', rechargePost('力量衝撞'));

// 超級雷電獸ex｜閃光射線 120 — 在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害
// v3.27 修正：v3.22 誤實裝為「下次被打 -100」（damageReduceNextHit）——完全錯誤！
// 卡面是對【基礎】寶可夢招式完全免疫（非減傷），更改為既有 immuneToBasicAttackNextTurn flag（
// 同名機制已有：鋁鋼橋龍｜塗層攻擊 v2.101 已建）。engine.ts 會在 owner END_TURN promote NextTurn → ThisTurn，
// 對手回合攻擊時： attacker.stage 等於 'Basic' 且 defender.immuneToBasicAttackThisTurn → 傷害歸零。
regPre('超級雷電獸ex|閃光射線', (s) => ({ state: s, damage: 120 }));
regPost('超級雷電獸ex|閃光射線', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '閃光射線：下個對手回合這隻寶可夢不會受到【基礎】寶可夢招式的傷害', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, immuneToBasicAttackNextTurn: true } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 對手手牌操作（2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 洛托姆｜驚嚇 20 — 對手隨機 1 張手牌回對手牌庫並重洗（隨機簡化）
// v4.499 Fix C2 #3: 卡面「在不看正面的情況下，從對手的手牌選擇 1 張，查看那張卡的正面後放回對手的牌庫並重洗。」
//   攻方應該看到那張卡是什麼（揭示）。原實作只 addLog 公開 log 沒 addPrivateLog 揭示給攻方。
//   修法：addPrivateLog — public log「對手手牌隨機 1 張回牌庫」+ private（只攻方看到）「那張卡是 XX」
regPre('洛托姆|驚嚇', (s) => ({ state: s, damage: 20 }));
regPost('洛托姆|驚嚇', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (opp.hand.length === 0) return addLog(state, '驚嚇：對手手牌已空', aIdx);
  const idx = Math.floor(Math.random() * opp.hand.length);
  const picked = opp.hand[idx];
  const pickedName = pool.get(picked.cardId)?.name ?? '?';
  // 攻方 private log 揭示那張卡是什麼；對手側只看到「隨機 1 張回牌庫」
  let s = addPrivateLog(
    state,
    `驚嚇：對手手牌隨機 1 張（${pickedName}）回牌庫並重洗`,  // private（給攻方 aIdx）
    '驚嚇：對手手牌隨機 1 張回牌庫並重洗',                       // public（對手看到）
    aIdx,
  );
  return updatePlayer(s, dIdx, p => {
    const newHand = [...p.hand.slice(0, idx), ...p.hand.slice(idx + 1)];
    return { ...p, hand: newHand, deck: shuffle([...p.deck, picked]) };
  });
});

// 魔牆人偶｜模仿 — 自手牌洗回, 抽 = 對手手牌數
regPre('魔牆人偶|模仿', (s) => ({ state: s, damage: 0 }));
regPost('魔牆人偶|模仿', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '模仿：自手牌洗回，抽 = 對手手牌數', aIdx),
    aIdx, p => {
      const oppHandN = state.players[(1-aIdx) as 0|1].hand.length;
      const newDeck = shuffle([...p.deck, ...p.hand]);
      const taken = newDeck.slice(0, oppHandN);
      return { ...p, hand: taken, deck: newDeck.slice(oppHandN) };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 雙狀態 / 自選狀態（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 敏捷蟲｜褪殼猛毒 70 — 中毒+混亂+自身與備戰互換
// JSON：「將對手的戰鬥寶可夢【中毒】與【混亂】。將這隻寶可夢與備戰寶可夢互換。」
// v4.35：補自身與備戰互換（rule 7 嚴禁簡化）。卡面無「若希望」→ 強制互換
regPre('敏捷蟲|褪殼猛毒', (s) => ({ state: s, damage: 70 }));
regPost('敏捷蟲|褪殼猛毒', (state, aIdx, pool) => {
  let s = statusPost('poisoned')(state, aIdx, pool);
  s = statusPost('confused')(s, aIdx, pool);
  // 備戰區空 → 無法互換，addLog 帶過（招式仍正常結束）
  const p = s.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(s, '褪殼猛毒：備戰區無寶可夢可互換', aIdx);
  }
  // 卡面無「若希望」→ minCount:1 強制互換（復用 self-swap-active-bench resolver）
  s = addLog(s, '褪殼猛毒：選 1 隻備戰寶可夢與戰鬥場互換', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'self-swap-active-bench',
    params: { label: '褪殼猛毒' },
  });
});

// 裙兒小姐｜幻惑芳香 30 — 擲幣正面 中毒+麻痺，反面 混亂
regPre('裙兒小姐|幻惑芳香', (s) => ({ state: s, damage: 30 }));
regPost('裙兒小姐|幻惑芳香', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '幻惑芳香', aIdx);
  if (r.heads === 1) {
    let s = statusPost('poisoned')(r.state, aIdx, pool);
    return statusPost('paralyzed')(s, aIdx, pool);
  }
  return statusPost('confused')(r.state, aIdx, pool);
});

// 塗標客｜奇跡作畫 90 — 擲幣正面從特殊狀態選 1 施加
// JSON：「擲1次硬幣若為正面，則從特殊狀態中選擇1種，將對手的戰鬥寶可夢處於那個狀態。」
// v4.34：固定 asleep → modal-choice 5 狀態任選（rule 7 嚴禁簡化）
regPre('塗標客|奇跡作畫', (s) => ({ state: s, damage: 90 }));
regPost('塗標客|奇跡作畫', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '奇跡作畫', aIdx);
  if (!r.heads) return addLog(r.state, '→ 反面，無附加狀態', aIdx);
  // 正面：開 modal-choice 讓玩家從 5 種特殊狀態選 1
  return withPending(r.state, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'miracle-painting-status',
    params: {
      label: '選擇特殊狀態',
      titleOverride: '奇跡作畫：正面！從特殊狀態中選 1 種施加給對手戰鬥寶可夢',
      options: [
        { id: 'poisoned', text: '中毒' },
        { id: 'burned', text: '灼傷' },
        { id: 'asleep', text: '睡眠' },
        { id: 'confused', text: '混亂' },
        { id: 'paralyzed', text: '麻痺' },
      ],
    },
  });
});
// resolver：讀取選擇 → 套 statusPost（內含薄霧/抵抗之幕/憨憨臉/不眠/祭典會場 guard）
regR('miracle-painting-status', (st, idx, iids, _params, pool) => {
  const choice = iids[0] as 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed';
  return statusPost(choice)(st, idx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 自身互換（1 張）— 心蝙蝠｜幸福迴旋 — 選 1 隻自方備戰寶可夢與其附加卡放回手牌
// ══════════════════════════════════════════════════════════════════════════════
regPre('心蝙蝠|幸福迴旋', (s) => ({ state: s, damage: 0 }));
regPost('心蝙蝠|幸福迴旋', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) return addLog(state, '幸福迴旋：自方備戰區無寶可夢', aIdx);
  const s = addLog(state, '幸福迴旋：選 1 隻自方備戰寶可夢與附加卡全回手', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave16-bench-to-hand',
  });
});
regR('wave16-bench-to-hand', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(state, aIdx, p => {
    const target = p.bench.find(b => b.iid === targetIid);
    if (!target) return p;
    // 把目標 bench 寶可夢與其附加（能量/道具）回手牌
    const restBench = p.bench.filter(b => b.iid !== targetIid);
    // 主寶可夢卡（重置 damage / energyAttached / toolAttached / status，避免帶污染回手）
    const mainCard = { iid: target.iid, cardId: target.cardId, damage: 0, energyAttached: [] };
    const energyCards = target.energyAttached.map(e => ({ iid: e.iid, cardId: e.cardId, damage: 0, energyAttached: [] }));
    const toolCard = target.toolAttached ? [{ iid: target.toolAttached.iid, cardId: target.toolAttached.cardId, damage: 0, energyAttached: [] }] : [];
    return { ...p, bench: restBench, hand: [...p.hand, mainCard, ...energyCards, ...toolCard] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 對手能量操作（2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 章魚桶｜水流清洗 20 — 若希望，選擇 1 個對手戰鬥寶可夢身上附加的能量，放回對手的手牌。
// v3.27：從自動取末端升級為玩家挑選（active-energy-discard picker / sourcePlayerIdx=dIdx，改 resolver：回對手手牌）。
// minCount=0 → 玩家可直接選 0 張等於「否」；1 張傳給 resolver 放回對手手牌。
regPre('章魚桶|水流清洗', (s) => ({ state: s, damage: 20 }));
regPost('章魚桶|水流清洗', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];
  if (!dp.active || dp.active.energyAttached.length === 0) {
    return addLog(state, '水流清洗：對手戰鬥位沒有能量', aIdx);
  }
  const s = addLog(state, '水流清洗：選擇 0∼1 個對手戰鬥位能量放回對手手牌', aIdx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: 1,
    effectKey: 'v327-octopus-water-clean',
    params: { titleOverride: '選擇要放回對手手牌的能量（0∼1 張）' },
  });
});
// resolver：將選中的對手戰鬥位能量移除 + 放入對手手牌（非棄牌！）。
regR('v327-octopus-water-clean', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '水流清洗：玩家選擇不發動效果', idx);
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return st;
  const targetIid = iids[0];
  const energyInst = dp.active.energyAttached.find(e => e.iid === targetIid);
  if (!energyInst) return st;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const s = addLog(st, `水流清洗：對手戰鬥位的 ${eName} 放回對手手牌`, idx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== targetIid) }
      : pl.active,
    hand: [...pl.hand, energyInst],
  }));
});

// 毛崖蟹｜喀嚓鉗 — 擲 2 次, 對手戰鬥場能量 ×N 棄
regPre('毛崖蟹|喀嚓鉗', (s) => ({ state: s, damage: 0 }));
regPost('毛崖蟹|喀嚓鉗', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 2, '喀嚓鉗', aIdx);
  const heads = r.heads;
  if (heads === 0) return addLog(r.state, '喀嚓鉗：0 正面，無棄能量', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(r.state, `喀嚓鉗：${heads} 正面 → 棄對手 ${heads} 個能量`, aIdx), dIdx, p => {
    if (!p.active || p.active.energyAttached.length === 0) return p;
    const k = Math.min(heads, p.active.energyAttached.length);
    const remaining = p.active.energyAttached.slice(0, -k);
    const discarded = p.active.energyAttached.slice(-k);
    return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 條件失敗（2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 打擊鬼｜上升劈打 90 — 對手非 ex 失敗, 不計弱抗
regPre('打擊鬼|上升劈打', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return { state, damage: 0 };
  const card = pool.get(da.cardId);
  const isEx = card?.subtype?.includes('ex') || card?.name?.endsWith('ex');
  if (!isEx) {
    return { state: addLog(state, '上升劈打：對手戰鬥場非 ex → 招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, '上升劈打：對手 ex → 90', aIdx), damage: 90, skipWeakRes: true };
});

// 雙斧戰龍｜斧擊衝撞 — 對手戰鬥場為基礎寶可夢時 KO
regPre('雙斧戰龍|斧擊衝撞', (s) => ({ state: s, damage: 0 }));
regPost('雙斧戰龍|斧擊衝撞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return state;
  const card = pool.get(da.cardId);
  if (card?.stage !== 'Basic' && card?.subtype !== 'Basic') {
    return addLog(state, '斧擊衝撞：對手戰鬥場非基礎，效果無效', aIdx);
  }
  const hp = card?.hp ?? 0;
  return updatePlayer(
    addLog(state, '斧擊衝撞：對手戰鬥場為基礎寶可夢 → KO', aIdx),
    dIdx, p => ({ ...p, active: p.active ? { ...p.active, damage: hp } : null }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 火箭隊招式（1 張）— 火箭隊的火焰鳥ex｜邪惡灼燒
//   棄 1 張「火箭隊能量」, 對手戰鬥寶可夢與附加卡全棄
//   簡化：棄 1 個能量（不檢查火箭能量）+ 對手戰鬥昏厥
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的火焰鳥ex|邪惡灼燒', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的火焰鳥ex|邪惡灼燒', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a || a.energyAttached.length === 0) {
    return addLog(state, '邪惡灼燒：自身無能量可丟棄', aIdx);
  }
  let s = selfDiscardNEnergyPost(1, '邪惡灼燒')(state, aIdx, pool);
  // 對手戰鬥場 KO
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = s.players[dIdx].active;
  if (da) {
    const card = pool.get(da.cardId);
    const hp = card?.hp ?? 0;
    s = updatePlayer(addLog(s, '邪惡灼燒：對手戰鬥寶可夢全棄（KO）', aIdx), dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damage: hp } : null,
    }));
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. 牌庫挑（1 張）— 小山豬｜呼朋引伴 — 從牌庫挑 ≤2 張基礎寶可夢放備戰
// ══════════════════════════════════════════════════════════════════════════════
regPre('小山豬|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('小山豬|呼朋引伴', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  // v3.80：支援零之大空洞
  const benchSpace = Math.max(0, getOwnBenchLimit(state, aIdx, pool) - p.bench.length);
  if (benchSpace === 0 || p.deck.length === 0) return state;
  const realMax = Math.min(2, benchSpace);
  const s = addLog(state, `呼朋引伴：從牌庫挑 0~${realMax} 張基礎寶可夢放備戰（重洗）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: realMax,
    effectKey: 'wave5-place-basic-bench',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 自方回滿 HP（1 張）— 大奶罐｜飽腹鮮奶 — 擲 2 次全正 → 1 隻自方寶可夢回滿 HP
// ══════════════════════════════════════════════════════════════════════════════
regPre('大奶罐|飽腹鮮奶', (s) => ({ state: s, damage: 0 }));
regPost('大奶罐|飽腹鮮奶', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 2, '飽腹鮮奶', aIdx);
  if (r.heads !== 2) {
    return addLog(r.state, '飽腹鮮奶：未達全正面', aIdx);
  }
  const s = addLog(r.state, '飽腹鮮奶：全正 → 選 1 隻自方寶可夢回滿', aIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave16-heal-full',
  });
});
regR('wave16-heal-full', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(state, aIdx, p => {
    if (p.active && p.active.iid === targetIid) {
      return { ...p, active: { ...p.active, damage: 0 } };
    }
    return { ...p, bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: 0 } : b) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. 棄牌區能量轉移（1 張）— 赤面龍｜龍之猛暴 20 — 從棄牌區挑 1 張基本火能量附自方龍寶可夢
// ══════════════════════════════════════════════════════════════════════════════
regPre('赤面龍|龍之猛暴', (s) => ({ state: s, damage: 20 }));
regPost('赤面龍|龍之猛暴', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const fireBasics = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Fire' || card.name.includes('【火】'));
  });
  if (fireBasics.length === 0) return addLog(state, '龍之猛暴：棄牌區無基本火能量', aIdx);
  // 簡化：自動附給戰鬥場（若戰鬥場是 Dragon 才行）
  const a = p.active;
  if (!a) return state;
  const card = pool.get(a.cardId);
  if (card?.pokemonType !== 'Dragon') {
    return addLog(state, '龍之猛暴：戰鬥場非龍寶可夢，能量不附加', aIdx);
  }
  const energy = fireBasics[0];
  return updatePlayer(
    addLog(state, '龍之猛暴：從棄牌區挑 1 張基本火能量附給戰鬥場龍寶可夢', aIdx),
    aIdx, pl => ({
      ...pl,
      discard: pl.discard.filter(c => c.iid !== energy.iid),
      active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 雜（1 張）— 蜜集大蛇｜大蛇吐息 — 棄手牌 6 張基本草能量, 對手戰鬥場 KO
// ══════════════════════════════════════════════════════════════════════════════
regPre('蜜集大蛇|大蛇吐息', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const grassBasics = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Grass' || card.name.includes('【草】'));
  });
  if (grassBasics.length < 6) {
    return { state: addLog(state, `大蛇吐息：手牌基本草能量 ${grassBasics.length} 張 < 6 → 招式失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, '大蛇吐息：手牌基本草能量 ≥ 6 → 對手戰鬥 KO', aIdx), damage: 0 };
});
regPost('蜜集大蛇|大蛇吐息', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const grassBasics = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Grass';
  });
  if (grassBasics.length < 6) return state;
  const six = grassBasics.slice(0, 6);
  const sixSet = new Set(six.map(c => c.iid));
  let s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !sixSet.has(c.iid)),
    discard: [...pl.discard, ...six],
  }));
  s = addLog(s, '大蛇吐息：手牌棄 6 張基本草能量', aIdx);
  // 對手戰鬥 KO
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = s.players[dIdx].active;
  if (da) {
    const card = pool.get(da.cardId);
    const hp = card?.hp ?? 0;
    s = updatePlayer(addLog(s, '大蛇吐息：對手戰鬥寶可夢昏厥', aIdx), dIdx, pl => ({
      ...pl,
      active: pl.active ? { ...pl.active, damage: hp } : null,
    }));
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 16 統計：30 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
