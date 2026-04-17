/**
 * PTCG 對戰引擎 — 型別定義
 *
 * 設計原則：
 * - GameState 是純資料（no methods），引擎函式是純函式
 * - 每個動作產生新的 GameState，方便日誌回放與未來 Firestore 同步
 * - 卡片效果（招式、特性、訓練家）預留 EffectScript 插槽，M3/M4 逐步填入
 */

import type { EnergyType } from '$lib/cards/types';

// ── 遊戲階段 ────────────────────────────────────────────────────────────────

/** 整局遊戲的大階段 */
export type GamePhase =
  | 'setup-p1'   // P1 選出場寶可夢
  | 'setup-p2'   // P2 選出場寶可夢
  | 'playing'    // 正式對戰輪回
  | 'game-over'; // 遊戲結束

/** 正式對戰時，每個回合的小階段 */
export type TurnPhase =
  | 'draw'   // 抽牌（每回合開始）
  | 'main'   // 主階段：附加能量、打出訓練家、進化、撤退…
  | 'end';   // 回合結束清理

// ── 卡片實例 ────────────────────────────────────────────────────────────────

/** 場上或手牌中的一張卡的「執行期實例」（與 Card 資料庫記錄分離） */
export interface CardInstance {
  /** 本場遊戲唯一 ID（每張卡不同，即使同名） */
  iid: string;
  /** 對應 Card.id（用來查牌庫資料） */
  cardId: string;
  /** 傷害計數器（寶可夢用） */
  damage: number;
  /** 附加的能量牌（iid 列表，附在寶可夢上） */
  energyAttached: CardInstance[];
  /** 附加的道具牌（iid，M4 實裝） */
  toolAttached?: CardInstance;
  /** 進化來源的 iid（用來驗證是否可進化） */
  evolvedFromIid?: string;
  /** 特殊狀態（M4 實裝） */
  status?: SpecialCondition;
  /**
   * 本回合剛從手牌打出到備戰區（PLAY_BASIC），不可進化。
   * 在 END_TURN 時清除。
   */
  justPlaced?: boolean;
  /**
   * 本回合已進化過，不可再次進化。
   * 在 END_TURN 時清除。
   */
  evolvedThisTurn?: boolean;
}

export type SpecialCondition =
  | 'poisoned' | 'burned' | 'asleep' | 'confused' | 'paralyzed';

// ── 玩家狀態 ────────────────────────────────────────────────────────────────

export interface PlayerState {
  name: string;
  /** 手牌區（未出場） */
  hand: CardInstance[];
  /** 牌組（隨機排序，頂部 = index 0） */
  deck: CardInstance[];
  /** 出場寶可夢（null = 正在等待放置或全滅） */
  active: CardInstance | null;
  /** 備戰區（最多 5 隻） */
  bench: CardInstance[];
  /** 墓地 */
  discard: CardInstance[];
  /** 獎勵牌（6 張，正面朝下） */
  prizes: CardInstance[];
  /** 本回合是否已附加能量 */
  energyAttachedThisTurn: boolean;
  /** 本回合是否已打出支援者 */
  supporterPlayedThisTurn: boolean;
  /** 本回合是否已撤退 */
  retreatedThisTurn: boolean;
}

// ── 待選擇狀態（訓練家/招式效果需要玩家做決定時）──────────────────────────

export interface PendingSelection {
  /** 選擇類型 */
  type: 'deck-search' | 'bench-choose' | 'hand-discard' | 'heal-target';
  /** 需要做選擇的玩家 */
  actorIdx: 0 | 1;
  /** 來源牌堆/目標的玩家（通常等於 actorIdx） */
  sourcePlayerIdx: 0 | 1;
  /** 篩選條件（'Basic', 'Pokemon', 'Energy', 'TOP6', 'Basic:HP70' 等） */
  filter?: string;
  /** 最少選取數 */
  minCount: number;
  /** 最多選取數 */
  maxCount: number;
  /** 效果繼續 key（在 RESOLVERS 登錄表中查找） */
  effectKey: string;
  /** 額外傳遞給 resolver 的參數 */
  params?: Record<string, unknown>;
}

// ── 遊戲狀態 ────────────────────────────────────────────────────────────────

export interface GameState {
  /** 本局唯一 ID */
  id: string;
  phase: GamePhase;
  /** 正式對戰階段的回合小分段 */
  turnPhase: TurnPhase;
  /** 目前行動玩家（0 = P1, 1 = P2） */
  activePlayerIndex: 0 | 1;
  players: [PlayerState, PlayerState];
  /** 回合數（從 1 開始，P1 第一回合 = 1） */
  turn: number;
  /**
   * 第一回合旗標：P1 第一回合不能攻擊也不能進化（Setup 寶可夢限制）
   */
  isFirstTurn: boolean;
  /** 等待 P1 or P2 在 setup 選完備戰區後，另一方是否也已完成 */
  setupDone: [boolean, boolean];
  /** 行動紀錄（給 UI 顯示用） */
  log: LogEntry[];
  /** 勝者（game-over 時填入） */
  winner?: 0 | 1;
  winReason?: string;
  /**
   * 擊倒後待取獎勵數量（攻擊方需要行動）
   * M2 只用到 1（一般擊倒），ex 系列為 2（M4 處理）
   */
  pendingPrizes: number;
  /**
   * 待處理的互動選擇（訓練家效果觸發時設定）
   * 設定後 UI 必須顯示選擇介面，玩家透過 RESOLVE_SELECTION 繼續
   */
  pendingSelection?: PendingSelection;
}

export interface LogEntry {
  turn: number;
  playerIndex: 0 | 1 | null; // null = 系統訊息
  message: string;
}

// ── 動作 ────────────────────────────────────────────────────────────────────

export type GameAction =
  // setup 階段
  | { type: 'PLACE_ACTIVE'; iid: string }
  | { type: 'BENCH_POKEMON'; iid: string }
  | { type: 'FINISH_SETUP' }

  // 正式對戰
  | { type: 'DRAW_CARD' }
  | { type: 'PLAY_BASIC'; iid: string }          // 從手牌打出基礎寶可夢到備戰區
  | { type: 'ATTACH_ENERGY'; energyIid: string; targetIid: string }
  | { type: 'EVOLVE'; fromIid: string; toIid: string }
  | { type: 'RETREAT'; newActiveIid: string }
  | { type: 'PLAY_TRAINER'; iid: string; params?: Record<string, unknown> }
  | { type: 'RESOLVE_SELECTION'; selectedIids: string[] }
  | { type: 'ATTACK'; attackIndex: number }
  | { type: 'TAKE_PRIZES'; count: number }
  | { type: 'SEND_NEW_ACTIVE'; iid: string }
  | { type: 'END_TURN' };

// ── 效果腳本插槽（M3/M4 填入） ─────────────────────────────────────────────

export interface EffectScript {
  implemented: boolean;
  execute?: (
    state: GameState,
    actorIndex: 0 | 1,
    params?: Record<string, unknown>
  ) => GameState;
}
