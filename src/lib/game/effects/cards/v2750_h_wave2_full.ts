/**
 * v2.75 H 標 Wave 2 — 完整批次（80+ 張）
 *
 * 嚴格按照卡牌原文實裝，不簡化。
 * 用既有 helper：coinHeadsMultiplyPre / coinStatusPost / statusPost / hitBenchPickPost / 等
 * 必要時新增本檔 inline helper。
 */

import {
  regPre, regPost, regR, addLog, addPrivateLog, updatePlayer, withPending, shuffle, getAllAttachedTools, toBareCard,
  bareCardsForReturn, // v5.781 bounce 到牌庫中央收斂
  getOwnBenchLimit, countAttachedEnergyAsUnits, energyMatchesType,
  fireOnHandEnergyAttached, // v5.782 從手牌附能→對手反應
} from '../_shared';
import { placedBenchInstance } from '../_shared'; // v5.745 放場裸化+justPlaced中央
import { logPickedCards } from '../_shared'; // v6.097 揭示卡名中央來源
import { clearActiveEffects } from '../_shared'; // v5.743 離場清狀態
import { evolvedStatusAfter, buildEvolvedInstance } from '../_shared'; // v5.741/v5.742 進化狀態+建構中央
import { openDeckViewReshuffle, revealTopCardsLog } from '../_shared';
import { joinCardNames } from '../_shared';
import { getBasicEnergyType } from '../../engine'; // v6.009 resolver 端 re-validate 基本能量屬性(防作弊)
import { cellAwakeningStep } from './v2650_i_wave15_misc8'; // v5.983 收斂「進化全備戰」chain(與人造細胞卵|細胞覺醒共用)
import {
  ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS, ATTACK_PRE_DISCARD_CHOICE,
} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import { canApplyEffectToTarget } from '../../defense';
import { defCantRetreatNextPost, discardOppActiveEnergyPost, selfCantAttackNextPost, oppSwapDmgPost } from '../../effects'; // v5.840 收斂禁撤退+化隱gate; v5.973 咬碎能量丟棄中央; v5.982 全鎖自鎖
import { openPeekOppHandView } from '../../effects'; // v5.876 查看對手手牌 UI
import { registerDirectEvolveAwaken } from '../../effects'; // v6.078 「覺醒」型直接進化中央 helper
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  coinStatusPost, statusPost, coinHeadsMultiplyPre, flipCoinsWithLog,
  hitBenchPickPost, canApplyAttackEffectToTarget, resolveBenchGuard, dealAttackDamageToTarget, selfHitPost,
  snipeOneOppBenchPost, koTargetByAttackEffect,
} from '../../effects';
import { applyOppActiveDebuffPost } from '../../effects'; // v6.046 對手 debuff 中央(含招式效果免疫 gate)
import { oppPokemonImmuneToAttackEffect } from '../../effects';
// v6.065「不看正面→從對手手牌選擇」中央收斂（卡面是「選擇」，不是隨機）
import { oppDiscardChosenConcealedPost } from '../../effects';
import { hasAnyEffectiveAbility } from './v3001_g3_wave3'; // v6.049「擁有特性的寶可夢」中央述詞 // v5.809 bounce/招式效果免疫述詞
// v3.12: 海紋石之雨升級為多目標分配，借 startEnergyChain 處理
import { startEnergyChain } from './v158_energy_chain';

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

function rechargePost(attackName: string): AttackPostFn {
  return (state, aIdx, _pool) => updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), attackName],
    } : null,
  }));
}

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const k = Math.min(n, att.energyAttached.length);
    return updatePlayer(addLog(state, `${label}：自身丟棄 ${k} 個能量`, aIdx), aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    return updatePlayer(addLog(state, `${label}：自身丟棄全部能量`, aIdx), aIdx, p => {
      if (!p.active) return p;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...p.active.energyAttached] };
    });
  };
}

function drawNPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => updatePlayer(
    addLog(state, `${label}：抽 ${n} 張`, aIdx),
    aIdx, p => {
      const k = Math.min(n, p.deck.length);
      return { ...p, deck: p.deck.slice(k), hand: [...p.hand, ...p.deck.slice(0, k)] };
    },
  );
}

// 對手 1 隻備戰受 N

// 對手 1 隻寶可夢任選（含戰鬥場）
function hitAnyOneOppPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (!opp.active && opp.bench.length === 0) return state;
    return withPending(addLog(state, `${label}：選 1 隻對手寶可夢受 ${amount}`, aIdx), {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'h-wave2-hit-any-opp',
      params: { amount },
    });
  };
}
regR('h-wave2-hit-any-opp', (state, aIdx, iids, params, pool) => {
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

// 對手所有備戰各受 N（不選）
function allOppBenchAddDamagePost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const benchIids = state.players[dIdx].bench.map(b => b.iid);
    // v5.437：改走中央函式（補免疫/KO/受傷反擊）。備戰不計弱抗（中央函式 isActive gate 自動）。
    let s = addLog(state, `${label}：對手所有備戰各受 ${amount}`, aIdx);
    for (const iid of benchIids) {
      s = dealAttackDamageToTarget(s, aIdx, iid, amount, pool, { kind: 'attack-damage', label });
      if (s.phase === 'game-over') return s;
    }
    return s;
  };
}

// 對手戰鬥場狀態
function coinReverseFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (r.heads === 0) return { state: addLog(r.state, `${label}：反面 → 招式失敗`, aIdx), damage: 0 };
    return { state: addLog(r.state, `${label}：正面`, aIdx), damage: base };
  };
}

function coinHeadsUntilTailsPre(perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let s = state, heads = 0;
    while (true) {
      const r = flipCoinsWithLog(s, 1, label, aIdx);
      s = r.state;
      if (r.heads === 0) break;
      heads++;
      if (heads >= 30) break;
    }
    const dmg = heads * perHead;
    return { state: addLog(s, `${label}：${heads} 正面 → ${heads}×${perHead} = ${dmg}`, aIdx), damage: dmg };
  };
}

function coinHeadsUntilTailsBonusPre(base: number, perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let s = state, heads = 0;
    while (true) {
      const r = flipCoinsWithLog(s, 1, label, aIdx);
      s = r.state;
      if (r.heads === 0) break;
      heads++;
      if (heads >= 30) break;
    }
    const dmg = base + heads * perHead;
    return { state: addLog(s, `${label}：${heads} 正面 → ${base}+${heads}×${perHead} = ${dmg}`, aIdx), damage: dmg };
  };
}

// 上回合自身使用過某招式 → +bonus
function lastSelfTurnUsedAttackPre(base: number, bonus: number, requiredAtkName: string, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    const last = a?.attackUsedLastSelfTurn;
    if (last === requiredAtkName) {
      return { state: addLog(state, `${label}：上個自己回合用過「${requiredAtkName}」 → ${base}+${bonus} = ${base + bonus}`, aIdx), damage: base + bonus };
    }
    return { state: addLog(state, `${label}：未使用過「${requiredAtkName}」 → ${base}`, aIdx), damage: base };
  };
}

// 必須上回合用過 X 才能用（fail if not）
function requirePrevAttackPre(base: number, requiredAtkName: string, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (a?.attackUsedLastSelfTurn !== requiredAtkName) {
      return { state: addLog(state, `${label}：上個自己回合未使用「${requiredAtkName}」 → 招式失敗`, aIdx), damage: 0 };
    }
    return { state: addLog(state, `${label}：條件成立 → ${base}`, aIdx), damage: base };
  };
}

// 自身與對手戰鬥能量數同 → +bonus
function sameEnergyCountPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    const d = state.players[(1-aIdx) as 0|1].active;
    const aE = a?.energyAttached.length ?? 0;
    const dE = d?.energyAttached.length ?? 0;
    if (aE === dE) return { state: addLog(state, `${label}：能量數同 ${aE} → ${base}+${bonus} = ${base+bonus}`, aIdx), damage: base + bonus };
    return { state: addLog(state, `${label}：能量數 ${aE} vs ${dE} → ${base}`, aIdx), damage: base };
  };
}

// 自身與對手戰鬥能量數合計 ×N
function bothBenchEnergyCountPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    const d = state.players[(1-aIdx) as 0|1].active;
    const total = (a?.energyAttached.length ?? 0) + (d?.energyAttached.length ?? 0);
    return { state: addLog(state, `${label}：雙方戰鬥能量合計 ${total} → ${base}+${total}×${per} = ${base + total*per}`, aIdx), damage: base + total*per };
  };
}

// 自身手牌 = N 才能用（否則失敗）
function exactHandSizePre(base: number, requiredN: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const handN = state.players[aIdx].hand.length;
    if (handN !== requiredN) return { state: addLog(state, `${label}：自手牌 ${handN} ≠ ${requiredN} → 招式失敗`, aIdx), damage: 0 };
    return { state: addLog(state, `${label}：自手牌 = ${requiredN} → ${base}`, aIdx), damage: base };
  };
}

// 雙方手牌數同 否則失敗
function sameHandCountPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const aN = state.players[aIdx].hand.length;
    const dN = state.players[(1-aIdx) as 0|1].hand.length;
    if (aN !== dN) return { state: addLog(state, `${label}：自${aN} vs 對手${dN} 不同 → 招式失敗`, aIdx), damage: 0 };
    return { state: addLog(state, `${label}：手牌數同 ${aN} → ${base}`, aIdx), damage: base };
  };
}

// 牌庫挑 ≤N 基本能量分配備戰（共通，先簡化為加手）
function deckSearchBasicEnergiesAnyPost(max: number, label: string, sameTypes: boolean = false, publicReveal: boolean = true): AttackPostFn {
  return (state, aIdx, _pool) => {
    if (state.players[aIdx].deck.length === 0) return state;
    return withPending(addLog(state, `${label}：從牌庫挑 0~${max} 張基本能量加手（玩家手動分配；重洗）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: sameTypes ? 'BasicEnergy:DistinctTypes' : 'BasicEnergy',
      minCount: 0, maxCount: max,
      effectKey: 'wave13-deck-take-any',
      // v6.097 ⚠ 本 helper 目前**零呼叫端**（v3.10 起三個原使用者都改成「附於寶可夢身上」）。
      //   保留簽名，publicReveal 由參數帶入，避免將來被接上時預設成錯誤方向。
      params: { label, publicReveal },
    });
  };
}

// 牌庫挑 1 張基礎寶可夢放備戰
function deckSearchBasicToBenchPost(max: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    // v3.80：支援零之大空洞
    const space = Math.max(0, getOwnBenchLimit(state, aIdx, pool) - p.bench.length);
    if (space === 0 || p.deck.length === 0) return state;
    const realMax = Math.min(max, space);
    return withPending(addLog(state, `${label}：從牌庫挑 0~${realMax} 張基礎寶可夢放備戰（重洗）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Basic',
      minCount: 0, maxCount: realMax,
      effectKey: 'wave5-place-basic-bench',
    });
  };
}

// 從棄牌區挑 ≤N 基本能量加手
function discardSearchBasicEnergiesPost(max: number, label: string, type?: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.discard.length === 0) return state;
    const validIids = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!(card?.supertype === 'Energy' && card.subtype === 'Basic')) return false;
      if (type && !energyMatchesType(card, type)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    }).map(c => c.iid);
    if (validIids.length === 0) return addLog(state, `${label}：棄牌區無對應基本能量`, aIdx);
    return withPending(addLog(state, `${label}：從棄牌區挑 0~${Math.min(max, validIids.length)} 張基本能量加手`, aIdx), {
      type: 'discard-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy',
      minCount: 0, maxCount: Math.min(max, validIids.length),
      effectKey: 'h-wave2-pickup-energy-to-hand',
      params: { validIids },
    });
  };
}
// v6.097：原 log 只有張數。共用此 resolver 的卡面（差不多娃娃｜招喚
//   「從自己的棄牌區選擇1張支援者卡，在給對手看過後加入手牌」等）都要求揭示卡名。
//   來源是棄牌區＝公開資訊，寫出卡名不可能造成資訊洩漏，一律公開。
regR('h-wave2-pickup-energy-to-hand', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const set = new Set(iids);
  const pickedForLog = state.players[aIdx].discard.filter(c => set.has(c.iid));
  return updatePlayer(logPickedCards(state, aIdx, pickedForLog, pool, '從棄牌區取回', '加入手牌', { publicReveal: true }), aIdx, p => {
    const picked = p.discard.filter(c => set.has(c.iid));
    const rest = p.discard.filter(c => !set.has(c.iid));
    return { ...p, discard: rest, hand: [...p.hand, ...picked] };
  });
});

// v3.09 從棄牌區挑 ≤N 基本能量 → 附到 1 隻備戰寶可夢身上（雙階段 pending）
//   花舞鳥｜能量支援（MC 133/742）等卡使用此 pattern
function discardSearchAttachToBenchPost(max: number, label: string, type?: string, distribute = false): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：備戰區沒有寶可夢`, aIdx);
    if (p.discard.length === 0) return addLog(state, `${label}：棄牌區為空`, aIdx);
    const validIids = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!(card?.supertype === 'Energy' && card.subtype === 'Basic')) return false;
      if (type && !energyMatchesType(card, type)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    }).map(c => c.iid);
    if (validIids.length === 0) return addLog(state, `${label}：棄牌區無對應基本能量`, aIdx);
    // v5.858：卡面「以任意方式附於備戰」→ 走中央 startEnergyChain(source discard, scope bench-only)
    //   讓玩家逐張選目標分散（原 h-wave2-pickup 只能選 1 隻塞全部，違反「以任意方式」）。
    //   「附於 1 隻備戰」型(能量支援)維持 distribute=false 的單目標流程。source=discard 不重洗、不觸發手牌附能反應。
    if (distribute) {
      return withPending(addLog(state, `${label}：從棄牌區挑 0~${Math.min(max, validIids.length)} 張基本能量（可任意分配到備戰）`, aIdx), {
        type: 'discard-search',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        filter: 'BasicEnergy',
        minCount: 0, maxCount: Math.min(max, validIids.length),
        effectKey: 'v158-energy-chain-start',
        params: { validIids, label, source: 'discard', scope: 'bench-only', filterType: 'Any' },
      });
    }
    return withPending(addLog(state, `${label}：從棄牌區挑 0~${Math.min(max, validIids.length)} 張基本能量`, aIdx), {
      type: 'discard-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy',
      minCount: 0, maxCount: Math.min(max, validIids.length),
      effectKey: 'h-wave2-pickup-energy-to-bench-stage1',
      params: { validIids, label },
    });
  };
}

regR('h-wave2-pickup-energy-to-bench-stage1', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) {
    return addLog(state, `${(params?.label as string) ?? ''}：未選擇能量，效果結束`, aIdx);
  }
  const label = (params?.label as string) ?? '能量支援';
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(state, `${label}：備戰區沒有寶可夢，能量留在棄牌區`, aIdx);
  }
  return withPending(addLog(state, `${label}：選擇 1 隻備戰寶可夢接收能量（已挑 ${iids.length} 張）`, aIdx), {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-pickup-energy-to-bench-stage2',
    params: { energyIids: iids, label },
  });
});

regR('h-wave2-pickup-energy-to-bench-stage2', (state, aIdx, picked, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const label = (params?.label as string) ?? '能量支援';
  if (picked.length === 0 || energyIids.length === 0) return state;
  const targetIid = picked[0];
  const energySet = new Set(energyIids);
  const p = state.players[aIdx];
  const energies = p.discard.filter(c => energySet.has(c.iid));
  const restDiscard = p.discard.filter(c => !energySet.has(c.iid));
  const target = p.bench.find(b => b.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const newBench = p.bench.map(b =>
    b.iid === targetIid
      ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
      : b
  );
  const energyNames = energies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const newPlayers = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  newPlayers[aIdx] = { ...p, discard: restDiscard, bench: newBench };
  return addLog(
    { ...state, players: newPlayers },
    `${label}：${energyNames}（${energies.length} 張）附到 ${targetName} 身上`,
    aIdx,
  );
});

// v3.10 從牌庫挑 ≤N 基本能量 → 附到 1 隻備戰寶可夢身上（雙階段 pending）
//   逐電犬｜輸電衝刺 / 烈咬陸鯊ex｜水炮著陸 等卡使用此 pattern
//   階段 1 deck-search 挑能量；階段 2 bench-choose 選備戰目標
function deckSearchAttachToBenchPost(max: number, label: string, type?: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：備戰區沒有寶可夢`, aIdx);
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    // 統計牌庫對應能量數量上限（避免 maxCount 超過實際可選）
    const validCount = p.deck.filter(c => {
      const card = pool.get(c.cardId);
      if (!(card?.supertype === 'Energy' && card.subtype === 'Basic')) return false;
      if (type && !energyMatchesType(card, type)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    }).length;
    const realMax = Math.min(max, validCount);
    if (realMax === 0) {
      return openDeckViewReshuffle(state, aIdx, label); // v5.496：仍開檢視 picker（內含重洗）
    }
    // 篩選 filter 用 BasicEnergy 或細項類型；engine 若需 type filter，picker 上自行篩
    return withPending(addLog(state, `${label}：從牌庫挑 0~${realMax} 張基本能量（重洗後挑選；附到 1 隻備戰）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: type ? (`BasicEnergy:${type}` as const) : 'BasicEnergy',
      minCount: 0, maxCount: realMax,
      effectKey: 'v310-deck-pickup-energy-to-bench-stage1',
      params: { label },
    });
  };
}

regR('v310-deck-pickup-energy-to-bench-stage1', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '';
  // 卡面：「並且重洗牌庫」— 無論是否選到能量，剩餘牌庫都要重洗
  if (iids.length === 0) {
    return updatePlayer(addLog(state, `${label}：未選擇能量；重洗`, aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    // 備戰沒人 → 把選到的能量直接洗回牌庫（卡面要求附備戰，但備戰空時無解，回洗保留資源）
    return addLog(state, `${label}：備戰區沒有寶可夢，能量留在牌庫並重洗`, aIdx);
  }
  // v5.822：卡面「以任意方式附於備戰寶可夢」= 可分散 → 走中央 startEnergyChain(scope bench-only 分散)。
  return startEnergyChain(state, aIdx, iids, { label, source: 'deck', scope: 'bench-only', filterType: 'Any' }, pool);
});

regR('v310-deck-pickup-energy-to-bench-stage2', (state, aIdx, picked, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const label = (params?.label as string) ?? '';
  if (picked.length === 0 || energyIids.length === 0) return state;
  const targetIid = picked[0];
  const energySet = new Set(energyIids);
  const p = state.players[aIdx];
  // 從 deck 撈出能量；剩餘 deck 重洗
  const energies = p.deck.filter(c => energySet.has(c.iid));
  const restDeck = p.deck.filter(c => !energySet.has(c.iid));
  const target = p.bench.find(b => b.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const newBench = p.bench.map(b =>
    b.iid === targetIid
      ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
      : b
  );
  const energyNames = energies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const newPlayers = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  newPlayers[aIdx] = { ...p, deck: shuffle(restDeck), bench: newBench };
  return addLog(
    { ...state, players: newPlayers },
    `${label}：${energyNames}（${energies.length} 張）附到 ${targetName} 身上（重洗）`,
    aIdx,
  );
});

// v3.10 從牌庫挑 ≤N 基本能量 → 附到「自方任一寶可夢」身上（active + bench 皆可）
//   黑魯加｜鼓勵 / 七夕青鳥｜哼唱充能 / 風妖精ex｜能量之禮 等卡使用
//   階段 1 deck-search；階段 2 用 heal-target picker（涵蓋戰鬥場 + 備戰）
export function deckSearchAttachToAnyPost(max: number, label: string, type?: string, sameTypes: boolean = false): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const hasAnyTarget = !!p.active || p.bench.length > 0;
    if (!hasAnyTarget) return addLog(state, `${label}：自方場上無寶可夢`, aIdx);
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const validCount = p.deck.filter(c => {
      const card = pool.get(c.cardId);
      if (!(card?.supertype === 'Energy' && card.subtype === 'Basic')) return false;
      if (type && !energyMatchesType(card, type)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    }).length;
    const realMax = Math.min(max, validCount);
    if (realMax === 0) {
      return openDeckViewReshuffle(state, aIdx, label); // v5.496
    }
    return withPending(addLog(state, `${label}：從牌庫挑 0~${realMax} 張基本能量（附到自方任一寶可夢；重洗）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: sameTypes ? 'BasicEnergy:DistinctTypes' : (type ? (`BasicEnergy:${type}` as const) : 'BasicEnergy'),
      minCount: 0, maxCount: realMax,
      effectKey: 'v310-deck-pickup-energy-to-any-stage1',
      params: { label },
    });
  };
}

