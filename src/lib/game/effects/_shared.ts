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
  GameState, PlayerState, CardInstance, PendingSelection,
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

export function canPlayTrainer(
  cardName: string,
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>
): boolean {
  const guard = TRAINER_GUARDS.get(cardName);
  return guard ? guard(state, actorIdx, pool) : true;
}

// ══════════════════════════════════════════════════════════════════════════════
// 純函式工具
// ══════════════════════════════════════════════════════════════════════════════

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
