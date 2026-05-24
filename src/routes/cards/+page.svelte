<script lang="ts">
  import { base } from '$app/paths';
  import type { Card, SetSummary, EnergyType } from '$lib/cards/types';
  import { getEvolutionChainNames, getEvolutionChainGrouped } from '$lib/cards/evolutionChain';
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
    | { mode: 'set'; setCode: string; setName?: string; cards: Card[]; sets?: SetSummary[] };

  let { data }: { data: LoadData } = $props();

  // ─── Set-index mode state ────────────────────────────────────────────
  // (declared at top level so Svelte 5 $state works; only used when data.mode === 'index')

  // ─── Single-set browser state ────────────────────────────────────────
  // 分類 key 對應 (supertype, subtype) — 跟 sim engine 一致：
  //   - Pokemon: supertype='Pokemon'
  //   - Tool (寶可夢道具): supertype='Trainer' && subtype === 'PokemonTool'
  //   - Supporter / Item / Stadium: supertype='Trainer' && 對應 subtype
  //   - Energy: supertype='Energy' (Basic / Special)
  type CategoryKey = 'Pokemon' | 'Supporter' | 'Item' | 'Tool' | 'Stadium' | 'BasicEnergy' | 'SpecialEnergy';
  const CATEGORY_LABEL: Record<CategoryKey, string> = {
    Pokemon: '寶可夢',
    Supporter: '支援者',
    Item: '物品',
    Tool: '寶可夢道具',
    Stadium: '競技場',
    BasicEnergy: '基本能量',
    SpecialEnergy: '特殊能量'
  };
  // 顯示順序（左到右）
  const CATEGORY_ORDER: CategoryKey[] = ['Pokemon', 'Supporter', 'Item', 'Tool', 'Stadium', 'BasicEnergy', 'SpecialEnergy'];

  function cardCategory(c: Card): CategoryKey {
    if (c.supertype === 'Energy') return c.subtype === 'Basic' ? 'BasicEnergy' : 'SpecialEnergy';
    if (c.supertype === 'Pokemon') return 'Pokemon';
    // Trainer
    if (c.subtype === 'PokemonTool') return 'Tool';
    if (c.subtype === 'Supporter') return 'Supporter';
    if (c.subtype === 'Stadium') return 'Stadium';
    return 'Item';
  }

  let query = $state('');
  // v2.184：搜尋模式切換
  //   normal  — 只搜卡名 / 招式名 / 特性名 / 卡號（原行為）
  //   keyword — 全文搜尋，含 rulesText、招式 effect、特性 effect、特性 label
  // v4.954：新增 keywordScope — 在關鍵字模式下細分搜尋範圍
  //   all       — 全文（卡名、招式、特性、rules，原 keyword 行為）
  //   attacks   — 只搜招式（attacks[].name + attacks[].effect）
  //   abilities — 只搜特性（abilities[].label + abilities[].name + abilities[].effect）
  let searchMode = $state<'normal' | 'keyword' | 'evolution'>('normal');
  let keywordScope = $state<'all' | 'attacks' | 'abilities'>('all');
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

  // v2.86: 屬性篩選 — 以 pokemonType 過濾寶可夢+能量卡（移除已不存在的妖精屬性）
  const ENERGY_ORDER: EnergyType[] = [
    'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
    'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'
  ];
  let selectedTypes = $state<Set<EnergyType>>(new Set());

  // v2.86: 能量卡的屬性映射 — 讓能量卡也能被屬性篩選找到
  // 基本能量：對應其單一屬性。
  // 特殊能量：依據卡片效果提供的能量屬性分類。
  //   - 全屬性能量（古舊能量、夜光能量等）→ 所有 10 種屬性
  //   - 無屬性能量（富裕能量、燃火能量等）→ 只有 Colorless
  //   - 單屬性特殊能量（增強【草】能量等）→ 該屬性 + Colorless
  //   - 雙屬性能量（火箭隊能量等）→ 對應的兩個屬性
  // v2.184：移除 'Dragon' — 目前無【龍】基本能量卡，故彩色特殊能量（古舊 / 夜光 /
  //   新衝天 / 稜鏡）不該被視為提供龍能量。寶可夢屬性篩選的 ENERGY_ORDER 仍保留 Dragon
  //   讓玩家可篩出龍屬性寶可夢；只有特殊能量映射的「all-types」這個概念排除 Dragon。
  const ALL_TYPES: EnergyType[] = ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Colorless'];
  const ENERGY_TYPE_MAP: Record<string, EnergyType[]> = {
    // 基本能量
    '基本【草】能量': ['Grass'],
    '基本【火】能量': ['Fire'],
    '基本【水】能量': ['Water'],
    '基本【雷】能量': ['Lightning'],
    '基本【超】能量': ['Psychic'],
    '基本【鬥】能量': ['Fighting'],
    '基本【惡】能量': ['Darkness'],
    '基本【鋼】能量': ['Metal'],
    // 全屬性特殊能量（可以當作任何屬性）
    '古舊能量': ALL_TYPES,
    '夜光能量': ALL_TYPES,
    '新衝天能量': ALL_TYPES,
    '稜鏡能量': ALL_TYPES,
    // 單屬性特殊能量
    '增強【草】能量': ['Grass', 'Colorless'],
    '燃料【火】能量': ['Fire', 'Colorless'],
    '泡沫【水】能量': ['Water', 'Colorless'],
    '感應【超】能量': ['Psychic', 'Colorless'],
    '硬岩【鬥】能量': ['Fighting', 'Colorless'],
    '磁鐵【鋼】能量': ['Metal', 'Colorless'],
    // v5.065：閃電【雷】能量、暗影【惡】能量（之前漏加，玩家報無法用屬性篩選找到）
    '閃電【雷】能量': ['Lightning', 'Colorless'],
    '暗影【惡】能量': ['Darkness', 'Colorless'],
    // 雙屬性特殊能量
    '火箭隊能量': ['Psychic', 'Darkness'],
    // 無色/效果型特殊能量（只提供無色能量）
    '富裕能量': ['Colorless'],
    '燃火能量': ['Colorless'],
    '噴射能量': ['Colorless'],
    '回力鏢能量': ['Colorless'],
    '扣殺能量': ['Colorless'],
    '薄霧能量': ['Colorless'],
  };

  /** 取得卡片匹配的屬性列表（用於屬性篩選） */
  function cardTypes(c: Card): EnergyType[] {
    // 寶可夢：直接用 pokemonType
    if (c.pokemonType) return [c.pokemonType];
    // 能量卡：查表
    if (c.supertype === 'Energy') {
      return ENERGY_TYPE_MAP[c.name] ?? ['Colorless'];
    }
    return [];
  }

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

  // v2.84: 賽制賽季標記篩選 (G, H, I, J)
  type RegMarkKey = 'G' | 'H' | 'I' | 'J';
  const REG_MARK_ORDER: RegMarkKey[] = ['G', 'H', 'I', 'J'];
  let selectedRegMarks = $state<Set<RegMarkKey>>(new Set());

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
  function toggleRegMark(m: RegMarkKey) {
    const next = new Set(selectedRegMarks);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    selectedRegMarks = next;
  }
  function clearRegMarks() {
    selectedRegMarks = new Set();
  }

  function openLightbox(url: string) { lightbox = url; }
  function closeLightbox() { lightbox = null; }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { closeLightbox(); if (!lightbox) selected = null; return; }
    // v4.989: modal 開且 lightbox 未開時，←/→ cycle 同名變體
    if (selected && !lightbox) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVariant(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); cycleVariant(1); }
    }
  }

  const setCards = $derived(data.mode === 'set' ? data.cards : []);

  // v2.184：setCode → 中文卡包名 對照（給 modal foot「出自於卡包【XXX】」用）
  const setNameByCode = $derived.by(() => {
    if (data.mode !== 'set') return {} as Record<string, string>;
    const map: Record<string, string> = {};
    for (const s of (data.sets ?? [])) map[s.code] = s.name;
    return map;
  });

  // v4.987: 進化鏈名字 cache — pool 用 setCards（玩家想跨 set 可切「全部卡包」）
  const chainNames = $derived.by(() => {
    if (searchMode !== 'evolution') return new Set<string>();
    const q = query.trim();
    if (!q) return new Set<string>();
    return getEvolutionChainNames(q, setCards);
  });
  // v4.988: 目前 modal 卡的進化鏈分階（用 setCards 為 pool；跨 set 鏈需切「全部卡包」）
  const selectedChain = $derived.by(() => {
    if (!selected || selected.supertype !== 'Pokemon') return [];
    return getEvolutionChainGrouped(selected.name, setCards);
  });
  // v4.989: 目前 modal 卡的同名變體（pool = setCards；跨 set 變體需切「全部卡包」）
  const sameNameVariants = $derived.by(() => {
    if (!selected) return [] as Card[];
    return setCards.filter(c => c.name === selected!.name);
  });
  function cycleVariant(dir: 1 | -1) {
    if (!selected) return;
    if (sameNameVariants.length <= 1) return;
    const idx = sameNameVariants.findIndex(c => c.id === selected!.id);
    if (idx < 0) return;
    const newIdx = (idx + dir + sameNameVariants.length) % sameNameVariants.length;
    selected = sameNameVariants[newIdx];
  }
  // v4.988: modal 內進化鏈 click 切換到該名字第一張卡（限 setCards 範圍）
  function switchSelectedToName(name: string) {
    const card = setCards.find(c => c.name === name);
    if (card) selected = card;
  }
  const filtered = $derived.by(() => {
    if (data.mode !== 'set') return [];
    const q = query.trim().toLowerCase();
    const cats = selectedCategories;
    const tags = selectedTags;
    const types = selectedTypes;
    const stages = selectedStages;
    const marks = selectedRegMarks;
    return setCards.filter((c) => {
      if (cats.size > 0 && !cats.has(cardCategory(c))) return false;
      // tag filter: OR across selected tags
      if (tags.size > 0) {
        let any = false;
        for (const t of tags) { if (hasTag(c, t)) { any = true; break; } }
        if (!any) return false;
      }
      // v2.86: 屬性篩選（OR）— 寶可夢用 pokemonType，能量卡用 ENERGY_TYPE_MAP
      if (types.size > 0) {
        const ct = cardTypes(c);
        if (ct.length === 0 || !ct.some(t => types.has(t))) return false;
      }
      // v2.74: 階段篩選（OR）
      if (stages.size > 0) {
        const stage = cardStage(c);
        if (!stage || !stages.has(stage)) return false;
      }
      // v2.83: 賽季標記篩選（OR）
      if (marks.size > 0) {
        if (!c.regulationMark || !marks.has(c.regulationMark as RegMarkKey)) return false;
      }
      if (!q) return true;
      // v4.987: 進化鏈搜尋模式 — 輸入名字顯示整條進化鏈
      if (searchMode === 'evolution') {
        return chainNames.has(c.name);
      }
      // v2.184：兩種搜尋模式；v4.954：keyword 模式再細分 scope
      if (searchMode === 'keyword') {
        // v4.954：依 keywordScope 限定搜尋範圍
        let haystack: string[];
        if (keywordScope === 'attacks') {
          // 只搜招式名 + 招式效果敘述
          haystack = (c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']);
        } else if (keywordScope === 'abilities') {
          // 只搜特性 label（種類）+ 特性名 + 特性效果敘述
          haystack = (c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']);
        } else {
          // 'all' — 全文搜尋：卡名 / 卡號 / 招式 / 特性 / rulesText / evolvesFrom（原行為）
          haystack = [
            c.name,
            c.collectorNumber,
            c.evolvesFrom ?? '',
            c.rulesText ?? '',
            ...(c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']),
            ...(c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']),
          ];
        }
        return haystack.some(s => s && s.toLowerCase().includes(q));
      }
      // normal 模式（原行為）：只搜卡名 / 卡號 / 招式名 / 特性名
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

    // v2.115: Standard 賽制僅 H/I/J；G 標已輪替不顯示區塊（SVC/SVD/SVP1 已刪除）
    // v4.9：M5（深淵之瞳）regulationMark 改為 J 與其他 J 標 set 合併，移除特殊 section
    const ordered = [];
    for (const mark of ['H', 'I', 'J']) {
      if (groups.has(mark)) ordered.push([mark, groups.get(mark)]);
    }
    // Anything else (F/G/other) — 目前資料庫不應出現，保留防禦性落點
    for (const [mark, sets] of groups) {
      if (!['H', 'I', 'J'].includes(mark)) ordered.push([mark, sets]);
    }
    return ordered;
  })()}

  {@const markStartDate: Record<string, string> = {
    // v2.114 台灣賽制 regulation mark 啟用日期（以台灣區第一個該 mark set 發售日為準）
    H: '2024-02-02',  // SV5K/SV5M/svhk/svhm 同日發售
    I: '2025-02-07',  // SV9 對戰搭檔
    J: '2026-01-16',  // MC 超級進化初階牌組 100（主系列 J 標啟用）
  }}
  {@const markLabel = (m: string, count: number) => {
    // v4.9：M5（深淵之瞳）已併入 J 標，無需特殊 label
    const d = markStartDate[m];
    return d ? `${m} 標 · ${count} 個卡包 (自 ${d})` : `${m} 標 · ${count} 個卡包`;
  }}

  <header>
    <a class="back" href="{base}/">← 首頁</a>
    <h1>卡牌資料庫</h1>
    <p class="meta">
      {data.sets.filter(s => s.regulationMark === 'H' || s.regulationMark === 'I' || s.regulationMark === 'J').length} 個標準卡包 · 共 {data.sets.filter(s => s.regulationMark === 'H' || s.regulationMark === 'I' || s.regulationMark === 'J').reduce((n, s) => n + s.cardCount, 0)} 張卡
      <span class="hint">（標準賽 H / I / J 標，繁體中文）</span>
    </p>
  </header>

  <!-- ═══════════════ ALL (virtual aggregator) ═══════════════ -->
  {@const totalAllCards = data.sets.filter(s => s.regulationMark === 'H' || s.regulationMark === 'I' || s.regulationMark === 'J').reduce((n, s) => n + s.cardCount, 0)}
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
        <span>{markLabel(mark, sets.length)}</span>
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
    <div class="searchRow">
      <input
        type="search"
        bind:value={query}
        placeholder={searchMode === 'normal'
          ? '搜尋卡名、招式名、特性名、卡號...'
          : keywordScope === 'attacks'
          ? '關鍵字搜尋招式名 / 招式效果敘述...'
          : keywordScope === 'abilities'
          ? '關鍵字搜尋特性名 / 特性效果敘述...'
          : '關鍵字搜尋（招式 + 特性敘述 + 效果文字 + 卡面 rules）...'}
        aria-label="搜尋" />
      <!-- v4.954：單一 <select> 取代雙按鈕；4 選項涵蓋 一般 / 關鍵字-不限/招式/特性 -->
      <select
        class="modeSelect"
        class:keyword={searchMode === 'keyword'}
        class:evolution={searchMode === 'evolution'}
        value={searchMode === 'normal' ? 'normal' : searchMode === 'evolution' ? 'evolution' : `keyword:${keywordScope}`}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v === 'normal') {
            searchMode = 'normal';
          } else if (v === 'evolution') {
            searchMode = 'evolution';
          } else {
            searchMode = 'keyword';
            keywordScope = v.slice('keyword:'.length) as 'all' | 'attacks' | 'abilities';
          }
        }}
        aria-label="搜尋模式"
      >
        <option value="normal">一般搜尋</option>
        <option value="keyword:all">關鍵字（不限）</option>
        <option value="keyword:attacks">關鍵字（搜尋招式）</option>
        <option value="keyword:abilities">關鍵字（搜尋特性）</option>
        <option value="evolution">🌱 進化鏈搜尋</option>
      </select>
    </div>
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
    <div class="filters markFilters" role="group" aria-label="賽季標記篩選（可複選）">
      <span class="tagLabel">賽季：</span>
      <button
        class="filter filter-mark"
        class:active={selectedRegMarks.size === 0}
        onclick={clearRegMarks}
        title="清除所有賽季標記篩選"
      >不限</button>
      {#each REG_MARK_ORDER as m (m)}
        <button
          class="filter filter-mark"
          class:active={selectedRegMarks.has(m)}
          onclick={() => toggleRegMark(m)}
          title="點一次選取、點兩次取消"
        >{m} 標</button>
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
        <!-- v4.989: 左右導航按鈕（同名變體 cycle）— 鍵盤 ←/→ 也可用 -->
        {#if sameNameVariants.length > 1}
          <button class="modal-nav modal-nav-prev" onclick={() => cycleVariant(-1)}
            aria-label="上一個版本" title="上一個版本（←）">‹</button>
          <button class="modal-nav modal-nav-next" onclick={() => cycleVariant(1)}
            aria-label="下一個版本" title="下一個版本（→）">›</button>
          <span class="modal-variant-counter">{sameNameVariants.findIndex(c => c.id === selected.id) + 1} / {sameNameVariants.length} 版本</span>
        {/if}
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
            <!-- v4.988: 進化鏈視覺化 — 點任一名字切換到該卡（限當前卡包） -->
            {#if selectedChain.length > 1}
              <div class="pv-evo-chain">
                <span class="pv-evo-chain-label">🌱 進化鏈</span>
                <div class="pv-evo-chain-row">
                  {#each selectedChain as group, gi (group.stage)}
                    {#if gi > 0}<span class="evo-arrow">→</span>{/if}
                    <div class="evo-stage-group">
                      {#each group.names as nm, ni (nm)}
                        {#if ni > 0}<span class="evo-or">／</span>{/if}
                        <button class="evo-card-link" class:current={nm === selected.name}
                          onclick={() => switchSelectedToName(nm)} title="點擊切換到該卡">{nm}</button>
                      {/each}
                    </div>
                  {/each}
                </div>
              </div>
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
            {#if setNameByCode[selected.setCode]}
              <p class="footSet">出自於卡包【{setNameByCode[selected.setCode]}】</p>
            {/if}
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
      <img class="lightboxImg" src={lightbox} alt="放大圖片" onclick={closeLightbox} />
      <button class="lightboxClose" onclick={closeLightbox} aria-label="關閉">×</button>
    </div>
  {/if}
{/if}

<style>

  header {
    max-width: 1200px;
    margin: calc(1rem + env(safe-area-inset-top, 0)) auto 0.5rem;
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
  /* v4.77 日版搶先 M5 — 紅橘漸層 + 內含 M 文字（不是徽章樣式，這裡是 1.6em 寬度容器） */
  .mark-M5 {
    background: linear-gradient(135deg, #dc2626 0%, #f59e0b 100%);
    font-size: 0.72rem;
    letter-spacing: -0.04em;
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
  /* v2.184: 搜尋輸入 + 模式切換並排 */
  .searchRow {
    flex: 1;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-width: 320px;
  }
  /* v4.954：原 .searchModeToggle / .modeBtn 雙按鈕已被單一 <select> 取代 — */
  /* 樣式保留作為防禦（若日後有 a/b test 還原），目前 DOM 不會掛這些 class 上 */
  .searchModeToggle {
    display: flex;
    gap: 0;
    border: 1px solid #ccc;
    border-radius: 6px;
    overflow: hidden;
    background: #fff;
  }
  .modeBtn {
    padding: 0.5rem 0.8rem;
    border: 0;
    background: #fff;
    cursor: pointer;
    font-size: 0.85rem;
    color: #555;
  }
  .modeBtn + .modeBtn {
    border-left: 1px solid #e0e0e0;
  }
  .modeBtn.active {
    background: #1a1a1a;
    color: #fff;
  }
  .modeBtn:hover:not(.active) {
    background: #f0f0f0;
  }
  /* v4.954：搜尋模式 dropdown — 一般狀態白底，keyword 狀態深色背景 */
  .modeSelect {
    padding: 0.5rem 0.8rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    font-size: 0.85rem;
    color: #333;
    font-family: inherit;
  }
  .modeSelect.keyword {
    background: #1a1a1a;
    color: #fff;
    border-color: #1a1a1a;
  }
  .modeSelect:hover:not(.keyword) {
    background: #f0f0f0;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
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
    font-size: 0.8rem;
    padding: 0.2rem 0.5rem;
    border-color: #6c5a8a;
  }
  .filter-stage.active {
    background: #6c5a8a;
    color: #fff;
  }

  .filter-mark {
    font-size: 0.8rem;
    padding: 0.2rem 0.5rem;
    border-color: #5a7a8a;
  }
  .filter-mark.active {
    background: #5a7a8a;
    color: #fff;
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
    align-items: flex-start;
    justify-content: center;
    padding: 1rem;
    padding-top: calc(env(safe-area-inset-top, 2rem) + 1rem);
    z-index: 100;
  }
  .modalInner {
    background: #fff;
    border-radius: 12px;
    max-width: 1170px;
    width: 100%;
    max-height: calc(100vh - env(safe-area-inset-top, 2rem) - 3rem);
    margin: auto;
    overflow-y: auto;
    overflow-x: hidden; /* v4.999: 明確阻擋水平 scrollbar — modal-nav transform 在某些瀏覽器仍算進 overflow extent */
    position: relative;
    padding: 1.5rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  /* v4.989: 卡牌資料庫 modal 左右導航 + 同名變體 counter */
  /* v4.998: 改用 transform 偏移 — 不影響 parent overflow extent，消除水平 scrollbar */
  .modal-nav {
    position: absolute;
    top: 50%;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 1px solid #5a7aaa;
    background: rgba(255, 255, 255, 0.08);
    color: #cce0ff;
    font-size: 1.6rem;
    font-weight: 700;
    cursor: pointer;
    z-index: 5;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  .modal-nav:hover { background: rgba(255, 255, 255, 0.18); }
  /* v5.000: button 完整放 modal 內側 16px，避免被 overflow-x: hidden 切掉 */
  .modal-nav-prev { left: 16px; transform: translateY(-50%); }
  .modal-nav-next { right: 16px; transform: translateY(-50%); }
  .modal-variant-counter {
    position: absolute;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.78rem;
    color: #aaccee;
    background: rgba(74, 122, 181, 0.18);
    border: 1px solid #5a7aaa;
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    z-index: 4;
    white-space: nowrap;
  }
  @media (max-width: 600px) {
    /* v4.998: 手機板維持 modal 內側放置（按鈕完整顯示在 modal 內）*/
    .modal-nav-prev { left: 0.3rem; transform: translateY(-50%); }
    .modal-nav-next { right: 0.3rem; transform: translateY(-50%); }
    .modal-nav { width: 36px; height: 36px; font-size: 1.4rem; }
  }

  .close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 2.8rem;
    height: 2.8rem;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    border: none;
    font-size: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #333;
    z-index: 10;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  }
  .close:hover {
    background: #fff;
    color: #000;
  }
  .detailGrid {
    display: grid;
    grid-template-columns: minmax(260px, 338px) 1fr;
    gap: 1.9rem;
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
    top: 4rem;
    top: calc(env(safe-area-inset-top, 2rem) + 1.5rem);
    right: 1.5rem;
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
    font-size: 1.95rem;
  }
  .tag {
    color: #666;
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
  }
  .evo {
    color: #666;
    font-size: 1.15rem;
    margin: 0.25rem 0 0.75rem;
  }
  /* v4.988: 進化鏈視覺化 */
  .pv-evo-chain { margin: 0.6rem 0 0.4rem; padding: 0.55rem 0.7rem; background: rgba(74, 122, 181, 0.08); border-left: 3px solid #4a7ab5; border-radius: 4px; }
  .pv-evo-chain-label { display: inline-block; font-size: 0.78rem; font-weight: 700; color: #aaccee; margin-bottom: 0.3rem; }
  .pv-evo-chain-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
  .evo-stage-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.2rem; }
  .evo-arrow { color: #99aacc; font-weight: 600; }
  .evo-or { color: #99aacc; }
  .evo-card-link {
    border: 1px solid #5a7aaa;
    background: rgba(255, 255, 255, 0.05);
    color: #cce0ff;
    border-radius: 4px;
    padding: 0.18rem 0.55rem;
    font-size: 0.85rem;
    cursor: pointer;
    font: inherit;
    transition: background 0.12s;
  }
  .evo-card-link:hover { background: rgba(255, 255, 255, 0.15); }
  .evo-card-link.current { background: #4a7ab5; color: #fff; border-color: #4a7ab5; cursor: default; }

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
    font-size: 1.05rem;
    font-weight: 500;
  }
  .detailInfo h3 {
    font-size: 1.25rem;
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
    font-size: 1.15rem;
  }
  .abilityLabel {
    font-size: 1.05rem;
    padding: 0.1rem 0.4rem;
    background: #e04a2f;
    color: #fff;
    border-radius: 3px;
  }
  .damage {
    margin-left: auto;
    font-weight: 700;
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;
  }
  .skillEffect,
  .rules {
    margin: 0.4rem 0 0;
    font-size: 1.15rem;
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
    font-size: 1rem;
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
  }
  .energyDot.small {
    width: 1.1em;
    height: 1.1em;
    font-size: 0.9rem;
  }
  .stats {
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #eee;
    font-size: 1.15rem;
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
    font-size: 1.05rem;
    color: #888;
  }
  /* v2.184: 顯示出自卡包中文名稱 */
  .footSet {
    margin: 0.25rem 0 0;
    font-size: 1.1rem;
    color: #555;
    font-weight: 500;
  }
  /* v4.492 手機 RWD：縮小 filter button 尺寸，配合 .filters flex-wrap，
     讓更多 chip 能在一行內容納，減少換行佔用垂直空間。 */
  @media (max-width: 600px) {
    .filter { padding: 0.35rem 0.55rem; font-size: 0.78rem; }
    .filter-tag, .filter-type, .filter-stage, .filter-mark { padding: 0.28rem 0.5rem; font-size: 0.74rem; }
    .typeChip { padding: 0.05rem 0.3rem; font-size: 0.74rem; }
  }
</style>
