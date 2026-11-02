<script lang="ts">
  import { projectPlayerClock, type PlayerClockState } from '$lib/tournament/player-clock';
  import { modalDrag } from '$lib/modal-drag';   // ⭐v6.619 縮小後的圓形氣泡走全站浮動按鈕的中央拖曳（同聊天 💬 氣泡）
  let { clock, seat, now }: { clock: PlayerClockState; seat: 0 | 1; now: number } = $props();
  const view = $derived(projectPlayerClock(clock, now));
  const quick = $derived(view.quick[seat]);
  const waiting = $derived(!view.actors.includes(seat));
  const seconds = $derived(Math.max(0, Math.ceil((quick ? view.quickLeft[seat] : view.minutes * 60000 - view.spent[seat]) / 1000)));
  let box: HTMLDivElement;
  let left = $state<number | null>(null);
  let top = $state<number | null>(null);
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  function start(e: PointerEvent) {
    const rect = box.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, drag.left + e.clientX - drag.x));
    top = Math.max(64, Math.min(window.innerHeight - box.offsetHeight - 24, drag.top + e.clientY - drag.y));
  }
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ⭐v6.619 站長：「這個錦標賽個人計時用的小視窗，建議也能比照聊天氣泡，增加一個縮小成聊天氣泡大小的按鈕與功能，避免干擾玩家的遊玩版面」
  //   ・標題列右側「－」⇒ 網頁版縮成和聊天 💬 氣泡一樣大的圓鈕（54px）；手機縮成只有數字的小膠囊（高 24px，站長：「手機版的越小越好」）；點一下展開回原本的視窗。
  //   ・站長追加：「縮小的氣泡可以改成，只顯示倒數計時的簡化數字時間版本」⇒ 氣泡裡只有數字（14:32；限時操作時只剩秒數 8），沒有圖示與文字。
  //   ・氣泡可拖曳（中央 use:modalDrag，contain 夾制、12px 門檻區分點擊與拖曳，同聊天氣泡）。
  //   ・縮小狀態與氣泡位置記在本機（localStorage，只是個人偏好；讀寫失敗就用預設：展開、原位置）。
  //   ・限時操作時氣泡改黃底、剩 10 秒內改紅底並閃爍，縮小時也看得到緊急狀態；不會自動展開（尊重玩家的選擇）。
  const MIN_KEY = 'ptcg_clock_min';
  const POS_KEY = 'ptcg_clock_fab_pos';
  let minimized = $state(false);
  let fabPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  if (typeof window !== 'undefined') {
    try { minimized = localStorage.getItem(MIN_KEY) === '1'; } catch { /* 讀不到就維持展開 */ }
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
      if (p && typeof p.x === 'number' && typeof p.y === 'number') fabPos = { x: p.x, y: p.y };   // 夾制由中央 action 掛載後完成
    } catch { /* 位置壞掉就用預設 */ }
  }
  function setMinimized(v: boolean) {
    minimized = v;
    try { localStorage.setItem(MIN_KEY, v ? '1' : '0'); } catch { /* 寫不進去只影響下次重整 */ }
  }
  function saveFabPos(p: { x: number; y: number }) {
    fabPos = p;
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* 同上 */ }
  }
  const urgent = $derived(quick && seconds <= 10 && !waiting);
  // 審查 P3-3：aria-label 固定（不放每秒變動的時間，避免螢幕閱讀器每秒重唸）
</script>

