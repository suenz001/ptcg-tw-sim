<!--
  v6.653 玩家個人名片編輯器（「線上連線對戰 → 🪪 個人」與「錦標賽 → 🪪 個人」共用）。
  ・全卡池開放（寶可夢／訓練家／能量皆可選）：支援從「我的牌組」或「卡包／卡名」按需求懶載入。
  ・固定中央亮圓框（touch-action:none）：拖曳底下的官方卡牌對準圓心、滑桿縮放、不留空白邊緣。
  ・代表榮譽由後端從賽事歸檔驗證：網站賽（冠軍/亞軍/4強/8強）與社群賽（冠軍）最多勾選 10 筆。
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Card } from '$lib/cards/types';
  import { cardThumb } from '$lib/cards/thumb';
  import { retryImg } from '$lib/img-retry';
  import { loadDecks } from '$lib/decks/storage';
  import AvatarCircle from './AvatarCircle.svelte';
  import PlayerProfileModal from './PlayerProfileModal.svelte';
  import {
    PROF_NICK_MAX,
    PROF_BIO_MAX,
    PROF_MAX_HONORS,
    PROF_CARD_HW,
    PROF_DEFAULT_CROP,
    clampAvatarCrop,
    buildSelfProfilePreview,
    cardImageUrlFromId,
    formatHonorDate,
    fetchMyProfile,
    saveMyProfile,
    getAvatarFrameSpec,
    listAllCardSetsForPicker,
    loadCardsForPickerSet,
    loadAllCardsForPicker,
    loadCardSetLookup,
    type AvatarCrop,
    type PlayerProfilePublic,
    type PlayerProfileSelf,
    type ProfileAuthCtx,
    type ProfileHonor,
  } from './profile-api';

  const STAGE_PX = 224;
  const RING_PX = 168;

  let {
    getAuthCtx,
    onsaved,
    onloaded,
    collapsible = false,
    storageKey = '',
  }: {
    getAuthCtx: () => Promise<ProfileAuthCtx | null>;
    onsaved?: ((profile: PlayerProfileSelf) => void) | null;
    onloaded?: ((profile: PlayerProfileSelf) => void) | null;
    collapsible?: boolean;
    storageKey?: string;
  } = $props();

  let loading = $state(true);
  let loadErr = $state('');
  let saving = $state(false);
  let saveMsg = $state('');
  let saveOk = $state(false);
  let collapsed = $state(false);
  let selfPreviewOpen = $state(false);

  let serverProfile = $state<PlayerProfileSelf | null>(null);
  let nick = $state('');
  let bio = $state('');
  let avatar = $state<AvatarCrop | null>(null);
  let pinnedIds = $state<string[]>([]);
  let showTotalWins = $state(true);
  let showOfficialCrowns = $state(true);
  let showCommunityCrowns = $state(true);

  // 卡池選擇器（打開時才懶載入）
  let pickerOpen = $state(false);
  let pickerSource = $state<'decks' | 'sets'>('decks');
  let pickerLoading = $state(false);
  let pickerErr = $state('');
  let pickerQuery = $state('');
  let pickerSets = $state<Array<{ code: string; name: string; cardCount: number }>>([]);
  let pickerSelectedSet = $state('all');
  let pickerCards = $state<Card[]>([]);
  let allPoolCardsCache: Card[] | null = null;
  let deckCardChoices = $state<Card[]>([]);
  let pickerLimit = $state(36);

  // 圓框拖曳狀態
  let dragActive = $state(false);
  let dragStart = { px: 0, py: 0, x: 0.5, y: 0.34 };

  const previewUrl = $derived(avatar ? cardImageUrlFromId(avatar.cardId) : null);
  const effectiveNick = $derived((nick.trim() || serverProfile?.defaultNick || '玩家').slice(0, PROF_NICK_MAX));
  const serverFrameSpec = $derived(getAvatarFrameSpec(serverProfile?.avatarFrame));
  const pickerTotalCount = $derived(pickerSets.reduce((sum, st) => sum + (Number(st.cardCount) || 0), 0));
  const livePreviewCard = $derived.by<PlayerProfilePublic>(() => {
    const base: PlayerProfileSelf = serverProfile ?? {
      profileKey: '',
      nick: effectiveNick,
      defaultNick: '玩家',
      bio: '',
      avatar: null,
      googleVerified: false,
      champOfficial: 0,
      champCommunity: 0,
      totalWins: 0,
      showTotalWins: true,
      showOfficialCrowns: true,
      showCommunityCrowns: true,
      avatarFrame: null,
      pinnedHonorIds: [],
      availableHonors: [],
    };
    return buildSelfProfilePreview(base, {
      nick: effectiveNick,
      bio,
      avatar,
      pinnedHonorIds: pinnedIds,
      showTotalWins,
      showOfficialCrowns,
      showCommunityCrowns,
    });
  });
  const filteredCards = $derived.by(() => {
    const src = pickerSource === 'decks' ? deckCardChoices : pickerCards;
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return src;
    const hits = src.filter((c) => (c.name && c.name.toLowerCase().includes(q)) || String(c.id).toLowerCase().includes(q));
    const rank = (c: Card) => {
      const n = (c.name || '').toLowerCase();
      const cid = String(c.id).toLowerCase();
      if (n === q || cid === q) return 0;
      if (n.startsWith(q)) return 1;
      return 2;
    };
    return hits.slice().sort((a, b) => rank(a) - rank(b));
  });
  const visibleCards = $derived(filteredCards.slice(0, pickerLimit));

  onMount(() => {
    if (collapsible && storageKey) {
      try {
        collapsed = localStorage.getItem(storageKey) === '1';
      } catch {
        collapsed = false;
      }
    }
    void loadProfile();
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
    if (collapsible && storageKey) {
      try {
        localStorage.setItem(storageKey, collapsed ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
  }

  async function loadProfile(refresh = false) {
    loading = true;
    loadErr = '';
    try {
      const ctx = await getAuthCtx();
      if (!ctx || !ctx.token) {
        loadErr = '請先使用 Google 或 Email 帳號登入後編輯個人名片。';
        return;
      }
      const res = await fetchMyProfile(ctx, refresh);
      if (!res.ok) {
        loadErr = res.message;
        return;
      }
      const p = res.data;
      serverProfile = p;
      nick = p.nick || '';
      bio = p.bio || '';
      avatar = clampAvatarCrop(p.avatar);
      pinnedIds = [...(p.pinnedHonorIds || [])];
      showTotalWins = p.showTotalWins !== false;
      showOfficialCrowns = p.showOfficialCrowns !== false;
      showCommunityCrowns = p.showCommunityCrowns !== false;
      onloaded?.(p);
    } finally {
      loading = false;
    }
  }

  async function saveProfile() {
    if (saving) return;
    saving = true;
    saveMsg = '';
    saveOk = false;
    try {
      const ctx = await getAuthCtx();
      if (!ctx || !ctx.token) {
        saveMsg = '登入狀態已失效，請重新登入後再儲存。';
        return;
      }
      const res = await saveMyProfile(ctx, {
        nick,
        bio,
        avatar,
        pinnedHonorIds: pinnedIds,
        showTotalWins,
        showOfficialCrowns,
        showCommunityCrowns,
      });
      if (!res.ok) {
        saveMsg = res.message;
        return;
      }
      const p = res.data;
      serverProfile = p;
      nick = p.nick || '';
      bio = p.bio || '';
      avatar = clampAvatarCrop(p.avatar);
      pinnedIds = [...(p.pinnedHonorIds || [])];
      showTotalWins = p.showTotalWins !== false;
      showOfficialCrowns = p.showOfficialCrowns !== false;
      showCommunityCrowns = p.showCommunityCrowns !== false;
      saveOk = true;
      saveMsg = '✅ 已儲存個人名片';
      onsaved?.(p);
    } finally {
      saving = false;
    }
  }

  async function openCardPicker() {
    pickerOpen = !pickerOpen;
    if (!pickerOpen) return;
    pickerLimit = 36;
    if (pickerSource === 'decks' && deckCardChoices.length === 0) {
      await loadDeckPoolChoices();
    } else if (pickerSource === 'sets' && pickerSets.length === 0) {
      await loadSetList();
    }
  }

  let pickerSeq = 0;

  async function switchPickerSource(src: 'decks' | 'sets') {
    pickerSource = src;
    pickerLimit = 36;
    pickerQuery = '';
    if (src === 'decks') await loadDeckPoolChoices();
    else await loadSetList();
  }

  async function loadDeckPoolChoices() {
    const seq = ++pickerSeq;
    pickerLoading = true;
    pickerErr = '';
    try {
      const decks = loadDecks();
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const d of decks) {
        for (const e of (d.entries || [])) {
          if (e.cardId && !seen.has(e.cardId)) {
            seen.add(e.cardId);
            ids.push(e.cardId);
          }
        }
      }
      if (!ids.length) {
        if (seq === pickerSeq) deckCardChoices = [];
        return;
      }
      const cardSetMap = await loadCardSetLookup();
      if (seq !== pickerSeq) return;
      const setsToFetch = new Set<string>();
      for (const id of ids) {
        const sc = cardSetMap[id];
        if (sc) setsToFetch.add(sc);
      }
      const loaded = await Promise.all([...setsToFetch].map((sc) => loadCardsForPickerSet(sc).catch(() => [] as Card[])));
      if (seq !== pickerSeq) return;
      const byId = new Map<string, Card>();
      for (const arr of loaded) for (const c of arr) byId.set(c.id, c);
      deckCardChoices = ids.map((id) => byId.get(id)).filter((c): c is Card => !!c);
    } catch {
      if (seq === pickerSeq) pickerErr = '讀取牌組卡片失敗';
    } finally {
      if (seq === pickerSeq) pickerLoading = false;
    }
  }

  function dedupeCardsById(cards: Card[]): Card[] {
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const c of cards) {
      if (!c || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }

  async function loadCardsForSelection(code: string, seq: number) {
    if (code === 'all') {
      if (!allPoolCardsCache) {
        const all = await loadAllCardsForPicker();
        if (seq !== pickerSeq) return;
        allPoolCardsCache = dedupeCardsById(all);
      }
      if (seq !== pickerSeq) return;
      pickerCards = allPoolCardsCache;
    } else {
      const cards = await loadCardsForPickerSet(code);
      if (seq !== pickerSeq) return;
      pickerCards = dedupeCardsById(cards);
    }
  }

  async function loadSetList() {
    const seq = ++pickerSeq;
    pickerLoading = true;
    pickerErr = '';
    try {
      if (pickerSets.length === 0) {
        const idx = await listAllCardSetsForPicker();
        if (seq !== pickerSeq) return;
        pickerSets = Array.isArray(idx) ? idx : [];
      }
      const targetSet = pickerSelectedSet || 'all';
      pickerSelectedSet = targetSet;
      await loadCardsForSelection(targetSet, seq);
    } catch {
      if (seq === pickerSeq) pickerErr = '讀取卡包清單失敗';
    } finally {
      if (seq === pickerSeq) pickerLoading = false;
    }
  }

  async function selectSetCode(code: string) {
    const seq = ++pickerSeq;
    pickerSelectedSet = code || 'all';
    pickerLimit = 36;
    pickerLoading = true;
    pickerErr = '';
    try {
      await loadCardsForSelection(pickerSelectedSet, seq);
    } catch {
      if (seq === pickerSeq) pickerErr = '讀取卡包資料失敗';
    } finally {
      if (seq === pickerSeq) pickerLoading = false;
    }
  }

  function pickCard(card: Card) {
    avatar = clampAvatarCrop({
      cardId: card.id,
      x: PROF_DEFAULT_CROP.x,
      y: PROF_DEFAULT_CROP.y,
      zoom: PROF_DEFAULT_CROP.zoom,
    });
    pickerOpen = false;
    saveMsg = '';
  }

  function resetCrop() {
    if (!avatar) return;
    avatar = clampAvatarCrop({
      cardId: avatar.cardId,
      x: PROF_DEFAULT_CROP.x,
      y: PROF_DEFAULT_CROP.y,
      zoom: PROF_DEFAULT_CROP.zoom,
    });
    saveMsg = '';
  }

  function setZoom(z: number) {
    if (!avatar) return;
    avatar = clampAvatarCrop({ cardId: avatar.cardId, x: avatar.x, y: avatar.y, zoom: z });
    saveMsg = '';
  }

  function startDrag(e: PointerEvent) {
    if (!avatar) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragActive = true;
    dragStart = { px: e.clientX, py: e.clientY, x: avatar.x, y: avatar.y };
  }

  function moveDrag(e: PointerEvent) {
    if (!dragActive || !avatar) return;
    const dx = e.clientX - dragStart.px;
    const dy = e.clientY - dragStart.py;
    const cardW = RING_PX * avatar.zoom;
    const cardH = cardW * PROF_CARD_HW;
    avatar = clampAvatarCrop({
      cardId: avatar.cardId,
      x: dragStart.x - dx / cardW,
      y: dragStart.y - dy / cardH,
      zoom: avatar.zoom,
    });
  }

  function endDrag() {
    dragActive = false;
  }

  function toggleHonor(h: ProfileHonor) {
    const idx = pinnedIds.indexOf(h.eventId);
    if (idx >= 0) {
      pinnedIds = pinnedIds.filter((id) => id !== h.eventId);
    } else if (pinnedIds.length < PROF_MAX_HONORS) {
      pinnedIds = [...pinnedIds, h.eventId];
    }
    saveMsg = '';
  }
</script>

<div class="ppe-wrap">
  <div class="ppe-head">
    <div class="ppe-head-l">
      <h3>🪪 玩家名片與頭像設定</h3>
      {#if serverProfile?.googleVerified}
        <span class="ppe-g-tag">✓ Google 已認證</span>
      {/if}
    </div>
    {#if collapsible}
      <button
        type="button"
        class="ppe-btn ppe-collapse-btn"
        aria-expanded={!collapsed}
        onclick={toggleCollapsed}
      >
        {collapsed ? '▼ 展開設定' : '▲ 收合設定'}
      </button>
    {/if}
  </div>

  {#if loading}
    {#if !collapsible || !collapsed}
      <p class="ppe-muted">讀取名片資料中…</p>
    {/if}
  {:else if loadErr}
    <p class="ppe-err">{loadErr}</p>
  {:else if serverProfile}
    <!-- 名片預覽列（即使設定區收合，仍保留摘要與查看自己名片鈕） -->
    <div class="ppe-preview-bar" class:is-collapsed={collapsible && collapsed}>
      <AvatarCircle {avatar} frame={serverProfile.avatarFrame} name={effectiveNick} size={56} ring />
      <AvatarCircle {avatar} frame={serverProfile.avatarFrame} name={effectiveNick} size={28} />
      <div class="ppe-pv-info">
        <div class="ppe-pv-nick">
          {effectiveNick}
          {#if serverFrameSpec}
            <span class="ppe-pv-frame-tag">✨ {serverFrameSpec.name}</span>
          {/if}
        </div>
        <div class="ppe-pv-crowns" role="group" aria-label="點擊切換名片統計顯示與隱藏">
          <button
            type="button"
            class="ppe-stat-toggle is-wins"
            class:is-off={!showTotalWins}
            aria-pressed={showTotalWins}
            title="點一下顯示／再點一下不顯示總勝場數"
            onclick={() => { showTotalWins = !showTotalWins; saveMsg = ''; }}
          >{showTotalWins ? '⚔️' : '🙈'} 總勝 {serverProfile.totalWins ?? 0} 勝</button>
          <button
            type="button"
            class="ppe-stat-toggle is-site"
            class:is-off={!showOfficialCrowns}
            aria-pressed={showOfficialCrowns}
            title="點一下顯示／再點一下不顯示網站賽奪冠數"
            onclick={() => { showOfficialCrowns = !showOfficialCrowns; saveMsg = ''; }}
          >{showOfficialCrowns ? '🏛️' : '🙈'} 網站賽 {serverProfile.champOfficial} 冠</button>
          <button
            type="button"
            class="ppe-stat-toggle is-comm"
            class:is-off={!showCommunityCrowns}
            aria-pressed={showCommunityCrowns}
            title="點一下顯示／再點一下不顯示社群賽奪冠數"
            onclick={() => { showCommunityCrowns = !showCommunityCrowns; saveMsg = ''; }}
          >{showCommunityCrowns ? '🎖️' : '🙈'} 社群賽 {serverProfile.champCommunity} 冠</button>
        </div>
        {#if !collapsible || !collapsed}
          <div class="ppe-pv-tip">💡 點一下上方戰績徽章即可切換「顯示／不顯示」（按下方儲存後生效）</div>
        {/if}
      </div>
      <button
        type="button"
        class="ppe-btn ppe-self-card-btn"
        onclick={() => { selfPreviewOpen = true; }}
        title="預覽、下載或分享我的玩家名片"
      >
        🪪 名片
      </button>
    </div>

    {#if !collapsible || !collapsed}
    <!-- 暱稱與自我介紹 -->
    <label class="ppe-field">
      <span class="ppe-label">玩家暱稱 <small>（最多 {PROF_NICK_MAX} 字）</small></span>
      <input
        class="ppe-input"
        type="text"
        maxlength={PROF_NICK_MAX}
        placeholder={serverProfile.defaultNick ? `未填時沿用「${serverProfile.defaultNick}」` : '輸入你的公開顯示暱稱'}
        bind:value={nick}
        oninput={() => { saveMsg = ''; }}
      />
      <small class="ppe-hint">儲存後會同步作為「線上大廳預設名稱」與「未報名錦標賽聊天室暱稱」。</small>
    </label>

    <label class="ppe-field">
      <span class="ppe-label">自我介紹 <small>（{bio.length} / {PROF_BIO_MAX}）</small></span>
      <textarea
        class="ppe-textarea"
        rows={3}
        maxlength={PROF_BIO_MAX}
        placeholder="簡短介紹你的愛用牌組、常駐時段或想對對手說的話…"
        bind:value={bio}
        oninput={() => { saveMsg = ''; }}
      ></textarea>
    </label>

    <!-- 官方卡片圓圈頭像設定 -->
    <div class="ppe-section">
      <div class="ppe-label-row">
        <span class="ppe-label">官方卡牌圓圈頭像</span>
        <div class="ppe-av-btns">
          <button type="button" class="ppe-btn" onclick={openCardPicker}>
            {pickerOpen ? '▲ 收合選卡' : (avatar ? '🎴 更換卡片' : '🎴 挑選官方卡片')}
          </button>
          {#if avatar}
            <button type="button" class="ppe-btn ppe-btn-ghost" onclick={() => { avatar = null; saveMsg = ''; }}>移除頭像</button>
          {/if}
        </div>
      </div>

      {#if pickerOpen}
        <div class="ppe-picker">
          <div class="ppe-picker-tabs">
            <button type="button" class="ppe-ptab" class:active={pickerSource === 'decks'} onclick={() => switchPickerSource('decks')}>📁 從我的牌組</button>
            <button type="button" class="ppe-ptab" class:active={pickerSource === 'sets'} onclick={() => switchPickerSource('sets')}>🃏 依卡包／卡名</button>
          </div>
          <div class="ppe-picker-filters">
            {#if pickerSource === 'sets'}
              <select class="ppe-select" aria-label="選擇卡包" value={pickerSelectedSet} onchange={(e) => selectSetCode(e.currentTarget.value)}>
                <option value="all">ALL 全部卡牌{pickerTotalCount > 0 ? `（${pickerTotalCount}）` : ''}</option>
                {#each pickerSets as st (st.code)}
                  <option value={st.code}>{st.code} {st.name}（{st.cardCount}）</option>
                {/each}
              </select>
            {/if}
            <input class="ppe-search" type="search" placeholder="搜尋卡名或卡號…" bind:value={pickerQuery} oninput={() => { pickerLimit = 36; }} />
          </div>
          {#if pickerLoading}
            <p class="ppe-muted">載入卡片中…</p>
          {:else if pickerErr}
            <p class="ppe-err">{pickerErr}</p>
          {:else if visibleCards.length === 0}
            <p class="ppe-muted">{pickerSource === 'decks' ? '「我的牌組」目前沒有卡片，可切到「依卡包／卡名」選擇。' : '找不到符合條件的卡片。'}</p>
          {:else}
            <div class="ppe-card-grid">
              {#each visibleCards as c (c.id)}
                <button type="button" class="ppe-card-item" class:selected={avatar?.cardId === c.id} title={`${c.name} (${c.id})`} onclick={() => pickCard(c)}>
                  <img use:retryImg={c.imageUrl} src={cardThumb(c.imageUrl)} alt={c.name} loading="lazy" />
                  <span>{c.name}</span>
                </button>
              {/each}
            </div>
            {#if filteredCards.length > visibleCards.length}
              <button type="button" class="ppe-btn ppe-more" onclick={() => { pickerLimit += 48; }}>
                顯示更多卡片（尚餘 {filteredCards.length - visibleCards.length} 張）
              </button>
            {/if}
          {/if}
        </div>
      {/if}

      {#if avatar && previewUrl}
        <div class="ppe-cropper-box">
          <div
            class="ppe-stage"
            class:dragging={dragActive}
            style:width={`${STAGE_PX}px`}
            style:height={`${STAGE_PX}px`}
            role="application"
            aria-label="拖曳底下卡片對準中央圓圈位置"
            onpointerdown={startDrag}
            onpointermove={moveDrag}
            onpointerup={endDrag}
            onpointercancel={endDrag}
          >
            <img
              class="ppe-stage-img"
              use:retryImg={previewUrl}
              src={previewUrl}
              alt="頭像裁切預覽"
              draggable="false"
              style:width={`${RING_PX * avatar.zoom}px`}
              style:height={`${RING_PX * avatar.zoom * PROF_CARD_HW}px`}
              style:transform={`translate(${-avatar.x * 100}%, ${-avatar.y * 100}%)`}
            />
            <div class="ppe-spotlight-mask" aria-hidden="true"></div>
            <div class="ppe-spotlight-ring" aria-hidden="true"></div>
          </div>
          <div class="ppe-crop-controls">
            <label class="ppe-zoom-row">
              <span>縮放 {avatar.zoom.toFixed(2)}×</span>
              <input
                type="range"
                min="1"
                max="3.5"
                step="0.05"
                value={avatar.zoom}
                oninput={(e) => setZoom(Number(e.currentTarget.value))}
              />
            </label>
            <div class="ppe-crop-tips">
              <span>💡 手指／滑鼠拖動底下卡牌對準圓框</span>
              <button type="button" class="ppe-btn ppe-btn-ghost" onclick={resetCrop}>↺ 重設位置</button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- 代表榮譽勾選（網站賽＋社群賽冠軍，最多 10 筆） -->
    <div class="ppe-section">
      <div class="ppe-label-row">
        <span class="ppe-label">🏅 代表榮譽 <small>（網站賽名次／社群賽冠軍，{pinnedIds.length} / {PROF_MAX_HONORS}）</small></span>
      </div>
      {#if !serverProfile.availableHonors || serverProfile.availableHonors.length === 0}
        <p class="ppe-muted">目前尚無可掛載的錦標賽榮譽紀錄（取得網站賽 8 強以上或社群賽冠軍後會自動列入）。</p>
      {:else}
        <div class="ppe-honors-pick">
          {#each serverProfile.availableHonors as h (h.eventId)}
            {@const checked = pinnedIds.includes(h.eventId)}
            {@const disabled = !checked && pinnedIds.length >= PROF_MAX_HONORS}
            <label class="ppe-honor-opt" class:checked class:disabled>
              <input type="checkbox" {checked} {disabled} onchange={() => toggleHonor(h)} />
              <span class="ppe-h-badge" class:comm={h.kind === 'comm'}>{h.kind === 'comm' ? '🎖️ 社群賽' : '🏛️ 網站賽'}</span>
              {#if h.date}<span class="ppe-h-date">{formatHonorDate(h.date)}</span>{/if}
              <span class="ppe-h-ev">{h.eventName} · <b>{h.placementLabel}</b></span>
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="ppe-actions">
      <button type="button" class="ppe-save" disabled={saving} onclick={saveProfile}>
        {saving ? '儲存中…' : '💾 儲存個人名片'}
      </button>
      {#if saveMsg}
        <span class={saveOk ? 'ppe-save-ok' : 'ppe-err'} role="status">{saveMsg}</span>
      {/if}
    </div>
    {/if}
  {/if}
</div>

<PlayerProfileModal
  open={selfPreviewOpen}
  previewCard={livePreviewCard}
  {getAuthCtx}
  onclose={() => { selfPreviewOpen = false; }}
/>

<style>
  .ppe-wrap {
    border: 1px solid #35583a;
    border-radius: 12px;
    padding: 14px;
    background: rgba(15, 31, 21, 0.85);
    color: #e6f4ea;
    text-align: left;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-wrap {
    background: var(--ui-bg-elev, #eef2ef);
    color: var(--ui-text, #1c2420);
    border-color: var(--ui-border, #bbc7bf);
  }
  .ppe-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .ppe-head-l {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    flex: 1;
  }
  .ppe-head h3 { margin: 0; font-size: 1rem; }
  .ppe-collapse-btn, .ppe-self-card-btn {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .ppe-g-tag {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(66, 133, 244, 0.2);
    border: 1px solid rgba(114, 171, 255, 0.45);
    color: #b7d7ff;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-g-tag {
    background: #e7f0fd;
    color: #1953ad;
    border-color: #aac6f7;
  }
  .ppe-preview-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(120, 196, 138, 0.2);
    margin-bottom: 12px;
  }
  .ppe-preview-bar.is-collapsed { margin-bottom: 0; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-preview-bar {
    background: var(--ui-bg-sunken, #dfe5e1);
    border-color: var(--ui-border, #bbc7bf);
  }
  .ppe-pv-info { min-width: 0; flex: 1; }
  .ppe-pv-nick { font-weight: 700; font-size: 0.96rem; overflow-wrap: anywhere; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ppe-pv-frame-tag {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid rgba(255, 215, 100, 0.45);
    background: rgba(255, 224, 130, 0.14);
    color: #ffe89e;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-pv-frame-tag {
    background: #fdf4d8;
    border-color: #d6b665;
    color: #785100;
  }
  .ppe-pv-crowns {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 5px;
  }
  .ppe-stat-toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255, 211, 90, 0.48);
    background: rgba(15, 29, 20, 0.72);
    color: #ffe087;
    font: inherit;
    font-size: 0.73rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.14s ease, filter 0.14s ease;
  }
  .ppe-stat-toggle.is-wins {
    border-color: rgba(130, 224, 166, 0.48);
    color: #b8f5cb;
  }
  .ppe-stat-toggle.is-comm {
    border-color: rgba(143, 220, 192, 0.45);
    color: #9ae8cb;
  }
  .ppe-stat-toggle.is-off {
    opacity: 0.46;
    text-decoration: line-through;
    filter: grayscale(0.5);
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-stat-toggle {
    background: #fff;
    color: #7b5300;
    border-color: #d6b665;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-stat-toggle.is-wins {
    color: #165e32;
    border-color: #84c599;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-stat-toggle.is-comm {
    color: #165e46;
    border-color: #8bc7ae;
  }
  .ppe-pv-tip {
    margin-top: 4px;
    font-size: 0.7rem;
    opacity: 0.78;
    line-height: 1.35;
  }
  .ppe-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 12px;
  }
  .ppe-label { font-size: 0.85rem; font-weight: 600; }
  .ppe-label small { font-weight: 400; opacity: 0.78; }
  .ppe-input, .ppe-textarea, .ppe-select, .ppe-search {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid #486e50;
    background: #0d1d13;
    color: inherit;
    font: inherit;
    font-size: 16px;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-input,
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-textarea,
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-select,
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-search {
    background: #fff;
    border-color: var(--ui-border, #b7c3bb);
  }
  .ppe-textarea { resize: vertical; min-height: 68px; }
  .ppe-hint { font-size: 0.75rem; opacity: 0.78; line-height: 1.4; }
  .ppe-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(120, 196, 138, 0.18);
  }
  .ppe-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .ppe-av-btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .ppe-btn {
    padding: 5px 11px;
    border-radius: 7px;
    border: 1px solid #599166;
    background: #1a3522;
    color: #dcf7e2;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .ppe-btn-ghost { background: transparent; border-color: rgba(155, 190, 165, 0.35); color: inherit; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-btn {
    background: #dff0e5;
    border-color: #7eb893;
    color: #16482b;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-btn-ghost { background: transparent; color: inherit; }
  .ppe-picker {
    border: 1px solid rgba(120, 196, 138, 0.25);
    border-radius: 10px;
    padding: 10px;
    margin-bottom: 10px;
    background: rgba(8, 17, 11, 0.6);
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-picker {
    background: var(--ui-bg, #e3e7e4);
  }
  .ppe-picker-tabs { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .ppe-ptab {
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid rgba(120, 196, 138, 0.3);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .ppe-ptab.active {
    background: #27583a;
    border-color: #6ab87a;
    color: #ecffef;
    font-weight: 700;
  }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-ptab.active {
    background: #236447;
    color: #fff;
  }
  .ppe-picker-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .ppe-picker-filters .ppe-select { flex: 1 1 170px; }
  .ppe-picker-filters .ppe-search { flex: 1 1 150px; }
  .ppe-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
    gap: 6px;
    max-height: 260px;
    overflow-y: auto;
  }
  .ppe-card-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 4px;
    border-radius: 7px;
    border: 1px solid rgba(120, 196, 138, 0.22);
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    font: inherit;
    font-size: 0.68rem;
    cursor: pointer;
  }
  .ppe-card-item.selected { border-color: #82e39a; box-shadow: 0 0 0 1px #82e39a; }
  .ppe-card-item img { width: 100%; aspect-ratio: 868 / 1212; object-fit: cover; border-radius: 4px; }
  .ppe-card-item span { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .ppe-more { margin-top: 8px; width: 100%; }
  .ppe-cropper-box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    margin-top: 8px;
  }
  .ppe-stage {
    position: relative;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid rgba(120, 196, 138, 0.38);
    background: #08120c;
    touch-action: none;
    cursor: grab;
    flex-shrink: 0;
    user-select: none;
  }
  .ppe-stage.dragging { cursor: grabbing; }
  .ppe-stage-img {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: none;
    max-height: none;
    pointer-events: none;
  }
  .ppe-spotlight-mask {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(circle 84px at 50% 50%, transparent 83.5px, rgba(6, 12, 8, 0.64) 84.5px);
  }
  .ppe-spotlight-ring {
    position: absolute;
    width: 168px;
    height: 168px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.92);
    box-shadow: 0 0 0 1px rgba(106, 184, 122, 0.8);
    pointer-events: none;
  }
  .ppe-crop-controls {
    flex: 1 1 190px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ppe-zoom-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.8rem;
  }
  .ppe-crop-tips {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 0.74rem;
    opacity: 0.82;
  }
  .ppe-honors-pick {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 220px;
    overflow-y: auto;
  }
  .ppe-honor-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid rgba(120, 196, 138, 0.2);
    background: rgba(255, 255, 255, 0.03);
    font-size: 0.78rem;
    cursor: pointer;
    min-width: 0;
  }
  .ppe-honor-opt.checked { border-color: #6ab87a; background: rgba(45, 92, 62, 0.25); }
  .ppe-honor-opt.disabled { opacity: 0.45; cursor: not-allowed; }
  .ppe-h-badge {
    flex-shrink: 0;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 211, 90, 0.16);
    color: #ffe28a;
  }
  .ppe-h-badge.comm { background: rgba(143, 220, 192, 0.16); color: #9be7cb; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-h-badge { background: #fdf3d7; color: #7a5200; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-h-badge.comm { background: #dff3eb; color: #155c43; }
  .ppe-h-date { flex-shrink: 0; opacity: 0.76; font-size: 0.72rem; }
  .ppe-h-ev { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ppe-actions {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ppe-save {
    padding: 8px 18px;
    min-height: 40px;
    border-radius: 8px;
    border: 1px solid #6ab87a;
    background: linear-gradient(180deg, #2c6841, #1f4c2f);
    color: #f0fff3;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .ppe-save:disabled { opacity: 0.55; cursor: default; }
  .ppe-save-ok { font-size: 0.84rem; color: #84f59f; font-weight: 600; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-save-ok { color: #1a7f44; }
  .ppe-err { font-size: 0.84rem; color: #ff8e8e; }
  .ppe-muted { font-size: 0.82rem; opacity: 0.78; margin: 6px 0; }
</style>
