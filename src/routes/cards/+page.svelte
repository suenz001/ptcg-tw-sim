<script lang="ts">
  import { base } from '$app/paths';
  import type { Card, SetSummary, EnergyType } from '$lib/cards/types';
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
    | { mode: 'set'; setCode: string; setName?: string; cards: Card[] };

  let { data }: { data: LoadData } = $props();

  // ─── Set-index mode state ────────────────────────────────────────────
  // (declared at top level so Svelte 5 $state works; only used when data.mode === 'index')

  // ─── Single-set browser state ────────────────────────────────────────
  // 分類 key 對應 (supertype, subtype) — 跟 sim engine 一致：
  //   - Pokemon: supertype='Pokemon'
  //   - Tool (寶可夢道具): supertype='Trainer' && subtype === 'PokemonTool'
  //   - Supporter / Item / Stadium: supertype='Trainer' && 對應 subtype
  //   - Energy: supertype='Energy'
  type CategoryKey = 'Pokemon' | 'Supporter' | 'Item' | 'Tool' | 'Stadium' | 'Energy';
  const CATEGORY_LABEL: Record<CategoryKey, string> = {
    Pokemon: '寶可夢',
    Supporter: '支援者',
    Item: '物品',
    Tool: '寶可夢道具',
    Stadium: '競技場',
    Energy: '能量'
  };
  // 顯示順序（左到右）
  const CATEGORY_ORDER: CategoryKey[] = ['Pokemon', 'Supporter', 'Item', 'Tool', 'Stadium', 'Energy'];

  function cardCategory(c: Card): CategoryKey {
    if (c.supertype === 'Energy') return 'Energy';
    if (c.supertype === 'Pokemon') return 'Pokemon';
    // Trainer
    if (c.subtype === 'PokemonTool') return 'Tool';
    if (c.subtype === 'Supporter') return 'Supporter';
    if (c.subtype === 'Stadium') return 'Stadium';
    return 'Item';
  }

  let query = $state('');
  // 多選：空 Set = 全部；非空 = 只顯示這些分類
  // 點一次加入、點兩次移除；按「全部」清空 Set。
  let selectedCategories = $state<Set<CategoryKey>>(new Set());
  let selected = $state<Card | null>(null);
  let lightbox = $state<string | null>(null);

  // v2.70: tag chip 列 — PTCG 常見跨 supertype 分類標籤。邏輯為 OR：命中任一選中
  // tag 即顯示（與 category filter 以 AND 結合）。「超級進化」不是 scraper tag，而是
  // runtime 依卡名前綴「超級」+ subtype='ex' 偵測（與 engine.prizesForKO 同邏輯），
  // 這樣資料不用重跑 migration 也能立即篩。
  type TagKey = 'ACE SPEC' | '古代' | '未來' | '太晶' | '超級進化' | '訓練家冠名';
  const TAG_ORDER: TagKey[] = ['ACE SPEC', '古代', '未來', '太晶', '超級進化', '訓練家冠名'];
  let selectedTags = $state<Set<TagKey>>(new Set());

  // v2.74: 屬性篩選 — 以 pokemonType 過濾寶可夢（草/火/水/雷/超/鬥/惡/鋼/妖/龍/無）
  const ENERGY_ORDER: EnergyType[] = [
    'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
    'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'
  ];
  let selectedTypes = $state<Set<EnergyType>>(new Set());

  // v2.74: 階段篩選 — 基礎 / 1階 / 2階
  // ex 卡的 subtype 被 scraper 統一設為 'ex'，不保留原始 stage。
  // 因此需要 runtime 推斷：
  //   - 有 evolvesFrom → 至少是 1階（若 evolvesFrom 卡本身也有 evolvesFrom → 2階）
  //   - 無 evolvesFrom → 視為基礎（但超級進化除外，超級進化一定是進化的）
  // 注意：這只是近似值，部分 ex 卡的 evolvesFrom 資料可能缺失。
  type StageKey = 'Basic' | 'Stage1' | 'Stage2';
  const STAGE_LABEL: Record<StageKey, string> = {
    Basic: '基礎',
    Stage1: '1階進化',
    Stage2: '2階進化'
  };
  const STAGE_ORDER: StageKey[] = ['Basic', 'Stage1', 'Stage2'];
  let selectedStages = $state<Set<StageKey>>(new Set());

  /** 取得寶可夢的階段。v2.75 起 JSON 有 `stage` 欄位（由 migration 補齊），
   *  直接用即可，不再需要 runtime 推斷。
   *  fallback：若 stage 欄位缺失（老資料未跑 migration），用 subtype。*/
  function cardStage(c: Card): StageKey | null {
    if (c.supertype !== 'Pokemon') return null;
    // v2.75: 直接讀 stage 欄位
    if (c.stage) return c.stage;
    // fallback for un-migrated data
    if (c.subtype === 'Basic') return 'Basic';
    if (c.subtype === 'Stage1') return 'Stage1';
    if (c.subtype === 'Stage2') return 'Stage2';
    // ex without stage field — conservative Basic
    return c.evolvesFrom ? 'Stage1' : 'Basic';
  }

  function isMegaEx(c: Card): boolean {
    return c.supertype === 'Pokemon' && c.subtype === 'ex' && c.name.startsWith('超級');
  }
  function hasTag(c: Card, tag: TagKey): boolean {
    if (tag === '超級進化') return isMegaEx(c);
    return (c.tags ?? []).includes(tag);
  }

  function toggleCategory(cat: CategoryKey) {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    selectedCategories = next;
  }
  function clearCategories() {
    selectedCategories = new Set();
  }
  function toggleTag(tag: TagKey) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    selectedTags = next;
  }
  function clearTags() {
    selectedTags = new Set();
  }
  function toggleType(t: EnergyType) {
    const next = new Set(selectedTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    selectedTypes = next;
  }
  function clearTypes() {
    selectedTypes = new Set();
  }
  function toggleStage(s: StageKey) {
    const next = new Set(selectedStages);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    selectedStages = next;
  }
  function clearStages() {
    selectedStages = new Set();
  }

  function openLightbox(url: string) { lightbox = url; }
  function closeLightbox() { lightbox = null; }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { closeLightbox(); if (!lightbox) selected = null; }
  }

  const setCards = $derived(data.mode === 'set' ? data.cards : []);
  const filtered = $derived.by(() => {
    if (data.mode !== 'set') return [];
    const q = query.trim().toLowerCase();
    const cats = selectedCategories;
    const tags = selectedTags;
    const types = selectedTypes;
    const stages = selectedStages;
    return setCards.filter((c) => {
      if (cats.size > 0 && !cats.has(cardCategory(c))) return false;
      // tag filter: OR across selected tags
      if (tags.size > 0) {
        let any = false;
        for (const t of tags) { if (hasTag(c, t)) { any = true; break; } }
        if (!any) return false;
      }
      // v2.74: 屬性篩選（OR）— 只對有 pokemonType 的卡有效
      if (types.size > 0) {
        if (!c.pokemonType || !types.has(c.pokemonType)) return false;
      }
      // v2.74: 階段篩選（OR）
      if (stages.size > 0) {
        const stage = cardStage(c);
        if (!stage || !stages.has(stage)) return false;
      }
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

<svelte:window onkeydown={onKeydown} />

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
    // v2.30: 每個 mark group 內依 releaseDate 升序（舊 → 新）——越新的越右邊。
    // 沒填 releaseDate 的排到最後，最後用 code 字典序做 tiebreaker，
    // 保證同一天發售（如 SV5K/SV5M、SV11B/SV11W）仍有穩定順序。
    const byDateAsc = (a: SetSummary, b: SetSummary) => {
      const da = a.releaseDate ?? '';
      const db = b.releaseDate ?? '';
      if (da && db && da !== db) return da.localeCompare(db);
      if (da && !db) return -1;
      if (!da && db) return 1;
      return a.code.localeCompare(b.code);
    };
    for (const [, sets] of groups) sets.sort(byDateAsc);

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

  <!-- ═══════════════ ALL (virtual aggregator) ═══════════════ -->
  {@const totalAllCards = data.sets.reduce((n, s) => n + s.cardCount, 0)}
  <div class="markSection">
    <h2 class="markHeader">
      <span class="markBadge mark-ALL">★</span>
      <span>全部 · 合併 H / I / J 所有卡包</span>
    </h2>
    <div class="setGrid">
      <a class="setTile setTileAll" href="{base}/cards?set=ALL">
        <img src="{base}/covers/ALL.svg" alt="全部卡牌" loading="lazy" />
        <div class="setInfo">
          <div class="setCode">ALL</div>
          <div class="setName">全部 H / I / J 卡牌</div>
          <div class="setCount">{totalAllCards} 張</div>
        </div>
      </a>
    </div>
  </div>

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
              <div class="setCode">{set.code}</div>
              <div class="setName" title={set.name}>{set.name}</div>
              {#if set.releaseDate}
                <div class="setDate">發售 {set.releaseDate}</div>
              {/if}
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
    <h1>
      {data.setCode}{#if data.setName}<span class="setTitleName">{data.setName}</span>{/if}
    </h1>
    <p class="meta">共 {setCards.length} 張卡 · 顯示 {filtered.length} 張</p>
  </header>

  <div class="controls">
    <input type="search" bind:value={query} placeholder="搜尋卡名、招式、特性、卡號..." aria-label="搜尋" />
    <div class="filters" role="group" aria-label="卡片分類篩選（可複選，再點一次取消）">
      <button
        class="filter"
        class:active={selectedCategories.size === 0}
        onclick={clearCategories}
        title="清除所有分類篩選"
      >全部</button>
      {#each CATEGORY_ORDER as cat (cat)}
        <button
          class="filter"
          class:active={selectedCategories.has(cat)}
          onclick={() => toggleCategory(cat)}
          title="點一次選取、點兩次取消"
        >{CATEGORY_LABEL[cat]}</button>
      {/each}
    </div>
    <div class="filters tagFilters" role="group" aria-label="標籤篩選（可複選）">
      <span class="tagLabel">標籤：</span>
      <button
        class="filter filter-tag"
        class:active={selectedTags.size === 0}
        onclick={clearTags}
        title="清除所有標籤篩選"
      >不限</button>
      {#each TAG_ORDER as tag (tag)}
        <button
          class="filter filter-tag"
          class:active={selectedTags.has(tag)}
          onclick={() => toggleTag(tag)}
          title="點一次選取、點兩次取消"
        >{tag}</button>
      {/each}
    </div>
    <div class="filters typeFilters" role="group" aria-label="屬性篩選（可複選）">
      <span class="tagLabel">屬性：</span>
      <button
        class="filter filter-type"
        class:active={selectedTypes.size === 0}
        onclick={clearTypes}
        title="清除所有屬性篩選"
      >不限</button>
      {#each ENERGY_ORDER as etype (etype)}
        <button
          class="filter filter-type"
          class:active={selectedTypes.has(etype)}
          onclick={() => toggleType(etype)}
          title="{ENERGY_LABEL[etype]}屬性 — 點一次選取、點兩次取消"
          style:--type-bg={ENERGY_COLOR[etype]}
        >
          <span class="typeChip" style:background={ENERGY_COLOR[etype]}>{ENERGY_LABEL[etype]}</span>
        </button>
      {/each}
    </div>
    <div class="filters stageFilters" role="group" aria-label="階段篩選（可複選）">
      <span class="tagLabel">階段：</span>
      <button
        class="filter filter-stage"
        class:active={selectedStages.size === 0}
        onclick={clearStages}
        title="清除所有階段篩選"
      >不限</button>
      {#each STAGE_ORDER as stg (stg)}
        <button
          class="filter filter-stage"
          class:active={selectedStages.has(stg)}
          onclick={() => toggleStage(stg)}
          title="點一次選取、點兩次取消"
        >{STAGE_LABEL[stg]}</button>
      {/each}
    </div>
  </div>

  <div class="grid">
    {#each filtered as card (card.id)}
      <button class="cardBtn" onclick={() => (selected = card)} aria-label={card.name}>
        <img src={card.imageUrl} alt={card.name} loading="lazy" />
        <span class="cardLabel">
          <span class="num">
            {#if data.setCode === 'ALL'}<span class="setPrefix">{card.setCode}</span>{' '}{/if}{card.collectorNumber}
          </span>
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
          <button
            class="detailImgBtn"
            onclick={() => openLightbox(selected!.imageUrl)}
            aria-label="放大卡牌圖片"
            title="點擊放大"
          >
            <img class="detailImg" src={selected.imageUrl} alt={selected.name} />
            <span class="zoomHint">🔍</span>
          </button>
          <div class="detailInfo">
            <h2>{selected.name}</h2>
            <p class="tag">
              {selected.supertype} / {selected.subtype}
              {#if cardStage(selected)}
                · {STAGE_LABEL[cardStage(selected)!] ?? cardStage(selected)}
              {/if}
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

            {#if (selected.tags && selected.tags.length) || isMegaEx(selected)}
              <p class="tagChips">
                {#each selected.tags ?? [] as t}
                  <span class="tagChip">{t}</span>
                {/each}
                {#if isMegaEx(selected)}
                  <span class="tagChip">超級進化</span>
                {/if}
              </p>
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

  {#if lightbox}
    <div
      class="lightboxOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="放大卡牌圖片"
      onclick={closeLightbox}
    >
      <img class="lightboxImg" src={lightbox} alt="放大圖片" onclick={(e) => e.stopPropagation()} />
      <button class="lightboxClose" onclick={closeLightbox} aria-label="關閉">×</button>
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
  .setTitleName {
    margin-left: 0.75rem;
    font-size: 0.7em;
    font-weight: 500;
    color: #4b5563;
  }
  .meta {
    margin: 0;
    color: #777;
    font-size: 0.9rem;
  }

  /* ── Set-index grid ── */
  .setGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .setTile {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.08s, box-shadow 0.08s, border-color 0.08s;
  }
  .setTile:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
    border-color: #d0d0d0;
  }
  .setTile img {
    width: 100%;
    aspect-ratio: 0.71;
    object-fit: cover;
    background: #eee;
    border-radius: 6px;
    margin-bottom: 0.55rem;
  }
  .setInfo {
    min-width: 0; /* let the 2-line clamp actually work inside flex/grid */
  }
  .setCode {
    font-size: 0.72rem;
    color: #888;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }
  .setName {
    font-weight: 600;
    font-size: 0.95rem;
    margin: 0.15rem 0 0.25rem;
    line-height: 1.35;
    /* Allow wrap up to 2 lines; long 中文卡包名完整顯示不截斷 */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    /* Reserve 2 lines so every tile has the same height regardless of name length */
    min-height: 2.7em;
  }
  .setCount {
    font-size: 0.8rem;
    color: #666;
  }
  /* v2.30: 發售日 — 放在中文名稱下方，比 setCount 再淡一階。
     用 tabular-nums 讓每片 tile 的日期在同一列對齊。 */
  .setDate {
    font-size: 0.72rem;
    color: #9ca3af;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    margin-bottom: 0.1rem;
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
    font-size: 1.05rem;
    line-height: 1.6em;
    color: #555;
    font-weight: 500;
  }
  .markBadge {
    display: inline-grid;
    place-items: center;
    width: 1.6em;
    height: 1.6em;
    border-radius: 4px;
    color: #fff;
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1;
    /* Monospace keeps H/I/J optical width similar so the badge doesn't look lopsided */
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
  .mark-H { background: #3b82f6; }
  .mark-I { background: #8b5cf6; }
  .mark-J { background: #f59e0b; }
  .mark-ALL {
    background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 55%, #f59e0b 100%);
  }

  /* Highlight the ALL aggregator tile so it stands out from real packs */
  .setTileAll {
    border-color: transparent;
    background:
      linear-gradient(#fff, #fff) padding-box,
      linear-gradient(135deg, #3b82f6, #8b5cf6, #f59e0b) border-box;
    border: 2px solid transparent;
  }
  .setTileAll:hover {
    box-shadow: 0 6px 18px rgba(139, 92, 246, 0.25);
    border-color: transparent;
  }
  .setTileAll .setCode {
    color: #6d28d9;
    font-weight: 700;
  }

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
  /* tag filter — 次要欄，視覺上比分類 chip 再淡一階 */
  .tagFilters,
  .typeFilters,
  .stageFilters {
    flex-basis: 100%;
    align-items: center;
    gap: 0.3rem;
  }
  .tagLabel {
    color: #6b7280;
    font-size: 0.85rem;
    margin-right: 0.2rem;
  }
  .filter-tag {
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    color: #4b5563;
  }
  .filter-tag.active {
    background: #6366f1;
    color: #fff;
    border-color: #6366f1;
  }
  /* v2.74: 屬性篩選 chip — 帶能量色 dot */
  .filter-type {
    padding: 0.35rem 0.6rem;
    font-size: 0.82rem;
    color: #4b5563;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .filter-type.active {
    background: var(--type-bg, #6366f1);
    color: #fff;
    border-color: var(--type-bg, #6366f1);
  }
  .filter-type.active .typeChip {
    background: rgba(255,255,255,0.35) !important;
  }
  .typeChip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3em;
    height: 1.3em;
    border-radius: 50%;
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(0,0,0,0.3);
    flex-shrink: 0;
  }
  /* v2.74: 階段篩選 chip */
  .filter-stage {
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    color: #4b5563;
  }
  .filter-stage.active {
    background: #059669;
    color: #fff;
    border-color: #059669;
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
  /* Set-code prefix shown on each card tile in ALL mode */
  .setPrefix {
    display: inline-block;
    padding: 0 0.3em;
    margin-right: 0.15em;
    background: #e0e7ff;
    color: #4338ca;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.95em;
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
  /* Clickable card image in modal */
  .detailImgBtn {
    position: relative;
    display: block;
    background: none;
    border: none;
    padding: 0;
    cursor: zoom-in;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
  }
  .detailImgBtn:hover .zoomHint {
    opacity: 1;
  }
  .zoomHint {
    position: absolute;
    bottom: 0.4rem;
    right: 0.4rem;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 1rem;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }
  .detailImg {
    width: 100%;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    display: block;
  }

  /* Lightbox */
  .lightboxOverlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    cursor: zoom-out;
    padding: 1rem;
  }
  .lightboxImg {
    max-width: min(600px, 95vw);
    max-height: 92vh;
    object-fit: contain;
    border-radius: 12px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
    cursor: default;
  }
  .lightboxClose {
    position: absolute;
    top: 1rem;
    right: 1.25rem;
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: #fff;
    font-size: 2rem;
    line-height: 1;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lightboxClose:hover {
    background: rgba(255, 255, 255, 0.3);
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
  .tagChips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0.25rem 0 0.75rem;
  }
  .tagChip {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    background: #eef2ff;
    color: #4338ca;
    border-radius: 10px;
    font-size: 0.8rem;
    font-weight: 500;
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
