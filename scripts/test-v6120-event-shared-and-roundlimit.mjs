// v6.120 守衛：錦標賽伺服器降載收尾三項。
//
// 本版全部只動「讀取路徑」，寫回路徑一個字都不改。守衛因此同時包含兩類斷言：
//   ① 正向：新的降載措施必須存在（索引、快取解析、兩段式讀）。
//   ② ⚠ 否定向：**會把盤面整包寫回的那幾支 findOne 一律不得帶 projection**。
//      這是 v6.119 差點踩到的地雷，v6.120 又新增一處兩段式讀，必須重新釘住。
//
// 另外釘住一個很容易靜默出事的細節：pickActiveFromList 拿到的可能是
// _eventShared.openList（快取物件本身），in-place sort 會把快取順序改成「顯示優先序」，
// 而 /event 回傳的 events 清單依賴原本的 createdAt 順序 ⇒ 前端賽事列表排列會靜默改變。
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

/** 用結構 anchor 取一段（不寫死行數，避免上下文一動守衛就腐爛）。 */
function seg(startNeedle, len) {
  const i = P.indexOf(startNeedle);
  return i < 0 ? null : P.slice(i, i + len);
}
/** 以大括號配對抽出一個具名 function 的完整原始碼，用來「真的跑跑看」。 */
function extractFn(name) {
  const head = 'function ' + name + '(';
  const i = P.indexOf(head);
  if (i < 0) return null;
  let j = P.indexOf('{', i), depth = 0;
  for (let k = j; k < P.length; k++) {
    if (P[k] === '{') depth++;
    else if (P[k] === '}') { depth--; if (depth === 0) return P.slice(i, k + 1); }
  }
  return null;
}

console.log('① /event 現行賽事解析改吃 3 秒快取（原本每個請求各一次未快取的 TEVENTS.find）');

T('⭐ /event handler 必須先取 shared，再從 shared.openList 解析現行賽事', () => {
  const s = seg("app.get('/api/tournament/event'", 3000);
  ok(s, "找不到 /api/tournament/event handler");
  ok(/const shared = await getEventShared\(\);[\s\S]{0,1200}pickActiveFromList\(shared\.openList\)/.test(s),
    '/event 沒有改用 shared.openList 解析現行賽事。\n'
    + '      原本第一行 resolveEventFromReq → getActiveEvent → listOpenEvents\n'
    + '      = 每個請求各一次未快取的 TEVENTS.find({status:{$ne:"finished"}})，\n'
    + '      而下一行的 getEventShared() 早就把同一份清單快取了 3 秒。');
  ok(!/const ev = await resolveEventFromReq\(req\);\s*\n\s*const shared = await getEventShared\(\);/.test(s),
    '/event 又退回先呼叫 resolveEventFromReq 的舊寫法了');
});

T('⭐ 帶 eventId 時仍要能精確補查（看已結束賽事的路徑不能斷）', () => {
  const s = seg("app.get('/api/tournament/event'", 3000);
  ok(/shared\.openList\.find\(\(e\) => e\._id === String\(_reqEid\)\)\s*\|\|\s*await getEventById\(_reqEid\)/.test(s),
    '指定 eventId 但不在開放清單裡（已結束賽事）時沒有 fallback getEventById，\n'
    + '      行為會與原本的 resolveEventFromReq 不同（回 null → 前端看不到該賽事）。');
});

T('⚠ resolveEventFromReq 本身不得被改成吃快取（寫入端點要用新鮮資料）', () => {
  const s = seg('async function resolveEventFromReq(req)', 400);
  ok(s, '找不到 resolveEventFromReq');
  ok(!/getEventShared|_eventShared/.test(s),
    'resolveEventFromReq 被改成吃 3 秒快取了。\n'
    + '      register / checkin / admin 等**會寫入**的端點都走這支，\n'
    + '      用 3 秒前的賽事狀態做寫入決策 = 報名/報到階段判斷會出錯。');
});

T('⭐⭐ pickActiveFromList 不得 in-place 排序（會弄亂 _eventShared.openList 的順序）', async () => {
  const src = extractFn('pickActiveFromList');
  ok(src, '找不到 pickActiveFromList —— /event 的解析已無中央排序函式');
  ok(/list\.slice\(\)/.test(src),
    'pickActiveFromList 沒有先 slice() 就排序。\n'
    + '      呼叫端傳進來的是 _eventShared.openList（快取物件本身），\n'
    + '      in-place sort 會把快取順序改成「顯示優先序」，\n'
    + '      而 /event 回傳的 events 清單依賴原本的 createdAt 順序。');
});

