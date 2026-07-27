// ── CardInstance 暫時性旗標『單一來源分類表』（v5.531 大收斂）──────────────────
//   原本散落在 clearActiveEffects(_shared) / scrubBenchStatus(engine) 各自硬編的旗標清單
//   收斂到此一處。新增旗標時只改這裡，兩函式自動同步、不再漂移（v5.529 奔流之心漂移事故根治）。
//   見長期記憶 reference-clear-active-effects-central。
//
//   分類（語意；實際行為由兩個 export set 決定）：STATUS / LOCK(+LOCK2) / BUFF / RECEIVE / CROSSTURN / TRACK。
//   ⚠ BUFF(damageBonus*) 與 RECEIVE(immune* 等) 在【備戰】仍有意義 → 一律不可放進 BENCH_SCRUB_LOCK_FLAGS。
import type { CardInstance } from './types';

/**
 * 戰鬥場→備戰時 clearActiveEffects 一律清除的所有暫時性效果旗標（官方規則：退場移除所有
 * 特殊狀態與招式效果）。新增「招式/特性加在寶可夢身上的暫時旗標」必加進此清單對應分類。
 */
export const CLEAR_ON_EXIT_FLAGS: readonly (keyof CardInstance)[] = [
  // STATUS 特殊狀態
  'status', 'secondaryStatus', 'tertiaryStatus',
  'poisonDamagePerCheckup',
  'confusionSelfDamageCounters',  // v5.679 混亂自傷指示物覆蓋(錯亂閃光) — 離場/進化清除
  // LOCK 攻擊/撤退鎖(在 scrub 白名單)
  'cantAttackThisTurn', 'cantAttackPending', 'cantRetreatNextTurn',
  'attackFailureFlipCountPending', 'attackFailureFlipCountThisTurn', 'pointySpinNextTurn',
  'pointySpinThisTurn', 'cantRetreatPendingSelf', 'blockedAttackNamesNextTurn',
  'blockedAttackNamesThisTurn',
  // LOCK 其他鎖(退場清,不在 scrub)
  'cantAttachEnergyThisTurn', 'cantAttachEnergyNextTurn', 'paralyzeFangPending',
  'attackCostIncreaseColorlessNextTurn', 'attackCostIncreaseColorlessThisTurn', 'retreatCostIncreaseNextTurn',
  'retreatCostIncreaseThisTurn',
  // BUFF 加傷(備戰可持有,禁 scrub)
  'damageBonusThisTurn', 'damageBonusPending', 'deferredPrizeBonusThisTurn',
  'deferredPrizeBonusNextTurn',
  // RECEIVE 受傷類免疫/減傷/弱點(禁 scrub)
  'damageReduceNextHit', 'takeExtraDamageThisTurn', 'takeExtraDamageNextTurn',
  'immuneToAttackEffectsNextTurn', 'immuneToAttackEffectsThisTurn', 'immuneToExAttackTagNextTurn',
  'immuneToExAttackTagThisTurn', 'weaknessOverrideTypeNextTurn', 'weaknessOverrideTypeThisTurn',
  'weaknessDisabledNextTurn', 'weaknessDisabledThisTurn', 'immuneToBasicAttackNextTurn',
  'immuneToBasicAttackThisTurn', 'basicImmuneColorlessExcept', 'immuneToExAttackNextTurn',
  'immuneToExAttackThisTurn', 'immuneToAbilityPokemonNextTurn', 'immuneToAbilityPokemonThisTurn',
  'immuneToAllAttackNextTurn', 'immuneToAllAttackThisTurn', 'immuneToAttackDamageNextTurn',
  'immuneToAttackDamageThisTurn', 'immuneToEvolutionAttackNextTurn', 'immuneToEvolutionAttackThisTurn',
  'evolutionDamageReduceNextTurn', 'evolutionDamageReduceThisTurn', 'immuneToBurnedAttackerNextTurn',
  'immuneToBurnedAttackerThisTurn',
  // CROSSTURN 跨回合延遲效果
  'nextOwnAttackPenalty', 'retaliateCountersOnNextHit', 'koAtMyNextEndOfTurn',
  'damageAtMyNextEndOfTurn', 'strongKissDiscardPending', 'endTurnOnOppAttachEnergyNextTurn',
  'endTurnOnOppAttachEnergyThisTurn', 'abilityNullifiedNextTurn', 'abilityNullifiedThisTurn',
  // TRACK 移到戰鬥場標記
  'movedToActiveThisTurn',
];

/**
 * scrubBenchStatus 每個 action 後從【備戰】寶可夢強制清除的「攻擊/撤退鎖」（備戰不可能
 * 攻擊/撤退，這些鎖在備戰無意義；防某 resolver 漏走 clearActiveEffects 殘留）。
 * ⚠ 只能含 LOCK；嚴禁 BUFF/RECEIVE（備戰仍有意義）。不變式：⊆ CLEAR_ON_EXIT_FLAGS。
 */
