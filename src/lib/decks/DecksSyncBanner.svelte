<script lang="ts">
  let {
    anonymous = false,
    initializing = false,
    syncStatus = 'idle',
    syncError = null,
    localSaveError = null,
    onOpenAuth = undefined,
    onRetrySync = undefined,
  }: {
    anonymous?: boolean;
    initializing?: boolean;
    syncStatus?: string;
    syncError?: string | null;
    localSaveError?: string | null;
    onOpenAuth?: () => void;
    onRetrySync?: () => void;
  } = $props();
</script>

{#if localSaveError}
  <div class="dsb-banner dsb-warn" role="alert">
    <span>{localSaveError}</span>
  </div>
{/if}

{#if anonymous && !initializing}
  <div class="dsb-banner dsb-anon">
    <span class="dsb-text">📱 目前僅存在此瀏覽器，登入後可同步跨裝置使用。</span>
    {#if onOpenAuth}
      <button type="button" class="dsb-btn" onclick={onOpenAuth}>登入／建帳</button>
    {/if}
  </div>
{:else if !anonymous && syncStatus === 'error'}
  <div class="dsb-banner dsb-err" role="alert">
    <span class="dsb-text">⚠️ 雲端同步未完成（已保留於本機）{syncError ? `：${syncError}` : ''}</span>
    {#if onRetrySync}
      <button type="button" class="dsb-btn" onclick={onRetrySync}>🔄 重試同步</button>
    {/if}
  </div>
{/if}

<style>
  .dsb-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px;
    margin: 0 0 8px;
    border-radius: 6px;
    font-size: 0.76rem;
    line-height: 1.4;
  }
  .dsb-text { min-width: 0; overflow-wrap: anywhere; }
  .dsb-anon {
    background: var(--ui-bg-sunken, #16231a);
    border: 1px solid var(--ui-border, #3a5a42);
    color: var(--ui-text-muted, #cfe6d4);
  }
  .dsb-warn, .dsb-err {
    background: rgba(180, 40, 40, 0.16);
    border: 1px solid rgba(220, 80, 80, 0.55);
    color: #ffd7d7;
  }
  :global(html[data-theme="light"]) .dsb-warn,
  :global(html[data-theme="light"]) .dsb-err {
    background: #fff2f0;
    border-color: #ffccc7;
    color: #9e1c1c;
  }
  .dsb-btn {
    flex: 0 0 auto;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid var(--ui-border, #4f7b58);
    background: var(--ui-bg-elev, #253d2c);
    color: var(--ui-text, #f0f7f2);
    font-size: 0.74rem;
    cursor: pointer;
    white-space: nowrap;
  }
</style>
