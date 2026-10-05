// server_admin_patch.js v1.55（v6.479 首頁「錦標賽動態」免登入摘要端點）的**整份還原器**。
//
// 本版只在 TAIL_ANCHOR 之前新增一個哨兵區塊 v155-home-tourn-summary（GET /api/home/tourn-summary）；
// 錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV155 一次還原回 v1.54。
// ⚠ 字面由 python 從檔案精準切出、當場驗證「還原 === v1.54 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V155_PAIRS = [
  [
    "    // <<< v153-tourn-deck-validate\n    // >>> v155-home-tourn-summary\n    // ⭐server v1.55（v6.479 首頁網頁版右欄「錦標賽動態」小卡）：**免登入**的唯讀賽事摘要。\n    //   首頁不載 Firebase Auth（v5.971 起首屏不帶 firebase），所以不能打要身分的 /api/tournament/event。\n    //   ⚠ 只回公開資訊：賽事名稱、階段、報名人數／上限、報名截止時間、目前輪次、是否社群賽。\n    //     不回任何玩家暱稱、uid、提案人、牌組（openList 原始文件含 proposerUid／proposerName ⇒ 逐欄挑選，絕不整份回傳）。\n    //   ⚠ 資料取自 getEventShared()（與 /event 共用 3 秒快取＋在途合併）⇒ 不增加任何 DB 查詢型態。\n    //   ⚠ 刻意放在錦標賽區塊（TAIL_ANCHOR）之前、路徑也不用錦標賽前綴 ⇒ 錦標賽區塊 28 把鎖一把都不動。\n    //     getEventShared 是同一個 try 區塊裡的函式宣告（提升）；_eventShared 等 let 在請求進來時早已初始化。\n    //   ⚠ 回哨兵 homeTournApi:1 ⇒ 前端拿不到（舊伺服器 404／測試站沒有 API）就整張卡不顯示。\n    app.get('/api/home/tourn-summary', async (req, res) => {\n      try {\n        const shared = await getEventShared();\n        const events = shared.openList\n          .filter((_e) => _e && typeof _e.status === 'string' && _e.status !== 'draft' && _e.status !== 'finished')\n          .map((_e) => ({ name: String(_e.name || ''), status: _e.status, regCount: shared.regCounts[_e._id] || 0, maxPlayers: _e.maxPlayers || null, registrationCloseAt: _e.registrationCloseAt || null, currentRound: _e.currentRound || 0, community: !!_e.createdByPlayer }));\n        res.set('Cache-Control', 'no-store');\n        res.json({ homeTournApi: 1, serverNow: Date.now(), events });\n      } catch (e) { res.status(500).json({ error: 'unavailable' }); }\n    });\n    // <<< v155-home-tourn-summary\n\n    app.get('/api/tournament/state'",
    "    // <<< v153-tourn-deck-validate\n\n    app.get('/api/tournament/state'"
  ]
];

/** 把 v1.55 的改動整份還原回 v1.54（輸入需為 LF、需為完整檔案）。 */
export function revertAdminV155(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V155_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV155：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
