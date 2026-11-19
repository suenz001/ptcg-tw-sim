<!--
  v6.653 官方卡片圓圈頭像（任何尺寸等比顯示同一顆圓圈裁切）。
  v6.663 支援 20 款立體 SVG 裝飾外框（純粹顯示外框，不顯示外框名稱與角落小圖示）。
  未設定頭像或圖片尚在載入/失敗時，平滑退回暱稱首字彩徽。
-->
<script module lang="ts">
  let _avFrameUidSeq = 0;
</script>

<script lang="ts">
  import { cardThumb } from '$lib/cards/thumb';
  import { retryImg } from '$lib/img-retry';
  import {
    AVATAR_FRAME_MASK_R,
    cardImageUrlFromId,
    clampAvatarCrop,
    getAvatarFrameArt,
    getAvatarFrameSpec,
    profileNameInitial,
    resolveFramePaint,
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

  const svgPrefix = `avf${++_avFrameUidSeq}_`;
  const crop = $derived(clampAvatarCrop(avatar));
  const rawFrame = $derived(frame ?? (avatar as { frame?: string | null } | null)?.frame);
  const frameSpec = $derived(getAvatarFrameSpec(rawFrame));
  const frameArt = $derived(frameSpec ? getAvatarFrameArt(frameSpec.id) : null);
  const rawUrl = $derived(crop ? cardImageUrlFromId(crop.cardId) : null);
  const thumbUrl = $derived(rawUrl ? cardThumb(rawUrl) : null);
  const initial = $derived(profileNameInitial(name));
</script>

<span
  class="prof-av-wrap"
  class:has-frame={!!frameArt}
  style:width={`${size}px`}
  style:height={`${size}px`}
>
  <span
    class="prof-avatar-circle"
    class:has-ring={ring && !frameArt}
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
  {#if frameArt}
    <svg class="prof-av-frame-svg" viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <defs>
        {#each frameArt.grads as g (g.id)}
          {#if g.kind === 'lin'}
            <linearGradient id={`${svgPrefix}${g.id}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} gradientUnits="userSpaceOnUse">
              {#each g.stops as st}
                <stop offset={st[0]} stop-color={st[1]} />
              {/each}
            </linearGradient>
          {:else}
            <radialGradient id={`${svgPrefix}${g.id}`} cx={g.cx} cy={g.cy} r={g.r}>
              {#each g.stops as st}
                <stop offset={st[0]} stop-color={st[1]} />
              {/each}
            </radialGradient>
          {/if}
        {/each}
        <mask id={`${svgPrefix}hole`} maskUnits="userSpaceOnUse" x="-20" y="-20" width="180" height="180">
          <rect x="-20" y="-20" width="180" height="180" fill="#ffffff" />
          <circle cx="70" cy="70" r={AVATAR_FRAME_MASK_R} fill="#000000" />
        </mask>
      </defs>
      <g mask={`url(#${svgPrefix}hole)`}>
        <g style:filter={`drop-shadow(0 0 3px ${frameSpec?.glow ?? 'transparent'})`}>
      {#each frameArt.shapes as s}
        {#if s.t === 'circle'}
          <circle
            cx={s.cx}
            cy={s.cy}
            r={s.r}
            fill={resolveFramePaint(s.fill, svgPrefix)}
            fill-opacity={s.fo}
            stroke={resolveFramePaint(s.stroke, svgPrefix)}
            stroke-width={s.sw}
            stroke-opacity={s.so}
            stroke-dasharray={s.sd}
            transform={s.tf}
          />
        {:else if s.t === 'path'}
          <path
            d={s.d}
            fill={resolveFramePaint(s.fill, svgPrefix)}
            fill-opacity={s.fo}
            stroke={resolveFramePaint(s.stroke, svgPrefix)}
            stroke-width={s.sw}
            stroke-opacity={s.so}
            stroke-linejoin={s.slj}
            stroke-linecap={s.slc}
            stroke-dasharray={s.sd}
            transform={s.tf}
          />
        {:else if s.t === 'polygon'}
          <polygon
            points={s.points}
            fill={resolveFramePaint(s.fill, svgPrefix)}
            fill-opacity={s.fo}
            stroke={resolveFramePaint(s.stroke, svgPrefix)}
            stroke-width={s.sw}
            stroke-opacity={s.so}
            stroke-linejoin={s.slj}
            transform={s.tf}
          />
        {:else if s.t === 'rect'}
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx={s.rx}
            fill={resolveFramePaint(s.fill, svgPrefix)}
            fill-opacity={s.fo}
            stroke={resolveFramePaint(s.stroke, svgPrefix)}
            stroke-width={s.sw}
            stroke-opacity={s.so}
            transform={s.tf}
          />
        {:else if s.t === 'ellipse'}
          <ellipse
            cx={s.cx}
            cy={s.cy}
            rx={s.rx}
            ry={s.ry}
            fill={resolveFramePaint(s.fill, svgPrefix)}
            fill-opacity={s.fo}
            stroke={resolveFramePaint(s.stroke, svgPrefix)}
            stroke-width={s.sw}
            stroke-opacity={s.so}
            transform={s.tf}
          />
        {:else if s.t === 'line'}
          <line
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={resolveFramePaint(s.stroke, svgPrefix)}
            stroke-width={s.sw}
            stroke-opacity={s.so}
            stroke-linecap={s.slc}
            transform={s.tf}
          />
        {/if}
      {/each}
        </g>
      </g>
    </svg>
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
    overflow: visible;
  }
  .prof-av-wrap.has-frame {
    z-index: 1;
  }
  .prof-av-frame-svg {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 152.2%;
    height: 152.2%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
    overflow: visible;
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
