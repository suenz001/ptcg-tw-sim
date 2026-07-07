<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { auth, db } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
  import {
    collection, addDoc, serverTimestamp,
    query, where, limit, getDocs, onSnapshot, doc, getDoc,
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
  let changelogOverride = $state('');  // v5.755 admin 可在後台編輯的首頁更新記錄(Firebase config/homeChangelog);空=用程式內建

  onMount(() => {
    // v5.755：首頁更新記錄可由 admin 後台編輯(Firebase config/homeChangelog,兩站共用);讀到才覆蓋程式內建。
    getDoc(doc(db, 'config', 'homeChangelog')).then((snap) => {
      if (snap.exists()) { const h = snap.data()?.html; if (typeof h === 'string' && h.trim()) changelogOverride = h; }
    }).catch(() => { /* 沒設定 → 用程式內建 */ });
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
    {#if changelogOverride}<div class="changelog-list">{@html changelogOverride}</div>{/if}
    <div class="changelog-list" style:display={changelogOverride ? 'none' : undefined}>

<details open>
        <summary><span class="ver-badge">v5.898</span> 對戰修正：齒輪怪有兩種同名版本——一種特性是「緊急迴轉」（可從手牌把自己放到備戰），另一種是「齒輪塗層」（進化寶可夢的被動減傷）。先前系統以卡名判斷，導致「齒輪塗層」版（進化寶可夢）也被錯誤地顯示並允許發動「緊急迴轉」（把進化寶可夢從手牌直接放到備戰、不合規則）。現已改為只有實際具有「緊急迴轉」特性的版本才能發動。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.897</span> 對戰修正：怖納噬草有兩種同名版本——一種特性是「恐慌牢籠」（進化時讓對手戰鬥寶可夢混亂），另一種是「雜草魂」（依對手已取獎賞卡每張最大HP＋50）。先前「雜草魂」的HP加成是用卡名判斷，會誤套到「恐慌牢籠」版，導致玩家用恐慌牢籠版進化時被錯誤加血。現已改為只有實際具有「雜草魂」特性的版本才加HP；恐慌牢籠版進化正常觸發對手混亂、不再被加血。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.896</span> 介面修正：對戰中「對手上回合動作」拖曳小視窗的翻頁按鈕（◀ 看更早的回合 / ▶ 看更新的回合）先前按了沒反應，因為點擊被視窗標題列的拖曳手勢攔截（指標捕獲）。現已修正，可正常翻閱前幾回合的動作記錄。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.895</span> 介面修正：手機直式版觀戰時，現在也會像桌面版一樣在畫面下方顯示被觀戰玩家的手牌張數（以卡背呈現、內容仍保密）。先前只有桌面版看得到這排手牌卡背，手機版觀戰看不到。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.894</span> 效能優化：對戰時不再一次載入全部卡牌資料（約 4.6MB、40 個卡包），改成只載入雙方牌組實際用到的卡包，加快進入對戰的速度、也讓連線開局更快就緒（連帶再降低開局重洗機率）。並加了完整性保護：萬一某張卡未被涵蓋，會自動補載全部卡包，確保對戰絕不會因缺卡出錯。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.893</span> 效能與連線修正：（1）大幅加速進站載入——首頁的「版本更新記錄」先前累積了上千條、檔案過大，導致每次進站都越來越慢；現在站上只保留最近約 50 版，完整歷史仍保存在原始碼版本控制中。（2）降低休閒對戰「開局後不久手牌突然重洗」的機率——原因是雙方連線開局時偶爾會各自建立了一份對局（開局建局競態），系統收斂到其中一份時另一方就會整局重洗；已加大等待窗口，讓主建局方（先手方）建立的對局更穩定地先傳達給對手，搭配上述載入加速（連線監聽更早就緒），雙方更不易發生重複建局。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.892</span> 對戰修正：可拖曳的「對手上回合動作」小視窗中，丟棄卡片的顯示更完整。先前的去重邏輯以「卡片編號」跨整個回合比對，會誤把某些丟棄的卡藏起來——例如你這回合先從手牌附了 1 張水能量，之後又用稜鏡塔丟棄另 1 張水能量時，第二張水能量的丟棄不會顯示在小視窗中。現改為以「實體卡」精準去重（只排除「打出即自動進棄牌的同一張訓練家卡」避免重複顯示），其餘所有丟棄都會如實呈現。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.891</span> 對戰修正：使用場地卡「稜鏡塔」丟棄 2 張手牌抽 1 張卡時，現在會在對戰紀錄公開顯示丟棄的兩張卡名（先前完全沒有記錄，導致雙方都看不到對手用稜鏡塔丟了什麼——棄牌區屬於公開資訊，應顯示卡名）。抽到的卡維持私密（對手看不到）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.890</span> 介面調整：取獎賞時的選擇盤更簡化。當場上有「翻到正面並維持」的獎賞卡（如克雷色利亞｜弦月光芒），取獎時只需決定要不要拿那幾張翻正面的已知卡；至於蓋著的獎賞卡因為彼此看起來都一樣（內容未知），不再逐張列出讓你選 #1／#2／#3，改成一個「隨機取一張蓋著的」選項由系統代抽（拿到的結果與手動挑相同）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.889</span> 對戰修正：中毒／灼傷在「寶可夢檢查階段」造成的擊倒，取獎流程改走與一般招式擊倒相同的中央流程。先前這兩種檢查階段擊倒是用簡化的直接取獎，會繞過兩件事：一是取獎方看不到「私訊揭示取得的卡名」（改為取獎方看得到卡名、對手只看到張數）；二是若場上有「翻到正面並維持」的獎賞卡（如克雷色利亞｜弦月光芒、火箭隊的妨礙機器人翻開的獎賞），取獎時不會跳出「要不要拿那張正面獎賞」的選擇。現已收斂，與一般擊倒、雪妖女｜冰冷之帳完全一致。此為依官方寶可夢檢查規則的收斂，正常無正面獎賞的對局取獎行為不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.888</span> 對戰修正：修正變隱龍｜隱形攻擊、托戈德瑪爾｜尖刺電光、小灰怪｜躲藏的免疫效果。這三張卡面是「擲硬幣正面，下個對手回合這隻寶可夢不會受到招式的傷害與效果的影響」，但先前是用「傷害大量減免」來模擬，只擋得住傷害、擋不住「效果」——所以對手的招式仍能對它施加中毒等狀態或做換位等效果。現已改用中央的完全免疫機制（同時擋下傷害與效果，和其他同類卡一致）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.887</span> 對戰修正：火箭隊的阿柏怪｜瞪眼效用「只要這隻在戰鬥場上，對手不可從手牌將擁有特性的寶可夢（火箭隊除外）放置於場上」——先前用「神奇糖果」進化會繞過這個限制（一般進化與放基礎已正確擋下，但神奇糖果走另一條進化路徑漏了）。現已修正：對手戰鬥場有瞪眼效用時，神奇糖果也無法把「擁有特性的寶可夢」進化放置於場上（若希望進化的目標受阻，進化卡保留在手牌）。並已 audit 其他「阻擋對手動作」的特性（爆大身軀擋競技場、海之詛咒／威迫目光擋物品與道具、ACE消弭擋ACE SPEC），確認都只走單一使出路徑、沒有類似的繞過漏洞。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.886</span> 對戰修正：石丸子｜變硬、鐵甲蛹｜變硬的「下個對手回合不受 N 以下招式的傷害」改為正確實作。先前是用「下次受傷 -N」近似——當被超過 N 的招式攻擊時會被錯誤地減掉 N 點傷害（例如變硬 40，被 60 的招式打只受 20，應該是全額 60）。現已改為中央的條件免傷機制（比照這幾版新增的分類免疫做法）：計算完所有減傷後，最終傷害若「≤ N」則歸 0、若「> N」則照全額受傷，並持續整個對手回合。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.885</span> 對戰修正：鐵毒蛾｜瘋狂拒絕的「下個對手回合不受『古代』寶可夢招式傷害」改為正確實作。先前是用「下次受傷 -200」近似，兩邊都不對——被非古代寶可夢攻擊時也會被減傷、被古代寶可夢打超過 200 時仍會受傷。現已改為中央的分類免疫機制（比照「不受基礎寶可夢招式傷害」的做法，涵蓋戰鬥位與備戰位）：只在攻擊方是「古代」寶可夢時才免疫其招式傷害，其他寶可夢的攻擊照常。（另釐清：迷唇姐｜邀請之吻其實早已完整實作「移 1 能量到新上場寶可夢」，只是舊註解過時，已更新。）</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.884</span> 對戰修正：把 3 張先前「簡化」沒忠實照卡面的招式改為完整實作。（1）焰后蜥｜突然炙烤：改為「由對手自己選擇要丟棄哪張手牌」（先前是隨機丟）；且「本回合若從夜盜火蜥進化才再丟 2 張」的條件也修正（先前每回合都會多丟）。（2）優雅貓｜能量攪拌：實作「選擇自己場上寶可夢身上任意數量能量，以任意方式改附到自己的寶可夢」（先前完全沒作用、只提示手動移動）。（3）塗標客｜惡作劇作畫：改為「從對手棄牌區選能量、再逐張選要附到哪隻對手寶可夢」（先前是自動取前 3 張全附到對手戰鬥位）。另外釐清：怦怦炸彈與雙彈瓦斯｜瘋狂炸彈其實早已正確實作，只是舊註解過時，已一併更新。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.882</span> 對戰修正：把「混亂自傷擊倒自己」時對手取獎賞的流程，收斂到與一般擊倒相同的中央取獎機制——若對手有正面朝上的獎賞卡（弦月光芒／火箭隊的妨礙機器人翻開的），取獎時同樣會讓對手逐張選擇，取得的獎賞卡名也會私下記錄給取獎方。並確認「效果先於傷害／死代碼／獎賞卡／棄牌區揭示／查看對手手牌」等近期修正的維度已無其他漏網。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.881</span> 對戰修正：（1）克雷色利亞｜弦月光芒的「翻到正面」現在會在結算傷害之前、也在取走擊倒獎賞之前發生（招式效果先於傷害，比照甲賀忍蛙ex｜忍之利刃的做法）——所以就算這一招把對手擊倒，翻開的那張獎賞卡也會即時就位，讓你在取這次擊倒的獎賞時就能選擇要不要取走它。取獎賞與對手補位的順序也已確認：對手要送出新的戰鬥寶可夢，必須等你取完獎賞卡之後才能進行，避免兩個動作互相覆蓋。（2）修正長毛狗｜氣味偵測：擲硬幣後可以從棄牌區取回卡加入手牌的效果先前失效（選完沒反應），現已修好，取回的卡也會公開記錄在對戰紀錄（棄牌區屬於公開資訊）。（3）修正火箭隊的瓦斯彈｜警備濁霧：受傷時從牌庫搜尋「瓦斯彈」放到備戰區的效果先前失效，現已修好。並新增自動檢查，防止未來再出現「選擇視窗開了卻沒有對應效果」的情況。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.880</span> 對戰修正：修好克雷色利亞｜弦月光芒（與火箭隊的妨礙機器人）翻到正面的獎賞卡在取獎賞時沒有讓玩家選擇的問題。原因有二：①翻面的效果先前在傷害計算階段執行，但那個階段對獎賞卡的變更會被攻擊流程覆蓋掉，導致「翻到正面」沒有真正保留（連對戰紀錄的翻面訊息也一起遺失）；現已改到招式效果結算階段執行，翻面確實保留、對戰紀錄也會公開記錄翻到哪一張卡（手機看不到獎賞圖示時也能從紀錄得知）。②取獎賞其實是在擊倒對手的當下自動取走的（並非手動按鈕），先前的取獎選擇做錯了地方所以沒作用；現已改為：擊倒對手要取獎賞時，若場上有正面朝上的獎賞卡，會逐張讓你選擇要取走哪一張（正面朝上的顯示卡名可指定、蓋著的顯示編號），可連續指定多張正面的；沒有正面朝上獎賞卡時維持原本自動取、正常對局完全不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.879</span> 對戰修正：火箭隊的妨礙機器人也是「將獎賞卡翻到正面並維持」的效果，一併補上。卡面是「選擇1張對手的反面朝上的獎賞卡，並在不看正面的情況下從對手的手牌選擇1張，查看各自的正面。若希望，令對手互換所選的卡。（在對戰結束前，那張獎賞卡維持正面朝上。）」先前只有揭示卡名與互換，並沒有真的讓那張獎賞卡維持正面朝上。現已沿用前一版的翻面機制：被選中的對手獎賞卡會翻到正面並維持到對戰結束（若選擇互換，則換進獎賞格的那張維持正面朝上），對雙方公開、顯示於獎賞區；該玩家之後取獎賞時，會讓其選擇要不要取走那張已知的卡。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.878</span> 對戰修正：完整實作克雷色利亞｜弦月光芒的獎賞卡翻面機制。卡面是「若希望，選擇1張自己的反面朝上的獎賞卡，翻到正面（這個情況下增加80點傷害），該張獎賞卡維持正面朝上到對戰結束」，用意是讓你看到自己1張獎賞卡的內容、之後取獎賞時可以選擇要不要拿那張已知的卡。先前只做了「增加80點傷害」、並沒有真的把獎賞卡翻到正面，也沒有取獎選擇。現已：使出弦月光芒選「是」時會翻開自己1張獎賞卡（在對戰紀錄公開卡名、正面朝上顯示於獎賞區、維持到對戰結束），之後取獎賞時若場上有正面朝上的獎賞卡，會讓你選擇要取走那張已知的卡、還是取蓋著的（保留正面的）。沒有正面朝上獎賞卡的正常對局，取獎賞流程完全不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.877</span> 對戰修正：延續前一版的隱私原則，補上兩張先前漏網、以自訂方式實作「查看對手手牌」的招式——倫琴貓ex｜突刺目光、大舌頭｜舌引。這兩招先前會在對戰紀錄公開印出對手的整副手牌卡名（等於把對手手牌洩漏給對手與觀戰者）；現已改為只有出招方看得到對手手牌的具體卡名，對戰紀錄只公開手牌張數。此外再次確認：凡是因招式效果被丟入棄牌區的卡，都會在對戰紀錄公開卡名（棄牌區屬於公開資訊，對戰雙方都應該知道那些牌因為剛剛的效果被丟入棄牌區）——現行所有相關招式皆已正確公開，符合此原則。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.876</span> 對戰修正：延續相仿秀的原則（能看到對手的手牌是重要的戰略資訊，也是玩家的權益），檢查了所有「查看對手的手牌」的招式。純查看類（妙喵｜看透、小貓怪｜好奇心、豆豆鴿｜偵察、咕咕／蜻蜻蜓｜靜默之翼、催眠貘｜不祥視線）先前只在對戰紀錄印出對手手牌、甚至公開洩漏給觀戰者；依對手手牌張數造成傷害類（狩獵鳳蝶｜能量吸管、風妖精ex｜奇跡棉花）則只顯示「張數」、看不到實際是哪些卡。現已比照「枇琶」的作法，使出這些招式時一律開啟畫面完整揭示對手的整副手牌供出招方查看（對戰紀錄只公開張數、不再洩漏對手的卡名）。洛托姆｜粉碎脈衝的查看手牌也改為只有出招方看得到具體卡名。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.875</span> 對戰修正：魔牆人偶｜相仿秀「查看對手的手牌。若希望，選擇1張其中的支援者卡…」的「查看對手手牌」是無條件的（能看到對手的手牌是重要的戰略資訊）。先前若對手手牌中沒有支援者卡，會直接結束、完全不讓玩家看到對手的手牌；現已比照支援者「枇琶」的作法，使出相仿秀時一律開啟畫面揭示對手的整副手牌供查看——有支援者可從中選 1 張複製其效果，沒有支援者時則純粹查看後結束。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.874</span> 對戰修正（電腦對手）：與電腦對戰時，某些「選擇對手備戰寶可夢」的效果會限定可選的目標（例如精刺奇襲只能選對手的「寶可夢ex」、老大指令類換位不能選有「化隱」等免疫特性保護的備戰、莉莉的招喚等亦有限制），先前電腦的自動選擇沒有套用這個「可選目標」限制、一律挑剩餘 HP 最低的備戰，可能選到不符合條件的目標；現已讓電腦的自動選擇與玩家端一致，只會從卡片允許的目標中挑選。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.872</span> 對戰修正：怖納噬草的特性「恐慌牢籠」（從手牌進化時可使用 1 次，將對手的戰鬥寶可夢【混亂】），先前進化時不會彈出「是否使用特性」的確認視窗、也沒有讓對手陷入混亂。原因是此特性的程式登錄方式與其他同類「進化／上場時發動」特性不同（因為有多張同名的怖納噬草、各自的特性不一樣，需要用特性名稱來區分），而自動彈窗的判定只認得其中一種登錄方式，導致它被漏掉；現已改為兩種登錄方式都能正確辨識，恐慌牢籠與其他同類特性一樣會在進化時彈出確認視窗，使用後對手戰鬥寶可夢會陷入混亂。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.871</span> 對戰修正：撤退所需能量的計算，當同時有「增加」與「減少」效果、且減少的量超過寶可夢本身的撤退費時，先前程式是「先扣減到不低於 0、再加上增加量」，會把超出本身撤退費的那部分減免浪費掉；依官方規則，所有增減效果應一起計算、最後結果小於 0 才視為 0（單一次歸零）。例：撤退費 1 的九尾附「氣球」（減 2），對手場上 2 隻超級水晶燈火靈ex（各使對手撤退 +1、合計 +2）時，正確撤退費為 1（＝1＋2－2），先前誤算為 2。此修正一併套用到依對手撤退費計算傷害的招式（超級水晶燈火靈ex｜幻影迷宮 等）。「撤退所需能量全部消除」型效果（如拉帝亞斯ex｜天空徑線）仍為最後強制歸 0，不受影響。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.870</span> 修正：7 張「從自己的牌庫搜尋卡片」的訓練家卡（訂購盒、招式學習器機、派帕、吹火人、赤松、珍寶配件、能量輸送PRO）先前因程式的可用性判定登錄疏漏，在自己牌庫已經沒有卡時仍會被判定為「可使用」；這類卡在牌庫為空時其實沒有可搜尋的對象（訂購盒甚至還會直接結束自己的回合），現已與其他同類搜尋卡一致，牌庫為空時正確判定為不可使用。（另新增靜態檢查防止此類登錄疏漏再發生。）</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.869</span> 對戰修正：索羅亞克｜欺詐「選擇1個對手的戰鬥寶可夢持有的招式，作為這個招式使用」，先前實作是自動挑對手戰鬥寶可夢「印刷傷害最高」的那個招式來複製，沒有讓玩家依卡面「選擇」要複製哪一招（當對手寶可夢有多個招式、且低傷害招式帶有想要的效果時，這個差別會影響戰術）；現已修正為由玩家自己選擇要複製對手的哪一個招式（與皮可西｜揮指、阿響的樹才怪｜試著模仿一致；對手寶可夢只有 1 個可複製招式時自動帶入，不多此一問）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.868</span> 對戰修正：魔牆人偶｜相仿秀「查看對手的手牌。若希望，選擇1張其中的支援者卡，將那個效果作為這個招式的效果使用」，先前實作直接「自動」複製對手手牌中的第 1 張支援者，既沒有讓玩家查看對手手牌、也沒有讓玩家自己選要複製哪一張；現已修正為：使出相仿秀時會揭示對手的手牌供查看，並由玩家從其中的支援者卡選擇 1 張（若希望，可以不選）來複製其效果。被複製的支援者是對手的卡、仍留在對手手牌中（卡面沒有將其棄掉的敘述）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.867</span> 對戰修正（電腦對手）：與電腦對戰時，電腦使用「小霞的朝氣」等『從自己的牌庫選擇基本【○】能量附給自己寶可夢』的卡（小霞的朝氣＝基本【水】能量、以及其他指定屬性從牌庫附能的招式／支援者）時，先前電腦的自動選牌沒有正確辨識「基本【指定屬性】能量」這個條件，會把整副牌庫都當成候選、依「好用度」把基礎寶可夢排在最前面，結果把寶可夢當成能量附了上去；現已讓電腦的自動選牌與玩家端共用同一套能量屬性判定，只會選到正確屬性的基本能量。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.866</span> 對戰修正：場地卡「險惡廢墟」（我方將【基礎】且非【惡】屬性的寶可夢放到自己備戰區時，該寶可夢受到 20 點傷害）先前只在部分「放備戰」的情況觸發——用手牌直接放、以及多數招式／特性放備戰都正確，但少數把寶可夢從棄牌區放到自己備戰的效果（例如把與某寶可夢同名的基本寶可夢從棄牌區放到備戰）漏算、沒有受到傷害；現已收斂為在所有「放到自己備戰」的路徑統一偵測並觸發，與卡面一致。對戰效果修正。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.863</span> 對戰紀錄修正：把對手手牌「放回牌庫並重洗」的招式（洛托姆／雪童子／長尾怪手｜驚嚇、墓揚犬｜恐怖啃咬、步哨鼠｜臨檢），先前放回牌庫的那張卡只在攻擊方的私人紀錄顯示牌名、或完全不顯示牌名——由於卡片放回牌庫重洗後就藏起來了，對戰紀錄是唯一的記錄；現已改為在雙方共同的對戰紀錄公開揭示被放回的是哪張卡（與「丟棄對手手牌」「暗槓」「占為己有」等既有公開揭示一致）。純對戰紀錄呈現修正，遊戲結果不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.862</span> 對戰修正：超級龍頭地鼠ex｜極限鑽「若身上附加的能量數比此招式所需多 2 個以上，則傷害 +130」的能量數計算，先前是逐張硬數、沒有把「提供多個能量」的特殊能量正確換算——例如「燃火能量」附在進化寶可夢上視為 3 個、「新衝天能量」附在 2 階進化上視為 2 個、「火箭隊能量」視為 2 個、大竺葵「繁茂」下的基本【草】能量視為 2 個——導致這些能量被少算、+130 沒觸發；現已改用與撤退／招式付費同一套 host-aware 能量單位計算，正確反映每張能量實際提供的個數。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.861</span> 對戰修正：兩則玩家回報的問題。① 卡面標明「傷害不計算受到傷害的寶可夢身上的附加效果」的多目標攻擊（鐵頭殼ex｜雙刃劍、月亮伊布｜出奇一擊等），先前打對手備戰寶可夢時仍會被「花之帷幔」（謝米，保護備戰）、太晶寶可夢ex的備戰免疫、以及擲硬幣免傷（順滑大衣等）擋下；依官方裁定，這類招式不計算對手身上「不受招式傷害的效果」，應可造成傷害，現已修正（與戰鬥場單體同款的 skipDefEffects 處理對齊）。② ACE SPEC「重新啟動箱」從棄牌區附能給所有「未來」寶可夢時，先前會自動決定哪張基本能量給哪隻（自動亂填），現改為由玩家逐張分配、每隻各 1 張。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.859</span> 顯示修正：哈克龍｜進化指引（從牌庫選 1 張進化寶可夢，在「給對手看過」後加入手牌），先前搜到的卡名只有自己看得到、對手只看到「選 N 張」，違反卡面「給對手看過」的公開資訊要求；現已收斂到與其他搜尋卡相同的公開揭示管線，對手也會看到搜到的具體卡名。純顯示修正，對戰效果不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.858</span> 對戰修正：從棄牌區「以任意方式」附加能量到備戰的招式（鬃岩狼人｜渦輪刀鋒、圖圖犬｜能量寫生、帕奇利茲｜啪滋啪滋充電），先前只能把選到的能量「全部附到 1 隻」備戰寶可夢，無法依卡面「以任意方式」分散到不同備戰；現已改為逐張選擇目標分散（收斂到與撿拾附上相同的中央能量分配管線，從棄牌區取用、不重洗牌庫、不觸發對手的手牌附能反應）。卡面寫「附於 1 隻備戰」的能量支援維持單目標不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.857</span> 顯示修正：使用「桌墊版」版面時，戰鬥場的寶可夢若已進化（下方疊放了進化序列／能量／道具的卡片圖），其特殊狀態標示（混亂／中毒／灼傷／睡眠／麻痺）與「已使用特性」標示先前會被往右扇開的疊放卡片蓋住、看不到；現已把戰鬥場的狀態標示層級提到疊放卡片之上（比照備戰區既有做法，並設為不阻擋下方卡片的點擊與預覽），雙方戰鬥場一致，桌墊版下特殊狀態恆可見。純顯示修正，對戰效果不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.856</span> 對戰修正：泡沫【水】能量卡面「附有的【水】寶可夢不會陷入特殊狀態，並將受到的特殊狀態全部恢復」，但先前若該寶可夢同時帶三種狀態（睡眠＋中毒＋灼傷），附上泡沫【水】能量後第三種（灼傷）不會被恢復；現已補齊，三種狀態都會正確恢復（並順修「命運的擺弄」回手牌時的第三槽清除）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.855</span> 對戰修正：寶可夢從戰鬥場換到備戰區時應清除所有特殊狀態，但先前若同時帶三種狀態（例如睡眠＋中毒＋灼傷），透過「AZ的平和」等部分換場方式換下時，第三種狀態（灼傷）會殘留到備戰區；現已在中央防線補上第三狀態槽的清除，涵蓋所有換場路徑（並把 AZ的平和 收斂到統一的離場清除，一併清掉殘留的受傷/免疫類旗標）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.854</span> 對戰修正：美納斯ex「璀璨鱗片」（不受對手「太晶」寶可夢招式的傷害與效果）先前只免疫了「傷害」、漏了「效果」——太晶寶可夢的招式效果（施加特殊狀態、丟棄能量、移動傷害指示物等）仍會對美納斯ex生效；現已補上效果免疫，與傷害側共用同一「太晶」判定。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.853</span> 顯示修正：化石系列寶可夢（陳舊的羽毛／根狀／背蓋／顎之／鰭之／頭蓋／盾甲化石）的「特性」先前只在「效果」欄以純文字顯示、沒有特性名稱；現已補上結構化特性（羽毛守護／原始根／背蓋守護／威嚇之顎／鰭之守護／頭蓋尖刺／盾之守護，均經官網逐張比對），卡牌資料庫與牌組編輯器都會正確顯示「特性 X」。純顯示修正，對戰效果不變。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.852</span> 對戰修正：(1) 陳舊的羽毛化石在備戰區的防禦——卡面只寫「不會受到對手寶可夢招式的傷害」，先前程式誤把「招式效果」（例如來悲粗茶「抹茶旋濺」放置的傷害指示物）也擋掉了；現已修正為只免疫招式『傷害』，放指示物等效果照常生效。(2) 夢妖魔ex「漩渦言靈」（在戰鬥場時，對手的戰鬥寶可夢回到備戰區、新上場的會陷入混亂）先前只在撤退與部分招式互換時觸發，急進開關等其他自我換場方式沒觸發；現已收斂為統一偵測，所有自我換場都會正確觸發。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.851</span> 對戰修正：洛托姆ex「多重轉接」（可附 2 張寶可夢道具）在洛托姆ex 自己位於戰鬥場、已附 1 張道具、又是場上唯一可附目標時，第 2 張道具先前無法打出（卡片被判定不可使用）；要撤退到備戰區才附得上。現已修正——道具「可否使用」的判定與「可附目標」清單收斂為同一套邏輯，一致涵蓋多重轉接的第 2 張。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.850</span> 顯示修正：點擊「查看寶可夢詳細狀態」時，透過洛托姆ex「多重轉接」附加的第 2 張寶可夢道具先前不會顯示（只顯示第 1 張）；現已修正為列出全部道具。（後端附加一直正常，僅詳細狀態視窗顯示遺漏。）</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.849</span> 對戰改善：泡沫栗鼠「掃除」（選擇最多 2 張對手場上寶可夢道具丟棄）先前是系統自動丟前 2 張；現改為由玩家自行選擇要丟哪些道具（可只丟 1 張或不丟第 2 張），帶「化隱」等免疫招式效果的寶可夢道具不會被列入。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.848</span> 對戰改善：龍頭地鼠ex「貫通鑽」（對手 1 隻受傷的備戰寶可夢受到 60）與赤面龍「龍之猛暴」（從棄牌區附基本火能量到自己的【龍】寶可夢）先前在有多個符合目標時由系統自動選第一個；現改為由玩家自行選擇目標。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.847</span> 對戰改善：超級耿鬼ex「空無強風」（選擇 1 個自身能量改附到備戰寶可夢）先前是系統自動選最後附上的能量；現改為由玩家自行選擇要移哪個能量（多屬性或帶特殊能量時才有差別）。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.846</span> 對戰改善：密勒頓「光子纜線」（戰鬥場被擊倒時將最多 2 張基本雷能量改附到備戰寶可夢）先前在身上有 3 張以上雷能量時由系統自動取前 2 張；現改為由玩家自行從棄牌區選擇要移動哪 2 張。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.845</span> 對戰改善：使用需要「選擇能量放回手牌」的招式（狡猾天狗「能量閉環」、古劍豹「冰柱閉環」、波爾凱尼恩「逆火」、裹蜜蟲「能量閉環」）時，先前是系統自動選最後附上的能量放回；現改為由玩家自行選擇要放回哪些能量。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.844</span> 對戰改善：使用需要「丟棄自身 N 個能量」的招式（超級噴火龍Yex「炎獄狂爆Y」、青木的姆克鷹「羽毛強襲」、烏鴉頭頭「狙擊羽毛」）時，先前是系統自動丟掉最後附上的能量；現已改為由玩家自行選擇要丟哪些能量（與其他同類招式一致），避免誤丟想保留的特殊能量。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.843</span> 對戰修正：莉佳的臭臭花「噴毒」的效果為「將對手的戰鬥寶可夢中毒」（不需擲硬幣），先前實作誤設為擲硬幣正面才中毒；現已修正為直接中毒。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.842</span> 對戰修正：焚焰蚣「焦黑吐息」（對手灼傷時造成 180 傷害）與火神蛾「熱浪鱗粉」先前判斷對手是否灼傷時只檢查主要狀態欄位；當對手同時處於多種特殊狀態（例如睡眠＋灼傷）時，灼傷可能落在其他欄位而被漏判，使「焦黑吐息」誤判為招式失敗。現已改為檢查全部狀態欄位。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.841</span> 對戰修正：與「寶可夢道具」丟棄相關的招式（超級毒藻龍ex「腐蝕液」、火箭隊的叉字蝠ex「刺殺迴旋」、泡沫栗鼠「掃除」）先前只處理主要道具槽，會漏掉透過「多重轉接」附加的第 2 張以上道具；此外「掃除」先前未套用「招式效果免疫」判定。現已一併修正：這類道具會正確全數丟棄，且帶「化隱」等免疫招式效果的寶可夢不會被「掃除」丟道具。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.840</span> 對戰修正：以招式讓「對手下回合無法撤退」的一批效果（莉佳的蔓藤怪「綁緊」、泥巴魚ex「咬緊」、青木的勇士雄鷹「緊抓」、伊裴爾塔爾「緊抓」、破破舵輪「束縛」、帕底亞 土王ex「毒陣」）先前未套用「招式效果免疫」判定，會讓帶有「化隱」等免疫招式效果的對手戰鬥寶可夢仍被禁止撤退；現已收斂至中央處理並套用免疫判定，這類寶可夢不會被禁止撤退。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.839</span> 對戰修正：以「特性」強制交換對手戰鬥寶可夢的效果（鐵掌力士「大力捕捉器」、赫普的毛毛角羊「挑戰角擊」、花潔夫人「媚惑引誘」、大劍鬼「激流旋渦」）先前未套用「特性效果免疫」判定，會強制換下帶有「化隱」等免疫特性效果的對手戰鬥寶可夢；現已與招式版一致，這類寶可夢不會被換位。</summary>
      </details>
      <details>
        <summary><span class="ver-badge">v5.838</span> 對戰修正：夠讚狗「算帳」（增加「上個對手回合對手獲得的獎賞卡張數」×60 點傷害）先前用「對手招式擊倒次數」近似計算，會漏算：對手擊倒你的寶可夢ex（實得 2 張只算 1）、以及用特性擊倒（如黑夜魔靈「咒詛炸彈」，完全沒算）；現已改用對手獎賞堆實際減少的張數計算，正確涵蓋 ex 雙倍、特性擊倒與中毒／灼傷等所有情況。</summary>
      </details>

        <!-- v5.893：完整版本更新歷史(v2.346 起)已移至 git 版控;此處只保留最近 50 版避免首頁過大拖慢載入 -->
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
