<script lang="ts">
  // v6.288 好友私聊面板（純檢視）：狀態全部來自 $lib/friends/dm-session.ts，這裡只畫、只把按鈕轉成回呼。
  //
  // ⚠ 幾件刻意的決定：
  //   ・⚠⚠ 純文字渲染：訊息、暱稱一律走 Svelte 預設 escape，本檔零 {@html}（守衛鎖）。
  //   ・⚠⚠ 手機／桌機是**兩個分支**（`mobile` prop 由 /friends 頁以 JS 量視窗決定），本檔**沒有任何 @media**：
  //       桌機＝右下角固定面板（position:fixed，不佔文件流 ⇒ 既有好友列零位移）；手機＝全螢幕 overlay（position:fixed; inset:0）。
  //   ・每個 {#each} 都用伺服器 id 當穩定 key（清單只增不減、會前插）。
  //   ・輪詢的生命週期不在這裡：面板被卸載（{#if} 關掉）時，/friends 頁會呼叫 session.close() ⇒ 零請求。
  import { type DmSessionState } from '$lib/friends/dm-session';
  import { DM_MAX_LEN } from '$lib/friends/friends-api';

  let { sess, mobile, onclose, onsend, onmore, onretry }: {
    sess: DmSessionState;
    mobile: boolean;
    onclose: () => void;
    onsend: (text: string) => void;
    onmore: () => void;
    onretry: () => void;
  } = $props();

  let text = $state('');
  let listEl = $state<HTMLDivElement | null>(null);
  let lastId = '';
  let firstId = '';

  const canType = $derived(sess.status === 'ready' && !sess.sending);
  const canSend = $derived(canType && text.trim().length > 0);
  const slowed = $derived(sess.status === 'ready' && sess.pollMs > 3000);

  // 新訊息追加 ⇒ 捲到底；往前翻頁（前插）⇒ 保住原本看的位置。
  $effect(() => {
    const ms = sess.messages;
    const el = listEl;
    if (!el || !ms.length) return;
    const nl = ms[ms.length - 1].id, nf = ms[0].id;
    if (nl !== lastId) { lastId = nl; firstId = nf; queueMicrotask(() => { el.scrollTop = el.scrollHeight; }); return; }
    if (nf !== firstId) { const before = el.scrollHeight; firstId = nf; queueMicrotask(() => { el.scrollTop += el.scrollHeight - before; }); }
  });

  function submit(e: Event) {
    e.preventDefault();
    if (!canSend) return;
    const t = text;
    text = '';
    onsend(t);
  }
  function fmt(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
</script>

<!-- ⚠ .dm-panel 的 mobile / desktop 兩個 class 互斥，由 JS 決定（禁 @media 當手機開關） -->
<section class="dm-panel {mobile ? 'mobile' : 'desktop'}" aria-label="私聊">
  <header class="dm-head">
    <span class="dm-title">💬 <span class="dm-nick">{sess.nick}</span></span>
    {#if slowed}<span class="dm-slow" title="分頁在背景時放慢更新">已放慢更新</span>{/if}
    <button class="dm-close" type="button" onclick={onclose} aria-label="關閉私聊">✕</button>
  </header>

  {#if sess.status === 'loading'}
    <p class="dm-empty">載入中…</p>
  {:else if sess.status === 'ready'}
    <div class="dm-list" bind:this={listEl}>
      {#if sess.hasMore}
        <button class="dm-more" type="button" disabled={sess.loadingMore} onclick={onmore}>{sess.loadingMore ? '載入中…' : '載入更早的訊息'}</button>
      {/if}
      {#if sess.messages.length === 0}
        <p class="dm-empty">還沒有訊息，說聲嗨吧。</p>
      {/if}
      {#each sess.messages as m (m.id)}
        <div class="dm-msg {m.mine ? 'mine' : 'theirs'}">
          <span class="dm-bubble">{m.text}</span>
          <span class="dm-ts">{fmt(m.ts)}</span>
        </div>
      {/each}
    </div>
    {#if sess.notice}<p class="dm-notice">{sess.notice}</p>{/if}
    <form class="dm-form" onsubmit={submit}>
      <input type="text" bind:value={text} maxlength={DM_MAX_LEN} placeholder={sess.sending ? '送出中…' : '輸入訊息（最多 200 字）'} disabled={!canType} autocomplete="off" enterkeyhint="send" />
      <button class="dm-send" type="submit" disabled={!canSend}>{sess.sending ? '送出中…' : '送出'}</button>
    </form>
  {:else}
    <!-- dm-disabled／unsupported／auth／not-friends／error：整面板換成說明 -->
    <div class="dm-block">
      <p>{sess.blockMsg}</p>
      {#if sess.status === 'error'}<button class="dm-more" type="button" onclick={onretry}>重試</button>{/if}
    </div>
  {/if}
</section>

<style>
  /* ⚠⚠ 本檔零 @media：手機／桌機由 .mobile / .desktop 兩個 class 分支（JS 決定），不可用媒體查詢當開關。 */
  .dm-panel {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    background: #fff;   /* /friends 頁是白底（layout 的 body baseline #f4f4f6），面板要不透明 */
    color: #1c1c1c;
    border: 1px solid rgba(128,128,128,.35);
    box-shadow: 0 8px 28px rgba(0,0,0,.35);
  }
  .dm-panel.desktop {
    right: 16px;
    bottom: 16px;
    width: 360px;
    height: min(520px, calc(100vh - 32px));
    border-radius: 12px;
  }
  .dm-panel.mobile {
    inset: 0;
    width: auto;
    height: auto;
    border: 0;
    border-radius: 0;
    padding-top: var(--safe-top, 0px);
    padding-bottom: var(--safe-bottom, 0px);
  }
  .dm-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(128,128,128,.25); }
  .dm-title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dm-nick { overflow-wrap: anywhere; }
  .dm-slow { font-size: .72rem; opacity: .6; }
  .dm-close { border: 0; background: transparent; color: inherit; font-size: 1.1rem; cursor: pointer; padding: 4px 8px; }
  .dm-list { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
  .dm-msg { display: flex; flex-direction: column; max-width: 85%; }
  .dm-msg.mine { align-self: flex-end; align-items: flex-end; }
  .dm-msg.theirs { align-self: flex-start; align-items: flex-start; }
  /* ⚠ 訊息是玩家自由輸入：一定要斷字，否則一長串英數字會把面板撐爆 */
  .dm-bubble { padding: 6px 10px; border-radius: 10px; background: rgba(128,128,128,.18); overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; font-size: .92rem; line-height: 1.4; }
  .dm-msg.mine .dm-bubble { background: rgba(80,140,255,.28); }
  .dm-ts { font-size: .68rem; opacity: .55; margin-top: 2px; }
  .dm-empty { opacity: .6; padding: 12px 10px; margin: 0; }
  .dm-more { align-self: center; font: inherit; font-size: .8rem; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; cursor: pointer; }
  .dm-more:disabled { opacity: .5; cursor: default; }
  .dm-notice { color: #b26a00; font-size: .8rem; margin: 0; padding: 4px 10px; }
  .dm-block { padding: 14px 12px; font-size: .9rem; line-height: 1.6; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .dm-block p { margin: 0; }
  .dm-form { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid rgba(128,128,128,.25); }
  .dm-form input { flex: 1; min-width: 0; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; font-size: 16px; }
  .dm-send { font: inherit; font-size: .9rem; padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(80,140,255,.6); background: rgba(80,140,255,.18); color: inherit; font-weight: 600; cursor: pointer; }
  .dm-send:disabled { opacity: .45; cursor: default; }
</style>
