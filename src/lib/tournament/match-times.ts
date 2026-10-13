// ⭐v6.562 錦標賽賽程表每一場的「對局總時間」（站長 2026-10-13：找出拖時間的對局）。
//   資料來源：伺服器 v1.65 的 GET /api/tourn-match-times?eventId=。
//   時間定義（伺服器算）：第一位玩家進場建局（gameStartedAt）→ 分出勝負（endedAt）；進行中的場次回「到現在為止」（live）。
//   未進場判負沒有對局、不記 endedAt ⇒ 不回、畫面不顯示（不猜）；v1.65 之前結束的投降／判負場次也沒有 endedAt。舊伺服器 404 ⇒ 整欄不顯示。

export const MATCH_TIMES_URL = '/api/tourn-match-times';
/** 前端節流：同一個賽事 30 秒內只問一次（賽程表本來就在輪詢）。 */
export const MATCH_TIMES_REFRESH_MS = 30 * 1000;

export interface MatchTime { ms: number; live: boolean }

export const matchTimeKey = (round: number, idx: number) => `${round}_${idx}`;

/** 伺服器回應 → { 'round_idx': { ms, live } }；不是這支端點的回應 ⇒ null。 */
export function parseMatchTimes(j: unknown): Record<string, MatchTime> | null {
  const o = j as { matchTimesApi?: unknown; times?: unknown } | null;
  if (!o || o.matchTimesApi !== 1 || !Array.isArray(o.times)) return null;
  const out: Record<string, MatchTime> = {};
  for (const t of o.times as Array<{ r?: unknown; i?: unknown; ms?: unknown; live?: unknown }>) {
    if (!t || !Number.isFinite(t.r) || !Number.isFinite(t.i) || !Number.isFinite(t.ms) || (t.ms as number) < 0) continue;
    out[matchTimeKey(t.r as number, t.i as number)] = { ms: t.ms as number, live: t.live === true };
  }
  return out;
}

/** 顯示用：未滿 1 小時「23:05」（分:秒），1 小時以上「1:02:05」。 */
export function fmtMatchDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}

export function matchTimeTitle(t: MatchTime): string {
  return t.live
    ? `進行中，已打 ${fmtMatchDuration(t.ms)}（從第一位玩家進場起算）`
    : `對局總時間 ${fmtMatchDuration(t.ms)}（從第一位玩家進場到分出勝負）`;
}