regR('v310-deck-pickup-energy-to-any-stage1', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '';
  if (iids.length === 0) {
    return updatePlayer(addLog(state, `${label}：未選擇能量；重洗`, aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const p = state.players[aIdx];
  if (!p.active && p.bench.length === 0) {
    return updatePlayer(addLog(state, `${label}：場上沒有寶可夢，能量留在牌庫並重洗`, aIdx), aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  // v5.822：卡面「以任意方式附於自己的寶可夢」= 可分散到多隻 → 走中央 startEnergyChain(分散 +/- UI，
  //   與其他能量加速卡一致，不再強制單一目標)。source='deck' 自動抽出所選能量+剩餘重洗。
  return startEnergyChain(state, aIdx, iids, { label, source: 'deck', scope: 'any-own', filterType: 'Any' }, pool);
});

regR('v310-deck-pickup-energy-to-any-stage2', (state, aIdx, picked, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const label = (params?.label as string) ?? '';
  if (picked.length === 0 || energyIids.length === 0) return state;
  const targetIid = picked[0];
  const energySet = new Set(energyIids);
  const p = state.players[aIdx];
  const energies = p.deck.filter(c => energySet.has(c.iid));
  const restDeck = p.deck.filter(c => !energySet.has(c.iid));
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(b => b.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const energyNames = energies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const newPlayers = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  newPlayers[aIdx] = {
    ...p,
    deck: shuffle(restDeck),
    active: isActive && p.active
      ? { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] }
      : p.active,
    bench: isActive
      ? p.bench
      : p.bench.map(b => b.iid === targetIid
          ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
          : b),
  };
  return addLog(
    { ...state, players: newPlayers },
    `${label}：${energyNames}（${energies.length} 張）附到 ${targetName} 身上（重洗）`,
    aIdx,
  );
});

// v3.10 從棄牌區挑 ≤N 基本能量 → 附到「自方任一寶可夢」身上（active + bench 皆可）
//   目前無已知 caller，但保留 export 以備未來「黑魯加 棄牌版鼓勵」類卡使用。
//   (未在 v3.10 實際使用 — 7 張 bug 中的 active+bench 類都是「牌庫」來源)
export function discardSearchAttachToAnyPost(max: number, label: string, type?: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const hasAnyTarget = !!p.active || p.bench.length > 0;
    if (!hasAnyTarget) return addLog(state, `${label}：自方場上無寶可夢`, aIdx);
    if (p.discard.length === 0) return addLog(state, `${label}：棄牌區為空`, aIdx);
    const validIids = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!(card?.supertype === 'Energy' && card.subtype === 'Basic')) return false;
      if (type && !energyMatchesType(card, type)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    }).map(c => c.iid);
    if (validIids.length === 0) return addLog(state, `${label}：棄牌區無對應基本能量`, aIdx);
    return withPending(addLog(state, `${label}：從棄牌區挑 0~${Math.min(max, validIids.length)} 張基本能量（附到自方任一寶可夢）`, aIdx), {
      type: 'discard-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy',
      minCount: 0, maxCount: Math.min(max, validIids.length),
      effectKey: 'v310-discard-pickup-energy-to-any-stage1',
      params: { validIids, label },
    });
  };
}

regR('v310-discard-pickup-energy-to-any-stage1', (state, aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '';
  if (iids.length === 0) {
    return addLog(state, `${label}：未選擇能量，效果結束`, aIdx);
  }
  const p = state.players[aIdx];
  if (!p.active && p.bench.length === 0) {
    return addLog(state, `${label}：場上沒有寶可夢，能量留在棄牌區`, aIdx);
  }
  const allOwn = [
    ...(p.active ? [p.active.iid] : []),
    ...p.bench.map(b => b.iid),
  ];
  if (allOwn.length === 1) {
    const targetIid = allOwn[0];
    const energySet = new Set(iids);
    const energies = p.discard.filter(c => energySet.has(c.iid));
    const restDiscard = p.discard.filter(c => !energySet.has(c.iid));
    return updatePlayer(addLog(state, `${label}：${iids.length} 張能量附到場上唯一寶可夢`, aIdx), aIdx, pl => ({
      ...pl,
      discard: restDiscard,
      active: pl.active && pl.active.iid === targetIid
        ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] }
        : pl.active,
      bench: pl.bench.map(b => b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
        : b),
    }));
  }
  return withPending(addLog(state, `${label}：選 1 隻自方寶可夢接收能量（已挑 ${iids.length} 張）`, aIdx), {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v310-discard-pickup-energy-to-any-stage2',
    params: { energyIids: iids, label },
  });
});

regR('v310-discard-pickup-energy-to-any-stage2', (state, aIdx, picked, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const label = (params?.label as string) ?? '';
  if (picked.length === 0 || energyIids.length === 0) return state;
  const targetIid = picked[0];
  const energySet = new Set(energyIids);
  const p = state.players[aIdx];
  const energies = p.discard.filter(c => energySet.has(c.iid));
  const restDiscard = p.discard.filter(c => !energySet.has(c.iid));
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(b => b.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const energyNames = energies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const newPlayers = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  newPlayers[aIdx] = {
    ...p,
    discard: restDiscard,
    active: isActive && p.active
      ? { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] }
      : p.active,
    bench: isActive
      ? p.bench
      : p.bench.map(b => b.iid === targetIid
          ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
          : b),
  };
  return addLog(
    { ...state, players: newPlayers },
    `${label}：${energyNames}（${energies.length} 張）附到 ${targetName} 身上`,
    aIdx,
  );
});

// v3.11 從牌庫挑 ≤N 基本能量 → 附到自方帶指定 tag（如「太晶」「未來」）的寶可夢
//   太樂巴戈斯|稜鏡充能（太晶 + 各不同屬性）/ 密勒頓|暴衝高點（未來）使用
//   階段 1 deck-search 挑能量；階段 2 用 heal-target picker（validIids 限制只含 tag 寶可夢）
function deckSearchAttachToTaggedBenchPost(max: number, label: string, tagName: string, sameTypes: boolean = false): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const allOwn = [...(p.active ? [p.active] : []), ...p.bench];
    const taggedIids = allOwn.filter(c => pool.get(c.cardId)?.tags?.includes(tagName)).map(c => c.iid);
    if (taggedIids.length === 0) return addLog(state, `${label}：自方場上無「${tagName}」寶可夢`, aIdx);
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const validCount = p.deck.filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic';
    }).length;
    const realMax = Math.min(max, validCount);
    if (realMax === 0) {
      return openDeckViewReshuffle(state, aIdx, label); // v5.496
    }
    return withPending(addLog(state, `${label}：從牌庫挑 0~${realMax} 張基本能量（附到「${tagName}」寶可夢；重洗）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: sameTypes ? 'BasicEnergy:DistinctTypes' : 'BasicEnergy',
      minCount: 0, maxCount: realMax,
      effectKey: 'v311-deck-energy-to-tagged-stage1',
      params: { label, tagName, taggedIids, maxN: realMax, distinctTypes: sameTypes },
    });
  };
}

regR('v311-deck-energy-to-tagged-stage1', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '';
  const tagName = (params?.tagName as string) ?? '';
  const taggedIids = (params?.taggedIids as string[]) ?? [];
  const maxN = (params?.maxN as number) ?? 3;
  const distinctTypes = params?.distinctTypes === true;
  // v6.009 防作弊:引擎 RESOLVE_SELECTION 不驗 filter/min/max/重複 → resolver 端重新驗證 client 傳來的
  //   iids:只留牌庫中的「基本能量」、去重、(distinctTypes 時)每屬性留 1 張、夾到卡面上限 maxN。
  //   否則惡意 client 可把牌庫任意卡/重複/超量塞進 energyAttached(公平性)。
  {
    const deck0 = state.players[aIdx].deck;
    const seenIid = new Set<string>();
    const seenType = new Set<string>();
    const clean: string[] = [];
    for (const iid of (iids ?? [])) {
      if (seenIid.has(iid)) continue;
      const inst = deck0.find(c => c.iid === iid);
      if (!inst) continue;
      const t = getBasicEnergyType(pool.get(inst.cardId));
      if (!t) continue;                                   // 非基本能量→剔除
      if (distinctTypes && seenType.has(t)) continue;      // 各不同屬性
      seenIid.add(iid); seenType.add(t); clean.push(iid);
      if (clean.length >= maxN) break;                     // 夾到卡面上限
    }
    iids = clean;
  }
  if (iids.length === 0) {
    return updatePlayer(addLog(state, `${label}：未選擇能量；重洗`, aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  if (taggedIids.length === 0) {
    return updatePlayer(addLog(state, `${label}：場上沒有「${tagName}」寶可夢，能量留在牌庫並重洗`, aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  // v5.823：卡面「以任意方式附於自己的「X」寶可夢」= 可分散到多隻同標籤 → 走中央 startEnergyChain
  //   (targetIids=標籤目標白名單)，與其他能量加速卡共用分配介面(單一自動全附、多隻開 energy-distribute)。
  return startEnergyChain(state, aIdx, iids, { label, source: 'deck', scope: 'any-own', filterType: 'Any', targetIids: taggedIids }, pool);
});

regR('v311-deck-energy-to-tagged-stage2', (state, aIdx, picked, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const label = (params?.label as string) ?? '';
  if (picked.length === 0 || energyIids.length === 0) return state;
  const targetIid = picked[0];
  const energySet = new Set(energyIids);
  const p = state.players[aIdx];
  const energies = p.deck.filter(c => energySet.has(c.iid));
  const restDeck = p.deck.filter(c => !energySet.has(c.iid));
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(b => b.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const energyNames = energies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const newPlayers = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  newPlayers[aIdx] = {
    ...p,
    deck: shuffle(restDeck),
    active: isActive && p.active
      ? { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] }
      : p.active,
    bench: isActive
      ? p.bench
      : p.bench.map(b => b.iid === targetIid
          ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
          : b),
  };
  return addLog({ ...state, players: newPlayers }, `${label}：${energyNames}（${energies.length} 張）附到 ${targetName} 身上（重洗）`, aIdx);
});

// v3.11 看牌庫頂 N 張，從中選任意數量能量（含特殊能量）附到自方任一寶可夢
//   拉普拉斯ex|海紋石之雨（peek 20 → 任意能量）使用
//   階段 1: 用 deck-search 顯示 top N 全部供選；階段 2: heal-target 選接收者；最後剩餘洗回
function deckTopPeekEnergyAttachToAnyPost(peekN: number, maxAttach: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const hasAnyTarget = !!p.active || p.bench.length > 0;
    if (!hasAnyTarget) return addLog(state, `${label}：自方場上無寶可夢`, aIdx);
    const top = p.deck.slice(0, peekN);
    const topIids = top.map(c => c.iid);
    const energiesInTop = top.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
    if (energiesInTop.length === 0) {
      return updatePlayer(addLog(state, `${label}：牌庫頂 ${top.length} 張內無能量；洗回後重洗`, aIdx), aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    }
    const realMax = Math.min(maxAttach, energiesInTop.length);
    return withPending(addLog(state, `${label}：查看牌庫頂 ${top.length} 張，選 0~${realMax} 張能量（附到自方任一寶可夢，剩餘洗回）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Energy:TOP_N',
      minCount: 0, maxCount: realMax,
      effectKey: 'v311-deck-peek-energy-to-any-stage1',
      params: { label, topIids, peekN: top.length },
    });
  };
}

