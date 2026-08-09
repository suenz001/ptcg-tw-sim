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
  type PostDetail = PostSummary & {
    entries: { cardId: string; count: number }[];
    likedByMe?: boolean;
    downloadedByMe?: boolean;
    mine?: boolean;
  };
  type MyPost = PostSummary & { status: 'published' | 'hidden' | 'deleted' };
  type Eligible = { eventId: string; eventName: string; finishedAt: number; placementLabel: string; alreadyPosted: boolean };

  // ⚠ 賽事與「我的投稿」端點的路徑是 /api/deck-posts-xxx（**連字號**，不是 /api/deck-posts/xxx）。
  //   後者會被伺服器的 `/api/deck-posts/:id` 單段 pattern 整個吃掉、永遠回 404（v6.138 踩過）。
  //   所以下面呼叫時是 api('-mine') / api('-tournament/submit')，字串直接接在 API 後面。
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
  let likeBusy = $state(false);
  // ⚠ 按讚失敗**不能**寫進 detailError：modal 的分支順序是 detailLoading → detailError → openPost，
  //   detailError 一有值就會把整份牌表換成一行錯誤，看起來像明細壞掉（Fable 5 review 指出）。
  let likeError = $state('');
  // ⚠ 刪除是不可逆的（讚數與收藏數會歸零），而且連點第二下會撞伺服器的
  //   `status: { $ne: 'deleted' }` 條件回 404 ——「刪除明明成功了卻對玩家報錯」。
  let deleteBusy = $state('');
  let mineSeq = 0;

  // v6.140 批次 3：分頁、投稿、我的投稿、賽事名次一鍵投稿
  let tab = $state<'all' | 'mine'>('all');
  let myPosts = $state<MyPost[]>([]);
  let myLoading = $state(false);
  let myError = $state('');
  let eligible = $state<Eligible[]>([]);

  let postOpen = $state(false);
  let myDecks = $state<Deck[]>([]);
  let pickDeckId = $state('');
  let postNotes = $state('');
  let postBusy = $state(false);
  let postError = $state('');
  let postOk = $state('');

  let tSubmitBusy = $state('');
  let tSubmitMsg = $state('');
  let tSubmitError = $state('');

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
    const un = onAuthStateChanged(auth, (u) => {
      firebaseUser = u;
      // ⚠ 登入狀態要等 Firebase 還原完才知道（v6.026 推播的教訓：訂閱 effect 跑得比 auth 還早
      //   → 拿不到 token → 401 被吞掉）。所以這兩支只在拿到「非匿名使用者」後才發。
      if (u && !u.isAnonymous) { void fetchEligibility(); if (tab === 'mine') void fetchMine(); }
      else { eligible = []; myPosts = []; }
    });
    void fetchList();
    return un;
  });

  const canPost = $derived(!!firebaseUser && !firebaseUser.isAnonymous);

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
    openPost = null; detailLoading = false; detailError = ''; importMsg = ''; importWarn = ''; likeError = '';
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

  // ── 按讚 ──────────────────────────────────────────────────────────
  async function toggleLike() {
    const p = openPost;
    if (!p || likeBusy || !canPost) return;
    likeBusy = true; likeError = '';
    const on = !p.likedByMe;
    try {
      const r = await api('/' + encodeURIComponent(p.id) + '/like', {
        method: on ? 'POST' : 'DELETE',
        headers: await authHeaders(),
      });
      // 伺服器是唯一權威：它回什麼就顯示什麼（唯一鍵擋重放，重複按不會加倍）
      if (openPost && openPost.id === p.id) {
        openPost = { ...openPost, likedByMe: on, likeCount: r.likeCount ?? openPost.likeCount };
      }
      const i = posts.findIndex((x) => x.id === p.id);
      if (i >= 0) { const c = [...posts]; c[i] = { ...c[i], likeCount: r.likeCount ?? c[i].likeCount }; posts = c; }
    } catch (e: any) {
      if (String(e?.message) !== 'unavailable') likeError = String(e?.message ?? e);
    } finally {
      likeBusy = false;
    }
  }

  // ── 我的投稿 ──────────────────────────────────────────────────────
  async function fetchMine() {
    if (!canPost) { myPosts = []; return; }
    // 代次：auth callback 與切分頁可能同時在飛兩發，而 deleteMine 只改本地狀態 ——
    //   一發遲到的舊回應會把「已刪除」蓋回「published」，刪除鈕重新出現，再點就是假 404。
    const seq = ++mineSeq;
    myLoading = true; myError = '';
    try {
      const r = await api('-mine', { headers: await authHeaders() });
      if (seq !== mineSeq) return;
      myPosts = r.posts || [];
    } catch (e: any) {
      if (seq !== mineSeq) return;
      if (String(e?.message) !== 'unavailable') myError = String(e?.message ?? e);
    } finally {
      if (seq === mineSeq) myLoading = false;
    }
  }
  function switchTab(t: 'all' | 'mine') {
    if (tab === t) return;
    tab = t;
    if (t === 'mine' && canPost) void fetchMine();
  }
  async function deleteMine(id: string) {
    if (!canPost || deleteBusy) return;
    const target = myPosts.find((x) => x.id === id);
    if (!confirm('確定要刪除「' + (target ? target.deckName : '這篇投稿') + '」嗎？\n\n'
      + '刪除後其他玩家就看不到了，讚數與收藏數也會歸零。重新投稿會從零開始計算，無法復原。')) return;
    deleteBusy = id;
    mineSeq++;   // 讓還在飛的 fetchMine 回應作廢，否則會把「已刪除」蓋回去
    myError = '';
    try {
      await api('/' + encodeURIComponent(id), { method: 'DELETE', headers: await authHeaders() });
      myPosts = myPosts.map((x) => (x.id === id ? { ...x, status: 'deleted' as const } : x));
      void fetchList();
    } catch (e: any) {
      if (String(e?.message) !== 'unavailable') myError = String(e?.message ?? e);
    } finally {
      deleteBusy = '';
    }
  }

  // ── 投稿 ──────────────────────────────────────────────────────────
  function openPostModal() {
    postOpen = true; postError = ''; postOk = ''; postNotes = '';
    myDecks = loadDecks();
    pickDeckId = myDecks.length ? myDecks[0].id : '';
  }
  function closePostModal() { postOpen = false; }

  const pickedDeck = $derived(myDecks.find((d) => d.id === pickDeckId) ?? null);
  const pickedIssue = $derived.by(() => {
    const d = pickedDeck;
    if (!d) return '';
    const n = d.entries.reduce((a, e) => a + e.count, 0);
    // 只擋「一定會被伺服器退回」的結構問題；完整合法性由伺服器用同一份 validateDeck 判。
    if (n !== 60) return '這副牌是 ' + n + ' 張，投稿需要剛好 60 張';
    return '';
  });

  async function doPost() {
    const d = pickedDeck;
    if (!d || postBusy || pickedIssue) return;
    postBusy = true; postError = ''; postOk = '';
    try {
      await api('', {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckName: d.name,
          notes: postNotes,
          entries: d.entries.map((e) => ({ cardId: e.cardId, count: e.count })),
        }),
      });
      postOk = '投稿完成，其他玩家已經可以看到了。';
      postOpen = false;                      // 關掉 modal，避免玩家對著成功訊息再按一次吃 409
      page = 1; sort = 'new';
      void fetchList();
      if (tab === 'mine') void fetchMine();
    } catch (e: any) {
      postError = String(e?.message) === 'unavailable' ? '這個功能只在正式站提供' : String(e?.message ?? e);
    } finally {
      postBusy = false;
    }
  }

  // ── 賽事名次一鍵投稿 ─────────────────────────────────────────────
  async function fetchEligibility() {
    try {
      const r = await api('-tournament/eligibility', { headers: await authHeaders() });
      eligible = r.events || [];
    } catch { eligible = []; /* 沒有資格或站上沒有這個 API：不顯示橫幅即可，不吵玩家 */ }
  }
  async function submitTournament(ev: Eligible) {
    if (tSubmitBusy) return;
    tSubmitBusy = ev.eventId; tSubmitMsg = ''; tSubmitError = '';
    try {
      const r = await api('-tournament/submit', {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: ev.eventId }),
      });
      tSubmitMsg = '已分享「' + ev.eventName + '」的' + (r.placementLabel || ev.placementLabel) + '牌組。';
      eligible = eligible.map((x) => (x.eventId === ev.eventId ? { ...x, alreadyPosted: true } : x));
      page = 1; sort = 'new';
      void fetchList();
      if (tab === 'mine') void fetchMine();
    } catch (e: any) {
      tSubmitError = String(e?.message) === 'unavailable' ? '這個功能只在正式站提供' : String(e?.message ?? e);
    } finally {
      tSubmitBusy = '';
    }
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
    {#if eligible.length > 0}
      <section class="tourn-banner">
        <h2>你在網站賽有名次，可以分享當時的牌組</h2>
        <p class="sub">分享的是報名時登記的那一副，系統會自動附上賽事名稱與名次。</p>
        <ul>
          {#each eligible as ev (ev.eventId)}
            <li>
              <span class="ev-name">{ev.eventName}</span>
              <span class="badge tourn">{ev.placementLabel}</span>
              {#if ev.alreadyPosted}
                <span class="done">已分享</span>
              {:else}
                <button class="primary small" disabled={tSubmitBusy === ev.eventId} onclick={() => submitTournament(ev)}>
                  {tSubmitBusy === ev.eventId ? '分享中…' : '分享這副牌組'}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if tSubmitMsg}<p class="ok">{tSubmitMsg}</p>{/if}
        {#if tSubmitError}<p class="error">{tSubmitError}</p>{/if}
      </section>
    {/if}

    <div class="tabs">
      <button class:active={tab === 'all'} onclick={() => switchTab('all')}>全部投稿</button>
      <button class:active={tab === 'mine'} onclick={() => switchTab('mine')}>我的投稿</button>
      <span class="spacer"></span>
      {#if canPost}
        <button class="primary small" onclick={openPostModal}>＋ 投稿牌組</button>
      {:else}
        <span class="hint">登入 email 帳號後就能投稿</span>
      {/if}
    </div>

    {#if tab === 'mine'}
      {#if !canPost}
        <p class="empty">請先登入 email 帳號。</p>
      {:else if myLoading}
        <p class="empty">載入中…</p>
      {:else if myError}
        <p class="error">{myError}</p>
      {:else if myPosts.length === 0}
        <p class="empty">你還沒有投稿過牌組。</p>
      {:else}
        <ul class="post-list">
          {#each myPosts as p (p.id)}
            <li>
              <div class="post-card mine-card">
                <div class="row1">
                  <span class="deck-name">{p.deckName}</span>
                  {#if p.tournament}
                    <span class="badge tourn">{p.tournament.eventName} ｜ {p.tournament.placementLabel}</span>
                  {/if}
                  {#if p.status === 'hidden'}
                    <span class="badge hidden-b">已被站長下架</span>
                  {:else if p.status === 'deleted'}
                    <span class="badge hidden-b">已刪除</span>
                  {/if}
                </div>
                <div class="row2">
                  <span class="date">{fmtDate(p.createdAt)}</span>
                  <span class="spacer"></span>
                  <span class="stat">♥ {p.likeCount}</span>
                  <span class="stat">⬇ {p.downloadCount}</span>
                  <!-- hidden 也要能刪：投稿總量上限算的是「未刪除」的，被下架的仍佔名額，
                       只讓 published 可刪的話，被下架 10 篇的玩家會永遠不能再投稿也無法自救。 -->
                  {#if p.status !== 'deleted'}
                    <button class="small danger" disabled={deleteBusy === p.id}
                            onclick={() => deleteMine(p.id)}>{deleteBusy === p.id ? '刪除中…' : '刪除'}</button>
                  {/if}
                </div>
                {#if p.notes}<p class="notes">{p.notes}</p>{/if}
              </div>
            </li>
          {/each}
        </ul>
        <p class="hint small-note">投稿不能修改內容。要更新請刪除後重新投稿（讚數與收藏數會重新計算）。</p>
      {/if}
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
    {#if postOk}<p class="ok">{postOk}</p>{/if}

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
        {#if likeError}<p class="warn">{likeError}</p>{/if}

        <div class="modal-foot">
          {#if canPost}
            <button class="like-btn" class:liked={openPost.likedByMe} disabled={likeBusy} onclick={toggleLike}
                    title={openPost.likedByMe ? '取消讚' : '給這副牌組一個讚'}>
              {openPost.likedByMe ? '♥' : '♡'} {openPost.likeCount}
            </button>
          {:else}
            <span class="stat" title="登入 email 帳號後可以按讚">♥ {openPost.likeCount}</span>
          {/if}
          <button class="primary" onclick={doImport}>匯入到我的牌組</button>
          <a class="linkbtn" href="{base}/decks">前往牌組編輯器</a>
          <button onclick={closeDetail}>關閉</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if postOpen}
  <div class="modal-backdrop" role="presentation" onclick={closePostModal}>
    <div class="modal narrow" role="dialog" aria-modal="true" aria-label="投稿牌組" onclick={(e) => e.stopPropagation()}>
      <header class="modal-head">
        <h2>投稿牌組</h2>
        <button class="close" onclick={closePostModal} aria-label="關閉">✕</button>
      </header>
      {#if myDecks.length === 0}
        <p class="empty">你還沒有任何牌組。先去牌組編輯器建一副吧。</p>
        <div class="modal-foot"><a class="linkbtn" href="{base}/decks">前往牌組編輯器</a></div>
      {:else}
        <label class="field">
          <span>選擇要分享的牌組</span>
          <select bind:value={pickDeckId}>
            {#each myDecks as d (d.id)}
              <option value={d.id}>{d.name}</option>
            {/each}
          </select>
        </label>
        {#if pickedIssue}
          <p class="warn">{pickedIssue}</p>
        {/if}
        <label class="field">
          <span>說明（選填，最多 200 字）</span>
          <textarea bind:value={postNotes} maxlength="200" rows="3"
                    placeholder="這副牌的打法重點、對局思路…"></textarea>
        </label>
        <p class="hint small-note">
          投稿會公開顯示你的暱稱與牌組內容，而且<b>不能修改</b>——要更新請刪除後重新投稿。
        </p>
        {#if postError}<p class="error">{postError}</p>{/if}
        {#if postOk}<p class="ok">{postOk}</p>{/if}
        <div class="modal-foot">
          <button class="primary" disabled={postBusy || !!pickedIssue || !pickedDeck} onclick={doPost}>
            {postBusy ? '送出中…' : '確認投稿'}
          </button>
          <button onclick={closePostModal}>關閉</button>
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

  .tourn-banner { background: rgba(220,160,40,.12); border: 1px solid rgba(220,160,40,.45); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
  .tourn-banner h2 { font-size: .95rem; margin: 0 0 2px; }
  .tourn-banner .sub { font-size: .78rem; opacity: .75; margin: 0 0 8px; }
  .tourn-banner ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .tourn-banner li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .85rem; }
  .ev-name { font-weight: 600; }
  .done { font-size: .78rem; opacity: .6; }

  .tabs { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .tabs > button { padding: 5px 14px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; font: inherit; color: inherit; font-size: .85rem; }
  .tabs > button.active { background: rgba(128,128,128,.18); font-weight: 600; }
  button.primary { background: rgba(80,140,255,.9); border-color: transparent; color: #fff; font-weight: 600; }
  button.primary:disabled { opacity: .5; }
  button.small { padding: 4px 12px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; font: inherit; color: inherit; font-size: .8rem; }
  button.danger { color: #d33; border-color: rgba(211,51,51,.4); }
  .mine-card { cursor: default; }
  .mine-card:hover { background: rgba(128,128,128,.07); }
  .badge.hidden-b { background: rgba(211,51,51,.15); border: 1px solid rgba(211,51,51,.4); }
  .small-note { font-size: .76rem; opacity: .65; margin-top: 10px; line-height: 1.5; }

  .modal.narrow { max-width: 460px; }
  .field { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; font-size: .85rem; }
  .field select, .field textarea { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; width: 100%; box-sizing: border-box; }
  .field textarea { resize: vertical; }

  .like-btn { padding: 7px 14px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; font: inherit; color: inherit; }
  .like-btn.liked { color: #d3467a; border-color: rgba(211,70,122,.5); background: rgba(211,70,122,.1); font-weight: 600; }
  .like-btn:disabled { opacity: .5; }

  @media (max-width: 600px) {
    main { padding: 10px 12px 40px; }
    .to-decks { margin-left: 0; }
  }
</style>
