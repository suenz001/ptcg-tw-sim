<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<!-- v2.144：移除 v2.138 的 layout 白底 baseline — 它把 game 頁深綠切成雙色，
     且實際上各頁的 :global(body) 已自己處理背景，不需要 baseline。 -->

