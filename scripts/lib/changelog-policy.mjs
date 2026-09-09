// ⭐⭐⭐ 首頁 changelog 的「政策值」單一來源（v6.332 抽出）
//
// ⚠⚠ 為什麼要有這個檔（IRON_RULES **Rule 38：同一個判準只能有一份**）：
//   v6.332 把首頁保留則數從 50 調成 35 時，發現「50」這個數字**被抄在三支守衛裡**
//   （test-v6264、test-changelog-size-and-archive、test-v6223），
//   其中 test-v6223 的那一份還是在「版面守衛」裡順手加的，改的人根本不會想到要去看它。
//   ⇒ 判準有 N 份複本時，改政策就會有 N-1 支守衛誤紅，而且任何一份被改壞都測不出來。
//
// ⚠ 這裡 pin 的是**政策**（站長裁定的數字），不是**版本號**：
//   它不會像 pin 死 sha 那樣「過期後靜默失效」，但改它一定要同時做一次批次搬運
//   （見 test-v6264 的 F0c「批次縮減」）。

/** 首頁 `static/changelog.html` 保留的條目數（v6.332 站長裁定：50 → 35）。 */
export const N_HOME = 35;

/** 其中「內文直接內嵌」的則數；更舊的只留標題，內文在 `changelog-bodies.html`（v6.264）。 */
export const N_INLINE = 12;

/** 首頁片段與 bodies 檔各自的位元組上限（KB）。 */
export const MAX_KB = 40;

/**
 * bodies 的實測成長率（bytes/版，取最近 10 個有動 changelog 的版本）。
 * v6.279→v6.331 實測平均 +117 ⇒ 取 120 當保守值，用來算「還剩幾版就撞牆」。
 */
export const BODIES_GROWTH_PER_VERSION = 120;

/** 逼近門檻的預警線：bodies 的餘裕必須夠再撐這麼多版，否則就該再做一次批次縮減。 */
export const BODIES_MIN_SLACK_VERSIONS = 20;
