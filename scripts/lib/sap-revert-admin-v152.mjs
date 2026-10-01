// server_admin_patch.js v1.52（/api/tournament/bracket 只讀用得到的欄位＋in-flight 合併）的**行內改動**還原器。
//
// v1.52 的改動分兩種：
//   ・純新增（投影常數＋bracketFindShared）⇒ 框在 `// >>> v152-bracket-light` … `// <<< v152-bracket-light` 哨兵內。
//   ・**既有行的行內改動**：/bracket 端點的兩行查詢（TMATCH.find／TREGS.find）改走 bracketFindShared＋projection。
//     新舊互斥、沒辦法用哨兵框 ⇒ 在這裡逐字宣告、逐字還原（沿用 sap-revert-admin-v146／v148／v150 的形狀）。
//   ⚠ 字面由腳本從檔案精準切出、當場驗證「還原＋剝哨兵 === v1.51 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V152_INLINE_PAIRS = [
  ["          const matches = await bracketFindShared('m:' + ev._id, () => TMATCH.find({ eventId: ev._id }, { projection: BRACKET_MATCH_PROJ_V152 }).sort({ round: 1, idx: 1 }).toArray());   // ⭐v1.52 只讀用得到的欄位＋同時過期只讀一次\n", "          const matches = await TMATCH.find({ eventId: ev._id }).sort({ round: 1, idx: 1 }).toArray();\n"],
  ["              const regs = await bracketFindShared('r:' + ev._id, () => TREGS.find({ eventId: ev._id, checkedIn: true }, { projection: BRACKET_REG_PROJ_V152 }).toArray());   // ⭐v1.52 同上（報名文件含 60 張牌表）\n              const players = TENG.buildSwissPlayersFromMatches(", "              const regs = await TREGS.find({ eventId: ev._id, checkedIn: true }).toArray();\n              const players = TENG.buildSwissPlayersFromMatches("],
];

/** 把 v1.52 的行內改動還原回 v1.51（輸入需為 LF）。 */
export function revertAdminV152(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V152_INLINE_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV152：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
