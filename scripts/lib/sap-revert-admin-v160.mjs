// server_admin_patch.js v1.60（套牌戰績、玩家戰績也排除第一回合沒進場，2026-10-11）的**整份還原器**。
//
// 本版只動錦標賽區塊（TAIL_ANCHOR）之前：中央子句 casualNoShowExcludeClause（buildCasualCleanFilter 的 archNoShow 改用它，輸出不變）、
// /api/deck-stats 休閒帶 archNoShow＋錦標賽走 archTournMatchCounts、admin 玩家統計／單一玩家統計／玩家檔案加同一個子句與述詞。
// 錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV160 一次還原回 v1.59。
// ⚠ 字面由 python difflib 從檔案精準切出、當場驗證「還原 === v1.59 原檔」後才寫入，不手打。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V160_PAIRS = [
 [
  "  const CASUAL_NOSHOW_RE = /無回應/;   // v159-arch-noshow：休閒無回應判負（見 buildCasualCleanFilter 的 archNoShow）\n  // >>> v160-noshow-all\n  // ⭐v1.60（站長 2026-10-11：套牌戰績、玩家戰績也要排除第一回合沒進場的場次）：「第一回合就無回應判負」的排除子句**只有這一份**，\n  //   牌組原型（buildCasualCleanFilter 的 archNoShow）、套牌戰績、玩家戰績（admin 玩家統計／玩家檔案）都用它。\n  function casualNoShowExcludeClause() {\n    return { $or: [{ winReason: { $not: CASUAL_NOSHOW_RE } }, { finalTurn: { $gte: 2 } }] };\n  }\n  // <<< v160-noshow-all\n  function buildCasualCleanFilter(opts) {\n",
  "  const CASUAL_NOSHOW_RE = /無回應/;   // v159-arch-noshow：休閒無回應判負（見 buildCasualCleanFilter 的 archNoShow）\n  function buildCasualCleanFilter(opts) {\n"
 ],
 [
  "      const leaveOr = q.$or; delete q.$or;\n      q.$and = [{ $or: leaveOr }, casualNoShowExcludeClause()];   // v1.60：子句收進中央（輸出與 v1.59 逐位元相同）\n    }\n",
  "      const leaveOr = q.$or; delete q.$or;\n      q.$and = [{ $or: leaveOr }, { $or: [{ winReason: { $not: CASUAL_NOSHOW_RE } }, { finalTurn: { $gte: 2 } }] }];\n    }\n"
 ],
 [
  "        const pipeline = [];\n        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });\n        pipeline.push({ $match: casualNoShowExcludeClause() });   // v160-noshow-all：第一回合沒進場不算\n        pipeline.push({ $facet: {\n          // v0.15 P1 視角：email 為主鍵；email 缺則用 name (prefix \"name:\" 避免與 email 碰撞)\n",
  "        const pipeline = [];\n        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });\n        pipeline.push({ $facet: {\n          // v0.15 P1 視角：email 為主鍵；email 缺則用 name (prefix \"name:\" 避免與 email 碰撞)\n"
 ],
 [
  "        const summaryPipeline = [\n          { $match: { $and: [{ $or: [{ 'p1.email': email }, { 'p2.email': email }] }, casualNoShowExcludeClause()] } },   // v160-noshow-all：第一回合沒進場不算（最近對戰列表照列）\n          { $project: {\n",
  "        const summaryPipeline = [\n          { $match: { $or: [{ 'p1.email': email }, { 'p2.email': email }] } },\n          { $project: {\n"
 ],
 [
  "        const pCasual = MR.aggregate([\n          { $match: { $and: [orMe, casualNoShowExcludeClause()] } },   // v160-noshow-all：第一回合沒進場不算\n          { $project: {\n",
  "        const pCasual = MR.aggregate([\n          { $match: orMe },\n          { $project: {\n"
 ],
 [
  "          for (const m of (a.matches || [])) {\n            if (!archTournMatchCounts(m)) continue;   // v160-noshow-all（原：非 bye；下面另判有勝方）\n            const inIt = m.p1uid === me.uid || m.p2uid === me.uid;\n",
  "          for (const m of (a.matches || [])) {\n            if (!m || m.bye) continue;\n            const inIt = m.p1uid === me.uid || m.p2uid === me.uid;\n"
 ],
 [
  "        //     直接把 deckId 的 $or 塞進同一層會把它整條**覆蓋掉** ⇒ 一律用 $and 併。\n        const q = { $and: [buildCasualCleanFilter({ archNoShow: true }), { $or: [{ 'p1.deckId': deckId }, { 'p2.deckId': deckId }] }] };   // v160-noshow-all：第一回合沒進場不算\n        // ⚠⚠ **不可以**把 cardCounts 物件直接丟給 archetypeNameOf：它的第一行是\n",
  "        //     直接把 deckId 的 $or 塞進同一層會把它整條**覆蓋掉** ⇒ 一律用 $and 併。\n        const q = { $and: [buildCasualCleanFilter({}), { $or: [{ 'p1.deckId': deckId }, { 'p2.deckId': deckId }] }] };\n        // ⚠⚠ **不可以**把 cardCounts 物件直接丟給 archetypeNameOf：它的第一行是\n"
 ],
 [
  "              _tn++; const _y2 = adminScanYield(_tn); if (_y2) await _y2;   // ⚠ 每 200 個元素讓路（v6.242）\n              // 口徑同 /api/admin/deck-archetype-stats 錦標賽側：非 bye、有勝方、不是未進場判勝（v160-noshow-all 走中央述詞）才計。\n              if (!archTournMatchCounts(_tm)) continue;\n              const _p1Mine = _tm.p1uid != null && _myUids.has(String(_tm.p1uid));\n",
  "              _tn++; const _y2 = adminScanYield(_tn); if (_y2) await _y2;   // ⚠ 每 200 個元素讓路（v6.242）\n              // 口徑同 /api/admin/deck-archetype-stats 錦標賽側：非 bye 且有勝方才計。\n              if (!_tm || _tm.bye || !_tm.winnerUid) continue;\n              const _p1Mine = _tm.p1uid != null && _myUids.has(String(_tm.p1uid));\n"
 ]
];

export function revertAdminV160(src) {
  let s = src;
  for (const [now, before] of ADMIN_V160_PAIRS) {
    const n = s.split(now).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV160：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + now.slice(0, 80));
    s = s.split(now).join(before);
  }
  return s;
}
