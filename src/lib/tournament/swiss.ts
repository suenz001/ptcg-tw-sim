/**
 * 瑞士制 + 單淘汰 Top Cut 純函式（無副作用、無瀏覽器／Node 依賴）。
 * 供 harness 測試 + 伺服器端配對共用。規則對齊 Play! Pokémon 慣例。
 * Wilson 拍板：不容許平手(時限用獎賞卡判)、依人數自動 Top Cut(≤16→4/≥17→8)、
 *   輪數自動帶值 admin 可覆寫、每輪設時限、棄賽者後續不再配對。
 */

export type SwissResult = 'W' | 'L' | 'T' | 'BYE';

export interface SwissPlayer {
  uid: string;
  name: string;
  matchPoints: number;      // 累計積分（勝3 / 平1 / 負0 / Bye3）
  opponents: string[];      // 交手過的對手 uid（Bye 不列入 → 不算進 OWP）
  results: SwissResult[];   // 每輪結果（含 'BYE'）
  byes: number;             // 已獲得 Bye 次數（每人整場最多 1）
  dropped?: boolean;        // 中途棄賽 → 不再配對
  seed?: number;            // 初始種子（可選；第 1 輪排序用）
}

export interface SwissPairing {
  p1: string;
  p2: string | null;        // null = 該輪 Bye（p1 直接 +3）
}

// ════════ 輪數 / Top Cut 對照（admin 可覆寫）════════
export function swissRoundsForCount(n: number): number {
  if (n <= 1) return 0;
  if (n <= 8) return 3;
  if (n <= 16) return 4;
  if (n <= 32) return 5;
  if (n <= 64) return 6;
  if (n <= 128) return 7;
  return 8;
}
export function topCutSizeForCount(n: number): number {
  if (n < 4) return Math.min(2, n);   // 極小場
  if (n <= 16) return 4;
  return 8;
}

// ════════ 勝率 / 破同分（OWP / OOWP；25% 下限；Bye 排除）════════
function nonByeRounds(p: SwissPlayer): number { return p.results.filter((r) => r !== 'BYE').length; }
function nonByePoints(p: SwissPlayer): number { return Math.max(0, p.matchPoints - 3 * p.byes); }

/** 單人勝率：排除 Bye 輪後 matchPoints/(3×場次)，下限 0.25。 */
export function winPct(p: SwissPlayer): number {
  const g = nonByeRounds(p);
  if (g <= 0) return 0.25;
  return Math.max(0.25, nonByePoints(p) / (3 * g));
}
export function computeOWP(p: SwissPlayer, byUid: Map<string, SwissPlayer>): number {
  const opps = p.opponents.map((u) => byUid.get(u)).filter(Boolean) as SwissPlayer[];
  if (opps.length === 0) return 0;
  return opps.reduce((s, o) => s + winPct(o), 0) / opps.length;
}
export function computeOOWP(p: SwissPlayer, byUid: Map<string, SwissPlayer>): number {
  const opps = p.opponents.map((u) => byUid.get(u)).filter(Boolean) as SwissPlayer[];
  if (opps.length === 0) return 0;
  return opps.reduce((s, o) => s + computeOWP(o, byUid), 0) / opps.length;
}

export interface Standing extends SwissPlayer { owp: number; oowp: number; rank: number; }

/** 依「積分 → OWP → OOWP → seed → uid」排總名次（最後兩層保證穩定、可重現）。 */
export function computeStandings(players: SwissPlayer[]): Standing[] {
  const byUid = new Map(players.map((p) => [p.uid, p]));
  const out = players.map((p) => ({ ...p, owp: computeOWP(p, byUid), oowp: computeOOWP(p, byUid), rank: 0 }));
  out.sort((a, b) =>
    b.matchPoints - a.matchPoints ||
    b.owp - a.owp ||
    b.oowp - a.oowp ||
    (a.seed ?? 9999) - (b.seed ?? 9999) ||
    a.uid.localeCompare(b.uid));
  out.forEach((p, i) => (p.rank = i + 1));
  return out;
}

// ════════ 每輪配對 ════════
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * 第 roundIndex 輪（1-based）配對。
 * - 第 1 輪：有 seed 照 seed，否則隨機。
 * - 第 2 輪起：依目前 standing 排序（同分相近），貪婪配對並避開重賽，找不到才被迫 rematch。
 * - 全場奇數：給「最低名次、未拿過 Bye」者 Bye（皆拿過則最低名次）。
 * - dropped 玩家排除，不再配對。
 */
