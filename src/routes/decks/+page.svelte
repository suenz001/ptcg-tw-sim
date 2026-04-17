<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import type { Card } from '$lib/cards/types';
  import { loadAllSets, loadIndex, buildCardIndex } from '$lib/cards/pool';
  import {
    loadDecks,
    upsertDeck,
    deleteDeck,
    newDeck
  } from '$lib/decks/storage';
  import type { Deck } from '$lib/decks/types';
  import { validateDeck, maxCopies, isBasicEnergy } from '$lib/decks/validation';

  // ── Data state ─────────────────────────────────────────────────────────
  let decks = $state<Deck[]>([]);
  let activeId = $state<string | null>(null);
  let pool = $state<Card[]>([]);
  let poolById = $state<Map<string, Card>>(new Map());
  let poolReady = $state(false);
  let poolError = $state<string | null>(null);
  let sets = $state<{ code: string; name: string; regulationMark?: string | null }[]>([]);

  // ── UI state ───────────────────────────────────────────────────────────
  let search = $state('');
  let supertypeFilter = $state<'All' | 'Pokemon' | 'Trainer' | 'Energy'>('All');
  let setFilter = $state<string>('');
  let markFilter = $state<'All' | 'H' | 'I' | 'J'>('All');

  // ── Derived ────────────────────────────────────────────────────────────
  const active = $derived(decks.find((d) => d.id === activeId) ?? null);

  const validation = $derived(
    active ? validateDeck(active, poolById) : null
  );

  const filteredPool = $derived.by(() => {
    if (!poolReady) return [] as Card[];
    const q = search.trim().toLowerCase();
    return pool.filter((c) => {
      if (supertypeFilter !== 'All' && c.supertype !== supertypeFilter) return false;
      if (setFilter && c.setCode !== setFilter) return false;
      if (markFilter !== 'All' && c.regulationMark !== markFilter) return false;
      if (q) {
        const hay = `${c.name} ${c.setCode} ${c.collectorNumber}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  onMount(async () => {
    decks = loadDecks();
    if (decks.length === 0) {
      const first = newDeck('我的第一個牌組');
      decks = upsertDeck(first);
      activeId = first.id;
    } else {
      activeId = decks[0].id;
    }
    try {
      const [allCards, setIndex] = await Promise.all([loadAllSets(), loadIndex()]);
      pool = allCards;
      poolById = buildCardIndex(allCards);
      sets = setIndex.map((s) => ({
        code: s.code,
        name: s.name,
        regulationMark: s.regulationMark
      }));
      poolReady = true;
    } catch (e) {
      poolError = e instanceof Error ? e.message : String(e);
    }
  });

  // ── Deck actions ───────────────────────────────────────────────────────
  function createDeck() {
    const d = newDeck(`牌組 ${decks.length + 1}`);
    decks = upsertDeck(d);
    activeId = d.id;
  }

  function removeDeck(id: string) {
    if (!confirm('確定要刪除這個牌組嗎？')) return;
    decks = deleteDeck(id);
    if (activeId === id) activeId = decks[0]?.id ?? null;
  }

  function renameActive(name: string) {
    if (!active) return;
    const updated = { ...active, name };
    decks = upsertDeck(updated);
  }

  function addCard(card: Card) {
    if (!active) return;
    const entries = [...active.entries];
    const i = entries.findIndex((e) => e.cardId === card.id);
    const currentCount = i >= 0 ? entries[i].count : 0;
    const max = maxCopies(card);
    if (currentCount >= max) return;
    if (i >= 0) entries[i] = { ...entries[i], count: currentCount + 1 };
    else entries.push({ cardId: card.id, count: 1 });
    decks = upsertDeck({ ...active, entries });
  }

  function removeCard(cardId: string) {
    if (!active) return;
    const entries = active.entries
      .map((e) => (e.cardId === cardId ? { ...e, count: e.count - 1 } : e))
      .filter((e) => e.count > 0);
    decks = upsertDeck({ ...active, entries });
  }

  function clearDeck() {
    if (!active) return;
    if (!confirm('清空此牌組？')) return;
    decks = upsertDeck({ ...active, entries: [] });
  }

  // ── Import / export ────────────────────────────────────────────────────
  function exportJson() {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.name || 'deck'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.name !== 'string') {
        alert('檔案格式不正確');
        return;
      }
      const incoming: Deck = {
        ...newDeck(parsed.name),
        entries: parsed.entries,
        notes: parsed.notes
      };
      decks = upsertDeck(incoming);
      activeId = incoming.id;
    } catch (e) {
      alert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function onFileChosen(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) importJson(f);
    input.value = '';
  }

  // Sum of the active deck, used for the running count in the header.
  const totalCount = $derived(
    active ? active.entries.reduce((n, e) => n + e.count, 0) : 0
  );

  // Entries paired with their Card for display. Filter out unresolved ids.
  const activeEntries = $derived.by(() => {
    if (!active) return [] as { entry: typeof active.entries[number]; card: Card }[];
    const result: { entry: typeof active.entries[number]; card: Card }[] = [];
    for (const entry of active.entries) {
      const card = poolById.get(entry.cardId);
      if (card) result.push({ entry, card });
    }
    // Group: Pokémon → Trainer → Energy, then by name.
    const rank = (c: Card) =>
      c.supertype === 'Pokemon' ? 0 : c.supertype === 'Trainer' ? 1 : 2;
    result.sort((a, b) => {
      const r = rank(a.card) - rank(b.card);
      if (r !== 0) return r;
      return a.card.name.localeCompare(b.card.name, 'zh-Hant');
    });
    return result;
  });
</script>

<main>
  <header class="page-head">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>牌組編輯器</h1>
    <span class="hint">Standard · H / I / J 標</span>
  </header>

  {#if poolError}
    <p class="error">載入卡池失敗：{poolError}</p>
  {/if}

  <div class="layout">
    <!-- ── Deck list (left rail) ────────────────────────────────────── -->
    <aside class="rail">
      <div class="rail-head">
        <strong>我的牌組</strong>
        <button class="small" onclick={createDeck}>+ 新增</button>
      </div>
      <ul class="deck-list">
        {#each decks as d (d.id)}
          <li class:active={d.id === activeId}>
            <button class="deck-pick" onclick={() => (activeId = d.id)}>
              <span class="deck-name">{d.name || '(未命名)'}</span>
              <span class="deck-size">
                {d.entries.reduce((n, e) => n + e.count, 0)} / 60
              </span>
            </button>
            <button
              class="icon"
              onclick={() => removeDeck(d.id)}
              title="刪除"
              aria-label="刪除牌組"
            >×</button>
          </li>
        {/each}
      </ul>
    </aside>

    <!-- ── Deck detail ──────────────────────────────────────────────── -->
    <section class="deck-pane">
      {#if !active}
        <p>請從左側選擇或新增牌組。</p>
      {:else}
        <div class="deck-header">
          <input
            class="deck-title"
            value={active.name}
            placeholder="牌組名稱"
            oninput={(e) => renameActive((e.target as HTMLInputElement).value)}
          />
          <div class="deck-actions">
            <span class="count" class:bad={totalCount !== 60}>{totalCount} / 60</span>
            <button class="small" onclick={exportJson}>匯出 JSON</button>
            <label class="small file">
              匯入 JSON
              <input type="file" accept="application/json" onchange={onFileChosen} />
            </label>
            <button class="small danger" onclick={clearDeck}>清空</button>
          </div>
        </div>

        {#if validation}
          <div class="validation" class:ok={validation.legal}>
            {#if validation.legal}
              <span>✓ 合法牌組</span>
            {:else}
              <ul>
                {#each validation.issues as issue}
                  <li>{issue}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        {#if active.entries.length === 0}
          <p class="empty">尚未加入任何卡片。請從右側搜尋並點擊「+」加入。</p>
        {:else}
          <ul class="deck-entries">
            {#each activeEntries as { entry, card } (card.id)}
              <li class="entry" data-st={card.supertype}>
                <img src={card.imageUrl} alt={card.name} loading="lazy" />
                <div class="entry-meta">
                  <div class="entry-name">{card.name}</div>
                  <div class="entry-sub">
                    {card.setCode} · {card.collectorNumber}
                    {#if card.regulationMark}· {card.regulationMark}{/if}
                  </div>
                </div>
                <div class="counter">
                  <button class="icon" onclick={() => removeCard(card.id)}>−</button>
                  <span>{entry.count}</span>
                  <button
                    class="icon"
                    onclick={() => addCard(card)}
                    disabled={!isBasicEnergy(card) && entry.count >= 4}
                  >+</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    <!-- ── Card picker ──────────────────────────────────────────────── -->
    <section class="picker">
      <div class="filters">
        <input
          class="search"
          placeholder="搜尋卡片名稱 / 卡號…"
          bind:value={search}
        />
        <div class="filter-row">
          <select bind:value={supertypeFilter}>
            <option value="All">全部類型</option>
            <option value="Pokemon">寶可夢</option>
            <option value="Trainer">訓練家</option>
            <option value="Energy">能量</option>
          </select>
          <select bind:value={markFilter}>
            <option value="All">H · I · J</option>
            <option value="H">H 標</option>
            <option value="I">I 標</option>
            <option value="J">J 標</option>
          </select>
          <select bind:value={setFilter}>
            <option value="">全部卡包</option>
            {#each sets as s}
              <option value={s.code}>
                {s.regulationMark ?? '?'} · {s.code} {s.name}
              </option>
            {/each}
          </select>
        </div>
      </div>

      {#if !poolReady}
        <p class="muted">正在載入卡池…</p>
      {:else}
        <p class="muted">符合 {filteredPool.length} 張</p>
        <ul class="picker-list">
          {#each filteredPool.slice(0, 120) as card (card.id)}
            <li>
              <img src={card.imageUrl} alt={card.name} loading="lazy" />
              <div class="pick-meta">
                <div class="pick-name">{card.name}</div>
                <div class="pick-sub">
                  {card.setCode} · {card.collectorNumber}
                  {#if card.regulationMark}
                    <span class="mark mark-{card.regulationMark}">{card.regulationMark}</span>
                  {/if}
                </div>
              </div>
              <button class="icon" onclick={() => addCard(card)}>+</button>
            </li>
          {/each}
        </ul>
        {#if filteredPool.length > 120}
          <p class="muted tight">僅顯示前 120 張，請縮小搜尋條件。</p>
        {/if}
      {/if}
    </section>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f4f4f6;
  }
  main {
    max-width: 1200px;
    margin: 1.5rem auto;
    padding: 0 1rem 3rem;
    font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    color: #1a1a1a;
  }
  .page-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .page-head h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .back {
    color: #0066cc;
    text-decoration: none;
  }
  .back:hover {
    text-decoration: underline;
  }
  .hint {
    color: #888;
    font-size: 0.85rem;
  }
  .error {
    color: #c00;
    background: #fee;
    padding: 0.75rem 1rem;
    border-radius: 6px;
  }

  .layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) minmax(0, 1fr);
    gap: 1rem;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  /* Left rail */
  .rail {
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 0.75rem;
  }
  .rail-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .deck-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .deck-list li {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 4px;
  }
  .deck-list li.active {
    background: #eef4ff;
  }
  .deck-pick {
    flex: 1;
    text-align: left;
    display: flex;
    justify-content: space-between;
    background: transparent;
    border: none;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .deck-name {
    font-weight: 500;
  }
  .deck-size {
    color: #888;
    font-size: 0.8rem;
  }

  /* Centre: deck detail */
  .deck-pane {
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem;
  }
  .deck-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .deck-title {
    flex: 1;
    font-size: 1.1rem;
    font-weight: 600;
    padding: 0.4rem 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    min-width: 10rem;
  }
  .deck-actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .count.bad {
    color: #c00;
  }
  .validation {
    margin: 0.75rem 0;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    background: #fff4e5;
    color: #8a4a00;
    font-size: 0.9rem;
  }
  .validation.ok {
    background: #e6f6e6;
    color: #105a10;
  }
  .validation ul {
    margin: 0;
    padding-left: 1.1rem;
  }
  .empty {
    color: #888;
    padding: 2rem 0;
    text-align: center;
  }
  .deck-entries {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .entry {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.5rem;
    background: #fafafa;
    border-radius: 4px;
  }
  .entry[data-st='Pokemon'] {
    border-left: 3px solid #2c7a3c;
  }
  .entry[data-st='Trainer'] {
    border-left: 3px solid #8a3a80;
  }
  .entry[data-st='Energy'] {
    border-left: 3px solid #c77a00;
  }
  .entry img {
    width: 40px;
    height: 56px;
    object-fit: cover;
    border-radius: 2px;
  }
  .entry-name {
    font-weight: 500;
  }
  .entry-sub {
    font-size: 0.78rem;
    color: #888;
  }
  .counter {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-variant-numeric: tabular-nums;
  }

  /* Right: picker */
  .picker {
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .search {
    padding: 0.45rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font: inherit;
  }
  .filter-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .filter-row select {
    padding: 0.35rem 0.5rem;
    font: inherit;
  }
  .muted {
    color: #888;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .muted.tight {
    margin-top: 0.25rem;
  }
  .picker-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-height: 640px;
    overflow-y: auto;
  }
  .picker-list li {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.4rem;
    border-radius: 4px;
  }
  .picker-list li:hover {
    background: #f4f8ff;
  }
  .picker-list img {
    width: 40px;
    height: 56px;
    object-fit: cover;
    border-radius: 2px;
  }
  .pick-name {
    font-weight: 500;
  }
  .pick-sub {
    font-size: 0.78rem;
    color: #888;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 700;
    color: #fff;
  }
  .mark-H { background: #3b82f6; }
  .mark-I { background: #8b5cf6; }
  .mark-J { background: #f59e0b; }

  /* Buttons */
  button {
    font: inherit;
    cursor: pointer;
  }
  button.small {
    padding: 0.35rem 0.65rem;
    border-radius: 4px;
    border: 1px solid #cfcfcf;
    background: #fff;
  }
  button.small:hover {
    background: #f4f4f4;
  }
  button.small.danger {
    color: #c00;
    border-color: #f0c0c0;
  }
  label.file {
    display: inline-flex;
    align-items: center;
    border: 1px solid #cfcfcf;
    border-radius: 4px;
    padding: 0.35rem 0.65rem;
    background: #fff;
    cursor: pointer;
  }
  label.file input {
    display: none;
  }
  button.icon {
    width: 1.6rem;
    height: 1.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    line-height: 1;
    font-size: 1rem;
  }
  button.icon:hover:not(:disabled) {
    background: #f0f0f0;
  }
  button.icon:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
