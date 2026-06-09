/**
 * effects 模組共用基礎設施
 *
 * 這個檔案不含任何具體卡牌實裝，只提供：
 *   - EffectFn / ResolveFn / TrainerGuardFn 型別
 *   - TRAINER_EFFECTS / RESOLVERS / TRAINER_GUARDS 登錄表（Map 實例）
 *   - reg / regR / regG 登錄函式
 *   - 純粹的 state 工具函式（shuffle / updatePlayer / addLog …）
 *   - canPlayTrainer 閘門檢查
 *
 * effects.ts 與 effects/cards/*.ts 都從這裡 import，保證所有 reg() 寫到同一個
 * Map 實例。engine.ts 透過 effects.ts 的 re-export 取用同一個 Map 實例。
 *
 * v2.05 (Session 38b2)：從 effects.ts 抽離，作為模組化第一步骨架。
 */

import type { Card } from '$lib/cards/types';
import type {
  GameState, PlayerState, CardInstance, PendingSelection, GameAction,
  SpecialCondition,
} from '../types';

// ══════════════════════════════════════════════════════════════════════════════
// 型別
// ══════════════════════════════════════════════════════════════════════════════

/** 即時或觸發 pendingSelection 的效果函式 */
export type EffectFn = (
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>,
  cardInst?: CardInstance
) => GameState;

/** 玩家做完選擇後的繼續處理 */
export type ResolveFn = (
  state: GameState,
  actorIdx: 0 | 1,
  selectedIids: string[],
  params: Record<string, unknown> | undefined,
  pool: Map<string, Card>
) => GameState;

/** cardName → 可否打出此訓練家卡的前置檢查 */
export type TrainerGuardFn = (
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>
) => boolean;

// ══════════════════════════════════════════════════════════════════════════════
// 登錄表（Map 實例；所有效果檔共享同一個實例）
// ══════════════════════════════════════════════════════════════════════════════

/** cardName（完全符合）→ 效果函式 */
export const TRAINER_EFFECTS = new Map<string, EffectFn>();

/** effectKey → resolver 函式 */
export const RESOLVERS = new Map<string, ResolveFn>();

/**
 * cardName → 可否打出此訓練家卡的前置檢查。
 * 返回 true 表示可打；false 表示缺少合法目標（例如夜間擔架棄牌區為空）。
 * 未註冊 guard 的卡片預設為可打出（保持向後相容）。
 */
export const TRAINER_GUARDS = new Map<string, TrainerGuardFn>();

// ══════════════════════════════════════════════════════════════════════════════
// 登錄函式
// ══════════════════════════════════════════════════════════════════════════════

export function reg(name: string, fn: EffectFn) {
  TRAINER_EFFECTS.set(name, fn);
}

export function regR(key: string, fn: ResolveFn) {
  RESOLVERS.set(key, fn);
}

export function regG(name: string, fn: TrainerGuardFn) {
  TRAINER_GUARDS.set(name, fn);
}

// ══════════════════════════════════════════════════════════════════════════════
// 攻擊 / 特性 型別 + 登錄表 + helper（v2.64 從 effects.ts 搬到這裡）
//
// 搬遷動機：子模組（effects/cards/*.ts）需要能註冊攻擊 PRE / POST 與特性。
// 過去 regPre / regPost / regA 是 effects.ts 內部 function，無法 import，
// 導致 Wave/ 預組專屬卡無法抽到子模組。搬到 _shared 後 ATTACK_PRE / POST /
// ABILITY_EFFECTS 變成「唯一 Map 實例」，effects.ts 仍然 re-export 維持
// engine.ts / +page.svelte 既有 import 路徑不變。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_PRE：招式宣告後、傷害計算前的效果。
 * 接收現在 state 與攻擊方索引，回傳 { state, damage }（damage 為本次招式實際傷害）。
 *
 * ATTACK_POST：傷害施加（含擊倒判定）後的效果。
 * 可觸發 pendingSelection 讓玩家做額外選擇；回傳新 state。
 */
export type AttackPreFn = (
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  action?: Extract<GameAction, { type: 'ATTACK' }>
) => {
  state: GameState;
  damage: number;
  /** 招式傷害不計算弱點・抵抗力（Session 33）。 */
  skipWeakRes?: boolean;
  /**
   * v4.495：招式傷害不計算「抵抗力」（不影響弱點計算）。
   * 卡面寫「這個招式的傷害不計算抵抗力。」（岩石投擲 / 巨岩墜落 / 粗暴橫掃 / 衝天粉碎 等）。
   * 與 skipWeakRes 不同 — skipWeakRes 同時跳弱點和抵抗力。
   */
  skipResistance?: boolean;
  /**
   * v4.495：招式傷害不計算「弱點」（不影響抵抗力計算）。
   * 卡面寫「這個招式的傷害不計算弱點。」（竹蘭的花岩怪 激怒咒詛 等）。
   */
  skipWeakness?: boolean;
  /**
   * 招式傷害不計算對手戰鬥寶可夢身上的「附加效果」（Session 33）。
   * 包含被動減傷特性、防禦道具（福祿果等）、下次被攻擊 -N、條件式完全免疫。
   */
  skipDefEffects?: boolean;
  /**
   * v3.03 傷害公式拆解 — 若招式內部做了多步加法（如赫月 ex 瘋狂啃咬
   * 7×30 + 100），可回傳 breakdown 讓 ATTACK handler 把 base 拆成多個 + term，
   * UI 顯示「[210(指示物 ×30) +100(基礎) +30(腰帶)] ×2(弱點) = 680」更直覺。
   *
   * 規則：breakdown 各項 value 加總應等於 damage（否則以 damage 為主）；
   *       第一項當基礎 = term，其餘為 + term。空陣列 / undefined 維持舊行為。
   */
  breakdown?: { value: number; label: string }[];
};

/**
 * v2.156：第 4 個參數 action 為可選（保持向後相容）— 讓 POST 也能讀 ATTACK action 上
 * 玩家做的選擇（如 discardedEnergyIids），用於「PRE/POST 共享 chosenIids」的招式。
 *
 * 使用範例：激流水泵（option 招式）— 玩家在 PRE 階段挑選棄能量，POST 階段需要根據
 * 玩家是否棄了 ≥3 個能量決定要不要觸發「對手備戰受 120」picker。
 */
export type AttackPostFn = (
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  action?: Extract<GameAction, { type: 'ATTACK' }>
) => GameState;

export const ATTACK_PRE  = new Map<string, AttackPreFn>();
export const ATTACK_POST = new Map<string, AttackPostFn>();

export function regPre(key: string, fn: AttackPreFn)   { ATTACK_PRE.set(key, fn); }
export function regPost(key: string, fn: AttackPostFn) { ATTACK_POST.set(key, fn); }

/**
 * 招式宣告時需要玩家選擇丟棄能量的宣告表。見 effects.ts 原註解說明。
 */
