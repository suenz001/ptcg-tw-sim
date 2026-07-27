/**
 * 卡包選單的排列順序（v6.045）。
 *
 * Wilson：「請幫我反過來排序 —— 最上面除了『全部卡牌』以外，下一個為 J 標，
 *   最新發售的卡包放在最左邊最上面，最後一個才放該標的特典卡，再下來才是 I 標。
 *   （越新越靠左上，方便玩家查看最新出的卡包）」
 *
 * 也就是兩層都反過來：
 *   ① **賽季標的順序**：J → I → H（最新的標在最上面；原本是 H → I → J）
 *   ② **同一標內**：發售日新 → 舊（原本是舊 → 新）
 *   ③ **特典卡永遠排在該標最後**。
 *
 * ⚠關於「特典卡」怎麼判定：實測 static/cards/index.json，**沒有 releaseDate 的卡包
 *   剛好就是全部 5 個特典卡包**（M-P-J／M-P-I／SV-P-I／M-P-H／SV-P-H）——
 *   特典卡是陸續放出的促銷卡，本來就沒有單一發售日。所以「無日期排最後」這條既有
 *   規則正好等於 Wilson 要的「特典卡放最後」。
 *   但**不要只依賴這個巧合**：這裡同時看 code 是否為特典卡（含 `-P`），
 *   萬一日後有人替特典卡補上日期，順序也不會突然跑掉。
 *
 * ⚠日期比較用字串（ISO 格式可直接字典序比較），但要注意資料裡有
 *   `"2026-05"` 這種只有年月的值（M5 深淵之瞳）。同月份下與 `"2026-05-20"` 相比時，
 *   較短的字串會被判定為較小（＝較舊）。目前資料不會踩到，但補資料時要留意。
 *
 * 這段邏輯原本內嵌在 `routes/cards/+page.svelte` 的 `{@const}` 裡，無法測試；
 * 抽成模組後才能用真實的 index.json 驗證實際輸出順序。
 */
import type { SetSummary } from './types';

/** 賽季標的顯示順序：越新的標越前面。不在清單內的（F/G 等）一律排在最後。 */
export const MARK_ORDER = ['J', 'I', 'H'] as const;

/** 特典卡（促銷卡）包：code 形如 M-P-J、SV-P-I。這類卡包沒有單一發售日。 */
export function isPromoSet(set: Pick<SetSummary, 'code'>): boolean {
  return /-P(-|$)/.test(set.code);
}

/**
 * 同一個標之內的排序：發售日新 → 舊；特典卡固定墊底。
 * 匯出供測試直接驗證。
 */
export function compareSetsNewestFirst(a: SetSummary, b: SetSummary): number {
  const pa = isPromoSet(a) || !a.releaseDate;
  const pb = isPromoSet(b) || !b.releaseDate;
  if (pa !== pb) return pa ? 1 : -1;          // 特典卡／無日期 → 一律墊底
  if (!pa) {
    const da = a.releaseDate ?? '';
    const db = b.releaseDate ?? '';
    if (da !== db) return db.localeCompare(da);   // 降序：越新越前面
  }
  // 同日發售（如 SV5K/SV5M、SV11B/SV11W）用 code 做 tiebreaker，保證順序穩定
  return a.code.localeCompare(b.code);
}

/**
 * 把卡包分組並排好，回傳 `[標, 該標的卡包們][]`。
 * 只有 H/I/J 是現行標準賽的標；其餘（防禦性）附在最後。
 */
export function orderSetsForPicker(sets: SetSummary[]): [string, SetSummary[]][] {
  const groups = new Map<string, SetSummary[]>();
  for (const set of sets) {
    const m = set.regulationMark ?? '?';
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(set);
  }
  for (const [, list] of groups) list.sort(compareSetsNewestFirst);

  const ordered: [string, SetSummary[]][] = [];
  for (const mark of MARK_ORDER) {
    const list = groups.get(mark);
    if (list) ordered.push([mark, list]);
  }
  for (const [mark, list] of groups) {
    if (!(MARK_ORDER as readonly string[]).includes(mark)) ordered.push([mark, list]);
  }
  return ordered;
}
