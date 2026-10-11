/**
 * ⭐v6.525 休閒對戰「回到我之前的房間」中央模組（站長 2026-10-11）。
 *
 * 玩家回報：開房後把網頁關掉重開、重新登入，前面開的舊房間進不去。
 * 站長：「要讓開房的房主可以回去他開過房的舊房間（當然如果他要開新房間也是可以的）」。
 *
 * 現況（查證過）：
 *   ・休閒房的座位只用 Oracle 匿名 uid 認人（findMySeatIdx）；uid 存在瀏覽器 localStorage（30 天 JWT）。
 *   ・房主關掉頁面就沒有心跳 ⇒ 大廳列表 3 分鐘後把房藏起來（isLobbyHostDead）、開房 10 分鐘後也藏
 *     （isLobbyTooOld）；伺服器 5 分鐘沒寫入就刪掉 lobby 房。藏起來的房房主看不到、只剩房號能回去。
 *   ・換瀏覽器／無痕／清資料 ⇒ uid 換新 ⇒ 點自己的舊房會被當成新玩家坐進 P2，等一個不會回來的「自己」。
 *
 * 兩個來源（都只認 p1／p2 座位）：
 *   ① 同一個瀏覽器：大廳輪詢拿到的**未過濾**原始列表裡，有我的 uid 的房（匿名玩家也適用）。
 *   ② 登入玩家：伺服器 GET /api/my-room 用驗過的 email 找（換瀏覽器也找得到），
 *      回去時先 POST /api/my-room/reclaim-seat 把座位綁回現在的 uid。
 *
 * ⚠ 本檔只放純函式與兩支 fetch，畫面狀態留在 game/+page.svelte。
 */
import { auth } from '$lib/firebase';
import { findMySeatIdx, SEAT_LAYOUT_VERSION, type Room } from './room';

/** 大廳「你之前的房間」一列。 */
export interface MyOldRoom {
  roomId: string;
  roomName: string;
  /** null＝不知道（email 來源、房間不在大廳列表前 100 間裡）；不知道時絕不自動釋放（可能在對戰中）。 */
  status: 'lobby' | 'playing' | null;
  /** 0＝P1（房主）、1＝P2；email 來源還沒認回時是 null。 */
  seatIdx: 0 | 1 | null;
  /** 'uid'＝同一個瀏覽器認得；'email'＝要先向伺服器認回座位。 */
  via: 'uid' | 'email';
  /** 我那個座位最後一次心跳（ms）；不知道＝null。用來判斷「是不是還有分頁開著這間房」。 */
  lastSeenAt: number | null;
}

function hbMs(hbs: unknown, idx: number): number | null {
  const v = hbs && typeof hbs === 'object' ? (hbs as Record<string, unknown>)[idx] : undefined;
  if (typeof v === 'number') return v;
  if (v && typeof (v as { seconds?: number }).seconds === 'number') return (v as { seconds: number }).seconds * 1000;
  return null;
}

/**
 * 純函式：從大廳**未過濾**的原始列表找出「我坐在 p1／p2」的房（lobby／playing）。
 *   ⚠ 刻意不套 filterAndSortOpenRooms 的死房／過久／私密房過濾：那些是「給別人看的」列表規則，
 *     自己的房不管有沒有被藏起來都要能回去。
 *   ⚠ excludeRoomId：現在已經在裡面的那一間不列。
 */
export function myRoomsFromList(raw: readonly Partial<Room>[] | null | undefined, uid: string | null | undefined, excludeRoomId?: string | null): MyOldRoom[] {
  if (!uid || !Array.isArray(raw)) return [];
  const out: MyOldRoom[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const id = String((r as { roomId?: string }).roomId ?? (r as { _id?: string })._id ?? '').toUpperCase();
    if (!id || seen.has(id) || (excludeRoomId && id === String(excludeRoomId).toUpperCase())) continue;
    if (r.status !== 'lobby' && r.status !== 'playing') continue;
    if ((r.schemaVersion ?? 1) < SEAT_LAYOUT_VERSION) continue;
    const idx = findMySeatIdx((r.seats ?? []) as Room['seats'], uid);
    if (idx !== 0 && idx !== 1) continue;
    seen.add(id);
    out.push({ roomId: id, roomName: String(r.roomName || id), status: r.status, seatIdx: idx, via: 'uid', lastSeenAt: hbMs((r as { heartbeats?: unknown }).heartbeats, idx) });
  }
  return out;
}