export interface PreDiscardSpec {
  min: number;
  max: number | null; // null = 不限上限（全部）
  /**
   * v2.143：scope 擴展支援手牌棄牌
   * - 'attacker' / 'any-own' / 'own-bench'：丟自身能量（原有）
   * - 'hand-rocket-supporter'：丟手牌中的「火箭隊」支援者（火箭羽毛）
   * - 'hand-tool'（v2.254）：丟手牌中的「寶可夢道具」（灰塵山|丟棄）
   * - 'binary-yes-no'（v2.255）：純 yes/no 選擇（蚊香泳士|跳躍衝天 等「若希望」招式）
   *   UI 顯示 yes/no 兩按鈕 overlay 而非能量列表；regPre 看 action.discardedEnergyIids 長度判斷：
   *   length=0 → no；length>=1 → yes（sentinel iid，不真的丟東西）
   * - 'self-counter-stepper'（v2.256）：玩家用 +/- 按鈕選 0~max 整數值（波盪水|蜿蜒割裂）
   *   UI 顯示 stepper overlay；regPre 看 action.discardedEnergyIids.length = 玩家選的 N。
   *   spec.min / spec.max 作為下/上限。spec.damagePerEnergy = 每個 counter 加的傷害。
   */
  scope: 'attacker' | 'any-own' | 'own-bench' | 'hand-rocket-supporter' | 'hand-tool' | 'hand-energy' | 'binary-yes-no' | 'self-counter-stepper';
  /**
   * v2.255：scope='binary-yes-no' / 'self-counter-stepper' 時的提示文字。
   *   choicePrompt：modal 主問句（例：「是否將自身回牌庫，增加 80 點傷害？」）
   *   choiceYesLabel / choiceNoLabel：yes/no 按鈕文字（預設「是」/「否」）。
   */
  choicePrompt?: string;
  choiceYesLabel?: string;
  choiceNoLabel?: string;
  /**
   * v2.256：scope='self-counter-stepper' 專用 — 每個 counter 對自身造成多少自傷（PRE 階段套用）。
   * 例：蜿蜒割裂 = 10（每個指示物 = 10 自傷）。
   */
  selfDamagePerCounter?: number;
  baseDamage: number;
  damagePerEnergy: number; // 對 hand-rocket-supporter 而言視為 damagePerCard
  /**
   * v2.129：min/max 的計數方式。
   * 'cards'（預設）：依玩家挑選的張數計算（過去行為）。
   * 'units'：依「能量單位數」累加 — 1 張燃火能量（附於進化）= 3 個無能量；
   *           1 張火箭隊能量 = 2 個。用於卡面寫「丟 N 個能量」的招式（如 分身連打）。
   * UI 比對 picked 累計 unit 數對 min/max；engine pre fn 透過 action.discardedEnergyIids
   * 仍照「卡張數」傳，需要 unit 倍率時自行解讀。
   */
  countMode?: 'cards' | 'units';
  /**
   * v3.48：picker UI 顯示用動詞。預設 'discard'（保留多數招式的「丟棄」語意）。
   * 對少數「放回手牌 / 放回牌庫」類招式（忍者飛旋 / 叢林鞭打 / 時間爆炸 / 激流水泵）
   * 設為對應 verb，UI 標題與按鈕會顯示「放回手牌」/「放回牌庫」而非誤導的「丟棄」。
   */
  verb?: 'discard' | 'return-to-hand' | 'return-to-deck';
  /**
   * v4.16：picker UI 限定的能量屬性（如忍者飛旋限【水】）。
   * 設此值後，picker 只顯示「視為該屬性」的能量：
   *   - 基本該屬性能量（pokemonType 或名稱含屬性）
   *   - 特殊該屬性能量（含名稱屬性）
   *   - 新衝天能量 (Stage2 host = 視為所有屬性)
   *   - 稜鏡能量 (Basic host = 視為所有屬性；Evolution host 不視為)
   * 不符的能量在 picker 內隱藏，避免玩家點選後被 regPre 退回。
   */
  energyTypeFilter?: 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic' | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon' | 'Colorless';
}

export const ATTACK_PRE_DISCARD_CHOICE = new Map<string, PreDiscardSpec>();

/**
 * v2.129：計算「丟棄這張能量卡」算幾個能量單位。
 * 鏡射 engine.ts canAffordAttack 內的特殊能量 unit 規則（但限縮為「discard 視角」）：
 * - 燃火能量 附於進化寶可夢（Stage1/Stage2）：3 個無能量；否則 1 個。
 * - 火箭隊能量：2 個（=2 顆無能量）。
 * - 稜鏡能量：1 個（卡面寫「視為 1 個所有屬性能量」— 屬性彈性，但只算 1 個）。
 * - 古舊能量 / 新衝天能量 / 其他特殊能量：1 個。
 * - 基本能量：1 個。
 * - 找不到卡：fallback 1 個。
 *
 * 用於 PreDiscardSpec.countMode='units' 的招式（如 分身連打）— UI 把玩家挑中的能量
 * 累加 unit 數對 spec.min/max 比對；不影響 engine 內 cost 匹配（後者已自有完整邏輯）。
 */
export function getEnergyDiscardUnits(
  energyCardId: string,
  hostInst: CardInstance | null,
  pool: Map<string, Card>,
  state?: GameState,
  ownerIdx?: 0 | 1,
): number {
  const ec = pool.get(energyCardId);
  if (!ec) return 1;
  if (ec.name === '燃火能量') {
    if (!hostInst) return 1;
    const hc = pool.get(hostInst.cardId);
    const stage = hc?.stage ?? hc?.subtype;
    return (stage === 'Stage1' || stage === 'Stage2') ? 3 : 1;
  }
  if (ec.name === '火箭隊能量') return 2;
  // v4.07：新衝天能量 — 卡面「若附於 2 階進化寶可夢身上，視為提供 2 個能量」
  //   玩家回報甲賀忍蛙ex（Stage2）分身連打需丟 2 能量時無法用 1 張新衝天能量。
  //   依卡面「個」= units 解讀，Stage2 host → 2 units，否則 1 unit。
  if (ec.name === '新衝天能量') {
    if (!hostInst) return 1;
    const hc = pool.get(hostInst.cardId);
    const stage = hc?.stage ?? hc?.subtype;
    return stage === 'Stage2' ? 2 : 1;
  }
  // v5.449：大竺葵｜繁茂 — ownerIdx 側場上有繁茂時，自己寶可夢身上附加的「基本【草】能量」
  //   視為 2 個（與撤退費 totalEnergyUnits / 攻擊費 canAffordAttack 的繁茂處理一致）。
  //   玩家報：繁茂在場時激流水泵等「選 N 個能量」picker，草能量沒被當 2 個。
  if (state != null && ownerIdx != null && ec.subtype === 'Basic' && energyMatchesType(ec, 'Grass')) {
    const owner = state.players[ownerIdx];
    const field = [...(owner.active ? [owner.active] : []), ...owner.bench];
    if (field.some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '繁茂'))) return 2;
  }
  return 1;
}

/**
 * v4.959：計「能量數」(units)，host-aware。
 *
 * 規則：
 *   - 一般能量卡：1 個
 *   - 新衝天能量 on Stage2 host：2 個（卡面「視為提供 2 個所有屬性的能量」）
 *   - 新衝天能量 on 非 Stage2 host：1 個
 *
 * 使用場合：招式 / 特性的「依能量數計傷害 / 擲幣次數 / 倍率效果」場合
 *   （中文卡面寫「能量」/「個」/「顆」按 unit 計）。
 *
 * 不適用：card-count 場合（如丟棄 N 張能量、撤退費用、條件 'energyAttached.length > 0'）。
 *
 * 火箭隊能量 / 燃火能量：暫時當 1 個算（屬性 / cost 規則，非 count override）。
 */
export function countAttachedEnergyAsUnits(host: CardInstance, pool: Map<string, Card>): number {
  const hostCard = pool.get(host.cardId);
  const hostStage = hostCard?.stage ?? hostCard?.subtype;
  const hostIsStage2 = hostStage === 'Stage2';
  let count = 0;
  for (const e of host.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec || ec.supertype !== 'Energy') continue;
    if (ec.name === '新衝天能量' && hostIsStage2) count += 2;
    else count += 1;
  }
  return count;
}

/** pokémonName|abilityIndex → 效果函式 */
export const ABILITY_EFFECTS = new Map<string, EffectFn>();
/**
 * v4.4995：ABILITY_EFFECTS_BY_NAME — 新註冊 map (key = `${cardName}|${abilityName}`)
 *   解決同名卡同 abilityIndex 但不同 abilityName 撞 key 的問題（叉字蝠 SV6a 怨影使者 vs M4 夜間工作 等 9 組）。
 *   現有 125 個 regA 註冊仍使用舊 ABILITY_EFFECTS (cardName|abIdx)，dispatch 點先查 by-name 再 fallback by-index。
 */
export const ABILITY_EFFECTS_BY_NAME = new Map<string, EffectFn>();

export function regA(pokemonName: string, abilityIndex: number, fn: EffectFn) {
  ABILITY_EFFECTS.set(`${pokemonName}|${abilityIndex}`, fn);
}

/**
 * v4.4995：依「卡名 + ability 名字」註冊特性實作（避免同名卡撞 key）。
 *   推薦新註冊都用此 helper；舊 regA 漸進遷移。
 */
export function regAByName(pokemonName: string, abilityName: string, fn: EffectFn) {
  ABILITY_EFFECTS_BY_NAME.set(`${pokemonName}|${abilityName}`, fn);
}

/**
 * v4.4995 統一查詢：先 by-name (新)，找不到 fallback by-index (舊)。
 *   - cardName / abilityName / abIdx 都要傳，by-name 失敗時 fallback by-index
 */
export function getAbilityFn(cardName: string, abilityName: string, abIdx: number): EffectFn | undefined {
  return ABILITY_EFFECTS_BY_NAME.get(`${cardName}|${abilityName}`)
      ?? ABILITY_EFFECTS.get(`${cardName}|${abIdx}`);
}

export function hasAbilityFn(cardName: string, abilityName: string, abIdx: number): boolean {
  return ABILITY_EFFECTS_BY_NAME.has(`${cardName}|${abilityName}`)
      || ABILITY_EFFECTS.has(`${cardName}|${abIdx}`);
}