regR('v311-deck-peek-energy-to-any-stage1', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '';
  const p = state.players[aIdx];
  if (iids.length === 0) {
    return updatePlayer(addLog(state, `${label}：未選擇能量；剩餘洗回`, aIdx), aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  if (!p.active && p.bench.length === 0) {
    return updatePlayer(addLog(state, `${label}：場上無寶可夢，剩餘洗回`, aIdx), aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  // v3.12: 使用 startEnergyChain 支援多目標分配（卡面「以任意方式附於自己的寶可夢身上」）。
  // chain helper 會：(a) 把能量從 deck 搬到 discard 緩衝、(b) reshuffle deck、
  // (c) 場上 1 隻自動全附；多隻同類能量 → +/- 計數器；多隻混合屬性 → 逐張 picker。
  return startEnergyChain(state, aIdx, iids, {
    label,
    source: 'deck',
    scope: 'any-own',
  }, pool);
});

regR('v311-deck-peek-energy-to-any-stage2', (state, aIdx, picked, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const label = (params?.label as string) ?? '';
  if (picked.length === 0 || energyIids.length === 0) {
    return updatePlayer(state, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const targetIid = picked[0];
  const energySet = new Set(energyIids);
  const p = state.players[aIdx];
  const energies = p.deck.filter(c => energySet.has(c.iid));
  const restDeck = p.deck.filter(c => !energySet.has(c.iid));
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(b => b.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const energyNames = energies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const newPlayers = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  newPlayers[aIdx] = {
    ...p,
    deck: shuffle(restDeck),
    active: isActive && p.active
      ? { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] }
      : p.active,
    bench: isActive
      ? p.bench
      : p.bench.map(b => b.iid === targetIid
          ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
          : b),
  };
  return addLog({ ...state, players: newPlayers }, `${label}：${energyNames}（${energies.length} 張）附到 ${targetName} 身上（剩餘洗回）`, aIdx);
});

// v3.11 看牌庫頂 N 張，從中選任意數量寶可夢卡放置於備戰區（剩餘洗回）
//   米立龍ex|硃砂誘餌（peek 10）/ 人造細胞卵|傳喚之門（peek 8）使用
//   卡面：「查看自己的牌庫上方 N 張卡，從其中選擇任意數量的寶可夢卡，放置於備戰區。
//          將剩餘卡放回牌庫並重洗。」
//   v5.076：原 v3.11 用「折衷」filter Basic:TOP_N 只列基礎寶可夢，違反卡面「寶可夢卡」
//          （未限制階段）。改成 Pokemon:TOP_N，列所有寶可夢（含 Stage1/Stage2/ex）。
//          這是 special placement —「強制放置」招式不走進化路徑，直接放上備戰，
//          非基礎寶可夢可以這樣放（PTCG 規則「就是這張卡形態」放上去）。
//   v5.076 順手修 bench limit 5 → getOwnBenchLimit（支援零之大空洞 +3 上限 8）
function deckTopPeekPokemonToBenchPost(peekN: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const top = p.deck.slice(0, peekN);
    const topIids = top.map(c => c.iid);
    // v5.076：列所有寶可夢（不限 Basic）— 卡面寫「寶可夢卡」未限制階段
    const pokemonsInTop = top.filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Pokemon';
    });
    if (pokemonsInTop.length === 0) {
      // v5.964 卡面「查看…上方N張」是無條件動作:無寶可夢也要讓玩家看到這 N 張(maxCount:0 僅檢視 → 洗回)。
      return withPending(addLog(state, `${label}：牌庫頂 ${top.length} 張內無寶可夢卡（檢視後洗回重洗）`, aIdx), {
        type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
        filter: 'Pokemon:TOP_N', minCount: 0, maxCount: 0,
        effectKey: 'v311-deck-peek-basic-to-bench',
        params: { label, topIids, peekN: top.length },
      });
    }
    // v5.076：bench limit 5 → getOwnBenchLimit（零之大空洞 +3 = 8）
    const benchLimit = getOwnBenchLimit(state, aIdx, pool);
    const space = Math.max(0, benchLimit - p.bench.length);
    const realMax = Math.min(space, pokemonsInTop.length);
    if (realMax === 0) {
      // v5.964 同上:備戰滿也要先讓玩家「查看」上方 N 張(maxCount:0 僅檢視 → 洗回)。
      return withPending(addLog(state, `${label}：備戰區已滿（檢視牌庫頂 ${top.length} 張後洗回重洗）`, aIdx), {
        type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
        filter: 'Pokemon:TOP_N', minCount: 0, maxCount: 0,
        effectKey: 'v311-deck-peek-basic-to-bench',
        params: { label, topIids, peekN: top.length },
      });
    }
    return withPending(addLog(state, `${label}：查看牌庫頂 ${top.length} 張，選 0~${realMax} 隻寶可夢卡放備戰（剩餘洗回）`, aIdx), {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon:TOP_N',
      minCount: 0, maxCount: realMax,
      effectKey: 'v311-deck-peek-basic-to-bench',
      params: { label, topIids, peekN: top.length },
    });
  };
}

regR('v311-deck-peek-basic-to-bench', (state, aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '';
  const p = state.players[aIdx];
  if (iids.length === 0) {
    return updatePlayer(addLog(state, `${label}：未選擇任何寶可夢；洗回後重洗`, aIdx), aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const chosenSet = new Set(iids);
  const chosen = p.deck.filter(c => chosenSet.has(c.iid));
  const restDeck = p.deck.filter(c => !chosenSet.has(c.iid));
  // v5.076：去掉「基礎」字樣，現在可放任意階段寶可夢（含 Stage1/Stage2/ex）
  const benchAdd = chosen.map(c => ({ ...c, justPlaced: true }));
  return updatePlayer(addLog(state, `${label}：放 ${chosen.length} 隻寶可夢到備戰（剩餘洗回）`, aIdx), aIdx, pl => ({
    ...pl,
    bench: [...pl.bench, ...benchAdd.map(placedBenchInstance)],
    deck: shuffle(restDeck),
  }));
});

// 同名 export：discardSearchAttachToBenchPost 已在上方定義，供其他檔（v2670）import 使用
export { discardSearchAttachToBenchPost };

// 自身互換戰鬥/備戰
function selfSwapPostInline(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0 || !p.active) return state;
    return withPending(addLog(state, `${label}：選 1 備戰互換`, aIdx), {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'h-wave2-self-swap',
    });
  };
}
regR('h-wave2-self-swap', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const idx = p.bench.findIndex(b => b.iid === targetIid);
    if (idx < 0) return p;
    const oldActive = p.active;
    // v4.978：set movedToActiveThisTurn — 振翅高飛/潔淨支援/金屬之路 等特性 gate 需要
    const newActive = { ...p.bench[idx], movedToActiveThisTurn: true };
    // v5.790：戰鬥→備戰一律 clearActiveEffects(離開戰鬥位清特殊狀態/旗標)；
    //   原直接 push oldActive → 中毒/灼傷/睡眠等殘留備戰(同 do-switch/self-swap-active-bench)。
    const newBench = p.bench.map((b, i) => i === idx ? clearActiveEffects(oldActive) : b);
    return { ...p, active: newActive, bench: newBench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 1: 擲幣倍率（已存在 helper）— 4 張 ===
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「擲N次硬幣，造成正面出現的次數×K點傷害」
regPre('卡比獸ex|翻身壓制', coinHeadsMultiplyPre(3, 120, '翻身壓制'));
regPre('美錄梅塔ex|鐵之橫掃', coinHeadsMultiplyPre(2, 100, '鐵之橫掃'));
// 卡面：「擲硬幣直到出現反面，造成正面出現的次數×K點傷害」
regPre('阿羅拉 隆隆岩|電磁彈射台', coinHeadsUntilTailsPre(70, '電磁彈射台'));
regPre('古月鳥|連續噴吐', coinHeadsUntilTailsPre(50, '連續噴吐'));
// 卡面：「N+擲硬幣直到出現反面，正面數×K」
regPre('墓揚犬ex|恐怖獠牙', coinHeadsUntilTailsBonusPre(100, 20, '恐怖獠牙'));
regPre('皮卡丘|激戰電光', coinHeadsUntilTailsBonusPre(30, 30, '激戰電光'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 2: 反失敗 — 1 張 ===
// ══════════════════════════════════════════════════════════════════════════════
regPre('滑滑小子|單次踢', coinReverseFailPre(30, '單次踢'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 3: 純狀態 ===
// ══════════════════════════════════════════════════════════════════════════════
// 哎呀球菇|孢子彈：10 + 將對手戰鬥【睡眠】
regPre('哎呀球菇|孢子彈', (s) => ({ state: s, damage: 10 }));
regPost('哎呀球菇|孢子彈', statusPost('asleep'));
regPre('敗露球菇ex|孢子彈', (s) => ({ state: s, damage: 30 }));
regPost('敗露球菇ex|孢子彈', statusPost('asleep'));
// 芳香精|芬香壓制：60 + 將對手戰鬥【混亂】
regPre('芳香精|芬香壓制', (s) => ({ state: s, damage: 60 }));
regPost('芳香精|芬香壓制', statusPost('confused'));
// 洗翠 風速狗|灼燒：90 + 將對手戰鬥【灼傷】
regPre('洗翠 風速狗|灼燒', (s) => ({ state: s, damage: 90 }));
// v5.844 清除重複死碼(生效版保留在他處),原行 899
// 謎擬Ｑex|幽靈之旅：120 + 將對手戰鬥【混亂】
regPre('謎擬Ｑex|幽靈之旅', (s) => ({ state: s, damage: 120 }));
regPost('謎擬Ｑex|幽靈之旅', statusPost('confused'));

// 阿柏怪|恐慌毒：將對手戰鬥【中毒】+【灼傷】+【混亂】
//   PTCG 規則：行動類（睡眠/混亂/麻痺）3 互斥；傷害類（中毒/灼傷）2 互斥；
//   1 行動類 + 1 傷害類可共存。
//   故同時施加 confused + 中毒(or 灼傷) — 我們將中毒放 secondaryStatus，混亂放 status
//   但卡面要求 3 種，第 3 種會被擠掉；我們依規則「最後施加的覆蓋同類」處理：
//   施加順序：中毒(status) → 灼傷(secondaryStatus 因 status 已是傷害類則覆蓋同類…)
//   實作上依 statusPost 的 status/secondaryStatus 行為連續呼叫即可。
regPre('阿柏怪|恐慌毒', (s) => ({ state: s, damage: 0 }));
regPost('阿柏怪|恐慌毒', (state, aIdx, pool) => {
  let s = statusPost('poisoned')(state, aIdx, pool);
  s = statusPost('burned')(s, aIdx, pool);
  return statusPost('confused')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 4: 自殘類 ===
// ══════════════════════════════════════════════════════════════════════════════
// 「這隻寶可夢也受到 N 點傷害」
const SELF_HIT: Array<[string, number, number]> = [
  ['纏紅鶴ex|勇鳥猛攻', 200, 30],
  ['皮卡丘ex|打雷', 220, 30],
  ['音波龍ex|音波爆破', 220, 30],
  ['瑪力露麗|捨身衝撞', 230, 50],
  ['六尾|猛撞', 30, 10],
];
for (const [key, dmg, selfDmg] of SELF_HIT) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfHitPost(selfDmg, atkName));
}

// 普隆隆姆ex|高速破壞 250：「將這隻寶可夢與附加的卡全部丟棄」(自殺KO)
regPre('普隆隆姆ex|高速破壞', (s) => ({ state: s, damage: 250 }));
regPost('普隆隆姆ex|高速破壞', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return state;
  // v5.523：卡面是「將這隻寶可夢與附加的卡全部丟棄」=丟棄(非昏厥)→對手【不取獎賞卡】。
  //   走「化石丟棄」式自身移除：active→null + 本體/能量/道具/前階全進棄牌，
  //   不呼叫 recordOppKO / addPendingPrize、也不設 damage 讓 sanityKOSweep 當成 KO。
  //   原 markFaintByEffect(damage=有效maxHP) 會被 sweep 當昏厥→誤給對手獎賞，故改掉。
  const discarded = [a, ...a.energyAttached, ...getAllAttachedTools(a), ...(a.evolvedFromStack ?? [])];
  return updatePlayer(
    addLog(state, '高速破壞：將自身與附加的卡全部丟棄（丟棄非昏厥，對手不取獎賞卡）', aIdx),
    aIdx,
    p => ({ ...p, active: null, discard: [...p.discard, ...discarded] }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 5: recharge ===
// ══════════════════════════════════════════════════════════════════════════════
const RECHARGE: Array<[string, number]> = [
  ['席多藍恩|鐵之光炮', 130],
  ['密勒頓ex|異度猛衝', 220],
  ['蒼響ex|猛擊在地', 210],
  ['帕底亞 土王ex|終極衝擊', 220],
  ['鐵武者|意念之刃', 120],  // 卡面: 在下個自己的回合，這隻寶可夢無法使用「意念之刃」
];
// v5.982：卡面「無法使用招式」(全鎖)→ selfCantAttackNextPost；「無法使用『X』」(單鎖:密勒頓ex/蒼響ex/鐵武者)→ rechargePost。
const RECHARGE_ALL_LOCK = new Set(['席多藍恩|鐵之光炮', '帕底亞 土王ex|終極衝擊']);
for (const [key, dmg] of RECHARGE) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, RECHARGE_ALL_LOCK.has(key) ? selfCantAttackNextPost() : rechargePost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// === Section 6: 棄能量大招 ===
// ══════════════════════════════════════════════════════════════════════════════
const DISCARD_N: Array<[string, number, number]> = [  // [key, dmg, n]
];
for (const [key, dmg, n] of DISCARD_N) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfDiscardNEnergyPost(n, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// === Section 7: 抽牌 ===
// ══════════════════════════════════════════════════════════════════════════════
// 卡比獸|扣殺抽出：20 + 抽 1 張
regPre('卡比獸|扣殺抽出', (s) => ({ state: s, damage: 20 }));
regPost('卡比獸|扣殺抽出', drawNPost(1, '扣殺抽出'));
// 帝牙盧卡ex|時空吶喊：20 + 抽 1
regPre('帝牙盧卡ex|時空吶喊', (s) => ({ state: s, damage: 20 }));
regPost('帝牙盧卡ex|時空吶喊', drawNPost(1, '時空吶喊'));
// 貪心栗鼠|呼喚：抽 1
regPre('貪心栗鼠|呼喚', (s) => ({ state: s, damage: 0 }));
regPost('貪心栗鼠|呼喚', drawNPost(1, '呼喚'));
// 藏飽栗鼠|強慾尾：60 + 抽 2
regPre('藏飽栗鼠|強慾尾', (s) => ({ state: s, damage: 60 }));
regPost('藏飽栗鼠|強慾尾', drawNPost(2, '強慾尾'));
// 蟲甲聖ex|相反抽出：從牌庫底抽 3 張
regPre('蟲甲聖ex|相反抽出', (s) => ({ state: s, damage: 0 }));
regPost('蟲甲聖ex|相反抽出', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '相反抽出：從牌庫底抽 3 張', aIdx), aIdx, p => {
    const k = Math.min(3, p.deck.length);
    const taken = p.deck.slice(p.deck.length - k);
    return { ...p, deck: p.deck.slice(0, p.deck.length - k), hand: [...p.hand, ...taken] };
  });
});
// 熱帶龍|果實豐收：棄 1 手牌（自選）+ 抽 3
regPre('熱帶龍|果實豐收', (s) => ({ state: s, damage: 0 }));
regPost('熱帶龍|果實豐收', (state, aIdx, _pool) => {
  if (state.players[aIdx].hand.length === 0) return drawNPost(3, '果實豐收')(state, aIdx, new Map());
  return withPending(addLog(state, '果實豐收：棄 1 張手牌 + 抽 3 張', aIdx), {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-fruit-harvest',
  });
});
regR('h-wave2-fruit-harvest', (state, aIdx, iids, _params, pool) => {
  let s = state;
  if (iids.length > 0) {
    const set = new Set(iids);
    const _fd = state.players[aIdx].hand.filter(c => set.has(c.iid));
    s = addLog(s, `果實豐收：丟棄手牌 ${joinCardNames(_fd, pool)}`, aIdx);
    s = updatePlayer(s, aIdx, p => {
      const discarded = p.hand.filter(c => set.has(c.iid));
      const rest = p.hand.filter(c => !set.has(c.iid));
      return { ...p, hand: rest, discard: [...p.discard, ...discarded] };
    });
  }
  return drawNPost(3, '果實豐收')(s, aIdx, new Map());
});

// 頭巾混混|偷竊：從牌庫任意挑 ≤備戰數 加手
regPre('頭巾混混|偷竊', (s) => ({ state: s, damage: 0 }));
regPost('頭巾混混|偷竊', (state, aIdx, _pool) => {
  const benchN = state.players[aIdx].bench.length;
  if (benchN === 0 || state.players[aIdx].deck.length === 0) return state;
  return withPending(addLog(state, `偷竊：從牌庫挑 0~${benchN} 張卡加手（重洗）`, aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: 0, maxCount: benchN,
    effectKey: 'wave13-deck-take-any',
    // v6.097 ⚠ 頭巾混混｜偷竊 官方卡面：「從自己的牌庫任意選擇最多與自己的備戰寶可夢數量
    //   相同數量的卡，加入手牌。並且重洗牌庫。」——**沒有「在給對手看過後」** → 不可公開卡名。
    params: { label: '偷竊', publicReveal: false },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 8: 對手 1 隻備戰也受 N（base + snipe） ===
// ══════════════════════════════════════════════════════════════════════════════
const SNIPE_AND_HIT: Array<[string, number, number]> = [  // [key, base, snipe]
  ['水君|飛馳', 30, 30],
  ['鐵武者|雙生鐳射', 20, 20],
  ['九尾|火焰聖靈', 50, 30],
];
for (const [key, base, snipe] of SNIPE_AND_HIT) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: base }));
  regPost(key, snipeOneOppBenchPost(snipe, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// === Section 9: 對手 1 隻寶可夢任選（含戰鬥） ===
// ══════════════════════════════════════════════════════════════════════════════
// 巨翅飛魚|水俯衝：對手 1 隻寶可受 50（不計弱抗）
regPre('巨翅飛魚|水俯衝', (s) => ({ state: s, damage: 0, skipWeakRes: true }));
regPost('巨翅飛魚|水俯衝', hitAnyOneOppPost(50, '水俯衝'));
// 爆焰龜獸|吐出射擊：對手 1 隻備戰受 40
regPre('爆焰龜獸|吐出射擊', (s) => ({ state: s, damage: 0 }));
regPost('爆焰龜獸|吐出射擊', snipeOneOppBenchPost(40, '吐出射擊'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 10: 對手所有備戰各受 N ===
// ══════════════════════════════════════════════════════════════════════════════
// 雷吉艾斯|暴風雪：90 + 對手所有備戰各受 10
regPre('雷吉艾斯|暴風雪', (s) => ({ state: s, damage: 90 }));
regPost('雷吉艾斯|暴風雪', allOppBenchAddDamagePost(10, '暴風雪'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 11: 牌庫挑寶可夢放備戰 ===
// ══════════════════════════════════════════════════════════════════════════════
// 「呼朋引伴」類 — 從自己的牌庫選擇 1 張【基礎】寶可夢卡，放置於備戰區
regPre('伊布|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('伊布|呼朋引伴', deckSearchBasicToBenchPost(1, '呼朋引伴'));
regPre('袋獸|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('袋獸|呼朋引伴', deckSearchBasicToBenchPost(1, '呼朋引伴'));
// 花舞鳥|呼朋引伴 — 最多 2 張
regPre('花舞鳥|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('花舞鳥|呼朋引伴', deckSearchBasicToBenchPost(2, '呼朋引伴'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 12: 牌庫挑能量類 ===
// ══════════════════════════════════════════════════════════════════════════════
// 黑魯加|鼓勵 — 牌庫挑最多 2 張基本能量，以任意方式附於自己的寶可夢
regPre('黑魯加|鼓勵', (s) => ({ state: s, damage: 0 }));
// v3.10 修 bug：原本 deckSearchBasicEnergiesAnyPost 加到手牌；卡面是「附於自己的寶可夢身上」（active + bench）
regPost('黑魯加|鼓勵', deckSearchAttachToAnyPost(2, '鼓勵'));
// 七夕青鳥|哼唱充能 — 同上 (最多 2)
regPre('七夕青鳥|哼唱充能', (s) => ({ state: s, damage: 0 }));
// v3.10 修 bug：原本 deckSearchBasicEnergiesAnyPost 加到手牌；卡面是「附於自己的寶可夢身上」（active + bench）
regPost('七夕青鳥|哼唱充能', deckSearchAttachToAnyPost(2, '哼唱充能'));

// 蒼響ex|鋼鐵武器 20 + 牌庫挑 1 基本鋼能量附自身
regPre('蒼響ex|鋼鐵武器', (s) => ({ state: s, damage: 20 }));
regPost('蒼響ex|鋼鐵武器', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const eIid = player.deck.find(c => {
    const card = pool.get(c.cardId);
    return isEnergyOfType(card, 'Metal') && card?.subtype === 'Basic';
  })?.iid;
  if (!eIid) return openDeckViewReshuffle(state, aIdx, '鋼鐵武器'); // v5.496
  return updatePlayer(addLog(state, '鋼鐵武器：從牌庫挑 1 張基本鋼能量附自身（重洗）', aIdx), aIdx, p => {
    const idx = p.deck.findIndex(c => c.iid === eIid);
    if (idx < 0) return p;
    const energy = p.deck[idx];
    const newDeck = shuffle(p.deck.filter((_, i) => i !== idx));
    return {
      ...p,
      deck: newDeck,
      active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] } : null,
    };
  });
});

// 逐電犬|輸電衝刺 50 + 牌庫挑最多 2 基本雷能量分配備戰
regPre('逐電犬|輸電衝刺', (s) => ({ state: s, damage: 50 }));
// v3.10 修 bug：原本 deckSearchBasicEnergiesAnyPost 加到手牌；卡面是「附於備戰寶可夢身上」（限基本【雷】）
regPost('逐電犬|輸電衝刺', deckSearchAttachToBenchPost(2, '輸電衝刺', 'Lightning'));

// 鬃岩狼人|渦輪刀鋒 50 + 棄牌挑最多 2 基本鬥能量分配備戰
regPre('鬃岩狼人|渦輪刀鋒', (s) => ({ state: s, damage: 50 }));
// v3.10 修 bug：原本 discardSearchBasicEnergiesPost 加到手牌；卡面是「附於備戰寶可夢身上」
regPost('鬃岩狼人|渦輪刀鋒', discardSearchAttachToBenchPost(2, '渦輪刀鋒', 'Fighting', true));

// 花舞鳥|能量支援 — 棄牌區挑最多 2 基本能量附 1 隻備戰
regPre('花舞鳥|能量支援', (s) => ({ state: s, damage: 0 }));
// v3.09 修 bug：原本用 discardSearchBasicEnergiesPost（拿到手牌）違反卡面
// 卡面（MC 133/742）：「從自己的棄牌區選擇最多 2 張『基本能量』卡，附於自己的 1 隻備戰寶可夢身上」
regPost('花舞鳥|能量支援', discardSearchAttachToBenchPost(2, '能量支援'));

// 烏波|打水 — 棄牌挑最多 3 基本水能量，給對手看後放回牌庫並重洗（純展示+混回）
regPre('烏波|打水', (s) => ({ state: s, damage: 0 }));
regPost('烏波|打水', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const validIids = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return isEnergyOfType(card, 'Water') && card?.subtype === 'Basic';
  }).map(c => c.iid);
  if (validIids.length === 0) return addLog(state, '打水：棄牌區無基本水能量', aIdx);
  return withPending(addLog(state, `打水：從棄牌區挑 0~${Math.min(3, validIids.length)} 張基本水能量回牌庫並重洗`, aIdx), {
    type: 'discard-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: Math.min(3, validIids.length),
    effectKey: 'h-wave2-discard-back-to-deck',
    params: { validIids },
  });
});
// v6.097：烏波｜打水 卡面「從自己的棄牌區選擇最多3張『基本【水】能量』卡，
//   **在給對手看過後**放回牌庫並重洗。」→ 補上卡名（棄牌區公開，無洩漏疑慮）。
regR('h-wave2-discard-back-to-deck', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return updatePlayer(addLog(state, '打水：未選擇任何卡（牌庫已重洗）', aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  const set = new Set(iids);
  const pickedForLog = state.players[aIdx].discard.filter(c => set.has(c.iid));
  return updatePlayer(logPickedCards(state, aIdx, pickedForLog, pool, '打水', '放回牌庫並重洗', { publicReveal: true }), aIdx, p => {
    const picked = p.discard.filter(c => set.has(c.iid));
    const rest = p.discard.filter(c => !set.has(c.iid));
    return { ...p, discard: rest, deck: shuffle([...p.deck, ...picked]) };
  });
});

// 帕奇利茲|啪滋啪滋充電 — 擲 3 次硬幣，從棄牌區選 ≤正面數 基本雷能量分配備戰
//   v3.10 修 bug：原本 effectKey 'h-wave2-pickup-energy-to-hand' 加到手牌；
//   卡面是「以任意方式附於備戰寶可夢身上」 → 改用 discardSearchAttachToBenchPost 雙階段 pending
regPre('帕奇利茲|啪滋啪滋充電', (s) => ({ state: s, damage: 0 }));
regPost('帕奇利茲|啪滋啪滋充電', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 3, '啪滋啪滋充電', aIdx);
  if (r.heads === 0) return addLog(r.state, '啪滋啪滋充電：0 正面', aIdx);
  // 動態 max = heads（呼叫共用 helper 但帶上 heads 上限）
  return discardSearchAttachToBenchPost(r.heads, '啪滋啪滋充電', 'Lightning', true)(r.state, aIdx, pool);
});

// 夠讚狗ex|猛毒筋力 — 牌庫挑 ≤2 基本【惡】能量附自身 + 自身中毒
//
// v3.13 修 B5：原本自動取前 2 張，違反卡面「玩家選擇張數」語意。
//   改成 deck-search picker（minCount: 0, maxCount: 2, filter: Energy:Darkness）→
//   resolver 把選中的能量附給自身戰鬥場 → 自動中毒。
//   牌庫只有 0 張則直接重洗；牌庫有 ≥1 張但玩家可選 0 → 不附能量也不中毒
//   （卡面「附上卡的情況下」中毒，未附 = 不中毒）。
regPre('夠讚狗ex|猛毒筋力', (s) => ({ state: s, damage: 0 }));
regPost('夠讚狗ex|猛毒筋力', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const cand = player.deck.filter(c => {
    const card = pool.get(c.cardId);
    return isEnergyOfType(card, 'Darkness') && card?.subtype === 'Basic';
  });
  // v3.853: 即使 cand=0 也仍開 picker — 讓玩家查看牌庫剩餘卡（Iron Rule 14）
  //   reshuffle 在 resolver 內處理（無論玩家選或沒選都會 reshuffle）
  const realMax = Math.min(2, cand.length);
  return withPending(
    addLog(state, `猛毒筋力：從牌庫挑 0~${realMax} 張基本【惡】能量附於自身（重洗）`, aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Energy:Darkness',
      minCount: 0, maxCount: realMax,
      effectKey: 'v313-mengdu-jinli-attach-self',
    },
  );
});

// v3.13 resolver: 把選中的【惡】能量附於自身，並使自身【中毒】（若有附）
regR('v313-mengdu-jinli-attach-self', (state, aIdx, iids, _params, _pool) => {
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    if (picked.length === 0) {
      // 玩家未選任何能量 → 僅重洗（不中毒）
      return { ...p, deck: shuffle(rest) };
    }
    return {
      ...p,
      deck: shuffle(rest),
      active: {
        ...p.active,
        energyAttached: [...p.active.energyAttached, ...picked],
        status: 'poisoned' as const,  // 卡面「附上卡的情況下，自身陷入中毒」
      },
    };
  });
});

// 密勒頓|暴衝高點 40 + 牌庫挑最多 2 基本能量附「未來」寶可夢
regPre('密勒頓|暴衝高點', (s) => ({ state: s, damage: 40 }));
regPost('密勒頓|暴衝高點', deckSearchAttachToTaggedBenchPost(2, '暴衝高點', '未來'));

// 太樂巴戈斯|稜鏡充能 — 牌庫挑最多 3 各不同屬性基本能量附「太晶」寶可夢
regPre('太樂巴戈斯|稜鏡充能', (s) => ({ state: s, damage: 0 }));
regPost('太樂巴戈斯|稜鏡充能', deckSearchAttachToTaggedBenchPost(3, '稜鏡充能', '太晶', true));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 13: 條件 +N ===
// ══════════════════════════════════════════════════════════════════════════════
// 雷伊布ex|閃光尖矛 60+ — 若希望，棄最多 2 張自方備戰基本能量，N×90
//
// v3.10 修 POST → PRE（讓弱抗 ×2/-30 正確套用）；
// v3.29 改用 ATTACK_PRE_DISCARD_CHOICE picker（移除 v3.10 自動棄到上限的妥協）：
//   玩家在攻擊前先選 0~2 張自方備戰基本能量，picker 顯示時可勾選。
//   只計算「基本能量」(card.subtype==='Basic')；若玩家點到特殊能量，regPre 會過濾掉。
ATTACK_PRE_DISCARD_CHOICE.set('雷伊布ex|閃光尖矛', {
  min: 0, max: 2, scope: 'own-bench', baseDamage: 60, damagePerEnergy: 90,
});
regPre('雷伊布ex|閃光尖矛', (state, aIdx, pool, action) => {
  const player = state.players[aIdx];
  // 收集自方備戰所有「基本」能量（過濾 special）
  type Loc = { benchIdx: number; energy: CardInstance };
  const eligible: Loc[] = [];
  player.bench.forEach((b, i) => {
    for (const e of b.energyAttached) {
      const card = pool.get(e.cardId);
      if (card?.supertype === 'Energy' && card.subtype === 'Basic') {
        eligible.push({ benchIdx: i, energy: e });
      }
    }
  });
  // 玩家挑的 iids — 過濾只保留 eligible 內的（避免誤點特殊能量）+ 限上限 2
  const chosenIids = action?.discardedEnergyIids;
  let selected: Loc[];
  if (chosenIids && chosenIids.length > 0) {
    const idSet = new Set(chosenIids);
    selected = eligible.filter(l => idSet.has(l.energy.iid)).slice(0, 2);
  } else {
    // AI fallback / 玩家選 0：不棄
    selected = [];
  }
  if (selected.length === 0) {
    return { state: addLog(state, '閃光尖矛：未棄備戰能量 → 60', aIdx), damage: 60 };
  }
  // 棄能量
  const idSet = new Set(selected.map(s => s.energy.iid));
  const removed = selected.map(s => s.energy);
  const newState = updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => ({
      ...b,
      energyAttached: b.energyAttached.filter(e => !idSet.has(e.iid)),
    })),
    discard: [...p.discard, ...removed],
  }));
  const bonus = selected.length * 90;
  const total = 60 + bonus;
  return {
    state: addLog(newState, `閃光尖矛：棄 ${selected.length} 張備戰能量 → 60+${bonus} = ${total}（弱抗前）`, aIdx),
    damage: total,
    breakdown: [
      { value: 60, label: '基礎' },
      { value: bonus, label: `棄${selected.length}基本能量` },
    ],
  };
});
// POST 已不需要再處理 bonus（已在 PRE 完成棄能 + return damage）
// regPost 留空（無註冊）— engine 自動套用弱抗流程

// 鐵磐岩|調整角擊 170 — 雙方手牌張數同 否則失敗
regPre('鐵磐岩|調整角擊', sameHandCountPre(170, '調整角擊'));

// 嘎啦嘎啦|骨之復仇 60+ — 自方備戰「卡拉卡拉」有指示物 +120
regPre('嘎啦嘎啦|骨之復仇', (state, aIdx, pool) => {
  const hasInjuredKarakara = state.players[aIdx].bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.name === '卡拉卡拉' && (b.damage ?? 0) > 0;
  });
  if (hasInjuredKarakara) return { state: addLog(state, '骨之復仇：自方備戰卡拉卡拉有指示物 → 60+120 = 180', aIdx), damage: 180 };
  return { state: addLog(state, '骨之復仇：未觸發 → 60', aIdx), damage: 60 };
});

// 列陣兵|一併攻擊 30+ — 上回合用過「組成陣形」+90
regPre('列陣兵|一併攻擊', lastSelfTurnUsedAttackPre(30, 90, '組成陣形', '一併攻擊'));

// 故勒頓|輪番狂攻 30+ — v4.894 完整實裝（不再簡化）
//   JSON 卡面：「在上個自己的回合，若這隻寶可夢以外的『古代』寶可夢使用了招式，
//                則增加 150 點傷害。」
//   實裝方法：iterate 自方場上 (active + bench) 非攻擊者 instance，檢查 per-instance
//             attackUsedLastSelfTurn flag（types.ts line 168-169，engine.ts END_TURN
//             promote attackUsedThisTurn → attackUsedLastSelfTurn 已實裝）。
//   舊註解「attackUsedLastSelfTurn 只記錄擁有者自己的最後一招，無法查其他寶可夢」是
//   誤判 — flag 本就是 per-instance，iterate 場上所有 instance 即可知道每隻的最後一招。
regPre('故勒頓|輪番狂攻', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const attacker = p.active;
  if (!attacker) {
    return { state: addLog(state, '輪番狂攻：自方無 active（異常）', aIdx), damage: 30 };
  }
  // v5.911：改用遊戲層級 ancientAttackedIidsLastSelfTurn(存活至古代寶可夢 KO 離場後)。
  //   卡面「上個自己的回合,若這隻寶可夢以外的古代寶可夢使用了招式」→ 只要上個自己回合有
  //   『別隻』古代寶可夢使過招即觸發,不論它是否還在場上(舊實作只掃場上 instance,古代被 KO 就漏)。
  const _ancientIids = state.ancientAttackedIidsLastSelfTurn?.[aIdx === 0 ? 'p1' : 'p2'] ?? [];
  const _triggeredIid = _ancientIids.find(iid => iid !== attacker.iid);
  // 場上仍存在的古代寶可夢(供 audit log 顯示;找不到 instance 代表已 KO 離場,仍算觸發)
  const others: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ].filter(c => c.iid !== attacker.iid);
  const triggered = _triggeredIid
    ? (others.find(inst => inst.iid === _triggeredIid) ?? ({ cardId: '', iid: _triggeredIid } as CardInstance))
    : undefined;
  // v5.260：audit log — 列出場上古代寶可夢 + LastSelfTurn flag, 方便玩家 debug
  const ancients = others.filter(inst => pool.get(inst.cardId)?.tags?.includes('古代'));
  let s: GameState = state;
  if (ancients.length === 0) {
    s = addLog(s, '輪番狂攻 audit: 場上其他寶可夢中無「古代」屬性', aIdx);
  } else {
    const detail = ancients.map(inst => {
      const c = pool.get(inst.cardId);
      const used = inst.attackUsedLastSelfTurn ?? '(無)';
      return `${c?.name ?? '?'}=${used}`;
    }).join(' / ');
    s = addLog(s, `輪番狂攻 audit: 場上其他古代寶可夢及其上回合招式: ${detail}`, aIdx);
  }
  if (triggered) {
    // v5.911：triggered 可能是已 KO 離場的古代寶可夢(重建 stub, cardId 空)→名稱 fallback「(已離場的古代寶可夢)」
    const tCard = pool.get(triggered.cardId);
    const _tName = tCard?.name ?? '(已離場的古代寶可夢)';
    return {
      state: addLog(s,
        `輪番狂攻：上個自己的回合「${_tName}」（古代）使用了招式 → 30 + 150 = 180`,
        aIdx),
      damage: 180,
    };
  }
  return {
    state: addLog(s,
      '輪番狂攻：上個自己的回合無其他古代寶可夢使用招式 → 30',
      aIdx),
    damage: 30,
  };
});

// 阿羅拉 嘎啦嘎啦|報仇 30+ — 上對手回合若自己寶可夢因招式 KO +90
//   引擎已有 oppDamageKOdMeInLastOppTurn[me] 計數
regPre('阿羅拉 嘎啦嘎啦|報仇', (state, aIdx, _pool) => {
  const koCount = (state.oppDamageKOdMeInLastOppTurn ?? [0, 0])[aIdx] ?? 0;
  if (koCount > 0) return { state: addLog(state, `報仇：上對手回合 KO ${koCount} 隻自方 → 30+90 = 120`, aIdx), damage: 120 };
  return { state: addLog(state, '報仇：上對手回合無 KO → 30', aIdx), damage: 30 };
});

// 鳳王|閃耀火焰 100+ — 自方備戰有「太晶」寶可夢 +100
regPre('鳳王|閃耀火焰', (state, aIdx, pool) => {
  const hasTera = state.players[aIdx].bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.tags?.includes('太晶');
  });
  if (hasTera) return { state: addLog(state, '閃耀火焰：自方備戰有太晶 → 100+100 = 200', aIdx), damage: 200 };
  return { state: addLog(state, '閃耀火焰：自方備戰無太晶 → 100', aIdx), damage: 100 };
});

