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
/** v6.026：Web Push 訂閱「有沒有成功登記到伺服器」的最後結果（診斷用；瀏覽器端訂閱成功≠伺服器收到）。 */
const KEY_PUSH_SERVER = 'ptcg.notify.pushServer';
// v0.98 社群賽開辦通知的偏好。⚠localStorage 只是 UI 快取 ——
//   推播是**伺服器主動發**的，真正決定收不收的是伺服器上訂閱文件的 notifyCommunity 欄位。
const KEY_COMMUNITY = 'ptcg.notify.community';

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
/** 是否接收「有人發起社群賽」的通知。預設 true（與伺服器端「欄位缺席視為開啟」一致）。 */
export function getNotifyCommunity(): boolean {
  if (!hasWindow()) return true;
  try { return localStorage.getItem(KEY_COMMUNITY) !== '0'; } catch { return true; }
}
/**
 * 存社群賽通知偏好：**同時寫 localStorage（UI 用）與伺服器（推播實際依據）**。
 * 只寫本機是沒有用的 —— 伺服器不會知道你關掉了，照樣推給你。
 */
export async function saveNotifyCommunity(on: boolean, api?: (path: string, body?: unknown) => Promise<unknown>): Promise<void> {
  if (hasWindow()) { try { localStorage.setItem(KEY_COMMUNITY, on ? '1' : '0'); } catch { /* 忽略 */ } }
  if (!api) return;
  try { await api('/push/prefs', { notifyCommunity: on }); }
  catch (e) { console.warn('[notify] 社群賽通知偏好送伺服器失敗（本機已記錄，下次進頁會補送）', e); }
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

/**
 * 取得**有 active worker** 的 Service Worker registration。
 *
 * ⚠為什麼需要這個（真實事故，Windows 桌機回報）：
 *   `navigator.serviceWorker.getRegistration()` 只要註冊記錄存在就會回傳物件，
 *   但那個 registration 可能還停在 installing / waiting、**`.active` 是 null**。
 *   此時呼叫 `reg.showNotification()` 會直接拋：
 *     "Failed to execute 'showNotification' on 'ServiceWorkerRegistration':
 *      No active registration available on the ServiceWorkerRegistration."
 *   最容易踩到的時機：①首次載入本站（SW 還在安裝）②剛清過快取／反註冊後重新註冊
 *   ③版本更新後新 SW 尚未接手。
 *
 * 解法：`navigator.serviceWorker.ready` 會等到「有 active worker」才 resolve。
 * ⚠但它在**從未註冊過 SW** 的環境（開發模式、SW 註冊失敗）會**永遠 pending**，
 *   所以一定要加逾時，否則整個通知流程會卡死。
 *
 * @returns 有 active worker 的 registration；取不到則 null（呼叫端應退回頁面層通知）
 */
async function getActiveRegistration(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (!hasWindow() || !('serviceWorker' in navigator)) return null;
  try {
    // 快路徑：已經 active 就不必等
    const cur = await navigator.serviceWorker.getRegistration();
    if (cur?.active) return cur;
    // 慢路徑：等它 activate（附逾時，避免從未註冊時永久 pending）
    const ready = navigator.serviceWorker.ready;
    const timed = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const reg = await Promise.race([ready, timed]);
    return reg?.active ? reg : null;
  } catch {
    return null;
  }
}

async function showIntent(intent: NotifyIntent): Promise<void> {
  const opts: NotificationOptions & { renotify?: boolean } = {
    body: intent.body,
    tag: intent.tag,
    requireInteraction: intent.requireInteraction,
    renotify: intent.renotify,
  };
  try {
    const reg = await getActiveRegistration();   // v6.033：必須有 active worker，否則 showNotification 會拋
    if (reg) {
      const icon = new URL('icons/icon-192.png', reg.scope.endsWith('/') ? reg.scope : reg.scope + '/').href;
      await reg.showNotification(intent.title, { ...opts, icon, data: { kind: intent.kind } });
      return;
    }
  } catch { /* 無 SW（開發模式）或 SW 發送失敗 → 往下 fallback */ }
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

/**
 * 設定頁「發送測試通知」：略過背景判斷（玩家正在看設定頁，必須看得到結果）。
 * v6.024：回傳詳細結果供 UI 顯示——原本無論成功失敗都靜默，玩家按了沒反應完全無從判斷。
 *   ⚠特別是 Windows：系統層級關閉通知或開啟「勿擾/專注輔助」時，瀏覽器**認為自己發送成功**、
 *   不會 throw，但畫面上什麼都沒有。所以「送出成功」也要提示玩家去檢查系統設定。
 */
export async function sendTestNotification(): Promise<{ ok: boolean; via: string; hint: string }> {
  if (!supported()) {
    return { ok: false, via: 'unsupported', hint: isIOSNeedsInstall()
      ? '此裝置需先「加入主畫面」並從主畫面開啟本站才支援通知。'
      : '這個瀏覽器不支援通知功能。' };
  }
  if (getPermission() !== 'granted') {
    return { ok: false, via: 'no-permission', hint: getPermission() === 'denied'
      ? '通知已被瀏覽器封鎖，請點網址列鎖頭圖示 → 通知 → 允許。'
      : '尚未取得通知權限，請先勾選上方的通知開關。' };
  }
  const intent: NotifyIntent = {
    kind: 'checkin', key: 'test', tag: 'ptcg-t-test',
    title: '🔔 通知測試',
    body: '通知已正常運作。賽事報到、可進場、輪到你行動時就會像這樣提醒你。',
  };
  // 先試 Service Worker（Android 必須；桌機也支援），失敗才退回頁面層 Notification
  // ⚠v6.033：這裡原本有兩個 bug —— ①沒確認 registration 有 active worker（會拋
  //   "No active registration available"）②catch 直接 return 失敗，**根本不會落到下面的
  //   頁面層 fallback**。Windows 桌機明明完全支援頁面層 new Notification()，卻因此
  //   在 SW 尚未 activate 時整個收不到通知。現在改成：SW 這條路不通就往下走，不提早 return。
  let swErr = '';
  try {
    const reg = await getActiveRegistration();
    if (reg) {
      const icon = new URL('icons/icon-192.png', reg.scope.endsWith('/') ? reg.scope : reg.scope + '/').href;
      await reg.showNotification(intent.title, { body: intent.body, tag: intent.tag, icon, data: { kind: 'test' } });
      return { ok: true, via: 'sw', hint: '已送出。若沒看到，請檢查 Windows 設定 → 系統 → 通知（總開關與 Edge／Chrome 皆需開啟），並關閉「勿讓我分心／專注輔助」；也可按 Win+N 查看通知中心。' };
    }
    swErr = '背景服務尚未啟用';
  } catch (e) {
    swErr = (e as Error)?.message ?? '未知錯誤';
  }
  try {
    new Notification(intent.title, { body: intent.body, tag: intent.tag });
    return { ok: true, via: 'page', hint: '已送出（改用一般通知，未經背景服務'
      + (swErr ? '：' + swErr : '') + '）。若沒看到，請檢查系統通知設定與勿擾模式；重新整理頁面後背景服務通常就會就緒。' };
  } catch (e) {
    return { ok: false, via: 'page-error', hint: '發送失敗：' + ((e as Error)?.message ?? '未知錯誤') };
  }
}

/** 設定頁診斷資訊：讓玩家（和維護者）一眼看出通知目前卡在哪一關，不必開開發者工具。 */
export async function getNotifyDiagnostics(): Promise<{
  supported: boolean; permission: string; enabled: boolean;
  swRegistered: boolean; pushSubscribed: boolean; iosNeedsInstall: boolean;
  serverRegistered: boolean; serverStage: string; serverDetail: string; pushHost: string;
}> {
  const out = {
    supported: supported(), permission: getPermission(), enabled: getNotifyEnabled(),
    swRegistered: false, pushSubscribed: false, iosNeedsInstall: isIOSNeedsInstall(),
    // v6.026：拆開「瀏覽器已訂閱」與「伺服器已登記」——兩者不同步正是報到推播收不到的真根因，
    //   舊版只顯示前者會出現假綠燈（本機看起來一切正常，伺服器其實一筆訂閱都沒有）。
    serverRegistered: false, serverStage: '', serverDetail: '', pushHost: '',
  };
  try {
    // v6.033：原本 `!!reg` 只要有註冊記錄就顯示 ✅ —— 但 registration 可能還沒 active，
    //   那個狀態下 showNotification 會直接拋錯。判 active 才是「真的能發通知」。
    const reg = await getActiveRegistration();
    out.swRegistered = !!reg?.active;
    if (reg?.pushManager) {
      const sub = await reg.pushManager.getSubscription();
      out.pushSubscribed = !!sub;
      if (sub) { try { out.pushHost = new URL(sub.endpoint).hostname; } catch { /* 忽略 */ } }
    }
  } catch { /* 保持 false */ }
  const ss = getPushServerState();
  if (ss) { out.serverRegistered = !!ss.ok; out.serverStage = ss.stage || ''; out.serverDetail = ss.detail || ''; }
  return out;
}

/** 各關卡的中文說明（診斷面板顯示，讓玩家自己看得懂卡在哪）。 */
export function describePushStage(stage: string): string {
  switch (stage) {
    case 'ok': return '已登記到伺服器';
    case 'no-permission': return '尚未取得通知權限';
    case 'no-sw': return '背景服務尚未就緒（請完全關閉再重開本 App）';
    case 'server-disabled': return '伺服器目前未啟用推播';
    case 'subscribe-failed': return '瀏覽器建立推播訂閱失敗';
    case 'server-reject': return '登記到伺服器被拒（多半是登入狀態尚未就緒）';
    case 'unsubscribed': return '已取消訂閱';
    case '': return '尚未嘗試登記';
    default: return stage;
  }
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
export type PushSubStage =
  | 'ok' | 'no-window' | 'no-permission' | 'no-sw' | 'server-disabled' | 'subscribe-failed' | 'server-reject';
export type PushSubResult = { ok: boolean; stage: PushSubStage; detail?: string; host?: string };

/** 寫入／讀取「伺服器登記結果」——診斷面板據此分辨假綠燈（瀏覽器有訂閱、伺服器沒收到）。 */
function savePushServerState(s: { ok: boolean; stage: string; detail?: string; host?: string }): void {
  if (!hasWindow()) return;
  try { localStorage.setItem(KEY_PUSH_SERVER, JSON.stringify({ ...s, ts: Date.now() })); } catch { /* 忽略 */ }
}
export function getPushServerState(): { ok: boolean; ts: number; stage: string; detail?: string; host?: string } | null {
  if (!hasWindow()) return null;
  try { const raw = localStorage.getItem(KEY_PUSH_SERVER); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** 比對既有訂閱綁的 VAPID 公鑰是否等於伺服器現行公鑰。 */
function sameApplicationServerKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const av = new Uint8Array(a);
  if (av.length !== b.length) return false;
  for (let i = 0; i < av.length; i++) if (av[i] !== b[i]) return false;
  return true;
}

export async function subscribePush(api: (path: string, body?: unknown) => Promise<unknown>): Promise<PushSubResult> {
  if (!hasWindow()) return { ok: false, stage: 'no-window' };
  if (getPermission() !== 'granted') return { ok: false, stage: 'no-permission' };
  // v6.026：逐段標記進度，失敗時記錄「卡在哪一關」。原本整段吞錯只回 false，
  //   最致命的情形（瀏覽器訂閱成功、但送伺服器那步 401 被吞）完全看不出來。
  let stage: PushSubStage = 'no-sw';
  try {
    const reg = await getActiveRegistration();   // v6.033 需有 active worker
    if (!reg || !reg.pushManager) { savePushServerState({ ok: false, stage: 'no-sw' }); return { ok: false, stage: 'no-sw' }; }
    stage = 'server-disabled';
    const info = await api('/push/pubkey') as { enabled?: boolean; publicKey?: string | null };
    if (!info?.enabled || !info.publicKey) { savePushServerState({ ok: false, stage: 'server-disabled' }); return { ok: false, stage: 'server-disabled' }; }
    const key = urlBase64ToUint8Array(info.publicKey);
    stage = 'subscribe-failed';
    let sub = await reg.pushManager.getSubscription();
    // v6.026：既有訂閱若綁的是**舊** VAPID 公鑰（伺服器重產過金鑰），推播會被推播服務以 403
    //   VapidPkHashMismatch 擋掉；而伺服器端只清 404/410，這種死訂閱會永久殘留、永遠靜默失敗。
    //   → 公鑰不符就先退訂再重訂，讓它自癒。
    if (sub && !sameApplicationServerKey((sub.options as { applicationServerKey?: ArrayBuffer } | undefined)?.applicationServerKey, key)) {
      try { await sub.unsubscribe(); } catch { /* 退訂失敗仍嘗試重訂 */ }
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    stage = 'server-reject';
    await api('/push/subscribe', { subscription: sub.toJSON() });
    let host = '';
    try { host = new URL(sub.endpoint).hostname; } catch { /* 忽略 */ }
    savePushServerState({ ok: true, stage: 'ok', host });
    // v0.98：訂閱成功後補送一次偏好——涵蓋「上次送伺服器失敗」與「換了新裝置」兩種情況，
    //   否則本機顯示已關、伺服器卻還是照推。
    try { await api('/push/prefs', { notifyCommunity: getNotifyCommunity() }); } catch { /* 非關鍵，下次再補 */ }
    return { ok: true, stage: 'ok', host };
  } catch (e) {
    const detail = String((e as Error)?.message ?? '').slice(0, 140);
    savePushServerState({ ok: false, stage, detail });
    return { ok: false, stage, detail };   // 只失去「關分頁也收得到」，本地通知與對戰不受影響
  }
}

/** 取消推播訂閱（玩家在設定關閉通知時呼叫）。 */
export async function unsubscribePush(api: (path: string, body?: unknown) => Promise<unknown>): Promise<void> {
  if (!hasWindow()) return;
  try {
    const reg = await getActiveRegistration();   // v6.033 需有 active worker
    const sub = await reg?.pushManager?.getSubscription?.();
    if (sub) {
      try { await api('/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* 伺服器端清不掉也無妨，推播失效會自動清 */ }
      await sub.unsubscribe();
    }
    savePushServerState({ ok: false, stage: 'unsubscribed' });
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
