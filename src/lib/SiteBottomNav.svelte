<script lang="ts">
  // ⭐v6.497 手機／平板（<1024px）全站底部導覽列（站長手機清單第 1 項：「手機沒有全站導覽」）。
  //   ・與網頁版頂端列（SiteTopBar，≥1024px）互補：兩者用同一份 NAV_ITEMS／activeNavHref（$lib/site-theme.ts）。
  //   ・進入牌桌（對戰頁在 <html> 掛 data-battle-view）時收起 ⇒ 牌桌空間與改版前相同。
  //   ・⚠ 只在 @media (max-width:1023px) 顯示 ⇒ 網頁版一個像素都不變（DOM 在，但 display:none）。
  //   ・頁面底部預留空間由 layout 的全域規則處理（同一個條件），內容不會被導覽列蓋住。
  //   ・⚠ 比照 SiteTopBar：props 不給預設值、逐條寫出不用 {#each}（layout 是每一頁的第一批預載，見該檔註解）。
  import { activeNavHref, stripBase, type UiTheme } from '$lib/site-theme';

  // ⭐v6.498：手機沒有頂端列 ⇒ 深色／淺色切換鈕放在底部導覽列最右邊（與網頁版頂端列同一個切換函式）
  let { pathname, base, theme, ontoggle }: { pathname: string; base: string; theme: UiTheme; ontoggle: () => void } = $props();
  const active = $derived(activeNavHref(pathname, base));
  // ⭐v6.507（站長：「手機板現在沒有辦法回到網站首頁了??」）：v6.504 拿掉頁面內的「← 首頁」後，手機只剩這條導覽列 ⇒ 最左邊補一顆首頁
  const atHome = $derived(stripBase(pathname, base) === '/');
</script>

<!-- ⭐v6.499：對戰演練／錦標賽大廳在手機也跟著主題（淺色＝淺底）⇒ 導覽列不再對這兩頁強制深色，只看主題 -->
<nav class="sbn" aria-label="主要功能">
  <a class="sbn-link sbn-home" class:active={atHome} href="{base}/" aria-current={atHome ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🏠</span><span class="sbn-lb">首頁</span></a>
  <a class="sbn-link" class:active={active === '/cards'} href="{base}/cards" aria-current={active === '/cards' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🃏</span><span class="sbn-lb">卡牌</span></a>
  <a class="sbn-link" class:active={active === '/decks'} href="{base}/decks" aria-current={active === '/decks' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🧩</span><span class="sbn-lb">牌組</span></a>
  <a class="sbn-link" class:active={active === '/deck-posts'} href="{base}/deck-posts" aria-current={active === '/deck-posts' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">📋</span><span class="sbn-lb">公布欄</span></a>
  <a class="sbn-link" class:active={active === '/game'} href="{base}/game" aria-current={active === '/game' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">⚔️</span><span class="sbn-lb">對戰</span></a>
  <a class="sbn-link" class:active={active === '/tournament'} href="{base}/tournament" aria-current={active === '/tournament' ? 'page' : undefined}><span class="sbn-ico" aria-hidden="true">🏆</span><span class="sbn-lb">錦標賽</span></a>
  <button class="sbn-link sbn-theme" type="button" onclick={ontoggle}
    aria-label={theme === 'dark' ? '切換成淺色主題' : '切換成深色主題'}><span class="sbn-ico" aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span><span class="sbn-lb">{theme === 'dark' ? '淺色' : '深色'}</span></button>
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
      background: var(--ui-topbar-bg);   /* ⭐v6.511 跟著主題色票（原本寫死純白，淺色主題太亮） */
      border-top: 1px solid var(--ui-border);
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.06);
      font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    }
    /* 牌桌畫面收起（與網頁版頂端列同一個開關） */
    :global(html[data-battle-view]) .sbn { display: none; }
    /* 頁面底部預留導覽列的高度，內容捲到底不會被蓋住（牌桌畫面不留） */
    :global(html:not([data-battle-view]) body) { padding-bottom: calc(56px + var(--safe-bottom, 0px)); }
    /* ⭐v6.507（站長：按下方「公布欄」時下方選單會跳一下）：公布欄載入中那一下頁面比畫面還短，手機瀏覽器的網址列因此
       展開／收起、可視高度改變 ⇒ 固定在底部的導覽列跟著跳。其他頁一進去就夠長所以不會。
       ⇒ 每一頁最少一個畫面高（加上方預留的導覽列高度後一定可以捲），網址列的行為與其他頁一致。牌桌畫面不套。 */
    :global(html:not([data-battle-view]) body) { min-height: 100vh; }
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
    .sbn-link.active { color: #1d4ed8; font-weight: 700; }   /* ⭐v6.512 原 #2563eb 在新淺色導覽列上 4.45 */
    .sbn-link.active .sbn-ico { transform: translateY(-1px); }
    /* ⭐v6.498 深色主題時整條導覽列都用深色 */
    :global(html[data-theme='dark']) .sbn { background: var(--ui-topbar-bg); border-top-color: var(--ui-border); box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.35); }   /* ⭐v6.511 讀色票 */
    :global(html[data-theme='dark']) .sbn .sbn-link { color: #a9bdb0; }
    :global(html[data-theme='dark']) .sbn .sbn-link.active { color: #7ee2a8; }
    .sbn-theme { background: none; border: 0; padding: 0; font-family: inherit; cursor: pointer; }
    .sbn-link.sbn-theme { flex: 0.8 1 0; }
  }
</style>
