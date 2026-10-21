<script lang="ts">
  import { projectPlayerClock, type PlayerClockState } from '$lib/tournament/player-clock';
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
</script>

<div bind:this={box} class="clock-notice" class:quick class:urgent={quick && seconds <= 10 && !waiting}
  style:left={left === null ? undefined : `${left}px`} style:top={top === null ? undefined : `${top}px`}
  style:right={left === null ? undefined : 'auto'} aria-label="個人操作時間">
  <button class="handle" onpointerdown={start} onpointermove={move} onpointerup={() => drag = null}
    onpointercancel={() => drag = null} title="拖曳移動提醒視窗">
    {quick ? '⚠ 限時操作' : '⏱ 個人剩餘時間'} <span>⠿</span>
  </button>
  <div class="digits" role="timer" aria-live="off">{quick ? seconds : fmt(seconds)}{#if quick}<small> 秒</small>{/if}</div>
  <p aria-live="polite">{view.stalled[seat] ? '電腦無法完成此選擇，請手動操作'
    : waiting ? '等待對手操作・倒數暫停'
    : quick && seconds === 0 ? '電腦正在完成必要收尾'
    : quick ? '請盡快決定，時間到由電腦收尾' : `本場額度 ${view.minutes} 分鐘`}</p>
</div>

<style>
  .clock-notice { position:fixed; right:12px; top:calc(var(--safe-top, 0px) + 172px); z-index:10010;
    width:210px; max-width:62vw; border:2px solid #55725d; border-radius:12px; background:#15271e;
    color:#fff; box-shadow:0 3px 14px #0006; text-align:center; pointer-events:none; padding:0 8px 8px; }
  .handle { width:100%; border:0; background:transparent; color:inherit; font-weight:700; padding:8px 0;
    cursor:move; touch-action:none; pointer-events:auto; font-size:13px; }
  .handle span { float:right; }
  .digits { font-variant-numeric:tabular-nums; font-size:24px; font-weight:800; line-height:1.15; }
  .digits small { font-size:15px; }
  p { font-size:12px; line-height:1.4; margin:5px 0 0; }
  .quick { background:#fff4cf; color:#3b2700; border-color:#b27a00; }
  .quick .digits { font-size:40px; }
  .urgent { background:#811b1b; color:#fff; border-color:#ffb4a8; }
  .urgent .digits { font-size:46px; }
  @media(max-width:600px) { .clock-notice { width:176px; right:8px; } .quick .digits { font-size:36px; } .urgent .digits { font-size:42px; } }
</style>
