<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  /* v2.138 全站基底白底 — 鎖定避免 game 頁 :global(body) 深綠 leak 到主選單/卡片頁/牌組編輯器 */
  :global(body) {
    margin: 0;
    background: #f4f4f6;
    color: #222;
  }
  :global(html) {
    background: #f4f4f6;
  }
</style>
