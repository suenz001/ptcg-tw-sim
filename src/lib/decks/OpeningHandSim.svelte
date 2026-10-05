<script lang="ts">
  // ⭐v6.485 牌組編輯器「🎲 測抽」視窗（站長同意的建議 #3）。邏輯全在 $lib/decks/opening-hand.ts（純函式）。
  // ・獨立元件、自己的樣式：牌組編輯器的桌機 CSS 有逐字指紋守衛（test-v6213），放在這裡不影響它。
  // ・點背景關閉用透明按鈕（與「牌組戰績」視窗同一個做法：不會多出 a11y 警告）；手機開著時背景不捲（pageScrollLock）。
  import type { Card } from '$lib/cards/types';
  import { pageScrollLock } from '$lib/page-scroll-lock';
  import { retryImg } from '$lib/img-retry';
  import { cardThumb } from '$lib/cards/thumb';
  import { expandDeck, dealOpening, drawOne, classifyOpening, basicInOpeningProb, isBasicOf, type SimState } from '$lib/decks/opening-hand';

  // ⚠ props 不給預設值（Svelte 執行期會為預設值多拆一個 chunk）
  let { entries, onclose } = $props<{ entries: { card: Card; count: number }[]; onclose: () => void }>();

  const deck = $derived(expandDeck(entries));
  const basicCount = $derived(deck.filter((d) => isBasicOf(d.card)).length);
  const prob = $derived(basicInOpeningProb(deck.length, basicCount));
  let st = $state<SimState>({ hand: [], prizes: [], deck: [] });
  let showPrizes = $state(false);
  let rounds = $state(0);   // 這次開視窗後重抽了幾次（顯示用）

  function deal() { st = dealOpening(deck); showPrizes = false; rounds += 1; }
  function draw() { st = drawOne(st); }
  deal();

  const kind = $derived(classifyOpening(st.hand.slice(0, 7)));
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
</script>

