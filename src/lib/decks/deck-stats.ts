/**
 * v6.267 套牌戰績（client 端）—— `/decks` 頁面「🔍」按鈕的**唯一**資料出口。
 *
 * ── 為什麼獨立成一個模組（而不是寫在 +page.svelte 裡）────────────────────────
 *   ① 快取／防連點／哨兵判定都是**跨牌組共用**的狀態，寫在元件裡會隨路由切換重置；
 *   ② 守衛可以用 esbuild 把這支 .ts 轉成 CJS **實跑**（行為端斷言），
 *      不必去解析 18,000 行的 Svelte 模板（那只能做字串比對＝安慰劑）。
 *
 * ── ⚠⚠ 效能紅線（站長最高優先）────────────────────────────────────────────
 *   `/decks` 頁面**載入時不可以多打任何一發請求**。所以：
 *     - `deckStatsHidden()` 是**純函式**（只讀 env 與模組變數），一定不發請求；
 *     - 只有玩家**點下放大鏡**才會呼叫 `fetchDeckStats()`；
 *     - 同一副牌 60 秒內重複點 ⇒ 走 client 快取（與伺服器 TTL 同值），一發都不發；
 *     - 同一副牌同時有一發在飛 ⇒ 共用那一發（防連點），絕不會併發打伺服器。
 *
 * ── ⭐⭐ 哨兵 fail-open ────────────────────────────────────────────────────
 *   伺服器 v6.266 的 `/api/deck-stats` 回應帶 `deckStatsApi: 1`。
 *   `typeof body.deckStatsApi === 'number'` **才**算「這台伺服器支援」；
 *   缺席（舊伺服器 404／端點自我停用回 503）⇒ 記住 `apiSupported = false`，
 *   之後整個放大鏡藏起來、**而且不會再發第二發**。
 *   ⚠ 但**不可以**把下面兩種情況也判成「不支援」（那會把功能誤殺）：
 *     - **429 限流**：伺服器明明支援，只是這一刻太頻繁 ⇒ 只顯示訊息，不藏。
 *     - **網路錯誤**（玩家自己斷線）：那是玩家端的事 ⇒ 只顯示訊息，不藏。
 *
 * ⚠ 這個 build 沒有 Oracle API（`VITE_ORACLE_API_URL` 為空＝GitHub Pages 測試站）時
 *   一律當「不支援」⇒ 放大鏡完全不出現、零請求，`/decks` 與 v6.266 逐像素相同。
 */

/** 對某一個牌組原型的戰績（伺服器 `vsArchetype[]` 的一列）。 */
export interface DeckStatsArchetypeRow {
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** 勝率＝勝 /（勝＋敗）；分母為 0 時伺服器回 null（**不是** 0）。 */
  winRate: number | null;
}

export interface DeckStatsTally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
}

/**
 * ⭐v6.277 錦標賽戰績（伺服器 v6.276 起才有真數字）。
 *
 * ⚠⚠ `since` 是「這台伺服器收得到錦標賽資料了嗎」的**唯一**判準，而且它的值
 *   **只從伺服器回應讀出來**（伺服器目前回 `'v6.276'`）—— client 端**絕不寫死版本號**
 *   （第九種守衛安慰劑：pin 死版本號在那一版被取代的當下就靜默失效）。
 *   舊伺服器（v6.275 以下）的 `tournament` 沒有這個欄位 ⇒ 正規化成空字串
 *   ⇒ `deckStatsTournamentReady()` 回 false ⇒ UI **fail-open 退回「累積中」**。
 */
export interface DeckStatsTournament extends DeckStatsTally {
  /** `'ok'` ＝有真數字；`'not-collected'` ＝查無（含索引未就緒、上線前的賽事）。 */
  status: string;
  /** 統計起算版本（伺服器給的字串）。⚠ 舊伺服器沒有這個欄位 ⇒ 空字串。 */
  since: string;
  /** 對各牌組原型的勝率（錦標賽側）。舊伺服器沒有 ⇒ 空陣列。 */
  vsArchetype: DeckStatsArchetypeRow[];
  /** 掃了幾場賽事（歸檔筆數）。 */
  events: number;
  /** 掃過幾個元素（伺服器的儀器欄位）。 */
  scanned: number;
  /** 超過 `scanCap` 場賽事就會截斷 ⇒ UI 必須告訴玩家「只統計最近 N 場」。 */
  truncated: boolean;
  scanCap: number;
}

