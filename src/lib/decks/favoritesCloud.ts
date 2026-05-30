// v5.310: 常用卡牌雲端同步 (Firestore) — UX 跟 deck cloud 一樣手動 💾/📥
// Firestore path: users/{uid}/favorites/cards (single doc, cardIds: string[])

import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';

const COLLECTION = 'favorites';
const DOC_ID = 'cards';

/** 推所有常用卡牌 cardId 到雲端 (覆寫 doc). */
export async function saveFavoritesToCloud(uid: string, favs: Set<string>): Promise<void> {
  const ref = doc(db, 'users', uid, COLLECTION, DOC_ID);
  await setDoc(ref, { cardIds: [...favs], updatedAt: new Date().toISOString() });
}

/** 從雲端讀回常用卡牌. 若 doc 不存在回傳空 Set. */
export async function loadFavoritesFromCloud(uid: string): Promise<Set<string>> {
  const ref = doc(db, 'users', uid, COLLECTION, DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return new Set();
  const data = snap.data();
  const arr = Array.isArray(data?.cardIds) ? data.cardIds : [];
  return new Set(arr.filter((x: unknown): x is string => typeof x === 'string'));
}
