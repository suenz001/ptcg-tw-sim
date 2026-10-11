// server_admin_patch.js v1.63（v6.539 雙方同時昏厥的補位順序，2026-10-12）的**整份還原器**。
//
// 本版只在 currentActorSeat（錦標賽區塊 TAIL_ANCHOR 之前）新增哨兵區塊 v6539-promote-order：
// 雙方戰鬥場同時空著、雙方都有備戰時，「該動作的座位」＝下一個回合的玩家（1 − activePlayerIndex）。
// 錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV163 一次還原回 v1.62。
// ⚠ 字面由 python 從檔案精準切出、當場驗證「還原 === v1.62（99010a78）原檔」後才寫入，不手打。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V163_PAIRS = [
 ["      // >>> v6539-promote-order\n      // ⭐v6.539 站長裁定（2026-10-12 第 5 項）＋官方 Q&A（PTCG_RULES L410／L893／L1671）：雙方戰鬥寶可夢同時昏厥、雙方都有備戰時，\n      //   由「下一個回合的玩家」（1 − activePlayerIndex）先派出，另一方等它派完（引擎 SEND_NEW_ACTIVE 會退回等待方）。\n      //   ⇒ 這時該動作的是下一個回合的玩家；原本一律回 0，等待方會被當成掛機。判準與前端 modal-slots.ts promoteWaitSeat 相同。\n      if (gs.players && gs.players[0] && gs.players[1] && gs.players[0].active === null && gs.players[1].active === null\n          && Array.isArray(gs.players[0].bench) && gs.players[0].bench.length > 0 && Array.isArray(gs.players[1].bench) && gs.players[1].bench.length > 0\n          && (gs.activePlayerIndex === 0 || gs.activePlayerIndex === 1)) return 1 - gs.activePlayerIndex;\n      // <<< v6539-promote-order\n      if (gs.players && gs.players[0] && gs.players[0].active === null) return 0;\n", "      if (gs.players && gs.players[0] && gs.players[0].active === null) return 0;\n"]
];

export function revertAdminV163(src) {
  let s = src;
  for (const [now, before] of ADMIN_V163_PAIRS) {
    const n = s.split(now).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV163：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + now.slice(0, 80));
    s = s.split(now).join(before);
  }
  return s;
}
