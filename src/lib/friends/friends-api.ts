/**
 * v6.283 好友功能（client 端，P1a）—— `/friends` 頁面與線上大廳入口的**唯一**資料出口。
 *
 * ── 為什麼獨立成一個模組（完全比照 `$lib/decks/deck-stats.ts`）───────────────────
 *   ① 「伺服器支不支援」的判定與正向快取是**跨頁面共用**的狀態；
 *   ② 守衛可以用 esbuild 把這支 .ts 轉成 CJS **實跑**（行為端斷言：假 fetch 回七組回應，
 *      逐一斷言三態），不必去解析 18,000 行的 Svelte 模板（那只能做字串比對＝安慰劑）。
 *   ⚠ 本模組**不 import 任何東西**（含 `$lib/firebase`）：Firebase ID token 由呼叫端
 *     （頁面）取好再傳進來，模組本身才能被守衛單獨載入實跑。
 *
 * ── ⚠⚠ 效能紅線（站長最高優先：不可再造成伺服器不穩定）──────────────────────────
 *   ・**零輪詢、零 `setInterval`**（守衛掃原始碼）；每一發請求都是玩家按了東西才發。
 *   ・線上大廳的入口 `friendsEntryVisible()` 是**純函式**（只讀 env／模組變數／localStorage），
 *     大廳載入**不會多打任何一發請求**。
 *   ・`/friends` 頁打開時只發**一發** `GET /api/friends/list`（不是輪詢；離開再進才會再發）。
 *
 * ── ⭐⭐ 哨兵三態（伺服器 v6.282 起，成功回應帶 `friendsApi: 1`）──────────────────
 *   只讀**伺服器回應本身**判定，絕不比對寫死的版本號（第九種守衛安慰劑）：
 *     ①「支援」：回應帶 `friendsApi`（成功回應），或錯誤碼以 `friends-` 開頭且不是
 *        `friends-disabled`（伺服器**認得**這支端點 ⇒ 已部署）⇒ 記正向快取（localStorage，綁 uid）。
 *     ②「尚未開放」：503 且 `code === 'friends-disabled'`（站長的開關還沒打開）⇒ 記負向快取
 *        （有 TTL；站長打開之後過期就會重新試）。
 *     ③「不支援」：404／回應不是 JSON（伺服器還沒部署到 v6.282、或 GitHub Pages 測試站的靜態
 *        404 頁）⇒ 記負向快取 ⇒ UI 全藏。
 *   ⚠⚠ 下面幾種**一律不算**「不支援」（誤判會把功能誤殺，而且藏起來在本次載入是不可逆的）：
 *     ・401（`friends-auth-required`／token 過期）⇒ 「請先以 email 帳號登入」；
 *     ・429（`friends-rate-limited`／`friends-cooldown`）⇒ 只顯示訊息；
 *     ・503 `friends-helper-missing`／`friends-db-not-ready`、500 `friends-error`、
 *       以及**非 JSON 的 5xx**（tunnel 掛了的 HTML 錯誤頁，v6.139 的教訓）⇒ 暫時性故障，只顯示訊息；
 *     ・網路錯誤（玩家自己斷線）⇒ 只顯示訊息。
 *
 * ── ⭐ 大廳入口的顯示規則（`friendsEntryVisible`）──────────────────────────────
 *   非匿名 ＋ 有 Oracle API 的 build ＋ 「沒有負向快取」才顯示。
 *   ⚠ 交辦原文是「哨兵成功過才顯示」；但正向快取**只有在玩家進過 `/friends` 頁**才寫得進去，
 *     而 `/friends` 的唯一入口就是這顆按鈕 ⇒ 照字面做會變成誰都看不到、永遠進不去。
 *     本版採「未知 ⇒ 顯示、負向快取 ⇒ 藏」：多出來的只是「按了才知道尚未開放」這一種體驗，
 *     而且大廳載入仍然零請求（判定純函式）。詳見 docs/changelog-internal.md v6.283。
 *
 * ── ⭐ v6.284 對戰中／賽後「將對手加為好友」（`friendsBattleEntryVisible` ＋ `requestFriendFromBattle`）──
 *   ・client 只送 `{roomCode}`（休閒）或 `{matchId}`（錦標賽），email 由伺服器代為配對（隱私：對手 email 永不落地）。
 *   ・與大廳入口不同：這顆**只在哨兵成功過（'on'）時**才渲染，匿名／未知一律整顆不出現（站長偏好：不做半死按鈕）。
 *   ・判定仍是純函式；按下才發唯一的一發 POST。
 *
 * ⚠ 這個 build 沒有 Oracle API（`VITE_ORACLE_API_URL` 為空＝GitHub Pages 測試站）時
 *   一律當「不支援」⇒ 入口不出現、`/friends` 頁顯示說明、零請求。
 */

