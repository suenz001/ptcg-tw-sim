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

// 子集不變式 runtime 守護（漂移即炸；anti-pattern-lint Check F 亦靜態把關）。
for (const k of BENCH_SCRUB_LOCK_FLAGS) {
  if (!CLEAR_ON_EXIT_FLAGS.includes(k)) throw new Error(`BENCH_SCRUB_LOCK_FLAGS 含非 CLEAR_ON_EXIT 旗標：${String(k)}`);
}
