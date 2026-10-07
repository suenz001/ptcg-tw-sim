// server_admin_patch.js v1.56（牌組原型序位，2026-10-07）的**整份還原器**。
//
// 本版只動 registerDeckRules（錦標賽區塊 TAIL_ANCHOR 之前）：新增 v156-deck-rule-rank 哨兵（ruleRank）、
// classifyDeck 排序先比序位、_deckRuleHelpers 多 ruleRank、sanitizeRule 多 rank、命中預覽多回 wins／lost。
// 錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV156 一次還原回 v1.55。
// ⚠ 字面由 python difflib 從檔案精準切出、當場驗證「還原 === v1.55 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V156_PAIRS = [
  [
    "     */\n    // >>> v156-deck-rule-rank\n    // ── v1.56（2026-10-07）牌組原型「序位」（站長需求，逐字）：「之前在做牌組原型分類的時候，少了序位的方式，\n    //   導致現在多個牌組有相同的牌的時候，會以設定的牌的多寡來分類，例如有兩套牌組都設定了同一張超級袋獸ex，\n    //   卻有可能是不同的牌組。因此需要幫一些常見和不常出現的牌組設定序位高低，比較高的只要有符合內容就優先判定，\n    //   比較低的要完全吻合，且高序位的牌組都未判定，才判定為本牌組」。\n    //   ⇒ 規則多一個 rank（整數，越大越先判定；沒設＝0）。同時命中多條時：\n    //     ① rank 大者優先（高序位只要符合就拿走，不管條件數）\n    //     ② rank 相同 → 沿用 v0.93：條件數多者優先 → priority 小者 → _id 字典序\n    //   「符合」的定義不變（必含卡全部都有、排除卡一張都沒有）。舊規則都沒有 rank ⇒ 全部是 0 ⇒ 分類結果與 v1.55 完全相同。\n    function ruleRank(r) {\n      const n = Number(r && r.rank);\n      return Number.isFinite(n) ? n : 0;\n    }\n    // <<< v156-deck-rule-rank\n    function classifyDeck(sets, rules) {\n",
    "     */\n    function classifyDeck(sets, rules) {\n"
  ],
  [
    "      all.sort((a, b) =>\n        ruleRank(b) - ruleRank(a)   // ⭐v1.56 序位優先（v156-deck-rule-rank）\n        || ruleStrictness(b) - ruleStrictness(a)\n        || (a.priority || 0) - (b.priority || 0)\n",
    "      all.sort((a, b) =>\n        ruleStrictness(b) - ruleStrictness(a)\n        || (a.priority || 0) - (b.priority || 0)\n"
  ],
  [
    "    app.locals = app.locals || {};\n    app.locals._deckRuleHelpers = { getCardNameMap, deckToSets, deckMatchesRule, classifyDeck, ruleStrictness, ruleRank, casualSideResult, tournSideResult };   // v1.56 多 ruleRank\n\n",
    "    app.locals = app.locals || {};\n    app.locals._deckRuleHelpers = { getCardNameMap, deckToSets, deckMatchesRule, classifyDeck, ruleStrictness, casualSideResult, tournSideResult };\n\n"
  ],
  [
    "          priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,\n          // ⭐v1.56 序位（v156-deck-rule-rank）：整數、夾在 -99～99；沒填＝0（一般）\n          rank: Number.isFinite(Number(b.rank)) ? Math.max(-99, Math.min(99, Math.round(Number(b.rank)))) : 0,\n          enabled: b.enabled !== false,\n",
    "          priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,\n          enabled: b.enabled !== false,\n"
  ],
  [
    "        const samples = [];\n        // ⭐v1.56（v156-deck-rule-rank）：除了「符合」幾副，也算「實際會被分到本規則」幾副——\n        //   拿目前啟用中的其他規則（編輯中的那條換成表單內容）一起跑中央 classifyDeck；\n        //   被序位較高（或同序位、條件較多）的規則拿走的，依那條規則名稱統計，讓站長調序位時看得到效果。\n        const editId = String((req.body && req.body.id) || '').trim();\n        const others = (await getEnabledRulesCached()).filter((r) => String(r._id) !== editId);\n        const cand = { ...s.doc, _id: editId || '__preview__' };\n        const pool = s.doc.enabled ? [...others, cand] : others;\n        let wins = 0;\n        const lostTo = new Map();\n        for (const m of recent) {\n",
    "        const samples = [];\n        for (const m of recent) {\n"
  ],
  [
    "            decks++;\n            const sets = deckToSets(p.cardCounts, nameMap);\n            if (deckMatchesRule(sets, s.doc)) {\n              hits++;\n",
    "            decks++;\n            if (deckMatchesRule(deckToSets(p.cardCounts, nameMap), s.doc)) {\n              hits++;\n"
  ],
  [
    "              if (samples.length < 8) samples.push({ name: p.name || '', email: p.email || null, endedAt: m.endedAt || null, roomCode: m.roomCode || null });\n              const c = classifyDeck(sets, pool);\n              if (c.rule === cand) wins++;\n              else if (c.rule) lostTo.set(c.rule.name || '?', (lostTo.get(c.rule.name || '?') || 0) + 1);\n            }\n",
    "              if (samples.length < 8) samples.push({ name: p.name || '', email: p.email || null, endedAt: m.endedAt || null, roomCode: m.roomCode || null });\n            }\n"
  ],
  [
    "        }\n        const lost = [...lostTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n }));\n        res.json({ ok: true, scannedMatches: recent.length, scannedDecks: decks, hits, wins, lost, samples, unknownCardNames: unknown });\n      } catch (e) { res.status(500).json({ error: e.message }); }\n",
    "        }\n        res.json({ ok: true, scannedMatches: recent.length, scannedDecks: decks, hits, samples, unknownCardNames: unknown });\n      } catch (e) { res.status(500).json({ error: e.message }); }\n"
  ]
];

/** 把 v1.56 的改動整份還原回 v1.55（輸入需為 LF、需為完整檔案）。 */
export function revertAdminV156(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V156_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV156：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
