/**
 * v2.998 Group 2 — 18 張進化/手牌觸發特性實裝
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 2。本批次集中實裝「從手牌使出進化時 / 從手牌
 * 放置於備戰時 / 被招式 KO 時」這 3 大觸發點下、可作為 modal 自動 prompt 的特性。
 *
 * 觸發機制：
 *   - ON_EVOLVE_FROM_HAND_ABILITIES（effects.ts Set） — 進化後彈 modal 詢問是否使用
 *   - ON_PLAY_FROM_HAND_ABILITIES（effects.ts Set） — 從手牌放備戰後彈 modal 詢問
 *   - PASSIVE_ON_KO（effects.ts Map） — 被招式 KO 時自動觸發
 *
 * 本檔案實裝 14 張（A 12 張進化、B 1 張放備戰、C 1 張雙觸發）。剩 4 張需新引擎 hook
 * 已 deferred（海豚俠｜全能變身、鋼炮臂蝦｜返回重載、超能妙喵｜誘導之尾、火神蛾｜
 * 熱浪鱗粉），列在 audit 文件待後續波次。
 *
 * 揭示資訊（Iron Rule 8）：
 *   - 派帕的藏飽栗鼠 貪慾點餐：卡面「給對手看過後加入手牌」→ 公開 addLog 揭示卡名
 *   - 莉莉艾的蝶結萌虻 邀請眨眼：卡面「查看對手的手牌」+「放置於對手的備戰區」
 *     → 兩動作都公開 addLog（場上動作對手可見）
 *   - 雙尾怪手 使壞之尾：自己選對手手牌時不看正面（用隨機抽樣），抽完後揭示牌名
 *     給雙方（卡面寫「查看那些卡的正面後放回對手的牌庫並重洗」— 抽到的牌名公開）
 *   - 大蔥鴨 臨場背負：從牌庫搜尋寶可夢道具 → 既有 deck-search resolver 處理（公開）
 *   - 鬃岩狼人 尖刺纏身：棄牌區 → 場上是公開動作
 *   - 互換、放指示物、混亂、能量丟棄等都是公開動作 → addLog
 *
 * once-per-turn：所有「可使用 1 次」由既有 abilityUsedThisTurn 旗標保證
 * （effects.ts resolve-play-ability-prompt 在 prompt 觸發時並未 set；engine
 *  USE_ABILITY 才 set。但「進化/放置」觸發是「進化動作那 1 次」固有限制 — 同回合
 *  再進化也是新的個體 inst，不違反規則。沙漠蜻蜓的 KO 觸發為對手回合，亦不衝突。）
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import {
  regA, regAByName, regR,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  getOwnBenchLimit,
} from '../_shared';
import { flipCoinsWithLog, isBenchProtected, applyStatusToOppActive } from '../../effects';
import type { Card } from '$lib/cards/types';

// 導出 sentinel 防止 unused import warnings
export type _v2998Sentinel = PlayerState | GameState | Card | CardInstance;

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ══════════════════════════════════════════════════════════════════════════════

/** 找到觸發特性的源 CardInstance（cardInst 優先；fallback 用 name 找場上）。 */
function findTriggerSource(
  player: PlayerState,
  pool: Map<string, Card>,
  name: string,
  cardInst?: CardInstance,
): CardInstance | undefined {
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  if (cardInst) return all.find(c => c.iid === cardInst.iid);
  return all.find(c => pool.get(c.cardId)?.name === name);
}

