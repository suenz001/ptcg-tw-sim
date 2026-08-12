/**
 * ⭐⭐⭐v6.177「重新抓取／抓取失敗時，不清空已經顯示過的資料」的**唯一**中央述詞。
 *
 * 事故背景（玩家回報）：賽事進行中，「📊 瑞士制排名／📋 賽程表」偶爾整區消失，
 * 要過好幾秒才回來。真因不是渲染、也不是伺服器沒資料，而是**前端在抓取失敗時
 * 把畫面上那份好資料指回空值**：
 *   - `tBracketLoad()` 的 `tBrackets = rs.filter(...)` —— 任一支 `/bracket` 失敗
 *     （`.catch(() => null)`）或伺服器回 `{event:null}`，該場賽程就被 filter 掉；
 *     兩場都失敗就整個 `[]` ⇒ `{#each tBrackets}` 一筆都不畫 ⇒ 整區消失。
 *   - 空白期還被 v6.161 的大廳降頻放大：`/bracket` 的節奏是 `/event` 的 3 倍，
 *     出局／本輪已打完的人是 27 秒、背景分頁 63 秒才會再抓一次。
 *
 * ⚠ 這支刻意**只做一件事**：決定「這一發回應該不該覆寫畫面上的資料」。
 *   它不碰網路、不碰計時器、不碰 UI ——- 這樣才能在守衛裡把它真的跑起來求值，
 *   而不是只驗字串存在（本專案反覆踩過「斷言有呼叫某函式 ≠ 那件事發生了」）。
 *
 * ⚠ 約定：呼叫端必須把「這一發不可信」統一表達成 `null`／`undefined`
 *   （請求失敗、逾時、回應形狀不對都算），**不要**自己塞一個空陣列進來——
 *   空陣列在語義上是「伺服器權威地說沒有資料」，那是要清空的。
 */

/** 採納結果。`stale === true` 代表這一份是沿用上一次的好資料（畫面該掛「更新中」輕量提示）。 */
export interface KeepResult<T> {
  data: T;
  stale: boolean;
}

/**
 * 單一物件／整份列表：新的可信就採納，不可信就沿用上一份好資料。
 *
 * @param prev 目前畫面上的資料（可能本身就是上一份好資料）
 * @param next 這一發解析出來的資料；`null`/`undefined` = 這一發不可信
 */
export function adoptOrKeep<T>(prev: T, next: T | null | undefined): KeepResult<T> {
  if (next === null || next === undefined) return { data: prev, stale: true };
  return { data: next, stale: false };
}

/** 逐 key 合併用的一筆輸入：`value` 為 `null`/`undefined` 代表這一筆抓失敗。 */
export interface KeyedIncoming<T> {
  key: string;
  value: T | null | undefined;
}

/**
 * 逐 key 合併：多個獨立請求（例如官方賽＋社群賽各抓一次 `/bracket`）之中，
 * 成功的用新的、失敗的沿用上一份好的、兩者都沒有才略過。
 *
 * ⚠ **順序與去留一律以 `incoming` 為準**：`prev` 裡有、`incoming` 裡沒有的 key
 *   代表那場賽事已經不在清單上（真的結束／被刪），必須讓它消失，
 *   否則「保留舊資料」會變成「永遠留著一場不存在的賽事」。
 *
 * @returns `list` 合併後的清單；`stale` 是否有任何一筆是沿用舊的
 */
export function mergeKeyedOrKeep<T>(
  prev: readonly T[],
  keyOf: (x: T) => string,
  incoming: readonly KeyedIncoming<T>[],
): { list: T[]; stale: boolean } {
  const prevByKey = new Map<string, T>();
  for (const p of prev ?? []) {
    if (p === null || p === undefined) continue;
    let k: string;
    try { k = keyOf(p); } catch { continue; }
    if (typeof k === 'string' && k !== '' && !prevByKey.has(k)) prevByKey.set(k, p);
  }
  const list: T[] = [];
  let stale = false;
  for (const it of incoming ?? []) {
    if (!it) continue;
    if (it.value !== null && it.value !== undefined) { list.push(it.value); continue; }
    stale = true;                                   // 這一筆抓失敗
    const old = prevByKey.get(it.key);
    if (old !== undefined) list.push(old);           // 有舊的就留著（不清空）
    // 沒有舊的 ⇒ 真的是第一次載入就失敗，略過；由呼叫端的空狀態負責顯示「載入中」
  }
  return { list, stale };
}
