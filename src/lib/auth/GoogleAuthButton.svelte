<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { User } from 'firebase/auth';
  import { continueGoogle, disconnectGoogle, googleAuthBusy, googleAuthRevision, authUiState } from './google-auth';
  import { googleAuthError } from './google-flow';
  import { pageScrollLock } from '$lib/page-scroll-lock';
  let { user = null, linkOnly = false, disabled = false, wide = false, oncomplete = undefined }: {
    user?: User | null;
    linkOnly?: boolean;
    disabled?: boolean;
    wide?: boolean;
    oncomplete?: (user: User) => void;
  } = $props();
  let error = $state('');
  // >>> v6652-google-management
  let notice = $state('');
  let dialog = $state<'link' | 'unlink' | null>(null);
  let dialogUid = $state('');
  let dialogGoogleKey = $state('');
  let password = $state('');
  let dialogError = $state('');
  const sameAccount = () => !!user && user.uid === dialogUid;
  function closeDialog() { dialog = null; password = ''; dialogError = ''; }
  function showDialog(mode: 'link' | 'unlink') {
    if (disabled || $googleAuthBusy || !user) return;
    error = ''; notice = ''; dialogError = ''; password = '';
    dialogUid = user.uid; dialogGoogleKey = account.googleKey ?? ''; dialog = mode;
  }
  function mountDialog(node: HTMLDialogElement) { node.showModal(); }
  function cancelDialog(event: Event) { event.preventDefault(); if (!$googleAuthBusy) closeDialog(); }
  $effect(() => { if (dialog && (!sameAccount() || (dialog === 'unlink' && account.googleKey !== dialogGoogleKey))) closeDialog(); });
  async function unlinkGoogle(event: SubmitEvent) {
    event.preventDefault();
    if (disabled || $googleAuthBusy || !sameAccount()) return;
    dialogError = '';
    const secret = password; password = '';
    try {
      const result = await disconnectGoogle(secret, dialogUid, dialogGoogleKey);
      if (!alive) return;
      closeDialog(); notice = '已解除 Google 綁定，可繼續使用原帳號的 Email 與密碼登入。';
      oncomplete?.(result);
    } catch (e) { if (alive && sameAccount()) dialogError = googleAuthError(e); }
  }
  function confirmLink() {
    if (disabled || $googleAuthBusy || !sameAccount()) return;
    const uid = dialogUid; closeDialog(); void run(uid);
  }
  // <<< v6652-google-management
  let alive = true;
  onDestroy(() => { alive = false; password = ''; });
  const account = $derived(authUiState(user, $googleAuthRevision));
  async function run(expectedUid?: string) {
    if (disabled || $googleAuthBusy) return;
    error = '';
    try {
      const result = await continueGoogle(linkOnly, expectedUid);
      if (!alive) return;
      oncomplete?.(result);
    } catch (e) { if (alive) error = googleAuthError(e); }
  }
</script>

