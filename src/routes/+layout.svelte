<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  /* v2.202+：統一 body baseline — 所有頁面預設白底，
     避免跨頁導航時殘留前一頁的深色背景（例如 /game 的墨綠）。
     /game 頁的 :global(body) 會在該頁載入時覆蓋此值。 */
  :global(body) {
    margin: 0;
    background: #f4f4f6;
  }
</style>
