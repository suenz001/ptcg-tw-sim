// server_admin_patch.js v1.50（admin v1.77：每日固定網站賽一鍵建立）的**行內改動**還原器。
//
// v1.50 的改動分兩種：
//   ・純新增（常數／helper／兩支端點）⇒ 全部框在 `// >>> v150-daily-tournament` … `// <<< v150-daily-tournament`
//     哨兵內，由各守衛既有的哨兵剝除處理。
//   ・**既有行的行內改動**：`/event/create` 端點裡「組賽事文件＋insertOne」那一段收斂成中央
//     `insertTournamentEvent(b, id)`（每日一鍵建立走同一份 ⇒ 欄位不會兩邊漂移，Rule 38）。
//     這一段沒辦法用哨兵框（新舊互斥）⇒ 在這裡逐字宣告、逐字還原（沿用 sap-revert-admin-v146／v148 的形狀）。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V150_INLINE_PAIRS = [
  [
    "        const b = req.body || {};\n        // ⭐v1.50：組賽事文件＋寫入 DB 收斂成中央 insertTournamentEvent（見 v150-daily-tournament 區塊）——\n        //   每日一鍵建立（/event/create-daily）走**同一份**，欄位與預設值永遠不會兩邊漂移（Rule 38）。\n        const ev = await insertTournamentEvent(b, id);\n        res.json({ ok: true, event: ev });\n",
    "        const b = req.body || {};\n        const regOpen = Number(b.registrationOpenAt) > 0 ? Number(b.registrationOpenAt) : null;\n        const regClose = Number(b.registrationCloseAt) > 0 ? Number(b.registrationCloseAt) : null;\n        const initStatus = (regOpen && regOpen > Date.now()) ? 'draft' : 'registration';\n        const ev = {\n          _id: 'evt_' + Date.now().toString(36),\n          createdAt: Date.now(),\n          name: String(b.name || '錦標賽').slice(0, 60),\n          format: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? 'swiss-then-cut' : 'single-elim', bestOf: 1,\n          // 瑞士制(swiss-then-cut)專屬：swissRounds/topCut 為 0 = 「依人數自動」(seed 時算)，admin 填數字則覆寫；phase 隨賽程 swiss→cut。\n          swissRounds: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? (Number(b.swissRounds) > 0 ? Number(b.swissRounds) : 0) : undefined,\n          topCut: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? (Number(b.topCut) > 0 ? Number(b.topCut) : 0) : undefined,\n          phase: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? 'swiss' : undefined,\n          status: initStatus,\n          registrationOpenAt: regOpen, registrationCloseAt: regClose,\n          maxPlayers: (b.maxPlayers == null || b.maxPlayers === '' || Number(b.maxPlayers) <= 0) ? null : Math.min(64, Number(b.maxPlayers)),\n          roundLimitMin: Number(b.roundLimitMin) > 0 ? Number(b.roundLimitMin) : 25,\n          noShowMin: Number(b.noShowMin) > 0 ? Number(b.noShowMin) : 5,\n          roundCountdownMin: (b.roundCountdownMin != null && b.roundCountdownMin !== '' && Number(b.roundCountdownMin) >= 0) ? Number(b.roundCountdownMin) : 3,\n          checkInEnabled: b.checkInEnabled !== false,\n          currentRound: 0,\n          createdBy: id.email || id.uid, createdAt: Date.now(),\n        };\n        await TEVENTS.insertOne(ev);\n        res.json({ ok: true, event: ev });\n",
  ],
];

/** 把 v1.50 的行內改動還原回 v1.49（輸入需為 LF）。 */
export function revertAdminV150(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V150_INLINE_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV150：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
