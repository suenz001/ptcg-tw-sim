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
  | 'setup'      // 雙方同時選出場寶可夢 + 備戰
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
  /** 下一次被攻擊時傷害 -N（攻擊後自動清除），用於「下回合受傷減 N」效果 */
  damageReduceNextHit?: number;
  /** 下一次輪到自己行動時不能撤退（老匠、關節技等），行動後清除 */
  cantRetreatNextTurn?: boolean;
  /**
   * 進化鏈：下層被進化掉的 CardInstance 堆疊（由底到頂，不含當前卡）。
   * - 被擊倒時要一併進棄牌區（PTCG 官方規則）
   * - UI zoom modal 顯示進化鏈並可點擊檢視每張
   * 每個元素不保留 energyAttached/toolAttached（已繼承給頂層）。
   */
  evolvedFromStack?: CardInstance[];
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
  /**
   * 本回合無法使用招式（UI 反白禁按）。
   * 由 cantAttackPending 在「擁有者下個回合開始」時自動 promote 而來，
   * 並在該回合 END_TURN 時清除。
   */
  cantAttackThisTurn?: boolean;
  /**
   * 招式效果剛打出時設下的「下個自己回合無法使用招式」預約旗標。
   * 在 END_TURN 切換到擁有者下個回合時，自動 promote 為 cantAttackThisTurn。
   * 設於 ATTACK_POST 階段（攻擊方或防守方皆可）。
   */
  cantAttackPending?: boolean;
  /**
   * 本回合已使用過特性（每回合限 1 次主動特性）。
   * 在 END_TURN 時清除。
   */
  abilityUsedThisTurn?: boolean;
  /**
   * 本回合此寶可夢使用招式時，base damage +N（在 weakness 之前套用）。
   * 由 damageBonusPending 在「擁有者下個回合開始」時自動 promote 而來，
   * 並在該回合 END_TURN 時清除。
   */
  damageBonusThisTurn?: number;
  /**
   * 招式效果剛打出時設下的「下個自己回合招式 +N 傷害」預約旗標。
   * 在 END_TURN 切換到擁有者下個回合時，自動 promote 為 damageBonusThisTurn。
   */
  damageBonusPending?: number;
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
  type: 'deck-search' | 'bench-choose' | 'hand-discard' | 'heal-target'
      | 'opp-bench-choose'  // 選對手備戰寶可夢（老大的指令、頂尖捕捉器）
      | 'opp-poke-choose'   // 選對手任意寶可夢（含出場，例如狙擊羽毛）
      | 'discard-search'    // 從棄牌區選擇（夜間擔架、能量回收器、奇跡修正檔）
      | 'hand-choose';      // 從手牌選擇但不丟棄（神奇糖果第一步）
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
  /** 由 createGame 擲硬幣決定的先手方 */
  firstPlayerIdx: 0 | 1;
  players: [PlayerState, PlayerState];
  /** 回合數（從 1 開始，先手第一回合 = 1） */
  turn: number;
  /**
   * 第一回合旗標：先手第一回合不能攻擊也不能進化（Setup 寶可夢限制）
   */
  isFirstTurn: boolean;
  /** 等待 P1 or P2 在 setup 選完備戰區後，另一方是否也已完成 */
  setupDone: [boolean, boolean];
  /**
   * Mulligan 次數：起手 7 張沒有基礎寶可夢時的重抽次數。
   * 對手每次 mulligan 可多抽 1 張作為補償。
   */
  mulliganCounts: [number, number];
  /**
   * 待決定的 mulligan 補抽張數 [P1, P2]：
   * 對手（非我方）mulligan 時我方可補抽 N 張，玩家可選擇抽或不抽。
   * 值 > 0 時 setup 階段顯示選擇 UI；decide 後歸零（不論接不接受）。
   * 無 mulligan 則一開始就是 [0, 0]。
   */
  pendingMulliganDraw: [number, number];
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
  /** 目前場上的競技場牌（Stadium） */
  activeStadium?: CardInstance;
  /** 雙方本回合是否已使用競技場效果 [P1, P2] */
  stadiumUsedThisTurn?: [boolean, boolean];
  /**
   * 我方上次結束自己回合時，對手剩餘獎賞張數的快照 [P1 側快照, P2 側快照]。
   * 比較 snapshot vs 目前 opp 獎賞張數差即可得知「對手上個回合是否取得過獎賞（= 自己寶可夢是否在對手回合被擊倒）」。
   * 用於「不公印章」等需要『前一回合對手取過獎賞』判定的卡牌。
   * 初始值 [6, 6]（雙方都還沒結束過自己的回合，視為對手沒取過獎賞）。
   */
  oppPrizesAtMyLastTurnEnd?: [number, number];
}

export interface LogEntry {
  turn: number;
  playerIndex: 0 | 1 | null; // null = 系統訊息
  message: string;
}

// ── 動作 ────────────────────────────────────────────────────────────────────

export type GameAction =
  // setup 階段（senderIdx 必填 — setup 階段雙方同時行動，需明示來源）
  | { type: 'PLACE_ACTIVE'; iid: string; senderIdx: 0 | 1 }
  | { type: 'BENCH_POKEMON'; iid: string; senderIdx: 0 | 1 }
  | { type: 'FINISH_SETUP'; senderIdx: 0 | 1 }
  /** 對手 mulligan 補抽：accept=true 抽齊 pendingMulliganDraw[senderIdx] 張；false 放棄 */
  | { type: 'MULLIGAN_DRAW_DECISION'; accept: boolean; senderIdx: 0 | 1 }

  // 正式對戰
  | { type: 'DRAW_CARD' }
  | { type: 'PLAY_BASIC'; iid: string }          // 從手牌打出基礎寶可夢到備戰區
  | { type: 'ATTACH_ENERGY'; energyIid: string; targetIid: string }
  | { type: 'EVOLVE'; fromIid: string; toIid: string }
  | { type: 'RETREAT'; newActiveIid: string }
  | { type: 'PLAY_TRAINER'; iid: string; params?: Record<string, unknown> }
  | { type: 'RESOLVE_SELECTION'; selectedIids: string[]; senderIdx?: 0 | 1 }
  | { type: 'ATTACK'; attackIndex: number; discardedEnergyIids?: string[] }
  | { type: 'TAKE_PRIZES'; count: number }
  | { type: 'SEND_NEW_ACTIVE'; iid: string; senderIdx?: 0 | 1 }
  | { type: 'USE_STADIUM' }
  | { type: 'USE_ABILITY'; iid: string; abilityIndex: number }
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
