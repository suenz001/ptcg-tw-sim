/**
 * ⭐ v6.649 回放的共用索引（每載入一份回放只建一次；鍵盤快捷鍵、步驟摘要、紀錄定位、之後的時間軸節點都讀這一份）。
 *
 * 設計（2026-11-16 回放 R1／R2／R3／R5／R6 交接提示詞）：
 *   ・每一格（step）→ 回合／行動方、這一格「新增」了哪幾行對戰紀錄。
 *   ・對戰紀錄第 k 行 → 第一個包含它的格（定位用）。
 *   ・回合開頭 → 一律用 replay-record.ts 的 nextTurnStepIndex 走出來，不另寫一套「換回合」判準。
 *   ・「這一格顯示到哪裡」與對戰頁 tReplayGoto 切 log 用同一支 replayStepLog（唯一判準）。
 *
 * ⚠ logLen 不是動作編號：同一個 logLen 可能連續好幾格（盤面變了但沒有新紀錄）、也可能缺（舊資料）。
 *   ・沒有新紀錄的格 ⇒ 摘要寫「盤面更新」。
 *   ・整份回放都沒有 logLen（回放上線前的舊對戰）⇒ turnOnly＝true，畫面提示「此回放僅提供回合級定位」。
 * ⚠ 隱藏資訊：摘要只讀每行的公開 message，絕不讀 privateMessage。
 * ⚠ 純函式、不碰 DOM、不發請求；O(格數＋紀錄行數)。
 */
import { nextTurnStepIndex, type ReplayPlayStep } from './replay-record';

/** 回放的一格（與對戰頁 tReplaySteps 同形；只列這裡用到的欄位）。 */
export interface ReplayIndexStep extends ReplayPlayStep {
  logLen: number | null;
  /** 這一格的盤面（v6.650 昏厥節點用；沒有就不算昏厥） */
  state?: ReplayStateLite | null;
}

/** 盤面裡昏厥偵測用到的欄位（只讀場上與棄牌區的 iid／cardId） */
interface ReplayInstLite { iid?: string; cardId?: string }
interface ReplayPlayerLite { active?: ReplayInstLite | null; bench?: (ReplayInstLite | null)[] | null; discard?: (ReplayInstLite | null)[] | null; prizes?: unknown[] | null }
export interface ReplayStateLite { players?: (ReplayPlayerLite | null | undefined)[] }

/**
 * ⭐v6.650 昏厥事件（R2 時間軸節點）：不看紀錄文字，看盤面——
 *   前一格在某位玩家場上（戰鬥位／備戰）的寶可夢實例，這一格不在場上、而且出現在「同一位玩家」的棄牌區 ⇒ 那位玩家的寶可夢昏厥。
 *   ・誰的寶可夢一定確定（就是場上那位玩家）⇒ side 一定有值。
 *   ・回到手牌／牌庫、放逐區（不是棄牌區）都不算；進化、撤退、換位實例還在場上，也不算。
 *   ・再對獎賞卡：對手的獎賞卡張數要在這一格起 3 格內減少（取獎可能晚一兩個動作）才算 ⇒ 換場地後被丟棄的備戰、
 *     自願丟棄等「進棄牌區但不是昏厥」不會被算進來（v6.650 審查 P2-1）。代價：不給獎賞卡的昏厥（例：脆弱蛻殼）不會標出來。
 *     盤面沒有獎賞卡欄位（不明格式）⇒ 不做這道確認。
 *   ・同一格可能有多隻（一次招式打倒多隻）⇒ 逐隻列出。
 *   ・終局那一格若與最後一格快照相同 ⇒ 沒有差異，不會重複。
 */
export interface ReplayFaint { step: number; side: 0 | 1; cardId: string }

/** 對戰紀錄的一行（只列這裡用到的欄位）。 */
export interface ReplayLogLine {
  message?: string;
  playerIndex?: number | null;
  turn?: number;
}

/**
 * 第 step 格要顯示的對戰紀錄（tReplayGoto 與索引共用的唯一判準）。
 *   ・終局 ⇒ 整份。
 *   ・缺 logLen（舊資料，那一格是回合開頭的快照）⇒ 只留上一個回合以前的（v5.943）。
 *   ・其他 ⇒ 前 logLen 行。
 */
export function replayStepLog<T extends ReplayLogLine>(step: ReplayIndexStep, fullLog: T[]): T[] {
  if (step.isFinal) return fullLog.slice();
  if (step.logLen == null) { const upto = step.turn; return fullLog.filter((e) => (e.turn ?? 0) < upto); }
  return fullLog.slice(0, step.logLen);
}

