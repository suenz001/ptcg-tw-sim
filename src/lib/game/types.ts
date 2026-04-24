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
  /**
   * 自己寶可夢下個自己回合不可撤退（懶人獺 悠哉）。
   * 設於 ATTACK_POST，於擁有者下回合開始（nextIdx promote）時變成 cantRetreatNextTurn=true，
   * 於該回合 END_TURN 照 clearCantRetreat 規則清除。
   */
  cantRetreatPendingSelf?: boolean;
  /**
   * 本回合剛從備戰區被放置於戰鬥場（RETREAT 交替、SEND_NEW_ACTIVE 送出新戰鬥寶可夢、
   * 或其他將備戰寶可夢移到戰鬥場的效果）。
   * 由 ATTACK_PRE 用來判斷「在這個回合，若從備戰區將這隻寶可夢放置於戰鬥場」條件。
   * 在 END_TURN 時清除（僅在擁有者的回合結束時）。
   * 設此旗標的進入點：RETREAT、SEND_NEW_ACTIVE。
   */
  movedToActiveThisTurn?: boolean;
  /**
   * 跨回合「下個對手（設此旗標的攻擊方）回合本卡受到招式傷害 +N」。
   * 例：超音波幼蟲｜刺耳聲 → 對手下個自己回合，打這隻 +50。
   * - 攻擊方在 ATTACK_POST 設於對手的 active（若仍存在）
   * - 於擁有者下個 END_TURN（= 對手下回合開始前）promote 為 takeExtraDamageThisTurn
   * - 在攻擊方（此卡擁有者的對手）下個 END_TURN 時清除
   */
  takeExtraDamageNextTurn?: number;
  /**
   * 本回合此卡受到招式傷害 +N（由 takeExtraDamageNextTurn promote 而來）。
   * 在對手（攻擊方）的 END_TURN 時清除。
   */
  takeExtraDamageThisTurn?: number;
  /**
   * 卡片層級「下回合此卡無法從手牌附加能量」預約旗標（晶光花｜侵蝕碎塊）。
   * 於擁有者下個 END_TURN 時 promote 為 cantAttachEnergyThisTurn。
   */
  cantAttachEnergyNextTurn?: boolean;
  /**
   * 本回合此卡無法從手牌附加能量（由 cantAttachEnergyNextTurn promote 而來）。
   * 在擁有者 END_TURN 時清除。
   */
  cantAttachEnergyThisTurn?: boolean;
  /**
   * 跨回合「若此卡在攻擊方下個回合被 KO，則 +N 張獎勵牌」預約旗標（蝶結萌虻｜多餘花粉）。
   * 由攻擊方在 ATTACK_POST 設於對手 active；於擁有者下個 END_TURN promote 為 ThisTurn。
   */
  deferredPrizeBonusNextTurn?: number;
  /**
   * 本回合此卡被 KO 時 +N 張獎勵牌（由 deferredPrizeBonusNextTurn promote 而來）。
   * 在對手（攻擊方）的 END_TURN 時清除。
   */
  deferredPrizeBonusThisTurn?: number;
  /**
   * v2.92：**單招下回合禁用**預約旗標（卡片層級）。
   * 卡面範例：「超級勇氣 — 在下個自己的回合，這隻寶可夢無法使用『超級勇氣』」。
   * 設於 ATTACK_POST（用該招時將招式名 push 到此陣列），於擁有者下個 END_TURN
   * 時 promote 為 blockedAttackNamesThisTurn（即下個自己回合開始前）。
   * 多招並存用陣列（未來可能有同一隻寶可夢累積多個禁用招式）。
   */
  blockedAttackNamesNextTurn?: string[];
  /**
   * v2.92：**單招本回合禁用**（由 blockedAttackNamesNextTurn promote 而來）。
   * ATTACK handler / getAvailableAttacks 檢查：若當前要用的招式名 includes 其中 →
   * 禁用。在擁有者 END_TURN 清除。
   */
  blockedAttackNamesThisTurn?: string[];
  /**
   * v2.101：**下個對手回合此卡弱點失效**預約旗標（卡片層級）。
   * 卡面範例：「鋁鋼橋龍ex｜金屬防禦強化 — 在下個對手的回合，這隻寶可夢的弱點全部消除。」
   * 由**攻擊方**在自己 ATTACK_POST 設於自己的 active，於擁有者下個 END_TURN 時
   * promote 為 weaknessDisabledThisTurn（即對手下個回合開始前）。
   * 在對手（攻擊方）下個 END_TURN 時清除（由 attacker 的 END_TURN 負責 ThisTurn 清理）。
   */
  weaknessDisabledNextTurn?: boolean;
  /**
   * v2.101：**本回合此卡弱點失效**（由 weaknessDisabledNextTurn promote）。
   * 於 engine 的 attack pipeline 的 weakness ×2 判定點加入此旗標檢查 —
   * 若 defender.active 有此旗標則跳過 weakness。
   */
  weaknessDisabledThisTurn?: boolean;
  /**
   * v2.101：**下個對手回合此卡不受【基礎】寶可夢招式傷害**預約旗標。
   * 卡面範例：「鋁鋼橋龍｜塗層攻擊 — 在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害。」
   * 由攻擊方在自己 ATTACK_POST 設於自己的 active，於擁有者下個 END_TURN 時 promote。
   * 注意：只擋「招式的傷害」，招式其他效果仍會觸發（此區別依卡面）。
   */
  immuneToBasicAttackNextTurn?: boolean;
  /**
   * v2.101：**本回合此卡不受【基礎】寶可夢招式傷害**（由 immuneToBasicAttackNextTurn promote）。
   * 於 engine 的 attack pipeline：若 attacker card.stage === 'Basic' 且 defender 有此旗標 →
   * baseDamage 歸零（招式仍會打出、其他效果仍觸發）。
   */
  immuneToBasicAttackThisTurn?: boolean;
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
  /** v2.57：本回合是否已打出「名稱含『火箭隊』的支援者」— 火箭隊的工廠 gate 用 */
  rocketSupporterPlayedThisTurn?: boolean;
  /** 本回合是否已撤退 */
  retreatedThisTurn: boolean;
  /**
   * 招式效果設下的「下個自己回合，自己所有寶可夢（含新上場的）無法使用招式」預約旗標。
   * 例：電擊魔獸｜雷電在地。
   * 在擁有者下個回合開始前（END_TURN 時於 nextIdx 方）promote 為 noAttacksThisTurn。
   */
  noAttacksNextTurn?: boolean;
  /**
   * v2.113 空手道王的演練 — 本回合自己的寶可夢招式對對手戰鬥場的 ex +40 傷害。
   * 打出 Supporter 當下設 true，回合結束時清除。
   */
  karateKingBonusThisTurn?: boolean;
  /**
   * 本回合，此玩家所有寶可夢皆無法使用招式（由 noAttacksNextTurn promote）。
   * 在 END_TURN 時清除（於 aIdx 方）。
   */
  noAttacksThisTurn?: boolean;
  /**
   * Wave 39：玩家級「下個自己回合無法從手牌使出物品卡」預約旗標（例：含羞苞｜癢癢花粉）。
   * 於擁有者下個 END_TURN（= nextIdx 方）promote 為 cantPlayItemThisTurn。
   */
  cantPlayItemNextTurn?: boolean;
  /**
   * 本回合此玩家無法從手牌使出物品卡（由 cantPlayItemNextTurn promote）。
   * 在 END_TURN 時清除（於 aIdx 方）。
   */
  cantPlayItemThisTurn?: boolean;
  /**
   * Wave 39：玩家級「下個自己回合無法從手牌使出支援者卡」預約旗標（例：吼叫尾ex｜絕叫）。
   */
  cantPlaySupporterNextTurn?: boolean;
  cantPlaySupporterThisTurn?: boolean;
  /**
   * Wave 39：玩家級「下個自己回合無法從手牌使出寶可夢並完成進化」預約旗標（例：青銅鐘｜進化妨礙者）。
   */
  cantEvolveNextTurn?: boolean;
  cantEvolveThisTurn?: boolean;
  /**
   * Wave 42：玩家級「本回合自己的【鬥】寶可夢招式傷害 +N」累積值（例：力量蛋白飲）。
   * 每使用 1 張 +30。只對 pokemonType==='Fighting' 的攻擊者生效；在 weakness 前套用。
   * 在 END_TURN 時清除（於 aIdx 方）。
   */
  damageBoostFightingThisTurn?: number;
  /**
   * Wave 43：白蕾雅（Supporter）— 本回合，若對手戰鬥寶可夢因自己的「太晶」寶可夢使用的招式而 KO，
   * 則多取 1 張獎勵牌。打出 supporter 時設為 true，KO 路徑於攻擊方獲獎前檢查此旗標 +
   * 攻擊方 active 是否為太晶（card.tags?.includes('太晶')）。
   * 在 END_TURN 時清除（於 aIdx 方）。
   * v2.48：攻擊者太晶偵測從 attacks kludge 改為 tags（scraper 已遷移資料）。
   */
  teraKoBonusPrizeThisTurn?: boolean;
  /**
   * v2.91：本回合玩家已經使用過的**主動特性名稱**清單（同名特性一回合限 1 次）。
   * 用於：使者衝刺（超級袋獸ex）/ 月光循環（月石）等卡面明寫「在使用了其他
   * 的『XX』的回合，此特性無法使用」的規則。
   * 與 CardInstance.abilityUsedThisTurn 不同：後者是「此卡實例一回合 1 次」
   * （多隻同名可各用一次），本欄位是「本回合所有同名共享 1 次」。
   * USE_ABILITY handler 於使用前檢查 includes，使用後 push name；END_TURN 清除。
   */
  abilityNamesUsedThisTurn?: string[];
}