// 大奶罐|哞哞回轉 100 — 必須上回合用過「滾動」
regPre('大奶罐|哞哞回轉', requirePrevAttackPre(100, '滾動', '哞哞回轉'));

// 阿羅拉 三地鼠|三賓果 120 — 自手牌 = 3 否則失敗
regPre('阿羅拉 三地鼠|三賓果', exactHandSizePre(120, 3, '三賓果'));

// 厄鬼椪 碧草面具ex|萬葉陣雨 30+ — 雙方戰鬥能量數合計 ×30
// v5.671：萬葉陣雨重複註冊清理 — 統一由 effects.ts bothActiveEnergyMultiplyPre 實作;此 raw-length 死碼移除。

// 蟲甲聖ex|精神強念 20+ — 對手戰鬥能量數 ×90
// v4.959：用 countAttachedEnergyAsUnits — 認新衝天能量 on Stage2 = 2 個。
regPre('蟲甲聖ex|精神強念', (state, aIdx, pool) => {
  const def = state.players[(1-aIdx) as 0|1].active;
  const dE = def ? countAttachedEnergyAsUnits(def, pool) : 0;
  return { state: addLog(state, `精神強念：對手戰鬥能量 ${dE} → 20+${dE}×90 = ${20 + dE*90}`, aIdx), damage: 20 + dE * 90 };
});

