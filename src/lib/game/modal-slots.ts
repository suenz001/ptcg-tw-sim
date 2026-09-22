/**
 * ⭐⭐⭐ v6.425：「現在該開哪一個視窗」的**唯一**判準（leaf 模組，零 import）。
 *
 * 【玩家回報】寶可夢被擊倒後，「⚠️ 派出新的戰鬥寶可夢」視窗出現**兩個**（原本疊在一起看不出來，
 *   拖開之後變兩個），而且上方的提示也出現兩條；手機上更因為兩層遮罩，拖開上面那個之後底下那層
 *   仍然擋著，看不到對戰紀錄。
 *
 * 【根因】v2.123 起補位視窗寫了**兩份**：
 *   ・A「防守方版」：defenderPlayer 戰鬥場空 && 輪到我補位（isMyDefenderTurn）
 *   ・B「自 KO 版」：myPlayer 戰鬥場空 && 備戰區有寶可夢
 *   **我被對手擊倒時兩個條件同時成立**（防守方就是我）⇒ 兩個視窗、兩條提示一起出現。
 *   v6.420 之前全站視窗共用同一個拖曳位移，兩個視窗永遠疊在同一個位置、一起移動，所以看不出來；
 *   v6.420 改成每個視窗各自一份位移之後，拖一個就露出另一個。
 *   ⇒ 這裡把「哪幾個座位需要補位視窗／要顯示哪一條提示」收斂成一份：**同一個座位只會有一個視窗**。
 *
 * 【同型第二處（整體 audit 找到）】招式前置選擇的三種視窗：
 *   ・stepper（0～N 個指示物，波盪水｜蜿蜒割裂，H 標）的條件是 `scope === 'self-counter-stepper'`
 *   ・通用的「選能量／選卡」視窗條件是 `scope !== 'binary-yes-no'` ⇒ **stepper 也成立**
 *   ⇒ 用蜿蜒割裂時兩個視窗疊在一起。改由 `preDiscardModalKind` 一次分類，三個視窗互斥。
 *
 * ⚠ 本檔是 leaf：只放純函式，不 import 任何遊戲模組（避免循環 import 的 TDZ，見 server-clock.ts 註解）。
 */

export type Seat = 0 | 1;

interface PlayerLike {
  active: unknown;
  bench?: ReadonlyArray<unknown> | null;
}

export interface PromoteInput {
  /** game.phase */
  phase: string | undefined | null;
  /** game.players（只看 active 與 bench） */
  players: ReadonlyArray<PlayerLike | null | undefined>;
  /** 目前有沒有 pendingSelection（攻擊方還在處理效果時先不補位，v2.197） */
  hasPendingSelection: boolean;
  /** 1 - activePlayerIndex */
  defenderIdx: Seat;
  /** 我這一側的座位 */
  myIdx: Seat;
  /** isMyDefenderTurn()：輪到我替防守方補位（本機雙人恆為 true） */
  defenderTurnMine: boolean;
}

const benchCount = (p: PlayerLike | null | undefined): number => (p && Array.isArray(p.bench) ? p.bench.length : 0);
const activeEmpty = (p: PlayerLike | null | undefined): boolean => !!p && p.active === null;

/**
 * 需要開「派出新的戰鬥寶可夢」視窗的座位（去重、依 A→B 的順序）。
 * 觀戰者一律空（觀戰者的 dispatch 本來就被擋，v6.122）。
 * ⚠ 本機雙人「雙方同時被擊倒」時會回兩個**不同**的座位 —— 那是兩份不同的備戰區，兩個視窗是對的。
 */
export function promoteModalSeats(v: PromoteInput & { isSpectator: boolean }): Seat[] {
  if (v.phase !== 'playing' || v.hasPendingSelection || v.isSpectator) return [];
  const out: Seat[] = [];
  // A：防守方（被擊倒的一方）補位 —— 沿用 v2.123 條件（不看備戰數：沒有備戰時引擎應已判定勝負）
  if (activeEmpty(v.players[v.defenderIdx]) && v.defenderTurnMine) out.push(v.defenderIdx);
  // B：我自己的戰鬥場空（自 KO：咒詛炸彈、中毒於回合結束等）
  const me = v.players[v.myIdx];
  if (activeEmpty(me) && benchCount(me) > 0 && !out.includes(v.myIdx)) out.push(v.myIdx);
  return out;
}

export interface PromoteAlertInput extends PromoteInput {
  /** isMyTurn() */
  isMyTurn: boolean;
  oppIdx: Seat;
  turnPhase: string | undefined | null;
}

/**
 * 上方提示列：`mine` ＝ 顯示「請從備戰區派出新的戰鬥寶可夢」（最多一條）；
 * `waitSeat` ＝ 顯示「等待 X 送出新戰鬥寶可夢」的座位（最多一條）。
 * 舊碼的四條提示各自判斷 ⇒ 同一件事會出現兩條（防守方＝我、或特性擊倒對手時）。
 */
export function promoteAlerts(v: PromoteAlertInput): { mine: boolean; waitSeat: Seat | null } {
  if (v.phase !== 'playing' || v.hasPendingSelection) return { mine: false, waitSeat: null };
  const def = v.players[v.defenderIdx];
  const me = v.players[v.myIdx];
  const opp = v.players[v.oppIdx];
  const mine = (activeEmpty(def) && v.defenderTurnMine) || (activeEmpty(me) && benchCount(me) > 0);
  const waitDef = activeEmpty(def) && !v.defenderTurnMine && v.isMyTurn;
  const waitOpp = activeEmpty(opp) && v.turnPhase !== 'end' && benchCount(opp) > 0;
  const waitSeat: Seat | null = waitDef ? v.defenderIdx : (waitOpp ? v.oppIdx : null);
  return { mine, waitSeat };
}

/** 招式前置選擇要開哪一種視窗（三種互斥）。 */
export type PreDiscardModalKind = 'binary' | 'stepper' | 'picker';
export function preDiscardModalKind(scope: string | undefined | null): PreDiscardModalKind {
  if (scope === 'binary-yes-no') return 'binary';
  if (scope === 'self-counter-stepper') return 'stepper';
  return 'picker';
}
