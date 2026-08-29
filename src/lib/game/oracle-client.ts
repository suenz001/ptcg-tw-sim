/**
 * v4.61 Oracle backend client — pure fetch wrappers.
 *
 * 提供 firestore-shape 的 API 給 room-oracle.ts (下次 Phase 3b 寫) 用。
 * 此檔不依賴 firebase，純 fetch + 環境變數。
 *
 * 用法：
 *   import { oracleAuth, oracleApi, oraclePollRoom } from './oracle-client';
 *   const room = await oracleApi('/api/rooms/ABCD');
 *   const unsub = oraclePollRoom('ABCD', room => { ... }, 800);
 *
 * 環境變數：
 *   VITE_BACKEND_MODE='firebase' (預設) | 'oracle'
 *   VITE_ORACLE_API_URL='https://xxx.trycloudflare.com'
 */

// ⭐v6.214③ 伺服器單一時鐘（leaf 模組，零 import ⇒ 不可能形成循環）
import { noteServerTime, getServerClockOffsetMs } from './server-clock';

const API_URL: string = ((import.meta as any).env?.VITE_ORACLE_API_URL as string) || '';
const TOKEN_KEY = 'ptcg_oracle_token';
const UID_KEY = 'ptcg_oracle_uid';

let _token: string | null = null;
let _uid: string | null = null;

// ── ⭐⭐⭐v6.245 休閒對戰網路逾時（守衛 scripts/test-v6245-oracle-api-timeout.mjs）──────
// >>> v6245-oracle-timeout-core
//   ── 這在修什麼 ──────────────────────────────────────────────────────────
//   nginx 慢請求 log（2026-08-26/27 實測，不是推測）：
//     `60.001 - 408 /api/rooms/W6JC PUT`（upstream_response_time = "-" ⇒ 請求**從來沒送到
//        node**；408 ＝ nginx 等 client 送完 body 等滿 60 秒沒等到）—— 同一間房 10 分鐘內 45 筆。
//     `86.954 0.007 409 /api/rooms/XTCT PUT request_length=48285` ⇒ 上行約 4.4 kbps，
//        48KB 要傳 87 秒；等它傳到盤面早就變了 → 409 → 前端重抓重做。
//   而 `oracleApi` ——休閒對戰**所有**請求的唯一出口——完全沒有 AbortController、沒有任何
//   時間上限，`await fetch` 在隧道排隊／黑洞時既不 resolve 也不 reject。後果不是「慢」，是
//   **永久停擺**：oraclePollRoom / oraclePollMessages / subscribeOpenRooms 三個 tick 迴圈都是
//   「await 完才排下一發」，掛住那一發永遠不會排下一發 ⇒ 玩家再也收不到對手的動作、大廳
//   再也不更新，畫面上卻沒有任何錯誤訊息（＝「按了沒反應」）。
//   錦標賽的 `tApi` 在 v6.135/v6.179 已經治過同一個病（12s/8s），休閒版從來沒治過，
//   而休閒佔全站 94% 流量。
//
//   ── 逾時值怎麼定的（Rule 37：必須大於實測過的最慢**成功**案例）──────────────
//   健康取樣批的 net 中位數 **273 ms**，30 秒是它的 100 倍以上；4.4 kbps 那位玩家連
//   一包 48KB 都傳不完（87 秒），砍掉他也只是讓他不做白工（反正到了也是 409）。
//   ⚠ 但「砍掉」**不可以**變成「每 30 秒砍一次、永遠傳不完」⇒ 逾時後一律走
//     room-oracle.ts `oracleTx` 的既有 409 重試路徑（先重新拉最新盤面，再對新盤面重做），
//     且有次數上限與退避；詳見那裡的註解。
export const ORACLE_API_TIMEOUT_MS = 30000;
//   ⚠ 建房／進場／入座／開局這類「失敗有狀態副作用」的呼叫（可能伺服器其實成功了、
//     client 卻以為失敗而再建一間 ⇒ 大廳出現孤兒房）放寬到 60 秒 ——
//     慢網路不該被誤殺（沿用 v6.179 tApi 的 opts.timeoutMs 設計）。
export const ORACLE_SIDEEFFECT_TIMEOUT_MS = 60000;

//   ── ⭐⭐⭐v6.246 逾時預算改成「跟著要上傳的位元組走」（獨立審查者【問題3】：修後不可比修前差）──
//   v6.245 給所有請求同一個 30 秒。但 nginx 那筆實測是
//     `86.954 0.007 409 /api/rooms/XTCT PUT request_length=48285`
//   ⇒ 上行 ≈ 555 B/s，48KB 要 **87 秒**才送得完；30 秒只送得出 34% ⇒ 兩發都被砍
//   ⇒ 那位玩家的動作**永遠送不到伺服器**，最後被 force-adopt 回捲。
//   ⚠⚠ 而 v6.244（沒有逾時）那 87 秒是**送達**的（nginx 沒砍它，upstream_response_time=0.007）
//     ⇒ 對他而言 v6.245 是**倒退**，違反「絕不可讓玩家端變差」。
//   ⚠ 同樣 40~48KB 的 startGame 早就給了 60 秒，pushGameState / pushUndoRollback 卻只有 30 秒
//     —— 這個不對稱本身就是 bug。
//   ⚠ 為什麼不是「一律改 60 秒」：60 秒只送得出 33KB（69%），**那位玩家還是送不到**。
//     時間預算的物理量是「位元組 ÷ 上行速率」，所以預算必須跟著位元組走。
export const ORACLE_MIN_UPLINK_BPS = 500;
//   小封包不加預算：500 B/s 下 4KB 只要 8 秒，30 秒基底綽綽有餘。
//   ⚠ 這一條同時保住「行為不變」——nginx log 裡那 45 筆真黑洞（`60.001 - 408 … PUT 1091`）
//     body 只有 1091 B ⇒ 預算仍是 30 秒，**黑洞情境的等待時間一秒都沒有變長**。
export const ORACLE_UPLOAD_FREE_BYTES = 4096;
//   上界（Rule 37：必須大於實測過的最慢**成功**案例 86.954 秒，取約 38% 餘裕）。
//   ⚠ 上界＝**保證上限**：500 B/s 時 120 秒最多只送得完約 60KB，更大的封包仍會失敗（誠實寫出來）。
export const ORACLE_API_TIMEOUT_MAX_MS = 120000;

// ── ⭐⭐⭐v6.248 一發 `pushGameState` 到底可以「還在途中」多久（獨立審查者【問題2】）──────
//   v6.247 用 ORACLE_API_TIMEOUT_MAX_MS（120 秒）當「在途保護」的上限，那是**假陰性**：
//   120 秒是**單一發 HTTP 請求**的預算，而一發 pushGameState 走的是 room-oracle 的 `oracleTx`，
//   它是一個「讀→改→寫」的重試迴圈。逐項拆開（每一項都可在原始碼裡指到）：
//     ① `for (let attempt = 0; attempt < 5; attempt++)` ⇒ 最多 5 輪。
//     ② 每一輪 = `oracleGetRoom`（GET、body 0 ⇒ 預算 ORACLE_API_TIMEOUT_MS）
//              + `oracleUpsertRoom`（PUT、48KB ⇒ 預算最高 ORACLE_API_TIMEOUT_MAX_MS）。
//     ③ ⚠ 每一發請求裡面還藏著一次重試：`oracleApi` 收到 401 會**遞迴一次**
//        （`_retry` 由 true 變 false），而重試那一發有**自己全新的**計時器與預算
//        ⇒ 單發請求的最壞時間是預算的 (1 + ORACLE_API_MAX_AUTH_RETRIES) 倍。
//        （這一項是 v6.247 與審查者雙方都漏掉的；只算 GET+PUT 會少算一半。）
//     ④ 409 conflict 的退避 `50 * (attempt + 1)`，五輪合計 50+100+150+200+250 = 750 ms。
//   ⚠ 逾時重試（TX_TIMEOUT_RETRY_MAX）不會把總時間拉更長：它只在**基底預算**（30 秒）的
//     逾時才走，那一輪的 PUT 反而只花 30 秒，換來 1000 ms 退避 ⇒ 總量嚴格小於全 409 的路徑。
//   ⚠ 為什麼不設成無限大：旗標萬一沒被還原，自癒就永遠不會動。這裡是**推導出來的有限值**，
//     而且比它更久的卡住一定早就被 3 分鐘的棄權門檻接手了（＝對局不可能真的永遠卡著）。
//   ⚠ 這三個常數是 room-oracle.ts `oracleTx` 與 oracleApi 的鏡射，
//     由 scripts/test-v6248-selfheal-followups.mjs 直接讀那兩支的原始碼比對，改了會紅。
export const ORACLE_TX_MAX_ATTEMPTS = 5;
export const ORACLE_TX_CONFLICT_BACKOFF_TOTAL_MS = 750;   // 50+100+150+200+250
export const ORACLE_API_MAX_AUTH_RETRIES = 1;             // oracleApi 的 401 重新登入重試
/** 一發 `pushGameState` / `pushUndoRollback` 在最壞情況下的總時長（毫秒）。 */
export const ORACLE_TX_MAX_TOTAL_MS =
  ORACLE_TX_MAX_ATTEMPTS
    * (ORACLE_API_TIMEOUT_MS + ORACLE_API_TIMEOUT_MAX_MS)
    * (1 + ORACLE_API_MAX_AUTH_RETRIES)
  + ORACLE_TX_CONFLICT_BACKOFF_TOTAL_MS;

