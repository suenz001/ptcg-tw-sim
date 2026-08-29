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

export interface DeckStats {
  /** 哨兵。伺服器 v6.266 起恆為 1。 */
  deckStatsApi: number;
  deckId: string;
  /** `scope: 'online-only'` —— 站長裁定：vsAI 與本機雙人一律不計入。 */
  casual: DeckStatsTally & { scope: string };
  vsArchetype: DeckStatsArchetypeRow[];
  /** 本版 `status: 'not-collected'`（還沒有資料來源）⇒ UI 顯示「累積中」。 */
  tournament: DeckStatsTally & { status: string };
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
  return {
    deckStatsApi: toInt(body.deckStatsApi),
    deckId: toStr(body.deckId, ''),
    casual: {
      scope: toStr(c.scope, 'online-only'),
      games: toInt(c.games), wins: toInt(c.wins), losses: toInt(c.losses), draws: toInt(c.draws),
      winRate: toRate(c.winRate),
    },
    vsArchetype: rows.map((r) => ({
      name: toStr(r.name, '未分類'),
      games: toInt(r.games), wins: toInt(r.wins), losses: toInt(r.losses), draws: toInt(r.draws),
      winRate: toRate(r.winRate),
    })),
    tournament: {
      status: toStr(t.status, 'not-collected'),
      games: toInt(t.games), wins: toInt(t.wins), losses: toInt(t.losses), draws: toInt(t.draws),
      winRate: toRate(t.winRate),
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
