/**
 * v6.022 錦標賽通知 — 瀏覽器 glue 層（薄）。
 *
 * 所有「該不該發」的判斷都在 notify-core.ts（純函式、可單元測試）；本檔只負責：
 *   權限查詢／偏好與 seen 的 localStorage 持久化／取得 Service Worker registration 發通知。
 *
 * ⚠Android Chrome 不允許頁面層 `new Notification()`（會 throw Illegal constructor），
 *   一律優先走 `registration.showNotification()`；無 registration（開發模式沒註冊 SW）時
 *   才在桌機 fallback，且用 try/catch 包住讓 Android 靜默略過。
 * ⚠偏好鍵沿用專案既有 pattern（比照 ptcg.audio.*）。
 */
import {
  decideNotify, scanTournamentAlerts, buildTurnIntent, pruneSeen,
  TURN_MIN_INTERVAL_MS, SEEN_TTL_MS,
  type NotifyIntent, type AlertEventLite, type AlertMatchLite,
} from './notify-core';

const KEY_ENABLED = 'ptcg.notify.enabled';
const KEY_PROMPT_DISMISSED = 'ptcg.notify.promptDismissed';
const KEY_PROMPTED = 'ptcg.notify.prompted';
const KEY_SEEN = 'ptcg.notify.seen';

let _seen: Record<string, number> = {};
let _loaded = false;
/** 「換你行動」節流：roomId → 上次發送時間（僅記憶體，重整即清，去重仍由 seen 保障）。 */
const _turnLastShown = new Map<string, number>();

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}
function supported(): boolean {
  return hasWindow() && typeof Notification !== 'undefined';
}

/** 目前權限（不支援通知的環境回 'denied'，讓上層一律走「不發」路徑）。 */
export function getPermission(): 'granted' | 'denied' | 'default' {
  if (!supported()) return 'denied';
  try { return Notification.permission as 'granted' | 'denied' | 'default'; } catch { return 'denied'; }
}

export function getNotifyEnabled(): boolean {
  if (!hasWindow()) return false;
  try { return localStorage.getItem(KEY_ENABLED) === '1'; } catch { return false; }
}
export function saveNotifyEnabled(on: boolean): void {
  if (!hasWindow()) return;
  try { localStorage.setItem(KEY_ENABLED, on ? '1' : '0'); } catch { /* quota/隱私模式 → 忽略 */ }
}

/** 首次詢問只做一次：問過（不論答應與否）就不再自動彈。 */
export function hasPrompted(): boolean {
  if (!hasWindow()) return true;
  try { return localStorage.getItem(KEY_PROMPTED) === '1' || localStorage.getItem(KEY_PROMPT_DISMISSED) === '1'; } catch { return true; }
}
export function markPrompted(dismissed = false): void {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(KEY_PROMPTED, '1');
    if (dismissed) localStorage.setItem(KEY_PROMPT_DISMISSED, '1');
  } catch { /* 忽略 */ }
}

/** 是否該在「首次進錦標賽大廳」自動彈出說明視窗。 */
export function shouldPromptOnLobby(): boolean {
  if (!supported()) return false;
  if (getPermission() !== 'default') return false;  // 已允許或已封鎖 → 不彈
  return !hasPrompted();
}

/**
 * 向瀏覽器要權限。**必須在使用者點擊事件中呼叫**（保留 user gesture，
 * 否則 Chrome 會降權成靜默拒絕、且之後很難再問）。
 */
export async function requestNotifyPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!supported()) return 'denied';
  markPrompted(false);
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') saveNotifyEnabled(true);
    return p as 'granted' | 'denied' | 'default';
  } catch { return 'denied'; }
}

/** iOS 必須「加入主畫面」成 PWA 才有通知能力（Apple 限制，Safari 分頁直開永遠不支援）。 */
export function isIOSNeedsInstall(): boolean {
  if (!hasWindow()) return false;
  try {
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/.test(ua)
      || (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints as number > 1);
    if (!isIOS) return false;
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    return !standalone;
  } catch { return false; }
}

function loadSeen(): void {
  if (_loaded || !hasWindow()) return;
  _loaded = true;
  try {
    const raw = localStorage.getItem(KEY_SEEN);
    _seen = raw ? pruneSeen(JSON.parse(raw) as Record<string, number>, Date.now(), SEEN_TTL_MS) : {};
  } catch { _seen = {}; }
}
function saveSeen(): void {
  if (!hasWindow()) return;
  try { localStorage.setItem(KEY_SEEN, JSON.stringify(_seen)); } catch { /* 忽略 */ }
}

async function showIntent(intent: NotifyIntent): Promise<void> {
  const opts: NotificationOptions & { renotify?: boolean } = {
    body: intent.body,
    tag: intent.tag,
    requireInteraction: intent.requireInteraction,
    renotify: intent.renotify,
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      const icon = new URL('icons/icon-192.png', reg.scope.endsWith('/') ? reg.scope : reg.scope + '/').href;
      await reg.showNotification(intent.title, { ...opts, icon, data: { kind: intent.kind } });
      return;
    }
  } catch { /* 無 SW（開發模式）→ 往下 fallback */ }
  // fallback：桌機可用；Android 會 throw，靜默略過
  try { new Notification(intent.title, opts); } catch { /* 忽略 */ }
}