export const BENCH_SCRUB_LOCK_FLAGS: readonly (keyof CardInstance)[] = [
  'cantAttackThisTurn', 'cantAttackPending', 'cantRetreatNextTurn',
  'cantRetreatPendingSelf', 'blockedAttackNamesNextTurn', 'blockedAttackNamesThisTurn',
  'attackFailureFlipCountPending', 'attackFailureFlipCountThisTurn', 'pointySpinNextTurn',
  'pointySpinThisTurn',
];

/**
 * v6.046 — 由**對手的招式**施加在「受到這個招式的寶可夢」身上的跨回合 debuff 旗標。
 *
 * 用途有二，共用同一份清單以免漂移：
 *   1. engine.ts ATTACK_POST 之後的免疫 sweep：防守 active 若對招式效果免疫
 *      （薄霧能量／化隱／純樸／皇帝之勢／抵抗之幕／化石…），把本次新加的這些旗標**還原**。
 *   2. anti-pattern-lint Check U：偵測新卡直接在對手 active 上寫這些旗標卻沒過免疫 gate。
 *
 * ⚠**判準是「這個旗標會不會被寫在對手身上」**，不是「它對誰有利」：
 *   - `cantAttackPending`／`blockedAttackNamesNextTurn`／`takeExtraDamageNextTurn` 三個是
 *     **兩用**的（反衝類招式寫在自己身上、封鎖類寫在對手身上）。仍要列入 —— sweep 只比對
 *     **防守方 active** 的攻擊前後差異，攻擊方寫在自己身上的那份不在比對範圍內。
 *   - `weaknessOverrideTypeNextTurn`（掌握弱點）對受招者未必不利，但它同樣是「對手招式施加
 *     的效果」，免疫卡面說的是「不受效果影響」而不是「不受不利效果影響」→ 一樣要擋。
 *
 * ⚠**不可列入**：自身增益／自身罰則（`cantRetreatPendingSelf`、各 `immuneTo*`、
 *   `weaknessDisabledNextTurn`、`damageBonus*`、`pointySpin*`…）。誤列會讓自己給自己上的
 *   效果在對手免疫時被錯誤還原。
 *
 * 新增欄位時若忘了歸類，`scripts/test-opp-debuff-immunity.mjs` 的枚舉守衛會 FAIL 並要求表態。
 */
export const OPP_ATTACK_DEBUFF_FLAGS: readonly (keyof CardInstance)[] = [
  // 行動封鎖
  'cantAttackPending', 'cantRetreatNextTurn', 'blockedAttackNamesNextTurn',
  'attackFailureFlipCountPending', 'cantAttachEnergyNextTurn',
  // 費用增加
  'attackCostIncreaseColorlessNextTurn', 'retreatCostIncreaseNextTurn',
  // 受傷／弱點／獎賞
  'takeExtraDamageNextTurn', 'weaknessOverrideTypeNextTurn', 'deferredPrizeBonusNextTurn',
  'nextOwnAttackPenalty',
  // 延遲結算（下個對手回合結束時才發生）
  'koAtMyNextEndOfTurn', 'damageAtMyNextEndOfTurn', 'strongKissDiscardPending',
  'paralyzeFangPending', 'endTurnOnOppAttachEnergyNextTurn',
  // 特性無效
  'abilityNullifiedNextTurn',
  // v6.047 狀態的「參數槽」：本體狀態由中央 applyStatus* 施加（已 gate），但改變狀態**強度**的
  //   附帶參數是另外寫的，同樣是對手招式加在受招者身上的跨回合資料 → 一併納入兜底。
  //   （電燈怪｜錯亂閃光把混亂自傷改為 8 個、劇毒牙類把中毒傷害改為每次 N 點。）
  'confusionSelfDamageCounters', 'poisonDamagePerCheckup',
];

// 子集不變式 runtime 守護（漂移即炸；anti-pattern-lint Check F 亦靜態把關）。
for (const k of BENCH_SCRUB_LOCK_FLAGS) {
  if (!CLEAR_ON_EXIT_FLAGS.includes(k)) throw new Error(`BENCH_SCRUB_LOCK_FLAGS 含非 CLEAR_ON_EXIT 旗標：${String(k)}`);
}
// v6.046：對手 debuff 旗標必然是「招式加在寶可夢身上的暫時效果」→ 退場一定要清，故必為子集。
for (const k of OPP_ATTACK_DEBUFF_FLAGS) {
  if (!CLEAR_ON_EXIT_FLAGS.includes(k)) throw new Error(`OPP_ATTACK_DEBUFF_FLAGS 含非 CLEAR_ON_EXIT 旗標：${String(k)}`);
}
