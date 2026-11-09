<script lang="ts">
  import { togglePrintedCost } from './cost-filter';
  let {
    retreat = $bindable(new Set<number>()), attack = $bindable(new Set<number>()),
    retreatOptions, attackOptions
  }: {
    retreat: Set<number>; attack: Set<number>;
    retreatOptions: readonly number[]; attackOptions: readonly number[];
  } = $props();
</script>

<!-- >>> v6636-cost-filter-controls -->
<div class="cost-filters">
  <div class="cost-row" role="group" aria-label="撤退費用（可複選）">
    <span class="cost-label">撤退費用：</span>
    <button type="button" aria-pressed={retreat.size === 0} onclick={() => retreat = new Set()}>不限</button>
    {#each retreatOptions as value (value)}
      <button type="button" aria-pressed={retreat.has(value)} onclick={() => retreat = togglePrintedCost(retreat, value)}>{value}</button>
    {/each}
  </div>
  <div class="cost-row" role="group" aria-label="招式費用（可複選）">
    <span class="cost-label">招式費用：</span>
    <button type="button" aria-pressed={attack.size === 0} onclick={() => attack = new Set()}>不限</button>
    {#each attackOptions as value (value)}
      <button type="button" aria-pressed={attack.has(value)} onclick={() => attack = togglePrintedCost(attack, value)}>{value === 0 ? '不需能量' : `${value}顆`}</button>
    {/each}
  </div>
  <p>依卡面費用篩選，可複選；任一招式符合即顯示。</p>
</div>
<!-- <<< v6636-cost-filter-controls -->

<style>
  .cost-filters { min-width: 0; margin: .5rem 0; color: var(--ui-text, #293a30); }
  .cost-row { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; margin: .35rem 0; }
  .cost-label { font-size: .8rem; font-weight: 600; }
  button { min-width: 36px; min-height: 36px; padding: .3rem .55rem; border: 1px solid var(--ui-border, #c5d0c8); border-radius: 999px; background: var(--ui-bg-elev, #f1f4f0); color: inherit; font: inherit; font-size: .8rem; cursor: pointer; }
  button[aria-pressed="true"] { background: var(--ui-chip-active-bg, #286443); color: var(--ui-chip-active-text, #fff); border-color: var(--ui-chip-active-bg, #286443); }
  button:focus-visible { outline: 2px solid var(--ui-accent, #286443); outline-offset: 2px; }
  p { margin: .3rem 0; color: var(--ui-text-muted, #526258); font-size: .75rem; line-height: 1.5; }
</style>
