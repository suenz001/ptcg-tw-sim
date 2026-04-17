<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import type { Card } from '$lib/cards/types';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import { loadAllSets, loadIndex, buildCardIndex } from '$lib/cards/pool';
  import {
    loadDecks,
    upsertDeck,
    deleteDeck,
    newDeck
  } from '$lib/decks/storage';
  import type { Deck } from '$lib/decks/types';
  import { validateDeck, maxCopies, isBasicEnergy } from '$lib/decks/validation';
  import { syncDeckToCloud, removeDeckFromCloud, loadDecksFromCloud } from '$lib/decks/cloud';
  import { auth } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';

  // ── Data state ─────────────────────────────────────────────────────────
  let decks = $state<Deck[]>([]);
  let activeId = $state<string | null>(null);
  let pool = $state<Card[]>([]);
  let poolById = $state<Map<string, Card>>(new Map());
  let poolReady = $state(false);
  let poolError = $state<string | null>(null);
  let sets = $state<{ code: string; name: string; regulationMark?: string | null }[]>([]);

  // ── Firebase / cloud state ─────────────────────────────────────────────
  let firebaseUser = $state<User | null>(null);
  let syncStatus = $state<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  let syncError = $state<string | null>(null);

  // ── UI state ───────────────────────────────────────────────────────────
  let search = $state('');
  let supertypeFilter = $state<'All' | 'Pokemon' | 'Trainer' | 'Energy'>('All');
  let setFilter = $state<string>('');
  let markFilter = $state<'All' | 'H' | 'I' | 'J'>('All');
  let pickerPreview = $state<Card | null>(null);

  // Text format modal
  let showTextModal = $state(false);
  let textModalMode = $state<'export' | 'import'>('export');
  let importTextInput = $state('');

  // ── Derived ────────────────────────────────────────────────────────────
  const active = $derived(decks.find((d) => d.id === activeId) ?? null);

  /** 目前預覽的卡片在作用中牌組裡的張數 */
  const previewCount = $derived(
    pickerPreview && active
      ? (active.entries.find((e) => e.cardId === pickerPreview!.id)?.count ?? 0)
      : 0
  );

  const validation = $derived(
    active ? validateDeck(active, poolById) : null
  );

  /** 二級索引：`${setCode}-${collectorNumber}` → Card（供文字格式匯入用） */
  const poolBySetNum = $derived(
    new Map(pool.map((c) => [`${c.setCode}-${c.collectorNumber}`, c]))
  );

  /** 文字格式匯出內容 */
  const textExportContent = $derived.by(() => {
    if (!active || activeEntries.length === 0) return '';
    const lines = [`// ${active.name}`, ''];
    for (const { entry, card } of activeEntries) {
      lines.push(`${entry.count} ${card.name} ${card.setCode} ${card.collectorNumber}`);
    }
    return lines.join('\n');
  });

  /** 各類型張數統計，用於牌組摘要列 */
  const deckStats = $derived.by(() => {
    if (!active || !poolReady) return { Pokemon: 0, Trainer: 0, Energy: 0 };
    let p = 0, t = 0, e = 0;
    for (const entry of active.entries) {
      const card = poolById.get(entry.cardId);
      if (!card) continue;
      if (card.supertype === 'Pokemon') p += entry.count;
      else if (card.supertype === 'Trainer') t += entry.count;
      else e += entry.count;
    }
    return { Pokemon: p, Trainer: t, Energy: e };
  });

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

  // ── Cloud sync helpers ─────────────────────────────────────────────────
  /** 給 Promise 加上逾時，避免 Firestore 未建立時永遠卡住 */
  function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`雲端操作逾時（${ms / 1000}s）— 請確認 Firebase Firestore 資料庫已建立`)), ms)
      )
    ]);
  }

  async function pushDeck(deck: Deck) {
    if (!firebaseUser) return;
    syncStatus = 'syncing';
    try {
      await withTimeout(syncDeckToCloud(firebaseUser.uid, deck));
      syncStatus = 'synced';
    } catch (e) {
      syncStatus = 'error';
      syncError = e instanceof Error ? e.message : String(e);
    }
  }

  async function dropDeck(deckId: string) {
    if (!firebaseUser) return;
    syncStatus = 'syncing';
    try {
      await withTimeout(removeDeckFromCloud(firebaseUser.uid, deckId));
      syncStatus = 'synced';
    } catch (e) {
      syncStatus = 'error';
      syncError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  onMount(() => {
    // ① Load card pool (independent of auth)
    loadAllSets().then((allCards) => {
      pool = allCards;
      poolById = buildCardIndex(allCards);
      poolReady = true;
    }).catch((e) => { poolError = e instanceof Error ? e.message : String(e); });

    loadIndex().then((setIndex) => {
      sets = setIndex.map((s) => ({
        code: s.code,
        name: s.name,
        regulationMark: s.regulationMark
      }));
    }).catch(() => {/* non-critical */});

    // ② Firebase anonymous auth; on sign-in, merge cloud ↔ local decks
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      firebaseUser = user;
      if (!user) {
        // Not signed in yet — start anonymous sign-in
        try { await signInAnonymously(auth); } catch { /* will retry on next visit */ }
        return;
      }

      // Load local decks first so UI is responsive immediately
      const local = loadDecks();

      // Then fetch cloud decks and merge
      try {
        syncStatus = 'syncing';
        const cloud = await withTimeout(loadDecksFromCloud(user.uid));

        if (cloud.length === 0 && local.length > 0) {
          // First-time cloud: push existing local decks up
          for (const d of local) await syncDeckToCloud(user.uid, d);
          decks = local;
        } else if (cloud.length > 0) {
          // Merge by updatedAt: newer wins
          const merged = new Map<string, Deck>();
          for (const d of [...local, ...cloud]) {
            const existing = merged.get(d.id);
            if (!existing || d.updatedAt > existing.updatedAt) merged.set(d.id, d);
          }
          decks = [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          // Persist merged result locally
          import('$lib/decks/storage').then(({ saveDecks }) => saveDecks(decks));
        } else {
          decks = local;
        }

        syncStatus = 'synced';
      } catch {
        // Cloud unavailable — fall back to local silently
        decks = local;
        syncStatus = 'error';
      }

      if (decks.length === 0) {
        const first = newDeck('我的第一個牌組');
        decks = upsertDeck(first);
        pushDeck(first);
        activeId = first.id;
      } else {
        activeId = decks[0].id;
      }
    });

    return () => unsubAuth();
  });

  // ── Deck actions ───────────────────────────────────────────────────────
  function createDeck() {
    const d = newDeck(`牌組 ${decks.length + 1}`);
    decks = upsertDeck(d);
    activeId = d.id;
    pushDeck(d);
  }

  function removeDeck(id: string) {
    if (!confirm('確定要刪除這個牌組嗎？')) return;
    decks = deleteDeck(id);
    if (activeId === id) activeId = decks[0]?.id ?? null;
    dropDeck(id);
  }

  function renameActive(name: string) {
    if (!active) return;
    const updated = { ...active, name };
    decks = upsertDeck(updated);
    pushDeck(updated);
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
    const updated = { ...active, entries };
    decks = upsertDeck(updated);
    pushDeck(updated);
  }

  function removeCard(cardId: string) {
    if (!active) return;
    const entries = active.entries
      .map((e) => (e.cardId === cardId ? { ...e, count: e.count - 1 } : e))
      .filter((e) => e.count > 0);
    const updated = { ...active, entries };
    decks = upsertDeck(updated);
    pushDeck(updated);
  }

  function clearDeck() {
    if (!active) return;
    if (!confirm('清空此牌組？')) return;
    const updated = { ...active, entries: [] };
    decks = upsertDeck(updated);
    pushDeck(updated);
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
      pushDeck(incoming);
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

  // ── Text format (Phase C) ──────────────────────────────────────────────
  function openTextExport() {
    if (!active) return;
    textModalMode = 'export';
    showTextModal = true;
  }

  function openTextImport() {
    importTextInput = '';
    textModalMode = 'import';
    showTextModal = true;
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(textExportContent);
      alert('已複製到剪貼簿！');
    } catch {
      alert('複製失敗，請手動選取文字複製。');
    }
  }

  function downloadTextFile() {
    const blob = new Blob([textExportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active?.name || 'deck'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importFromText() {
    if (!importTextInput.trim()) return;

    const lines = importTextInput.split('\n');
    const entries: { cardId: string; count: number }[] = [];
    const errors: string[] = [];
    let deckName = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // Comment line: optional deck name
      if (line.startsWith('//') || line.startsWith('#')) {
        if (!deckName) deckName = line.replace(/^\/\/\s*|^#\s*/, '').trim();
        continue;
      }
      // Format: {count} {name} {setCode} {collectorNumber}
      const m = line.match(/^(\d+)\s+(.+?)\s+([A-Za-z0-9]+)\s+(\S+)$/);
      if (!m) { errors.push(`無法解析：${line}`); continue; }

      const [, countStr, , setCode, collectorNumber] = m;
      const count = Math.max(1, parseInt(countStr, 10));
      const card = poolBySetNum.get(`${setCode}-${collectorNumber}`);

      if (!card) {
        errors.push(`找不到：${setCode} ${collectorNumber}`);
        continue;
      }
      const existing = entries.find((e) => e.cardId === card.id);
      if (existing) existing.count += count;
      else entries.push({ cardId: card.id, count });
    }

    if (errors.length > 0) {
      const msg = `以下 ${errors.length} 張卡片找不到，是否繼續匯入其餘卡片？\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n…（共 ${errors.length} 筆）` : ''}`;
      if (!confirm(msg)) return;
    }
    if (entries.length === 0) { alert('沒有找到任何可匯入的卡片'); return; }

    const d = { ...newDeck(deckName || '匯入牌組'), entries };
    decks = upsertDeck(d);
    activeId = d.id;
    pushDeck(d);
    showTextModal = false;
    importTextInput = '';
  }

  // ── Card preview ───────────────────────────────────────────────────────
  function openPreview(card: Card) { pickerPreview = card; }
  function closePreview() { pickerPreview = null; }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closePreview();
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

<svelte:window onkeydown={onKeydown} />

<main>
  <header class="page-head">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>牌組編輯器</h1>
    <span class="hint">Standard · H / I / J 標</span>
    <span class="sync-pill sync-{syncStatus}" title={syncStatus === 'error' ? (syncError ?? '雲端連線失敗') : ''}>
      {#if syncStatus === 'syncing'}⏳ 同步中{:else if syncStatus === 'synced'}☁️ 已同步{:else if syncStatus === 'error'}⚠️ 離線（hover 看原因）{:else}⬜ 本機{/if}
    </span>
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
            <button class="small" onclick={openTextExport} disabled={!active || active.entries.length === 0}>匯出文字</button>
            <button class="small" onclick={openTextImport} disabled={!poolReady}>匯入文字</button>
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

        <!-- Deck stats bar -->
        <div class="stats-bar">
          <span class="stat pokemon">寶可夢 {deckStats.Pokemon}</span>
          <span class="stat trainer">訓練家 {deckStats.Trainer}</span>
          <span class="stat energy">能量 {deckStats.Energy}</span>
          {#if totalCount > 0}
            <div class="stat-track" title="寶可夢 / 訓練家 / 能量">
              {#if deckStats.Pokemon > 0}
                <div class="stat-seg poke" style="width:{(deckStats.Pokemon/60*100).toFixed(1)}%"></div>
              {/if}
              {#if deckStats.Trainer > 0}
                <div class="stat-seg train" style="width:{(deckStats.Trainer/60*100).toFixed(1)}%"></div>
              {/if}
              {#if deckStats.Energy > 0}
                <div class="stat-seg ene" style="width:{(deckStats.Energy/60*100).toFixed(1)}%"></div>
              {/if}
            </div>
          {/if}
        </div>

        {#if active.entries.length === 0}
          <p class="empty">尚未加入任何卡片。請從右側搜尋並點擊「+」加入。</p>
        {:else}
          <ul class="deck-entries">
            {#each activeEntries as { entry, card } (card.id)}
              <li class="entry" data-st={card.supertype}>
                <button class="entry-thumb" onclick={() => openPreview(card)} title="查看詳情">
                  <img src={card.imageUrl} alt={card.name} loading="lazy" />
                </button>
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
            <li class:previewing={pickerPreview?.id === card.id}>
              <button class="pick-thumb" onclick={() => openPreview(card)} title="查看詳情">
                <img src={card.imageUrl} alt={card.name} loading="lazy" />
              </button>
              <button class="pick-meta" onclick={() => openPreview(card)}>
                <div class="pick-name">{card.name}</div>
                <div class="pick-sub">
                  {card.setCode} · {card.collectorNumber}
                  {#if card.regulationMark}
                    <span class="mark mark-{card.regulationMark}">{card.regulationMark}</span>
                  {/if}
                </div>
              </button>
              <button class="icon add-btn" onclick={() => addCard(card)} title="加入牌組">+</button>
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

<!-- ── Card preview modal ──────────────────────────────────────────────── -->
{#if pickerPreview}
  {@const pv = pickerPreview}
  {@const pvCount = previewCount}
  {@const pvMax = maxCopies(pv)}
  <div class="pv-overlay" role="dialog" aria-modal="true" aria-label="卡片詳情"
    onclick={closePreview}>
    <div class="pv-inner" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={closePreview} aria-label="關閉">×</button>

      <!-- Top: image + quick info -->
      <div class="pv-top">
        <img class="pv-img" src={pv.imageUrl} alt={pv.name} />

        <div class="pv-info">
          <h2 class="pv-name">{pv.name}</h2>

          <!-- badges row -->
          <div class="pv-badges">
            {#if pv.pokemonType}
              <span class="type-badge" style="background:{ENERGY_COLOR[pv.pokemonType]}">
                {ENERGY_LABEL[pv.pokemonType]}
              </span>
            {/if}
            <span class="sub-badge">{pv.subtype}</span>
            {#if pv.hp}
              <span class="hp-badge">HP {pv.hp}</span>
            {/if}
            {#if pv.regulationMark}
              <span class="mark mark-{pv.regulationMark}">{pv.regulationMark}</span>
            {/if}
          </div>

          {#if pv.evolvesFrom}
            <p class="pv-evolve">進化自：{pv.evolvesFrom}</p>
          {/if}

          <!-- Abilities -->
          {#if pv.abilities?.length}
            <div class="pv-section">
              {#each pv.abilities as ab}
                <div class="pv-ability">
                  <span class="ab-label">{ab.label}</span>
                  <strong class="ab-name">{ab.name}</strong>
                  <p class="ab-effect">{ab.effect}</p>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Attacks -->
          {#if pv.attacks?.length}
            <div class="pv-section">
              {#each pv.attacks as atk}
                <div class="pv-attack">
                  <div class="atk-head">
                    <span class="atk-cost">
                      {#each atk.cost as e}
                        <span class="energy-pip" style="background:{ENERGY_COLOR[e]}" title={ENERGY_LABEL[e]}>
                          {ENERGY_LABEL[e]}
                        </span>
                      {/each}
                    </span>
                    <strong class="atk-name">{atk.name}</strong>
                    {#if atk.damage}
                      <span class="atk-dmg">{atk.damage}</span>
                    {/if}
                  </div>
                  {#if atk.effect}
                    <p class="atk-effect">{atk.effect}</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <!-- Rules text (Trainer / Energy) -->
          {#if pv.rulesText}
            <div class="pv-section pv-rules">{pv.rulesText}</div>
          {/if}

          <!-- Weakness / Resistance / Retreat -->
          {#if pv.weakness || pv.resistance || pv.retreatCost?.length}
            <div class="pv-wrc">
              {#if pv.weakness}
                <span>弱點：
                  <span class="energy-pip sm" style="background:{ENERGY_COLOR[pv.weakness.type]}">
                    {ENERGY_LABEL[pv.weakness.type]}
                  </span>
                  {pv.weakness.value}
                </span>
              {/if}
              {#if pv.resistance}
                <span>抵抗力：
                  <span class="energy-pip sm" style="background:{ENERGY_COLOR[pv.resistance.type]}">
                    {ENERGY_LABEL[pv.resistance.type]}
                  </span>
                  {pv.resistance.value}
                </span>
              {/if}
              {#if pv.retreatCost?.length}
                <span>撤退：
                  {#each pv.retreatCost as e}
                    <span class="energy-pip sm" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>
                  {/each}
                </span>
              {/if}
            </div>
          {/if}

          <!-- Set info -->
          <p class="pv-setinfo">{pv.setCode} · {pv.collectorNumber}</p>

          <!-- Deck counter -->
          <div class="pv-counter">
            {#if active}
              <span class="pv-count-label">牌組中：<strong>{pvCount} / {pvMax}</strong></span>
              <button class="icon" onclick={() => removeCard(pv.id)} disabled={pvCount <= 0}>−</button>
              <button class="icon" onclick={() => addCard(pv)} disabled={!isBasicEnergy(pv) && pvCount >= pvMax}>+</button>
            {:else}
              <span class="pv-count-label muted">請先選擇牌組</span>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- ── Text format modal ────────────────────────────────────────────────── -->
{#if showTextModal}
  <div class="pv-overlay" onclick={() => { showTextModal = false; }}>
    <div class="pv-inner text-modal" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={() => { showTextModal = false; }} aria-label="關閉">×</button>

      {#if textModalMode === 'export'}
        <h3 class="modal-title">匯出牌組（文字格式）</h3>
        <p class="muted">格式：<code>張數 卡名 卡包代號 卡號</code>　可貼到其他模擬器或分享給對手</p>
        <textarea class="text-area" readonly value={textExportContent}></textarea>
        <div class="text-actions">
          <button class="small" onclick={copyToClipboard}>📋 複製到剪貼簿</button>
          <button class="small" onclick={downloadTextFile}>⬇ 下載 .txt</button>
        </div>
      {:else}
        <h3 class="modal-title">匯入牌組（文字格式）</h3>
        <p class="muted">格式：<code>張數 卡名 卡包代號 卡號</code>　首行可選：<code>// 牌組名稱</code></p>
        <textarea class="text-area" bind:value={importTextInput}
          placeholder={"// 我的火系牌組\n4 小火龍 SV5K 007\n2 火恐龍 SV5K 008\n..."}></textarea>
        <div class="text-actions">
          <button class="small" onclick={importFromText} disabled={!importTextInput.trim()}>匯入</button>
          <button class="small" onclick={() => { showTextModal = false; }}>取消</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

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

  /* Stats bar */
  .stats-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0 0.25rem;
    flex-wrap: wrap;
  }
  .stat {
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }
  .stat.pokemon { background: #d4edda; color: #1a6b2e; }
  .stat.trainer { background: #e8d4f0; color: #5a1a80; }
  .stat.energy  { background: #fff0d0; color: #7a4a00; }
  .stat-track {
    flex: 1;
    min-width: 80px;
    height: 6px;
    background: #eee;
    border-radius: 3px;
    overflow: hidden;
    display: flex;
  }
  .stat-seg { height: 100%; }
  .stat-seg.poke  { background: #2c7a3c; }
  .stat-seg.train { background: #8a3a80; }
  .stat-seg.ene   { background: #c77a00; }

  /* Entry thumbnail as button */
  .entry-thumb {
    background: none;
    border: none;
    padding: 0;
    cursor: zoom-in;
    border-radius: 2px;
  }
  .entry-thumb img {
    display: block;
    width: 40px;
    height: 56px;
    object-fit: cover;
    border-radius: 2px;
  }

  /* Picker enhancements */
  .pick-thumb {
    background: none;
    border: none;
    padding: 0;
    cursor: zoom-in;
    flex-shrink: 0;
  }
  .pick-thumb img {
    display: block;
    width: 40px;
    height: 56px;
    object-fit: cover;
    border-radius: 2px;
  }
  .pick-meta {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    color: inherit;
    min-width: 0;
  }
  .picker-list li.previewing {
    background: #eef4ff;
    outline: 2px solid #4a7fd4;
    outline-offset: -1px;
    border-radius: 4px;
  }
  .add-btn {
    flex-shrink: 0;
  }

  /* ── Preview modal ───────────────────────────────────────────────────── */
  .pv-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    cursor: zoom-out;
  }
  .pv-inner {
    background: #fff;
    border-radius: 12px;
    max-width: 760px;
    width: 100%;
    max-height: 92vh;
    overflow-y: auto;
    position: relative;
    padding: 1.5rem;
    cursor: default;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }
  .pv-close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: 1px solid #ddd;
    background: #f4f4f4;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }
  .pv-close:hover { background: #e8e8e8; }

  .pv-top {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 560px) {
    .pv-top { grid-template-columns: 1fr; }
    .pv-img { width: 140px; }
  }
  .pv-img {
    width: 180px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  .pv-name {
    margin: 0 0 0.5rem;
    font-size: 1.3rem;
  }
  .pv-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }
  .type-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .sub-badge {
    padding: 0.15rem 0.5rem;
    background: #eee;
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .hp-badge {
    padding: 0.15rem 0.5rem;
    background: #ffe5e5;
    color: #c00;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .pv-evolve {
    margin: 0.25rem 0 0.5rem;
    font-size: 0.85rem;
    color: #666;
  }
  .pv-setinfo {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: #999;
  }

  /* Sections */
  .pv-section {
    border-top: 1px solid #eee;
    margin-top: 0.75rem;
    padding-top: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .pv-rules {
    font-size: 0.9rem;
    color: #444;
    white-space: pre-wrap;
  }

  /* Ability */
  .pv-ability {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.5rem;
    align-items: baseline;
  }
  .ab-label {
    grid-row: 1;
    background: #c00;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    align-self: center;
  }
  .ab-name {
    grid-row: 1;
    font-size: 0.95rem;
  }
  .ab-effect {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 0.85rem;
    color: #444;
  }

  /* Attack */
  .pv-attack { display: flex; flex-direction: column; gap: 0.2rem; }
  .atk-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .atk-cost { display: flex; gap: 0.2rem; flex-wrap: wrap; }
  .atk-name { font-size: 0.95rem; }
  .atk-dmg {
    margin-left: auto;
    font-weight: 700;
    font-size: 1rem;
  }
  .atk-effect {
    margin: 0;
    font-size: 0.85rem;
    color: #444;
  }

  /* Energy pip */
  .energy-pip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    font-size: 0.65rem;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }
  .energy-pip.sm {
    width: 1.1rem;
    height: 1.1rem;
    font-size: 0.6rem;
  }

  /* Weakness / Resistance / Retreat */
  .pv-wrc {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: #555;
    align-items: center;
  }
  .pv-wrc span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* Deck counter in preview */
  .pv-counter {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid #eee;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .pv-count-label {
    font-size: 0.9rem;
    margin-right: auto;
  }

  /* Sync status pill */
  .sync-pill {
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    margin-left: auto;
  }
  .sync-idle    { background: #eee; color: #888; }
  .sync-syncing { background: #fff8d0; color: #7a5800; }
  .sync-synced  { background: #e0f4e0; color: #1a6020; }
  .sync-error   { background: #fdeaea; color: #900; cursor: help; }

  /* Text format modal */
  .text-modal { max-width: 560px; }
  .modal-title { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .text-area {
    width: 100%;
    min-height: 260px;
    font-family: 'Consolas', 'Menlo', monospace;
    font-size: 0.85rem;
    padding: 0.6rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    resize: vertical;
    box-sizing: border-box;
    background: #fafafa;
  }
  .text-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }
  code {
    background: #eef;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }
</style>
