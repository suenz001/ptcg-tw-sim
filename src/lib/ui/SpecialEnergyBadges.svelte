<script lang="ts">
  import type { Card } from '$lib/cards/types';
  import type { CardInstance } from '$lib/game/types';
  import { attachedEnergyGroups } from '$lib/cards/attached-energy';
  let { inst, pool, compact = false, mobile = false, disabled = false, oninspect }: {
    inst: CardInstance; pool: ReadonlyMap<string, Card>; compact?: boolean; mobile?: boolean; disabled?: boolean;
    oninspect: (iid: string) => void;
  } = $props();
  // ⭐v6.611（審查 P3-2）張數多的排前面（同張數照附加順序，Array.sort 穩定）⇒ 桌機「第一種 等N種」顯示的是最多的那種
  const groups = $derived(attachedEnergyGroups(inst, pool).filter(g => g.special).sort((a, b) => b.count - a.count));
  // ⭐v6.611（站長 2026-10-30：「特殊能量的顯示還是佔太大的版面」，看過前後對照圖同意）：
  //   同一隻寶可夢的特殊能量合成「一顆」小膠囊，例如「燃火×2・稜鏡」（原本每種一顆大按鈕，新版桌墊會疊兩排蓋住卡圖）。
  //   ・數量格式沿用 v6.610 站長指定：一張省略；多張桌機 ×N、手機 N。
  //   ・桌機：超過兩種、或兩種合起來超過 7 個字（例如「硬岩×2・衝天×2」，審查 P2-1：86px 欄會被截斷）⇒ 寫「第一種 等N種」；
  //     手機右側空間夠，全部列出（真的太長以省略號收尾、不換行）。
  //   ・備戰（compact）維持 v6.609：一種寫短名、多種寫「特N種」。
  //   ・完整卡名與張數在 aria-label／title，點一下照舊打開完整清單與卡圖（oninspect 不變）。
  const DESKTOP_JOIN_MAX = 7;   // 桌機兩種相連最多幾個字（「燃火×2・稜鏡」＝7）
  const label = (g: { shortName: string; count: number }) => g.shortName + (g.count > 1 ? `${mobile ? '' : '×'}${g.count}` : '');
  const fullText = $derived(groups.map(g => `${g.name} ${g.count}張`).join('、'));
  const pillText = $derived(compact
    ? (groups.length > 1 ? `特${groups.length}種` : groups.map(label).join(''))
    : (!mobile && (groups.length > 2 || groups.map(label).join('・').length > DESKTOP_JOIN_MAX)
        ? `${label(groups[0])} 等${groups.length}種` : groups.map(label).join('・')));
</script>

<span class="special-energy-badges" class:compact class:inactive={disabled}>
  {#if groups.length}
    <button type="button" aria-label={`查看附加能量：${fullText}`}
      title="{fullText}，點擊查看卡片" disabled={disabled} tabindex={disabled ? -1 : 0}
      onclick={(e) => { e.preventDefault(); e.stopPropagation(); oninspect(inst.iid); }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }} onpointerdown={(e) => e.stopPropagation()}>{pillText}</button>
  {/if}
</span>

<style>
  /* ⭐v6.611 一顆深色半透明圓角膠囊、細金框、金色字（風格沿用 v6.609 的金棕，只是更輕）；超出寬度以省略號收尾 */
  .special-energy-badges{display:inline-flex;flex:0 1 auto;align-items:center;min-width:0;max-width:100%;vertical-align:middle;position:relative;z-index:1;pointer-events:auto;}
  button{flex:0 1 auto;box-sizing:border-box;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-size:11px;font-weight:600;line-height:15px;min-height:17px;padding:0 5px;border:1px solid rgba(226,195,134,.75);border-radius:999px;background:rgba(28,22,14,.86);color:#ffd98a;cursor:zoom-in;text-shadow:none;}
  button:hover{background:rgba(60,46,24,.95);}
  button:focus-visible{outline:2px solid #fff2bf;outline-offset:-2px;}   /* 內縮：放在 overflow:hidden 的欄裡也看得到（審查 P3-3） */
  /* 備戰：不讓基本能量把標記擠到看不見（v6.609 B5 的意圖）⇒ 不收縮 */
  .compact{flex:none;}
  .compact button{flex:none;font-size:10px;line-height:13px;min-height:14px;padding:0 4px;}
  :global(.active-nrg-col) .special-energy-badges{max-width:90px;}
  :global(.bench-nrg) .special-energy-badges{max-width:65px;}
  /* 特殊標記利用既有附加卡扇形區，避開寶可夢名稱及HP。 */
  :global(.playmat.layout-tabletop .active-card .tt-attach-overlay):has(.special-energy-badges button){left:calc(100% + 8px);right:auto;bottom:0;width:86px;}
  :global(.playmat.layout-fable:not(.layout-blue) .active-card .tt-attach-overlay):has(.special-energy-badges button){left:calc(115% + 8px);right:auto;bottom:0;width:86px;}
  .inactive{pointer-events:none;}
</style>
