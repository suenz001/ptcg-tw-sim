// scripts/lib/seeded-rng.mjs — 守衛專用的「固定種子亂數」單一來源（v6.336）
//
// 為什麼要有這個檔：
//   直接吃 `Math.random` 做隨機取樣的守衛，判準只要稍微抓緊一點，就會變成**會隨機翻紅的守衛**。
//   實際踩過兩次：`test-v6234` ⑦（3000 次擲幣，maxFlips < 20 ⇒ 每次 CI 約 0.57% 機率紅）。
//   假紅最大的傷害不是浪費一次 rerun，而是**訓練大家「看到紅先 rerun」**，
//   下一步就是有人幫它加 skip，守備就靜悄悄地沒了。
//
// ⚠ 單一來源（IRON_RULES Rule 38：同一個判準／同一份工具只能有一份）：
//   任何守衛要做「可重現的隨機取樣」，都從這裡 import，**不可以各自手寫一份 PRNG**。
//
// ⚠ 這個檔只給 `scripts/` 下的守衛用，不會被打包進站台。

/**
 * mulberry32 —— 32-bit 狀態的快速 PRNG，週期 2^32，通過 gjrand/BigCrush 的基本統計檢定。
 * 對守衛來說重點只有兩個：①同一顆種子必定產生同一串 ②分布夠均勻，統計結論才站得住。
 * @param {number} seed 任意 32-bit 整數
 * @returns {() => number} 回傳 [0,1) 的函式，簽名與 Math.random 相同
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 在 fn 執行期間把全域 Math.random 換成固定種子的 PRNG，結束後**一定**還原（含 fn 丟例外）。
 * ⚠ 還原寫在 finally：漏還原的話，後面所有測試都會共用這條序列，錯得很難查。
 * @template T
 * @param {number} seed
 * @param {() => T} fn
 * @returns {T}
 */
export function withSeededRandom(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/**
 * 正對照專用：把硬幣灌成「pHead 機率正面」的偏態來源（仍然是固定種子 ⇒ 可重現）。
 * 站內擲幣的判準是 `Math.random() < 0.5 ⇒ 正面`，所以只回傳 0.25（正）／0.75（反）兩個值。
 * 用途：證明某一段量測**真的量得到**「碰到上限 / 出現極端值」，不是恆真地放行（Rule 33）。
 * @template T
 * @param {number} seed
 * @param {number} pHead 0~1
 * @param {() => T} fn
 * @returns {T}
 */
export function withBiasedCoin(seed, pHead, fn) {
  const orig = Math.random;
  const rng = mulberry32(seed);
  Math.random = () => (rng() < pHead ? 0.25 : 0.75);
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}