/**
 * 寶可夢「上備戰時」觸發表（cardName → EffectFn）。
 * engine.ts 會在 PLAY_BASIC 成功後查此 map，有則觸發（pendingSelection 或即時）。
 *
 * v2.65：從 effects.ts 搬到 _shared，讓子模組（例如 maroon_dragon_deck）能直接
 * `import { BENCH_PLACE_TRIGGERS } from '../_shared'`，維持單一 Map 實例。
 */
export const BENCH_PLACE_TRIGGERS = new Map<string, EffectFn>();

/**
 * 特殊能量「附加後」hook — engine.ts 的 ATTACH_ENERGY handler 在能量實際附加後，
 * 會查此 map：key = 特殊能量卡名，fn(state, actorIdx, targetIid, pool) => newState。
 * 若目標寶可夢不符條件（例：感應【超】只對【超】寶可夢生效），fn 內部自行判斷並可略過。
 *
 * v2.66：從 effects.ts 搬到 _shared，讓子模組能直接 `.set(...)` 註冊。
 */
export type AttachEnergyHookFn = (
  state: GameState,
  actorIdx: 0 | 1,
  targetIid: string,
  pool: Map<string, Card>,
) => GameState;
export const SPECIAL_ENERGY_ATTACH = new Map<string, AttachEnergyHookFn>();

/**
 * v2.175：特殊能量被動效果 maps（同 TOOL_* 模式）。
 *
 * 觸發點：
 *   1. SPECIAL_ENERGY_HP_BONUS — holder 有效 HP +N（影響 KO 判定 + UI 顯示）。
 *      fn(holderCard) => N；如要排除「holder 必須是某屬性」，fn 內檢查 holderCard.pokemonType 後回 0。
 *   2. SPECIAL_ENERGY_RETREAT_MOD — holder 撤退成本修正（同 TOOL_RETREAT_MOD shape）。
 *      fn(holderCard, holderInst) => { reduceBy?, zero? }。
 *   3. SPECIAL_ENERGY_STATUS_IMMUNE — holder 對哪些特殊狀態免疫（被施加時忽略）。
 *      fn(holderCard) => Set<SpecialCondition>。空 Set 即不免疫。
 *   4. SPECIAL_ENERGY_ON_DAMAGED — holder 在戰鬥場受到招式傷害時觸發（state mutate）。
 *      同 TOOL_ON_DAMAGED shape：fn(state, dIdx, aIdx, damage, pool) => state。
 *
 * Engine 檢索方式：iterate energyAttached，pool.get(name) 比對 map key。
 * （不像 TOOL_* 一張寶可夢只附 1 個道具，能量可附多張，所以要 iterate）
 */
export const SPECIAL_ENERGY_HP_BONUS = new Map<string, (holder: Card) => number>();
export const SPECIAL_ENERGY_RETREAT_MOD = new Map<string, (
  holder: Card, inst: CardInstance,
) => { reduceBy?: number; zero?: boolean }>();
export const SPECIAL_ENERGY_STATUS_IMMUNE = new Map<string, (holder: Card) => Set<SpecialCondition>>();
export const SPECIAL_ENERGY_ON_DAMAGED = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, damage: number, pool: Map<string, Card>,
) => GameState>();

// ══════════════════════════════════════════════════════════════════════════════
// v2.372 — 探探鼠｜監視之眼支援：通用「移放傷害指示物」特性 set + helper
// ──────────────────────────────────────────────────────────────────────────────
// 探探鼠｜監視之眼（M4 068/083）卡面：「雙方的所有寶可夢身上放置的傷害指示物，
//   無法改放於其他寶可夢身上。」
// 這個 hook 統一在「特性可用性 gate」與「特性 callback 入口」兩處檢查；以後新增
// 任何「移放傷害指示物」類特性，只要把特性名稱加到 MOVE_DAMAGE_COUNTER_ABILITIES
// 即可自動受到監視之眼禁用，無需散落式 inline check。
//
// 命中清單來源：scripts 全資料庫掃描 abilities.effect 含「改放/移放/搬到/轉移到」
//   等動作詞 + 必含「傷害指示物」（v2.372 命中 2 條，覆蓋所有再印 set）。
//
// ⚠️ 維護鐵律：新增「將某寶可夢身上的傷害指示物搬到另一隻」類特性時：
//   1) 把特性名加進 MOVE_DAMAGE_COUNTER_ABILITIES
//   2) 在該特性的 regA callback 入口呼叫 isAbilityBlockedByOakEye()
//   3) 在 engine.ts 對應「特性可用性 gate」也加同樣檢查（避免 UI 顯示按鈕但點下無效）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 「移放傷害指示物」類特性名稱集合 — 監視之眼 gate 的標籤源。
 * 增刪此 set 即同步影響 engine.ts ability gate 與各特性 regA 的 hasOakEye 判定。
 */
export const MOVE_DAMAGE_COUNTER_ABILITIES: ReadonlySet<string> = new Set([
  '腎上腺腦力',  // 願增猿（SV6/SV8a/M2a/MC/M-P-H 共 6 印）— 從己方搬最多 30 傷害給對手
  '火箭腦力',    // 火箭隊的以歐路普（SV10）— 火箭隊寶可夢身上指示物搬到自己其他寶可夢
]);

/**
 * 場上是否有「探探鼠」（任一方任一場上位置）— 通用 hook，給所有「移放傷害指示物」
 * 類特性的 gate / callback 入口共用。
 */
export function hasOakEye(state: GameState, pool: Map<string, Card>): boolean {
  // v4.921 火箭隊的監視塔 gate：探探鼠 pokemonType='Colorless'，
  // 場上有此 stadium 時雙方所有 Colorless 寶可夢的特性（含被動的「監視之眼」）
  // 全部消除 — 須在 helper 內檢查，否則 isAbilityBlockedByOakEye / regA 入口
  // 全部都會誤判監視之眼仍生效。
  // 用字面值 '火箭隊的監視塔' 比對避免從 effects/cards/stadiums.ts import
  // 造成循環依賴（stadiums.ts 已 import 自 _shared.ts）。
  const stadiumCard = state.activeStadium ? pool.get(state.activeStadium.cardId) : undefined;
  const rocketWatchtower = stadiumCard?.name === '火箭隊的監視塔';
  for (const p of state.players) {
    const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
    for (const pk of all) {
      const card = pool.get(pk.cardId);
      if (!card?.abilities?.some(a => a.name === '監視之眼')) continue;
      // 火箭隊的監視塔：Colorless 寶可夢特性失效，跳過此持有者
      if (rocketWatchtower && card.pokemonType === 'Colorless') continue;
      return true;
    }
  }
  return false;
}

/**
 * 此特性是否被「探探鼠｜監視之眼」禁用？= 屬於 MOVE_DAMAGE_COUNTER_ABILITIES
 *   且場上有探探鼠。caller 在 ability gate / callback 入口呼叫一次即可 short-circuit。
 */
export function isAbilityBlockedByOakEye(
  state: GameState, abilityName: string, pool: Map<string, Card>,
): boolean {
  if (!MOVE_DAMAGE_COUNTER_ABILITIES.has(abilityName)) return false;
  return hasOakEye(state, pool);
}

/**
 * v2.388 — 堅果啞鈴｜整人擊落 trigger 檢查
 * ─────────────────────────────────────────────────────────────────────────────
 * 卡面（M4 18481）：「在對手的回合，這張卡因對手的招式・特性・物品卡・支援者卡的
 *   效果而從牌庫被丟棄時，將對手的牌庫上方 8 張卡丟棄。」
 *
 * 在每個「對手讓我方牌庫被丟棄」的 resolver 結束時呼叫此 helper：
 *   triggerOakeyeMillIfApplicable(state, victimIdx, milledCards, pool)
 *
 * - victimIdx: 被 mill 的玩家（堅果啞鈴擁有者）
 * - milledCards: 從 victim 牌庫被丟到棄牌的卡清單
 *
 * 動作：若 milled 含「堅果啞鈴」+ 是對手的回合 → 對 oppIdx 牌庫頂 8 張丟棄。
 *
 * 已套用 trigger 的路徑（v2.388）：
 *   - effects.ts millOppDeckTopPost helper（涵蓋 巨炭山｜山崩、雄偉牙｜地盤崩壞、
 *     花岩怪｜崩山 10、鐵螯龍蝦｜喀嚓喀嚓 等所有「對手牌庫頂 N 張丟」招式）
 *   - effects/cards/v2360_j_mark_batch.ts 河馬獸｜龍捲風噴射（塔拉剛效果）
 *
 * 未套用 trigger 的路徑（已知但 follow-up）：
 *   - 紫竽（看對手牌庫頂 N 張選 1 張丟）— 對手主動讓己方牌庫丟，目前不在路徑
 *   - 「特殊紅牌」/「庫瑟洛斯奇的企圖」等對手手牌洗回牌庫類 — 不算「牌庫被丟棄」
 *   - 對手特性主動 mill 我方牌庫 — 目前 J 標 set 中無此類卡
 */
