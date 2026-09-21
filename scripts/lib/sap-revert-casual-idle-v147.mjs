// server_admin_patch.js v1.47（v6.425：休閒閒置判負改用盤面進度時鐘）的**整段替換**還原器。
//
// v1.47 把 v1.03 的 `(function startCasualIdleForfeit() { … })();` 整段換掉（不是純新增），
// 新段落用 `// >>> v147-casual-idle-progress` … `// <<< v147-casual-idle-progress` 框住。
// 各守衛既有的哨兵剝除器只會把新段「刪掉」，還原不出舊段 ⇒ 這裡逐字宣告舊段、逐字換回
// （沿用 sap-revert-admin-v146 / tourn-revert-v6381 的形狀：這不是放寬，是把改動搬到宣告端）。
// ⚠ 哨兵命中不是恰好 1 組、或還原後仍殘留 v147 痕跡 ⇒ 一律 throw（宣告過期會大聲紅）。
import assert from 'node:assert';

/** v1.46 的舊段落（逐字，LF）。 */
export const CASUAL_IDLE_V146_BLOCK = "    (function startCasualIdleForfeit() {\n      const TICK_MS = 30 * 1000;          // 每 30 秒掃一次（門檻最短 60 秒，取樣要夠密）\n      const GRACE_MS = 15 * 1000;         // 門檻外的緩衝\n      let running = false;                // 重入鎖：DB 慢查詢時不讓兩個 tick 重疊\n      async function sweepCasualIdle() {\n        if (running) return;\n        if (typeof db === 'undefined' || !db) return;\n        running = true;\n        try {\n          const now = Date.now();\n          // 只看對戰中、且至少已經超過最短門檻（60s）的房，避免每 tick 撈全部\n          const rooms = await db.collection('rooms').find(\n            { status: 'playing', updatedAt: { $lt: now - 60000 } },\n            { projection: { _id: 1, gameState: 1, _version: 1, updatedAt: 1, idleTimeoutSec: 1 } }\n          ).limit(200).toArray();\n          for (const room of rooms) {\n            const gs = room && room.gameState;\n            if (!gs || gs.phase === 'game-over') continue;\n            const sec = Math.min(300, Math.max(60, Number(room.idleTimeoutSec) || 180));\n            if (now <= (room.updatedAt || 0) + sec * 1000 + GRACE_MS) continue;\n            const actor = currentActorSeat(gs);\n            // -1（雙方都欠動作）/ null（判不出）→ 不判任何一方\n            if (actor !== 0 && actor !== 1) continue;\n            const winSeat = (1 - actor);\n            const nameOf = (i) => (gs.players && gs.players[i] && gs.players[i].name) || ('P' + (i + 1));\n            const loserName = nameOf(actor), winnerName = nameOf(winSeat);\n            const mins = Math.round(sec / 60 * 10) / 10;\n            const reason = loserName + ' 閒置逾 ' + mins + ' 分鐘無動作，' + winnerName + ' 獲勝';\n            const og = JSON.parse(JSON.stringify(gs));\n            og.phase = 'game-over';\n            og.winner = winSeat;\n            og.winReason = reason;\n            og.log = (Array.isArray(og.log) ? og.log : []).concat([\n              { turn: og.turn, playerIndex: null, message: '⏰ ' + reason },\n            ]);\n            // ⚠⚠ 休閒房的版本欄位是 **_version**（不是 version，那是錦標賽 TROOMS 的欄位名）。\n            //   client 的輪詢只在 `room._version !== lastVersion` 才回呼（oracle-client.ts），\n            //   而且 server 對 ?since=_version 相同時直接回 204 無 body。\n            //   ⇒ 沒 bump _version 的話：判負寫進 DB 了，但**兩邊玩家都看不到結果**，\n            //     而且掛機者醒來時用舊 _version 當 expectedVersion 的 PUT 還會把 game-over 整包蓋回 playing。\n            // ⚠ 樂觀鎖同時比對 updatedAt + _version：這一輪讀到之後對方若剛好動作了，更新不會命中，\n            //   下一輪 tick 用新值重算 —— 不會誤判剛好在邊緣行動的人。\n            await db.collection('rooms').updateOne(\n              { _id: room._id, updatedAt: room.updatedAt, _version: room._version, status: 'playing' },\n              { $set: { gameState: og, status: 'ended', _version: (room._version || 0) + 1, updatedAt: now } }\n            );\n            console.log('[casual-idle] ' + room._id + ' → ' + reason);\n          }\n        } catch (err) {\n          console.warn('[casual-idle] sweep error:', (err && err.message) || err);\n        } finally {\n          running = false;\n        }\n      }\n      console.log('[casual-idle] v1.0 已啟動：休閒房閒置逾房主設定（60~300 秒）自動判負，每 30 秒掃一次');\n      setTimeout(() => { sweepCasualIdle(); setInterval(sweepCasualIdle, TICK_MS); }, 20 * 1000);\n    })();\n";

const RE = /[ \t]*\/\/ >>> v147-casual-idle-progress\n[\s\S]*?\/\/ <<< v147-casual-idle-progress\n/g;

/** 把 v1.47 的整段替換還原回 v1.46（輸入需為 LF）。 */
export function revertCasualIdleV147(src) {
  const t = String(src);
  const n = (t.match(RE) || []).length;
  assert.strictEqual(n, 1, 'revertCasualIdleV147：哨兵命中 ' + n + ' 組（預期 1）——宣告過期了');
  const out = t.replace(RE, () => CASUAL_IDLE_V146_BLOCK);
  assert.ok(!out.includes('v147-casual-idle-progress') && !out.includes('casualIdleFingerprint'),
    'revertCasualIdleV147：還原後仍殘留 v1.47 痕跡');
  return out;
}
