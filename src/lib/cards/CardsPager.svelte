<script lang="ts">
  import type { cardsPageRange } from './pagination';

  let { range, position, onchange }: {
    range: ReturnType<typeof cardsPageRange>;
    position: 'top' | 'bottom';
    onchange: (page: number) => void;
  } = $props();
</script>

<nav class="cards-pager" aria-label={position === 'top' ? '卡牌分頁（上方）' : '卡牌分頁（下方）'}>
  <span class="range" aria-live={position === 'top' ? 'polite' : 'off'} aria-atomic="true">
    {range.total ? range.start + 1 : 0}–{range.end} / {range.total} 張
  </span>
  <div class="buttons">
    <button type="button" disabled={range.page === 1} onclick={() => onchange(range.page - 1)}>上一頁</button>
    <label>
      <span class="sr-only">前往頁碼</span>
      <select aria-label="前往頁碼" value={range.page} onchange={(e) => onchange(Number(e.currentTarget.value))}>
        {#each Array.from({ length: range.pages }, (_, i) => i + 1) as page (page)}
          <option value={page}>第 {page} / {range.pages} 頁</option>
        {/each}
      </select>
    </label>
    <button type="button" disabled={range.page === range.pages} onclick={() => onchange(range.page + 1)}>下一頁</button>
  </div>
</nav>

<style>
  .cards-pager {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    max-width: 1200px;
    margin: 12px auto;
    padding: 0 1rem;
    box-sizing: border-box;
    color: var(--ui-text, #26362c);
    font-size: 0.875rem;
  }
  .range { color: var(--ui-text-muted, #526055); font-variant-numeric: tabular-nums; }
  .buttons { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  button, select {
    box-sizing: border-box;
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid var(--ui-border, #b9c2ba);
    border-radius: 8px;
    background: var(--ui-bg-elev, #fff);
    color: var(--ui-text, #26362c);
    font: inherit;
    cursor: pointer;
  }
  button:not(:disabled):hover { background: var(--ui-accent-soft, #e3ece5); }
  button:disabled { opacity: 0.45; cursor: default; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--ui-accent, #326447); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
