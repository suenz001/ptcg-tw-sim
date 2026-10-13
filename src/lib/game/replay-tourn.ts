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