export function triggerOakeyeMillIfApplicable(
  state: GameState,
  victimIdx: 0 | 1,
  milledCards: CardInstance[],
  pool: Map<string, Card>,
): GameState {
  // 條件 1：milled 含堅果啞鈴
  const hasOakNail = milledCards.some(c => pool.get(c.cardId)?.name === '堅果啞鈴');
  if (!hasOakNail) return state;
  // 條件 2：是「對手的回合」（victim 不是當前 active 玩家）
  const oppIdx = (1 - victimIdx) as 0 | 1;
  if (state.activePlayerIndex !== oppIdx) return state;
  // 動作：對手牌庫頂 8 張丟棄
  const oppPlayer = state.players[oppIdx];
  if (oppPlayer.deck.length === 0) {
    return addLog(state,
      '整人擊落：堅果啞鈴從牌庫被丟棄，但對手牌庫為空，無效果',
      victimIdx);
  }
  const milled = oppPlayer.deck.slice(0, 8);
  return updatePlayer(
    addLog(state,
      `整人擊落：堅果啞鈴從牌庫被丟棄 → 對手牌庫頂 ${milled.length} 張丟入棄牌區`,
      victimIdx),
    oppIdx,
    pl => ({ ...pl, deck: pl.deck.slice(milled.length), discard: [...pl.discard, ...milled] }),
  );
}


/**
 * v2.341：被動特性——對手附能時自動觸發。
 *
 * 鍵：寶可夢卡名；值：fn(state, gIdx, oppIdx, targetIid, pool)
 *   - gIdx    ：擁有此特性的寶可夢所屬玩家 index（發動方）
 *   - oppIdx  ：執行附能的對手玩家 index
 *   - targetIid：被附能的寶可夢 instance iid（發動方的寶可夢）
 *   回傳：更新後的 GameState
 *
 * 觸發點：engine.ts ATTACH_ENERGY handler，能量附著完成後。
 */
export const OPP_ENERGY_ATTACH_PASSIVE = new Map<string, (
  state: GameState,
  gIdx: 0 | 1,
  oppIdx: 0 | 1,
  targetIid: string,
  pool: Map<string, Card>,
) => GameState>();

export function canPlayTrainer(
  cardName: string,
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>
): boolean {
  // v2.113 蓋諾賽克特｜ACE消弭 — 對手場上若有蓋諾賽克特且附有寶可夢道具，
  //   則「本方」無法從手牌使出 ACE SPEC 卡。
  const myCard = pool.get(
    state.players[actorIdx].hand.find(c => pool.get(c.cardId)?.name === cardName)?.cardId ?? ''
  );
  if (myCard && (myCard.tags ?? []).includes('ACE SPEC')) {
    const dIdx = (1 - actorIdx) as 0 | 1;
    const oppAll = [
      ...(state.players[dIdx].active ? [state.players[dIdx].active!] : []),
      ...state.players[dIdx].bench,
    ];
    const aceBlocked = oppAll.some(p => {
      const c = pool.get(p.cardId);
      return c?.name === '蓋諾賽克特' && !!p.toolAttached;
    });
    if (aceBlocked) return false;
  }
  const guard = TRAINER_GUARDS.get(cardName);
  return guard ? guard(state, actorIdx, pool) : true;
}

// ══════════════════════════════════════════════════════════════════════════════
// 純函式工具
// ══════════════════════════════════════════════════════════════════════════════

/**
 * v2.35：進化 name 同名判定（PTCG 規則：ex 和非 ex 同名卡是同一進化階級）。
 *
 * 例：`伊布` / `伊布ex` 都是 Basic，兩個都可進化為 `火伊布ex`。
 * 卡池裡 `evolvesFrom='伊布'` 的 `火伊布ex`，場上若擺 `伊布ex` 也應能當底。
 *
 * 因此所有 `evolvesFrom` vs `name` 的字串比對都要走這個 helper，
 * 忽略兩邊尾端的 `ex` 後綴後比對。
 *
 * 注意：這不是「容錯」而是「正確的進化規則」。scraper 資料若爬錯仍要修；
 * helper 只處理真正的 ex/非 ex 互通情境。
 */
/**
 * v3.78：取得 idx 玩家的 own bench 上限。
 * 預設 5；場上有「零之大空洞」 + 自己場上有「太晶」寶可夢時 → 8。
 * 內聯實作，不依賴 engine.ts（避免 effects → engine 循環 import）。
 * 與 engine.ts:getBenchLimit 保持邏輯同步。
 */
export function getOwnBenchLimit(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
): number {
  const s = state.activeStadium;
  if (!s) return 5;
  const stadiumCard = pool.get(s.cardId);
  if (stadiumCard?.name !== '零之大空洞') return 5;
  const player = state.players[idx];
  const all = [player.active, ...player.bench].filter((c): c is CardInstance => !!c);
  const hasTera = all.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
  return hasTera ? 8 : 5;
}

export function sameEvoName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // v5.307: PTCG TW 規則 — 「超級XXXex」(Mega Evolution ex) 與對應「XXXex」/「XXX」 屬同一進化階變體,
  //   進化判定 + 同名比對應視為同名. 例: 「超級龍頭地鼠ex / 龍頭地鼠ex / 龍頭地鼠」都同 Stage1.
  //   strip 順序: 先 strip 'ex' suffix, 再 strip '超級' prefix.
  const normalize = (s: string) => {
    let r = s;
    if (r.endsWith('ex')) r = r.slice(0, -2);
    if (r.startsWith('超級')) r = r.slice(2);
    return r;
  };
  return normalize(a) === normalize(b);
}

/**
 * v2.246 完整 KO cause tracking — 統一 KO 記錄入口。
 *
 * 在每個 KO 發生點呼叫此 helper，會更新對應的 thisTurn counter
 * （oppAttackKOdMeThisTurn / oppAbilityKOdMeThisTurn 等）。
 *
 * 規則：
 * 1. 自 KO（victimIdx === activePlayerIndex）不計入 — 因為「對手主動 KO 我方」要求 attacker ≠ victim
 * 2. 寶可夢檢查階段 KO（中毒/灼傷/冰冷之帳 等）— **不要呼叫此 helper**，這是 checkup phase
 * 3. cause 'attack' = 招式造成傷害 KO；cause 'ability' = 主動特性 KO
 *
 * 用法範例：
 *   s = recordOppKO(s, dIdx, defenderCard, 'attack', pool);  // 招式 KO 對手
 *   s = recordOppKO(s, dIdx, targetCard, 'ability', pool);   // 咒詛炸彈 KO 對手
 */
export function recordOppKO(
  state: GameState,
  victimIdx: 0 | 1,
  victimCard: Card | undefined,
  cause: 'attack' | 'ability',
): GameState {
  // 自 KO：攻擊方 KO 自己的寶可夢（咒詛炸彈自爆等） — 不算入「對手主動 KO 我方」
  if (state.activePlayerIndex === victimIdx) return state;
  const isRocket = victimCard?.supertype === 'Pokemon'
    && (victimCard.name?.startsWith('火箭隊的') ?? false);
  // v5.274 赫普家族 — 給「赫普的朽木妖|恐怖復仇」用 (卡面只計「赫普的」KO)
  const isHop = victimCard?.supertype === 'Pokemon'
    && (victimCard.name?.startsWith('赫普的') ?? false);
  const fieldKey: keyof GameState = cause === 'attack'
    ? 'oppAttackKOdMeThisTurn'
    : 'oppAbilityKOdMeThisTurn';
  const rocketKey: keyof GameState = cause === 'attack'
    ? 'oppAttackKOdMyRocketThisTurn'
    : 'oppAbilityKOdMyRocketThisTurn';
  const hopKey: keyof GameState = cause === 'attack'
    ? 'oppAttackKOdMyHopThisTurn'
    : 'oppAbilityKOdMyHopThisTurn';
  const cur = ((state[fieldKey] as [number, number] | undefined) ?? [0, 0]);
  const next: [number, number] = [cur[0], cur[1]];
  next[victimIdx]++;
  let s: GameState = { ...state, [fieldKey]: next };
  if (isRocket) {
    const curR = ((s[rocketKey] as [number, number] | undefined) ?? [0, 0]);
    const nextR: [number, number] = [curR[0], curR[1]];
    nextR[victimIdx]++;
    s = { ...s, [rocketKey]: nextR };
  }
  if (isHop) {
    const curH = ((s[hopKey] as [number, number] | undefined) ?? [0, 0]);
    const nextH: [number, number] = [curH[0], curH[1]];
    nextH[victimIdx]++;
    s = { ...s, [hopKey]: nextH };
  }
  return s;
}

