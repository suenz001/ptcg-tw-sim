<script lang="ts">
  import { onMount } from 'svelte';
  import { initTracking } from '$lib/tracking';
  import { isChunkLoadError } from '$lib/sw-policy';

  let { children } = $props();

  // v4.938：遷移 banner — 只在 github.io 顯示（.com / localhost 都不顯示）。
  //   localStorage 記住「暫時不要」決定 — 7 天後再次顯示。
  let showMigrationBanner = $state(false);
  // v5.034：BETA 標記 — 跟 migration banner 共存，但不可 dismiss。
  //   提醒站長 / 玩家：github.io 是測試站（Firebase backend），.com 才是正式站（Oracle backend）。
  let isBetaSite = $state(false);
  const MIGRATION_DISMISS_KEY = 'ptcg-migration-banner-dismissed-until';
  const MIGRATION_TARGET = 'https://www.ptcg-tw-sim.com';

  function shouldShowMigrationBanner(): boolean {
    if (typeof window === 'undefined') return false;
    if (!/github\.io/.test(window.location.hostname)) return false;
    const dismissed = localStorage.getItem(MIGRATION_DISMISS_KEY);
    if (dismissed) {
      const until = parseInt(dismissed, 10);
      if (!isNaN(until) && Date.now() < until) return false;
    }
    return true;
  }

  function migrateToCom() {
    if (typeof window === 'undefined') return;
    // 保留 path + query string（除掉 github.io 的 /ptcg-tw-sim base 前綴）
    const path = window.location.pathname.replace(/^\/ptcg-tw-sim/, '');
    const target = MIGRATION_TARGET + (path || '/') + window.location.search + window.location.hash;
    window.location.assign(target);
  }

  function dismissBanner() {
    if (typeof window === 'undefined') return;
    // 7 天內不再顯示
    const until = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem(MIGRATION_DISMISS_KEY, String(until));
    showMigrationBanner = false;
  }

  onMount(() => {
    // v5.965:app 掛載完成 → 移除 app.html 的載入畫面(splash),顯示真正內容
    if (typeof document !== 'undefined') document.getElementById('app-splash')?.remove();
    initTracking();
    // v5.968 version-skew 保險：新版部署後，開著舊分頁 lazy import 舊 hash chunk 若 404(chunk load error)
    //   → 一次性自動 reload 取新版(15 秒內不重複，防 reload loop)。SW 保留舊 cache 是第一道防線，這是最後保險網。
    if (typeof window !== 'undefined') {
      const tryChunkReload = (msg: string) => {
        if (!isChunkLoadError(msg) || !navigator.onLine) return;
        let last = 0;
        try { last = Number(sessionStorage.getItem('ptcg_chunk_reload_ts') || '0'); } catch { /* ignore */ }
        if (Date.now() - last < 15000) return;
        try { sessionStorage.setItem('ptcg_chunk_reload_ts', String(Date.now())); } catch { /* ignore */ }
        location.reload();
      };
      window.addEventListener('error', (e) => tryChunkReload(String((e as ErrorEvent)?.message || '')));
      window.addEventListener('unhandledrejection', (e) => {
        const r = (e as PromiseRejectionEvent)?.reason;
        tryChunkReload(String((r && r.message) || r || ''));
      });
    }
    showMigrationBanner = shouldShowMigrationBanner();
    // v5.034：BETA 偵測 — 同 migration banner 條件（github.io），不可 dismiss
    if (typeof window !== 'undefined' && /github\.io/.test(window.location.hostname)) {
      isBetaSite = true;
    }
  });
</script>

