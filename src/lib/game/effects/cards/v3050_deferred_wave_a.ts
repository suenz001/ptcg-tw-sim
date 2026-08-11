/**
 * v3.05 Deferred Wave A — 5 張需要新 engine hook 的特性卡（2 張本波實裝）
 *
 * 來源：v3.01 Wave 3 / Group 2 / Group 4 等先前波次中標 deferred 的卡，本波集中
 * 補 Phase 1：「自身寶可夢從戰鬥場回備戰時觸發」（ON_RETREAT_TO_BENCH）類 2 張。
 *
 * 涵蓋本波（Phase 1）：
 *   1. 海豚俠｜全能變身（H）— 從戰鬥場回備戰時，可從牌庫互換成「海豚俠ex」並保留所有附加。
 *   2. 鋼炮臂蝦｜返回重載（I）— 從戰鬥場回備戰時，可從手牌附最多 2 張基本【水】能量。
 *
 * Phase 2 deferred（不在本波）：
 *   - 超能妙喵｜誘導之尾（H）— 需新 hook ON_DISCARD_FROM_HAND（玩家手牌主動丟卡觸發）。
 *   - 火神蛾｜熱浪鱗粉（I）— 同上 hook。
 *   - 齒輪怪｜緊急迴轉（H）— 需新 hook ON_HAND_ACTIVATE（手牌寶可夢自身觸發放上備戰）。
 *   以上 3 張需要在 +page.svelte 手牌渲染加按鈕 + 新增 action types，工程量較大故 defer。
 *
 * 設計：
 *   - 兩張卡的 regA() 在 module top-level 呼叫（_shared.ts 的 ABILITY_EFFECTS Map 是 leaf
 *     module，無 TDZ 風險）— 符合 Iron Rule 12 例外清單。
 *   - 新 hook map ON_RETREAT_TO_BENCH_ABILITIES 集中在 effects.ts 自身宣告（new Set），
 *     並由 engine.ts RETREAT handler 末端讀取 + 呼叫 askUseRetreatToBenchAbility() 詢問。
 *   - 玩家選「使用」→ 走 resolve-retreat-to-bench-ability-prompt resolver → 執行 ABILITY_EFFECTS。
 *
 * 觸發路徑：engine.ts RETREAT handler 末端，retreaterPoke 已寫入 newBench 之後。
 *   後續其他換場路徑（招式互換 / 特性互換 / 被吹回）尚未涵蓋，留待後續 wave 補。
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import { fireOnHandEnergyAttached } from '../_shared'; // v5.662 從手牌附能→對手反應(侵蝕詛咒/麻痺門牙)
import {
  regA, regR,
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';
import type { Card } from '$lib/cards/types';

// 導出 sentinel 防止 unused import warnings
export type _v3050Sentinel = PlayerState | GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ════════════════════════════════════════════════════════════════════════════

/** 從備戰區找到指定 iid 的 inst（撤退完後 retreater 就在備戰）。 */
function findOnBench(player: PlayerState, iid: string | undefined): CardInstance | undefined {
  if (!iid) return undefined;
  return player.bench.find(c => c.iid === iid);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 海豚俠｜全能變身（SV6 / SV8a / MC）
//
// 卡面：「在自己的回合，這隻寶可夢從戰鬥場回到備戰區時，可使用 1 次。從自己的牌庫
//   選擇 1 張『海豚俠【ex】』，與這張卡互換（所附加的卡・傷害指示物・特殊狀態・
//   效果等全部保留）。若互換了，則這張卡放回牌庫。並且重洗牌庫。」
//
// 觸發：engine.ts RETREAT handler 末端 hook → modal prompt → 此 regA fn。
// 邏輯：
//   1) 從 cardInst（= 撤退後在備戰的「海豚俠」）找到位置
//   2) 開 deck-search 找『海豚俠ex』；filter='Pokemon'，effectKey='hugin-allmight-swap'
//   3) resolver：把備戰位上的「海豚俠」實例的所有附加（能量/道具/damage/status/旗標）
//      整批轉移到「海豚俠ex」實例（保留 iid 還是換新 iid？）
//      - PTCG 規則：互換是「換卡片」不是「換實體」— 但既要「保留所附加效果」最簡單做法
//        是直接 swap cardId（同一個 inst.iid 沿用，cardId 改成『海豚俠ex』），這樣所有
//        attachments / damage / status 自動跟著 inst 一起留下，零搬運。
//      - 「這張卡（海豚俠）放回牌庫並重洗」：deck.push(海豚俠的 cardInst with cardId=海豚俠)
//        這部分需要新建一個「海豚俠 cardId」的乾淨 inst（清掉 attachments）。
// ════════════════════════════════════════════════════════════════════════════
regA('海豚俠', 0, (st, idx, pool, cardInst) => {
  // 觸發點為「retreat hook 詢問玩家 yes」之後再執行此函式 — 此時海豚俠已在備戰。
  const p = st.players[idx];
  const src = findOnBench(p, cardInst?.iid);
  if (!src) {
    return addLog(st, '全能變身：找不到海豚俠（必須在備戰區）', idx);
  }
  // 牌庫中是否有「海豚俠ex」？依 v2.321 隱藏資訊規則，仍可開搜尋讓玩家檢視牌庫
  // 即使無 ex 也可開（玩家可選「不選任何」結束）。
  const s = addLog(st,
    '全能變身：從牌庫選 1 張「海豚俠ex」與這張卡互換（保留全部附加），並重洗牌庫',
    idx);
  // v5.341：picker 只列牌庫裡的「海豚俠ex」（卡面明文只能選海豚俠ex）。用 validIids 收窄 deck-search。
  const exIids = p.deck.filter(d => pool.get(d.cardId)?.name === '海豚俠ex').map(d => d.iid);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'hugin-allmight-swap',
    params: { hostIid: src.iid, validIids: exIids },
  });
});

