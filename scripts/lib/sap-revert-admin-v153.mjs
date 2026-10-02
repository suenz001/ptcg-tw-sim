// server_admin_patch.js v1.53（錦標賽報名的牌組改在伺服器端也跑完整規則）的**行內改動**還原器。
//
// v1.53 的改動分兩種：
//   ・純新增（tournDeckIssue helper）⇒ 框在 `// >>> v153-tourn-deck-validate` … `// <<< v153-tourn-deck-validate` 哨兵內，
//     而且放在 TAIL_ANCHOR **之前**（不在錦標賽區塊裡）。
//   ・卡牌政策區塊（v6340-card-policy，在 TAIL_ANCHOR 之前）裡那段「錦標賽只檢查 60 張」的說明註解改寫成現況（不改程式）。
//   ・**既有端點的行內新增**：/register、/register-and-checkin、/propose 在 60 張檢查的下一行各多一行呼叫 tournDeckIssue。
//     插在既有端點中間、沒辦法用哨兵框 ⇒ 在這裡逐字宣告、逐字還原（沿用 sap-revert-admin-v152 的形狀）。
//   ⚠ 字面由腳本從檔案精準切出、當場驗證「還原＋剝哨兵 === v1.52 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V153_INLINE_PAIRS = [
  [
    "        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });\n        { const _deckBad = tournDeckIssue(deckEntries, req.body && req.body.deckName); if (_deckBad) return res.status(400).json({ error: _deckBad }); }   // ⭐v1.53 完整規則（/register）\n",
    "        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });\n"
  ],
  [
    "        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });\n        { const _deckBad = tournDeckIssue(deckEntries, req.body && req.body.deckName); if (_deckBad) return res.status(400).json({ error: _deckBad }); }   // ⭐v1.53 完整規則（/register-and-checkin）\n",
    "        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });\n"
  ],
  [
    "        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });\n        { const _deckBad = tournDeckIssue(deckEntries, b.deckName); if (_deckBad) return res.status(400).json({ error: _deckBad }); }   // ⭐v1.53 完整規則（/propose）\n",
    "        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });\n"
  ],
  [
    "    //   ⚠ 目前吃到這份政策的伺服器端路徑：**牌組公布欄的一般投稿**（dpValidateDeck）、\n    //     以及 server patch v1.53 起的**錦標賽報名**（/register、/register-and-checkin、/propose，走 tournDeckIssue，\n    //     見 v153-tourn-deck-validate 區塊；站長 2026-10-02 核准）。\n    //     ⚠ 只擋「新的報名」：報到與開戰（makeGame）仍只看 60 張，已報名的人不受影響；\n    //       牌組公布欄的錦標賽投稿（`const bad = tournament ? null : dpValidateDeck(...)`）也維持跳過。\n",
    "    //   ⚠ 目前吃到這份政策的伺服器端路徑：**牌組公布欄的一般投稿**（dpValidateDeck）。\n    //     ⚠⚠ 錦標賽的報名（/register、/register-and-checkin）與開戰（makeGame）**目前只檢查 60 張**、\n    //       完全沒有跑 validateDeck（`const bad = tournament ? null : dpValidateDeck(...)` 明確跳過），\n    //       所以錦標賽那一側的合法性目前仍靠前端。要不要把 dpValidateDeck 加到報名端點\n    //       由站長裁示（會影響已報名的玩家）。**不要**把這段註解寫成「錦標賽已經擋住了」。\n"
  ]
];

/** 把 v1.53 的行內改動還原回 v1.52（輸入需為 LF）。 */
export function revertAdminV153(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V153_INLINE_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV153：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
