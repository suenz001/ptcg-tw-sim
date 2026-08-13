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
  /** ⭐v6.185 靜默送出（不出聲/不震動）——連鎖需求只更新內容，不再打擾一次。 */
  silent?: boolean;
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
/**
 * ⭐v6.185 對戰內通知的「爆量上限」：同一房間 60 秒內最多出聲 6 次，超過只做靜默更新。
 *
 * ⚠ 為什麼**不是**沿用 TURN_MIN_INTERVAL_MS 的 30 秒最小間隔：
 *   30 秒間隔會把一個**完全正當**的情境變成無聲 —— 「我補位完成 → 對手還有動作 →
 *   十幾秒後他結束回合、輪到我」。那兩則是兩個真正分開的需求，第二則本來就該響。
 *   時間間隔分不出「連鎖」與「兩件事」，能分出來的是機制（見 decideActNotify 規則③：
 *   中間有沒有經過一次「我不需要操作」）。所以節流不做「最小間隔」，只做「爆量上限」。
 *
 * ⚠ 6 這個數字的推導（不是拍腦袋）：
 *   一個玩家回合內「我需要操作」的需求最多三段 —— 取獎賞卡、補位、對手效果要我做選擇；
 *   這是 PTCG 規則的結構上界（一回合最多攻擊一次，KO 與伴隨效果都掛在那一次上）。
 *   而本專案實測的回合節奏最快約 30 秒／回合（見下方 TURN_MIN_INTERVAL_MS 的註解，
 *   那是 v6.022 依實際賽事觀察寫下的）⇒ 一分鐘最多兩個回合段 ⇒ 3 × 2 = 6。
 *   換句話說：**合法對局產不出第 7 次**。超過 6 就代表是異常迴圈，降級成靜默是安全的。
 * ⚠ 而且降級只影響「響不響」，通知**照樣送出**（同 tag 更新內容）——
 *   「該通知卻被吃掉」會讓玩家超時判負，比多響一次嚴重得多。
 */
export const ACT_RING_BURST_MAX = 6;
export const ACT_RING_BURST_WINDOW_MS = 60_000;
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

// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐⭐ v6.185 對戰中「輪到我需要操作」通知 —— 單一述詞，不是每個情境各加一個通知點
//
// 【為什麼要重寫】v6.022 的換手通知掛在對戰頁一個 **edge-trigger** 上：
//   `_prevTurnPlayerIdx !== game.activePlayerIndex` 才呼叫。可是「戰鬥寶可夢被昏厥、
//   要放上新的戰鬥寶可夢（SEND_NEW_ACTIVE）」這件事**根本不會改變 activePlayerIndex**
//   ⇒ edge 永遠不 fire ⇒ 玩家回報的「補位不跳通知」。同理，對手回合中因為**對手的**
//   卡片效果要我做選擇（pendingSelection.actorIdx = 我）、開局階段輪到我、要我選取獎賞卡，
//   全都不會動 activePlayerIndex ⇒ 全部都沒有通知。
//   ⇒ 為每個情境各加一個通知點必然會漏也必然會重複。收斂成**一個述詞**：
//     「我從『不需要操作』變成『需要操作』時才通知」。
//
// 【誰該動作只能有一份判準】`actorSeat` 一律由呼叫端傳入對戰頁 `tCurrentActorSeat(game)`
//   的結果 —— 那份是**與伺服器 currentActorSeat 逐行同步**（閒置判負在用）的唯一判準。
//   本檔絕不自己再寫一份「誰該動作」，只負責把它翻成「要不要響、響什麼」。
//
// 【去重／冷卻的三條規則】（decideActNotify）
//   ① 需求消失 ⇒ 清掉「已響過」 —— 下一個需求就是**新的一串**，該響。
//   ② 同一個需求 key 重複觀察到 ⇒ skip（level 去重；輪詢每 1.2 秒一發不會轟炸）。
//   ③ **上一次觀察就已經需要操作** ⇒ 這是同一串連鎖（補位 → 補完馬上輪到我），
//      只做**靜默更新**（同 tag 覆蓋、不再響一次）。站長問的「補位後馬上輪到我會不會
//      再通知一次」就是被這條擋掉；而「補位後對手還有動作、之後才輪到我」中間必然
//      經過一次「我不需要操作」的觀察 ⇒ ① 已清掉旗標 ⇒ **照響**。
//
// 【⚠絕不 drop】最小間隔到期前不是「不發」而是「靜默發」。
//   「該通知卻被去重/冷卻吃掉」比重複通知嚴重得多（玩家會超時判負），所以節流只降級
//   「響不響」，永遠不減少「有沒有發」。
//
// 【⚠act 的 key 一律只存在記憶體，不進 localStorage seen】
//   seen 是跨重整持久化的，一旦兩個**不同**需求算出同一個 key 就會永久漏發。
//   act 的鏈式狀態只存記憶體：最壞情況是重整後多響一次 —— 而重整必然是前景，
//   前景本來就被 gate 擋住。失效方向永遠是「多響」，不會是「漏響」。
// ─────────────────────────────────────────────────────────────────────────────

