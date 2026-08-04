// v6.119 守衛：錦標賽伺服器端的查詢負載改動，以及「絕對不能加 projection」的那一處。
//
// 背景：30 人賽 lag 的伺服器側。v6.118 已修掉前端那條（錦標賽頁誤訂閱休閒大廳輪詢），
// 這一版處理伺服器端：索引、不必要的大 doc 讀取、可快取的重複查詢。
//
// ⚠⚠⚠ 本檔最重要的一條是 ②：
//   閒置判負在「判負當下」會 `JSON.parse(JSON.stringify(gs))` 把整份盤面 clone 後寫回。
//   如果讀取那一次帶了 projection，寫回去的就是**殘缺的盤面** —— log 會被永久洗掉，
//   投降／閒置場的回放（靠房間 gameState.log fallback）會壞。
//   所以降載只能用「兩段式」：輕量讀做門檻判斷，過門檻才走原本一字未改的完整讀取。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
/** 用結構 anchor 取一段，不寫死行數。 */
function seg(startNeedle, len) {
  const i = P.indexOf(startNeedle);
  return i < 0 ? null : P.slice(i, i + len);
}

console.log('① 熱路徑 collection 必須有索引');

T('⭐⭐ TREGS 要有 uid 與 eventId 索引（/event 每人每 3 秒查、且報名永久累積）', () => {
  ok(/TREGS\.createIndex\(\{\s*uid:\s*1\s*\}\)/.test(P),
    'TREGS 缺 uid 索引 —— /event 的 find({uid}) 會全表掃，人數 × 歷屆報名量');
  ok(/TREGS\.createIndex\(\{\s*eventId:\s*1\s*\}\)/.test(P),
    'TREGS 缺 eventId 索引 —— countDocuments/報到名單會全表掃');
});

T('⭐ TREPLAY 要有 matchId 索引（回放快照是最大的 collection 之一）', () => {
  ok(/TREPLAY\.createIndex\(\{\s*matchId:\s*1\s*\}\)/.test(P),
    'TREPLAY 缺 matchId 索引 —— 每次看回放都全表掃 90 天份的完整盤面快照');
});

T('索引一律建在啟動時、且 best-effort（不得放進 request handler）', () => {
  const lines = P.split('\n').filter((l) => l.includes('createIndex'));
  ok(lines.length >= 8, 'createIndex 數量異常：' + lines.length);
  for (const l of lines) {
    ok(/catch/.test(l), 'createIndex 沒有 catch（索引已存在會拋）：' + l.trim().slice(0, 80));
  }
});

console.log('② ⚠⚠ 閒置判負：完整讀取不得被加 projection（會把殘缺盤面寫回）');

T('⭐⭐⭐ 判負路徑仍有一次「不帶 projection」的完整 TROOMS 讀取', () => {
  const s = seg('const playingI = await TMATCH.find({ eventId: ev._id, status: \'playing\'', 3000);
  ok(s, '找不到閒置判負迴圈（結構改了，請重新檢視本守衛）');
  ok(/const room = await TROOMS\.findOne\(\{ _id: m\.roomId \}\);/.test(s),
    '閒置判負的完整讀取不見了或被加上 projection。\n'
    + '      這一段在判負時會 JSON.parse(JSON.stringify(gs)) 整包寫回，\n'
    + '      projection 過的殘缺盤面寫回去會永久洗掉 log（投降/閒置場的回放會壞）。\n'
    + '      要降載請用「輕量讀先判門檻、過門檻才完整讀」的兩段式。');
});

T('⭐⭐ 而且要有輕量讀先擋掉「還沒到門檻」的絕大多數情況', () => {
  const s = seg('const playingI = await TMATCH.find({ eventId: ev._id, status: \'playing\'', 3000);
  ok(s, '找不到迴圈');
  ok(/TROOMS\.findOne\(\{ _id: m\.roomId \}, \{ projection: \{ lastActionAt: 1, updatedAt: 1 \} \}\)/.test(s),
    '缺輕量讀 —— 每 30 秒對每場 playing match 都整份盤面（log 佔約 73%）拉出來只為算 currentActorSeat');
  const li = s.indexOf('projection: { lastActionAt: 1, updatedAt: 1 }');
  const fi = s.indexOf('const room = await TROOMS.findOne({ _id: m.roomId });');
  ok(li >= 0 && fi >= 0 && li < fi, '輕量讀必須排在完整讀之前');
});