// ── ⭐⭐⭐v6.249 在途保護要用的是**實用**上限，不是上面那個數學最壞值（審查者【問題3】）──
//   `ORACLE_TX_MAX_TOTAL_MS` = 1,500,750 ms ≈ **25.01 分鐘**，是「五輪全部 409、每一發都
//   401 重登、每一發都用滿預算」這種永遠不會同時發生的疊加。它比 3 分鐘的棄權門檻大 **8 倍**
//   ⇒ 真的有 bug（標記沒被還原）時，玩家**先輸掉一局**，fail-safe 才動 ＝ 等於沒有 fail-safe。
//   ⚠ 佐證：v6.247/v6.248 自己的突變測試必須把上限偷換成 40 秒才驗得動這個機制 ——
//     一個「要偷換參數才測得到」的保護，就是還沒被真的驗過。
//
//   ⭐ 取值依據（Rule 37：**必須大於實測過的最慢成功案例**）：
//     ① 線上實測最慢的**成功**推送是 nginx log 的 `86.954 … 409 PUT request_length=48285`。
//     ② `oracleTx` 允許 409 衝突重試 ⇒ 實務最壞 ≈ 2 輪 ×（GET 幾秒 ＋ PUT 87 秒）≈ 184 秒。
//     ③ 取 **2 × ORACLE_API_TIMEOUT_MAX_MS = 240,000 ms**（4 分鐘）＝「容得下連續兩輪的大 PUT」，
//        對 ① 有 2.76 倍餘裕、對 ② 有 1.30 倍餘裕，同時只有棄權門檻的 **1.33 倍**（不是 8 倍）。
//   ⚠⚠ 誠實寫出取捨：**超過 240 秒才送達的推送，保護會到期**，那一手可能被 force-adopt
//     退回攻擊前（推送最後仍會送達，盤面會再收斂回來，不會永久遺失 —— 守衛有實跑驗證）。
//     線上從來沒有觀測過 >120 秒的成功推送，而 240 秒的玩家早就過了棄權門檻。
//   ⚠ 下界不可低於 `ORACLE_API_TIMEOUT_MAX_MS`：否則保護會在請求自己逾時之前就過期。
/** ⭐v6.249 「這一發推送還在途中」的實用上限（＝ oracleTx 連續兩輪大 PUT 的預算）。 */
export const PUSH_INFLIGHT_FAILSAFE_MS = 2 * ORACLE_API_TIMEOUT_MAX_MS;

/**
 * ⭐⭐⭐v6.246 這一發的逾時預算（純函式，守衛直接實跑）。
 * @param uploadBytes 要上傳的 body 位元組數（估計值即可，**寧可高估**：高估只是多給時間，不會誤殺）。
 * - 0（GET／無 body）與 ≤4KB 的小封包 ⇒ 回 ORACLE_API_TIMEOUT_MS，與 v6.245 逐字相同。
 * - 超出的部分以 ORACLE_MIN_UPLINK_BPS 換算成時間加上去，並夾在 ORACLE_API_TIMEOUT_MAX_MS 以內。
 */
export function oracleTimeoutBudgetMs(uploadBytes: number): number {
  // ⚠ 非有限值（NaN/Infinity）一律退回基底：預算是安全網，絕不能自己算出 NaN 把 setTimeout 弄成 0。
  const bytes = Number.isFinite(uploadBytes) ? Math.floor(uploadBytes) : 0;
  const extra = Math.max(0, bytes - ORACLE_UPLOAD_FREE_BYTES);
  if (!(extra > 0)) return ORACLE_API_TIMEOUT_MS;
  return Math.min(
    ORACLE_API_TIMEOUT_MS + Math.ceil((extra * 1000) / ORACLE_MIN_UPLINK_BPS),
    ORACLE_API_TIMEOUT_MAX_MS,
  );
}

/** 這個錯誤是不是「我這顆計時器造成的逾時」（呼叫端據此決定要不要重新同步）。 */
export function isOracleTimeout(err: unknown): boolean {
  return !!(err && typeof err === 'object'
    && (err as { oracleTimeout?: boolean }).oracleTimeout === true);
}
/** ⚠ 只認 name==='AbortError'；**別人**丟的 AbortError 不可以被當成逾時（見 _timedOut 旗標）。 */
function _isAbortError(e: unknown): boolean {
  return !!(e && typeof e === 'object'
    && ((e as { name?: string }).name === 'AbortError' || String(e).includes('AbortError')));
}
/**
 * ⭐⭐⭐v6.246 這個逾時是不是「因為 body 大而放寬過預算」的那種。
 *  這種逾時**重試沒有意義**（同樣大小的 body 對新盤面再送一次，在上行塞死時只是把 UI 再鎖同樣久），
 *  所以 room-oracle 的 oracleTx 不讓它吃掉重試額度。基底預算的逾時仍照 v6.245 吃 1 次重試。
 */
export function isOracleUploadBudgetTimeout(err: unknown): boolean {
  return !!(err && typeof err === 'object'
    && (err as { oracleUploadBudget?: boolean }).oracleUploadBudget === true);
}
/**
 * ⭐⭐⭐v6.246 HTTP 狀態碼的**單一可靠來源**（獨立審查者【問題2】）。
 *  v6.245 之前 oracleGetRoom / oracleGetRoomDelta 用 `String(err).includes('404')` 判「房間不存在」。
 *  而逾時訊息長這樣：`連線逾時（30 秒沒有回應）：/api/rooms/XXXX?since=404&logSince=…&logh=4042ab…`
 *  —— URL 裡只要出現字串 `404`（logh 是雜湊、since/logSince 是數字）逾時就被誤判成「房間不存在」
 *  ⇒ 回 null ⇒ oraclePollRoom 走 callback(null) ⇒ handleRoomUpdate 顯示「房間不存在或連線中斷」
 *  並停止同步 —— 明明只是慢，卻把玩家踢出對局。
 *  ⚠ v6.244 只有 5xx 訊息才踩得到；v6.245 把觸發源換成「網路事件期間**大量**逾時」⇒ 機率放大好幾個數量級。
 *  ⇒ 改由 oracleApi 在丟錯時把 `res.status` **結構化**掛上去，判斷一律走這支，全站不再比對字串。
 */
