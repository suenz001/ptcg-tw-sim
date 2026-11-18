<!--
  v6.653 官方卡片圓圈頭像（任何尺寸等比顯示同一顆圓圈裁切）。
  未設定頭像或圖片尚在載入/失敗時，平滑退回暱稱首字彩徽。
-->
<script lang="ts">
  import { cardThumb } from '$lib/cards/thumb';
  import { retryImg } from '$lib/img-retry';
  import {
    cardImageUrlFromId,
    clampAvatarCrop,
    getAvatarFrameSpec,
    profileNameInitial,
    PROF_CARD_HW,
    type AvatarCrop,
  } from './profile-api';

  let {
    avatar = null,
    frame = null,
    name = '玩家',
    size = 28,
    ring = false,
  }: {
    avatar?: AvatarCrop | null;
    frame?: string | null;
    name?: string;
    size?: number;
    ring?: boolean;
  } = $props();

  const crop = $derived(clampAvatarCrop(avatar));
  const frameSpec = $derived(getAvatarFrameSpec(frame ?? (avatar as { frame?: string | null } | null)?.frame));
  const rawUrl = $derived(crop ? cardImageUrlFromId(crop.cardId) : null);
  const thumbUrl = $derived(rawUrl ? cardThumb(rawUrl) : null);
  const initial = $derived(profileNameInitial(name));
  const ringPad = $derived(frameSpec ? Math.max(2, Math.round(size * 0.06)) : 0);

  let prevUrl = '';
  $effect(() => {
    const u = rawUrl || '';
    if (u !== prevUrl) prevUrl = u;
  });
</script>

<span
  class="prof-av-wrap"
  class:has-frame={!!frameSpec}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:--pf-c1={frameSpec?.stops[0] ?? 'transparent'}
  style:--pf-c2={frameSpec?.stops[1] ?? 'transparent'}
  style:--pf-c3={frameSpec?.stops[2] ?? 'transparent'}
  style:--pf-c4={frameSpec?.stops[3] ?? 'transparent'}
  style:--pf-glow={frameSpec?.glow ?? 'transparent'}
  style:--pf-inner={frameSpec?.innerBorder ?? 'transparent'}
  style:--pf-pad={`${ringPad}px`}
>
  <span
    class="prof-avatar-circle"
    class:has-ring={ring && !frameSpec}
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
  {#if frameSpec && size >= 40}
    <span class="prof-av-frame-badge" title={frameSpec.name} aria-label={frameSpec.name}>{frameSpec.badge}</span>
  {/if}
</span>

<style>
  .prof-av-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    vertical-align: middle;
    border-radius: 50%;
    box-sizing: content-box;
  }
  .prof-av-wrap.has-frame {
    padding: var(--pf-pad, 3px);
    background: conic-gradient(from 135deg, var(--pf-c1), var(--pf-c2), var(--pf-c3), var(--pf-c4), var(--pf-c1));
    box-shadow: 0 0 0 1px var(--pf-inner), 0 0 10px var(--pf-glow);
  }
  .prof-av-wrap.has-frame .prof-avatar-circle {
    box-shadow: 0 0 0 1.5px var(--pf-inner);
  }
  .prof-av-frame-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #101e16;
    border: 1.5px solid var(--pf-c2);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    line-height: 1;
    pointer-events: none;
    z-index: 3;
  }
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
