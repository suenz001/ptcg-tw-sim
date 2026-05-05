<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { auth, db } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
  import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
  import { VERSION } from '$lib/version';

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

  async function submitFeedback() {
    if (!feedbackText.trim() || feedbackSubmitting) return;
    feedbackSubmitting = true;
    try {
      await addDoc(collection(db, 'feedbacks'), {
        content: feedbackText.trim(),
        createdAt: serverTimestamp(),
        uid: user?.uid || 'anonymous',
        userAgent: navigator.userAgent
      });
      feedbackStatus = 'success';
      feedbackText = '';
      setTimeout(() => {
        showFeedbackModal = false;
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

  <section class="changelog-section">
    <h2>📋 版本更新記錄</h2>
    <div class="changelog-list">

      <details open>
        <summary><span class="ver-badge">v2.360</span> J標第5批次 — 8組效果</summary>
        <ul>
          <li>波爾凱尼恩｜強力蒸汽：擲幣計分 × 水能量數量，每正面 90 傷</li>
          <li>彩粉蝶｜穿堂風：場地中時 120，無場地 60</li>
          <li>超級火炎獅ex｜大爆炎之火：290 − 自身已受傷</li>
          <li>妙喵｜拍檔攻擊：本回合打出瑪琪艾兒支援者時 70，否則 10</li>
          <li>河馬獸｜龍捲風噴射：本回合打出塔拉剛時，對手牌組頂端 3 張送棄牌堆</li>
          <li>代歐奇希斯｜精神防護：下回合免疫擁有特性的寶可夢招式傷害</li>
          <li>具甲武者｜要害斬：KO 對手時，下回合免疫所有招式傷害與效果</li>
          <li>小木靈｜怨恨進化：使用特性從手牌選定進化牌覆蓋自身，繼承能量/道具並追加 20 傷</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.359</span> J標第3/4批次 — 33項效果</summary>
        <ul>
          <li>擲幣失敗後觸發的懲罰效果（自傷、換場等）</li>
          <li>封退效果：被指定的寶可夢本回合無法撤退</li>
          <li>自愈效果：攻擊後回復自身指定傷害</li>
          <li>自傷類效果：攻擊附帶自身受傷機制</li>
          <li>自鎖效果：下回合無法使用相同招式</li>
          <li>條件傷害：根據對手狀態/道具/能量數量調整傷害</li>
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
          <li>雷吉艾斯ex｜冰之牢籠補丁修正</li>
          <li>具甲武者｜潛力：依手牌中招式卡數計算傷害</li>
          <li>鑰圈兒｜記憶之鎖</li>
          <li>怪顎龍｜亂暴 / 暴龍根性</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.354</span> J標第2/3批次 — 13張卡效果</summary>
        <ul>
          <li>多張 J 標卡牌攻擊效果與特性實裝（P2/P3 批次）</li>
          <li>包含狀態異常附加、換場指令、能量附加搜尋等機制</li>
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
      <div class="modal-content" onclick={e => e.stopPropagation()}>
        <h3>提交意見回饋</h3>
        {#if feedbackStatus === 'success'}
          <div class="success-msg">✅ 感謝你的回饋！已成功送出。</div>
        {:else}
          <textarea 
            bind:value={feedbackText} 
            placeholder="請描述你遇到的問題或建議..."
            rows="5"
            disabled={feedbackSubmitting}
          ></textarea>
          {#if feedbackStatus === 'error'}
            <div class="error-msg">❌ 提交失敗，請稍後再試。</div>
          {/if}
          <div class="modal-actions">
            <button class="btn-cancel" onclick={() => showFeedbackModal = false} disabled={feedbackSubmitting}>取消</button>
            <button class="btn-submit" onclick={submitFeedback} disabled={!feedbackText.trim() || feedbackSubmitting}>
              {feedbackSubmitting ? '送出中...' : '送出'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <footer class="disclaimer">
    <p>本站為熱愛 PTCG 的粉絲自製非營利專案，旨在推廣寶可夢集換式卡牌實體遊戲。</p>
    <p>所有卡牌圖像、文字與商標之智慧財產權均歸屬 The Pokémon Company、Nintendo、Creatures Inc. 及 GAME FREAK inc. 所有。<br/>本站之卡牌資料皆取自於 <a href="https://asia.pokemon-card.com/tw/" target="_blank" rel="noopener noreferrer">寶可夢集換式卡牌遊戲官方主頁「訓練家網站」in 台灣</a>。</p>
    <p>本站絕無意侵犯官方權益，若版權方認為有任何不妥，請透過 <a href="mailto:suenz001@yahoo.com.tw">聯絡我們</a> 告知，本站