export function oracleErrorStatus(err: unknown): number | null {
  const s = (err as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
}
function _oracleTimeoutError(path: string, ms: number, uploadBudget: boolean): Error {
  // AbortError 的原文對玩家沒有意義（Rule 37）⇒ 特判成人話。
  type TimeoutErr = Error & { oracleTimeout?: boolean; oracleTimeoutMs?: number; oracleUploadBudget?: boolean };
  const err = new Error(`連線逾時（${Math.round(ms / 1000)} 秒沒有回應）：${path}`) as TimeoutErr;
  err.oracleTimeout = true;
  err.oracleTimeoutMs = ms;
  err.oracleUploadBudget = uploadBudget;
  return err;
}
// <<< v6245-oracle-timeout-core


// ⭐⭐⭐v6.197 身分變動通知。
//   401（JWT 過期/失效）時 oracleApi 會 oracleSignOut() + 重新匿名登入，而伺服器發的是
//   **一個全新的 uid**（v5.628 只想修「卡在 401 建不了房」，沒有人通知畫面端）。
//   畫面端（game/+page.svelte 的 myUid）只在 onMount 取過一次 ⇒ 換 uid 之後
//   `findMySeatIdx(room.seats, myUid)` 永遠回 -1 ⇒ 玩家與觀戰者都變成「認不出座位」，
//   而 v6.197 之前的觀戰判定是 fail-open 的（見 viewer-role.ts）⇒ 觀戰者被當成玩家。
//   ⚠ 這裡只負責「說出去」，要不要相信由呼叫端決定；listener 丟例外不可以打死 API 呼叫。
type OracleUidListener = (uid: string) => void;
const _uidListeners = new Set<OracleUidListener>();
export function onOracleUidChange(cb: OracleUidListener): () => void {
  _uidListeners.add(cb);
  return () => { _uidListeners.delete(cb); };
}
function _setUid(uid: string): void {
  const changed = _uid !== uid;
  _uid = uid;
  if (!changed) return;
  for (const cb of _uidListeners) {
    try { cb(uid); } catch (e) { console.warn('[oracle uid listener]', e); }
  }
}

/**
 * 匿名登入 — 取得 JWT token + uid（cache 在 localStorage）
 * ⭐v6.245 `signal`：由 oracleApi 傳它自己的 AbortSignal 進來。
 *   這一發（快取沒命中時才會發）若掛住，整支 oracleApi 就跟著掛住 —— 逾時保護必須連它一起蓋。
 *   ⚠ 其他呼叫端不傳 ⇒ 行為與 v6.244 逐字相同。
 */
export async function oracleAuth(signal?: AbortSignal): Promise<{ uid: string; token: string }> {
  if (_token && _uid) return { uid: _uid, token: _token };

  // 先試 localStorage cache
  if (typeof localStorage !== 'undefined') {
    const cachedToken = localStorage.getItem(TOKEN_KEY);
    const cachedUid = localStorage.getItem(UID_KEY);
    if (cachedToken && cachedUid) {
      _token = cachedToken;
      _setUid(cachedUid);   // v6.197：走中央 setter，身分一有變動就通知
      return { uid: cachedUid, token: cachedToken };
    }
  }

  // 沒 cache → 跟 server 拿
  if (!API_URL) throw new Error('VITE_ORACLE_API_URL not set');
  // ⭐⭐⭐v6.246 沒有外部 signal 時，這一發也要有自己的時間上限（獨立審查者【問題1】的順帶項）。
  //   v6.245 只保護了 oracleApi 內部那一條路；**裸呼叫**的四個點完全沒有上限：
  //     room-oracle.ts getMyUid()／auth-facade.ts ensureSignedIn()、onUidChange()／
  //     game/+page.svelte onMount。
  //   冷快取（第一次進站／清過瀏覽資料／換裝置）的玩家碰上 auth 端點黑洞就會**永遠**卡住；
  //   onMount 那一發還是 `await`，會把後面的卡包載入整串堵死。
  //   ⚠ 有外部 signal（＝ oracleApi 傳進來的）時**不另外開計時器**，行為與 v6.245 逐字相同。
  //   ⚠ 快取命中的路徑在上面就 return 了 ⇒ 熱路徑一顆計時器都不會建（零成本）。
  let _ac: AbortController | null = null;
  let _to: ReturnType<typeof setTimeout> | undefined;
  let _timedOut = false;
  let _sig = signal;
  if (!_sig) {
    _ac = new AbortController();
    _sig = _ac.signal;
    _to = setTimeout(() => { _timedOut = true; try { _ac?.abort(); } catch { /* ignore */ } }, ORACLE_API_TIMEOUT_MS);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/anonymous`, {
      method: 'POST',
      cache: 'no-store',
      signal: _sig,
    });
  } catch (e) {
    if (_timedOut && _isAbortError(e)) throw _oracleTimeoutError('/api/auth/anonymous', ORACLE_API_TIMEOUT_MS, false);
    throw e;
  } finally {
    // ⚠ 一定要在 finally：少了它，每一發成功的匿名登入都留一顆計時器（洩漏）。
    if (_to !== undefined) clearTimeout(_to);
  }
  if (!res.ok) throw new Error(`oracleAuth failed: ${res.status} ${await res.text()}`);
  const { uid, token } = await res.json();
  _token = token; _setUid(uid);   // v6.197：新簽發的匿名身分要通知出去
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(UID_KEY, uid);
  }
  return { uid, token };
}

/** 取得當前 uid（已登入時，無需 await） */
export function oracleCurrentUid(): string | null {
  if (_uid) return _uid;
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(UID_KEY);
  }
  return null;
}

/** 清除 token（登出） */
export function oracleSignOut(): void {
  _token = null; _uid = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(UID_KEY);
  }
}

/**
 * 通用 fetch wrapper — 自動帶 token + JSON encode body。
 *
 * ⭐⭐⭐v6.245 逾時保護（見檔頭 v6245-oracle-timeout-core 區塊的完整說明）。
 *   ⚠ 正常路徑**沒有多任何一次 await、沒有多發任何請求**：只多了一個 AbortController
 *     與一顆 setTimeout（成功回來就在 finally 清掉）。
 *   ⚠ 204 / 304 / 409 / 401 四條既有路徑的回傳值逐字不變。
 */
export async function oracleApi<T = any>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
    /** ⭐v6.245 逃生口（比照 v6.179 tournamentDispatch 的 opts.timeoutMs）。 */
    timeoutMs?: number;
  } = {},
  _retry = true,  // v5.628 內部用：401(token 過期/失效) 時自動重新登入並重試一次
): Promise<T> {
  if (!API_URL) throw new Error('VITE_ORACLE_API_URL not set');
  // ⭐⭐⭐v6.246 body 先序列化（本來就要做的事，只是提前），才知道這一發要上傳多少位元組。
  //   ⚠ 位元組數用 `length * 2` 估：實測以中文為主的盤面 JSON 是 1.646 倍，取 2 倍留餘裕。
  //     成本 0.02µs／發，TextEncoder 精算要 216µs（量測腳本：
  //     scripts/perf-v6246-oracle-timeout-overhead.mjs）。高估只會多給預算，不會誤殺。
  let body: string | undefined;
  if (options.body !== undefined) body = JSON.stringify(options.body);
  const _budgetMs = oracleTimeoutBudgetMs(body === undefined ? 0 : body.length * 2);
  // ⚠ opts.timeoutMs（建房／進場／入座／開局的 60 秒逃生口）與大小預算取**大**的那個：
  //   逃生口的用意是「放寬」，不該反過來把大封包（例如 startGame 的整包盤面）砍回 60 秒。
  const _toMs = Math.max(options.timeoutMs ?? ORACLE_API_TIMEOUT_MS, _budgetMs);
  const _ac = new AbortController();
  // ⚠ 只認「這顆計時器造成的 abort」——不把別的來源丟出來的 AbortError 誤判成逾時（v6.179 同款）。
  let _timedOut = false;
  const _to = setTimeout(() => { _timedOut = true; try { _ac.abort(); } catch { /* ignore */ } }, _toMs);
  try {
    // ⚠ oracleAuth 也吃這顆 signal：快取沒命中時它會自己發一支 fetch，那一支掛住同樣會卡死整支。
    const { token } = await oracleAuth(_ac.signal);
    // v4.68: 加 Cache-Control 阻止 Chrome 自動發 If-None-Match → server 回 304 → body 空
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Cache-Control': 'no-cache',
      ...(options.headers ?? {}),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      // v4.68: cache:'no-store' 不讓 fetch 介入瀏覽器 HTTP cache（不會 If-None-Match）
      cache: 'no-store',
      signal: _ac.signal,
    });
    // v4.68: 即便 no-store 失效，server 仍可能回 304（理論上不該）—safety net
    if (res.status === 304) {
      // 沒 body，當作 caller 自己重試；但其實 caller 走 polling 自動會再試
      throw new Error('oracleApi 304 (unexpected with cache:no-store)');
    }
    // v5.610: server 對「房間版本未變」回 204（無 body）→ 回傳 undefined 讓 caller 略過
    if (res.status === 204) {
      return undefined as unknown as T;
    }
    // v5.628：401(jwt expired / invalid token)= 快取的 token 過期或失效。
    //   oracleAuth 只會回快取 token、不檢查到期 → 清掉重新匿名登入,以新 token 重試一次,避免卡在 401 建不了房。
    if (res.status === 401 && _retry) {
      // ⚠⭐v6.245 重試那一發必須有**自己的新 AbortController**：先把這一發的計時器拆掉，
      //   否則它會在重試進行中誤觸，並讓 `_timedOut` 把重試的錯誤誤標成逾時。
      clearTimeout(_to);
      _timedOut = false;
      oracleSignOut();
      // ⭐⭐⭐v6.246 這裡原本還有一發 `await oracleAuth();` —— 它**不帶任何 signal、沒有上限**，
      //   auth 端點黑洞時整支 oracleApi 就永遠不 settle（實跑推進 10 分鐘仍未 settle），
      //   「按了沒反應」在 401 這條路上原封不動存活。
      //   ⚠ 它同時是**多餘**的：oracleSignOut() 已經把 _token/_uid/localStorage 都清掉，
      //     底下遞迴那發 oracleApi 開頭就會 `await oracleAuth(_ac.signal)`（受保護的新 signal）
      //     重新跟伺服器要 token —— 絕不可能沿用舊 token。
      //   ⚠ 終止條件仍在：遞迴帶 `_retry = false` ⇒ 再收到 401 也不會再遞迴（不可能無窮遞迴）。
      return oracleApi<T>(path, options, false);
    }
    if (!res.ok) {
      // 409 conflict 也算 ok response, caller 要處理
      if (res.status === 409) {
        return (await res.json()) as T;
      }
      // ⭐⭐⭐v6.246 訊息**逐字不變**（UI 有在顯示、內部診斷也在讀），只額外把狀態碼結構化掛上去，
      //   讓「房間不存在」的判斷不必再比對字串（見 oracleErrorStatus 的說明）。
      const _err = new Error(`oracleApi ${path} → ${res.status}: ${await res.text()}`) as Error & { status?: number };
      _err.status = res.status;
      throw _err;
    }
    return (await res.json()) as T;
  } catch (e) {
    // ⚠ 第三個引數：這一發的預算是不是被 body 大小放寬過（oracleTx 據此決定要不要重試）。
    if (_timedOut && _isAbortError(e)) throw _oracleTimeoutError(path, _toMs, _budgetMs > ORACLE_API_TIMEOUT_MS);
    throw e;
  } finally {
    // ⚠ 一定要在 finally：少了它，每一發成功的請求都留一顆計時器（洩漏）。
    clearTimeout(_to);
  }
}

// ── Rooms ─────────────────────────────────────────────────────────────

export type OracleRoom = Record<string, any> & {
  _id: string;
  _version: number;
  createdAt: number;
  updatedAt: number;
};

export type OracleUpsertResult =
  | { ok: true; version: number; room: OracleRoom }
  | { conflict: true; currentVersion: number; room: OracleRoom | null };

// v5.610: 房間版本未變更哨兵（server 回 204 時用）
export const ROOM_UNCHANGED = Symbol('room-unchanged');

// ── v6.220 對戰紀錄（gameState.log）增量輪詢 ────────────────────────────────
// >>> v6220-log-delta-client-core（守衛 test-v6220-log-delta-and-email-privacy.mjs 抽出實跑）
//   背景：log 佔房間 doc ~60% 且隨對局線性成長（第 9 回合 202 則 ≈ 29.2KB），而輪詢
//   絕大多數回應的 log 前綴與 client 已有的逐字相同。輪詢改帶 logSince=<已有則數> 與
//   logh=<前綴鏈雜湊>，伺服器（server_admin_patch.js 的 PTCG-ROOMS-OUT 區塊）只在
//   「前綴逐字相同」時回 log.slice(n) 並附 logDelta{since,total,fh}。
//   ⭐ 正確性 > 效能 —— 三道防線，任何一道不過都退回全量：
//     ① 伺服器端前綴雜湊比對：悔棋（log 變短）／等長但內容不同／參數缺席或解析不了
//        → 伺服器直接回全量（連 logDelta 標記都沒有）。
//     ② client 端重組複驗：logDelta.fh 是伺服器對「完整 log」算的鏈雜湊，重組結果必須
//        重算出同一個值，否則整包作廢（擋掉任何中途突變／競態／兩端演算法漂移）。
//     ③ 複驗不過 → oraclePollRoom 立刻改抓一次全量（不帶任何增量參數）。
//   雜湊：FNV-1a 雙 32bit，對每則 log 的 JSON.stringify 逐字元累積、每則之後混入分隔符。
//   與伺服器端逐字元同演算法；JSON round-trip 保序保值，兩端對同一份 log 必得同雜湊。
export function logChainHash(log: readonly unknown[], n: number): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < n; i++) {
    const s = JSON.stringify(log[i]) ?? 'null';
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
    }
    h1 = Math.imul(h1 ^ 10, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ 10, 16777619) >>> 0;
  }
  return h1.toString(16) + '-' + h2.toString(16) + '-' + n;
}

export interface RoomLogDelta { since: number; total: number; fh: string }

/**
 * 把「可能是增量」的輪詢回應重組成完整房間（純函式，不碰網路）。
 * - 回應沒有 logDelta 標記（舊伺服器／第一發／伺服器判定不可增量）→ 原樣採納（全量）。
 * - 有標記 → 以 prevLog 前 since 則＋本包 log 重組，並以 fh 端到端複驗；
 *   驗不過回 { ok:false }，呼叫端必須改抓全量 —— 絕不把重組失敗的 log 交給 UI。
 */
export function mergePolledRoomLog(
  prevLog: readonly unknown[] | null,
  room: OracleRoom,
  logDelta: RoomLogDelta | null | undefined,
): { ok: true; room: OracleRoom; nextLog: unknown[] | null } | { ok: false } {
  const gs = (room as { gameState?: { log?: unknown[] } | null }).gameState;
  const lg = gs && Array.isArray(gs.log) ? gs.log : null;
  if (!logDelta) {
    // 全量：直接採納；鏈基準換成這一包的 log（複製一份，UI 之後對陣列的增刪不影響鏈）
    return { ok: true, room, nextLog: lg ? lg.slice() : null };
  }
  if (!prevLog || !gs || lg === null) return { ok: false };
  const n = logDelta.since;
  if (!Number.isInteger(n) || n < 0 || n > prevLog.length) return { ok: false };
  const full = prevLog.slice(0, n).concat(lg);
  if (full.length !== logDelta.total) return { ok: false };
  // ⭐ 端到端複驗：重組結果必須與伺服器手上的完整 log 雜湊一致，否則一律作廢
  if (typeof logDelta.fh !== 'string' || logChainHash(full, full.length) !== logDelta.fh) return { ok: false };
  const fullRoom = { ...room, gameState: { ...gs, log: full } } as OracleRoom;
  return { ok: true, room: fullRoom, nextLog: full };
}
// <<< v6220-log-delta-client-core

export function oracleGetRoom(code: string): Promise<OracleRoom | null>;
export function oracleGetRoom(code: string, since: number): Promise<OracleRoom | null | typeof ROOM_UNCHANGED>;
export async function oracleGetRoom(
  code: string,
  since?: number,
): Promise<OracleRoom | null | typeof ROOM_UNCHANGED> {
  try {
    // 只有 polling 會帶 since（>=0）；其餘呼叫端不帶 → server 照回完整 room
    const q = since !== undefined && since >= 0 ? `?since=${since}` : '';
    const res = await oracleApi<{ room: OracleRoom } | undefined>(`/api/rooms/${code.toUpperCase()}${q}`);
    // 204：server 告知版本未變 → 回哨兵讓 caller 略過（不觸發任何 callback）
    if (res === undefined) return ROOM_UNCHANGED;
    _noteDeltaPutSentinel(res);   // ⭐v6.270 delta-PUT 哨兵：以最近一次 GET 的 {room} 回應為準
    return res.room;
  } catch (err: unknown) {
    // ⭐⭐⭐v6.246 只有**真的 404** 才算「房間不存在」。逾時（包括 URL 裡剛好出現 404 的那種）
    //   必須原樣往上拋 —— 回 null 會讓 oraclePollRoom 走 callback(null)，畫面誤報
    //   「房間不存在或連線中斷」並停止同步。
    if (isOracleTimeout(err)) throw err;
    if (oracleErrorStatus(err) === 404) return null;
    throw err;
  }
}

/**
 * v6.220 輪詢專用：帶版本（?since= 的 204 機制）＋「已有 log」的前綴鏈雜湊（增量機制）。
 * 其他呼叫端（oracleTx 讀改寫／加入房間／重新整理）一律走 oracleGetRoom —— 永遠全量。
 * 舊伺服器會忽略未知參數而回全量（沒有 logDelta 標記），行為與 v6.219 相同。
 */
export async function oracleGetRoomDelta(
  code: string,
  since: number,
  logKnown: { len: number; h: string } | null,
): Promise<{ room: OracleRoom; logDelta?: RoomLogDelta } | null | typeof ROOM_UNCHANGED> {
  try {
    let q = `?since=${since}`;
    if (logKnown && logKnown.len > 0) q += `&logSince=${logKnown.len}&logh=${encodeURIComponent(logKnown.h)}`;
    const res = await oracleApi<{ room: OracleRoom; logDelta?: RoomLogDelta } | undefined>(
      `/api/rooms/${code.toUpperCase()}${q}`,
    );
    if (res === undefined) return ROOM_UNCHANGED;
    _noteDeltaPutSentinel(res);   // ⭐v6.270 輪詢的 GET 也算「最近一次」（哨兵消失＝伺服器撤掉 kill switch）
    return res && res.room ? res : null;
  } catch (err: unknown) {
    // ⭐⭐⭐v6.246 同 oracleGetRoom：這裡的 URL 帶 `logh=<雜湊>`／`logSince=<數字>`／`since=<版本>`，
    //   字串比對 404 的誤判率被 v6.245 的逾時放大了好幾個數量級。
    if (isOracleTimeout(err)) throw err;
    if (oracleErrorStatus(err) === 404) return null;
    throw err;
  }
}

export async function oracleUpsertRoom(
  code: string,
  data: Record<string, any>,
  expectedVersion?: number,
  /** ⭐v6.245 逃生口：建房／進場／入座／開局這類「失敗有狀態副作用」的寫入放寬逾時。 */
  opts?: { timeoutMs?: number },
): Promise<OracleUpsertResult> {
  const body: any = { data };
  if (expectedVersion !== undefined) body.expectedVersion = expectedVersion;
  // ⭐⭐⭐v6.214③ 伺服器單一時鐘的取樣點。
  //   寫入成功時伺服器會蓋 `updatedAt`（server 端自動 set，見 room-oracle.ts 檔頭），
  //   而那一刻必定落在「我送出」與「我收到」之間 ⇒ 夾得出 client↔server 的偏移量。
  //   ⚠ 只採信 `ok` 分支：`conflict` 回的 room 是**別人上一次寫入**的時戳（比現在舊），
  //     拿它當「現在」會把偏移量估得偏後。
  //   ⚠ 欄位缺席／格式不對 → noteServerTime 自己會拒收 ⇒ 從沒同步過 ⇒ createGame 不寫
  //     createdAtSrv ⇒ 行為與 v6.213 逐字相同（fail-open）。
  const _sentAt = Date.now();
  const res = await oracleApi<OracleUpsertResult>(`/api/rooms/${code.toUpperCase()}`, {
    method: 'PUT',
    body,
    // ⚠ 缺席時是 undefined ⇒ oracleApi 內的 `?? ORACLE_API_TIMEOUT_MS` 取預設 30 秒。
    timeoutMs: opts?.timeoutMs,
  });
  try {
    if (res && 'ok' in res && res.ok && res.room) {
      _noteRoomServerTime((res.room as any).updatedAt, _sentAt, Date.now());
    }
  } catch { /* 對時失敗絕不可以影響房間寫入 */ }
  return res;
}

// ⭐v6.214③ 只在偏移量大到「守衛真的會被騙」時出一次聲（v6.198 實證有 -11 秒 / -77 秒 / -4.9 小時）。
//   ⚠ 只印一次：這支每次房間寫入都會跑到，每次都印會把 console 洗掉。
let _clockWarned = false;
function _noteRoomServerTime(srvMs: unknown, sentAt: number, recvAt: number): void {
  if (!noteServerTime(srvMs, sentAt, recvAt)) return;
  if (_clockWarned) return;
  const off = getServerClockOffsetMs();
  if (off === null || Math.abs(off) < 5000) return;
  _clockWarned = true;
  console.warn(`[PTCG clock] 本機時鐘與伺服器相差 ${Math.round(off / 1000)} 秒；建局時間改用伺服器時鐘（v6.214③）`);
}

// ── ⭐⭐⭐v6.270 休閒 PUT 上行增量【階段 2：client 端】──────────────────────────
// >>> v6270-delta-put-client-core（守衛 test-v6270-delta-put-client.mjs 會把這一段抽出來實跑）
//
// 背景：休閒對戰是 client-authoritative —— 每個動作把整包房間 doc（實測 40~48KB）PUT 上去，
//   而 v6.245/v6.246 已定案「慢的是玩家上行」。v6.268 在伺服器端上線 PTCG-DELTA-PUT middleware：
//   PUT body 帶 `patchProto:1` 與 `patch:{set,del,logAppend}`＋`fullHash`＋`expectedVersion` 時，
//   伺服器以「DB 現 doc 的 client 視角」（JSON round-trip＋v1.20 同款 email 剝除）為基底套 patch、
//   canonical hash 複驗後改寫成與全量 PUT 同形的 body 交給既有核心 PUT
//   ⇒ 落庫／CAS／回應完全不變，只有上行位元組數變小。
//
// 協定要點（守衛把 v6.268 的 middleware 抽出來與這裡端到端對跑＋fuzz）：
//   ・哨兵：GET /api/rooms/:code 的 { room } 回應帶 `deltaPut:1`。**以最近一次 GET 為準**；
//     哨兵缺席（舊伺服器／kill switch 撤掉）⇒ 一律送全量，且不為此多打任何請求。
//   ・fullHash 對 `JSON.parse(JSON.stringify(newData))` 計算（與伺服器 JSON 視角一致）；
//     演算法與伺服器 `_dpCanonHash` 逐字元同款（遞迴排序鍵＋FNV-1a 雙 32bit，免疫 BSON 鍵序）。
//   ・三態：409（`deltaReason:'version'`，刻意不回 room）→ 原樣交回 oracleTx 的既有重試迴圈
//     （下一輪重 GET 重 diff）；422 `deltaReject`／400（middleware 被整個撤掉時核心 PUT 的
//     missing data）→ **當場改送全量**（同一 attempt、同一份 newData）；正常 → 核心 PUT 既有回應。
//   ・⚠ 連 3 次 422/400 ⇒ 本 session 熔斷（之後全走全量）＋ `casual-delta-fuse` 診斷指紋
//     （送出端在 game/+page.svelte 的 _casualNoteDeltaFuse，走既有 _casualDiagSend 閘）。
//   ・上限（超過任何一道＝直接送全量，絕不賭伺服器收不收）：set/del ≤256、logAppend ≤512、
//     hash 工作量伺服器 1M 字元（客端取 90 萬留餘裕）、路徑段禁 `__proto__`/`constructor`/`prototype`。
//   ・⭐ patch 比全量 body 的 60% 還大 ⇒ 直接送全量（開局／重開局這種整包重寫的情境）。
//
// ⚠⚠ email：伺服器 GET 出口把 seats[].email 剝成 null（v1.20 PTCG-ROOMS-OUT），middleware 的
//   基底也套同一條規則 ⇒ 兩端「client 視角」天生一致；成功路徑由伺服器把同 uid 的 email
//   回填後才落庫（與全量路徑的 _roomsPutKeepEmailMw 同款規則）。
// ⚠ 基底快照必須在 oracleTx 跑 `fn` **之前**取（fn 可能就地改動 room 物件）；
//   快照本身就是一次 JSON round-trip ⇒ 與伺服器基底的 JSON 視角一致。
// ⚠ 任何不確定（結構不對／超限／hash 算不出來）一律 fail-open 成**全量** ——
//   全量是今天已在線上跑的路徑，絕不會比 BASE 更糟。
// ⚠ 診斷 bodyBytes：實際送出的 PUT body 位元組數（UTF-8），patch 與 full 分開的滾動窗，
//   由 game/+page.svelte 的休閒診斷 payload 讀出（deltaPutDiag）；哨兵缺席時**完全不量**
//   （不多做任何序列化）⇒ 舊伺服器路徑的 CPU 成本與 BASE 相同。
export const DELTA_PUT_MAX_SET = 256;
export const DELTA_PUT_MAX_DEL = 256;
export const DELTA_PUT_MAX_LOGAPPEND = 512;
export const DELTA_PUT_MAX_HASH_CHARS = 900000;   // 伺服器上限 1M 字元的 9 折（超過直接送全量）
export const DELTA_PUT_FULL_RATIO = 0.6;          // ⭐ patch > 全量的 60% ⇒ 送全量
export const DELTA_PUT_FUSE_LIMIT = 3;            // ⚠ 連 3 次 deltaReject ⇒ 本 session 熔斷

let _dpSentinel = false;        // 最近一次 GET 的 {room} 回應有沒有 deltaPut:1
let _dpFused = false;           // 本 session 熔斷（之後全走全量；重整頁面才重置）
let _dpRejectStreak = 0;        // 連續 422/400 計數（成功送出 patch 就歸零；409 不動它）
let _dpRejects = 0;             // 累計 422/400 次數（診斷用）
let _dpLastRejectReason: string | null = null;   // 最近一次拒收原因（'hash'/'bad-patch'/'http-400'…）
const _DP_BYTES_WIN = 50;       // bodyBytes 滾動窗上限
const _dpBytesPatch: number[] = [];
const _dpBytesFull: number[] = [];
let _dpEncoder: TextEncoder | null = null;

/** UTF-8 位元組數（nginx 的 request_length 量的就是位元組，不是 UTF-16 字元數）。 */
function _dpUtf8Len(s: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') {
      if (!_dpEncoder) _dpEncoder = new TextEncoder();
      return _dpEncoder.encode(s).length;
    }
  } catch { /* fallthrough 到手算 */ }
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }   // surrogate pair
    else n += 3;
  }
  return n;
}
function _dpNoteBytes(kind: 'patch' | 'full', bytes: number): void {
  const a = kind === 'patch' ? _dpBytesPatch : _dpBytesFull;
  a.push(bytes);
  if (a.length > _DP_BYTES_WIN) a.shift();
}
function _dpStat(a: readonly number[]): { n: number; p50: number; p95: number; max: number } | null {
  if (a.length === 0) return null;
  const s = a.slice().sort((x, y) => x - y);
  return { n: s.length, p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
}

/** 哨兵記錄：只認「{room} 形狀」的回應（404／204／列表都不動旗標）。 */
function _noteDeltaPutSentinel(body: unknown): void {
  try {
    const b = body as { room?: unknown; deltaPut?: unknown } | null | undefined;
    if (b && typeof b === 'object' && b.room && typeof b.room === 'object') {
      _dpSentinel = (b as { deltaPut?: unknown }).deltaPut === 1;
    }
  } catch { /* 判定失敗＝維持現值（下一次 GET 會再校正） */ }
}

/** 診斷讀出口（game/+page.svelte 的休閒 payload 用；純讀取，零副作用）。 */
export function deltaPutDiag(): { fused: boolean; rejects: number; lastReason: string | null;
  bytes: { patch: { n: number; p50: number; p95: number; max: number } | null;
           full: { n: number; p50: number; p95: number; max: number } | null } | null } {
  const p = _dpStat(_dpBytesPatch), f = _dpStat(_dpBytesFull);
  return { fused: _dpFused, rejects: _dpRejects, lastReason: _dpLastRejectReason,
    bytes: (p || f) ? { patch: p, full: f } : null };
}
/** 熔斷了嗎（casual-delta-fuse 指紋的判準；純讀取）。 */
export function deltaPutFuseTripped(): boolean { return _dpFused; }

/**
 * 差分基底快照：哨兵在、且沒熔斷 ⇒ 回 room 的 JSON round-trip 深拷貝；否則回 null。
 * ⚠ 回 null 時 oracleTx 走 oracleUpsertRoom ⇒ 請求與 BASE 逐字相同，也不多做任何序列化。
 */
export function deltaPutBase(room: Record<string, unknown>): Record<string, unknown> | null {
  if (!_dpSentinel || _dpFused) return null;
  try { return JSON.parse(JSON.stringify(room)) as Record<string, unknown>; } catch { return null; }
}

const _DP_BAD_SEG = (s: string): boolean => (typeof s !== 'string' || s === '' || s.length > 256
  || s === '__proto__' || s === 'constructor' || s === 'prototype');

/**
 * canonical hash —— 與伺服器 `_dpCanonHash`（server_admin_patch.js v1.29）**逐字元同演算法**：
 * 物件鍵遞迴排序後才餵進 FNV-1a 雙 32bit；陣列保序；undefined 欄位跳過（＝JSON 視角）。
 * 超過工作量／深度上限 -> throw（呼叫端接住＝改送全量）。
 */
export function deltaPutCanonHash(v: unknown): string {
  let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0, n = 0;
  const mix = (s: string): void => {
    n += s.length;
    if (n > 1000000) throw new Error('dp-hash-too-big');
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
    }
  };
  const ser = (x: unknown, d: number): void => {
    if (d > 32) throw new Error('dp-hash-too-deep');
    if (x === null || x === undefined) { mix('n'); return; }
    const t = typeof x;
    if (t === 'boolean') { mix(x ? 't' : 'f'); return; }
    if (t === 'number') { mix(Number.isFinite(x as number) ? 'd' + String(x) : 'n'); return; }
    if (t === 'string') { mix('s' + JSON.stringify(x)); return; }
    if (Array.isArray(x)) { mix('['); for (const it of x) { ser(it, d + 1); mix(','); } mix(']'); return; }
    if (t === 'object') {
      const o = x as Record<string, unknown>;
      const ks = Object.keys(o).sort();
      mix('{');
      for (const k of ks) {
        if (o[k] === undefined) continue;   // JSON.stringify 會丟掉 undefined 欄位 => 兩端視角一致
        mix(JSON.stringify(k) + ':'); ser(o[k], d + 1); mix(',');
      }
      mix('}');
      return;
    }
    mix('n');   // function/symbol 等不該出現的型別 -> 當 null（JSON 視角）
  };
  ser(v, 0);
  return h1.toString(16) + '-' + h2.toString(16);
}

const _dpIsPlainObj = (o: unknown): o is Record<string, unknown> =>
  !!o && typeof o === 'object' && !Array.isArray(o);

/** 深比較（兩邊都是 JSON round-trip 後的資料 ⇒ 沒有 undefined／函式；鍵序無關）。 */
function _dpEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aa = Array.isArray(a), ab = Array.isArray(b);
  if (aa !== ab) return false;
  if (aa) {
    const x = a as unknown[], y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) { if (!_dpEq(x[i], y[i])) return false; }
    return true;
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!_dpEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export type RoomPatch = { set: Record<string, unknown>; del: string[]; logAppend?: unknown[] };

/**
 * 差分：兩層欄位（top 或 gameState.sub）＋ gameState.log 前綴相同時只送 logAppend。
 * 回 null ＝「不可增量」（鍵不合法／超限），呼叫端送全量。
 * ⚠ 語義鏡射伺服器 `_dpApplyPatch`：del 先、set 後、logAppend 最後；
 *   本函式產出的 patch 套回 base 必得 next（守衛以 fuzz 10,000 次對跑證明）。
 */
export function buildRoomPatch(base: unknown, next: unknown): RoomPatch | null {
  if (!_dpIsPlainObj(base) || !_dpIsPlainObj(next)) return null;
  const set: Record<string, unknown> = {};
  const del: string[] = [];
  let logAppend: unknown[] | null = null;
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  for (const k of keys) {
    // 鍵名帶 '.' 會被伺服器 splitPath 切開、指到別的位置 ⇒ 一律退回全量（房 doc 正常不會有）
    if (_DP_BAD_SEG(k) || k.indexOf('.') >= 0) return null;
    if (!(k in next)) { if (k in base) del.push(k); continue; }
    if (!(k in base)) { set[k] = next[k]; continue; }
    if (k === 'gameState' && _dpIsPlainObj(base[k]) && _dpIsPlainObj(next[k])) {
      const bs = base[k] as Record<string, unknown>, ns = next[k] as Record<string, unknown>;
      const sub = new Set([...Object.keys(bs), ...Object.keys(ns)]);
      for (const k2 of sub) {
        if (_DP_BAD_SEG(k2) || k2.indexOf('.') >= 0) return null;
        const p = 'gameState.' + k2;
        if (!(k2 in ns)) { if (k2 in bs) del.push(p); continue; }
        if (!(k2 in bs)) { set[p] = ns[k2]; continue; }
        if (k2 === 'log' && Array.isArray(bs.log) && Array.isArray(ns.log)
            && (ns.log as unknown[]).length >= (bs.log as unknown[]).length) {
          const bl = bs.log as unknown[], nl = ns.log as unknown[];
          let prefix = true;
          for (let i = 0; i < bl.length; i++) { if (!_dpEq(bl[i], nl[i])) { prefix = false; break; } }
          if (prefix) {
            if (nl.length > bl.length) logAppend = nl.slice(bl.length);
            continue;   // 等長且前綴同＝沒變；變長＝只送 append
          }
          // 前綴不同（悔棋型整包重寫）→ 掉到下面的整欄 set
        }
        if (!_dpEq(bs[k2], ns[k2])) set[p] = ns[k2];
      }
      continue;
    }
    if (!_dpEq(base[k], next[k])) set[k] = next[k];
  }
  if (Object.keys(set).length > DELTA_PUT_MAX_SET || del.length > DELTA_PUT_MAX_DEL) return null;
  if (logAppend && logAppend.length > DELTA_PUT_MAX_LOGAPPEND) return null;
  const patch: RoomPatch = { set, del };
  if (logAppend && logAppend.length > 0) patch.logAppend = logAppend;
  return patch;
}

/** 422/400 的拒收原因（從錯誤訊息裡撈伺服器的 deltaReason；撈不到記狀態碼）。 */
function _dpRejectReasonOf(err: unknown, status: number): string {
  try {
    const m = /"deltaReason"\s*:\s*"([A-Za-z0-9_-]{1,32})"/.exec(String((err as Error | null)?.message || ''));
    if (m) return m[1];
  } catch { /* ignore */ }
  return 'http-' + status;
}

/**
 * ⭐⭐⭐ oracleTx 專用的房間寫入：基底在 ⇒ 試著送 patch；否則行為與 oracleUpsertRoom 逐字相同。
 *
 * 退全量的四條路（守衛逐條有正對照）：
 *   ①`base` 為 null（哨兵缺席／熔斷）→ 直接 delegate，不多做任何序列化；
 *   ②diff 不可增量／超限／hash 算不出來 → 全量；
 *   ③patch body > 全量 body 的 60% → 全量（開局情境）；
 *   ④送出後收到 422/400 → 當場改送全量（連 3 次熔斷）。
 * 409（版本不符）不在此處理：原樣回給 oracleTx 的既有重試迴圈（下一輪重 GET 重 diff）。
 */
export async function oracleUpsertRoomDelta(
  code: string,
  data: Record<string, any>,
  expectedVersion: number | undefined,
  base: Record<string, unknown> | null,
  opts?: { timeoutMs?: number },
): Promise<OracleUpsertResult> {
  // ①基底缺席／版本不明 ⇒ 與 BASE 逐字相同的全量路徑（伺服器 expectedVersion 要 ≥1 的整數）
  if (!base || expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return oracleUpsertRoom(code, data, expectedVersion, opts);
  }
  let fullStr: string, next: Record<string, unknown>;
  try {
    fullStr = JSON.stringify(data);
    next = JSON.parse(fullStr) as Record<string, unknown>;   // ⭐ fullHash 對 JSON round-trip 後的 newData 計算
  } catch {
    return oracleUpsertRoom(code, data, expectedVersion, opts);
  }
  // 全量 body ＝ `{"data":<fullStr>,"expectedVersion":<ev>}` ⇒ 長度可以直接算，不必再組一次字串
  const fullBodyLen = fullStr.length + 28 + String(expectedVersion).length;
  const fullBodyBytes = () => _dpUtf8Len(fullStr) + 28 + String(expectedVersion).length;   // 外層 wrapper 全 ASCII
  let body: { patchProto: 1; patch: RoomPatch; fullHash: string; expectedVersion: number } | null = null;
  let patchStr: string | null = null;
  try {
    if (fullStr.length <= DELTA_PUT_MAX_HASH_CHARS) {   // ②超過伺服器 hash 工作量 ⇒ 必被拒 ⇒ 不試
      const patch = buildRoomPatch(base, next);
      if (patch) {
        body = { patchProto: 1, patch, fullHash: deltaPutCanonHash(next), expectedVersion };
        patchStr = JSON.stringify(body);
        // ③⭐ 60% 門檻：patch 沒省到夠多就直接送全量（省掉伺服器 rebuild+hash 的白工）
        if (patchStr.length > fullBodyLen * DELTA_PUT_FULL_RATIO) { body = null; patchStr = null; }
      }
    }
  } catch { body = null; patchStr = null; }
  if (body === null || patchStr === null) {
    _dpNoteBytes('full', fullBodyBytes());
    return oracleUpsertRoom(code, data, expectedVersion, opts);
  }
  _dpNoteBytes('patch', _dpUtf8Len(patchStr));
  const _sentAt = Date.now();
  try {
    const res = await oracleApi<OracleUpsertResult>(`/api/rooms/${code.toUpperCase()}`, {
      method: 'PUT',
      body,
      timeoutMs: opts?.timeoutMs,   // 缺席 ⇒ oracleApi 取預設 30 秒（patch 很小，大小預算不會放寬）
    });
    if (res && 'ok' in res && res.ok) {
      _dpRejectStreak = 0;   // 成功送達 ⇒ 連續拒收歸零（「連 3 次」是指連續）
      try { if (res.room) _noteRoomServerTime((res.room as { updatedAt?: unknown }).updatedAt, _sentAt, Date.now()); }
      catch { /* 對時失敗絕不可以影響房間寫入 */ }
    }
    // 409：{conflict, currentVersion, deltaReject, deltaReason:'version'}（沒有 room）——
    //   oracleTx 只看 'ok' in result ⇒ 走既有 conflict 重試（下一輪重 GET 重 diff），不在這裡重送。
    return res;
  } catch (err) {
    const st = oracleErrorStatus(err);
    if (st === 422 || st === 400) {
      // ④伺服器拒收（hash 不符／格式錯／停用／middleware 被撤掉）⇒ 當場改送全量（同一 attempt）
      _dpRejects++;
      _dpRejectStreak++;
      _dpLastRejectReason = _dpRejectReasonOf(err, st);
      if (_dpRejectStreak >= DELTA_PUT_FUSE_LIMIT) _dpFused = true;   // ⚠ 本 session 之後全走全量
      _dpNoteBytes('full', fullBodyBytes());
      return oracleUpsertRoom(code, data, expectedVersion, opts);
    }
    throw err;   // 逾時／網路錯誤 ⇒ 原樣拋回（oracleTx 的既有逾時語義一個字不變）
  }
}
// <<< v6270-delta-put-client-core

export async function oracleDeleteRoom(code: string): Promise<void> {
  await oracleApi(`/api/rooms/${code.toUpperCase()}`, { method: 'DELETE' });
}

export async function oracleListRooms(status?: string): Promise<OracleRoom[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const { rooms } = await oracleApi<{ rooms: OracleRoom[] }>(`/api/rooms${q}`);
  return rooms;
}

// ⭐v6.217①② 大廳列表「合併+增量」輪詢的三態哨兵。
// - ROOMS_UNCHANGED:伺服器回 204(內容沒變)——caller 沿用上一包原始資料重跑過濾即可。
// - ROOMS_COMBINED_UNSUPPORTED:伺服器不支援合併協定——**必須退回兩支舊輪詢**。
//   ⚠ 這一態的判據是「200 但回應沒有 combined:true」:舊伺服器把 'lobby,playing' 當
//   字面值查會回 {rooms:[]},若把它當真,大廳會永遠顯示「目前沒有公開房間」(v6.177 的
//   「請求失敗偽裝成權威空資料」同型事故,只是這次是「協定不支援」偽裝成空資料)。
export const ROOMS_UNCHANGED = Symbol('rooms-unchanged');
export const ROOMS_COMBINED_UNSUPPORTED = Symbol('rooms-combined-unsupported');

/**
 * v6.217①② 一發拿完大廳需要的 lobby+playing 兩組房間(伺服器 middleware v1.17)。
 * @param h 上一發伺服器給的內容 digest;內容沒變時伺服器回 204(零 body)。
 * 回傳:{ rooms, h } | ROOMS_UNCHANGED(204) | ROOMS_COMBINED_UNSUPPORTED(舊伺服器)。
 * ⚠ 網路錯誤一律往上拋(caller 依 v6.177 紀律保留畫面既有資料),不得在這裡吞掉。
 */
export async function oracleListRoomsCombined(
  h: string | null,
): Promise<{ rooms: OracleRoom[]; h: string } | typeof ROOMS_UNCHANGED | typeof ROOMS_COMBINED_UNSUPPORTED> {
  const q = `?status=${encodeURIComponent('lobby,playing')}${h ? `&h=${encodeURIComponent(h)}` : ''}`;
  const res = await oracleApi<{ rooms: OracleRoom[]; combined?: boolean; h?: string } | undefined>(`/api/rooms${q}`);
  if (res === undefined) return ROOMS_UNCHANGED;                       // 204:內容沒變
  if (!res || res.combined !== true) return ROOMS_COMBINED_UNSUPPORTED; // 舊伺服器/middleware 沒生效
  return { rooms: Array.isArray(res.rooms) ? res.rooms : [], h: String(res.h ?? '') };
}

/**
 * v6.115 取得「對戰中房間」的牌組原型名稱（大廳標籤用）。
 *
 * ⭐ 伺服器只回名稱字串，**牌表一張都不會出來**（分類在後端做，規則庫是 admin 私有的）。
 * 回傳語義：字串（含 '未分類'）＝ 已比對出結果；null 或該 roomId 不在回應裡 ＝ 還不知道
 * （尚未開打／規則庫沒載入／房間不存在）。前端要靠這個分辨，不要把 null 當成「未分類」。
 */
export async function oracleRoomArchetypes(
  roomIds: string[],
): Promise<Record<string, { p1: string | null; p2: string | null }>> {
  const ids = roomIds.map((s) => String(s || '').toUpperCase()).filter(Boolean).slice(0, 40);
  if (!ids.length) return {};
  const { rooms } = await oracleApi<{ rooms: Record<string, { p1: string | null; p2: string | null }> }>(
    `/api/rooms-archetypes?ids=${encodeURIComponent(ids.join(','))}`,
  );
  return rooms || {};
}

/**
 * ⭐⭐⭐v6.212 輪詢版本閘（純函式，守衛 scripts/test-v6212-selfheal-direction.mjs）。
 *
 * 舊寫法是 `room._version !== lastVersion` —— 只要「不一樣」就遞送，
 * 所以**比較舊的版本照樣會被遞送給收端**（伺服器端多實例／重試／慢回應都做得出這件事），
 * 收端再依 stale 守衛決定要不要收；但只要有任何一條路徑繞過守衛（v5.587 的強制自癒
 * 就是刻意繞過的），舊盤面就會直接蓋掉新盤面 ＝ 玩家看到的「跳回上一手」。
 * ⇒ 閘改成**單調**：同一個房間實體只遞送嚴格較新的版本。
 *
 * ⚠ 房間可能被刪掉後用同一個房號重建，那時伺服器的 _version 會從 1 重來
 *   （server_admin_patch.js 建房時寫死 _version: 1）。若只比大小，重建後的房間
 *   會被永遠擋掉、玩家再也收不到任何更新。⇒ 先用 createdAt 認「是不是同一個房間實體」，
 *   不同實體一律遞送並重設版本基準。
 */
export function shouldDeliverRoomPoll(
  incoming: { _version: number; createdAt?: number },
  last: { version: number; createdAt: number },
): boolean {
  if ((incoming.createdAt ?? 0) !== last.createdAt) return true;   // 不同房間實體（含第一次）
  return incoming._version > last.version;                          // 同一房間：只收嚴格較新的
}

/**
 * Polling subscribe（取代 firestore onSnapshot）。
 * 每 intervalMs 拉一次 GET /api/rooms/:code，_version 變了 callback。
 * 回傳 unsubscribe function。
 */
export function oraclePollRoom(
  code: string,
  callback: (room: OracleRoom | null) => void,
  intervalMs: number | (() => number) = 800,
): () => void {
  let lastVersion = -1;
  let lastCreatedAt = -1;   // v6.212：房間實體識別（同房號被重建時 _version 會從 1 重來）
  // v6.220：上一發伺服器回應的完整 log（增量重組鏈的基準）。⚠ 輪詢層私有狀態，與 UI／
  //   引擎狀態無關 —— 樂觀更新在本地加的 log 不會進來，重組永遠以「伺服器回應鏈」為準。
  //   雜湊每一發重算（不快取）：若有任何程式就地改了這些 entry，送出的雜湊會與伺服器
  //   對不上 → 伺服器回全量 → 鏈重置，絕不會重組出錯的 log。
  let lastLog: unknown[] | null = null;
  let lastExists = true;
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (!alive) return;
    try {
      // v5.610: 帶上已知版本；server 版本沒變回 204 → ROOM_UNCHANGED，直接略過省流量
      // v6.220: 第二發起另帶「已有 log 的則數＋鏈雜湊」，伺服器只在前綴逐字相同時回增量；
      //   重組驗不過（含端到端 fh 複驗）就立刻改抓一次全量 —— 任何不確定一律退回全量。
      let room: OracleRoom | null | typeof ROOM_UNCHANGED;
      if (lastVersion >= 0) {
        const rd = await oracleGetRoomDelta(
          code,
          lastVersion,
          lastLog && lastLog.length > 0 ? { len: lastLog.length, h: logChainHash(lastLog, lastLog.length) } : null,
        );
        if (rd === ROOM_UNCHANGED || rd === null) {
          room = rd;
        } else {
          const merged = mergePolledRoomLog(lastLog, rd.room, rd.logDelta ?? null);
          if (merged.ok) {
            room = merged.room;
            lastLog = merged.nextLog;
          } else {
            // 帶了增量標記卻重組不出可信結果（理論上只在極端競態出現）→ 立刻全量重抓
            room = await oracleGetRoom(code);
            const gs = room ? (room as { gameState?: { log?: unknown[] } | null }).gameState : null;
            lastLog = gs && Array.isArray(gs.log) ? gs.log.slice() : null;
          }
        }
      } else {
        room = await oracleGetRoom(code);
        const gs0 = room ? (room as { gameState?: { log?: unknown[] } | null }).gameState : null;
        lastLog = gs0 && Array.isArray(gs0.log) ? gs0.log.slice() : null;
      }
      // ⭐⭐⭐v6.197 await 之後一定要再問一次 alive：unsubscribe() 只擋得住「還沒排出去的
      //   下一發」，擋不住「已經在路上的這一發」。少了這一行，玩家按「離開」之後最後一發
      //   回應仍會 callback ⇒ handleRoomUpdate 把 roomData/game/mySeatIdx 全部填回去
      //   ⇒ 人已經離開了卻被彈回對戰頁（而且身分欄位是半清狀態）。
      if (!alive) return;
      if (room === ROOM_UNCHANGED) {
        // 版本未變，什麼都不做（等同舊版收到同版本時忽略）
      } else if (room) {
        // ⭐v6.212 單調版本閘：較舊的 _version 不再遞送（見 shouldDeliverRoomPoll）。
        if (shouldDeliverRoomPoll(room, { version: lastVersion, createdAt: lastCreatedAt })) {
          lastVersion = room._version;
          lastCreatedAt = room.createdAt ?? 0;
          lastExists = true;
          callback(room);
        }
      } else if (lastExists) {
        lastExists = false;
        lastVersion = -1;
        lastCreatedAt = -1;
        lastLog = null;   // v6.220：房間不存在了 → 增量鏈重置
        callback(null);
      }
    } catch (err) {
      console.warn('[oraclePollRoom]', code, err);
    }
    // v5.347：intervalMs 可為函式 → 每次重排前求值（支援自適應輪詢）
    if (alive) {
      const _d = typeof intervalMs === 'function' ? intervalMs() : intervalMs;
      timer = setTimeout(tick, _d);
    }
  };

  tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}

// ── Messages ──────────────────────────────────────────────────────────

export type OracleMessage = {
  _id?: string;
  roomCode: string;
  uid: string;
  text: string;
  kind: string;
  createdAt: number;
};

export async function oracleSendMessage(
  code: string,
  text: string,
  kind: string = 'chat',
): Promise<OracleMessage> {
  const { message } = await oracleApi<{ message: OracleMessage }>(
    `/api/rooms/${code.toUpperCase()}/messages`,
    { method: 'POST', body: { text, kind } },
  );
  return message;
}

// v6.216②:帶 since 的增量輪詢。伺服器對「沒有比 since 新的訊息」回 204(oracleApi 回
//   undefined,與 v5.610 房間輪詢同一條路)→ 本函式回 null 表「沒有新訊息」。
//   不帶 since 的呼叫端行為完全不變(伺服器 fail-open 一律回全量,絕不 204)——overload
//   讓既有 caller 的回傳型別維持 OracleMessage[],比照 oracleGetRoom 的 since overload。
export function oracleListMessages(code: string, limit?: number): Promise<OracleMessage[]>;
export function oracleListMessages(code: string, limit: number, since: number): Promise<OracleMessage[] | null>;
export async function oracleListMessages(code: string, limit: number = 50, since?: number): Promise<OracleMessage[] | null> {
  const q = since !== undefined && since > 0 ? `&since=${since}` : '';
  const res = await oracleApi<{ messages: OracleMessage[] } | undefined>(
    `/api/rooms/${code.toUpperCase()}/messages?limit=${limit}${q}`,
  );
  if (res === undefined) return null; // 204 = 沒有新訊息（只有帶 since 時可能發生）
  return res.messages;
}

/** Polling subscribe messages — 新訊息 callback */
export function oraclePollMessages(
  code: string,
  callback: (msg: OracleMessage) => void,
  intervalMs: number = 1000,
): () => void {
  let lastTime = Date.now();
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (!alive) return;
    try {
      const messages = await oracleListMessages(code, 50);
      for (const msg of messages) {
        if (msg.createdAt > lastTime) {
          lastTime = msg.createdAt;
          callback(msg);
        }
      }
    } catch (err) {
      console.warn('[oraclePollMessages]', code, err);
    }
    if (alive) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}

// ── Backend mode flag (給 caller 簡單判斷) ─────────────────────────────

export const ORACLE_MODE: boolean =
  ((import.meta as any).env?.VITE_BACKEND_MODE as string) === 'oracle';

export function getApiUrl(): string {
  return API_URL;
}