/** 將對手戰鬥場 ↔ 指定備戰互換（給「與戰鬥寶可夢互換」類特性共用 resolver）。 */
function swapOppActiveWithBench(
  st: GameState,
  actorIdx: 0 | 1,
  benchIid: string,
  pool: Map<string, Card>,
  abilityLabel: string,
): GameState {
  const oppIdx = (1 - actorIdx) as 0 | 1;
  const oppPlayer = st.players[oppIdx];
  if (!oppPlayer.active) return st;
  const target = oppPlayer.bench.find(c => c.iid === benchIid);
  if (!target) return st;
  const newName = pool.get(target.cardId)?.name ?? '?';
  const oldName = pool.get(oppPlayer.active.cardId)?.name ?? '?';
  const s = addLog(st,
    `${abilityLabel}：對手 ${oldName} ↔ ${newName} 互換場上位置`,
    actorIdx);
  // 復用 supporters_gust 的 swap 邏輯（離場清狀態旗標）
  return updatePlayer(s, oppIdx, p => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === benchIid);
    if (bIdx < 0) return p;
    // clearActiveEffects on outgoing active
    const outgoing: CardInstance = {
      ...p.active,
      status: undefined,
      secondaryStatus: undefined,
      tertiaryStatus: undefined,
      poisonDamagePerCheckup: undefined,
      cantAttackThisTurn: undefined,
      cantAttackPending: undefined,
      cantRetreatNextTurn: undefined,
      attackFailureFlipCountPending: undefined,
      attackFailureFlipCountThisTurn: undefined,
      pointySpinNextTurn: undefined,
      pointySpinThisTurn: undefined,
      cantRetreatPendingSelf: undefined,
      damageReduceNextHit: undefined,
      damageBonusThisTurn: undefined,
      damageBonusPending: undefined,
      takeExtraDamageThisTurn: undefined,
      takeExtraDamageNextTurn: undefined,
      cantAttachEnergyThisTurn: undefined,
      cantAttachEnergyNextTurn: undefined,
      deferredPrizeBonusThisTurn: undefined,
      deferredPrizeBonusNextTurn: undefined,
      movedToActiveThisTurn: undefined,
    };
    const newBench = [...p.bench];
    newBench[bIdx] = outgoing;
    return {
      ...p,
      active: { ...p.bench[bIdx], justPlaced: false, playedFromHand: false },
      bench: newBench,
    };
  });
}

