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
  import {
    PROF_NICK_MAX,
    PROF_BIO_MAX,
    PROF_MAX_HONORS,
    PROF_CARD_HW,
    PROF_DEFAULT_CROP,
    clampAvatarCrop,
    cardImageUrlFromId,
    formatHonorDate,
    fetchMyProfile,
    saveMyProfile,
    listAllCardSetsForPicker,
    loadCardsForPickerSet,
    loadCardSetLookup,
    type AvatarCrop,
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
  }: {
    getAuthCtx: () => Promise<ProfileAuthCtx | null>;
    onsaved?: ((profile: PlayerProfileSelf) => void) | null;
    onloaded?: ((profile: PlayerProfileSelf) => void) | null;
  } = $props();

  let loading = $state(true);
  let loadErr = $state('');
  let saving = $state(false);
  let saveMsg = $state('');
  let saveOk = $state(false);

  let serverProfile = $state<PlayerProfileSelf | null>(null);
  let nick = $state('');
  let bio = $state('');
  let avatar = $state<AvatarCrop | null>(null);
  let pinnedIds = $state<string[]>([]);

  // 卡池選擇器（打開時才懶載入）
  let pickerOpen = $state(false);
  let pickerSource = $state<'decks' | 'sets'>('decks');
  let pickerLoading = $state(false);
  let pickerErr = $state('');
  let pickerQuery = $state('');
  let pickerSets = $state<Array<{ code: string; name: string; cardCount: number }>>([]);
  let pickerSelectedSet = $state('');
  let pickerCards = $state<Card[]>([]);
  let deckCardChoices = $state<Card[]>([]);
  let pickerLimit = $state(36);

  // 圓框拖曳狀態
  let dragActive = $state(false);
  let dragStart = { px: 0, py: 0, x: 0.5, y: 0.34 };

  const previewUrl = $derived(avatar ? cardImageUrlFromId(avatar.cardId) : null);
  const effectiveNick = $derived((nick.trim() || serverProfile?.defaultNick || '玩家').slice(0, PROF_NICK_MAX));
  const filteredCards = $derived.by(() => {
    const src = pickerSource === 'decks' ? deckCardChoices : pickerCards;
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return src;
    return src.filter((c) => (c.name && c.name.toLowerCase().includes(q)) || String(c.id).includes(q));
  });
  const visibleCards = $derived(filteredCards.slice(0, pickerLimit));

  onMount(() => {
    void loadProfile();
  });

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

  async function loadSetList() {
    const seq = ++pickerSeq;
    pickerLoading = true;
    pickerErr = '';
    try {
      if (pickerSets.length === 0) {
        const idx = await listAllCardSetsForPicker();
        if (seq !== pickerSeq) return;
        pickerSets = Array.isArray(idx) ? idx : [];
        if (pickerSets.length > 0 && !pickerSelectedSet) {
          pickerSelectedSet = pickerSets[0].code;
        }
      }
      if (pickerSelectedSet) {
        const cards = await loadCardsForPickerSet(pickerSelectedSet);
        if (seq !== pickerSeq) return;
        pickerCards = cards;
      }
    } catch {
      if (seq === pickerSeq) pickerErr = '讀取卡包清單失敗';
    } finally {
      if (seq === pickerSeq) pickerLoading = false;
    }
  }

  async function selectSetCode(code: string) {
    const seq = ++pickerSeq;
    pickerSelectedSet = code;
    pickerLimit = 36;
    pickerLoading = true;
    pickerErr = '';
    try {
      const cards = await loadCardsForPickerSet(code);
      if (seq !== pickerSeq) return;
      pickerCards = cards;
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
    <h3>🪪 玩家名片與頭像設定</h3>
    {#if serverProfile?.googleVerified}
      <span class="ppe-g-tag">✓ Google 已認證</span>
    {/if}
  </div>

  {#if loading}
    <p class="ppe-muted">讀取名片資料中…</p>
  {:else if loadErr}
    <p class="ppe-err">{loadErr}</p>
  {:else if serverProfile}
    <!-- 名片預覽列 -->
    <div class="ppe-preview-bar">
      <AvatarCircle {avatar} name={effectiveNick} size={56} ring />
      <AvatarCircle {avatar} name={effectiveNick} size={28} />
      <div class="ppe-pv-info">
        <div class="ppe-pv-nick">{effectiveNick}</div>
        <div class="ppe-pv-crowns">
          🏛️ 網站賽 {serverProfile.champOfficial} 冠 ｜ 🎖️ 社群賽 {serverProfile.champCommunity} 冠
        </div>
      </div>
    </div>

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
        <span class="ppe-label">官方卡牌圓圈頭像 <small>（全卡池開放選取）</small></span>
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
                {#each pickerSets as st (st.code)}
                  <option value={st.code}>{st.code} {st.name}（{st.cardCount}）</option>
                {/each}
              </select>
            {/if}
            <input class="ppe-search" type="search" placeholder="搜尋卡名或卡號…" bind:value={pickerQuery} />
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
</div>

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
  .ppe-head h3 { margin: 0; font-size: 1rem; }
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
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-preview-bar {
    background: var(--ui-bg-sunken, #dfe5e1);
    border-color: var(--ui-border, #bbc7bf);
  }
  .ppe-pv-info { min-width: 0; flex: 1; }
  .ppe-pv-nick { font-weight: 700; font-size: 0.96rem; overflow-wrap: anywhere; }
  .ppe-pv-crowns { font-size: 0.76rem; color: #ffe087; margin-top: 2px; }
  :global(html[data-theme='light']:not([data-battle-view])) .ppe-pv-crowns { color: #7b5300; }
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
