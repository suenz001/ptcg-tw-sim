// ⭐v6.561 錦標賽回放改成「每個動作一格」（站長 2026-10-13：「也請你順便把錦標賽復盤也改成每個動作一格」）。
//
// 資料來源有兩份：
//   ① 既有的 GET /api/tournament/replay：每半回合一格（v0.82 起），舊對局只有這一份。
//   ② 伺服器 v1.64 新增的 GET /api/replay/tourn-steps：每個動作一格，每半回合 gzip 成一包（base64）。
//      部署之前打完的對局、伺服器重啟時正在進行的那半回合、太舊的瀏覽器（沒有 DecompressionStream）⇒ 沒有這一份。
// 合併規則（mergeTournReplaySteps，唯一一份）：
//   ・某個半回合（turn＋行動方）只要有逐動作資料，就用逐動作那幾格取代原本的半回合格；
//   ・沒有逐動作資料的半回合，保留原本那一格（新舊混合也能完整播放，不會缺一段）；
//   ・排序：logLen 升冪 → 同 logLen 依伺服器版本號（ver）→ 半回合格排在同一進度的逐動作格前面。
// 所有函式都不會 throw：解不開 ⇒ 回空陣列，呼叫端照用原本的半回合格。

import { gunzipText } from './replay-store';
import { REPLAY_FORMAT, REPLAY_FORMAT_VERSION, validateReplayData, replayLabelFields, type ReplayData } from './replay-record';
import type { GameState } from './types';

export const TOURN_STEPS_URL = '/api/replay/tourn-steps';

export interface TournSnap {
  turn: number;
  activePlayerIndex: number | null;
  logLen: number | null;
  state: unknown;
  ver?: number;
  /** ⭐v6.564 伺服器記錄這一格的時間（回放計時器停在這一刻） */
  at?: number;
}

const halfKey = (s: { turn?: number; activePlayerIndex?: number | null }) => `${s.turn ?? 0}_${s.activePlayerIndex ?? 'x'}`;

/** base64 的 gzip 包 → 逐動作格（任何一包壞掉就略過那一包）。 */
export async function decodeTournStepBatches(batches: unknown): Promise<TournSnap[]> {
  if (!Array.isArray(batches)) return [];
  const out: TournSnap[] = [];
  for (const b of batches) {
    if (typeof b !== 'string' || !b) continue;
    try {
      const bin = atob(b);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const arr = JSON.parse(await gunzipText(bytes));
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        if (!s || typeof s !== 'object' || !s.state || typeof s.state !== 'object') continue;
        if (!Number.isFinite(s.logLen) || !Number.isFinite(s.turn)) continue;
        out.push({ turn: s.turn, activePlayerIndex: s.activePlayerIndex ?? null, logLen: s.logLen, state: s.state, ver: Number.isFinite(s.ver) ? s.ver : undefined, at: Number.isFinite(s.at) ? s.at : undefined });
      }
    } catch { /* 這一包解不開：略過，其餘照用 */ }
  }
  return out;
}

/** 半回合格＋逐動作格 → 一份依時序排好的格子（格式同 /replay 的 snapshots）。 */
export function mergeTournReplaySteps(halfTurn: TournSnap[] | null | undefined, perAction: TournSnap[] | null | undefined): TournSnap[] {
  const half = Array.isArray(halfTurn) ? halfTurn : [];
  const acts = Array.isArray(perAction) ? perAction : [];
  if (!acts.length) return half.slice();
  // 舊資料（沒有 logLen）無法跟逐動作格對齊時序 ⇒ 不混用，原樣回傳
  if (half.some((s) => s.logLen == null)) return half.slice();
  // 每個半回合最早的逐動作進度；半回合格（＝那半回合開頭）只有在逐動作資料從開頭就有時才拿掉
  //   （伺服器重啟時遺失了前半段 ⇒ 保留半回合格，不會少掉開頭那一格）
  const firstLen = new Map<string, number>();
  for (const s of acts) { const k = halfKey(s); const v = s.logLen as number; if (!firstLen.has(k) || v < (firstLen.get(k) as number)) firstLen.set(k, v); }
  const keep = half.filter((s) => { const f = firstLen.get(halfKey(s)); return f === undefined || f > (s.logLen as number); });
  const merged = [...keep.map((s) => ({ ...s, _o: 0 })), ...acts.map((s) => ({ ...s, _o: 1 }))];
  merged.sort((a, b) => (a.logLen as number) - (b.logLen as number) || a._o - b._o || (a.ver ?? 0) - (b.ver ?? 0));
  return merged.map(({ _o: _drop, ...s }) => s);
}

