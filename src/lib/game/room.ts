/**
 * Firestore 房間管理（v2.269 重構：座位制 lobby）
 *
 * 路徑：rooms/{roomCode}  （4 碼大寫房號）
 *
 * Schema v2（2026-04-29 起）：
 *   roomName: string                          ← 房間名稱
 *   hostUid / hostName                        ← 房主（建房者；維持房權只用於關房）
 *   status: 'lobby' | 'playing' | 'ended'
 *   seats: Seat[10]                           ← [p1, p2, spectator×8]
 *   gameState: GameState | null
 *   schemaVersion: 2                          ← v2.269 起；v1 舊房間應由 UI 顯示「不相容」並強制離開
 *   createdAt / updatedAt
 *
 * Seat：
 *   role: 'p1' | 'p2' | 'spectator'
 *   uid: string | null                        ← null = 空位
 *   name: string | null
 *   deckEntries: DeckEntry[] | null           ← p1/p2 才會用；spectator 永遠 null
 *   ready: boolean                            ← 只 p1/p2 有意義；spectator 永遠 false
 *
 * 雙方 P1/P2 都 ready 時，由「目前坐 P1 的玩家 client」觸發 startGame（status 從 lobby → playing）。
 * 用 status==='lobby' && gameState==null 做雙重 guard 避免 race。
 */

import { db, auth } from '$lib/firebase';
import {
  doc, setDoc, updateDoc, onSnapshot, getDoc, serverTimestamp,
  collection, query, where, limit, orderBy, addDoc, deleteDoc,
} from 'firebase/firestore';
import type { GameState } from './types';

export type DeckEntry = { cardId: string; count: number };

export type SeatRole = 'p1' | 'p2' | 'spectator';

export interface Seat {
  role: SeatRole;
  uid: string | null;
  name: string | null;
  deckEntries: DeckEntry[] | null;
  ready: boolean;
}

