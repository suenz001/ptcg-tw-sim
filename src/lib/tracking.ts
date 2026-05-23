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

  // v5.064：24h localStorage throttle — 同一個 device 每 24 小時最多寫一次 users/{uid}
  //
  // 起源：Wilson 觀察 Firebase 寫入量持續 2.7 萬/日（超出免費額度 2 萬）即使
  // 對戰已搬到 Oracle。Audit 發現 tracking.ts 對每個 page load 都 setDoc 寫
  // users/{uid}（含 anonymous user），而 Oracle 模式正式站也會跑 tracking.ts。
  //
  // 修法：localStorage 記錄上次寫入時間，24h 內跳過 setDoc。首次訪客 lastTrackAt=0
  // 仍會執行寫入建立 user doc（不影響新玩家追蹤）。
  //
  // 影響：玩家功能 0 影響 — 牌組儲存/編輯走 users/{uid}/decks 子集合不被攔；
  // anonymous auth / Google login / 對戰 / feedback 完全不受影響。失真資料：
  // loginCount 變成「24h 區間數」、lastLoginAt 變成「24h 解析度」— 但 admin
  // 後台用 Firebase Auth metadata.lastSignInTime 不讀 Firestore users 欄位。
  const LAST_TRACK_KEY = 'ptcg_last_track_at';
  const THROTTLE_MS = 24 * 60 * 60 * 1000;  // 24h
  const lastTrackAt = parseInt(localStorage.getItem(LAST_TRACK_KEY) || '0', 10);
  const isThrottled = (Date.now() - lastTrackAt) < THROTTLE_MS;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // v5.064：24h 內已寫過 — 跳過 setDoc（仍保留 anonymous auth 邏輯）
      if (isThrottled) return;
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
        // v5.064：寫入成功才更新 throttle timestamp（失敗下次仍可重試）
        localStorage.setItem(LAST_TRACK_KEY, String(Date.now()));
      } catch (err) {
        console.error('Failed to track user visit:', err);
      }
    }
  });
}