/**
 * 純函式：合併兩個來源（同一間以 uid 來源為準，因為不用再認座位）。
 *   emailRoom：伺服器回的房號＋從列表／單間查詢補上的房名與狀態；null／undefined ⇒ 沒有。
 */
export function mergeMyOldRooms(byUid: MyOldRoom[], emailRoom: MyOldRoom | null | undefined, excludeRoomId?: string | null): MyOldRoom[] {
  const out = byUid.slice();
  if (emailRoom && emailRoom.roomId && !(excludeRoomId && emailRoom.roomId === String(excludeRoomId).toUpperCase())
      && !out.some((x) => x.roomId === emailRoom.roomId)) out.push(emailRoom);
  return out;
}

/**
 * 純函式：開新房時可以自動釋放的舊房（Fable 審查 P2-3）。
 *   只放：同一個瀏覽器認得的（via 'uid'）、還在等待中（lobby）、不是剛開的那間、而且我那個座位的心跳已經停了超過 awayMs
 *   （有心跳＝還有分頁開著這間房在用，不可以關掉）。
 *   ⚠ email 來源一律不自動釋放：那是別的瀏覽器／裝置的座位，可能還開著。
 */
export function releasableOldRooms(list: readonly MyOldRoom[], newCode: string, now: number, awayMs: number): MyOldRoom[] {
  return list.filter((r) => r.via === 'uid' && r.status === 'lobby' && r.roomId !== String(newCode).toUpperCase()
    && (r.lastSeenAt === null || now - r.lastSeenAt > awayMs));
}

function apiBase(): string {
  return (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
}
async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u || u.isAnonymous || !u.email) return null;   // 匿名一律不發請求
  try { return await u.getIdToken(); } catch { return null; }
}

/**
 * 伺服器：我的 email 現在坐在哪一間休閒房。
 *   回房號／null（確定沒有）／undefined（答不出來：沒登入、舊伺服器、網路錯誤）。
 *   ⚠ undefined 與 null 語義不同：undefined 時畫面不更動 email 來源（沿用上一次的結果）。
 */
export async function fetchMyCasualRoom(fetchImpl: typeof fetch = fetch): Promise<string | null | undefined> {
  const base = apiBase();
  const tok = await idToken();
  if (!base || !tok) return undefined;
  try {
    const res = await fetchImpl(base + '/api/my-room', { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
    if (!res.ok) return undefined;
    const j = await res.json() as { myRoomApi?: number; roomId?: string | null };
    if (!j || j.myRoomApi !== 1 || !('roomId' in j)) return undefined;   // 舊伺服器／伺服器答不出來
    return typeof j.roomId === 'string' && j.roomId ? j.roomId.toUpperCase() : null;
  } catch { return undefined; }
}

/** 伺服器：把我 email 的座位綁回現在的 Oracle uid。 */
export async function reclaimCasualSeat(roomCode: string, uid: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; seatIdx: number } | { ok: false; error: string }> {
  const base = apiBase();
  const tok = await idToken();
  if (!base || !tok) return { ok: false, error: '需要以 email 帳號登入才能認回座位' };
  try {
    const res = await fetchImpl(base + '/api/my-room/reclaim-seat', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: String(roomCode).toUpperCase(), uid }),
      cache: 'no-store',
    });
    let j: { ok?: boolean; seatIdx?: number; error?: string } | null = null;
    try { j = await res.json(); } catch { j = null; }
    if (res.ok && j && j.ok) return { ok: true, seatIdx: Number(j.seatIdx) || 0 };
    return { ok: false, error: (j && typeof j.error === 'string' && j.error) || ('認回座位失敗（' + res.status + '）') };
  } catch {
    return { ok: false, error: '網路連線失敗，請再試一次' };
  }
}