T('⭐⭐ 行為端：pickActiveFromList 排序正確、且絕不改動傳入的陣列', () => {
  const rankSrc = 'const _EV_RANK = ' + (/const _EV_RANK = (\{[^}]*\});/.exec(P) || [])[1] + ';';
  const src = extractFn('pickActiveFromList');
  // eslint-disable-next-line no-new-func
  const pick = new Function(rankSrc + '\n' + src + '\nreturn pickActiveFromList;')();

  const list = [
    { _id: 'a', status: 'registration', createdAt: 10 },
    { _id: 'b', status: 'running', createdAt: 99 },
    { _id: 'c', status: 'checkin', createdAt: 1 },
  ];
  const before = list.map((e) => e._id).join(',');
  const got = pick(list);
  ok(got && got._id === 'b', 'running 應優先於 checkin/registration，實得：' + (got && got._id));
  ok(list.map((e) => e._id).join(',') === before,
    '⚠ pickActiveFromList 改動了傳入的陣列順序（' + before + ' → ' + list.map((e) => e._id).join(',') + '）\n'
    + '      這會污染 _eventShared.openList 這個共用快取物件。');

  // 同階段取 createdAt 最早
  const tie = [
    { _id: 'x', status: 'running', createdAt: 500 },
    { _id: 'y', status: 'running', createdAt: 200 },
  ];
  ok(pick(tie)._id === 'y', '同階段應取 createdAt 最早的一場');
  // 空清單
  ok(pick([]) === null && pick(null) === null, '空清單/null 應回 null');
});

T('getActiveEvent 必須改呼叫同一支中央排序（排序規則只能有一份）', () => {
  const s = seg('async function getActiveEvent()', 300);
  ok(s, '找不到 getActiveEvent');
  ok(/pickActiveFromList\(await listOpenEvents\(\)\)/.test(s),
    'getActiveEvent 自己又抄了一份排序邏輯 → 兩條路徑會漂移');
});

console.log('② 熱路徑索引');

T('⭐ TEVENTS 要有 status 索引（原本除 _id 外完全沒索引）', () => {
  ok(/TEVENTS\.createIndex\(\{\s*status:\s*1\s*\}\)/.test(P),
    'TEVENTS 缺 status 索引 —— listOpenEvents 的 $ne:"finished"、排程器每 tick 的\n'
    + '      find({status:"running"}) 全都是全集合掃描，而賽事只增不減。');
});

T('⭐ TMATCH 要有 (eventId,status) 與 (eventId,round) 複合索引', () => {
  ok(/TMATCH\.createIndex\(\{\s*eventId:\s*1,\s*status:\s*1\s*\}\)/.test(P),
    'TMATCH 缺 (eventId,status) 複合索引 —— 排程器每 30 秒撈 playing 場次');
  ok(/TMATCH\.createIndex\(\{\s*eventId:\s*1,\s*round:\s*1\s*\}\)/.test(P),
    'TMATCH 缺 (eventId,round) 複合索引 —— 未進場判負每 tick 撈本輪場次');
});

T('索引一律 best-effort 且建在啟動時（不得放進 request handler）', () => {
  const lines = P.split('\n').filter((l) => l.includes('createIndex'));
  ok(lines.length >= 11, 'createIndex 數量異常（少於預期）：' + lines.length);
  for (const l of lines) ok(/catch/.test(l), 'createIndex 沒有 catch：' + l.trim().slice(0, 80));
});

console.log('③ 對局時限掃描：兩段式讀（輕量早退 + 原完整讀取原樣保留）');

const RL_ANCHOR = "const playing = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null }, gameStartedAt: { $ne: null } })";

