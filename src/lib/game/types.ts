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
   * 第一回合旗標：P1 第一回合不能攻擊
   * （規則：先手玩家第 1 回合不能使用招式）
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
}

export interface LogEntry {
  turn: number;
  playerIndex: 0 | 1 | null; // null = 系統訊息
  message: string;
}

// ── 動作 ────────────────────────────────────────────────────────────────────

/**
 * 所有合法動作。引擎是純函式：
 *   applyAction(state, action, pool) → GameState
 *
 * 未來 M3 多人連線只需把動作序列化後送到 Firestore，對方收到後 replay 即可。
 */
export type GameAction =
  // setup 階段
  | { type: 'PLACE_ACTIVE'; iid: string }       // 選出場寶可夢
  | { type: 'BENCH_POKEMON'; iid: string }      // 選備戰區寶可夢
  | { type: 'FINISH_SETUP' }                    // 完成本方 setup

  // 正式對戰
  | { type: 'DRAW_CARD' }                       // 抽 1 張牌
  | { type: 'ATTACH_ENERGY'; energyIid: string; targetIid: string } // 附加能量
  | { type: 'ATTACK'; attackIndex: number }     // 宣告招式
  | { type: 'TAKE_PRIZES'; count: number }      // 取獎勵牌（擊倒後）
  | { type: 'SEND_NEW_ACTIVE'; iid: string }    // 出場寶可夢被擊倒後，送出新的
  | { type: 'END_TURN' }                        // 結束回合

  // 未來插槽（M3/M4）
  | { type: 'PLAY_TRAINER'; iid: string; params?: Record<string, unknown> }
  | { type: 'EVOLVE'; fromIid: string; toIid: string }
  | { type: 'RETREAT'; newActiveIid: string };

// ── 效果腳本插槽（M3/M4 填入） ─────────────────────────────────────────────

/**
 * 每張訓練家/招式效果的執行描述。
 * M2 先留空，M3 起逐步填入常用卡效果。
 * 引擎在 PLAY_TRAINER / ATTACK 時呼叫對應的 EffectScript。
 */
export interface EffectScript {
  /** 是否已實裝（false = 顯示「效果尚未支援」提示） */
  implemented: boolean;
  /** 執行效果，直接修改並回傳新 state（pure） */
  execute?: (
    state: GameState,
    actorIndex: 0 | 1,
    params?: Record<string, unknown>
  ) => GameState;
}