// 共用 resolver — 「選 1 隻對手備戰寶可夢，與對手戰鬥場互換」
regR('v2998-swap-opp-active-bench', (st, idx, iids, params, pool) => {
  if (iids.length === 0) return st;
  const label = (params?.label as string) ?? '互換';
  return swapOppActiveWithBench(st, idx, iids[0], pool, label);
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. 安瓢蟲｜繁星花紋（MC / SV7）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。選擇 1 隻對手
//   備戰區剩餘 HP 為『90』以下的寶可夢，與戰鬥寶可夢互換。」
// gate：對手備戰存在 + 對手戰鬥位存在 + 候選（剩 HP ≤ 90）非空
// ══════════════════════════════════════════════════════════════════════════════
regA('安瓢蟲', 0, (st, idx, pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (!opp.active) return addLog(st, '繁星花紋：對手戰鬥場無寶可夢', idx);
  if (opp.bench.length === 0) return addLog(st, '繁星花紋：對手備戰區為空', idx);
  // 候選：剩 HP ≤ 90 的對手備戰寶可夢
  const validIids = opp.bench.filter(b => {
    const card = pool.get(b.cardId);
    if (!card?.hp) return false;
    return (card.hp - b.damage) <= 90;
  }).map(b => b.iid);
  if (validIids.length === 0) {
    return addLog(st, '繁星花紋：對手備戰沒有剩餘 HP ≤ 90 的寶可夢', idx);
  }
  const s = addLog(st, '繁星花紋：選 1 隻對手剩餘 HP ≤ 90 的備戰寶可夢與戰鬥場互換', idx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v2998-swap-opp-active-bench',
    params: { validIids, label: '繁星花紋' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 雙尾怪手｜使壞之尾（SV6）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。擲 2 次硬幣，
//   在不看手牌正面的情況下，從對手的手牌選擇與正面出現的次數相同數量的卡，查看
//   那些卡的正面後放回對手的牌庫並重洗。」
//
// 實作：擲 2 幣 → 隨機抽 N 張對手手牌（=「不看正面」的等效實作；UI 不支援
//   「玩家挑背面」picker，用 random 等價）；抽到後對自己 addPrivateLog 揭示，
//   公開 log 公布卡名（卡面寫「查看那些卡的正面」— 自己看得到，因為己方主動
//   執行的搬動，公開揭示亦合理）。
// ══════════════════════════════════════════════════════════════════════════════
regA('雙尾怪手', 0, (st, idx, pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const r = flipCoinsWithLog(st, 2, '使壞之尾', idx);
  let s = r.state;
  const heads = r.heads;
  if (heads === 0) {
    return addLog(s, '使壞之尾：0 次正面 → 不抽對手手牌', idx);
  }
  const opp = s.players[oppIdx];
  const pickCount = Math.min(heads, opp.hand.length);
  if (pickCount === 0) {
    return addLog(s, '使壞之尾：對手手牌為空，無法執行', idx);
  }
  // 隨機抽 pickCount 張對手手牌（等同「不看正面挑」）
  let oppHand = [...opp.hand];
  const picked: CardInstance[] = [];
  for (let i = 0; i < pickCount; i++) {
    const ridx = Math.floor(Math.random() * oppHand.length);
    picked.push(oppHand[ridx]);
    oppHand = oppHand.filter((_, j) => j !== ridx);
  }
  const pickedNames = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  s = addLog(s, `使壞之尾：${heads} 次正面 → 隨機抽對手手牌 ${pickCount} 張：${pickedNames}（揭示後放回對手牌庫並重洗）`, idx);
  // 把選中卡放回對手牌庫並重洗
  return updatePlayer(s, oppIdx, p => ({
    ...p,
    hand: oppHand,
    deck: shuffle([...p.deck, ...picked]),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 風妖精｜柔柔治癒（SV5K / SV8a）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。將自己的戰鬥
//   場的【草】寶可夢的 HP 全部恢復。然後，將恢復的寶可夢身上附加的能量全部丟棄。」
// gate：自方戰鬥場是【草】寶可夢
// ══════════════════════════════════════════════════════════════════════════════
regA('風妖精', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '柔柔治癒：戰鬥場無寶可夢', idx);
  const card = pool.get(p.active.cardId);
  if (card?.pokemonType !== 'Grass') {
    return addLog(st, `柔柔治癒：戰鬥場 ${card?.name ?? '?'} 不是【草】寶可夢`, idx);
  }
  const healed = p.active.damage;
  const energyCount = p.active.energyAttached.length;
  let s = addLog(st,
    `柔柔治癒：${card.name} 全恢復 ${healed} HP + 棄 ${energyCount} 個能量`,
    idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, damage: 0, energyAttached: [] }
      : pl.active,
    discard: [...pl.discard, ...(pl.active?.energyAttached ?? [])],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 麻花犬ex｜飽腹時間（MC / SV7）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。將自己的所有
//   進化寶可夢的 HP 全部恢復。然後，將恢復的寶可夢身上附加的能量全部丟棄。」
// gate：自方場上至少 1 隻進化寶可夢（active or bench）
// ══════════════════════════════════════════════════════════════════════════════
regA('麻花犬ex', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  // 進化判定：subtype === 'Stage1' / 'Stage2' 或 stage 同
  const isEvolved = (inst: CardInstance) => {
    const c = pool.get(inst.cardId);
    if (!c) return false;
    const stage = c.stage ?? c.subtype;
    return stage === 'Stage1' || stage === 'Stage2';
  };
  const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  const evolved = all.filter(isEvolved);
  if (evolved.length === 0) return addLog(st, '飽腹時間：場上沒有進化寶可夢', idx);

  // 累計棄能量
  const allDiscarded: CardInstance[] = [];
  let s = st;
  let totalHealed = 0;
  for (const inst of evolved) {
    totalHealed += inst.damage;
    allDiscarded.push(...inst.energyAttached);
  }
  s = addLog(s,
    `飽腹時間：${evolved.length} 隻進化寶可夢全恢復共 ${totalHealed} HP + 棄共 ${allDiscarded.length} 個能量`,
    idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    active: pl.active && isEvolved(pl.active)
      ? { ...pl.active, damage: 0, energyAttached: [] }
      : pl.active,
    bench: pl.bench.map(c => isEvolved(c)
      ? { ...c, damage: 0, energyAttached: [] }
      : c),
    discard: [...pl.discard, ...allDiscarded],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 巧鍛匠｜臨場之錘（M1L / MC）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。擲 1 次硬幣
//   若為正面，則選擇 1 個對手的戰鬥寶可夢身上附加的能量，將其丟棄。」
// gate：對手戰鬥位有能量
// ══════════════════════════════════════════════════════════════════════════════
regA('巧鍛匠', 0, (st, idx, _pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (!opp.active) return addLog(st, '臨場之錘：對手戰鬥場無寶可夢', idx);
  if (opp.active.energyAttached.length === 0) {
    return addLog(st, '臨場之錘：對手戰鬥位沒有能量', idx);
  }
  const r = flipCoinsWithLog(st, 1, '臨場之錘', idx);
  if (r.heads === 0) return addLog(r.state, '臨場之錘：反面，效果無效', idx);
  const s = addLog(r.state, '臨場之錘：正面 → 選 1 個對手戰鬥位的能量丟棄', idx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'farfetchd-tcl-hammer-discard',
    params: { titleOverride: '選擇要丟棄的對手戰鬥位能量' },
  });
});
regR('farfetchd-tcl-hammer-discard', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (!opp.active) return st;
  const energyInst = opp.active.energyAttached.find(e => e.iid === targetIid);
  if (!energyInst) return st;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const s = addLog(st, `臨場之錘：丟棄對手戰鬥位的 ${eName}`, idx);
  return updatePlayer(s, oppIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== targetIid) }
      : pl.active,
    discard: [...pl.discard, energyInst],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 怖納噬草｜恐慌牢籠（M2）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。將對手的戰鬥
//   寶可夢【混亂】。」
// gate：對手戰鬥場存在
// 注意：免疫檢查（憨憨臉、薄霧能量、皇帝之勢、對戰圓形競技場、祭典會場…）由
//   特性自身負責 — 此處沿用 statusPost 的免疫策略（簡化版）。卡面是「特性效果」
//   而非「招式效果」，不走完整 attack-effect-shield；一律施加，僅檢查憨憨臉。
// ══════════════════════════════════════════════════════════════════════════════
regAByName('怖納噬草', '恐慌牢籠', (st, idx, pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (!opp.active) return addLog(st, '恐慌牢籠：對手戰鬥場無寶可夢', idx);
  // v5.444：改走中央 applyStatusToOppActive（ability-effect）。
  //   原本註解「特性不走完整 attack-effect-shield，僅檢查憨憨臉」是錯的 —【化隱】
  //   卡面明寫免疫「對手的招式或特性的效果」，特性造成的混亂也應被化隱免疫。
  //   中央函式一次涵蓋 化隱 / 憨憨臉 / 泡沫能量 / 祭典會場。
  return applyStatusToOppActive(st, idx, 'confused', pool, { kind: 'ability-effect', label: '恐慌牢籠' });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 派帕的藏飽栗鼠｜貪慾點餐（SV9a）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。從自己的棄牌
//   區選擇最多 2 張『派帕的三明治』，在給對手看過後加入手牌。」
// gate：棄牌區至少有 1 張「派帕的三明治」
// 揭示資訊：卡面「給對手看過」→ 加手牌時公開揭示卡名
// ══════════════════════════════════════════════════════════════════════════════
regA('派帕的藏飽栗鼠', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  const validIids = p.discard
    .filter(c => pool.get(c.cardId)?.name === '派帕的三明治')
    .map(c => c.iid);
  if (validIids.length === 0) {
    return addLog(st, '貪慾點餐：棄牌區沒有「派帕的三明治」', idx);
  }
  const s = addLog(st,
    `貪慾點餐：從棄牌區選最多 2 張「派帕的三明治」加手牌（候選 ${validIids.length} 張）`,
    idx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Item', minCount: 0, maxCount: Math.min(2, validIids.length),
    effectKey: 'piper-greedy-pick-sandwich',
    params: { validIids, label: '貪慾點餐' },
  });
});
regR('piper-greedy-pick-sandwich', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(st, '貪慾點餐：未選擇，效果結束', idx);
  }
  // 揭示卡名（公開 log）
  const p = st.players[idx];
  const picked = p.discard.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(st, `貪慾點餐：揭示給對手 → ${names}（共 ${picked.length} 張）加入手牌`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !iids.includes(c.iid)),
    hand: [...pl.hand, ...picked],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 火箭隊的叉字蝠ex｜亂咬（M2a / MC / SV10）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。在對手的 2 隻
//   寶可夢身上各放置 2 個傷害指示物。」
// gate：對手場上至少 1 隻寶可夢
// 實作：開 opp-poke-choose，min/max=2（不可選同隻）。若對手場上 < 2 → 退而求其次
//   只放對 1 隻（min/max=1）。
// ══════════════════════════════════════════════════════════════════════════════
regA('火箭隊的叉字蝠ex', 0, (st, idx, _pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  const allOppCount = (opp.active ? 1 : 0) + opp.bench.length;
  if (allOppCount === 0) return addLog(st, '亂咬：對手場上沒有寶可夢', idx);
  const targetCount = Math.min(2, allOppCount);
  const s = addLog(st,
    `亂咬：選 ${targetCount} 隻對手寶可夢，各放 2 個傷害指示物`,
    idx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: targetCount, maxCount: targetCount,
    effectKey: 'rocket-crobat-mass-bite',
    params: { includeActive: true, counters: 2, label: '亂咬' },
  });
});
regR('rocket-crobat-mass-bite', (st, idx, iids, params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const counters = (params?.counters as number) ?? 2;
  const label = (params?.label as string) ?? '亂咬';
  const dmg = counters * 10;
  let s = st;
  for (const targetIid of iids) {
    const opp = s.players[oppIdx];
    const isActive = opp.active?.iid === targetIid;
    const target = isActive ? opp.active! : opp.bench.find(c => c.iid === targetIid);
    if (!target) continue;
    const tCard = pool.get(target.cardId);
    const tName = tCard?.name ?? '?';
    // v4.51 Phase 2：改用統一 canApplyEffectToTarget（kind='ability-effect'）— 涵蓋光之翼 + 對戰圓形
    const _biteGuard = canApplyEffectToTarget(s, idx, target, tCard, 'ability-effect', pool, { isBench: !isActive });
    if (_biteGuard.blocked) {
      s = addLog(s, `${label}：${tName} ${_biteGuard.reason}`, idx);
      continue;
    }
    s = updatePlayer(s, oppIdx, pl => ({
      ...pl,
      active: isActive && pl.active
        ? { ...pl.active, damage: pl.active.damage + dmg }
        : pl.active,
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, damage: c.damage + dmg }
        : c),
    }));
    s = addLog(s, `${label}：${tName} +${counters} 個傷害指示物（+${dmg}）`, idx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 火箭隊的大嘴蝠｜暗中咬住（M2a / MC / SV10）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。在對手的 1 隻
//   寶可夢身上放置 2 個傷害指示物。」
// gate：對手場上至少 1 隻寶可夢
// 實作：復用 rocket-crobat-mass-bite resolver（同 counter 機制；min=max=1）
// ══════════════════════════════════════════════════════════════════════════════
regA('火箭隊的大嘴蝠', 0, (st, idx, _pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  const allOppCount = (opp.active ? 1 : 0) + opp.bench.length;
  if (allOppCount === 0) return addLog(st, '暗中咬住：對手場上沒有寶可夢', idx);
  const s = addLog(st, '暗中咬住：選 1 隻對手寶可夢放 2 個傷害指示物', idx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'rocket-crobat-mass-bite',
    params: { includeActive: true, counters: 2, label: '暗中咬住' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 莉莉艾的蝶結萌虻｜邀請眨眼（MC / SV9）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。查看對手的手牌，
//   從其中選擇任意數量的【基礎】寶可夢卡，放置於對手的備戰區。」
// gate：對手手牌不為空 + 對手備戰未滿
// 揭示資訊：卡面「查看對手的手牌」+「放置於對手的備戰區」 → 雙方公開動作。
//   揭示對手手牌 → 公開 addLog；放置動作 → 公開 addLog 揭示卡名。
// ══════════════════════════════════════════════════════════════════════════════
regA('莉莉艾的蝶結萌虻', 0, (st, idx, pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  // v3.80：對手 bench 上限同樣考慮零之大空洞（oppIdx 視角）
  if (opp.bench.length >= getOwnBenchLimit(st, oppIdx, pool)) return addLog(st, '邀請眨眼：對手備戰區已滿', idx);
  if (opp.hand.length === 0) return addLog(st, '邀請眨眼：對手手牌為空', idx);
  // 揭示對手手牌（公開）
  const handNames = opp.hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(st, `邀請眨眼：查看對手手牌（${opp.hand.length} 張）— ${handNames}`, idx);
  // 候選：【基礎】寶可夢
  const candidates = opp.hand.filter(c => {
    const cc = pool.get(c.cardId);
    if (!cc) return false;
    if (cc.supertype !== 'Pokemon') return false;
    return cc.subtype === 'Basic' || cc.stage === 'Basic';
  });
  if (candidates.length === 0) {
    return addLog(s, '邀請眨眼：對手手牌沒有【基礎】寶可夢，效果結束', idx);
  }
  // 對手備戰剩餘空位 — v5.041 → v5.043：bench limit 改 getBenchLimit (5→8)
  // oppIdx 在本 function 上面已宣告（line 477）不再重複宣告
  const slotsLeft = getOwnBenchLimit(s, oppIdx, pool) - opp.bench.length;
  const maxPick = Math.min(candidates.length, slotsLeft);
  s = addLog(s,
    `邀請眨眼：選最多 ${maxPick} 張【基礎】寶可夢放對手備戰區（候選 ${candidates.length} 張）`,
    idx);
  // 用 hand-choose（actor=自己, sourcePlayer=對手）
  return withPending(s, {
    type: 'hand-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 0, maxCount: maxPick,
    effectKey: 'lillie-ribombee-invite-place',
    params: { validIids: candidates.map(c => c.iid), label: '邀請眨眼' },
  });
});
regR('lillie-ribombee-invite-place', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(st, '邀請眨眼：未選擇任何卡，效果結束', idx);
  }
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const slotsLeft = getOwnBenchLimit(st, oppIdx, pool) - opp.bench.length;
  const actualIids = iids.slice(0, slotsLeft);
  const placedInsts: CardInstance[] = [];
  const placedNames: string[] = [];
  for (const iid of actualIids) {
    const inst = opp.hand.find(c => c.iid === iid);
    if (!inst) continue;
    const card = pool.get(inst.cardId);
    if (!card) continue;
    const isBasic = card.subtype === 'Basic' || card.stage === 'Basic';
    if (card.supertype !== 'Pokemon' || !isBasic) continue;
    const benchInst: CardInstance = {
      ...inst,
      damage: 0,
      energyAttached: [],
      toolAttached: undefined,
      status: undefined,
      secondaryStatus: undefined,
      tertiaryStatus: undefined,
      evolvedFromStack: undefined,
      evolvedFromIid: undefined,
      evolvedThisTurn: undefined,
      abilityUsedThisTurn: undefined,
      justPlaced: true,
      playedFromHand: false,
    };
    placedInsts.push(benchInst);
    placedNames.push(card.name);
  }
  if (placedInsts.length === 0) {
    return addLog(st, '邀請眨眼：所選不符條件', idx);
  }
  const s = addLog(st,
    `邀請眨眼：將對手的 ${placedNames.join('、')} 共 ${placedInsts.length} 張放置於對手備戰區`,
    idx);
  const placedSet = new Set(placedInsts.map(c => c.iid));
  return updatePlayer(s, oppIdx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !placedSet.has(c.iid)),
    bench: [...pl.bench, ...placedInsts],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 赫普的毛毛角羊｜挑戰角擊（M2a / SV9）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。選擇 1 隻對手
//   的備戰寶可夢，與戰鬥寶可夢互換。」
// gate：對手戰鬥場存在 + 對手備戰至少 1 隻
// 實作：復用 v2998-swap-opp-active-bench resolver
// ══════════════════════════════════════════════════════════════════════════════
regA('赫普的毛毛角羊', 0, (st, idx, _pool, _cardInst) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (!opp.active) return addLog(st, '挑戰角擊：對手戰鬥場無寶可夢', idx);
  if (opp.bench.length === 0) return addLog(st, '挑戰角擊：對手備戰區為空', idx);
  const s = addLog(st, '挑戰角擊：選 1 隻對手備戰寶可夢與戰鬥場互換', idx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v2998-swap-opp-active-bench',
    params: { label: '挑戰角擊' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 鬃岩狼人｜尖刺纏身（SV9）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。從自己的棄牌
//   區選擇最多 2 張『扣殺能量』，附於這隻寶可夢身上。」
// gate：棄牌區至少有 1 張「扣殺能量」
// ══════════════════════════════════════════════════════════════════════════════
regA('鬃岩狼人', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const src = findTriggerSource(p, pool, '鬃岩狼人', cardInst);
  if (!src) return addLog(st, '尖刺纏身：找不到鬃岩狼人', idx);
  const validIids = p.discard
    .filter(c => pool.get(c.cardId)?.name === '扣殺能量')
    .map(c => c.iid);
  if (validIids.length === 0) {
    return addLog(st, '尖刺纏身：棄牌區沒有「扣殺能量」', idx);
  }
  const s = addLog(st,
    `尖刺纏身：從棄牌區選最多 2 張「扣殺能量」附於這隻鬃岩狼人（候選 ${validIids.length} 張）`,
    idx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy', minCount: 0, maxCount: Math.min(2, validIids.length),
    effectKey: 'lycanroc-spike-bind-attach',
    params: { validIids, hostIid: src.iid, label: '尖刺纏身' },
  });
});
regR('lycanroc-spike-bind-attach', (st, idx, iids, params, pool) => {
  if (iids.length === 0) {
    return addLog(st, '尖刺纏身：未選擇能量，效果結束', idx);
  }
  const hostIid = params?.hostIid as string | undefined;
  if (!hostIid) return st;
  const p = st.players[idx];
  const energies = p.discard.filter(c => iids.includes(c.iid));
  if (energies.length === 0) return st;
  const isActive = p.active?.iid === hostIid;
  const host = isActive ? p.active : p.bench.find(c => c.iid === hostIid);
  if (!host) return addLog(st, '尖刺纏身：找不到附加目標', idx);
  const tName = pool.get(host.cardId)?.name ?? '?';
  const s = addLog(st,
    `尖刺纏身：將 ${energies.length} 張「扣殺能量」附給 ${tName}`,
    idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !iids.includes(c.iid)),
    active: isActive && pl.active
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] }
      : pl.active,
    bench: pl.bench.map(c => c.iid === hostIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. 大蔥鴨｜臨場背負（SV6）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌將這張卡放置於備戰區時，可使用 1 次。從自己的牌庫
//   選擇 1 張『寶可夢道具』卡，附於這隻寶可夢身上。並且重洗牌庫。」
// gate：（牌庫搜尋類，依 v2.321 隱藏資訊規則不檢查牌庫內容）
// ══════════════════════════════════════════════════════════════════════════════
regA('大蔥鴨', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const src = findTriggerSource(p, pool, '大蔥鴨', cardInst);
  if (!src) return addLog(st, '臨場背負：找不到大蔥鴨', idx);
  // 已有道具 → 不能再附（PTCG 規則：1 隻寶可夢只能附 1 張道具）
  if (src.toolAttached) {
    return addLog(st, '臨場背負：這隻寶可夢已附有道具，無法再附', idx);
  }
  const s = addLog(st,
    '臨場背負：從牌庫選 1 張「寶可夢道具」附於這隻大蔥鴨身上（並重洗）',
    idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Tool', minCount: 0, maxCount: 1,
    effectKey: 'farfetchd-on-spot-tool-attach',
    params: { hostIid: src.iid },
  });
});
regR('farfetchd-on-spot-tool-attach', (st, idx, iids, params, pool) => {
  const hostIid = params?.hostIid as string | undefined;
  // 不論有無選擇都要重洗牌庫
  const p = st.players[idx];
  if (iids.length === 0 || !hostIid) {
    const s = addLog(st, '臨場背負：未附加道具，重洗牌庫', idx);
    return updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const toolInst = p.deck.find(c => c.iid === iids[0]);
  if (!toolInst) {
    return updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const toolCard = pool.get(toolInst.cardId);
  // 卡面限定「寶可夢道具」(subtype === 'Tool')
  if (toolCard?.subtype !== 'Tool') {
    const s = addLog(st, '臨場背負：所選非寶可夢道具，跳過並重洗', idx);
    return updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const isActive = p.active?.iid === hostIid;
  const host = isActive ? p.active : p.bench.find(c => c.iid === hostIid);
  if (!host) {
    return updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  if (host.toolAttached) {
    const s = addLog(st, '臨場背負：目標已附有道具，跳過並重洗', idx);
    return updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const tName = pool.get(host.cardId)?.name ?? '?';
  const s = addLog(st, `臨場背負：將「${toolCard.name}」附給 ${tName}（並重洗牌庫）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => c.iid !== toolInst.iid)),
    active: isActive && pl.active
      ? { ...pl.active, toolAttached: toolInst }
      : pl.active,
    bench: pl.bench.map(c => c.iid === hostIid
      ? { ...c, toolAttached: toolInst }
      : c),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 沙漠蜻蜓｜沙之羽擊（M-P-I / M2）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，與這隻寶可夢在戰鬥場上
//   受到對手的招式的傷害而【昏厥】時，各可使用 1 次。將對手的牌庫上方 2 張卡丟棄。」
//
// 雙觸發：
//   1) 進化時 — regA + ON_EVOLVE_FROM_HAND_ABILITIES（modal prompt）
//   2) 被招式 KO 時 — PASSIVE_ON_KO（自動觸發，effects.ts hook）
// 兩個觸發點各算 1 次，不互相消耗（觸發點不同，engine 不會合併）。
// ══════════════════════════════════════════════════════════════════════════════
function desertDragonflyMill2(st: GameState, actorIdx: 0 | 1): GameState {
  const oppIdx = (1 - actorIdx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (opp.deck.length === 0) {
    return addLog(st, '沙之羽擊：對手牌庫為空', actorIdx);
  }
  const taken = opp.deck.slice(0, 2);
  const s = addLog(st,
    `沙之羽擊：將對手牌庫上方 ${taken.length} 張卡丟棄`,
    actorIdx);
  return updatePlayer(s, oppIdx, p => ({
    ...p,
    deck: p.deck.slice(taken.length),
    discard: [...p.discard, ...taken],
  }));
}

// 進化端（modal prompt 走的 ABILITY_EFFECTS）
regA('沙漠蜻蜓', 0, (st, idx, _pool, _cardInst) => {
  return desertDragonflyMill2(st, idx);
});

// KO 端的 helper export — effects.ts 端會把它寫到 PASSIVE_ON_KO Map
// （直接 set 也可，但 ESM 模組順序問題下放在 effects.ts statics 區更穩）
export function desertDragonflyOnKo(
  state: GameState,
  dIdx: 0 | 1,
  _aIdx: 0 | 1,
  _pool: Map<string, Card>,
  _defenderCard: Card,
): GameState {
  // dIdx 是擁有沙漠蜻蜓（被 KO 方），對「對手」(=aIdx) 的牌庫做 mill 2。
  // desertDragonflyMill2 視 actorIdx 為發動方 → mill 對手牌庫；此處 actorIdx = dIdx。
  return desertDragonflyMill2(state, dIdx);
}

// 為避免 unused warning，把 helper 留在模組頂層（addPrivateLog 暫未用，但 import
// 留著以便後續 deferred 卡批次需要）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _kept = addPrivateLog;