<div class="google-auth" class:wide>
  {#if !linkOnly || !account.google}
    <button type="button" class="google-signin" onclick={() => linkOnly ? showDialog('link') : run()} disabled={disabled || $googleAuthBusy}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.717v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.616Z"/><path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.957-2.18l-2.91-2.257c-.805.54-1.835.86-3.047.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.964 10.713A5.4 5.4 0 0 1 3.682 9c0-.594.102-1.172.282-1.713V4.955H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.045l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.507.455 3.44 1.346l2.58-2.58C13.464.892 11.426 0 9 0A9 9 0 0 0 .957 4.955l3.007 2.332C4.672 5.16 6.656 3.58 9 3.58Z"/></svg>
      {$googleAuthBusy ? 'Google 登入處理中…' : linkOnly ? '綁定 Google' : '使用 Google 登入'}
    </button>
  {:else}
    <!-- >>> v6652-google-management -->
    <div class="google-linked">
      <span class="google-message" role="status">Google 已綁定</span>
      {#if account.differentGoogleEmail}<span class="google-email">Google：{account.googleEmail}</span>{/if}
      <button type="button" class="google-unlink" onclick={() => showDialog('unlink')} disabled={disabled || $googleAuthBusy || !account.canUnlinkGoogle}>解除綁定</button>
    </div>
    {#if !account.canUnlinkGoogle}<p class="google-message">Google 是目前唯一的登入方式，無法解除。</p>{/if}
    <!-- <<< v6652-google-management -->
  {/if}
  {#if error}<p class="google-message" role="alert">{error}</p>{/if}
  {#if notice}<p class="google-message" role="status">{notice}</p>{/if}
</div>

<!-- >>> v6652-google-management -->
{#if dialog}
  <dialog class="google-dialog" aria-label={dialog === 'link' ? '確認綁定 Google' : '解除 Google 綁定'} use:mountDialog use:pageScrollLock oncancel={cancelDialog}>
    <div class="google-dialog-panel">
    {#if dialog === 'link'}
      <h3>確認綁定 Google</h3>
      <p>目前網站帳號：<strong>{account.email}</strong></p>
      <p>接下來選擇的 Google 帳號會成為這個玩家帳號的另一種登入方式；可以選擇不同信箱，不會建立另一份牌組或戰績。</p>
      <p>若要使用另一個獨立玩家帳號，請取消並先登出。</p>
      <div class="google-dialog-actions"><button type="button" onclick={closeDialog}>取消</button><button type="button" class="confirm" onclick={confirmLink} disabled={disabled || $googleAuthBusy}>確認，前往選擇 Google 帳號</button></div>
    {:else}
      <form onsubmit={unlinkGoogle}>
        <h3>解除 Google 綁定</h3>
        <p>原帳號：<strong>{account.passwordEmail}</strong></p>
        {#if account.differentGoogleEmail}<p>將解除的 Google：<strong>{account.googleEmail}</strong></p>{/if}
        <p>牌組、戰績與玩家資料會保留。解除後請用原帳號的 Email 與密碼登入。</p>
        <p>解除後直接使用 Google 登入，可能會進入另一個玩家帳號；若要恢復綁定，請先用原帳號登入。</p>
        <label>原帳號密碼<input type="password" autocomplete="current-password" bind:value={password} required disabled={disabled || $googleAuthBusy} /></label>
        {#if dialogError}<p class="google-message" role="alert">{dialogError}</p>{/if}
        <div class="google-dialog-actions"><button type="button" onclick={closeDialog} disabled={$googleAuthBusy}>取消</button><button type="submit" class="confirm" disabled={disabled || $googleAuthBusy || !password}>{$googleAuthBusy ? '驗證處理中…' : '驗證密碼並解除綁定'}</button></div>
      </form>
    {/if}
    </div>
  </dialog>
{/if}
<!-- <<< v6652-google-management -->

<style>
  .google-auth { min-width: 0; max-width: 100%; }
  .google-auth.wide { width: 100%; max-width: 360px; margin: 0 auto; }
  .wide .google-signin { width: 100%; }
  .google-signin { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 40px; max-width: 100%; padding: 8px 12px; box-sizing: border-box; border: 1px solid #747775; border-radius: 8px; background: #fff; color: #1f1f1f; font: inherit; font-size: .85rem; cursor: pointer; }
  .google-signin svg { flex-shrink: 0; }
  .google-signin:disabled { opacity: .6; cursor: default; }
  .google-signin:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
  .google-message { margin: 6px 0 0; max-width: 28rem; font-size: .8rem; color: var(--ui-text); overflow-wrap: anywhere; }
  /* >>> v6652-google-management */
  .google-linked { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px 10px; min-width: 0; max-width: 100%; }
  .google-linked .google-message { margin: 0; }
  .google-email { font-size: .8rem; color: var(--ui-text); overflow-wrap: anywhere; min-width: 0; }
  .google-unlink { min-height: 40px; padding: 6px 10px; border: 1px solid var(--ui-border); border-radius: 8px; color: var(--ui-text); background: var(--ui-bg-elev); font: inherit; font-size: .8rem; cursor: pointer; }
  .google-unlink:disabled { opacity: .55; cursor: default; }
  .google-dialog { box-sizing: border-box; position: fixed; inset: 0; margin: auto; width: min(440px, calc(100% - 24px - var(--safe-left, 0px) - var(--safe-right, 0px))); max-height: calc(100dvh - 32px - var(--safe-top, 0px) - var(--safe-bottom, 0px)); overflow: hidden; border: 1px solid var(--ui-border); border-radius: 12px; padding: 0; background: var(--ui-bg-elev, #fff); color: var(--ui-text, #222); font-size: .9rem; line-height: 1.6; overflow-wrap: anywhere; }
  .google-dialog-panel { box-sizing: border-box; max-height: calc(100dvh - 36px - var(--safe-top, 0px) - var(--safe-bottom, 0px)); overflow: auto; overscroll-behavior: contain; padding: 20px; }
  .google-dialog::backdrop { background: #000a; }
  .google-dialog h3 { margin: 0 0 12px; }
  .google-dialog p { margin: 10px 0; }
  .google-dialog label { display: block; }
  .google-dialog input { display: block; width: 100%; box-sizing: border-box; margin: 6px 0; padding: 10px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-bg); color: var(--ui-text); font-size: 16px; }
  .google-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .google-dialog-actions button { flex: 1 1 120px; min-height: 44px; padding: 8px; border: 1px solid var(--ui-border); border-radius: 8px; font: inherit; color: var(--ui-text); background: var(--ui-bg); cursor: pointer; }
  .google-dialog-actions .confirm { background: var(--ui-accent, #276749); color: var(--ui-accent-contrast, #fff); }
  .google-dialog-actions button:disabled { opacity: .55; cursor: default; }
  /* <<< v6652-google-management */
</style>
