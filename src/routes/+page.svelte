<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { auth } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';

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
</script>

<main>
  <h1>PTCG 對戰模擬器</h1>
  <p class="tagline">Server-authoritative online battle simulator · 伺服器權威對戰</p>

  <section>
    <h2>連線狀態</h2>
    <dl>
      <dt>狀態</dt>
      <dd>{status}</dd>
      <dt>Firebase 專案</dt>
      <dd>ptcg-tw-sim</dd>
      {#if user}
        <dt>匿名使用者 ID</dt>
        <dd class="uid">{user.uid}</dd>
      {/if}
      {#if error}
        <dt>錯誤</dt>
        <dd class="error">{error}</dd>
      {/if}
    </dl>
  </section>

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
    <h2>開發路線圖</h2>
    <ol>
      <li><strong>M0 ✅</strong> 卡牌資料管線（繁中卡名 + 效果）</li>
      <li><strong>M1 ✅</strong> 牌組編輯器 + Firebase Auth + 雲端同步</li>
      <li><strong>M2</strong> 最小規則引擎（20 張卡）</li>
      <li><strong>M3</strong> 配對 + 連線對戰</li>
      <li><strong>M4</strong> 規則引擎擴充</li>
      <li><strong>M5</strong> 卡池擴充</li>
    </ol>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f4f4f6;
  }
  main {
    max-width: 680px;
    margin: 2rem auto;
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
  a:hover {
    text-decoration: underline;
  }
  .hint {
    color: #888;
    font-size: 0.85rem;
    margin-left: 0.5rem;
  }
</style>
