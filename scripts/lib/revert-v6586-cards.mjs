// v6.586 Rule 40：逐字還原本版分頁接線，既有版面鎖仍對照原 BASE。
export const V6586_CARDS_REVERT_PAIRS = [
  [
    "  function allFilterKey() {\n    return JSON.stringify([query, searchMode, keywordScope, data.mode === 'set' ? data.setCode : '',\n      [...selectedCategories], [...selectedTags], [...selectedTypes], [...selectedStages], [...selectedRegMarks]]);\n  }\n  $effect(() => {\n    const filterKey = allFilterKey();",
    "  let lastAllFilterKey: string | null = null; // v6.586 只偵測條件改變，首次還原網址時保留頁碼\n  $effect(() => {\n    const filterKey = JSON.stringify([query, searchMode, keywordScope, data.setCode,\n      [...selectedCategories], [...selectedTags], [...selectedTypes], [...selectedStages], [...selectedRegMarks]]);"
  ],
  [
    "  restoreFromUrl();\n  afterNavigate(() => restoreFromUrl(true)); // 同 /cards 元件沿用時也還原返回／前進的網址\n  $effect(() => {",
    "  restoreFromUrl();\n  $effect(() => {"
  ],
  [
    "    selected = st.card ? setCards.find((x) => String(x.id) === st.card) ?? null : null;\n    lastAllFilterKey = allFilterKey(); // 導頁還原不是玩家修改篩選，不重設還原的頁碼",
    "    if (st.card) { const c = setCards.find((x) => String(x.id) === st.card); if (c) selected = c; }"
  ],
  [
    "  function restoreFromUrl(force = false) {\n    if ((_urlRestored && !force) || data.mode",
    "  function restoreFromUrl() {\n    if (_urlRestored || data.mode"
  ],
  [
    "  let currentPage = $state(1);\n  let lastAllFilterKey: string | null = null;",
    "  let currentPage = $state(1);"
  ],
  [
    "  import { replaceState, afterNavigate } from '$app/navigation';",
    "  import { replaceState } from '$app/navigation';"
  ],
  [
    "  import { replaceState } from '$app/navigation';\n  // >>> v6586-cards-pagination-imports\n  import { tick } from 'svelte';\n  import CardsPager from '$lib/cards/CardsPager.svelte';\n  import { readCardsPage, cardsPageRange, writeCardsPageSearch } from '$lib/cards/pagination';\n  // <<< v6586-cards-pagination-imports\n",
    "  import { replaceState } from '$app/navigation';\n"
  ],
  [
    "  let visibleCount = $state(PAGE_SIZE);\n  // >>> v6586-cards-pagination-state\n  let currentPage = $state(1);\n  let allPageTop = $state<HTMLElement | null>(null);\n  // <<< v6586-cards-pagination-state\n",
    "  let visibleCount = $state(PAGE_SIZE);\n"
  ],
  [
    "    query = st.q; debouncedQuery = st.q;\n    if (data.setCode === 'ALL') currentPage = readCardsPage(location.search); // v6.586 保留分享／返回的頁碼\n",
    "    query = st.q; debouncedQuery = st.q;\n"
  ],
  [
    "    const pageToWrite = data.setCode === 'ALL' ? pageRange.page : null; // v6.586 在 effect 內追蹤頁碼\n    const id = setTimeout(() => {\n      try {\n        const conditions = writeCardsUrlSearch(location.search, st);\n        const next = pageToWrite === null ? conditions : writeCardsPageSearch(conditions, pageToWrite);",
    "    const id = setTimeout(() => {\n      try {\n        const next = writeCardsUrlSearch(location.search, st);"
  ],
  [
    "  // >>> v6586-cards-pagination-range\n  const pageRange = $derived(cardsPageRange(filtered.length, currentPage, PAGE_SIZE));\n  const shown = $derived(data.setCode === 'ALL'\n    ? filtered.slice(pageRange.start, pageRange.end) : filtered.slice(0, visibleCount));\n  const hasMore = $derived(data.setCode !== 'ALL' && visibleCount < filtered.length);\n  // <<< v6586-cards-pagination-range",
    "  const shown = $derived(filtered.slice(0, visibleCount));\n  const hasMore = $derived(visibleCount < filtered.length);"
  ],
  [
    "  /** 任何會改變 filtered 的輸入變動 → 回到第一頁。 */\n  let lastAllFilterKey: string | null = null; // v6.586 只偵測條件改變，首次還原網址時保留頁碼\n  $effect(() => {\n    const filterKey = JSON.stringify([query, searchMode, keywordScope, data.setCode,\n      [...selectedCategories], [...selectedTags], [...selectedTypes], [...selectedStages], [...selectedRegMarks]]);\n    if (data.setCode === 'ALL' && lastAllFilterKey !== null && lastAllFilterKey !== filterKey) currentPage = 1;\n    lastAllFilterKey = filterKey;\n",
    "  /** 任何會改變 filtered 的輸入變動 → 回到第一頁。 */\n  $effect(() => {\n"
  ],
  [
    "  function moreSentinel(node: HTMLElement) {\n    if (data.setCode === 'ALL' || typeof IntersectionObserver === 'undefined') return; // v6.586 全部卡牌固定上限，單包維持追加\n",
    "  function moreSentinel(node: HTMLElement) {\n    if (typeof IntersectionObserver === 'undefined') return;"
  ],
  [
    "  // >>> v6586-cards-pagination-change\n  async function changeAllPage(page: number) {\n    currentPage = cardsPageRange(filtered.length, page, PAGE_SIZE).page;\n    await tick();\n    allPageTop?.focus({ preventScroll: true });\n    allPageTop?.scrollIntoView({ block: 'start', behavior: 'instant' });\n  }\n  // <<< v6586-cards-pagination-change\n\n  function closeModal() {\n",
    "  function closeModal() {\n"
  ],
  [
    "  <!-- >>> v6586-cards-pagination-top -->\n  {#if data.setCode === 'ALL' && pageRange.pages > 1}\n    <div class=\"cards-page-start\" bind:this={allPageTop} tabindex=\"-1\" role=\"group\" aria-label=\"卡牌分頁\">\n      <CardsPager range={pageRange} position=\"top\" onchange={changeAllPage} />\n    </div>\n  {/if}\n  <!-- <<< v6586-cards-pagination-top -->\n  <div class=\"grid\">\n",
    "  <div class=\"grid\">\n"
  ],
  [
    "  {#if data.setCode === 'ALL' && pageRange.pages > 1}\n    <CardsPager range={pageRange} position=\"bottom\" onchange={changeAllPage} />\n  {:else if hasMore}\n",
    "  {#if hasMore}\n"
  ],
  [
    "<style>\n  /* >>> v6586-cards-pagination-css */\n  .cards-page-start { scroll-margin-top: 140px; }\n  /* <<< v6586-cards-pagination-css */\n",
    "<style>\n"
  ]
];
