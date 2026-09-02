/**
 * v6.288 好友私聊面板的狀態機（不含畫面）。`/friends` 頁的 `DmPanel.svelte` 只是這個狀態的純檢視。
 *
 * 為什麼把狀態機從 Svelte 元件抽出來：守衛可以在 node 裡用**假 fetch＋假 timer**把整段生命週期實跑一遍
 * （開面板 ⇒ 一發 list；3 秒一發 since；`document.hidden` ⇒ 15 秒；關面板 ⇒ 200 個 tick 零請求），
 * 而不是只比對原始碼字串（安慰劑）。
 *
 * ── 生命週期 ────────────────────────────────────────────────────────────────
 *   open(fid, nick)  → 第一發 `since=0`（最新 50 則）→ 之後由 poller 每 3／15 秒發 `since=最後一則 ts`
 *                      （沒有訊息時 since=1 ⇒ 伺服器走增量分支，沒新訊息就 204 零 body）。
 *   send(text)       → POST；成功後**不**自己塞進清單，而是立刻 poke 一發 since（同時撈到對方在這段時間發的）。
 *   loadMore()       → `before=最早一則 ts` 往前翻一頁（不影響輪詢）。
 *   close()          → poller.stop()；狀態清空 ⇒ 之後零請求。
 *   切換好友（open 另一個 fid）＝ close 再 open（永遠只有一個 poller）。
 *
 * ── 失敗分類（給玩家看的文案都在這裡決定；畫面只顯示）────────────────────────
 *   dm-disabled（503 friends-dm-disabled）／unsupported（404）／auth（401）⇒ 停止輪詢、整個面板換成說明。
 *   friends-dm-not-friends（403：關係已不存在或被封鎖）⇒ 停止輪詢、顯示「無法開啟對話」（不洩漏封鎖）。
 *   busy（429）⇒ 只掛一行「發言太快」，輪詢照常。 transient／network ⇒ 掛一行、輪詢照常（下一發自動重試）。
 */
import {
  fetchDmMessages, sendDm,
  FRIENDS_DM_NOT_FRIENDS_MSG,
  type DmMessage, type FriendsCtx, type FriendsResult,
} from './friends-api';
import { createDmPoller, type DmPoller } from './dm-poller';

export type DmPanelStatus =
  | 'loading'        // 第一發還沒回來
  | 'ready'          // 正常顯示（輪詢中）
  | 'dm-disabled'    // 站長沒開私聊子開關
  | 'unsupported'    // 伺服器沒有私聊端點
  | 'auth'           // 沒登入／token 過期
  | 'not-friends'    // 關係已不存在或被封鎖（不區分）
  | 'error';         // 第一發暫時性失敗（可重試）

export interface DmSessionState {
  fid: string;
  nick: string;
  status: DmPanelStatus;
  messages: DmMessage[];
  hasMore: boolean;
  loadingMore: boolean;
  sending: boolean;
  /** 一行提示（送出失敗／429／暫時性失敗）；空字串＝沒有。 */
  notice: string;
  /** 整面板說明（status 非 loading／ready 時）。 */
  blockMsg: string;
  /** 只在 ready 時有意義：目前輪詢間隔（毫秒），給畫面顯示「已放慢」用。 */
  pollMs: number;
}

export interface DmSessionDeps {
  /** 取身分（拿不到 ⇒ null ⇒ 狀態 auth，不發請求）。 */
  getCtx: () => Promise<FriendsCtx | null>;
  onChange: (s: DmSessionState | null) => void;
  isHidden: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  activeMs?: number;
  hiddenMs?: number;
}

export interface DmSession {
  open(fid: string, nick: string): void;
  close(): void;
  send(text: string): Promise<void>;
  loadMore(): Promise<void>;
  /** 分頁回到前景時呼叫：立刻補一發。 */
  poke(): void;
  retry(): void;
  /** 目前打開的 fid（沒開 ⇒ ''）。 */
  currentFid(): string;
}

const DM_MAX_KEEP = 400;   // 記憶體上限：超過就丟最舊的（畫面也不需要更多）

