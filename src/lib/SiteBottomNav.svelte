<script lang="ts">
  // ⭐v6.497 手機／平板（<1024px）全站底部導覽列（站長手機清單第 1 項：「手機沒有全站導覽」）。
  //   ・與網頁版頂端列（SiteTopBar，≥1024px）互補：兩者用同一份 NAV_ITEMS／activeNavHref（$lib/site-theme.ts）。
  //   ・進入牌桌（對戰頁在 <html> 掛 data-battle-view）時收起 ⇒ 牌桌空間與改版前相同。
  //   ・⚠ 只在 @media (max-width:1023px) 顯示 ⇒ 網頁版一個像素都不變（DOM 在，但 display:none）。
  //   ・頁面底部預留空間由 layout 的全域規則處理（同一個條件），內容不會被導覽列蓋住。
  //   ・⚠ 比照 SiteTopBar：props 不給預設值、逐條寫出不用 {#each}（layout 是每一頁的第一批預載，見該檔註解）。
  import { activeNavHref } from '$lib/site-theme';

  let { pathname, base }: { pathname: string; base: string } = $props();
  const active = $derived(activeNavHref(pathname, base));
</script>

<!-- 對戰演練／錦標賽大廳是深色底 ⇒ 導覽列跟著換深色，不要一條白邊 -->
<nav class="sbn" class:dark={active === '/game' || active === '/tournament'} aria-label="主要功能">
  <a class="sbn-link" class:active={active === '/cards'} href="{base}/cards" aria-current={active === '/cards' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🃏</span><span class="sbn-lb">卡牌</span></a>
  <a class="sbn-link" class:active={active === '/decks'} href="{base}/decks" aria-current={active === '/decks' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🧩</span><span class="sbn-lb">牌組</span></a>
  <a class="sbn-link" class:active={active === '/deck-posts'} href="{base}/deck-posts" aria-current={active === '/deck-posts' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">📋</span><span class="sbn-lb">公布欄</span></a>
  <a class="sbn-link" class:active={active === '/game'} href="{base}/game" aria-current={active === '/game' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">⚔️</span><span class="sbn-lb">對戰</span></a>
  <a class="sbn-link" class:active={active === '/tournament'} href="{base}/tournament" aria-current={active === '/tournament' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🏆</span><span class="sbn-lb">錦標賽</span></a>
</nav>

<style>
  /* 預設（網頁版 ≥1024px）：完全不顯示 */
  .sbn { display: none; }
  @media (max-width: 1023px) {
    .sbn {
      display: flex;
      position: fixed;
      left: 0; right: 0; bottom: 0;
      /* 低於各頁的彈出視窗（卡片詳情、選擇視窗等都是 ≥100）⇒ 視窗開著時蓋在導覽列上面 */
      z-index: 40;
      height: calc(56px + var(--safe-bottom, 0px));
      padding-bottom: var(--safe-bottom, 0px);
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.97);
      border-top: 1px solid #e2e5ea;
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.06);
      font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    }
    /* 牌桌畫面收起（與網頁版頂端列同一個開關） */
    :global(html[data-battle-view]) .sbn { display: none; }
    /* 頁面底部預留導覽列的高度，內容捲到底不會被蓋住（牌桌畫面不留） */
    :global(html:not([data-battle-view]) body) { padding-bottom: calc(56px + var(--safe-bottom, 0px)); }
    .sbn-link {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: #5b6472;
      text-decoration: none;
      font-size: 11px;
      line-height: 1.2;
      -webkit-tap-highlight-color: transparent;
    }
    .sbn-ico { font-size: 20px; line-height: 1; }
    .sbn-lb { white-space: nowrap; }
    .sbn-link.active { color: #2563eb; font-weight: 700; }
    .sbn-link.active .sbn-ico { transform: translateY(-1px); }
    .sbn.dark { background: rgba(16, 32, 22, 0.97); border-top-color: #2f4a37; box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.35); }
    .sbn.dark .sbn-link { color: #a9bdb0; }
    .sbn.dark .sbn-link.active { color: #7ee2a8; }
  }
</style>