/** 一筆好友關係（伺服器 `_frPublic()` 白名單形狀；⚠ 永遠沒有 email）。 */
export interface FriendRow {
  fid: string;
  status: string;
  nick: string;
  /** 對方最近一次完成對局的瀏覽器 uid（可能為 null）。 */
  uid: string | null;
  uids: string[];
  requestedByMe: boolean;
  blockedByMe: boolean;
  via: string | null;
  at: number | null;
}

export interface FriendsList {
  friendsApi: number;
  me: { uid: string; nick: string | null };
  friends: FriendRow[];
  incoming: FriendRow[];
  outgoing: FriendRow[];
  blocked: FriendRow[];
  limit: number;
  truncated: boolean;
}

/** 失敗的種類。⚠ 只有 `unsupported` 與 `disabled` 會讓 UI 藏起來。 */
export type FriendsFailKind =
  | 'unsupported'   // 404／非 JSON ⇒ 伺服器沒有這支端點（未部署／測試站）
  | 'disabled'      // 503 friends-disabled ⇒ 站長尚未開放
  | 'auth'          // 401 ⇒ 請先以 email 帳號登入
  | 'busy'          // 429 ⇒ 太頻繁／冷卻中
  | 'network'       // fetch 本身失敗
  | 'transient'     // 5xx（helper 未掛載、db 未就緒、tunnel 掛了）
  | 'rejected';     // 伺服器明確拒絕（查無此帳號、已達上限、不能加自己…），訊息直接給玩家看

export type FriendsResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: FriendsFailKind; message: string; code: string; status: number };

/** 可用性三態＋未知。`on`＝哨兵成功過；`disabled`／`unsupported`＝負向快取仍有效；`unknown`＝還沒問過。 */
export type FriendsAvailability = 'on' | 'disabled' | 'unsupported' | 'unknown';

/** 呼叫端提供的身分：Firebase uid（快取鍵）＋ ID token（拿不到就傳 null ⇒ 直接回 auth，不發請求）。 */
export interface FriendsCtx {
  uid: string;
  token: string | null;
  /** 測試用注入點；正式路徑一律用全域 fetch。 */
  fetchImpl?: typeof fetch;
}

export const FRIENDS_UNSUPPORTED_MSG = '這個網站版本的伺服器還沒有提供好友功能。';
export const FRIENDS_DISABLED_MSG = '好友功能尚未開放，請之後再來看看。';
export const FRIENDS_AUTH_MSG = '請先以 email 帳號登入，才能使用好友功能。';
export const FRIENDS_NETWORK_MSG = '連線失敗，請稍後再試一次。';
export const FRIENDS_BUSY_MSG = '操作過於頻繁，請稍候再試一次。';
export const FRIENDS_TRANSIENT_MSG = '伺服器暫時無法提供好友功能，請稍後再試。';

/** 負向快取的存活時間。站長打開開關／部署新版之後，最多這麼久入口就會重新出現。 */
export const FRIENDS_NEG_CACHE_TTL_MS = 60 * 60 * 1000;
const LS_PREFIX = 'ptcg_friends_avail:';

