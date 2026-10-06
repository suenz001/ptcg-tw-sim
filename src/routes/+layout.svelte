<script lang="ts">
  import { onMount } from 'svelte';
  import { initTracking } from '$lib/tracking';
  import { isChunkLoadError } from '$lib/sw-policy';
  import { afterNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import { applyViewportFor } from '$lib/viewport-zoom';   // ⭐v6.469 只在對戰畫面禁止雙指放大（規則見該檔）
  import SiteTopBar from '$lib/SiteTopBar.svelte';          // ⭐v6.474 網頁版（≥1024px）全站頂端列
  import SiteBottomNav from '$lib/SiteBottomNav.svelte';    // ⭐v6.497 手機／平板（<1024px）全站底部導覽列
  import { VERSION } from '$lib/version';
  import { showTopBar, isThemedRoute, applyTheme, setTheme, followSystemTheme, trackWideAttr, type UiTheme } from '$lib/site-theme';

  // ⭐v6.474：主題在 layout 初始化時（hydrate 之前、載入畫面還蓋著）就寫到 <html data-theme>，
  //   不放 onMount ⇒ 不會先畫淺色再跳深色。規則單一來源見 $lib/site-theme.ts。
  let uiTheme = $state<UiTheme>(typeof document !== 'undefined' ? applyTheme() : 'light');
  // ⭐v6.477：<html data-ui-wide>＝網頁版（≥1024px），對戰頁大廳淺色規則用它當桌機條件（該頁不能再加 @media）。
  if (typeof document !== 'undefined') trackWideAttr();
  let curPath = $state(typeof location !== 'undefined' ? location.pathname : '/');
  const topBarOn = $derived(showTopBar(curPath, base));
  const themedOn = $derived(isThemedRoute(curPath, base));
  function toggleUiTheme() { uiTheme = setTheme(uiTheme === 'dark' ? 'light' : 'dark'); }
  // ⭐v6.474：已接上主題的頁面在 <html> 掛 data-ui-themed ⇒ 網頁版整頁底色跟著主題走（CSS 在下方 <style>）。
  //   ⚠ 不用頁面自己的 <svelte:head><style>：test-lib-strip-markup-sections 的範圍級裁判只容許 friends 一個例外；
  //     而且由 layout 依路由統一切換，後續階段只要把路徑加進 THEMED_ROUTES 就生效，離開頁面時自動拿掉。
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (themedOn) document.documentElement.setAttribute('data-ui-themed', '');
    else document.documentElement.removeAttribute('data-ui-themed');
  });

  // ⭐v6.469：每次導頁（含第一次載入）後依路由套用 viewport；對戰頁維持禁縮放，其他頁（非 iOS）可兩指放大。
  afterNavigate((nav) => { try { applyViewportFor((nav.to && nav.to.url && nav.to.url.pathname) || location.pathname, base); } catch { /* 套不了就維持 app.html 原樣 */ } });
  // ⭐v6.474：頂端列的「目前所在頁」與要不要顯示，跟著導頁更新。
  afterNavigate((nav) => { try { curPath = (nav.to && nav.to.url && nav.to.url.pathname) || location.pathname; } catch { /* 維持原值 */ } });

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
    // ⭐v6.474：沒選過主題的玩家，作業系統切換深淺色時跟著變（選過就不再跟）。
    followSystemTheme((t) => { uiTheme = t; });
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

