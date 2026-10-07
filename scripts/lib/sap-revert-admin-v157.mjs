// server_admin_patch.js v1.57（牌組原型序位預設 50＋用最新規則重新判定，2026-10-07）的**整份還原器**。
//
// 本版只動 registerDeckRules 所在的 IIFE（錦標賽區塊 TAIL_ANCHOR 之前）：ruleRank 沒設＝50、sanitizeRule 改走 ruleRank、
// v157-rank50-migrate 一次性遷移、v157-reclassify 兩支端點（classify-decks／reclassify-stored）。
// 錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV157 一次還原回 v1.56。
// ⚠ 字面由 python difflib 從檔案精準切出、當場驗證「還原 === v1.56 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V157_PAIRS = [
  [
    "    //   「符合」的定義不變（必含卡全部都有、排除卡一張都沒有）。舊規則都沒有 rank ⇒ 全部是 0 ⇒ 分類結果與 v1.55 完全相同。\n    // ⭐v1.57（站長 2026-10-07：「請幫我先把預設的序位設為 50，這樣我才好增加比預設高或是比預設低的牌組」）：\n    //   沒設序位的規則一律當 50（DEFAULT_RULE_RANK）；明確填 0 就是 0（不會被當成「沒填」）。\n    function ruleRank(r) {\n",
    "    //   「符合」的定義不變（必含卡全部都有、排除卡一張都沒有）。舊規則都沒有 rank ⇒ 全部是 0 ⇒ 分類結果與 v1.55 完全相同。\n    function ruleRank(r) {\n"
  ],
  [
    "    function ruleRank(r) {\n      const v = r ? r.rank : undefined;\n      if (v === undefined || v === null || v === '') return 50;   // 預設序位（DEFAULT_RULE_RANK 由這裡導出，數字只寫這一處）\n      const n = Number(v);\n      return Number.isFinite(n) ? n : 50;\n    }\n",
    "    function ruleRank(r) {\n      const n = Number(r && r.rank);\n      return Number.isFinite(n) ? n : 0;\n    }\n"
  ],
  [
    "    }\n    const DEFAULT_RULE_RANK = ruleRank(null);\n    // <<< v156-deck-rule-rank\n",
    "    }\n    // <<< v156-deck-rule-rank\n"
  ],
  [
    "          priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,\n          // ⭐v1.56 序位（v156-deck-rule-rank）：整數、夾在 -99～99；⭐v1.57 沒填＝50（DEFAULT_RULE_RANK，走 ruleRank 同一份判準）\n          rank: Math.max(-99, Math.min(99, Math.round(ruleRank(b)))),\n          enabled: b.enabled !== false,\n",
    "          priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,\n          // ⭐v1.56 序位（v156-deck-rule-rank）：整數、夾在 -99～99；沒填＝0（一般）\n          rank: Number.isFinite(Number(b.rank)) ? Math.max(-99, Math.min(99, Math.round(Number(b.rank)))) : 0,\n          enabled: b.enabled !== false,\n"
  ],
  [
    "    });\n    // >>> v157-rank50-migrate\n    // ⭐v1.57 一次性遷移（站長：「之前已經設定好的牌組牌型原則也幫我改一下預設為50」）：\n    //   沒有序位（v1.56 之前存的）或序位是 0（v1.56 的舊預設）的規則 ⇒ 存成 50。\n    //   只跑一次：完成後在 deckRuleSettings 記一筆 rank50Migrated，之後站長刻意改回 0 的規則不會再被改掉。\n    //   失敗只記 log（ruleRank 本來就把「沒有序位」當 50，分類結果不受影響）。\n    Promise.resolve().then(async () => {\n      const META = getSupportPokemonCol();\n      if (await META.findOne({ _id: 'rank50Migrated' })) return;\n      const r = await TRULES.updateMany({ $or: [{ rank: { $exists: false } }, { rank: null }, { rank: 0 }] },\n        { $set: { rank: DEFAULT_RULE_RANK } });\n      await META.updateOne({ _id: 'rank50Migrated' }, { $set: { at: Date.now(), modified: (r && r.modifiedCount) || 0 } }, { upsert: true });\n      invalidateRulesCache();\n      console.log('[deck-rules] v1.57 序位預設 50 遷移完成：' + ((r && r.modifiedCount) || 0) + ' 條');\n    }).catch((e) => console.warn('[deck-rules] v1.57 序位遷移失敗（分類照常，沒有序位的規則一律當 50）:', e && e.message));\n    // <<< v157-rank50-migrate\n\n",
    "    });\n\n"
  ],
  [
    "  });\n  // >>> v157-reclassify\n  // ⭐v1.57（站長 2026-10-07）：「我常常更新規則，因此冠軍的牌組原型規則不一定是最新的」「牌組公布欄也有這個狀況，\n  //   希望我在 admin 牌組原則那邊，提供我一個一鍵更新的按鈕，去更新之前儲存有相關牌組判定的部分（可能別的地方也有），都採用最新的判定」。\n  //   盤點（本版查過）：牌型「存進資料庫」的只有牌組公布欄（deckPosts.archetype，投稿當下算的）；\n  //   大廳／房間列表／對戰紀錄／原型統計／奪冠報告／套牌戰績都是讀取時用規則現算，但有幾份結果快取（最長 10 分鐘）。\n  //   ⇒ ① classify-decks：給一批牌表、用「當下最新、不經快取」的規則分類（歷屆賽事冠軍牌型用）\n  //      ② reclassify-stored：公布欄每一篇用最新規則重算並寫回；順便清掉本 IIFE 所有原型結果快取。\n  //   ⚠ 分類一律走本 IIFE 的中央 archetypeNameOf（Rule 38：不另寫一份分類）。\n  async function freshRulesForReclassify() {\n    invalidateRulesCache();\n    return TRULES.find({ enabled: { $ne: false } }).sort({ priority: 1 }).toArray();\n  }\n  // 公布欄存的語義與投稿時的 dpClassify 相同：命中＝規則名、沒命中／不知道＝''（不存「未分類」字樣）\n  function storedPostArchetype(entries, nameMap, rules) {\n    const a = archetypeNameOf(entries, nameMap, rules);\n    return (a && a !== '未分類') ? a : '';\n  }\n  function normDeckEntries(arr) {\n    if (!Array.isArray(arr)) return [];\n    const out = [];\n    for (const e of arr.slice(0, 120)) {\n      if (!e || typeof e !== 'object') continue;\n      const cid = String(e.cardId == null ? '' : e.cardId);\n      const n = Number(e.count);\n      if (!/^[0-9A-Za-z_-]{1,40}$/.test(cid) || !Number.isFinite(n) || n < 1 || n > 60) continue;\n      out.push({ cardId: cid, count: Math.round(n) });\n    }\n    return out;\n  }\n  app.post('/api/admin/deck-rules/classify-decks', requireFirebaseAdmin, async (req, res) => {\n    if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });\n    try {\n      const decks = (req.body && Array.isArray(req.body.decks)) ? req.body.decks : null;\n      if (!decks) return res.status(400).json({ error: 'decks 必須是陣列' });\n      if (decks.length > 1000) return res.status(400).json({ error: '一次最多 1000 副' });\n      const nameMap = await getCardNameMap();\n      if (!nameMap.size) return res.status(503).json({ error: '卡名對照還沒載入，請稍後再試' });\n      const rules = await freshRulesForReclassify();\n      const results = {};\n      let n = 0;\n      for (const d of decks) {\n        n++;\n        const _y = _archYield(n); if (_y) await _y;\n        const key = String((d && d.key) || '').slice(0, 80);\n        if (!key) continue;\n        results[key] = archetypeNameOf(normDeckEntries(d.entries), nameMap, rules);   // null＝不知道（沒牌表）\n      }\n      res.json({ ok: true, rulesCount: rules.length, results, at: Date.now() });\n    } catch (e) { res.status(500).json({ error: e.message }); }\n  });\n  let _reclassifyBusy = false;\n  app.post('/api/admin/deck-rules/reclassify-stored', requireFirebaseAdmin, async (req, res) => {\n    if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });\n    if (_reclassifyBusy) return res.status(409).json({ error: '上一次重新判定還在跑，請稍候' });\n    _reclassifyBusy = true;\n    try {\n      const nameMap = await getCardNameMap();\n      // ⚠ 卡名對照沒載入時 archetypeNameOf 一律回 null ⇒ 會把每一篇都寫成 ''（整批洗掉）⇒ 擋下來\n      if (!nameMap.size) return res.status(503).json({ error: '卡名對照還沒載入，請稍後再試' });\n      const rules = await freshRulesForReclassify();\n      const DP = db.collection('deckPosts');\n      const cursor = DP.find({}, { projection: { entries: 1, archetype: 1, deckName: 1 } });\n      if (typeof cursor.batchSize === 'function') cursor.batchSize(200);\n      let scanned = 0, changed = 0;\n      const samples = [], byName = {};\n      let ops = [];\n      const now = Date.now();\n      const flush = async () => { if (ops.length) { await DP.bulkWrite(ops, { ordered: false }); ops = []; } };\n      for await (const doc of cursor) {\n        scanned++;\n        const _y = _archYield(scanned); if (_y) await _y;\n        const to = storedPostArchetype(normDeckEntries(doc.entries), nameMap, rules);\n        const from = String(doc.archetype || '');\n        if (to === from) continue;\n        changed++;\n        byName[to || '（未分類）'] = (byName[to || '（未分類）'] || 0) + 1;\n        if (samples.length < 20) samples.push({ deckName: String(doc.deckName || ''), from, to });\n        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { archetype: to, archetypeAt: now } } } });\n        if (ops.length >= 200) await flush();\n      }\n      await flush();\n      // 讀取時現算的地方：清掉結果快取 ⇒ 大廳、房間列表、原型統計、明細、套牌戰績下次讀取就是新規則\n      _archDetailCache.clear(); _archStatsCache.clear(); _roomArchCache.clear(); _deckStatsCache.clear();\n      res.json({ ok: true, rulesCount: rules.length, scanned, changed, byName, samples, at: now });\n    } catch (e) { res.status(500).json({ error: e.message }); }\n    finally { _reclassifyBusy = false; }\n  });\n  // <<< v157-reclassify\n\n",
    "  });\n\n"
  ]
];

export function revertAdminV157(src) {
  let s = src;
  for (const [now, before] of ADMIN_V157_PAIRS) {
    const n = s.split(now).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV157：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + now.slice(0, 80));
    s = s.split(now).join(before);
  }
  return s;
}