// 沙鐵皮|磁場炸裂 20+ — 自方場上能量 ≥3 +70；卡面僅「不計算弱點」
// v5.783：原誤用 skipWeakRes(連抵抗力一起跳)→ 改 skipWeakness(只跳弱點，抵抗力仍計)。
//   同 v4.495 對「不計算抵抗力」批次的修法(SKIP_RES)，此為弱點側漏網孿生。
regPre('沙鐵皮|磁場炸裂', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  let total = (p.active?.energyAttached.length ?? 0);
  for (const b of p.bench) total += b.energyAttached.length;
  if (total >= 3) return { state: addLog(state, `磁場炸裂：自方場上能量 ${total} ≥3 → 20+70 = 90 (skipWeakness)`, aIdx), damage: 90, skipWeakness: true };
  return { state: addLog(state, `磁場炸裂：自方場上能量 ${total} < 3 → 20 (skipWeakness)`, aIdx), damage: 20, skipWeakness: true };
});

// 爬地翅|鐵碎 20+ — 對手場上有「未來」寶可夢 +120
regPre('爬地翅|鐵碎', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const hasFuture = [opp.active, ...opp.bench].filter(Boolean).some((c) => {
    const card = pool.get((c as CardInstance).cardId);
    return card?.tags?.includes('未來');
  });
  if (hasFuture) return { state: addLog(state, '鐵碎：對手有未來寶可 → 20+120 = 140', aIdx), damage: 140 };
  return { state: addLog(state, '鐵碎：對手無未來寶可 → 20', aIdx), damage: 20 };
});

// 轟鳴月|雪恨箭羽 70+ — 自棄牌「古代」卡張數 ×10
regPre('轟鳴月|雪恨箭羽', (state, aIdx, pool) => {
  let count = 0;
  for (const c of state.players[aIdx].discard) {
    const card = pool.get(c.cardId);
    if (card?.tags?.includes('古代')) count++;
  }
  return { state: addLog(state, `雪恨箭羽：自棄牌「古代」${count} → 70+${count}×10 = ${70 + count*10}`, aIdx), damage: 70 + count*10 };
});

// 纏紅鶴ex|恰好喙 30+ — 自身與對手戰鬥能量數同 +100
regPre('纏紅鶴ex|恰好喙', sameEnergyCountPre(30, 100, '恰好喙'));

// 大王銅象|鼻之金勾臂 130+ — 卡面：「若希望，增加100點傷害。這個情況下，在下個自己的回合，這隻寶可夢無法使用招式。」
//   v3.26 修：原強制 +100 + recharge，違反卡面「若希望」。
//   借殼 binary-yes-no：玩家可選擇是否 +100（代價：下回合無法使用招式）
//   - 選「否」 → 130 傷害，可正常下回合行動
//   - 選「是」 → 230 傷害 + recharge 鎖
//   AI fallback：預設選「是」最大化攻擊。
ATTACK_PRE_DISCARD_CHOICE.set('大王銅象|鼻之金勾臂', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 130, damagePerEnergy: 0,
  choicePrompt: '是否增加 100 點傷害？（這個情況下，下個自己的回合這隻寶可夢無法使用招式）',
  choiceYesLabel: '是（+100 傷害 + 下回合無法使用招式）',
  choiceNoLabel: '否（130 傷害；下回合可正常行動）',
});
regPre('大王銅象|鼻之金勾臂', (state, aIdx, _pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return { state: addLog(state, '鼻之金勾臂：選「否」 → 130 傷害（不 recharge）', aIdx), damage: 130 };
  }
  return { state: addLog(state, '鼻之金勾臂：選「是」 → 130+100 = 230（下回合 recharge）', aIdx), damage: 230 };
});
regPost('大王銅象|鼻之金勾臂', (state, aIdx, pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
  return rechargePost('鼻之金勾臂')(state, aIdx, pool);
});

// 輕身鱈ex|光芒強襲 120+ — 卡面：「若希望，將自己的手牌全部丟棄。有丟棄的情況下，增加120點傷害。」
//   v3.26 修：原強制棄全手牌 + 強制 +120，違反卡面「若希望」。
//   借殼 binary-yes-no：玩家可選擇是否棄全手牌。
//   - 選「否」 → 120 傷害，保留手牌
//   - 選「是」 → 240 傷害 + 棄全手牌
//   注意：手牌為 0 時不開 picker（沒得棄）。
ATTACK_PRE_DISCARD_CHOICE.set('輕身鱈ex|光芒強襲', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 120, damagePerEnergy: 0,
  choicePrompt: '是否將自己的手牌全部丟棄，增加 120 點傷害？',
  choiceYesLabel: '是（+120 傷害 + 棄全手牌）',
  choiceNoLabel: '否（保留手牌）',
});
regPre('輕身鱈ex|光芒強襲', (state, aIdx, _pool, action) => {
  if (state.players[aIdx].hand.length === 0) {
    return { state: addLog(state, '光芒強襲：手牌為 0 → 120 傷害', aIdx), damage: 120 };
  }
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return { state: addLog(state, '光芒強襲：選「否」 → 120 傷害（保留手牌）', aIdx), damage: 120 };
  }
  return { state: addLog(state, `光芒強襲：選「是」 → 棄全手牌 ${state.players[aIdx].hand.length} 張 → 120+120 = 240`, aIdx), damage: 240 };
});
regPost('輕身鱈ex|光芒強襲', (state, aIdx, _pool, action) => {
  if (state.players[aIdx].hand.length === 0) return state;
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
  return updatePlayer(state, aIdx, p => ({
    ...p,
    discard: [...p.discard, ...p.hand],
    hand: [],
  }));
});

// 路卡利歐ex|龍捲風猛攻 100 — 下回合本招式 +100（用 damageBonusPending）
regPre('路卡利歐ex|龍捲風猛攻', (s) => ({ state: s, damage: 100 }));
regPost('路卡利歐ex|龍捲風猛攻', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '龍捲風猛攻：下回合本招式 +100', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damageBonusPending: 100 } : null,
  }));
});

// 摔角鷹人|上升衝撞、哲爾尼亞斯ex|上升角擊、鐵臂膀|超合金之手 — 已在 H Wave 1
// 雷吉斯奇魯|激怒之錘 / 故勒頓ex|復仇懲處 — 已在 H Wave 1

// ══════════════════════════════════════════════════════════════════════════════
// === Section 14: 班基拉斯ex 系列 ===
// ══════════════════════════════════════════════════════════════════════════════
// 班基拉斯ex|壓碎 — 自身能量數 ×50
// v4.959：班基拉斯ex 是 Stage2 — 用 host-aware unit count（新衝天能量 on Stage2 = 2 個）。
regPre('班基拉斯ex|壓碎', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const n = att ? countAttachedEnergyAsUnits(att, pool) : 0;
  return { state: addLog(state, `壓碎：自身能量 ${n} → ${n}×50 = ${n*50}`, aIdx), damage: n * 50 };
});
// 班基拉斯ex|暴君粉碎 — 固定 150 + 從對手手牌（不看正面）隨機棄 1 張
//   卡面（SVM 12148, static/cards 權威）：傷害固定 150，效果僅「在不看正面的情況下，從對手的手牌選擇1張，將其丟棄」。
//   v5.686：移除誤植的 regPre（曾硬寫 damage:50，殘留「50×」錯誤註解，台灣無 50× 版）→ 改由引擎讀卡面 150；僅保留 regPost 棄牌效果。
// v6.065：卡面是「**選擇**1張丟棄」→ 玩家盲選，不是隨機。
regPost('班基拉斯ex|暴君粉碎', oppDiscardChosenConcealedPost(1, '暴君粉碎'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 15: 自身互換、對手互換、自方備戰互換 ===
// ══════════════════════════════════════════════════════════════════════════════
// 大電海燕ex|迴旋充能 — 自互 + 從手牌挑最多 2 張基本雷能量附自身
regPre('大電海燕ex|迴旋充能', (s) => ({ state: s, damage: 0 }));
regPost('大電海燕ex|迴旋充能', (state, aIdx, pool) => {
  // 1) 自互
  let s = state;
  // 2) 提供 hand-choose 互動讓玩家挑 0~2 張基本雷能量
  const validIids = state.players[aIdx].hand.filter(c => {
    const card = pool.get(c.cardId);
    return isEnergyOfType(card, 'Lightning') && card?.subtype === 'Basic';
  }).map(c => c.iid);
  s = selfSwapPostInline('迴旋充能')(s, aIdx, pool);
  if (validIids.length > 0) {
    s = withPending(s, {
      type: 'hand-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy:Lightning',
      minCount: 0, maxCount: Math.min(2, validIids.length),
      effectKey: 'h-wave2-attach-from-hand',
      params: { validIids },
    });
  }
  return s;
});
regR('h-wave2-attach-from-hand', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const set = new Set(iids);
  const hostIid = state.players[aIdx].active?.iid; // v5.782 附能目標(迴旋充能後自身戰鬥位)
  const after = updatePlayer(addLog(state, `從手牌附 ${iids.length} 張能量到自身`, aIdx), aIdx, p => {
    const energies = p.hand.filter(c => set.has(c.iid));
    return {
      ...p,
      hand: p.hand.filter(c => !set.has(c.iid)),
      active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] } : null,
    };
  });
  return hostIid ? fireOnHandEnergyAttached(after, aIdx, hostIid, pool) : after; // v5.782 補對手反應
});

// 遠古巨蜓|陀螺音波 110 — 自互
regPre('遠古巨蜓|陀螺音波', (s) => ({ state: s, damage: 110 }));
regPost('遠古巨蜓|陀螺音波', selfSwapPostInline('陀螺音波'));

// 音波龍ex|狡兔三窟 50 — 若希望，自互
regPre('音波龍ex|狡兔三窟', (s) => ({ state: s, damage: 50 }));
regPost('音波龍ex|狡兔三窟', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '狡兔三窟：選擇「否」 — 不互換', aIdx);
  const _cb: AttackPostFn = selfSwapPostInline('狡兔三窟');
  return _cb(state, aIdx, pool);
});

// 流氓熊貓|拉扯 — C-05 gust（攻擊方選對手備戰互換）
// v5.995：收斂到中央 oppSwapDmgPost — 舊手刻站 (1)誤 gate 原戰鬥位免疫(方向相反,C-05 目標是備戰)
//   (2)regR 舊 active 退備戰漏 clearActiveEffects(狀態殘留)。中央版兩者皆正確。
regPre('流氓熊貓|拉扯', (s) => ({ state: s, damage: 0 }));
regPost('流氓熊貓|拉扯', oppSwapDmgPost(0, '拉扯'));

// 沙河馬|推倒 10 — 對手戰鬥/備戰互換（由對手選）
regPre('沙河馬|推倒', (s) => ({ state: s, damage: 10 }));
regPost('沙河馬|推倒', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.837：化隱/純樸等免疫招式效果的 active 不被強制換位（對齊中央 forceOppSwapPost）。
  { const _sa = state.players[dIdx].active;
    if (_sa) { const _sg = canApplyEffectToTarget(state, aIdx, _sa, _pool.get(_sa.cardId), 'attack-effect', _pool);
      if (_sg.blocked) return addLog(state, `推倒：${_sg.reason}（不被強制換位）`, aIdx); } }
  if (state.players[dIdx].bench.length === 0) return state;
  return withPending(addLog(state, '推倒：對手必須將戰鬥/備戰互換（對手選）', aIdx), {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-force-opp-swap-by-self',
  });
});
regR('h-wave2-force-opp-swap-by-self', (state, dIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(state, dIdx, p => {
    if (!p.active) return p;
    const idx = p.bench.findIndex(b => b.iid === targetIid);
    if (idx < 0) return p;
    // v5.743：舊 active 退回備戰必須清除特殊狀態與 active-only 效果(PTCG 規則:
    //   離開戰鬥場解除特殊狀態),同 force-opp-swap/opp-swap-dmg。原本直接 push
    //   p.active! → 中毒/灼傷/招式鎖等殘留到備戰。
    const oldActiveCleared = clearActiveEffects(p.active);
    return { ...p, active: p.bench[idx], bench: p.bench.map((b, i) => i === idx ? oldActiveCleared : b) };
  });
});

// 蓋歐卡ex|蜿蜒浪 80 — 若希望對手互換（對手選）
//   簡化：必中（若希望省略，預設使用希望）
regPre('蓋歐卡ex|蜿蜒浪', (s) => ({ state: s, damage: 80 }));
regPost('蓋歐卡ex|蜿蜒浪', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '蜿蜒浪：選擇「否」 — 不強制換對手', aIdx);
  const _cb: AttackPostFn = (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.837：化隱/純樸等免疫招式效果的 active 不被強制換位（對齊中央 forceOppSwapPost）。
  { const _sa = state.players[dIdx].active;
    if (_sa) { const _sg = canApplyEffectToTarget(state, aIdx, _sa, pool.get(_sa.cardId), 'attack-effect', pool);
      if (_sg.blocked) return addLog(state, `蜿蜒浪：${_sg.reason}（不被強制換位）`, aIdx); } }
  if (state.players[dIdx].bench.length === 0) return state;
  return withPending(addLog(state, '蜿蜒浪：對手戰鬥/備戰互換（對手選）', aIdx), {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-force-opp-swap-by-self',
  });
};
  return _cb(state, aIdx, pool);
});