// ── 模組層級狀態（跨路由切換保留；整頁重新載入才重置）────────────────────────
const sessionAvail = new Map<string, FriendsAvailability>();

function apiBase(): string {
  return (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
}

function lsGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, val: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, val); } catch { /* 隱私模式等 ⇒ 只靠 session 記憶 */ }
}

function readCache(uid: string, now: number): FriendsAvailability {
  const raw = lsGet(LS_PREFIX + uid);
  if (!raw) return 'unknown';
  try {
    const o = JSON.parse(raw) as { v?: unknown; at?: unknown };
    if (o.v === 'on') return 'on';
    if ((o.v === 'disabled' || o.v === 'unsupported') && typeof o.at === 'number' && now - o.at < FRIENDS_NEG_CACHE_TTL_MS) return o.v;
  } catch { /* 壞掉的快取當作沒有 */ }
  return 'unknown';
}

function remember(uid: string, v: FriendsAvailability): void {
  if (v === 'unknown') return;
  sessionAvail.set(uid, v);
  lsSet(LS_PREFIX + uid, JSON.stringify({ v, at: Date.now() }));
}

/**
 * 這個帳號目前的可用性。**純函式，不發任何請求。**
 * 判讀順序：沒有 Oracle API 的 build ⇒ unsupported；本次載入問過 ⇒ 用問到的；否則讀 localStorage。
 */
export function friendsAvailability(uid: string | null | undefined, now: number = Date.now()): FriendsAvailability {
  if (!apiBase()) return 'unsupported';
  if (!uid) return 'unknown';
  const s = sessionAvail.get(uid);
  if (s) return s;
  return readCache(uid, now);
}

/**
 * 線上大廳的「👥 好友」入口要不要顯示。**純函式，不發任何請求。**
 * 非匿名 ＋ 有 Oracle API ＋ 沒有仍在有效期內的負向快取 ⇒ 顯示（規則見檔頭）。
 */
export function friendsEntryVisible(uid: string | null | undefined, anonymous: boolean, now: number = Date.now()): boolean {
  if (anonymous || !uid) return false;
  const a = friendsAvailability(uid, now);
  return a === 'on' || a === 'unknown';
}

/**
 * v6.284 對戰中／賽後「將對手加為好友」鈕要不要渲染。**純函式，不發任何請求。**
 * ⚠ 與 `friendsEntryVisible`（未知也顯示）不同：**只有 'on'**（這個帳號的哨兵成功過）才為真 ——
 *   匿名／未知／負向快取一律 false ⇒ 呼叫端整顆不渲染。
 *   代價：從沒進過 `/friends` 頁的玩家在賽後看不到這顆；大廳入口仍是發現路徑（見 docs/changelog-internal.md v6.284）。
 */
export function friendsBattleEntryVisible(uid: string | null | undefined, anonymous: boolean, now: number = Date.now()): boolean {
  if (anonymous || !uid) return false;
  return friendsAvailability(uid, now) === 'on';
}

function fail(kind: FriendsFailKind, message: string, code: string, status: number): FriendsResult<never> {
  return { ok: false, kind, message, code, status };
}

/**
 * 發一發請求並依檔頭的三態規則分類。⚠ 唯一的 fetch 出口；所有分類邏輯都在這裡。
 */