export function pairSwissRound(players: SwissPlayer[], roundIndex: number, rng: () => number = Math.random): SwissPairing[] {
  const active = players.filter((p) => !p.dropped);
  if (active.length === 0) return [];

  let ordered: SwissPlayer[];
  if (roundIndex <= 1) {
    ordered = active.some((p) => p.seed != null)
      ? [...active].sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999))
      : shuffle(active, rng);
  } else {
    ordered = computeStandings(active);
  }

  // 全場奇數 → 指派 Bye（最低名次、byes===0 優先）
  let byeUid: string | null = null;
  if (ordered.length % 2 === 1) {
    for (let i = ordered.length - 1; i >= 0; i--) { if ((ordered[i].byes ?? 0) === 0) { byeUid = ordered[i].uid; break; } }
    if (!byeUid) byeUid = ordered[ordered.length - 1].uid;
    ordered = ordered.filter((p) => p.uid !== byeUid);
  }

  // 貪婪避重賽：從名次高者起，配下一個沒交手過的；全交手過才被迫 rematch（取名次最接近）
  const oppOf = new Map(players.map((p) => [p.uid, new Set(p.opponents)]));
  const remaining = ordered.slice();
  const pairings: SwissPairing[] = [];
  while (remaining.length > 0) {
    const a = remaining.shift() as SwissPlayer;
    let idx = remaining.findIndex((b) => !oppOf.get(a.uid)!.has(b.uid));
    if (idx === -1) idx = 0;
    const b = remaining.splice(idx, 1)[0];
    pairings.push({ p1: a.uid, p2: b.uid });
  }
  if (byeUid) pairings.push({ p1: byeUid, p2: null });
  return pairings;
}

// ════════ 從對戰紀錄重建 standings（伺服器把 TMATCH 餵進來）════════
export interface MatchRecord {
  round: number;
  p1uid: string;
  p2uid: string | null;   // null = Bye
  winnerUid: string | null;
  bye?: boolean;
  status?: string;        // 'pending' | 'playing' | 'done' …；未結束(非 done 且無 winner)= 尚未有結果,不可計分
}
/**
 * 由「已完成的瑞士輪對戰紀錄 + 參賽者名單」重建每人的 SwissPlayer（積分/對手/結果/Bye）。
 * 不容許平手：有 winner → 勝方+3記W、敗方記L；Bye → +3記BYE；無 winner(雙未進場) → 雙方記L不得分。
 * 給伺服器在每輪結束時呼叫，再丟進 pairSwissRound / computeStandings。
 */
export function buildSwissPlayersFromMatches(
  matches: MatchRecord[],
  regs: Array<{ uid: string; name: string; dropped?: boolean }>,
): SwissPlayer[] {
  const byUid = new Map<string, SwissPlayer>(
    regs.map((r) => [r.uid, { uid: r.uid, name: r.name, matchPoints: 0, opponents: [], results: [], byes: 0, dropped: r.dropped }]),
  );
  const sorted = [...matches].sort((a, b) => (a.round || 0) - (b.round || 0));
  for (const m of sorted) {
    if (m.bye || m.p2uid == null) {
      const p = byUid.get(m.p1uid); if (!p) continue;
      p.matchPoints += 3; p.byes += 1; p.results.push('BYE');
      continue;
    }
    // 只計已結束的對戰：有 winner=勝負已定；無 winner 但 status==='done'=雙未進場(雙敗)。
    // 未結束(pending/playing、尚未產生結果)→ 跳過，絕不可當雙敗計分（否則剛配好還沒打的下一輪會被誤記兩敗）。
    const resolved = m.winnerUid != null || m.status === 'done';
    if (!resolved) continue;
    const a = byUid.get(m.p1uid), b = byUid.get(m.p2uid);
    if (a && b) { a.opponents.push(b.uid); b.opponents.push(a.uid); }
    if (m.winnerUid) {
      const w = byUid.get(m.winnerUid);
      const lUid = m.winnerUid === m.p1uid ? m.p2uid : m.p1uid;
      const l = lUid ? byUid.get(lUid) : undefined;
      if (w) { w.matchPoints += 3; w.results.push('W'); }
      if (l) l.results.push('L');
    } else {
      // status==='done' 且無 winner = 雙未進場/雙敗
      if (a) a.results.push('L');
      if (b) b.results.push('L');
    }
  }
  return [...byUid.values()];
}

// ════════ Top Cut 種子配置 ════════
function nextPow2(n: number): number { let p = 1; while (p < n) p *= 2; return p; }
/** 標準單淘汰種子位置（讓種子 1 與 2 在決賽才碰）。回傳長度 size 的種子序（1-based）。 */
function seedSlots(size: number): number[] {
  let slots = [1, 2];
  while (slots.length < size) {
    const n = slots.length * 2;
    const next: number[] = [];
    for (const s of slots) { next.push(s); next.push(n + 1 - s); }
    slots = next;
  }
  return slots;
}
/** 取前 K（依 standings）產生第 1 輪單淘汰配對；K 非 2 次方 → 高種子輪空。 */
export function seedTopCut(standings: Standing[], K: number): SwissPairing[] {
  const cut = standings.slice(0, Math.min(K, standings.length));
  const n = cut.length;
  if (n <= 1) return [];
  const size = nextPow2(n);
  const order = seedSlots(size);
  const slotPlayer = (seed: number): string | null => (seed <= n ? cut[seed - 1].uid : null);
  const pairings: SwissPairing[] = [];
  for (let i = 0; i < size; i += 2) {
    const p1 = slotPlayer(order[i]), p2 = slotPlayer(order[i + 1]);
    if (p1 && p2) pairings.push({ p1, p2 });
    else if (p1 && !p2) pairings.push({ p1, p2: null });
    else if (!p1 && p2) pairings.push({ p1: p2, p2: null });
  }
  return pairings;
}