regR('hugin-allmight-swap', (st, idx, iids, params, pool) => {
  const hostIid = params?.hostIid as string | undefined;
  const p = st.players[idx];
  // 不論有無選擇都要重洗牌庫（卡面文義：搜過就要洗；這裡簡單一律洗）
  if (iids.length === 0 || !hostIid) {
    const s = addLog(st, '全能變身：未選擇「海豚俠ex」，重洗牌庫', idx);
    return updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const exInst = p.deck.find(c => c.iid === iids[0]);
  if (!exInst) {
    return updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const exCard = pool.get(exInst.cardId);
  // 限定「海豚俠ex」（卡面明文）
  if (exCard?.name !== '海豚俠ex') {
    const s = addLog(st, '全能變身：所選非「海豚俠ex」，跳過並重洗牌庫', idx);
    return updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  // 找備戰位上的海豚俠
  const benchIdx = p.bench.findIndex(c => c.iid === hostIid);
  if (benchIdx < 0) {
    return updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const oldInst = p.bench[benchIdx];

  // 互換：把備戰位上的 inst 的 cardId 換成「海豚俠ex」的 cardId（保留 iid + 全部附加）
  // 「這張卡放回牌庫」：以「海豚俠」原 cardId 建一個乾淨 inst（新 iid）放回牌庫
  const swappedInst: CardInstance = {
    ...oldInst,
    cardId: exInst.cardId,        // 換為海豚俠ex
    // 保留：energyAttached / toolAttached / damage / status / secondaryStatus
    //       / evolvedFromStack / evolvedFromIid / abilityUsedThisTurn /
    //       movedToActiveThisTurn 等所有 inst 屬性都不動。
    // 注意：abilityUsedThisTurn 旗標在「retreat hook prompt yes」後 engine 會 mark；
    //   這裡不重複 mark，靠 engine 的 ABILITY_EFFECTS dispatch 慣例處理。
    //   惟新 cardId 的「全能靈魂」特性是 passive 描述，不會被誤觸發（無 ABILITY_EFFECTS 註冊）。
  };
  // 新 cardId = 海豚俠（原本撤退下來的卡）→ 放回牌庫前先生成乾淨 inst
  // 取一個未使用的 iid：從 deck 末尾的最大 iid+1 不可靠，索性用 hash + cardId 串生成新 iid。
  // 沿用 engine 中現有 newIid 慣例：使用 `${cardId}_${Date.now()}_${Math.random()}` 簡化版。
  const cleanHuginInst: CardInstance = {
    iid: `huginA_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    cardId: oldInst.cardId,        // 原海豚俠 cardId
    energyAttached: [],
    damage: 0,
    status: undefined,
    secondaryStatus: undefined,
    tertiaryStatus: undefined,
    toolAttached: undefined,
    evolvedFromStack: undefined,
    evolvedFromIid: undefined,
    evolvedThisTurn: undefined,
    abilityUsedThisTurn: undefined,
    movedToActiveThisTurn: undefined,
    playedFromHand: false,
    justPlaced: false,
  };

  // 寫回 state：
  //   - bench[benchIdx] 換為 swappedInst（海豚俠ex）
  //   - deck 移除 exInst（已上場），加入 cleanHuginInst（海豚俠回牌庫），整體 shuffle
  const newBench = [...p.bench];
  newBench[benchIdx] = swappedInst;
  const newDeck = shuffle(
    p.deck.filter(c => c.iid !== exInst.iid).concat(cleanHuginInst)
  );
  const s = addLog(st,
    `全能變身：${pool.get(oldInst.cardId)?.name ?? '海豚俠'} 與牌庫的「海豚俠ex」互換（保留全部附加），並重洗牌庫`,
    idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    bench: newBench,
    deck: newDeck,
  }));
});

// ════════════════════════════════════════════════════════════════════════════
// 2. 鋼炮臂蝦｜返回重載（M1S）
//
// 卡面：「在自己的回合，這隻寶可夢從戰鬥場回到備戰區時，可使用 1 次。從自己的手牌
//   選擇最多 2 張『基本【水】能量』卡，附於這隻寶可夢身上。」
//
// 觸發：engine.ts RETREAT handler 末端 hook → modal prompt → 此 regA fn。
// 邏輯：
//   1) 從 cardInst 找到備戰位上的鋼炮臂蝦
//   2) 開 hand-choose 選最多 2 張基本【水】能量卡，effectKey='clamperl-bombard-attach'
//   3) resolver：把選中的能量從手牌移到 host inst 的 energyAttached
// ════════════════════════════════════════════════════════════════════════════
regA('鋼炮臂蝦', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const src = findOnBench(p, cardInst?.iid);
  if (!src) {
    return addLog(st, '返回重載：找不到鋼炮臂蝦（必須在備戰區）', idx);
  }
  // 找出手牌中的基本【水】能量
  const waterEnergies = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    return (card.name?.includes('【水】') ?? false);
  });
  if (waterEnergies.length === 0) {
    return addLog(st, '返回重載：手牌中沒有「基本【水】能量」可附加', idx);
  }
  const maxPick = Math.min(waterEnergies.length, 2);
  const s = addLog(st,
    `返回重載：從手牌選最多 ${maxPick} 張「基本【水】能量」附於這隻鋼炮臂蝦`,
    idx);
  return withPending(s, {
    type: 'hand-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: maxPick,
    effectKey: 'clamperl-bombard-attach',
    params: {
      hostIid: src.iid,
      validIids: waterEnergies.map(c => c.iid),
      label: '返回重載',
    },
  });
});

regR('clamperl-bombard-attach', (st, idx, iids, params, pool) => {
  const hostIid = params?.hostIid as string | undefined;
  if (!hostIid || iids.length === 0) {
    return addLog(st, '返回重載：未附加能量，效果結束', idx);
  }
  const p = st.players[idx];
  // 只選最多 2 張且必須是基本【水】能量
  const validInsts: CardInstance[] = [];
  for (const iid of iids.slice(0, 2)) {
    const inst = p.hand.find(c => c.iid === iid);
    if (!inst) continue;
    const card = pool.get(inst.cardId);
    if (!card) continue;
    if (card.supertype !== 'Energy' || card.subtype !== 'Basic') continue;
    if (!(card.name?.includes('【水】') ?? false)) continue;
    validInsts.push(inst);
  }
  if (validInsts.length === 0) {
    return addLog(st, '返回重載：所選非「基本【水】能量」，效果結束', idx);
  }
  // 找備戰上的 host
  const isActive = p.active?.iid === hostIid;
  const host = isActive ? p.active : p.bench.find(c => c.iid === hostIid);
  if (!host) {
    return addLog(st, '返回重載：找不到目標寶可夢', idx);
  }
  const hostName = pool.get(host.cardId)?.name ?? '?';
  const energyNames = validInsts.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const s = addLog(st,
    `返回重載：將 ${energyNames} 共 ${validInsts.length} 張附於 ${hostName}`,
    idx);
  const validSet = new Set(validInsts.map(e => e.iid));
  const _att = updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !validSet.has(c.iid)),
    active: isActive && pl.active
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...validInsts] }
      : pl.active,
    bench: pl.bench.map(c => c.iid === hostIid
      ? { ...c, energyAttached: [...c.energyAttached, ...validInsts] }
      : c),
  }));
  // v5.662：補對手附能反應(侵蝕詛咒/麻痺門牙)
  // v6.164：卡面「最多2張」→ per-energy-card
  return fireOnHandEnergyAttached(
    applyMagearnaHandAttachHeal(_att, idx, [hostIid], pool, validInsts.length),
    idx, hostIid, pool, validInsts.length);
});

// ════════════════════════════════════════════════════════════════════════════
// 詢問是否使用「從戰鬥場回備戰時」可發動 1 次的特性 — modal-choice prompt
//
// 仿 effects.ts askUsePlayAbility 模式。engine.ts RETREAT handler 末端呼叫此 helper。
// 玩家選「是」→ 走 resolve-retreat-to-bench-ability-prompt resolver → 執行 ABILITY_EFFECTS。
// ════════════════════════════════════════════════════════════════════════════

export function askUseRetreatToBenchAbility(
  state: GameState,
  idx: 0 | 1,
  inst: CardInstance,
  abilityName: string,
  abilityKey: string,
  cardName: string,
): GameState {
  return withPending(state, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'resolve-retreat-to-bench-ability-prompt',
    params: {
      label: `${cardName} 從戰鬥場回備戰：是否使用「${abilityName}」特性？`,
      options: [
        { id: 'yes', text: '✅ 使用特性' },
        { id: 'no', text: '❌ 不使用' },
      ],
      abilityKey,
      abilityName,        // v5.873：讓 resolver 走 getAbilityFn(by-name),涵蓋 regAByName 特性
      cardName,           // v5.873
      targetIid: inst.iid,
    },
  });
}

// resolve-retreat-to-bench-ability-prompt resolver — 玩家選 yes 後執行對應 ABILITY_EFFECTS
import { ABILITY_EFFECTS as _ABILITY_EFFECTS_FOR_RETREAT_HOOK, getAbilityFn as _getAbilityFnRetreat } from '../_shared';
regR('resolve-retreat-to-bench-ability-prompt', (state, actorIdx, selectedIids, params, pool) => {
  const choice = selectedIids[0] ?? 'no';
  if (choice !== 'yes') return state;
  const abilityKey = params?.abilityKey as string;
  const targetIid = params?.targetIid as string;
  if (!abilityKey || !targetIid) return state;

  // v5.873：改用中央 getAbilityFn(by-name 優先,fallback by-index),涵蓋 regAByName 的 on-retreat 特性。
  const abilityName = params?.abilityName as string | undefined;
  const cardName = (params?.cardName as string | undefined) ?? abilityKey.slice(0, abilityKey.lastIndexOf('|'));
  const abIdx = parseInt(abilityKey.slice(abilityKey.lastIndexOf('|') + 1), 10) || 0;
  const fn = _getAbilityFnRetreat(cardName, abilityName ?? '', abIdx) ?? _ABILITY_EFFECTS_FOR_RETREAT_HOOK.get(abilityKey);
  if (!fn) return state;

  const player = state.players[actorIdx];
  // 撤退後 inst 已在備戰；但若玩家選擇 yes 後該寶可夢被換場（理論上 modal 期間鎖住其他動作不會發生）
  // 仍 fallback 找 active 防 edge case。
  const inst = player.bench.find(c => c.iid === targetIid)
    ?? (player.active?.iid === targetIid ? player.active : undefined);
  if (!inst) return state;

  // 標記為「本回合特性已用」— 卡面「可使用 1 次」的限制
  // 沿用 engine USE_ABILITY 的標記方式：在 player.bench 上找對應 inst 並設 abilityUsedThisTurn
  const markedState = updatePlayer(state, actorIdx, pl => ({
    ...pl,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, abilityUsedThisTurn: true } : c),
    active: pl.active?.iid === targetIid
      ? { ...pl.active, abilityUsedThisTurn: true }
      : pl.active,
  }));

  return fn(markedState, actorIdx, pool, inst);
});

// v5.243：askUsePromoteActiveAbility + resolver 搬到 _shared.ts (leaf) 避免 circular import

// ════════════════════════════════════════════════════════════════════════════
// register pattern（Iron Rule 12）
//
// 本檔的 regA / regR 都安全（_shared.ts 是 leaf module，無 TDZ 風險）。
// 但 ON_RETREAT_TO_BENCH_ABILITIES Set 在 effects.ts 自身宣告（new Set），不需 .set() at top-level。
// 仍提供空的 register 函式以保持 wave 模板一致；effects.ts 在自己 body 末端呼叫即可。
// ════════════════════════════════════════════════════════════════════════════

let _v3050Registered = false;

export function registerV3050DeferredWaveA(): void {
  if (_v3050Registered) return; // idempotent
  _v3050Registered = true;
  // 本波無對 effects.ts 內 Map 的 .set() 需要做（regA / regR 走 _shared.ts）。
  // ON_RETREAT_TO_BENCH_ABILITIES 在 effects.ts 直接宣告。
}