async function requestJson<T>(ctx: FriendsCtx, path: string, init: RequestInit): Promise<FriendsResult<T>> {
  const base = apiBase();
  if (!base) { return fail('unsupported', FRIENDS_UNSUPPORTED_MSG, 'no-api', 0); }
  if (!ctx.token) { return fail('auth', FRIENDS_AUTH_MSG, 'no-token', 0); }
  const f = ctx.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(base + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: 'Bearer ' + ctx.token },
    });
  } catch {
    // ⚠ 網路錯誤**不算**「不支援」：不可以拿玩家自己的一次斷線當判準。
    return fail('network', FRIENDS_NETWORK_MSG, 'network', 0);
  }
  const status = res.status;
  let body: Record<string, unknown> | null = null;
  const ct = (typeof res.headers?.get === 'function' ? res.headers.get('content-type') : '') || '';
  if (ct.includes('application/json')) {
    try {
      const j: unknown = await res.json();
      body = (j && typeof j === 'object') ? (j as Record<string, unknown>) : null;
    } catch { body = null; }
  }
  const code = body && typeof body.code === 'string' ? body.code : '';
  const serverMsg = body && typeof body.error === 'string' && body.error ? body.error : '';
  const knowsEndpoint = !!body && (typeof body.friendsApi === 'number' || code.startsWith('friends-'));

  if (knowsEndpoint && code === 'friends-disabled') {
    remember(ctx.uid, 'disabled');
    return fail('disabled', FRIENDS_DISABLED_MSG, code, status);
  }
  if (knowsEndpoint) {
    // ⭐ 伺服器認得這支端點 ⇒ 已部署且開關已開（disabled 在上面先攔）⇒ 正向快取。
    remember(ctx.uid, 'on');
    if (status >= 200 && status < 300 && body && typeof body.friendsApi === 'number') return { ok: true, data: body as unknown as T };
    if (status === 401 || code === 'friends-auth-required') return fail('auth', serverMsg || FRIENDS_AUTH_MSG, code, status);
    if (status === 429) return fail('busy', serverMsg || FRIENDS_BUSY_MSG, code, status);
    if (status >= 500) return fail('transient', serverMsg || FRIENDS_TRANSIENT_MSG, code, status);
    return fail('rejected', serverMsg || ('操作失敗（' + status + '）'), code, status);
  }
  // 沒有哨兵、也沒有 friends- 錯誤碼 ⇒ 依狀態碼分：
  if (status === 401 || status === 403) return fail('auth', FRIENDS_AUTH_MSG, 'http-' + status, status);
  if (status === 429) return fail('busy', FRIENDS_BUSY_MSG, 'http-429', status);
  if (status >= 500) {
    // ⚠ 非 JSON 的 5xx＝tunnel／nginx 的錯誤頁，是暫時性故障，不是「沒有這支端點」。
    return fail('transient', FRIENDS_TRANSIENT_MSG, 'http-' + status, status);
  }
  // 404（Express「Cannot GET」／GitHub Pages 靜態 404 頁）、或 2xx 卻不是 JSON ⇒ 不支援。
  remember(ctx.uid, 'unsupported');
  return fail('unsupported', FRIENDS_UNSUPPORTED_MSG, 'http-' + status, status);
}

function toStr(v: unknown, fb: string): string { return typeof v === 'string' && v ? v : fb; }
function toRow(r: Record<string, unknown>): FriendRow {
  const uids = Array.isArray(r.uids) ? r.uids.filter((u): u is string => typeof u === 'string') : [];
  return {
    fid: toStr(r.fid, ''),
    status: toStr(r.status, ''),
    nick: toStr(r.nick, '玩家'),
    uid: typeof r.uid === 'string' ? r.uid : null,
    uids,
    requestedByMe: r.requestedByMe === true,
    blockedByMe: r.blockedByMe === true,
    via: typeof r.via === 'string' ? r.via : null,
    at: typeof r.at === 'number' ? r.at : null,
  };
}
function toRows(v: unknown): FriendRow[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').map((x) => toRow(x as Record<string, unknown>)) : [];
}

/**
 * 把伺服器回應正規化成 `FriendsList`。
 * ⚠ 伺服器少給欄位時**補預設值**而不是丟例外 —— 前端不可以因為一個欄位沒有就整頁壞掉。
 */
function normalizeList(b: Record<string, unknown>): FriendsList {
  const me = (b.me && typeof b.me === 'object') ? (b.me as Record<string, unknown>) : {};
  return {
    friendsApi: typeof b.friendsApi === 'number' ? b.friendsApi : 0,
    me: { uid: toStr(me.uid, ''), nick: typeof me.nick === 'string' ? me.nick : null },
    friends: toRows(b.friends),
    incoming: toRows(b.incoming),
    outgoing: toRows(b.outgoing),
    blocked: toRows(b.blocked),
    limit: typeof b.limit === 'number' ? b.limit : 100,
    truncated: b.truncated === true,
  };
}

