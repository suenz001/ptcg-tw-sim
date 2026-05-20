<script lang="ts">
  import { onMount } from 'svelte';
  import { initTracking } from '$lib/tracking';

  let { children } = $props();

  // v4.938：遷移 banner — 只在 github.io 顯示（.com / localhost 都不顯示）。
  //   localStorage 記住「暫時不要」決定 — 7 天後再次顯示。
  let showMigrationBanner = $state(false);
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
    initTracking();
    showMigrationBanner = shouldShowMigrationBanner();
  });
</script>

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
  /* v2.202+：統一 body baseline — 所有頁面預設白底，
     避免跨頁導航時殘留前一頁的深色背景（例如 /game 的墨綠）。
     /game 頁的 :global(body) 會在該頁載入時覆蓋此值。 */
  :global(body) {
    margin: 0;
    background: #f4f4f6;
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
    padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px 14px;
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