export interface ReplayIndex {
  /** 格數 */
  n: number;
  /** 對戰紀錄第 k 行第一次出現在哪一格；-1＝沒有任何一格包含它 */
  lineStep: Int32Array;
  /** 第 i 格新增的紀錄行號：lines.slice(lineStart[i], lineStart[i + 1]) */
  lineStart: Int32Array;
  lines: Int32Array;
  /** 每個半回合的第一格（由 nextTurnStepIndex 走出來，含第 0 格） */
  turnStarts: number[];
  /** 第 i 格屬於第幾個半回合（turnStarts 的索引） */
  halfOf: Int32Array;
  /** 整份都沒有 logLen ⇒ 只有回合級定位 */
  turnOnly: boolean;
  /** ⭐v6.650 昏厥事件（依格排序） */
  faints: ReplayFaint[];
}

/** 由盤面差異找昏厥（純函式；每份回放算一次）。 */
export function replayFaints(steps: ReplayIndexStep[]): ReplayFaint[] {
  const out: ReplayFaint[] = [];
  const fieldOf = (p: ReplayPlayerLite | null | undefined): ReplayInstLite[] => {
    if (!p) return [];
    const a: ReplayInstLite[] = [];
    if (p.active && p.active.iid) a.push(p.active);
    for (const b of p.bench ?? []) if (b && b.iid) a.push(b);
    return a;
  };
  const prizeN = (i: number, side: number): number | null => { const pz = steps[i]?.state?.players?.[side]?.prizes; return Array.isArray(pz) ? pz.length : null; };
  /** 對手（拿獎賞的那一方）的獎賞卡在 [i, i+3] 內比 i-1 少 */
  const oppTookPrize = (i: number, side: number): boolean => {
    const opp = 1 - side, base = prizeN(i - 1, opp);
    if (base === null) return true;
    for (let j = i; j < Math.min(steps.length, i + 4); j++) { const n = prizeN(j, opp); if (n !== null && n < base) return true; }
    return false;
  };
  for (let i = 1; i < steps.length; i++) {
    const A = steps[i - 1]?.state, B = steps[i]?.state;
    if (!A?.players || !B?.players) continue;
    for (const side of [0, 1] as const) {
      const pa = A.players[side], pb = B.players[side];
      if (!pa || !pb) continue;
      const before = fieldOf(pa);
      if (!before.length) continue;
      const after = new Set(fieldOf(pb).map((c) => c.iid));
      let disc: Set<string> | null = null;
      for (const c of before) {
        if (after.has(c.iid)) continue;
        if (!disc) { disc = new Set(); for (const d of pb.discard ?? []) if (d && d.iid) disc.add(d.iid); }
        if (disc.has(c.iid!) && oppTookPrize(i, side)) out.push({ step: i, side, cardId: String(c.cardId ?? '') });
      }
    }
  }
  return out;
}

export interface ReplayTick { step: number; turn: number; side: 0 | 1 | null }
export interface ReplayFaintNode { step: number; side: 0 | 1; count: number; cardIds: string[]; firstStep: number; lastStep: number }

/**
 * ⭐v6.650 時間軸上的記號（R2）：
 *   ・回合記號＝每個半回合的第一格（turnStarts），帶回合數與行動方（不確定 ⇒ null，畫中性色）。
 *   ・昏厥節點：同一位玩家、位置相近（相差不到 mergeFrac × 總長）的合併成一顆，顯示數量；點下去跳到那一群的第一格。
 *   ・mergeFrac 讓手機（窄）合併得多一點、桌機少一點。
 */
export function replayTimelineMarks(idx: ReplayIndex, steps: ReplayIndexStep[], mergeFrac = 0.012): { ticks: ReplayTick[]; faints: ReplayFaintNode[] } {
  const ticks: ReplayTick[] = idx.turnStarts.map((st) => {
    const s = steps[st];
    const ap = s?.activePlayerIndex;
    return { step: st, turn: Number(s?.turn ?? 0), side: s?.isFinal ? null : (ap === 0 || ap === 1 ? ap : null) };
  });
  const span = Math.max(1, idx.n - 1), gap = Math.max(0, mergeFrac) * span;
  const faints: ReplayFaintNode[] = [];
  const last: Record<number, ReplayFaintNode | undefined> = {};
  for (const f of idx.faints) {
    const g = last[f.side];
    if (g && f.step - g.lastStep <= gap) { g.count++; g.cardIds.push(f.cardId); g.lastStep = f.step; continue; }
    const node: ReplayFaintNode = { step: f.step, side: f.side, count: 1, cardIds: [f.cardId], firstStep: f.step, lastStep: f.step };
    faints.push(node); last[f.side] = node;
  }
  return { ticks, faints };
}

