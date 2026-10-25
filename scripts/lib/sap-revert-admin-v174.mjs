// server v1.74（v6.601）我的錦標賽對戰回傳 result：server_admin_patch.js 的「逐位元還原表」（單一來源；IRON_RULES Rule 38）。
//   在錦標賽區塊（TAIL_ANCHOR）之前 ⇒ 28 把鎖不動；釘整檔位元組的舊守衛先用這裡還原成 v1.73（ac3f40a4）。行為由 test-v6601 守。
import assert from 'node:assert/strict';
export const ADMIN_V174_PAIRS = [
 [
  "            p1name: m.p1name || '', p2name: m.p2name || '', winnerName: m.winnerName || null, at: Number(m.endedAt) || Number(m.gameStartedAt) || 0,\n            // ⭐server v1.74（v6.601，站長 2026-10-25：「我的錦標賽對戰也要標勝敗」）：自己這一場的結果（winnerUid 只在伺服器比對，不回傳 uid）。\n            //   判法與賽事戰績既有的寫法相同：有勝者 ⇒ 是不是自己；沒有勝者（時限雙敗、雙方棄權）⇒ draw（前端顯示「雙敗」）。\n            //   ⚠（審查 P3-2）只有 winnerName 沒有 winnerUid（很早期的資料或手動改過 DB）⇒ 不回 result（不標，免得標籤寫雙敗、說明行卻有勝者）。\n            ...(m.winnerUid ? { result: String(m.winnerUid) === uid ? 'win' : 'loss' } : (m.winnerName ? {} : { result: 'draw' })),\n          }));\n",
  "            p1name: m.p1name || '', p2name: m.p2name || '', winnerName: m.winnerName || null, at: Number(m.endedAt) || Number(m.gameStartedAt) || 0,\n          }));\n"
 ],
 [
  "          const ms = await _mtmCol.find({ $or: [{ p1uid: uid }, { p2uid: uid }], status: 'done', bye: { $ne: true }, noShow: { $ne: true }, doubleNoShow: { $ne: true }, gameStartedAt: { $gt: 0 } },\n            { projection: { eventId: 1, round: 1, idx: 1, p1name: 1, p2name: 1, winnerName: 1, winnerUid: 1, gameStartedAt: 1, endedAt: 1 } })\n            .sort({ gameStartedAt: -1 }).limit(MTM_LIMIT).toArray();\n",
  "          const ms = await _mtmCol.find({ $or: [{ p1uid: uid }, { p2uid: uid }], status: 'done', bye: { $ne: true }, noShow: { $ne: true }, doubleNoShow: { $ne: true }, gameStartedAt: { $gt: 0 } },\n            { projection: { eventId: 1, round: 1, idx: 1, p1name: 1, p2name: 1, winnerName: 1, gameStartedAt: 1, endedAt: 1 } })\n            .sort({ gameStartedAt: -1 }).limit(MTM_LIMIT).toArray();\n"
 ],
 [
  "// === ORACLE ADMIN ENDPOINTS === v1.74 (v6.601 我的錦標賽對戰清單回傳自己的勝敗)\n// === ORACLE ADMIN ENDPOINTS === v1.73 (v6.592 錦標賽個人操作時計，預設關閉)\n",
  "// === ORACLE ADMIN ENDPOINTS === v1.73 (v6.592 錦標賽個人操作時計，預設關閉)\n"
 ]
];
export function revertAdminV174(source) {
 let s=source;
 for(const [now,prev] of ADMIN_V174_PAIRS){assert.equal(s.split(now).length-1,1,'v174還原錨點必須恰一處');s=s.replace(now,prev);}
 return s;
}