export interface DeckStats {
  /** 哨兵。伺服器 v6.266 起恆為 1。 */
  deckStatsApi: number;
  deckId: string;
  /** `scope: 'online-only'` —— 站長裁定：vsAI 與本機雙人一律不計入。 */
  casual: DeckStatsTally & { scope: string };
  vsArchetype: DeckStatsArchetypeRow[];
  /**
   * 錦標賽戰績。⭐v6.276 伺服器起有真數字；查無 ⇒ `status:'not-collected'`（UI 顯示「累積中」）。
   * ⚠ 舊伺服器沒有 `since`／`vsArchetype` 等欄位 ⇒ 正規化補預設值並 fail-open 退回「累積中」。
   */
  tournament: DeckStatsTournament;
  /** `'v6.266'` —— 不做歷史回填，UI 必須明講「自這一版起計」。 */
  since: string;
  scanned: number;
  truncated: boolean;
  scanCap: number;
}

export type DeckStatsResult =
  | { ok: true; data: DeckStats; fromCache: boolean }
  | { ok: false; unsupported: boolean; message: string };

/** client 端快取存活時間。**刻意與伺服器的 60s TTL 同值**：再短只是白打一發。 */
export const DECK_STATS_CACHE_TTL_MS = 60000;

export const DECK_STATS_UNSUPPORTED_MSG =
  '這個網站版本的伺服器還沒有提供套牌戰績，暫時無法查詢。';
export const DECK_STATS_NETWORK_MSG = '連線失敗，請稍後再試一次。';
export const DECK_STATS_BUSY_MSG = '查詢過於頻繁，請稍候再試一次。';

// ── 模組層級狀態（跨元件、跨路由切換保留；整頁重新載入才重置）────────────────
//   ⚠ 刻意**不用** localStorage：伺服器修好之後玩家不必清快取才看得到。
let apiSupported: boolean | null = null;             // null＝還沒問過
const statsCache = new Map<string, { at: number; data: DeckStats }>();
const inflight = new Map<string, Promise<DeckStatsResult>>();

