// server_admin_patch.js v1.69（前端未 bump；重賽的系統訊息「擲幣」→「擲硬幣」）的**整份還原器**＋錦標賽區塊行內改動的唯一宣告。
//
// 本版只改錦標賽區塊內兩行（重賽端點的註解與玩家看得到的系統聊天訊息）⇒ 28 把鎖重釘（tourn-revert-v169.mjs）。
// ⚠ 字面由 python 從檔案精準切出、當場驗證「還原 === v1.68 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V169_PAIRS = [
  [
    "    // 管理員：重賽（從擲硬幣重新開始該場對局；只限尚未結束的場）（⭐v1.69 站長 2026-10-16 裁定：玩家看得到的系統訊息統一寫「擲硬幣」）\n",
    "    // 管理員：重賽（從擲幣重新開始該場對局；只限尚未結束的場）\n"
  ],
  [
    "        await postSystemChat('🔄 管理員將「' + m.p1name + ' vs ' + m.p2name + '」重新開賽（從擲硬幣重新開始）。');\n",
    "        await postSystemChat('🔄 管理員將「' + m.p1name + ' vs ' + m.p2name + '」重新開賽（從擲幣重新開始）。');\n"
  ]
];

/** 把 v1.69 的改動整份還原回 v1.68（輸入需為 LF、需為完整檔案）。 */
export function revertAdminV169(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V169_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV169：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
