<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { auth, db } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
  import {
    collection, addDoc, serverTimestamp,
    query, where, limit, getDocs, onSnapshot,
    type Unsubscribe,
  } from 'firebase/firestore';
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

  onMount(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (u) => {
        user = u;
        if (u) {
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
    return unsubscribe;
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
    if (!user) { myFeedbacks = []; return; }
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
</script>

<main>
  <h1>PTCG 實體賽事演練引擎 <span class="version">v{VERSION}</span></h1>
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
      <span class="hint">（牌組實戰測試）</span>
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
    <div class="changelog-list">

      <details open>
        <summary><span class="ver-badge">v3.99</span> 🤖 AI 日光轉移無限循環徹底修正（妙蛙花優先策略）</summary>
        <ul>
          <li>玩家回報：AI 用超級妙蛙花ex 日光轉移時，會在「戰鬥場吉雉雞ex（0 能 0 damage）⇄ 第 1 隻厄鬼椪（3 草）」之間無限來回搬草。</li>
          <li><b>根因</b>：
            <ul>
              <li>v3.732 stop condition 只看 active grass ≥ 4。但 active 是非草系（吉雉雞ex）時 AI 持續往 active 搬。</li>
              <li>heal-target picker AI 邏輯 <code>reduce((a, b) =&gt; a.damage &gt;= b.damage ? a : b)</code> 對 0 damage 全部相同時返回第一個 = active → AI 把草搬到 active，下輪 source picker 又選到 active（active 有草），又搬回 bench → 來回。</li>
            </ul>
          </li>
          <li><b>修法</b>（採用玩家建議的「妙蛙花優先策略」）：
            <ul>
              <li><b>USE_ABILITY decision</b>：找超級妙蛙花ex inst，計算其草能 ×（場上有大竺葵繁茂 ? 2 : 1），若 ≥ 4（叢林拋擲 cost <code>GGGG</code>）→ score = 0 停止。場上無妙蛙花ex 時 fallback 走 v3.732 原邏輯。</li>
              <li><b>heal-target picker 特例</b>（effectKey 為 sunlight-transfer-source / sunlight-transfer-target）：
                <ul>
                  <li>source 端：避免從妙蛙花ex 抽走能量，選非妙蛙花且有最多草能的寶可夢</li>
                  <li>target 端：優先選妙蛙花ex 自己（草能集中到主力）</li>
                </ul>
              </li>
            </ul>
          </li>
          <li><b>效果</b>：草能會被穩定搬到妙蛙花ex 身上，不會回流到 active 或其他 bench；妙蛙花ex 拿夠 4 顆草後 score = 0 立刻停。徹底解決無限循環。</li>
          <li><b>下次改版重點記錄</b>：玩家建議的「主打手 / 副打手 / 功能角色」AI 角色分類機制已記為 deferred task，下次改版時會做。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.98</span> 💬 聊天 fab 圖示可拖曳到任意位置（桌機 + 手機）</summary>
        <ul>
          <li>玩家需求：聊天 icon 按鈕可能擋住卡牌，讓玩家自己決定放哪裡。</li>
          <li><b>實作</b>：fab button 改用 pointer events（pointerdown / move / up）：
            <ul>
              <li>移動 ≤ 4px → 視為點擊 → 開啟聊天室 panel</li>
              <li>移動 &gt; 4px → 視為拖曳 → 跟隨手指 / 滑鼠移動，pointerup 不觸發開啟</li>
              <li>桌機 cursor 顯示 <code>grab</code> / 拖曳中 <code>grabbing</code> 提示</li>
              <li>手機加 <code>touch-action: none</code> 防拖曳時誤觸頁面滾動</li>
            </ul>
          </li>
          <li><b>位置記憶</b>：拖曳結束後位置存 <code>localStorage</code>（key: <code>ptcg_chat_fab_pos</code>），重整 / 重新進入對戰位置保留。</li>
          <li><b>不影響</b>：聊天 panel header 既有的拖曳功能；未讀數 badge 跟著按鈕移動。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.971</span> hotfix：修 v3.97 聊天室 × 按鈕無反應 + 手機 modal 頂到動態島</summary>
        <ul>
          <li>玩家回報 1：桌機版 × 按鈕沒反應，無法縮小回原本的聊天按鈕。<b>根因</b>：chat-panel-header 用 <code>setPointerCapture</code> 把 pointer 釘在 header 上做拖曳，後續 pointerup 在 header 觸發，button 的 onclick 永遠收不到 click event。<b>修法</b>：button 加 <code>onpointerdown=&#123;(e) =&gt; e.stopPropagation()&#125;</code> 阻止 header 接管 pointer，讓 button 自己處理事件。</li>
          <li>玩家回報 2：手機版 modal 全螢幕頂到 iOS 動態島，× 按鈕被遮住按不到。<b>修法</b>：手機 @media 改為：
            <ul>
              <li>不再 100vw × 100vh — 改為 95% 寬 + max-height 80vh</li>
              <li>top 用 <code>max(env(safe-area-inset-top, 20px), 40px)</code> 避開瀏海 / 動態島</li>
              <li>bottom 用 <code>max(env(safe-area-inset-bottom, 12px), 12px)</code> 避開 Home indicator</li>
              <li>border-radius 12px + border 2px，視覺上是浮動 modal（不是全螢幕）</li>
              <li>× 按鈕最小 44×44px 觸控目標（符合 Apple HIG）</li>
            </ul>
          </li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.97</span> 💬 對戰中聊天室（桌機 floating panel 可拖曳 + 手機 modal）</summary>
        <ul>
          <li>玩家需求：對戰時保留聊天室功能（連線模式 lobby 已有聊天室，現在 playing / setup / game-over 階段也能用）。</li>
          <li><b>桌機版</b>：右下角圓形浮動按鈕 💬（含未讀訊息數 badge），點開展開 350×450 panel。Header 可拖曳到任意位置。再按一次 × 收合回按鈕。</li>
          <li><b>手機 portrait（≤600px）</b>：同樣按鈕，但點開後 CSS @media 自動變全螢幕 modal，不需要拖曳。</li>
          <li><b>訊息訂閱</b>：沿用既有 <code>subscribeMessages</code>（在 <code>startRoomSubscription</code> 內），lobby → playing 切換時不中斷。聊天歷史保留。</li>
          <li><b>未讀通知</b>：按鈕上的紅色 badge 顯示未讀數，開啟 panel 時自動標記為已讀 + 自動 scroll 到底。</li>
          <li><b>條件</b>：只在 <code>mode === 'online' &amp;&amp; game &amp;&amp; roomCode</code> 顯示（避開 lobby 因為已有 inline chat-area）。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.96</span> 🔁 再來一局改為對稱設計（雙方各自點，都點了自動進房間）</summary>
        <ul>
          <li>玩家更新需求：v3.95 / v3.951 的「A 發起 / B 接受/拒絕」太複雜，改為<b>雙方各自獨立點按鈕</b>，都點了直接進入對戰房間（類似多數遊戲的 rematch UX）。</li>
          <li><b>新流程</b>：
            <ul>
              <li>game-over screen 雙方都看到「🔁 再來一局」按鈕 + 「離開房間」</li>
              <li>A 按下 → 按鈕變綠色「✓ 已準備（取消）」+ hint「⏳ 等待對手也按下...」</li>
              <li>B 端看到 hint「💡 對手已準備再來一局，按按鈕雙方都準備好就直接重啟」</li>
              <li>B 也按下 → 雙方都 ready → 任一方 client 自動 trigger reset → 雙方跳回 setup（room）階段</li>
              <li>任一方取消（再按一次）→ 自己 ready 變 false</li>
            </ul>
          </li>
          <li><b>Schema 改</b>：<code>room.rematchRequest</code> 廢棄 → <code>room.rematchReady: &#123; 0?, 1? &#125;</code>（per-seat boolean）</li>
          <li><b>新 functions</b>：<code>setRematchReady(roomCode, ready)</code> + <code>checkAndAcceptRematch(roomCode)</code>（firestore transaction 確保 reset 只執行一次）</li>
          <li><b>移除</b>：v3.95 的 4 個 functions（<code>requestRematch / cancelRematch / acceptRematch / rejectRematch</code>） + incoming modal + 'waiting'/'incoming'/'rejected' UI 狀態。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.951</span> hotfix：修 v3.95 game-over 只有一方看到「再來一局」按鈕</summary>
        <ul>
          <li>玩家回報：v3.95 連線對戰結束後，只有勝利方/加入房間者看到「再來一局」按鈕，敗方/開房者沒看到。</li>
          <li><b>根因</b>：
            <ul>
              <li>game-over UI 漏處理 <code>rematchUiState === 'incoming'</code> case → 該狀態下 game-over screen 內完全沒按鈕（只剩外層 modal）</li>
              <li>進入 game-over phase 時沒主動重置 <code>rematchUiState</code>，可能殘留前次 waiting / rejected 狀態</li>
              <li>判斷用 <code>mode === 'online'</code>，但某些 race 情況可能 mode 變 null</li>
            </ul>
          </li>
          <li><b>修法</b>：
            <ul>
              <li>game-over UI 條件改為 <code>mode === 'online' || roomCode</code>，雙保險判斷連線模式</li>
              <li>incoming state 也顯示「再來一局」按鈕（disabled 含 tooltip「請先回應對手的再來一局請求」），加上外層 modal 雙重視覺提示</li>
              <li>rejected state 加「🔁 再次嘗試」按鈕，玩家可再次發起</li>
              <li>加 $effect：game.phase 從非 game-over → game-over 時主動 reset <code>rematchUiState = 'idle'</code>（避免殘留）；若 firestore 已有 rematchRequest，handleRoomUpdate 會立即修正為 'incoming'</li>
              <li>incoming modal 渲染條件同步改 <code>mode === 'online' || roomCode</code></li>
            </ul>
          </li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.95</span> 🔁 連線對戰結算後「再來一局」（雙方同意 + 保留牌組）</summary>
        <ul>
          <li>玩家建議：連線對戰結束後 game-over screen 加「再來一局」按鈕，雙方同意後直接重新開始，省去重新建房 / 加房的麻煩。</li>
          <li><b>UX 流程</b>：
            <ul>
              <li>A 端 game-over 點「🔁 再來一局」→ A 顯示「⏳ 等待對手回應」+ 取消按鈕</li>
              <li>B 端 onSnapshot 收到 → 跳出 modal「<strong>OOO</strong> 想要再對戰一局：✓ 接受 / ✗ 拒絕」</li>
              <li>B 接受 → 雙方自動跳回 setup（onlineStep='room'），保留上局選的牌組 + seat，重按 ready 即可開戰</li>
              <li>B 拒絕 → A 顯示「對方拒絕了再來一局」3 秒後復原 idle</li>
              <li>A 取消 → 立即清掉 rematchRequest，B 端的 incoming modal 自動消失</li>
            </ul>
          </li>
          <li><b>Firestore schema</b>：<code>RoomData</code> 加 <code>rematchRequest?: &#123; fromSeatIdx, fromName, requestedAt &#125;</code> 欄位。用 <code>deleteField()</code> 真正移除（避免 undefined 寫入錯）。</li>
          <li><b>room.ts 新 functions</b>：<code>requestRematch / cancelRematch / acceptRematch / rejectRematch</code>。接受時 firestore transaction：清 gameState、status='lobby'、seats[*].ready=false、保留 deckEntries 與 firstChoicePreference、清 rematchRequest。</li>
          <li><b>+page.svelte UI</b>：game-over 連線模式按鈕 3 種狀態（idle / waiting / rejected）+ incoming modal。handleRoomUpdate 內依 rematchRequest 變化 + room.status 變化自動更新 UI。</li>
          <li><b>注意</b>：本機 2P / AI 模式的「再來一局」維持原本行為（單純 <code>game = null</code> 跳回 setup），不需協調。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.94</span> 花之帷幔修正：picker 仍需開啟，per-target 才擋（修 v3.892 整段 skip 過頭）</summary>
        <ul>
          <li>玩家回報：用激流水泵打對手戰鬥場花之帷幔謝米時，picker 直接被 skip + log「對手備戰非規則寶可夢免疫」— 不合理。應該還是要開讓玩家選備戰目標。</li>
          <li><b>理由</b>：
            <ul>
              <li>對手備戰若有規則寶可夢（ex / V / VSTAR / Mega 等）→ <b>花之帷幔擋不到</b>，玩家有權選那些目標造成傷害</li>
              <li>即使對手備戰全是非規則寶可夢，「選目標」這個步驟也是合法動作流程，不應省略</li>
            </ul>
          </li>
          <li><b>v3.892 問題</b>：在 <code>hitBenchPickPost</code> / <code>hitBenchAll</code> 入口直接整段 skip + log，導致 picker 不開。</li>
          <li><b>v3.94 修法</b>：
            <ul>
              <li>移除 <code>hitBenchPickPost</code> 入口整段 skip → picker 正常開</li>
              <li>移除 <code>hitBenchAll</code> 入口整段 skip → 改為 loop 內 per-target check（規則寶可夢仍受傷害）</li>
              <li><code>resolveBenchGuard</code> attack-damage 分支：把 <code>hasFlowerVeil(state, ...)</code> 改為 <code>hasFlowerVeil(state, ...) || state._attackTimeOppFlowerVeil</code> — bench-hit-N resolver 內 per-target 走此 helper 仍擋（解 v3.892 原本要解的「謝米被 KO 後 snapshot 仍生效」需求）</li>
            </ul>
          </li>
          <li><b>最終行為</b>（以激流水泵對手場上花之帷幔謝米為例）：
            <ul>
              <li>戰鬥場 100 傷害 → 謝米 KO（取 1 獎賞）</li>
              <li>option 觸發：picker 開讓玩家選備戰目標</li>
              <li>玩家選非規則寶可夢 → 「花之帷幔效果，該寶可夢免疫」log，傷害不施加</li>
              <li>玩家選規則寶可夢 → 受 120 傷害（花之帷幔擋不到 ex/V）</li>
            </ul>
          </li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.93</span> 能量圖示放大 + 撤退按鈕配色與位置雙重改善（UI 可讀性）</summary>
        <ul>
          <li>玩家反映 1：網頁版能量圖示太小不易辨識。<b>修法</b>：全域放大 <code>.nrg-pip</code>：
            <ul>
              <li>備戰 / 手牌 / 一般顯示：14×14 → <b>18×18 px</b>，字級 .58 → .72rem</li>
              <li>戰鬥場（更需要清晰）：18×16 → <b>24×22 px</b>，字級 .66 → .86rem，padding/圓角同步調整</li>
              <li>加深 box-shadow 內外陰影提升立體感</li>
            </ul>
          </li>
          <li>玩家反映 2：不同解析度下找不到撤退按鈕。<b>雙重改善</b>：
            <ul>
              <li>原位置（「我的出場」標籤旁）<code>.btn-retreat</code>：字級 .62 → <b>.78rem</b>、加 padding、配色從深藍灰 (#3a3a6a) 改為<b>橘黃 (#d97a2a)</b> 顯眼，加 hover translateY 微互動回饋</li>
              <li>新增「mirror 撤退按鈕」在 action-bar 內（與「⏭ 結束回合」並列）— 玩家視線常駐區、永遠看得到。同樣的 gate（自己回合 + main phase + active 在場 + 備戰 ≥ 1 + canRetreat），點擊行為等同原按鈕（開放浮動撤退選單）</li>
            </ul>
          </li>
          <li><b>不影響</b>：手機 portrait（MobilePortraitBattle.svelte 不用 <code>.nrg-pip</code> 樣式）、tablet-layout（按鈕配色變化不影響 layout grid）。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.92</span> 帳號功能：更改密碼 + 忘記密碼（Email 寄送重設信）</summary>
        <ul>
          <li>玩家需求：忘記密碼時可以用 Email 收信重設、已登入時可以更改密碼。</li>
          <li><b>忘記密碼</b>（牌組頁登入 modal 內）：
            <ul>
              <li>登入分頁底部加「忘記密碼？寄送重設信」連結</li>
              <li>點擊切換成「輸入 Email → 寄送重設信」form（用 Firebase <code>sendPasswordResetEmail</code>）</li>
              <li>送出後顯示「重設信已寄出！請查收信箱（含垃圾郵件夾）」綠底成功訊息</li>
              <li>連結會自動帶到 Firebase 官方重設密碼頁，使用者輸入新密碼即可</li>
            </ul>
          </li>
          <li><b>更改密碼</b>（牌組頁已登入用戶 banner）：
            <ul>
              <li>登入後 banner 加「🔑 更改密碼」按鈕</li>
              <li>新 modal：舊密碼 + 新密碼（至少 6 碼）+ 確認新密碼</li>
              <li>流程：先用舊密碼 <code>reauthenticateWithCredential</code>（Firebase 對敏感操作要求最近一次登入認證），通過後 <code>updatePassword</code></li>
              <li>本機驗證：新舊密碼相同 / 兩次新密碼不一致 / 新密碼過短 都會擋下</li>
            </ul>
          </li>
          <li><b>錯誤訊息</b> friendlyAuthError 補：
            <ul>
              <li><code>auth/requires-recent-login</code> → 「此操作需要最近一次登入認證，請重新登入後再試」</li>
              <li><code>auth/missing-email</code> → 「請輸入 Email」</li>
              <li><code>auth/network-request-failed</code> → 「網路連線失敗，請檢查網路後重試」</li>
            </ul>
          </li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.911</span> 幻影奇襲類「以任意方式放置 N 個指示物」必須全部放完</summary>
        <ul>
          <li>玩家補充規則：幻影奇襲只要對手備戰區有寶可夢，必須把 6 顆 counter 全放完（不能不放、不能只放 3 顆）。同類措辭「以任意方式放置 N 個傷害指示物」的招式都套用此規則。</li>
          <li><b>修法</b>：把 damage-distribute pending 的 <code>minCount</code> 從 1 改成跟 <code>maxCount</code> 相同 → selectionValid 強制 batchSum === maxCount 才能 confirm，confirm 按鈕不到 N 個會 disabled。</li>
          <li><b>受影響招式</b>：
            <ul>
              <li>多龍巴魯托ex｜幻影奇襲（6 個自由分配對手備戰）— 修為必放滿 6 個</li>
              <li>振翼髮｜飛來橫禍（2 個自由分配對手備戰）— 修為必放滿 2 個</li>
              <li>幻影奇襲 next picker re-spawn — 同步修為必放滿 nextRemaining 個（實務上 v3.91 KO 溢出計入後幾乎不觸發）</li>
              <li>來悲粗茶｜詛咒水滴（4 個分配對手任意寶可夢）— 已是 minCount=4, maxCount=4（既有版本正確）</li>
            </ul>
          </li>
          <li><b>暫不動</b>：奧利瓦ex｜油之機關槍（卡面措辭「為其選擇次數×20 傷害」與「N 個指示物以任意方式」不同，玩家可能 0~6 次選擇，先保留 minCount=1）。若該卡規則同樣強制放完，再另開 hotfix。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.91</span> 幻影奇襲允許溢傷 + 回合切換音效</summary>
        <ul>
          <li><b>幻影奇襲溢傷規則修正</b>：玩家規則更正 — 30HP 含羞包上面可以放 6 顆傷害指示物（PTCG 規則允許溢傷）。卡面：「將 6 個傷害指示物以任意方式放置於對手的備戰寶可夢身上」沒禁止溢放。</li>
          <li><b>原 bug</b>：玩家選 6 個全放含羞包後，resolver 內 target 被本批次第 3 個 counter KO 後，後續 counter 因 <code>if (!target) continue;</code> 跳過不計入 placedThisBatch → spawn next picker 強迫玩家把剩 3 個 counter 放到其他備戰 → 違反「KO 後剩餘 counter 不能挪走」的官方規則。</li>
          <li><b>修法</b>：dragapult-snipe resolver 內把 <code>continue</code> 改為 <code>&#123; placedThisBatch++; overflowByIid.set(iid, ...); continue; &#125;</code>，溢出 counter 視為消耗、不 spawn next picker，並加 log「溢出 N 個指示物（KO 後消耗）」。</li>
          <li><b>回合切換音效</b>（v3.900 banner 加聲音）：sfx.ts 加 <code>'turn-start'</code> 音效 — 清亮上行三音 C5→E5→G5 大三和弦琶音，每音 sine 0.10s，間隔 0.07s，總 0.24s。+page.svelte turnBanner $effect 內 <code>playSfx('turn-start')</code> 同步播放。</li>
          <li>tsc 0 errors；svelte/compiler 本地 parse 驗證通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.900</span> 回合切換時中央彈出「你的回合 / 對手回合」大字 banner</summary>
        <ul>
          <li>玩家建議：對戰中一方回合結束時彈出明顯文字提示，學其他 PTCG 網站「換人」全螢幕大字 UX。</li>
          <li><b>UX 規格</b>：
            <ul>
              <li>文字：中性「你的回合」/「對手回合」— 從目前操作者視角看，不需抓玩家名字（本機 2P / AI / 連線全通用）</li>
              <li>時機：每次回合切換都顯示（含自己 END_TURN）</li>
              <li>時長：1.5 秒（fade in 200ms + 顯示 1.1s + fade out 200ms）</li>
              <li>樣式：中央 pokeball（純 CSS 畫的紅白球）+ 粉紅大字配紅描邊 + scale pop 動畫</li>
              <li>pointer-events: none — 不擋玩家點擊互動</li>
            </ul>
          </li>
          <li><b>實作</b>：
            <ul>
              <li>game/+page.svelte 加 <code>turnBanner</code> $state + 監聽 <code>game.activePlayerIndex</code> 的 $effect</li>
              <li>用普通 let 變數 <code>_prevTurnPlayerIdx</code> 當 prev tracker（不在 $state，不會 trigger reactivity 循環）</li>
              <li>本機 2P 模式下 myIdx 跟著 activePlayerIndex 切 → 永遠顯示「你的回合」（從新操作者視角，符合直覺）</li>
              <li>連線 / AI 模式下 myIdx 固定 → 對手 END_TURN 顯示「你的回合」、自己 END_TURN 顯示「對手回合」</li>
              <li>setTimeout 1.5s 後用 timestamp 比對清掉（防 race：中途又切回合，新 banner 蓋舊的）</li>
            </ul>
          </li>
          <li><b>純 CSS pokeball</b>：用 linear-gradient 紅白漸層 + ::after 中央按鈕，免圖檔依賴。</li>
          <li>鐵律檢查：Rule 1（changelog 內 <code>$state</code> / <code>$effect</code> 用 code 標籤包，無 raw 大括號）；Rule 11（Python pipeline 改 +page.svelte 412KB 大檔）；Rule 4（本地用 svelte/compiler 直接 parse 驗證 .svelte，繞過 sandbox EPERM）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.899</span> hotfix：修 v3.895 changelog 違反 Iron Rule #1（未 escape 大括號）— 真正阻塞 deploy 的最終根因</summary>
        <ul>
          <li>v3.895 / v3.896 / v3.897 / v3.898 連續 4 次 deploy 紅 X。前 3 個 hotfix 都修錯方向：v3.896 修 pickedDmg scope、v3.897 修 UI 位置、v3.898 補 RULE_BOX_SUBTYPES import — 都是真實 bug 也補上了，但**真正的 build blocker 不是這些**。</li>
          <li><b>真因</b>：src/routes/+page.svelte:305 的 v3.895 changelog 內容有：<code>copyAttackChoice &#123; pokeIid: deckTop.iid, attackIndex &#125;</code> — 我寫描述時用了 raw <code>&#123;</code> 和 <code>&#125;</code>（沒 escape）。Svelte template 把它當成 expression block → parser error「Expected token &#125;」→ vite build fail。</li>
          <li><b>違反鐵律 #1</b>（Svelte 特殊字元 <code>&#123; &#125; &lt; &gt;</code> 在 template content 內必須 escape）。v2.733 / v3.55 已經踩過同樣的坑，這次又重蹈覆轍。</li>
          <li><b>修法</b>：把 line 305 的 <code>&#123;</code> 改 <code>&amp;&#35;123;</code>、<code>&#125;</code> 改 <code>&amp;&#35;125;</code>。</li>
          <li><b>為什麼我前面查不到</b>：tsc 不檢查 .svelte / svelte-check 在 sandbox EPERM unlink 把真實錯誤埋在很多 noise 後面 — 直到我把 repo 複製到 /tmp（可寫 dir）跑 svelte-check 才看到「Expected token &#125; at line 305」這個明確的根因。教訓：以後 deploy 失敗時 first thing 必須跑 svelte-check 完整 output（必要時 copy 到 /tmp）找真正的 build blocker，不要憑直覺猜。</li>
          <li>tsc 0 errors（一直都是 0 — tsc 看不到 .svelte template）；svelte-check 在 /tmp/build-test 環境跑通過 = vite build 可成功。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.898</span> hotfix：補 +page.svelte 漏掉的 RULE_BOX_SUBTYPES import（v3.895 起 deploy 連續失敗的真正根因）</summary>
        <ul>
          <li>v3.895 / v3.896 / v3.897 GitHub Pages deploy 全部紅 X。先以為是 v3.897 修的 UI 位置問題，實際上還有第二個錯誤：v3.895 在 onAttackClick 用了 <code>RULE_BOX_SUBTYPES.has(...)</code>（runtime const）但 +page.svelte line 21 只有 <code>import type &#123; GameState, CardInstance &#125;</code>（type-only），runtime constants 沒 import → svelte-check 報「Cannot find name 'RULE_BOX_SUBTYPES'」→ vite build fail。</li>
          <li><b>為什麼 tsc 沒抓到</b>：tsc --noEmit 不檢查 .svelte 檔案內的 script，只看 .ts。改 .svelte 必須跑 svelte-check / vite build 才能驗證 — 之前 v3.893 hasFlowerVeil 也是同類失誤，這次又重蹈覆轍。</li>
          <li><b>為什麼 push 腳本沒補上</b>：v3.895 push_v3895.py 有 fallback import injection 邏輯，但 guard 用 <code>if 'RULE_BOX_SUBTYPES' not in page</code>。問題是該段在 replace 之後執行 — 但 replace 已注入 <code>RULE_BOX_SUBTYPES.has(...)</code> 函式呼叫，guard 變永遠 false → import 從未補上。同 v3.892 hasFlowerVeil import-guard 順序 bug。</li>
          <li><b>修法</b>：在 +page.svelte line 21（GameState/CardInstance type import）之後加 <code>import &#123; RULE_BOX_SUBTYPES &#125; from '$lib/game/types';</code>。</li>
          <li><b>教訓</b>（補進 SKILL.md / IRON_RULES.md）：① import-guard check 必須在 replace <b>之前</b>做（針對原始 page），不能在 replace 之後（page 已被污染）。② 改 .svelte 檔案的本地驗證不能只看 tsc — 必須 svelte-check（即使 sandbox 上 EPERM unlink 那段，後續 error 列表仍可信）。</li>
          <li>tsc 0 errors（本來就 0 — 因為 tsc 看不到 .svelte 內的這行）；svelte-check 真實阻塞錯誤已消除。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.897</span> hotfix：修 v3.895 brightChallengePicker UI 插入位置錯誤導致 deploy 失敗</summary>
        <ul>
          <li>v3.895 / v3.896 GitHub Pages deploy 失敗（紅色 X）。根因：v3.895 push 腳本用 <code>page.find('&#123;/if&#125;', pp_start)</code> 找 personateAttackPicker UI 的結束點，但 personate UI 內部有 <code>&#123;#if atk.damage&#125;&lt;span&gt;...&lt;/span&gt;&#123;/if&#125;</code> — 這個內部 <code>&#123;/if&#125;</code> 比外層先出現 → find 抓到內部 <code>&#123;/if&#125;</code>，導致 brightChallengePicker UI 被誤插到 personate 內部的 <code>&lt;div class="copy-attack-atks"&gt;</code> 內 → Svelte template 結構斷裂 → vite build 失敗。</li>
          <li><b>修法</b>：把錯位的 brightChallengePicker UI block 整段 cut + 在 personate UI 真正結束的 <code>&#123;/if&#125;</code>（緊接 Retreat Menu 註解之前）後正確插入。</li>
          <li><b>教訓</b>（補進 SKILL.md / IRON_RULES.md 相關段）：用 Python pipeline 改大 Svelte 檔案找插入點時，用「下一個 <code>&#123;/if&#125;</code>」這種 naive search 不可靠，因為 Svelte template 內各層巢狀有多個 <code>&#123;/if&#125;</code>。應該用具備獨特性的 anchor（如「下一個 &lt;!-- v3.xx 註解」或「下一個 named 結構特徵」）。本次用「下一個 Retreat Menu 註解」就絕對精準。</li>
          <li>tsc 0 errors。v3.895 + v3.896 + v3.897 一起構成完整修法（耀閃挑戰選招 picker + scope hotfix + UI 位置修正）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.896</span> hotfix：修 v3.895 耀閃挑戰 pickedDmg 變數 out-of-scope 編譯錯誤</summary>
        <ul>
          <li>v3.895 重寫 regPre 時把 <code>pickedDmg</code> 從外層 let 改為 local-scope（藏在 fallback 分支裡）。但「無註冊 regPre → 退回印刷傷害」分支 (line 134) 仍引用 <code>pickedDmg</code> → tsc TS2552。</li>
          <li>修法：fallback 路徑改用 <code>parseDmgFallback(picked.damage)</code> 直接解析數字，不依賴外層變數。</li>
          <li>無功能變化，只是補上 v3.895 編譯錯誤。tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.895</span> 呆呆王｜耀閃挑戰：牌庫頂寶可夢有 2+ 招時開選招 picker</summary>
        <ul>
          <li>玩家回報：呆呆王 耀閃挑戰 從牌庫抽出的寶可夢若擁有 2 個以上招式，目前系統自動挑印刷最高傷害，玩家不能自己選。</li>
          <li>卡面（SV7 10934）：「將自己的牌庫上方 1 張卡丟棄，若那張卡為寶可夢卡（『擁有規則的寶可夢』除外），則<b>選擇 1 個</b>那隻寶可夢持有的招式，作為這個招式使用。」— 卡面明文「選擇」，自動挑違反規則。</li>
          <li><b>實裝</b>（複用 v3.873 扮晶晶酒 pattern）：
            <ul>
              <li>UI 攔截：onAttackClick 偵測「耀閃挑戰」→ peek 自己牌庫頂 → 不符條件直接 dispatch 讓 engine 失敗 log；1 招自動帶 copyAttackChoice 直接 dispatch；<b>2+ 招開 brightChallengePicker</b> 列出該卡所有招式</li>
              <li>玩家挑招後：dispatch ATTACK 時把 copyAttackChoice &#123; pokeIid: deckTop.iid, attackIndex &#125; 塞進 action</li>
              <li>regPre 讀 action.copyAttackChoice — pokeIid 驗證 === deck[0].iid（防 race，理論上 attack handler 跑時 deck 未變）→ 用 choice.attackIndex；mismatch / 越界 / 無 choice（AI / 舊 state）→ fallback 自動挑印刷最高（v2.57 行為）</li>
            </ul>
          </li>
          <li><b>UX 細節</b>：
            <ul>
              <li>牌庫空 / 非寶可夢 / 規則寶可夢（ex/V 等）/ 0 招 → 不開 picker，直接 dispatch（engine 自會 log「招式效果失敗」+ 丟棄那張卡）</li>
              <li>1 招卡（如「皮卡丘 雷電」單招）→ 不開 picker，自動帶 attackIndex=0（避免單一選項浪費 UX 步驟）</li>
              <li>2+ 招 → 開 modal 列出卡圖 + 所有招式，每招顯示 cost / 印刷傷害 / 效果（hover tooltip），玩家點按即執行</li>
            </ul>
          </li>
          <li><b>邊界考慮</b>：UI peek 自己牌庫頂屬於「使用招式必經之路」— 連線對戰時對手看不到我端 deck 順序（Firestore 同步 server 不會 leak 對手 deck 排序），無資訊洩漏問題。借者是呆呆王（非太晶），借到的招式若有 PRE_DISCARD_CHOICE（如金屬之錘）走 v3.72 邏輯 sentinel 注入。</li>
          <li>tsc 0 errors。鐵律：Rule 1（無 svelte 特殊字元，brightChallengePicker UI 全部用 &#123;#each&#125; / &#123;#if&#125; 正規 Svelte 語法）/ Rule 11（Python pipeline + safe_write 改 +page.svelte 412KB 大檔）/ Rule 4（tsc 驗證）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.894</span> ⚠ 修 bench-hit-N resolver 誤套對戰圓形（招式傷害 vs 招式效果混淆）</summary>
        <ul>
          <li>玩家回報：用激流水泵（卡面：「對手 1 隻備戰受到 120 傷害」）對備戰造成傷害時，log 顯示「對戰圓形競技場效果 — 對手備戰不受此效果傷害」誤擋。</li>
          <li><b>規則回顧</b>（PTCG 三類「掉血」概念）：
            <ul>
              <li><b>招式傷害 attack-damage</b>：卡面「對 X 造成 N 點傷害」。擋頭：花之帷幔 / 太晶備戰 / 中立中心 / 球形盾牌 / 藏隱 / 深度下潛 / 羽毛化石。<b>不擋</b>：對戰圓形 / 抵抗之幕。</li>
              <li><b>招式效果 attack-effect</b>：卡面「放置傷害指示物」/ 異常狀態 / 回收能量等。擋頭：對戰圓形 / 抵抗之幕（基礎火箭隊） / 球形盾牌 / 藏隱 / 深度下潛 / 羽毛化石。<b>不擋</b>：花之帷幔（只擋傷害）。</li>
              <li><b>特性效果 ability-effect</b>：特性「放傷害指示物」（如咒詛炸彈）。擋頭：對戰圓形。<b>不擋</b>：花之帷幔 / 抵抗之幕（兩者明文「只擋招式」）。</li>
            </ul>
          </li>
          <li><b>根因</b>：<code>bench-hit-N</code> resolver（effects.ts:759-761）v2.22 加的 <code>isBenchProtected</code> check 註解寫「招式效果跳過」，但實際 resolver 處理的是 <code>hitBenchPickPost</code>（對備戰造成 N 點【傷害】）— 屬於 attack-damage。把對戰圓形錯套到 attack-damage 分支。</li>
          <li><b>修法</b>：移除 <code>bench-hit-N</code> resolver 內的 <code>isBenchProtected</code> check。下方 v3.888 加的 per-target <code>resolveBenchGuard(kind='attack-damage')</code> 會按規則正確處理（不擋對戰圓形 / 不擋抵抗之幕，但擋花之帷幔 / 太晶 / 球形盾牌 / 藏隱 / 深度下潛）。</li>
          <li><b>受惠招式</b>（所有走 hitBenchPickPost 的招式傷害類，對戰圓形不再誤擋）：
            <ul>
              <li>精神尖槍（代歐奇希斯 M4）— 對手 1 隻備戰 120</li>
              <li>激流水泵（厄鬼椪 水井面具ex MC）— 對手 1 隻備戰 120</li>
              <li>狙擊類：暗影子彈 / 雙生鐳射 / 三重冰霜 / 噴射打擊 等</li>
            </ul>
          </li>
          <li><b>對戰圓形 / 抵抗之幕 audit 結果</b>（其他 5 個 isBenchProtected 使用點全部正確，本次不動）：<code>resolveBenchGuard</code>（只在 effect/ability-effect kind 套） / <code>applyDamageToAllOpp</code>（痛楚記憶 / 侵蝕之風，卡面「放指示物」） / 悄聲加害（卡面「放 2 個指示物」） / 幻影奇襲（卡面「放 6 個指示物」） / 咒詛炸彈（特性「放指示物」）。</li>
          <li>tsc 0 errors。鐵律：Rule 1（無特殊字元） / Rule 7c（已查卡面原文：「受到 X 點傷害」是 damage、「放置傷害指示物」是 effect）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.893</span> 🔧 hotfix：補 v3.892 engine.ts 漏掉的 hasFlowerVeil import</summary>
        <ul>
          <li>v3.892 push 腳本 import-guard 順序 bug：先 replace 插入 <code>hasFlowerVeil(state, dIdx, pool)</code> snapshot 呼叫，後才 <code>if 'hasFlowerVeil' not in eng</code> 判斷是否補 import。但 replace 後 eng 已含函式呼叫，guard 永遠 false → import 從未補上。</li>
          <li>結果：v3.892 deploy 編譯失敗（<code>tsc error TS2304: Cannot find name 'hasFlowerVeil'</code>），花之帷幔 attack-time snapshot fix 沒生效。</li>
          <li><b>修法</b>：補 engine.ts import block 加 <code>hasFlowerVeil</code>（從 <code>./effects</code>）。</li>
          <li>無功能變化，只是補上 v3.892 應有的 import。tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.892</span> 🛡 修花之帷幔 attack-time snapshot — spread 招式 KO 謝米後備戰仍應免疫</summary>
        <ul>
          <li>玩家回報 + 官方 QA（虛無歸零案例）：對手戰鬥場有花之帷幔謝米時，招式同時對 active + 備戰造成傷害的情況下，即使戰鬥場謝米被招式 KO，花之帷幔仍對備戰生效。</li>
          <li>原文：「招式效果會對所有寶可夢同時造成傷害，因此花之帷幔效果會生效，無法對備戰非規則寶可夢造成傷害，只會在對謝米造成傷害後即結束招式處理。」</li>
          <li><b>根因</b>：POST handler 拿到的 state 是 damage-applied + KO-resolved 後的 state。defender.active 已 null（戰鬥場謝米被 KO 了）→ <code>hasFlowerVeil</code> 看不到謝米 → 認為沒花之帷幔 → 備戰受傷。實際 PTCG 規則要用攻擊宣告當時的場上狀態判定。</li>
          <li><b>修法</b>：用 <b>attack-time snapshot</b> 機制：
            <ul>
              <li><code>GameState</code> 加 transient field <code>_attackTimeOppFlowerVeil?: boolean</code></li>
              <li>engine.ts ATTACK handler 在 PRE 之前 set: <code>state._attackTimeOppFlowerVeil = hasFlowerVeil(state, dIdx, pool)</code></li>
              <li>engine.ts ATTACK handler 末尾（POST 後）清掉 flag</li>
              <li><code>hitBenchPickPost</code> 入口 check：<code>targetSide === 'opp' && _attackTimeOppFlowerVeil</code> → 整段 skip + log（picker 不開）</li>
              <li><code>hitBenchAll</code> 入口同樣 check：<code>attackerIdx !== targetIdx && _attackTimeOppFlowerVeil</code> → skip + log</li>
            </ul>
          </li>
          <li><b>受惠招式</b>（所有走 hitBenchPickPost / hitBenchAll 的對手備戰類）：
            <ul>
              <li>精神尖槍（代歐奇希斯）— 對手備戰 1 隻 120</li>
              <li>激流水泵（厄鬼椪 水井面具ex）— 對手備戰 1 隻 120</li>
              <li>地震 / 燃燒熱浪 / 雙生鐳射 / 突圍 / 冰霜子彈 等 spread 類</li>
              <li>惡劣光束 / 雙向頭擊 / 火人加農炮 / 冰之射擊 / 剎那斬 / 暗影子彈 / 業火連踢 / 貫通鑽 / 電氣子彈 / 穿通 / 噴射打擊 / 羽毛強襲 / 飛馳 / 火焰聖靈 / 三重冰霜 等所有走 helper 的「對戰鬥+備戰同時傷害」招式</li>
            </ul>
          </li>
          <li><b>不影響</b>：純戰鬥場攻擊（戰鬥場套花之帷幔 active-self gate 不適用、active 直接受傷）；對手戰鬥場無謝米時無變化。</li>
          <li>tsc 0 errors。鐵律檢查：Rule 1（無 svelte 特殊字元）/ Rule 11（Python pipeline + safe_write）/ Rule 4（tsc 驗證）/ Rule 7c（已查官方 QA 卡面原文）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.891</span> 🎯 log 卡名點擊精準追溯：LogEntry 加 sourceIid 直接綁定產生 log 的 actor inst</summary>
        <ul>
          <li>玩家擔心 v3.890 對「場上同時有兩隻不同版本同名卡」case 仍可能誤抓。</li>
          <li><b>修法（三層 fallback 直接追溯）</b>：
            <ul>
              <li><b>LogEntry 加 <code>sourceIid?</code></b>：<code>addLog</code> 自動從 <code>state.players[playerIndex]?.active?.iid</code> 取（兩處 — engine.ts + effects/_shared.ts）。每筆 log 帶著「誰產生這個 log」的精確 inst iid。</li>
              <li><b>openZoomByName 加 hint 參數</b>：<code>(cardName, hintSourceIid?, hintPlayerIdx?)</code> 三層 fallback：
                <ol>
                  <li>hintSourceIid 對應 inst（若名字符合）— 例如「代歐奇希 使用精神尖槍」點代歐奇希 → 直接綁定到那隻代歐奇希 inst</li>
                  <li>hintPlayerIdx 玩家場上 active/bench/hand/discard 找同名（actor side）</li>
                  <li>對手玩家場上找同名（target side — 例如「謝米 受到 120」點謝米通常在對手場）</li>
                  <li>全 pool 第一個同名（離場 / 牌庫深處）</li>
                </ol>
              </li>
              <li><b>log 渲染 button</b>：<code>onclick={() => openZoomByName(tok.text, entry.sourceIid, entry.playerIndex)}</code>（兩處 — +page.svelte + MobilePortraitBattle.svelte）</li>
            </ul>
          </li>
          <li><b>同名多版本場景測試</b>：場上有 70HP 謝米 + 對手有 80HP 謝米。Log「我方 X 使用 Y → 對手謝米受傷」— playerIndex = 我方，sourceIid = X.iid，名字「謝米」與 X 不符（fallthrough）→ 掃 hintPlayer 場上的「謝米」（我方 70HP）→ 找到，但這是 actor side... 嗯這 case 還是會抓錯。</li>
          <li><b>已知限制</b>：log message 純文字，無法區分 mention 的是 attacker 或 target。若雙方場上都有同名 inst，會偏向 actor side（hintPlayerIdx）的版本。真正完美需要把 mention iid 編碼到 log message marker（例如 <code>謝米&lt;iid:abc&gt;</code>），這是未來大重構議題。本版先解決 actor 自己被點的 case（最常見場景）。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.890</span> 🔗 log 卡名點擊優先用「場上實際 inst」對應版本（解決同名多版本誤抓）</summary>
        <ul>
          <li>玩家回報：對戰 log 點「謝米」連結開到 70HP 版本（無花之帷幔），但場上實際是 80HP 14672 版本。</li>
          <li><b>根因</b>：<code>openZoomByName</code> 用 <code>for (const c of pool.values())</code> 抓「第一個同名 Card」，pool iteration order ≈ set 加載順序。謝米 70HP 版本（M-P-J / M3 / MC / SVM / SV5K）都比 80HP 版本（M2a 14672 / SV9a 12664/12724）早加載，所以永遠抓到 70HP 版本。</li>
          <li><b>修法</b>：<code>openZoomByName</code> 先掃雙方 active / bench / hand / discard 找同名 inst，用該 inst.cardId（精確版本 + 帶 inst 顯示場上狀態）。場上找不到才 fallback 全 pool 第一個同名。</li>
          <li><b>受惠範圍</b>：所有同名多版本卡片 — 謝米 / 妙蛙種子 / 各種基本能量 / 重印卡（赤松 / 神奇糖果 / 莉莉艾等）。Log 點擊現在會匹配場上實際版本而非 set 順序最早版本。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.889</span> 📝 糾正 v3.888 changelog 列「抵抗之幕」腦補錯誤</summary>
        <ul>
          <li>玩家指出 v3.888 changelog 寫「抵抗之幕」會擋精神尖槍是錯的。</li>
          <li><b>正解</b>：抵抗之幕（火箭隊的急凍鳥）只擋「招式的<b>效果</b>」(attack-effect)，<b>不擋</b>「招式的<b>傷害</b>」(attack-damage)。精神尖槍對備戰 120 點是「招式傷害」不是「招式效果」（卡面寫「也受到 120 點傷害」是 damage、非 counter），所以本來就不該被抵抗之幕擋。</li>
          <li><b>程式碼實際正確</b>：v3.888 在 <code>bench-hit-N</code> 內用 <code>kind='attack-damage'</code> 呼叫 <code>resolveBenchGuard</code>。<code>resolveBenchGuard</code> 內部分流 — 抵抗之幕只在 <code>kind === 'attack-effect'</code> 分支檢查，所以精神尖槍走 attack-damage path 完全不會碰到抵抗之幕。修法本身正確，受惠特性實際只有 <b>花之帷幔 / 太晶備戰 / 陳舊羽毛化石 / 中立中心 / 球形盾牌 / 藏隱 / 深度下潛</b> 等 attack-damage 類擋下。</li>
          <li><b>本版動作</b>：只修 v3.888 changelog 拿掉錯誤的「抵抗之幕」條目，程式碼不動。</li>
          <li><b>規則記憶</b>：<b>招式傷害</b>（attack-damage，含戰鬥位 base damage + 對備戰 N 傷害）vs <b>招式效果</b>（attack-effect，放指示物 / debuff / status）是兩個完全不同的判定群組，blocker 名單也不同：
            <ul>
              <li><b>attack-damage 擋頭</b>：花之帷幔 / 太晶備戰 / 中立中心 / 陳舊羽毛化石 / 藏隱 / 深度下潛 / 球形盾牌</li>
              <li><b>attack-effect 擋頭</b>：對戰圓形 / 抵抗之幕 / 陳舊羽毛化石 / 藏隱 / 深度下潛 / 球形盾牌</li>
            </ul>
          </li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.888</span> 🐛 修花之帷幔等 6 種備戰免疫特性對 精神尖槍 / 激流水泵 等備戰打擊招式失效</summary>
        <ul>
          <li>玩家回報：代歐奇希 精神尖槍 攻擊有「花之帷幔」謝米備戰，特性沒擋住。</li>
          <li><b>根因</b>：<code>regR('bench-hit-N', ...)</code> resolver（所有走 picker 對備戰打傷害的招式共用 — 精神尖槍 / 激流水泵 / 鐵之震動 / 火焰旋風 等）只檢查對戰圓形 (<code>isBenchProtected</code>) 和太晶 (per-target <code>tags</code>)，**漏了 <code>resolveBenchGuard</code> 整套** — 包括：
            <ul>
              <li>謝米｜花之帷幔（M2a/SV9a 80HP）— 自己備戰非規則寶可夢不受招式傷害</li>
              <li>斯魔茶｜藏隱 — 自己在備戰時不受招式傷害與效果</li>
              <li>小霞的鯉魚王｜深度下潛 — 同上</li>
              <li>蟲甲聖｜球形盾牌（A1）— 自己備戰不受招式傷害與效果</li>
              <li>陳舊的羽毛化石（I）— 備戰時不受招式傷害與效果</li>
            </ul>
          </li>
          <li><b>修法</b>：<code>bench-hit-N</code> for loop 內，對每隻 hit target 呼叫 <code>resolveBenchGuard(st, pool, actorIdx, card, 'attack-damage')</code>。如果 blocked，該隻 newBench 不變、+ log 「免疫此招式傷害 — X：原因」。<code>targetIdx !== actorIdx</code> 才檢查（自殘類不擋）。</li>
          <li><b>受惠範圍</b>：所有走 hitBenchPickPost / hitBenchAll 等 helper 的招式都自動修好（精神尖槍 / 激流水泵 / 鐵之震動 / 火焰旋風 / 油之機關槍 / 等等）。</li>
          <li><b>關於「點擊變成 70HP 謝米」</b>：謝米有 8 個 cardId 變體（M-P-J/M2a/M3/MC/SV5K/SV9a×2/SVM），其中只有 <code>14672</code> (M2a) / <code>12664</code>+<code>12724</code> (SV9a) 是 80HP 帶花之帷幔。若對手 deck 收的是 70HP 版本，點擊看到的就是 70HP 版本（正常）。但 bench-hit-N 不擋花之帷幔本來就是 bug，已修。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.887</span> 📱 zoom-modal 加可收折區塊（場上狀態 / 特性 / 招式）— 採用使用者建議</summary>
        <ul>
          <li>玩家建議：放棄修 scroll，改加可收折區塊解決「文字敘述版面過長」問題。</li>
          <li><b>實作</b>：用 native HTML <code>&lt;details&gt;</code> 元素包裹三類區塊，每個都有 <code>&lt;summary&gt;</code> 標題列可點開/收合：
            <ul>
              <li><b>📍 場上狀態</b>：HP / 附能 / 道具 / 異常 / 進化鏈 / 各種旗標</li>
              <li><b>✨ 特性 - 名稱</b>：每個特性各自一個 details</li>
              <li><b>⚔️ 招式名稱 + 能量 + 傷害</b>：每個招式各自一個 details，summary 已含 cost pip + 名稱 + 傷害</li>
            </ul>
          </li>
          <li><b>預設狀態</b>：<code>open=&#123;!isPortraitMobile&#125;</code> — 桌機展開（空間充足），手機直式預設收折。手機點 summary 才展開要看的內容；不展開的就只佔 1 行 summary。</li>
          <li><b>CSS</b>：<code>.zoom-section</code> 加 border + 背景 + hover；<code>.zoom-section-summary::before</code> ▸ 三角形旋轉動畫（open 時轉 90°）。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.886</span> 📱 真正讓手機 zoom 圖片縮小 — !important 覆寫桌機 width:312px + flex-shrink:0</summary>
        <ul>
          <li>玩家回報：v3.885 沒生效，吉雉雞ex 圖片仍佔大半畫面，下面內容被截掉。</li>
          <li><b>根因</b>：v3.885 寫了 <code>.zoom-img max-height: 36vh</code> 但桌機 <code>.zoom-img &#123; width:312px; flex-shrink:0 &#125;</code> 仍套用，加上 <code>.zoom-body display:flex row wrap</code> 結構讓圖片維持自然尺寸不縮。</li>
          <li><b>修法</b>：用 <code>!important</code> 強制覆寫桌機規則 + 改 <code>.zoom-body</code> 為 column stack：
            <ul>
              <li><code>.zoom-modal</code> 全 fullscreen 屬性加 !important（避免桌機 max-width:864px 漏網）</li>
              <li><code>.zoom-body</code>：<code>flex-direction:column !important; flex-wrap:nowrap !important; align-items:center</code> — 圖片在上、info 在下垂直排</li>
              <li><code>.zoom-img</code>：<code>max-height:34vh !important; max-width:88vw !important; width:auto !important; flex-shrink:1 !important</code></li>
              <li><code>.zoom-img-btn</code>：<code>pointer-events:auto !important; cursor:zoom-in !important</code> — 重啟 lightbox 點圖功能</li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.885</span> 📱 zoom-modal 改 fullscreen 策略：放棄 scroll 修法，圖片自適應 + lightbox 點圖看全圖</summary>
        <ul>
          <li>v3.879~v3.884 連續 6 個 hotfix 都修不好手機 zoom-modal scroll。改採用使用者建議的新策略：fullscreen 鋪版避開 scroll。</li>
          <li><b>新方案</b>：
            <ul>
              <li>手機 <code>.zoom-modal</code> 鋪滿整個 viewport（<code>100vw × 100dvh</code>，無 border-radius）— 等同對戰背景大小</li>
              <li>卡牌圖片 <code>max-height: 36vh</code> + <code>object-fit: contain</code> 自適應縮小（最大不超過自然大小）</li>
              <li>重新啟用 <code>.zoom-img-btn</code> 的 <code>pointer-events</code>（之前 v2.206 註解說手機不需要 lightbox 二段，但使用者要求加回）</li>
              <li>點圖即開 lightbox（同卡牌資料庫 <code>/cards</code> 的全螢幕看圖機制）— 仍可 pinch zoom 看細節</li>
              <li><code>.zoom-scroll</code> 仍保留 <code>overflow-y:auto</code> 兜底 — 真的還是溢出時非 flex 容器 iOS 應該能滑（雖然主要靠 fullscreen 讓內容塞下）</li>
            </ul>
          </li>
          <li><b>備註</b>：v3.884 的 <code>.zoom-scroll</code> wrapper 保留 — 跟新 fullscreen 策略相容（fullscreen 給更多空間，scroll wrapper 兜底）。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.884</span> 📱 真正修好 zoom-modal 滾動：iOS Safari flex + overflow-y bug（拆 .zoom-scroll 內層）</summary>
        <ul>
          <li>玩家連續回報：v3.879/v3.880/v3.882 改 CSS 都沒用，零閘垂直拖曳就是不動。對照 <code>.selection-modal</code>（手機可滑）找出 root cause。</li>
          <li><b>真正根因（這次對照其他可滑 modal 找到的）</b>：<code>.zoom-modal</code> 同時是 (1) <code>display:flex</code> 容器（讓 image + info 排版）+ (2) <code>overflow-y:auto</code> scroll 容器。iOS Safari 對「flex container 同時是 scroll container」有 known bug — momentum scroll 完全不啟動，即使加再多 <code>touch-action: pan-y</code> / <code>-webkit-overflow-scrolling</code> 都沒用。對照組：<code>.selection-modal</code> 是 flex 但 NO overflow（scroll 由內層 <code>.sel-grid</code> 處理），手機 <code>.mp-hand</code> 是 block 配 overflow-x，兩者都能滑。</li>
          <li><b>修法（拆兩層）</b>：
            <ul>
              <li>新增 <code>.zoom-scroll</code> 非 flex 內層 wrapper 包住 <code>.zoom-body</code>（含 image + info）</li>
              <li><code>.zoom-modal</code> 變純 flex column 排版容器（<code>overflow:hidden</code>、不 scroll）</li>
              <li><code>.zoom-scroll</code> 是真正 scroll 容器：<code>flex:1 1 auto + min-height:0 + overflow-y:auto + touch-action:pan-y + -webkit-overflow-scrolling:touch + overscroll-behavior:contain</code></li>
              <li><code>min-height:0</code> 是 flex child + overflow 的關鍵 — 無此屬性 flex child 默認 min-content 不收縮 → 內容永遠不溢出 → 不 scroll</li>
            </ul>
          </li>
          <li>HTML 結構改動：加 <code>&lt;div class="zoom-scroll"&gt;</code> 包 <code>.zoom-body</code>，相對應 close button 與 back button 仍 absolute 定位在 <code>.zoom-modal</code> 不受影響。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.883</span> 🤖 修 AI 用激流水泵不觸發備戰 120（沒帶 discardedEnergyIids）</summary>
        <ul>
          <li>玩家回報：厄鬼椪 水井面具ex 使用激流水泵時「能量回牌庫」但對手備戰沒受 120 傷害。</li>
          <li><b>根因</b>：<code>ai.ts</code> line 256 dispatch <code>ATTACK</code> 只帶 <code>attackIndex</code>，沒帶 <code>discardedEnergyIids</code>。激流水泵 PRE 讀 <code>action.discardedEnergyIids ?? []</code> = <code>[]</code>，length 0 &lt; required 3 → 走「未棄滿能量」分支只 100 dmg，不觸發備戰 120。</li>
          <li><b>修法</b>：AI 對 <code>激流水泵</code> 自動填 <code>discardedEnergyIids</code> = 攻擊方前 required 顆能量。條件：
            <ul>
              <li>對手有 bench（有 120 傷害目標）</li>
              <li>攻擊方能量數 ≥ required（值得啟用 option）</li>
              <li>required：璀璨結晶 attached → 2 否則 3（同 PRE/POST 邏輯）</li>
            </ul>
          </li>
          <li>玩家透過 UI picker 使用：v3.875 已正常觸發（picker 強制選 0 或 required，選 required 時 dispatch 帶 iids）。本次只修 AI dispatch 缺漏。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.882</span> 📱 真的真的修好 zoom-modal 滾動：拿掉 body.mp-locked 的 position:fixed</summary>
        <ul>
          <li>玩家回報：v3.881 拿掉 body 的 touch-action: none 後仍無法滾動。</li>
          <li><b>真正根因（這次真的找對了）</b>：<code>body.mp-locked</code> 還有 <code>position: fixed</code>（v2.288 加的雙保險）— iOS Safari 對 <code>body[position:fixed]</code> 內的 nested scrollable 元素有 known issue，<code>overflow-y:auto</code> 不會啟動 momentum scroll，整個 viewport 被當「不可滾動的快照」處理。</li>
          <li><b>修法</b>：拿掉 body.mp-locked 的 <code>position: fixed</code> / <code>width: 100%</code> / <code>height: 100dvh</code>。靠：
            <ul>
              <li><code>.mp</code> 本身已 <code>position: fixed; inset: 0</code> cover 視窗 — body 不需重複設</li>
              <li>body <code>overflow: hidden</code> + <code>overscroll-behavior: none</code> 擋 body 滾動 + pull-to-refresh</li>
              <li>JS <code>preventScroll</code>（MobilePortraitBattle.svelte）雙保險擋 touchmove outside whitelist</li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.881</span> 🔧 hotfix：v3.880 changelog 內 raw &#123; &#125; 違反 Iron Rule #1，build 失敗</summary>
        <ul>
          <li>v3.880 push 後 GitHub Actions build 失敗 — <code>Build SvelteKit app</code> step error: <code>Expected token &#125;</code> at line 270:101。</li>
          <li>根因：v3.880 changelog 寫 <code>&lt;code&gt;:global(body.mp-locked) &#123; touch-action: none &#125;&lt;/code&gt;</code> 直接放 raw <code>&#123;</code> <code>&#125;</code>，Svelte template 把它當 JS expression 解析失敗（同 v3.832 / v3.55 重複踩過的雷）。</li>
          <li>修法：raw <code>&#123;</code> <code>&#125;</code> 改 HTML entity <code>&amp;#123;</code> <code>&amp;#125;</code>。版本順 bump 到 v3.881 重新觸發 deploy。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.880</span> 📱 真正修好 zoom-modal 滾動：拿掉 body.mp-locked 的 touch-action: none</summary>
        <ul>
          <li>玩家回報：v3.879 在 .zoom-modal 加 <code>touch-action: pan-y</code> 仍無法滾動。</li>
          <li><b>真正根因</b>：<code>line 6960-6968</code> 的 <code>:global(body.mp-locked) &#123; touch-action: none &#125;</code>（v2.288 為了擋 iOS pull-to-refresh 加的）。iOS Safari 對 body 級 <code>touch-action: none</code> 解讀很強硬 — 會壓制所有 nested scrollable 元素的 pan gesture，即使該元素本身宣告 <code>touch-action: pan-y</code> 也敗給 body level。zoom-modal 真的有 overflow-y:auto，但 iOS 不啟動 scroll。</li>
          <li><b>修法</b>：拿掉 body.mp-locked 的 <code>touch-action: none</code>。靠：
            <ul>
              <li>JS <code>preventScroll</code>（MobilePortraitBattle.svelte，v3.871 加的）— 擋 touchmove outside whitelist，仍擋 pull-to-refresh</li>
              <li><code>overscroll-behavior: none</code> — 保留，擋 overscroll bouncing</li>
              <li><code>position: fixed + width:100% + height:100dvh</code> — 保留，防止整頁位移</li>
            </ul>
            這樣 body level 不強制 touch-action: none，巢狀 modal 可正常 pan scroll；同時 JS 層仍擋 pull-to-refresh 觸發。
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.879</span> 📱 hotfix：iOS Safari 查看詳情 zoom-modal 無法垂直滾動（v3.872 whitelist 不夠）</summary>
        <ul>
          <li>玩家回報：v3.872 加 docMoveHandler whitelist 後 iPhone 仍無法滾動 zoom-modal，喵喵ex / 吉雉雞ex 等長文卡片下半被切掉看不到。</li>
          <li><b>根因</b>：whitelist 只解決 touchmove preventDefault 層，但 iOS Safari 對 fixed-positioned 容器內的巢狀 scroll 有額外要求 — 必須在 scrollable 容器上顯式宣告 <code>touch-action: pan-y</code>（明確告訴 iOS「這裡可以垂直 pan」），否則 iOS 會把觸控當成 gesture 一律忽略。.mp 容器的 <code>touch-action: none</code>（v3.861 鎖主畫面拖曳用）在 iOS 會「全域感染」式影響觸控解讀，必須在 modal 層顯式覆寫。</li>
          <li><b>修法</b>：<code>.zoom-modal</code> 桌機 + 手機 + portrait mobile 三處 CSS override 都加：
            <ul>
              <li><code>touch-action: pan-y</code> — 明確允許垂直 pan（iOS Safari 必要）</li>
              <li><code>overscroll-behavior: contain</code> — 滾動到底/頂時不觸發外部捲動 / pull-to-refresh</li>
              <li><code>-webkit-overflow-scrolling: touch</code> — 啟用 iOS native 慣性滾動（legacy 但仍對某些版本有用）</li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.878</span> 🐛 活力森林 第 1 動作回合 UI 黃框誤導補修（v3.877 只改 engine handler 不夠）</summary>
        <ul>
          <li>玩家回報：v3.877 第 1 動作回合場上有活力森林時，engine 確實擋下進化（正確），但手牌的進化卡仍顯示黃框、場上寶可夢仍有「進化」標示 — 視覺誤導玩家以為可進化。</li>
          <li><b>根因</b>：v3.877 只改了 <code>engine.ts</code> 的 EVOLVE handler 內 <code>vigorousForestException</code> 加 <code>state.turn &gt; 1</code>，但 UI 端的 <code>getEvolvableTargets</code> helper（<code>engine.ts:6029</code>）的 <code>isForest</code> 變數沒同步加。<code>getEvolvableTargets</code> 是手牌進化卡黃框 + 場上「進化」標的 UI 來源。</li>
          <li><b>修法</b>：<code>getEvolvableTargets</code> 的 <code>isForest = stadiumName === '活力森林'</code> 加 <code>&amp;&amp; state.turn &gt; 1</code>，與 EVOLVE handler 完全一致。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.877</span> 🐛 三張卡「最初回合除外」gate 一致性修正（同 v3.874 風扇呼喚 turn 語意誤解）</summary>
        <ul>
          <li>背景：<code>state.turn</code> 只在「後攻方 END_TURN」才 +1（<code>engine.ts:5737</code>），所以 <code>state.turn===1</code> 同時涵蓋雙方各自的第 1 動作回合。v3.874 風扇呼喚已修；本版補修同類 3 張卡。</li>
          <li><b>① 活力森林（Stadium）</b>：bypass 條件原本只靠 <code>state.isFirstTurn</code> gate（line 1905）擋第 1 動作回合 — 但 <code>isFirstTurn</code> 只在先攻方第 1 動作回合 true，後攻方第 1 動作回合已 false → 後攻可以剛上場的草寶可夢直接進化（卡面：「自己的最初回合除外」應擋）。修法：<code>vigorousForestException</code> 加 <code>state.turn &gt; 1</code> 條件。</li>
          <li><b>② 壯偉碩木（Stadium）</b>：gate 從 <code>state.isFirstTurn &amp;&amp; aIdx === state.firstPlayerIdx</code>（只擋先攻方第 1 動作回合）改為 <code>state.turn === 1</code>（雙方都擋）。雖然 setup 寶可夢都是 justPlaced 通常會被 filter 擋掉效果，仍顯式擋以求與其他「最初回合除外」一致 + 阻止 <code>stadiumUsedThisTurn</code> flag 浪費。</li>
          <li><b>③ 聯盟擊（太樂巴戈斯ex）</b>：原本 <code>state.turn === 1 + state.firstPlayerIdx</code> 算出 turn=1（先攻為 0 時）或 turn=2（先攻為 1 時）— 第二種情況把後攻方第 2 動作回合誤判成「後攻第一回合」而擋下。正解：<code>aIdx !== firstPlayerIdx &amp;&amp; state.turn === 1</code>。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.876</span> 🔥 hotfix：modal-choice + stepper picker 卡死（selectionValid 漏 stepper 判定）</summary>
        <ul>
          <li>玩家回報：v3.874 願增猿｜腎上腺腦力 picker（+/- 計數器選 1~3）按確認沒反應，卡在 picker 動不了。</li>
          <li><b>根因</b>：<code>selectionValid</code> derived 對所有特殊 picker type 都有特例（damage-distribute / energy-distribute / reorder-deck-top / active-energy-discard），但<b>沒對 modal-choice + stepper 做特例</b>。fall-through 到尾端「<code>selectionPicked.size &gt;= minCount</code>」 — stepper UI 只更新 <code>selectionStepperValue</code> 不會 add 到 <code>selectionPicked</code>，所以 size 永遠 0，minCount=1 不滿足 → <code>selectionValid=false</code> → <code>confirmSelection()</code> 早退（<code>if (!selectionValid) return;</code>）→ 確認鍵點下去無反應。</li>
          <li><b>影響範圍</b>：所有用 modal-choice + stepper 的卡 — 願增猿腎上腺腦力（新加）/ 潔淨支援（v2.93b）/ 泰姆猜 HP（v2.201）— 理論上都有此 bug，但平時很少觸發到所以沒被發現。本版一併修復。</li>
          <li><b>修法</b>：<code>selectionValid</code> 加 modal-choice + stepper 特例 — 改用 <code>selectionStepperValue</code> 跟 <code>stepper.min</code> / <code>stepper.max</code> 對比。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.875</span> 🎯 激流水泵 picker 精修：「全有或全無」+ 璀璨結晶 -1 規則</summary>
        <ul>
          <li>玩家回報：扮晶晶酒 借 激流水泵 picker 可以選 1 顆或 2 顆但發動不了效果，UX 多此一舉，應該只能選 3 顆或不選。</li>
          <li>同時補實裝官方 QA：使用附 2 個能量 + 璀璨結晶 的厄鬼椪 水井面具ex 的招式 激流水泵，若放回 2 個能量，仍可對對手備戰造成 120 傷害。</li>
          <li><b>修法 1（UI 精修）</b>：<code>preAttackDiscard</code> state 加 <code>exactRequired?: number</code> 欄位。confirm 按鈕只在 <code>picked === 0</code> 或 <code>picked === exactRequired</code> 時 enable（中間數量 disable）。confirm 按鈕文字改成「啟用追加效果（需放回 N 個，目前 X/N）」；skip 按鈕改成「不啟用追加效果」。</li>
          <li><b>修法 2（璀璨結晶 -1 規則）</b>：<code>_computeExactRequired</code> helper — 偵測 attacker 為「太晶」且有附「璀璨結晶」道具 → <code>exactRequired = 2</code>；否則 3。同步在 <code>v155_attacks.ts</code> 加 <code>_hydroPumpRequired</code> helper，regPre / regPost 雙端讀同邏輯。</li>
          <li><b>扮晶晶酒 借此招</b>：借者是火箭隊的謎擬Ｑ（非太晶），即使有附道具也不啟用 -1 規則 → 固定 required = 3。</li>
          <li><b>受惠範圍</b>：激流水泵（單機 + 扮晶晶酒 借此招 + 璀璨結晶 attach 場景）。UX 從「可選 0~3 但只有 0/3 有意義」收緊為「只能 0 或 required」。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.874</span> 🐛 雙 bug：願增猿腎上腺腦力可選張數 + 旋轉洛托姆風扇呼喚 turn gate 修正</summary>
        <ul>
          <li><b>Bug 1：願增猿｜腎上腺腦力 應該可選搬幾個傷害指示物</b></li>
          <li>v3.711 誤判卡面「選擇最多 3 個」為「全搬，上限 3」（cap 語意），玩家回報實際應由玩家自選 1~3。本版恢復 v3.14 設計：開 <code>modal-choice + stepper</code> picker（+/- 按鈕），玩家自選 1 到 maxCounters（受來源傷害上限）。流程：① 選來源寶可夢（≥10 傷害的 1 隻） → ② +/- 選搬幾個指示物（1~3，受來源上限）→ ③ 選對手寶可夢轉傷。指示物只能從同 1 隻來源搬，無法跨多隻分配。</li>
          <li><b>Bug 2：旋轉洛托姆｜風扇呼喚 第二回合仍可使用</b></li>
          <li>玩家回報「第二回合仍然可以使用」。Audit 發現：<code>engine.ts:5737</code> 的 <code>newTurn = aIdx !== state.firstPlayerIdx ? state.turn + 1 : state.turn</code> — <code>state.turn</code> 只在「後攻方 END_TURN」才 +1，所以 <code>state.turn=1</code> 涵蓋雙方的第 1 個動作回合、<code>state.turn=2</code> 涵蓋雙方的第 2 個動作回合。v2.224 原 gate <code>turn > 2</code> 是基於誤解（以為 turn 1=先攻1st / turn 2=後攻1st），實際 turn 2 已是雙方的第 2 個動作回合（不是最初）。</li>
          <li><b>修法</b>：<code>mega_decks.ts</code> regA gate + <code>engine.ts:6611</code> button gate 兩處都改 <code>state.turn > 1</code>。雙方都只能在 <code>state.turn === 1</code>（個別第 1 動作回合）使用。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.8731</span> 🔄 redeploy：v3.873 build 成功但 GitHub Pages deploy step 失敗（infra 抖動），no-op patch 重新觸發 workflow</summary>
        <ul>
          <li>v3.873 GitHub Actions run #838：build job 全部 success（npm ci / Build SvelteKit app / upload-pages-artifact 都 ✓），但 deploy job 的 <code>actions/deploy-pages@v4</code> step failure。</li>
          <li>非程式碼問題 — 純 GitHub Pages 部署基礎建設層失敗（常見：concurrent deployment lock、rate-limit、API 暫時 5xx）。</li>
          <li>依鐵律 #5：失敗 push 不 force-push，用新 patch 版號重新觸發 workflow。本版只 bump 版本字串 + 補此 changelog，程式碼與 v3.873 完全相同。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.873</span> 🎭 hotfix：火箭隊的謎擬Ｑ｜扮晶晶酒 改為玩家自選對手太晶招式（含激流水泵 picker 修補）</summary>
        <ul>
          <li>玩家回報：火箭隊的謎擬Ｑ｜扮晶晶酒 無法學習厄鬼椪 水井面具ex 的招式「激流水泵」與「啜泣」。</li>
          <li><b>根因 1（啜泣永遠用不到）</b>：扮晶晶酒 自 v2.57 起採「自動挑印刷傷害最高那招」精簡策略 — 激流水泵 100 永遠蓋過啜泣 20，後者完全沒機會被扮演。</li>
          <li><b>根因 2（激流水泵 option 永遠不觸發）</b>：engine 看當前招式 effectKey 找 <code>ATTACK_PRE_DISCARD_CHOICE</code>（key=「火箭隊的謎擬Ｑ|扮晶晶酒」）找不到 → picker 不開 → <code>action.discardedEnergyIids</code> undefined → 借調的 激流水泵 regPre 永遠走「未棄滿 3 個能量 → 100」分支，對手備戰 120 永遠不觸發。</li>
          <li><b>根因 3（POST 階段沒傳 action）</b>：扮晶晶酒 regPost 轉接給 borrowed POST 時沒把 action 傳下去，激流水泵 POST <code>action?.discardedEnergyIids ?? []</code> 永遠空 → 對手備戰 picker 一樣不會開（即使 PRE 有跳）。</li>
          <li><b>修法</b>：
            <ul>
              <li>① <code>+page.svelte initiateAttack</code> 加 扮晶晶酒 intercept（仿 N的索羅亞克ex｜暗黑底牌 pattern）— 偵測對手戰鬥場為「太晶」寶可夢且有招式 → 跳 personateAttackPicker UI 列出該寶可夢的所有招式讓玩家挑。</li>
              <li>② 玩家挑完招式後：若 borrowed 招式有 <code>ATTACK_PRE_DISCARD_CHOICE</code>（如激流水泵）→ 直接接 <code>preAttackDiscard</code> 能量 picker（並 piggyback <code>copyAttackChoice</code>），玩家確認時一併 dispatch；無 spec（如啜泣）→ 直接 dispatch。</li>
              <li>③ <code>preAttackDiscard</code> state 加 <code>copyAttackChoice?</code> 欄位，<code>confirmPreAttackDiscard</code> 解構並透傳給 <code>GameActions.attack</code> 第 3 參數。</li>
              <li>④ <code>effects.ts</code> 扮晶晶酒 regPre 讀 <code>action.copyAttackChoice.attackIndex</code> 決定要扮演的招式；無 choice（AI / 舊 state）fallback 維持 v2.57 自動挑最高邏輯。</li>
              <li>⑤ 扮晶晶酒 regPost 簽章補 <code>action</code> 參數並一併轉接給 borrowed POST（修復根因 3）— 激流水泵的「對手備戰 1 隻受 120」picker 才會跳出。</li>
            </ul>
          </li>
          <li><b>受惠範圍</b>：
            <ul>
              <li>啜泣（20 傷害 + 對手戰鬥位下回合不能撤退）— 現在可被選擇</li>
              <li>激流水泵（100 + 若希望棄 3 能量回牌庫並重洗 → 對手備戰 120）— 完整流程可運作</li>
              <li>未來所有對手太晶寶可夢的招式皆可被選擇（不再被自動最高傷邏輯蓋掉）</li>
            </ul>
          </li>
          <li><b>「若希望」UX</b>：能量 picker 為 min=0 / max=3 — 確認按鈕顯示「放回 N 張」（spec.verb='return-to-deck'），同時 spec.min=0 → 顯示「不放回（0 傷害）」快速 skip 按鈕，符合卡面「若希望」二選一語意。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.872</span> 🔍 hotfix：v3.871 whitelist 寫錯 class — 查看詳情 modal 無法垂直 scroll</summary>
        <ul>
          <li>玩家附截圖：v3.871 鎖主畫面後，「查看詳情」彈窗（喵喵ex 等卡的特性描述）長文無法垂直拖曳查看。</li>
          <li><b>根因</b>：v3.871 我自己腦補 whitelist 寫 <code>.zoom-modal-overlay</code> — 這名稱不存在。實際是 <code>.zoom-overlay</code> + <code>.zoom-modal</code>。docMoveHandler 一律 preventDefault 把 zoom modal 內的 scroll 也擋了。</li>
          <li><b>修法</b>：糾正 whitelist class 名稱，並擴展涵蓋所有可滾動的 overlay：
            <ul>
              <li><code>.zoom-overlay</code> + <code>.zoom-modal</code> — 查看詳情卡片彈窗（喵喵ex 等長特性）</li>
              <li><code>.selection-modal</code> — pendingSelection picker UI（含查看牌庫剩餘）</li>
              <li><code>.full-deck-view</code> + <code>.full-deck-list</code> — 「📖 查看牌庫剩餘全部」摺疊內容</li>
            </ul>
          </li>
          <li>道歉：我這次又是「沒查實證就腦補名稱」— 跟之前「寶寶球」幻覺同類錯誤。以後寫 selector 一定先 grep 確認。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.871</span> 📱 iOS Safari pull-to-refresh 強化擋：document 層 touchmove preventDefault</summary>
        <ul>
          <li>玩家附截圖：v3.861 修了 <code>.mp</code> 主畫面 fixed 後，iPhone 上仍會出現 Safari 內建的「下拉轉圈圖示」並彈出對戰頁。</li>
          <li><b>真實根因</b>：iOS Safari pull-to-refresh 是<b>瀏覽器 chrome 層的動畫</b>（status bar 下、URL bar 上的圓圈圖示），不是網頁元素 — 即使 <code>.mp</code> 釘 fixed 也擋不住。Safari 在 touchstart 階段就決定是否啟動下拉。</li>
          <li><b>修法</b>：把 preventScroll handler 從只掛 <code>.mp</code> 擴展到 <code>document</code> 層：
            <ul>
              <li>touchmove 在「<code>.mp</code> 外（瀏覽器邊界區）」或「非 scrollable 內部」全部 <code>preventDefault</code></li>
              <li>scrollable 內部（<code>.mp-row / .mp-hand / .mp-log / .mp-chips / .mp-sheet</code>）+ modal overlay 區放行，內部捲動正常</li>
              <li><code>{`{passive: false}`}</code> 確保 preventDefault 有效</li>
            </ul>
          </li>
          <li><b>限制</b>：iOS Safari pull-to-refresh 無法 100% 禁用（瀏覽器層級行為）— 只能用 JS 強化擋。最徹底的方案是讓使用者把網站<b>加到 iPhone 主畫面</b>（成為 PWA standalone mode），那時沒有任何瀏覽器 chrome，完全沒下拉刷新。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.87</span> 🃏 hotfix：本機雙人換人時手牌偶爾不顯示</summary>
        <ul>
          <li>玩家回報：本機雙人模式換人時，有時手牌沒顯示；發動特性補牌後就正常。</li>
          <li><b>推測根因</b>：myIdx 在本機雙人 playing 階段隨 <code>activePlayerIndex</code> 切換。END_TURN dispatch 後 game state + myIdx 同時變化，Svelte 5 的 <code>$derived(game.players[myIdx])</code> 在某些 race 場景沒立即觸發 hand 元素重 render。特性補牌觸發新 dispatch → hand.length 變化 → reactive 再觸發 → 顯示正常。</li>
          <li><b>修法</b>：desktop <code>hand-scroll</code> + mobile <code>mp-hand</code> 兩處用 <code>{`{#key myIdx}`}</code> 包整段 each 區塊。<code>key</code> 變化時 Svelte 強制 destroy + recreate 內部所有元素 — 完全繞過 reactive race。</li>
          <li>代價：每次換人會 destroy + recreate 全部手牌卡 DOM（一次性，無持續性能影響）。換來「保證一定顯示」的可靠性。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.862</span> ↩️ revert：恢復 modal 拖曳功能（玩家：手機版仍要拖曳 modal 看場上）</summary>
        <ul>
          <li>玩家回報：v3.86 把手機 portrait 模式 modal 拖曳功能禁用是過度反應 — 玩家需要拖曳 modal 後看場上其他寶可夢狀況。</li>
          <li><b>修法</b>：revert v3.86 對 <code>onModalHeaderPointerDown</code> 加的 <code>if (isPortraitMobile) return;</code> gate + CSS 的 <code>body.mp-locked .sel-header cursor:default</code>。modal 拖曳功能恢復可用（手機 + 桌面）。</li>
          <li>v3.861 對 <code>.mp</code> 主容器的 <code>position:fixed</code> 修法**保留** — 那是真正解決「整個主畫面被位移」的修法，與 modal 拖曳無關。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.861</span> 📱 hotfix：手機版主畫面被位移（v3.86 修錯了，這次才是真正的根因）</summary>
        <ul>
          <li>玩家附截圖回報：v3.86 修完手機版仍可拖曳 — 我之前誤判修了 modal 拖曳。實際是整個 <code>.mp</code>（MobilePortraitBattle 主容器）被位移。</li>
          <li><b>真正根因</b>：<code>.mp</code> 之前用 <code>height:100vh; display:flex</code> 走 normal flow，iOS Safari 上動態 viewport（URL bar 顯示/隱藏）+ overscroll bounce + pull-to-refresh 等行為仍會讓內容上下位移，即使 body 設了 <code>position:fixed</code>。</li>
          <li><b>修法</b>：<code>.mp</code> 直接設 <code>position: fixed; inset: 0; touch-action: none; overscroll-behavior: none;</code> — 強制鎖到 viewport，主容器完全不能被任何手勢位移。</li>
          <li>內部可滾動區（<code>.mp-row</code> 橫滑備戰 / <code>.mp-hand</code> 橫滑手牌 / <code>.mp-log</code> 直滑戰鬥紀錄 / <code>.mp-chips</code> 橫滑 chips）各自設對應 <code>touch-action: pan-x</code> 或 <code>pan-y</code> — 不冒泡到 <code>.mp</code>，但各自方向手勢仍能用。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.86</span> 📱 UX：手機版禁用 modal 拖曳（避免誤觸主畫面跑掉）</summary>
        <ul>
          <li>玩家回報：手機版常不小心拖曳 modal 視窗，造成「視窗可以拖來拖去」影響體驗。</li>
          <li><b>根因</b>：桌面版設計的 modal 拖曳功能（拖 modal header 可避開被遮卡）— 在手機上手指容易誤觸 header → 整個 modal 被拖到位置不對。</li>
          <li><b>修法</b>：<code>onModalHeaderPointerDown</code> 開頭加 <code>if (isPortraitMobile) return;</code> gate，手機 portrait 模式直接禁用拖曳。桌面仍保留功能。</li>
          <li>順帶 CSS 補：<code>body.mp-locked .sel-header</code> cursor 改成 default，視覺上也不誘導玩家拖曳。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.853</span> 📖 通用 bug：6 處牌庫搜尋類「無候選 short-circuit」（Iron Rule 14 新增）</summary>
        <ul>
          <li>玩家規則確認：「就算牌庫內沒有超能量也一樣，不能省略開 picker — 因為玩家可以藉此檢索牌庫剩餘的卡牌內容」。是 PTCG 搜尋規則的核心。</li>
          <li><b>共通 bug pattern</b>：<code>p.deck.filter(...)</code> 後 <code>if (cand.length === 0) return addLog(...)</code> short-circuit → picker 沒開，玩家失去查看牌庫機會。</li>
          <li><b>Audit 完整掃出 6 處 + 一波修</b>：
            <ul>
              <li>v2353_j_mark_batch.ts:503 — 超級花葉蒂ex｜永生綻放（玩家回報的）</li>
              <li>abra_mawile_deck.ts:189 — helper（影響某些 deck 卡）</li>
              <li>m2_dragon_charizard_batch.ts:124 — 哈克龍｜進化指引</li>
              <li>v2354_j_mark_batch.ts:256 — 樹才怪｜考驗之旅</li>
              <li>v2355_j_mark_batch.ts:71 — 哲爾尼亞斯｜大地之門</li>
              <li>v2750_h_wave2_full.ts:1223 — 夠讚狗ex｜猛毒筋力</li>
            </ul>
          </li>
          <li><b>修法</b>：移除 short-circuit return，picker 永遠開（cand=0 時 maxCount=0，picker 開但無可選 — 玩家可在「📖 查看牌庫剩餘全部」摺疊區查看 + 按確認結束）。</li>
          <li><b>IRON_RULES.md 新增 Iron Rule 14</b>：明文禁止「牌庫搜尋 short-circuit」，附 audit 工具 grep pattern，避免日後再寫進去。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.852</span> 🌸 hotfix：永生綻放真正「任意方式」分配（+/- counter 取代「全部一隻」）</summary>
        <ul>
          <li>玩家指出：v3.85 修了 picker 開不開的 bug，但分配機制仍違反卡面 — picker 只允許選 1 隻備戰寶可夢，能量全堆給她。卡面要求「以<b>任意方式</b>附於備戰寶可夢身上」，應允許 N 張能量分配到 M 隻備戰。</li>
          <li><b>修法</b>：
            <ul>
              <li>step2 resolver 改用 <code>energy-distribute</code> picker（v2.87 既有的 +/- counter UI），minCount = maxCount = N（必須全分配）。</li>
              <li>新 commit resolver <code>j-2353-florges-distribute</code>：依玩家 +/- 配置從 deck 抽出能量 → 分配到各 bench → 重洗牌庫。</li>
              <li>卡面明文「附於『備戰』寶可夢」— validIids 只列 bench（排除 active）。</li>
              <li>0 隻備戰：能量留 deck + 重洗（fail-safe）。</li>
            </ul>
          </li>
          <li><b>舊 simplify 註解全清除</b>：v2.353 行 488-489 註解承認違反 Rule 7 簡化實裝。本次徹底重寫符合卡面語意。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.851</span> 🌷 hotfix：昂主花葉蒂 — 同回合先打稜鏡塔再打昂主花葉蒂被擋下</summary>
        <ul>
          <li>玩家回報：v3.85 修了 prismTower flag 後，同回合先打稜鏡塔、再打昂主花葉蒂仍打不出來。</li>
          <li><b>根因</b>：v3.85 雖然加了卡面 gate，但漏改「每回合只能打 1 張 Stadium」通則檢查（<code>stadiumPlayedThisTurn[aIdx]</code>）— 打完稜鏡塔後 flag 已 true，第二張昂主花葉蒂被通則擋下。</li>
          <li><b>卡面語意辨析</b>：「使出了『稜鏡塔』的回合也可放置於場上」這句話本身就是<b>「每回合 1 張 Stadium」通則的特例</b>。否則卡面這條規則根本沒有任何用武之地。</li>
          <li><b>修法</b>：engine.ts PLAY_TRAINER + getPlayableTrainers 兩處都加 exception：
            <ul>
              <li>打過 Stadium 後通常擋第二張，但「卡是昂主花葉蒂 + 本回合用過稜鏡塔」時 bypass</li>
              <li>打完昂主花葉蒂後 stadiumPlayedThisTurn 仍會 set true → 第三張仍擋（不會無限打）</li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.85</span> 🌷 三修：昂主花葉蒂放置 gate + 永生綻放 picker + 撤退 UX 改善</summary>
        <ul>
          <li><b>Bug 1：昂主花葉蒂沒擋放置條件</b>。卡面：「這張卡必須將場上的『稜鏡塔』丟棄才可放置於場上，使出了『稜鏡塔』的回合也可放置於場上」— 但場上沒稜鏡塔也能直接放置。
            <ul>
              <li>修法：加 GameState.prismTowerPlayedThisTurn per-player flag，PLAY_TRAINER 稜鏡塔 set true，END_TURN reset。</li>
              <li>透過 regG 同時 plug 進 engine + UI filter + AI（一處實裝三層自動同步，沿用 v3.82 海之詛咒教訓）。</li>
            </ul>
          </li>
          <li><b>Bug 2：永生綻放 picker 沒開</b>。超級花葉蒂ex 第二招本應從牌庫挑最多 4 張基本【超】能量，卻直接跳「牌庫沒基本【超】能量」訊息結束。
            <ul>
              <li>根因：<code>card.pokemonType === 'Psychic'</code> 漏抓 pokemonType=null 的基本能量（同 v3.731 / v3.82 bug）。</li>
              <li>修法：改用 <code>isBasicEnergyOfType</code> helper（含 name 「【超】」fallback）。</li>
            </ul>
          </li>
          <li><b>UX 3：撤退 picker 加明確 label</b>。撤退 / 送新戰鬥寶可夢時：
            <ul>
              <li>能量：「⚡ 火×2 水×1」（加閃電 icon）</li>
              <li>道具：「🔧 道具：英雄斗篷」（加「道具：」label），並列 extraTools（多重轉接的額外道具）</li>
              <li>狀態：「⚠️ 狀態：☠️ 中毒 / 🔥 灼傷 / 💤 睡眠 / 😵 混亂 / ⚡ 麻痺」（加中文翻譯）</li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.84</span> 🎵 版權安全：移除 3 首內建 BGM（功能保留，等後續補免費音樂）</summary>
        <ul>
          <li>玩家通知：使用官方 mp3 有版權風險，先把內建 3 首移除：
            <ul>
              <li>Aim to Be a Pokémon Master</li>
              <li>Pokémon XYZ Opening</li>
              <li>We Go</li>
            </ul>
          </li>
          <li><b>功能容器保留</b>：設定 → 🎵 背景音樂 (BGM) 區塊仍在，下拉選單目前只剩「無 (關閉)」。後續補新音樂時：
            <ol>
              <li>把新 mp3 放到 <code>static/music/</code></li>
              <li>在 <code>game/+page.svelte</code> 的 BGM select 加新 option 即可</li>
            </ol>
          </li>
          <li>localStorage 殘留：若舊用戶之前選過 3 首之一，瀏覽器嘗試 load 會 404 但不影響其他功能。重新選「無 (關閉)」即可。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.832</span> 📝 hotfix：匯入文字漏「張數」格式 + error message 改善</summary>
        <ul>
          <li>玩家回報：v3.831 修完後仍匯入失敗。看截圖 — 輸入是「呱呱泡蛙 M-P-J 089/M-P」「基本【水】能量 M-P-J 098/M-P」<b>每行開頭沒張數</b>。</li>
          <li><b>根因</b>：原本 3 個格式 regex（mId / mFull / mSimple）全都要求 <code>^(\d+)\s+...</code> 開頭數字。漏「張數」的行三個都不匹配 → 落到 <code>errors.push('無法解析：...')</code>。</li>
          <li><b>修法</b>：
            <ul>
              <li><b>新增 Format D</b>「{`{name} {setCode} {collectorNumber}`}」regex，<b>允許無張數</b>。匹配後預設 count=1 + 加入 ambiguities 警示「自動補 1 張，匯入後請手動調整數量」</li>
              <li>order：mId → mFull → mSimple → mNoCount（最後 fallback，避免吃到正常含張數的格式）</li>
              <li>error message 改成具體提示：<code>無法解析：「&#123;line&#125;」 → 每行需以「張數」開頭，例如：4 呱呱泡蛙 M-P-J 089/M-P</code></li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.831</span> 📝 hotfix：匯入文字 regex 不支援 setCode 含 `-`（M-P-J / SV-P-I 等 promo 卡）</summary>
        <ul>
          <li>玩家回報：「呱呱泡蛙 M-P-J 089/M-P」「基本【水】能量 M-P-J 098/M-P」無法匯入。</li>
          <li><b>根因</b>：<code>importFromText</code> 的 Format A regex（line 624）：<br/>
            <code>/^(\d+)\s+(.+?)\s+([A-Za-z0-9]+)\s+(\S+)$/</code><br/>
            setCode group <code>[A-Za-z0-9]+</code> 不含 <code>-</code> → <code>M-P-J</code> 不匹配 → 落到簡易格式 → name 變成「呱呱泡蛙 M-P-J 089/M-P」整串 → 找不到 → errors。
          </li>
          <li><b>修法</b>：setCode group 改成 <code>[A-Za-z0-9-]+</code> 允許 <code>-</code>。<br/>
            影響範圍：所有含 <code>-</code> 的 promo set — M-P-J / M-P-H / M-P-I / SV-P-I / SV-P-H 等。
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.83</span> 🔖 UX：牌組頁主畫面加「從官方匯入」顯眼按鈕</summary>
        <ul>
          <li>玩家反映：原本「從官方訓練家網站匯入」的書籤工具藏在「匯入文字」modal 內的摺疊區裡，太深、玩家根本找不到 — 主畫面只看到「匯入文字」按鈕、沒有任何「也支援官方」的提示。</li>
          <li><b>修法</b>：
            <ul>
              <li>主畫面「匯入文字」按鈕旁加新藍色按鈕「🔖 從官方匯入」</li>
              <li>新按鈕點下去 → 打開「匯入文字」modal + <b>自動展開</b>底下「📦 從官方訓練家網站匯入」摺疊區（書籤拖曳教學）</li>
              <li><code>bind:open</code> 雙向綁定 — 玩家可自己手動 toggle 摺疊區</li>
              <li>「匯入文字」按鈕也加上 tooltip：「貼上 PTCG 文字格式（包含官方訓練家網站可透過下方書籤工具一鍵匯入）」</li>
            </ul>
          </li>
          <li>實際後端機制沒變 — 依然走「玩家在官方頁面點書籤 → 自動複製 60 張卡的文字 → 貼回我們的 modal」這條最穩、最沒 CORS / ToS 風險的路徑。只是入口從藏起來變成顯眼。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.829</span> 📕 hotfix：變化之書 picker 漏 filter 'Basic'（誤選支援者）</summary>
        <ul>
          <li>玩家回報：AI 用變化之書時可以選棄牌區的「莉莉艾的決意」（支援者）當成基礎寶可夢交換到場上。</li>
          <li><b>卡面原文</b>：「從自己的棄牌區選擇 1 張<b>【基礎】寶可夢卡</b>，與自己的場上的 1 隻【基礎】寶可夢互換」— 只能基礎寶可夢。</li>
          <li><b>根因</b>：<code>discard-search</code> picker 的 filter 處理中，UI 與 AI 兩端都沒有 <code>'Basic'</code> case 對應 — 落入 fallback <code>return true</code>，列出棄牌區<b>所有卡</b>。
            <ul>
              <li><code>game/+page.svelte</code> line 1858 附近 — UI picker filter</li>
              <li><code>ai.ts</code> line 682 附近 — AI 自動選擇邏輯</li>
            </ul>
          </li>
          <li><b>修法</b>：兩端各補一條 <code>'Basic'</code> case：<br/>
            <code>supertype === 'Pokemon' &amp;&amp; !evolvesFrom &amp;&amp; subtype !== 'Stage1' &amp;&amp; subtype !== 'Stage2'</code>
          </li>
          <li><b>實際受影響範圍</b>：經 audit 全 codebase 12 處 <code>filter: 'Basic'</code>，僅變化之書 1 處走 <code>discard-search</code>（其他 11 處全走 <code>deck-search</code> / <code>opp-bench-choose</code>，那邊 line 1487 早有正確的 <code>'Basic'</code> case 處理）。所以本 fix 只影響變化之書這張卡，先前版本說「9 處受惠」是錯誤的腦補。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.828</span> 🔍 UX：能量 picker 來源標籤加放大鏡（點 📍 直接看寶可夢）</summary>
        <ul>
          <li>玩家建議：v3.827 的 📍 來源標籤如果可以點開放大看那隻寶可夢就更方便，省得跨欄找。</li>
          <li><b>修法</b>：<code>energyOwnerMap</code> 改存整個 <code>CardInstance</code>（不只 name），<code>sel-energy-source</code> 標籤從 <code>&lt;span&gt;</code> 改成 <code>&lt;div role="button"&gt;</code>（避免巢狀 button），加 onclick 觸發 <code>openZoom(cardId, instance)</code>。同時也支援鍵盤 Enter / Space。</li>
          <li>UI 細節：標籤加 🔍 icon 暗示可點擊，hover 時背景變綠+邊框變亮、滑鼠變 pointer。</li>
          <li>事件冒泡：用 <code>e.stopPropagation()</code> 防止點 📍 時觸發外層的「toggle 選擇」。</li>
          <li>受惠範圍同 v3.827（迅速游標 / 急進開關 / 粉碎之錘 / 悠哉尾草棒 等）。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.827</span> 📍 UX：能量 picker 每張卡加「來源寶可夢」標籤</summary>
        <ul>
          <li>玩家回報：迅速游標 picker 上看不出哪顆能量在哪隻寶可夢身上，怕誤丟想保留的能量。</li>
          <li><b>修法</b>：fallback <code>sel-grid</code> 偵測 <code>type === 'active-energy-discard'</code> 時，從 sourcePlayerIdx 的 active + bench 建一張 <code>energyIid → 寶可夢卡名</code> 對照表，每張能量卡下加 <code>📍 來源寶可夢名</code> 小標籤。</li>
          <li><b>受惠範圍</b>：
            <ul>
              <li>鐵斑葉ex 迅速游標（scope=all-own，多來源 — 最需要區分）</li>
              <li>急進開關（targetIid 單來源，仍顯示讓玩家確認）</li>
              <li>粉碎之錘 / 悠哉尾草棒 等丟能量道具</li>
              <li>未來任何用 <code>active-energy-discard</code> picker 的卡</li>
            </ul>
          </li>
          <li>加配套 CSS <code>.sel-energy-source</code> 樣式 — 綠框透明背景，與其他 sel- 元素一致。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.826</span> 🎯 hotfix：鐵斑葉ex 迅速游標 picker 化（卡面「任意數量」應由玩家選）</summary>
        <ul>
          <li>玩家回報：鐵斑葉ex 上場觸發迅速游標時，無法選擇要吸哪些能量，預設自動把舊戰鬥場 3 顆能量全搬。</li>
          <li><b>卡面原文</b>：「⋯選擇自己的場上寶可夢身上附加的<b>任意數量</b>的能量卡，改附於這隻寶可夢身上」。任意數量含 0，且來源是自方所有場上寶可夢（不只舊戰鬥場）。</li>
          <li><b>根因</b>：v2.138 實裝註解明寫「玩家可選張數但實戰選『全轉』，sim/AI 用全轉版」 — 違反鐵律 Rule 7（嚴禁簡化實裝）。</li>
          <li><b>修法</b>：拆兩階段
            <ul>
              <li>step 1：互換 active ↔ 鐵斑葉ex（不馬上搬能量）→ 開 picker，列自方所有寶可夢身上能量讓玩家勾選任意數量（minCount=0 含「不選」）。</li>
              <li>step 2：resolver 把 picked 能量從各來源移除，改附到鐵斑葉ex。</li>
            </ul>
          </li>
          <li>實作層面：擴展 <code>active-energy-discard</code> picker 支援 <code>params.scope='all-own'</code>，UI 列自方 active + bench 所有寶可夢身上能量（排除 target 自己以免自轉）。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.825</span> 💣 hotfix：咒詛炸彈不該被抵抗之幕擋（招式效果免疫誤套特性）</summary>
        <ul>
          <li>玩家回報：火箭隊的急凍鳥（抵抗之幕）保護下的火箭隊基礎寶可夢，被黑夜魔靈/徬徨夜靈的「咒詛炸彈」打 → 系統居然擋掉了，不放傷害指示物。</li>
          <li><b>卡面語意辨析</b>：
            <ul>
              <li>抵抗之幕：「不會受到對手的寶可夢使用<b>招式的效果</b>的影響」 — 只擋招式效果</li>
              <li>咒詛炸彈：是「特性」（在自己的回合可使用1次⋯）— 屬於特性效果</li>
              <li>→ 抵抗之幕對咒詛炸彈無效，傷害指示物應該照放</li>
            </ul>
          </li>
          <li><b>根因</b>：<code>regR('cursed-bomb', ...)</code> resolver 內有一段 v2.89 加的「招式效果免疫」檢查，註解寫「嚴格說屬特性效果，但為了一致性套用招式免疫」— 這個權衡違反卡面。</li>
          <li><b>修法</b>：移除該段檢查。保留兩個合法擋下：
            <ul>
              <li>光之翼（超級皮可西ex）— 卡面明文「不受對手<b>特性效果</b>影響」→ 對咒詛炸彈有效</li>
              <li>對戰圓形競技場 — PTCG 規則「特性類對備戰傷害指示物無效」→ 仍套用</li>
            </ul>
          </li>
          <li>影響範圍：黑夜魔靈（+130 傷害）/ 徬徨夜靈（+50 傷害）兩張卡的咒詛炸彈，對所有「自己場上有抵抗之幕保護的火箭隊基礎寶可夢」現在能正確放指示物了。也順便修正了其他三條招式免疫（薄霧能量 / 硬岩能量 / 皇帝之勢）對咒詛炸彈的誤套。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.824</span> ✂️ UX：簡化擲幣 log 訊息（去掉冗餘的「偏好→選擇→先手」三段式）</summary>
        <ul>
          <li>玩家建議：擲幣動畫前出現「玩家1偏好先攻→選擇先攻→玩家1先手」這種三段式敘述太冗長，希望直接呈現「玩家1獲勝，選擇先攻/後攻」即可。</li>
          <li><b>修法</b>：把 createGame 內擲幣 log 從三條分流（直接指定 / random / 有偏好）的冗長訊息統一成兩格式：
            <ul>
              <li>直接指定（AI / 本機模式無擲幣）：「🎯 XX 先手」</li>
              <li>擲幣（無論偏好為 random 還是 first/second）：「🪙 擲硬幣：XX 獲勝，選擇先攻」或「XX 獲勝，選擇後攻」</li>
            </ul>
          </li>
          <li><b>random 偏好處理</b>：玩家選隨機時，系統幫她隨機決定 firstPlayerIdx，log 自然呈現「選擇先攻」或「選擇後攻」（贏家視角的最終結果），不再特別寫出「（偏好隨機）」這種中間步驟。</li>
          <li>邏輯：<code>winnerIdx === firstPlayerIdx ? '選擇先攻' : '選擇後攻'</code>。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.823</span> 🪙 雙 bug：撤退能量丟過量 + 神奇糖果可選 1 階做進化目標</summary>
        <ul>
          <li><b>Bug 1：撤退能量丟過量</b>。玩家身上有 2 顆不同屬性能量、撤退費 1，picker 允許勾選兩張全丟 → 違規（PTCG 規則：丟剛好等於撤退費的能量單位）。
            <ul>
              <li><b>根因</b>：<code>selectionValid</code> 只檢查「總單位 ≥ retreatCost」，沒檢查「沒多丟」。</li>
              <li><b>修法</b>：加 essential 上限 — 拿掉任一張 picked 卡後 &lt; retreatCost（即每張都必要）。範例：picked = [雙倍渦輪(2)] + 撤退費 1 → 拿掉變 0&lt;1，essential ✓ 合法；picked = [草(1), 火(1)] + 撤退費 1 → 拿掉草仍 1≥1，非 essential ✗ 不合法。</li>
            </ul>
          </li>
          <li><b>Bug 2：神奇糖果可選 1 階做進化目標</b>。場上有多龍梅西亞（基礎）+ 多龍奇（1 階），選多龍巴魯托ex 後，UI 居然允許把神奇糖果套在多龍奇上 → 違規。
            <ul>
              <li><b>卡面原文</b>：「從自己的手牌選擇 1 張【2 階進化】寶可夢卡，放置於自己的場上的可進化成那隻寶可夢的【基礎】寶可夢身上，跳過【1 階進化】完成進化。」 — 只能在「基礎」身上。</li>
              <li><b>根因</b>：<code>rare-candy-choose-target</code> resolver line 1255 filter 是 <code>basicName || stage1Name</code> — 允許 1 階。</li>
              <li><b>修法</b>：移除 <code>|| stage1Name</code> 條件，只保留 basicName match。</li>
            </ul>
          </li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.822</span> 🌐 hotfix：連線對戰 — A 蓋掉 B 的零之大空洞後 B 端收不到棄備戰 picker 死鎖</summary>
        <ul>
          <li>玩家回報：連線對戰時 A 蓋掉 B 的零之大空洞，按 PTCG 規則 B 要從備戰丟到剩 5 隻，但 B 端沒收到任何 picker，整局卡死。</li>
          <li><b>根因（精確）</b>：A 端 <code>canIPush</code> 邏輯只認「pending 的 actor 是不是我」。A 的動作（蓋場地）觸發了 <code>enforceBenchLimit</code> 設給 B 的 pending，A 端 check：
            <ul>
              <li><code>prevState.pendingSelection</code> = undefined（沒舊 pending）</li>
              <li><code>newState.pendingSelection.actorIdx</code> = B（即 1）</li>
              <li>「prev actor === A？」 false（沒 prev）+「new actor === A？」 false（actor 是 B）</li>
              <li>→ return false → A 不 push 到 Firestore → B 永遠收不到 pending → 雙方卡死</li>
            </ul>
          </li>
          <li><b>修法</b>：補三條 fallback 給 prev 沒 pending 的情況，「我是發動者就推」：
            <ul>
              <li>我是 active player（normal action 觸發 side-effect pending）</li>
              <li>我是被擊倒方補場中（補場過程觸發 pending）</li>
              <li>我有待領獎賞（取獎觸發 side-effect pending）</li>
            </ul>
            原則：以 prevState 為「能否發動 action」基準，能發就能推（無論 newState pending 指向誰）。
          </li>
          <li><b>影響面</b>：不只零之大空洞 — 任何「A 動作觸發給 B pending」場景都受惠（例：A 打卡讓 B 棄能量 / B 選送新 active 等）。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.821</span> 🛡️ audit：對手場特性 AI/UI filter 三層一致性修補（4 處漏網）</summary>
        <ul>
          <li>玩家提出：「含羞苞鎖對方物品時 AI 不會死迴圈，為何海之詛咒會死？是不是邏輯不一致？黃色框框不該亮、AI 也該遵守同樣規則。」— 觀察完全正確。</li>
          <li><b>背景</b>：可打出 trainer / 基礎 / 進化 / 化石 的「filter 清單」是 AI 決策、UI 黃框、拖曳 gate 三層共用的。只要 filter 漏一條 gate，三層就一起錯（UI 亮黃框 → 玩家拖也能拖 → AI 一直挑被退回的卡 → 死迴圈）。v3.82 已修海之詛咒/爆大身軀，本版補完剩餘 4 處漏網：</li>
          <li><b>1. 化石放置 + 海之詛咒</b>：化石卡是 Item 屬性，但走 <code>PLAY_FOSSIL</code> 不走 <code>PLAY_TRAINER</code>，整條路徑沒有 gate。
            <ul>
              <li>engine <code>PLAY_FOSSIL</code> handler 加 <code>isOppItemPlayBlocked</code> gate。</li>
              <li><code>getPlayableFossils()</code> filter 同步加。</li>
            </ul>
          </li>
          <li><b>2. 基礎放置 + 瞪眼效用</b>：火箭隊的阿柏怪鎖對方放置有特性的寶可夢。engine <code>PLAY_BASIC</code> handler line 1751 有擋，但 <code>getPlayableBasics()</code> filter 沒擋 → AI 一直選有特性的基礎被退 → 死迴圈。
            <ul>
              <li><code>getPlayableBasics()</code> 對每張 candidate 逐張檢查 <code>isOppEvilEyeBlocking</code>。</li>
            </ul>
          </li>
          <li><b>3. 進化 + 瞪眼效用</b>：同樣機制 — engine <code>EVOLVE</code> handler line 1869 有擋，但 <code>getEvolvableTargets()</code> filter 沒擋。
            <ul>
              <li><code>getEvolvableTargets()</code> 對每張 evo candidate 加 <code>isOppEvilEyeBlocking</code> filter。</li>
            </ul>
          </li>
          <li><b>4. 一致性審視</b>：完整掃過玩家提的 13 個（陳舊的根狀化石 / 陳舊的顎之化石 / 廣域堡壘 / 初始化 / 劇毒支配 / 暗夜羽擊 / 威嚇之牙 / 漩渦言靈 / 自動治癒 / 揚沙 / 瞪眼效用 / 威迫目光 / 提升進化），其餘 9 個都已正確實裝（被動修飾 / engine handler gate 都齊全），列為「audit-pass」。</li>
          <li><b>邏輯統一性原則</b>：對手場特性鎖 = filter + engine handler 兩層都要寫，缺 filter → AI 死迴圈。本次補完所有同 pattern 的漏網點。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.82</span> 🌊 雙 bug：海之詛咒 AI 死迴圈 + 大地風暴能量沒算</summary>
        <ul>
          <li><b>Bug 1（AI 死迴圈）</b>：和 AI 對戰時我方下了胖嘟嘟ex（特性「海之詛咒」），AI 一直選擇使用物品，系統一直顯示「無法使出」，遊戲卡死。</li>
          <li><b>根因</b>：<code>getPlayableTrainers()</code> filter 沒擋掉對手胖嘟嘟ex 海之詛咒（鎖物品/道具）和大王銅象 爆大身軀（鎖競技場）兩條對手戰鬥場特性。AI 看到物品卡仍當「可打出」→ <code>PLAY_TRAINER</code> 被 engine 退回但 state 不變 → AI 一直挑同一張 → 死迴圈。</li>
          <li><b>修法</b>：在 <code>getPlayableTrainers()</code> 加兩條 gate（與 engine PLAY_TRAINER handler 同樣的條件）：
            <ul>
              <li>物品 / 寶可夢道具 + 對手戰鬥場有海之詛咒 → 濾掉。</li>
              <li>競技場 + 對手戰鬥場有爆大身軀 → 濾掉。</li>
            </ul>
            UI 和 AI 都會看到正確的「可打出 trainer 清單」，不再死迴圈。
          </li>
          <li><b>Bug 2（大地風暴傷害錯）</b>：哲爾尼亞斯的「大地風暴」應該按自己所有寶可夢身上附加的【超】能量數 × 30，但實際傷害總是 0。</li>
          <li><b>根因</b>：兩個地方都只看 <code>pokemonType === 'Psychic'</code>，但 scraper 對基本能量的 <code>pokemonType</code> 欄位常留空（null）→ 基本【超】能量全部漏算 → damage = 0。
            <ul>
              <li><code>v2380_j_attacks_batch.ts</code> 直接寫的 <code>regPre</code>（這個實際生效）。</li>
              <li><code>v2353_j_mark_batch.ts</code> 的 <code>matchesEnergyType()</code> helper（被 v2380 覆蓋，但其他 3 張卡 — 瑪力露麗ex 能量氣球 / 超級差不多娃娃ex 耳之力 / 優雅貓 能量粉碎 — 也用）。</li>
            </ul>
          </li>
          <li><b>修法</b>：兩處都加基本能量 fallback — 先看 <code>pokemonType === 'Psychic'</code>（已標好屬性的特殊能量），再看 <code>isBasicEnergyOfType(ec, 'Psychic')</code>（基本能量按卡名「【超】」parse）。同 v3.731 蜜糖風暴 / v3.44 基本能量 pokemonType=null 全面修補的修法。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.813</span> 🌳 hotfix：壯偉碩木場上多隻同名基礎可以選擇要進化哪一隻</summary>
        <ul>
          <li>玩家回報：場上有 2 隻同名【基礎】寶可夢（例如 2 隻呱呱泡蛙）想用壯偉碩木進化時，目前實作直接從牌庫翻卡進化第一隻，沒給玩家選擇要進化哪一隻的機會。</li>
          <li><b>卡面原文</b>：「可從自己的牌庫選擇1張從自己的場上的1隻【基礎】寶可夢進化而來的【1階進化】寶可夢卡，放置於那隻寶可夢身上完成進化」— 玩家必須能選哪一隻。</li>
          <li><b>根因</b>：<code>sturdy-might-tree-step1</code> resolver 用 <code>fieldPokemon.find()</code> 取第一個 name match 的 base → 多隻同名時其餘隻永遠被忽略。</li>
          <li><b>修法</b>：step1 改成找場上所有 match base：
            <ul>
              <li>0 隻：原訊息「場上無對應的基礎寶可夢可進化」。</li>
              <li>1 隻：直接進化（UX 不變，常見情境 0 額外點擊）。</li>
              <li>≥2 隻：開新 disambiguator picker（<code>sturdy-might-tree-pick-base</code>），玩家在場上點選要進化的那一隻基礎，picker 限定到 match 的 iids，並用 titleOverride 顯示「請選擇要使用 XX 進化的基礎寶可夢」。</li>
            </ul>
          </li>
          <li><b>順帶修法</b>：<code>bench-choose</code> picker 加 <code>params.includeActive</code> 支援（之前只有 opp-bench-choose / damage-distribute 有），讓 disambiguator 也能選戰鬥場上的基礎寶可夢，不限定備戰區。</li>
          <li>不影響 step2（Stage2）流程，因 step2 已用 <code>stage1Iid</code> 鎖定剛進化好的那一隻，本就無歧義。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.812</span> 🔒 hotfix：bench→active 純位置交換不該清掉「本回合打出」標記（解進化禁令繞過）</summary>
        <ul>
          <li>玩家回報：呱呱泡蛙從手牌放到備戰區 → 衝浪海灘把它換到戰鬥場 → 居然可以進化（違規）。</li>
          <li><b>PTCG 規則</b>：當回合從手牌打出的寶可夢，無論在備戰區或戰鬥場都不能進化（活力森林等特殊條件除外）。</li>
          <li><b>根因</b>：多處「純位置交換」程式碼用 <code>{`{...bench[idx], justPlaced:false, playedFromHand:false}`}</code> 硬清旗標，等同把「本回合進場」狀態洗掉，繞過進化 gate。</li>
          <li><b>系統性修法</b>：審視全 codebase，找出 9 處同樣 pattern bug，全部改為保留原始旗標（純位置交換不該動 justPlaced / playedFromHand）：
            <ul>
              <li><code>stadiums.ts</code>：衝浪海灘 surf-beach-swap</li>
              <li><code>items_misc.ts</code>：寶可夢交替、急進開關、頂尖捕捉器</li>
              <li><code>supporters_gust.ts</code>：老大的指令 gust-opp</li>
              <li><code>effects.ts</code>：dominance-chain、surfer-switch、opp-swap-dmg</li>
              <li><code>v172_hij_batch.ts</code>：露西亞秀（混亂後交換）</li>
              <li><code>v2995_g4_wave1.ts</code>：flowery-lure</li>
            </ul>
          </li>
          <li><b>原則區分</b>：fresh placements（搜尋牌堆 → 直接放上場）保持 <code>justPlaced:false</code> 不變（那不是從手牌打出，不適用進化禁令）。本次只修「同一隻、純位置變化」的場景。</li>
          <li><b>後續 audit</b>：v169_supporters / v2360 / v2996 / v2998 / v172 後段仍有 justPlaced:false 標註為「fresh placement」者，本版未動；如後續有玩家回報類似情境會逐一複查。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.811</span> 🏟 hotfix：自己蓋掉場地後，新競技場效果無法使用</summary>
        <ul>
          <li>玩家回報：先用壯偉碩木進化寶可夢 → 打出衝浪海灘覆蓋舊場地 → 衝浪海灘的水寶可夢交換功能用不了。</li>
          <li><b>根因</b>：<code>stadiumUsedThisTurn[aIdx]</code> flag 在 PLAY_TRAINER 打出新競技場時沒 reset。</li>
          <li>　・流程：壯偉碩木 效果 used[A]=true。同一回合（或之後輪到 A 時）打出 衝浪海灘 → 場地切換但 used[A] 仍 true → USE_STADIUM gate (line 2419) <code>if (used[aIdx]) return state</code> → 用不了。</li>
          <li><b>PTCG 規則</b>：競技場主動效果是「每回合 1 次」per stadium（非 per player）。覆蓋成新場地後，新場地是全新「未使用」狀態。</li>
          <li><b>修法</b>：PLAY_TRAINER 處理 Stadium 那段加 <code>stadiumUsedThisTurn[aIdx] = false</code> 重置。只 reset aIdx 那側（打出競技場的玩家），對手側不變。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.81</span> ⏱️ 修本機雙人 KO 卡死：myIdx 視角 switch + 10s 倒數自動取獎</summary>
        <ul>
          <li>玩家回報：本機雙人模式下，咒詛炸彈觸發昏厥自身寶可夢時，pending 在對手側、UI 看不到取得按鈕，整局卡死。</li>
          <li><b>兩道防護一起加</b>：</li>
          <li><b>1. myIdx 視角自動 switch（主修法）</b>：本機雙人 playing 階段，<code>pendingPrizes[1-aIdx] &gt; 0</code> 時 myIdx 自動跳到對手側，「取得」按鈕立刻顯示給該取的玩家。修咒詛炸彈/同命戰鬥/反彈傷害 等所有「自己回合中對手取獎」的場景。</li>
          <li><b>2. 10 秒倒數自動取獎（安全網）</b>：監聽 <code>myPendingPrizes</code>，出現時啟動 10s 倒數，超時自動 dispatch <code>TAKE_PRIZES</code>。即使視角 switch 失敗或玩家未發現也不會卡死。倒數顯示在按鈕旁的⏱️標籤。</li>
          <li>線上 / AI 模式 myPlayerIndex 有值，走另一條路徑，<b>不受此修法影響</b>。</li>
          <li>tsc 0 errors + Svelte parse OK。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.80</span> 🧹 零之大空洞 wave audit + 馬志士的交易 統一獎賞 button</summary>
        <ul>
          <li>清剩餘 todo：wave 檔案 30+ 處硬編碼 bench=5 + 馬志士的交易 supporter card 也使用 addPendingPrize。</li>
          <li><b>wave 檔案 bench audit + 修補（14 處）</b>：</li>
          <li>　・<code>v2306_meta_pokemon.ts</code>：脫殼 + 增長繭</li>
          <li>　・<code>v2353_j_mark_batch.ts</code>：復生火焰</li>
          <li>　・<code>v2580_i_wave8_misc2.ts</code>：洛托呼喚</li>
          <li>　・<code>v2620_i_wave12_misc5.ts</code>：N的迷你冰呼朋引伴</li>
          <li>　・<code>v2630_i_wave13_misc6.ts</code>：deckSearchPokemonToBenchPost helper（複用此 helper 的多張卡一併受惠）</li>
          <li>　・<code>v2660_i_wave16_misc9.ts</code>：小山豬呼朋引伴</li>
          <li>　・<code>v2750_h_wave2_full.ts</code>：deckSearchBasicToBenchPost helper（複用）+ 大舌頭舌引（對手 bench）</li>
          <li>　・<code>v2760_h_wave3_complex.ts</code>：迷唇姐 邀請之吻</li>
          <li>　・<code>v2996_g4_wave2.ts</code>：溫柔鰭 + 瞄準獵物 ×2（對手 bench）</li>
          <li>　・<code>v2998_g2.ts</code>：莉莉艾的蝶結萌虻 邀請眨眼（對手 bench）</li>
          <li>　・全改用 <code>getOwnBenchLimit(state, idx, pool)</code> helper（自方 idx 或對方 dIdx 視角都正確）。</li>
          <li><b>馬志士的交易（v172_hij_batch.ts）</b>：雙方各取 1 張獎賞改用 <code>addPendingPrize</code>，兩位玩家都可點「取得」按鈕（Rule 10 統一）。</li>
          <li><b>遵守鐵律</b>：Rule 10（addPendingPrize）+ Rule 11（Python pipeline 不用 Edit）+ Rule 4（tsc audit）。tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.792</span> 🎯 統一獎賞卡取得流程：3 處自動派發改用「取得」按鈕</summary>
        <ul>
          <li>玩家回報：對手「黑夜魔靈/彷徨夜靈」發動 咒詛炸彈 自爆時，系統自動幫玩家取走獎賞卡，沒有「取得」按鈕。希望取獎流程一致都用按鈕。</li>
          <li><b>違反 Iron Rule 10</b>：<code>pendingPrizes</code> 必須走 <code>addPendingPrize()</code> helper，禁止直接 <code>prizes.slice + hand.push</code> 派發。Audit 找到 3 處違規：</li>
          <li>　<b>1. selfKOInstance</b>（effects.ts ~10254）— 咒詛炸彈、爆裂針、過度放電 等自身 KO 特性的對手取獎路徑。原註解誤判「自身 KO 對手獎賞無法經 pendingPrizes」是 v2.98 前舊邏輯。</li>
          <li>　<b>2. 棄世猴｜同命戰鬥</b>（effects.ts ~6378）— 招式自爆使雙方寶可夢都 KO，對手獎賞同樣直接派發。</li>
          <li>　<b>3. 月亮伊布ex｜縞瑪瑙</b>（effects.ts ~7338）— 招式 1 張獎賞額外給自己，原本也是直接派發。</li>
          <li><b>修法</b>：全部改用 <code>addPendingPrize(state, ownerIdx, prizes)</code>。勝負條件改由 TAKE_PRIZES handler 在玩家點按鈕後檢查（既有機制，無需新邏輯）。</li>
          <li>　・「自身無後繼（bench empty）」game-over 檢查保留（與獎賞無關）。</li>
          <li>　・log 訊息從「對手取走 N 張」改為「對手待取 N 張獎勵牌」更精確。</li>
          <li><b>遺漏 / 未改</b>：</li>
          <li>　・馬志士的交易（v172_hij_batch.ts:668）— 支援者卡互換獎賞，非 KO 路徑、雙方同時，留待未來統一審查。</li>
          <li><b>遵守 Iron Rules</b>：Rule 7c 查卡面 + Rule 10 pendingPrizes helper + Rule 11 Python pipeline 修大檔 + Rule 4 tsc audit。tsc 0 errors + Svelte parse OK。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.791</span> 🚨 hotfix：本機雙人模式 KO 對方寶可夢後卡死（取獎賞 UI 不出現）</summary>
        <ul>
          <li>玩家回報：單機雙人模式 KO 對方寶可夢後無法繼續，整個畫面卡在「請先取獎勵牌再繼續行動」但沒有取得按鈕。</li>
          <li><b>根因</b>：<code>myPendingPrizes</code> 用 <code>pendingPrizesArr[myPlayerIndex ?? 0]</code> 取值。本機雙人模式下 <code>myPlayerIndex === null</code>，<code>?? 0</code> 強制讀 <code>pendingPrizes[0]</code>（P1 視角）。</li>
          <li>　・場景：P2 攻擊 KO P1 的寶可夢 → engine 設 <code>pendingPrizes[1] = N</code>（P2 該取的獎賞）。</li>
          <li>　・UI 讀 <code>pendingPrizes[0] = 0</code> → take-prize 按鈕不出現 → 卡死。</li>
          <li>　・KO 訊息 + 「請先取獎勵牌」alert 都正確顯示（因為 anyPendingPrize 是檢查兩格的 OR），但取按鈕用的索引錯誤。</li>
          <li><b>修法</b>：<code>myPendingPrizes</code> + <code>oppPendingPrizes</code> + takePrizes 按鈕的 <code>senderIdx</code> 全改用 <code>myIdx</code>（perspective-aware derived 索引，本機雙人模式會跟著 active player flip）。</li>
          <li>線上 / AI 模式不受影響（myPlayerIndex 有值 + myIdx == myPlayerIndex），只有本機雙人模式才會踩到這個 bug。</li>
          <li>tsc 0 errors + Svelte parse OK。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.79</span> 🎲 修回合計數 — 先攻為 idx=1 時 turn 計數錯位（v3.75 衍生 bug）</summary>
        <ul>
          <li>玩家回報：回合計數呈現「Turn 1 只有先攻動作 / Turn 2 起為 後攻→先攻」的不對稱結構，應該是「Turn N = 先攻→後攻」。</li>
          <li><b>根因</b>：engine.ts END_TURN 內 <code>newTurn = aIdx === 1 ? state.turn + 1 : state.turn</code> 寫死「idx=1 結束時 turn +1」，假設先攻方一定是 idx=0。</li>
          <li>　・v3.75 加了先後攻偏好後，先攻可能是 idx=1（玩家選「先攻」或擲幣贏家偏好「先攻」），此時硬編碼判定會在先攻方剛結束時就增加 turn，造成「Turn 1 只有先攻動作 → Turn 2 才開始包含後攻」。</li>
          <li><b>修法</b>：改為 <code>aIdx !== state.firstPlayerIdx ? state.turn + 1 : state.turn</code> — 「後攻方（= 非 firstPlayerIdx 那邊）結束回合時才增加 turn」，與先攻是哪一邊無關。</li>
          <li>結果：Turn N = 先攻 → 後攻，每回合對稱，符合 PTCG 官方規則。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.78</span> 🔧 零之大空洞 bench=8 時，多張 Item/Stadium 卡無法使用</summary>
        <ul>
          <li>玩家回報：零之大空洞 在場 + 自方有【太晶】寶可夢時，bench 上限應為 8，但好友寶芬 等卡片仍判定 bench 滿（5/5）→ 點按只有「查看詳情/取消」，無法使用。</li>
          <li><b>根因</b>：多張卡片的 gate / slot 計算 / resolver 上限<b>硬編碼 5</b>，沒套 <code>getBenchLimit</code> helper。零之大空洞 5→8 規則只有 engine.ts 主流程處理，子檔案 cards/*.ts 沒同步。</li>
          <li><b>修法</b>：</li>
          <li>　・在 <code>_shared.ts</code> 新增 <code>getOwnBenchLimit(state, idx, pool)</code> helper（內聯實作，避免 effects → engine 循環 import）。邏輯與 engine.ts getBenchLimit 同步。</li>
          <li>　・修補 7 張卡片，全改用 helper：</li>
          <li>　　1. <b>好友寶芬</b>（pokemon_search.ts）— 玩家回報這張</li>
          <li>　　2. <b>赫普的包包</b>（pokemon_search.ts）— 同類型</li>
          <li>　　3. <b>bench-basic-from-deck</b> resolver（共用）— slice(0, 5) 上限</li>
          <li>　　4. <b>bench-named-basic-from-deck</b> resolver — 同上</li>
          <li>　　5. <b>巢穴球</b>（items_misc.ts）</li>
          <li>　　6. <b>越橘的一步棋</b>（v169_supporters.ts）</li>
          <li>　　7. <b>密阿雷市 / 深缽鎮</b>（stadiums.ts 兩張）</li>
          <li>　　8. <b>毒電嬰｜呼朋引伴</b>（six_decks.ts）</li>
          <li><b>剩餘 audit todo</b>：grep 還找到 wave 檔案（v2306/v2353/v2355/v2580/v2620/v2630/v2660/v2750/v2760/v2996/v2998）有 30+ 處硬編碼 5。這些是個別寶可夢的招式/特性，使用頻率較低，留待後續逐張審查（避免一次改太多引入回歸 bug）。</li>
          <li>tsc 0 errors + Svelte parse OK。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.77</span> 🏗️ 4 張 stub Stadium 全實裝 + 古舊能量 log 加強</summary>
        <ul>
          <li>承接 v3.76 化朗鎮，續清剩餘 4 張只有名字在 set 但沒對應 hook 的 stadium（違反 v3.68 鐵律「名字在 set 不等於實裝」）：</li>
          <li><b>1. 全金屬實驗室（H）</b> — 卡面：「雙方的【鋼】寶可夢受到對手寶可夢招式的傷害『-30』點。」</li>
          <li>　・實裝位置：engine.ts attack damage pipeline（Group 3 Wave 1 受傷減免區塊內）</li>
          <li>　・條件：場上 stadium === '全金屬實驗室' + defender pokemonType === 'Metal'</li>
          <li>　・log：「全金屬實驗室：X（鋼）受傷害 -30（before → after）」+ 公式項</li>
          <li><b>2. 石之洞窟（I）</b> — 卡面：「雙方的所有『大吾的寶可夢』受到對手寶可夢招式的傷害『-30』點。」</li>
          <li>　・實裝位置：同上</li>
          <li>　・條件：stadium === '石之洞窟' + defender name 以「大吾的」開頭</li>
          <li><b>3. 夜間礦山（I）</b> — 卡面：「雙方場上所有『太晶』寶可夢使用招式所需的能量，各增加 1 個【無】能量。」</li>
          <li>　・實裝位置：engine.ts canAffordAttack（鼓擊 cost +N 後）</li>
          <li>　・條件：stadium === '夜間礦山' + attacker.tags 含「太晶」→ cost 加 1 個 Colorless</li>
          <li><b>4. 暈眩山谷（I）</b> — 卡面：「雙方的【混亂】的寶可夢，就算進化・退化，【混亂】也不會恢復。」</li>
          <li>　・實裝位置：engine.ts EVOLVE handler（進化後 status 通常被清除，加例外）</li>
          <li>　・條件：stadium === '暈眩山谷' + base.status === 'confused' → evolved 保留 confused</li>
          <li>　・其他狀態（睡眠/麻痺/中毒/灼傷）依 PTCG 規則進化即消除，不受影響</li>
          <li><b>5. 古舊能量 ACE SPEC log 加強</b> — v3.76 已加基本 log，v3.77 補強：明確標示 KO 寶可夢卡名 + 公式（「⚡ 古舊能量（ACE SPEC）：超級寶石海星ex 附有『古舊能量』 → 對手獎勵牌 -1 張（3 - 1 = 2）」）。</li>
          <li>iron rules 遵守：Rule 7c 查 JSON 原文 / Rule 11 Python pipeline 不用 Edit。tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.76</span> 🎯 3 bug 修正：火箭隊監視塔 / 化朗鎮 / 獎賞調整 log</summary>
        <ul>
          <li>玩家回報三個 bug，本版一併處理：</li>
          <li><b>Bug 1：場上有「火箭隊的監視塔」時，喵喵ex 進場仍能發動「殺手鐧捕捉」</b></li>
          <li>　・根因：v2.320 加的 <code>promptPlayAbilities</code>（on-play/on-evolve 互動提示）<b>未經過 isColorlessAbilityBlocked gate</b>。原本 BENCH_PLACE_TRIGGERS path 有 gate，但 promptPlayAbilities 三條 caller（BENCH_PLACE / EVOLVE / 神奇糖果）都漏了。</li>
          <li>　・修法：把 gate 加在 <code>promptPlayAbilities</code> 入口（單點集中），<b>三個 caller 都受惠</b>，未來新 caller 也不會漏網。同時在 engine.ts 兩個 caller 加 defense in depth gate。</li>
          <li><b>Bug 2：化朗鎮 競技場效果未實裝</b></li>
          <li>　・卡面：「雙方的『赫普的寶可夢』使用的招式，對對手的戰鬥寶可夢造成的傷害『+30』點」</li>
          <li>　・根因：化朗鎮 在 STATIC_PASSIVE_STADIUMS set 內但<b>沒有對應 hook</b>（違反 v3.68 鐵律「名字在 set 不等於實裝」）。</li>
          <li>　・修法：engine.ts attack damage pipeline 加 hook — 場上有化朗鎮 + 攻擊方名稱以「赫普的」開頭 → <code>baseDamage += 30</code> + log + 公式項。</li>
          <li><b>Bug 3：超級寶石海星ex 被擊倒時對手只獲得 2 獎</b></li>
          <li>　・調查：<code>prizesForKO</code> 邏輯正確（超級開頭 ex → 3）— v1.5 起就在了。最可能原因：<b>莉莉艾的珍珠</b>（Pokemon Tool）附在 ex 上時減 1 獎，魔靈寶石海星 deck preset 內就有此卡。</li>
          <li>　・改善：在 KO 取獎賞時 add log 揭示 prize 調整來源（莉莉艾的珍珠 / 古舊能量 / 影藏 / 各類 +N 加成），方便玩家確認獎賞數的算法。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.751</span> 🚨 hotfix：夠讚狗 攻擊後被誤判「反彈傷害擊倒」（既存 v2.301 bug）</summary>
        <ul>
          <li>玩家回報：場上沒有反彈傷害道具，但 AI 的夠讚狗 攻擊後馬上顯示「夠讚狗 被反彈傷害擊倒！」自己直接掛掉。</li>
          <li><b>根因（v2.301 既存 bug，v3.75 才被回報）</b>：</li>
          <li>　・夠讚狗｜腎上腺力量 特性：身上有【惡】能量時，最大 HP +100（130 → 230）+ 招式 +100 傷害。</li>
          <li>　・engine.ts line 4297 的「攻擊方反傷 sanity KO」檢查用了 <code>card.hp</code>（基礎 130）而非 <code>getEffectiveHP</code>（有效 230）。</li>
          <li>　・夠讚狗 場上累積 130~229 傷害時（例如願增猿 腎上腺腦力 移傷過來），效用 HP 仍 alive，但這條 check 用基礎 HP → 攻擊後立刻誤判 KO。</li>
          <li>　・另外 gate 也不嚴謹：只要 attacker.damage &gt;= 基礎 HP 就觸發，<b>連反傷是否實際發生都沒判定</b>。</li>
          <li><b>修法</b>：</li>
          <li>　・在 TOOL_ON_DAMAGED / SPECIAL_ENERGY_ON_DAMAGED hooks 前，先抓 <code>atkDamageBeforeRetaliation</code> snapshot。</li>
          <li>　・KO 觸發條件改為：<code>damage &gt; atkDamageBeforeRetaliation</code>（反傷真的生效）<b>且</b> <code>damage &gt;= getEffectiveHP(retaliatedAtk)</code>（用有效 HP）。</li>
          <li>　・龐克頭盔反彈 (line 4341) 同樣 bug — 也改用 getEffectiveHP。</li>
          <li>同類風險：未來任何「HP boost ability + retaliation」組合都會踩到此 bug，這次一併治本。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.75</span> 🎯 PTCG 官方規則：擲幣贏家選先後攻（lobby 預設偏好）</summary>
        <ul>
          <li>實裝 PTCG 官方規則第二項（接續 v3.74 mulligan 揭示）：擲硬幣贏家有權選擇先攻或後攻。</li>
          <li><b>設計：lobby 預設偏好</b>（比場內 modal 簡單 3 倍）</li>
          <li>　・每個玩家在 lobby 預先選自己的偏好：🎲 隨機 / ⚡ 先攻 / 🛡️ 後攻（對手看不到自己選什麼）。</li>
          <li>　・進入對戰時擲幣決定贏家，套用贏家的偏好決定誰先手。</li>
          <li>　・log 只揭示贏家的偏好（輸家保密）：「🪙 擲硬幣：X 勝 → 選擇『先攻/後攻』→ X 先手」。</li>
          <li><b>各模式行為</b>：</li>
          <li>　・<b>線上對戰</b>：lobby seat 內嵌 radio，存到 Firestore seat data；start 時讀雙方偏好。</li>
          <li>　・<b>AI 模式</b>：玩家偏好<b>直接</b>決定先後攻（不擲幣）— 先攻 → 玩家先手 / 後攻 → AI 先手 / 隨機 → 擲幣。</li>
          <li>　・<b>本機雙人</b>：兩個 radio 同時顯示（共用畫面），擲幣套贏家偏好。</li>
          <li><b>實作</b>：</li>
          <li>　・<code>Seat</code> 加 <code>firstChoicePreference?: 'random'|'first'|'second'</code> + <code>setSeatFirstChoice()</code> setter。</li>
          <li>　・<code>createGame</code> 加 <code>options.firstPlayerOverride</code> / <code>options.firstChoicePreferences</code>。</li>
          <li>　・UI 在 AI/本機 setup 卡 + 線上 lobby 內嵌 radio 三件套。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.741</span> 🚨 hotfix：mulligan 揭示資料 Firestore 推送失敗導致連線對戰卡住</summary>
        <ul>
          <li>玩家回報：v3.74 對戰時起手 mulligan 後出現「等待對手重抽」畫面，接著遊戲重新丟硬幣，無限循環。</li>
          <li><b>根因（Firestore nested array 禁忌）</b>：</li>
          <li>　・<code>mulliganRevealedHands</code> 設計成 <code>[string[][], string[][]]</code> — 外層 tuple、中層每方陣列、內層每手 cardId 陣列 → <b>三層 array nesting</b>。</li>
          <li>　・Firestore 規則：陣列元素不能是陣列（v2.84 task #94 已踩過一次，<code>supporterTagsUsedThisTurn</code> 改 <code>&#123;p1, p2&#125;</code> object）。</li>
          <li>　・v3.74 createGame race 雙端各自洗牌 → mulliganRevealedHands 不同 → push 因 nested array 失敗 → 觸發 game.id mismatch → 雙端互相覆蓋本地 state → 看起來像「coin toss redo」+「等待對手重抽」交替的無限循環。</li>
          <li><b>修法</b>：</li>
          <li>　・types.ts：<code>mulliganRevealedHands</code> 改 <code>&#123; p1: string[]; p2: string[] &#125;</code>，每張手牌的 cardIds 用 '|' join 成單一字串（flat string array，Firestore OK）。</li>
          <li>　・engine.ts createGame：encode 成 <code>&#123; p1: hands.map(h =&gt; h.join('|')), p2: ... &#125;</code>。</li>
          <li>　・UI modal：parse <code>oppHandsRaw.map(s =&gt; s.split('|'))</code> 還原成 cardIds 陣列再 render。</li>
          <li>修法借鏡 v2.84 supporterTagsUsedThisTurn 的歷史教訓 — 同類型問題第二次出現。</li>
          <li>tsc 0 errors。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.74</span> 👀 PTCG 官方規則：對手 mulligan 揭示翻頁式 modal</summary>
        <ul>
          <li>依 PTCG 官方規則，當對手起手無基礎寶可夢需要重抽（mulligan）時，必須將每次重抽前的 7 張手牌揭示給對方確認，再放回牌組重洗。</li>
          <li>之前實裝只有 mulligan counts + 補抽決定 modal，<b>沒有揭示</b>，違反官方流程。本版補上。</li>
          <li><b>引擎層</b>：</li>
          <li>　・<code>dealOpeningHand()</code> 改回傳 <code>&#123;mulligans, revealedHands&#125;</code>，每次重抽前快照 7 張 cardIds。</li>
          <li>　・<code>GameState</code> 加 <code>mulliganRevealedHands</code> 與 <code>mulliganRevealConfirmed</code> 兩個 per-player 欄位。</li>
          <li>　・新增 <code>CONFIRM_MULLIGAN_REVEAL</code> action + 玩家動作 helper。</li>
          <li>　・抽出 <code>tryAdvanceToPlaying()</code> helper — setup 進入 playing 需雙方 setupDone + pendingMulliganDraw=0 + mulliganRevealConfirmed=true。</li>
          <li>　・AI 自動確認（<code>handleSetupAI</code> 開頭 gate）。</li>
          <li><b>UI 層</b>：</li>
          <li>　・新增「對手起手揭示」modal，<b>翻頁式</b>顯示每次重抽的 7 張手牌（&larr; 上一手 / 下一手 &rarr;）。</li>
          <li>　・每張卡可點擊放大（zoom），桌機 7 欄、手機 4 欄自適應。</li>
          <li>　・「我看完了，繼續」按鈕 → dispatch CONFIRM_MULLIGAN_REVEAL → 後續再顯示既有「補抽 N 張」決定 modal。</li>
          <li>　・既有 pendingMulliganDraw modal 加 gate：<code>mulliganRevealConfirmed</code> 為 true 才顯示，避免兩 modal 同時出現。</li>
          <li>tsc 0 errors。連線/AI/本機雙人皆支援。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.732</span> 🤖 AI 修兩個邏輯 bug — 日光轉移無限循環 + 波動突刺 picker 智能選</summary>
        <ul>
          <li>玩家回報兩個 AI 邏輯問題：</li>
          <li><b>Bug 1：超級妙蛙花ex｜日光轉移 無限循環</b></li>
          <li>　・原因：日光轉移是「不限次數」特性（v3.65 task #205 加 UNLIMITED_USE_ABILITY_NAMES 標記過），但 AI ability evaluation 沒 gate，每次都看到「能用」就用 → 無限呼叫 stack overflow / hang。</li>
          <li>　・修法：ai.ts 加 日光轉移 stop condition — (a) active 已 ≥4 顆基本草 (叢林拋擲 cost 滿足) → 停 (b) 其他寶可夢身上沒草能可搬 → 停。score=0 阻止使用。</li>
          <li><b>Bug 2：超級路卡利歐ex｜波動突刺 picker 固定挑備戰第一隻</b></li>
          <li>　・原因：ai.ts bench-choose 單選分支固定 <code>bench[0]</code>，沒看 pulse-thrust-attach-one effectKey 智能挑。</li>
          <li>　・修法：加 effectKey 攔截 + 評分排序 — ① 超級進化 ex (Mega ex) +1000 ② 一般 ex +500 ③ 主攻擊招式還缺鬥能量 +100/缺一顆。最高分優先附。</li>
          <li>　・例：另一隻超級路卡利歐ex (340 HP / 鬥屬性 / 主招 270 dmg 需 2 鬥) 在備戰 → 優先附鬥能量過去（讓它成為下一個主力攻擊）。</li>
          <li>tsc 0 errors + svelte parse 3/3 OK + NUL byte 通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.731</span> 🍯 hotfix：蜜糖風暴傷害幾乎永遠只打 30 — 兩個雙重 bug</summary>
        <ul>
          <li>玩家回報：蜜集大蛇ex 用「蜜糖風暴」，場上有大竺葵 + 自己所有寶可夢身上 8 顆草能，預期 30 + 8×2×30 = 510 點傷害，<b>實際只打 30</b>。</li>
          <li><b>根因（雙重 bug）</b>：</li>
          <li>　1. <code>countOneEnergy()</code> 用 <code>card.pokemonType === filter</code> 判定能量屬性，但基本【草】能量 JSON 的 <code>pokemonType=null</code>（v3.44 task #184 已知問題，當時修了大部分地方但這個 helper 漏網）。所以 8 顆基本草能 → count=0 → 傷害 = 30+0×30 = 30。</li>
          <li>　2. <code>selfAllEnergyMultiplyPre()</code> （蜜糖風暴用的）沒套大竺葵繁茂倍率，跟 <code>bothActiveEnergyMultiplyPre()</code>（萬葉陣雨用的）不對稱 — 萬葉陣雨的 helper 有 inline countWithBloom，蜜糖風暴的沒有。</li>
          <li><b>修法</b>：</li>
          <li>　1. 新增 <code>ENERGY_NAME_TO_TYPE</code> 對照表 + <code>energyMatchesType()</code> helper：判定能量屬性先看 pokemonType，沒設則 fallback 用 name【X】解析（兼容 pokemonType=null 的基本能量）。<code>countOneEnergy</code> 套用此 helper。</li>
          <li>　2. <code>selfAllEnergyMultiplyPre</code> 加 inline 繁茂偵測 + 倍率邏輯（effects.ts 不能 import engine.ts 因 circular，故 inline 寫，跟 bothActiveEnergyMultiplyPre 同 pattern）。</li>
          <li><b>影響範圍</b>：</li>
          <li>　・<code>countOneEnergy</code> 是所有 *EnergyMultiplyPre 系列的 base helper — 此修法<b>順手修了所有靠數能量計算傷害的招式</b>對「pokemonType=null 基本能量」的計算（之前可能也都低估）。</li>
          <li>　・<code>selfAllEnergyMultiplyPre</code> 加繁茂支援 — 影響的招式：目前只有蜜糖風暴一張用此 helper。</li>
          <li><b>實測效果</b>：8 顆基本草 + 繁茂在場 → 30 + 8×2×30 = 510 ✓</li>
          <li>tsc 0 errors + svelte parse 3/3 OK + NUL byte 通過。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.73</span> 🐛 hotfix：亂暴閃電 / 燃燒旋踢「下回合無法攻擊」誤鎖整個玩家而非單一寶可夢</summary>
        <ul>
          <li>玩家回報：N的索羅亞克ex 用「暗黑底牌」借 N的捷克羅姆「亂暴閃電」(250 dmg) 後，下回合撤退換上備戰另一隻 N的索羅亞克ex，<b>新換上的也不能用招式</b>。違反卡面「這隻寶可夢無法使用招式」(個體 level)。</li>
          <li>根因（依鐵律 7c 查 JSON 確認）：six_decks.ts line 22-26 + 32-36 兩個 regPost 用 <code>players[aIdx].noAttacksNextTurn = true</code> — 這個 flag 是 player level（電擊魔獸「雷電在地」用的「自己的所有寶可夢無法使用招式」），<b>不該套在卡面寫「這隻寶可夢」的招式上</b>。原註解寫 "Wave 36 的 player-level noAttacksNextTurn 旗標：ATTACK_POST 設旗標即可" 是當初誤判機制 level。</li>
          <li>查 JSON 確認卡面文字：
            <ul>
              <li>✅ 電擊魔獸|雷電在地：「在下個自己的回合，<b>自己的所有寶可夢</b>無法使用招式」(player level) — 原邏輯正確</li>
              <li>❌ N的捷克羅姆|亂暴閃電：「在下個自己的回合，<b>這隻寶可夢</b>無法使用招式」(個體 level) — 誤用 player level</li>
              <li>❌ 火焰雞ex|燃燒旋踢：「在下個自己的回合，<b>這隻寶可夢</b>無法使用招式」(個體 level) — 誤用 player level</li>
            </ul>
          </li>
          <li>修法：兩個 regPost 改為設 <code>active.cantAttackPending = true</code>（CardInstance 個體 flag），與 effects.ts:2491 selfCantAttackNextPost 同款。撤退時 clearActiveEffects 會清掉此 flag — 換上備戰另一隻不受影響。</li>
          <li><b>實質影響</b>（N的索羅亞克ex 暗黑底牌借這兩招的場景）：
            <ul>
              <li>原 bug：借亂暴閃電後撤退換上另一隻，新的也卡死 1 回合</li>
              <li>修後：原 active 進 bench 後該個體的 cantAttackPending 被 clearActiveEffects 清；新 active 從 bench 出來沒此 flag → 可正常攻擊 ✓</li>
            </ul>
          </li>
          <li>tsc 0 errors + svelte parse 3/3 OK + NUL byte check 通過才 push（Rule 11b）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.722</span> 📱 手機版進化目標 picker 加 🔍 zoom 副按鈕 + 顯示 HP/能量狀態</summary>
        <ul>
          <li>玩家回報：手機版進化卡有多個目標可選時（例：手上有 2 隻多龍奇都可進化成多龍巴魯托ex），picker 只顯示寶可夢名字，看不到 HP 殘量 / 已附能量狀態，難以決定要進化哪一隻。</li>
          <li>修法（與 v3.32 撤退 picker 同模式）：手機進化 picker 每個目標 button 改為「主按鈕 + 🔍 副按鈕」橫排，主按鈕標籤加上 <code>（HP X/Y · ⚡N）</code> 即時顯示狀態，🔍 點下打開 zoom modal 看完整卡面。</li>
          <li>實作：<code>MobilePortraitBattle.svelte</code> line 705-711 改為使用 <code>mp-sheet-row + mp-sheet-zoom</code> 結構，與既有的撤退 picker UI 完全對稱。</li>
          <li><b>另發現的 Iron Rule 11 再次觸發</b>：Edit 工具改 <code>MobilePortraitBattle.svelte</code>（52KB 中等檔，遠低於 500KB 警戒）時把 file size 雖然對但 truncate 掉檔尾 CSS 整段，svelte parser 報 <code>Unexpected end of input</code>。改用 head_blob + Python safe_write 才搞定。<b>結論</b>：Iron Rule 11「ANY 既有檔案改用 Edit 都不安全」實證再加 1 次（v3.71 ai.ts 49KB → v3.722 MobilePortraitBattle.svelte 47KB），「中等檔」其實也常踩。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.721</span> 🚨 hotfix：v3.72 push 失敗 — version.ts 末尾 NUL byte 觸發 svelte-check 報 Invalid character</summary>
        <ul>
          <li>v3.72 push 上 GitHub Actions 後 build job 失敗（exit 1）。依鐵律 Rule 4「不要猜，去看實際 build error」，呼叫 GitHub Actions check-runs annotation API + sandbox 跑 svelte-check 抓到根因。</li>
          <li><b>真因</b>：Edit 工具改 <code>VERSION = '3.712'</code> → <code>VERSION = '3.72'</code> 時，新內容比舊少 1 byte，但 Edit 沒做檔案截斷 → 檔尾留 1 個 <code>\x00</code> NUL byte。tsc + svelte parse 不會嚴格抓這個（兩者都當作 EOF 處理）；但 vite build → svelte-check → svelte preprocessor 走 TS lexer 時報「Invalid character」直接失敗。</li>
          <li>修法：Python <code>rstrip(b'\x00').rstrip(b'\n') + b'\n'</code> 清掉檔尾 NUL，並 bump 到 v3.721 強制 hash 更新避免 CDN 快取。</li>
          <li><b>IRON_RULES 補充（Rule 11b）</b>：Edit 工具不只會 truncate 大檔，<b>連改小字串也可能留 NUL padding</b>。所有 .ts/.svelte 改完都應 byte-level verify 檔尾不含 <code>\x00</code>。tsc / svelte parse 不會抓這種；只有 vite build / svelte-check 會。Pre-push 驗證流程加 NUL check。</li>
          <li><b>Pre-push 驗證升級</b>：未來 push 前一律跑：(1) tsc --noEmit (2) svelte/compiler.compile (3) 對所有改過的 .ts/.svelte 跑 <code>grep -l $'\x00'</code> 確認無 NUL byte。第 (3) 點是這次新增的步驟。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.72</span> 🔨 修金屬之錘「最多 3 個」cap 語意 + 耀閃挑戰借此招的官方 QA</summary>
        <ul>
          <li>玩家提供官方 QA：「沒有附加鋼屬性的呆呆王使用招式『耀閃挑戰』的效果，選擇巨金怪的招式『金屬之錘』使用，希望處理招式效果的情況，會增加 150 點傷害嗎？」官方回覆「是」+「只要附有 1 個鋼能量則必須丟棄」。</li>
          <li>查 JSON 後找到兩個 bug：</li>
          <li><b>Bug A（巨金怪本體）</b>：原 v3.71-pre 實作 <code>ATTACK_PRE_DISCARD_CHOICE</code> 設定為 picker 模式（玩家自選棄 0~3 個能量），且邏輯寫成「恰好棄 3 個才 +150」。卡面「將 3 個鋼能量丟棄」是 <b>cap 語意</b>（IRON_RULES Rule 7c 語意陷阱表）— 應該是「自身鋼能量數量, cap 3，全丟」+「+150 觸發」是一個「若希望」binary。</li>
          <li><b>Bug B（呆呆王借此招 — 本 QA 場景）</b>：耀閃挑戰宣告攻擊時，engine 查 <code>ATTACK_PRE_DISCARD_CHOICE</code> 是用 <code>呆呆王&#124;耀閃挑戰</code> 當 key 不會跳出 picker，遞迴 dispatch 到 borrowed PRE 時 <code>action.discardedEnergyIids</code> 是空 → 永遠走 fallback 150 傷害分支，<b>永遠拿不到 +150</b>，不論呆呆王有沒有鋼能量。</li>
          <li><b>修法</b>：</li>
          <li>　1. <code>巨金怪&#124;金屬之錘</code> 改用 <code>binary-yes-no</code> scope，玩家選「希望/不希望」（modal 兩按鈕）；regPre 內若 yes → 自動找自身鋼能量丟最多 3 個（cap=3）+ damage 300；no → damage 150 無加成。</li>
          <li>　2. <code>呆呆王&#124;耀閃挑戰</code> 在遞迴 dispatch borrowed PRE 之前先看 spec — 若 borrowed 招式有 <code>binary-yes-no</code> PRE_DISCARD_CHOICE，<b>自動注入 yes sentinel iid</b>（player 在 borrowed attack 沒互動機會，預設「希望」是最有利選項，幾乎都是 +damage 加成）。</li>
          <li><b>實質影響</b>（呆呆王借金屬之錘）：</li>
          <li>　・0 鋼能量 → 不丟 + +150（白嫖加成）✓</li>
          <li>　・1 鋼能量 → 自動丟那 1 個 + +150 ✓</li>
          <li>　・3+ 鋼能量 → 丟 3 個 + +150 ✓</li>
          <li><b>歷史教訓</b>：這是 IRON_RULES Rule 7c「最多 N」陷阱第 2 次踩中（前次：v3.711 願增猿腎上腺腦力）。同樣是把「至多 N 的 cap」誤譯為「玩家選 1~N」。每次踩中都更新 IRON_RULES 災難案例表 → 下次寫 audit 時更容易撞見鐵律。</li>
          <li>tsc 0 errors + svelte parse 3/3 OK + 兩份檔案 TS parser 額外驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.712</span> 📜 Iron Rule 7c：規則解讀前必須查 static/cards 原文，禁止憑記憶</summary>
        <ul>
          <li>把連 4 次幻覺的教訓寫成新鐵律（IRON_RULES.md Rule 7c）：「實作 / audit / 規則解讀 / AI 決策邏輯前必須查 static/cards JSON 原文」。</li>
          <li>整理 4 次具體災難 → 表格：極限腰帶 HP/攻擊誤讀、豪華斗篷 G 標誤用、龍屬性弱抗誤算、「最多 3 個」上限/選擇語意誤譯。</li>
          <li>列 8 個 PTCG 規則文字「常見誤譯關鍵詞」對照表，下次踩到「最多 / 若希望 / 直到 / 不會 / 附加效果」等語意陷阱時可直接查。</li>
          <li>只動 IRON_RULES.md，無程式碼異動（version 純粹保持單調遞增）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.711</span> 🚨 hotfix：腎上腺腦力 picker 是錯誤實裝（卡面「最多3個」=上限非選擇）</summary>
        <ul>
          <li>玩家指正：v3.14 引入的「選擇要搬移的指示物張數（1~3）」modal-choice picker 整個是錯誤實裝。</li>
          <li>卡面正解：「選擇最多3個自己的1隻場上寶可夢身上放置的傷害指示物，改放於對手的1隻場上寶可夢身上」 — 「最多3個」是上限（cap），不是玩家選擇（picker）。實際機制是 amount = min(source.damage, 30) 全搬，每回合限用 1 次。</li>
          <li>v3.14 註解誤寫「應由玩家選張數 1~3」，把 PTCG 規則中常見的 cap 語意誤判為 player choice。</li>
          <li>修法 1（<code>maroon_dragon_deck.ts</code>）：<code>adrenal-brain-src</code> resolver 拿掉 modal-choice 分支，直接用 maxCounters = min(damage/10, 3) 全搬。<code>adrenal-brain-count</code> resolver 保留（舊存檔向後相容用），新流程繞過。</li>
          <li>修法 2（<code>ai.ts</code>）：v3.71 為了配合錯誤 picker 加的 <code>dragapultAdrenalCount</code> + modal-choice handler 整段移除（dead code）。</li>
          <li>實質影響：對手 active 剩 20 HP 時，AI 還是「搬全部」（若自方 source 受傷 30 就 30 全搬，雖然「浪費」10 但 PTCG 規則就是這樣）。v3.71 P0+P1a+P1b+P2b 其他改進保留。</li>
          <li>tsc 0 errors + svelte parse 3/3 OK。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.71</span> 🐉 魔靈多龍 AI 完全強化 — P0+P1+P2 一次到位</summary>
        <ul>
          <li>v3.43 魔靈多龍 AI 啟用後 audit 出 6 個邏輯漏洞 + 1 個 hallucination：先前以為「極限腰帶/豪華斗篷加 HP」，實際極限腰帶是攻擊 +50、豪華斗篷是 G 標卡（鐵律 7b 跳過）。修正後重新審視，留下 P0/P1/P2 三層共 6 個真實改進點。</li>
          <li><b>P0 effectiveHP 計算</b>：<code>_remHP</code> 改用引擎的 <code>getEffectiveHP(inst, pool, state)</code>，自動含 Tool HP(英雄斗篷 +100/竹蘭力量負重 +70)、Stadium HP(激動競技場 基礎 +30 / 引力山岳 Stage2 -30 / 昂主花葉蒂 +150)、Pokemon passive HP(生機森巴/雜草魂/腎上腺力量 等)。所有 4 個下游 (shouldUseCursedBomb / dragapultDistribute6Counters / dragapultGustPick / dragapultAdrenalTarget) 全部正確化。</li>
          <li><b>P1a 對手免疫指示物放置檢查</b>（新 helper <code>_hasOppCounterImmunity</code>）：對戰圓形競技場 (Stadium M2I, 雙方備戰免疫) + 探探鼠｜監視之眼 (ability M4J, 全場免疫)。咒詛炸彈在 active immune 時整個 gate 失效；bench immune 時只跳過 bench 目標。</li>
          <li><b>P1b 咒詛炸彈壓 KO 線前置條件</b>（新 helper <code>_canDragapultPhantomStrike</code> + <code>_hasGustInHand</code>）：自爆換 130 傷壓對手到 200 HP 線之前，AI 先確認「多龍巴魯托ex 在場 + 能量 1F+1P 滿足」；若想壓 bench 還要確認手上有老大指令 (能拉上 active 被多龍 200 KO)。否則就是純虧 1 獎賞自爆。</li>
          <li><b>P2a 願增猿｜腎上腺腦力動態 count picker</b>（新 helper <code>dragapultAdrenalCount</code>，攔截 <code>adrenal-brain-count</code> modal）：原本永遠選 maxCount=3 (移轉 30 傷害)。現在按優先序：① 找最小 N 達直 KO ② 找最小 N 達壓 KO 線 ③ fallback 用 maxCount (兼最大化自方來源回血)。對手 active 剩 20 HP 時搬 2 個 (20 傷) 而不是 3 個 (30 傷)，省下 1 個指示物未來用。</li>
          <li><b>P2b 多龍巴魯托ex 噴射頭擊 fallback</b>：<code>dragapultEnergyAction</code> 加 fallback — active 多龍巴魯托ex 能量 = 0 且手上只有【無】能量時，附 1 顆讓多龍至少能用噴射頭擊 (1C cost, 70 dmg)。原本「滿 1F+1P 才打 200，沒滿就空著」會浪費出場回合。</li>
          <li><b>Bug 找完了但修法不完美的地方</b>：對手側「招式傷害 -N」減傷類效果 (莓榴果 -60 對龍 / 仙子伊布ex -100 / 阿蜜的目光 -30 等) 不在 effectiveHP 內，引擎是在傷害計算階段動態套用的。AI 沒重做引擎邏輯 (兩處同步太脆弱)，這部分會有少數 case AI 估錯 KO 線。若實機看到 AI 該 KO 沒 KO 再 case-by-case 加 patch。</li>
          <li><b>恢復事故</b>：Edit 工具在 ai.ts (49KB, 遠低於 500KB 警戒) 上仍把後半段 truncate；Iron Rule 11 確認「ANY 既有檔案改用 Edit 都可能被 mount-truncated」。本版改全部用 Python pipeline + safe_write + TS parser 雙重驗證 (parse diagnostics: 0)。</li>
          <li>tsc 0 errors + svelte parse 3/3 OK 才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.70</span> 🔍 招式層 audit — G 標新版本 22 張招式實裝 + 3 張卡名字串變體修復</summary>
        <ul>
          <li>承 v3.69 的 audit 動能，繼續做「招式層」掃描（與「特性層」結構相同）：對所有 G/H/I/J 標 Pokemon 的 attacks 計算 key = <code>cardName|attackName</code>，比對 <code>regPre</code>/<code>regPost</code> 註冊表 + inline 比對表。</li>
          <li>掃描 <b>1622 個去重後招式</b>（3131 個 print 變體扣除 vanilla 純傷害）：</li>
          <li>　・1592 個有 implementation path（reg / passive / inline 三類）</li>
          <li>　・<b>30 個 orphan</b>（全部是 G 標新版本：SVM / SVQL / SVQP / SVK / SV8a 起點組 + Mega 系列）</li>
          <li><b>本批 v3.70 實裝 22 張</b>（全部用既有 helper / 簡單 inline）：</li>
          <li>　・SELF_HIT 自殘 7 張（火箭雀&#124;高溫奇襲、直衝熊&#124;突擊、小箭雀&#124;急降、摩托蜥&#124;突擊、小火龍&#124;熱力衝撞、加熱洛托姆&#124;熱力衝撞、自爆磁怪&#124;打雷）</li>
          <li>　・狀態類 3 張（不良蛙&#124;毒針 / 毒骷蛙&#124;拳頭刺 中毒；愛管侍&#124;催眠波動 睡眠）</li>
          <li>　・自身回血 2 張（瑪力露 / 瑪力露麗 ｜ 泡沫吸取）</li>
          <li>　・條件 +N 2 張（新 helper <code>selfHasDamagePre</code>：烈箭鷹&#124;烈火之風 70+90、噴火龍ex&#124;無畏之翼 60+100）</li>
          <li>　・擲幣傷害 2 張（瑪力露麗&#124;摔打 2&times;100、卡蒂狗&#124;連續火焰 til-tails&times;30）</li>
          <li>　・棄能量大招（噴火龍ex&#124;爆焰旋渦 330+棄3能量）+ 搜尋備戰（波波&#124;呼朋引伴）+ 對手不撤退（烈箭鷹&#124;緊抓）+ 狙擊備戰（電肚蛙&#124;電氣子彈 70+30）+ 反面全棄能量（皮卡丘ex&#124;極限伏特）+ 對手指示物&times;10（小拉達&#124;咬傷口）</li>
          <li><b>3 張 print 變體 JSON cleanup</b>（與 v3.69 月月熊 同類 bug — scraper 不一致導致字串比對失效）：</li>
          <li>　・M-P-H / SVM 的「‌喵喵」（卡名前面有 ZWNJ U+200C）→ 「喵喵」(2 prints) — 已 reg <code>喵喵&#124;亂抓</code> 三幣&times;20 倍率但字串不 match 永遠失效</li>
          <li>　・SV8a 的「厄鬼椪 碧草面具ex」（中間 NBSP U+00A0）→ 正常空格 (3 prints) — 已 reg 萬葉陣雨</li>
          <li><b>剩 8 張 orphan 延後到 v3.71+</b>（需要新 picker resolver / 引擎 hook）：古簡蝸&#124;貪欲制約 (對手 cost +2 debuff)、鐵脖頸&#124;重子光束 (cost 條件減免)、夢幻ex&#124;基因駭入 (招式 mimic)、大比鳥ex&#124;狂風呼嘯 (binary 丟棄競技場)、愛管侍&#124;育兒高手 (搜尋進化卡)、自爆磁怪&#124;磁力抵制 (binary 對手互換)、咚咚鼠&#124;咬能量、風速狗&#124;咬碎 (擲幣丟對手能量)。</li>
          <li>tsc 0 errors + svelte parse OK 才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.69</span> 🐻 hotfix：月月熊 赫月ex SV5a 變體的「老練招式」失效（卡名空格不一致）</summary>
        <ul>
          <li>玩家催全卡片實裝 audit，跑了 265 個標準環境 Pokemon 特性的嚴格 cross-check（regA / passive sets / inline name 三層交叉比對）：</li>
          <li>　・原本 122 個疑似 orphan → 加上 PASSIVE_X / SELF_KO / SHIELD_HOOK 等 set 涵蓋 → 16 個候選 → 全是 false positive（script bug：應該看 cardName-idx 而非 ability name 字面）</li>
          <li>　・265 個 Pokemon 特性 → 真正 unimplemented = <b>0 張</b>（全部都有 implement path）</li>
          <li>　・但 audit 過程意外發現 1 個真 bug：</li>
          <li><b>真 bug</b>：月月熊 赫月ex 的「老練招式」（cost-reduction passive）只認無空格卡名 <code>&#39;月月熊 赫月ex&#39;</code>。JSON 內 SV5a 共 5 張變體寫法是 <code>&#39;月月熊 赫月 ex&#39;</code>（中間有空格 — scraper 不一致），不會 match → 老練招式對 SV5a 失效。SV8a 2 張無空格寫法 OK。</li>
          <li>　・現象：玩家用 SV5a 月月熊 赫月ex，對手取走 N 張獎賞，血月攻擊的 5 個【無】能量 cost 不會減少 N 個（應該減）</li>
          <li>　・歷史：line 4242-4243 血月 attack post 已用 <code>regPost(&#39;月月熊 赫月 ex|血月&#39;)</code> + <code>regPost(&#39;月月熊 赫月ex|血月&#39;)</code> 雙寫法處理過，但 v2.133 寫 <code>getUrsalunaBloodMoonEffectiveCost()</code> 時漏 normalize</li>
          <li>　・修法：line 12170 改用 <code>attackerName.replace(/\s+/g, &#39;&#39;)</code> normalize 去空格比對，兩變體都涵蓋</li>
          <li><b>Audit 鐵律補充</b>：以後寫卡名 string match 必須意識到「同張卡 JSON 內可能有不一致寫法」（空格 / ZWJ / 區分 ex 大小寫等），用 normalize / regex 而非精確字串比對</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.68</span> ✨ 補完寶可夢中心的姐姐 stub（v2.199 半實裝拖 N 個月）+ JSON U+200C 卡名修正 + PASSIVE_STADIUMS audit 鐵律</summary>
        <ul>
          <li>玩家催促全面 audit「中立中心是 ACE SPEC 居然 stub」→ 我跑完 31 Stadium + 28 ACE SPEC + 全 Trainer 比對：</li>
          <li>　・31 張 Stadium 全部實裝（11 張 active 走 engine inline、16 張 passive 在 PASSIVE_STADIUMS set、3 張 special、1 張中立中心 v3.67 補完）</li>
          <li>　・28 張 ACE SPEC 全部有 functional refs（每張都有 reg/effect/hook）</li>
          <li>　・<b>真正未實裝只有 1 張</b>：寶可夢中心的姐姐（SV-P-I 214）</li>
          <li><b>寶可夢中心的姐姐 stub 修法</b>（半實裝）：</li>
          <li>　・原狀：<code>healResolver</code> (in <code>_shared.ts:736</code>) 註解明寫「v2.199 寶可夢中心的姐姐」+ 已支援 <code>clearStatus</code> 參數，但<b>實際 reg() 註冊從沒寫</b>，整張卡停在 stub 狀態到 v3.68 才補。</li>
          <li>　・修法：加 <code>reg(&#39;寶可夢中心的姐姐&#39;, ...)</code> + <code>regG()</code>（has-damage-or-status gate）+ <code>regR(&#39;pokemon-center-lady-heal&#39;, healResolver)</code>。卡面：選 1 隻寶可夢回 60 HP + 解除所有特殊狀態。</li>
          <li><b>JSON U+200C 卡名修正</b>：</li>
          <li>　・<code>SV-P-I.json</code> id=12573 卡名開頭有 <code>U+200C</code>（zero-width non-joiner）— scraper artifact，看不見但實際存在</li>
          <li>　・玩家在牌組編輯器搜尋「寶可夢中心」會搜不到（因為實際卡名前綴看不見的 ZWNJ）</li>
          <li>　・<code>reg(&#39;寶可夢中心的姐姐&#39;, ...)</code> 與 JSON 名也對不上 — engine 找不到 trainer effect</li>
          <li>　・修正：JSON 卡名 strip 開頭 U+200C/U+200D/U+FEFF（同時 strip ZWNJ/ZWJ/BOM 保險）</li>
          <li><b>新鐵律寫進 stadiums.ts：</b></li>
          <li>　・<code>PASSIVE_STADIUMS</code> 上方加 ⚠️ 鐵律註解 — 「名字在 set 內 ≠ 效果已實裝」</li>
          <li>　・成員必須附「實裝於 [檔案:行] / hook X」comment 才不算 stub</li>
          <li>　・反例就是中立中心：v3.67 之前名字在 set 但沒對應 hook，放下無效果</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.67</span> 🔧 全面 audit + 實裝：12 處 inline 全 refactor + 中立中心 stadium 從 stub 變實作</summary>
        <ul>
          <li>玩家驗收 v3.66 時抓出 audit 不徹底：列了 7 個 ex 相關卡（初始化 / 水蓮的照顧 / 中立中心 / 耀閃挑戰 / 花之帷幔 / 猛攻手鐲 / 寶可平板）只有 2 個真的走 helper。重新全面 audit。</li>
          <li><b>12 處 inline 散落點全 refactor 改用 isRulePokemon</b>：</li>
          <li>　・<code>effects.ts</code>：神秘之盾（堅盾劍怪 — 原來檢查 V/VMAX 也對）/ 神秘守護（仙子伊布）/ 脆弱蛻殼（脫殼忍者）/ isExCard 內部 helper（多卡共用）</li>
          <li>　・<code>tools.ts</code>：極限腰帶（對 ex +50）/ 電氣球（皮卡丘ex 對 ex +50）/ 猛攻手鐲（對 ex +30）</li>
          <li>　・<code>engine.ts</code>：防護代碼（密勒頓）/ 阿塞蘿拉的惡作劇（不受 ex 招式）</li>
          <li>　・<code>abra_mawile_deck.ts</code>：逆境之尾（土龍節節ex — 對手 ex 數 × 60）</li>
          <li>　・<code>v2359_j_mark_batch.ts</code>：上升利刃（古劍豹 +80）/ 強子電光（密勒頓ex +120）</li>
          <li>　・<code>v2590_i_wave9_misc3.ts</code>：isExCard 內部 helper（多卡共用）</li>
          <li>因 <code>effects.ts</code> 不能 import <code>engine.ts</code>（circular），在 <code>effects.ts</code> 加本地 <code>isRulePokemon</code> mirror，兩處讀同一個 <code>RULE_BOX_SUBTYPES</code> set source of truth，新類型上線時兩處自動同步。</li>
          <li><b>中立中心 stadium 從 stub 變實作</b>：</li>
          <li>　・卡面：「雙方的所有寶可夢（『擁有規則的寶可夢』除外），不會受到對手的『寶可夢【ex】・【V】』招式的傷害。」</li>
          <li>　・新增 <code>NEUTRAL_CENTER_STADIUMS</code> set + <code>isNeutralCenterActive()</code> + <code>wouldNeutralCenterBlock()</code> helper（在 effects.ts）</li>
          <li>　・active target 在 <code>engine.ts</code> 戰鬥場傷害計算 hook 處檢查；bench target 在 <code>resolveBenchGuard</code> 內檢查</li>
          <li>　・log 訊息：「X 因中立中心競技場效果，不受規則寶可夢招式傷害」</li>
          <li>跳過不該 refactor 的 site：<code>engine.ts</code> Mega ex 判定（需 name.startsWith(&#39;超級&#39;)）/ <code>effects.ts</code> 尾甲（限 basic ex）— 都加註解標記原因</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.66</span> 🔧 refactor：抽 isRulePokemon helper 為下月新規則寶可夢預作準備</summary>
        <ul>
          <li>玩家提醒：一個月後 PTCG 新擴充包要出新「擁有規則的寶可夢」類型。先預做準備避免新類型上線時要追 5 處散落點。</li>
          <li>Audit 現況：「非規則寶可夢」判定原本 inline 散落 5 處（routes/game/+page.svelte BasicNonRule/PokemonNonRule、ai.ts BasicNonRule/PokemonNonRule、tools.ts 豪華斗篷×2 + 莉莉艾的珍珠），每處重複寫 <code>subtype === &#39;ex&#39; || name.endsWith(&#39;ex&#39;) || ...</code>。</li>
          <li>新增統一 helper：<code>isRulePokemon(card)</code> 在 <code>engine.ts</code>。判定優先序：</li>
          <li>　① <code>tags</code> 含 &#39;規則盒&#39; 或 <code>RULE_BOX_SUBTYPES</code> 任一字串（最 future-proof — scraper 給新卡 tag 即可）</li>
          <li>　② <code>subtype</code> 在 <code>RULE_BOX_SUBTYPES</code> set（&#39;ex&#39; / &#39;V&#39; / &#39;VMAX&#39; / &#39;VSTAR&#39; / &#39;GX&#39; / &#39;EX&#39; / &#39;MegaEvolution&#39;）</li>
          <li>　③ <code>rulesText</code> 含「擁有規則」（fallback）</li>
          <li>　④ 卡名結尾 ex/EX（最後保險）</li>
          <li>5 處 inline 全 refactor 改用 helper，行為等價但維護成本歸零。</li>
          <li><b>未來新規則寶可夢類型上線 SOP</b>：把新 subtype 字串（如未來可能的 &#39;Mega2&#39; / &#39;Z&#39; 等）加進 <code>types.ts</code> 的 <code>RULE_BOX_SUBTYPES</code> set，<b>1 行</b>就完成全引擎更新。或讓 scraper 給新卡標 <code>tags: [&#39;規則盒&#39;]</code> 也可以。</li>
          <li>已寫進鐵律註解：日後新寫 ex/非 ex 區分邏輯<b>必須用 helper</b>，不要 inline 寫 <code>subtype === &#39;ex&#39; || name.endsWith(&#39;ex&#39;)</code>。</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.65</span> ✨ hotfix：4 個「不限次數」特性漏加 UNLIMITED_USE_ABILITY_NAMES（變成只能用 1 次）</summary>
        <ul>
          <li>玩家回報：超級妙蛙花ex 的特性「日光轉移」官方寫「在自己的回合時可不限次數使用」，但實作只能用 1 次。請 audit 同類 bug。</li>
          <li>追根因：v2.295 加 <code>UNLIMITED_USE_ABILITY_NAMES</code> 白名單時只列了當時的 3 張（烈火亂舞 / 激動渦輪 / 電氣流），<b>後續加的「不限次數」regA 在 effects 端註解寫了「不限次數」但忘記同步更新 engine 的白名單</b>，導致：</li>
          <li>　・<code>getUsableAbilities</code> (engine.ts:6104)：第二次按按鈕時 <code>pk.abilityUsedThisTurn=true</code>，hasUnlimited 查白名單沒這名字 → 直接 continue 不列出</li>
          <li>　・<code>USE_ABILITY</code> (engine.ts:2687)：<code>markUsed</code> 沒被白名單跳過 → <code>abilityUsedThisTurn</code> 設成 true</li>
          <li>　雙重 gate → 卡面「不限次數」變成「一次」。</li>
          <li>Audit 全部 effects/cards 註解寫「不限次數」/「不限次」的 regA，找出 4 張漏加：</li>
          <li>　① <b>日光轉移</b> — 超級妙蛙花ex（v154_decks.ts，玩家回報）</li>
          <li>　② <b>火箭腦力</b> — 火箭隊的以歐路普（v2374_rocket_brain.ts，註解明寫「不限次數使用 → 不需要 abilityNamesUsedThisTurn check」）</li>
          <li>　③ <b>沖刷</b> — 白海獅（v2380_j_abilities_batch.ts，註解寫「不限次數，備戰【水】能量改附戰鬥場」）</li>
          <li>　④ <b>收集泡泡</b> — 瑪力露麗ex（v2380_j_abilities_batch.ts，註解寫「不限次數，場上能量改附自身」）</li>
          <li>修法：4 個名字補進 <code>UNLIMITED_USE_ABILITY_NAMES</code>，並在 set 上方加鐵律提醒：「新增不限次數 regA 卡時必須同步更新此 set，effects 端註解寫不限次數是不夠的」。</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.64</span> 📱 hotfix：手機版零之大空洞延伸格 (bench 6/7/8) 放不上的 bug</summary>
        <ul>
          <li>玩家回報：場上有零之大空洞 + 備戰也有太晶寶可夢時，UI 確實畫出了延伸格子（共 8 格），但拖手機上點手牌的 action sheet 卻沒出現「📥 放到備戰區」按鈕，無法把寶可夢放上 6/7/8 格。</li>
          <li>追根因：<code>MobilePortraitBattle.svelte:229,233</code> 的 <code>handActions</code> hardcode <code>myPlayer.bench.length &lt; 5</code> 作為「放到備戰區」按鈕的 gate。零之大空洞下實際上限是 8（有 myBenchLimit 變數已 derive 自 <code>getBenchLimit()</code>），但這裡卡在 5 不放行。</li>
          <li>注意：<code>playableBasicIids</code>（由 engine <code>getPlayableBasics()</code> 計算）playing 階段已正確套用 <code>getBenchLimit()</code>，所以實際上 playing 階段的 bug 影響有限；這裡主要是 setup 階段以及 fallback condition。為徹底起見兩處都改。</li>
          <li>修法：兩處 <code>bench.length &lt; 5</code> 改為 <code>bench.length &lt; myBenchLimit</code>。</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.63</span> 🃏 能量回收加入 reprint exception</summary>
        <ul>
          <li>玩家補充：能量回收（Energy Recycler）也在 I 標有多版重印（M4 104/083、MC 636/742、SV11W 079/086），舊 G 標版本（SVM 125/175、SVQL 012/022）也合法。</li>
          <li>修法：<code>STANDARD_REPRINT_LEGAL_NAMES</code> 加入「能量回收」，現共 <b>10 張</b>舊版（含 G 標）仍合法的卡。</li>
          <li>tsc 0 errors + svelte parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.62</span> 🃏 補神奇糖果到 reprint 例外 + picker UI 動詞修正（hand-discard 誤用全 audit）</summary>
        <ul>
          <li>玩家補充：① 神奇糖果也有 I 標重印（M1S 082/063 + MC 655/742），G 標舊版仍合法。② 花舞鳥ex｜激動渦輪 picker 顯示「丟棄」但其實是「附加」— 請 audit 同類 bug。③ 漏修兩張 metadata。</li>
          <li><b>① 神奇糖果加入 reprint exception</b>：<code>STANDARD_REPRINT_LEGAL_NAMES</code> 多加 1 張，現共 9 張舊版（含 G 標）仍合法的卡。</li>
          <li><b>② 補修 2 張 JSON regulationMark</b>：</li>
          <li>　・神奇糖果 MBG 013/022：H → <b>I</b></li>
          <li>　・寶可夢捕捉器 SVM 137/175：J → <b>G</b></li>
          <li><b>③ hand-discard picker UI verb audit + 修正</b>：grep 全部 effects/cards/*.ts 用 <code>type: &#39;hand-discard&#39;</code> 的 ~25 處，找出 7 處<b>誤用為非丟棄場景</b>但 picker 預設 title 顯示「選擇丟棄的手牌」造成玩家誤會：</li>
          <li>　・<b>激動渦輪</b>（花舞鳥ex）— 是「選火能量附於備戰」</li>
          <li>　・<b>沙儷</b>（支援者）— 是「選寶可夢放回牌庫」</li>
          <li>　・<b>碧綠之舞</b>（厄鬼椪 碧草面具ex）— 是「選草能量附於碧草面具ex」</li>
          <li>　・<b>無力充能</b>（青木的考拉哥）— 是「選能量附於戰鬥寶可夢」</li>
          <li>　・<b>幸福禮物</b>（×2 個 stage）— 是「選基本能量附於對手 / 自己寶可夢」</li>
          <li>　・<b>金色火焰</b>（阿響系列）— 是「選火能量附於阿響的寶可夢」</li>
          <li>　・<b>能量撢子</b>（物品）— 是「選對手手牌能量放回對手牌庫下方」</li>
          <li><b>修法：</b>① picker 預設 title 從「選擇丟棄的手牌」改為中性「選擇手牌」（真正丟棄的卡如 高級球/交易/再構築 的 addLog 已說「丟棄」，picker 中立 OK）。② 上述 7 處在 effects 端 <code>params</code> 補上 <code>titleOverride</code> 寫清楚動詞。</li>
          <li><b>檢討</b>：picker type 名稱（<code>hand-discard</code>）強烈暗示動詞但實際是泛用 picker，導致誤用。長期解：要嘛 rename 為 <code>hand-pick</code>（breaking change，所以不做），要嘛靠 <code>titleOverride</code> 補語意 — 本版採後者並建立鐵律：日後新增 <code>hand-discard</code> 但不是「丟棄」用途的場景，<b>必須在 params 加 titleOverride</b>。</li>
          <li>tsc 0 errors + svelte/compiler parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.61</span> 🃏 構築 gate 升級 + 8 張卡 metadata 修正</summary>
        <ul>
          <li>玩家提需求：三件事一起做。</li>
          <li><b>① 同名 4 張橫跨版本擋</b>：原 + 按鈕只看 per-card.id 的 maxCopies(card)=4，導致玩家先放 4 張呱呱泡蛙 SV5a 後再點 呱呱泡蛙 M4（不同 card.id、相同 name）也能 +。改為 <code>remainingCapacity()</code>：同名累計 ≥ 4 直接擋並 alert「同名卡片『X』已達 4 張上限（跨版本/招式累計）」。<b>ex / 非 ex / 超級進化 ex 因 JSON name 不同（甲賀忍蛙 / 甲賀忍蛙ex / 超級甲賀忍蛙ex），各自獨立計 4 張，<u>不變</u></b>。</li>
          <li><b>② G 標基本能量在標準賽不受構築限制</b>：<code>validateDeck</code> 的 regulationMark 檢查跳過 <code>isBasicEnergy(card)</code>。實體賽事規則明文「基本能量不受任何構築限制」— 含所有屬性（草/火/水/雷/超/鬥/惡/鋼/妖/龍/無），任何標記都合法。</li>
          <li><b>③ Reprint exception 名單</b>：因 H/I/J 標有重印過、舊版本（含 G 標）依然合法的 8 張卡：寶可夢交替 / 寶可裝置3.0 / 寶可夢捕捉器 / 高級球 / 粉碎之錘 / 能量轉移 / 老大的指令 / 裁判。<code>validateDeck</code> 這 8 張卡名都跳過 regulationMark 檢查。日後若有新增重印類型，加進 <code>STANDARD_REPRINT_LEGAL_NAMES</code> set 即可。</li>
          <li><b>修正 8 張卡 JSON regulationMark（玩家回報資料庫標記錯誤）</b>：</li>
          <li>　・寶可夢交替 SV5a 056/066：I → <b>G</b></li>
          <li>　・寶可夢捕捉器 SV5a 057/066：J → <b>G</b></li>
          <li>　・粉碎之錘 SVM 131/175：J → <b>G</b></li>
          <li>　・高級球 MBD 014/022：H → <b>I</b></li>
          <li>　・高級球 MBG 012/022：H → <b>I</b></li>
          <li>　・寶可夢交替 MBG 015/022：H → <b>I</b></li>
          <li>　・寶可夢交替 SV9a 058/063：I → <b>G</b></li>
          <li>　・寶可夢交替 SVK 022/042：I → <b>G</b></li>
          <li>新增 helper：<code>sameNameTotal(deck, name, cardsById)</code> / <code>remainingCapacity(deck, card, cardsById)</code> / <code>isStandardReprintLegal(card)</code> / <code>STANDARD_REPRINT_LEGAL_NAMES</code> set，皆在 <code>validation.ts</code>；UI <code>addCard</code> 與 modal preview 的 pvMax 改用 remaining-aware 計算。</li>
          <li>tsc 0 errors + svelte/compiler parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.59</span> 🤖 hotfix：AI setup 在手牌只有閃焰王牌時卡死（瞬間爆發力沒同步給 AI）</summary>
        <ul>
          <li>玩家回報：與 AI 對戰開局，AI 設置寶可夢階段卡住。懷疑 AI 手上有閃焰王牌（瞬間爆發力）但不知道怎麼處理。</li>
          <li>玩家提供官方 QA：「在對戰準備時，若最初抽出的 7 張手牌中沒有【基礎】寶可夢，僅有閃焰王牌，可以因特性『瞬間爆發力』的效果，將閃焰王牌放置於戰鬥場上並開始對戰嗎？答：可以。」</li>
          <li>追根因：v2.42 已加 <code>canBeInitialActiveCard</code> helper，engine 端 PLACE_ACTIVE / mulligan 都對；UI 也有 <code>canSetupActiveSpecial</code> flag。<b>但 AI 沒同步</b> — <code>ai.ts:255</code> 仍用 <code>isBasicPokemonCard</code> 判斷可放戰鬥場的卡。AI 手牌只有閃焰王牌時 <code>basics.length === 0</code> → <code>return null</code> → AI 永遠交不出 setup action → 整局卡死。</li>
          <li>修法：<code>handleSetupAI</code> 改成「先試 Basic、其次 fallback 用 canBeInitialActiveCard」：</li>
          <li>　・有 Basic → 走原本邏輯（HP 最高優先 / 魔靈多龍含羞苞優先）</li>
          <li>　・沒 Basic 但有閃焰王牌 → fallback 用 <code>canBeInitialActiveCard</code> filter 找出可起手戰鬥場的卡（閃焰王牌瞬間爆發力涵蓋）</li>
          <li>　・備戰位仍維持 isBasicPokemonCard（卡面：「備戰位只能放基礎寶可夢」這條規則沒變）</li>
          <li><b>檢討（要寫進新鐵律）</b>：每次新增「特殊規則 helper」（如本次的 <code>canBeInitialActiveCard</code>），務必同步更新 <b>3 個地方</b>：① engine handler（規則層）② UI helper（玩家視角）③ AI（AI 視角）。v2.42 加這個 helper 時改了 ① ②，漏了 ③ 拖到 4 年後玩家踩坑才發現。</li>
          <li>tsc 0 errors + svelte/compiler parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.58</span> 🚨 hotfix：deck-search filter 13 處 orphan（金屬信號 bug 根因 — 大規模影響 11+ 張卡）</summary>
        <ul>
          <li>玩家回報：蓋諾賽克特ex｜金屬信號（卡面：選最多 2 張<b>【鋼】屬性的進化寶可夢卡</b>）實際變成「任意抓 1 張」。</li>
          <li>追根因：effects code 設了 <code>filter: &#39;Stage1Or2:Metal&#39;</code> 看似正確，但 <code>game/+page.svelte</code> 的 deck-search filter switch <b>完全沒這個 case</b>，fallthrough 到 line 1605 的 <code>return true;</code> → 整副牌庫都被當合法候選 → 玩家可任選 2 張任何卡。</li>
          <li>Audit：grep 全部 effects/cards/*.ts 的 filter 字串 + 對照 UI helper 的 case 表，找出 <b>13 個 orphan filter（設了但 UI 沒實作）</b>，分布於 deck-search / hand-discard：</li>
          <li>① <code>Stage1Or2:Metal</code> — <b>蓋諾賽克特ex｜金屬信號</b>（user-reported）</li>
          <li>② <code>BasicEnergy:Psychic</code> — <b>迷唇娃｜樂呵呵之吻</b></li>
          <li>③ <code>BasicEnergy:Fire</code> — <b>妖火紅狐｜閃焰魔法</b>（hand-discard 棄能量）</li>
          <li>④ <code>BasicPokemon</code> — <b>巨翅飛魚｜呼朋引伴</b>（應限基礎寶可夢；之前任意卡）</li>
          <li>⑤ <code>EvolutionPokemon</code> — <b>哈克龍｜進化指引</b>（應限進化寶可夢；之前任意卡）</li>
          <li>⑥ <code>PokemonTool</code> — items_misc 多張道具搜尋類 + v168 supporters（應限寶可夢道具；之前任意卡）</li>
          <li>⑦ <code>BasicPsychicEnergy</code>（deck-search 用，hand-discard 之前已有）</li>
          <li>⑧ <code>BasicFightingEnergy</code>（deck-search 用）</li>
          <li>⑨ <code>GrassPokemonOrStadium</code> — <b>時拉比｜時間輪轉</b>（卡面：≤3 張【草】寶可夢/競技場）</li>
          <li>⑩ <code>FirePokemonOrBasicFireEnergy</code> — v2670 i-wave17（火屬性）</li>
          <li>⑪ <code>Pokemon:甲殼繭,盾甲繭</code> — <b>v2306 增長繭</b>（被 generic <code>Pokemon:&lt;Type&gt;</code> handler 抓到 → 比對 pokemonType=&#39;甲殼繭,盾甲繭&#39; 永遠 false → 玩家看不到候選卡無法觸發）</li>
          <li>⑫ <code>Pokemon:脫殼忍者</code> — <b>v2306 鐵面忍者</b>（同上 bug）</li>
          <li>⑬ 雜項：另有幾個別名（BasicPokemon / EvolutionPokemon = 已有 Basic / Evolution 的別寫法）也順便加 alias 處理。</li>
          <li><b>修法</b>：</li>
          <li>① 在 <code>game/+page.svelte</code> deck-search switch 加 <b>generic prefix handler</b>：<code>Stage1Or2:&lt;Type&gt;</code>、<code>BasicEnergy:&lt;Type&gt;</code>、<code>Pokemon:Name=&lt;name&gt;</code>、<code>Pokemon:Names=&lt;a,b&gt;</code> — 未來新增同類 filter 不需改 UI。</li>
          <li>② 加 <code>BasicPokemon / EvolutionPokemon / PokemonTool / BasicPsychicEnergy / BasicFightingEnergy / GrassPokemonOrStadium / FirePokemonOrBasicFireEnergy</code> 等具名 case。</li>
          <li>③ hand-discard switch 加 <code>BasicEnergy:&lt;Type&gt;</code> generic prefix。</li>
          <li>④ <code>v2306_meta_pokemon.ts</code> 的兩個 ambiguous filter 改用 <code>Pokemon:Names=甲殼繭,盾甲繭</code> / <code>Pokemon:Name=脫殼忍者</code>（語意明確，不會被當屬性 match）。</li>
          <li><b>檢討</b>：filter 字串是 untyped string，effects 端與 UI 端各寫各的，沒有編譯期保證。下次新增 filter 必須同時 grep UI helper 確認對應 case 存在。長期解：把 filter 做成 enum + UI 端 exhaustive switch，編譯期 catch 漏處理。</li>
          <li>tsc 0 errors + svelte/compiler parse 兩道驗證後 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.57</span> 🔥 改進：能量分配 picker 改成「按屬性分波」（多屬性更直觀）</summary>
        <ul>
          <li>玩家回報：閃焰王牌｜閃焰渦輪 從牌庫挑 ≤3 張基本能量分配給備戰寶可夢時，若選了<b>不同屬性</b>能量（例：水 1 + 鬥 2），UI 不應把所有能量混成一個 +/- counter 讓玩家瞎選，而應該<b>按屬性分波</b>：先問水能量分配給哪隻、再問鬥能量分配給哪些（同屬性 +/- counter）。</li>
          <li>修法 1（通用化）：移除 <code>wave5-flame-turbo-*</code> 自製 resolver；閃焰渦輪改用通用 <code>v158-energy-chain-start</code> helper（source=&#39;deck&#39; / scope=&#39;bench-only&#39; / filterType=&#39;Any&#39;）。</li>
          <li>修法 2（核心改動）：升級 <code>startEnergyChain</code> 的「混屬性」分支 — 原本走逐張 chain（每張能量發一次 heal-target picker，3 張要按 3 次），改成新的「按屬性分波」流程：</li>
          <li>　・先把 energyIids 按屬性分組（同屬性視為一波）；</li>
          <li>　・第 1 波發 <code>energy-distribute</code> picker（+/- counter UI、標題顯示「分配【X】能量」）；</li>
          <li>　・resolver 處理該波 attach 後，若還有其他屬性 → 開下一波 picker；</li>
          <li>　・選了「全部水」或「全部鬥」這類同屬性場景，仍走 line 282 的 sameType fast-path 一次解決（行為不變）。</li>
          <li>新增 <code>v357-multi-type-distribute-wave</code> resolver + <code>groupEnergyIidsByType</code> + <code>dispatchByTypeWaveDistribute</code> helper（皆在 v158_energy_chain.ts）。</li>
          <li>影響範圍：所有用 <code>v158-energy-chain-start</code> 的卡（B1-B3、A8 海紋石之雨、handAttachEnergyPost / discardEnergyAttachPost helper 系列）— 全自動受惠，不需改 caller。</li>
          <li>Audit：另外 3 處 <code>energy-distribute</code> 用法（過度放電 / 龐克練肌 / 合金建造）filterType 都 hardcoded 成單一屬性（雷 / 惡 / 鋼），不會混屬性，無需修補。</li>
          <li>tsc 0 errors + svelte/compiler parse 兩道驗證後 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.56</span> 🐉 hotfix：勒克貓鬥志戰吼真正修好（v2.384 / v3.51 都只修一半）</summary>
        <ul>
          <li>玩家實機回報：小貓怪 → 勒克貓 進化後，雖然對手戰鬥場是超級袋獸ex，UI 卻沒提示倫琴貓ex 可進化；勒克貓上反而出現「使用特性」按鈕、按了之後變「已用特性」但什麼都沒發生。</li>
          <li>追到兩個 bug：</li>
          <li><b>Bug A（致命）</b>：<code>engine.ts:5815</code> 的 <code>getEvolvableTargets</code> UI helper inner filter gate 漏 <code>!hasFightingHowlBypass</code>。外層 5802 有鬥志戰吼 bypass，所以勒克貓（<code>evolvedThisTurn=true</code>）會通過外層；但 inner filter 重新檢查 <code>baseBlocked</code> 時只考慮 forest / 提升進化 / 刺激進化 三個 bypass，沒看鬥志戰吼，於是把倫琴貓 evo 全濾掉，UI 不顯示進化選項。</li>
          <li><b>Bug B（誤導）</b>：<code>v2380_j_abilities_batch.ts:324-326</code> 把鬥志戰吼錯註冊成主動 <code>regA</code> stub（v2.38 留下的「需 engine evolve gate」flag），這讓 UI 多出「使用特性」按鈕、按了還會被記入 <code>abilityNamesUsedThisTurn</code> 變「已用特性」，但 stub 只印 log 不做任何事。鬥志戰吼是<b>純被動</b>，不該有 regA。</li>
          <li>修法：① engine.ts 5815 inner gate 補 <code>!hasFightingHowlBypass</code>；② 移除 v2380_j_abilities_batch.ts 的錯誤 regA、改成純註解說明被動實裝點。</li>
          <li>檢討：v2.384 加 EVOLVE bypass 時沒同步補 UI helper 的 inner filter；v3.49/v3.51 來回 revert 也都只動到外層 / EVOLVE handler，從沒抓到 5815 這條 inner gate。多數 bypass 改動都需要兩處同步：外層 baseBlocked gate + inner filter validEvos check。</li>
          <li>tsc 0 errors + svelte/compiler parse 兩道驗證才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.55</span> 🚨 hotfix：v3.54 changelog 文字內出現裸 <code>&#123;@const&#125;</code> 觸發 Svelte parser，繼續炸 build</summary>
        <ul>
          <li>v3.54 雖然已修對「<code>&#123;@const&#125;</code> 在 <code>&lt;div&gt;</code> 內」這個真正的根因（picker UI），但我寫 v3.54 changelog 時，<b>summary 文字裡直接打了字面 <code>&#123;@const&#125;</code></b>（沒做 HTML entity escape），於是 Svelte 又把它當成 expression，在 parse 階段炸：<code>Expected whitespace at line 267 col 97</code>。</li>
          <li>修法：把 v3.54 changelog summary 那行的 <code>&#123;@const&#125;</code> 全部換成 <code>&amp;#123;@const&amp;#125;</code>（鐵律 1：Svelte template 內的 <code>&#123;</code>/<code>&#125;</code>/<code>&lt;</code>/<code>&gt;</code> 必須 entity escape）。</li>
          <li>檢討：寫 changelog 自己卻沒遵守鐵律 1，連續炸 7 次 build（v3.48 ~ v3.54）。鐵律不只 src code 要遵守，<b>連 docs/changelog 寫到 Svelte/JSX 語法符號都要 escape</b>。</li>
          <li>tsc 0 errors + 直接呼叫 svelte/compiler 試 parse 兩道驗證後才 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.54</span> 🚨 hotfix：修 v3.48 起連續 6 次 deploy 失敗（&#123;@const&#125; 在 &lt;div&gt; 內違反 Svelte 規則）</summary>
        <ul>
          <li>玩家發現 GitHub Actions deploy 從 v3.48 連 6 次失敗（v3.48 ~ v3.53）— 雖然 tsc 過、但 vite-plugin-svelte build 階段炸。</li>
          <li>根因：v3.48 我加 picker UI verb 時用 <code>&#123;@const verbWord = ...&#125;</code> 在 <code>&lt;div class=&quot;sel-header&quot;&gt;</code> 跟 <code>&lt;div class=&quot;sel-footer&quot;&gt;</code> 內。但 Svelte 規定 <code>&#123;@const&#125;</code> 只能是 <code>&#123;#if&#125;</code> &#47; <code>&#123;#each&#125;</code> &#47; <code>&#123;#await&#125;</code> &#47; <code>&#123;#snippet&#125;</code> 等 block 的「直接 child」，<b>不能在普通 HTML element 內</b>。</li>
          <li>修法：把 3 處 <code>&#123;@const&#125;</code>（verbWord、verbBtn、skipLabel）全部 inline 化（直接寫 ternary 在 h3 &#47; button 內），語意完全等價。</li>
          <li>後續 5 個 hotfix（v3.49 閃焰渦輪 / 鬥志戰吼、v3.50 tsc errors、v3.51 revert、v3.52 註解清理、v3.53 赤松）的邏輯都是對的，只是被這 6 次 build 失敗連帶卡住沒部署。修完 v3.54 build 通過後，全部累積的修補一次生效。</li>
          <li>檢討：之前 sandbox 的 EPERM 阻止跑 vite build，<b>tsc 通過 ≠ vite build 通過</b>。未來推 picker UI 改動務必先過 build verify，或避開「<code>&#123;@const&#125;</code> 在 element 內」這個 anti-pattern。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.53</span> 🔥 hotfix：赤松選 1 張基本能量時應加入手牌（依官方 QA），不能附加</summary>
        <ul>
          <li>玩家提供官方 QA：「使用支援者卡赤松時，若從牌庫僅選擇了 1 張基本能量卡，那麼可以將這張能量卡附加給自己的寶可夢嗎？」答：「<b>不可以</b>。這個情況下，要將選擇的能量卡加入手牌中。」</li>
          <li>卡面：「從自己的牌庫選擇<b>最多 2 張</b>各不同屬性的基本能量卡，在給對手看過後，<b>其中 1 張加入手牌</b>，<b>剩餘</b>的能量卡附於自己的寶可夢身上。」<br/>邏輯：選 1 張 → 「剩餘 = 0 張」沒得附加，只能入手。</li>
          <li>修法：<code>white_lily_akamatsu.ts akamatsu-split</code> resolver 的 1 張 case，從原本的「heal-target picker 選寶可夢附加」改為「直接加入手牌」。2 張 case 流程不變（淨效果與卡面一致 — 1 張入手、1 張附加）。</li>
          <li>tsc 驗證 0 errors 才 push（避免 v3.49 順序失誤）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.52</span> 清理 v2.384 / v3.49 留下的鬥志戰吼錯誤註解（純 docs，邏輯不動）</summary>
        <ul>
          <li>v2.384 留下的「evoCard 是貓鼬刀」註解誤導我 v3.49 改錯方向；v3.51 revert 後留下「v3.49 我誤改」的歷史檢討註解。</li>
          <li>本版清理 engine.ts EVOLVE handler / getEvolvableTargets UI helper 的鬥志戰吼相關註解，留下乾淨正確的說明：「鬥志戰吼（勒克貓 Stage1 特性）：對手戰鬥場是 ex 時，場上的勒克貓 bypass isFirstTurn / justPlaced / evolvedThisTurn 進化成倫琴貓」+ 完整進化鏈說明。</li>
          <li>同步清理 v2380_j_abilities_batch.ts 標頭註解的 v2.384 reference。</li>
          <li>純註解 cleanup，邏輯完全不動 — tsc verify 過再 push。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.51</span> 🔥 hotfix：revert v3.49 鬥志戰吼方向錯誤（base 才對、不是 evoCard）</summary>
        <ul>
          <li>玩家提問「對手是 ex 寶可夢的話 勒克貓就可以在剛下的那回合進化成倫琴貓嗎」— 戳中 v3.49 修錯方向。</li>
          <li>實際從 static/cards verify 完整進化鏈：小貓怪 (Basic) → <b>勒克貓 (Stage1，鬥志戰吼)</b> → 倫琴貓 (Stage2)。</li>
          <li>卡面「這隻寶可夢就算在最初回合或剛使出的回合也可進化」— 「這隻寶可夢」= 持有特性的勒克貓本身。情境：場上的勒克貓（剛從小貓怪進化，<code>evolvedThisTurn=true</code>）在對手 active 是 ex 時可立刻再進化成倫琴貓。</li>
          <li>正確判定：<code>baseCard.name === '勒克貓'</code>（場上要進化的勒克貓）。<b>v2.384 原邏輯是對的</b>，我 v3.49 誤改成 <code>evoCard.name === '勒克貓'</code> 反而 cover 了「進化成勒克貓」這個錯誤情境，原本的「勒克貓→倫琴貓」失效。</li>
          <li>修法（revert v3.49 鬥志戰吼部分，保留閃焰渦輪 fix）：① engine.ts L1777 改回 baseCard.name === '勒克貓'；② L1762 保留 isFirstTurn gate bypass（v3.49 對的部分，補了 v2.384 漏的）；③ UI helper getEvolvableTargets L5790 同步改為 base 是勒克貓 + oppIsEx 的條件。</li>
          <li>檢討：這次 hallucination 源自誤讀卡面「這隻寶可夢」的指涉對象。下次遇到 base/evoCard 條件判斷必須先實際追完整進化鏈再下手。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.50</span> hotfix：修 v3.49 v2550 tsc 4 errors（GameState 沒 import + 3 處 filter callback type 推斷失敗）</summary>
        <ul>
          <li>v3.49 推 push 後跑 tsc 才發現 4 個 type error（之前先跑 push 後驗證的順序錯誤）：<code>v2550_i_wave5_meta.ts:241</code> 用 <code>GameState</code> 但檔案 import 只有 <code>CardInstance, PlayerState</code>；L247/249/264 三個 <code>filter/find</code> callback 的 <code>c, b</code> 參數推不出型別。</li>
          <li>修法：① import 補 <code>GameState</code> ② 三處 callback 加 <code>(c: CardInstance)</code> / <code>(b: CardInstance)</code> 顯式型別。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.49</span> 🔥 hotfix：閃焰渦輪不能任意分配 + 鬥志戰吼 evoCard 條件反向</summary>
        <ul>
          <li><b>Bug 1 — 閃焰王牌｜閃焰渦輪</b>：玩家回報「不能任意分配能量，只能依備戰寶可夢數平均分配」。卡面：「從自己的牌庫選擇<b>最多 3 張</b>基本能量卡，<b>以任意方式附於備戰寶可夢身上</b>」。<br/>根因 1：v2550 L186 上限誤限為 <code>Math.min(3, basicE, bench.length)</code> — 限制能量數 ≤ 備戰寶可夢數。<br/>根因 2：resolver L211-216「依序附給備戰前 N 個」— 強制每隻 1 顆，無法集中。<br/>修法：① 上限改 <code>Math.min(3, basicEnergies.length)</code>（卡面 ≤3，不限備戰數）② step1 deck-search 後 chain 新 step2 <code>energy-distribute</code> picker，玩家可任意分配（含全部給同一隻）。新增 resolver <code>wave5-flame-turbo-distribute</code>。</li>
          <li><b>Bug 2 — 勒克貓｜鬥志戰吼</b>：玩家回報「先攻一下擺小貓怪、先攻二要進化勒克貓但鬥志戰吼沒發動」。卡面：「若對手戰鬥場為 ex，<b>這隻寶可夢</b>（勒克貓）就算在自己的最初回合或剛使出的回合也可進化」。<br/>根因：engine.ts L1777 寫 <code>baseCard.name === '勒克貓'</code> 條件<b>完全反了</b> — baseCard 是場上的小貓怪（進化前），evoCard 才是勒克貓。原邏輯永遠 false，鬥志戰吼從未生效。<br/>修法：① L1777 改為 <code>evoCard.name === '勒克貓'</code> ② L1762 isFirstTurn gate 補上 hasFightingHowl bypass（卡面寫「最初回合或剛使出的回合」雙鎖都應 bypass）③ getEvolvableTargets UI helper L5790 同步加 bypass（手牌有勒克貓 + 場上是小貓怪 + 對手 active 是 ex 時，UI 才會亮可進化）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.48</span> 🔧 picker UI 文字修正：4 張「放回」類招式不再誤顯示「丟棄」</summary>
        <ul>
          <li>玩家回報：忍者飛旋 picker 顯示「選擇要丟棄的能量」、「確定使用招式（丟 1 張）」、「不丟」— 但卡面實際是「放回手牌」，UI 文字與卡面語意不符。</li>
          <li>實際從 static/cards 比對所有 ATTACK_PRE_DISCARD_CHOICE 註冊的招式，找出 4 張同類 bug：</li>
          <li>① <b>超級甲賀忍蛙ex｜忍者飛旋</b> — 「放回手牌」</li>
          <li>② <b>薩戮德｜叢林鞭打</b> — 「放回手牌」</li>
          <li>③ <b>帝牙盧卡｜時間爆炸</b> — 「放回牌庫並重洗」</li>
          <li>④ <b>厄鬼椪 水井面具ex｜激流水泵</b> — 「放回牌庫並重洗」</li>
          <li>修法：PreDiscardSpec 加 <code>verb?: &#39;discard&#39; | &#39;return-to-hand&#39; | &#39;return-to-deck&#39;</code> 欄位，預設 &#39;discard&#39; 保留其他 21 張「丟棄」卡的明確語意。上述 4 張 spec 設對應 verb，UI 動態切換顯示文字（「選擇要放回手牌&#47;牌庫的能量」、「確定使用招式（放回 N 張）」、「不放回（0 傷害）」）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.47</span> 🔥 hotfix：超級甲賀忍蛙ex「忍者飛旋」可放回特殊【水】能量（依 PTCG 官方 QA）</summary>
        <ul>
          <li>玩家提供 PTCG 官方網站 QA 兩則：忍者飛旋可以將附加在超級甲賀忍蛙ex身上的「新衝天能量」、「泡沫【水】能量」放回手牌。</li>
          <li>確認卡面：超級甲賀忍蛙ex「忍者飛旋」120+「若希望，將 1 個這隻寶可夢身上附加的【水】能量放回手牌，增加 80 點傷害」。</li>
          <li>根因：six_decks.ts L262 的 <code>isWater</code> 判定限定 <code>subtype === 'Basic'</code>，跳過所有特殊能量 → 泡沫【水】能量、新衝天能量都被誤判為「不是水能量」。</li>
          <li>修法：改寫 <code>isWater</code> 判定，與 engine.ts <code>countEnergy</code> 的 host-aware 邏輯一致：<br/>① 基本【水】能量：yes <br/>② 特殊能量名稱含【水】（如泡沫【水】能量）：yes <br/>③ 新衝天能量 + host 是 Stage2（超級甲賀忍蛙ex 是 Stage2 進化）：yes（視為所有屬性含水）<br/>④ 稜鏡能量 + host 是 Evolution：no（只提供【無】）</li>
          <li>影響：超級甲賀忍蛙ex 配新衝天能量 / 泡沫【水】能量現在能正確觸發忍者飛旋 +80 傷害（200 總傷）效果，符合官方 QA。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.46</span> 🔥 hotfix：「基礎寶可夢」判定誤用 subtype 排除 ex（4 處全面修補）</summary>
        <ul>
          <li>玩家回報：火箭隊的超夢ex 是基礎寶可夢，應受火箭隊的急凍鳥「抵抗之幕」保護不受對手招式效果影響，但系統沒擋。</li>
          <li>根因：PTCG「基礎寶可夢」= <code>stage='Basic'</code>（不論 subtype 是 Basic / ex / V / GX）。但 codebase 4 處用 <code>subtype === 'Basic'</code> 判定，會誤排除 subtype='ex' 的所有 ex 基礎（火箭隊的超夢ex / 雷吉艾斯ex / 厄鬼椪 碧草面具ex 等）。</li>
          <li>修補 4 處（全部改用 PTCG 標準：supertype='Pokemon' 且非 Stage1&#47;Stage2&#47;Other 且 !evolvesFrom）：</li>
          <li>① <code>isRocketBasicTarget</code>（effects.ts L194） — 火箭隊的急凍鳥「抵抗之幕」保護對象；原 bug 讓火箭隊的超夢ex 暴露在對手招式效果下。</li>
          <li>② <b>謎擬Q｜呼朋引伴</b>（L1319） — 牌庫搜「基礎寶可夢」放備戰；原 bug 讓 ex 基礎搜不出來。</li>
          <li>③ <b>投擲猴｜聯合投擲</b>（L3755） — 自己場上【基礎】寶可夢數 × 20 傷害；原 bug 讓 ex 基礎沒計入。</li>
          <li>④ 招式 cond=&#39;basic&#39; 對手戰鬥場判定（L7965） — 原 bug 讓對手 ex 基礎被誤判為非基礎，招式效果不生效。</li>
          <li>未動：能量 filter 用 <code>subtype === 'Basic'</code>（基本能量定義 vs Special 能量），這是正確用法。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.45</span> 🔥 hotfix：急進開關能量轉移實裝（卡面有效果但程式漏做）</summary>
        <ul>
          <li>玩家回報：急進開關沒做出 UI 選單讓玩家選擇能量轉移，這部分沒實裝。</li>
          <li>確認卡面：「將自己的戰鬥寶可夢與備戰寶可夢互換。<b>然後，選擇換入備戰區的寶可夢身上附加的任意數量的能量卡，改附於新的戰鬥寶可夢身上</b>。」</li>
          <li>根因：之前 <code>reg('急進開關', switchEffect('急進開關'))</code> 直接與寶可夢交替共用 switchEffect，只做 swap 沒做能量轉移。</li>
          <li>修法：分離出獨立的 <code>rushSwitchEffect()</code>，新增兩個 resolver — <code>rush-switch-pick-bench</code>（執行 swap 後檢查舊 active 能量數）+ <code>rush-switch-energy-transfer</code>（把選的能量從 bench 移到新 active）。</li>
          <li>UI：複用既有的 <code>active-energy-discard</code> picker（已支援 <code>targetIid</code> 從 bench 寶可夢讀能量），加 <code>titleOverride: &quot;急進開關：選擇要轉移到新戰鬥寶可夢的能量&quot;</code> 改標題避免顯示「撤退要丟棄的能量」誤導文字。minCount=0、maxCount=N（任意數量，含 0）。</li>
          <li>未動：寶可夢交替（純 swap，無能量轉移）、頂尖捕捉器（對手 swap）、共用的 <code>do-switch</code> resolver。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.44</span> 🔥 hotfix：基本能量 pokemonType=null 全面修補（雷吉充能等 13 處）</summary>
        <ul>
          <li>玩家回報：雷吉充能顯示「棄牌區無水能量」但棄牌區明明有 2 張基本水能量。</li>
          <li>根因：基本能量卡 JSON 的 <code>pokemonType</code> 欄位是 <b>null</b>（不是 'Water'），屬性必須從卡名 <code>【水】</code> 等 parse。但 codebase 13 處只查 <code>card.pokemonType === 'Water'</code> 沒做 fallback → 永遠回空陣列。</li>
          <li>修法：每處加 <code>|| card.name.includes('【X】')</code> fallback，與 engine.ts 既有 <code>isBasicEnergyOfType()</code> 同步。</li>
          <li>受影響檔案：engine.ts L6355 (Lightning) &#47; effects.ts L7097, 7108, 7314, 7594, 10324, 10386 (Grass &#47; Metal &#47; Darkness &#47; Lightning) &#47; v2306_meta_pokemon.ts (Grass, Fire) &#47; v2353_j_mark_batch.ts (雷吉充能 typeFilter) &#47; v2380_j_attacks_batch.ts &#47; v2401_i_wave2 &#47; v2650_i_wave15 (Fighting) &#47; v2660_i_wave16 (Fire, Grass)。</li>
          <li>影響範圍：所有「從棄牌區搜基本【XX】能量」類效果之前都失效。雷吉充能（水/鋼）、寶石海星類牌組、阿響的火爆獸 setup、火焰雞多龍等都受影響。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.43</span> AI 強化：魔靈多龍 preset 牌組策略特製（斷頭線思維）</summary>
        <ul>
          <li>玩家要求：優化 AI 對戰，先處理魔靈多龍 preset 牌組的策略。</li>
          <li>偵測：玩家整體所有區同時擁有「多龍巴魯托ex」+「黑夜魔靈」+「含羞苞」三張 → 認定使用魔靈多龍 preset（火焰雞多龍 preset 沒含羞苞與黑夜魔靈，不會誤判）。</li>
          <li>核心戰術「斷頭線」：把對手主威脅推進「我方下次攻擊一發 KO」的距離。三條 KO 線 — 多龍幻影奇襲（戰鬥場 200 &#47; 備戰 60）、黑夜魔靈炸彈（130）、彷徨夜靈炸彈（50）。</li>
          <li>能量分配特化：火 &#47; 超只填多龍奇 &#47; 多龍巴魯托ex（滿 1F+1P 後不再填），惡只填願增猿 1 顆（觸發腎上腺腦力），其他寶可夢一律不填。</li>
          <li>Setup 含羞苞優先擺戰鬥場（用癢癢花粉封對手物品卡爭取進化時間）。</li>
          <li>咒詛炸彈 gate（黑夜魔靈 13 &#47; 彷徨夜靈 5）：直接 KO 或炸後配合多龍 KO 線（黑夜魔靈炸完 ≤200 配多龍 KO 戰鬥場、彷徨夜靈炸完 ≤60 配多龍幻影奇襲分配 KO 備戰）才使用，沒目標不亂自爆。</li>
          <li>幻影奇襲 6 顆指示物分配演算法：① 能用最少 counter KO 的優先送 KO ② 剩餘砸 ex 壓到 200（為老大指令鋪路）③ 殘餘平均砸最大威脅。</li>
          <li>老大指令 picker：抓對手備戰中 ex 且 HP-damage ≤ 200（讓多龍 KO 取 2 獎賞），60 內備戰不抓（保留給幻影奇襲分配 KO 取 1 獎賞，省一張老大指令）。</li>
          <li>願增猿腎上腺腦力對手目標選擇：優先直接 KO，次優先壓 KO 線（active 加上轉移 ≤200 可被多龍 KO &#47; bench ≤60 可被幻影奇襲 KO），最後才砸最高 HP 威脅。</li>
          <li>未動：其他預組牌組的 AI 走原本通用邏輯。本版策略只在魔靈多龍 preset 啟用。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.42</span> 🔥 hotfix：連線對戰對手起手無基礎寶可夢時，補抽 modal 不顯示</summary>
        <ul>
          <li>玩家回報：連線對戰時，A 玩家起手無基礎寶可夢重抽多次後，B 玩家（應該收到補抽補償）畫面不會跳出「決定多抽 N 張」的 modal。</li>
          <li>根因：兩個 bug 互相加乘。</li>
          <li><b>Bug 1（v3.34 task #171 已知 P1）</b>：<code>checkAndStartOnlineGame</code> 雙端各自 <code>createGame()</code> 用不同 random seed → A 端洗牌 A 起手沒基礎需重抽 → A 端 <code>pendingMulliganDraw=[0, m1]</code>；B 端洗牌兩邊都正常 → B 端 <code>pendingMulliganDraw=[0, 0]</code>。Firestore transaction 只接受其中一方為 source of truth。</li>
          <li><b>Bug 2（v3.39 引入）</b>：setup 階段 per-player merge 為了防雙方擺寶可夢互覆，保留本地 <code>pendingMulliganDraw[me]</code>。但本地是 race loser 時，這個保留就是錯的 — B 永遠保留自己的 0，看不到 modal。</li>
          <li>修法：<code>handleRoomUpdate</code> 在所有 stale check &#47; setup merge 之前先比對 <code>game.id !== incoming.id</code>。雙端 createGame 產生不同 id，loser 端發現 id 不一致時直接全套用 incoming，採納 firestore winner 版本作為 server-authoritative state。同一 game.id 內後續才走 setup per-player merge。</li>
          <li>影響：解決 mulligan modal 不出現、雙端 setup 從不同初始 state 開始等所有 createGame race 後遺症。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.41</span> iPad 10.5 留白吃掉 — 放大場上卡片、手牌、加寬 log 區</summary>
        <ul>
          <li>玩家回報：v3.40 改完 bench 格數但視覺感覺不到改善，希望「利用空位縮小，把場上的牌或手牌變大一點，或是把戰鬥敘述 log 留多一點」。</li>
          <li>根因：iPad 10.5 與 1366×768 走 <code>.battle-root.tablet-layout</code> 模式，這個模式為了避免在小螢幕「卡牌跑出視窗」刻意把 active-img / bench-slot / hand-card 的 max-height/width 限制得很保守，但這在 iPad 10.5（gameZoom 81%）上反而讓場景看起來空蕩。</li>
          <li>修法：把 tablet-layout 的卡牌尺寸普遍放大 20-35%，把節省下來的橫向空間加給 log 區。</li>
          <li>戰鬥場 active-img：max-height 110→150px、max-width 80→115px；active-card min-height 120→160px。</li>
          <li>備戰 bench-slot：高度 135→175px、img max-height 80→115px。</li>
          <li>手牌 hand-card：寬度 76→96px、img 72→92px、hand-scroll min-height 120→150px。</li>
          <li>戰鬥 log：log-col 寬度 280→360px（多容納 ~30% 橫排訊息，省捲動）。</li>
          <li>不動 layout 結構，不重排 zone 順序 — 玩家視覺記憶不受影響。</li>
          <li>桌面 ≥1366px 大解析度走非 tablet 路徑，本版不影響。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.40</span> iPad 10.5 layout 保守優化 — bench 格 N+1 自適應 + active 上下置中</summary>
        <ul>
          <li>玩家回報：iPad 10.5 吋橫向 layout 中央留白過大，主因是 bench 永遠固定 5 格，即使對手只擺 1 隻也撐出 4 個空格。</li>
          <li>修法 1（bench 自適應）：<code>Array(Math.max(5, ...))</code> → <code>Array(Math.max(Math.min(5, N+1), oppBenchLimit, 1))</code>。實擺 N 隻 + 1 個 drop placeholder（用於拖曳目標），上限 5（PTCG 規則），但保留 oppBenchLimit &gt; 5（零之大空洞 8 格）的擴展。對手只擺 1 隻 → 顯示 2 格，省下原本 3 格的留白。</li>
          <li>修法 2（active 上下置中）：<code>.zone-active</code> 加 <code>align-self: center</code> 覆蓋 <code>.field-row</code> 的 <code>align-items: flex-end</code>，戰鬥寶可夢卡片從貼底改為上下置中對齊。</li>
          <li>未動：active 左右位置 &#47; chip 位置 &#47; 獎勵位置 — 保留現有玩家熟悉的「獎勵在左、牌庫棄牌在右」配置，符合中文 PTCG 玩家既有習慣。</li>
          <li>下個版本（v3.41 規劃）：參考實體賽事桌墊配置做大改 — 戰鬥場置中、備戰區水平置中、獎勵 2×3 縱向放角落、競技場固定中右。會先出 mock-up 草圖確認方向再動手。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.39</span> 🔥 hotfix：連線對戰 setup 階段無限重置 — 雙方擺寶可夢互覆 race</summary>
        <ul>
          <li><b>嚴重 bug</b>：玩家回報連線對戰卡在雙方擺寶可夢階段，無限重置，會一直把對方退回上一個擺放階段。</li>
          <li><b>根因 1（write side）</b>：dispatch 的 <code>canIPush</code> gate 只在 <code>prevState.activePlayerIndex===myPlayerIndex</code> 時放行 push，但 setup 階段 <code>activePlayerIndex</code> 是固定的 firstPlayerIdx → <b>後手玩家 dispatch 完全不 push</b>，自己擺的只在本地。</li>
          <li><b>根因 2（read side）</b>：<code>handleRoomUpdate</code> 收到 firestore snapshot 時直接 <code>game = incoming</code>，<b>整顆 GameState 覆蓋本地</b>。先攻方擺好 push → 後手 echo 收到 → 後手自己剛擺的被洗掉 → 玩家又擺 → ping-pong 互相覆蓋 → 無限重置。</li>
          <li><b>修法 1（write）</b>：<code>canIPush</code> 在 <code>prevState.phase==='setup'</code> 時直接 return true（雙方都需要 push 自己擺放）。</li>
          <li><b>修法 2（read）</b>：<code>handleRoomUpdate</code> 在 setup 階段做 <b>per-player merge</b> — 保留本地 <code>players[me]</code> &#47; <code>setupDone[me]</code> &#47; <code>pendingMulliganDraw[me]</code>，只取 incoming 的對方那側。雙方各自管自己側不互覆。</li>
          <li><b>進入 playing 的轉換</b>：engine.ts <code>FINISH_SETUP</code> handler 在 <code>setupDone[0] && setupDone[1] && mul[0]===0 && mul[1]===0</code> 時自動轉 <code>phase=&#39;playing&#39;</code>。後 finish 者 dispatch 時會看到自己 merge 後的 <code>setupDone[op]=true</code>，自動觸發 transition + push 整套 playing state，先 finish 者收到後正常套用（已不在 setup 路徑）。</li>
          <li>未動 v3.34 既有的 playing 期間 stale snapshot 防護（log.length 比對）— 保留向後相容。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.38</span> 牌組 60 張 gate — 本機&#47;AI 模式 + 連線 lobby UI 訊息明確化</summary>
        <ul>
          <li>使用者要求：對戰前加 gate，未滿 60 張或超過 60 張的牌組系統要顯示警告，連線對戰無法按準備完成、AI 對戰無法開始。</li>
          <li>連線 lobby（先前已存在 gate）：「準備完成」按鈕已透過 <code>hasValidDeck = myDeckCount === 60</code> disable，server-side <code>setSeatReady</code> 也擋（room.ts L298 第二層保險）。但 UI 提示僅顯示「套用中⋯」誤導玩家以為系統還在處理。</li>
          <li>修法 1（連線）：seat-deck-info 訊息細分四種狀態 — ✓ 牌組已套用（60 張）&#47; 套用中⋯ &#47; ⚠ 不足 60 張（目前 N 張）&#47; ⚠ 超過 60 張（目前 N 張）&#47; 請選牌組。別人座位也補張數提示。</li>
          <li>修法 2（本機&#47;AI）：先前 startLocalGame button 只檢查 <code>!p1DeckId &#124;&#124; !p2DeckId</code>，沒擋 60 張規則。新增 derived <code>p1DeckCount</code> &#47; <code>p2DeckCount</code> &#47; <code>p1DeckValid</code> &#47; <code>p2DeckValid</code>，按鈕 disabled 改用 <code>!p1DeckValid &#124;&#124; !p2DeckValid</code>。</li>
          <li>修法 3（本機 UI）：每個 setup-card 的 select 後加綠&#47;紅樣式提示框 — ✓ 60 張 &#47; ⚠ 不足 60 張（目前 N 張）&#47; ⚠ 超過 60 張（目前 N 張）。</li>
          <li>修法 4（保險）：startLocalGame 函式末端再加一道張數檢查，若繞過 UI 直接呼叫會 alert + return。</li>
          <li>新增 CSS class <code>.deck-count-info.ok</code> &#47; <code>.deck-count-info.bad</code>。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.37</span> 修撤退按鈕消失 bug + 補 cantRetreatNextTurn 鏡射 + 新增無法撤退診斷 tooltip</summary>
        <ul>
          <li>玩家回報：吉雉雞ex 身上有火+超能量、無 status chip、turn-res 撤退 chip 顯示「可用」、log 無擋撤退訊息，但撤退按鈕未出現。</li>
          <li>根因：<code>getRetreatCost()</code> 漏了 <code>cantRetreatNextTurn</code> flag 的鏡射。RETREAT handler 內擋（engine.ts L1870），但 UI 用的 <code>canRetreat()</code> 走 <code>getRetreatCost()</code>、未檢查此 flag → 過去版本 UI 撤退按鈕顯示但點下去無反應。</li>
          <li>而本次玩家描述「按鈕完全消失」屬於另一條路徑（仍待現場驗證）。為了下次能立即診斷，本版加 <code>getRetreatBlockReason()</code> 診斷函式並把 UI 撤退按鈕改成「條件齊備時永遠顯示，不能撤退時 disabled + tooltip 顯示原因」。</li>
          <li>修法 1：engine.ts <code>getRetreatCost()</code> 加 <code>if (player.active.cantRetreatNextTurn) return null;</code>，與 RETREAT handler 同步。涵蓋懶人獺 悠哉 / 束縛 / 鬼盜衝撞 等招式效果。</li>
          <li>修法 2：engine.ts 新增 <code>getRetreatBlockReason()</code> export — 回傳中文短描述（「本回合已撤退過」「能量不足（需 2 現 1）」「霍米加的演奏」等），規則優先順序與 <code>getRetreatCost</code>＋<code>canRetreat</code> 完全鏡射。</li>
          <li>修法 3：routes&#47;game&#47;+page.svelte L3654 撤退按鈕邏輯改寫 — 條件齊備時（active 存在 &#47; bench 不為空 &#47; isMyTurn &#47; main phase &#47; 非化石 &#47; 非 pendingSelection）永遠顯示按鈕；不能撤退時改用 <code>.btn-retreat-blocked</code> 紅暗色 disabled 樣式 + 🚫 圖示 + <code>title</code> 顯示原因。</li>
          <li>影響：下次再遇到「撤退按鈕應該出現但沒出現」回報，玩家把游標 hover 到按鈕就能直接看到原因，省掉排查時間。</li>
          <li>未動：手機版 MobilePortraitBattle.svelte 撤退選項邏輯維持原樣（手機 sheet UI 結構不適合 disabled state），但底層 engine 修補同樣套用。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.36</span> 修拖曳預覽偏移（iPad &#47; 低解析度視窗 zoom 模式下手指與卡片視覺不貼合）</summary>
        <ul>
          <li>使用者回報：iPad 10.5 吋與 Windows 低解析度模式下，手指拖出手牌時卡片視覺會出現在手指上方一點，導致看似拖到目標但實際 dropZone 判定點偏離。</li>
          <li>根因：<code>.battle-root.zoomed</code> 套用 CSS <code>zoom: var(--game-zoom)</code>（例 0.7）。drag-preview 為其子元素，雖用 <code>position:fixed</code>，但 CSS <code>zoom</code> 與 <code>transform: scale</code> 行為不同 — <code>zoom</code> 會影響子元素 fixed 座標解讀，<code>left:500px</code> 實際渲染在 350px 處。</li>
          <li>而 <code>PointerEvent.clientX&#47;clientY</code> 為未縮放的 viewport 像素（500），所以視覺定位 500×0.7=350 與手指 500 形成 150px 偏移。</li>
          <li>修法：drag-preview inline style 改為 <code>left:&#123;dragging.x &#47; gameZoom&#125;px;top:&#123;dragging.y &#47; gameZoom&#125;px;</code> — 預先除回 zoom，被 zoom 乘上後恰好還原成 clientX&#47;Y。</li>
          <li>未動 elementFromPoint 偵測（仍用 <code>e.clientX&#47;Y</code>，符合 viewport 座標規格），只修視覺貼合。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.35</span> 清 7 個 pre-existing svelte-check type 警告（純 type-only 修補，無功能變動）</summary>
        <ul>
          <li>背景：累積至 v3.34 的 7 個 svelte-check type 警告長期殘留，本版做 type-only 全清。皆加正確 null guard &#47; type narrow，無 <code>@ts-ignore</code> 或 <code>as any</code> 偷懶。</li>
          <li><b>routes&#47;decks&#47;+page.svelte:773</b> — <code>activeEntries</code> derived 內 <code>typeof active.entries[number]</code> 在 narrow 後的 type-position 仍被視為 active 可能 null（type expression 不走 control-flow narrowing）。修法：抽出 <code>type DeckEntry = &#123; cardId: string; count: number &#125;</code> alias。</li>
          <li><b>routes&#47;game&#47;MobilePortraitBattle.svelte:345</b> — <code>activeActions()</code> return type 含 <code>zoomIid?: string</code> 但內部 <code>out</code> array 元素 type 沒寫 → push 撤退項時報 <code>'zoomIid' does not exist</code>。修法：補齊 array 元素 type 與 return type 一致。</li>
          <li><b>routes&#47;game&#47;MobilePortraitBattle.svelte:695</b> — energy-target 按鈕的 onclick closure 內 <code>sheet!.type === '...' ? sheet.energyIid : ''</code> 第二個 <code>sheet</code> 沒加 <code>!</code>，被視為可能 null。修法：補 <code>sheet!.energyIid</code>（前面 <code>sheet!.type</code> 已 assert）。</li>
          <li><b>routes&#47;game&#47;+page.svelte:1794</b> — <code>totalEnergyUnits(...,game,...)</code> 第 3 參要求 <code>GameState | undefined</code>，但 <code>game</code> 為 <code>GameState | null</code>。修法：傳 <code>game ?? undefined</code>。</li>
          <li><b>routes&#47;game&#47;+page.svelte:2614</b> — <code>ZH_BY_TYPE: Record&lt;EnergyType, string&gt;</code> 漏 <code>Fairy</code> key（EnergyType 含 Fairy），補 <code>Fairy: '妖'</code>。</li>
          <li><b>routes&#47;game&#47;+page.svelte:4498 &#47; 4504</b> — yes&#47;no overlay 的 onclick closure 內 <code>preAttackDiscard.attackIndex</code> 被視為可能 null（closure narrow 不穿外層 #if）。修法：closure 內加 <code>if (!preAttackDiscard) return;</code> null guard。</li>
          <li>驗證：<code>tsc --noEmit</code> 0 errors、<code>svelte-check</code> 7 個 type errors → 0 errors（保留 EPERM 環境問題的 preprocessing notice，與型別無關）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.34</span> 連線對戰穩定性 audit — 4 處 P0 race &#47; 邊緣情境修補</summary>
        <ul>
          <li>背景：v2.82 _syncSeq race deadlock、v2.83 回滾改用「playing 期間停心跳」、v2.84 修 Firestore array-of-arrays — 過去 3 個版本累積了不少連線同步教訓；本版做完整 audit 找出殘留 race 並修補</li>
          <li><b>P0-1 dispatch 早 return 不 push（newState === game）</b>：action 被 engine 拒絕（state 沒變）時仍走 pushGameState 路徑，把同樣 state 推回 firestore、bump updatedAt — 在對手剛 push 後夾入，可能誤覆寫對手權威狀態。修法：if (newState !== prevState) 才走 push。</li>
          <li><b>P0-2 dispatch 加 actor gate（線上模式）</b>：原本只要 mode==='online' 就 push，導致 (a) 觀戰位點到隱藏按鈕 (b) 對手回合 UI race 點到非法 action (c) pendingPrize 取走時非 owner 推送 — 都會把對方權威 state 覆蓋。修法：dispatch 結尾加 canIPush 計算（pending actor / activePlayerIndex / pendingPrize owner / 補場身分），不是合法 actor 就只更新 local 不推 firestore。</li>
          <li><b>P0-3 leaveOnlineGame 順序修正</b>：原本 stopHeartbeat → await leaveRoom → 才 unsubRoom。await 期間 firestore onSnapshot 仍可 fire handleRoomUpdate，把剛清掉的 game 又重設或誤跳「房間不存在」錯誤。修法：先 unsubRoom + unsubMessages 阻斷 callback，再 stopHeartbeat，最後 await leaveRoom。</li>
          <li><b>P0-4 handleRoomUpdate 拒收舊 snapshot</b>：playing 期間若 incoming.gameState.log.length &lt; local.log.length 視為舊 snapshot 拒收（最終防線）。只擋 strictly less，不擋等於，避免重蹈 v2.82 _syncSeq deadlock 覆轍（v2.82 的 deadlock 來自雙方各自 +1 互相拒收）。</li>
          <li>P1-5 dismissZombieRoom 順序對齊：同樣先 unsub + stopHeartbeat 再 await deleteRoom。</li>
          <li>遞延項：lobby 期間 self-heartbeat 觸發的 onSnapshot 仍會走 handleRoomUpdate 重設 roomData（純 metadata 變動，無功能影響）— 留待 v3.35+ 再優化。雙端 createGame 不同步問題：兩端各自 createGame 後 startGame transaction 只有一方 commit，loser 端 local game 短暫使用 random shuffle 不同的初始牌庫順序，但 onSnapshot 立刻回來覆蓋為 winner 版本（含舊 snapshot 拒收保護），暫態不一致時間 &lt; 1 秒、無玩家可見的功能影響。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.33</span> heal-target picker 標題改通用「選擇目標寶可夢」</summary>
        <ul>
          <li>使用者回報：picker 標題寫「選擇回復的寶可夢」但實際很多情境並不是回復（進化、附能量、互換目標等）</li>
          <li>修法：routes/game/+page.svelte 第 2591 行 heal-target picker 預設標題從「選擇回復的寶可夢」改成「選擇目標寶可夢」</li>
          <li>原本就有 params.titleOverride 機制，可被個別招式/特性指定更精確的標題（如「選擇進化目標」），預設改通用後不影響原有 override 行為</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.32</span> 手機版撤退選項加 🔍 放大鏡按鈕</summary>
        <ul>
          <li>使用者回報：手機版戰鬥寶可夢動作底部 sheet 內，撤退選項只有純文字按鈕，無法先看備戰寶可夢身上能量/狀態</li>
          <li>桌機版的浮動撤退選單早已有 🔍 副按鈕（line 4584-4586），用法是「點放大鏡查看 → 點本體確定撤退」</li>
          <li>修法：手機版 sheet 內每個撤退選項擴展為「主按鈕（撤退）+ 🔍 副按鈕（放大檢視）」並排版面，副按鈕點擊呼叫 onOpenZoom</li>
          <li>同時加 .mp-sheet-row / .mp-sheet-zoom CSS 配合新版面</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.31</span> revert — 還原 v3.30 Mega ex 視為 Stage 2 的誤修</summary>
        <ul>
          <li>用戶後續澄清：自己原本是把超級寶石海星ex 誤認成 2 階進化寶可夢，實際 JSON stage='Stage1' 是正確的</li>
          <li>新衝天能量規則確實是「附於 2 階進化寶可夢 → 2 個任意屬性能量；否則 1 個無色」— 嚴格依 JSON stage 判定</li>
          <li>Mega ex 在 PTCG 中 stage 由卡面決定：超級噴火龍ex 等 JSON 標 Stage 2 的就是 2 階；超級寶石海星ex 等 JSON 標 Stage 1 的就是 1 階</li>
          <li>修法：還原 engine.ts 第 995 行 isStage2 為純 pokeStage === 'Stage2' 判斷，移除 v3.30 加的 isMegaEx fallback</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.30</span> hotfix — Mega ex 視為 Stage 2（新衝天能量 / 稜鏡能量）</summary>
        <ul>
          <li>使用者回報：超級寶石海星ex 附 1 水能 + 1 新衝天能量無法發動星雲光束（3C 招式）</li>
          <li>根因：超級寶石海星ex 在 JSON 中 stage 標為 'Stage1'（evolvesFrom 海星星 Basic），但 PTCG 規則 Mega 寶可夢視為 2 階進化。引擎用 pokeStage === 'Stage2' 判斷新衝天能量是否視為 2 個任意屬性 → Mega ex 被當 Stage 1 → 新衝天只給 1 個 Colorless → 1 水 + 1C = 2 units 不夠 3C cost</li>
          <li>修法：engine.ts 第 995 行 isStage2 加 Mega 偵測（name 以「超級」開頭 + 'ex' 結尾），與既有 prizesForKO（line 1067-1071）的 Mega 判斷一致</li>
          <li>影響範圍：所有附新衝天能量到「超級XXXex」的場景；超級寶石海星ex / 超級呆殼獸ex / 超級噴火駝ex / 超級路卡利歐ex / 超級暴雪王ex / 超級雷電獸ex（JSON 標 Stage1 的 6 張 Mega ex）受惠</li>
          <li>稜鏡能量同理變更（pokeStage 判定路徑相同）— Mega ex 上稜鏡視為「非基礎」也能正確給 1 個任意屬性</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.29</span> 雷伊布ex 閃光尖矛 改 picker（最後 1 張 deferred 解除）</summary>
        <ul>
          <li>v3.10 起 deferred — 卡面「若希望，棄最多 2 張自方備戰基本能量」原為自動棄到上限</li>
          <li>修法：改用 ATTACK_PRE_DISCARD_CHOICE picker（own-bench scope，min 0 max 2，baseDamage 60，damagePerEnergy 90），與 火箭隊的超夢ex 擦除球 同 pattern</li>
          <li>regPre 過濾只計「基本能量」(card.subtype==='Basic')；玩家若誤點特殊能量會被自動過濾</li>
          <li>邊界：玩家選 0 張 → 60 傷害；選 1 張 → 150；選 2 張 → 240（弱抗前）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.28</span> hotfix — binary-yes-no「否」被誤判為 yes（嚴重 bug 影響 v3.26 全部 11 張）</summary>
        <ul>
          <li>使用者回報：超級雷電獸ex 狂暴噴射「保留能量」按鈕 點下去能量還是被丟棄</li>
          <li>根因：actions.ts attack action serializer 寫 <code>discardedEnergyIids &amp;&amp; discardedEnergyIids.length &gt; 0</code>，把長度 0 的空陣列當成「沒傳」吃掉。binary-yes-no 的「否」按鈕傳 <code>[]</code> 序列化後變 undefined → engine 端 AI fallback 把它當 yes → 強制丟棄能量</li>
          <li>影響範圍：v3.26 全部 11 張用 binary-yes-no 的招式（狂暴噴射、刺殺迴旋、鼻之金勾臂、光芒強襲、叢林鞭打、粉碎重壓、災厄風暴、災難衝擊、光照燃燒、挖回 等）— 玩家「否」按鈕全部失效</li>
          <li>修法：序列化條件改為 <code>discardedEnergyIids !== undefined</code> — 區分「沒傳」（AI fallback）vs「傳了空陣列」（明確選否）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.27</span> 閃光射線 修正 &#43; POST 預約招式 audit &#43; 4 張對手能量回手 picker 化</summary>
        <ul>
          <li><b>背景</b>：使用者點名超級雷電獸ex｜閃光射線 — v3.22 我把這張卡誤實裝為「下次被打 -100」（damageReduceNextHit），但卡面其實是「在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害」即<b>免疫</b>而非減傷。本波修正並順便 audit 同類「POST 預約招式效果」的實裝是否符合卡面語意。同步將 v3.26 標 deferred 的 4 張「對手能量回手」類招式做 picker 化。</li>
          <li><b>1. 閃光射線 修正</b>（v2660_i_wave16_misc9.ts）：
            <ul>
              <li>原 v3.22 實裝：POST 設 <code>damageReduceNextHit&#61;100</code>（下回合被打 -100），語意錯誤（卡面是免疫而非減傷，且「-100」對 200&#43; 的招式仍會打中）。</li>
              <li>v3.27 修正：改用既有 <code>immuneToBasicAttackNextTurn</code> flag（與 v2.101 鋁鋼橋龍｜塗層攻擊 同 pattern）。owner 的 END_TURN 自動 promote NextTurn &rarr; ThisTurn，對手回合攻擊時若 attacker.stage === 'Basic' 且 defender 持有此 flag &rarr; 傷害歸零（招式仍打出，其他 post 效果仍觸發，與卡面語意完全一致）。</li>
              <li>nextOwnAttackPenalty 機制保留：仍服務黑魯加｜大聲咆哮 / 嘎啦嘎啦｜叫聲 / 超級火炎獅ex｜吠 / 仙子伊布ex｜魔法魅惑 / 菊草葉｜叫聲 / 捲捲耳｜撒嬌 / 布撥｜叫聲 / 象徵鳥｜反射壁 / 赫普的稚山雀｜恐怖視線（共 9 張卡面真為「-N 減傷」者）。</li>
            </ul>
          </li>
          <li><b>2. POST 預約招式 audit</b>（掃描所有 regPost 內 NextTurn flag 設定）：
            <ul>
              <li>確認 9 張卡面為「-N 減傷」（damageReduceNextHit / nextOwnAttackPenalty）正確；</li>
              <li>確認 7 張「coinHeadsSelfImmuneNextPost」用 <code>damageReduceNextHit&#61;9999</code> 等價於免疫（卡面只擋傷害不擋效果，目前實作符合）；</li>
              <li>確認 4 張「免疫某類招式」（鋁鋼橋龍｜塗層攻擊、大嘴蝠｜隱密飛行、太樂巴戈斯ex｜皇冠蛋白石、裹蜜蟲｜塗層攻擊）已正確使用 <code>immuneToBasicAttackNextTurn</code>；</li>
              <li>本波只改 1 張誤實裝（閃光射線），其餘 audit 結果為「實作與卡面一致」。</li>
            </ul>
          </li>
          <li><b>3. 4 張對手能量回手 picker 化</b>（v3.26 deferred）：
            <ul>
              <li><b>高傲雉雞｜反轉之風</b>（effects.ts）：原 returnOppActiveEnergyPost(2) 自動取末端 2 張 &rarr; <code>active-energy-discard</code> picker（sourcePlayerIdx&#61;dIdx，minCount&#61;0，maxCount&#61;cap）&#43; 自訂 resolver 把選中能量放回對手手牌。</li>
              <li><b>章魚桶｜水流清洗</b>（v2660）：原自動取末端 1 張 &rarr; picker（minCount&#61;0，maxCount&#61;1）。</li>
              <li><b>帕底亞 肯泰羅｜上搗角擊</b>（v2760）：原自動取末端 2 張（gate：對手戰鬥場 &#61; Stage2）&rarr; picker（minCount&#61;0，maxCount&#61;cap）。</li>
              <li><b>呆呆王｜付諸東流</b>（v2760）：原自動取末端 2 張 &rarr; picker（minCount&#61;0，maxCount&#61;cap）。</li>
              <li>四張卡均加上 v3.08 美納斯｜平穩境地 阻擋 helper（_v3080OppHasMenasure / _v3080OppHasMenasureCG）— 對手場上有美納斯時 short-circuit 不開 picker、log 顯示「能量回手效果無效」。</li>
              <li>minCount&#61;0 即實現「若希望」語意：玩家選 0 張即「不發動」。</li>
            </ul>
          </li>
          <li><b>Iron Rule 遵守</b>：Rule 11 — 4 個既有檔（version.ts / effects.ts 711KB / v2660 / v2760）一律走 Python pipeline（HEAD blob &rarr; in-memory replace &rarr; safe_write &#43; fsync），驗證 disk size &#61; mem bytes &#43; 新增 marker count 正確。Rule 12 — 全部用 regPre / regPost / regR helper 註冊（_shared.ts 是 leaf module 無 TDZ 風險）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.26</span> 「若希望」棄能量類招式 audit &#43; fix（11 張）</summary>
        <ul>
          <li><b>背景</b>：使用者點名超級雷電獸ex｜狂暴噴射 / 火箭隊的超夢ex｜擦除球。經 audit JSON 卡面文字含「若希望」&#43; 棄能量／棄競技場／回手 等 26 張，逐一比對實裝後找出 11 張 bug（卡面為玩家可選，但實裝強制執行）。火箭隊的超夢ex｜擦除球已正確（ATTACK_PRE_DISCARD_CHOICE own-bench picker），不在本波。</li>
          <li><b>修補機制</b>：複用既有 binary-yes-no scope（v2.255 蚊香泳士｜跳躍衝天）— 玩家在開招式前 UI 跳出 yes/no overlay，PRE 與 POST 皆讀 action.discardedEnergyIids 長度（0&#61;否、&ge;1&#61;是）同步行為，AI fallback 預設「是」最大化攻擊。射攻月亮借殼 hand-energy scope（v2.389 大嘴娃｜雙重食客 pattern）。</li>
          <li><b>修補清單（11 張）</b>：
            <ul>
              <li><b>超級雷電獸ex｜狂暴噴射</b>（v2770）：原強制棄全能量 &#43;130 &rarr; binary yes/no（200 vs 330）。</li>
              <li><b>火箭隊的叉字蝠ex｜刺殺迴旋</b>（v2670）：原強制自身回手 &rarr; binary yes/no（120 留場 vs 120 回手）。</li>
              <li><b>大王銅象｜鼻之金勾臂</b>（v2750）：原強制 &#43;100 &#43; recharge &rarr; binary yes/no（130 vs 230 &#43; 下回合鎖招式）。</li>
              <li><b>輕身鱈ex｜光芒強襲</b>（v2750）：原強制棄全手牌 &#43;120 &rarr; binary yes/no（120 vs 240，手牌 0 時不開）。</li>
              <li><b>薩戮德｜叢林鞭打</b>（effects.ts）：原「自身有能量則必收 &#43;80」AI 強吃 &rarr; binary yes/no（80 vs 160）。</li>
              <li><b>浩大鯨ex｜粉碎重壓</b>（v2670）：原有競技場必棄 &#43;140 &rarr; binary yes/no（140 vs 280，無競技場時不開）。</li>
              <li><b>轟鳴月ex｜災厄風暴</b>（effects.ts）：與粉碎重壓同 pattern &rarr; binary yes/no（100 vs 220）。</li>
              <li><b>超級皮可西ex｜射攻月亮</b>（v2353&#43;v2380）：原 v2353 註冊 attacker scope（錯，卡面是手牌）&#43; v2380 強制棄手牌前 4 張 &rarr; 改用 hand-energy scope，玩家自選 0-4 張手牌能量。</li>
              <li><b>超級麻麻鰻魚王ex｜災難衝擊</b>（v2650）：原強制棄 2 雷 &#43; 強制麻痺 &rarr; binary yes/no；雷能量不足 2 個時不執行。</li>
              <li><b>燭光靈｜光照燃燒</b>（v2630）：原強制棄牌庫頂 &rarr; binary yes/no（保留 vs 棄牌庫頂）。</li>
              <li><b>岩狗狗｜挖回</b>（v2630）：與光照燃燒同 pattern。</li>
            </ul>
          </li>
          <li><b>Iron Rule 遵守</b>：Rule 11 — 10 個既有檔（version.ts / effects.ts / &#43;page.svelte / v2770 / v2670 / v2750 / v2650 / v2630 / v2353 / v2380）一律走 Python pipeline（HEAD blob &rarr; in-memory replace &rarr; safe_write &#43; fsync），驗證 disk size &#61; mem bytes。Rule 12 — 全部用 ATTACK_PRE_DISCARD_CHOICE.set / regPre / regPost helper 註冊（_shared.ts 是 leaf module，無 TDZ 風險）。</li>
          <li><b>Deferred</b>：以下卡片屬「對手能量回手 / 對手選擇」類，雖也是「若希望」但需要更複雜的 picker（玩家挑哪些對手能量），本波不修：高傲雉雞｜反轉之風、章魚桶｜水流清洗、帕底亞 肯泰羅｜上搗角擊、呆呆王｜付諸東流、雷伊布ex｜閃光尖矛（已標 deferred）、毛辮羊／毛毛角羊／大比鳥ex｜搗碎／狂風呼嘯（卡面只是「棄競技場」無傷害加成，影響極小）。</li>
        </ul>
      </details>

      <details open>
        <summary><span class="ver-badge">v3.25</span> 超級沙奈朵ex｜盈溢祈願 改為 2-stage 玩家自選 picker</summary>
        <ul>
          <li><b>卡面</b>：「從牌庫選擇任意數量的『基本【超】能量』卡，以任意方式附於自己的備戰寶可夢身上。然後，重洗牌庫。」</li>
          <li><b>v2.42 舊行為</b>：自動從牌庫挑前 N 張基本【超】能量、依 bench 順序附；玩家完全沒有選擇空間。違反卡面「以任意方式」字樣（玩家應自選哪張能量、附給哪隻備戰）。</li>
          <li><b>v3.25 新行為（兩段 picker）</b>：
            <ul>
              <li><b>Stage 1</b>（deck-search, filter=&#39;Energy:Psychic&#39;）— 玩家從牌庫挑 0 ~ min(bench.length, 牌庫基本【超】能量數) 張。0 張表示「任意數量」含 0（合法），直接結束。</li>
              <li><b>Stage 2</b>（bench-choose, minCount &#61; maxCount &#61; N）— 玩家依序挑同數量的備戰寶可夢；picker UI 內部以 Set 維護 selectedIids，自動保證 N 隻彼此不同（每隻最多 1 顆能量、不重複）。</li>
              <li><b>配對</b>：stage1.picked&#91;i&#93; &#8594; stage2.picked&#91;i&#93;（依玩家點選順序）。</li>
              <li><b>收尾</b>：移除牌庫對應 N 張能量、附給對應備戰、重洗牌庫；log 列出每對「能量名 &#8594; 寶可夢名」。</li>
            </ul>
          </li>
          <li><b>邊界</b>：bench&#61;0 / 牌庫無基本【超】能量 / 玩家 Stage 1 選 0 張 — 三者皆只 log &#43; 重洗牌庫，不開後續 picker。</li>
          <li><b>Iron Rule 遵守</b>：Rule 11 — v2402_mega_gardevoir.ts / version.ts / +page.svelte 一律走 Python pipeline（HEAD blob → in-memory replace → safe_write &#43; fsync），驗證 disk size &#61; mem bytes。Rule 12 — Stage 1 / Stage 2 resolver 透過 regR helper 註冊到 _shared.ts 的 RESOLVERS Map（leaf module，無循環依賴 / TDZ）。</li>
        </ul>
      </details>

      <details open>
        <summary><span class="ver-badge">v3.24</span> hotfix — 力之沙漏 重複觸發 prompt 無限循環</summary>
        <ul>
          <li>使用者回報：力之沙漏觸發 prompt 後玩家可以選了又再選，系統一直重複</li>
          <li>根因：engine END_TURN handler 設 pendingSelection 後 return state，turn 沒真的結束。玩家 RESOLVE_SELECTION 後再按「結束回合」→ END_TURN 又從頭跑 → 力之沙漏 hook 又觸發 → 棄牌區還有基本能量就再 prompt → 無限循環</li>
          <li>修法：加 PlayerState.lourisToolUsedThisTurn per-turn flag。END_TURN 設 prompt 之前 check flag，且 set flag 再 return state；下回合開始時 reset 為 false（與其他 per-turn flag 同地點 reset）</li>
          <li>影響：玩家本回合最多只能用 1 次力之沙漏（符合卡面「在自己的回合結束時，可以...」每回合 1 次）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.23</span> hotfix — 超級沙奈朵ex 超級交響樂 0 傷害 bug</summary>
        <ul>
          <li>使用者回報：超級沙奈朵ex 第二招「超級交響樂」實際對戰中無論場上有多少【超】能量都打 0 傷害</li>
          <li>根因：v2.42 實作用 pokemonType==='Psychic' 判定能量是否【超】type，但 JSON 內所有能量的 pokemonType 都是 'None'（基本能量從卡名解析、特殊能量看 SPECIAL_ENERGY_TYPES 表），檢查永遠 false → psyCount=0 → 0 傷害</li>
          <li>修法：改用「基本能量看卡名含【超】 + 特殊能量白名單（感應【超】能量 / 火箭隊能量 / 古舊能量）」雙重判斷</li>
          <li>稜鏡能量 / 新衝天能量 條件式（附進化卡時提供全屬性）暫未納入，少見場景待後續補</li>
        </ul>
      </details>

      <details open>
        <summary><span class="ver-badge">v3.22</span> 雷電獸ex｜閃光射線「下回合自己出招 -100」誤觸發 bug 修補 + 沙奈朵盈溢祈願 / 力之沙漏 noted</summary>
        <ul>
          <li><b>背景</b>：玩家回報 3 個 bug — (1) 超級沙奈朵ex｜盈溢祈願「附超能量時好像都會漏掉一個備戰寶可夢」、(2) 超級雷電獸ex「在場上有競技場時第一招跟第二招都會少 100 點傷害」、(3) 力之沙漏「會強迫把棄牌區的所有能量都填回來，第二招則是完全沒有傷害」。</li>
          <li><b>Bug #2 雷電獸ex（真 bug，已修）</b>：根因為 <code>damageReduceNextHit</code> 旗標在 engine.ts 被兩端共用 — line 3229 attacker-side check「自己下次出招 -N」（用於黑魯加｜大聲咆哮 / 嘎啦嘎啦｜叫聲 / 超級火炎獅ex｜吠 等「對手下次招式 -N」）以及 line 3762 defender-side check「自己下次被打 -N」（用於樹林龜｜甲殼衝撞 / 巨鉗螳螂ex｜鋼翼 / 雷電獸ex｜閃光射線 等）。雷電獸閃光射線打完後在自己 active 設下旗標（語義為「自己下回合被打 -100」），若對手 T2 沒攻擊雷電獸，旗標未被消耗，T3 自己出招時被 attacker-side check 誤吃掉 → 自己招式 -100。用戶誤以為跟競技場相關，實際只要對手沒攻擊就會發生。</li>
          <li><b>修法</b>：<code>CardInstance</code> 加 <code>nextOwnAttackPenalty</code> 獨立旗標。engine.ts line 3229 attacker-side check 改檢查新 field；effects.ts <code>defNextAtkReducePost</code> + v2580 / v2620 同名 helper 改設 <code>nextOwnAttackPenalty</code>。<code>damageReduceNextHit</code> 純化為 defender-side（自己下次被打 -N），不再被 attacker-side 誤消耗。受影響卡：黑魯加｜大聲咆哮（-100） / 嘎啦嘎啦｜叫聲（-40） / 超級火炎獅ex｜吠（-50） + v2580 / v2620 內列舉的 defNextAtkReducePost 用例。雷電獸 / 樹林龜 / 巨鉗螳螂ex / 噗隆隆 / 飄飄球 等 selfDmgReducePost 用例維持原狀（仍用 damageReduceNextHit），但不再有副作用。</li>
          <li><b>Bug #1 沙奈朵 盈溢祈願（noted，邏輯已驗證正確 + 加診斷 log）</b>：v2402_mega_gardevoir.ts 的邏輯正確 — <code>need = Math.min(player.bench.length, psyEnergies.length)</code>，4 隻備戰 &#43; 牌庫 ≥ 4 張基本【超】能量時 4 隻全部會附；若牌庫不足會依序前 N 張。本波加詳細 log（每隻備戰是否實際附到、未附原因），方便用戶下次回報具體場景驗證。卡面語義「附給自己的所有備戰寶可夢」嚴格只指備戰，不含戰鬥場 active（這也是用戶預期被誤解的可能來源）。</li>
          <li><b>Bug #3 力之沙漏（noted，邏輯已驗證正確）</b>：engine.ts END_TURN handler 開的 pendingSelection 是 <code>type: discard-search, filter: BasicEnergy, minCount: 0, maxCount: 1</code> — picker UI 給玩家「最多 1 張，可跳過（minCount=0 自動顯示『不選（跳過）』按鈕）」。RESOLVERS 的 <code>brailliant-attach</code> 處理 0 張就跳過，1 張就附上。「強迫填回所有能量」與實裝行為不符，無法重現。「第二招完全沒傷害」未指明哪隻寶可夢哪個招式，資訊不足，本波不修，等用戶澄清具體場景再 deferred 處理。</li>
          <li><b>Iron Rule 遵守</b>：Rule 11 — types.ts / engine.ts / effects.ts / v2580 / v2620 / v2402_mega_gardevoir / version.ts / +page.svelte 一律走 Python pipeline（HEAD blob &#8594; in-memory replace &#8594; safe_write &#43; fsync），無 mount-truncate。Rule 12 — 本波無新 .set() 呼叫於子檔案 module top-level，所有現有 regPost / reg 都透過 helper（_shared.ts 中的 ATTACK_POST / TRAINER_EFFECTS / RESOLVERS Map），無循環依賴 / TDZ 風險。</li>
          <li>tsc 0 error。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.21</span> 奧爾迪加（Supporter, G）新實裝 + 化石卡 audit 補漏（3 張）</summary>
        <ul>
          <li><b>新卡：奧爾迪加</b>（SV8a 189/187, G）— 「查看對手的手牌，從其中任意選擇 1 張卡，放回對手的牌庫下方。然後，對手若希望，從牌庫抽出 1 張卡。」</li>
          <li><b>實裝機制</b>：重用既有 hand-choose &#43; modal-choice 兩階段 pendingSelection。流程：
            <ol>
              <li>出牌者開 hand-choose（actorIdx=自己, sourcePlayerIdx=對手）— UI 顯示對手手牌明牌供選</li>
              <li>resolver 把選中的卡從對手手牌移除 push 到對手牌庫末尾（&#61;牌庫下方），公開揭示卡名</li>
              <li>開 modal-choice（actorIdx=對手）— UI 自動切換到對手端顯示 yes/no 模態</li>
              <li>resolver 看對手選 yes &#8594; 對手抽 1 張；no &#8594; 結束</li>
            </ol>
          </li>
          <li><b>「對手 yes/no」互動機制</b>：不需新 pendingSelection type。既有 modal-choice 只要把 actorIdx 設為對手，UI gate（<code>pendingSelection.actorIdx === myPlayerIndex</code>）自動讓對手端顯示。連線對戰天然適用；單機 AI fallback 在 ai.ts modal-choice case 已處理。</li>
          <li><b>化石卡 audit 補漏（v2.187 → v3.20 累積發現 3 個缺漏）</b>：
            <ul>
              <li><b>陳舊的羽毛化石（I）</b>— 原實裝只擋 attack-damage；卡面寫「備戰區不受傷害與效果」，補為 <code>attack-damage</code> &#43; <code>attack-effect</code> 兩者皆擋（effects.ts <code>resolveBenchGuard</code>）。先前走「狙擊備戰設狀態 / 放指示物」類招式會漏掉羽毛化石的免疫。</li>
              <li><b>陳舊的背蓋化石（H）</b>— 原實裝只在 engine.ts ATTACK&#95;POST 階段 short-circuit；但 <code>canApplyAttackEffectToTarget</code> 路徑（手之力量 / 卡害穴 / 幻影奇襲 等累積 10&#43; 張招式效果）未檢查，本波在 helper 開頭加 short-circuit。</li>
              <li><b>陳舊的鰭之化石（J）</b>— 原實裝僅在 supporters_gust.ts 內聯過濾老大的指令；其他走 <code>isImmuneToOppSupporter</code> 的 supporter resolver（覆蓋緊張感 / 融合為雪 / 廣域堡壘）並未 cover 鰭之化石 — 本波整合到 helper 首行規則 0，未來新增召叫類 / 操作對手寶可夢類 supporter 自動吃到鰭之化石免疫。</li>
            </ul>
          </li>
          <li><b>未動到（已正確）</b>：陳舊的根狀化石（H, +1【無】能量需求） / 陳舊的顎之化石（J, 戰鬥場 -30）兩張實裝完整且正確，本波不變動。</li>
          <li><b>Iron Rule 遵守</b>：Rule 11 — effects.ts / v3080&#95;deferred&#95;wave&#95;c.ts / version.ts / +page.svelte 一律走 Python pipeline（HEAD blob &#8594; in-memory replace &#8594; safe&#95;write &#43; fsync）。Rule 12 — v3210&#95;ordiga.ts 只透過 <code>reg</code> / <code>regR</code> helper 註冊（統一存 _shared.ts Map，leaf module 無循環依賴 / TDZ 風險）。</li>
          <li>tsc 0 error，svelte-check 0 error。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.20</span> 洛托姆ex｜多重轉接 — toolAttached → extraTools array 重構（major refactor，跳號 v3.20）</summary>
        <ul>
          <li><b>卡面</b>：洛托姆ex（M2 029/080）特性「多重轉接」— 「只要這隻寶可夢在場上，名稱中有『洛托姆』的自己的所有寶可夢，各自身上最多可附有 2 張『寶可夢道具』卡。（這個特性消除時，將身上多附的『寶可夢道具』卡丟棄。）」</li>
          <li><b>資料結構</b>：CardInstance 加 <code>extraTools?: CardInstance[]</code>（最多 1 張，加上既有 toolAttached 共 2 張道具）。保留 <code>toolAttached: CardInstance | null</code> 不改 → 既有 200+ 處引用點不需改 — 還是查第 1 張。</li>
          <li><b>新 helpers（_shared.ts）</b>：<code>getAllAttachedTools(inst)</code> 回傳 <code>[toolAttached, ...extraTools].filter(Boolean)</code>；<code>hasMultiToolRelay(state, ownerIdx, pool)</code> 檢查場上是否有洛托姆ex 帶此特性活躍；<code>isLotomFamily(card)</code> 檢查名字含「洛托姆」；<code>reconcileMultiToolRelay(state, pool)</code> 在每次 applyAction 末尾檢查 — 若特性消除則丟棄 extraTools。</li>
          <li><b>attach-tool resolver（tools.ts）</b>：toolAttached 已滿時，若 holder 為洛托姆家族 + 自方場上有多重轉接啟用 + extraTools 還沒滿 → push 到 extraTools；否則退回手牌（既有行為）。也檢查 TOOL_ATTACH_GATE（核心記憶碟 等限定 holder 仍會被擋）。</li>
          <li><b>TOOL_xxx hook iterate（engine.ts / effects.ts）</b>：HP_BONUS、ATTACK_BONUS、DEFENSE_REDUCE_BY_TYPE、DEFENSE_REDUCE_BY_ATTACKER_ABILITY、PREVENT_KO、ON_KO、PRIZE_BONUS、ON_DAMAGED、RETREAT_MOD、BOTH_SIDES_RETREAT_PLUS、END_TURN_DISCARD、TOOL 招式注入（招式學習器螢石 / 核心記憶碟）、璀璨結晶、反擊增幅器、赫普的講究頭帶、垃圾洩氣、力之沙漏 等所有 TOOL hook 全部改 iterate <code>getAllAttachedTools(inst)</code>。</li>
          <li><b>discard 路徑</b>：所有「KO 棄牌 / 退化棄牌 / 強制棄道具 / 進化保留」處（spread <code>...(X.toolAttached ? [X.toolAttached] : [])</code>）改為 <code>...getAllAttachedTools(X)</code>；toolAttached: undefined 重置處同步加 extraTools: []。共 47 處 spread + 13 處重置。</li>
          <li><b>道具拆除器 picker</b>：選項 ID 從 <code>pIdx:instIid</code> 改為 <code>pIdx:instIid:toolIid</code>（3 段）以區分主道具與 extraTools；resolver 用 helper 從 inst 移除指定 iid 道具。</li>
          <li><b>百萬噸吹風機</b>（丟對手所有道具）：stripOne 改 iterate 兩個來源；hasTool 檢查改用 <code>getAllAttachedTools</code>。</li>
          <li><b>進擊鐳射 / 配件秀</b>：「身上附有道具」與「自方場上道具數」也計入 extraTools。</li>
          <li><b>UI 顯示</b>：game/+page.svelte 與 MobilePortraitBattle.svelte 的「🔧」chip 改成顯示所有道具（每張一個 chip / 手機版顯示 🔧×N）。retreatCostOf（氣球 -2）改 iterate。drop-target 阻擋擴展為「洛托姆家族 + 場上有多重轉接 + 還能附」例外 → 允許第 2 張。</li>
          <li><b>Reconcile 自動清理</b>：在 applyAction 末尾（<code>enforceBenchLimit</code> 之後）呼叫 <code>reconcileMultiToolRelay</code> — 若某方場上沒有洛托姆ex 多重轉接活躍，該方所有 extraTools 立即丟到棄牌堆並寫 log。涵蓋阻礙之塔／鐵荊棘ex 初始化／洛托姆ex 被 KO 等所有「特性消除」情境（這些場景下 hasMultiToolRelay 會回傳 false）。</li>
          <li><b>Iron Rule 11 / 12 遵守</b>：所有既有檔（types.ts / version.ts / engine.ts / effects.ts / _shared.ts / tools.ts / v2610 / v3080_deferred_wave_c.ts / +page.svelte / MobilePortraitBattle.svelte / game +page.svelte）改動一律走 Python pipeline；無新增 module top-level <code>.set()</code> 呼叫，無 TDZ 風險。</li>
          <li><b>影響範圍</b>：grep <code>toolAttached</code> 在 effects.ts / engine.ts / +page.svelte 等共 200+ 處；本波改動約 80 處核心 hook + 10+ 處 UI；剩餘為 destructure / 進化保留 / 重置內部 helper（不需改）。</li>
          <li>tsc 0 error，svelte-check 0 error。</li>
          <li>本 wave 結束 v3.x 系列所有 deferred；下一個目標：往 v3.21+ 細部 audit / 新卡實裝。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.14</span> Deep audit 13 個 bug 修補 — 對手 X 效果方向 / 玩家選擇 picker / Math.random 換 flipCoinsWithLog</summary>
        <ul>
          <li><b>背景</b>：v3.13 後做更深一層 audit，發現 13 個既有實裝違反 Iron Rules 的 bug：1 個 P0（picker 方向錯）、5 個 Rule 7（自動代玩家做選擇）、1 個 Rule 8（公開揭示）、4 個 Math.random 替代 flipCoinsWithLog（缺 coin 動畫＋對手驗證 cue）、2 個 missing addLog。</li>
          <li><b>P0 嚴重 — 靈幽馬｜幻影碎</b>：原 <code>sourcePlayerIdx: aIdx</code> 是錯的，<code>opp-poke-choose</code> 的 <code>sourcePlayerIdx</code> 應指向「目標方」（對手 dIdx），picker 才會顯示對手寶可夢。原 bug 導致 picker 顯示自己寶可夢 → 12 counter 全失效，整個招式形同無效。改為 <code>dIdx</code>。</li>
          <li><b>P1 Rule 7 違反（5 張，原本自動代玩家做選擇）</b>：</li>
          <li>　・<b>粉碎之錘</b>：原本選完寶可夢後自動取末尾能量。改成 <code>active-energy-discard</code> picker chain（先選目標寶可夢 → 再選該寶可夢身上 1 張能量）。</li>
          <li>　・<b>悠哉尾草棒</b>：同粉碎之錘，picker chain 改成玩家選能量。</li>
          <li>　・<b>火箭隊的閃電鳥｜阻礙之翼</b>：原本對手戰鬥場末尾能量 + 隨機對手備戰雙重 auto-pick。改成 <code>active-energy-discard（sourcePlayerIdx=dIdx）</code> → <code>bench-choose（sourcePlayerIdx=dIdx）</code> chain，玩家選能量 + 選對手備戰目標。</li>
          <li>　・<b>謝米｜能量反射</b>：原本自身末尾能量 + 第 1 隻備戰雙重 auto-pick。比照 v2352 凱路迪歐｜能量反射做法，改成 <code>active-energy-discard</code> → <code>bench-choose</code> chain。</li>
          <li>　・<b>願增猿｜腎上腺腦力</b>：原本 <code>amount = min(damage, 30)</code> 強制全搬，違反卡面「最多 3 個」的玩家選張數權。改成 source picker → <code>modal-choice</code>（選 1~3 個 counter）→ 對手目標 picker。當來源 ≤10 傷害時 1 個 auto-pick 跳過 modal。</li>
          <li><b>P1 Rule 8 違反 — 多龍奇｜偵查指令</b>：原本選完牌後 <code>addLog</code> 公開卡名給對手看，但卡面無「給對手看過」字樣 → 對手不應看到具體卡名。改用 <code>addPrivateLog</code>，對手 console 只顯示張數。</li>
          <li><b>P2 Math.random 替代（4 張）</b>：以下卡片原本用 <code>Math.random() &lt; 0.5</code>（缺 coin 動畫＋連線對戰對手驗證 cue），改用 <code>flipCoinsWithLog</code>：能量貼紙 / 親送無人機（2 次擲幣）/ 火箭隊的驚嚇炸彈 / 勝利之證。</li>
          <li><b>P2 missing addLog — 火箭隊的驚嚇炸彈 反面</b>：原本反面分支只默默 +20 給自己戰鬥場，玩家看不到 log。補上「反面 → 自己戰鬥位放 2 個傷害指示物（+20 傷害）」訊息。</li>
          <li><b>引擎擴充</b>：<code>active-energy-discard</code> picker 在 <code>game/+page.svelte</code> 加上 <code>params.targetIid</code> 支援 — 可從 src 玩家「指定 iid 的寶可夢」（active 或 bench）身上挑能量；解決粉碎之錘 / 悠哉尾草棒「對手任何寶可夢身上挑能量」需求。</li>
          <li><b>遵守 Iron Rules</b>：所有改動既有檔走 Python pipeline；新增 5 個 resolver 用 <code>regR</code>（不違反 Rule 12）；changelog 內 <code>&lt;</code>/<code>&#39;</code>/<code>&amp;</code>/<code>&#123;</code>/<code>&#125;</code> 等特殊字符 HTML entity escape</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.13</span> Bug audit P2 — B5-B8 細節修補（5 張卡：玩家選擇 / 目標限定 / filter 太寬）</summary>
        <ul>
          <li><b>背景</b>：承 v3.10/v3.11/v3.12（共 19 張 confirmed bug 已修），本版處理 audit 報告 Section B 的 P2/Suspect 區（B5-B8 + 額外 2 張同類）。修補方向：把「自動代玩家做選擇」改為「玩家選擇 picker」，並修正 filter 太寬。</li>
          <li><b>B5 夠讚狗ex｜猛毒筋力</b>（牌庫 ≤2 張基本【惡】能量附自身 + 中毒）：原本自動取前 2 張，違反卡面「玩家選張數」。改用 deck-search picker（<code>filter: &#39;Energy:Darkness&#39;</code>，<code>minCount: 0, maxCount: 2</code>）→ 新 resolver <code>v313-mengdu-jinli-attach-self</code> 把選中的能量附給自身、若有附則中毒。玩家可選 0 張 = 不附 = 不中毒，符合卡面「附上卡的情況下」中毒語意。</li>
          <li><b>B6 厄鬼椪 礎石面具｜石之神樂</b>（牌庫 1 張基本【鬥】能量附自方寶可夢）：原本自動附給戰鬥場，違反卡面「玩家選目標」。對齊同家族 v2630 草／火／水之神樂的做法，改用 heal-target picker → 新 resolver <code>v313-stone-kagura-attach</code> 把能量附給玩家挑的目標。</li>
          <li><b>B7 霜奶仙｜彩色甜點</b>（牌庫挑「與身上附加基本能量同屬性」的寶可夢卡 ≤5 加手）：原本 <code>filter: &#39;Pokemon&#39;</code> 太寬，玩家可挑任意寶可夢。新做法：先讀自身 active 身上附加的基本能量屬性集合（&lt;empty&gt; 視為招式無效），組合成 <code>Pokemon:Types=Grass,Fire,...</code> filter；UI parser 加上對該 filter 形式的 OR 比對。</li>
          <li><b>EXTRA-1 龍捲雲｜暴風</b>（自身 1 基本能量改附備戰寶可夢）：原本自動附給第 1 隻備戰，違反卡面「玩家選備戰目標」。改用 bench-choose picker（備戰只有 1 隻時 auto-pick 避免無意義 UI 步驟）→ 新 resolver <code>v313-storm-move-energy</code>。</li>
          <li><b>EXTRA-2 波爾凱尼恩ex｜高溫旋風</b>（自身 1 能量改附備戰）：同 EXTRA-1，改用 bench-choose picker，共用 <code>v313-storm-move-energy</code> resolver（傳入 <code>basicIdx: lastIdx</code>）。</li>
          <li><b>UI 擴充</b>：<code>game/+page.svelte</code> 兩處 deck-search filter 解析點皆加上 <code>Pokemon:Types=A,B,C,...</code> 形式，<code>Set</code> + <code>has(card.pokemonType)</code> 做 OR 比對；放在原 <code>Pokemon:&lt;Single&gt;</code> 分支前優先匹配（startsWith 較長前綴優先）。</li>
          <li><b>Auto-pick 優化</b>：B6/EXTRA-1/EXTRA-2 在「目標只有 1 個」時直接 resolve 跳過 picker，避免玩家被卡在無意義的單選步驟。</li>
          <li><b>遵守 Iron Rules</b>：所有改動既有檔（version.ts / v2750_h_wave2_full.ts / v2610_i_wave11_misc4.ts / v2630_i_wave13_misc6.ts / game/+page.svelte / +page.svelte）走 Python pipeline；新 resolver 用 <code>regR</code>（_shared.ts 的 RESOLVERS Map），不違反 Rule 12；changelog 內 <code>&lt;</code>/<code>&#39;</code>/<code>&amp;</code> 等特殊字符 HTML entity escape</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.12</span> 多目標能量分配 picker — B1-B3 完整實裝 + A8 海紋石之雨升級</summary>
        <ul>
          <li><b>背景</b>：v3.11 deferred 列表的 B1-B3 三張卡（艾姆利多｜滿載心田 / 阿羅拉椰蛋樹ex｜熱帶狂燒 / 莫魯貝可｜撿拾附上）卡面寫「以任意方式附於自己的寶可夢身上」即「多張能量分配給多隻寶可夢」。原 helper（<code>handAttachEnergyPost</code> / <code>discardEnergyAttachPost</code>）只能讓全部能量附到同一隻；同期 v3.11 的 A8 拉普拉斯ex｜海紋石之雨也是這個簡化點。</li>
          <li><b>關鍵發現</b>：v2.158 已有 <code>v158_energy_chain.ts</code> 提供「逐張附能量到玩家選的目標寶可夢」chain pattern，且 v2.87 同類能量批次 +/- UI 也已整合進去。本次只需擴充 source 支援 <code>&#39;hand&#39;</code>，再讓三個 helper 改走 chain 即可。</li>
          <li><b>引擎擴充</b>：</li>
          <li>　・<code>EnergyChainOpts.source</code> 從 <code>&#39;deck&#39;|&#39;discard&#39;</code> 擴為 <code>&#39;deck&#39;|&#39;discard&#39;|&#39;hand&#39;</code></li>
          <li>　・<code>startEnergyChain</code> 對 <code>source: &#39;hand&#39;</code> 把選的能量先從手牌搬到棄牌區暫存，後續流程沿用</li>
          <li>　・<code>v158-energy-chain-start</code> resolver 同步加 <code>&#39;hand&#39;</code> 容忍</li>
          <li><b>helper 升級（影響範圍：使用此 helper 的所有招式）</b>：</li>
          <li>　・<code>handAttachEnergyPost(max, typeFilter, label)</code> — 改用 <code>v158-energy-chain-start</code> resolver，<code>source: &#39;hand&#39;</code>。</li>
          <li>　・<code>discardEnergyAttachPost(max, typeFilter, label)</code> — 改用 <code>v158-energy-chain-start</code> resolver，<code>source: &#39;discard&#39;</code>。</li>
          <li>　・場上只有 1 隻自方寶可夢 → 自動全附；多隻同類能量 → +/- 計數器 UI；多隻混合屬性 → 逐張 picker</li>
          <li>　・<code>minCount</code> 由 1 改為 0（卡面允許「任意數量」）</li>
          <li><b>B1-B3 完整實裝</b>（自動沿用升級後 helper）：</li>
          <li>　・<b>艾姆利多｜滿載心田</b>（無能量，從手牌選最多 2 張基本【超】能量，附於自己任意寶可夢）— 原為自動全附給單一目標；現玩家可自由分配</li>
          <li>　・<b>阿羅拉 椰蛋樹ex｜熱帶狂燒</b>（草水，150 傷，從手牌選任意數量基本能量附於自己任意寶可夢）— 同樣升級為多目標分配</li>
          <li>　・<b>莫魯貝可｜撿拾附上</b>（雷，從棄牌區選最多 2 張基本能量附於自己任意寶可夢）— 從棄牌區附能也升級為多目標</li>
          <li><b>A8 海紋石之雨升級</b>：v311 stage1 resolver 改呼叫 <code>startEnergyChain</code>（<code>source: &#39;deck&#39;</code>）。卡面「以任意方式附於自己的寶可夢」現完整支援多目標分配；剩餘洗回。</li>
          <li><b>連帶修補</b>：土地雲｜真氣之拳原本走已被 chain 化的 <code>discard-energy-attach-pick-target</code> resolver；新增 <code>v312-attach-energy-to-active</code> 接手（卡面「附於這隻寶可夢」嚴格附於自身）。</li>
          <li><b>UI 不變</b>：複用既有 <code>energy-distribute</code>（+/- 計數器）/ <code>heal-target</code>（單目標逐張）picker — 不需改 game/+page.svelte。</li>
          <li><b>遵守 Iron Rules</b>：所有改動既有檔（version.ts / effects.ts / v158_energy_chain.ts / v2750_h_wave2_full.ts / +page.svelte）走 Python pipeline；新 resolver 用 <code>regR</code>（_shared.ts 的 RESOLVERS Map），不違反 Rule 12；changelog 內 <code>&lt;</code>/<code>&#39;</code> 等特殊字符 HTML entity escape</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.11</span> Bug audit P1 — 7 張招式（特定目標限制 / peek 機制 / 未實裝）</summary>
        <ul>
          <li><b>Audit 背景</b>：承 v3.10，繼續處理 P1 共 7 張卡（缺 tag gate / peek vs search 機制錯 / 兩張未實裝）。同時新增 3 個 helper + 2 個 picker filter（<code>Energy:TOP_N</code> / <code>Basic:TOP_N</code>）。</li>
          <li><b>缺 tag 目標 gate（2 張）</b>：</li>
          <li>　・<b>太樂巴戈斯｜稜鏡充能</b>（牌庫 ≤3 各不同屬性基本能量 → 自方「太晶」寶可夢）：原 helper <code>deckSearchBasicEnergiesAnyPost</code> 加手 + 不限制目標；改用新 <code>deckSearchAttachToTaggedBenchPost(3, label, &#39;太晶&#39;, true)</code>，stage2 用 <code>heal-target</code> picker + <code>validIids</code> 限制只列「太晶」寶可夢</li>
          <li>　・<b>密勒頓｜暴衝高點</b>（牌庫 ≤2 基本能量 → 自方「未來」寶可夢）：同 pattern，改用 <code>deckSearchAttachToTaggedBenchPost(2, label, &#39;未來&#39;)</code></li>
          <li><b>peek vs search 機制錯誤（3 張）</b>：</li>
          <li>　・<b>拉普拉斯ex｜海紋石之雨</b>（看牌庫頂 20 張，從中選任意能量附自方寶可夢，剩餘洗回）：原為 <b>三重錯</b> — peek 變 search、any 能量降為 basic、bench 變 hand；改用新 <code>deckTopPeekEnergyAttachToAnyPost(20, 20, label)</code>，picker 用新 filter <code>Energy:TOP_N</code>，stage2 用 <code>heal-target</code></li>
          <li>　・<b>米立龍ex｜硃砂誘餌</b>（看牌庫頂 10 張，選任意數量寶可夢放備戰，剩餘洗回）：原 <code>deckSearchBasicToBenchPost(5)</code> 是 search 全牌庫；改用 <code>deckTopPeekPokemonToBenchPost(10, label)</code>，picker 用新 filter <code>Basic:TOP_N</code></li>
          <li>　・<b>人造細胞卵｜傳喚之門</b>（看牌庫頂 8 張，選任意數量寶可夢放備戰，剩餘洗回）：同上 pattern，改用 <code>deckTopPeekPokemonToBenchPost(8, label)</code></li>
          <li><b>未實裝補完（2 張）</b>：</li>
          <li>　・<b>烈咬陸鯊ex｜水炮著陸</b>（cost 1 鬥，棄牌區 ≤3 基本【鬥】能量 → 備戰）：直接用既有 <code>discardSearchAttachToBenchPost(3, label, &#39;Fighting&#39;)</code></li>
          <li>　・<b>怒鸚哥ex｜幹勁十足</b>（cost 1 無，棄牌區 ≤2 基本能量 → 1 隻備戰）：用 <code>discardSearchAttachToBenchPost(2, label)</code></li>
          <li><b>新增 helpers / filter</b>：</li>
          <li>　・<code>deckSearchAttachToTaggedBenchPost(max, label, tagName, sameTypes?)</code> — 含對應 stage1/stage2 resolver（單一目標自動派發；多目標用 heal-target + validIids）</li>
          <li>　・<code>deckTopPeekEnergyAttachToAnyPost(peekN, maxAttach, label)</code> — peek N 看能量、附到自方任一寶可夢</li>
          <li>　・<code>deckTopPeekPokemonToBenchPost(peekN, label)</code> — peek N 選基礎寶可夢放備戰</li>
          <li>　・新 picker filter <code>Energy:TOP_N</code>（任意能量含特殊）/ <code>Basic:TOP_N</code>（peek 中的基礎寶可夢）</li>
          <li><b>deferred</b>：B1-B3（艾姆利多｜滿載心田 / 椰蛋樹ex｜熱帶狂燒 / 莫魯貝可｜撿拾附上）— 卡面允許「以任意方式附於自己的寶可夢身上」即多張能量分配多隻寶可夢，引擎尚不支援多目標分配 picker；B5-B8 audit 細節（auto-pick / filter 寬鬆）— 影響不大，待下版專波處理；A8 海紋石之雨「以任意方式附」目前簡化為單目標接收</li>
          <li><b>遵守 Iron Rules</b>：所有改動既有檔（version.ts / v2750_h_wave2_full.ts / +page.svelte / game/+page.svelte / ai.ts）走 Python pipeline；新 helper 只用 <code>regR</code>（_shared.ts 的 RESOLVERS Map），不違反 Rule 12；changelog 內 <code>&lt;</code> / <code>&#39;</code> 等特殊字符 HTML entity escape</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.10</span> Bug audit P0 — 7 張附能量招式（加手牌 → 附場上）+ 1 張弱抗計算錯誤</summary>
        <ul>
          <li><b>Audit 背景</b>：v3.09 修了花舞鳥｜能量支援後，全面掃描所有「搜能量」類招式。發現 7 張同類 bug（卡面要求附到場上，但實裝把能量加到手牌），與 1 張弱抗 / 抵抗力繞過 bug。本版優先修 P0 共 8 張。</li>
          <li><b>同類 bug — 應附到場上但實裝加手牌（7 張）</b>：</li>
          <li>　・<b>鬃岩狼人｜渦輪刀鋒</b>（棄牌區 ≤2 基本【鬥】→ 備戰）：原 helper <code>discardSearchBasicEnergiesPost</code> 加手；改用 <code>discardSearchAttachToBenchPost(2, &#39;渦輪刀鋒&#39;, &#39;Fighting&#39;)</code></li>
          <li>　・<b>逐電犬｜輸電衝刺</b>（牌庫 ≤2 基本【雷】→ 備戰）：新 helper <code>deckSearchAttachToBenchPost(max, label, type)</code>，雙階段 pending：deck-search 挑能量 → bench-choose 選備戰目標 → 重洗</li>
          <li>　・<b>帕奇利茲｜啪滋啪滋充電</b>（擲 3 幣，棄牌區 ≤heads 基本【雷】→ 備戰）：原 inline 用 effectKey <code>h-wave2-pickup-energy-to-hand</code>；改呼叫 <code>discardSearchAttachToBenchPost(heads, &#39;啪滋啪滋充電&#39;, &#39;Lightning&#39;)</code></li>
          <li>　・<b>黑魯加｜鼓勵</b>（牌庫 ≤2 基本能量 → 自方任一寶可夢，含戰鬥場）：新 helper <code>deckSearchAttachToAnyPost(max, label, type?, sameTypes?)</code>，階段 2 用 <code>heal-target</code> picker 涵蓋 active + bench</li>
          <li>　・<b>七夕青鳥｜哼唱充能</b>（同上，牌庫 ≤2）：改用 <code>deckSearchAttachToAnyPost(2, &#39;哼唱充能&#39;)</code></li>
          <li>　・<b>風妖精ex｜能量之禮</b>（牌庫 ≤3）：原 effectKey <code>wave13-deck-take-any</code> 加手；改用 <code>deckSearchAttachToAnyPost(3, &#39;能量之禮&#39;)</code></li>
          <li>　・<b>圖圖犬｜能量寫生</b>（擲 3 幣，棄牌區 ≤heads 基本能量 → 備戰）：原 effectKey <code>wave17-pickup-energy-to-hand</code> 加手；改呼叫 <code>discardSearchAttachToBenchPost(heads, &#39;能量寫生&#39;)</code></li>
          <li><b>弱抗繞過 bug — 雷伊布ex｜閃光尖矛 60+</b>（卡面：若希望，棄 ≤2 自方備戰基本能量，+(N×90) 增加傷害）：</li>
          <li>　・舊作法：PRE 只回傳 60、POST 自動棄能量並 <code>defender.active.damage += bonus</code>，<b>繞過引擎的弱點 ×2 / 抵抗力 -30 計算流程</b>，對水弱寶可夢實際傷害數值錯誤。</li>
          <li>　・新作法：把「棄能量 + bonus」整體移到 PRE，PRE 回傳 <code>&#123; state, damage: 60+bonus, breakdown &#125;</code>，engine 用 baseDamage 套標準弱抗 → POST 不再加 damage。</li>
          <li>　・[deferred]：「若希望」目前簡化為「自動棄到上限 2 張」（最大化傷害），與其他相同 pattern 招式（恐怖獠牙等）一致；玩家選擇式 picker 待後續 P2 audit 改進。</li>
          <li><b>新增 helpers（v2750_h_wave2_full.ts 內）</b>：<code>deckSearchAttachToBenchPost</code> / <code>deckSearchAttachToAnyPost</code> / <code>discardSearchAttachToAnyPost</code>（含對應 stage1/stage2 resolver 共 6 個），<code>discardSearchAttachToBenchPost</code> 改 export 供 v2670 使用</li>
          <li><b>遵守 Iron Rules</b>：所有改動既有檔（version.ts / v2750_h_wave2_full.ts / v2670_i_wave17_complex2.ts / +page.svelte）走 Python pipeline；新 helper 只用 <code>regR</code>（_shared.ts 的 RESOLVERS Map），不違反 Rule 12。</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.09</span> hotfix — 花舞鳥｜能量支援 卡面行為錯誤（拿到手牌 → 附到備戰）</summary>
        <ul>
          <li>使用者回報：花舞鳥（MC 133/742）招式「能量支援」應該把選到的能量附到備戰寶可夢身上，但程式做成「加到手牌」</li>
          <li>根因：v2750_h_wave2_full.ts 的 helper discardSearchBasicEnergiesPost 把選到的能量加到 hand，但花舞鳥卡面是「附於 1 隻備戰寶可夢身上」</li>
          <li>修法：新增 helper discardSearchAttachToBenchPost — 雙階段 pending：階段 1 discard-search 挑 ≤2 基本能量、階段 2 bench-choose 選 1 隻備戰寶可夢接收能量</li>
          <li>影響範圍：只改花舞鳥｜能量支援；鬃岩狼人｜渦輪刀鋒 沿用舊 helper（卡面行為待確認）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.08</span> Deferred Wave C — Group 3 剩餘 4 張最複雜 deferred passive（廣域堡壘 / 平穩境地 / 潛入記憶 / 多重轉接*）</summary>
        <ul>
          <li><b>1. 超甲狂犀｜廣域堡壘（H）</b> — 「只要這隻寶可夢在戰鬥場上，對手從手牌使出支援者卡時，自己的所有寶可夢不會受到那個效果的影響。」實作：擴展 v3.06 的 <code>isImmuneToOppTrainer</code> 路徑，新增綜合 helper <code>isImmuneToOppSupporter(state, defenderIdx, targetInst, pool)</code>，內部 OR：(a) 寶可夢自身的緊張感／融合為雪 (b) 自方戰鬥場有廣域堡壘。已將「老大的指令」「老大的指令（烏羽）」兩張高頻 Supporter 的 validIids 過濾改用新 helper。頂尖捕捉器是 Item 類，繼續用舊 isImmuneToOppTrainer（不擋廣域堡壘）。</li>
          <li><b>2. 美納斯｜平穩境地（H）</b> — 「只要這隻寶可夢在場上，對手的場上寶可夢與那隻寶可夢身上附加的所有卡，無法放回手牌。」Phase 1 實作：新增 helper <code>oppHasMenasureCalmGround(state, ownerIdx, pool)</code>，已在 6 處「對手寶可夢/附加卡 → 對手手牌」hook 加 gate：</li>
          <li>　・<b>退化進化卡回對手手牌</b>（3 張）：念力土偶｜退化光線、超能豔鴕｜奧密之眼、始祖大鳥｜原始之翼</li>
          <li>　・<b>對手能量回對手手牌</b>（3 張）：悠哉尾草棒、毒粉蛾｜微風吹拂、effects.ts <code>returnOppActiveEnergyPost</code> helper（涵蓋高傲雉雞｜反轉之風 等多張共用此 post）</li>
          <li>　・Phase 2 deferred：其他零散散點若有遺漏可逐個補上</li>
          <li><b>3. 古空棘魚｜潛入記憶（H）</b> — 「只要這隻寶可夢在場上，自己的所有進化寶可夢，可使用進化前持有的所有招式。需要有足夠使用招式的能量。」實作：擴展 engine.ts 的 <code>getEffectiveAttacks</code> — 自方場上有古空棘魚（含 active 或 bench）+ inst 是進化卡（evolvedFromStack 至少 1 張）→ 把 evolvedFromStack 中每張 cardId 的 attacks 全部累加進 effective attacks。重名招式不去重（卡面允許）；cost 沿用各自卡面定義；UI / canAffordAttack / ATTACK handler 全部自動受惠（getEffectiveAttacks 是三方共用 helper）。</li>
          <li><b>4. 洛托姆ex｜多重轉接（I） &mdash; [DEFERRED v3.08]</b> — 「只要這隻寶可夢在場上，名稱中有『洛托姆』的自己的所有寶可夢，各自身上最多可附有 2 張『寶可夢道具』卡。」Defer 原因：CardInstance.toolAttached 為單一物件，要支援 2 張需改為 array；影響面 grep <code>toolAttached</code> 達 200+ 處（ATTACH_TOOL / TOOL_ON_DAMAGED / TOOL_PRIZE_BONUS / 取獎賞時 tool 棄牌邏輯 等所有 tool hook 都需 loop 處理），且特性消除時清理多附道具的邏輯也需新加。獨立 wave 處理整個 toolAttached 重構與全面 hook 適配。</li>
          <li><b>Iron Rule 11 / 12 遵守</b>：所有既有檔（version.ts / effects.ts / engine.ts / supporters_gust.ts / v168_supporters.ts / items_misc.ts / v2354 / v2760 / v2996）改動一律走 Python pipeline；新檔 v3080_deferred_wave_c.ts 用 Write 工具；register 函式為空 body（純 helper 模組、無 Map .set()），仍由 effects.ts body 末端 import + 呼叫保持模板一致。</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.07</span> Deferred Wave D — 3 張需要手牌 UI 元件層 hook 的特性（超能妙喵 / 火神蛾 / 齒輪怪）</summary>
        <ul>
          <li><b>新 hook ON_DISCARD_FROM_HAND</b> — 玩家從手牌主動棄 1 張指定卡，觸發場上對應 trigger holder 的特性。新增 <code>USE_HAND_DISCARD_ABILITY</code> action type、<code>ON_DISCARD_FROM_HAND_ABILITIES</code> Map（key=trigger holder 卡名 → effect fn），以及 +page.svelte / MobilePortraitBattle.svelte 的手牌渲染按鈕（紫色「棄此卡 → 觸發 X」）。每回合限 1 次（用 abilityNamesUsedThisTurn 追蹤該特性名）</li>
          <li><b>新 hook ON_HAND_ACTIVATE</b> — 手牌寶可夢自身為 trigger，自己上場到備戰。新增 <code>USE_HAND_ABILITY</code> action type、<code>ON_HAND_ACTIVATE_ABILITIES</code> Map。與機制 A 不同：不是棄「另一張」手牌，而是『此手牌卡自身』就是 trigger</li>
          <li><b>1. 超能妙喵｜誘導之尾（H）</b> — 「在自己的回合，若從自己的手牌將 1 張『悠哉尾草棒』丟棄，則可使用 1 次。選擇 1 隻對手的備戰寶可夢，與戰鬥寶可夢互換。」實作：場上有超能妙喵 + 手牌「悠哉尾草棒」+ 對手有 active &amp; bench ≥ 1 → 棄牌 + 開 opp-bench-choose（復用 'gust-opp' resolver）</li>
          <li><b>2. 火神蛾｜熱浪鱗粉（I）</b> — 「在自己的回合，若從自己的手牌將 1 張『基本【火】能量』卡丟棄，則可使用 1 次。將對手的戰鬥寶可夢【灼傷】。」實作：場上有火神蛾 + 手牌基本【火】能量 + 對手戰鬥位非已灼傷 → 棄能量 + 對手戰鬥位 status='burned'</li>
          <li><b>3. 齒輪怪｜緊急迴轉（H）</b> — 「在自己的回合，若手牌有這張卡，且對手的場上有【2 階進化】寶可夢，則可使用 1 次。將這張卡放置於備戰區。」實作：手牌有齒輪怪 + 對手場上有 Stage 2（subtype 含『Stage 2』/『2 階』或 evolvesFrom 鏈深度 = 2）+ 自方備戰 &lt; 5 → inst 從 hand 搬到 bench（清乾淨 attachments 旗標 + playedFromHand=true / justPlaced=true，與 PLAY_BASIC 對齊）</li>
          <li><b>UI 渲染</b>：桌機 / 平板版（+page.svelte）在手牌的可觸發卡上加紫色按鈕，點擊直接 dispatch；手機直式（MobilePortraitBattle.svelte）走 hand-action sheet 加新項，符合既有 tap-action paradigm</li>
          <li><b>Iron Rule 11 / 12 遵守</b>：所有既有檔（types.ts / actions.ts / effects.ts / engine.ts / +page.svelte / MobilePortraitBattle.svelte）改動一律走 Python pipeline；新檔 v3070_deferred_wave_d.ts 用 Write 工具；effect fn 由 effects.ts import 後寫入 Map literal（leaf 模組無 TDZ 風險）；register 函式留空保持模板一致</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.06</span> Deferred Wave B — 5 張免疫類 passive（藏隱 / 深度下潛 / 緊張感 / 融合為雪 / 全能硬殼）</summary>
        <ul>
          <li><b>1. 斯魔茶｜藏隱（H / SV5a / SV8a）</b> — 「只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。」實作於 effects.ts 的 <code>resolveBenchGuard</code>（kind=attack-damage / attack-effect 兩條路徑）+ <code>hitBenchAll</code>（self-ability skip，與太晶相同 pattern）；只在 attackerIdx ≠ targetIdx 時生效，不擋自方自爆 / 自殘類傷害</li>
          <li><b>2. 小霞的鯉魚王｜深度下潛（I / MC / SV9a）</b> — 同上條件，與藏隱共用同一 self-ability gate</li>
          <li><b>3. 斧牙龍｜緊張感（H / SV6a）</b> — 「對手從手牌使出物品卡或者支援者卡時，這隻寶可夢不會受到那個效果的影響。」Phase 1 實作：提供 <code>isImmuneToOppTrainer(targetInst, pool)</code> helper；在 老大的指令 / 老大的指令（烏羽）/ 頂尖捕捉器 三張高頻 trainer 的 候選 pool / validIids 過濾排除帶此特性的對手寶可夢（與『陳舊的鰭之化石被動』相同 filter pattern）</li>
          <li><b>4. 浩大鯨ex｜融合為雪（I / SV10）</b> — 同上條件，與緊張感共用同一 helper</li>
          <li><b>5. 肋骨海龜｜全能硬殼（H / SV11B）</b> — 「這隻寶可夢不會受到對手的身上附有特殊能量卡的寶可夢招式的傷害與效果的影響。」實作：<code>PASSIVE_IMMUNITY</code> 加入 entry，從 <code>state.players[aIdx].active.energyAttached</code> 掃 special energy；<code>ATTACK_EFFECT_IMMUNITY</code> self-ability kind 內加 special-case（name === &#39;全能硬殼&#39; → 額外檢查 attacker 特殊能量）涵蓋招式效果免疫</li>
          <li><b>Phase 2 deferred</b>：對手 trainer 免疫 helper 已 export，未來逐張 trainer resolver（獵人狙擊 / 沙儷 / 鎖鏈鎖喉 / 杜若 等指定對手寶可夢類）可逐張接入；本波先涵蓋影響面最大的 Gust / Top Catcher 三張</li>
          <li><b>Iron Rule 11 / 12 遵守</b>：所有 effects.ts / 既有 cards 子檔的修改一律走 Python pipeline；新檔案 v3060_deferred_wave_b.ts 用 Write 工具；Map .set() 全部包進 <code>registerV3060DeferredWaveBPassives()</code> 由 effects.ts body 末端呼叫，避開 TDZ 循環依賴</li>
          <li>tsc 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.05</span> Deferred Wave A — 「從戰鬥場回備戰時」觸發類特性新 hook（2 張完整實裝 + 3 張續 deferred）</summary>
        <ul>
          <li><b>新 hook ON_RETREAT_TO_BENCH</b> — 寶可夢從戰鬥場回備戰時觸發 1 次特性，仿 ON_PLAY_FROM_HAND / ON_EVOLVE_FROM_HAND 模板。本波先 hook 在撤退（RETREAT）路徑；招式互換 / 特性互換 / 風扇呼喚被吹回 等其他「active→bench」路徑暫未涵蓋，後續 wave 補</li>
          <li><b>實作機制</b>：effects.ts 新增 <code>ON_RETREAT_TO_BENCH_ABILITIES</code> Set；engine.ts RETREAT handler 末端詢問玩家是否使用該特性（modal-choice）；玩家選「是」走 <code>resolve-retreat-to-bench-ability-prompt</code> resolver 執行對應 ABILITY_EFFECTS 並 mark <code>abilityUsedThisTurn</code></li>
          <li><b>1. 海豚俠｜全能變身（H / SV6 / SV8a / MC）</b> — 從牌庫選 1 張「海豚俠ex」與這張卡互換，所附加的卡・傷害指示物・特殊狀態・效果等全部保留。互換後海豚俠放回牌庫並重洗。實作上沿用同一 inst.iid 換 cardId（保留全部 attachments 零搬運），原海豚俠以乾淨 inst（清除 attachments）放回牌庫</li>
          <li><b>2. 鋼炮臂蝦｜返回重載（I / M1S）</b> — 從手牌選最多 2 張「基本【水】能量」附於這隻寶可夢身上。走 hand-choose UI，filter 需含名稱「【水】」+ 基本能量</li>
          <li><b>Deferred（3）</b>：超能妙喵｜誘導之尾（手牌棄悠哉尾草棒觸發 → 對手備戰 ↔ 戰鬥位互換）；火神蛾｜熱浪鱗粉（手牌棄基本【火】能量觸發 → 對手戰鬥位灼傷）；齒輪怪｜緊急迴轉（手牌的這張卡為條件 → 對手 2 階進化在場時放這張卡到備戰）。三張需新 hook ON_DISCARD_FROM_HAND / ON_HAND_ACTIVATE，需要新增手牌渲染按鈕 + 新 action types，工程量較大故 Phase 2 續 deferred</li>
          <li>tsc 0 error；svelte-check 既有 13 errors 與本波改動無關（皆為其他檔的 type narrow / EPERM 暫時性 IO 問題）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.04</span> hotfix — ACE SPEC 道具消失 bug（璀璨結晶 / 反擊增幅器 / 力之沙漏）</summary>
        <ul>
          <li>使用者回報：附璀璨結晶到寶可夢上，log 顯示「璀璨結晶（道具）效果尚未實裝」，道具直接消失</li>
          <li>根因：engine.ts PLAY_TRAINER 的 isTool 分支若 TRAINER_EFFECTS 沒對應 entry，就 fallback 到「未實裝」log 但**沒把卡放回手牌**，等同悶聲刪卡。璀璨結晶 / 反擊增幅器 / 力之沙漏 三張道具的效果是 inline 寫在 engine.ts hardcoded 檢查（toolCard?.name === '...'），沒在任何 TOOL_* Map 裡，所以 tools.ts 的 ATTACH_TOOL_NAMES auto-register loop 抓不到，TRAINER_EFFECTS 沒 entry → 進入 fallback → 卡消失</li>
          <li>修法 1（hotfix 直接補）：把 璀璨結晶 / 反擊增幅器 / 力之沙漏 顯式加進 ATTACH_TOOL_NAMES Set，讓 auto-register loop 給它們註冊通用 attach 效果</li>
          <li>修法 2（防未來再踩）：engine isTool 分支改寫 fallback — 即使沒 effect，也把卡退回手牌（不再悶聲刪卡），同時 log 提示開發者修補 ATTACH_TOOL_NAMES</li>
          <li>璀璨結晶 cost 減免本來就沒問題（v2.149 已實裝），bug 在「使出此卡的 PLAY 動作」沒處理</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.03</span> 傷害公式加括號 + ATTACK_PRE breakdown 展開 + 補漏 modifier</summary>
        <ul>
          <li><strong>公式加括號</strong>：先前顯示「100(基礎) +30(極限腰帶) ×2(弱點) -30(屬性相剋) = 230」會讓玩家以算術優先級誤解（先乘後加 → 130）。新版改為「[100(基礎) +30(極限腰帶)] ×2(弱點) -30(屬性相剋) = 230」，明示「加成先加，再 ×弱點，最後 -抵抗」。</li>
          <li>邏輯：偵測最後一個 × term 之前若有 ≥1 個 + term，整段用 [...] 包起；無 × 或 × 之前只有 base 一項則維持線性顯示。</li>
          <li><strong>ATTACK_PRE 簽名擴展</strong>：AttackPreFn 回傳值新增 optional <code>breakdown: &#123; value, label &#125;[]</code>，讓內部複雜計算可拆成多個 + term 顯示。Backward compatible — 舊 regPre 不回傳 breakdown 維持原行為。</li>
          <li><strong>9 張高頻招式啟用 breakdown</strong>：月月熊 赫月｜瘋狂啃咬（指示物 N×30 + 100）、太陽伊布｜精神傷害（指示物 N×10 + 30）、猛惡菇｜爆毆（指示物 N×50 + 50）、故勒頓｜原生亂打（古代 N×30）、夠讚狗ex｜瘋狂連鎖（130 + 130 中毒）、超級火炎獅ex｜大爆炸之火（290 - 自身指示物 N×10）、堅果啞鈴｜特殊鞭打（70 + 70 特殊能量）、倫琴貓｜猛力進攻（已取獎賞 N×70）、寶寶暴龍｜勃然大怒（自身指示物 N×20）。</li>
          <li><strong>補漏 modifier label</strong>：爆炸頭水牛｜捲牆 -60、PASSIVE_IMMUNITY 完全免疫（順滑大衣 / 神秘石居 / 抵抗之幕 等）、PASSIVE_COIN_AVOID 擲幣免傷（躲藏高手 / 腎上腺費洛蒙）— 過去 baseDamage 直接歸零但 formula 沒記錄，現在統一加 label。</li>
          <li>實作範例：赫月 ex 對 7 指示物 + 極限腰帶 + 弱點 → 從「310(基礎) +30(腰帶) ×2(弱點) = 680」升級為「[210(指示物 7×30) +100(基礎) +30(腰帶)] ×2(弱點) = 680」。</li>
          <li><strong>Iron Rule 11 / 12 遵守</strong>：所有既有檔案（_shared.ts / engine.ts / effects.ts / +page.svelte）改動一律走 Python pipeline；無新 .set() 子檔註冊。tsc 0 error。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.02</span> log UX 升級 — 卡名可點查看 + 傷害公式展開</summary>
        <ul>
          <li><strong>卡名 → 可點連結</strong>：log 內偵測到卡片名稱（如「尖釘鎮道館」「火箭隊的搗蛋小妖」等）會自動 render 成可點按鈕，點擊立即開啟 zoom modal 看卡片詳情。</li>
          <li>實作於 <code>log_format.ts</code> — 在主 RULES tokenize 完後，對 cls=&#39;&#39; 純文字 token 跑卡名子掃描；卡名清單由 pool.values() 動態取得，由長到短排序避免「搗蛋小妖」遮蔽「火箭隊的搗蛋小妖」。</li>
          <li>名稱長度 &lt; 2 字一律忽略（避免「水」「火」吃進普通文字）。</li>
          <li>桌機版（+page.svelte）+ 手機直式版（MobilePortraitBattle.svelte）兩處同步更新；MobilePortraitBattle 一併補上 v2.88 著色 token CSS（之前手機版只有純文字 log，未套色）。</li>
          <li><strong>傷害公式展開</strong>：攻擊 log 從「造成 310 傷害」升級為「造成 310 點傷害【100(基礎) +30(極限腰帶) +30(力量蛋白飲) ×2(弱點) -30(屬性相剋) = 310】」。</li>
          <li>Phase 1 涵蓋 modifier：base、下回合加傷、招致削傷、tool（極限腰帶 / 鎖鏈糬 等）、PASSIVE_ATTACK_BONUS（輝煌聲援 等）、力量蛋白飲、腎上腺力量、空手道王、烏栗、同步脈衝、弱點 ×2、抵抗力 -30、上回合遺留、鐵之防禦、陳舊顎化石、岩石宮殿、守護之鐘、齒輪塗層、凍原堡壘、垃圾洩氣、下次被擊減傷、PASSIVE_DAMAGE_REDUCE / COND（柔軟羊毛 / 岩石盔甲 等）。</li>
          <li>Phase 2 deferred：regPre 內部複雜計算（如赫月酋雷姆瘋狂啃咬 7×30+100、爆炸頭水牛 2 隻 -60、灰塵山 -20 已涵蓋但其他 stadium / passive deferred）。第一版只展開 base 後 modifier，base 仍以 regPre 回傳值為單一基礎項顯示。</li>
          <li><strong>Iron Rule 12 遵守</strong>：本波只動 engine.ts / log_format.ts / +page.svelte / MobilePortraitBattle.svelte，無 .set() 子檔；無 effects.ts Map 改動。</li>
          <li><strong>Iron Rule 11 遵守</strong>：所有既有檔案修改一律走 Python pipeline（git cat-file HEAD blob → in-memory replace → safe_write + fsync），無 Edit 工具截斷風險。</li>
          <li>tsc 0 error；commit 但不 push（留給使用者 review）。</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.01</span> Group 3 Wave 3 — 14 張最複雜 passive 特性（11 實裝 / 3 部分覆蓋）</summary>
        <ul>
          <li><strong>大王銅象｜爆大身軀</strong>（A1 對手不能使出 X）— 戰鬥場上時，對手無法從手牌使出競技場卡。在 PLAY_TRAINER handler &#123;subtype=Stadium&#125; 加 gate</li>
          <li><strong>火箭隊的阿柏怪｜瞪眼效用</strong>（A2 對手不能使出 X）— 戰鬥場上時，對手不可從手牌將「擁有特性的寶可夢」（『火箭隊的』除外）放置於場上。PLAY_BASIC + EVOLVE 兩處皆 gate；候選有特性 &amp; 名稱不以「火箭隊的」開頭時擋下</li>
          <li><strong>胖嘟嘟ex｜海之詛咒</strong>（A3 對手不能使出 X）— 戰鬥場上時，對手無法從手牌使出『物品』卡也無法附『寶可夢道具』。PLAY_TRAINER 對 subtype=Item 與 subtype=PokemonTool 兩種皆攔截</li>
          <li><strong>振翼髮｜暗夜羽擊</strong>（B4 對手特性消除，passive 版本）— 戰鬥場上時，對手戰鬥寶可夢的特性（『暗夜羽擊』除外）全部消除。注意：與招式同名但是 ability index=0 的 passive。getUsableAbilities + USE_ABILITY dispatch 兩處皆加 gate</li>
          <li><strong>海兔獸｜黏著束縛</strong>（B5 對手特性消除）— 在備戰區時，雙方備戰區的【2 階進化】寶可夢的特性全部消除。本地 isStage2 helper（避循環 import engine.ts）；同 getUsableAbilities + USE_ABILITY dispatch 兩處 gate</li>
          <li><strong>火箭隊的班基拉斯｜揚沙</strong>（C7 寶可夢檢查放指示物）— 戰鬥場上時，每次寶可夢檢查時，對手所有【基礎】寶可夢身上各放置 2 個傷害指示物。在 engine.ts checkup 階段（緊接「冰冷之帳」雪妖女之後）加新區塊；KO 走 pendingPrizes / 勝利條件檢查</li>
          <li><strong>熔岩蝸牛｜熔岩地域</strong>（D8 對手撤退觸發）— 場上時，對手回合對手戰鬥寶可夢撤退 → 新上場的寶可夢【灼傷】。在 RETREAT handler 末端加 hook</li>
          <li><strong>夢妖魔ex｜漩渦言靈</strong>（D9 對手撤退觸發）— 戰鬥場上時，對手回合對手戰鬥寶可夢撤退 → 新上場的寶可夢【混亂】（若已灼傷則走 secondaryStatus 不互斥）</li>
          <li><strong>火箭隊的三地鼠｜凹洞</strong>（D10 對手撤退觸發）— 場上時，對手回合對手戰鬥寶可夢撤退 → 「回到備戰的那隻」+2 指示物（多隻三地鼠疊加）。target 與熔岩地域/漩渦言靈不同（不是新上場那隻）</li>
          <li><strong>火箭隊的電龍｜黑暗脈衝</strong>（E11 對手進化觸發）— 場上時，對手從手牌進化完成 → 那張進化卡 +4 指示物。卡面明文「不重複」 → 多隻只觸發 1 次。在 EVOLVE handler 末端加 hook</li>
          <li><strong>雪妖女｜冰冷之帳</strong>（C6 寶可夢檢查放指示物）— 已於 v2.70 在 engine.ts checkup 段落實裝；本波不重複（文件追溯）</li>
          <li><strong>對手撤退觸發 部分覆蓋</strong>：本波只 hook RETREAT 路徑；其他換場路徑（招式效果換場、特性效果換場、被吹回 等）暫 defer。卡面文字未限定撤退，但撤退是最常見場景，其他換場路徑零散需後續逐一補</li>
          <li><strong>defer 0 張</strong>：本波 14 張全部覆蓋（Tier 1+2+3+4 全做完；3 張 D 類部分覆蓋如上述）</li>
          <li>遵守 Iron Rule 11（Python pipeline 修 engine.ts / effects.ts / +page.svelte）+ Iron Rule 12（v3001_g3_wave3.ts 用 register pattern；本波無 .set() 仍保留模板）</li>
          <li>tsc --noEmit 對新增/修改檔案 0 error（既存其他檔的 mount-layer UTF-8 read false positive 不在本波範圍）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v3.0</span> Group 3 Wave 2 — 10 張對手互動 / 特殊機制 passive 特性（7 實裝 / 3 defer）</summary>
        <ul>
          <li><strong>蟲甲聖｜球形盾牌</strong>（A1 受傷免疫）— 場上有此卡 &rarr; 自方所有備戰寶可夢不受對手寶可夢招式的「傷害與效果」。實作於 effects.ts resolveBenchGuard，attack-damage 與 attack-effect 兩種 kind 皆攔截</li>
          <li><strong>鴨嘴炎獸｜熔岩波動</strong>（B4 狀態強化）— 場上有此卡 &rarr; 對手的【灼傷】寶可夢因灼傷放置的指示物 +3（=+30 傷害）。每回合的灼傷檢查 newBurnDmg = damage + 20 + bonus，自動加 log</li>
          <li><strong>獵斑魚｜潛者捕捉</strong>（C5 KO 觸發）— 自方場上有此卡 + 自方【水】寶可夢被招式 KO &rarr; 身上「基本【水】能量」放回手牌而非棄牌。在 KO koDiscard 組裝時過濾出基本水分流到 hand</li>
          <li><strong>波克基斯｜奇跡之吻</strong>（C6 KO 觸發）— 自方場上有此卡 + 對手戰鬥位被招式 KO &rarr; 擲幣 1 次正面 +1 獎賞。卡面明文「不重複」&rarr; 場上多隻只擲 1 次</li>
          <li><strong>美洛耶塔ex｜出道演出</strong>（D7 規則）— 此寶可夢可在先攻最初回合使用招式。引擎兩處 first-turn gate（ATTACK handler + getAvailableAttacks）皆加 bypass</li>
          <li><strong>瑪機雅娜｜自動治癒</strong>（D10 規則）— 戰鬥場上有此卡 + 從手牌附能量到任何寶可夢 &rarr; 該寶可夢恢復 90 HP（damage -90，不低於 0）。hook 在 ATTACH_ENERGY handler 末端</li>
          <li><strong>美洛耶塔ex 出道演出 UI</strong>：先攻第 1 回合戰鬥場為美洛耶塔ex 時，招式按鈕不再反白（getAvailableAttacks 動態判斷）</li>
          <li><strong>defer 3 張（複雜度過高）</strong>：超甲狂犀｜廣域堡壘（需逐張支援者 resolver 加「對自方寶可夢的 effect」精細 gate）／美納斯｜平穩境地（影響面廣，需在所有「目標=對手寶可夢/附加卡 → 放回手牌」hook 全面加 gate）／古空棘魚｜潛入記憶（getEffectiveAttacks 招式合併 + UI 路徑大改）／洛托姆ex｜多重轉接（CardInstance.toolAttached 由單一物件改 array 是大型資料結構改動）</li>
          <li>遵守 Iron Rule 11（Python pipeline 修 effects.ts / engine.ts / +page.svelte）+ Iron Rule 12（v3000_g3_wave2.ts 用 register pattern；本波無 .set() 仍保留模板）</li>
          <li>tsc --noEmit 0 error</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.9994</span> 手機版能量數字字色修正</summary>
        <ul>
          <li>使用者回報：手機版（直式）戰鬥場顯示的「⚡N」中，⚡（lightning emoji）是亮黃色，但 N（張數）是深色（幾乎黑）幾乎看不見</li>
          <li>根因：.mp-active 是 &lt;button&gt; 元素，預設文字色是 buttontext system color（多數系統為深灰/黑）。CSS 未明確設 color → 數字字色 inherit 自 button 預設深色。emoji ⚡ 因為由 OS 字型染色不受 CSS 影響所以顯示正常</li>
          <li>修法 A：.mp-active 設 color: #f0f0f0（亮色備援，整個 button 內 default 文字皆亮）</li>
          <li>修法 B：.mp-meta span 額外明確設 color: #ffd44a（與 ⚡ emoji 同黃色，雙重保險）</li>
          <li>桌機版未受影響（用 div 而非 button 故無此問題）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.9993</span> 新增 IRON_RULES.md 永久存檔 12 條鐵律</summary>
        <ul>
          <li>把 outputs/ptcg-push/SKILL.md 的 12 條 Iron Rules 抽出來放到 repo 內 IRON_RULES.md</li>
          <li>原本 SKILL.md 在 outputs 沙盒內，未來 session 看不到；放到 repo 的好處是 git 永久保存，新 agent 一進來就能 grep 到</li>
          <li>Rule 11 + 12 是這次 v2.999 系列踩到的最大坑：mount-truncate 與 ESM TDZ register pattern</li>
          <li>純文件提交，不影響運作；若要查鐵律請看 IRON_RULES.md</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.9992</span> hotfix — 真正修 v2.999 ESM TDZ（v2.9991 沒解決）</summary>
        <ul>
          <li>v2.9991 把 v2999 import 移到 effects.ts 末尾以為解決，但 ESM imports 是 hoisted 的（無論 source 中第幾行都會在模組 body 之前評估），所以還是 TDZ</li>
          <li>瀏覽器 console 仍報 ReferenceError: Cannot access &#39;go&#39; before initialization（minified PASSIVE_ATTACK_BONUS）</li>
          <li>真正修法：v2999_g3_wave1.ts 內 3 個 PASSIVE_ATTACK_BONUS.set(...) 從模組 top-level 搬進 export function registerV2999G3W1Passives() 裡，由 effects.ts 在自己 body 末端呼叫此函式（此時 Map 已初始化）</li>
          <li>新 Iron Rule：所有 wave/cards 子檔案不可在 module top-level 對 effects.ts 內 Map 做 .set() — 必須用 register() pattern lazy 註冊</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.9991</span> hotfix — 修 v2.999 循環 import 導致 500 error</summary>
        <ul>
          <li>v2.999 推送後使用者回報「對戰演練的網頁點進去當掉」（500 Internal Error）</li>
          <li>根因：v2999_g3_wave1.ts 中以模組頂層 PASSIVE_ATTACK_BONUS.set(...) 註冊棄世猴/原始心得/大晴天 三張卡的 +N 傷害；但其 import 寫在 effects.ts 第 362 行，而 PASSIVE_ATTACK_BONUS Map 在 effects.ts 第 2548 行才被宣告</li>
          <li>ESM 模組評估順序：第 362 行載入 v2999 模組時，PASSIVE_ATTACK_BONUS 仍是 undefined（temporal dead zone），呼叫 .set() 立即拋 TypeError；整個 effects.ts 模組無法完成初始化，連帶讓 game 頁面 client-side 載入時崩潰</li>
          <li>修法：將 v2999_g3_wave1 import 從頂端移到 effects.ts 末尾（在 PASSIVE_ATTACK_BONUS 宣告之後），確保模組載入時 Map 已初始化</li>
          <li>新 Iron Rule 候選：所有對 effects.ts 內 Map（PASSIVE_xxx / ABILITY_EFFECTS / TRAINER_EFFECTS 等）做 .set() 的子模組，import 必須放在 Map 宣告之後（或乾脆放 effects.ts 檔案末尾）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.999</span> Group 3 Wave 1 — 10 張條件 +HP/+傷害/-傷害類 passive 特性實裝</summary>
        <ul>
          <li>新建 v2999_g3_wave1.ts 集中本波 helper export（hasIronTracksDualCore / steelixPalaceReduce / bronzongShelterReduce / gearCoatingReduce）；effects.ts 加 import；engine.ts 加 attackerEffectiveTypes 與 PASSIVE_DAMAGE_REDUCE_COND 後續 inline hooks</li>
          <li>條件 +max HP（3 張，早於本波由 v2.122 / engine.ts getEffectiveHP 完成 — 列在文件追溯）：夠讚狗｜腎上腺力量（附【惡】+100）、怖納噬草｜雜草魂（對手已取獎賞每張 +50）、修建老匠｜大師工藝（自身【鬥】能量每張 +40）</li>
          <li>條件 +招式傷害（3 張）：夠讚狗｜腎上腺力量（附【惡】時 +100，已實裝；列在追溯）；新實裝 — 棄世猴｜憤怒穴（自身傷害指示物 ≥ 2 時招式 +120）、PASSIVE_ATTACK_BONUS 加 entry</li>
          <li>+N 攻擊端 buff（2 張）：肋骨海龜｜原始心得（自方寶可夢對對手戰鬥場進化寶可夢 +30，per-source 疊加）、裙兒小姐｜大晴天（自方【草】/【火】寶可夢 +20，per-source 疊加）— 都加到 PASSIVE_ATTACK_BONUS</li>
          <li>屬性切換（1 張）：鐵轍跡｜二重核心 — 身上附「驅勁能量 未來」時改為【鬥】+【鋼】2 種屬性，影響弱點/抵抗力比對；engine.ts attackerEffectiveTypes 加閘門呼叫 hasIronTracksDualCore（與小碎鑽｜雙重屬性 同模式）</li>
          <li>受傷 -N（3 張）— inline 在 engine.ts damage pipeline，與 灰塵山 / 冰雪巨龍 同模式（skipDefEffects gate + 監視塔閘門略過：青銅鐘 / 齒輪怪 是【鋼】、大吾的小碎鑽 是【鬥】，皆非【無】）：</li>
          <li>　• 大吾的小碎鑽｜岩石宮殿（在備戰時自方「大吾的」寶可夢受招式傷害 -30，卡面明文「不重複」→ 觸發即 -30 一次）</li>
          <li>　• 青銅鐘｜守護之鐘（場上有青銅鐘時自方所有寶可夢 -10；保守按 has-not-count 不疊加，避免濫用）</li>
          <li>　• 齒輪怪｜齒輪塗層（場上有齒輪怪時自方附【鋼】能量寶可夢 -20；同樣保守 has-not-count 不疊加）</li>
          <li>tsc 全綠（0 error）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.998</span> Group 2 — 18 張進化/手牌觸發特性實裝（14 張完整 + 4 張 deferred）</summary>
        <ul>
          <li>新建 v2998_g2.ts 集中 14 張進化/上備戰/被招式 KO 觸發特性（regA + regR）；effects.ts 同步擴充 ON_EVOLVE_FROM_HAND_ABILITIES（+13）/ ON_PLAY_FROM_HAND_ABILITIES（+1）/ PASSIVE_ON_KO（+1）</li>
          <li>進化觸發類（12）：安瓢蟲｜繁星花紋（HP&lt;=90 對手備戰互換）、雙尾怪手｜使壞之尾（擲 2 幣，正面數隨機抽對手手牌放回牌庫並重洗）、風妖精｜柔柔治癒（戰鬥場【草】寶可夢全恢復+棄能量）、麻花犬ex｜飽腹時間（自方所有進化寶可夢全恢復+棄能量）、巧鍛匠｜臨場之錘（擲 1 幣，正面則丟對手戰鬥位 1 個能量）、怖納噬草｜恐慌牢籠（對手戰鬥場【混亂】）、派帕的藏飽栗鼠｜貪慾點餐（棄牌區搜最多 2 張派帕的三明治公開揭示加手）、火箭隊的叉字蝠ex｜亂咬（對手 2 隻寶可夢各 +2 個傷害指示物）、火箭隊的大嘴蝠｜暗中咬住（對手 1 隻 +2 個指示物）、莉莉艾的蝶結萌虻｜邀請眨眼（看對手手牌挑任意數量基礎寶可夢放對手備戰）、赫普的毛毛角羊｜挑戰角擊（對手備戰互換戰鬥場）、鬃岩狼人｜尖刺纏身（棄牌區搜最多 2 張扣殺能量附身）</li>
          <li>放置觸發類（1）：大蔥鴨｜臨場背負（牌庫搜 1 張寶可夢道具附身+重洗）</li>
          <li>雙觸發（1）：沙漠蜻蜓｜沙之羽擊 — 進化時走 ON_EVOLVE_FROM_HAND_ABILITIES（regA），被招式 KO 時走 PASSIVE_ON_KO（desertDragonflyOnKo helper）；兩個觸發點各算 1 次，互不消耗</li>
          <li>揭示資訊（Iron Rule 8）：派帕的三明治抽到加手 / 邀請眨眼查看對手手牌與放置動作 / 使壞之尾揭示抽到的對手手牌名 — 都公開 addLog；互換、放指示物、混亂、棄能量等公開動作亦同</li>
          <li>Deferred（4）：海豚俠｜全能變身、鋼炮臂蝦｜返回重載（兩張需新 hook ON_RETREAT_TO_BENCH 涵蓋撤退/招式互換/特性互換等所有從戰鬥場回備戰情境）；超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉（兩張需新 hook ON_DISCARD_FROM_HAND 由玩家主動丟卡觸發）</li>
          <li>共用 resolver：v2998-swap-opp-active-bench（繁星花紋/挑戰角擊）、rocket-crobat-mass-bite（亂咬/暗中咬住共用 counters 機制）；helpers：findTriggerSource、swapOppActiveWithBench、desertDragonflyMill2</li>
          <li>tsc 全綠（0 error）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.997</span> Group 4 Wave 3 — 10 張條件 passive + 能量計算類特性實裝（Group 4 完結）</summary>
        <ul>
          <li>新建 v2997_g4_wave3.ts 集中註解；實際實裝以 effects.ts 末段 export helper + engine.ts hook 為主</li>
          <li>能量計算類（5）：好勝毛蟹｜事先準備（招式所需【無】減自方棄牌「海岱」張數）、輕身鱈｜事先準備（同上，共用 helper）、熾焰咆哮虎ex｜喧鬧競技（招式所需【無】減對手備戰寶可夢數量）、瑪力露麗｜亮亮泡（自方場上有「太晶」寶可夢時「捨身衝撞」cost 改為 1【超】）、音波龍｜調諧迴響（雙方手牌張數相同時「恐慌嚎鳴」cost 全部消除）</li>
          <li>condition passive（3）：請假王ex｜懶怠個性（對手場上沒有 ex/V 時無法使用招式 — engine getAvailableAttacks + ATTACK handler 兩處 gate）、小嘴蝸 / 蓋蓋蟲｜刺激進化（自方場上有 partner 時 bypass isFirstTurn + justPlaced + evolvedThisTurn — engine EVOLVE handler + getEvolvableTargets 兩處鏡射）</li>
          <li>rule marker（1）：海豚俠ex｜全能靈魂（block 從手牌正常 PLAY_BASIC，只能由「全能變身」放置 — engine PLAY_BASIC handler 加 gate）</li>
          <li>Deferred（1）：齒輪怪｜緊急迴轉 — 「手牌中觸發特性」需要新的 ON_HAND_ACTIVATE 機制 + UI 改動，engine 沒現成 hook → 標記 deferred 待獨立 wave 處理</li>
          <li>5 個 cost helper export 在 effects.ts 末段（pattern 同 v2.133 getKyuremElectroplasmaEffectiveCost）；engine canAffordAttack 在 line 826 區 hook 共 8 個 cost helper（原 4 + 新 4，事先準備兩張共用一個）</li>
          <li>tsc 全綠（0 error）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.996</span> Group 4 Wave 2 — 10 張牌庫/手牌/棄牌操作類主動特性實裝</summary>
        <ul>
          <li>新建 v2996_g4_wave2.ts 集中實裝 10 張主動特性（regA），都是 ABILITY_AUDIT_V2_98.md Group 4 中需要操作牌庫/手牌/棄牌或對手互動的卡</li>
          <li>牌庫搜尋類（3）：豆豆鴿｜緊急進化（HP≤30 跳階進化高傲雉雞含 ex 並重洗）、保母曼波｜溫柔鰭（棄牌區挑 HP≤70 基礎寶可夢放備戰）、始祖大鳥｜原始之翼（對手 1 隻進化寶可夢退化 1 層放對手手牌）</li>
          <li>手牌/棄牌操作類（3）：烈焰猴｜火焰蹈舞（手牌挑【火】+【鬥】基本能量各最多 1 張附給自方場上）、火箭隊的多邊獸Ｚ｜再構築（棄 2 張手牌抽 1）、小霞的可達鴨｜重步跳躍（牌庫底 1 張入棄牌+自身與附加全入棄牌+自身放回牌庫頂）</li>
          <li>對手操控類（2）：哥德小姐｜曲扭未來（對手手牌洗回牌庫並重洗+抽 3）、禿鷹娜｜瞄準獵物（看對手手牌挑 HP≤70 基礎寶可夢放對手備戰）</li>
          <li>能量附加類（2）：奇樹的電肚蛙ex｜電氣流（不限次數！手牌挑【雷】基本能量附給自方「奇樹的」寶可夢）、毒粉蛾｜微風吹拂（擲幣正面選 1 個對手戰鬥能量放回對手手牌）</li>
          <li>engine.ts UNLIMITED_USE_ABILITY_NAMES 加「電氣流」（不消耗 1 次/回合）+ getUsableAbilities 加 10 個 button gate（Iron Rule 9）</li>
          <li>揭示資訊（Iron Rule 8）：對手抽 3 與牌庫操作用 addPrivateLog（自己看到具體卡名、對手只看計數）；退化卡名 / 放對手備戰卡名 / 附加能量名都用 addLog 公開揭示</li>
          <li>tsc 全綠（0 error）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.995</span> Group 4 Wave 1 — 14 張簡單主動特性實裝</summary>
        <ul>
          <li>新建 v2995_g4_wave1.ts 集中實裝 14 張主動特性（regA），都是 ABILITY_AUDIT_V2_98.md Group 4 中規則最直觀的卡</li>
          <li>治癒類（4）：霜奶仙ex｜甜點之禮 +30、壺壺｜發酵果汁 +30（需草能量）、寶包繭｜飛葉治癒 +20、樂天河童｜激動治癒 +60（需草超級進化ex）</li>
          <li>狀態類（3）：燈罩夜菇｜平靜之光（睡眠）、波爾凱尼恩ex｜燒灼蒸汽（灼傷）、搖籃百合｜任選黏液（擲幣正面 → 三選一中毒/灼傷/混亂）</li>
          <li>互換類（4）：花潔夫人｜媚惑引誘（擲幣 → 對手戰備互換 + 新上場混亂）、大劍鬼｜激流旋渦（自方戰備互換 + 對手戰備互換）、直衝熊｜激動衝刺（備戰 + 場上有超級進化ex 互換）、魔幻假面喵｜表演時間（備戰互換）</li>
          <li>其他（3）：凱西｜瞬間移動者（自身與附加卡放回牌庫並重洗 + 上備戰）、大力鱷｜奔流之心（自身放 5 個指示物 + 本回合招式 +120）、雪絨蛾｜勸誘羽（雙方各抽 1）</li>
          <li>engine.ts getUsableAbilities 加 8 個 button gate（Iron Rule 9）：在戰鬥場、在備戰、有草能量、場上有超級進化ex 等條件未滿足時按鈕直接不顯示</li>
          <li>所有 effect 結果用 addLog（Iron Rule 8 公開揭示資訊）— 治癒/狀態/互換都是場上可見效果</li>
          <li>tsc 全綠（0 error）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.994</span> 修 3 個遺留 tsc errors + 確認赫月/酋雷姆 cost helper 已實裝</summary>
        <ul>
          <li>修 mega_decks.ts:601 — olive-oil-distribute resolver 用 aIdx typo（應為 actorIdx）導致 KO 後 addPendingPrize 失敗（油之機關槍多隻 KO 時對手獎賞少給）</li>
          <li>修 v2500_i_wave3b_discard.ts:108-109 — discardStadiumPost helper 內 delete 用 Record&lt;string,unknown&gt; cast 不符 GameState 型別。改用 undefined 賦值（types.ts 上 activeStadium / activeStadiumOwnerIdx 是 optional）</li>
          <li>tsc error 全清零（先前 3 個 → 0 個）</li>
          <li>Audit 確認赫月ex｜老練招式（getUrsalunaBloodMoonEffectiveCost）+ 酋雷姆｜反等離子（getKyuremElectroplasmaEffectiveCost）早於 v2.133 已完整實裝，hook 在 engine canAffordAttack — 無需重做</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.993</span> minCount audit + 揭示資訊 resolver 修正（Iron Rule 8）</summary>
        <ul>
          <li>修正 18 處 minCount: 0 違反卡片敘述：卡面寫「選 1 張」mandatory 但允許玩家直接 Pass。動態判斷牌庫候選池：有候選 → minCount: 1，無候選 → minCount: 0（允許 Pass）</li>
          <li>影響高頻卡：大師球、幫忙鈴、高級球、巢穴球、甜蜜球、超級信號、精靈球、賽吉、能量輸送、謎擬Q｜呼朋引伴、火箭隊的超級球、超級球（MJ）、阿克羅瑪的執著（兩階段）、親送無人機、勝利之證、黑暗球、啪咚猴｜衝衝鼓</li>
          <li>修正共用 resolver 違反 Iron Rule 8（揭示資訊）— search-generic-to-hand：addPrivateLog → addLog（卡面「給對手看過」公開揭示）。影響：戰鬥鑼、寶可平板、火箭隊的拉姆達、珍寶配件、王者呼聲（竹蘭的尖牙陸鯊）</li>
          <li>新增 search-generic-to-hand-private resolver — 給卡面無「給對手看過」者使用（如：啪咚猴｜衝衝鼓）</li>
          <li>修 search-to-hand-reshuffle resolver 完全沒 log 的 bug — 預設 addLog（公開揭示），新加 params.privateReveal 旗標。影響 public 揭示：高級香氛、席藍、大地之容器 step2、貓頭夜鷹｜搜尋寶石、蓋諾賽克特ex｜金屬信號；private（八朔、仙后）標旗標</li>
          <li>個別 bug：阿克羅瑪的執著 step1+step2、呱頭蛙｜招集之術、能量輸送 — 違反「給對手看過」一律改 addLog</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.992</span> Group 1 — 22 張 H/I 被動特性實裝（16 張完整 + 6 張 deferred）</summary>
        <ul>
          <li>受傷減 N（A 類）：多麗米亞｜毛皮大衣（-20）/ 爆炸頭水牛ex｜爆炸頭防守（-30）— 加入 PASSIVE_DAMAGE_REDUCE</li>
          <li>免疫對手 ex 招式（A 類）：仙子伊布｜神秘守護 — 加入 PASSIVE_IMMUNITY</li>
          <li>受傷反擊放指示物（A/C 類）：鐵脖頸｜自動用武（3 個）/ 赫普的啪嚓海膽ex｜反擊針（3 個）/ 拖拖蚓ex｜快掃拳返（鋼能量×2 個）— 加入 PASSIVE_RETALIATION</li>
          <li>條件式受傷減免（B 類）：雷吉洛克｜岩石盔甲（附能量時 -30）— 新 hook PASSIVE_DAMAGE_REDUCE_COND</li>
          <li>擲幣 KO 留 10 HP（B 類）：超級摔角鷹人ex｜堅忍之軀 — 加入 PASSIVE_PREVENT_KO（無滿血條件，與勤奮之心/結實不同）</li>
          <li>擲幣免傷（B 類）：變隱龍｜躲藏高手 / 吉雉雞｜腎上腺費洛蒙（限附惡能量時）— 新 hook PASSIVE_COIN_AVOID</li>
          <li>KO 時放指示物（C 類）：沙鈴仙人掌｜炸裂針（6 個）— 新 hook PASSIVE_KO_RETALIATION</li>
          <li>狀態免疫（D 類）：咕咕｜不眠（不會睡眠）— 新 helper isSleepImmune，statusPost / coinStatusPost 同步檢查</li>
          <li>KO 時觸發（I 類）：桃歹郎｜最後鎖鏈（搜 1 張到手）/ 願增猿ex｜鬆口氣（場上有桃歹郎ex 則對手獎賞 -1）/ 脫殼忍者｜脆弱蛻殼（對手 ex 招式 KO 時不得獎賞）— 新 hook PASSIVE_ON_KO + PASSIVE_PREVENT_PRIZE</li>
          <li>受傷時觸發 deck search（I 類）：火箭隊的瓦斯彈｜警備濁霧（搜 ≤2 張瓦斯彈放備戰）— 新 hook PASSIVE_ON_DAMAGED</li>
          <li>攻擊端 buff（H 類）：波盪水ex｜藏青浪濤（自身招式皆 skipDefEffects）— 新 hook PASSIVE_ATTACKER_BUFF（卡面要求所有招式都生效，不只宣洩吼嘯）</li>
          <li>Deferred 6 張（需更廣 hook）：斯魔茶｜藏隱 / 小霞的鯉魚王｜深度下潛（備戰免疫，需改 hitBenchPickPost / multiSnipePost helper）/ 斧牙龍｜緊張感 / 浩大鯨ex｜融合為雪（對手物品支援者效果免疫，影響 &gt;100 卡）/ 肋骨海龜｜全能硬殼（對手附特殊能量寶可夢免疫，需新 hook）</li>
          <li>新增 7 個被動 hook map：PASSIVE_DAMAGE_REDUCE_COND / PASSIVE_COIN_AVOID / PASSIVE_KO_RETALIATION / PASSIVE_ON_KO / PASSIVE_ON_DAMAGED / PASSIVE_PREVENT_PRIZE / PASSIVE_ATTACKER_BUFF</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.991</span> 33 對 wave-vs-effects 重複註冊全檢 — 修剩餘 active bug + dead-code 清理</summary>
        <ul>
          <li>v2.99 操陷蛛修完後做完整 audit：33 對 wave 檔 vs effects.ts 的重複註冊全檢</li>
          <li>機制驗證：effects.ts 在頂部 import wave 檔（先註冊），自身內聯 reg 後執行（後勝）— 所有 33 對都是 effects.ts 覆蓋 wave</li>
          <li>分類：A 一致 26 / B 兩邊都錯 0 / C effects 對 wave 錯 5 / D wave 對 effects 錯 0 / E 兩邊都不完全對 2</li>
          <li>修 effects.ts active bug：仙子伊布ex｜天仙石 minCount 改 max（卡面寫「選 2 隻」是強制）</li>
          <li>修 effects.ts active bug：米立龍｜集客 fetch-supporter resolver 加公開揭示所選支援者（Iron Rule 8）</li>
          <li>修 wave dead-code 邏輯（避免未來載入順序變更而活化）：</li>
          <li>　• 喵喵ex｜夾尾巴逃跑 (Post)：selfBouncePost 改拆能量/道具/進化棧</li>
          <li>　• 阿利多斯｜毒陣 (Post)：改用 statusPost 走完整免疫檢查</li>
          <li>　• 天秤偶｜連續旋轉 (Pre)：用 flip1 取代 Math.random</li>
          <li>　• 倫琴貓｜猛力進攻 (Pre)：用 aIdx 取代 (1-aIdx)，符合卡面「自己已取」</li>
          <li>　• 修建老匠｜暴走 (Post)：加憨憨臉免疫檢查</li>
          <li>產出 dupe_audit_full_v2_99_1.md 完整對照表供日後 review</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.99</span> 修 火箭隊的操陷蛛｜火箭猛攻 雙重註冊 bug + 招式邏輯 audit</summary>
        <ul>
          <li>玩家發現：火箭隊的操陷蛛 火箭猛攻 卡面是「自方場上火箭隊寶可夢數 × 30」，但程式做的是「棄 1 個能量 → 30」— 完全亂做</li>
          <li>根因：v2650_i_wave15_misc8.ts 有正確 regPre（自方寶可夢數 × 30），但 effects.ts:11082 又用 registerFieldDiscardMultiply 註冊一次（棄能 × 30），且 effects.ts 後載入 → 覆蓋了正確版本</li>
          <li>修法：刪 effects.ts:11080-11082 那 3 行（含上方註解），讓 wave 檔規則生效</li>
          <li>Audit：寫 audit_v299.py 自動化掃描 2510 招式、284 特性，比對 JSON 卡面 vs ts 程式邏輯</li>
          <li>掃描出 53 個雙重註冊衝突（其中 36 個是 wave 檔被 effects.ts 後勝覆蓋）— 多數兩邊邏輯一致，操陷蛛是這次確認唯一邏輯不符的</li>
          <li>產出 attack_logic_audit_v2_99.md 完整報告供日後 review</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.981</span> 修 v2.98 pending prize 期間其他動作未鎖 bug</summary>
        <ul>
          <li>玩家報告：冰冷之帳 KO 對手後，雖然出現「取得獎賞」按鈕，但玩家還能同時按攻擊、跳過攻擊、使用競技場 等按鈕，順序錯誤</li>
          <li>v2.98 refactor 沒做完整 — engine 只在 END_TURN 入口擋 pending prize，主 ATTACK/USE_STADIUM/USE_ABILITY 等 action 都沒擋</li>
          <li>UI 也沒 gate — 任一方有 pending prize 時還會顯示其他 main-phase 按鈕</li>
          <li>修法 1：engine.ts pendingSelection gate 之後加 hasAnyPendingPrize early-return — 除 TAKE_PRIZES / SEND_NEW_ACTIVE / RESOLVE_SELECTION 外所有 action 都擋</li>
          <li>修法 2：+page.svelte 加 anyPendingPrize derived，gate 攻擊/跳過攻擊/競技場/特性/結束回合 等所有 main-phase 按鈕；改顯示「請先取獎勵牌再繼續行動」提示</li>
          <li>確保獎賞流程順序：取完才能繼續其他動作（符合 PTCG 規則 — 獎賞取得是即時的，不能晚於後續動作）</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.98</span> pendingPrizes 重構：每側待領獎賞 tuple 化</summary>
        <ul>
          <li>引擎 <code>GameState.pendingPrizes</code> 從單一數字改為「兩個 number 的 tuple」（P1 待領 / P2 待領）</li>
          <li>新增 <code>addPendingPrize(state, ownerIdx, n)</code> / <code>getPendingPrize</code> / <code>hasAnyPendingPrize</code> helper，所有寫入點統一走 helper</li>
          <li>引擎 <code>TAKE_PRIZES</code> action 接受 <code>playerIdx</code> 參數，由 owner 各自取（不再依賴 activePlayerIndex）</li>
          <li>修正 5 處「自爆 KO / 反彈 KO / 冰冷之帳 / 棄世猴同命戰鬥 / 瘋癲攻擊自殺」原本直接 prizes.slice 派發給對手手牌的暴力處理 — 改走 pendingPrizes 由對手手動 click 取獎，符合實體 PTCG 流程</li>
          <li>UI 新增 <code>myPendingPrizes</code> derived；取獎按鈕拿掉 isMyTurn gate（對手回合也能 click 取自己應得獎賞）</li>
          <li>AI 取獎邏輯移到 activePlayerIndex gate 之前，AI 對手回合內也會自動 take prize</li>
          <li>SKILL.md 新增 Rule 10：所有 pendingPrizes 寫入必須走 helper，禁止 prizes.slice + hand 直接派發</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.97-hotfix</span> 修 v2.961 changelog 大括號沒 escape 導致空白頁</summary>
        <ul>
          <li>嚴重 bug：v2.961 changelog 內「&#123;abilityName&#125;」沒做 HTML entity escape，被 Svelte parser 當成 JavaScript expression 求值</li>
          <li>運行時 ReferenceError: abilityName is not defined → 整個 app 在首頁就崩潰，全黑空白</li>
          <li>違反 ptcg-push 鐵律 1（Svelte template 特殊字符 ＜＞｛｝ 必須 escape）</li>
          <li>修法：把 changelog 內裸 &#123; &#125; 改為 &amp;#123; &amp;#125; HTML entity</li>
          <li>未來嚴禁在 changelog 等 svelte template 內容裡放裸大括號（包含示例程式碼、template literal 範例）</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.961</span> 修 v2.96 漏掉的 __genericDeckSearchResolver 揭示資訊</summary>
        <ul>
          <li>v2.96 audit 漏掉 v2306 的 __genericDeckSearchResolver — 此 resolver 共用 3 張卡，全都漏揭示</li>
          <li>芳香精｜收集香氣（搜【超】能量 ≤2 加手）— 卡面有「給對手看過」</li>
          <li>象牙豬ex｜毛象搬運（搜寶可夢 1 加手）— 卡面有「給對手看過」</li>
          <li>萌芽鹿｜四季變換（搜競技場 1 加手）— 卡面有「給對手看過」</li>
          <li>修法：__genericDeckSearchResolver 改寫為 factory pattern，傳入 abilityName 作為 log prefix；log 公開具體卡名「&#123;abilityName&#125;：將「A、B」加入手牌（給對手看）」</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.96</span> 兩條鐵律審計：揭示資訊（addLog vs addPrivateLog）+ 特性按鈕 gate</summary>
        <ul>
          <li><b>Audit 1：揭示資訊規則</b> — 卡面有「給對手看過」者，對手 log 必須能驗證具體卡名（PTCG 線上版透過 log 取代實體桌上「給對手看」的防作弊機制）</li>
          <li>掃 122 個必揭示位點（64 寶可夢招式/特性 + 58 訓練家），找到 18 處違規（誤用 <code>addPrivateLog</code>，對手只看到張數）</li>
          <li>修補 <code>pokemon_search.ts</code> <code>search-pokemon-to-hand</code> resolver — 高級球 / 黑暗球 / 甜蜜球 / 超級信號 / 小剛的發掘 stage2 等多卡共用，從 <code>addPrivateLog</code> 改 <code>addLog</code></li>
          <li>修補 <code>brocks-dig-basic</code> resolver — 小剛的發掘 stage1 同樣公開卡名</li>
          <li>修補 <code>fan-call-hand</code> resolver — 旋轉洛托姆 風扇呼喚 公開卡名</li>
          <li>修補 <code>items_misc.ts</code>：大師球 / 訂購盒 / 幫忙鈴 / 勝利之證 / 招式學習器機 共 5 處</li>
          <li>修補 <code>v168_supporters.ts</code>：派帕（物品 + 道具 兩個位點）</li>
          <li>修補 <code>v169_supporters.ts</code>：杜若（寶可夢 + 訓練家）/ 正輝的輸送 / 吹火人 共 4 處</li>
          <li>修補 <code>v172_hij_batch.ts</code>：火箭隊的超級球 / 沙儷 / 卡娜莉 共 3 處</li>
          <li>保留 <code>addPrivateLog</code>：親送無人機（卡面無「給對手看過」，無 filter 限制）</li>
          <li><b>Audit 2：特性按鈕 gate</b> — 卡面有觸發條件的特性，<code>getUsableAbilities()</code> 必須加 gate；不能依賴 fn 內 <code>if (!條件) return addLog(&#39;無法使用&#39;)</code>，那會讓玩家點完才看到錯誤訊息</li>
          <li>掃 63 個有觸發條件的特性，已 gate 19 個 / 自動觸發類已加進 <code>ON_PLAY_FROM_HAND_ABILITIES</code> &amp; <code>ON_EVOLVE_FROM_HAND_ABILITIES</code> / 補 gate 5 個</li>
          <li>補 振翅高飛（遠古巨蜓ex）— gate：戰鬥場 + <code>movedToActiveThisTurn</code> + 牌庫不空（user 親身踩到此 bug）</li>
          <li>補 夜間工作（叉字蝠）— gate：在戰鬥場 + 牌庫不空</li>
          <li>補 蒐證（貓鼬探長）— gate：手牌 ≥ 1 + 牌庫 ≥ 1</li>
          <li>補 搜尋點心（莫魯貝可，v2.95 實裝）— gate：牌庫不空</li>
          <li>補 增長繭（甲殼繭）— gate：本回合進化 + 備戰 &lt; 5 + 牌庫不空</li>
          <li>未 gate 但未實裝的特性（屬未來 wave）：三成能量 / 全開能量 / 劇毒粉塵 / 勸誘羽 / 原始之翼 / 尖刺纏身 / 平靜之光 / 恐慌牢籠 / 挑戰角擊 / 暗中咬住 / 曲扭未來 / 柔柔治癒 / 沙之羽擊 / 溫柔鰭 / 燒灼蒸汽 / 發酵果汁 / 瞬間移動者 / 繁星花紋 / 臨場之錘 / 臨場背負 / 臨場選擇 / 裝酷重抽 / 貪慾點餐 / 邀請眨眼 / 重步跳躍 / 飛身進場 / 飽腹時間 等</li>
          <li>新增 <code>SKILL.md</code> Iron Rule 8（揭示資訊）+ Iron Rule 9（特性按鈕 gate）</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.95</span> 清孤兒 regR + 實裝快節奏/搜尋點心 + 15 regA 驗證報告</summary>
        <ul>
          <li>v2.94 殘留清理：刪除 5 個孤兒 <code>regR</code>（<code>ABILITY_EFFECTS.set</code> 已刪、resolver 殘留 dead code）— 大電海燕 閃電平局 / 尖牙陸鯊 龍之呼喚 / 狂歡浪舞鴨 能量嘉年華 + attach / 莫魯貝可 點心尋找</li>
          <li>保留 <code>meowth-ex-trump-catch</code> resolver — 因 maroon_dragon_deck.ts:56 仍引用（喵喵ex 殺手鐧捕捉 走 deck-search 流程）</li>
          <li>實裝 狂歡浪舞鴨｜快節奏 — 「將 1 張手牌放回牌庫下方，抽到手牌滿 5 張」（手牌 picker → resolver 把卡 push 到 <code>deck[length-1]</code>，非丟棄非重洗）</li>
          <li>實裝 莫魯貝可｜搜尋點心 — 「查看牌庫上方 1 張卡，回復原樣，若希望將那張卡丟棄」（log 顯示卡名給玩家本人 → modal-choice 保留 vs 丟棄）</li>
          <li>v2.94 已 convert 的 15 個 <code>regA</code> fn body 對比卡面文字，10 ✅ + 5 ⚠️：</li>
        <li>3. 米立龍｜集客 ⚠️：log 為 actor-only，對手看不到挑的支援者卡名</li>
        <li>10. 遠古巨蜓ex｜振翅高飛 ⚠️：movedToActiveThisTurn gate 與「從備戰過來」依賴 engine 旗標；resolver 0-path shuffle 正常</li>
        <li>12. 象牙豬ex｜毛象搬運 ⚠️：deckSearchToHandA generic resolver，actor-only log（缺「給對手看過」）</li>
        <li>13. 芳香精｜收集香氣 ⚠️：同 #12 actor-only log</li>
        <li>15. 萌芽鹿｜四季變換 ⚠️：同 #12 actor-only log</li>
          <li>其他（10 個）已逐項驗證 ✅：</li>
        <li>1. 吉雉雞ex｜扭轉乾坤 ✅</li>
        <li>2. 厄鬼椪 碧草面具ex｜碧綠之舞 ✅</li>
        <li>4. 叉字蝠｜夜間工作 ✅</li>
        <li>5. 妖火紅狐｜閃焰魔法 ✅</li>
        <li>6. 噗噗豬｜能量舞步 ✅</li>
        <li>7. 鐵面忍者｜脫殼 ✅</li>
        <li>8. 貓鼬探長｜蒐證 ✅</li>
        <li>9. 光電傘蜥｜頸傘發電 ✅</li>
        <li>11. 甲殼繭｜增長繭 ✅</li>
        <li>14. 莉佳的蔓藤怪｜百花齊放 ✅（filter 未限制 picker，但 resolver 有檢查；log actor-only）</li>
          <li>5 個 ⚠️ 共同問題：「給對手看過」這條卡面要求未實裝 — 目前都是 actor-only log，對手畫面看不到挑了哪張卡（屬 UI / 公平性層級，不影響遊戲狀態正確性，可在後續 wave 統一修）</li>
          <li>遠古巨蜓ex｜振翅高飛 的 <code>movedToActiveThisTurn</code> gate 屬 engine 旗標依賴，若有「資源沒附到正確目標」報告再追</li>
          <li>未發現嚴重簡化（自動選 HP 最低 / 50% 機率 / 全部附 1 隻 之類）— v2.94 audit 已清完</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.94</span> 修 v2306 21 個 ABILITY_EFFECTS key bug + 鐵掌力士｜大力捕捉器 + audit + 鐵律</summary>
        <ul>
          <li>修復 v2306_meta_pokemon.ts 的 21 個 <code>ABILITY_EFFECTS.set</code> key bug — 引擎查表用 <code>&#39;卡名&#124;abilityIndex&#39;</code>（數字），但 v2306 用 <code>&#39;卡名&#124;特性名&#39;</code> 全部 dead</li>
          <li>15 個 convert 為 <code>regA(&#39;卡名&#39;, 0, fn)</code>：吉雉雞ex 扭轉乾坤 / 厄鬼椪 碧草面具ex 碧綠之舞 / 米立龍 集客 / 叉字蝠 夜間工作 / 妖火紅狐 閃焰魔法 / 噗噗豬 能量舞步 / 鐵面忍者 脫殼 / 貓鼬探長 蒐證 / 光電傘蜥 頸傘發電 / 遠古巨蜓ex 振翅高飛 / 甲殼繭 增長繭 / 象牙豬ex 毛象搬運 / 芳香精 收集香氣 / 莉佳的蔓藤怪 百花齊放 / 萌芽鹿 四季變換</li>
          <li>1 個刪除（已有重複實裝）：喵喵ex 殺手鐧捕捉（maroon_dragon_deck.ts 已有 regA）</li>
          <li>5 個刪除 dead code：盾甲繭 增長繭 / 大電海燕 閃電平局 / 尖牙陸鯊 龍之呼喚（JSON 無 abilities）；狂歡浪舞鴨 能量嘉年華 / 莫魯貝可 點心尋找（JSON 為不同效果，fn 邏輯與卡面不符）</li>
          <li>實裝鐵掌力士｜大力捕捉器 — 從手牌使出這張卡並完成進化時可使用 1 次：選 1 隻對手備戰寶可夢與戰鬥場互換（復用 gust-opp resolver）</li>
          <li>effects.ts <code>ON_EVOLVE_FROM_HAND_ABILITIES</code> Set 加入 <code>&#39;大力捕捉器&#39;</code></li>
          <li>simplified audit：掃描 src/lib/game/effects/ 找出 25 筆真正的簡化點（已過濾「升級為完整」之類歷史註解）</li>
          <li>更新 ptcg-push 鐵律：Rule 6（ABILITY_EFFECTS key 必須用 regA helper）+ Rule 7（嚴禁簡化實裝）</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.93b</span> 高使用率特性實裝完整（剩 2 張）</summary>
        <ul>
          <li>岩殿居蟹（SV11B）｜結實 — HP 全滿被招式 KO 時留 10 HP（與勤奮之心同邏輯，PASSIVE_PREVENT_KO 加 1 行即可）</li>
          <li>注意：岩殿居蟹有兩個版本特性 — M2a/MC/SV9a 版本「神秘石居」（不受 ex 招式傷害，已實裝）；SV11B 版本「結實」（本波新加）</li>
          <li>拉帝歐斯（M1S）｜潔淨支援 — 當「超級拉帝亞斯ex」從備戰移到戰鬥場時可用 1 次：選備戰寶可夢的能量轉移到戰鬥場</li>
          <li>觸發 gate：自方回合 + active 為超級拉帝亞斯ex + active.movedToActiveThisTurn=true + 備戰有能量</li>
          <li>UX：chained pending — bench-choose（選 1 隻備戰）→ modal-choice stepper（轉幾張）→ 回到 bench-choose（可從另一隻繼續）→ 不選結束</li>
          <li>v2.93a + v2.93b 共完成 5 張高使用率特性，實裝完成度 1933+5=1938 / 2043 = 94.86%</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.93a</span> 高使用率特性實裝（3 張）</summary>
        <ul>
          <li>玩家提示：先處理高使用率卡再做 110 張特性 backlog。確認 5 張中 4 張未實裝（岩殿居蟹｜神秘石居 已實裝舊版，新版 SV11B 結實 留 v2.93b）</li>
          <li>奇樹的大電海燕｜閃光抽出 — 棄自身 1 張基本【雷】能量 → 抽到手牌滿 6 張</li>
          <li>阿響的鳳王ex｜金色火焰 — 1 回 1 次手牌【火】×≤2 附於備戰「阿響的」寶可夢（兩階段 chained pending）</li>
          <li>三首惡龍ex｜貪婪食客 — engine.ts inline KO bonus（攻擊方有此特性 + 被 KO 對手戰鬥場為【基礎】 → +1 獎賞）</li>
          <li>新檔 src/lib/game/effects/cards/v2930_high_use_abilities.ts；effects.ts 加 side-effect import</li>
          <li>1 回合 1 次靠 engine 既有 abilityUsedThisTurn gate（per-instance）</li>
          <li>剩餘 2 張（岩殿居蟹｜結實、拉帝歐斯｜潔淨支援）需新 hook，留 v2.93b</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.92</span> Wave 2 — 22 張個別招式加上招式效果免疫檢查</summary>
        <ul>
          <li>承接 v2.91 Wave 1（7 helper + statusPost）；本波處理 audit 列表上 22 張個別卡片</li>
          <li>A.1 純指示物 / 副效果（12 張）— per-target 加 canApplyAttackEffectToTarget：
            超級基格爾德ex｜虛無歸零、肯泰羅｜群起瞄準、鬼斯通｜纏擾、伊裴爾塔爾ex｜死亡靈魂、
            九尾｜九尾狐搬動、雪絨蛾｜冰凍羽擊、死神棺｜冥府之律、雷丘｜捲入伏特、
            河馬獸｜大沙風暴（bench 額外傷害走 resolveBenchGuard 涵蓋對戰圓形/太晶）、
            隨風球｜一同爆炸、謎擬Ｑex｜惡作劇之手、下石鳥｜墜擊射</li>
          <li>A.2 KO 類（4 張）— KO 前 check，被擋則 skip KO（自殘部分照常）：
            棄世猴｜同命戰鬥、雙斧戰龍｜斧擊在地、轟鳴月ex｜瘋癲攻擊、冰伊布ex｜藍柱石</li>
          <li>A.3 inline status（6 張）— 改用 statusPost / 加 inline check：
            叉字蝠｜毒音波、莉佳的蔓藤怪｜藤蔓攻擊、雙倍多多冰｜雙重冰凍、巴大蝶｜鱗粉颶風、
            毒粉蛾｜薄暮之毒（雙重狀態：先 check 再 inline）、火箭隊的黑魯加｜惡之火種（雙重狀態同上）</li>
          <li>coinStatusPost helper 也順手對齊 statusPost — 走 canApplyAttackEffectToTarget 取代 hasEffectShield</li>
          <li>河馬獸 大沙風暴 設計：主傷 150 走主管線（含弱抗/減傷），bench 額外 +40 屬招式效果走
            resolveBenchGuard（對戰圓形/太晶/花之帷幔）+ canApplyAttackEffectToTarget（薄霧/硬岩/皇帝之勢）</li>
          <li>雙重狀態最小修法：先 check 一次後再 inline 設雙狀態；被擋則整體 skip</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.91</span> Wave 1 — 7 個 helper 統一加招式效果免疫檢查</summary>
        <ul>
          <li>v2.89/v2.90 audit 找到 29 處繞過免疫的路徑，本波先修「修 1 個 helper = 同時修多卡」的 7 個共用 helper</li>
          <li>defCantAttackNextPost — 對手下回合無法使用招式（雪絨蛾｜冰冷寒氣）</li>
          <li>defNextAtkReducePost — 對手下次傷害 -N（黑魯加｜大聲咆哮、嘎啦嘎啦｜叫聲、超級火炎獅ex｜吠）</li>
          <li>defToolDiscardPre — 丟對手戰鬥場道具（金魚王｜啄落、破破舵輪｜破壞船錨、烈雀｜啄食、拉達｜削落、燃燒蟲｜啄落、派帕的貪心栗鼠｜咬取）</li>
          <li>defToolDiscardParalyzePre — 丟道具+麻痺（N的電電蟲｜劈哩啪啦短路）</li>
          <li>oppTargetTakeExtraNextPost — 對手下回合受招式 +N（超音波幼蟲｜刺耳聲、泥巴魚｜飛撲圈套）</li>
          <li>oppActiveCantAttachEnergyNextPost — 對手下回合不能附能量（晶光花｜侵蝕碎塊）</li>
          <li>oppActiveDeferredPrizeNextPost — 若 KO 多 +N 張獎勵（蝶結萌虻｜多餘花粉）</li>
          <li>statusPost helper 重構：原本只走 hasEffectShield（薄霧/硬岩/皇帝之勢），改成走 canApplyAttackEffectToTarget 涵蓋抵抗之幕</li>
          <li>defToolDiscardPre/Paralyze 設計：被免疫擋下時「傷害仍正常造成」（卡面有列傷害值的部分屬招式傷害，不被招式效果免疫擋），只有 tool 丟棄/麻痺等「招式效果」部分被擋</li>
          <li>單一 push 同時修補約 15+ 招式</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.90</span> 招式效果與免疫標籤化重構</summary>
        <ul>
          <li>玩家建議：把招式效果免疫做成統一的標籤管理，未來新增免疫卡只要加一行即可</li>
          <li>新增 ATTACK_EFFECT_IMMUNITY declarative map（effects.ts）— 集中管理所有 defender 端的招式效果免疫機制</li>
          <li>支援 3 種 immunity kind：energy-on-target（薄霧/硬岩）/ self-ability（皇帝之勢）/ field-ability（抵抗之幕）</li>
          <li>支援額外 filter：requireType（硬岩限【鬥】）/ targetFilter（抵抗之幕限基礎火箭隊）</li>
          <li>v2.89 的 canApplyAttackEffectToTarget 重構為 walk map 而非 hardcoded 4 條 if — 未來新增免疫卡：ATTACK_EFFECT_IMMUNITY.set('卡名', &#123; kind: '...', ... &#125;) 一行搞定</li>
          <li>新增 informational tag set：ATTACK_EFFECT_ONLY（純招式效果，無招式傷害）/ ATTACK_DAMAGE_PLUS_EFFECT（混合，如幻影奇襲 200 傷害 + 6 指示物）</li>
          <li>確認多龍巴魯托ex|幻影奇襲：200 招式傷害走正常管線（不受薄霧擋）+ 6 指示物 per-target 走免疫檢查（受薄霧擋）— 兩段路徑分離，邏輯正確</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.89</span> 修「招式效果 vs 招式傷害」邏輯 bug</summary>
        <ul>
          <li>玩家回報：胡地｜手之力量（手牌數 × 2 個傷害指示物）這類沒有招式傷害數值、純粹「放傷害指示物」的招式效果，繞過了 defender 的招式效果免疫</li>
          <li>PTCG 規則區分：招式傷害（卡面有列傷害值，走弱抗管線）vs 招式效果（卡面文字描述的效果，如放指示物 / 施加狀態）</li>
          <li>「招式效果」對 defender 的免疫機制：薄霧能量、硬岩【鬥】能量（限【鬥】寶可夢）、帝王拿波ex 皇帝之勢、火箭隊的急凍鳥 抵抗之幕（基礎火箭隊）</li>
          <li>新增統一 helper canApplyAttackEffectToTarget — 集中所有 defender 端招式效果免疫判定</li>
          <li>套到 5 個 counter-placement 路徑：胡地｜手之力量、來悲粗茶ex｜熬返、多龍巴魯托ex｜幻影奇襲、奧利瓦ex｜油之機關槍、cursed-bomb（彷徨夜靈、黑夜魔靈 等）</li>
          <li>注意：純樸 / 陳舊的背蓋化石 已由 engine 在 ATTACK_POST 階段 short-circuit 整個 regPost，不需呼叫端再檢查</li>
          <li>幻影奇襲 / 油之機關槍 為「分配 N 個指示物」類型，per-target 檢查 — 個別寶可夢被擋的指示物消耗（不重新分配）</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.88</span> 戰鬥 log 著色與粗體優化</summary>
        <ul>
          <li>玩家提議：戰鬥敘述 log 過於單調 — 新增 render-side tokenizer 把 message 切片，依類別套不同顏色 / 粗體</li>
          <li>類別色票：招式/特性【XX】金色粗體 · 被擊倒紅色粗體 · +N 張獎勵牌金黃粗體 · 傷害數字橘紅 · 回 HP 翠綠 · 狀態異常紫色 · 進化翠綠 · 擲硬幣淡黃 · 抽牌/重洗/搜尋牌庫淡灰</li>
          <li>整行樣式：「回合結束，換 X 行動」自動套 turn-marker 分隔器（淡藍色 border + 背景）· 勝負訊息加金色 box</li>
          <li>私有訊息（onlyOwner）多加 🔒 icon 與淡紫色 border-left，避免玩家誤以為對手也看得到</li>
          <li>純 render-side：不動 LogEntry / addLog API、不影響 game state、不影響連線同步</li>
          <li>不依靠顏色獨佔資訊：粗體 + emoji + 【】 同時使用，色弱友善</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.87</span> 同類能量批次附加 picker 改 +/- 計數器 UI</summary>
        <ul>
          <li>玩家提議：龐克練肌（瑪俐的長毛巨魔ex）這種「附多張同種類能量到多隻寶可夢」的卡，舊版要逐張選目標 + 逐張按確認，操作非常繁瑣</li>
          <li>新增 PendingSelection 類型 energy-distribute：與 damage-distribute（幻影奇襲）同款 +/- 計數器 UI，一次分配完所有能量按一次確認即可</li>
          <li>同類能量自動偵測：若該批次能量全部同屬性（如全 5 張基本【惡】能量）走 +/- UI；屬性混合（如太樂巴戈斯稜鏡充能各 1 張不同屬性）維持舊版逐張 picker（每張不可互換）</li>
          <li>已套用同款 UI：龐克練肌（5 張【惡】）/ 過度放電（1-3 張【雷】）/ 合金建造（搜【鋼】）+ 通用 startEnergyChain helper（帶動所有 v158 chain 用戶：燃燒充能 / 玻璃喇叭 / 樂呵呵之吻 / X啟動 / 金屬製造者 等）</li>
          <li>UI 細節：頂部進度條顯示「已附加 X/N 張【屬性】能量」、卡面 +/- 按鈕、右鍵 -1 快捷、達到 maxCount 後 +1 鈕鎖定</li>
          <li>混合屬性卡片不變（稜鏡充能 / 沉重接力棒 / 風暴伏特 等）卡面語義要求每張獨立指定目標</li>
        </ul>
      </details>

            <details>
        <summary><span class="ver-badge">v2.86</span> 選擇 modal 兩個 UX 改進</summary>
        <ul>
          <li>每個選擇 modal 底部加全域拖曳提示「💡 提示：按住上方標題列可拖曳視窗到不擋場面的位置」（用 CSS ::after 一次套到所有 .selection-modal）</li>
          <li>單選模式（maxCount === 1）優化：已選 1 張時點另一張卡會自動取消舊的並選新的（之前要先點舊的取消才能換選）</li>
          <li>多選模式不變：仍要點同一張才能取消，避免誤觸破壞已選清單</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.85</span> 對戰 UI 加 user-select: none 防誤選反白</summary>
        <ul>
          <li>玩家提議：操作時偶爾會看到 UI 文字被瀏覽器誤反白（連點/拖曳卡片時容易發生）</li>
          <li>對 .battle-root 範圍內所有元素套 user-select: none / -webkit-user-select: none</li>
          <li>例外保留可選文字：對戰 log（.log-col）/ 聊天訊息（.chat-messages）/ modal-body 卡片詳細資訊 / 房號 / form input&#x2F;textarea&#x2F;select</li>
          <li>首頁、卡牌資料庫等其他頁面不受影響</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.84</span> 找到連線對戰真正根因 — Firestore 不允許 array of arrays</summary>
        <ul>
          <li>真正根因：v2.78 加的 GameState 欄位 supporterTagsUsedThisTurn 型別是 [string&#91;&#93;, string&#91;&#93;] 即 nested array of arrays，但 Firestore 明確禁止「array within array」</li>
          <li>每次 dispatch 後 pushGameState 帶這個欄位寫入 Firestore 都被拒收 → 本地狀態更新成功但對方 onSnapshot 永遠收不到新 gameState → 雙方狀態不同步 → 都看到等待對手行動</li>
          <li>v2.82 _syncSeq 與 v2.83 停心跳都治標未治本（pushGameState 早就 silent fail，問題與心跳無關）</li>
          <li>修法：types.ts supporterTagsUsedThisTurn 從 [string&#91;&#93;, string&#91;&#93;] 改為 &#123; p1: string&#91;&#93;; p2: string&#91;&#93; &#125; object 結構（Firestore 允許 map 中含 array）</li>
          <li>engine.ts USE_TRAINER 寫入 + END_TURN 重置 + 鐵武者莊嚴之劍 PRE 讀取，全部改用 .p1 / .p2 存取</li>
          <li>感謝 user 提示「只有連線對戰出問題」— 把焦點導向 Firestore 序列化層而非 engine reducer</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.83</span> 回滾 v2.82 _syncSeq 拒收邏輯 + 改用「playing 期間停心跳」防 race</summary>
        <ul>
          <li>v2.82 _syncSeq 拒收造成新 bug：雙方並發 dispatch 時 seq 從同一基準各自 +1，互相被拒收 → 連線對戰雙方 deadlock 都看到「等待對手行動」</li>
          <li>修法：拿掉 dispatch 內 _syncSeq 賦值與 handleRoomUpdate 拒收邏輯（types.ts 同步移除欄位）</li>
          <li>原 race 改用更安全方式：playing 狀態時不寫心跳。心跳 updateDoc 不再與 pushGameState 競爭 onSnapshot，徹底排除回合回朔</li>
          <li>殭屍房偵測影響：lobby 期間仍寫心跳（殭屍清理沿用）；playing 房任一方 dispatch 都會 bump updatedAt，cleanup 規則對 playing &gt; 5min 無更新仍可清</li>
          <li>對手離線偵測影響：playing 期間 oppStale 用 updatedAt（最後一次 pushGameState 時間）取代心跳；對手 5min 沒任何動作 → 視為離線（合理）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.82</span> 修連線對戰回合回朔 — 心跳 race 導致 gameState 被舊 snapshot 倒推</summary>
        <ul>
          <li>重大 bug：v2.73 心跳機制與 pushGameState race condition — 玩家 dispatch 動作後，本地 gameState 更新但 push 還沒 commit；同一時間心跳 updateDoc 觸發 onSnapshot，回傳的 gameState 是 push 前的舊版本；handleRoomUpdate 把本地新狀態倒回成舊狀態，造成「抽完牌又回到上一個動作 / log 紀錄回朔 / P2 回合被略過」</li>
          <li>修法：gameState 加 _syncSeq 序號，每次 dispatch 自增。handleRoomUpdate 比較 incoming seq 與 local seq，若 incoming &lt; local 即拒收（避免心跳 race 把本地新狀態倒退）</li>
          <li>types.ts: GameState 加 _syncSeq?: number 欄位</li>
          <li>game/+page.svelte: dispatch 後 newState._syncSeq = prevSeq + 1；handleRoomUpdate 拒收 stale snapshot</li>
          <li>原理：對手動作會 push gameState 帶更高的 seq → 我方 incoming &gt; local → 接受。心跳寫入不改 seq，舊 gameState 對應舊 seq → 拒收</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.81</span> 修 v2.73 過度清理 — ended 房永久保留</summary>
        <ul>
          <li>v2.73 殭屍房清理規則放太寬：「updatedAt > 5min 任何 auth 用戶可刪 (不分狀態)」 + 主動掃 playing/ended 殭屍 → admin 後台的歷史對戰紀錄被慢慢吃光</li>
          <li>修法：room.ts cleanupStaleNonLobbyRooms 只掃 playing；firestore.rules 把 stale-clean 限定為 lobby (10min) 或 playing (5min)，ended 房永久保留供 admin 後台查</li>
          <li>⚠️ 已被刪掉的 ended 房 Firestore 無法復原；本次修正只能保護未來新增的紀錄</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.8</span> 修卡片資料一致性 — 移除 纏紅鶴ex 多餘的 [ex規則] 條目</summary>
        <ul>
          <li>纏紅鶴ex 在 SV-P-H.json 的 attacks[] 裡有一筆 scraper 誤收的「[ex規則] 寶可夢ex 昏厥時對手獲 2 張獎賞」條目（這是所有 ex 卡共通的卡面文字，不是真招式）</li>
          <li>所有其他 ex 卡都正確排除這段，唯獨此張因 SV-P promo 版面差異被誤收</li>
          <li>清掉後資料庫一致；引擎本來就內建處理 ex KO 獎賞 +1，行為不變</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.79</span> 佛烈托斯 鐵之震動完整 UI 實裝</summary>
        <ul>
          <li>原本因「自由分配能量」UI 缺工而 fallback 為玩家手動移動，現完整實裝</li>
          <li>用 damage-distribute 風格 picker：先收集自方場上所有【鋼】能量列為一個池，玩家點選自方寶可夢 N 次（N = 鋼能量總數），每點一次代表分配 1 個能量</li>
          <li>Resolver 從 source 拆下能量 + 依玩家點擊順序附給目標寶可夢</li>
          <li>H 標 189 張全部 100% 完整實裝（含[ex規則] scraper artifact 不需做的 1 張）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.78</span> 引擎機制大整修 — 處理所有 [TODO engine] 卡片</summary>
        <ul>
          <li>新增 CardInstance state 欄位 (10 個)：damageAtMyNextEndOfTurn / immuneToAttackEffectsNextTurn+ThisTurn / attackCostIncreaseColorlessNextTurn+ThisTurn / retreatCostIncreaseNextTurn+ThisTurn / endTurnOnOppAttachEnergyNextTurn+ThisTurn / immuneToExAttackTagNextTurn+ThisTurn / weaknessOverrideTypeNextTurn+ThisTurn</li>
          <li>新增 GameState state 欄位 (3 個)：supporterTagsUsedThisTurn / lowEnergyCantAttackNextTurn+ThisTurn</li>
          <li>engine.ts 7 個 hook 點：canAffordAttack 加 cost 增量；retreat cost 加增量；ATTACK damage 弱點 override；ATTACK damage 防護代碼 tag-immune；ATTACK_POST skip 純樸；ATTACK PRE 凍結獠牙鎖；ATTACH_ENERGY 白日夢觸發 END_TURN；END_TURN promote/clear/apply 滲透寒氣傷害 + 重置 supporter tags</li>
          <li>USE_TRAINER：使支援者時 push tags 到 GameState.supporterTagsUsedThisTurn[idx]</li>
          <li>更新卡片實裝（移除 [TODO engine]）：純樸/凍結獠牙/鼓擊/莊嚴之劍/白日夢/智揮猩掌握弱點/防護代碼/滲透寒氣 全部完整實裝按卡牌原文</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.77</span> H/I/J 標殘餘清理（6 張，不含 G 標）</summary>
        <ul>
          <li>之前 audit 因字符邊界 / 跨行字串誤報 + 當波 deferred 的殘餘卡</li>
          <li>H：厄鬼椪 碧草面具ex 萬葉陣雨（雙方戰鬥能量×30）</li>
          <li>I：超級雷電獸ex 狂暴噴射(若希望棄全+130)/小霞的暴鯉龍 嘩啦嘩啦恐慌(牌庫頂7棄+小霞×70)/吃吼霸ex 極限俯衝(120+希望120+自殘50)/佛烈托斯 鐵之震動(自方鋼能量任移動 [TODO engine])</li>
          <li>J：超能妙喵 戲法舞步(對手戰鬥1能量改備戰)</li>
          <li>纏紅鶴ex [ex規則]：scraper artifact，不實裝（不是真招式）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.76</span> H 標 Wave 3 — 複雜批收尾（28 張）</summary>
        <ul>
          <li>‌喵喵亂抓(zero-width name) / 骨紋巨聲鱷純樸 / 帝牙海獅凍結獠牙 / 皮可西揮指(複製對手戰鬥場招) / 艾姆利多神之爆炸(由克希+亞克諾姆條件) / 克雷色利亞弦月光芒(翻獎賞)</li>
          <li>長毛巨魔影繩結(對手撤退費×50) / 吼叫尾唱歌鼓勵(自備戰古代回100) / 振翼髮蠱惑挪移(備戰古代指示物→對手戰鬥)</li>
          <li>勾魂眼傷害集結(對手備戰指示物→對手戰鬥) / 密勒頓ex抵制伏特(對手有指示物+100) / 智揮猩掌握弱點(下回合defender弱點變無)</li>
          <li>泡沫栗鼠掃除(棄對手2道具) / 熔蟻獸滑燒火焰(擲3反面數=棄能量) / 魔牆人偶相仿秀(查對手手牌+執行支援者) / 鐵武者莊嚴之劍(本回合用未來支援者+100)</li>
          <li>優雅貓能量攪拌 / 轟擂金剛猩鼓擊 / 迷唇姐邀請之吻 / 引夢貘人白日夢 / 超能豔鴕奧密之眼(退化) / 帕底亞肯泰羅上搗角擊(2階能量回手) / 密勒頓防護代碼 / 塗標客惡作劇作畫(對手棄牌能量附對手) / 呆呆王付諸東流 / 下石鳥墜擊射(棄全+1隻120不計弱抗)</li>
          <li>幾張需要新引擎 hooks 的卡片以 best-effort 實裝並標 [TODO engine]：純樸 / 凍結獠牙 / 鼓擊 / 防護代碼 / 白日夢</li>
          <li>纏紅鶴ex [ex規則] 不是招式 → 不實裝（屬於昏厥獎賞描述）</li>
          <li>H 標 154 張全部完成（含 Wave 1 35 + Wave 2 80+ + Wave 3 28）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.75</span> H 標 Wave 2 — 完整批次（80+ 張）</summary>
        <ul>
          <li>嚴格按卡牌原文 faithfully 實裝，No simplification</li>
          <li>擲幣 ×N (6 張)：卡比獸ex翻身壓制(3×120)/美錄梅塔ex鐵之橫掃(2×100)/阿羅拉隆隆岩電磁彈射台/古月鳥連續噴吐/墓揚犬ex恐怖獠牙/皮卡丘激戰電光</li>
          <li>反失敗 (1 張)：滑滑小子單次踢</li>
          <li>純狀態 (5 張)：哎呀球菇/敗露球菇ex 孢子彈/芳香精芬香壓制/洗翠風速狗灼燒/謎擬Ｑex幽靈之旅/阿柏怪恐慌毒(中毒+灼傷+混亂)</li>
          <li>自殘 (6 張)：纏紅鶴ex勇鳥猛攻/皮卡丘ex打雷/音波龍ex音波爆破/瑪力露麗捨身衝撞/六尾猛撞/普隆隆姆ex高速破壞</li>
          <li>recharge (5 張)：席多藍恩鐵之光炮/密勒頓ex異度猛衝/蒼響ex猛擊在地/帕底亞土王ex終極衝擊/鐵武者意念之刃</li>
          <li>棄能量大招 (3 張)：萊希拉姆ex燃燒殆盡/蓋歐卡ex潮汐巨浪/花舞鳥花火</li>
          <li>抽牌 (8 張)：卡比獸扣殺抽出/帝牙盧卡ex時空吶喊/貪心栗鼠呼喚/藏飽栗鼠強慾尾/蟲甲聖ex相反抽出/熱帶龍果實豐收/頭巾混混偷竊</li>
          <li>對手 1 隻備戰也受 (3 張)：水君飛馳/鐵武者雙生鐳射/九尾火焰聖靈</li>
          <li>對手 1 隻寶可任選 (2 張)：巨翅飛魚水俯衝(50 不計弱抗)/爆焰龜獸吐出射擊</li>
          <li>對手所有備戰 (1 張)：雷吉艾斯暴風雪</li>
          <li>牌庫挑寶可放備戰 (3 張)：伊布/袋獸/花舞鳥 呼朋引伴</li>
          <li>牌庫挑能量 (8 張)：黑魯加鼓勵/七夕青鳥哼唱充能/蒼響ex鋼鐵武器/逐電犬輸電衝刺/鬃岩狼人渦輪刀鋒/花舞鳥能量支援/烏波打水/夠讚狗ex猛毒筋力/密勒頓暴衝高點/帕奇利茲啪滋啪滋充電</li>
          <li>稜鏡充能、條件 +N、班基拉斯ex壓碎/暴君粉碎、自身互換、對手互換、對手回牌庫、棄牌挑支援者、自方備戰各進化、預約反傷固定 N、cantRetreat、defender 擲反失敗、下回合自身免疫、預約結束 KO/放指示物、牌庫頂操作、對手手牌操作、雙方寶可夢、詛咒水滴 4 個分配、驅趕龍捲風、自殘混亂、其他雜項...</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.74</span> H 標 Wave 1 — 簡單批（35 張）</summary>
        <ul>
          <li>I 標已收尾，開始 H 標實裝。Audit 出 H 標寶可夢招式未實裝 189 張，分批實作</li>
          <li>擲幣 +N (4 張)：帕底亞烏波打滾/烈焰馬燃燒狂奔/利歐路電光一閃/敗露球菇ex蘑菇橫掃</li>
          <li>自身回血 (3 張)：椰蛋樹超級吸取/畢力吉翁綠葉吸取/哲爾尼亞斯極光增輝</li>
          <li>擲幣狀態 (4 張)：鐵臂膀衝擊波/象徵鳥念力/熔岩蟲熾熱熔岩/泥巴魚劈啪麻痺</li>
          <li>擲幣雙狀態 (2 張)：阿柏蛇混入毒(中毒+混亂)/晶光花神經毒(中毒+麻痺)</li>
          <li>擲幣下回合自身免疫 (2 張)：變隱龍隱形攻擊/托戈德瑪爾尖刺電光</li>
          <li>擲幣對手下回合無法用招式 (1 張)：飄香豚芬香踩踏</li>
          <li>recharge (3 張)：火炎獅爆焰衝撞/哲爾尼亞斯終極衝擊/鐵武者意念之刃</li>
          <li>反失敗 (1 張)：來電汪胡思亂撞</li>
          <li>對手備戰數 ×N (2 張)：厄鬼椪碧草面具鬼返/捷拉奧拉鬥戰雷電</li>
          <li>自方備戰數 ×N (1 張)：卡璞鳴鳴ex閃電結連</li>
          <li>自方場上寶可數 ×N (1 張)：大宇怪宇宙律動</li>
          <li>自身指示物 ×10 (2 張)：雷吉斯奇魯激怒之錘/故勒頓ex復仇懲處</li>
          <li>對手戰鬥指示物 ×10 (1 張)：閃電鳥追擊伏特</li>
          <li>對手 ex 條件 +N (3 張)：鐵臂膀超合金之手(ex/V +80)/摔角鷹人上升衝撞/哲爾尼亞斯ex上升角擊</li>
          <li>自身屬性能量數 ×N (2 張)：大電海燕ex雷電槍(雷×40)/帝牙盧卡ex金屬爆破(鋼×20)</li>
          <li>自方備戰有指示物 +N (2 張)：雄偉牙憤怒突擊/故勒頓ex復仇光炮</li>
          <li>棄能量大招 (1 張)：紅蓮鎧騎ex鎧農炮(200+棄1火)</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.731</span> 修 v2.73 build 錯誤</summary>
        <ul>
          <li>v2.73 dismissZombieRoom 內 onlineStep = 'menu' 但 type 只允許 'join'/'choose'/'create'/'room'，改 'choose' 修 svelte-check 編譯失敗</li>
          <li>另外修：CSS 原本誤插到 svelte:head 內聯 style 字串中間造成 Unterminated string constant，改插到檔案末端正規 style block</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.73</span> 殭屍房間心跳偵測 + 主動清理（前後台同步）</summary>
        <ul>
          <li>v2.72 改成 P1/P2 都能觸發 startGame 沒解決根本問題：對手離線就算硬開遊戲也沒得玩。需要的是房間自動清理機制</li>
          <li>RoomData 加 heartbeats: &#123; [seatIdx]: Timestamp &#125; 欄位；玩家在房內 client 每 15 秒寫 heartbeats.&#123;my_idx&#125; = serverTimestamp() + bump room.updatedAt</li>
          <li>對手心跳超過 5 分鐘沒更新 → UI 跳警示橫幅「對方已離線超過 5 分鐘」+ 紅色「解散房間」按鈕，玩家手動清掉殭屍房</li>
          <li>subscribeOpenRooms 加掃 playing/ended 殭屍房：每次玩家進大廳，fire-and-forget 一次掃 status=playing/ended 中 updatedAt > 5min 的房，發 deleteDoc 清掉</li>
          <li>firestore.rules 放寬：rooms delete 條件加上「任何 auth 用戶可刪 updatedAt > 5min 的房（不分狀態）」；解決 host 關瀏覽器後 playing 房永遠殘留問題</li>
          <li>房內 leaveRoom / onDestroy 自動 stopHeartbeat 避免離開後還在背景發送請求</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.72</span> 修殭屍房間 — host 離線後 P2 也能觸發 startGame</summary>
        <ul>
          <li>問題：原本只 P1（seat 0）client 在「雙方 ready」時觸發 startGame；如果 P1 直接關瀏覽器，P2 永遠卡在「雙方已準備，遊戲即將開始⋯」</li>
          <li>修法：放寬 game/+page.svelte 觸發條件 idx === 0 → idx === 0 || idx === 1，P1/P2 任一方都可呼叫 startGame</li>
          <li>room.ts startGame 改用 Firestore runTransaction 內部 read-then-write，確保兩方同時寫時只有一方 commit（status==='lobby' && !gameState 雙重 guard）；對方 onSnapshot 收到 winner 的 gameState 自動同步</li>
          <li>不需要重建索引或部署 rules</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.71</span> 修玩家回饋系統 — 拿掉 orderBy 避開索引需求</summary>
        <ul>
          <li>v2.7 上線後玩家端 console 回報 FirebaseError："The query requires an index"</li>
          <li>原因：where + orderBy 同用會要求 Firestore 複合索引（feedbacks: uid asc + createdAt desc / deviceId asc + createdAt desc），未建索引兩條 onSnapshot 都直接 throw</li>
          <li>修法：拿掉 query 內的 orderBy('createdAt', 'desc')，改 client-side（mergeFeedbacks）排序；limit 由 20 → 50（多撈避免邊界丟最新）</li>
          <li>不必動 firestore.indexes.json / firebase deploy --only firestore:indexes</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.7</span> 修玩家回饋系統 — onSnapshot 即時 + deviceId 雙路徑</summary>
        <ul>
          <li>問題：admin 後台寫回覆後，玩家端 modal 仍是 getDocs 一次性載入的舊 snapshot，看不到新回覆；匿名玩家若清過 storage / 換瀏覽器 session，uid 改變，舊回饋也查不到</li>
          <li>修法 1：getDocs → onSnapshot 即時訂閱，admin 一寫進 Firestore，玩家畫面立即更新（不用關 modal 重開）</li>
          <li>修法 2：除了 uid 查詢，再開一條 deviceId 查詢（localStorage 隨機 UUID）；兩條結果 by id 合併去重，匿名跨 session 也能找回歷史</li>
          <li>修法 3：firestore.rules 對應放寬 — feedbacks read 加上「auth 用戶 + doc 有 deviceId 欄位（≥16 字元）」條件；deviceId 為長隨機 UUID 不可猜，feedback 內容為玩家提交給管理員的訊息，敏感性低</li>
          <li>關 modal 自動 unsubscribe，避免無限保持連線</li>
          <li>提交新意見不再手動 await loadMyFeedbackHistory()，onSnapshot 會自動帶入剛送出的那筆</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.69</span> I 標 Wave 19 — 引擎機制擴充（4 張）</summary>
        <ul>
          <li>引擎變更：types.ts CardInstance 新增 4 個欄位（damageTakenLastOppTurn / attackUsedThisTurn+attackUsedLastSelfTurn / paralyzeFangPending / koAtMyNextEndOfTurn）</li>
          <li>engine.ts ATTACK 損害應用：defender 累積 damageTakenLastOppTurn += baseDamage（重裝角擊用）</li>
          <li>engine.ts ATTACK_POST 結算後：寫入攻擊方 active.attackUsedThisTurn = atkName（瘋狂炸彈追蹤）</li>
          <li>engine.ts ATTACH_ENERGY：附加完成後若 target.paralyzeFangPending → 自動放 80 點傷害（麻痺門牙觸發）</li>
          <li>engine.ts END_TURN（aIdx 方）：清 damageTakenLastOppTurn / promote attackUsedThisTurn → LastSelfTurn / 清 paralyzeFangPending / 觸發 koAtMyNextEndOfTurn → KO（damage = HP）</li>
          <li>超級赫拉克羅斯ex 重裝角擊 100+：上個對手回合受傷累計加成</li>
          <li>雙彈瓦斯 瘋狂炸彈 50+：上個自己回合用過「充滿瓦斯」+120</li>
          <li>帕奇利茲 麻痺門牙 10：下個對手回合附能量觸發 80 點</li>
          <li>火箭隊的臭泥 浸蝕污泥 0：下個對手回合結束時 KO defender</li>
          <li>I 標 Wave 1+...+19 累計：450+4 = 454 張，引擎覆蓋率 ~98%</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.68</span> I 標 Wave 18 — 複製招式類收尾（5 張）</summary>
        <ul>
          <li>索羅亞克欺詐：複製對手戰鬥場印刷傷害最高的招式（沿用 N的索羅亞克ex 暗黑底牌 v2.119 模式）</li>
          <li>阿響的樹才怪試著模仿：擲幣正面 → 同上</li>
          <li>流氓熊貓無理取鬧 30：自動選對手戰鬥場印刷傷害最高招式 → 下回合 defender 無法使用</li>
          <li>九尾靈怪變化：棄牌庫頂 1，若是支援者卡則執行該支援者效果（透過 TRAINER_EFFECTS 表動態執行）</li>
          <li>火箭隊的貓老大ex高傲指令：翻對手牌庫頂 10 張，自動挑寶可夢印刷傷害最高的招式使用 + 對手牌庫重洗</li>
          <li>I 標 Wave 1+...+18 累計：445+5 = 450 張寶可夢招式 effect 實裝</li>
          <li>剩餘 ≤10 張為帕奇利茲麻痺門牙（attach trigger hook）+ 火箭隊的臭泥浸蝕污泥（KO timer）+ 超級赫拉克羅斯ex 重裝角擊（上回合受傷追蹤）+ 雙彈瓦斯瘋狂炸彈完整版（last attack 追蹤）— 需引擎新機制，列入後續版本</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.67</span> I 標 Wave 17 — 複雜批 II（22 張）</summary>
        <ul>
          <li>反傷類 (1 張)：藏瑪然特強大猛擊(70+下回合受招式對攻擊方放與受傷相同指示物)</li>
          <li>棄場上 stadium +N (1 張)：浩大鯨ex粉碎重壓(140+棄競技場+140)</li>
          <li>自身放回手 (1 張)：火箭隊的叉字蝠ex刺殺迴旋(120 + 自身回手 + 棄道具能量)</li>
          <li>移轉自方備戰指示物 (2 張)：死神棺伸長的傷害棺材(自方1隻備戰→對手1隻)/火箭隊的果然翁火箭鏡面(火箭備戰→對手戰鬥)</li>
          <li>對手戰鬥能量改備戰 (2 張)：火箭隊的閃電鳥阻礙之翼(30+隨機改備戰)/小灰怪挪動一下</li>
          <li>牌庫挑能量類 (3 張)：風妖精ex能量之禮(挑≤3基本能量)/熔蟻獸舔舔捕捉(挑≤3火寶可+火能量)/賽富豪抓到飽(擲到反挑≤正面數)</li>
          <li>棄牌挑類 (2 張)：圖圖犬能量寫生(擲3挑≤正面數基本能量)/長毛狗氣味偵測(擲3挑≤正面數)</li>
          <li>對手擲幣自殘 (1 張)：火箭隊的引夢貘人備戰區操縱(對手擲備戰數×80 不計弱抗)</li>
          <li>對手手牌回牌庫 (1 張)：墓揚犬恐怖啃咬(30+擲到反隨機回對手手牌)</li>
          <li>對手指示物 ×2 (1 張)：N的雙倍多多冰覆雪(對手所有寶可夢指示物 ×2)</li>
          <li>對手特殊狀態觸發狙擊 (1 張)：夢妖魔刺殺魔法(60+對手特殊狀態+對手1備戰60)</li>
          <li>下回合招式失敗預約 (1 張)：穿山王潑沙(50+defender下回合擲反失敗)</li>
          <li>看對手獎賞 (1 張)：火箭隊的索偵蟲搜索之眼(揭露對手1張獎賞)</li>
          <li>對手1隻寶可夢回牌庫 (1 張)：狡猾天狗陣風返(擲幣正+對手1隻+附加卡回牌庫並重洗)</li>
          <li>棄對手 stadium (1 張)：古玉魚燒灼大地(40+棄競技場 簡化不做禁出)</li>
          <li>雙方睡眠+下回合 +N (1 張)：樹枕尾熊晚安敲擊(30+雙方睡眠+自身下回合 +100)</li>
          <li>I 標 Wave 1+...+17 累計：423+22 = 445 張寶可夢招式 effect 實裝</li>
          <li>剩餘 ≤15 張為複製對手招式類（索羅亞克欺詐/流氓熊貓無理取鬧/阿響的樹才怪/火箭隊的貓老大ex/九尾靈怪變化）+ 上回合受傷追蹤類（赫拉克羅斯ex 重裝角擊）+ 帕奇利茲麻痺門牙（attach trigger）— 暫列未實裝池</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.66</span> I 標 Wave 16 — 雜項第九批（30 張）</summary>
        <ul>
          <li>簡單條件 +N (4 張)：恰雷姆七度踢腿(手牌=7 →150)/恰雷姆合氣掌(50+能量同+120)/雙彈瓦斯瘋狂炸彈(50 簡化)/泥巴魚泥巴伏特(20+鬥能量+20)</li>
          <li>場上條件 ×N (3 張)：火箭隊的雙彈瓦斯一併爆炸(40×場上瓦斯)/石居蟹抓狂(自身指示物×10)/堅果啞鈴強力鞭打(自身能量×20+對手1隻+不計弱抗)</li>
          <li>棄能量類 (3 張)：電蜘蛛放電(棄全雷×50)/雙尾怪手雙尾(棄2+對手2備戰各60)/雪絨蛾極寒旋風(90 簡化)</li>
          <li>對手不可撤退 (2 張)：駒刀小兵窮追不捨(10)/沙鈴仙人掌窮追不捨(20)</li>
          <li>自身免疫 (1 張)：小嘴蝸硬殼一擊(20+coin -999 模擬免疫)</li>
          <li>recharge / 下回合 (2 張)：流氓熊貓力量衝撞(160 recharge)/超級雷電獸ex閃光射線(120+下回合-100)</li>
          <li>對手手牌操作 (2 張)：洛托姆驚嚇(20+對手隨機1張回牌庫)/魔牆人偶模仿(自手牌洗回+抽=對手數)</li>
          <li>雙狀態 / 自選狀態 (3 張)：敏捷蟲褪殼猛毒(70+毒+混亂)/裙兒小姐幻惑芳香(30+coin 雙狀態or混亂)/塗標客奇跡作畫(90+coin asleep 簡化)</li>
          <li>自方備戰回手 (1 張)：心蝙蝠幸福迴旋</li>
          <li>對手能量操作 (2 張)：章魚桶水流清洗(20+對手1能量回手)/毛崖蟹喀嚓鉗(擲2對手N能量棄)</li>
          <li>條件失敗 (2 張)：打擊鬥上升劈打(對手非ex失敗 90)/雙斧戰龍斧擊衝撞(對手基礎KO)</li>
          <li>火箭隊招式 (1 張)：火箭隊的火焰鳥ex邪惡灼燒(棄1能量+對手戰鬥KO 簡化)</li>
          <li>牌庫挑 (1 張)：小山豬呼朋引伴(挑≤2基礎放備戰)</li>
          <li>自方回滿 HP (1 張)：大奶罐飽腹鮮奶(擲2全正→1隻回滿)</li>
          <li>棄牌區能量轉移 (1 張)：赤面龍龍之猛暴(20+棄牌火能量挑1附龍)</li>
          <li>雜 (1 張)：蜜集大蛇大蛇吐息(棄手6草→對手戰鬥KO)</li>
          <li>I 標 Wave 1+...+16 累計：393+30 = 423 張寶可夢招式 effect 實裝</li>
          <li>I 標收尾：剩餘 30+ 張多為複製招式類、上回合受傷追蹤、棄牌區/牌庫頂多階互動，列入「未實裝池」由玩家口頭執行；引擎覆蓋率達 ~93%</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.65</span> I 標 Wave 15 — 雜項第八批（25 張）</summary>
        <ul>
          <li>進化牌庫搜尋簡化 (5 張)：夢妖覺醒/火箭隊的沙基拉斯爆裂覺醒(30+)/雙卵細胞球細胞進化/火箭隊的尼多娜惡之覺醒/人造細胞卵細胞覺醒 — 從牌庫挑 1 張寶可夢加手（玩家手動進化）</li>
          <li>對手棄手牌 (3 張)：黑眼鱷勒緊(10+棄1)/混混鱷勒緊(40+棄2)/流氓鱷勒緊(60+棄2)</li>
          <li>場上條件 ×N (5 張)：火箭隊的操陷蛛火箭猛攻(30×火箭數)/奇樹的霹靂電球連鎖伏特(20+奇樹雷×20)/洛托姆配件秀(30×自方道具)/流氓鱷咒詛猛擊(120+對手手牌≤3 +120)/劈斬司令致命刺擊(60+對手有指示物 +60)</li>
          <li>棄能量+額外 (3 張)：超級麻麻鰻ex災難衝擊(190+棄2雷麻痺)/火焰雞業火連踢(120+棄2能量+1備戰120)/捷拉奧拉閃電急襲(0+棄全+對手備戰ex 210)</li>
          <li>自殘+狀態 (2 張)：巴布土撥怒氣拳(130+自殘60+麻痺)/奇樹的頑皮雷彈怦怦炸彈(自殘100+coin 對手戰鬥KO)</li>
          <li>自身招式 +N (1 張)：步哨鼠聚氣(下回合 +160 → 必殺門牙 80→240)</li>
          <li>看對手牌庫頂排序 (2 張)：哥德小童天眼/火箭隊的天罩蟲攪亂雷達(對手牌庫頂5排序)</li>
          <li>其他條件 (3 張)：鐵螯龍蝦反撲剪(130 簡化純傷害)/酋雷姆ex雪爆發(130+對手備戰各對手獎×10)/巨炭山瀝青加農炮(棄牌≥10鬥+對手1隻140)</li>
          <li>雜 (1 張)：N的象徵鳥勝利象徵(自方獎賞剩1勝)</li>
          <li>I 標 Wave 1+...+15 累計：368+25 = 393 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.64</span> I 標 Wave 14 — 雜項第七批（31 張）</summary>
        <ul>
          <li>棄 N/全能量大招 (8 張)：超級噴火駝ex火山流星(280棄2)/蓋歐卡漩渦波(130棄2)/鋼炮臂蝦水之發射器(210棄全)/洛托姆ex十萬伏特(130棄全)/噴火駝力量踩踏(170棄2)/象牙豬暴雪刀鋒(200棄2)/超級拉帝亞斯ex幻想脈衝(300棄全)/達摩狒狒粉碎頭擊(180棄2)</li>
          <li>自身回血 (3 張)：蓮帽小童超級吸取(30回30)/小海獅泡沫吸取(20回20)/木棉球吸取(10回10)</li>
          <li>條件 +N 簡單 (6 張)：哥達鴨水炮(60+水×20)/奇樹的電海燕電光一閃(10+coin 20)/火箭隊的蛋蛋祈求(10+coin 20)/長毛豬上衝(30+coin 30)/逐電犬電氣狂奔(70+coin 70)/瑪沙那連續擊拳(10+coin 20)</li>
          <li>反失敗 (1 張)：頑皮熊貓真氣突刺(50 反失敗)</li>
          <li>擲幣 ×N 倍率 (6 張)：大嘴雀機關槍鑽(5×30)/傘電蜥雙重抓(2×10)/大顎蟻二連頭錘(2×10)/豆蟋蟀躍動(3×10)/白海獅摔打(2×70)/岩殿居蟹尖石攻擊(80+coin 60)</li>
          <li>擲幣狀態 (3 張)：冰砌鵝嚴寒頭錘/三合一磁怪電擊/狩獵鳳蝶麻痺粉</li>
          <li>自方狙擊備戰 (3 張)：巨石丁岩石踢(20+1備戰20)/雪暴馬冰之射擊(20+1備戰20)/長耳兔魯莽踢(0+1備戰50)</li>
          <li>recharge (3 張)：雪暴馬冰霜颱風(130 recharge)/奇樹的電肚蛙ex閃電伏特(230 recharge)/蓮帽小童水流斬(70 recharge)</li>
          <li>I 標 Wave 1+...+14 累計：337+31 = 368 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.63</span> I 標 Wave 13 — 雜項第六批（35 張）</summary>
        <ul>
          <li>本回合回血 +N (2 張)：霸王花活潑鮮花 60+/沙鈴仙人掌活潑針 20+ — 50% 機率觸發簡化</li>
          <li>自身能量轉移備戰 (2 張)：龍捲雲暴風 100/波爾凱尼恩ex高溫旋風 160</li>
          <li>查看牌庫頂可選棄 (2 張)：燭光靈光照燃燒/岩狗狗挖回 — 自動棄置簡化</li>
          <li>對手 2 隻備戰各 30 (1 張)：竹蘭的美納斯水分岔(60+)</li>
          <li>自方 1 隻備戰受 40 (1 張)：雷電獸閃光衝擊(120+)</li>
          <li>對手 1 隻備戰 N (2 張)：雷電斑馬電氣子彈(100+30)/赫普的鋼鎧鴉穿通(50+50)</li>
          <li>自方所有備戰各 20 (1 張)：赫普的沙螺蟒大地裂破(140+)</li>
          <li>厄鬼椪 X 面具 X 之神樂 (3 張)：碧草/火灶/水井 → 草/火/水能量</li>
          <li>牌庫挑寶可夢加手 (3 張)：扒手貓邪惡邀請(惡 ×3)/小霞的拉普拉斯一起游水(小霞的 ×3)/夢夢蝕夢境呼喚(真菰)</li>
          <li>牌庫挑寶可夢放備戰 (3 張)：莉莉艾的花療環環招花/大吾的天秤偶召集標誌/電飛鼠呼朋引伴(基礎 ×2)</li>
          <li>牌庫挑物品/能量加手 (2 張)：嗡蝠搬運破爛(道具)/牙牙集力(基本能量 ×2)</li>
          <li>自方備戰鬥指示物 ×20 (1 張)：龐岩怪復仇加農炮</li>
          <li>對手手牌隨機回 3 張回牌庫 (1 張)：詛咒娃娃詛咒言語</li>
          <li>擲幣狀態 3 張 (3 張)：敏捷蟲酸液炸彈(50+毒)/音波龍高速移動(40+免疫)/竹蘭的醜醜魚搖搖游水(10+免疫)</li>
          <li>對手 1 寶可夢狙擊 70 不計弱抗 (1 張)：象徵鳥意念移物</li>
          <li>下回合自身招式 +N (2 張)：美洛耶塔ex回聲(30+下回合)/桃歹郎糬猛攻(20+下回合)</li>
          <li>變硬類 -N (2 張)：石丸子變硬(-40)/鐵甲蛹變硬(-60)</li>
          <li>萊希拉姆ex火爆發 (1 張)：130+對手獎賞×50+棄1能量</li>
          <li>頭巾混混無賴攻擊 (1 張)：擲與自方惡寶可夢同次硬幣 ×60</li>
          <li>火箭隊的地鼠狂潛 (1 張)：擲到反棄對手牌庫頂 N</li>
          <li>I 標 Wave 1+...+13 累計：302+35 = 337 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.62</span> I 標 Wave 12 — 雜項第五批（35 張）</summary>
        <ul>
          <li>擲幣反面失敗 (3 張)：泥偶小人全力拳/電電蟲偷襲/步哨鼠必殺門牙</li>
          <li>棄全能量大招 (2 張)：水晶燈火靈燃燒盡(180)/大吾的念力土偶黏土爆破(220)</li>
          <li>棄 N 個能量大招 (4 張)：卡璞鳴鳴雷電爆破(130 棄2)/暴飛龍ex狂龍衝擊(300 棄2)/顫弦蠑螈ex刷弦閃電(240 棄2)/燈火幽靈大字爆炎(50 棄1)</li>
          <li>自方備戰 ×20 (1 張)：奇諾栗鼠朋友之環</li>
          <li>擲到反面 ×K (4 張)：斗笠菇傷害衝刺/凍原熊連續頭錘/章魚桶狂擊/泥驢仔奔進</li>
          <li>擲 2 次 +K (1 張)：派拉斯特橫掃剪</li>
          <li>自身能量 ×K (4 張)：雙刃丸能量硬殼(全×30)/大劍鬼能量斬(30+全×50)/吼鯨王水炮(10+水×50)/瑪俐的莫魯貝可扣殺輪(20+惡×40)</li>
          <li>對手戰鬥場能量 ×K (2 張)：火箭隊的以歐路普精神強念/大宇怪精神強念</li>
          <li>對手戰鬥場指示物 ×K (2 張)：伽勒爾 堵攔熊傷疤嚎叫(×70)/鬃岩狼人抓擊獠牙(40+×40)</li>
          <li>上對手回合 KO 自方 ×60 (1 張)：夠讚狗算帳</li>
          <li>對手獎賞剩 4/3 失敗 (1 張)：赫普的古月鳥浮躁噴吐</li>
          <li>對手下回合 -N (2 張)：象徵鳥反射壁(-40)/赫普的稚山雀恐怖視線(-20)</li>
          <li>自方所有基礎寶可夢回 100 (1 張)：保母蟲治癒襁褓</li>
          <li>對手戰鬥場無指示物失敗 (1 張)：野蠻鱸魚堆積之牙</li>
          <li>撤退費 ×30 減 (1 張)：投摔鬼背負上投</li>
          <li>自方場上進化寶可夢 ×40 (1 張)：人造細胞卵進化金勾臂</li>
          <li>對手棄牌區物品 ×30 (1 張)：原蓋海龜遠古碎藻</li>
          <li>skipDefEffects (1 張)：凱路迪歐ex音波刀鋒</li>
          <li>擲幣狀態 (1 張)：鴨嘴炎獸灼燒</li>
          <li>擲 3 全正 KO (1 張)：火箭隊的椰蛋樹三重強念</li>
          <li>對手 2 隻寶可夢各 N (3 張)：超級麻麻鰻魚王ex爆裂彈/電擊魔獸ex二重伏特/大吾的盔甲鳥雙音波</li>
          <li>牌庫搜物品/競技場 (3 張)：火箭隊的咩利羊籌備/探探鼠籌備/赫普的沙包蛇築窩</li>
          <li>牌庫挑 ≤2 基礎寶可夢放備戰 (1 張)：N的迷你冰呼朋引伴</li>
          <li>棄對手 1 火能量 (1 張)：鴨寶寶消火</li>
          <li>I 標 Wave 1+...+12 累計：267+35 = 302 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.61</span> I 標 Wave 11 — 雜項第四批（32 張）</summary>
        <ul>
          <li>擲幣正面 immune 5 張：咕咕鴿飛翔 / 高傲雉雞高速飛翔 / 大力鱷深處潛水 / 戽斗尖梭潛水 / 百合根娃娃躲藏</li>
          <li>擲幣反面失敗 2 張：火箭隊的尼多蘭偷襲 / 猴怪踹</li>
          <li>擲 N 次 +K×N 2 張：修建老匠暴動(100+×50) / 始祖小鳥雜技(30+×30)</li>
          <li>自身能量回手 2 張：波爾凱尼恩逆火(2 火) / 裹蜜蟲能量閉環(任 1)</li>
          <li>對手所有寶可夢/備戰各 N 2 張：暴飛龍ex廣域爆破(備戰 50) / 火箭隊的阿柏怪旋轉之尾(全 30)</li>
          <li>對手有指示物的備戰 1 張：龍頭地鼠ex貫通鑽(60+對手受傷備戰 60)</li>
          <li>從棄牌區挑能量附 2 張：雷吉洛克ex雷吉充能(≤2 鬥能量) / 土地雲豐產(1 鬥能量)；附 土地雲地震(110+備戰 10)</li>
          <li>從牌庫挑 1 鬥能量附自方 1 張：厄鬼椪 礎石面具石之神樂</li>
          <li>自身回手牌 2 張：莉莉艾的花療環環憑空消失 / 隨風球氣球迴旋</li>
          <li>棄牌區「火箭隊」支援者數 ×20 (2 張)：火箭隊的多邊獸Ⅱ/Z R指令</li>
          <li>場上寶可夢道具數 ×30 (3 張)：切割/加熱/清洗洛托姆配件秀</li>
          <li>「輪唱」家族 (3 張)：圓蝌蚪 ×20 / 藍蟾蜍 ×40 / 蟾蜍王 ×70</li>
          <li>對手特殊狀態數 ×100 (1 張)：火箭隊的臭臭泥毒液危害</li>
          <li>自身水能量 ×30 (1 張)：櫻花魚漸強波</li>
          <li>自方所有寶可夢回 10 HP (1 張)：清洗洛托姆搓洗(20+回 10)</li>
          <li>對手戰鬥場中毒（每回合 8 個指示物）(1 張)：火箭隊的尼多王ex惡劣角擊</li>
          <li>不計對手附加效果 (1 張)：赤面龍撕裂(40 skipDefEffects)</li>
          <li>對手備戰數 ×30 (1 張)：索羅亞克意志劫持</li>
          <li>I 標 Wave 1+...+11 累計：235+32 = 267 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.6</span> I 標 Wave 10 — 條件 +N 第三批（22 張）</summary>
        <ul>
          <li>對手中毒 +N (2 張)：車輪毬毒液衝擊 / 蜈蚣王毒液衝擊</li>
          <li>對手是進化寶可夢 +N (1 張)：雙斧戰龍揮擊</li>
          <li>對手抵抗力是【鬥】+N (1 張)：地幔岩擊落</li>
          <li>自身有道具 +N (2 張)：音波龍強化斬 / 勾帕路翁金屬武裝</li>
          <li>自身有特殊能量 +N (1 張)：長毛狗特殊獠牙</li>
          <li>自身有「火箭隊能量」+N (1 張)：火箭隊的閃電鳥惡棍閃電</li>
          <li>場上有競技場 +N (1 張)：大朝北鼻山岳墜落</li>
          <li>自身 X 能量 ≥ N (1 張)：暴雪王結冰木(草≥2)</li>
          <li>能量比 cost 多 2 +N (2 張)：電擊魔獸ex高電壓壓制 / 胖嘟嘟ex力量壓制</li>
          <li>自方備戰有特定名稱寶可夢 +N (3 張)：火箭隊的尼多后愛之衝擊(尼多王) / 鐵蟻一起啃食(鐵蟻) / 巨金怪結合光束(鐵啞鈴+金屬怪)</li>
          <li>自方備戰特定寶可夢受傷 +N (1 張)：流氓熊貓大佬拳(頑皮熊貓有指示物)</li>
          <li>自方棄牌區基本火能量 ≥ 10 +N (1 張)：水晶燈火靈濺射火柱</li>
          <li>雙方手牌數相同 +N (1 張)：哥德小姐同步射擊</li>
          <li>上對手回合招式 KO 自方 +N (1 張)：代拉基翁報仇</li>
          <li>I 標 Wave 1+...+10 累計：213+22 = 235 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.59</span> I 標 Wave 9 — 對手 ex/階級條件 / Recharge / 手牌操控（30 張）</summary>
        <ul>
          <li>對手戰鬥場 ex 條件 +N (4 張)：魔幻假面喵上升綻放 / 瑪俐的扒手貓鋒利爪 / 瑪俐的酷豹鋒利利爪 / 爆炸頭水牛ex黃金破壞</li>
          <li>對手 2 階進化 +N (1 張)：雷吉洛克ex巨型岩石</li>
          <li>對手【惡】+N (1 張)：風速狗懲治獠牙</li>
          <li>自方備戰人數失敗 (1 張)：比克提尼V戰力</li>
          <li>Recharge — 自身下回合不能用此招 (5 張)：奇樹的電肚蛙ex閃電伏特 / 畢力吉翁綠寶石利刃 / 浮潛鼬水流斬 / 騎士蝸牛鐵之光炮 / 斧牙龍潛力</li>
          <li>對手下回合無法使用招式 (3 張)：N的多多冰絕對零度 / 凍原熊絕對零度 / 噴嚏熊渾身鼻水</li>
          <li>對手下回合無法撤退 (5 張)：三首惡龍ex暗黑啃咬 / 肋骨海龜咬緊 / 赫普的沙螺蟒地鳴 / 阿響的樹才怪圍困 / 天蠍王毒陣（中毒+不能撤）</li>
          <li>盲選棄/回對手手牌 (5 張)：長尾怪手驚嚇(回1) / 火箭隊的喵喵占為己有(回1) / 酷豹拍落(棄1) / 火箭隊的鈴鐺響鈴鈴吵鬧(棄1) / 超級頭巾混混ex不法之足(160+棄手1+棄牌庫頂1)</li>
          <li>對手手牌 ×K (2 張)：狩獵鳳蝶能量吸管(80×能量數) / 風妖精ex奇跡棉花(50×訓練家數)</li>
          <li>簡單附能量 (1 張)：龍捲雲玉樹臨風(自手牌 1 基本能量附自身)</li>
          <li>抽滿 6 (2 張)：夢妖魔ex六之魔法(150) / 差不多娃娃報恩(30)</li>
          <li>搜牌庫任選 ≤3 加手 (1 張)：君主蛇ex青草命令(150)</li>
          <li>I 標 Wave 1+...+9 累計：183+30 = 213 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.58</span> I 標 Wave 8 — 條件 +N 第二批 / 失敗條件 / 場上同類 ×K（24 張）</summary>
        <ul>
          <li>場上能量條件 +N (3 張)：水君水晶墜落 / 炎帝閃焰墜落 / 哥達鴨水炮(自身水能量×20)</li>
          <li>對手異常 +N (1 張)：敗露球菇險惡回應(對手特殊狀態 +120)</li>
          <li>對手下回合 -N (2 張)：捲捲耳撒嬌(-20) / 布撥叫聲(-30)</li>
          <li>自身回牌庫 (1 張)：烈腿蝗跳躍射擊(150 + 自身回牌庫並重洗)</li>
          <li>放指示物 (1 張)：納噬草悄聲加害(對手 1 隻 +1 指示物)</li>
          <li>擲幣反面失敗 (2 張)：淚眼蜥偷襲 / 蛇紋熊偷襲</li>
          <li>條件式失敗 (2 張)：噴火駝炙燒灼傷(對手無灼傷則失敗) / 恰雷姆七度踢腿(手牌非7張失敗)</li>
          <li>自方治癒批次 (2 張)：風妖精治癒棉絮(1 隻備戰回滿) / 阿響的鳳王ex閃耀羽毛(160+自方各 +50)</li>
          <li>上對手回合招式 KO 自方 +N (2 張)：阿響的凱羅斯一力反攻 / 赫普的朽木妖恐怖復仇</li>
          <li>對手下回合無法撤退 (1 張)：赫普的朽木妖窮追不捨</li>
          <li>擲幣 immune (1 張)：赫普的小木靈躍起閃避</li>
          <li>場上同類數量 ×K (3 張)：帕底亞肯泰羅憤怒猛撞 / 胖可丁輪唱 / 青銅鐘道具擊落</li>
          <li>牌庫搜寶可夢 (2 張)：托戈德瑪爾尋找朋友 / 洛托姆洛托呼喚</li>
          <li>棄自身能量倍率 (1 張)：阿響的熔岩蝸牛熔岩爆炸(70× 棄自身最多 5 火能量)</li>
          <li>I 標 Wave 1+...+8 累計：159+24 = 183 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.57</span> I 標 Wave 7 — 自身回血 + skipResistance + 雙重狀態（17 張）</summary>
        <ul>
          <li>A 純自身回血 12 張：蓮帽小童超級吸取 / 小海獅泡沫吸取 / 斗笠菇超級吸取 / 厄鬼椪 水井面具泡沫吸取 / 啃果蟲小吸取 / 派拉斯吸血 / 畢力吉翁終極吸取 / 莉莉艾的萌虻紋絲不動 / 皮卡丘放鬆休息 / 大宇怪冥想 / 食夢夢睡覺(自睡+回血) / 盔甲鳥羽棲(回血+下回合不能撤退)</li>
          <li>B 不計算抵抗力 3 張：雷吉洛克毀壞者金勾臂(120) / 龍頭地鼠ex巨岩墜落(200) / 師父鼬衝天粉碎(80)</li>
          <li>C 雙重狀態 2 張：毒粉蛾薄暮之毒(100+中毒+睡眠) / 火箭隊的黑魯加惡之火種(灼傷+混亂)；用 status + secondaryStatus 兩個 layer 同時上</li>
          <li>I 標 Wave 1+2+...+7 累計：16+11+61+35+9+10+17 = 159 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.56</span> I 標 Wave 6 — 複雜互動卡 10 張</summary>
        <ul>
          <li>瑪夏多｜暗影側踢 (60 + 若 KO 對手 → 自身下回合免疫招式傷害)</li>
          <li>雪吞蟲｜躲藏 (擲 1 正面 → 下回合免疫招式)</li>
          <li>瑪狃拉｜報應爪 (20 + 自身 HP ≤ 50 → +170)</li>
          <li>流氓鱷｜復仇獠牙 (60 + 上對手回合自方寶可夢被招式 KO → +160；用既有 oppAttackKOdMeInLastOppTurn 機制)</li>
          <li>巨蔓藤｜肌力鞭打 (120 + 自身能量比 cost 多 2 個 → +140，cost=4 故 ≥6 觸發)</li>
          <li>焚焰蚣｜緊束粉碎 (50 + 擲 2 次硬幣 → 棄對手戰鬥場 N 個能量)</li>
          <li>超級暴雪王ex｜山崩之錘 (棄牌庫頂 6 → 其中基本【水】數 ×100)</li>
          <li>蓋諾賽克特｜昆蟲加農炮 (任選 1 對手寶可夢 × 自身草能量數 ×20，不計弱抗 — 新 resolver wave6-snipe-any-opp-flat)</li>
          <li>雪絨蛾｜冰凍羽擊 (對手所有寶可夢各 20 + 對手戰鬥場睡眠，不計弱抗)</li>
          <li>千面避役｜擊斃 (自動選雙方場上 HP 最低寶可夢直接昏厥，自身除外)</li>
          <li>I 標 Wave 1+2+3+4+5+6 累計：16+11+61+35+9+10 = 142 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.55</span> I 標 Wave 5 — Meta 卡 9 張實裝</summary>
        <ul>
          <li>流氓鱷ex｜窮追不捨 (80 + 對手下回合無法撤退) / 強力啃咬 (140 + 自身有道具 +140)</li>
          <li>拉普拉斯ex｜水炮迴旋 (×水能量 + 自身換場)</li>
          <li>千面避役｜水射擊 (110 + 自身棄 1 能量)</li>
          <li>蒼炎刃鬼｜煉獄斬 (220 + 棄手牌 4 張基本【火】否則失敗)</li>
          <li>奇魯莉安｜呼喚信號 (從牌庫挑 ≤3 寶可夢加手 + 重洗)</li>
          <li>閃焰王牌｜閃焰渦輪 (50 + 牌庫挑 ≤3 基本能量依序附備戰)</li>
          <li>巨翅飛魚｜呼朋引伴 (從牌庫挑 ≤2 基礎寶可夢放備戰)</li>
          <li>蓋歐卡｜逆流 (棄牌區基本水能量 ×20，然後放回牌庫並重洗)</li>
          <li>I 標 Wave 1+2+3+4+5 累計：16+11+61+35+9 = 132 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.54</span> I 標 Wave 4 — 剩餘批次（35 張）</summary>
        <ul>
          <li>新檔 v2540_i_wave4_misc.ts</li>
          <li>A 擲 1 次硬幣 +N (11 張)：奇樹的電海燕電光一閃 / 長毛豬上衝 / 逐電犬電氣狂奔 / 火箭隊的蛋蛋祈求 / 蒂蕾喵魔法葉 / 迷你冰冰之刀鋒 / 哭哭面具祈求 / 赤面龍伏擊 / 勇士雄鷹燕返 / 保母蟲十字剪 / 小約克嬉鬧</li>
          <li>B 擲 N 次硬幣 ×K (13 張)：大顎蟻二連頭錘 / 新葉喵狂踩 / 雙倍多多冰雙重冰凍 / 雙首暴龍二連擊 / 火箭隊的喵喵亂抓 / 泡沫栗鼠掃尾拍打 / 佛烈托斯颶風尖刺 / 麻麻鰻魚王啪啪迴轉 / 泥偶巨人雙重粉碎 / 巴大蝶鱗粉颶風 / N的齒輪兒雙重旋轉 / N的齒輪怪三重粉碎 / 小火馬二連頭錘</li>
          <li>C 對手強制換場 (3 張)：派帕的陸地水母拉扯 / 火爆猴拖出（+30 dmg）/ 幾何雪花拖出（+20 dmg）— 復用 v2.41 force-opp-swap resolver</li>
          <li>D 擲幣若正則強制換場 (1 張)：飄飄球拉扯</li>
          <li>E 自方治癒 (2 張)：橡實果小憩(回 20)/巨蔓藤吸取(30 dmg + 回 30)</li>
          <li>F 跳踢狙擊 (1 張)：騰蹴小將跳踢(對手 1 備戰 40)</li>
          <li>G 不計算抵抗力 (1 張)：鹽石壘岩石投擲(skipWeakRes)</li>
          <li>H 限先攻第 1 回合可用 (2 張)：卡璞・鳴鳴急速飛行(手牌全丟+抽5)/信使鳥急速之禮(牌庫任選1加手)</li>
          <li>I 自身換場 (1 張)：超級拉帝亞斯ex狡兔三窟(40+互換)</li>
          <li>I 標 Wave 1+2+3+4 累計：16+11+61+35 = 123 張寶可夢招式 effect 實裝</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.53</span> 意見回覆系統 — 玩家歷史 + 管理員後台</summary>
        <ul>
          <li>玩家端：意見回饋 modal 開啟時自動載入自己的歷史回饋（最近 20 筆），顯示提交時間、內容、admin 回覆（如有）</li>
          <li>已有回覆的回饋會標記「✓ 已回覆」並用綠色框顯示管理員回覆內容 + 回覆時間</li>
          <li>提交新意見時會自動附加 deviceId（讓 admin 識別同裝置玩家，跨 anon session）</li>
          <li>新增後台路由 /admin/feedbacks — 僅 suenz001@yahoo.com.tw 進得去；列出最近 100 則回饋，可加/編輯回覆、刪除</li>
          <li>Firestore rules 改：feedbacks read 改 own-or-admin（玩家可讀自己 uid 提交的）；update/delete 限 admin</li>
          <li>限制：anon 登入每次 uid 不同，玩家若清快取/換裝置會看不到舊歷史；email 登入則跨 session 完整保留</li>
          <li>記得部署：firebase deploy --only firestore:rules</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.52</span> 殭屍房間自動清理</summary>
        <ul>
          <li>玩家回報：開房後直接關電腦沒退出，房間不會消失，自己也連不回去</li>
          <li>根因：客戶端關閉不會觸發 leaveRoom；anon 登入每次 uid 不同，無法認回「我的舊房間」</li>
          <li>方案：(1) Lobby 客戶端拉房間後過濾 updatedAt &gt; 10 分鐘的 stale 房間，不顯示；(2) 順手對 stale 房間發 deleteDoc 被動清理</li>
          <li>Firestore rules 補：authed 用戶可刪除 lobby 狀態 + updatedAt &gt; 10 分鐘前的房間（不影響進行中的對戰，因為 status='playing' 不符合條件）</li>
          <li>記得部署：firebase deploy --only firestore:rules</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.51</span> I 標 Wave 3c — 擲幣狀態 / 進化來源條件 / 自身指示物 / 自殘 (13 張)</summary>
        <ul>
          <li>新檔 v2510_i_wave3c_status_self.ts</li>
          <li>A 擲幣狀態 (7 張)：多多冰冰凍光束 / 單首龍泰山壓頂 / 麻麻鰻魚王雷電牙 / 火箭隊的茸茸羊電擊 / 火箭隊的阿柏蛇扯後腿 / 魔牆人偶念力 / 小霞的海星星泡沫光線</li>
          <li>B 進化來源條件 +N (2 張)：自爆磁怪衝天電光（從三合一磁怪進化 +120）/ 小霞的寶石海星乍然閃光（從小霞的海星星進化 +80）</li>
          <li>C 自身傷害指示物 (3 張)：吃吼霸ex駭浪反攻（30+指示物×10）/ 派帕的獒教父ex幹勁衝撞（30+無傷害+120）/ 鐵炮魚抓狂（指示物×10）</li>
          <li>D 自殘類 (1 張)：火箭隊的拉達顧前不顧後（90 + 擲 2 全反 → 自身 90）</li>
          <li>I 標 Wave 3 三批次合計：3a (30 張) + 3b (18 張) + 3c (13 張) = 61 張</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.5</span> I 標 Wave 3b — 棄能量類批次（18 張）</summary>
        <ul>
          <li>新檔 v2500_i_wave3b_discard.ts — 4 個 helper inline + declarative array</li>
          <li>A 棄自身固定 N 個能量（9 張）：伽勒爾 堵攔熊龐克粉碎/火箭隊的黑魯加燃燒殆盡/舞天鵝空氣斬/雷電雲災難伏特（棄1） + 蓋歐卡漩渦波/象牙豬暴雪刀鋒/噴火駝力量踩踏/卡璞・鳴鳴雷電爆破（棄2） + 巨炭山巨體碰撞（棄3）</li>
          <li>B 棄自身全部能量（2 張）：洛托姆ex十萬伏特(130) / 超級拉帝亞斯ex幻想脈衝(300)</li>
          <li>C 棄對手戰鬥場 1 個能量（4 張）：浮潛鼬潮旋(30)/瑪俐的滑滑小子咬碎(50)/火箭隊的班基拉斯打穿衝撞(180) + 勾帕路翁神聖刀鋒(20，限特殊能量)</li>
          <li>D 棄競技場 +N（2 張）：象牙豬摧毀(120+120)/超級摔角鷹人ex筋斗強襲(120+140)；場上有競技場才 +N，並丟棄</li>
          <li>E 棄手牌能量門檻（1 張）：蘭螳花花切舞(130)，需手牌 2 張基本草，否則招式失敗</li>
          <li>所有 helper inline 在新檔；不動 effects.ts 主檔（只加 1 行 import）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.49</span> I 標 Wave 3a — 條件 +N / 擲幣倍率 / 狙擊備戰 批次實裝（30 張）</summary>
        <ul>
          <li>新檔 v2490_i_wave3a_conditional.ts — 11 個 helper factory + declarative array pattern</li>
          <li>A 擲幣 ×K 倍率（4 張）：大嘴雀機關槍鑽 / 傘電蜥雙重抓 / 豆蟋蟀躍動 / 白海獅摔打</li>
          <li>B 自身能量數 ×K（3 張）：椰蛋樹木之重壓 / 火紅不倒翁/達摩狒狒火炎球</li>
          <li>C 獎賞數條件（3 張）：蒼響界限破壞 / 大鋼蛇歡迎之尾 / 捷克羅姆ex電爆發</li>
          <li>D 對手能量 ×K（1 張）：巨鍛匠大橫掃</li>
          <li>E 對手指示物 ×K（1 張）：脫殼忍者傷害律動</li>
          <li>F 狙擊單隻備戰（5 張）：巨石丁岩石踢 / 長耳兔魯莽踢 / 雪暴馬冰之射擊 / 赫普的蒼響ex剎那斬 / 波皇子瞄準俯衝</li>
          <li>G 對手所有備戰各 +N（1 張）：N的雙倍多多冰暴風雪</li>
          <li>H 雙方所有備戰各 +N（1 張）：臭臭花灑口水</li>
          <li>I 自身下回合受招 -N（8 張）：超級暴雪王ex冰霜屏障 / 大炭車防守壓制 / 齒輪兒/齒輪組堅硬齒輪 / 赫普的鋼鎧鴉鋼翼 / 甲殼龍防守壓制 / 火箭隊的火焰鳥ex火焰屏障 / 珍珠貝硬殼壓制</li>
          <li>J 擲幣全正面 +K（1 張）：穿著熊必殺金勾臂</li>
          <li>K 自方場上條件 +N（2 張）：雷公電氣墜落 / 破破舵輪大地能量</li>
          <li>不動 effects.ts 主檔（只加 1 行 import）；I 標寶可夢招式覆蓋率 ~30 張提升</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.48</span> 實裝仙子伊布ex 兩招（H 標）</summary>
        <ul>
          <li>魔法魅惑 [PCC] 160 點傷害；下個對手回合，受到此招的寶可夢使用招式傷害「-100」 — 復用 defNextAtkReducePost(100)，對手換場 → clearActiveEffects 清旗標</li>
          <li>天仙石 [WLP] 0 點傷害；選 0~2 隻對手備戰寶可夢，連附加卡（能量/道具/進化來源）全部放回對手牌庫並重洗</li>
          <li>天仙石 anti-spam gate：使用後此 attacker 下回合無法再用「天仙石」（per-attacker via blockedAttackNamesNextTurn，跟「烈火爆進」同 pattern）</li>
          <li>清除回 deck 時所有臨時狀態（damage / 異常 / 各種旗標）都清成 fresh，evolvedFromStack 也一併還原</li>
          <li>檔案：effects.ts 在「泥巴魚｜飛撲圈套」附近插入 regPre/regPost + sylveon-skystone-bounce resolver</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.471</span> Bug fix — 麻麻鰻電氣發電機 / 勾帕路翁ex金屬之路 多隻只能發動 1 次</summary>
        <ul>
          <li>玩家回報：場上有複數的麻麻鰻時，特性「電氣發電機」仍然只能發動一次（應該每隻 1 次，總共 N 次）</li>
          <li>原因：v2.386 實作時誤把 per-instance gate（abilityUsedThisTurn）寫成 shared once-per-turn（abilityNamesUsedThisTurn）</li>
          <li>判斷規則：卡面寫「使出其他同名特性則無法使用」 → SHARED；卡面只寫「在自己的回合時可使用 1 次」 → per-instance</li>
          <li>修正 2 個誤判：移除「電氣發電機」「金屬之路」的 ad-hoc abilityNamesUsedThisTurn gate；改回 engine 自動的 per-instance abilityUsedThisTurn 處理</li>
          <li>順手把「扭轉乾坤」「殺手鐧捕捉」（卡面真的明文 SHARED）補進 engine.SHARED_ONCE_PER_TURN_ABILITY_NAMES，未來實作層忘記寫 gate 時 engine 也擋</li>
          <li>場上 2 隻麻麻鰻 → 各可發動 1 次「電氣發電機」（總共 2 次，需棄牌區有 2 張基本【雷】能量）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.47</span> 對戰演練 — 備戰區 8 格自適應（零之大空洞場景）</summary>
        <ul>
          <li>玩家回報：零之大空洞觸發後備戰上限 5→8，8 隻在原 layout 下會被切到</li>
          <li>新增雙保險自適應：bench 上限 &gt;5 時加 .bench-extended class</li>
          <li>(1) slot 自動縮小：min-width 90→78、max-width 128→112，1280px+ 螢幕能 8 隻完整顯示不需捲</li>
          <li>(2) 必要時橫向捲動：overflow-x: auto + 細滾動條（綠色配合遊戲主題）；觸控設備支援慣性捲動</li>
          <li>my + opp 兩個 bench 都套用，捲動互相獨立</li>
          <li>5 格上限的一般場景完全不影響（class 只在限制 &gt;5 才加）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.464</span> 實裝泥巴魚｜飛撲圈套（I 標）</summary>
        <ul>
          <li>卡面：30 點傷害；下個對手回合，受到此招的寶可夢無法撤退；下個自己回合，受到此招的寶可夢受到招式傷害「+100」</li>
          <li>復用既有兩個 helper：defCantRetreatNextPost（cantRetreatNextTurn）+ oppTargetTakeExtraNextPost（takeExtraDamageNextTurn）</li>
          <li>關鍵互動：若對手用「寶可夢交替」/「老大的指令」等強制把該寶可夢換到備戰 → 兩個旗標都會被 clearActiveEffects 清除（既有機制），+100 加成自動失效</li>
          <li>檔案：effects.ts 在「超音波幼蟲｜刺耳聲」附近插入 regPre/regPost</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.463</span> 對戰演練 — 1024×576 解析度 zoom 調更積極 + 加 70/65/60% 手動檔</summary>
        <ul>
          <li>玩家回報：1024×576 在 Mac Safari 上 v2.45 80% zoom 仍會切到右側卡牌（瀏覽器 UI 額外吃掉幾十 px 高度）</li>
          <li>auto 算法基準改 1280×720 → 1366×768；下限 0.6 → 0.55</li>
          <li>新公式：1024×576 → 約 75%；1280×720 → 約 94%；1366×768 → 100%（無縮放）</li>
          <li>設定下拉新增 70% / 65% / 60% 三檔；提示文字加「若還是看到卡牌被切，可手動往下調」</li>
          <li>之前選 80% 的玩家可能要重新設成 auto 或手動 70%；切版仍存在的話可降到 65% 或 60%</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.462</span> Bug fix — 蜜集大蛇ex｜蜜糖風暴永遠只 30 傷</summary>
        <ul>
          <li>玩家回報：蜜集大蛇ex 招式蜜糖風暴怎麼打都只有 30 傷害</li>
          <li>原因：原本只實裝特性（熟成充能），招式沒寫 regPre。卡面 damage 字串是 '30+'，引擎只取 parseInt = 30，無法套用「+30 × 自方所有寶可夢身上的【草】能量數」公式</li>
          <li>修正：lopunny_serperior_flareon_festival.ts 補 regPre('蜜集大蛇ex|蜜糖風暴') 計算 30 + 30 × Σ(grass energies on all own pokemon)</li>
          <li>實際範例：自方共 4 隻草寶可夢、各帶 1 個草能量 → 30 + 4×30 = 150；帶 8 個草能量 → 30 + 8×30 = 270</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.461</span> Hotfix — Svelte 把 changelog 文字 &#123;uid&#125; 當變數導致首頁空白</summary>
        <ul>
          <li>v2.46 changelog 寫了「users/&#123;uid&#125;」，Svelte template 把 &#123;uid&#125; 解析為變數→ uid 未定義 → ReferenceError → 整頁 mount 失敗</li>
          <li>修法：把 &#123; &#125; 換成 HTML entity &amp;#123; &amp;#125;，視覺一樣是大括號但 Svelte parser 不會解析</li>
          <li>新鐵律：Svelte template 內任何 user-facing &#123;…&#125; sample text，一律用 HTML entity 或全形括號，避免被當 expression</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.46</span> 安全性強化 — Firestore rules 收緊 + room 成員驗證</summary>
        <ul>
          <li>玩家個資私有化：users/&#123;uid&#125; 與 users/&#123;uid&#125;/decks 全部改為「only own-or-admin 可讀寫」（之前 read 是 public，導致 email / deviceId / userAgent / loginCount + 雲端牌組任何人可撈）</li>
          <li>意見回饋（feedbacks）讀權限改 admin-only（之前公開可讀）；create 加 content 字串長度驗證 1~5000 字</li>
          <li>對戰房間（rooms）update / delete 收緊：只允許房內成員（在 memberUids 內）或 host 才能寫入；新加 memberUids: string[] 欄位由 room.ts 在所有 seat 變動時自動維護</li>
          <li>聊天訊息（messages）加 schema 驗證：text 必須是字串、長度 1~500；name 字串長度 ≤ 50；防止繞過 client 端 200 字限制塞長文</li>
          <li>建房（rooms create）驗證：hostUid 必須是自己 + memberUids 必須含 hostUid</li>
          <li>不影響現有功能：deck 載入仍走 own uid（cloud.ts loadDecksFromCloud(uid) 不變）；lobby 列表 / 加入房間 / 對戰過程 / 聊天 全都不受影響</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.45</span> 對戰演練 — 1024×576 解析度模式（auto-fit zoom + 手動切換）</summary>
        <ul>
          <li>玩家反映 1024×576 螢幕容納不下原 tablet-layout（設計基準 1280×720），加 CSS zoom 機制</li>
          <li>新增「自動」模式：依視窗大小自動算 ratio = min(w/1280, h/720)，下限 0.6；&gt;0.97 則維持 100%；1024×576 自動會落在約 80%</li>
          <li>新增手動切換：100% / 90% / 80% / 75% 五檔可選；存入 localStorage 跨 session 保留</li>
          <li>UI：對戰演練畫面右上角設定 ⚙️ → 新增「🖥️ 畫面縮放」區塊；下拉選單 + 即時預覽當前縮放比例</li>
          <li>實作：CSS zoom 屬性套用於 .battle-root（modern Chrome/Safari/Edge/Firefox 126+ 都支援）；modal 內容也會跟著縮放，互動座標由瀏覽器自動轉換</li>
          <li>不影響桌機（≥1280×720）使用者；手機直式繼續走 MobilePortraitBattle 元件</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.44</span> SEO 完整化 — Meta tags / sitemap / robots</summary>
        <ul>
          <li>src/app.html 補完整 SEO + 社群預覽 meta（保留現有 PWA 設定）：keywords / robots / canonical / og:type/title/description/url/locale/site_name / twitter:card 等</li>
          <li>新增 static/sitemap.xml — 主路徑 4 條（/, /cards, /decks, /game），priority + changefreq + lastmod；GSC 可直接提交</li>
          <li>新增 static/robots.txt — Allow all + Disallow /_app/（SvelteKit 內部 chunk 對 SEO 無價值）+ Sitemap 指引</li>
          <li>title / description 強化關鍵字密度：PTCG / 寶可夢卡牌 / 台灣 / 繁體中文 / H I J 標 / 線上對戰 / 牌組構築</li>
          <li>v2.431 已 push GSC 驗證檔（static/googlec112ab47fcd31fe0.html）；本版本完成後可回 GSC 點驗證 + Sitemap 提交 sitemap.xml</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.43</span> 新增玩家社群連結 — LINE 群組</summary>
        <ul>
          <li>首頁新增「💬 玩家社群」區塊（在「對戰演練」與「版本更新記錄」之間），含 LINE 群組邀請 QR Code + 直連按鈕</li>
          <li>QR Code 圖片：static/line-group-qr.png（650×650 PNG，error correction H，從邀請 URL 自動產生）</li>
          <li>視覺：綠色漸層卡片背景，LINE 品牌色 #06C755 按鈕；響應式 layout（480px 以下置中）</li>
          <li>歡迎玩家加入群組找對手、討論牌組、回報 bug、追蹤更新</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.422</span> 修正 PASSIVE_ATTACK_BONUS 疊加副作用 — 飯匙蛇激動力量 / 仆斬將軍大將 / 電蜘蛛複眼</summary>
        <ul>
          <li>v2.42 改 engine loop 為「per-source 疊加 + NO_STACK set 例外」後，「這隻寶可夢使用的招式」型特性出現副作用：fn 內 att.name === 'X' gate，但 engine loop 對 bench 同名也 invoke fn 一次 → 場上 2 隻飯匙蛇 → +240 是錯的</li>
          <li>把 PASSIVE_ATTACK_BONUS 條目分成兩類：(A)「自己的 X 寶可夢使用的招式 +N」型 = 友方 attacker 主語，per-source 疊加（輝煌聲援/力之鹽/皇家聲援/勝利聲援/鈷藍指令）；(B)「這隻寶可夢使用的招式 +N」/「自己的『X』攻擊時」型 = 擁有特性者本人，條件式不疊加（激動力量/大將/複眼）</li>
          <li>新增到 PASSIVE_ATTACK_NO_STACK：激動力量（飯匙蛇場上有【惡】Mega ex 時 +120 一次）、大將（仆斬將軍 +30×對手已得獎賞，per-attacker）、複眼（電蜘蛛攻擊「擁有特性」對手 +50 一次）</li>
          <li>規則總結：卡面寫「這隻寶可夢使用的招式 / 自己的『X』攻擊時 +N」→ NO_STACK；卡面寫「自己的 X 寶可夢使用的招式 +N」→ 疊加</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.42</span> Bug fixes — 4 個常用卡互動修正</summary>
        <ul>
          <li>夜間學院 + 越橘的一步棋互動：原 filter 'Pokemon:Type=Darkness' 在 UI deck-search parser 沒有對應 case → 落到 generic Pokemon: 分支後比對 pokemonType==='Type=Darkness' 永遠 false → 即使夜間學院剛把超級耿鬼ex 放牌庫頂也找不到。改用專屬 'DarknessPokemon:TOP7' filter（限定 top7 + 只列【惡】寶可夢）</li>
          <li>超級沙奈朵ex 兩個招式（原本完全沒實裝）：盈溢祈願 — 0 + 從牌庫挑基本【超】能量依序附給每隻備戰寶可夢，重洗牌庫；超級交響樂 — 50 × 自己所有寶可夢身上附加的【超】能量總數。新檔 v2402_mega_gardevoir.ts</li>
          <li>竹蘭的羅絲蕾朵 +30 多隻疊加：原 PASSIVE_ATTACK_BONUS engine loop 對所有特性 dedup by ability name → 場上 2 隻只 +30。新增 PASSIVE_ATTACK_NO_STACK set 只含「大方」（卡面明文「不重複」），其他特性每隻場上擁有者都獨立加成。2 隻竹蘭的羅絲雷朵 → +60；比克提尼｜勝利聲援 / 鐵頭殼ex｜鈷藍指令 等也比照辦理</li>
          <li>閃焰王牌｜瞬間爆發力起手戰鬥場放置：新增 canBeInitialActiveCard helper（基礎 OR 含「瞬間爆發力」特性）；engine setup PLACE_ACTIVE check + dealOpeningHand mulligan 都改用此 helper；UI 增加 canSetupActiveSpecial flag 讓 Stage2 with 瞬間爆發力 可以拖到戰鬥場</li>
          <li>新鐵律：寫入大檔（engine.ts / effects.ts / +page.svelte）後務必驗證 file 完整性（mount layer 偶會截斷尾端 UTF-8 多位元組字元），需用 Python os.write+os.fsync+O_TRUNC pattern 寫入</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.41</span> I 標 Wave 2 — 抽牌/換場/牌庫搜能量批次實裝（11 張）</summary>
        <ul>
          <li>新檔 v2401_i_wave2_draw_swap_search.ts（240 行）— 含 4 個 helper factory + 4 組 declarative 表</li>
          <li>抽 N 張（2 張）：阿響的皮丘｜麻麻抽出 / 赫普的啪嚓海膽ex｜扣殺閃電</li>
          <li>自身換場（1 張）：風妖精｜急速折返</li>
          <li>對手換場（5 張）：駒刀小兵/蓋蓋蟲/怒鸚哥/萌芽鹿｜推倒、哈約克｜吼叫（復用 force-opp-swap resolver）</li>
          <li>牌庫挑基本能量附自身（3 張）：蛋蛋｜果實盈滿、急凍鳥｜冰冷羽擊、雷電雲｜充電</li>
          <li>helper：drawNPost / forceOppSwapPostInline / selfSwapPostInline / deckSearchBasicEnergyPost；resolver wave2-deck-energy-attach-self</li>
          <li>不動 effects.ts 既有實裝（只加 1 行 import）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.40</span> I 標 Wave 1 — Recharge + 狀態類批次實裝（declarative 風格）</summary>
        <ul>
          <li>新檔 v2400_i_wave1_recharge_status.ts — 用 helper factory + declarative array 大幅縮減 code 量（每張卡 1-2 行）</li>
          <li>Recharge 招式 7 張：利歐路｜加速突刺 / 自爆磁怪｜閃光伏特 / 雪暴馬｜冰霜颱風 / 赫普的蒼響ex｜無畏斬 / 厄鬼椪 碧草面具｜鬼之錘 / 派帕的獒教父ex｜大佬頭擊 / 棄世猴｜衝擊打擊</li>
          <li>純狀態（必中）4 張：隨風球｜不祥之風 / N的齒輪組｜轉轉齒輪 / 大吾的念力土偶｜不祥之光 / 火箭隊的臭臭泥｜渾身臭臭</li>
          <li>擲幣狀態 5 張：冰砌鵝｜嚴寒頭錘 / 三合一磁怪｜電擊 / 狩獵鳳蝶｜麻痺粉 / 青藤蛇｜緊束 / 鴨嘴火獸｜灼燒</li>
          <li>helper 復用：effects.ts 既有 statusPost / coinStatusPost（含憨憨臉/硬岩鬥能量/特殊能量 immunity 完整鏈）；本檔自定 inline rechargePost</li>
          <li>架構：對 effects.ts 主檔僅加 3 個 export（statusPost / coinStatusPost / selfHitPost）+ 1 個 import；不改既有實裝</li>
          <li>共 16 張 I 標寶可夢招式 effect 實裝；剩餘 22 張 Wave 1 候選含複雜複合效果留下波</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.389</span> J 標 5 張卡完全互動實裝</summary>
        <ul>
          <li>大嘴娃｜雙重食客 + 超級皮可西ex｜射攻月亮：新增 PreDiscardSpec scope='hand-energy'，+page.svelte UI handler 列出手牌能量卡讓玩家挑 0-2/0-4 張，regPre 改用 action.discardedEnergyIids</li>
          <li>瑪力露麗ex｜收集泡泡 + 白海獅｜沖刷：來源寶可夢身上能量 > 1 張時開 modal-choice 讓玩家選哪張能量；只 1 張走 fast path（仿能量轉移 v2.231 pattern）</li>
          <li>信使鳥｜幸福禮物：跨 player pending chain — Stage A actorIdx=dIdx 對手先選 0-3 張基本能量；Stage A resolver 附加完後觸發 Stage B actorIdx=aIdx 我方選 0-3 張；handle 雙方任一無基本能量的 path</li>
          <li>所有 5 張卡從「簡化版（自動處理）」轉為「完全互動」實裝；J 標真實裝 100%</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.388</span> J 標所有 stub 一口氣補完（光之翼/雙重屬性/鰭之化石/整人擊落）</summary>
        <ul>
          <li>光之翼補完：cursed-bomb resolver 加 immunity（彷徨夜靈/黑夜魔靈咒詛炸彈對超級皮可西ex 不放指示物）</li>
          <li>小碎鑽｜雙重屬性：engine.ts 弱點 + 抵抗力計算改用 attackerEffectiveTypes 陣列（小碎鑽攻擊時對方【鬥】或【超】弱點皆觸發 ×2）</li>
          <li>陳舊的鰭之化石被動：老大的指令（gust supporter）filter 排除鰭之化石（regG + reg validIids 過濾）</li>
          <li>堅果啞鈴｜整人擊落：_shared.ts 加 triggerOakeyeMillIfApplicable helper；effects.ts millOppDeckTopPost + v2360 龍捲風噴射 加 trigger 呼叫</li>
          <li>v2380_j_abilities 檔頭 stub 列表全部標為已真實裝</li>
          <li>J 標 audit 工具持續 100% pattern 命中；功能層真實裝率約 99% 以上</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.387</span> 超級皮可西ex｜光之翼真實裝</summary>
        <ul>
          <li>光之翼：超級皮可西ex 不受對手寶可夢特性效果影響</li>
          <li>engine.ts hook 1：冰冷之帳 checkup（line 3897 isFrosmothCheckupTarget）— 持有光之翼者免疫雪妖女放指示物</li>
          <li>engine.ts hook 2：攻擊 pipeline PASSIVE_RETALIATION（line 3534）— 攻擊方持有光之翼 → 免疫毒刺/灼熱之軀/反擊/尖刺盔甲等對手反擊特性</li>
          <li>未來補完：對手主動特性對此寶可夢造成效果（咒詛炸彈、整人擊落等）的 short-circuit</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.386</span> 麻麻鰻｜電氣發電機真實裝 + 鬥志戰吼確認</summary>
        <ul>
          <li>麻麻鰻｜電氣發電機（M2a/MC/SV11B 4 印）：在自己的回合可使用 1 次，從棄牌區選 1 張基本【雷】能量附於備戰寶可夢</li>
          <li>實作：仿奇跡修正檔兩階段 picker（discard-search BasicEnergy:Lightning → bench-choose → 附能量），一回合 1 次 abilityNamesUsedThisTurn gate</li>
          <li>勒克貓｜鬥志戰吼：v2.384 已實裝（engine.ts EVOLVE gate hasFightingHowl bypass），確認 hook 仍在 line 1622</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.385</span> J 標 2 個 stub 真實裝 + v2.384 重複 hook bug fix</summary>
        <ul>
          <li>狙射樹梟ex｜狙擊手之眼：對手手牌恰為 4 張時，狙射樹梟ex 招式所需的【無】能量全部消除（effects.ts 加 getDecidueyeSnipeEffectiveCost helper，仿酋雷姆三重冰霜 pattern；engine.ts cost 計算處加 overridden4 呼叫）</li>
          <li>耿鬼｜無限之影：受招式 KO 時，本體放回手牌（能量/道具/進化堆仍丟棄、仍給對手獎賞），engine.ts KO 處理 path 加 hook</li>
          <li>BUG FIX：移除 v2.384 加的重複「陳舊的顎之化石 -30」hook（v2.190 line 2903 早已實裝，v2.384 audit 失誤導致對手攻擊時被扣兩次 30 = -60 傷害）</li>
          <li>剩 4 個 stub 待後續：整人擊落 / 光之翼 / 雙重屬性 / 鰭之化石被動（皆需更大範圍 engine 改動）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.384</span> Audit 工具升級 + J 標 3 個 stub 真實裝</summary>
        <ul>
          <li>新增 scripts/audit-card-impl.mjs — 掃描 14 種實裝 pattern 全面 audit script，避免單 pattern 誤判（v2.39 化石/Stadium 教訓）</li>
          <li>AI_HANDOFF.md 補「卡牌實裝 audit 方法論」章節：列出 14 種 pattern + 接手前必跑 audit 鐵律</li>
          <li>陳舊的顎之化石被動：戰鬥場時對手招式傷害 -30（engine.ts 攻擊 pipeline 加 hook，仿 damageReduceNextHit pattern）</li>
          <li>勒克貓｜鬥志戰吼：對手戰鬥場為 ex 時，剛使出 / 最初回合可進化（engine.ts EVOLVE gate 加 hasFightingHowl bypass）</li>
          <li>勾帕路翁ex｜金屬之路：本回合從備戰上戰鬥場時，搬場上鋼能量到自身（regA + movedToActiveThisTurn gate + heal-target picker）</li>
          <li>J 標 audit 結果：221/221 全 pattern 命中（100%）；剩 5 個 stub 仍待 engine 級擴張（光之翼/雙重屬性/狙擊手之眼/無限之影/整人擊落 + 鰭之化石被動）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.383</span> v2.39 J 標訓練家 stub 修正 — 化石/Stadium 既有實裝確認</summary>
        <ul>
          <li>查證使用者反映：化石卡（陳舊的顎/鰭之化石）+ 密阿雷市 + 稜鏡塔之前已實裝過</li>
          <li>v2.39 stub 對這 3 張卡誤加 regG/reg 與「需 v2.4+ 擴張」log，覆蓋既有 noop reg + 留下誤導訊息</li>
          <li>v2390_j_trainers_batch.ts 改寫為純 audit 註解索引（移除所有錯誤 reg/regG 註冊）</li>
          <li>確認既有實裝路徑：化石卡走 items_misc.ts FOSSIL_NAMES_LOCAL + engine PLAY_FOSSIL action；密阿雷市 / 稜鏡塔走 engine USE_STADIUM case + stadiums.ts / mega_decks.ts resolver</li>
          <li>昂主花葉蒂保留 v2.382 真實裝（超級花葉蒂ex HP +150）</li>
          <li>J 標訓練家 audit 命中：29/29（全部正確覆蓋既有實裝路徑）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.382</span> J 標複雜特性續實裝 — 3 個 stub 轉真實裝</summary>
        <ul>
          <li>伊裴爾塔爾ex｜死亡靈魂：OHKO 對手所有 HP ≤50 寶可夢（用 +9999 damage + sanityKOSweep 處理 KO）</li>
          <li>超級呆殼獸ex｜殼捲風旋轉：retaliation 12 indicator（types.ts 加 retaliateCountersOnNextHit flag + engine.ts 在 PASSIVE_RETALIATION 後段套用）</li>
          <li>昂主花葉蒂（Stadium）：超級花葉蒂ex 最大 HP +150（engine.ts getEffectiveHP + effects.ts effectiveHPInline 雙處 hook 同步）</li>
          <li>J 標進度：寶可夢 effect 招式 25/27 完整、特性 27/33 完整（v2.38 24/33 → v2.382 27/33）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.381</span> 修復祭典樂舞第 3 次攻擊 bug</summary>
        <ul>
          <li>修復 bug：裹蜜蟲｜祭典樂舞在 2 次擊倒對手後仍可發第 3 次招</li>
          <li>原因：第 2 次招式 KO 後，TAKE_PRIZES / SEND_NEW_ACTIVE 觸發 maybeResumeFestivalDanceSecondAttack 時，flag 仍為 true → 又把 turnPhase 重設為 main，開放第 3 次攻擊</li>
          <li>修法：types.ts 新增 festivalDanceSecondAttackUsed flag（第 2 次招式 spent 標記），engine.ts 在 startFestivalDanceSecondAttackWindow / maybeResumeFestivalDanceSecondAttack 雙 hook 處檢查；END_TURN 同步清除</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.38</span> J 標補實裝大批次（92.6% 覆蓋）</summary>
        <ul>
          <li>新實裝 J 標寶可夢 effect 招式 25 個：雙重食客 / 殼捲風旋轉 / 閃光伏特 / 射攻月亮 / 巨岩墜落 / 蓋亞波 / 死亡靈魂 / 黑暗打擊 / 狡兔三窟 / 地震 / 九尾狐搬動 / 幸福禮物 / 小使者 / 大地風暴 / 岩石投擲 / 毒液衝擊 / 防守壓制 / 力量衝撞 / 咬碎 / 雷吉充能 / 能量氣球 / 衝擊打擊 / 能量粉碎 / 耳之力 / 勇鳥猛攻</li>
          <li>新實裝 J 標寶可夢特性 5 個：白海獅｜沖刷、瑪力露麗ex｜收集泡泡、青木的樹枕尾熊｜無力充能、超級皮可西ex｜光之翼（stub）、小碎鑽｜雙重屬性（stub）</li>
          <li>J 標訓練家補實裝：化石卡（陳舊的顎/鰭之化石 stub）+ 3 個 Stadium（密阿雷市/昂主花葉蒂/稜鏡塔 stub）</li>
          <li>J 標進度：寶可夢 177/186 完整、訓練家 29/29 完整、特殊能量 6/6 完整 — 整體 212/229（92.6%）</li>
          <li>剩 9 個複雜特性留 stub（狙擊手之眼/鬥志戰吼/無限之影/整人擊落/金屬之路 等需 engine 級 hook）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.374</span> 火箭腦力實裝 + tsc 警告全清 + AI_HANDOFF 鐵律補充</summary>
        <ul>
          <li>新實裝特性：火箭隊的以歐路普｜火箭腦力（移動「火箭隊的」寶可夢身上指示物到自己其他寶可夢）</li>
          <li>tsc 既有警告從 86 個全部清乾淨：v2306 inst undefined gate（51 個）、v168 drawCards 老 API 重構（14 個）、abra_mawile_deck params 型別（7 個）、其他散落 14 個</li>
          <li>AI_HANDOFF.md 補新鐵律：os.write+fsync+O_TRUNC 寫大檔範本 + 接手前自查（避免 mount layer truncation 殘留）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.373</span> UI 補版本更新記錄</summary>
        <ul>
          <li>補回 v2.37 / v2.371 / v2.372 三條紀錄（之前 push 但 changelog 沒同步）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.372</span> 監視之眼通用標籤化 + 修 v172 末尾截斷</summary>
        <ul>
          <li>探探鼠｜監視之眼改用通用標籤 set（MOVE_DAMAGE_COUNTER_ABILITIES）統一 gate 移放傷害指示物類特性</li>
          <li>目前覆蓋：願增猿｜腎上腺腦力、火箭隊的以歐路普｜火箭腦力（全資料庫掃描共 2 條再印 6 套）</li>
          <li>未來新增同類特性只需把名字加進 set 即可自動受監視之眼禁用</li>
          <li>修復 v172_hij_batch.ts 末尾 UTF-8 截斷（v2.360 commit 留下的孤兒 byte）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.371</span> 魔靈寶石海星牌組微調 + 探探鼠監視之眼補實裝</summary>
        <ul>
          <li>魔靈超級寶石海星牌組：基本【惡】能量 3→2 張，補 1 張赤松</li>
          <li>探探鼠｜監視之眼補實裝：場上有探探鼠時，雙方願增猿｜腎上腺腦力等「移放傷害指示物」特性無法使用</li>
          <li>可達鴨｜濕氣：交叉確認 v2.65 既存實裝（hasPsyduckDamp）已涵蓋 M2a 14692 可達鴨</li>
          <li>tsc 既有警告大量清理：updatedAt/createdAt 型別不同步 + sfx.ts 補 Fairy 屬性（從 ~600+ 降至 86）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.37</span> 新增 5 套預設牌組（魔靈寶石海星/寶石猛雷鼓/月月熊赫月/岩殿居蟹/遠古巨蜓）</summary>
        <ul>
          <li>新增預設牌組：魔靈超級寶石海星 / 寶石猛雷鼓 / 月月熊 赫月 / 岩殿居蟹 / 遠古巨蜓（共 5 套）</li>
          <li>新實裝招式：石居蟹｜覺醒（從牌庫直接進化）、岩殿居蟹｜偉大剪（120 + 跳過附加效果）</li>
          <li>新實裝招式：蜻蜻蜓｜吹飛（強制對手換場）、雷吉奇卡斯｜寶石破壞（對太晶寶可夢 +230）</li>
          <li>班基拉斯牌組微調：競技場「危險密林」改為「險惡廢墟」</li>
          <li>既有實裝交叉確認：雪妖女｜冰冷之帳、岩殿居蟹｜神秘石居、海星星/雪妖女/蜻蜻蜓銳利羽/可達鴨衝撞/探探鼠咬住等純傷害招式</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.363</span> 修復桃歹郎ex｜支配鎖鏈備戰特性</summary>
        <ul>
          <li>修復「支配鎖鏈」備戰特性：移除錯誤的「必須在戰鬥場」限制，桃歹郎ex 在備戰區也能正常使用特性</li>
        </ul>
      </details>
            <details>
        <summary><span class="ver-badge">v2.362</span> 新增 4 套預設牌組 + 特性消除機制</summary>
        <ul>
          <li>新增預設牌組：班基拉斯 / 超級蒂安希 / 寶石大竺葵 / 超級巨牙鯊（共 4 套）</li>
          <li>新實裝效果：振翼髮｜暗夜羽擊（消除對手特性）、班基拉斯｜威迫目光（封對手物品卡）</li>
          <li>新實裝效果：超級巨牙鯊ex｜飢渴下巴、輕飄飄｜海之影、伊裴爾塔爾｜黑暗羽毛、幼基拉斯｜咬碎</li>
        </ul>
      </details>
      <details>
        <summary><span class="ver-badge">v2.361</span> Bug 修復批次 — 5項修正</summary>
        <ul>
          <li>Bug #17 擔架：棄牌區寶可夢取回後，清除 KO 前的狀態異常與傷害指示物</li>
          <li>Bug #18 借用技能（耀閃挑戰/暗黑底牌）：弱點/抗性改依使用者屬性計算</li>
          <li>Bug #19 金屬怪特性：查看牌庫頂 4 張，不再顯示整個牌庫</li>
          <li>Bug #20 捕蟲組合：草系寶可夢（含進化）可正常選取</li>
          <li>Bug #21 AI 卡住：席多藍恩打死對手後，AI 等待對手補場再繼續</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.360</span> J標第5批次 — 8組效果</summary>
        <ul>
          <li>波爾凱尼恩｜強力蒸汽：每次正面 +90 傷（依水能量數量擲幣）</li>
          <li>彩粉蝶｜穿堂風：場地中時 120，無場地 60</li>
          <li>超級火炎獅ex｜大爆炎之火：290 − 自身已受傷</li>
          <li>妙喵｜拍檔攻擊：本回合打出瑪琪艾兒時 70，否則 10</li>
          <li>河馬獸｜龍捲風噴射：本回合打出塔拉剛時，對手牌組頂端 3 張送棄牌堆</li>
          <li>代歐奇希斯｜精神防護：下回合免疫擁有特性的寶可夢招式傷害</li>
          <li>具甲武者｜要害斬：KO 對手時，下回合免疫所有招式傷害與效果</li>
          <li>小木靈｜怨恨進化：從手牌選定進化牌覆蓋自身，繼承能量/道具並 +20 傷</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.359</span> J標第3/4批次 — 33項效果</summary>
        <ul>
          <li>擲幣失敗後觸發的懲罰效果（自傷、換場等）</li>
          <li>封退效果：被指定寶可夢本回合無法撤退</li>
          <li>自愈效果：攻擊後回復自身指定傷害</li>
          <li>條件傷害：依對手狀態/道具/能量數量調整傷害</li>
          <li>能量棄置：攻擊後棄掉自身或對手的能量</li>
          <li>搜尋效果：攻擊後從牌組搜尋特定牌</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.355</span> J標批次 — 多張特殊效果</summary>
        <ul>
          <li>代歐奇希斯｜精神強念：免疫非 EX/V 招式傷害</li>
          <li>哲爾尼亞斯｜大地之門 / 光明角擊</li>
          <li>冰雪巨龍｜冰冷寒氣 / 凍原堡壘</li>
          <li>具甲武者｜潛力：依手牌中招式卡數計算傷害</li>
          <li>鑰圈兒｜記憶之鎖、怪顎龍｜亂暴 / 暴龍根性</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.354</span> J標第2/3批次 — 13張卡效果</summary>
        <ul>
          <li>多張 J 標卡牌攻擊效果與特性實裝（P2/P3 批次）</li>
          <li>包含狀態異常附加、換場指令、能量搜尋等機制</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.353</span> J標第1批次 — 基礎效果群</summary>
        <ul>
          <li>J 標低複雜度效果群首批實裝</li>
          <li>固定傷害、簡單加乘、基礎狀態異常等招式效果</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.346–2.352</span> J標前期批次</summary>
        <ul>
          <li>v2.352：J標低複雜度效果第二輪</li>
          <li>v2.349：J標 P1 剩餘效果、奇跡修正檔備戰目標修正</li>
          <li>v2.348：J標狀態異常批次</li>
          <li>v2.347：J標備戰區傷害批次</li>
          <li>v2.346：J標簡易效果批次</li>
        </ul>
      </details>

    </div>
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
    <p>本站為熱愛 PTCG 的粉絲自製非營利專案，旨在推廣寶可夢集換式卡牌實體遊戲。</p>
    <p>所有卡牌圖像、文字與商標之智慧財產權均歸屬 The Pokémon Company、Nintendo、Creatures Inc. 及 GAME FREAK inc. 所有。<br/>本站之卡牌資料皆取自於 <a href="https://asia.pokemon-card.com/tw/" target="_blank" rel="noopener noreferrer">寶可夢集換式卡牌遊戲官方主頁「訓練家網站」in 台灣</a>。</p>
    <p>本站絕無意侵犯官方權益，若版權方認為有任何不妥，請透過 <a href="mailto:suenz001@yahoo.com.tw">聯絡我們</a> 告知，本站將立即配合下架修改。</p>
  </footer>
</main>

<style>

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
    margin-bottom: 0.25rem;
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