/** GET /api/friends/list —— 只在 `/friends` 頁打開、或玩家操作之後重讀時呼叫。 */
export async function fetchFriendsList(ctx: FriendsCtx): Promise<FriendsResult<FriendsList>> {
  const r = await requestJson<Record<string, unknown>>(ctx, '/api/friends/list', { method: 'GET' });
  if (!r.ok) return r;
  return { ok: true, data: normalizeList(r.data) };
}

export interface FriendsRequestReply { status: string; fid: string; already: boolean }

/** `/api/friends/request` 三種入口共用的送出＋正規化（唯一的 POST 形狀）。 */
async function postFriendRequest(ctx: FriendsCtx, body: Record<string, string>): Promise<FriendsResult<FriendsRequestReply>> {
  const r = await requestJson<Record<string, unknown>>(ctx, '/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  return { ok: true, data: { status: toStr(r.data.status, ''), fid: toStr(r.data.fid, ''), already: r.data.already === true } };
}

/** POST /api/friends/request {email} —— 站長裁定：查無此帳號**明講**（伺服器 404 `friends-no-such-account`）。 */
export async function requestFriendByEmail(ctx: FriendsCtx, email: string): Promise<FriendsResult<FriendsRequestReply>> {
  return postFriendRequest(ctx, { email: String(email || '').trim() });
}

/**
 * v6.284 對戰中／賽後加好友的對象：休閒＝房號、錦標賽＝場次編號（`tournamentMatches._id`）。
 * ⚠ client 只送這兩種識別，**不送也拿不到**對手 email；伺服器只認「要求者本人就在那一場」
 *   （403 `friends-not-in-room`／`friends-not-in-match`），對手匿名 ⇒ 409 `friends-opponent-anonymous`（訊息直接給玩家看）。
 */
export type FriendsBattleTarget = { roomCode: string } | { matchId: string };

/** POST /api/friends/request {roomCode} | {matchId}。空字串一律不發請求（回 rejected）。 */
export async function requestFriendFromBattle(ctx: FriendsCtx, target: FriendsBattleTarget): Promise<FriendsResult<FriendsRequestReply>> {
  if ('matchId' in target) {
    const mid = String(target.matchId || '').trim();
    if (!mid) return fail('rejected', '找不到這場對戰的編號。', 'no-target', 0);
    return postFriendRequest(ctx, { matchId: mid });
  }
  const code = String(target.roomCode || '').trim().toUpperCase();
  if (!code) return fail('rejected', '找不到這場對戰的房號。', 'no-target', 0);
  return postFriendRequest(ctx, { roomCode: code });
}

/** v6.284 把 request 的成功回應翻成給玩家看的一句話（賽後鈕與設定 modal 共用；純函式）。 */
export function friendsRequestReplyText(r: FriendsRequestReply): string {
  if (r.status === 'accepted') return r.already ? '✅ 對方已經是好友' : '✅ 雙方已成為好友';
  return r.already ? '⏳ 已邀請過，等待對方確認' : '✅ 邀請已送出，等待對方確認';
}

export type FriendsAction = 'accept' | 'reject' | 'remove' | 'block' | 'unblock';

/** POST /api/friends/{accept|reject|remove|block|unblock} {fid}。⚠ remove／unblock 是真刪除，UI 要先二次確認。 */
export async function friendsAction(ctx: FriendsCtx, action: FriendsAction, fid: string): Promise<FriendsResult<Record<string, unknown>>> {
  return requestJson<Record<string, unknown>>(ctx, '/api/friends/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fid }),
  });
}

/** ⚠ 只給守衛用：把模組層級狀態清乾淨，讓每一條斷言互不污染。 */
export function __resetFriendsForTest(): void {
  sessionAvail.clear();
}
