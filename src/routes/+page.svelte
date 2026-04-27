<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { auth } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
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
</script>

<main>
  <h1>PTCG 對戰模擬器 <span class="version">v{VERSION}</span></h1>
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
    <h2>⚔️ 對戰</h2>
    <p>
      <a href="{base}/game">開始對戰 →</a>
      <span class="hint">（本機雙人傳遞對戰，實驗性）</span>
    </p>
  </section>

  <section>
    <h2>開發路線圖</h2>
    <ol>
      <li><strong>M0 ✅</strong> 卡牌資料管線（繁中卡名 + 效果）</li>
      <li><strong>M1 ✅</strong> 牌組編輯器 + Firebase Auth + 雲端同步</li>
      <li><strong>M2 🚧</strong> 最小規則引擎（本機雙人對戰）</li>
      <li><strong>M3</strong> 配對 + 連線對戰</li>
      <li><strong>M4</strong> 規則引擎擴充</li>
      <li><strong>M5</strong> 卡池擴充</li>
    </ol>
  </section>

  <footer class="disclaimer">
    <p>本站為熱愛 PTCG 的粉絲自製非營利專案，旨在推廣寶可夢集換式卡牌實體遊戲。</p>
    <p>所有卡牌圖像、文字與商標之智慧財產權均歸屬 The Pokémon Company、Nintendo、Creatures Inc. 及 GAME FREAK inc. 所有。</p>
    <p>本站絕無意侵犯官方權益，若版權方認為有任何不妥，請透過 <a href="mailto:suenz001@yahoo.com.tw">聯絡我們</a> 告知，本站將立即配合下架修改。</p>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f4f4f6;
  }
  .version { font-size: 0.75rem; font-weight: 400; color: #888; font-family: monospace; vertical-align: middle; margin-left: 0.3rem; background: #e8e4ee; padding: 0.1rem 0.4rem; border-radius: 3px; }
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
</style>