{#if isBetaSite}
  <div class="beta-banner" role="region" aria-label="BETA 測試站標記">
    <span class="beta-icon">⚠️</span>
    <span class="beta-text">
      <strong>BETA 測試版</strong> · 正式站：<a href={MIGRATION_TARGET} class="beta-link">www.ptcg-tw-sim.com</a>
    </span>
  </div>
{/if}

{#if showMigrationBanner}
  <div class="migration-banner" role="region" aria-label="網站遷移通知">
    <div class="migration-content">
      <span class="migration-icon">🌐</span>
      <div class="migration-text">
        <strong>我們搬家了！</strong> 正式網址改為
        <a href={MIGRATION_TARGET} class="migration-link">www.ptcg-tw-sim.com</a>
        — 請更新書籤，github.io 之後會逐步退場。
      </div>
      <button class="migration-btn primary" onclick={migrateToCom}>立即切換</button>
      <button class="migration-btn secondary" onclick={dismissBanner} aria-label="暫時不要">暫時不要</button>
      <button class="migration-close" onclick={dismissBanner} aria-label="關閉" title="7 天內不再顯示">✕</button>
    </div>
  </div>
{/if}

{@render children()}

<style>
  /*
   * v6.101：卡圖載入失敗「重試中」的全站佔位樣式。
   * 由 $lib/img-retry.ts 的 use:retryImg 在圖片載入失敗期間掛上 data-img-retrying，
   * 載入成功時自動移除。放在 layout 的 :global 是為了讓對戰／牌組／卡片各頁共用同一份外觀。
   * ⚠ 刻意不換成卡背圖：卡背在本站代表「未揭曉的牌」，用在載入失敗會讓玩家誤判盤面資訊。
   *   這裡改成暗色框＋卡名（<img> 失敗時瀏覽器會顯示 alt，而全站 alt 就是卡名）＋緩慢呼吸動畫，
   *   讓玩家一眼看出「圖還在載，不是這張卡有問題」。
   */
  :global(img[data-img-retrying]) {
    background: #1d2330;
    border: 1px dashed rgba(255, 255, 255, 0.28);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.72);
    font-size: 10px;
    line-height: 1.25;
    text-align: center;
    overflow: hidden;
    animation: img-retry-breathe 1.6s ease-in-out infinite;
  }
  @keyframes img-retry-breathe {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 0.9; }
  }
  /* 使用者偏好減少動態時不閃爍（無障礙） */
  @media (prefers-reduced-motion: reduce) {
    :global(img[data-img-retrying]) { animation: none; opacity: 0.7; }
  }
  /* v2.202+：統一 body baseline — 所有頁面預設白底，
     避免跨頁導航時殘留前一頁的深色背景（例如 /game 的墨綠）。
     /game 頁的 :global(body) 會在該頁載入時覆蓋此值。 */
  :global(body) {
    margin: 0;
    background: #f4f4f6;
  }

  /* ⭐⭐⭐ v6.187 全站「安全區」單一來源 —— iPhone 動態島 / 瀏海 / home indicator。
     背景：app.html 的 viewport meta 帶 viewport-fit=cover，且 apple-mobile-web-app-capable=yes
       + status-bar-style=black-translucent ⇒ 玩家「加到主畫面」以 PWA 開啟時，網頁內容會
       延伸到動態島底下。任何 position:fixed 貼齊螢幕邊緣的元素若不自己讓開，就會被動態島
       蓋住而**點不到**（v6.187 修的正是「宣告對手棄權獲勝」紅鈕整條被壓在動態島下）。
     ⚠ 這是**唯一來源**：所有貼邊浮動元素一律讀 var(--safe-top / --safe-bottom /
       --safe-left / --safe-right)，不要再各自寫 env(safe-area-inset-*)。
     ⚠ fallback：先無條件宣告 0px；只有在瀏覽器**確實支援 env()** 時（@supports 為真）
       才覆寫成真值。不支援 env() 的瀏覽器整段 @supports 被跳過 → 變數維持字面 0px，
       所有 calc() 仍可求值，非 iPhone 版面完全不會多出空白（正對照見
       scripts/test-v6187-safe-area-single-source.mjs）。 */
  :global(:root) {
    --safe-top: 0px;
    --safe-bottom: 0px;
    --safe-left: 0px;
    --safe-right: 0px;
  }
  @supports (padding-top: env(safe-area-inset-top)) {
    :global(:root) {
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --safe-left: env(safe-area-inset-left, 0px);
      --safe-right: env(safe-area-inset-right, 0px);
    }
  }

  /* v5.034：BETA 標記 banner — 黃色細條，github.io 才顯示，不可 dismiss */
  /* v5.070：padding-top 加安全區 — 避開 iOS 動態島 / 瀏海。
     ⚠ v6.195：連定義檔自己也改讀 var(--safe-top)，全站唯一還寫 env() 的地方只剩下面那段 @supports。
     非 iOS 裝置 inset=0 → padding 維持 4px；iPad/iPhone 自動補上動態島高度。
     viewport-fit=cover 已在 app.html，env() 才有值。 */
  .beta-banner {
    background: #fff3c4;
    color: #5a3e00;
    padding: calc(4px + var(--safe-top, 0px)) 12px 4px 12px;
    font-size: 12px;
    text-align: center;
    border-bottom: 1px solid #e6c870;
    line-height: 1.4;
  }
  .beta-icon {
    margin-right: 4px;
  }
  .beta-link {
    color: #8b4513;
    font-weight: bold;
    text-decoration: underline;
  }
  .beta-link:hover {
    color: #5a2a0a;
  }
  @media (max-width: 600px) {
    .beta-banner { font-size: 11px; padding: 3px 8px; }
  }

  /* v4.938：遷移 banner — 黏在頁面頂端，所有頁面共用 */
  /* v4.946：padding-top 加 env(safe-area-inset-top) — 避開 iPhone 動態島 / 瀏海
     一般裝置 inset=0 → padding 維持 10px；iPhone 動態島 ~50px 自動加。
     viewport-fit=cover 已在 app.html，env() 才有值。 */
  .migration-banner {
    position: sticky;
    top: 0;
    z-index: 9999;
    background: linear-gradient(90deg, #1e3a20, #2d5a32);
    color: white;
    padding: calc(10px + var(--safe-top, 0px)) 14px 10px 14px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    font-size: 14px;
  }
  .migration-content {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 1400px;
    margin: 0 auto;
    flex-wrap: wrap;
  }
  .migration-icon {
    font-size: 20px;
    flex-shrink: 0;
  }
  .migration-text {
    flex: 1;
    min-width: 200px;
  }
  .migration-link {
    color: #ffd56b;
    font-weight: bold;
    text-decoration: underline;
  }
  .migration-link:hover {
    color: #fff;
  }
  .migration-btn {
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: opacity 0.15s;
  }
  .migration-btn:hover {
    opacity: 0.85;
  }
  .migration-btn.primary {
    background: #ffd56b;
    color: #1e3a20;
  }
  .migration-btn.secondary {
    background: rgba(255, 255, 255, 0.18);
    color: white;
  }
  .migration-close {
    background: transparent;
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
    padding: 2px 8px;
    line-height: 1;
    opacity: 0.7;
  }
  .migration-close:hover {
    opacity: 1;
  }
  @media (max-width: 600px) {
    .migration-banner { font-size: 13px; padding: 8px 10px; }
    .migration-icon { display: none; }
    .migration-text { width: 100%; margin-bottom: 4px; }
  }
</style>