{#if minimized}
<button class="clock-fab" class:quick class:urgent class:waiting class:stalled={view.stalled[seat]} type="button"
  use:modalDrag={{ clamp: 'contain', wholeNode: true, threshold: 12, stopPropagation: true, overlay: false, initial: fabPos, onEnd: saveFabPos }}
  onclick={() => setMinimized(false)} aria-label="個人計時（點擊展開）" aria-expanded="false" title="點擊展開個人計時；拖曳可移動位置">
  <span class="fab-time" aria-hidden="true">{quick ? seconds : fmt(seconds)}</span>
</button>
{:else}

<div bind:this={box} class="clock-notice" class:quick class:urgent={quick && seconds <= 10 && !waiting}
  style:left={left === null ? undefined : `${left}px`} style:top={top === null ? undefined : `${top}px`}
  style:right={left === null ? undefined : 'auto'} aria-label="個人操作時間">
  <div class="head">
    <button class="handle" onpointerdown={start} onpointermove={move} onpointerup={() => drag = null}
      onpointercancel={() => drag = null} title="拖曳移動提醒視窗">
      {quick ? '⚠ 限時操作' : '⏱ 個人剩餘時間'} <span>⠿</span>
    </button>
    <button class="min-btn" type="button" onclick={() => setMinimized(true)} aria-label="縮小成氣泡" aria-expanded="true" title="縮小成氣泡（不干擾遊玩版面）">－</button>
  </div>
  <div class="digits" role="timer" aria-live="off">{quick ? seconds : fmt(seconds)}{#if quick}<small> 秒</small>{/if}</div>
  <p aria-live="polite">{view.stalled[seat] ? '電腦無法完成此選擇，請手動操作'
    : waiting ? '等待對手操作・倒數暫停'
    : quick && seconds === 0 ? '電腦正在完成必要收尾'
    : quick ? '請盡快決定，時間到由電腦收尾' : `本場額度 ${view.minutes} 分鐘`}</p>
</div>
{/if}

<style>
  .clock-notice { position:fixed; right:12px; top:calc(var(--safe-top, 0px) + 172px); z-index:10010;
    width:210px; max-width:62vw; border:2px solid #55725d; border-radius:12px; background:#15271e;
    color:#fff; box-shadow:0 3px 14px #0006; text-align:center; pointer-events:none; padding:0 8px 8px; }
  .handle { width:100%; border:0; background:transparent; color:inherit; font-weight:700; padding:8px 0;
    cursor:move; touch-action:none; pointer-events:auto; font-size:13px; }
  .handle span { float:right; }
  /* ⭐v6.619 標題列：拖曳把手＋縮小鈕 */
  .head { display:flex; align-items:center; gap:2px; margin-right:-4px; }
  .head .handle { flex:1 1 auto; min-width:0; }
  .min-btn { flex:0 0 auto; width:30px; height:30px; border:0; border-radius:8px; background:transparent; color:inherit;
    font-size:18px; font-weight:800; line-height:1; cursor:pointer; pointer-events:auto; padding:0; }
  .min-btn:hover { background:#ffffff22; }
  .quick .min-btn:hover { background:#0000001a; }
  /* ⭐v6.619 縮小後的氣泡：大小、位置比照聊天 💬 氣泡（54px 圓、陰影、可拖曳），預設停在原本視窗的右上角位置 */
  .clock-fab { position:fixed; right:calc(12px + var(--safe-right, 0px)); top:calc(var(--safe-top, 0px) + 172px); z-index:10010;
    width:54px; height:54px; border-radius:50%; border:2px solid #55725d; background:#15271e; color:#fff;
    box-shadow:0 4px 12px rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center;
    gap:0; padding:0; cursor:grab; touch-action:none; user-select:none; font-variant-numeric:tabular-nums; }
  .clock-fab:active { cursor:grabbing; }
  .fab-time { font-size:15px; font-weight:800; line-height:1; letter-spacing:-.3px; }
  .clock-fab.waiting { opacity:.85; border-style:dashed; }   /* 等待對手、倒數暫停（審查 P3-1） */
  .clock-fab.stalled { outline:3px solid #ffd44a; outline-offset:1px; }   /* 電腦無法完成、需要手動操作：縮小時也看得出來（審查 P3-1） */
  .clock-fab.quick { background:#fff4cf; color:#3b2700; border-color:#b27a00; }
  .clock-fab.quick .fab-time { font-size:22px; }
  .clock-fab.urgent { background:#811b1b; color:#fff; border-color:#ffb4a8; animation:clock-fab-pulse 1s ease-in-out infinite; }
  @keyframes clock-fab-pulse { 50% { box-shadow:0 0 0 6px rgba(255,120,100,.45), 0 4px 12px rgba(0,0,0,.4); } }
  @media (prefers-reduced-motion: reduce) { .clock-fab.urgent { animation:none; } }
  .digits { font-variant-numeric:tabular-nums; font-size:24px; font-weight:800; line-height:1.15; }
  .digits small { font-size:15px; }
  p { font-size:12px; line-height:1.4; margin:5px 0 0; }
  .quick { background:#fff4cf; color:#3b2700; border-color:#b27a00; }
  .quick .digits { font-size:40px; }
  .urgent { background:#811b1b; color:#fff; border-color:#ffb4a8; }
  .urgent .digits { font-size:46px; }
  @media(max-width:600px) { .clock-notice { width:176px; right:8px; } .quick .digits { font-size:36px; } .urgent .digits { font-size:42px; }
    /* ⭐v6.619 站長：「手機版的越小越好，因為手機版的版面空間已經很拮据了」⇒ 手機縮成只有數字的小膠囊（高 24px、寬隨數字），
       可點範圍用透明的 ::before 往外擴 10px（看起來小、手指仍點得到）。 */
    .clock-fab { width:auto; min-width:0; height:24px; padding:0 6px; border-radius:12px; border-width:1px;
      right:calc(8px + var(--safe-right, 0px)); box-shadow:0 2px 6px rgba(0,0,0,.35); }
    .clock-fab::before { content:''; position:absolute; inset:-10px; }
    .fab-time { font-size:12px; }
    .clock-fab.quick .fab-time { font-size:14px; } }
</style>
