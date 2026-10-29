<script lang="ts">
  import type { Card } from '$lib/cards/types';
  import type { CardInstance } from '$lib/game/types';
  import { attachedEnergyGroups } from '$lib/cards/attached-energy';
  let { inst, pool, compact = false, disabled = false, oninspect }: {
    inst: CardInstance; pool: ReadonlyMap<string, Card>; compact?: boolean; disabled?: boolean;
    oninspect: (iid: string) => void;
  } = $props();
  const groups = $derived(attachedEnergyGroups(inst, pool).filter(g => g.special));
</script>

<span class="special-energy-badges" class:compact class:inactive={disabled}>
  {#if compact && groups.length > 1}
    <button type="button" aria-label={`查看附加能量：${groups.map(g => `${g.name} ${g.count}張`).join('、')}`}
      title="特殊能量 {groups.length} 種，點擊查看卡片" disabled={disabled} tabindex={disabled ? -1 : 0}
      onclick={(e) => { e.preventDefault(); e.stopPropagation(); oninspect(inst.iid); }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }} onpointerdown={(e) => e.stopPropagation()}>特{groups.length}種</button>
  {:else}
    {#each groups as group (group.key)}
      <button type="button" aria-label={`查看附加能量：${group.name} ${group.count}張`}
        title="{group.name} ×{group.count}張，點擊查看卡片" disabled={disabled} tabindex={disabled ? -1 : 0}
        onclick={(e) => { e.preventDefault(); e.stopPropagation(); oninspect(inst.iid); }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }} onpointerdown={(e) => e.stopPropagation()}>{group.shortName}{compact ? '' : ' ×'}{group.count}</button>
    {/each}
  {/if}
</span>

<style>
  .special-energy-badges{display:inline-flex;flex:0 0 auto;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;max-width:100%;vertical-align:middle;position:relative;z-index:1;pointer-events:auto;max-height:78px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;}
  button{flex:none;box-sizing:border-box;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-size:12px;line-height:18px;min-height:22px;padding:1px 7px;border:1px solid #c5a56a;border-left:3px solid #e2c386;border-radius:5px;background:#41362a;color:#ffe1a0;cursor:zoom-in;text-shadow:none;}
  button:focus-visible{outline:2px solid #fff2bf;outline-offset:-3px;}
  .compact{gap:2px;max-width:100%;flex-wrap:nowrap;max-height:none;overflow:visible;}
  .compact button{font-size:10px;line-height:14px;min-height:16px;padding:0 3px;max-width:100%;border-left-width:2px;}
  :global(.active-nrg-col) .special-energy-badges{flex-direction:column;flex-wrap:nowrap;align-items:stretch;max-width:90px;max-height:110px;overflow-y:auto;}
  :global(.bench-nrg) .special-energy-badges{max-width:65px;}
  /* 特殊標記利用既有附加卡扇形區，避開寶可夢名稱及HP。 */
  :global(.playmat.layout-tabletop .active-card .tt-attach-overlay):has(.special-energy-badges button){left:calc(100% + 8px);right:auto;bottom:0;width:86px;}
  :global(.playmat.layout-fable:not(.layout-blue) .active-card .tt-attach-overlay):has(.special-energy-badges button){left:calc(115% + 8px);right:auto;bottom:0;width:86px;}
  .inactive{pointer-events:none;}
</style>
