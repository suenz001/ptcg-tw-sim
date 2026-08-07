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
import { CLEAR_ON_EXIT_FLAGS } from '../instance-flags';
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

/**
 * v5.722：copy-attack regPost 統一轉接被借招式的 ATTACK_POST，**傳 action**讓 borrowed 招式的
 *   regPost option 效果（「若希望」洗回/丟棄，如跳躍衝天回牌庫 / 金屬之錘丟鋼）能正確判 yes/no。
 *   原各 copy-attack(耀閃挑戰/揮指/技能大盜/暗黑底牌/欺詐/試著模仿/高傲指令)的 regPost 多漏傳 action
 *   → borrowed regPost 收 action=undefined → 預設 yes → 玩家選否仍被強制執行 option 效果(玩家回報)。
 *   (扮晶晶酒 v3.873 早已傳，現一併收斂到此中央 helper。)
 */
export function copyAttackPostDispatch(
  state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, action?: GameAction,
): GameState {
  const key = state.pendingCopyAttackKey;
  const cleared: GameState = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool, action);
}

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
  scope: 'attacker' | 'any-own' | 'own-bench' | 'hand-rocket-supporter' | 'hand-tool' | 'hand-energy' | 'binary-yes-no' | 'self-counter-stepper' | 'hand-reveal';
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
  verb?: 'discard' | 'return-to-hand' | 'return-to-deck' | 'reveal'; // v6.078 'reveal'=給對手看（不移動卡）
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
  /**
   * v6.078：picker 只顯示「**基本**能量卡」（subtype === 'Basic'）。
   *   用於卡面寫「將…身上附加的任意數量的**基本能量卡**丟棄」的招式（電擊魔獸｜電壓錘）。
   *   ⚠ 與 energyTypeFilter 正交：energyTypeFilter 篩「視為某屬性」（含特殊/古舊/稜鏡），
   *     basicEnergyOnly 篩「卡片本身是基本能量」。同時設定 = 兩者都要滿足。
   *   ⚠ 沒有這個欄位時 regPre 仍會過濾掉特殊能量，但 picker 會**顯示**它們 →
   *     玩家勾了 3 張只丟得掉 2 張、傷害對不上（UI 與引擎不一致）。
   */
  basicEnergyOnly?: boolean;

  /**
   * v6.078：scope='hand-reveal' 專用 —— 「從自己的手牌將**任意數量**的○○**給對手看過後**，
   *   造成…傷害」型招式（雙劍鞘｜劍武備、變隱龍｜鮮豔鞭打）。
   *   ⚠ 這類招式**不移動任何卡**（只揭示），regPre 不可動 hand。
   *   ⚠ 卡面寫「任意數量」→ 必須由玩家挑，**禁自動全展示**：少展示是有意義的選擇
   *     （手牌內容是隱藏資訊，玩家可能不想讓對手知道自己握著幾張）。
   *   ⚠ 揭示 = 公開資訊 → regPre 要用公開 addLog 列出被展示的卡名。
   *   handRevealNames：限定卡名（劍武備）；handRevealSupertype：限定大類（鮮豔鞭打＝寶可夢卡）。
   *   兩者都設時取交集；都不設 = 手牌全部可選。
   */
  handRevealNames?: string[];
  handRevealSupertype?: 'Pokemon' | 'Trainer' | 'Energy';
  /** picker 標題/說明用的中文描述（例：「寶可夢卡」） */
  handRevealLabel?: string;
  /**
   * v5.992：「若希望，付出（丟棄/放回）N 個能量 → 加傷/施加狀態」E-10 語義中央機制。
   * Wilson 官方裁定（金屬之錘 QA 一般化）：
   *   1. opt-in 一律可選（即使能量不足/為 0）；付得出多少付多少 = min(available, N)；
   *      固定加傷/施加狀態「照給全額」（付出與效果為獨立事件）。
   *   2. 設此欄位的招式 scope 必為 'binary-yes-no'：UI 第一段 yes/no；
   *      第二段由 UI 一般化處理（0 可付 → OPTIN_NO_PAYMENT sentinel；
   *      可付 ≤ N（或 N=null 全部）→ 自動全付；可付 > N → picker 強制選恰 N）。
   *   3. 引擎端 regPre/regPost 一律走 effects.ts resolveOptInPayment()，
   *      內含「opt-in 未足額自動補足」公平性防護（禁逐卡手刻 sentinel 分支）。
   */
  optInPay?: OptInPaySpec;
}

/** v5.992 見 PreDiscardSpec.optInPay */
export interface OptInPaySpec {
  /** 卡面「N 個」；null = 全部（時間爆炸/叢林鞭打/狂暴噴射） */
  payMax: number | null;
  /** 付出來源（目前僅支援攻擊方自身能量；擴充其他 scope 時同步 resolveOptInPayment） */
  scope: 'attacker';
  /** 付出動作；預設 'discard'。'return-to-deck' 會重洗牌庫 */
  verb?: 'discard' | 'return-to-hand' | 'return-to-deck';
  /** 只計「視為該屬性」的能量（host-aware energyProvidesType） */
  energyTypeFilter?: PreDiscardSpec['energyTypeFilter'];
  /** 'units'：卡面「N 個」以能量單位計（火箭隊=2 等）；預設 'cards' */
  countMode?: 'cards' | 'units';
}

/** v5.992 opt-in 但無可付能量時 UI 送出的 sentinel */
export const OPTIN_NO_PAYMENT = '__optin_no_payment__';
/** opt-in sentinel 集合（含舊版相容：金屬之錘 v4.46 / 耀閃挑戰借招 / binary yes-token） */
export const OPTIN_SENTINELS = new Set<string>([OPTIN_NO_PAYMENT, '__metal_hammer_no_metal__', '__yaoshan_borrowed_yes__', 'yes-token']);

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
// v5.601：繁茂是否「有效」(holder 未被暗夜羽擊/黏著束縛/初始化消除) 的判定注入點。
//   _shared 為底層不能 import effects/v3001（循環依賴）→ effects.ts 載入時 setBloomEffectiveFn 注入
//   nullification-aware 的 hasBloomOnField；未注入時 fallback raw name 偵測（向後相容）。
let _bloomEffectiveFn: ((state: GameState, ownerIdx: 0 | 1, pool: Map<string, Card>) => boolean) | null = null;
export function setBloomEffectiveFn(fn: (state: GameState, ownerIdx: 0 | 1, pool: Map<string, Card>) => boolean): void {
  _bloomEffectiveFn = fn;
}

// v5.753：on-promote-to-active 特性(金屬之路 等)需查對手特性消除(暗夜羽擊/初始化/黏著束縛)。
//   _shared 為底層不能 import v3001(循環)→ effects.ts 載入時注入「active 位特性是否有效」判定。
//   未注入時 fallback：視為有效(向後相容)。回傳 true=可發動。
let _abilityHolderEffectiveFn: ((state: GameState, inst: CardInstance, card: Card, ownerIdx: 0 | 1, abilityName: string, pool: Map<string, Card>) => boolean) | null = null;
export function setAbilityHolderEffectiveFn(fn: (state: GameState, inst: CardInstance, card: Card, ownerIdx: 0 | 1, abilityName: string, pool: Map<string, Card>) => boolean): void {
  _abilityHolderEffectiveFn = fn;
}

/**
 * v5.998：「選擇N個能量丟棄」型招式(registerSelfDiscardMultiply/ATTACK_PRE_DISCARD_CHOICE)在可丟能量
 *   單位數 availableUnits < spec.min 時的有效最小丟棄數 = min(spec.min, availableUnits)。依官方 Q&A
 *   (黃玉伏特:附璀璨結晶減費/被扮晶晶酒複製,身上不足N能量→丟光現有、無條件傷害照給),丟棄是「招式效果」
 *   非「使用成本」,不足額不阻擋招式。UI 的 confirm/minOk gate 用此避免湊不滿N被卡住。
 */
export function effectivePreDiscardMin(spec: PreDiscardSpec, availableUnits: number): number {
  return Math.min(spec.min, Math.max(0, availableUnits));
}

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
    const bloomActive = _bloomEffectiveFn
      ? _bloomEffectiveFn(state, ownerIdx, pool)
      : [...(owner.active ? [owner.active] : []), ...owner.bench].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '繁茂'));
    if (bloomActive) return 2;
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
 * v5.541：改為委派 getEnergyDiscardUnits → 火箭隊能量=2、燃火能量(附進化)=3、新衝天(Stage2)=2、
 * 繁茂草(傳 state+ownerIdx 時)=2；其餘=1。host-aware 單一來源。
 */
// v5.834：對手/自身特殊狀態「跨三槽」讀取中央 helper（狀態自 v5.295 起 status/secondaryStatus/
//   tertiaryStatus 三槽，傷害狀態[中毒/灼傷]可能落在任一槽）。所有「若[狀態]則增傷/失敗」與
//   「特殊狀態數量×N」的招式一律走此 helper，杜絕只讀 1~2 槽的漏判。
export function hasStatusInAnySlot(
  inst: CardInstance | null | undefined,
  condition: SpecialCondition | readonly SpecialCondition[],
): boolean {
  if (!inst) return false;
  const conds = Array.isArray(condition) ? condition : [condition];
  return conds.includes(inst.status as SpecialCondition)
    || conds.includes(inst.secondaryStatus as SpecialCondition)
    || conds.includes(inst.tertiaryStatus as SpecialCondition);
}
/** 特殊狀態「個數」（三槽中非空的數量，0~3）。用於「特殊狀態的數量×N」型招式。 */
export function countSpecialConditions(inst: CardInstance | null | undefined): number {
  if (!inst) return 0;
  return (inst.status ? 1 : 0) + (inst.secondaryStatus ? 1 : 0) + (inst.tertiaryStatus ? 1 : 0);
}

