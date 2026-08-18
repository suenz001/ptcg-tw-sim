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

import type { PlayerState } from '../../types'; // v6.020：補 type-only import(TS2304 scanner)
import { regPre, regPost, regR, addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  getOwnBenchLimit, getAllAttachedTools,
  bareCardsForReturn,
} from '../_shared'; // v5.792 寶可夢連附加回手中央(含 extraTools+進化棧)
import { getKODefenderEnergyInDiscard, pluckOppEnergyActiveOrDiscard } from '../_shared'; // v5.776 KO對手戰鬥位能量搬移中央
import type { AttackPostFn, AttackPreFn } from '../_shared';
import { isReturnToHandBlockedByCalmGround as _calmGroundBlocks } from './v3080_deferred_wave_c'; // v5.986 場上卡→手牌中央述詞
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, flipCoinsWithLog, statusPost, selfHitPost as effectsSelfHitPost, dealAttackDamageToTarget, koTargetByAttackEffect, energyProvidesType, countAttachedEnergyAsUnits, returnSelfActiveEnergyPost, discardOppActiveEnergyPost } from '../../effects';
// v6.065「不看正面→從對手手牌選擇」中央收斂（卡面是「選擇」，不是隨機）
import { oppReturnChosenConcealedToDeckPost } from '../../effects';
import { defCantRetreatNextPost } from '../../effects'; // v5.802 中央禁撤退(免疫gate)
import { isBasicEnergyOfType } from '../../selection-filter'; // v6.210：基本能量屬性判定收斂中央述詞（leaf，Check O 安全）

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ══════════════════════════════════════════════════════════════════════════════

// v4.963: 基本能量 pokemonType=null fallback helper — 認屬性能量含 name【X】 fallback。
function isEnergyOfType(ec: any, type: string): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = (ec.name || '').match(/【(.+?)】/);
  if (!m) return false;
  const zh: Record<string, string> = { '草':'Grass','火':'Fire','水':'Water','雷':'Lightning','超':'Psychic','鬥':'Fighting','惡':'Darkness','鋼':'Metal','妖':'Fairy','龍':'Dragon','無':'Colorless' };
  return zh[m[1]] === type;
}

