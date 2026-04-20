/**
 * Firestore 房間管理（M3 線上對戰）
 *
 * 路徑：rooms/{roomCode}  （4 碼大寫房號，如 "AB3X"）
 *
 * Schema:
 *   hostUid / hostName / hostDeckEntries[]
 *   guestUid / guestName / guestDeckEntries[]   ← guest 加入後填入
 *   gameState: GameState | null                  ← host 建遊戲後填入
 *   status: 'waiting' | 'ready' | 'playing' | 'ended'
 *   createdAt / updatedAt
 */

import { db, auth } from '$lib/firebase';
import {
  doc, setDoc, updateDoc, onSnapshot, getDoc, serverTimestamp,
  collection, query, where, limit,
} from 'firebase/firestore';
import type { GameState } from './types';

export interface RoomData {
  hostUid: string;
  hostName: string;
  hostDeckEntries: { cardId: string; count: number }[];
  guestUid:   string | null;
  guestName:  string | null;
  guestDeckEntries: { cardId: string; count: number }[] | null;
  gameState:  GameState | null;
  status: 'waiting' | 'ready' | 'playing' | 'ended';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Room extends RoomData {
  roomId: string;
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

/** 產生 4 碼房號（排除易混淆字符 0/O/I/1） */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** 建立新房間，回傳房號 */
export async function createRoom(
  hostName: string,
  hostDeckEntries: { cardId: string; count: number }[]
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');

  const code = generateRoomCode();
  await setDoc(doc(db, 'rooms', code), {
    hostUid: uid,
    hostName,
    hostDeckEntries,
    guestUid: null,
    guestName: null,
    guestDeckEntries: null,
    gameState: null,
    status: 'waiting',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return code;
}

/** Guest 加入房間 */
export async function joinRoom(
  roomCode: string,
  guestName: string,
  guestDeckEntries: { cardId: string; count: number }[]
): Promise<Room> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('尚未登入');

  const ref  = doc(db, 'rooms', roomCode.toUpperCase().trim());
  const snap = await getDoc(ref);

  if (!snap.exists())                   throw new Error('找不到房間，請確認房號');
  const data = snap.data() as RoomData;
  if (data.status !== 'waiting')        throw new Error('房間已滿或已結束');
  if (data.hostUid === uid)             throw new Error('不能加入自己建立的房間');

  await updateDoc(ref, {
    guestUid: uid,
    guestName,
    guestDeckEntries,
    status: 'ready',
    updatedAt: serverTimestamp(),
  });
  return { ...data, roomId: snap.id };
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

/** 監聽所有可加入的房間（status=waiting），排除自己建的 */
export function subscribeOpenRooms(
  callback: (rooms: Room[]) => void,
  onError?: (err: Error) => void,
): () => void {
  // 注意：刻意不使用 orderBy('createdAt') 以避開需要部署 composite index
  // （status ASC + createdAt DESC）— 改為 client-side 排序，少量房間負擔可忽略。
  const q = query(
    collection(db, 'rooms'),
    where('status', '==', 'waiting'),
    limit(50),
  );
  return onSnapshot(
    q,
    snap => {
      // 每次 snapshot 時重新讀 uid（auth 可能在 subscription 之後才完成）
      const myUid = auth.currentUser?.uid ?? '';
      const rooms: Room[] = [];
      snap.forEach(d => {
        const data = d.data() as RoomData;
        // 排除自己建的房間
        if (myUid && data.hostUid === myUid) return;
        rooms.push({ ...data, roomId: d.id });
      });
      // client-side 排序：createdAt 新→舊；serverTimestamp 尚未回寫時放最前
      rooms.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number } | null | undefined)?.seconds ?? Infinity;
        const tb = (b.createdAt as { seconds?: number } | null | undefined)?.seconds ?? Infinity;
        return tb - ta;
      });
      callback(rooms);
    },
    err => {
      console.error('[Room] list error:', err);
      onError?.(err);
      callback([]);
    }
  );
}

/** 推送最新 GameState 到 Firestore */
export async function pushGameState(roomCode: string, gameState: GameState): Promise<void> {
  await updateDoc(doc(db, 'rooms', roomCode), {
    // Firestore 不支援 undefined 欄位，先序列化去除
    gameState: JSON.parse(JSON.stringify(gameState)),
    status: gameState.phase === 'game-over' ? 'ended' : 'playing',
    updatedAt: serverTimestamp(),
  });
}
