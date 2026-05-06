/**
 * v2.59 I 標 Wave 9 — 對手 ex/階級條件 + Recharge + 手牌操控批次
 *
 *   A. 對手戰鬥場 ex 條件 +N (5 張)
 *   B. 對手戰鬥場 2 階進化 +N (1 張)
 *   C. 對手戰鬥場屬性條件 +N (1 張)
 *   D. 自方備戰人數失敗 (1 張)
 *   E. 自身下回合無法用此招（Recharge）(5 張)
 *   F. 對手下回合無法使用招式 (3 張)
 *   G. 對手下回合無法撤退 (4 張)
 *   H. 盲選棄/回對手手牌 (4 張)
 *   I. 對手手牌數 ×K (2 張)
 *   J. 簡單附能量 (1 張)
 *   K. 若希望抽到滿 6 (2 張)
 *   L. 若希望搜牌庫加手 (1 張)
 *
 * 共 30 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer,
} from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 對手戰鬥場是 ex/2階等條件 +N
// ══════════════════════════════════════════════════════════════════════════════
function defConditionPre(
  base: number, bonus: number,
  predicate: (defCard: { name: string; subtype?: string; stage?: string; pokemonType?: string } | undefined) => boolean,
  conditionDesc: string, label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const defCard = def ? pool.get(def.cardId) : undefined;
    const cond = predicate(defCard);
    const dmg = cond ? base + bonus : base;
    const s = addLog(state, `${label}：對手戰鬥場 ${cond ? `${conditionDesc} → +${bonus}` : `不符 ${conditionDesc}`} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身下回合無法用同名招式（Recharge）
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

// helper: 對手戰鬥場下回合無法使用招式（cantAttackThisTurn 由引擎於對手回合開始時設）
function defCantAttackNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantAttackPending: true };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${label}：對手戰鬥寶可夢下回合無法使用招式`, aIdx);
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
    return addLog({ ...state, players }, `${label}：對手下回合無法撤退`, aIdx);
  };
}

// helper: 從對手手牌隨機棄 N 張
function discardOppHandRandomPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.hand.length === 0) return addLog(state, `${label}：對手手牌為空`, aIdx);
    const discardCount = Math.min(n, opp.hand.length);
    // 隨機選 discardCount 張
    const idxs = [...Array(opp.hand.length).keys()];
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const pickedSet = new Set(idxs.slice(0, discardCount));
    return updatePlayer(
      addLog(state, `${label}：盲選對手 ${discardCount} 張手牌丟棄`, aIdx),
      dIdx, p => {
        const discarded = p.hand.filter((_, i) => pickedSet.has(i));
        const remaining = p.hand.filter((_, i) => !pickedSet.has(i));
        return { ...p, hand: remaining, discard: [...p.discard, ...discarded] };
      },
    );
  };
}

// helper: 從對手手牌隨機抽 N 張回牌庫並重洗
function returnOppHandRandomToDeckPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.hand.length === 0) return addLog(state, `${label}：對手手牌為空`, aIdx);
    const pickCount = Math.min(n, opp.hand.length);
    const idxs = [...Array(opp.hand.length).keys()];
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const pickedSet = new Set(idxs.slice(0, pickCount));
    return updatePlayer(
      addLog(state, `${label}：盲選對手 ${pickCount} 張手牌放回牌庫並重洗`, aIdx),
      dIdx, p => {
        const picked = p.hand.filter((_, i) => pickedSet.has(i));
        const remaining = p.hand.filter((_, i) => !pickedSet.has(i));
        // shuffle picked into deck
        const newDeck = [...p.deck, ...picked];
        for (let i = newDeck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
        }
        return { ...p, hand: remaining, deck: newDeck };
      },
    );
  };
}

// helper: 抽到手牌滿 6（從牌庫補）
function drawToFull6Post(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (player.hand.length >= 6) return addLog(state, `${label}：手牌已 ≥6 張，無需抽`, aIdx);
    const need = 6 - player.hand.length;
    const drawN = Math.min(need, player.deck.length);
    if (drawN === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    return updatePlayer(
      addLog(state, `${label}：抽 ${drawN} 張卡到手牌（補滿至 6）`, aIdx),
      aIdx, p => ({
        ...p,
        deck: p.deck.slice(drawN),
        hand: [...p.hand, ...p.deck.slice(0, drawN)],
      }),
    );
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// A. 對手戰鬥場 ex 條件 +N (5 張)
// ══════════════════════════════════════════════════════════════════════════════
const isExCard = (c: { subtype?: string; name?: string } | undefined): boolean => {
  if (!c) return false;
  return c.subtype === 'ex' || /ex$/i.test(c.name ?? '');
};
regPre('魔幻假面喵|上升綻放', defConditionPre(90, 90, isExCard, 'ex 寶可夢', '上升綻放'));
regPre('瑪俐的扒手貓|鋒利爪', defConditionPre(20, 40, isExCard, 'ex 寶可夢', '鋒利爪'));
regPre('瑪俐的酷豹|鋒利利爪', defConditionPre(70, 70, isExCard, 'ex 寶可夢', '鋒利利爪'));
regPre('爆炸頭水牛ex|黃金破壞', defConditionPre(100, 100, isExCard, 'ex 寶可夢', '黃金破壞'));

// ══════════════════════════════════════════════════════════════════════════════
// B. 對手戰鬥場 2 階進化 +N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('雷吉洛克ex|巨型岩石', defConditionPre(140, 140,
  (c) => (c?.stage ?? c?.subtype) === 'Stage2',
  '2 階進化', '巨型岩石',
));

// ══════════════════════════════════════════════════════════════════════════════
// C. 對手戰鬥場屬性條件 +N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('風速狗|懲治獠牙', defConditionPre(100, 100,
  (c) => c?.pokemonType === 'Darkness',
  '【惡】寶可夢', '懲治獠牙',
));

// ══════════════════════════════════════════════════════════════════════════════
// D. 自方備戰人數失敗 (1 張)
// 比克提尼|V戰力 — 備戰 ≤4 失敗
// ══════════════════════════════════════════════════════════════════════════════
regPre('比克提尼|V戰力', (state, aIdx, _pool) => {
  const benchCount = state.players[aIdx].bench.length;
  if (benchCount <= 4) {
    return { state: addLog(state, `V戰力：備戰 ${benchCount} 隻 (≤4) → 招式失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, `V戰力：備戰 ${benchCount} 隻 (≥5) → 120 傷害`, aIdx), damage: 120 };
});

// ══════════════════════════════════════════════════════════════════════════════
// E. Recharge — 自身下回合無法使用此招 (5 張)
// ══════════════════════════════════════════════════════════════════════════════
const RECHARGE_ATTACKS_W9: Array<[string, number]> = [
  ['奇樹的電肚蛙ex|閃電伏特', 230],
  ['畢力吉翁|綠寶石利刃', 130],
  ['浮潛鼬|水流斬', 140],
  ['騎士蝸牛|鐵之光炮', 120],
  ['斧牙龍|潛力', 90],
];
for (const [key, dmg] of RECHARGE_ATTACKS_W9) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, rechargePost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// F. 對手下回合無法使用招式 (3 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('N的多多冰|絕對零度', (s) => ({ state: s, damage: 60 }));
regPost('N的多多冰|絕對零度', defCantAttackNextPost('絕對零度'));

regPre('凍原熊|絕對零度', (s) => ({ state: s, damage: 150 }));
regPost('凍原熊|絕對零度', defCantAttackNextPost('絕對零度'));

regPre('噴嚏熊|渾身鼻水', (s) => ({ state: s, damage: 10 }));
regPost('噴嚏熊|渾身鼻水', defCantAttackNextPost('渾身鼻水'));

// ══════════════════════════════════════════════════════════════════════════════
// G. 對手下回合無法撤退 (4 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('三首惡龍ex|暗黑啃咬', (s) => ({ state: s, damage: 200 }));
regPost('三首惡龍ex|暗黑啃咬', defCantRetreatNextPost('暗黑啃咬'));

regPre('肋骨海龜|咬緊', (s) => ({ state: s, damage: 150 }));
regPost('肋骨海龜|咬緊', defCantRetreatNextPost('咬緊'));

regPre('赫普的沙螺蟒|地鳴', (s) => ({ state: s, damage: 30 }));
regPost('赫普的沙螺蟒|地鳴', defCantRetreatNextPost('地鳴'));

regPre('阿響的樹才怪|圍困', (s) => ({ state: s, damage: 20 }));
regPost('阿響的樹才怪|圍困', defCantRetreatNextPost('圍困'));

// 天蠍王|毒陣 — 中毒 + 對手下回合無法撤退
regPre('天蠍王|毒陣', (s) => ({ state: s, damage: 50 }));
regPost('天蠍王|毒陣', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = updatePlayer(
    addLog(state, '毒陣：對手戰鬥寶可夢【中毒】+ 下回合無法撤退', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        secondaryStatus: 'poisoned' as const,
        cantRetreatNextTurn: true,
      } : null,
    }),
  );
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// H. 盲選棄/回對手手牌 (4 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('長尾怪手|驚嚇', (s) => ({ state: s, damage: 20 }));
regPost('長尾怪手|驚嚇', returnOppHandRandomToDeckPost(1, '驚嚇'));

regPre('火箭隊的喵喵|占為己有', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的喵喵|占為己有', returnOppHandRandomToDeckPost(1, '占為己有'));

regPre('酷豹|拍落', (s) => ({ state: s, damage: 50 }));
regPost('酷豹|拍落', discardOppHandRandomPost(1, '拍落'));

regPre('火箭隊的鈴鐺響|鈴鈴吵鬧', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的鈴鐺響|鈴鈴吵鬧', discardOppHandRandomPost(1, '鈴鈴吵鬧'));

// 超級頭巾混混ex|不法之足 160 + 棄對手 1 手牌 + 棄對手牌庫頂 1
regPre('超級頭巾混混ex|不法之足', (s) => ({ state: s, damage: 160 }));
regPost('超級頭巾混混ex|不法之足', (state, aIdx, _pool) => {
  let s = discardOppHandRandomPost(1, '不法之足')(state, aIdx, _pool as never);
  // 再棄對手牌庫頂 1
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(s, dIdx, p => {
    if (p.deck.length === 0) return p;
    const top = p.deck[0];
    return { ...p, deck: p.deck.slice(1), discard: [...p.discard, top] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I. 對手手牌 ×K (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 狩獵鳳蝶|能量吸管 80× 對手手牌中能量數
regPre('狩獵鳳蝶|能量吸管', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  let count = 0;
  for (const c of opp.hand) {
    if (pool.get(c.cardId)?.supertype === 'Energy') count++;
  }
  const dmg = count * 80;
  const s = addLog(state, `能量吸管：對手手牌能量 ${count} 張 → ${count}×80 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 風妖精ex|奇跡棉花 50× 對手手牌中訓練家數
regPre('風妖精ex|奇跡棉花', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  let count = 0;
  for (const c of opp.hand) {
    if (pool.get(c.cardId)?.supertype === 'Trainer') count++;
  }
  const dmg = count * 50;
  const s = addLog(state, `奇跡棉花：對手手牌訓練家 ${count} 張 → ${count}×50 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// J. 簡單附能量 (1 張)
// 龍捲雲|玉樹臨風 — 自手牌 1 張基本能量附自身
// ══════════════════════════════════════════════════════════════════════════════
regPre('龍捲雲|玉樹臨風', (s) => ({ state: s, damage: 0 }));
regPost('龍捲雲|玉樹臨風', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const energyIdx = player.hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (energyIdx < 0 || !player.active) {
    return addLog(state, '玉樹臨風：手牌無基本能量', aIdx);
  }
  const energy = player.hand[energyIdx];
  return updatePlayer(
    addLog(state, '玉樹臨風：將 1 張基本能量從手牌附給自身', aIdx),
    aIdx, p => ({
      ...p,
      hand: p.hand.filter((_, i) => i !== energyIdx),
      active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// K. 若希望抽到滿 6 (2 張)
// 簡化：默認執行（玩家通常會選）
// ══════════════════════════════════════════════════════════════════════════════
regPre('夢妖魔ex|六之魔法', (s) => ({ state: s, damage: 150 }));
regPost('夢妖魔ex|六之魔法', drawToFull6Post('六之魔法'));

regPre('差不多娃娃|報恩', (s) => ({ state: s, damage: 30 }));
regPost('差不多娃娃|報恩', drawToFull6Post('報恩'));

// ══════════════════════════════════════════════════════════════════════════════
// L. 若希望搜牌庫加手 (1 張)
// 君主蛇ex|青草命令 — 150 + 若希望從牌庫挑 ≤3 加手
// 簡化：自動搜（玩家會用）— 用 deck-search picker 讓玩家自選
// ══════════════════════════════════════════════════════════════════════════════
regPre('君主蛇ex|青草命令', (s) => ({ state: s, damage: 150 }));
regPost('君主蛇ex|青草命令', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '青草命令：牌庫已空', aIdx);
  const max = Math.min(3, player.deck.length);
  const s = addLog(state, `青草命令：從牌庫挑 0~${max} 張任意卡加手牌（重洗）`, aIdx);
  // 用既有 wave5-add-pokemon-to-hand resolver 但改用 'deck-search' filter='all' 不行
  // 直接 inline resolver: 用 deck-search 無 filter
  return {
    ...s,
    pendingSelection: {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: max,
      effectKey: 'wave9-take-any-from-deck',
    },
  };
});

import { regR } from '../_shared';
import { shuffle } from '../_shared';
regR('wave9-take-any-from-deck', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(
      addLog(state, '青草命令：未選擇；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
    );
  }
  return updatePlayer(
    addLog(state, `青草命令：選 ${iids.length} 張卡加手牌；重洗牌庫`, aIdx),
    aIdx, p => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
    },
  );
});

// 輔助：unused import 防護
export type _v2590Sentinel = PlayerState;
type _CIT = CardInstance;
type _APT = AttackPostFn;