T('⭐ 時限掃描要有輕量早退（只讀 gameState.phase / gameState.turn）', () => {
  const s = seg(RL_ANCHOR, 3500);
  ok(s, '找不到對局時限掃描迴圈（結構改了，請重新檢視本守衛）');
  ok(/projection: \{ 'gameState\.phase': 1, 'gameState\.turn': 1 \}/.test(s),
    '時限掃描沒有輕量早退。時限一到，該輪還在打的每一場都會每 30 秒各拉一份完整\n'
    + '      gameState（log 佔約 73%），但判斷只需要 phase 與 turn 兩個純量。');
  ok(/if \(m\.timeLimitReached && typeof _ltgs\.turn === 'number' && _ltgs\.turn <= \(m\.timeLimitTurn \|\| 0\)\) continue;/.test(s),
    '「已標記時限、最後回合還沒打完」的早退條件不見了或寫法改了 —— '
    + '這正是重複最多次的那條路徑。');
});

T('⭐⭐⭐ 時限掃描的完整讀取仍不得帶 projection（三個分支都會整包寫回盤面）', () => {
  const s = seg(RL_ANCHOR, 3500);
  ok(s, '找不到對局時限掃描迴圈');
  ok(/const room = await TROOMS\.findOne\(\{ _id: m\.roomId \}\);\s*\n\s*const gs = room && room\.gameState;/.test(s),
    '時限掃描的完整讀取不見了或被加上 projection。\n'
    + '      這一段的平手判雙敗 / 比獎賞判勝 兩個分支都會\n'
    + '      JSON.parse(JSON.stringify(gs)) 把盤面整包 $set 回去，\n'
    + '      殘缺盤面寫回會永久洗掉 log（回放靠它）。\n'
    + '      降載只能用「輕量早退 + 原完整讀取原樣保留」。');
  // 早退必須在完整讀取之前（否則等於沒省）
  const iLight = s.indexOf("projection: { 'gameState.phase': 1, 'gameState.turn': 1 }");
  const iFull = s.indexOf('const room = await TROOMS.findOne({ _id: m.roomId });');
  ok(iLight >= 0 && iFull >= 0 && iLight < iFull, '輕量讀必須排在完整讀之前，否則沒有降載效果');
});

T('⚠ 全域否定：任何「整包寫回 gameState」的讀取都不得帶 projection', () => {
  // 找出所有 `JSON.parse(JSON.stringify(` 的位置，往前回溯最近的一次 TROOMS.findOne，
  // 該次讀取必須是完整讀（不帶 projection）。
  const marks = [];
  let i = -1;
  while ((i = P.indexOf('JSON.parse(JSON.stringify(', i + 1)) >= 0) marks.push(i);
  ok(marks.length >= 4, '整包 clone 寫回的地方變少了？請重新檢視本守衛：' + marks.length);
  for (const at of marks) {
    const before = P.slice(Math.max(0, at - 1200), at);
    const last = before.lastIndexOf('TROOMS.findOne(');
    if (last < 0) continue; // 這次 clone 的來源不是 TROOMS 讀取（例如 gs 由上層傳入）
    const call = before.slice(last, before.indexOf(')', last) + 1);
    ok(!/projection/.test(call),
      '有一支「讀出來 → clone → 整包 $set 回去」的 TROOMS.findOne 帶了 projection：\n'
      + '      ' + call.trim() + '\n'
      + '      殘缺盤面寫回會永久洗掉 log。要降載請用兩段式讀取。');
  }
});

console.log('④ 正對照（守衛本身要抓得到壞掉的版本）');

T('正對照：把兩段式早退拿掉 / 給完整讀加 projection，本守衛必須 FAIL', () => {
  const broken1 = P.replace("projection: { 'gameState.phase': 1, 'gameState.turn': 1 }", 'projection: {}');
  ok(!/projection: \{ 'gameState\.phase': 1, 'gameState\.turn': 1 \}/.test(broken1), '正對照構造失敗');
  const broken2 = P.replace(
    'const room = await TROOMS.findOne({ _id: m.roomId });\n            const gs = room && room.gameState;',
    "const room = await TROOMS.findOne({ _id: m.roomId }, { projection: { gameState: 1 } });\n            const gs = room && room.gameState;");
  ok(broken2 !== P, '正對照構造失敗（找不到完整讀取那一行）');
  ok(/TROOMS\.findOne\(\{ _id: m\.roomId \}, \{ projection: \{ gameState: 1 \} \}\)/.test(broken2),
    '正對照應該要出現帶 projection 的版本');
});

console.log('\n=== v6.120 /event 快取解析 + 索引 + 時限兩段式讀 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