T('⭐ 輕量讀的門檻判斷要用與完整路徑相同的 fallback 鏈（否則會改變判負時機）', () => {
  const s = seg('const _light = await TROOMS.findOne', 600);
  ok(s, '找不到輕量讀');
  ok(/_light\.lastActionAt \|\| _light\.updatedAt \|\| m\.gameStartedAt \|\| now/.test(s),
    '輕量讀的 fallback 鏈與完整路徑的 `last` 不一致');
  ok(/if \(now <= _lastLight \+ idleMin \* 60000\) continue;/.test(s), '門檻比較式不一致');
});

T('正對照：判準抓得到「對完整讀取加 projection」的樣本', () => {
  const probe = "const room = await TROOMS.findOne({ _id: m.roomId }, { projection: { 'gameState.log': 0 } });";
  ok(!/const room = await TROOMS\.findOne\(\{ _id: m\.roomId \}\);/.test(probe),
    '判準抓不到違規樣本 ⇒ 假綠');
});

console.log('③ 純讀路徑該加的 projection 有加');

T('⭐ 未進場判負的防呆探測只看 phase → 必須帶 projection', () => {
  ok(/TROOMS\.findOne\(\{ _id: m\.roomId \}, \{ projection: \{ 'gameState\.phase': 1 \} \}\)/.test(P),
    '那次探測（只讀 gameState.phase、不寫回）沒有帶 projection');
});

T('⭐ /event 不得把本人所有歷屆報名的完整牌表拉回來', () => {
  ok(/TREGS\.find\(\{ uid: id\.uid \}, \{ projection: \{ deckEntries: 0 \} \}\)/.test(P),
    'myRegs 仍拉完整 doc —— 老玩家數十筆報名 × 每 3 秒 = 白拉上百 KB');
  ok(/const _regDeck = reg \? await TREGS\.findOne\(\{ _id: reg\._id \}, \{ projection: \{ deckEntries: 1 \} \}\) : null;/.test(P),
    '沒有把「當前賽事那一筆」的 deckEntries 補查回來 —— deckCount(undefined) 會回 -1，前端會顯示錯的張數');
  ok(/deckCount\(_regDeck && _regDeck\.deckEntries\)/.test(P), 'deckCount 沒有改讀補查回來的那筆');
});

console.log('④ 幾乎不變的規則庫要快取，且改動時要失效');

T('⭐ TRULES 查詢有 TTL 快取', () => {
  ok(/async function getEnabledRulesCached\(\)/.test(P), '沒有 getEnabledRulesCached');
  ok(/getEnabledRulesCached\(\)/.test(P.slice(P.indexOf('rooms-archetypes'))),
    'rooms-archetypes 沒有改用快取版');
});

T('⭐⭐ 規則 CRUD 之後必須讓快取失效（否則 admin 改了規則要等 TTL）', () => {
  const upd = seg('await TRULES.updateOne(', 260);
  const del = seg('await TRULES.deleteOne(', 260);
  ok(upd && /invalidateRulesCache\(\);/.test(upd), 'updateOne 之後沒有失效快取');
  ok(del && /invalidateRulesCache\(\);/.test(del), 'deleteOne 之後沒有失效快取');
});

T('⭐ 快取與失效函式必須定義在呼叫點之前（跨 IIFE / TDZ 事故 v0.94/v1.01）', () => {
  const def = P.indexOf('function invalidateRulesCache()');
  const firstCall = P.indexOf('invalidateRulesCache();');
  ok(def > 0 && firstCall > 0, '找不到定義或呼叫');
  ok(def < firstCall, 'invalidateRulesCache 定義在呼叫點之後 —— 請移到 TRULES 宣告旁');
  const trules = P.indexOf("const TRULES = db.collection('deckRules');");
  ok(trules > 0 && def > trules && def - trules < 900,
    '快取應緊接在 TRULES 宣告之後（確保同一個 IIFE 作用域）');
});

console.log('\n=== v6.119 錦標賽查詢負載守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
