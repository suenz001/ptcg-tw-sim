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
import type { Card } from '$lib/cards/types';
import { isRulePokemon } from '../../engine';
import {
  regPre, regPost,
  addLog, updatePlayer, withPending,
  fireOnHandEnergyAttached, // v5.782 從手牌附能→對手反應
} from '../_shared';
import { joinCardNames } from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';
import { statusPost } from '../../effects'; // v5.797 中央施狀態(gate 化隱/憨憨臉/特殊能量/祭典會場)
import { openPeekOppHandView } from '../../effects'; // v5.876 查看對手手牌 UI
import { defCantRetreatNextPost } from '../../effects'; // v5.802 中央禁撤退(免疫gate)
import { defCantAttackNextPost } from '../../effects'; // v5.805 中央禁招(免疫gate)
import { canApplyEffectToTarget } from '../../defense'; // v5.797 cantRetreat 免疫 gate

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
// v5.805：本地 defCantAttackNextPost 移除，改用 effects.ts 中央版(含免疫 gate)。

// helper: 對手戰鬥場下回合無法撤退
// v5.802：本地 defCantRetreatNextPost 移除，改用 effects.ts 中央版(含免疫 gate)。

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
    const _discNames = opp.hand.filter((_, i) => pickedSet.has(i)).map(c => _pool.get(c.cardId)?.name ?? '?').join('、');
    return updatePlayer(
      addLog(state, `${label}：盲選對手 ${discardCount} 張手牌丟棄 — ${_discNames}`, aIdx),
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
  return (state, aIdx, pool) => {
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
    const _rNames = opp.hand.filter((_, i) => pickedSet.has(i)).map(c => pool.get(c.cardId)?.name ?? '?').join('、'); // v5.863 雙方公開放回牌庫的卡名(Wilson裁定)
    return updatePlayer(
      addLog(state, `${label}：盲選對手 ${pickCount} 張手牌放回牌庫並重洗 — ${_rNames}`, aIdx),
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
// v3.67：改用 isRulePokemon helper（涵蓋未來新規則寶可夢類型）
const isExCard = (c: { subtype?: string; name?: string; supertype?: string; tags?: string[]; rulesText?: string } | undefined): boolean => {
  return isRulePokemon(c as Card | undefined);
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
regPost('天蠍王|毒陣', (state, aIdx, pool) => {
  // v5.797：收斂至中央 statusPost(gate 化隱/憨憨臉/特殊能量/祭典會場)+ defCantRetreatNextPost,
  //   原手刻 secondaryStatus + cantRetreatNextTurn 繞過免疫(對手化隱/泡沫水/祭典會場時仍中毒)。
  const s1 = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost('毒陣')(s1, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// H. 盲選棄/回對手手牌 (4 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('長尾怪手|驚嚇', (s) => ({ state: s, damage: 20 }));
regPost('長尾怪手|驚嚇', returnOppHandRandomToDeckPost(1, '驚嚇'));

regPre('火箭隊的喵喵|占為己有', (s) => ({ state: s, damage: 0 }));
// v5.179 Bug 2 完整實裝: 卡面「在不看正面的情況下, 從對手手牌選 1 張, 查看那張卡的正面後
// 放回對手牌庫並重洗」 — 改為 hand-discard picker (concealed mode 防揭露對手其他手牌),
// 玩家選 1 張背面 → resolver 揭示卡名 (公開 addLog) + 放回對手牌庫 + 重洗。
// 原 v2.x 用 returnOppHandRandomToDeckPost(1) 隨機選 + 不揭示, 違反卡面 (Rule 15)
regPost('火箭隊的喵喵|占為己有', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (opp.hand.length === 0) {
    return addLog(state, '占為己有：對手手牌為空', aIdx);
  }
  const s = addLog(state, '占為己有：從對手手牌選 1 張背面卡 (盲選, 查看正面後放回牌庫並重洗)', aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: aIdx,
    sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'meowth-thievery-reveal-return',
    params: { concealed: true, label: '占為己有' },
  });
});
regR('meowth-thievery-reveal-return', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const pickedIid = iids[0];
  const pickedInst = opp.hand.find(c => c.iid === pickedIid);
  if (!pickedInst) return state;
  const pickedCard = pool.get(pickedInst.cardId);
  const cardName = pickedCard?.name ?? '?';
  // 卡面「查看那張卡的正面」→ 公開揭示卡名 (addLog 全域可見)
  let s = addLog(state, `占為己有：查看到「${cardName}」, 放回對手牌庫並重洗`, aIdx);
  // 放回對手牌庫並重洗
  s = updatePlayer(s, dIdx, p => {
    const remaining = p.hand.filter(c => c.iid !== pickedIid);
    const newDeck = [...p.deck, pickedInst];
    // shuffle
    for (let i = newDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    return { ...p, hand: remaining, deck: newDeck };
  });
  return s;
});

regPre('酷豹|拍落', (s) => ({ state: s, damage: 50 }));
regPost('酷豹|拍落', discardOppHandRandomPost(1, '拍落'));

regPre('火箭隊的鈴鐺響|鈴鈴吵鬧', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的鈴鐺響|鈴鈴吵鬧', discardOppHandRandomPost(1, '鈴鈴吵鬧'));

// 超級頭巾混混ex|不法之足 160 + 棄對手 1 手牌 + 棄對手牌庫頂 1
regPre('超級頭巾混混ex|不法之足', (s) => ({ state: s, damage: 160 }));
regPost('超級頭巾混混ex|不法之足', (state, aIdx, pool) => {
  let s = discardOppHandRandomPost(1, '不法之足')(state, aIdx, pool);
  // 再棄對手牌庫頂 1
  const dIdx = (1 - aIdx) as 0 | 1;
  const top = s.players[dIdx].deck.slice(0, 1);
  if (top.length === 0) return s;
  s = addLog(s, `不法之足：棄對手牌庫頂 1 張：${joinCardNames(top, pool)}`, aIdx);
  return updatePlayer(s, dIdx, p => ({ ...p, deck: p.deck.slice(1), discard: [...p.discard, ...top] }));
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
// v5.876：查看對手手牌是玩家權益 → 攻後開 UI 讓玩家查看整副手牌(算張數只 log 數量不夠)
regPost('狩獵鳳蝶|能量吸管', (state, aIdx) => openPeekOppHandView(state, aIdx, '能量吸管'));

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
// v5.876：查看對手手牌 UI
regPost('風妖精ex|奇跡棉花', (state, aIdx) => openPeekOppHandView(state, aIdx, '奇跡棉花'));

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
  const hostIid = player.active.iid; // v5.782 附能目標(自身戰鬥位)
  const after = updatePlayer(
    addLog(state, '玉樹臨風：將 1 張基本能量從手牌附給自身', aIdx),
    aIdx, p => ({
      ...p,
      hand: p.hand.filter((_, i) => i !== energyIdx),
      active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] } : null,
    }),
  );
  return fireOnHandEnergyAttached(after, aIdx, hostIid, pool); // v5.782 補對手反應(侵蝕詛咒/麻痺門牙)
});

// ══════════════════════════════════════════════════════════════════════════════
// K. 若希望抽到滿 6 (2 張)
// v5.063 已實裝「若希望」binary-yes-no guard（非默認執行）。
// ══════════════════════════════════════════════════════════════════════════════
regPre('夢妖魔ex|六之魔法', (s) => ({ state: s, damage: 150 }));
regPost('夢妖魔ex|六之魔法', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '六之魔法：選擇「否」 — 跳過抽牌', aIdx);
  const _cb: AttackPostFn = drawToFull6Post('六之魔法');
  return _cb(state, aIdx, pool);
});

// v5.509：抽牌移到 regPre（傷害前）— 先補滿手牌再結算傷害/氣絕/拿獎。
regPre('差不多娃娃|報恩', (state, aIdx, pool, action) => {
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return { state: addLog(state, '報恩：選擇「否」 — 跳過抽牌', aIdx), damage: 30 };
  return { state: drawToFull6Post('報恩')(state, aIdx, pool), damage: 30 };
});

// ══════════════════════════════════════════════════════════════════════════════
// L. 若希望搜牌庫加手 (1 張)
// 君主蛇ex|青草命令 — 150 + 若希望從牌庫挑 ≤3 加手
// 若希望：binary-yes-no 決定要不要搜；要 → deck-search picker 讓玩家自選 ≤3 張加手（完整,非簡化）
// ══════════════════════════════════════════════════════════════════════════════
regPre('君主蛇ex|青草命令', (s) => ({ state: s, damage: 150 }));
regPost('君主蛇ex|青草命令', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '青草命令：選擇「否」 — 跳過搜尋', aIdx);
  const _cb: AttackPostFn = (state, aIdx, _pool) => {
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
};
  return _cb(state, aIdx, pool);
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