function apiBase(): string {
  return (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
}

/**
 * 放大鏡要不要整個藏起來。
 * ⚠⚠ **純函式，不發任何請求** —— 這就是「載入 /decks 不多打一發」的關鍵：
 *   頁面第一次算它的時候 `apiSupported` 還是 null，回 false ⇒ 按鈕先顯示；
 *   真的點下去打不通，才把 `apiSupported` 設成 false 並藏起來。
 */
export function deckStatsHidden(): boolean {
  if (!apiBase()) return true;      // 沒有 Oracle API 的 build（測試站）⇒ 一律不顯示
  return apiSupported === false;
}

/**
 * ⭐⭐ 錦標賽欄要不要顯示**真數字** —— 三態的唯一判準（UI 與守衛共用同一個出口）。
 *
 *   ①「有資料」：`status:'ok'` ＋ `since` 有值 ＋ `games > 0` ⇒ `true`
 *      ⇒ 顯示勝率／場次／對各牌組原型。
 *   ②「查無」：`status:'not-collected'`（含上線前的賽事、伺服器索引未就緒）⇒ `false`
 *      ⇒ 顯示「累積中」。
 *   ③「舊伺服器」：`tournament` 缺席、或有 `tournament` 但**沒有 `since`** ⇒ `false`
 *      ＝ **fail-open 退回「累積中」**：畫面絕不可以壞掉，也絕不顯示 0 勝 0 敗騙玩家。
 *
 * ⚠⚠ 判準只讀**伺服器回應本身**，不比對任何寫死的版本號字串。
 */
export function deckStatsTournamentReady(t: DeckStatsTournament | null | undefined): boolean {
  if (!t) return false;
  if (t.status !== 'ok') return false;
  if (!t.since) return false;          // 舊伺服器（欄位缺席）⇒ fail-open 退回「累積中」
  return t.games > 0;
}

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function toRate(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback;
}

/**
 * 把伺服器回應正規化成 `DeckStats`。
 * ⚠ 伺服器少給欄位時**補預設值**而不是丟例外 —— 前端不可以因為一個欄位沒有就整頁壞掉。
 */
function normalize(body: Record<string, unknown>): DeckStats {
  const c = (body.casual ?? {}) as Record<string, unknown>;
  const t = (body.tournament ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(body.vsArchetype) ? (body.vsArchetype as Record<string, unknown>[]) : [];
  // ⭐v6.277 錦標賽側的對各原型列。⚠ 舊伺服器沒有這個欄位 ⇒ 空陣列（不是丟例外）。
  const tRows = Array.isArray(t.vsArchetype) ? (t.vsArchetype as Record<string, unknown>[]) : [];
  // ⚠ 刻意**不寫回傳型別註記**：v6.276 守衛 G1 的 TS 剝除器只認 `: Record<string, unknown>`，
  //   多一種註記形狀會讓那支守衛直接 SyntaxError（Rule 25：抽取器不得假設只有一種寫法）。
  const archRow = (r: Record<string, unknown>) => ({
    name: toStr(r.name, '未分類'),
    games: toInt(r.games), wins: toInt(r.wins), losses: toInt(r.losses), draws: toInt(r.draws),
    winRate: toRate(r.winRate),
  });
  return {
    deckStatsApi: toInt(body.deckStatsApi),
    deckId: toStr(body.deckId, ''),
    casual: {
      scope: toStr(c.scope, 'online-only'),
      games: toInt(c.games), wins: toInt(c.wins), losses: toInt(c.losses), draws: toInt(c.draws),
      winRate: toRate(c.winRate),
    },
    vsArchetype: rows.map(archRow),
    tournament: {
      status: toStr(t.status, 'not-collected'),
      games: toInt(t.games), wins: toInt(t.wins), losses: toInt(t.losses), draws: toInt(t.draws),
      winRate: toRate(t.winRate),
      // ⚠⚠ **絕不寫死版本號**：缺席就是空字串（＝舊伺服器 ⇒ fail-open 退回「累積中」）。
      since: toStr(t.since, ''),
      vsArchetype: tRows.map(archRow),
      events: toInt(t.events), scanned: toInt(t.scanned),
      truncated: t.truncated === true, scanCap: toInt(t.scanCap),
    },
    since: toStr(body.since, 'v6.266'),
    scanned: toInt(body.scanned),
    truncated: body.truncated === true,
    scanCap: toInt(body.scanCap),
  };
}

async function requestOnce(deckId: string, fetchImpl: typeof fetch): Promise<DeckStatsResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase()}/api/deck-stats?deckId=${encodeURIComponent(deckId)}`, { method: 'GET' });
  } catch {
    // ⚠ 網路錯誤**不算**「伺服器不支援」：藏掉放大鏡在本次載入是不可逆的，
    //   不可以拿玩家自己的一次斷線當判準。
    return { ok: false, unsupported: false, message: DECK_STATS_NETWORK_MSG };
  }
  // ⚠ 429 是「太頻繁」不是「不支援」（伺服器 per-IP 30/min）⇒ 絕不可以據此藏起來。
  if (res.status === 429) return { ok: false, unsupported: false, message: DECK_STATS_BUSY_MSG };
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  const b = (body && typeof body === 'object') ? (body as Record<string, unknown>) : null;
  // ⭐⭐ 哨兵是**唯一**判準（不看 res.ok、不看狀態碼）。
  if (!b || typeof b.deckStatsApi !== 'number') {
    apiSupported = false;
    return { ok: false, unsupported: true, message: DECK_STATS_UNSUPPORTED_MSG };
  }
  apiSupported = true;
  const data = normalize(b);
  statsCache.set(deckId, { at: Date.now(), data });
  return { ok: true, data, fromCache: false };
}

/**
 * 取某一副牌的戰績。**只有玩家點下放大鏡時才可以呼叫。**
 * @param fetchImpl 測試用注入點；正式路徑一律用全域 fetch。
 */
export function fetchDeckStats(deckId: string, fetchImpl?: typeof fetch): Promise<DeckStatsResult> {
  // ⚠⚠ 已經確定不支援就**連一發都不再打**（UI 若因為任何原因還留著按鈕，這裡是最後一道）。
  if (deckStatsHidden()) {
    return Promise.resolve({ ok: false, unsupported: true, message: DECK_STATS_UNSUPPORTED_MSG });
  }
  const hit = statsCache.get(deckId);
  if (hit && Date.now() - hit.at < DECK_STATS_CACHE_TTL_MS) {
    return Promise.resolve({ ok: true, data: hit.data, fromCache: true });
  }
  // 防連點：同一副牌同時只會有一發在飛，後續點擊共用同一個 promise。
  const busy = inflight.get(deckId);
  if (busy) return busy;
  const p = requestOnce(deckId, fetchImpl ?? fetch).finally(() => { inflight.delete(deckId); });
  inflight.set(deckId, p);
  return p;
}

/** ⚠ 只給守衛用：把模組層級狀態清乾淨，讓每一條斷言互不污染。 */
export function __resetDeckStatsForTest(): void {
  apiSupported = null;
  statsCache.clear();
  inflight.clear();
}