/** 抓逐動作資料並合併；伺服器沒有這支端點／抓不到 ⇒ 回原本的半回合格。 */
export async function withTournPerActionSteps(matchId: string, halfTurn: TournSnap[], fetcher: typeof fetch = fetch): Promise<TournSnap[]> {
  try {
    const res = await fetcher(TOURN_STEPS_URL + '?matchId=' + encodeURIComponent(matchId));
    if (!res.ok) return halfTurn;
    const j = await res.json();
    if (!j || j.replayStepsApi !== 1) return halfTurn;
    const acts = await decodeTournStepBatches(j.batches);
    return mergeTournReplaySteps(halfTurn, acts);
  } catch { return halfTurn; }
}

// >>> v6595-tourn-replay-file
/**
 * ⭐v6.595 錦標賽對戰結束時下載復盤檔（玩家建議、站長 2026-10-23：「跟一般對戰的下載方式一樣」）。
 * 伺服器的錦標賽回放（GET /api/tournament/replay，對戰結束後才開放；逐動作格已合併）→ 一般對戰同一種復盤檔格式，
 *   之後一樣可以在「開始對戰 → 🎞️ 復盤」匯入觀看。
 *   ・錦標賽回放本來就是公開、雙方都看得到（?treplay= 分享連結）⇒ revealed=true，不另外遮蔽，也沒有多洩漏任何東西。
 *   ・meta.kind＝'tournament'；viewerSeat＝下載的人坐哪一側（看不出來 ⇒ null，播放時視角自動跟出牌方）。
 *   ・格子缺 logLen（很舊的資料）⇒ 用順序當 logLen；轉完再用 validateReplayData 驗一次，不合格回 null。
 */
export function tournReplayToData(
  server: { meta?: Record<string, unknown> | null; finalLog?: unknown; finalState?: unknown; snapshots?: unknown } | null | undefined,
  opts: { matchId: string; viewerSeat: 0 | 1 | null; appVersion: string; now: number; myDeckName?: unknown },
): ReplayData | null {
  if (!server || typeof server !== 'object') return null;
  const m = (server.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const snaps = (Array.isArray(server.snapshots) ? server.snapshots : []) as TournSnap[];
  const data: ReplayData = {
    format: REPLAY_FORMAT,
    v: REPLAY_FORMAT_VERSION,
    meta: {
      kind: 'tournament',
      gameId: String(opts.matchId).slice(0, 120),
      p1name: str(m.p1name), p2name: str(m.p2name), winnerName: str(m.winnerName),
      finalTurn: typeof m.finalTurn === 'number' ? m.finalTurn : null,
      savedAt: typeof m.endedAt === 'number' && m.endedAt > 0 ? m.endedAt : opts.now,
      appVersion: opts.appVersion,
      viewerSeat: opts.viewerSeat,
      revealed: true,
      // ⭐v6.600 勝敗＋自己的牌組名稱（報名時鎖定的那副）；對手牌組伺服器沒有給 ⇒ 不寫（顯示「未知」、檔名用對手暱稱）
      ...replayLabelFields((server.finalState && typeof server.finalState === 'object' ? server.finalState : null) as GameState | null, opts.viewerSeat, { my: opts.myDeckName }),
    },
    finalLog: (Array.isArray(server.finalLog) ? server.finalLog : []) as GameState['log'],
    finalState: (server.finalState && typeof server.finalState === 'object' ? server.finalState : null) as GameState | null,
    snapshots: snaps.filter((x) => x && x.state && typeof x.state === 'object').map((x, i) => ({
      turn: Number.isFinite(x.turn) ? x.turn : 0,
      activePlayerIndex: x.activePlayerIndex === 0 || x.activePlayerIndex === 1 ? x.activePlayerIndex : null,
      logLen: Number.isFinite(x.logLen) ? (x.logLen as number) : i,
      state: x.state as GameState,
      ...(Number.isFinite(x.at) ? { at: x.at as number } : {}),
    })),
  };
  return validateReplayData(data) ? null : data;
}

/** 錦標賽對戰房 id（'mr_<matchId>'）→ matchId；測試房或其他 ⇒ null */
export function matchIdOfTournRoom(roomId: string | null | undefined): string | null {
  return typeof roomId === 'string' && roomId.startsWith('mr_') && roomId.length > 3 ? roomId.slice(3) : null;
}
// <<< v6595-tourn-replay-file
