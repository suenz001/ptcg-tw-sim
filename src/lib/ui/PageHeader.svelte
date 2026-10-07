<script lang="ts">
  /**
   * ⭐v6.507 全站頁首統一（站長 2026-10-07：「牌組編輯器、對戰、錦標賽上方排版的方式明顯不一致耶，例如帳號和標題的順序」
   *   「你要針對這些不同時期 ai 做出來的排版，做一個一致性的統一規劃」；選定「照這個規劃做」）。
   *
   * 每一頁的頁首都是同一張卡片、同樣三層：
   *   第 1 層：標題（左）＋本頁捷徑（右，例：📋 牌組公布欄、← 返回）
   *   第 2 層：副標（灰字，選填）
   *   第 3 層：帳號列（選填，只在需要登入的頁；用 AccountBar）——永遠在卡片最底部、上面一條分隔線
   * 頁籤（線上對戰／好友名單、錦標賽分頁）不放進卡片，由各頁接在卡片正下方。
   * 手機同樣三層，空間不夠時捷徑自動換到標題下一行。
   *
   * ⚠ 不放「← 首頁」：手機有底部導覽列（含 🏠 首頁）、網頁版有頂端列（v6.504 站長選定）。
   * ⚠ 顏色一律讀 layout 的 --ui-* 色票 ⇒ 深色／淺色主題自動跟著換。
   * ⚠ 樣式都在本元件裡（Svelte 範圍樣式）⇒ 各頁舊的頁首樣式碰不到這裡的元素，不會有「誰蓋過誰」的問題。
   */
  import type { Snippet } from 'svelte';

  let {
    title,
    sub = undefined,
    actions = undefined,
    account = undefined,
    cls = '',
  }: {
    /** 標題文字（含圖示），或自訂內容（例：卡包代號＋名稱） */
    title: string | Snippet;
    /** 副標：字串或自訂內容 */
    sub?: string | Snippet;
    /** 右上捷徑（a 或 button，會套上統一的膠囊樣式） */
    actions?: Snippet;
    /** 帳號列（通常放 <AccountBar>） */
    account?: Snippet;
    /** 額外 class（保留各頁原本的錨點類別，例：page-head） */
    cls?: string;
  } = $props();
</script>

<header class="ph {cls}">
  <div class="ph-row">
    <h1 class="ph-title">{#if typeof title === 'string'}{title}{:else}{@render title()}{/if}</h1>
    {#if actions}<div class="ph-actions">{@render actions()}</div>{/if}
  </div>
  {#if sub}
    <p class="ph-sub">{#if typeof sub === 'string'}{sub}{:else}{@render sub()}{/if}</p>
  {/if}
  {#if account}<div class="ph-account">{@render account()}</div>{/if}
</header>

<style>
  .ph {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 0 18px;
    padding: 16px 22px;
    background: var(--ui-hero-bg);
    border: 1px solid var(--ui-border);
    border-radius: 16px;
    box-shadow: var(--ui-shadow);
    color: var(--ui-text);
    box-sizing: border-box;
    text-align: left;
    /* 字型統一（有些頁沒指定字型，會顯示成瀏覽器預設的襯線體） */
    font-family: system-ui, -apple-system, 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
  }
  .ph-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .ph-title {
    /* 標題列的高度固定等於捷徑膠囊的高度（網頁版 34px、手機 40px）：
       有沒有捷徑，標題都在同一個高度 ⇒ 切頁時標題不會上下跳（v6.503 公布欄切頁守衛量的就是這個） */
    display: flex;
    align-items: center;
    min-height: 34px;
    margin: 0;
    min-width: 0;
    font-size: 1.5rem;
    line-height: 1.25;
    color: var(--ui-text);
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    box-shadow: none;
  }
  .ph-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: auto;
  }
  /* 捷徑：統一的膠囊樣式（各頁傳進來的 a／button） */
  .ph-actions :global(:is(a, button)) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    box-sizing: border-box;
    padding: 4px 14px;
    border: 1px solid var(--ui-border);
    border-radius: 999px;
    background: var(--ui-bg-elev);
    color: var(--ui-link);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }
  .ph-actions :global(:is(a, button):hover) {
    background: var(--ui-accent-soft);
    border-color: var(--ui-accent);
    text-decoration: none;
  }
  .ph-sub {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ui-text-muted);
  }
  .ph-account {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--ui-border);
  }

  /* 手機（< 1024px，與其他頁同一個開關）：卡片縮小、標題 1.3rem */
  :global(html:not([data-ui-wide])) .ph {
    margin-bottom: 12px;
    padding: 12px 14px;
    border-radius: 14px;
  }
  :global(html:not([data-ui-wide])) .ph-title { font-size: 1.3rem; min-height: 40px; }
  :global(html:not([data-ui-wide])) .ph-actions :global(:is(a, button)) { min-height: 40px; }
</style>
