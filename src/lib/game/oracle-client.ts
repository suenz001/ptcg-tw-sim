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

const API_URL: string = ((import.meta as any).env?.VITE_ORACLE_API_URL as string) || '';
const TOKEN_KEY = 'ptcg_oracle_token';
const UID_KEY = 'ptcg_oracle_uid';

let _token: string | null = null;
let _uid: string | null = null;

/** 匿名登入 — 取得 JWT token + uid（cache 在 localStorage） */
export async function oracleAuth(): Promise<{ uid: string; token: string }> {
  if (_token && _uid) return { uid: _uid, token: _token };

  // 先試 localStorage cache
  if (typeof localStorage !== 'undefined') {
    const cachedToken = localStorage.getItem(TOKEN_KEY);
    const cachedUid = localStorage.getItem(UID_KEY);
    if (cachedToken && cachedUid) {
      _token = cachedToken;
      _uid = cachedUid;
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
  _token = token; _uid = uid;
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

export async function oracleGetRoom(code: string): Promise<OracleRoom | null> {
  try {
    const { room } = await oracleApi<{ room: OracleRoom }>(`/api/rooms/${code.toUpperCase()}`);
    return room;
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
  return await oracleApi<OracleUpsertResult>(`/api/rooms/${code.toUpperCase()}`, {
    method: 'PUT',
    body,
  });
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
 * Polling subscribe（取代 firestore onSnapshot）。
 * 每 intervalMs 拉一次 GET /api/rooms/:code，_version 變了 callback。
 * 回傳 unsubscribe function。
 */
export function oraclePollRoom(
  code: string,
  callback: (room: OracleRoom | null) => void,
  intervalMs: number = 800,
): () => void {
  let lastVersion = -1;
  let lastExists = true;
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (!alive) return;
    try {
      const room = await oracleGetRoom(code);
      if (room) {
        if (room._version !== lastVersion) {
          lastVersion = room._version;
          lastExists = true;
          callback(room);
        }
      } else if (lastExists) {
        lastExists = false;
        lastVersion = -1;
        callback(null);
      }
    } catch (err) {
      console.warn('[oraclePollRoom]', code, err);
    }
    if (alive) timer = setTimeout(tick, intervalMs);
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

export async function oracleListMessages(code: string, limit: number = 50): Promise<OracleMessage[]> {
  const { messages } = await oracleApi<{ messages: OracleMessage[] }>(
    `/api/rooms/${code.toUpperCase()}/messages?limit=${limit}`,
  );
  return messages;
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
