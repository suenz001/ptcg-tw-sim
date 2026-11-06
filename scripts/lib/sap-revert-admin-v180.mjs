// server v1.80 錦標賽區塊的逐位元還原表（broadcastPush 上限 500→5000＋只取需要的欄位）。
//   單一來源（Rule 38）：整份補丁的還原鏈（sap-revert-admin-v177 入口）與錦標賽區塊的還原鏈（tourn-revert-v180）都用這一份。
//   表由 difflib 產生、當場驗證可逐位元還原成 146a1318（server v1.79）；行為由 test-v180-push-cap-timeout 守。
import assert from 'node:assert/strict';
export const PAIRS_V180 = [["        if (prefKey) q[prefKey] = { $ne: false };\n        // ⭐v1.80：只取送推播用得到的欄位（端點與金鑰在 sub、清除失效訂閱用 _id），人數變多時少解一點 BSON\n        let subs = await TPUSH.find(q, { projection: { _id: 1, uid: 1, sub: 1 } }).limit(cap).toArray();\n        // ⭐v1.67（Opus 審查 P1-2）：同一個推播端點可能還掛在別的帳號底下（舊資料）⇒ 依端點去重；\n", "        if (prefKey) q[prefKey] = { $ne: false };\n        let subs = await TPUSH.find(q).limit(cap).toArray();\n        // ⭐v1.67（Opus 審查 P1-2）：同一個推播端點可能還掛在別的帳號底下（舊資料）⇒ 依端點去重；\n"], ["     */\n    async function broadcastPush(payload, { excludeUid = null, excludeUids = null, prefKey = null, cap = 5000 } = {}) {\n      if (!_webpush) return { sent: 0 };\n", "     */\n    async function broadcastPush(payload, { excludeUid = null, excludeUids = null, prefKey = null, cap = 500 } = {}) {\n      if (!_webpush) return { sent: 0 };\n"], ["     * @param cap          單次推播上限，防未來訂閱數暴增時一次送爆\n     *                     ⭐v1.80：500 → 5000。訂閱 3 個月內 25 → 427，照這速度幾週內就超過 500，超過後會**悄悄**只推給其中 500 人\n     *                     （沒有排序、沒有錯誤訊息）。v1.79 起推播排隊送出（同時最多 16 筆），人數多不會加重卡頓。\n     */\n", "     * @param cap          單次推播上限，防未來訂閱數暴增時一次送爆\n     */\n"]];
/** 錦標賽區塊或整份補丁：有本版痕跡才還原（每組恰好命中一次，否則 throw）。 */
export function revertAdminV180IfPresent(source) {
  let s = String(source).replace(/\r\n/g, '\n');
  const hits = PAIRS_V180.map(([a]) => s.split(a).length - 1);
  if (hits.every((n) => n === 0)) return s;
  hits.forEach((n) => assert.equal(n, 1, 'v180 還原錨點必須恰好命中一次'));
  for (const [a, b] of PAIRS_V180) s = s.replace(a, b);
  return s;
}
