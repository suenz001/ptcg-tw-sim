// ⭐v6.497 手機版「篩選面板收合」的共用判準（卡牌資料庫 /cards、牌組編輯器 /decks 找卡區）。
//
// 站長清單（2026-10-06 手機 390 寬實測）：
//   2. 卡牌資料庫篩選面板在 390 寬約 950px 高、要捲很久才看到卡 ⇒ 手機預設只留搜尋列＋「篩選（已選 N 項）」按鈕
//   3. 牌組編輯器找卡區篩選同樣過長（含卡包下拉）⇒ 同一種收合方式
//
// 作法：只在窄螢幕（≤600px，與兩頁既有的手機 @media 同一個斷點）把篩選列「不渲染」，由按鈕展開。
//   ⚠ 用 JS 判斷（svelte/reactivity 的 MediaQuery）而不是新增桌機 CSS：
//     /decks 的桌機 CSS 有逐字指紋守衛（test-v6213 只取 @media 以外的部分），/cards 的 @media 數量有守衛在釘；
//     不渲染就不需要任何桌機樣式 ⇒ 電腦版一個像素都不變。
//   ⚠ 收合只是「不顯示」，篩選條件照常生效（收起來時按鈕上的數字告訴玩家目前有幾項篩選）。

/** 兩頁共用的手機斷點（與既有的 `@media (max-width: 600px)` 一致）。 */
export const MOBILE_FILTER_QUERY = 'max-width: 600px';

/** 已選的篩選項數（各組 Set 大小相加；布林條件算 1 項）。 */
export function countActiveFilters(sets: ReadonlyArray<{ size: number }>, extra: ReadonlyArray<boolean> = []): number {
  return sets.reduce((a, s) => a + s.size, 0) + extra.filter(Boolean).length;
}

/** 按鈕文字：「篩選」／「篩選（已選 N 項）」，展開時加上收合提示。 */
export function filterToggleLabel(n: number, open: boolean): string {
  const base = n > 0 ? `篩選（已選 ${n} 項）` : '篩選';
  return open ? `${base} ▲` : `${base} ▼`;
}
