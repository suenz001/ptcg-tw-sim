<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  // v5.971：firebase 改動態 import(見 onMount),讓 firebase chunk 離開首頁關鍵路徑(首屏先畫再連線)。
  import type { User } from 'firebase/auth';
  import type { Unsubscribe } from 'firebase/firestore';
  import { VERSION } from '$lib/version';

  // v2.53 我的回饋歷史 + admin 回覆顯示
  interface FeedbackHistoryItem {
    id: string;
    content: string;
    createdAt?: { seconds?: number };
    reply?: string;
    repliedAt?: { seconds?: number };
    repliedBy?: string;
    uid?: string;
    deviceId?: string;
  }

  let user = $state<User | null>(null);
  let error = $state<string | null>(null);
  let status = $state('初始化中...');
  let changelogOverride = $state('');  // v5.755 admin 可在後台編輯的首頁更新記錄(Firebase config/homeChangelog);空=用程式內建
  let changelogBuiltin = $state('');   // v5.969 內建 changelog 改由 static/changelog.html 執行時 fetch(移出 bundle,縮小首頁 route node)

  // v5.971：firebase 模組於 onMount 動態載入後填入;feedback 相關函式使用它們並以 guard 防未載入。
  let fbMod: typeof import('$lib/firebase') | null = null;
  let fsMod: typeof import('firebase/firestore') | null = null;

  onMount(() => {
    // v5.969：內建 changelog 改由 static/changelog.html 執行時載入(不再編譯進 bundle,縮小首頁)。override(Firestore)仍優先。
    fetch(`${base}/changelog.html?v=${VERSION}`).then((r) => (r.ok ? r.text() : '')).then((t) => { if (t) changelogBuiltin = t; }).catch(() => { /* 載入失敗就顯示載入中 */ });

    // v5.971：firebase 動態載入(首屏先畫、mount 後才連線)。onMount 不可宣告為 async(其回傳值不會被當 teardown)，
    //   故用內層 async IIFE + disposed/unsub 收尾模式，確保 onAuthStateChanged 的退訂在元件卸載時正確執行。
    let unsub: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      const [firebase, authMod, firestore] = await Promise.all([
        import('$lib/firebase'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ]);
      fbMod = firebase;
      fsMod = firestore;
      const { auth, db } = firebase;
      const { signInAnonymously, onAuthStateChanged } = authMod;
      const { doc, getDoc } = firestore;
      // v5.755：首頁更新記錄可由 admin 後台編輯(Firebase config/homeChangelog,兩站共用);讀到才覆蓋程式內建。
      getDoc(doc(db, 'config', 'homeChangelog')).then((snap) => {
        if (snap.exists()) { const h = snap.data()?.html; if (typeof h === 'string' && h.trim()) changelogOverride = h; }
      }).catch(() => { /* 沒設定 → 用程式內建 */ });
      const u = onAuthStateChanged(
        auth,
        (usr) => {
          user = usr;
          if (usr) {
            status = '已連線';
          } else {
            status = '正在匿名登入...';
            signInAnonymously(auth).catch((e: Error) => {
              error = e.message;
              status = '登入失敗';
            });
          }
        },
        (e: Error) => {
          error = e.message;
          status = '連線失敗';
        }
      );
      if (disposed) u(); else unsub = u;
    })();
    return () => { disposed = true; unsub?.(); };
  });

  // 意見回饋相關狀態
  let showFeedbackModal = $state(false);
  let feedbackText = $state('');
  let feedbackSubmitting = $state(false);
  let feedbackStatus = $state<'idle' | 'success' | 'error'>('idle');

  // v2.53 / v2.7 我的回饋歷史
  // ──────────────────────────────────────────────────────────────────────
  // v2.7 (2026-05) 重構：getDocs 一次性 → onSnapshot 即時監聽 + deviceId 雙路徑
  //
  // 過去問題：admin 從後台寫回覆後，玩家端要關閉 modal 重開才能拿到最新資料；
  //   此外匿名玩家若清過 storage / 換 session，uid 改變，舊回饋查不到。
  //
  // 修法：
  //   1) 開啟 modal 時用 onSnapshot 訂閱 (uid==self.uid) 與 (deviceId==localStorage)
  //      兩條 query；admin updateDoc 後 Firestore 會 push 給訂閱者，畫面即時更新。
  //   2) 兩條 query 結果 by id 合併去重（同一筆 doc 會被 deviceId 與 uid 兩路命中）。
  //   3) 關 modal 時 unsubscribe，避免無限保持連線。
  //   4) deviceId 查詢需要 Firestore rules 允許（v2.7 一併放寬：read 條件加上
  //      "deviceId 與 request.auth.token.firebase.identities 中某 deviceId 比對"
  //      ⇒ 簡化做法：採取「auth 用戶可讀任何含 deviceId 的 feedback」，因 deviceId
  //      是長隨機 UUID 不可猜，且 feedback 內容本身屬於玩家提交給管理員，敏感性低）。
  // ══════════════════════════════════════════════════════════════════════
  let myFeedbacks = $state<FeedbackHistoryItem[]>([]);
  let loadingHistory = $state(false);
  let unsubUidQuery: Unsubscribe | null = null;
  let unsubDeviceQuery: Unsubscribe | null = null;
  // 雙路徑結果各自快取，merge 後寫入 myFeedbacks
  let feedbacksByUid = $state<FeedbackHistoryItem[]>([]);
  let feedbacksByDevice = $state<FeedbackHistoryItem[]>([]);

  function mergeFeedbacks() {
    // by id 合併去重；createdAt desc 排序
    const map = new Map<string, FeedbackHistoryItem>();
    for (const f of feedbacksByUid) map.set(f.id, f);
    for (const f of feedbacksByDevice) {
      // 若兩條都有，留下較新（reply 欄位較完整的那一筆）
      const existing = map.get(f.id);
      if (!existing) map.set(f.id, f);
      else {
        // 取 reply / repliedAt 較新的（如有差異）
        const merged = { ...existing, ...f };
        // 若 existing 有 reply 但 f 沒有，保留 existing 的 reply
        if (existing.reply && !f.reply) merged.reply = existing.reply;
        if (existing.repliedAt && !f.repliedAt) merged.repliedAt = existing.repliedAt;
        map.set(f.id, merged);
      }
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
    myFeedbacks = arr.slice(0, 20);
  }

  function unsubscribeFeedbacks() {
    if (unsubUidQuery) { unsubUidQuery(); unsubUidQuery = null; }
    if (unsubDeviceQuery) { unsubDeviceQuery(); unsubDeviceQuery = null; }
    feedbacksByUid = [];
    feedbacksByDevice = [];
  }

  function subscribeFeedbacks() {
    unsubscribeFeedbacks();
    if (!user || !fbMod || !fsMod) { myFeedbacks = []; return; }
    const { collection, query, where, limit, onSnapshot } = fsMod;
    const { db } = fbMod;
    loadingHistory = true;
    let deviceId = 'unknown';
    try { deviceId = localStorage.getItem('ptcg_device_id') ?? 'unknown'; } catch {}

    // Path 1: 依 uid（已登入或同 anon session）
    try {
      // v2.71：拿掉 orderBy('createdAt', 'desc') 避免需要 Firestore 複合索引
      //   （where + orderBy 需要建索引；玩家 feedback 量少，client-side 排序即可）
      const qUid = query(
        collection(db, 'feedbacks'),
        where('uid', '==', user.uid),
        limit(50),  // 比 20 多撈一些，client-side 取前 20 才不會丟最新
      );
      unsubUidQuery = onSnapshot(qUid,
        (snap) => {
          feedbacksByUid = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FeedbackHistoryItem,'id'>) }));
          mergeFeedbacks();
          loadingHistory = false;
        },
        (err) => {
          console.error('uid feedback subscription failed:', err);
          loadingHistory = false;
        },
      );
    } catch (err) {
      console.error('Failed to subscribe by uid:', err);
    }

    // Path 2: 依 deviceId（跨匿名 session）— 只有在 deviceId 不是 unknown 才訂
    if (deviceId !== 'unknown') {
      try {
        // v2.71：同上拿掉 orderBy 避免需要複合索引
        const qDev = query(
          collection(db, 'feedbacks'),
          where('deviceId', '==', deviceId),
          limit(50),
        );
        unsubDeviceQuery = onSnapshot(qDev,
          (snap) => {
            feedbacksByDevice = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FeedbackHistoryItem,'id'>) }));
            mergeFeedbacks();
          },
          (err) => {
            // 若 rules 拒絕（暫時未部署 v2.7 rules）會走到這裡 — 沉默 fallback 即可
            console.warn('deviceId feedback subscription not available (rules?):', err);
          },
        );
      } catch (err) {
        console.warn('Failed to subscribe by deviceId:', err);
      }
    }
  }

  // 開 modal 時訂閱；關 modal 時取消訂閱
  $effect(() => {
    if (showFeedbackModal && user) subscribeFeedbacks();
    else if (!showFeedbackModal) unsubscribeFeedbacks();
  });

  function fmtFbTime(t?: { seconds?: number } | null): string {
    if (!t?.seconds) return '?';
    return new Date(t.seconds * 1000).toLocaleString('zh-TW');
  }

  async function submitFeedback() {
    if (!feedbackText.trim() || feedbackSubmitting) return;
    if (!fbMod || !fsMod) { feedbackStatus = 'error'; return; }
    const { collection, addDoc, serverTimestamp } = fsMod;
    const { db } = fbMod;
    feedbackSubmitting = true;
    try {
      // v2.53：附加 deviceId（給 admin 跨 anon session 識別同裝置玩家）
      let deviceId = 'unknown';
      try { deviceId = localStorage.getItem('ptcg_device_id') ?? 'unknown'; } catch {}
      await addDoc(collection(db, 'feedbacks'), {
        content: feedbackText.trim(),
        createdAt: serverTimestamp(),
        uid: user?.uid || 'anonymous',
        userAgent: navigator.userAgent,
        deviceId,
      });
      feedbackStatus = 'success';
      feedbackText = '';
      // v2.7：onSnapshot 會自動帶入剛送出的這筆，不需要手動重載
      setTimeout(() => {
        feedbackStatus = 'idle';
      }, 2000);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      feedbackStatus = 'error';
    } finally {
      feedbackSubmitting = false;
    }
  }

  // v5.197：強制更新按鈕 — 解套 iOS PWA「加入主畫面」cache 不更新問題
  //   玩家回報 iOS 加入主畫面後 app cache 卡舊版，關 app 重開仍是舊版本。
  //   解法：卸載 Service Workers + 清空 Cache API + 加 timestamp query param 強制 reload。
  //   不清 localStorage / IndexedDB → 牌組與帳號資料保留 ✓
  let hardRefreshing = $state(false);
  async function hardRefresh() {
    if (hardRefreshing) return;
    const ok = confirm('將清除瀏覽器快取並重新載入網頁，取得最新版本。\n\n✅ 您的牌組與帳號資料會保留\n❌ 暫存的網頁 / 程式 / 圖檔會清除\n\n確定要強制更新嗎？');
    if (!ok) return;
    hardRefreshing = true;
    // v5.909：清快取包 Promise.race + 逾時保險。原本逐一 await getRegistrations()/caches.delete(),
    //   在某些瀏覽器/PWA 狀態下這些 API 會「既不 reject 也不 resolve」永遠卡住 → 後面的 location.replace
    //   永不執行 → 按鈕一直停在「更新中…」(玩家回報)。try/catch 只擋 error 不擋 hang。
    //   改成：清快取最多等 2.5 秒,無論完成或卡住都強制 reload(?_v 已 bypass HTTP 快取,新版 SW 會重新預快取)。
    const cleanup = (async () => {
      try {
        // 1. 卸載所有 Service Workers
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister().catch(() => false)));
        }
        // 2. 清空 Cache API 所有 caches
        if (typeof window !== 'undefined' && 'caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n).catch(() => false)));
        }
      } catch (e) {
        console.warn('[hardRefresh] cleanup error:', e);
      }
    })();
    await Promise.race([cleanup, new Promise<void>((res) => setTimeout(res, 2500))]);
    // 3. 加 timestamp query param 強制 fresh HTML (bypass browser HTTP cache)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('_v', String(Date.now()));
      window.location.replace(url.toString());
    }
  }
