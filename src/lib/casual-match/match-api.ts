/**
 * ⭐ v6.645 休閒線上對戰「⚡ 自動配對」的前端 API（伺服器 server_admin_patch.js v1.85 的 /api/casual-match/*）。
 *
 * 站長裁定（2026-11-15）：只做標準賽、配對成功要雙方按接受、開房後開放觀戰、
 *   盡量避免連續同一個對手（真的沒人還是要配）、封鎖名單不配、限定登入玩家。
 *
 * 流程（伺服器只管佇列，不建房間）：
 *   join（帶牌組，伺服器跑標準賽檢查）→ poll 每 3 秒：searching
 *   → found（雙方按接受，15 秒）→ 先排隊的人拿到 host：用既有建房流程開房、回報房號 → 對方拿到 join＋房號，用既有加入流程進房
 *   → 進房後雙方自動帶入牌組、按準備 ⇒ 既有流程自動開局。
 *
 * ⚠ 只有正式站（有 VITE_ORACLE_API_URL）才有伺服器；GitHub Pages 測試站沒有 ⇒ casualMatchAvailable() 為 false，入口整個不顯示。
 * ⚠ 匿名玩家一律不發請求（伺服器也會擋）。
 */
import { auth } from '$lib/firebase';
import type { DeckEntry } from '$lib/decks/types';

export type CasualMatchState = 'idle' | 'searching' | 'found' | 'host' | 'wait-host' | 'hosting' | 'join';

export interface CasualMatchView {
  casualMatchApi: 1;
  state: CasualMatchState;
  waitingCount: number;
  matchId?: string;
  opponentNick?: string;
  accepted?: boolean;
  msLeft?: number;
  waitedMs?: number;
  roomCode?: string;
  notice?: string | null;
}

export type CasualMatchResult =
  | { ok: true; view: CasualMatchView }
  | { ok: false; message: string; code: string; status: number };

function apiBase(): string {
  return (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
}

/** 這個 build 有沒有自動配對伺服器（測試站沒有）。 */
export function casualMatchAvailable(): boolean { return !!apiBase(); }

/** 各狀態下多久查一次（站長最在意伺服器負擔：搜尋中 3 秒；找到對手後要即時，1 秒）。 */
export function casualMatchPollMs(state: CasualMatchState): number {
  if (state === 'found' || state === 'host' || state === 'wait-host') return 1000;
  if (state === 'searching') return 3000;
  return 0;   // idle／hosting／join：不再輪詢
}

async function post(path: string, body: Record<string, unknown>, opts: { keepalive?: boolean } = {}): Promise<CasualMatchResult> {
  const base = apiBase();
  if (!base) return { ok: false, message: '這個網站沒有連線對戰伺服器', code: 'no-api', status: 0 };
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return { ok: false, message: '自動配對限定登入的玩家使用', code: 'casual-match-auth', status: 0 };
  let token = '';
  try { token = await u.getIdToken(); } catch { token = ''; }
  if (!token) return { ok: false, message: '登入狀態失效，請重新登入', code: 'casual-match-auth', status: 0 };
  let res: Response;
  try {
    res = await fetch(base + '/api/casual-match/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      keepalive: opts.keepalive === true,
    });
  } catch {
    return { ok: false, message: '網路連線不穩，請稍後再試', code: 'network', status: 0 };
  }
  let j: Record<string, unknown> | null = null;
  try { j = (await res.json()) as Record<string, unknown>; } catch { j = null; }
  if (!j || j.casualMatchApi !== 1) {
    // 沒有哨兵 ⇒ 伺服器還沒更新到有自動配對的版本
    return { ok: false, message: '伺服器尚未支援自動配對', code: 'unsupported', status: res.status };
  }
  if (!res.ok) return { ok: false, message: String(j.error || '自動配對失敗'), code: String(j.code || 'error'), status: res.status };
  return { ok: true, view: j as unknown as CasualMatchView };
}

export function casualMatchJoin(deckEntries: DeckEntry[], deckName: string, name: string): Promise<CasualMatchResult> {
  return post('join', { deckEntries: deckEntries.map((e) => ({ cardId: String(e.cardId), count: Number(e.count) || 0 })), deckName, name });
}
export function casualMatchPoll(): Promise<CasualMatchResult> { return post('poll', {}); }
export function casualMatchAccept(matchId: string, accept: boolean): Promise<CasualMatchResult> { return post('accept', { matchId, accept }); }
export function casualMatchReportRoom(matchId: string, roomCode: string): Promise<CasualMatchResult> { return post('room', { matchId, roomCode }); }
/** keepalive：關頁面時也送得出去。 */
export function casualMatchLeave(opts: { keepalive?: boolean } = {}): Promise<CasualMatchResult> { return post('leave', {}, opts); }

/** 自動配對開出來的房間名稱（大廳「對戰中」列表與觀戰看得到）。 */
export function casualMatchRoomName(hostName: string, guestName: string): string {
  const a = (hostName || '玩家').slice(0, 12), b = (guestName || '玩家').slice(0, 12);
  return `⚡ 自動配對：${a} vs ${b}`;
}
