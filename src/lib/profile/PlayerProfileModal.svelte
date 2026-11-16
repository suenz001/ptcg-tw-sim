<!--
  v6.653 玩家個人名片彈窗（緊湊名片版型，避開 iPhone 動態島安全區與底部橫條）。
  ・不顯示隱私廢話、不顯示頭像卡片出處。
  ・頂部橫幅內只有右對齊單行冠數與 44×44 關閉鈕；暱稱、認證徽章與加好友按鈕位於橫幅下方，絕不重疊。
  ・代表榮譽標題列與每一筆榮譽皆維持單行（最多 10 筆，超過以刪節號截斷）。
-->
<script lang="ts">
  import { pageScrollLock } from '$lib/page-scroll-lock';
  import AvatarCircle from './AvatarCircle.svelte';
  import {
    fetchPlayerProfileView,
    sendFriendRequestFromProfile,
    formatHonorDate,
    type PlayerProfilePublic,
    type ProfileAuthCtx,
    type ProfileLookupTarget,
  } from './profile-api';

  let {
    open = false,
    target = null,
    previewCard = null,
    getAuthCtx,
    onclose,
  }: {
    open?: boolean;
    target?: ProfileLookupTarget | null;
    previewCard?: PlayerProfilePublic | null;
    getAuthCtx: () => Promise<ProfileAuthCtx | null>;
    onclose: () => void;
  } = $props();

  let loading = $state(false);
  let errMsg = $state('');
  let card = $state<PlayerProfilePublic | null>(null);
  let frBusy = $state(false);
  let frMsg = $state('');
  let loadSeq = 0;

  $effect(() => {
    if (!open) {
      loadSeq++;
      card = null;
      errMsg = '';
      frMsg = '';
      frBusy = false;
      loading = false;
      return;
    }
    if (previewCard) {
      loadSeq++;
      card = previewCard;
      errMsg = '';
      frMsg = '';
      frBusy = false;
      loading = false;
      return;
    }
    if (!target) {
      loadSeq++;
      card = null;
      errMsg = '';
      frMsg = '';
      frBusy = false;
      loading = false;
      return;
    }
    const seq = ++loadSeq;
    const t = target;
    loading = true;
    errMsg = '';
    frMsg = '';
    frBusy = false;
    card = null;
    void (async () => {
      const ctx = await getAuthCtx().catch(() => null);
      const res = await fetchPlayerProfileView(t, ctx);
      if (seq !== loadSeq) return;
      loading = false;
      if (res.ok) {
        card = res.data;
      } else {
        errMsg = res.message || '載入玩家名片失敗';
      }
    })();
  });

  async function handleAddFriend() {
    if (previewCard || !target || !card || frBusy) return;
    const seq = loadSeq;
    const curTarget = target;
    frBusy = true;
    frMsg = '';
    try {
      const ctx = await getAuthCtx();
      if (!open || previewCard || seq !== loadSeq || target !== curTarget || !card) return;
      if (!ctx || !ctx.token) {
        frMsg = '請先登入非匿名帳號再加好友';
        return;
      }
      const res = await sendFriendRequestFromProfile(ctx, curTarget, 'profile');
      if (!open || previewCard || seq !== loadSeq || target !== curTarget || !card) return;
      if (!res.ok) {
        frMsg = res.message || '送出好友申請失敗';
        return;
      }
      if (res.data.status === 'accepted') {
        card = { ...card, friendStatus: 'accepted', canFriend: false };
        frMsg = '對方先前已邀請你，你們已成為好友！';
      } else {
        card = { ...card, friendStatus: 'pending_out', canFriend: false };
        frMsg = res.data.already ? '先前已送出好友邀請' : '已送出好友申請！';
      }
    } finally {
      if (seq === loadSeq && target === curTarget) {
        frBusy = false;
      }
    }
  }

  function onBackdropKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    use:pageScrollLock
    class="ppm-backdrop"
    role="presentation"
    onclick={onclose}
    onkeydown={onBackdropKey}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="ppm-card"
      role="dialog"
      aria-modal="true"
      aria-label="玩家名片"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="ppm-banner">
        <div class="ppm-banner-badges">
          {#if card && card.champOfficial > 0}
            <span class="ppm-crown site">🏛️ 網站賽 {card.champOfficial} 冠</span>
          {/if}
          {#if card && card.champCommunity > 0}
            <span class="ppm-crown comm">🎖️ 社群賽 {card.champCommunity} 冠</span>
          {/if}
        </div>
        <button type="button" class="ppm-close" aria-label="關閉名片" onclick={onclose}>✕</button>
      </div>

      {#if loading}
        <div class="ppm-state">載入玩家名片中…</div>
      {:else if errMsg}
        <div class="ppm-state ppm-err">{errMsg}</div>
      {:else if card}
        <div class="ppm-body">
          <div class="ppm-head-row">
            <div class="ppm-av-wrap">
              <AvatarCircle avatar={card.avatar} name={card.nick} size={72} ring />
            </div>
            <div class="ppm-identity">
              <div class="ppm-nick">{card.nick}</div>
              <div class="ppm-sub-row">
                {#if card.googleVerified}
                  <span class="ppm-g-badge">✓ Google 已認證</span>
                {/if}
                {#if card.friendStatus === 'accepted'}
                  <span class="ppm-fr-pill is-friend">👥 已是好友</span>
                {:else if card.friendStatus === 'pending_out'}
                  <span class="ppm-fr-pill is-pending">✓ 已送出申請</span>
                {:else if card.friendStatus === 'blocked_by_me'}
                  <span class="ppm-fr-pill is-muted">🚫 已封鎖</span>
                {:else if card.canFriend && (card.friendStatus === 'none' || card.friendStatus === 'pending_in')}
                  <button
                    type="button"
                    class="ppm-fr-btn"
                    disabled={frBusy}
                    onclick={handleAddFriend}
                  >
                    {frBusy ? '處理中…' : (card.friendStatus === 'pending_in' ? '+ 確認加好友' : '+ 加好友')}
                  </button>
                {/if}
              </div>
            </div>
          </div>

          {#if frMsg}
            <div class="ppm-fr-msg" role="status">{frMsg}</div>
          {/if}

          {#if card.bio}
            <p class="ppm-bio">{card.bio}</p>
          {:else if !card.found}
            <p class="ppm-bio muted">這位玩家尚未設定個人名片或尚未綁定帳號紀錄。</p>
          {/if}

          {#if card.pinnedHonors && card.pinnedHonors.length > 0}
            <div class="ppm-honors">
              <div class="ppm-honors-head">
                <span class="ppm-honors-title">🏅 代表榮譽</span>
                <span class="ppm-honors-count">{card.pinnedHonors.length} / 10</span>
              </div>
              <ul class="ppm-honor-list">
                {#each card.pinnedHonors as h (h.eventId)}
                  <li class="ppm-honor-row">
                    <span class="ppm-h-tag" class:comm={h.kind === 'comm'}>
                      {h.kind === 'comm' ? '🎖️ 社群賽' : '🏛️ 網站賽'}
                    </span>
                    {#if h.date}<span class="ppm-h-date">{formatHonorDate(h.date)}</span>{/if}
                    <span class="ppm-h-name" title={`${h.eventName} ${h.placementLabel}`}>
                      {h.eventName}・<b>{h.placementLabel}</b>
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ppm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9500;
    background: rgba(5, 10, 7, 0.72);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    padding: calc(16px + var(--safe-top, 0px)) calc(12px + var(--safe-right, 0px)) calc(16px + var(--safe-bottom, 0px)) calc(12px + var(--safe-left, 0px));
    box-sizing: border-box;
  }
  .ppm-card {
    margin: auto;
    width: 100%;
    max-width: 390px;
    max-height: calc(100dvh - 32px - var(--safe-top, 0px) - var(--safe-bottom, 0px));
    overflow-y: auto;
    overscroll-behavior: contain;
    box-sizing: border-box;
    border-radius: 16px;
    border: 1px solid #3c6548;
    background: #132219;
    color: #eef7f0;
    box-shadow: 0 20px 44px rgba(0, 0, 0, 0.52);
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-card {
    background: var(--ui-bg-elev, #f2f5f3);
    color: var(--ui-text, #1c2420);
    border-color: var(--ui-border, #b7c3bb);
  }
  .ppm-banner {
    position: relative;
    height: 48px;
    background: linear-gradient(135deg, #214530, #163022 65%, #1d3c2b);
    border-bottom: 1px solid rgba(120, 196, 138, 0.22);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 6px 0 92px;
    gap: 6px;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-banner {
    background: linear-gradient(135deg, #cce3d4, #dfeee4);
    border-bottom-color: #b7cec0;
  }
  .ppm-banner-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    flex-wrap: nowrap;
  }
  .ppm-crown {
    white-space: nowrap;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(11, 20, 15, 0.65);
    border: 1px solid rgba(255, 211, 90, 0.42);
    color: #ffe28a;
  }
  .ppm-crown.comm {
    border-color: rgba(143, 220, 192, 0.45);
    color: #9ae8cb;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-crown {
    background: rgba(255, 255, 255, 0.85);
    color: #7d5300;
    border-color: #d6b665;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-crown.comm {
    color: #165e46;
    border-color: #8bc7ae;
  }
  .ppm-close {
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 1.05rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .ppm-close:hover { background: rgba(255, 255, 255, 0.12); }
  .ppm-state {
    padding: 26px 16px;
    text-align: center;
    font-size: 0.92rem;
    color: #a8c7b2;
  }
  .ppm-err { color: #ff9c9c; }
  .ppm-body {
    padding: 0 16px 16px;
  }
  .ppm-head-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .ppm-av-wrap {
    margin-top: -28px;
    flex-shrink: 0;
    position: relative;
    z-index: 2;
  }
  .ppm-identity {
    flex: 1;
    min-width: 0;
    padding-top: 8px;
  }
  .ppm-nick {
    font-size: 1.08rem;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .ppm-sub-row {
    margin-top: 5px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ppm-g-badge {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(66, 133, 244, 0.18);
    border: 1px solid rgba(114, 171, 255, 0.45);
    color: #b7d7ff;
    white-space: nowrap;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-g-badge {
    background: #e7f0fd;
    border-color: #aac6f7;
    color: #1953ad;
  }
  .ppm-fr-btn {
    padding: 4px 11px;
    min-height: 30px;
    border-radius: 999px;
    border: 1px solid #6ab87a;
    background: linear-gradient(180deg, #2b623f, #1d472c);
    color: #ecffef;
    font: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .ppm-fr-btn:disabled { opacity: 0.55; cursor: default; }
  .ppm-fr-pill {
    font-size: 0.74rem;
    font-weight: 600;
    padding: 2px 9px;
    border-radius: 999px;
    white-space: nowrap;
    border: 1px solid rgba(120, 196, 138, 0.35);
    background: rgba(45, 92, 62, 0.35);
    color: #b8ecc4;
  }
  .ppm-fr-pill.is-pending { border-color: rgba(255, 211, 90, 0.45); color: #ffe28a; }
  .ppm-fr-pill.is-muted { border-color: rgba(255, 130, 130, 0.4); color: #ffb3b3; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-fr-pill {
    background: #e5f3ea;
    color: #185b37;
    border-color: #9ec8ae;
  }
  .ppm-fr-msg {
    margin-top: 8px;
    font-size: 0.78rem;
    color: #a9e9b8;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-fr-msg { color: #196b3d; }
  .ppm-bio {
    margin: 12px 0 0;
    padding: 9px 11px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(120, 196, 138, 0.14);
    font-size: 0.86rem;
    line-height: 1.5;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .ppm-bio.muted { color: #96b09f; font-size: 0.8rem; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-bio {
    background: var(--ui-bg-sunken, #dfe5e1);
    border-color: var(--ui-border, #c0cac3);
  }
  .ppm-honors {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(120, 196, 138, 0.18);
  }
  .ppm-honors-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    white-space: nowrap;
  }
  .ppm-honors-title { font-size: 0.84rem; font-weight: 700; }
  .ppm-honors-count { font-size: 0.76rem; color: #9ec0aa; font-weight: 600; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-honors-count { color: #516658; }
  .ppm-honor-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .ppm-honor-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    line-height: 1.3;
    min-width: 0;
    white-space: nowrap;
  }
  .ppm-h-tag {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 0.69rem;
    font-weight: 700;
    background: rgba(255, 211, 90, 0.15);
    border: 1px solid rgba(255, 211, 90, 0.4);
    color: #ffe28a;
  }
  .ppm-h-tag.comm {
    background: rgba(143, 220, 192, 0.14);
    border-color: rgba(143, 220, 192, 0.4);
    color: #9be7cb;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-h-tag {
    background: #fdf3d7;
    color: #7a5200;
    border-color: #dbc06f;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppm-h-tag.comm {
    background: #dff3eb;
    color: #155c43;
    border-color: #84c5ad;
  }
  .ppm-h-date {
    flex-shrink: 0;
    font-size: 0.72rem;
    opacity: 0.78;
    font-variant-numeric: tabular-nums;
  }
  .ppm-h-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
