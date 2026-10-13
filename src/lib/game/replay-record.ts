// ⭐v6.560 一般對戰（本機雙人／vs AI／休閒線上）的復盤記錄——純函式，不碰 DOM／儲存。
//
// 站長 2026-10-13 裁定：
//   ・每個動作一格，另有「跳到上／下一回合」。
//   ・線上對戰的復盤預設**看不到**對手的手牌與獎賞卡（admin 監控有開關可以改成看得到）。
//   ・瀏覽器保留最近 10 場（儲存見 replay-store.ts）。
//
// 資料格式刻意與錦標賽回放（伺服器 /api/tournament/replay）一致：
//   { meta, finalLog, finalState, snapshots: [{ turn, activePlayerIndex, logLen, state }] }
//   ⇒ 對戰頁的回放畫面（tReplaySteps／tReplayGoto）不用分兩套。
//   每份快照把 log 清空（log 佔盤面約 7 成），播放時用 logLen 從 finalLog 切出「到這一步為止」的紀錄。

import type { GameState } from './types';

export const REPLAY_FORMAT = 'ptcg-tw-sim-replay';
export const REPLAY_FORMAT_VERSION = 1;
/** 被遮住的卡（redact 後）用的卡號：卡表裡不存在 ⇒ 畫面一律畫卡背、取不到卡名。 */
export const HIDDEN_CARD_ID = '__HIDDEN__';   // 與錦標賽遮蔽（v6.150 伺服器 _redactStateForSeat）同一個佔位卡號，畫面既有的處理直接沿用
/** 單場最多記幾步（防呆：正常一場 100～300 步；異常無限迴圈時不把記憶體吃光）。 */
export const MAX_REPLAY_STEPS = 4000;

export type ReplayKind = 'local' | 'ai' | 'online' | 'tournament';

export interface ReplayStep {
  turn: number;
  activePlayerIndex: 0 | 1 | null;
  logLen: number;
  state: GameState;
}

export interface ReplayMeta {
  kind: ReplayKind;
  gameId: string;
  p1name: string | null;
  p2name: string | null;
  winnerName: string | null;
  finalTurn: number | null;
  savedAt: number;
  appVersion: string;
  /** 線上對戰：記錄者坐哪一側（復盤時固定這一側在下方）；本機雙人／AI＝null */
  viewerSeat: 0 | 1 | null;
  /** true＝雙方手牌、獎賞卡都看得到；false＝已遮住記錄者當時看不到的資訊 */
  revealed: boolean;
}

export interface ReplayData {
  format: typeof REPLAY_FORMAT;
  v: number;
  meta: ReplayMeta;
  finalLog: GameState['log'];
  finalState: GameState | null;
  snapshots: ReplayStep[];
}

export interface ReplayRecorder {
  gameId: string;
  steps: ReplayStep[];
  lastKey: string;
}

/** 快照本體：清掉 log（播放時從 finalLog 切），其餘深拷貝。 */
export function snapshotOf(state: GameState): GameState {
  return JSON.parse(JSON.stringify({ ...state, log: [] })) as GameState;
}

export function createReplayRecorder(gameId: string, resumeSteps: ReplayStep[] = []): ReplayRecorder {
  const steps = resumeSteps.slice(0, MAX_REPLAY_STEPS);
  const last = steps[steps.length - 1];
  return { gameId, steps, lastKey: last ? JSON.stringify(last.state) : '' };
}

/** 只記正式對戰中的盤面（setup 階段雙方的秘密佈局不記；game-over 由 finalState 補）。 */
export function isRecordablePhase(state: GameState | null | undefined): boolean {
  return !!state && state.phase === 'playing';
}

/**
 * 記一步。回傳 true＝有新增。
 *   ・盤面沒變（同一份內容重複推過來）⇒ 不記。
 *   ・log 變短（線上樂觀更新被伺服器退回、或 undo）⇒ 先把「比它新」的步驟丟掉再記（時間軸不會分岔）。
 *   ・換了一局（gameId 不同）⇒ 呼叫端應該新建 recorder；這裡直接拒記。
 */
export function recordStep(rec: ReplayRecorder, state: GameState): boolean {
  if (!isRecordablePhase(state) || state.id !== rec.gameId) return false;
  const snap = snapshotOf(state);
  const key = JSON.stringify(snap);
  if (key === rec.lastKey) return false;
  const logLen = Array.isArray(state.log) ? state.log.length : 0;
  let popped = false;
  while (rec.steps.length && rec.steps[rec.steps.length - 1].logLen > logLen) { rec.steps.pop(); popped = true; }
  if (popped) {
    const last = rec.steps[rec.steps.length - 1];
    rec.lastKey = last ? JSON.stringify(last.state) : '';
    if (key === rec.lastKey) return false;   // 退回到的盤面就是剩下的最後一格 ⇒ 不重複記
  }
  if (rec.steps.length >= MAX_REPLAY_STEPS) return false;
  rec.steps.push({ turn: state.turn ?? 1, activePlayerIndex: (state.activePlayerIndex ?? null) as 0 | 1 | null, logLen, state: snap });
  rec.lastKey = key;
  return true;
}

