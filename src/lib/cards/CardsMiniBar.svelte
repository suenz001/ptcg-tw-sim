<script lang="ts">
  // ⭐v6.480 卡牌資料庫網頁版（≥1024px）「迷你搜尋列」（站長：「依你的建議處理」第 6 項）。
  //
  // 為什麼不是把整個篩選面板 sticky：網頁版篩選面板約 250px 高（搜尋＋分類＋標籤＋屬性＋階段＋賽季），
  //   黏在畫面上會吃掉三分之一的卡圖空間。改成：篩選面板捲出畫面後，頂端列下方浮出一條細的搜尋列
  //   （同一個搜尋字串、目前張數、「篩選條件 ↑」回到面板），捲回來就收起。
  // ・手機（<1024px）：不建 IntersectionObserver、CSS 也不顯示 ⇒ 手機一個像素都不變。
  // ・搜尋框與面板裡那個是同一個 query（$bindable）⇒ 兩邊打字結果一致，沒有第二份狀態。
  // ⚠ props 不給預設值（與 SiteTopBar 同理：Svelte 執行期會為預設值多拆一個 chunk）。
  let { query = $bindable(), count, target, placeholder } = $props();

  let out = $state(false);

  $effect(() => {
    const el = target as HTMLElement | null | undefined;
    if (!el || typeof IntersectionObserver !== 'function') return;
    try {
      if (typeof matchMedia !== 'function' || !matchMedia('(min-width: 1024px)').matches) return;
    } catch { return; }
    // 面板「整個捲到頂端列上方」才算捲出去（rootMargin 扣掉頂端列高度）；捲到下方看不到不算
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      out = !e.isIntersecting && e.boundingClientRect.top < 0;
    }, { rootMargin: '-60px 0px 0px 0px', threshold: 0 });
    io.observe(el);
    return () => { io.disconnect(); out = false; };
  });

  function backToFilters() {
    const el = target as HTMLElement | null | undefined;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
</script>

{#if out}
  <div class="cmb" role="search">
    <input class="cmb-input" type="search" bind:value={query} {placeholder} aria-label="搜尋卡牌" />
    <span class="cmb-count">顯示 {count} 張</span>
    <button class="cmb-back" type="button" onclick={backToFilters}>篩選條件 ↑</button>
  </div>
{/if}

<style>
  .cmb { display: none; }
  @media (min-width: 1024px) {
    .cmb {
      display: flex;
      align-items: center;
      gap: 12px;
      position: fixed;
      top: calc(var(--safe-top, 0px) + 66px);
      left: 50%;
      transform: translateX(-50%);
      width: min(1200px, calc(100vw - 48px));
      box-sizing: border-box;
      z-index: 40;   /* 低於頂端列（50），高於卡片 */
      padding: 8px 12px;
      background: var(--ui-bg-elev);
      color: var(--ui-text);
      border: 1px solid var(--ui-border);
      border-radius: 12px;
      box-shadow: var(--ui-shadow-hover);
    }
    .cmb-input {
      flex: 1 1 auto;
      min-width: 0;
      padding: 8px 12px;
      font-size: 0.95rem;
      border-radius: 8px;
      border: 1px solid var(--ui-border);
      background: var(--ui-input-bg);
      color: var(--ui-text);
    }
    .cmb-input:focus { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
    .cmb-count { flex: none; font-size: 0.85rem; color: var(--ui-text-muted); white-space: nowrap; }
    .cmb-back {
      flex: none;
      padding: 7px 14px;
      border-radius: 999px;
      border: 1px solid var(--ui-border);
      background: var(--ui-accent-soft);
      color: var(--ui-link);
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .cmb-back:hover { border-color: var(--ui-accent); }
  }
</style>
