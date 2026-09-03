<script lang="ts">
  // 好友頁（獨立路由 `/friends`）。
  //
  // ⭐⭐⭐ v6.296 起，**名單本體整個搬到 `$lib/friends/FriendsPanel.svelte`**，
  //   由這一頁與「線上連線對戰大廳的第二個分頁」**共用同一份**（站長要求：不要兩份漂移）。
  //   本檔只剩三件事：
  //     ① 整頁底色（<svelte:head> 注入，離開這一頁時 Svelte 會自動移除）
  //     ② 頁首（← 首頁／標題）與分頁列 —— 用 `head` snippet 傳進面板裡面渲染，
  //        這樣它們才吃得到面板宣告的 --fr-* 色票（CSS 自訂屬性靠 DOM 繼承）
  //     ③ 私聊（DmPanel）：dm-session 的狀態機在這裡，面板用 `foot` snippet 渲染在面板裡面
  //        ⇒ ⭐ `src/routes/game/+page.svelte` 完全不碰 DmPanel（保住 test-v6288 F1 的不變量）。
  //
  // ⚠ 保留的紀律（逐條沿用 v6.283~v6.293）：
  //   ・輪詢只在私聊面板開著時（3 秒；分頁在背景 15 秒），關掉＝session.close() ⇒ 零請求；
  //     排程與狀態機在 $lib/friends/dm-*.ts，本檔仍然零 setTimeout／setInterval（v6.283 B1 守衛）。
  //   ・手機／桌機是 **JS 量視窗**（Math.min(innerWidth, innerHeight) <= 600，與 game/+page.svelte 的
  //     isPortraitMobile 同一條），⚠⚠ 禁用 @media 當手機開關。
  //   ・全頁零 {@html}（暱稱／備註名都是玩家自由輸入）。
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { VERSION } from '$lib/version';
  import type { FriendRow } from '$lib/friends/friends-api';
  import { createDmSession, type DmSession, type DmSessionState } from '$lib/friends/dm-session';
  import { browserPollerDeps } from '$lib/friends/dm-poller';
  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';
  import FriendsPanel from '$lib/friends/FriendsPanel.svelte';
  import DmPanel from './DmPanel.svelte';

  /** 手機直式／桌機兩套分支的開關：JS 量視窗，⚠ 不用 @media。 */
  let isMobile = $state(false);
  let dm: DmSession | null = null;
  /** 面板狀態；null＝面板沒開（DmPanel 不渲染、輪詢已停）。 */
  let dmState = $state<DmSessionState | null>(null);
  /** 私聊在這台伺服器不可用（尚未開放／舊伺服器）的說明；非空 ⇒ 藏掉所有 💬（本次頁面停留期間記住）。 */
  let dmNegMsg = $state('');

  /** 取身分：⚠ 匿名回 null。與好友名單**共用同一份**（$lib/friends/auth-ctx.ts）。 */
  const ctx = friendsCtxFromAuth;

  onMount(() => {
    const onResize = () => { isMobile = Math.min(window.innerWidth, window.innerHeight) <= 600; };
    onResize();
    window.addEventListener('resize', onResize);
    // 分頁回到前景 ⇒ 立刻補一發（背景時排程是 15 秒，不補會等很久）
    const onVis = () => { if (!document.hidden) dm?.poke(); };
    document.addEventListener('visibilitychange', onVis);
    // timer／document.hidden 只在 dm-poller.ts 的 browserPollerDeps 碰（本檔零 setTimeout，v6.283 B1）
    dm = createDmSession({
      getCtx: ctx,
      onChange: (s) => { dmState = s; if (s && (s.status === 'dm-disabled' || s.status === 'unsupported')) dmNegMsg = s.blockMsg; },
      ...browserPollerDeps(),
    });
    return () => {
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
    dm.open(r.fid, r.alias || r.nick);
  }
  function closeDm() { dm?.close(); }
  /** 面板正開著這一位時，對方被解除／封鎖／拒絕 ⇒ 關掉（對話已刪或已無權讀）。 */
  function afterAct(fid: string) { if (dmState && dmState.fid === fid) closeDm(); }
</script>

<svelte:head>
  <title>好友 · ptcg-tw-sim</title>
  <meta name="robots" content="noindex" />
  <!-- ⭐⭐⭐ v6.293 整頁底色 → 墨綠 #162816（與錦標賽／對戰演練同一個底）。
       手法比照 src/routes/game/+page.svelte 的 <svelte:head>：src/routes/+layout.svelte 的
       :global(body) 的白底 baseline 是全站唯一的底色來源，只有「頁面自己在 <svelte:head>
       注入一段 <style>」蓋得掉；而且離開這一頁時 Svelte 會把它從 <head> 移除 ⇒ 墨綠不會被帶到別的頁面。
       ⚠ 寫在元件 <style> 裡的 :global(body) 做不到這件事：SvelteKit 的路由 CSS 不隨導航移除。
       ⚠ 這裡刻意用一般的 <style> 元素而**不是** {@html}：本頁到處是玩家自由輸入的暱稱，
         「整頁零 {@html}」是 test-v6283 B3／test-v6288 E1 在守的紅線，不為了換底色去鬆綁它
         （Svelte 5 不會把 <svelte:head> 底下的 <style> 當成元件樣式，編譯輸出已驗）。 -->
  <style>html, body { margin: 0; background-color: #162816 !important; min-height: 100vh; }</style>
</svelte:head>

<main>
  <FriendsPanel {head} {foot} ondm={openDm} dmMsg={dmNegMsg} dmActiveFid={dmState?.fid ?? ''} onafteract={afterAct} />
</main>

<!-- ⭐ 頁首與分頁列：用 snippet 傳進 FriendsPanel **裡面**渲染 ⇒ 吃得到面板宣告的 --fr-* 色票。
     （這些元素寫在本檔 ⇒ Svelte 的 scoping class 也掛在本檔，底下的 <style> 一樣管得到。） -->
{#snippet head()}
  <header class="page-head">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>👥 好友 <span class="version-tag">v{VERSION}</span></h1>
  </header>

  <!-- ⭐⭐ v6.293 假分頁列：外觀與錦標賽的 .tourn-tabs／.tourn-tab 一致（站長：視覺一致性），
       但這裡是**連結**不是真分頁（真分頁在大廳那一邊，v6.296 已上）⇒ 用 <a> 不是 <button>，
       也不掛 role="tablist"／role="tab"（那會對輔助科技謊稱有分頁面板）。
       ⚠ 「🌐 線上連線對戰」的 URL：/game 預設停在模式選擇畫面，`?mode=online` 是
       game/+page.svelte onMount 內既有的分流參數（v4.935），會自動把 mode 設成 'online' 進線上大廳，
       並把 query 從網址列清掉 ⇒ 這是回大廳的正確寫法。
       ⚠ 兩顆一律不折行（.fr-tab 有 white-space:nowrap，.fr-tabs 是預設的 flex nowrap）。 -->
  <nav class="fr-tabs" aria-label="線上對戰與好友">
    <a class="fr-tab" href="{base}/game?mode=online">🌐 線上連線對戰</a>
    <a class="fr-tab active" href="{base}/friends" aria-current="page">👥 好友名單</a>
  </nav>
{/snippet}

<!-- v6.288 私聊面板：只在 dmState 非 null 時渲染；關掉＝session.close() ⇒ 輪詢停止。position:fixed ⇒ 既有版面零位移 -->
{#snippet foot()}
  {#if dmState}
    <DmPanel sess={dmState} mobile={isMobile} onclose={closeDm} onsend={(t) => { void dm?.send(t); }} onmore={() => { void dm?.loadMore(); }} onretry={() => dm?.retry()} />
  {/if}
{/snippet}

<style>
  /* ⚠ 色碼一律不寫在這裡：--fr-* 的單一來源在 $lib/friends/FriendsPanel.svelte 的 <style> 最上面
     （守衛 test-v6293 B1／B2 逐條比對錦標賽的同一條規則）。本檔只留版面。 */
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
  .version-tag { font-size: .7rem; color: var(--fr-dim); font-weight: 400; }
  .back { font-size: .85rem; text-decoration: none; color: var(--fr-tab-fg); }
  .back:hover { text-decoration: underline; }

  /* ⭐⭐ 假分頁列：外觀比照 game/+page.svelte 的 .tourn-tabs／.tourn-tab（逐條對齊，含 active 的
     inset 光暈），只是把 <button> 換成 <a>。⚠ white-space:nowrap ＋ .fr-tabs 的預設 flex nowrap
     ＝ 兩顆永遠同一列、字永遠不折行（375px 也一樣，DOM 量測在守）。 */
  .fr-tabs { display: flex; gap: 6px; max-width: 100%; margin: 6px auto 12px; }
  .fr-tab {
    flex: 1; min-width: 0; padding: 9px 6px;
    border: 1px solid var(--fr-tab-bd); border-radius: 9px;
    background: var(--fr-tab-bg); color: var(--fr-tab-fg);
    font-size: .9rem; font-weight: 600; text-align: center; text-decoration: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: pointer; transition: .15s;
  }
  .fr-tab:hover { background: var(--fr-tab-hover-bg); }
  .fr-tab.active {
    background: linear-gradient(180deg, var(--fr-tab-on-from), var(--fr-tab-on-to));
    color: var(--fr-tab-on-fg); border-color: var(--fr-tab-on-bd);
    box-shadow: 0 0 0 1px var(--fr-tab-on-bd) inset;
  }

  @media (max-width: 600px) {
    /* ⚠ 只縮小基礎邊距，env() 那一項必須保留（動態島機種才按得到「← 首頁」）。 */
    main {
      padding: calc(10px + var(--safe-top, 0px))
               max(12px, var(--safe-right, 0px))
               40px
               max(12px, var(--safe-left, 0px));
    }
  }
</style>
