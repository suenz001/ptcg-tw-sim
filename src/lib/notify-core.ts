/**
 * v6.022 錦標賽通知 — 純函式決策核心。
 *
 * ⚠本檔零 DOM / 零瀏覽器 global（比照 sw-policy.ts 先例），可在 node 測試環境直接載入單元測試。
 *   所有「要不要發通知、發什麼」的判斷都在這裡；瀏覽器 API 呼叫在 notify.ts。
 *
 * 設計要點：
 *   ①「不干擾」規則：三種通知一律**只在分頁背景時發**（document.hidden）。玩家正看著畫面時
 *      畫面上本來就有倒數／進場鈕／回合橫幅，通知只是重複干擾（Wilson 明確要求）。
 *   ② 去重用「目前狀態 + seen 表」而非「舊值→新值 edge」：F5 後 seen 從 localStorage 還原不重發、
 *      分頁開著錯過輪詢間隔也不漏發、不需維護 prev snapshot。
 *   ③「換你行動」額外節流：同場同回合只發一次（key 帶 turn/activePlayer）＋同房間最小間隔，
 *      避免玩家頻繁切分頁或 watchdog 重放時連環轟炸。
 */

export type NotifyKind = 'checkin' | 'enter' | 'turn';

/** 一則「條件已成立、應該考慮發送」的通知意圖（是否真的發由 decideNotify 決定）。 */
export interface NotifyIntent {
  kind: NotifyKind;
  /** 去重鍵（同鍵只發一次）。 */
  key: string;
  title: string;
  body: string;
  /** 同 tag 的通知在系統上互相覆蓋而非疊加。 */
  tag: string;
  /** 重要通知常駐到使用者點擊（可進場用）。 */
  requireInteraction?: boolean;
  /** 覆蓋既有同 tag 通知時重新提示（Android 有效）。 */
  renotify?: boolean;
}

export interface DecideCtx {
  /** 玩家偏好開關（設定頁）。 */
  enabled: boolean;
  /** Notification.permission。 */
  permission: 'granted' | 'denied' | 'default';
  /** document.hidden — 只有背景才發。 */
  hidden: boolean;
  key: string;
  /** 已發送記錄 key→timestamp。 */
  seen: Record<string, number>;
  now: number;
  /** 同群組（如同房間）上次發送時間；用於最小間隔節流。undefined = 沒發過。 */
  lastShownAt?: number;
  /** 最小間隔（毫秒）；0/undefined = 不節流。 */
  minIntervalMs?: number;
}

export interface DecideResult {
  show: boolean;
  /** 供測試與除錯：不發的原因。 */
  reason: string;
}

/** 「換你行動」同房間最小發送間隔（毫秒）。錦標賽回合節奏約 30 秒～數分鐘。 */
export const TURN_MIN_INTERVAL_MS = 30_000;
/** seen 表保留天數：報到/進場（一場賽事生命週期）。 */
export const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 單一決策點：這則通知現在該不該發。
 * gate 順序：偏好 → 權限 → 背景 → 去重 → 節流。
 */
export function decideNotify(ctx: DecideCtx): DecideResult {
  if (!ctx.enabled) return { show: false, reason: 'disabled' };
  if (ctx.permission !== 'granted') return { show: false, reason: 'no-permission' };
  // ⭐「不干擾」：玩家正看著畫面（前景）一律不發
  if (!ctx.hidden) return { show: false, reason: 'foreground' };
  if (ctx.seen[ctx.key] != null) return { show: false, reason: 'already-sent' };
  if (ctx.minIntervalMs && ctx.lastShownAt != null && ctx.now - ctx.lastShownAt < ctx.minIntervalMs) {
    return { show: false, reason: 'throttled' };
  }
  return { show: true, reason: 'ok' };
}