<div use:pageScrollLock class="ohs-overlay">
  <button class="ohs-backdrop" data-scroll-outside onclick={onclose} aria-label="關閉測抽視窗"></button>
  <div class="ohs-inner" role="dialog" aria-modal="true" aria-label="測抽">
    <button class="ohs-close" onclick={onclose} aria-label="關閉">×</button>
    <h3 class="ohs-title">🎲 測抽</h3>
    <p class="ohs-meta">
      牌組 {deck.length} 張・基礎寶可夢 {basicCount} 張・起手有基礎寶可夢的機率 <strong>{pct(prob)}</strong>
      {#if rounds > 1}<span class="ohs-round">（第 {rounds} 次）</span>{/if}
    </p>
    {#if kind === 'none'}
      <p class="ohs-warn">⚠ 起手沒有基礎寶可夢：實戰要把手牌洗回去重抽（對手可以多抽 1 張）。</p>
    {:else if kind === 'burst-only'}
      <p class="ohs-note">起手沒有基礎寶可夢，但有可以用【瞬間爆發力】放到戰鬥場的寶可夢。</p>
    {/if}

    <h4 class="ohs-h">手牌（{st.hand.length} 張）</h4>
    <div class="ohs-grid">
      {#each st.hand as h, i (h.key)}
        <figure class="ohs-card" class:basic={isBasicOf(h.card)} class:drawn={i >= 7} title={h.card.name}>
          <img use:retryImg={h.card.imageUrl} src={cardThumb(h.card.imageUrl)} alt={h.card.name} loading="lazy" />
          <figcaption>{h.card.name}</figcaption>
        </figure>
      {/each}
    </div>

    <h4 class="ohs-h">
      獎賞卡（{st.prizes.length} 張）
      <button class="ohs-link" onclick={() => (showPrizes = !showPrizes)}>{showPrizes ? '蓋回去' : '翻開看看'}</button>
    </h4>
    <div class="ohs-grid">
      {#each st.prizes as p (p.key)}
        <figure class="ohs-card" title={showPrizes ? p.card.name : '獎賞卡'}>
          {#if showPrizes}
            <img use:retryImg={p.card.imageUrl} src={cardThumb(p.card.imageUrl)} alt={p.card.name} loading="lazy" />
            <figcaption>{p.card.name}</figcaption>
          {:else}
            <div class="ohs-back" aria-label="蓋著的獎賞卡"></div>
          {/if}
        </figure>
      {/each}
    </div>

    <div class="ohs-actions">
      <button class="ohs-btn primary" onclick={deal}>🔄 重新洗牌再抽</button>
      <button class="ohs-btn" onclick={draw} disabled={st.deck.length === 0}>➕ 再抽 1 張（牌庫剩 {st.deck.length}）</button>
      <button class="ohs-btn" onclick={onclose}>關閉</button>
    </div>
  </div>
</div>

<style>
  .ohs-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: flex-start; justify-content: center; padding: calc(var(--safe-top, 0px) + 1.5rem) 0.75rem 1.5rem; overflow-y: auto; }
  .ohs-backdrop { position: fixed; inset: 0; border: 0; padding: 0; margin: 0; background: rgba(0, 0, 0, 0.72); cursor: pointer; }
  .ohs-inner {
    position: relative; overscroll-behavior: contain; width: 100%; max-width: 860px; box-sizing: border-box;
    background: var(--ui-bg-elev, #fff); color: var(--ui-text, #222); border: 1px solid var(--ui-border, #ddd);
    border-radius: 12px; padding: 1.1rem 1.2rem 1.2rem; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
    font-family: system-ui, -apple-system, 'Microsoft JhengHei', 'Noto Sans TC', sans-serif;
  }
  .ohs-close { position: absolute; top: 0.8rem; right: 0.8rem; width: 2.4rem; height: 2.4rem; border-radius: 50%; border: 1px solid var(--ui-border, #ddd); background: var(--ui-bg-sunken, #f4f4f4); color: inherit; font-size: 1.3rem; line-height: 1; cursor: pointer; }
  .ohs-title { margin: 0 0 0.4rem; font-size: 1.15rem; }
  .ohs-meta { margin: 0 3rem 0.6rem 0; font-size: 0.9rem; color: var(--ui-text-muted, #555); line-height: 1.5; }
  .ohs-meta strong { color: var(--ui-text, #222); }
  .ohs-round { margin-left: 0.3rem; }
  .ohs-warn { margin: 0 0 0.6rem; padding: 0.5rem 0.75rem; border-radius: 8px; background: rgba(220, 60, 40, 0.12); color: #b42318; font-weight: 700; font-size: 0.92rem; }
  .ohs-note { margin: 0 0 0.6rem; padding: 0.5rem 0.75rem; border-radius: 8px; background: rgba(61, 187, 122, 0.14); font-size: 0.9rem; }
  .ohs-h { display: flex; align-items: center; gap: 0.6rem; margin: 0.6rem 0 0.4rem; font-size: 0.95rem; }
  .ohs-link { border: 0; background: none; padding: 0; color: var(--ui-link, #2563eb); font: inherit; font-size: 0.85rem; cursor: pointer; text-decoration: underline; }
  .ohs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .ohs-card { margin: 0; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .ohs-card img, .ohs-back { width: 100%; aspect-ratio: 63 / 88; border-radius: 6px; object-fit: cover; background: var(--ui-bg-sunken, #eee); display: block; }
  .ohs-back { background: repeating-linear-gradient(45deg, #1d4ed8, #1d4ed8 6px, #2563eb 6px, #2563eb 12px); border: 2px solid #1e3a8a; box-sizing: border-box; }
  .ohs-card.basic img { outline: 3px solid #3dbb7a; outline-offset: -1px; }
  .ohs-card.drawn img { outline: 3px dashed #f59e0b; outline-offset: -1px; }
  .ohs-card figcaption { font-size: 0.72rem; line-height: 1.25; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ohs-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
  .ohs-btn { padding: 0.55rem 1rem; border-radius: 8px; border: 1px solid var(--ui-border, #ccc); background: var(--ui-bg-sunken, #f4f4f4); color: inherit; font: inherit; font-size: 0.92rem; cursor: pointer; }
  .ohs-btn.primary { background: #3dbb7a; border-color: #3dbb7a; color: #fff; font-weight: 700; }
  .ohs-btn:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 600px) {
    .ohs-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .ohs-btn { flex: 1 1 100%; font-size: 16px; }
  }
</style>