/**
 * v2.244 通用 helper：清掉 activeStadium 並丟回擁有者棄牌堆。
 * 一律用 state.activeStadiumOwnerIdx；若該欄位缺失則 fallback 到 fallbackIdx（觸發方）。
 * 同時清掉 stadiumUsedThisTurn / activeStadiumOwnerIdx，符合 PTCG「stadium 離場」規則。
 */
export function discardActiveStadium(
  state: GameState,
  fallbackIdx: 0 | 1,
): GameState {
  const stadium = state.activeStadium;
  if (!stadium) return state;
  const ownerIdx = state.activeStadiumOwnerIdx ?? fallbackIdx;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[ownerIdx] = {
    ...players[ownerIdx],
    discard: [...players[ownerIdx].discard, stadium],
  };
  return {
    ...state,
    players,
    activeStadium: undefined,
    activeStadiumOwnerIdx: undefined,
    stadiumUsedThisTurn: undefined,
  };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function updatePlayer(
  state: GameState,
  idx: 0 | 1,
  fn: (p: PlayerState) => PlayerState
): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[idx] = fn(players[idx]);
  return { ...state, players };
}

/**
 * v4.934：產生「卡名連結」marker 字串，用於 addLog 訊息內嵌精確 iid。
 *   `${cardLink(inst.iid, card.name)} 被擊倒！` → 玩家點該卡名 button → 直接定位該 inst。
 * 解決原本只用 string-match + sourceIid hint 在「同名多隻」場景對應錯誤的問題。
 *
 * 格式：\uE100<iid>\uE101<displayName>\uE102（PUA 字元，肉眼看不到）
 * 由 log_format.ts MARKER_RE 解析。
 *
 * Edge cases：iid 或 displayName 缺則退回顯示 displayName（不產生 marker），確保
 *   never break。
 */
/**
 * v5.452：把一組卡（CardInstance[]）格式化成 log 用的卡名字串「A」「B」「C」。
 * 用於「丟棄牌庫/手牌」類效果在對戰 log 顯示實際丟了哪幾張（玩家回報怪顎龍|亂暴沒顯示）。
 * 用 cardLink 讓卡名可點擊查看（丟到棄牌堆後仍可由 iid 解析）。
 */
export function joinCardNames(cards: CardInstance[], pool: Map<string, Card>): string {
  if (!cards || cards.length === 0) return '';
  return cards.map(c => cardLink(c.iid, pool.get(c.cardId)?.name ?? '?')).join('、');
}

export function cardLink(iid: string | undefined | null, displayName: string | undefined | null): string {
  const name = displayName ?? '';
  if (!iid || !name) return name;
  return `\uE100${iid}\uE101${name}\uE102`;
}

export function addLog(
  state: GameState,
  msg: string,
  playerIdx: 0 | 1 | null = null
): GameState {
  // v3.891：自動從 actor active 取 iid 當 sourceIid（log 卡名點擊精準追溯用）
  const sourceIid = playerIdx !== null ? state.players[playerIdx]?.active?.iid : undefined;
  return {
    ...state,
    log: [...state.log, {
      turn: state.turn,
      playerIndex: playerIdx,
      message: msg,
      timestamp: Date.now(),  // v5.068：UI 計算 [mm:ss] 對戰相對時間
      ...(sourceIid && { sourceIid }),
    }],
  };
}

/**
 * v2.130：寫一筆「私有/公開分流」log。
 * - 玩家 playerIdx 看 privateMsg（含具體卡名等敏感資訊）
 * - 對手 / 系統看 publicMsg（脫敏版，例：「搜到 一張卡片」）
 *
 * 用途：自牌庫搜尋（忍之利刃 / 招集之術…）、查看牌庫頂等不應對對手揭露具體卡的場景。
 */
export function addPrivateLog(
  state: GameState,
  privateMsg: string,
  publicMsg: string,
  playerIdx: 0 | 1
): GameState {
  return {
    ...state,
    log: [...state.log, {
      turn: state.turn,
      playerIndex: playerIdx,
      message: publicMsg,
      privateMessage: privateMsg,
      timestamp: Date.now(),  // v5.068：UI 計算 [mm:ss] 對戰相對時間
    }],
  };
}

export function drawCards(state: GameState, idx: 0 | 1, count: number): GameState {
  return updatePlayer(state, idx, (p) => {
    const n = Math.min(count, p.deck.length);
    if (n <= 0) return p;
    const drawn = p.deck.slice(0, n);
    return { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...drawn] };
  });
}

export function discardHand(state: GameState, idx: 0 | 1): GameState {
  return updatePlayer(state, idx, (p) => ({
    ...p,
    discard: [...p.discard, ...p.hand],
    hand: [],
  }));
}

export function returnHandToDeck(state: GameState, idx: 0 | 1): GameState {
  return updatePlayer(state, idx, (p) => {
    // v5.514：手牌洗回牌庫時，給這些卡換上全新 iid。
    //   原因：UI 抽牌動畫以「手牌 iid 是否為新」偵測新抽到的卡（src/routes/game/+page.svelte
    //   prevHandIids diff）。若洗回的卡又被抽回手牌且保留原 iid，diff 會誤判「這張卡沒離開過手牌」
    //   → 重抽動畫不顯示（玩家報：莉莉艾的決意/裁判/不公印章 重抽後抽到與原手牌相同的卡時，
    //   看起來像手牌一直在手上、沒有重抽）。re-id 後不論抽到什麼都是新 iid → 必跑抽牌動畫。
    //   手牌卡是裸 instance（能量/道具只在場上寶可夢身上，pending 此刻不引用手牌），換 iid 安全；
    //   線上模式只有出招方計算後整包推送覆蓋對手，故 Math.random iid 不會造成不同步。
    const reidHand = p.hand.map((c) => ({
      ...c,
      iid: `${c.iid}~r${Math.random().toString(36).slice(2, 8)}`,
    }));
    return {
      ...p,
      deck: shuffle([...p.deck, ...reidHand]),
      hand: [],
    };
  });
}

export function withPending(state: GameState, sel: PendingSelection): GameState {
  // v4.933：若已有 pending 待解（同一 engine action 內 TOOL_ON_DAMAGED + ATTACK_POST
  //   都會 withPending 的 case，例：手持循環扇 + 幻影奇襲），新的 pending push 到
  //   pendingChainQueue 排隊，避免直接覆蓋掉前者。
  //   RESOLVE_SELECTION resolver 跑完後（engine.ts）若 pendingSelection 為空會自動
  //   pop queue 設為新 pending，玩家依序解每一筆。
  if (state.pendingSelection) {
    return {
      ...state,
      pendingChainQueue: [...(state.pendingChainQueue ?? []), sel],
    };
  }
  return { ...state, pendingSelection: sel };
}

// v5.496：牌庫搜尋型「無符合卡」的統一處理 — 仍開 deck-search 檢視 picker 讓玩家看過整副牌庫 + 重洗。
//   依 v5.424 規則：牌庫=未知資訊→可【不選】；只要牌庫非空就開 picker，不直接略過（符合「搜尋牌庫」
//   公開規則：對手知道你搜尋過、你重洗）。filter:'any' 顯示全牌庫、maxCount:0 僅檢視、
//   search-to-hand-reshuffle 確認/不選後重洗（0 picks 不加手牌）。牌庫全空才略過（無可看）。
export function openDeckViewReshuffle(state: GameState, idx: 0 | 1, label: string): GameState {
  if (state.players[idx].deck.length === 0) return addLog(state, `${label}：牌庫已空`, idx);
  const s = addLog(state, `${label}：牌庫無符合卡，檢視牌庫後重洗`, idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'any', minCount: 0, maxCount: 0,
    effectKey: 'search-to-hand-reshuffle',
    params: { label: `${label}（檢視牌庫）` },
  });
}