/** 單則通知的完整流程：決策 → 顯示 → 記錄。回傳是否真的發出。 */
export async function emitIntent(intent: NotifyIntent, hidden: boolean): Promise<boolean> {
  loadSeen();
  const now = Date.now();
  const isTurn = intent.kind === 'turn';
  const roomKey = isTurn ? intent.tag : '';
  const d = decideNotify({
    enabled: getNotifyEnabled(),
    permission: getPermission(),
    hidden,
    key: intent.key,
    seen: _seen,
    now,
    lastShownAt: isTurn ? _turnLastShown.get(roomKey) : undefined,
    minIntervalMs: isTurn ? TURN_MIN_INTERVAL_MS : 0,
  });
  if (!d.show) return false;
  _seen[intent.key] = now;
  if (isTurn) _turnLastShown.set(roomKey, now);
  saveSeen();
  await showIntent(intent);
  return true;
}

/** 報到／可進場：由既有輪詢與 1 秒 tick 呼叫（掃描條件成立者逐一決策）。 */
export function notifyScan(events: AlertEventLite[] | null | undefined, myMatch: AlertMatchLite | null | undefined, now: number): void {
  if (!supported() || !getNotifyEnabled()) return;
  const hidden = typeof document !== 'undefined' && document.hidden === true;
  if (!hidden) return;   // 前景不干擾，省掉後續運算
  for (const intent of scanTournamentAlerts(events, myMatch, now)) void emitIntent(intent, hidden);
}

/** 換你行動：由對戰頁「回合換手」單一收斂點呼叫。 */
export function notifyTurn(payload: { roomId: string; turn: number; apIdx: number; eventName?: string }): void {
  if (!supported() || !getNotifyEnabled()) return;
  const hidden = typeof document !== 'undefined' && document.hidden === true;
  if (!hidden) return;
  void emitIntent(buildTurnIntent(payload), hidden);
}

/** 設定頁「發送測試通知」：略過背景判斷（玩家正在看設定頁，必須看得到結果）。 */
export async function sendTestNotification(): Promise<boolean> {
  if (!supported() || getPermission() !== 'granted') return false;
  await showIntent({
    kind: 'checkin', key: 'test', tag: 'ptcg-t-test',
    title: '🔔 通知測試',
    body: '通知已正常運作。賽事報到、可進場、輪到你行動時就會像這樣提醒你。',
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// v6.023 階段2 Web Push：訂閱管理
//   分頁關閉／iOS 被凍結時，改由伺服器推播（只推「報到開始」「可進場」兩個低頻事件；
//   「換你行動」維持本地通知不推，避免對戰熱路徑壓垮主機）。
//   ⚠訂閱與取消都要 best-effort：失敗只影響「關掉分頁後收不到」，絕不能擋住本地通知或對戰。
// ─────────────────────────────────────────────────────────────────────────────

/** base64url VAPID 公鑰 → Uint8Array（PushManager.subscribe 要求）。 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * 向瀏覽器訂閱推播並把訂閱資料送到伺服器。
 * @param api 呼叫錦標賽 API 的函式（沿用對戰頁既有 tApi，含 Firebase 身分驗證）
 */
export async function subscribePush(api: (path: string, body?: unknown) => Promise<unknown>): Promise<boolean> {
  if (!hasWindow() || getPermission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg || !reg.pushManager) return false;
    const info = await api('/push/pubkey') as { enabled?: boolean; publicKey?: string | null };
    if (!info?.enabled || !info.publicKey) return false;   // 伺服器未啟用推播 → 靜默略過
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey),
      });
    }
    await api('/push/subscribe', { subscription: sub.toJSON() });
    return true;
  } catch { return false; }   // 不支援/被拒/網路失敗 → 只失去「關分頁也收得到」，本地通知不受影響
}

/** 取消推播訂閱（玩家在設定關閉通知時呼叫）。 */
export async function unsubscribePush(api: (path: string, body?: unknown) => Promise<unknown>): Promise<void> {
  if (!hasWindow()) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const sub = await reg?.pushManager?.getSubscription?.();
    if (sub) {
      try { await api('/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* 伺服器端清不掉也無妨，推播失效會自動清 */ }
      await sub.unsubscribe();
    }
  } catch { /* 忽略 */ }
}

/**
 * 掛 Service Worker 訊息監聽：使用者點擊通知後 SW 會 postMessage 過來，由前端用 SPA 導頁
 * （不整頁 reload，避免重載整個 app 資源）。
 */
export function initNotifyNav(onNavigate: (url: string) => void): void {
  if (!hasWindow() || !navigator.serviceWorker) return;
  loadSeen();
  try {
    navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data as { type?: string; url?: string } | null;
      if (d && d.type === 'ptcg-notify-nav' && d.url) onNavigate(d.url);
    });
  } catch { /* 忽略 */ }
}