// v5.802：本地 defCantRetreatNextPost 移除，改用 effects.ts 中央版(含免疫 gate)。

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
function snipeNOppPokemonAutoPost(amount: number, count: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    // v5.961 卡面「對手的N隻寶可夢」= 任意(含戰鬥位)。原 opp-bench-choose 只列備戰→打不到戰鬥位、
    //   戰鬥位弱抗永無機會、對手無備戰時已丟能量卻 0 傷害。改 opp-poke-choose(active+bench)。
    const targets: string[] = [];
    if (opp.active) targets.push(opp.active.iid);
    for (const b of opp.bench) targets.push(b.iid);
    if (targets.length === 0) return addLog(state, `${label}：對手沒有寶可夢`, aIdx);
    const realCount = Math.min(count, targets.length);
    const s = addLog(state, `${label}：選 ${realCount} 隻對手寶可夢各受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: realCount, maxCount: realCount,
      effectKey: 'wave16-snipe-multi',
      params: { amount, label, validIids: targets },
    });
  };
}
regR('wave16-snipe-multi', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  if (amount === 0) return state;
  const label = (params?.label as string | undefined) ?? '雙尾';
  // v5.437：改走中央函式（補免疫/弱抗/KO/受傷反擊）。
  let s = state;
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, amount, pool, { kind: 'attack-damage', label });
    if (s.phase === 'game-over') return s;
  }
  return s;
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

// 雙彈瓦斯｜瘋狂炸彈 50+ — 生效版在 v2690_i_wave19_engine_hooks.ts(讀 attackUsedLastSelfTurn,上回合用過
// 充滿瓦斯則 50+120=170;engine END_TURN promote attackUsedThisTurn→attackUsedLastSelfTurn)。此處僅歷史註記。

// 泥巴魚｜泥巴伏特 20+ — 自身有【鬥】能量時 +20
regPre('泥巴魚|泥巴伏特', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 20 };
  const hasFighting = a.energyAttached.some(e => energyProvidesType(a, e, 'Fighting', pool)); // v5.683 host-aware(古舊/稜鏡等視為鬥)
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
  // v5.689：卡面「能量的數量」=能量單位數(host-aware,火箭隊2/燃火進化3)，原 .length 少算。
  const eN = a ? countAttachedEnergyAsUnits(a, _pool, state, aIdx) : 0;
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
regR('wave16-hit-any-opp', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  if (amount === 0) return state;
  const label = (params?.label as string | undefined) ?? '攻擊';
  // v5.437：改走中央函式（補免疫/弱抗/KO/受傷反擊）。卡面「受到傷害，[備戰不計弱抗]」→ active 計弱點。
  let s = state;
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, amount, pool, { kind: 'attack-damage', label });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 棄能量類（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 電蜘蛛｜放電 — 棄全雷能量, ×50
// v4.72: 基本【雷】能量 JSON 沒 pokemonType 欄位（同 v4.71 issue），改用 name fallback
//   isLightning = pokemonType === 'Lightning' OR card.name 含「【雷】」
function _isLightningEnergy(card: { pokemonType?: string; name?: string } | undefined): boolean {
  if (!card) return false;
  if (card.pokemonType === 'Lightning') return true;
  return !!(card.name && card.name.includes('【雷】'));
}
regPre('電蜘蛛|放電', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 0 };
  let lightning = 0;
  for (const e of a.energyAttached) {
    if (_isLightningEnergy(pool.get(e.cardId))) lightning++;
  }
  const dmg = lightning * 50;
  return { state: addLog(state, `放電：自身雷能量 ${lightning} 個 → ×50 = ${dmg}`, aIdx), damage: dmg };
});
regPost('電蜘蛛|放電', (state, aIdx, pool) => {
  // 棄全雷能量
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const lightning = p.active.energyAttached.filter(e => _isLightningEnergy(pool.get(e.cardId)));
    const remaining = p.active.energyAttached.filter(e => !_isLightningEnergy(pool.get(e.cardId)));
    return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...lightning] };
  });
});

// 雙尾怪手｜雙尾 — 棄 2 能量, 對手 2 隻備戰各 60（不計弱抗）
// v5.401：丟 2 能量改 units+picker（在 effects.ts batch 註冊 regPre+picker，傷害0）；此處只留狙擊
regPost('雙尾怪手|雙尾', snipeNOppPokemonAutoPost(60, 2, '雙尾'));

// 雪絨蛾｜極寒旋風 90 — 90 傷害 + 選 1 個自身【水】能量改附於備戰(v5.826 補實作;原「簡化純90」違反 Iron Rule 7)。
//   走中央 returnSelfActiveEnergyPost(typeFilter 'Water' 用 energyProvidesType,含古舊/稜鏡等視為水的特殊能量)。
regPre('雪絨蛾|極寒旋風', (s) => ({ state: s, damage: 90 }));
regPost('雪絨蛾|極寒旋風', returnSelfActiveEnergyPost(1, false, '極寒旋風', 'Water'));

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

// 洛托姆｜驚嚇 20 — 對手 1 張手牌回對手牌庫並重洗（卡面「不看正面」=盲選,隨機即正確模型,非簡化;v4.499 補揭示給攻方）
// v4.499 Fix C2 #3: 卡面「在不看正面的情況下，從對手的手牌選擇 1 張，查看那張卡的正面後放回對手的牌庫並重洗。」
//   攻方應該看到那張卡是什麼（揭示）。原實作只 addLog 公開 log 沒 addPrivateLog 揭示給攻方。
//   修法：addPrivateLog — public log「對手手牌隨機 1 張回牌庫」+ private（只攻方看到）「那張卡是 XX」
regPre('洛托姆|驚嚇', (s) => ({ state: s, damage: 20 }));
// v6.065：卡面是「**選擇**1張，查看正面後放回牌庫」→ 玩家盲選，不是隨機。
regPost('洛托姆|驚嚇', oppReturnChosenConcealedToDeckPost(1, '驚嚇'));

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
  // v5.986 平穩境地：被回手的是「自己」備戰寶可夢與附加卡 → 對手側有平穩境地則擋
  if (_calmGroundBlocks(state, aIdx, _pool)) {
    return addLog(state, '幸福迴旋：對手場上有【平穩境地】，無法放回手牌', aIdx);
  }
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
    // v5.792：用中央 bareCardsForReturn(主體+能量+全部道具 getAllAttachedTools+進化棧,全裸化)
    //   原手刻只取 toolAttached 漏 extraTools(多重轉接)、也漏 evolvedFromStack → 進化體/額外道具丟失。
    const restBench = p.bench.filter(b => b.iid !== targetIid);
    return { ...p, bench: restBench, hand: [...p.hand, ...bareCardsForReturn(target)] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 對手能量操作（2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 章魚桶｜水流清洗 20 — 若希望，選擇 1 個對手戰鬥寶可夢身上附加的能量，放回對手的手牌。
// v3.27：從自動取末端升級為玩家挑選（active-energy-discard picker / sourcePlayerIdx=dIdx，改 resolver：回對手手牌）。
// minCount=0 → 玩家可直接選 0 張等於「否」；1 張傳給 resolver 放回對手手牌。
regPre('章魚桶|水流清洗', (s) => ({ state: s, damage: 20 }));
regPost('章魚桶|水流清洗', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '水流清洗：選擇「否」 — 不放回對手能量', aIdx);
  // v5.986 平穩境地(原完全漏 gate)：被回手的是「對手」的能量 → 我方(1-aIdx 的對手=aIdx)側有平穩境地則擋。
  //   放在 _cb 之前 → 非KO與KO兩分支皆涵蓋。
  if (_calmGroundBlocks(state, (1 - aIdx) as 0 | 1, pool)) {
    return addLog(state, '水流清洗：我方場上有【平穩境地】，對手能量無法放回手牌', aIdx);
  }
  const _cb: AttackPostFn = (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.776：對手戰鬥位被本招式傷害 KO（active=null）→ 官方順序「效果先於昏厥」，仍可把 KO 前戰鬥位能量
  //   （此刻在棄牌區，_koDefenderSnapshot）放回對手手牌。
  if (!state.players[dIdx].active) {
    const _koE = getKODefenderEnergyInDiscard(state, dIdx).map(e => e.iid);
    if (_koE.length === 0) return addLog(state, '水流清洗：對手戰鬥無可放回的能量', aIdx);
    const _capKO = Math.min(1, _koE.length);
    return withPending(addLog(state, '水流清洗：對手戰鬥寶可夢已昏厥 — 可從棄牌區將其能量放回對手手牌', aIdx), {
      type: 'active-energy-discard', actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 0, maxCount: _capKO,
      effectKey: 'v327-octopus-water-clean',
      params: { fromDiscard: true, validIids: _koE, titleOverride: `選擇要放回對手手牌的能量（0∼${_capKO} 張，已昏厥戰鬥位）` },
    });
  }
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
};
  return _cb(state, aIdx, pool);
});
// resolver：將選中的對手戰鬥位能量移除 + 放入對手手牌（非棄牌！）。
regR('v327-octopus-water-clean', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '水流清洗：玩家選擇不發動效果', idx);
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  if (!targetIid) return st;
  // v5.776：能量可能在對手 active(未KO)或棄牌區(已被本招式KO)。
  const r = pluckOppEnergyActiveOrDiscard(st.players[dIdx], targetIid);
  if (!r.energy) return st;
  const eName = pool.get(r.energy.cardId)?.name ?? '?';
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...r.player, hand: [...r.player.hand, r.energy] };
  return addLog({ ...st, players }, `水流清洗：對手戰鬥位的 ${eName} 放回對手手牌`, idx);
});

// 毛崖蟹｜喀嚓鉗 — 擲 2 次, 對手戰鬥場能量 ×N 棄
regPre('毛崖蟹|喀嚓鉗', (s) => ({ state: s, damage: 0 }));
regPost('毛崖蟹|喀嚓鉗', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 2, '喀嚓鉗', aIdx);
  if (r.heads === 0) return addLog(r.state, '喀嚓鉗：0 正面，無棄能量', aIdx);
  // v5.974：選擇 N=正面數 → 中央 discardOppActiveEnergyPost(count=heads,選擇 picker + 免疫 gate),取代原自動從尾端丟。
  return discardOppActiveEnergyPost('喀嚓鉗', 'any', r.heads)(addLog(r.state, `喀嚓鉗：${r.heads} 次正面`, aIdx), aIdx, pool);
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
  return koTargetByAttackEffect(
    addLog(state, '斧擊衝撞：對手戰鬥場為基礎寶可夢 → KO', aIdx),
    aIdx, da, true, pool, '斧擊衝撞');
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 火箭隊招式（1 張）— 火箭隊的火焰鳥ex｜邪惡灼燒
//   棄 1 張「火箭隊能量」, 對手戰鬥寶可夢與附加卡全棄
//   v5.402：完整實作 — 檢查身上有「火箭隊能量」才發動(丟該能量+對手戰鬥KO),無則不發動,非簡化
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的火焰鳥ex|邪惡灼燒', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的火焰鳥ex|邪惡灼燒', (state, aIdx, pool) => {
  // v5.402：卡面「選擇1張這隻寶可夢身上附加的『火箭隊能量』，將其丟棄。這個情況下，將對手的戰鬥寶可夢
  //   與附加的卡全部丟棄。」→ 必須丟「火箭隊能量」(原簡化版丟任意能量+必KO是錯的)；身上沒有火箭隊能量
  //   則效果不發動(不丟能量、不KO)。火箭隊能量為同款卡、效果強制，無需 picker(選哪張無差別)。
  const a = state.players[aIdx].active;
  const rocketE = a?.energyAttached.find(e => pool.get(e.cardId)?.name === '火箭隊能量');
  if (!a || !rocketE) {
    return addLog(state, '邪惡灼燒：身上沒有「火箭隊能量」可丟棄，效果不發動', aIdx);
  }
  // 丟棄該火箭隊能量(只丟它,不動其他能量)
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => e.iid !== rocketE.iid) } : null,
    discard: [...p.discard, rocketE],
  }));
  s = addLog(s, '邪惡灼燒：丟棄 1 張火箭隊能量', aIdx);
  // 對手戰鬥場「與附加的卡全部丟棄」到棄牌區 — 是【丟棄】非昏厥(KO)，對手不抽獎賞（同化石丟棄）。
  //   v5.403 修正：原 v5.402 誤用 damage=hp(=KO,會給獎賞卡)。正解：整組(寶可夢+能量+道具+進化堆疊)
  //   進對手棄牌區、active=null(UI 自動彈補場選擇器)、不動雙方獎賞。
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = s.players[dIdx].active;
  if (da) {
    const discardEntries: CardInstance[] = [
      { ...da, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined,
        energyAttached: [], toolAttached: undefined, extraTools: [], evolvedFromStack: undefined, damage: 0 },
      ...da.energyAttached,
      ...getAllAttachedTools(da),
      ...(da.evolvedFromStack ?? []),
    ];
    s = updatePlayer(addLog(s, '邪惡灼燒：將對手戰鬥寶可夢與附加的卡全部丟棄到棄牌區（非昏厥，不給獎賞）', aIdx), dIdx, p => ({
      ...p,
      discard: [...p.discard, ...discardEntries],
      active: null,
    }));
    // 對手無備戰可補 → 直接終局（我方勝，非獎賞）；有備戰則 active=null 由 UI 自動彈 SEND_NEW_ACTIVE 補場。
    if (s.players[dIdx].bench.length === 0) {
      s = { ...s, phase: 'game-over' as const, winner: aIdx, winReason: `${s.players[dIdx].name} 沒有可上場的寶可夢` };
    }
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
    return isBasicEnergyOfType(card, 'Fire');
  });
  if (fireBasics.length === 0) return addLog(state, '龍之猛暴：棄牌區無基本火能量', aIdx);
  // v5.848：卡面「附於自己的【龍】寶可夢」→ 多隻龍時玩家選(原簡化只附戰鬥場)。基本火能量互換,取第一張(合法)。
  const dragons = [...(p.active ? [p.active] : []), ...p.bench].filter(c => pool.get(c.cardId)?.pokemonType === 'Dragon');
  if (dragons.length === 0) return addLog(state, '龍之猛暴：場上無【龍】寶可夢，能量不附加', aIdx);
  const energy = fireBasics[0];
  if (dragons.length === 1) {
    const tid = dragons[0].iid;
    return updatePlayer(addLog(state, `龍之猛暴：附 1 張基本火能量給 ${pool.get(dragons[0].cardId)?.name ?? '?'}`, aIdx), aIdx, pl => ({
      ...pl,
      discard: pl.discard.filter(c => c.iid !== energy.iid),
      active: pl.active && pl.active.iid === tid ? { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } : pl.active,
      bench: pl.bench.map(b => b.iid === tid ? { ...b, energyAttached: [...b.energyAttached, energy] } : b),
    }));
  }
  return withPending(addLog(state, '龍之猛暴：選 1 隻【龍】寶可夢附上基本火能量', aIdx), {
    type: 'heal-target', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'ryu-moubou-attach',
    // v6.129 ⚠ validIids 原本寫在 pending 頂層 → 三端都讀不到 ⇒ 可附給場上任何寶可夢，
    //   卡面「附於自己的1隻【龍】寶可夢」限制失效。
    params: { energyIid: energy.iid, validIids: dragons.map(d => d.iid) },
  });
});
// v5.848：龍之猛暴選龍寶可夢附火能量 resolver。
regR('ryu-moubou-attach', (st, idx, iids, params, pool) => {
  const tid = iids[0]; if (!tid) return st;
  const energyIid = params?.energyIid as string;
  const energy = st.players[idx].discard.find(c => c.iid === energyIid);
  if (!energy) return st;
  const nm = (() => { const t = [st.players[idx].active, ...st.players[idx].bench].find(c => c?.iid === tid); return t ? (pool.get(t.cardId)?.name ?? '?') : '?'; })();
  return updatePlayer(addLog(st, `龍之猛暴：附 1 張基本火能量給 ${nm}`, idx), idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => c.iid !== energyIid),
    active: pl.active && pl.active.iid === tid ? { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } : pl.active,
    bench: pl.bench.map(b => b.iid === tid ? { ...b, energyAttached: [...b.energyAttached, energy] } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 雜（1 張）— 蜜集大蛇｜大蛇吐息 — 棄手牌 6 張基本草能量, 對手戰鬥場 KO
// ══════════════════════════════════════════════════════════════════════════════
regPre('蜜集大蛇|大蛇吐息', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const grassBasics = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Grass');
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
    return isEnergyOfType(card, 'Grass') && card?.subtype === 'Basic';
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
    s = koTargetByAttackEffect(addLog(s, '大蛇吐息：對手戰鬥寶可夢昏厥', aIdx), aIdx, da, true, pool, '大蛇吐息');
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 16 統計：30 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
