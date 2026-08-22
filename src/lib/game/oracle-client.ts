/**
 * v4.61 Oracle backend client — pure fetch wrappers.
 *
 * 提供 firestore-shape 的 API 給 room-oracle.ts (下次 Phase 3b 寫) 用。
 * 此檔不依賴 firebase，純 fetch + 環境變數。
 *
 * 用法：
 *   import { oracleAuth, oracleApi, oraclePollRoom } from './oracle-client';
 *   const room = await oracleApi('/api/rooms/ABCD');
 *   const unsub = oraclePollRoom('ABCD', room => { ... }, 800);
 *
 * 環境變數：
 *   VITE_BACKEND_MODE='firebase' (預設) | 'oracle'
 *   VITE_ORACLE_API_URL='https://xxx.trycloudflare.com'
 */

// ⭐v6.214③ 伺服器單一時鐘（leaf 模組，零 import ⇒ 不可能形成循環）
import { noteServerTime, getServerClockOffsetMs } from './server-clock';

const API_URL: string = ((import.meta as any).env?.VITE_ORACLE_API_URL as string) || '';
const TOKEN_KEY = 'ptcg_oracle_token';
const UID_KEY = 'ptcg_oracle_uid';

let _token: string | null = null;
let _uid: string | null = null;

// ⭐⭐⭐v6.197 身分變動通知。
//   401（JWT 過期/失效）時 oracleApi 會 oracleSignOut() + 重新匿名登入，而伺服器發的是
//   **一個全新的 uid**（v5.628 只想修「卡在 401 建不了房」，沒有人通知畫面端）。
//   畫面端（game/+page.svelte 的 myUid）只在 onMount 取過一次 ⇒ 換 uid 之後
//   `findMySeatIdx(room.seats, myUid)` 永遠回 -1 ⇒ 玩家與觀戰者都變成「認不出座位」，
//   而 v6.197 之前的觀戰判定是 fail-open 的（見 viewer-role.ts）⇒ 觀戰者被當成玩家。
//   ⚠ 這裡只負責「說出去」，要不要相信由呼叫端決定；listener 丟例外不可以打死 API 呼叫。
type OracleUidListener = (uid: string) => void;
const _uidListeners = new Set<OracleUidListener>();
export function onOracleUidChange(cb: OracleUidListener): () => void {
  _uidListeners.add(cb);
  return () => { _uidListeners.delete(cb); };
}
function _setUid(uid: string): void {
  const changed = _uid !== uid;
  _uid = uid;
  if (!changed) return;
  for (const cb of _uidListeners) {
    try { cb(uid); } catch (e) { console.warn('[oracle uid listener]', e); }
  }
}

/** 匿名登入 — 取得 JWT token + uid（cache 在 localStorage） */
export async function oracleAuth(): Promise<{ uid: string; token: string }> {
  if (_token && _uid) return { uid: _uid, token: _token };

  // 先試 localStorage cache
  if (typeof localStorage !== 'undefined') {
    const cachedToken = localStorage.getItem(TOKEN_KEY);
    const cachedUid = localStorage.getItem(UID_KEY);
    if (cachedToken && cachedUid) {
      _token = cachedToken;
      _setUid(cachedUid);   // v6.197：走中央 setter，身分一有變動就通知
      return { uid: cachedUid, token: cachedToken };
    }
  }

  // 沒 cache → 跟 server 拿
  if (!API_URL) throw new Error('VITE_ORACLE_API_URL not set');
  const res = await fetch(`${API_URL}/api/auth/anonymous`, {
    method: 'POST',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`oracleAuth failed: ${res.status} ${await res.text()}`);
  const { uid, token } = await res.json();
  _token = token; _setUid(uid);   // v6.197：新簽發的匿名身分要通知出去
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(UID_KEY, uid);
  }
  return { uid, token };
}

/** 取得當前 uid（已登入時，無需 await） */
export function oracleCurrentUid(): string | null {
  if (_uid) return _uid;
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(UID_KEY);
  }
  return null;
}

/** 清除 token（登出） */
export function oracleSignOut(): void {
  _token = null; _uid = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(UID_KEY);
  }
}