/** 對戰中「需要我操作」的種類（只影響通知文案與 key 前綴，不影響要不要通知）。 */
export type ActNeedKind = 'select' | 'promote' | 'prize' | 'setup' | 'turn';

/** 算需求時真正會讀到的盤面欄位（其餘忽略）。刻意用寬鬆型別：舊盤面可能缺欄位。 */
export interface ActStateLite {
  phase?: string;
  turn?: number;
  activePlayerIndex?: number;
  pendingSelection?: { actorIdx?: number; token?: number } | null;
  pendingPrizes?: number[] | null;
  players?: Array<{ active?: unknown; bench?: unknown[] } | null | undefined> | null;
  setupDone?: boolean[] | null;
  pendingMulliganDraw?: number[] | null;
  mulliganRevealConfirmed?: boolean[] | null;
  mulliganPostBenchOpen?: boolean[] | null;
  openingChoicePending?: boolean[] | null;
}

export interface ActNeed {
  kind: ActNeedKind;
  /** 去重鍵：同一個需求持續存在時必須恆定，換成別的需求時必須不同。 */
  key: string;
  title: string;
  body: string;
}

/** 開局階段的「第幾小步」指紋：同一小步恆定、推進到下一小步就改變。 */
function setupStepKey(s: ActStateLite): string {
  const b = (a: unknown[] | null | undefined, i: number) => (a && a[i] ? 1 : 0);
  const n = (a: number[] | null | undefined, i: number) => Number((a && a[i]) || 0);
  // mulliganRevealConfirmed 預設是 true（沒有這個欄位＝不需要確認）
  const mrc = (i: number) => (s.mulliganRevealConfirmed ? (s.mulliganRevealConfirmed[i] ? 1 : 0) : 1);
  return [
    b(s.setupDone, 0), b(s.setupDone, 1),
    n(s.pendingMulliganDraw, 0), n(s.pendingMulliganDraw, 1),
    mrc(0), mrc(1),
    b(s.mulliganPostBenchOpen, 0), b(s.mulliganPostBenchOpen, 1),
    b(s.openingChoicePending, 0), b(s.openingChoicePending, 1),
  ].join('');
}

/**
 * 我現在需要做什麼操作？（沒有就回 null）
 *
 * @param actorSeat **必填**：對戰頁 `tCurrentActorSeat(game)` 的結果。
 *   0/1 = 該座位該動作；-1 = setup 期間雙方都可動作；null = 沒人該動作（game-over 等）。
 * ⚠ 本函式**不重算**「誰該動作」——只用 actorSeat 判「是不是我」，再依同一組優先序命名種類。
 *   命名若與 tCurrentActorSeat 的優先序不同步，最多是文案不精準，不會造成漏發或誤發。
 */
export function buildActNeed(
  s: ActStateLite | null | undefined,
  myIdx: 0 | 1,
  actorSeat: number | null | undefined,
  roomId: string,
): ActNeed | null {
  if (!s || !roomId) return null;
  if (s.phase === 'game-over') return null;
  const isSetup = s.phase === 'setup';
  const me0 = s.players && s.players[myIdx];
  // 我的戰鬥場是空的、而且備戰區還有寶可夢可以派 ⇒ 我一定得補位。
  const iMustPromote = s.phase === 'playing' && !!me0
    && (me0.active === null || me0.active === undefined)
    && ((me0.bench && me0.bench.length) || 0) > 0;
  // setup 的 -1 代表「雙方都可動作」（v0.74 伺服器 currentActorSeat 語義），我也算需要操作。
  //
  // ⚠ 為什麼要多一條 `iMustPromote`：tCurrentActorSeat 的語義是「閒置判負該判誰」，
  //   所以**只會回一個座位** —— 雙方同時昏厥（自傷 KO／反擊 KO／中毒檢查同時致死）時
  //   它固定先回 P1，P2 就永遠等不到通知。而「我的戰鬥場空著」是我自己無條件的義務，
  //   跟伺服器點名誰無關。這一條只會讓通知**早一點**發（若對手還有 pending 要處理），
  //   不會讓它漏 —— 而漏發（玩家超時判負）比早發嚴重得多。
  //   ⚠ 這**不是**第二份「誰該動作」判準：它不改變任何 gate/判負，只用來決定要不要通知。
  const mine = actorSeat === myIdx || (isSetup && actorSeat === -1) || iMustPromote;
  if (!mine) return null;
  if (isSetup) {
    return {
      kind: 'setup', key: `act|${roomId}|setup|${setupStepKey(s)}`,
      title: '🔔 開局輪到你操作',
      body: '對戰開局需要你放置寶可夢或確認重抽，請回到對戰畫面。',
    };
  }
  if (s.phase !== 'playing') return null;
  const ps = s.pendingSelection;
  if (ps && ps.actorIdx === myIdx) {
    return {
      kind: 'select', key: `act|${roomId}|sel|${typeof ps.token === 'number' ? ps.token : 'x'}`,
      title: '🔔 有一個選擇等你完成',
      body: '對戰中出現需要你做選擇的視窗，請回到對戰畫面。',
    };
  }
  if (Number((s.pendingPrizes && s.pendingPrizes[myIdx]) || 0) > 0) {
    return {
      kind: 'prize', key: `act|${roomId}|prz|${s.turn ?? 0}|${s.activePlayerIndex ?? 0}`,
      title: '🔔 請選取獎賞卡',
      body: '你打倒了對手的寶可夢，請回到對戰畫面選取獎賞卡。',
    };
  }
  if (iMustPromote) {
    return {
      kind: 'promote', key: `act|${roomId}|pro|${s.turn ?? 0}|${s.activePlayerIndex ?? 0}`,
      title: '🔔 請派出新的戰鬥寶可夢',
      body: '戰鬥寶可夢昏厥了，請回到對戰畫面從備戰區派出新的戰鬥寶可夢。',
    };
  }
  // ⚠ 戰鬥場空、備戰區也空 ⇒ 我沒有任何操作可做（引擎馬上會判負）。
  //   這種狀態下 tCurrentActorSeat 仍會點名我（它看的是 active===null），
  //   若不擋掉就會發一則「輪到你行動了」——純粹的打擾。
  if (me0 && (me0.active === null || me0.active === undefined)) return null;
  // 一般的「輪到我的回合」——key 沿用 v6.022 既有格式（同場同回合同行動方唯一）
  return {
    kind: 'turn', key: buildNotifyKey('turn', { roomId, turn: s.turn ?? 0, apIdx: myIdx }),
    title: '🔔 輪到你行動了',
    body: '請回到對戰畫面繼續對戰。',
  };
}

