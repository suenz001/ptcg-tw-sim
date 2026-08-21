// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐⭐v6.214【③】伺服器單一時鐘（leaf 模組）
//
// ── 這在修什麼 ────────────────────────────────────────────────────────────
// `engine.ts createGame` 的 `createdAt: Date.now()` 是**建局那一端瀏覽器**的時鐘
// （createGame 在 client 跑），而跨局守衛（sync-guards 的 shouldSkipStalePush /
// resolveRoomUpdate）拿兩局的 createdAt 比大小來決定誰新誰舊。
// v6.198 實證線上玩家的時鐘偏差有 **-11 秒 / -77 秒 / -4.9 小時** ⇒ 兩局由不同玩家建立時，
// 比較結果可能整個反向：舊局騙過守衛，或新局被當成殘留舊局擋掉。
//
// ── 做法 ──────────────────────────────────────────────────────────────────
// 用「伺服器已經回給我們的時戳」推一個 client↔server 偏移量（NTP 的最簡版）：
//   收到一筆伺服器時戳 `srvMs`，而我們知道請求是在 `sentAt` 送出、`recvAt` 收到，
//   伺服器蓋章的那一刻一定落在兩者之間 ⇒ offset ≈ srvMs − (sentAt + recvAt) / 2，
//   誤差上界是 RTT/2。RTT 是幾百毫秒的量級，而我們要對抗的偏差是 11 秒～4.9 小時，
//   兩者差三個數量級以上 ⇒ 這個精度**遠遠夠用**。
//
// ⚠⚠ 這支是 **leaf**：除了型別以外**零 import**（比照 v6.213 的 stage2-index.ts）。
//   engine.ts 會 import 它，而 engine.ts 幾乎被所有東西 import ——
//   一旦這裡反向 import 任何遊戲模組，就會是 v6.078 那種「模組層級 const 在循環 import 下 TDZ」
//   的 runtime 炸彈。**請不要在本檔加任何 import。**
//
// ⚠ 沒有同步過（本機對戰／vs AI／單元測試／伺服器端 bundle）時 `serverNowOrNull()` 回 `null`，
//   呼叫端一律退回原本的 `Date.now()` ⇒ 行為與 v6.213 逐字相同。
// ─────────────────────────────────────────────────────────────────────────────

/** 一筆可信的偏移量樣本。`rtt` 越小代表夾得越緊、越可信。 */
interface ClockSample { offsetMs: number; rttMs: number; }

/** RTT 超過這個值的樣本一律丟棄 —— 夾不緊的樣本只會把偏移量估歪。 */
const MAX_TRUSTED_RTT_MS = 10_000;
/** 合理的 epoch 毫秒下界（2001-09-09）。比這小的一定不是 epoch ms（例如 performance.now()）。 */
const MIN_PLAUSIBLE_EPOCH_MS = 1_000_000_000_000;

let _best: ClockSample | null = null;

/**
 * 收下一筆「伺服器蓋章的 epoch 毫秒」。
 *
 * @param srvMs   伺服器回應裡的時戳（例：`/api/rooms` PUT 回來的 `room.updatedAt`、
 *                錦標賽 `/state` 的 `serverNow`）。**必須是伺服器蓋的**，不可以是 client 自己算的。
 * @param sentAt  送出請求前的 `Date.now()`
 * @param recvAt  收到回應後的 `Date.now()`
 * @returns 這一筆有沒有被採信（測試與診斷用）
 *
 * ⚠ 只保留 **RTT 最小** 的那一筆（不是最後一筆、也不是平均）：
 *   平均會被一兩發塞車樣本整個拉歪，而最小 RTT 那筆的誤差上界最小。
 */
export function noteServerTime(srvMs: unknown, sentAt: number, recvAt: number): boolean {
  if (typeof srvMs !== 'number' || !isFinite(srvMs) || srvMs < MIN_PLAUSIBLE_EPOCH_MS) return false;
  if (!isFinite(sentAt) || !isFinite(recvAt)) return false;
  const rttMs = recvAt - sentAt;
  if (!(rttMs >= 0) || rttMs > MAX_TRUSTED_RTT_MS) return false;
  const offsetMs = srvMs - (sentAt + recvAt) / 2;
  if (!isFinite(offsetMs)) return false;
  if (_best === null || rttMs < _best.rttMs) _best = { offsetMs, rttMs };
  return true;
}

/** 目前估到的偏移量（毫秒；正值＝伺服器時鐘比本機快）。從沒同步過回 `null`。 */
export function getServerClockOffsetMs(): number | null {
  return _best === null ? null : _best.offsetMs;
}

/** 目前這一刻的**伺服器時鐘** epoch 毫秒。從沒同步過回 `null`（呼叫端自己決定要不要退回 Date.now()）。 */
export function serverNowOrNull(): number | null {
  return _best === null ? null : Math.round(Date.now() + _best.offsetMs);
}

/** 診斷／守衛用：目前採信樣本的 RTT。 */
export function getServerClockRttMs(): number | null {
  return _best === null ? null : _best.rttMs;
}

/** ⚠ 只給測試用：清掉已採信的樣本。正式程式碼不要呼叫。 */
export function __resetServerClock(): void {
  _best = null;
}
