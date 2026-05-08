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
