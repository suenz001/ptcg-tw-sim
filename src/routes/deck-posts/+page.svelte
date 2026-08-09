<script lang="ts">
  // 牌組公布欄（v6.139 批次 2：讀 ＋ 匯入）。
  //
  // 設計定案：docs/牌組公布欄-設計定案.md。後端是 v6.138 批次 1。
  // 本批只做「瀏覽 ＋ 匯入到自己的牌組」；投稿入口與按讚按鈕在批次 3。
  //
  // ⚠ 幾件刻意的決定：
  //   ・明細用 loadDeckSets 只載這副牌需要的卡包，不是 loadAllSets（40 個卡包 4.6MB，
  //     /cards 全量渲染曾經是效能事故源，v6.118）。
  //   ・牌表用文字列表，不渲染 60 張卡圖。
  //   ・API 只有正式站有（beta github.io 沒有 Oracle 端點）→ 明確顯示，不要讓人以為壞了。
  //   ・所有欄位都走 Svelte 的預設 escape，全頁不得出現 {@html}（投稿內容是玩家自由輸入）。
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import type { Card } from '$lib/cards/types';
  import { loadDeckSets, buildCardIndex } from '$lib/cards/pool';
  import { migrateDeck } from '$lib/decks/cardIdMigration';
  import { newDeck, upsertDeck, loadDecks } from '$lib/decks/storage';
  import { syncDeckToCloud } from '$lib/decks/cloud';
  import { validateDeck } from '$lib/decks/validation';
  import type { Deck } from '$lib/decks/types';
  import { VERSION } from '$lib/version';
  import { auth } from '$lib/firebase';
  import { onAuthStateChanged, type User } from 'firebase/auth';

  type PostSummary = {
    id: string;
    authorName: string;
    deckName: string;
    notes: string;
    archetype: string;
    cardTotal: number;
    likeCount: number;
    downloadCount: number;
    createdAt: number;
    tournament: null | { eventId: string; eventName: string; finishedAt: number; placementLabel: string };
  };
  type PostDetail = PostSummary & { entries: { cardId: string; count: number }[] };

  const API = '/api/deck-posts';

  let firebaseUser = $state<User | null>(null);
  let posts = $state<PostSummary[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 20;
  let sort = $state<'new' | 'likes' | 'downloads'>('new');
  let tournamentOnly = $state(false);
  let loading = $state(true);
  let loadError = $state('');
  let apiUnavailable = $state(false);

  // 明細
  let openPost = $state<PostDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state('');
  let detailCards = $state<Map<string, Card>>(new Map());
  let detailMissing = $state<string[]>([]);
  let importMsg = $state('');
  let importWarn = $state('');

  // ⚠ 請求代次（Fable 5 review 指出，我查證屬實）。兩個問題共用同一套解法：
  //   ① 明細載入中沒有關閉按鈕、closeDetail 又不清 detailLoading ⇒ 慢請求會把玩家鎖在
  //      全屏 backdrop 後面；而且「以為關掉了」之後，遲到的回應還會把 modal 重新彈開。
  //   ② 列表快速切排序／換頁時，慢的舊回應最後到就會蓋掉新的 ⇒ tab 與內容對不上
  //      （與 v6.135 錦標賽輪詢亂序是同一類 bug）。
  //   只有「這一發仍是最新一發」才允許寫回狀態。
  let listSeq = 0;
  let detailSeq = 0;

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  onMount(() => {
    const un = onAuthStateChanged(auth, (u) => { firebaseUser = u; });
    void fetchList();
    return un;
  });

  /** 帶 Firebase ID token（拿不到就不帶 —— 未登入者仍可瀏覽與匯入，只是不計數）。 */
  async function authHeaders(): Promise<Record<string, string>> {
    const h: Record<string, string> = {};
    try {
      const u = auth.currentUser;
      if (u && !u.isAnonymous) h['Authorization'] = 'Bearer ' + (await u.getIdToken());
    } catch { /* 取 token 失敗 → 當未登入處理 */ }
    return h;
  }

  /**
   * 呼叫公布欄 API。
   * ⚠ beta 測試站（github.io）沒有 Oracle 端點，請求會被靜態站的 404 頁接走 →
   *   回應不是 JSON。要把這種情況跟「真的出錯」分開，否則玩家看到的是莫名其妙的解析錯誤。
   */
  async function api(path: string, init?: RequestInit): Promise<any> {
    let res: Response;
    try {
      res = await fetch(API + path, init);
    } catch (e: any) {
      throw new Error('連線失敗：' + String(e?.message ?? e));
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // ⚠ 「回應不是 JSON」有兩種完全不同的原因，不能混為一談（Fable 5 review 指出）：
      //   ・測試站根本沒有這個 API（靜態站的 404 頁）→ 告訴玩家哪裡才有
      //   ・正式站的 tunnel 掛了（502/530 的 HTML 錯誤頁）→ 這是暫時性故障
      //   舊寫法一律當前者 ⇒ 正式站玩家會看到一段斷言他在測試站的公告，而且永久隱藏整個 UI。
      if (res.status >= 500) throw new Error('伺服器暫時無法連線，請稍後再試');
      apiUnavailable = true;
      throw new Error('unavailable');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || ('HTTP ' + res.status));
    return data;
  }

  async function fetchList() {
    const seq = ++listSeq;
    loading = true; loadError = '';
    try {
      const q = new URLSearchParams({ sort, page: String(page), pageSize: String(pageSize) });
      if (tournamentOnly) q.set('tournamentOnly', '1');
      const r = await api('?' + q.toString());
      if (seq !== listSeq) return;              // 已經有更新的一發，這份結果作廢
      posts = r.posts || [];
      total = r.total || 0;
    } catch (e: any) {
      if (seq !== listSeq) return;
      if (String(e?.message) !== 'unavailable') loadError = String(e?.message ?? e);
    } finally {
      if (seq === listSeq) loading = false;
    }
  }

  function changeSort(s: 'new' | 'likes' | 'downloads') {
    if (sort === s) return;
    sort = s; page = 1; void fetchList();
  }
  function toggleTournamentOnly() {
    tournamentOnly = !tournamentOnly; page = 1; void fetchList();
  }
  function goPage(p: number) {
    const np = Math.max(1, Math.min(totalPages, p));
    if (np === page) return;
    page = np; void fetchList();
  }

  async function openDetail(id: string) {
    const seq = ++detailSeq;
    detailLoading = true; detailError = ''; importMsg = ''; importWarn = '';
    openPost = null; detailCards = new Map(); detailMissing = [];
    try {
      const r = await api('/' + encodeURIComponent(id), { headers: await authHeaders() });
      if (seq !== detailSeq) return;           // 玩家已關閉或改點別篇 ⇒ 不得把 modal 彈回來
      const post: PostDetail = r.post;
      const { cards, missingIds } = await loadDeckSets(post.entries.map((e) => e.cardId));
      if (seq !== detailSeq) return;
      openPost = post;
      detailCards = buildCardIndex(cards);
      detailMissing = missingIds;
    } catch (e: any) {
      if (seq !== detailSeq) return;
      if (String(e?.message) !== 'unavailable') detailError = String(e?.message ?? e);
    } finally {
      if (seq === detailSeq) detailLoading = false;
    }
  }
  /** ⚠ 一定要遞增 detailSeq 並清掉 detailLoading，否則載入中的 modal 關不掉。 */
  function closeDetail() {
    detailSeq++;
    openPost = null; detailLoading = false; detailError = ''; importMsg = ''; importWarn = '';
  }

  /** 依卡種分組的牌表（文字，不渲染卡圖）。 */
  const detailRows = $derived.by(() => {
    const p = openPost;
    if (!p) return [] as { group: string; items: { name: string; count: number; sub: string }[] }[];
    const groups = new Map<string, { name: string; count: number; sub: string }[]>();
    for (const e of p.entries) {
      const c = detailCards.get(e.cardId);
      const g = !c ? '未知卡片' : c.supertype === 'Pokemon' ? '寶可夢' : c.supertype === 'Trainer' ? '訓練家' : '能量';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push({
        name: c ? c.name : '（本站沒有這張卡 · id ' + e.cardId + '）',
        count: e.count,
        sub: c ? [c.setCode, c.collectorNumber].filter(Boolean).join(' ') : '',
      });
    }
    const order = ['寶可夢', '訓練家', '能量', '未知卡片'];
    return order.filter((g) => groups.has(g)).map((g) => ({
      group: g,
      items: groups.get(g)!.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'zh-Hant')),
    }));
  });

  const detailCounts = $derived.by(() => {
    const p = openPost;
    if (!p) return { total: 0 };
    return { total: p.entries.reduce((n, e) => n + e.count, 0) };
  });

  /** 匯入到自己的牌組（本機儲存；雲端同步沿用牌組編輯器既有流程，這裡不重複實作）。 */
  function doImport() {
    const p = openPost;
    if (!p) return;
    importMsg = ''; importWarn = '';
    try {
      // 置頂：sortDecks 把沒有 order 的排在所有已設 order 的**後面**，
      //   不給 order 的話匯入的牌組會沉到最底（設計定案 §6 寫的是置頂）。
      const minOrder = loadDecks().reduce((m, x) => Math.min(m, x.order ?? 0), 0);
      const d: Deck = migrateDeck({
        ...newDeck(p.deckName + '（公布欄）'),
        entries: p.entries.map((e) => ({ cardId: e.cardId, count: e.count })),
        order: minOrder - 1,
      });
      upsertDeck(d);
      // ⚠ 雲端同步不能等玩家去編輯才做：牌組編輯器只在「儲存」時 syncDeckToCloud，
      //   而它的「從雲端載入」是整包覆蓋 ⇒ 匯入後沒編輯過的牌組會被無聲洗掉。
      const u = auth.currentUser;
      if (u && !u.isAnonymous) void syncDeckToCloud(u.uid, d).catch(() => { /* 離線時靜默，牌組已在本機 */ });
      // 合法性只是提示，不擋匯入 —— 標準輪替後舊投稿仍有保存與參考價值。
      const v = validateDeck(d, detailCards);
      if (!v.legal && v.issues.length) importWarn = v.issues[0];
      importMsg = '已加入你的牌組列表：' + d.name;
      void countDownload(p.id);
    } catch (e: any) {
      importWarn = '匯入失敗：' + String(e?.message ?? e);
    }
  }

  /** 下載計數。未登入時伺服器回 204 不計數 —— 這裡不需要區別，失敗也不影響匯入。 */
  async function countDownload(id: string) {
    try {
      await fetch(API + '/' + encodeURIComponent(id) + '/download', { method: 'POST', headers: await authHeaders() });
    } catch { /* 計數失敗不影響玩家，靜默 */ }
  }

  function fmtDate(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
</script>

<svelte:head>
  <title>牌組公布欄 · ptcg-tw-sim</title>
  <meta name="description" content="玩家分享的寶可夢集換式卡牌牌組，可直接匯入到自己的牌組列表。" />
</svelte:head>

<main>
  <header class="page-head">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>牌組公布欄 <span class="version-tag">v{VERSION}</span></h1>
    <span class="hint">玩家分享的牌組，可直接匯入</span>
    <a href="{base}/decks" class="to-decks">我的牌組 →</a>
  </header>

  {#if apiUnavailable}
    <p class="notice">
      這個功能只在正式站 <a href="https://www.ptcg-tw-sim.com/deck-posts">www.ptcg-tw-sim.com</a> 提供。
      目前所在的測試站沒有公布欄的伺服器端。
    </p>
  {:else}
    <div class="toolbar">
      <div class="sorts">
        <button class:active={sort === 'new'} onclick={() => changeSort('new')}>最新</button>
        <button class:active={sort === 'likes'} onclick={() => changeSort('likes')}>最多讚</button>
        <button class:active={sort === 'downloads'} onclick={() => changeSort('downloads')}>最多人收藏</button>
      </div>
      <label class="filter">
        <input type="checkbox" checked={tournamentOnly} onchange={toggleTournamentOnly} />
        只看賽事名次牌組
      </label>
    </div>

    {#if loadError}
      <p class="error">載入失敗：{loadError}</p>
    {/if}

    {#if loading}
      <p class="empty">載入中…</p>
    {:else if posts.length === 0}
      <p class="empty">
        {#if tournamentOnly}目前還沒有賽事名次牌組。{:else}目前還沒有人投稿。{/if}
      </p>
    {:else}
      <ul class="post-list">
        {#each posts as p (p.id)}
          <li>
            <button class="post-card" onclick={() => openDetail(p.id)}>
              <div class="row1">
                <span class="deck-name">{p.deckName}</span>
                {#if p.tournament}
                  <span class="badge tourn">{p.tournament.eventName} ｜ {p.tournament.placementLabel}</span>
                {/if}
                {#if p.archetype}
                  <span class="badge arche">{p.archetype}</span>
                {/if}
              </div>
              <div class="row2">
                <span class="author">{p.authorName}</span>
                <span class="dot">·</span>
                <span class="date">{fmtDate(p.createdAt)}</span>
                <span class="spacer"></span>
                <span class="stat" title="有多少位玩家按讚">♥ {p.likeCount}</span>
                <span class="stat" title="有多少位不同玩家收藏過這副牌">⬇ {p.downloadCount}</span>
              </div>
              {#if p.notes}
                <p class="notes">{p.notes}</p>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      {#if totalPages > 1}
        <nav class="pager">
          <button disabled={page <= 1} onclick={() => goPage(page - 1)}>← 上一頁</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onclick={() => goPage(page + 1)}>下一頁 →</button>
        </nav>
      {/if}
    {/if}
  {/if}
</main>

{#if openPost || detailLoading || detailError}
  <div class="modal-backdrop" role="presentation" onclick={closeDetail}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="牌組明細" onclick={(e) => e.stopPropagation()}>
      {#if detailLoading}
        <p class="empty">載入中…</p>
      {:else if detailError}
        <p class="error">{detailError}</p>
        <div class="modal-foot"><button onclick={closeDetail}>關閉</button></div>
      {:else if openPost}
        <header class="modal-head">
          <h2>{openPost.deckName}</h2>
          <button class="close" onclick={closeDetail} aria-label="關閉">✕</button>
        </header>
        <div class="meta">
          <span class="author">{openPost.authorName}</span>
          <span class="dot">·</span>
          <span>{fmtDate(openPost.createdAt)}</span>
          <span class="dot">·</span>
          <span>{detailCounts.total} 張</span>
          {#if openPost.tournament}
            <span class="badge tourn">{openPost.tournament.eventName} ｜ {openPost.tournament.placementLabel}</span>
          {/if}
          {#if openPost.archetype}
            <span class="badge arche">{openPost.archetype}</span>
          {/if}
        </div>
        {#if openPost.notes}
          <p class="notes-full">{openPost.notes}</p>
        {/if}

        {#if detailMissing.length > 0}
          <p class="warn">有 {detailMissing.length} 張卡片在本站卡庫查不到（可能已輪替或尚未收錄），匯入後會顯示為未知卡片。</p>
        {/if}

        <div class="deck-table">
          {#each detailRows as g (g.group)}
            <section>
              <h3>{g.group}</h3>
              <ul>
                {#each g.items as it, i (g.group + '_' + i)}
                  <li>
                    <span class="cnt">{it.count}</span>
                    <span class="nm">{it.name}</span>
                    {#if it.sub}<span class="sub">{it.sub}</span>{/if}
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>

        {#if importMsg}<p class="ok">{importMsg}</p>{/if}
        {#if importWarn}<p class="warn">{importWarn}</p>{/if}

        <div class="modal-foot">
          <button class="primary" onclick={doImport}>匯入到我的牌組</button>
          <a class="linkbtn" href="{base}/decks">前往牌組編輯器</a>
          <button onclick={closeDetail}>關閉</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  main { max-width: 900px; margin: 0 auto; padding: 12px 16px 48px; }
  .page-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .page-head h1 { font-size: 1.35rem; margin: 0; }
  .version-tag { font-size: .7rem; opacity: .55; font-weight: 400; }
  .back, .to-decks { font-size: .85rem; text-decoration: none; opacity: .8; }
  .to-decks { margin-left: auto; }
  .hint { font-size: .8rem; opacity: .6; }

  .notice { background: rgba(80,140,255,.12); border: 1px solid rgba(80,140,255,.4); border-radius: 8px; padding: 12px 14px; font-size: .9rem; line-height: 1.6; }
  .error { color: #d33; font-size: .9rem; }
  .ok { color: #1a8f4a; font-size: .9rem; }
  .warn { color: #b26a00; font-size: .85rem; line-height: 1.5; }
  .empty { opacity: .6; padding: 24px 0; text-align: center; }

  .toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .sorts { display: flex; gap: 6px; }
  .sorts button { padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; font-size: .85rem; }
  .sorts button.active { background: rgba(80,140,255,.18); border-color: rgba(80,140,255,.6); font-weight: 600; }
  .filter { font-size: .85rem; display: flex; align-items: center; gap: 6px; cursor: pointer; }

  .post-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .post-card { width: 100%; text-align: left; background: rgba(128,128,128,.07); border: 1px solid rgba(128,128,128,.2); border-radius: 10px; padding: 10px 12px; cursor: pointer; font: inherit; color: inherit; }
  .post-card:hover { background: rgba(128,128,128,.13); }
  .row1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .deck-name { font-weight: 600; }
  .row2 { display: flex; align-items: center; gap: 6px; font-size: .8rem; opacity: .75; margin-top: 4px; }
  .spacer { flex: 1; }
  .stat { white-space: nowrap; }
  .dot { opacity: .5; }
  .notes { margin: 6px 0 0; font-size: .82rem; opacity: .8; line-height: 1.5; }

  .badge { font-size: .72rem; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .badge.tourn { background: rgba(220,160,40,.2); border: 1px solid rgba(220,160,40,.5); }
  .badge.arche { background: rgba(80,140,255,.15); border: 1px solid rgba(80,140,255,.4); }

  .pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 16px; font-size: .85rem; }
  .pager button { padding: 5px 12px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; }
  .pager button:disabled { opacity: .4; cursor: default; }

  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 60; }
  .modal { background: var(--bg, #fff); color: inherit; border-radius: 12px; max-width: 720px; width: 100%; max-height: 88vh; overflow-y: auto; padding: 16px 18px 18px; }
  :global(html.dark) .modal { background: #1c1f24; }
  .modal-head { display: flex; align-items: center; gap: 12px; }
  .modal-head h2 { margin: 0; font-size: 1.1rem; flex: 1; }
  .close { background: transparent; border: none; font-size: 1.1rem; cursor: pointer; color: inherit; padding: 4px 8px; }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .82rem; opacity: .8; margin: 6px 0 10px; }
  .notes-full { font-size: .88rem; line-height: 1.6; background: rgba(128,128,128,.08); border-radius: 8px; padding: 8px 10px; margin: 0 0 12px; white-space: pre-wrap; }

  .deck-table { display: flex; flex-direction: column; gap: 12px; }
  .deck-table section h3 { font-size: .85rem; margin: 0 0 4px; opacity: .7; }
  .deck-table ul { list-style: none; margin: 0; padding: 0; }
  .deck-table li { display: flex; align-items: baseline; gap: 8px; font-size: .88rem; padding: 2px 0; }
  .cnt { min-width: 1.6em; text-align: right; font-variant-numeric: tabular-nums; opacity: .7; }
  .nm { flex: 1; }
  .sub { font-size: .72rem; opacity: .5; }

  .modal-foot { display: flex; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
  .modal-foot button, .linkbtn { padding: 7px 14px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; font: inherit; color: inherit; text-decoration: none; }
  .modal-foot button.primary { background: rgba(80,140,255,.9); border-color: transparent; color: #fff; font-weight: 600; }

  @media (max-width: 600px) {
    main { padding: 10px 12px 40px; }
    .to-decks { margin-left: 0; }
  }
</style>
