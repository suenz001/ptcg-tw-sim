// server_admin_patch.js v1.48（admin v1.76：📜 對戰歷史改用牌組原型＋可搜原型）的**行內改動**還原器。
//
// v1.48 的改動分兩種：
//   ・純新增 ⇒ 一律用 `// >>> v148-admin-match-arch` … `// <<< v148-admin-match-arch` 哨兵框住，
//     由各守衛既有的哨兵剝除處理。
//   ・**既有行的行內改動**（回應物件多一個 `archScan` 欄位）沒辦法用哨兵框 ⇒ 在這裡逐字宣告、逐字還原
//     （沿用 sap-revert-admin-v146 的形狀：這不是放寬，是把改動搬到宣告端）。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V148_INLINE_PAIRS = [
  ['res.json({ records, total, limit, skip, archScan: _mArchScan });', 'res.json({ records, total, limit, skip });'],
];

/** 把 v1.48 的行內改動還原回 v1.47（輸入需為 LF）。 */
export function revertAdminV148(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V148_INLINE_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV148：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur);
    t = t.split(cur).join(old);
  }
  return t;
}