/**
 * 當寶可夢離開戰鬥場（撤退 / 被切換 / 被換出）時要清掉的旗標與狀態。
 *
 * PTCG 官方規則：寶可夢離開戰鬥場、或離開場地時，所有施於它身上的
 *   - 特殊狀態（灼傷、中毒、睡眠、混亂、麻痺）
 *   - 招式效果（如「下回合不能使用 X 招式」、「下回合不能撤退」、跨回合受傷 +N、
 *     跨回合傷害 +N 等）
 * 通通解除；但以下必須保留：
 *   - damage（傷害指示物）
 *   - energyAttached（附加的能量）
 *   - toolAttached（附加的道具）
 *   - evolvedFromStack / evolvedFromIid（進化鏈）
 *   - justPlaced / evolvedThisTurn / abilityUsedThisTurn（玩家行為計數，於 END_TURN 清）
 *
 * 用於 engine.ts 的 RETREAT、以及 effects.ts 所有 active ↔ bench swap 的點
 * （寶可夢交替 / 急進開關 / 頂尖捕捉器 / 衝浪手 / 支配鎖鏈 / 老匠系強制互換 等）。
 * 設計為純函式：回傳新 CardInstance，不 mutate 輸入。
 *
 * v2.08：原本撤退 / 換場都只搬 active/bench 不清狀態旗標，導致：
 *   - 灼傷/中毒/睡眠/混亂/麻痺 跟著到備戰區
 *   - 烈火爆進等「此寶可夢離開戰鬥場前無法使用該招式」的 cantAttackPending/ThisTurn
 *     即使撤退換回來也還在
 * v5.033：補清 blockedAttackNamesNextTurn / blockedAttackNamesThisTurn —
 *   蒼響ex 無畏斬 / 烈火爆進 / 天仙石 / 超級勇氣 / 7 張 recharge 等所有「鎖招名」型
 *   effect，退到備戰區後仍鎖（玩家回報）。卡面 PTCG 規則一致：退場清狀態。
 * 統一用這個 helper 處理。
 */
export function clearActiveEffects(poke: CardInstance): CardInstance {
  return {
    ...poke,
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
    // v5.033：鎖招名 flag — 蒼響ex 無畏斬 / 破空焰ex 烈火爆進 / 天仙石 / 超級勇氣 /
    // 龍之強襲 / 光明角擊 / 7 張 recharge 等所有 blockedAttackNamesNextTurn 機制
    // 卡面文義為「下回合此寶可夢無法用此招」或「離開戰鬥場前無法用此招」—
    // PTCG 規則：寶可夢退到備戰區清除所有狀態（含招式鎖）。
    blockedAttackNamesNextTurn: undefined,
    blockedAttackNamesThisTurn: undefined,
    // ── v5.443：一勞永逸 — 補齊「招式效果加在這隻寶可夢身上」的所有延遲/跨回合旗標。
    //   PTCG 官方規則：寶可夢從戰鬥場退到備戰區時，移除所有特殊狀態與招式效果。
    //   日後新增此類旗標(immune*/cost/weakness/delayed 等)請一律加進此清單，不要在各招式
    //   另外手動清。保留的欄位(身分/附加/傷害指示物/進化/出牌與特性使用追蹤)不在此清。
    nextOwnAttackPenalty: undefined,
    retaliateCountersOnNextHit: undefined,
    paralyzeFangPending: undefined,
    koAtMyNextEndOfTurn: undefined,
    damageAtMyNextEndOfTurn: undefined,
    strongKissDiscardPending: undefined,        // v5.443 迷唇姐強烈之吻 — 退備戰即清(玩家報)
    immuneToAttackEffectsNextTurn: undefined,
    immuneToAttackEffectsThisTurn: undefined,
    attackCostIncreaseColorlessNextTurn: undefined,
    attackCostIncreaseColorlessThisTurn: undefined,
    retreatCostIncreaseNextTurn: undefined,
    retreatCostIncreaseThisTurn: undefined,
    endTurnOnOppAttachEnergyNextTurn: undefined,
    endTurnOnOppAttachEnergyThisTurn: undefined,
    immuneToExAttackTagNextTurn: undefined,
    immuneToExAttackTagThisTurn: undefined,
    weaknessOverrideTypeNextTurn: undefined,
    weaknessOverrideTypeThisTurn: undefined,
    weaknessDisabledNextTurn: undefined,
    weaknessDisabledThisTurn: undefined,
    immuneToBasicAttackNextTurn: undefined,
    immuneToBasicAttackThisTurn: undefined,
    basicImmuneColorlessExcept: undefined,
    immuneToExAttackNextTurn: undefined,
    immuneToExAttackThisTurn: undefined,
    immuneToAbilityPokemonNextTurn: undefined,
    immuneToAbilityPokemonThisTurn: undefined,
    immuneToAllAttackNextTurn: undefined,
    immuneToAllAttackThisTurn: undefined,
    immuneToAttackDamageNextTurn: undefined,
    immuneToAttackDamageThisTurn: undefined,
    immuneToEvolutionAttackNextTurn: undefined,
    immuneToEvolutionAttackThisTurn: undefined,
    evolutionDamageReduceNextTurn: undefined,
    evolutionDamageReduceThisTurn: undefined,
    immuneToBurnedAttackerNextTurn: undefined,
    immuneToBurnedAttackerThisTurn: undefined,
    abilityNullifiedNextTurn: undefined,
    abilityNullifiedThisTurn: undefined,
  };
}

/**
 * 通用回復 resolver（heal-target pending 的共用處理）。
 *
 * v2.24：從 effects.ts 抽到 _shared.ts，統一給 heal-30 / heal-60-discard-1 /
 * heal-120 / heal-150 / heal-full 五個 effectKey 共用，避免分散在多個模組時出現
 * 重複實作或跨檔 import 循環。
 *
 * params:
 *   - healAmount   : number       回復量（heal-full 可傳 9999）
 *   - discardEnergy: number       選擇目標後丟棄 N 個能量（好傷藥 = 1）
 *
 * 行為：
 *   1. pre-log「→ {name} 回復 X HP（丟棄 N 個能量）」
 *      實際 log 的 HP 量使用 Math.min(damage, healAmount)，避免寫出「回復 120」
 *      但目標只有 30 傷害的奇怪 log。
 *   2. 目標寶可夢的 damage -= healAmount（下限 0），energyAttached 從尾端移除 N 個
 *      進棄牌。
 *   3. 回 updatePlayer(state, idx, p => ...)，純函式不 mutate。
 */
/**
 * v2.119：統一處理「把寶可夢放進備戰區」的共同副作用。
 *
 * 目前處理：
 *   - 險惡廢墟（Stadium）— 雙方玩家將【基礎】寶可夢（【惡】寶可夢除外）放到備戰區時，
 *     該寶可夢放置 2 個傷害指示物（20 傷）。
 *
 * 不處理（刻意保留獨立）：
 *   - BENCH_PLACE_TRIGGERS（如喵喵ex｜殺手鐧捕捉）— 這個觸發目前只走 PLAY_BASIC 路徑；
 *     從牌庫/棄牌搜寶可夢到備戰是否該觸發，PTCG 規則細節需個案判斷（本項 Leon 尚未反饋），
 *     先保留現狀，避免 regression。
 *
 * 呼叫時機：任何 resolver 在「把寶可夢塞進 bench」後應呼叫此 helper，傳入新放入的 iid 清單。
 * engine.ts 的 PLAY_BASIC 也已統一改用此 helper。
 */
export function applyBenchPlaceSideEffects(
  state: GameState,
  idx: 0 | 1,
  placedIids: string[],
  pool: Map<string, Card>,
): GameState {
  if (placedIids.length === 0) return state;
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  if (stadium?.name !== '險惡廢墟') return state;

  const p = state.players[idx];
  const affected: string[] = [];
  const newBench = p.bench.map(c => {
    if (!placedIids.includes(c.iid)) return c;
    const card = pool.get(c.cardId);
    if (!card || card.pokemonType === 'Darkness') return c;
    affected.push(card.name);
    return { ...c, damage: c.damage + 20 };
  });
  if (affected.length === 0) return state;
  state = updatePlayer(state, idx, pl => ({ ...pl, bench: newBench }));
  for (const name of affected) {
    state = addLog(state, `險惡廢墟：${name} 受到 2 個傷害指示物`, idx);
  }
  return state;
}