// 鐵包袱|內部噴射 60 — 自互 + 對手互換
regPre('鐵包袱|內部噴射', (s) => ({ state: s, damage: 60 }));
regPost('鐵包袱|內部噴射', (state, aIdx, pool) => {
  let s = selfSwapPostInline('內部噴射')(state, aIdx, pool);
  // 對手必須互換
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.837：化隱/純樸等免疫招式效果的 active 不被強制換位（對齊中央 forceOppSwapPost）。
  { const _sa = s.players[dIdx].active;
    if (_sa) { const _sg = canApplyEffectToTarget(s, aIdx, _sa, pool.get(_sa.cardId), 'attack-effect', pool);
      if (_sg.blocked) return addLog(s, `內部噴射：${_sg.reason}（不被強制換位）`, aIdx); } }
  if (s.players[dIdx].bench.length === 0) return s;
  return withPending(addLog(s, '內部噴射：對手必須將戰鬥/備戰互換', aIdx), {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-force-opp-swap-by-self',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 16: 對手 1 隻備戰回對手牌庫並重洗 ===
// ══════════════════════════════════════════════════════════════════════════════
// 仙子伊布|奧密迴旋 — 擲幣正面 → 對手 1 備戰與附加卡放回對手牌庫並重洗
regPre('仙子伊布|奧密迴旋', (s) => ({ state: s, damage: 0 }));
regPost('仙子伊布|奧密迴旋', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '奧密迴旋', aIdx);
  if (r.heads === 0) return r.state;
  const dIdx = (1 - aIdx) as 0 | 1;
  if (r.state.players[dIdx].bench.length === 0) return r.state;
  return withPending(addLog(r.state, '奧密迴旋：正面 → 對手 1 備戰回對手牌庫', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-bounce-opp-bench',
  });
});
regR('h-wave2-bounce-opp-bench', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  // v5.809：bounce 是招式效果 → 化隱等免疫者不被放回。
  const _imm = oppPokemonImmuneToAttackEffect(state, aIdx, targetIid, pool);
  if (_imm.blocked) return addLog(state, `${_imm.name}｜${_imm.reason}（不被放回牌庫）`, aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(state, dIdx, p => {
    const target = p.bench.find(b => b.iid === targetIid);
    if (!target) return p;
    const allCards: CardInstance[] = bareCardsForReturn(target); // v5.781 含 extraTools+裸化
    return {
      ...p,
      bench: p.bench.filter(b => b.iid !== targetIid),
      deck: shuffle([...p.deck, ...allCards]),
    };
  });
});

// 甜甜螢|慢芬香 — 後攻第一回合限定，對手 1 備戰回對手牌庫
//   需檢查 turn 與 currentPlayer，這裡簡化：直接使用，引擎方面的限制依現有 turn=1 邏輯
regPre('甜甜螢|慢芬香', (s) => ({ state: s, damage: 0 }));
regPost('甜甜螢|慢芬香', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return state;
  return withPending(addLog(state, '慢芬香：對手 1 備戰回對手牌庫', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-bounce-opp-bench',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 17: 抽支援者 / 棄牌挑支援者 ===
// ══════════════════════════════════════════════════════════════════════════════
// 差不多娃娃|招喚 — 從棄牌區挑 1 張支援者卡（給對手看後）加手
regPre('差不多娃娃|招喚', (s) => ({ state: s, damage: 0 }));
regPost('差不多娃娃|招喚', (state, aIdx, pool) => {
  const validIids = state.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.subtype === 'Supporter';
  }).map(c => c.iid);
  if (validIids.length === 0) return addLog(state, '招喚：棄牌區無支援者卡', aIdx);
  return withPending(addLog(state, '招喚：從棄牌區挑 1 張支援者卡加手', aIdx), {
    type: 'discard-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Supporter',
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-pickup-energy-to-hand',
    params: { validIids },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 18: 自方所有備戰各進化 ===
// ══════════════════════════════════════════════════════════════════════════════
// 彩粉蝶|進化粉 — 卡面「從牌庫，選擇自己所有備戰寶可夢進化而來的卡各1張，放置各自身上完成進化。並重洗。」
// v5.983：原「簡化」開泛用 deck-search 拿最多 N 張任意寶可夢「加手牌」(遠強於卡面、可利用、且加手後可挪用/被進化鎖誤擋)。
//   卡面與人造細胞卵|細胞覺醒逐字相同 → 收斂到同一 chain cellAwakeningStep(逐備戰選該寶可夢進化卡→buildEvolvedInstance→重洗)。
regPre('彩粉蝶|進化粉', (s) => ({ state: s, damage: 0 }));
regPost('彩粉蝶|進化粉', (state, aIdx, pool) => {
  if (state.players[aIdx].bench.length === 0) {
    return updatePlayer(addLog(state, '進化粉：備戰區無寶可夢；重洗牌庫', aIdx), aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  return cellAwakeningStep(state, aIdx, pool, 0, '進化粉');
});

// 伊布|覺醒 — v6.078 收斂到 effects.ts registerDirectEvolveAwaken
//   （石居蟹／夢妖／火箭隊的沙基拉斯／M6 穿山鼠措辭逐字相同 → 單一來源）。
//   effectKey 沿用 'eevee-awaken-evolve' 不變。
registerDirectEvolveAwaken('伊布|覺醒', '伊布', 0, 'eevee-awaken-evolve');

// 蛋蛋|早熟進化 — 直接進化（先攻第一回合限定由 engine firstTurnOnly flag 處理）
// v5.082 修 Rule 15：原 v2.75 簡化為「加手」違反卡面「放置於這隻寶可夢身上完成進化」。
//   改為仿伊布|覺醒 / 石居蟹|覺醒 pattern — filter validIids=deck 中 evolvesFrom='蛋蛋'
//   的進化卡（椰蛋樹 / 阿羅拉椰蛋樹ex），resolver 把該卡放戰鬥場完成進化。
regPre('蛋蛋|早熟進化', (s) => ({ state: s, damage: 0 }));
regPost('蛋蛋|早熟進化', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (!player.active) return addLog(state, '早熟進化：戰鬥場無寶可夢', aIdx);
  const activeCard = pool.get(player.active.cardId);
  if (activeCard?.name !== '蛋蛋') {
    return updatePlayer(addLog(state, '早熟進化：戰鬥場已非「蛋蛋」，僅重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const validIids = player.deck
    .filter(c => pool.get(c.cardId)?.evolvesFrom === '蛋蛋')
    .map(c => c.iid);
  const s = addLog(state,
    validIids.length > 0
      ? '早熟進化：從牌庫選 1 張從「蛋蛋」進化而來的卡，立即進化於自身'
      : '早熟進化：牌庫內無對應的進化卡（仍進行搜尋並重洗）',
    aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Evolution',
    minCount: 0, maxCount: 1,
    effectKey: 'exeggcute-precoition-evolve',
    params: { validIids },
  });
});
regR('exeggcute-precoition-evolve', (state, aIdx, iids, _params, pool) => {
  const player = state.players[aIdx];
  if (iids.length === 0 || !player.active) {
    return updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const evoIid = iids[0];
  const evoIdx = player.deck.findIndex(c => c.iid === evoIid);
  if (evoIdx < 0) return addLog(state, '早熟進化：找不到所選進化卡，僅重洗牌庫', aIdx);
  const evoInst = player.deck[evoIdx];
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard?.evolvesFrom || evoCard.evolvesFrom !== '蛋蛋') {
    return addLog(state, '早熟進化：所選非從蛋蛋進化的卡，僅重洗牌庫', aIdx);
  }
  const activeCard = pool.get(player.active.cardId);
  if (activeCard?.name !== '蛋蛋') {
    return addLog(state, '早熟進化：戰鬥場已非蛋蛋，僅重洗牌庫', aIdx);
  }
  const base = player.active;
  const evolved: CardInstance = buildEvolvedInstance(base, evoInst, state, pool);
  let s = state;
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    active: evolved,
    deck: shuffle(p.deck.filter((_, i) => i !== evoIdx)),
  }));
  return addLog(s, `早熟進化：${evoCard.name} 進化於戰鬥場的蛋蛋，並重洗牌庫`, aIdx);
});

// 電螢蟲|急速信號 — 先攻第一回 + 從牌庫挑 ≤2 基礎放備戰
regPre('電螢蟲|急速信號', (s) => ({ state: s, damage: 0 }));
regPost('電螢蟲|急速信號', deckSearchBasicToBenchPost(2, '急速信號'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 19: 反傷固定 N 個 ===
// ══════════════════════════════════════════════════════════════════════════════
// 鐵磐岩ex|還擊斧 60 — 下回合受招式對攻擊方放 8 個指示物
regPre('鐵磐岩ex|還擊斧', (s) => ({ state: s, damage: 60 }));
regPost('鐵磐岩ex|還擊斧', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '還擊斧：下回合受招式對攻擊方放 8 個傷害指示物', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, retaliateCountersOnNextHit: 8 } : null,
  }));
});

// 爆炸頭水牛|等待角擊 40 — 下回合受招式對攻擊方放 6 個指示物
regPre('爆炸頭水牛|等待角擊', (s) => ({ state: s, damage: 40 }));
regPost('爆炸頭水牛|等待角擊', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '等待角擊：下回合受招式對攻擊方放 6 個傷害指示物', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, retaliateCountersOnNextHit: 6 } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 20: 下回合 cantRetreat ===
// ══════════════════════════════════════════════════════════════════════════════
// 破破舵輪|束縛 60 — 下回合 defender 不可撤退
regPre('破破舵輪|束縛', (s) => ({ state: s, damage: 60 }));
// v5.840：收斂至中央 defCantRetreatNextPost（原 inline 漏化隱免疫 gate）。
regPost('破破舵輪|束縛', defCantRetreatNextPost('束縛'));

// 帕底亞 土王ex|毒陣 60 — 中毒 + 下回合 defender 不可撤退
regPre('帕底亞 土王ex|毒陣', (s) => ({ state: s, damage: 60 }));
// v5.840：禁撤退部分收斂至中央 defCantRetreatNextPost（原 inline 漏化隱免疫 gate）。
regPost('帕底亞 土王ex|毒陣', (state, aIdx, pool) => {
  const s = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost('毒陣')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 21: 下回合 defender 擲反失敗 ===
// ══════════════════════════════════════════════════════════════════════════════
// 沙丘娃|潑沙 10 / 噬沙堡爺|潑沙 60 — defender 下回合擲反失敗
function pothaPost(label: string): AttackPostFn {
  // v6.046：收斂中央 applyOppActiveDebuffPost（原直接寫旗標漏免疫 gate）。
  return applyOppActiveDebuffPost(
    label,
    (a) => ({ ...a, attackFailureFlipCountPending: 1 }),
    `${label}：下回合 defender 用招式時擲 1 次硬幣，反面則招式失敗`,
  );
}
regPre('沙丘娃|潑沙', (s) => ({ state: s, damage: 10 }));
regPost('沙丘娃|潑沙', pothaPost('潑沙'));
regPre('噬沙堡爺|潑沙', (s) => ({ state: s, damage: 60 }));
regPost('噬沙堡爺|潑沙', pothaPost('潑沙'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 22: 下回合自身不受 X 招式傷害 ===
// ══════════════════════════════════════════════════════════════════════════════
// 鐵毒蛾|瘋狂拒絕 120 — 下回合此卡不受「古代」寶可夢招式的傷害
//   v5.885：改用中央 immuneToAncientAttackNextTurn(鏡射 immuneToBasicAttack:engine promote/clear+
//   defense.ts 1b-3 涵蓋 active+bench;傷害檢查看 attacker tags 含'古代')。原 damageReduceNextHit=200
//   兩面皆錯(非古代也被減、古代>200仍穿)。
regPre('鐵毒蛾|瘋狂拒絕', (s) => ({ state: s, damage: 120 }));
regPost('鐵毒蛾|瘋狂拒絕', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '瘋狂拒絕：下回合不受「古代」寶可夢招式的傷害', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, immuneToAncientAttackNextTurn: true } : null,
  }));
});

// 太樂巴戈斯ex|皇冠蛋白石 180 — 下回合不受【基礎】寶可夢（【無】寶可夢除外）招式傷害
//   引擎已有 immuneToBasicAttackNextTurn / ThisTurn 旗標
regPre('太樂巴戈斯ex|皇冠蛋白石', (s) => ({ state: s, damage: 180 }));
regPost('太樂巴戈斯ex|皇冠蛋白石', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '皇冠蛋白石：下回合不受【基礎】寶可夢招式傷害（【無】屬性除外）', aIdx), aIdx, p => ({
    ...p,
    // v5.338：加 companion 旗標 → 消費點對【無】屬攻擊者（旋轉洛托姆等）放行
    active: p.active ? { ...p.active, immuneToBasicAttackNextTurn: true, basicImmuneColorlessExcept: true } : null,
  }));
});

// 裹蜜蟲|塗層攻擊 20 — 同上（不限基礎範圍）
regPre('裹蜜蟲|塗層攻擊', (s) => ({ state: s, damage: 20 }));
regPost('裹蜜蟲|塗層攻擊', (state, aIdx, _pool) => {
  return updatePlayer(addLog(state, '塗層攻擊：下回合不受【基礎】寶可夢招式傷害', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, immuneToBasicAttackNextTurn: true } : null,
  }));
});

// 變隱龍|隱形攻擊 / 托戈德瑪爾|尖刺電光 — 已在 H Wave 1
// 小灰怪|躲藏 — 擲幣正面下回合不受招式傷害
regPre('小灰怪|躲藏', (s) => ({ state: s, damage: 0 }));
regPost('小灰怪|躲藏', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '躲藏', aIdx);
  if (r.heads === 0) return r.state;
  // v5.888：卡面「不會受到招式的傷害與效果的影響」→ 中央 immuneToAllAttackNextTurn(擋傷害+效果),原 999 漏效果。
  return updatePlayer(addLog(r.state, '躲藏：正面 → 下回合不受招式的傷害與效果', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, immuneToAllAttackNextTurn: true } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 23: 預約結束時效果（KO / 放指示物） ===
// ══════════════════════════════════════════════════════════════════════════════
// 凱羅斯|慢嚼碎 — 棄全能量 + 下個對手回合結束時 KO
regPre('凱羅斯|慢嚼碎', (s) => ({ state: s, damage: 0 }));
// v6.046：卡面「…在下個對手的回合結束時，**受到這個招式的寶可夢**會【昏厥】」＝招式效果(效果 KO)
//   → 收斂中央 applyOppActiveDebuffPost（原直接寫旗標漏免疫 gate）。
//   ⚠自身丟能量(PRE 成本)照舊先執行：卡面「將這隻寶可夢身上附加的能量卡全部丟棄」是無條件的，
//     不因對手免疫而免除。
regPost('凱羅斯|慢嚼碎', (state, aIdx, pool) => {
  const s = selfDiscardAllEnergyPost('慢嚼碎')(state, aIdx, pool);
  return applyOppActiveDebuffPost(
    '慢嚼碎',
    (a) => ({ ...a, koAtMyNextEndOfTurn: true }),
    '慢嚼碎：defender 下個對手回合結束時 KO',
  )(s, aIdx, pool);
});

// 冰伊布|滲透寒氣 30 — 下個對手回合結束時 defender 放 9 個指示物
//   引擎暫無「下回合結束時放 N 指示物」flag — 加新 flag damageAtMyNextEndOfTurn 太大
//   暫用：直接設 koAtMyNextEndOfTurn 並 +90 damage（90<HP 不會 KO，但會接近 KO 累積）
//   不準確 — 改用：在 ATTACK_POST 立刻放 9 指示物（90傷害）— 但卡面是「下回合結束時」
//   折衷：先在 defender 上塞 1 個指示物，並標記延遲... 暫無此 hook，改為：直接放 90 dmg
//   並 log 提示玩家「卡面是下回合結束時」。注意：這是已知簡化（待 engine v2.76 補完整 hook）
regPre('冰伊布|滲透寒氣', (s) => ({ state: s, damage: 30 }));
// v6.046：卡面「在下個對手的回合結束時，在**受到這個招式的寶可夢**身上放置9個傷害指示物」
//   ＝放置指示物型招式效果 → 收斂中央 applyOppActiveDebuffPost（原直接寫旗標漏免疫 gate）。
regPost('冰伊布|滲透寒氣', applyOppActiveDebuffPost(
  '滲透寒氣',
  (a) => ({ ...a, damageAtMyNextEndOfTurn: 90 }),
  '滲透寒氣：下個對手回合結束時 defender 放 9 個傷害指示物（90 點）',
));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 24: 牌庫頂操作 ===
// ══════════════════════════════════════════════════════════════════════════════
// 帝牙盧卡|時間掌控 — 從牌庫任意挑 2 張，重洗剩餘，所選的卡放回牌庫上方排序
regPre('帝牙盧卡|時間掌控', (s) => ({ state: s, damage: 0 }));
regPost('帝牙盧卡|時間掌控', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length === 0) return state;
  const max = Math.min(2, state.players[aIdx].deck.length);
  return withPending(addLog(state, `時間掌控：從牌庫任挑 ${max} 張`, aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: max, maxCount: max,
    effectKey: 'h-wave2-time-control',
  });
});
regR('h-wave2-time-control', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  // 重洗剩餘 + 所選的卡放回牌庫上方（順序 = 玩家選擇順序）
  return updatePlayer(addLog(state, `時間掌控：${iids.length} 張卡放回牌庫上方`, aIdx), aIdx, p => {
    const set = new Set(iids);
    const picked = iids.map(iid => p.deck.find(c => c.iid === iid)!).filter(Boolean);
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: [...picked, ...shuffle(rest)] };
  });
});

// 鐵武者|演算 — 牌庫頂 4 排序
regPre('鐵武者|演算', (s) => ({ state: s, damage: 0 }));
regPost('鐵武者|演算', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return state;
  const realN = Math.min(4, p.deck.length);
  const top = p.deck.slice(0, realN);
  return withPending(addLog(state, `演算：查看牌庫頂 ${realN} 張並排序`, aIdx), {
    type: 'reorder-deck-top',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: realN, maxCount: realN,
    effectKey: 'h-wave2-reorder-self-deck',
    params: {
      candidateIids: top.map(c => c.iid),
      titleOverride: `演算：排序自牌庫頂 ${realN} 張`,
    },
  });
});
regR('h-wave2-reorder-self-deck', (state, aIdx, selectedIids, _params, _pool) => {
  return updatePlayer(state, aIdx, p => {
    const set = new Set(selectedIids);
    const top = selectedIids.map(iid => p.deck.find(c => c.iid === iid)!).filter(Boolean);
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: [...top, ...rest] };
  });
});

