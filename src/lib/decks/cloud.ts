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
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { migrateDeck } from './cardIdMigration';
import type { Deck } from './types';

/** Push a single deck to Firestore (create or overwrite). */
export async function syncDeckToCloud(uid: string, deck: Deck): Promise<void> {
  const ref = doc(db, 'users', uid, 'decks', deck.id);
  // JSON round-trip strips `undefined` values which Firestore rejects
  const clean = JSON.parse(JSON.stringify(deck));
  await setDoc(ref, clean);
}

/** Remove a deck from Firestore. */
export async function removeDeckFromCloud(uid: string, deckId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'decks', deckId));
}

/** Fetch all decks for a user from Firestore. Returns [] if none. */
export async function loadDecksFromCloud(uid: string): Promise<Deck[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'decks'));
  // v5.301: 自動 jp_id → tw_id migration (M5 等已從日版升級為台版)
  return snap.docs.map((d) => migrateDeck(d.data() as Deck));
}

// ── v6.273 Firestore 讀取減量：牌組雲端「版本代號」meta ─────────────────────
// 背景：每次進 /decks（含匿名）與進對戰頁（Google 帳號）都整批 getDocs 拉
//   users/{uid}/decks —— 每副牌 1 讀（30 副＝30 讀），是全站第二大宗讀取。
// 做法：users/{uid}/meta/decks 單一文件記 rev（每次雲端牌組寫入後 bump），
//   client 把「上次全拉時看到的 rev」記在 localStorage；進頁時先讀 1 次 meta，
//   rev 沒變（且本地牌組非空）→ 直接用 localStorage 牌組，省掉整批 getDocs。
// ⚠⚠ 安全原則（牌組絕不能消失/被舊資料覆蓋）：所有邊界一律 fail-open「整批全拉」——
//   無本地 rev（首次/換裝置/隱私模式）、本地牌組為空（快取損毀）、換帳號（uid 不符）、
//   meta 不存在、meta 讀取失敗 → 全部照舊 getDocs＋merge。
//   跳過分支只會沿用「上次 merge 後存進 localStorage 的牌組」，不寫任何雲端資料。
//   meta 放獨立子集合 users/{uid}/meta/（不是 decks/ 底下），舊版 client 的 getDocs
//   永遠看不到它，不會把 meta 誤當一副牌。

const DECKS_REV_LS_KEY = 'ptcg_decks_cloud_rev_v1';

function readLocalDecksRev(uid: string): string | null {
  try {
    const raw = localStorage.getItem(DECKS_REV_LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { uid?: unknown; rev?: unknown };
    if (o?.uid !== uid) return null;             // 換帳號 → 視同無記錄（必全拉）
    return typeof o.rev === 'string' && o.rev ? o.rev : null;
  } catch {
    return null;                                  // 隱私模式/損毀 → 無記錄（必全拉）
  }
}

function writeLocalDecksRev(uid: string, rev: string): void {
  try { localStorage.setItem(DECKS_REV_LS_KEY, JSON.stringify({ uid, rev })); } catch { /* 寫不進去無妨：下次全拉 */ }
}

/** 清掉本地 rev 記錄（之後進頁必定全拉）。 */
export function clearLocalDecksRev(): void {
  try { localStorage.removeItem(DECKS_REV_LS_KEY); } catch { /* ignore */ }
}

/** 讀雲端 meta 的 rev；文件不存在/欄位缺/讀取失敗 → null（呼叫端一律當「要全拉」）。 */
export async function readCloudDecksRev(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'meta', 'decks'));
    if (!snap.exists()) return null;
    const r = (snap.data() as { rev?: unknown })?.rev;
    return typeof r === 'string' && r ? r : null;
  } catch {
    return null;
  }
}

/**
 * 進頁時判斷「雲端牌組自上次全拉後有沒有變」。
 * 回傳 true（花 1 次讀取）才可跳過整批 getDocs；任何不確定一律回 false（照舊全拉）。
 */
export async function cloudDecksUnchanged(uid: string, localDeckCount: number): Promise<boolean> {
  if (!(localDeckCount > 0)) return false;        // 本地空/異常 → 必全拉（快取損毀防護；0 讀）
  const localRev = readLocalDecksRev(uid);
  if (!localRev) return false;                     // 首次/換裝置/換帳號/隱私模式 → 必全拉（0 讀）
  const cloudRev = await readCloudDecksRev(uid);   // 1 讀
  return cloudRev !== null && cloudRev === localRev;
}

/** 每次雲端牌組寫入（存檔/刪除/順序補寫/首次上傳）後呼叫：bump meta 並同步本地記錄。 */
export async function bumpCloudDecksRev(uid: string): Promise<void> {
  const rev = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  try {
    await setDoc(doc(db, 'users', uid, 'meta', 'decks'), { rev, updatedAt: serverTimestamp() }, { merge: true });
    writeLocalDecksRev(uid, rev);
  } catch {
    clearLocalDecksRev();                          // meta 沒寫成 → 本地記錄作廢，下次全拉
  }
}

/**
 * 整批全拉（getDocs）完成後呼叫：把「當下的雲端 rev」記到本地。
 * meta 還不存在（老帳號一次性遷移）→ 建立它（1 寫），之後每次進頁只要 1 讀。
 * ⚠ 只在「雲端確實有牌組」時呼叫（雲端空集合不建 meta，純過路匿名訪客零額外讀寫）。
 */
export async function recordCloudDecksRev(uid: string): Promise<void> {
  try {
    const rev = await readCloudDecksRev(uid);      // 1 讀
    if (rev) writeLocalDecksRev(uid, rev);
    else await bumpCloudDecksRev(uid);             // 一次性遷移：建 meta（1 寫）
  } catch {
    clearLocalDecksRev();
  }
}
