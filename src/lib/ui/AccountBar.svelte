<script lang="ts">
  /**
   * ⭐v6.507 全站頁首統一：帳號列（PageHeader 的第 3 層）。
   *   左：雲端同步狀態＋帳號（email 太長時以「…」截斷）；右：更改密碼、登出（匿名時是「建立帳號」）。
   *   牌組編輯器、對戰演練、錦標賽原本各寫一份、順序也不一樣（站長 2026-10-07 回報）⇒ 收成這一份。
   *
   * ⚠ 同步狀態的文字只有這裡一份（原本牌組編輯器與對戰大廳各抄一次）。
   * ⚠ 保留舊的 class（sync-pill／sync-xxx、auth-email、auth-btn anon）⇒ 既有量測腳本與守衛的錨點照樣找得到。
   */
  let {
    email = null,
    anonymous = false,
    syncStatus = null,
    syncError = null,
    unsaved = 0,
    onCreateAccount = undefined,
    onChangePassword = undefined,
    onSignOut = undefined,
    busy = false,
  }: {
    email?: string | null;
    anonymous?: boolean;
    /** 'idle' | 'syncing' | 'synced' | 'error'；null ＝ 不顯示同步狀態（例：錦標賽） */
    syncStatus?: string | null;
    syncError?: string | null;
    /** 未存檔的牌組數（牌組編輯器用；> 0 時顯示「📝 未存檔 (N)」） */
    unsaved?: number;
    onCreateAccount?: () => void;
    onChangePassword?: () => void;
    onSignOut?: () => void;
    /** 處理中（例：錦標賽送出請求時）⇒ 按鈕暫時不能按 */
    busy?: boolean;
  } = $props();

  // 同步狀態：種類（決定顏色）、文字、滑鼠停留說明
  const syncKind = $derived(unsaved > 0 ? 'unsaved' : (syncStatus ?? 'idle'));
  const syncLabel = $derived(
    unsaved > 0 ? `📝 未存檔 (${unsaved})`
      : syncStatus === 'syncing' ? '⏳ 同步中'
      : syncStatus === 'synced' ? '☁️ 已同步'
      : syncStatus === 'error' ? '⚠️ 離線（hover 看原因）'
      : '⬜ 本機'
  );
  const syncTitle = $derived(
    unsaved > 0 ? `有 ${unsaved} 個牌組未存檔（按 💾 存檔 推到雲端）`
      : syncStatus === 'error' ? (syncError ?? '雲端連線失敗') : ''
  );
</script>

<div class="acct">
  <div class="acct-who">
    {#if syncStatus !== null}
      <span class="sync-pill sync-{syncKind}" title={syncTitle}>{syncLabel}</span>
    {/if}
    {#if anonymous}
      <span class="auth-email">👤 匿名（建立帳號後可跨裝置保存牌組）</span>
    {:else if email}
      <span class="auth-email" title={email}>✉️ {email}</span>
    {/if}
  </div>
  <div class="acct-btns">
    {#if anonymous}
      {#if onCreateAccount}
        <button class="acct-btn primary auth-btn anon" onclick={onCreateAccount} disabled={busy} title="建立帳號以跨裝置保存牌組">建立帳號</button>
      {/if}
    {:else}
      {#if onChangePassword}
        <button class="acct-btn" onclick={onChangePassword} disabled={busy} title="更改密碼">🔑 更改密碼</button>
      {/if}
      {#if onSignOut}
        <button class="acct-btn danger" onclick={onSignOut} disabled={busy}>登出</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .acct {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    font-size: 0.85rem;
  }
  .acct-who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .auth-email {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-muted);
  }
  .acct-btns {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
    margin-left: auto;
  }
  .acct-btn {
    min-height: 32px;
    box-sizing: border-box;
    padding: 4px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-bg-elev);
    color: var(--ui-text);
    font: inherit;
    font-size: 0.82rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .acct-btn:disabled { opacity: 0.55; cursor: default; }
  .acct-btn:hover:not(:disabled) { background: var(--ui-accent-soft); border-color: var(--ui-accent); }
  .acct-btn.primary { background: var(--ui-accent); border-color: var(--ui-accent); color: var(--ui-accent-contrast); }
  .acct-btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
  .acct-btn.danger { color: #c0392b; }
  :global(html[data-theme='dark']) .acct-btn.danger { color: #ff8a80; }

  /* 同步狀態膠囊：淺色主題 */
  .sync-pill {
    flex: 0 0 auto;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .sync-idle    { background: var(--ui-bg-sunken); color: var(--ui-text-muted); }   /* v6.506 起「⬜ 本機」讀色票 */
  .sync-syncing { background: #fff4cc; color: #7a5800; }
  .sync-synced  { background: #e0f4e6; color: #1a6030; }
  .sync-error   { background: #fdeaea; color: #9b1c1c; cursor: help; }
  .sync-unsaved { background: #fff1d6; color: #8a4b00; }
  /* 深色主題 */
  :global(html[data-theme='dark']) .sync-syncing { background: #4a3f12; color: #ffe08a; }
  :global(html[data-theme='dark']) .sync-synced  { background: #1f4a2c; color: #9be3b4; }
  :global(html[data-theme='dark']) .sync-error   { background: #4d1f1f; color: #ffb4b4; }
  :global(html[data-theme='dark']) .sync-unsaved { background: #4a3512; color: #ffd08a; }

  /* 手機：按鈕加高到好按的 40px */
  :global(html:not([data-ui-wide])) .acct-btn { min-height: 40px; }
</style>
