<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { User } from 'firebase/auth';
  import { continueGoogle, googleAuthBusy, googleAuthRevision, authUiState } from './google-auth';
  import { googleAuthError } from './google-flow';
  let { user = null, linkOnly = false, disabled = false, wide = false, oncomplete = undefined }: {
    user?: User | null;
    linkOnly?: boolean;
    disabled?: boolean;
    wide?: boolean;
    oncomplete?: (user: User) => void;
  } = $props();
  let error = $state('');
  let alive = true;
  onDestroy(() => { alive = false; });
  const account = $derived(authUiState(user, $googleAuthRevision));
  async function run() {
    if (disabled || $googleAuthBusy) return;
    error = '';
    try {
      const result = await continueGoogle(linkOnly);
      if (!alive) return;
      oncomplete?.(result);
    } catch (e) { if (alive) error = googleAuthError(e); }
  }
</script>

{#if !linkOnly || !account.google}
  <div class="google-auth" class:wide>
    <button type="button" class="google-signin" onclick={run} disabled={disabled || $googleAuthBusy}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.717v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.616Z"/><path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.957-2.18l-2.91-2.257c-.805.54-1.835.86-3.047.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.964 10.713A5.4 5.4 0 0 1 3.682 9c0-.594.102-1.172.282-1.713V4.955H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.045l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.507.455 3.44 1.346l2.58-2.58C13.464.892 11.426 0 9 0A9 9 0 0 0 .957 4.955l3.007 2.332C4.672 5.16 6.656 3.58 9 3.58Z"/></svg>
      {$googleAuthBusy ? 'Google 登入處理中…' : linkOnly ? '綁定 Google' : '使用 Google 登入'}
    </button>
    {#if error}<p class="google-message" role="alert">{error}</p>{/if}
  </div>
{:else}
  <span class="google-message" role="status">Google 已綁定</span>
{/if}

<style>
  .google-auth { min-width: 0; max-width: 100%; }
  .google-auth.wide { width: 100%; max-width: 360px; margin: 0 auto; }
  .wide .google-signin { width: 100%; }
  .google-signin { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 40px; max-width: 100%; padding: 8px 12px; box-sizing: border-box; border: 1px solid #747775; border-radius: 8px; background: #fff; color: #1f1f1f; font: inherit; font-size: .85rem; cursor: pointer; }
  .google-signin svg { flex-shrink: 0; }
  .google-signin:disabled { opacity: .6; cursor: default; }
  .google-signin:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
  .google-message { margin: 6px 0 0; max-width: 28rem; font-size: .8rem; color: var(--ui-text); overflow-wrap: anywhere; }
</style>
