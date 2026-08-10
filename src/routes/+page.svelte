<script lang="ts">
  import { onMount } from 'svelte';


  import { base } from '$app/paths';
  // v5.971：firebase 改動態 import(見 onMount),讓 firebase chunk 離開首頁關鍵路徑(首屏先畫再連線)。
  import type { User } from 'firebase/auth';
  import type { Unsubscribe } from 'firebase/firestore';
  import { VERSION } from '$lib/version';
  import { hardRefreshNow } from '$lib/hard-refresh';   // v6.160 清快取唯一實作（與錦標賽報到共用）

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
    // v6.100：changelog.html 只留最近 50 則(173KB→33KB)，更早的移到 static/changelog-archive.html。
    //   ⚠ 該檔是靜態片段、用 {@html} 插入，裡面寫不了 svelte 的 {base}；因此連結先寫成
    //   `__BASE__/changelog-archive.html` 佔位，載入時在這裡換成實際 base（GitHub Pages 有子路徑前綴）。
    fetch(`${base}/changelog.html?v=${VERSION}`).then((r) => (r.ok ? r.text() : '')).then((t) => { if (t) changelogBuiltin = t.replaceAll('__BASE__', base); }).catch(() => { /* 載入失敗就顯示載入中 */ });

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
        if (snap.exists()) { const h = snap.data()?.html;
          // v6.100：後台 override 的內容若也貼了 __BASE__ 佔位（例如複製了封存連結），一併換掉，
          //   否則連結會變成字面 __BASE__/... 而 404。
          if (typeof h === 'string' && h.trim()) changelogOverride = h.replaceAll('__BASE__', base); }
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
  // ⭐⭐v6.160：清快取的實際動作**抽到 `$lib/hard-refresh` 成為全站唯一一份**
  //   （錦標賽報到的「版本太舊」提示視窗要按同一顆鈕，兩份實作會漂移）。
  //   本函式只保留「確認對話框 + 按鈕狀態」這層 UI，動作一律委派給 hardRefreshNow()。
  //   ⚠ hardRefreshNow() 內建 2.5 秒逾時保險（v5.909 的「一直卡在更新中…」），這裡不必再包一層。
  let hardRefreshing = $state(false);
  async function hardRefresh() {
    if (hardRefreshing) return;
    const ok = confirm('將清除瀏覽器快取並重新載入網頁，取得最新版本。\n\n✅ 您的牌組與帳號資料會保留\n❌ 暫存的網頁 / 程式 / 圖檔會清除\n\n確定要強制更新嗎？');
    if (!ok) return;
    hardRefreshing = true;
    await hardRefreshNow();
  }
</script>