// ── 擁有規則的寶可夢（Pokémon with a Rule Box）判定 ─────────────────────────
/**
 * PTCG 規則盒寶可夢 = ex / V / VMAX / VSTAR / GX / EX / Tag Team GX 等
 * （有規則欄位的寶可夢卡）。用於：呆呆王｜耀閃挑戰 判定「擁有規則的寶可夢
 * 除外」不能取它招式來複製。
 *
 * Scraper 目前寫入的 subtype 值：'ex' / 'VSTAR' / 'MegaEvolution' 等。
 * 常見可能出現的都列在這：若官方推出新規則盒寶可夢要加。
 */
export const RULE_BOX_SUBTYPES = new Set<string>([
  'ex', 'EX', 'V', 'VMAX', 'VSTAR', 'GX', 'MegaEvolution',
]);

// ── 待選擇狀態（訓練家/招式效果需要玩家做決定時）──────────────────────────

export interface PendingSelection {
  /** 選擇類型 */
  type: 'deck-search' | 'bench-choose' | 'hand-discard' | 'heal-target'
      | 'opp-bench-choose'  // 選對手備戰寶可夢（老大的指令、頂尖捕捉器）
      | 'opp-poke-choose'   // 選對手任意寶可夢（含出場，例如狙擊羽毛）
      | 'discard-search'    // 從棄牌區選擇（夜間擔架、能量回收器、奇跡修正檔）
      | 'hand-choose'       // 從手牌選擇但不丟棄（神奇糖果第一步）
      | 'damage-distribute' // 傷害指示物自由分配到多隻對手備戰（幻影奇襲、類似機制）
      | 'active-energy-discard'; // v2.63 撤退時手動選擇要丟哪幾張附加能量（多屬性時詢問）
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
   * 雙方本回合是否已打出過場地卡 [P1, P2]。
   * PTCG 規則：一回合每位玩家只能打出一張競技場卡（不論目前場上有無場地）。
   * 於 END_TURN 重置 activePlayerIndex 側為 false。
   */
  stadiumPlayedThisTurn?: [boolean, boolean];
  /**
   * 我方上次結束自己回合時，對手剩餘獎賞張數的快照 [P1 側快照, P2 側快照]。
   * 比較 snapshot vs 目前 opp 獎賞張數差即可得知「對手上個回合是否取得過獎賞（= 自己寶可夢是否在對手回合被擊倒）」。
   * 用於「不公印章」等需要『前一回合對手取過獎賞』判定的卡牌。
   * 初始值 [6, 6]（雙方都還沒結束過自己的回合，視為對手沒取過獎賞）。
   */
  oppPrizesAtMyLastTurnEnd?: [number, number];
  /**
   * 我方「這個回合開始時」對手剩餘獎賞張數的快照 [P1 側快照, P2 側快照]。
   * 與 oppPrizesAtMyLastTurnEnd 對比判定自 KO：
   *   - TurnStart < LastTurnEnd → 對手在他們剛結束的回合取過獎賞（= 對手回合擊倒我方）
   *   - TurnStart == LastTurnEnd 但當下 opp.prizes 更少 → 自己這個回合內自 KO（不該觸發不公印章）
   * 於 END_TURN 時由「下一個 activePlayer」快照 opp.prizes.length。
   * 初始值 [6, 6]。
   */
  oppPrizesAtMyTurnStart?: [number, number];
  /**
   * v2.70：我方上次結束自己回合時，自己棄牌堆中「火箭隊的」寶可夢數量的快照 [P1, P2]。
   * 與 rocketInMyDiscardAtMyTurnStart 對比，偵測「對手的回合內我方有火箭隊寶可夢被擊倒」。
   * 用於「火箭隊的阿波羅」等 gate 條件（類似不公印章，但只認火箭隊寶可夢）。
   * 只計 supertype === 'Pokemon' 且 name 以「火箭隊的」開頭的卡片。
   * 初始值 [0, 0]（遊戲開始時棄牌堆為空）。
   */
  rocketInMyDiscardAtMyLastTurnEnd?: [number, number];
  /**
   * v2.70：我方「這個回合開始時」自己棄牌堆中「火箭隊的」寶可夢數量的快照 [P1, P2]。
   * 與 rocketInMyDiscardAtMyLastTurnEnd 對比即可判定「對手上個回合造成過火箭隊寶可夢昏厥」：
   *   turnStart > lastEnd → 對手的回合間自己的火箭隊寶可夢被擊倒 → Apollo 可用
   * 於 END_TURN 時由「下一個 activePlayer」快照其棄牌堆的火箭隊寶可夢數。
   * 初始值 [0, 0]。
   */
  rocketInMyDiscardAtMyTurnStart?: [number, number];
  /**
   * v2.70：copy-attack（例如 火箭隊的謎擬Ｑ｜扮晶晶酒）在 ATTACK_PRE 階段
   * 記下被複製招式的 effectKey（格式 `對手卡名|招式名`），好讓 ATTACK_POST
   * 可以轉接呼叫被複製招式的 POST（包含 pendingSelection 類附加效果）。
   * 必須在呼叫方自己的 POST 最末清空，否則下一招會重複觸發。
   */
  pendingCopyAttackKey?: string;
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
  | {
      type: 'ATTACK';
      attackIndex: number;
      discardedEnergyIids?: string[];
      /**
       * v2.119：copy-attack 類招式（如 N的索羅亞克ex｜暗黑底牌）需要玩家先選：
       *   - pokeIid：要複製招式的「源頭」寶可夢（備戰區某隻 N的寶可夢）
       *   - attackIndex：該寶可夢 attacks 陣列的 index
       * 由 UI 層在 initiateAttack 時彈 picker 讓玩家挑；regPre/regPost 讀取此欄位
       * 轉接到被複製招式的 PRE/POST。無傳值時 fallback 為自動挑最高傷害招式。
       */
      copyAttackChoice?: { pokeIid: string; attackIndex: number };
    }
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