export interface ActDecideCtx {
  enabled: boolean;
  permission: 'granted' | 'denied' | 'default';
  /** document.hidden —— 前景一律不發（沿用 v6.022「不干擾」規則）。 */
  hidden: boolean;
  /** 本次觀察算出的需求；null = 現在不需要我操作。 */
  need: ActNeed | null;
  /** **上一次觀察**算出的需求 key；null = 上次不需要操作；undefined = 沒有上一次（剛進場／剛重整）。 */
  prevKey: string | null | undefined;
  /** 這一「串」需求已經響過的 key；null/undefined = 這一串還沒響過。 */
  rungKey: string | null | undefined;
  now: number;
  /** 同房間最近幾次「出聲」的時間戳（呼叫端維護，只留窗內的）。 */
  recentRingAts?: number[];
  /** 爆量窗長（毫秒）。 */
  burstWindowMs?: number;
  /** 窗內最多出聲幾次；超過就降級成靜默更新（⚠絕不 drop）。 */
  burstMax?: number;
}

export interface ActDecideResult {
  /** 'ring' 出聲｜'silent' 同 tag 靜默更新內容（不再響）｜'skip' 什麼都不做 */
  action: 'ring' | 'silent' | 'skip';
  reason: string;
  /** 呼叫端必須把「這一串已響過的 key」設成這個值（null = 清掉）。 */
  nextRungKey: string | null;
}

/** ⭐單一決策點：這一次觀察要不要通知、要不要出聲。 */
export function decideActNotify(ctx: ActDecideCtx): ActDecideResult {
  // ① 需求消失 ⇒ 清旗標。下一個需求就是新的一串（這條讓「補位後對手還有動作、之後才
  //    輪到我」仍然會響 —— 中間必然觀察到一次「不需要操作」）。
  if (!ctx.need) return { action: 'skip', reason: 'no-need', nextRungKey: null };
  const keep = ctx.rungKey ?? null;
  if (!ctx.enabled) return { action: 'skip', reason: 'disabled', nextRungKey: keep };
  if (ctx.permission !== 'granted') return { action: 'skip', reason: 'no-permission', nextRungKey: keep };
  if (!ctx.hidden) return { action: 'skip', reason: 'foreground', nextRungKey: keep };
  // ② 同一個需求被重複觀察到（輪詢每 1.2 秒一發）⇒ 不重複發
  if (keep && keep === ctx.need.key) return { action: 'skip', reason: 'same-need', nextRungKey: keep };
  // ③ 上一次觀察就已經需要操作 ⇒ 同一串連鎖（補位 → 馬上輪到我）⇒ 靜默更新，不再響
  if (keep && ctx.prevKey) return { action: 'silent', reason: 'chained', nextRungKey: ctx.need.key };
  // 從「不需要操作」變成「需要操作」⇒ 該響。只有**爆量**才降級成靜默，⚠絕不 drop。
  if (ctx.burstMax && ctx.burstWindowMs) {
    const n = (ctx.recentRingAts ?? []).filter((t) => ctx.now - t < (ctx.burstWindowMs as number)).length;
    if (n >= ctx.burstMax) return { action: 'silent', reason: 'burst-capped', nextRungKey: ctx.need.key };
  }
  return { action: 'ring', reason: 'ok', nextRungKey: ctx.need.key };
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
