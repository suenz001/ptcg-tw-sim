/**
 * v2.41 I 標 Wave 2 — 抽牌 / 換場 / 牌庫搜能量類批次實裝
 *
 * 涵蓋：
 *   - 抽 N 張（2 張）：阿響的皮丘｜麻麻抽出、赫普的啪嚓海膽ex｜扣殺閃電
 *   - 自身換場（1 張）：風妖精｜急速折返
 *   - 對手換場（5 張）：駒刀小兵 / 蓋蓋蟲 / 怒鸚哥 / 萌芽鹿｜推倒、哈約克｜吼叫
 *   - 牌庫挑 N 張基本能量附自身（3 張）：蛋蛋｜果實盈滿、急凍鳥｜冰冷羽擊、雷電雲｜充電
 *
 * 共 11 張 I 標寶可夢招式 effect。
 *
 * 鐵律遵循：
 *   - 復用 effects.ts 既有 helper（withPending/regR/updatePlayer/shuffle/drawCards）
 *   - 對手換場用既有 'force-opp-swap' resolver（v2.37 已實裝）
 *   - 自身換場用既有 'self-swap-active-bench' resolver（v2.37 已實裝）
 *   - 不動 effects.ts 主檔
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, withPending, shuffle, drawCards,
  ATTACK_PRE_DISCARD_CHOICE, energyMatchesType,
} from '../_shared';
import type { AttackPostFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: drawNPost — 從自己牌庫抽 N 張卡
// ══════════════════════════════════════════════════════════════════════════════
function drawNPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const actualDraw = Math.min(n, player.deck.length);
    return addLog(drawCards(state, aIdx, actualDraw), `${label}：抽 ${actualDraw} 張卡`, aIdx);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: forceOppSwapPostInline — 強制對手換場（actor=對手）
// 復用既有 'force-opp-swap' resolver（effects.ts v2.37 line 9101 已實裝）
// ══════════════════════════════════════════════════════════════════════════════
function forceOppSwapPostInline(label: string): AttackPostFn {
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

// ══════════════════════════════════════════════════════════════════════════════
// helper: selfSwapPostInline — 自身與備戰互換
// 復用既有 'self-swap-active-bench' resolver
// ══════════════════════════════════════════════════════════════════════════════
function selfSwapPostInline(label: string): AttackPostFn {
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
// helper: deckSearchBasicEnergyPost — 從自己牌庫挑 N 張基本【type】能量附自身
// 用 deck-search picker + 自定 resolver
// ══════════════════════════════════════════════════════════════════════════════
function deckSearchBasicEnergyPost(
  n: number,
  type: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal'|'Fairy',
  label: string,
  resolverKey: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const validIids = player.deck
      .filter(c => {
        const cc = pool.get(c.cardId);
        return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && energyMatchesType(cc, type); // v5.450：基本能量 pokemonType=null，名稱-aware
      })
      .map(c => c.iid);
    if (validIids.length === 0) {
      // v5.495：牌庫非空仍開 view-picker 檢視牌庫 + 重洗（PTCG 隱藏資訊規則）。
      const sv = addLog(state, `${label}：牌庫無基本能量；檢視牌庫後重洗`, aIdx);
      return withPending(sv, {
        type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
        filter: 'any', minCount: 0, maxCount: 0,
        effectKey: 'search-to-hand-reshuffle',
        params: { label: `${label}（檢視牌庫）` },
      });
    }
    const s = addLog(state, `${label}：從牌庫選最多 ${n} 張基本能量附於自身`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy',
      minCount: 0, maxCount: n,
      effectKey: resolverKey,
      params: { validIids, label },
    });
  };
}

// 共用 resolver — 把選的能量從牌庫附到自身 active；空選擇仍重洗
regR('wave2-deck-energy-attach-self', (state, aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '搜能量';
  if (iids.length === 0) {
    return addLog(
      updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) })),
      `${label}：未選擇能量；牌庫重洗`, aIdx,
    );
  }
  return updatePlayer(
    addLog(state, `${label}：將 ${iids.length} 張能量從牌庫附到戰鬥場`, aIdx),
    aIdx, p => {
      if (!p.active) return p;
      const chosen = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return {
        ...p,
        deck: shuffle(rest),
        active: { ...p.active, energyAttached: [...p.active.energyAttached, ...chosen] },
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. 抽 N 張 — 2 張
// ══════════════════════════════════════════════════════════════════════════════
const DRAW_N_ATTACKS: Array<[string, number, number]> = [
  // [key, damage, drawN]
  ['阿響的皮丘|麻麻抽出', 30, 1],
  ['赫普的啪嚓海膽ex|扣殺閃電', 120, 2],
];
for (const [key, dmg, drawCnt] of DRAW_N_ATTACKS) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, drawNPost(drawCnt, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 自身換場 — 1 張（風妖精｜急速折返 50 + self swap）
// ══════════════════════════════════════════════════════════════════════════════
regPre('風妖精|急速折返', (s) => ({ state: s, damage: 50 }));
regPost('風妖精|急速折返', selfSwapPostInline('急速折返'));

// ══════════════════════════════════════════════════════════════════════════════
// 3. 對手換場 — 5 張（駒刀小兵/蓋蓋蟲/怒鸚哥/萌芽鹿｜推倒、哈約克｜吼叫）
// ──────────────────────────────────────────────────────────────────────────────
// 強制換場（無「若希望」）— 駒刀小兵/蓋蓋蟲/萌芽鹿 推倒 + 哈約克 吼叫
// 怒鸚哥|推倒 在下方單獨處理（卡面「若希望」→ binary-yes-no）
// ══════════════════════════════════════════════════════════════════════════════
const FORCE_OPP_SWAP_ATTACKS: Array<[string, number]> = [
  ['駒刀小兵|推倒', 10],
  ['蓋蓋蟲|推倒', 10],
  ['萌芽鹿|推倒', 50],
  ['哈約克|吼叫', 0],
];
for (const [key, dmg] of FORCE_OPP_SWAP_ATTACKS) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, forceOppSwapPostInline(atkName));
}

// 怒鸚哥｜推倒 20 — 卡面「若希望，將對手的戰鬥寶可夢與備戰寶可夢互換」
// v4.42：仿 v3.26 粉碎重壓 binary-yes-no pattern，讓玩家選擇是否觸發換場效果
ATTACK_PRE_DISCARD_CHOICE.set('怒鸚哥|推倒', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 20, damagePerEnergy: 0,
  choicePrompt: '是否將對手的戰鬥寶可夢與備戰寶可夢互換？',
  choiceYesLabel: '是（強制換場，由對手選備戰）',
  choiceNoLabel: '否（只造成 20 傷害）',
});
regPre('怒鸚哥|推倒', (s) => ({ state: s, damage: 20 }));
regPost('怒鸚哥|推倒', (state, aIdx, _pool, action) => {
  // 同步 PRE 的 yes/no 選擇
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return addLog(state, '推倒：選「否」 → 不換場', aIdx);
  }
  // 「是」→ 走 forceOppSwap 流程
  return forceOppSwapPostInline('推倒')(state, aIdx, _pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 牌庫挑基本能量附自身 — 3 張
// ══════════════════════════════════════════════════════════════════════════════
const ENERGY_SEARCH_ATTACKS: Array<[string, number, number, 'Grass'|'Water'|'Lightning']> = [
  ['蛋蛋|果實盈滿', 0, 1, 'Grass'],
  ['急凍鳥|冰冷羽擊', 0, 2, 'Water'],
  ['雷電雲|充電', 0, 1, 'Lightning'],
];
for (const [key, dmg, n, type] of ENERGY_SEARCH_ATTACKS) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, deckSearchBasicEnergyPost(n, type, atkName, 'wave2-deck-energy-attach-self'));
}

// 統計：抽 N(2) + 自換場(1) + 對手換場(5) + 牌庫搜能量(3) = 11 張

// 輔助：unused import 防護
export type _v2401Sentinel = PlayerState;
type _CardInstanceTouch = CardInstance;
