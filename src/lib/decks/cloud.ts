/**
 * Cloud sync helpers for the deck editor.
 *
 * Each user's decks live at:
 *   Firestore: users/{uid}/decks/{deckId}
 *
 * Requires Anonymous Auth to be enabled in the Firebase Console
 * (Authentication → Sign-in method → Anonymous → Enable).
 */

import {
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { Deck } from './types';

/** Push a single deck to Firestore (create or overwrite). */
export async function syncDeckToCloud(uid: string, deck: Deck): Promise<void> {
  const ref = doc(db, 'users', uid, 'decks', deck.id);
  // serverTimestamp can't survive JSON round-trip; keep updatedAt as ISO string
  await setDoc(ref, { ...deck });
}

/** Remove a deck from Firestore. */
export async function removeDeckFromCloud(uid: string, deckId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'decks', deckId));
}

/** Fetch all decks for a user from Firestore. Returns [] if none. */
export async function loadDecksFromCloud(uid: string): Promise<Deck[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'decks'));
  return snap.docs.map((d) => d.data() as Deck);
}
