/**
 * 訓練家效果登錄表
 *
 * TRAINER_EFFECTS: cardName → 效果函式（即時效果或回傳 pendingSelection）
 * RESOLVERS:       effectKey → 玩家選擇後的繼續函式
 *
 * M2 實裝：常見非互動支援者 + 常見物品（切換/球/藥水）
 * M3/M4 逐步填入更多效果
 */

import type { Card, EnergyType } from '$lib/cards/types';
import type { GameState, PlayerState, CardInstance, PendingSelection, GameAction, SpecialCondition } from './types';
import { RULE_BOX_SUBTYPES } from './types';  // v3.67 本地 isRulePokemon mirror 需要

// ── 基礎設施 → 從 effects/_shared.ts 匯入 ──────────────────────────────────
//
// v2.05 起，effects 模組的型別 / 登錄表 / 登錄函式 / 共用 helper 集中在
// ./effects/_shared.ts。所有 effects/cards/*.ts 子檔也從同一個地方 import，
// 確保 reg() / regR() / regG() 寫入的是同一份 Map 實例。
// effects.ts 仍保留所有尚未被搬遷的卡牌 reg 呼叫。

import type { EffectFn, ResolveFn, TrainerGuardFn, AttackPreFn, AttackPostFn, PreDiscardSpec } from './effects/_shared';
import { placedBenchInstance } from './effects/_shared'; // v5.745 放場裸化+justPlaced中央
import { startEnergyChain } from './effects/cards/v158_energy_chain';
import { copyAttackPostDispatch } from './effects/_shared';
import { openDeckViewReshuffle, setBloomEffectiveFn, abilityUsedAfterSwap } from './effects/_shared';
import {
  // Maps
  TRAINER_EFFECTS, RESOLVERS, TRAINER_GUARDS,
  ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, ATTACK_PRE_DISCARD_CHOICE,
  BENCH_PLACE_TRIGGERS,
  SPECIAL_ENERGY_ATTACH,
  SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD,
  SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED,
  OPP_ENERGY_ATTACH_PASSIVE,
  fireOnHandEnergyAttached,
  // Register functions
  reg, regR, regG,
  regPre, regPost, regA,
  // Public
  canPlayTrainer,
  // Helpers
  shuffle, updatePlayer, addLog, addPrivateLog,
  drawCards, discardHand, returnHandToDeck,
  withPending,
  clearActiveEffects,
  discardActiveStadium,
  recordOppKO,
  healResolver,
  sameEvoName, getAllAttachedTools, toBareCard,
  applyBenchPlaceSideEffects,
  getEnergyDiscardUnits,
  countAttachedEnergyAsUnits,
  triggerOakeyeMillIfApplicable,
  getOwnBenchLimit, joinCardNames,} from './effects/_shared';

// re-export helper 給 engine.ts / 其他 resolver 用
export { applyBenchPlaceSideEffects };

// 為 engine.ts / +page.svelte 的 import 路徑維持相容：re-export
export { TRAINER_EFFECTS, RESOLVERS, TRAINER_GUARDS, canPlayTrainer, clearActiveEffects };
export { ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, ATTACK_PRE_DISCARD_CHOICE, getEnergyDiscardUnits, countAttachedEnergyAsUnits };
// v2.133 PASSIVE_PREVENT_KO 在本檔下方定義，匯出供 engine 使用
// （直接在此先 forward-ref：宣告處放到 v2.133 區塊，之後會由 engine import）
export { BENCH_PLACE_TRIGGERS };
export { SPECIAL_ENERGY_ATTACH, SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD, SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED, OPP_ENERGY_ATTACH_PASSIVE , fireOnHandEnergyAttached };
export type { ResolveFn, TrainerGuardFn, AttackPreFn, AttackPostFn, PreDiscardSpec };

// ── 道具（Pokemon Tool）模組 — v2.09 從本檔抽離 ────────────────────────────
// tools.ts 包含 TOOL_* 所有登錄表、每張道具 entry、toolAttachEffect +
// attach-tool resolver、自動登記區塊。這裡 import {...} 同時：
//   (a) 觸發 tools.ts 的 side-effect（所有 reg / TOOL_*.set）
//   (b) 把 TOOL_* 拉進本檔 scope，供下方 effectiveHPInline 等區域 helper 使用
//   (c) 透過 export { ... } 轉發給 engine.ts（engine 從 './effects' import TOOL_*）
import {
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_ATTACH_GATE, TOOL_END_TURN_DISCARD,
} from './effects/cards/tools';
export {
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_ATTACH_GATE, TOOL_END_TURN_DISCARD,
};

// ── 競技場卡（Stadium）模組 — v2.10 從本檔抽離 ─────────────────────────────
// stadiums.ts 包含 3 個 USE_STADIUM 的 pending resolver（神秘花園、夜間學院、
// 月光丘陵）以及 JAMMING_TOWER_STADIUMS / ROCKET_WATCHTOWER_STADIUMS 兩個
// 引擎側 hook 集合（道具無效 / 【無】寶可夢特性無效）。
import { JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS, BENCH_PROTECTION_STADIUMS, PASSIVE_STADIUMS } from './effects/cards/stadiums';
// v5.293: import field-wide damage-reduce helpers for bench damage path
import { steelixPalaceReduce, bronzongShelterReduce, gearCoatingReduce, hasIronTracksDualCore, curlWallReduce } from './effects/cards/v2999_g3_wave1';
export { JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS, BENCH_PROTECTION_STADIUMS, PASSIVE_STADIUMS };

/**
 * v2.22：對戰圓形競技場（Stadium）— 備戰保護判定
 * 當場上活動場地卡為 BENCH_PROTECTION_STADIUMS（對戰圓形競技場）時，
 * 雙方所有備戰寶可夢不會因對手的招式/特性效果被放置傷害指示物。
 * 所有 snipe-*、cursed-bomb、bench-hit-N、damage-distribute、全體指示物 resolver
 * 在處理備戰目標前先呼叫這個 helper；true → 跳過放置並記 log。
 */
/**
 * v3.67 本地 isRulePokemon mirror — effects.ts 不能 import engine.ts（circular），
 *   但兩處讀同一個 source of truth（types.ts 的 RULE_BOX_SUBTYPES set），
 *   所以行為跟 engine.ts 的 isRulePokemon 等價。
 *   新規則寶可夢類型上線時，只需更新 types.ts 的 set，兩處自動同步。
 */
export function isRulePokemon(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.supertype !== 'Pokemon') return false;
  const tags = card.tags ?? [];
  if (tags.includes('規則盒')) return true;
  for (const t of tags) if (RULE_BOX_SUBTYPES.has(t)) return true;
  if (card.subtype && RULE_BOX_SUBTYPES.has(card.subtype)) return true;
  if (card.rulesText?.includes('擁有規則')) return true;
  if (card.name.endsWith('ex') || card.name.endsWith('EX')) return true;
  return false;
}

/**
 * v3.67 中立中心（Neutral Center）stadium set。
 * 卡面：「雙方的所有寶可夢（『擁有規則的寶可夢』除外），不會受到對手的
 *        『寶可夢【ex】・【V】』招式的傷害。」
 * 實裝點：① engine.ts 戰鬥場傷害計算（line ~3500 area）② resolveBenchGuard（本檔）
 */
export const NEUTRAL_CENTER_STADIUMS = new Set<string>(['中立中心']);

export function isNeutralCenterActive(state: GameState, pool: Map<string, Card>): boolean {
  const s = state.activeStadium;
  if (!s) return false;
  const card = pool.get(s.cardId);
  return !!card && NEUTRAL_CENTER_STADIUMS.has(card.name);
}

/**
 * v3.67 中立中心判定 helper：當前場上中立中心啟動 + attacker 為規則寶可夢 + defender 為非規則寶可夢
 * → 招式傷害變 0。
 */
export function wouldNeutralCenterBlock(
  state: GameState,
  pool: Map<string, Card>,
  attackerCard: Card | undefined,
  defenderCard: Card | undefined,
): boolean {
  if (!isNeutralCenterActive(state, pool)) return false;
  if (!attackerCard || !defenderCard) return false;
  if (!isRulePokemon(attackerCard)) return false;  // attacker 必須是規則寶可夢（ex/V）
  if (isRulePokemon(defenderCard)) return false;   // defender 必須是非規則
  return true;
}

/**
 * @deprecated v4.5+ 起新 caller 請改用 `canApplyEffectToTarget(state, idx, target, card, kind, pool, {isBench: true})`。
 *
 * 此 helper 只擋「對戰圓形競技場」一個 defense（bench-only）。
 * Unified helper 涵蓋 22 條 defense 規則自動 dispatch，避免 v4.54/v4.57/v4.58 反覆踩的「漏 helper」雷。
 *
 * defense.ts 內部 dispatch 仍可使用本 helper（by design）；其他外部 caller 應遷移。
 */
export function isBenchProtected(state: GameState, pool: Map<string, Card>): boolean {
  const s = state.activeStadium;
  if (!s) return false;
  const card = pool.get(s.cardId);
  if (!card) return false;
  return BENCH_PROTECTION_STADIUMS.has(card.name);
}

/**
 * v2.67：計算玩家場上「古代」tag 寶可夢數量（戰鬥場 + 備戰區）。
 * - 依據 card.tags?.includes('古代')（由 scraper + migration 補到 static/cards）
 * - 用於 故勒頓｜原生亂打、覺醒戰鼓…等以古代寶可夢為數量倍率的效果
 * - v2.48 的太晶 tag 屬同類機制；此 helper 可視為同一 pattern 的延伸
 */
export function countAncientOnField(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
): number {
  const p = state.players[idx];
  const instances = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  let count = 0;
  for (const inst of instances) {
    const card = pool.get(inst.cardId);
    if (card?.tags?.includes('古代')) count++;
  }
  return count;
}

/**
 * v2.46：招式/特性的傷害判定分類
 * - attack-damage：招式的【傷害】（例：殘酷箭、狙擊羽毛、暗影子彈的 30 點、電磁電光）
 *     → 不被對戰圓形擋；會被謝米「花之帷幔」擋（只擋備戰且非規則寶可夢）
 * - attack-effect：招式的【效果】（放傷害指示物，例：悄聲加害、飛來橫禍、幻影奇襲的 6 個指示物）
 *     → 被對戰圓形擋；不被花之帷幔擋
 * - ability-effect：特性的【效果】（放傷害指示物，例：咒詛炸彈）
 *     → 被對戰圓形擋；不被花之帷幔擋
 *
 * 起源：v2.46 Leon 發現「殘酷箭：土龍弟弟 因對戰圓形競技場效果不受傷害」是錯的。
 * 對戰圓形只擋「放置指示物」的效果，不擋招式本身的傷害。因此分離傷害 vs 效果兩個判定。
 * 類似於基本能量 vs 特殊能量當初的拆分原則。
 */
// v4.51 Phase 2：統一 defense helper
import { canApplyEffectToTarget, isOppActiveImmuneToAttackEffect } from './defense';
import { applyDefenderReductionsBlockA, isToolsJammed, getEffectiveHP, computeActiveRetreatCostFor, energyTypeUnitsHostAware, energyProvidesType, type FormulaTerm } from './engine'; // v5.544 防守方減傷中央收斂；v5.677 getEffectiveHP 單一來源；v5.702 host-aware 能量述詞移至 engine 單一來源

export type DamageKind = 'attack-damage' | 'attack-effect' | 'ability-effect';

/**
 * v2.46：檢查 defender 場上是否有謝米（花之帷幔）。
 * 花之帷幔：自己的所有備戰寶可夢（擁有規則的寶可夢除外）不會受到對手的招式的傷害。
 *   - 只擋「招式的傷害」（attack-damage）
 *   - 不擋招式的效果（放指示物）或特性效果
 *   - 不擋對戰鬥寶可夢的傷害
 *   - 目標若為「擁有規則的寶可夢」（ex/EX）不受保護
 */
export function hasFlowerVeil(
  state: GameState,
  defenderIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const defender = state.players[defenderIdx];
  const allHolders: Array<{ inst: CardInstance; loc: 'active' | 'bench' }> = [];
  if (defender.active) allHolders.push({ inst: defender.active, loc: 'active' });
  for (const b of defender.bench) allHolders.push({ inst: b, loc: 'bench' });
  for (const { inst, loc } of allHolders) {
    const card = pool.get(inst.cardId);
    if (!card?.abilities?.some(a => a.name === '花之帷幔')) continue;
    // v5.224：holder 在 active 位置時，若被振翼髮暗夜羽擊壓制 → 特性失效，跳過
    if (!isAbilityHolderEffective(state, inst, card, defenderIdx, '花之帷幔', loc, pool)) continue;
    return true;
  }
  return false;
}

/**
 * v2.57：檢查 defender 場上是否有「火箭隊的急凍鳥｜抵抗之幕」特性。
 * 抵抗之幕：只要這隻寶可夢在場上，自己的場上所有【基礎】寶可夢的「火箭隊的寶可夢」，
 *           不會受到對手的寶可夢使用招式的效果的影響。
 *   - 只擋「招式的效果」（attack-effect）— 放指示物、debuff flag、異常狀態等
 *   - 不擋純招式傷害（那是 attack-damage）
 *   - 不擋對手的特性效果（卡面明確說「招式的」）
 *   - 目標條件：Basic stage + 名稱含「火箭隊的」
 */
export function hasRocketVeil(
  state: GameState,
  defenderIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const defender = state.players[defenderIdx];
  const allHolders: Array<{ inst: CardInstance; loc: 'active' | 'bench' }> = [];
  if (defender.active) allHolders.push({ inst: defender.active, loc: 'active' });
  for (const b of defender.bench) allHolders.push({ inst: b, loc: 'bench' });
  for (const { inst, loc } of allHolders) {
    const card = pool.get(inst.cardId);
    if (!card?.abilities?.some(a => a.name === '抵抗之幕')) continue;
    // v5.224：holder 在 active 位置時，若被振翼髮暗夜羽擊壓制 → 特性失效，跳過
    if (!isAbilityHolderEffective(state, inst, card, defenderIdx, '抵抗之幕', loc, pool)) continue;
    return true;
  }
  return false;
}

/** v2.57：判斷 targetCard 是「基礎」且名稱含「火箭隊的」— 抵抗之幕保護對象
 * v3.46：原 subtype === 'Basic' 會誤排除 subtype='ex' 的基礎卡（如火箭隊的超夢ex）。
 *        改用 PTCG 標準基礎判定（!evolvesFrom 且非 Stage1/Stage2）。 */
/**
 * v5.565 收斂：寶可夢「進化階段」唯一判定。ex/超級(Mega) 卡 subtype 為 'ex' 會丟失階段，
 * 但 JSON 的 stage 欄位(v2.75 新增)保留原始 Basic/Stage1/Stage2 → 一律以 stage 為準(fallback subtype/evolvesFrom)。
 * 凡「對手/自己是 1 階/2 階/進化寶可夢」的傷害加成・數量計算，禁直接 subtype === 'Stage1'(會漏 ex 進化)。
 */
export function cardStage(c: Card | undefined): 'Basic' | 'Stage1' | 'Stage2' | 'Other' {
  const s = c?.stage ?? c?.subtype;
  return (s === 'Basic' || s === 'Stage1' || s === 'Stage2') ? s : (c?.evolvesFrom ? 'Stage1' : 'Other');
}
export const isStage1Card = (c: Card | undefined): boolean => cardStage(c) === 'Stage1';
export const isStage2Card = (c: Card | undefined): boolean => cardStage(c) === 'Stage2';
export const isEvolutionCard = (c: Card | undefined): boolean => { const s = cardStage(c); return s === 'Stage1' || s === 'Stage2'; };

export function isRocketBasicTarget(targetCard: Card | undefined): boolean {
  if (!targetCard) return false;
  if (targetCard.supertype !== 'Pokemon') return false;
  if (targetCard.subtype === 'Stage1' || targetCard.subtype === 'Stage2') return false;
  if (targetCard.subtype === 'Other') return false;
  if (targetCard.evolvesFrom) return false;
  return targetCard.name.includes('火箭隊的');
}

/**
 * v2.57：檢查指定 player 場上是否有「莉莉艾的皮皮ex｜妖精領域」特性。
 * 妖精領域：只要這隻寶可夢在場上，對手的場上的所有【龍】寶可夢的弱點全部改爲【超】屬性。
 *   - engine 在計算弱點時查這個 flag：若 attacker 的一方有皮皮ex 且 defender 是【龍】，
 *     則把 defender 的弱點類型當作 'Psychic' 處理。
 *   - 被火箭監視塔壓制時（皮皮ex 是【妖精】不是【無】），此特性仍生效。
 */
export function hasFairyZoneField(
  state: GameState,
  ownerIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const p = state.players[ownerIdx];
  const cards = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  for (const c of cards) {
    const card = pool.get(c.cardId);
    if (!card?.abilities) continue;
    for (const a of card.abilities) {
      if (a.name === '妖精領域') return true;
    }
  }
  return false;
}

/**
 * v5.562 收斂：計算 defender 戰鬥位的「有效弱點屬性」。引擎主管線 + 中央 dealAttackDamageToTarget 共用，
 * 避免走中央 helper 的招式(如 M5 詛咒娃娃|玩偶捕捉)漏套妖精領域/掌握弱點覆寫/弱點失效。
 *   妖精領域(莉莉艾的皮皮ex)：actorIdx 一方在場 → 對手【龍】寶可夢弱點改【超】；
 *   掌握弱點(智揮猩)：weaknessOverrideTypeThisTurn 覆寫；
 *   金屬防禦強化(鋁鋼橋龍ex)：weaknessDisabledThisTurn → disabled。actorIdx = 攻擊方(=皮皮ex 持有方)。
 */
export function getEffectiveWeaknessType(
  state: GameState,
  actorIdx: 0 | 1,
  defenderActive: CardInstance | null | undefined,
  defenderCard: Card | undefined,
  pool: Map<string, Card>,
): { type: string | undefined; disabled: boolean } {
  let t = defenderCard?.weakness?.type;
  if (defenderCard?.pokemonType === 'Dragon' && hasFairyZoneField(state, actorIdx, pool)) t = 'Psychic';
  if (defenderActive?.weaknessOverrideTypeThisTurn) t = defenderActive.weaknessOverrideTypeThisTurn;
  return { type: t, disabled: !!defenderActive?.weaknessDisabledThisTurn };
}
/**
 * v5.562 收斂：攻擊方戰鬥位的「有效屬性清單」(弱點/抵抗比對用)。
 *   小碎鑽|雙重屬性→【鬥】+【超】；鐵轍跡|二重核心(附驅勁能量 未來)→【鬥】+【鋼】；否則單一 pokemonType。
 */
export function getAttackerEffectiveTypes(
  attackerActive: CardInstance | null | undefined,
  attackerCard: Card | undefined,
  pool: Map<string, Card>,
): string[] {
  if (attackerCard?.name === '小碎鑽' && attackerCard.abilities?.some(a => a.name === '雙重屬性')) return ['Fighting', 'Psychic'];
  if (attackerActive && attackerCard && hasIronTracksDualCore(attackerActive, attackerCard, pool)) return ['Fighting', 'Metal'];
  return attackerCard?.pokemonType ? [attackerCard.pokemonType] : [];
}

/**
 * v5.673 中央弱點/抵抗力計算 — 與引擎主管線一致:妖精領域(龍→超)/掌握弱點/弱點失效(disabled)
 *   + 攻擊方有效屬性(小碎鑽雙屬性/鐵轍跡二重核心)。所有「戰鬥位攻擊傷害」helper 共用,
 *   禁各自 raw `attackerCard.pokemonType === ...` 比對(會漏上述效果;狙擊/多目標 helper 曾漏)。
 */
export function applyWeakRes(
  state: GameState, actorIdx: 0 | 1,
  target: CardInstance | null | undefined, targetCard: Card | undefined,
  dmg: number, pool: Map<string, Card>,
): number {
  const atk = state.players[actorIdx].active;
  const atkCard = atk ? pool.get(atk.cardId) : undefined;
  const atkTypes = getAttackerEffectiveTypes(atk, atkCard, pool);
  let d = dmg;
  const w = getEffectiveWeaknessType(state, actorIdx, target, targetCard, pool);
  if (!w.disabled && w.type && atkTypes.includes(w.type)) d *= 2;
  if (targetCard?.resistance?.type && atkTypes.includes(targetCard.resistance.type)) {
    const rv = parseInt(String(targetCard.resistance.value ?? '0').replace(/[^-\d]/g, ''), 10);
    if (!isNaN(rv)) d = Math.max(0, d + rv);
  }
  return d;
}

/**
 * v2.46：「對備戰目標」造成傷害/放指示物時，統一檢查是否被卡面/場地擋下。
 *   kind === 'attack-effect' / 'ability-effect' → 查對戰圓形（備戰不放指示物）
 *   kind === 'attack-damage'                   → 查花之帷幔（備戰且非 ex）、太晶（備戰）
 * 回傳：{ blocked: true, reason } 表示被擋下；{ blocked: false } 表示可進行。
 * 注意：actor 的對手 = defender，所以比對特性要對 defenderIdx 做。
 *
 * v2.48：加入太晶規則。太晶寶可夢在【備戰區】不會受到【招式】的【傷害】，
 *        但招式內的「指示物放置」效果（e.g. 幻影奇襲 的 6 counter）不受太晶保護，
 *        所以只在 kind === 'attack-damage' 分支檢查 tags。
 *        Active 的太晶寶可夢不受此保護 — caller 應只在目標為 bench 時呼叫本函式。
 *
 * @deprecated v4.5+ 起新 caller 請改用 `canApplyEffectToTarget(state, idx, target, card, kind, pool, {isBench: true})`。
 *
 * 此 helper 只涵蓋 bench-only defense bundle（對戰圓形 / 球形盾牌 / 花之帷幔 / 藏隱 /
 * 深度下潛 / 羽毛化石 / 太晶 / 中立中心）。不擋 attack-effect immunity（薄霧 / 抵抗之幕 等）
 * 也不擋光之翼。Unified helper 自動分派全部 22 條 defense 規則。
 *
 * defense.ts 內部 dispatch 仍可使用本 helper（by design）；其他外部 caller 應遷移。
 */
export function resolveBenchGuard(
  state: GameState,
  pool: Map<string, Card>,
  actorIdx: 0 | 1,
  targetCard: Card | undefined,
  kind: DamageKind,
): { blocked: true; reason: string } | { blocked: false } {
  // v5.503：護城龍|太古防壁 — defender 備戰有護城龍 + 攻擊方能量單位 ≤2 → 擋對「備戰」的招式傷害。
  //   原僅 canApplyEffectToTarget(defense.ts) 檢查；但 bench-hit-N resolver(噴射打擊等「對備戰N傷害」)
  //   直接呼叫 resolveBenchGuard、繞過該檢查 → 太古防壁對備戰失效（玩家回報）。移到此低層 helper
  //   統一，所有 bench 傷害路徑共享。依攻擊宣告時能量快照(_attackTimeAttackerEnergyUnits,deferred
  //   picker 期間仍在；active 路徑同此快照)；缺席退回不擋(理論上 attack-damage 必有)。
  if (kind === 'attack-damage') {
    const _defIdxTB = (1 - actorIdx) as 0 | 1;
    const _hasTaikoBari = state.players[_defIdxTB].bench.some(b => {
      const c = pool.get(b.cardId);
      return c?.abilities?.some(a => a.name === '太古防壁');
    });
    if (_hasTaikoBari) {
      const _atkUnits = state._attackTimeAttackerEnergyUnits ?? Infinity;
      if (_atkUnits <= 2) {
        return { blocked: true, reason: `太鼓防壁 免疫能量 ${_atkUnits} 個（≤2）的對手招式傷害` };
      }
    }
  }
  if (kind === 'attack-effect' || kind === 'ability-effect') {
    if (isBenchProtected(state, pool)) {
      return { blocked: true, reason: '對戰圓形競技場效果' };
    }
  }
  // v3.0 蟲甲聖｜球形盾牌 — 場上有此卡 → 自方所有備戰寶可夢不受對手寶可夢招式的「傷害與效果」。
  //   範圍涵蓋 attack-damage（招式直傷至 bench）+ attack-effect（招式效果 → bench 放指示物 / 狀態 等）。
  //   不擋 ability-effect（卡面明文「招式」），故 ability-effect 走原 isBenchProtected 路徑即可。
  //   resolveBenchGuard caller 已保證 target 在 bench，故無需再判斷 bench-only。
  //
  // v5.237：加 attack-time snapshot fallback — 蟲甲聖被同招式 KO 後 state 已沒蟲甲聖，
  //   但 _attackTimeOppBugShield snapshot 仍記得宣告當時有，per-target 仍擋。
  //   仿 v5.186 抵抗之幕 + v3.892 花之帷幔 pattern。
  //   情境：對手戰鬥位蟲甲聖（球形盾牌）被「幻影奇襲」類 AOE 招式擊倒後，
  //         備戰寶可夢仍應免疫此招式放置的指示物效果。
  if (kind === 'attack-damage' || kind === 'attack-effect') {
    const defenderIdxBA = (1 - actorIdx) as 0 | 1;
    if (hasBugAegislashShield(state, defenderIdxBA, pool) || state._attackTimeOppBugShield) {
      return { blocked: true, reason: '蟲甲聖 球形盾牌 效果' };
    }
  }
  // v3.06 斯魔茶｜藏隱 / 小霞的鯉魚王｜深度下潛 —
  //   「只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。」
  //   resolveBenchGuard caller 已保證 target 在備戰區，故此處直接判定 targetCard
  //   自身是否擁有此特性。
  if (kind === 'attack-damage' || kind === 'attack-effect') {
    if (_v3060BenchImmAbil(targetCard)) {
      const abName = _v3060GetBenchImmName(targetCard) ?? '備戰免疫';
      return { blocked: true, reason: `${targetCard?.name ?? '?'} ${abName} 效果` };
    }
  }
  if (kind === 'attack-effect') {
    // v2.57：火箭隊的急凍鳥「抵抗之幕」— 我方基礎火箭隊寶可夢不受對手【招式的效果】影響。
    // 因 resolveBenchGuard 僅在 target 為 bench 時被呼叫，這裡檢查備戰區上的目標即可。
    const defenderIdx = (1 - actorIdx) as 0 | 1;
    // v5.186：加 attack-time snapshot fallback — 急凍鳥被同招式 KO 後 state 已沒急凍鳥，
    //   但 _attackTimeOppRocketVeil snapshot 仍記得宣告當時有，per-target 仍擋。
    //   仿 v3.892 花之帷幔 pattern。
    if ((hasRocketVeil(state, defenderIdx, pool) || state._attackTimeOppRocketVeil) && isRocketBasicTarget(targetCard)) {
      return { blocked: true, reason: '火箭隊的急凍鳥 抵抗之幕 效果' };
    }
  }
  if (kind === 'attack-damage') {
    const defenderIdx = (1 - actorIdx) as 0 | 1;
    // v3.94：加 attack-time snapshot fallback — 戰鬥場謝米被同招式 KO 後，
    //   state 已沒謝米但 _attackTimeOppFlowerVeil snapshot 仍記得宣告當時有，per-target 仍擋。
    if ((hasFlowerVeil(state, defenderIdx, pool) || state._attackTimeOppFlowerVeil) && !isExCard(targetCard)) {
      return { blocked: true, reason: '謝米 花之帷幔 效果' };
    }
    if (targetCard?.tags?.includes('太晶')) {
      return { blocked: true, reason: '太晶寶可夢 防禦效果' };
    }
    // v3.67 中立中心 stadium：非規則 defender 不受對手 ex/V 招式傷害（attacker 是規則寶可夢時生效）
    // 這裡 caller 已 supply attackerCard via state.players[actorIdx].active（在 engine attack pipeline 內呼叫）。
    // resolveBenchGuard 內目前只接 targetCard，attackerCard 從 state 查。
    const attackerInst = state.players[actorIdx].active;
    const attackerCard = attackerInst ? pool.get(attackerInst.cardId) : undefined;
    if (wouldNeutralCenterBlock(state, pool, attackerCard, targetCard)) {
      return { blocked: true, reason: '中立中心競技場 效果' };
    }
  }
  // v5.367：條件式完全免疫特性（神秘石居 等）也適用於備戰目標 — 狙擊/分配傷害類招式
  //   走 resolveBenchGuard 時一併擋（原只在 engine 主傷害管線消費）。
  if (kind === 'attack-damage') {
    const piBench = passiveImmunityDamageBlock(state, actorIdx, targetCard, pool);
    if (piBench.blocked) return piBench;
  }
  // v3.21 陳舊的羽毛化石（I）備戰免疫：卡面明寫「傷害與效果」皆免——
  //   v2.191 原實裝只擋 attack-damage 是 bug；本波擴展到 attack-damage|attack-effect 兩者。
  //   caller 已保證 target 在 bench，這裡只比對 cardName。
  if (kind === 'attack-damage' || kind === 'attack-effect') {
    if (targetCard?.name === '陳舊的羽毛化石') {
      return { blocked: true, reason: '陳舊的羽毛化石 備戰免傷+免效果' };
    }
  }
  return { blocked: false };
}

// SPECIAL_ENERGY_ATTACH 和 AttachEnergyHookFn 已搬到 _shared.ts（v2.66）。

// 已搬遷到 effects/cards/ 下的卡 — side-effect import 觸發 reg() 登錄。
// 未來要加更多搬遷檔時，也只需要在這裡加一行 import。
import './effects/cards/white_lily_akamatsu';
import './effects/cards/draw_supporters';
import './effects/cards/pokemon_search';
// v2.24：物品卡雜項（切換/藥水/棄牌區回收/頂尖捕捉器/不公印章）+ Gust 支援者
import './effects/cards/items_misc';
import './effects/cards/supporters_gust';
// v2.64：胡地 + 瑪俐的長毛巨魔ex 預組卡（Wave 44）
import './effects/cards/abra_mawile_deck';
// v2.65：魔靈多龍牌組 Wave 43（黑夜魔靈咒詛炸彈 / 多龍奇 / 願增猿 / 喵喵ex / 特殊紅牌 / 阿蜜的目光）
import './effects/cards/maroon_dragon_deck';
// v2.66：特殊能量卡 hook（富裕能量 / 感應【超】能量 / 火箭隊能量）
import './effects/cards/energy_cards';
// v2.89：呆呆王 + 超級路卡利歐 兩組預組卡效果（使者衝刺 / 機關槍合擊 / 波動突刺 /
//        超級勇氣 / 月光循環 / 宇宙光束 / 幻影碎 / 暗碼迷的解讀 等）
import './effects/cards/slowking_lucario_deck';
// v2.100：奧利瓦 / 鋁鋼橋龍 / 超級寶石海星 三組預組卡效果
import './effects/cards/mega_decks';
// v2.112：N的索羅亞克 / 火焰雞多龍 / 夠讚狗 / 顫弦蠑螈 / 蒼炎刃鬼 / 超級甲賀忍蛙 六組預組卡效果
import './effects/cards/six_decks';
// v2.340：M2/M2a 超級快龍ex / 花舞鳥ex / 超級噴火龍Xex / 超級噴火駝ex focused batch
import './effects/cards/m2_dragon_charizard_batch';
// v2.135：阿響的火爆獸 / 火箭隊的烏鴉頭頭 兩組預組卡效果（在本檔末尾 inline 註冊）
// v2.149：超級長耳兔 / 蜜集大蛇 / 火伊布 / 祭典樂舞 四組預組卡效果（熟成充能 / 衝衝鼓 / 搜尋寶石 / 祭典樂舞 註解）
import './effects/cards/lopunny_serperior_flareon_festival';
// v2.154：土龍多龍 / 大竺葵 / 太陽伊布 / 巨金怪 / 水牛超級袋獸 / 莉莉艾的皮皮 /
//         超級妙蛙花 / 超級袋獸阿勃梭魯 / 青銅鐘多龍 九組預組卡新效果
//         （日光轉移 / 金屬製造者 / 玻璃喇叭 / 超大冰淇淋；鈷藍指令、捲牆 inline）
import './effects/cards/v154_decks';
// v2.155：補實裝 20 個 preset 主力 ex 招式（audit 漏掃修正後找出的長期漏實裝）
import './effects/cards/v155_attacks';
// v2.158：通用「逐張附能量到玩家選的目標寶可夢」chain helper
//         供燃燒充能 / 電電充能 / 樂呵呵之吻 / 金屬製造者 / 玻璃喇叭 / X啟動 共用
import './effects/cards/v158_energy_chain';
import './effects/cards/v168_supporters';
import './effects/cards/v169_supporters';
import './effects/cards/v172_hij_batch';
import './effects/cards/v2306_meta_pokemon';
import './effects/cards/v2346_j_mark_batch';
import './effects/cards/v2347_j_mark_batch';
import './effects/cards/v2348_j_mark_batch';
import './effects/cards/v2349_j_mark_batch';
import './effects/cards/v2352_j_mark_batch';
import './effects/cards/v2353_j_mark_batch';
import './effects/cards/v2354_j_mark_batch';
import './effects/cards/v2355_j_mark_batch';
import './effects/cards/v2359_j_mark_batch';
import './effects/cards/v2360_j_mark_batch';
import './effects/cards/v2370_mp_promo';  // v4.952 M-P-J 特典卡（古歷 + 超級妖火紅狐ex）
import './effects/cards/v2362_new_decks_batch';
import './effects/cards/v2370_new_decks_batch';
import './effects/cards/v2374_rocket_brain';
import './effects/cards/v2380_j_attacks_batch';
import './effects/cards/v2380_j_abilities_batch';
import './effects/cards/v2390_j_trainers_batch';
import './effects/cards/v2400_i_wave1_recharge_status';
import './effects/cards/v2930_high_use_abilities';
import './effects/cards/v2401_i_wave2_draw_swap_search';
import './effects/cards/v2402_mega_gardevoir';
import './effects/cards/v2490_i_wave3a_conditional';
import './effects/cards/v2500_i_wave3b_discard';
import './effects/cards/v2510_i_wave3c_status_self';
import './effects/cards/v2540_i_wave4_misc';
import './effects/cards/v2550_i_wave5_meta';
import './effects/cards/v2560_i_wave6_complex';
import './effects/cards/v2570_i_wave7_heal_dualstatus';
import './effects/cards/v2580_i_wave8_misc2';
import './effects/cards/v2590_i_wave9_misc3';
import './effects/cards/v2600_i_wave10_conditional';
import './effects/cards/v2610_i_wave11_misc4';
import './effects/cards/v2620_i_wave12_misc5';
import './effects/cards/v2630_i_wave13_misc6';
import './effects/cards/v2640_i_wave14_misc7';
import './effects/cards/v2650_i_wave15_misc8';
import './effects/cards/v2660_i_wave16_misc9';
import './effects/cards/v2670_i_wave17_complex2';
import './effects/cards/v2680_i_wave18_copy_attacks';
import './effects/cards/v2690_i_wave19_engine_hooks';
import './effects/cards/v2740_h_wave1_simple';
import './effects/cards/v2750_h_wave2_full';
import './effects/cards/v2760_h_wave3_complex';
import './effects/cards/v2770_cross_mark_cleanup';
import './effects/cards/v2995_g4_wave1';
import './effects/cards/v2996_g4_wave2';
import './effects/cards/v2997_g4_wave3';
import './effects/cards/v2998_g2';
import './effects/cards/v3700_audit_orphans';
import './effects/cards/m5_preview';
import './effects/cards/m5_j_coverage_fix';
import { desertDragonflyOnKo } from './effects/cards/v2998_g2';
import { addPendingPrize, getPendingPrize } from './effects/_shared';
// v5.246：effects.ts 內部 reg 用 (烏栗 / 衝浪手 / 鐵斑葉ex 等)
import { tryPromptPromoteActive } from './effects/_shared';
// v3.0 Group 3 Wave 2 helper — 用於 resolveBenchGuard 蟲甲聖球形盾牌
import { hasBugAegislashShield } from './effects/cards/v3000_g3_wave2';
// v5.237：re-export 給 engine.ts 用於 attack-time snapshot
export { hasBugAegislashShield };
// v3.06 Deferred Wave B helper — 在備戰時免疫對手招式（藏隱 / 深度下潛）
import {
  hasBenchAttackImmunityAbility as _v3060BenchImmAbil,
  getBenchImmunityAbilityName as _v3060GetBenchImmName,
  attackerHasSpecialEnergy as _v3060AttackerHasSE,
} from './effects/cards/v3060_deferred_wave_b';
// v3.08 Deferred Wave C helper — 美納斯｜平穩境地（對手寶可夢/附加卡 → 對手手牌阻擋）
import { oppHasMenasureCalmGround as _v3080OppHasMenasureCG } from './effects/cards/v3080_deferred_wave_c';
// v5.700 對手備戰強制換位(gust)免疫過濾：item 級(緊張感/融合為雪) / supporter 級(+化石/廣域堡壘)
import { isImmuneToOppTrainer as _gustImmuneTrainer } from './effects/cards/v3060_deferred_wave_b';
import { isImmuneToOppSupporter as _gustImmuneSupporter } from './effects/cards/v3080_deferred_wave_c';

// ══════════════════════════════════════════════════════════════════════════════
// 即時支援者 / 互動支援者 — v2.12 搬到 effects/cards/draw_supporters.ts
// 管理員 / 帕底亞的夥伴 / 納莉 / 丹瑜 / 紫竽 / 松葉的信心 / 莉莉艾的決意（v2.24 搬）/
// 枇琶 / 艾莉絲的鬥志 / 探險家的嚮導 / 鳴依的勉勵
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 切換 / 藥水 / 棄牌區回收 / 頂尖捕捉器 / 不公印章
//   v2.24 搬到 effects/cards/items_misc.ts
// 包含：寶可夢交替 / 急進開關 / 好傷藥 / 龍之秘藥 / 夜間擔架 / 能量回收器 /
//       奇跡修正檔 / 頂尖捕捉器 / 不公印章
//       共用 resolver: do-switch / heal-60-discard-1 / heal-120 /
//                      discard-to-hand / energy-retrieval /
//                      miracle-codec-energy / miracle-codec-attach /
//                      top-catcher-opp
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（球 + 小剛的發掘） — v2.19 已抽到 effects/cards/pokemon_search.ts
// 包含：好友寶芬、赫普的包包、甜蜜球、黑暗球、小剛的發掘、高級球、超級信號
//       共用 resolver: bench-basic-from-deck / search-pokemon-to-hand / ultra-ball-discard
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 支援者 — 呼叫對手（Gust 系列）— v2.24 搬到 effects/cards/supporters_gust.ts
// 包含：老大的指令   共用 resolver: gust-opp
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 招式效果
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_PRE：招式宣告後、傷害計算前的效果。
 * 接收現在 state 與攻擊方索引，回傳 { state, damage }（damage 為本次招式實際傷害）。
 *
 * ATTACK_POST：傷害施加（含擊倒判定）後的效果。
 * 可觸發 pendingSelection 讓玩家做額外選擇；回傳新 state。
 *
 * 注意：ATTACK 之後 turnPhase 已設為 'end'，
 * POST 設定的 pendingSelection 解析完後 turnPhase 保持 'end'，
 * 玩家確認取獎賞卡後再按 END_TURN 結束回合。
 */

// ATTACK_PRE / ATTACK_POST / regPre / regPost / PreDiscardSpec /
// ATTACK_PRE_DISCARD_CHOICE 已於 v2.64 搬到 ./effects/_shared.ts，
// 本檔於最上方 import 取得並 re-export 給 engine.ts / +page.svelte 繼續使用。

// ══════════════════════════════════════════════════════════════════════════════
// POST 共用 helper：bench 施傷 / KO 處理（v1.58 H13 批次）
// ══════════════════════════════════════════════════════════════════════════════

/** 計算 KO 獎賞張數（與 engine.prizesForKO 對齊；inline 以免 effects→engine 反向依賴） */
export function koPrizeCount(card: Card): number {
  const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');
  if (isEx && card.name.startsWith('超級')) return 3; // Mega ex
  return isEx ? 2 : 1;
}

/**
 * v5.404：KO 獎賞「防守方側」調整 — effects.ts 的指示物/狙擊/手動 KO 路徑原本只用 base koPrizeCount，
 *   漏掉 engine 主傷害流程有的調整：莉莉艾的珍珠 -1 / 豪華斗篷 +1 / 古舊能量 -1(每場每方僅1次) / 影藏 -1
 *   (惡寶可夢被 ex 攻擊方 KO) / 脆弱蛻殼類歸 0。回傳調整後獎賞 + 更新 state(古舊能量 once flag)。
 *   不含 attacker-context 加成(奇跡之吻擲幣/貪婪食客/N的/白百合等 — 那些主要對 active KO，engine 內處理)。
 *   @param koInst 被 KO 的 CardInstance（讀其道具/能量）；defenderIdx = 被 KO 那方。
 */
export function koPrizesAdjusted(
  state: GameState,
  koInst: CardInstance,
  koCard: Card | undefined,
  attackerIdx: 0 | 1,
  defenderIdx: 0 | 1,
  pool: Map<string, Card>,
  koByAttackDamage: boolean = true,  // v5.506：是否「受到招式傷害」昏厥（效果KO=false）
): { prizes: number; state: GameState } {
  let s = state;
  if (!koCard) return { prizes: 1, state: s };
  const base = koPrizeCount(koCard);
  // v5.638：deferredPrizeBonusThisTurn（多餘花粉等「下個自己回合，此卡被昏厥時+N獎賞」）綁在「被KO的這隻
  //   instance」身上，卡面是「被【昏厥】時」→ 不論招式傷害KO 或 效果/特性KO（咒詛炸彈/深淵之瞳…）都該+N。
  //   原本只在 engine 攻擊傷害主管線 inline 加，所有走 koPrizesAdjusted 的效果/特性KO 路徑全漏（玩家回報
  //   多餘花粉被咒詛炸彈KO沒+2）。收斂到此中央函式 → 18+ 個 KO 路徑一致 +N，與 koByAttackDamage 無關。
  const deferredBonus = (koInst.deferredPrizeBonusThisTurn && koInst.deferredPrizeBonusThisTurn > 0) ? koInst.deferredPrizeBonusThisTurn : 0;
  const atkActive = s.players[attackerIdx].active;
  const atkCard = atkActive ? pool.get(atkActive.cardId) : undefined;
  let adjust = 0;
  // v5.506：以下獎賞調整卡面皆明寫「受到對手寶可夢招式的【傷害】而昏厥時」→ 只在傷害KO生效。
  //   效果KO（放傷害指示物：多龍巴魯托ex|幻影奇襲、咒詛炸彈、悄聲加害 等 attack-effect；
  //   或深淵之瞳式效果昏厥）koByAttackDamage=false → 一律不套。
  //   v5.728：脆弱蛻殼（PASSIVE_PREVENT_PRIZE→0）也移入此 gate — 卡面「受到對手寶可夢【ex】招式
  //   的『傷害』而昏厥，對手也無法獲得獎賞卡」確認限傷害KO（Wilson 裁定）；效果KO（幻影奇襲放指示物
  //   等）不觸發歸0，對手正常拿獎賞（修正先前放在 koByAttackDamage 外、效果KO 也誤歸0 的 bug）。
  if (koByAttackDamage) {
    // 脆弱蛻殼（脫殼忍者）等 PASSIVE_PREVENT_PRIZE → 0 張
    for (const ab of (koCard.abilities ?? [])) {
      if (!isAbilityHolderEffective(s, koInst, koCard, (1 - attackerIdx) as 0 | 1, ab.name, 'active', pool)) continue; // v5.655 被KO者特性被暗夜羽擊/初始化等壓制→脆弱蛻殼失效
      const fnPP = PASSIVE_PREVENT_PRIZE.get(ab.name);
      if (fnPP && atkCard && fnPP(atkCard)) return { prizes: 0, state: s };
    }
    // 道具：莉莉艾的珍珠 -1 / 豪華斗篷 +1（阻礙之塔在場時道具效果失效）
    const stadiumName = s.activeStadium ? pool.get(s.activeStadium.cardId)?.name : undefined;
    if (stadiumName !== '阻礙之塔') {
      for (const t of getAllAttachedTools(koInst)) {
        const tool = pool.get(t.cardId);
        const fn = tool ? TOOL_PRIZE_BONUS.get(tool.name) : undefined;
        if (fn) adjust += fn(koCard);
      }
    }
    // 古舊能量 -1（per-game once，per 防守方）
    const usedFlags = s.ancientEnergyMinusOneUsed ?? [false, false];
    if (!usedFlags[defenderIdx]
        && koInst.energyAttached.some(e => pool.get(e.cardId)?.name === '古舊能量')) {
      adjust -= 1;
      const f = [...usedFlags] as [boolean, boolean];
      f[defenderIdx] = true;
      s = { ...s, ancientEnergyMinusOneUsed: f };
    }
    // 影藏（超級耿鬼ex）：惡寶可夢被【ex】攻擊方 KO → -1
    const isExAttacker = !!atkCard && (atkCard.name.endsWith('ex') || atkCard.name.endsWith('EX'));
    if (isExAttacker && koCard.pokemonType === 'Darkness') {
      const def = s.players[defenderIdx];
      const defHasKage = (def.active && pool.get(def.active.cardId)?.abilities?.some(a => a.name === '影藏'))
        || def.bench.some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '影藏'));
      if (defHasKage) adjust -= 1;
    }
  }
  return { prizes: Math.max(0, base + adjust + deferredBonus), state: s };
}

/**
 * 計算 CardInstance 的有效 HP（含道具 HP 加成 + 場地卡影響，與 engine.getEffectiveHP 對齊）。
 * v2.92：加 `state` 參數以套用場地效果（例：引力山岳 Stage2 -30）。
 * 現有 caller 都在 regPost / regR 內部，都持有 state；傳入即可。
 */
function effectiveHPInline(
  inst: CardInstance,
  pool: Map<string, Card>,
  state?: GameState,
): number {
  // v5.677 收斂：直接委派 engine.getEffectiveHP（單一有效 HP 來源），消除與其漂移。
  //   原本地實作鏡射了大部分 HP hook，卻漏掉 engine 版的三項：
  //     ① inst.fossilOnField → 永遠 60（化石上場不吃任何加成）
  //     ② isToolsJammed（阻礙之塔）→ 停用道具 HP 加成
  //     ③ 怪顎龍｜暴龍根性（附特殊能量 +150）
  //   → 效果KO/markFaintByEffect/狙擊 等 ~18 處 HP 判定對這些卡誤算
  //     （例：效果昏厥打不死「附特殊能量的怪顎龍」、化石被高估/低估）。
  //   委派後與 UI 顯示、引擎 KO sweep 完全一致，且日後新增 HP hook 只需改 engine 一處。
  return getEffectiveHP(inst, pool, state);
}

// v5.484：效果昏厥中央 helper — 將寶可夢 damage 設為「有效 maxHP」(含道具/特殊能量/場地 HP 加成)，
//   交給引擎 KO sweep 結算。所有「直接使昏厥」效果(非傷害,如怦怦炸彈/斧擊衝撞/大蛇吐息/嗡嗡榍石/
//   高速破壞自損)的 in-place faint 都該用它，避免用 base card.hp → 對手附「竹蘭的力量負重」(+70HP)
//   等道具時 damage 不足而打不死。
export function markFaintByEffect(
  inst: CardInstance,
  pool: Map<string, Card>,
  state?: GameState,
): CardInstance {
  return { ...inst, damage: effectiveHPInline(inst, pool, state) };
}

/**
 * 對指定方的「所有備戰寶可夢」施加固定 amount 傷害（bench 不計算弱點/抵抗力）。
 * KO 判定 + 棄牌遷移 + pendingPrizes 累計都在這裡處理。
 * 僅在擊倒的情況下寫 log；非 KO 僅回傳新 state 由 caller 寫總結 log。
 *
 * 注意：bench 被 KO 不會 set pendingSelection；攻擊方累計取獎後照流程進行。
 */
/**
 * v5.293: 對 bench victim 套用「招式傷害特性減傷」(active 也走 engine.ts 的對應 pipeline).
 *
 * PTCG 規則:
 *   - 弱點 / 抵抗力: 只對戰鬥場寶可夢生效 (此 helper 不處理, bench 不算)
 *   - 特性減傷: 按卡面條件無位置限制者, active + bench 都觸發
 *   - 道具減傷: 同樣按卡面
 *
 * 涵蓋:
 *   self-only PASSIVE_DAMAGE_REDUCE (鑽石膜/堅硬身軀/密林之軀/堅硬甲殼/堅堅之軀/
 *     泥巴膜/毛皮大衣/柔軟羊毛/爆炸頭防守 等)
 *   self-only 條件式 PASSIVE_DAMAGE_REDUCE_COND (雷吉洛克 岩石盔甲)
 *   field-wide:
 *     - 大吾的小碎鑽|岩石宮殿 (-30 對「大吾的」)
 *     - 青銅鐘|守護之鐘 (-10 對所有自方)
 *     - 齒輪怪|齒輪塗層 (-20 對附鋼能量)
 *     - 爆炸頭水牛|捲牆 (-60 對【無】基礎; ≥2 隻爆炸頭水牛 active+bench 計入)
 *     - 冰雪巨龍|凍原堡壘 (-50 對附水能量)
 *   stadium:
 *     - 全金屬實驗室 (-30 對【鋼】)
 *     - 石之洞窟 (-30 對「大吾的」)
 *
 * 不涵蓋 (戰鬥位 only, 卡面明確):
 *   - 火炎獅|威嚇之牙 / 灰塵山|垃圾洩氣
 */
// v5.599 受招式傷害「擲幣免傷」中央收斂（變隱龍 躲藏高手 / 吉雉雞 腎上腺費洛蒙 PASSIVE_COIN_AVOID）。
//   原本只在 engine.ts 主管線(active 一般攻擊,~4604)消費 → 走中央 dealAttackDamageToTarget / snipe-multi /
//   分身連打,或在備戰被狙擊時,全漏(完全不擲幣)。位置無關(active+bench);正面 → 回 avoided 讓呼叫端把該目標
//   傷害歸 0(連帶 on-damaged/KO 自然跳過,因都 gate >0)。dIdx 擲幣不誤觸重試徽章(flipCoinsWithLog aIdx gate)。
function applyDefenderCoinAvoid(
  state: GameState,
  victim: CardInstance,
  victimCard: Card | undefined,
  defenderIdx: 0 | 1,
  baseDamage: number,
  pool: Map<string, Card>,
): { avoided: boolean; state: GameState } {
  if (baseDamage <= 0 || !victimCard || !victimCard.abilities) return { avoided: false, state };
  // inline isColorlessAbilityBlocked（engine.ts 未 export,避免循環依賴；同 _applyBenchAbilityReduce 做法）
  if (victimCard.pokemonType === 'Colorless' && state.activeStadium) {
    const sdCard = pool.get(state.activeStadium.cardId);
    if (sdCard && ROCKET_WATCHTOWER_STADIUMS.has(sdCard.name)) return { avoided: false, state };
  }
  const defender = state.players[defenderIdx];
  const isActive = defender.active?.iid === victim.iid;
  const inPlay = isActive ? defender.active! : defender.bench.find(c => c.iid === victim.iid);
  if (!inPlay) return { avoided: false, state };
  const loc: 'active' | 'bench' = isActive ? 'active' : 'bench';
  let s = state;
  for (const ab of victimCard.abilities) {
    if (!isAbilityHolderEffective(s, inPlay, victimCard, defenderIdx, ab.name, loc, pool)) continue;
    const coinFn = PASSIVE_COIN_AVOID.get(ab.name);
    if (!coinFn) continue;
    if (!coinFn(inPlay, victimCard, pool)) continue;
    const r = flipCoinsWithLog(s, 1, `${victimCard.name}｜${ab.name}`, defenderIdx);
    s = addLog(r.state, `${victimCard.name}｜${ab.name}：${r.heads ? '正面 → 免疫此招式傷害！' : '反面 → 受傷害'}`, defenderIdx);
    if (r.heads) return { avoided: true, state: s };
  }
  return { avoided: false, state: s };
}

function _applyBenchAbilityReduce(
  state: GameState,
  victim: CardInstance,
  victimCard: Card,
  defenderIdx: 0 | 1,
  attackerIdx: 0 | 1,  // v5.294: 取 attacker active 推 attackerCard (供 BY_ATTACKER 用)
  pool: Map<string, Card>,
  baseDamage: number,
): { amount: number; logs: string[] } {
  let dmg = baseDamage;
  const logs: string[] = [];
  const defender = state.players[defenderIdx];
  // v5.294: 取攻擊方 active 推 attackerCard, 供屬性條件減傷判定 (厚脂肪等)
  const attackerActive = state.players[attackerIdx].active;
  const attackerCard = attackerActive ? pool.get(attackerActive.cardId) : undefined;

  // local inline isColorlessAbilityBlocked (engine.ts 內未 export, 為避免循環依賴 inline)
  const _colorlessBlocked = (card: Card | undefined): boolean => {
    if (!card || card.pokemonType !== 'Colorless') return false;
    const sd = state.activeStadium;
    if (!sd) return false;
    const sdCard = pool.get(sd.cardId);
    if (!sdCard) return false;
    return ROCKET_WATCHTOWER_STADIUMS.has(sdCard.name);
  };

  // === self-only PASSIVE_DAMAGE_REDUCE + COND ===
  if (dmg > 0 && victimCard.abilities && !_colorlessBlocked(victimCard)) {
    const _vloc: 'active' | 'bench' = defender.active?.iid === victim.iid ? 'active' : 'bench';
    for (const ab of victimCard.abilities) {
      // v5.471：holder 特性被鐵荊棘ex 初始化/暗夜羽擊/黏著束縛等消除 → 跳過此減傷特性
      if (!isAbilityHolderEffective(state, victim, victimCard, defenderIdx, ab.name, _vloc, pool)) continue;
      const reduceN = PASSIVE_DAMAGE_REDUCE.get(ab.name);
      if (reduceN) {
        const before = dmg;
        dmg = Math.max(0, dmg - reduceN);
        if (before > dmg) logs.push(`${ab.name} -${before - dmg}`);
      }
      const condFn = PASSIVE_DAMAGE_REDUCE_COND.get(ab.name);
      if (condFn) {
        const r = condFn(victim, victimCard);
        if (r > 0) {
          const before = dmg;
          dmg = Math.max(0, dmg - r);
          if (before > dmg) logs.push(`${ab.name} -${before - dmg}`);
        }
      }
      // v5.294: 依攻擊者屬性條件減傷 (厚脂肪等)
      const atkFn = PASSIVE_DAMAGE_REDUCE_BY_ATTACKER.get(ab.name);
      if (atkFn) {
        const r = atkFn(victim, victimCard, attackerCard);
        if (r > 0) {
          const before = dmg;
          dmg = Math.max(0, dmg - r);
          if (before > dmg) logs.push(`${ab.name} -${before - dmg}`);
        }
      }
    }
  }
  // === field-wide: 大吾的小碎鑽|岩石宮殿 ===
  if (dmg > 0) {
    const r = steelixPalaceReduce(state, defenderIdx, victimCard, pool);
    if (r > 0) {
      const before = dmg;
      dmg = Math.max(0, dmg - r);
      if (before > dmg) logs.push(`岩石宮殿 -${before - dmg}`);
    }
  }
  // === field-wide: 青銅鐘|守護之鐘 ===
  if (dmg > 0) {
    const r = bronzongShelterReduce(state, defenderIdx, pool);
    if (r > 0) {
      const before = dmg;
      dmg = Math.max(0, dmg - r);
      if (before > dmg) logs.push(`守護之鐘 -${before - dmg}`);
    }
  }
  // === field-wide: 齒輪怪|齒輪塗層 ===
  if (dmg > 0) {
    const r = gearCoatingReduce(state, defenderIdx, victim, pool);
    if (r > 0) {
      const before = dmg;
      dmg = Math.max(0, dmg - r);
      if (before > dmg) logs.push(`齒輪塗層 -${before - dmg}`);
    }
  }
  // === field-wide: 爆炸頭水牛|捲牆 (≥2 隻爆炸頭水牛[依卡名] + 【無】基礎) — v5.614 共用 curlWallReduce ===
  if (dmg > 0) {
    const _cw = curlWallReduce(state, defenderIdx, victimCard, pool);
    if (_cw > 0) {
      const before = dmg;
      dmg = Math.max(0, dmg - _cw);
      if (before > dmg) logs.push(`爆炸頭水牛 捲牆 -${before - dmg}`);
    }
  }
  // === field-wide: 冰雪巨龍|凍原堡壘 (victim 附水能量) ===
  if (dmg > 0) {
    const defAll: CardInstance[] = [
      ...(defender.active ? [defender.active] : []),
      ...defender.bench,
    ];
    const hasFrost = defAll.some(c => {
      const card = pool.get(c.cardId);
      return card?.name === '冰雪巨龍' && card?.abilities?.some(a => a.name === '凍原堡壘');
    });
    if (hasFrost) {
      const hasWaterE = victim.energyAttached.some(e => {
        const ec = pool.get(e.cardId);
        if (!ec || ec.supertype !== 'Energy') return false;
        if (ec.subtype === 'Basic' && (ec.pokemonType === 'Water' || /【水】/.test(ec.name))) return true;
        if (ec.pokemonType === 'Water') return true;
        return false;
      });
      if (hasWaterE) {
        const before = dmg;
        dmg = Math.max(0, dmg - 50);
        if (before > dmg) logs.push(`凍原堡壘 -${before - dmg}`);
      }
    }
  }
  // === stadium: 全金屬實驗室 (-30 對【鋼】) ===
  if (dmg > 0) {
    const sd = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
    if (sd?.name === '全金屬實驗室' && victimCard.pokemonType === 'Metal') {
      const before = dmg;
      dmg = Math.max(0, dmg - 30);
      if (before > dmg) logs.push(`全金屬實驗室 -${before - dmg}`);
    }
    // === stadium: 石之洞窟 (-30 對「大吾的」) ===
    if (sd?.name === '石之洞窟' && victimCard.name.startsWith('大吾的')) {
      const before = dmg;
      dmg = Math.max(0, dmg - 30);
      if (before > dmg) logs.push(`石之洞窟 -${before - dmg}`);
    }
  }
  return { amount: dmg, logs };
}

function hitBenchAll(
  state: GameState,
  attackerIdx: 0 | 1,
  targetIdx: 0 | 1,
  amount: number,
  pool: Map<string, Card>,
  attackLabel: string,
): GameState {
  const target = state.players[targetIdx];
  if (target.bench.length === 0 || amount <= 0) return state;
  let coinWS = state;  // v5.368：thread 擲幣 log（順滑大衣）
  // v3.94：移除 v3.892 入口整段 skip — 改為 loop 內 per-target check（規則寶可夢仍受傷害）。
  //   原本 v3.892 過頭：對手全是非規則寶可夢時直接 skip 整個 picker，玩家連選都選不了。
  //   修法：保留 _attackTimeOppFlowerVeil snapshot 用於「KO 後仍擋」，但只 per-target 擋非規則。

  let morePrizes = 0;
  const newBench: CardInstance[] = [];
  const koDiscards: CardInstance[] = [];
  const koNames: string[] = [];
  const koCards: (Card | undefined)[] = [];  // v2.246 KO cause tracking
  const teraImmunNames: string[] = [];        // v2.260 Bug #3 太晶備戰免疫名單
  const reduceLogs: string[] = [];            // v5.293 特性減傷 log 累積

  for (const c of target.bench) {
    const card = pool.get(c.cardId);
    // v2.260 Bug #3：太晶寶可夢規則 — 在備戰位免疫招式傷害（卡面規則性）
    //   只擋招式傷害（這裡是 hitBenchAll 來自招式），**不擋**特性/效果放置指示物（C-07）
    if (card?.tags?.includes('太晶')) {
      teraImmunNames.push(card.name ?? '?');
      newBench.push(c);  // 保持原狀，不放傷害
      continue;
    }
    // v3.06 斯魔茶｜藏隱 / 小霞的鯉魚王｜深度下潛 —
    //   「只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。」
    //   只在 attackerIdx !== targetIdx（對手對自己施招）時生效；自爆 / 自殘類 self-bench
    //   傷害不擋。
    if (attackerIdx !== targetIdx && _v3060BenchImmAbil(card)) {
      teraImmunNames.push(`${card?.name ?? '?'}（${_v3060GetBenchImmName(card) ?? '備戰免疫'}）`);
      newBench.push(c);
      continue;
    }
    // v3.94 per-target 花之帷幔 check（取代 v3.892 入口整段 skip）：
    //   - 條件：對手對我施招 + 場上目前有花之帷幔謝米 OR attack-time snapshot 為 true
    //   - 目標限制：只擋非規則寶可夢（卡面：「擁有規則的寶可夢除外」）
    //   - snapshot 機制：戰鬥場謝米被同招式 KO 後，state 已沒謝米但 snapshot 仍記得宣告當時有 → 仍擋
    if (
      attackerIdx !== targetIdx
      && (hasFlowerVeil(state, targetIdx, pool) || state._attackTimeOppFlowerVeil)
      && !isExCard(card)
    ) {
      teraImmunNames.push(`${card?.name ?? '?'}（謝米 花之帷幔）`);
      newBench.push(c);
      continue;
    }
    // v5.367/v5.368：hitBenchAll 走 inline guard（不經 resolveBenchGuard）— 補條件式完全免疫
    //   (神秘石居等 boolean) + 擲幣型(順滑大衣)。僅對手對我方時生效。
    if (attackerIdx !== targetIdx) {
      const pbH = passiveImmunityDamageBlock(coinWS, attackerIdx, card, pool);
      if (pbH.blocked) { teraImmunNames.push(`${card?.name ?? '?'}（${pbH.reason}）`); newBench.push(c); continue; }
      const coinH = passiveCoinImmunity(coinWS, attackerIdx, card, pool);
      coinWS = coinH.state;
      if (coinH.immune) { teraImmunNames.push(`${card?.name ?? '?'}（擲幣免疫正面）`); newBench.push(c); continue; }
    }
    // v5.293/v5.294 bench 招式傷害套特性減傷 (含厚脂肪等 BY_ATTACKER)
    let perAmt = amount;
    if (perAmt > 0 && card) {
      const r = _applyBenchAbilityReduce(state, c, card, targetIdx, attackerIdx, pool, perAmt);
      perAmt = r.amount;
      if (r.logs.length > 0) {
        reduceLogs.push(`${card.name}：${r.logs.join('、')}`);
      }
    }
    const newDmg = c.damage + perAmt;
    const hp = effectiveHPInline(c, pool, state);
    if (hp > 0 && newDmg >= hp) {
      koDiscards.push({ ...c, damage: newDmg });
      for (const e of c.energyAttached) koDiscards.push(e);
      // v3.20 多重轉接：iterate 所有道具
      for (const t of getAllAttachedTools(c)) koDiscards.push(t);
      for (const prev of c.evolvedFromStack ?? []) koDiscards.push(prev);
      if (card) {
        if (attackerIdx !== targetIdx) {
          const _ko = koPrizesAdjusted(coinWS, c, card, attackerIdx, targetIdx, pool);
          morePrizes += _ko.prizes; coinWS = _ko.state;
        } else morePrizes += koPrizeCount(card);
      }
      koNames.push(card?.name ?? '?');
      koCards.push(card);
    } else {
      newBench.push({ ...c, damage: newDmg });
    }
  }

  const players = [...coinWS.players] as [PlayerState, PlayerState];
  players[targetIdx] = {
    ...target,
    bench: newBench,
    discard: [...target.discard, ...koDiscards],
  };

  const who = targetIdx === attackerIdx ? '自己' : '對手';
  let s: GameState = { ...coinWS, players };
  s = addLog(s, `${attackLabel}：對${who}所有備戰寶可夢各造成 ${amount} 傷害`, attackerIdx);
  // v5.293 特性減傷 log
  if (reduceLogs.length > 0) {
    s = addLog(s, `${attackLabel} 特性減傷：${reduceLogs.join('；')}`, attackerIdx);
  }
  // v2.260 Bug #3：太晶寶可夢備戰免疫日誌
  if (teraImmunNames.length > 0) {
    s = addLog(s, `${attackLabel}：${teraImmunNames.join('、')} 為太晶寶可夢，在備戰位免疫招式傷害`, null);
  }
  if (koNames.length > 0) {
    s = addLog(s, `${attackLabel}：${koNames.join('、')} 被擊倒，${state.players[attackerIdx].name} 額外取得 ${morePrizes} 張獎賞卡`, null);
    s = addPendingPrize(s, attackerIdx, morePrizes, pool);
    // v2.246 KO cause tracking — 每隻 KO 都登錄為招式 KO（self-KO 由 recordOppKO 內部 skip）
    for (const card of koCards) {
      s = recordOppKO(s, targetIdx, card, 'attack');
    }
  }
  return s;
}

/**
 * 對指定方的備戰寶可夢挑選 count 隻，各施加 amount 傷害。
 * 透過 pendingSelection（'bench-choose' / 'opp-bench-choose'）讓玩家選擇。
 * 挑選完後由 `bench-hit-N` resolver 施加傷害 / KO 判定。
 *
 * 若備戰數量不足 count，會改為 min(備戰數, count)；為 0 則直接返回（無動作）。
 */
export function hitBenchPickPost(
  state: GameState,
  attackerIdx: 0 | 1,
  targetSide: 'self' | 'opp',
  count: number,
  amount: number,
  attackLabel: string,
): GameState {
  const targetIdx = (targetSide === 'opp' ? (1 - attackerIdx) : attackerIdx) as 0 | 1;
  const target = state.players[targetIdx];
  if (target.bench.length === 0 || amount <= 0 || count <= 0) return state;
  // v3.94：移除 v3.892 入口整段 skip — picker 仍正常開，玩家可選任何備戰目標
  //   - 玩家選非規則寶可夢：bench-hit-N resolver 內 per-target resolveBenchGuard 擋（v3.888 + v3.94 snapshot fallback）
  //   - 玩家選 ex/V 等規則寶可夢：花之帷幔擋不到 → 造成傷害（玩家應有此選擇權）
  const pickCount = Math.min(count, target.bench.length);
  const pendingType: PendingSelection['type'] = targetSide === 'opp' ? 'opp-bench-choose' : 'bench-choose';
  let s = addLog(state, `${attackLabel}：選擇 ${pickCount} 隻${targetSide === 'opp' ? '對手' : '自己'}備戰寶可夢，各造成 ${amount} 傷害`, attackerIdx);
  return withPending(s, {
    type: pendingType,
    actorIdx: attackerIdx,
    sourcePlayerIdx: targetIdx,
    minCount: pickCount,
    maxCount: pickCount,
    effectKey: 'bench-hit-N',
    params: { amount, attackLabel, targetIdx },
  });
}

/**
 * 通用 resolver：對 selectedIids 指到的 bench 寶可夢各施加 params.amount 傷害，
 * 處理 KO + 棄牌遷移 + pendingPrizes 累計。
 * 支援「挑自己備戰」或「挑對手備戰」（sourcePlayerIdx 決定）。
 */
regR('bench-hit-N', (st, actorIdx, selectedIids, params, pool) => {
  const amount = Number(params?.amount ?? 0);
  const label = String(params?.attackLabel ?? '招式');
  const targetIdx = ((params?.targetIdx ?? (1 - actorIdx)) as 0 | 1);
  if (amount <= 0 || selectedIids.length === 0) return st;
  // v3.894：移除 v2.22 在此處加的 isBenchProtected check（語意錯誤）。
  //   bench-hit-N 是 hitBenchPickPost 用的 resolver，處理「對備戰造成 N 點傷害」
  //   — 屬於【招式傷害 attack-damage】(卡面：「受到 N 點傷害」)，不是「招式效果 attack-effect」。
  //   對戰圓形競技場只擋【招式效果】/【特性效果】（放指示物 / 異常狀態），不擋招式傷害。
  //   下方 v3.888 加的 per-target resolveBenchGuard(kind='attack-damage') 會按規則正確擋
  //   花之帷幔 / 太晶 / 球形盾牌 / 藏隱 / 深度下潛 / 羽毛化石（這些才擋招式傷害）。
  //   玩家回報：激流水泵對備戰 120（attack-damage）被誤判為對戰圓形擋住。
  const target = st.players[targetIdx];

  let morePrizes = 0;
  const newBench: CardInstance[] = [];
  const koDiscards: CardInstance[] = [];
  const hitNames: string[] = [];
  const koNames: string[] = [];
  const koCards: (Card | undefined)[] = [];  // v2.246 KO cause tracking
  const teraImmunNames: string[] = [];        // v2.260 Bug #3 太晶備戰免疫名單
  const benchReduceLogs: string[] = [];       // v5.293 特性減傷 log
  const hitSet = new Set(selectedIids);

  // v3.888：每隻 hit target 各別 check resolveBenchGuard（花之帷幔 / 抵抗之幕 / 藏隱 / 深度下潛 / 球形盾牌 / 羽毛化石 等）
  //   原 v2.22 只擋對戰圓形（整體 sweep）和太晶（per-target），漏了 resolveBenchGuard 整套。
  //   玩家回報 精神尖槍 攻擊 謝米花之帷幔備戰 沒擋住 — 因為 bench-hit-N resolver 沒呼叫 resolveBenchGuard。
  const guardBlockedLog: string[] = [];
  for (const c of target.bench) {
    if (!hitSet.has(c.iid)) { newBench.push(c); continue; }
    const card = pool.get(c.cardId);
    // v2.260 Bug #3：太晶寶可夢規則 — 在備戰位免疫招式傷害（卡面規則性）
    if (card?.tags?.includes('太晶')) {
      teraImmunNames.push(card.name ?? '?');
      newBench.push(c);
      continue;
    }
    // v3.888：resolveBenchGuard 檢查 — 花之帷幔 / 抵抗之幕 / 藏隱 / 球形盾牌 等
    //   targetIdx !== actorIdx 才檢查（自己自殘類不擋）
    if (targetIdx !== actorIdx) {
      const g = resolveBenchGuard(st, pool, actorIdx, card, 'attack-damage');
      if (g.blocked) {
        guardBlockedLog.push(`${card?.name ?? '?'}：${g.reason}`);
        newBench.push(c);
        continue;
      }
    }
    // v5.368：順滑大衣等擲幣型免疫 — 備戰也適用，真結算擲幣
    if (targetIdx !== actorIdx) {
      const coinBH = passiveCoinImmunity(st, actorIdx, card, pool);
      st = coinBH.state;
      if (coinBH.immune) { guardBlockedLog.push(`${card?.name ?? '?'}：擲幣免疫（正面）`); newBench.push(c); continue; }
    }
    // v5.293/v5.294 bench 招式傷害套特性減傷 (含厚脂肪等 BY_ATTACKER)
    let perAmt = amount;
    if (perAmt > 0 && card) {
      const r = _applyBenchAbilityReduce(st, c, card, targetIdx, actorIdx, pool, perAmt);
      perAmt = r.amount;
      if (r.logs.length > 0) {
        benchReduceLogs.push(`${card.name}：${r.logs.join('、')}`);
      }
    }
    const newDmg = c.damage + perAmt;
    const hp = effectiveHPInline(c, pool, st);
    if (hp > 0 && newDmg >= hp) {
      koDiscards.push({ ...c, damage: newDmg });
      for (const e of c.energyAttached) koDiscards.push(e);
      // v3.20 多重轉接：iterate 所有道具
      for (const t of getAllAttachedTools(c)) koDiscards.push(t);
      for (const prev of c.evolvedFromStack ?? []) koDiscards.push(prev);
      if (card) {
        if (actorIdx !== targetIdx) {
          const _ko = koPrizesAdjusted(st, c, card, actorIdx, targetIdx, pool);
          morePrizes += _ko.prizes; st = _ko.state;
        } else morePrizes += koPrizeCount(card);
      }
      koNames.push(card?.name ?? '?');
      koCards.push(card);
    } else {
      newBench.push({ ...c, damage: newDmg });
      hitNames.push(card?.name ?? '?');
    }
  }

  const players = [...st.players] as [PlayerState, PlayerState];
  players[targetIdx] = { ...target, bench: newBench, discard: [...target.discard, ...koDiscards] };

  let s: GameState = { ...st, players };
  // v3.888：log 被 resolveBenchGuard 擋下的目標（花之帷幔 / 抵抗之幕 等）
  if (guardBlockedLog.length > 0) {
    s = addLog(s, `${label}：以下備戰寶可夢免疫此招式傷害 — ${guardBlockedLog.join('；')}`, actorIdx);
  }
  if (hitNames.length > 0) {
    s = addLog(s, `${label}：對 ${hitNames.join('、')} 造成 ${amount} 傷害`, actorIdx);
  }
  // v5.293 特性減傷 log
  if (benchReduceLogs.length > 0) {
    s = addLog(s, `${label} 特性減傷：${benchReduceLogs.join('；')}`, actorIdx);
  }
  // v2.260 Bug #3：太晶寶可夢備戰免疫日誌
  if (teraImmunNames.length > 0) {
    s = addLog(s, `${label}：${teraImmunNames.join('、')} 為太晶寶可夢，在備戰位免疫招式傷害`, null);
  }
  if (koNames.length > 0) {
    s = addLog(s, `${label}：${koNames.join('、')} 被擊倒，${st.players[actorIdx].name} 額外取得 ${morePrizes} 張獎賞卡`, null);
    s = addPendingPrize(s, actorIdx, morePrizes, pool);
    // v2.246 KO cause tracking — 每隻 KO 都登錄為招式 KO（self-KO 由 recordOppKO 內部 skip）
    for (const card of koCards) {
      s = recordOppKO(s, targetIdx, card, 'attack');
    }
  }
  return s;
});

// ── MBD 超級蒂安希ex ──────────────────────────────────────────────────────────

// 花冠射線 — 玩家選擇丟 0~2 個自身能量，造成張數×120 傷害
// UI：ATTACK_PRE_DISCARD_CHOICE 登錄後，按下招式會彈出能量選擇 modal。
// AI / 舊流程（action 未帶 iids）：退回自動丟棄至多 2 個的舊邏輯，保持向後相容。
ATTACK_PRE_DISCARD_CHOICE.set('超級蒂安希ex|花冠射線', {
  min: 0,
  max: 2,
  scope: 'attacker',
  baseDamage: 0,
  damagePerEnergy: 120,
});
regPre('超級蒂安希ex|花冠射線', (state, aIdx, _pool, action) => {
  const player = state.players[aIdx];
  if (!player.active) return { state, damage: 0 };
  const energies = player.active.energyAttached;

  const chosenIids = action?.discardedEnergyIids;
  let discarded: CardInstance[];
  let remaining: CardInstance[];
  if (chosenIids && chosenIids.length > 0) {
    // 限制最多 2 張，且只認得攻擊方出場身上的能量
    const allowed = new Set(energies.map(e => e.iid));
    const capped = chosenIids.filter(id => allowed.has(id)).slice(0, 2);
    const chosenSet = new Set(capped);
    discarded = energies.filter(e => chosenSet.has(e.iid));
    remaining = energies.filter(e => !chosenSet.has(e.iid));
  } else {
    // Fallback：自動丟最多 2 張（舊行為）
    const discardCount = Math.min(2, energies.length);
    discarded = energies.slice(-discardCount);
    remaining = energies.slice(0, energies.length - discardCount);
  }

  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : null,
    discard: [...p.discard, ...discarded],
  }));
  const dmg = discarded.length * 120;
  s = addLog(s, `花冠射線：丟棄 ${discarded.length} 個能量，造成 ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ── MBD 霜奶仙 ────────────────────────────────────────────────────────────────

// 甜點圓陣 — 自己場上寶可夢數量×20
regPre('霜奶仙|甜點圓陣', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const count = (p.active ? 1 : 0) + p.bench.length;
  return { state, damage: count * 20 };
});

// ── MBD 布魯皇 ────────────────────────────────────────────────────────────────

// 致命刺擊 — 若對手戰鬥寶可夢有傷害指示物，+90 傷害
regPre('布魯皇|致命刺擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defenderDamaged = (state.players[dIdx].active?.damage ?? 0) > 0;
  return { state, damage: 90 + (defenderDamaged ? 90 : 0) };
});

// ── MBG 黑暗鴉 ────────────────────────────────────────────────────────────────

// 伏擊 — 擲硬幣，正面 +20
regPre('黑暗鴉|伏擊', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '伏擊', aIdx);
  const dmg = 10 + (r.heads ? 20 : 0);
  return { state: addLog(r.state, `伏擊：${r.heads ? '+20' : '無加成'} → ${dmg} 傷害`, aIdx), damage: dmg };
});

// ── MBG 烏鴉頭頭 ──────────────────────────────────────────────────────────────

// 狙擊羽毛 — 丟棄 2 個能量，對對手任意1隻寶可夢造成 120 傷害（含出場）
// PRE：丟棄 2 個能量，回傳 damage=0（傷害由 POST 處理，不對出場造成傷害）
regPre('烏鴉頭頭|狙擊羽毛', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active) return { state, damage: 0 };
  const energies = player.active.energyAttached;
  if (energies.length < 2) return { state, damage: 0 };
  const discarded = energies.slice(-2);
  const remaining = energies.slice(0, energies.length - 2);
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : null,
    discard: [...p.discard, ...discarded],
  }));
  s = addLog(s, '狙擊羽毛：丟棄 2 個能量', aIdx);
  return { state: s, damage: 0 };
});

// POST：選擇對手任意寶可夢，造成 120 傷害
regPost('烏鴉頭頭|狙擊羽毛', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  if (defender.bench.length === 0 && defender.active) {
    // 無備戰，直接對出場施加 120 傷害
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + 120;
    const defHP = defCard?.hp ?? 0;
    if (defHP > 0 && newDmg >= defHP) {
      const koDiscard: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...getAllAttachedTools(defender.active),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...koDiscard] };
      const _ko = koPrizesAdjusted(state, defender.active, defCard, (1 - dIdx) as 0 | 1, dIdx, pool);
      state = _ko.state;
      const prizes = _ko.prizes;
      let s = addLog({ ...state, players }, `狙擊羽毛：120 傷害擊倒 ${defCard?.name ?? '?'}！${state.players[aIdx].name} 取得 ${prizes} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, defCard, 'attack');
      s = fireDefenderOnKO(s, dIdx, (1 - dIdx) as 0 | 1, pool, koDiscard[0], true, true);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return addPendingPrize(s, aIdx, prizes, pool);
    } else {
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: { ...defender.active!, damage: newDmg } };
      return addLog({ ...state, players }, `狙擊羽毛：對 ${defCard?.name ?? '?'} 造成 120 傷害！`, aIdx);
    }
  }
  // 有備戰，讓玩家選擇目標（含出場）
  let s = addLog(state, '狙擊羽毛：選擇對手任意寶可夢造成 120 傷害', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-120',
    params: { includeActive: true },
  });
});

regR('snipe-120', (st, actorIdx, selectedIids, _params, pool) => {
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  // v5.440：改走中央 dealAttackDamageToTarget — 補 active 弱點(卡面僅備戰不計弱抗) + 受傷反擊。
  return dealAttackDamageToTarget(st, actorIdx, targetIid, 120, pool, { kind: 'attack-damage', label: '狙擊羽毛' });
});

// ── MBG 勾魂眼 ────────────────────────────────────────────────────────────────

// 動怒爪 — 自己備戰區有惡屬性2階進化寶可夢，+70
regPre('勾魂眼|動怒爪', (state, aIdx, pool) => {
  const hasStage2Dark = state.players[aIdx].bench.some(c => {
    const card = pool.get(c.cardId);
    if (card?.pokemonType !== 'Darkness') return false;
    // Stage 2 判斷：evolvesFrom 存在且該 Stage1 也有 evolvesFrom（含 ex 類型的 Stage2）
    if (!card.evolvesFrom) return false;
    for (const p of pool.values()) {
      if (sameEvoName(p.name, card.evolvesFrom) && p.supertype === 'Pokemon' && p.evolvesFrom) return true;
    }
    return false;
  });
  return { state, damage: 20 + (hasStage2Dark ? 70 : 0) };
});

// ── MBG 桃歹郎ex ──────────────────────────────────────────────────────────────

// 煩煩爆炸 — 對手已取的獎賞卡數×60
regPre('桃歹郎ex|煩煩爆炸', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  return { state, damage: taken * 60 };
});

// ── MBG 阿勃梭魯 ──────────────────────────────────────────────────────────────

// 吸引 — 抽 2 張（POST，無傷害）
regPost('阿勃梭魯|吸引', (state, aIdx, _pool) => {
  let s = addLog(state, '吸引：從牌庫抽 2 張', aIdx);
  return updatePlayer(s, aIdx, p => {
    const n = Math.min(2, p.deck.length);
    return { ...p, hand: [...p.hand, ...p.deck.slice(0, n)], deck: p.deck.slice(n) };
  });
});

// ── MBD 小仙奶 ────────────────────────────────────────────────────────────────

// 吸取之吻 — 自身回復 10 HP
regPost('小仙奶|吸取之吻', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: Math.max(0, p.active.damage - 10) } };
  });
});

// ── MBG 超級耿鬼ex ────────────────────────────────────────────────────────────

// 空無強風 — 選 1 個自身能量，改附於備戰寶可夢（自動取最後 1 個能量，讓玩家選備戰目標）
regPost('超級耿鬼ex|空無強風', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active || player.active.energyAttached.length === 0) return state;
  if (player.bench.length === 0) {
    return addLog(state, '空無強風：備戰區沒有寶可夢，能量留在原位', aIdx);
  }
  const energies = player.active.energyAttached;
  const energyToMove = energies[energies.length - 1];
  // 從出場移除能量
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) } : null,
  }));
  s = addLog(s, '空無強風：選擇將能量附於哪隻備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gengar-move-energy',
    params: { energyIid: energyToMove.iid, energyCardId: energyToMove.cardId },
  });
});

regR('gengar-move-energy', (st, idx, iids, params, pool) => {
  const energyIid    = params?.energyIid    as string | undefined;
  const energyCardId = params?.energyCardId as string | undefined;
  if (!energyIid || !energyCardId || iids.length === 0) return st;
  const targetIid = iids[0];
  const target = st.players[idx].bench.find(c => c.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  const energyName = pool.get(energyCardId)?.name ?? '能量';
  st = addLog(st, `空無強風：將 ${energyName} 附加到 ${targetName}`, idx);
  // 重建能量 CardInstance（基本能量無狀態，iid 與 cardId 即可還原）
  const energyCard: CardInstance = { iid: energyIid, cardId: energyCardId, damage: 0, energyAttached: [] };
  return updatePlayer(st, idx, p => ({
    ...p,
    bench: p.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyCard] }
      : c),
  }));
});

// ── MBD 克雷色利亞 ────────────────────────────────────────────────────────────

// 充溢之光 — 從牌庫選最多 2 張基本能量，附於自身（POST；無傷害）
regPost('克雷色利亞|充溢之光', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '充溢之光：牌庫為空', aIdx);
  let s = addLog(state, '充溢之光：從牌庫選最多 2 張基本能量附於自身', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    // v2.40：卡面僅限基本能量；原本寫 'Energy' 會讓 UI 列出 Special Energy。
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 2,
    effectKey: 'cresselia-attach-energy',
  });
});

regR('cresselia-attach-energy', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const player = st.players[idx];
  if (!player.active) return st;
  const activeName = pool.get(player.active.cardId)?.name ?? '出場寶可夢';
  const chosenInst = player.deck.filter(c => iids.includes(c.iid));
  const names = chosenInst.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `充溢之光：將 ${names} 附加到 ${activeName}`, idx);
  return updatePlayer(st, idx, p => {
    if (!p.active) return p;
    const chosen   = p.deck.filter(c => iids.includes(c.iid));
    const newDeck  = p.deck.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck:   shuffle(newDeck),
      active: { ...p.active, energyAttached: [...p.active.energyAttached, ...chosen] },
    };
  });
});

// ── MBD 美洛耶塔 ──────────────────────────────────────────────────────────────

// 治癒旋律 — 選備戰超寶可夢，回復 120 HP（POST；無傷害）
regPost('美洛耶塔|治癒旋律', (state, aIdx, pool) => {
  const bench = state.players[aIdx].bench;
  const psychicBench = bench.filter(c => (pool.get(c.cardId)?.pokemonType) === 'Psychic');
  if (psychicBench.length === 0) {
    return addLog(state, '治癒旋律：備戰區沒有超屬性寶可夢', aIdx);
  }
  let s = addLog(state, '治癒旋律：選擇回復 120 HP 的備戰超寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-120-bench',
    params: { validIids: psychicBench.map(c => c.iid) },
  });
});

regR('heal-120-bench', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const target = st.players[idx].bench.find(c => c.iid === targetIid);
  if (target) {
    const name = pool.get(target.cardId)?.name ?? '?';
    const actualHeal = Math.min(target.damage, 120);
    st = addLog(st, `→ ${name} 回復 ${actualHeal} HP`, idx);
  }
  return updatePlayer(st, idx, p => ({
    ...p,
    bench: p.bench.map(c => c.iid === targetIid
      ? { ...c, damage: Math.max(0, c.damage - 120) }
      : c),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 道具卡（Tool Card）附加 — v2.09 搬到 effects/cards/tools.ts
// ══════════════════════════════════════════════════════════════════════════════
// toolAttachEffect helper、reg('氣球'/'龐克頭盔')、regR('attach-tool') 以及
// TOOL_* 所有登錄均已搬遷。見 effects/cards/tools.ts 與本檔頂部的 side-effect
// import './effects/cards/tools'。

// ══════════════════════════════════════════════════════════════════════════════
// 神奇糖果（Rare Candy）
// ══════════════════════════════════════════════════════════════════════════════

// 神奇糖果 Guard：手牌中有「Stage2」且場上有其對應 Basic 目標才可打出
// v5.007：青銅鐘｜進化妨礙者 鎖「從手牌使出寶可夢並完成進化」— 神奇糖果效果是從手牌
//        打 Stage 2 上場進化，屬於同一機制，必須一起擋。卡面文字相符：玩家從手牌使出
//        進化卡（Stage 2）放置於 Basic 寶可夢身上 = 從手牌完成進化。
regG('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  // v5.007：青銅鐘｜進化妨礙者 / 其他 cantEvolve 機制 — 鎖手牌進化
  if (p.cantEvolveThisTurn) return false;
  const isStage2 = (c?: Card) => {
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) return false;
    for (const x of pool.values()) {
      if (sameEvoName(x.name, c.evolvesFrom) && x.supertype === 'Pokemon' && x.evolvesFrom) return true;
    }
    return false;
  };
  const stage2sInHand = p.hand.filter(i => isStage2(pool.get(i.cardId)));
  if (stage2sInHand.length === 0) return false;
  const fieldPokes = [...(p.active ? [p.active] : []), ...p.bench];
  // 至少一張 Stage2 有合法 Basic 目標（Stage2→Stage1→Basic 鏈結完整，場上有該 Basic 且可進化）
  return stage2sInHand.some(hand => {
    const s2 = pool.get(hand.cardId)!;
    let basicName: string | undefined;
    for (const c of pool.values()) {
      if (sameEvoName(c.name, s2.evolvesFrom) && c.supertype === 'Pokemon' && c.evolvesFrom) {
        basicName = c.evolvesFrom;
        break;
      }
    }
    if (!basicName) return false;
    return fieldPokes.some(pk => {
      const bc = pool.get(pk.cardId);
      return !!bc && sameEvoName(bc.name, basicName) && !pk.justPlaced && !pk.evolvedThisTurn;
    });
  });
});

reg('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  // 只列出手牌中的「Stage2」寶可夢（含 Stage2 ex）
  const isStage2 = (c?: Card) => {
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) return false;
    for (const x of pool.values()) {
      if (sameEvoName(x.name, c.evolvesFrom) && x.supertype === 'Pokemon' && x.evolvesFrom) return true;
    }
    return false;
  };
  // v5.340：只列出「在場上有合法【基礎】目標」的 Stage2（鏡射 guard + rare-candy-choose-target
  //   的鏈結判定）。原本只 filter isStage2 → 手牌有多張 Stage2 時會把「場上沒有對應基礎」那張也
  //   列出，玩家選到它 → 神奇糖果已打出被棄、卻無法進化 → 卡白白消耗（依規則不該能這樣用）。
  const rcFieldPokes = [...(p.active ? [p.active] : []), ...p.bench];
  const rcHasFieldBasic = (s2c: Card): boolean => {
    const stage1Name = s2c.evolvesFrom;
    let basicName: string | undefined;
    for (const [, c] of pool) {
      if (sameEvoName(c.name, stage1Name ?? '') && c.evolvesFrom) { basicName = c.evolvesFrom; break; }
    }
    if (!basicName) basicName = stage1Name;  // fallback：Stage2 直接 evolvesFrom 基礎（同 resolver）
    if (!basicName) return false;
    return rcFieldPokes.some(pk => {
      if (pk.justPlaced || pk.evolvedThisTurn) return false;
      const bc = pool.get(pk.cardId);
      return !!bc && sameEvoName(bc.name, basicName!);
    });
  };
  const validIids = p.hand
    .filter(inst => { const c = pool.get(inst.cardId); return !!c && isStage2(c) && rcHasFieldBasic(c); })
    .map(i => i.iid);
  if (validIids.length === 0) return addLog(st, '神奇糖果：手牌中沒有可進化的寶可夢（場上沒有對應的基礎）', idx);
  st = addLog(st, '神奇糖果：從手牌選擇要進化的 2 階寶可夢', idx);
  return withPending(st, {
    type: 'hand-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'rare-candy-choose-target',
    params: { validIids },
  });
});

regR('rare-candy-choose-target', (st, idx, picked, _params, pool) => {
  const stage2Iid = picked[0];
  const p = st.players[idx];
  const stage2Inst = p.hand.find(i => i.iid === stage2Iid);
  if (!stage2Inst) return st;
  const stage2Card = pool.get(stage2Inst.cardId);
  if (!stage2Card?.evolvesFrom) return st;

  // Chain: basic → stage1 (evolvesFrom=basic) → stage2 (evolvesFrom=stage1)
  const stage1Name = stage2Card.evolvesFrom;
  let basicName: string | undefined;
  for (const [, c] of pool) {
    if (sameEvoName(c.name, stage1Name) && c.evolvesFrom) { basicName = c.evolvesFrom; break; }
  }
  // Fallback: stage2 directly evolvesFrom a basic
  if (!basicName) basicName = stage1Name;

  const fieldPokes = [...(p.active ? [p.active] : []), ...p.bench];
  // v3.823 fix：卡面明文「放置於可進化成那隻寶可夢的【基礎】寶可夢身上」— 只能選基礎，不能選 1 階。
  //   原 filter 用 `sameEvoName(c.name, basicName) || sameEvoName(c.name, stage1Name)` 是違規：
  //   stage1 進到場上即不可再用神奇糖果（神奇糖果 skip stage1 的設計就是給「基礎」直接跳到 stage2）。
  //   範例：場上 多龍梅西亞（基礎）+ 多龍奇（1階） → 選多龍巴魯托ex 後，只允許多龍梅西亞當 target。
  const validIids = fieldPokes
    .filter(pk => {
      if (pk.justPlaced || pk.evolvedThisTurn) return false;
      const c = pool.get(pk.cardId);
      return !!c && sameEvoName(c.name, basicName);
    })
    .map(pk => pk.iid);

  if (validIids.length === 0) return addLog(st, '神奇糖果：場上沒有可接受神奇糖果的寶可夢', idx);

  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'rare-candy-evolve',
    params: { stage2Iid, validIids },
  });
});

regR('rare-candy-evolve', (st, idx, picked, params, pool) => {
  const targetIid = picked[0];
  const stage2Iid = params?.stage2Iid as string;

  const prevPlayer = st.players[idx];
  const stage2InstPrev = prevPlayer.hand.find(i => i.iid === stage2Iid);
  const baseInstPrev = prevPlayer.active?.iid === targetIid
    ? prevPlayer.active
    : prevPlayer.bench.find(b => b.iid === targetIid);
  // v5.332 防呆：pending 設定後，進化目標基礎寶可夢可能已被其他動作進化/換位/移除（進化會把
  //   場上 instance 換成新 iid → 原 targetIid 失效）。此時 stage2InstPrev 或 baseInstPrev 為空，
  //   原邏輯仍會把 Stage2 從手牌移除卻沒放上場 → 進化卡憑空消失（玩家回報根因）。
  //   修法：任一不存在 → 中止進化且「不移除手牌 Stage2」，進化卡保留在手牌。
  if (!stage2InstPrev || !baseInstPrev) {
    return addLog(st, '神奇糖果：進化目標已不在場上，取消進化（進化卡保留在手牌）', idx);
  }
  const stage2Name = pool.get(stage2InstPrev.cardId)?.name ?? '?';
  const baseName = pool.get(baseInstPrev.cardId)?.name ?? '?';
  st = addLog(st, `神奇糖果：${baseName} 直接進化為 ${stage2Name}！`, idx);

  let result = updatePlayer(st, idx, p => {
    const stage2Inst = p.hand.find(i => i.iid === stage2Iid);
    if (!stage2Inst) return p;

    const evolve = (pk: CardInstance): CardInstance => {
      if (pk.iid !== targetIid) return pk;
      const baseBare: CardInstance = {
        ...pk,
        energyAttached: [],
        toolAttached: undefined, extraTools: [],
        evolvedFromStack: undefined,
      };
      // v5.738：進化(含神奇糖果)清除特殊狀態(PDF §I-A-05) — 原 `status: pk.status` 把基底
      //   混亂/睡眠/麻痺/中毒/灼傷一併帶到進化體(玩家回報「神奇糖果進化無法解除混亂」)。
      //   清全部狀態(status/secondary/tertiary 從 stage2Inst 繼承 default=無),唯暈眩山谷在場且
      //   基底為混亂時保留混亂(同正常 EVOLVE 的 preserveConfusion 例外)。
      const dazeStadium = st.activeStadium ? pool.get(st.activeStadium.cardId)?.name : null;
      const preserveConfusion = dazeStadium === '暈眩山谷' && pk.status === 'confused';
      return {
        ...stage2Inst,
        damage: pk.damage,
        energyAttached: pk.energyAttached,
        toolAttached: pk.toolAttached,
        extraTools: pk.extraTools,
        ...(preserveConfusion ? { status: 'confused' as const } : {}),
        evolvedFromIid: pk.iid,
        // 神奇糖果跳過 Stage 1，進化鏈只含 Basic
        evolvedFromStack: [...(pk.evolvedFromStack ?? []), baseBare],
        evolvedThisTurn: true,
        justPlaced: false,
      };
    };

    return {
      ...p,
      hand: p.hand.filter(i => i.iid !== stage2Iid),
      active: p.active ? evolve(p.active) : null,
      bench: p.bench.map(evolve),
    };
  });

  // v2.322：神奇糖果進化後也要觸發「進化時」特性（龐克練肌、精神抽出等）
  const evolvedPlayer = result.players[idx];
  const evolvedInst = evolvedPlayer.active?.cardId === stage2InstPrev?.cardId
    ? evolvedPlayer.active
    : evolvedPlayer.bench.find(c => c.cardId === stage2InstPrev?.cardId && c.evolvedThisTurn);
  if (evolvedInst && stage2InstPrev) {
    const evoCard = pool.get(stage2InstPrev.cardId);
    if (evoCard) {
      result = promptPlayAbilities(result, idx as 0 | 1, evoCard, evolvedInst, pool, true);
    }
  }

  return result;
});

// ══════════════════════════════════════════════════════════════════════════════
// 神秘花園（Stadium）→ v2.10 搬到 effects/cards/stadiums.ts
// ══════════════════════════════════════════════════════════════════════════════
// miracle-garden-draw regR 已移至 stadiums.ts

// ── MBG 無極汰那 ─────────────────────────────────────────────────────────────

// 敲壞 — 丟棄場上競技場（v2.244：丟回擁有者棄牌堆）
regPost('無極汰那|敲壞', (state, aIdx, pool) => {
  if (!state.activeStadium) return addLog(state, '敲壞：場上沒有競技場', aIdx);
  const stadiumName = pool.get(state.activeStadium.cardId)?.name ?? '競技場';
  return addLog(discardActiveStadium(state, aIdx), `敲壞：${stadiumName} 被丟棄！`, aIdx);
});

// 力量猛攻 — 擲硬幣，反面則下回合無法使用招式
regPost('無極汰那|力量猛攻', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '力量猛攻', aIdx);
  if (!r.heads) {
    // tails → can't attack next turn (用 pending，將在擁有者下個回合開始時 promote)
    const players = [...r.state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    if (p.active) p.active = { ...p.active, cantAttackPending: true };
    players[aIdx] = p;
    return addLog({ ...r.state, players }, '力量猛攻：反面 → 下回合無法使用招式', aIdx);
  }
  return addLog(r.state, '力量猛攻：正面 → 無附加效果', aIdx);
});

// ── MBD 拉帝亞斯ex ──────────────────────────────────────────────────────────

// 無限之刃 — 使用後下回合無法攻擊
regPost('拉帝亞斯ex|無限之刃', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) p.active = { ...p.active, cantAttackPending: true };
  players[aIdx] = p;
  return addLog({ ...state, players }, '無限之刃：下回合無法使用招式。', aIdx);
});

// ── MBD 謎擬Q ─────────────────────────────────────────────────────────────────

// 呼朋引伴 — 從牌庫選 1 隻基礎寶可夢放備戰（POST；無傷害）
// v5.040：bench >= 5 改 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
regPost('謎擬Q|呼朋引伴', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (player.bench.length >= getOwnBenchLimit(state, aIdx, pool)) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  if (player.deck.length === 0) return addLog(state, '呼朋引伴：牌庫為空', aIdx);
  // v2.993：卡面寫「選擇 1 張」mandatory；若牌庫無基礎寶可夢則允許 Pass
  const hasBasic = player.deck.some(c => {
    const card = pool.get(c.cardId);
    // v3.46：PTCG 基礎寶可夢判定（含 ex 等）
    if (card?.supertype !== 'Pokemon') return false;
    if (card.subtype === 'Stage1' || card.subtype === 'Stage2' || card.subtype === 'Other') return false;
    return !card.evolvesFrom;
  });
  let s = addLog(state, '呼朋引伴：從牌庫選 1 隻基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'bench-basic-from-deck', // 複用好友寶芬的 resolver
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 主動特性（USE_ABILITY 觸發）
// ══════════════════════════════════════════════════════════════════════════════

// ABILITY_EFFECTS / regA 已於 v2.64 搬到 ./effects/_shared.ts，
// 本檔於最上方 import 並 re-export。

// ── 米立龍「集客」──────────────────────────────────────────────────────────────
// 若在戰鬥場上，每回合 1 次：查看牌庫頂 6 張，取 1 張支援者加手牌，其餘洗回。
regA('米立龍', 0, (st, idx) => {
  const p = st.players[idx];
  const top6 = p.deck.slice(0, 6);
  if (top6.length === 0) return addLog(st, '集客：牌庫為空', idx);
  st = addLog(st, '集客：查看牌庫頂 6 張，選 1 張支援者加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter:TOP6',
    minCount: 0, maxCount: 1,
    effectKey: 'fetch-supporter',
    params: { top6Iids: top6.map(c => c.iid) },
  });
});

regR('fetch-supporter', (st, idx, iids, params, pool) => {
  const top6Iids = (params?.top6Iids as string[]) ?? [];
  let s = st;
  // v2.991：卡面「在給對手看過後加入手牌」— 公開揭示所選支援者（Iron Rule 8）
  if (iids.length > 0) {
    const p = s.players[idx];
    const chosenInst = p.deck.find(c => c.iid === iids[0]);
    const cardName = chosenInst ? (pool.get(chosenInst.cardId)?.name ?? '?') : '?';
    s = addLog(s, `集客：將「${cardName}」加入手牌（給對手看過）`, idx);
  } else {
    s = addLog(s, '集客：未選擇支援者，剩餘卡放回牌庫並重洗', idx);
  }
  return updatePlayer(s, idx, (p) => {
    const top6 = p.deck.filter(c => top6Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top6Iids.includes(c.iid));
    const chosen = top6.filter(c => iids.includes(c.iid));
    const remaining = top6.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...chosen],
    };
  });
});

// ── 桃歹郎ex「支配鎖鏈」──────────────────────────────────────────────────────
// 每回合 1 次：選備戰的惡屬性寶可夢（桃歹郎ex除外）換到出場，新出場中毒。
regA('桃歹郎ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const validBench = p.bench.filter(c => {
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Darkness' && card?.name !== '桃歹郎ex';
  });
  if (validBench.length === 0) {
    return addLog(st, '支配鎖鏈：備戰區沒有可切換的惡寶可夢', idx);
  }
  st = addLog(st, '支配鎖鏈：選 1 隻備戰惡屬性寶可夢換出場，並中毒', idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'dominance-chain',
    params: { validIids: validBench.map(c => c.iid) },
  });
});

regR('dominance-chain', (st, idx, iids, params, pool) => {
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!validIids.includes(targetIid)) return st;
  const target = st.players[idx].bench.find(c => c.iid === targetIid);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = st.players[idx].active ? (pool.get(st.players[idx].active!.cardId)?.name ?? '?') : '?';
  st = addLog(st, `支配鎖鏈：將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場（中毒）`, idx);
  // v5.247：補設 movedToActiveThisTurn + ON_PROMOTE_TO_ACTIVE prompt (自方換位特性)
  return tryPromptPromoteActive(updatePlayer(st, idx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === targetIid);
    if (bIdx < 0) return p;
    // v3.812：preserve justPlaced（位置交換不該清除剛打出 flag）；status='poisoned' 由招式效果加上
    // v5.247：補 movedToActiveThisTurn flag
    const newActive = { ...p.bench[bIdx], status: 'poisoned' as const, movedToActiveThisTurn: true };
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標（新上場 active 的中毒已在 newActive 設定）
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: newActive, bench: newBench };
  }), idx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// MC 破空焰ex — 火牌組預組主力（Session 24）
// ══════════════════════════════════════════════════════════════════════════════

// 烈火爆進 — 260 傷害，使用後本場上的這隻寶可夢無法再使用「烈火爆進」
// v2.159：升級為 blockedAttackNamesNextTurn 鎖招式名（之前用 cantAttackPending 鎖整隻過嚴）
regPost('破空焰ex|烈火爆進', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) {
    const cur = p.active.blockedAttackNamesNextTurn ?? [];
    p.active = { ...p.active, blockedAttackNamesNextTurn: [...cur, '烈火爆進'] };
  }
  players[aIdx] = p;
  return addLog({ ...state, players }, '烈火爆進：下回合無法再使用「烈火爆進」', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 30 B1 — 通用訓練家補實裝（10 張）
// ══════════════════════════════════════════════════════════════════════════════

// 傷藥 — 回 30 HP（物品）
regG('傷藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('傷藥', (st, idx) => {
  st = addLog(st, '傷藥：選擇回復 30 HP 的寶可夢', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'heal-30',
    params: { healAmount: 30, discardEnergy: 0 },
  });
});
regR('heal-30', healResolver);

// 西餐廚師 — 戰鬥寶可夢回 70 HP（支援者）
regG('西餐廚師', (st, idx) => !!st.players[idx].active && st.players[idx].active!.damage > 0);
reg('西餐廚師', (st, idx) => {
  return updatePlayer(addLog(st, '西餐廚師：戰鬥寶可夢回復 70 HP', idx), idx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: Math.max(0, p.active.damage - 70) } };
  });
});

// 真菰 — 全體寶可夢各回 40 HP（支援者）
regG('真菰', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('真菰', (st, idx) => {
  return updatePlayer(addLog(st, '真菰：全體寶可夢各回復 40 HP', idx), idx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: Math.max(0, p.active.damage - 40) } : null,
    bench: p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 40) })),
  }));
});

// 白露的真心 — 選 HP≤30 的寶可夢回復全部 HP（支援者）
regG('白露的真心', (st, idx, pool) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    const hp = card?.hp ?? 0;
    return hp > 0 && (hp - c.damage) <= 30;
  });
});
reg('白露的真心', (st, idx, pool) => {
  const p = st.players[idx];
  const validIids: string[] = [];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  for (const c of all) {
    const card = pool.get(c.cardId);
    const hp = card?.hp ?? 0;
    if (hp > 0 && (hp - c.damage) <= 30) validIids.push(c.iid);
  }
  st = addLog(st, '白露的真心：選 1 隻 HP≤30 的寶可夢回復全部 HP', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'heal-full',
    params: { healAmount: 9999, validIids },
  });
});
regR('heal-full', healResolver);

// 希特隆的機智 — 全體【雷】寶可夢回 60 HP（支援者）
regG('希特隆的機智', (st, idx, pool) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => pool.get(c.cardId)?.pokemonType === 'Lightning' && c.damage > 0);
});
reg('希特隆的機智', (st, idx, pool) => {
  const isLightning = (c: CardInstance) => pool.get(c.cardId)?.pokemonType === 'Lightning';
  return updatePlayer(addLog(st, '希特隆的機智：全體【雷】寶可夢各回復 60 HP', idx), idx, p => ({
    ...p,
    active: p.active && isLightning(p.active) ? { ...p.active, damage: Math.max(0, p.active.damage - 60) } : p.active,
    bench: p.bench.map(c => isLightning(c) ? { ...c, damage: Math.max(0, c.damage - 60) } : c),
  }));
});

// 蓋伊 — 從牌庫抽 3 張（支援者）
reg('蓋伊', (st, idx) => {
  return updatePlayer(addLog(st, '蓋伊：從牌庫抽 3 張', idx), idx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, deck: p.deck.slice(3), hand: [...p.hand, ...taken] };
  });
});

// 裁判 — 雙方洗手牌 + 各抽 4（支援者）
reg('裁判', (st, idx) => {
  st = addLog(st, '裁判：雙方洗手牌各抽 4 張', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const hand = newDeck.slice(0, 4);
    p.hand = hand;
    p.deck = newDeck.slice(4);
    players[i] = p;
  }
  return { ...st, players };
});

// 衝浪手 — 切換出場/備戰 + 抽牌至手牌滿 5 張（支援者）
regG('衝浪手', (st, idx) => !!st.players[idx].active && st.players[idx].bench.length > 0);
reg('衝浪手', (st, idx) => {
  st = addLog(st, '衝浪手：選要換入的備戰寶可夢，並抽牌至手牌 5 張', idx);
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'surfer-switch',
  });
});
regR('surfer-switch', (st, idx, iids, _params, pool) => {
  const prevPlayer = st.players[idx];
  const target = prevPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = prevPlayer.active ? (pool.get(prevPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `衝浪手：將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
  // v5.246：補設 movedToActiveThisTurn flag + ON_PROMOTE_TO_ACTIVE prompt
  return tryPromptPromoteActive(updatePlayer(st, idx, p => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    // v3.812：preserve justPlaced
    // v5.246：補 movedToActiveThisTurn flag — 疾風直撞類條件招式 + ON_PROMOTE prompt gate
    const newActive = { ...p.bench[bIdx], movedToActiveThisTurn: true };
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
    const drawN = Math.max(0, 5 - p.hand.length);
    const taken = p.deck.slice(0, drawN);
    return {
      ...p, active: newActive, bench: newBench,
      hand: [...p.hand, ...taken], deck: p.deck.slice(drawN),
    };
  }), idx, pool);
});

// 精靈球 — 擲硬幣，正面則從牌庫選 1 張寶可夢加手牌（物品）
reg('精靈球', (st, idx, pool) => {
  const r = flipCoinsWithLog(st, 1, '精靈球', idx);
  if (!r.heads) return addLog(r.state, '精靈球：反面 → 什麼都沒發生', idx);
  st = addLog(r.state, '精靈球：正面 → 從牌庫選 1 張寶可夢加手牌', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無寶可夢時允許 Pass
  const hasPoke = st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 寶可夢捕捉器 — 擲硬幣，正面則選對手備戰與戰鬥寶可夢互換（物品）
// v5.700：物品卡強制換位 → 過濾「緊張感/融合為雪」(卡面「物品卡或支援者卡不受影響」)免疫的對手備戰。
regG('寶可夢捕捉器', (st, idx, pool) => st.players[(1 - idx) as 0 | 1].bench.some(b => !_gustImmuneTrainer(b, pool)));
reg('寶可夢捕捉器', (st, idx, pool) => {
  const r = flipCoinsWithLog(st, 1, '寶可夢捕捉器', idx);
  if (!r.heads) return addLog(r.state, '寶可夢捕捉器：反面 → 什麼都沒發生', idx);
  const oppIdx = (1 - idx) as 0 | 1;
  st = r.state;
  const validIids = st.players[oppIdx].bench.filter(b => !_gustImmuneTrainer(b, pool)).map(b => b.iid);
  if (validIids.length === 0) return addLog(st, '寶可夢捕捉器：正面，但對手備戰沒有可呼叫的寶可夢（緊張感/融合為雪 免疫）', idx);
  st = addLog(st, '寶可夢捕捉器：正面 → 選對手備戰與戰鬥寶可夢互換', idx);
  return withPending(st, {
    type: 'opp-bench-choose', actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1, effectKey: 'gust-opp', params: { validIids },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H1 — H 標批次實裝：狀態附加類攻擊（~25 張）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * v2.91：檢查指定 CardInstance 是否對「混亂」免疫。
 * 目前只有 呆呆獸｜憨憨臉（卡面：「這隻寶可夢不會【混亂】」）。
 */
export function isConfusionImmune(inst: CardInstance | null, pool: Map<string, Card>): boolean {
  if (!inst) return false;
  const card = pool.get(inst.cardId);
  return !!card?.abilities?.some(a => a.name === '憨憨臉');
}

/**
 * v2.92：檢查防禦方（戰鬥寶可夢）是否因附帶「硬岩【鬥】能量」而免疫對手招式效果。
 * 卡面：「附有這張卡的【鬥】寶可夢不會受到對手的寶可夢使用招式的效果的影響。
 *        （已經受到的效果不會消除。）」
 * 規則：
 *   - 已經施加的效果（例如目前的【中毒】）不會因附上此卡而消除 — 僅在效果施加時阻擋。
 *   - 「招式的效果」不含招式本身的傷害（此能量只擋效果）；呼叫端的
 *     regPost/statusPost 會 check 這個 shield 再決定是否施加。
 *   - 僅防禦方卡本體為 pokemonType === 'Fighting' 時才成立（卡面明寫「【鬥】寶可夢」）。
 *
 * v2.138 擴充：加入「薄霧能量」— 卡面「附有的寶可夢不受對手招式效果影響」，無屬性條件。
 *
 * 呼叫時機：defender-targeting POST effect（statusPost、coinStatusPost 等）在施加前檢查。
 */
function hasEffectShield(inst: CardInstance | null, pool: Map<string, Card>): boolean {
  if (!inst) return false;
  // 薄霧能量 — 無屬性條件，附了就免疫
  if (inst.energyAttached.some(e => pool.get(e.cardId)?.name === '薄霧能量')) return true;
  // v2.150 皇帝之勢（帝王拿波ex）— 寶可夢本身的特性，不會受到對手招式效果的影響
  const card = pool.get(inst.cardId);
  if (card?.abilities?.some(a => a.name === '皇帝之勢')) return true;
  // 硬岩【鬥】能量 — 限【鬥】寶可夢（pokemonType === 'Fighting'）附有此能量時免疫
  // 官網卡面：「附有這張卡的【鬥】寶可夢不會受到對手的寶可夢使用招式的效果的影響。」
  // 只檢查 pokemonType，不擴展到其他屬性+硬岩的組合（Fire+硬岩不享有免疫）。
  if (!card) return false;
  const hasHardRock = inst.energyAttached.some(e => pool.get(e.cardId)?.name === '硬岩【鬥】能量');
  if (!hasHardRock) return false;
  return card.pokemonType === 'Fighting';
}

/**
 * v2.90 「招式效果免疫」declarative tag map
 *
 * 設計：未來新增「免疫招式效果」的卡（特殊能量 / 特性 / Tool）只要往本 map .set() 一行即可，
 *      canApplyAttackEffectToTarget 會自動檢查所有註冊項。
 *
 * kind 列舉：
 *   - 'energy-on-target'  — 目標身上附有此名稱的能量（薄霧能量、硬岩【鬥】能量）
 *   - 'self-ability'      — 目標自身擁有此名稱的特性（帝王拿波ex 皇帝之勢）
 *   - 'field-ability'     — defender 場上有此名稱特性（火箭隊的急凍鳥 抵抗之幕）
 *
 * filter（可選）：
 *   - requireType: 目標寶可夢屬性必須相符（硬岩【鬥】只保護【鬥】寶可夢）
 *   - targetFilter: 'BasicRocket' — 目標必須是【基礎】火箭隊（抵抗之幕）
 *
 * 不在本 map 內的免疫機制：
 *   - 純樸（immuneToAttackEffectsThisTurn flag）— engine ATTACK_POST 直接 short-circuit
 *   - 陳舊的背蓋化石（fossilOnField）— engine ATTACK_POST 直接 short-circuit
 *   - 對戰圓形 / 太晶 / 花之帷幔 — resolveBenchGuard 處理（限備戰目標）
 */
export type AttackEffectImmunityKind =
  | 'energy-on-target'
  | 'self-ability'
  | 'field-ability';

export interface AttackEffectImmunityRule {
  kind: AttackEffectImmunityKind;
  requireType?: EnergyType;       // 限制目標寶可夢屬性（如 Fighting）
  targetFilter?: 'BasicRocket';   // 額外限制目標類別
}

export const ATTACK_EFFECT_IMMUNITY = new Map<string, AttackEffectImmunityRule>([
  // 特殊能量
  ['薄霧能量',         { kind: 'energy-on-target' }],
  ['硬岩【鬥】能量',   { kind: 'energy-on-target', requireType: 'Fighting' }],
  // 自身特性
  ['皇帝之勢',         { kind: 'self-ability' }],
  // 場上特性
  ['抵抗之幕',         { kind: 'field-ability', targetFilter: 'BasicRocket' }],
]);

/**
 * v2.90 「招式效果」分類 informational tag
 *
 * 標記每個 attack 的 POST 屬性，協助未來 audit / debug / 玩家提示：
 *
 * - ATTACK_EFFECT_ONLY: 純招式效果（regPre damage = 0，全部效果走 regPost），如：
 *     胡地|手之力量、來悲粗茶ex|熬返
 *
 * - ATTACK_DAMAGE_PLUS_EFFECT: 招式傷害 + 招式效果混合，如：
 *     多龍巴魯托ex|幻影奇襲（200 傷害 + 6 指示物）
 *     奧利瓦ex|油之機關槍（0 + 6×20 指示物，但分類為混合因為傷害以指示物形式表達）
 *
 * 兩個 set 是 informational，不直接驅動行為。免疫檢查仍由 ATTACK_EFFECT_IMMUNITY 走。
 */
export const ATTACK_EFFECT_ONLY = new Set<string>([
  '胡地|手之力量',
  '來悲粗茶ex|熬返',
]);

export const ATTACK_DAMAGE_PLUS_EFFECT = new Set<string>([
  '多龍巴魯托ex|幻影奇襲',
  '奧利瓦ex|油之機關槍',
]);

/**
 * v2.89/v2.90 統一檢查：「招式效果」是否可施加於指定目標寶可夢。
 *
 * PTCG 規則區分：
 *   - 招式傷害（attack-damage）— 卡面有列傷害值（如 210），走 weakness/resistance/減傷管線
 *   - 招式效果（attack-effect）— 卡面文字描述的效果（放傷害指示物、施加狀態、棄能量等）
 *
 * 本 helper 走 ATTACK_EFFECT_IMMUNITY map declarative 檢查（v2.90 重構）。
 *
 * 使用時機：在「直接放傷害指示物 / 對 defender 施加效果」的招式 regPost 或 resolver 中，
 *           實際對 target 加 damage 前呼叫。回傳 blocked: true 時應 log 並 skip 該目標。
 *
 * 真實案例：
 *   - 胡地｜手之力量（手牌張數×2 個指示物 → 對手戰鬥場）
 *   - 來悲粗茶ex｜熬返（草能量×2 個指示物 → 對手選 1 隻）
 *   - 多龍巴魯托ex｜幻影奇襲（6 個指示物 → 對手備戰自由分配；200 傷害不受此影響）
 *   - 奧利瓦ex｜油之機關槍（6×20 → 對手任意自由分配）
 *   - cursed-bomb（彷徨夜靈/黑夜魔靈 等：N 個指示物 → 任選對手）
 *
 * @deprecated v4.5+ 起新 caller 請改用 `canApplyEffectToTarget(state, idx, target, card, kind, pool, {isBench})`。
 *
 * 此 helper 只擋 ATTACK_EFFECT_IMMUNITY map（薄霧能量 / 抵抗之幕 / 皇帝之勢 / 全能硬殼 /
 * 硬岩能量 / 化石類）— 卡面寫「招式的效果」類 immunity。
 *
 * ⚠️ 若 source 卡面是「N 點傷害」(attack-damage) 而誤用此 helper，會過度擋（v4.54 修了 4 個招式
 * 因此 bug 過度擋；v4.57 修虛無歸零；v4.58 修大沙風暴）。
 *
 * Unified helper 強制 caller 指定 kind ('attack-damage' / 'attack-effect' / 'ability-effect')，
 * 杜絕此類 kind 弄錯 bug。defense.ts 內部 dispatch 仍可使用本 helper（by design）。
 */
export function canApplyAttackEffectToTarget(
  state: GameState,
  atkIdx: 0 | 1,
  target: CardInstance,
  targetCard: Card | undefined,
  pool: Map<string, Card>,
): { blocked: true; reason: string } | { blocked: false } {
  // v3.21 陳舊的背蓋化石（H）— 卡面「不會受到對手寶可夢招式的『效果』影響」。
  //   engine.ts ATTACK_POST 階段的 short-circuit 只擋 POST 階段，
  //   但這裡 helper 涵蓋的是「直接放指示物 / 多目標 / 招式效果觸發」等通道
  //   （足球 / 卡害穴 / 多龍巴魯托ex 幻影奇襲 等），
  //   v2.191 漏未處理 → v3.21 在此開頭加 short-circuit 修補。
  //   僅 fossilOnField 即觸發；外部 caller 已保證 target.iid 為當前指定目標。
  if (target.fossilOnField) {
    const fossilCard = pool.get(target.cardId);
    if (fossilCard?.name === '陳舊的背蓋化石') {
      return { blocked: true, reason: '陳舊的背蓋化石 免疫招式效果' };
    }
  }
  // v5.213：化隱（M5 詛咒娃娃 / 斯魔茶 / 來悲粗茶 / 怨影娃娃）— 不受招式效果（含狀態）
  //   defense.ts L139 unified entry 已有此 check；legacy helper 補一份避免漏 caller。
  // v5.224：加 holder 位置 + 振翼髮暗夜羽擊壓制 check（target 在對手戰鬥場時若被壓制 → 失效）
  if (targetCard?.abilities?.some(a => a.name === '化隱')) {
    const dIdxForHy = (1 - atkIdx) as 0 | 1;
    const defActiveHy = state.players[dIdxForHy].active;
    const locHy: 'active' | 'bench' = (defActiveHy && defActiveHy.iid === target.iid) ? 'active' : 'bench';
    if (isAbilityHolderEffective(state, target, targetCard, dIdxForHy, '化隱', locHy, pool)) {
      return { blocked: true, reason: '化隱 免疫招式效果' };
    }
  }
  // v5.333：per-turn 招式免疫旗標（飛翔/要害斬/躲藏=immuneToAllAttackThisTurn、純樸=
  //   immuneToAttackEffectsThisTurn、阿塞蘿拉=immuneToExAttackThisTurn）也納入此 legacy guard，
  //   與 unified canApplyEffectToTarget 一致 — 因 defCantAttackNextPost / defNextAtkReducePost /
  //   悄聲加害 等仍走此 helper。此 helper 永遠是 attack-effect 語境，三者皆擋。
  if (target.immuneToAllAttackThisTurn) {
    return { blocked: true, reason: '免疫招式的傷害與效果（飛翔/要害斬/躲藏類）' };
  }
  if (target.immuneToAttackEffectsThisTurn) {
    return { blocked: true, reason: '免疫招式的效果（純樸類）' };
  }
  if (target.immuneToExAttackThisTurn) {
    const atkActiveIm = state.players[atkIdx].active;
    const atkCardIm = atkActiveIm ? pool.get(atkActiveIm.cardId) : undefined;
    if (atkCardIm && isRulePokemon(atkCardIm)) {
      return { blocked: true, reason: '免疫【ex】招式的傷害與效果（阿塞蘿拉的惡作劇）' };
    }
  }
  const dIdx = (1 - atkIdx) as 0 | 1;
  for (const [name, rule] of ATTACK_EFFECT_IMMUNITY) {
    if (rule.kind === 'energy-on-target') {
      // 目標身上附有此名稱的能量；若有 requireType，目標屬性必須相符
      if (rule.requireType && targetCard?.pokemonType !== rule.requireType) continue;
      if (target.energyAttached.some(e => pool.get(e.cardId)?.name === name)) {
        return { blocked: true, reason: `${name} 免疫招式效果` };
      }
    } else if (rule.kind === 'self-ability') {
      // 目標自身擁有此名稱特性
      if (targetCard?.abilities?.some(a => a.name === name)) {
        // v3.06 肋骨海龜｜全能硬殼 special-case — 還需 attacker 身上附有特殊能量才生效
        if (name === '全能硬殼') {
          if (!_v3060AttackerHasSE(state, atkIdx, pool)) continue;
        }
        // v5.224：target 在對手戰鬥場時若被振翼髮暗夜羽擊壓制 → 特性失效
        const defActiveSelf = state.players[dIdx].active;
        const locSelf: 'active' | 'bench' = (defActiveSelf && defActiveSelf.iid === target.iid) ? 'active' : 'bench';
        if (!isAbilityHolderEffective(state, target, targetCard, dIdx, name, locSelf, pool)) continue;
        return { blocked: true, reason: `${name} 免疫招式效果` };
      }
    } else if (rule.kind === 'field-ability') {
      // defender 場上有此名稱特性 + 目標符合 targetFilter
      // v5.224：iterate 每個 holder 並過濾被振翼髮暗夜羽擊等機制壓制者
      const defender = state.players[dIdx];
      const allDef: Array<{ inst: CardInstance; loc: 'active' | 'bench' }> = [];
      if (defender.active) allDef.push({ inst: defender.active, loc: 'active' });
      for (const b of defender.bench) allDef.push({ inst: b, loc: 'bench' });
      const hasFieldAbility = allDef.some(({ inst, loc }) => {
        const card = pool.get(inst.cardId);
        if (!card?.abilities?.some(a => a.name === name)) return false;
        // v5.224：holder 被壓制（含 active 位置振翼髮）→ 該 holder 不算
        return isAbilityHolderEffective(state, inst, card, dIdx, name, loc, pool);
      });
      // v5.220：抵抗之幕 attack-time snapshot fallback (KO 後 holder 已消失)
      const snapshotFallback = name === '抵抗之幕' && state._attackTimeOppRocketVeil === true;
      if (!hasFieldAbility && !snapshotFallback) continue;
      // 檢查 targetFilter
      if (rule.targetFilter === 'BasicRocket') {
        if (!isRocketBasicTarget(targetCard)) continue;
      }
      return { blocked: true, reason: `${name} 效果` };
    }
  }
  return { blocked: false };
}

/**
 * v2.175 — Special Energy 狀態免疫判定
 * holder 身上若附有 STATUS_IMMUNE 命中該狀態的特殊能量，回傳 immune（與卡名）。
 */
export function checkSpecialEnergyStatusImmune(
  inst: CardInstance,
  status: SpecialCondition,
  pool: Map<string, Card>,
): { immune: true; energyName: string } | { immune: false } {
  const holderCard = pool.get(inst.cardId);
  if (!holderCard) return { immune: false };
  for (const e of inst.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec) continue;
    const fn = SPECIAL_ENERGY_STATUS_IMMUNE.get(ec.name);
    if (!fn) continue;
    const set = fn(holderCard);
    if (set.has(status)) return { immune: true, energyName: ec.name };
  }
  return { immune: false };
}

/** 祭典會場：身上附有能量卡的寶可夢不會陷入特殊狀態。 */
export function isFestivalVenueStatusProtected(
  state: GameState,
  inst: CardInstance,
  pool: Map<string, Card>,
): boolean {
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  return stadium?.name === '祭典會場' && (inst.energyAttached?.length ?? 0) > 0;
}

/** 祭典會場：雙方身上附有能量卡的寶可夢，將受到的特殊狀態全部恢復。
 *  v5.375：清除時補 log。原本靜默清除，使 支配鎖鏈／阿杏的秘招 等先 log「中毒」、
 *  再被本 sweep 清掉，玩家誤以為狀態真的生效。並擴及 secondaryStatus／tertiaryStatus
 *  三槽（卡面「特殊狀態全部恢復」＝含雙／三重狀態）。 */
export function clearFestivalVenueProtectedStatuses(
  state: GameState,
  pool: Map<string, Card>,
): GameState {
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  if (stadium?.name !== '祭典會場') return state;

  // 特殊狀態 → 中文標籤（log 用）
  const STATUS_LABEL: Record<SpecialCondition, string> = {
    poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
  };
  const cleared: string[] = []; // 收集被恢復的寶可夢描述，事後一次補 log

  // 單一實例：身上有能量 + 任一狀態槽有特殊狀態 → 三槽全清，並記錄供 log
  const clean = (inst: CardInstance): CardInstance => {
    if ((inst.energyAttached?.length ?? 0) === 0) return inst;
    if (!inst.status && !inst.secondaryStatus && !inst.tertiaryStatus) return inst;
    const labels: string[] = [];
    for (const s of [inst.status, inst.secondaryStatus, inst.tertiaryStatus]) {
      if (s) labels.push(STATUS_LABEL[s] ?? s);
    }
    const name = pool.get(inst.cardId)?.name ?? '寶可夢';
    cleared.push(`${name}（${labels.join('、')}）`);
    return { ...inst, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined };
  };

  let changed = false;
  const players = state.players.map((player) => {
    let nextPlayer = player;
    if (player.active) {
      const na = clean(player.active);
      if (na !== player.active) {
        nextPlayer = { ...nextPlayer, active: na };
        changed = true;
      }
    }
    const bench = nextPlayer.bench.map((pk) => clean(pk));
    if (bench.some((pk, i) => pk !== nextPlayer.bench[i])) {
      nextPlayer = { ...nextPlayer, bench };
      changed = true;
    }
    return nextPlayer;
  }) as [PlayerState, PlayerState];

  if (!changed) return state;
  let next: GameState = { ...state, players };
  // 補 log：澄清「特殊狀態被祭典會場恢復」而非真的附加成功
  if (cleared.length > 0) {
    next = addLog(next, `🎪 祭典會場：${cleared.join('、')} 身上附有能量卡，特殊狀態全部恢復`, null);
  }
  return next;
}

/** v4.996: 附特殊能量後若 holder 被 SPECIAL_ENERGY_STATUS_IMMUNE 命中，
 *  清掉身上已有的 status / secondaryStatus（卡面後半句「全部恢復」）。
 *  類似 clearFestivalVenueProtectedStatuses 但 holder-scoped（per-Pokemon 的能量決定）。
 *  Usage: 在 ATTACH_ENERGY handler 跑完所有 hook 後呼叫一次 sweep 自方場面。
 */
export function clearSpecialEnergyProtectedStatuses(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
): GameState {
  const player = state.players[idx];
  let changed = false;

  function cleanInst(inst: CardInstance | null): CardInstance | null {
    if (!inst) return inst;
    const holderCard = pool.get(inst.cardId);
    if (!holderCard) return inst;
    const immuneSet = new Set<SpecialCondition>();
    for (const e of inst.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec) continue;
      const fn = SPECIAL_ENERGY_STATUS_IMMUNE.get(ec.name);
      if (!fn) continue;
      for (const s of fn(holderCard)) immuneSet.add(s);
    }
    if (immuneSet.size === 0) return inst;
    let result = inst;
    if (inst.status && immuneSet.has(inst.status as SpecialCondition)) {
      result = { ...result, status: undefined };
      changed = true;
    }
    if (inst.secondaryStatus && immuneSet.has(inst.secondaryStatus as SpecialCondition)) {
      result = { ...result, secondaryStatus: undefined };
      changed = true;
    }
    return result;
  }

  const newActive = cleanInst(player.active);
  const newBench = player.bench.map(cleanInst).filter((c): c is CardInstance => !!c);

  if (!changed) return state;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[idx] = { ...player, active: newActive, bench: newBench };
  return { ...state, players };
}

/** 讓對手戰鬥寶可夢陷入指定狀態的 POST effect */
/**
 * v4.965：套用新狀態到 active 寶可夢，正確處理 status / secondaryStatus 兩格。
 *
 * PTCG 規則（與 types.ts:90-103 約定一致）：
 *   - 行動類狀態（asleep/confused/paralyzed）三者互斥，永遠放 status 主格
 *   - 傷害類狀態（poisoned/burned）兩者互斥
 *   - 1 行動類 + 1 傷害類**可共存**（中毒+混亂、灼傷+睡眠等）
 *
 * 之前多處直接 `{ ...active, status: newStatus }` 蓋掉原狀態 — 違反規則。
 * 例：寶可夢中毒（status='poisoned'）被暗黑鈴混亂 → 應該變 (confused, poisoned)
 * 而不是把中毒蓋掉。
 *
 * 用法：`active = applyStatusToActive(active, 'confused');`
 */
export function applyStatusToActive(active: CardInstance, newStatus: SpecialCondition): CardInstance {
  // v5.679：每次施加【混亂】先清除上一次的「混亂自傷指示物覆蓋」(電燈怪錯亂閃光=8)，
  //   一般混亂回預設 3 個(30)；錯亂閃光在套用混亂【之後】再設 8（見其 regPost）。
  if (newStatus === 'confused' && active.confusionSelfDamageCounters != null) {
    active = { ...active, confusionSelfDamageCounters: undefined };
  }
  // v5.295: 三槽配置 — PTCG 規則允許行動類+中毒+灼傷 3 個並存
  const isNewAction = newStatus === 'asleep' || newStatus === 'confused' || newStatus === 'paralyzed';
  const isNewDamage = newStatus === 'poisoned' || newStatus === 'burned';
  const prev = active.status;
  const prevSec = active.secondaryStatus;
  const prevTer = active.tertiaryStatus;

  if (isNewAction) {
    // 行動類三者互斥 — 替換現有行動類 (status 主格), 保留傷害類兩槽
    // 若 prev 是傷害類 → 把 prev 搬到空的傷害槽 (避免覆蓋)
    const isPrevAction = prev === 'asleep' || prev === 'confused' || prev === 'paralyzed';
    if (isPrevAction) {
      // 簡單替換 status, 傷害類兩槽 (sec/ter) 都不動
      return { ...active, status: newStatus, secondaryStatus: prevSec, tertiaryStatus: prevTer };
    }
    // prev 是傷害類或空 → 把 prev 搬到任一空的傷害槽 (sec 優先)
    if (prev) {
      if (!prevSec) {
        return { ...active, status: newStatus, secondaryStatus: prev, tertiaryStatus: prevTer };
      } else if (!prevTer) {
        return { ...active, status: newStatus, secondaryStatus: prevSec, tertiaryStatus: prev };
      }
      // 兩傷害槽都滿 (理論不該發生因為只有 poisoned/burned 兩種) — 直接覆蓋 prev
    }
    return { ...active, status: newStatus, secondaryStatus: prevSec, tertiaryStatus: prevTer };
  }

  if (isNewDamage) {
    // 傷害類: 三槽掃描 — 若已有同名狀態, 不重複加
    if (prev === newStatus || prevSec === newStatus || prevTer === newStatus) {
      return active;
    }
    // 找空槽優先順序: status (若無行動類佔位) > secondaryStatus > tertiaryStatus
    if (!prev) {
      return { ...active, status: newStatus };
    }
    // status 被行動類或別的傷害類佔
    if (!prevSec) {
      return { ...active, secondaryStatus: newStatus };
    }
    if (!prevTer) {
      return { ...active, tertiaryStatus: newStatus };
    }
    // 三槽都滿 — 理論不該發生 (最多 1 行動類 + 2 傷害類, 已 3 槽), fallback: 不變
    return active;
  }

  // 其他 (不該到), fallback
  return active;
}

export function statusPost(status: 'poisoned' | 'burned' | 'asleep' | 'confused' | 'paralyzed'): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return state;
    const defName = pool.get(def.active.cardId)?.name ?? '?';
    // v2.91：憨憨臉免疫混亂
    if (status === 'confused' && isConfusionImmune(def.active, pool)) {
      return addLog(state, `${defName}｜憨憨臉：免疫【混亂】`, aIdx);
    }
    // v2.992：不眠（咕咕）— 免疫睡眠
    if (status === 'asleep' && isSleepImmune(def.active, pool)) {
      return addLog(state, `${defName}｜不眠：免疫【睡眠】`, aIdx);
    }
    // v2.91：統一走 attack-effect immunity helper — 涵蓋薄霧能量 / 硬岩【鬥】能量 /
    // 皇帝之勢 / 抵抗之幕（基礎火箭隊）。
    // v5.213：改用 unified canApplyEffectToTarget(kind='attack-effect') — legacy
    //   canApplyAttackEffectToTarget 沒包含化隱 check，導致 M5 詛咒娃娃/斯魔茶等
    //   被狀態 attack（如險惡門牙）攻擊時化隱沒擋住中毒等狀態附加（Wilson 報告）。
    if (def.active) {
      const defCardForGuard = pool.get(def.active.cardId);
      const guardSP = canApplyEffectToTarget(state, aIdx, def.active, defCardForGuard, 'attack-effect', pool);
      if (guardSP.blocked) {
        const defName2 = pool.get(def.active.cardId)?.name ?? '?';
        return addLog(state, `${defName2}｜${guardSP.reason}`, aIdx);
      }
    }
    // v2.175：泡沫【水】能量 — 對指定狀態免疫
    const immune = checkSpecialEnergyStatusImmune(def.active, status, pool);
    if (immune.immune) {
      const statusLabelImmune: Record<string, string> = {
        poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
      };
      return addLog(state, `${defName}｜${immune.energyName}：免疫【${statusLabelImmune[status]}】`, aIdx);
    }
    const statusLabelMap: Record<string, string> = {
      poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
    };
    if (isFestivalVenueStatusProtected(state, def.active, pool)) {
      return addLog(state, `${defName}｜祭典會場：免疫【${statusLabelMap[status]}】`, aIdx);
    }
    // v4.965: 用 applyStatusToActive 正確處理 status / secondaryStatus 兩格（保留共存狀態）
    def.active = applyStatusToActive(def.active, status);
    players[dIdx] = def;
    return addLog({ ...state, players }, `${defName} 陷入【${statusLabelMap[status]}】`, aIdx);
  };
}

/**
 * v5.444 中央上特殊狀態函式（一勞永逸）。
 * 所有「對【對手】戰鬥寶可夢施加特殊狀態」的招式 / 特性 / 效果都應走此函式，
 * 統一檢查全部免疫來源後才施加，避免各自 inline 漏判（化隱被波爾凱尼恩ex燒灼蒸汽
 * 灼傷的 bug 根因）。
 *
 * 免疫檢查順序（涵蓋全部來源）：
 *   1. 憨憨臉（混亂免疫，與來源無關）
 *   2. 不眠（睡眠免疫，與來源無關）
 *   3. canApplyEffectToTarget(kind) — kind='attack-effect'(招式) / 'ability-effect'(特性)：
 *        化隱（擋招式+特性效果）、純樸 / 薄霧 / 皇帝之勢 / 抵抗之幕（只擋招式效果）、
 *        對戰圓形競技場 等中央關卡一次到位。
 *   4. 泡沫【水】等特殊能量狀態免疫（per-status，與來源無關）
 *   5. 祭典會場（與來源無關）
 *
 * ⚠ 道具 / 訓練家卡（暗黑鈴、火箭隊的催眠裝置等）造成的狀態【不適用】化隱／純樸
 *   （化隱卡面只擋「對手的招式或特性的效果」），那類請勿改走 ability/attack-effect。
 *
 * @param kind 'attack-effect'（招式造成）或 'ability-effect'（特性造成）
 * @param label log 前綴（招式 / 特性名）
 * @param poisonDamagePerCheckup 強化中毒每次寶可夢檢查的傷害量（致死猛毒 160 等）
 */
export function applyStatusToOppActive(
  state: GameState,
  srcIdx: 0 | 1,
  status: SpecialCondition,
  pool: Map<string, Card>,
  // v5.674：新增 'item-effect' — 道具/訓練家卡造成的狀態。
  //   道具效果【不會】被化隱／純樸／光之翼等「對手招式或特性效果」免疫擋（卡面只擋招式/特性），
  //   故 item-effect 時跳過 canApplyEffectToTarget 那關；但憨憨臉/不眠/特殊能量/祭典會場
  //   屬「來源無關」的狀態免疫，對任何來源（含道具）都生效，照常套用。
  opts: { kind: 'attack-effect' | 'ability-effect' | 'item-effect'; label?: string; poisonDamagePerCheckup?: number } = { kind: 'attack-effect' },
): GameState {
  const dIdx = (1 - srcIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;
  const defName = pool.get(def.active.cardId)?.name ?? '?';
  const prefix = opts.label ? `${opts.label}：` : '';
  const statusLabel: Record<string, string> = {
    poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
  };
  // 1. 憨憨臉 — 混亂免疫
  if (status === 'confused' && isConfusionImmune(def.active, pool)) {
    return addLog(state, `${prefix}${defName}｜憨憨臉：免疫【混亂】`, srcIdx);
  }
  // 2. 不眠 — 睡眠免疫
  if (status === 'asleep' && isSleepImmune(def.active, pool)) {
    return addLog(state, `${prefix}${defName}｜不眠：免疫【睡眠】`, srcIdx);
  }
  // 3. 統一免疫關卡（化隱 / 純樸 / 薄霧 / 皇帝之勢 / 抵抗之幕 / 對戰圓形 …）
  //    僅招式/特性來源適用；道具來源（item-effect）跳過——化隱等卡面只擋「對手招式或特性效果」。
  if (opts.kind !== 'item-effect') {
    const guard = canApplyEffectToTarget(state, srcIdx, def.active, pool.get(def.active.cardId), opts.kind, pool);
    if (guard.blocked) {
      return addLog(state, `${prefix}${defName}｜${guard.reason}`, srcIdx);
    }
  }
  // 4. 泡沫【水】等特殊能量狀態免疫
  const seImmune = checkSpecialEnergyStatusImmune(def.active, status, pool);
  if (seImmune.immune) {
    return addLog(state, `${prefix}${defName}｜${seImmune.energyName}：免疫【${statusLabel[status]}】`, srcIdx);
  }
  // 5. 祭典會場
  if (isFestivalVenueStatusProtected(state, def.active, pool)) {
    return addLog(state, `${prefix}${defName}｜祭典會場：免疫【${statusLabel[status]}】`, srcIdx);
  }
  // 施加狀態（applyStatusToActive 正確處理 status / secondaryStatus 雙格共存）
  let newActive = applyStatusToActive(def.active, status);
  if (status === 'poisoned' && opts.poisonDamagePerCheckup) {
    newActive = { ...newActive, poisonDamagePerCheckup: opts.poisonDamagePerCheckup };
  }
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...def, active: newActive };
  return addLog({ ...state, players }, `${prefix}${defName} 陷入【${statusLabel[status]}】`, srcIdx);
}

// v5.675：自身施加狀態（攻擊者讓自己中狀態，如暴走自身混亂、睡覺自身睡眠）。
//   自身狀態【不】受化隱／純樸影響（那是「對手的招式或特性」效果，自損非對手造成），
//   故不走 canApplyEffectToTarget；但憨憨臉(混亂)/不眠(睡眠)/特殊能量泡沫【水】/祭典會場(中毒灼傷)
//   等「來源無關」狀態免疫照常套用。欄位放置交給 applyStatusToActive（保留既有狀態、雙格共存）。
export function applyStatusToSelfActive(
  state: GameState,
  idx: 0 | 1,
  status: SpecialCondition,
  pool: Map<string, Card>,
  opts: { label?: string; poisonDamagePerCheckup?: number } = {},
): GameState {
  const me = state.players[idx];
  if (!me.active) return state;
  const myName = pool.get(me.active.cardId)?.name ?? '?';
  const prefix = opts.label ? `${opts.label}：` : '';
  const statusLabel: Record<string, string> = {
    poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
  };
  // 憨憨臉 — 混亂免疫
  if (status === 'confused' && isConfusionImmune(me.active, pool)) {
    return addLog(state, `${prefix}${myName}｜憨憨臉：免疫【混亂】`, idx);
  }
  // 不眠 — 睡眠免疫
  if (status === 'asleep' && isSleepImmune(me.active, pool)) {
    return addLog(state, `${prefix}${myName}｜不眠：免疫【睡眠】`, idx);
  }
  // 泡沫【水】等特殊能量狀態免疫
  const seImmune = checkSpecialEnergyStatusImmune(me.active, status, pool);
  if (seImmune.immune) {
    return addLog(state, `${prefix}${myName}｜${seImmune.energyName}：免疫【${statusLabel[status]}】`, idx);
  }
  // 祭典會場（中毒/灼傷）
  if (isFestivalVenueStatusProtected(state, me.active, pool)) {
    return addLog(state, `${prefix}${myName}｜祭典會場：免疫【${statusLabel[status]}】`, idx);
  }
  let newActive = applyStatusToActive(me.active, status);
  if (status === 'poisoned' && opts.poisonDamagePerCheckup) {
    newActive = { ...newActive, poisonDamagePerCheckup: opts.poisonDamagePerCheckup };
  }
  const players = [...state.players] as [PlayerState, PlayerState];
  players[idx] = { ...me, active: newActive };
  return addLog({ ...state, players }, `${prefix}${myName} 陷入【${statusLabel[status]}】`, idx);
}

// 中毒類
regPost('鬼斯通|毒之氣息', statusPost('poisoned'));
regPost('百足蜈蚣|毒液', statusPost('poisoned'));
regPost('猛惡菇|噴毒', statusPost('poisoned'));
regPost('溶食獸|毒之氣息', statusPost('poisoned'));
regPost('吞食獸|毒液一擊', statusPost('poisoned'));
regPost('破破袋|毒液一擊', statusPost('poisoned'));
regPost('灰塵山|毒液一擊', statusPost('poisoned'));

// 叉字蝠|劇毒牙：強化中毒（2 指示物）— 目前狀態系統不支援變強度中毒，先施加中毒
regPost('叉字蝠|劇毒牙', statusPost('poisoned'));

// 混亂類
regPost('人造細胞卵|腦力震動', statusPost('confused'));
regPost('魔牆人偶|不祥波動', statusPost('confused'));
regPost('優雅貓|擺尾蠱惑', statusPost('confused'));
regPost('奇麒麟|不祥波動', statusPost('confused'));
regPost('願增猿|精神歪曲', statusPost('confused'));
// v5.113 胡地|奇異駭入 — 混亂 + 對手場上指示物重新分配
//   卡面：「將對手的戰鬥寶可夢【混亂】。選擇任意數量的對手的場上寶可夢身上放置的傷害
//          指示物，以任意方式改放於對手的場上寶可夢身上。」
//   原 v2.0+ 只 statusPost('confused') 漏掉 Part 2「指示物重新分配」整段效果。
//   簡化策略（Rule 14）：對手場上所有指示物加總 → 玩家選 1 隻對手寶可夢承接全部，
//   其餘歸 0。「任意方式」嚴格上是任意分配，這裡用「全集中」作 best-effort 實作。
//   對戰圓形 gate：若 target 是對手備戰，被擋 → addLog 提示玩家換目標。
regPost('胡地|奇異駭入', (state, aIdx, pool) => {
  // Part 1：將對手戰鬥寶可夢【混亂】
  let s = statusPost('confused')(state, aIdx, pool);
  // Part 2（v5.442 重做為 2-picker）：先「抽走任意數量對手全場指示物」，再「任意分配回對手全場」。
  //   picker1 = damage-distribute(abraRemove:true,每隻上限=現有指示物)；picker2 = 標準 damage-distribute 放置。
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = s.players[dIdx];
  const allOppPokes = [opp.active, ...opp.bench].filter((c): c is CardInstance => !!c);
  const totalCounters = allOppPokes.reduce((n, pk) => n + Math.floor((pk.damage ?? 0) / 10), 0);
  if (totalCounters === 0) {
    return addLog(s, '奇異駭入：對手場上無傷害指示物可移動', aIdx);
  }
  s = addLog(s, `奇異駭入：選擇要從對手全場抽走的傷害指示物（最多 ${totalCounters} 個，可選 0 略過）`, aIdx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: totalCounters,
    effectKey: 'abra-hack-remove',
    params: { abraRemove: true, totalCounters, counterDamage: 10, placedCounters: 0, includeActive: true },
  });
});

// v5.442 picker1 resolver — 從對手全場抽走玩家選定的指示物（每隻 clamp 現有），再開 picker2 分配。
RESOLVERS.set('abra-hack-remove', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  // 計每隻要抽走幾個（clamp 現有指示物數）
  const want = new Map<string, number>();
  for (const iid of iids) want.set(iid, (want.get(iid) ?? 0) + 1);
  const opp = st.players[dIdx];
  const allPokes = [opp.active, ...opp.bench].filter((c): c is CardInstance => !!c);
  const removeOf = new Map<string, number>();
  let removedTotal = 0;
  for (const pk of allPokes) {
    const have = Math.floor((pk.damage ?? 0) / 10);
    const rem = Math.min(want.get(pk.iid) ?? 0, have);
    if (rem > 0) { removeOf.set(pk.iid, rem); removedTotal += rem; }
  }
  if (removedTotal === 0) {
    return addLog(st, '奇異駭入：未抽走任何指示物（指示物維持原位）', idx);
  }
  let s = updatePlayer(st, dIdx, p => {
    const apply = (c: CardInstance | null): CardInstance | null =>
      c ? { ...c, damage: (c.damage ?? 0) - (removeOf.get(c.iid) ?? 0) * 10 } : c;
    return { ...p, active: apply(p.active), bench: p.bench.map(b => apply(b)!) };
  });
  s = addLog(s, `奇異駭入：抽走 ${removedTotal} 個傷害指示物 → 以任意方式分配回對手場上`, idx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: removedTotal, maxCount: removedTotal,
    effectKey: 'abra-hack-place',
    params: { totalCounters: removedTotal, counterDamage: 10, placedCounters: 0, includeActive: true },
  });
});

// v5.442 picker2 resolver — 把抽走的指示物分配回對手全場（attack-effect 免疫：對戰圓形/化隱等照擋；KO 交 sweep）。
RESOLVERS.set('abra-hack-place', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const place = new Map<string, number>();
  for (const iid of iids) place.set(iid, (place.get(iid) ?? 0) + 1);
  let s = st;
  for (const [iid, n] of place) {
    if (n <= 0) continue;
    const opp = s.players[dIdx];
    const isActive = opp.active?.iid === iid;
    const target = isActive ? opp.active : opp.bench.find(b => b.iid === iid);
    if (!target) continue;
    const tcard = pool.get(target.cardId);
    const guard = canApplyEffectToTarget(s, idx, target, tcard, 'attack-effect', pool, { isBench: !isActive });
    if (guard.blocked) {
      s = addLog(s, `奇異駭入：${tcard?.name ?? '?'}｜${guard.reason}（無法放置指示物）`, idx);
      continue;
    }
    s = updatePlayer(s, dIdx, p => ({
      ...p,
      active: p.active && p.active.iid === iid ? { ...p.active, damage: (p.active.damage ?? 0) + n * 10 } : p.active,
      bench: p.bench.map(b => b.iid === iid ? { ...b, damage: (b.damage ?? 0) + n * 10 } : b),
    }));
  }
  return addLog(s, '奇異駭入：傷害指示物重新分配完成', idx);
});
// 修建老匠|暴走：自己混亂（攻擊者自己中狀態）— v5.675 收斂到中央自身狀態 helper
regPost('修建老匠|暴走', (state, aIdx, pool) => applyStatusToSelfActive(state, aIdx, 'confused', pool, { label: '暴走' }));

// 睡眠類
regPost('雪吞蟲|細雪', statusPost('asleep'));
regPost('蚊香君|催眠術', statusPost('asleep'));
regPost('蚊香泳士|催眠術', statusPost('asleep'));
regPost('美納斯ex|昏睡飛濺', statusPost('asleep'));
regPost('海豹球|細雪', statusPost('asleep'));

// 燒傷類
regPost('焚焰蚣|灼熱', statusPost('burned'));
regPost('熾焰咆哮虎ex|火焰炸彈', statusPost('burned'));

// 九尾|奇異燈火（卡面：灼傷與混亂）— 逐狀態走中央 applyStatusToOppActive（含免疫檢查＋三狀態欄雙格共存），不再只套灼傷。
regPost('九尾|奇異燈火', (state, aIdx, pool) => {
  let s = applyStatusToOppActive(state, aIdx, 'burned', pool, { kind: 'attack-effect', label: '奇異燈火' });
  s = applyStatusToOppActive(s, aIdx, 'confused', pool, { kind: 'attack-effect', label: '奇異燈火' });
  return s;
});

// 麻痺（條件式）
// 托戈德瑪爾|麻麻時機 — 自己剩 1 獎賞卡時才麻痺對手
regPost('托戈德瑪爾|麻麻時機', (state, aIdx) => {
  if (state.players[aIdx].prizes.length !== 1) return state;
  return statusPost('paralyzed')(state, aIdx, new Map());
});
// 闇黑酋雷姆ex|冰河期 — 對手為龍屬時麻痺
regPost('闇黑酋雷姆ex|冰河期', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defCard = state.players[dIdx].active ? pool.get(state.players[dIdx].active!.cardId) : null;
  if (defCard?.pokemonType !== 'Dragon') return state;
  return statusPost('paralyzed')(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H2 — 自傷類攻擊（反動）
// ══════════════════════════════════════════════════════════════════════════════

/** 攻擊後自傷 N */
// v5.438：自傷（recoil）中央 helper — 對「攻擊方自己的戰鬥寶可夢」放 amount 傷害 + log。
//   收斂原本散落 4 份相同實作（selfHitPost 主 + v2650/v2750/v2770 local + m5SelfDamagePost + addSelfDamage）。
//   不計弱抗、不觸發對手受傷反擊（自傷非對手招式）。自我 KO 由 engine 攻擊後 sanityKOSweep 接住（已驗證無 bug）。
//   log 格式完全保留：無 label → 「<卡名> 自身受到 N 點傷害」；有 label → 「<label>：自身受到 N 點傷害」。
export function dealSelfDamage(
  state: GameState, aIdx: 0 | 1, amount: number, pool: Map<string, Card> | undefined, label?: string,
): GameState {
  const att = state.players[aIdx].active;
  if (!att || amount <= 0) return state;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], active: { ...att, damage: att.damage + amount } };
  const msg = label
    ? `${label}：自身受到 ${amount} 點傷害`
    : `${pool?.get(att.cardId)?.name ?? '?'} 自身受到 ${amount} 點傷害`;
  return addLog({ ...state, players }, msg, aIdx);
}

export function selfHitPost(amount: number, label?: string): AttackPostFn {
  return (state, aIdx, pool) => dealSelfDamage(state, aIdx, amount, pool, label);
}
regPost('燒火蚣|高溫奇襲', selfHitPost(10));
regPost('海地鼠|水炸彈', selfHitPost(20));
regPost('重泥挽馬|十萬馬力', selfHitPost(40));
regPost('蟲滾泥|撞一下', selfHitPost(10));
regPost('龍頭地鼠|狂野衝撞', selfHitPost(50));
regPost('佛烈托斯|鋼鐵衝撞', selfHitPost(40));
regPost('鐵啞鈴|鐵之衝撞', selfHitPost(10));
regPost('光電傘蜥|瘋狂伏特', selfHitPost(20));
regPost('洗翠 卡蒂狗|猛撞', selfHitPost(10));
regPost('轟擂金剛猩|木槌', selfHitPost(50));
regPost('火紅不倒翁|火焰衝撞', selfHitPost(20));
regPost('達摩狒狒|猛火猛撞', selfHitPost(70));
regPost('可可多拉|捨身衝撞', selfHitPost(10));
regPost('可多拉|鋼鐵衝撞', selfHitPost(20));
regPost('卡璞・哞哞|木槌', selfHitPost(30));
regPost('童偶熊|猛撞', selfHitPost(10));
regPost('爆焰龜獸|猛火猛撞', selfHitPost(60));
regPost('卡拉卡拉|突擊', selfHitPost(10));
regPost('齒輪組|鐵之衝撞', selfHitPost(20));
regPost('闇黑酋雷姆ex|闇黑冰霜', selfHitPost(30));
regPost('拳拳蛸|撞一下', selfHitPost(10));
regPost('豐蜜龍|狂野衝撞', selfHitPost(20));
regPost('火神蛾|怒濤羽擊', selfHitPost(50));
regPost('帝牙海獅|百萬噸墜落', selfHitPost(50));
regPost('傘電蜥|突擊', selfHitPost(10));
regPost('獨劍鞘|突擊', selfHitPost(10));
regPost('伊布|突擊', selfHitPost(10));
// 鐵骨土人|蠻力：base 50 + 若希望 +30 + 自傷 30
// v2.159：升級為 modal-choice — 用 ATTACK_PRE_DISCARD_CHOICE 借殼讓 UI 彈出能量挑選
//   作為 binary 選擇（選 0 個 = 不執行；選 ≥1 個 = 執行 +30 自傷 30）
//   雖 base 卡面是「自傷」非「棄能量」，但 UX 上這是「玩家選 yes/no」最簡實現
//   實際邏輯在 PRE 處理：選了 = +30 + 自傷 30；沒選 = 純 50 不自傷
ATTACK_PRE_DISCARD_CHOICE.set('鐵骨土人|蠻力', {
  min: 0, max: null, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0,
});
regPre('鐵骨土人|蠻力', (state, aIdx, _pool, action) => {
  const chosen = action?.discardedEnergyIids ?? [];
  if (chosen.length === 0) {
    return { state: addLog(state, '蠻力：未選增傷 → 50', aIdx), damage: 50 };
  }
  // 玩家選了 ≥1 個 → 執行 +30 + 自傷 30（不真棄能量，僅當作 binary 旗標）
  const s = addLog(state, '蠻力：增傷 +30，自傷 30 → 80', aIdx);
  return { state: s, damage: 80 };
});
regPost('鐵骨土人|蠻力', (state, aIdx, pool, action) => {
  const chosen = action?.discardedEnergyIids ?? [];
  if (chosen.length === 0) return state;
  // 自傷 30（共用既有 helper）
  return selfHitPost(30)(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H3 — 對手狀態時 +N 傷害（PRE）
// ══════════════════════════════════════════════════════════════════════════════

function defStatusBonus(base: number, condition: 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed', bonus: number): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    // v5.069：補 secondaryStatus 同檢查（特殊狀態可疊加，如「灼傷+混亂」存在 status='confused'
    //   + secondaryStatus='burned'）。原本只 check status 漏判 secondaryStatus 攜帶狀態的情形。
    const act = state.players[dIdx].active;
    const hasStatus = act?.status === condition || act?.secondaryStatus === condition;
    return { state, damage: base + (hasStatus ? bonus : 0) };
  };
}
regPre('熔岩蟲|炙燒', defStatusBonus(10, 'burned', 40));
regPre('卡璞・蝶蝶|心靈粉碎', defStatusBonus(90, 'confused', 90));
regPre('晶光花|毒液衝擊', defStatusBonus(30, 'poisoned', 100));

// v5.069: spike-shell-discard resolver — 甲殼刺 picker 解析器
RESOLVERS.set('spike-shell-discard', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (!opp.active) return st;
  const set = new Set(iids);
  const removed = opp.active.energyAttached.filter(e => set.has(e.iid));
  if (removed.length === 0) return st;
  const names = removed.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const attName = pool.get(opp.active.cardId)?.name ?? '?';
  const s = addLog(st, `甲殼刺：丟棄 ${attName} 身上的 ${names}`, idx);
  return updatePlayer(s, oppIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => !set.has(e.iid)) }
      : pl.active,
    discard: [...pl.discard, ...removed],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H4 — 簡單訓練家（抽牌、搜尋、回血等）
// ══════════════════════════════════════════════════════════════════════════════

// 手部修剪器 — 雙方手牌丟至 5 張（對手先丟，玩家自選要丟哪些）
// v3.9991：原 v2 簡化用 p.hand.slice(-discardN) 自動取最後 N 張，違反 Iron Rule 7。
//   卡面：「雙方玩家各將自己的手牌丟棄直到變為 5 張為止。（對手先丟棄。手牌為 5 張以下的玩家不丟棄。）」
//   修法：chained picker — 先 actorIdx=oppIdx，resolver 完成後若 myNeed>0 再開 actorIdx=userIdx 自己 picker。
reg('手部修剪器', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  const me = st.players[idx];
  const oppNeed = Math.max(0, opp.hand.length - 5);
  const myNeed = Math.max(0, me.hand.length - 5);
  if (oppNeed === 0 && myNeed === 0) {
    return addLog(st, '手部修剪器：雙方手牌皆 ≤ 5 張，無人需丟棄', idx);
  }
  st = addLog(st, `手部修剪器：雙方手牌丟至 5 張（對手先丟 ${oppNeed} 張、自己 ${myNeed} 張）`, idx);
  if (oppNeed > 0) {
    // Step 1：對手先丟（卡面明文順序）
    return withPending(st, {
      type: 'hand-discard',
      actorIdx: oppIdx, sourcePlayerIdx: oppIdx,
      minCount: oppNeed, maxCount: oppNeed,
      effectKey: 'hand-clipper-opp-discard',
      params: {
        userIdx: idx,   // 記住用卡者，resolver 內接力開自己 picker
        myNeed,
        titleOverride: `手部修剪器：選擇要丟棄的 ${oppNeed} 張手牌（丟到剩 5 張）`,
      },
    });
  }
  // 對手不用丟（手牌已 ≤ 5），直接跳到自己 picker
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: myNeed, maxCount: myNeed,
    effectKey: 'hand-clipper-self-discard',
    params: { titleOverride: `手部修剪器：選擇要丟棄的 ${myNeed} 張手牌（丟到剩 5 張）` },
  });
});

regR('hand-clipper-opp-discard', (st, idx, iids, params, pool) => {
  // idx 是 actor = oppIdx（被作用的對手）
  // v5.515：log 顯示丟棄的卡名（丟到棄牌區為公開資訊，雙方可見）
  const _hcNames = joinCardNames(st.players[idx].hand.filter(c => iids.includes(c.iid)), pool);
  st = updatePlayer(st, idx, p => {
    const discarded = p.hand.filter(c => iids.includes(c.iid));
    return {
      ...p,
      hand: p.hand.filter(c => !iids.includes(c.iid)),
      discard: [...p.discard, ...discarded],
    };
  });
  st = addPrivateLog(st,
    `手部修剪器：你丟棄了 ${_hcNames}`,
    `手部修剪器：對手丟棄了 ${_hcNames}`,
    idx);
  // 對手丟完 → 換用卡者丟（若 myNeed > 0）
  const userIdx = params?.userIdx as 0 | 1 | undefined;
  const myNeed = (params?.myNeed as number | undefined) ?? 0;
  if (userIdx !== undefined && myNeed > 0) {
    return withPending(st, {
      type: 'hand-discard',
      actorIdx: userIdx, sourcePlayerIdx: userIdx,
      minCount: myNeed, maxCount: myNeed,
      effectKey: 'hand-clipper-self-discard',
      params: { titleOverride: `手部修剪器：選擇要丟棄的 ${myNeed} 張手牌（丟到剩 5 張）` },
    });
  }
  return st;
});

regR('hand-clipper-self-discard', (st, idx, iids, _params, pool) => {
  // idx 是 actor = 用卡者
  // v5.515：log 顯示丟棄的卡名
  const _hcsNames = joinCardNames(st.players[idx].hand.filter(c => iids.includes(c.iid)), pool);
  st = updatePlayer(st, idx, p => {
    const discarded = p.hand.filter(c => iids.includes(c.iid));
    return {
      ...p,
      hand: p.hand.filter(c => !iids.includes(c.iid)),
      discard: [...p.discard, ...discarded],
    };
  });
  return addPrivateLog(st,
    `手部修剪器：你丟棄了 ${_hcsNames}`,
    `手部修剪器：對手丟棄了 ${_hcsNames}`,
    idx);
});

// 高級香氛 — 從牌庫選最多 3 張 Stage1 寶可夢加手牌
reg('高級香氛', (st, idx) => {
  st = addLog(st, '高級香氛：從牌庫選最多 3 張 1 階進化寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage1', minCount: 0, maxCount: 3,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 覺醒戰鼓 — 抽與自己場上「古代」寶可夢相同數量的卡
// v2.67：改用真正的 card.tags 查詢（v2.48 太晶 tag 同 pattern）。
reg('覺醒戰鼓', (st, idx, pool) => {
  const count = countAncientOnField(st, idx, pool);
  if (count === 0) {
    return addLog(st, '覺醒戰鼓：場上無「古代」寶可夢，抽 0 張', idx);
  }
  st = addLog(st, `覺醒戰鼓：場上 ${count} 隻「古代」寶可夢 → 抽 ${count} 張`, idx);
  return updatePlayer(st, idx, pl => {
    const taken = pl.deck.slice(0, count);
    return { ...pl, deck: pl.deck.slice(count), hand: [...pl.hand, ...taken] };
  });
});

// 賽吉（支援者）— v2.138 完整實裝
// 卡面：從牌庫選 1 張可進化自己場上某隻寶可夢的【1 階】或【2 階】寶可夢，直接進化（無視 justPlaced）。
// 流程：deck-search filter='Evolution'，玩家挑 1 → resolver 找場上能進化的目標自動進化。
//   sim/AI 端 fallback：若候選有多個（對手場上 active+bench 同時可進化），挑 active 為主。
regG('賽吉', (st, idx, pool) => {
  if (st.players[idx].deck.length === 0) return false;
  // v4.977 修正方向：「擁有特性的寶可夢除外」是指**進化卡（牌庫拿的那張）**不能有特性，
  //   非場上要被進化的目標。Gate：場上至少 1 隻寶可夢 + 牌庫至少 1 張「對應前階在場上
  //   + 自身無特性」的進化卡。
  const player = st.players[idx];
  const all = [player.active, ...player.bench].filter((c): c is CardInstance => !!c);
  if (all.length === 0) return false;
  const ownNames = new Set(all.map(c => pool.get(c.cardId)?.name ?? ''));
  return player.deck.some(c => {
    const card = pool.get(c.cardId);
    if (!card?.evolvesFrom) return false;
    if (!ownNames.has(card.evolvesFrom)) return false;
    // 進化卡本身不能有特性
    if (card.abilities && card.abilities.length > 0) return false;
    return true;
  });
});
reg('賽吉', (st, idx, pool) => {
  const player = st.players[idx];
  const all = [player.active, ...player.bench].filter((c): c is CardInstance => !!c);
  // v4.977 修正：場上目標可有特性（卡面限制的是**進化卡本身**，不是場上目標）
  const ownNames = new Set(all.map(c => pool.get(c.cardId)?.name ?? ''));
  // filter 用 'Evolution'（已支援）+ params.validIids 餵給 picker UI 做 intersect。
  // validIids 算法：「進化卡 evolvesFrom 在 ownNames + 進化卡自身 abilities 為空」
  const validIids = player.deck.filter(c => {
    const card = pool.get(c.cardId);
    if (!card?.evolvesFrom) return false;
    if (!ownNames.has(card.evolvesFrom)) return false;
    // v4.977: 卡面「擁有特性的寶可夢除外」— 進化卡自身不能有特性
    if (card.abilities && card.abilities.length > 0) return false;
    return true;
  }).map(c => c.iid);
  
  if (validIids.length === 0) {
    st = addLog(st, '賽吉：牌庫內無對應的進化卡（僅進行搜尋與重洗）', idx);
  } else {
    st = addLog(st, '賽吉：從牌庫選 1 張可進化自己場上寶可夢的進化卡，直接進化', idx);
  }
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    // v2.993：卡面寫「選 1 張」mandatory；牌庫無可進化卡時允許 Pass
    filter: 'Evolution', minCount: validIids.length > 0 ? 1 : 0, maxCount: 1,
    effectKey: 'sage-evolve',
    params: { validIids },
  });
});
// v5.207：賽吉 helper — 把進化卡套到指定 targetIid（active 或 bench 任一）
//   舊版 regR 內 hardcode「active 優先」，多隻同名底時玩家無法選 bench，違反卡面「選擇 1 隻」語意。
//   新版抽 helper + 1/多目標分流：1 目標自動 / ≥ 2 目標開第二層 picker 讓玩家選。
function _sageEvolveApply(state: GameState, aIdx: 0 | 1, evoIid: string, targetIid: string, pool: Map<string, Card>): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const evoIdx = p.deck.findIndex(c => c.iid === evoIid);
  if (evoIdx < 0) return addLog(state, '賽吉：找不到進化卡', aIdx);
  const evoInst = p.deck[evoIdx];
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard?.evolvesFrom) return addLog(state, '賽吉：所選非進化卡', aIdx);

  // v5.740：進化清除特殊狀態(PDF §I-A-05) — 同 v5.738 神奇糖果/正常 EVOLVE。
  //   原 `status: target.status` 把基底混亂/睡眠/麻痺/中毒/灼傷帶到進化體;改清除,
  //   唯暈眩山谷在場且基底混亂時保留混亂(同 preserveConfusion 例外)。
  const _sageDazeStadium = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
  const doEvolve = (target: CardInstance): CardInstance => ({
    ...evoInst,
    iid: target.iid,
    damage: target.damage,
    energyAttached: target.energyAttached,
    toolAttached: target.toolAttached,
    extraTools: target.extraTools,
    ...((_sageDazeStadium === '暈眩山谷' && target.status === 'confused') ? { status: 'confused' as const } : {}),
    evolvedFromStack: [...(target.evolvedFromStack ?? []), { ...target,
      iid: `${target.iid}_base_${target.cardId}_${Math.random().toString(36).slice(2, 8)}`,
      toolAttached: undefined, extraTools: [], energyAttached: [], evolvedFromStack: undefined }],
    evolvedThisTurn: true,
    // 賽吉特殊：覆寫 justPlaced（卡面註明對戰準備時 / 本回合剛使出的寶可夢也可使用）
    justPlaced: undefined, playedFromHand: undefined,
    movedToActiveThisTurn: undefined,
    cantAttackThisTurn: undefined, cantAttackPending: undefined,
    cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
    damageBonusThisTurn: undefined, damageBonusPending: undefined,
    damageReduceNextHit: undefined,
    blockedAttackNamesThisTurn: undefined, blockedAttackNamesNextTurn: undefined,
    abilityUsedThisTurn: undefined,
  });

  if (p.active && p.active.iid === targetIid) {
    if (pool.get(p.active.cardId)?.name !== evoCard.evolvesFrom) {
      return addLog(state, '賽吉：目標非對應底寶可夢', aIdx);
    }
    p.active = doEvolve(p.active);
  } else {
    const benchIdx = p.bench.findIndex(b => b.iid === targetIid);
    if (benchIdx < 0) return addLog(state, '賽吉：找不到進化目標', aIdx);
    const bTarget = p.bench[benchIdx];
    if (pool.get(bTarget.cardId)?.name !== evoCard.evolvesFrom) {
      return addLog(state, '賽吉：目標非對應底寶可夢', aIdx);
    }
    const newBench = [...p.bench];
    newBench[benchIdx] = doEvolve(bTarget);
    p.bench = newBench;
  }
  p.deck = shuffle(p.deck.filter((_, i) => i !== evoIdx));
  players[aIdx] = p;
  const targetName = evoCard.evolvesFrom ?? '?';
  return addLog({ ...state, players }, `賽吉：將 ${evoCard.name} 進化於場上的「${targetName}」並重洗牌庫`, aIdx);
}

regR('sage-evolve', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(state, '賽吉：未選擇進化卡', aIdx);
  }
  const evoIid = iids[0];
  const p = state.players[aIdx];
  const evoInst = p.deck.find(c => c.iid === evoIid);
  if (!evoInst) return addLog(state, '賽吉：找不到所選進化卡', aIdx);
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard?.evolvesFrom) return addLog(state, '賽吉：所選非進化卡', aIdx);

  // v5.207：找場上所有可進化目標（active + bench 中底名 = evoCard.evolvesFrom）
  //   舊版 hardcode active 優先 → 多隻同名時玩家無法選 bench (Wilson 報告：多龍奇)
  //   新版：1 目標自動 / ≥ 2 目標開第二層 bench-choose picker
  const targetIids: string[] = [];
  if (p.active && pool.get(p.active.cardId)?.name === evoCard.evolvesFrom) {
    targetIids.push(p.active.iid);
  }
  p.bench.forEach(b => {
    if (pool.get(b.cardId)?.name === evoCard.evolvesFrom) {
      targetIids.push(b.iid);
    }
  });

  if (targetIids.length === 0) {
    return addLog(state, `賽吉：場上無「${evoCard.evolvesFrom}」可進化`, aIdx);
  }
  if (targetIids.length === 1) {
    // 只 1 隻 → 自動進化（不必煩玩家）
    return _sageEvolveApply(state, aIdx, evoIid, targetIids[0], pool);
  }
  // ≥ 2 → 開第二層 picker
  const s2 = addLog(state, `賽吉：場上有 ${targetIids.length} 隻「${evoCard.evolvesFrom}」，請選擇要進化哪一隻`, aIdx);
  return withPending(s2, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'sage-evolve-pick-target',
    params: {
      includeActive: true,
      validIids: targetIids,
      evoIid,
      titleOverride: `賽吉：選擇要進化的「${evoCard.evolvesFrom}」`,
    },
  });
});

// v5.207：賽吉第二層 picker resolver — 玩家從多隻同名底寶中選 1 後套進化
regR('sage-evolve-pick-target', (state, aIdx, iids, params, pool) => {
  const targetIid = iids[0];
  const evoIid = (params?.evoIid as string | undefined) ?? '';
  if (!targetIid || !evoIid) {
    return addLog(state, '賽吉：picker 資料缺失，進化中斷', aIdx);
  }
  return _sageEvolveApply(state, aIdx, evoIid, targetIid, pool);
});

// 八朔（支援者）— 上個對手的回合自己的寶可夢昏厥了才可用，看牌庫頂 8 選 3
//   卡面（資料庫驗證 SV6 10512/10576、MC 17192）：
//   「這張卡必須在上個對手的回合自己的寶可夢【昏厥】了才可使用。
//     查看自己的牌庫上方8張卡，從其中選擇最多3張卡加入手牌。將剩餘卡放回牌庫並重洗。」
//
// v2.246 升級為精確 KO cause tracking（不再有 false positive）：
//   PTCG 規則：寶可夢檢查階段（中毒/灼傷/冰冷之帳）不屬於任何玩家的回合 → 不算「對手回合昏厥」
//   合法觸發來源：對手主回合中的「招式 KO」+「主動特性 KO」
//   counter 來自 recordOppKO（engine + cursed-bomb resolver 等所有 KO 點）
regG('八朔', (st, idx) => {
  const attackKO = st.oppAttackKOdMeInLastOppTurn?.[idx] ?? 0;
  const abilityKO = st.oppAbilityKOdMeInLastOppTurn?.[idx] ?? 0;
  return (attackKO + abilityKO) > 0;
});
reg('八朔', (st, idx) => {
  const top8Iids = st.players[idx].deck.slice(0, 8).map(c => c.iid);
  st = addLog(st, '八朔：從牌庫頂 8 張選最多 3 張加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP8', minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
    // v2.993：八朔卡面無「給對手看過」→ 私下揭示
    params: { top8Iids, privateReveal: true },
  });
});

// 朵拉塞娜（支援者）— 手牌洗回，擲硬幣正面抽 8 反面抽 3
reg('朵拉塞娜', (st, idx) => {
  const r = flipCoinsWithLog(st, 1, '朵拉塞娜', idx);
  const drawN = r.heads ? 8 : 3;
  st = addLog(r.state, `朵拉塞娜：${r.heads ? '正面' : '反面'} → 手牌洗回，抽 ${drawN} 張`, idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const hand = newDeck.slice(0, drawN);
    return { ...p, hand, deck: newDeck.slice(drawN) };
  });
});

// 海岱（支援者）— 手牌選 2 張放牌庫底 + 抽 4（需至少 2 張手牌）
regG('海岱', (st, idx) => st.players[idx].hand.length >= 3);
reg('海岱', (st, idx) => {
  st = addLog(st, '海岱：選 2 張手牌放牌庫底，再抽 4 張', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2, effectKey: 'hydai-bottom-draw4',
  });
});
regR('hydai-bottom-draw4', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `海岱：${names} 放到牌庫底`, idx);
  }
  return updatePlayer(st, idx, p => {
    const picked = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const newDeck = [...p.deck, ...picked];
    const taken = newDeck.slice(0, 4);
    return { ...p, hand: [...newHand, ...taken], deck: newDeck.slice(4) };
  });
});

// search-to-hand-reshuffle：從 TOP N 選幾張加手牌（剩餘放回重洗）
// v2.993：依 Iron Rule 8 加入揭示 log。預設 addLog（公開）— 大多數 caller 卡面寫「給對手看過」。
//   若 params.privateReveal === true → 改用 addPrivateLog（對手只見計數）。八朔、仙后 等卡使用此 flag。
regR('search-to-hand-reshuffle', (st, idx, iids, params, pool) => {
  const player = st.players[idx];
  const chosen = player.deck.filter(c => iids.includes(c.iid));
  const remaining = player.deck.filter(c => !iids.includes(c.iid));
  // 揭示 log
  if (chosen.length === 0) {
    st = addLog(st, '牌庫搜尋：未選擇任何卡（牌庫已重洗）', idx);
  } else {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    if ((params as any)?.privateReveal === true) {
      // 私下揭示：自己看到名稱、對手只看到計數
      st = addPrivateLog(st,
        `搜到：${names} 加入手牌（牌庫已重洗）`,
        `搜到 ${chosen.length} 張卡加入手牌（牌庫已重洗）`,
        idx);
    } else {
      // 公開揭示（卡面「給對手看過」）
      st = addLog(st, `搜到：${names} 加入手牌（牌庫已重洗）`, idx);
    }
  }
  return updatePlayer(st, idx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...picked], deck: shuffle(rest) };
  });
});

// ── v2.247 力之沙漏｜brailliant-attach ──────────────────────────────────────
// 玩家在 END_TURN 時選擇是否將棄牌區的基本能量附到有力之沙漏的寶可夢。
// selectedIids = []（跳過）或 [energyIid]（選擇1張能量）。
RESOLVERS.set('brailliant-attach', (st, idx, iids, params, pool) => {
  const player = st.players[idx];
  const active = player.active;
  if (!active || iids.length === 0) {
    // 玩家選擇跳過
    return addLog(st, `⚡ 力之沙漏：選擇跳過，不附能量`, idx);
  }
  // 將選中的能量實例從 discard 移到 active.energyAttached
  const energyInst = player.discard.find(c => c.iid === iids[0]);
  if (!energyInst) return addLog(st, `⚡ 力之沙漏：選擇無效（能量不存在）`, idx);
  const energyCard = pool.get(energyInst.cardId);
  const newDiscard = player.discard.filter(c => c.iid !== iids[0]);
  const newActive = { ...active, energyAttached: [...active.energyAttached, energyInst] };
  const newPlayer = { ...player, active: newActive, discard: newDiscard };
  let s = { ...st, players: [...st.players] as [typeof player, typeof player] };
  (s as any).pendingSelection = undefined;
  s.players[idx] = newPlayer;
  s = addLog(s, `⚡ 力之沙漏：將 ${energyCard?.name ?? '基本能量'} 附加到 ${pool.get(active.cardId)?.name ?? '?'}`, idx);
  // 若 endTurnAfter，設定 turnPhase 為 end 以繼續 END_TURN 流程
  if (params?.endTurnAfter) {
    s = { ...s, turnPhase: 'end' };
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H5 — 擲硬幣正面 +N 傷害（PRE）
// ══════════════════════════════════════════════════════════════════════════════

function coinPlusDmg(base: number, bonus: number): AttackPreFn {
  return (state, aIdx) => {
    const r = flipCoinsWithLog(state, 1, '招式擲幣', aIdx);
    const dmg = base + (r.heads ? bonus : 0);
    return { state: addLog(r.state, r.heads ? `→ +${bonus}（${dmg}）` : `→ 無加成（${dmg}）`, aIdx), damage: dmg };
  };
}
regPre('瑪力露麗|嬉鬧', coinPlusDmg(30, 30));
regPre('大炭車|擊飛', coinPlusDmg(20, 40));
regPre('土狼犬|咬盡', coinPlusDmg(30, 20));
regPre('小火焰猴|吹火', coinPlusDmg(20, 20));
regPre('伊布|電光一閃', coinPlusDmg(20, 20));
regPre('啃果蟲|回轉攻擊', coinPlusDmg(10, 20));
regPre('不良蛙|蛙跳', coinPlusDmg(20, 20));
regPre('強顎雞母蟲|伏擊', coinPlusDmg(10, 30));
regPre('炎兔兒|電光一閃', coinPlusDmg(10, 10));
regPre('花療環環|嬉鬧', coinPlusDmg(20, 20));
regPre('潤水鴨|燕返', coinPlusDmg(10, 20));

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H6 — 擲硬幣正面附加狀態（POST）
// ══════════════════════════════════════════════════════════════════════════════

export function coinStatusPost(status: 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed'): AttackPostFn {
  return (state, aIdx, pool) => {
    const r = flipCoinsWithLog(state, 1, '招式擲幣', aIdx);
    if (!r.heads) return addLog(r.state, '→ 無附加狀態', aIdx);
    state = r.state;
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return state;
    // v2.91：憨憨臉免疫混亂
    if (status === 'confused' && isConfusionImmune(def.active, pool)) {
      const name = pool.get(def.active.cardId)?.name ?? '?';
      return addLog(state, `正面！但 ${name}｜憨憨臉：免疫【混亂】`, aIdx);
    }
    // v2.992：不眠（咕咕）— 免疫睡眠
    if (status === 'asleep' && isSleepImmune(def.active, pool)) {
      const name = pool.get(def.active.cardId)?.name ?? '?';
      return addLog(state, `正面！但 ${name}｜不眠：免疫【睡眠】`, aIdx);
    }
    // v2.92：統一走 canApplyAttackEffectToTarget — 涵蓋薄霧能量 / 硬岩【鬥】能量 /
    // 皇帝之勢 / 抵抗之幕（基礎火箭隊）。
    if (def.active) {
      const defCardForGuard = pool.get(def.active.cardId);
      const guardCSP = canApplyEffectToTarget(state, aIdx, def.active, defCardForGuard, 'attack-effect', pool);
      if (guardCSP.blocked) {
        const defCoinName = pool.get(def.active.cardId)?.name ?? '?';
        return addLog(state, `正面！但 ${defCoinName}｜${guardCSP.reason}`, aIdx);
      }
    }
    // v4.965: 用 applyStatusToActive 正確處理狀態共存（不蓋掉原中毒/灼傷）
    def.active = applyStatusToActive(def.active, status);
    players[dIdx] = def;
    return addLog({ ...state, players }, `正面！對手${
      status === 'poisoned' ? '中毒' : status === 'burned' ? '燒傷' :
      status === 'asleep' ? '睡眠' : status === 'confused' ? '混亂' : '麻痺'
    }`, aIdx);
  };
}
regPost('火斑喵|擊掌奇襲', coinStatusPost('paralyzed'));
regPost('捷拉奧拉|麻麻關節', coinStatusPost('paralyzed'));
regPost('大舌舔|泰山壓頂', coinStatusPost('paralyzed'));
regPost('呱頭蛙|麻麻水', coinStatusPost('paralyzed'));
regPost('閃電鳥|電磁波', coinStatusPost('paralyzed'));
regPost('電肚蛙|電擊', coinStatusPost('paralyzed'));
regPost('赫拉克羅斯|泰山壓頂', coinStatusPost('paralyzed'));
regPost('電海燕|電擊', coinStatusPost('paralyzed'));
regPost('頑皮熊貓|瞪眼', coinStatusPost('paralyzed'));
regPost('幾何雪花|冰凍光束', coinStatusPost('paralyzed'));
regPost('太陽伊布|念力', coinStatusPost('paralyzed'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H7 — 攻擊時抽牌（POST）
// ══════════════════════════════════════════════════════════════════════════════

function drawPost(n: number): AttackPostFn {
  return (state, aIdx) => updatePlayer(state, aIdx, p => {
    const taken = p.deck.slice(0, n);
    return { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...taken] };
  });
}
regPost('凱路迪歐|快速抽出', drawPost(2));
regPost('古玉魚|吸引', drawPost(2));
regPost('傘電蜥|呼喚', drawPost(1));
regPost('鴨寶寶|雙重抽出', drawPost(2));
regPost('木木梟|叼', drawPost(1));
regPost('電擊獸|呼喚', drawPost(1));
regPost('齒輪兒|吸引', drawPost(1));

// 特殊：手牌洗回 + 抽 N
function discardHandDrawPost(n: number): AttackPostFn {
  return (state, aIdx) => updatePlayer(state, aIdx, p => {
    const newDiscard = [...p.discard, ...p.hand];
    const taken = p.deck.slice(0, n);
    return { ...p, hand: taken, deck: p.deck.slice(n), discard: newDiscard };
  });
}
regPost('猛雷鼓ex|濺射咆哮', discardHandDrawPost(6));

// 手牌洗回牌庫 + 抽 N
regPost('比克提尼|啪噠啪噠', (state, aIdx) => updatePlayer(state, aIdx, p => {
  const newDeck = shuffle([...p.deck, ...p.hand]);
  const taken = newDeck.slice(0, 6);
  return { ...p, hand: taken, deck: newDeck.slice(6) };
}));

// 雙方各抽 N
regPost('花療環環|花流浴', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const taken = p.deck.slice(0, 3);
    p.hand = [...p.hand, ...taken];
    p.deck = p.deck.slice(3);
    players[i] = p;
  }
  return { ...state, players };
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H8 — 下回合這隻無法使用招式（cantAttackPending 機制）
// ══════════════════════════════════════════════════════════════════════════════

function selfCantAttackNextPost(): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, cantAttackPending: true };
    players[aIdx] = att;
    return { ...state, players };
  };
}
// v5.115：卡面區分「無法使用招式（全擋）」vs「無法使用『這招』（單擋）」兩類。
//   single-attack 類用 blockedAttackNamesNextTurn:[name]（仿哲爾尼亞斯|光明角擊 pattern），
//   讓下回合仍可用其他招式（含古空棘魚|潛入記憶提供的進化前招式）。
//   all-attacks 類保持 cantAttackPending 全擋。
function selfBlockSpecificAttackNextPost(attackName: string): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      const cur = att.active.blockedAttackNamesNextTurn ?? [];
      att.active = { ...att.active, blockedAttackNamesNextTurn: [...cur, attackName] };
    }
    players[aIdx] = att;
    return { ...state, players };
  };
}
// 卡面「無法使用『駭浪』」— 只擋這招（下回合仍可用其他招式 + 潛入記憶招式）
regPost('大力鱷|駭浪', selfBlockSpecificAttackNextPost('駭浪'));
// 卡面「無法使用『猛擊在地』」— 同上
regPost('飛天螳螂|猛擊在地', selfBlockSpecificAttackNextPost('猛擊在地'));
// 卡面「無法使用招式」— 全擋（含進化前招式）
regPost('瑪力露麗|力量衝撞', selfCantAttackNextPost());
regPost('斗笠菇|關節衝擊', selfCantAttackNextPost());
regPost('鐵斑葉ex|稜鏡刀鋒', selfCantAttackNextPost());

// 對手受招後下回合無法攻擊
function defCantAttackNextPost(): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return state;
    // v2.91 招式效果免疫檢查
    const defCard = pool.get(def.active.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, def.active, defCard, pool);
    if (guard.blocked) {
      return addLog(state, `${defCard?.name ?? '?'}｜${guard.reason}（不施加「下回合無法使用招式」）`, aIdx);
    }
    def.active = { ...def.active, cantAttackPending: true };
    players[dIdx] = def;
    return { ...state, players };
  };
}
regPost('雪絨蛾|冰冷寒氣', defCantAttackNextPost());

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H9 — 下一次被攻擊傷害 -N（新機制 damageReduceNextHit）
// ══════════════════════════════════════════════════════════════════════════════

function selfDmgReducePost(n: number): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, damageReduceNextHit: n };
    players[aIdx] = att;
    return addLog({ ...state, players }, `下次受到招式傷害 -${n}`, aIdx);
  };
}
regPost('樹林龜|甲殼衝撞', selfDmgReducePost(20));
regPost('橡實果|硬化', selfDmgReducePost(30));
regPost('巨鉗螳螂ex|鋼翼', selfDmgReducePost(50));
regPost('煤炭龜|甲殼衝撞', selfDmgReducePost(30));
regPost('波士可多拉|防守利爪', selfDmgReducePost(50));
regPost('噗隆隆|硬化', selfDmgReducePost(30));
regPost('飄飄球|膨脹', selfDmgReducePost(10));

// 對手受招後下回合使用招式傷害 -N
// v3.22：改寫 nextOwnAttackPenalty（attacker-side debuff，由對手變 attacker 時消耗）
//   原本寫 damageReduceNextHit 跟「自己下次被打 -N」共用 field 導致誤消耗 bug。
function defNextAtkReducePost(n: number): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return state;
    // v2.91 招式效果免疫檢查
    const defCard = pool.get(def.active.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, def.active, defCard, pool);
    if (guard.blocked) {
      return addLog(state, `${defCard?.name ?? '?'}｜${guard.reason}（不施加「下次出招 -${n}」）`, aIdx);
    }
    def.active = { ...def.active, nextOwnAttackPenalty: n };
    players[dIdx] = def;
    return addLog({ ...state, players }, `對手下次使用招式傷害 -${n}`, aIdx);
  };
}
regPost('黑魯加|大聲咆哮', defNextAtkReducePost(100));
regPost('嘎啦嘎啦|叫聲', defNextAtkReducePost(40));
regPost('超級火炎獅ex|吠', defNextAtkReducePost(50)); // 受招寶可夢下回合使用招式傷害 -50

// ══════════════════════════════════════════════════════════════════════════════
// Session 38g H13 — bench snipe / spray 批次（13 張）
// 使用 hitBenchAll / hitBenchPickPost helper，bench 不計算弱點・抵抗力已內建
// ══════════════════════════════════════════════════════════════════════════════

// ── P1：對指定方「所有備戰」施加固定傷害（3 張）────────────────────────────
// 穿山王 地震 — 自己所有備戰 10
regPost('穿山王|地震', (state, aIdx, pool) =>
  hitBenchAll(state, aIdx, aIdx, 10, pool, '地震'));
// 焚焰蚣 燃燒熱浪 — 自己所有備戰 30
regPost('焚焰蚣|燃燒熱浪', (state, aIdx, pool) =>
  hitBenchAll(state, aIdx, aIdx, 30, pool, '燃燒熱浪'));
// 電飛鼠 天空波 — 雙方所有備戰各 10
regPost('電飛鼠|天空波', (state, aIdx, pool) => {
  const s1 = hitBenchAll(state, aIdx, aIdx, 10, pool, '天空波');
  return hitBenchAll(s1, aIdx, (1 - aIdx) as 0 | 1, 10, pool, '天空波');
});

// ── P2：選 N 隻備戰各施加固定傷害（5 張）──────────────────────────────────
// 奇麒麟ex 惡劣光束 — 選對手 1 隻備戰 30
regPost('奇麒麟ex|惡劣光束', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 30, '惡劣光束'));
// 摩托蜥ex 突圍 — 選對手 1 隻備戰 30
regPost('摩托蜥ex|突圍', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 30, '突圍'));
// 冰伊布ex 冰霜子彈 — 選對手 1 隻備戰 30
regPost('冰伊布ex|冰霜子彈', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 30, '冰霜子彈'));
// 三首惡龍ex 黑曜石 — 選對手 2 隻備戰各 130
regPost('三首惡龍ex|黑曜石', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 2, 130, '黑曜石'));
// 麒麟奇 雙向頭擊 — 選自己 1 隻備戰 10
regPost('麒麟奇|雙向頭擊', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'self', 1, 10, '雙向頭擊'));

// ── P3：條件式 +N 傷害（regPre 修改傷害，3 張）────────────────────────────
// 老翁龍 盛怒炮 — 若自己所有備戰都有傷，+120（基礎 100）
regPre('老翁龍|盛怒炮', (state, aIdx, _pool) => {
  const bench = state.players[aIdx].bench;
  const bonus = bench.length > 0 && bench.every(c => c.damage > 0) ? 120 : 0;
  return { state, damage: 100 + bonus };
});
// 洗翠 風速狗 驕傲獠牙 — 若自己備戰任一有傷，+90（基礎 30）
regPre('洗翠 風速狗|驕傲獠牙', (state, aIdx, _pool) => {
  const anyDamaged = state.players[aIdx].bench.some(c => c.damage > 0);
  return { state, damage: 30 + (anyDamaged ? 90 : 0) };
});
// 鐵頭殼 滅絕斬 — 若對手備戰 ≥3 隻，+80（基礎 40）
regPre('鐵頭殼|滅絕斬', (state, aIdx, _pool) => {
  const oppBench = state.players[(1 - aIdx) as 0 | 1].bench.length;
  return { state, damage: 40 + (oppBench >= 3 ? 80 : 0) };
});

// ── P4：條件式 bench 傷害 + stadium 丟棄（1 張）────────────────────────────
// 古鼎鹿 大地斷裂 — 若場上有 Stadium：對手所有備戰 30 + 丟棄 Stadium
//   v2.244 升級：用 discardActiveStadium helper 丟回擁有者棄牌堆（不再簡化丟到攻擊方）。
regPost('古鼎鹿|大地斷裂', (state, aIdx, pool) => {
  if (!state.activeStadium) return state;
  const stadiumCard = pool.get(state.activeStadium.cardId);
  let s = discardActiveStadium(state, aIdx);
  s = addLog(s, `大地斷裂：將場地卡 ${stadiumCard?.name ?? '?'} 丟棄`, aIdx);
  return hitBenchAll(s, aIdx, (1 - aIdx) as 0 | 1, 30, pool, '大地斷裂');
});

// ── P5：條件式 選 2 隻對手備戰施加 120（1 張）──────────────────────────────
// 古簡蝸 貪婪危害 — 若自己牌庫 ≤3 張，對手選 2 隻備戰各 120
regPost('古簡蝸|貪婪危害', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length > 3) return state;
  return hitBenchPickPost(state, aIdx, 'opp', 2, 120, '貪婪危害');
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 32 H11 — 被動特性：受傷減 N / 免疫
// ══════════════════════════════════════════════════════════════════════════════

/** 特性名 → 受招式傷害 -N（被動） */
export const PASSIVE_DAMAGE_REDUCE = new Map<string, number>([
  ['鑽石膜', 30],       // 超級蒂安希ex — 原本 hard-coded 在 engine
  ['堅硬甲殼', 20],     // 草苗龜
  ['密林之軀', 30],     // 巨蔓藤
  ['柔軟羊毛', 30],     // 毛毛角羊
  ['堅堅之軀', 30],     // 浩大鯨
  ['堅硬身軀', 20],     // v2.217 鐵殼蛹（J） — 受招式傷害 -20
  // v2.267 wave 1：純被動傷害減免 ───────────────────────────────────────
  ['威嚇之牙', 30],     // 火炎獅 M1S Stage1 130HP — 「只要這隻寶可夢在戰鬥場上，
                        //   對手的戰鬥寶可夢使用的招式的傷害『-30』點。」
                        //   持有者只在 active 才生效，但 PASSIVE_DAMAGE_REDUCE
                        //   套用點 (engine.ts) 是掃 defenderCard.abilities，
                        //   defenderCard 必為 active，所以條件天然成立。
  ['泥巴膜', 30],       // 重泥挽馬 SV9a Stage1 150HP — 「這隻寶可夢受到招式的傷害『-30』點。」
                        //   無 active 限制，但同樣只有 active 會被攻擊，效果等價。
  // v2.992 Group 1 (A 類)
  ['毛皮大衣', 20],     // 多麗米亞(H) — 受招式傷害 -20
  ['爆炸頭防守', 30],   // 爆炸頭水牛ex(I) — 受招式傷害 -30
]);

/**
 * Wave 42：攻擊方場上的被動特性「+N 攻擊傷害」查表。
 * 特性名 → (attackerCard) => 是否對此攻擊者生效 & 加多少傷害。
 * engine 在 weakness 之前、已過 skipWeakRes/skipDefEffects 判斷區塊之外套用（屬於攻擊方效果，不受 skipDefEffects 影響）。
 * 多個來源可疊加（例如場上同時有 2 隻羅絲雷朵），以擁有特性的 Pokemon 張數乘算。
 */
// v2.133：簽名擴充 — 第二參數加入 defenderCard 讓某些被動能依對手卡片資訊判定加成
// v2.278 Wave 4：再擴 state / aIdx / pool — 讓被動能依場上局勢（獎賞數、自方場上其他寶可夢）判定加成
//   （原本 1~2 arg 的條目仍兼容；新加入的條目可選擇使用後三個參數）
export const PASSIVE_ATTACK_BONUS = new Map<string, (
  attackerCard: Card,
  defenderCard?: Card,
  state?: GameState,
  aIdx?: 0 | 1,
  pool?: Map<string, Card>,
) => number>([
  // 竹蘭的羅絲雷朵｜輝煌聲援 — 只要這隻在場上，自己「竹蘭的」寶可夢招式傷害 +30
  ['輝煌聲援', (att) => att.name.includes('竹蘭的') ? 30 : 0],
  // v2.133 電蜘蛛｜複眼 — 自己的「電蜘蛛」攻擊時，對「擁有特性」的對手戰鬥場 +50
  //   只在 attacker 真的是電蜘蛛時觸發（避免另一隻電蜘蛛在備戰也疊加）
  ['複眼', (att, def) => {
    if (att.name !== '電蜘蛛') return 0;
    return (def?.abilities && def.abilities.length > 0) ? 50 : 0;
  }],
  // v2.154 鐵頭殼ex｜鈷藍指令 — 只要場上，自己「未來」寶可夢（鐵頭殼ex 除外）+20 傷害
  //   engine 在 attacker 場上每張卡都會檢查 abilities → 鐵頭殼ex 觸發此項
  //   bonus 套用到 attacker 卡 (att 是攻擊發動者本人，不是 鐵頭殼ex 自己)
  ['鈷藍指令', (att) => {
    if (att.name === '鐵頭殼ex') return 0;  // 鐵頭殼ex 自己除外
    return att.tags?.includes('未來') ? 20 : 0;
  }],
  // v2.267 wave 1：被動攻擊加成 ───────────────────────────────────────
  // 鹽石巨靈｜力之鹽 — 「只要這隻寶可夢在場上，自己的【鬥】寶可夢使用的招式，
  //   對對手的戰鬥寶可夢造成的傷害『+30』點。」(MC Stage2 180HP)
  ['力之鹽', (att) => att.pokemonType === 'Fighting' ? 30 : 0],
  // 君主蛇ex｜皇家聲援 — 「只要這隻寶可夢在場上，自己的寶可夢使用的招式，
  //   對對手的戰鬥寶可夢造成的傷害『+20』點。」(SV11B Stage2 320HP)
  //   無條件 +20（君主蛇ex 自己也算）。多隻場上會疊加，但 PTCG 場上不會
  //   有多隻 Stage2 ex，實務無疊加問題。
  ['皇家聲援', () => 20],
  // 赫普的卡比獸｜大方 — 「只要這隻寶可夢在場上，自己的『赫普的寶可夢』使用的招式，
  //   對對手的戰鬥寶可夢造成的傷害『+30』點。無論有多少隻擁有這個特性的寶可夢，
  //   這個效果也不會重複。」(SV9 Basic 150HP)
  // P2-3 fix：此特性在 engine.ts 的 PASSIVE_ATTACK_BONUS loop 中，
  //   透過 PASSIVE_ATTACK_NO_STACK set 確保只加成一次（dedup by ability name）。
  ['大方', (att) => att.name.includes('赫普的') ? 30 : 0],

  // v2.278 Wave 4：「自身招式」+ 對局狀態判定 ─────────────────────────
  //
  // 仆斬將軍｜大將（M2a/MC Stage2 170HP）—
  //   「這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害，
  //    依對手已經獲得的獎賞卡每 1 張『+30』點。」
  //   - att.name === '仆斬將軍' gate：只有仆斬將軍自己攻擊時才生效
  //     （PASSIVE_ATTACK_BONUS engine 對攻擊方場上每張卡都會 invoke 此 fn，
  //     但 attackerCard 永遠是攻擊發動者本人，所以這個 gate 等價於「只在
  //     仆斬將軍自己攻擊時加成」）。
  //   - 對手「已獲得獎賞」= 6 - opp.prizes.length（剩餘的相反）。
  //   - 場上有多隻仆斬將軍時，PASSIVE 會疊加 — 但 PTCG 規則 Stage2 同名最多 4 張、
  //     場上很難有 2 隻活著的仆斬將軍同時當 attacker 與 helper；不做 dedup。
  ['大將', (att, _def, state, aIdx) => {
    if (att.name !== '仆斬將軍') return 0;
    if (!state || aIdx == null) return 0;
    const dIdx = (1 - aIdx) as 0 | 1;
    const taken = 6 - state.players[dIdx].prizes.length;
    return taken * 30;
  }],

  // 飯匙蛇｜激動力量（M2 Basic 120HP）—
  //   「若自己的場上有【惡】屬性的『超級進化寶可夢【ex】』，
  //    則這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害『+120』點。」
  //   - att.name === '飯匙蛇' gate：只有飯匙蛇自己攻擊時才生效。
  //   - 條件：自方場上 active 或 bench 任一張為 Darkness 屬 + subtype='ex' + name 開頭「超級」
  //     （Mega ex 識別模式：與專案其他地方一致，見 prizesForKO / pokemon_search.ts 等）。
  ['激動力量', (att, _def, state, aIdx, pool) => {
    if (att.name !== '飯匙蛇') return 0;
    if (!state || aIdx == null || !pool) return 0;
    const me = state.players[aIdx];
    const all = [
      ...(me.active ? [me.active] : []),
      ...me.bench,
    ];
    for (const inst of all) {
      const c = pool.get(inst.cardId);
      if (!c) continue;
      if (c.subtype === 'ex' && c.name.startsWith('超級') && c.pokemonType === 'Darkness') {
        return 120;
      }
    }
    return 0;
  }],
]);

/**
 * v2.42 / v2.422 Bug fix：原本 engine 對 PASSIVE_ATTACK_BONUS 全部 dedup by ability 名
 *   （一張只算 1 次）。但卡面語意可分兩類：
 *
 *   (A) 「自己的 X 寶可夢使用的招式 +N」型 — 主語=友方所有符合的 attacker，
 *       per-source 疊加（場上 N 隻擁有特性者貢獻 +N×N）。例：輝煌聲援、力之鹽、
 *       皇家聲援、勝利聲援、鈷藍指令。
 *
 *   (B) 「這隻寶可夢使用的招式 +N」/「自己的『X』攻擊時」型 — 主語=擁有特性者
 *       本人（=attacker），條件式：場上有 1+ 符合的擁有特性者就觸發一次。
 *       fn 內通常有 `att.name === 'X'` gate；engine loop 對 bench 的同名也會
 *       invoke 一次 → 場上 2 隻同名 → 加倍，**錯誤**。需 dedup by name。
 *
 *   (C) 卡面明文「無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複」 —
 *       強制 NO_STACK。例：大方。
 *
 * 此 Set 列出 (B)+(C) 類；engine 對其餘特性允許 per-source 疊加。
 */
export const PASSIVE_ATTACK_NO_STACK: ReadonlySet<string> = new Set([
  '大方',      // (C) 赫普的卡比獸 — 卡面明文「不重複」
  '激動力量',  // (B) 飯匙蛇 — 「這隻寶可夢使用的招式」+ 條件式有【惡】Mega ex
  '大將',      // (B) 仆斬將軍 — 「這隻寶可夢使用的招式」依對手獎賞數
  '複眼',      // (B) 電蜘蛛 — 「自己的『電蜘蛛』攻擊時」對擁有特性的對手 +50
]);

/**
 * 特性名 → 判斷是否完全免疫此攻擊。
 *
 * v2.250 簽名擴充：可選回傳 `{ immune: boolean; newState: GameState }`，讓特性
 * 在判定免疫的同時 mutate state（例如「順滑大衣」需要寫硬幣 log）。
 * 既有 entry 回傳 boolean 仍向下相容；engine.ts loop 兩種型別都處理。
 *
 * 注意：engine 在算 baseDamage 路徑只會 invoke 一次此 check（line 2646-2654），
 * 不會被 UI 預覽多次呼叫，故含 Math.random() 的判定（順滑大衣）安全。
 */
export type ImmunityCheck = (
  attackerCard: Card,
  baseDamage: number,
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  defenderName?: string,
) => boolean | { immune: boolean; newState: GameState };
export const PASSIVE_IMMUNITY = new Map<string, ImmunityCheck>([
  // 奇麒麟ex 尾甲 — 免疫 Basic ex 招式
  ['尾甲', (att) => att.subtype === 'ex' && !att.evolvesFrom],
  // 厄鬼椪 礎石面具ex 礎石之勢 — 免疫有特性的寶可夢招式
  ['礎石之勢', (att) => !!att.abilities && att.abilities.length > 0],
  // 暴噬龜 鐵壁硬殼 — 免疫 ≥200 傷害
  ['鐵壁硬殼', (_att, baseDamage) => baseDamage >= 200],
  // 堅盾劍怪 神秘之盾 — 免疫 ex/V 招式
  // v3.67：改用 isRulePokemon helper（涵蓋 ex/V/VMAX/VSTAR/GX 與未來新規則類型）
  ['神秘之盾', (att) => isRulePokemon(att)],
  // v2.250 奇諾栗鼠ex 順滑大衣 — 受招式傷害時擲硬幣，正面則不受該傷害
  // v2.253 改用 flipCoinsWithLog（log 含「— 正面/反面」明確格式 → UI queue 觸發動畫）
  ['順滑大衣', (_att, _baseDmg, state, aIdx, _pool, defenderName) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const r = flipCoinsWithLog(state, 1, `${defenderName ?? '?'}｜順滑大衣`, dIdx);
    const newState = addLog(r.state,
      `${defenderName ?? '?'}｜順滑大衣：${r.heads ? '正面 → 免疫此招式傷害！' : '反面 → 受傷害'}`,
      dIdx);
    return { immune: !!r.heads, newState };
  }],
  // v2.267 wave 1：條件式免疫 ───────────────────────────────────────────
  // 岩殿居蟹｜神秘石居 — 「這隻寶可夢不會受到對手的『寶可夢【ex】』招式的傷害。」
  //   (SV9a Stage1 150HP) 卡面只擋傷害（不擋效果），跟「神秘之盾」不同（神秘之盾還擋 V/VMAX，
  //   PTCG 繁中版實務沒 V/VMAX）。
  ['神秘石居', (att) => att.subtype === 'ex'],
  // 美納斯ex｜璀璨鱗片 — 「這隻寶可夢不會受到對手的『太晶』寶可夢招式的傷害與效果的影響。」
  //   (SV8 Stage1 270HP) 太晶是 tags 元素（不是 subtype）。
  //   v2.267：先做擋傷害版本，「效果的影響」需要更廣的 hook（status / 拔能量 / 移指示物 等）
  //   暫不處理；如未來發現 bug 再加 PASSIVE_FULL_PROTECTION 類 set。
  ['璀璨鱗片', (att) => (att.tags ?? []).includes('太晶')],
  // v2.992 仙子伊布(H) | 神秘守護 — 不受對手 ex 招式的傷害
  // v3.67：改用 isRulePokemon helper
  ['神秘守護', (att) => isRulePokemon(att)],
]);

// v5.367：條件式完全免疫特性（神秘石居 / 神秘守護 / 璀璨鱗片 / 尾甲 / 全能硬殼 等「不受對手某類
//   寶可夢招式傷害」型 PASSIVE_IMMUNITY）— 原本只在 engine.ts 主傷害管線消費，凡是「手動結算傷害」
//   的招式 resolver（油之機關槍 / 各狙擊 / bench-hit）都繞過 → 玩家回報：岩殿居蟹 神秘石居 在備戰
//   （甚至戰鬥位）仍被 奧利瓦ex 油之機關槍 打到。此 helper 讓 resolveBenchGuard（bench）與各 resolver
//   的 active 分支共用同一判定。只認「純 boolean predicate」型 entry（依攻擊方屬性判定、無副作用）；
//   跳過「順滑大衣」這種擲幣 mutate state 的 entry（resolveBenchGuard 會被 UI 預覽呼叫，預覽不能擲幣）—
//   擲幣型免疫仍只在主管線（active 防守方）生效。
export function passiveImmunityDamageBlock(
  state: GameState,
  actorIdx: 0 | 1,
  targetCard: Card | undefined,
  pool: Map<string, Card>,
): { blocked: true; reason: string } | { blocked: false } {
  if (!targetCard?.abilities) return { blocked: false };
  // v5.471：鐵荊棘ex 初始化消除規則寶可夢(未來除外)特性 → 此免疫特性失效
  if (isInitializeNullified(state, targetCard, pool)) return { blocked: false };
  // 監視塔對【無】寶可夢特性壓制（鏡射 engine.ts isColorlessAbilityBlocked）
  if (targetCard.pokemonType === 'Colorless') {
    const sd = state.activeStadium;
    const sdCard = sd ? pool.get(sd.cardId) : undefined;
    if (sdCard && ROCKET_WATCHTOWER_STADIUMS.has(sdCard.name)) return { blocked: false };
  }
  const atkInst = state.players[actorIdx].active;
  const atkCard = atkInst ? pool.get(atkInst.cardId) : undefined;
  if (!atkCard) return { blocked: false };
  for (const ab of targetCard.abilities) {
    if (ab.name === '順滑大衣') continue; // 擲幣型，有副作用，不在無狀態/預覽 guard 內呼叫
    const immune = PASSIVE_IMMUNITY.get(ab.name);
    if (!immune) continue;
    const result = immune(atkCard, 1, state, actorIdx, pool, targetCard.name);
    if (result === true) {
      return { blocked: true, reason: `${ab.name}（不受對手該寶可夢招式的傷害）` };
    }
  }
  return { blocked: false };
}

// v5.368：擲幣型 PASSIVE_IMMUNITY（順滑大衣：受傷害時擲幣，正面則不受該傷害）— 卡面未限戰鬥場，
//   備戰被狙擊/分配傷害打到時也該擲幣。擲幣會 mutate state（寫硬幣 log），**只能在真正結算傷害的
//   resolver 內呼叫**，不可放進會被 UI 預覽呼叫的 resolveBenchGuard / passiveImmunityDamageBlock。
//   只處理「回傳物件（{immune,newState}）」型 entry（擲幣/有狀態）；純 boolean entry 由
//   passiveImmunityDamageBlock 處理，此處呼叫到也無副作用。
export function passiveCoinImmunity(
  state: GameState,
  actorIdx: 0 | 1,
  targetCard: Card | undefined,
  pool: Map<string, Card>,
): { immune: boolean; state: GameState } {
  let s = state;
  if (!targetCard?.abilities) return { immune: false, state: s };
  if (targetCard.pokemonType === 'Colorless') {
    const sd = s.activeStadium;
    const sdCard = sd ? pool.get(sd.cardId) : undefined;
    if (sdCard && ROCKET_WATCHTOWER_STADIUMS.has(sdCard.name)) return { immune: false, state: s };
  }
  const atkInst = s.players[actorIdx].active;
  const atkCard = atkInst ? pool.get(atkInst.cardId) : undefined;
  if (!atkCard) return { immune: false, state: s };
  for (const ab of targetCard.abilities) {
    const immune = PASSIVE_IMMUNITY.get(ab.name);
    if (!immune) continue;
    const result = immune(atkCard, 1, s, actorIdx, pool, targetCard.name);
    if (typeof result !== 'boolean') {
      s = result.newState;
      if (result.immune) return { immune: true, state: s };
    }
  }
  return { immune: false, state: s };
}

// v5.368：手動結算傷害招式（m5 各狙擊等）的統一傷害免疫 guard。組合中立中心（active+bench）＋
//   bench 走 resolveBenchGuard（球形盾牌/花之帷幔/太晶/化石/v5.367 神秘石居等 boolean 免疫）／
//   active 走 passiveImmunityDamageBlock（boolean）＋ 擲幣型 passiveCoinImmunity。threads state。
//   只在真結算呼叫，不可用於預覽。
export function manualDamageImmunity(
  state: GameState,
  actorIdx: 0 | 1,
  targetCard: Card | undefined,
  pool: Map<string, Card>,
  isBench: boolean,
): { blocked: boolean; reason?: string; state: GameState } {
  let s = state;
  const atkInst = s.players[actorIdx].active;
  const atkCard = atkInst ? pool.get(atkInst.cardId) : undefined;
  if (wouldNeutralCenterBlock(s, pool, atkCard, targetCard)) {
    return { blocked: true, reason: '中立中心競技場 效果', state: s };
  }
  if (isBench) {
    const g = resolveBenchGuard(s, pool, actorIdx, targetCard, 'attack-damage');
    if (g.blocked) return { blocked: true, reason: g.reason, state: s };
  } else {
    const pb = passiveImmunityDamageBlock(s, actorIdx, targetCard, pool);
    if (pb.blocked) return { blocked: true, reason: pb.reason, state: s };
  }
  const coin = passiveCoinImmunity(s, actorIdx, targetCard, pool);
  s = coin.state;
  if (coin.immune) return { blocked: true, reason: '擲幣免疫（正面）', state: s };
  return { blocked: false, state: s };
}

// ══════════════════════════════════════════════════════════════════════════════
// v2.277 Wave 3 — 被動特性：撤退成本修正（ABILITY_RETREAT_MOD）
// ══════════════════════════════════════════════════════════════════════════════
//
// 撤退成本修正類特性（不屬於招式效果，而是 passive ability）。engine 在 canRetreat
// + RETREAT handler 兩處呼叫，在 TOOL_RETREAT_MOD / SPECIAL_ENERGY_RETREAT_MOD /
// 重力之玉 / 天空徑線 / N的城堡 / 樂園度假地 等 inline hook 之後套用，作為最後一層。
//
// 套用順序：
//   先彙總所有 entry 的 r.zero / r.reduceBy / r.addBy
//   1) 任一 zero → cost = 0
//   2) cost = max(0, cost - sum(reduceBy))
//   3) cost = cost + sum(addBy)
//
// 這個順序處理「鋼之橋（zero）vs 大網（addBy）」並存的情況：
//   鋼之橋先把 cost 歸零，大網再加 1 → 最終 cost = 1。
//
// 火箭監視塔（【無】寶可夢特性無效）／可達鴨濕氣（自 KO 特性無效）等 disable hook
// 不需檢查（ABILITY_RETREAT_MOD 不會用在【無】屬特性，也不是「自我 KO」類），
// engine 套用時也不必特別 gate。
export type AbilityRetreatModParams = {
  /** 持有此特性的寶可夢實例 */
  holderInst: CardInstance;
  /** 持有此特性的寶可夢卡片資料 */
  holderCard: Card;
  /** 持有者位置：active 或 bench */
  holderPosition: 'active' | 'bench';
  /** 持有者所屬玩家 index */
  holderOwnerIdx: 0 | 1;
  /** 正在撤退的寶可夢實例（總是某玩家的 active） */
  retreatingInst: CardInstance;
  /** 正在撤退的寶可夢卡片資料 */
  retreatingCard: Card;
  /** 撤退者所屬玩家 index */
  retreatingOwnerIdx: 0 | 1;
  state: GameState;
  pool: Map<string, Card>;
  /** engine 注入：取得寶可夢身上各屬性能量數量（含特殊能量處理） */
  countEnergy: (inst: CardInstance) => Map<string, number>;
};

export const ABILITY_RETREAT_MOD = new Map<string, (
  p: AbilityRetreatModParams
) => { zero?: boolean; reduceBy?: number; addBy?: number }>([
  // 小火龍｜一身輕（M2/M-P-I）—
  //   「若這隻寶可夢身上沒有附加能量卡，則這隻寶可夢【撤退】所需的能量全部消除。」
  //   只對自身生效；holder 必須等於 retreating（即小火龍自己上場時撤退）。
  ['一身輕', (p) => {
    if (p.holderInst.iid !== p.retreatingInst.iid) return {};
    if (p.retreatingInst.energyAttached.length > 0) return {};
    return { zero: true };
  }],

  // v5.297 莫魯貝可（SV8a）｜飢餓衝刺 — 同一身輕邏輯
  //   「若這隻寶可夢身上沒有附加能量卡，則這隻寶可夢【撤退】所需的能量全部消除。」
  ['飢餓衝刺', (p) => {
    if (p.holderInst.iid !== p.retreatingInst.iid) return {};
    if (p.retreatingInst.energyAttached.length > 0) return {};
    return { zero: true };
  }],

  // 阿響的熔岩蝸牛｜溶化流動（M2a/SV9a）— 與一身輕同效果
  ['溶化流動', (p) => {
    if (p.holderInst.iid !== p.retreatingInst.iid) return {};
    if (p.retreatingInst.energyAttached.length > 0) return {};
    return { zero: true };
  }],

  // 鋁鋼橋龍｜鋼之橋（MC/SV7/SV8a）—
  //   「只要這隻寶可夢在場上，自己的所有身上附有【鋼】能量的寶可夢
  //    【撤退】所需的能量全部消除。」
  //   - 持有者只要在自己場上（active 或 bench）即生效。
  //   - 撤退者必須是同陣營，且身上至少 1 個 Metal 能量單位。
  //     使用 countEnergy 取得能量類型 map，可正確處理特殊能量（如反偷襲能量）。
  ['鋼之橋', (p) => {
    if (p.holderOwnerIdx !== p.retreatingOwnerIdx) return {};
    const energyMap = p.countEnergy(p.retreatingInst);
    if ((energyMap.get('Metal') ?? 0) < 1) return {};
    return { zero: true };
  }],

  // 陸地水母｜森林秘道（SVM）—
  //   「只要這隻寶可夢在備戰區，自己的戰鬥寶可夢【撤退】所需的能量減少 2 個。」
  //   - 持有者必須在自己備戰區（不在戰鬥場）。
  //   - 撤退者必須同陣營（撤退者一定是 active，所以條件天然成立）。
  ['森林秘道', (p) => {
    if (p.holderOwnerIdx !== p.retreatingOwnerIdx) return {};
    if (p.holderPosition !== 'bench') return {};
    return { reduceBy: 2 };
  }],

  // 阿利多斯｜大網（SV5a）—
  //   「只要這隻寶可夢在場上，對手的戰鬥場的進化寶可夢【撤退】所需的能量增加 1 個。」
  //   - 持有者只要在自己場上（active 或 bench）即生效。
  //   - 撤退者必須是對手且為進化寶可夢（有 evolvesFrom）。
  ['大網', (p) => {
    if (p.holderOwnerIdx === p.retreatingOwnerIdx) return {};
    if (!p.retreatingCard.evolvesFrom) return {};
    return { addBy: 1 };
  }],

  // 超級水晶燈火靈ex｜咒縛之炎（v4.88 / M5）—
  //   「只要這隻寶可夢在場上，對手的戰鬥寶可夢撤退所需的能量數增加 1 個。」
  //   - 持有者只要在自己場上（active 或 bench）即生效。
  //   - 撤退者必須是對手（無進化條件，所有對手戰鬥場撤退 +1）。
  ['咒縛火焰', (p) => {
    if (p.holderOwnerIdx === p.retreatingOwnerIdx) return {};
    return { addBy: 1 };
  }],
]);

// ══════════════════════════════════════════════════════════════════════════════
// Session 32 H12 — 被動特性：受傷反擊（中毒/灼傷/放指示物）
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// Stadium resolvers → v2.10 搬到 effects/cards/stadiums.ts
// ══════════════════════════════════════════════════════════════════════════════
// night-academy-top / moonlight-hill-heal regR 已移至 stadiums.ts

/** 特性名 → 受到招式傷害後對攻擊者的反擊（在 engine 裡呼叫）*/
export type RetaliationFn = (
  state: GameState,
  dIdx: 0 | 1,  // 被攻擊者 index
  pool: Map<string, Card>,
  defSnapshot?: CardInstance | null  // v5.548 KO 安全：holder 被擊倒時 state.players[dIdx].active 已 null，傳入受傷前快照
) => GameState;
export const PASSIVE_RETALIATION = new Map<string, RetaliationFn>([
  // 毒薔薇 / 羅絲雷朵 毒刺 — 攻擊者中毒
  ['毒刺', (state, dIdx) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active && !att.active.status) att.active = { ...att.active, status: 'poisoned' };
    players[aIdx] = att;
    return { ...state, players };
  }],
  // 席多藍恩 灼熱之軀 — 攻擊者灼傷
  ['灼熱之軀', (state, dIdx) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active && !att.active.status) att.active = { ...att.active, status: 'burned' };
    players[aIdx] = att;
    return { ...state, players };
  }],
  // 磨牙彩皮魚 反擊 — 攻擊者放 3 個傷害指示物（= 30 傷害）
  ['反擊', (state, dIdx) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, damage: att.active.damage + 30 };
    players[aIdx] = att;
    return { ...state, players };
  }],
  // v2.217 布里卡隆（J）｜尖刺盔甲 — 受到傷害時，將「自己身上【草】能量數×3」個傷害指示物
  // 放置於攻擊者身上。換算：N 張草能量 → N × 3 × 10 = N × 30 傷害。
  // 注意：是「能量卡張數」而非「能量單位數」（一張能量卡通常 = 1 個能量單位）。
  ['尖刺盔甲', (state, dIdx, pool, defSnapshot) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const def = defSnapshot ?? state.players[dIdx].active;
    if (!def) return state;
    // v5.439：改走中央 countEnergyTypeBloomAware（補大竺葵|繁茂：基本草×2）。
    //   官方 Q&A：布里卡隆附 2 張基本草 + 繁茂 → 視為 4 → 放 12 個指示物(4×3)。
    const grassCount = countEnergyTypeBloomAware(def, 'Grass', state, dIdx, pool);
    if (grassCount === 0) return state;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      const dmg = grassCount * 30;
      att.active = { ...att.active, damage: att.active.damage + dmg };
      players[aIdx] = att;
      const defName = pool.get(def.cardId)?.name ?? '?';
      const attName = pool.get(att.active.cardId)?.name ?? '?';
      return addLog({ ...state, players },
        `尖刺盔甲：${defName} 草能量 ${grassCount} 張 → 對 ${attName} 造成 ${dmg} 傷害（${grassCount}×3 個傷害指示物）`,
        dIdx);
    }
    return state;
  }],
  // v2.268 wave 2：被動反擊類（defender 持有此特性 → 反擊攻擊者）─────────
  // 花岩怪｜怨恨旋渦 (MC Basic 80HP, Darkness)
  // 卡面：「只要這隻寶可夢在場上，自己戰鬥場的【惡】寶可夢受到對手的寶可夢招式的傷害時，
  //   在使用招式的寶可夢身上放置 1 個傷害指示物。」
  // 簡化：本實裝以「持有者本身在 active 被打」觸發（持有者必為【惡】，符合卡面 active 條件）。
  //   若日後需 field-wide（持有者在備戰時 active 是其他【惡】寶可夢也觸發），需擴 hook。
  ['怨恨旋渦', (state, dIdx, pool, defSnapshot) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const def = defSnapshot ?? state.players[dIdx].active;
    if (!def) return state;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      att.active = { ...att.active, damage: att.active.damage + 10 };
      players[aIdx] = att;
      const attName = pool.get(att.active.cardId)?.name ?? '?';
      return addLog({ ...state, players },
        `怨恨旋渦：${attName} 身上放置 1 個傷害指示物（+10）`,
        dIdx);
    }
    return state;
  }],
  // 爆焰龜獸｜甲殼刺 (M3 Basic 120HP, Fire)
  // 卡面：「這隻寶可夢在戰鬥場上受到對手的寶可夢招式的傷害時，選擇 1 個使用招式的寶可夢身上附加的能量，將其丟棄。」
  // v5.069：完整實裝 — 改 picker（v5.066 龐克頭盔反擊、v5.067 沉重接力棒
  //   證明引擎支援「對手回合內 defender 觸發 pendingSelection」）。actorIdx=dIdx
  //   (爆焰龜獸 owner)，sourcePlayerIdx=aIdx (對手戰鬥位)，picker 顯示對手 active
  //   的全部 energyAttached，玩家選 1 張丟。卡面寫「選擇」=玩家自選，符合 Rule 15。
  ['甲殼刺', (state, dIdx, pool) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    const s = addLog(state,
      `甲殼刺：請選擇 ${attName} 身上 1 張能量丟棄`,
      dIdx);
    return withPending(s, {
      type: 'active-energy-discard',
      actorIdx: dIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'spike-shell-discard',
      params: { titleOverride: `甲殼刺：選擇 1 張對手 ${attName} 身上的能量丟棄` },
    });
  }],
  // 超級頭巾混混ex｜反擊雞冠 (M2a Stage1 330HP, Darkness)
  // 卡面：「這隻寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，在使用招式的寶可夢身上放置 5 個傷害指示物。」
  ['反擊雞冠', (state, dIdx, pool) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      att.active = { ...att.active, damage: att.active.damage + 50 };
      players[aIdx] = att;
      const attName = pool.get(att.active.cardId)?.name ?? '?';
      return addLog({ ...state, players },
        `反擊雞冠：${attName} 身上放置 5 個傷害指示物（+50）`,
        dIdx);
    }
    return state;
  }],
  // v2.992 Group 1 反擊
  // 鐵脖頸(H) | 自動用武 — 戰鬥場受傷時放 3 指示物到攻擊者
  ['自動用武', (state, dIdx, pool) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      att.active = { ...att.active, damage: att.active.damage + 30 };
      players[aIdx] = att;
      const attName = pool.get(att.active.cardId)?.name ?? '?';
      return addLog({ ...state, players },
        `自動用武：${attName} 身上放置 3 個傷害指示物（+30）`,
        dIdx);
    }
    return state;
  }],
  // 赫普的啪嚓海膽ex(I) | 反擊針 — 戰鬥場受傷時放 3 指示物到攻擊者
  ['反擊針', (state, dIdx, pool) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      att.active = { ...att.active, damage: att.active.damage + 30 };
      players[aIdx] = att;
      const attName = pool.get(att.active.cardId)?.name ?? '?';
      return addLog({ ...state, players },
        `反擊針：${attName} 身上放置 3 個傷害指示物（+30）`,
        dIdx);
    }
    return state;
  }],
  // 拖拖蚓ex(H) | 快掃拳返 — 受傷時放 (鋼能量數×2) 個指示物
  ['快掃拳返', (state, dIdx, pool, defSnapshot) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const def = defSnapshot ?? state.players[dIdx].active;
    if (!def) return state;
    const metalCount = def.energyAttached.filter(e => {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') return false;
      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Metal' || /【鋼】/.test(ec.name))) return true;
      if (ec.pokemonType === 'Metal') return true;
      return false;
    }).length;
    if (metalCount === 0) return state;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const counters = metalCount * 2;
    const dmg = counters * 10;
    att.active = { ...att.active, damage: att.active.damage + dmg };
    players[aIdx] = att;
    const attName = pool.get(att.active.cardId)?.name ?? '?';
    return addLog({ ...state, players },
      `快掃拳返：鋼能量 ${metalCount} 個 → ${attName} 身上放置 ${counters} 個傷害指示物（+${dmg}）`,
      dIdx);
  }],
]);

// ════════════════════════════════════════════════════════════════════════════
// v5.494 INHERENT_RETALIATION — 寶可夢「卡面內建」受傷反擊（非特性／非道具／非能量）
//   目前唯一：陳舊的頭蓋化石（化石作為 HP60【無】屬性【基礎】寶可夢放置於場上）。
//   卡面：「這隻寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，在使用招式的寶可夢
//          身上放置 3 個傷害指示物。」（= 30 傷害）
//   ★ 與 PASSIVE_RETALIATION 差異：化石**無 abilities 陣列**，反擊主迴圈只掃
//      defenderCard.abilities → 永遠抓不到 → 玩家回報「沒在攻擊方放 3 個指示物」。
//      故必須**按卡名**獨立判定（key = 卡名 → counters）。
//   ★ 非特性 → **不受「光之翼」**（不受對手特性效果影響）阻擋；光之翼只擋 ability 型反擊。
//   ★ 依 PTCG 規則「受到傷害時」**含 KO 情境**（同龐克頭盔 v5.080）→ KO/非KO 兩分支都套。
//   ★ 卡面「在戰鬥場」→ 只在化石位於戰鬥場（active）受傷時觸發；備戰被狙擊不觸發
//      （三處呼叫點都在防守方 active 受招式傷害的路徑，天然符合）。
// ════════════════════════════════════════════════════════════════════════════
export const INHERENT_RETALIATION = new Map<string, number>([
  ['陳舊的頭蓋化石', 3], // 在攻擊方放 3 個傷害指示物（30 傷害）
]);

/**
 * 套用「卡面內建受傷反擊」：依防守方卡名在 INHERENT_RETALIATION 查 counters，
 * 於攻擊方戰鬥位放置該數量傷害指示物。
 * @param defenderCard 防守方（受傷化石）的卡片 — **由呼叫端傳入**，不從 state 讀 active，
 *        因為 KO 分支呼叫時化石可能已被移除（active=null）。
 * 反殺攻擊方（30 傷害剛好打死攻擊方）沿用既有 sanityKOSweep / 反彈擊倒檢查，與尖刺盔甲同。
 */
export function applyInherentRetaliation(
  state: GameState, dIdx: 0 | 1, defenderCard: Card | null | undefined, pool: Map<string, Card>,
): GameState {
  const counters = defenderCard ? INHERENT_RETALIATION.get(defenderCard.name) : undefined;
  if (!counters) return state;
  const aIdx = (1 - dIdx) as 0 | 1;
  if (!state.players[aIdx].active) return state; // 攻擊方無戰鬥寶可夢（理論上不會，保險）
  const players = [...state.players] as [PlayerState, PlayerState];
  const dmg = counters * 10;
  players[aIdx] = {
    ...players[aIdx],
    active: { ...players[aIdx].active!, damage: players[aIdx].active!.damage + dmg },
  };
  const attName = pool.get(players[aIdx].active!.cardId)?.name ?? '攻擊方';
  return addLog({ ...state, players },
    `${defenderCard!.name}：在 ${attName} 身上放置 ${counters} 個傷害指示物（${dmg} 傷害）`, dIdx);
}

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H10 — 更多通用訓練家（Item + Supporter）
// ══════════════════════════════════════════════════════════════════════════════

// 寶可生機劑A — 回 150 HP（物品）
regG('寶可生機劑A', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('寶可生機劑A', (st, idx) => {
  st = addLog(st, '寶可生機劑A：選擇回復 150 HP 的寶可夢', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'heal-150',
    params: { healAmount: 150, discardEnergy: 0 },
  });
});
regR('heal-150', healResolver);

// v3.68 寶可夢中心的姐姐 — 1 隻寶可夢回 60 HP + 解除所有特殊狀態（支援者）
// 卡面：「將自己的 1 隻寶可夢恢復『60』HP，特殊狀態也全部恢復。」
// 歷史：v2.199 已經把 healResolver 升級支援 clearStatus 參數（line 739），
//   但忘了寫 reg() 註冊 → 整張卡停在 stub 狀態到 v3.68 才補完。
// JSON 修正：原 SV-P-I.json name 開頭有 U+200C zero-width joiner 字元
//   （scraper artifact），v3.68 同步清掉，卡名 search / reg() 才能對齊。
regG('寶可夢中心的姐姐', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0 || c.status || c.secondaryStatus);
});
reg('寶可夢中心的姐姐', (st, idx) => {
  st = addLog(st, '寶可夢中心的姐姐：選 1 隻寶可夢回 60 HP + 解除所有特殊狀態', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'pokemon-center-lady-heal',
    params: { healAmount: 60, discardEnergy: 0, clearStatus: true,
              titleOverride: '寶可夢中心的姐姐：選 1 隻寶可夢回 60 HP + 解狀態' },
  });
});
regR('pokemon-center-lady-heal', healResolver);

// 危險光線 — 對手戰鬥寶可夢同時陷入【灼傷】+【混亂】（v2.163 完整實裝）
// v5.674 收斂：改走中央 applyStatusToOppActive（kind:'item-effect'），一勞永逸處理
//   ① 狀態欄位（status 主格 / secondaryStatus）的雙格共存與保留既有狀態（applyStatusToActive）
//   ② 來源無關免疫：憨憨臉（混亂）/ 特殊能量泡沫【水】/ 祭典會場
//   ③ 危險光線是【道具】，化隱／純樸只擋「對手招式或特性效果」→ 不該擋道具
//      （原 v5.444 誤加 canApplyEffectToTarget('attack-effect') 化隱 gate，Wilson 裁定移除）
// 約定：行動類狀態（混亂）放 status 主格；傷害類狀態（灼傷）放 secondaryStatus（helper 自動處理）。
regG('危險光線', (st, idx) => !!st.players[(1-idx) as 0|1].active);
reg('危險光線', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  if (!st.players[dIdx].active) return st;
  // 先灼傷、再混亂；各自處理自身免疫（特殊能量/憨憨臉/祭典會場）與欄位放置。
  let s = applyStatusToOppActive(st, idx, 'burned', pool, { kind: 'item-effect', label: '危險光線' });
  s = applyStatusToOppActive(s, idx, 'confused', pool, { kind: 'item-effect', label: '危險光線' });
  return s;
});

// 推理組合 — 卡面：看牌庫頂 3 張，二選一：(A) 以任意順序排列放回頂；(B) 全部翻反洗回底
// v2.164：完整實裝（modal-choice 二選一 → A 路徑開 reorder-deck-top）
regG('推理組合', (st, idx) => st.players[idx].deck.length > 0);
reg('推理組合', (st, idx, _pool) => {
  const topN = Math.min(3, st.players[idx].deck.length);
  st = addLog(st, `推理組合：選擇處理牌庫頂 ${topN} 張的方式`, idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'inference-combination-choice',
    params: {
      label: '推理組合',
      options: [
        { id: 'reorder', text: `①以任意順序排列頂 ${topN} 張，放回牌庫上方` },
        { id: 'shuffle-bottom', text: `②將頂 ${topN} 張翻反並重洗，放回牌庫下方` },
      ],
    },
  });
});
regR('inference-combination-choice', (state, aIdx, iids, _params, _pool) => {
  const choice = iids[0];
  const player = state.players[aIdx];
  const topN = Math.min(3, player.deck.length);
  const topCards = player.deck.slice(0, topN);
  if (choice === 'shuffle-bottom') {
    // (B) 全部翻反洗回底
    state = addLog(state, `推理組合：將牌庫頂 ${topN} 張翻反並重洗放回下方`, aIdx);
    return updatePlayer(state, aIdx, p => {
      const rest = p.deck.slice(topN);
      return { ...p, deck: [...shuffle(rest), ...shuffle(topCards)] };
    });
  }
  // (A) 排序放回頂 — 開 reorder-deck-top picker
  state = addLog(state, `推理組合：排序牌庫頂 ${topN} 張`, aIdx);
  return withPending(state, {
    type: 'reorder-deck-top',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: topN, maxCount: topN,  // 必須全部保留
    effectKey: 'reorder-deck-top-apply',
    params: {
      candidateIids: topCards.map(c => c.iid),
      allowDiscard: false,
      titleOverride: '推理組合：排序牌庫頂',
    },
  });
});

// 奇跡耳麥 — 從棄牌取最多 2 張支援者加手牌
regG('奇跡耳麥', (st, idx, pool) =>
  st.players[idx].discard.some(c => pool.get(c.cardId)?.subtype === 'Supporter')
);
reg('奇跡耳麥', (st, idx) => {
  st = addLog(st, '奇跡耳麥：從棄牌選最多 2 張支援者加手牌', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter', minCount: 0, maxCount: 2,
    effectKey: 'discard-to-hand',
  });
});

// 反擊捕捉器 — 自己獎賞多時可用，呼叫對手備戰
// v5.700：物品卡強制換位 → 過濾「緊張感/融合為雪」免疫的對手備戰。
regG('反擊捕捉器', (st, idx, pool) =>
  st.players[idx].prizes.length > st.players[(1-idx) as 0|1].prizes.length &&
  st.players[(1-idx) as 0|1].bench.some(b => !_gustImmuneTrainer(b, pool))
);
reg('反擊捕捉器', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const validIids = st.players[oppIdx].bench.filter(b => !_gustImmuneTrainer(b, pool)).map(b => b.iid);
  if (validIids.length === 0) return addLog(st, '反擊捕捉器：對手備戰沒有可呼叫的寶可夢（緊張感/融合為雪 免疫）', idx);
  st = addLog(st, '反擊捕捉器：選對手備戰與戰鬥寶可夢互換', idx);
  return withPending(st, {
    type: 'opp-bench-choose', actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1, effectKey: 'gust-opp', params: { validIids },
  });
});

// ── 鬼之假面（Item, SV6/SV8a/MC）— 從棄牌區選 1 張「厄鬼椪 ex」與場上 1 隻「厄鬼椪 ex」互換 ──
//   卡面：從自己棄牌區選 1 張名稱含「厄鬼椪」的「寶可夢ex」，與自己場上 1 隻名稱含「厄鬼椪」的
//   「寶可夢ex」互換（所附加的卡・傷害指示物・特殊狀態・效果全部保留），將換下的寶可夢丟棄。
//   實作：兩段 picker（棄牌→場上,皆用 validIids 限定只能選厄鬼椪ex）；互換=場上 instance 保留 iid
//   與全部附加物只換 cardId（新底牌上場）,換下的裸底牌進棄牌（重用被選棄牌卡已釋出的 iid）。
const _isOgerponEx = (c: Card | undefined): boolean =>
  !!c && c.supertype === 'Pokemon' && c.subtype === 'ex' && c.name.includes('厄鬼椪');
regG('鬼之假面', (st, idx, pool) => {
  const me = st.players[idx];
  const inDiscard = me.discard.some(c => _isOgerponEx(pool.get(c.cardId)));
  const onField = [me.active, ...me.bench].some(p => !!p && _isOgerponEx(pool.get(p.cardId)));
  return inDiscard && onField;
});
reg('鬼之假面', (st, idx, pool) => {
  const me = st.players[idx];
  const validDiscard = me.discard.filter(c => _isOgerponEx(pool.get(c.cardId))).map(c => c.iid);
  st = addLog(st, '鬼之假面：從棄牌區選擇 1 張「厄鬼椪 ex」', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 1, maxCount: 1,
    effectKey: 'ghost-mask-pick-field',
    params: { validIids: validDiscard },
  });
});
regR('ghost-mask-pick-field', (st, idx, picked, _params, pool) => {
  const discardIid = picked[0];
  if (!discardIid) return st;
  const me = st.players[idx];
  const dc = me.discard.find(c => c.iid === discardIid);
  if (!dc || !_isOgerponEx(pool.get(dc.cardId))) return addLog(st, '鬼之假面：選擇無效，取消', idx);
  const validField = [me.active, ...me.bench]
    .filter((p): p is CardInstance => !!p && _isOgerponEx(pool.get(p.cardId)))
    .map(p => p.iid);
  if (validField.length === 0) return addLog(st, '鬼之假面：場上沒有「厄鬼椪 ex」可互換', idx);
  st = addLog(st, '鬼之假面：選擇場上 1 隻「厄鬼椪 ex」與其互換', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'ghost-mask-swap',
    params: { discardIid, validIids: validField },
  });
});
regR('ghost-mask-swap', (st, idx, picked, params, pool) => {
  const fieldIid = picked[0];
  const discardIid = params?.discardIid as string | undefined;
  if (!fieldIid || !discardIid) return st;
  const me = st.players[idx];
  const discardCard = me.discard.find(c => c.iid === discardIid);
  const fieldInst = me.active?.iid === fieldIid ? me.active : me.bench.find(b => b.iid === fieldIid);
  if (!discardCard || !fieldInst
      || !_isOgerponEx(pool.get(discardCard.cardId)) || !_isOgerponEx(pool.get(fieldInst.cardId))) {
    return addLog(st, '鬼之假面：互換目標已失效，取消', idx);
  }
  const newName = pool.get(discardCard.cardId)?.name ?? '?';
  const oldName = pool.get(fieldInst.cardId)?.name ?? '?';
  // 新場上底牌：保留場上 instance 的 iid + 全部附加物/傷害/狀態/旗標，只換 cardId
  const newFieldInst: CardInstance = { ...fieldInst, cardId: discardCard.cardId, abilityUsedThisTurn: abilityUsedAfterSwap(fieldInst, pool.get(fieldInst.cardId), pool.get(discardCard.cardId)) };  // v5.625 官方QA：特性已使用以名稱保留
  // 換下的裸底牌：重用被選棄牌卡的 iid(已釋出,因 newFieldInst 用場上 iid)，附加物全留給新底牌
  const swappedOutBare: CardInstance = { ...discardCard, cardId: fieldInst.cardId };
  st = updatePlayer(st, idx, p => ({
    ...p,
    active: p.active && p.active.iid === fieldIid ? newFieldInst : p.active,
    bench: p.bench.map(b => b.iid === fieldIid ? newFieldInst : b),
    discard: [...p.discard.filter(c => c.iid !== discardIid), swappedOutBare],
  }));
  st = addLog(st, `鬼之假面：${oldName} 與棄牌區的 ${newName} 互換（保留所有附加物），${oldName} 丟棄`, idx);
  return st;
});

// 釣竿MAX — 棄牌取最多 5 張寶可夢或基本能量
// v2.43 修：卡面寫「寶可夢卡與『基本能量』卡合計最多5張」，原本 filter: 'PokemonOrEnergy'
// （含 Special Energy）違反卡面。改成 PokemonOrBasicEnergy；guard 也比照調整。
regG('釣竿MAX', (st, idx, pool) =>
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Pokemon') return true;
    if (card?.supertype === 'Energy' && card.subtype === 'Basic') return true;
    return false;
  })
);
reg('釣竿MAX', (st, idx) => {
  st = addLog(st, '釣竿MAX：從棄牌選最多 5 張寶可夢或基本能量加手牌', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonOrBasicEnergy', minCount: 0, maxCount: 5,
    effectKey: 'discard-to-hand',
  });
});

// 超級能量回收 — 丟 2 手牌 + 棄牌取最多 4 張基本能量
// v2.43 修：guard 原本寫 supertype==='Energy'（含 Special Energy）— 只剩 Special Energy 時
// 仍會讓 UI 顯示「可打出」，但 step2 的 BasicEnergy filter 會讓玩家卡在空選擇上。
regG('超級能量回收', (st, idx, pool) =>
  st.players[idx].hand.length >= 3 &&
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  })
);
reg('超級能量回收', (st, idx) => {
  st = addLog(st, '超級能量回收：選 2 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2, effectKey: 'super-energy-step2',
  });
});
regR('super-energy-step2', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `超級能量回收：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 0, maxCount: 4,
    effectKey: 'discard-to-hand',
  });
});

// 大地之容器 — 丟 1 手牌 + 搜最多 2 張基本能量
regG('大地之容器', (st, idx) => st.players[idx].hand.length >= 2);
reg('大地之容器', (st, idx) => {
  st = addLog(st, '大地之容器：選 1 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'earth-pot-step2',
  });
});
regR('earth-pot-step2', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `大地之容器：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 0, maxCount: 2,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// MJ 超級球 — 看牌庫頂 7 選 1 寶可夢加手牌
reg('超級球', (st, idx, pool) => {
  st = addLog(st, '超級球：從牌庫選 1 張寶可夢加手牌', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無寶可夢時允許 Pass
  const hasPoke = st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 黑連（支援者）— 抽 3
reg('黑連', (st, idx) => updatePlayer(addLog(st, '黑連：抽 3 張', idx), idx, p => {
  const taken = p.deck.slice(0, 3);
  return { ...p, deck: p.deck.slice(3), hand: [...p.hand, ...taken] };
}));

// 野餐女孩 — 擲硬幣 正面抽 4 反面抽 2
reg('野餐女孩', (st, idx) => {
  const r = flipCoinsWithLog(st, 1, '野餐女孩', idx);
  const n = r.heads ? 4 : 2;
  st = addLog(r.state, `野餐女孩：${r.heads ? '正面' : '反面'} → 抽 ${n} 張`, idx);
  return updatePlayer(st, idx, p => {
    const taken = p.deck.slice(0, n);
    return { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...taken] };
  });
});

// 仙后 — 手牌只有這 1 張才可用，搜 2 張任意卡
regG('仙后', (st, idx) => st.players[idx].hand.length === 1);
reg('仙后', (st, idx) => {
  st = addLog(st, '仙后：從牌庫選最多 2 張卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: '', minCount: 0, maxCount: 2,
    effectKey: 'search-to-hand-reshuffle',
    // v2.993：仙后卡面無「給對手看過」→ 私下揭示
    params: { privateReveal: true },
  });
});

// 庫瑟洛斯奇的企圖 — 對手手牌丟至 3 張
// v3.999：改為 hand-discard picker，actorIdx=oppIdx 讓被作用的對手自己選要丟哪些
//   原 v2 簡化實裝用 p.hand.slice(-discardN) 自動取最後 N 張，違反 Rule 7「嚴禁簡化實裝」+
//   PTCG 規則：自己手牌要丟的卡永遠由持有手牌的玩家自己選擇（卡面：「對手將對手自己的手牌丟棄」）
reg('庫瑟洛斯奇的企圖', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  if (opp.hand.length <= 3) {
    return addLog(st, '庫瑟洛斯奇的企圖：對手手牌已 ≤ 3 張，無需丟棄', idx);
  }
  const discardN = opp.hand.length - 3;
  st = addLog(st, `庫瑟洛斯奇的企圖：對手將自己的手牌丟棄 ${discardN} 張至 3 張`, idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: oppIdx,         // ← 對手自己選
    sourcePlayerIdx: oppIdx,
    minCount: discardN,
    maxCount: discardN,
    effectKey: 'opp-hand-discard-to-3',
    params: { titleOverride: `庫瑟洛斯奇的企圖：選擇要丟棄的 ${discardN} 張手牌（丟到剩 3 張）` },
  });
});
regR('opp-hand-discard-to-3', (st, idx, iids, _params, pool) => {
  // idx 是 actor = 被作用的對手；丟掉 iids 對應的手牌。棄牌區公開 → log 顯示被丟卡名
  const _khNames = st.players[idx].hand.filter(c => iids.includes(c.iid)).map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return updatePlayer(addLog(
    st,
    `庫瑟洛斯奇的企圖：對手丟棄手牌 ${iids.length} 張 — ${_khNames}`,
    idx,
  ), idx, p => {
    const discarded = p.hand.filter(c => iids.includes(c.iid));
    return {
      ...p,
      hand: p.hand.filter(c => !iids.includes(c.iid)),
      discard: [...p.discard, ...discarded],
    };
  });
});

// 席藍 — 搜最多 3 張 ex 寶可夢加手牌
regG('席藍', (st, idx) => st.players[idx].deck.length > 0);
reg('席藍', (st, idx, pool) => {
  st = addLog(st, '席藍：搜尋牌庫，選擇最多 3 張寶可夢 ex 加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'ex', minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 寇沙 — 手牌洗回，抽比放回多 1 張
reg('寇沙', (st, idx) => {
  const drawN = st.players[idx].hand.length + 1;
  st = addLog(st, '寇沙：手牌洗回，抽 ' + drawN + ' 張', idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const taken = newDeck.slice(0, drawN);
    return { ...p, hand: taken, deck: newDeck.slice(drawN) };
  });
});

// 秋明 — 對手中毒時，手牌洗回，抽 7
// v4.4991 fix：對手中毒實際存 secondaryStatus，補 OR 檢查
regG('秋明', (st, idx) => {
  const opp = st.players[(1-idx) as 0|1].active;
  return opp?.status === 'poisoned' || opp?.secondaryStatus === 'poisoned' || opp?.tertiaryStatus === 'poisoned';
});
reg('秋明', (st, idx) => {
  st = addLog(st, '秋明：手牌洗回，抽 7 張', idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const taken = newDeck.slice(0, 7);
    return { ...p, hand: taken, deck: newDeck.slice(7) };
  });
});

// 蕾荷 — 卡面：看牌庫頂 5 張，選任意數量丟棄；剩餘以任意順序排列放回牌庫上方
// v2.164：完整實裝（reorder-deck-top with allowDiscard=true）
regG('蕾荷', (st, idx) => st.players[idx].deck.length > 0);
reg('蕾荷', (st, idx, _pool) => {
  const player = st.players[idx];
  const topN = Math.min(5, player.deck.length);
  const topCards = player.deck.slice(0, topN);
  st = addLog(st, `蕾荷：查看牌庫頂 ${topN} 張，選擇丟棄哪些並排序剩餘`, idx);
  return withPending(st, {
    type: 'reorder-deck-top',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: topN,  // 玩家可全丟（保留 0 張）也可全留
    effectKey: 'reorder-deck-top-apply',
    params: {
      candidateIids: topCards.map(c => c.iid),
      allowDiscard: true,
      titleOverride: '蕾荷：丟棄+排序',
    },
  });
});

// ── 共用 resolver：reorder-deck-top-apply ────────────────────────────────────
// 玩家把 selectedIids 視為「保留並排序的 iid 列表」（index 0 = top of deck after apply）
// allowDiscard：未列出的 candidateIid 視為丟棄；否則 safety net 強行附在尾部保留
regR('reorder-deck-top-apply', (state, aIdx, iids, params, pool) => {
  const candidateIids = (params?.candidateIids as string[] | undefined) ?? [];
  const allowDiscard = (params?.allowDiscard as boolean | undefined) ?? false;
  if (candidateIids.length === 0) return state;
  const candidateSet = new Set(candidateIids);
  // 過濾 selectedIids：只保留屬於候選且去重
  const seen = new Set<string>();
  const orderedKeep: string[] = [];
  for (const id of iids) {
    if (candidateSet.has(id) && !seen.has(id)) {
      seen.add(id);
      orderedKeep.push(id);
    }
  }
  const missingIds = candidateIids.filter(id => !seen.has(id));
  const discardIids: string[] = allowDiscard ? missingIds : [];
  // 非允許丟棄時，玩家漏選的 iid 強行附在尾部維持原順序，避免遺失牌
  const safetyAppend: string[] = allowDiscard ? [] : missingIds;
  const finalKeep = [...orderedKeep, ...safetyAppend];

  // 先取得卡名（在 mutate state 前讀 deck top N 對應 cardId）
  const N = candidateIids.length;
  const topByIid = new Map<string, CardInstance>();
  for (const c of state.players[aIdx].deck.slice(0, N)) topByIid.set(c.iid, c);
  const ownerNames = finalKeep.map(id => {
    const c = topByIid.get(id);
    return c ? (pool.get(c.cardId)?.name ?? '?') : '?';
  });
  const discardNames = discardIids.map(id => {
    const c = topByIid.get(id);
    return c ? (pool.get(c.cardId)?.name ?? '?') : '?';
  });

  // 套用：deck 頂 N 張替換成排序後的 keep；discard 加上丟棄的 inst
  let newState = updatePlayer(state, aIdx, p => {
    const remaining = p.deck.slice(N);
    const keepInsts = finalKeep.map(id => topByIid.get(id)).filter((x): x is CardInstance => !!x);
    const discardInsts = discardIids.map(id => topByIid.get(id)).filter((x): x is CardInstance => !!x);
    return { ...p, deck: [...keepInsts, ...remaining], discard: [...p.discard, ...discardInsts] };
  });

  // log（公開 = 數量；私訊 = 順序與被丟棄的卡名）
  const publicBits: string[] = [];
  publicBits.push(`保留並排序牌庫頂 ${finalKeep.length} 張`);
  if (discardIids.length > 0) publicBits.push(`丟棄 ${discardIids.length} 張`);
  const privateBits: string[] = [];
  if (finalKeep.length > 0) privateBits.push(`頂部順序：${ownerNames.join(' → ')}`);
  if (discardNames.length > 0) privateBits.push(`丟棄：${discardNames.join('、')}`);
  const publicMsg = publicBits.join('；');
  if (privateBits.length > 0) {
    return addPrivateLog(newState, `${publicMsg}（${privateBits.join('；')}）`, publicMsg, aIdx);
  }
  return addLog(newState, publicMsg, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 32 H13 — 主動特性
// ══════════════════════════════════════════════════════════════════════════════

// 水晶燈火靈 勸誘亮光 — 每回合 1 次，雙方各抽 1
regA('水晶燈火靈', 0, (st, idx) => {
  st = addLog(st, '水晶燈火靈 勸誘亮光：雙方各抽 1 張', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const taken = p.deck.slice(0, 1);
    p.hand = [...p.hand, ...taken];
    p.deck = p.deck.slice(1);
    players[i] = p;
  }
  return { ...st, players };
});

// 賽富豪ex 紅利硬幣 — 每回合 1 次，抽 1；若在戰鬥場再抽 1
regA('賽富豪ex', 0, (st, idx, pool) => {
  return updatePlayer(addLog(st, '賽富豪ex 紅利硬幣：抽牌', idx), idx, p => {
    // 若賽富豪ex 在戰鬥場抽 2，備戰只抽 1
    const isActive = !!p.active && pool.get(p.active.cardId)?.name === '賽富豪ex';
    const draw = isActive ? 2 : 1;
    const taken = p.deck.slice(0, draw);
    return { ...p, hand: [...p.hand, ...taken], deck: p.deck.slice(draw) };
  });
});

// 吉雉雞ex 扭轉乾坤 — 「上個對手的回合自己的寶可夢昏厥了」才可用，抽 3
//
// v2.246 升級為精確 KO cause tracking（不再有 false positive）：
//   合法觸發：對手主回合中的「招式 KO」+「主動特性 KO」（含 黑夜魔靈|咒詛炸彈 等對手特性 KO 我方）
//   排除：checkup KO（中毒/灼傷/冰冷之帳）+ 自 KO（自己 main phase 自爆）
//   getUsableAbilities 也同步修（engine.ts）。
regA('吉雉雞ex', 0, (st, idx) => {
  const attackKO = st.oppAttackKOdMeInLastOppTurn?.[idx] ?? 0;
  const abilityKO = st.oppAbilityKOdMeInLastOppTurn?.[idx] ?? 0;
  if (attackKO + abilityKO === 0) {
    return addLog(st, '扭轉乾坤：上個對手主回合自己沒有寶可夢昏厥，無法使用', idx);
  }
  return updatePlayer(addLog(st, '吉雉雞ex 扭轉乾坤：抽 3 張', idx), idx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, hand: [...p.hand, ...taken], deck: p.deck.slice(3) };
  });
});

// 愛管侍 悉心治癒 — 放置到備戰時可用，戰鬥寶可夢回 30 + 解除 1 個特殊狀態
// 我們沒「放置觸發」機制；改為主動（正常回合可用）
regA('愛管侍', 0, (st, idx) => {
  return updatePlayer(addLog(st, '愛管侍 悉心治癒：戰鬥寶可夢回 30 HP + 解除異常狀態', idx), idx, p => {
    if (!p.active) return p;
    const newActive = {
      ...p.active,
      damage: Math.max(0, p.active.damage - 30),
      status: undefined,
    };
    return { ...p, active: newActive };
  });
});

// 普隆隆姆 轟鳴引擎 — 丟 1 能量 → 抽至手牌 6 張
// v2.234 升級為玩家自選（之前簡化為固定丟手牌第 1 張能量）
//   卡面：「將自己的 1 張手牌的能量卡放置於棄牌區。然後，從牌庫抽出
//          至自己的手牌成為 6 張」— 「將自己的 1 張」是玩家選。
regA('普隆隆姆', 0, (st, idx, pool) => {
  const energyInHand = st.players[idx].hand.filter(c =>
    pool.get(c.cardId)?.supertype === 'Energy'
  );
  if (energyInHand.length === 0) return addLog(st, '轟鳴引擎：手牌沒有能量', idx);
  st = addLog(st, '轟鳴引擎：選 1 張手牌能量丟棄，再從牌庫抽至手牌 6 張', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    filter: 'Energy',
    effectKey: 'noisuru-rumble',
    params: { validIids: energyInHand.map(c => c.iid) },
  });
});
regR('noisuru-rumble', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const dropped = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (dropped.length === 0) return st;
  const names = dropped.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(st, `轟鳴引擎：丟棄 ${names}`, idx);
  return updatePlayer(s, idx, p => {
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const drawN = Math.max(0, 6 - newHand.length);
    const taken = p.deck.slice(0, drawN);
    return {
      ...p,
      hand: [...newHand, ...taken],
      deck: p.deck.slice(drawN),
      discard: [...p.discard, ...dropped],
    };
  });
});

// 鐵蟻ex｜突然削退 — v2.320 改為 promptPlayAbilities 互動提示
// 原本在 BENCH_PLACE_TRIGGERS 自動觸發（v2.241）；現改為 regA 路徑，
// 由 promptPlayAbilities 詢問玩家後呼叫。
// 卡面：「在自己的回合，從手牌將這張卡放置於備戰區時，可使用1次。將對手的牌庫上方1張卡丟棄。」
regA('鐵蟻ex', 0, (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[oppIdx].deck.length === 0) {
    return addLog(st, '突然削退：對手牌庫為空', idx);
  }
  const _sdTop = st.players[oppIdx].deck.slice(0, 1);
  st = addLog(st, `突然削退：丟對手牌庫頂 1 張：${joinCardNames(_sdTop, pool)}`, idx);
  return updatePlayer(st, oppIdx, p => {
    const top = p.deck.slice(0, 1);
    return { ...p, deck: p.deck.slice(1), discard: [...p.discard, ...top] };
  });
});

// 螺釘地鼠｜狂挖 — 從手牌將這張卡放置於備戰區的那個回合可用 1 次。
//   牌庫選最多 3 張基本【鬥】能量丟棄並重洗。
// v2.126 修：
//   1) 用 deck-search pending 讓玩家選 0~3 張（卡面「最多 3 張」表示可選 0 張）
//   2) filter 改 'Energy:Fighting'（基本能量 pokemonType 常為 undefined，UI 會用 name fallback）
//   3) gate「必須剛從手牌放置」(pk.justPlaced) 在 engine.ts getUsableAbilities 加
regA('螺釘地鼠', 0, (st, idx, pool) => {
  // v2.323：即使沒有鬥能量也要讓玩家執行搜尋（可檢視牌庫 + 重洗）— PTCG 隱藏資訊規則
  const fightEnergyIids = st.players[idx].deck.filter(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    return card.pokemonType === 'Fighting' || /【鬥】/.test(card.name);
  }).map(c => c.iid);
  const maxN = Math.min(3, fightEnergyIids.length);
  st = addLog(st, '狂挖：從牌庫選 0~3 張基本【鬥】能量丟棄（之後重洗）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Fighting',
    minCount: 0, maxCount: maxN,
    effectKey: 'screwdig-discard-fight-e',
  });
});
regR('screwdig-discard-fight-e', (state, aIdx, selectedIids, _params, pool) => {
  const picks = state.players[aIdx].deck.filter(c => selectedIids.includes(c.iid));
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !selectedIids.includes(c.iid))),
    discard: [...p.discard, ...picks],
  }));
  const msg = picks.length > 0
    ? `狂挖：丟棄 ${picks.length} 張基本【鬥】能量（${names}），重洗牌庫`
    : '狂挖：未選能量，重洗牌庫';
  return addLog(s, msg, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 33 — 寶可夢道具（Tool）效果登錄表 — v2.09 搬到 effects/cards/tools.ts
// ══════════════════════════════════════════════════════════════════════════════
// TOOL_HP_BONUS / TOOL_ATTACK_BONUS / TOOL_DEFENSE_REDUCE_BY_TYPE /
// TOOL_PREVENT_KO / TOOL_ON_KO / TOOL_PRIZE_BONUS / TOOL_ON_DAMAGED /
// TOOL_RETREAT_MOD / TOOL_BOTH_SIDES_RETREAT_PLUS 以及每張道具的 entry、
// 自動登記 attach effect 區塊，全部移到 effects/cards/tools.ts；由本檔頂部
// 的 side-effect import 觸發登錄。effects.ts 仍 re-export TOOL_* 供 engine 用。

// ═══════════════════════════════════════════════════════════════════════════
// Session 38h H 標第 5 波 damage-multiply 批次（18 張）
// 通用：counter = Math.floor(inst.damage / 10)；preFn return { state, damage }
// ═══════════════════════════════════════════════════════════════════════════

/** 取得 state 某 side 某 inst 的 damage counter 數（每 10 點 = 1 counter） */
function counterCount(dmg: number): number { return Math.floor(dmg / 10); }

/** 計算自己攻擊方 active 身上的 counter 數 */
function selfActiveCounters(state: GameState, aIdx: 0 | 1): number {
  return counterCount(state.players[aIdx].active?.damage ?? 0);
}
/** 計算對手 active 身上的 counter 數 */
function oppActiveCounters(state: GameState, aIdx: 0 | 1): number {
  const dIdx = (1 - aIdx) as 0 | 1;
  return counterCount(state.players[dIdx].active?.damage ?? 0);
}
/** 計算對手全場（active + bench）所有 counter 和 */
function oppAllCounters(state: GameState, aIdx: 0 | 1): number {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  let sum = counterCount(p.active?.damage ?? 0);
  for (const b of p.bench) if (b) sum += counterCount(b.damage);
  return sum;
}
/** 計算自己場上符合 filterFn 的寶可夢數（active + bench） */
function countOwnPokemon(state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, filterFn: (c: Card) => boolean): number {
  const p = state.players[aIdx];
  let n = 0;
  if (p.active) { const c = pool.get(p.active.cardId); if (c && filterFn(c)) n++; }
  for (const b of p.bench) if (b) { const c = pool.get(b.cardId); if (c && filterFn(c)) n++; }
  return n;
}
/** 計算對手場上符合 filterFn 的寶可夢數 */
export function countOppPokemon(state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, filterFn: (c: Card) => boolean): number {
  const dIdx = (1 - aIdx) as 0 | 1;
  return countOwnPokemon(state, dIdx, pool, filterFn);
}

// ── A. 自己身上 damage counter × k（6 張） ─────────────────────────────────

// 醜醜魚｜抓狂 — 10× counter
regPre('醜醜魚|抓狂', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: n * 10 };
});

// 厄鬼椪 火灶面具ex｜憤怒之窯 — 20× counter
regPre('厄鬼椪 火灶面具ex|憤怒之窯', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: n * 20 };
});

// 鋁鋼龍｜激怒之錘 — 80 + 10× counter
regPre('鋁鋼龍|激怒之錘', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: 80 + n * 10 };
});

// 狠辣椒ex｜香料激怒 — 10 + 70× counter
regPre('狠辣椒ex|香料激怒', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: 10 + n * 70 };
});

// 巨蔓藤｜覆蓋 — 150 - 10× counter（自己身上傷害減傷，最少 0）
regPre('巨蔓藤|覆蓋', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: Math.max(0, 150 - n * 10) };
});

// 尖牙籠｜覆蓋 — 130 - 10× counter
regPre('尖牙籠|覆蓋', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: Math.max(0, 130 - n * 10) };
});

// ── B. 對手戰鬥寶可夢 damage counter × k（6 張） ──────────────────────────

// 冰鬼護｜傷害律動 — 20× opp counter
regPre('冰鬼護|傷害律動', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: n * 20 };
});

// 蘋裹龍｜酸味噴吐 — 20× opp counter
regPre('蘋裹龍|酸味噴吐', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: n * 20 };
});

// 麒麟奇｜精神傷害 — 20 + 10× opp counter
regPre('麒麟奇|精神傷害', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: 20 + n * 10 };
});

// 太陽伊布｜精神傷害 — 30 + 10× opp counter
regPre('太陽伊布|精神傷害', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  const damage = 30 + n * 10;
  // v3.03：breakdown 拆「指示物 N×10 + 30(基礎)」
  if (n > 0) {
    return {
      state,
      damage,
      breakdown: [
        { value: n * 10, label: `指示物 ${n}×10` },
        { value: 30, label: '基礎' },
      ],
    };
  }
  return { state, damage };
});

// 月月熊 赫月｜瘋狂啃咬 — 100 + 30× opp counter
// v3.03：拆 breakdown — 「30×N(指示物 ×30)」+「100(基礎)」，UI 看得出乘法分量
regPre('月月熊 赫月|瘋狂啃咬', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  const damage = 100 + n * 30;
  if (n > 0) {
    return {
      state,
      damage,
      breakdown: [
        { value: n * 30, label: `指示物 ${n}×30` },
        { value: 100, label: '基礎' },
      ],
    };
  }
  return { state, damage };
});

// 猛惡菇｜爆毆 — 50 + 50× opp counter
regPre('猛惡菇|爆毆', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  const damage = 50 + n * 50;
  // v3.03：breakdown 拆「指示物 N×50 + 50(基礎)」
  if (n > 0) {
    return {
      state,
      damage,
      breakdown: [
        { value: n * 50, label: `指示物 ${n}×50` },
        { value: 50, label: '基礎' },
      ],
    };
  }
  return { state, damage };
});

// ── C. 自己場上寶可夢計數（3 張） ──────────────────────────────────────────

// 土台龜ex｜森林行進 — 自己場上【草】寶可夢數 × 30
regPre('土台龜ex|森林行進', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, aIdx, pool, c => c.pokemonType === 'Grass');
  return { state, damage: n * 30 };
});

// 奇麒麟｜中級轟鳴 — 自己場上【1階進化】寶可夢數 × 40
regPre('奇麒麟|中級轟鳴', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, aIdx, pool, c => isStage1Card(c));
  return { state, damage: n * 40 };
});

// 投擲猴｜聯合投擲 — 自己場上【基礎】寶可夢數 × 20
regPre('投擲猴|聯合投擲', (state, aIdx, pool) => {
  // v3.46：PTCG 基礎寶可夢判定（含 ex 等）
  const n = countOwnPokemon(state, aIdx, pool, c => {
    if (c.subtype === 'Stage1' || c.subtype === 'Stage2' || c.subtype === 'Other') return false;
    return !c.evolvesFrom;
  });
  return { state, damage: n * 20 };
});

// ── D. 其他計數類（3 張） ──────────────────────────────────────────────────

// 索羅亞克｜幻影劫持 — 對手場上 ex 數 × 60
regPre('索羅亞克|幻影劫持', (state, aIdx, pool) => {
  const n = countOppPokemon(state, aIdx, pool, c => c.subtype === 'ex');
  return { state, damage: n * 60 };
});

// 亞克諾姆｜意志強念 — 10 + 對手全場 counter 總和 × 10
regPre('亞克諾姆|意志強念', (state, aIdx, _pool) => {
  const n = oppAllCounters(state, aIdx);
  return { state, damage: 10 + n * 10 };
});

// 水晶燈火靈｜意志統治者 — 對手手牌張數 × 30
regPre('水晶燈火靈|意志統治者', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const n = state.players[dIdx].hand.length;
  return { state, damage: n * 30 };
});

// ═══════════════════════════════════════════════════════════════════════════
// Session 38i H 標第 6 波 damage-multiply 第二批（10 張）
// ═══════════════════════════════════════════════════════════════════════════

// 蒼炎刃鬼ex｜深淵熾火 — 30 + 自己棄牌區能量卡 × 20
regPre('蒼炎刃鬼ex|深淵熾火', (state, aIdx, pool) => {
  const n = state.players[aIdx].discard.filter(c => pool.get(c.cardId)?.supertype === 'Energy').length;
  return { state, damage: 30 + n * 20 };
});

// 鐵蟻ex｜復仇粉碎 — 120 + 對手已獲得獎賞 × 30
//   對手取過的獎賞 = 6 - 對手目前獎賞堆張數
regPre('鐵蟻ex|復仇粉碎', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  return { state, damage: 120 + Math.max(0, taken) * 30 };
});

// 阿利多斯｜線帶纏繞 — 10 + 對手戰鬥寶可夢撤退能量數 × 30
regPre('阿利多斯|線帶纏繞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.690：用有效撤退費(含咒縛火焰/重力之玉/浮遊/磁鐵能量等修正)，對齊影繩結/幻影迷宮，不再用 base retreatCost.length。
  const retreat = computeActiveRetreatCostFor(state, dIdx, pool);
  return { state, damage: 10 + retreat * 30 };
});

// 鐵包袱｜瞬風衝激 — 200 - 對手戰鬥寶可夢撤退 × 50
regPre('鐵包袱|瞬風衝激', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.690：有效撤退費(含各修正)，不再用 base retreatCost.length。
  const retreat = computeActiveRetreatCostFor(state, dIdx, pool);
  return { state, damage: Math.max(0, 200 - retreat * 50) };
});

// 鍬農炮蟲｜串聯加農炮 — 120 + 自己備戰區「蟲電寶」× 80
regPre('鍬農炮蟲|串聯加農炮', (state, aIdx, pool) => {
  const n = state.players[aIdx].bench.filter(b => b && pool.get(b.cardId)?.name === '蟲電寶').length;
  return { state, damage: 120 + n * 80 };
});

// 投羽梟｜團結之翼 — 自己棄牌區持有「團結之翼」招式的寶可夢卡 × 20
regPre('投羽梟|團結之翼', (state, aIdx, pool) => {
  const n = state.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.attacks?.some(a => a.name === '團結之翼');
  }).length;
  return { state, damage: n * 20 };
});

// 搖籃百合｜瘴氣之風 — 對手戰鬥寶可夢特殊狀態數 × 100
//   注意：目前引擎 status 單欄位，實際只能算 0 或 1 個狀態
regPre('搖籃百合|瘴氣之風', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const st = state.players[dIdx].active?.status;
  return { state, damage: (st ? 1 : 0) * 100 };
});

// 海豚俠｜先鋒拳 — 130，攻擊後自己再受 counter × 10 傷害
regPre('海豚俠|先鋒拳', (_state, _aIdx, _pool) => ({ state: _state, damage: 130 }));
regPost('海豚俠|先鋒拳', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  if (n === 0) return state;
  const selfDmg = n * 10;
  const s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + selfDmg } };
  });
  return addLog(s, `先鋒拳：反彈 ${selfDmg} 傷害到自己！`, aIdx);
});

// 波盪水｜蜿蜒割裂 — 卡面：「在這隻寶可夢身上放置最多 9 個傷害指示物，造成放置的數量 × 20 點傷害。」
// v2.256：完整實裝 — 借殼 ATTACK_PRE_DISCARD_CHOICE 加新 scope 'self-counter-stepper'，
//   UI 顯示 0~9 stepper（+/- 按鈕）讓玩家選 N 個指示物。
//   - 選 N 個 → 自身 +N×10 傷害（放 N 個指示物 = +N*10 自傷）+ 招式 N×20 傷害
//   AI fallback（chosenIids === undefined）→ 預設選 max=9 最大化攻擊。
ATTACK_PRE_DISCARD_CHOICE.set('波盪水|蜿蜒割裂', {
  min: 0, max: 9, scope: 'self-counter-stepper',
  baseDamage: 0, damagePerEnergy: 20,    // 每個 counter +20 傷害
  selfDamagePerCounter: 10,              // 每個 counter 自身 +10 傷害
  choicePrompt: '選擇放置幾個傷害指示物（每個 = 自身 +10 傷害、招式 +20 傷害）',
});
regPre('波盪水|蜿蜒割裂', (state, aIdx, _pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  // length = 玩家選的 N 個 counter；undefined = AI 預設最大化
  const n = chosenIids === undefined ? 9 : chosenIids.length;
  if (n === 0) {
    return { state: addLog(state, '蜿蜒割裂：選擇放 0 個指示物 → 0 傷害', aIdx), damage: 0 };
  }
  const selfDmg = n * 10;
  const atkDmg = n * 20;
  const s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + selfDmg } };
  });
  const s2 = addLog(s, `蜿蜒割裂：在自己身上放置 ${n} 個指示物（自身 +${selfDmg}）→ 招式 ${atkDmg} 傷害`, aIdx);
  return { state: s2, damage: atkDmg };
});

// 吼叫尾｜大吼大叫 — 對手任 1 隻 × (自己 counter × 20)
//   v2.235：升級為 opp-poke-choose（戰鬥場套弱抗、備戰不計）
//   共用 clone-strike-multi-hit resolver（與甲賀忍蛙ex|分身連打 同 pattern）
regPost('吼叫尾|大吼大叫', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  const amount = n * 20;
  if (amount === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active && def.bench.length === 0) return state;
  const s = addLog(state, `大吼大叫：選對手 1 隻寶可夢造成 ${amount} 傷害（戰鬥場套弱抗、備戰不計）`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'clone-strike-multi-hit',
    params: { dmg: amount, label: '大吼大叫' },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Session 38j H 標第 7 波 雜項（硬幣、混亂、抽卡、下回合減傷）27 張
// ═══════════════════════════════════════════════════════════════════════════

/**
 * v2.253：擲幣統一 helper — 擲 N 次硬幣，每次寫 1 行「— 正面」/「— 反面」log，
 * UI 偵測（+page.svelte coinFlipQueue）會逐個排隊播放動畫。
 *
 * - count=1：log「{label}：擲硬幣 — 正面」（不寫「第 1 次」）
 * - count≥2：log「{label}：第 N 次擲硬幣 — 正面」
 * 回傳 { state, heads } — heads = 累計正面數，caller 自行決定總結 log 與傷害計算。
 */
export function flipCoinsWithLog(
  state: GameState,
  count: number,
  label: string,
  aIdx: 0 | 1,
  injectedFlips?: string[],  // v5.257：可選注入既定擲幣結果（已 deprecated, v5.262 改用 state queue）
): { state: GameState; heads: number } {
  let s = state;
  // v4.898 重試徽章：標記本次 ATTACK action 中已擲過幣（ATTACK 末端用此判定是否開 modal）。
  // v5.513 gate：只有「當前進攻方(active player)自己」因招式擲幣才算數。防守方特性擲幣
  //   (奇諾栗鼠ex 順滑大衣 dIdx / 變隱龍 躲藏高手·吉雉雞 腎上腺費洛蒙 PASSIVE_COIN_AVOID dIdx)、
  //   或招式讓「對手」擲幣(火箭隊的引夢貘人 備戰區操縱 dIdx) 皆 aIdx≠activePlayerIndex → 不設旗標，
  //   避免 ATTACK 末端誤觸發重試徽章 modal。卡面：「自己因附有這張卡的【無】寶可夢的招式而擲硬幣時」。
  if (count > 0 && aIdx === state.activePlayerIndex) s = { ...s, coinFlippedThisAttack: true };
  let heads = 0;
  const recordedFlips: string[] = [];
  // v5.262：state queue consume — 比 caller 傳的 injectedFlips 優先
  //   queue 由 engine.ts ATTACK keep path 設定. 每次擲幣前 shift 一個出來 inject.
  //   queue 空 → 用 caller 傳的 injectedFlips (legacy) → 都沒 → random.
  let queue: string[] | undefined = s._retryInjectedFlipsQueue ? [...s._retryInjectedFlipsQueue] : undefined;
  for (let i = 0; i < count; i++) {
    // 優先順序: state queue > caller injectedFlips > random
    let injected: string | undefined = undefined;
    if (queue && queue.length > 0) {
      injected = queue.shift();
    } else if (injectedFlips && i < injectedFlips.length) {
      injected = injectedFlips[i];
    }
    const isHeads = injected !== undefined ? (injected === '正面') : (Math.random() < 0.5);
    const prefix = count === 1 ? '' : `第 ${i + 1} 次`;
    const suffix = injected !== undefined ? '〔重試徽章：使用剛才擲幣結果〕' : '';
    s = addLog(s, `${label}：${prefix}擲硬幣 — ${isHeads ? '正面' : '反面'}${suffix}`, aIdx);
    if (isHeads) heads++;
    recordedFlips.push(isHeads ? '正面' : '反面');
  }
  // 同步更新 state queue (consume 後剩下的)
  if (queue !== undefined) {
    s = { ...s, _retryInjectedFlipsQueue: queue.length > 0 ? queue : undefined };
  }
  // v5.257：append 到 state._machineGunLastFlips（累加；同 ATTACK 內多次擲幣場景）
  if (count > 0) {
    const existing = s._machineGunLastFlips ?? [];
    s = { ...s, _machineGunLastFlips: [...existing, ...recordedFlips] };
  }
  return { state: s, heads };
}

/** 簡易 coin flip +N helper：基礎傷害 + (正面 ? N : 0) */
function coinPlusPre(base: number, bonus: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool, action) => {
    // v5.257：forward action._retryInjectedFlips 給 flipCoinsWithLog
    const injected = (action as { _retryInjectedFlips?: string[] } | undefined)?._retryInjectedFlips;
    const r = flipCoinsWithLog(state, 1, attackName, aIdx, injected);
    const dmg = base + (r.heads ? bonus : 0);
    const s = addLog(r.state, `${attackName}：${r.heads ? `+${bonus} 傷害` : '無加成'} → ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ── A. 硬幣加傷 (7 張) ─────────────────────────────────────────────────────
regPre('啃果蟲|打滾', coinPlusPre(20, 30, '打滾'));
regPre('炙燙鱷|高溫吐息', coinPlusPre(30, 50, '高溫吐息'));
regPre('電海燕|燕返', coinPlusPre(10, 20, '燕返'));
regPre('銅鏡怪|盾牌攻擊', coinPlusPre(20, 20, '盾牌攻擊'));
regPre('一對鼠|嬉鬧', coinPlusPre(10, 10, '嬉鬧'));
regPre('普隆隆姆|擊飛', coinPlusPre(90, 90, '擊飛'));

// 貓鼬斬｜連斬 — 擲 3 次硬幣，1 正 +20 / 2 正 +50 / 3 正 +80
regPre('貓鼬斬|連斬', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 3, '連斬', aIdx);
  const bonus = r.heads === 3 ? 80 : r.heads === 2 ? 50 : r.heads === 1 ? 20 : 0;
  const dmg = 10 + bonus;
  const s = addLog(r.state, `連斬：${r.heads} 次正面 → 基礎 10 + ${bonus} = ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ── B. 將對手混亂（regPost statusPost('confused')）6 張 ──────────────────
regPost('仙子伊布|魅惑之聲', statusPost('confused'));
regPost('麻花犬ex|奇跡閃耀', statusPost('confused'));
regPost('卡璞・蝶蝶|蠱惑', statusPost('confused'));
regPost('青綿鳥|魅惑之聲', statusPost('confused'));
regPost('月亮伊布ex|月亮幻想', statusPost('confused'));
// v5.679 完整實裝：卡面「將對手戰鬥寶可夢混亂。因這個混亂而放置的傷害指示物的數量改為 8 個」。
//   = 該寶可夢之後因混亂自傷時放 8 個指示物(80)而非預設 3 個(30)。先套混亂(走中央免疫)，再設覆蓋值。
regPost('電燈怪|錯亂閃光', (state, aIdx, pool) => {
  let s = statusPost('confused')(state, aIdx, pool);
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = s.players[dIdx].active;
  if (da && (da.status === 'confused' || da.secondaryStatus === 'confused' || da.tertiaryStatus === 'confused')) {
    s = updatePlayer(s, dIdx, p => p.active ? { ...p, active: { ...p.active, confusionSelfDamageCounters: 8 } } : p);
    s = addLog(s, '錯亂閃光：此混亂的自傷指示物改為 8 個（80）', aIdx);
  }
  return s;
});

// ── C. 將自己混亂 2 張 ─────────────────────────────────────────────────────
function selfConfusePost(): AttackPostFn {
  // v5.675 收斂：自身混亂走中央自身狀態 helper（憨憨臉/泡沫水免疫 + 欄位保留）
  return (state, aIdx, pool) => applyStatusToSelfActive(state, aIdx, 'confused', pool);
}
regPost('流氓熊貓|暴走', selfConfusePost());
regPost('棄世猴|暴走', selfConfusePost());

// ── D. 抽卡類 7 張 ─────────────────────────────────────────────────────────
export function drawNPost(n: number, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    let s = addLog(state, `${attackName}：從牌庫抽 ${n} 張`, aIdx);
    return updatePlayer(s, aIdx, p => {
      const take = Math.min(n, p.deck.length);
      return { ...p, hand: [...p.hand, ...p.deck.slice(0, take)], deck: p.deck.slice(take) };
    });
  };
}
regPost('摩托蜥ex|鋯石之路', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '鋯石之路：選擇「否」 — 跳過抽牌', aIdx);
  const _cb: AttackPostFn = drawNPost(5, '鋯石之路');
  return _cb(state, aIdx, pool);
});
regPost('蟲滾泥|呼喚', drawNPost(1, '呼喚'));
regPost('蟲甲聖|三重抽出', drawNPost(3, '三重抽出'));
regPost('斑斑馬|叼', drawNPost(1, '叼'));
regPost('金魚王|快速抽出', drawNPost(2, '快速抽出'));
regPost('時拉比|呼喚', drawNPost(1, '呼喚'));

// 鑰圈兒｜插入抽出 — 丟 1 張手牌後抽 2 張
// v2.159：升級為玩家自選棄哪張（之前簡化為隨機）
regPost('鑰圈兒|插入抽出', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.hand.length === 0) {
    // 沒手牌可棄 → 直接抽 2
    return updatePlayer(addLog(state, '插入抽出：手牌為空 → 直接抽 2 張', aIdx), aIdx, p => {
      const take = Math.min(2, p.deck.length);
      return { ...p, hand: [...p.hand, ...p.deck.slice(0, take)], deck: p.deck.slice(take) };
    });
  }
  // 開 hand-discard picker 讓玩家選 1 張手牌棄
  const s = addLog(state, '插入抽出：選 1 張手牌棄置（之後抽 2 張）', aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'insert-and-draw-discard',
  });
});
regR('insert-and-draw-discard', (st, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  // v5.515：log 顯示丟棄的卡名（原本 dname 算了卻沒寫進 log）
  const _insDiscarded = st.players[aIdx].hand.find(c => c.iid === targetIid);
  const s2 = _insDiscarded
    ? addLog(st, `插入抽出：丟棄 ${joinCardNames([_insDiscarded], pool)} → 抽 2 張`, aIdx)
    : st;
  return updatePlayer(s2, aIdx, p => {
    const discarded = p.hand.find(c => c.iid === targetIid);
    if (!discarded) return p;
    const newHand = p.hand.filter(c => c.iid !== targetIid);
    const take = Math.min(2, p.deck.length);
    return {
      ...p,
      hand: [...newHand, ...p.deck.slice(0, take)],
      deck: p.deck.slice(take),
      discard: [...p.discard, discarded],
    };
  });
});

// ── E. 自己下回合受招式傷害 -N 4 張 ───────────────────────────────────────
regPost('龍捲雲|暴風障壁', selfDmgReducePost(50));
regPost('盔甲鳥|鋼翼', selfDmgReducePost(30));
regPost('振翼髮|月亮之力', selfDmgReducePost(30));
regPost('仙子伊布ex|魔法魅惑', selfDmgReducePost(100));

// ── F. 丟對手隨機 1 張手牌 2 張 ───────────────────────────────────────────
function oppDiscardRandomHand(n: number, attackName: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const pickCount = Math.min(n, state.players[dIdx].hand.length);
    if (pickCount === 0) return addLog(state, `${attackName}：對手手牌為空`, aIdx);
    let hand = [...state.players[dIdx].hand];
    const discarded: CardInstance[] = [];
    for (let i = 0; i < pickCount; i++) {
      const idx = Math.floor(Math.random() * hand.length);
      discarded.push(hand[idx]);
      hand = hand.filter((_, j) => j !== idx);
    }
    const _diids = new Set(discarded.map(c => c.iid));
    const s = addLog(state, `${attackName}：丟棄對手手牌 ${pickCount} 張：${joinCardNames(discarded, pool)}`, aIdx);
    return updatePlayer(s, dIdx, p => ({ ...p, hand: p.hand.filter(c => !_diids.has(c.iid)), discard: [...p.discard, ...discarded] }));
  };
}
regPost('功夫鼬|拍落', oppDiscardRandomHand(1, '拍落'));
// v3.9998 修 Rule 7：原 v2 用 oppDiscardRandomHand 隨機，違反卡面
//   「在不看正面的情況下，從對手的手牌選擇 1 張，將其丟棄」
//   改用 hand-discard picker + concealed=true：UI 端顯示卡背，玩家僅看到「幾張」
//   選 1 張，resolver 端丟棄到對手棄牌區。
regPost('太陽伊布ex|精神出局', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) return addLog(state, '精神出局：對手手牌為空', aIdx);
  const st = addLog(state, `精神出局：在不看正面的情況下，從對手手牌（${oppHand.length} 張）選 1 張丟棄`, aIdx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'sunny-eevee-mental-out',
    params: {
      validIids: oppHand.map(c => c.iid),
      concealed: true,  // v3.9998：UI 端讀此 flag → 卡背顯示，不揭示卡名/圖
      titleOverride: '精神出局：選擇要丟棄的對手手牌（不看正面）',
    },
  });
});
regR('sunny-eevee-mental-out', (state, aIdx, iids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  if (!targetIid) return state;
  // v5.603：丟到棄牌區後本就是公開資訊 → 用中央 joinCardNames 在雙方對戰紀錄揭示被丟棄的卡名
  const picked = state.players[dIdx].hand.find(c => c.iid === targetIid);
  if (!picked) return state;
  let st = updatePlayer(state, dIdx, p => ({
    ...p,
    hand: p.hand.filter(c => c.iid !== targetIid),
    discard: [...p.discard, picked],
  }));
  st = addLog(st, `精神出局：丟棄了對手的 ${joinCardNames([picked], pool)}`, aIdx);
  return st;
});
// v3.9998：拍落仍用隨機（卡面寫「隨機」），維持舊邏輯


// 巨牙鯊｜咬棄 — 擲 3 次硬幣，丟對手正面數量的手牌（不看正面）
regPost('巨牙鯊|咬棄', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 3, '咬棄', aIdx);
  return oppDiscardRandomHand(r.heads, '咬棄')(r.state, aIdx, pool);
});

// 鐵螯龍蝦｜喀嚓喀嚓 — 擲 2 次硬幣，對手牌庫上方正面數的牌丟棄
regPost('鐵螯龍蝦|喀嚓喀嚓', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const r = flipCoinsWithLog(state, 2, '喀嚓喀嚓', aIdx);
  const _kTake = Math.min(r.heads, r.state.players[dIdx].deck.length);
  const _kDiscarded = r.state.players[dIdx].deck.slice(0, _kTake);
  const s = addLog(r.state, `喀嚓喀嚓：${r.heads} 次正面 → 丟對手牌庫頂 ${_kTake} 張：${joinCardNames(_kDiscarded, pool)}`, aIdx);
  return updatePlayer(s, dIdx, p => {
    const take = Math.min(r.heads, p.deck.length);
    if (take === 0) return p;
    const discarded = p.deck.slice(0, take);
    return { ...p, deck: p.deck.slice(take), discard: [...p.discard, ...discarded] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38l v1.62 H 標第 7 波 — debuff-target 大批次（40+ 張）
// 機制:
//   (a) 對手下回合無法撤退（cantRetreatNextTurn；engine v1.62 加 RETREAT 檢查 + END_TURN 清除）
//   (b) 自己下回合無法使用招式（既有 selfCantAttackNextPost）
//   (c) 對手下回合無法使用招式（既有 defCantAttackNextPost）
//   (d) 上個對手回合被取走獎賞則傷害 +N（既有 oppPrizesAtMyLastTurnEnd 快照）
//   複合招式（中毒+不撤退、灼傷+不撤退、擲硬幣+自不攻）用 inline 組合
//
// 已知延後（不再列為簡化；待引擎 infra 後逐項升級為完整實裝）：
//   - 「指定招式名無法使用」（如「閃焰強襲」）統一視為「全部招式無法使用」
//   - 「無法從手牌使出能量/物品/支援者」機制延後（含晶光花、電蜘蛛ex、含羞苞、吼叫尾ex、青銅鐘）
//   - 「自己所有寶可夢下回合都無法攻擊」（電擊魔獸｜雷電在地）延後（需 player-level flag）
//   - 「僅基礎寶可夢/進化寶可夢無法攻擊」（帕底亞肯泰羅、鐵包袱）延後（需 pokemon-filter flag）
//   - 「本次自願 +100 點並下回合不攻擊」（大王銅象｜鼻之金勾臂）延後（需 optional-choice UI）
//   （v1.62 已修：懶人獺｜悠哉用 cantRetreatPendingSelf 完整實裝；v2.160 清過期註解。）
// ══════════════════════════════════════════════════════════════════════════════

// ── 輔助：對手戰鬥寶可夢下回合無法撤退（cantRetreatNextTurn）────────────────
function defCantRetreatNextPost(): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    // v5.333：免疫招式效果的 active 不受「無法撤退」（C-17 per-target guard）
    if (state.players[dIdx].active) {
      const _gr = canApplyEffectToTarget(state, aIdx, state.players[dIdx].active!, pool.get(state.players[dIdx].active!.cardId), 'attack-effect', pool);
      if (_gr.blocked) return addLog(state, `無法撤退效果：${_gr.reason}`, aIdx);
    }
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantRetreatNextTurn: true };
    players[dIdx] = def;
    return addLog({ ...state, players }, `對手下次回合無法撤退`, aIdx);
  };
}

// ── A. 對手受招後下回合無法撤退（14 張）────────────────────────────────────
regPost('羅絲雷朵|束縛', defCantRetreatNextPost());
regPost('小鋸鱷|咬緊', defCantRetreatNextPost());
regPost('三海地鼠ex|麻痺控制', defCantRetreatNextPost());
regPost('厄鬼椪 水井面具ex|啜泣', defCantRetreatNextPost());
regPost('勒克貓|咬緊', defCantRetreatNextPost());
regPost('大狼犬|窮追不捨', defCantRetreatNextPost());
regPost('狃拉|逼近', defCantRetreatNextPost());
regPost('黑夜魔靈|影子束縛', defCantRetreatNextPost());
regPost('觸手百合|束縛', defCantRetreatNextPost());
regPost('拖拖蚓ex|岩石封鎖', defCantRetreatNextPost());
regPost('磨牙彩皮魚|咬緊', defCantRetreatNextPost());
regPost('噬沙堡爺ex|流沙地獄', defCantRetreatNextPost());

// 爆焰龜獸｜火焰陣 — 灼傷 + 對手下回合無法撤退
regPost('爆焰龜獸|火焰陣', (state, aIdx, pool) => {
  const s1 = statusPost('burned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// 車輪毬｜毒陣 — 中毒 + 對手下回合無法撤退
regPost('車輪毬|毒陣', (state, aIdx, pool) => {
  const s1 = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// 桃歹郎｜猛毒連鎖 — 中毒 + 對手下回合無法撤退（非 ex 版本）
regPost('桃歹郎|猛毒連鎖', (state, aIdx, pool) => {
  const s1 = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// ── B. 自己下回合無法使用招式（指定招式名統一視為全招式）────────────────
regPost('炎熱喵|閃焰強襲', selfBlockSpecificAttackNextPost('閃焰強襲'));  // v5.730 卡面「無法使用『閃焰強襲』」=特定擋(炎熱喵另有咬住),原全擋誤鎖
regPost('咕咕鴿|噴射之翼', selfCantAttackNextPost());
regPost('高傲雉雞|潛力', selfCantAttackNextPost());
regPost('鐵螯龍蝦|暴亂之錘', selfCantAttackNextPost());
regPost('月月熊 赫月 ex|血月', selfCantAttackNextPost());
regPost('月月熊 赫月ex|血月', selfCantAttackNextPost());  // 兼容去空格寫法
regPost('波普海豚|水流斬', selfCantAttackNextPost());
regPost('海豚俠ex|終極衝擊', selfCantAttackNextPost());
regPost('吉利蛋|潛力', selfCantAttackNextPost());
regPost('大嘴蝠|漆黑利刃', selfCantAttackNextPost());
regPost('願增猿ex|惡劣頭擊', selfCantAttackNextPost());
regPost('閃焰王牌ex|閃焰強襲', selfBlockSpecificAttackNextPost('閃焰強襲'));  // v5.730 特定擋(另有石榴石截擊)
regPost('好勝毛蟹|揮大拳', selfCantAttackNextPost());
regPost('電燈怪|閃電伏特', selfCantAttackNextPost());
regPost('鋁鋼橋龍|鐵之引爆', selfCantAttackNextPost());
regPost('爆炸頭水牛|潛力', selfCantAttackNextPost());
regPost('蒼炎刃鬼|黑煙斬', selfCantAttackNextPost());
regPost('自爆磁怪|電磁炮', selfBlockSpecificAttackNextPost('電磁炮'));  // v5.730 特定擋(另有衝天電光/閃光伏特)
regPost('火伊布ex|紅玉髓', selfCantAttackNextPost());
regPost('鐵毒蛾|高熱光線', selfCantAttackNextPost());
regPost('水伊布ex|海藍寶石', selfCantAttackNextPost());
regPost('雷伊布ex|棕碧璽', selfCantAttackNextPost());
regPost('鐵武者ex|鐳射利刃', selfCantAttackNextPost());
regPost('沙鐵皮ex|大地扣殺', selfCantAttackNextPost());
regPost('月亮伊布|漆黑利刃', selfCantAttackNextPost());
regPost('猛惡菇|暴亂之錘', selfCantAttackNextPost());
regPost('雙劍鞘|猛擊在地', selfBlockSpecificAttackNextPost('猛擊在地'));  // v5.730 特定擋(另有劍武備)

// 朝北鼻｜力量猛攻 — 擲 1 次硬幣反面，自己下回合無法使用招式（60 dmg baseline）
regPost('朝北鼻|力量猛攻', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '力量猛攻', aIdx);
  if (r.heads) return r.state;  // 正面：無附加效果
  const s = addLog(r.state, `力量猛攻：反面 → 自己下個回合無法使用招式`, aIdx);
  return selfCantAttackNextPost()(s, aIdx, pool);
});

// ── C. 對手受招後下回合無法使用招式 ─────────────────────────────────────────
regPost('豐蜜龍|甜蜜熔化', defCantAttackNextPost());

// ── D. 上個對手回合被取走獎賞則傷害 +N（revenge-dmg-plus）───────────────────
// 卡面共通條件：「在上個對手的回合，若自己的寶可夢**因招式的傷害**而【昏厥】了，則增加N點傷害」
// v2.246 修：精確 KO cause tracking — 只算「招式 KO」（attackKOdMe），
//   排除：對手主動特性 KO（如咒詛炸彈/腎上腺腦力）+ checkup KO + 自 KO
// 鐵斑葉｜復仇刀鋒 100+60
regPre('鐵斑葉|復仇刀鋒', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 60 : 0;
  const s = tookPrize
    ? addLog(state, `復仇刀鋒：上個對手主回合自己有寶可夢被招式 KO → +60 傷害`, aIdx)
    : state;
  return { state: s, damage: 100 + bonus };
});
// 普隆隆姆｜捲土重來 30+90
regPre('普隆隆姆|捲土重來', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 90 : 0;
  const s = tookPrize
    ? addLog(state, `捲土重來：上個對手主回合自己有寶可夢被招式 KO → +90 傷害`, aIdx)
    : state;
  return { state: s, damage: 30 + bonus };
});
// 古玉魚｜嫉妒業火 50+90
regPre('古玉魚|嫉妒業火', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 90 : 0;
  const s = tookPrize
    ? addLog(state, `嫉妒業火：上個對手主回合自己有寶可夢被招式 KO → +90 傷害`, aIdx)
    : state;
  return { state: s, damage: 50 + bonus };
});

// ── E. 懶人獺｜悠哉 — heal 60 + 自己下回合不能撤退（cantRetreatPendingSelf）──
regPost('懶人獺|悠哉', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) {
    const newDmg = Math.max(0, att.active.damage - 60);
    att.active = { ...att.active, damage: newDmg, cantRetreatPendingSelf: true };
  }
  players[aIdx] = att;
  return addLog({ ...state, players }, `悠哉：恢復 60 HP，下個自己的回合無法撤退`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38m v1.63 H 標第 8 波 — coin-heads-multiply 批次（24 張）
// 擲 N 次硬幣，正面出現次數 × k 點傷害。
// ══════════════════════════════════════════════════════════════════════════════

export function coinHeadsMultiplyPre(flips: number, perHead: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool, action) => {
    // v5.257：forward action._retryInjectedFlips
    const injected = (action as { _retryInjectedFlips?: string[] } | undefined)?._retryInjectedFlips;
    const r = flipCoinsWithLog(state, flips, attackName, aIdx, injected);
    const dmg = r.heads * perHead;
    const s = addLog(r.state, `${attackName}：${r.heads}/${flips} 次正面 → ${r.heads}×${perHead} = ${dmg} 傷害`, aIdx);
    return { state: s, damage: dmg };
  };
}

regPre('木棉球|三重旋轉', coinHeadsMultiplyPre(3, 10, '三重旋轉'));
regPre('海豚俠|二連擊', coinHeadsMultiplyPre(2, 90, '二連擊'));
regPre('雙卵細胞球|雙重戲法', coinHeadsMultiplyPre(2, 30, '雙重戲法'));
regPre('長鼻葉|連出巴掌', coinHeadsMultiplyPre(3, 30, '連出巴掌'));
regPre('蘑蘑菇|二連頭錘', coinHeadsMultiplyPre(2, 10, '二連頭錘'));
regPre('佛烈托斯|尖刺加農炮', coinHeadsMultiplyPre(3, 30, '尖刺加農炮'));
regPre('大舌舔|舔舔颶風', coinHeadsMultiplyPre(4, 70, '舔舔颶風'));
regPre('向日種子|種子機關槍', coinHeadsMultiplyPre(4, 10, '種子機關槍'));
regPre('蚊香蝌蚪|擺尾拍打', coinHeadsMultiplyPre(2, 20, '擺尾拍打'));
regPre('蚊香君|連環巴掌', coinHeadsMultiplyPre(2, 30, '連環巴掌'));
regPre('穿山鼠|雙重抓', coinHeadsMultiplyPre(2, 20, '雙重抓'));
regPre('索羅亞|雙重抓', coinHeadsMultiplyPre(2, 20, '雙重抓'));
regPre('喵喵|亂抓', coinHeadsMultiplyPre(3, 20, '亂抓'));
regPre('貓老大|亂抓', coinHeadsMultiplyPre(3, 50, '亂抓'));
regPre('幼棉棉|雙重旋轉', coinHeadsMultiplyPre(2, 10, '雙重旋轉'));
regPre('燈籠魚|雙重伏特', coinHeadsMultiplyPre(2, 20, '雙重伏特'));
regPre('咕咕|三次撞', coinHeadsMultiplyPre(3, 10, '三次撞'));
regPre('爆香猿|雙重粉碎', coinHeadsMultiplyPre(2, 70, '雙重粉碎'));
regPre('猴怪|二連劈', coinHeadsMultiplyPre(2, 10, '二連劈'));
regPre('青銅鐘|雙重衝擊', coinHeadsMultiplyPre(2, 100, '雙重衝擊'));
regPre('一家鼠|連續門牙', coinHeadsMultiplyPre(4, 30, '連續門牙'));
regPre('三海地鼠|三連鞭', coinHeadsMultiplyPre(3, 70, '三連鞭'));
regPre('天然雀|三連撞', coinHeadsMultiplyPre(3, 10, '三連撞'));
regPre('袋獸|迷昏拳', coinHeadsMultiplyPre(2, 90, '迷昏拳'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38n v1.64 H 標第 9 波 — coin 混合三類（16 張）
// (A) coin-tails-fail：擲反面 → 招式失敗（damage=0）
// (B) coin-heads-immune-next：正面 → 下回合免疫（damageReduceNextHit=9999）
// (C) coin-until-tails-multiply：擲到反面為止，正面數 × k
// ══════════════════════════════════════════════════════════════════════════════

// ── (A) coin-tails-fail helper + 4 張 ─────────────────────────────────────
function coinTailsFailPre(base: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool, action) => {
    // v5.257：forward action._retryInjectedFlips
    const injected = (action as { _retryInjectedFlips?: string[] } | undefined)?._retryInjectedFlips;
    const r = flipCoinsWithLog(state, 1, attackName, aIdx, injected);
    if (!r.heads) {
      return { state: addLog(r.state, `${attackName}：反面 → 招式失敗`, aIdx), damage: 0 };
    }
    return { state: addLog(r.state, `${attackName}：正面 → ${base} 傷害`, aIdx), damage: base };
  };
}
regPre('單卵細胞球|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('斯魔茶|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('搬運小匠|全力拳', coinTailsFailPre(40, '全力拳'));
regPre('阿羅拉 地鼠|偷襲', coinTailsFailPre(30, '偷襲'));

// ── 飛翔型：擲 1 硬幣 — 反面→招式失敗(0傷,不設免疫)；正面→base傷害 + 下個對手回合
//   自身免疫招式的傷害與效果(immuneToAllAttackNextTurn)。卡面「擲1次硬幣」=單次擲幣同時
//   決定成敗與免疫，禁分兩次擲(否則違反卡面且重試徽章會雙觸發)。retry-badge-aware：
//   flipCoinsWithLog 自動 consume state._retryInjectedFlipsQueue。
//   收斂：原 咕咕鴿|飛翔 被誤丟進 COIN_IMMUNE 表(damage 寫死0+無反面失敗)→正面0傷 bug；
//   喇叭啄鳥|飛翔 原 m5_preview 亂碼雙註冊。兩張統一走此 helper。
function coinFlyPre(base: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool, action) => {
    const injected = (action as { _retryInjectedFlips?: string[] } | undefined)?._retryInjectedFlips;
    const r = flipCoinsWithLog(state, 1, attackName, aIdx, injected);
    if (!r.heads) {
      return { state: addLog(r.state, `${attackName}：反面 → 招式失敗`, aIdx), damage: 0 };
    }
    const s = updatePlayer(
      addLog(r.state, `${attackName}：正面 → ${base} 傷害 + 下個對手回合免疫招式傷害與效果`, aIdx),
      aIdx,
      p => (p.active ? { ...p, active: { ...p.active, immuneToAllAttackNextTurn: true } } : p),
    );
    return { state: s, damage: base };
  };
}
regPre('喇叭啄鳥|飛翔', coinFlyPre(30, '飛翔'));
regPre('咕咕鴿|飛翔', coinFlyPre(40, '飛翔'));

// ── (B) coin-heads-immune-next helper + 7 張 ──────────────────────────────
// 擲 1 次硬幣若正面，則在下個對手的回合，這隻寶可夢不會受到招式的傷害。
// 實作：damageReduceNextHit = 9999 → 招式傷害降到 0（卡面範圍即「招式傷害」，
// 不擋招式附加效果如異常狀態/放指示物，與卡面語意完全一致）。
function coinHeadsSelfImmuneNextPost(attackName: string, immuneKind: 'all' | 'damage' = 'all'): AttackPostFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, attackName, aIdx);
    if (!r.heads) return addLog(r.state, `${attackName}：反面 → 無追加效果`, aIdx);
    const players = [...r.state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    // v5.441：改用「下個對手回合」回合範圍旗標 — 原 damageReduceNextHit:9999 是「下次被打」消費型，
    //   對手不攻擊就永久殘留(玩家回報效果保留到下下回合)。傷害+效果=immuneToAllAttackNextTurn、
    //   只免傷害(鐵壁/棉花之翼)=immuneToAttackDamageNextTurn(效果照常)。
    if (att.active) {
      att.active = immuneKind === 'all'
        ? { ...att.active, immuneToAllAttackNextTurn: true }
        : { ...att.active, immuneToAttackDamageNextTurn: true };
    }
    players[aIdx] = att;
    const txt = immuneKind === 'all' ? '下個對手回合免疫招式傷害與效果' : '下個對手回合免疫招式傷害';
    return addLog({ ...r.state, players }, `${attackName}：正面 → ${txt}`, aIdx);
  };
}
regPost('泥偶小人|鐵壁', coinHeadsSelfImmuneNextPost('鐵壁', 'damage'));
regPost('泥偶巨人|鐵壁', coinHeadsSelfImmuneNextPost('鐵壁', 'damage'));
regPost('土龍弟弟|挖洞', coinHeadsSelfImmuneNextPost('挖洞'));
regPost('電電蟲|躍起閃避', coinHeadsSelfImmuneNextPost('躍起閃避'));
regPost('東施喵|喵打滾', coinHeadsSelfImmuneNextPost('喵打滾'));
regPost('飄飄雛|躍起閃避', coinHeadsSelfImmuneNextPost('躍起閃避'));
regPost('七夕青鳥|棉花之翼', coinHeadsSelfImmuneNextPost('棉花之翼', 'damage'));

// ── (C) coin-until-tails-multiply helper + 5 張 ───────────────────────────
// v2.252：改為每次擲幣寫 1 行 log（格式「第 N 次擲硬幣 — 正面/反面」），
//   UI parser（+page.svelte）逐個 enqueue 到 coinFlipQueue 排隊播放動畫，
//   玩家能看到每次擲幣的結果（不再合併成 1 次動畫且 heads=0 顯示錯面的 bug）。
function coinUntilTailsMultiplyPre(perHead: number, base: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let s = state;
    let heads = 0;
    // 安全上限 20 次防無限迴圈（理論概率近 0，但保護）
    // v5.x：逐次走 flipCoinsWithLog → 設 coinFlippedThisAttack（重試徽章）+ consume retry queue
    for (let i = 0; i < 20; i++) {
      const r = flipCoinsWithLog(s, 1, attackName, aIdx);
      s = r.state;
      if (r.heads === 1) heads++;
      else break;
    }
    const dmg = base + heads * perHead;
    s = addLog(s, `${attackName}：${heads} 次正面 → 基礎 ${base} + ${heads}×${perHead} = ${dmg} 傷害`, aIdx);
    return { state: s, damage: dmg };
  };
}
regPre('瑪力露|滾球', coinUntilTailsMultiplyPre(10, 0, '滾球'));
regPre('土狼犬|連續舞步', coinUntilTailsMultiplyPre(10, 0, '連續舞步'));
regPre('普隆隆姆|奔進', coinUntilTailsMultiplyPre(100, 0, '奔進'));
regPre('燈罩夜菇|螺旋衝刺', coinUntilTailsMultiplyPre(30, 60, '螺旋衝刺'));
regPre('索財靈|連續擲幣', coinUntilTailsMultiplyPre(20, 0, '連續擲幣'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38o v1.65 H 標第 10 波 — self-heal 招式（22 張）
// 招式造成傷害後，將自己（戰鬥寶可夢）恢復 N HP。
// ══════════════════════════════════════════════════════════════════════════════

export function selfHealPost(amount: number, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const before = att.active.damage;
    const healed = Math.min(before, amount);
    if (healed === 0) return state;
    att.active = { ...att.active, damage: before - healed };
    players[aIdx] = att;
    return addLog({ ...state, players }, `${attackName}：恢復 ${healed} HP`, aIdx);
  };
}

regPost('土台龜ex|叢林之錘', selfHealPost(50, '叢林之錘'));
regPost('萌虻|小吸取', selfHealPost(10, '小吸取'));
regPost('波盪水|極光增輝', selfHealPost(20, '極光增輝'));
regPost('向日花怪|超級吸取', selfHealPost(30, '超級吸取'));
regPost('小木靈|寄生種子', selfHealPost(20, '寄生種子'));
regPost('墨海馬|紋絲不動', selfHealPost(30, '紋絲不動'));
regPost('尖牙籠|偷食', selfHealPost(40, '偷食'));
regPost('瑪沙那|冥想', selfHealPost(20, '冥想'));
regPost('薩戮德|綠葉吸取', selfHealPost(20, '綠葉吸取'));
regPost('走鯨|吸取鰭', selfHealPost(20, '吸取鰭'));
regPost('超能豔鴕|螺旋吸取', selfHealPost(30, '螺旋吸取'));
regPost('蛋蛋|吸取', selfHealPost(10, '吸取'));
regPost('波克基古|吸取之吻', selfHealPost(30, '吸取之吻'));
regPost('水伊布|螺旋吸取', selfHealPost(30, '螺旋吸取'));
regPost('蒼炎刃鬼|生命之紗', selfHealPost(30, '生命之紗'));
regPost('新葉喵ex|魔法葉', selfHealPost(30, '魔法葉'));
regPost('陸地水母|超級吸取', selfHealPost(30, '超級吸取'));

// ── 對自己所有寶可夢（含戰鬥+備戰）各恢復 N HP ─────────────────────────────
function healAllOwnPost(amount: number, benchOnly: boolean, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    let totalHealed = 0;
    if (!benchOnly && p.active) {
      const healed = Math.min(p.active.damage, amount);
      if (healed > 0) {
        p.active = { ...p.active, damage: p.active.damage - healed };
        totalHealed += healed;
      }
    }
    p.bench = p.bench.map(c => {
      const healed = Math.min(c.damage, amount);
      if (healed > 0) { totalHealed += healed; return { ...c, damage: c.damage - healed }; }
      return c;
    });
    players[aIdx] = p;
    if (totalHealed === 0) return state;
    const target = benchOnly ? '所有備戰' : '所有自己寶可夢';
    return addLog({ ...state, players }, `${attackName}：${target}各恢復 ${amount} HP（累計 ${totalHealed}）`, aIdx);
  };
}
regPost('來悲粗茶ex|抹茶飛濺', healAllOwnPost(30, false, '抹茶飛濺'));
regPost('克雷色利亞|治癒之舞', healAllOwnPost(20, false, '治癒之舞'));
regPost('葉伊布ex|苔紋瑪瑙', healAllOwnPost(100, true, '苔紋瑪瑙'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38p v1.66 H 標第 11 波 — 條件式增傷（20+ 張）
// 均為 regPre 判斷條件，若符合則 base + bonus，否則 base。
// ══════════════════════════════════════════════════════════════════════════════

// v2.238 釐清（不再簡化）：name 結尾比對加 subtype 雙重判定。
//   - 普通 ex / 超級 ex：subtype === 'ex'（資料庫 621 張）
//   - V/VMAX/VSTAR/GX（標準環境已淘汰；未來新規則類型也涵蓋）
// 注意：「是不是 ex」用本函式（boolean）；「KO 取幾張獎賞」應用 prizesForKOLocal（含 Mega ex = 3 張）。
// v3.67：改用 isRulePokemon helper（同步未來新規則寶可夢類型）
function isExCard(c: Card | undefined): boolean {
  return isRulePokemon(c);
}
/** 與 engine.prizesForKO 同邏輯（避開 import cycle），統一給 effects.ts 內 KO 流程用。 */
// v5.172：加 export 給 m5_preview.ts 的深淵之瞳手動 KO 模式使用
export function prizesForKOLocal(c: Card | undefined): number {
  if (!c) return 1;
  if (!isExCard(c)) return 1;
  // 超級進化寶可夢 ex（Mega ex）取 3 張獎賞（與 engine.prizesForKO 同步）
  if (c.name.startsWith('超級')) return 3;
  return 2;
}
function isEvolvedCard(c: Card | undefined): boolean {
  return isEvolutionCard(c);
}

// 若對手戰鬥寶可夢處於特殊狀態 → +120
regPre('波盪水ex|宣洩吼嘯', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const hasStatus = !!state.players[dIdx].active?.status;
  return { state, damage: 120 + (hasStatus ? 120 : 0) };
});

// 若對手戰鬥寶可夢為 ex/V → +N（多張）
function defIsExPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const card = def ? pool.get(def.cardId) : undefined;
    if (isExCard(card)) {
      return { state: addLog(state, `${label}：對手為 ex/V → +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('泥偶巨人|鬥志之拳', defIsExPre(120, 120, '鬥志之拳'));
regPre('舞天鵝|鬥志之翼', defIsExPre(20, 90, '鬥志之翼'));
regPre('電蜘蛛ex|衝天之線', defIsExPre(110, 110, '衝天之線'));
regPre('火伊布|鬥志猛火', defIsExPre(90, 90, '鬥志猛火'));
regPre('水伊布|鬥志潮旋', defIsExPre(90, 90, '鬥志潮旋'));
regPre('雷伊布|鬥志雷霆', defIsExPre(90, 90, '鬥志雷霆'));
regPre('蒼炎刃鬼|鬥士的巨劍', defIsExPre(100, 100, '鬥士的巨劍'));
regPre('無極汰那|汰那爆破', defIsExPre(10, 80, '汰那爆破'));

// 若對手戰鬥寶可夢為進化寶可夢 → +N
function defIsEvolvedPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const card = def ? pool.get(def.cardId) : undefined;
    if (isEvolvedCard(card)) {
      return { state: addLog(state, `${label}：對手為進化寶可夢 → +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('毒骷蛙|俐落一擊', defIsEvolvedPre(90, 90, '俐落一擊'));
regPre('肯泰羅|俐落一擊', defIsEvolvedPre(50, 50, '俐落一擊'));

// 若對手戰鬥寶可夢為【1階進化】→ +90
regPre('帕底亞 肯泰羅|真氣衝撞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const card = def ? pool.get(def.cardId) : undefined;
  if (isStage1Card(card)) {
    return { state: addLog(state, '真氣衝撞：對手為 1 階進化 → +90', aIdx), damage: 180 };
  }
  return { state, damage: 90 };
});

// v5.685：對手戰鬥寶可夢與本身(銅鏡怪)同屬性 → +30。
//   「銅鏡怪|鏡面攻擊」有兩張不同 LIVE 卡：M5(鋼系,卡面判對手【鋼】)/SV5K(超系,判對手【超】)；
//   單一 key 無法區分，但兩版判定屬性恰 = 該版銅鏡怪【自身】屬性(鏡面映照) → 用「對手===自身屬性」
//   統一涵蓋。原寫死【超】→ M5 鋼版誤用【超】判定全錯(打鋼不加、打超反加)。
regPre('銅鏡怪|鏡面攻擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const defCard = def ? pool.get(def.cardId) : undefined;
  const selfActive = state.players[aIdx].active;
  const selfType = selfActive ? pool.get(selfActive.cardId)?.pokemonType : undefined;
  if (selfType && defCard?.pokemonType === selfType) {
    return { state: addLog(state, '鏡面攻擊：對手與本身同屬性 → +30', aIdx), damage: 40 };
  }
  return { state, damage: 10 };
});

// 若對手戰鬥寶可夢身上放置有傷害指示物 → +80
regPre('暴噬龜|堅硬嚼碎', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def && def.damage > 0) {
    return { state: addLog(state, '堅硬嚼碎：對手帶傷 → +80', aIdx), damage: 160 };
  }
  return { state, damage: 80 };
});

// 若對手戰鬥寶可夢【撤退】所需的能量為2個以上 → +110
regPre('烈箭鷹|氣旋競爭', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.711：用有效撤退費(含咒縛火焰/重力之玉/磁鐵鋼/浮遊/特性歸0 等修正)，不再用 base retreatCost.length。
  //   對齊 v5.690 阿利多斯線帶纏繞/鐵包袱瞬風衝激/背負上投/影繩結/幻影迷宮。卡面「撤退所需的能量」=最終值。
  const retreat = computeActiveRetreatCostFor(state, dIdx, pool);
  if (retreat >= 2) {
    return { state: addLog(state, `氣旋競爭：對手撤退 ${retreat} ≥ 2 → +110`, aIdx), damage: 220 };
  }
  return { state, damage: 110 };
});

// 若自己備戰區有【鋼】寶可夢 → +80
function selfBenchHasTypePre(base: number, bonus: number, ptype: EnergyType, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const has = state.players[aIdx].bench.some(b => pool.get(b.cardId)?.pokemonType === ptype);
    if (has) {
      return { state: addLog(state, `${label}：備戰區有【${ptype}】→ +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('破破舵輪|鋼鐵船錨', selfBenchHasTypePre(80, 80, 'Metal', '鋼鐵船錨'));
regPre('龍頭地鼠|鑽粉碎', selfBenchHasTypePre(60, 80, 'Metal', '鑽粉碎'));

// 若對手場上有【水】寶可夢 → +120
regPre('電擊魔獸|漏電關節', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  const has = [d.active, ...d.bench].some(c => c && pool.get(c.cardId)?.pokemonType === 'Water');
  if (has) {
    return { state: addLog(state, '漏電關節：對手場上有【水】→ +120', aIdx), damage: 160 };
  }
  return { state, damage: 40 };
});

// 若自己備戰區有名為 X 的寶可夢 → +N
function selfBenchHasNamePre(base: number, bonus: number, targetName: string, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const has = state.players[aIdx].bench.some(b => pool.get(b.cardId)?.name === targetName);
    if (has) {
      return { state: addLog(state, `${label}：備戰區有「${targetName}」→ +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('大狼犬|群起打獵', selfBenchHasNamePre(30, 90, '大狼犬', '群起打獵'));
regPre('電螢蟲|聯合攻擊', selfBenchHasNamePre(20, 60, '甜甜螢', '聯合攻擊'));

// 若對手戰鬥寶可夢身上附有寶可夢道具 → +80
regPre('大朝北鼻|進擊鐳射', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  // v3.20 多重轉接：iterate 所有道具
  if (def && getAllAttachedTools(def).length > 0) {
    return { state: addLog(state, '進擊鐳射：對手附有道具 → +80', aIdx), damage: 160 };
  }
  return { state, damage: 80 };
});

// 若自己剩餘獎賞卡張數 > 對手 → +90（獎賞反擊）
function selfPrizesMorePre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const diff = state.players[aIdx].prizes.length - state.players[dIdx].prizes.length;
    if (diff > 0) {
      return { state: addLog(state, `${label}：獎賞較多 → +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('摔角鷹人|獎賞反擊', selfPrizesMorePre(50, 90, '獎賞反擊'));
regPre('卡璞・鳴鳴|獎賞反擊', selfPrizesMorePre(90, 90, '獎賞反擊'));

// 若對手剩餘獎賞卡張數 ≤ 4 → +70
regPre('破空焰|爆燃突擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].prizes.length <= 4) {
    return { state: addLog(state, '爆燃突擊：對手獎賞 ≤4 → +70', aIdx), damage: 170 };
  }
  return { state, damage: 100 };
});

// 若自己牌庫剩餘 ≤ 3 → +200
regPre('蟲甲聖|絕地反攻', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length <= 3) {
    return { state: addLog(state, '絕地反攻：牌庫 ≤3 → +200', aIdx), damage: 240 };
  }
  return { state, damage: 40 };
});

// 若對手手牌 ≤ 5 → +60
regPre('師父鼬|疾風迴旋', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].hand.length <= 5) {
    return { state: addLog(state, '疾風迴旋：對手手牌 ≤5 → +60', aIdx), damage: 90 };
  }
  return { state, damage: 30 };
});

// 若這隻寶可夢身上附有【雷】能量卡 → +80
// v5.214 Bug 2：原 pokemonType==='Lightning' 永遠 false（能量卡 JSON pokemonType=null）。
//   改用既有 isEnergyOfType helper（含「【X】」name fallback），基本/特殊雷能量都正確識別。
regPre('電蜘蛛|麻麻羅網', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 50 };
  // v5.683：host-aware → 古舊/稜鏡(Basic)等「視為雷」的特殊能量也算「附有【雷】能量」
  const has = att.energyAttached.some(e => energyProvidesType(att, e, 'Lightning', pool));
  if (has) {
    return { state: addLog(state, '麻麻羅網：附有【雷】能量 → +80', aIdx), damage: 130 };
  }
  return { state, damage: 50 };
});

// 若自己場上的【惡】能量有 3 個以上 → +50
regPre('阿勃梭魯|惡棍墜落', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  // v5.683：host-aware 型別計數（火箭隊能量=2個【惡】、古舊/稜鏡(Basic)視為惡；「個」= 單位）
  let count = 0;
  for (const c of [p.active, ...p.bench]) {
    if (!c) continue;
    count += countEnergyTypeHostAware(c, 'Darkness', pool);
  }
  if (count >= 3) {
    return { state: addLog(state, `惡棍墜落：【惡】能量 ${count} ≥3 → +50`, aIdx), damage: 70 };
  }
  return { state, damage: 20 };
});

// 若場上有競技場卡 → +60，並丟棄那張競技場卡
regPre('古玉魚|大地熔化', (state, aIdx, _pool) => {
  if (state.activeStadium) {
    return { state: addLog(state, '大地熔化：場上有競技場 → +60', aIdx), damage: 120 };
  }
  return { state, damage: 60 };
});
regPost('古玉魚|大地熔化', (state, aIdx, pool) => {
  // v2.244 升級：用 discardActiveStadium helper 丟回擁有者棄牌堆（不再簡化）
  if (!state.activeStadium) return state;
  const _meltStadium = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
  return addLog(discardActiveStadium(state, aIdx), `大地熔化：丟棄競技場「${_meltStadium ?? '?'}」`, aIdx);
});

// 轟鳴月ex|災厄風暴 — 卡面：「若希望，將場上的競技場卡丟棄。這個情況下，增加120點傷害。」
//   v3.26 修：原有競技場時「強制棄 + 強制 +120」，違反卡面「若希望」。
//   借殼 binary-yes-no：場上有競技場時開 yes/no picker。
ATTACK_PRE_DISCARD_CHOICE.set('轟鳴月ex|災厄風暴', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 100, damagePerEnergy: 0,
  choicePrompt: '是否將場上的競技場卡丟棄，增加 120 點傷害？',
  choiceYesLabel: '是（+120 傷害 + 棄競技場）',
  choiceNoLabel: '否（保留競技場）',
});
regPre('轟鳴月ex|災厄風暴', (state, aIdx, _pool, action) => {
  if (!state.activeStadium) {
    return { state: addLog(state, '災厄風暴：場上無競技場 → 100', aIdx), damage: 100 };
  }
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return { state: addLog(state, '災厄風暴：選「否」 → 100 傷害（保留競技場）', aIdx), damage: 100 };
  }
  return { state: addLog(state, '災厄風暴：選「是」 → 100+120 = 220（POST 棄競技場）', aIdx), damage: 220 };
});
regPost('轟鳴月ex|災厄風暴', (state, aIdx, _pool, action) => {
  if (!state.activeStadium) return state;
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
  return discardActiveStadium(state, aIdx);
});

// 眷戀雲｜愛之同感：若自己場上有與對手場上寶可夢相同屬性的寶可夢 → +120
regPre('眷戀雲|愛之同感', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const a = state.players[aIdx], d = state.players[dIdx];
  const oppTypes = new Set<string>();
  for (const c of [d.active, ...d.bench]) {
    if (!c) continue;
    const t = pool.get(c.cardId)?.pokemonType;
    if (t) oppTypes.add(t);
  }
  const match = [a.active, ...a.bench].some(c => {
    if (!c) return false;
    const t = pool.get(c.cardId)?.pokemonType;
    return t ? oppTypes.has(t) : false;
  });
  if (match) {
    return { state: addLog(state, '愛之同感：同屬性在場 → +120', aIdx), damage: 200 };
  }
  return { state, damage: 80 };
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38q v1.67 H 標第 12 波 — other-bucket 簡單機制（8 張）
//   (a) 對手牌庫頂丟棄 N 張 — 巨炭山|山崩、雄偉牙|地盤崩壞
//   (b) 對手出場已灼傷才生效 — 焚焰蚣|焦黑吐息
//   (c) 攻擊 + 自身施加狀態 — 熔岩蟲|熾熱熔岩（既有 statusPost）
//   (d) 暫略特殊修正，當純傷害 — 故勒頓|撕裂
//   (e) 自身中毒則增傷 — 夠讚狗ex|瘋狂連鎖
//   (f) 攻擊 + 抽 N 張 — 貓頭夜鷹|鉤爪搜尋（v2.159 升級為 deck-search 玩家自選）
//   (g) 對對手任一寶可夢造成傷害 — 皮卡丘|電磁電光（10 傷害，opp-poke-choose）
//
// 已知未補完項：
//   - 地盤崩壞「古代支援者」附加 +3 張略（engine 未追蹤 supporter 類別）
//   - 撕裂「不計算身上附加效果」略（engine 未實作弱點/抵抗修正）
//   - 鉤爪搜尋：v2.159 已升級為 deck-search 任選最多 2 張（不再簡化）
// ══════════════════════════════════════════════════════════════════════════════

// 巨炭山|山崩 — 150 + 對手牌庫頂 2 張丟棄
regPost('巨炭山|山崩', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  const take = Math.min(2, p.deck.length);
  if (take === 0) return state;
  const discarded = p.deck.slice(0, take);
  const s = addLog(state, `山崩：丟對手牌庫頂 ${take} 張：${joinCardNames(discarded, pool)}`, aIdx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl, deck: pl.deck.slice(take), discard: [...pl.discard, ...discarded]
  }));
});

// 雄偉牙|地盤崩壞 — 0 傷害，丟對手牌庫頂 1 張；該回合用過「古代」支援者則再 +3 張（共 4 張）
// v2.160：補實裝古代支援者條件（用 v2.160 加的 ancientSupporterPlayedThisTurn flag）
regPre('雄偉牙|地盤崩壞', (state, _aIdx, _pool) => {
  return { state, damage: 0 };
});
regPost('雄偉牙|地盤崩壞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  // 基礎丟 1 張；本回合用過「古代」支援者再 +3 張
  const ancientUsed = state.players[aIdx].ancientSupporterPlayedThisTurn ?? false;
  const targetCount = ancientUsed ? 4 : 1;
  const take = Math.min(targetCount, p.deck.length);
  if (take === 0) return state;
  const discarded = p.deck.slice(0, take);
  const s = addLog(state,
    ancientUsed
      ? `地盤崩壞：本回合已用過「古代」支援者 → 丟對手牌庫頂 ${take} 張（1 + 3）：${joinCardNames(discarded, pool)}`
      : `地盤崩壞：丟對手牌庫頂 ${take} 張：${joinCardNames(discarded, pool)}`,
    aIdx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl, deck: pl.deck.slice(take), discard: [...pl.discard, ...discarded]
  }));
});

// 焚焰蚣|焦黑吐息 — 對手戰鬥寶可夢已灼傷則 180，否則招式失敗（0 傷害）
regPre('焚焰蚣|焦黑吐息', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def && def.status === 'burned') {
    return { state: addLog(state, '焦黑吐息：對手灼傷 → 180 傷害', aIdx), damage: 180 };
  }
  return { state: addLog(state, '焦黑吐息：對手未灼傷 → 招式失敗', aIdx), damage: 0 };
});

// 熔岩蟲|熾熱熔岩 — 20 + 灼傷
regPost('熔岩蟲|熾熱熔岩', statusPost('burned'));

// 故勒頓|撕裂 — 130（不計算對手戰鬥寶可夢身上的附加效果，Session 33 正式實作）
regPre('故勒頓|撕裂', (state, _aIdx, _pool) => {
  return { state, damage: 130, skipDefEffects: true };
});

// 故勒頓|原生亂打 — 30×自己場上「古代」寶可夢數量
// v2.67：實裝（Leon 回報備戰的猛雷鼓沒被計入）。依據 card.tags.includes('古代')
// 計算戰鬥 + 備戰區的古代寶可夢總數。
regPre('故勒頓|原生亂打', (state, aIdx, pool) => {
  const count = countAncientOnField(state, aIdx, pool);
  const damage = 30 * count;
  const s = addLog(
    state,
    `原生亂打：場上 ${count} 隻「古代」寶可夢 → ${damage} 傷害`,
    aIdx,
  );
  // v3.03：breakdown 顯示「古代寶可夢 N×30」
  if (count > 0) {
    return {
      state: s,
      damage,
      breakdown: [{ value: damage, label: `古代寶可夢 ${count}×30` }],
    };
  }
  return { state: s, damage };
});

// 夠讚狗ex|瘋狂連鎖 — 130 + 若自身中毒則 +130
regPre('夠讚狗ex|瘋狂連鎖', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  // v4.4991 fix：中毒實際存 secondaryStatus，補 OR 檢查
  const isSelfPoisoned = !!att && (att.status === 'poisoned' || att.secondaryStatus === 'poisoned' || att.tertiaryStatus === 'poisoned');
  if (isSelfPoisoned) {
    // v3.03：breakdown 拆「130(基礎) + 130(自身中毒)」
    return {
      state: addLog(state, '瘋狂連鎖：自身中毒 → +130', aIdx),
      damage: 260,
      breakdown: [
        { value: 130, label: '基礎' },
        { value: 130, label: '自身中毒' },
      ],
    };
  }
  return { state, damage: 130 };
});

// 貓頭夜鷹|鉤爪搜尋 70 — v5.534 收斂至中央 registerDamageThenOptionalDeckSearchToHand
//   （效果先於傷害；原 regPost 走共用 search-to-hand-reshuffle、傷害留引擎→KO 先拿獎才搜尋）
registerDamageThenOptionalDeckSearchToHand('貓頭夜鷹|鉤爪搜尋', { damage: 70, maxCount: 2, logName: '鉤爪搜尋' });

// 皮卡丘|電磁電光 — 對對手任一寶可夢（含備戰）造成 10 傷害
regPre('皮卡丘|電磁電光', (_state, _aIdx, _pool) => {
  return { state: _state, damage: 0 };
});
regPost('皮卡丘|電磁電光', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  // 若無備戰，直接對出場施加 10
  if (defender.bench.length === 0 && defender.active) {
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + 10;
    const defHP = defCard?.hp ?? 0;
    if (defHP > 0 && newDmg >= defHP) {
      const koDiscard: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...getAllAttachedTools(defender.active),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...koDiscard] };
      const _ko = koPrizesAdjusted(state, defender.active, defCard, (1 - dIdx) as 0 | 1, dIdx, pool);
      state = _ko.state;
      const prizes = _ko.prizes;
      let s = addLog({ ...state, players }, `電磁電光：10 傷害擊倒 ${defCard?.name ?? '?'}！${state.players[aIdx].name} 取得 ${prizes} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, defCard, 'attack');
      s = fireDefenderOnKO(s, dIdx, (1 - dIdx) as 0 | 1, pool, koDiscard[0], true, true);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return addPendingPrize(s, aIdx, prizes, pool);
    } else {
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: { ...defender.active!, damage: newDmg } };
      return addLog({ ...state, players }, `電磁電光：對 ${defCard?.name ?? '?'} 造成 10 傷害！`, aIdx);
    }
  }
  // 有備戰，讓玩家選擇
  let s = addLog(state, '電磁電光：選擇對手任一寶可夢造成 10 傷害', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-10',
    params: { includeActive: true },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38r v1.68 H 標第 13 波 — other-bucket 續（9 張）
//   (a) 攻擊 + 自回血 = 基礎傷害 — 朽木妖|終極吸取
//   (b) 丟競技場 — 洗翠 卡蒂狗|全部燒光
//   (c) 灼傷 — 洗翠 風速狗|灼燒
//   (d) 對備戰 ex/V 60 傷害 — 謝米|精刺奇襲
//   (e) 牌庫搜尋 Basic → 備戰 — 聒噪鳥|無伴奏合唱、向尾喵|呼朋引伴
//   (f) 牌庫搜尋 Pokemon → 手牌 — 啃果蟲|尋找朋友
//   (g) 攻擊後自交替 — 藍鱷|逆向噴射
//   (h) 從棄牌區各附 1 張【鬥】能量到備戰 — 重泥挽馬|泥巴庫存
// ══════════════════════════════════════════════════════════════════════════════

// 朽木妖|終極吸取 — 50 傷害 + 自回血 = 實際造成的傷害量
// v2.160：用 state.lastDealtDamage 讀引擎套用後的實際傷害（含弱抗 / 道具減傷）
// v2.236：改用 selfHealByDealtPost 共用 helper（同 pattern 也用於鐵毒蛾|吸納、火神蛾|吸血）
regPost('朽木妖|終極吸取', selfHealByDealtPost('終極吸取'));

// 洗翠 卡蒂狗|全部燒光 — 無傷害，丟棄競技場卡
regPre('洗翠 卡蒂狗|全部燒光', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('洗翠 卡蒂狗|全部燒光', (state, aIdx, pool) => {
  if (!state.activeStadium) return addLog(state, '全部燒光：場上沒有競技場', aIdx);
  // v2.244：用 discardActiveStadium helper 丟回擁有者棄牌堆
  const _burnStadium = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
  return addLog(discardActiveStadium(state, aIdx), `全部燒光：丟棄競技場「${_burnStadium ?? '?'}」`, aIdx);
});

// 洗翠 風速狗|灼燒 — 90 + 灼傷
regPost('洗翠 風速狗|灼燒', statusPost('burned'));

// 謝米|精刺奇襲 — 對備戰的 ex/V 60 傷害（不計弱抗）
regPre('謝米|精刺奇襲', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('謝米|精刺奇襲', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  const exBench = defender.bench.filter(c => {
    const card = pool.get(c.cardId);
    return isExCard(card);
  });
  if (exBench.length === 0) {
    return addLog(state, '精刺奇襲：對手備戰區沒有 ex/V 寶可夢', aIdx);
  }
  let s = addLog(state, '精刺奇襲：選對手備戰的 1 隻 ex/V 造成 60 傷害', aIdx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-60-ex',
    params: { validIids: exBench.map(c => c.iid) },
  });
});
regR('snipe-60-ex', (st, actorIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const target = defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  // v2.46 精刺奇襲 = 招式【傷害】→ 不受對戰圓形影響；只受花之帷幔擋（備戰 + 非 ex）
  //   實務上 snipe-60-ex 僅能選對手的 ex/EX，花之帷幔不保護 ex，故通常 pass；
  //   仍呼叫 resolveBenchGuard 以保持判定一致性。
  {
    const g = resolveBenchGuard(st, pool, actorIdx, targetCard, 'attack-damage');
    if (g.blocked) {
      const name = targetCard?.name ?? '?';
      return addLog(st, `精刺奇襲：${name} 因${g.reason}不受傷害`, actorIdx);
    }
  }
  {
    const coinS = passiveCoinImmunity(st, actorIdx, targetCard, pool);
    st = coinS.state;
    if (coinS.immune) return addLog(st, `精刺奇襲：${targetCard?.name ?? '?'} 擲幣免疫（正面）不受傷害`, actorIdx);
  }
  const newDmg = target.damage + 60;
  const targetHP = effectiveHPInline(target, pool, st);  // v5.091
  if (targetHP > 0 && newDmg >= targetHP) {
    const koDiscard: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...getAllAttachedTools(target),
      ...(target.evolvedFromStack ?? []),
    ];
    const _ko = koPrizesAdjusted(st, target, targetCard, (1 - dIdx) as 0 | 1, dIdx, pool);
    st = _ko.state;
    const prizes = _ko.prizes;
    const players = [...st.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...defender, bench: defender.bench.filter(c => c.iid !== targetIid),
      discard: [...defender.discard, ...koDiscard] };
    let s = addLog({ ...st, players }, `精刺奇襲：${targetCard?.name ?? '?'} 被擊倒！${st.players[actorIdx].name} 取得 ${prizes} 張獎賞卡。`, null);
    s = recordOppKO(s, dIdx, targetCard, 'attack');
    return addPendingPrize(s, actorIdx, prizes, pool);
  }
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...defender, bench: defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c) };
  return addLog({ ...st, players }, `精刺奇襲：對 ${targetCard?.name ?? '?'} 造成 60 傷害！`, actorIdx);
});

// 聒噪鳥|無伴奏合唱 — 從牌庫選最多 3 張 Basic 寶可夢卡放到備戰
regPre('聒噪鳥|無伴奏合唱', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('聒噪鳥|無伴奏合唱', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // v5.041：bench limit 改用 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
  const benchRoom = getOwnBenchLimit(state, aIdx, pool) - player.bench.length;
  if (benchRoom <= 0) return addLog(state, '無伴奏合唱：備戰區已滿', aIdx);
  let s = addLog(state, '無伴奏合唱：從牌庫選最多 3 張基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: Math.min(3, benchRoom),
    effectKey: 'bench-basic-from-deck',
  });
});

// 向尾喵|呼朋引伴 — 從牌庫選 1 張基礎寶可夢放備戰
regPre('向尾喵|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('向尾喵|呼朋引伴', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // v5.041：bench limit 改 getBenchLimit (5→8)
  if (player.bench.length >= getOwnBenchLimit(state, aIdx, pool)) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  let s = addLog(state, '呼朋引伴：從牌庫選 1 張基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'bench-basic-from-deck',
  });
});

// 啃果蟲|尋找朋友 — 從牌庫選 1 張寶可夢加手牌
regPre('啃果蟲|尋找朋友', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('啃果蟲|尋找朋友', (state, aIdx, _pool) => {
  let s = addLog(state, '尋找朋友：從牌庫選 1 張寶可夢加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// v2.216 土龍弟弟|尋找朋友（SVM 12165）— 同名招式但卡名不同
// 卡面：「從自己的牌庫選擇 1 張寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。」
// 由 audit-all-preset-effects.mjs 偵測出 — 阿響的火爆獸 preset 用此卡。
regPre('土龍弟弟|尋找朋友', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('土龍弟弟|尋找朋友', (state, aIdx, _pool) => {
  let s = addLog(state, '尋找朋友：從牌庫選 1 張寶可夢加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 藍鱷|逆向噴射 — 30 傷害 + 自己戰鬥寶可夢與備戰寶可夢互換
regPost('藍鱷|逆向噴射', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active || player.bench.length === 0) {
    return addLog(state, '逆向噴射：沒有可交替的備戰寶可夢', aIdx);
  }
  let s = addLog(state, '逆向噴射：選擇換入的備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'do-switch',
  });
});

// 重泥挽馬|泥巴庫存 — 從棄牌區給所有備戰各附 1 張基本【鬥】能量
regPre('重泥挽馬|泥巴庫存', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('重泥挽馬|泥巴庫存', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const benchLen = player.bench.length;
  if (benchLen === 0) return addLog(state, '泥巴庫存：沒有備戰寶可夢', aIdx);
  // 從棄牌區取出最多 benchLen 張「基本【鬥】能量」
  // v2.242 釐清（不再簡化）：filter 限定 subtype==='Basic' 且 (name 含「鬥」或 pokemonType==='Fighting')，
  //   排除「硬岩【鬥】」等特殊能量；候選同型 → 自動取前 N 張與卡面「各 1 張」等效。
  const fightingInDiscard: number[] = [];
  for (let i = 0; i < player.discard.length && fightingInDiscard.length < benchLen; i++) {
    const c = player.discard[i];
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.name.includes('鬥') || card.pokemonType === 'Fighting')) {
      fightingInDiscard.push(i);
    }
  }
  if (fightingInDiscard.length === 0) {
    return addLog(state, '泥巴庫存：棄牌區沒有基本【鬥】能量', aIdx);
  }
  const benchNames = player.bench.map(c => pool.get(c.cardId)?.name ?? '?');
  const used = new Set(fightingInDiscard);
  const energiesToAttach = player.discard.filter((_, i) => used.has(i));
  const remainingDiscard = player.discard.filter((_, i) => !used.has(i));
  // 依序附給每個備戰（能量不足則只附前 N 個）
  const newBench = player.bench.map((b, i) => {
    if (i < energiesToAttach.length) {
      return { ...b, energyAttached: [...b.energyAttached, energiesToAttach[i]] };
    }
    return b;
  });
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...player, bench: newBench, discard: remainingDiscard };
  const attached = energiesToAttach.length;
  const targets = benchNames.slice(0, attached).join('、');
  return addLog({ ...state, players }, `泥巴庫存：從棄牌區附 ${attached} 張【鬥】能量給備戰 (${targets})`, aIdx);
});

regR('snipe-10', (st, actorIdx, selectedIids, _params, pool) => {
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  // v5.440：改走中央 — 補 active 弱點 + 受傷反擊。
  return dealAttackDamageToTarget(st, actorIdx, targetIid, 10, pool, { kind: 'attack-damage', label: '電磁電光' });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38s v1.69 H 標第 14 波 — 傷害指示物直置 + 灼傷補齊（10 張）
//
// 新 helper:
//   applyDamageToAllOpp(state, aIdx, pool, amount, onlyDamaged, label)
//     → 對對手所有（或已有傷害指示物的）寶可夢各 +amount 傷害，處理 KO 串聯
//   setOppActiveHPPre(targetHP, label)
//     → 將對手戰鬥寶可夢的傷害設到 HP - targetHP（即剩餘 HP = targetHP）
//
// 實裝清單:
//   (a) 灼傷補齊（3 張）:呆火鱷|熱灼燒、熔岩蝸牛ex|熾熱熔岩、飄浮泡泡 太陽的樣子|灼熱
//   (b) 單點指示物（1 張）:綿綿泡芙|悄聲加害（20 傷害=2 個指示物）→ opp-poke-choose
//   (c) 全體指示物（2 張）:由克希|痛楚記憶（全體 +20）、伊裴爾塔爾|侵蝕之風（已傷 +20）
//   (d) HP 設定（2 張）:蜈蚣王|偏道一回（剩 10）、恰雷姆ex|氣功指壓（剩 50）
//   (e) 條件失敗（1 張）:古鼎鹿|傲慢衝擊（220，若自身 ≥4 指示物則失敗）
//   (f) plain（1 張）:八爪武師|觸手激怒（130；v2.161 已升級為動態能量費用 hook）
// ══════════════════════════════════════════════════════════════════════════════

/** 對 opp 全體或已傷寶可夢各加 amount 傷害，含 KO 處理 */
function applyDamageToAllOpp(
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  amount: number,
  onlyDamaged: boolean,
  label: string
): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  let prizesTotal = 0;
  const players = [...s.players] as [PlayerState, PlayerState];
  let defender = { ...players[dIdx] };

  // 處理 active
  if (defender.active && (!onlyDamaged || defender.active.damage > 0)) {
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + amount;
    const hp = effectiveHPInline(defender.active, pool, s);  // v5.091
    if (hp > 0 && newDmg >= hp) {
      const koDiscard: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...getAllAttachedTools(defender.active),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(s, defender.active, defCard, (1 - dIdx) as 0 | 1, dIdx, pool);
      s = _ko.state;
      const p = _ko.prizes;
      prizesTotal += p;
      defender = { ...defender, active: null, discard: [...defender.discard, ...koDiscard] };
      s = addLog(s, `${label}：${defCard?.name ?? '?'} 被擊倒！+${p} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, defCard, 'attack');
      s = fireDefenderOnKO(s, dIdx, (1 - dIdx) as 0 | 1, pool, koDiscard[0], true, true);
    } else {
      defender = { ...defender, active: { ...defender.active, damage: newDmg } };
    }
  }

  // 處理 bench（篩選條件後再累積指示物；KO 的收到 discard）
  // v4.52 Phase 3：改 per-target unified('attack-effect') — 補球形盾牌/藏隱/深度下潛/羽毛化石/薄霧/抵抗之幕/全能硬殼 等
  const blockedBenchNames: string[] = [];
  const newBench: CardInstance[] = [];
  for (const b of defender.bench) {
    if (onlyDamaged && b.damage === 0) { newBench.push(b); continue; }
    const card = pool.get(b.cardId);
    // defense check：'attack-effect' on bench → unified dispatch
    const _aaoppGuard = canApplyEffectToTarget(s, aIdx, b, card, 'attack-effect', pool, { isBench: true });
    if (_aaoppGuard.blocked) {
      blockedBenchNames.push(`${card?.name ?? '?'}(${_aaoppGuard.reason})`);
      newBench.push(b);
      continue;
    }
    const newDmg = b.damage + amount;
    const hp = effectiveHPInline(b, pool, s);  // v5.091
    if (hp > 0 && newDmg >= hp) {
      const koDiscard: CardInstance[] = [
        { ...b, damage: newDmg },
        ...b.energyAttached,
        ...getAllAttachedTools(b),
        ...(b.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(s, b, card, (1 - dIdx) as 0 | 1, dIdx, pool);
      s = _ko.state;
      const p = _ko.prizes;
      prizesTotal += p;
      defender = { ...defender, discard: [...defender.discard, ...koDiscard] };
      s = addLog(s, `${label}：${card?.name ?? '?'}（備戰）被擊倒！+${p} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, card, 'attack');
      // 不加入 newBench = 移除
    } else {
      newBench.push({ ...b, damage: newDmg });
    }
  }
  defender = { ...defender, bench: newBench };
  players[dIdx] = defender;
  s = { ...s, players };
  // v4.52 Phase 3：擋下的 bench targets 補一條 log
  if (blockedBenchNames.length > 0) {
    s = addLog(s, `${label}：${blockedBenchNames.join('、')} 未受影響`, aIdx);
  }

  if (prizesTotal > 0) {
    // 若 active 被擊倒且備戰空 → 勝利
    if (!defender.active && defender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return addPendingPrize(s, aIdx, prizesTotal, pool);
  }
  return s;
}

/** 將對手戰鬥寶可夢的傷害設為使剩餘 HP = targetHP */
function setOppActiveHPPre(targetHP: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def) return { state, damage: 0 };
    const card = pool.get(def.cardId);
    const hp = card?.hp ?? 0;
    if (hp <= targetHP) {
      return { state: addLog(state, `${label}：對手 HP 已在 ${targetHP} 以下，無效`, aIdx), damage: 0 };
    }
    const needed = hp - targetHP - def.damage;
    if (needed <= 0) {
      return { state: addLog(state, `${label}：對手已有足夠傷害指示物，無效`, aIdx), damage: 0 };
    }
    return { state: addLog(state, `${label}：讓對手剩餘 HP = ${targetHP}（+${needed} 傷害）`, aIdx), damage: needed };
  };
}

// 灼傷補齊
regPost('呆火鱷|熱灼燒', statusPost('burned'));
regPost('熔岩蝸牛ex|熾熱熔岩', statusPost('burned'));
regPre('飄浮泡泡 太陽的樣子|灼熱', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('飄浮泡泡 太陽的樣子|灼熱', statusPost('burned'));

// 綿綿泡芙|悄聲加害 — 對對手 1 隻寶可夢放置 2 個傷害指示物（= 20 傷害，使用現成 snipe-10 邏輯的 20 變種）
regPre('綿綿泡芙|悄聲加害', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('綿綿泡芙|悄聲加害', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  if (defender.bench.length === 0 && defender.active) {
    // 僅 active 可選，直接施加
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + 20;
    const hp = effectiveHPInline(defender.active, pool, state);  // v5.091
    const players = [...state.players] as [PlayerState, PlayerState];
    if (hp > 0 && newDmg >= hp) {
      const ko: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...getAllAttachedTools(defender.active),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(state, defender.active, defCard, (1 - dIdx) as 0 | 1, dIdx, pool, false);
      state = _ko.state;
      const p = _ko.prizes;
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...ko] };
      let s = addLog({ ...state, players }, `悄聲加害：${defCard?.name ?? '?'} 被擊倒！+${p} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, defCard, 'attack');
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return addPendingPrize(s, aIdx, p, pool);
    }
    players[dIdx] = { ...defender, active: { ...defender.active, damage: newDmg } };
    return addLog({ ...state, players }, `悄聲加害：對 ${defCard?.name ?? '?'} 造成 20 傷害`, aIdx);
  }
  let s = addLog(state, '悄聲加害：選擇對手任一寶可夢，放置 2 個傷害指示物', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-20',
    params: { includeActive: true },
  });
});

regR('snipe-20', (st, actorIdx, selectedIids, _params, pool) => {
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  // v5.440：放置2個傷害指示物(attack-effect, flat 不計弱抗)走中央。
  return dealAttackDamageToTarget(st, actorIdx, targetIid, 20, pool, { kind: 'attack-effect', label: '悄聲加害' });
});

// 由克希|痛楚記憶 — 對手所有寶可夢各放置 2 個指示物（= 20 傷害）
regPre('由克希|痛楚記憶', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('由克希|痛楚記憶', (state, aIdx, pool) => {
  return applyDamageToAllOpp(state, aIdx, pool, 20, false, '痛楚記憶');
});

// 伊裴爾塔爾|侵蝕之風 — 對手已傷寶可夢各放置 2 個指示物
// v2.126 伊裴爾塔爾｜緊抓 20 — 在下個對手回合，受到此招式的寶可夢無法撤退
regPre('伊裴爾塔爾|緊抓', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('伊裴爾塔爾|緊抓', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  if (!def.active) return state;
  const defName = pool.get(def.active.cardId)?.name ?? '?';
  def.active = { ...def.active, cantRetreatNextTurn: true };
  players[dIdx] = def;
  return addLog({ ...state, players },
    `緊抓：${defName} 在下個對手回合無法撤退`, aIdx);
});

regPre('伊裴爾塔爾|侵蝕之風', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('伊裴爾塔爾|侵蝕之風', (state, aIdx, pool) => {
  return applyDamageToAllOpp(state, aIdx, pool, 20, true, '侵蝕之風');
});

// 蜈蚣王|偏道一回 — 將對手戰鬥寶可夢剩餘 HP 變為 10
regPre('蜈蚣王|偏道一回', setOppActiveHPPre(10, '偏道一回'));

// 恰雷姆ex|氣功指壓 — 剩餘 HP 變為 50
regPre('恰雷姆ex|氣功指壓', setOppActiveHPPre(50, '氣功指壓'));

// 古鼎鹿|傲慢衝擊 — 220；若自身 ≥40 傷害（=4 指示物）則失敗
regPre('古鼎鹿|傲慢衝擊', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  if (att && att.damage >= 40) {
    return { state: addLog(state, '傲慢衝擊：自身 ≥4 指示物 → 招式失敗', aIdx), damage: 0 };
  }
  return { state, damage: 220 };
});

// 八爪武師|觸手激怒 — 130 plain；v2.161 補實裝動態能量費用
//   卡面：「若這隻寶可夢身上放置有傷害指示物，則這個招式只需要 1 個【鬥】能量即可使用。」
//   實作：engine canAffordAttack 內呼叫 getOctopusTentacleEffectiveCost helper 改寫 cost。
regPre('八爪武師|觸手激怒', (state, _aIdx, _pool) => ({ state, damage: 130 }));

// canAffordAttack hook — 給 engine 呼叫
export function getOctopusTentacleEffectiveCost(
  attackerInst: CardInstance,
  attackerName: string,
  attackName: string,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '八爪武師') return originalCost;
  if (attackName !== '觸手激怒') return originalCost;
  if (attackerInst.damage <= 0) return originalCost;
  // 身上有傷害指示物 → 改為 1 個【鬥】
  return ['Fighting'];
}

// v4.976 鐵螯龍蝦｜反撲剪 — 仿 v2.161 八爪武師|觸手激怒 pattern
// 卡面：「若這隻寶可夢身上放置有傷害指示物，則這個招式只需要 1 個【惡】能量即可使用。」
// 標準 cost = [Darkness, Darkness, Colorless]（3 顆，130 damage），
// 身上有 damage 時 → [Darkness]（1 顆惡）。
export function getIronCrabCounterClipEffectiveCost(
  attackerInst: CardInstance,
  attackerName: string,
  attackName: string,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '鐵螯龍蝦') return originalCost;
  if (attackName !== '反撲剪') return originalCost;
  if (attackerInst.damage <= 0) return originalCost;
  // 身上有傷害指示物 → 改為 1 個【惡】
  return ['Darkness'];
}

// ══════════════════════════════════════════════════════════════════════════════
// Session 38t v1.70 H 標第 15 波 — attach-energy × multiplier（20 張）
//
// Helper:
//   countEnergy(instance, filter, pool) → 依 filter（'all'/'basic'/'special'/EnergyType）計數
//   selfAttachedEnergyMultiplyPre(base, per, filter, label) — 自身附加能量 × per
//   defActiveEnergyMultiplyPre(base, per, filter, label) — 對手戰鬥寶可夢身上能量 × per
//   oppAllEnergyMultiplyPre(base, per, filter, label) — 對手全場能量 × per
//   selfAllEnergyMultiplyPre(base, per, filter, label) — 自己全場能量 × per
//   bothActiveEnergyMultiplyPre(base, per, label) — 雙方出場能量之和 × per
// ══════════════════════════════════════════════════════════════════════════════

// v4.55：export 供 cards/*.ts callers 共用（修 9 處自寫 pokemonType === type pattern 漏 fallback）
export type EnergyFilter = 'all' | 'basic' | 'special' | EnergyType;

// v3.731：能量名稱中文 type 對照（fallback when pokemonType is null）
const ENERGY_NAME_TO_TYPE: Record<string, EnergyType> = {
  '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '鬥': 'Fighting', '惡': 'Darkness', '鋼': 'Metal',
  '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless',
};
// v3.731：判定能量卡是否屬於某屬性 — 先看 pokemonType，沒設則 fallback 看 name【X】
function energyMatchesType(card: Card, filter: EnergyType): boolean {
  if (card.pokemonType === filter) return true;
  const m = card.name.match(/【(.+?)】/);
  return !!m && ENERGY_NAME_TO_TYPE[m[1]] === filter;
}

export function countOneEnergy(inst: CardInstance, filter: EnergyFilter, pool: Map<string, Card>): number {
  let count = 0;
  for (const e of inst.energyAttached) {
    const card = pool.get(e.cardId);
    if (!card || card.supertype !== 'Energy') continue;
    if (filter === 'all') count++;
    else if (filter === 'basic' && card.subtype === 'Basic') count++;
    else if (filter === 'special' && card.subtype === 'Special') count++;
    // v3.731：pokemonType=null 的 fallback — 看 card.name 的【X】
    else if (typeof filter === 'string' && energyMatchesType(card, filter as EnergyType)) count++;
  }
  return count;
}

// v4.797：host-aware 屬性能量計數 — 涵蓋特殊能量的 stage-dependent 行為
//   - 新衝天能量 on Stage2 → 任意屬性 ×2（同 engine.countEnergy）
//   - 稜鏡能量 on Basic → 任意屬性 ×1（on Evolution → Colorless ×1）
//   - 燃火能量 on Evolution → Colorless ×3（on Basic → ×1）
//   - 古舊能量 → 任意屬性 ×1（ACE SPEC 全屬性）
//   - 火箭隊能量 → Psychic ×2 + Darkness ×2（卡面「視為提供 2 個【超】【惡】2 種屬性的能量」=2 單位、每個都雙屬性）
//   - 其他特殊能量 / 基本能量：依 energyMatchesType（pokemonType + name【X】 fallback）
// 不從 engine import（avoid circular），inline 處理。若 engine.ts 的 SPECIAL_ENERGY_TYPES
// 改動需同步本檔。
// v5.682：單一附加能量「依 host 視為提供某屬性幾個單位」的單一來源。
//   countEnergyTypeHostAware（型別計數傷害）、energyProvidesType（選/移/丟「【X】能量」述詞）
//   與 UI energyTypeFilter 全部共用此邏輯，避免三份各自實作漂移（古舊/稜鏡/新衝天/燃火/火箭隊）。
// v5.702：energyTypeUnitsHostAware / energyProvidesType 已移至 engine.ts 單一底層來源
//   （讓 getUsableAbilities 可用性 gate 與本檔發動 handler 共用同一 host-aware 函式）。
//   此處 re-export 保持既有 caller（各 cards 檔 import from '../../effects'）不變。
export { energyTypeUnitsHostAware, energyProvidesType };

export function countEnergyTypeHostAware(host: CardInstance, type: EnergyType, pool: Map<string, Card>): number {
  let count = 0;
  for (const e of host.energyAttached) count += energyTypeUnitsHostAware(host, e, type, pool);
  return count;
}

// v5.439：大竺葵|繁茂 — 自己場上有大竺葵|繁茂 → 自方所有寶可夢身上附加的「基本【草】能量」
//   各視為 2 個（官方：能量供給改寫，傷害計算亦適用）。多隻不疊加。集中於此一函式，凡「依
//   附加草能量數算傷害/指示物」的招式/特性都該改走 countEnergyTypeBloomAware（一勞永逸，
//   避免每張卡各自 inline 漏算 — 已重複出包多次：昆蟲加農炮 v5.439 / 尖刺盔甲 v5.439）。
export function hasBloomOnField(state: GameState, ownerIdx: 0 | 1, pool: Map<string, Card>): boolean {
  // v5.601：繁茂 holder 被振翼髮暗夜羽擊(active)/海兔獸黏著束縛(bench Stage2)/鐵荊棘ex初始化消除時
  //   不算數（鐵律：新被動套用前必查 holder-effective）→ 走中央 isAbilityHolderEffective。
  const p = state.players[ownerIdx];
  const act = p.active;
  if (act) {
    const ac = pool.get(act.cardId);
    if (ac?.abilities?.some(ab => ab.name === '繁茂')
        && isAbilityHolderEffective(state, act, ac, ownerIdx, '繁茂', 'active', pool)) return true;
  }
  return p.bench.some(b => {
    const bc = pool.get(b.cardId);
    return !!bc?.abilities?.some(ab => ab.name === '繁茂')
      && isAbilityHolderEffective(state, b, bc, ownerIdx, '繁茂', 'bench', pool);
  });
}
// v5.601：把 nullification-aware 的繁茂判定注入 _shared（getEnergyDiscardUnits 等 units/cost 路徑共用單一來源）。
setBloomEffectiveFn(hasBloomOnField);

// host 身上某屬性能量數（host-aware 特殊能量 + 繁茂基本草×2）。依能量數算傷害/指示物用此。
export function countEnergyTypeBloomAware(
  host: CardInstance, type: EnergyType, state: GameState, ownerIdx: 0 | 1, pool: Map<string, Card>,
): number {
  let count = countEnergyTypeHostAware(host, type, pool);
  if (type === 'Grass' && hasBloomOnField(state, ownerIdx, pool)) {
    // 每個基本【草】能量 host-aware 已算 1，繁茂再 +1 → 視為 2。
    for (const e of host.energyAttached) {
      const ec = pool.get(e.cardId);
      if (ec?.supertype === 'Energy' && ec.subtype === 'Basic' && energyMatchesType(ec, 'Grass')) count += 1;
    }
  }
  return count;
}

// v4.963: 基本能量 pokemonType=null fallback helper — 認屬性能量含 name【X】 fallback。
function isEnergyOfType(ec: any, type: string): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = (ec.name || '').match(/【(.+?)】/);
  if (!m) return false;
  const zh: Record<string, string> = { '草':'Grass','火':'Fire','水':'Water','雷':'Lightning','超':'Psychic','鬥':'Fighting','惡':'Darkness','鋼':'Metal','妖':'Fairy','龍':'Dragon','無':'Colorless' };
  return zh[m[1]] === type;
}

// v5.671：移除 stale 重複定義 — countAttachedEnergyAsUnits 統一改用 _shared 版(host-aware:
//   火箭隊能量=2/燃火進化=3/新衝天Stage2=2/繁茂基本草×2),已於上方 import + 上方 re-export。
//   原 effects.ts 本地副本只認新衝天(火箭隊/燃火算1),違反卡面「能量的數量」=個語意(Wilson 裁定)。

function selfAttachedEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att) return { state, damage: base };
    // v4.797：type filter 改走 host-aware（認新衝天能量等特殊能量的 stage-dependent unit）
    const isTypeFilter = filter !== 'all' && filter !== 'basic' && filter !== 'special';
    const count = isTypeFilter
      ? countEnergyTypeHostAware(att, filter as EnergyType, pool)
      : filter === 'all' ? countAttachedEnergyAsUnits(att, pool) : countOneEnergy(att, filter, pool); // v5.448：'all'→單位計數(新衝天Stage2×2)
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：自身能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function defActiveEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    // v4.797：type filter 走 host-aware
    const isTypeFilter = filter !== 'all' && filter !== 'basic' && filter !== 'special';
    const count = def
      ? (isTypeFilter
          ? countEnergyTypeHostAware(def, filter as EnergyType, pool)
          : filter === 'all' ? countAttachedEnergyAsUnits(def, pool) : countOneEnergy(def, filter, pool)) // v5.448：'all'→單位計數
      : 0;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：對手出場能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function oppAllEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    // v4.797：type filter 走 host-aware
    const isTypeFilter = filter !== 'all' && filter !== 'basic' && filter !== 'special';
    let count = 0;
    for (const p of [d.active, ...d.bench]) {
      if (!p) continue;
      count += isTypeFilter
        ? countEnergyTypeHostAware(p, filter as EnergyType, pool)
        : filter === 'all' ? countAttachedEnergyAsUnits(p, pool) : countOneEnergy(p, filter, pool); // v5.448：'all'→單位計數
    }
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：對手全場能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function selfAllEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx];
    // v3.731：filter='Grass' + 自方有大竺葵繁茂 → 基本【草】能量算 2 個
    //   原邏輯只用 countOneEnergy 不套繁茂倍率，跟 bothActiveEnergyMultiplyPre 不對稱
    //   ( bothActiveEnergyMultiplyPre 用 countWithBloom inline helper)
    // v3.731: inline bloom check (effects.ts 不能 import engine.ts — circular)
    // v5.601：繁茂走中央 hasBloomOnField（被暗夜羽擊/黏著束縛/初始化消除時不算）
    const bloom = filter === 'Grass' && hasBloomOnField(state, aIdx, pool);
    let count = 0;
    // v4.797：type filter 走 host-aware（無繁茂時）；繁茂仍用原 inline 邏輯（基本草 +2）
    const isTypeFilter = filter !== 'all' && filter !== 'basic' && filter !== 'special';
    for (const p of [a.active, ...a.bench]) {
      if (!p) continue;
      if (!bloom) {
        count += isTypeFilter
          ? countEnergyTypeHostAware(p, filter as EnergyType, pool)
          : filter === 'all' ? countAttachedEnergyAsUnits(p, pool) : countOneEnergy(p, filter, pool); // v5.448：'all'→單位計數
        continue;
      }
      // 繁茂啟用：iterate 每個 energy，基本【草】 +2、其他依 filter 規則 +1
      for (const e of p.energyAttached) {
        const ec = pool.get(e.cardId);
        if (!ec || ec.supertype !== 'Energy') continue;
        const isBasicGrass = ec.subtype === 'Basic' && energyMatchesType(ec, 'Grass');
        if (isBasicGrass) count += 2;
        else if (energyMatchesType(ec, 'Grass')) count += 1;
      }
    }
    const bloomLog = bloom ? '（繁茂×2 套用基本【草】）' : '';
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：自己全場${filter}能量 ${count}${bloomLog} → ${dmg}`, aIdx), damage: dmg };
  };
}

function bothActiveEnergyMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const a = state.players[aIdx].active;
    const d = state.players[dIdx].active;
    // v5.671：收斂到中央 getEnergyDiscardUnits(host-aware 單一來源:火箭隊能量=2/燃火進化=3/
    //   新衝天Stage2=2/繁茂基本草×2)。原逐張只認新衝天+繁茂、漏火箭隊=2/燃火=3(卡面「能量的數量」=個)。
    function countWithBloom(inst: CardInstance | null | undefined, ownerIdx: 0 | 1): number {
      if (!inst) return 0;
      let n = 0;
      for (const e of inst.energyAttached) {
        const ec = pool.get(e.cardId);
        if (!ec || ec.supertype !== 'Energy') continue;
        n += getEnergyDiscardUnits(e.cardId, inst, pool, state, ownerIdx);
      }
      return n;
    }
    const count = countWithBloom(a, aIdx) + countWithBloom(d, dIdx);
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：雙方出場能量合計 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

// 自身附加（filter）
regPre('奇諾栗鼠|特殊滾滾', selfAttachedEnergyMultiplyPre(0, 70, 'special', '特殊滾滾'));
// v2.250 奇諾栗鼠ex｜能量巴掌 — 自身附加能量數 × 40
regPre('奇諾栗鼠ex|能量巴掌', selfAttachedEnergyMultiplyPre(0, 40, 'all', '能量巴掌'));
regPre('巨炭山|機槍瀝青', selfAttachedEnergyMultiplyPre(40, 80, 'Fire', '機槍瀝青'));
regPre('吉雉雞|能量羽毛', selfAttachedEnergyMultiplyPre(0, 30, 'all', '能量羽毛'));
regPre('刺龍王ex|水炮', selfAttachedEnergyMultiplyPre(50, 50, 'Water', '水炮'));
regPre('拉普拉斯ex|力量飛濺', selfAttachedEnergyMultiplyPre(0, 40, 'all', '力量飛濺'));
regPre('帕路奇亞|空間粉碎', selfAttachedEnergyMultiplyPre(0, 40, 'basic', '空間粉碎'));

// 對手戰鬥寶可夢身上
regPre('蟲甲聖|精神強念', defActiveEnergyMultiplyPre(10, 30, 'all', '精神強念'));
regPre('霏歐納|能量壓制', defActiveEnergyMultiplyPre(0, 20, 'all', '能量壓制'));
regPre('勇基拉|精神強念', defActiveEnergyMultiplyPre(10, 30, 'all', '精神強念'));
regPre('胡地|精神強念', defActiveEnergyMultiplyPre(10, 50, 'all', '精神強念'));
regPre('洛托姆|能量短路', defActiveEnergyMultiplyPre(0, 20, 'all', '能量短路'));

// 對手全場
regPre('向日花怪|光返', oppAllEnergyMultiplyPre(0, 60, 'Fire', '光返'));
regPre('蒂安希|漫反射', oppAllEnergyMultiplyPre(0, 40, 'special', '漫反射'));
regPre('塗標客|能量塗鴉', oppAllEnergyMultiplyPre(0, 40, 'all', '能量塗鴉'));
regPre('葉伊布ex|綠葉風暴', oppAllEnergyMultiplyPre(0, 60, 'all', '綠葉風暴'));

// 自己全場
regPre('蜜集大蛇ex|蜜糖風暴', selfAllEnergyMultiplyPre(30, 30, 'Grass', '蜜糖風暴'));

// 雙方出場
regPre('厄鬼椪 碧草面具ex|萬葉陣雨', bothActiveEnergyMultiplyPre(30, 30, '萬葉陣雨'));

// 猛雷鼓|落雷風暴 — 0 base，傷害 = 自身能量 × 30，對對手任意 1 隻（含備戰）
regPre('猛雷鼓|落雷風暴', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  // v5.689：卡面「能量的數量」= host-aware 單位數(火箭隊2/燃火進化3)，原 countOneEnergy('all') 每張算1會少算。
  const count = att ? countAttachedEnergyAsUnits(att, pool, state, aIdx) : 0;
  // 不在這裡造成傷害給對手出場，由 POST 處理任意目標
  return { state: addLog(state, `落雷風暴：自身能量 ${count} → 對任一 ${count * 30} 傷害（不計弱抗）`, aIdx), damage: 0 };
});
regPost('猛雷鼓|落雷風暴', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const count = att ? countAttachedEnergyAsUnits(att, pool, state, aIdx) : 0;
  const dmg = count * 30;
  if (dmg === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  if (defender.bench.length === 0 && defender.active) {
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + dmg;
    const hp = effectiveHPInline(defender.active, pool, state);  // v5.091
    const players = [...state.players] as [PlayerState, PlayerState];
    if (hp > 0 && newDmg >= hp) {
      const ko: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...getAllAttachedTools(defender.active),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(state, defender.active, defCard, (1 - dIdx) as 0 | 1, dIdx, pool);
      state = _ko.state;
      const p = _ko.prizes;
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...ko] };
      let s = addLog({ ...state, players }, `落雷風暴：${defCard?.name ?? '?'} 被擊倒！+${p} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, defCard, 'attack');
      s = fireDefenderOnKO(s, dIdx, (1 - dIdx) as 0 | 1, pool, ko[0], true, true);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return addPendingPrize(s, aIdx, p, pool);
    }
    players[dIdx] = { ...defender, active: { ...defender.active, damage: newDmg } };
    return addLog({ ...state, players }, `落雷風暴：對 ${defCard?.name ?? '?'} 造成 ${dmg} 傷害`, aIdx);
  }
  let s = addLog(state, `落雷風暴：選擇對手任一寶可夢造成 ${dmg} 傷害`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { includeActive: true, damage: dmg, label: '落雷風暴' },
  });
});

/**
 * v5.385：中央「對單一目標結算招式傷害」函式（一勞永逸）。
 *   收斂所有手動結算傷害的招式（狙擊/分配/多打）— 統一處理：
 *   免疫(canApplyEffectToTarget + PASSIVE_IMMUNITY + 擲幣) → 弱點×2/抵抗/攻擊方道具
 *   (僅 active + attack-damage 套) → 加傷 → 擊倒(獎賞卡 + game-over)。
 *   完整鏡射既有 snipe-variable(v5.369/v5.370) 邏輯；snipe-variable 改為薄包裝呼叫本函式。
 *   備戰目標不計弱抗；放傷害指示物(kind='attack-effect')亦不套弱抗。
 */
// ─────────────────────────────────────────────────────────────────────────────
// v5.435：防守方「受招式傷害時」反擊/觸發共用 helper。把主管線(engine.ts)散落的
//   6 種 on-damaged 機制收斂成一份，給手動結算傷害的狙擊/分配 resolver
//   （dealAttackDamageToTarget / snipe-multi）共用，讓被狙擊的寶可夢也能正常觸發反擊。
//   主管線維持自己那套（已 battle-tested，本次不動）。只處理「防守方 active 受招式傷害」。
//   涵蓋：1 TOOL_ON_DAMAGED(奢華炸彈/凸凸頭盔/幸運頭盔，阻礙之塔失效)
//        2 SPECIAL_ENERGY_ON_DAMAGED(扣殺能量)
//        3 PASSIVE_RETALIATION(毒刺/反擊/尖刺盔甲/怨恨旋渦…)+怨恨旋渦備戰 field-wide
//        4 PASSIVE_ON_DAMAGED(警備濁霧)
//        5 retaliateCountersOnNextHit(還擊斧/等待角擊/殼捲風旋轉)
//        6 龐克頭盔反射(戰鬥場【惡】+40，阻礙之塔失效)
//   光之翼(攻擊方)免疫對手特性反擊；反傷可反殺攻擊方(含 game-over)。
// ─────────────────────────────────────────────────────────────────────────────
export function fireDefenderOnDamaged(
  st: GameState, dIdx: 0 | 1, aIdx: 0 | 1, baseDamage: number, pool: Map<string, Card>,
): GameState {
  if (baseDamage <= 0) return st;
  const defActive0 = st.players[dIdx].active;
  if (!defActive0) return st;
  const defCard = pool.get(defActive0.cardId);
  const atkCard0 = st.players[aIdx].active ? pool.get(st.players[aIdx].active!.cardId) : null;
  const stadiumCard = st.activeStadium ? pool.get(st.activeStadium.cardId) : null;
  const toolsJammed = !!stadiumCard && JAMMING_TOWER_STADIUMS.has(stadiumCard.name);
  const attackerHasMagicalShine = atkCard0?.abilities?.some(a => a.name === '光之翼') ?? false;
  let s = st;
  const atkDamageBefore = s.players[aIdx].active?.damage ?? 0;
  // 1. TOOL_ON_DAMAGED（阻礙之塔失效）
  if (!toolsJammed) {
    for (const t of getAllAttachedTools(defActive0)) {
      const tool = pool.get(t.cardId);
      if (!tool) continue;
      const fn = TOOL_ON_DAMAGED.get(tool.name);
      if (fn) s = fn(s, dIdx, aIdx, baseDamage, pool);
    }
  }
  // 2. SPECIAL_ENERGY_ON_DAMAGED（扣殺能量）
  for (const e of defActive0.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec) continue;
    const fn = SPECIAL_ENERGY_ON_DAMAGED.get(ec.name);
    if (fn) s = fn(s, dIdx, aIdx, baseDamage, pool);
  }
  // 3+4. PASSIVE_RETALIATION + PASSIVE_ON_DAMAGED（光之翼擋）
  if (!attackerHasMagicalShine && defCard?.abilities) {
    for (const ab of defCard.abilities) {
      if (!isAbilityHolderEffective(s, defActive0, defCard, dIdx, ab.name, 'active', pool)) continue; // v5.656 暗夜羽擊/初始化等壓制→反擊失效
      const retal = PASSIVE_RETALIATION.get(ab.name);
      if (retal) s = retal(s, dIdx, pool);
    }
    for (const ab of defCard.abilities) {
      if (!isAbilityHolderEffective(s, defActive0, defCard, dIdx, ab.name, 'active', pool)) continue; // v5.656
      const fnOD = PASSIVE_ON_DAMAGED.get(ab.name);
      if (fnOD) s = fnOD(s, dIdx, aIdx, pool, defCard);
    }
  }
  // v5.494：卡面內建受傷反擊（陳舊的頭蓋化石等，無 abilities，按卡名；非特性不受光之翼擋）。
  if (baseDamage > 0) s = applyInherentRetaliation(s, dIdx, defCard, pool);
  // 3b. 怨恨旋渦 field-wide（自方戰鬥場為【惡】時掃備戰）
  if (!attackerHasMagicalShine) {
    const da = s.players[dIdx].active;
    const daCard = da ? pool.get(da.cardId) : null;
    if (daCard?.pokemonType === 'Darkness') {
      for (const benchInst of s.players[dIdx].bench) {
        const bc = pool.get(benchInst.cardId);
        if (!bc?.abilities) continue;
        for (const ab of bc.abilities) {
          if (ab.name === '怨恨旋渦') {
            if (!isAbilityHolderEffective(s, benchInst, bc, dIdx, '怨恨旋渦', 'bench', pool)) continue; // v5.656
            const fn = PASSIVE_RETALIATION.get('怨恨旋渦');
            if (fn) s = fn(s, dIdx, pool);
          }
        }
      }
    }
  }
  // 5. retaliateCountersOnNextHit（還擊斧/等待角擊/殼捲風旋轉）
  {
    const retalN = s.players[dIdx].active?.retaliateCountersOnNextHit;
    if (retalN && retalN > 0) {
      const refPlayers = [...s.players] as [PlayerState, PlayerState];
      if (refPlayers[aIdx].active) {
        refPlayers[aIdx] = { ...refPlayers[aIdx], active: { ...refPlayers[aIdx].active!, damage: refPlayers[aIdx].active!.damage + retalN * 10 } };
      }
      if (refPlayers[dIdx].active) {
        const newAct = { ...refPlayers[dIdx].active! };
        delete newAct.retaliateCountersOnNextHit;
        refPlayers[dIdx] = { ...refPlayers[dIdx], active: newAct };
      }
      s = addLog({ ...s, players: refPlayers }, `反擊：對攻擊方放 ${retalN} 個傷害指示物（${retalN * 10} 點傷害）`, dIdx);
    }
  }
  // 6. 龐克頭盔反射（戰鬥場【惡】+40，阻礙之塔失效）
  if (!toolsJammed) {
    const da = s.players[dIdx].active;
    const daTool = da?.toolAttached ? pool.get(da.toolAttached.cardId) : null;
    const daCard = da ? pool.get(da.cardId) : null;
    if (daTool?.name === '龐克頭盔' && daCard?.pokemonType === 'Darkness' && s.players[aIdx].active) {
      const refPlayers = [...s.players] as [PlayerState, PlayerState];
      refPlayers[aIdx] = { ...refPlayers[aIdx], active: { ...refPlayers[aIdx].active!, damage: refPlayers[aIdx].active!.damage + 40 } };
      s = addLog({ ...s, players: refPlayers }, `🔧 龐克頭盔：${atkCard0?.name ?? '攻擊方'} 受到 40 傷害反擊！`, null);
    }
  }
  // 反傷反殺攻擊方（含 game-over）
  const retaliatedAtk = s.players[aIdx].active;
  if (retaliatedAtk && retaliatedAtk.damage > atkDamageBefore) {
    const retAtkCard = pool.get(retaliatedAtk.cardId);
    const retAtkEffHP = effectiveHPInline(retaliatedAtk, pool, s);
    if (retAtkCard && retAtkEffHP > 0 && retaliatedAtk.damage >= retAtkEffHP) {
      const retKoDiscard: CardInstance[] = [
        retaliatedAtk,
        ...retaliatedAtk.energyAttached,
        ...getAllAttachedTools(retaliatedAtk),
        ...(retaliatedAtk.evolvedFromStack ?? []),
      ];
      // v5.469 還原：反彈/反擊道具傷害擊倒攻擊方，非「受到對手招式傷害」(攻擊方是自己撞上反傷) → 保留 base。
      const retKOPrizes = prizesForKOLocal(retAtkCard);
      const retPlayers = [...s.players] as [PlayerState, PlayerState];
      retPlayers[aIdx] = { ...retPlayers[aIdx], active: null, discard: [...retPlayers[aIdx].discard, ...retKoDiscard] };
      s = addLog(addPendingPrize({ ...s, players: retPlayers }, dIdx, retKOPrizes, pool),
        `${retAtkCard.name} 被反彈傷害擊倒！${s.players[dIdx].name} 取得 ${retKOPrizes} 張獎賞卡。`, null);
      if (retPlayers[aIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: dIdx, winReason: `${retPlayers[aIdx].name} 沒有可上場的寶可夢` };
      }
    }
  }
  return s;
}

// v5.495：共用「被 KO 觸發附加道具 TOOL_ON_KO」（沉重接力棒移能量 / 希望護身符抽牌）。
//   原本只有 engine 主管線(攻擊打對手 active)會呼叫 TOOL_ON_KO；中央傷害 helper
//   dealAttackDamageToTarget(狙擊/分配/中央結算)漏呼叫 → 走中央 helper 的招式 KO 帶
//   沉重接力棒的吼鯨王ex 時，5 顆能量直接進棄牌、反擊效果不觸發（玩家回報）。
//   gate：① isActive（兩張 TOOL_ON_KO 卡面皆「在戰鬥場…昏厥」才觸發）
//         ② 阻礙之塔(JAMMING_TOWER) → 道具失效
//         ③ 只在「招式傷害」KO 觸發（效果昏厥 koTargetByAttackEffect 不走這，卡面「受到…傷害而昏厥」）。
//   koInst = KO 前的 instance snapshot（含 tools + energy）。
export function fireDefenderOnKO(
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, pool: Map<string, Card>,
  koInst: CardInstance, isActive: boolean, koByAttackDamage: boolean = true,
): GameState {
  // v5.573：收斂「戰鬥位被招式 KO」時的防守方 on-KO 機制——原本只有引擎主管線觸發，
  //   走中央 helper dealAttackDamageToTarget / inline 傷害 resolver 的招式 KO 戰鬥位時會漏。
  //   三類：① TOOL_ON_KO(沉重接力棒/希望護身符) ② PASSIVE_KO_RETALIATION(沙鈴仙人掌 炸裂針)
  //   ③ PASSIVE_ON_KO(桃歹郎 最後鎖鏈 / 願增猿ex 鬆口氣 / 密勒頓 光子密碼)。
  //   皆「戰鬥位」(isActive) 且「受招式傷害昏厥」(koByAttackDamage) 才觸發；效果KO不觸發。
  if (!isActive) return state;
  let s = state;
  const stadiumCard = s.activeStadium ? pool.get(s.activeStadium.cardId) : null;
  const toolsJammed = !!stadiumCard && JAMMING_TOWER_STADIUMS.has(stadiumCard.name);
  // ① TOOL_ON_KO（維持原行為：isActive + 阻礙之塔失效）
  if (!toolsJammed) {
    for (const t of getAllAttachedTools(koInst)) {
      const tool = pool.get(t.cardId);
      if (!tool) continue;
      const fn = TOOL_ON_KO.get(tool.name);
      if (fn) s = fn(s, dIdx, aIdx, pool, koInst);
    }
  }
  if (koByAttackDamage) {
    const koCard = pool.get(koInst.cardId);
    const attackerHasMagicalShine = s.players[aIdx].active
      ? (pool.get(s.players[aIdx].active!.cardId)?.abilities?.some(a => a.name === '光之翼') ?? false) : false;
    // ② PASSIVE_KO_RETALIATION（炸裂針）→ 對攻擊方放指示物（光之翼擋；初始化/暗夜羽擊等消除 holder 特性則跳過）
    if (koCard?.abilities && !attackerHasMagicalShine) {
      for (const ab of koCard.abilities) {
        if (!isAbilityHolderEffective(state, koInst, koCard, dIdx, ab.name, 'active', pool)) continue;
        const ret = PASSIVE_KO_RETALIATION.get(ab.name);
        if (!ret) continue;
        const refPlayers = [...s.players] as [PlayerState, PlayerState];
        if (refPlayers[aIdx].active) {
          const dmg = ret.counters * 10;
          refPlayers[aIdx] = { ...refPlayers[aIdx], active: { ...refPlayers[aIdx].active!, damage: refPlayers[aIdx].active!.damage + dmg } };
          const attName = pool.get(refPlayers[aIdx].active!.cardId)?.name ?? '?';
          s = addLog({ ...s, players: refPlayers }, `「${ab.name}」啟動：${attName} 身上放置 ${ret.counters} 個傷害指示物（+${dmg}）`, dIdx);
        }
      }
    }
    // ③ PASSIVE_ON_KO（桃歹郎/鬆口氣/光子密碼）
    if (koCard?.abilities) {
      for (const ab of koCard.abilities) {
        const fnKO = PASSIVE_ON_KO.get(ab.name);
        if (fnKO) s = fnKO(s, dIdx, aIdx, pool, koCard, koInst);
      }
    }
  }
  return s;
}

/**
 * v5.517 收斂中央管線：攻擊方「對對手戰鬥寶可夢」的招式傷害加成（weakness 前套用）。
 * 單一來源，供引擎主管線與中央 helper dealAttackDamageToTarget 共用，避免兩邊分歧
 * （玩家報「力量蛋白飲對波動突刺沒生效」= 波動突刺主傷害走中央 helper、繞過引擎加成）。
 * 涵蓋：伏特【雷】能量 / 攻擊道具 TOOL_ATTACK_BONUS / 被動特性 PASSIVE_ATTACK_BONUS /
 *       力量蛋白飲(【鬥】+30) / 夠讚狗 腎上腺力量 / 化朗鎮 / 空手道王演練 / 烏栗。
 * 不含「消耗型旗標」(下回合加傷 damageBonusThisTurn / 招致削傷 nextOwnAttackPenalty /
 *       格拉吉歐的決戰)——這些有消耗語意，留在引擎主管線結算。
 * guard：state._attackerActiveBonusDone 為 true(引擎已套)時不重複；dmg<=0 不套不標記
 *        (讓 regPre=0 的招式由中央 helper 補套)。
 */
// v5.535 收斂：引擎主管線 inline 的「回合型/消耗型」加成（回合加傷／受招削傷／格拉吉歐的決戰）
//   原本只在 engine 主傷害區套用；走中央 dealAttackDamageToTarget 的招式（延後傷害如忍之利刃／
//   狙擊類）會漏。現納入 applyAttackerActiveDamageBonuses（受 _attackerActiveBonusDone guard：
//   一般攻擊 engine 已 inline 套用並設旗標→中央 helper 早退、不雙套；只有 baseDamage=0 的延後／
//   狙擊路徑才會在此套用）。祭典樂舞首擊不消耗消耗型旗標，需本地複製判定（effects.ts 不能 import engine）。
function _isFestivalDanceFirstAttackLocal(state: GameState, aIdx: 0 | 1, pool: Map<string, Card>): boolean {
  const a = state.players[aIdx].active;
  if (!a) return false;
  const card = pool.get(a.cardId);
  if (!card?.abilities?.some(ab => ab.name === '祭典樂舞')) return false;
  const sd = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  if (sd?.name !== '祭典會場') return false;
  if (state.festivalDanceUsedThisTurn?.[aIdx]) return false;
  if (state.festivalDanceSecondAttackUsed?.[aIdx]) return false;
  return true;
}
export function applyAttackerActiveDamageBonuses(
  state: GameState, aIdx: 0 | 1, dmg: number, pool: Map<string, Card>,
): { damage: number; state: GameState; formula: { sign: string; value: number; label: string }[] } {
  const formula: { sign: string; value: number; label: string }[] = [];
  if (dmg <= 0) return { damage: dmg, state, formula };
  if (state._attackerActiveBonusDone) return { damage: dmg, state, formula };
  const attacker = state.players[aIdx];
  const aInst = attacker.active;
  if (!aInst) return { damage: dmg, state, formula };
  const aCard = pool.get(aInst.cardId);
  if (!aCard) return { damage: dmg, state, formula };
  const defender = state.players[(1 - aIdx) as 0 | 1];
  const dInst = defender.active;
  if (!dInst) return { damage: dmg, state, formula };
  const dCard = pool.get(dInst.cardId);
  let d = dmg;
  let s = state;
  const _colorlessBlocked = (card: Card | undefined): boolean => {
    if (!card || card.pokemonType !== 'Colorless') return false;
    const sd = state.activeStadium; if (!sd) return false;
    const sdCard = pool.get(sd.cardId); if (!sdCard) return false;
    return ROCKET_WATCHTOWER_STADIUMS.has(sdCard.name);
  };
  const _toolsJammed = !!state.activeStadium
    && JAMMING_TOWER_STADIUMS.has(pool.get(state.activeStadium.cardId)?.name ?? '');
  // ── v5.535 回合加傷（damageBonusThisTurn；巨金怪彗星拳／大電海燕風力充能／奔流之心，下次攻擊 +N）──
  //   消耗型，祭典樂舞首擊不消耗。一般攻擊 engine 已 inline 套+設 guard→此處只在延後/狙擊(baseDamage=0)路徑生效。
  if (aInst.damageBonusThisTurn) {
    const b = aInst.damageBonusThisTurn; d += b;
    s = addLog(s, `${aCard.name} 招式傷害 +${b}（回合加傷效果）`, aIdx);
    formula.push({ sign: '+', value: b, label: '回合加傷' });
    if (!_isFestivalDanceFirstAttackLocal(state, aIdx, pool) && s.players[aIdx].active) {
      const na = { ...s.players[aIdx].active! }; delete na.damageBonusThisTurn;
      const ps = [...s.players] as [PlayerState, PlayerState]; ps[aIdx] = { ...ps[aIdx], active: na };
      s = { ...s, players: ps };
    }
  }
  // ── v5.535 受招削傷（nextOwnAttackPenalty；對手叫聲/吠/咆哮設給我方 active，自己出招 -N）──
  //   消耗型，祭典樂舞首擊不消耗。
  {
    const cur = s.players[aIdx].active;
    if (cur?.nextOwnAttackPenalty) {
      const pen = cur.nextOwnAttackPenalty; d = Math.max(0, d - pen);
      s = addLog(s, `${aCard.name} 招式傷害 -${pen}（受招致使傷害削減效果）`, aIdx);
      formula.push({ sign: '-', value: pen, label: '招致削傷' });
      if (!_isFestivalDanceFirstAttackLocal(state, aIdx, pool) && s.players[aIdx].active) {
        const na = { ...s.players[aIdx].active! }; delete na.nextOwnAttackPenalty;
        const ps = [...s.players] as [PlayerState, PlayerState]; ps[aIdx] = { ...ps[aIdx], active: na };
        s = { ...s, players: ps };
      }
    }
  }
  // ── v5.535 格拉吉歐的決戰（player-level +80，非規則寶可夢；END_TURN 清、不在此消耗）──
  if (attacker.gladionDuelBonusThisTurn && !isRulePokemon(aCard)) {
    d += 80;
    s = addLog(s, `${aCard.name} 招式傷害 +80（格拉吉歐的決戰，非規則寶可夢加成）`, aIdx);
    formula.push({ sign: '+', value: 80, label: '格拉吉歐的決戰' });
  }
  // ── 伏特【雷】能量（【雷】屬性附加者 +20/張）─────────────────────────────
  if (aCard.pokemonType === 'Lightning') {
    const n = aInst.energyAttached.filter(e => pool.get(e.cardId)?.name === '伏特【雷】能量').length;
    if (n > 0) {
      const b = 20 * n; d += b;
      s = addLog(s, `${aCard.name} 招式傷害 +${b}（伏特【雷】能量 ${n} 張 × 20，【雷】屬性）`, aIdx);
      formula.push({ sign: '+', value: b, label: `伏特【雷】能量×${n}` });
    }
  }
  // ── 攻擊方道具加成（極限腰帶 / 猛攻手鐲 等；阻礙之塔時失效）─────────────
  if (!_toolsJammed) {
    for (const t of getAllAttachedTools(aInst)) {
      const atkTool = pool.get(t.cardId); if (!atkTool) continue;
      const fn = TOOL_ATTACK_BONUS.get(atkTool.name); if (!fn) continue;
      const b = fn(aCard, aInst, dCard, dInst);
      if (b > 0) {
        d += b;
        s = addLog(s, `🔧 ${atkTool.name}：${aCard.name} 招式傷害 +${b}（${d - b} → ${d}）`, aIdx);
        formula.push({ sign: '+', value: b, label: atkTool.name });
      }
    }
  }
  // ── 被動特性 +N（攻擊方場上每張卡；PASSIVE_ATTACK_NO_STACK dedup；監視塔壓制【無】）─
  {
    const attAll = [aInst, ...attacker.bench];
    const noStack = new Set<string>();
    for (const inst of attAll) {
      const c = pool.get(inst.cardId); if (!c?.abilities) continue;
      if (_colorlessBlocked(c)) continue;
      for (const ab of c.abilities) {
        const fn = PASSIVE_ATTACK_BONUS.get(ab.name); if (!fn) continue;
        if (!isAbilityHolderEffective(s, inst, c, aIdx, ab.name, aInst.iid === inst.iid ? 'active' : 'bench', pool)) continue;
        if (PASSIVE_ATTACK_NO_STACK.has(ab.name) && noStack.has(ab.name)) continue;
        const b = fn(aCard, dCard, s, aIdx, pool);
        if (b > 0) {
          if (PASSIVE_ATTACK_NO_STACK.has(ab.name)) noStack.add(ab.name);
          d += b;
          s = addLog(s, `「${ab.name}」啟動：${aCard.name} 招式傷害 +${b}`, aIdx);
          formula.push({ sign: '+', value: b, label: ab.name });
        }
      }
    }
  }
  // ── 力量蛋白飲（本回合自己【鬥】寶可夢對對手戰鬥位 +30，累加）─────────────
  if (aCard.pokemonType === 'Fighting' && attacker.damageBoostFightingThisTurn) {
    const b = attacker.damageBoostFightingThisTurn; d += b;
    s = addLog(s, `「力量蛋白飲」啟動：${aCard.name} 招式傷害 +${b}`, aIdx);
    formula.push({ sign: '+', value: b, label: '力量蛋白飲' });
  }
  // ── 夠讚狗｜腎上腺力量（自身附【惡】能量 +100）─────────────────────────
  if (aCard.name === '夠讚狗' && countEnergyTypeHostAware(aInst, 'Darkness', pool) >= 1) {
    d += 100;
    s = addLog(s, `「腎上腺力量」啟動：夠讚狗 招式傷害 +100`, aIdx);
    formula.push({ sign: '+', value: 100, label: '腎上腺力量' });
  }
  // ── 化朗鎮（赫普的寶可夢 +30）───────────────────────────────────────────
  if (aCard.name.startsWith('赫普的')) {
    const stN = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
    if (stN === '化朗鎮') {
      d += 30;
      s = addLog(s, `「化朗鎮」啟動：${aCard.name} 招式傷害 +30`, aIdx);
      formula.push({ sign: '+', value: 30, label: '化朗鎮' });
    }
  }
  // ── 空手道王的演練（本回合對對手戰鬥位 ex +40）────────────────────────
  if (attacker.karateKingBonusThisTurn && dCard?.subtype === 'ex') {
    d += 40;
    s = addLog(s, `「空手道王的演練」啟動：對 ${dCard.name}（ex）+40`, aIdx);
    formula.push({ sign: '+', value: 40, label: '空手道王演練' });
  }
  // ── 烏栗（本回合對對手戰鬥位 ex/V +30）──────────────────────────────────
  if (attacker.unrudaBonusThisTurn && dCard) {
    const isExV = dCard.subtype === 'ex' || dCard.name.endsWith('ex') || dCard.name.endsWith('EX')
      || dCard.name.endsWith('V') || dCard.name.endsWith('VMAX') || dCard.name.endsWith('VSTAR');
    if (isExV) {
      d += 30;
      s = addLog(s, `「烏栗」啟動：對 ${dCard.name}（ex/V）+30`, aIdx);
      formula.push({ sign: '+', value: 30, label: '烏栗' });
    }
  }
  s = { ...s, _attackerActiveBonusDone: true } as GameState;
  return { damage: d, state: s, formula };
}

// v5.594 prevent-KO 收斂：受招式傷害昏厥前，查 TOOL_PREVENT_KO(倖存鍛鍊器)+PASSIVE_PREVENT_KO
//   (堅忍之軀/不朽身軀/勤奮之心/結實)。命中 → 該寶可夢留 leaveHP 不昏厥(道具型丟棄道具)，回傳新 state。
//   位置無關(active/bench 皆可，snipe 可 KO 備戰)；與引擎主管線(engine.ts wouldBeKO)inline 同邏輯，
//   分屬不同 KO 路徑(中央 helper / snipe-multi / clone-strike)不雙觸發。只在「招式傷害」昏厥語境呼叫。
function applyPreventKOToVictim(
  state: GameState,
  victim: CardInstance,
  victimCard: Card | undefined,
  defenderIdx: 0 | 1,
  baseDamage: number,
  pool: Map<string, Card>,
): { prevented: boolean; state: GameState } {
  if (baseDamage <= 0 || !victimCard) return { prevented: false, state };
  const defender = state.players[defenderIdx];
  const isActive = defender.active?.iid === victim.iid;
  const inPlay = isActive ? defender.active! : defender.bench.find(c => c.iid === victim.iid);
  if (!inPlay) return { prevented: false, state };
  const hp = effectiveHPInline(inPlay, pool, state);
  // 1) 道具防 KO（倖存鍛鍊器）— 阻礙之塔(工具封鎖)時失效
  if (!isToolsJammed(state, pool)) {
    for (const t of getAllAttachedTools(inPlay)) {
      const tc = pool.get(t.cardId); if (!tc) continue;
      const fn = TOOL_PREVENT_KO.get(tc.name); if (!fn) continue;
      const r = fn(inPlay, victimCard, baseDamage);
      if (!r.prevent) continue;
      const targetDamage = Math.max(0, hp - r.leaveHP);
      let newInst: CardInstance = { ...inPlay, damage: targetDamage };
      if (newInst.toolAttached?.iid === t.iid) newInst = { ...newInst, toolAttached: undefined };
      else if (newInst.extraTools) newInst = { ...newInst, extraTools: newInst.extraTools.filter(x => x.iid !== t.iid) };
      let s = updatePlayer(state, defenderIdx, p => isActive
        ? { ...p, active: newInst, discard: [...p.discard, t] }
        : { ...p, bench: p.bench.map(c => c.iid === victim.iid ? newInst : c), discard: [...p.discard, t] });
      s = addLog(s, `${tc.name}：${victimCard.name} 避免昏厥，剩餘 HP ${r.leaveHP}！`, null);
      return { prevented: true, state: s };
    }
  }
  // 2) 被動防 KO（堅忍之軀/不朽身軀/勤奮之心/結實）
  let workState = state;
  if (victimCard.abilities) {
    for (const ab of victimCard.abilities) {
      const fn = PASSIVE_PREVENT_KO.get(ab.name); if (!fn) continue;
      const r = fn(inPlay, victimCard, baseDamage);
      if (!r.prevent) continue;
      // v5.596 擲幣型(堅忍之軀/不朽身軀)走 flipCoinsWithLog；反面則不防(保留擲幣 log)，繼續查其他特性
      if (COIN_PREVENT_KO_ABILITIES.has(ab.name)) {
        const cf = flipCoinsWithLog(workState, 1, ab.name, defenderIdx);
        workState = cf.state;
        if (cf.heads === 0) continue;
      }
      const targetDamage = Math.max(0, hp - r.leaveHP);
      const newInst: CardInstance = { ...inPlay, damage: targetDamage };
      let s = updatePlayer(workState, defenderIdx, p => isActive
        ? { ...p, active: newInst }
        : { ...p, bench: p.bench.map(c => c.iid === victim.iid ? newInst : c) });
      s = addLog(s, `「${ab.name}」啟動：${victimCard.name} 避免昏厥，剩餘 HP ${r.leaveHP}！`, null);
      return { prevented: true, state: s };
    }
  }
  return { prevented: false, state: workState };
}

export function dealAttackDamageToTarget(
  st: GameState,
  actorIdx: 0 | 1,
  targetIid: string,
  dmg: number,
  pool: Map<string, Card>,
  opts?: { kind?: DamageKind; label?: string; noWeakness?: boolean },
): GameState {
  const kind = opts?.kind ?? 'attack-damage';
  const label = opts?.label ?? '攻擊';
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  if (!targetIid || dmg === 0) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  // v4.979: 統一 — active + bench 都過 canApplyEffectToTarget
  //   bench: 對戰圓形 / 花之帷幔 / 太晶 / 中立中心 等
  //   active: 飛翔 / 要害斬 / 阿塞蘿拉 / 中立中心 / 精神防護 / 閃光屏障 / 熔岩之壁 / 防護代碼 / 塗層攻擊
  //   注意：kind 透傳（snipe-variable 同時用於 attack-damage 跟 attack-effect — 飛來橫禍等放指示物）
  const guard = canApplyEffectToTarget(st, actorIdx, target, targetCard, kind, pool, { isBench: !isActive });
  if (guard.blocked) {
    const name = targetCard?.name ?? '?';
    return addLog(st, `${label}：${name} 因${guard.reason}不受傷害`, actorIdx);
  }
  // v5.370：active 路徑補 PASSIVE_IMMUNITY（神秘石居/神秘守護/璀璨鱗片/尾甲等 boolean）+ 擲幣型
  //   （順滑大衣）— canApplyEffectToTarget 的 active 分支不查 PASSIVE_IMMUNITY，狙擊又繞過主管線，
  //   故戰鬥位的條件免疫會漏（回歸測試矩陣抓到：神秘石居在戰鬥位被 ex 狙擊仍受傷）。
  //   只在【傷害】語境套（放指示物 attack-effect 不套）。bench 由 canApplyEffectToTarget→resolveBenchGuard 已含。
  if (isActive && kind === 'attack-damage') {
    const _pb = passiveImmunityDamageBlock(st, actorIdx, targetCard, pool);
    if (_pb.blocked) return addLog(st, `${label}：${targetCard?.name ?? '?'} ${_pb.reason}（免疫此招式傷害）`, actorIdx);
    const _coin = passiveCoinImmunity(st, actorIdx, targetCard, pool);
    st = _coin.state;
    if (_coin.immune) return addLog(st, `${label}：${targetCard?.name ?? '?'} 擲幣免疫（正面）不受傷害`, actorIdx);
  }
  // v5.369：戰鬥位（active）的招式【傷害】要套弱點×2 + 抵抗力 + 攻擊方道具加成（猛攻手鐲等）。
  //   備戰位不計弱抗（卡面標準「備戰不計弱抗」）；放傷害指示物(kind='attack-effect',如飛來橫禍)
  //   也不套（指示物為 flat）。鏡射多目標 snipe resolver 的 active 公式（v5.153）。
  //   玩家回報：閃焰王牌ex 石榴石截擊 打弱火的 蜜集大蛇ex 沒 ×2（180→應 360）。
  let effDmg = dmg;
  // v5.434：noWeakness — 卡面「這個招式的傷害不計算弱點・抵抗力」(整招 flat，如 重磅驟雨/橄欖石音波)。
  //   只略過弱點/抵抗/攻擊方道具加成；免疫(太晶/神秘石居/對戰圓形)與 KO 仍照走。
  // v5.517：收斂中央管線 — 戰鬥位招式傷害先套「攻擊方加成」(力量蛋白飲/烏栗/空手道王/
  //   化朗鎮/夠讚狗/伏特雷能量/PASSIVE_ATTACK_BONUS/攻擊道具)，與引擎主管線共用單一函式，
  //   weakness 前套。noWeakness 招式仍套這些加成(只略過弱抗，不略過 +N，鏡射引擎)。
  if (isActive && kind === 'attack-damage') {
    const _ab = applyAttackerActiveDamageBonuses(st, actorIdx, effDmg, pool);
    effDmg = _ab.damage;
    st = _ab.state;
  }
  if (isActive && kind === 'attack-damage' && !opts?.noWeakness) {
    // v5.673：弱點+抵抗力統一走中央 applyWeakRes(原抵抗力仍用 raw pokemonType→漏小碎鑽雙屬性,收斂)。
    effDmg = applyWeakRes(st, actorIdx, target, targetCard, effDmg, pool);
  }
  // v5.544：戰鬥位招式【傷害】套防守方減傷（中央 applyDefenderReductionsBlockA，與引擎主管線共用單一段）。
  //   修「狙擊/延後型招式(走中央函式)漏套鐵之防禦/全金屬實驗室/防護充能/果實道具等防守方減傷」。
  //   位置：弱抗後、on-damaged 反擊前（反擊量依減傷後傷害；減到 0 不觸發反擊）。
  if (isActive && kind === 'attack-damage' && effDmg > 0) {
    const _defP = st.players[dIdx];
    const _atkP = st.players[actorIdx];
    const _atkCardR = _atkP.active ? pool.get(_atkP.active.cardId) : undefined;
    if (_atkCardR && targetCard) {
      const _fm: FormulaTerm[] = [];
      const _rr = applyDefenderReductionsBlockA(
        st, st, _defP, _atkP, targetCard, _atkCardR, effDmg, false,
        isToolsJammed(st, pool), dIdx, actorIdx, _fm, pool);
      st = _rr.workingState;
      effDmg = _rr.baseDamage;
      // 減傷果實道具丟棄（福祿果/巧可果等 discardOnTrigger）
      if (_rr.defenseReduceToolToDiscard) {
        const _tool = _rr.defenseReduceToolToDiscard;
        st = updatePlayer(st, dIdx, p => {
          if (!p.active) return p;
          let act = p.active;
          if (act.toolAttached?.iid === _tool.iid) act = { ...act, toolAttached: undefined };
          else if (act.extraTools) act = { ...act, extraTools: act.extraTools.filter(x => x.iid !== _tool.iid) };
          return { ...p, active: act, discard: [...p.discard, _tool] };
        });
      }
      // damageReduceNextHit（下次被擊減傷）消耗 — 鏡射引擎 step 4（祭典樂舞首擊不消耗）
      const _dAct = st.players[dIdx].active;
      if (effDmg > 0 && _dAct?.damageReduceNextHit) {
        effDmg = Math.max(0, effDmg - _dAct.damageReduceNextHit);
        if (!_isFestivalDanceFirstAttackLocal(st, actorIdx, pool)) {
          st = updatePlayer(st, dIdx, p => ({ ...p, active: p.active ? { ...p.active, damageReduceNextHit: undefined } : p.active }));
        }
      }
    }
  }
  // v5.583：bench 受招式【傷害】→ 套防守方特性/場地減傷（捲牆/守護之鐘/齒輪塗層/凍原堡壘/
  //   自身 PASSIVE_DAMAGE_REDUCE 等）。active 已於上方 applyDefenderReductionsBlockA 處理，故只補 bench。
  //   收斂：與 hitBenchAll/hitBenchPickPost/snipe-multi 同一條 _applyBenchAbilityReduce。
  if (!isActive && kind === 'attack-damage' && effDmg > 0 && targetCard) {
    const _rb = _applyBenchAbilityReduce(st, target, targetCard, dIdx, actorIdx, pool, effDmg);
    if (_rb.amount !== effDmg && _rb.logs.length > 0) st = addLog(st, `${targetCard.name}：${_rb.logs.join('、')}`, null);
    effDmg = _rb.amount;
  }
  // v5.599 受招式傷害擲幣免傷（躲藏高手/腎上腺費洛蒙）：active+bench 皆套（中央 helper 過去漏,只引擎主管線有）。
  if (kind === 'attack-damage' && effDmg > 0) {
    const _ca = applyDefenderCoinAvoid(st, target, targetCard, dIdx, effDmg, pool);
    st = _ca.state;
    if (_ca.avoided) effDmg = 0;
  }
  // v5.435：active 受招式傷害 → 觸發防守方 on-damaged 反擊（扣殺能量/奢華炸彈/凸凸頭盔/
  //   龐克頭盔/還擊斧/反擊特性/警備濁霧）。共用 fireDefenderOnDamaged，與 snipe-multi 同一條。
  if (isActive && kind === 'attack-damage' && effDmg > 0) {
    st = fireDefenderOnDamaged(st, dIdx, actorIdx, effDmg, pool);
    if (st.phase === 'game-over') return st;
  }
  // re-fetch（helper 可能消費還擊旗標 / 改 attacker 狀態）
  const defenderNow = st.players[dIdx];
  const targetNow = isActive ? defenderNow.active : defenderNow.bench.find(c => c.iid === targetIid);
  if (!targetNow) return st;
  const newDmg = targetNow.damage + effDmg;
  const hp = effectiveHPInline(targetNow, pool, st);
  if (hp > 0 && newDmg >= hp) {
    // v5.594 受招式傷害昏厥前查 prevent-KO（堅忍之軀/倖存鍛鍊器等）；命中則留 HP 不昏厥
    if (kind === 'attack-damage') {
      const _pk = applyPreventKOToVictim(st, targetNow, targetCard, dIdx, effDmg, pool);
      if (_pk.prevented) return _pk.state;
    }
    const ko: CardInstance[] = [
      { ...targetNow, damage: newDmg },
      ...targetNow.energyAttached,
      ...getAllAttachedTools(targetNow),
      ...(targetNow.evolvedFromStack ?? []),
    ];
    const _ko = koPrizesAdjusted(st, targetNow, targetCard, actorIdx, dIdx, pool, kind === 'attack-damage');
    st = _ko.state;
    const p = _ko.prizes;
    const players = [...st.players] as [PlayerState, PlayerState];
    const newDefender = { ...defenderNow, discard: [...defenderNow.discard, ...ko] };
    if (isActive) newDefender.active = null;
    else newDefender.bench = defenderNow.bench.filter(c => c.iid !== targetIid);
    players[dIdx] = newDefender;
    let s = addLog({ ...st, players }, `${label}：${targetCard?.name ?? '?'} 被擊倒！+${p} 張獎賞卡。`, null);
    s = recordOppKO(s, dIdx, targetCard, 'attack');
    // v5.495：被 KO 觸發附加道具 TOOL_ON_KO（沉重接力棒移能量 / 希望護身符抽牌）——
    //   中央 helper 原漏呼叫，導致狙擊/分配招式 KO 帶接力棒的寶可夢時能量直接消失。
    s = fireDefenderOnKO(s, dIdx, actorIdx, pool, { ...targetNow, damage: newDmg }, isActive, kind === 'attack-damage');
    if (s.phase === 'game-over') return s;
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defenderNow.name} 沒有可上場的寶可夢` };
    }
    return addPendingPrize(s, actorIdx, p, pool);
  }
  const players = [...st.players] as [PlayerState, PlayerState];
  const newDefender = { ...defenderNow };
  if (isActive) newDefender.active = { ...targetNow, damage: newDmg };
  else newDefender.bench = defenderNow.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
  players[dIdx] = newDefender;
  return addLog({ ...st, players }, `${label}：對 ${targetCard?.name ?? '?'} 造成 ${effDmg} 傷害`, actorIdx);
}

/**
 * v5.446：單一共用「狙擊對手 1 隻備戰」helper（原 v2640/v2650/v2750/v3700 各有一份近乎
 *   相同的 snipeOneOppBenchPost，差別只在 exOnly filter 與 log 文字 → 收斂成此超集）。
 *   開 opp-bench-choose picker → wave3a-snipe-bench resolver（備戰傷害，不計弱抗）。
 * @param exOnly 只能選對手的 ex 寶可夢（閃電急襲等）。
 */
export function snipeOneOppBenchPost(amount: number, label: string, exOnly: boolean = false): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    if (state.players[dIdx].bench.length === 0) {
      return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    }
    const s = addLog(state, `${label}：選 1 隻對手備戰寶可夢，受到 ${amount} 點傷害${exOnly ? '（限 ex）' : ''}`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      filter: exOnly ? 'ex' : undefined,
      minCount: 1, maxCount: 1,
      effectKey: 'wave3a-snipe-bench',
      params: { amount, label },
    });
  };
}

regR('snipe-variable', (st, actorIdx, selectedIids, params, pool) => {
  // v5.385：改為呼叫中央 dealAttackDamageToTarget（行為不變）。
  const dmg = (params?.damage as number) ?? 0;
  const label = (params?.label as string) ?? '遠程攻擊';
  const kind = ((params?.kind as DamageKind) ?? 'attack-damage');
  return dealAttackDamageToTarget(st, actorIdx, selectedIids[0], dmg, pool, { kind, label });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38u v1.71 H 標第 16 波 — bench-count × multiplier + 能量/手牌 multiplier（~11 張）
//
// Helpers:
//   selfBenchMultiplyPre(base, per, label) — 自己備戰數 × per
//   oppBenchMultiplyPre(base, per, label) — 對手備戰數 × per
//   bothBenchMultiplyPre(base, per, label) — 雙方備戰數總和 × per
// 特殊：
//   熔岩蝸牛ex|大地灼燒 — 雙方牌庫頂各 1 張丟棄，其中能量張數 × 140
//   薩戮德|叢林鞭打 — 自身能量全部收回手牌 → +80（AI 永遠吃加成）
//   吞食獸|張大嘴 — 若自身能量 > 對手戰鬥能量 → +160
//   三海地鼠ex|三色炮 — 自動從手牌丟最多 3 張能量卡，對 opp active 造成 × 60
//   賽富豪ex|淘金潮 — 自動從手牌丟棄全部基本能量，× 50
//   雪童子|驚嚇 — 20 + 對手手牌隨機 1 張回對手牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════

function selfBenchMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const count = state.players[aIdx].bench.length;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：自己備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
  };
}

function oppBenchMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const count = state.players[dIdx].bench.length;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：對手備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
  };
}

export function bothBenchMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const count = state.players[aIdx].bench.length + state.players[dIdx].bench.length;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：雙方備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
  };
}

// 裹蜜蟲|朋友之環 — 自己備戰數 × 20
regPre('裹蜜蟲|朋友之環', selfBenchMultiplyPre(0, 20, '朋友之環'));

// 厄鬼椪 碧草面具|鬼返 — 20 + 對手備戰數 × 20
regPre('厄鬼椪 碧草面具|鬼返', oppBenchMultiplyPre(20, 20, '鬼返'));

// 捷拉奧拉|鬥戰雷電 — 20 + 對手備戰數 × 20
regPre('捷拉奧拉|鬥戰雷電', oppBenchMultiplyPre(20, 20, '鬥戰雷電'));

// 骨紋巨聲鱷|閃焰獨唱會 — 60 + 雙方備戰數 × 20
regPre('骨紋巨聲鱷|閃焰獨唱會', bothBenchMultiplyPre(60, 20, '閃焰獨唱會'));

// 太樂巴戈斯ex|聯盟擊 — 後攻第一回合不可使用；否則 自己備戰數 × 30
// v3.877：state.turn 只在後攻方 END_TURN 才 +1（engine.ts:5737），state.turn===1 涵蓋雙方第 1 動作回合。
//   後攻方第 1 動作回合 = aIdx !== firstPlayerIdx && state.turn === 1
//   原 `state.turn === 1 + state.firstPlayerIdx` 算出 turn=1 或 2 — firstPlayerIdx=1 時誤把 turn=2 當後攻 1st。
regPre('太樂巴戈斯ex|聯盟擊', (state, aIdx, _pool) => {
  const isSecondPlayerFirstTurn =
    aIdx !== state.firstPlayerIdx && state.turn === 1;
  if (isSecondPlayerFirstTurn) {
    return { state: addLog(state, '聯盟擊：後攻第一回合無法使用，招式失敗', aIdx), damage: 0 };
  }
  const count = state.players[aIdx].bench.length;
  const dmg = count * 30;
  return { state: addLog(state, `聯盟擊：自己備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
});

// 熔岩蝸牛ex|大地灼燒 — 雙方牌庫頂各 1 張丟棄，其中能量張數 × 140，基礎 140
regPre('熔岩蝸牛ex|大地灼燒', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const topA = state.players[aIdx].deck[0];
  const topB = state.players[dIdx].deck[0];
  let energyCount = 0;
  if (topA) {
    const c = pool.get(topA.cardId);
    if (c?.supertype === 'Energy') energyCount++;
  }
  if (topB) {
    const c = pool.get(topB.cardId);
    if (c?.supertype === 'Energy') energyCount++;
  }
  const dmg = 140 + energyCount * 140;
  return { state: addLog(state, `大地灼燒：雙方牌庫頂丟棄 ${energyCount} 張能量 → ${dmg}`, aIdx), damage: dmg };
});
regPost('熔岩蝸牛ex|大地灼燒', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  let s = state;
  const _bgDiscarded: CardInstance[] = [];
  for (const idx of [aIdx, dIdx] as (0 | 1)[]) {
    const p = players[idx];
    if (p.deck.length === 0) continue;
    const top = p.deck[0];
    _bgDiscarded.push(top);
    players[idx] = { ...p, deck: p.deck.slice(1), discard: [...p.discard, top] };
  }
  s = { ...s, players };
  return addLog(s, `大地灼燒：雙方牌庫頂 1 張丟入棄牌區：${joinCardNames(_bgDiscarded, pool)}`, aIdx);
});

// 薩戮德|叢林鞭打 — 卡面：「若希望，將這隻寶可夢身上附加的能量卡全部放回手牌，增加80點傷害。」
//   v3.26 修：原實裝「自身有能量 → 必收 + 必加 +80」(AI 永遠吃加成)，違反卡面「若希望」。
//   借殼 binary-yes-no：玩家可選擇是否收回所有能量。
ATTACK_PRE_DISCARD_CHOICE.set('薩戮德|叢林鞭打', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 80, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢身上附加的能量卡全部放回手牌，增加 80 點傷害？',
  choiceYesLabel: '是（+80 傷害 + 全能量回手）',
  choiceNoLabel: '否（保留能量）',
  verb: 'return-to-hand', // 卡面：「將能量卡全部放回手牌」
});
regPre('薩戮德|叢林鞭打', (state, aIdx, _pool, action) => {
  const att = state.players[aIdx].active;
  const hasEnergy = (att?.energyAttached.length ?? 0) > 0;
  if (!hasEnergy) {
    return { state: addLog(state, '叢林鞭打：自身無能量 → 80', aIdx), damage: 80 };
  }
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return { state: addLog(state, '叢林鞭打：選「否」 → 80 傷害（保留能量）', aIdx), damage: 80 };
  }
  return { state: addLog(state, '叢林鞭打：選「是」 → 收回自身能量 → 80+80 = 160', aIdx), damage: 160 };
});
regPost('薩戮德|叢林鞭打', (state, aIdx, _pool, action) => {
  const att = state.players[aIdx].active;
  if (!att || att.energyAttached.length === 0) return state;
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const energies = p.active.energyAttached;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      hand: [...p.hand, ...energies],
    };
  });
});

// 吞食獸|張大嘴 — 若自身能量 > 對手出場能量 則 +160，基礎 10
regPre('吞食獸|張大嘴', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  // v5.676：卡面「能量的數量」= 能量單位數(個)，非卡張數 → host-aware（火箭隊能量=2、燃火進化=3 等）
  const selfE = att ? countAttachedEnergyAsUnits(att, pool) : 0;
  const defE = def ? countAttachedEnergyAsUnits(def, pool) : 0;
  const bonus = selfE > defE ? 160 : 0;
  const dmg = 10 + bonus;
  return { state: addLog(state, `張大嘴：自能量 ${selfE} vs 對手 ${defE}${bonus ? ' +160' : ''} → ${dmg}`, aIdx), damage: dmg };
});

// 三海地鼠ex|三色炮 — 從手牌丟最多 3 張能量卡，對對手 1 隻寶可夢造成 ×60 傷害
//   卡面（資料庫驗證 SV5K 9795/10210）：「從自己的手牌將最多 3 張能量卡丟棄，
//   對對手的 1 隻寶可夢，造成其張數×60 點傷害。[在備戰區不計算弱點・抵抗力。]」
//
// v2.242 升級為 opp-poke-choose（不再簡化為「直接打 active」）：
//   1. PRE 不算傷害（damage=0），讓主流程不自動套用到 active
//   2. POST 自動從手牌取最多 3 張能量丟棄（候選同型基本/特殊能量計入；player 選擇空間有限）
//   3. 開 opp-poke-choose pending，玩家任選 1 隻對手寶可夢，clone-strike-multi-hit
//      自動處理戰鬥場弱抗 / 備戰不計弱抗 / KO 流程
regPre('三海地鼠ex|三色炮', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('三海地鼠ex|三色炮', (state, aIdx, pool) => {
  // 先從手牌丟最多 3 張能量
  const handEnergies = state.players[aIdx].hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  const toDiscard = handEnergies.slice(0, 3);
  const discardedCount = toDiscard.length;
  if (discardedCount === 0) {
    return addLog(state, '三色炮：手牌沒有能量卡', aIdx);
  }
  const discardIids = new Set(toDiscard.map(c => c.iid));
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    hand: p.hand.filter(c => !discardIids.has(c.iid)),
    discard: [...p.discard, ...toDiscard],
  }));
  s = addLog(s, `三色炮：丟棄手牌 ${discardedCount} 張能量`, aIdx);
  // 開 opp-poke-choose
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = s.players[dIdx];
  if (!def.active && def.bench.length === 0) return s;
  const dmg = discardedCount * 60;
  s = addLog(s, `三色炮：選對手 1 隻寶可夢造成 ${dmg} 傷害（戰鬥場套弱抗、備戰不計）`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'clone-strike-multi-hit',
    params: { dmg, label: '三色炮' },
  });
});

// 賽富豪ex|淘金潮 — 自動從手牌丟棄全部基本能量，× 50
regPre('賽富豪ex|淘金潮', (state, aIdx, pool) => {
  const basics = state.players[aIdx].hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  const count = basics.length;
  const dmg = count * 50;
  return { state: addLog(state, `淘金潮：丟棄 ${count} 張基本能量${count ? `：${joinCardNames(basics, pool)}` : ''} → ${dmg}`, aIdx), damage: dmg };
});
regPost('賽富豪ex|淘金潮', (state, aIdx, pool) => {
  return updatePlayer(state, aIdx, p => {
    const discarded: CardInstance[] = [];
    const kept: CardInstance[] = [];
    for (const c of p.hand) {
      const card = pool.get(c.cardId);
      if (card?.supertype === 'Energy' && card.subtype === 'Basic') discarded.push(c);
      else kept.push(c);
    }
    return { ...p, hand: kept, discard: [...p.discard, ...discarded] };
  });
});

// 雪童子|驚嚇 — 傷害 20（pre 不需），post：對手手牌隨機 1 張回牌庫並重洗
regPost('雪童子|驚嚇', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = addLog(state, '驚嚇：對手手牌隨機 1 張返回牌庫並重洗', aIdx);
  return updatePlayer(s, dIdx, p => {
    if (p.hand.length === 0) return p;
    const idx = Math.floor(Math.random() * p.hand.length);
    const picked = p.hand[idx];
    const newHand = p.hand.filter((_, i) => i !== idx);
    return { ...p, hand: newHand, deck: shuffle([...p.deck, picked]) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38v v1.72 H 標第 17 波 — self-discard-N-energy post-attack（26 張）
//
// Helpers:
//   selfDiscardNEnergyPost(n, label) — 攻擊後自身丟 N 張能量（從後往前取）
//   selfDiscardAllEnergyPost(label)  — 攻擊後自身丟全部能量
//
// 全都對應「選擇 N 個這隻寶可夢身上附加的能量，將其丟棄」／「全部丟棄」的招式後效。
// AI sim 與 UI 預設都自動從後往前丟（最近附加的優先丟），夠用又不影響重要先附能量。
// ══════════════════════════════════════════════════════════════════════════════

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    const discardCount = Math.min(n, att.energyAttached.length);
    let s = addLog(state, `${label}：${attName} 丟棄 ${discardCount} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - discardCount);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - discardCount);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    let s = addLog(state, `${label}：${attName} 丟棄全部能量（${att.energyAttached.length} 個）`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

// v5.398：以上「選擇 N 個能量丟棄」(純 cost) 已移至檔末 SELF_DISCARD_UNITS_BATCH 表 → units + picker。

// ── 全部自身能量 ─────────────────────────────────────────────────────────────
regPost('閃電鳥|十萬伏特', selfDiscardAllEnergyPost('十萬伏特'));
regPost('燈火幽靈|燃燒盡', selfDiscardAllEnergyPost('燃燒盡'));
regPost('倫琴貓ex|伏特強襲', selfDiscardAllEnergyPost('伏特強襲'));
regPost('齒輪怪|高級光束', selfDiscardAllEnergyPost('高級光束'));
regPost('蒼炎刃鬼ex|紫水晶激怒', selfDiscardAllEnergyPost('紫水晶激怒'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38w v1.73 H 標第 18 波 — 綜合（coin+discard+status 等，~10 張）
//
// Helpers:
//   coinHeadsOppDiscardEnergyPost(label) — 正面時對手戰鬥寶可夢隨機丟 1 個能量
//   coinTripleHeadsPre(base, b1, b2, b3, label) — 3 硬幣，正面次數 1/2/3 各加 b1/b2/b3
// ══════════════════════════════════════════════════════════════════════════════

function coinHeadsOppDiscardEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (!r.heads) return addLog(r.state, `${label}：反面 → 無追加效果`, aIdx);
    state = r.state;
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def || def.energyAttached.length === 0) {
      return addLog(state, `${label}：正面 → 但對手出場無附加能量`, aIdx);
    }
    // v5.333：免疫招式效果的 active 不受能量丟棄（C-17 per-target guard）
    {
      const _gc = canApplyEffectToTarget(state, aIdx, def, pool.get(def.cardId), 'attack-effect', pool);
      if (_gc.blocked) return addLog(state, `${label}：${_gc.reason}`, aIdx);
    }
    const defName = pool.get(def.cardId)?.name ?? '?';
    // 從後往前丟 1 張（最近附加優先）
    const last = def.energyAttached[def.energyAttached.length - 1];
    const lastEnergyName = pool.get(last.cardId)?.name ?? '能量';
    let s = addLog(state, `${label}：正面！丟棄對手 ${defName} 身上的 ${lastEnergyName}`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) },
        discard: [...p.discard, last],
      };
    });
  };
}

function coinTripleHeadsPre(base: number, b1: number, b2: number, b3: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 3, label, aIdx);
    const bonus = r.heads === 3 ? b3 : r.heads === 2 ? b2 : r.heads === 1 ? b1 : 0;
    const dmg = base + bonus;
    return {
      state: addLog(r.state, `${label}：${r.heads}/3 次正面 → 基礎 ${base} + ${bonus} = ${dmg} 傷害`, aIdx),
      damage: dmg,
    };
  };
}

// ── Coin-heads-opp-discard-energy (6 張) ─────────────────────────────────────
regPost('鬼斯|神秘光束', coinHeadsOppDiscardEnergyPost('神秘光束'));
regPost('角金魚|潮旋', coinHeadsOppDiscardEnergyPost('潮旋'));
regPost('伊裴爾塔爾|破壞光束', coinHeadsOppDiscardEnergyPost('破壞光束'));
regPost('鑽角犀獸|破壞之角', coinHeadsOppDiscardEnergyPost('破壞之角'));
regPost('火爆猴|掃腿', coinHeadsOppDiscardEnergyPost('掃腿'));
regPost('火伊布|破壞火', coinHeadsOppDiscardEnergyPost('破壞火'));

// ── 貓鼬斬|連斬 (10+, 3 硬幣正面 1/2/3 次各 +20/+50/+80) ─────────────────────
regPre('貓鼬斬|連斬', coinTripleHeadsPre(10, 20, 50, 80, '連斬'));

// ── 瑪狃拉|冰雹爪 (70, 丟棄自身全部能量，麻痺對手) ───────────────────────────
regPost('瑪狃拉|冰雹爪', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('冰雹爪')(state, aIdx, pool);
  return statusPost('paralyzed')(s, aIdx, pool);
});

// ── 自爆磁怪|強勁磁場 (80, 混亂 + 下回合無法撤退) ───────────────────────────
regPost('自爆磁怪|強勁磁場', (state, aIdx, pool) => {
  let s = statusPost('confused')(state, aIdx, pool);
  return defCantRetreatNextPost()(s, aIdx, pool);
});

// ── 紅蓮鎧騎|紅蓮引爆：丟棄自身全部火能量 → 對手備戰 1 隻 180 傷害 ───────────
// 有火能量才能觸發；若對手備戰 0 則不進 pendingSelection
regPre('紅蓮鎧騎|紅蓮引爆', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 0 };
  const fireCount = att.energyAttached.filter(e => energyProvidesType(att, e, 'Fire', pool)).length; // v5.683 host-aware(古舊/稜鏡等視為火)
  if (fireCount === 0) {
    return { state: addLog(state, '紅蓮引爆：身上無火能量，招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, `紅蓮引爆：丟棄 ${fireCount} 張火能量`, aIdx), damage: 0 };
});
regPost('紅蓮鎧騎|紅蓮引爆', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  const fireEnergies = att.energyAttached.filter(e => energyProvidesType(att, e, 'Fire', pool)); // v5.683 host-aware
  if (fireEnergies.length === 0) return state;
  // 先丟棄火能量
  let s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const kept = p.active.energyAttached.filter(e => !energyProvidesType(p.active!, e, 'Fire', pool)); // v5.683 host-aware
    return {
      ...p,
      active: { ...p.active, energyAttached: kept },
      discard: [...p.discard, ...fireEnergies],
    };
  });
  // 然後 opp-bench-choose 選 1 隻打 180
  const dIdx = (1 - aIdx) as 0 | 1;
  if (s.players[dIdx].bench.length === 0) {
    return addLog(s, '紅蓮引爆：對手無備戰寶可夢，無法施傷', aIdx);
  }
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: dIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'snipe-variable',
    params: { damage: 180, label: '紅蓮引爆' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38x v1.74 H 標第 19 波 — swap + discard-multiply + KO 綜合（10 張）
//
// Helpers / Resolvers:
//   regR('opp-swap-dmg') — 對手備戰互換到戰鬥場，並對新上場寶可夢施傷（含 KO 串聯）
//   registerSelfDiscardMultiply(key, spec) — ATTACK_PRE_DISCARD_CHOICE + regPre 一鍵註冊
//     scope='attacker'；支援 typeFilter（'all'/'basic'/EnergyType）
// ══════════════════════════════════════════════════════════════════════════════

regR('opp-swap-dmg', (st, actorIdx, iids, params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const oldActive = defender.active;
  if (!oldActive || defender.bench.length === 0) return st;
  const benchIdx = defender.bench.findIndex(c => c.iid === iids[0]);
  if (benchIdx < 0) return st;
  const dmg = (params?.damage as number) ?? 0;
  const label = (params?.label as string) ?? '';
  const newActiveOrig = defender.bench[benchIdx];
  const newActiveCard = pool.get(newActiveOrig.cardId);
  const oldActiveName = pool.get(oldActive.cardId)?.name ?? '?';
  const newActiveName = newActiveCard?.name ?? '?';

  // swap first — v2.08：離開戰鬥場清狀態旗標
  const newBench = [...defender.bench];
  newBench[benchIdx] = clearActiveEffects(oldActive);
  // v3.812：preserve justPlaced + playedFromHand（位置交換不該清除剛打出 flag）
  let newDefender = { ...defender, active: { ...newActiveOrig }, bench: newBench };
  let s: GameState = { ...st };
  let players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = newDefender;
  s = addLog({ ...s, players }, `${label}：${oldActiveName} 回備戰，${newActiveName} 上場`, null);

  if (dmg <= 0) return s;

  // apply damage to new active
  if (!newDefender.active) return s;
  const newDmg = newDefender.active.damage + dmg;
  const hp = effectiveHPInline(newDefender.active, pool, s);  // v5.091
  if (hp > 0 && newDmg >= hp) {
    const koList: CardInstance[] = [
      { ...newDefender.active, damage: newDmg },
      ...newDefender.active.energyAttached,
      ...getAllAttachedTools(newDefender.active),
      ...(newDefender.active.evolvedFromStack ?? []),
    ];
    const _ko = koPrizesAdjusted(s, newDefender.active, newActiveCard, (1 - dIdx) as 0 | 1, dIdx, pool);
    s = _ko.state;
    const prizes = _ko.prizes;
    newDefender = { ...newDefender, active: null as any, discard: [...newDefender.discard, ...koList] };
    players = [...s.players] as [PlayerState, PlayerState];
    players[dIdx] = newDefender;
    s = addLog({ ...s, players }, `${label}：${newActiveName} 被擊倒！+${prizes} 張獎賞卡`, null);
    s = recordOppKO(s, dIdx, newActiveCard, 'attack');
    s = fireDefenderOnKO(s, dIdx, (1 - dIdx) as 0 | 1, pool, koList[0], true, true);
    if (newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return addPendingPrize(s, actorIdx, prizes, pool);
  }
  newDefender = { ...newDefender, active: { ...newDefender.active, damage: newDmg } };
  players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = newDefender;
  return addLog({ ...s, players }, `${label}：對 ${newActiveName} 造成 ${dmg} 傷害`, actorIdx);
});

// ── swap-opp + dmg (3 張) ────────────────────────────────────────────────────
// 共用 pre：不造成戰鬥寶可夢傷害（傷害在 resolver 中施加）
function oppSwapDmgPost(dmg: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active || defender.bench.length === 0) {
      return addLog(state, `${label}：對手無備戰寶可夢，無法互換`, aIdx);
    }
    // v5.333：免疫招式效果的 active 不被互換換下（C-17 per-target guard）
    {
      const _gs = canApplyEffectToTarget(state, aIdx, defender.active, pool.get(defender.active.cardId), 'attack-effect', pool);
      if (_gs.blocked) return addLog(state, `${label}：${_gs.reason}`, aIdx);
    }
    let s = addLog(state, `${label}：選擇對手備戰 1 隻與戰鬥場互換`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx,
      sourcePlayerIdx: dIdx,
      minCount: 1,
      maxCount: 1,
      effectKey: 'opp-swap-dmg',
      params: { damage: dmg, label },
    });
  };
}

regPre('大嘴娃|誘導敲詐', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('大嘴娃|誘導敲詐', oppSwapDmgPost(30, '誘導敲詐'));

regPre('裹蜜蟲|蜜糖捕捉器', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('裹蜜蟲|蜜糖捕捉器', oppSwapDmgPost(70, '蜜糖捕捉器'));

regPre('勇士雄鷹|拖出', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('勇士雄鷹|拖出', oppSwapDmgPost(40, '拖出'));

// ── self-discard-multiply (3 張) ─────────────────────────────────────────────
type DiscardMultiplyFilter = 'all' | 'basic' | EnergyType;

// v4.71: EnergyType → 中文 tag map，給基本能量 name fallback 判斷用
//   原因：基本能量 JSON 沒有 pokemonType 欄位（只有 supertype/subtype/name），
//   單看 c.pokemonType === typeFilter 永遠 false。
//   solution: 基本能量靠 name 含「【鋼】」「【火】」等 tag 判定。
const TYPE_TO_TAG: Record<string, string> = {
  Fire: '【火】', Water: '【水】', Grass: '【草】', Lightning: '【雷】',
  Psychic: '【超】', Fighting: '【鬥】', Darkness: '【惡】', Metal: '【鋼】',
  Fairy: '【妖】', Dragon: '【龍】', Colorless: '【無】',
};

function registerSelfDiscardMultiply(
  key: string,
  label: string,
  baseDamage: number,
  per: number,
  max: number,
  typeFilter: DiscardMultiplyFilter = 'all',
  // v4.72: forceAll=true 時跳過 picker，regPre 直接丟全部 eligible 能量。
  //   用於卡面寫「全部丟棄」的招式（席多藍恩 鋼鐵爆炸 / 電蜘蛛 放電）。
  //   forceAll=false（預設）保持 picker 行為，用於「最多 N 張」型。
  forceAll: boolean = false,
  // v5.080: min 強制最少丟 N 張（=max 即「強制丟剛好 N 張」型，卡面寫「選擇 N 個」）。
  //   per=0「強制 N 個 cost」型招式（火山流星/水射擊/冰之牢籠/防守回轉等）必須傳 min=max。
  min: number = 0,
) {
  if (!forceAll) {
    ATTACK_PRE_DISCARD_CHOICE.set(key, {
      min,
      max,
      scope: 'attacker',
      baseDamage,
      damagePerEnergy: per,
      // v5.391：per=0（純 cost 型「選擇剛好 N 個能量丟棄」）→ 按「能量單位數」計（units），
      //   讓 1 張燃火能量（進化 host=3 個）/ 火箭隊能量（2 個）/ 新衝天能量（Stage2=2 個）可滿足「N 個」。
      //   per>0（丟越多傷越高，傷害=per×張數）維持按「張」計，避免 units 與傷害倍率語意衝突。
      //   受惠：火山流星(2) / 防守回轉(2) / 冰之牢籠(2) / 水射擊(1)。
      countMode: (per === 0 && min > 0) ? ('units' as const) : undefined,
      // v4.71: picker 也限定屬性（玩家不會選到非該屬性能量造成 UX 混淆）
      // Cast 避開 ATTACK_PRE_DISCARD_CHOICE config 不接受 'Fairy' 的型別限制
      energyTypeFilter: (typeFilter === 'all' || typeFilter === 'basic' || typeFilter === 'Fairy')
        ? undefined
        : (typeFilter as Exclude<EnergyType, 'Fairy'>),
    });
  }
  regPre(key, (state, aIdx, pool, action) => {
    const player = state.players[aIdx];
    if (!player.active) return { state, damage: baseDamage };
    const all = player.active.energyAttached;
    const eligible = all.filter(e => {
      if (typeFilter === 'all') return true;
      const c = pool.get(e.cardId);
      if (!c) return false;
      if (typeFilter === 'basic') return c.subtype === 'Basic';
      // v4.71: pokemonType match OR name 含對應 type tag（基本能量 fallback）
      if (c.pokemonType === typeFilter) return true;
      const tag = TYPE_TO_TAG[typeFilter];
      return tag ? c.name.includes(tag) : false;
    });
    const chosenIids = action?.discardedEnergyIids;
    let discarded: CardInstance[];
    let remaining: CardInstance[];
    if (forceAll) {
      // v4.72: 強制全丟（不看玩家 picker 選擇），直接 discard 所有 eligible
      const setIds = new Set(eligible.map(e => e.iid));
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    } else if (chosenIids && chosenIids.length > 0) {
      const allowed = new Set(eligible.map(e => e.iid));
      const capped = chosenIids.filter(id => allowed.has(id)).slice(0, max);
      const setIds = new Set(capped);
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    } else {
      const n = Math.min(max, eligible.length);
      const toDiscard = eligible.slice(-n);
      const setIds = new Set(toDiscard.map(e => e.iid));
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    }
    let s = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: remaining } : null,
      discard: [...p.discard, ...discarded],
    }));
    const dmg = baseDamage + per * discarded.length;
    s = addLog(s, `${label}：丟棄 ${discarded.length} 個能量 → ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  });
}

registerSelfDiscardMultiply('巨鉗螳螂ex|十字破壞', '十字破壞', 0, 120, 2, 'Metal');
registerSelfDiscardMultiply('固拉多|熔岩光芒', '熔岩光芒', 0, 60, 4, 'all');

// 席多藍恩|鋼鐵爆炸 — 丟棄所有自身 Metal 能量 × 50（卡面「全部丟棄」= 強制）
// v4.72: forceAll=true，不開 picker，regPre 直接全丟
registerSelfDiscardMultiply('席多藍恩|鋼鐵爆炸', '鋼鐵爆炸', 0, 50, 99, 'Metal', true);

// ── KO 類（2 張） ──────────────────────────────────────────────────────────

// 棄世猴|同命戰鬥 — 雙方戰鬥寶可夢 KO
regPre('棄世猴|同命戰鬥', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('棄世猴|同命戰鬥', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  let players = [...s.players] as [PlayerState, PlayerState];
  let selfPrizes = 0;
  // 先 KO 對手出場
  const def = players[dIdx];
  if (def.active) {
    const card = pool.get(def.active.cardId);
    // v2.92 招式效果免疫檢查（KO 屬招式效果，被擋則跳過 KO 對手；自己仍照常 KO）
    const guardKO = canApplyAttackEffectToTarget(s, aIdx, def.active, card, pool);
    if (guardKO.blocked) {
      s = addLog(s, `同命戰鬥：${card?.name ?? '?'}｜${guardKO.reason}（不昏厥對手）`, aIdx);
    } else {
      const ko: CardInstance[] = [
        { ...def.active, damage: (card?.hp ?? 0) },
        ...def.active.energyAttached,
        ...getAllAttachedTools(def.active),
        ...(def.active.evolvedFromStack ?? []),
      ];
      players[dIdx] = { ...def, active: null, discard: [...def.discard, ...ko] };
      const _ko = koPrizesAdjusted(s, def.active, card, (1 - dIdx) as 0 | 1, dIdx, pool, false); // 同命戰鬥=效果KO,古舊能量等不減
      s = _ko.state;
      selfPrizes += _ko.prizes;
      s = addLog({ ...s, players }, `同命戰鬥：${card?.name ?? '?'} 被擊倒！+${selfPrizes} 張獎賞卡`, null);
      s = recordOppKO(s, dIdx, card, 'attack');
    }
  }
  // 再 KO 自己出場（不算獎賞卡給對手，直接丟棄 — 但 PTCG 規則對方獲得獎賞）
  players = [...s.players] as [PlayerState, PlayerState];
  const att = players[aIdx];
  if (att.active) {
    const card = pool.get(att.active.cardId);
    const ko: CardInstance[] = [
      { ...att.active, damage: (card?.hp ?? 0) },
      ...att.active.energyAttached,
      ...getAllAttachedTools(att.active),
      ...(att.active.evolvedFromStack ?? []),
    ];
    players[aIdx] = { ...att, active: null, discard: [...att.discard, ...ko] };
    // v5.469 還原：此處為自損 KO（同命戰鬥犧牲自己 active），非「受到對手招式傷害」→ 古舊能量等不觸發，保留 base。
    const oppPrizes = card ? (prizesForKOLocal(card)) : 1;
    s = addLog({ ...s, players }, `同命戰鬥：${card?.name ?? '?'} 也被擊倒，對手待取 ${oppPrizes} 張獎賞卡`, null);
    // v3.792 Rule 10：改用 addPendingPrize（移除直接 prize→hand），讓玩家點「取得」按鈕。
    s = addPendingPrize({ ...s, players }, dIdx, oppPrizes, pool);
    if (players[aIdx].bench.length === 0) {
      return { ...s, phase: 'game-over', winner: dIdx, winReason: `${att.name} 沒有可上場的寶可夢` };
    }
  }
  // v3.9998 修：原 v2.98 註解錯誤 + 用錯 idx。selfPrizes 變數名誤導 — 實際是
  //   「攻擊方擊倒對手取得的獎賞」（上方累加在 KO 對手出場時）→ 應給攻擊方 (aIdx)。
  //   line 6521 已處理「對手取攻擊方自 KO 的獎賞」(dIdx, oppPrizes)，這裡是另一邊。
  if (selfPrizes > 0) {
    s = addPendingPrize(s, aIdx, selfPrizes, pool);
  }
  return s;
});

// 雙斧戰龍|斧擊在地 — 若對手戰鬥寶可夢身上附有特殊能量卡，則將那隻寶可夢 KO
regPre('雙斧戰龍|斧擊在地', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('雙斧戰龍|斧擊在地', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;
  const hasSpecial = def.active.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  });
  if (!hasSpecial) return addLog(state, '斧擊在地：對手戰鬥寶可夢無特殊能量，無效', aIdx);
  // 直接 KO
  const card = pool.get(def.active.cardId);
  // v2.92 招式效果免疫檢查（KO 屬招式效果）
  const guardAxe = canApplyAttackEffectToTarget(state, aIdx, def.active, card, pool);
  if (guardAxe.blocked) {
    return addLog(state, `斧擊在地：${card?.name ?? '?'}｜${guardAxe.reason}（不昏厥）`, aIdx);
  }
  const ko: CardInstance[] = [
    { ...def.active, damage: (card?.hp ?? 0) },
    ...def.active.energyAttached,
    ...getAllAttachedTools(def.active),
    ...(def.active.evolvedFromStack ?? []),
  ];
  const _ko = koPrizesAdjusted(state, def.active, card, (1 - dIdx) as 0 | 1, dIdx, pool, false); // 斧擊在地=條件效果KO
  state = _ko.state;
  const prizes = _ko.prizes;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...def, active: null, discard: [...def.discard, ...ko] };
  let s = addLog({ ...state, players }, `斧擊在地：${card?.name ?? '?'} 被特殊能量反噬 KO！+${prizes} 張獎賞卡`, null);
  s = recordOppKO(s, dIdx, card, 'attack');
  if (players[dIdx].bench.length === 0) {
    return { ...s, phase: 'game-over', winner: aIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
  }
  return addPendingPrize(s, aIdx, prizes, pool);
});

// ── damage-counter bench ────────────────────────────────────────────────
// 10 點 = 1 個指示物。
// 振翼髮|飛來橫禍 (90 + 2 指示物以「任意方式」放置於對手備戰)
// 卡面："將2個傷害指示物以任意方式放置於對手的備戰寶可夢身上。"
// → 「放置指示物」= 招式【效果】；會被對戰圓形擋，不受花之帷幔擋。
//
// v2.221：升級為 damage-distribute（複用 dragapult-snipe resolver；只允許備戰）—
//   2 個 counter 可任意分配到對手 1~2 隻備戰（同隻 ×2 或不同隻各 ×1）
regPre('振翼髮|飛來橫禍', (state, _aIdx, _pool) => ({ state, damage: 90 }));
regPost('振翼髮|飛來橫禍', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return state;
  let s = addLog(state, '飛來橫禍：將 2 個傷害指示物自由分配到對手備戰寶可夢（必須全部放完）', aIdx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 2, maxCount: 2,  // v3.911：必須全部放完（「以任意方式放置 N 個」官方規則）
    effectKey: 'dragapult-snipe',
    params: {
      totalCounters: 2, placedCounters: 0, counterDamage: 10,
      label: '飛來橫禍', includeActive: false,
    },
  });
});

// 多龍巴魯托ex|幻影奇襲 (200 + 6 個傷害指示物自由分配到對手備戰寶可夢身上)
// 規則：6 個傷害指示物（每個 10 傷害），玩家可任意分配給任意數量的對手備戰寶可夢。
//
// v2.20 UX 改寫：改用新的 `damage-distribute` pending type。
//   - UI 顯示「已放置 X/60」進度條
//   - 可一次點多隻備戰各 1 counter（或同一隻多次）再統一確認，批次應用
//   - 按一次「確認」後若還有未用 counter 且對手仍有備戰，modal 再開；直到 60/60 或對手清空
//
// 舊版問題：每放 1 個 counter 就強制彈 1 次 modal，放 6 個要按 6 次確認。
regPre('多龍巴魯托ex|幻影奇襲', (state, _aIdx, _pool) => ({ state, damage: 200 }));
regPost('多龍巴魯托ex|幻影奇襲', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return state;
  // v5.187：拿掉 entry pre-filter — 玩家反饋希望「即使被免疫也能放指示物，只是不造成傷害」。
  //   原 v4.990 pre-filter（化隱 / 球形盾牌 / 對戰圓形 / 太晶 等）會讓 modal 不出現 → UX 不佳。
  //   resolver L7084 已有 per-target check（v4.917）：immune target counter 消耗 + 不放 + log「無效」。
  //   minCount=6 即使全免疫也不會卡死（counter 計入 placedThisBatch，v3.91 邏輯）。
  //   picker UI 因此顯示所有 bench；玩家可選任何一隻，免疫者照 counter 消耗、實際 damage=0。
  const defender = state.players[dIdx];
  const validIids: string[] = defender.bench.map(c => c.iid);
  const s = addLog(state, '幻影奇襲：將 6 個傷害指示物自由分配到對手備戰寶可夢（必須全部放完，KO/免疫後溢出指示物消耗）', aIdx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 6, maxCount: 6,  // v3.911：必須全部放完（玩家補充規則：對手備戰有寶可夢時必須放完 6 顆）
    effectKey: 'dragapult-snipe',
    params: {
      totalCounters: 6,
      placedCounters: 0,
      counterDamage: 10,
      label: '幻影奇襲',
      validIids,  // v4.990: picker UI 只顯示這些 bench iid
    },
  });
});

// 幻影奇襲 resolver — iids 陣列每出現 1 次 iid = 放 1 個 counter 到該寶可夢。
// 相同 iid 可出現多次（同一隻放多個 counter）。依序處理並在每次放置時檢查 KO。
// 若仍有剩餘 counter 且對手仍有備戰，再起一個 damage-distribute pending。
regR('dragapult-snipe', (st, actorIdx, selectedIids, params, pool) => {
  const totalCounters = (params?.totalCounters as number) ?? 6;
  const placedBefore = (params?.placedCounters as number) ?? 0;
  const counterDamage = (params?.counterDamage as number) ?? 10;
  const label = (params?.label as string) ?? '幻影奇襲';
  const dIdx = (1 - actorIdx) as 0 | 1;

  if (selectedIids.length === 0) return st;
  // v2.22 對戰圓形競技場：備戰完全不受對手招式傷害指示物 → 整批放置取消
  if (isBenchProtected(st, pool)) {
    return addLog(st, `${label}：對戰圓形競技場效果 — 對手備戰不受傷害指示物放置`, actorIdx);
  }

  let s: GameState = st;
  let placedThisBatch = 0;

  // 聚合每隻本批次的 counter 數量，方便產生一條精簡 log（不每個 counter 刷一行）
  const batchTally = new Map<string, number>();
  for (const iid of selectedIids) batchTally.set(iid, (batchTally.get(iid) ?? 0) + 1);

  // 依序施加，每放 1 個 counter 即檢查 KO（因為 KO 後不能再放到已離場的寶可夢）
  // v2.89：每個 target 都要單獨檢查招式效果免疫（薄霧/硬岩/皇帝之勢/抵抗之幕）
  const blockedTargets = new Set<string>();
  // v3.91：追蹤每隻 target 的溢出 counter 數（已 KO 後玩家本批次仍宣告要放的 counter）
  //   PTCG 規則：「以任意方式放置」允許溢傷（30HP 含羞包可放 6 個），
  //   KO 後剩餘 counter 不能挪到其他寶可夢 → 計入 placedThisBatch 視為消耗。
  const overflowByIid = new Map<string, number>();
  for (const iid of selectedIids) {
    const defender = s.players[dIdx];
    const target = defender.bench.find(c => c.iid === iid);
    if (!target) {
      // v3.91：target 已被本批次稍早的 counter 擊倒 → 後續對它的 counter 視為「溢出消耗」
      //   原本 continue 不計 placedThisBatch → 會 spawn next picker 強迫挪走，違反規則。
      //   現在 placedThisBatch++ 計入消耗，不 spawn next picker。
      placedThisBatch++;
      overflowByIid.set(iid, (overflowByIid.get(iid) ?? 0) + 1);
      continue;
    }

    const targetCard = pool.get(target.cardId);

    // v4.917：統一 canApplyEffectToTarget（kind='attack-effect'）— 涵蓋 化隱 + 光之翼 +
    //   ATTACK_EFFECT_IMMUNITY map（薄霧 / 硬岩 / 皇帝之勢 / 抵抗之幕 / 全能硬殼 / 陳舊背蓋化石）
    //   + bench 保護（對戰圓形 / 球形盾牌 / 藏隱 / 深度下潛 / 羽毛化石 / 太晶 / 中立中心）。
    //   合併原 v2.89 canApplyAttackEffectToTarget + v4.4999 resolveBenchGuard 兩段為一個入口；
    //   玩家回報 M5「化隱」（斯魔茶 / 來悲粗茶 / 怨影娃娃 / 詛咒娃娃）幻影奇襲 / 飛來橫禍 仍生效
    //   — root cause: dragapult-snipe 還在用舊散裝 helper，沒走 unified 入口（漏 1b 化隱分支）。
    //   target 永遠是 bench（dragapult-snipe 限制 sourcePlayerIdx 對手備戰）→ isBench: true。
    const _snipeGuard = canApplyEffectToTarget(s, actorIdx, target, targetCard, 'attack-effect', pool, { isBench: true });
    if (_snipeGuard.blocked) {
      if (!blockedTargets.has(iid)) {
        blockedTargets.add(iid);
        s = addLog(s, `${label}：${targetCard?.name ?? '?'} ${_snipeGuard.reason}（該指示物無效）`, actorIdx);
      }
      placedThisBatch++; // 仍計數本批次（消耗 counter，但不放置）
      continue;
    }

    const tHp = effectiveHPInline(target, pool, s);
    const newDmg = target.damage + counterDamage;
    placedThisBatch++;

    if (tHp > 0 && newDmg >= tHp) {
      // 被這個 counter 擊倒
      const koDiscard: CardInstance[] = [
        { ...target, damage: newDmg },
        ...target.energyAttached,
        ...getAllAttachedTools(target),
        ...(target.evolvedFromStack ?? []),
      ];
      // v5.404：套用防守方側獎賞調整（莉莉艾的珍珠/豪華斗篷/古舊能量/影藏）— 原只用 base koPrizeCount。
      const _ko = koPrizesAdjusted(s, target, targetCard, actorIdx, dIdx, pool, false);
      const prizes = _ko.prizes;
      s = _ko.state;
      const players = [...s.players] as [PlayerState, PlayerState];
      players[dIdx] = {
        ...s.players[dIdx],
        discard: [...s.players[dIdx].discard, ...koDiscard],
        bench: s.players[dIdx].bench.filter(c => c.iid !== iid),
      };
      s = addPendingPrize({ ...s, players }, actorIdx, prizes, pool);
      s = addLog(s,
        `${label}：${targetCard?.name ?? '?'} 累計到第 ${placedBefore + placedThisBatch}/${totalCounters} 個指示物 → 被擊倒！+${prizes} 張獎賞卡`, actorIdx);
      s = recordOppKO(s, dIdx, targetCard, 'attack');
    } else {
      const players = [...s.players] as [PlayerState, PlayerState];
      players[dIdx] = {
        ...defender,
        bench: defender.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c),
      };
      s = { ...s, players };
    }
  }

  // 批次結束後補 1 條總結 log（未 KO 的部分）
  const summaryParts: string[] = [];
  for (const [iid, cnt] of batchTally) {
    // 尋找最後存活的狀態（可能已被 KO → 跳過，避免跟 KO log 重複）
    const stillThere = s.players[dIdx].bench.find(c => c.iid === iid);
    if (stillThere) {
      const name = pool.get(stillThere.cardId)?.name ?? '?';
      summaryParts.push(`${name}×${cnt}`);
    }
  }
  const placedAfter = placedBefore + placedThisBatch;
  if (summaryParts.length > 0) {
    s = addLog(s,
      `${label}：本批次放置 ${summaryParts.join('、')} → 累計 ${placedAfter}/${totalCounters}`, actorIdx);
  }
  // v3.91：溢出 counter log（KO 後剩餘指示物消耗訊息）
  if (overflowByIid.size > 0) {
    const overflowParts: string[] = [];
    for (const [_iid, cnt] of overflowByIid) {
      overflowParts.push(`${cnt} 個`);
    }
    s = addLog(s,
      `${label}：溢出 ${overflowParts.join('、')} 指示物（KO 後消耗，不挪到其他寶可夢）`, actorIdx);
  }

  // 還有 counter 要放 + 對手仍有備戰 → 再開 pending
  // v3.911：minCount = nextRemaining（必須全部放完，同 v3.911 規則修正）。
  //   實務上 v3.91 KO 溢出計入 placedThisBatch 後，這個分支幾乎不會觸發 —
  //   玩家在第一個 picker 就必須放滿 maxCount，且溢出已被消耗，nextRemaining 通常為 0。
  //   但保險起見仍把 minCount 改成跟 maxCount 相同，避免任何邊界 case 玩家少放。
  const nextRemaining = totalCounters - placedAfter;
  if (nextRemaining > 0 && s.players[dIdx].bench.length > 0) {
    // v5.187：拿掉 re-filter — 同 entry 邏輯，玩家可放在任何 bench，免疫者照 counter 消耗。
    const reValidIids: string[] = s.players[dIdx].bench.map(c => c.iid);
    return withPending(s, {
      type: 'damage-distribute',
      actorIdx, sourcePlayerIdx: dIdx,
      minCount: nextRemaining, maxCount: nextRemaining,
      effectKey: 'dragapult-snipe',
      params: {
        totalCounters,
        placedCounters: placedAfter,
        counterDamage,
        label,
        validIids: reValidIids,
      },
    });
  }
  if (nextRemaining > 0) {
    s = addLog(s, `${label}：對手已無備戰寶可夢，剩 ${nextRemaining} 個指示物作廢`, actorIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38x+ v1.75 H 標第 20 波 — swap + energy return + count-multiply（10 張）
//
// Helpers:
//   discardOppActiveEnergyPost(label, filter?) — 攻後丟對手戰鬥寶可夢 1 張能量
//     filter: 'any' | 'special'；'special' 僅丟特殊能量
//   returnSelfActiveEnergyPost(n, toHand, label) — 攻後移除自身能量 n 張，toHand=true 放回手牌，否則改附備戰
//   returnOppActiveEnergyPost(n, label) — 攻後將對手戰鬥能量 n 張放回對手手牌
//   countDamagedSelfMultiplyPre(per, label) — pre 傷害 = 自己場上被傷害的寶可夢數 × per
// 特殊：
//   古月鳥|噴吐射擊 — 丟自身全部能量 + opp-poke-choose 120
//   噬沙堡爺ex|重晶石之獄 — 對手所有備戰設置 damage 直到剩 HP=100
// ══════════════════════════════════════════════════════════════════════════════

function discardOppActiveEnergyPost(
  label: string,
  filter: 'any' | 'special' = 'any',
): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active) return state;
      // v5.333：免疫招式效果的 active 不受此效果（C-17 per-target guard）
      {
        const _g = canApplyEffectToTarget(state, aIdx, defender.active, pool.get(defender.active.cardId), 'attack-effect', pool);
        if (_g.blocked) return addLog(state, `${label}：${_g.reason}`, aIdx);
      }
    const defName = pool.get(defender.active.cardId)?.name ?? '?';
    const energies = defender.active.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${defName} 沒有可丟的能量`, aIdx);
    }
    // 找最後一個符合 filter 的能量
    let targetIdx = -1;
    for (let i = energies.length - 1; i >= 0; i--) {
      const card = pool.get(energies[i].cardId);
      if (filter === 'special') {
        if (card?.supertype === 'Energy' && card.subtype === 'Special') {
          targetIdx = i;
          break;
        }
      } else {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) {
      return addLog(state, `${label}：${defName} 無${filter === 'special' ? '特殊' : ''}能量可丟`, aIdx);
    }
    const discarded = energies[targetIdx];
    const newEnergies = [...energies.slice(0, targetIdx), ...energies.slice(targetIdx + 1)];
    const energyName = pool.get(discarded.cardId)?.name ?? '能量';
    let s = addLog(state, `${label}：${defName} 丟棄 1 張${filter === 'special' ? '特殊' : ''}能量（${energyName}）`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, energyAttached: newEnergies },
        discard: [...p.discard, discarded],
      };
    });
  };
}

function returnSelfActiveEnergyPost(n: number, toHand: boolean, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    const energies = att.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${attName} 沒有可移動的能量`, aIdx);
    }
    const takeCount = Math.min(n, energies.length);
    const moved = energies.slice(energies.length - takeCount);
    const remaining = energies.slice(0, energies.length - takeCount);
    if (toHand) {
      let s = addLog(state, `${label}：${attName} 將 ${takeCount} 張能量放回手牌`, aIdx);
      return updatePlayer(s, aIdx, p => {
        if (!p.active) return p;
        return {
          ...p,
          active: { ...p.active, energyAttached: remaining },
          hand: [...p.hand, ...moved],
        };
      });
    }
    // 改附於備戰：卡面「選擇 1 個這隻身上的能量，改附於備戰」。
    if (state.players[aIdx].bench.length === 0) {
      return addLog(state, `${label}：沒有備戰寶可夢，能量留在原位`, aIdx);
    }
    // v5.708：active 身上有多個能量時讓玩家選「哪個能量」(原自動取末張 moved[0] → 不能選不同屬性);
    //   單一能量自動。選來源後 resolver 接 bench-choose 選目標備戰。
    if (energies.length > 1) {
      return withPending(state, {
        type: 'active-energy-discard',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'return-self-energy-pick-to-bench',
        params: { titleOverride: `${label}：選擇 1 個要改附於備戰寶可夢的能量`, label },
      });
    }
    const toMove = energies[0];
    let s = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => e.iid !== toMove.iid) } : null,
    }));
    s = addLog(s, `${label}：將能量改附於備戰寶可夢`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'gengar-move-energy',
      params: { energyIid: toMove.iid, energyCardId: toMove.cardId },
    });
  };
}

// v5.708：returnSelfActiveEnergyPost 改附分支的「選能量」picker 收尾 — 收選定能量 → 從 active 移除 → 開 bench-choose 選目標備戰。
regR('return-self-energy-pick-to-bench', (st, idx, iids, params, pool) => {
  const energyIid = iids[0];
  if (!energyIid) return st;
  const active = st.players[idx].active;
  if (!active) return st;
  const energy = active.energyAttached.find(e => e.iid === energyIid);
  if (!energy) return st;
  const label = (params?.label as string) ?? '改附能量';
  let s = updatePlayer(st, idx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => e.iid !== energyIid) } : null,
  }));
  s = addLog(s, `${label}：將能量改附於備戰寶可夢`, idx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'gengar-move-energy',
    params: { energyIid: energy.iid, energyCardId: energy.cardId },
  });
});

function returnOppActiveEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active) return state;
      // v5.333：免疫招式效果的 active 不受此效果（C-17 per-target guard）
      {
        const _g = canApplyEffectToTarget(state, aIdx, defender.active, pool.get(defender.active.cardId), 'attack-effect', pool);
        if (_g.blocked) return addLog(state, `${label}：${_g.reason}`, aIdx);
      }
    const defName = pool.get(defender.active.cardId)?.name ?? '?';
    // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋對手能量回對手手牌
    if (_v3080OppHasMenasureCG(state, aIdx, pool)) {
      return addLog(state, `${label}：對手場上有【平穩境地】，能量回手效果無效`, aIdx);
    }
    const energies = defender.active.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${defName} 沒有能量可放回`, aIdx);
    }
    const takeCount = Math.min(n, energies.length);
    const returned = energies.slice(energies.length - takeCount);
    const remaining = energies.slice(0, energies.length - takeCount);
    let s = addLog(state, `${label}：${defName} 的 ${takeCount} 張能量放回對手手牌`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, energyAttached: remaining },
        hand: [...p.hand, ...returned],
      };
    });
  };
}

function countDamagedSelfMultiplyPre(per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    const all = [p.active, ...p.bench].filter((x): x is CardInstance => !!x);
    const count = all.filter(c => c.damage > 0).length;
    const dmg = count * per;
    return {
      state: addLog(state, `${label}：自己被傷害的寶可夢 ${count} 隻 × ${per} → ${dmg}`, aIdx),
      damage: dmg,
    };
  };
}

// 1. 比克提尼|燒落 — 30 + 丟對手戰鬥場 1 張特殊能量
regPre('比克提尼|燒落', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('比克提尼|燒落', discardOppActiveEnergyPost('燒落', 'special'));

// 2. 大蔥鴨|音速斬 — 30 + 丟對手戰鬥場 1 張特殊能量
regPre('大蔥鴨|音速斬', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('大蔥鴨|音速斬', discardOppActiveEnergyPost('音速斬', 'special'));

// 3. 吼叫尾ex|咬碎 — 120 + 丟對手戰鬥場 1 張能量（任意）
regPre('吼叫尾ex|咬碎', (state, _aIdx, _pool) => ({ state, damage: 120 }));
regPost('吼叫尾ex|咬碎', discardOppActiveEnergyPost('咬碎', 'any'));

// 4. 狡猾天狗|能量閉環 — 140 + 將 1 張自身能量放回手牌
regPre('狡猾天狗|能量閉環', (state, _aIdx, _pool) => ({ state, damage: 140 }));
regPost('狡猾天狗|能量閉環', returnSelfActiveEnergyPost(1, true, '能量閉環'));

// 5. 鐵荊棘ex|伏特旋風 — 140 + 將 1 張自身能量改附於備戰
regPre('鐵荊棘ex|伏特旋風', (state, _aIdx, _pool) => ({ state, damage: 140 }));
regPost('鐵荊棘ex|伏特旋風', returnSelfActiveEnergyPost(1, false, '伏特旋風'));

// 6. 鐵轍跡|路徑輪 — 60 + 將 1 張自身能量改附於備戰
regPre('鐵轍跡|路徑輪', (state, _aIdx, _pool) => ({ state, damage: 60 }));
regPost('鐵轍跡|路徑輪', returnSelfActiveEnergyPost(1, false, '路徑輪'));

// 7. 高傲雉雞|反轉之風 — 70 + 若希望，選擇 2 個對手戰鬥寶可夢身上的能量，放回對手手牌。
// v3.27：原 returnOppActiveEnergyPost(2, ...) 為自動取末端 N 張（違反 Rule 7「若希望」必須玩家選）。
//   改為 active-energy-discard picker（sourcePlayerIdx=dIdx + minCount=0 + 自訂 resolver 把能量放對手手）。
regPre('高傲雉雞|反轉之風', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('高傲雉雞|反轉之風', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '反轉之風：選擇「否」 — 不放回對手能量', aIdx);
  const _cb: AttackPostFn = (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da || da.energyAttached.length === 0) return addLog(state, '反轉之風：對手戰鬥無能量', aIdx);
  // v5.555 收斂：免疫對手招式效果 → 不可放回能量
  {
    const _imm = isOppActiveImmuneToAttackEffect(state, aIdx, pool);
    if (_imm.blocked) return addLog(state, `反轉之風：${_imm.reason}（對手戰鬥寶可夢不受招式效果影響）`, aIdx);
  }
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋
  if (_v3080OppHasMenasureCG(state, aIdx, pool)) {
    return addLog(state, '反轉之風：對手場上有【平穩境地】，能量回手效果無效', aIdx);
  }
  const cap = Math.min(2, da.energyAttached.length);
  const s = addLog(state, `反轉之風：選擇 0∼${cap} 個對手戰鬥位能量放回對手手牌`, aIdx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: cap,
    effectKey: 'v327-unfezant-reverse-wind',
    params: { titleOverride: `選擇要放回對手手牌的能量（0∼${cap} 張）` },
  });
};
  return _cb(state, aIdx, pool);
});
regR('v327-unfezant-reverse-wind', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '反轉之風：玩家選擇不發動效果', idx);
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return st;
  const set = new Set(iids);
  const moved = dp.active.energyAttached.filter(e => set.has(e.iid));
  if (moved.length === 0) return st;
  const names = moved.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const s = addLog(st, `反轉之風：將對手戰鬥位的 ${names}（${moved.length} 張）放回對手手牌`, idx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => !set.has(e.iid)) }
      : pl.active,
    hand: [...pl.hand, ...moved],
  }));
});

// 8. 波士可多拉|發怒猛進 — 自己場上身上有傷害指示物的寶可夢數 × 50
regPre('波士可多拉|發怒猛進', countDamagedSelfMultiplyPre(50, '發怒猛進'));

// 9. 古月鳥|噴吐射擊 — 丟自身全部能量；對手 1 隻寶可夢受 120 傷害（備戰不計弱抗）
regPre('古月鳥|噴吐射擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古月鳥|噴吐射擊', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  const attName = pool.get(att.cardId)?.name ?? '?';
  const energyCount = att.energyAttached.length;
  if (energyCount === 0) {
    return addLog(state, `噴吐射擊：${attName} 沒有能量可丟，招式失敗`, aIdx);
  }
  // 丟全部自身能量
  let s = addLog(state, `噴吐射擊：${attName} 丟棄全部 ${energyCount} 張能量`, aIdx);
  s = updatePlayer(s, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      discard: [...p.discard, ...p.active.energyAttached],
    };
  });
  const dIdx = (1 - aIdx) as 0 | 1;
  // 對手必定有 active（否則攻擊無法進行）
  if (!s.players[dIdx].active && s.players[dIdx].bench.length === 0) return s;
  s = addLog(s, '噴吐射擊：選擇對手任一寶可夢造成 120 傷害', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { includeActive: true, damage: 120, label: '噴吐射擊' },
  });
});

// 10. 噬沙堡爺ex|重晶石之獄 — 對手所有備戰設置 damage 直到剩 HP=100
regPre('噬沙堡爺ex|重晶石之獄', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('噬沙堡爺ex|重晶石之獄', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0) {
    return addLog(state, '重晶石之獄：對手無備戰寶可夢', aIdx);
  }
  // v4.51 Phase 2：per-target 加 canApplyEffectToTarget（attack-effect）— 原版完全沒檢查
  //   涵蓋對戰圓形 / 球形盾牌 / 藏隱 / 深度下潛 / 羽毛化石 / 抵抗之幕 / 薄霧 / 全能硬殼 等
  const blockedNames: string[] = [];
  let s = state;
  const newBench = defender.bench.map(c => {
    const card = pool.get(c.cardId);
    const hp = card?.hp ?? 0;
    if (hp <= 100) return c;
    const targetDamage = hp - 100;
    if (c.damage >= targetDamage) return c;
    // defense check
    const guard = canApplyEffectToTarget(s, aIdx, c, card, 'attack-effect', pool, { isBench: true });
    if (guard.blocked) {
      blockedNames.push(`${card?.name ?? '?'}(${guard.reason})`);
      return c;
    }
    return { ...c, damage: targetDamage };
  });
  const affected = newBench.filter((c, i) => c.damage !== defender.bench[i].damage).length;
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...defender, bench: newBench };
  s = addLog({ ...s, players }, `重晶石之獄：對手備戰 ${affected} 隻被放置傷害指示物至剩 HP 100`, aIdx);
  if (blockedNames.length > 0) {
    s = addLog(s, `重晶石之獄：${blockedNames.join('、')} 未受影響`, aIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38z v1.76 H 標第 21 波 — snipe + stadium discard + peek hand（12 張）
//
// Helpers:
//   oppSnipePost(dmg, label) — 設置 pending 讓玩家選對手任一寶可夢造成 dmg（走 snipe-variable）
//   discardStadiumPost(label, failIfNone?) — 攻後丟棄場上競技場；failIfNone=true 時若無競技場則無效
//   peekOppHandPost(label) — 攻後「查看對手手牌」；目前僅記 log（UI 未來可做 reveal UI）
// ══════════════════════════════════════════════════════════════════════════════

function oppSnipePost(dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    // 若對手場上沒有任何寶可夢，跳過（理論不可能）
    if (!defender.active && defender.bench.length === 0) return state;
    const s = addLog(state, `${label}：選擇對手任一寶可夢造成 ${dmg} 傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'snipe-variable',
      params: { includeActive: true, damage: dmg, label },
    });
  };
}

function discardStadiumPost(label: string, failIfNone: boolean = false): AttackPostFn {
  return (state, aIdx, pool) => {
    if (!state.activeStadium) {
      if (failIfNone) return addLog(state, `${label}：場上無競技場，招式效果失敗`, aIdx);
      return addLog(state, `${label}：場上無競技場`, aIdx);
    }
    const stadiumName = pool.get(state.activeStadium.cardId)?.name ?? '競技場';
    // v2.244：用 discardActiveStadium helper 丟回擁有者棄牌堆
    return addLog(discardActiveStadium(state, aIdx), `${label}：${stadiumName} 被丟棄`, aIdx);
  };
}

function peekOppHandPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const hand = state.players[dIdx].hand;
    if (hand.length === 0) {
      return addLog(state, `${label}：對手手牌為空`, aIdx);
    }
    const names = hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    return addLog(state, `${label}：查看對手手牌（${hand.length} 張）— ${names}`, aIdx);
  };
}

// 1-5. 簡單 snipe（對對手任一寶可夢造成 dmg，備戰不計弱抗）
regPre('變隱龍|舌之鞭打', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('變隱龍|舌之鞭打', oppSnipePost(30, '舌之鞭打'));

regPre('雷伊布|直擊彈', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('雷伊布|直擊彈', oppSnipePost(30, '直擊彈'));

regPre('拉帝歐斯|直擊飛行', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('拉帝歐斯|直擊飛行', oppSnipePost(50, '直擊飛行'));

regPre('吉雉雞ex|殘酷箭', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('吉雉雞ex|殘酷箭', oppSnipePost(100, '殘酷箭'));

regPre('閃焰王牌ex|石榴石截擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('閃焰王牌ex|石榴石截擊', oppSnipePost(180, '石榴石截擊'));

// 6. 盔甲鳥|大風暴 — 90 + 丟棄場上競技場卡
regPre('盔甲鳥|大風暴', (state, _aIdx, _pool) => ({ state, damage: 90 }));
regPost('盔甲鳥|大風暴', discardStadiumPost('大風暴', false));

// 7. 無極汰那|世界之末 — 230 + 丟棄場上競技場（無則失敗）
// pre 依競技場存在設定傷害，不存在則 0
regPre('無極汰那|世界之末', (state, aIdx, _pool) => {
  if (!state.activeStadium) {
    return { state: addLog(state, '世界之末：場上無競技場，招式失敗', aIdx), damage: 0 };
  }
  return { state, damage: 230 };
});
regPost('無極汰那|世界之末', discardStadiumPost('世界之末', false));

// 8. 毛辮羊|搗碎 — 30 + 可選丟棄競技場（AI 永遠丟）
regPre('毛辮羊|搗碎', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('毛辮羊|搗碎', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '搗碎：選擇「否」 — 不丟競技場', aIdx);
  const _cb: AttackPostFn = discardStadiumPost('搗碎', false);
  return _cb(state, aIdx, pool);
});

// 9. 毛毛角羊|搗碎 — 70 + 可選丟棄競技場（AI 永遠丟）
regPre('毛毛角羊|搗碎', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('毛毛角羊|搗碎', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '搗碎：選擇「否」 — 不丟競技場', aIdx);
  const _cb: AttackPostFn = discardStadiumPost('搗碎', false);
  return _cb(state, aIdx, pool);
});

// 10-11. peek opp hand 類（僅 log，真實 reveal UI 另做）
regPre('咕咕|靜默之翼', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('咕咕|靜默之翼', peekOppHandPost('靜默之翼'));

regPre('催眠貘|不祥視線', (state, _aIdx, _pool) => ({ state, damage: 10 }));
regPost('催眠貘|不祥視線', peekOppHandPost('不祥視線'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38aa v1.77 H 標第 22 波 — heal-any-own + 呼朋引伴 + deck-mill（15 張）
//
// Helpers:
//   healAnyOwnPost(amount, label) — 攻後設置 pending heal-target（重用 'heal-30' resolver）
//   benchBasicFromDeckPost(max, label) — 攻後設置 pending deck-search Basic → bench
//   millSelfDeckTopPost(n, label) — 攻後丟自己牌庫頂 n 張
//   millOppDeckTopPost(n, label) — 攻後丟對手牌庫頂 n 張
// ══════════════════════════════════════════════════════════════════════════════

function healAnyOwnPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    const all = [p.active, ...p.bench].filter((x): x is CardInstance => !!x);
    if (!all.some(c => c.damage > 0)) {
      return addLog(state, `${label}：沒有寶可夢需要療傷`, aIdx);
    }
    let s = addLog(state, `${label}：選擇回復 ${amount} HP 的寶可夢`, aIdx);
    return withPending(s, {
      type: 'heal-target',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: amount === 30 ? 'heal-30' : amount === 120 ? 'heal-120' : 'heal-30',
      params: { healAmount: amount, discardEnergy: 0 },
    });
  };
}

function benchBasicFromDeckPost(max: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    // v5.041：bench limit 改 getBenchLimit (5→8)
    const limit = getOwnBenchLimit(state, aIdx, pool);
    if (player.bench.length >= limit) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const slots = limit - player.bench.length;
    const takeMax = Math.min(max, slots);
    let s = addLog(state, `${label}：從牌庫選最多 ${takeMax} 張基礎寶可夢放備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Basic',
      minCount: 0, maxCount: takeMax,
      effectKey: 'bench-basic-from-deck',
    });
  };
}

function millSelfDeckTopPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：自己牌庫為空`, aIdx);
    const taken = p.deck.slice(0, n);
    return updatePlayer(
      addLog(state, `${label}：自己牌庫頂 ${taken.length} 張丟入棄牌區：${joinCardNames(taken, pool)}`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: pl.deck.slice(taken.length), discard: [...pl.discard, ...taken] }),
    );
  };
}

export function millOppDeckTopPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const p = state.players[dIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：對手牌庫為空`, aIdx);
    const taken = p.deck.slice(0, n);
    // v5.194：log 加上實際丟棄的卡名（玩家可確認 mill 到什麼牌），仿枇琶 log pattern
    const takenNames = taken.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    let s = updatePlayer(
      addLog(state, `${label}：對手牌庫頂 ${taken.length} 張丟入棄牌區 — ${takenNames}`, aIdx),
      dIdx,
      pl => ({ ...pl, deck: pl.deck.slice(taken.length), discard: [...pl.discard, ...taken] }),
    );
    // v2.388 堅果啞鈴｜整人擊落 trigger
    s = triggerOakeyeMillIfApplicable(s, dIdx, taken, pool);
    return s;
  };
}

// ── pending heal（2 張） ────────────────────────────────────────────────────
regPre('啃果蟲|營養素', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('啃果蟲|營養素', healAnyOwnPost(30, '營養素'));

regPre('花蓓蓓|療傷', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('花蓓蓓|療傷', healAnyOwnPost(30, '療傷'));

// ── 造傷 + self heal by dealt-damage（2 張；v2.236 不再簡化）─────────────────
//   v2.236 升級為「實際造成的傷害量」(state.lastDealtDamage)，含弱抗 / 道具減傷
//   （原版只算 base dmg 30，對手有弱抗時不正確；共用 selfHealByDealtPost helper，
//    與朽木妖|終極吸取 同 pattern）。
function selfHealByDealtPost(attackName: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const actual = state.lastDealtDamage ?? 0;
    if (actual <= 0) return addLog(state, `${attackName}：實際傷害為 0，不回血`, aIdx);
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const attName = pool.get(att.active.cardId)?.name ?? '?';
    const newDmg = Math.max(0, att.active.damage - actual);
    const realHeal = att.active.damage - newDmg;
    if (realHeal === 0) return addLog(state, `${attackName}：${attName} 沒有受傷，不回血`, aIdx);
    att.active = { ...att.active, damage: newDmg };
    players[aIdx] = att;
    return addLog({ ...state, players },
      `${attackName}：${attName} 回復 ${realHeal} HP（=本招式造成的 ${actual} 傷害）`, aIdx);
  };
}
regPre('鐵毒蛾|吸納', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('鐵毒蛾|吸納', selfHealByDealtPost('吸納'));

regPre('火神蛾|吸血', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('火神蛾|吸血', selfHealByDealtPost('吸血'));

// ── 呼朋引伴 / 組成陣形 系列（5 張）───────────────────────────────────────────
regPre('狗仔包|香味', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('狗仔包|香味', benchBasicFromDeckPost(1, '香味'));

regPre('燭光靈|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('燭光靈|呼朋引伴', benchBasicFromDeckPost(1, '呼朋引伴'));

regPre('粉蝶蟲|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('粉蝶蟲|呼朋引伴', benchBasicFromDeckPost(1, '呼朋引伴'));

regPre('大顎蟻|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('大顎蟻|呼朋引伴', benchBasicFromDeckPost(2, '呼朋引伴'));

regPre('列陣兵|組成陣形', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('列陣兵|組成陣形', benchBasicFromDeckPost(2, '組成陣形'));

// ── 牌庫 mill（6 張）─────────────────────────────────────────────────────────
// 自己 mill
regPre('斧牙龍|龍之波動', (state, _aIdx, _pool) => ({ state, damage: 80 }));
regPost('斧牙龍|龍之波動', millSelfDeckTopPost(1, '龍之波動'));

regPre('雙斧戰龍|龍之波動', (state, _aIdx, _pool) => ({ state, damage: 230 }));
regPost('雙斧戰龍|龍之波動', millSelfDeckTopPost(3, '龍之波動'));

regPre('古簡蝸|捲入鞭打', (state, _aIdx, _pool) => ({ state, damage: 130 }));
regPost('古簡蝸|捲入鞭打', millSelfDeckTopPost(3, '捲入鞭打'));

// 對手 mill
regPre('螺釘地鼠|掘掘', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('螺釘地鼠|掘掘', millOppDeckTopPost(1, '掘掘'));

regPre('龍頭地鼠|挖洞爪', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('龍頭地鼠|挖洞爪', millOppDeckTopPost(1, '挖洞爪'));

regPre('三首惡龍ex|粉碎頭', (state, _aIdx, _pool) => ({ state, damage: 200 }));
regPost('三首惡龍ex|粉碎頭', millOppDeckTopPost(3, '粉碎頭'));

regPre('單首龍|踩落', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('單首龍|踩落', millOppDeckTopPost(1, '踩落'));

regPre('雙首暴龍|踩落', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('雙首暴龍|踩落', millOppDeckTopPost(2, '踩落'));

// ── Session 38ab (v1.78) H 標第 23 波：deck/discard search to hand + self-swap ──
// 共同 helper：攻擊後自己切換（備戰選 1 → 與出場互換）
export function selfSwapPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (!player.active || player.bench.length === 0) {
      return addLog(state, `${label}：備戰區沒有寶可夢，無法切換`, aIdx);
    }
    const s = addLog(state, `${label}：選擇換入的備戰寶可夢`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'do-switch',
    });
  };
}

// 從牌庫選 N 張（filter）加手牌（使用 search-to-hand-reshuffle）
function deckSearchToHandPost(max: number, filter: string, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：從牌庫選最多 ${max} 張（${filter}）加手牌`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter, minCount: 0, maxCount: max,
      effectKey: 'search-to-hand-reshuffle',
    });
  };
}

// ── 自己切換（5 張） ─────────────────────────────────────────────────────────
regPre('原蓋海龜|飛濺迴轉', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('原蓋海龜|飛濺迴轉', selfSwapPost('飛濺迴轉'));

regPre('粉蝶蛹|走來走去', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('粉蝶蛹|走來走去', selfSwapPost('走來走去'));

regPre('醜醜魚|躍起逃走', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('醜醜魚|躍起逃走', selfSwapPost('躍起逃走'));

regPre('沙漠蜻蜓ex|風暴返', (state, _aIdx, _pool) => ({ state, damage: 130 }));
regPost('沙漠蜻蜓ex|風暴返', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '風暴返：選擇「否」 — 不互換', aIdx);
  const _cb: AttackPostFn = selfSwapPost('風暴返');
  return _cb(state, aIdx, pool);
});

regPre('鍬農炮蟲|伏特替換', (state, _aIdx, _pool) => ({ state, damage: 90 }));
regPost('鍬農炮蟲|伏特替換', selfSwapPost('伏特替換'));

// ── 牌庫選基本能量到手牌（1張 — 小火馬 svhk） ──────────────────────────────
regPre('小火馬|蓄能量', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('小火馬|蓄能量', deckSearchToHandPost(1, 'BasicEnergy', '蓄能量'));

// ── 牌庫選基本能量到手牌（2張 — 基拉祈） ──────────────────────────────────
regPre('基拉祈|蓄能量', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('基拉祈|蓄能量', deckSearchToHandPost(2, 'BasicEnergy', '蓄能量'));

regPre('厄鬼椪 碧草面具|步山', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('厄鬼椪 碧草面具|步山', deckSearchToHandPost(2, 'BasicEnergy', '步山'));

regPre('花葉蒂|小使者', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('花葉蒂|小使者', deckSearchToHandPost(3, 'BasicEnergy', '小使者'));

regPre('索財靈|小使者', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('索財靈|小使者', deckSearchToHandPost(2, 'BasicEnergy', '小使者'));

// 伊布|鮮豔捕捉 — 最多 3 張各不同屬性的基本能量
// v2.162：用新 filter 'BasicEnergy:DistinctTypes' 讓 UI 端動態排除已選屬性
regPre('伊布|鮮豔捕捉', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('伊布|鮮豔捕捉', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '鮮豔捕捉：牌庫為空', aIdx);
  const s = addLog(state, '鮮豔捕捉：從牌庫選最多 3 張各不同屬性的基本能量加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:DistinctTypes',
    minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 光電傘蜥|拋物面充電 — 從牌庫選最多 4 張能量卡加手牌（含特殊能量）
//   v2.235 已升級：filter 'Energy' = supertype===Energy（任意基本/特殊能量），
//   無遺漏，符合卡面「能量卡」（不再簡化）。
regPre('光電傘蜥|拋物面充電', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('光電傘蜥|拋物面充電', deckSearchToHandPost(4, 'Energy', '拋物面充電'));

// ── 牌庫選寶可夢到手牌（2 張） ──────────────────────────────────────────────
regPre('幾何雪花|呼喚信號', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('幾何雪花|呼喚信號', deckSearchToHandPost(1, 'Pokemon', '呼喚信號'));

// 卡璞・鳴鳴|召喚雷電 — 最多 2 張【雷】寶可夢
regPre('卡璞・鳴鳴|召喚雷電', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('卡璞・鳴鳴|召喚雷電', deckSearchToHandPost(2, 'Pokemon:Lightning', '召喚雷電'));

// ── 棄牌區選卡到手牌（3 張） ────────────────────────────────────────────────
regPre('呆呆獸|垂尾巴', (state, _aIdx, _p) => ({ state, damage: 0 }));
// 'Pokemon' filter — 棄牌區寶可夢
regPost('呆呆獸|垂尾巴', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon';
  });
  if (cand.length === 0) return addLog(state, '垂尾巴：棄牌區沒有寶可夢', aIdx);
  const s = addLog(state, '垂尾巴：從棄牌區選 1 張寶可夢加手牌', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon', minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

regPre('咚咚鼠|電磁聲納', (state, _aIdx, _p) => ({ state, damage: 0 }));
regPost('咚咚鼠|電磁聲納', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => pool.get(c.cardId)?.supertype === 'Trainer');
  if (cand.length === 0) return addLog(state, '電磁聲納：棄牌區沒有訓練家卡', aIdx);
  const s = addLog(state, '電磁聲納：從棄牌區選 1 張訓練家卡加手牌', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Trainer', minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

regPre('霏歐納|招喚', (state, _aIdx, _p) => ({ state, damage: 0 }));
regPost('霏歐納|招喚', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'Supporter';
  });
  if (cand.length === 0) return addLog(state, '招喚：棄牌區沒有支援者卡', aIdx);
  const s = addLog(state, '招喚：從棄牌區選 1 張支援者卡加手牌', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Supporter', minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

// ── 優雅貓|能量攪拌 跳過（太複雜的任意方式改附）────────────────────────────

// ── 狙射樹梟|強力射擊 170 — 若無法丟基本草能量則招式失敗 ────────────────────
regPre('狙射樹梟|強力射擊', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const hasGrassEnergy = p.hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Grass' || card.name.includes('【草】'));
  });
  if (!hasGrassEnergy) {
    return { state: addLog(state, '強力射擊：手牌無基本草能量，招式失敗', aIdx), damage: 0 };
  }
  return { state, damage: 170 };
});
regPost('狙射樹梟|強力射擊', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const gidx = p.hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Grass' || card.name.includes('【草】'));
  });
  if (gidx < 0) return state;
  const energy = p.hand[gidx];
  const s = addLog(state, '強力射擊：丟棄手牌 1 張基本草能量', aIdx);
  return updatePlayer(s, aIdx, pl => ({
    ...pl,
    hand: [...pl.hand.slice(0, gidx), ...pl.hand.slice(gidx + 1)],
    discard: [...pl.discard, energy],
  }));
});

// ── 超甲狂犀|直衝鑽 180 — 丟對手戰鬥寶可夢 1 張能量（任意）──────────────────
regPre('超甲狂犀|直衝鑽', (state, _aIdx, _pool) => ({ state, damage: 180 }));
regPost('超甲狂犀|直衝鑽', discardOppActiveEnergyPost('直衝鑽', 'any'));

// ── 爆焰龜獸|灼燒盡 — 對手戰鬥場是 ex 才生效 ────────────────────────────────
regPre('爆焰龜獸|灼燒盡', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('爆焰龜獸|灼燒盡', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return state;
  const defCard = pool.get(def.cardId);
  if (!defCard || !isExCard(defCard)) {
    return addLog(state, '灼燒盡：對手戰鬥寶可夢非 ex，無效果', aIdx);
  }
  if (def.energyAttached.length === 0) {
    return addLog(state, '灼燒盡：對手戰鬥 ex 寶可夢無附加能量', aIdx);
  }
  const last = def.energyAttached[def.energyAttached.length - 1];
  const defName = defCard.name;
  const lastEnergyName = pool.get(last.cardId)?.name ?? '能量';
  const s = addLog(state, `灼燒盡：丟棄對手 ${defName} 身上的 ${lastEnergyName}`, aIdx);
  return updatePlayer(s, dIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: pl.active.energyAttached.slice(0, -1) },
      discard: [...pl.discard, last],
    };
  });
});

// ── 月亮伊布ex|縞瑪瑙 — 丟自身全部能量 + 獲得 1 張獎賞 ─────────────────────
regPre('月亮伊布ex|縞瑪瑙', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('月亮伊布ex|縞瑪瑙', (state, aIdx, pool) => {
  let s = state;
  const p = s.players[aIdx];
  if (p.active && p.active.energyAttached.length > 0) {
    const energies = p.active.energyAttached;
    s = addLog(s, `縞瑪瑙：丟棄自身 ${energies.length} 張能量`, aIdx);
    s = updatePlayer(s, aIdx, pl => {
      if (!pl.active) return pl;
      return {
        ...pl,
        active: { ...pl.active, energyAttached: [] },
        discard: [...pl.discard, ...energies],
      };
    });
  }
  if (s.players[aIdx].prizes.length === 0) {
    return addLog(s, '縞瑪瑙：獎賞區已空，無法獲得獎賞', aIdx);
  }
  s = addLog(s, '縞瑪瑙：額外待取 1 張獎賞（按「取得」按鈕領取）', aIdx);
  // v3.792 Rule 10：改用 addPendingPrize（移除直接 prize→hand），讓玩家點「取得」按鈕。
  s = addPendingPrize(s, aIdx, 1, pool);
  return s;
});

// ── 烈咬陸鯊ex|音波奇襲 — 丟 2 自身能量 + 對手 1 隻任意 120 ──────────────────
regPre('烈咬陸鯊ex|音波奇襲', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('烈咬陸鯊ex|音波奇襲', (state, aIdx, pool) => {
  let s = state;
  // 先丟 2 張自身能量（從後往前）
  const p = s.players[aIdx];
  if (!p.active) return s;
  const take = Math.min(2, p.active.energyAttached.length);
  if (take < 2) {
    return addLog(s, '音波奇襲：自身能量不足 2 張', aIdx);
  }
  const removed = p.active.energyAttached.slice(-2);
  s = addLog(s, '音波奇襲：丟棄自身 2 張能量', aIdx);
  s = updatePlayer(s, aIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: pl.active.energyAttached.slice(0, -2) },
      discard: [...pl.discard, ...removed],
    };
  });
  return oppSnipePost(120, '音波奇襲')(s, aIdx, pool);
});

// ── 大電海燕|風暴伏特 160 — 將自身所有能量「以任意方式」改附於備戰寶可夢 ──────
//   v2.220：升級為逐張選擇 — 每張能量可附到不同備戰寶可夢（之前簡化為全部到 1 隻）
//   實作：先把 active 上所有能量拔下來，依張數開 N 次 bench-choose pending，
//        每次 resolver 把當前 1 張能量附到玩家選的備戰，再開下一個 pending；
//        params.remainingEnergies 攜帶剩餘待分配的能量陣列。
regPre('大電海燕|風暴伏特', (state, _aIdx, _pool) => ({ state, damage: 160 }));
regPost('大電海燕|風暴伏特', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(state, '風暴伏特：自身無能量可改附', aIdx);
  }
  if (p.bench.length === 0) {
    return addLog(state, '風暴伏特：備戰區沒有寶可夢', aIdx);
  }
  const energies = p.active.energyAttached;
  // 先把能量從 active 拔下來（暫存在 pending params 裡）
  let s = updatePlayer(state, aIdx, pl => {
    if (!pl.active) return pl;
    return { ...pl, active: { ...pl.active, energyAttached: [] } };
  });
  s = addLog(s, `風暴伏特：將自身 ${energies.length} 張能量逐一改附於備戰寶可夢`, aIdx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'storm-volt-distribute',
    params: { remainingEnergies: energies, totalCount: energies.length, placedCount: 0 },
  });
});
regR('storm-volt-distribute', (st, idx, iids, params, pool) => {
  const remaining = (params?.remainingEnergies as CardInstance[] | undefined) ?? [];
  const totalCount = (params?.totalCount as number) ?? remaining.length;
  const placedCount = (params?.placedCount as number) ?? 0;
  if (remaining.length === 0) return st;
  const targetIid = iids[0];
  const energy = remaining[0];
  const rest = remaining.slice(1);
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) {
    // 目標不存在（例：被互換到別處）：把剩下的能量直接送到棄牌區避免遺失
    let s = addLog(st, `風暴伏特：目標備戰已不存在，剩餘 ${remaining.length} 張能量送往棄牌區`, idx);
    return updatePlayer(s, idx, pl => ({ ...pl, discard: [...pl.discard, ...remaining] }));
  }
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `風暴伏特：將第 ${placedCount + 1}/${totalCount} 張能量改附於 ${targetName}`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energy] }
      : c),
  }));
  if (rest.length > 0) {
    return withPending(s, {
      type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'storm-volt-distribute',
      params: { remainingEnergies: rest, totalCount, placedCount: placedCount + 1 },
    });
  }
  return s;
});

// ── （legacy）storm-volt-move resolver — 由「飄浮泡泡 太陽的樣子｜陽光支援」共用 ──
//   陽光支援 卡面：「全部改附於1隻備戰寶可夢身上。」（單一目標，正確簡單版）
regR('storm-volt-move', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const p = st.players[idx];
  if (!p.active) return st;
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.active.energyAttached;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `陽光支援：將 ${energies.length} 張能量改附於 ${targetName}`, idx);
  return updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: [] },
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    };
  });
});

// ── 飄浮泡泡 太陽的樣子|陽光支援 50 — 同上模式（改附於 1 隻備戰）─────────────
regPre('飄浮泡泡 太陽的樣子|陽光支援', (state, _aIdx, _pool) => ({ state, damage: 50 }));
regPost('飄浮泡泡 太陽的樣子|陽光支援', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(state, '陽光支援：自身無能量可改附', aIdx);
  }
  if (p.bench.length === 0) {
    return addLog(state, '陽光支援：備戰區沒有寶可夢', aIdx);
  }
  const s = addLog(state, `陽光支援：選擇 1 隻備戰寶可夢，將自身能量改附`, aIdx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'storm-volt-move',
  });
});

// 12. 噗隆隆|金屬塗層 — 招式：從棄牌區 1 張基本鋼能量附於自身（auto）
//   實際卡池中此為招式（非特性），登錄為 ATTACK_POST，pre 傷害 0
regPre('噗隆隆|金屬塗層', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('噗隆隆|金屬塗層', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return addLog(state, '金屬塗層：場上無戰鬥寶可夢', aIdx);
  const idx = p.discard.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Metal' || card.name.includes('【鋼】'));
  });
  if (idx < 0) return addLog(state, '金屬塗層：棄牌區沒有基本鋼能量', aIdx);
  const energy = p.discard[idx];
  const attName = pool.get(p.active.cardId)?.name ?? '?';
  let s = addLog(state, `金屬塗層：從棄牌區附加 1 張基本鋼能量到 ${attName}`, aIdx);
  return updatePlayer(s, aIdx, p2 => {
    if (!p2.active) return p2;
    return {
      ...p2,
      discard: [...p2.discard.slice(0, idx), ...p2.discard.slice(idx + 1)],
      active: { ...p2.active, energyAttached: [...p2.active.energyAttached, energy] },
    };
  });
});

// ── Session 38ac (v1.79) H 標第 24 波：棄牌能量附加 + 多目標 snipe ──────────────
// 共同 helper：棄牌區選 N 張特定屬性基本能量 → 選 1 隻自己寶可夢附加
// 兩步：步驟 1 選能量（discard-search），步驟 2 選目標（heal-target 類，任一自己寶可夢）
function discardEnergyAttachPost(
  max: number,
  typeFilter: EnergyType | null,
  label: string,
): AttackPostFn {
  // v3.12 升級：改用 v158-energy-chain-start resolver（source: 'discard'），
  // 支援多目標分配（單一目標自動全附；同類能量批次 +/- UI；混合屬性逐張 picker）。
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && !energyMatchesType(card, typeFilter as EnergyType)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    });
    if (cand.length === 0) {
      return addLog(state, `${label}：棄牌區沒有符合的基本能量`, aIdx);
    }
    const realMax = Math.min(max, cand.length);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從棄牌區選 0-${realMax} 張基本能量`, aIdx);
    return withPending(s, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr,
      // v3.12: minCount=0 允許「不選」
      minCount: 0, maxCount: realMax,
      effectKey: 'v158-energy-chain-start',
      params: {
        label,
        source: 'discard',
        scope: 'any-own',
      },
    });
  };
}

// 多目標 snipe：對手任意 N 隻寶可夢各 D 傷害
function multiSnipePost(targetCount: number, damage: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    const all = [d.active, ...d.bench].filter((c): c is CardInstance => !!c);
    if (all.length === 0) return state;
    const realMax = Math.min(targetCount, all.length);
    const s = addLog(state, `${label}：選擇對手 ${realMax} 隻寶可夢各造成 ${damage} 傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: realMax,
      effectKey: 'snipe-multi',
      params: { damage, label },
    });
  };
}
regR('snipe-multi', (st, actorIdx, selectedIids, params, pool) => {
  const dmg = (params?.damage as number) ?? 0;
  const label = (params?.label as string) ?? '多目標攻擊';
  // v2.46：caller 可用 kind 指定是招式傷害還是招式效果。預設 'attack-damage'。
  const kind = ((params?.kind as DamageKind) ?? 'attack-damage');
  const dIdx = (1 - actorIdx) as 0 | 1;
  let s = st;
  let totalPrize = 0;
  let opponentActiveKOed = false;
  for (const iid of selectedIids) {
    const defender = s.players[dIdx];
    const isActive = defender.active?.iid === iid;
    const target = isActive ? defender.active! : defender.bench.find(c => c.iid === iid);
    if (!target) continue;
    const targetCard = pool.get(target.cardId);
    // v4.979: 統一 — active + bench 都過 canApplyEffectToTarget
    //   bench: 對戰圓形 / 花之帷幔 / 太晶 / 中立中心 等
    //   active: 飛翔 / 要害斬 / 阿塞蘿拉 / 中立中心 / 精神防護 / 閃光屏障 / 熔岩之壁 / 防護代碼 / 塗層攻擊
    //   注意：kind 透傳（多目標 resolver 同時用於 attack-damage 跟 attack-effect）
    const guard = canApplyEffectToTarget(s, actorIdx, target, targetCard, kind, pool, { isBench: !isActive });
    if (guard.blocked) {
      const name = targetCard?.name ?? '?';
      s = addLog(s, `${label}：${name} 因${guard.reason}不受傷害`, actorIdx);
      continue;
    }
    // v5.153：active 補套 weakness/resistance/猛攻手鐲等攻擊方 tool（卡面註解「備戰區不計
    //   弱點抵抗力」暗示戰鬥場要計算）。Wilson 回報耀閃挑戰學三重冰霜對 ex 沒算 +30。
    let effDmg = dmg;
    if (isActive) {
      const attacker = s.players[actorIdx].active;
      const attackerCard = attacker ? pool.get(attacker.cardId) : null;
      // v5.673：弱點/抵抗力收斂到中央 applyWeakRes(妖精領域/掌握弱點/弱點失效/攻擊方雙屬性,與主管線一致)。
      effDmg = applyWeakRes(s, actorIdx, target, targetCard, effDmg, pool);
      // TOOL_ATTACK_BONUS（猛攻手鐲等）— iterate 攻擊方所有道具
      if (attacker && attackerCard) {
        for (const t of getAllAttachedTools(attacker)) {
          const atkTool = pool.get(t.cardId);
          if (!atkTool) continue;
          const fn = TOOL_ATTACK_BONUS.get(atkTool.name);
          if (!fn) continue;
          const bonus = fn(attackerCard, attacker, targetCard ?? attackerCard, target);
          if (bonus > 0) effDmg += bonus;
        }
      }
    }
    // v5.583：套防守方特性/場地【傷害減免】（爆炸頭水牛 捲牆 / 守護之鐘 / 齒輪塗層 / 凍原堡壘 /
    //   岩石宮殿 / 自身 PASSIVE_DAMAGE_REDUCE 等）。弱點/抵抗力非此類，已於上方戰鬥位另計。
    //   收斂：與 hitBenchAll / hitBenchPickPost / dealAttackDamageToTarget 同一條 _applyBenchAbilityReduce，
    //   active+bench 皆適用（snipe-multi 不走引擎主管線，過去完全漏套 → 備戰捲牆等無效）。
    if (effDmg > 0 && targetCard) {
      const _rd = _applyBenchAbilityReduce(s, target, targetCard, dIdx, actorIdx, pool, effDmg);
      if (_rd.amount !== effDmg && _rd.logs.length > 0) s = addLog(s, `${targetCard.name}：${_rd.logs.join('、')}`, null);
      effDmg = _rd.amount;
    }
    // v5.599 擲幣免傷（躲藏高手/腎上腺費洛蒙）：active+bench 皆套
    if (effDmg > 0) {
      const _ca = applyDefenderCoinAvoid(s, target, targetCard, dIdx, effDmg, pool);
      s = _ca.state;
      if (_ca.avoided) effDmg = 0;
    }
    // v5.435：active 受招式傷害 → 觸發防守方 on-damaged 全機制（共用 fireDefenderOnDamaged，
    //   升級原本只有 SPECIAL_ENERGY 的版本；補 TOOL_ON_DAMAGED/還擊斧/龐克頭盔/反擊特性/警備濁霧）。
    if (isActive && effDmg > 0) {
      s = fireDefenderOnDamaged(s, dIdx, actorIdx, effDmg, pool);
      if (s.phase === 'game-over') return s;
    }
    // re-fetch（helper 可能消費還擊旗標 / 改 attacker 狀態）
    const defenderNow = s.players[dIdx];
    const targetNow = isActive ? defenderNow.active : defenderNow.bench.find(c => c.iid === iid);
    if (!targetNow) continue;
    const newDmg = targetNow.damage + effDmg;
    const hp = effectiveHPInline(targetNow, pool, st);  // v5.091
    if (hp > 0 && newDmg >= hp) {
      // v5.594 prevent-KO（堅忍之軀/倖存鍛鍊器等）：命中則留 HP 不昏厥
      const _pk = applyPreventKOToVictim(s, targetNow, targetCard, dIdx, effDmg, pool);
      if (_pk.prevented) { s = _pk.state; continue; }
      const ko: CardInstance[] = [
        { ...targetNow, damage: newDmg },
        ...targetNow.energyAttached,
        ...getAllAttachedTools(targetNow),
        ...(targetNow.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(s, targetNow, targetCard, actorIdx, dIdx, pool);
      s = _ko.state;
      const p = _ko.prizes;
      totalPrize += p;
      const players = [...s.players] as [PlayerState, PlayerState];
      const newDefender = { ...defenderNow, discard: [...defenderNow.discard, ...ko] };
      if (isActive) { newDefender.active = null; opponentActiveKOed = true; }
      else newDefender.bench = defenderNow.bench.filter(c => c.iid !== iid);
      players[dIdx] = newDefender;
      s = addLog({ ...s, players }, `${label}：${targetCard?.name ?? '?'} 被擊倒！+${p} 張獎賞卡。`, null);
      s = recordOppKO(s, dIdx, targetCard, 'attack');
      // v5.613 收斂：多目標狙擊招式 KO 戰鬥位 → 補觸發防守方 on-KO（沉重接力棒/反擊等），與引擎主管線/中央 helper 一致
      s = fireDefenderOnKO(s, dIdx, actorIdx, pool, { ...targetNow, damage: newDmg }, isActive, true);
    } else {
      const players = [...s.players] as [PlayerState, PlayerState];
      const newDefender = { ...defenderNow };
      if (isActive) newDefender.active = { ...targetNow, damage: newDmg };
      else newDefender.bench = defenderNow.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c);
      players[dIdx] = newDefender;
      s = addLog({ ...s, players }, `${label}：對 ${targetCard?.name ?? '?'} 造成 ${effDmg} 傷害`, actorIdx);
    }
  }
  // 檢查 KO 後的狀態
  const defender = s.players[dIdx];
  if (opponentActiveKOed && !defender.active && defender.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
  }
  if (totalPrize > 0) s = addPendingPrize(s, actorIdx, totalPrize, pool);
  return s;
});

// ── 棄牌能量附加（6 張） ────────────────────────────────────────────────────
regPre('古劍豹|雪之到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古劍豹|雪之到來', discardEnergyAttachPost(2, 'Water', '雪之到來'));

regPre('古玉魚|閃焰到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古玉魚|閃焰到來', discardEnergyAttachPost(2, 'Fire', '閃焰到來'));

regPre('古簡蝸|綠葉到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古簡蝸|綠葉到來', discardEnergyAttachPost(2, 'Grass', '綠葉到來'));

regPre('古鼎鹿|沙之到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古鼎鹿|沙之到來', discardEnergyAttachPost(2, 'Fighting', '沙之到來'));

regPre('土地雲|真氣之拳', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('土地雲|真氣之拳', (state, aIdx, pool) => {
  // 棄牌選 1 張基本能量附於自身（無屬性限制）
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (cand.length === 0) return addLog(state, '真氣之拳：棄牌區沒有基本能量', aIdx);
  const s = addLog(state, '真氣之拳：從棄牌區選 1 張基本能量', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy', minCount: 1, maxCount: 1,
    // v3.12: 改用新 resolver（原 'discard-energy-attach-pick-target' 已 chain 化）
    effectKey: 'v312-attach-energy-to-active',
    params: { label: '真氣之拳' },
  });
});

// v3.12 補：把選自棄牌區的能量附於自方戰鬥寶可夢（土地雲|真氣之拳 等用）
regR('v312-attach-energy-to-active', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '附於自身';
  const p = st.players[idx];
  if (!p.active) return addLog(st, `${label}：自身不在場上`, idx);
  if (iids.length === 0) return addLog(st, `${label}：未選擇能量`, idx);
  const energies = p.discard.filter(c => iids.includes(c.iid));
  if (energies.length === 0) return addLog(st, `${label}：能量遺失`, idx);
  const tname = pool.get(p.active.cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到 ${tname}（戰鬥場）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !iids.includes(c.iid)),
    active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } : null,
  }));
});

regPre('多麗米亞|能量支援', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('多麗米亞|能量支援', (state, aIdx, pool) => {
  // 棄牌 1 張基本能量 → 附於備戰寶可夢
  const p = state.players[aIdx];
  if (p.bench.length === 0) return addLog(state, '能量支援：備戰區沒有寶可夢', aIdx);
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (cand.length === 0) return addLog(state, '能量支援：棄牌區沒有基本能量', aIdx);
  const s = addLog(state, '能量支援：從棄牌區選 1 張基本能量', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy', minCount: 1, maxCount: 1,
    effectKey: 'discard-energy-attach-bench-only',
    params: { label: '能量支援' },
  });
});
regR('discard-energy-attach-bench-only', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '棄牌附能';
  const p = st.players[idx];
  if (p.bench.length === 0) return st;
  if (p.bench.length === 1) {
    const target = p.bench[0];
    const energies = p.discard.filter(c => iids.includes(c.iid));
    const tname = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `${label}：將能量附加到備戰 ${tname}`, idx);
    return updatePlayer(s, idx, pl => ({
      ...pl,
      discard: pl.discard.filter(c => !iids.includes(c.iid)),
      bench: pl.bench.map(c => c.iid === target.iid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    }));
  }
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'discard-energy-attach-commit-bench',
    params: { energyIids: iids, label },
  });
});
regR('discard-energy-attach-commit-bench', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '棄牌附能';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.discard.filter(c => energyIids.includes(c.iid));
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到備戰 ${tname}`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !energyIids.includes(c.iid)),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
});

// ── 多目標 snipe（1 張）─────────────────────────────────────────────────────
// 甲賀忍蛙ex｜分身連打 — v2.222 移除：v2.129 已在 line 10665 重新實裝為
//   ATTACK_PRE_DISCARD_CHOICE（玩家自選棄能量）+ opp-poke-choose（玩家自選 2 隻
//   對手寶可夢，戰鬥場仍套弱抗、備戰位不計）。舊版 slice(-2) 自動丟最後 2 張+
//   multiSnipePost(2, 120) 不正確（玩家無法選能量、目標、且戰/備抗區待遇相同）。
//   保留舊登錄會讓後者覆蓋，但 dead code 容易誤導，整段移除。

// 酋雷姆｜三重冰霜 — 丟自身全部能量 → 對手 3 隻各 110
regPre('酋雷姆|三重冰霜', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('酋雷姆|三重冰霜', (state, aIdx, pool) => {
  let s = state;
  const p = s.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(s, '三重冰霜：自身無能量', aIdx);
  }
  const energies = p.active.energyAttached;
  s = addLog(s, `三重冰霜：丟棄自身 ${energies.length} 張能量`, aIdx);
  s = updatePlayer(s, aIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: [] },
      discard: [...pl.discard, ...energies],
    };
  });
  return multiSnipePost(3, 110, '三重冰霜')(s, aIdx, pool);
});

// ── 莫魯貝可｜能量車輪 70 — 選 2 張自身【惡】能量 → 改附於 1 隻備戰 ──────────
regPre('莫魯貝可|能量車輪', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('莫魯貝可|能量車輪', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  // 列出自身【惡】能量 iid
  const darkIids = p.active.energyAttached
    .filter(e => {
      const card = pool.get(e.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Darkness' || card.name.includes('【惡】'));
    })
    .map(e => e.iid);
  if (darkIids.length < 2) {
    return addLog(state, '能量車輪：自身【惡】能量不足 2 張', aIdx);
  }
  if (p.bench.length === 0) {
    return addLog(state, '能量車輪：備戰區沒有寶可夢', aIdx);
  }
  // v2.237 釐清（不再簡化）：候選都是「基本【惡】能量」（filter 已限定 Basic+Darkness），
  //   所有候選 cardId 相同 → 自動挑前 2 個與玩家手選功能等效（移哪 2 張不影響後續狀態）。
  const picked = darkIids.slice(0, 2);
  const pickedEnergies = p.active.energyAttached.filter(e => picked.includes(e.iid));
  let s = addLog(state, '能量車輪：將自身 2 張【惡】能量改附於備戰', aIdx);
  s = updatePlayer(s, aIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: {
        ...pl.active,
        energyAttached: pl.active.energyAttached.filter(e => !picked.includes(e.iid)),
      },
    };
  });
  // 讓玩家選備戰目標
  return withPending(s, {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-wheel-attach',
    params: { energies: pickedEnergies },
  });
});
regR('energy-wheel-attach', (st, idx, iids, params, pool) => {
  const energies = (params?.energies as CardInstance[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `能量車輪：將 ${energies.length} 張能量附加到 ${tname}`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ad v1.80 H 標第 25 波 — field discard×multiplier + 特能清除 + coin×energy
//
// Helpers:
//   fieldDiscardMultiplyPre(base, per, max, typeFilter, label) — 可丟場上（含備戰）能量
//   oppDiscardAllSpecialEnergyPost(label) — 清空對手全場特殊能量
//   coinByActiveEnergyPre(base, per, label, scope: 'self'|'both') — 擲硬幣=出場能量數
// 卡牌：
//   來悲粗茶 傾瀉茶 70×（草 max 3 場上）
//   猛雷鼓ex 極降駕 70×（basic 任意 場上）
//   蒼炎刃鬼 火焰咒詛（清除全場特殊能量）
//   厄鬼椪 火灶面具ex 極限火焰 140（若對手進化 +140 並丟全部自身能量）
//   怖納噬草 強力尖刺 80×硬幣正面數（=自身能量數）
//   椰蛋樹 投球時刻 60×硬幣正面數（=雙方出場能量和）
// ══════════════════════════════════════════════════════════════════════════════

type FieldDiscardFilter = 'all' | 'basic' | EnergyType;

function fieldDiscardMultiplyPre(
  baseDamage: number,
  per: number,
  max: number,
  typeFilter: FieldDiscardFilter,
  label: string,
): AttackPreFn {
  return (state, aIdx, pool, action) => {
    const player = state.players[aIdx];
    // 列出場上（含備戰）所有符合條件的能量
    type Loc = { host: 'active' | number; energy: CardInstance };
    const eligible: Loc[] = [];
    const matches = (e: CardInstance): boolean => {
      const c = pool.get(e.cardId);
      if (!c || c.supertype !== 'Energy') return false;
      if (typeFilter === 'all') return true;
      if (typeFilter === 'basic') return c.subtype === 'Basic';
      return energyMatchesType(c, typeFilter as EnergyType); // v5.450：基本能量 pokemonType 為 null，須用名稱-aware 比對
    };
    if (player.active) {
      for (const e of player.active.energyAttached) {
        if (matches(e)) eligible.push({ host: 'active', energy: e });
      }
    }
    player.bench.forEach((b, i) => {
      for (const e of b.energyAttached) {
        if (matches(e)) eligible.push({ host: i, energy: e });
      }
    });

    // 決定要丟的 iid 清單
    const chosenIids = action?.discardedEnergyIids;
    let selected: Loc[];
    if (chosenIids && chosenIids.length > 0) {
      const idSet = new Set(chosenIids);
      selected = eligible.filter(l => idSet.has(l.energy.iid)).slice(0, max);
    } else {
      // 自動 fallback：從尾端挑 max 個
      const n = Math.min(max, eligible.length);
      selected = eligible.slice(-n);
    }
    if (selected.length === 0) {
      return { state: addLog(state, `${label}：未丟棄任何能量 → ${baseDamage}`, aIdx), damage: baseDamage };
    }

    // 依 host 分組
    const activeRm = new Set<string>();
    const benchRm = new Map<number, Set<string>>();
    for (const s of selected) {
      if (s.host === 'active') activeRm.add(s.energy.iid);
      else {
        const st = benchRm.get(s.host) ?? new Set<string>();
        st.add(s.energy.iid);
        benchRm.set(s.host, st);
      }
    }

    const discardList = selected.map(s => s.energy);
    let s2 = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => !activeRm.has(e.iid)) } : null,
      bench: p.bench.map((b, i) => {
        const rm = benchRm.get(i);
        if (!rm || rm.size === 0) return b;
        return { ...b, energyAttached: b.energyAttached.filter(e => !rm.has(e.iid)) };
      }),
      discard: [...p.discard, ...discardList],
    }));
    const dmg = baseDamage + per * selected.length;
    s2 = addLog(s2, `${label}：丟棄 ${selected.length} 個能量 → ${dmg}`, aIdx);
    return { state: s2, damage: dmg };
  };
}

function registerFieldDiscardMultiply(
  key: string,
  label: string,
  baseDamage: number,
  per: number,
  max: number,
  typeFilter: FieldDiscardFilter,
) {
  ATTACK_PRE_DISCARD_CHOICE.set(key, {
    min: 0,
    max,
    scope: 'any-own',
    baseDamage,
    damagePerEnergy: per,
  });
  regPre(key, fieldDiscardMultiplyPre(baseDamage, per, max, typeFilter, label));
}

// 來悲粗茶｜傾瀉茶 — 最多 3 張自己場上【草】能量 × 70
registerFieldDiscardMultiply('來悲粗茶|傾瀉茶', '傾瀉茶', 0, 70, 3, 'Grass');

// 猛雷鼓ex｜極降駕 — 任意張數自己場上基本能量 × 70（以大 max 近似 "任意"）
registerFieldDiscardMultiply('猛雷鼓ex|極降駕', '極降駕', 0, 70, 20, 'basic');

// ── 蒼炎刃鬼｜火焰咒詛 — 將對手全場特殊能量全部丟棄 ───────────────────────
regPre('蒼炎刃鬼|火焰咒詛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('蒼炎刃鬼|火焰咒詛', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  let removed = 0;
  const removedEnergies: CardInstance[] = [];
  const stripSpecial = (inst: CardInstance): CardInstance => {
    const specials: CardInstance[] = [];
    const kept: CardInstance[] = [];
    for (const e of inst.energyAttached) {
      const c = pool.get(e.cardId);
      if (c && c.supertype === 'Energy' && c.subtype === 'Special') {
        specials.push(e);
      } else {
        kept.push(e);
      }
    }
    removed += specials.length;
    removedEnergies.push(...specials);
    return { ...inst, energyAttached: kept };
  };
  let s = state;
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? stripSpecial(p.active) : null,
    bench: p.bench.map(stripSpecial),
    discard: [...p.discard, ...removedEnergies],
  }));
  if (removed === 0) {
    return addLog(s, '火焰咒詛：對手全場沒有特殊能量', aIdx);
  }
  return addLog(s, `火焰咒詛：丟棄對手全場 ${removed} 張特殊能量`, aIdx);
});

// ── 厄鬼椪 火灶面具ex｜極限火焰 — 140（若對手是進化寶可夢 +140，並丟自身全部能量）
regPre('厄鬼椪 火灶面具ex|極限火焰', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return { state, damage: 140 };
  const defCard = pool.get(def.cardId);
  const isEvo = !!(defCard?.evolvesFrom);
  if (!isEvo) {
    return { state: addLog(state, '極限火焰：對手非進化寶可夢', aIdx), damage: 140 };
  }
  // 是進化寶可夢：+140 並丟自身全部能量
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 280 };
  let s = addLog(state, `極限火焰：對手為進化寶可夢 → +140（丟自身 ${att.energyAttached.length} 張能量）`, aIdx);
  s = updatePlayer(s, aIdx, p => {
    if (!p.active) return p;
    const ens = p.active.energyAttached;
    return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...ens] };
  });
  return { state: s, damage: 280 };
});

// ── 怖納噬草｜強力尖刺 — 擲與自身能量數同次硬幣，正面 × 80 ──────────────
regPre('怖納噬草|強力尖刺', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 0 };
  const n = countOneEnergy(att, 'all', pool);
  if (n === 0) return { state: addLog(state, '強力尖刺：自身無能量', aIdx), damage: 0 };
  const r = flipCoinsWithLog(state, n, '強力尖刺', aIdx);
  const dmg = r.heads * 80;
  const s = addLog(r.state, `強力尖刺：${r.heads}/${n} 次正面 → ${r.heads}×80 = ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ── 椰蛋樹｜投球時刻 — 擲與雙方出場能量和同次硬幣，正面 × 60 ────────────
// v4.959：「能量和」按 unit 計（host-aware 新衝天能量 on Stage2 = 2）
regPre('椰蛋樹|投球時刻', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const att = state.players[aIdx].active;
  const def = state.players[dIdx].active;
  const n = (att ? countAttachedEnergyAsUnits(att, pool) : 0) + (def ? countAttachedEnergyAsUnits(def, pool) : 0);
  if (n === 0) return { state: addLog(state, '投球時刻：雙方出場皆無能量', aIdx), damage: 0 };
  const r = flipCoinsWithLog(state, n, '投球時刻', aIdx);
  const dmg = r.heads * 60;
  const s = addLog(r.state, `投球時刻：${r.heads}/${n} 次正面 → ${r.heads}×60 = ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ae v1.81 H 標第 26 波 — damage-plus 下回合加傷 + 特性加傷（4 張）
//
// 引擎新增：CardInstance.damageBonusPending / damageBonusThisTurn
//   POST 設 damageBonusPending = N → END_TURN promote 為 damageBonusThisTurn
//   → 下個自己回合招式發動時，base damage +N（weakness 前套用），用完即清
//
// Helpers:
//   setSelfDamageBonusPendingPost(amount, label) — 打完招設下 N
// 卡牌：
//   巨金怪 彗星拳 60（下回合 +60）
//   大電海燕 風力充能 10（下回合 +120）
//   電蜘蛛 複眼（PRE：若對手戰鬥擁有特性則 +50，和 麻麻羅網 疊加）
// ══════════════════════════════════════════════════════════════════════════════

function setSelfDamageBonusPendingPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att) return state;
    const name = pool.get(att.cardId)?.name ?? '?';
    const s = addLog(state, `${label}：${name} 下回合招式傷害 +${amount}`, aIdx);
    return updatePlayer(s, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageBonusPending: (p.active.damageBonusPending ?? 0) + amount } : null,
    }));
  };
}

regPost('巨金怪|彗星拳', setSelfDamageBonusPendingPost(60, '彗星拳'));
regPost('大電海燕|風力充能', setSelfDamageBonusPendingPost(120, '風力充能'));

// 電蜘蛛｜麻麻羅網 — 複眼 +50（對「擁有特性」的對手戰鬥寶可夢）由 PASSIVE_ATTACK_BONUS['複眼']
//   統一處理（見上方 map + NO_STACK），涵蓋電蜘蛛所有招式、在 weakness ×2 前套用，符合卡面
//   「這隻寶可夢使用的招式」。base 麻麻羅網 regPre（含 +80 雷邏輯）在 L5517。
//   v5.327：移除原本此處的 inline 複眼 +50 wrapper —— 它與 PASSIVE_ATTACK_BONUS['複眼'] 重複，
//   兩個 +50 都在 weakness 前套用，屬性相剋時各被 ×2 → 多算 100（玩家回報 460，正解 360）。

// ══════════════════════════════════════════════════════════════════════════════
// Session 38af v1.82 H 標第 27 波 — KO-check / self-damage / 條件 cantAttackPending
//
// 新實裝 6 張（懶人獺 已於 E 區就地修改）：
//   1. 轟鳴月ex｜瘋癲攻擊     — KO 對手戰鬥寶可夢；自己受 200 傷害
//   2. 鐵臂膀ex｜感激放大     — 120 傷害；若 KO 對手，+1 獎賞卡
//   3. 鐵包袱｜冷卻噴射       — 80 傷害；若對手為進化寶可夢，下回合無法使用招式
//   4. 帕底亞 肯泰羅｜障礙踩踏 — 90 傷害；若對手為基礎寶可夢，下回合無法使用招式
//   5. 冰伊布ex｜藍柱石       — 選 1 隻身上放有 ≥6 傷害指示物的對手寶可夢 KO
//
// 機制：
//   - bonusPrizeIfKOPost：post 階段檢查 def.active === null（KO 了）→ +N pendingPrizes
//   - defCantAttackIfSubtypePost：若對手仍存活且符合 subtype → 設 cantAttackPending
//   - 藍柱石：透過 opp-poke-choose pendingSelection（含出場，但需 damage ≥ 60）
// ══════════════════════════════════════════════════════════════════════════════

// 攻擊後若對手出場已 KO（active === null）→ 額外加 N 張獎賞卡
function bonusPrizeIfKOPost(bonus: number, label: string): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    if (state.players[dIdx].active !== null) return state;
    if (getPendingPrize(state, aIdx) <= 0) return state;
    const s = addLog(state, `${label}：擊倒對手 → 多獲得 ${bonus} 張獎賞卡`, aIdx);
    return addPendingPrize(s, aIdx, bonus, pool);
  };
}

// 攻擊後若對手 Active 仍存活且符合 subtype（Basic/進化）→ 設 cantAttackPending
function defCantAttackIfSubtypePost(
  cond: 'basic' | 'evolved',
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def) return state;
    const card = pool.get(def.cardId);
    if (!card) return state;
    // v3.46：PTCG 基礎判定含 ex 等變體
    const isPtcgBasic = card.supertype === 'Pokemon'
      && card.subtype !== 'Stage1' && card.subtype !== 'Stage2' && card.subtype !== 'Other'
      && !card.evolvesFrom;
    const matches =
      cond === 'basic'
        ? isPtcgBasic
        : isEvolutionCard(card);
    if (!matches) {
      return addLog(state, `${label}：對手不符合條件（${cond === 'basic' ? '基礎' : '進化'}寶可夢），無附加效果`, aIdx);
    }
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], active: { ...def, cantAttackPending: true } };
    return addLog(
      { ...state, players },
      `${label}：${card.name} 在下個對手回合無法使用招式`,
      aIdx,
    );
  };
}

// 鐵臂膀ex｜感激放大 — 120 傷害，若 KO → +1 獎賞卡
regPost('鐵臂膀ex|感激放大', bonusPrizeIfKOPost(1, '感激放大'));

// 鐵包袱｜冷卻噴射 — 80 傷害，若對手為進化寶可夢 → 下回合無法使用招式
regPost('鐵包袱|冷卻噴射', defCantAttackIfSubtypePost('evolved', '冷卻噴射'));

// 帕底亞 肯泰羅｜障礙踩踏 — 90 傷害，若對手為基礎寶可夢 → 下回合無法使用招式
regPost('帕底亞 肯泰羅|障礙踩踏', defCantAttackIfSubtypePost('basic', '障礙踩踏'));

// 轟鳴月ex｜瘋癲攻擊 — KO 對手戰鬥寶可夢，然後自己受 200 傷害
regPre('轟鳴月ex|瘋癲攻擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('轟鳴月ex|瘋癲攻擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  // (1) KO 對手戰鬥寶可夢（如果還在）
  const def = s.players[dIdx];
  if (def.active) {
    const defCard = pool.get(def.active.cardId);
    // v2.92 招式效果免疫檢查（KO 屬招式效果，被擋則跳過 KO；自己仍照常受 200）
    const guardThund = canApplyAttackEffectToTarget(s, aIdx, def.active, defCard, pool);
    if (guardThund.blocked) {
      s = addLog(s, `瘋癲攻擊：${defCard?.name ?? '?'}｜${guardThund.reason}（不昏厥對手）`, aIdx);
    } else {
      const ko: CardInstance[] = [
        { ...def.active, damage: defCard?.hp ?? 0 },
        ...def.active.energyAttached,
        ...getAllAttachedTools(def.active),
        ...(def.active.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(s, def.active, defCard, (1 - dIdx) as 0 | 1, dIdx, pool, false); // 瘋癲攻擊=效果KO
      s = _ko.state;
      const prizes = _ko.prizes;
      const players = [...s.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...def, active: null, discard: [...def.discard, ...ko] };
      s = addLog({ ...s, players }, `瘋癲攻擊：${defCard?.name ?? '?'} 被擊倒！+${prizes} 張獎賞卡`, null);
      s = recordOppKO(s, dIdx, defCard, 'attack');
      s = addPendingPrize(s, aIdx, prizes, pool);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
      }
    }
  }
  // (2) 自己受 200 傷害（若超過 HP → 自爆 KO，對方取獎）
  const players2 = [...s.players] as [PlayerState, PlayerState];
  const att = { ...players2[aIdx] };
  if (att.active) {
    const attCard = pool.get(att.active.cardId);
    const newDmg = att.active.damage + 200;
    const hp = effectiveHPInline(att.active, pool, s);
    if (hp > 0 && newDmg >= hp) {
      // 自爆 KO
      const ko: CardInstance[] = [
        { ...att.active, damage: newDmg },
        ...att.active.energyAttached,
        ...getAllAttachedTools(att.active),
        ...(att.active.evolvedFromStack ?? []),
      ];
      att.active = null;
      att.discard = [...att.discard, ...ko];
      players2[aIdx] = att;
      const prizes = attCard ? koPrizeCount(attCard) : 1;
      s = addLog({ ...s, players: players2 }, `瘋癲攻擊：${attCard?.name ?? '?'} 反噬昏厥！對手將取得 ${prizes} 張獎賞卡`, null);
      // v2.98：累計到 pendingPrizes，由對手 (dIdx) 透過 TAKE_PRIZES 各自取走
      s = addPendingPrize(s, dIdx, prizes, pool);
      if (att.bench.length === 0) {
        return { ...s, phase: 'game-over', winner: dIdx, winReason: `${att.name} 沒有可上場的寶可夢` };
      }
    } else {
      att.active = { ...att.active, damage: newDmg };
      players2[aIdx] = att;
      s = addLog({ ...s, players: players2 }, `瘋癲攻擊：${attCard?.name ?? '?'} 受到 200 傷害`, aIdx);
    }
  }
  return s;
});

// 冰伊布ex｜藍柱石 — 選 1 隻身上放有 ≥6 傷害指示物的對手寶可夢（含出場）→ KO
regPre('冰伊布ex|藍柱石', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('冰伊布ex|藍柱石', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  // 有效目標 = damage >= 60（6 個傷害指示物）
  const heavy = (c: CardInstance): boolean => c.damage >= 60;
  const candidates: CardInstance[] = [];
  if (def.active && heavy(def.active)) candidates.push(def.active);
  for (const b of def.bench) if (heavy(b)) candidates.push(b);
  if (candidates.length === 0) {
    return addLog(state, '藍柱石：對手無受 6 個以上傷害指示物的寶可夢，無效', aIdx);
  }
  if (candidates.length === 1) {
    // 只有一隻符合條件 → 直接 KO，不需 pendingSelection
    const target = candidates[0];
    const isActive = def.active?.iid === target.iid;
    return resolveLanzhushi(state, aIdx, target, isActive, pool);
  }
  // 多個候選 → 以 opp-poke-choose pendingSelection
  let s = addLog(state, `藍柱石：選擇 1 隻身上有 6 個以上傷害指示物的對手寶可夢，將其昏厥`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: dIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'lanzhushi-ko',
    params: { minDamage: 60 },
  });
});

// 藍柱石 resolver 共用：直接 KO target
function resolveLanzhushi(
  state: GameState,
  aIdx: 0 | 1,
  target: CardInstance,
  isActive: boolean,
  pool: Map<string, Card>,
): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  const card = pool.get(target.cardId);
  // v2.92 招式效果免疫檢查（KO 屬招式效果）
  const guardLanz = canApplyAttackEffectToTarget(state, aIdx, target, card, pool);
  if (guardLanz.blocked) {
    return addLog(state, `藍柱石：${card?.name ?? '?'}｜${guardLanz.reason}（不昏厥）`, aIdx);
  }
  const ko: CardInstance[] = [
    { ...target, damage: (card?.hp ?? 0) },
    ...target.energyAttached,
    ...getAllAttachedTools(target),
    ...(target.evolvedFromStack ?? []),
  ];
  const _ko = koPrizesAdjusted(state, target, card, (1 - dIdx) as 0 | 1, dIdx, pool, false); // 藍柱石=依指示物效果KO
  state = _ko.state;
  const prizes = _ko.prizes;
  const players = [...state.players] as [PlayerState, PlayerState];
  const newDef = { ...def, discard: [...def.discard, ...ko] };
  if (isActive) newDef.active = null;
  else newDef.bench = def.bench.filter(b => b.iid !== target.iid);
  players[dIdx] = newDef;
  let s = addLog({ ...state, players }, `藍柱石：${card?.name ?? '?'} 被擊倒！+${prizes} 張獎賞卡`, null);
  s = recordOppKO(s, dIdx, card, 'attack');
  if (isActive && newDef.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: aIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
  }
  return addPendingPrize(s, aIdx, prizes, pool);
}

// v5.485：招式效果「使昏厥」中央 helper（仿 深淵之瞳 / 藍柱石）。
//   「直接使對手寶可夢昏厥」型招式效果(非傷害)統一入口：
//   1. canApplyAttackEffectToTarget 效果免疫判定(化隱/純樸/太晶/阿塞蘿拉/薄霧/化石…) → 擋則不昏厥。
//   2. 直接移除目標 + 附加卡進棄牌(不走 damage 管線/不觸發傷害 hook)。
//   3. prizesForKOLocal(效果KO base 獎賞；古舊能量/影藏只在「招式傷害」昏厥才 -1)。
//   4. recordOppKO + 補位空場 game-over + addPendingPrize 自動發獎。
//   ⚠ 只用於「對手」effect-KO；自損昏厥(高速破壞)用 markFaintByEffect；狀態延遲KO(浸蝕污泥)維持 getEffectiveHP。
// v5.707：對手戰鬥位被 KO(任何方式) → 攻擊方「波克基斯|奇跡之吻」擲幣,正面多 1 獎賞(不重複)。
//   原僅 engine 招式傷害 KO 主管線觸發,效果 KO(放指示物/koTargetByAttackEffect)漏 → 抽共用 helper。
export function applyMiracleKissOnOppActiveKO(state: GameState, attackerIdx: 0 | 1, pool: Map<string, Card>): GameState {
  const owner = state.players[attackerIdx];
  const has = [...(owner.active ? [owner.active] : []), ...owner.bench]
    .some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '奇跡之吻'));
  if (!has) return state;
  const r = flipCoinsWithLog(state, 1, '波克基斯｜奇跡之吻', attackerIdx);
  let s = r.state;
  if (r.heads === 1) {
    s = addLog(s, `「奇跡之吻」啟動：硬幣正面 → 多獲得 1 張獎賞卡`, attackerIdx);
    s = addPendingPrize(s, attackerIdx, 1, pool);
  } else {
    s = addLog(s, `「奇跡之吻」啟動：硬幣反面 → 不增加獎賞卡`, attackerIdx);
  }
  return s;
}

export function koTargetByAttackEffect(
  state: GameState, attackerIdx: 0 | 1, target: CardInstance, isActive: boolean,
  pool: Map<string, Card>, label: string,
): GameState {
  const dIdx = (1 - attackerIdx) as 0 | 1;
  const def = state.players[dIdx];
  const card = pool.get(target.cardId);
  const guard = canApplyAttackEffectToTarget(state, attackerIdx, target, card, pool);
  if (guard.blocked) {
    return addLog(state, `${label}：${card?.name ?? '?'}｜${guard.reason}（不昏厥）`, attackerIdx);
  }
  // v5.707：獎賞走中央 koPrizesAdjusted(koByAttackDamage=false)→脆弱蛻殼0/多餘花粉(deferred)+N 一致;
  //   效果KO 不套道具/古舊能量調整(卡面限「受招式傷害昏厥」)。原 prizesForKOLocal(純count)漏這些。
  const adj = koPrizesAdjusted(state, target, card, attackerIdx, dIdx, pool, false);
  let s = adj.state;
  const prizes = adj.prizes;
  const ko: CardInstance[] = [
    { ...target, damage: (card?.hp ?? 0) },
    ...target.energyAttached,
    ...getAllAttachedTools(target),
    ...(target.evolvedFromStack ?? []),
  ];
  const players = [...s.players] as [PlayerState, PlayerState];
  const newDef = { ...s.players[dIdx], discard: [...s.players[dIdx].discard, ...ko] };
  if (isActive) newDef.active = null;
  else newDef.bench = s.players[dIdx].bench.filter(b => b.iid !== target.iid);
  players[dIdx] = newDef;
  s = addLog({ ...s, players }, `${label}：${card?.name ?? '?'} 被昏厥！+${prizes} 張獎賞卡`, attackerIdx);
  s = recordOppKO(s, dIdx, card, 'attack');
  if (isActive && newDef.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: attackerIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
  }
  s = addPendingPrize(s, attackerIdx, prizes, pool);
  // v5.707：對手戰鬥位被效果KO → attacker 奇跡之吻(卡面「對手戰鬥寶可夢昏厥時」不分傷害/效果)
  if (isActive) s = applyMiracleKissOnOppActiveKO(s, attackerIdx, pool);
  return s;
}

regR('lanzhushi-ko', (st, actorIdx, selectedIids, params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const def = st.players[dIdx];
  const minDmg = Number(params?.minDamage ?? 60);
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const isActive = def.active?.iid === targetIid;
  const target = isActive ? def.active! : def.bench.find(b => b.iid === targetIid);
  if (!target || target.damage < minDmg) return st;
  return resolveLanzhushi(st, actorIdx, target, isActive, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ag v1.83 H 標第 28 波 — 抽卡批次 + 狀態補完 + 自傷 + 其他簡單機制
//
// 不新增機制，大多是把剩下符合現有 helper 的卡牌補齊。
// 1) 抽 N 張（22 張）— reuse drawNPost
// 2) 對手狀態（5 張）— reuse statusPost
// 3) 自己狀態（2 張）— selfStatusPost(status)
// 4) 自傷反動（3 張）— reuse selfHitPost
// 5) 其他：丟競技場 1 張、對手牌庫頂丟 1 張、道具防守回轉
// ══════════════════════════════════════════════════════════════════════════════

// ── (1) 抽 N 張 ─────────────────────────────────────────────────────────────
regPost('貓鼬少|呼喚', drawNPost(1, '呼喚'));
regPost('拉魯拉絲|呼喚', drawNPost(1, '呼喚'));
regPost('木棉球|呼喚', drawNPost(1, '呼喚'));
regPost('瑪沙那|呼喚', drawNPost(1, '呼喚'));
regPost('呱呱泡蛙|呼喚', drawNPost(1, '呼喚'));
regPost('火稚雞|呼喚', drawNPost(1, '呼喚'));
regPost('花椰猴|呼喚', drawNPost(1, '呼喚'));
regPost('冷水猴|呼喚', drawNPost(1, '呼喚'));
regPost('爆香猴|呼喚', drawNPost(1, '呼喚'));
regPost('<阿響的>皮丘|麻麻抽出', drawNPost(1, '麻麻抽出'));
regPost('嗡蝠|快速抽出', drawNPost(1, '快速抽出'));

regPost('超級巨牙鯊ex|貪心之牙', drawNPost(2, '貪心之牙'));
regPost('劈斬司令|快速抽出', drawNPost(2, '快速抽出'));
regPost('瑪機雅娜|扣殺抽出', drawNPost(2, '扣殺抽出'));
regPost('龜腳腳|雙重抽出', drawNPost(2, '雙重抽出'));
regPost('拉帝亞斯|吸引', drawNPost(2, '吸引'));
regPost('象徵鳥|雙重抽出', drawNPost(2, '雙重抽出'));
regPost('胡帕|偷盜', drawNPost(2, '偷盜'));
regPost('貓鼬斬ex|扣殺抽出', drawNPost(2, '扣殺抽出'));
regPost('怒鸚哥|叼', drawNPost(2, '叼'));

regPost('青銅鐘|三重抽出', drawNPost(3, '三重抽出'));
regPost('大王燕|叼', drawNPost(3, '叼'));

regPost('高傲雉雞|叼', drawNPost(4, '叼'));

// ── (2) 對手狀態（補完）─────────────────────────────────────────────────────
regPost('狡猾天狗|蠱惑', statusPost('confused'));
regPost('波爾凱尼恩|灼熱', statusPost('burned'));
regPost('滋汁鼴|毒擊', statusPost('poisoned'));
regPost('蔓藤怪|毒粉', statusPost('poisoned'));
regPost('火炎獅|灼燒', statusPost('burned'));

// ── (3) 自己狀態（攻擊者自身）────────────────────────────────────────────────
export function selfStatusPost(status: SpecialCondition): AttackPostFn {
  return (state, aIdx, pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const attName = pool.get(att.active.cardId)?.name ?? '?';
    const statusLabelMap: Record<string, string> = {
      poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
    };
    // v5.017：補 SPECIAL_ENERGY_STATUS_IMMUNE 免疫 check（泡沫【水】能量 等）
    //   玩家回報：吼鯨王ex（水）附 泡沫【水】能量 後使用「摔落」自身睡眠，
    //   仍進入睡眠狀態 — 因 selfStatusPost 漏檢查（statusPost 對對手有，selfStatusPost 沒有）。
    const immune = checkSpecialEnergyStatusImmune(att.active, status, pool);
    if (immune.immune) {
      return addLog(state, `${attName}｜${immune.energyName}：免疫【${statusLabelMap[status]}】`, aIdx);
    }
    if (isFestivalVenueStatusProtected(state, att.active, pool)) {
      return addLog(state, `${attName}｜祭典會場：免疫【${statusLabelMap[status]}】`, aIdx);
    }
    // v5.017：用 applyStatusToActive 正確處理 status / secondaryStatus 雙格共存（與 statusPost 一致）
    att.active = applyStatusToActive(att.active, status);
    players[aIdx] = att;
    return addLog({ ...state, players }, `${attName} 陷入【${statusLabelMap[status]}】`, aIdx);
  };
}
regPost('卡比獸|倒下', selfStatusPost('asleep'));
regPost('章魚桶|暴走', selfStatusPost('confused'));

// ── (4) 自傷反動（補完）─────────────────────────────────────────────────────
regPost('龍蝦小兵|猛撞', selfHitPost(10));
regPost('鐵掌力士|狂野壓制', selfHitPost(70));
regPost('毒骷蛙|突擊', selfHitPost(20));

// ── (5) 其他單張簡單機制 ────────────────────────────────────────────────────

// 切割洛托姆｜割除利刃 20 — 將場上競技場卡丟棄
regPost('切割洛托姆|割除利刃', discardStadiumPost('割除利刃', false));

// 花岩怪｜崩山 10 — 將對手牌庫頂 1 張丟棄
regPost('花岩怪|崩山', millOppDeckTopPost(1, '崩山'));

// 頓甲｜防守回轉 120 — 自己丟 2 張能量（作為成本）+ 下回合受招式傷害 -100
// 先登 ATTACK_PRE_DISCARD_CHOICE 讓 UI 彈窗，再在 PRE 執行丟棄與傷害，POST 設置減傷旗標
registerSelfDiscardMultiply('頓甲|防守回轉', '防守回轉', 120, 0, 2, 'all', false, 2);  // v5.080: min=2
regPost('頓甲|防守回轉', selfDmgReducePost(100));

// 古劍豹｜冰柱閉環 120 — 選 1 張自身能量放回手牌
regPost('古劍豹|冰柱閉環', returnSelfActiveEnergyPost(1, true, '冰柱閉環'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 29 (v1.84) — 看對手手牌 + 對手手牌丟棄 + 狀態/自傷批次補完
// ══════════════════════════════════════════════════════════════════════════════

// ── (1) 查看對手手牌（新增 3 張）────────────────────────────────────────────
regPre('妙喵|看透', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('妙喵|看透', peekOppHandPost('看透'));

regPre('小貓怪|好奇心', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('小貓怪|好奇心', peekOppHandPost('好奇心'));

regPre('豆豆鴿|偵察', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('豆豆鴿|偵察', peekOppHandPost('偵察'));

// ── (2) 洛托姆｜粉碎脈衝 — 查看對手手牌，將其中「物品」「道具」卡全部丟棄 ─
regPre('洛托姆|粉碎脈衝', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('洛托姆|粉碎脈衝', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  if (p.hand.length === 0) return addLog(state, '粉碎脈衝：對手手牌為空', aIdx);
  const handNames = p.hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `粉碎脈衝：查看對手手牌（${p.hand.length} 張）— ${handNames}`, aIdx);
  const toDiscard = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    // 「物品」= Trainer/Item, 「寶可夢道具」= Pokemon/Other (tool)
    const isItem = card.supertype === 'Trainer' && card.subtype === 'Item';
    const isTool = card.supertype === 'Trainer' && card.subtype === 'PokemonTool';
    return isItem || isTool;
  });
  if (toDiscard.length === 0) {
    return addLog(s, '粉碎脈衝：對手手牌無物品或道具卡', aIdx);
  }
  const discardNames = toDiscard.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const toDiscardIids = new Set(toDiscard.map(c => c.iid));
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...players[dIdx],
    hand: p.hand.filter(c => !toDiscardIids.has(c.iid)),
    discard: [...p.discard, ...toDiscard],
  };
  return addLog({ ...s, players }, `粉碎脈衝：將對手 ${toDiscard.length} 張物品/道具卡丟棄 — ${discardNames}`, aIdx);
});

// ── (3) statusPost 批次補完 ─────────────────────────────────────────────────
// 混亂類
regPost('光電傘蜥|閃光彈', statusPost('confused'));
regPost('火箭隊的大嘴蝠|奇異之光', statusPost('confused'));
regPost('超能妙喵|蠱惑', statusPost('confused'));
regPost('超音蝠|超音波', statusPost('confused'));
regPost('死神棺|蠱惑', statusPost('confused'));
regPost('花舞鳥|眩目舞', statusPost('confused'));
regPost('音波龍|恐慌嚎鳴', statusPost('confused'));
regPost('火箭隊的貓老大ex|殘酷斬', statusPost('confused'));
regPost('雙彈瓦斯|充滿瓦斯', statusPost('confused'));

// 中毒類
regPost('天蠍|毒擊', statusPost('poisoned'));
regPost('鉗尾蠍|毒擊', statusPost('poisoned'));
regPost('火箭隊的超音蝠|噴毒', statusPost('poisoned'));
regPost('<莉佳的>臭臭花|噴毒', statusPost('poisoned'));
regPost('哎呀球菇|毒之孢子', statusPost('poisoned'));
regPost('灰塵山|垃圾射擊', statusPost('poisoned'));
regPost('火箭隊的小拉達|險惡門牙', statusPost('poisoned'));
regPost('百足蜈蚣|噴毒', statusPost('poisoned'));

// 睡眠類
regPost('超級雪妖女ex|純粹雪', statusPost('asleep'));
regPost('冰雪龍|冰凍之風', statusPost('asleep'));
regPost('派拉斯特|蘑菇孢子', statusPost('asleep'));
regPost('火箭隊的催眠貘|催眠光線', statusPost('asleep'));
regPost('夢夢蝕|睡眠波動', statusPost('asleep'));

// 灼傷類
regPost('六尾|灼熱', statusPost('burned'));
regPost('炒炒豬|火焰灼燒', statusPost('burned'));
regPost('達摩狒狒|灼燒', statusPost('burned'));
regPost('厄鬼椪 火灶面具|灼燒', statusPost('burned'));
regPost('加熱洛托姆|灼熱', statusPost('burned'));

// ── (4) 自傷反動批次補完（selfHitPost）────────────────────────────────────
regPost('落雷獸|電流攻擊', selfHitPost(10));
regPost('墓仔狗|猛撞', selfHitPost(10));
regPost('萊希拉姆|燃燒閃焰', selfHitPost(60));
regPost('帕底亞 肯泰羅|捨身衝撞', selfHitPost(20));
regPost('利牙魚|突擊', selfHitPost(10));
regPost('火箭隊的團珠蛛|猛撞', selfHitPost(10));
regPost('火箭隊的椰蛋樹|捨身衝撞', selfHitPost(30));
regPost('頑皮熊貓|突擊', selfHitPost(10));
regPost('仆斬將軍|雙刃斬', selfHitPost(50));
regPost('赫普的卡比獸|極限壓制', selfHitPost(80));
regPost('藤藤蛇|突擊', selfHitPost(10));
regPost('小拉達|猛撞', selfHitPost(10));
regPost('泡沫栗鼠|猛撞', selfHitPost(10));
regPost('<莉佳的>走路草|突擊', selfHitPost(10));
regPost('烈焰馬|猛火猛撞', selfHitPost(30));
regPost('超級炎武王ex|深紅炸彈', selfHitPost(60));
regPost('小鋸鱷|撞一下', selfHitPost(10));
regPost('阿羅拉 隆隆岩|百萬噸墜落', selfHitPost(40));
regPost('固拉多|百萬噸墜落', selfHitPost(30));
// v2.22：訓練家寶可夢卡名統一 strip 掉 <> 冠名（pool.ts loadSet 會 normalize）
regPost('派帕的原野水母|撞一下', selfHitPost(10));
regPost('派帕的陸地水母|突擊', selfHitPost(30));
regPost('瑪俐的頭巾混混|狂野衝撞', selfHitPost(30));
regPost('索羅亞|猛撞', selfHitPost(10));
regPost('下石鳥|突擊', selfHitPost(20));
regPost('騎士蝸牛|狂野槍', selfHitPost(30));
regPost('伽勒爾 泥巴魚|飛撲啃咬', selfHitPost(30));
regPost('寶貝龍|突擊', selfHitPost(10));
regPost('故勒頓ex|凱撒衝撞', selfHitPost(60));
regPost('貓鼬斬ex|狂野剪', selfHitPost(30));
regPost('<青木的>勇士雄鷹|勇鳥猛攻', selfHitPost(30));
regPost('刺梭魚|突擊', selfHitPost(10));
regPost('沙基拉斯|猛撞', selfHitPost(20));

// ── (5) Mill 對手牌庫補完 ───────────────────────────────────────────────────
regPost('超級赫拉克羅斯ex|推山', millOppDeckTopPost(2, '推山'));
regPost('鐵骨土人|臂錘', millOppDeckTopPost(1, '臂錘'));
regPost('厄鬼椪 礎石面具|推山', millOppDeckTopPost(1, '推山'));
regPost('火箭隊的幼基拉斯|嚼山', millOppDeckTopPost(1, '嚼山'));
regPost('班基拉斯|斷裂頓足', millOppDeckTopPost(2, '斷裂頓足'));

// ── (6) 自己 mill（將自己的牌庫頂 N 張丟棄）─ 沿用既有 millSelfDeckTopPost ─
regPost('黏美龍|龍之波動', millSelfDeckTopPost(1, '龍之波動'));


// ══════════════════════════════════════════════════════════════════════════════
// Wave 30 (v1.85) — 補完現有 helper 套用 + 新增 helpers（單一/條件/能量×倍率）
// ══════════════════════════════════════════════════════════════════════════════

// ── (A) 既有 coin helper 補完 ───────────────────────────────────────────────
// coinPlusDmg(base, bonus) — 擲 1 次硬幣若正面 +N
regPre('來電汪|嬉鬧', coinPlusDmg(20, 20));

// coinHeadsMultiplyPre(flips, perHead, label)
regPre('變澀蜥|二連撞', coinHeadsMultiplyPre(2, 30, '二連撞'));
regPre('跳跳豬|三重旋轉', coinHeadsMultiplyPre(3, 10, '三重旋轉'));

// coinTailsFailPre(base, label)
regPre('炎兔兒|踹', coinTailsFailPre(30, '踹'));

// coinUntilTailsMultiplyPre(perHead, base, label)
regPre('胖丁|滾球', coinUntilTailsMultiplyPre(20, 0, '滾球'));
regPre('無畏小子|叩叩打擊', coinUntilTailsMultiplyPre(30, 10, '叩叩打擊'));

// coinHeadsSelfImmuneNextPost(label) — 0 dmg + 正面則自己下回合免疫
regPre('銅鏡怪|鐵壁', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('銅鏡怪|鐵壁', coinHeadsSelfImmuneNextPost('鐵壁', 'damage'));

// ── (B) registerSelfDiscardMultiply 補完（自身丟能量為 cost） ─────────────
// 千面避役｜水射擊 110 — 丟 1 自身能量（cost）
registerSelfDiscardMultiply('千面避役|水射擊', '水射擊', 110, 0, 1, 'all', false, 1);  // v5.080: min=1

// 超級噴火駝ex｜火山流星 280 — 丟 2 自身能量
registerSelfDiscardMultiply('超級噴火駝ex|火山流星', '火山流星', 280, 0, 2, 'all', false, 2);  // v5.080: min=2

// v5.394：以下 4 張卡面「選擇 2 個能量丟棄」，原走 selfDiscardNEnergyPost(v2500/v2640) 按「張」計且無 picker。
//   改走此 helper：per=0 → 自動 countMode='units'(燃火/火箭隊等特殊能量算多個) + picker(可自選)。
//   已從 v2500 SELF_DISC_N / v2640 DISCARD_N 移除，避免殘留 regPost 造成 double-discard(同火山流星教訓)。
registerSelfDiscardMultiply('蓋歐卡|漩渦波', '漩渦波', 130, 0, 2, 'all', false, 2);
registerSelfDiscardMultiply('噴火駝|力量踩踏', '力量踩踏', 170, 0, 2, 'all', false, 2);
registerSelfDiscardMultiply('象牙豬|暴雪刀鋒', '暴雪刀鋒', 200, 0, 2, 'all', false, 2);
registerSelfDiscardMultiply('達摩狒狒|粉碎頭擊', '粉碎頭擊', 180, 0, 2, 'all', false, 2);

// v5.395：再補完所有「選擇 N 個能量丟棄」(純 cost)→ units+picker。原走 selfDiscardNEnergyPost(v2500/v2620)。
registerSelfDiscardMultiply('伽勒爾 堵攔熊|龐克粉碎', '龐克粉碎', 160, 0, 1, 'all', false, 1);
registerSelfDiscardMultiply('火箭隊的黑魯加|燃燒殆盡', '燃燒殆盡', 120, 0, 1, 'all', false, 1);
registerSelfDiscardMultiply('舞天鵝|空氣斬', '空氣斬', 120, 0, 1, 'all', false, 1);
registerSelfDiscardMultiply('雷電雲|災難伏特', '災難伏特', 110, 0, 1, 'all', false, 1);
registerSelfDiscardMultiply('卡璞・鳴鳴|雷電爆破', '雷電爆破', 130, 0, 2, 'all', false, 2);
registerSelfDiscardMultiply('巨炭山|巨體碰撞', '巨體碰撞', 220, 0, 3, 'all', false, 3);

// v5.398：批次轉換「選擇 N 個能量丟棄」(純 cost) → units + picker。
//   原走 selfDiscardNEnergyPost(按張數、無 picker)。傷害值取自卡面 JSON(已逐張核對)。
//   表欄位：[key, 招式名, 傷害, N(=min=max), 屬性filter('all'/'Grass'/'Fire'...)]
const SELF_DISCARD_UNITS_BATCH: Array<[string, string, number, number, DiscardMultiplyFilter]> = [
  // n=1
  ['四季鹿|落葉衝撞', '落葉衝撞', 40, 1, 'Grass'],
  ['捷拉奧拉|強力伏特', '強力伏特', 120, 1, 'all'],
  ['猛火猴|高溫打擊', '高溫打擊', 80, 1, 'all'],
  ['烈焰猴|燃燒殆盡', '燃燒殆盡', 200, 1, 'all'],
  ['冰鬼護|瘋狂頭', '瘋狂頭', 140, 1, 'all'],
  ['大電海燕|強力伏特', '強力伏特', 100, 1, 'all'],
  ['晶光芽|岩石射擊', '岩石射擊', 30, 1, 'all'],
  ['夜盜火蜥|火花', '火花', 30, 1, 'all'],
  ['焰后蜥|噴射火焰', '噴射火焰', 130, 1, 'all'],
  ['炭小侍|噴射火焰', '噴射火焰', 70, 1, 'all'],
  ['請假王ex|偉大橫掃', '偉大橫掃', 280, 1, 'all'],
  ['尖牙陸鯊|力量爆破', '力量爆破', 50, 1, 'all'],
  ['阿響的火球鼠|火花', '火花', 30, 1, 'all'],
  // n=2
  ['鐵磐岩ex|力量踩踏', '力量踩踏', 200, 2, 'all'],
  ['巨金怪|潔淨爆破', '潔淨爆破', 200, 2, 'all'],
  ['煤炭龜|火焰旋渦', '火焰旋渦', 110, 2, 'all'],
  ['爬地翅|粉碎之翼', '粉碎之翼', 130, 2, 'all'],
  ['長毛巨魔|擊拳', '擊拳', 160, 2, 'all'],
  ['鋁鋼龍|鋁鋼光束', '鋁鋼光束', 130, 2, 'all'],
  ['爆炸頭水牛|粉碎頭擊', '粉碎頭擊', 150, 2, 'all'],
  ['古劍豹|氣忿利刃', '氣忿利刃', 130, 2, 'all'],
  // n=3
  ['皮卡丘ex|黃玉伏特', '黃玉伏特', 300, 3, 'all'],
  // v5.399：批次2 — v2620/v2740/v2750/v3700 的「選擇N個能量丟棄」
  ['暴飛龍ex|狂龍衝擊', '狂龍衝擊', 300, 2, 'all'],
  ['顫弦蠑螈ex|刷弦閃電', '刷弦閃電', 240, 2, 'all'],
  ['燈火幽靈|大字爆炎', '大字爆炎', 50, 1, 'all'],
  ['紅蓮鎧騎ex|鎧農炮', '鎧農炮', 200, 1, 'Fire'],
  ['萊希拉姆ex|燃燒殆盡', '燃燒殆盡', 200, 1, 'all'],
  ['蓋歐卡ex|潮汐巨浪', '潮汐巨浪', 230, 2, 'all'],
  ['花舞鳥|花火', '花火', 30, 1, 'all'],
  ['噴火龍ex|爆焰旋渦', '爆焰旋渦', 330, 3, 'all'],
  // v5.401：B類2張(丟能量+狙擊)——丟能量改units+picker,狙擊效果留在各card檔的 regPost
  ['火焰雞|業火連踢', '業火連踢', 120, 2, 'all'],
  ['雙尾怪手|雙尾', '雙尾', 0, 2, 'all'],
  // v5.499：自身丟能量改 picker（原 inline discardOwnNEnergyFn/discardActiveEnergies/單卡自動丟最後N張，
  //   玩家無法選；卡面「選擇N個這隻寶可夢身上附加的能量丟棄」應由玩家選）。移除各 card 檔 inline reg。
  ['長尾火狐|噴射火焰', '噴射火焰', 80, 1, 'all'],
  ['雷丘|強力伏特', '強力伏特', 150, 1, 'Lightning'],  // 卡面限【雷】能量（原 inline 沒過濾屬性，順手修）
  ['倫琴貓|強力伏特', '強力伏特', 200, 2, 'all'],
  ['頓甲|粉碎頭擊', '粉碎頭擊', 180, 2, 'all'],
  ['鳳王|紅蓮之翼', '紅蓮之翼', 130, 1, 'Fire'],  // 卡面限【火】能量
  ['大朝北鼻|鼻衝撞', '鼻衝撞', 260, 3, 'all'],
  ['火恐龍|大字爆炎', '大字爆炎', 90, 1, 'all'],
];
for (const [key, label, dmg, n, tf] of SELF_DISCARD_UNITS_BATCH) {
  registerSelfDiscardMultiply(key, label, dmg, 0, n, tf, false, n);
}

// 鋼炮臂蝦｜水之發射器 210 — 丟所有自身能量
registerSelfDiscardMultiply('鋼炮臂蝦|水之發射器', '水之發射器', 210, 0, 99, 'all', true);  // v5.080: forceAll=true 卡面「全部丟棄」

// 雷吉艾斯ex｜冰之牢籠 140 — 丟 2 自身能量 + 對手【麻痺】
registerSelfDiscardMultiply('雷吉艾斯ex|冰之牢籠', '冰之牢籠', 140, 0, 2, 'all', false, 2);  // v5.080: min=2
regPost('雷吉艾斯ex|冰之牢籠', statusPost('paralyzed'));

// ── (C) selfHealPost 補完 ────────────────────────────────────────────────
// 超級妙蛙花ex｜叢林拋擲 240 + 自癒 30
regPost('超級妙蛙花ex|叢林拋擲', selfHealPost(30, '叢林拋擲'));

// 麻麻小魚｜紋絲不動 0 + 自癒 10
regPre('麻麻小魚|紋絲不動', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('麻麻小魚|紋絲不動', selfHealPost(10, '紋絲不動'));

// ── (D) statusPost 多狀態（取主要狀態） ─────────────────────────────────
// 霸王花｜花粉炸彈（卡面：中毒與睡眠）— 逐狀態走中央 applyStatusToOppActive，不再只套中毒。
regPost('霸王花|花粉炸彈', (state, aIdx, pool) => {
  let s = applyStatusToOppActive(state, aIdx, 'poisoned', pool, { kind: 'attack-effect', label: '花粉炸彈' });
  s = applyStatusToOppActive(s, aIdx, 'asleep', pool, { kind: 'attack-effect', label: '花粉炸彈' });
  return s;
});

// ── (E) oppDiscardRandomHand / oppSwapDmgPost / discardOppActiveEnergyPost ──
// 滑滑小子｜拍落 20 + 對手手牌隨機丟 1
regPost('滑滑小子|拍落', oppDiscardRandomHand(1, '拍落'));

// 皮皮｜看我嘛 0 + 選對手備戰 1 隻與戰鬥場互換（無傷）
regPre('皮皮|看我嘛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('皮皮|看我嘛', oppSwapDmgPost(0, '看我嘛'));

// 鋁鋼龍｜破壞光線 70 + 丟對手戰鬥能量 1 張
regPost('鋁鋼龍|破壞光線', discardOppActiveEnergyPost('破壞光線', 'any'));

// ── (F) selfSwapPost / selfDmgReducePost / selfCantAttackNextPost ──────
// 鐵面忍者｜急速折返 90 + 自己換場
regPost('鐵面忍者|急速折返', selfSwapPost('急速折返'));

// 椰蛋樹｜防守壓制 30 + 下次受傷 -30
regPost('椰蛋樹|防守壓制', selfDmgReducePost(30));

// 巨石丁｜潛力 140 + 自己下回合無法使用招式
regPost('巨石丁|潛力', selfCantAttackNextPost());

// 妙蛙種子｜束縛 10 + 對手下回合無法撤退
regPost('妙蛙種子|束縛', defCantRetreatNextPost());

// ── (G) defIsExPre — 對手為 ex/V → +N ──────────────────────────────────
regPre('火焰鳥|鬥志之翼', defIsExPre(20, 90, '鬥志之翼'));

// ── (H) deck-search 補完 ────────────────────────────────────────────────
// 炭小侍｜集力 0 + 從牌庫選最多 2 張基本能量加手牌
regPre('炭小侍|集力', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('炭小侍|集力', deckSearchToHandPost(2, 'BasicEnergy', '集力'));

// 呆火駝｜呼朋引伴 0 + 從牌庫選最多 2 隻基礎寶可夢放備戰
regPre('呆火駝|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('呆火駝|呼朋引伴', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '呼朋引伴：牌庫為空', aIdx);
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const limit = getOwnBenchLimit(state, aIdx, pool);
  if (p.bench.length >= limit) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  const s = addLog(state, '呼朋引伴：從牌庫選最多 2 隻基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: Math.min(2, limit - p.bench.length),
    effectKey: 'bench-basic-from-deck',
  });
});

// ── (I) 條件式 +N 傷害（其他）──────────────────────────────────────────
// 火箭隊的尼多力諾｜角裂 60 + 若對手有傷害指示物 +60
regPre('火箭隊的尼多力諾|角裂', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def && def.damage > 0) {
    return { state: addLog(state, '角裂：對手帶傷 → +60', aIdx), damage: 120 };
  }
  return { state, damage: 60 };
});

// N的萊希拉姆｜強力激怒 — 自身傷害指示物數 × 20（damage / 10 = 指示物數）
regPre('N的萊希拉姆|強力激怒', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  const counters = att ? Math.floor(att.damage / 10) : 0;
  const dmg = counters * 20;
  const s = addLog(state, `強力激怒：自身傷害指示物 ${counters} × 20 → ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 迷唇姐｜精神強念 — 對手戰鬥寶可夢能量數 × 30
// v4.959：用 host-aware unit count（新衝天能量 on Stage2 = 2）
regPre('迷唇姐|精神強念', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const energyCount = def ? countAttachedEnergyAsUnits(def, pool) : 0;
  const dmg = 30 + energyCount * 30;
  const s = addLog(state, `精神強念：對手能量 ${energyCount} × 30 → ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ── (J) coin + 既有 helper 組合 ────────────────────────────────────────
// 大岩蛇｜綁緊 30 + 擲硬幣正面則對手【麻痺】
regPost('大岩蛇|綁緊', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '綁緊', aIdx);
  if (!r.heads) return addLog(r.state, '綁緊：反面 → 無附加效果', aIdx);
  return statusPost('paralyzed')(addLog(r.state, '綁緊：正面 → 對手【麻痺】', aIdx), aIdx, pool);
});

// 破破袋｜酸液炸彈 10 + 擲硬幣正面則丟對手戰鬥 1 張能量
regPost('破破袋|酸液炸彈', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '酸液炸彈', aIdx);
  if (!r.heads) return addLog(r.state, '酸液炸彈：反面 → 無附加效果', aIdx);
  return discardOppActiveEnergyPost('酸液炸彈', 'any')(addLog(r.state, '酸液炸彈：正面 → 丟對手能量', aIdx), aIdx, pool);
});

// ── (K) 抽卡到 6 張 ──────────────────────────────────────────────────
// 狐大盜｜貪慾狩獵 20 + 從牌庫抽到手牌滿 6
regPost('狐大盜|貪慾狩獵', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '貪慾狩獵：選擇「否」 — 跳過抽牌', aIdx);
  const _cb: AttackPostFn = (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const need = Math.max(0, 6 - p.hand.length);
  if (need === 0) return addLog(state, '貪慾狩獵：手牌已滿 6 張', aIdx);
  const drawn = Math.min(need, p.deck.length);
  if (drawn === 0) return addLog(state, '貪慾狩獵：牌庫為空', aIdx);
  const s = addLog(state, `貪慾狩獵：抽到手牌滿 6（補 ${drawn} 張）`, aIdx);
  return drawCards(s, aIdx, drawn);
};
  return _cb(state, aIdx, pool);
});


// ══════════════════════════════════════════════════════════════════════════════
// Wave 31 (v1.86) — 抽到 N + 牌庫搜 Item/Tool/Supporter + 同名群聚 + 手牌附能
//                 + 對手 ex snipe + 先丟對手道具 + 多目標 + 單目標 snipe
// ══════════════════════════════════════════════════════════════════════════════

// ── Helper: drawToHandPost — 從牌庫抽卡直到手牌滿 N ────────────────────────
function drawToHandPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    const need = Math.max(0, n - p.hand.length);
    if (need === 0) return addLog(state, `${label}：手牌已滿 ${n} 張`, aIdx);
    const drawn = Math.min(need, p.deck.length);
    if (drawn === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：抽到手牌滿 ${n}（補 ${drawn} 張）`, aIdx);
    return drawCards(s, aIdx, drawn);
  };
}

// ── Helper: handAttachEnergyPost — 從手牌選基本能量附於自己場上寶可夢 ────
// typeFilter=null 不限屬性；max=99 表示不限上限
function handAttachEnergyPost(
  max: number,
  typeFilter: EnergyType | null,
  label: string,
): AttackPostFn {
  // v3.12 升級：原本只支援單一目標寶可夢接收（多目標也是全附給同一隻）。
  // 現透過 v158-energy-chain-start resolver 將「source: hand」能量分配到自方任意寶可夢，
  // 場上 1 隻自動全附；多隻同類型 → +/- 計數器 UI；多隻混合屬性 → 逐張 picker。
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.hand.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && !energyMatchesType(card, typeFilter as EnergyType)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：手牌沒有符合的基本能量`, aIdx);
    const realMax = Math.min(max, cand.length);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從手牌選最多 ${realMax} 張基本能量`, aIdx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr,
      // v3.12: minCount=0 改為符合卡面允許「不選」的彈性（艾姆利多/熱帶狂燒/幸運貼附）
      minCount: 0, maxCount: realMax,
      effectKey: 'v158-energy-chain-start',
      params: {
        label,
        source: 'hand',
        scope: 'any-own',
        validIids: cand.map(c => c.iid),
      },
    });
  };
}

// ── Helper: deckSameNameBenchPost — 從牌庫選最多 N 張「同名卡」放備戰 ─────
// v4.941：filter 'Basic' → 'Basic:SameName' — 原 'Basic' picker UI 沒讀 params.validIids，
//   顯示所有基礎寶可夢（規則違反）；新 filter 用 params.targetName 限定只顯示同名卡。
// v5.085：filter 名稱保留 'Basic:SameName' 向後相容，但 UI 已拿掉 isBasicPokemonCard
//   限制 — 蟲電寶|並排（蟲電寶 Stage1）+ 一家鼠|家族行軍（一家鼠 Stage1）卡面寫
//   「放置於備戰區」是規則例外，允許直接放 Stage1+ 同名卡到備戰（卡牌效果優先於
//   「備戰只能放基礎」通則）。語意上更接近 'Pokemon:SameName'，但 rename 影響範圍
//   大（4 處 callsites + UI），先用註解標明語意演化。
function deckSameNameBenchPost(max: number, cardName: string, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    // v5.041：bench limit 改 getBenchLimit (5→8)
    const limit = getOwnBenchLimit(state, aIdx, pool);
    if (p.bench.length >= limit) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const cand = p.deck.filter(c => pool.get(c.cardId)?.name === cardName);
    if (cand.length === 0) return openDeckViewReshuffle(state, aIdx, label); // v5.496：仍開檢視 picker
    const slots = Math.min(max, limit - p.bench.length, cand.length);
    const s = addLog(state, `${label}：從牌庫選最多 ${slots} 張「${cardName}」放備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Basic:SameName', minCount: 0, maxCount: slots,
      effectKey: 'bench-basic-from-deck',
      params: {
        validIids: cand.map(c => c.iid),
        targetName: cardName,
        titleOverride: `${label}：從牌庫選最多 ${slots} 張「${cardName}」放備戰`,
      },
    });
  };
}

// ── Helper: discardSameNameBenchPost — 從棄牌區選最多 N 張「同名卡」放備戰 ─
function discardSameNameBenchPost(max: number, cardName: string, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    // v5.041：bench limit 改 getBenchLimit (5→8)
    const limit = getOwnBenchLimit(state, aIdx, pool);
    if (p.bench.length >= limit) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const cand = p.discard.filter(c => pool.get(c.cardId)?.name === cardName);
    if (cand.length === 0) return addLog(state, `${label}：棄牌區無「${cardName}」`, aIdx);
    const slots = Math.min(max, limit - p.bench.length, cand.length);
    const s = addLog(state, `${label}：從棄牌區選最多 ${slots} 張「${cardName}」放備戰`, aIdx);
    return withPending(s, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon', minCount: 0, maxCount: slots,
      effectKey: 'bench-from-discard-samename',
      params: { validIids: cand.map(c => c.iid), targetName: cardName, label },
    });
  };
}
regR('bench-from-discard-samename', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '同名回備戰';
  const targetName = (params?.targetName as string) ?? '';
  const p = st.players[idx];
  const picked = p.discard.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(st, `${label}：未選擇`, idx);
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const slots = getOwnBenchLimit(st, idx, pool) - p.bench.length;
  const take = picked.slice(0, slots).map(c => ({ ...c, damage: 0, energyAttached: [], justPlaced: true } as CardInstance));
  const names = take.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(st, `${label}：從棄牌區放置 ${take.length} 張「${targetName}」到備戰（${names}）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    bench: [...pl.bench, ...take.map(placedBenchInstance)],
    discard: pl.discard.filter(c => !take.some(t => t.iid === c.iid)),
  }));
});

// ── Helper: snipeAllOppExPost — 對手所有 ex/V 各 N 傷害（不計弱抵與附加效果）
function snipeAllOppExPost(dmg: number, filterType: 'ex' | 'ex-or-v', label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    const all = [d.active, ...d.bench].filter((c): c is CardInstance => !!c);
    const targetIids = all.filter(c => {
      const card = pool.get(c.cardId);
      if (!card) return false;
      if (isExCard(card)) return true;
      if (filterType === 'ex-or-v' && (card.name.endsWith('V') || card.name.endsWith('VMAX'))) return true;
      return false;
    }).map(c => c.iid);
    if (targetIids.length === 0) return addLog(state, `${label}：對手場上無 ex 寶可夢`, aIdx);
    let s = addLog(state, `${label}：對手 ${targetIids.length} 隻 ex 寶可夢各 ${dmg} 傷害`, aIdx);
    // v5.434：改走中央 dealAttackDamageToTarget（補免疫 guard：太晶/神秘石居/中立中心/對戰圓形等）。
    //   noWeakness=true：卡面「這個招式的傷害不計算弱點・抵抗力」→ 整招 flat（含 active ex）。
    for (const iid of targetIids) {
      s = dealAttackDamageToTarget(s, aIdx, iid, dmg, pool, { kind: 'attack-damage', noWeakness: true, label });
      if (s.phase === 'game-over') return s;
    }
    return s;
  };
}

// ── Helper: defToolDiscardPre — 攻擊前丟對手戰鬥寶可夢道具卡 ──────────────
function defToolDiscardPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    // v3.20 多重轉接：丟第 1 張可用的道具（無論在 toolAttached 還是 extraTools）
    const allDefTools = def ? getAllAttachedTools(def) : [];
    if (!def || allDefTools.length === 0) {
      return { state: addLog(state, `${label}：對手戰鬥寶可夢無道具`, aIdx), damage: base };
    }
    const defCardForGuard = pool.get(def.cardId);
    const guard = canApplyEffectToTarget(state, aIdx, def, defCardForGuard, 'attack-effect', pool);
    if (guard.blocked) {
      const dName = pool.get(def.cardId)?.name ?? '?';
      return {
        state: addLog(state, `${label}：${dName}｜${guard.reason}（不丟道具，傷害正常造成）`, aIdx),
        damage: base,
      };
    }
    const discarded = allDefTools[0];
    const toolName = pool.get(discarded.cardId)?.name ?? '?';
    const defName = pool.get(def.cardId)?.name ?? '?';
    let s = addLog(state, `${label}：丟棄 ${defName} 的道具「${toolName}」`, aIdx);
    s = updatePlayer(s, dIdx, pl => {
      if (!pl.active) return pl;
      let newAct = pl.active;
      if (newAct.toolAttached?.iid === discarded.iid) {
        newAct = { ...newAct, toolAttached: undefined };
      } else if (newAct.extraTools) {
        newAct = { ...newAct, extraTools: newAct.extraTools.filter(x => x.iid !== discarded.iid) };
      }
      return { ...pl, active: newAct, discard: [...pl.discard, discarded] };
    });
    return { state: s, damage: base };
  };
}

// ── Helper: damagedMultiSnipePost — 對手身上有傷害指示物的 N 隻各 D 傷害 ──
function damagedMultiSnipePost(targetCount: number, dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    const all = [d.active, ...d.bench].filter((c): c is CardInstance => !!c);
    const damaged = all.filter(c => c.damage > 0);
    if (damaged.length === 0) return addLog(state, `${label}：對手場上無帶傷寶可夢`, aIdx);
    const realMax = Math.min(targetCount, damaged.length);
    const s = addLog(state, `${label}：選擇對手 ${realMax} 隻「帶傷」寶可夢各 ${dmg} 傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: realMax,
      effectKey: 'snipe-multi',
      params: { damage: dmg, label, validIids: damaged.map(c => c.iid) },
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Wave 31 招式登記
// ══════════════════════════════════════════════════════════════════════════════

// ── (A) 抽到 N 張 ──────────────────────────────────────────────────────────
regPre('狙射樹梟|羽毛庫存', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('狙射樹梟|羽毛庫存', drawToHandPost(7, '羽毛庫存'));

// v5.509：抽牌移到 regPre（傷害前）— 氣絕拿獎(自動進手牌)若在抽牌前會少抽1張，故先補滿手牌再結算傷害/氣絕/拿獎。
regPre('霓虹魚|報恩', (state, aIdx, pool, action) => {
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return { state: addLog(state, '報恩：選擇「否」 — 跳過抽牌', aIdx), damage: 20 };
  return { state: drawToHandPost(6, '報恩')(state, aIdx, pool), damage: 20 };
});

// v5.509：抽牌移到 regPre（傷害前）— 氣絕拿獎(自動進手牌)若在抽牌前會少抽1張，故先補滿手牌再結算傷害/氣絕/拿獎。
regPre('幸福蛋ex|報恩', (state, aIdx, pool, action) => {
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return { state: addLog(state, '報恩：選擇「否」 — 跳過抽牌', aIdx), damage: 180 };
  return { state: drawToHandPost(6, '報恩')(state, aIdx, pool), damage: 180 };
});

// ── (B) 牌庫搜 Item / Supporter（需搭配 UI 新 filter） ────────────────────
regPre('海地鼠|挖到寶', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('海地鼠|挖到寶', deckSearchToHandPost(1, 'Item', '挖到寶'));

regPre('海刺龍|援軍', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('海刺龍|援軍', deckSearchToHandPost(3, 'Pokemon', '援軍'));

regPre('超音蝠|引路', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('超音蝠|引路', deckSearchToHandPost(1, 'Supporter', '引路'));

// ── (C) 棄牌區能量附加 ──────────────────────────────────────────────────
regPre('莫魯貝可|撿拾附上', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('莫魯貝可|撿拾附上', discardEnergyAttachPost(2, null, '撿拾附上'));

// ── (D) 單目標 + 多目標 snipe ──────────────────────────────────────────
regPre('月亮伊布|出奇一擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('月亮伊布|出奇一擊', multiSnipePost(1, 50, '出奇一擊'));

regPre('鐵頭殼ex|雙刃劍', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('鐵頭殼ex|雙刃劍', multiSnipePost(2, 50, '雙刃劍'));

// 鐵脖頸|自動導向頭擊 — 對手 3 隻有傷害指示物各 50
regPre('鐵脖頸|自動導向頭擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('鐵脖頸|自動導向頭擊', damagedMultiSnipePost(3, 50, '自動導向頭擊'));

// ── (E) 同名群聚（牌庫搜同名） ────────────────────────────────────────
regPre('強顎雞母蟲|群聚', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('強顎雞母蟲|群聚', deckSameNameBenchPost(2, '強顎雞母蟲', '群聚'));

regPre('一家鼠|家族行軍', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('一家鼠|家族行軍', deckSameNameBenchPost(2, '一家鼠', '家族行軍'));

regPre('蟲電寶|並排', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('蟲電寶|並排', deckSameNameBenchPost(3, '蟲電寶', '並排'));

regPre('呱呱泡蛙|群聚', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('呱呱泡蛙|群聚', deckSameNameBenchPost(2, '呱呱泡蛙', '群聚'));

// ── (F) 同名群聚（棄牌區搜同名） ──────────────────────────────────────
regPre('夜巡靈|前往渡魂', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('夜巡靈|前往渡魂', discardSameNameBenchPost(3, '夜巡靈', '前往渡魂'));

// ── (G) 手牌附能（基本能量從手牌） ────────────────────────────────────
regPre('艾姆利多|滿載心田', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('艾姆利多|滿載心田', handAttachEnergyPost(2, 'Psychic', '滿載心田'));

regPre('固拉多|充溢之力', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('固拉多|充溢之力', handAttachEnergyPost(1, 'Fighting', '充溢之力'));

regPre('吉利蛋|幸運貼附', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('吉利蛋|幸運貼附', handAttachEnergyPost(1, null, '幸運貼附'));

regPre('阿羅拉 椰蛋樹ex|熱帶狂燒', (state, _aIdx, _pool) => ({ state, damage: 150 }));
regPost('阿羅拉 椰蛋樹ex|熱帶狂燒', handAttachEnergyPost(99, null, '熱帶狂燒'));

// ── (H) 對手所有 ex/V snipe ─────────────────────────────────────────
regPre('水伊布ex|重磅驟雨', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('水伊布ex|重磅驟雨', snipeAllOppExPost(60, 'ex', '重磅驟雨'));

regPre('沙漠蜻蜓ex|橄欖石音波', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('沙漠蜻蜓ex|橄欖石音波', snipeAllOppExPost(100, 'ex-or-v', '橄欖石音波'));

// ── (I) 攻擊前丟對手道具 ────────────────────────────────────────────
regPre('金魚王|啄落', defToolDiscardPre(50, '啄落'));
regPre('破破舵輪|破壞船錨', defToolDiscardPre(80, '破壞船錨'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ak v1.87 H 標第 32 波 — 棄牌到手牌/備戰 + 手牌附能+heal + 自牌庫找基本能量附自 + 手牌 tool×damage + 先丟附加能量 + 條件進化
//
// 新 Helper:
//   • discardSearchToHandPost(max, filter, label) — 從棄牌區選最多 N 張 X 加手牌（重用 discard-to-hand resolver）
//   • deckEnergyAttachSelfPost(typeFilter, label) — 從牌庫選 1 張基本能量附於自己，重洗
//   • selfActiveHandAttachHealPost(heal, label) — 從手牌選 1 張能量附於自己戰鬥寶可夢 + 回 heal HP
//   • benchHandAttachFullHealPost(typeFilter, label) — 從手牌選 1 張基本能量附於備戰 + 將該寶可夢全回復
//
// 新 regPre：
//   • 灰塵山|丟棄 — 宣告時用 hand-discard 選任意數量的「寶可夢道具」卡，×50 傷害
//   • 切割洛托姆|割除衝刺 — 造傷害前丟對手戰鬥寶可夢的 toolAttached + 所有特殊能量
//   • 賽富豪|富裕強襲 — 若本回合從「索財靈」進化，則 +90
// ══════════════════════════════════════════════════════════════════════════════

// (A) 棄牌區選卡到手牌：Pokemon×2
function discardSearchToHandPost(max: number, filter: string, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!card) return false;
      if (filter === 'Pokemon') return card.supertype === 'Pokemon';
      if (filter === 'BasicEnergy') return card.supertype === 'Energy' && card.subtype === 'Basic';
      if (filter.startsWith('Energy:')) {
        // v2.121：加 name fallback（基本能量 pokemonType 常為 undefined）
        const t = filter.slice(7);
        if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
        if (card.pokemonType === t) return true;
        const zhByType: Record<string, string> = {
          Grass: '草', Fire: '火', Water: '水', Lightning: '雷',
          Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼',
          Dragon: '龍', Colorless: '無',
        };
        return card.name.includes(`【${zhByType[t] ?? ''}】`);
      }
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：棄牌區沒有可選的卡`, aIdx);
    const realMax = Math.min(max, cand.length);
    const s = addLog(state, `${label}：從棄牌區選最多 ${realMax} 張加手牌`, aIdx);
    return withPending(s, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter, minCount: 1, maxCount: realMax,
      effectKey: 'discard-to-hand',
    });
  };
}

// 鐵斑葉|補全之網 — 從棄牌區選最多 2 張寶可夢卡加手牌
regPre('鐵斑葉|補全之網', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('鐵斑葉|補全之網', discardSearchToHandPost(2, 'Pokemon', '補全之網'));

// 破破舵輪|救援船錨 — 從棄牌區選最多 2 張寶可夢卡加手牌
regPre('破破舵輪|救援船錨', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('破破舵輪|救援船錨', discardSearchToHandPost(2, 'Pokemon', '救援船錨'));

// 斯魔茶|上茶 — 從棄牌區選 1 張基本草能量加手牌
regPre('斯魔茶|上茶', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('斯魔茶|上茶', discardSearchToHandPost(1, 'Energy:Grass', '上茶'));

// (B) 刺龍王ex|王之號召 — 從棄牌區選最多 3 張【水】寶可夢卡放備戰（重用 bench-from-discard-samename resolver，validIids=水寶可夢）
regPre('刺龍王ex|王之號召', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('刺龍王ex|王之號召', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  // v5.041：bench limit 改 getBenchLimit (5→8)
  if (p.bench.length >= getOwnBenchLimit(state, aIdx, pool)) return addLog(state, '王之號召：備戰區已滿', aIdx);
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.pokemonType === 'Water';
  });
  if (cand.length === 0) return addLog(state, '王之號召：棄牌區無【水】寶可夢', aIdx);
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const slots = Math.min(3, getOwnBenchLimit(state, aIdx, pool) - p.bench.length, cand.length);
  const s = addLog(state, `王之號召：從棄牌區選最多 ${slots} 張【水】寶可夢放備戰`, aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon', minCount: 0, maxCount: slots,
    effectKey: 'bench-from-discard-samename',
    params: { validIids: cand.map(c => c.iid), targetName: '【水】寶可夢', label: '王之號召' },
  });
});

// (C) 甲賀忍蛙ex|忍之利刃 — v2.222 移除：v2.129 已在 line 10626 重新實裝為
//   「若希望」可選 0~1 張，舊版 deckSearchToHandPost(1) 強制搜 1 張不正確；
//   保留舊登錄會讓後者覆蓋前者，但這段註解化避免將來誤讀。

// 美錄坦|搬運破爛 — 從牌庫選 1 張寶可夢道具卡加手牌並重洗
regPre('美錄坦|搬運破爛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('美錄坦|搬運破爛', deckSearchToHandPost(1, 'Tool', '搬運破爛'));

// (D) 穿著熊|力量充能 30 — 從牌庫選 1 張基本能量附於自己，並重洗
function deckEnergyAttachSelfPost(typeFilter: EnergyType | null, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const cand = p.deck.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && !energyMatchesType(card, typeFilter as EnergyType)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    });
    if (cand.length === 0) return openDeckViewReshuffle(state, aIdx, label); // v5.496
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從牌庫選 1 張基本能量附於自己`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr, minCount: 0, maxCount: 1,
      effectKey: 'deck-energy-attach-self',
      params: { validIids: cand.map(c => c.iid), label },
    });
  };
}
regR('deck-energy-attach-self', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '自牌庫附能';
  const p = st.players[idx];
  if (!p.active) return st;
  const picked = p.deck.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(st, `${label}：未選擇`, idx);
  const tname = pool.get(p.active.cardId)?.name ?? '?';
  const ename = pool.get(picked[0].cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${ename} 附加到 ${tname}（重洗牌庫）`, idx);
  return updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    const newDeck = shuffle(pl.deck.filter(c => !iids.includes(c.iid)));
    return {
      ...pl,
      deck: newDeck,
      active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...picked] },
    };
  });
});
regPre('穿著熊|力量充能', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('穿著熊|力量充能', deckEnergyAttachSelfPost(null, '力量充能'));

// (E) 卡比獸|吃飽先 — 從手牌選 1 張能量附於自己 + 回 60 HP
function selfActiveHandAttachHealPost(heal: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    // v5.184：詛咒根擋手牌附能 — 戰鬥位受詛咒根影響時，走「只回血」分支（PTCG: 招式效果分階段）
    const cantAttachActive = p.active.cantAttachEnergyThisTurn === true;
    const cand = cantAttachActive ? [] : p.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
    if (cantAttachActive) {
      state = addLog(state, `${label}：戰鬥位受詛咒根影響，無法附加能量；改為直接執行回血`, aIdx);
    }
    if (cand.length === 0) {
      // 沒能量 (或詛咒根擋) → 只回血
      const tname = pool.get(p.active.cardId)?.name ?? '?';
      const newDmg = Math.max(0, p.active.damage - heal);
      const healed = p.active.damage - newDmg;
      if (healed === 0) return addLog(state, `${label}：手牌無能量且 ${tname} 無傷害`, aIdx);
      const s = addLog(state, `${label}：手牌無能量，${tname} 回 ${healed} HP`, aIdx);
      return updatePlayer(s, aIdx, pl => ({ ...pl, active: pl.active ? { ...pl.active, damage: newDmg } : pl.active }));
    }
    const s = addLog(state, `${label}：從手牌選 1 張能量附於自己 + 回 ${heal} HP`, aIdx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Energy', minCount: 1, maxCount: 1,
      effectKey: 'self-active-hand-attach-heal',
      params: { heal, label, validIids: cand.map(c => c.iid) },
    });
  };
}
regR('self-active-hand-attach-heal', (st, idx, iids, params, pool) => {
  const heal = (params?.heal as number) ?? 0;
  const label = (params?.label as string) ?? '手牌附能+回血';
  const p = st.players[idx];
  if (!p.active) return st;
  const picked = p.hand.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return st;
  const tname = pool.get(p.active.cardId)?.name ?? '?';
  const ename = pool.get(picked[0].cardId)?.name ?? '?';
  const newDmg = Math.max(0, p.active.damage - heal);
  const healed = p.active.damage - newDmg;
  let s = addLog(st, `${label}：${ename} 附於 ${tname}，並回 ${healed} HP`, idx);
  s = updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      hand: pl.hand.filter(c => !iids.includes(c.iid)),
      active: {
        ...pl.active,
        damage: newDmg,
        energyAttached: [...pl.active.energyAttached, ...picked],
      },
    };
  });
  // v5.539：從手牌附能後觸發對手附能被動（侵蝕詛咒 等）
  return fireOnHandEnergyAttached(s, idx, p.active.iid, pool);
});
regPre('卡比獸|吃飽先', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('卡比獸|吃飽先', selfActiveHandAttachHealPost(60, '吃飽先'));

// (F) 葉伊布|嫩葉之恩 — 從手牌選 1 張基本草能量附於備戰 + 全回復
function benchHandAttachFullHealPost(typeFilter: EnergyType | null, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：無備戰寶可夢`, aIdx);
    // v5.184：詛咒根擋手牌附能 — filter 可接受能量的備戰
    const validBench = p.bench.filter(c => !c.cantAttachEnergyThisTurn);
    if (validBench.length === 0) return addLog(state, `${label}：備戰寶可夢全數受詛咒根影響，無法附加能量`, aIdx);
    const cand = p.hand.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && !energyMatchesType(card, typeFilter as EnergyType)) return false; // v5.450：基本能量 pokemonType=null，名稱-aware
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：手牌無符合的基本能量`, aIdx);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從手牌選 1 張基本能量附於備戰並全回復`, aIdx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr, minCount: 1, maxCount: 1,
      effectKey: 'bench-hand-attach-fullheal-pick-energy',
      params: { label, validIids: cand.map(c => c.iid), benchValidIids: validBench.map(c => c.iid) },
    });
  };
}
regR('bench-hand-attach-fullheal-pick-energy', (st, idx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '附能+全回復';
  const p = st.players[idx];
  if (p.bench.length === 0) return st;
  // v5.184：用 benchValidIids（gate 端已過濾詛咒根）；fallback 給舊 caller
  const benchValidIids = (params?.benchValidIids as string[] | undefined) ?? p.bench.map(c => c.iid);
  if (benchValidIids.length === 0) return st;
  if (benchValidIids.length === 1) {
    // 只有 1 隻合法備戰，自動選定
    return applyBenchAttachFullHeal(st, idx, iids, benchValidIids[0], label);
  }
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'bench-hand-attach-fullheal-commit',
    params: { energyIids: iids, label, validIids: benchValidIids },
  });
});
regR('bench-hand-attach-fullheal-commit', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '附能+全回復';
  const energyIids = (params?.energyIids as string[]) ?? [];
  return applyBenchAttachFullHeal(st, idx, energyIids, iids[0], label, pool);
});
function applyBenchAttachFullHeal(st: GameState, idx: 0 | 1, energyIids: string[], targetIid: string, label: string, pool: Map<string, Card>): GameState {
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.hand.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  // 只取 pool 以保留名字 — 由呼叫者傳入 pool 會較好，這裡從 cardId 推名即可
  const newDamage = 0;
  const healed = target.damage;
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到備戰，並全回復（回 ${healed} HP）`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !energyIids.includes(c.iid)),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, damage: newDamage, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
  // v5.539：從手牌附能後觸發對手附能被動（侵蝕詛咒 等）
  return fireOnHandEnergyAttached(s, idx, targetIid, pool);
}
regPre('葉伊布|嫩葉之恩', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('葉伊布|嫩葉之恩', benchHandAttachFullHealPost('Grass', '嫩葉之恩'));

// (G) 灰塵山|丟棄 — 手牌丟任意數量「寶可夢道具」×50 傷害
// v2.254：完整實裝 — 借殼 ATTACK_PRE_DISCARD_CHOICE + 新 scope 'hand-tool'，
//   UI 彈出 modal 讓玩家自選要丟哪些道具（與 火箭羽毛 'hand-rocket-supporter' 同 pattern）。
//   舊版自動全丟玩家無選擇權；現玩家可選 0~N 張。
ATTACK_PRE_DISCARD_CHOICE.set('灰塵山|丟棄', {
  min: 0,
  max: null,           // 不限上限
  scope: 'hand-tool',
  baseDamage: 0,
  damagePerEnergy: 50, // 每張 +50（damagePerCard 語意，scope=hand-* 時通用）
});
regPre('灰塵山|丟棄', (state, aIdx, pool, action) => {
  const p = state.players[aIdx];
  const chosenIids = action?.discardedEnergyIids;
  let idxs: number[];
  if (chosenIids && chosenIids.length > 0) {
    // 玩家明確指定：用這幾張
    const idSet = new Set(chosenIids);
    idxs = [];
    p.hand.forEach((c, i) => {
      if (idSet.has(c.iid)) {
        const card = pool.get(c.cardId);
        if (card?.supertype === 'Trainer' && card.subtype === 'PokemonTool') {
          idxs.push(i);
        }
      }
    });
  } else {
    // AI / 未開 modal fallback：自動全丟（最大化攻擊）
    idxs = [];
    p.hand.forEach((c, i) => {
      const card = pool.get(c.cardId);
      if (card?.supertype === 'Trainer' && card.subtype === 'PokemonTool') {
        idxs.push(i);
      }
    });
  }
  if (idxs.length === 0) {
    return { state: addLog(state, '丟棄：未丟棄任何道具 → 0 傷害', aIdx), damage: 0 };
  }
  const damage = idxs.length * 50;
  const discarded = idxs.map(i => p.hand[i]);
  const discardNames = discarded.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `丟棄：丟 ${discarded.length} 張道具（${discardNames}），造成 ${damage} 傷害`, aIdx);
  s = updatePlayer(s, aIdx, pl => ({
    ...pl,
    hand: pl.hand.filter((_, i) => !idxs.includes(i)),
    discard: [...pl.discard, ...discarded],
  }));
  return { state: s, damage };
});

// (H) 切割洛托姆|割除衝刺 30 — 造成傷害前丟對手戰鬥寶可夢 toolAttached + 所有特殊能量
regPre('切割洛托姆|割除衝刺', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return { state, damage: 30 };
  const dname = pool.get(def.cardId)?.name ?? '?';
  let s = state;
  const newDiscards: CardInstance[] = [];
  // 丟 tool
  let newActive = { ...def };
  // v3.20 多重轉接：割除衝刺把對手 active 所有道具丟棄
  const _glrAllTools = getAllAttachedTools(def);
  if (_glrAllTools.length > 0) {
    const tname = pool.get(_glrAllTools[0].cardId)?.name ?? '?'; void tname;
    for (const t of _glrAllTools) newDiscards.push(t);
    newActive = { ...newActive, toolAttached: undefined, extraTools: [] };
    s = addLog(s, `割除衝刺：丟棄 ${dname} 的道具 ${tname}`, aIdx);
  }
  // 丟所有特殊能量
  const keepEnergies: CardInstance[] = [];
  const specialEnergies: CardInstance[] = [];
  for (const e of def.energyAttached) {
    const card = pool.get(e.cardId);
    if (card?.supertype === 'Energy' && card.subtype !== 'Basic') specialEnergies.push(e);
    else keepEnergies.push(e);
  }
  if (specialEnergies.length > 0) {
    newDiscards.push(...specialEnergies);
    newActive = { ...newActive, energyAttached: keepEnergies };
    const enames = specialEnergies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
    s = addLog(s, `割除衝刺：丟棄 ${dname} 的特殊能量 ${specialEnergies.length} 張（${enames}）`, aIdx);
  }
  if (newDiscards.length === 0) return { state: s, damage: 30 };
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...players[dIdx],
    active: newActive,
    discard: [...players[dIdx].discard, ...newDiscards],
  };
  s = { ...s, players };
  return { state: s, damage: 30 };
});

// (I) 賽富豪|富裕強襲 30+ — 若本回合從「索財靈」進化，則 +90
regPre('賽富豪|富裕強襲', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return { state, damage: 30 };
  const evolved = p.active.evolvedThisTurn;
  const stack = p.active.evolvedFromStack ?? [];
  const fromName = stack.length > 0 ? pool.get(stack[stack.length - 1].cardId)?.name : undefined;
  if (evolved && fromName === '索財靈') {
    return { state: addLog(state, '富裕強襲：本回合從「索財靈」進化 → +90', aIdx), damage: 120 };
  }
  return { state, damage: 30 };
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 33 — 引擎擴充：skipWeakRes / skipDefEffects 旗標
//
// 本波新增招式旗標（AttackPreFn 回傳 skipWeakRes / skipDefEffects）：
//
//   skipWeakRes    — 傷害不計算弱點（抵抗力目前引擎未實作，此旗標主要作用於弱點）
//   skipDefEffects — 傷害不計算對手戰鬥寶可夢身上的「附加效果」：
//                    被動減傷特性、特定屬性防禦道具、下次被攻擊 -N、條件式完全免疫
//
// 實作對照：engine.ts 傷害管線
//   if (!skipWeakRes)    → 套用弱點 ×2
//   if (!skipDefEffects) → 套用 PASSIVE_DAMAGE_REDUCE / TOOL_DEFENSE_REDUCE_BY_TYPE /
//                          PASSIVE_IMMUNITY / damageReduceNextHit
//
// 注意：並非實卡所有「附加效果」文字都等同於引擎全部防禦機制；此處採取保守實作，
// 將所有 defender-side 的減傷/免疫機制一起納入 skipDefEffects 範圍（符合大多數實戰情境）。
// ══════════════════════════════════════════════════════════════════════════════

/** 固定傷害 + 跳過弱點/抵抗力。 */
function skipWeakResPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipWeakRes: true });
}

/** 固定傷害 + 跳過對手戰鬥寶可夢身上附加效果。 */
export function skipDefEffectsPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipDefEffects: true });
}

/** 固定傷害 + 同時跳過弱點/抵抗力與身上附加效果。 */
function skipBothPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipWeakRes: true, skipDefEffects: true });
}

/** v4.495 固定傷害 + 只跳過抵抗力（不影響弱點計算）。卡面「這個招式的傷害不計算抵抗力。」 */
function skipResistancePre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipResistance: true });
}

/** v4.495 固定傷害 + 只跳過弱點（不影響抵抗力計算）。卡面「這個招式的傷害不計算弱點。」 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function skipWeaknessPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipWeakness: true });
}

// ── Wave 33 招式登記 ───────────────────────────────────────────────────────
// 恰雷姆ex｜瑜伽踢 — 190，傷害不計算弱點・抵抗力
regPre('恰雷姆ex|瑜伽踢', skipWeakResPre(190, '瑜伽踢'));

// 厄鬼椪 礎石面具ex｜打爆 — 140，不計算弱點・抵抗力與對手戰鬥寶可夢身上的附加效果
regPre('厄鬼椪 礎石面具ex|打爆', skipBothPre(140, '打爆'));

// 安瓢蟲｜高速星星 — 70，不計算弱點・抵抗力與對手戰鬥寶可夢身上的附加效果
regPre('安瓢蟲|高速星星', skipBothPre(70, '高速星星'));

// 輕身鱈｜音波刀鋒 — 110，不計算對手戰鬥寶可夢身上的附加效果
regPre('輕身鱈|音波刀鋒', skipDefEffectsPre(110, '音波刀鋒'));

// 米立龍ex｜突襲水泵 — 100，不計算對手戰鬥寶可夢身上的附加效果
regPre('米立龍ex|突襲水泵', skipDefEffectsPre(100, '突襲水泵'));

// 頓甲｜打垮 — 40，不計算對手戰鬥寶可夢身上的附加效果
regPre('頓甲|打垮', skipDefEffectsPre(40, '打垮'));

// 堅盾劍怪｜堅硬猛擊 — 120，不計算對手戰鬥寶可夢身上的附加效果
regPre('堅盾劍怪|堅硬猛擊', skipDefEffectsPre(120, '堅硬猛擊'));

// 晶光芽｜岩石投擲 — 10，不計算抵抗力（v4.495 改 skipResistancePre — 弱點仍套用）
regPre('晶光芽|岩石投擲', skipResistancePre(10, '岩石投擲'));

// 土地雲｜粗暴橫掃 — 130，不計算抵抗力（v4.495 改 skipResistancePre — 弱點仍套用）
regPre('土地雲|粗暴橫掃', skipResistancePre(130, '粗暴橫掃'));

// 鐵頭殼ex｜雙刃劍 — 已於 Wave 31 以 multiSnipePost 實作；snipe-multi 本身即繞過弱點/附加效果，
// Session 33 不需額外旗標改寫。保留此註記以避免未來重複登記。

// ══════════════════════════════════════════════════════════════════════════════
// Wave 34 — 引擎擴充：CardInstance.movedToActiveThisTurn 旗標
//
// 新增旗標：`movedToActiveThisTurn`（在 RETREAT 與 SEND_NEW_ACTIVE 時設，
// 於擁有者下回合 END_TURN 時 clearTurnFlags 一併清除）。
// 作用：招式效果「在這個回合，若從備戰區將這隻寶可夢放置於戰鬥場，則增加 N 點傷害」。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * base + bonus（若本回合剛從備戰區被放到戰鬥場）。
 * 條件以 attacker.active.movedToActiveThisTurn 判斷。
 */
function movedToActivePre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (att?.movedToActiveThisTurn) {
      return {
        state: addLog(state, `${label}：本回合從備戰區放置戰鬥場 → +${bonus}`, aIdx),
        damage: base + bonus,
      };
    }
    return { state, damage: base };
  };
}

// ── Wave 34 招式登記（4 張） ───────────────────────────────────────────────
// 普隆隆姆ex｜暴衝閃光 — 20+120 = 140
regPre('普隆隆姆ex|暴衝閃光', movedToActivePre(20, 120, '暴衝閃光'));

// 超級長耳兔ex｜疾風直撞 — 60+170 = 230
regPre('超級長耳兔ex|疾風直撞', movedToActivePre(60, 170, '疾風直撞'));

// 烈空坐｜進擊破壞 — 20+90 = 110
regPre('烈空坐|進擊破壞', movedToActivePre(20, 90, '進擊破壞'));

// 凱路迪歐ex｜疾風直撞 — 30+90 = 120
regPre('凱路迪歐ex|疾風直撞', movedToActivePre(30, 90, '疾風直撞'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 35 — 自身回手牌 / 回牌庫 類招式
//
// 對 active 自身結算完傷害後，將 active（含附加能量 / 道具 / evolvedFromStack）
// 一併送回手牌或牌庫，active 設為 null → 引擎會自動觸發 pending SEND_NEW_ACTIVE。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 自身回手牌：active + 所有附加卡全部放回手牌，active=null。
 * 使用時機：post（傷害已結算）。
 */
function selfReturnToHandPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const inst = p.active;
    const returning: CardInstance[] = [
      // 把進化棧底重設為未進化版本（保留最底層 card），其實不必拆棧 —
      // 整疊連附加一起送回手牌即可，但 evolvedFromStack 裡每張都是獨立的 CardInstance，
      // 逐一加入手牌才符合「附加的卡」語義。
      // 主體（含目前 cardId 與 iid）
      // v5.705：主體與附加卡全部裸化成乾淨卡牌（中央白名單，取代手動黑名單避免漏清旗標）
      toBareCard(inst),
      ...inst.energyAttached.map(toBareCard),
      ...getAllAttachedTools(inst).map(toBareCard),
      ...(inst.evolvedFromStack ?? []).map(toBareCard),
    ];
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = {
      ...p,
      active: null,
      hand: [...p.hand, ...returning],
    };
    return addLog({ ...state, players }, `${label}：將自身（含附加）全部放回手牌`, aIdx);
  };
}

/**
 * 自身回牌庫（重洗）：active + 所有附加卡放回牌庫並 shuffle，active=null。
 */
function selfReturnToDeckPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const inst = p.active;
    const returning: CardInstance[] = [
      // v5.705：主體與附加卡全部裸化成乾淨卡牌（中央白名單，取代手動黑名單避免漏清旗標）
      toBareCard(inst),
      ...inst.energyAttached.map(toBareCard),
      ...getAllAttachedTools(inst).map(toBareCard),
      ...(inst.evolvedFromStack ?? []).map(toBareCard),
    ];
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = {
      ...p,
      active: null,
      deck: shuffle([...p.deck, ...returning]),
    };
    return addLog({ ...state, players }, `${label}：將自身（含附加）全部放回自己牌庫並重洗`, aIdx);
  };
}

/**
 * 自身回牌庫 + 從牌庫任意選最多 N 張加入手牌。
 * 做法：先把 active 送回牌庫（不洗）→ 觸發 pending deck-search（filter=Any, max=N）→
 * resolver 處理抽完後 shuffle 牌庫。
 */
function selfReturnToDeckThenSearchPost(maxSearch: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const inst = p.active;
    const returning: CardInstance[] = [
      // v5.705：主體與附加卡全部裸化成乾淨卡牌（中央白名單，取代手動黑名單避免漏清旗標）
      toBareCard(inst),
      ...inst.energyAttached.map(toBareCard),
      ...getAllAttachedTools(inst).map(toBareCard),
      ...(inst.evolvedFromStack ?? []).map(toBareCard),
    ];
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = {
      ...p,
      active: null,
      // 先「放」回牌庫（不 shuffle）— resolver 做 search → 取到手牌後 shuffle
      deck: [...p.deck, ...returning],
    };
    const afterReturn = addLog({ ...state, players }, `${label}：將自身（含附加）全部放回自己牌庫`, aIdx);
    // deck-search 預設 filter=Any（maxCount 張數上限，由玩家自選）
    return withPending(afterReturn, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: maxSearch,
      effectKey: 'search-to-hand-reshuffle',
      filter: 'Any',
      params: { label },
    });
  };
}

/**
 * 備戰寶可夢回牌庫：玩家選 1 隻自己備戰寶可夢，連同附加一起回牌庫並重洗。
 * 使用既有 bench-choose pending + 新 resolver `self-bench-return-to-deck`。
 */
function selfBenchReturnToDeckPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：沒有備戰寶可夢`, aIdx);
    const s = addLog(state, `${label}：選擇 1 隻備戰寶可夢回到牌庫`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'self-bench-return-to-deck',
      params: { label },
    });
  };
}

regR('self-bench-return-to-deck', (st, actorIdx, selectedIids, params, _pool) => {
  const label = (params?.label as string) ?? '回家鐘聲';
  const iid = selectedIids[0];
  const p = st.players[actorIdx];
  const picked = p.bench.find(c => c.iid === iid);
  if (!picked) return st;
  const returning: CardInstance[] = [
    // v5.705：主體與附加卡全部裸化成乾淨卡牌
    toBareCard(picked),
    ...picked.energyAttached.map(toBareCard),
    ...getAllAttachedTools(picked).map(toBareCard),
    ...(picked.evolvedFromStack ?? []).map(toBareCard),
  ];
  const players = [...st.players] as [PlayerState, PlayerState];
  players[actorIdx] = {
    ...p,
    bench: p.bench.filter(c => c.iid !== iid),
    deck: shuffle([...p.deck, ...returning]),
  };
  return addLog({ ...st, players }, `${label}：備戰寶可夢連附加放回牌庫並重洗`, actorIdx);
});

// ── Wave 35 招式登記 ──────────────────────────────────────────────────────

// 喵喵ex｜夾尾巴逃跑 — 60 + 自身回手牌
regPre('喵喵ex|夾尾巴逃跑', (state, _a, _p) => ({ state, damage: 60 }));
regPost('喵喵ex|夾尾巴逃跑', selfReturnToHandPost('夾尾巴逃跑'));

// 賽富豪｜賽富迴旋 — 100 + 「若希望」自身回牌庫
//   v2.220：升級為 modal-choice — 玩家在 POST 階段選「回 / 不回」
regPre('賽富豪|賽富迴旋', (state, _a, _p) => ({ state, damage: 100 }));
regPost('賽富豪|賽富迴旋', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '賽富迴旋：選擇「否」 — 不回牌庫', aIdx);
  const _cb: AttackPostFn = (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const s = addLog(state, '賽富迴旋：選擇是否將自身（含附加）放回牌庫並重洗', aIdx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'sigorhof-back-choice',
    params: {
      label: '賽富迴旋',
      options: [
        { id: 'return', text: '①將自身與附加的卡全部放回牌庫並重洗' },
        { id: 'skip', text: '②不返回（保留戰鬥位）' },
      ],
    },
  });
};
  return _cb(state, aIdx, pool);
});
regR('sigorhof-back-choice', (state, aIdx, iids, _params, pool) => {
  if (iids[0] === 'return') {
    return selfReturnToDeckPost('賽富迴旋')(state, aIdx, pool);
  }
  return addLog(state, '賽富迴旋：選擇保留戰鬥位（不返回）', aIdx);
});

// 蚊香泳士｜跳躍衝天 — 卡面：「若希望，增加 120 點傷害。這個情況下，將這隻寶可夢與附加的卡，全部放回自己的牌庫並重洗。」
// v2.255：完整實裝 — 借殼 ATTACK_PRE_DISCARD_CHOICE 加新 scope 'binary-yes-no'，
//   UI 彈出 yes/no overlay 讓玩家決定是否 +120 + 自身回牌庫。
//   - 選「否」 → 120 傷害，自身留場
//   - 選「是」 → 240 傷害 + 自身回牌庫
//   AI fallback：未指定 → 預設選「是」（最大化攻擊）。
ATTACK_PRE_DISCARD_CHOICE.set('蚊香泳士|跳躍衝天', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 120, damagePerEnergy: 0,  // damagePerEnergy 不適用 binary，僅 placeholder
  choicePrompt: '是否將這隻寶可夢與附加的卡放回牌庫並重洗，增加 120 點傷害？',
  choiceYesLabel: '是（+120 + 回牌庫）',
  choiceNoLabel: '否（保留戰鬥位）',
});
regPre('蚊香泳士|跳躍衝天', (state, aIdx, _pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  // length>=1 = yes（玩家選了 +120），length=0 = no
  // AI fallback（chosenIids === undefined）→ 預設 yes 最大化攻擊
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return { state: addLog(state, '跳躍衝天：選擇「否」 → 120 傷害（自身留場）', aIdx), damage: 120 };
  }
  return { state: addLog(state, '跳躍衝天：選擇「是」 → 240 傷害（自身將回牌庫）', aIdx), damage: 240 };
});
regPost('蚊香泳士|跳躍衝天', (state, aIdx, pool, action) => {
  // POST 階段也需要看 action 決定是否回牌庫（與 PRE 同步）
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;  // 選否 → 不回牌庫
  return selfReturnToDeckPost('跳躍衝天')(state, aIdx, pool);
});

// 白蓬蓬｜微風之禮 — 0 傷 + 自身回牌庫 + 從牌庫任選最多 3 張加手牌
regPre('白蓬蓬|微風之禮', (state, _a, _p) => ({ state, damage: 0 }));
regPost('白蓬蓬|微風之禮', selfReturnToDeckThenSearchPost(3, '微風之禮'));

// 風鈴鈴｜回家鐘聲 — 0 傷 + 備戰選 1 隻連附加回牌庫
regPre('風鈴鈴|回家鐘聲', (state, _a, _p) => ({ state, damage: 0 }));
regPost('風鈴鈴|回家鐘聲', selfBenchReturnToDeckPost('回家鐘聲'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 36 — 引擎擴充：player-level noAttacksNextTurn + 跨回合加傷
//
// 引擎新增：
//   - PlayerState.noAttacksNextTurn / noAttacksThisTurn（玩家級，涵蓋新上場寶可夢）
//   - CardInstance.takeExtraDamageNextTurn / takeExtraDamageThisTurn（跨回合目標 +N 受傷）
//
// 搭配的 END_TURN 變化：
//   - 於 aIdx（結束方）promote takeExtraDamageNextTurn → ThisTurn
//   - 於 dIdx（下個行動方）promote noAttacksNextTurn → ThisTurn
//   - 於 dIdx 清除 takeExtraDamageThisTurn、aIdx 清除 noAttacksThisTurn
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_POST：對自己（攻擊方）設 noAttacksNextTurn = true。
 * 使用時機：打爆類 AoE 代價招式（雷電在地）。
 */
function playerNoAttacksNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = { ...players[aIdx], noAttacksNextTurn: true };
    return addLog({ ...state, players },
      `${label}：自己下個回合所有寶可夢將無法使用招式（含新上場的）`, aIdx);
  };
}

/**
 * ATTACK_POST：對對手戰鬥場設 takeExtraDamageNextTurn = N。
 * 若對手此攻擊被擊倒（active 已 null），旗標自然失效。
 */
function oppTargetTakeExtraNextPost(bonus: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    // v2.91 招式效果免疫檢查
    const defCard = pool.get(d.active.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, d.active, defCard, pool);
    if (guard.blocked) {
      return addLog(state,
        `${label}：${defCard?.name ?? '?'}｜${guard.reason}（不施加「下回合受招式 +${bonus}」）`, aIdx);
    }
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = {
      ...d,
      active: { ...d.active, takeExtraDamageNextTurn: (d.active.takeExtraDamageNextTurn ?? 0) + bonus },
    };
    const nm = players[dIdx].active ? (state.players[dIdx].active ? '對手戰鬥寶可夢' : '?') : '?';
    return addLog({ ...state, players }, `${label}：${nm}下個自己回合受到招式傷害 +${bonus}`, aIdx);
  };
}

// ── Wave 36 招式登記（2 張） ───────────────────────────────────────────────

// 電擊魔獸｜雷電在地 — 220，自己下個回合所有寶可夢皆無法使用招式
regPre('電擊魔獸|雷電在地', (state, _a, _p) => ({ state, damage: 220 }));
regPost('電擊魔獸|雷電在地', playerNoAttacksNextPost('雷電在地'));

// 超音波幼蟲｜刺耳聲 — 0 傷，對手戰鬥寶可夢下個自己（攻擊方）回合受招式 +50
regPre('超音波幼蟲|刺耳聲', (state, _a, _p) => ({ state, damage: 0 }));
regPost('超音波幼蟲|刺耳聲', oppTargetTakeExtraNextPost(50, '刺耳聲'));

// v2.464 泥巴魚|飛撲圈套 — 30；
//   下個對手回合：受到此招的寶可夢無法撤退
//   下個自己回合：受到此招的寶可夢受到招式傷害 +100
//   若對手用「寶可夢交替」等換場到備戰 → 兩個旗標都會被 clearActiveEffects 清掉
//   （cantRetreatNextTurn / takeExtraDamageNextTurn / takeExtraDamageThisTurn 均在 clearActiveEffects 列表內）
regPre('泥巴魚|飛撲圈套', (state, _a, _p) => ({ state, damage: 30 }));
regPost('泥巴魚|飛撲圈套', (state, aIdx, pool, action) => {
  let s = defCantRetreatNextPost()(state, aIdx, pool, action);
  s = oppTargetTakeExtraNextPost(100, '飛撲圈套')(s, aIdx, pool, action);
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.48 仙子伊布ex 兩招（H 標 Stage1 Psychic）
// ══════════════════════════════════════════════════════════════════════════════
// 1) 魔法魅惑 [PCC] 160 — 「下個對手回合，受到這個招式的寶可夢使用招式的傷害 -100」
//    v5.727：魔法魅惑 regPost 改回同族正確的 selfDmgReducePost(100)（註冊於上方「E. 自己下
//    回合受招式傷害 -N」群組）。卡面「在下個對手的回合，受到這個招式的寶可夢(=仙子伊布自身)
//    使用招式的傷害 -100」是【自身防護】(同 龍捲雲|暴風障壁、振翼髮|月亮之力)；先前誤用
//    defNextAtkReducePost(在對手 active 設 nextOwnAttackPenalty 削弱對手攻擊)：對手附免疫
//    能量(硬岩等)時其 guard 會擋掉 → 仙子伊布反而沒被保護，且會削弱對手對所有目標的傷害=錯誤語意。
//    此處僅保留 regPre 基礎傷害 160；regPost 由上方 selfDmgReducePost(100) 生效。
regPre('仙子伊布ex|魔法魅惑', (s, _a, _p) => ({ state: s, damage: 160 }));

// 2) 天仙石 [WLP] 0 — 選 0~2 隻對手備戰，連附加卡放回對手牌庫並重洗
//    Gate：「在上個自己的回合，若自己的寶可夢使出了天仙石，則無法使用」
//    用既有 blockedAttackNamesNextTurn 機制（per-attacker，跟「烈火爆進」同 pattern）：
//    使用後在這隻寶可夢上鎖「天仙石」一回合，下回合若仍是同隻 active 就無法再用。
//    註：卡面是「自己的寶可夢」(player level)，但實務切換 active 仙子伊布ex 需 retreat
//    + 重建能量 (3 cost)，per-attacker gate 已涵蓋 95% 場景；保持實作簡潔。
regPre('仙子伊布ex|天仙石', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('仙子伊布ex|天仙石', (state, aIdx, _pool) => {
  // 鎖此 attacker 下回合的「天仙石」
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '天仙石'],
    } : null,
  }));
  const oppIdx = (1 - aIdx) as 0 | 1;
  const oppBench = s.players[oppIdx].bench;
  if (oppBench.length === 0) {
    return addLog(s, '天仙石：對手備戰區無寶可夢，效果無作用', aIdx);
  }
  const max = Math.min(2, oppBench.length);
  s = addLog(s, `天仙石：選 ${max} 隻對手備戰寶可夢，連同附加卡放回對手牌庫並重洗`, aIdx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: oppIdx,
    // v2.991：卡面寫「選 2 隻」是強制；對手備戰<2 時取全部（max 已是 Math.min(2,oppBench.length)）
    minCount: max, maxCount: max,
    effectKey: 'sylveon-skystone-bounce',
  });
});

regR('sylveon-skystone-bounce', (state, aIdx, iids, _params, pool) => {
  const oppIdx = (1 - aIdx) as 0 | 1;
  if (iids.length === 0) {
    return addLog(state, '天仙石：未選擇備戰寶可夢', aIdx);
  }
  const set = new Set(iids);
  const opp = state.players[oppIdx];
  const bouncing = opp.bench.filter(b => set.has(b.iid));
  // 把每隻 bench pokemon + 它的 energyAttached + toolAttached + evolvedFromStack 全部清回 deck
  // 寶可夢本體要清掉所有臨時狀態（damage / status / 各種旗標）— 比照「自己備戰回牌庫」 pattern
  const returning: CardInstance[] = [];
  for (const b of bouncing) {
    returning.push({
      ...b,
      damage: 0,
      energyAttached: [],
      toolAttached: undefined, extraTools: [],
      status: undefined,
      secondaryStatus: undefined,
      tertiaryStatus: undefined,
      evolvedFromStack: undefined,
      evolvedThisTurn: undefined,
      justPlaced: undefined,
      playedFromHand: undefined,
      movedToActiveThisTurn: undefined,
      damageBonusThisTurn: undefined,
      damageReduceNextHit: undefined,
      abilityUsedThisTurn: undefined,
      cantAttackThisTurn: undefined,
      cantAttackPending: undefined,
      cantRetreatNextTurn: undefined,
      cantRetreatPendingSelf: undefined,
      damageBonusPending: undefined,
      takeExtraDamageThisTurn: undefined,
      takeExtraDamageNextTurn: undefined,
      blockedAttackNamesNextTurn: undefined,
    });
    returning.push(...b.energyAttached);
    // v3.20 多重轉接：iterate 所有道具
    for (const t of getAllAttachedTools(b)) returning.push(t);
    if (b.evolvedFromStack) returning.push(...b.evolvedFromStack);
  }
  const names = bouncing.map(b => pool.get(b.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `天仙石：${bouncing.length} 隻備戰（${names}）連附加全部放回對手牌庫並重洗`, aIdx);
  return updatePlayer(s, oppIdx, p => ({
    ...p,
    bench: p.bench.filter(b => !set.has(b.iid)),
    deck: shuffle([...p.deck, ...returning]),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 37 — 強制對手將戰鬥寶可夢與備戰寶可夢互換（由對手選）
//
// 機制：
//   - ATTACK_POST 觸發 pending 'bench-choose'，actorIdx=defenderIdx（對手自選）
//   - resolver 負責執行 swap，並給新上場的寶可夢設 movedToActiveThisTurn
//   - 變種：互換後對新上場寶可夢造成 N 點傷害（長毛巨魔｜挑釁抓擊）
//   - 若對手備戰為空：post 僅結算原本傷害，不觸發 pending
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_POST：強制對手將戰鬥寶可夢與備戰寶可夢互換（由對手選）。
 * 若對手備戰為空 → 無效果（本來 damage 已在 pre 結算）。
 */
export function forceOppSwapPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    // v5.388：強制互換是招式效果 → 對招式效果免疫的 active（化隱/純樸/阿塞蘿拉…）不被強制換位。
    const _swapG = canApplyEffectToTarget(state, aIdx, d.active, _pool.get(d.active.cardId), 'attack-effect', _pool);
    if (_swapG.blocked) return addLog(state, `${label}：${_swapG.reason}（不被強制換位）`, aIdx);
    if (d.bench.length === 0) {
      return addLog(state, `${label}：對手沒有備戰寶可夢可交換`, aIdx);
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

/**
 * ATTACK_POST：強制對手 swap 後，對新上場的寶可夢造成 dmg 點傷害（不計弱點 / 抵抗力 / 附加效果）。
 * 若對手備戰為空：直接對現戰鬥寶可夢造成 dmg（因無處可替換，但招式還是要執行傷害部分）。
 */
function forceOppSwapThenDamagePost(dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    // v5.388：強制互換是招式效果 → 對招式效果免疫的 active（化隱/純樸…）不被換位；
    //   但「受到 dmg」是招式傷害（化隱/純樸不擋傷害）→ 仍對原戰鬥寶可夢造成 dmg（比照「無備戰」分支）。
    const _swapG = canApplyEffectToTarget(state, aIdx, d.active, _pool.get(d.active.cardId), 'attack-effect', _pool);
    if (_swapG.blocked || d.bench.length === 0) {
      const _why = _swapG.blocked ? `${_swapG.reason}（不被強制換位）` : '對手無備戰可交換';
      // v5.387：戰鬥場受的招式傷害要計弱點/抵抗 + 走傷害免疫 → 走中央 dealAttackDamageToTarget。
      const s0 = addLog(state, `${label}：${_why}`, aIdx);
      return dmg > 0 ? dealAttackDamageToTarget(s0, aIdx, d.active.iid, dmg, _pool, { kind: 'attack-damage', label }) : s0;
    }
    const s = addLog(state, `${label}：對手必須將戰鬥寶可夢與備戰寶可夢互換，然後新上場的寶可夢受到 ${dmg} 點傷害（由對手選）`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'force-opp-swap-then-damage',
      params: { label, attackerIdx: aIdx, dmg },
    });
  };
}

regR('force-opp-swap', (st, actorIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '強制互換';
  const attackerIdx = ((params?.attackerIdx ?? (1 - actorIdx)) as 0 | 1);
  const p = st.players[actorIdx];
  if (!p.active) return st;
  const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
  if (bIdx < 0) return st;
  const oldActiveName = pool.get(p.active.cardId)?.name ?? '?';
  const newActiveName = pool.get(p.bench[bIdx].cardId)?.name ?? '?';
  const newBench = [...p.bench];
  // v2.08：離開戰鬥場清狀態旗標
  newBench[bIdx] = clearActiveEffects(p.active);
  const newActive: CardInstance = { ...p.bench[bIdx], movedToActiveThisTurn: true };
  const players = [...st.players] as [PlayerState, PlayerState];
  players[actorIdx] = { ...p, active: newActive, bench: newBench };
  return addLog({ ...st, players },
    `${label}：${oldActiveName} 退回備戰區，${newActiveName} 上場`, attackerIdx);
});

regR('force-opp-swap-then-damage', (st, actorIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '強制互換';
  const attackerIdx = ((params?.attackerIdx ?? (1 - actorIdx)) as 0 | 1);
  const dmg = Number(params?.dmg ?? 0);
  const p = st.players[actorIdx];
  if (!p.active) return st;
  const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
  if (bIdx < 0) return st;
  const oldActiveName = pool.get(p.active.cardId)?.name ?? '?';
  const swappingIn = p.bench[bIdx];
  const newActiveName = pool.get(swappingIn.cardId)?.name ?? '?';
  const newBench = [...p.bench];
  // v2.08：離開戰鬥場清狀態旗標
  newBench[bIdx] = clearActiveEffects(p.active);

  // v5.387：先完成互換，再對「新上場的戰鬥寶可夢」造成招式傷害。
  //   原本 flat（不計弱抗）是錯的 — 戰鬥場受的招式傷害要計弱點/抵抗，並走傷害免疫。改走中央函式。
  const newActive: CardInstance = { ...swappingIn, movedToActiveThisTurn: true };
  const players = [...st.players] as [PlayerState, PlayerState];
  players[actorIdx] = { ...p, active: newActive, bench: newBench };
  let s: GameState = addLog({ ...st, players },
    `${label}：${oldActiveName} 退回備戰區，${newActiveName} 上場`, attackerIdx);
  if (dmg > 0) {
    s = dealAttackDamageToTarget(s, attackerIdx, newActive.iid, dmg, pool, { kind: 'attack-damage', label });
  }
  return s;
});

// ── Wave 37 招式登記（4 張） ───────────────────────────────────────────────

// 大狼犬｜踹開 — 50 + 強制對手互換
regPre('大狼犬|踹開', (state, _a, _p) => ({ state, damage: 50 }));
regPost('大狼犬|踹開', forceOppSwapPost('踹開'));

// v4.791：月桂葉｜推倒 — 卡面 damage 50（不是 10）+ 強制對手互換
//   舊 bug：寫死 damage 10。卡面實際是 50。
regPre('月桂葉|推倒', (state, _a, _p) => ({ state, damage: 50 }));
regPost('月桂葉|推倒', forceOppSwapPost('推倒'));

// 小箭雀｜送回 — 10 + 強制對手互換
regPre('小箭雀|送回', (state, _a, _p) => ({ state, damage: 10 }));
regPost('小箭雀|送回', forceOppSwapPost('送回'));

// 長毛巨魔｜挑釁抓擊 — 0 pre，互換後新上場寶可夢受 160 傷害
regPre('長毛巨魔|挑釁抓擊', (state, _a, _p) => ({ state, damage: 0 }));
regPost('長毛巨魔|挑釁抓擊', forceOppSwapThenDamagePost(160, '挑釁抓擊'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 38 — 攻擊前丟道具卡系列
//
// 已有 helper：defToolDiscardPre(base, label) — 丟對手戰鬥寶可夢的 tool + base 傷。
// 本波新增：
//   • selfToolDiscardOrFailPre — 先丟自身 tool，若無則招式失敗（0 傷）
//   • defToolDiscardParalyzePre — 丟對手 tool，若實際有丟棄則再施加【麻痺】
//
// 本波實裝卡片：
//   • 烈雀｜啄食 (M1L/MC) ─ 10 + 丟對手 tool
//   • 拉達｜削落 (M3) ─ 20 + 丟對手 tool
//   • 燃燒蟲｜啄落 (SV11B) ─ 10 + 丟對手 tool
//   • 派帕的貪心栗鼠｜咬取 (SV9a) ─ 10 + 丟對手 tool
//   • N的電電蟲｜劈哩啪啦短路 (SV9) ─ 30 + 丟對手 tool + 有丟棄則麻痺
//   • 美錄梅塔｜重塑斧 (SV7) ─ 250 + 必須丟自身 tool，無 tool 則失敗
//
// DEFER：安瓢蟲｜繁星花紋 (SV7) — 為【特性】（on-evolve ability），
// 需要新增進化觸發式 ability infra，拆到後續 wave 處理。
// ══════════════════════════════════════════════════════════════════════════════

/** 自身 tool 必須丟棄，否則招式失敗（0 傷）。用於「重塑斧」。 */
function selfToolDiscardOrFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    // v3.20 多重轉接：丟自身第 1 張道具
    const allMyTools = p.active ? getAllAttachedTools(p.active) : [];
    if (!p.active || allMyTools.length === 0) {
      return { state: addLog(state, `${label}：自身無道具可丟棄 → 招式失敗`, aIdx), damage: 0 };
    }
    const attName = pool.get(p.active.cardId)?.name ?? '?';
    const discarded = allMyTools[0];
    const toolName = pool.get(discarded.cardId)?.name ?? '?';
    let s = addLog(state, `${label}：丟棄 ${attName} 的道具「${toolName}」`, aIdx);
    s = updatePlayer(s, aIdx, pl => {
      if (!pl.active) return pl;
      let newAct = pl.active;
      if (newAct.toolAttached?.iid === discarded.iid) {
        newAct = { ...newAct, toolAttached: undefined };
      } else if (newAct.extraTools) {
        newAct = { ...newAct, extraTools: newAct.extraTools.filter(x => x.iid !== discarded.iid) };
      }
      return { ...pl, active: newAct, discard: [...pl.discard, discarded] };
    });
    return { state: s, damage: base };
  };
}

/** 丟對手 tool + base 傷，且「若有丟棄」再將對手戰鬥寶可夢【麻痺】。 */
function defToolDiscardParalyzePre(base: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    // v3.20 多重轉接：丟第 1 張可用道具
    const allDefTools2 = def ? getAllAttachedTools(def) : [];
    if (!def || allDefTools2.length === 0) {
      return { state: addLog(state, `${label}：對手戰鬥寶可夢無道具（不觸發麻痺）`, aIdx), damage: base };
    }
    const defCardForGuard = pool.get(def.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, def, defCardForGuard, pool);
    if (guard.blocked) {
      const dName = pool.get(def.cardId)?.name ?? '?';
      return {
        state: addLog(state, `${label}：${dName}｜${guard.reason}（不丟道具、不麻痺，傷害正常造成）`, aIdx),
        damage: base,
      };
    }
    const defName = pool.get(def.cardId)?.name ?? '?';
    const discarded = allDefTools2[0];
    const toolName = pool.get(discarded.cardId)?.name ?? '?';
    let s = addLog(state, `${label}：丟棄 ${defName} 的道具「${toolName}」`, aIdx);
    s = updatePlayer(s, dIdx, pl => {
      if (!pl.active) return pl;
      let newAct = pl.active;
      if (newAct.toolAttached?.iid === discarded.iid) {
        newAct = { ...newAct, toolAttached: undefined };
      } else if (newAct.extraTools) {
        newAct = { ...newAct, extraTools: newAct.extraTools.filter(x => x.iid !== discarded.iid) };
      }
      return {
        ...pl,
        active: newAct,
        discard: [...pl.discard, discarded],
      };
    });
    // v5.675 收斂：麻痺改走中央（補泡沫水等特殊能量免疫 + 欄位保留；化隱已於上方 guard 判過）
    s = applyStatusToOppActive(s, aIdx, 'paralyzed', pool, { kind: 'attack-effect', label });
    return { state: s, damage: base };
  };
}

// ── Wave 38 招式登記 ──────────────────────────────────────────────────────

// 重用 defToolDiscardPre（對手 tool 丟棄）
regPre('烈雀|啄食', defToolDiscardPre(10, '啄食'));
regPre('拉達|削落', defToolDiscardPre(20, '削落'));
regPre('燃燒蟲|啄落', defToolDiscardPre(10, '啄落'));
regPre('派帕的貪心栗鼠|咬取', defToolDiscardPre(10, '咬取'));

// 丟對手 tool + 有丟棄則麻痺
regPre('N的電電蟲|劈哩啪啦短路', defToolDiscardParalyzePre(30, '劈哩啪啦短路'));

// 必須丟自身 tool，否則招式失敗
regPre('美錄梅塔|重塑斧', selfToolDiscardOrFailPre(250, '重塑斧'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 39 — 玩家級禁卡 / 卡片級能量附加鎖 / 跨回合獎賞加成
//
// 新 Helper（effects.ts）：
//   • oppCantPlayItemNextPost(label)       — 對手下個回合無法從手牌使出物品卡
//   • oppCantPlaySupporterNextPost(label)  — 對手下個回合無法從手牌使出支援者卡
//   • oppCantEvolveNextPost(label)         — 對手下個回合無法從手牌使出寶可夢並完成進化
//   • oppActiveCantAttachEnergyNextPost(label) — 對手戰鬥寶可夢下個回合無法附上從手牌的能量
//   • oppActiveDeferredPrizeNextPost(bonus, label) — 對手戰鬥寶可夢在攻擊方下個回合被 KO 時 +N 張獎賞卡
//   • selfDiscardAllEnergyPost(label)      — 自丟自身 active 所有附加能量
//
// 引擎聯動：
//   - PlayerState.cantPlayItemNextTurn/ThisTurn、cantPlaySupporterNext/This、cantEvolveNext/This
//   - CardInstance.cantAttachEnergyNextTurn/ThisTurn、deferredPrizeBonusNextTurn/ThisTurn
//   - engine.ts PLAY_TRAINER / EVOLVE / ATTACH_ENERGY gate 檢查上述旗標
//   - engine.ts END_TURN：於 nextIdx promote Next → This；於 aIdx 清除 This
//   - engine.ts KO 路徑讀取 deferredPrizeBonusThisTurn 加到 pendingPrizes
//
// 本波實裝（6 張）：
//   • 含羞苞｜癢癢花粉 10 + cantPlayItem
//   • 青銅鐘｜進化妨礙者 30 + cantEvolve
//   • 吼叫尾ex｜絕叫 0 + cantPlaySupporter（v2.219 補「後攻最初回合限定」gate）
//   • 電蜘蛛ex｜雷擊石 180 + 自丟所有能量 + cantPlayItem
//   • 晶光花｜侵蝕碎塊 20 + 中毒 + cantAttachEnergy
//   • 蝶結萌虻｜多餘花粉 30 + deferredPrizeBonus=2
// ══════════════════════════════════════════════════════════════════════════════

function oppCantPlayItemNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], cantPlayItemNextTurn: true };
    return addLog({ ...state, players }, `${label}：對手下個回合無法從手牌使出物品卡`, aIdx);
  };
}

function oppCantPlaySupporterNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], cantPlaySupporterNextTurn: true };
    return addLog({ ...state, players }, `${label}：對手下個回合無法從手牌使出支援者卡`, aIdx);
  };
}

function oppCantEvolveNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], cantEvolveNextTurn: true };
    return addLog({ ...state, players }, `${label}：對手下個回合無法從手牌使出寶可夢並完成進化`, aIdx);
  };
}

function oppActiveCantAttachEnergyNextPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    // v2.91 招式效果免疫檢查
    const defCard = pool.get(d.active.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, d.active, defCard, pool);
    if (guard.blocked) {
      return addLog(state,
        `${label}：${defCard?.name ?? '?'}｜${guard.reason}（不施加「下回合不能附能量」）`, aIdx);
    }
    const dName = pool.get(d.active.cardId)?.name ?? '?';
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...d, active: { ...d.active, cantAttachEnergyNextTurn: true } };
    return addLog({ ...state, players }, `${label}：${dName} 下個回合無法附上從手牌使出的能量卡`, aIdx);
  };
}

function oppActiveDeferredPrizeNextPost(bonus: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    // v2.91 招式效果免疫檢查
    const defCard = pool.get(d.active.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, d.active, defCard, pool);
    if (guard.blocked) {
      return addLog(state,
        `${label}：${defCard?.name ?? '?'}｜${guard.reason}（不施加「KO 多 +${bonus} 張獎賞」）`, aIdx);
    }
    const dName = pool.get(d.active.cardId)?.name ?? '?';
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = {
      ...d,
      active: {
        ...d.active,
        deferredPrizeBonusNextTurn: (d.active.deferredPrizeBonusNextTurn ?? 0) + bonus,
      },
    };
    return addLog(
      { ...state, players },
      `${label}：${dName} 若在攻擊方下個回合被擊倒，多 +${bonus} 張獎賞卡`,
      aIdx,
    );
  };
}

// 註：selfDiscardAllEnergyPost 已於 4971 行定義，直接重用。

// ── Wave 39 招式登記 ──────────────────────────────────────────────────────

// 含羞苞｜癢癢花粉 10 + 下回合對手禁物品卡
regPre('含羞苞|癢癢花粉', (s, _a, _p) => ({ state: s, damage: 10 }));
regPost('含羞苞|癢癢花粉', oppCantPlayItemNextPost('癢癢花粉'));

// 青銅鐘｜進化妨礙者 30 + 下回合對手禁進化
regPre('青銅鐘|進化妨礙者', (s, _a, _p) => ({ state: s, damage: 30 }));
regPost('青銅鐘|進化妨礙者', oppCantEvolveNextPost('進化妨礙者'));

// 吼叫尾ex｜絕叫 0 + 下回合對手禁支援者
regPre('吼叫尾ex|絕叫', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('吼叫尾ex|絕叫', oppCantPlaySupporterNextPost('絕叫'));

// 電蜘蛛ex｜雷擊石 180 + 自丟所有能量 + 下回合對手禁物品卡
regPre('電蜘蛛ex|雷擊石', (s, _a, _p) => ({ state: s, damage: 180 }));
regPost('電蜘蛛ex|雷擊石', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('雷擊石')(state, aIdx, pool);
  s = oppCantPlayItemNextPost('雷擊石')(s, aIdx, pool);
  return s;
});

// 晶光花｜侵蝕碎塊 20 + 中毒 + 下回合對手戰鬥寶可夢無法附能
regPre('晶光花|侵蝕碎塊', (s, _a, _p) => ({ state: s, damage: 20 }));
regPost('晶光花|侵蝕碎塊', (state, aIdx, pool) => {
  let s = statusPost('poisoned')(state, aIdx, pool);
  s = oppActiveCantAttachEnergyNextPost('侵蝕碎塊')(s, aIdx, pool);
  return s;
});

// 蝶結萌虻｜多餘花粉 30 + 跨回合獎賞 +2
regPre('蝶結萌虻|多餘花粉', (s, _a, _p) => ({ state: s, damage: 30 }));
regPost('蝶結萌虻|多餘花粉', oppActiveDeferredPrizeNextPost(2, '多餘花粉'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 40 — 自身 KO 類特性 / 招式（v1.95）
//
// 共 2 張：
//   1. 彷徨夜靈|咒詛炸彈   — 自身昏厥 + 在對手 1 隻寶可夢身上放 5 個傷害指示物
//   2. 三合一磁怪|過度放電 — 自身昏厥 + 從自己棄牌區選最多 3 張基本【雷】能量
//                            以任意方式附於自己的【雷】寶可夢身上
//                            （v2.221 升級為「逐張分配」chain，每張能量可附不同雷寶）
//
// 兩張的卡牌資料在部分套牌登記為 abilities[]（→ regA），其餘套牌以 attacks[] 形式
// 登記（名稱前綴 ZWJ U+200C + [特性]）。兩種路徑都需要註冊以確保涵蓋。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 自身 KO 某隻特定 iid 寶可夢 — 含附加卡送棄牌 + 對手即時取獎賞 + 勝負檢查。
 * （自身 KO 時，對手的獎賞不經 pendingPrizes，因攻擊方無法自己取自己 KO 的獎賞。）
 */
export function selfKOInstance(
  state: GameState,
  aIdx: 0 | 1,
  iid: string,
  pool: Map<string, Card>,
  label: string,
): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[aIdx];
  const isActive = p.active?.iid === iid;
  const target = isActive ? p.active! : p.bench.find(c => c.iid === iid);
  if (!target) return state;
  const tCard = pool.get(target.cardId);
  const tName = tCard?.name ?? '?';
  const ko: CardInstance[] = [
    { ...target, damage: tCard?.hp ?? 999 },
    ...target.energyAttached,
    ...getAllAttachedTools(target),
    ...(target.evolvedFromStack ?? []),
  ];
  const prizes = tCard ? koPrizeCount(tCard) : 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const newP: PlayerState = {
    ...p,
    discard: [...p.discard, ...ko],
    active: isActive ? null : p.active,
    bench: isActive ? p.bench : p.bench.filter(c => c.iid !== iid),
  };
  players[aIdx] = newP;
  let s: GameState = addLog({ ...state, players }, `${label}：${tName} 昏厥！對手待取 ${prizes} 張獎賞卡`, null);
  // v3.792 Rule 10 修法：改用 addPendingPrize（移除直接派發 prizes→hand）
  //   舊版邏輯（v2.98 之前）認為「自身 KO 時對手獎賞無法經 pendingPrizes，因攻擊方不能取
  //   自己 KO 的獎賞」。但 v2.98 起 pendingPrizes 是 per-player tuple，dIdx 那邊 pending > 0
  //   就會顯示「取得」按鈕給對手點，與「攻擊方點」是兩件事 — Rule 10 已釐清。
  //   勝負條件（取得所有獎賞卡）改由 TAKE_PRIZES handler 在玩家點按鈕後檢查。
  s = addPendingPrize(s, dIdx, prizes, pool);
  // 自身是否無後繼（這條與獎賞無關，保留）
  if (isActive && newP.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: dIdx, winReason: `${p.name} 沒有可上場的寶可夢` };
  }
  return s;
}

/**
 * 找本回合已觸發特性且 cardName 符合的 CardInstance iid（regA 內部用）。
 *
 * ⚠️ v5.074 DEPRECATED：此 helper 在「同回合多隻同名寶可夢同時用特性」時會壞掉。
 *   找的是「第一個有 abilityUsedThisTurn=true 的」— 2~N 隻時掃到第 1 隻就 return，
 *   後續觸發都被誤歸到第 1 隻（玩家回報 3 隻火箭隊的操陷蛛｜充能 能量全附第 1 隻）。
 *
 * 正確做法：engine.ts L3329 已把觸發的 CardInstance 當第 4 參數傳給 abilityFn，
 *   regA callback 直接接 `(st, idx, pool, cardInst) => ...` 用 cardInst.iid 即可。
 *   v5.074 已把 4 處 caller（操陷蛛、彷徨夜靈、三合一磁怪、黑夜魔靈）改用第 4 參數，
 *   helper 保留只是防 import 破壞，新註冊請勿使用。
 */
export function findAbilityUserIid(
  state: GameState,
  aIdx: 0 | 1,
  cardName: string,
  pool: Map<string, Card>,
): string | null {
  const p = state.players[aIdx];
  const all = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  for (const c of all) {
    if (!c.abilityUsedThisTurn) continue;
    const card = pool.get(c.cardId);
    if (card?.name === cardName) return c.iid;
  }
  return null;
}

// ── 咒詛炸彈 resolver ─────────────────────────────────────────────────────
// 流程：opp-poke-choose → 對目標 +N counter（N 由 params.counters 決定，預設 5）→ 自身 KO。
// 若目標被 +N 擊倒，pendingPrizes 照常累積；若自身 KO 後對手 prize 歸零 → 對手勝。
// counters: 5 = 彷徨夜靈（+50 傷害）；13 = 黑夜魔靈（+130 傷害）
regR('cursed-bomb', (st, actorIdx, selectedIids, params, pool) => {
  const label = (params?.label as string) ?? '咒詛炸彈';
  const userIid = params?.userIid as string | undefined;
  const counters = (params?.counters as number) ?? 5;
  const addDmg = counters * 10;
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  // v4.52 Phase 3：合併 isBenchProtected + 光之翼 inline 為 unified helper
  //   kind='ability-effect'：unified 內部會 dispatch
  //     - 光之翼（self-only，active + bench 都擋特性效果）
  //     - 對戰圓形（bench-only，擋招式/特性的效果）
  //   不擋（依 v3.825 fix）：抵抗之幕 / 薄霧能量 / 硬岩能量 / 皇帝之勢（這些只擋招式效果，不擋特性）
  //   行為等價：unified('ability-effect') 對 active+bench 走 light wing，對 bench 加走 resolveBenchGuard。
  const targetCard = pool.get(target.cardId);
  const _cursedGuard = canApplyEffectToTarget(st, actorIdx, target, targetCard, 'ability-effect', pool, { isBench: !isActive });
  if (_cursedGuard.blocked) {
    let s = addLog(st, `${label}：${targetCard?.name ?? '?'} ${_cursedGuard.reason}（不放指示物）`, actorIdx);
    if (userIid) {
      s = selfKOInstance(s, actorIdx, userIid, pool, label);
    }
    return s;
  }
  const tHp = effectiveHPInline(target, pool, st);  // v5.091
  const newDmg = target.damage + addDmg;
  let s: GameState = st;
  if (tHp > 0 && newDmg >= tHp) {
    // 目標被放 N 個指示物擊倒
    const koDiscard: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...getAllAttachedTools(target),
      ...(target.evolvedFromStack ?? []),
    ];
    const _ko = koPrizesAdjusted(s, target, targetCard, (1 - dIdx) as 0 | 1, dIdx, pool, false);
    s = _ko.state;
    const prizes = _ko.prizes;
    const players = [...s.players] as [PlayerState, PlayerState];
    const newDefender: PlayerState = {
      ...defender,
      discard: [...defender.discard, ...koDiscard],
      active: isActive ? null : defender.active,
      bench: isActive ? defender.bench : defender.bench.filter(c => c.iid !== targetIid),
    };
    players[dIdx] = newDefender;
    s = addLog({ ...s, players },
      `${label}：在 ${targetCard?.name ?? '?'} 身上放 ${counters} 個傷害指示物 → 被擊倒！+${prizes} 張獎賞卡`, actorIdx);
    s = addPendingPrize(s, actorIdx, prizes, pool);
    // v2.246：對手主動特性 KO 對手寶可夢（從 dIdx victim 視角是「對手特性 KO 我方」）
    s = recordOppKO(s, dIdx, targetCard, 'ability');
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
  } else {
    const players = [...s.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender };
    if (isActive) newDefender.active = { ...target, damage: newDmg };
    else newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
    players[dIdx] = newDefender;
    s = addLog({ ...s, players }, `${label}：在 ${targetCard?.name ?? '?'} 身上放 ${counters} 個傷害指示物`, actorIdx);
  }
  // 自身 KO（不論目標是否被擊倒）
  if (userIid) {
    s = selfKOInstance(s, actorIdx, userIid, pool, label);
  }
  return s;
});

/**
 * 可達鴨｜濕氣 — 內嵌判定（避免循環 import）。
 * 只要任一方場上有可達鴨（active 或 bench），所有「將自己昏厥」類效果
 * （ability / [特性]招式）全部不觸發。
 *
 * v5.220 Bug 2 修補：原本只純檢查名為 '濕氣' 的 ability，沒檢查該 ability 是否被消除。
 *   PTCG 規則：特性被「無視」(暗夜羽擊 / 黏著束縛 等) 時就不存在 → 不應再
 *   擋自我 KO 招式。修法：iterate 時逐隻檢查特性消除狀態：
 *     (1) inst.abilityNullifiedThisTurn — 招式版 暗夜羽擊 (v2.362 promote)
 *     (2) isAbilityNullifiedByPassive — passive 振翼髮｜暗夜羽擊 (v3.01) /
 *         海兔獸｜黏著束縛 (v3.01) 等同類「對手特性消除」passive
 *   被消除的 濕氣 跳過不算，繼續找下一隻；全部都被消除才回 false (放行自爆)。
 */
function hasPsyduckDamp(state: GameState, pool: Map<string, Card>): boolean {
  for (const ownerIdx of [0, 1] as const) {
    const p = state.players[ownerIdx];
    const allPokes: Array<{ inst: CardInstance; loc: 'active' | 'bench' }> = [];
    if (p.active) allPokes.push({ inst: p.active, loc: 'active' });
    for (const b of p.bench) allPokes.push({ inst: b, loc: 'bench' });
    for (const { inst, loc } of allPokes) {
      const card = pool.get(inst.cardId);
      if (!card?.abilities?.some(a => a.name === '濕氣')) continue;
      // v5.220 Bug 2: 濕氣被消除時不算這隻
      if (inst.abilityNullifiedThisTurn) continue;
      if (isAbilityNullifiedByPassive(state, ownerIdx, inst, card, '濕氣', loc, pool)) continue;
      return true;
    }
  }
  return false;
}

/** 招式式 [特性]咒詛炸彈 — 攻擊者 = active。counters: 放幾個傷害指示物（預設 5） */
export function cursedBombAttackPost(label: string, counters: number = 5): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    // 可達鴨｜濕氣：自身 KO 類招式被消除（不放指示物也不自 KO）
    if (hasPsyduckDamp(state, pool)) {
      return addLog(state, `${label}：被可達鴨的濕氣消除`, aIdx);
    }
    const userIid = p.active.iid;
    const dIdx = (1 - aIdx) as 0 | 1;
    const dp = state.players[dIdx];
    if (!dp.active && dp.bench.length === 0) {
      return selfKOInstance(addLog(state, `${label}：對手無可選寶可夢`, aIdx),
        aIdx, userIid, pool, label);
    }
    const s = addLog(state, `${label}：選 1 隻對手寶可夢放 ${counters} 個傷害指示物`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'cursed-bomb',
      params: { label, userIid, includeActive: true, counters },
    });
  };
}

// ── 過度放電 resolver + postFn ────────────────────────────────────────────
// 流程：先自身 KO（active）→ 再 pending discard-search（BasicEnergy 任意屬性, 1-3）→
//       resolver 選 1 隻自己雷寶可夢附上全部能量。

regR('overvolt-attach-pick-target', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '過度放電';
  // v5.502：統一改用 startEnergyChain（仿大吾的巨金怪ex|X啟動）取代原 inline 分配邏輯。
  //   能量已在 discard（從 discard-search picker 選），source='discard'；目標=自己【雷】寶可夢。
  //   startEnergyChain 自動處理：0 目標→能量留棄牌、1 目標→全附、同屬性→單 picker 顯示該屬性、
  //   **混合屬性→「逐屬性分波」**(第1波火 modal 顯示【火】、第2波水顯示【水】…)，
  //   解決 v5.501「混合屬性顯示通用『能量』、玩家看不出附哪種屬性」的問題。
  return startEnergyChain(st, idx, iids, {
    label, source: 'discard', scope: 'any-own', filterType: 'Lightning',
  }, pool);
});

// v2.87：overvolt-attach-commit 已被 v87-energy-distribute-flat 取代。
regR('overvolt-attach-commit', (st, _idx, _iids, _params, _pool) => st);

function overvoltAttackPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    // 可達鴨｜濕氣：自身 KO 類招式被消除（不 KO 自己也不找能量）
    if (hasPsyduckDamp(state, pool)) {
      return addLog(state, `${label}：被可達鴨的濕氣消除`, aIdx);
    }
    const userIid = p.active.iid;
    // (1) 自身 KO
    let s = selfKOInstance(state, aIdx, userIid, pool, label);
    if (s.phase === 'game-over') return s;
    // (2) 棄牌區基本雷能量候選
    const cand = s.players[aIdx].discard.filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic'; // v5.500：卡面「基本能量卡」任意屬性(雷限制只對附加目標)
    });
    if (cand.length === 0) return addLog(s, `${label}：棄牌區無基本能量`, aIdx);
    // (3) 場上是否還有雷寶可夢
    const hasLightning = [s.players[aIdx].active, ...s.players[aIdx].bench].some(c => {
      if (!c) return false;
      return pool.get(c.cardId)?.pokemonType === 'Lightning';
    });
    if (!hasLightning) return addLog(s, `${label}：場上無【雷】寶可夢，無法附加`, aIdx);
    // (4) pending discard-search
    const realMax = Math.min(3, cand.length);
    const s2 = addLog(s, `${label}：從棄牌區選 1-${realMax} 張基本能量`, aIdx);
    return withPending(s2, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy', minCount: 1, maxCount: realMax,
      effectKey: 'overvolt-attach-pick-target',
      params: { label },
    });
  };
}

// ── 註冊 ─────────────────────────────────────────────────────────────────

// 彷徨夜靈｜咒詛炸彈（5 counter）— 正統 ability 路徑
// v2.95：JSON migration 後 abilities[0]={name:'咒詛炸彈'} 穩定存在，attack-style
// ZWJ 變體註冊全部移除（見 v2.95 commit）。
// v5.074：用第 4 參數 cardInst.iid 取代 findAbilityUserIid（同回合 2 隻彷徨夜靈時不誤判）
regA('彷徨夜靈', 0, (st, aIdx, pool, cardInst) => {
  const userIid = cardInst?.iid;
  if (!userIid) return st;
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active && dp.bench.length === 0) {
    return selfKOInstance(addLog(st, '咒詛炸彈：對手無可選寶可夢', aIdx),
      aIdx, userIid, pool, '咒詛炸彈');
  }
  const s = addLog(st, '咒詛炸彈：選 1 隻對手寶可夢放 5 個傷害指示物', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cursed-bomb',
    params: { label: '咒詛炸彈', userIid, includeActive: true },
  });
});

// 三合一磁怪｜過度放電（自身 KO + 從棄牌選 1-3 張基本【雷】能量附自己【雷】寶可夢）
// v2.95：JSON migration 後從 attack-style 改為正統 ability 路徑。
// 行為對齊原 overvoltAttackPost（維持相同 semantics，不改既有 filter 規則）。
// v5.074：用第 4 參數 cardInst.iid 取代 findAbilityUserIid（同回合 2 隻時不誤判）
regA('三合一磁怪', 0, (st, aIdx, pool, cardInst) => {
  const label = '過度放電';
  const userIid = cardInst?.iid;
  if (!userIid) return st;
  // 可達鴨｜濕氣：自身 KO 類特性被消除
  if (hasPsyduckDamp(st, pool)) {
    return addLog(st, `${label}：被可達鴨的濕氣消除`, aIdx);
  }
  // (1) 自身 KO
  let s = selfKOInstance(st, aIdx, userIid, pool, label);
  if (s.phase === 'game-over') return s;
  // (2) 棄牌區基本【雷】能量候選
  const cand = s.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'; // v5.500：卡面「基本能量卡」任意屬性(雷限制只對附加目標)
  });
  if (cand.length === 0) return addLog(s, `${label}：棄牌區無基本能量`, aIdx);
  // (3) 場上是否還有雷寶可夢（self KO 後）
  const hasLightning = [s.players[aIdx].active, ...s.players[aIdx].bench].some(c => {
    if (!c) return false;
    return pool.get(c.cardId)?.pokemonType === 'Lightning';
  });
  if (!hasLightning) return addLog(s, `${label}：場上無【雷】寶可夢，無法附加`, aIdx);
  // (4) pending discard-search
  const realMax = Math.min(3, cand.length);
  const s2 = addLog(s, `${label}：從棄牌區選 1-${realMax} 張基本能量`, aIdx);
  return withPending(s2, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy', minCount: 1, maxCount: realMax,
    effectKey: 'overvolt-attach-pick-target',
    params: { label },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 41 — 訓練家補實裝：
//   珍寶配件 / 能量輸送PRO / 水蓮的照顧 / 寶可夢旋風回收機 /
//   阿克羅瑪的執著 / 百萬噸吹風機
// ══════════════════════════════════════════════════════════════════════════════

// ── 珍寶配件（Item） ── 從牌庫選最多 5 張寶可夢道具加手牌 ────────────────
// 資料結構：道具 supertype='Pokemon' subtype='Other'（與 UI 'Tool' filter 對應）
regG('', (st, idx) => st.players[idx].deck.length > 0);
reg('珍寶配件', (st, idx) => {
  st = addLog(st, '珍寶配件：從牌庫選最多 5 張寶可夢道具加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Tool',
    minCount: 0, maxCount: 5,
    effectKey: 'search-generic-to-hand',
  });
});

// v2.993：私下版本通用 resolver — 選到的卡加入手牌、重洗、addPrivateLog（自己看到名稱、對手看計數）
// 用於卡面「沒寫『給對手看過』」的搜尋類效果（如：啪咚猴 衝衝鼓）。
regR('search-generic-to-hand-private', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '牌庫搜尋：未選擇任何卡（牌庫已重洗）', idx);
  }
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addPrivateLog(st,
    `搜到：${names} 加入手牌（牌庫已重洗）`,
    `搜到 ${chosen.length} 張卡加入手牌（牌庫已重洗）`,
    idx);
  return updatePlayer(st, idx, (p) => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
  });
});

// 通用 resolver（公開）：選到的卡加入手牌、重洗牌庫、log 卡名
regR('search-generic-to-hand', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '牌庫搜尋：未選擇任何卡（牌庫已重洗）', idx);
  }
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.993：所有此 resolver 的 caller 卡面都寫「給對手看過」→ 公開揭示卡名（Iron Rule 8）
  // 影響：戰鬥鑼、寶可平板、火箭隊的拉姆達、珍寶配件、王者呼聲（竹蘭的尖牙陸鯊）
  st = addLog(st, `搜到：${names} 加入手牌（牌庫已重洗）`, idx);
  return updatePlayer(st, idx, (p) => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
  });
});

// ── 能量輸送（Item / MC 639）── 從牌庫選 1 張基本能量加手牌（給對手看）+ 重洗
// v2.165：實裝（之前未實裝；火箭隊的烏鴉頭頭 preset 用）
//   卡面：「從自己的牌庫選擇1張基本能量卡，在給對手看過後加入手牌。並且重洗牌庫。」
// 與 能量輸送PRO 差異：本卡只搜 1 張、不需要不同屬性、log 強制公開（卡面要求「給對手看過」）
regG('能量輸送', (st, idx) => st.players[idx].deck.length > 0);
reg('能量輸送', (st, idx, pool) => {
  st = addLog(st, '能量輸送：從牌庫選 1 張基本能量加入手牌（給對手看）', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無基本能量時允許 Pass
  const hasBE = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'energy-transfer-search',
  });
});
regR('energy-transfer-search', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '能量輸送：未選擇任何能量（牌庫已重洗）', idx);
  }
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const pickedNames = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.993：能量輸送卡面寫「在給對手看過後加入手牌」→ 公開揭示（Iron Rule 8）
  st = addLog(st, `能量輸送：搜到 ${pickedNames} 加入手牌`, idx);
  return updatePlayer(st, idx, (p) => {
    const pickedIids = new Set(iids);
    const pickedInDeck = p.deck.filter(c => pickedIids.has(c.iid));
    const rest = p.deck.filter(c => !pickedIids.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...pickedInDeck] };
  });
});

// ── 能量輸送PRO（Item） ── 從牌庫選任意張數不同屬性基本能量加手牌 ──────
regG('', (st, idx) => st.players[idx].deck.length > 0);
reg('能量輸送PRO', (st, idx) => {
  st = addLog(st, '能量輸送PRO：從牌庫選任意張數基本能量加手牌（同屬只取 1 張）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 8,
    effectKey: 'energy-pro-search',
  });
});
regR('energy-pro-search', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '能量輸送PRO：未選擇任何能量（牌庫已重洗）', idx);
  }
  // 依「卡名」去重（基本能量名唯一對應屬性，例：基本【雷】能量）
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const seen = new Set<string>();
  const kept: CardInstance[] = [];
  const dupes: CardInstance[] = [];
  for (const c of chosen) {
    const nm = pool.get(c.cardId)?.name ?? '';
    if (seen.has(nm)) { dupes.push(c); continue; }
    seen.add(nm);
    kept.push(c);
  }
  const keptNames = kept.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addPrivateLog(st, `能量輸送PRO：搜到 ${keptNames}（${kept.length} 張）加入手牌`, `能量輸送PRO：搜到 ${kept.length} 張卡加入手牌`, idx);
  if (dupes.length > 0) {
    st = addLog(st, `（同屬重複 ${dupes.length} 張放回牌庫）`, idx);
  }
  return updatePlayer(st, idx, (p) => {
    const keptIids = new Set(kept.map(c => c.iid));
    const pickedInDeck = p.deck.filter(c => keptIids.has(c.iid));
    const rest = p.deck.filter(c => !keptIids.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...pickedInDeck] };
  });
});

// ── 水蓮的照顧（Supporter） ── 棄牌區選寶可夢（非 rule-box）+ 基本能量合計最多 3 張
regG('水蓮的照顧', (st, idx, pool) => {
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && card.subtype !== 'ex') return true;
    if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
    return false;
  });
});
reg('水蓮的照顧', (st, idx) => {
  st = addLog(st, '水蓮的照顧：從棄牌區選寶可夢（不含 ex）+ 基本能量合計最多 3 張加手牌', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonNonExOrBasicEnergy',
    minCount: 0, maxCount: 3,
    effectKey: 'discard-to-hand',
  });
});

// ── 寶可夢旋風回收機（Item） ── 選 1 自己場上寶可夢 → 本體+附加全放回手牌
regG('寶可夢旋風回收機', (st, idx) => {
  const p = st.players[idx];
  // 只有 active 且備戰空 → 不可打（否則場上就沒有寶可夢）
  // 只要備戰 >= 1（或 active 有且備戰也有），就可用
  if (!p.active && p.bench.length === 0) return false;
  if (p.active && p.bench.length === 0) return false; // 只有 active，回收了就沒了
  if (!p.active && p.bench.length > 0) return true;   // 只有備戰
  return true;                                         // active + bench 皆有
});
reg('寶可夢旋風回收機', (st, idx) => {
  const p = st.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  // 若備戰空而只有 active → 不應進入此函式（guard 應攔下）。仍做防禦：只列備戰
  const validIids = (p.bench.length === 0)
    ? []
    : all.map(c => c.iid);
  st = addLog(st, '寶可夢旋風回收機：選 1 隻自己場上的寶可夢放回手牌（含附加卡）', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: '', minCount: 1, maxCount: 1,
    params: { validIids },
    effectKey: 'wind-vortex-return',
  });
});
regR('wind-vortex-return', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const p = st.players[idx];
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active! : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tName = pool.get(target.cardId)?.name ?? '?';
  // 重置為純淨狀態（清除傷害、狀態、旗標、能量、道具、進化棧）
  // v5.705：主體與附加卡全部裸化成乾淨卡牌（中央白名單）
  const returning: CardInstance[] = [
    toBareCard(target),
    ...target.energyAttached.map(toBareCard),
    ...getAllAttachedTools(target).map(toBareCard),
    ...(target.evolvedFromStack ?? []).map(toBareCard),
  ];
  const s = addLog(st, `寶可夢旋風回收機：將 ${tName} 與附加的 ${returning.length - 1} 張卡放回手牌`, idx);
  return updatePlayer(s, idx, pp => ({
    ...pp,
    active: isActive ? null : pp.active,
    bench: isActive ? pp.bench : pp.bench.filter(c => c.iid !== targetIid),
    hand: [...pp.hand, ...returning],
  }));
});

// ── 阿克羅瑪的執著（Supporter） ── 從牌庫選競技場卡 + 能量卡各 1 張加手牌
regG('阿克羅瑪的執著', (st, idx) => st.players[idx].deck.length > 0);
reg('阿克羅瑪的執著', (st, idx, pool) => {
  st = addLog(st, '阿克羅瑪的執著：步驟 1／2 — 從牌庫選 1 張競技場卡加手牌', idx);
  // v2.993：卡面寫「各 1 張」mandatory；牌庫無競技場時允許 Pass
  const hasStadium = st.players[idx].deck.some(c => pool.get(c.cardId)?.subtype === 'Stadium');
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stadium',
    minCount: 0, maxCount: 1,
    effectKey: 'akuroma-step1-stadium',
  });
});
regR('akuroma-step1-stadium', (st, idx, iids, _params, pool) => {
  let s = st;
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.993：卡面寫「給對手看過」→ 公開揭示（Iron Rule 8）
    s = addLog(s, `阿克羅瑪的執著：搜到 ${names}（競技場）加入手牌`, idx);
    s = updatePlayer(s, idx, (p) => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: rest, hand: [...p.hand, ...picked] };
    });
  } else {
    s = addLog(s, '阿克羅瑪的執著：未選擇競技場卡', idx);
  }
  // Step 2
  s = addLog(s, '阿克羅瑪的執著：步驟 2／2 — 從牌庫選 1 張能量卡加手牌', idx);
  // v2.993：卡面寫「各 1 張」mandatory；牌庫無能量卡時允許 Pass
  const hasEnergy = s.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Energy');
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy',
    minCount: 0, maxCount: 1,
    effectKey: 'akuroma-step2-energy',
  });
});
regR('akuroma-step2-energy', (st, idx, iids, _params, pool) => {
  let s = st;
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.993：卡面寫「給對手看過」→ 公開揭示（Iron Rule 8）
    s = addLog(s, `阿克羅瑪的執著：搜到 ${names}（能量）加入手牌`, idx);
    s = updatePlayer(s, idx, (p) => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: rest, hand: [...p.hand, ...picked] };
    });
  } else {
    s = addLog(s, '阿克羅瑪的執著：未選擇能量卡', idx);
  }
  // 最後重洗牌庫
  return updatePlayer(s, idx, (p) => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 百萬噸吹風機（Item） ── 丟棄對手所有道具 + 特殊能量 + 場上競技場 ────
regG('百萬噸吹風機', (st, idx, pool) => {
  const opp = st.players[(1 - idx) as 0 | 1];
  const allOpp = [...(opp.active ? [opp.active] : []), ...opp.bench];
  // v3.20 多重轉接：iterate 所有道具
  const hasTool = allOpp.some(c => getAllAttachedTools(c).length > 0);
  const hasSpecial = allOpp.some(c =>
    c.energyAttached.some(e => pool.get(e.cardId)?.subtype === 'Special')
  );
  const hasStadium = !!st.activeStadium;
  return hasTool || hasSpecial || hasStadium;
});
reg('百萬噸吹風機', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];

  // 收集要丟棄的道具與特殊能量
  const removedTools: CardInstance[] = [];
  const removedSpecials: CardInstance[] = [];
  const toolNames: string[] = [];
  const specialNames: string[] = [];
  const stripOne = (c: CardInstance | null): CardInstance | null => {
    if (!c) return c;
    // v3.20 多重轉接：把 toolAttached 與 extraTools 全部丟棄
    for (const t of getAllAttachedTools(c)) {
      removedTools.push(t);
      toolNames.push(pool.get(t.cardId)?.name ?? '?');
    }
    const keptEnergies: CardInstance[] = [];
    for (const e of c.energyAttached) {
      if (pool.get(e.cardId)?.subtype === 'Special') {
        removedSpecials.push(e);
        specialNames.push(pool.get(e.cardId)?.name ?? '?');
      } else {
        keptEnergies.push(e);
      }
    }
    return { ...c, toolAttached: undefined, extraTools: [], energyAttached: keptEnergies };
  };
  const newOppActive = stripOne(opp.active);
  const newOppBench = opp.bench.map(b => stripOne(b)).filter((x): x is CardInstance => !!x);
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...opp,
    active: newOppActive,
    bench: newOppBench,
    discard: [...opp.discard, ...removedTools, ...removedSpecials],
  };
  let s: GameState = { ...st, players };
  if (toolNames.length > 0) {
    s = addLog(s, `百萬噸吹風機：丟棄對手 ${toolNames.length} 張道具（${toolNames.join('、')}）`, idx);
  }
  if (specialNames.length > 0) {
    s = addLog(s, `百萬噸吹風機：丟棄對手 ${specialNames.length} 張特殊能量（${specialNames.join('、')}）`, idx);
  }
  // 丟棄場上的競技場（v2.244：丟回擁有者棄牌堆）
  if (s.activeStadium) {
    const stadName = pool.get(s.activeStadium.cardId)?.name ?? '?';
    s = discardActiveStadium(s, idx);
    s = addLog(s, `百萬噸吹風機：丟棄場上的競技場 ${stadName}`, idx);
  }
  if (toolNames.length === 0 && specialNames.length === 0) {
    // 若連 stadium 都沒有，由 guard 攔下；進到這裡表示只有 stadium 被丟，已 log 過
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 42 — 「竹蘭的烈咬陸鯊EX」JP meta 牌組實裝（v1.97）
//
// 項目：
//   1. 竹蘭的烈咬陸鯊ex｜螺旋俯衝  — 100 + 抽到滿 6
//   2. 竹蘭的烈咬陸鯊ex｜龍之爆發  — 260 + 自己全丟能量
//   3. 竹蘭的尖牙陸鯊｜王者呼聲    — 特性，搜 1 張「竹蘭的」寶可夢到手牌
//   4. 竹蘭的圓陸鯊｜岩石投擲      — 20 不計算抵抗力（v4.495 修正：弱點仍算）
//   5. 竹蘭的羅絲雷朵｜輝煌聲援    — 被動特性，場上時「竹蘭的」寶可夢招式 +30
//   6. 竹蘭的花岩怪｜激怒咒詛      — 備戰「竹蘭的」×10，不計算弱點（v4.495 修正：抵抗力仍算）
//   7. 力量蛋白飲（Item）            — 本回合 [鬥] 寶可夢招式 +30（player flag）
//   8. 戰鬥鑼（Item）                 — 搜 1 張 [鬥] 基礎寶可夢 或 基本【鬥】能量到手牌
//   9. 寶可平板（Item）              — 搜 1 張「非擁有規則」寶可夢到手牌
//   10. 竹蘭的力量負重（道具）       — 「竹蘭的」寶可夢 HP +70（已由 TOOL_HP_BONUS 處理）
//   11. 火箭隊的拉姆達（Supporter）  — 搜 1 張訓練家卡到手牌
//   12. 硬岩【鬥】能量（特殊能量）   — 屬性：鬥（免疫效果延後）
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. 螺旋俯衝 — 100 傷害 + 抽到滿 6 ────────────────────────────────────────
// v2.22：卡名統一（pool.ts loadSet strip <>），只登錄純名稱即可
// v5.509：抽牌移到 regPre（傷害前）— 先補滿手牌再結算傷害/氣絕/拿獎，避免氣絕自動拿獎(進手牌)使抽牌少1張。
//   傷害仍回 100 走引擎（保留竹蘭的羅絲雷朵 +30 等 PASSIVE_ATTACK_BONUS / 弱抗）。
regPre('竹蘭的烈咬陸鯊ex|螺旋俯衝', (state, aIdx, pool, action) => {
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return { state: addLog(state, '螺旋俯衝：選擇「否」 — 跳過抽牌', aIdx), damage: 100 };
  return { state: drawToHandPost(6, '螺旋俯衝')(state, aIdx, pool), damage: 100 };
});

// ── 2. 龍之爆發 — 260 傷害 + 自己全部能量丟棄 ─────────────────────────────
regPost('竹蘭的烈咬陸鯊ex|龍之爆發', selfDiscardAllEnergyPost('龍之爆發'));

// ── 3. 竹蘭的尖牙陸鯊｜王者呼聲（特性）──────────────────────────────────────
// 每回合 1 次（ABILITY_USED 一次性規則由 engine 管控）：從牌庫選 1 張「竹蘭的」寶可夢加手牌。
regA('竹蘭的尖牙陸鯊', 0, (st, idx, pool) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '王者呼聲：牌庫為空', idx);
  
  st = addLog(st, '王者呼聲：從牌庫搜尋 1 張「竹蘭的」寶可夢加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'CynthiaPokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 4. 竹蘭的圓陸鯊｜岩石投擲 — 20 傷害（v4.495 改 skipResistancePre — 不計算抵抗力，弱點仍算）
//   玩家回報修補：原本誤套 skipWeakRes 連弱點也忽略，攻擊喵喵ex 沒套 ×2。卡面只說「不計算抵抗力」。
regPre('竹蘭的圓陸鯊|岩石投擲', skipResistancePre(20, '岩石投擲'));

// ── 5. 輝煌聲援（被動）— 上面 PASSIVE_ATTACK_BONUS 已登記，不需 regA ────────
// 被動特性在 engine 傷害計算時自動掃場觸發，不透過 ABILITY_EFFECTS。

// ── 6. 竹蘭的花岩怪｜激怒咒詛 —————————————————————————————————————
// 基礎傷害 0，對方戰鬥寶可夢每張自己備戰「竹蘭的」寶可夢的傷害指示物 +10；卡面「這個招式的傷害不計算弱點。」
// v2.22：卡名統一（pool.ts loadSet strip <>），只登錄純名稱即可
// v4.495：卡面只說「不計算弱點」（抵抗力仍計算）— 從 skipWeakRes 改為 skipWeakness
regPre('竹蘭的花岩怪|激怒咒詛', (state, aIdx, pool, _action) => {
  const p = state.players[aIdx];
  let totalMarkers = 0;
  for (const b of p.bench) {
    const card = pool.get(b.cardId);
    if (card?.name.includes('竹蘭的')) {
      // 以 10 為單位計數（傷害指示物每顆 10 HP）
      totalMarkers += Math.floor(b.damage / 10);
    }
  }
  const damage = totalMarkers * 10;
  const s = addLog(state, `激怒咒詛：備戰「竹蘭的」寶可夢傷害指示物合計 ${totalMarkers} 顆 → ${damage} 傷害（不計算弱點）`, aIdx);
  return { state: s, damage, skipWeakness: true };
});

// ── 7. 力量蛋白飲（Item）— 本回合自己 [鬥] 寶可夢招式傷害 +30 ──────────────
regG('力量蛋白飲', () => true);
reg('力量蛋白飲', (st, idx) => {
  st = addLog(st, '力量蛋白飲：本回合自己的【鬥】寶可夢招式傷害 +30', idx);
  return updatePlayer(st, idx, p => ({
    ...p,
    damageBoostFightingThisTurn: (p.damageBoostFightingThisTurn ?? 0) + 30,
  }));
});

// ── 8. 戰鬥鑼（Item）— 搜 1 張 [鬥] 基礎寶可夢 或 基本【鬥】能量 ───────────
regG('戰鬥鑼', (st, idx) => st.players[idx].deck.length > 0);
reg('戰鬥鑼', (st, idx) => {
  st = addLog(st, '戰鬥鑼：從牌庫選 1 張 [鬥] 基礎寶可夢 或 基本【鬥】能量加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'FightingBasicOrFightingEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 9. 寶可平板（Item）— 搜 1 張「非擁有規則」寶可夢 ─────────────────────
// 「擁有規則」= ex / VMAX / VSTAR / TAG TEAM 等。MVP 以 subtype==='ex' 或 name 尾 ex/EX 判定。
regG('寶可平板', (st, idx) => st.players[idx].deck.length > 0);
reg('寶可平板', (st, idx) => {
  st = addLog(st, '寶可平板：從牌庫選 1 張「非擁有規則」寶可夢加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonNonRule',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 10. 竹蘭的力量負重（道具）— TOOL_HP_BONUS 提供 +70 HP；
//        attach resolver 由 TOOL_* 自動登記區塊統一註冊 toolAttachEffect。 ────────

// ── 11. 火箭隊的拉姆達（Supporter）— v5.728 移除此處重複死碼；生效版實裝在下方
//        「搜任意 1 張訓練家加手牌」(filter AnyTrainer + search-pokemon-to-hand)。

// ── 12. 硬岩【鬥】能量 — 屬性：鬥（已由 engine SPECIAL_ENERGY_TYPES 處理） ──
// 補充：卡面另有「附著此能量的寶可夢不會受到對手寶可夢招式的效果的影響」，
// 這個 effect-immunity 子句目前暫未實裝，後續獨立一波處理（需在 ATTACK_POST / status / flag 套用前判斷）。

// 魔靈多龍牌組 Wave 43（黑夜魔靈 咒詛炸彈 / 多龍奇 / 願增猿 / 喵喵ex / 特殊紅牌 / 阿蜜的目光）
// — v2.65 搬到 effects/cards/maroon_dragon_deck.ts。side-effect import 見本檔頂部。
// BENCH_PLACE_TRIGGERS Map 實例亦一併搬到 _shared，本檔 re-export 給 engine.ts 使用。

// 白蕾雅：已搬遷到 ./effects/cards/white_lily_akamatsu.ts（v2.05）
// 莉莉艾的珍珠（Pokemon Tool）— v2.09 搬到 effects/cards/tools.ts
// Wave 44（胡地 + 瑪俐的長毛巨魔ex 兩組預組）— v2.64 搬到 effects/cards/abra_mawile_deck.ts

// ══════════════════════════════════════════════════════════════════════════════
// v2.22 新增：6 張卡
//   - 改造之錘（Item）—— 丟對手 1 隻寶可夢身上的 1 張特殊能量
//   - 小光（Supporter）—— 依序搜尋 1 基礎/1 一階進化/1 二階進化加手牌
//   - 鬥子（Supporter）—— 搜尋 1 進化寶可夢 + 1 能量加手牌
//   - 對戰圓形競技場（Stadium）—— 被動：備戰免於對手招式/特性放指示物（BENCH_PROTECTION_STADIUMS）
//   - 富裕能量（ACE SPEC Special Energy）—— 從手牌附加時抽 4
//   - 感應【超】能量（Special Energy）—— 附加到【超】寶可夢時搜尋至多 2 隻基礎【超】到備戰
// ══════════════════════════════════════════════════════════════════════════════

// ── 改造之錘（Item） ─────────────────────────────────────────────────────────
// 卡面：從對手任一隻寶可夢身上丟棄 1 張特殊能量。
// Guard：對手場上（含出場 + 備戰）至少 1 隻寶可夢附有特殊能量。
// UI：opp-poke-choose 並用 validIids 只顯示有特殊能量的寶可夢。
// Resolver：把該寶可夢身上「最後一張」特殊能量丟到對手棄牌區。
regG('改造之錘', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(pk => pk.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  }));
});
reg('改造之錘', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const cand = all.filter(pk => pk.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  }));
  if (cand.length === 0) return addLog(st, '改造之錘：對手場上沒有特殊能量', idx);
  const s = addLog(st, '改造之錘：選 1 隻對手附有特殊能量的寶可夢丟棄 1 張特殊能量', idx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'reform-hammer-discard',
    params: { includeActive: true, validIids: cand.map(c => c.iid) },
  });
});
// v5.423 Rule 7：原本選完寶可夢後自動丟末尾特殊能量 → 一隻身上有多種特殊能量時玩家無法選。
//   改成第二段 active-energy-discard（targetIid + validIids 只列特殊能量）讓玩家挑哪張。
//   參照粉碎之錘 crush-hammer 兩段範式，差別：只篩特殊能量。
regR('reform-hammer-discard', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  if (!targetIid) return st;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  // 列出該寶可夢身上所有「特殊能量」的 iid（一隻可能附多種不同特殊能量）
  const specialIids = target.energyAttached
    .filter(e => { const c = pool.get(e.cardId); return c?.supertype === 'Energy' && c.subtype === 'Special'; })
    .map(e => e.iid);
  if (specialIids.length === 0) {
    const tn = pool.get(target.cardId)?.name ?? '?';
    return addLog(st, `改造之錘：${tn} 身上沒有特殊能量`, idx);
  }
  const tn = pool.get(target.cardId)?.name ?? '?';
  const s = addLog(st, `改造之錘：選擇 ${tn} 身上要丟棄的 1 張特殊能量`, idx);
  // 第二段 picker：active-energy-discard 指向該對手寶可夢，validIids 只列特殊能量
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'reform-hammer-energy-pick',
    params: { targetIid, validIids: specialIids, titleOverride: '選擇要丟棄的對手特殊能量' },
  });
});
// v5.423 第二段：玩家在選定寶可夢身上挑 1 張特殊能量丟棄
regR('reform-hammer-energy-pick', (st, idx, iids, params, pool) => {
  const energyIid = iids[0];
  const targetIid = params?.targetIid as string | undefined;
  if (!energyIid || !targetIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const removed = target.energyAttached.find(e => e.iid === energyIid);
  if (!removed) return st;
  // 防呆：只允許丟特殊能量（picker 已篩，再驗一層）
  const rc = pool.get(removed.cardId);
  if (!(rc?.supertype === 'Energy' && rc.subtype === 'Special')) return st;
  const energyName = rc?.name ?? '特殊能量';
  const targetName = pool.get(target.cardId)?.name ?? '?';
  const s = addLog(st, `改造之錘：丟棄 ${targetName} 身上的特殊能量（${energyName}）`, idx);
  return updatePlayer(s, dIdx, p => {
    const updated = { ...target, energyAttached: target.energyAttached.filter(e => e.iid !== energyIid) };
    return {
      ...p,
      active: p.active?.iid === targetIid ? updated : p.active,
      bench: p.bench.map(c => c.iid === targetIid ? updated : c),
      discard: [...p.discard, removed],
    };
  });
});

// ── 小光（Supporter） ───────────────────────────────────────────────────────
// 卡面：從你的牌庫搜尋 1 張基礎寶可夢、1 張進化一階寶可夢、1 張進化二階寶可夢，
//      展示給對手後加進手牌，並重洗牌庫。
// 實裝：三段鏈式 deck-search（Basic → Stage1 → Stage2），每段 minCount:0 maxCount:1
//      （牌庫找不到時玩家可以直接 Skip 進下一段）。最後階段結束才 shuffle。
regG('小光', (st, idx) => st.players[idx].deck.length > 0);
reg('小光', (st, idx) => {
  const s = addLog(st, '小光：依序搜尋 1 基礎/1 進化一階/1 進化二階寶可夢加手牌', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'koharu-phase1',
  });
});
regR('koharu-phase1', (st, idx, iids, _params, pool) => {
  // 第 1 階段：Basic
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `小光（基礎）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '小光（基礎）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage1',
    minCount: 0, maxCount: 1,
    effectKey: 'koharu-phase2',
  });
});
regR('koharu-phase2', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `小光（進化一階）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '小光（進化一階）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage2',
    minCount: 0, maxCount: 1,
    effectKey: 'koharu-phase3',
  });
});
regR('koharu-phase3', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `小光（進化二階）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '小光（進化二階）：未選擇', idx);
  }
  // 三階段結束後重洗牌庫
  return updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 鬥子（Supporter） ───────────────────────────────────────────────────────
// 卡面：從你的牌庫搜尋 1 張進化寶可夢 + 1 張能量卡，展示後加進手牌並重洗牌庫。
regG('鬥子', (st, idx) => st.players[idx].deck.length > 0);
reg('鬥子', (st, idx) => {
  const s = addLog(st, '鬥子：搜尋 1 張進化寶可夢 + 1 張能量加手牌', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Evolution',
    minCount: 0, maxCount: 1,
    effectKey: 'touko-phase1',
  });
});
regR('touko-phase1', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `鬥子（進化寶可夢）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '鬥子（進化寶可夢）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy',
    minCount: 0, maxCount: 1,
    effectKey: 'touko-phase2',
  });
});
regR('touko-phase2', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `鬥子（能量）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '鬥子（能量）：未選擇', idx);
  }
  return updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 對戰圓形競技場（Stadium） ─────────────────────────────────────────────────
// 純被動：雙方備戰寶可夢不會因對手的招式與特性被放置傷害指示物。
// 放置走 engine PLAY_TRAINER/Stadium 分支；無需 reg(TRAINER_EFFECTS)。
// 被動 gate 在 stadiums.ts 的 BENCH_PROTECTION_STADIUMS 集合，所有 bench-damage resolver
// 都已經在觸發點呼叫 isBenchProtected(state, pool) 跳過傷害放置。

// 富裕能量 / 感應【超】能量 hooks 已搬到 effects/cards/energy_cards.ts（v2.66）。

// ══════════════════════════════════════════════════════════════════════════════
// v2.35：火箭隊的超夢ex / 猛雷鼓ex 兩組預組新卡的 effects（已全部實裝）
//
// 演進歷史：
//   v2.35：建立兩組 preset 卡表 + 大部分 effect 實裝；4 個 ability 與 1 個 stub
//          tool 留 known-gap stub（純 log 不阻塞遊戲）。
//   v2.57：把 4 個 known gap ability 全部補完：
//          - 操陷蛛｜充能 → regA（10462 起）
//          - 急凍鳥｜抵抗之幕 → PASSIVE_IMMUNITY hook（163/246/250）
//          - 莉莉艾的皮皮ex｜妖精領域 → 弱點覆寫 hook（215 + engine.ts:2479）
//          - 超夢ex｜力量抑制者 → engine ATTACK gate（engine.ts:2302）
//          擦除球（PRE_DISCARD_CHOICE 丟能）+ 謎擬Ｑ｜扮晶晶酒（copy-attack）也補完。
//   v2.52/v2.56：寶可裝置3.0 完整實裝（牌庫頂 7 → 選 1 張支援者，10618 起）。
//   v2.63 Bug C：力量抑制者 gate 細節調整（含戰鬥場計入 4 隻）。
//
// 故本檔案 10148-10170 行的「known gap」inventory comment 已在 v2.258 清掉。
// 若未來再新增類似批次卡表，記得別重複「inventory comment」pattern：
// 那種大塊註解很快就過時，演進歷史寫到對應 reg 旁邊更耐用。
// ══════════════════════════════════════════════════════════════════════════════

// 火箭隊能量 hook 已搬到 effects/cards/energy_cards.ts（v2.66）。

// ---- 火箭隊的接收器（Item）- 搜「火箭隊」Supporter 加手牌 ------------------
regG('火箭隊的接收器', (st, idx) => st.players[idx].deck.length > 0);
reg('火箭隊的接收器', (st, idx) => {
  st = addLog(st, '火箭隊的接收器：從牌庫選 1 張「火箭隊」支援者加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'RocketSupporter',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',   // 復用（與 Pokemon 搜尋同機制：加手牌+洗牌）
  });
});

// ---- 火箭隊的雅典娜（Supporter）- 抽到 5（若全場都是火箭隊則抽到 8）----------
reg('火箭隊的雅典娜', (st, idx, pool) => {
  const p = st.players[idx];
  const field = [...(p.active ? [p.active] : []), ...p.bench];
  const allRocket = field.length > 0 && field.every(c => (pool.get(c.cardId)?.name ?? '').includes('火箭隊的'));
  const target = allRocket ? 8 : 5;
  const toDraw = Math.max(0, target - p.hand.length);
  st = addLog(st, `火箭隊的雅典娜：抽到手牌滿 ${target} 張（抽 ${toDraw} 張${allRocket ? '（全場皆為火箭隊寶可夢）' : ''}）`, idx);
  return drawCards(st, idx, toDraw);
});

// ---- 火箭隊的蘭斯（Supporter）- 搜最多 3 張基礎火箭隊寶可夢 ------------------
//   備註：卡面「先攻玩家的最初回合也可使用」— engine 的 isFirstTurn supporter gate
//   會呼叫 canPlaySupporterOnFirstTurn(card) 檢查 rulesText 是否包含
//   「先攻玩家的最初回合」，命中就 bypass。v2.69 起改成由 engine 統一處理，
//   所以這裡不需要對這張卡做任何特例。
regG('火箭隊的蘭斯', (st, idx) => st.players[idx].deck.length > 0);
reg('火箭隊的蘭斯', (st, idx) => {
  st = addLog(st, '火箭隊的蘭斯：從牌庫選最多 3 張基礎的「火箭隊」寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'RocketBasic',
    minCount: 0, maxCount: 3,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ---- 火箭隊的坂木（Supporter）- 本方自換 + 對方被迫換 -----------------------
// 卡面：將自己的戰鬥場的「火箭隊的寶可夢」與備戰區的「火箭隊的寶可夢」互換。
//       然後，選 1 隻對手備戰寶可夢與對手戰鬥寶可夢互換。
// 實裝：
//   - 若戰鬥位與備戰皆有至少 1 隻火箭隊的寶可夢 → 進入 bench-choose（自方火箭隊備戰）
//     self-swap-rocket resolver 執行後接 opp-bench-choose → gust-opp。
//   - 若條件不齊（如戰鬥位非火箭隊 / 備戰沒有火箭隊）→ 跳過自換步驟直接進對方換。
regG('火箭隊的坂木', (st, idx, pool) => {
  const p = st.players[idx];
  const opp = st.players[(1 - idx) as 0 | 1];
  // v5.483 官方 Q&A：自己戰鬥場與備戰區都要有「火箭隊的寶可夢」才能使出（卡面第一句自換是必須效果，
  //   無火箭隊寶可夢可換則不能使出）；加上對手要有備戰才能進行對手互換。
  const activeIsRocket = !!p.active && (pool.get(p.active.cardId)?.name ?? '').includes('火箭隊的');
  const benchHasRocket = p.bench.some(c => (pool.get(c.cardId)?.name ?? '').includes('火箭隊的'));
  return activeIsRocket && benchHasRocket && opp.bench.length > 0;
});
reg('火箭隊的坂木', (st, idx, pool) => {
  const p = st.players[idx];
  const activeIsRocket = p.active && (pool.get(p.active.cardId)?.name ?? '').includes('火箭隊的');
  const rocketBench = p.bench.filter(c => (pool.get(c.cardId)?.name ?? '').includes('火箭隊的'));
  st = addLog(st, '火箭隊的坂木：自己戰鬥↔備戰互換火箭隊寶可夢，然後對手備戰↔戰鬥互換', idx);
  if (activeIsRocket && rocketBench.length > 0) {
    // 先自換：選 1 隻備戰火箭隊寶可夢
    return withPending(st, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'sakaki-self-swap',
      params: { validIids: rocketBench.map(c => c.iid) },
    });
  }
  // 條件不符：直接對方換
  st = addLog(st, '火箭隊的坂木：自方無可互換的火箭隊寶可夢，略過自換', idx);
  {
    // v5.700：supporter 強制換位 → 過濾化石/緊張感/融合為雪/廣域堡壘 免疫的對手備戰。
    const _oppIdx = (1 - idx) as 0 | 1;
    const _valid = st.players[_oppIdx].bench.filter(b => !_gustImmuneSupporter(st, _oppIdx, b, pool)).map(b => b.iid);
    if (_valid.length === 0) return addLog(st, '火箭隊的坂木：對手備戰沒有可呼叫的寶可夢（化石/緊張感/融合為雪/廣域堡壘 免疫）', idx);
    return withPending(st, {
      type: 'opp-bench-choose',
      actorIdx: idx, sourcePlayerIdx: _oppIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'gust-opp', params: { validIids: _valid },
    });
  }
});
regR('sakaki-self-swap', (st, idx, iids, _params, pool) => {
  const pickIid = iids[0];
  if (!pickIid) return st;
  const p = st.players[idx];
  const benchPick = p.bench.find(c => c.iid === pickIid);
  if (!p.active || !benchPick) return st;
  const aName = pool.get(p.active.cardId)?.name ?? '?';
  const bName = pool.get(benchPick.cardId)?.name ?? '?';
  st = addLog(st, `火箭隊的坂木：${aName}（戰鬥）↔ ${bName}（備戰）互換`, idx);
  st = updatePlayer(st, idx, pl => {
    if (!pl.active) return pl;
    // v4.978：set movedToActiveThisTurn — 振翅高飛/潔淨支援/金屬之路 等特性 gate 需要
    const newActive = { ...benchPick, movedToActiveThisTurn: true };
    // v2.49：離開戰鬥場清狀態旗標（修 sakaki-self-swap 的 bench status leak）
    const cleared = clearActiveEffects(pl.active);
    const newBench = pl.bench.map(c => c.iid === pickIid ? cleared : c);
    return { ...pl, active: newActive, bench: newBench };
  });
  // 再強迫對方換
  {
    // v5.700：supporter 強制換位 → 過濾化石/緊張感/融合為雪/廣域堡壘 免疫的對手備戰。
    const _oppIdx = (1 - idx) as 0 | 1;
    const _valid = st.players[_oppIdx].bench.filter(b => !_gustImmuneSupporter(st, _oppIdx, b, pool)).map(b => b.iid);
    if (_valid.length === 0) return addLog(st, '火箭隊的坂木：對手備戰沒有可呼叫的寶可夢（化石/緊張感/融合為雪/廣域堡壘 免疫）', idx);
    return withPending(st, {
      type: 'opp-bench-choose',
      actorIdx: idx, sourcePlayerIdx: _oppIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'gust-opp', params: { validIids: _valid },
    });
  }
});

// v5.525：自身戰鬥↔備戰互換共用 resolver（敏捷蟲|褪殼猛毒 / 狡兔三窟 等 5 張卡的 effectKey）。
//   先前完全沒註冊 → 玩家選了備戰寶可夢卻不互換（褪殼猛毒玩家回報）。鏡射 sakaki-self-swap：
//   outgoing(戰鬥→備戰)走 clearActiveEffects 全清；incoming(備戰→戰鬥)只設 movedToActiveThisTurn、不清狀態(保留奔流之心等 buff)。
regR('self-swap-active-bench', (st, idx, iids, _params, pool) => {
  const pickIid = iids[0];
  if (!pickIid) return st;  // 可不選(在 OPTIONAL_SELECTION_EFFECT_KEYS)：未選→不互換
  const p = st.players[idx];
  if (!p.active) return st;
  const benchPick = p.bench.find(c => c.iid === pickIid);
  if (!benchPick) return st;
  const aName = pool.get(p.active.cardId)?.name ?? '?';
  const bName = pool.get(benchPick.cardId)?.name ?? '?';
  let s2 = addLog(st, `${aName}（戰鬥）↔ ${bName}（備戰）互換`, idx);
  return updatePlayer(s2, idx, pl => {
    if (!pl.active) return pl;
    const newActive = { ...benchPick, movedToActiveThisTurn: true };
    const cleared = clearActiveEffects(pl.active);  // 戰鬥→備戰：全清狀態(含本回合 buff)
    const newBench = pl.bench.map(c => c.iid === pickIid ? cleared : c);
    return { ...pl, active: newActive, bench: newBench };
  });
});

// ---- 火箭隊的阿波羅（Supporter）- 上回合火箭隊寶可夢 KO'd 才可用 ------------
// 卡面：這張卡必須在上個對手的回合自己的「火箭隊的寶可夢」【昏厥】了才可使用。
//       雙方手牌放回牌庫重洗。然後抽牌：自己 5 張，對手 3 張。
// v2.70 gate：套用與「不公印章」相同的快照對比手法，但比的是
//   「自己棄牌堆中火箭隊寶可夢數量」而不是「對手獎賞張數」。
// v2.246 修：精確 KO cause tracking（不再有 false positive）
//   合法觸發：對手主回合中我方「火箭隊的」寶可夢被「招式 KO」+「主動特性 KO」
//   排除：checkup KO（中毒/灼傷/冰冷之帳）+ 自 KO（自己 main phase 自爆）
regG('火箭隊的阿波羅', (st, idx) => {
  const attackKO = st.oppAttackKOdMyRocketInLastOppTurn?.[idx] ?? 0;
  const abilityKO = st.oppAbilityKOdMyRocketInLastOppTurn?.[idx] ?? 0;
  return (attackKO + abilityKO) > 0;
});
reg('火箭隊的阿波羅', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '火箭隊的阿波羅：雙方手牌洗回牌庫，自己抽 5 / 對手抽 3', idx);
  // 雙方手牌放回牌庫並重洗
  st = returnHandToDeck(st, idx);
  st = returnHandToDeck(st, oppIdx);
  st = drawCards(st, idx, 5);
  st = drawCards(st, oppIdx, 3);
  return st;
});

// ---- 火箭隊的拉姆達（Supporter）- 搜任意 1 張訓練家加手牌 -------------------
regG('火箭隊的拉姆達', (st, idx) => st.players[idx].deck.length > 0);
reg('火箭隊的拉姆達', (st, idx, pool) => {
  st = addLog(st, '火箭隊的拉姆達：從牌庫搜尋 1 張訓練家卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'AnyTrainer',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',   // resolver 為「加手牌 + 洗牌」，對訓練家同樣適用
  });
});

// ---- 火箭隊的工廠（Stadium）— v2.57 實裝、實作在 engine.ts ----------------
// 卡面：在這個回合從手牌使出了名稱中有「火箭隊」的支援者卡的玩家，可從自己的牌庫抽出 2 張卡。
// 實裝路徑（不在這個檔案）：
//   - engine.ts PLAY_TRAINER Supporter 路徑：名稱含「火箭隊」→ 設 rocketSupporterPlayedThisTurn 旗標
//   - engine.ts USE_STADIUM 路徑：name === '火箭隊的工廠' → 檢查旗標 + 抽 2 張
//   - engine.ts END_TURN：清旗標
//   - types.ts PlayerState.rocketSupporterPlayedThisTurn 欄位
// v2.63 Bug B 後續調過抽卡按鈕觸發條件。

// ---- 碧草面具ex｜碧綠之舞（Ability）- 1/回合 附加基本草能量到自身 + 抽 1 ----
// 卡面原文：「從自己的手牌選擇1張『基本【草】能量』卡，附於這隻寶可夢身上。
//            然後，從自己的牌庫抽出1張卡。」
// 關鍵字「這隻寶可夢」＝發動特性的厄鬼椪 碧草面具ex 自身（非任意【草】寶可夢）。
// v2.53：先加 getUsableAbilities gate（手牌無基本草能量時不顯示特性按鈕）。
// v2.54：修正效果 — 自動附加到觸發源（無選擇 UI），再抽 1 張。
// v2.61：engine 會以第 4 參數 cardInst 傳入觸發源。舊實作在同回合兩隻同名
//   碧草面具ex 先後發動時，find(abilityUsedThisTurn===true) 會命中第一隻，
//   導致 B 發動卻附到 A。改用 cardInst.iid 精確定位，保留 name 掃場作為 fallback。
regA('厄鬼椪 碧草面具ex', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  // 找觸發源（發動特性的寶可夢）— 以 iid 為準
  const allPokes: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  const src = cardInst
    ? allPokes.find(c => c.iid === cardInst.iid)
    : allPokes.find(c => {
        const card = pool.get(c.cardId);
        return card?.name === '厄鬼椪 碧草面具ex' && c.abilityUsedThisTurn === true;
      });
  if (!src) return st;
  // v5.184：詛咒根擋手牌附能 — 自身受詛咒根影響時，無法附加能量
  if (src.cantAttachEnergyThisTurn) return addLog(st, '碧綠之舞：受詛咒根影響，本回合無法從手牌附加能量', idx);
  // 手牌需有基本草能量
  const grassEnergyInst = p.hand.find(c => {
    const card = pool.get(c.cardId);
    if (card?.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    return card.pokemonType === 'Grass' || card.name.includes('【草】');
  });
  if (!grassEnergyInst) return addLog(st, '碧綠之舞：手牌中沒有基本草能量', idx);
  const eName = pool.get(grassEnergyInst.cardId)?.name ?? '基本草能量';
  const sName = pool.get(src.cardId)?.name ?? '厄鬼椪 碧草面具ex';
  // 步驟 1：把能量從手牌直接附到自己身上（無需選擇 UI）
  st = addLog(st, `碧綠之舞：將 ${eName} 附加到 ${sName}`, idx);
  st = updatePlayer(st, idx, pl => {
    const newHand = pl.hand.filter(c => c.iid !== grassEnergyInst.iid);
    const attach = (c: CardInstance): CardInstance =>
      c.iid === src.iid ? { ...c, energyAttached: [...c.energyAttached, grassEnergyInst] } : c;
    return {
      ...pl,
      hand: newHand,
      active: pl.active ? attach(pl.active) : null,
      bench: pl.bench.map(attach),
    };
  });
  st = _magHeal(st, idx, [src.iid], pool);  // v5.485 自動治癒（瑪機雅娜在戰鬥場時）
  st = fireOnHandEnergyAttached(st, idx, src.iid, pool);  // v5.539 從手牌附能後觸發對手附能被動（侵蝕詛咒 等）
  // 步驟 2：抽 1 張
  st = addLog(st, '碧綠之舞：從牌庫抽 1 張', idx);
  return drawCards(st, idx, 1);
});

// ---- 超夢ex｜擦除球 attack（160 + 丟備戰能 ×60） --------------------------
// 卡面原文：160 — 若希望，將最多 2 張自己的備戰寶可夢身上附加的能量卡丟棄，
//            增加其張數×60 點傷害。
// v2.35 stub 對卡面誤解成「丟自己（戰鬥場）的超能量」。v2.57 修：
//   scope='own-bench'（只能丟備戰），min=0 max=2，每張 +60（base 160→最高 280）。
ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的超夢ex|擦除球', {
  min: 0, max: 2, scope: 'own-bench', baseDamage: 160, damagePerEnergy: 60,
});
regPre('火箭隊的超夢ex|擦除球', (state, aIdx, _pool, action) => {
  const player = state.players[aIdx];
  // 只列備戰寶可夢身上的能量
  type Loc = { benchIdx: number; energy: CardInstance };
  const eligible: Loc[] = [];
  player.bench.forEach((b, i) => {
    for (const e of b.energyAttached) eligible.push({ benchIdx: i, energy: e });
  });

  const chosenIids = action?.discardedEnergyIids;
  let selected: Loc[];
  if (chosenIids && chosenIids.length > 0) {
    const idSet = new Set(chosenIids);
    selected = eligible.filter(l => idSet.has(l.energy.iid)).slice(0, 2);
  } else {
    // AI fallback：不丟能（保守，基礎 160 即可）
    selected = [];
  }
  if (selected.length === 0) {
    return { state: addLog(state, '擦除球：未丟棄備戰能量 → 160', aIdx), damage: 160 };
  }

  const benchRm = new Map<number, Set<string>>();
  for (const s of selected) {
    const st = benchRm.get(s.benchIdx) ?? new Set<string>();
    st.add(s.energy.iid);
    benchRm.set(s.benchIdx, st);
  }
  const discardList = selected.map(s => s.energy);
  let s2 = updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map((b, i) => {
      const rm = benchRm.get(i);
      if (!rm || rm.size === 0) return b;
      return { ...b, energyAttached: b.energyAttached.filter(e => !rm.has(e.iid)) };
    }),
    discard: [...p.discard, ...discardList],
  }));
  const dmg = 160 + 60 * selected.length;
  s2 = addLog(s2, `擦除球：丟棄 ${selected.length} 個備戰能量 → ${dmg}`, aIdx);
  return { state: s2, damage: dmg };
});

// ---- 火箭隊的急凍鳥｜暗黑冰霜 ------------------------------------------------
// 卡面原文：60 — 若這隻寶可夢身上附有「火箭隊能量」，則增加 60 點傷害。
// v2.35 的 stub 註解把條件寫成「對手有特殊能量 +30」— 是錯的。
// v2.57 修正：條件是【攻擊者自身附有 "火箭隊能量" 特殊能量】，加成是 +60（60→120）。
regPre('火箭隊的急凍鳥|暗黑冰霜', (state, aIdx, pool) => {
  const atk = state.players[aIdx].active;
  let base = 60;
  if (atk) {
    const hasRocketEnergy = atk.energyAttached.some(e => {
      const card = pool.get(e.cardId);
      return card?.supertype === 'Energy' && card.name === '火箭隊能量';
    });
    if (hasRocketEnergy) base += 60;
  }
  return { state, damage: base };
});

// ---- v2.57：火箭隊的超夢 預組 特性實裝 --------------------------------------
// 操陷蛛｜充能（主動）：1 回合 1 次，從棄牌區選 1 張基本能量附於此寶可夢。
// 實裝方式：regA → discard-search filter=BasicEnergy → 自訂 resolver 附於觸發源。
// v5.074 (Wilson 玩家回報根因)：用第 4 參數 cardInst.iid 取代 findAbilityUserIid。
//   原 helper 在 3 隻同回合用「充能」時掃到第 1 隻已標記的就 return，導致後續觸發
//   都把能量誤附到第 1 隻。改用 engine 傳的觸發 CardInstance 直接讀正確的 iid。
regA('火箭隊的操陷蛛', 0, (st, idx, pool, cardInst) => {
  const userIid = cardInst?.iid;
  if (!userIid) return st;
  const p = st.players[idx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (cand.length === 0) return addLog(st, '充能：棄牌區沒有基本能量', idx);
  st = addLog(st, '充能：從棄牌區選 1 張基本能量附於此寶可夢', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 1, maxCount: 1,
    effectKey: 'rocket-ariados-attach-self',
    params: { userIid, label: '充能' },
  });
});

regR('rocket-ariados-attach-self', (st, idx, iids, params, pool) => {
  const userIid = params?.userIid as string | undefined;
  const label = (params?.label as string) ?? '充能';
  if (!userIid) return st;
  const p = st.players[idx];
  const energies = p.discard.filter(c => iids.includes(c.iid));
  if (energies.length === 0) return st;
  const target = p.active?.iid === userIid ? p.active : p.bench.find(c => c.iid === userIid);
  if (!target) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  const eName = pool.get(energies[0].cardId)?.name ?? '能量';
  const s = addLog(st, `${label}：將 ${eName} 附加到 ${tname}`, idx);
  return updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => !iids.includes(c.iid));
    if (pl.active && pl.active.iid === userIid) {
      return { ...pl, discard: rest,
        active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
    }
    return { ...pl, discard: rest,
      bench: pl.bench.map(c => c.iid === userIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] } : c) };
  });
});

// ---- 火箭隊的謎擬Ｑ｜扮晶晶酒（copy-attack, v2.57／v2.70） -----------------
// 卡面原文：選擇1個對手的戰鬥場的「太晶」寶可夢持有的招式，作為這個招式使用。
//
// 實裝策略（v2.57 務實版）：
//   AttackPreFn 是同步的，無法在攻擊中途彈 UI 讓玩家挑招式。
//   因此採「自動挑選」路線 — 只考慮對手戰鬥場，若為太晶寶可夢：
//     (1) 挑「印刷傷害最高」的招式（解析前導整數；全 0 則退回第一招）。
//     (2) 非太晶 / 無戰鬥場 → log 並回傳 damage=0。
//
// v2.70 修正（Leon 回報）：萬葉陣雨（= 基礎 30 + 雙方出場能量 × 30）用扮晶晶酒
//   複製只出 30 點傷害，因為舊版只解析「印刷的前導整數」。這版改成：
//   1) 遞迴呼叫被複製招式的 ATTACK_PRE，取回正確 damage + skipWeakRes / skipDefEffects。
//   2) 將被複製的 effectKey 存到 state.pendingCopyAttackKey，好讓下面的 regPost 能
//      轉接呼叫被複製招式的 ATTACK_POST（處理 pendingSelection 類附加效果）。
//   3) 若被複製招式沒有註冊 PRE，維持 v2.57 路徑（解析印刷傷害）。
//   引擎仍會自己走弱點／抵抗／道具 +N 那段流程；這裡只接 PRE/POST 附加效果層。
regPre('火箭隊的謎擬Ｑ|扮晶晶酒', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppActive = state.players[dIdx].active;
  if (!oppActive) {
    return { state: addLog(state, '扮晶晶酒：對手沒有戰鬥寶可夢', aIdx), damage: 0 };
  }
  const oppCard = pool.get(oppActive.cardId);
  if (!oppCard || !oppCard.tags?.includes('太晶')) {
    const oname = oppCard?.name ?? '?';
    return { state: addLog(state, `扮晶晶酒：${oname} 不是「太晶」寶可夢，無法扮演`, aIdx), damage: 0 };
  }
  const atks = oppCard.attacks ?? [];
  if (atks.length === 0) {
    return { state: addLog(state, `扮晶晶酒：${oppCard.name} 沒有可以扮演的招式`, aIdx), damage: 0 };
  }
  // v3.873：先試 action.copyAttackChoice（玩家透過 UI 自選的招式 index）— 解決：
  //   1) 啜泣（20）一直被自動挑最高 logic 蓋掉，永遠用不到
  //   2) 借 激流水泵 時 picker 不開（key 不匹配） → option 永遠不觸發
  // 無 copyAttackChoice（AI / 舊 state）→ fallback 自動挑印刷最高（v2.57 行為）。
  const choice = action?.copyAttackChoice;
  let picked: typeof atks[number];
  let pickedDmg = 0;
  const parseDmg = (s: string): number => {
    const m = s.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  if (choice && choice.attackIndex >= 0 && choice.attackIndex < atks.length) {
    picked = atks[choice.attackIndex];
    pickedDmg = parseDmg(picked.damage);
  } else {
    // fallback：挑印刷最高那招（全 0 退回第一招）
    picked = atks[0];
    pickedDmg = parseDmg(picked.damage);
    for (let i = 1; i < atks.length; i++) {
      const d = parseDmg(atks[i].damage);
      if (d > pickedDmg) { picked = atks[i]; pickedDmg = d; }
    }
  }
  // 被複製招式的 effectKey（與 engine.ts 的 effectKey 組法一致）
  const copiedKey = `${oppCard.name}|${picked.name}`;
  let s = addLog(state, `扮晶晶酒：扮演 ${oppCard.name} 的「${picked.name}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };

  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    // 遞迴呼叫被複製招式 PRE — 傷害以 PRE 回傳為準（涵蓋 ×能量 / +條件 等動態計算）。
    // 傳 action（含 discardedEnergyIids），好讓 PRE_DISCARD_CHOICE 類招式（激流水泵 等）拿到玩家挑的能量 iid。
    const sub = copiedPre(s, aIdx, pool, action);
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: sub.skipWeakRes,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 被複製招式沒有註冊 PRE → 走 v2.57 舊路徑：解析印刷傷害
  return { state: s, damage: pickedDmg };
});

// POST 轉接：engine 走完傷害施加後，查本招式的 POST → 這邊將 state.pendingCopyAttackKey
// 轉去呼叫被複製招式的 POST（例如 pendingSelection 類附加效果），完成後清除旗標。
// v3.873：接收 action 並轉接 — 激流水泵 等 option-style POST 需要 action.discardedEnergyIids 判斷是否觸發。
regPost('火箭隊的謎擬Ｑ|扮晶晶酒', copyAttackPostDispatch); // v5.722 收斂

// ---- Known gap 特性 stubs（log only）--------------------------------------
// 這些特性需要引擎擴充才能完整實裝。目前寫成說明 log，避免預組無法放入編輯器。
// v2.57 進度：操陷蛛 充能 / 急凍鳥 抵抗之幕 / 皮皮ex 妖精領域 / 超夢ex 力量抑制者 → 全部已實裝。
// 力量抑制者為 engine 層 gate（見 engine.ts 的 ATTACK handler + getAvailableAttacks），不在此處 regA。
// 扮晶晶酒為務實 copy-attack（自動挑對手太晶最高傷害招式，不遞迴附加效果）。

// ══════════════════════════════════════════════════════════════════════════════
// 猛雷鼓預組：新物品卡
// ══════════════════════════════════════════════════════════════════════════════

// ---- 能量回收（Item）- 棄牌區選最多 2 張基本能量 → 給對手看 → 加手牌 -------------
// 卡面（MC/SV11W/SVQL 同）：「從自己的棄牌區選擇最多2張基本能量卡，在給對手看過後加入手牌。」
// v2.60 修正：原本錯誤沿用上古版（擲幣：正 4/反 2），實際新版 I/J regulation 已不擲幣。
// 「給對手看」語意在本模擬器中為隱含 — 棄牌區對雙方公開、picker UI 選擇也會留 log。
regG('能量回收', (st, idx, pool) =>
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  })
);
reg('能量回收', (st, idx) => {
  st = addLog(st, '能量回收：從棄牌區選最多 2 張基本能量加入手牌（給對手看）', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',  // 只基本能量（v2.40 根源 bug 修正後；不含 Special Energy）
    minCount: 0, maxCount: 2,
    effectKey: 'discard-to-hand',
  });
});

// ---- 寶可裝置3.0（Item）- 查看牌庫頂 7，選 1 張支援者加手牌 ------------------
// v2.56 修正：原 stub 註解誤寫成「附加到自己的寶可夢類 Tool」— 實際卡面是 Item：
//   「查看自己的牌庫上方7張卡，從其中選擇1張支援者卡，在給對手看過後加入手牌。
//    將剩餘卡放回牌庫並重洗。」
// 機制與 米立龍｜集客 幾乎一樣，只是 top 6 → top 7。
regG('寶可裝置3.0', (st, idx) => st.players[idx].deck.length > 0);
reg('寶可裝置3.0', (st, idx) => {
  const p = st.players[idx];
  const top7 = p.deck.slice(0, 7);
  if (top7.length === 0) return addLog(st, '寶可裝置3.0：牌庫為空', idx);
  st = addLog(st, '寶可裝置3.0：查看牌庫頂 7 張，選 1 張支援者加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter:TOP7',
    minCount: 0, maxCount: 1,
    effectKey: 'pokegear-fetch-supporter',
    params: { top7Iids: top7.map(c => c.iid) },
  });
});
regR('pokegear-fetch-supporter', (st, idx, iids, params, pool) => {
  const top7Iids = (params?.top7Iids as string[]) ?? [];
  // v5.053 Rule 8 揭示資訊：卡面「在給對手看過後加入手牌」— 必須公開揭示卡名（addLog 非 addPrivateLog）
  // 玩家回報「對手用寶可裝置3.0 後 log 看不到對方選了哪張卡」— 修補揭示。
  const p0 = st.players[idx];
  const chosenInsts = p0.deck.filter(c => top7Iids.includes(c.iid) && iids.includes(c.iid));
  const chosenNames = chosenInsts.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const s0 = chosenNames
    ? addLog(st, `寶可裝置3.0：選擇了「${chosenNames}」加入手牌（公開）`, idx)
    : addLog(st, '寶可裝置3.0：未選擇任何支援者，重洗牌庫', idx);
  return updatePlayer(s0, idx, (p) => {
    const top7 = p.deck.filter(c => top7Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top7Iids.includes(c.iid));
    const chosen = top7.filter(c => iids.includes(c.iid));
    const remaining = top7.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...chosen],
    };
  });
});

// ---- 太晶珠（Item）- 從牌庫搜 1 張「太晶」寶可夢加手牌 -----------------------
regG('太晶珠', (st, idx) => st.players[idx].deck.length > 0);
reg('太晶珠', (st, idx, pool) => {
  st = addLog(st, '太晶珠：從牌庫搜尋 1 張「太晶」寶可夢卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TeraPokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ---- 捕蟲組合（Item）- 查看牌庫頂 7，選最多 2 張草寶可夢/草能量加手牌 -------
// v2.54 修正：卡面明寫「上方 7 張」（原實裝為 top 6 — 錯誤）。
// v2.55 修正：filter 改用 ':TOP7' 後綴把範圍限定在前 7 張 — v2.54 只改了數字但沒
// 改 filter，UI selectionItems 走 default 分支還是檢索整個牌庫。
// 機制類似 米立龍｜集客（Supporter:TOP6）：peek top N → pick up to 2 → 剩下回底重洗。
regG('捕蟲組合', (st, idx) => st.players[idx].deck.length > 0);
reg('捕蟲組合', (st, idx) => {
  const p = st.players[idx];
  const top7 = p.deck.slice(0, 7);
  if (top7.length === 0) return addLog(st, '捕蟲組合：牌庫為空', idx);
  st = addLog(st, '捕蟲組合：查看牌庫頂 7 張，選最多 2 張基本草寶可夢或基本草能量加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'GrassBasicOrGrassEnergy:TOP7',
    minCount: 0, maxCount: 2,
    effectKey: 'bug-catcher-set',
    params: { top7Iids: top7.map(c => c.iid) },
  });
});
regR('bug-catcher-set', (st, idx, iids, params, pool) => {
  const top7Iids = new Set<string>((params?.top7Iids as string[]) ?? []);
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid) && top7Iids.has(c.iid));
  const chosenIids = new Set(chosen.map(c => c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `捕蟲組合：${names} 加入手牌，其餘放回牌庫底（重洗）`, idx);
  } else {
    st = addLog(st, '捕蟲組合：未選擇任何卡，全部放回牌庫底（重洗）', idx);
  }
  return updatePlayer(st, idx, p => ({
    ...p,
    hand: [...p.hand, ...chosen],
    deck: shuffle(p.deck.filter(c => !chosenIids.has(c.iid))),
  }));
});

// ---- 能量轉移（Item）- 把 1 張基本能量從自己的寶可夢移到另一隻 -------------
// v2.231 升級為完整 3 步（不再簡化）：
//   1. 選來源（自己寶可夢身上有基本能量者）— heal-target validIids
//   2. 選來源身上的基本能量（多張時開 modal-choice 列舉，1 張時 fast path）
//   3. 選目的地寶可夢 — heal-target
// （之前自動挑第 1 張基本能量對多色寶可夢不正確）
regG('能量轉移', (st, idx, pool) => {
  const p = st.players[idx];
  const allField = [...(p.active ? [p.active] : []), ...p.bench];
  if (allField.length < 2) return false;  // 至少 2 隻才有「轉移」空間
  return allField.some(poke => poke.energyAttached.some(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }));
});
reg('能量轉移', (st, idx, pool) => {
  const p = st.players[idx];
  const allField = [...(p.active ? [p.active] : []), ...p.bench];
  const sources = allField.filter(poke => poke.energyAttached.some(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }));
  if (sources.length === 0) return addLog(st, '能量轉移：沒有寶可夢身上有基本能量', idx);
  st = addLog(st, '能量轉移：選擇「移出」基本能量的來源寶可夢', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-switch-src',
    params: {
      validIids: sources.map(c => c.iid),
      titleOverride: '能量轉移：選擇要移出基本能量的寶可夢',
    },
  });
});
regR('energy-switch-src', (st, idx, iids, _params, pool) => {
  const srcIid = iids[0];
  if (!srcIid) return st;
  const p = st.players[idx];
  const srcPoke = p.active?.iid === srcIid ? p.active : p.bench.find(c => c.iid === srcIid);
  if (!srcPoke) return st;
  // 找來源身上所有基本能量
  const basicEnergies = srcPoke.energyAttached.filter(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (basicEnergies.length === 0) return st;
  const srcName = pool.get(srcPoke.cardId)?.name ?? '?';
  // v2.231：多張基本能量 → 開 modal-choice 讓玩家選；1 張時 fast path 直接走 dst
  if (basicEnergies.length > 1) {
    st = addLog(st, `能量轉移：${srcName} 身上有 ${basicEnergies.length} 張基本能量，選擇 1 張移出`, idx);
    return withPending(st, {
      type: 'modal-choice',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'energy-switch-pick-energy',
      params: {
        label: '能量轉移',
        srcIid,
        energyIids: basicEnergies.map(e => e.iid),
        options: basicEnergies.map((e, i) => ({
          id: `${i}`,
          text: `${i + 1}. ${pool.get(e.cardId)?.name ?? '?'}`,
        })),
      },
    });
  }
  // 1 張：fast path
  return resolveEnergySwitchAfterPick(st, idx, srcIid, basicEnergies[0], pool);
});
// v2.231：玩家選完能量後，繼續選目的地
regR('energy-switch-pick-energy', (st, idx, iids, params, pool) => {
  const choiceIdx = parseInt(iids[0] ?? '0', 10);
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  const srcIid = (params?.srcIid as string | undefined) ?? '';
  const energyIid = energyIids[choiceIdx];
  if (!srcIid || !energyIid) return st;
  const p = st.players[idx];
  const srcPoke = p.active?.iid === srcIid ? p.active : p.bench.find(c => c.iid === srcIid);
  if (!srcPoke) return st;
  const energyInst = srcPoke.energyAttached.find(e => e.iid === energyIid);
  if (!energyInst) return st;
  return resolveEnergySwitchAfterPick(st, idx, srcIid, energyInst, pool);
});
// v2.231 helper：取下能量並開目的地 pending（pick energy 之後 / 1 張時 fast path）
function resolveEnergySwitchAfterPick(
  st: GameState, idx: 0 | 1, srcIid: string,
  energyInst: CardInstance, pool: Map<string, Card>,
): GameState {
  const srcPoke = st.players[idx].active?.iid === srcIid
    ? st.players[idx].active
    : st.players[idx].bench.find(c => c.iid === srcIid);
  const srcName = srcPoke ? (pool.get(srcPoke.cardId)?.name ?? '?') : '?';
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  // 從來源移除 energyInst
  st = updatePlayer(st, idx, pl => {
    const remove = (c: CardInstance) => ({
      ...c, energyAttached: c.energyAttached.filter(e => e.iid !== energyInst.iid)
    });
    let active = pl.active;
    if (active?.iid === srcIid) active = remove(active);
    const bench = pl.bench.map(c => c.iid === srcIid ? remove(c) : c);
    return { ...pl, active, bench };
  });
  st = addLog(st, `能量轉移：從 ${srcName} 取下 ${eName}，選擇目的地寶可夢`, idx);
  const pp = st.players[idx];
  const allTargets = [...(pp.active ? [pp.active] : []), ...pp.bench]
    .filter(c => c.iid !== srcIid);
  if (allTargets.length === 0) {
    st = addLog(st, '能量轉移：沒有其他寶可夢，能量移回手牌', idx);
    return updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, energyInst] }));
  }
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-switch-dst',
    params: {
      energyInstance: energyInst,
      validIids: allTargets.map(c => c.iid),
      titleOverride: `能量轉移：選擇附加 ${eName} 的目的地寶可夢`,
    },
  });
}
regR('energy-switch-dst', (st, idx, iids, params, pool) => {
  const dstIid = iids[0];
  const energyInst = params?.energyInstance as CardInstance | undefined;
  if (!dstIid || !energyInst) return st;
  const p = st.players[idx];
  const dstPoke = p.active?.iid === dstIid ? p.active : p.bench.find(c => c.iid === dstIid);
  if (!dstPoke) return st;
  const dstName = pool.get(dstPoke.cardId)?.name ?? '?';
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  st = addLog(st, `能量轉移：將 ${eName} 附加到 ${dstName}`, idx);
  return updatePlayer(st, idx, pl => {
    const attach = (c: CardInstance) => ({ ...c, energyAttached: [...c.energyAttached, energyInst] });
    let active = pl.active;
    if (active?.iid === dstIid) active = attach(active);
    const bench = pl.bench.map(c => c.iid === dstIid ? attach(c) : c);
    return { ...pl, active, bench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.127 — preset 牌組未實裝招式/特性補完（Leon 要求全部實裝）
// 9 張卡：甲賀忍蛙ex MC｜變幻手裏劍 / SV5a｜忍之利刃 + 分身連打、月月熊 赫月｜經驗法則
//   菊草葉｜叫聲、呱頭蛙｜招集之術、巨金怪｜彈回 + 金屬之錘、酋雷姆｜反等離子
// ══════════════════════════════════════════════════════════════════════════════

// ── 1) 甲賀忍蛙ex (MC 208/742)｜變幻手裏劍 100+ — 擲幣正面 +100
regPre('甲賀忍蛙ex|變幻手裏劍', coinPlusDmg(100, 100));

// ══════════════════════════════════════════════════════════════════════════
// v5.534 中央收斂：「傷害 + 若希望從牌庫任選最多 N 張加手牌（重洗）」型招式
//   ── 效果（牌庫搜尋）先於傷害（同 v5.509 螺旋俯衝精神 / 櫻花魚漸強波 regPre0 範本）
//
// 玩家報：甲賀忍蛙ex｜忍之利刃 KO 對手時，會「先拿獎賞卡才開搜尋視窗」。
//   根因＝v5.466 自動拿獎在 KO 當下發生於引擎主傷害區；而這類招式原本把傷害留在
//   引擎（regPre 設傷害），搜尋 picker 在 regPost（傷害之後）→ KO→拿獎 先於玩家選卡。
//   官方順序應是先做招式效果（搜尋），昏厥／拿獎在招式完全結算後。
//
// 修法（中央管線，一勞永逸）：regPre 把傷害設 0（延後），搜尋 picker 的 resolver
//   做完搜尋後，才用中央 dealAttackDamageToTarget 造傷害（弱抗／免疫／攻擊方加成／
//   KO／自動拿獎一次到位）。順序變為：(若希望 yes/no) → 搜尋選卡 → 造傷害 → 昏厥 → 拿獎。
//   ⚠ 引擎 inline 的「消耗型」加成（damageBonusThisTurn 回合加傷／nextOwnAttackPenalty
//     ／格拉吉歐的決戰）在 baseDamage=0 時不套（v5.517 既定「消耗型旗標留引擎」）；
//     這幾隻攻擊者實務上無卡會對其設這些旗標（格拉吉歐限非規則寶可夢且為低傷輔助招），
//     與 櫻花魚漸強波／波動突刺 同 pattern，可接受。
const DAMAGE_AFTER_DECK_SEARCH_KEY = 'damage-after-deck-search-to-hand';
function registerDamageThenOptionalDeckSearchToHand(
  attackName: string, opts: { damage: number; maxCount: number; logName: string },
): void {
  // 傷害延後：引擎主管線造 0，真正傷害在搜尋後由 resolver / 「否」分支結算
  regPre(attackName, (state) => ({ state, damage: 0 }));
  regPost(attackName, (state, aIdx, pool, action) => {
    const ln = opts.logName;
    const dealNow = (s: GameState): GameState => {
      const dIid = s.players[(1 - aIdx) as 0 | 1].active?.iid;
      return dIid ? dealAttackDamageToTarget(s, aIdx, dIid, opts.damage, pool, { label: ln }) : s;
    };
    // 若希望 binary-yes-no：選「否」→ 不搜尋，直接造傷害
    const chosen = action?.discardedEnergyIids;
    const choseYes = chosen === undefined ? true : chosen.length >= 1;
    if (!choseYes) return dealNow(addLog(state, `${ln}：選擇「否」 — 跳過搜尋`, aIdx));
    const p = state.players[aIdx];
    if (p.deck.length === 0) return dealNow(addLog(state, `${ln}：牌庫已空，跳過搜尋`, aIdx));
    const max = Math.min(opts.maxCount, p.deck.length);
    const s = addLog(state, `${ln}：若希望，從牌庫任選 0~${max} 張卡加手牌（之後重洗），確定後造成傷害`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'any',
      minCount: 0, maxCount: max,
      effectKey: DAMAGE_AFTER_DECK_SEARCH_KEY,
      params: { dmg: opts.damage, logName: ln },
    });
  });
}
// 共用 resolver：搜尋（加手牌＋重洗）→ 最後才造傷害（效果先於傷害）
regR(DAMAGE_AFTER_DECK_SEARCH_KEY, (state, aIdx, selectedIids, params, pool) => {
  const ln = (params?.logName as string) ?? '招式';
  let s = state;
  const picks = s.players[aIdx].deck.filter(c => selectedIids.includes(c.iid));
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !selectedIids.includes(c.iid))),
    hand: [...p.hand, ...picks],
  }));
  if (picks.length > 0) {
    const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // 自牌庫搜尋具體卡名僅給自己看；對手看脫敏版
    s = addPrivateLog(s,
      `${ln}：搜到 ${names} 加入手牌，重洗牌庫`,
      `${ln}：搜到 ${picks.length} 張卡加入手牌，重洗牌庫`, aIdx);
  } else {
    s = addLog(s, `${ln}：未選卡，重洗牌庫`, aIdx);
  }
  // 搜尋完才造傷害（KO→自動拿獎在此之後發生）
  const dmg = Number(params?.dmg) || 0;
  const dIid = s.players[(1 - aIdx) as 0 | 1].active?.iid;
  if (dIid && dmg > 0) s = dealAttackDamageToTarget(s, aIdx, dIid, dmg, pool, { label: ln });
  return s;
});
// ── 2) 甲賀忍蛙ex (SV5a)｜忍之利刃 170 — 若希望，從牌庫任選 1 張卡加手牌（重洗）
registerDamageThenOptionalDeckSearchToHand('甲賀忍蛙ex|忍之利刃', { damage: 170, maxCount: 1, logName: '忍之利刃' });
// 詛咒娃娃|玩偶捕捉 80（原在 m5_preview.ts，v5.534 收斂集中至此）
registerDamageThenOptionalDeckSearchToHand('詛咒娃娃|玩偶捕捉', { damage: 80, maxCount: 1, logName: '玩偶捕捉' });

// ── 3) 甲賀忍蛙ex (SV5a)｜分身連打 — 棄 2 個能量 → 對手 2 隻寶可夢各 120 傷
//   卡面：「對手的 2 隻寶可夢各受到 120 點傷害。[在備戰區不計算弱點・抵抗力。]」
//   ＝ 戰鬥場那隻仍計算弱抗；備戰位才不計。
//   v2.129：能量丟棄改用 'units' — 1 張燃火能量（附於進化）= 3 個無能量單位 → 1 張就達標。
// v4.09 修：原 max:null 無上限導致玩家可丟超過 2 units 把能量丟光光。
//   卡面「將 2 個能量丟棄」是恰好 2 units（非 ≥2），改 max: 2 鎖住上限。
ATTACK_PRE_DISCARD_CHOICE.set('甲賀忍蛙ex|分身連打', {
  min: 2, max: 2, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0,
  countMode: 'units',
});
// v4.48 修：原 PRE 沒讀 action.discardedEnergyIids 也沒丟能量 — 玩家在 picker 選的能量
// 永遠不會被丟（玩家回報 bug）。仿龍之滑翔 v4.13 pattern 補上能量丟棄邏輯。
regPre('甲賀忍蛙ex|分身連打', (state, aIdx, _pool, action) => {
  let s = state;
  const p = state.players[aIdx];
  const all = p.active?.energyAttached ?? [];
  // 玩家所選 / AI fallback（取後 2 個自身能量）
  const selected = action?.discardedEnergyIids && action.discardedEnergyIids.length > 0
    ? action.discardedEnergyIids.slice(0, 2)
    : all.slice(-2).map(e => e.iid);
  if (selected.length > 0) {
    const chosenSet = new Set(selected);
    s = updatePlayer(state, aIdx, pl => {
      if (!pl.active) return pl;
      const discarded = pl.active.energyAttached.filter(e => chosenSet.has(e.iid));
      return {
        ...pl,
        active: { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => !chosenSet.has(e.iid)) },
        discard: [...pl.discard, ...discarded],
      };
    });
    s = addLog(s, `分身連打：丟棄 ${selected.length} 個自身能量`, aIdx);
  }
  return { state: s, damage: 0 };
});
regPost('甲賀忍蛙ex|分身連打', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  const all = [...(d.active ? [d.active] : []), ...d.bench];
  if (all.length === 0) {
    return addLog(state, '分身連打：對手場上無寶可夢', aIdx);
  }
  const maxN = Math.min(2, all.length);
  const s = addLog(state, `分身連打：選對手 ${maxN} 隻寶可夢，各 120 點傷害（戰鬥場計算弱抗、備戰位不計）`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: maxN, maxCount: maxN,
    effectKey: 'clone-strike-multi-hit',
    params: { dmg: 120, label: '分身連打' },
  });
});
// v2.129：通用「對所選任一寶可夢造成 dmg；戰鬥場套弱抗、備戰不計」resolver。
//   完整 KO 流程（取獎、棄牌、game-over check）。
//   也可給未來其他「對 N 隻寶可夢各造成傷害（在備戰區不計算弱抗）」的招式重用。
regR('clone-strike-multi-hit', (st, actorIdx, selectedIids, params, pool) => {
  const baseDmg = (params?.dmg as number) ?? 0;
  const label = (params?.label as string) ?? '招式';
  if (baseDmg <= 0 || selectedIids.length === 0) return st;
  let s = st;
  const attacker = st.players[actorIdx].active;
  const attackerCard = attacker ? pool.get(attacker.cardId) : null;
  // v5.436：分身連打/大吼大叫/三色炮 的受傷反擊改走共用 fireDefenderOnDamaged，
  //   與中央函式 / snipe-multi 同一條（原本只 inline SPECIAL_ENERGY + 龐克頭盔累計，
  //   缺 TOOL_ON_DAMAGED/還擊斧/反擊特性/警備濁霧 4 種）。
  for (const iid of selectedIids) {
    const dIdx = (1 - actorIdx) as 0 | 1;
    const defender = s.players[dIdx];
    const isActive = defender.active?.iid === iid;
    const target = isActive ? defender.active! : defender.bench.find(c => c.iid === iid);
    if (!target) continue;
    const targetCard = pool.get(target.cardId);
    // v4.975: 統一守護 — active + bench 都過 canApplyEffectToTarget
    //   bench: 對戰圓形 / 花之帷幔 / 太晶 / 中立中心 等（同 v2.129 原行為）
    //   active: 飛翔 / 要害斬 / 阿塞蘿拉 / 中立中心 / 精神防護 / 閃光屏障 / 熔岩之壁 等
    //   （v4.975 新增；之前只查 bench 路徑導致 ex.g. 飛翔擋不住分身連打 bug）
    const guard = canApplyEffectToTarget(s, actorIdx, target, targetCard, 'attack-damage', pool, { isBench: !isActive });
    if (guard.blocked) {
      s = addLog(s, `${label}：${targetCard?.name ?? '?'} 因${guard.reason}不受傷害`, actorIdx);
      continue;
    }
    // 戰鬥場：套用弱點 ×2；備戰位：不計弱抗（卡面明示）
    let dmg = baseDmg;
    // v5.673：弱點+抵抗力收斂到中央 applyWeakRes(妖精領域/掌握弱點/弱點失效/攻擊方雙屬性)。
    if (isActive) {
      dmg = applyWeakRes(s, actorIdx, target, targetCard, dmg, pool);
    }
    // v5.153：active 補套 resistance + 攻擊方 tool（猛攻手鐲）
    //   Wilson 回報多目標招式對戰鬥場 ex 沒算 +30。
    if (isActive) {
      // v5.673：resistance 已併入上方 applyWeakRes(中央收斂)。
      // TOOL_ATTACK_BONUS — iterate 攻擊方所有道具
      if (attacker && attackerCard) {
        for (const t of getAllAttachedTools(attacker)) {
          const atkTool = pool.get(t.cardId);
          if (!atkTool) continue;
          const fn = TOOL_ATTACK_BONUS.get(atkTool.name);
          if (!fn) continue;
          const bonus = fn(attackerCard, attacker, targetCard ?? attackerCard, target);
          if (bonus > 0) dmg += bonus;
        }
      }
    }
    // v5.583：套防守方特性/場地【傷害減免】（捲牆/守護之鐘/齒輪塗層/凍原堡壘/自身減傷特性），
    //   active+bench 皆適用（收斂 _applyBenchAbilityReduce；分身連打過去備戰漏套）。
    if (dmg > 0 && targetCard) {
      const _rd = _applyBenchAbilityReduce(s, target, targetCard, dIdx, actorIdx, pool, dmg);
      if (_rd.amount !== dmg && _rd.logs.length > 0) s = addLog(s, `${targetCard.name}：${_rd.logs.join('、')}`, null);
      dmg = _rd.amount;
    }
    // v5.599 擲幣免傷（躲藏高手/腎上腺費洛蒙）：active+bench 皆套
    if (dmg > 0) {
      const _ca = applyDefenderCoinAvoid(s, target, targetCard, dIdx, dmg, pool);
      s = _ca.state;
      if (_ca.avoided) dmg = 0;
    }
    // v5.436：active 受招式傷害 → 觸發防守方 on-damaged 全機制（共用 fireDefenderOnDamaged）。
    if (isActive && dmg > 0) {
      s = fireDefenderOnDamaged(s, dIdx, actorIdx, dmg, pool);
      if (s.phase === 'game-over') return s;
    }
    // re-fetch（helper 可能消費還擊旗標 / 改 attacker 狀態）
    const defenderNow = s.players[dIdx];
    const targetNow = isActive ? defenderNow.active : defenderNow.bench.find(c => c.iid === iid);
    if (!targetNow) continue;
    const newDmg = targetNow.damage + dmg;
    const hp = effectiveHPInline(targetNow, pool, s);
    const players = [...s.players] as [PlayerState, PlayerState];
    if (hp > 0 && newDmg >= hp) {
      // v5.594 prevent-KO（堅忍之軀/倖存鍛鍊器等）：命中則留 HP 不昏厥
      const _pk = applyPreventKOToVictim(s, targetNow, targetCard, dIdx, dmg, pool);
      if (_pk.prevented) { s = _pk.state; continue; }
      // KO：棄牌遷移 + 累計獎賞 + 移除位置
      const ko: CardInstance[] = [
        { ...targetNow, damage: newDmg },
        ...targetNow.energyAttached,
        ...getAllAttachedTools(targetNow),
        ...(targetNow.evolvedFromStack ?? []),
      ];
      const _ko = koPrizesAdjusted(s, targetNow, targetCard, (1 - dIdx) as 0 | 1, dIdx, pool);
      s = _ko.state;
      const prizeCount = _ko.prizes;
      const newDef = { ...defenderNow, discard: [...defenderNow.discard, ...ko] };
      if (isActive) newDef.active = null;
      else newDef.bench = defenderNow.bench.filter(c => c.iid !== iid);
      players[dIdx] = newDef;
      s = addPendingPrize({ ...s, players }, actorIdx, prizeCount, pool);
      s = addLog(s, `${label}：對 ${targetCard?.name ?? '?'}（${isActive ? '戰鬥場' : '備戰位'}）造成 ${dmg} 點傷害 → 被擊倒！+${prizeCount} 張獎賞卡`, actorIdx);
      // v2.246：clone-strike-multi-hit 屬於招式 KO（共用大吼大叫 / 三色炮 / 分身連打）
      s = recordOppKO(s, dIdx, targetCard, 'attack');
      // v5.613 收斂：分身連打/三色炮類 KO 戰鬥位 → 補觸發防守方 on-KO（沉重接力棒/反擊等）
      s = fireDefenderOnKO(s, dIdx, actorIdx, pool, { ...targetNow, damage: newDmg }, isActive, true);
      // 戰鬥場昏厥且對手沒有備戰 → game over
      if (isActive && newDef.bench.length === 0) {
        s = { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defenderNow.name} 沒有可上場的寶可夢` };
        return s;
      }
    } else {
      const newDef = { ...defenderNow };
      if (isActive) newDef.active = { ...targetNow, damage: newDmg };
      else newDef.bench = defenderNow.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c);
      players[dIdx] = newDef;
      s = { ...s, players };
      s = addLog(s, `${label}：對 ${targetCard?.name ?? '?'}（${isActive ? '戰鬥場' : '備戰位'}）造成 ${dmg} 點傷害`, actorIdx);
    }
  }
  return s;
});

// ── 4) 月月熊 赫月｜經驗法則 — 從手牌選最多 2 張基本【鬥】能量附給自己（剛上備戰才可用）
//   gate「pk.justPlaced」在 engine.ts getUsableAbilities 加（同螺釘地鼠）。
regA('月月熊 赫月', 0, (st, idx, pool, cardInst) => {
  if (!cardInst) return st;
  const fightInHand = st.players[idx].hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic'
      && (card.pokemonType === 'Fighting' || /【鬥】/.test(card.name));
  });
  if (fightInHand.length === 0) {
    return addLog(st, '經驗法則：手牌無基本【鬥】能量', idx);
  }
  const maxN = Math.min(2, fightInHand.length);
  st = addLog(st, `經驗法則：從手牌選 0~${maxN} 張基本【鬥】能量附給這隻寶可夢`, idx);
  return withPending(st, {
    type: 'hand-discard',  // 用 hand-discard 讓玩家從手牌挑（resolver 改寫為附加而非丟棄）
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicFightingEnergy',
    minCount: 0, maxCount: maxN,
    effectKey: 'ursaluna-bm-attach',
    params: { hostIid: cardInst.iid },
  });
});
regR('ursaluna-bm-attach', (state, aIdx, selectedIids, params, pool) => {
  const hostIid = params?.hostIid as string | undefined;
  if (!hostIid) return state;
  const energies = state.players[aIdx].hand.filter(c => selectedIids.includes(c.iid));
  if (energies.length === 0) {
    return addLog(state, '經驗法則：未選能量', aIdx);
  }
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  p.hand = p.hand.filter(c => !selectedIids.includes(c.iid));
  if (p.active?.iid === hostIid) {
    p.active = { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] };
  } else {
    p.bench = p.bench.map(b => b.iid === hostIid
      ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
      : b);
  }
  players[aIdx] = p;
  const names = energies.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return _magHeal(addLog({ ...state, players }, `經驗法則：附 ${energies.length} 張基本【鬥】能量（${names}）到月月熊 赫月`, aIdx), aIdx, [hostIid], pool);  // v5.485 自動治癒
});

// ── 5) 菊草葉｜叫聲 — 對手戰鬥位下回合招式 -20（沿用 嘎啦嘎啦|叫聲 的 helper）
regPre('菊草葉|叫聲', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('菊草葉|叫聲', defNextAtkReducePost(20));

// ── 6) 呱頭蛙｜招集之術 — 牌庫選最多 3 張寶可夢加手牌 + 重洗
regPre('呱頭蛙|招集之術', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('呱頭蛙|招集之術', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length === 0) {
    return addLog(state, '招集之術：牌庫為空', aIdx);
  }
  const s = addLog(state, '招集之術：從牌庫選 0~3 張寶可夢卡加手牌（之後重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 3,
    effectKey: 'froakie-summon-tactics',
  });
});
regR('froakie-summon-tactics', (state, aIdx, selectedIids, _params, pool) => {
  const picks = state.players[aIdx].deck.filter(c => selectedIids.includes(c.iid));
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !selectedIids.includes(c.iid))),
    hand: [...p.hand, ...picks],
  }));
  if (picks.length > 0) {
    const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.993：卡面寫「給對手看過」→ 公開揭示（Iron Rule 8）
    s = addLog(s, `招集之術：搜到 ${picks.length} 張寶可夢加入手牌（${names}），重洗牌庫`, aIdx);
  } else {
    s = addLog(s, '招集之術：未選卡，重洗牌庫', aIdx);
  }
  return s;
});

// ── 7) 巨金怪 (M4)｜彈回 60 — 對手 active↔備戰互換（由對手選）
regPre('巨金怪|彈回', (state, _aIdx, _pool) => ({ state, damage: 60 }));
regPost('巨金怪|彈回', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active || d.bench.length === 0) {
    return addLog(state, '彈回：對手無備戰可交換', aIdx);
  }
  const s = addLog(state, '彈回：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選）', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'force-opp-swap',  // resolver 已實裝（line 8034）
    params: { label: '彈回', attackerIdx: aIdx },
  });
});

// ── 8) 巨金怪 (M4)｜金屬之錘 150+ — v4.46: 2-stage picker（依官方 QA 修正）
//   卡面：「若希望，將 3 個這隻寶可夢身上附加的【鋼】能量丟棄，增加 150 點傷害。」
//   官方 QA：「丟鋼能」與「+150 傷害」是**獨立事件**，即使身上 0 鋼能也能拿 +150。
//
//   v4.46 改為 binary-yes-no scope，2-stage 流程：
//     Stage 1（spec 提供）: yes/no 選「是否希望 +150」
//     Stage 2（UI 處理）:
//       0 鋼能 → sentinel '__metal_hammer_no_metal__' → +150 不丟
//       1-3 鋼能 → 自動全丟（min=max=count）→ +150
//       4+ 鋼能 → 玩家選 3 顆（picker min=max=3）→ +150
//     Stage 2 在 game/+page.svelte 的 binary-yes-no Yes 按鈕特殊處理。
//
//   耀閃挑戰借此招的處理（slowking_lucario_deck.ts）：
//     - copiedSpec.scope === 'binary-yes-no' → 自動注入 '__yaoshan_borrowed_yes__' sentinel
//     - 此 PRE 偵測 sentinel → +150 不丟（依 QA「不用丟鋼能也能 +150」）
//
//   v4.17 → v4.46 變更原因：v4.17 改成 attacker picker 後破壞兩個 case：
//     1. 自己 巨金怪 用、0 鋼能 → picker 空、玩家只能選 0 → 沒 +150（v4.17 comment 自承）
//     2. 耀閃挑戰借 → sentinel injection 不再觸發 → 借者也 +0（更慘）
//   v4.46 revert 為 binary-yes-no + UI Stage 2，兩個 case 都修好。
ATTACK_PRE_DISCARD_CHOICE.set('巨金怪|金屬之錘', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 150, damagePerEnergy: 0,
  choicePrompt: '是否將最多 3 個【鋼】能量丟棄並增加 150 點傷害？（若身上無鋼能，仍 +150）',
  choiceYesLabel: '是（+150 傷害）',
  choiceNoLabel: '否（僅 150 傷害）',
});
regPre('巨金怪|金屬之錘', (state, aIdx, pool, action) => {
  const chosenIids = action?.discardedEnergyIids ?? [];
  // case 1: 借者（耀閃挑戰） → 依 QA「不用丟鋼能也能 +150」
  if (chosenIids.length === 1 && chosenIids[0] === '__yaoshan_borrowed_yes__') {
    return { state: addLog(state, '金屬之錘（借者）：依 QA 不丟鋼能也 +150 → 300', aIdx), damage: 300 };
  }
  // case 2: 自己 Yes 但 0 鋼能（UI Stage 2 sentinel）
  if (chosenIids.length === 1 && chosenIids[0] === '__metal_hammer_no_metal__') {
    return { state: addLog(state, '金屬之錘：希望 +150 但身上無鋼能 → 不丟 +150 → 300', aIdx), damage: 300 };
  }
  // case 3: 不希望（No）→ 150 base
  if (chosenIids.length === 0) {
    return { state: addLog(state, '金屬之錘：不希望 → 150 base', aIdx), damage: 150 };
  }
  // case 4: 自己 Yes + 有鋼能丟（UI Stage 2 已決定 iids）→ 丟那幾張 + +150
  const attacker = state.players[aIdx].active;
  if (!attacker) return { state, damage: 150 };
  const idSet = new Set(chosenIids);
  const drop = attacker.energyAttached.filter(e => idSet.has(e.iid));
  if (drop.length === 0) {
    // 防呆：所選 iids 都不在身上（race），仍給 +150（語意：玩家已選 Yes）
    return { state: addLog(state, '金屬之錘：所選能量已不在身上 → 不丟 +150 → 300', aIdx), damage: 300 };
  }
  const s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: p.active.energyAttached.filter(e => !idSet.has(e.iid)) },
      discard: [...p.discard, ...drop],
    };
  });
  return { state: addLog(s, `金屬之錘：丟 ${drop.length} 張鋼能 → +150 = 300`, aIdx), damage: 300 };
});

// v2.133 月月熊 赫月ex｜老練招式（被動）— 「血月」所需【無】能量減少對手已獲得獎賞卡數
//   原本血月 cost = 5×Colorless；對手已取 3 張獎賞 → 改為 2×Colorless。
//   engine.ts canAffordAttack 開頭呼叫此 helper 改寫 cost。
export function getUrsalunaBloodMoonEffectiveCost(
  attackerName: string,
  attackName: string,
  state: GameState,
  pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  // v3.69：JSON 內「月月熊 赫月ex」有兩種寫法 — 有空格（SV5a 5 張）vs 無空格（SV8a 2 張）。
  //   normalize 去空格比對才能涵蓋兩變體；之前只認無空格寫法，SV5a 老練招式失效。
  //   line 4242-4243 的 血月 attack post 已有處理雙寫法，這裡是 v3.69 補上 cost-modifier 漏網。
  const normalizedName = attackerName.replace(/\s+/g, '');
  if (normalizedName !== '月月熊 赫月ex'.replace(/\s+/g, '')) return originalCost;
  if (attackName !== '血月') return originalCost;
  const aIdx = state.activePlayerIndex;
  // 對手已獲得獎賞 = 6 - 對手剩餘獎賞
  const oppPrizes = state.players[(1 - aIdx) as 0 | 1].prizes.length;
  const taken = Math.max(0, 6 - oppPrizes);
  // 從 originalCost 移除 `taken` 個 Colorless
  if (taken === 0) return originalCost;
  const reduced: import('$lib/cards/types').EnergyType[] = [];
  let toRemove = taken;
  for (const c of originalCost) {
    if (c === 'Colorless' && toRemove > 0) { toRemove--; continue; }
    reduced.push(c);
  }
  return reduced;
}

// ── 9) 酋雷姆｜反等離子 — 對手棄牌區有名稱含「阿克羅瑪」的卡時，
//   「三重冰霜」所需能量改為 1 個【無】。engine canAffordAttack 必須 hook。
//   實作：engine.ts 內 attack 成本檢查時呼叫此 helper 改寫 cost。
//   為避免在 effects.ts 改 engine，這裡只 export helper 給 engine import。
export function getKyuremElectroplasmaEffectiveCost(
  attackerName: string,
  attackName: string,
  state: GameState,
  pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '酋雷姆') return originalCost;
  if (attackName !== '三重冰霜') return originalCost;
  // 檢查酋雷姆場上有「反等離子」特性（防範同名卡未來不同特性）
  // 對手棄牌區是否有名稱含「阿克羅瑪」的卡
  const aIdx = state.activePlayerIndex;
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppDiscard = state.players[dIdx].discard;
  const hasAcroma = oppDiscard.some(c => {
    const card = pool.get(c.cardId);
    return card?.name?.includes('阿克羅瑪') ?? false;
  });
  if (hasAcroma) return ['Colorless'];
  return originalCost;
}

/**
 * v2.385 狙射樹梟ex｜狙擊手之眼 — 若對手手牌恰為 4 張，
 *   則狙射樹梟ex 使用招式所需的【無】能量全部消除。
 *   範圍：對狙射樹梟ex 持有的所有招式生效（卡面非 attack-specific）。
 */
export function getDecidueyeSnipeEffectiveCost(
  attackerCard: Card,
  state: GameState,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerCard.name !== '狙射樹梟ex') return originalCost;
  // 防範同名卡未來不同特性 — 必須有「狙擊手之眼」特性
  if (!attackerCard.abilities?.some(a => a.name === '狙擊手之眼')) return originalCost;
  // 對手手牌恰為 4 張
  const dIdx = (1 - state.activePlayerIndex) as 0 | 1;
  if (state.players[dIdx].hand.length !== 4) return originalCost;
  // 移除 cost 中的 Colorless（【無】能量需求消除）
  const filtered = originalCost.filter(c => c !== 'Colorless');
  return filtered.length === originalCost.length ? originalCost : filtered;
}

/**
 * v2.997 好勝毛蟹｜事先準備 / 輕身鱈｜事先準備
 *   卡面：「這隻寶可夢使用招式所需的【無】能量，減少自己的棄牌區的『海岱』的張數。」
 *   範圍：對持有此特性的寶可夢的所有招式生效（卡面非 attack-specific）。
 *   實作：count 自方棄牌區內 cardName === '海岱' 的張數 N，從 cost 移除 N 個 Colorless。
 *   兩張卡共用同一個 helper（卡名 OR 判斷）。
 */
export function getCorphishPreparationEffectiveCost(
  attackerName: string,
  _attackName: string,
  state: GameState,
  pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '好勝毛蟹' && attackerName !== '輕身鱈') return originalCost;
  const aIdx = state.activePlayerIndex;
  const ownDiscard = state.players[aIdx].discard;
  const haidaiCount = ownDiscard.reduce((acc, c) => {
    const card = pool.get(c.cardId);
    return acc + (card?.name === '海岱' ? 1 : 0);
  }, 0);
  if (haidaiCount === 0) return originalCost;
  // 從 originalCost 移除最多 haidaiCount 個 Colorless
  const reduced: import('$lib/cards/types').EnergyType[] = [];
  let toRemove = haidaiCount;
  for (const c of originalCost) {
    if (c === 'Colorless' && toRemove > 0) { toRemove--; continue; }
    reduced.push(c);
  }
  return reduced.length === originalCost.length ? originalCost : reduced;
}

/**
 * v2.997 熾焰咆哮虎ex｜喧鬧競技
 *   卡面：「這隻寶可夢使用招式所需的【無】能量，減少對手的備戰寶可夢的數量。」
 *   範圍：對熾焰咆哮虎ex 持有的所有招式生效。
 *   實作：對手備戰數 N（最多 5），從 cost 移除 N 個 Colorless。
 */
export function getSkeledirgeRowdyContestEffectiveCost(
  attackerName: string,
  _attackName: string,
  state: GameState,
  _pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '熾焰咆哮虎ex') return originalCost;
  const aIdx = state.activePlayerIndex;
  const oppBenchCount = state.players[(1 - aIdx) as 0 | 1].bench.length;
  if (oppBenchCount === 0) return originalCost;
  const reduced: import('$lib/cards/types').EnergyType[] = [];
  let toRemove = oppBenchCount;
  for (const c of originalCost) {
    if (c === 'Colorless' && toRemove > 0) { toRemove--; continue; }
    reduced.push(c);
  }
  return reduced.length === originalCost.length ? originalCost : reduced;
}

/**
 * v2.997 瑪力露麗｜亮亮泡
 *   卡面：「若自己的場上有『太晶』寶可夢，則這隻寶可夢使用『捨身衝撞』所需的能量，
 *         改為 1 個【超】能量。」
 *   範圍：限定 attackName === '捨身衝撞'。
 *   實作：自方場上（active+bench）有 tag 太晶 的寶可夢時，cost 整個替換為 ['Psychic']。
 */
export function getAzumarillSparkleSplashEffectiveCost(
  attackerName: string,
  attackName: string,
  state: GameState,
  pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '瑪力露麗') return originalCost;
  if (attackName !== '捨身衝撞') return originalCost;
  const aIdx = state.activePlayerIndex;
  const me = state.players[aIdx];
  const all: CardInstance[] = [...(me.active ? [me.active] : []), ...me.bench];
  const hasTera = all.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
  if (!hasTera) return originalCost;
  return ['Psychic'];
}

/**
 * v2.997 音波龍｜調諧迴響
 *   卡面：「若自己的手牌與對手的手牌張數相同，則這隻寶可夢使用『恐慌嚎鳴』所需的
 *         能量全部消除。」
 *   範圍：限定 attackName === '恐慌嚎鳴'。
 *   實作：state.players[aIdx].hand.length === state.players[1-aIdx].hand.length 時，
 *         cost 替換為空陣列 []。
 */
export function getSonidoTuningResonanceEffectiveCost(
  attackerName: string,
  attackName: string,
  state: GameState,
  _pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '音波龍') return originalCost;
  if (attackName !== '恐慌嚎鳴') return originalCost;
  const aIdx = state.activePlayerIndex;
  if (state.players[aIdx].hand.length !== state.players[(1 - aIdx) as 0 | 1].hand.length) {
    return originalCost;
  }
  return [];
}

/**
 * v2.997 請假王ex｜懶怠個性
 *   卡面：「若對手的場上沒有『寶可夢【ex】・【V】』，則這隻寶可夢無法使用招式。」
 *   範圍：對 請假王ex 的所有招式生效。
 *   實作：engine getAvailableAttacks + ATTACK handler 兩處呼叫此 helper，
 *         若對手場上沒有任何 ex/V 寶可夢 → 回傳 true（禁止）。
 *   ex/V 判定：subtype === 'ex' / name 結尾含 ex/EX/V/VMAX/VSTAR（與既有 isExV 一致）。
 */
export function isLazyTraitBlockingAttack(
  attacker: CardInstance,
  state: GameState,
  pool: Map<string, Card>,
): boolean {
  const atkCard = pool.get(attacker.cardId);
  if (atkCard?.name !== '請假王ex') return false;
  // 防範同名卡未來不同特性 — 必須有「懶怠個性」特性
  if (!atkCard.abilities?.some(a => a.name === '懶怠個性')) return false;
  // v4.922 火箭隊的監視塔 gate：請假王ex pokemonType='Colorless'，此 stadium 在場
  // 時雙方所有 Colorless 寶可夢特性（含「懶怠個性」）全部消除。
  // 用字面值比對避免從 stadiums.ts import 造成循環（_shared.ts → stadiums.ts 已 import _shared）。
  const stadiumCardLazy = state.activeStadium ? pool.get(state.activeStadium.cardId) : undefined;
  if (stadiumCardLazy?.name === '火箭隊的監視塔' && atkCard.pokemonType === 'Colorless') return false;
  const aIdx = state.activePlayerIndex;
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const oppAll: CardInstance[] = [...(opp.active ? [opp.active] : []), ...opp.bench];
  const hasExV = oppAll.some(inst => {
    const c = pool.get(inst.cardId);
    if (!c) return false;
    return c.subtype === 'ex'
      || c.name.endsWith('ex')
      || c.name.endsWith('EX')
      || c.name.endsWith('V')
      || c.name.endsWith('VMAX')
      || c.name.endsWith('VSTAR');
  });
  return !hasExV; // 沒有 ex/V → block attack
}

/**
 * v2.997 小嘴蝸 / 蓋蓋蟲｜刺激進化
 *   卡面：「若自己的場上有『蓋蓋蟲』（小嘴蝸 持有此特性時的對應卡名相反），
 *         則這隻寶可夢就算在自己的最初回合或者剛使出的回合，也可進化。」
 *   範圍：base 是小嘴蝸 / 蓋蓋蟲，且 base 卡有「刺激進化」特性。
 *   實作：engine canEvolve（getEvolvableTargets）+ EVOLVE handler 兩處呼叫，
 *         若 base 卡名相符 + 自方場上（active+bench）有 partner → 允許 bypass
 *         isFirstTurn / justPlaced / evolvedThisTurn 三項 gate。
 *   注意：partner 自身不需要有此特性（卡面條件是「場上有 X」，不限同名疊加）。
 */
export function hasShellinkEvolveBypass(
  baseCard: Card,
  state: GameState,
  ownerIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  // base 必須是小嘴蝸 或 蓋蓋蟲，且有「刺激進化」特性
  if (baseCard.name !== '小嘴蝸' && baseCard.name !== '蓋蓋蟲') return false;
  if (!baseCard.abilities?.some(a => a.name === '刺激進化')) return false;
  // partner = 另一張（小嘴蝸 → 蓋蓋蟲；蓋蓋蟲 → 小嘴蝸）
  const partnerName = baseCard.name === '小嘴蝸' ? '蓋蓋蟲' : '小嘴蝸';
  const me = state.players[ownerIdx];
  const all: CardInstance[] = [...(me.active ? [me.active] : []), ...me.bench];
  return all.some(c => pool.get(c.cardId)?.name === partnerName);
}

/**
 * v2.997 海豚俠ex｜全能靈魂（rule marker）
 *   卡面：「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上。」
 *   實作：engine PLAY_BASIC handler 進入時呼叫；若卡名為 海豚俠ex 且有此特性 →
 *         回傳 true → engine 拒絕從手牌打出（傳回原 state + addLog）。
 *   全能變身（H 標）目前未實裝（engine 沒對應 hook），但本 marker 仍 block
 *   PLAY_BASIC，避免玩家直接從手牌打出海豚俠ex。
 */
export function isAllPowerSoulBlocked(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.name !== '海豚俠ex') return false;
  return card.abilities?.some(a => a.name === '全能靈魂') ?? false;
}


// ══════════════════════════════════════════════════════════════════════════════
// v2.133 — 電電蟲 + 超級袋獸厄鬼椪 預組新卡實裝
//   特性 6 個：複眼（已加 PASSIVE_ATTACK_BONUS）/ 勤奮之心 / 老練招式（已加 helper）
//             / 迅速游標 / 藏青浪濤 / 沉雪
//   訓練家/能量 3 個：貴重手推車（Item ACE SPEC）/ 電氣球（Tool）/ 薄霧能量（Special Energy）
// ══════════════════════════════════════════════════════════════════════════════

// ── 皮卡丘ex｜勤奮之心 ─────────────────────────────────────────────────────
// 卡面：HP 全滿時受招式而昏厥 → 不昏厥，剩下 HP=10 留場。
// v2.133 實裝為 PASSIVE_PREVENT_KO map（不再簡化）：engine 在 wouldBeKO 路徑
// 走完 TOOL_PREVENT_KO 後再查 PASSIVE_PREVENT_KO，命中則攔下擊倒並留 leaveHP。
// 與「自帶倖存鍛鍊器但不消耗」效果等價，且不依賴實際 Tool 卡。
export const PASSIVE_PREVENT_KO = new Map<string, (
  holderInst: CardInstance, holderCard: Card, incomingDamage: number
) => { prevent: boolean; leaveHP: number }>();
// v5.596 擲幣型 prevent-KO 特性（堅忍之軀/不朽身軀）：呼叫端(engine inline + applyPreventKOToVictim)
//   要走 flipCoinsWithLog 擲 1 幣，正面才真的防 KO（其餘如勤奮之心/結實是滿血條件型，無幣）。
export const COIN_PREVENT_KO_ABILITIES = new Set<string>(['堅忍之軀', '不朽身軀']);
PASSIVE_PREVENT_KO.set('勤奮之心', (inst, card, _dmg) => {
  // 全血才能觸發（damage === 0）
  if (inst.damage > 0) return { prevent: false, leaveHP: 0 };
  // 一回合限一次：使用 inst.activeIndustryHeartUsedThisGame 作旗標（暫不限）
  // 卡面沒明說「一場限一次」，所以每次滿血被打都觸發。
  return { prevent: true, leaveHP: 10 };
});

// v2.93b 岩殿居蟹（SV11B）｜結實 ─────────────────────────────────────────────
// 卡面：「這隻寶可夢的HP是全滿的狀態下，這隻寶可夢受到招式的傷害而【昏厥】時，
//        這隻寶可夢不會【昏厥】，而是以剩餘HP為「10」的狀態留在場上。」
// 邏輯與「勤奮之心」完全一致 — 直接共用 PASSIVE_PREVENT_KO 機制。
// 注意：岩殿居蟹 SV11B 版本特性是「結實」；M2a/MC/SV9a 版本是「神秘石居」（在 PASSIVE_IMMUNITY 已實裝）。
PASSIVE_PREVENT_KO.set('結實', (inst, _card, _dmg) => {
  if (inst.damage > 0) return { prevent: false, leaveHP: 0 };
  return { prevent: true, leaveHP: 10 };
});

// v2.992 超級摔角鷹人ex(I) | 堅忍之軀 — 受招式傷害昏厥時擲 1 幣，正面留 10HP（無滿血條件）。
// v5.596：擲幣移至呼叫端走 flipCoinsWithLog（見 COIN_PREVENT_KO_ABILITIES）→ 有 log/動畫/線上同步；
//   fn 只回報「擲到正面就能防」的意圖，是否真防由呼叫端擲幣決定。
PASSIVE_PREVENT_KO.set('堅忍之軀', (_inst, _card, _dmg) => ({ prevent: true, leaveHP: 10 }));

// v4.89 棄世猴(M5) | 不朽之軀 — 與「堅忍之軀」邏輯完全等價
// 卡面：「這隻寶可夢因招式傷害而【昏厥】時，擲 1 次硬幣，若為正面，這隻寶可夢
//        不會【昏厥】，並以剩餘 HP 為「10」的狀態留在場上。」
// engine 觸發點：wouldBeKO (baseDamage > 0 由招式傷害) → 走 PASSIVE_PREVENT_KO map，
// 卡面「因招式傷害而昏厥」這個前提天然成立（engine 不會在特性 KO 或自殺 KO 時呼叫此 hook）。
PASSIVE_PREVENT_KO.set('不朽身軀', (_inst, _card, _dmg) => ({ prevent: true, leaveHP: 10 }));  // v5.596 擲幣移至呼叫端(flipCoinsWithLog)

// ============================================================================
// v2.992 Group 1 — 7 new passive hook maps
// ============================================================================

/** 條件式被動受傷減免：fn(inst, card) => 要減的點數(0=不觸發) */
export const PASSIVE_DAMAGE_REDUCE_COND = new Map<string, (
  inst: CardInstance, card: Card,
) => number>([
  // 雷吉洛克(I) | 岩石盔甲 — 附能量時受招式傷害 -30
  ['岩石盔甲', (inst) => inst.energyAttached.length > 0 ? 30 : 0],
]);

/**
 * v5.294: 依攻擊者屬性條件的被動受傷減免：fn(victim_inst, victim_card, attacker_card) => 要減的點數.
 * 套用點: engine.ts (active 防守) + effects.ts _applyBenchAbilityReduce (bench 防守).
 *
 * 與 PASSIVE_DAMAGE_REDUCE_COND 區別：本 map 額外接 attacker_card 用以判定屬性條件
 *   (如「受到【火】或【水】寶可夢招式」這種屬性限制)
 */
export const PASSIVE_DAMAGE_REDUCE_BY_ATTACKER = new Map<string, (
  inst: CardInstance, card: Card, attackerCard: Card | undefined,
) => number>([
  // 白海獅(M2) | 厚脂肪 — 對手【火】或【水】寶可夢招式 -30
  // JSON: 「這隻寶可夢受到對手的【火】或者【水】寶可夢招式的傷害『-30』點。」
  ['厚脂肪', (_inst, _card, atk) => {
    if (!atk || atk.supertype !== 'Pokemon') return 0;
    const t = atk.pokemonType;
    return (t === 'Fire' || t === 'Water') ? 30 : 0;
  }],
]);

/** 受招式傷害時擲硬幣免傷 */
export const PASSIVE_COIN_AVOID = new Map<string, (
  inst: CardInstance, card: Card, pool: Map<string, Card>,
) => boolean>([
  // 變隱龍(H) | 躲藏高手 — 無條件擲幣
  ['躲藏高手', () => true],
  // 吉雉雞(H) | 腎上腺費洛蒙 — 附惡能量時擲幣
  ['腎上腺費洛蒙', (inst, _card, pool) => {
    return inst.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') return false;
      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Darkness' || /【惡】/.test(ec.name))) return true;
      if (ec.pokemonType === 'Darkness') return true;
      return false;
    });
  }],
]);

/** 被招式 KO 時對攻擊者放指示物 */
export const PASSIVE_KO_RETALIATION = new Map<string, { counters: number }>([
  // 沙鈴仙人掌(I) | 炸裂針 — 戰鬥場 KO 時放 6 個指示物
  ['炸裂針', { counters: 6 }],
]);

/** 受招式 KO 時的廣義 hook(不只放指示物)
 * v4.893：加 defenderInst?: CardInstance（KO 前的 instance 快照，含 energyAttached
 *         / toolAttached / damage 等）。給需要讀取 KO 前狀態的特性（如 密勒頓 光子密碼）。
 *         向後相容：舊 fn 簽名忽略此參數仍可運作。 */
export type PassiveOnKoFn = (
  state: GameState,
  dIdx: 0 | 1,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  defenderCard: Card,
  defenderInst?: CardInstance,
) => GameState;
export const PASSIVE_ON_KO = new Map<string, PassiveOnKoFn>([
  // 桃歹郎(I) | 最後鎖鏈 — 從牌庫任選 1 張加手 + 重洗
  ['最後鎖鏈', (state, dIdx, _aIdx, _pool, _defCard) => {
    if (state.players[dIdx].deck.length === 0) {
      return addLog(state, '最後鎖鏈：牌庫為空，無法觸發', dIdx);
    }
    const s = addLog(state, '最後鎖鏈：從牌庫任選 1 張加手牌（並重洗）', dIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      filter: 'Any',
      minCount: 0, maxCount: 1,
      effectKey: 'search-to-hand-reshuffle',
    });
  }],
  // 願增猿ex(H) | 鬆口氣 — 場上有桃歹郎ex 則對手 pendingPrize -1
  ['鬆口氣', (state, dIdx, aIdx, pool, _defCard) => {
    const me = state.players[dIdx];
    const all = [...(me.active ? [me.active] : []), ...me.bench];
    const hasMomotaroEx = all.some(inst => {
      const c = pool.get(inst.cardId);
      return c?.name === '桃歹郎ex' || (c?.name === '桃歹郎' && c?.subtype === 'ex');
    });
    if (!hasMomotaroEx) return state;
    // v5.466 自動給獎賞後 pendingPrizes 恆 0；改為 claw-back：從攻擊方手牌取回剛自動拿的 1 張獎賞卡
    //   放回攻擊方獎賞堆（= 對手獲得的獎賞 -1）。PASSIVE_ON_KO 緊接 addPendingPrize 之後執行，
    //   故攻擊方手牌最後 1 張即剛拿的獎賞卡。攻擊方手牌空（理論不會，KO 必先發獎賞）則不動。
    const atk = state.players[aIdx];
    if (atk.hand.length === 0) return state;
    const clawed = atk.hand[atk.hand.length - 1];
    const players2 = [...state.players] as [PlayerState, PlayerState];
    players2[aIdx] = { ...atk, hand: atk.hand.slice(0, -1), prizes: [...atk.prizes, clawed] };
    return addLog({ ...state, players: players2 },
      '「鬆口氣」啟動：場上有桃歹郎ex → 對手獲得的獎賞卡 -1（取回剛拿的 1 張）', dIdx);
  }],
  // v2.998 沙漠蜻蜓｜沙之羽擊 — 在戰鬥場被招式 KO 時，將對手牌庫上方 2 張卡丟棄
  // 卡面：「進化時 + 被招式 KO 時，各可使用 1 次」— 此處為 KO 端，進化端走 regA。
  // PASSIVE_ON_KO 只在「被招式 KO」時觸發（engine 篩選），不會誤觸特性 KO。
  ['沙之羽擊', (state, dIdx, aIdx, pool, defCard) => desertDragonflyOnKo(state, dIdx, aIdx, pool, defCard)],

  // v4.893 密勒頓(M5) | 光子密碼 — 在戰鬥場 KO 時，從身上基本能量最多 2 張改附給 1 隻備戰
  // 卡面：「這隻寶可夢在戰鬥場受到對手寶可夢的招式傷害而【昏厥】時，從這隻寶可夢身上
  //        附加的『基本能量』最多選擇 2 張，改附給 1 隻備戰寶可夢。」
  // 注意：engine PASSIVE_ON_KO 呼叫時已在 KO sweep 後（active=null，能量已進 discard）。
  //       透過 v4.893 擴充的 defenderInst 參數拿到 KO 前的快照，提取 basic 能量 iids。
  //       資源（actual 移動）由 m5_preview.ts regR('m5-mirieton-photon-code') 完成。
  // 限制（deferred enhancement）：當 N≥3 張 basic 能量時，目前 auto-pick 前 2 張；
  //       玩家「選哪 2 張」之 UI picker 為 deferred。常見情況 N≤2 行為完全符合卡面。
  ['光子纜線', (state, dIdx, _aIdx, pool, _defCard, defInst) => {
    if (!defInst) return state;
    // v5.710：卡面 19171(M5正式)「基本【雷】能量」(原實作沿用 preview「光子密碼」的任意基本能量→
    //   會誤搬非雷基本能量)。限基本【雷】(基本能量限定,非視為雷的特殊能量,故 isBasic+Lightning 非 energyProvidesType)。
    const basicEnergyIids = defInst.energyAttached
      .filter(e => {
        const ec = pool.get(e.cardId);
        return ec?.supertype === 'Energy' && ec?.subtype === 'Basic'
          && (ec.pokemonType === 'Lightning' || /【雷】/.test(ec.name ?? ''));
      })
      .map(e => e.iid);
    if (basicEnergyIids.length === 0) {
      return addLog(state, '光子密碼：身上無基本能量，效果不發動', dIdx);
    }
    const defPlayer = state.players[dIdx];
    if (defPlayer.bench.length === 0) {
      return addLog(state, '光子密碼：備戰區無寶可夢，效果不發動', dIdx);
    }
    const moveCount = Math.min(2, basicEnergyIids.length);
    const willAutoPick = basicEnergyIids.length >= 3;
    return withPending(
      addLog(state,
        `光子密碼：選 1 隻備戰寶可夢接收 ${moveCount} 張基本能量（或跳過）${willAutoPick ? '（注：≥3 張時自動取前 2 張，玩家選哪 2 張的 UI 為 deferred）' : ''}`,
        dIdx),
      {
        type: 'bench-choose',
        actorIdx: dIdx, sourcePlayerIdx: dIdx,
        minCount: 0, maxCount: 1,
        effectKey: 'm5-mirieton-photon-code',
        params: { basicEnergyIids },
      },
    );
  }],
]);

/** 受招式傷害時的廣義 hook(造成 ≥1 傷害即觸發，不需 KO) */
export type PassiveOnDamagedFn = (
  state: GameState,
  dIdx: 0 | 1,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  defenderCard: Card,
) => GameState;
export const PASSIVE_ON_DAMAGED = new Map<string, PassiveOnDamagedFn>([
  // 火箭隊的瓦斯彈(I) | 警備濁霧 — 戰鬥場受傷時搜 ≤2 張瓦斯彈到備戰
  // v5.041：bench limit 改 getBenchLimit (5→8)
  ['警備濁霧', (state, dIdx, _aIdx, pool, _defCard) => {
    const me = state.players[dIdx];
    const slots = getOwnBenchLimit(state, dIdx, pool) - me.bench.length;
    if (slots <= 0) return addLog(state, '警備濁霧：備戰區已滿', dIdx);
    if (me.deck.length === 0) return addLog(state, '警備濁霧：牌庫為空', dIdx);
    const s = addLog(state,
      `警備濁霧：從牌庫選最多 ${Math.min(2, slots)} 張「瓦斯彈」放置於備戰區（並重洗）`, dIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      filter: 'NameContains:瓦斯彈',
      minCount: 0, maxCount: Math.min(2, slots),
      effectKey: 'search-bench-reshuffle',
    });
  }],
]);

/** 被招式 KO 時，若攻擊者符合 predicate 則對手獎賞 0 */
export const PASSIVE_PREVENT_PRIZE = new Map<string, (
  attackerCard: Card,
) => boolean>([
  // 脫殼忍者(I) | 脆弱蛻殼 — 被 ex 攻擊者 KO 時對手 0 獎賞
  // v3.67：改用 isRulePokemon helper
  ['脆弱蛻殼', (att) => isRulePokemon(att)],
]);

/** 攻擊方持有此特性 → 攻擊時自動帶這些 buff */
export const PASSIVE_ATTACKER_BUFF = new Map<string, { skipDefEffects?: boolean }>([
  // 波盪水ex(H) | 藏青浪濤 — 自身招式不計算對手戰鬥場附加效果(永遠 skipDefEffects)
  ['藏青浪濤', { skipDefEffects: true }],
]);

// ============================================================================
// v2.992 Group 1 — 狀態免疫 helper：isSleepImmune (咕咕 | 不眠)
// ============================================================================
function isSleepImmune(inst: CardInstance | null, pool: Map<string, Card>): boolean {
  if (!inst) return false;
  const card = pool.get(inst.cardId);
  return !!card?.abilities?.some(a => a.name === '不眠');
}


// ── 古劍豹｜沉雪 ──────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌將這張卡放置於備戰區時，可使用 1 次。將場上的競技場卡丟棄。」
// gate：pk.justPlaced（同 狂挖 / 經驗法則 pattern，engine.ts getUsableAbilities 加）
// v2.244：用 discardActiveStadium helper 丟回擁有者棄牌堆（不再簡化丟到觸發方）。
regA('古劍豹', 0, (st, idx, pool, cardInst) => {
  if (!cardInst) return st;
  if (!st.activeStadium) return addLog(st, '沉雪：場上沒有競技場卡', idx);
  const stadiumCard = pool.get(st.activeStadium.cardId);
  return addLog(
    discardActiveStadium(st, idx),
    `沉雪：場上的競技場卡「${stadiumCard?.name ?? '?'}」被丟棄`,
    idx,
  );
});

// ── 鐵斑葉ex｜迅速游標 ─────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌將這張卡放置於備戰區時，可使用1次。將這隻寶可夢與戰鬥寶可夢互換。
//        互換的情況下，選擇自己的場上寶可夢身上附加的任意數量的能量卡，改附於這隻寶可夢身上。」
// v3.826：picker 化（修 v2.138 違規簡化）— 玩家可從自方所有寶可夢身上的能量挑「任意數量」改附過來。
//   step 1: 互換（active ↔ 此 cardInst）+ 開 picker（active-energy-discard + scope='all-own'）
//   step 2: resolver 把 picked 能量從各來源移除 + 改附到新戰鬥場（鐵斑葉ex）
regA('鐵斑葉ex', 0, (st, idx, pool, cardInst) => {
  if (!cardInst) return st;
  const player = st.players[idx];
  if (!player.active || player.active.iid === cardInst.iid) {
    return addLog(st, '迅速游標：必須從備戰區發動且戰鬥場有寶可夢', idx);
  }
  const benchIdx = player.bench.findIndex(c => c.iid === cardInst.iid);
  if (benchIdx < 0) return st;
  const oldActiveCard = pool.get(player.active.cardId);
  const newActiveCard = pool.get(cardInst.cardId);
  // 互換 active ↔ bench[benchIdx]，能量先保留各自寶可夢身上（不直接搬）
  const players = [...st.players] as [PlayerState, PlayerState];
  const newBench = [...player.bench];
  const oldActiveAsBench = clearActiveEffects(player.active);
  newBench[benchIdx] = oldActiveAsBench;
  const newActive: CardInstance = {
    ...player.bench[benchIdx],
    movedToActiveThisTurn: true,
  };
  players[idx] = { ...player, active: newActive, bench: newBench };
  let s = addLog(
    { ...st, players },
    `迅速游標：${oldActiveCard?.name ?? '?'} 退回備戰區，${newActiveCard?.name ?? '?'} 上場`,
    idx,
  );
  // 收集自方所有寶可夢身上的能量（active 是新鐵斑葉ex；bench 含舊戰鬥場 + 原備戰）
  const sourcePokes: CardInstance[] = [
    ...(players[idx].active ? [players[idx].active!] : []),
    ...players[idx].bench,
  ];
  const allEnergyIids: string[] = [];
  for (const pk of sourcePokes) {
    for (const e of pk.energyAttached) allEnergyIids.push(e.iid);
  }
  if (allEnergyIids.length === 0) {
    // 場上沒能量可挑 → 直接結束
    return s;
  }
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0,
    maxCount: allEnergyIids.length,
    effectKey: 'swiftcursor-energy-pick',
    params: {
      scope: 'all-own',       // v3.826 新增：UI 端讀此 flag 改列「自方所有寶可夢身上能量」
      validIids: allEnergyIids,
      targetIid: newActive.iid,
      titleOverride: `迅速游標：選擇任意數量的能量改附於 ${newActiveCard?.name ?? '鐵斑葉ex'}（可以不選）`,
    },
  });
});

// v3.826: 迅速游標 resolver — 把 picked 能量從各來源移除，改附到 target 寶可夢
regR('swiftcursor-energy-pick', (st, idx, pickedIids, params, pool) => {
  const targetIid = params?.targetIid as string | undefined;
  if (!targetIid) return st;
  if (pickedIids.length === 0) {
    return addLog(st, '迅速游標：未選擇能量轉移', idx);
  }
  const pickedSet = new Set(pickedIids);
  let s = st;
  const moved: CardInstance[] = [];
  // 從自方所有寶可夢（active + bench）抽出 picked 能量
  s = updatePlayer(s, idx, p => {
    const stripFrom = (pk: CardInstance | null): CardInstance | null => {
      if (!pk) return pk;
      const keep: CardInstance[] = [];
      for (const e of pk.energyAttached) {
        if (pickedSet.has(e.iid) && pk.iid !== targetIid) {
          // 從非 target 寶可夢身上抽出（不從 target 自己抽 → 自轉沒意義）
          moved.push(e);
        } else {
          keep.push(e);
        }
      }
      return { ...pk, energyAttached: keep };
    };
    return {
      ...p,
      active: stripFrom(p.active),
      bench: p.bench.map(b => stripFrom(b)!) as CardInstance[],
    };
  });
  if (moved.length === 0) {
    return addLog(s, '迅速游標：所選能量無有效轉移目標', idx);
  }
  // 把抽出的能量附到 target
  s = updatePlayer(s, idx, p => {
    const attachTo = (pk: CardInstance | null): CardInstance | null => {
      if (!pk || pk.iid !== targetIid) return pk;
      return { ...pk, energyAttached: [...pk.energyAttached, ...moved] };
    };
    return {
      ...p,
      active: attachTo(p.active),
      bench: p.bench.map(b => attachTo(b)!) as CardInstance[],
    };
  });
  const targetCard = s.players[idx].active?.iid === targetIid
    ? pool.get(s.players[idx].active!.cardId)
    : pool.get(s.players[idx].bench.find(b => b.iid === targetIid)?.cardId ?? '');
  const energyNames = moved.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  s = addLog(s, `迅速游標：將 ${moved.length} 張能量（${energyNames}）改附於 ${targetCard?.name ?? '?'}`, idx);
  return s;
});

// ── 波盪水ex｜藏青浪濤 — 招式不計算對手戰鬥場附加效果 ─────────────────────
// 既有 regPre('波盪水ex|宣洩吼嘯') 已實裝（line 3114）；補上 skipDefEffects 旗標。
// 為避免雙處同步遺漏，這裡 wrap 既有 PRE：先呼叫舊實作，再覆蓋 skipDefEffects=true。
{
  const oldPre = ATTACK_PRE.get('波盪水ex|宣洩吼嘯');
  if (oldPre) {
    regPre('波盪水ex|宣洩吼嘯', (state, aIdx, pool, action) => {
      const r = oldPre(state, aIdx, pool, action);
      return { ...r, skipDefEffects: true };
    });
  }
}

// ── 貴重手推車 (Item ACE SPEC) — 從牌庫選任意數量基礎寶可夢放備戰並重洗 ────
regG('貴重手推車', (st, idx, pool) => {
  // 牌庫有基礎寶可夢 + 備戰未滿
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const p = st.players[idx];
  if (p.bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return p.deck.length > 0;
});
reg('貴重手推車', (st, idx, pool) => {
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const p = st.players[idx];
  const slots = getOwnBenchLimit(st, idx, pool) - p.bench.length;
  if (slots <= 0) return addLog(st, '貴重手推車：備戰區已滿', idx);
  st = addLog(st, `貴重手推車：從牌庫選 0~${slots} 張基礎寶可夢卡放置於備戰區`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: slots,
    effectKey: 'precious-cart-bench',
  });
});
regR('precious-cart-bench', (state, aIdx, selectedIids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.deck.filter(c => selectedIids.includes(c.iid));
  p.deck = shuffle(p.deck.filter(c => !selectedIids.includes(c.iid)));
  const placedNames: string[] = [];
  // v5.041：bench limit 改 getBenchLimit (5→8)
  const benchLimit = getOwnBenchLimit(s, aIdx, pool);
  for (const pk of picks) {
    if (p.bench.length >= benchLimit) break;
    const card = pool.get(pk.cardId);
    p.bench = [...p.bench, { ...pk, justPlaced: true }];
    placedNames.push(card?.name ?? '?');
  }
  players[aIdx] = p;
  s = { ...s, players };
  if (placedNames.length > 0) {
    s = addLog(s, `貴重手推車：${placedNames.join('、')} 放置於備戰區，重洗牌庫`, aIdx);
    s = applyBenchPlaceSideEffects(s, aIdx, picks.map(c => c.iid), pool);
  } else {
    s = addLog(s, '貴重手推車：未選卡，重洗牌庫', aIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.135 — 阿響的火爆獸 + 火箭隊的烏鴉頭頭 兩組 preset 卡效果
//
// 阿響的火爆獸 牌組：
//   • 阿響的火球鼠｜火花 30 + 自棄 1 能量
//   • 阿響的火岩鼠｜烈焰 40（純傷害）+ 旅途牽絆（regA：搜阿響的冒險到手）
//   • 阿響的火爆獸｜拍檔爆破 40 + 棄牌區「阿響的冒險」×60
//   • 阿響的火爆獸｜爆熱炮 160（純傷害）
//   • 阿響的冒險（Supporter）— 搜「阿響的寶可夢 OR 基本火能量」≤3 加手 + 重洗
//   • 比克提尼｜勝利聲援（PASSIVE_ATTACK_BONUS：自方火屬性進化寶可夢 +10）
//   • 烏栗（Supporter）— 二選一：1) 自方戰鬥↔備戰互換，2) 本回合對 ex/V +30
//   • 猛攻手鐲（Tool）— 對對手戰鬥場 ex +30
//   • 聖灰（Item）— 從棄牌區挑最多 5 張寶可夢卡放回牌庫並重洗
//   • 秘密箱 ACE（Item）— 棄 3 手牌，搜物品/道具/支援者/競技場各 1 張到手
//
// 火箭隊的烏鴉頭頭 牌組：
//   • 火箭隊的烏鴉頭頭｜火箭羽毛 60×（手牌火箭隊支援者卡張數，自動全丟）
//   • 火箭隊的烏鴉頭頭｜頭突 100（純傷害）
//   • 火箭隊的黑暗鴉｜誑騙 0 + 牌庫搜支援者到手
//   • 火箭隊的黑暗鴉｜無理取鬧 30 + 鎖對手戰鬥位 1 招式（v2.230 完整實裝，不再簡化）
//   • 火箭隊的多邊獸｜駭客攻擊 0 + 雙方棄 1 手牌
//   • 火箭隊的多邊獸Ⅱ｜R指令 20×（自方棄牌區火箭隊支援者卡張數）
//   • 洛拍棒（Item）— 牌庫上方 4 張看，挑任意數量支援者加手 + 剩餘洗回
// ══════════════════════════════════════════════════════════════════════════════

// ── 比克提尼｜勝利聲援（被動）────────────────────────────────────────────────
// 自己火屬性進化寶可夢使用招式對對手戰鬥場 +10。透過 PASSIVE_ATTACK_BONUS。
PASSIVE_ATTACK_BONUS.set('勝利聲援', (att) => {
  if (att.pokemonType !== 'Fire') return 0;
  if (!att.evolvesFrom) return 0; // 進化寶可夢必有 evolvesFrom
  return 10;
});

// ── 阿響的火球鼠｜火花 30 + 自棄 1 能量 ─────────────────────────────────────
// v5.398：阿響的火球鼠|火花 移至 SELF_DISCARD_UNITS_BATCH

// ── 阿響的火岩鼠｜烈焰 40（無附加效果，預設處理）── 不需 reg

// ── 阿響的火岩鼠｜旅途牽絆（特性）— 搜「阿響的冒險」到手 ────────────────────
regA('阿響的火岩鼠', 0, (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '旅途牽絆：牌庫為空', idx);
  st = addLog(st, '旅途牽絆：從牌庫選 1 張「阿響的冒險」加手牌並重洗', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Card:阿響的冒險',
    minCount: 0, maxCount: 1,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ── 阿響的火爆獸｜拍檔爆破 40 + 棄牌區「阿響的冒險」×60 ──────────────────────
regPre('阿響的火爆獸|拍檔爆破', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const adventureCount = p.discard.filter(c => pool.get(c.cardId)?.name === '阿響的冒險').length;
  const bonus = adventureCount * 60;
  const damage = 40 + bonus;
  const s = addLog(state, `拍檔爆破：棄牌區有 ${adventureCount} 張「阿響的冒險」→ +${bonus}（合計 ${damage}）`, aIdx);
  return { state: s, damage };
});

// ── 阿響的火爆獸｜爆熱炮 160（無附加效果，預設處理）── 不需 reg

// ── 阿響的冒險（Supporter）— 搜「阿響的寶可夢 OR 基本火能量」≤3 加手牌 ──────
// v2.226 加 regG：牌庫為空時不可打出
regG('阿響的冒險', (st, idx) => st.players[idx].deck.length > 0);
reg('阿響的冒險', (st, idx, pool) => {
  if (st.players[idx].deck.length === 0) {
    return addLog(st, '阿響的冒險：牌庫為空', idx);
  }
  st = addLog(st, '阿響的冒險：從牌庫選最多 3 張「阿響的寶可夢 / 基本火能量」加手牌並重洗', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'RakiPokemonOrFireEnergy',
    minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ── 烏栗（Supporter）— v2.139 完整實裝 modal 二選一 ────────────────────────
// 卡面 2 選項：(1) 自己戰鬥場↔備戰互換  (2) 本回合自己寶可夢招式對 ex/V +30
// gate：只要至少 1 個選項可用即允許使用
regG('烏栗', (st, idx) => {
  // 選項 1 至少需要備戰；選項 2 任何時候都可用 → 永遠 true（除非整個場都空）
  return !!st.players[idx].active;
});
reg('烏栗', (st, idx, _pool) => {
  const benchLen = st.players[idx].bench.length;
  st = addLog(st, '烏栗：選擇 1 個效果使用', idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'unruda-choice',
    params: {
      label: '烏栗',
      options: [
        // 若無備戰可換，選項 1 顯示 disabled
        { id: 'swap', text: '①自方戰鬥↔備戰互換', disabled: benchLen === 0 },
        { id: 'boost', text: '②本回合自方招式對 ex/V +30' },
      ],
    },
  });
});
regR('unruda-choice', (state, aIdx, iids, _params, _pool) => {
  const choice = iids[0];
  if (choice === 'swap') {
    const p = state.players[aIdx];
    if (p.bench.length === 0) {
      return addLog(state, '烏栗：備戰區無寶可夢，互換失敗', aIdx);
    }
    if (p.bench.length === 1) {
      // v5.246：補 movedToActiveThisTurn + ON_PROMOTE prompt
      return tryPromptPromoteActive(updatePlayer(addLog(state, '烏栗：自方戰鬥↔備戰互換', aIdx), aIdx, pl => {
        if (!pl.active) return pl;
        const old = pl.active;
        const newActive = pl.bench[0];
        // v5.348：舊 active 退備戰時清除 active-only 旗標（含 cantAttackPending 招式鎖），
        //   與其他互換 resolver 一致，符合 PTCG 規則（退場清狀態）。
        return { ...pl, active: { ...newActive, status: undefined, movedToActiveThisTurn: true }, bench: [clearActiveEffects(old)] };
      }), aIdx, _pool);
    }
    state = addLog(state, '烏栗：選 1 隻備戰寶可夢與戰鬥互換', aIdx);
    return withPending(state, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'unruda-swap',
    });
  }
  if (choice === 'boost') {
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    p.unrudaBonusThisTurn = true;  // v2.139 專屬 flag：對 ex/V +30（engine 檢查）
    players[aIdx] = p;
    return addLog({ ...state, players },
      '烏栗：本回合自方寶可夢招式對對手戰鬥場「ex / V」+30 傷害', aIdx);
  }
  return state;
});
regR('unruda-swap', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  // v5.246：補 movedToActiveThisTurn + ON_PROMOTE prompt
  return tryPromptPromoteActive(updatePlayer(state, aIdx, pl => {
    if (!pl.active) return pl;
    const idx = pl.bench.findIndex(c => c.iid === iids[0]);
    if (idx < 0) return pl;
    const newActive = pl.bench[idx];
    const newBench = [...pl.bench];
    newBench.splice(idx, 1);
    newBench.push(clearActiveEffects(pl.active)); // v5.348：退備戰清招式鎖等 active-only 旗標
    return { ...pl, active: { ...newActive, status: undefined, movedToActiveThisTurn: true }, bench: newBench };
  }), aIdx, pool);
});



// ── 聖灰（Item）— 從棄牌區挑最多 5 張寶可夢卡放回牌庫並重洗 ─────────────────
regG('聖灰', (st, idx, pool) => {
  return st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
});
reg('聖灰', (st, idx, pool) => {
  const p = st.players[idx];
  const pokeCount = p.discard.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').length;
  if (pokeCount === 0) return addLog(st, '聖灰：棄牌區無寶可夢可選', idx);
  st = addLog(st, '聖灰：從棄牌區挑最多 5 張寶可夢放回牌庫並重洗', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 5,
    effectKey: 'sacred-ash-discard-to-deck',
  });
});
regR('sacred-ash-discard-to-deck', (state, aIdx, iids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picked = p.discard.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(s, '聖灰：未選任何卡', aIdx);
  p.discard = p.discard.filter(c => !iids.includes(c.iid));
  p.deck = shuffle([...p.deck, ...picked]);
  players[aIdx] = p;
  s = { ...s, players };
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return addLog(s, `聖灰：${names}（${picked.length} 張）放回牌庫並重洗`, aIdx);
});

// ── 秘密箱 ACE（Item）— 棄 3 手牌，搜「物品/道具/支援者/競技場」各 1 張到手 ──
regG('秘密箱', (st, idx) => {
  // 卡面：「必須將自己的 3 張手牌丟棄才可使用」— 手牌（含此卡）需 ≥4 張
  if (st.players[idx].hand.length < 4) return false;
  if (st.players[idx].deck.length === 0) return false;
  return true;
});
reg('秘密箱', (st, idx) => {
  st = addLog(st, '秘密箱：先選 3 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    filter: '', minCount: 3, maxCount: 3,
    effectKey: 'mystery-box-step1',
  });
});
regR('mystery-box-step1', (state, aIdx, iids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picked = p.hand.filter(c => iids.includes(c.iid));
  p.hand = p.hand.filter(c => !iids.includes(c.iid));
  p.discard = [...p.discard, ...picked];
  players[aIdx] = p;
  s = { ...s, players };
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  s = addLog(s, `秘密箱：丟棄 ${picked.length} 張手牌（${names}）`, aIdx);
  // v2.144 — 改為 4 步串接：物品 → 道具 → 支援者 → 競技場（各最多 1 張）
  s = addLog(s, '秘密箱：第 1 步—從牌庫選 1 張「物品」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Item', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-item',
  });
});

// v2.144 — 秘密箱串接 resolver（不在中途重洗，最後一步才 shuffle）──
regR('mystery-box-pick-item', (state, aIdx, iids, _params, pool) => {
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: remaining };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（物品）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過物品', aIdx);
  }
  s = addLog(s, '秘密箱：第 2 步—從牌庫選 1 張「寶可夢道具」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Tool', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-tool',
  });
});
regR('mystery-box-pick-tool', (state, aIdx, iids, _params, pool) => {
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: remaining };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（寶可夢道具）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過寶可夢道具', aIdx);
  }
  s = addLog(s, '秘密箱：第 3 步—從牌庫選 1 張「支援者」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Supporter', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-supporter',
  });
});
regR('mystery-box-pick-supporter', (state, aIdx, iids, _params, pool) => {
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: remaining };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（支援者）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過支援者', aIdx);
  }
  s = addLog(s, '秘密箱：第 4 步—從牌庫選 1 張「競技場」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Stadium', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-stadium',
  });
});
regR('mystery-box-pick-stadium', (state, aIdx, iids, _params, pool) => {
  // 最後一步：抽完重洗
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: shuffle(remaining) };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（競技場）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過競技場', aIdx);
  }
  s = addLog(s, '秘密箱：完成搜尋並重洗牌庫', aIdx);
  return s;
});

// ── 火箭隊的烏鴉頭頭｜火箭羽毛 60× v2.143 完整實裝（玩家自選張數） ──────────
// 卡面：從手牌任意數量「火箭隊」支援者丟棄，造成 ×60 傷害。
// 註冊到 ATTACK_PRE_DISCARD_CHOICE — UI 端宣告招式時彈 modal 給玩家選張數，
// 確認後 action.discardedEnergyIids 帶手牌 iid（v2.143 重用既有欄位，雖名為
// energy 實際裝手牌 iid）。AI 端 fallback：自動全丟（最大化攻擊）。
ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的烏鴉頭頭|火箭羽毛', {
  min: 0,
  max: null,  // 不限上限
  scope: 'hand-rocket-supporter',
  baseDamage: 0,
  damagePerEnergy: 60,
});
regPre('火箭隊的烏鴉頭頭|火箭羽毛', (state, aIdx, pool, action) => {
  const p = state.players[aIdx];
  const chosenIids = action?.discardedEnergyIids;  // 玩家挑選的手牌 iid（PRE_DISCARD_CHOICE 流程）
  let idxs: number[];
  if (chosenIids && chosenIids.length > 0) {
    // 玩家明確指定：用這幾張
    const idSet = new Set(chosenIids);
    idxs = [];
    p.hand.forEach((c, i) => {
      if (idSet.has(c.iid)) {
        const card = pool.get(c.cardId);
        if (card?.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊')) {
          idxs.push(i);
        }
      }
    });
  } else {
    // AI / 未開 modal fallback：自動全丟（最大化攻擊）
    idxs = [];
    p.hand.forEach((c, i) => {
      const card = pool.get(c.cardId);
      if (card?.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊')) {
        idxs.push(i);
      }
    });
  }
  if (idxs.length === 0) {
    return { state: addLog(state, '火箭羽毛：未丟棄任何手牌 → 0 傷害', aIdx), damage: 0 };
  }
  const damage = idxs.length * 60;
  const discarded = idxs.map(i => p.hand[i]);
  const names = discarded.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `火箭羽毛：丟 ${discarded.length} 張（${names}），造成 ${damage} 傷害`, aIdx);
  s = updatePlayer(s, aIdx, pl => ({
    ...pl,
    hand: pl.hand.filter((_, i) => !idxs.includes(i)),
    discard: [...pl.discard, ...discarded],
  }));
  return { state: s, damage };
});

// ── 火箭隊的烏鴉頭頭｜頭突 100（無附加效果） ─── 不需 reg

// ── 火箭隊的黑暗鴉｜誑騙 0 + 搜支援者到手 ───────────────────────────────────
regPre('火箭隊的黑暗鴉|誑騙', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('火箭隊的黑暗鴉|誑騙', deckSearchToHandPost(1, 'Supporter', '誑騙'));

// ── 火箭隊的黑暗鴉|無理取鬧 30 + 鎖對手戰鬥位 1 招式（下回合）── v2.138 / v2.230 升級
// 卡面：選 1 個對手戰鬥寶可夢持有的招式。下回合對手戰鬥位寶可夢無法使用此招式。
// v2.230：升級為 modal-choice — 玩家在 ATTACK_POST 階段從對手戰鬥位招式中選 1 個鎖
//   （v2.230 不再簡化；原版自動鎖最後 1 個，與卡面「選 1 個」不符）。
//   若對手只有 1 招直接套用 fast path，無需 modal。
//   若對手換戰鬥位，鎖招會自動失效（卡面就是這樣設計）。
regPre('火箭隊的黑暗鴉|無理取鬧', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('火箭隊的黑暗鴉|無理取鬧', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;
  const defCard = pool.get(def.active.cardId);
  const attacks = defCard?.attacks ?? [];
  if (attacks.length === 0) return state;
  // 只有 1 招：直接鎖（無 modal）
  if (attacks.length === 1) {
    const lockedName = attacks[0].name;
    const players = [...state.players] as [PlayerState, PlayerState];
    const newDef = { ...def };
    const cur = newDef.active!.blockedAttackNamesNextTurn ?? [];
    newDef.active = {
      ...newDef.active!,
      blockedAttackNamesNextTurn: [...cur, lockedName],
    };
    players[dIdx] = newDef;
    return addLog({ ...state, players },
      `無理取鬧：${defCard?.name ?? '?'} 下回合無法使用「${lockedName}」`, aIdx);
  }
  // 多招：開 modal-choice 讓玩家選
  const s = addLog(state, `無理取鬧：選擇 1 個對手 ${defCard?.name ?? '?'} 持有的招式鎖住`, aIdx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'unreasonable-lock-attack',
    params: {
      label: '無理取鬧',
      options: attacks.map((a, i) => ({ id: `${i}`, text: `${i + 1}. ${a.name}` })),
      defenderName: defCard?.name ?? '?',
      attackNames: attacks.map(a => a.name),
    },
  });
});
regR('unreasonable-lock-attack', (st, aIdx, iids, params, _pool) => {
  const choiceIdx = parseInt(iids[0] ?? '0', 10);
  const attackNames = (params?.attackNames as string[] | undefined) ?? [];
  const lockedName = attackNames[choiceIdx];
  const defenderName = (params?.defenderName as string | undefined) ?? '?';
  if (!lockedName) return st;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = st.players[dIdx];
  // 對手可能在等待期間換戰鬥位 — 若已不在原位則放棄鎖
  if (!def.active) return addLog(st, `無理取鬧：對手戰鬥位已變動，鎖招失效`, aIdx);
  const players = [...st.players] as [PlayerState, PlayerState];
  const newDef = { ...def };
  const cur = newDef.active!.blockedAttackNamesNextTurn ?? [];
  newDef.active = {
    ...newDef.active!,
    blockedAttackNamesNextTurn: [...cur, lockedName],
  };
  players[dIdx] = newDef;
  return addLog({ ...st, players },
    `無理取鬧：${defenderName} 下回合無法使用「${lockedName}」`, aIdx);
});

// ── 火箭隊的多邊獸｜駭客攻擊 0 + 雙方各棄 1 手牌 ─────────────────────────────
// v2.230 升級為 chained pending（不再簡化）。
//   卡面：「雙方玩家各自將自己的 1 張手牌丟棄」 → 兩邊都應該由各自玩家選。
//   原版自動丟最右是錯的（玩家應該能選哪張）。
//   修法：先開玩家的 hand-discard pending（minCount=1，maxCount=1）；
//   resolver 處理完玩家後再開對手的 hand-discard pending（actorIdx=dIdx）。
regPre('火箭隊的多邊獸|駭客攻擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('火箭隊的多邊獸|駭客攻擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[aIdx];
  const op = state.players[dIdx];
  if (p.hand.length === 0 && op.hand.length === 0) {
    return addLog(state, '駭客攻擊：雙方手牌皆空', aIdx);
  }
  // 先處理攻擊方（自己選 1 張丟）
  if (p.hand.length > 0) {
    const s = addLog(state, '駭客攻擊：選 1 張自己手牌丟棄', aIdx);
    return withPending(s, {
      type: 'hand-discard',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'hack-attack-self-then-opp',
    });
  }
  // 攻擊方手牌空 → 直接跳到對手
  if (op.hand.length > 0) {
    const s = addLog(state, '駭客攻擊：對手選 1 張自己手牌丟棄', aIdx);
    return withPending(s, {
      type: 'hand-discard',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'hack-attack-opp-only',
    });
  }
  return state;
});
regR('hack-attack-self-then-opp', (st, aIdx, iids, _params, pool) => {
  // 攻擊方丟棄選的卡
  let s = st;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const dropped = p.hand.filter(c => iids.includes(c.iid));
  p.hand = p.hand.filter(c => !iids.includes(c.iid));
  p.discard = [...p.discard, ...dropped];
  players[aIdx] = p;
  s = { ...s, players };
  if (dropped.length > 0) {
    const names = dropped.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    s = addLog(s, `駭客攻擊：自己丟棄 ${names}`, aIdx);
  }
  // 接著要求對手做選擇
  const dIdx = (1 - aIdx) as 0 | 1;
  if (s.players[dIdx].hand.length === 0) return s;
  s = addLog(s, '駭客攻擊：對手選 1 張自己手牌丟棄', aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'hack-attack-opp-only',
  });
});
regR('hack-attack-opp-only', (st, _aIdx, iids, _params, pool) => {
  // 注意：actorIdx 是對手（dIdx），但 effectKey 從攻擊方視角觸發；
  //   resolver 收到的 _aIdx 在 RESOLVERS 統一是 actorIdx（即對手 idx）
  //   — 所以這裡直接用 _aIdx（=dIdx）操作 hand
  const dIdx = _aIdx; // 對手選了，所以 actorIdx = dIdx
  let s = st;
  const players = [...s.players] as [PlayerState, PlayerState];
  const o = { ...players[dIdx] };
  const dropped = o.hand.filter(c => iids.includes(c.iid));
  o.hand = o.hand.filter(c => !iids.includes(c.iid));
  o.discard = [...o.discard, ...dropped];
  players[dIdx] = o;
  s = { ...s, players };
  if (dropped.length > 0) {
    const names = dropped.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    s = addLog(s, `駭客攻擊：對手丟棄 ${names}`, dIdx);
  }
  return s;
});

// ── 火箭隊的多邊獸Ⅱ｜R指令 20×（自方棄牌區「火箭隊」支援者卡張數） ────────
regPre('火箭隊的多邊獸Ⅱ|R指令', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const count = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊');
  }).length;
  const damage = count * 20;
  const s = addLog(state, `R指令：棄牌區「火箭隊」支援者 ${count} 張 → ${damage} 傷害`, aIdx);
  return { state: s, damage };
});

// ── 洛拍棒（Item）— 牌庫上方 4 張看，挑任意數量支援者加手 + 剩餘洗回 ────────
regG('洛拍棒', (st, idx) => {
  return st.players[idx].deck.length > 0;
});
reg('洛拍棒', (st, idx) => {
  const p = st.players[idx];
  const top4 = p.deck.slice(0, 4);
  if (top4.length === 0) return addLog(st, '洛拍棒：牌庫為空', idx);
  st = addLog(st, `洛拍棒：查看牌庫上方 ${top4.length} 張，選任意數量支援者加手牌`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter:TOP4',
    minCount: 0, maxCount: 4,
    effectKey: 'recall-rod',
    params: { top4Iids: top4.map(c => c.iid) },
  });
});
regR('recall-rod', (state, aIdx, iids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picked = p.deck.filter(c => iids.includes(c.iid));
  p.hand = [...p.hand, ...picked];
  p.deck = shuffle(p.deck.filter(c => !iids.includes(c.iid)));
  players[aIdx] = p;
  s = { ...s, players };
  if (picked.length > 0) {
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    s = addLog(s, `洛拍棒：${names}（${picked.length} 張）加手牌，剩餘洗回牌庫`, aIdx);
  } else {
    s = addLog(s, '洛拍棒：未選卡，剩餘洗回牌庫', aIdx);
  }
  return s;
});

// ── v2.144 道具拆除器（Item）─────────────────────────────────────────────────
// 卡面：選擇最多 2 張雙方場上寶可夢身上附加的「寶可夢道具」卡，將其丟棄。
// 用 modal-choice 列雙方所有 Tool；玩家選 1 張 → resolver 丟掉 → 若還剩 ≥1 張 Tool
// 開第 2 個 modal 讓玩家選第 2 張或結束。
regG('道具拆除器', (st) => {
  const allTools: string[] = [];
  for (const idx of [0, 1] as const) {
    const p = st.players[idx];
    // v3.20 多重轉接：iterate 所有道具
    for (const t of getAllAttachedTools(p.active)) allTools.push(t.iid);
    for (const b of p.bench) for (const t of getAllAttachedTools(b)) allTools.push(t.iid);
  }
  return allTools.length > 0;
});
function buildToolRemoverOptions(st: GameState, pool: Map<string, Card>) {
  // v5.191：每個 opt 加 inspectIid + inspectPlayerIdx，讓 UI 渲染放大鏡按鈕
  const opts: { id: string; text: string; inspectIid?: string; inspectPlayerIdx?: 0 | 1 }[] = [];
  for (const idx of [0, 1] as const) {
    const p = st.players[idx];
    const sideLabel = idx === st.activePlayerIndex ? '我方' : '對手';
    const all = [
      ...(p.active ? [{ inst: p.active, pos: '戰鬥' as const }] : []),
      ...p.bench.map(b => ({ inst: b, pos: '備戰' as const })),
    ];
    for (const { inst, pos } of all) {
      // v3.20 多重轉接：iterate 所有道具
      const tools = getAllAttachedTools(inst);
      if (tools.length === 0) continue;
      const ownerName = pool.get(inst.cardId)?.name ?? '?';
      for (const t of tools) {
        const toolName = pool.get(t.cardId)?.name ?? '?';
        opts.push({
          id: `${idx}:${inst.iid}:${t.iid}`,
          text: `🔧 ${sideLabel} ${pos} ${ownerName} 的「${toolName}」`,
          inspectIid: inst.iid,
          inspectPlayerIdx: idx,
        });
      }
    }
  }
  return opts;
}
reg('道具拆除器', (st, idx, pool) => {
  const opts = buildToolRemoverOptions(st, pool);
  if (opts.length === 0) return addLog(st, '道具拆除器：場上沒有道具卡可丟棄', idx);
  st = addLog(st, '道具拆除器：選 1 張雙方場上的道具卡丟棄（最多可丟 2 張）', idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'tool-remover-pick',
    // v5.190：picksLeft: 1 → 2 (卡面「最多 2 張」)
    //   原 1 → resolver L14386 (1-1=0) → if (picksLeft >= 1) 不觸發 → 第 2 個 modal 不開
    //   2 → 第 1 張 pick 完 picksLeft=1 → 開第 2 個 modal → 第 2 張 pick 完 0 結束
    params: { label: '道具拆除器（第 1 張，最多 2 張）', options: opts, picksLeft: 2 },
  });
});
regR('tool-remover-pick', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const choice = iids[0];
  // v5.208：「結束（不丟第 2 張）」option id='end' early return — 不走 split + iid 解析路徑
  //   舊版走到 L14584 「找不到目標道具」誤導 log；現改正確 log
  if (choice === 'end') {
    return addLog(state, '道具拆除器：玩家選擇不丟第 2 張', aIdx);
  }
  // v3.20 多重轉接：選項 ID 從 'pIdx:instIid' 改為 'pIdx:instIid:toolIid' 以區分主道具與 extraTools
  const segs = choice.split(':');
  const pIdxStr = segs[0];
  const targetIid = segs[1];
  const targetToolIid = segs[2];
  const pIdx = parseInt(pIdxStr) as 0 | 1;
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const pp = { ...players[pIdx] };
  // closure 內 mutation TS 不追蹤 → 用 any 規避 never 推論
  let removedTool: any = undefined;
  let ownerName = '?';
  const removeFromInst = (inst: import('./types').CardInstance) => {
    if (targetToolIid) {
      if (inst.toolAttached?.iid === targetToolIid) {
        removedTool = inst.toolAttached;
        return { ...inst, toolAttached: undefined };
      }
      if (inst.extraTools && inst.extraTools.length > 0) {
        const found = inst.extraTools.find(x => x.iid === targetToolIid);
        if (found) {
          removedTool = found;
          return { ...inst, extraTools: inst.extraTools.filter(x => x.iid !== targetToolIid) };
        }
      }
      return inst;
    }
    if (inst.toolAttached) {
      removedTool = inst.toolAttached;
      return { ...inst, toolAttached: undefined };
    }
    return inst;
  };
  if (pp.active?.iid === targetIid) {
    ownerName = pool.get(pp.active.cardId)?.name ?? '?';
    pp.active = removeFromInst(pp.active);
  } else {
    const bIdx = pp.bench.findIndex(b => b.iid === targetIid);
    if (bIdx >= 0) {
      ownerName = pool.get(pp.bench[bIdx].cardId)?.name ?? '?';
      pp.bench = [...pp.bench];
      pp.bench[bIdx] = removeFromInst(pp.bench[bIdx]);
    }
  }
  if (!removedTool) return addLog(s, '道具拆除器：找不到目標道具', aIdx);
  pp.discard = [...pp.discard, removedTool];
  players[pIdx] = pp;
  s = { ...s, players };
  const tname = pool.get(removedTool.cardId)?.name ?? '?';
  s = addLog(s, `道具拆除器：丟棄 ${ownerName} 身上的「${tname}」`, aIdx);

  // 若還可以丟第 2 張，且場上還有 Tool → 開第 2 個 modal-choice 讓玩家選或結束
  const picksLeft = (params?.picksLeft as number ?? 1) - 1;
  if (picksLeft >= 1) {
    const opts2 = buildToolRemoverOptions(s, pool);
    if (opts2.length > 0) {
      // 加「結束（不丟第 2 張）」選項
      opts2.push({ id: 'end', text: '✋ 結束（不丟第 2 張）' });
      s = withPending(s, {
        type: 'modal-choice',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'tool-remover-pick',
        params: { label: '道具拆除器（第 2 張）', options: opts2, picksLeft: 0 },
      });
    }
  }
  return s;
});
// 'end' choice handler — 沒做事，只是結束 chain
regR('tool-remover-end', (state) => state);

// ══════════════════════════════════════════════════════════════════════════════
// SV11W 炎武王｜烈火亂舞（v2.296）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時，可不限次數使用。從自己的手牌選擇 1 張「基本【火】能量」
//         卡，附於自己的寶可夢身上。」
// 實裝要點：
//   - 此特性不受每回合 1 次限制（已在 UNLIMITED_USE_ABILITY_NAMES 白名單）
//   - 附加目標是「自己任何一隻寶可夢」（戰鬥 + 備戰）
//   - 手牌選 1 張 BasicFireEnergy → bench-or-active choose 選目標
// ──────────────────────────────────────────────────────────────────────────────
regA('炎武王', 0, (st, idx, pool) => {
  const player = st.players[idx];
  // gate：手牌需有基本【火】能量
  const fireEnergyIids = player.hand
    .filter(c => {
      const cc = pool.get(c.cardId);
      return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
        && (cc.pokemonType === 'Fire' || /【火】/.test(cc.name));
    })
    .map(c => c.iid);
  if (fireEnergyIids.length === 0) {
    return addLog(st, '烈火亂舞：手牌中沒有基本【火】能量', idx);
  }
  st = addLog(st, '烈火亂舞：從手牌選 1 張基本【火】能量附於自己的寶可夢', idx);
  return withPending(st, {
    type: 'hand-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'inferno-fandango-pick-energy',
    params: { validIids: fireEnergyIids },
  });
});

regR('inferno-fandango-pick-energy', (st, idx, iids, _params, pool) => {
  const energyIid = iids[0];
  if (!energyIid) return st;
  const player = st.players[idx];
  const energyInst = player.hand.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const energyName = pool.get(energyInst.cardId)?.name ?? '能量';
  // v5.184：詛咒根擋手牌附能 — filter 場上可附目標（在移除手牌能量之前先驗證）
  const field = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ].filter(c => !c.cantAttachEnergyThisTurn);
  if (field.length === 0) {
    return addLog(st, `烈火亂舞：場上寶可夢全數受詛咒根影響，無法附加 ${energyName}`, idx);
  }
  // 從手牌移除能量（暫存 params）並要求選附加目標
  st = updatePlayer(st, idx, p => ({
    ...p,
    hand: p.hand.filter(c => c.iid !== energyIid),
  }));
  st = addLog(st, `烈火亂舞：選擇要附加 ${energyName} 的寶可夢`, idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'inferno-fandango-attach',
    params: { energyIid, energyCardId: energyInst.cardId, validIids: field.map(c => c.iid) },
  });
});

regR('inferno-fandango-attach', (st, idx, iids, params, pool) => {
  const targetIid = iids[0];
  const energyIid = params?.energyIid as string | undefined;
  const energyCardId = params?.energyCardId as string | undefined;
  if (!targetIid || !energyIid || !energyCardId) return st;
  const energyInst: import('./types').CardInstance = { iid: energyIid, cardId: energyCardId, damage: 0, energyAttached: [] };
  const energyName = pool.get(energyCardId)?.name ?? '能量';
  const _attached = updatePlayer(st, idx, p => {
    const attachTo = (inst: import('./types').CardInstance | null): import('./types').CardInstance | null => {
      if (!inst || inst.iid !== targetIid) return inst;
      const name = pool.get(inst.cardId)?.name ?? '?';
      st = addLog(st, `烈火亂舞：將 ${energyName} 附加到 ${name}`, idx);
      return { ...inst, energyAttached: [...inst.energyAttached, energyInst] };
    };
    return {
      ...p,
      active: attachTo(p.active) as import('./types').CardInstance | null,
      bench: p.bench.map(c => attachTo(c) ?? c),
    };
  });
  return _magHeal(_attached, idx, [targetIid], pool);  // v5.484 自動治癒
});

// v3.07 Deferred Wave D — 手牌觸發特性 effect fn（給 ON_DISCARD_FROM_HAND_ABILITIES /
// ON_HAND_ACTIVATE_ABILITIES Map literal 使用）
import {
  supercatExpAbility_LureTail,
  volcaronaAbility_HeatScale,
  klingerAbility_EmergencyRotate,
} from './effects/cards/v3070_deferred_wave_d';

// ══════════════════════════════════════════════════════════════════════════════
// v2.320 — 「從手牌使出/進化時」特性自動提示機制
// 將原本分散在 BENCH_PLACE_TRIGGERS / getUsableAbilities 的特性觸發，
// 統一為放置/進化後立即彈出「是否使用特性？」的 modal-choice 詢問。
// ══════════════════════════════════════════════════════════════════════════════

/** 「從手牌放置於備戰區時」可發動 1 次的特性名稱 */
export const ON_PLAY_FROM_HAND_ABILITIES = new Set([
  '殺手鐧捕捉',   // 喵喵ex — 搜支援者
  '狂挖',         // 螺釘地鼠 — 牌庫選鬥能量丟棄
  '經驗法則',     // 月月熊 赫月 — 手牌鬥能量附給自己
  '沉雪',         // 古劍豹 — 丟棄場上競技場
  '迅速游標',     // 鐵斑葉ex — 與戰鬥場互換+搬能量
  '突然削退',     // 鐵蟻ex — 丟對手牌庫頂
  '臨場背負',     // v2.998 大蔥鴨 — 牌庫搜寶可夢道具附身 + 重洗
]);

/** 「從手牌進化時」可發動 1 次的特性名稱 */
export const ON_EVOLVE_FROM_HAND_ABILITIES = new Set([
  '龐克練肌',     // 瑪俐的長毛巨魔ex — 搜惡能量附於瑪俐的寶可夢
  '精神抽出',     // 勇基拉/胡地 — 抽卡
  '搜尋寶石',     // 貓頭夜鷹 — 場上有太晶時搜訓練家
  '能量舞步',     // 噗噗豬 — 牌庫上方4張找基本能量
  '脫殼',         // 鐵面忍者 — 搜脫殼忍者上備戰
  '合金建造',     // 鋁鋼橋龍ex — 棄牌區鋼能量附給鋼寶可夢
  '大力捕捉器',   // v2.94 鐵掌力士 — 對手備戰 1 隻 ↔ 戰鬥場
  '增長繭',       // v5.588 甲殼繭 — 進化時搜牌庫放甲殼繭/盾甲繭上備戰（改自動提示 modal，原僅手動按鈕）
  // v2.998 Group 2 — 12 張進化觸發特性 + 1 張雙觸發（沙之羽擊也走 PASSIVE_ON_KO）
  '繁星花紋',     // 安瓢蟲 — HP≤90 對手備戰 ↔ 戰鬥場互換
  '使壞之尾',     // 雙尾怪手 — 擲 2 幣，正面數量隨機抽對手手牌放回牌庫並重洗
  '柔柔治癒',     // 風妖精 — 戰鬥場是【草】寶可夢時全恢復 HP + 棄能量
  '飽腹時間',     // 麻花犬ex — 自方所有進化全恢復 HP + 棄能量
  '臨場之錘',     // 巧鍛匠 — 擲 1 幣，正面則丟對手戰鬥位 1 個能量
  '恐慌牢籠',     // 怖納噬草 — 對手戰鬥場【混亂】
  '貪慾點餐',     // 派帕的藏飽栗鼠 — 棄牌區搜最多 2 張「派帕的三明治」入手
  '亂咬',         // 火箭隊的叉字蝠ex — 對手 2 隻寶可夢各放 2 個傷害指示物
  '暗中咬住',     // 火箭隊的大嘴蝠 — 對手 1 隻寶可夢放 2 個傷害指示物
  '邀請眨眼',     // 莉莉艾的蝶結萌虻 — 看對手手牌 → 任意數量基礎寶可夢放對手備戰
  '挑戰角擊',     // 赫普的毛毛角羊 — 對手備戰 ↔ 戰鬥場互換
  '尖刺纏身',     // 鬃岩狼人 — 棄牌區搜最多 2 張「扣殺能量」附於這隻
  '沙之羽擊',     // 沙漠蜻蜓 — 對手牌庫上方 2 張丟棄（KO 時亦觸發；見 PASSIVE_ON_KO）
]);

/**
 * v3.05 — 「從戰鬥場回備戰時」可發動 1 次的特性名稱。
 * 觸發時機：寶可夢從戰鬥場回到備戰區（撤退、招式效果換場、特性效果換場、被吹回）。
 * 本波先 hook 在 RETREAT 路徑；其他路徑（招式 / 特性 / 風扇呼喚等）後續逐一補上。
 */
export const ON_RETREAT_TO_BENCH_ABILITIES = new Set([
  '全能變身',     // 海豚俠 — 與牌庫的「海豚俠ex」互換並保留全部附加
  '返回重載',     // 鋼炮臂蝦 — 從手牌附最多 2 張基本【水】能量
]);

// v5.243：set 搬到 _shared.ts（leaf module）避免 circular import；此檔 re-export 對外 API
export { ON_PROMOTE_TO_ACTIVE_ABILITIES, tryPromptPromoteActive, askUsePromoteActiveAbility } from './effects/_shared';

/**
 * v3.07 Deferred Wave D — 「從手牌將 1 張指定卡丟棄則觸發場上特性」的 trigger holder 名稱
 * → effect fn 對應表。Key = trigger holder 卡名（場上有此卡才能用）。
 *
 * 觸發路徑：玩家從手牌按按鈕 → engine USE_HAND_DISCARD_ABILITY handler 驗證並棄牌 →
 *   查此 Map 取得 fn → 執行效果（通常開 pendingSelection）。
 *
 * 卡片清單見 v3070_deferred_wave_d.ts。
 */
// v5.510：熱浪鱗粉(火神蛾) / 誘導之尾(超能妙喵) 從「手牌棄牌按鈕」改為「寶可夢上的 regA 啟動特性」
//   （碧綠之舞 pattern；玩家回報按鈕跑到手牌、應在寶可夢身上）。發動時自動丟手牌資源(基本火能量 /
//   悠哉尾草棒)再執行原效果。每隻寶可夢 1 回 1 次由 engine abilityUsedThisTurn 管控；按鈕顯示 gate
//   在 getUsableAbilities（手牌需有資源 + 目標合法）。1/turn 改 instance-based 也更正確(各自1次)。
regA('火神蛾', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const fire = p.hand.find(c => {
    const cc = pool.get(c.cardId);
    return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && (cc.name?.includes('【火】') ?? false);
  });
  if (!fire) return addLog(st, '熱浪鱗粉：手牌中沒有基本【火】能量', idx);
  let s = updatePlayer(st, idx, pl => ({ ...pl, hand: pl.hand.filter(c => c.iid !== fire.iid), discard: [...pl.discard, fire] }));
  s = addLog(s, `熱浪鱗粉：從手牌丟棄 ${pool.get(fire.cardId)?.name ?? '基本【火】能量'}`, idx);
  return volcaronaAbility_HeatScale(s, idx, pool, fire);
});
regA('超能妙喵', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const slow = p.hand.find(c => pool.get(c.cardId)?.name === '悠哉尾草棒');
  if (!slow) return addLog(st, '誘導之尾：手牌中沒有「悠哉尾草棒」', idx);
  let s = updatePlayer(st, idx, pl => ({ ...pl, hand: pl.hand.filter(c => c.iid !== slow.iid), discard: [...pl.discard, slow] }));
  s = addLog(s, '誘導之尾：從手牌丟棄「悠哉尾草棒」', idx);
  return supercatExpAbility_LureTail(s, idx, pool, slow);
});

export const ON_DISCARD_FROM_HAND_ABILITIES = new Map<
  string,
  (state: GameState, idx: 0 | 1, pool: Map<string, Card>, triggerInst: CardInstance) => GameState
>([
  // v5.510：超能妙喵|誘導之尾 / 火神蛾|熱浪鱗粉 已改為寶可夢上的 regA 啟動特性（見上方 regA），
  //   不再走手牌棄牌按鈕；從此 map 移除避免雙按鈕。effect fn 仍由 regA wrapper 呼叫。
]);

/**
 * v3.07 Deferred Wave D — 「手牌寶可夢自身為 trigger，自己上場」型特性。
 * Key = 該手牌寶可夢卡名。
 *
 * 觸發路徑：玩家從手牌按按鈕 → engine USE_HAND_ABILITY handler 驗證 →
 *   查此 Map 取得 fn → 執行效果（通常把 inst 從 hand 搬到 bench）。
 *
 * 與 ON_DISCARD_FROM_HAND 的差別：trigger 不是棄掉「另一張」手牌，而是『此手牌卡自身』。
 */
export const ON_HAND_ACTIVATE_ABILITIES = new Map<
  string,
  (state: GameState, idx: 0 | 1, pool: Map<string, Card>, handInst: CardInstance) => GameState
>([
  ['齒輪怪', klingerAbility_EmergencyRotate], // 對手有 Stage 2 時放此卡到備戰
]);


/**
 * 詢問玩家是否使用「從手牌放置/進化時」的特性。
 * 彈出 modal-choice（是/否），玩家選「是」則自動執行對應的 ABILITY_EFFECTS。
 */
export function askUsePlayAbility(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  inst: CardInstance,
  abilityName: string,
  abilityKey: string
): GameState {
  const cardName = pool.get(inst.cardId)?.name ?? '?';
  return withPending(state, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'resolve-play-ability-prompt',
    params: {
      label: `是否使用 ${cardName} 的「${abilityName}」特性？`,
      options: [
        { id: 'yes', text: '✅ 使用特性' },
        { id: 'no', text: '❌ 不使用' }
      ],
      abilityKey,
      targetIid: inst.iid
    }
  });
}

// ── resolve-play-ability-prompt resolver ─────────────────────────────────────
regR('resolve-play-ability-prompt', (state, actorIdx, selectedIids, params, pool) => {
  const choice = selectedIids[0] ?? 'no';
  if (choice !== 'yes') {
    return state; // 玩家選擇不使用，直接繼續
  }
  const abilityKey = params?.abilityKey as string;
  const targetIid = params?.targetIid as string;
  if (!abilityKey) return state;

  const fn = ABILITY_EFFECTS.get(abilityKey);
  if (!fn) return state;

  const player = state.players[actorIdx];
  const inst = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid);
  if (!inst) return state;

  return fn(state, actorIdx, pool, inst);
});

/**
 * 在 PLAY_BASIC / EVOLVE 後呼叫，檢查該寶可夢是否有「從手牌使出/進化時」的特性，
 * 若有則自動彈出詢問 modal。
 *
 * @param isEvolve  true = 進化觸發；false = 從手牌放置觸發
 */
export function promptPlayAbilities(
  state: GameState,
  aIdx: 0 | 1,
  card: Card,
  inst: CardInstance,
  pool: Map<string, Card>,
  isEvolve: boolean
): GameState {
  if (!card.abilities) return state;
  // 如果已經有 pendingSelection（例如 BENCH_PLACE_TRIGGERS 已觸發），不要覆蓋
  if (state.pendingSelection) return state;
  // v3.76：火箭隊的監視塔在場時，【無】寶可夢的所有特性（含 on-play / on-evolve）消除
  //   gate 在函式入口集中處理 — engine.ts 三個 caller (BENCH_PLACE / EVOLVE / 神奇糖果)
  //   都會經此 gate，避免每個 caller 各自加 check 漏網。
  if (card.pokemonType === 'Colorless' && state.activeStadium) {
    const stadiumCard = pool.get(state.activeStadium.cardId);
    if (stadiumCard && ROCKET_WATCHTOWER_STADIUMS.has(stadiumCard.name)) {
      return state;
    }
  }
  // v5.528：鐵荊棘ex｜初始化 — 收斂至中央 isInitializeNullified（單一來源，與 getUsableAbilities/
  //   USE_ABILITY/被動套用點同一判定；rule-box + 「未來」除外 + 場上有初始化 的規則只維護在 v3001 一處）。
  //   涵蓋「剛上場/進化即確認是否發動」型(喵喵ex 殺手鐧捕捉等 on-play/on-evolve)。鐵斑葉ex|迅速游標
  //   為「未來」寶可夢→卡面明示不受初始化影響(正確不擋)。
  if (isInitializeNullified(state, card, pool)) return state;

  for (let i = 0; i < card.abilities.length; i++) {
    const ab = card.abilities[i];
    const key = `${card.name}|${i}`;
    // 只處理有在 ABILITY_EFFECTS 註冊的特性
    if (!ABILITY_EFFECTS.has(key)) continue;

    const isPlay = ON_PLAY_FROM_HAND_ABILITIES.has(ab.name);
    const isEvolveAb = ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name);

    // ── 放置觸發 ──
    if (!isEvolve && isPlay) {
      // 各特性的前置條件 gate — 只保留「公開資訊」的檢查
      // v2.321：依 v2.316 原則（PTCG 隱藏資訊規則），牌庫搜尋類特性
      // 不應因「牌庫裡沒有目標」就禁止使用，玩家可藉此檢視牌庫內容。
      if (ab.name === '沉雪' && !state.activeStadium) continue;        // 場上無競技場 → 無意義
      if (ab.name === '迅速游標' && state.players[aIdx].active?.iid === inst.iid) continue; // 必須從備戰發動
      if (ab.name === '經驗法則') {
        // 卡面：「從手牌選最多 2 張基本鬥能量附於這隻寶可夢」— 手牌是玩家可見資訊
        const hasFight = state.players[aIdx].hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc?.subtype === 'Basic'
            && (cc.pokemonType === 'Fighting' || /【鬥】/.test(cc.name));
        });
        if (!hasFight) continue;
      }
      // 狂挖：牌庫搜尋 → 不檢查牌庫內容（v2.321 修正）
      // 殺手鐧捕捉：牌庫搜尋 → 不檢查牌庫是否為空（v2.321 修正）
      if (ab.name === '殺手鐧捕捉') {
        if (state.players[aIdx].abilityNamesUsedThisTurn?.includes('殺手鐧捕捉')) continue;
      }
      if (ab.name === '突然削退') {
        const oppIdx = (1 - aIdx) as 0 | 1;
        if (state.players[oppIdx].deck.length === 0) continue; // 對手牌庫空 → 確實無法丟
      }
      return askUsePlayAbility(state, aIdx, pool, inst, ab.name, key);
    }

    // ── 進化觸發 ──
    if (isEvolve && isEvolveAb) {
      // v2.321：移除牌庫/棄牌區內容檢查，只保留公開資訊 gate
      // 龐克練肌：牌庫搜尋 → 不檢查牌庫是否有惡能量（v2.321 修正）
      // 精神抽出：查看牌庫上方 → 不檢查牌庫是否為空（v2.321 修正）
      if (ab.name === '搜尋寶石') {
        // 場上有太晶寶可夢是公開可見的條件
        const field = [...(state.players[aIdx].active ? [state.players[aIdx].active] : []), ...state.players[aIdx].bench];
        const hasTera = field.some(c => pool.get(c!.cardId)?.tags?.includes('太晶'));
        if (!hasTera) continue;
        // 不檢查牌庫是否為空（v2.321 修正）
      }
      if (ab.name === '合金建造') {
        // 棄牌區是公開資訊 → 保留此檢查
        const hasMetalEInDiscard = state.players[aIdx].discard.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc?.subtype === 'Basic'
            && (cc.pokemonType === 'Metal' || /【鋼】/.test(cc.name));
        });
        if (!hasMetalEInDiscard) continue;
        // 場上鋼寶可夢是公開資訊 → 保留此檢查
        const field = [...(state.players[aIdx].active ? [state.players[aIdx].active] : []), ...state.players[aIdx].bench];
        const hasMetalPoke = field.some(c => pool.get(c!.cardId)?.pokemonType === 'Metal');
        if (!hasMetalPoke) continue;
      }
      // v5.588 增長繭（甲殼繭）：備戰已滿無法放置 → 不提示（牌庫是否有目標屬隱藏資訊，不查）
      if (ab.name === '增長繭' && state.players[aIdx].bench.length >= getOwnBenchLimit(state, aIdx, pool)) continue;
      return askUsePlayAbility(state, aIdx, pool, inst, ab.name, key);
    }
  }
  return state;
}

// ══════════════════════════════════════════════════════════════════════════════
// 被動特性鉤子（OPP_ENERGY_ATTACH_PASSIVE）
// 觸發時機：engine.ts ATTACH_ENERGY handler，對手能量附著完成後
// ══════════════════════════════════════════════════════════════════════════════

// 耿鬼ex SV5K 047/071｜侵蝕詛咒
// 卡面效果：「只要這隻寶可夢在場上，每次對手從手牌將能量卡附於寶可夢身上時，
//            在那隻寶可夢身上放置2個傷害指示物。」
OPP_ENERGY_ATTACH_PASSIVE.set('侵蝕詛咒', (state, gIdx, _oppIdx, targetIid, pool) => {
  // gIdx = 侵蝕詛咒 擁有者；附能的那隻寶可夢在「對手(attacker = 1-gIdx = _oppIdx)」場上。
  // v5.536 收斂＋修 bug：原實作誤用 player = state.players[gIdx]（擁有者自己場上）去找 targetIid，
  //   但 targetIid 在【對手】場上 → 永遠找不到 → return state（沒放指示物，玩家回報）。
  //   改走中央 dealAttackDamageToTarget(kind:'attack-effect'，放 2 個傷害指示物 = 20，flat)：
  //   actorIdx=gIdx → 內部 dIdx=1-gIdx=對手，依 targetIid 在對手場上正確命中；
  //   一次處理免疫(化隱/太晶備戰/對戰圓形/光之翼)＋昏厥＋自動拿獎(原實作都漏)。
  return dealAttackDamageToTarget(state, gIdx, targetIid, 20, pool, { kind: 'attack-effect', label: '侵蝕詛咒' });
});

// ══════════════════════════════════════════════════════════════════════════════
// 主動特性（regA）
// ══════════════════════════════════════════════════════════════════════════════

// 幸福蛋ex SV6 085/101｜幸福切換
// 卡面效果：「在自己的回合時可使用1次。選擇1個自己的場上寶可夢身上附加的基本能量，
//            改附於自己的其他寶可夢身上。」
// 實作：複用現有 energy-switch 機制（energy-switch-src → energy-switch-pick-energy → energy-switch-dst）
regA('幸福蛋ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  // 找有基本能量的自己寶可夢（排除沒有能量的）
  const sources = [...(p.active ? [p.active] : []), ...p.bench].filter(poke =>
    poke.energyAttached.some(e => {
      const card = pool.get(e.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic';
    })
  );
  if (sources.length === 0) {
    return addLog(st, '幸福切換：沒有寶可夢身上有基本能量', idx);
  }
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'happy-switch-src',
    params: {
      validIids: sources.map(c => c.iid),
      titleOverride: '幸福切換：選擇要移出基本能量的寶可夢',
    },
  });
});
regR('happy-switch-src', (st, idx, iids, _params, pool) => {
  // 複用 energy-switch-src 邏輯（只是 effectKey 不同）
  const srcIid = iids[0];
  if (!srcIid) return st;
  const p = st.players[idx];
  const srcPoke = p.active?.iid === srcIid ? p.active : p.bench.find(c => c.iid === srcIid);
  if (!srcPoke) return st;
  const basicEnergies = srcPoke.energyAttached.filter(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (basicEnergies.length === 0) return st;
  const srcName = pool.get(srcPoke.cardId)?.name ?? '?';
  if (basicEnergies.length > 1) {
    return withPending(st, {
      type: 'modal-choice',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'happy-switch-pick',
      params: {
        label: '幸福切換',
        srcIid,
        energyIids: basicEnergies.map(e => e.iid),
        options: basicEnergies.map((e, i) => ({
          id: `${i}`,
          text: `${i + 1}. ${pool.get(e.cardId)?.name ?? '?'}`,
        })),
      },
    });
  }
  // 1 張 fast path
  return resolveEnergySwitchAfterPick(st, idx, srcIid, basicEnergies[0], pool);
});
regR('happy-switch-pick', (st, idx, iids, params, pool) => {
  const choiceIdx = parseInt(iids[0] ?? '0', 10);
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  const srcIid = (params?.srcIid as string | undefined) ?? '';
  const energyIid = energyIids[choiceIdx];
  if (!srcIid || !energyIid) return st;
  const p = st.players[idx];
  const srcPoke = p.active?.iid === srcIid ? p.active : p.bench.find(c => c.iid === srcIid);
  if (!srcPoke) return st;
  const energyInst = srcPoke.energyAttached.find(e => e.iid === energyIid);
  if (!energyInst) return st;
  return resolveEnergySwitchAfterPick(st, idx, srcIid, energyInst, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 招式後處理（regPost）
// ══════════════════════════════════════════════════════════════════════════════

// 倫琴貓ex SV6 041/101｜突刺目光
// 費用：[無][無] / 傷害：120
// 效果：「查看對手的手牌，從其中選擇1張卡，將其丟棄。」
regPre('倫琴貓ex|突刺目光', (state, _aIdx, _pool) => ({ state, damage: 120 }));
regPost('倫琴貓ex|突刺目光', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) {
    return addLog(state, '突刺目光：對手手牌為空', aIdx);
  }
  // 先讓雙方都看到對手手牌內容（公開 log）
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `突刺目光：查看對手手牌（${oppHand.length} 張）— ${handNames}`, aIdx);
  // 讓攻擊方玩家選擇要丟棄的卡
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'electro-shot-discard',
    params: {
      label: '突刺目光：選擇要丟棄的卡',
      options: oppHand.map((c, i) => ({
        id: c.iid,
        text: `${i + 1}. ${pool.get(c.cardId)?.name ?? '?'}`,
      })),
    },
  });
});
regR('electro-shot-discard', (st, idx, iids, params, pool) => {
  // idx = 攻擊方玩家
  const dIdx = (1 - idx) as 0 | 1;
  const selectedIid = iids[0];
  if (!selectedIid) return st;
  const oppPlayer = st.players[dIdx];
  const cardInst = oppPlayer.hand.find(c => c.iid === selectedIid);
  if (!cardInst) return st;
  const cardName = pool.get(cardInst.cardId)?.name ?? '?';
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...oppPlayer,
    hand: oppPlayer.hand.filter(c => c.iid !== selectedIid),
    discard: [...oppPlayer.discard, cardInst],
  };
  return addLog({ ...st, players }, `突刺目光：將對手 ${cardName} 丟棄`, idx);
});

// 耿鬼ex SV5K 047/071｜戲法舞步
// 費用：[惡][惡] / 傷害：160
// 效果：「若希望，選擇1個對手的戰鬥寶可夢身上附加的能量，改附於對手的備戰寶可夢身上。」
regPre('耿鬼ex|戲法舞步', (state, _aIdx, _pool) => ({ state, damage: 160 }));
// v5.717 戲法舞步中央 helper（耿鬼ex/超能妙喵共用）：「若希望，選擇1個對手戰鬥寶可夢的能量，改附對手備戰」。
//   原耿鬼ex 用 trick-step-energy(stage1 先從 active 移除能量)+trick-step-dst(stage2 從已移除的 active
//   find energyInst→undefined→return st) → 能量從戰鬥場消失、沒附到備戰(玩家回報)。
//   超能妙喵原自動取末張+隨機備戰(違反卡面「選擇1個」)。收斂：選能量用 active-energy-discard picker
//   (符合通則 reference-nplot-energy-pick)，pick 階段「不移除」、attach 階段從仍持有的 active 一步移除+附加。
export function trickStepPost(): AttackPostFn {
  return (state, aIdx, pool, action) => {
    // 若希望 binary-yes-no guard（ATTACK_PRE_DISCARD_CHOICE）
    const chosen = action?.discardedEnergyIids;
    const choseYes = chosen === undefined ? true : chosen.length >= 1;
    if (!choseYes) return addLog(state, '戲法舞步：選擇「否」 — 不改附對手能量', aIdx);
    // v5.555 免疫 gate：硬岩【鬥】/薄霧/純樸/化隱… 免疫對手招式效果 → 不可搬能量
    const _imm = isOppActiveImmuneToAttackEffect(state, aIdx, pool);
    if (_imm.blocked) return addLog(state, `戲法舞步：${_imm.reason}（對手戰鬥寶可夢不受招式效果影響）`, aIdx);
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (!opp.active || opp.active.energyAttached.length === 0) {
      return addLog(state, '戲法舞步：對手戰鬥寶可夢沒有附能量', aIdx);
    }
    if (opp.bench.length === 0) {
      return addLog(state, '戲法舞步：對手備戰區沒有寶可夢，無法移動能量', aIdx);
    }
    // 選對手戰鬥能量（active-energy-discard picker；validIids 限對手 active 能量）
    return withPending(state, {
      type: 'active-energy-discard',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'trick-step-pick',
      params: {
        scope: 'all-opp',
        // ⚠ 不可傳 targetIid：前端 all-opp 分支會 `if (pk.iid === targetIid) continue` 跳過該寶可夢能量。
        //   戲法舞步要選的正是對手戰鬥位(active)能量，若把 active 設 targetIid → 能量全被跳過→選不到(v5.718)。
        validIids: opp.active.energyAttached.map(e => e.iid),
        titleOverride: '戲法舞步：選擇要移動的對手戰鬥能量',
      },
    });
  };
}
regPost('耿鬼ex|戲法舞步', trickStepPost());
regR('trick-step-pick', (st, idx, iids, _params, pool) => {
  // v5.717 修復：pick 階段「不移除」能量（原 trick-step-energy 先移除 → attach 階段找不到 → 能量消失）。
  //   只確認能量仍在對手 active 上，開 bench-choose 選對手備戰目標；實際移動延到 attach 一步完成。
  const energyIid = iids[0];
  if (!energyIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  const energyInst = opp.active?.energyAttached.find(e => e.iid === energyIid);
  if (!energyInst) return st;
  if (opp.bench.length === 0) return st;
  const oppActiveName = pool.get(opp.active!.cardId)?.name ?? '?';
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  return withPending(
    addLog(st, `戲法舞步：選擇 ${oppActiveName} 的 ${eName} 要移至的對手備戰寶可夢`, idx),
    {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'trick-step-attach',
      params: {
        validIids: opp.bench.map(c => c.iid),
        titleOverride: '戲法舞步：選擇能量要移至的備戰寶可夢',
        energyIid,
      },
    },
  );
});
regR('trick-step-attach', (st, idx, iids, params, pool) => {
  // v5.717：energyInst 從「仍持有能量的對手 active」取得（pick 階段未移除）→ 一步：從 active 移除 + 附到備戰。
  const benchTargetIid = iids[0];
  const energyIid = (params?.energyIid as string | undefined) ?? '';
  if (!benchTargetIid || !energyIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  const energyInst = opp.active?.energyAttached.find(e => e.iid === energyIid);
  if (!energyInst) return st;
  const benchTarget = opp.bench.find(c => c.iid === benchTargetIid);
  if (!benchTarget) return st;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const targetName = pool.get(benchTarget.cardId)?.name ?? '?';
  const newActive = {
    ...opp.active!,
    energyAttached: opp.active!.energyAttached.filter(e => e.iid !== energyIid),
  };
  const newBench = opp.bench.map(c =>
    c.iid === benchTargetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyInst] }
      : c,
  );
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...opp, active: newActive, bench: newBench };
  return addLog({ ...st, players },
    `戲法舞步：${eName} 從戰鬥場移至 ${targetName} 的備戰`, idx);
});

// 來悲粗茶ex SV5a 009/066｜熬返
// 費用：[無] / 無直接傷害
// 效果：「在給對手看過自己的棄牌區的所有『基本【草】能量』卡後，
//        將與其張數×2個的相同數量的傷害指示物，放置於對手的1隻寶可夢身上。
//        然後，將給對手看過的能量卡放回牌庫並重洗。」
regPost('來悲粗茶ex|熬返', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  // 找出棄牌區所有基本草能量
  const grassEnergies = p.discard.filter(e => {
    const card = pool.get(e.cardId);
    if (!card) return false;
    if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    // 草屬性：pokemonType === 'Grass' 或 name 含【草】
    return card.pokemonType === 'Grass' || /【草】/.test(card.name);
  });
  if (grassEnergies.length === 0) {
    return addLog(state, '熬返：棄牌區沒有基本草能量', aIdx);
  }
  const names = grassEnergies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  // 先記公開 log（雙方都看到有草能量，但不揭露準確張數細節）
  let s = addLog(state, `熬返：展示棄牌區草能量（${grassEnergies.length} 張）— ${names}`, aIdx);
  // 讓對手確認（給對手看過）— 這裡用 addPrivateLog 讓對手也看到
  const dIdx = (1 - aIdx) as 0 | 1;
  s = addPrivateLog(s, `對手來悲粗茶ex的熬返展示了：${names}`, `熬返：展示${grassEnergies.length}張基本草能量`, dIdx);
  // 讓攻擊方選擇對手哪隻寶可夢
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'brew-back-target',
    params: {
      includeActive: true,
      grassCount: grassEnergies.length,
      grassEnergyIids: grassEnergies.map(e => e.iid),
    },
  });
});
regR('brew-back-target', (st, idx, iids, params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  const grassCount = (params?.grassCount as number) ?? 0;
  const grassEnergyIids = (params?.grassEnergyIids as string[] | undefined) ?? [];
  if (!targetIid || grassCount === 0) return st;

  const dmg = grassCount * 20; // 每張草能量 = 2 個傷害指示物 = 20 傷害
  const opp = st.players[dIdx];
  const isActive = opp.active?.iid === targetIid;
  const benchIdx = opp.bench.findIndex(c => c.iid === targetIid);

  let updatedActive = opp.active;
  let updatedBench = opp.bench;
  let targetName = '?';

  // v2.89 規則修正：熬返 = 招式效果（無招式傷害值），須檢查 defender 的招式效果免疫
  const target = isActive ? opp.active : (benchIdx >= 0 ? opp.bench[benchIdx] : null);
  if (!target) return st;
  const targetCardCheck = pool.get(target.cardId);
  const guard = canApplyAttackEffectToTarget(st, idx, target, targetCardCheck, pool);
  if (guard.blocked) {
    return addLog(st, `熬返：${targetCardCheck?.name ?? '?'} ${guard.reason}（不放傷害指示物）`, idx);
  }

  if (isActive && opp.active) {
    updatedActive = { ...opp.active, damage: opp.active.damage + dmg };
    targetName = pool.get(opp.active.cardId)?.name ?? '?';
  } else if (benchIdx >= 0) {
    updatedBench = opp.bench.map((c, i) =>
      i === benchIdx ? { ...c, damage: c.damage + dmg } : c
    );
    targetName = pool.get(opp.bench[benchIdx].cardId)?.name ?? '?';
  } else {
    return st;
  }

  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...opp, active: updatedActive, bench: updatedBench };

  // 將那些草能量從棄牌區移到牌庫頂並重洗
  const p = st.players[idx];
  const toReturn = p.discard.filter(e => grassEnergyIids.includes(e.iid));
  const remainingDiscard = p.discard.filter(e => !grassEnergyIids.includes(e.iid));
  const newDeck = shuffle([...p.deck, ...toReturn]);
  players[idx] = { ...p, discard: remainingDiscard, deck: newDeck };

  let s = addLog({ ...st, players },
    `熬返：${targetName} 受到 ${dmg} 傷害（${grassCount} 張草能量 × 2），${grassCount} 張草能量回牌庫`, idx);
  return addPrivateLog(s, `你的來悲粗茶熬返將 ${toReturn.map(e => pool.get(e.cardId)?.name ?? '?').join('、')} 回牌庫`, '', dIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// J 標 Batch A1 — M3 簡單招式效果（來源：static/cards/M3.json）
// ══════════════════════════════════════════════════════════════════════════════

// 圓絲蛛｜緊纏之絲：10；在下個對手的回合，受到這個招式的寶可夢無法撤退。
regPost('圓絲蛛|緊纏之絲', defCantRetreatNextPost());

// 阿利多斯｜毒陣：50；中毒 + 下個對手回合無法撤退。
regPost('阿利多斯|毒陣', (state, aIdx, pool) => {
  const s1 = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// 君主蛇｜皇家指令：自己的場上寶可夢數量 × 20。
regPre('君主蛇|皇家指令', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const count = (p.active ? 1 : 0) + p.bench.length;
  return { state, damage: count * 20 };
});

// 彩粉蝶｜穿堂風：60；若場上有競技場卡，+60。
regPre('彩粉蝶|穿堂風', (state, aIdx, _pool) => {
  const bonus = state.activeStadium ? 60 : 0;
  const s = bonus > 0 ? addLog(state, '穿堂風：場上有競技場卡 → +60 傷害', aIdx) : state;
  return { state: s, damage: 60 + bonus };
});

// 爆焰龜獸｜高溫吐息：80；擲1次硬幣若為正面，+80。
regPre('爆焰龜獸|高溫吐息', coinPlusPre(80, 80, '高溫吐息'));

// 小貓怪｜雙重抓：擲2次硬幣，正面數 × 10。
regPre('小貓怪|雙重抓', coinHeadsMultiplyPre(2, 10, '雙重抓'));

// 妙喵｜小憩：將這隻寶可夢恢復 20 HP。
regPost('妙喵|小憩', selfHealPost(20, '小憩'));

// 芳香精｜吸取之吻：50；將這隻寶可夢恢復 30 HP。
regPost('芳香精|吸取之吻', selfHealPost(30, '吸取之吻'));

// ══════════════════════════════════════════════════════════════════════════════
// J 標 Batch A2 — M3 變動傷害簡單招式（來源：static/cards/M3.json）
// ══════════════════════════════════════════════════════════════════════════════

function attachedEnergyNameIncludes(inst: CardInstance | null | undefined, pool: Map<string, Card>, typeLabel: string): number {
  if (!inst) return 0;
  let count = 0;
  for (const e of inst.energyAttached) {
    const ec = pool.get(e.cardId);
    if (ec?.name?.includes(`【${typeLabel}】`)) count++;
  }
  return count;
}

// 波爾凱尼恩｜強力蒸汽：擲與身上【水】能量數相同次數硬幣，正面數 × 90。
regPre('波爾凱尼恩|強力蒸汽', (state, aIdx, pool) => {
  // v5.688：改用中央 countEnergyTypeHostAware — 「擲與【水】能量數相同次數」應認列古舊/稜鏡等視為水的特殊能量。
  const _act = state.players[aIdx].active;
  const waterCount = _act ? countEnergyTypeHostAware(_act, 'Water', pool) : 0;
  const r = flipCoinsWithLog(state, waterCount, '強力蒸汽', aIdx);
  const damage = r.heads * 90;
  return { state: addLog(r.state, `強力蒸汽：${r.heads}/${waterCount} 次正面 → ${damage} 傷害`, aIdx), damage };
});

// 倫琴貓｜猛力進攻：自己已獲得獎賞卡張數 × 70。
regPre('倫琴貓|猛力進攻', (state, aIdx, _pool) => {
  const taken = Math.max(0, 6 - state.players[aIdx].prizes.length);
  const damage = taken * 70;
  // v3.03：breakdown 顯示「已取獎賞 N×70」
  if (taken > 0) {
    return { state, damage, breakdown: [{ value: damage, label: `已取獎賞 ${taken}×70` }] };
  }
  return { state, damage };
});

// 寶寶暴龍｜勃然大怒：自身傷害指示物數量 × 20。
regPre('寶寶暴龍|勃然大怒', (state, aIdx, _pool) => {
  const counters = Math.floor((state.players[aIdx].active?.damage ?? 0) / 10);
  const damage = counters * 20;
  // v3.03：breakdown 顯示「自身指示物 N×20」
  if (counters > 0) {
    return { state, damage, breakdown: [{ value: damage, label: `自身指示物 ${counters}×20` }] };
  }
  return { state, damage };
});

// 摔角鷹人｜復仇踢：若自己的備戰寶可夢身上有傷害指示物，+60。
regPre('摔角鷹人|復仇踢', (state, aIdx, _pool) => {
  const hasDamagedBench = state.players[aIdx].bench.some(c => c.damage > 0);
  return { state, damage: 30 + (hasDamagedBench ? 60 : 0) };
});

// 耿鬼｜意志劫持：10 + 對手備戰寶可夢數量 × 30。
regPre('耿鬼|意志劫持', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return { state, damage: 10 + state.players[dIdx].bench.length * 30 };
});

// 古劍豹｜上升利刃：若對手戰鬥寶可夢為 ex，+80。
regPre('古劍豹|上升利刃', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defCard = state.players[dIdx].active ? pool.get(state.players[dIdx].active!.cardId) : undefined;
  return { state, damage: 80 + (isExCard(defCard) ? 80 : 0) };
});

// ══════════════════════════════════════════════════════════════════════════════
// J 標 Batch A3 — M4/MC 簡單招式效果（來源：static/cards/M4.json、MC.json）
// ══════════════════════════════════════════════════════════════════════════════

// 雷丘｜快速攻擊：20；擲1次硬幣若正面，+50。
regPre('雷丘|快速攻擊', coinPlusPre(20, 50, '快速攻擊'));

// 密勒頓ex｜強子電光：120；若對手戰鬥寶可夢為 ex，+120。
regPre('密勒頓ex|強子電光', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defCard = state.players[dIdx].active ? pool.get(state.players[dIdx].active!.cardId) : undefined;
  return { state, damage: 120 + (isExCard(defCard) ? 120 : 0) };
});

// 布里卡隆｜圍困：160；下個對手回合，受到招式的寶可夢無法撤退。
regPost('布里卡隆|圍困', defCantRetreatNextPost());

// 超級火炎獅ex｜大爆炸之火：290 - 自身傷害指示物數量×10。
// v3.03：breakdown 顯示「290(基礎) - 自身指示物 N×10」（如有自殘）
regPre('超級火炎獅ex|大爆炸之火', (state, aIdx, _pool) => {
  const counters = Math.floor((state.players[aIdx].active?.damage ?? 0) / 10);
  const damage = Math.max(0, 290 - counters * 10);
  if (counters > 0) {
    // 自損部分用負值 + 加法表達（注意：此處先在 breakdown 裡轉成「基礎」單一項已減過，
    // 因 FormulaTerm 限定 base 為 = 號；採用簡化形式 — 顯示一個 base = damage、label
    // 描述如「290 - 指示物 N×10」即可，避免大改 schema 引入 - sign breakdown）。
    return {
      state,
      damage,
      breakdown: [{ value: damage, label: `290 - 自身指示物 ${counters}×10` }],
    };
  }
  return { state, damage };
});

// 天秤偶｜連續旋轉：擲硬幣直到反面，正面數×30。
regPre('天秤偶|連續旋轉', coinUntilTailsMultiplyPre(30, 0, '連續旋轉'));

// 堅果啞鈴｜特殊鞭打：70；若自身附有特殊能量，+70。
// v3.03：breakdown 拆「70(基礎) + 70(特殊能量)」
regPre('堅果啞鈴|特殊鞭打', (state, aIdx, pool) => {
  const active = state.players[aIdx].active;
  const hasSpecial = !!active?.energyAttached.some(e => pool.get(e.cardId)?.subtype === 'Special');
  if (hasSpecial) {
    return {
      state,
      damage: 140,
      breakdown: [
        { value: 70, label: '基礎' },
        { value: 70, label: '特殊能量' },
      ],
    };
  }
  return { state, damage: 70 };
});

// v2.9991 hotfix: 此檔案需在 PASSIVE_ATTACK_BONUS Map 宣告之後 import
//   原本放在頂端 (L362) 會因 ESM 模組載入順序在 Map.set() 時拋 TypeError
//   (PASSIVE_ATTACK_BONUS = undefined)。移到末尾確保 Map 已初始化。
// v2.9992 hotfix: 從 v2999_g3_wave1 拿 register 函式（不再依賴 module top-level .set()）
import { registerV2999G3W1Passives } from './effects/cards/v2999_g3_wave1';
// 在 effects.ts 自己 body 末端呼叫，確保 PASSIVE_ATTACK_BONUS 已初始化
registerV2999G3W1Passives();

// v3.0 Group 3 Wave 2 — 10 張對手互動 / 特殊機制 passive 特性
// 同 v2.9992 lazy register pattern：register 函式內目前無 .set() 需要做，
//   但保留模板以利未來擴充；幾個 helper 由 engine.ts 直接 import 使用。
// hasBugAegislashShield 已在頂部 import 給 resolveBenchGuard 用。
import { registerV3000G3W2Passives } from './effects/cards/v3000_g3_wave2';
registerV3000G3W2Passives();

// v3.01 Group 3 Wave 3 — 14 張最複雜 passive（多需新 hook）
// 同 lazy register pattern：本波無對 effects.ts 內 Map 的 .set() 需要做，
//   但保留模板以利未來擴充。helpers 全部由 engine.ts 直接 import 使用。
// 對手不能使出 X / 對手特性消除 / 寶可夢檢查指示物 / 撤退觸發 / 進化觸發 等 hook 全部 inline 在 engine.ts。
import { registerV3001G3W3Passives, isAbilityNullifiedByPassive, isAbilityHolderEffective, isInitializeNullified } from './effects/cards/v3001_g3_wave3';
registerV3001G3W3Passives();

// v3.05 Deferred Wave A — 5 張需新 hook 特性卡（Phase 1 兩張本波實裝）
//   - 海豚俠｜全能變身 + 鋼炮臂蝦｜返回重載 走新 hook ON_RETREAT_TO_BENCH（撤退路徑）
//   - 超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉、齒輪怪｜緊急迴轉 仍 deferred（待手牌觸發 hook 補）
import { registerV3050DeferredWaveA } from './effects/cards/v3050_deferred_wave_a';
registerV3050DeferredWaveA();

// v3.06 Deferred Wave B — 5 張免疫類 passive 特性
//   - 藏隱 / 深度下潛：在 resolveBenchGuard / hitBenchAll inline 處理（self-ability gate）
//   - 緊張感 / 融合為雪：對手 trainer resolver 內呼叫 isImmuneToOppTrainer 過濾候選
//   - 全能硬殼：PASSIVE_IMMUNITY entry + ATTACK_EFFECT_IMMUNITY entry（special-case）
import { registerV3060DeferredWaveBPassives } from './effects/cards/v3060_deferred_wave_b';
registerV3060DeferredWaveBPassives();

// v3.07 Deferred Wave D — 3 張需要手牌 UI 元件層 hook 的特性
//   - 超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉 走 ON_DISCARD_FROM_HAND（玩家手牌主動丟卡觸發）
//   - 齒輪怪｜緊急迴轉 走 ON_HAND_ACTIVATE（手牌寶可夢自身觸發放上備戰）
// effect fn 由前文 import 後直接寫入 Map literal；register 函式留空（無 .set() 需要 lazy）。
import { registerV3070DeferredWaveD } from './effects/cards/v3070_deferred_wave_d';
registerV3070DeferredWaveD();

// v3.08 Deferred Wave C — Group 3 剩餘 4 張最複雜 deferred passive
//   - 超甲狂犀｜廣域堡壘：擴展 isImmuneToOppTrainer 路徑（新 helper isImmuneToOppSupporter 含廣域堡壘）
//     已在 supporters_gust.ts / v168_supporters.ts 的 老大的指令 系列 改用新 helper
//   - 美納斯｜平穩境地：oppHasMenasureCalmGround helper，已在 effects.ts (returnOppActiveEnergyPost)
//     / items_misc.ts (悠哉尾草棒) / v2354 (退化光線) / v2760 (奧密之眼) / v2996 (原始之翼/微風吹拂) inline gate
//   - 古空棘魚｜潛入記憶：engine.ts getEffectiveAttacks 擴展加 evolvedFromStack 招式
//   - [v3.20 IMPLEMENTED] 洛托姆ex｜多重轉接：CardInstance.extraTools array 重構（已實裝）
// register 函式為空 body，僅維持 wave 模板一致；所有 hook 都是 helper 直接 import 使用，無 Map .set()。
import { registerV3080DeferredWaveC } from './effects/cards/v3080_deferred_wave_c';
registerV3080DeferredWaveC();

// v3.21 奧爾迪加 (Supporter, G) + 化石卡完整補漏
//   - 奧爾迪加：借 hand-choose + modal-choice 兩階段 pendingSelection，透過 actorIdx
//     切換達成「對手 yes/no」機制（UI 已原生支援）
//   - 化石補漏在本 effects.ts inline 改完（resolveBenchGuard 羽毛 / canApplyAttackEffectToTarget 背蓋）
//   - 鰭之化石整合進 v3080_deferred_wave_c.ts 的 isImmuneToOppSupporter（單獨 patch）
import { registerV3210Ordiga } from './effects/cards/v3210_ordiga';
import { applyMagearnaHandAttachHeal as _magHeal } from './effects/cards/v3000_g3_wave2';
registerV3210Ordiga();

// ============================================================================
// v5.063 — 「若希望」binary-yes-no prompt 集中註冊（32 個招式）
// ============================================================================

ATTACK_PRE_DISCARD_CHOICE.set('狐大盜|貪慾狩獵', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 40, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('夢妖魔ex|六之魔法', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 150, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('竹蘭的烈咬陸鯊ex|螺旋俯衝', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('代歐奇希斯|精神高速', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 30, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 5 張為止？',
  choiceYesLabel: '是（抽到 5）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('霓虹魚|報恩', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 20, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('幸福蛋ex|報恩', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 180, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('差不多娃娃|報恩', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 30, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('摩托蜥ex|鋯石之路', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否從自己的牌庫抽出 5 張卡？',
  choiceYesLabel: '是（抽 5）',
  choiceNoLabel: '否（跳過抽牌）',
});

ATTACK_PRE_DISCARD_CHOICE.set('超級拉帝亞斯ex|狡兔三窟', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 40, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與備戰寶可夢互換？',
  choiceYesLabel: '是（換到備戰）',
  choiceNoLabel: '否（留在戰鬥位）',
});

ATTACK_PRE_DISCARD_CHOICE.set('古劍豹|狡兔三窟', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 20, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與備戰寶可夢互換？',
  choiceYesLabel: '是（換到備戰）',
  choiceNoLabel: '否（留在戰鬥位）',
});

ATTACK_PRE_DISCARD_CHOICE.set('沙漠蜻蜓ex|風暴返', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 130, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與備戰寶可夢互換？',
  choiceYesLabel: '是（換到備戰）',
  choiceNoLabel: '否（留在戰鬥位）',
});

ATTACK_PRE_DISCARD_CHOICE.set('音波龍ex|狡兔三窟', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 50, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與備戰寶可夢互換？',
  choiceYesLabel: '是（換到備戰）',
  choiceNoLabel: '否（留在戰鬥位）',
});

ATTACK_PRE_DISCARD_CHOICE.set('蓋歐卡ex|蜿蜒浪', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 80, damagePerEnergy: 0,
  choicePrompt: '是否將對手的戰鬥寶可夢與備戰寶可夢互換？（由對手選擇放置於戰鬥場的寶可夢）',
  choiceYesLabel: '是（強制換對手）',
  choiceNoLabel: '否（不換對手）',
});

ATTACK_PRE_DISCARD_CHOICE.set('毛辮羊|搗碎', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 30, damagePerEnergy: 0,
  choicePrompt: '是否將場上的競技場卡丟棄？',
  choiceYesLabel: '是（丟棄競技場）',
  choiceNoLabel: '否（保留競技場）',
});

ATTACK_PRE_DISCARD_CHOICE.set('毛毛角羊|搗碎', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 70, damagePerEnergy: 0,
  choicePrompt: '是否將場上的競技場卡丟棄？',
  choiceYesLabel: '是（丟棄競技場）',
  choiceNoLabel: '否（保留競技場）',
});

ATTACK_PRE_DISCARD_CHOICE.set('超能妙喵|戲法舞步', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 80, damagePerEnergy: 0,
  choicePrompt: '是否選擇 1 個對手戰鬥寶可夢身上附加的能量，改附於對手的備戰寶可夢身上？',
  choiceYesLabel: '是（改附對手能量）',
  choiceNoLabel: '否（不改附）',
});

ATTACK_PRE_DISCARD_CHOICE.set('耿鬼ex|戲法舞步', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 160, damagePerEnergy: 0,
  choicePrompt: '是否選擇 1 個對手戰鬥寶可夢身上附加的能量，改附於對手的備戰寶可夢身上？',
  choiceYesLabel: '是（改附對手能量）',
  choiceNoLabel: '否（不改附）',
});

ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的閃電鳥|阻礙之翼', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 30, damagePerEnergy: 0,
  choicePrompt: '是否選擇 1 個對手戰鬥寶可夢身上附加的能量，改附於對手的備戰寶可夢身上？',
  choiceYesLabel: '是（改附對手能量）',
  choiceNoLabel: '否（不改附）',
});

ATTACK_PRE_DISCARD_CHOICE.set('高傲雉雞|反轉之風', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 70, damagePerEnergy: 0,
  choicePrompt: '是否選擇 2 個對手戰鬥寶可夢身上附加的能量，放回對手的手牌？',
  choiceYesLabel: '是（放回 2 顆能量）',
  choiceNoLabel: '否（不放回）',
});

ATTACK_PRE_DISCARD_CHOICE.set('帕底亞 肯泰羅|上搗角擊', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 30, damagePerEnergy: 0,
  choicePrompt: '是否選擇 2 個對手戰鬥場的【2階進化】寶可夢身上附加的能量，放回對手的手牌？',
  choiceYesLabel: '是（放回 2 顆能量）',
  choiceNoLabel: '否（不放回）',
});

ATTACK_PRE_DISCARD_CHOICE.set('章魚桶|水流清洗', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 20, damagePerEnergy: 0,
  choicePrompt: '是否選擇 1 個對手戰鬥寶可夢身上附加的能量，放回對手的手牌？',
  choiceYesLabel: '是（放回 1 顆能量）',
  choiceNoLabel: '否（不放回）',
});

ATTACK_PRE_DISCARD_CHOICE.set('呆呆王|付諸東流', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 70, damagePerEnergy: 0,
  choicePrompt: '是否選擇 2 個對手戰鬥寶可夢身上附加的能量，放回對手的手牌？',
  choiceYesLabel: '是（放回 2 顆能量）',
  choiceNoLabel: '否（不放回）',
});

ATTACK_PRE_DISCARD_CHOICE.set('詛咒娃娃|玩偶捕捉', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否從自己的牌庫選擇 1 張任意卡加入手牌？（然後重洗牌庫）',
  choiceYesLabel: '是（搜 1 張）',
  choiceNoLabel: '否（跳過搜尋）',
});

ATTACK_PRE_DISCARD_CHOICE.set('君主蛇ex|青草命令', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 150, damagePerEnergy: 0,
  choicePrompt: '是否從自己的牌庫任意選擇最多 3 張卡加入手牌？（並且重洗牌庫）',
  choiceYesLabel: '是（搜 ≤3 張）',
  choiceNoLabel: '否（跳過搜尋）',
});

ATTACK_PRE_DISCARD_CHOICE.set('甲賀忍蛙ex|忍之利刃', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 170, damagePerEnergy: 0,
  choicePrompt: '是否從自己的牌庫任意選擇 1 張卡加入手牌？（並且重洗牌庫）',
  choiceYesLabel: '是（搜 1 張）',
  choiceNoLabel: '否（跳過搜尋）',
});

ATTACK_PRE_DISCARD_CHOICE.set('貓頭夜鷹|鉤爪搜尋', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否從自己的牌庫任意選擇最多 2 張卡加入手牌？（並且重洗牌庫）',
  choiceYesLabel: '是（搜 ≤2 張）',
  choiceNoLabel: '否（跳過搜尋）',
});

ATTACK_PRE_DISCARD_CHOICE.set('信使鳥|幸福禮物', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否雙方各從手牌選擇最多 3 張基本能量卡附給自己的寶可夢？（對手先選）',
  choiceYesLabel: '是（執行禮物交換）',
  choiceNoLabel: '否（跳過）',
});

ATTACK_PRE_DISCARD_CHOICE.set('賽富豪|賽富迴旋', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 100, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與附加的卡全部放回自己的牌庫並重洗？',
  choiceYesLabel: '是（自身回牌庫）',
  choiceNoLabel: '否（留在戰鬥位）',
});

ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的貓老大ex|高傲指令', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否選擇對手牌庫上方 10 張其中 1 個寶可夢持有的招式，作為這個招式使用？',
  choiceYesLabel: '是（複製招式）',
  choiceNoLabel: '否（跳過複製）',
});

// v5.464：櫻花魚|漸強波 改走 regPost hand-choose picker（見 v2610_i_wave11_misc4.ts），移除 binary-yes-no pre-choice。

ATTACK_PRE_DISCARD_CHOICE.set('魔牆人偶|相仿秀', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否查看對手手牌並選擇 1 張支援者卡，將其效果作為這個招式使用？',
  choiceYesLabel: '是（複製對手手牌支援者）',
  choiceNoLabel: '否（跳過）',
});

// v5.681：好啦魷|惡作劇觸手 改用 modal-choice（先揭示對手牌庫頂再決定重洗），不再借殼 binary-yes-no。
