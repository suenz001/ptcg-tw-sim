/**
 * v4.64 Phase 3c: Unified auth helper — switches between firebase + oracle modes.
 *
 * Phase 3d 會把 game/+page.svelte 改用本檔的 onUidChange / ensureSignedIn，
 * 取代直接呼叫 firebase auth.currentUser / signInAnonymously / onAuthStateChanged。
 *
 * 目前本檔已 ready，但 game/+page.svelte 還沒切換，所以 dormant。
 */
import { ORACLE_MODE, oracleAuth, oracleCurrentUid } from './oracle-client';

/**
 * 取得當前 uid（sync）。在 firebase 模式直接從 firebase auth.currentUser 取；
 * oracle 模式從 oracleCurrentUid()（localStorage cache）取。
 */
export function getCurrentUidSync(): string | null {
  if (ORACLE_MODE) {
    return oracleCurrentUid();
  }
  // Lazy import firebase auth to avoid loading firebase SDK in oracle build
  // (但實際上 firebase.ts 在 oracle build 仍會被 import — 沒能完全避開)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try {
    const { auth } = require('$lib/firebase');
    return auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/**
 * 確保已登入並回傳 uid（async）。
 * firebase 模式：if (!auth.currentUser) signInAnonymously(auth) 然後 return.
 * oracle 模式：oracleAuth() (匿名 JWT 拿 uid)。
 */
export async function ensureSignedIn(): Promise<string> {
  if (ORACLE_MODE) {
    const { uid } = await oracleAuth();
    return uid;
  }
  const { auth } = await import('$lib/firebase');
  const { signInAnonymously } = await import('firebase/auth');
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser!.uid;
}

/**
 * 監聽 uid 變化（firebase 用 onAuthStateChanged；oracle 一次性 resolve）。
 * Returns unsubscribe function.
 */
export function onUidChange(callback: (uid: string | null) => void): () => void {
  if (ORACLE_MODE) {
    // Oracle: 一次性 resolve（cache 機制）+ 沒有實際 onChange 機制（uid 不會中途變）
    oracleAuth()
      .then(({ uid }) => callback(uid))
      .catch(() => callback(null));
    return () => {};
  }
  // Firebase 模式：用 onAuthStateChanged
  let unsub: (() => void) | null = null;
  Promise.all([
    import('$lib/firebase'),
    import('firebase/auth'),
  ]).then(([{ auth }, { onAuthStateChanged }]) => {
    unsub = onAuthStateChanged(auth, (u) => {
      callback(u?.uid ?? null);
    });
  });
  return () => {
    if (unsub) unsub();
  };
}