export interface RoomData {
  roomName: string;
  hostUid: string;
  hostName: string;
  status: 'lobby' | 'playing' | 'ended';
  seats: Seat[];
  /**
   * v2.46：去重的房內成員 uid 列表（從 seats 自動推導）。
   * Firestore rules 無法直接迭代 array of objects 來檢查 seat[i].uid，
   * 故維護這個 flat 列表給 rules 用 `request.auth.uid in memberUids` 判斷。
   * 任何寫入 seats 的地方都必須同時更新此欄位（用 computeMemberUids 工具）。
   */
  memberUids: string[];
  gameState: GameState | null;
  schemaVersion: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Room extends RoomData {
  roomId: string;
}

export const SEAT_LAYOUT_VERSION = 2;
export const TOTAL_SEATS = 10;
export const SPECTATOR_SEATS = 8;

// ── 工具 ─────────────────────────────────────────────────────────────────────

/** 產生 4 碼房號（排除易混淆字符 0/O/I/1） */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function emptySeats(): Seat[] {
  const seats: Seat[] = [
    { role: 'p1', uid: null, name: null, deckEntries: null, ready: false },
    { role: 'p2', uid: null, name: null, deckEntries: null, ready: false },
  ];
  for (let i = 0; i < SPECTATOR_SEATS; i++) {
    seats.push({ role: 'spectator', uid: null, name: null, deckEntries: null, ready: false });
  }
  return seats;
}

/**
 * v2.46：從 seats 推導 memberUids（去重 + 過濾 null）。
 * Firestore rules 用此欄位做成員驗證。
 */
function computeMemberUids(seats: Seat[]): string[] {
  const set = new Set<string>();
  for (const s of seats) {
    if (s.uid) set.add(s.uid);
  }
  return Array.from(set);
}

/** 找出 seats 中 uid 對應的座位索引；找不到回 -1 */
export function findMySeatIdx(seats: Seat[], uid: string | null): number {
  if (!uid) return -1;
  for (let i = 0; i < seats.length; i++) {
    if (seats[i].uid === uid) return i;
  }
  return -1;
}

/** 計算 entries 加總張數（entries 是「種類」，不是「總張數」） */
export function countDeckCards(entries: DeckEntry[] | null | undefined): number {
  if (!entries) return 0;
  return entries.reduce((sum, e) => sum + (e.count ?? 0), 0);
}

/** 雙方 P1/P2 都坐人且 ready 時為 true */
export function bothPlayersReady(seats: Seat[]): boolean {
  const p1 = seats[0], p2 = seats[1];
  return !!(p1.uid && p2.uid && p1.ready && p2.ready
    && countDeckCards(p1.deckEntries) === 60
    && countDeckCards(p2.deckEntries) === 60);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** 建立新房間（host 預設坐 P1，無牌組、未準備）；回傳房號 */
export async function createRoom(
  roomName: string,
  hostName: string,
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');

  const code = generateRoomCode();
  const seats = emptySeats();
  // host 預設坐 P1
  seats[0] = { role: 'p1', uid, name: hostName, deckEntries: null, ready: false };

  const data: RoomData = {
    roomName: roomName.trim() || `${hostName} 的房間`,
    hostUid: uid,
    hostName,
    status: 'lobby',
    seats,
    memberUids: computeMemberUids(seats), // v2.46
    gameState: null,
    schemaVersion: SEAT_LAYOUT_VERSION,
  };
  await setDoc(doc(db, 'rooms', code), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return code;
}

/** Guest 加入房間 — 預設坐第一個空 spectator 位 */
export async function joinRoom(
  roomCode: string,
  guestName: string,
): Promise<Room> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');

  const ref = doc(db, 'rooms', roomCode.toUpperCase().trim());
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error('找不到房間，請確認房號');
  const data = snap.data() as Partial<RoomData>;
  if ((data.schemaVersion ?? 1) < SEAT_LAYOUT_VERSION) {
    throw new Error('此房間是舊版本，請對方建立新房間');
  }
  if (data.status !== 'lobby') throw new Error('房間已開始或已結束');
  const seats = (data.seats ?? []) as Seat[];

  // v2.274：若我殘留在房內（前次沒清掉座位），更新名字後 return
  //   不再像舊版直接 return（避免改名重進時座位仍顯示舊名）
  const existingIdx = findMySeatIdx(seats, uid);
  if (existingIdx >= 0) {
    const newSeats = seats.map((s, i) => i === existingIdx ? { ...s, name: guestName } : s);
    await updateDoc(ref, { seats: newSeats, memberUids: computeMemberUids(newSeats), updatedAt: serverTimestamp() });
    return { ...(data as RoomData), seats: newSeats, roomId: snap.id };
  }

  // 找第一個空觀戰位（seats[2..9]）
  let targetIdx = -1;
  for (let i = 2; i < seats.length; i++) {
    if (seats[i].uid === null) { targetIdx = i; break; }
  }
  // 觀戰位都滿 → 試 P1/P2 空位
  if (targetIdx === -1) {
    for (let i = 0; i < 2; i++) {
      if (seats[i].uid === null) { targetIdx = i; break; }
    }
  }
  if (targetIdx === -1) throw new Error('房間已滿');

  const newSeats = seats.map((s, i) => {
    if (i !== targetIdx) return s;
    return { ...s, uid, name: guestName, deckEntries: null, ready: false };
  });

  await updateDoc(ref, {
    seats: newSeats,
    memberUids: computeMemberUids(newSeats), // v2.46
    updatedAt: serverTimestamp(),
  });
  return { ...(data as RoomData), seats: newSeats, roomId: snap.id };
}

/** 移動到指定座位（須為空位）；自己原本座位會清空 */
export async function takeSeat(
  roomCode: string,
  targetIdx: number,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');
  if (targetIdx < 0 || targetIdx >= TOTAL_SEATS) throw new Error('座位編號錯誤');

  const ref = doc(db, 'rooms', roomCode.toUpperCase());
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('房間不存在');
  const data = snap.data() as RoomData;
  if (data.status !== 'lobby') throw new Error('房間已開始，無法移動座位');

  const seats = data.seats;
  const myIdx = findMySeatIdx(seats, uid);
  if (myIdx === targetIdx) return; // 同一位
  if (seats[targetIdx].uid !== null) throw new Error('該座位已被占用');

  const myName = myIdx >= 0 ? seats[myIdx].name : null;
  const newSeats = seats.map((s, i) => {
    if (i === myIdx) {
      // 清空原座位
      return { ...s, uid: null, name: null, deckEntries: null, ready: false };
    }
    if (i === targetIdx) {
      return { ...s, uid, name: myName, deckEntries: null, ready: false };
    }
    return s;
  });

  await updateDoc(ref, { seats: newSeats, memberUids: computeMemberUids(newSeats), updatedAt: serverTimestamp() });
}

/** 在當前座位設定牌組；只有 P1/P2 才有用 */
export async function setSeatDeck(
  roomCode: string,
  deckEntries: DeckEntry[],
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');

  const ref = doc(db, 'rooms', roomCode.toUpperCase());
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('房間不存在');
  const data = snap.data() as RoomData;

  const myIdx = findMySeatIdx(data.seats, uid);
  if (myIdx < 0) throw new Error('你不在此房間');
  if (data.seats[myIdx].role === 'spectator') throw new Error('觀戰位不能設牌組');

  const newSeats = data.seats.map((s, i) =>
    i === myIdx ? { ...s, deckEntries, ready: false } : s
  );
  await updateDoc(ref, { seats: newSeats, memberUids: computeMemberUids(newSeats), updatedAt: serverTimestamp() });
}

/** 切換準備狀態 */
export async function setSeatReady(
  roomCode: string,
  ready: boolean,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');

  const ref = doc(db, 'rooms', roomCode.toUpperCase());
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('房間不存在');
  const data = snap.data() as RoomData;

  const myIdx = findMySeatIdx(data.seats, uid);
  if (myIdx < 0) throw new Error('你不在此房間');
  if (data.seats[myIdx].role === 'spectator') throw new Error('觀戰位不能準備');
  const seat = data.seats[myIdx];
  if (ready && countDeckCards(seat.deckEntries) !== 60) {
    throw new Error('請先選擇 60 張牌組');
  }

  const newSeats = data.seats.map((s, i) => i === myIdx ? { ...s, ready } : s);
  await updateDoc(ref, { seats: newSeats, memberUids: computeMemberUids(newSeats), updatedAt: serverTimestamp() });
}

/**
 * v2.274：離開房間 — 從 seats 清空自己的座位。
 * v2.275：清空後若整個房間沒人（所有 seats[].uid 都 null），自動刪除房間 doc。
 *   注意：messages subcollection 不會被 deleteDoc 連帶刪除（Firestore 限制），
 *   會殘留但因為 room doc 沒了也不會被 list；下次同房號生成時舊訊息可能干擾，
 *   但房號是 4 碼隨機 + 排除易混字，撞號機率極低，先不處理。
 */
export async function leaveRoom(roomCode: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ref = doc(db, 'rooms', roomCode.toUpperCase());
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as RoomData;
  if (data.status !== 'lobby') return;
  const myIdx = findMySeatIdx(data.seats, uid);
  if (myIdx < 0) return;
  const newSeats = data.seats.map((s, i) =>
    i === myIdx ? { ...s, uid: null, name: null, deckEntries: null, ready: false } : s
  );
  // v2.275：檢查清完我之後是否全空
  const allEmpty = newSeats.every(s => s.uid === null);
  if (allEmpty) {
    await deleteDoc(ref);
  } else {
    await updateDoc(ref, { seats: newSeats, memberUids: computeMemberUids(newSeats), updatedAt: serverTimestamp() });
  }
}

/** 啟動遊戲（坐 P1 的客戶端在雙方 ready 後呼叫） */
export async function startGame(
  roomCode: string,
  gameState: GameState,
): Promise<void> {
  const ref = doc(db, 'rooms', roomCode.toUpperCase());
  await updateDoc(ref, {
    gameState: JSON.parse(JSON.stringify(gameState)),
    status: 'playing',
    updatedAt: serverTimestamp(),
  });
}

/** 監聽房間狀態，回傳取消訂閱函式 */
export function subscribeRoom(
  roomCode: string,
  callback: (room: Room | null) => void
): () => void {
  const ref = doc(db, 'rooms', roomCode.toUpperCase());
  return onSnapshot(
    ref,
    snap => {
      if (!snap.exists()) { callback(null); return; }
      callback({ ...(snap.data() as RoomData), roomId: snap.id });
    },
    err => { console.error('[Room] snapshot error:', err); callback(null); }
  );
}

/**
 * 監聽所有可加入的 lobby 房間（status='lobby'）。
 * v2.52：加殭屍房間（stale = updatedAt > 10 分鐘前）過濾顯示 + 被動清理。
 *   原因：玩家直接關電腦/瀏覽器不會觸發 leaveRoom → 房間 doc 永遠殘留。
 *   anon 登入每次 uid 不同，重啟後也無法認回「我的舊房間」自己刪。
 *   解：任何進 lobby 的玩家順手把 stale 房間 delete 掉（rules 已放寬允許）。
 */
const ROOM_STALE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 分鐘

export function subscribeOpenRooms(
  callback: (rooms: Room[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'rooms'),
    where('status', '==', 'lobby'),
    limit(50),
  );
  return onSnapshot(
    q,
    snap => {
      const now = Date.now();
      const rooms: Room[] = [];
      const staleRoomIds: string[] = [];
      snap.forEach(d => {
        const data = d.data() as RoomData;
        // 過濾舊版本房間
        if ((data.schemaVersion ?? 1) < SEAT_LAYOUT_VERSION) return;
        // v2.52：判定是否為 stale lobby 房間
        const updatedAtSec = (data.updatedAt as { seconds?: number } | null | undefined)?.seconds;
        if (typeof updatedAtSec === 'number') {
          const ageMs = now - updatedAtSec * 1000;
          if (ageMs > ROOM_STALE_THRESHOLD_MS) {
            staleRoomIds.push(d.id);
            return;  // 不顯示，加入待清理清單
          }
        }
        rooms.push({ ...data, roomId: d.id });
      });
      // client-side 排序：createdAt 新→舊
      rooms.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number } | null | undefined)?.seconds ?? Infinity;
        const tb = (b.createdAt as { seconds?: number } | null | undefined)?.seconds ?? Infinity;
        return tb - ta;
      });
      callback(rooms);
      // 被動清理：發 deleteDoc 對 stale 房間（fire-and-forget；rules 已允許）
      // 不 await，不 block lobby 顯示；失敗（rules 拒絕）也忽略
      for (const roomId of staleRoomIds) {
        deleteDoc(doc(db, 'rooms', roomId)).catch(() => { /* ignore */ });
      }
    },
    err => {
      console.error('[Room] list error:', err);
      onError?.(err);
      callback([]);
    }
  );
}