export function healResolver(
  st: GameState,
  idx: 0 | 1,
  iids: string[],
  params: Record<string, unknown> | undefined,
  pool: Map<string, Card>
): GameState {
  const healAmount = (params?.healAmount as number) ?? 30;
  const discardCount = (params?.discardEnergy as number) ?? 0;
  // v2.199 寶可夢中心的姐姐：除了回血也清掉特殊狀態（含 secondaryStatus，例 危險光線雙狀態）。
  // 卡面寫「特殊狀態也全部恢復」— 只對戰鬥位有特殊狀態，但備戰位可能因 v2.163 secondaryStatus
  // 仍殘留旗標，一併清空保險。
  const clearStatus = params?.clearStatus === true;
  const iid = iids[0];
  // 附加 log：記錄實際回復的目標與數值（pre-log 僅提示「選擇…寶可夢」，未標明目標）
  const prevPlayer = st.players[idx];
  const prevTarget = prevPlayer.active?.iid === iid
    ? prevPlayer.active
    : prevPlayer.bench.find(c => c.iid === iid);
  if (prevTarget) {
    const name = pool.get(prevTarget.cardId)?.name ?? '?';
    const actualHeal = Math.min(prevTarget.damage, healAmount);
    const parts = [`${name} 回復 ${actualHeal} HP`];
    if (discardCount > 0) parts.push(`丟棄 ${discardCount} 個能量`);
    if (clearStatus && (prevTarget.status || prevTarget.secondaryStatus)) {
      parts.push('解除特殊狀態');
    }
    st = addLog(st, `→ ${parts.join('，')}`, idx);
  }
  // v5.422：先回血（不在這裡丟能量）— 卡面「選擇1個身上能量丟棄」應由玩家選，原本 slice(-N)
  //   自動丟尾端是簡易安裝。
  st = updatePlayer(st, idx, (p) => {
    const isActive = p.active?.iid === iid;
    const target = isActive ? p.active! : p.bench.find(c => c.iid === iid);
    if (!target) return p;
    const newDamage = Math.max(0, target.damage - healAmount);
    const healed: CardInstance = { ...target, damage: newDamage };
    if (clearStatus) {
      delete healed.status;
      delete healed.secondaryStatus;
      delete healed.poisonDamagePerCheckup;
    }
    return {
      ...p,
      active: isActive ? healed : p.active,
      bench: isActive ? p.bench : p.bench.map(c => c.iid === iid ? healed : c),
    };
  });
  if (discardCount <= 0) return st;
  // 丟能量：玩家選哪個（能量數 <= 要丟數 → 沒得選，自動全丟）
  const hp = st.players[idx];
  const healedInst = hp.active?.iid === iid ? hp.active : hp.bench.find(c => c.iid === iid);
  const energyIids = healedInst?.energyAttached.map(e => e.iid) ?? [];
  if (energyIids.length === 0) return st;
  if (energyIids.length <= discardCount) {
    const removed = healedInst?.energyAttached ?? [];
    return updatePlayer(st, idx, p => {
      const strip = (pk: CardInstance | null): CardInstance | null =>
        pk && pk.iid === iid ? { ...pk, energyAttached: [] } : pk;
      return { ...p, active: strip(p.active), bench: p.bench.map(c => c.iid === iid ? { ...c, energyAttached: [] } : c), discard: [...p.discard, ...removed] };
    });
  }
  return withPending(st, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: discardCount, maxCount: discardCount,
    effectKey: 'heal-discard-energy-pick',
    params: { scope: 'all-own', validIids: energyIids, ownerIid: iid, titleOverride: `選擇要丟棄的 ${discardCount} 個能量` },
  });
}


// ── pendingPrizes helpers (v2.98) ────────────────────────────────────────────
// 統一管理 [P1, P2] tuple 的累計與查詢。所有「+N pendingPrizes」必須走這裡，
// 不再允許 prizes.slice() + hand: [...] 直接派發到手牌（除引擎 TAKE_PRIZES handler）。

/** 對 ownerIdx 側累計 n 張待領獎賞。owner = 應該取走獎賞的玩家。 */
export function addPendingPrize(state: GameState, ownerIdx: 0 | 1, n: number, pool: Map<string, Card>): GameState {
  // v5.466 自動給獎賞：取代「累加 pendingPrizes + 手動【取得】鈕」。KO 當下立即把獎賞卡移入手牌，
  //   消除「攻擊方取獎賞 push 與防守方補位 push 重疊」的線上 desync（幻影奇襲多重KO 等）。
  //   ★ 私密 log（v5.452）：本人看到取得哪幾張卡(可點 cardLink)、對手只看張數 — 所有取得獎賞狀況
  //     一律產生此 log（沒有【取得】鈕後，玩家只能靠 log 確認拿到哪張）。pendingPrizes 不再累加(恆 0)。
  if (n <= 0) return state;
  const taker = { ...state.players[ownerIdx] };
  const count = Math.min(n, taker.prizes.length);
  if (count <= 0) return state;  // 無獎賞卡可取（理論上已勝）
  const taken = taker.prizes.slice(0, count);
  taker.prizes = taker.prizes.slice(count);
  taker.hand = [...taker.hand, ...taken];
  const players = [...state.players] as [PlayerState, PlayerState];
  players[ownerIdx] = taker;
  const takenNames = taken.map(cc => cardLink(cc.iid, pool.get(cc.cardId)?.name ?? '?')).join('、');
  let s: GameState = addPrivateLog(
    { ...state, players },
    `${taker.name} 取得了 ${count} 張獎賞卡：${takenNames}（剩餘 ${taker.prizes.length} 張）`,
    `${taker.name} 取得了 ${count} 張獎賞卡（剩餘 ${taker.prizes.length} 張）`,
    ownerIdx,
  );
  if (taker.prizes.length <= 0) {
    s = {
      ...s, phase: 'game-over', winner: ownerIdx,
      winReason: `${taker.name} 取得所有獎賞卡`,
      log: [...s.log, { turn: s.turn, playerIndex: null, message: `${taker.name} 取得所有獎賞卡，獲勝！`, timestamp: Date.now() }],
    };
  }
  return s;
}

/** 查詢 ownerIdx 側待領獎賞數量。 */
export function getPendingPrize(state: GameState, ownerIdx: 0 | 1): number {
  return state.pendingPrizes?.[ownerIdx] ?? 0;
}

/** 雙方任一側 > 0 → 阻擋 END_TURN / festival second attack 等 gate。 */
export function hasAnyPendingPrize(state: GameState): boolean {
  const pp = state.pendingPrizes ?? [0, 0];
  return pp[0] > 0 || pp[1] > 0;
}


// ── v3.20: 寶可夢道具多附支援（洛托姆ex｜多重轉接） ──────────────────────────
//
// 卡面：「只要這隻寶可夢在場上，名稱中有『洛托姆』的自己的所有寶可夢，
//   各自身上最多可附有 2 張『寶可夢道具』卡。
//   （這個特性消除時，將身上多附的『寶可夢道具』卡丟棄。）」
//
// 設計：
//   - CardInstance.toolAttached（單一）保留 — 既有 200+ 引用點不必改
//   - 新欄位 CardInstance.extraTools: CardInstance[] — 第 2 張及以上的道具
//   - getAllAttachedTools(inst) 統一回傳 [toolAttached, ...extraTools].filter(Boolean)
//     供 KO discard / TOOL hook iterate / UI 顯示使用
//
// 影響範圍：
//   1. attach-tool resolver（tools.ts）— 已附第 1 張且 holder 是「洛托姆」家族
//      且場上有「多重轉接」啟用時，溢出進 extraTools（最多 +1）
//   2. KO / 退化 / 換手 等所有「道具一起進棄牌」處 — 改用 getAllAttachedTools
//   3. TOOL_xxx hook（HP_BONUS / ATTACK_BONUS / DEFENSE 等）— iterate 全部道具
//   4. 特性消除（場上沒有洛托姆ex 多重轉接）— reconcile 所有 extraTools 進棄牌
//
export function getAllAttachedTools(inst: CardInstance | null | undefined): CardInstance[] {
  if (!inst) return [];
  const out: CardInstance[] = [];
  if (inst.toolAttached) out.push(inst.toolAttached);
  if (inst.extraTools && inst.extraTools.length > 0) out.push(...inst.extraTools);
  return out;
}

/**
 * 自方場上是否有「洛托姆ex」（基本的洛托姆ex，14347）並擁有「多重轉接」特性活躍。
 * 用途：
 *   - attach-tool resolver gate（決定第 2 張道具能否附到「洛托姆」家族）
 *   - reconcile（每次 applyAction 末尾檢查「特性消除」狀態）
 *
 * 特性活躍判定：暫只看「自方場上有洛托姆ex（含 active 與 bench）」。
 * 「特性消除」走 PASSIVE 是否被阻擋的邏輯由 caller（reconcile）處理。
 */
export function hasMultiToolRelay(
  state: GameState,
  ownerIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const player = state.players[ownerIdx];
  if (!player) return false;
  const all: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  for (const inst of all) {
    const c = pool.get(inst.cardId);
    if (!c) continue;
    if (c.name !== '洛托姆ex') continue;
    if (!c.abilities?.some(a => a.name === '多重轉接')) continue;
    return true;
  }
  return false;
}

