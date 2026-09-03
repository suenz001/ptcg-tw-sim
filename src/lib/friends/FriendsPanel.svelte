<script lang="ts">
  // ⭐⭐⭐ v6.296 好友名單面板（**共用元件**）。
  //
  // 為什麼抽出來：這一版起「好友名單」同時出現在兩個地方 ——
  //   ① 獨立路由 `/friends`（src/routes/friends/+page.svelte）
  //   ② 線上連線對戰大廳的第二個分頁（src/routes/game/+page.svelte）
  // 兩邊**共用這一份**（站長要求：不要兩份漂移）。放在 `$lib/friends/` 而不是
  // `src/routes/friends/` 底下，理由是它已經被兩條路由共用，而 `$lib/friends/` 正是
  // 好友功能既有的共用層（friends-api.ts／dm-session.ts／dm-poller.ts 都在這裡）。
  //
  // ⚠ 幾件刻意的決定（沿用 v6.283~v6.293，逐條保留）：
  //   ・**零輪詢**：掛載時發一發 list；之後只有玩家按了東西才重讀一次。本檔零 setTimeout／setInterval。
  //   ・所有資料出口都走 $lib/friends/friends-api.ts；本檔只管畫面。
  //   ・匿名玩家：顯示「請先以 email 帳號登入」，**不做半死的按鈕**（後端一律 401）。
  //   ・伺服器不支援（未部署／測試站）與尚未開放（開關關著）兩種狀態都**明講**，不讓人以為壞了。
  //   ・解除好友／解除封鎖＝真刪除（連對話一起刪）⇒ 一律二次確認，文案明講。
  //   ・每個 each 都用 fid 當穩定 key（reference-svelte-each-key-scroll）。
  //   ・⚠⚠ 所有欄位都走 Svelte 的預設 escape，**全檔不得出現 {@html}**（暱稱／備註名都是玩家自由輸入；
  //     這是 test-v6283 B3／test-v6288 E1／test-v6296 的紅線）。
  //   ・⚠ 回應永遠不含 email（伺服器白名單）；畫面只顯示暱稱／備註名。
  //
  // ⭐⭐ 色票（--fr-*）的**單一來源**就在本檔 <style> 最上面那一段：
  //   `/friends` 頁的頁首／分頁列、以及 position:fixed 的私聊面板，都是靠 `head`／`foot` snippet
  //   渲染在 `.fr-panel` **裡面**，用 CSS 自訂屬性的繼承吃到同一份色票（守衛用 getComputedStyle 實測）。
  //
  // ⭐ 私聊：本元件**不 import DmPanel**（`ondm` 交給外面決定要開面板還是導頁）——
  //   這樣 `src/routes/game/+page.svelte` 才保得住「主檔零 DmPanel」這個既有不變量（test-v6288 F1）。
  import { onMount, type Snippet } from 'svelte';
  import { auth } from '$lib/firebase';
  import { onAuthStateChanged, type User } from 'firebase/auth';
  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';
  import { adoptOrKeep } from '$lib/ui/stale-keep';
  import {
    fetchFriendsList, requestFriendByEmail, friendsAction, setFriendAlias, FRIENDS_ALIAS_MAX_LEN,
    type FriendsList, type FriendRow, type FriendsAction, type FriendsFailKind,
  } from '$lib/friends/friends-api';
  // ⭐⭐ v6.301 好友列的「加入房間／觀戰」——純瀏覽器端比對，零新請求（見該檔開頭的效能紅線）。
  import {
    buildFriendRoomIndex, friendRoomState, friendRoomLabel, friendRoomClickable, friendRoomTitle,
    type FriendRoomSource,
  } from '$lib/friends/friend-rooms';

  let {
    /** true＝嵌在大廳分頁裡（不自己畫底色，讓大廳的底透出來）。 */
    embedded = false,
    /** 渲染在面板最上面的東西（`/friends` 頁的頁首＋分頁列）。⇒ 吃得到本檔的 --fr-* 色票。 */
    head,
    /** 渲染在面板最下面的東西（`/friends` 頁的私聊面板）。⇒ 同上。 */
    foot,
    /** 私聊入口：null／undefined ⇒ 不顯示「💬」。 */
    ondm,
    /** 私聊目前不可用時的說明（非空 ⇒ 藏掉所有「💬」並在好友區掛一行）。 */
    dmMsg = '',
    /** 已經開著面板的那位好友（該列的「💬」停用）。 */
    dmActiveFid = '',
    /**
     * ⭐⭐⭐ v6.301 線上大廳每 2 秒更新一次的公開房間列表（`openRooms`，已含 `seats[].uid`）。
     * ⚠⚠ **沒傳（undefined）⇒ 整組「加入房間／觀戰」按鈕不渲染**：錦標賽頁的好友分頁與
     *   `/friends` 獨立頁沒有這份資料，而且**絕不可以為了這個功能新增輪詢**
     *   （v6.118 效能事故：錦標賽頁每 2 秒兩支 /api/rooms，30 人賽 ≈ 每秒 30 個純浪費的請求）。
     */
    rooms,
    /** 按下「加入房間／觀戰」要走的**既有**流程（大廳的 `handleJoinFromList`）。沒給就不渲染按鈕。 */
    onjoinroom,
    /** 非空 ⇒ 按鈕一律停用，並在好友區掛一行說明（例如玩家名稱還沒填）。 */
    joinBlockedMsg = '',
    /** 對某位好友做完 accept／reject／remove／block／unblock 之後通知外面（例如關掉私聊面板）。 */
    onafteract,
  }: {
    embedded?: boolean;
    head?: Snippet;
    foot?: Snippet;
    ondm?: ((r: FriendRow) => void) | null;
    dmMsg?: string;
    dmActiveFid?: string;
    rooms?: ReadonlyArray<FriendRoomSource | null | undefined> | null;
    onjoinroom?: ((roomId: string) => void) | null;
    joinBlockedMsg?: string;
    onafteract?: ((fid: string) => void) | null;
  } = $props();

  let firebaseUser = $state<User | null>(null);
  let authReady = $state(false);
  let loading = $state(false);
  let list = $state<FriendsList | null>(null);
  /** list 載入失敗的種類；unsupported／disabled／auth 會換成整段說明，其餘只掛一行錯誤。 */
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

  // ── v6.296 備註名（LINE 那種「我自己幫這位好友取的名字」；對方看不到）──
  /** 正在編輯備註名的 fid（空＝沒有人在編輯）。 */
  let aliasFid = $state('');
  let aliasDraft = $state('');
  let aliasBusy = $state(false);
  let aliasErr = $state('');

  // ⚠ 亂序防護（與 deck-posts 的 listSeq 同一課）：只有「這一發仍是最新一發」才允許寫回狀態。
  let seq = 0;

  const canUse = $derived(!!firebaseUser && !firebaseUser.isAnonymous);
  const friendCount = $derived(list ? list.friends.length : 0);
  const limit = $derived(list ? list.limit : 100);
  const dmUnavailable = $derived(!!dmMsg);
  /** 顯示「💬」的條件：外面有給 ondm，而且私聊沒有被判為不可用。 */
  const showDm = $derived(!!ondm && !dmUnavailable);
  /**
   * ⭐⭐⭐ v6.301 顯示「加入房間／觀戰」整組的條件：呼叫端**同時**給了 `rooms` 與 `onjoinroom`。
   * ⚠ 兩個都要 —— 只給其中一個就渲染，等於做出一顆按了沒反應的按鈕。
   * ⚠⚠ 錦標賽分頁與 `/friends` 兩個掛載點都不傳 ⇒ 整組不渲染（它們沒有 openRooms）。
   */
  const showRoomBtn = $derived(Array.isArray(rooms) && !!onjoinroom);
  /** ⚠ 複雜度 O(房間數)：每 tick 對 ≤100 間房各查 2 個座位；每位好友再做 ≤6 次 O(1) 查表。 */
  const roomIndex = $derived(showRoomBtn ? buildFriendRoomIndex(rooms) : null);

  onMount(() => {
    // ⚠ 登入狀態要等 Firebase 還原完才知道（v6.026 推播的教訓）；非匿名使用者才發那一發 list。
    const un = onAuthStateChanged(auth, (u) => {
      firebaseUser = u;
      authReady = true;
      if (u && !u.isAnonymous) void load();
      else { list = null; failKind = ''; failMsg = ''; }
    });
    return () => { un(); };
  });

  /** 取身分：⚠ 匿名回 null（friends-api 會直接回 auth，不發請求）。中央出口在 $lib/friends/auth-ctx.ts。 */
  const ctx = friendsCtxFromAuth;

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
      // v6.288：對這位玩家做了解除／封鎖／拒絕之後，外面若正開著同一位的私聊面板 ⇒ 由外面關掉
      onafteract?.(fid);
      cancelConfirm();
      if (aliasFid === fid) cancelAlias();
      await load();
    } finally {
      actBusy = '';
    }
  }

  // ── v6.296 備註名 ──
  /** ⚠ 只有 accepted 的關係才能設備註名（其餘伺服器一律 409）⇒ 編輯入口也只在那些列出現。 */
  function canAlias(r: FriendRow): boolean { return r.status === 'accepted'; }
  function startAlias(r: FriendRow) {
    aliasFid = r.fid; aliasDraft = r.alias ?? ''; aliasErr = '';
  }
  function cancelAlias() { aliasFid = ''; aliasDraft = ''; aliasErr = ''; }
  /** 送出備註名。⚠ **空字串＝清除**（伺服器 $unset 我自己那一側）⇒ 空的時候按鈕不可以停用。 */
  async function submitAlias(e: Event) {
    e.preventDefault();
    if (aliasBusy || !aliasFid) return;
    aliasBusy = true; aliasErr = '';
    try {
      const c = await ctx();
      if (!c) { aliasErr = '請先以 email 帳號登入。'; return; }
      const r = await setFriendAlias(c, aliasFid, aliasDraft);
      if (!r.ok) { aliasErr = r.message; return; }
      cancelAlias();
      await load();
    } finally {
      aliasBusy = false;
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

<div class="fr-panel" class:embed={embedded}>
  {@render head?.()}

  {#if !authReady}
    <p class="empty">載入中…</p>
  {:else if !canUse}
    <!-- 匿名玩家：明講，不做半死的按鈕（後端對匿名一律 401） -->
    <p class="notice">
      好友功能需要以 <b>email 帳號</b>登入才能使用。請先到線上對戰大廳右上角建立帳號或登入，再回到這裡。
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
        {#if dmUnavailable}<p class="hint">{dmMsg}</p>{/if}
        {#if showRoomBtn && joinBlockedMsg}<p class="hint">{joinBlockedMsg}</p>{/if}
        {#if list.friends.length === 0}
          <p class="empty">還沒有好友。</p>
        {:else}
          <ul class="rows">
            {#each list.friends as r (r.fid)}
              <!-- ⭐⭐⭐ v6.301「加入房間／觀戰」的狀態：沒傳 rooms（showRoomBtn=false）⇒ null ⇒ 整組不渲染。 -->
              {@const _rs = showRoomBtn ? friendRoomState(r, roomIndex) : null}
              <li class="row">
                <!-- ⭐ v6.296 顯示優先序：有備註名就顯示備註名，並**另外用小字顯示原暱稱**；
                     沒有備註名就只顯示暱稱。⚠ 兩者都是玩家自由輸入 ⇒ 一律走 Svelte 預設 escape。 -->
                <span class="nick">{r.alias || r.nick}</span>
                {#if r.alias}<span class="orig-nick">原暱稱：{r.nick}</span>{/if}
                <span class="meta">{viaLabel(r)}{r.at ? '・' + fmtDate(r.at) : ''}</span>
                <span class="spacer"></span>
                {#if confirmFid === r.fid && confirmKind === 'remove'}
                  <!-- v6.288 站長裁定：解除好友就連對話一起刪 ⇒ 文案必須明講、且不可逆 -->
                  <span class="confirm">確定解除好友？雙方名單都會移除，和這位好友的私聊對話也會一起刪除，無法復原。</span>
                  <button class="small danger" disabled={actBusy === r.fid} onclick={() => act('remove', r.fid)}>確定解除</button>
                  <button class="small" disabled={actBusy === r.fid} onclick={cancelConfirm}>取消</button>
                {:else if aliasFid === r.fid}
                  <!-- ⚠ 送**空字串**＝清除備註名（伺服器 $unset 我自己那一側）⇒ 空的時候「儲存」不可以停用。 -->
                  <form class="alias-form" onsubmit={submitAlias}>
                    <input class="alias-input" type="text" maxlength={FRIENDS_ALIAS_MAX_LEN} placeholder="備註名（留空＝清除）" bind:value={aliasDraft} autocomplete="off" disabled={aliasBusy} />
                    <button class="small primary" type="submit" disabled={aliasBusy}>{aliasBusy ? '儲存中…' : '儲存'}</button>
                    <button class="small" type="button" disabled={aliasBusy} onclick={cancelAlias}>取消</button>
                    <span class="hint alias-hint">只有自己看得到，對方不會知道。最多 {FRIENDS_ALIAS_MAX_LEN} 字。</span>
                  </form>
                  {#if aliasErr}<span class="error alias-err">{aliasErr}</span>{/if}
                {:else}
                  <!-- ⭐⭐⭐ v6.301「加入房間／觀戰」。四種狀態：等待中的休閒房＝可加入、對戰中的休閒房＝可觀戰、
                       錦標賽對戰中＝停用並明講、其餘（含資料不足）＝停用。
                       ⚠ 點下去走的是大廳**既有**的 handleJoinFromList（加入與觀戰同一條路）。 -->
                  {#if _rs}<button class="small fr-join" disabled={!friendRoomClickable(_rs) || !!joinBlockedMsg} title={friendRoomTitle(_rs)} onclick={() => { if (_rs.room) onjoinroom?.(_rs.room.roomId); }}>{friendRoomLabel(_rs)}</button>{/if}
                  {#if showDm}<button class="small dm-open" disabled={dmActiveFid === r.fid} onclick={() => ondm?.(r)} title="私聊">💬 私聊</button>{/if}
                  {#if canAlias(r)}<button class="small" disabled={!!actBusy} onclick={() => startAlias(r)} title="幫這位好友取一個只有自己看得到的名字">✏️ 備註名</button>{/if}
                  <button class="small" disabled={!!actBusy} onclick={() => askConfirm(r.fid, 'remove')}>解除好友</button>
                  <button class="small danger" disabled={!!actBusy} onclick={() => act('block', r.fid)}>封鎖</button>
                  <!-- ⚠⚠ uid 來源是未驗證的 playerIdentity ⇒ **一定要把房名＋房主名顯示出來**，
                       讓玩家自己看得到再決定要不要進去（站長已知並接受這個風險）。 -->
                  {#if _rs?.room}<span class="fr-room">🎮 {_rs.room.roomName}（房主：{_rs.room.hostName}）</span>{/if}
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
                <span class="nick">{r.alias || r.nick}</span>
                {#if r.alias}<span class="orig-nick">原暱稱：{r.nick}</span>{/if}
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
                <span class="nick">{r.alias || r.nick}</span>
                {#if r.alias}<span class="orig-nick">原暱稱：{r.nick}</span>{/if}
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
                <span class="nick">{r.alias || r.nick}</span>
                {#if r.alias}<span class="orig-nick">原暱稱：{r.nick}</span>{/if}
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

  {@render foot?.()}
</div>

<style>
  /* ⭐⭐⭐ 墨綠色票的**單一來源**（v6.293 起；v6.296 從 /friends 頁搬到這裡，因為現在有兩個地方共用）。
     本檔與 src/routes/friends/+page.svelte、DmPanel.svelte 的所有色碼只寫在這一段，
     底下每一條規則一律 var(--fr-*)。要改配色只動這一段。
     來源逐條抄自 src/routes/game/+page.svelte（＝錦標賽與對戰演練同一套）：
       整頁底 #162816（/friends 的 <svelte:head> 注入同一個值）
       分頁鈕 .tourn-tab：底 #102010／框 #3a5a3a／字 #9fdca0；hover #18301a；
              active 漸層 #2a5a3a→#1d4029 ＋ 字 #eaffea ＋ 框 #6ab87a ＋ 1px inset 光暈
       卡片與輸入框 .tourn-lb-card／.tourn-field .name-input：底 #142414／框 #4a6a4a／字 #eaf5ea
       標籤 #cfe8cf（.tourn-field）／淡字 #7a9a7a（.tourn-pf-email）／強調金 #ffd35a
       成功綠 #7cfc9a（.reg-ok）／警示紅 #ff6f7d（.tcmsg.tcsys.sc-cancel）
       訊息泡泡：對方 #1a2e1a（.tourn-chat-head）／自己 #2a5a3a（分頁 active 的起色）
     ⚠ `/friends` 的頁首／分頁列（head snippet）與 position:fixed 的私聊面板（foot snippet）
       都渲染在 .fr-panel **裡面** ⇒ 靠 CSS 自訂屬性的繼承吃到同一份色票；守衛用 getComputedStyle 實測。 */
  .fr-panel {
    --fr-bg: #162816;
    --fr-fg: #eaf5ea;
    --fr-label: #cfe8cf;
    --fr-dim: #7a9a7a;
    --fr-card-bg: #142414;
    --fr-card-bd: #4a6a4a;
    --fr-tab-bg: #102010;
    --fr-tab-bd: #3a5a3a;
    --fr-tab-fg: #9fdca0;
    --fr-tab-hover-bg: #18301a;
    --fr-tab-on-from: #2a5a3a;
    --fr-tab-on-to: #1d4029;
    --fr-tab-on-fg: #eaffea;
    --fr-tab-on-bd: #6ab87a;
    --fr-gold: #ffd35a;
    --fr-ok: #7cfc9a;
    --fr-danger: #ff6f7d;
    --fr-bubble-them: #1a2e1a;
    --fr-bubble-me: #2a5a3a;

    color: var(--fr-fg);
    /* ⚠ /friends 的底色正主是 <svelte:head> 注入的那一行（蓋掉 layout 白底 baseline）；
       這裡再鋪一次是保險。嵌進大廳時（.embed）不鋪，讓大廳自己的底透出來。 */
    background: var(--fr-bg);
  }
  .fr-panel.embed { background: transparent; }

  .hint { font-size: .8rem; color: var(--fr-dim); line-height: 1.5; margin: 4px 0 8px; }
  .notice { background: var(--fr-card-bg); border: 1px solid var(--fr-card-bd); border-radius: 8px; padding: 12px 14px; font-size: .9rem; line-height: 1.6; color: var(--fr-label); }
  .notice a { color: var(--fr-gold); }
  .error { color: var(--fr-danger); font-size: .9rem; }
  .ok { color: var(--fr-ok); font-size: .9rem; }
  .warn { color: var(--fr-gold); font-size: .85rem; line-height: 1.5; }
  .empty { color: var(--fr-dim); padding: 10px 0; }

  .add { background: var(--fr-card-bg); border: 1px solid var(--fr-card-bd); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
  .add h2, .group h2 { font-size: 1rem; margin: 0 0 4px; color: var(--fr-label); }
  /* 手機上靠 flex-wrap 自然換行，不用 @media 當手機開關（手機／桌機分支紀律）。 */
  .add-form { display: flex; gap: 8px; flex-wrap: wrap; }
  .add-form input { flex: 1 1 220px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--fr-card-bd); background: var(--fr-tab-bg); color: var(--fr-fg); font-size: 16px; }

  .group { margin-bottom: 16px; }
  .count { font-size: .78rem; color: var(--fr-dim); font-weight: 400; margin-left: 6px; }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: var(--fr-card-bg); border: 1px solid var(--fr-card-bd); border-radius: 8px; padding: 8px 10px; }
  /* ⚠ 暱稱／備註名都是玩家自由輸入：一定要斷字，否則一長串英數字會把列撐爆（手機直式先爆）。 */
  .nick { font-weight: 600; color: var(--fr-fg); overflow-wrap: anywhere; word-break: break-word; }
  /* ⭐ v6.296 有備註名時，另外用小字顯示原本的暱稱（免得認不出是誰）。 */
  .orig-nick { font-size: .74rem; color: var(--fr-dim); overflow-wrap: anywhere; word-break: break-word; }
  .meta { font-size: .78rem; color: var(--fr-dim); }
  /* ⭐ v6.301 配對到的房間：房名＋房主名一定要看得到（房名是玩家自由輸入 ⇒ 一樣要斷字）。
     ⚠ `flex: 1 1 100%` ＝整列另起一行（與 .confirm／.alias-hint 同一招）：
       夾在按鈕中間會在窄畫面把按鈕列拆成兩半，三種尺寸實測都會破版。 */
  .fr-room { flex: 1 1 100%; font-size: .78rem; color: var(--fr-dim); overflow-wrap: anywhere; word-break: break-word; }
  .spacer { flex: 1; }
  .confirm { font-size: .8rem; color: var(--fr-gold); flex: 1 1 100%; }
  /* 備註名編輯列：整列另起一行（flex 100%），手機直式也不會把既有按鈕擠爆。 */
  .alias-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; flex: 1 1 100%; }
  .alias-input { flex: 1 1 160px; min-width: 0; padding: 5px 9px; border-radius: 6px; border: 1px solid var(--fr-card-bd); background: var(--fr-tab-bg); color: var(--fr-fg); font-size: 16px; }
  .alias-hint { flex: 1 1 100%; margin: 0; }
  .alias-err { flex: 1 1 100%; }

  button.small, button.primary { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--fr-tab-bd); background: var(--fr-tab-bg); cursor: pointer; font: inherit; font-size: .85rem; color: var(--fr-tab-fg); }
  button.primary { background: linear-gradient(180deg, var(--fr-tab-on-from), var(--fr-tab-on-to)); border-color: var(--fr-tab-on-bd); color: var(--fr-tab-on-fg); font-weight: 600; }
  button.danger { color: var(--fr-danger); border-color: var(--fr-danger); }
  button:disabled { opacity: .45; cursor: default; }
</style>