/** 對局結束 ⇒ 組成一份復盤資料。 */
export function buildReplayData(rec: ReplayRecorder, finalState: GameState, meta: Omit<ReplayMeta, 'gameId' | 'finalTurn' | 'winnerName' | 'p1name' | 'p2name'> & Partial<ReplayMeta>): ReplayData {
  const fs = snapshotOf(finalState);
  const winnerIdx = (finalState as unknown as { winner?: 0 | 1 | null }).winner;
  const names = [finalState.players?.[0]?.name ?? null, finalState.players?.[1]?.name ?? null];
  return {
    format: REPLAY_FORMAT, v: REPLAY_FORMAT_VERSION,
    meta: {
      gameId: rec.gameId, p1name: names[0], p2name: names[1],
      winnerName: winnerIdx === 0 || winnerIdx === 1 ? names[winnerIdx] : null,
      finalTurn: finalState.turn ?? null,
      ...meta,
    } as ReplayMeta,
    finalLog: Array.isArray(finalState.log) ? JSON.parse(JSON.stringify(finalState.log)) : [],
    finalState: fs,
    snapshots: rec.steps.slice(),
  };
}

/**
 * 對局結束時的唯一出口：組資料＋依規則遮蔽（對戰頁只呼叫這一個）。
 *   ・線上對戰：revealOpp（admin 開關）為 false ⇒ 只留記錄者（seat）看得到的資訊。
 *   ・本機雙人／vs AI：同一個人在操作 ⇒ 一律攤開。
 */
export function finalizeReplay(o: { rec: ReplayRecorder; finalState: GameState; online: boolean; seat: 0 | 1 | null; ai: boolean; revealOpp: boolean; appVersion: string; now: number }): ReplayData | null {
  const data = buildReplayData(o.rec, o.finalState, {
    kind: o.online ? 'online' : (o.ai ? 'ai' : 'local'),
    savedAt: o.now, appVersion: o.appVersion, viewerSeat: o.online ? o.seat : null, revealed: true,
  });
  if (o.online && !o.revealOpp) {
    if (o.seat !== 0 && o.seat !== 1) return null;   // 要遮卻不知道記錄者坐哪 ⇒ 寧可不存（審查 P3：不可以退回攤開版）
    return redactReplayForSeat(data, o.seat);
  }
  return data;
}

// ── 遮蔽（線上對戰、admin 開關關閉時）──────────────────────────────────────────
type AnyInst = { iid?: string; cardId?: string; faceUp?: boolean } & Record<string, unknown>;

/**
 * 只留下 seat 這一側玩家當時看得到的資訊：
 *   ・對手手牌 → 卡背（張數保留）
 *   ・雙方獎賞卡 → 卡背（已翻到正面的 faceUp 保留；正式對戰中雙方本來就看得到）
 *   ・雙方牌庫 → 卡背（張數保留；牌庫順序本來就是祕密）
 *   ・待選視窗、連鎖待選、牌庫頂已知順序、棄牌監看暫存清掉（裡面可能有隱藏區的卡）
 * ⚠⚠ 被遮住的卡連 iid 都換成不透明編號（審查 P1：只換卡號的話，同一張卡之後被打出、進棄牌區時會帶真卡號出現，
 *   拿 iid 對照就能還原約一半的對手手牌與牌庫順序）。編號只依「哪一側／哪一區／第幾張」，不帶任何原本的資訊。
 * 棄牌區、場上、放逐區、開局翻開的重抽手牌都是公開資訊，不動。
 */
export function redactStateForSeat(state: GameState, seat: 0 | 1): GameState {
  const st = JSON.parse(JSON.stringify(state)) as GameState & Record<string, unknown>;
  const hide = (side: number, zone: string, j: number): AnyInst => ({ iid: `h${side}${zone}${j}`, cardId: HIDDEN_CARD_ID });
  st.players = st.players.map((p, idx) => {
    const q = { ...p } as typeof p & Record<string, unknown>;
    if (idx !== seat) q.hand = (p.hand ?? []).map((_c, j) => hide(idx, 'h', j)) as unknown as typeof p.hand;
    q.prizes = (p.prizes ?? []).map((c, j) => ((c as unknown as AnyInst).faceUp ? c : hide(idx, 'p', j))) as unknown as typeof p.prizes;
    q.deck = (p.deck ?? []).map((_c, j) => hide(idx, 'd', j)) as unknown as typeof p.deck;
    return q;
  }) as unknown as typeof st.players;
  st.pendingSelection = null as unknown as GameState['pendingSelection'];
  delete st.pendingChainQueue;
  delete st.deckTopKnown;
  delete st._discardWatch;
  return st as GameState;
}

