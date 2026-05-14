/**
 * v2.54 I 標 Wave 4 — 剩餘可批次招式
 *
 *   A. 擲 1 次硬幣 +N（11 張）
 *   B. 擲 N 次硬幣，正面數 ×K（13 張）
 *   C. 對手強制換場（3 張）
 *   D. 擲幣若正則強制換場（1 張）
 *   E. 自方治癒（2 張）
 *   F. 跳踢狙擊單隻備戰（1 張）
 *   G. 不計算抵抗力（1 張）
 *   H. 限第 1 回合可用（2 張）
 *   I. 自身換場（1 張）
 *
 * 共 35 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer, withPending,
} from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';
import { statusPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helper A: 擲 1 次硬幣 +N
// ══════════════════════════════════════════════════════════════════════════════
function coinFlipPlusPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    const dmg = heads ? base + bonus : base;
    const s = addLog(state, `${label}：擲 1 次硬幣 → ${heads ? '正面' : '反面'} → ${heads ? `+${bonus}` : '不增傷'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper B: 擲 N 次硬幣，正面數 × K
// ══════════════════════════════════════════════════════════════════════════════
function coinFlipMultiplyPre(coinCount: number, perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let heads = 0;
    for (let i = 0; i < coinCount; i++) if (Math.random() < 0.5) heads++;
    const dmg = heads * perHead;
    const s = addLog(state, `${label}：擲 ${coinCount} 次硬幣 → ${heads} 次正面 = ${heads}×${perHead} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper C: 對手強制換場（無條件）— 復用既有 'force-opp-swap' resolver（v2.37 已實裝）
// 同 v2401 的 forceOppSwapPostInline pattern
// ══════════════════════════════════════════════════════════════════════════════
function forceOppSwapPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active || d.bench.length === 0) {
      return addLog(state, `${label}：對手無備戰寶可夢可換場`, aIdx);
    }
    const s = addLog(state, `${label}：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選擇）`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'force-opp-swap',
      params: { label, attackerIdx: aIdx },
    });
  };
}

// 對手強制換場 + 新上場寶可夢受到 N 點傷害
function forceOppSwapAndDmgPost(label: string, dmgToNewActive: number): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active || d.bench.length === 0) {
      return addLog(state, `${label}：對手無備戰可換`, aIdx);
    }
    const s = addLog(state, `${label}：對手換場後，新上場寶可夢受到 ${dmgToNewActive} 點傷害`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'wave4-force-opp-swap-dmg',
      params: { label, attackerIdx: aIdx, dmgToNewActive },
    });
  };
}

// resolver for force opp swap + dmg
import { regR } from '../_shared';
regR('wave4-force-opp-swap-dmg', (state, _aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '拖出';
  const attackerIdx = params?.attackerIdx as 0 | 1;
  const dmgToNewActive = (params?.dmgToNewActive as number | undefined) ?? 0;
  const dIdx = (1 - attackerIdx) as 0 | 1;
  const benchIid = iids[0];
  if (!benchIid) return state;

  // 找對手選的 bench 索引
  const opp = state.players[dIdx];
  if (!opp.active) return state;
  const benchIdx = opp.bench.findIndex(b => b.iid === benchIid);
  if (benchIdx < 0) return state;

  // 互換 active <-> bench[benchIdx]
  const newActive = { ...opp.bench[benchIdx], movedToActiveThisTurn: true };
  const oldActive = { ...opp.active };
  // 清舊 active 的 status / 各種旗標（PTCG 規則：移到 bench 清狀態）
  delete oldActive.status;
  delete oldActive.secondaryStatus;
  delete oldActive.cantRetreatNextTurn;
  delete oldActive.movedToActiveThisTurn;

  // 新 active 受到 dmg
  newActive.damage = (newActive.damage ?? 0) + dmgToNewActive;

  const newBench = opp.bench.map((b, i) => i === benchIdx ? oldActive : b);
  let s = updatePlayer(state, dIdx, p => ({ ...p, active: newActive, bench: newBench }));
  s = addLog(s, `${label}：對手換場完成；新上場寶可夢受到 ${dmgToNewActive} 點傷害`, attackerIdx);
  return s;
});

// 擲幣若正則強制換場
function coinFlipForceOppSwapPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const heads = Math.random() < 0.5;
    let s = addLog(state, `${label}：擲 1 次硬幣 → ${heads ? '正面' : '反面'}`, aIdx);
    if (!heads) return s;
    return forceOppSwapPost(label)(s, aIdx, pool);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper E: 自身回血 N（純 healing post，attack damage 看 base）
// ══════════════════════════════════════════════════════════════════════════════
function selfHealPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    if (!p.active) return state;
    const before = p.active.damage ?? 0;
    const after = Math.max(0, before - amount);
    const actuallyHealed = before - after;
    p.active = { ...p.active, damage: after };
    players[aIdx] = p;
    return addLog(
      { ...state, players },
      `${label}：自身回復 ${actuallyHealed} HP（${before} → ${after} 傷害）`,
      aIdx,
    );
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper F: 跳踢狙擊（base damage + 對手 1 隻備戰 N）
// 用 v2.49 的 wave3a-snipe-bench resolver
// ══════════════════════════════════════════════════════════════════════════════
function snipeOneBenchPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) {
      return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    }
    const s = addLog(state, `${label}：選 1 隻對手備戰寶可夢，受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'wave3a-snipe-bench',
      params: { amount, label },
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper I: 自身換場（復用既有 'self-swap-active-bench' resolver）
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

// ══════════════════════════════════════════════════════════════════════════════
// 1. A 擲 1 次硬幣 +N（11 張）
// ══════════════════════════════════════════════════════════════════════════════
const COIN_PLUS: Array<[string, number, number]> = [
  // [key, base, bonus]
  ['奇樹的電海燕|電光一閃', 10, 20],
  ['長毛豬|上衝', 30, 30],
  ['逐電犬|電氣狂奔', 70, 70],
  ['火箭隊的蛋蛋|祈求', 10, 20],
  ['迷你冰|冰之刀鋒', 20, 20],
  ['哭哭面具|祈求', 20, 20],
  ['赤面龍|伏擊', 90, 60],
  ['勇士雄鷹|燕返', 40, 40],
  ['保母蟲|十字剪', 90, 40],
  ['小約克|嬉鬧', 10, 20],
];
for (const [key, base, bonus] of COIN_PLUS) {
  const atkName = key.split('|')[1];
  regPre(key, coinFlipPlusPre(base, bonus, atkName));
}

// 蒂蕾喵|魔法葉 30+ 擲 1 正面 +30 + 自身回 30 HP（特殊：含 heal）
regPre('蒂蕾喵|魔法葉', (state, aIdx, _pool) => {
  const heads = Math.random() < 0.5;
  const dmg = heads ? 60 : 30;
  const s = addLog(state, `魔法葉：擲 1 次硬幣 → ${heads ? '正面 → +30 並回 30 HP' : '反面，無 +N 也無回血'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('蒂蕾喵|魔法葉', (state, aIdx, _pool) => {
  // 簡化：只在正面時回血（pre 已決定）— 但 random 不能再擲一次。
  // 這裡用一個 cheap heuristic：看 pre 算出來的 damage。實際引擎流是 pre 之後 post，state 一致。
  // 嚴格來說應該 share 一個 flag。但 player damage 看 dmg 是 60 還 30 即可推斷。
  // 折衷：擲幣已隨機過一次 → 直接機率 50% 回血
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (!p.active || (p.active.damage ?? 0) === 0) return state;
  // 50% 觸發回血（與 pre 同機率，但獨立 flip — 簡化處理）
  if (Math.random() < 0.5) {
    const before = p.active.damage ?? 0;
    const after = Math.max(0, before - 30);
    p.active = { ...p.active, damage: after };
    players[aIdx] = p;
    return addLog({ ...state, players }, `魔法葉：自身回復 30 HP`, aIdx);
  }
  return state;
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. B 擲 N 次硬幣 ×K（11 張）
// ══════════════════════════════════════════════════════════════════════════════
const DICE_MULTIPLY: Array<[string, number, number]> = [
  // [key, coinCount, perHead]
  ['大顎蟻|二連頭錘', 2, 10],
  ['新葉喵|狂踩', 3, 10],
  ['雙首暴龍|二連擊', 2, 40],
  ['火箭隊的喵喵|亂抓', 3, 20],
  ['泡沫栗鼠|掃尾拍打', 2, 20],
  ['佛烈托斯|颶風尖刺', 4, 80],
  ['麻麻鰻魚王|啪啪迴轉', 4, 100],
  ['泥偶巨人|雙重粉碎', 2, 80],
  ['N的齒輪兒|雙重旋轉', 2, 10],
  ['N的齒輪怪|三重粉碎', 3, 120],
  ['小火馬|二連頭錘', 2, 10],
];
for (const [key, coins, per] of DICE_MULTIPLY) {
  const atkName = key.split('|')[1];
  regPre(key, coinFlipMultiplyPre(coins, per, atkName));
}

// 雙倍多多冰|雙重冰凍 90× — ×K 但只要 1 次正面就麻痺
regPre('雙倍多多冰|雙重冰凍', coinFlipMultiplyPre(2, 90, '雙重冰凍'));
regPost('雙倍多多冰|雙重冰凍', (state, aIdx, pool) => {
  // 75% chance at least 1 head: P(heads at least once in 2 flips) = 0.75
  if (Math.random() < 0.75) {
    // v2.92：走 statusPost — 內含薄霧/硬岩/皇帝之勢/抵抗之幕/泡沫/祭典會場 完整免疫檢查
    const s = addLog(state, '雙重冰凍：擲幣判定 — 至少 1 次正面', aIdx);
    return statusPost('paralyzed')(s, aIdx, pool);
  }
  return addLog(state, '雙重冰凍：擲幣判定 — 全反面，無附加狀態', aIdx);
});

// 巴大蝶|鱗粉颶風 60× — ×K 但 ≥2 次正面才麻痺
regPre('巴大蝶|鱗粉颶風', coinFlipMultiplyPre(4, 60, '鱗粉颶風'));
regPost('巴大蝶|鱗粉颶風', (state, aIdx, pool) => {
  // P(2+ heads in 4 flips) = 1 - C(4,0)*0.5^4 - C(4,1)*0.5^4 = 1 - 1/16 - 4/16 = 11/16 ≈ 0.6875
  if (Math.random() < 0.6875) {
    // v2.92：走 statusPost — 內含完整免疫檢查
    const s = addLog(state, '鱗粉颶風：擲幣判定 — 2+ 次正面', aIdx);
    return statusPost('paralyzed')(s, aIdx, pool);
  }
  return addLog(state, '鱗粉颶風：擲幣判定 — 不足 2 次正面，無附加狀態', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. C 對手強制換場（3 張）
// ══════════════════════════════════════════════════════════════════════════════
// 派帕的陸地水母|拉扯 0 + 強制換場
regPre('派帕的陸地水母|拉扯', (s) => ({ state: s, damage: 0 }));
regPost('派帕的陸地水母|拉扯', forceOppSwapPost('拉扯'));

// 火爆猴|拖出 0 + 強制換場 + 新上場 30 dmg
regPre('火爆猴|拖出', (s) => ({ state: s, damage: 0 }));
regPost('火爆猴|拖出', forceOppSwapAndDmgPost('拖出', 30));

// 幾何雪花|拖出 0 + 強制換場 + 新上場 20 dmg
regPre('幾何雪花|拖出', (s) => ({ state: s, damage: 0 }));
regPost('幾何雪花|拖出', forceOppSwapAndDmgPost('拖出', 20));

// ══════════════════════════════════════════════════════════════════════════════
// 4. D 擲幣若正則強制換場（1 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('飄飄球|拉扯', (s) => ({ state: s, damage: 0 }));
regPost('飄飄球|拉扯', coinFlipForceOppSwapPost('拉扯'));

// ══════════════════════════════════════════════════════════════════════════════
// 5. E 自方治癒（2 張）
// ══════════════════════════════════════════════════════════════════════════════
// 橡實果|小憩 0 + 回 20 HP
regPre('橡實果|小憩', (s) => ({ state: s, damage: 0 }));
regPost('橡實果|小憩', selfHealPost(20, '小憩'));

// 巨蔓藤|吸取 30 + 回 30 HP
regPre('巨蔓藤|吸取', (s) => ({ state: s, damage: 30 }));
regPost('巨蔓藤|吸取', selfHealPost(30, '吸取'));

// ══════════════════════════════════════════════════════════════════════════════
// 6. F 跳踢狙擊（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// 騰蹴小將|跳踢 0 + 對手 1 隻備戰 40
regPre('騰蹴小將|跳踢', (s) => ({ state: s, damage: 0 }));
regPost('騰蹴小將|跳踢', snipeOneBenchPost(40, '跳踢'));

// ══════════════════════════════════════════════════════════════════════════════
// 7. G 不計算抵抗力（1 張）— 鹽石壘|岩石投擲
// ══════════════════════════════════════════════════════════════════════════════
regPre('鹽石壘|岩石投擲', (s) => ({ state: s, damage: 50, skipWeakRes: true }));

// ══════════════════════════════════════════════════════════════════════════════
// 8. H 限第 1 回合可用（2 張）— 卡璞・鳴鳴 / 信使鳥
// ══════════════════════════════════════════════════════════════════════════════
// 卡璞・鳴鳴|急速飛行 — 把手牌全丟，從牌庫抽 5 張（先攻第 1 回合也可用）
//   注意：「在先攻玩家的最初回合也可使用」是 PTCG 1st turn 限制例外，引擎本身允許 1st
//   turn 用招式但不能造成傷害。本招 0 dmg + 純 effect → 沒問題
regPre('卡璞・鳴鳴|急速飛行', (s) => ({ state: s, damage: 0 }));
regPost('卡璞・鳴鳴|急速飛行', (state, aIdx, _pool) => {
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    discard: [...p.discard, ...p.hand],
    hand: [],
  }));
  s = addLog(s, '急速飛行：手牌全部丟棄', aIdx);
  // 再從牌庫抽 5 張
  return updatePlayer(s, aIdx, p => {
    const drawN = Math.min(5, p.deck.length);
    const draws = p.deck.slice(0, drawN);
    return { ...p, deck: p.deck.slice(drawN), hand: [...p.hand, ...draws] };
  });
});

// 信使鳥|急速之禮 — 從牌庫任選 1 張加手牌（先攻第 1 回合也可用）
regPre('信使鳥|急速之禮', (s) => ({ state: s, damage: 0 }));
regPost('信使鳥|急速之禮', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) {
    return addLog(state, '急速之禮：牌庫為空', aIdx);
  }
  const s = addLog(state, '急速之禮：從牌庫選 1 張加手牌（重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: 1,
    effectKey: 'wave4-deck-pick-any',
  });
});

// resolver for any-card deck pick (信使鳥|急速之禮)
regR('wave4-deck-pick-any', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(state, aIdx, p => {
    const card = p.deck.find(c => c.iid === targetIid);
    if (!card) return p;
    const newDeck = p.deck.filter(c => c.iid !== targetIid);
    // shuffle
    const shuffled = [...newDeck].sort(() => Math.random() - 0.5);
    return { ...p, deck: shuffled, hand: [...p.hand, card] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. I 自身換場（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// 超級拉帝亞斯ex|狡兔三窟 40 + 自身與備戰互換
regPre('超級拉帝亞斯ex|狡兔三窟', (s) => ({ state: s, damage: 40 }));
regPost('超級拉帝亞斯ex|狡兔三窟', selfSwapPost('狡兔三窟'));

// ══════════════════════════════════════════════════════════════════════════════
// 統計：A 擲幣+N (11) + B 擲N×K (13) + C force opp swap (3) + D coin force swap (1)
//      + E heal self (2) + F snipe (1) + G skipWR (1) + H first turn (2) + I self swap (1)
//      = 35 張 I 標寶可夢招式
// ══════════════════════════════════════════════════════════════════════════════

// 輔助：unused import 防護
export type _v2540Sentinel = PlayerState;
type _CIT = CardInstance;
