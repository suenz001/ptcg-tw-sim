// server_admin_patch.js v1.46（admin v1.75：🎮 Oracle 對戰搜尋也能搜牌組原型名稱）的**行內改動**還原器。
//
// v1.46 的改動分兩種：
//   ・純新增 ⇒ 一律用 `// >>> v146-admin-arch-search` … `// <<< v146-admin-arch-search` 哨兵框住，
//     由各守衛既有的哨兵剝除處理。
//   ・**既有行的行內插入**（回應物件多一個 `archScan` 欄位）沒辦法用哨兵框 ⇒ 在這裡逐字宣告、逐字還原
//     （沿用 tourn-revert-v6381 的形狀：這不是放寬，是把改動搬到宣告端）。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V146_INLINE_PAIRS = [
  ['range: _range, q: _q, archScan: _archScan });', 'range: _range, q: _q });'],
];

/** 把 v1.46 的行內改動還原回 v1.45（輸入需為 LF）。 */
export function revertAdminV146(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V146_INLINE_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV146：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur);
    t = t.split(cur).join(old);
  }
  return t;
}
