<script lang="ts">
  import { base } from '$app/paths';
  import type { Card, SetSummary } from '$lib/cards/types';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';

  /** Resolve a coverImageUrl that is either an absolute https:// URL (external
   *  archive art) or a relative path like "covers/SV5a.jpg" (self-hosted). */
  function coverUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${base}/${url}`;
  }

  type LoadData =
    | { mode: 'index'; sets: SetSummary[] }
    | { mode: 'set'; setCode: string; cards: Card[] };

  let { data }: { data: LoadData } = $props();

  // ─── Set-index mode state ────────────────────────────────────────────
  // (declared at top level so Svelte 5 $state works; only used when data.mode === 'index')

  // ─── Single-set browser state ────────────────────────────────────────
  let query = $state('');
  let supertypeFilter = $state<'All' | 'Pokemon' | 'Trainer' | 'Energy'>('All');
  let selected = $state<Card | null>(null);

  const setCards = $derived(data.mode === 'set' ? data.cards : []);
  const filtered = $derived.by(() => {
    if (data.mode !== 'set') return [];
    const q = query.trim().toLowerCase();
    return setCards.filter((c) => {
      if (supertypeFilter !== 'All' && c.supertype !== supertypeFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.collectorNumber.includes(q) ||
        (c.attacks ?? []).some((a) => a.name.toLowerCase().includes(q)) ||
        (c.abilities ?? []).some((a) => a.name.toLowerCase().includes(q))
      );
    });
  });

  function closeModal() {
    selected = null;
  }
</script>

<svelte:head>
  <title>
    {data.mode === 'set' ? `${data.setCode} 卡牌瀏覽` : '卡牌資料庫'} · PTCG 對戰模擬器
  </title>
</svelte:head>

{#if data.mode === 'index'}
  <!-- ═══════════════════════ Set picker ═══════════════════════ -->
  {@const markGroups = (() => {
    const groups = new Map();
    for (const set of data.sets) {
      const m = set.regulationMark ?? '?';
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(set);
    }
    // Ensure H → I → J order
    const ordered = [];
    for (const mark of ['H', 'I', 'J']) {
      if (groups.has(mark)) ordered.push([mark, groups.get(mark)]);
    }
    // Anything else
    for (const [mark, sets] of groups) {
      if (!['H', 'I', 'J'].includes(mark)) ordered.push([mark, sets]);
    }
    return ordered;
  })()}

  <header>
    <a class="back" href="{base}/">← 首頁</a>
    <h1>卡牌資料庫</h1>
    <p class="meta">
      {data.sets.length} 個卡包 · 共 {data.sets.reduce((n, s) => n + s.cardCount, 0)} 張卡
      <span class="hint">（標準賽 H / I / J 標）</span>
    </p>
  </header>

  {#each markGroups as [mark, sets] (mark)}
    <div class="markSection">
      <h2 class="markHeader">
        <span class="markBadge mark-{mark}">{mark}</span>
        <span>{mark} 標 · {sets.length} 個卡包</span>
      </h2>
      <div class="setGrid">
        {#each sets as set (set.code)}
          <a class="setTile" href="{base}/cards?set={set.code}">
            <img src={coverUrl(set.coverImageUrl)} alt="" loading="lazy" />
            <div class="setInfo">
              <span class="markDot mark-{mark}">{mark}</span>
              <div class="setCode">{set.code}</div>
              <div class="setName">{set.name}</div>
              <div class="setCount">{set.cardCount} 張</div>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/each}
{:else}
  <!-- ═══════════════════════ Card grid ═══════════════════════ -->
  <header>
    <a class="back" href="{base}/cards">← 卡包列表</a>
    <h1>{data.setCode}</h1>
    <p class="meta">共 {setCards.length} 張卡 · 顯示 {filtered.length} 張</p>
  </header>

  <div class="controls">
    <input type="search" bind:value={query} placeholder="搜尋卡名、招式、特性、卡號..." aria-label="搜尋" />
    <div class="filters" role="tablist">
      {#each ['All', 'Pokemon', 'Trainer', 'Energy'] as st (st)}
        <button
          class="filter"
          class:active={supertypeFilter === st}
          onclick={() => (supertypeFilter = st as typeof supertypeFilter)}
        >
          {st === 'All' ? '全部' : st === 'Pokemon' ? '寶可夢' : st === 'Trainer' ? '訓練家' : '能量'}
        </button>
      {/each}
    </div>
  </div>

  <div class="grid">
    {#each filtered as card (card.id)}
      <button class="cardBtn" onclick={() => (selected = card)} aria-label={card.name}>
        <img src={card.imageUrl} alt={card.name} loading="lazy" />
        <span class="cardLabel">
          <span class="num">{card.collectorNumber}</span>
          <span class="name">{card.name}</span>
        </span>
      </button>
    {/each}
  </div>

  {#if selected}
    <div class="modal" role="dialog" aria-modal="true" onclick={closeModal}>
      <div class="modalInner" onclick={(e) => e.stopPropagation()} role="document">
        <button class="close" onclick={closeModal} aria-label="關閉">×</button>
        <div class="detailGrid">
          <img class="detailImg" src={selected.imageUrl} alt={selected.name} />
          <div class="detailInfo">
            <h2>{selected.name}</h2>
            <p class="tag">
              {selected.supertype} / {selected.subtype}
              {#if selected.hp}· HP {selected.hp}{/if}
              {#if selected.pokemonType}
                · <span class="energy" style:background={ENERGY_COLOR[selected.pokemonType]}>
                  {ENERGY_LABEL[selected.pokemonType]}
                </span>
              {/if}
            </p>
            {#if selected.evolvesFrom}
              <p class="evo">從「{selected.evolvesFrom}」進化</p>
            {/if}

            {#if selected.abilities?.length}
              <section>
                <h3>特性</h3>
                {#each selected.abilities as ab}
                  <div class="skill">
                    <div class="skillHead">
                      <span class="abilityLabel">[{ab.label}]</span>
                      <span class="skillName">{ab.name}</span>
                    </div>
                    <p class="skillEffect">{ab.effect}</p>
                  </div>
                {/each}
              </section>
            {/if}

            {#if selected.attacks?.length}
              <section>
                <h3>招式</h3>
                {#each selected.attacks as atk}
                  <div class="skill">
                    <div class="skillHead">
                      <span class="cost">
                        {#each atk.cost as e}<span
                            class="energyDot"
                            style:background={ENERGY_COLOR[e]}
                            title={ENERGY_LABEL[e]}>{ENERGY_LABEL[e]}</span>{/each}
                      </span>
                      <span class="skillName">{atk.name}</span>
                      {#if atk.damage}<span class="damage">{atk.damage}</span>{/if}
                    </div>
                    {#if atk.effect}<p class="skillEffect">{atk.effect}</p>{/if}
                  </div>
                {/each}
              </section>
            {/if}

            {#if selected.rulesText}
              <section>
                <h3>效果</h3>
                <p class="rules">{selected.rulesText}</p>
              </section>
            {/if}

            {#if selected.weakness || selected.resistance || selected.retreatCost}
              <section class="stats">
                {#if selected.weakness}
                  <div>
                    <strong>弱點</strong>
                    <span class="energy" style:background={ENERGY_COLOR[selected.weakness.type]}>
                      {ENERGY_LABEL[selected.weakness.type]}
                    </span>
                    {selected.weakness.value}
                  </div>
                {/if}
                {#if selected.resistance}
                  <div>
                    <strong>抵抗力</strong>
                    <span class="energy" style:background={ENERGY_COLOR[selected.resistance.type]}>
                      {ENERGY_LABEL[selected.resistance.type]}
                    </span>
                    {selected.resistance.value}
                  </div>
                {/if}
                {#if selected.retreatCost}
                  <div>
                    <strong>撤退</strong>
                    {#each selected.retreatCost as e}<span
                        class="energyDot small"
                        style:background={ENERGY_COLOR[e]}>{ENERGY_LABEL[e]}</span>{/each}
                  </div>
                {/if}
              </section>
            {/if}

            <p class="foot">
              {selected.setCode} · {selected.collectorNumber}
              {#if selected.regulationMark}· {selected.regulationMark}{/if}
              {#if selected.illustrator}· 繪師 {selected.illustrator}{/if}
            </p>
          </div>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  :global(body) {
    background: #f4f4f6;
  }
  header {
    max-width: 1200px;
    margin: 1rem auto 0.5rem;
    padding: 0 1rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .back {
    color: #666;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .back:hover {
    color: #000;
  }
  h1 {
    margin: 0.5rem 0 0.25rem;
  }
  .meta {
    margin: 0;
    color: #777;
    font-size: 0.9rem;
  }

  /* ── Set-index grid ── */
  .setGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .setTile {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.08s, box-shadow 0.08s;
  }
  .setTile:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
  .setTile img {
    width: 70px;
    aspect-ratio: 0.71;
    object-fit: cover;
    background: #eee;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .setCode {
    font-size: 0.75rem;
    color: #888;
    font-variant-numeric: tabular-nums;
  }
  .setName {
    font-weight: 600;
    margin: 0.1rem 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .setCount {
    font-size: 0.8rem;
    color: #666;
  }

  /* ── Regulation mark sections ── */
  .markSection {
    max-width: 1200px;
    margin: 0 auto 2rem;
    padding: 0 1rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .markHeader {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #555;
    font-weight: 500;
  }
  .markBadge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6em;
    height: 1.6em;
    border-radius: 4px;
    color: #fff;
    font-weight: 700;
    font-size: 1rem;
  }
  .markDot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3em;
    height: 1.3em;
    border-radius: 3px;
    color: #fff;
    font-weight: 700;
    font-size: 0.65rem;
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
  }
  .setInfo {
    position: relative;
  }
  .mark-H { background: #3b82f6; }
  .mark-I { background: #8b5cf6; }
  .mark-J { background: #f59e0b; }

  /* ── Single-set browser ── */
  .controls {
    max-width: 1200px;
    margin: 1rem auto;
    padding: 0 1rem;
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: center;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  input[type='search'] {
    flex: 1;
    min-width: 240px;
    padding: 0.55rem 0.8rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .filters {
    display: flex;
    gap: 0.3rem;
  }
  .filter {
    padding: 0.5rem 0.9rem;
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .filter.active {
    background: #1a1a1a;
    color: #fff;
    border-color: #1a1a1a;
  }

  .grid {
    max-width: 1200px;
    margin: 0 auto 3rem;
    padding: 0 1rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
  }
  .cardBtn {
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow: hidden;
    padding: 0;
    cursor: pointer;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
    transition: transform 0.08s, box-shadow 0.08s;
  }
  .cardBtn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
  .cardBtn img {
    width: 100%;
    aspect-ratio: 0.71;
    object-fit: cover;
    background: #eee;
  }
  .cardLabel {
    display: flex;
    flex-direction: column;
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
    text-align: left;
  }
  .cardLabel .num {
    color: #888;
    font-variant-numeric: tabular-nums;
  }
  .cardLabel .name {
    font-weight: 500;
    color: #1a1a1a;
  }

  /* Modal */
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 100;
  }
  .modalInner {
    background: #fff;
    border-radius: 12px;
    max-width: 900px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    padding: 1.5rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .close {
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    background: transparent;
    border: none;
    font-size: 1.8rem;
    cursor: pointer;
    color: #666;
    line-height: 1;
  }
  .close:hover {
    color: #000;
  }
  .detailGrid {
    display: grid;
    grid-template-columns: minmax(200px, 260px) 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 640px) {
    .detailGrid {
      grid-template-columns: 1fr;
    }
  }
  .detailImg {
    width: 100%;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .detailInfo h2 {
    margin: 0 0 0.25rem;
  }
  .tag {
    color: #666;
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
  .evo {
    color: #666;
    font-size: 0.9rem;
    margin: 0.25rem 0 0.75rem;
  }
  .detailInfo h3 {
    font-size: 0.95rem;
    margin: 1rem 0 0.4rem;
    color: #333;
  }
  .skill {
    margin-bottom: 0.6rem;
    padding: 0.5rem 0.75rem;
    background: #fafafa;
    border-left: 3px solid #ddd;
    border-radius: 4px;
  }
  .skillHead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .skillName {
    font-weight: 600;
  }
  .abilityLabel {
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    background: #e04a2f;
    color: #fff;
    border-radius: 3px;
  }
  .damage {
    margin-left: auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .skillEffect,
  .rules {
    margin: 0.4rem 0 0;
    font-size: 0.9rem;
    color: #333;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .cost {
    display: inline-flex;
    gap: 0.15rem;
  }
  .energyDot,
  .energy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4em;
    height: 1.4em;
    border-radius: 50%;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
  }
  .energyDot.small {
    width: 1.1em;
    height: 1.1em;
    font-size: 0.7rem;
  }
  .stats {
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #eee;
    font-size: 0.9rem;
  }
  .stats div {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .stats strong {
    color: #555;
    font-weight: 500;
  }
  .foot {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid #eee;
    font-size: 0.8rem;
    color: #888;
  }
</style>