{#if topBarOn}
  <SiteTopBar pathname={curPath} {base} version={VERSION} theme={uiTheme} ontoggle={toggleUiTheme} />
  <SiteBottomNav pathname={curPath} {base} theme={uiTheme} ontoggle={toggleUiTheme} />
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

  /* ⭐v6.474 網頁版介面色票（--ui-*）：淺色＝:root，深色＝html[data-theme='dark']。
     data-theme 永遠是「實際生效的主題」（由 $lib/site-theme.ts 寫入，玩家沒選過就跟作業系統）。
     ⚠ 只有已接上主題的頁面會讀這些變數（目前只有首頁的網頁版）；對戰／錦標賽頁完全不讀 ⇒ 不受影響。
     ⚠ 用 --ui- 前綴，避免撞到對戰頁既有的自訂屬性。文字對比都 ≥ 4.5:1（Fable 5.1 規劃時已算過）。 */
  :global(:root) {
    --ui-bg: #f3f5f4;
    --ui-bg-elev: #ffffff;
    --ui-bg-sunken: #e8ecea;
    --ui-border: #d6ddd9;
    --ui-text: #1a2320;
    --ui-text-muted: #5b6762;
    --ui-accent: #1d7a4a;
    --ui-accent-contrast: #ffffff;
    --ui-accent-soft: #e3f3ea;
    --ui-link: #15663d;
    --ui-cta-bg: linear-gradient(135deg, #e3f3ea 0%, #f2faf5 100%);
    --ui-cta-text: #123a26;
    --ui-shadow: 0 1px 2px rgba(16, 36, 26, 0.06), 0 4px 12px rgba(16, 36, 26, 0.06);
    --ui-shadow-hover: 0 2px 4px rgba(16, 36, 26, 0.08), 0 10px 24px rgba(16, 36, 26, 0.12);
    --ui-hero-bg: radial-gradient(circle at 88% 0%, rgba(61, 187, 122, 0.14), transparent 55%), linear-gradient(135deg, #e9f4ee 0%, #f7f9f8 55%, #eef1f8 100%);
    /* ⭐v6.475 頂端列與「主要動作」卡（對戰／錦標賽）跟著主題（站長：淺色主題下不要是深綠） */
    --ui-topbar-bg: #ffffff;
    --ui-topbar-text: #1a2320;
    --ui-topbar-muted: #4a5751;
    --ui-topbar-hover: #eef3f0;
    --ui-topbar-border: #d6ddd9;
    --ui-topbar-shadow: 0 1px 3px rgba(16, 36, 26, 0.06);
    --ui-cta-border: #9fd3b6;
    --ui-cta-desc: #3f5a4c;
    --ui-cta-icon-bg: #ffffff;
    --ui-input-bg: #ffffff;
    --ui-chip-active-bg: #1d7a4a;
    --ui-chip-active-text: #ffffff;
  }
  :global(html[data-theme='dark']) {
    /* ⭐v6.478 深色主題全站統一成對戰大廳／牌桌的墨綠 #162816（原本首頁等頁是 #0f1f17，切頁看得出色差；Fable 5.1 建議） */
    --ui-bg: #162816;
    --ui-bg-elev: #1e3521;
    --ui-bg-sunken: #102010;
    --ui-border: #31503a;
    --ui-text: #e6efe9;
    --ui-text-muted: #a3bba5;
    --ui-accent: #3dbb7a;
    --ui-accent-contrast: #06261a;
    --ui-accent-soft: rgba(61, 187, 122, 0.14);
    --ui-link: #6cd39c;
    --ui-cta-bg: linear-gradient(135deg, #1f4a33 0%, #183a29 100%);
    --ui-cta-text: #f0f7f2;
    --ui-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.35);
    --ui-shadow-hover: 0 2px 4px rgba(0, 0, 0, 0.45), 0 12px 28px rgba(0, 0, 0, 0.45);
    --ui-hero-bg: radial-gradient(circle at 88% 0%, rgba(61, 187, 122, 0.16), transparent 55%), linear-gradient(135deg, #1f4a2c 0%, #1a321c 60%, #162816 100%);
    --ui-topbar-bg: #0f1f10;
    --ui-topbar-text: #e6efe9;
    --ui-topbar-muted: rgba(230, 239, 233, 0.78);
    --ui-topbar-hover: rgba(255, 255, 255, 0.08);
    --ui-topbar-border: rgba(255, 255, 255, 0.12);
    --ui-topbar-shadow: 0 1px 0 rgba(0, 0, 0, 0.3);
    --ui-cta-border: #2f6a4a;
    --ui-cta-desc: rgba(230, 239, 233, 0.78);
    --ui-cta-icon-bg: rgba(255, 255, 255, 0.1);
    --ui-input-bg: #102010;
    --ui-chip-active-bg: #3dbb7a;
    --ui-chip-active-text: #06261a;
  }

  /* ⭐v6.474：已接上主題的頁面（<html data-ui-themed>，由上方 $effect 依 THEMED_ROUTES 切換），網頁版整頁底色跟著主題。
     ⚠ 只在 min-width:1024px ⇒ 手機與平板直向的底色完全不變。 */
  @media (min-width: 1024px) {
    :global(html[data-ui-themed] body) { background: var(--ui-bg); }
    /* 牌桌畫面（data-battle-view）不套：牌桌的原生控件外觀維持改版前（Fable 5.1 審查） */
    :global(html[data-ui-themed][data-theme='dark']:not([data-battle-view])) { color-scheme: dark; }
    /* ⭐v6.477：對戰大廳／錦標賽大廳／好友頁自己用 <svelte:head> 以 !important 鋪墨綠底；淺色主題且不是牌桌畫面時改鋪淺底。
       ⚠ 牌桌畫面（data-battle-view）不套 ⇒ 牌桌永遠是原本的墨綠；深色主題也不套 ⇒ 大廳維持墨綠。 */
    :global(html[data-ui-themed][data-theme='light']:not([data-battle-view])),
    :global(html[data-ui-themed][data-theme='light']:not([data-battle-view]) body) { background-color: var(--ui-bg) !important; }
  }

  /* >>> v6498-mobile-dark-base */
  /* ⭐v6.498 手機／平板深色主題（站長手機清單第 6 項）：已接上主題的頁面在深色時整頁底色跟著主題。
     條件與各頁的手機深色區塊相同（data-theme='dark' 且不是網頁版 data-ui-wide）⇒ 手機淺色與網頁版都不變；牌桌畫面不套。 */
  :global(html[data-ui-themed][data-theme='dark']:not([data-ui-wide]):not([data-battle-view]) body) { background: var(--ui-bg); color: var(--ui-text); }
  :global(html[data-ui-themed][data-theme='dark']:not([data-ui-wide]):not([data-battle-view])) { color-scheme: dark; }
  /* <<< v6498-mobile-dark-base */

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
  /* ⭐v6.487 可及性：全站鍵盤焦點框（只在用鍵盤 Tab 時出現，滑鼠點擊與手機觸控不會出現）。
     :where() 特異度為 0 ⇒ 各頁自己寫的 outline 一律優先，不會蓋掉既有樣式。 */
  :global(:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible) {
    outline: 2px solid var(--ui-accent, #3dbb7a);
    outline-offset: 2px;
  }
</style>
