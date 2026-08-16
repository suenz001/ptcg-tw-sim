/**
 * ⭐v6.199 錦標賽「📊 排行榜」顯示筆數的**唯一**中央來源。
 *
 * 背景：排行榜五個榜（冠軍／勝場／8 強／決賽／社群主辦）長年固定只看得到前 5 名，
 * 而截斷點其實在**伺服器**（/api/tournament/leaderboard 的 slice(0, 5)）——
 * 只在前端加下拉不會有任何效果，兩端必須一起改。
 *
 * ⚠ 這一版的做法是「伺服器一次送上限 LB_TOP_MAX 筆，前端只做本地切片」：
 *   ・切換筆數 **不發任何請求** ⇒ 不會清空畫面、不會閃、與 v6.177 的 stale-keep 完全無關；
 *   ・伺服器的 60 秒快取只存一份（上限那份），不管有幾種筆數都只掃一次 TARCHIVE。
 *
 * ⚠ 這支刻意只做純計算 + localStorage 兩件事、不碰 UI，
 *   守衛才能把它**真的跑起來求值**（本專案反覆踩過「斷言字串存在 ≠ 那件事發生了」）。
 */

/** 下拉可選的筆數。⚠ 級距與 LB_TOP_MAX 必須一致：最大的那一項就是伺服器送來的上限。 */
export const LB_TOP_OPTIONS: readonly number[] = [5, 10, 20];

/** 預設筆數 = 這一版之前的既有行為（沒動過下拉的人版面完全不變）。 */
export const LB_TOP_DEFAULT = 5;

/** 伺服器單次回傳的上限（= 下拉最大值）。前端固定用這個值去要資料。 */
export const LB_TOP_MAX = 20;

/** localStorage key。 */
export const LB_TOP_KEY = 'ptcg_tourn_lb_top';

/** 把任意輸入正規化成合法筆數；不在選項內（含 NaN／篡改過的 localStorage）一律退回預設。 */
export function normalizeLbTop(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n)) return LB_TOP_DEFAULT;
  const i = Math.floor(n);
  return LB_TOP_OPTIONS.indexOf(i) >= 0 ? i : LB_TOP_DEFAULT;
}

/**
 * 取「要畫出來的那幾列」。
 * ⚠ 資料不足時就是回實際筆數，**不補空列**（8 個人拿過冠軍就只畫 8 列，名次仍然連續）。
 */
export function lbTopRows<T>(rows: T[] | null | undefined, top: unknown): T[] {
  if (!rows || !Array.isArray(rows)) return [];
  return rows.slice(0, normalizeLbTop(top));
}

/** 讀回上次的選擇。⚠ Safari 無痕／停用儲存時 getItem 也可能 throw ⇒ 一律 try/catch 退回預設。 */
export function loadLbTop(): number {
  try {
    if (typeof localStorage === 'undefined') return LB_TOP_DEFAULT;
    return normalizeLbTop(localStorage.getItem(LB_TOP_KEY));
  } catch {
    return LB_TOP_DEFAULT;
  }
}

/** 記住選擇。⚠ Safari 無痕 setItem 會 throw ⇒ 沿用站內既有寫法，吞掉不讓它炸到畫面。 */
export function saveLbTop(n: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LB_TOP_KEY, String(normalizeLbTop(n)));
  } catch {
    /* Safari 無痕 / quota / 停用儲存：記不住就算了，畫面照常運作 */
  }
}