// 沼王|濕透頭擊 — 棄牌庫頂 3 + 能量卡張數 ×80
regPre('沼王|濕透頭擊', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const top = p.deck.slice(0, 3);
  let energyCount = 0;
  for (const c of top) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy') energyCount++;
  }
  return { state: addLog(state, `濕透頭擊：牌庫頂 3 張中能量 ${energyCount} → ${energyCount}×80 = ${energyCount*80}`, aIdx), damage: energyCount * 80 };
});
regPost('沼王|濕透頭擊', (state, aIdx, pool) => {
  const k = Math.min(3, state.players[aIdx].deck.length);
  const top = state.players[aIdx].deck.slice(0, k);
  return updatePlayer(addLog(state, `濕透頭擊：自己牌庫頂 ${k} 張丟入棄牌區：${joinCardNames(top, pool)}`, aIdx), aIdx, p => ({
    ...p, deck: p.deck.slice(k), discard: [...p.discard, ...top],
  }));
});

// 鐵荊棘|壞死壓榨 (兩種拼法：壊/壞，視來源資料) — 牌庫頂 5 翻面，未來卡張數 ×70，棄未來卡，剩餘重洗
function tetsuibaraDeathSqueezePre(label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const top = p.deck.slice(0, 5);
    // v5.719：卡面「將自己的牌庫上方 5 張卡翻到正面」= 公開揭示，列出翻開的卡名。
    let s = revealTopCardsLog(state, aIdx, top, pool, label);
    let futureCount = 0;
    for (const c of top) {
      const card = pool.get(c.cardId);
      if (card?.tags?.includes('未來')) futureCount++;
    }
    return { state: addLog(s, `${label}：牌庫頂 5 中未來 ${futureCount} → ${futureCount}×70 = ${futureCount*70}`, aIdx), damage: futureCount * 70 };
  };
}
function tetsuibaraDeathSqueezePost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    return updatePlayer(state, aIdx, p => {
      const k = Math.min(5, p.deck.length);
      const top = p.deck.slice(0, k);
      const rest = p.deck.slice(k);
      const futureCards = top.filter(c => pool.get(c.cardId)?.tags?.includes('未來'));
      const nonFutureCards = top.filter(c => !pool.get(c.cardId)?.tags?.includes('未來'));
      return { ...p, deck: shuffle([...rest, ...nonFutureCards]), discard: [...p.discard, ...futureCards] };
    });
  };
}
regPre('鐵荊棘|壞死壓榨', tetsuibaraDeathSqueezePre('壞死壓榨'));
regPost('鐵荊棘|壞死壓榨', tetsuibaraDeathSqueezePost('壞死壓榨'));
regPre('鐵荊棘|壊死壓榨', tetsuibaraDeathSqueezePre('壊死壓榨'));
regPost('鐵荊棘|壊死壓榨', tetsuibaraDeathSqueezePost('壊死壓榨'));

