<script lang="ts">
  // 好友頁（v6.283 P1a：第一個玩家看得到的版本）。
  //
  // 設計：docs/plan-friends-feature.md（站長已核准）；後端是 v6.282 P0（/api/friends/*）。
  //
  // ⚠ 幾件刻意的決定：
  //   ・**獨立頁面**，完全不插進既有的大廳／對戰版面（站長的最高約束：不可造成現有框架的異常）。
  //     既有版面只有線上大廳的 .auth-user 多一顆「👥 好友」按鈕（game/+page.svelte 三行）。
  //   ・**零輪詢**：打開頁面發一發 list；之後只有玩家按了東西才重讀一次。
  //   ・所有資料出口都走 $lib/friends/friends-api.ts（守衛用 esbuild 實跑那一支）；本檔只管畫面。
  //   ・匿名玩家：顯示「請先以 email 帳號登入」，**不做半死的按鈕**（後端一律 401）。
  //   ・伺服器不支援（未部署／測試站）與尚未開放（開關關著）兩種狀態都**明講**，不讓人以為壞了。
  //   ・解除好友＝真刪除（站長裁定）⇒ 一律二次確認；解除封鎖同樣是真刪除 ⇒ 也二次確認。
  //   ・每個 each 都用 fid 當穩定 key（清單會變動，reference-svelte-each-key-scroll）。
  //   ・所有欄位都走 Svelte 的預設 escape，全頁不得出現 {@html}（暱稱是玩家自由輸入）。
  //   ・⚠ 回應永遠不含 email（伺服器白名單）；畫面只顯示暱稱。
  //   ・v6.288 私聊面板（DmPanel.svelte）：好友列每筆一顆「💬」；桌機＝右下角固定面板、手機＝全螢幕 overlay，
  //     兩者由 **JS 量視窗**（Math.min(innerWidth, innerHeight) <= 600，與 game/+page.svelte 的 isPortraitMobile 同一條）決定，
  //     ⚠⚠ 禁用 @media 當手機開關（手機／桌機兩套分支紀律）。面板是 position:fixed ⇒ 既有好友列零位移。
  //   ・輪詢只在面板開著時（3 秒；分頁在背景 15 秒），關掉＝session.close() ⇒ 零請求；排程與狀態機在 $lib/friends/dm-*.ts，
  //     本檔仍然零 setTimeout／setInterval（v6.283 B1 守衛）。
  //   ・解除好友＝真刪除，且 v6.288 起**對話也一起刪**（站長裁定）⇒ 二次確認文案明講。
  //   ・v6.289 起解除封鎖也一樣（伺服器在真刪那一列之後一併刪對話）⇒ 解除封鎖的二次確認文案也明講「對話」（守衛 test-v6289 鎖文案）。
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { VERSION } from '$lib/version';
  import { auth } from '$lib/firebase';
  import { onAuthStateChanged, type User } from 'firebase/auth';
  import { adoptOrKeep } from '$lib/ui/stale-keep';
  import {
    fetchFriendsList, requestFriendByEmail, friendsAction,
    type FriendsList, type FriendRow, type FriendsAction, type FriendsCtx, type FriendsFailKind,
  } from '$lib/friends/friends-api';
  import { createDmSession, type DmSession, type DmSessionState } from '$lib/friends/dm-session';
  import { browserPollerDeps } from '$lib/friends/dm-poller';
  import DmPanel from './DmPanel.svelte';

  let firebaseUser = $state<User | null>(null);
  let authReady = $state(false);
  let loading = $state(false);
  let list = $state<FriendsList | null>(null);
  /** list 載入失敗的種類；unsupported／disabled／auth 會換成整頁說明，其餘只掛一行錯誤。 */
  let failKind = $state<FriendsFailKind | ''>('');
  let failMsg = $state('');
  let stale = $state(false);

  // 用 email 加好友
  let addEmail = $state('');
  let addBusy = $state(false);
  let addOk = $state('');
  let addErr = $state('');

  // 逐筆操作（accept／reject／remove／block／unblock）
  let actBusy = $state('');          // 正在操作的 fid
  let actErr = $state('');
  let confirmFid = $state('');       // 等待二次確認的 fid
  let confirmKind = $state<'remove' | 'unblock' | ''>('');

  // ⚠ 亂序防護（與 deck-posts 的 listSeq 同一課）：只有「這一發仍是最新一發」才允許寫回狀態。
  let seq = 0;

  // ── v6.288 私聊 ──
  /** 手機直式／桌機兩套分支的開關：JS 量視窗（與 game/+page.svelte isPortraitMobile 同一條），⚠ 不用 @media。 */
  let isMobile = $state(false);
  let dm: DmSession | null = null;
  /** 面板狀態；null＝面板沒開（DmPanel 不渲染、輪詢已停）。 */
  let dmState = $state<DmSessionState | null>(null);
  /** 私聊在這台伺服器不可用（尚未開放／舊伺服器）的說明；非空 ⇒ 藏掉所有 💬、在好友區掛一行（本次頁面停留期間記住，關面板不會再露出）。 */
  let dmNegMsg = $state('');
  const dmUnavailable = $derived(!!dmNegMsg);

  const canUse = $derived(!!firebaseUser && !firebaseUser.isAnonymous);
  const friendCount = $derived(list ? list.friends.length : 0);
  const limit = $derived(list ? list.limit : 100);

  onMount(() => {
    // ⚠ 登入狀態要等 Firebase 還原完才知道（v6.026 推播的教訓）；非匿名使用者才發那一發 list。
    const un = onAuthStateChanged(auth, (u) => {
      firebaseUser = u;
      authReady = true;
      if (u && !u.isAnonymous) void load();
      else { list = null; failKind = ''; failMsg = ''; closeDm(); }
    });
    // v6.288：手機／桌機分支（JS 量視窗；⚠ 不用 @media）
    const onResize = () => { isMobile = Math.min(window.innerWidth, window.innerHeight) <= 600; };
    onResize();
    window.addEventListener('resize', onResize);
    // 分頁回到前景 ⇒ 立刻補一發（背景時排程是 15 秒，不補會等很久）；進背景則由排程器下一發自己放慢
    const onVis = () => { if (!document.hidden) dm?.poke(); };
    document.addEventListener('visibilitychange', onVis);
    // timer／document.hidden 只在 dm-poller.ts 的 browserPollerDeps 碰（本檔零 setTimeout，v6.283 B1）
    dm = createDmSession({
      getCtx: ctx,
      onChange: (s) => { dmState = s; if (s && (s.status === 'dm-disabled' || s.status === 'unsupported')) dmNegMsg = s.blockMsg; },
      ...browserPollerDeps(),
    });
    return () => {
      un();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      // ⚠⚠ 離開頁面：關掉面板 ⇒ 輪詢停止（零請求）
      closeDm();
      dm = null;
    };
  });

  function openDm(r: FriendRow) {
    if (!dm) return;
    if (dmState && dmState.fid === r.fid) return;
    dm.open(r.fid, r.nick);
  }
  function closeDm() { dm?.close(); }

  /** 取身分：拿不到 token 就傳 null（friends-api 會直接回 auth，不發請求）。 */
  async function ctx(): Promise<FriendsCtx | null> {
    const u = auth.currentUser;
    if (!u || u.isAnonymous) return null;
    let token: string | null = null;
    try { token = await u.getIdToken(); } catch { token = null; }
    return { uid: u.uid, token };
  }

  async function load() {
    const s = ++seq;
    loading = true;
    const c = await ctx();
    if (s !== seq) return;
    if (!c) { loading = false; return; }
    const r = await fetchFriendsList(c);
    if (s !== seq) return;
    loading = false;
    if (r.ok) {
      list = r.data; failKind = ''; failMsg = ''; stale = false;
      return;
    }
    failKind = r.kind; failMsg = r.message;
    if (r.kind === 'unsupported' || r.kind === 'disabled' || r.kind === 'auth') {
      list = null; stale = false;
    } else {
      // 暫時性失敗：沿用上一份好資料，只掛「更新中／重試」提示（v6.177 中央述詞）。
      const k = adoptOrKeep(list, null);
      list = k.data; stale = k.stale && !!list;
    }
  }

  async function submitAdd(e: Event) {
    e.preventDefault();
    if (addBusy) return;
    const em = addEmail.trim();
    addOk = ''; addErr = '';
    if (!em) { addErr = '請輸入對方登入用的 email。'; return; }
    addBusy = true;
    try {
      const c = await ctx();
      if (!c) { addErr = '請先以 email 帳號登入。'; return; }
      const r = await requestFriendByEmail(c, em);
      if (!r.ok) { addErr = r.message; if (r.kind === 'unsupported' || r.kind === 'disabled') { failKind = r.kind; failMsg = r.message; list = null; } return; }
      if (r.data.status === 'accepted') addOk = r.data.already ? '對方已經是好友了。' : '對方先前已邀請過，現在雙方已成為好友。';
      else addOk = r.data.already ? '先前已送出過邀請，請等待對方確認。' : '邀請已送出，請等待對方確認。';
      addEmail = '';
      void load();
    } finally {
      addBusy = false;
    }
  }

  function askConfirm(fid: string, kind: 'remove' | 'unblock') {
    confirmFid = fid; confirmKind = kind; actErr = '';
  }
  function cancelConfirm() { confirmFid = ''; confirmKind = ''; }

  async function act(action: FriendsAction, fid: string) {
    if (actBusy) return;
    actBusy = fid; actErr = '';
    try {
      const c = await ctx();
      if (!c) { actErr = '請先以 email 帳號登入。'; return; }
      const r = await friendsAction(c, action, fid);
      if (!r.ok) { actErr = r.message; if (r.kind === 'unsupported' || r.kind === 'disabled') { failKind = r.kind; failMsg = r.message; list = null; } return; }
      // v6.288：對這位玩家做了解除／封鎖／拒絕之後，若私聊面板正開著同一位 ⇒ 關掉（對話已刪或已無權讀）
      if (dmState && dmState.fid === fid) closeDm();
      cancelConfirm();
      await load();
    } finally {
      actBusy = '';
    }
  }

  function fmtDate(ts: number | null): string {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function viaLabel(r: FriendRow): string {
    return r.via === 'battle' ? '對戰中加入' : (r.via === 'email' ? '以 email 加入' : '');
  }
</script>

<svelte:head>
  <title>好友 · ptcg-tw-sim</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main>
  <header class="page-head">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>👥 好友 <span class="version-tag">v{VERSION}</span></h1>
    <a href="{base}/game" class="to-game">線上對戰 →</a>
  </header>

  {#if !authReady}
    <p class="empty">載入中…</p>
  {:else if !canUse}
    <!-- 匿名玩家：明講，不做半死的按鈕（後端對匿名一律 401） -->
    <p class="notice">
      好友功能需要以 <b>email 帳號</b>登入才能使用。請先到線上對戰大廳右上角建立帳號或登入，再回到這一頁。
    </p>
  {:else if failKind === 'unsupported'}
    <!-- 伺服器還沒部署到有好友功能的版本（或這裡是沒有伺服器端的測試站） -->
    <p class="notice">{failMsg} 好友功能只在正式站 <a href="https://www.ptcg-tw-sim.com/friends">www.ptcg-tw-sim.com</a> 提供，且需等伺服器更新後才會開放。</p>
  {:else if failKind === 'disabled'}
    <!-- 站長的開關還沒打開 -->
    <p class="notice">{failMsg}</p>
  {:else if failKind === 'auth'}
    <p class="notice">{failMsg} <button class="small" onclick={() => void load()}>重新讀取</button></p>
  {:else}
    {#if failMsg}
      <p class="error">{failMsg} <button class="small" onclick={() => void load()}>重試</button></p>
    {:else if stale}
      <p class="warn">目前顯示的是上一次讀到的名單，更新中…</p>
    {/if}

    <section class="add">
      <h2>用 email 加好友</h2>
      <p class="hint">輸入對方登入本站用的 email，對方確認後就會成為好友。對方不會看到這裡輸入的 email，名單上只顯示暱稱。</p>
      <form class="add-form" onsubmit={submitAdd}>
        <input type="email" placeholder="對方的 email" bind:value={addEmail} autocomplete="off" inputmode="email" disabled={addBusy} />
        <button class="primary" type="submit" disabled={addBusy || !addEmail.trim()}>{addBusy ? '送出中…' : '送出邀請'}</button>
      </form>
      {#if addOk}<p class="ok">{addOk}</p>{/if}
      {#if addErr}<p class="error">{addErr}</p>{/if}
    </section>

    {#if loading && !list}
      <p class="empty">載入中…</p>
    {:else if list}
      {#if actErr}<p class="error">{actErr}</p>{/if}
      {#if list.truncated}<p class="warn">名單太長，只顯示了前面一部分。</p>{/if}

      <!-- ── 區 1：好友 ── -->
      <section class="group">
        <h2>好友 <span class="count">{friendCount} / {limit}</span></h2>
        {#if dmUnavailable}<p class="hint">{dmNegMsg}</p>{/if}
        {#if list.friends.length === 0}
          <p class="empty">還沒有好友。</p>
        {:else}
          <ul class="rows">
            {#each list.friends as r (r.fid)}
              <li class="row">
                <span class="nick">{r.nick}</span>
                <span class="meta">{viaLabel(r)}{r.at ? '・' + fmtDate(r.at) : ''}</span>
                <span class="spacer"></span>
                {#if confirmFid === r.fid && confirmKind === 'remove'}
                  <!-- v6.288 站長裁定：解除好友就連對話一起刪 ⇒ 文案必須明講、且不可逆 -->
                  <span class="confirm">確定解除好友？雙方名單都會移除，和這位好友的私聊對話也會一起刪除，無法復原。</span>
                  <button class="small danger" disabled={actBusy === r.fid} onclick={() => act('remove', r.fid)}>確定解除</button>
                  <button class="small" disabled={actBusy === r.fid} onclick={cancelConfirm}>取消</button>
                {:else}
                  {#if !dmUnavailable}<button class="small dm-open" disabled={dmState?.fid === r.fid} onclick={() => openDm(r)} title="私聊">💬 私聊</button>{/if}
                  <button class="small" disabled={!!actBusy} onclick={() => askConfirm(r.fid, 'remove')}>解除好友</button>
                  <button class="small danger" disabled={!!actBusy} onclick={() => act('block', r.fid)}>封鎖</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- ── 區 2：待我確認 ── -->
      <section class="group">
        <h2>待我確認 <span class="count">{list.incoming.length}</span></h2>
        {#if list.incoming.length === 0}
          <p class="empty">目前沒有待確認的邀請。</p>
        {:else}
          <ul class="rows">
            {#each list.incoming as r (r.fid)}
              <li class="row">
                <span class="nick">{r.nick}</span>
                <span class="meta">{viaLabel(r)}{r.at ? '・' + fmtDate(r.at) : ''}</span>
                <span class="spacer"></span>
                <button class="small primary" disabled={!!actBusy} onclick={() => act('accept', r.fid)}>接受</button>
                <button class="small" disabled={!!actBusy} onclick={() => act('reject', r.fid)}>拒絕</button>
                <button class="small danger" disabled={!!actBusy} onclick={() => act('block', r.fid)}>封鎖</button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- ── 區 3：我送出的 ── -->
      <section class="group">
        <h2>我送出的邀請 <span class="count">{list.outgoing.length}</span></h2>
        {#if list.outgoing.length === 0}
          <p class="empty">沒有等待中的邀請。</p>
        {:else}
          <ul class="rows">
            {#each list.outgoing as r (r.fid)}
              <li class="row">
                <span class="nick">{r.nick}</span>
                <span class="meta">等待對方確認{r.at ? '・' + fmtDate(r.at) : ''}</span>
                <span class="spacer"></span>
                <button class="small" disabled={!!actBusy} onclick={() => act('remove', r.fid)}>取消邀請</button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- ── 區 4：已封鎖 ── -->
      <section class="group">
        <h2>已封鎖 <span class="count">{list.blocked.length}</span></h2>
        {#if list.blocked.length === 0}
          <p class="empty">沒有封鎖任何人。</p>
        {:else}
          <ul class="rows">
            {#each list.blocked as r (r.fid)}
              <li class="row">
                <span class="nick">{r.nick}</span>
                <span class="meta">{r.at ? fmtDate(r.at) : ''}</span>
                <span class="spacer"></span>
                {#if confirmFid === r.fid && confirmKind === 'unblock'}
                  <span class="confirm">解除封鎖後關係會歸零，要重新邀請才會成為好友；和這位玩家的私聊對話也會一起刪除，無法復原。</span>
                  <button class="small danger" disabled={actBusy === r.fid} onclick={() => act('unblock', r.fid)}>確定解除封鎖</button>
                  <button class="small" disabled={actBusy === r.fid} onclick={cancelConfirm}>取消</button>
                {:else}
                  <button class="small" disabled={!!actBusy} onclick={() => askConfirm(r.fid, 'unblock')}>解除封鎖</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
  <!-- v6.288 私聊面板：只在 dmState 非 null 時渲染；關掉＝session.close() ⇒ 輪詢停止。position:fixed ⇒ 既有版面零位移 -->
  {#if dmState}
    <DmPanel sess={dmState} mobile={isMobile} onclose={closeDm} onsend={(t) => { void dm?.send(t); }} onmore={() => { void dm?.loadMore(); }} onretry={() => dm?.retry()} />
  {/if}
</main>

<style>
  /* iOS 動態島／瀏海：viewport-fit=cover 已在 app.html，env() 才有值（比照 /deck-posts）。 */
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: calc(12px + var(--safe-top, 0px))
             max(16px, var(--safe-right, 0px))
             48px
             max(16px, var(--safe-left, 0px));
  }
  .page-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .page-head h1 { font-size: 1.35rem; margin: 0; }
  .version-tag { font-size: .7rem; opacity: .55; font-weight: 400; }
  .back, .to-game { font-size: .85rem; text-decoration: none; opacity: .8; }
  .to-game { margin-left: auto; }
  .hint { font-size: .8rem; opacity: .65; line-height: 1.5; margin: 4px 0 8px; }

  .notice { background: rgba(80,140,255,.12); border: 1px solid rgba(80,140,255,.4); border-radius: 8px; padding: 12px 14px; font-size: .9rem; line-height: 1.6; }
  .error { color: #d33; font-size: .9rem; }
  .ok { color: #1a8f4a; font-size: .9rem; }
  .warn { color: #b26a00; font-size: .85rem; line-height: 1.5; }
  .empty { opacity: .6; padding: 10px 0; }

  .add { background: rgba(128,128,128,.07); border: 1px solid rgba(128,128,128,.2); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
  .add h2, .group h2 { font-size: 1rem; margin: 0 0 4px; }
  /* 手機上靠 flex-wrap 自然換行，不用 @media 當手機開關（手機／桌機分支紀律）。 */
  .add-form { display: flex; gap: 8px; flex-wrap: wrap; }
  .add-form input { flex: 1 1 220px; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; font-size: 16px; }

  .group { margin-bottom: 16px; }
  .count { font-size: .78rem; opacity: .6; font-weight: 400; margin-left: 6px; }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: rgba(128,128,128,.07); border: 1px solid rgba(128,128,128,.2); border-radius: 8px; padding: 8px 10px; }
  /* ⚠ 暱稱是玩家自由輸入：一定要斷字，否則一長串英數字會把列撐爆（手機直式先爆）。 */
  .nick { font-weight: 600; overflow-wrap: anywhere; word-break: break-word; }
  .meta { font-size: .78rem; opacity: .65; }
  .spacer { flex: 1; }
  .confirm { font-size: .8rem; color: #b26a00; flex: 1 1 100%; }

  button.small, button.primary { padding: 5px 12px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; cursor: pointer; font: inherit; font-size: .85rem; color: inherit; }
  button.primary { background: rgba(80,140,255,.18); border-color: rgba(80,140,255,.6); font-weight: 600; }
  button.danger { color: #d33; border-color: rgba(211,51,51,.45); }
  button:disabled { opacity: .45; cursor: default; }

  @media (max-width: 600px) {
    /* ⚠ 只縮小基礎邊距，env() 那一項必須保留（動態島機種才按得到「← 首頁」）。 */
    main {
      padding: calc(10px + var(--safe-top, 0px))
               max(12px, var(--safe-right, 0px))
               40px
               max(12px, var(--safe-left, 0px));
    }
    .to-game { margin-left: 0; }
  }
</style>
