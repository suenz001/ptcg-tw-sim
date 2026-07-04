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
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';
import { statusPost, flipCoinsWithLog, dealAttackDamageToTarget, oppSwapDmgPost } from '../../effects'; // v5.788 gust 攻擊方選中央

// ══════════════════════════════════════════════════════════════════════════════
// helper A: 擲 1 次硬幣 +N
// ══════════════════════════════════════════════════════════════════════════════
function coinFlipPlusPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    const heads = r.heads === 1;
    const dmg = heads ? base + bonus : base;
    const s = addLog(r.state, `${label}：${heads ? `正面 → +${bonus}` : '反面 → 不增傷'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper B: 擲 N 次硬幣，正面數 × K
// ══════════════════════════════════════════════════════════════════════════════
function coinFlipMultiplyPre(coinCount: number, perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, coinCount, label, aIdx);
    const heads = r.heads;
    const dmg = heads * perHead;
    const s = addLog(r.state, `${label}：擲 ${coinCount} 次硬幣 → ${heads} 次正面 = ${heads}×${perHead} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper C: 對手強制換場（無條件）— 復用既有 'force-opp-swap' resolver（v2.37 已實裝）
// 同 v2401 的 forceOppSwapPostInline pattern
// ══════════════════════════════════════════════════════════════════════════════
import { regR } from '../_shared'; // v5.788：保留供 wave4-deck-pick-any；已刪 force-opp-swap 死碼(gust 改走中央 oppSwapDmgPost)

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
// helper F: 任意目標狙擊（對手 active 或 1 隻備戰受 N）
// v5.445：跳踢卡面是「對手的1隻寶可夢」(active 或備戰皆可)，原本只做到 bench-only。
//   改用 opp-poke-choose picker + 中央 dealAttackDamageToTarget：
//   active 計弱點×2、備戰不計弱抗，含免疫(花之帷幔/神秘石居/對戰圓形等)與擊倒。
// ══════════════════════════════════════════════════════════════════════════════
function snipeAnyOppPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (!opp.active && opp.bench.length === 0) {
      return addLog(state, `${label}：對手沒有寶可夢`, aIdx);
    }
    // 只有 active（無備戰）→ 無需選擇，直接結算
    if (opp.bench.length === 0 && opp.active) {
      return dealAttackDamageToTarget(state, aIdx, opp.active.iid, amount, pool, { kind: 'attack-damage', label });
    }
    const s = addLog(state, `${label}：選擇對手任一寶可夢，受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'snipe-variable',
      params: { includeActive: true, damage: amount, label },
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
  const r = flipCoinsWithLog(state, 1, '魔法葉', aIdx);
  const heads = r.heads === 1;
  const dmg = heads ? 60 : 30;
  // v5.x：把擲幣結果存 _lastCoinHeads，regPost 用同一次結果決定回血（不再獨立重擲）
  const s = addLog({ ...r.state, _lastCoinHeads: r.heads }, `魔法葉：${heads ? '正面 → +30 並回 30 HP' : '反面，無 +N 也無回血'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('蒂蕾喵|魔法葉', (state, aIdx, _pool) => {
  // v5.x：改讀 regPre 存的 _lastCoinHeads（同一次擲幣），正面才回血。
  //   舊版於此獨立再擲一次 Math.random → 與 regPre 脫鉤（同 鱗粉颶風 v5.416 模式修正）。
  const headsThisAttack = (state._lastCoinHeads ?? 0) >= 1;
  if (!headsThisAttack) return state;
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (!p.active || (p.active.damage ?? 0) === 0) return state;
  const before = p.active.damage ?? 0;
  const after = Math.max(0, before - 30);
  p.active = { ...p.active, damage: after };
  players[aIdx] = p;
  return addLog({ ...state, players }, `魔法葉：自身回復 30 HP`, aIdx);
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
// v5.430：傷害與麻痺改用「同一次」擲幣（卡面：擲2次硬幣×90傷害，只要≥1正面就麻痺）。
//   舊版 regPost 另擲 Math.random()<0.75（脫鉤、偷吃步）→ 可能 2正面卻不麻痺/0正面卻麻痺，違反卡面。
//   改：regPre 擲 2 幣存 _lastCoinHeads，regPost 讀同一次結果（同 鱗粉颶風 v5.416 模式）。
regPre('雙倍多多冰|雙重冰凍', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 2, '雙重冰凍', aIdx);
  const heads = r.heads;
  const dmg = heads * 90;
  const s = addLog({ ...r.state, _lastCoinHeads: heads }, `雙重冰凍：擲 2 次硬幣 → ${heads} 次正面，造成 ${dmg} 點傷害`, aIdx);
  return { state: s, damage: dmg };
});
regPost('雙倍多多冰|雙重冰凍', (state, aIdx, pool) => {
  const heads = state._lastCoinHeads ?? 0;
  if (heads >= 1) {
    // v2.92：走 statusPost — 內含薄霧/硬岩/皇帝之勢/抵抗之幕/泡沫/祭典會場 完整免疫檢查
    const s = addLog(state, `雙重冰凍：${heads} 次正面（≥1）→ 對手麻痺`, aIdx);
    return statusPost('paralyzed')(s, aIdx, pool);
  }
  return addLog(state, '雙重冰凍：全反面，無附加狀態', aIdx);
});

// 巴大蝶|鱗粉颶風 60× — ×K 但 ≥2 次正面才麻痺
// v5.416：原為簡易安裝 — regPost 另擲 0.6875 機率決定麻痺，與 regPre 實際擲幣脫鉤
//   （1 正面也可能麻痺、3-4 正面也可能不麻痺）。改為 regPre 擲一次 4 幣、把正面數存
//   state._lastCoinHeads，regPost 用「同一次」結果判 ≥2 才麻痺。
regPre('巴大蝶|鱗粉颶風', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 4, '鱗粉颶風', aIdx);
  const heads = r.heads;
  const s = addLog({ ...r.state, _lastCoinHeads: heads }, `鱗粉颶風：擲 4 次硬幣 → ${heads} 次正面，造成 ${heads * 60} 點傷害`, aIdx);
  return { state: s, damage: heads * 60 };
});
regPost('巴大蝶|鱗粉颶風', (state, aIdx, pool) => {
  const heads = state._lastCoinHeads ?? 0;
  if (heads >= 2) {
    // v2.92：走 statusPost — 內含完整免疫檢查
    const s = addLog(state, `鱗粉颶風：${heads} 次正面（2+）→ 對手戰鬥寶可夢麻痺`, aIdx);
    return statusPost('paralyzed')(s, aIdx, pool);
  }
  return addLog(state, `鱗粉颶風：${heads} 次正面（不足 2）→ 無附加狀態`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. C 對手強制換場（3 張）
// ══════════════════════════════════════════════════════════════════════════════
// 派帕的陸地水母|拉扯 0 + 強制換場
regPre('派帕的陸地水母|拉扯', (s) => ({ state: s, damage: 0 }));
regPost('派帕的陸地水母|拉扯', oppSwapDmgPost(0, '拉扯')); // v5.788 gust=攻擊方選對手備戰

// 火爆猴|拖出 0 + 強制換場 + 新上場 30 dmg
regPre('火爆猴|拖出', (s) => ({ state: s, damage: 0 }));
regPost('火爆猴|拖出', oppSwapDmgPost(30, '拖出')); // v5.788 gust=攻擊方選

// 幾何雪花|拖出 0 + 強制換場 + 新上場 20 dmg
regPre('幾何雪花|拖出', (s) => ({ state: s, damage: 0 }));
regPost('幾何雪花|拖出', oppSwapDmgPost(20, '拖出')); // v5.788 gust=攻擊方選

// ══════════════════════════════════════════════════════════════════════════════
// 4. D 擲幣若正則強制換場（1 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('飄飄球|拉扯', (s) => ({ state: s, damage: 0 }));
regPost('飄飄球|拉扯', (state, aIdx, pool) => {
  // v5.788 擲幣正面→gust(攻擊方選對手備戰互換)
  const r = flipCoinsWithLog(state, 1, '拉扯', aIdx);
  if (r.heads !== 1) return addLog(r.state, '拉扯：反面，不互換', aIdx);
  return oppSwapDmgPost(0, '拉扯')(r.state, aIdx, pool);
});

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
regPost('騰蹴小將|跳踢', snipeAnyOppPost(40, '跳踢'));

// ══════════════════════════════════════════════════════════════════════════════
// 7. G 不計算抵抗力（1 張）— 鹽石壘|岩石投擲
// v4.495：原誤套 skipWeakRes（跳兩個），改 skipResistance（只跳抵抗力，弱點仍應計算）
// ══════════════════════════════════════════════════════════════════════════════
regPre('鹽石壘|岩石投擲', (s) => ({ state: s, damage: 50, skipResistance: true }));

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
    const shuffled = shuffle([...newDeck]);
    return { ...p, deck: shuffled, hand: [...p.hand, card] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. I 自身換場（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// 超級拉帝亞斯ex|狡兔三窟 40 + 自身與備戰互換
regPre('超級拉帝亞斯ex|狡兔三窟', (s) => ({ state: s, damage: 40 }));
regPost('超級拉帝亞斯ex|狡兔三窟', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '狡兔三窟：選擇「否」 — 不互換', aIdx);
  const _cb: AttackPostFn = selfSwapPost('狡兔三窟');
  return _cb(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 統計：A 擲幣+N (11) + B 擲N×K (13) + C force opp swap (3) + D coin force swap (1)
//      + E heal self (2) + F snipe (1) + G skipWR (1) + H first turn (2) + I self swap (1)
//      = 35 張 I 標寶可夢招式
// ══════════════════════════════════════════════════════════════════════════════

// 輔助：unused import 防護
export type _v2540Sentinel = PlayerState;
type _CIT = CardInstance;