// 好啦魷|惡作劇觸手 — 卡面：「查看對手的牌庫上方 1 張卡，回復原樣。若希望，重洗那個牌庫。」
//   v5.681：原借殼 binary-yes-no → 玩家在【看到對手牌庫頂之前】就要決定重洗，且實作自動重洗（違反「若希望」）。
//   改用 modal-choice：先 peek 對手牌庫頂 1 張，把卡名放進選項 text 揭示給(出招)玩家，
//   看過後再選「重洗 / 保留」。只揭示頂 1 張（不洩漏對手整副牌庫）。
regPre('好啦魷|惡作劇觸手', (s) => ({ state: s, damage: 0 }));
regPost('好啦魷|惡作劇觸手', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (opp.deck.length === 0) return addLog(state, '惡作劇觸手：對手牌庫已空', aIdx);
  const topName = pool.get(opp.deck[0].cardId)?.name ?? '?';
  // v5.794：查看後「回復原樣」放回對手牌庫 → 卡名不應對對手揭露（否則對手得知自己牌庫頂）。
  //   改用中央 addPrivateLog：出招方看到卡名、對手只看到脫敏版。
  const s = addPrivateLog(state, `惡作劇觸手：查看對手牌庫頂為「${topName}」`, '惡作劇觸手：查看對手牌庫頂 1 張', aIdx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'mischief-tentacle-reshuffle',
    params: {
      label: '惡作劇觸手',
      options: [
        { id: 'reshuffle', text: `重洗對手牌庫（牌庫頂為「${topName}」）` },
        { id: 'keep', text: '保留原樣（不重洗）' },
      ],
    },
  });
});
regR('mischief-tentacle-reshuffle', (state, aIdx, iids) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (iids[0] === 'reshuffle') {
    return updatePlayer(addLog(state, '惡作劇觸手：重洗對手牌庫', aIdx), dIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  return addLog(state, '惡作劇觸手：保留對手牌庫原樣', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 25: 對手手牌操作 ===
// ══════════════════════════════════════════════════════════════════════════════
// 蜻蜻蜓|靜默之翼 20 — 查看對手手牌（純揭露 log）
regPre('蜻蜻蜓|靜默之翼', (s) => ({ state: s, damage: 20 }));
// v5.876：收斂到中央 openPeekOppHandView(開 UI 讓玩家在畫面上查看對手整副手牌,同咕咕|靜默之翼)。
//   原僅 addPrivateLog 純 log。
regPost('蜻蜻蜓|靜默之翼', (state, aIdx) => openPeekOppHandView(state, aIdx, '靜默之翼'));

// 焰后蜥|突然炙烤 — 對手選棄 1 張，若這隻寶可夢從「夜盜火蜥」進化則再棄 2 張
regPre('焰后蜥|突然炙烤', (s) => ({ state: s, damage: 0 }));
regPost('焰后蜥|突然炙烤', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (opp.hand.length === 0) return addLog(state, '突然炙烤：對手手牌為空', aIdx);
  // v5.884：卡面「對手選擇對手自己的1張手牌丟棄。在這個回合，若這隻從『夜盜火蜥』進化則再丟棄2張」。
  //   修:①對手自選(原隨機丟違卡面「對手選擇」)②「這個回合進化」用 evolvedThisTurn 判定(原只看
  //   evolvedFromStack→每回合都誤+2)。開對手 hand-discard picker(actorIdx=dIdx)+中央 wave15-opp-hand-discard
  //   resolver(對手選+公開揭示丟棄卡名,棄牌區公開)。k=1 或 3(這回合從夜盜火蜥進化)。
  const a = state.players[aIdx].active;
  const evolvedFromNightScorch = !!a?.evolvedThisTurn
    && !!a?.evolvedFromStack?.some(c => pool.get(c.cardId)?.name === '夜盜火蜥');
  const k = Math.min(evolvedFromNightScorch ? 3 : 1, opp.hand.length);
  const s = addLog(state, `突然炙烤：對手選擇自己 ${k} 張手牌丟棄${evolvedFromNightScorch ? '（本回合從夜盜火蜥進化 +2）' : ''}`, aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: k, maxCount: k,
    effectKey: 'wave15-opp-hand-discard',
    params: { label: '突然炙烤' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 26: 雙方寶可夢 ===
// ══════════════════════════════════════════════════════════════════════════════
// 死神棺|冥府之律 — 雙方所有擁有特性的寶可夢各放 6 個指示物（60 點）
regPre('死神棺|冥府之律', (s) => ({ state: s, damage: 0 }));
regPost('死神棺|冥府之律', (state, aIdx, pool) => {
  let s = state;
  const dIdx = (1 - aIdx) as 0 | 1;
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    const updateOne = (c: CardInstance | null, loc: 'active' | 'bench' = 'active'): CardInstance | null => {
      if (!c) return c;
      const card = pool.get(c.cardId);
      // v6.049：卡面「所有**擁有特性的**寶可夢」→ 特性被消除者（監視塔/初始化/暗夜羽擊/
      //   黏著束縛）就不是目標。原本只看卡片印刷。
      if (!hasAnyEffectiveAbility(s, c, card, idx, loc, pool)) return c;
      // v4.53 Phase 3：僅對手側檢查（自方招式作用自方寶可夢不擋）；用 unified('attack-effect')
      //   涵蓋對戰圓形 / 球形盾牌 / 藏隱 / 深度下潛 / 羽毛化石 / 光之翼 / 薄霧 / 抵抗之幕 / 全能硬殼 等
      if (idx === dIdx) {
        const _riverIsBench = c.iid !== p.active?.iid;
        const guard = canApplyEffectToTarget(s, aIdx, c, card, 'attack-effect', pool, { isBench: _riverIsBench });
        if (guard.blocked) {
          s = addLog(s, `冥府之律：${card.name ?? '?'}｜${guard.reason}（不放指示物）`, aIdx);
          return c;
        }
      }
      return { ...c, damage: (c.damage ?? 0) + 60 };
    };
    s = updatePlayer(s, idx, pl => ({
      ...pl,
      active: updateOne(pl.active) as CardInstance | null,
      bench: pl.bench.map(b => updateOne(b)!),
    }));
  }
  return addLog(s, '冥府之律：雙方所有有特性的寶可夢各放 6 個傷害指示物', aIdx);
});

// 雷丘|捲入伏特 — 此寶可外，雙方有指示物的所有寶可夢受 50（不計弱抗）
regPre('雷丘|捲入伏特', (s) => ({ state: s, damage: 0 }));
regPost('雷丘|捲入伏特', (state, aIdx, pool) => {
  let s = state;
  const myActiveIid = s.players[aIdx].active?.iid;
  const dIdx = (1 - aIdx) as 0 | 1;
  for (const idx of [0, 1] as const) {
    const updateOne = (c: CardInstance | null): CardInstance | null => {
      if (!c) return c;
      if (c.iid === myActiveIid) return c;  // 排除自身
      if ((c.damage ?? 0) === 0) return c;  // 排除無指示物
      // v4.54：卡面是「N 點傷害」(attack-damage)，不是「招式效果」。
      //   不該套薄霧/抵抗之幕/皇帝之勢/全能硬殼/硬岩 (這些只擋 effect 不擋 damage)。
      //   對 bench 走 resolveBenchGuard('attack-damage') → 擋球形盾牌/藏隱/深度下潛/羽毛化石/花之帷幔/太晶 等
      //   對 active 完全不擋 (傷害計算由 caller 直接寫 damage)
      if (idx === dIdx) {
        const card = pool.get(c.cardId);
        const _voltIsBench = c.iid !== s.players[dIdx].active?.iid;
        const guard = canApplyEffectToTarget(s, aIdx, c, card, 'attack-damage', pool, { isBench: _voltIsBench });
        if (guard.blocked) {
          s = addLog(s, `捲入伏特：${card?.name ?? '?'}｜${guard.reason}（不受傷害）`, aIdx);
          return c;
        }
      }
      return { ...c, damage: (c.damage ?? 0) + 50 };
    };
    s = updatePlayer(s, idx, pl => ({
      ...pl,
      active: updateOne(pl.active) as CardInstance | null,
      bench: pl.bench.map(b => updateOne(b)!),
    }));
  }
  return addLog(s, '捲入伏特：除自身外，雙方有指示物寶可夢各受 50（不計弱抗）', aIdx);
});

// 河馬獸|大沙風暴 150 — 雙方所有有指示物的備戰寶可夢受 40（不計弱抗）
regPre('河馬獸|大沙風暴', (s) => ({ state: s, damage: 150 }));
regPost('河馬獸|大沙風暴', (state, aIdx, pool) => {
  let s = state;
  const dIdx = (1 - aIdx) as 0 | 1;
  for (const idx of [0, 1] as const) {
    s = updatePlayer(s, idx, p => ({
      ...p,
      bench: p.bench.map(b => {
        if ((b.damage ?? 0) <= 0) return b;
        // v2.92 對手側 per-target check
        if (idx === dIdx) {
          const bCard = pool.get(b.cardId);
          // v4.58：卡面是「40 點傷害」(attack-damage)，不是「指示物放置」(attack-effect)。
          //   原 v2.92 用 effect immunity 雙重 helper 過度擋（薄霧/抵抗之幕/皇帝之勢/全能硬殼/硬岩 只擋 effect 不擋 damage）。
          //   改 unified('attack-damage', isBench:true) → 只擋球形盾牌/藏隱/深度下潛/羽毛化石/花之帷幔/太晶 等真擋傷害的卡
          const guard = canApplyEffectToTarget(s, aIdx, b, bCard, 'attack-damage', pool, { isBench: true });
          if (guard.blocked) {
            s = addLog(s, `大沙風暴：${bCard?.name ?? '?'}｜${guard.reason}（不受傷害）`, aIdx);
            return b;
          }
        }
        return { ...b, damage: (b.damage ?? 0) + 40 };
      }),
    }));
  }
  return addLog(s, '大沙風暴：雙方所有有指示物備戰寶可受 40', aIdx);
});

// 隨風球|一同爆炸 — 場上「飄飄球」/「隨風球」數 ×50 + 同類各受 30
regPre('隨風球|一同爆炸', (state, aIdx, pool) => {
  let count = 0;
  for (const idx of [0, 1] as const) {
    const p = state.players[idx];
    for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
      const card = pool.get(c.cardId);
      if (card?.name === '飄飄球' || card?.name === '隨風球') count++;
    }
  }
  return { state: addLog(state, `一同爆炸：場上飄飄球/隨風球 ${count} → ${count}×50 = ${count*50}`, aIdx), damage: count * 50 };
});
regPost('隨風球|一同爆炸', (state, aIdx, pool) => {
  let s = state;
  const dIdx = (1 - aIdx) as 0 | 1;
  for (const idx of [0, 1] as const) {
    s = updatePlayer(s, idx, p => {
      const updateOne = (c: CardInstance | null): CardInstance | null => {
        if (!c) return c;
        const card = pool.get(c.cardId);
        if (card?.name !== '飄飄球' && card?.name !== '隨風球') return c;
        // v2.92 招式效果免疫檢查（僅對手側）
        if (idx === dIdx) {
          const guard = canApplyAttackEffectToTarget(s, aIdx, c, card, pool);
          if (guard.blocked) {
            s = addLog(s, `一同爆炸：${card.name}｜${guard.reason}（不放指示物）`, aIdx);
            return c;
          }
        }
        return { ...c, damage: (c.damage ?? 0) + 30 };
      };
      return {
        ...p,
        active: updateOne(p.active) as CardInstance | null,
        bench: p.bench.map(b => updateOne(b)!),
      };
    });
  }
  return addLog(s, '一同爆炸：場上飄飄球/隨風球各受 30', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 27: 來悲粗茶|詛咒水滴 — 4 個指示物分配對手寶可夢 ===
// ══════════════════════════════════════════════════════════════════════════════
regPre('來悲粗茶|詛咒水滴', (s) => ({ state: s, damage: 0 }));
regPost('來悲粗茶|詛咒水滴', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (!opp.active && opp.bench.length === 0) return state;
  return withPending(addLog(state, '詛咒水滴：將 4 個傷害指示物以任意方式放置於對手的寶可夢身上', aIdx), {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 4, maxCount: 4,
    effectKey: 'h-wave2-distribute-damage',
    // v5.678：卡面「對手的寶可夢」含戰鬥位 → includeActive（原漏 → picker 預設只列備戰，放不到對手戰鬥位）
    params: { totalCounters: 4, target: 'opp', includeActive: true },
  });
});
regR('h-wave2-distribute-damage', (state, aIdx, iids, params, pool) => {
  // damage-distribute：selectedIids 是「每個指示物選了哪隻」的列表，每指示物 10 傷。
  const totalCounters = (params?.totalCounters as number | undefined) ?? 4;
  // v5.440：改走中央 dealAttackDamageToTarget(attack-effect) — 原本完全沒套效果免疫 guard
  //   (對戰圓形/薄霧/球形盾牌等該擋)。逐指示物結算 + KO。
  let s = addLog(state, `詛咒水滴：分配 ${totalCounters} 個指示物`, aIdx);
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, 10, pool, { kind: 'attack-effect', label: '詛咒水滴' });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 28: 對手 1 隻寶可夢與附加卡放回對手牌庫並重洗（任意） ===
// ══════════════════════════════════════════════════════════════════════════════
// 狡猾天狗|驅趕龍捲風 — 選 3 隻對手備戰，將沒選的所有備戰回對手牌庫
regPre('狡猾天狗|驅趕龍捲風', (s) => ({ state: s, damage: 0 }));
regPost('狡猾天狗|驅趕龍捲風', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const benchN = state.players[dIdx].bench.length;
  if (benchN <= 3) return addLog(state, '驅趕龍捲風：對手備戰 ≤3 → 無變化', aIdx);
  return withPending(addLog(state, `驅趕龍捲風：選 3 隻對手備戰留下，其他回對手牌庫`, aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 3, maxCount: 3,
    effectKey: 'h-wave2-bounce-non-selected',
  });
});
regR('h-wave2-bounce-non-selected', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const set = new Set(selectedIids);
  return updatePlayer(addLog(state, '驅趕龍捲風：未選的備戰寶可夢回對手牌庫並重洗', aIdx), dIdx, p => {
    const keep: CardInstance[] = [];
    const bounceCards: CardInstance[] = [];
    for (const b of p.bench) {
      // v5.809：化隱等免疫者(招式效果)不被放回 → 強制留下。
      if (set.has(b.iid) || oppPokemonImmuneToAttackEffect(state, aIdx, b.iid, pool).blocked) {
        keep.push(b);
      } else {
        bounceCards.push(...bareCardsForReturn(b)); // v5.781 含 extraTools+裸化
      }
    }
    return { ...p, bench: keep, deck: shuffle([...p.deck, ...bounceCards]) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 29: 自殘混亂 ===
// ══════════════════════════════════════════════════════════════════════════════
// 修建老匠|暴走 80 — 自身混亂
// v2.991：加憨憨臉（Klutz）免疫檢查；此 wave 註冊被 effects.ts 1826 覆蓋（已正確），改正以防未來載入順序變更
//         inline 檢查避免從 effects.ts 引入未 export 的 isConfusionImmune
regPre('修建老匠|暴走', (s) => ({ state: s, damage: 80 }));
// v5.675：修建老匠|暴走 的 regPost 已收斂至 effects.ts（中央 applyStatusToSelfActive）。
//   此處原為重複註冊（ATTACK_POST.set 後者覆蓋，effects.ts 勝出），移除以免雙頭維護；regPre 仍保留於上。

// 修建老匠|堅毅橫掃 250 — 若特殊狀態能量任用（cost 寬鬆但 base damage 確定）
regPre('修建老匠|堅毅橫掃', (s) => ({ state: s, damage: 250 }));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 30: 雜項 ===
// ══════════════════════════════════════════════════════════════════════════════
// 謝米|能量反射 60 — 移 1 自身能量到備戰
// v3.14 修 Rule 7：原「自動取末尾能量 + 第 1 隻備戰」雙重 auto-pick 違反卡面
//   「選擇 1 個能量改附於備戰寶可夢」（兩端皆要玩家選）。改成 active-energy-discard
//   → bench-choose chain（同 v2352 凱路迪歐|能量反射做法）。
regPre('謝米|能量反射', (s) => ({ state: s, damage: 60 }));
regPost('謝米|能量反射', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  if (!a || a.energyAttached.length === 0 || state.players[aIdx].bench.length === 0) return state;
  return withPending(addLog(state, '能量反射：選擇 1 個自身能量', aIdx), {
    type: 'active-energy-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1, effectKey: 'v3140-shaymin-energy-reflect-pick',
    params: { titleOverride: '選擇要改附的自身能量' },
  });
});
regR('v3140-shaymin-energy-reflect-pick', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  return withPending(addLog(state, '能量反射：選擇要附上的備戰寶可夢', aIdx), {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1, effectKey: 'v3140-shaymin-energy-reflect-commit',
    params: { energyIid: iids[0], titleOverride: '選擇要改附能量的備戰寶可夢' },
  });
});
regR('v3140-shaymin-energy-reflect-commit', (state, aIdx, iids, params, pool) => {
  const energyIid = params?.energyIid as string | undefined;
  const targetIid = iids[0];
  if (!energyIid || !targetIid) return state;
  let movedName = '能量';
  const s = updatePlayer(state, aIdx, pl => {
    if (!pl.active) return pl;
    const moved = pl.active.energyAttached.find(e => e.iid === energyIid);
    if (!moved) return pl;
    movedName = pool.get(moved.cardId)?.name ?? '能量';
    return {
      ...pl,
      active: { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== energyIid) },
      bench: pl.bench.map(b => b.iid === targetIid ? { ...b, energyAttached: [...b.energyAttached, moved] } : b),
    };
  });
  const target = s.players[aIdx].bench.find(b => b.iid === targetIid);
  const tName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  return addLog(s, `能量反射：將 ${movedName} 改附於 ${tName}`, aIdx);
});

// 阿羅拉 椰蛋樹ex|嗡嗡榍石 — 擲幣正→對手戰鬥場基礎KO/反→對手1備戰基礎KO
regPre('阿羅拉 椰蛋樹ex|嗡嗡榍石', (s) => ({ state: s, damage: 0 }));
regPost('阿羅拉 椰蛋樹ex|嗡嗡榍石', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '嗡嗡榍石', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  if (r.heads === 1) {
    // 對手戰鬥場若為基礎 → KO
    const da = r.state.players[dIdx].active;
    if (!da) return r.state;
    const card = pool.get(da.cardId);
    if (card?.stage !== 'Basic') return addLog(r.state, '嗡嗡榍石：對手戰鬥場非基礎，無效', aIdx);
    return koTargetByAttackEffect(addLog(r.state, '嗡嗡榍石：正面 → 對手戰鬥場(基礎)KO', aIdx), aIdx, da, true, pool, '嗡嗡榍石');
  }
  // 反 → 對手選 1 備戰「基礎」KO。⚠v5.996：opp-bench-choose 只認 validIids、忽略 filter 欄 → 用 validIids 限基礎。
  const _benchBasic = r.state.players[dIdx].bench.filter(b => pool.get(b.cardId)?.stage === 'Basic').map(b => b.iid);
  if (_benchBasic.length === 0) return addLog(r.state, '嗡嗡榍石：反面 → 對手備戰無基礎寶可夢，無效', aIdx);
  return withPending(addLog(r.state, '嗡嗡榍石：反面 → 選 1 對手備戰(基礎)KO', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave2-ko-opp-bench-basic',
    params: { validIids: _benchBasic },
  });
});
regR('h-wave2-ko-opp-bench-basic', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  const benchTarget = state.players[dIdx].bench.find(b => b.iid === targetIid);
  if (!benchTarget) return state;
  return koTargetByAttackEffect(addLog(state, '嗡嗡榍石：對手備戰寶可夢 KO', aIdx), aIdx, benchTarget, false, pool, '嗡嗡榍石');
});

// 謎擬Ｑex|惡作劇之手 — 對手 2 隻寶可夢身上各放 3 個指示物（30 點）
regPre('謎擬Ｑex|惡作劇之手', (s) => ({ state: s, damage: 0 }));
regPost('謎擬Ｑex|惡作劇之手', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const total = (state.players[dIdx].active ? 1 : 0) + state.players[dIdx].bench.length;
  if (total === 0) return state;
  return withPending(addLog(state, '惡作劇之手：選 2 隻對手寶可夢各放 3 個指示物（30 點）', aIdx), {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: Math.min(2, total), maxCount: Math.min(2, total),
    effectKey: 'h-wave2-place-3-counters',
  });
});
regR('h-wave2-place-3-counters', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  // v5.961 放指示物走中央 dealAttackDamageToTarget(kind='attack-effect'):免疫gate(化隱/球形盾牌等)+
  //   KO 結算 + 標記效果KO(_faintByEffect→復仇家族 bucket 不誤觸發)。原 inline updatePlayer 漏 KO 結算。
  let s = state;
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, 30, pool, { kind: 'attack-effect', label: '惡作劇之手' });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// 胖甜妮|甜甜你 — 擲 2 次硬幣 ×90 + 全反混亂
regPre('胖甜妮|甜甜你', coinHeadsMultiplyPre(2, 90, '甜甜你'));
regPost('胖甜妮|甜甜你', (state, aIdx, pool) => {
  // v5.786：卡面「若全部為反面，則將對手戰鬥寶可夢【混亂】」。
  //   coinHeadsMultiplyPre 已把擲幣正面數存入 _lastCoinHeads（v5.786 中央補），
  //   讀它判定 heads===0（2 次全反）才混亂，禁再擲/隨機（原 no-op，混亂完全沒實作）。
  const heads = state._lastCoinHeads ?? 0;
  if (heads === 0) {
    return statusPost('confused')(addLog(state, '甜甜你：2 次全反面 → 對手混亂', aIdx), aIdx, pool);
  }
  return addLog(state, `甜甜你：${heads} 次正面（非全反）→ 無附加狀態`, aIdx);
});

// 薄荷果|... 略 (沒在列表)

// 大舌頭|舌引 — 對手手牌挑 ≤2 基礎放對手備戰（複雜：需展示對手手牌+選擇）
regPre('大舌頭|舌引', (s) => ({ state: s, damage: 0 }));
regPost('大舌頭|舌引', (state, aIdx, pool) => {
  // v5.708：卡面「查看對手手牌，從中選最多 2 張【基礎】寶可夢放對手備戰」。原為自動放前 2 張、
  //   未揭示對手手牌也未讓玩家選 → 改鏡射邀請眨眼:揭示對手手牌(公開)+ hand-choose picker
  //   (actor=自己,source=對手,選 0~2 張基礎)。
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const benchSpace = Math.max(0, getOwnBenchLimit(state, dIdx, pool) - opp.bench.length);
  if (benchSpace === 0) return addLog(state, '舌引：對手備戰區已滿', aIdx);
  if (opp.hand.length === 0) return addLog(state, '舌引：對手手牌為空', aIdx);
  const handNames = opp.hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v5.877：揭示對手手牌改 addPrivateLog(僅 actor 看卡名,觀戰者只見張數)
  let s = addPrivateLog(state,
    `舌引：查看對手手牌（${opp.hand.length} 張）— ${handNames}`,
    `舌引：查看對手手牌（${opp.hand.length} 張）`,
    aIdx);
  const candidates = opp.hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && (card.subtype === 'Basic' || card.stage === 'Basic');
  });
  if (candidates.length === 0) return addLog(s, '舌引：對手手牌沒有【基礎】寶可夢', aIdx);
  const maxPick = Math.min(2, benchSpace, candidates.length);
  s = addLog(s, `舌引：選最多 ${maxPick} 張【基礎】寶可夢放對手備戰區`, aIdx);
  return withPending(s, {
    type: 'hand-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: maxPick,
    effectKey: 'tongue-pull-place',
    params: { validIids: candidates.map(c => c.iid), label: '舌引' },
  });
});
regR('tongue-pull-place', (st, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '舌引：未選擇任何寶可夢，效果結束', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = st.players[dIdx];
  const slotsLeft = Math.max(0, getOwnBenchLimit(st, dIdx, pool) - opp.bench.length);
  const actualIids = iids.slice(0, Math.min(2, slotsLeft));
  const placed: CardInstance[] = [];
  const names: string[] = [];
  for (const iid of actualIids) {
    const inst = opp.hand.find(c => c.iid === iid);
    if (!inst) continue;
    const card = pool.get(inst.cardId);
    if (!card || card.supertype !== 'Pokemon') continue;
    if (!(card.subtype === 'Basic' || card.stage === 'Basic')) continue;
    placed.push({ ...toBareCard(inst), justPlaced: true });  // v5.708 裸化+justPlaced(同回合不可進化)
    names.push(card.name);
  }
  if (placed.length === 0) return addLog(st, '舌引：所選不符條件', aIdx);
  const placedSet = new Set(placed.map(p => p.iid));
  return updatePlayer(addLog(st, `舌引：將 ${names.join('、')} 放到對手備戰區`, aIdx), dIdx, p => ({
    ...p,
    hand: p.hand.filter(c => !placedSet.has(c.iid)),
    bench: [...p.bench, ...placed.map(placedBenchInstance)],
  }));
});

// 米立龍ex|硃砂誘餌 / 人造細胞卵|傳喚之門 / 拉普拉斯ex|海紋石之雨
//   — 3 張都是 deck-search 但篩選複雜，採通用簡化
regPre('米立龍ex|硃砂誘餌', (s) => ({ state: s, damage: 0 }));
regPost('米立龍ex|硃砂誘餌', deckTopPeekPokemonToBenchPost(10, '硃砂誘餌'));

regPre('人造細胞卵|傳喚之門', (s) => ({ state: s, damage: 0 }));
regPost('人造細胞卵|傳喚之門', deckTopPeekPokemonToBenchPost(8, '傳喚之門'));

regPre('拉普拉斯ex|海紋石之雨', (s) => ({ state: s, damage: 0 }));
regPost('拉普拉斯ex|海紋石之雨', deckTopPeekEnergyAttachToAnyPost(20, 20, '海紋石之雨'));

// 霜奶仙|彩色甜點 — 牌庫挑符合自身基本能量屬性的寶可夢卡（≤5）給對手看後加手
//
// v3.13 修 B7：原本 filter='Pokemon' 太寬，未限定「與自身附加的基本能量同屬性」。
//   改法：先讀取自身 active 身上附加的基本能量屬性集合，組成
//         'Pokemon:Types=A,B,...' filter；若無基本能量則招式無效。
regPre('霜奶仙|彩色甜點', (s) => ({ state: s, damage: 0 }));
regPost('霜奶仙|彩色甜點', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '彩色甜點：牌庫已空', aIdx);
  if (!player.active) return state;
  // 收集自身身上附加的「基本能量」屬性集合
  const types = new Set<string>();
  for (const e of player.active.energyAttached) {
    const ec = pool.get(e.cardId);
    if (ec?.supertype === 'Energy' && ec.subtype === 'Basic') {
      // pokemonType 優先，沒有就從卡名 【X】 解析
      let t = ec.pokemonType as string | undefined;
      if (!t) {
        const m = ec.name.match(/【(.+?)】/);
        const map: Record<string, string> = {
          '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
          '超': 'Psychic', '鬥': 'Fighting', '惡': 'Darkness', '鋼': 'Metal',
          '無': 'Colorless', '妖': 'Fairy', '龍': 'Dragon',
        };
        if (m) t = map[m[1]] ?? m[1];
      }
      if (t) types.add(t);
    }
  }
  if (types.size === 0) {
    return addLog(state, '彩色甜點：自身未附加基本能量 → 無對應屬性的寶可夢可挑', aIdx);
  }
  const typeList = [...types].join(',');
  return withPending(
    addLog(state, `彩色甜點：從牌庫挑 0~5 張【${typeList}】屬性寶可夢給對手看後加手（重洗）`, aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: `Pokemon:Types=${typeList}`,
      minCount: 0, maxCount: 5,
      effectKey: 'wave13-deck-take-any',
      // v6.097 霜奶仙｜彩色甜點 卡面「…合計最多5張，在給對手看過後加入手牌」→ 公開揭示卡名。
      params: { label: '彩色甜點', publicReveal: true },
    },
  );
});

// 帕底亞 烏波|打滾 / 烈焰馬|燃燒狂奔 / 利歐路|電光一閃 - 已在 Wave 1
// 蜂蜜醬球菇/敗露球菇ex 孢子彈、鐵蟻|咬碎 - 在 Wave 1

// 鐵蟻|咬碎 50 — 擲幣正面 → 棄對手戰鬥 1 能量
regPre('鐵蟻|咬碎', (s) => ({ state: s, damage: 50 }));
regPost('鐵蟻|咬碎', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '咬碎', aIdx);
  if (r.heads === 0) return r.state;
  // v5.973：正面 → 中央 discardOppActiveEnergyPost(選擇 picker + 免疫 gate),取代原自動丟末張(且原漏 gate)。
  return discardOppActiveEnergyPost('咬碎', 'any')(addLog(r.state, '咬碎：正面', aIdx), aIdx, pool);
});

// 烏賊王|勾結觸手 — 卡面：「選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。然後，新上場的寶可夢
//   受到120點傷害。在這個回合，若沒有從手牌使出『庫瑟洛斯奇的企圖』，則這個招式失敗。」
// v5.995 實裝：kuceroskPlayedThisTurn 旗標（reg('庫瑟洛斯奇的企圖') 設、END_TURN 清）+
//   中央 oppSwapDmgPost(120)（C-05 gust + 新上場傷害走 dealAttackDamageToTarget）。
regPre('烏賊王|勾結觸手', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('烏賊王|勾結觸手', (state, aIdx, pool) => {
  if (!state.players[aIdx].kuceroskPlayedThisTurn) {
    return addLog(state, '勾結觸手：這個回合沒有從手牌使出「庫瑟洛斯奇的企圖」 → 招式失敗', aIdx);
  }
  return oppSwapDmgPost(120, '勾結觸手')(state, aIdx, pool);
});

// 列陣兵|一併攻擊 — 已在 Section 13

// 米立龍ex|硃砂誘餌 — 已實裝
// 蓋歐卡ex|蜿蜒浪 — 已實裝


// v3.11 — 烈咬陸鯊ex|水炮著陸（cost: 1 鬥）
//   卡面：從棄牌區選擇最多 3 張基本【鬥】能量，以任意方式附於備戰寶可夢身上
regPre('烈咬陸鯊ex|水炮著陸', (s) => ({ state: s, damage: 0 }));
regPost('烈咬陸鯊ex|水炮著陸', discardSearchAttachToBenchPost(3, '水炮著陸', 'Fighting'));

// v3.11 — 怒鸚哥ex|幹勁十足（cost: 1 無）
//   卡面：從棄牌區選擇最多 2 張基本能量，附於 1 隻備戰寶可夢身上（同花舞鳥|能量支援 pattern）
regPre('怒鸚哥ex|幹勁十足', (s) => ({ state: s, damage: 0 }));
regPost('怒鸚哥ex|幹勁十足', discardSearchAttachToBenchPost(2, '幹勁十足'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 2 統計：80+ 張
// ══════════════════════════════════════════════════════════════════════════════
