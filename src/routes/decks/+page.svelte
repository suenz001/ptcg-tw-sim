<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import type { Card, EnergyType } from '$lib/cards/types';
  import { getEvolutionChainNames, getEvolutionChainGrouped } from '$lib/cards/evolutionChain';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import { loadAllSets, loadIndex, buildCardIndex } from '$lib/cards/pool';
  import {
    loadDecks,
    upsertDeck,
    deleteDeck,
    newDeck
  } from '$lib/decks/storage';
  import { PRESET_DECKS, PRESET_IDS } from '$lib/decks/presets';
  import type { Deck } from '$lib/decks/types';
  import { validateDeck, maxCopies, isBasicEnergy, isAceSpec, aceSpecCount, sameNameTotal, remainingCapacity } from '$lib/decks/validation';
  import { syncDeckToCloud, removeDeckFromCloud, loadDecksFromCloud } from '$lib/decks/cloud';
  import { loadFavorites, saveFavorites } from '$lib/decks/favorites';
  import { saveFavoritesToCloud, loadFavoritesFromCloud } from '$lib/decks/favoritesCloud';
  import { VERSION } from '$lib/version';
  import { auth } from '$lib/firebase';
  import {
    signInAnonymously,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    linkWithCredential,
    EmailAuthProvider,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    updatePassword,
    reauthenticateWithCredential,
    type User
  } from 'firebase/auth';

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
  // v5.114：dirty tracking — 牌組編輯後標 dirty，等手動「💾 存檔」才推 cloud
  //   取代 v5.078/v5.092 的自動 debounce push（每次編輯都 setDoc）。
  //   預期 1h decks writes 從 ~500-800 降到 ~6（按玩家手動存檔頻率）。
  //   防丟資料：localStorage 既有 saveDecks 同步寫；beforeunload dirty 才警告。
  let dirtyDeckIds = $state<Set<string>>(new Set());
  let syncError = $state<string | null>(null);

  // ── Auth modal state ───────────────────────────────────────────────────
  let showAuthModal = $state(false);
  let authTab = $state<'upgrade' | 'login'>('upgrade');
  let authEmail = $state('');
  let authPassword = $state('');
  let authError = $state<string | null>(null);
  let authLoading = $state(false);

  // v3.92 忘記密碼（login tab 內 toggle 切換）
  let forgotMode = $state(false);
  let resetEmailSent = $state(false);

  // v3.92 更改密碼 modal（已登入用戶）
  let showChangePasswordModal = $state(false);
  let cpOldPassword = $state('');
  let cpNewPassword = $state('');
  let cpNewPasswordConfirm = $state('');
  let cpError = $state<string | null>(null);
  let cpSuccess = $state(false);
  let cpLoading = $state(false);

  const isAnonymous = $derived(firebaseUser?.isAnonymous ?? true);

  // ── UI state ───────────────────────────────────────────────────────────
  let search = $state('');
  let searchMode = $state<'normal' | 'keyword' | 'evolution'>('normal');
  // v4.954：keyword 模式下進一步限定搜尋範圍
  //   all       — 全文（同舊 keyword 行為）
  //   attacks   — 只搜招式（name + effect）
  //   abilities — 只搜特性（label + name + effect）
  let keywordScope = $state<'all' | 'attacks' | 'abilities'>('all');
  let setFilter = $state<string>('');
  let pickerPreview = $state<Card | null>(null);

  // v5.315: deck list 拖曳排序 — 改由 ⠿ 把手觸發 (按其他地方一般 click/scroll)
  //   - pointerdown on ⠿ → 立刻啟動 drag mode + setPointerCapture (lift 視覺)
  //   - pointermove → translateY 跟手指 + 算 hover (用 window listener 避免 lifted li
  //     pointer-events:none 阻擋 events 造成 stuck)
  //   - pointerup / pointercancel → commit swap + cleanup (window listener 確保 always fire)
  let dragDeckId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  let dragOverPlacement = $state<'before' | 'after'>('before');  // v5.316: 拖到 target 上半 → 插之前, 下半 → 插之後
  let dragDeltaY = $state(0);
  let _dragStartY = 0;
  let _dragPointerId: number | null = null;
  let _dragHandleEl: HTMLElement | null = null;  // 給 cleanup releasePointerCapture
  let _dragMoveHandler: ((e: PointerEvent) => void) | null = null;
  let _dragUpHandler: ((e: PointerEvent) => void) | null = null;

  function _cleanupDrag() {
    if (_dragHandleEl && _dragPointerId !== null) {
      try { _dragHandleEl.releasePointerCapture(_dragPointerId); } catch { /* */ }
    }
    if (_dragMoveHandler) {
      window.removeEventListener('pointermove', _dragMoveHandler);
      window.removeEventListener('pointerup', _dragUpHandler!);
      window.removeEventListener('pointercancel', _dragUpHandler!);
    }
    _dragMoveHandler = null; _dragUpHandler = null;
    _dragHandleEl = null; _dragPointerId = null;
    dragDeckId = null; dragOverId = null; dragDeltaY = 0;
    dragOverPlacement = 'before';
  }

  function onDragHandlePointerDown(e: PointerEvent, deckId: string) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();  // 阻止 ⠿ 觸發 page scroll / text selection
    e.stopPropagation();  // 不冒泡到 li 的 deck-pick click
    _dragStartY = e.clientY;
    _dragPointerId = e.pointerId;
    _dragHandleEl = e.currentTarget as HTMLElement;
    dragDeckId = deckId;
    dragDeltaY = 0;
    // setPointerCapture 在 handle 上 — 後續 events 強制 routed to handle
    try { _dragHandleEl.setPointerCapture(e.pointerId); } catch { /* */ }
    // 觸覺回饋
    try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15); } catch { /* */ }
    // window-level listeners 確保即使 lifted li pointer-events:none 也能收 move/up
    _dragMoveHandler = (ev: PointerEvent) => {
      if (ev.pointerId !== _dragPointerId) return;
      ev.preventDefault();
      dragDeltaY = ev.clientY - _dragStartY;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const li = el?.closest('li[data-deckid]') as HTMLElement | null;
      const overId = li?.dataset.deckid ?? null;
      // v5.316: 排除 self (lifted li 雖 pointer-events:none, 但保險). 上下半部判定 placement.
      if (overId && overId !== dragDeckId && li) {
        const rect = li.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        dragOverPlacement = ev.clientY < midpoint ? 'before' : 'after';
        dragOverId = overId;
      }
      // else: keep last dragOverId (玩家若 hover 回 lifted 自己, 不更新)
    };
    _dragUpHandler = (ev: PointerEvent) => {
      if (ev.pointerId !== _dragPointerId) return;
      // v5.316: commit swap — 用 placement (before/after) 決定插入位置
      if (dragDeckId && dragOverId && dragDeckId !== dragOverId) {
        const arr = [...decks];
        const from = arr.findIndex(d => d.id === dragDeckId);
        const to = arr.findIndex(d => d.id === dragOverId);
        if (from >= 0 && to >= 0) {
          const [moved] = arr.splice(from, 1);
          // 修正 to index — 若 from < to, 移除後 to 變 to-1
          let insertIdx = from < to ? to - 1 : to;
          if (dragOverPlacement === 'after') insertIdx += 1;
          // clamp
          insertIdx = Math.max(0, Math.min(arr.length, insertIdx));
          arr.splice(insertIdx, 0, moved);
          decks = arr;
          saveDecks(arr);
        }
      }
      _cleanupDrag();
    };
    window.addEventListener('pointermove', _dragMoveHandler, { passive: false });
    window.addEventListener('pointerup', _dragUpHandler);
    window.addEventListener('pointercancel', _dragUpHandler);
  }

  // v5.310: 常用卡牌 (favorites) state — 本地 localStorage, 手動雲端同步
  let favorites = $state<Set<string>>(loadFavorites());
  let favoritesOnly = $state<boolean>(false);  // filter chip toggle
  function isFavorite(cardId: string): boolean { return favorites.has(cardId); }
  function toggleFavorite(cardId: string): void {
    const next = new Set(favorites);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    favorites = next;  // Svelte 5: 重新賦值觸發 reactivity
    saveFavorites(next);
  }
  async function saveFavoritesCloud() {
    if (!firebaseUser) { alert('請先登入才能將常用卡牌存到雲端'); return; }
    try {
      await withTimeout(saveFavoritesToCloud(firebaseUser.uid, favorites));
      alert(`已將 ${favorites.size} 張常用卡牌存到雲端`);
    } catch (e) {
      alert('雲端存檔失敗：' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function loadFavoritesCloud() {
    if (!firebaseUser) { alert('請先登入才能從雲端讀取常用卡牌'); return; }
    if (!confirm('確定要從雲端重新讀取常用卡牌嗎？目前本地未存檔的變更將被覆蓋。')) return;
    try {
      const cloud = await withTimeout(loadFavoritesFromCloud(firebaseUser.uid));
      favorites = cloud;
      saveFavorites(cloud);
      alert(`已從雲端載入 ${cloud.size} 張常用卡牌`);
    } catch (e) {
      alert('雲端讀取失敗：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // ── Category filter (chip multi-select) ────────────────────────────────
  type CategoryKey = 'Pokemon' | 'Supporter' | 'Item' | 'Tool' | 'Stadium' | 'BasicEnergy' | 'SpecialEnergy';
  const CATEGORY_LABEL: Record<CategoryKey, string> = {
    Pokemon: '寶可夢', Supporter: '支援者', Item: '物品',
    Tool: '寶可夢道具', Stadium: '競技場',
    BasicEnergy: '基本能量', SpecialEnergy: '特殊能量'
  };
  const CATEGORY_ORDER: CategoryKey[] = ['Pokemon', 'Supporter', 'Item', 'Tool', 'Stadium', 'BasicEnergy', 'SpecialEnergy'];
  let selectedCategories = $state<Set<CategoryKey>>(new Set());

  function cardCategory(c: Card): CategoryKey {
    if (c.supertype === 'Energy') return c.subtype === 'Basic' ? 'BasicEnergy' : 'SpecialEnergy';
    if (c.supertype === 'Pokemon') return 'Pokemon';
    if (c.subtype === 'PokemonTool') return 'Tool';
    if (c.subtype === 'Supporter') return 'Supporter';
    if (c.subtype === 'Stadium') return 'Stadium';
    return 'Item';
  }
  function toggleCategory(cat: CategoryKey) {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    selectedCategories = next;
  }
  function clearCategories() { selectedCategories = new Set(); }

  // ── Tag filter ─────────────────────────────────────────────────────────
  type TagKey = 'ACE SPEC' | '古代' | '未來' | '太晶' | '超級進化' | '訓練家冠名';
  const TAG_ORDER: TagKey[] = ['ACE SPEC', '古代', '未來', '太晶', '超級進化', '訓練家冠名'];
  let selectedTags = $state<Set<TagKey>>(new Set());

  function isMegaEx(c: Card): boolean {
    return c.supertype === 'Pokemon' && c.subtype === 'ex' && c.name.startsWith('超級');
  }
  function hasTag(c: Card, tag: TagKey): boolean {
    if (tag === '超級進化') return isMegaEx(c);
    return (c.tags ?? []).includes(tag);
  }
  function toggleTag(tag: TagKey) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    selectedTags = next;
  }
  function clearTags() { selectedTags = new Set(); }

  // ── Type filter ────────────────────────────────────────────────────────
  const ENERGY_ORDER: EnergyType[] = [
    'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
    'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'
  ];
  let selectedTypes = $state<Set<EnergyType>>(new Set());

  const ALL_TYPES: EnergyType[] = ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Colorless'];
  const ENERGY_TYPE_MAP: Record<string, EnergyType[]> = {
    '基本【草】能量': ['Grass'], '基本【火】能量': ['Fire'],
    '基本【水】能量': ['Water'], '基本【雷】能量': ['Lightning'],
    '基本【超】能量': ['Psychic'], '基本【鬥】能量': ['Fighting'],
    '基本【惡】能量': ['Darkness'], '基本【鋼】能量': ['Metal'],
    '古舊能量': ALL_TYPES, '夜光能量': ALL_TYPES, '新衝天能量': ALL_TYPES, '稜鏡能量': ALL_TYPES,
    '增強【草】能量': ['Grass','Colorless'], '燃料【火】能量': ['Fire','Colorless'],
    '泡沫【水】能量': ['Water','Colorless'], '感應【超】能量': ['Psychic','Colorless'],
    '硬岩【鬥】能量': ['Fighting','Colorless'], '磁鐵【鋼】能量': ['Metal','Colorless'],
    // v5.065：閃電【雷】、暗影【惡】（之前漏加，牌組編輯器篩選找不到）
    '伏特【雷】能量': ['Lightning','Colorless'], '暗影【惡】能量': ['Darkness','Colorless'],
    '火箭隊能量': ['Psychic','Darkness'],
    '富裕能量': ['Colorless'], '燃火能量': ['Colorless'], '噴射能量': ['Colorless'],
    '回力鏢能量': ['Colorless'], '扣殺能量': ['Colorless'], '薄霧能量': ['Colorless'],
  };
  function cardTypes(c: Card): EnergyType[] {
    if (c.pokemonType) return [c.pokemonType];
    if (c.supertype === 'Energy') return ENERGY_TYPE_MAP[c.name] ?? ['Colorless'];
    return [];
  }
  function toggleType(t: EnergyType) {
    const next = new Set(selectedTypes);
    if (next.has(t)) next.delete(t); else next.add(t);
    selectedTypes = next;
  }
  function clearTypes() { selectedTypes = new Set(); }

  // ── Stage filter ───────────────────────────────────────────────────────
  type StageKey = 'Basic' | 'Stage1' | 'Stage2';
  const STAGE_LABEL: Record<StageKey, string> = { Basic: '基礎', Stage1: '1階進化', Stage2: '2階進化' };
  const STAGE_ORDER: StageKey[] = ['Basic', 'Stage1', 'Stage2'];
  let selectedStages = $state<Set<StageKey>>(new Set());

  function cardStage(c: Card): StageKey | null {
    if (c.supertype !== 'Pokemon') return null;
    if (c.stage) return c.stage;
    if (c.subtype === 'Basic') return 'Basic';
    if (c.subtype === 'Stage1') return 'Stage1';
    if (c.subtype === 'Stage2') return 'Stage2';
    return c.evolvesFrom ? 'Stage1' : 'Basic';
  }
  function toggleStage(s: StageKey) {
    const next = new Set(selectedStages);
    if (next.has(s)) next.delete(s); else next.add(s);
    selectedStages = next;
  }
  function clearStages() { selectedStages = new Set(); }

  // ── Regulation mark filter ─────────────────────────────────────────────
  type RegMarkKey = 'H' | 'I' | 'J';
  const REG_MARK_ORDER: RegMarkKey[] = ['H', 'I', 'J'];
  // v4.9：預設選 H/I/J 三個（標準賽全範圍），玩家可自行點選縮小範圍
  let selectedRegMarks = $state<Set<RegMarkKey>>(new Set(['H', 'I', 'J']));
  function toggleRegMark(m: RegMarkKey) {
    const next = new Set(selectedRegMarks);
    if (next.has(m)) next.delete(m); else next.add(m);
    selectedRegMarks = next;
  }
  function clearRegMarks() { selectedRegMarks = new Set(); }
  // v2.129 全螢幕卡牌放大 — 鏡射 /cards lightbox：preview 內點圖即放大；列表 thumb 也可直接放大
  let lightboxUrl = $state<string | null>(null);
  function openLightbox(url: string) { lightboxUrl = url; }
  function closeLightbox() { lightboxUrl = null; }

  // Text format modal
  let showTextModal = $state(false);
  let textModalMode = $state<'export' | 'import'>('export');
  let importTextInput = $state('');

  // v4.970：官網代碼匯入 loading flag
  let twCodeImportLoading = $state(false);

  // v4.973：官網代碼匯出 loading flag + 上次匯出代碼（顯示在 button 旁方便玩家複製）
  let twCodeExportLoading = $state(false);

  // v4.974：匯出結果 modal — 取代 alert，玩家可方便複製代碼 / 開官網連結
  let showExportCodeModal = $state(false);
  let exportedDeckCode = $state('');
  let exportedTotalKinds = $state(0);
  let exportedTotalCards = $state(0);
  // copy flag 三態：'idle'(尚未複製) / 'copied'(成功) / 'failed'(瀏覽器拒絕)
  let exportCopyFlag = $state<'idle' | 'copied' | 'failed'>('idle');

  // v4.91：匯出圖片功能 state
  let exportingImage = $state(false);
  let exportImageError = $state('');

  // ── Derived ────────────────────────────────────────────────────────────
  // v2.13：支援檢視內建預組（唯讀）。activeId 先找使用者牌組，再退回預組。
  const active = $derived(
    decks.find((d) => d.id === activeId)
    ?? PRESET_DECKS.find((d) => d.id === activeId)
    ?? null
  );
  /** 目前檢視的是否為內建預組 —— true 時編輯器鎖定為唯讀 */
  const isPresetActive = $derived(!!activeId && PRESET_IDS.has(activeId));

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

  /** 目前 active 牌組的 ACE SPEC 總張數（跨卡名）。UI 用來禁用 + 按鈕。 */
  const activeAceSpecCount = $derived(active ? aceSpecCount(active, poolById) : 0);

  /** 在 list / modal 的「+」按鈕決定是否禁用（已達 ACE SPEC 限額 + 非同一張）。 */
  function aceSpecBlocked(card: Card): boolean {
    if (!isAceSpec(card)) return false;
    if (activeAceSpecCount <= 0) return false;
    // 已經是這張 ACE SPEC 本身 → 由 maxCopies=1 的 pvCount >= pvMax 負責擋；不重複擋。
    const already = active?.entries.find((e) => e.cardId === card.id);
    return !already || already.count <= 0;
  }

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

  // v4.987: 進化鏈名字 cache — 在搜尋字串 / mode / pool 變動時重算，filter 內 O(1) lookup
  const chainNames = $derived.by(() => {
    if (searchMode !== 'evolution') return new Set<string>();
    const q = search.trim();
    if (!q) return new Set<string>();
    return getEvolutionChainNames(q, pool);
  });
  const filteredPool = $derived.by(() => {
    if (!poolReady) return [] as Card[];
    const q = search.trim().toLowerCase();
    const cats = selectedCategories;
    const tags = selectedTags;
    const types = selectedTypes;
    const stages = selectedStages;
    const marks = selectedRegMarks;
    return pool.filter((c) => {
      // Category chip filter
      if (cats.size > 0 && !cats.has(cardCategory(c))) return false;
      // Tag chip filter (OR)
      if (tags.size > 0) {
        let any = false;
        for (const t of tags) { if (hasTag(c, t)) { any = true; break; } }
        if (!any) return false;
      }
      // Type chip filter (OR)
      if (types.size > 0) {
        const ct = cardTypes(c);
        if (ct.length === 0 || !ct.some(t => types.has(t))) return false;
      }
      // Stage chip filter (OR)
      if (stages.size > 0) {
        const stage = cardStage(c);
        if (!stage || !stages.has(stage)) return false;
      }
      // Regulation mark chip filter (OR)
      if (marks.size > 0) {
        if (!c.regulationMark || !marks.has(c.regulationMark as RegMarkKey)) return false;
      }
      // Set filter (dropdown)
      if (setFilter && c.setCode !== setFilter) return false;
      // v5.310: 常用卡牌篩選 (chip toggle)
      if (favoritesOnly && !favorites.has(c.id)) return false;
      // Search
      if (!q) return true;
      // v4.987: 進化鏈搜尋模式 — 輸入名字顯示整條進化鏈
      if (searchMode === 'evolution') {
        return chainNames.has(c.name);
      }
      // v4.954：keyword 模式下依 keywordScope 細分搜尋範圍
      if (searchMode === 'keyword') {
        let haystack: string[];
        if (keywordScope === 'attacks') {
          haystack = (c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']);
        } else if (keywordScope === 'abilities') {
          haystack = (c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']);
        } else {
          // 'all' — 原 keyword 全文搜尋行為
          haystack = [
            c.name, c.collectorNumber, c.evolvesFrom ?? '', c.rulesText ?? '',
            ...(c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']),
            ...(c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']),
          ];
        }
        return haystack.some(s => s && s.toLowerCase().includes(q));
      }
      return (
        c.name.toLowerCase().includes(q) ||
        c.collectorNumber.includes(q) ||
        (c.attacks ?? []).some((a) => a.name.toLowerCase().includes(q)) ||
        (c.abilities ?? []).some((a) => a.name.toLowerCase().includes(q))
      );
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

  // v5.078：actualPushDeck 是真正的 cloud setDoc 動作（被 pushDeck debounce 包覆）
  async function actualPushDeck(deck: Deck) {
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

  // v5.078 / v5.092：Firebase 寫入暴量元兇 — addCard/removeCard 每次都 setDoc。
  //   v5.078 加 1.5s debounce 後仍高（1h ~2000 writes，~1900 是 decks）。
  //   v5.092（Wilson 選 5s）：
  //     (1) PUSH_DEBOUNCE_MS 1500 → 5000ms（更激進 debounce — 連續編輯 5s 內所有變更合併成 1 個 setDoc）
  //     (2) 加 lastPushedSnapshot 比對 — JSON.stringify(deck) 跟上次寫入完全相同就 skip
  //         （防玩家 add→remove→add 同卡時 timer fire，內容沒實質變但仍誤寫；或頁面切換
  //          觸發 reactive 重算 deck 物件 ref 變但內容沒變）
  //   預期再減 70%+ deck 寫入。
  // 防丟資料：
  //   (a) addCard/removeCard 本就先寫 localStorage upsertDeck（同步）→ 重整頁面不丟
  //   (b) beforeunload event flush 所有 pending push 立即送出
  //   (c) 5s 內 reload → 從 local 還原
  const PUSH_DEBOUNCE_MS = 5000;  // v5.092: 1500 → 5000
  const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingPushes = new Map<string, Deck>();
  // v5.092: 紀錄每個 deck 上次成功推送的 snapshot（JSON 化），用於 dirty-check
  const lastPushedSnapshot = new Map<string, string>();

  function pushDeck(deck: Deck) {
    if (!firebaseUser) return;
    // v5.092 dirty-check：snapshot 跟上次成功推送完全一樣就 skip 整個排程
    //   注意：必須跟「上次成功推送」比，不能跟 pendingPushes 比 — 那是「下次要推」
    const snapshot = JSON.stringify(deck);
    if (lastPushedSnapshot.get(deck.id) === snapshot && !pushTimers.has(deck.id)) {
      // 沒 pending timer + 內容跟上次推送相同 → 完全不用動
      return;
    }
    // 取消舊 timer，存最新版本
    const existingTimer = pushTimers.get(deck.id);
    if (existingTimer) clearTimeout(existingTimer);
    pendingPushes.set(deck.id, deck);
    syncStatus = 'syncing';  // 立即顯示同步中（UI 反饋）
    const timer = setTimeout(() => {
      const finalDeck = pendingPushes.get(deck.id);
      pendingPushes.delete(deck.id);
      pushTimers.delete(deck.id);
      if (!finalDeck) return;
      // v5.092 dirty-check (二次)：timer fire 時 final snapshot 跟上次 push 比
      //   若玩家 add→remove 又 revert 回原狀 → 沒實質變更就 skip setDoc
      const finalSnapshot = JSON.stringify(finalDeck);
      if (lastPushedSnapshot.get(finalDeck.id) === finalSnapshot) {
        // 內容跟上次推送相同 — 直接 skip setDoc（避免無謂寫入）
        syncStatus = 'synced';
        return;
      }
      actualPushDeck(finalDeck).then(() => {
        // 推送成功才記 snapshot
        lastPushedSnapshot.set(finalDeck.id, finalSnapshot);
      }).catch(() => {
        // 失敗不 set snapshot — 下次仍會 push
      });
    }, PUSH_DEBOUNCE_MS);
    pushTimers.set(deck.id, timer);
  }

  // v5.114：setDirty — 取代 pushDeck 在編輯場景的呼叫。
  //   只標記為「待存檔」，不觸發 Firebase setDoc。玩家必須按「💾 存檔」才推 cloud。
  //   localStorage 仍同步寫（upsertDeck/saveDecks 是同步），重整頁面不丟。
  function setDirty(deckId: string) {
    if (!firebaseUser) return;  // 未登入無 cloud sync 概念
    if (dirtyDeckIds.has(deckId)) return;  // 已 dirty 不重複（避免 reactive 重渲染）
    dirtyDeckIds = new Set([...dirtyDeckIds, deckId]);
  }

  /** 立即執行所有 pending push（beforeunload / onDestroy 用）。
   *  v5.114 後：pushTimers 永遠空（編輯場景已改 setDirty），這個函式變成 no-op。
   *  保留以防將來想啟用 auto-push fallback。 */
  function flushPendingPushes() {
    for (const [deckId, timer] of pushTimers) {
      clearTimeout(timer);
      const deck = pendingPushes.get(deckId);
      if (deck) {
        // v5.092 dirty-check 也套用 — 內容沒變則 beforeunload 也跳過
        const snapshot = JSON.stringify(deck);
        if (lastPushedSnapshot.get(deckId) === snapshot) continue;
        // fire-and-forget — beforeunload 時可能等不到 await
        actualPushDeck(deck);
        lastPushedSnapshot.set(deckId, snapshot);
      }
    }
    pushTimers.clear();
    pendingPushes.clear();
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

  /** v5.114：手動存檔 — 只推 dirty 的牌組（不再 push all）。 */
  async function saveAllDecksToCloud() {
    if (!firebaseUser) { alert('尚未登入，無法存檔。'); return; }
    const dirtyList = decks.filter(d => dirtyDeckIds.has(d.id));
    if (dirtyList.length === 0) {
      alert('沒有需要存檔的變更。');
      return;
    }
    syncStatus = 'syncing';
    try {
      for (const d of dirtyList) {
        await withTimeout(syncDeckToCloud(firebaseUser.uid, d));
      }
      import('$lib/decks/storage').then(({ saveDecks }) => saveDecks(decks));
      dirtyDeckIds = new Set();  // 清空 dirty（紅點消失）
      syncStatus = 'synced';
      alert(`已存檔 ${dirtyList.length} 個牌組至雲端！`);
    } catch (e) {
      syncStatus = 'error';
      syncError = e instanceof Error ? e.message : String(e);
      alert('存檔失敗：' + syncError);
    }
  }

  /** Force reload all decks from Firebase (discard local changes). */
  async function loadAllDecksFromCloud() {
    if (!firebaseUser) { alert('尚未登入，無法讀取。'); return; }
    if (!confirm('確定要從雲端重新讀取牌組嗎？目前未存檔的本地變更將會被覆蓋。')) return;
    syncStatus = 'syncing';
    try {
      const cloud = await withTimeout(loadDecksFromCloud(firebaseUser.uid));
      if (cloud.length === 0) {
        alert('雲端目前沒有任何牌組資料。');
        syncStatus = 'synced';
        return;
      }
      decks = cloud.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      import('$lib/decks/storage').then(({ saveDecks }) => saveDecks(decks));
      activeId = decks[0]?.id ?? null;
      dirtyDeckIds = new Set();  // v5.114：cloud 已是 source of truth，清 dirty
      syncStatus = 'synced';
      alert(`已從雲端載入 ${cloud.length} 個牌組。`);
    } catch (e) {
      syncStatus = 'error';
      syncError = e instanceof Error ? e.message : String(e);
      alert('讀取失敗：' + syncError);
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
        // v4.985: 若 admin tab 已登入（localStorage 'ptcg_admin_active' flag），
        //   跳過匿名 sign-in — 等 IndexedDB 從 admin tab cross-tab sync 過來。
        //   避免覆蓋 admin user 導致 admin polling 拿到 anonymous token → 403。
        const isAdminActive = typeof window !== 'undefined'
          && !!localStorage.getItem('ptcg_admin_active');
        if (isAdminActive) return;
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
        setDirty(first.id);  // v5.114
        activeId = first.id;
      } else {
        activeId = decks[0].id;
      }
    });

    // v5.114：beforeunload 改成「未存檔 dirty 才警告離開」。
    //   原 v5.078 是 flush pending push（auto-debounce 時代）。改純手動後，dirty
    //   表示玩家編輯後沒按存檔；觸發瀏覽器原生「未儲存變更，確定離開？」prompt。
    //   localStorage 已 sync 寫過 → 重整不丟，僅警告 cloud 同步缺失。
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyDeckIds.size > 0) {
        e.preventDefault();
        e.returnValue = '';  // 瀏覽器顯示原生 prompt
        return '';
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      unsubAuth();
      // v5.078：cleanup — flush 待推 + 移除 beforeunload listener
      flushPendingPushes();
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    };
  });

  // ── Deck actions ───────────────────────────────────────────────────────
  function createDeck() {
    const d = newDeck(`牌組 ${decks.length + 1}`);
    decks = upsertDeck(d);
    activeId = d.id;
    setDirty(d.id);  // v5.114
  }

  function removeDeck(id: string) {
    if (!confirm('確定要刪除這個牌組嗎？')) return;
    decks = deleteDeck(id);
    if (activeId === id) activeId = decks[0]?.id ?? null;
    dropDeck(id);
  }

  function renameActive(name: string) {
    if (!active || isPresetActive) return;
    const updated = { ...active, name };
    decks = upsertDeck(updated);
    setDirty(updated.id);  // v5.114
  }

  function addCard(card: Card) {
    if (!active || isPresetActive) return;
    // v3.61：改用 remainingCapacity 統一處理 4 張同名 / ACE SPEC 1 張 / 基本能量無上限 三規則。
    //   key 點：同名 4 張上限是「跨版本累計」— 4 張呱呱泡蛙 SV5a 後再點 呱呱泡蛙 M4 也擋。
    //   ex / 非 ex / 超級進化 ex 因卡名不同（甲賀忍蛙 / 甲賀忍蛙ex / 超級甲賀忍蛙ex），各自獨立計 4 張。
    const remaining = remainingCapacity(active, card, poolById);
    if (remaining <= 0) {
      if (isAceSpec(card)) {
        alert('一副牌最多只能放 1 張 ACE SPEC 卡。');
      } else if (!isBasicEnergy(card)) {
        const total = sameNameTotal(active, card.name, poolById);
        alert(`同名卡片「${card.name}」已達 4 張上限（目前 ${total} 張，跨版本/招式累計）`);
      }
      return;
    }
    const entries = [...active.entries];
    const i = entries.findIndex((e) => e.cardId === card.id);
    const currentCount = i >= 0 ? entries[i].count : 0;
    if (i >= 0) entries[i] = { ...entries[i], count: currentCount + 1 };
    else entries.push({ cardId: card.id, count: 1 });
    const updated = { ...active, entries };
    decks = upsertDeck(updated);
    setDirty(updated.id);  // v5.114
  }

  function removeCard(cardId: string) {
    if (!active || isPresetActive) return;
    const entries = active.entries
      .map((e) => (e.cardId === cardId ? { ...e, count: e.count - 1 } : e))
      .filter((e) => e.count > 0);
    const updated = { ...active, entries };
    decks = upsertDeck(updated);
    setDirty(updated.id);  // v5.114
  }

  function clearDeck() {
    if (!active || isPresetActive) return;
    if (!confirm('清空此牌組？')) return;
    const updated = { ...active, entries: [] };
    decks = upsertDeck(updated);
    setDirty(updated.id);  // v5.114
  }

  /** 從內建預組複製一份到使用者牌組（可編輯） */
  function copyPresetToMine() {
    if (!active || !isPresetActive) return;
    const copy: Deck = {
      ...newDeck(`${active.name}（複製）`),
      entries: active.entries.map((e) => ({ ...e })),
      notes: active.notes,
    };
    decks = upsertDeck(copy);
    activeId = copy.id;
    setDirty(copy.id);  // v5.114
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
      setDirty(incoming.id);  // v5.114
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

  // v3.83: 控制 modal 內「📦 從官方訓練家網站匯入」摺疊區預設展開狀態
  //   讓主畫面「🔖 從官方匯入」按鈕能直接跳到那段，不要每次都要手動展開。
  let officialHelpOpen = $state(false);

  function openTextImport(opts?: { autoOpenOfficial?: boolean }) {
    importTextInput = '';
    textModalMode = 'import';
    officialHelpOpen = opts?.autoOpenOfficial ?? false;
    showTextModal = true;
  }

  // v3.83: 直接從主畫面開官方匯入 — 同 openTextImport 但自動展開書籤教學區
  function openOfficialImport() {
    openTextImport({ autoOpenOfficial: true });
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

  // ─── v4.91：匯出牌組為圖片 ───────────────────────────────────────────
  // 規格：純卡牌 grid（無文字資訊）、4:3 自適應比例、卡圖右下角黑底白字數量 badge。
  // 卡圖 CORS 失敗 → Promise.all reject → 中斷匯出 + 紅框錯誤訊息。
  // 卡片比例：PTCG 標準 63 × 88 mm → 245 × 342 px 維持 ≈ 63:88。
  function loadImageCORS(url: string): Promise<HTMLImageElement> {
    // v4.911：走 images.weserv.nl 圖片代理服務，回應永遠帶 Access-Control-Allow-Origin
    //   - asia.pokemon-card.com 不發 CORS header，直接 fetch 會被 canvas tainted
    //   - weserv.nl 是免費 image proxy，會 cache + 強制加 CORS header
    //   - URL 格式：images.weserv.nl/?url=<去掉 scheme 的目標 URL>
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`圖片載入失敗：${url}`));
      // 把 https://asia.pokemon-card.com/... 轉成 weserv proxy URL
      const stripped = url.replace(/^https?:\/\//, '');
      img.src = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}`;
    });
  }

  async function exportDeckAsImage() {
    if (!active || activeEntries.length === 0) return;
    exportingImage = true;
    exportImageError = '';
    try {
      const cardW = 245;
      const cardH = 342;
      const gap = 8;
      const targetAspect = 4 / 3;

      // 找最佳 grid：枚舉 rows 1~10，cols = ceil(N / rows)，比較 aspect 偏差
      const n = activeEntries.length;
      let bestRows = 1;
      let bestCols = n;
      let bestDiff = Infinity;
      for (let rows = 1; rows <= 10 && rows <= n; rows++) {
        const cols = Math.ceil(n / rows);
        const aspect = (cols * cardW) / (rows * cardH);
        const diff = Math.abs(aspect - targetAspect);
        if (diff < bestDiff) {
          bestRows = rows;
          bestCols = cols;
          bestDiff = diff;
        }
      }

      const canvasW = bestCols * cardW + gap * (bestCols + 1);
      const canvasH = bestRows * cardH + gap * (bestRows + 1);

      const images = await Promise.all(
        activeEntries.map(({ card }) => loadImageCORS(card.imageUrl))
      );

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context 取得失敗');

      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(0, 0, canvasW, canvasH);

      for (let i = 0; i < images.length; i++) {
        const r = Math.floor(i / bestCols);
        const c = i % bestCols;
        const x = gap + c * (cardW + gap);
        const y = gap + r * (cardH + gap);
        ctx.drawImage(images[i], x, y, cardW, cardH);

        const count = activeEntries[i].entry.count;
        const badgeW = 56;
        const badgeH = 56;
        const bx = x + cardW - badgeW - 8;
        const by = y + cardH - badgeH - 8;
        const radius = 8;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.beginPath();
        ctx.moveTo(bx + radius, by);
        ctx.lineTo(bx + badgeW - radius, by);
        ctx.quadraticCurveTo(bx + badgeW, by, bx + badgeW, by + radius);
        ctx.lineTo(bx + badgeW, by + badgeH - radius);
        ctx.quadraticCurveTo(bx + badgeW, by + badgeH, bx + badgeW - radius, by + badgeH);
        ctx.lineTo(bx + radius, by + badgeH);
        ctx.quadraticCurveTo(bx, by + badgeH, bx, by + badgeH - radius);
        ctx.lineTo(bx, by + radius);
        ctx.quadraticCurveTo(bx, by, bx + radius, by);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(count), bx + badgeW / 2, by + badgeH / 2 + 2);
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('Canvas 轉 PNG 失敗（CORS 汙染 canvas）');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${active.name || 'deck'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      exportImageError = e instanceof Error ? e.message : String(e);
    } finally {
      exportingImage = false;
    }
  }


  // v4.970：從台灣官網牌組代碼匯入（XXXXXX-XXXXXX-XXXXXX 格式）
  //   流程：prompt 輸入代碼 → fetch Oracle backend /api/decode-tw-deck/:code
  //   → backend 爬官網 deck-build/recipe/{code}/ HTML → 解析 60 張牌
  //   → client 用 cardId 對應，fallback setCode+collectorNumber
  async function importFromTwOfficialCode(): Promise<void> {
    if (twCodeImportLoading) return;
    if (!active) { alert('請先建立或選擇一個牌組'); return; }
    if (active.preset) { alert('內建牌組不可覆寫，請先複製到我的牌組再匯入'); return; }
    const code = (window.prompt('貼上台灣官網牌組代碼\n（格式：XXXXXX-XXXXXX-XXXXXX，例如 BYkvfk-zjikXf-SGtfpc）') ?? '').trim();
    if (!code) return;
    if (!/^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/.test(code)) {
      alert('代碼格式錯誤！正確格式：XXXXXX-XXXXXX-XXXXXX（3 段，每段 6 個英數字）');
      return;
    }
    const apiUrl = (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
    if (!apiUrl) {
      alert('Oracle API 未設定 — 此功能僅在 Oracle 站台 (www.ptcg-tw-sim.com) 可用');
      return;
    }
    twCodeImportLoading = true;
    try {
      const r = await fetch(`${apiUrl}/api/decode-tw-deck/${code}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        alert(`匯入失敗：${err.error || r.statusText}`);
        return;
      }
      const data = await r.json() as { code: string; entries: Array<{ cardId: string; name: string; setCode: string | null; collectorNumber: string | null; count: number }>; cached?: boolean };
      if (!data.entries || data.entries.length === 0) {
        alert('官網回傳空牌組，代碼可能無效');
        return;
      }
      // 對應到本地 pool — 先 cardId direct match，再 setCode+collectorNumber fallback
      const matched: DeckEntry[] = [];
      const unmatched: string[] = [];
      for (const e of data.entries) {
        // v4.971 hotfix: pool 是 Card[] 沒 .get；用 poolById Map
        let card = poolById.get(e.cardId);
        if (!card && e.setCode && e.collectorNumber) {
          card = poolBySetNum.get(`${e.setCode}-${e.collectorNumber}`);
        }
        if (card) {
          matched.push({ cardId: card.id, count: e.count });
        } else {
          unmatched.push(`${e.name} (${e.setCode ?? '?'} ${e.collectorNumber ?? '?'} × ${e.count})`);
        }
      }
      if (matched.length === 0) {
        alert('全部卡片都無法對應到本站資料庫，可能官網收錄但我們未爬到的版本');
        return;
      }
      const proceed = unmatched.length === 0 || window.confirm(
        `成功對應 ${matched.length} 種，但有 ${unmatched.length} 種未對應：\n\n${unmatched.slice(0, 8).join('\n')}${unmatched.length > 8 ? `\n…（共 ${unmatched.length} 種）` : ''}\n\n是否繼續匯入已對應的部分？`
      );
      if (!proceed) return;
      // 更新 active deck — v4.972 hotfix: saveDecks 沒 module top-level import
      //   仿 line 374 pattern：dynamic import storage.saveDecks + pushDeck() cloud sync
      const updated = { ...active!, entries: matched, updatedAt: Date.now() };
      decks = decks.map(d => d.id === active!.id ? updated : d);
      import('$lib/decks/storage').then(({ saveDecks }) => saveDecks(decks));
      setDirty(updated.id);  // v5.114
      const totalCards = matched.reduce((s, e) => s + e.count, 0);
      const cachedNote = data.cached ? '（cache hit）' : '';
      alert(`✅ 從官網代碼 ${code} 匯入 ${matched.length} 種卡 / 共 ${totalCards} 張 ${cachedNote}`);
    } catch (e) {
      alert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      twCodeImportLoading = false;
    }
  }

  // v4.973：把 active deck 匯出為官網牌組代碼
  //   流程：confirm 警告 → POST /api/encode-tw-deck → server 端跑 3-step
  //   GET token → POST beforecheck/ → POST register/ → 拿到 deckCode
  //   注意：register/ 真正寫入官網 DB，因此 server 端 rate-limit 嚴 (3/min + 12/hr per IP)
  //   且 client 端先 confirm 警告玩家「會在官網永久留下這份牌組紀錄」。
  async function exportToTwOfficialCode(): Promise<void> {
    if (twCodeExportLoading) return;
    if (!active) { alert('請先選擇要匯出的牌組'); return; }
    if (activeEntries.length === 0) { alert('牌組空白，無法匯出'); return; }
    const totalCards = activeEntries.reduce((s, x) => s + x.entry.count, 0);
    // 構造 entries — cardId 用我們系統的 id（= 官網 cardId，v4.970 已驗證），cardName 用繁中卡名
    const entries = activeEntries.map(({ entry, card }) => ({
      cardId: card.id,
      cardName: card.name,
      count: entry.count,
    }));
    // 警告 — 牌組會在官網 DB 永久留下紀錄
    const warnMsg = totalCards < 60
      ? `牌組目前 ${totalCards} 張（未滿 60），官網實測仍可發行但屬「非正規」狀態。\n\n按確定後會把此牌組永久發行到台灣官網，並回傳代碼。確定繼續嗎？`
      : `按確定後會把此牌組（${totalCards} 張）永久發行到台灣官網（每次匯出會產生新代碼），並回傳給你。\n\n確定繼續嗎？`;
    if (!window.confirm(warnMsg)) return;
    const apiUrl = (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
    if (!apiUrl) {
      alert('Oracle API 未設定 — 此功能僅在 Oracle 站台 (www.ptcg-tw-sim.com) 可用');
      return;
    }
    twCodeExportLoading = true;
    try {
      const r = await fetch(`${apiUrl}/api/encode-tw-deck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        alert(`匯出失敗：${err.error || r.statusText}`);
        return;
      }
      const data = await r.json() as { deckCode: string; totalKinds: number; totalCards: number };
      // v4.974: state 賽好後開 modal — modal 內可方便複製 / 開官網
      exportedDeckCode = data.deckCode;
      exportedTotalKinds = data.totalKinds;
      exportedTotalCards = data.totalCards;
      exportCopyFlag = 'idle';
      // 嘗試在 user-gesture 還有效的 callback 內自動複製（成功的話 modal 內按鈕就會顯示 ✓ 已複製）
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(data.deckCode);
          exportCopyFlag = 'copied';
        }
      } catch { /* ignore — 玩家可手動點 modal 內「複製」按鈕 */ }
      showExportCodeModal = true;
    } catch (e) {
      alert(`匯出失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      twCodeExportLoading = false;
    }
  }

  // v4.974: modal 內「複製」按鈕 — 玩家點下時必定在 user-gesture context，clipboard API 成功率高
  async function copyExportedCode() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(exportedDeckCode);
        exportCopyFlag = 'copied';
        // 2 秒後恢復 idle，讓玩家可重複複製（例如想分享多次）
        setTimeout(() => { if (exportCopyFlag === 'copied') exportCopyFlag = 'idle'; }, 2000);
        return;
      }
    } catch { /* fall through */ }
    // fallback: 用 textarea + execCommand('copy')（老瀏覽器 / 不安全 context）
    try {
      const ta = document.createElement('textarea');
      ta.value = exportedDeckCode;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      exportCopyFlag = ok ? 'copied' : 'failed';
      if (ok) setTimeout(() => { if (exportCopyFlag === 'copied') exportCopyFlag = 'idle'; }, 2000);
    } catch {
      exportCopyFlag = 'failed';
    }
  }

  function closeExportCodeModal() {
    showExportCodeModal = false;
  }

  function importFromText() {
    if (!importTextInput.trim()) return;

    const lines = importTextInput.split('\n');
    const entries: { cardId: string; count: number }[] = [];
    const errors: string[] = [];
    const ambiguities: { name: string; used: string; alternatives: string[] }[] = [];
    let deckName = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // Comment line: optional deck name
      if (line.startsWith('//') || line.startsWith('#')) {
        if (!deckName) deckName = line.replace(/^\/\/\s*|^#\s*/, '').trim();
        continue;
      }
      // Format C（最精確，bookmarklet 輸出）：{count} {name} #{cardId}
      const mId = line.match(/^(\d+)\s+(.+?)\s+#(\d+)$/);
      // Format A（完整）：{count} {name} {setCode} {collectorNumber}
      // v3.831: setCode 允許含 `-` — 修玩家回報「呱呱泡蛙 M-P-J 089/M-P」與
      //   「基本【水】能量 M-P-J 098/M-P」無法匯入。原 regex 是 [A-Za-z0-9]+ 不含 `-`，
      //   M-P-J / SV-P-I / SV-P-H 等 promo setCode 全 fall through 到簡易格式而失敗。
      const mFull = !mId ? line.match(/^(\d+)\s+(.+?)\s+([A-Za-z0-9-]+)\s+(\S+)$/) : null;
      // Format B（簡易）：{count} {name}  / {count}x{name}  / {count} × {name}
      const mSimple = (!mId && !mFull) ? line.match(/^(\d+)\s*[x×]?\s+(.+?)$/) : null;
      // v3.832 Format D（無張數的完整格式）：{name} {setCode} {collectorNumber}
      //   玩家從官方頁面或別處複製可能漏掉開頭張數。預設補 1 張並警示「請手動調整數量」。
      //   ※ 注意 order — mFull / mSimple 都失敗才走這條，避免吃到正常含張數的格式。
      const mNoCount = (!mId && !mFull && !mSimple) ? line.match(/^(.+?)\s+([A-Za-z0-9-]+)\s+(\S+)$/) : null;
      // v4.912 Format E（從 admin 對戰紀錄複製出來的格式）：
      //   「卡名 卡包代號 · 卡號 · 賽季 × 張數」（卡名在前，數量在尾，· 與 × 為 unique markers）
      //   例：「怨影娃娃 M5 · 031/081 · J × 2」「月月熊 赫月 ex SV5a · 052/066 · H × 1」
      //   regex 末尾的 ([GHIJ]) 限定賽季標籤避免吃到其他單字母。
      const mAdmin = (!mId && !mFull && !mSimple && !mNoCount)
        ? line.match(/^(.+)\s+(\S+)\s+·\s+(\S+)\s+·\s+([GHIJ])\s+×\s+(\d+)$/)
        : null;

      let card: Card | undefined;
      let countStr = '';
      let label = '';

      if (mId) {
        countStr = mId[1];
        const cardId = mId[3];
        const name = mId[2].trim();
        card = poolById.get(cardId);
        label = `${name} (id=${cardId})`;
        // Fallback：cardId 找不到（可能是標外卡或更早 set），改用同名卡替代
        if (!card) {
          const fallback = pool.find(c => c.name === name);
          if (fallback) {
            card = fallback;
            ambiguities.push({
              name,
              used: `${fallback.setCode} · ${fallback.collectorNumber} (自動替代)`,
              alternatives: [`原版本 id=${cardId} 不在 H/I/J 標池 — 若是基本能量或同名卡效果通常相同`],
            });
          }
        }
      } else if (mFull) {
        countStr = mFull[1];
        const setCode = mFull[3];
        const collectorNumber = mFull[4];
        card = poolBySetNum.get(`${setCode}-${collectorNumber}`);
        label = `${setCode} ${collectorNumber}`;
      } else if (mSimple) {
        countStr = mSimple[1];
        const name = mSimple[2].trim();
        label = name;
        // 依名稱精確匹配 — 若同名多張，記錄歧義，取第一張但警告
        const exact = pool.filter(c => c.name === name);
        if (exact.length === 0) {
          card = pool.find(c => c.name.includes(name));
        } else if (exact.length === 1) {
          card = exact[0];
        } else {
          // 多個版本：取第一張，並收集歧義提示
          card = exact[0];
          ambiguities.push({
            name,
            used: `${exact[0].setCode} · ${exact[0].collectorNumber}`,
            alternatives: exact.slice(1).map(c => `${c.setCode} · ${c.collectorNumber}`),
          });
        }
      } else if (mNoCount) {
        // v3.832: 無張數格式 — 預設 1 張 + 加 ambiguities 警示
        countStr = '1';
        const name = mNoCount[1].trim();
        const setCode = mNoCount[2];
        const collectorNumber = mNoCount[3];
        card = poolBySetNum.get(`${setCode}-${collectorNumber}`);
        label = `${setCode} ${collectorNumber}`;
        if (card) {
          ambiguities.push({
            name,
            used: `${card.setCode} · ${card.collectorNumber}（自動補 1 張）`,
            alternatives: [`原始輸入未指定張數 — 匯入後請手動調整數量`],
          });
        }
      } else if (mAdmin) {
        // v4.912: admin 對戰紀錄格式 — 用 (setCode, collectorNumber) 精準對到牌池
        // 找不到時 fall back 到名稱模糊匹配，避免少數版本差異卡到匯入流程
        const name = mAdmin[1].trim();
        const setCode = mAdmin[2];
        const collectorNumber = mAdmin[3];
        countStr = mAdmin[5];
        card = poolBySetNum.get(`${setCode}-${collectorNumber}`);
        label = `${setCode} ${collectorNumber}`;
        if (!card) {
          // fallback：同名取一張（與 Format B 行為一致）
          const exact = pool.filter(c => c.name === name);
          if (exact.length >= 1) {
            card = exact[0];
            ambiguities.push({
              name,
              used: `${card.setCode} · ${card.collectorNumber}（自動替代，原 ${setCode}-${collectorNumber} 不在牌池）`,
              alternatives: exact.slice(1).map(c => `${c.setCode} · ${c.collectorNumber}`),
            });
          }
        }
      } else {
        errors.push(`無法解析：「${line}」\n  → 每行需以「張數」開頭，例如：4 呱呱泡蛙 M-P-J 089/M-P`);
        continue;
      }

      if (!card) {
        errors.push(`找不到：${label}`);
        continue;
      }
      const count = Math.max(1, parseInt(countStr, 10));
      const existing = entries.find((e) => e.cardId === card!.id);
      if (existing) existing.count += count;
      else entries.push({ cardId: card.id, count });
    }

    // 歧義提示：同名多張時，告訴使用者匯入了哪張、還有哪些選擇
    if (ambiguities.length > 0) {
      const msg = `⚠ 以下 ${ambiguities.length} 張卡有多個版本，已自動取第一張：\n\n`
        + ambiguities.map(a =>
            `• ${a.name}\n   使用：${a.used}\n   其他版本：${a.alternatives.join(', ')}`
          ).join('\n\n')
        + `\n\n若要使用特定版本，請改用「卡名 #cardId」格式（建議從官方網站透過書籤列匯入，會自動帶 cardId）。\n\n要繼續匯入嗎？`;
      if (!confirm(msg)) return;
    }

    if (errors.length > 0) {
      const msg = `以下 ${errors.length} 張卡片找不到，是否繼續匯入其餘卡片？\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n…（共 ${errors.length} 筆）` : ''}`;
      if (!confirm(msg)) return;
    }
    if (entries.length === 0) { alert('沒有找到任何可匯入的卡片'); return; }

    const d = { ...newDeck(deckName || '匯入牌組'), entries };
    decks = upsertDeck(d);
    activeId = d.id;
    setDirty(d.id);  // v5.114
    showTextModal = false;
    importTextInput = '';
  }

  // ── Auth actions ───────────────────────────────────────────────────────
  function openAuthModal() {
    authTab = isAnonymous ? 'upgrade' : 'login';
    authEmail = '';
    authPassword = '';
    authError = null;
    showAuthModal = true;
  }

  /** 匿名帳號升級為 Email 帳號（保留現有 uid 與牌組） */
  async function upgradeAccount() {
    if (!authEmail || !authPassword) { authError = '請輸入 Email 和密碼'; return; }
    authLoading = true; authError = null;
    try {
      const credential = EmailAuthProvider.credential(authEmail, authPassword);
      await linkWithCredential(auth.currentUser!, credential);
      showAuthModal = false;
    } catch (e: any) {
      authError = friendlyAuthError(e.code);
    } finally { authLoading = false; }
  }

  /** 用 Email 登入（切換帳號，從雲端載入該帳號的牌組） */
  async function loginWithEmail() {
    if (!authEmail || !authPassword) { authError = '請輸入 Email 和密碼'; return; }
    authLoading = true; authError = null;
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      // onAuthStateChanged 會自動觸發，重新載入雲端牌組
      showAuthModal = false;
    } catch (e: any) {
      authError = friendlyAuthError(e.code);
    } finally { authLoading = false; }
  }

  /** 登出（回到匿名狀態） */
  async function handleSignOut() {
    if (!confirm('確定登出？登出後將以匿名模式繼續使用。')) return;
    await signOut(auth);
    // onAuthStateChanged 會觸發並以匿名重新登入
  }

  // v3.92 忘記密碼：寄送 Firebase 重設信
  async function sendResetEmail() {
    if (!authEmail) { authError = '請輸入 Email'; return; }
    authLoading = true; authError = null; resetEmailSent = false;
    try {
      await sendPasswordResetEmail(auth, authEmail);
      resetEmailSent = true;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      authError = friendlyAuthError(code);
    } finally { authLoading = false; }
  }

  // v3.92 開啟更改密碼 modal（已登入且非匿名用戶）
  function openChangePasswordModal() {
    cpOldPassword = '';
    cpNewPassword = '';
    cpNewPasswordConfirm = '';
    cpError = null;
    cpSuccess = false;
    showChangePasswordModal = true;
  }

  // v3.92 送出更改密碼：reauthenticate 舊密碼 → updatePassword 新密碼
  async function submitChangePassword() {
    if (!cpOldPassword || !cpNewPassword) { cpError = '請輸入舊密碼與新密碼'; return; }
    if (cpNewPassword.length < 6) { cpError = '新密碼至少需要 6 個字元'; return; }
    if (cpNewPassword !== cpNewPasswordConfirm) { cpError = '兩次輸入的新密碼不一致'; return; }
    const user = auth.currentUser;
    if (!user || !user.email) { cpError = '未登入或非 Email 帳號'; return; }
    if (cpNewPassword === cpOldPassword) { cpError = '新密碼不能與舊密碼相同'; return; }
    cpLoading = true; cpError = null;
    try {
      // 先用舊密碼 reauthenticate（Firebase 對敏感操作要求最近一次登入認證）
      const cred = EmailAuthProvider.credential(user.email, cpOldPassword);
      await reauthenticateWithCredential(user, cred);
      // 通過後 updatePassword
      await updatePassword(user, cpNewPassword);
      cpSuccess = true;
      cpOldPassword = '';
      cpNewPassword = '';
      cpNewPasswordConfirm = '';
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      cpError = friendlyAuthError(code);
    } finally { cpLoading = false; }
  }

  function friendlyAuthError(code: string): string {
    const map: Record<string, string> = {
      'auth/email-already-in-use': '此 Email 已被其他帳號使用',
      'auth/invalid-email': 'Email 格式不正確',
      'auth/weak-password': '密碼至少需要 6 個字元',
      'auth/wrong-password': '密碼錯誤',
      'auth/user-not-found': '找不到此 Email 的帳號',
      'auth/too-many-requests': '嘗試次數過多，請稍後再試',
      'auth/credential-already-in-use': '此帳號已存在，請直接登入',
      'auth/invalid-credential': '帳號或密碼錯誤',
      'auth/requires-recent-login': '此操作需要最近一次登入認證，請重新登入後再試',
      'auth/missing-email': '請輸入 Email',
      'auth/network-request-failed': '網路連線失敗，請檢查網路後重試',
    };
    return map[code] ?? `操作失敗（${code}）`;
  }

  // ── Card preview ───────────────────────────────────────────────────────
  function openPreview(card: Card) { pickerPreview = card; }
  function closePreview() { pickerPreview = null; }
  // v4.988: modal 內進化鏈 click 切換 preview 到該名字第一張卡
  function switchPreviewToName(name: string) {
    const card = pool.find(c => c.name === name);
    if (card) pickerPreview = card;
  }
  // v4.988: 目前預覽卡的進化鏈分階
  const previewChain = $derived.by(() => {
    if (!pickerPreview || pickerPreview.supertype !== 'Pokemon') return [];
    return getEvolutionChainGrouped(pickerPreview.name, pool);
  });
  // v4.989: 目前預覽卡的所有同名變體（不同 setCode/collectorNumber 的版本）
  const sameNameVariants = $derived.by(() => {
    if (!pickerPreview) return [] as Card[];
    return pool.filter(c => c.name === pickerPreview!.name);
  });
  // v4.989: 在同名變體之間 cycle（左右導航按鈕 + 鍵盤 ←/→ 共用）
  function cycleVariant(dir: 1 | -1) {
    if (!pickerPreview) return;
    if (sameNameVariants.length <= 1) return;
    const idx = sameNameVariants.findIndex(c => c.id === pickerPreview!.id);
    if (idx < 0) return;
    const newIdx = (idx + dir + sameNameVariants.length) % sameNameVariants.length;
    pickerPreview = sameNameVariants[newIdx];
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // v2.129：先關 lightbox，再關 preview（疊加狀態）
      if (lightboxUrl) { closeLightbox(); return; }
      closePreview();
      return;
    }
    // v4.989: modal 開且 lightbox 未開時，←/→ cycle 同名變體
    if (pickerPreview && !lightboxUrl) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVariant(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); cycleVariant(1); }
    }
  }

  // Sum of the active deck, used for the running count in the header.
  const totalCount = $derived(
    active ? active.entries.reduce((n, e) => n + e.count, 0) : 0
  );

  // Entries paired with their Card for display. Filter out unresolved ids.
  // v3.35：把 typeof active.entries[number] 抽出 type alias，避免在 narrow 後的 type-position
  // 仍因「type expression 不走 control-flow narrowing」被 ts 警告 active 可能 null。
  const activeEntries = $derived.by(() => {
    type DeckEntry = { cardId: string; count: number };
    if (!active) return [] as { entry: DeckEntry; card: Card }[];
    const result: { entry: DeckEntry; card: Card }[] = [];
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
    <h1>牌組編輯器 <span class="version-tag">v{VERSION}</span></h1>
    <span class="hint">Standard · H / I / J 標</span>
    <span class="sync-pill sync-{dirtyDeckIds.size > 0 ? 'unsaved' : syncStatus}" title={dirtyDeckIds.size > 0 ? `有 ${dirtyDeckIds.size} 個牌組未存檔（按 💾 存檔 推到雲端）` : (syncStatus === 'error' ? (syncError ?? '雲端連線失敗') : '')}>
      {#if dirtyDeckIds.size > 0}📝 未存檔 ({dirtyDeckIds.size}){:else if syncStatus === 'syncing'}⏳ 同步中{:else if syncStatus === 'synced'}☁️ 已同步{:else if syncStatus === 'error'}⚠️ 離線（hover 看原因）{:else}⬜ 本機{/if}
    </span>
    <!-- Auth status -->
    {#if firebaseUser}
      {#if isAnonymous}
        <button class="auth-btn anon" onclick={openAuthModal} title="建立帳號以跨裝置保存牌組">
          👤 匿名　<span class="auth-sub">建立帳號</span>
        </button>
      {:else}
        <div class="auth-user">
          <span class="auth-email">✉️ {firebaseUser.email}</span>
          <button class="small" onclick={openChangePasswordModal} title="更改密碼">🔑 更改密碼</button>
          <button class="small danger" onclick={handleSignOut}>登出</button>
        </div>
      {/if}
    {/if}
  </header>

  {#if poolError}
    <p class="error">載入卡池失敗：{poolError}</p>
  {/if}

  <div class="layout">
    <!-- ── Deck list (left rail) ────────────────────────────────────── -->
    <aside class="rail">
      <div class="rail-head">
        <strong>我的牌組</strong>
        <div class="rail-actions">
          <button class="small" onclick={createDeck}>+ 新增</button>
          <button class="small cloud-btn" class:has-dirty={dirtyDeckIds.size > 0} onclick={saveAllDecksToCloud} title={dirtyDeckIds.size > 0 ? `有 ${dirtyDeckIds.size} 個牌組待存檔` : '將變更存檔至雲端（無變更時無動作）'}>💾 存檔{#if dirtyDeckIds.size > 0} ●{/if}</button>
          <button class="small cloud-btn" onclick={loadAllDecksFromCloud} title="從雲端重新讀取牌組">📥 讀取</button>
        </div>
        <!-- v5.310: 常用卡牌雲端同步 (跟 deck cloud 同 UX 手動 💾/📥) -->
        <div class="rail-actions" style="margin-top:.3rem;">
          <span style="font-size:.7rem;color:#aaffcc;">⭐ 常用 ({favorites.size})</span>
          <button class="small cloud-btn" onclick={saveFavoritesCloud}
            title="將本地常用卡牌存檔至雲端">💾 存檔</button>
          <button class="small cloud-btn" onclick={loadFavoritesCloud}
            title="從雲端重新讀取常用卡牌">📥 讀取</button>
        </div>
      </div>
      <ul class="deck-list">
        {#each decks as d (d.id)}
          <li class:active={d.id === activeId}
              class:drag-source={dragDeckId === d.id}
              class:drag-over-before={dragDeckId !== null && dragOverId === d.id && dragDeckId !== d.id && dragOverPlacement === 'before'}
              class:drag-over-after={dragDeckId !== null && dragOverId === d.id && dragDeckId !== d.id && dragOverPlacement === 'after'}
              data-deckid={d.id}
              style={dragDeckId === d.id ? `transform: translateY(${dragDeltaY}px) scale(1.04);` : ''}>
            <!-- v5.315: 只有 ⠿ 把手能觸發拖曳, 其他地方一般 click/scroll -->
            <span class="deck-drag-handle" title="按住拖曳排序" aria-hidden="true"
              onpointerdown={(e) => onDragHandlePointerDown(e, d.id)}>⠿</span>
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

      <!-- v2.13：內建預組（唯讀檢視）；v4.983 改 <details> 預設摺疊 -->
      {#if PRESET_DECKS.length > 0}
        <details class="preset-section">
          <summary class="preset-summary">🎴 內建預組（唯讀）<span class="preset-count">{PRESET_DECKS.length} 套</span></summary>
        <ul class="deck-list preset-list">
          {#each PRESET_DECKS as d (d.id)}
            <li class:active={d.id === activeId}>
              <button class="deck-pick" onclick={() => (activeId = d.id)} title="檢視預組內容（點『複製』可改成自己的牌組）">
                <span class="deck-name">🔒 {d.name}</span>
                <span class="deck-size">
                  {d.entries.reduce((n, e) => n + e.count, 0)} / 60
                </span>
              </button>
            </li>
          {/each}
        </ul>
        </details>
      {/if}
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
            readonly={isPresetActive}
            title={isPresetActive ? '內建預組不可改名；請先複製一份' : ''}
          />
          <span class="count" class:bad={totalCount !== 60}>{totalCount} / 60</span>
          <div class="deck-actions">
            {#if isPresetActive}
              <span class="preset-badge" title="內建預組，僅供檢視">🔒 預組（唯讀）</span>
              <button class="small" onclick={copyPresetToMine}>📋 複製到我的牌組</button>
              <button class="small" onclick={openTextExport} disabled={!active || active.entries.length === 0}>🖼️ 匯出文字/圖片</button>
              <button class="small" onclick={exportJson}>💾 匯出 JSON</button>
            {:else}
              <button class="small" onclick={openTextExport} disabled={!active || active.entries.length === 0}>🖼️ 匯出文字/圖片</button>
              <button class="small" onclick={openTextImport} disabled={!poolReady} title="貼上 PTCG 文字格式（包含官方訓練家網站可透過下方書籤工具一鍵匯入）">📝 匯入文字</button>
              <!-- v3.83: 提供顯眼的官方匯入入口，避免玩家找不到（書籤教學原本藏在「匯入文字」modal 摺疊區內） -->
              <!-- v4.972：官網代碼匯入(🎫)取代了書籤工具流程，舊按鈕隱藏但保留 code -->
              <button class="small primary" hidden onclick={openOfficialImport} disabled={!poolReady} title="從官方訓練家網站一鍵匯入牌組（首次需設定書籤）">🔖 從官方匯入</button>
              <!-- v4.970：直接貼官網代碼匯入（XXXXXX-XXXXXX-XXXXXX 格式），透過 Oracle backend 爬解 -->
              <button class="small primary" onclick={importFromTwOfficialCode} disabled={!poolReady || twCodeImportLoading} title="貼上台灣官網牌組代碼（如 BYkvfk-zjikXf-SGtfpc）自動匯入">
                {twCodeImportLoading ? '⏳ 解析中…' : '🎫 官網代碼匯入'}
              </button>
              <!-- v4.973：匯出此牌組成官網代碼（會寫入官網 DB，client 端先 confirm 警告） -->
              <button class="small primary" onclick={exportToTwOfficialCode} disabled={!active || activeEntries.length === 0 || twCodeExportLoading} title="把此牌組發行到官方訓練家網站並取得分享代碼（會在官網永久留下紀錄）">
                {twCodeExportLoading ? '⏳ 發行中…' : '📤 匯出為官網代碼'}
              </button>
              <button class="small" onclick={exportJson}>💾 匯出 JSON</button>
              <label class="small file">
                📂 匯入 JSON
                <input type="file" accept="application/json" onchange={onFileChosen} />
              </label>
              <button class="small danger" onclick={clearDeck}>🗑️ 清空</button>
            {/if}
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
                  <button class="icon" onclick={() => removeCard(card.id)} disabled={isPresetActive}>−</button>
                  <span>{entry.count}</span>
                  <button
                    class="icon"
                    onclick={() => addCard(card)}
                    disabled={isPresetActive || (!isBasicEnergy(card) && entry.count >= 4)}
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
      <div class="pk-filters">
        <div class="pk-search-row">
          <input
            class="pk-search"
            placeholder={searchMode === 'normal'
              ? '搜尋卡名、招式名、特性名、卡號...'
              : keywordScope === 'attacks'
              ? '關鍵字搜尋招式名 / 招式效果敘述...'
              : keywordScope === 'abilities'
              ? '關鍵字搜尋特性名 / 特性效果敘述...'
              : '關鍵字搜尋（招式 + 特性 + 效果文字 + rules）...'}
            bind:value={search}
          />
          <!-- v4.954：單一 <select> 取代雙按鈕；4 選項涵蓋 一般 / 關鍵字-不限/招式/特性 -->
          <select
            class="pk-mode-select"
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
        <div class="pk-chip-row" role="group" aria-label="分類">
          <span class="pk-label">分類：</span>
          <button class="pk-chip" class:active={selectedCategories.size === 0}
            onclick={clearCategories}>全部</button>
          {#each CATEGORY_ORDER as cat (cat)}
            <button class="pk-chip" class:active={selectedCategories.has(cat)}
              onclick={() => toggleCategory(cat)}>{CATEGORY_LABEL[cat]}</button>
          {/each}
        </div>
        <div class="pk-chip-row" role="group" aria-label="標籤">
          <span class="pk-label">標籤：</span>
          <button class="pk-chip pk-chip-tag" class:active={selectedTags.size === 0}
            onclick={clearTags}>不限</button>
          {#each TAG_ORDER as tag (tag)}
            <button class="pk-chip pk-chip-tag" class:active={selectedTags.has(tag)}
              onclick={() => toggleTag(tag)}>{tag}</button>
          {/each}
        </div>
        <div class="pk-chip-row" role="group" aria-label="屬性">
          <span class="pk-label">屬性：</span>
          <button class="pk-chip pk-chip-type" class:active={selectedTypes.size === 0}
            onclick={clearTypes}>不限</button>
          {#each ENERGY_ORDER as etype (etype)}
            <button class="pk-chip pk-chip-type" class:active={selectedTypes.has(etype)}
              onclick={() => toggleType(etype)} style:--type-bg={ENERGY_COLOR[etype]}>
              <span class="pk-type-dot" style:background={ENERGY_COLOR[etype]}>{ENERGY_LABEL[etype]}</span>
            </button>
          {/each}
        </div>
        <div class="pk-chip-row" role="group" aria-label="階段">
          <span class="pk-label">階段：</span>
          <button class="pk-chip pk-chip-stage" class:active={selectedStages.size === 0}
            onclick={clearStages}>不限</button>
          {#each STAGE_ORDER as stg (stg)}
            <button class="pk-chip pk-chip-stage" class:active={selectedStages.has(stg)}
              onclick={() => toggleStage(stg)}>{STAGE_LABEL[stg]}</button>
          {/each}
        </div>
        <div class="pk-chip-row" role="group" aria-label="賽季">
          <span class="pk-label">賽季：</span>
          <button class="pk-chip pk-chip-mark" class:active={selectedRegMarks.size === 0}
            onclick={clearRegMarks}>不限</button>
          {#each REG_MARK_ORDER as m (m)}
            <button class="pk-chip pk-chip-mark" class:active={selectedRegMarks.has(m)}
              onclick={() => toggleRegMark(m)}>{m} 標</button>
          {/each}
        </div>
        <div class="pk-chip-row" role="group" aria-label="常用">
          <span class="pk-label">常用：</span>
          <button class="pk-chip pk-chip-fav" class:active={!favoritesOnly}
            onclick={() => favoritesOnly = false}>全部</button>
          <button class="pk-chip pk-chip-fav fav-only" class:active={favoritesOnly}
            onclick={() => favoritesOnly = true}>⭐ 只看常用（{favorites.size}）</button>
        </div>
        <div class="pk-chip-row">
          <span class="pk-label">卡包：</span>
          <select class="pk-set-select" bind:value={setFilter}>
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
              <!-- v5.312: ⭐ 常用按鈕移到 + 加入按鈕左邊 (Wilson 嫌右上角標擋圖) -->
              <button
                class="icon pick-fav-btn" class:active={isFavorite(card.id)}
                onclick={(e) => { e.stopPropagation(); toggleFavorite(card.id); }}
                title={isFavorite(card.id) ? '取消常用' : '標記為常用卡牌'}
                aria-label={isFavorite(card.id) ? '取消常用' : '標記常用'}>{isFavorite(card.id) ? '⭐' : '☆'}</button>
              <button
                class="icon add-btn"
                onclick={() => addCard(card)}
                title={isPresetActive ? '預組唯讀' : aceSpecBlocked(card) ? '一副牌最多 1 張 ACE SPEC' : '加入牌組'}
                disabled={isPresetActive || aceSpecBlocked(card)}>+</button>
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
  {@const pvSameName = active && !isBasicEnergy(pv) && !isAceSpec(pv) ? sameNameTotal(active, pv.name, poolById) : 0}
  {@const pvRemaining = active ? remainingCapacity(active, pv, poolById) : maxCopies(pv)}
  {@const pvMax = pvCount + (pvRemaining === Infinity ? 0 : pvRemaining)}
  <div class="pv-overlay" role="dialog" aria-modal="true" aria-label="卡片詳情"
    onclick={closePreview}>
    <div class="pv-inner" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={closePreview} aria-label="關閉">×</button>
      <!-- v4.989: 左右導航按鈕（同名變體 cycle）— 鍵盤 ←/→ 也可用 -->
      {#if sameNameVariants.length > 1}
        <button class="pv-nav pv-nav-prev" onclick={() => cycleVariant(-1)}
          aria-label="上一個版本" title="上一個版本（←）">‹</button>
        <button class="pv-nav pv-nav-next" onclick={() => cycleVariant(1)}
          aria-label="下一個版本" title="下一個版本（→）">›</button>
        <span class="pv-variant-counter">{sameNameVariants.findIndex(c => c.id === pv.id) + 1} / {sameNameVariants.length} 版本</span>
      {/if}

      <!-- Top: image + quick info -->
      <div class="pv-top">
        <button class="pv-img-btn" type="button" onclick={() => openLightbox(pv.imageUrl)} title="點擊放大">
          <img class="pv-img" src={pv.imageUrl} alt={pv.name} />
          <span class="pv-zoom-hint">🔍</span>
        </button>

        <div class="pv-info">
          <h2 class="pv-name">
            {pv.name}
            <!-- v5.310: 常用卡牌大星按鈕 -->
            <button class="pv-fav-btn" class:active={isFavorite(pv.id)}
              onclick={() => toggleFavorite(pv.id)}
              title={isFavorite(pv.id) ? '取消常用' : '加入常用卡牌'}>
              {isFavorite(pv.id) ? '⭐' : '☆'}
            </button>
          </h2>
          <!-- v4.989: 頂部 +/- 數量按鈕 — 玩家不用 scroll 到底部就能加減牌組 -->
          {#if active && !isPresetActive && !isBasicEnergy(pv)}
            <div class="pv-top-counter">
              <button class="icon" onclick={() => removeCard(pv.id)} disabled={pvCount <= 0} aria-label="減少">−</button>
              <span class="pv-top-count-label">牌組中：<strong>{pvCount} / {pvMax}</strong></span>
              <button class="icon" onclick={() => addCard(pv)}
                title={aceSpecBlocked(pv) ? '一副牌最多 1 張 ACE SPEC' : '加入牌組'}
                disabled={(!isBasicEnergy(pv) && pvCount >= pvMax) || aceSpecBlocked(pv)} aria-label="增加">+</button>
            </div>
          {/if}

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
          <!-- v4.988: 進化鏈視覺化 — 點任一名字切換預覽 -->
          {#if previewChain.length > 1}
            <div class="pv-evo-chain">
              <span class="pv-evo-chain-label">🌱 進化鏈</span>
              <div class="pv-evo-chain-row">
                {#each previewChain as group, gi (group.stage)}
                  {#if gi > 0}<span class="evo-arrow">→</span>{/if}
                  <div class="evo-stage-group">
                    {#each group.names as nm, ni (nm)}
                      {#if ni > 0}<span class="evo-or">／</span>{/if}
                      <button class="evo-card-link" class:current={nm === pv.name}
                        onclick={() => switchPreviewToName(nm)} title="點擊切換預覽">{nm}</button>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
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
              <button class="icon" onclick={() => removeCard(pv.id)} disabled={isPresetActive || pvCount <= 0}>−</button>
              <button
                class="icon"
                onclick={() => addCard(pv)}
                title={aceSpecBlocked(pv) ? '一副牌最多 1 張 ACE SPEC' : ''}
                disabled={isPresetActive || (!isBasicEnergy(pv) && pvCount >= pvMax) || aceSpecBlocked(pv)}>+</button>
              {#if isPresetActive}<span class="pv-count-label muted" style="margin-left:.5rem">（預組唯讀）</span>{/if}
            {:else}
              <span class="pv-count-label muted">請先選擇牌組</span>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- ── Auth modal ───────────────────────────────────────────────────────── -->
{#if showAuthModal}
  <div class="pv-overlay" onclick={() => { showAuthModal = false; }}>
    <div class="pv-inner auth-modal" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={() => { showAuthModal = false; }} aria-label="關閉">×</button>

      <h3 class="modal-title">帳號管理</h3>

      <!-- Tab bar -->
      <div class="auth-tabs">
        <button class:active={authTab === 'upgrade'} onclick={() => { authTab = 'upgrade'; authError = null; }}>
          {isAnonymous ? '🆕 建立新帳號' : '🆕 建立帳號'}
        </button>
        <button class:active={authTab === 'login'} onclick={() => { authTab = 'login'; authError = null; }}>
          🔑 登入現有帳號
        </button>
      </div>

      {#if authTab === 'upgrade'}
        {#if isAnonymous}
          <p class="auth-desc">建立帳號後，你目前的所有牌組將永久保存，換電腦也能繼續使用。</p>
        {:else}
          <p class="auth-desc">為其他裝置建立新帳號。</p>
        {/if}
        <div class="auth-form">
          <input type="email" placeholder="Email" bind:value={authEmail} onkeydown={(e) => e.key === 'Enter' && upgradeAccount()} />
          <input type="password" placeholder="密碼（至少 6 碼）" bind:value={authPassword} onkeydown={(e) => e.key === 'Enter' && upgradeAccount()} />
          {#if authError}<p class="auth-error">{authError}</p>{/if}
          <button class="small primary" onclick={upgradeAccount} disabled={authLoading}>
            {authLoading ? '處理中…' : isAnonymous ? '建立並綁定帳號' : '建立帳號'}
          </button>
        </div>
      {:else}
        <!-- v3.92：login tab 內 toggle 切換「正常登入」⇄「忘記密碼寄重設信」 -->
        {#if !forgotMode}
          <p class="auth-desc">登入後將從雲端載入該帳號的牌組。</p>
          <div class="auth-form">
            <input type="email" placeholder="Email" bind:value={authEmail} onkeydown={(e) => e.key === 'Enter' && loginWithEmail()} />
            <input type="password" placeholder="密碼" bind:value={authPassword} onkeydown={(e) => e.key === 'Enter' && loginWithEmail()} />
            {#if authError}<p class="auth-error">{authError}</p>{/if}
            <button class="small primary" onclick={loginWithEmail} disabled={authLoading}>
              {authLoading ? '登入中…' : '登入'}
            </button>
            <button class="auth-link" onclick={() => { forgotMode = true; authError = null; resetEmailSent = false; }}>
              忘記密碼？寄送重設信
            </button>
          </div>
        {:else}
          <p class="auth-desc">輸入註冊時的 Email，我們會寄送密碼重設信到該信箱。</p>
          <div class="auth-form">
            <input type="email" placeholder="Email" bind:value={authEmail} onkeydown={(e) => e.key === 'Enter' && sendResetEmail()} />
            {#if authError}<p class="auth-error">{authError}</p>{/if}
            {#if resetEmailSent}<p class="auth-success">重設信已寄出！請查收信箱（含垃圾郵件夾），點擊信中連結重設密碼。</p>{/if}
            <button class="small primary" onclick={sendResetEmail} disabled={authLoading}>
              {authLoading ? '寄送中…' : '寄送重設信'}
            </button>
            <button class="auth-link" onclick={() => { forgotMode = false; authError = null; resetEmailSent = false; }}>
              ← 返回登入
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- ── v3.92 Change Password modal ───────────────────────────────────────── -->
{#if showChangePasswordModal}
  <div class="pv-overlay" onclick={() => { showChangePasswordModal = false; }}>
    <div class="pv-inner auth-modal" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={() => { showChangePasswordModal = false; }} aria-label="關閉">×</button>
      <h3 class="modal-title">🔑 更改密碼</h3>
      {#if cpSuccess}
        <p class="auth-success">密碼已成功更改！下次登入請使用新密碼。</p>
        <div class="auth-form">
          <button class="small primary" onclick={() => { showChangePasswordModal = false; }}>關閉</button>
        </div>
      {:else}
        <p class="auth-desc">更改密碼需要先輸入舊密碼確認身分。</p>
        <div class="auth-form">
          <input type="password" placeholder="舊密碼" bind:value={cpOldPassword} autocomplete="current-password" />
          <input type="password" placeholder="新密碼（至少 6 碼）" bind:value={cpNewPassword} autocomplete="new-password" />
          <input type="password" placeholder="再次輸入新密碼" bind:value={cpNewPasswordConfirm} autocomplete="new-password" onkeydown={(e) => e.key === 'Enter' && submitChangePassword()} />
          {#if cpError}<p class="auth-error">{cpError}</p>{/if}
          <button class="small primary" onclick={submitChangePassword} disabled={cpLoading}>
            {cpLoading ? '處理中…' : '確認更改密碼'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- ── v4.974：匯出官網代碼成功 modal ───────────────────────────────────── -->
<!-- 取代 v4.973 的 alert，提供大字代碼顯示 + 複製按鈕 + 官網連結 -->
{#if showExportCodeModal}
  <div class="pv-overlay" onclick={closeExportCodeModal}>
    <div class="pv-inner export-code-modal" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={closeExportCodeModal} aria-label="關閉">×</button>
      <h3 class="modal-title">✅ 匯出成功 — 官網代碼</h3>
      <p class="muted">已永久發行到台灣官網。把代碼貼給朋友，他們在「🎫 官網代碼匯入」按鈕貼上即可載入相同牌組。</p>
      <div class="exported-code-display">{exportedDeckCode}</div>
      <div class="exported-totals muted">共 {exportedTotalKinds} 種卡 / {exportedTotalCards} 張</div>
      <div class="exported-actions">
        <button class="small primary" onclick={copyExportedCode}>
          {exportCopyFlag === 'copied' ? '✓ 已複製' : exportCopyFlag === 'failed' ? '⚠ 複製失敗，請手動選取' : '📋 複製代碼'}
        </button>
        <a class="small button-like" href={`https://asia.pokemon-card.com/tw/deck-build/code/?deckCode=${exportedDeckCode}`} target="_blank" rel="noopener">🔗 在官網查看</a>
        <button class="small" onclick={closeExportCodeModal}>關閉</button>
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
          <button class="small" onclick={exportDeckAsImage} disabled={exportingImage}>
            {exportingImage ? '⏳ 產生中...' : '📸 匯出圖片'}
          </button>
        </div>
        {#if exportImageError}
          <div class="export-image-error">⚠ 匯出圖片失敗：{exportImageError}</div>
        {:else if !exportingImage}
          <p class="muted small-note">📸 匯出圖片：純卡牌 grid（4:3 比例，方便手機分享）。卡圖透過 images.weserv.nl 代理載入。</p>
        {/if}

      {:else}
        <h3 class="modal-title">匯入牌組（文字格式）</h3>
        <p class="muted">
          支援三種格式：<br>
          ① 完整格式：<code>張數 卡名 卡包代號 卡號</code><br>
          ② 簡易格式：<code>張數 卡名</code>（同名取第一張）<br>
          ③ 對戰紀錄格式：<code>卡名 卡包代號 · 卡號 · 賽季 × 張數</code>（從 admin 對戰紀錄複製貼上）<br>
          首行可選：<code>// 牌組名稱</code>
        </p>

        <!-- v3.83: bind:open 讓主畫面「🔖 從官方匯入」按鈕能直接自動展開 -->
        <details class="official-import-help" bind:open={officialHelpOpen}>
          <summary>📦 從官方訓練家網站匯入（一次設定永久可用）</summary>
          <div class="help-body">
            <p><strong>✨ 一次性設定</strong>（之後每次都只要點書籤）：</p>
            <ol>
              <li>顯示瀏覽器書籤列：Firefox 按 <kbd>Ctrl+B</kbd> 或 Chrome 按 <kbd>Ctrl+Shift+B</kbd></li>
              <li>把下面這個藍色按鈕<strong>用滑鼠拖曳到書籤列</strong>放開</li>
              <li class="bm-drag-wrapper">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html `<a class="bm-drag-btn" href="javascript:(function(){const cs=document.querySelectorAll('%23decklistZoneCardContainer > .card');if(!cs.length){alert('找不到牌組，請在官方牌組構築頁執行');return;}const lines=[];cs.forEach(c=>{const n=c.dataset.cardName||'';const id=c.dataset.cardId||'';const k=c.children[1]%3F.innerText%3F.trim()||'1';lines.push(k+' '+n+(id%3F' %23'+id:''));});const text=lines.join('\\n');function done(ok){const w=document.createElement('div');w.style.cssText='position:fixed;top:20px;left:20px;right:20px;z-index:99999;background:%23fff;border:3px solid '+(ok%3F'%23228a3a':'%232a5aa0')+';padding:15px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-family:system-ui;';w.innerHTML='<div style=%22font-weight:bold;margin-bottom:8px;color:'+(ok%3F'%23228a3a':'%232a5aa0')+';%22>'+(ok%3F'✅ 已自動複製 ':'⚠ 自動複製失敗，請手動 Ctrl%2BC — 共 ')+cs.length+' 種卡</div>';const ta=document.createElement('textarea');ta.value=text;ta.rows=Math.min(20,lines.length%2B1);ta.style.cssText='width:100%25;font-family:monospace;font-size:13px;padding:8px;border:1px solid %23aaa;box-sizing:border-box;';w.appendChild(ta);const btn=document.createElement('button');btn.innerText='關閉';btn.style.cssText='margin-top:8px;padding:6px 14px;cursor:pointer;';btn.onclick=function(){w.remove();};w.appendChild(btn);document.body.appendChild(w);setTimeout(function(){ta.focus();ta.select();if(!ok){try{document.execCommand('copy');}catch(e){}}},100);if(ok)setTimeout(function(){w.remove();},2500);}if(navigator.clipboard%26%26navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){done(true);}).catch(function(){done(false);});}else{done(false);}})();" onclick="event.preventDefault(); alert('請將此按鈕用滑鼠拖到瀏覽器書籤列，不是點擊');" draggable="true">🔖 PTCG 匯入</a>`}
              </li>
            </ol>
            <p><strong>📥 之後每次匯入牌組</strong>：</p>
            <ol>
              <li>到 <a href="https://asia.pokemon-card.com/tw/deck-build/" target="_blank" rel="noopener">官方牌組構築工具</a>編輯好牌組</li>
              <li>點剛才加到書籤列的「🔖 PTCG 匯入」書籤 — <strong>會自動複製到剪貼簿</strong>（綠框提示 2.5 秒後自動消失）</li>
              <li>回本頁，在下方輸入框 <kbd>Ctrl+V</kbd> 貼 → 按「匯入」</li>
            </ol>
            <p class="small-note">※ 若瀏覽器阻擋自動複製（藍框提示），跳出的浮層文字已選取好，手動按 <kbd>Ctrl+C</kbd> 即可</p>
            <details class="fallback-help">
              <summary style="font-size:0.8rem;color:#777;">書籤列不能拖？或用 Firefox 嚴格模式？開啟 F12 手動執行</summary>
              <p style="font-size:0.8rem;">在官網按 <kbd>F12</kbd> → Console 分頁，貼下面程式碼按 Enter：</p>
              <textarea class="bm-code" readonly rows="3" onclick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}>{`(function(){const cs=document.querySelectorAll('#decklistZoneCardContainer > .card');if(!cs.length){alert('找不到牌組');return;}const lines=[];cs.forEach(c=>{const n=c.dataset.cardName||'';const k=c.children[1]?.innerText?.trim()||'1';lines.push(k+' '+n);});const text=lines.join('\\n');const w=document.createElement('div');w.style.cssText='position:fixed;top:20px;left:20px;right:20px;z-index:99999;background:#fff;border:3px solid #2a5aa0;padding:15px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-family:system-ui;';w.innerHTML='<div style=\"font-weight:bold;margin-bottom:8px;color:#2a5aa0;\">✅ 共 '+cs.length+' 種卡 — 按 Ctrl+C 複製</div>';const ta=document.createElement('textarea');ta.value=text;ta.rows=Math.min(20,lines.length+1);ta.style.cssText='width:100%;font-family:monospace;font-size:13px;padding:8px;border:1px solid #aaa;box-sizing:border-box;';w.appendChild(ta);const btn=document.createElement('button');btn.innerText='關閉';btn.style.cssText='margin-top:8px;padding:6px 14px;cursor:pointer;';btn.onclick=function(){w.remove();};w.appendChild(btn);document.body.appendChild(w);setTimeout(function(){ta.focus();ta.select();},100);})();`}</textarea>
            </details>
          </div>
        </details>

        <textarea class="text-area" bind:value={importTextInput}
          placeholder={"// 我的火系牌組\n4 小火龍\n2 火恐龍\n3 破空焰ex\n14 基本【火】能量\n..."}></textarea>
        <div class="text-actions">
          <button class="small" onclick={importFromText} disabled={!importTextInput.trim()}>匯入</button>
          <button class="small" onclick={() => { showTextModal = false; }}>取消</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- v2.129 全螢幕卡牌放大（鏡射 /cards lightbox 樣式）─────────────────────── -->
{#if lightboxUrl}
  <div
    class="lightboxOverlay"
    role="dialog"
    aria-modal="true"
    aria-label="放大卡牌圖片"
    onclick={closeLightbox}
  >
    <img class="lightboxImg" src={lightboxUrl} alt="放大圖片" onclick={closeLightbox} />
    <button class="lightboxClose" onclick={closeLightbox} aria-label="關閉">×</button>
  </div>
{/if}

<style>

  main {
    max-width: 1200px;
    margin: calc(1.5rem + env(safe-area-inset-top, 0)) auto 1.5rem;
    padding: 0 1rem 3rem;
    font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    color: #1a1a1a;
  }
  .page-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .page-head h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  /* v4.493 手機 RWD：縮小 h1 與元素間距，配合 .page-head flex-wrap，
     讓多個元素在小螢幕上更緊湊、避免橫向溢出。 */
  @media (max-width: 600px) {
    .page-head {
      gap: 0.5rem 0.6rem;
    }
    .page-head h1 {
      font-size: 1.15rem;
    }
    .page-head .hint {
      font-size: 0.78rem;
    }
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
  .version-tag { font-size: 0.7rem; color: #888; font-family: monospace; background: #e8e4ee; padding: 0.1rem 0.4rem; border-radius: 3px; vertical-align: middle; margin-left: 0.3rem; font-weight: 400; }
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
  /* v4.982: rail-head 改 column — label 一行 + 按鈕區一行；按鈕用 grid 3 cols 滿寬等高 */
  .rail-head {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    margin-bottom: 0.55rem;
  }
  .rail-head > strong {
    font-size: 0.95rem;
    color: #374151;
  }
  .rail-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.3rem;
  }
  .rail-actions > button {
    width: 100%;
    text-align: center;
    padding: 0.4rem 0.3rem;
    font-size: 0.82rem;
    white-space: nowrap;
    box-sizing: border-box;
  }
  .cloud-btn {
    background: #0066cc !important;
    color: #fff !important;
    border-color: #0066cc !important;
  }
  .cloud-btn:hover {
    background: #0052a3 !important;
    border-color: #0052a3 !important;
  }
  /* v5.114：未存檔時 💾 存檔 按鈕脈動紅光（提示玩家未存檔） */
  .cloud-btn.has-dirty {
    background: #d93838 !important;
    border-color: #d93838 !important;
    animation: dirty-pulse 1.6s ease-in-out infinite;
  }
  .cloud-btn.has-dirty:hover {
    background: #b32828 !important;
    border-color: #b32828 !important;
  }
  @keyframes dirty-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 80, 80, 0.75); }
    50%      { box-shadow: 0 0 0 5px rgba(255, 80, 80, 0); }
  }
  /* v5.114：sync-pill 未存檔狀態（橘色提示） */
  .sync-pill.sync-unsaved {
    background: #f5a623 !important;
    color: #fff !important;
    border-color: #f5a623 !important;
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
  /* 預組區塊 — 淡橙底讓人知道是唯讀 */
  .rail-head.preset-head { margin-top: 1rem; }
  /* v4.983: 內建預組改 <details> 預設摺疊 — 玩家點開才展開 */
  .preset-section { margin-top: 1rem; border-top: 1px dashed #d8d8d8; padding-top: 0.7rem; }
  .preset-section > .preset-summary {
    font-weight: 700;
    font-size: 0.95rem;
    color: #374151;
    cursor: pointer;
    padding: 0.25rem 0;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .preset-section > .preset-summary::-webkit-details-marker { display: none; }
  .preset-section > .preset-summary::before {
    content: '▶';
    font-size: 0.7rem;
    color: #888;
    transition: transform 0.15s ease;
    display: inline-block;
  }
  .preset-section[open] > .preset-summary::before { transform: rotate(90deg); }
  .preset-section > .preset-summary:hover { color: #0066cc; }
  .preset-count {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 500;
    color: #888;
    background: #f4f6fa;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
  }
  .preset-section > .deck-list { margin-top: 0.4rem; }
  .preset-list li { background: #fff5e6; }
  .preset-list li.active { background: #ffe6c4; box-shadow: inset 0 0 0 1px #d9aa4a; }
  .preset-badge { background:#d9aa4a; color:#fff; font-size:.72rem; font-weight:700; padding:.18rem .45rem; border-radius:4px; white-space:nowrap; }
  .deck-pick {
    flex: 1;
    min-width: 0;  /* v4.982: 允許子元素 shrink → deck-name 才能 truncate */
    text-align: left;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    background: transparent;
    border: none;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .deck-name {
    font-weight: 500;
    /* v4.982: 長卡名（含預組「超級耿鬼ex（預組）」）truncate 防 wrap 兩行 */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .deck-size {
    color: #888;
    font-size: 0.8rem;
    flex-shrink: 0;  /* v4.982: 數字 60/60 不被 shrink */
    white-space: nowrap;
  }

  /* Centre: deck detail */
  .deck-pane {
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem;
  }
  /* v4.981: 牌組編輯器 header grid 佈局 — title + count 第一列，actions 第二列 wrap */
  .deck-header {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "title count"
      "actions actions";
    column-gap: 0.6rem;
    row-gap: 0.55rem;
    align-items: center;
  }
  .deck-title {
    grid-area: title;
    font-size: 1.1rem;
    font-weight: 600;
    padding: 0.4rem 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    min-width: 8rem;
    width: 100%;
    box-sizing: border-box;
  }
  /* v4.981: count 改 pill badge — 視覺更整潔 */
  .count {
    grid-area: count;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.3rem 0.7rem;
    background: #eef2f8;
    border: 1px solid #d6dce6;
    border-radius: 999px;
    color: #2a4a78;
    white-space: nowrap;
  }
  .count.bad {
    background: #fee2e2;
    border-color: #fca5a5;
    color: #c00;
  }
  .deck-actions {
    grid-area: actions;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  /* v4.981: button 加 nowrap — 防中文字在窄欄被擠成垂直堆 */
  .deck-actions button.small,
  .deck-actions label.file {
    white-space: nowrap;
  }
  /* v4.981: 手機板 (≤600px) — actions 改 grid 2 cols 滿寬，清空獨佔一行 */
  @media (max-width: 600px) {
    .deck-header { column-gap: 0.4rem; }
    .deck-title { font-size: 1rem; padding: 0.35rem 0.45rem; min-width: 6rem; }
    .count { font-size: 0.88rem; padding: 0.25rem 0.55rem; }
    .deck-actions {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.35rem;
    }
    .deck-actions > button.small,
    .deck-actions > label.file,
    .deck-actions > .preset-badge {
      width: 100%;
      text-align: center;
      justify-content: center;
      padding: 0.45rem 0.4rem;
      font-size: 0.85rem;
      box-sizing: border-box;
    }
    /* 清空 button 獨佔一整行 — 危險動作視覺強調 */
    .deck-actions > button.small.danger {
      grid-column: 1 / -1;
    }
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
  /* ── Picker filter system ────────────────────────────────────── */
  .pk-filters {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 0.5rem;
  }
  .pk-search-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .pk-search {
    flex: 1;
    padding: 0.45rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    font: inherit;
    font-size: 0.88rem;
  }
  /* v4.954：原 .pk-mode-toggle / .pk-mode-btn 已被單一 <select> 取代，樣式保留作防禦 */
  .pk-mode-toggle {
    display: flex;
    gap: 0;
    border: 1px solid #ccc;
    border-radius: 6px;
    overflow: hidden;
    background: #fff;
    flex-shrink: 0;
  }
  .pk-mode-btn {
    padding: 0.4rem 0.6rem;
    border: 0;
    background: #fff;
    cursor: pointer;
    font-size: 0.78rem;
    color: #555;
  }
  .pk-mode-btn + .pk-mode-btn { border-left: 1px solid #e0e0e0; }
  .pk-mode-btn.active { background: #1a1a1a; color: #fff; }
  .pk-mode-btn:hover:not(.active) { background: #f0f0f0; }
  /* v4.954：搜尋模式 dropdown */
  .pk-mode-select {
    padding: 0.4rem 0.55rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    font-size: 0.78rem;
    color: #333;
    font-family: inherit;
    flex-shrink: 0;
  }
  .pk-mode-select.keyword {
    background: #1a1a1a;
    color: #fff;
    border-color: #1a1a1a;
  }
  .pk-mode-select:hover:not(.keyword) {
    background: #f0f0f0;
  }

  /* v5.315: deck list 拖曳排序 — ⠿ 把手才觸發, li 本身不接 pointer events */
  .deck-list li {
    display: flex; align-items: center; gap: 4px;
    user-select: none;
    position: relative;
    transition: box-shadow 0.15s, background-color 0.15s;
    z-index: 1;
  }
  /* ⠿ 把手 — touch-action:none 讓 ⠿ 上的觸控不會被瀏覽器當 scroll */
  .deck-drag-handle {
    color: #4a8a4a; font-size: 1.3rem;
    padding: 0.3rem 0.5rem; cursor: grab;
    flex: 0 0 auto; line-height: 1;
    touch-action: none;
    user-select: none;
    border-radius: 4px;
  }
  .deck-drag-handle:hover { background: rgba(74, 138, 74, 0.15); color: #6cba6c; }
  .deck-drag-handle:active { cursor: grabbing; background: rgba(74, 138, 74, 0.3); }
  /* 拉起來視覺 — translateY 跟手指 + scale + shadow + 變色 */
  .deck-list li.drag-source {
    background-color: #2a4a2a !important;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6);
    z-index: 100;
    opacity: 0.95;
    /* v5.316: 整 li 加 pointer-events:none → elementFromPoint 穿透到下方真實 li,
       才能正確算 dragOverId. 不影響 pointerup — window listener 不靠 li 接 events.
       (修 v5.315「拖到位置放手沒換」bug) */
    pointer-events: none;
  }
  /* v5.316: 上下半部不同視覺 — drag-over-before 上邊金線, drag-over-after 下邊金線 */
  .deck-list li.drag-over-before { box-shadow: inset 0 3px 0 #ffd700, 0 -2px 0 #ffd700; }
  .deck-list li.drag-over-after { box-shadow: inset 0 -3px 0 #ffd700, 0 2px 0 #ffd700; }

  /* v5.312: 常用卡牌 ⭐ 按鈕 — 放在 + 加入按鈕左邊 (取代 v5.310 卡圖角標, 避免擋圖) */
  .pick-fav-btn { color: #888; transition: color 0.15s, background 0.15s, border-color 0.15s; }
  .pick-fav-btn:hover { color: #ffd700; background: rgba(255, 215, 0, 0.12); }
  .pick-fav-btn.active { color: #ffd700; border-color: rgba(255, 215, 0, 0.6); background: rgba(80, 60, 0, 0.35); }
  .pv-fav-btn {
    margin-left: 0.5rem;
    background: rgba(0, 0, 0, 0.35);
    border: 1.5px solid rgba(255, 215, 0, 0.4);
    border-radius: 8px;
    color: #888;
    cursor: pointer;
    font-size: 1.4rem;
    padding: 0 0.5rem;
    line-height: 1.6;
    vertical-align: middle;
    transition: all 0.15s;
  }
  .pv-fav-btn:hover { background: rgba(255, 215, 0, 0.15); color: #ffd700; }
  .pv-fav-btn.active { color: #ffd700; border-color: #ffd700; background: rgba(80, 60, 0, 0.55); }
  .pk-chip-fav.fav-only.active { background: linear-gradient(135deg, #b8860b, #ffd700); color: #1a1a1a; border-color: #ffd700; }

  .pk-chip-row {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    align-items: center;
  }
  /* v4.982: pk-label 固定寬度 + 右對齊 — 所有 chip row 的 label 起點對齊（分類/標籤/屬性/階段/賽季/卡包）*/
  .pk-label {
    color: #6b7280;
    font-size: 0.78rem;
    width: 3.2em;
    text-align: right;
    margin-right: 0.15rem;
    flex-shrink: 0;
  }
  .pk-chip {
    padding: 0.3rem 0.65rem;
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.78rem;
    color: #333;
    white-space: nowrap;
  }
  .pk-chip.active {
    background: #1a1a1a;
    color: #fff;
    border-color: #1a1a1a;
  }
  .pk-chip:hover:not(.active) { background: #f5f5f5; }

  /* Tag chips */
  .pk-chip-tag { color: #4b5563; }
  .pk-chip-tag.active { background: #6366f1; border-color: #6366f1; color: #fff; }

  /* Type chips */
  .pk-chip-type {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: #4b5563;
  }
  .pk-chip-type.active {
    background: var(--type-bg, #6366f1);
    color: #fff;
    border-color: var(--type-bg, #6366f1);
  }
  .pk-chip-type.active .pk-type-dot {
    background: rgba(255,255,255,0.35) !important;
  }
  .pk-type-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.2em;
    height: 1.2em;
    border-radius: 50%;
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    text-shadow: 0 1px 1px rgba(0,0,0,0.3);
    flex-shrink: 0;
  }

  /* Stage chips */
  .pk-chip-stage { border-color: #6c5a8a; font-size: 0.75rem; }
  .pk-chip-stage.active { background: #6c5a8a; color: #fff; border-color: #6c5a8a; }

  /* Regulation mark chips */
  .pk-chip-mark { border-color: #5a7a8a; font-size: 0.75rem; }
  .pk-chip-mark.active { background: #5a7a8a; color: #fff; border-color: #5a7a8a; }

  /* Set dropdown */
  .pk-set-select {
    padding: 0.3rem 0.5rem;
    font: inherit;
    font-size: 0.82rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    max-width: 260px;
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
    /* v5.314: 從 3 cols 改 4 cols, 容納縮圖 / 卡名 / ⭐ / + 不換行 (手機窄 viewport 也要排同一列) */
    grid-template-columns: 40px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.4rem;
    border-radius: 4px;
  }
  /* v5.314: 手機版進一步縮 — gap + icon padding 縮緊, 圖縮小 */
  @media (max-width: 768px) {
    .picker-list li {
      grid-template-columns: 36px minmax(0, 1fr) auto auto;
      gap: 0.25rem;
      padding: 0.25rem 0.3rem;
    }
    .picker-list img { width: 36px; height: 50px; }
    .picker-list li button.icon { padding: 0.2rem 0.4rem; font-size: 0.9rem; min-width: 1.6rem; }
    .pick-name { font-size: 0.82rem; }
    .pick-sub { font-size: 0.7rem; }
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
    align-items: flex-start;
    justify-content: center;
    padding: 1rem;
    padding-top: calc(env(safe-area-inset-top, 2rem) + 1rem);
    cursor: zoom-out;
  }
  .pv-inner {
    background: #fff;
    border-radius: 12px;
    max-width: 1170px;
    width: 100%;
    max-height: calc(100vh - env(safe-area-inset-top, 2rem) - 3rem);
    margin: auto;
    overflow-y: auto;
    overflow-x: hidden; /* v4.999: 同 cards modalInner — 強制阻擋水平 scrollbar */
    position: relative;
    padding: 1.5rem;
    cursor: default;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }
  .pv-close {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    border: 1px solid #ddd;
    background: #f4f4f4;
    font-size: 1.45rem;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }
  .pv-close:hover { background: #e8e8e8; }

  .pv-top {
    display: grid;
    grid-template-columns: minmax(260px, 338px) 1fr;
    gap: 1.9rem;
    align-items: start;
  }
  @media (max-width: 640px) {
    .pv-top { grid-template-columns: 1fr; }
    .pv-img { width: 140px; }
  }
  .pv-img {
    width: 100%;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    display: block;
  }

  .pv-name {
    margin: 0 0 0.5rem;
    font-size: 1.7rem;
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
    font-size: 1.05rem;
    font-weight: 700;
  }
  .sub-badge {
    padding: 0.15rem 0.5rem;
    background: #eee;
    border-radius: 4px;
    font-size: 1.05rem;
  }
  .hp-badge {
    padding: 0.15rem 0.5rem;
    background: #ffe5e5;
    color: #c00;
    border-radius: 4px;
    font-size: 1.05rem;
    font-weight: 700;
  }
  .pv-evolve {
    margin: 0.25rem 0 0.5rem;
    font-size: 1.1rem;
    color: #666;
  }
  /* v4.988: 進化鏈視覺化 */
  .pv-evo-chain { margin: 0.6rem 0 0.4rem; padding: 0.55rem 0.7rem; background: #f4f6fa; border-left: 3px solid #4a7ab5; border-radius: 4px; }
  .pv-evo-chain-label { display: inline-block; font-size: 0.78rem; font-weight: 700; color: #2a4a78; margin-bottom: 0.3rem; }
  .pv-evo-chain-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
  .evo-stage-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.2rem; }
  .evo-arrow { color: #6b7280; font-weight: 600; }
  .evo-or { color: #888; }
  .evo-card-link {
    border: 1px solid #c9d2e0;
    background: #fff;
    color: #2a4a78;
    border-radius: 4px;
    padding: 0.18rem 0.55rem;
    font-size: 0.85rem;
    cursor: pointer;
    font: inherit;
    transition: background 0.12s;
  }
  .evo-card-link:hover { background: #e7eef8; }
  .evo-card-link.current { background: #2a4a78; color: #fff; border-color: #2a4a78; cursor: default; }

  .pv-setinfo {
    margin: 0.5rem 0 0;
    font-size: 1.05rem;
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
    font-size: 1.15rem;
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
    font-size: 0.9rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    align-self: center;
  }
  .ab-name {
    grid-row: 1;
    font-size: 1.25rem;
  }
  .ab-effect {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 1.1rem;
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
  .atk-name { font-size: 1.25rem; }
  .atk-dmg {
    margin-left: auto;
    font-weight: 700;
    font-size: 1.3rem;
  }
  .atk-effect {
    margin: 0;
    font-size: 1.1rem;
    color: #444;
  }

  /* Energy pip */
  .energy-pip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    font-size: 0.85rem;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }
  .energy-pip.sm {
    width: 1.4rem;
    height: 1.4rem;
    font-size: 0.8rem;
  }

  /* Weakness / Resistance / Retreat */
  .pv-wrc {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.5rem;
    font-size: 1.1rem;
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
  /* v4.989: 左右導航 + 同名變體 counter */
  /* v4.998: 改用 transform 偏移 — 不影響 parent overflow extent，消除水平 scrollbar */
  .pv-nav {
    position: absolute;
    top: 50%;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 1px solid #c9d2e0;
    background: #fff;
    color: #2a4a78;
    font-size: 1.6rem;
    font-weight: 700;
    cursor: pointer;
    z-index: 5;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  .pv-nav:hover { background: #e7eef8; }
  /* v5.000: button 完整放 modal 內側 16px，避免被 overflow-x: hidden 切掉 */
  .pv-nav-prev { left: 16px; transform: translateY(-50%); }
  .pv-nav-next { right: 16px; transform: translateY(-50%); }
  .pv-variant-counter {
    position: absolute;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.78rem;
    color: #666;
    background: #f4f6fa;
    border: 1px solid #d6dce6;
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    z-index: 4;
    white-space: nowrap;
  }
  .pv-top-counter {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.4rem 0 0.5rem;
    padding: 0.4rem 0.6rem;
    background: #f5f9ff;
    border: 1px solid #cfdcee;
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .pv-top-count-label { flex: 1; color: #2a4a78; }
  /* 手機板：左右 nav 改放 modal 內部邊緣 */
  @media (max-width: 600px) {
    /* v4.998: 手機板維持 modal 內側放置 */
    .pv-nav-prev { left: 0.3rem; transform: translateY(-50%); }
    .pv-nav-next { right: 0.3rem; transform: translateY(-50%); }
    .pv-nav { width: 36px; height: 36px; font-size: 1.4rem; }
  }

  .pv-count-label {
    font-size: 1.15rem;
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

  /* Auth header elements */
  .auth-btn {
    background: #fff8e0;
    border: 1px solid #e0c040;
    border-radius: 6px;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .auth-btn:hover { background: #fff0b0; }
  .auth-sub { color: #0066cc; font-size: 0.78rem; }
  .auth-user {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .auth-email {
    font-size: 0.82rem;
    color: #444;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Auth modal */
  .auth-modal { max-width: 420px; }
  .auth-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid #eee;
    margin-bottom: 1rem;
  }
  .auth-tabs button {
    flex: 1;
    background: none;
    border: none;
    padding: 0.5rem;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
    color: #888;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
  }
  .auth-tabs button.active {
    color: #0066cc;
    border-bottom-color: #0066cc;
    font-weight: 600;
  }
  .auth-desc {
    font-size: 0.88rem;
    color: #555;
    margin: 0 0 1rem;
  }
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .auth-form input {
    padding: 0.5rem 0.65rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    font: inherit;
    font-size: 0.95rem;
  }
  .auth-form input:focus { outline: 2px solid #4a7fd4; border-color: transparent; }
  /* v3.92 忘記密碼 link button 樣式 + 成功訊息綠色 */
  .auth-link {
    background: none;
    border: none;
    color: #4a90e2;
    text-decoration: underline;
    font-size: 0.9em;
    padding: 4px 0;
    cursor: pointer;
    text-align: center;
  }
  .auth-link:hover {
    color: #2d6cc0;
  }
  .auth-success {
    color: #2d8d3e;
    background: #e8f5ea;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #b8e0c0;
    font-size: 0.9em;
    margin: 4px 0;
  }
  .auth-error {
    margin: 0;
    color: #c00;
    font-size: 0.85rem;
  }
  button.small.primary {
    background: #0066cc;
    color: #fff;
    border-color: #0066cc;
  }
  button.small.primary:hover:not(:disabled) { background: #0055aa; }
  button.small.primary:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Text format modal */
  .text-modal { max-width: 560px; }
  .modal-title { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .export-image-error { margin-top:10px; padding:8px 12px; background:#fef0f0; border-left:3px solid #c53030; color:#742a2a; font-size:0.9rem; border-radius:4px; }
  /* v4.974：匯出官網代碼 modal */
  .export-code-modal { max-width: 480px; padding: 1.2rem 1.5rem; }
  .exported-code-display {
    margin: 0.8rem 0 0.4rem;
    padding: 0.7rem 0.9rem;
    background: #f5f7fa;
    border: 2px dashed #4a7ab5;
    border-radius: 6px;
    font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: #1e3a5f;
    text-align: center;
    user-select: all;
    word-break: break-all;
  }
  .exported-totals { margin: 0 0 0.8rem; font-size: 0.85rem; text-align: center; }
  .exported-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; align-items: center; margin-top: 0.6rem; }
  .exported-actions .button-like {
    display: inline-block;
    padding: 0.32rem 0.7rem;
    background: #eef2f8;
    border: 1px solid #c9d2e0;
    border-radius: 5px;
    color: #2a5aa0;
    text-decoration: none;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s;
  }
  .exported-actions .button-like:hover { background: #dfe7f3; }
  @media (max-width: 600px) {
    .export-code-modal { max-width: 92vw; padding: 1rem 1rem; }
    .exported-code-display { font-size: 1.05rem; padding: 0.6rem 0.5rem; }
    .exported-actions { flex-direction: column; align-items: stretch; }
    .exported-actions > * { width: 100%; text-align: center; }
  }
  .official-import-help { background:#f4f7fa; border:1px solid #d0dbe7; border-radius:6px; padding:0.5rem 0.8rem; margin:0.5rem 0; font-size:0.85rem; }
  .official-import-help summary { cursor:pointer; font-weight:600; color:#2a5aa0; }
  .official-import-help .help-body { margin-top:0.5rem; }
  .official-import-help ol { margin:0.3rem 0 0.6rem 1.2rem; padding:0; line-height:1.6; }
  .official-import-help kbd { background:#eee; border:1px solid #ccc; border-radius:3px; padding:0 0.25rem; font-family:monospace; font-size:0.8em; }
  .official-import-help a { color:#2a5aa0; }
  .bm-code { width:100%; font-family:'Consolas','Menlo',monospace; font-size:0.72rem; padding:0.4rem; border:1px solid #c5d0de; border-radius:4px; background:#eef3f9; color:#222; margin-bottom:0.3rem; box-sizing:border-box; white-space:pre; overflow-x:auto; }
  .bm-drag-wrapper { list-style:none; text-align:center; margin:0.6rem 0; }
  .bm-drag-btn { display:inline-block; background:linear-gradient(135deg,#2a5aa0,#4a7ac5); color:#fff !important; padding:0.6rem 1.4rem; border-radius:6px; font-weight:700; text-decoration:none; cursor:move; box-shadow:0 3px 8px rgba(42,90,160,.35); user-select:none; border:2px solid #1a4080; }
  .bm-drag-btn:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(42,90,160,.5); }
  .bm-drag-btn:active { cursor:grabbing; }
  .fallback-help { margin-top:0.8rem; padding:0.4rem 0.6rem; background:#f9f9f9; border:1px dashed #ccc; border-radius:4px; }
  .fallback-help summary { cursor:pointer; }
  .small-note { font-size:0.78rem; color:#666; margin:0.3rem 0 0; }
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

  /* v2.129：preview modal 內的卡圖點擊放大 */
  .pv-img-btn {
    position: relative;
    display: block;
    background: none;
    border: none;
    padding: 0;
    cursor: zoom-in;
  }
  .pv-img-btn:hover .pv-zoom-hint { opacity: 1; }
  .pv-zoom-hint {
    position: absolute;
    top: 0.4rem; right: 0.4rem;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    padding: 0.15rem 0.4rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
    opacity: 0.6;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  /* v2.129：全螢幕放大 lightbox（與 /cards 一致） */
  .lightboxOverlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
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
</style>