</script>

<main>
  <h1>PTCG 實體賽事演練 <span class="version">v{VERSION}</span></h1>
  <p class="subtitle">免費線上・寶可夢集換式卡牌對戰模擬器 ｜ Pokémon TCG Simulator</p>
  <!-- v5.197：強制更新按鈕（手機 PWA 解套快取問題；桌面也可用） -->
  <p class="hard-refresh-row">
    <button class="hard-refresh-btn" onclick={hardRefresh} disabled={hardRefreshing}
      title="清快取並重新載入網頁（iOS PWA 加入主畫面後若卡舊版，點此可強制更新）">
      {hardRefreshing ? '⏳ 更新中…' : '🔄 強制更新版本（清快取）'}
    </button>
  </p>
  <p class="tagline">Deck building testing and card database 牌組構築測試與卡牌資料庫</p>

  <section>
    <h2>卡牌資料庫</h2>
    <p>
      <a href="{base}/cards">瀏覽所有卡包 →</a>
      <span class="hint">（標準賽 H / I / J 標，繁體中文）</span>
    </p>
  </section>

  <section>
    <h2>牌組編輯器</h2>
    <p>
      <a href="{base}/decks">建立我的牌組 →</a>
      <span class="hint">（支援 Email 帳號跨裝置同步）</span>
    </p>
  </section>

  <section>
    <h2>⚔️ 對戰演練</h2>
    <p>
      <a href="{base}/game">開始演練 →</a>
      <span class="hint">（牌組實戰測試及規則學習）</span>
    </p>
  </section>

  <section>
    <h2>🏆 淘汰賽測試 <span class="beta-tag">Beta</span></h2>
    <p>
      <a href="{base}/tournament">進入賽事大廳 →</a>
      <span class="hint">（單敗淘汰 · 線上即時對戰 · 歡迎報名測試）</span>
    </p>
  </section>

  <!-- v2.43 社群連結：LINE 群組 + QR Code -->
  <section class="community-section">
    <h2>💬 玩家社群</h2>
    <p class="community-desc">
      想找對手切磋、討論牌組、回報 bug 或追蹤更新嗎？歡迎加入我們的 LINE 群組！
    </p>
    <div class="community-card">
      <div class="qr-block">
        <img src="{base}/line-group-qr.png" alt="LINE 群組邀請 QR Code" class="qr-image" />
        <span class="qr-caption">掃描 QR Code</span>
      </div>
      <div class="link-block">
        <p class="link-label">或點擊連結直接加入：</p>
        <a class="line-button"
           href="https://line.me/ti/g2/UyxBE5oRISqn-Df0t-pmxgGRiOJ-ewkXgzNlIw?utm_source=invitation&utm_medium=link_copy&utm_campaign=default"
           target="_blank"
           rel="noopener noreferrer">
          <span class="line-icon">LINE</span>
          <span>加入 PTCG 演練群組 →</span>
        </a>
        <p class="community-hint">（免費・隨時可退出・歡迎所有玩家）</p>
      </div>
    </div>
  </section>

  <section class="changelog-section">
    <details class="changelog-outer">
    <summary><h2>📋 版本更新記錄</h2></summary>
    {#if changelogOverride}<div class="changelog-list">{@html changelogOverride}</div>
    {:else if changelogBuiltin}<div class="changelog-list">{@html changelogBuiltin}</div>
    {:else}<div class="changelog-list"><p class="hint">更新記錄載入中…</p></div>{/if}
    </details>
  </section>
  <section class="feedback-section">
    <h2>💬 意見回饋</h2>
    <p>
      發現 Bug 或是對模擬器有任何建議嗎？
      <button class="link-btn" onclick={() => showFeedbackModal = true}>點此提交意見 →</button>
    </p>
  </section>

  {#if showFeedbackModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-overlay" onclick={() => { if(!feedbackSubmitting) showFeedbackModal = false; }} role="dialog">
      <div class="modal-content fb-modal" onclick={e => e.stopPropagation()}>
        <h3>💬 意見回饋</h3>

        <!-- v2.53 我的回饋歷史 + admin 回覆 -->
        {#if loadingHistory}
          <div class="fb-history-loading">載入歷史回饋中...</div>
        {:else if myFeedbacks.length > 0}
          <div class="fb-history-section">
            <h4>📋 我的回饋歷史</h4>
            <div class="fb-history-list">
              {#each myFeedbacks as fb (fb.id)}
                <div class="fb-history-item" class:has-reply={!!fb.reply}>
                  <div class="fb-h-meta">
                    <span class="fb-h-time">📅 {fmtFbTime(fb.createdAt)}</span>
                    {#if fb.reply}<span class="fb-h-replied">✓ 已回覆</span>{/if}
                  </div>
                  <div class="fb-h-content">{fb.content}</div>
                  {#if fb.reply}
                    <div class="fb-h-reply">
                      <div class="fb-h-reply-header">
                        <strong>💬 管理員回覆</strong>
                        <span class="fb-h-reply-time">{fmtFbTime(fb.repliedAt)}</span>
                      </div>
                      <div class="fb-h-reply-text">{fb.reply}</div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 提交新意見 -->
        <div class="fb-new-section">
          <h4>{myFeedbacks.length > 0 ? '✉️ 提交新意見' : '✉️ 提交意見'}</h4>
          {#if feedbackStatus === 'success'}
            <div class="success-msg">✅ 感謝你的回饋！已送出。管理員回覆後可再次開啟此視窗查看。</div>
          {:else}
            <textarea
              bind:value={feedbackText}
              placeholder="請描述你遇到的問題或建議..."
              rows="4"
              disabled={feedbackSubmitting}
            ></textarea>
            {#if feedbackStatus === 'error'}
              <div class="error-msg">❌ 提交失敗，請稍後再試。</div>
            {/if}
            <div class="modal-actions">
              <button class="btn-cancel" onclick={() => showFeedbackModal = false} disabled={feedbackSubmitting}>關閉</button>
              <button class="btn-submit" onclick={submitFeedback} disabled={!feedbackText.trim() || feedbackSubmitting}>
                {feedbackSubmitting ? '送出中...' : '送出'}
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <footer class="disclaimer">
    <h3 class="disclaimer-title">本站使用須知與免責聲明</h3>
    <p>本網站（以下簡稱「本站」）為非官方、非營利之寶可夢集換式卡牌遊戲（PTCG）愛好者社群交流與規則演練工具。</p>

    <h4 class="disclaimer-section">推廣與教育性質</h4>
    <p>本站建立之初衷，旨在提供台灣及繁體中文圈新手玩家學習實體卡牌的正確規則與對戰流程，並協助實體賽事玩家進行策略模擬，本站積極鼓勵並引導玩家購買官方正版實體卡牌、參與官方認證之實體賽事，共同維護並繁榮台灣 PTCG 實體玩家生態圈。</p>

    <h4 class="disclaimer-section">資料來源聲明</h4>
    <p>本站所使用之卡牌資訊與數據，皆轉載、引用自<a href="https://asia.pokemon-card.com/tw/" target="_blank" rel="noopener noreferrer">寶可夢集換式卡牌遊戲官方主頁「訓練家網站」in 台灣</a>。本站不對其內容進行任何未授權之營利或竄改。</p>

    <h4 class="disclaimer-section">版權與智慧財產權聲明</h4>
    <p>本站所使用之卡牌美術圖面、卡片文字、商標、標誌及遊戲規則等相關數位資產，其智慧財產權、著作權與商標權皆屬於 The Pokémon Company、Nintendo、Creatures Inc.、GAME FREAK 及各該權利人所有，本站不擁有任何上述版權物之所有權，亦無意侵害任何相關權利人之合法權益。</p>

    <h4 class="disclaimer-section">支持官方數位生態系</h4>
    <p>本站作為台灣實體卡牌環境的輔助演練工具，旨在彌補當前跨區域數位推廣之局限，未來若官方於台灣市場正式推出相關系統或應用程式（App），本站將於第一時間立即自主關閉並停止營運。</p>

    <h4 class="disclaimer-section">權利人聯絡管道</h4>
    <p>若版權方或相關權利人認為本站之運作有任何不妥之處，或認為特定內容侵害了您的權益，請隨時 <a href="mailto:suenz001@yahoo.com.tw">點此來信</a> 告知。我們將抱持最高誠意，全力配合進行內容修正、移除或關閉相關功能。</p>
  </footer>
</main>

<style>

  /* v5.199：強制更新按鈕 — 改用淺色低調風，跟首頁淡灰白底搭配 */
  .hard-refresh-row {
    display: flex; align-items: center; gap: .6rem; flex-wrap: wrap;
    margin: .4rem 0 1rem 0;
  }
  .hard-refresh-btn {
    background: #f5f9ff;
    color: #2563eb;
    border: 1px solid #c8d8f0;
    border-radius: 6px;
    padding: .42rem .9rem;
    font-size: .85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s, border-color .15s, color .15s;
  }
  .hard-refresh-btn:hover {
    background: #e8edf5;
    border-color: #3b82f6;
    color: #1d4ed8;
  }
  .hard-refresh-btn:active { transform: scale(0.98); }
  .hard-refresh-btn:disabled { opacity: .55; cursor: wait; }

  .version { font-size: 0.75rem; font-weight: 400; color: #888; font-family: monospace; vertical-align: middle; margin-left: 0.3rem; background: #e8e4ee; padding: 0.1rem 0.4rem; border-radius: 3px; }
  main {
    max-width: 680px;
    margin: calc(2rem + env(safe-area-inset-top, 0)) auto 2rem;
    padding: 0 1.25rem 3rem;
    font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    line-height: 1.6;
    color: #1a1a1a;
  }
  h1 {
    margin-bottom: 0.1rem;
  }
  /* v4.953：主標下方副標 — 補長尾關鍵字「寶可夢集換式卡牌模擬器」+ 視覺層次 */
  .subtitle {
    font-size: 1.05rem;
    font-weight: 600;
    color: #444;
    margin: 0 0 0.35rem;
    letter-spacing: 0.5px;
  }
  .tagline {
    color: #666;
    margin-top: 0;
  }
  .beta-tag { display: inline-block; font-size: 0.6em; vertical-align: middle; background: #c0392b; color: #fff; padding: 1px 7px; border-radius: 10px; margin-left: 6px; font-weight: 700; letter-spacing: 0.5px; }
  section {
    margin-top: 1.5rem;
    padding: 1rem 1.25rem;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    background: #fff;
  }
  h2 {
    margin-top: 0;
    font-size: 1.05rem;
    color: #333;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
  }
  dt {
    color: #888;
    font-weight: 500;
  }
  dd {
    margin: 0;
  }
  .uid {
    font-family: ui-monospace, 'Cascadia Code', monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }
  .error {
    color: #c00;
  }
  ol {
    margin: 0;
    padding-left: 1.5rem;
  }
  li {
    margin-bottom: 0.25rem;
  }
  a {
    color: #0066cc;
    text-decoration: none;
    font-weight: 500;
  }
  a:hover, .link-btn:hover {
    text-decoration: underline;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: #0066cc;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .feedback-section {
    background: #f8fbff;
    border-color: #cce0ff;
  }
  .changelog-section {
    background: #fafafa;
    border-color: #e0e0e0;
  }
  .changelog-outer > summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
  }
  .changelog-outer > summary::-webkit-details-marker { display: none; }
  .changelog-outer > summary h2 {
    margin: 0;
    user-select: none;
  }
  .changelog-outer > summary h2::before {
    content: "▶ ";
    font-size: 0.75em;
    color: #888;
    margin-right: 0.3em;
  }
  .changelog-outer[open] > summary h2::before {
    content: "▼ ";
  }
  .changelog-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  details {
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    background: #fff;
    overflow: hidden;
  }
  details[open] {
    border-color: #c8d8f0;
    background: #f5f9ff;
  }
  summary {
    padding: 0.55rem 0.85rem;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: #333;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    user-select: none;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '\25B6';
    font-size: 0.65rem;
    color: #999;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  details[open] summary::before {
    transform: rotate(90deg);
  }
  .ver-badge {
    font-family: ui-monospace, 'Cascadia Code', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    background: #e8edf5;
    color: #3a5a8a;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    flex-shrink: 0;
  }
  details[open] .ver-badge {
    background: #d0e3fa;
    color: #1a4a8a;
  }
  details ul {
    margin: 0;
    padding: 0.5rem 0.85rem 0.7rem 1.8rem;
    font-size: 0.85rem;
    color: #444;
    line-height: 1.7;
  }
  details li {
    margin-bottom: 0.1rem;
  }

  /* v5.969 fetched changelog(改由 static/changelog.html 以 {@html} 載入,內容無 scoped hash class)→ 用 :global 補樣式,同時修好既有 Firestore override 顯示路徑的樣式缺失。 */
  .changelog-list :global(details) { border: 1px solid #e5e5e5; border-radius: 6px; background: #fff; overflow: hidden; }
  .changelog-list :global(details[open]) { border-color: #c8d8f0; background: #f5f9ff; }
  .changelog-list :global(summary) { padding: 0.55rem 0.85rem; cursor: pointer; font-size: 0.9rem; font-weight: 500; color: #333; display: flex; align-items: center; gap: 0.5rem; user-select: none; list-style: none; }
  .changelog-list :global(summary::-webkit-details-marker) { display: none; }
  .changelog-list :global(summary::before) { content: '\25B6'; font-size: 0.65rem; color: #999; transition: transform 0.15s; flex-shrink: 0; }
  .changelog-list :global(details[open] summary::before) { transform: rotate(90deg); }
  .changelog-list :global(.ver-badge) { font-family: ui-monospace, 'Cascadia Code', monospace; font-size: 0.78rem; font-weight: 600; background: #e8edf5; color: #3a5a8a; padding: 0.1rem 0.45rem; border-radius: 4px; flex-shrink: 0; }
  .changelog-list :global(details[open] .ver-badge) { background: #d0e3fa; color: #1a4a8a; }
  .changelog-list :global(details ul) { margin: 0; padding: 0.5rem 0.85rem 0.7rem 1.8rem; font-size: 0.85rem; color: #444; line-height: 1.7; }
  .changelog-list :global(details li) { margin-bottom: 0.1rem; }

  .hint {
    color: #888;
    font-size: 0.85rem;
    margin-left: 0.5rem;
  }
  .disclaimer {
    margin-top: 2.5rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid #ddd;
    font-size: 0.8rem;
    line-height: 1.7;
    color: #888;
  }
  .disclaimer p {
    margin: 0.3rem 0;
  }
  .disclaimer-title {
    font-size: 1rem;
    font-weight: 700;
    color: #555;
    margin: 0 0 0.6rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px dashed #ccc;
  }
  .disclaimer-section {
    font-size: 0.88rem;
    font-weight: 600;
    color: #666;
    margin: 0.85rem 0 0.25rem;
  }
  .disclaimer a {
    color: #0066cc;
    font-weight: 500;
    font-size: 0.8rem;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal-content {
    background: #fff;
    border-radius: 12px;
    padding: 1.5rem;
    width: 100%;
    max-width: 500px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  }
  .modal-content h3 {
    margin-top: 0;
    margin-bottom: 1rem;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-family: inherit;
    resize: vertical;
    margin-bottom: 1rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }
  .modal-actions button {
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-cancel {
    background: #f0f0f0;
    border: 1px solid #ccc;
    color: #333;
  }
  .btn-submit {
    background: #0066cc;
    border: 1px solid #005bb5;
    color: white;
  }
  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .success-msg {
    color: #2c7a3c;
    background: #e6f6e6;
    padding: 1rem;
    border-radius: 6px;
    text-align: center;
    font-weight: 500;
  }
  .error-msg {
    color: #c00;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  /* v2.53 意見回饋 modal 歷史顯示 */
  :global(.fb-modal) {
    max-width: 600px !important;
    max-height: 85vh;
    overflow-y: auto;
  }
  .fb-history-loading {
    color: #888;
    font-size: 0.86rem;
    padding: 0.5rem 0;
  }
  .fb-history-section {
    margin: 0.8rem 0 1.2rem 0;
    padding-bottom: 0.8rem;
    border-bottom: 1px dashed #ccc;
  }
  .fb-history-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.95rem;
    color: #2c4a6a;
  }
  .fb-history-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 300px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .fb-history-item {
    background: #f7f7fa;
    border: 1px solid #d8d8e0;
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
  }
  .fb-history-item.has-reply {
    border-left: 3px solid #06C755;
  }
  .fb-h-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.74rem;
    color: #666;
    margin-bottom: 0.3rem;
  }
  .fb-h-replied {
    background: #06C755;
    color: #fff;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
  }
  .fb-h-content {
    white-space: pre-wrap;
    font-size: 0.88rem;
    line-height: 1.5;
    color: #1a1a1a;
  }
  .fb-h-reply {
    margin-top: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: #e8f5e8;
    border-radius: 4px;
    border-left: 3px solid #06C755;
  }
  .fb-h-reply-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.78rem;
    color: #2c4a2c;
    margin-bottom: 0.25rem;
  }
  .fb-h-reply-time { color: #5a7a5a; font-weight: normal; }
  .fb-h-reply-text {
    white-space: pre-wrap;
    font-size: 0.86rem;
    color: #1a3a1a;
  }
  .fb-new-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.95rem;
    color: #2c4a6a;
  }

  /* v2.43 玩家社群區塊 */
  .community-section {
    background: linear-gradient(135deg, #f0f9f0 0%, #e8f5e8 100%);
    border: 1px solid #c8e6c8;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-top: 1.5rem;
  }
  .community-section h2 {
    margin-top: 0;
  }
  .community-desc {
    margin: 0 0 1rem 0;
    color: #2c4a2c;
    font-size: 0.95rem;
  }
  .community-card {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .qr-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    background: #fff;
    padding: 0.75rem;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  }
  .qr-image {
    width: 140px;
    height: 140px;
    display: block;
    image-rendering: pixelated;
  }
  .qr-caption {
    font-size: 0.78rem;
    color: #555;
  }
  .link-block {
    flex: 1;
    min-width: 200px;
  }
  .link-label {
    margin: 0 0 0.6rem 0;
    color: #2c4a2c;
    font-size: 0.95rem;
  }
  .line-button {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    background: #06C755;
    color: #fff !important;
    padding: 0.7rem 1.2rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    font-size: 1rem;
    transition: background 0.15s, transform 0.1s;
    box-shadow: 0 2px 6px rgba(6,199,85,0.25);
  }
  .line-button:hover {
    background: #05a847;
    transform: translateY(-1px);
  }
  .line-icon {
    background: #fff;
    color: #06C755;
    font-weight: 800;
    font-size: 0.78rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }
  .community-hint {
    margin: 0.6rem 0 0 0;
    font-size: 0.78rem;
    color: #5a7a5a;
  }
  @media (max-width: 480px) {
    .community-card {
      justify-content: center;
    }
    .link-block {
      text-align: center;
    }
  }
</style>
