// v5.970：firebase 相關 import 改為 initTracking() 內動態 import(見下),
//   讓 firebase chunk 離開 layout(全站每頁)的靜態模組圖 → 不再阻擋 hydrate,改 mount 後才載。

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

  // v5.970：動態載入 firebase(fire-and-forget),firebase chunk 不進 layout 關鍵路徑。
  void (async () => {
    const [{ auth, db }, { onAuthStateChanged }, { doc, setDoc, getDoc, serverTimestamp, increment }] =
      await Promise.all([
        import('./firebase'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ]);
    onAuthStateChanged(auth, async (user) => {
    if (user) {
      // v5.072 (C1)：匿名 user 完全跳過 setDoc — 不寫 users/{uid} doc
      //
      // 起源：v5.064 加 24h localStorage throttle 後寫入量仍維持 36k/日。
      // Firebase Console users collection audit 顯示 ~15-20 個新匿名 user/15min
      // (~1.6K/日)，大量來自 Facebook In-App Browser (FBAN/FBIOS, FB_IAB)
      // — 這類瀏覽器不持久化 IndexedDB / localStorage，每次重新打開都
      // signInAnonymously() 拿新 uid → throttle key 也是新的 → setDoc 仍觸發。
      //
      // C1 策略：匿名身份完全不在 Firestore users collection 留紀錄。
      // 不影響：
      //   - 牌組（users/{uid}/decks 子集合 — Firestore 父 doc 不存在仍可讀寫）
      //   - 對戰（正式站走 Oracle / BETA 走 Firestore rooms 頂層集合）
      //   - feedback (頂層 collection)
      //   - AI 練習對戰（純前端）
      //   - 匿名升級 Google（linkWithCredential，本 callback 仍跑 — 此時 isAnonymous=false 過關）
      // admin 後台統計改用 Firebase Auth metadata（server_admin_patch.js L264-285
      // adminAuth.listUsers() 拿 uid/email/creationTime/lastSignInTime — 已支援，
      // 不計 Firestore 配額），失去欄位只剩 deviceId / userAgent / loginCount
      // (admin 後台 stats endpoint 不讀這幾個欄位)。
      if (user.isAnonymous) return;
      // v5.064：24h 內已寫過 — 跳過 setDoc（仍保留 anonymous auth 邏輯）
      // 註：v5.072 後此 throttle 只對 Google 登入會員生效（匿名已早退）
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
  })();
}