/** 去重鍵。同一事件在不同輪詢/重連下必須算出相同的鍵。 */
export function buildNotifyKey(kind: NotifyKind, payload: Record<string, unknown>): string {
  if (kind === 'checkin') return `checkin|${String(payload.eventId ?? '')}`;
  if (kind === 'enter') return `enter|${String(payload.matchId ?? '')}`;
  // turn：同場同回合同行動方只發一次（force-resync / 重連重放不重發）
  return `turn|${String(payload.roomId ?? '')}|${String(payload.turn ?? '')}|${String(payload.apIdx ?? '')}`;
}

/** 錦標賽 /event 回應中我們需要的欄位（其餘忽略）。 */
export interface AlertEventLite {
  _id?: string; name?: string; status?: string;
  registered?: boolean; checkedIn?: boolean; checkInDeadline?: number | null;
}
export interface AlertMatchLite {
  matchId?: string; eventId?: string; round?: number;
  oppName?: string | null; enterOpenAt?: number | null; entered?: boolean; roomId?: string | null;
}

/**
 * 掃描賽事狀態，算出「條件已成立」的通知意圖（不含去重/權限判斷，那些在 decideNotify）。
 *   ①報到：賽事在報到階段、我已報名但還沒報到、且未過截止。
 *   ②進場：我有對戰、還沒進場、且進場時間已到（不是配對當下就發——每輪有休息倒數）。
 */
export function scanTournamentAlerts(
  events: AlertEventLite[] | null | undefined,
  myMatch: AlertMatchLite | null | undefined,
  now: number,
): NotifyIntent[] {
  const out: NotifyIntent[] = [];
  for (const ev of events ?? []) {
    if (!ev || !ev._id) continue;
    if (ev.status !== 'checkin') continue;
    if (!ev.registered || ev.checkedIn) continue;
    if (!((ev.checkInDeadline ?? 0) > now)) continue;
    const nm = ev.name || '錦標賽';
    out.push({
      kind: 'checkin',
      key: buildNotifyKey('checkin', { eventId: ev._id }),
      title: `🏆 ${nm} 開放報到`,
      body: '請在時限內完成報到，逾時將無法參賽。',
      tag: `ptcg-t-checkin-${ev._id}`,
    });
  }
  if (myMatch && myMatch.matchId && !myMatch.entered) {
    const openAt = myMatch.enterOpenAt;
    if (openAt != null && openAt <= now) {
      const rd = myMatch.round != null ? `第 ${myMatch.round} 輪` : '本輪';
      const opp = myMatch.oppName ? `｜對手：${myMatch.oppName}` : '';
      out.push({
        kind: 'enter',
        key: buildNotifyKey('enter', { matchId: myMatch.matchId }),
        title: `⚔️ ${rd}可進場${opp}`,
        body: '點此進入對戰。未在時限內進場將被判負。',
        tag: `ptcg-t-enter-${myMatch.matchId}`,
        requireInteraction: true,
      });
    }
  }
  return out;
}

/** 「換你行動」意圖。 */
export function buildTurnIntent(payload: { roomId: string; turn: number; apIdx: number; eventName?: string }): NotifyIntent {
  return {
    kind: 'turn',
    key: buildNotifyKey('turn', payload),
    title: '🔔 輪到你行動了',
    body: payload.eventName ? `${payload.eventName}｜請回到對戰畫面` : '請回到對戰畫面繼續對戰。',
    tag: `ptcg-t-turn-${payload.roomId}`,
    renotify: true,
  };
}

/** 修剪過期的 seen 記錄（避免 localStorage 無限長大）。 */
export function pruneSeen(seen: Record<string, number>, now: number, ttlMs: number = SEEN_TTL_MS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, ts] of Object.entries(seen ?? {})) {
    if (typeof ts === 'number' && now - ts < ttlMs) out[k] = ts;
  }
  return out;
}

/**
 * 通知點擊後要導向的頁面。
 * ⚠必須以 Service Worker 的 registration.scope 為基底：測試站 base path 是 /ptcg-tw-sim/、
 *   正式站是 /（custom domain），硬寫路徑會在其中一站導錯。
 */
export function resolveClickUrl(scope: string): string {
  try {
    return new URL('tournament', scope.endsWith('/') ? scope : scope + '/').href;
  } catch {
    return scope;
  }
}
