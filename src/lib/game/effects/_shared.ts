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
   * 招式傷害不計算對手戰鬥寶可夢身上的「附加效果」（Session 33）。
   * 包含被動減傷特性、防禦道具（福祿果等）、下次被攻擊 -N、條件式完全免疫。
   */
  skipDefEffects?: boolean;
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
   */
  scope: 'attacker' | 'any-own' | 'own-bench' | 'hand-rocket-supporter' | 'hand-tool' | 'binary-yes-no';
  /**
   * v2.255：scope='binary-yes-no' 時的提示文字。
   *   choicePrompt：modal 主問句（例：「是否將自身回牌庫，增加 80 點傷害？」）
   *   choiceYesLabel / choiceNoLabel：yes/no 按鈕文字（預設「是」/「否」）。
   */
  choicePrompt?: string;
  choiceYesLabel?: string;
  choiceNoLabel?: string;
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
  return 1;
}

/** pokémonName|abilityIndex → 效果函式 */
export const ABILITY_EFFECTS = new Map<string, EffectFn>();

export function regA(pokemonName: string, abilityIndex: number, fn: EffectFn) {
  ABILITY_EFFECTS.set(`${pokemonName}|${abilityIndex}`, fn);
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
export function sameEvoName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const stripEx = (s: string) => (s.endsWith('ex') ? s.slice(0, -2) : s);
  return stripEx(a) === stripEx(b);
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
  const fieldKey: keyof GameState = cause === 'attack'
    ? 'oppAttackKOdMeThisTurn'
    : 'oppAbilityKOdMeThisTurn';
  const rocketKey: keyof GameState = cause === 'attack'
    ? 'oppAttackKOdMyRocketThisTurn'
    : 'oppAbilityKOdMyRocketThisTurn';
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

export function addLog(
  state: GameState,
  msg: string,
  playerIdx: 0 | 1 | null = null
): GameState {
  return {
    ...state,
    log: [...state.log, { turn: state.turn, playerIndex: playerIdx, message: msg }],
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
  return updatePlayer(state, idx, (p) => ({
    ...p,
    deck: shuffle([...p.deck, ...p.hand]),
    hand: [],
  }));
}

export function withPending(state: GameState, sel: PendingSelection): GameState {
  return { ...state, pendingSelection: sel };
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
 * 統一用這個 helper 處理。
 */
export function clearActiveEffects(poke: CardInstance): CardInstance {
  return {
    ...poke,
    status: undefined,
    secondaryStatus: undefined,
    cantAttackThisTurn: undefined,
    cantAttackPending: undefined,
    cantRetreatNextTurn: undefined,
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
  return updatePlayer(st, idx, (p) => {
    const isActive = p.active?.iid === iid;
    const target = isActive ? p.active! : p.bench.find(c => c.iid === iid);
    if (!target) return p;

    const newDamage = Math.max(0, target.damage - healAmount);
    const discarded = target.energyAttached.slice(-discardCount);
    const remaining = target.energyAttached.slice(0, target.energyAttached.length - discardCount);
    const healed: CardInstance = { ...target, damage: newDamage, energyAttached: remaining };
    if (clearStatus) {
      delete healed.status;
      delete healed.secondaryStatus;
    }

    return {
      ...p,
      active: isActive ? healed : p.active,
      bench: isActive ? p.bench : p.bench.map(c => c.iid === iid ? healed : c),
      discard: [...p.discard, ...discarded],
    };
  });
}