export function createDmSession(deps: DmSessionDeps): DmSession {
  let st: DmSessionState | null = null;
  let poller: DmPoller | null = null;
  let seq = 0;               // 每次 open/close 遞增；遲到的回應一律丟棄（v6.175 的教訓：遲到的答案不能當現在的答案）
  const ids = new Set<string>();

  function emit(): void { deps.onChange(st ? { ...st, messages: st.messages } : null); }
  function set(p: Partial<DmSessionState>): void { if (!st) return; Object.assign(st, p); emit(); }
  function pollMsNow(): number { return deps.isHidden() ? (deps.hiddenMs ?? 15000) : (deps.activeMs ?? 3000); }

  /** 把一批訊息併進去（去重、依 ts 升序、上限）。回真的新增了幾則。 */
  function merge(batch: DmMessage[], prepend: boolean): number {
    if (!st) return 0;
    const fresh = batch.filter((m) => m.id && !ids.has(m.id));
    if (!fresh.length) return 0;
    for (const m of fresh) ids.add(m.id);
    let arr = prepend ? fresh.concat(st.messages) : st.messages.concat(fresh);
    arr.sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
    if (arr.length > DM_MAX_KEEP) {
      for (const m of arr.slice(0, arr.length - DM_MAX_KEEP)) ids.delete(m.id);
      arr = arr.slice(arr.length - DM_MAX_KEEP);
    }
    st.messages = arr;
    return fresh.length;
  }

  /** 把失敗結果翻成狀態。回 true 表示「已切成終止狀態、要停輪詢」。 */
  function applyFail(r: Extract<FriendsResult<unknown>, { ok: false }>, firstLoad: boolean): boolean {
    if (!st) return true;
    if (r.kind === 'dm-disabled') { set({ status: 'dm-disabled', blockMsg: r.message, notice: '' }); return true; }
    if (r.kind === 'unsupported') { set({ status: 'unsupported', blockMsg: r.message, notice: '' }); return true; }
    if (r.kind === 'disabled') { set({ status: 'dm-disabled', blockMsg: r.message, notice: '' }); return true; }
    if (r.kind === 'auth') { set({ status: 'auth', blockMsg: r.message, notice: '' }); return true; }
    if (r.code === 'friends-dm-not-friends' || r.code === 'bad-fid') { set({ status: 'not-friends', blockMsg: FRIENDS_DM_NOT_FRIENDS_MSG, notice: '' }); return true; }
    if (firstLoad) { set({ status: 'error', blockMsg: r.message, notice: '' }); return true; }
    // 輪詢中的暫時性失敗（network／transient／busy）：掛一行，下一發自動重試
    set({ notice: r.message });
    return false;
  }

  async function runOnce(): Promise<void> {
    if (!st) return;
    const s = seq;
    const ctx = await deps.getCtx();
    if (s !== seq || !st) return;
    if (!ctx) { set({ status: 'auth', blockMsg: '請先以 email 帳號登入。', notice: '' }); poller?.stop(); return; }
    const first = st.status === 'loading';
    const last = st.messages.length ? st.messages[st.messages.length - 1].ts : 0;
    // ⭐ since：已有最後一則的 ts；還沒有任何訊息 ⇒ since=1（>0 才走伺服器的增量分支＝204 零 body）
    const r = await fetchDmMessages(ctx, st.fid, first ? {} : { since: Math.max(1, last) });
    if (s !== seq || !st) return;
    if (!r.ok) { if (applyFail(r, first)) poller?.stop(); return; }
    if (first) {
      merge(r.data.messages, false);
      set({ status: 'ready', hasMore: r.data.hasMore, notice: '', blockMsg: '', pollMs: pollMsNow() });
      return;
    }
    if (!r.data.noNew) merge(r.data.messages, false);
    set({ notice: '', pollMs: pollMsNow() });
  }

  function open(fid: string, nick: string): void {
    close();
    seq++;
    ids.clear();
    st = { fid, nick, status: 'loading', messages: [], hasMore: false, loadingMore: false, sending: false, notice: '', blockMsg: '', pollMs: 0 };
    emit();
    poller = createDmPoller({
      run: runOnce, isHidden: deps.isHidden, setTimer: deps.setTimer, clearTimer: deps.clearTimer,
      activeMs: deps.activeMs, hiddenMs: deps.hiddenMs,
    });
    poller.start();
  }
  function close(): void {
    seq++;
    if (poller) { poller.stop(); poller = null; }
    if (st) { st = null; emit(); }
  }
  async function send(text: string): Promise<void> {
    if (!st || st.status !== 'ready' || st.sending) return;
    const s = seq;
    set({ sending: true, notice: '' });
    try {
      const ctx = await deps.getCtx();
      if (s !== seq || !st) return;
      if (!ctx) { set({ status: 'auth', blockMsg: '請先以 email 帳號登入。' }); poller?.stop(); return; }
      const r = await sendDm(ctx, st.fid, text);
      if (s !== seq || !st) return;
      if (!r.ok) { if (applyFail(r, false)) poller?.stop(); return; }
      // 成功：不自己塞，立刻補一發 since（同時撈到對方這段時間的訊息，且以伺服器 id 去重）
      poller?.poke();
    } finally {
      if (s === seq && st) set({ sending: false });
    }
  }
  async function loadMore(): Promise<void> {
    if (!st || st.status !== 'ready' || st.loadingMore || !st.hasMore || !st.messages.length) return;
    const s = seq;
    set({ loadingMore: true });
    try {
      const ctx = await deps.getCtx();
      if (s !== seq || !st) return;
      if (!ctx) return;
      const r = await fetchDmMessages(ctx, st.fid, { before: st.messages[0].ts });
      if (s !== seq || !st) return;
      if (!r.ok) { set({ notice: r.message }); return; }
      merge(r.data.messages, true);
      set({ hasMore: r.data.hasMore });
    } finally {
      if (s === seq && st) set({ loadingMore: false });
    }
  }
  return {
    open, close, send, loadMore,
    poke() { poller?.poke(); },
    retry() { if (st) open(st.fid, st.nick); },
    currentFid() { return st ? st.fid : ''; },
  };
}