/** 建索引（每份回放一次）。 */
export function buildReplayIndex(steps: ReplayIndexStep[], fullLog: ReplayLogLine[]): ReplayIndex {
  const n = steps.length, L = fullLog.length;
  const lineStep = new Int32Array(L).fill(-1);
  // ── 對戰紀錄第 k 行 → 第一個包含它的格 ──
  //   前綴型（有 logLen／終局）：第 i 格包含 [0, len_i) ⇒ 掃描時記「已涵蓋到哪一行」，每行只指派一次。
  //   回合過濾型（缺 logLen）：第 i 格包含 turn < upto 的行 ⇒ 先把行號依 turn 穩定排序，同樣用「已涵蓋到的 upto」往前推。
  let prefMax = 0;
  const byTurn = Array.from({ length: L }, (_, k) => k).sort((a, b) => ((fullLog[a].turn ?? 0) - (fullLog[b].turn ?? 0)) || (a - b));
  let q = 0;
  for (let i = 0; i < n; i++) {
    const s = steps[i];
    if (s.isFinal || s.logLen != null) {
      // slice(0, x) 的實際長度（與 replayStepLog 一致，含負數的 slice 語義）
      const len = s.isFinal ? L : (s.logLen! < 0 ? Math.max(0, L + s.logLen!) : Math.min(s.logLen!, L));
      for (let k = prefMax; k < len; k++) if (lineStep[k] < 0) lineStep[k] = i;
      if (len > prefMax) prefMax = len;
    } else {
      const upto = s.turn;
      while (q < L && (fullLog[byTurn[q]].turn ?? 0) < upto) { const k = byTurn[q]; if (lineStep[k] < 0) lineStep[k] = i; q++; }
    }
  }
  // ── 每一格新增的行（CSR）──
  const cnt = new Int32Array(n + 1);
  for (let k = 0; k < L; k++) if (lineStep[k] >= 0) cnt[lineStep[k] + 1]++;
  for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
  const lineStart = cnt.slice();
  const fill = cnt.slice(0, n);
  const lines = new Int32Array(cnt[n]);
  for (let k = 0; k < L; k++) { const i = lineStep[k]; if (i >= 0) lines[fill[i]++] = k; }
  // ── 半回合開頭：沿用 nextTurnStepIndex（不另寫判準）──
  const turnStarts: number[] = [];
  const halfOf = new Int32Array(n);
  if (n > 0) {
    turnStarts.push(0);
    let j = 0;
    while (j < n - 1) {
      const nx = nextTurnStepIndex(steps, j);
      if (nx <= j) break;
      // nextTurnStepIndex 找不到下一個半回合時回最後一格 ⇒ 那一格若仍與第 j 格同一個半回合（且不是終局）就不算新的開頭
      const sameHalf = !steps[nx].isFinal && steps[nx].turn === steps[j].turn && steps[nx].activePlayerIndex === steps[j].activePlayerIndex;
      if (sameHalf) break;
      turnStarts.push(nx);
      j = nx;
    }
    let h = 0;
    for (let i = 0; i < n; i++) { while (h + 1 < turnStarts.length && turnStarts[h + 1] <= i) h++; halfOf[i] = h; }
  }
  const turnOnly = !steps.some((s) => !s.isFinal && s.logLen != null);
  return { n, lineStep, lineStart, lines, turnStarts, halfOf, turnOnly, faints: replayFaints(steps) };
}

/** 第 i 格新增的紀錄行號（依原始順序）。 */
export function replayStepLines(idx: ReplayIndex, i: number): number[] {
  if (i < 0 || i >= idx.n) return [];
  return Array.from(idx.lines.subarray(idx.lineStart[i], idx.lineStart[i + 1]));
}

export interface ReplayStepSummary {
  /** 確定是誰做的（新增的每一行若有行動者都是同一個人）；不確定 ⇒ null（畫面用中性的寫法） */
  actor: 0 | 1 | null;
  /** 代表這一格的那一行（公開 message）；沒有新紀錄 ⇒ '' */
  text: string;
  /** 新增的行數 */
  count: number;
}

/** 第 i 格的摘要（只讀公開的 message）。 */
export function replayStepSummary(idx: ReplayIndex, i: number, fullLog: ReplayLogLine[]): ReplayStepSummary {
  const ks = replayStepLines(idx, i);
  if (ks.length === 0) return { actor: null, text: '', count: 0 };
  let actor: 0 | 1 | null = null, mixed = false, pick = -1;
  for (const k of ks) {
    const p = fullLog[k]?.playerIndex;
    if (p === 0 || p === 1) {
      if (pick < 0) pick = k;
      if (actor === null) actor = p; else if (actor !== p) mixed = true;
    }
  }
  if (pick < 0) pick = ks[0];
  const text = String(fullLog[pick]?.message ?? '').replace(/\s+/g, ' ').trim();
  return { actor: mixed ? null : actor, text, count: ks.length };
}
