/**
 * v6.288 好友私聊的輪詢排程器（純函式、零 import、timer 全部注入 ⇒ 守衛用假 timer 逐 tick 實跑）。
 *
 * ── ⚠⚠ 效能紅線（站長：不可再造成伺服器不穩定）──────────────────────────────
 *   ・只在「面板開著」（`start()` 之後、`stop()` 之前）才會排下一發；**`stop()` 之後零請求**
 *     （守衛：stop 後跑 200 個 tick 斷言 run 零呼叫；在途的 run 結束後也不得再排）。
 *   ・前景 3 秒一發（`DM_POLL_ACTIVE_MS`）；分頁被藏起來（`document.hidden`）時放慢到 15 秒（`DM_POLL_HIDDEN_MS`）。
 *   ・一次只會有一發在途：run 還沒回來就不排新的（`tick` 以 async 串接，不是 setInterval）。
 *   ・`poke()`＝立刻跑一次（送出訊息後／分頁回到前景時），仍受「在途只一發」限制。
 *
 * ⚠ 本模組不知道 fetch、不知道 fid；「一發要做什麼」由 `dm-session.ts` 的 `run` 決定。
 */

export const DM_POLL_ACTIVE_MS = 3000;
export const DM_POLL_HIDDEN_MS = 15000;

export interface DmPollerDeps {
  /** 一次輪詢要做的事（由呼叫端決定發不發請求）。⚠ 丟出的例外會被吞掉，不會讓排程器停下。 */
  run: () => Promise<void>;
  /** `document.hidden`（測試注入）。 */
  isHidden: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  activeMs?: number;
  hiddenMs?: number;
}

export interface DmPoller {
  /** 開始：立刻跑一次 run，之後依前景／背景間隔排下一發。重複呼叫無效。 */
  start(): void;
  /** 停止：清掉排程；在途的 run 結束後也不再排。之後零請求。 */
  stop(): void;
  /** 立刻跑一次（在途中則略過）。停止狀態下無效。 */
  poke(): void;
  isActive(): boolean;
  /** 目前排程用的間隔（毫秒）；停止或無排程時為 0。 */
  scheduledMs(): number;
}

/**
 * 瀏覽器實作（/friends 頁用；守衛改注入假 timer）。⚠ 全站好友相關檔案裡**只有這裡**碰真的 setTimeout／document.hidden，
 * friends-api.ts／dm-session.ts／+page.svelte 都不直接開 timer（v6.283 B1 守衛：那三支零 setTimeout）。
 */
export function browserPollerDeps(): Pick<DmPollerDeps, 'isHidden' | 'setTimer' | 'clearTimer'> {
  return {
    isHidden: () => typeof document !== 'undefined' && document.hidden === true,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

export function createDmPoller(deps: DmPollerDeps): DmPoller {
  const activeMs = deps.activeMs ?? DM_POLL_ACTIVE_MS;
  const hiddenMs = deps.hiddenMs ?? DM_POLL_HIDDEN_MS;
  let active = false;
  let gen = 0;                 // 每次 start/stop 遞增；在途的 run 回來時若世代變了就不排
  let timer: unknown = null;
  let scheduled = 0;
  let inFlight = false;

  function clear(): void {
    if (timer !== null) { deps.clearTimer(timer); timer = null; }
    scheduled = 0;
  }
  function schedule(): void {
    if (!active) return;
    clear();
    const ms = deps.isHidden() ? hiddenMs : activeMs;
    scheduled = ms;
    timer = deps.setTimer(() => { timer = null; scheduled = 0; void tick(); }, ms);
  }
  async function tick(): Promise<void> {
    if (!active || inFlight) return;
    const g = gen;
    inFlight = true;
    try { await deps.run(); } catch { /* 一發失敗不停排程；錯誤由 run 自己記到狀態 */ }
    inFlight = false;
    // ⚠⚠ 在途中被 stop()（或 stop 後又 start）⇒ 世代不同 ⇒ 不排（否則「關掉面板」之後還會再發一發）
    if (active && g === gen) schedule();
  }
  return {
    start() {
      if (active) return;
      active = true; gen++;
      void tick();
    },
    stop() {
      active = false; gen++;
      clear();
    },
    poke() {
      if (!active || inFlight) return;
      clear();
      void tick();
    },
    isActive() { return active; },
    scheduledMs() { return active ? scheduled : 0; },
  };
}