/** 通用 fetch wrapper — 自動帶 token + JSON encode body */
export async function oracleApi<T = any>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
  } = {},
  _retry = true,  // v5.628 內部用：401(token 過期/失效) 時自動重新登入並重試一次
): Promise<T> {
  if (!API_URL) throw new Error('VITE_ORACLE_API_URL not set');
  const { token } = await oracleAuth();
  // v4.68: 加 Cache-Control 阻止 Chrome 自動發 If-None-Match → server 回 304 → body 空
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Cache-Control': 'no-cache',
    ...(options.headers ?? {}),
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    // v4.68: cache:'no-store' 不讓 fetch 介入瀏覽器 HTTP cache（不會 If-None-Match）
    cache: 'no-store',
  });
  // v4.68: 即便 no-store 失效，server 仍可能回 304（理論上不該）—safety net
  if (res.status === 304) {
    // 沒 body，當作 caller 自己重試；但其實 caller 走 polling 自動會再試
    throw new Error('oracleApi 304 (unexpected with cache:no-store)');
  }
  // v5.610: server 對「房間版本未變」回 204（無 body）→ 回傳 undefined 讓 caller 略過
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  // v5.628：401(jwt expired / invalid token)= 快取的 token 過期或失效。
  //   oracleAuth 只會回快取 token、不檢查到期 → 清掉重新匿名登入,以新 token 重試一次,避免卡在 401 建不了房。
  if (res.status === 401 && _retry) {
    oracleSignOut();
    await oracleAuth();
    return oracleApi<T>(path, options, false);
  }
  if (!res.ok) {
    // 409 conflict 也算 ok response, caller 要處理
    if (res.status === 409) {
      return (await res.json()) as T;
    }
    throw new Error(`oracleApi ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ── Rooms ─────────────────────────────────────────────────────────────

export type OracleRoom = Record<string, any> & {
  _id: string;
  _version: number;
  createdAt: number;
  updatedAt: number;
};

export type OracleUpsertResult =
  | { ok: true; version: number; room: OracleRoom }
  | { conflict: true; currentVersion: number; room: OracleRoom | null };

// v5.610: 房間版本未變更哨兵（server 回 204 時用）
export const ROOM_UNCHANGED = Symbol('room-unchanged');

export function oracleGetRoom(code: string): Promise<OracleRoom | null>;
export function oracleGetRoom(code: string, since: number): Promise<OracleRoom | null | typeof ROOM_UNCHANGED>;
export async function oracleGetRoom(
  code: string,
  since?: number,
): Promise<OracleRoom | null | typeof ROOM_UNCHANGED> {
  try {
    // 只有 polling 會帶 since（>=0）；其餘呼叫端不帶 → server 照回完整 room
    const q = since !== undefined && since >= 0 ? `?since=${since}` : '';
    const res = await oracleApi<{ room: OracleRoom } | undefined>(`/api/rooms/${code.toUpperCase()}${q}`);
    // 204：server 告知版本未變 → 回哨兵讓 caller 略過（不觸發任何 callback）
    if (res === undefined) return ROOM_UNCHANGED;
    return res.room;
  } catch (err: any) {
    if (String(err.message).includes('404')) return null;
    throw err;
  }
}

export async function oracleUpsertRoom(
  code: string,
  data: Record<string, any>,
  expectedVersion?: number,
): Promise<OracleUpsertResult> {
  const body: any = { data };
  if (expectedVersion !== undefined) body.expectedVersion = expectedVersion;
  // ⭐⭐⭐v6.214③ 伺服器單一時鐘的取樣點。
  //   寫入成功時伺服器會蓋 `updatedAt`（server 端自動 set，見 room-oracle.ts 檔頭），
  //   而那一刻必定落在「我送出」與「我收到」之間 ⇒ 夾得出 client↔server 的偏移量。
  //   ⚠ 只採信 `ok` 分支：`conflict` 回的 room 是**別人上一次寫入**的時戳（比現在舊），
  //     拿它當「現在」會把偏移量估得偏後。
  //   ⚠ 欄位缺席／格式不對 → noteServerTime 自己會拒收 ⇒ 從沒同步過 ⇒ createGame 不寫
  //     createdAtSrv ⇒ 行為與 v6.213 逐字相同（fail-open）。
  const _sentAt = Date.now();
  const res = await oracleApi<OracleUpsertResult>(`/api/rooms/${code.toUpperCase()}`, {
    method: 'PUT',
    body,
  });
  try {
    if (res && 'ok' in res && res.ok && res.room) {
      _noteRoomServerTime((res.room as any).updatedAt, _sentAt, Date.now());
    }
  } catch { /* 對時失敗絕不可以影響房間寫入 */ }
  return res;
}

// ⭐v6.214③ 只在偏移量大到「守衛真的會被騙」時出一次聲（v6.198 實證有 -11 秒 / -77 秒 / -4.9 小時）。
//   ⚠ 只印一次：這支每次房間寫入都會跑到，每次都印會把 console 洗掉。
let _clockWarned = false;
function _noteRoomServerTime(srvMs: unknown, sentAt: number, recvAt: number): void {
  if (!noteServerTime(srvMs, sentAt, recvAt)) return;
  if (_clockWarned) return;
  const off = getServerClockOffsetMs();
  if (off === null || Math.abs(off) < 5000) return;
  _clockWarned = true;
  console.warn(`[PTCG clock] 本機時鐘與伺服器相差 ${Math.round(off / 1000)} 秒；建局時間改用伺服器時鐘（v6.214③）`);
}

export async function oracleDeleteRoom(code: string): Promise<void> {
  await oracleApi(`/api/rooms/${code.toUpperCase()}`, { method: 'DELETE' });
}

export async function oracleListRooms(status?: string): Promise<OracleRoom[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const { rooms } = await oracleApi<{ rooms: OracleRoom[] }>(`/api/rooms${q}`);
  return rooms;
}

/**
 * v6.115 取得「對戰中房間」的牌組原型名稱（大廳標籤用）。
 *
 * ⭐ 伺服器只回名稱字串，**牌表一張都不會出來**（分類在後端做，規則庫是 admin 私有的）。
 * 回傳語義：字串（含 '未分類'）＝ 已比對出結果；null 或該 roomId 不在回應裡 ＝ 還不知道
 * （尚未開打／規則庫沒載入／房間不存在）。前端要靠這個分辨，不要把 null 當成「未分類」。
 */
export async function oracleRoomArchetypes(
  roomIds: string[],
): Promise<Record<string, { p1: string | null; p2: string | null }>> {
  const ids = roomIds.map((s) => String(s || '').toUpperCase()).filter(Boolean).slice(0, 40);
  if (!ids.length) return {};
  const { rooms } = await oracleApi<{ rooms: Record<string, { p1: string | null; p2: string | null }> }>(
    `/api/rooms-archetypes?ids=${encodeURIComponent(ids.join(','))}`,
  );
  return rooms || {};
}

/**
 * ⭐⭐⭐v6.212 輪詢版本閘（純函式，守衛 scripts/test-v6212-selfheal-direction.mjs）。
 *
 * 舊寫法是 `room._version !== lastVersion` —— 只要「不一樣」就遞送，
 * 所以**比較舊的版本照樣會被遞送給收端**（伺服器端多實例／重試／慢回應都做得出這件事），
 * 收端再依 stale 守衛決定要不要收；但只要有任何一條路徑繞過守衛（v5.587 的強制自癒
 * 就是刻意繞過的），舊盤面就會直接蓋掉新盤面 ＝ 玩家看到的「跳回上一手」。
 * ⇒ 閘改成**單調**：同一個房間實體只遞送嚴格較新的版本。
 *
 * ⚠ 房間可能被刪掉後用同一個房號重建，那時伺服器的 _version 會從 1 重來
 *   （server_admin_patch.js 建房時寫死 _version: 1）。若只比大小，重建後的房間
 *   會被永遠擋掉、玩家再也收不到任何更新。⇒ 先用 createdAt 認「是不是同一個房間實體」，
 *   不同實體一律遞送並重設版本基準。
 */
export function shouldDeliverRoomPoll(
  incoming: { _version: number; createdAt?: number },
  last: { version: number; createdAt: number },
): boolean {
  if ((incoming.createdAt ?? 0) !== last.createdAt) return true;   // 不同房間實體（含第一次）
  return incoming._version > last.version;                          // 同一房間：只收嚴格較新的
}

/**
 * Polling subscribe（取代 firestore onSnapshot）。
 * 每 intervalMs 拉一次 GET /api/rooms/:code，_version 變了 callback。
 * 回傳 unsubscribe function。
 */
export function oraclePollRoom(
  code: string,
  callback: (room: OracleRoom | null) => void,
  intervalMs: number | (() => number) = 800,
): () => void {
  let lastVersion = -1;
  let lastCreatedAt = -1;   // v6.212：房間實體識別（同房號被重建時 _version 會從 1 重來）
  let lastExists = true;
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (!alive) return;
    try {
      // v5.610: 帶上已知版本；server 版本沒變回 204 → ROOM_UNCHANGED，直接略過省流量
      const room = lastVersion >= 0
        ? await oracleGetRoom(code, lastVersion)
        : await oracleGetRoom(code);
      // ⭐⭐⭐v6.197 await 之後一定要再問一次 alive：unsubscribe() 只擋得住「還沒排出去的
      //   下一發」，擋不住「已經在路上的這一發」。少了這一行，玩家按「離開」之後最後一發
      //   回應仍會 callback ⇒ handleRoomUpdate 把 roomData/game/mySeatIdx 全部填回去
      //   ⇒ 人已經離開了卻被彈回對戰頁（而且身分欄位是半清狀態）。
      if (!alive) return;
      if (room === ROOM_UNCHANGED) {
        // 版本未變，什麼都不做（等同舊版收到同版本時忽略）
      } else if (room) {
        // ⭐v6.212 單調版本閘：較舊的 _version 不再遞送（見 shouldDeliverRoomPoll）。
        if (shouldDeliverRoomPoll(room, { version: lastVersion, createdAt: lastCreatedAt })) {
          lastVersion = room._version;
          lastCreatedAt = room.createdAt ?? 0;
          lastExists = true;
          callback(room);
        }
      } else if (lastExists) {
        lastExists = false;
        lastVersion = -1;
        lastCreatedAt = -1;
        callback(null);
      }
    } catch (err) {
      console.warn('[oraclePollRoom]', code, err);
    }
    // v5.347：intervalMs 可為函式 → 每次重排前求值（支援自適應輪詢）
    if (alive) {
      const _d = typeof intervalMs === 'function' ? intervalMs() : intervalMs;
      timer = setTimeout(tick, _d);
    }
  };

  tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}

// ── Messages ──────────────────────────────────────────────────────────

export type OracleMessage = {
  _id?: string;
  roomCode: string;
  uid: string;
  text: string;
  kind: string;
  createdAt: number;
};

export async function oracleSendMessage(
  code: string,
  text: string,
  kind: string = 'chat',
): Promise<OracleMessage> {
  const { message } = await oracleApi<{ message: OracleMessage }>(
    `/api/rooms/${code.toUpperCase()}/messages`,
    { method: 'POST', body: { text, kind } },
  );
  return message;
}

// v6.216②:帶 since 的增量輪詢。伺服器對「沒有比 since 新的訊息」回 204(oracleApi 回
//   undefined,與 v5.610 房間輪詢同一條路)→ 本函式回 null 表「沒有新訊息」。
//   不帶 since 的呼叫端行為完全不變(伺服器 fail-open 一律回全量,絕不 204)——overload
//   讓既有 caller 的回傳型別維持 OracleMessage[],比照 oracleGetRoom 的 since overload。
export function oracleListMessages(code: string, limit?: number): Promise<OracleMessage[]>;
export function oracleListMessages(code: string, limit: number, since: number): Promise<OracleMessage[] | null>;
export async function oracleListMessages(code: string, limit: number = 50, since?: number): Promise<OracleMessage[] | null> {
  const q = since !== undefined && since > 0 ? `&since=${since}` : '';
  const res = await oracleApi<{ messages: OracleMessage[] } | undefined>(
    `/api/rooms/${code.toUpperCase()}/messages?limit=${limit}${q}`,
  );
  if (res === undefined) return null; // 204 = 沒有新訊息（只有帶 since 時可能發生）
  return res.messages;
}

/** Polling subscribe messages — 新訊息 callback */
export function oraclePollMessages(
  code: string,
  callback: (msg: OracleMessage) => void,
  intervalMs: number = 1000,
): () => void {
  let lastTime = Date.now();
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (!alive) return;
    try {
      const messages = await oracleListMessages(code, 50);
      for (const msg of messages) {
        if (msg.createdAt > lastTime) {
          lastTime = msg.createdAt;
          callback(msg);
        }
      }
    } catch (err) {
      console.warn('[oraclePollMessages]', code, err);
    }
    if (alive) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}

// ── Backend mode flag (給 caller 簡單判斷) ─────────────────────────────

export const ORACLE_MODE: boolean =
  ((import.meta as any).env?.VITE_BACKEND_MODE as string) === 'oracle';

export function getApiUrl(): string {
  return API_URL;
}
