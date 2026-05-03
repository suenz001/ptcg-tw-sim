import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, increment } from 'firebase/firestore';

let trackingInitialized = false;

// 取得或產生裝置 ID（永久存於 localStorage）
// 即使玩家每次都以新的匿名帳號登入，只要是同一個瀏覽器，deviceId 就不變
function getOrCreateDeviceId(): string {
  const KEY = 'ptcg_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    // 產生 UUID v4 格式
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function initTracking() {
  if (trackingInitialized || typeof window === 'undefined') return;
  trackingInitialized = true;

  const deviceId = getOrCreateDeviceId();

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            isAnonymous: user.isAnonymous,
            email: user.email || null,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            loginCount: 1,
            deviceId,
            userAgent: navigator.userAgent
          });
        } else {
          await setDoc(userRef, {
            lastLoginAt: serverTimestamp(),
            loginCount: increment(1),
            isAnonymous: user.isAnonymous,
            email: user.email || null,
            deviceId,
            userAgent: navigator.userAgent
          }, { merge: true });
        }
      } catch (err) {
        console.error('Failed to track user visit:', err);
      }
    }
  });
}
