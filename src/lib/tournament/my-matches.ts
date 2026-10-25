// ⭐v6.563 開始對戰頁的復盤清單：自己最近的錦標賽對戰（站長 2026-10-13：「把錦標賽的對戰也讓玩家可以在這邊找到自己最近的錦標賽復盤紀錄」）。
//   資料來源：伺服器 v1.66 的 GET /api/my-tourn-matches（要帶 Firebase 登入憑證；匿名／未登入回 needLogin）。
//   觀看走既有的錦標賽回放（/api/tournament/replay，每個動作一格）。舊伺服器 404 ⇒ 這一區不顯示。

export const MY_TOURN_MATCHES_URL = '/api/my-tourn-matches';

export interface MyTournMatch {
  matchId: string; eventName: string; round: number | null; p1name: string; p2name: string; winnerName: string | null; at: number;
  /** ⭐v6.601 自己這一場的結果（伺服器 v1.74 起才有；舊伺服器沒有 ⇒ 不標）。draw＝沒有勝者（時限雙敗、雙方棄權），畫面顯示「雙敗」。 */
  result?: 'win' | 'loss' | 'draw';
}
export interface MyTournMatches { needLogin: boolean; matches: MyTournMatch[] }

/** 伺服器回應 → 清單；不是這支端點的回應 ⇒ null（畫面不顯示錦標賽那一區）。 */
export function parseMyTournMatches(j: unknown): MyTournMatches | null {
  const o = j as { myTournApi?: unknown; needLogin?: unknown; matches?: unknown } | null;
  if (!o || o.myTournApi !== 1) return null;
  const arr = Array.isArray(o.matches) ? o.matches : [];
  const matches: MyTournMatch[] = [];
  for (const m of arr as Array<Record<string, unknown>>) {
    if (!m || typeof m.matchId !== 'string' || !m.matchId) continue;
    matches.push({
      matchId: m.matchId, eventName: typeof m.eventName === 'string' ? m.eventName : '',
      round: Number.isFinite(m.round) ? (m.round as number) : null,
      p1name: typeof m.p1name === 'string' ? m.p1name : '', p2name: typeof m.p2name === 'string' ? m.p2name : '',
      winnerName: typeof m.winnerName === 'string' && m.winnerName ? m.winnerName : null,
      at: Number.isFinite(m.at) ? (m.at as number) : 0,
      ...(m.result === 'win' || m.result === 'loss' || m.result === 'draw' ? { result: m.result } : {}),   // ⭐v6.601 只收三個合法值
    });
  }
  return { needLogin: o.needLogin === true, matches };
}

/** 清單的一行說明：「10/13 21:40・網站賽-150【21:00 瑞士制】・第 3 輪・🏆 玩家A」 */
export function myTournMatchLine(m: MyTournMatch): string {
  const d = new Date(m.at || 0);
  const when = m.at ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  // ⭐v6.601（審查 P3-1）前面的標籤已經寫「雙敗」⇒ 說明行不再重複
  return [when, m.eventName, m.round != null ? `第 ${m.round} 輪` : '', m.winnerName ? '🏆 ' + m.winnerName : (m.result === 'draw' ? '' : '雙敗')].filter(Boolean).join('・');
}
