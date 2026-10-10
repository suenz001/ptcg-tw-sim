// server_admin_patch.js v1.61（總覽先攻後攻勝率改用真正的先攻座位、卡片勝率排除第一回合沒進場，2026-10-11）的**整份還原器**。
//
// 本版只動錦標賽區塊（TAIL_ANCHOR）之前：/api/admin/stats/overview 的 1.2 先攻後攻（FIRST_SEAT_KNOWN／FIRST_MOVER_GROUP，回應改 firstWin／secondWin）、
// /api/admin/stats/cards/winrate 加 casualNoShowExcludeClause。錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV161 一次還原回 v1.60。
// ⚠ 字面由 python difflib 從檔案精準切出、當場驗證「還原 === v1.60 原檔」後才寫入，不手打。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V161_PAIRS = [
 [
  "  (function registerStatsEndpoints() {\n    // >>> v161-first-seat\n    // ⭐v1.61（站長 2026-10-11「1 要改」）：1.2 先攻後攻勝率原本把 p1（建房者）當先攻 ⇒ 錯。\n    //   v1.59 起 matchRecords 記了 firstSeat（0＝p1 先攻、1＝p2 先攻；v6.524 以前的對戰沒有）。\n    //   只算知道誰先攻的場；firstWin＝勝方座位等於先攻座位，secondWin＝勝方是另一個座位，draws 沿用原本 winner===null 的口徑。\n    //   回應欄位改名（firstWin／secondWin），舊的 p1Win／p2Win 不再回 ⇒ admin 靠欄位名分辨新舊伺服器，不會把錯的數字當成先攻。\n    const FIRST_SEAT_KNOWN = { firstSeat: { $in: [0, 1] } };\n    const FIRST_MOVER_GROUP = {\n      _id: null,\n      firstWin: { $sum: { $cond: [{ $and: [{ $in: ['$winner', [0, 1]] }, { $eq: ['$winner', '$firstSeat'] }] }, 1, 0] } },\n      secondWin: { $sum: { $cond: [{ $and: [{ $in: ['$winner', [0, 1]] }, { $ne: ['$winner', '$firstSeat'] }] }, 1, 0] } },\n      draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },\n    };\n    // <<< v161-first-seat\n    // 1.1-1.4 對戰總覽 — 單一 aggregate 跑 N 個 $facet\n",
  "  (function registerStatsEndpoints() {\n    // 1.1-1.4 對戰總覽 — 單一 aggregate 跑 N 個 $facet\n"
 ],
 [
  "            firstMover: [\n              { $match: FIRST_SEAT_KNOWN },\n              { $group: FIRST_MOVER_GROUP },   // v161-first-seat：用真正的先攻座位 firstSeat（原：p1 當先攻）\n              { $project: { _id: 0 } },\n            ],\n            firstMoverHumanOnly: [\n              { $match: { $and: [{ vsAI: { $ne: true } }, FIRST_SEAT_KNOWN] } },\n              { $group: FIRST_MOVER_GROUP },   // v161-first-seat：用真正的先攻座位 firstSeat（原：p1 當先攻）\n              { $project: { _id: 0 } },\n            ],\n            firstMoverOnlineOnly: [\n              { $match: { $and: [{ roomCode: { $type: 'string' } }, { vsAI: { $ne: true } }, FIRST_SEAT_KNOWN] } },\n              { $group: FIRST_MOVER_GROUP },   // v161-first-seat：用真正的先攻座位 firstSeat（原：p1 當先攻）\n              { $project: { _id: 0 } },\n",
  "            firstMover: [\n              { $group: {\n                _id: null,\n                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },\n                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },\n                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },\n              }},\n              { $project: { _id: 0 } },\n            ],\n            firstMoverHumanOnly: [\n              { $match: { vsAI: { $ne: true } } },\n              { $group: {\n                _id: null,\n                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },\n                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },\n                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },\n              }},\n              { $project: { _id: 0 } },\n            ],\n            firstMoverOnlineOnly: [\n              { $match: { $and: [{ roomCode: { $type: 'string' } }, { vsAI: { $ne: true } }] } },\n              { $group: {\n                _id: null,\n                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },\n                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },\n                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },\n              }},\n              { $project: { _id: 0 } },\n"
 ],
 [
  "          firstMover: {\n            all: unwrap(agg.firstMover, { firstWin: 0, secondWin: 0, draws: 0 }),   // v161-first-seat\n            humanOnly: unwrap(agg.firstMoverHumanOnly, { firstWin: 0, secondWin: 0, draws: 0 }),\n            onlineHumanOnly: unwrap(agg.firstMoverOnlineOnly, { firstWin: 0, secondWin: 0, draws: 0 }),\n          },\n",
  "          firstMover: {\n            all: unwrap(agg.firstMover, { p1Win: 0, p2Win: 0, draws: 0 }),\n            humanOnly: unwrap(agg.firstMoverHumanOnly, { p1Win: 0, p2Win: 0, draws: 0 }),\n            onlineHumanOnly: unwrap(agg.firstMoverOnlineOnly, { p1Win: 0, p2Win: 0, draws: 0 }),\n          },\n"
 ],
 [
  "      Object.assign(baseMatch, { $or: buildCasualCleanFilter({}).$or });\n      baseMatch.$and = [casualNoShowExcludeClause()];   // v161-noshow-cards：第一回合沒進場不算（站長 2026-10-11「3 一起排出」）\n      const minDecks = Math.max(1, parseInt(req.query.minDecks) || 5);\n",
  "      Object.assign(baseMatch, { $or: buildCasualCleanFilter({}).$or });\n      const minDecks = Math.max(1, parseInt(req.query.minDecks) || 5);\n"
 ]
];

export function revertAdminV161(src) {
  let s = src;
  for (const [now, before] of ADMIN_V161_PAIRS) {
    const n = s.split(now).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV161：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + now.slice(0, 80));
    s = s.split(now).join(before);
  }
  return s;
}