/** 進行中的進度（存進瀏覽器的那份）：線上對戰、開關關閉時一樣先遮再存（審查 P2：中離時那份會一直留著）。 */
export function stepsForStorage(steps: ReplayStep[], o: { online: boolean; seat: 0 | 1 | null; revealOpp: boolean }): ReplayStep[] | null {
  if (!o.online || o.revealOpp) return steps;
  if (o.seat !== 0 && o.seat !== 1) return null;
  const seat = o.seat;
  // ⭐v6.560 複審 P3：每換半回合都會整份重存 ⇒ 已遮蔽過的快照用 WeakMap 快取（快照物件記錄後不再被改寫），
  //   只遮新增的那幾步；終盤不會因為重新遮 200 步而卡一下。結果與逐步重算逐位元相同（守衛 A11）。
  return steps.map((x) => {
    const key = x.state as unknown as object;
    let pair = _redactCache.get(key);
    if (!pair) { pair = [undefined, undefined]; _redactCache.set(key, pair); }
    const hit = pair[seat] ?? (pair[seat] = redactStateForSeat(x.state, seat));
    return { ...x, state: hit };
  });
}
const _redactCache = new WeakMap<object, [ReplayStep['state'] | undefined, ReplayStep['state'] | undefined]>();

/** 整份復盤資料遮蔽：每份快照＋終局盤面；對戰紀錄拿掉對手的私有訊息。 */
export function redactReplayForSeat(data: ReplayData, seat: 0 | 1): ReplayData {
  const other = (1 - seat) as 0 | 1;
  return {
    ...data,
    meta: { ...data.meta, viewerSeat: seat, revealed: false },
    finalLog: (data.finalLog ?? []).map((e) => {
      if (!e || e.playerIndex !== other || e.privateMessage == null) return e;
      const { privateMessage: _drop, ...rest } = e as typeof e & { privateMessage?: string };
      return rest as typeof e;
    }),
    finalState: data.finalState ? redactStateForSeat(data.finalState, seat) : null,
    snapshots: data.snapshots.map((s) => ({ ...s, state: redactStateForSeat(s.state, seat) })),
  };
}

/** 讀進來的檔案是不是合法的復盤資料（匯入用；不合格回錯誤訊息）。 */
export function validateReplayData(x: unknown): string | null {
  const d = x as Partial<ReplayData> | null;
  if (!d || typeof d !== 'object') return '檔案內容不是復盤資料';
  if (d.format !== REPLAY_FORMAT) return '這不是本站的復盤檔';
  if (typeof d.v !== 'number' || d.v > REPLAY_FORMAT_VERSION) return '復盤檔版本太新，請先重新整理網站更新到最新版';
  if (!d.meta || !Array.isArray(d.snapshots) || !Array.isArray(d.finalLog)) return '復盤檔內容不完整';
  if (d.snapshots.length === 0 && !d.finalState) return '這份復盤檔沒有任何盤面';
  for (const s of d.snapshots) if (!s || typeof s !== 'object' || !s.state || !Array.isArray((s.state as GameState).players)) return '復盤檔內容損毀';
  return null;
}

// ── 播放：跳到上／下一回合 ─────────────────────────────────────────────────
/** 播放用的每一格（與對戰頁 tReplaySteps 同形）。 */
export interface ReplayPlayStep { turn: number; activePlayerIndex: 0 | 1 | null; isFinal?: boolean }

/** 半回合的識別（回合數＋行動方）。 */
const halfKey = (s: ReplayPlayStep) => `${s.turn}|${s.activePlayerIndex}`;

/** 從第 i 格往後，下一個「換人／換回合」的第一格；沒有就回最後一格。 */
export function nextTurnStepIndex(steps: ReplayPlayStep[], i: number): number {
  if (!steps.length) return 0;
  const cur = Math.min(Math.max(0, i), steps.length - 1);
  const k = halfKey(steps[cur]);
  for (let j = cur + 1; j < steps.length; j++) if (steps[j].isFinal || halfKey(steps[j]) !== k) return j;
  return steps.length - 1;
}

/** 從第 i 格往前：若不在這個半回合的第一格 ⇒ 回到這個半回合的第一格；已經在第一格 ⇒ 上一個半回合的第一格。 */
export function prevTurnStepIndex(steps: ReplayPlayStep[], i: number): number {
  if (!steps.length) return 0;
  const cur = Math.min(Math.max(0, i), steps.length - 1);
  const startOf = (x: number) => { const k = halfKey(steps[x]); let j = x; while (j > 0 && !steps[j - 1].isFinal && halfKey(steps[j - 1]) === k) j--; return j; };
  const s = startOf(cur);
  if (s < cur) return s;
  return s > 0 ? startOf(s - 1) : 0;
}