/** 推送最新 GameState 到 Firestore（遊戲中由 P1/P2 發起 action 後使用） */
export async function pushGameState(roomCode: string, gameState: GameState): Promise<void> {
  await updateDoc(doc(db, 'rooms', roomCode), {
    gameState: JSON.parse(JSON.stringify(gameState)),
    status: gameState.phase === 'game-over' ? 'ended' : 'playing',
    updatedAt: serverTimestamp(),
  });
}

// ── 聊天室（v2.272 Phase 2）──────────────────────────────────────────
/**
 * 路徑：rooms/{roomCode}/messages/{msgId}
 *
 * 訊息保留：純前端訂閱顯示（不做主動清理）；房主關房時可考慮一併清掉訊息（目前未做）。
 */

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  createdAt?: { seconds?: number } | null;
}

const MAX_MESSAGE_LENGTH = 200;
const MESSAGES_LIMIT = 100;

export async function sendMessage(
  roomCode: string,
  senderName: string,
  text: string,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`訊息超過 ${MAX_MESSAGE_LENGTH} 字`);
  }
  const ref = collection(db, 'rooms', roomCode.toUpperCase(), 'messages');
  await addDoc(ref, {
    uid,
    name: senderName,
    text: trimmed,
    createdAt: serverTimestamp(),
  });
}

/** 訂閱聊天訊息（最近 100 筆，依 createdAt 升序） */
export function subscribeMessages(
  roomCode: string,
  callback: (msgs: ChatMessage[]) => void,
): () => void {
  const q = query(
    collection(db, 'rooms', roomCode.toUpperCase(), 'messages'),
    orderBy('createdAt', 'asc'),
    limit(MESSAGES_LIMIT),
  );
  return onSnapshot(
    q,
    snap => {
      const msgs: ChatMessage[] = [];
      snap.forEach(d => {
        msgs.push({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) });
      });
      callback(msgs);
    },
    err => { console.error('[Chat] subscribe error:', err); callback([]); }
  );
}