/**
 * 是否為「洛托姆」家族卡（名字含「洛托姆」），可使用多重轉接的雙道具特權。
 */
export function isLotomFamily(card: Card | undefined): boolean {
  if (!card) return false;
  return (card.name ?? '').includes('洛托姆');
}

/**
 * Reconcile：場上若無「洛托姆ex 多重轉接」啟用，自方所有寶可夢的 extraTools
 * 全部丟進棄牌堆，並清空 extraTools。
 *
 * 呼叫時機：每次 applyAction 末尾（與 enforceBenchLimit 同層）
 * — 確保任何時候「沒有特性活躍」時，多附的道具會被即時清掉。
 */
export function reconcileMultiToolRelay(
  state: GameState,
  pool: Map<string, Card>,
): GameState {
  if (state.phase !== 'playing') return state;
  let changed = false;
  const players = state.players.map((p, i) => {
    const ownerIdx = i as 0 | 1;
    if (hasMultiToolRelay(state, ownerIdx, pool)) return p;
    // 此玩家的所有寶可夢 extraTools 全棄
    const drained: CardInstance[] = [];
    const drain = (pk: CardInstance | null): CardInstance | null => {
      if (!pk) return pk;
      if (!pk.extraTools || pk.extraTools.length === 0) return pk;
      drained.push(...pk.extraTools);
      changed = true;
      return { ...pk, extraTools: [] };
    };
    const newActive = drain(p.active);
    const newBench = p.bench.map(b => drain(b) as CardInstance);
    if (drained.length === 0) return p;
    return { ...p, active: newActive, bench: newBench, discard: [...p.discard, ...drained] };
  }) as typeof state.players;
  if (!changed) return state;
  // 加 log 給玩家看
  let s: GameState = { ...state, players };
  for (const ownerIdx of [0, 1] as const) {
    if (hasMultiToolRelay(state, ownerIdx, pool)) continue;
    const before = state.players[ownerIdx];
    const had = (before.active?.extraTools?.length ?? 0)
      + before.bench.reduce((sum, b) => sum + (b.extraTools?.length ?? 0), 0);
    if (had > 0) {
      s = addLog(s, `多重轉接消除：丟棄多附的寶可夢道具 ${had} 張`, ownerIdx);
    }
  }
  return s;
}


// ════════════════════════════════════════════════════════════════════════════
// v5.243 — 「從備戰區放置於戰鬥場時」可發動 1 次的特性 — 統一 helper
//
// 卡面字面：「在自己的回合，從備戰區將這隻寶可夢放置於戰鬥場時，可使用 1 次。」
//
// 觸發路徑（自己回合內、自方換位）：
//   - 撤退 (RETREAT) + 撤退能量 picker (retreat-energy-discard)
//   - 寶可夢交替 / 急進開關 / 衝浪海灘 等 trainer 道具
//   - 自方招式的「自身互換」效果 (雀躍 / 瞬間移轉 / 瞬間移動者 / 天空搬運 / h-wave2 等)
//   - 鐵斑葉ex 迅速游標 self-promote (特性自身換位)
//
// 排除：
//   - KO 後補位 (SEND_NEW_ACTIVE) — 不算換位行為
//   - 對手強制我方換場 / 我方招式強制對手換場 — 卡面要求「自己的回合」，跨回合不觸發
//
// 放在 _shared.ts 因為這檔是 leaf module（只 import types），所有需要 import
// 此 helper 的 caller（effects.ts / engine.ts / cards/*.ts）都不會造成 circular import。
// ════════════════════════════════════════════════════════════════════════════

/** 「從備戰區放置於戰鬥場時」可發動 1 次的特性名稱 */
export const ON_PROMOTE_TO_ACTIVE_ABILITIES = new Set([
  '振翅高飛',     // 遠古巨蜓ex — 從牌庫選最多 3 張基本【草】能量附身
  '潔淨支援',     // 拉帝歐斯 — 場上其他寶可夢能量改附給戰鬥位（特定條件）
  '金屬之路',     // 勾帕路翁ex — 場上【鋼】能量改附給自身
  '超光速位元',   // 鐵武者ex — 對手 1 隻寶可夢放 2 個傷害指示物（待實作）
  '熱流反應者',   // 鐵毒蛾 — 場上【火】能量改附給自身（待實作）
]);

/**
 * 詢問玩家是否使用「從備戰區放置於戰鬥場時」的特性。
 * 仿 askUsePlayAbility / askUseRetreatToBenchAbility pattern。
 */
export function askUsePromoteActiveAbility(
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
    effectKey: 'resolve-promote-active-ability-prompt',
    params: {
      label: `${cardName} 上場：是否使用「${abilityName}」特性？`,
      options: [
        { id: 'yes', text: '✅ 使用特性' },
        { id: 'no', text: '❌ 不使用' },
      ],
      abilityKey,
      targetIid: inst.iid,
    },
  });
}

// resolve-promote-active-ability-prompt resolver — 玩家選 yes 後執行對應 ABILITY_EFFECTS
regR('resolve-promote-active-ability-prompt', (state, actorIdx, selectedIids, params, pool) => {
  const choice = selectedIids[0] ?? 'no';
  if (choice !== 'yes') return state;
  const abilityKey = params?.abilityKey as string;
  const targetIid = params?.targetIid as string;
  if (!abilityKey || !targetIid) return state;

  const fn = ABILITY_EFFECTS.get(abilityKey);
  if (!fn) return state;

  const player = state.players[actorIdx];
  // 寶可夢已在 active；fallback 找 bench 防 edge case
  const inst = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid);
  if (!inst) return state;

  // 標記「本回合特性已用」— 卡面「可使用 1 次」限制
  const markedState = updatePlayer(state, actorIdx, pl => ({
    ...pl,
    active: pl.active?.iid === targetIid
      ? { ...pl.active, abilityUsedThisTurn: true }
      : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, abilityUsedThisTurn: true } : c),
  }));

  return fn(markedState, actorIdx, pool, inst);
});

/**
 * 統一 helper：所有「自方換位」(promote bench → active in own turn) 路徑用此 auto-prompt。
 *
 * pIdx = 寶可夢擁有方（換場目標方）。
 * Gate：
 *   - pendingSelection 已存在 → 跳過（避免覆蓋既有 picker）
 *   - active.abilityUsedThisTurn → 跳過（本回合已用過）
 *   - active card 的 abilities 內無 ON_PROMOTE_TO_ACTIVE_ABILITIES 成員 → 跳過
 *   - ABILITY_EFFECTS 未註冊對應 fn → 跳過（特性還沒實裝）
 *
 * 同一寶可夢通常只有 1 個觸發特性，遇到第一個就 return。
 *
 * Caller 必須在 active 已 set 完 + movedToActiveThisTurn=true 後呼叫。
 */
export function tryPromptPromoteActive(
  state: GameState,
  pIdx: 0 | 1,
  pool: Map<string, Card>,
): GameState {
  if (state.pendingSelection) return state;
  const actInst = state.players[pIdx].active;
  if (!actInst || actInst.abilityUsedThisTurn) return state;
  // v5.244：嚴格遵守卡面「從備戰區將這隻寶可夢放置於戰鬥場時」— 必須剛上場才觸發
  if (!actInst.movedToActiveThisTurn) return state;
  const actCard = pool.get(actInst.cardId);
  if (!actCard?.abilities) return state;
  for (let i = 0; i < actCard.abilities.length; i++) {
    const ab = actCard.abilities[i];
    if (!ON_PROMOTE_TO_ACTIVE_ABILITIES.has(ab.name)) continue;
    const abilityKey = `${actCard.name}|${i}`;
    if (!hasAbilityFn(actCard.name, ab.name, i)) continue;
    return askUsePromoteActiveAbility(state, pIdx, actInst, ab.name, abilityKey, actCard.name);
  }
  return state;
}


/**
 * v5.334：判斷一張能量卡是否「提供指定屬性」。
 *   基本能量卡 JSON 無 pokemonType 欄位（null），故須以卡名【X】判定；特殊能量看 pokemonType。
 *   修正多個「場上/身上的【X】能量 ≥N 則 +傷害」條件招式把基本能量數成 0（pokemonType null）
 *   導致 +N 永不觸發的 bug（雷公|電氣墜落、水君|水晶墜落 等）。
 */
export function energyMatchesType(ec: Card | undefined, type: string): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = (ec.name || '').match(/【(.+?)】/);
  if (!m) return false;
  const zh: Record<string, string> = { '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning', '超': 'Psychic', '鬥': 'Fighting', '惡': 'Darkness', '鋼': 'Metal', '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless' };
  return zh[m[1]] === type;
}
