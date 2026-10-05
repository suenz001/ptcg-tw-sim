<script lang="ts">
  // ⭐v6.474 網頁版（≥1024px）全站頂端列。顯示規則與導覽項目的單一來源是 $lib/site-theme.ts。
  //   ⚠ 只在 @media (min-width:1024px) 才顯示 ⇒ 手機版面完全不變（DOM 在，但 display:none 不佔空間）。
  //   ⚠ logo 刻意用 app.html 載入畫面「同一個 URL」（含 ?v=），瀏覽器已經有它 ⇒ 不多發任何請求。
  //   ⚠ 不加 backdrop-filter／blur（低階筆電捲動會掉幀）；陰影只畫一次。
  import { activeNavHref, type UiTheme } from '$lib/site-theme';

  // ⚠ props 刻意「不給預設值」：給了預設值 Svelte 會用 $.prop() 執行期，它跟 app 入口共用 ⇒ 被拆成一個新 chunk
  //   塞進每一頁的第一批預載（HTTP/1.1 下實測冷進站多一輪往返）。呼叫端只有 layout 一處，一律全部傳入。
  let { pathname, base, version, themed, theme, ontoggle }: {
    pathname: string;
    base: string;
    version: string;
    themed: boolean;
    theme: UiTheme;
    ontoggle: () => void;
  } = $props();

  const active = $derived(activeNavHref(pathname, base));
</script>

<header class="stb" aria-label="網站導覽">
  <div class="stb-inner">
    <a class="stb-brand" href="{base}/" aria-label="回首頁">
      <img class="stb-logo" src="{base}/icons/icon-192.png?v=6.183" alt="" width="28" height="28" />
      <span class="stb-name">PTCG 實體賽事演練</span>
    </a>
    <!-- ⚠ 刻意逐條寫出、不用 {#each}：layout 是每一頁都會先載的節點，用了 {#each} 會讓 Svelte 的
         each 執行期被拆成一個新 chunk 塞進「第一批」預載（實測冷進站多一輪往返）。
         href 與文字仍以 NAV_ITEMS 為準（守衛比對兩邊一致）。 -->
    <nav class="stb-nav" aria-label="主要功能">
      <a class="stb-link" class:active={active === '/cards'} href="{base}/cards" aria-current={active === '/cards' ? 'page' : undefined}>卡牌資料庫</a>
      <a class="stb-link" class:active={active === '/decks'} href="{base}/decks" aria-current={active === '/decks' ? 'page' : undefined}>牌組編輯器</a>
      <a class="stb-link" class:active={active === '/deck-posts'} href="{base}/deck-posts" aria-current={active === '/deck-posts' ? 'page' : undefined}>牌組公布欄</a>
      <a class="stb-link" class:active={active === '/game'} href="{base}/game" aria-current={active === '/game' ? 'page' : undefined}>對戰演練</a>
      <a class="stb-link" class:active={active === '/tournament'} href="{base}/tournament" aria-current={active === '/tournament' ? 'page' : undefined}>錦標賽</a>
    </nav>
    <div class="stb-tools">
      {#if version}<span class="stb-ver">v{version}</span>{/if}
      {#if themed}
        <button class="stb-theme" type="button" onclick={ontoggle}
          aria-label={theme === 'dark' ? '切換成淺色主題' : '切換成深色主題'}
          title={theme === 'dark' ? '切換成淺色主題' : '切換成深色主題'}>{theme === 'dark' ? '☀️' : '🌙'}</button>
      {/if}
    </div>
  </div>
</header>

<style>
  /* 預設（手機與平板 <1024px）：完全不顯示，不佔任何空間。 */
  .stb { display: none; }

  @media (min-width: 1024px) {
    .stb {
      display: block;
      position: sticky;
      top: 0;
      z-index: 50;
      background: #0f2a1c;                 /* 兩種主題都用深綠：延伸對戰頁的氣氛 */
      /* ⭐ iPad 橫向（≥1024）加入主畫面以 PWA 開啟時，狀態列會疊在頁面最上方（app.html 有 viewport-fit=cover）
         ⇒ 讀全站安全區唯一來源 --safe-top（v6.187／v6.195），桌機瀏覽器是 0px、版面不變。 */
      padding-top: var(--safe-top, 0px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
      font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    }
    /* 屬性色環的 18 色細線，壓在頂端列下緣（呼應 logo；只有 2px，不搶卡圖的顏色） */
    .stb::after {
      content: '';
      position: absolute;
      left: 0; right: 0; bottom: -2px;
      height: 2px;
      background: linear-gradient(90deg, #7AC74C, #EE8130, #6390F0, #F7D02C, #A33EA1, #A8B820, #C22E28, #705746, #B7B7CE, #F95587, #A98FF3, #6F35FC, #E2BF65, #96D9D6, #735797, #B6A136, #A6B91A, #A8A77A);
      opacity: 0.85;
      pointer-events: none;
    }
    .stb-inner {
      max-width: 1280px;
      margin: 0 auto;
      height: 56px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .stb-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      flex-shrink: 0;
    }
    .stb-logo { width: 28px; height: 28px; border-radius: 7px; display: block; }
    .stb-name { color: #e6efe9; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; white-space: nowrap; }
    .stb-nav { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .stb-link {
      position: relative;
      padding: 6px 12px;
      border-radius: 8px;
      color: rgba(230, 239, 233, 0.78);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      transition: background-color 0.12s, color 0.12s;
    }
    .stb-link:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .stb-link.active { color: #fff; font-weight: 700; }
    .stb-link.active::after {
      content: '';
      position: absolute;
      left: 12px; right: 12px; bottom: -11px;
      height: 3px;
      border-radius: 3px 3px 0 0;
      background: #3dbb7a;
    }
    .stb-link:focus-visible, .stb-brand:focus-visible, .stb-theme:focus-visible {
      outline: 2px solid #3dbb7a;
      outline-offset: 2px;
    }
    .stb-tools { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .stb-ver {
      font-family: ui-monospace, 'Cascadia Code', monospace;
      font-size: 12px;
      color: rgba(230, 239, 233, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      padding: 2px 8px;
    }
    .stb-theme {
      width: 36px; height: 36px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: transparent;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      transition: background-color 0.12s;
    }
    .stb-theme:hover { background: rgba(255, 255, 255, 0.1); }
  }
  /* 1024～1200：導覽項縮一點，避免擠到換行 */
  @media (min-width: 1024px) and (max-width: 1199px) {
    .stb-inner { gap: 12px; padding: 0 16px; }
    .stb-link { padding: 6px 8px; font-size: 13px; }
    .stb-link.active::after { left: 8px; right: 8px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .stb-link, .stb-theme { transition: none; }
  }
</style>