<main>
  <!-- ══ v6.044 首頁（單一版面）══════════════════════════════════════════
       v6.042 曾同時提供新舊兩版與切換鈕；Wilson 實測後認為兩版差異不大，
       決定**只保留新版**並移除切換機制（少一套版面就少一份日後的維護與漂移）。
       ⚠強制更新鈕改放 hero 右上（原切換鈕的位置）—— 它是 iOS PWA 卡在舊版時
         玩家唯一的自救管道，必須一進站在最上面就看得到，不能藏在頁尾。 -->
  <div class="hm-hero">
    <div class="hm-hero-text">
      <h1>PTCG 實體賽事演練 <span class="version">v{VERSION}</span></h1>
      <p class="subtitle">免費線上・寶可夢集換式卡牌對戰模擬器 ｜ Pokémon TCG Simulator</p>
      <p class="tagline">Deck building testing and card database 牌組構築測試與卡牌資料庫</p>
    </div>
    <button class="hard-refresh-btn hm-refresh-top" onclick={hardRefresh} disabled={hardRefreshing}
      title="清快取並重新載入網頁（iOS PWA 加入主畫面後若卡舊版，點此可強制更新）">
      {hardRefreshing ? '⏳ 更新中…' : '🔄 強制更新版本（清快取）'}
    </button>
  </div>

  <nav class="hm-grid" aria-label="主要功能入口">
    <a class="hm-card hm-card-cards" href="{base}/cards">
      <span class="hm-icon" aria-hidden="true">🃏</span>
      <span class="hm-body">
        <span class="hm-title">卡牌資料庫</span>
        <span class="hm-desc">標準賽 H / I / J 標，繁體中文</span>
      </span>
      <span class="hm-arrow" aria-hidden="true">→</span>
    </a>
    <a class="hm-card hm-card-decks" href="{base}/decks">
      <span class="hm-icon" aria-hidden="true">🛠️</span>
      <span class="hm-body">
        <span class="hm-title">牌組編輯器</span>
        <span class="hm-desc">支援 Email 帳號跨裝置同步</span>
      </span>
      <span class="hm-arrow" aria-hidden="true">→</span>
    </a>
    <a class="hm-card hm-card-decks" href="{base}/deck-posts">
      <span class="hm-icon" aria-hidden="true">📋</span>
      <span class="hm-body">
        <span class="hm-title">牌組公布欄</span>
        <span class="hm-desc">看別人的牌組，一鍵匯入</span>
      </span>
      <span class="hm-arrow" aria-hidden="true">→</span>
    </a>
    <a class="hm-card hm-card-game" href="{base}/game">
      <span class="hm-icon" aria-hidden="true">⚔️</span>
      <span class="hm-body">
        <span class="hm-title">對戰演練</span>
        <span class="hm-desc">牌組實戰測試及規則學習</span>
      </span>
      <span class="hm-arrow" aria-hidden="true">→</span>
    </a>
    <a class="hm-card hm-card-tourn" href="{base}/tournament">
      <span class="hm-icon" aria-hidden="true">🏆</span>
      <span class="hm-body">
        <span class="hm-title">錦標賽</span>
        <span class="hm-desc">瑞士制／淘汰制・線上即時對戰</span>
      </span>
      <span class="hm-arrow" aria-hidden="true">→</span>
    </a>
  </nav>

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
  /* ⚠v6.030：這裡原本是 `display:flex; gap:.5rem`——但 changelog 的 summary 內容是**整段文字**，
     flex 會把裡面每一個 inline 元素（<b>、<br>）與被切開的文字節點都變成獨立的 flex item，
     各自佔一欄、還被塞進 gap 空隙，整條排版就爆掉（v6.028 的 <b> 與 v6.024 的 <br> 中招）。
     改回正常的文字流（block），三角與版本徽章用 inline-block 排在句首即可。 */
  .changelog-list :global(summary) { padding: 0.55rem 0.85rem; cursor: pointer; font-size: 0.9rem; font-weight: 500; color: #333; line-height: 1.65; user-select: none; list-style: none; }
  .changelog-list :global(summary::-webkit-details-marker) { display: none; }
  .changelog-list :global(summary::before) { content: '\25B6'; font-size: 0.65rem; color: #999; transition: transform 0.15s; display: inline-block; width: 0.95em; margin-right: 0.15rem; vertical-align: 0.12em; }
  .changelog-list :global(details[open] summary::before) { transform: rotate(90deg); }
  .changelog-list :global(.ver-badge) { font-family: ui-monospace, 'Cascadia Code', monospace; font-size: 0.78rem; font-weight: 600; background: #e8edf5; color: #3a5a8a; padding: 0.1rem 0.45rem; border-radius: 4px; display: inline-block; margin-right: 0.35rem; vertical-align: 0.05em; }
  .changelog-list :global(details[open] .ver-badge) { background: #d0e3fa; color: #1a4a8a; }
  /* ⚠v6.133：`.log-body`（v6.129 起用來放「展開才看到的補充說明」）**當初漏了這條規則** →
     changelog.html 是用 {@html} 載入的，Svelte 的 scoped 樣式對它無效，**沒寫 :global() 就等於沒樣式**，
     於是它吃瀏覽器預設的 1rem（16px），比 summary 的 0.9rem 明顯大一截，四則新紀錄的字都爆掉。
     ⇒ 新增 `test-changelog-html-classes-have-global-css` 守衛：changelog.html／archive 用到的每個
     class 都必須在這裡有對應的 :global() 規則，不能再靠人記得。 */
  .changelog-list :global(.log-body) { padding: 0 0.85rem 0.7rem 1.95rem; font-size: 0.85rem; color: #555; line-height: 1.7; }
  /* 同一個缺陷的第二例（守衛一寫完就抓到）：「查看更早的更新紀錄」連結也沒有 :global 規則。 */
  .changelog-list :global(.changelog-archive-link) { display: block; text-align: center; padding: 0.6rem; font-size: 0.85rem; color: #3a5a8a; text-decoration: none; }
  .changelog-list :global(.changelog-archive-link:hover) { text-decoration: underline; }
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
  /* ══ v6.042 新版首頁（modern）══════════════════════════════════════════
     舊版樣式一律未動；以下皆為 .hm- 前綴的新增規則，切回舊版時完全不生效。
     ⚠不新增任何圖片資源 —— 首頁的 SW precache 體積曾經是白屏事故的根因
       （v5.966，82MB→9MB），所以視覺一律用 CSS 漸層與既有 emoji 做。 */
  .hm-hero {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
    padding: 1.6rem 1.4rem 1.4rem; margin-bottom: 1.4rem; border-radius: 14px;
    background: linear-gradient(135deg, #fdf2f2 0%, #f4f7fb 55%, #f2f9f4 100%);
    border: 1px solid #eceff3;
  }
  /* ⚠hero 內是「文字容器」，本身不設 flex —— v6.030 首頁 changelog 爆版就是
     因為裝整段文字的容器設了 display:flex，內含的 b 標籤與文字各自成為 flex item。 */
  .hm-hero-text { min-width: 0; }
  .hm-hero-text h1 { margin: 0 0 .4rem; font-size: 1.7rem; line-height: 1.25; }
  .hm-hero-text .subtitle { margin: 0 0 .3rem; }
  .hm-hero-text .tagline { margin: 0; }

  /* 強制更新鈕放在 hero 右上：玩家一進站在最上面就按得到（原本在頁尾太深） */
  .hm-refresh-top { flex-shrink: 0; white-space: nowrap; }

  .hm-grid {
    margin-top: 0;
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .9rem; margin-bottom: 1.4rem;
  }
  /* ⭐整張卡都是連結（舊版只有一行文字可點，觸控命中面積太小） */
  .hm-card {
    display: flex; align-items: center; gap: .9rem;
    padding: 1.05rem 1.1rem; border-radius: 12px; text-decoration: none;
    background: #fff; border: 1px solid #e6e9ee;
    box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
  }
  .hm-card:hover {
    transform: translateY(-2px); border-color: #d3dae4;
    box-shadow: 0 6px 18px rgba(16, 24, 40, .10);
  }
  .hm-card:active { transform: translateY(0); }
  .hm-icon {
    flex-shrink: 0; width: 46px; height: 46px; border-radius: 11px;
    display: flex; align-items: center; justify-content: center; font-size: 1.45rem;
  }
  .hm-body { display: flex; flex-direction: column; gap: .18rem; min-width: 0; }
  .hm-title { font-size: 1.02rem; font-weight: 700; color: #1f2733; }
  .hm-desc  { font-size: .82rem; color: #6b7683; line-height: 1.5; }
  .hm-arrow { margin-left: auto; font-size: 1.1rem; color: #aab4c0; transition: transform .16s, color .16s; }
  .hm-card:hover .hm-arrow { transform: translateX(3px); color: #5b6673; }

  /* 四個入口各給一個低飽和主題色，建立可辨識性（不是裝飾，是讓玩家用顏色記位置） */
  .hm-card-cards .hm-icon { background: #eaf2fe; }
  .hm-card-decks .hm-icon { background: #eaf7ee; }
  .hm-card-game  .hm-icon { background: #fdeeec; }
  .hm-card-tourn .hm-icon { background: #fdf4e3; }


  /* ⭐響應式：桌機與手機的差異純粹是排版（幾欄、多大），行為完全相同，
     所以用 media query 而不是拆兩套元件。
     ⚠專案規矩「禁用 @media 當手機開關」指的是**對戰頁**——那裡手機與桌機是兩套
       不同的互動模型（拖曳／面板／手勢），必須拆元件。導覽層沒有行為差異。 */
  @media (max-width: 720px) {
    .hm-hero { flex-direction: column; gap: .8rem; padding: 1.2rem 1rem 1.1rem; }
    .hm-hero-text h1 { font-size: 1.35rem; }
    .hm-refresh-top { align-self: flex-start; }
    .hm-grid { grid-template-columns: 1fr; gap: .7rem; }
    /* 手機改橫式列，整列可點；高度足夠拇指點擊 */
    .hm-card { min-height: 76px; padding: .9rem 1rem; }
    .hm-icon { width: 42px; height: 42px; font-size: 1.3rem; }
    .hm-title { font-size: .98rem; }
    .hm-desc { font-size: .78rem; }
  }
</style>
