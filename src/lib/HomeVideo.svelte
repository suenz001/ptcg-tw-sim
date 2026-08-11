<script lang="ts">
  /**
   * v6.166 首頁「最新影片」— lazy facade（點擊前絕不建立 iframe）。
   *
   * ⭐核心保證：**玩家沒按下播放鍵以前，DOM 裡不存在任何 iframe**。
   *   直接嵌 YouTube iframe 會在首頁載入時就拉進 www.youtube.com 的播放器（約 1MB 以上的 JS
   *   ＋ 十幾個第三方請求＋ cookie），這一區在版面下方、多數玩家根本不會看，
   *   那些流量等於白付。改成先畫一張縮圖當「假的播放器」，按下去才把 iframe 換上來。
   *
   * ⭐未按播放前這一區的實際成本只有一張縮圖（hqdefault.jpg，實測 17,020 bytes），
   *   且掛 loading="lazy" ⇒ 玩家沒捲到這裡連縮圖都不會下載。
   *
   * ⭐容器固定 16:9（aspect-ratio），縮圖與 iframe 都絕對定位填滿 ⇒
   *   縮圖載入前後高度完全不變，不會有版面跳動（CLS）。
   *   hqdefault 本身是 4:3（480x360、上下有黑邊），用 object-fit: cover 裁掉。
   *
   * ⭐隱私：iframe 走 youtube-nocookie.com。
   */
  interface Props {
    /** 影片 ID；空字串 = 沒有影片（整區不顯示）。 */
    videoId?: string;
    /** 影片標題（顯示在縮圖下方、也給 iframe 的 title）。 */
    title?: string;
    /**
     * ⚠**僅供守衛做行為層渲染驗證**（可以直接 render 出「已按下播放」的 DOM 來檢查 iframe）。
     * 正式使用永遠不傳；首頁若傳了這個 prop，等於一進站就載入播放器，守衛會擋下。
     */
    initiallyPlaying?: boolean;
  }
  let { videoId = '', title = '', initiallyPlaying = false }: Props = $props();

  /** false = 只有縮圖 facade；true = 已按下播放，才建立 iframe。 */
  // ⚠這裡**刻意只取 initiallyPlaying 的初值**（它是常數 prop，不會變），
  //   不加這行 svelte-ignore 會在每次 build 洗出 state_referenced_locally 警告。
  // svelte-ignore state_referenced_locally
  let playing = $state(initiallyPlaying);
  /** 按下播放後把鍵盤焦點交給播放器（原本的 button 已從 DOM 移除，焦點會掉回 body）。 */
  let frameEl = $state<HTMLIFrameElement | null>(null);
  $effect(() => { if (playing && frameEl) frameEl.focus(); });
  /** hqdefault 偶爾不存在（極少數影片）→ 退回一定存在的 mqdefault。 */
  let thumbFallback = $state(false);

  // ⚠URL 一律在 script 內用樣板字串組好再綁到屬性：
  //   直接寫在 template 的屬性裡會出現裸 & （autoplay=1&rel=0），是 vite build 的地雷。
  const embedSrc = $derived(
    `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
  );
  const thumbSrc = $derived(
    `https://i.ytimg.com/vi/${videoId}/${thumbFallback ? 'mqdefault' : 'hqdefault'}.jpg`
  );
  const watchUrl = $derived(`https://www.youtube.com/watch?v=${videoId}`);
  const playLabel = $derived(title ? `播放影片：${title}` : '播放影片');
</script>

{#if videoId}
  <section class="hv-section">
    <h2>🎬 最新影片</h2>
    <div class="hv-stage">
      {#if playing}
        <iframe
          bind:this={frameEl}
          class="hv-embed"
          src={embedSrc}
          title={title || 'PTCG 實體賽事演練 介紹影片'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      {:else}
        <button class="hv-facade" type="button" aria-label={playLabel} onclick={() => (playing = true)}>
          <img
            class="hv-thumb"
            src={thumbSrc}
            alt=""
            width="480"
            height="360"
            loading="lazy"
            decoding="async"
            onerror={() => (thumbFallback = true)}
          />
          <span class="hv-play" aria-hidden="true"></span>
        </button>
      {/if}
    </div>
    {#if title}
      <p class="hv-title">{title}</p>
    {/if}
    <p class="hv-hint">
      按下播放鍵才會載入 YouTube 播放器・
      <a href={watchUrl} target="_blank" rel="noopener noreferrer">在 YouTube 開啟</a>
    </p>
  </section>
{/if}

<style>
  .hv-section {
    background: linear-gradient(135deg, #fdf3f3 0%, #f8e9e9 100%);
    border: 1px solid #eccccc;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-top: 1.5rem;
  }
  .hv-section h2 {
    margin-top: 0;
  }
  /* ⚠固定 16:9 的舞台：縮圖／iframe 都絕對填滿它 ⇒ 載入前後高度不變，沒有版面跳動。
     ⚠這個容器**刻意不設 flex**（v6.030 首頁爆版的根因就是把裝內容的容器設成 flex）。 */
  .hv-stage {
    position: relative;
    width: 100%;
    max-width: 640px;
    aspect-ratio: 16 / 9;
    margin: 0 auto;
    border-radius: 8px;
    overflow: hidden;
    background: #1a1a1a;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .hv-embed,
  .hv-facade {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .hv-facade {
    padding: 0;
    background: #1a1a1a;
    cursor: pointer;
    display: block;
  }
  .hv-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover; /* hqdefault 是 4:3，裁成 16:9 去掉上下黑邊 */
    display: block;
  }
  /* 播放鍵（純 CSS 三角形，不再多抓一張圖） */
  .hv-play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 68px;
    height: 48px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.62);
    transition: background 0.15s;
  }
  .hv-play::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 52%;
    transform: translate(-50%, -50%);
    border-style: solid;
    border-width: 11px 0 11px 19px;
    border-color: transparent transparent transparent #fff;
  }
  .hv-facade:hover .hv-play,
  .hv-facade:focus-visible .hv-play {
    background: #e62117;
  }
  .hv-title {
    margin: 0.7rem 0 0 0;
    text-align: center;
    font-size: 0.92rem;
    font-weight: 600;
    color: #5a2c2c;
  }
  .hv-hint {
    margin: 0.35rem 0 0 0;
    text-align: center;
    font-size: 0.78rem;
    color: #7a5a5a;
  }
  .hv-hint a {
    color: #a33;
  }
  /* 手機直式：整區靠寬度自適應（aspect-ratio 會跟著縮），只收一點左右內距。 */
  @media (max-width: 480px) {
    .hv-section {
      padding: 1rem 0.9rem;
    }
    .hv-play {
      width: 56px;
      height: 40px;
    }
    .hv-play::after {
      border-width: 9px 0 9px 16px;
    }
  }
</style>
