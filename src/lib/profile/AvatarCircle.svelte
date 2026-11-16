<!--
  v6.653 官方卡片圓圈頭像（任何尺寸等比顯示同一顆圓圈裁切）。
  未設定頭像或圖片尚在載入/失敗時，平滑退回暱稱首字彩徽。
-->
<script lang="ts">
  import { cardThumb } from '$lib/cards/thumb';
  import { retryImg } from '$lib/img-retry';
  import { cardImageUrlFromId, clampAvatarCrop, PROF_CARD_HW, type AvatarCrop } from './profile-api';

  let {
    avatar = null,
    name = '玩家',
    size = 28,
    ring = false,
  }: {
    avatar?: AvatarCrop | null;
    name?: string;
    size?: number;
    ring?: boolean;
  } = $props();

  const crop = $derived(clampAvatarCrop(avatar));
  const rawUrl = $derived(crop ? cardImageUrlFromId(crop.cardId) : null);
  const thumbUrl = $derived(rawUrl ? cardThumb(rawUrl) : null);
  const initial = $derived((String(name || '玩').trim()[0] || '玩').toUpperCase());

  let prevUrl = '';
  $effect(() => {
    const u = rawUrl || '';
    if (u !== prevUrl) prevUrl = u;
  });
</script>

<span
  class="prof-avatar-circle"
  class:has-ring={ring}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:--av-fsize={`${Math.max(11, Math.round(size * 0.44))}px`}
>
  {#if crop && rawUrl && thumbUrl}
    <img
      class="prof-avatar-img"
      use:retryImg={rawUrl}
      src={thumbUrl}
      alt={name}
      loading="lazy"
      decoding="async"
      style:width={`${crop.zoom * 100}%`}
      style:height={`${crop.zoom * PROF_CARD_HW * 100}%`}
      style:transform={`translate(${-crop.x * 100}%, ${-crop.y * 100}%)`}
    />
  {:else}
    <span class="prof-avatar-fallback" aria-hidden="true">{initial}</span>
  {/if}
</span>

<style>
  .prof-avatar-circle {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: linear-gradient(135deg, #274837, #162b21);
    color: #e6f5ea;
    vertical-align: middle;
    user-select: none;
  }
  .prof-avatar-circle.has-ring {
    box-shadow: 0 0 0 2px #0f2419, 0 0 0 3px rgba(106, 184, 122, 0.55);
  }
  .prof-avatar-img {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: none;
    max-height: none;
    display: block;
    pointer-events: none;
    object-fit: cover;
  }
  .prof-avatar-fallback {
    font-weight: 700;
    font-size: var(--av-fsize, 13px);
    line-height: 1;
  }
</style>