export function countAttachedEnergyAsUnits(
  host: CardInstance,
  pool: Map<string, Card>,
  state?: GameState,
  ownerIdx?: 0 | 1,
): number {
  // v5.541：收斂為「逐能量呼叫 getEnergyDiscardUnits（host-aware 單一來源）」。
  //   原本只算「新衝天能量 on Stage2 = 2」，漏算 燃火能量（附進化=3）/ 火箭隊能量（=2）。
  //   玩家報：青木的土龍節節ex|職務猛攻（擲與附加能量數相同次數）沒把燃火能量算 3 個。
  //   getEnergyDiscardUnits 統一處理：燃火(進化3/否則1)、火箭隊(2)、新衝天(Stage2=2)、
  //   稜鏡/古舊/基本(1)，並在傳入 state+ownerIdx 時套用「大竺葵|繁茂」基本草×2。
  let count = 0;
  for (const e of host.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec || ec.supertype !== 'Energy') continue;
    count += getEnergyDiscardUnits(e.cardId, host, pool, state, ownerIdx);
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

// v5.991：runtime 特性註冊自檢網 — 對戰頁載入後抽測數個「核心主動特性」是否已註冊。
//   任一 miss = effects 註冊不完整(SW 供舊 chunk / chunk 載入失敗 / module-init 循環相依 TDZ),
//   會造成「場上寶可夢的特性按鈕靜默消失」(玩家回報:神奇糖果進化黑夜魔靈當回合咒詛炸彈按鈕沒出現)。
//   sentinel 皆為 effects.ts 核心自身昏厥特性,任一 miss 幾乎代表整個 effects 核心註冊未完成。
const ABILITY_REGISTRY_SENTINELS: Array<[string, string, number]> = [
  ['黑夜魔靈', '咒詛炸彈', 0],
  ['彷徨夜靈', '咒詛炸彈', 0],
  ['三合一磁怪', '過度放電', 0],
];
export function selfCheckAbilityRegistry(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [cn, an, idx] of ABILITY_REGISTRY_SENTINELS) {
    if (!hasAbilityFn(cn, an, idx)) missing.push(`${cn}｜${an}`);
  }
  return { ok: missing.length === 0, missing };
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
 * v5.919 火箭隊能量 附著限制中央 sweep — 卡面「這張卡只可附於『火箭隊的寶可夢』身上,
 *   若附於『火箭隊的寶可夢』以外的寶可夢身上,則將其丟棄」。
 *   原僅手動附加(SPECIAL_ENERGY_ATTACH hook)檢查;效果移動(手持循環扇/能量轉移/小灰怪招式/
 *   進化改名等)漏 → 中央 sweep:對玩家 idx 的 active+bench,host 名稱不含「火箭隊的」→
 *   其身上所有「火箭隊能量」移到棄牌區。idempotent(無違規回原 state);dispatcher 末端雙邊呼叫。
 *   注意:富裕能量/感應【超】能量 的 attach hook 是「福利」(抽4/搜尋)非限制,不可在此重觸發,
 *   故本 sweep 只針對「火箭隊能量」這種『附非法對象即丟棄』的限制型特殊能量。
 */
export function discardIllegalRocketEnergy(
  state: GameState, idx: 0 | 1, pool: Map<string, Card>,
): GameState {
  const p = state.players[idx];
  const removed: CardInstance[] = [];
  const isRocketEnergy = (e: CardInstance): boolean => pool.get(e.cardId)?.name === '火箭隊能量';
  const scrub = (inst: CardInstance | null): CardInstance | null => {
    if (!inst) return inst;
    const hostName = pool.get(inst.cardId)?.name ?? '';
    if (hostName.includes('火箭隊的')) return inst; // 合法 host,保留
    const illegal = inst.energyAttached.filter(isRocketEnergy);
    if (illegal.length === 0) return inst;
    removed.push(...illegal);
    return { ...inst, energyAttached: inst.energyAttached.filter(e => !isRocketEnergy(e)) };
  };
  const active = scrub(p.active);
  const bench = p.bench.map(b => scrub(b) as CardInstance);
  if (removed.length === 0) return state;
  let s = updatePlayer(state, idx, pl => ({ ...pl, active, bench, discard: [...pl.discard, ...removed] }));
  s = addLog(s, `火箭隊能量：附於非「火箭隊的寶可夢」身上 → 丟棄 ${removed.length} 張`, idx);
  return s;
}

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
//   3) ⚠**不要**在 engine.ts 的「特性可用性 gate」隱藏按鈕（v6.049 更正，原第 3 條寫反了）。
//      Wilson 裁定：監視之眼擋的是「改放傷害指示物」這個**效果**，特性本身沒有被消除 ——
//      持有者仍然是「擁有特性的寶可夢」（例如仍會被雪妖女｜冰冷之帳打到），
//      特性也照樣可以發動，只是發動後效果被擋下而失效（regA 入口會 log 原因）。
//      把按鈕藏起來會讓玩家誤以為特性被消除了。
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
 * v5.947 標記「本 action 中因『移動/改放傷害指示物』(非治療)而減少傷害的來源寶可夢 iid」。
 * markHealsByDamageDecrease(engine) 會跳過這些 iid,不誤標 healedThisTurn(活潑刀/活潑鮮花/活潑針
 * 的「本回合恢復HP」條件)。⚠通則:任何「移放/改放傷害指示物」效果(特性/招式/物品)在減少來源
 * damage 時一律呼叫此 helper — 移動指示物 ≠ 恢復HP(卡面權威)。
 */
export function markDamageCounterMovedFrom(state: GameState, ...iids: string[]): GameState {
  const prev = state._counterMoveSrcIids ?? [];
  const add = iids.filter(i => !!i && !prev.includes(i));
  if (add.length === 0) return state;
  return { ...state, _counterMoveSrcIids: [...prev, ...add] };
}

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
 * ══ M6 傳說競技場（一張卡由兩張實體卡拼成）中央述詞 ══════════════════════
 *
 * ⚠ 依 hasOakEye(上方) 的既有慣例：**用字面值比對卡名**，不要從
 *   `effects/cards/stadiums.ts` import —— 那個檔已經 import 自本檔，會循環相依。
 *
 * 三張競技場（卡面逐字取自 static/cards/M6.json 的 rulesText）：
 *   ・傳說的海溝  ：雙方的所有寶可夢恢復HP時，恢復的HP改為2倍。
 *   ・傳說的山頂  ：雙方的【無】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，被獲得的獎賞卡減少1張。
 *   ・傳說的熔岩洞：雙方場上所有進化寶可夢的特性全部消除。
 */
export const LEGEND_STADIUM_NAMES = new Set<string>([
  '傳說的海溝', '傳說的山頂', '傳說的熔岩洞',
]);

/** 目前場上競技場的卡名（沒有競技場則 undefined）。 */
export function getActiveStadiumName(
  state: GameState | undefined, pool: Map<string, Card> | undefined,
): string | undefined {
  if (!state || !pool) return undefined;
  const st = state.activeStadium;
  if (!st) return undefined;
  return pool.get(st.cardId)?.name;
}

/** 場上是否為指定名稱的競技場。 */
export function isStadiumActive(
  state: GameState | undefined, pool: Map<string, Card> | undefined, name: string,
): boolean {
  return getActiveStadiumName(state, pool) === name;
}

/**
 * 卡面「若場上有名稱中有『傳說』的競技場卡」（蓋歐卡｜狂暴漩渦、固拉多｜狂暴大地、
 * 小楓與小南的修行 共用）。
 * ⚠ 逐字對齊卡面用 `includes('傳說')`，**不要**改成枚舉 LEGEND_STADIUM_NAMES ——
 *   卡面判準就是「名稱中有『傳說』」，日後新卡自動涵蓋。
 */
export function hasLegendStadiumInPlay(
  state: GameState | undefined, pool: Map<string, Card> | undefined,
): boolean {
  return (getActiveStadiumName(state, pool) ?? '').includes('傳說');
}

/**
 * 傳說的山頂：被 KO 者是【無】寶可夢且**因對手的寶可夢招式傷害**昏厥 → 獎賞 −1。
 * 回傳要疊加到 prizeAdjust 的值（0 或 -1）。
 *
 * ⚠ 卡面「受到對手的寶可夢招式的**傷害**而【昏厥】」→ 只有招式傷害 KO 算：
 *   ・受傷反擊造成的 KO **不算**（反擊非招式，v5.981 Wilson 裁定）
 *   ・中毒／灼傷 checkup KO、放傷害指示物等效果 KO **都不算**（koByAttackDamage=false）
 * ⚠ 卡面寫「**雙方的**【無】寶可夢」→ 兩邊被 KO 都適用，不分持有者。
 */
export function legendPeakPrizeReduction(
  state: GameState | undefined,
  koCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
  koByAttackDamage: boolean,
): number {
  if (!koByAttackDamage) return 0;
  if (koCard?.pokemonType !== 'Colorless') return 0;
  return isStadiumActive(state, pool, '傳說的山頂') ? -1 : 0;
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

/**
 * v5.539 中央收斂：「從手牌將能量附於寶可夢」後，觸發對手的被動反應（一勞永逸）。
 * 所有「從手牌附能」路徑——手動 ATTACH_ENERGY、以及各種以特性/招式從手牌填能
 * （碧綠之舞 / 固拉多|充溢之力 / 卡比獸|吃飽先 / 葉伊布|嫩葉之恩 / 熟成充能 / 岩石武裝 …）
 * ——在附完能量後都應呼叫此函式，避免漏觸發對手反應（玩家報：耿鬼ex|侵蝕詛咒 對特性填能沒生效）：
 *   ① OPP_ENERGY_ATTACH_PASSIVE（對手場上被動特性，如 耿鬼ex|侵蝕詛咒：在那隻寶可夢放 2 個傷害指示物）
 *   ② 帕奇利茲|麻痺門牙（target 有 paralyzeFangPending → 放 8 個傷害指示物 = +80 點）
 * 註：白日夢 endTurnOnOppAttachEnergy 需呼叫 END_TURN（engine 專屬，_shared 不能 import engine 避免循環），
 *     留在引擎手動 ATTACH_ENERGY 路徑；特性填能觸發白日夢屬罕見組合，暫不在此處理。
 * @param attacherIdx 附能方（其寶可夢得到能量）；對手 = 1 - attacherIdx
 * @param targetIid   得到能量的寶可夢 iid（在 attacherIdx 場上）
 */
export function fireOnHandEnergyAttached(
  state: GameState, attacherIdx: 0 | 1, targetIid: string, pool: Map<string, Card>,
): GameState {
  let s = state;
  // ① 對手場上被動特性（侵蝕詛咒 等）
  const opp = s.players[(1 - attacherIdx) as 0 | 1];
  const oppField: CardInstance[] = [...(opp.active ? [opp.active] : []), ...opp.bench];
  // v5.725：同名被動特性「疊加」——卡面「只要這隻寶可夢在場上…」是針對每一個持有者
  //   各自獨立觸發（同雪妖女｜冰冷之帳：場上 N 張 → 效果 ×N）。原以「特性名」全域 Set
  //   去重 → 場上 2 張耿鬼ex 的侵蝕詛咒只觸發 1 次（只放 20 應 40），玩家回報的 bug。
  //   改為「每個持有者實體」各觸發一次；僅在「同一張卡重複列同名特性」時於該卡內去重，
  //   避免單卡重複（卡資料正常不會重列，純防呆）。比照 PASSIVE_ATTACK_BONUS 的疊加原則
  //   （預設疊加，唯明文「不重複」者才 dedup）。OPP_ENERGY_ATTACH_PASSIVE 目前僅侵蝕詛咒，
  //   屬「每張各自生效」型，無「不重複」白名單需求。
  for (const inst of oppField) {
    const card = pool.get(inst.cardId);
    if (!card?.abilities) continue;
    const firedOnThisInst = new Set<string>();  // 僅卡內去重（防單卡重列同名）
    for (const ab of card.abilities) {
      if (firedOnThisInst.has(ab.name)) continue;
      const fn = OPP_ENERGY_ATTACH_PASSIVE.get(ab.name);
      if (!fn) continue;
      firedOnThisInst.add(ab.name);
      s = fn(s, (1 - attacherIdx) as 0 | 1, attacherIdx, targetIid, pool);
    }
  }
  // ② 帕奇利茲|麻痺門牙（target 有 paralyzeFangPending → +80）
  const me = s.players[attacherIdx];
  const tgt = me.active?.iid === targetIid ? me.active : me.bench.find((c) => c.iid === targetIid);
  if (tgt?.paralyzeFangPending) {
    const tName = pool.get(tgt.cardId)?.name ?? '?';
    const upd = (c: CardInstance): CardInstance =>
      c.iid === targetIid ? { ...c, damage: (c.damage ?? 0) + 80 } : c;
    s = updatePlayer(s, attacherIdx, (pl) => ({
      ...pl, active: pl.active ? upd(pl.active) : pl.active, bench: pl.bench.map(upd),
    }));
    s = addLog(s, `麻痺門牙：${tName} 因附加能量被放 8 個傷害指示物（+80 點）`, attacherIdx);
  }
  return s;
}

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
// v5.608 中央：「自己的最初回合」判定。
//   ⚠ state.turn 只在「後攻方 END_TURN」才 +1 → turn===1 涵蓋『雙方各自的第 1 個動作回合』
//   (先攻第1 + 後攻第1)。卡面「無法在自己的最初回合使用」要擋雙方第1回合 → 用 turn===1。
//   ❌ 不可用 state.isFirstTurn(那只涵蓋『先攻方第1動作回合』,後攻方第1回合已是 false → 會漏)。
export function isOwnFirstTurn(state: GameState): boolean {
  return state.turn === 1;
}

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
  byDamage: boolean = true, // v5.926 是否「因招式的傷害」昏厥（效果KO=false）→ 復仇家族只算 true
): GameState {
  // 自 KO：攻擊方 KO 自己的寶可夢（咒詛炸彈自爆等） — 不算入「對手主動 KO 我方」
  if (state.activePlayerIndex === victimIdx) return state;
  const isRocket = victimCard?.supertype === 'Pokemon'
    && (victimCard.name?.startsWith('火箭隊的') ?? false);
  // v5.274 赫普家族 — 給「赫普的朽木妖|恐怖復仇」用 (卡面只計「赫普的」KO)
  const isHop = victimCard?.supertype === 'Pokemon'
    && (victimCard.name?.startsWith('赫普的') ?? false);
  // v5.928 阿響家族 — 給「阿響的凱羅斯|一力反攻」用(卡面只計「阿響的」KO)
  const isAxiang = victimCard?.supertype === 'Pokemon'
    && (victimCard.name?.startsWith('阿響的') ?? false);
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
  // v5.926 傷害KO專屬計數（復仇刀鋒等「因招式的傷害而昏厥」用）— 只在 cause=attack 且 byDamage 時 ++
  if (cause === 'attack' && byDamage) {
    const curD = s.oppDamageKOdMeThisTurn ?? [0, 0];
    const nextD: [number, number] = [curD[0], curD[1]];
    nextD[victimIdx]++;
    s = { ...s, oppDamageKOdMeThisTurn: nextD };
    if (isHop) {
      const curDH = s.oppDamageKOdMyHopThisTurn ?? [0, 0];
      const nextDH: [number, number] = [curDH[0], curDH[1]];
      nextDH[victimIdx]++;
      s = { ...s, oppDamageKOdMyHopThisTurn: nextDH };
    }
    if (isAxiang) {
      const curDA = s.oppDamageKOdMyAxiangThisTurn ?? [0, 0];
      const nextDA: [number, number] = [curDA[0], curDA[1]];
      nextDA[victimIdx]++;
      s = { ...s, oppDamageKOdMyAxiangThisTurn: nextDA };
    }
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
  // v6.084：「兩張合一」競技場離場時**兩張一起**進棄牌區。
  //   ⚠ 這是全站唯一的競技場離場中央出口（v6.084 把 v2500 的手刻 inline 也收斂進來），
  //     漏處理 partner ＝ 第二張卡憑空蒸發（卡片守恆破損）。
  //     守衛：test-legend-stadium-two-card.mjs 的 totalCards ＋ v6.085 起 test-iid-integrity-conservation
  //     的全域去重也涵蓋 activeStadium/activeStadiumPartner。
  const leaving = [stadium, ...(state.activeStadiumPartner ? [state.activeStadiumPartner] : [])];
  players[ownerIdx] = {
    ...players[ownerIdx],
    discard: [...players[ownerIdx].discard, ...leaving],
  };
  return {
    ...state,
    players,
    activeStadium: undefined,
    activeStadiumPartner: undefined,
    activeStadiumOwnerIdx: undefined,
    stadiumUsedThisTurn: undefined,
  };
}

/**
 * v6.084「兩張合一」競技場（M6 傳說的海溝／山頂／熔岩洞）。
 *
 * Wilson 裁定：牌組中兩張實體卡各算 1 張；**手牌要同時有兩張**才能打出；
 * 場上顯示兩張合併後的背景圖。
 *
 * ⚠ 判準用「卡名含『傳說』」而非硬編三張：卡面的分類依據就是名稱，未來新卡自動涵蓋。
 *   與 `LEGEND_STADIUM_NAMES` / 牌組層 `TWO_CARD_STADIUM_NAMES` 由
 *   `scripts/test-two-card-stadium.mjs` 守衛三份一致。
 */
/**
 * v6.093「傳說」競技場：**左右各是一張獨立的卡片**（Wilson 2026-08-01 裁定）
 *   「傳說的山頂(左) 當作編號073那張、傳說的山頂(右) 當作編號074那張，
 *     等於完全就當成是2張牌來處理」
 *
 * 官方 collectorNumber（`static/cards/M6.json`，唯一權威）本來就標成兩個編號：
 *   傳說的海溝 071/076 + 072/076 ／ 傳說的山頂 073/076 + 074/076 ／ 傳說的熔岩洞 075/076 + 076/076
 *
 * ⭐ **卡名刻意維持相同**（兩筆都叫「傳說的山頂」）——
 *   這讓三個場地效果 hook、reg key、官方「同名卡最多 4 張」規則全部自動保持正確，
 *   左右改由 **cardId** 區分。左半沿用原本的 id，右半是新增的 id
 *   （舊牌組存的正是左半 id → 遷移時只要把一半換成右半即可）。
 */
export const TWO_CARD_STADIUM_PAIR_IDS: Readonly<Record<string, string>> = {
  '19621': '19624', '19624': '19621',   // 傳說的海溝   071/076 ↔ 072/076
  '19622': '19625', '19625': '19622',   // 傳說的山頂   073/076 ↔ 074/076
  '19623': '19626', '19626': '19623',   // 傳說的熔岩洞 075/076 ↔ 076/076
};
/** 左半的 cardId（＝編號較小的那張、也是舊牌組存的那個 id） */
export const TWO_CARD_STADIUM_LEFT_IDS: ReadonlySet<string> = new Set(['19621', '19622', '19623']);

/** 這張卡的另一半是哪個 cardId；不是兩張合一競技場則回 null */
export function twoCardStadiumPartnerCardId(cardId: string | undefined | null): string | null {
  if (!cardId) return null;
  return TWO_CARD_STADIUM_PAIR_IDS[cardId] ?? null;
}
/** 這張卡是左半(0)還是右半(1)；不是兩張合一競技場則回 null */
export function twoCardStadiumSide(cardId: string | undefined | null): 0 | 1 | null {
  if (!cardId || !(cardId in TWO_CARD_STADIUM_PAIR_IDS)) return null;
  return TWO_CARD_STADIUM_LEFT_IDS.has(cardId) ? 0 : 1;
}

/**
 * v6.094 建局入口的 fail-safe：把「舊格式的傳說競技場 entry」（只有左半 id、N 張）
 * 攤成左 ⌈N/2⌉ ＋ 右 ⌊N/2⌋。
 *
 * ⚠ 為什麼引擎端也要有一份：`migrateDeck`（牌組層）只掛在玩家「載入自己的牌組」那條路徑上，
 *   但**錦標賽報名時存下來的 deckEntries 快照**與**線上房間 seats[].deckEntries**都是繞過它的
 *   —— v6.093 上線前報名、上線後開打的賽事會拿舊格式建局，那副牌組就永遠打不出傳說競技場。
 *   在 createGame 這個雙方共同咽喉點再攤一次（冪等）即可 fail-safe。
 */
export function splitTwoCardStadiumDeckEntries<T extends { cardId: string; count: number }>(entries: T[]): T[] {
  const out: T[] = [];
  for (const e of entries) {
    const partnerId = TWO_CARD_STADIUM_LEFT_IDS.has(e.cardId) ? TWO_CARD_STADIUM_PAIR_IDS[e.cardId] : null;
    // 已經有右半（＝已攤過）／本身就是右半／張數異常 → 原樣保留，保持冪等
    if (!partnerId || entries.some(x => x.cardId === partnerId) || e.count <= 0) { out.push(e); continue; }
    const left = Math.ceil(e.count / 2);
    out.push({ ...e, count: left });
    if (e.count - left > 0) out.push({ ...e, cardId: partnerId, count: e.count - left });
  }
  return out;
}

export function isTwoCardStadiumName(name: string | undefined | null): boolean {
  return !!name && LEGEND_STADIUM_NAMES.has(name);
}

/**
 * v6.084：手牌是否湊得出一套「兩張合一」競技場（同 cardId ≥ 2 張）。
 * ⚠ engine 的兩個消費點（PLAY_TRAINER handler、getPlayableTrainers）**必須同 commit** 都改，
 *   本專案多次事故：只改一端 → 卡片列得出來但點了無效／或反過來。
 */
/**
 * v6.086「兩張合一」競技場的**手牌顯示**用：這張 instance 該畫左半還是右半的卡圖。
 *
 * 官方三張傳說競技場只提供**一張合併橫圖**（767×536 ≈ 兩張直卡並排，Wilson 已確認三張皆同）。
 * Wilson 裁定：**手牌裡就跟其他卡一樣是兩張直立的卡**，合併橫圖只是「放到場地區之後」的樣子。
 * → 手牌用 CSS 把同一張橫圖裁左半／右半，兩張各顯示一半 = 零新圖片資源。
 *
 * 回傳 0（左半）/ 1（右半）/ null（不是兩張合一卡 → 照原樣整張顯示）。
 * ⚠ 依「同 cardId 在該區的出現序」決定左右，不寫進 CardInstance —— 純顯示邏輯，
 *   不動資料層就不會經過序列化／回放／toBareCard 等泛用路徑（v6.000 教訓）。
 * ⚠ 桌機／手機／回放三處手牌渲染共用這一份，避免三端各寫一套又漂移。
 */
export function twoCardStadiumHalfIndex(
  zone: { iid: string; cardId: string }[] | undefined,
  iid: string,
  pool: Map<string, Card> | undefined,
): 0 | 1 | null {
  if (!zone || !pool) return null;
  const target = zone.find(c => c.iid === iid);
  if (!target) return null;
  if (!isTwoCardStadiumName(pool.get(target.cardId)?.name)) return null;
  // ⭐ v6.093：左右已經是兩張不同的卡（不同 cardId）→ 直接由 cardId 判定，最權威。
  const sideById = twoCardStadiumSide(target.cardId);
  if (sideById !== null) return sideById;
  // v6.090 舊局：實體卡上的持久 stadiumHalf（拆卡之前建立的對局）。
  const half = (target as { stadiumHalf?: 0 | 1 }).stadiumHalf;
  if (half === 0 || half === 1) return half;
  const pos = zone.filter(c => c.cardId === target.cardId).findIndex(c => c.iid === iid);
  return pos < 0 ? null : ((pos % 2) as 0 | 1);
}

/**
 * v6.090 依「牌組內出現序」給每張兩張合一競技場指派左右身分（左=0、右=1 交錯）。
 * ⭐ 只在 createGame 建牌組時呼叫一次（洗牌**之前或之後都可以**，身分寫在實體卡上）。
 *   Wilson 對牌組編輯器的指示也是同一條規則：「依據編號分為左邊那張與右邊那張」。
 * ⚠ 冪等：已經有 stadiumHalf 的不覆蓋。
 */
export function assignTwoCardStadiumHalves(
  insts: CardInstance[],
  pool: Map<string, Card> | undefined,
): CardInstance[] {
  if (!pool) return insts;
  const seen = new Map<string, number>();
  return insts.map(inst => {
    if (!isTwoCardStadiumName(pool.get(inst.cardId)?.name)) return inst;
    // ⭐⭐ v6.094（Fable 5 審 v6.093 抓到的真 bug）：卡片已經拆成左右兩張之後，這裡**絕對不能再指派**。
    //   否則「手上兩張都是左半(19621)」會被標成 stadiumHalf 0 和 1 → findTwoCardStadiumPair 的
    //   legacy 分支命中 → 兩張左半被當成一套打出去，正是這一版最想擋的東西。
    //   ⇒ `stadiumHalf` 從此只代表「拆卡之前建立的舊局」，legacy 分支只服務那些對局。
    if (twoCardStadiumPartnerCardId(inst.cardId)) return inst;
    if (inst.stadiumHalf === 0 || inst.stadiumHalf === 1) return inst;
    const n = seen.get(inst.cardId) ?? 0;
    seen.set(inst.cardId, n + 1);
    return { ...inst, stadiumHalf: (n % 2) as 0 | 1 };
  });
}

/**
 * v6.090 從手牌裡找出「一左一右」的配對；找不到回 null（＝不可打出）。
 * ⭐ Wilson 裁定：要**同時一左一右**才能放到場上。手上兩張都是左半 → 不可打出。
 * ⚠ 舊存檔／版本 skew（沒有 stadiumHalf）→ fail-open 回退舊判準「同 cardId 有 2 張以上」，
 *   否則舊 client 建的局會突然打不出來。
 */
export function findTwoCardStadiumPair<T extends { iid: string; cardId: string; stadiumHalf?: 0 | 1 }>(
  hand: T[], cardId: string,
): { left: T; right: T } | null {
  // ⭐ v6.093：左右是兩張不同的卡 → 找手上有沒有「另一半那張卡」。
  const partnerId = twoCardStadiumPartnerCardId(cardId);
  if (partnerId) {
    const self = hand.find(c => c.cardId === cardId);
    const partner = hand.find(c => c.cardId === partnerId);
    if (self && partner) {
      return twoCardStadiumSide(cardId) === 0 ? { left: self, right: partner } : { left: partner, right: self };
    }
    // ⚠ 找不到另一半時**不要**直接 return null —— v6.093 拆卡之前建立、還在進行中的對局
    //   手上是「同一個 cardId 兩張 ＋ stadiumHalf」，直接 return 會讓那些對局突然打不出來。
    //   往下走 legacy 分支。
  }
  // v6.090 舊局（拆卡之前建立的對局）：同一個 cardId ＋ 實體卡上的 stadiumHalf。
  const same = hand.filter(c => c.cardId === cardId);
  if (same.length < 2) return null;
  const left = same.find(c => c.stadiumHalf === 0);
  const right = same.find(c => c.stadiumHalf === 1);
  if (left && right) return { left, right };
  // ⚠ 「同一個 cardId 兩張、且都沒有 stadiumHalf」只有在**這張卡不在 v6.093 的左右對照表裡**時
  //   才 fail-open —— 否則新模型下「手上兩張都是左半(071)」會被誤判成可以打出。
  if (!twoCardStadiumPartnerCardId(cardId) && same.every(c => c.stadiumHalf !== 0 && c.stadiumHalf !== 1)) {
    return { left: same[0], right: same[1] };
  }
  return null;
}

export function canPlayTwoCardStadium(
  hand: { iid: string; cardId: string; stadiumHalf?: 0 | 1 }[],
  cardId: string,
): boolean {
  // v6.090：改判「手上有一左一右」（Wilson 裁定）。舊局無身分時 findTwoCardStadiumPair 會 fail-open。
  return findTwoCardStadiumPair(hand, cardId) !== null;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * v6.124：卡面「（將那些卡翻回反面並重洗，）放回牌庫下方」的**唯一**管線。
 *
 * ⚠ 這條規則的關鍵在**重洗的範圍**。卡面重洗的主詞是「那些卡」（剛剛查看過的那幾張、
 *   剛剛收回的那幾張手牌），所以只有 `toBottom` 這幾張要被打亂，
 *   **牌庫其餘部分（`rest`）的順序必須原封不動**。
 *
 *   寫成 `shuffle([...rest, ...toBottom])` 是把**整副牌庫**洗掉 —— 那是另一條規則
 *   （「放回牌庫並重洗」，例如從牌庫搜尋之後的重洗），兩者不可混用。差別是玩家看得見的：
 *   玩家可能已經藉由其他效果（查看牌庫頂、重排牌庫）知道牌庫下層的順序，多洗一次
 *   等於把那個已知資訊憑空銷毀，也讓「先看牌庫頂、再把不要的放到下方」這類卡失去意義。
 *
 * `mode` 刻意設成必填，強迫呼叫端回去讀卡面再決定：
 *   ・`'shuffled'`   卡面有「重洗／洗亂」字樣（推理組合、越橘的一步棋、霸者咆哮、
 *                    金屬製造者、悟松、妨害信函、彩粉蝶、特殊紅牌、調換票…）
 *   ・`'keep-order'` 卡面只說「放回牌庫下方」，沒有重洗（多龍奇｜偵查指令、海岱、
 *                    胖嘟嘟｜深海抽出、狂歡浪舞鴨｜快節奏）
 *
 * 事故背景：v6.123 修掉推理組合的 `shuffle(rest)`（洗錯邊）後，同維度 audit 又抓到
 *   越橘的一步棋（3 處）與悟松（1 處）把整副牌庫洗掉。收斂成單一 helper 以絕後患。
 */
export function deckWithCardsToBottom<T>(
  rest: readonly T[],
  toBottom: readonly T[],
  mode: 'shuffled' | 'keep-order',
): T[] {
  return [...rest, ...(mode === 'shuffled' ? shuffle([...toBottom]) : [...toBottom])];
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

/**
 * v5.518 中央：道具因「效果觸發」被丟棄到棄牌區時，統一在對戰 log 顯示丟棄的道具名
 *   （參考 v5.515 從手牌丟棄顯示卡名的邏輯，避免玩家不知道道具被丟棄）。
 *   收斂點：倖存鍛鍊器(TOOL_PREVENT_KO)、果實道具(discardOnTrigger 防禦減傷)、
 *           回合結束丟棄道具(TOOL_END_TURN_DISCARD) 等都走它。reason 可選（如「自己回合結束」）。
 */
export function addToolDiscardLog(
  state: GameState, toolInsts: CardInstance[], pool: Map<string, Card>,
  ownerIdx: 0 | 1 | null = null, reason?: string,
): GameState {
  if (!toolInsts || toolInsts.length === 0) return state;
  const names = joinCardNames(toolInsts, pool);
  return addLog(state, reason ? `🔧 ${names} 已丟棄到棄牌區（${reason}）` : `🔧 ${names} 已丟棄到棄牌區`, ownerIdx);
}

export function cardLink(iid: string | undefined | null, displayName: string | undefined | null): string {
  const name = displayName ?? '';
  if (!iid || !name) return name;
  return `\uE100${iid}\uE101${name}\uE102`;
}

/**
 * v5.719：「翻到正面 / 查看牌庫上方 N 張」公開揭示翻開的卡名（雙方可見）。
 *   卡面寫「翻到正面」= 公開資訊，雙方都該看到翻了哪些卡（含沒被選 / 沒翻到的）。
 *   配樂之笛 / 火箭隊的貓老大ex / 鐵荊棘未來迴路 等共用，避免各自只 log 結果不列卡名。
 */
export function revealTopCardsLog(
  state: GameState,
  actorIdx: 0 | 1,
  topCards: CardInstance[],
  pool: Map<string, Card>,
  label: string,
): GameState {
  if (topCards.length === 0) return state;
  const names = topCards.map((c) => pool.get(c.cardId)?.name ?? '?').join('、');
  return addLog(state, `${label}：翻到正面的 ${topCards.length} 張 — ${names}`, actorIdx);
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
 * v5.680：「查看自己牌庫上方 N 張，回復原樣；若希望，將(選定的)那些卡丟棄」型招式的中央入口。
 *   開 deck-search picker（validIids=牌庫頂 N、filter any、min0/maxN）→ 玩家【看見牌面】後選 0~N 張丟棄；
 *   未選的維持原順序留在牌庫頂（符合卡面「回復原樣」，不重洗）。resolver = 'deck-top-reveal-discard'。
 *   取代舊「binary-yes-no 盲選（看不到牌庫頂）」實裝（岩狗狗挖回 / 燭光靈光照燃燒）。
 */
export function openDeckTopRevealOptionalDiscard(state: GameState, idx: 0 | 1, count: number, label: string): GameState {
  const p = state.players[idx];
  if (p.deck.length === 0) return addLog(state, `${label}：牌庫已空`, idx);
  const n = Math.min(count, p.deck.length);
  const topIids = p.deck.slice(0, n).map(c => c.iid);
  return withPending(
    addLog(state, `${label}：查看牌庫上方 ${n} 張`, idx),
    {
      type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'any', minCount: 0, maxCount: n,
      effectKey: 'deck-top-reveal-discard',
      params: { validIids: topIids, label, titleOverride: `${label}：查看牌庫上方 ${n} 張，選擇要丟棄的（可不選＝回復原樣）` },
    },
  );
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
  // v5.531：清除欄位收斂至 instance-flags.ts 的 CLEAR_ON_EXIT_FLAGS 單一來源（原 63 個硬編欄位）。
  //   官方規則：寶可夢從戰鬥場退到備戰區，移除所有特殊狀態與招式效果(含延遲/跨回合)。
  const n = { ...poke } as unknown as Record<string, unknown>;
  for (const k of CLEAR_ON_EXIT_FLAGS) delete n[k as string];
  return n as unknown as CardInstance;
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
    if (clearStatus && (prevTarget.status || prevTarget.secondaryStatus || prevTarget.tertiaryStatus)) {
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
      delete healed.tertiaryStatus;  // v5.728：三重狀態(睡+毒+燒)第三格也要清,卡面「特殊狀態也全部恢復」(與撤退/化石清狀態一致清全三階層)
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
/**
 * v5.625：「場上寶可夢互換成棄牌區寶可夢」(變化之書/鬼之假面)時，換上的新寶可夢 abilityUsedThisTurn 取值。
 * 官方 QA(變化之書)：特性「已使用」狀態以「特性名稱」保留——
 *  - 舊寶可夢本回合沒用過特性 → 新的可用(回 undefined)。
 *  - 舊用過 + 新寶可夢有「同名」特性 → 沿用已使用(回 true，擋；Q3)。
 *  - 舊用過 + 新寶可夢特性「不同名」或無特性 → 新特性尚未使用，可用(回 undefined；Q2)。
 * 原本整包 {...fieldInst} 一律帶 abilityUsedThisTurn=true → 換上的不同特性寶可夢被誤擋。
 */
export function abilityUsedAfterSwap(
  oldInst: { abilityUsedThisTurn?: boolean },
  oldCard: Card | undefined,
  newCard: Card | undefined,
): boolean | undefined {
  if (!oldInst.abilityUsedThisTurn) return undefined;
  const oldNames = new Set((oldCard?.abilities ?? []).map((a) => a.name));
  return (newCard?.abilities ?? []).some((a) => oldNames.has(a.name)) ? true : undefined;
}

export function addPendingPrize(state: GameState, ownerIdx: 0 | 1, n: number, pool: Map<string, Card>): GameState {
  // v5.466 自動給獎賞：取代「累加 pendingPrizes + 手動【取得】鈕」。KO 當下立即把獎賞卡移入手牌，
  //   消除「攻擊方取獎賞 push 與防守方補位 push 重疊」的線上 desync（幻影奇襲多重KO 等）。
  //   ★ 私密 log（v5.452）：本人看到取得哪幾張卡(可點 cardLink)、對手只看張數 — 所有取得獎賞狀況
  //     一律產生此 log（沒有【取得】鈕後，玩家只能靠 log 確認拿到哪張）。pendingPrizes 不再累加(恆 0)。
  if (n <= 0) return state;
  const takerPeek = state.players[ownerIdx];
  const count0 = Math.min(n, takerPeek.prizes.length);
  if (count0 <= 0) return state;  // 無獎賞卡可取（理論上已勝）
  // v5.880：若有「正面朝上」的獎賞卡（克雷色利亞｜弦月光芒 / 火箭隊的妨礙機器人 翻開的），
  //   改開逐張 picker 讓玩家指定要取哪張（卡面用意：知道獎賞內容後可選要不要拿那張已知卡）。
  //   無 faceUp → 維持 v5.466 KO 當下自動取（front），正常對局完全不變、無線上 desync。
  //   實際取獎由 engine 的 take-prize-choose resolver 依 params.remaining 逐張結算。
  if (takerPeek.prizes.some(c => c.faceUp) && !state.pendingSelection) {  // v5.889 已有 pending(mutual/checkup 連KO)→自動取,不開第二個 picker
    // v5.890：蓋著的獎賞彼此對玩家無差異 → 不逐張列 #1/#2/#3,只讓玩家決定要不要取「翻正面」的那幾張,
    //   其餘用單一「隨機取一張蓋著的」選項交給系統代抽(sentinel 與 engine take-prize-choose resolver 一致)。
    const options: { id: string; text: string }[] = [];
    for (const pr of takerPeek.prizes) {
      if (pr.faceUp) options.push({ id: pr.iid, text: `🔆 正面朝上：${pool.get(pr.cardId)?.name ?? '?'}` });
    }
    if (takerPeek.prizes.some(pr => !pr.faceUp)) {
      options.push({ id: '__prize_random_facedown__', text: `🂠 隨機取一張蓋著的獎賞` });
    }
    return {
      ...state,
      pendingSelection: {
        type: 'modal-choice', actorIdx: ownerIdx, sourcePlayerIdx: ownerIdx,
        minCount: 1, maxCount: 1, effectKey: 'take-prize-choose',
        params: { remaining: count0, titleOverride: `取獎賞：還需取 ${count0} 張。可指定翻正面的獎賞,或選「隨機取一張蓋著的」由系統代抽`, options },
      },
    };
  }
  const taker = { ...state.players[ownerIdx] };
  const count = Math.min(n, taker.prizes.length);
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
/**
 * v5.705：把寶可夢/卡片實體「裸化」成乾淨卡牌（回手牌/牌庫用）。白名單只保留 iid + cardId，
 * 丟棄傷害/能量/道具/進化棧/狀態/所有離場旗標。取代各處手動列舉旗標的黑名單（會漂移漏清，
 * 且 PLAY_BASIC 重打用 {...inst} 只覆寫少數欄位、會保留殘留旗標 → 殘留旗標隨重打回到場上）。
 * 附加卡（能量/道具/進化棧的卡）進手牌/牌庫前也應各自 toBareCard。
 */
export function toBareCard(inst: CardInstance): CardInstance {
  // ⚠ v6.090：stadiumHalf 與 fossilOnField 同屬「持久性定義屬性」而非回合旗標，必須保留 —
  //   否則傳說場地卡被洗回牌庫／進棄牌區再回到手上就失去左右身分（顯示與可打出判定都會壞）。
  return {
    iid: inst.iid, cardId: inst.cardId, damage: 0, energyAttached: [],
    ...(inst.stadiumHalf === 0 || inst.stadiumHalf === 1 ? { stadiumHalf: inst.stadiumHalf } : {}),
  };
}

/**
 * v5.745：放置寶可夢到備戰的單一收斂 — 從牌庫/手牌/棄牌放上場一律裸化 + 設 justPlaced:true
 *   (本回合剛上場,同回合不可進化;engine EVOLVE gate basePoke.justPlaced)。過往各 bench-fill
 *   resolver 手刻 {...c, justPlaced:true},部分(呼朋引伴/亮光增長/親送挑戰)漏設 → 放的基礎同回合
 *   可違規進化。非場上區來源本就乾淨,baring 為防呆冪等。
 */
export function placedBenchInstance(card: CardInstance): CardInstance {
  // v5.993：改 toBareCard 白名單裸化(取代黑名單逐欄清) — 原黑名單漏 abilityUsedThisTurn /
  //   cantAttackThisTurn / healedThisTurn / 各 immune*/…ThisTurn/NextTurn 旗標；從棄牌區復活
  //   (KO 進棄牌帶著整組場上旗標)再放備戰時會外洩(特性被誤擋 / 免疫殘留)。白名單不漂移：
  //   新增旗標自動被清。原清除項(damage/energy/tool/extraTools/stack/三槽狀態/_faintByEffect)全涵蓋。
  // v6.000：⚠fossilOnField 是「持久性定義屬性」(化石上場永遠 HP60)非回合旗標,必須保留 — 否則
  //   化石採掘場等走 placedBenchInstance 的化石放置路徑會被 toBareCard 剝掉 → getEffectiveHP=0
  //   (`if(fossilOnField)return 60` 落空)→ 化石顯示 0/0 且 `hp>0` 判 KO 落空致「打不死」(玩家實測)。
  //   (PLAY_FOSSIL 是先 toBareCard 再加 fossilOnField,順序對故未中招;此收斂讓所有 bench 化石路徑一致。)
  return { ...toBareCard(card), justPlaced: true, ...(card.fossilOnField ? { fossilOnField: true } : {}) };
}

/**
 * v5.741：進化後特殊狀態 — 單一來源。PDF §I-A-05「進化後特殊狀態全部消除」,
 *   唯「暈眩山谷」在場且 base 為【混亂】時保留混亂(該卡例外)。回傳可 spread 進
 *   進化體的物件({} = 清除 / {status:'confused'} = 保留)。取代各進化路徑手寫
 *   `status: base.status`(反覆造成進化不解除異常狀態 bug,且漏暈眩山谷例外)。
 */
export function evolvedStatusAfter(
  base: CardInstance,
  state: GameState,
  pool: Map<string, Card>,
): { status?: 'confused' } {
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
  return (stadium === '暈眩山谷' && base.status === 'confused') ? { status: 'confused' } : {};
}

/**
 * v5.984：中央退化建構 — 所有退化效果(奧密之眼/退化光線/阿賽斯特萊石/原始之翼/奇異時鐘)
 *   的單一來源，鏡射 buildEvolvedInstance。官方契約：
 *   ① 保留場上 iid / damage / 能量 / 道具(含 extraTools) — PDF §II-C-13、§6
 *   ② 特殊狀態與附加效果全清(clearActiveEffects,~50旗標)，**唯暈眩山谷例外**：卡面
 *      「雙方的【混亂】的寶可夢，就算進化・退化，【混亂】也不會恢復」→ 複用進化側單一
 *      來源 evolvedStatusAfter(進化/退化兩路徑共享，未來只修一處)
 *   ③ 移除的進化卡各配**全新唯一 iid**(同鏈多次退化不撞 iid，撞了會讓 EVOLVE 以 toIid 找錯卡)
 *   ④ evolvedThisTurn 由 caller 決定：只有卡面明文「退化的寶可夢那個回合無法進化」的自方
 *      退化(奇異時鐘)傳 true；對手退化一律不傳(此 flag 只在當前玩家 END_TURN 清，設在對手
 *      身上會殘留到對手回合誤擋其進化 — v3.9998/v5.497)
 *   不碰 hand/deck、不寫 log、不做免疫 gate(caller 依來源 attack-effect/ability-effect 先 gate)、
 *   不做 KO(退化後超 HP 由 applyAction 末端雙邊 sanityKOSweep 兜底)。
 * @returns null = evolvedFromStack 深度不足 layers(caller 取消並 log，不得部分執行)
 */
export interface DevolveResult {
  devolved: CardInstance;
  removedCards: CardInstance[];
}
export function buildDevolvedInstance(
  target: CardInstance,
  layers: number,
  state: GameState,
  pool: Map<string, Card>,
  opts?: { evolvedThisTurn?: true },
): DevolveResult | null {
  const stack = target.evolvedFromStack ?? [];
  if (layers < 1 || stack.length < layers) return null;
  // 移除卡 = 頂層(當前 cardId) + stack 倒數 layers-1 張
  const removedCardIds: string[] = [target.cardId];
  for (let i = 1; i < layers; i++) removedCardIds.push(stack[stack.length - i].cardId);
  const removedCards: CardInstance[] = removedCardIds.map(cid => ({
    iid: `${target.iid}_devo_${cid}_${Math.random().toString(36).slice(2, 8)}`,
    cardId: cid,
    damage: 0,
    energyAttached: [],
  }));
  const newBase = stack[stack.length - layers];
  const newStack = stack.slice(0, stack.length - layers);
  const devolved: CardInstance = {
    ...clearActiveEffects({ ...target, cardId: newBase.cardId }),
    ...evolvedStatusAfter(target, state, pool),
    evolvedFromStack: newStack.length > 0 ? newStack : undefined,
    evolvedFromIid: newStack.length > 0 ? newStack[newStack.length - 1].iid : undefined,
    evolvedThisTurn: opts?.evolvedThisTurn,
  };
  return { devolved, removedCards };
}

/**
 * v5.742：中央進化體建構 — 所有「直接進化」效果(覺醒/緊急進化/壯偉碩木/早熟進化/
 *   細胞覺醒等)的單一來源,鏡射 engine 正規 EVOLVE。過往各路徑手刻 `const evolved = {...}`
 *   反覆漏:extraTools(進化丟多餘道具=丟卡)、iid:base.iid(身份分歧→退化/取回 dup-iid)、
 *   fossilOnField:false(化石進化殘留)、baseBare 帶 transient flags(v4.20 UI 標籤錯)。
 *   保證:繼承 base 的 iid/damage/能量/道具/extraTools;狀態走 evolvedStatusAfter(暈眩山谷
 *   例外);evolvedFromStack 加入唯一 iid 的裸殼 chain entry;清 transient flags + fossilOnField。
 *   opts.extraDamage:卡面「進化時放 N 傷害指示物」(如夜盜火蟲|怨念進化 +20)。
 */
export function buildEvolvedInstance(
  base: CardInstance,
  evoInst: CardInstance,
  state: GameState,
  pool: Map<string, Card>,
  opts?: { extraDamage?: number },
): CardInstance {
  const prevStack = base.evolvedFromStack ?? [];
  const baseBare: CardInstance = {
    iid: `${base.iid}_base_${base.cardId}_${Math.random().toString(36).slice(2, 8)}`,
    cardId: base.cardId,
    damage: 0,
    energyAttached: [],
    toolAttached: undefined,
    extraTools: [],
    evolvedFromStack: undefined,
  };
  return {
    // v5.993：evoInst 一律先 toBareCard 白名單裸化 — 手牌進化卡可能是「場上用過特性(abilityUsedThisTurn)
    //   /帶 transient 旗標的卡被 KO→棄牌→聖灰等回牌庫→搜回手」而來，spread `...evoInst` 會把
    //   stale 旗標帶進進化體（實例:第二隻黑夜魔靈糖果進化後咒詛炸彈當回合被 abilityUsedThisTurn gate 擋）。
    ...toBareCard(evoInst),
    iid: base.iid,
    damage: base.damage + (opts?.extraDamage ?? 0),
    energyAttached: base.energyAttached,
    toolAttached: base.toolAttached,
    extraTools: base.extraTools,
    ...evolvedStatusAfter(base, state, pool),
    evolvedFromIid: base.iid,
    evolvedFromStack: [...prevStack, baseBare],
    evolvedThisTurn: true,
    justPlaced: false,
    playedFromHand: false,
    fossilOnField: false,
  };
}

/**
 * v5.785：寶可夢身上「傷害指示物的個數」= damage / 10（PTCG 傷害一律 10 的倍數）。
 *   卡面「傷害指示物為 N 個 / 放置有 N 個」是精確個數判定，務必用 === N（非 >= N×10）。
 *   收斂死亡終局 / 藍柱石等「剛好 N 個」條件；「N 個以上」型仍用 >= 比較(各自 helper)。
 */
export function damageCounterCount(inst: CardInstance | null | undefined): number {
  return Math.floor((inst?.damage ?? 0) / 10);
}

export function getAllAttachedTools(inst: CardInstance | null | undefined): CardInstance[] {
  if (!inst) return [];
  const out: CardInstance[] = [];
  if (inst.toolAttached) out.push(inst.toolAttached);
  if (inst.extraTools && inst.extraTools.length > 0) out.push(...inst.extraTools);
  return out;
}

/**
 * v5.934 「無限之影」型 KO 去向判定（中央收斂，所有招式傷害 KO 路徑共用：戰鬥位主傷害 +
 *   備戰狙擊/擴散/延後傷害）。耿鬼｜無限之影：這隻寶可夢受【對手】招式的【傷害】而【昏厥】時，
 *   不丟棄本體，而是連同其「進化來源的實體卡」(evolvedFromStack) 一起放回手牌（各清乾淨＝視同全新卡）；
 *   寶可夢以外的卡（附加能量/道具）全部丟棄。神奇糖果情形 evolvedFromStack 只含實際疊在場上的卡，
 *   故不會生出場上沒有的中間進化（鬼斯→耿鬼跳過鬼斯通 → 只回耿鬼+鬼斯）。
 * @param eligible 是否符合觸發條件（＝受【對手】招式【傷害】KO；自傷/放指示物等非傷害 → false）。
 *   false 或非無限之影 → toHand=[]、toDiscard=本體+能量+道具+進化鏈（與原丟棄行為逐字一致）。
 */
export function resolveInfiniteShadowKo(
  koInst: CardInstance,
  pool: Map<string, Card>,
  eligible: boolean = true,
): { toHand: CardInstance[]; toDiscard: CardInstance[] } {
  const card = pool.get(koInst.cardId);
  const tools = getAllAttachedTools(koInst);
  const stack = koInst.evolvedFromStack ?? [];
  if (eligible && card?.abilities?.some((a) => a.name === '無限之影')) {
    // v6.097：改走中央 splitPokemonReturnToHand（與火箭隊的叉字蝠ex｜刺殺迴旋 同一來源）。
    //   原本此處手刻黑名單 clean（`...cc` 保留其餘欄位）→ 會外洩 abilityUsedThisTurn /
    //   immune*ThisTurn 等回合旗標；改用 toBareCard 白名單（見 v5.993 通則）後一併收乾淨。
    return splitPokemonReturnToHand(koInst);
  }
  return { toHand: [], toDiscard: [koInst, ...koInst.energyAttached, ...tools, ...stack] };
}

/**
 * v5.781：寶可夢實體「連同附加卡放回牌庫/手牌」時，產出所有應一起移動的乾淨卡牌。
 *   主體 + 能量 + 全部道具（toolAttached + extraTools，走 getAllAttachedTools）+ 進化棧，全部 toBareCard。
 *   收斂「bounce to 牌庫」各處手刻字面（過去只取 toolAttached → 漏 extraTools 丟卡、殘留旗標）。
 *   自身 bounce 與對手 bounce 共用單一來源（禁手刻字面）。
 */
export function bareCardsForReturn(inst: CardInstance): CardInstance[] {
  return [
    toBareCard(inst),
    ...inst.energyAttached.map(toBareCard),
    ...getAllAttachedTools(inst).map(toBareCard),
    ...(inst.evolvedFromStack ?? []).map(toBareCard),
  ];
}

/**
 * v6.097：「寶可夢本體（含進化來源實體卡）放回手牌／牌庫，寶可夢以外的卡全部丟棄」的**單一來源**。
 *   卡面措辭範例（static/cards 台灣官方中文）：
 *     ・火箭隊的叉字蝠ex｜刺殺迴旋「若希望，將這隻寶可夢放回手牌。（寶可夢以外的卡全部丟棄。）」
 *     ・耿鬼｜無限之影（受對手招式傷害昏厥時，本體不進棄牌區而回手牌）
 *   ⚠ **必須含 `evolvedFromStack`** —— 進化體回手時底下疊著的實體卡（例：火箭隊的超音蝠／大嘴蝠）
 *   也是「寶可夢卡」，卡面沒有任何讓它們消失的措辭。過去刺殺迴旋只搬最上層 →
 *   進化來源既沒進手牌也沒進棄牌區，**直接從對局消失**（破壞卡片守恆）。
 *   `normalizeNonFieldStacks` 救不了：它只攤平「還掛著 stack 的非場區卡」，
 *   而 stack 在建 mainCard 當下就被丟了。
 *   與 [bareCardsForReturn] 是同一卡集合的兩種去向：toHand ∪ toDiscard === bareCardsForReturn(inst)。
 *   一律走 `toBareCard` 白名單裸化（v5.993 通則：離場進非場區必須清乾淨，避免旗標外洩）。
 */
/**
 * v6.097：「搜尋／挑選出來的卡」的**揭示 log 單一來源**。
 *   站規（v5.859）：卡面寫「在給對手看過後加入手牌」→ **必須公開 addLog 卡名**，
 *   只寫張數（甚至只寫「（已給對手看過）」）都是假揭示；反之卡面**沒有**該句
 *   （例：頭巾混混｜偷竊、賽富豪｜抓到飽 —— 官方卡面只寫「加入手牌」）→
 *   **不可**公開卡名，走 addPrivateLog（自己看得到名稱、對手只看到張數）。
 *   ⚠ `publicReveal` 一律由呼叫端**依卡面逐字判定**後明示傳入，不設預設值 —— 兩個方向
 *   各自都會出錯（該公開的沒公開＝對手資訊短缺；不該公開的公開＝資訊洩漏）。
 * @param label 招式／卡名（顯示在 log 前綴）
 * @param tail  接在後面的敘述，例："加入手牌（牌庫已重洗）"
 */
export function logPickedCards(
  st: GameState,
  idx: 0 | 1,
  picked: CardInstance[],
  pool: Map<string, Card>,
  label: string,
  tail: string,
  opts: { publicReveal: boolean },
): GameState {
  if (picked.length === 0) return addLog(st, `${label}：未選擇任何卡（${tail}）`, idx);
  const names = picked.map((c) => pool.get(c.cardId)?.name ?? '?').join('、');
  if (opts.publicReveal) {
    return addLog(st, `${label}：${names} ${tail}`, idx);
  }
  return addPrivateLog(st, `${label}：${names} ${tail}`, `${label}：${picked.length} 張卡 ${tail}`, idx);
}

export function splitPokemonReturnToHand(
  inst: CardInstance,
): { toHand: CardInstance[]; toDiscard: CardInstance[] } {
  return {
    toHand: [toBareCard(inst), ...(inst.evolvedFromStack ?? []).map(toBareCard)],
    toDiscard: [
      ...inst.energyAttached.map(toBareCard),
      ...getAllAttachedTools(inst).map(toBareCard),
    ],
  };
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
//   - 自方招式的「自身互換」效果 (雀躍 / 介秒迴轉 / 瞬間移動者 / 天空搬運 / h-wave2 等)
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
  '金屬之路',     // 勾帕路翁ex — 場上【鋼】能量改附給自身（holder = 上場那隻）
  '超光速位元',   // 鐵武者ex — 對手 1 隻寶可夢放 2 個傷害指示物（待實作）
  '熱流反應者',   // 鐵毒蛾 — 場上【火】能量改附給自身（待實作）
]);

// v5.908：備戰持有者「當『特定寶可夢』從備戰上場時」觸發型 auto-prompt(holder 在【備戰】,非上場那隻)。
//   拉帝歐斯｜潔淨支援：超級拉帝亞斯ex 上場時觸發,持有者拉帝歐斯留在備戰。Map: 備戰特性名 → 需上場的卡名。
//   ⚠只在「玩家主動把備戰放上戰鬥場」(撤退/換場效果,會呼叫 tryPromptPromoteActive)時彈;KO 補場
//   (SEND_NEW_ACTIVE)不呼叫本 helper→不觸發(卡面「在自己的回合...放置時」,KO 被動補場不算)。
export const ON_ACTIVE_PROMOTE_BENCH_WATCHER = new Map<string, string>([
  ['潔淨支援', '超級拉帝亞斯ex'],
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
      abilityName,        // v5.873：讓 resolver 走 getAbilityFn(by-name),涵蓋 regAByName 特性
      cardName,           // v5.873
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

  // v5.873：改用中央 getAbilityFn(by-name 優先,fallback by-index),涵蓋 regAByName 的 on-promote 特性
  //   (與 resolve-play-ability-prompt v5.872 同款修正)。原只 ABILITY_EFFECTS.get(index) 對 regAByName 拿不到 fn。
  const abilityName = params?.abilityName as string | undefined;
  const cardName = (params?.cardName as string | undefined) ?? abilityKey.slice(0, abilityKey.lastIndexOf('|'));
  const abIdx = parseInt(abilityKey.slice(abilityKey.lastIndexOf('|') + 1), 10) || 0;
  const fn = getAbilityFn(cardName, abilityName ?? '', abIdx) ?? ABILITY_EFFECTS.get(abilityKey);
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
  if (!actCard) return state;
  // v5.908：active 無特性也要往下跑 bench-watcher(潔淨支援 holder 在備戰、上場的超級拉帝亞斯ex 本身無特性)。
  for (let i = 0; i < (actCard.abilities?.length ?? 0); i++) {
    const ab = actCard.abilities[i];
    if (!ON_PROMOTE_TO_ACTIVE_ABILITIES.has(ab.name)) continue;
    const abilityKey = `${actCard.name}|${i}`;
    if (!hasAbilityFn(actCard.name, ab.name, i)) continue;
    // v5.753：對手戰鬥場有振翼髮｜暗夜羽擊(或初始化/黏著束縛)消除我方戰鬥位特性時，
    //   上場時特性(金屬之路 等)也不可發動 — 同 v5.751 on-evolve/on-play 的 isAbilityHolderEffective gate。
    if (_abilityHolderEffectiveFn && !_abilityHolderEffectiveFn(state, actInst, actCard, pIdx, ab.name, pool)) continue;
    return askUsePromoteActiveAbility(state, pIdx, actInst, ab.name, abilityKey, actCard.name);
  }
  // v5.908：備戰持有者觸發型(潔淨支援：超級拉帝亞斯ex 上場時,holder 拉帝歐斯在備戰)。
  for (const [benchAbName, requiredActive] of ON_ACTIVE_PROMOTE_BENCH_WATCHER) {
    if (actCard.name !== requiredActive) continue;
    for (const b of state.players[pIdx].bench) {
      if (b.abilityUsedThisTurn) continue;
      const bCard = pool.get(b.cardId);
      const bi = bCard?.abilities?.findIndex(a => a.name === benchAbName) ?? -1;
      if (!bCard || bi < 0) continue;
      if (!hasAbilityFn(bCard.name, benchAbName, bi)) continue;
      if (_abilityHolderEffectiveFn && !_abilityHolderEffectiveFn(state, b, bCard, pIdx, benchAbName, pool)) continue;
      return askUsePromoteActiveAbility(state, pIdx, b, benchAbName, `${bCard.name}|${bi}`, bCard.name);
    }
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


// ── v5.774 KO 對手戰鬥位「pre-KO 完整實體快照」中央存取器 ──────────────────────
// 官方順序「招式效果先於昏厥結算」：picker 型 POST 效果(戲法舞步/反轉之風…)非同步,真正效果在
//   後續 RESOLVE_SELECTION 才發生,屆時對手戰鬥位早已被主 KO 移除。engine 在移除前把 pre-KO 的對手
//   戰鬥位『完整實體』存進 state._koDefenderSnapshot,這裡提供中央存取,讓這類卡免逐張客製化讀取。
export function getKODefenderSnapshot(state: GameState, dIdx: 0 | 1): CardInstance | null {
  const snap = state._koDefenderSnapshot;
  return snap && snap.idx === dIdx ? snap.inst : null;
}
// 取「被本次招式傷害 KO 的對手戰鬥位」當下仍在該方棄牌區的能量(供搬移/回手 picker 的候選 iid)。
export function getKODefenderEnergyInDiscard(state: GameState, dIdx: 0 | 1): CardInstance[] {
  const snap = getKODefenderSnapshot(state, dIdx);
  if (!snap) return [];
  const discard = state.players[dIdx].discard;
  return (snap.energyAttached ?? []).filter(e => discard.some(c => c.iid === e.iid));
}

// v5.776：從對手 active 或棄牌區取出指定能量(回傳更新後 player + 該能量)，讓搬移對手戰鬥位能量的
//   pick/attach/回手 resolver source-agnostic（對手未KO=從 active 取；已KO=從棄牌區取，配合 _koDefenderSnapshot）。
export function pluckOppEnergyActiveOrDiscard(
  player: PlayerState, iid: string,
): { player: PlayerState; energy: CardInstance | null } {
  const fromActive = player.active?.energyAttached.find(e => e.iid === iid);
  if (fromActive) {
    return { player: { ...player, active: { ...player.active!, energyAttached: player.active!.energyAttached.filter(e => e.iid !== iid) } }, energy: fromActive };
  }
  const fromDiscard = player.discard.find(e => e.iid === iid);
  if (fromDiscard) {
    return { player: { ...player, discard: player.discard.filter(e => e.iid !== iid) }, energy: fromDiscard };
  }
  return { player, energy: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// v6.059 — M6「綠寶石風暴」傳說競技場：效果尚未實裝 → fail-closed（不可打出）
// ══════════════════════════════════════════════════════════════════════════════
// 這三張是官方新機制「傳說競技場」：**一張卡由兩張實體卡拼成**（collectorNumber 各帶兩個
// 編號，如「071/076,072/076」），牌組中算 2 張、手牌需同時持有 2 張才能使出（Wilson 裁定）。
// 該機制（牌組張數計算／手牌雙持檢查／場上兩張合併圖）尚未實作，因此本版**先擋住不可打出**，
// 而不是掛半套 hook 讓玩家放上場卻無效果 —— 後者是「名字在 set 卻是 silent stub」，
// 正是 test-stadium-coverage 守衛要根絕的東西。
//
// 官方卡面（static/cards M6.json rulesText，台灣官方中文）：
//   傳說的海溝  ：雙方的所有寶可夢恢復HP時，恢復的HP改為2倍。
//   傳說的山頂  ：雙方的【無】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，被獲得的獎賞卡減少1張。
//   傳說的熔岩洞：雙方場上所有進化寶可夢的特性全部消除。
// ⚠ 另有「小楓與小南的修行」(Supporter) 依賴「場上有名稱中有『傳說』的競技場卡」→ 同批實作。
export const PENDING_STADIUMS = new Set<string>([
  // v6.084：M6 三張「傳說」競技場已完成實裝（場地效果 v6.077、牌組層 v6.082、
  //   兩張合一出牌機制 v6.084）→ 從 fail-closed 名單移除。
  //   這個 Set 保留給下一批「已進 DB 但效果還沒做」的競技場用。
]);

/** 該競技場是否為「尚未實裝 → 禁止打出」。engine 打出路徑與可打出清單 filter 兩端共用此述詞。 */
export function isStadiumPendingImplementation(name: string | undefined | null): boolean {
  return !!name && PENDING_STADIUMS.has(name);
}
