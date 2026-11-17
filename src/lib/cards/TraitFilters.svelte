<script lang="ts">
  import type { RarityFilter, AbilityFilter } from './trait-filter';
  let { rarity = $bindable('all'), ability = $bindable('all') }: {
    rarity: RarityFilter; ability: AbilityFilter;
  } = $props();
  const rarities: { value: RarityFilter; label: string }[] = [
    { value: 'all', label: '不限' }, { value: 'rare', label: '稀有卡' }, { value: 'regular', label: '一般卡' },
  ];
  const abilities: { value: AbilityFilter; label: string }[] = [
    { value: 'all', label: '不限' }, { value: 'yes', label: '有特性' }, { value: 'no', label: '無特性' },
  ];
</script>

<div class="trait-filters">
  <div class="trait-row" role="group" aria-label="稀有度篩選">
    <span class="trait-label">稀有度：</span>
    <div class="trait-options">
      {#each rarities as option (option.value)}
        <button type="button" aria-pressed={rarity === option.value} onclick={() => rarity = option.value}
          title={option.value === 'rare' ? 'AR、SR、SAR、UR 等特殊稀有度' : option.value === 'regular' ? '其他卡片，含一般 ex、ACE SPEC 與未標稀有度的特典卡' : '顯示所有稀有度'}>{option.label}</button>
      {/each}
    </div>
  </div>
  <div class="trait-row" role="group" aria-label="特性篩選">
    <span class="trait-label">特性：</span>
    <div class="trait-options">
      {#each abilities as option (option.value)}
        <button type="button" aria-pressed={ability === option.value} onclick={() => ability = option.value}
          title={option.value === 'all' ? '不限卡片種類' : '只篩選寶可夢卡面是否具有特性'}>{option.label}</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .trait-filters { flex: 0 0 100%; min-width: 0; display: grid; gap: .45rem; color: var(--ui-text, #293a30); }
  .trait-row { display: grid; grid-template-columns: var(--card-filter-label-width, 4.75rem) minmax(0, 1fr); gap: .4rem; align-items: start; }
  .trait-label { font-size: .8rem; line-height: 36px; white-space: nowrap; }
  .trait-options { display: flex; flex-wrap: wrap; gap: .35rem; min-width: 0; }
  button { min-width: 36px; min-height: 36px; padding: .3rem .6rem; border: 1px solid var(--ui-border, #c5d0c8); border-radius: 999px; background: var(--ui-bg-elev, #f1f4f0); color: inherit; font: inherit; font-size: .8rem; cursor: pointer; }
  button[aria-pressed="true"] { background: var(--ui-chip-active-bg, #286443); color: var(--ui-chip-active-text, #fff); border-color: var(--ui-chip-active-bg, #286443); }
  button:focus-visible { outline: 2px solid var(--ui-accent, #286443); outline-offset: 2px; }
</style>
