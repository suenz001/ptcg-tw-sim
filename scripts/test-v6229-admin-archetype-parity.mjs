// v6.229 守衛：admin「🎮 Oracle 對戰」牌組標籤改用牌組原型分類 —— 與一般對戰大廳同一份結果。
//
// 站長需求：admin 這個分頁原本用「剔除訓練家／能量／手動標記支援型後推測主力打手」
// （admin.html detectMainPokemon）代表牌組；改成比照一般對戰大廳（v6.115）：
// 後端 deckRules 規則庫分類，前端只拿名稱字串。
//
// ⭐ 核心不變量：同一副 deckEntries，admin 房間列表拿到／顯示的原型名稱必須與大廳
//    /api/rooms-archetypes 的結果**逐字相同**（===）；且「還不知道(null)」與「'未分類'」
//    必須分得出來（null 不顯示任何標籤，絕不可顯示成「未分類」）。
//
// 分五塊（全部行為端實跑，不是驗字串存在）：
//   ① 伺服器：真 deckToSets/classifyDeck/archetypeNameOf + 兩個端點實跑 ⇒ 三情境
//      （命中規則／未分類／null）兩端逐字相同；admin 對 ended 房也能分類（大廳刻意不回）。
//   ② admin UI：renderRoomRow 實跑 ⇒ 字串顯示【名稱】、null 無標籤且非「未分類」、
//      欄位缺席（Firebase 分頁／舊伺服器）退回 ⚔️ 主力打手（該分頁本版不動）。
//   ③ 搜尋：filterRoomsBySearch 實跑 ⇒ 原型名可搜、主力打手名仍可搜（保守：兩者都能搜）。
//   ④ 突變測試：(S1) server 把 null 語義改成'未分類' (S2) admin 端點拔掉 enrich
//      (U1) UI 改回主力打手判定 (U2) UI 把 null 當未分類 ⇒ 四組都必須讓守衛變紅。
//   ⑤ 效能 benchmark（Rule 32：量測腳本＝本檔；沙盒 CPU ≈ 正式 VM 的 1/10）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const HTML = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) { try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }
async function TA(name, fn) { try { await fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// ── 抽取器（Rule 25：每一段都有下限斷言，抽不到＝守衛紅，不會變安慰劑） ──
function sliceBetween(src, startAnchor, endAnchor, what) {
  const s = src.indexOf(startAnchor);
  ok(s >= 0, '抽不到 ' + what + '（起點 anchor 不見了）');
  const e = src.indexOf(endAnchor, s);
  ok(e > s, '抽不到 ' + what + '（終點 anchor 不見了）');
  const out = src.slice(s, e);
  ok(out.length > 80, what + ' 只抽到 ' + out.length + ' 字元，抽取器壞了？');
  return out;
}
function extractAppGet(src, needle, what) {
  const g = src.indexOf(needle);
  ok(g >= 0, '抽不到 ' + what);
  let i = src.indexOf('{', g), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  ok(end > 0, what + ' 大括號配對失敗');
  const close = src.indexOf(');', end);
  ok(close > 0, what + ' 找不到收尾 );');
  return src.slice(g, close + 2);
}

// ── ① 伺服器端 sandbox：真分類函式 + 兩個端點 ──
function buildServer(patchSrc, { rules, nameMapEntries, docs }) {
  const coreFns = sliceBetween(patchSrc, 'function deckToSets(cardCounts, nameMap) {',
    '\n    function sanitizeRule', '分類核心（deckToSets~classifyDeck）');
  const start = patchSrc.indexOf('const _roomArchCache = new Map();');
  ok(start >= 0, '抽不到 _roomArchCache 區塊');
  const ep = extractAppGet(patchSrc, "app.get('/api/rooms-archetypes'", '/api/rooms-archetypes 端點');
  const archBlock = patchSrc.slice(start, patchSrc.indexOf(ep) + ep.length);
  ok(archBlock.includes('function archetypeNameOf'), '中央 archetypeNameOf 不在 —— v6.229 改動不存在（HEAD-FAIL 錨點）');
  ok(archBlock.includes('_archetypeEnrichRooms'), 'admin enrich helper（_archetypeEnrichRooms）不在');
  const adminEp = extractAppGet(patchSrc, "app.get('/api/admin/oracle/rooms',", '/api/admin/oracle/rooms 端點');
  ok(adminEp.length > 800, 'admin 端點抽出來太短（' + adminEp.length + '），抽取器壞了？');
  const handlers = {};
  const app = { locals: {}, get: (path, ...rest) => { handlers[path] = rest[rest.length - 1]; } };
  const nameMap = new Map(nameMapEntries);
  const getCardNameMap = async () => nameMap;
  const getEnabledRulesCached = async () => rules;
  const db = {
    collection: () => ({
      find: (filter) => {
        const match = (d) => {
          if (filter && filter._id && filter._id.$in) return filter._id.$in.includes(d._id) && d.status === filter.status;
          if (filter && filter.status) return d.status === filter.status;
          return true;
        };
        // 深拷貝：兩個端點各自拿快照，互不污染（admin 端點會就地加 archetype 欄位）
        const arr = docs.filter(match).map((d) => JSON.parse(JSON.stringify(d)));
        const cursor = { sort: () => cursor, toArray: async () => arr };
        return cursor;
      },
      aggregate: () => ({ toArray: async () => [] }),
      countDocuments: async () => 0,
    }),
  };
  const summarizeRoom = (r) => { r.gameStateSummary = r.gameState ? { turn: r.gameState.turn ?? null } : null; delete r.gameState; return r; };
  const enrichSeats = async () => {};
  const requireFirebaseAdmin = () => {};
  const body = coreFns + '\n' + archBlock + '\n' + adminEp;
  new Function('app', 'db', 'getCardNameMap', 'getEnabledRulesCached', 'summarizeRoom', 'enrichSeats', 'requireFirebaseAdmin', body)(
    app, db, getCardNameMap, getEnabledRulesCached, summarizeRoom, enrichSeats, requireFirebaseAdmin);
  ok(typeof handlers['/api/rooms-archetypes'] === 'function', '大廳端點沒註冊');
  ok(typeof handlers['/api/admin/oracle/rooms'] === 'function', 'admin 端點沒註冊');
  return { app, handlers };
}
async function call(handler, query) {
  let out = null, code = 200;
  const res = { json: (x) => { out = x; return res; }, status: (c) => { code = c; return res; } };
  await handler({ query }, res);
  return { out, code };
}

const RULES = [{ _id: 'r1', name: '雙龍特調', includes: ['多龍巴魯托ex'], enabled: true, priority: 1 }];
const NAMEMAP = [['101', '多龍巴魯托ex'], ['102', '索羅亞克ex'], ['901', '基本【惡】能量']];
const deckHit = [{ cardId: '101', count: 3 }, { cardId: '901', count: 10 }];
const deckMiss = [{ cardId: '102', count: 4 }, { cardId: '901', count: 8 }];
const DOCS = [
  { _id: 'AAAA', status: 'playing', updatedAt: 2,
    seats: [{ uid: 'u1', name: '甲', deckEntries: deckHit }, { uid: 'u2', name: '乙', deckEntries: deckMiss }],
    gameState: { phase: 'playing', turn: 5 } },
  { _id: 'EEEE', status: 'ended', updatedAt: 1,
    seats: [{ uid: 'u3', name: '丙', deckEntries: deckHit }, { uid: 'u4', name: '丁' }],
    gameState: { phase: 'game-over', turn: 9 } },
];

/** 可重複用於突變測試的整組伺服器斷言（丟例外＝紅）。回傳大廳實際結果供 UI 端 end-to-end 用。 */
async function checkServer(patchSrc, opts) {
  const o = opts || {};
  const { handlers } = buildServer(patchSrc, { rules: o.noRules ? [] : RULES, nameMapEntries: NAMEMAP, docs: DOCS });
  const lobby = await call(handlers['/api/rooms-archetypes'], { ids: 'AAAA,EEEE' });
  const admin = await call(handlers['/api/admin/oracle/rooms'], {});
  ok(admin.out && Array.isArray(admin.out.rooms), 'admin 端點沒回 rooms 陣列');
  const aRooms = Object.fromEntries(admin.out.rooms.map((r) => [r._id, r]));
  const aA = aRooms.AAAA, aE = aRooms.EEEE;
  ok(aA && aE, 'admin 端點沒回兩間房');
  const lA = lobby.out.rooms.AAAA;
  if (o.noRules) {
    // 規則庫沒載入 ⇒ 兩端都是「還不知道」= null，且**不是**'未分類'
    ok(lA && lA.p1 === null && lA.p2 === null, '大廳：無規則時應回 null，實得 ' + JSON.stringify(lA));
    ok(aA.seats[0].archetype === null, 'admin：無規則時 archetype 應為 null，實得 ' + JSON.stringify(aA.seats[0].archetype));
    ok(aA.seats[0].archetype !== '未分類', 'admin 把「還不知道」誤標成「未分類」');
    ok(aA.seats[0].archetype === lA.p1, '⭐ 逐字相同不變量（null 情境）被打破');
    return { lobbyP1: lA.p1 };
  }
  // 命中／未分類：兩端逐字相同（===）
  ok(lA && lA.p1 === '雙龍特調', '大廳 p1 應為 雙龍特調，實得 ' + (lA && lA.p1));
  ok(lA.p2 === '未分類', '大廳 p2 應為 未分類，實得 ' + lA.p2);
  ok(aA.seats[0].archetype === lA.p1, '⭐ admin p1 與大廳不同：' + JSON.stringify(aA.seats[0].archetype) + ' vs ' + JSON.stringify(lA.p1));
  ok(aA.seats[1].archetype === lA.p2, '⭐ admin p2 與大廳不同：' + JSON.stringify(aA.seats[1].archetype) + ' vs ' + JSON.stringify(lA.p2));
  // 大廳因防狙擊限制不回 ended 房（＝還不知道），admin 必須自己分類得出來
  ok(!lobby.out.rooms.EEEE, '大廳不應回 ended 房（防狙擊限制被鬆動了？）');
  ok(aE.seats[0].archetype === '雙龍特調', 'admin 對 ended 房也要能分類，實得 ' + JSON.stringify(aE.seats[0].archetype));
  ok(aE.seats[1].archetype === null, '沒牌表的 seat 應為 null（還不知道），實得 ' + JSON.stringify(aE.seats[1].archetype));
  return { lobbyP1: lA.p1 };
}

console.log('① 伺服器端：admin 列表與大廳 /api/rooms-archetypes 是同一份分類結果');
let LOBBY_P1 = null;
await TA('⭐⭐ 命中規則／未分類 兩端逐字相同（===）+ ended 房 admin 可分類 + 無牌表=null', async () => {
  LOBBY_P1 = (await checkServer(PATCH)).lobbyP1;
});
await TA('⭐ 規則庫沒載入 ⇒ 兩端都是 null（還不知道），絕不是「未分類」', () => checkServer(PATCH, { noRules: true }));

// ── ② admin UI：renderRoomRow 實跑（DOM 輸出層斷言） ──
const CARD_INFO = { '201': { supertype: 'Pokemon', subtype: 'ex', name: '多龍巴魯托ex', displayName: '多龍巴魯托ex' } };
function buildRenderRow(htmlSrc) {
  const eh = sliceBetween(htmlSrc, 'function escapeHtml(s) {', '\n\n// ── Deck modal', 'escapeHtml');
  const dm = sliceBetween(htmlSrc, 'function detectMainPokemon(seat) {', '\nlet statsLoading', 'detectMainPokemon');
  const rr = sliceBetween(htmlSrc, 'function renderRoomRow(r, source) {', '\nfunction escapeHtml(', 'renderRoomRow');
  const src = eh + '\n' + dm + '\n' + rr + '\nreturn renderRoomRow;';
  return new Function('cardInfoMap', 'cardTagsCache', 'uidEmailMap', 'playerLink', src)(CARD_INFO, {}, new Map(), (e) => String(e));
}
const mkRoom = (seat) => ({ _id: 'R1', roomName: '房', status: 'playing', updatedAt: Date.now(),
  seats: [seat, null], gameStateSummary: { turn: 3, winner: null }, messageCount: 0 });
/** 可重複用於突變測試的整組 UI 斷言（丟例外＝紅）。 */
function checkUi(renderRow, lobbyName) {
  // 1) 已比對出結果（用大廳端點實跑拿到的那個字串）→ 顯示【名稱】（比照大廳 .or-arch 呈現）
  const hHit = renderRow(mkRoom({ uid: 'u', name: '甲', archetype: lobbyName, deckEntries: [{ cardId: '201', count: 4 }] }), 'oracle');
  ok(hHit.includes('【' + lobbyName + '】'),
    'admin 列不出與大廳同款的【' + lobbyName + '】標籤；輸出片段：' + hHit.slice(0, 300).replace(/\s+/g, ' '));
  ok(!hHit.includes('⚔️ 多龍巴魯托ex'), '有原型結果時不應再顯示舊「⚔️ 主力打手」badge（狀態 badge 的 ⚔️ 不算）');
  // 2) '未分類' 是「已比對出的結果」→ 正常顯示【未分類】
  const hUnc = renderRow(mkRoom({ uid: 'u', name: '甲', archetype: '未分類', deckEntries: [{ cardId: '201', count: 4 }] }), 'oracle');
  ok(hUnc.includes('【未分類】'), '「未分類」是已比對出的結果，必須顯示【未分類】');
  // 3) null＝還不知道 → 不顯示任何標籤（比照大廳），且**絕不可**顯示成「未分類」
  const hNull = renderRow(mkRoom({ uid: 'u', name: '甲', archetype: null, deckEntries: [{ cardId: '201', count: 4 }] }), 'oracle');
  ok(!hNull.includes('未分類'), '⭐ null（還不知道）被顯示成「未分類」—— 回傳語義違規');
  ok(!hNull.includes('【'), 'null（還不知道）不應顯示任何原型標籤（大廳也是如此）');
  ok(!hNull.includes('⚔️ 多龍巴魯托ex'), 'null 時不應退回主力打手（伺服器已表態「還不知道」；undefined 才是舊伺服器）');
  // 4) 欄位缺席（Firebase 分頁／舊伺服器）→ 退回舊 ⚔️ 主力打手（該分頁本版不得退化）
  const hOld = renderRow(mkRoom({ uid: 'u', name: '甲', deckEntries: [{ cardId: '201', count: 4 }] }), 'firebase');
  ok(hOld.includes('⚔️ 多龍巴魯托ex'),
    'archetype 欄位缺席時必須退回舊「⚔️ 主力打手」badge（Firebase 分頁／舊伺服器不可退化）');
}
console.log('② admin UI：renderRoomRow 的 DOM 輸出');
T('⭐⭐ 【原型】／【未分類】／null 無標籤／undefined 退回 ⚔️ 四情境', () => {
  ok(LOBBY_P1 === '雙龍特調', '伺服器端沒先跑出大廳結果（end-to-end 斷言前提）');
  checkUi(buildRenderRow(HTML), LOBBY_P1);
});

// ── ③ 搜尋行為 ──
function buildSearch(htmlSrc, rooms) {
  const eh = sliceBetween(htmlSrc, 'function escapeHtml(s) {', '\n\n// ── Deck modal', 'escapeHtml');
  const dm = sliceBetween(htmlSrc, 'function detectMainPokemon(seat) {', '\nlet statsLoading', 'detectMainPokemon');
  const rr = sliceBetween(htmlSrc, 'function renderRoomRow(r, source) {', '\nfunction escapeHtml(', 'renderRoomRow');
  const fs = sliceBetween(htmlSrc, 'window.filterRoomsBySearch = function(q, source) {', '\nfunction renderRoomRow', 'filterRoomsBySearch');
  const prelude = 'let statusFilter = "all"; let oracleRoomsPage = 1; let firebaseRoomsPage = 1;\n'
    + 'const ROOMS_PAGE_SIZE = 50; const oracleRoomsCache = ROOMS; const firebaseRoomsCache = [];\n';
  const src = prelude + eh + '\n' + dm + '\n' + rr + '\n' + fs + '\nreturn window.filterRoomsBySearch;';
  const captured = {};
  const documentStub = { getElementById: (id) => ({ set innerHTML(v) { captured[id] = v; }, get innerHTML() { return captured[id]; } }) };
  const search = new Function('window', 'document', 'ROOMS', 'cardInfoMap', 'cardTagsCache', 'uidEmailMap', 'playerLink', src)(
    {}, documentStub, rooms, CARD_INFO, {}, new Map(), (e) => String(e));
  return { search, captured };
}
console.log('③ 搜尋行為');
T('⭐ 原型名可搜、主力打手名仍可搜（保守：兩者都能搜）', () => {
  const rooms = [
    { _id: 'AR01', status: 'playing', updatedAt: 1, seats: [{ uid: 'a', name: '甲', archetype: '雙龍特調', deckEntries: [] }], gameStateSummary: null },
    { _id: 'MN01', status: 'playing', updatedAt: 1, seats: [{ uid: 'b', name: '乙', deckEntries: [{ cardId: '201', count: 4 }] }], gameStateSummary: null },
  ];
  const { search, captured } = buildSearch(HTML, rooms);
  search('雙龍特調', 'oracle');
  ok(captured['oracle-rooms-tbody'].includes('AR01'), '搜原型名找不到房 —— archetype 沒接進搜尋');
  ok(!captured['oracle-rooms-tbody'].includes('MN01'), '搜原型名撈到不相干的房');
  search('多龍巴魯托', 'oracle');
  ok(captured['oracle-rooms-tbody'].includes('MN01'), '主力打手搜尋退化了（站長沒說要移除，必須保留）');
  ok(!captured['oracle-rooms-tbody'].includes('AR01'), '搜主力打手撈到不相干的房');
});

// ── ④ 突變測試：守衛必須抓得到退化（正對照：斷言函式真的會咬人） ──
console.log('④ 突變測試');
await TA('突變S1：server 把「規則庫沒載入」改回 \'未分類\' ⇒ 守衛要紅', async () => {
  const needle = 'if (!nameMap.size || !rules.length) return null;';
  ok(PATCH.split(needle).length === 2, '突變錨點出現 ' + (PATCH.split(needle).length - 1) + ' 次（應為 1），突變無效');
  const mut = PATCH.replace(needle, "if (!nameMap.size || !rules.length) return '未分類';");
  let threw = false;
  try { await checkServer(mut, { noRules: true }); } catch { threw = true; }
  ok(threw, '突變後守衛竟然還是綠的 —— null 語義檢查是安慰劑');
});
await TA('突變S2：admin 端點拔掉 enrich ⇒ 守衛要紅', async () => {
  const needle = "if (typeof _archEnrich === 'function') await _archEnrich(rooms);";
  ok(PATCH.includes(needle), '突變錨點不見了');
  const mut = PATCH.replace(needle, '');
  let threw = false;
  try { await checkServer(mut); } catch { threw = true; }
  ok(threw, '突變後守衛竟然還是綠的 —— parity 檢查是安慰劑');
});
T('突變U1：UI 改回舊「主力打手」判定 ⇒ 守衛要紅', () => {
  ok(HTML.includes('_seatDeckBadge(p1)') && HTML.includes('_seatDeckBadge(p2)'), '突變錨點不見了');
  const mut = HTML.replace('_seatDeckBadge(p1)', '_mainBadge(detectMainPokemon(p1))')
                  .replace('_seatDeckBadge(p2)', '_mainBadge(detectMainPokemon(p2))');
  let threw = false;
  try { checkUi(buildRenderRow(mut), '雙龍特調'); } catch { threw = true; }
  ok(threw, '突變後守衛竟然還是綠的 —— UI 檢查是安慰劑');
});
T('突變U2：UI 把 null 顯示成「未分類」 ⇒ 守衛要紅', () => {
  const needle = '_archBadge(seat.archetype)';
  ok(HTML.includes(needle), '突變錨點不見了');
  const mut = HTML.replace(needle, "_archBadge(seat.archetype || '未分類')");
  let threw = false;
  try { checkUi(buildRenderRow(mut), '雙龍特調'); } catch { threw = true; }
  ok(threw, '突變後守衛竟然還是綠的 —— null≠未分類 檢查是安慰劑');
});

// ── ⑤ 效能 benchmark（Rule 32：量測腳本＝本檔） ──
console.log('⑤ 效能 benchmark');
await TA('300 房 × 2 席 × 60 卡 × 30 規則 enrich 一輪（量級檢核）', async () => {
  const rules = []; const nm = [];
  for (let i = 0; i < 3000; i++) nm.push([String(10000 + i), '卡' + i]);
  for (let r = 0; r < 30; r++) rules.push({ _id: 'b' + r, name: '原型' + r,
    includes: ['卡' + (r * 7), '卡' + (r * 7 + 1)], excludes: ['卡' + (r * 11 + 500)], enabled: true, priority: r });
  const mkDeck = (seed) => { const d = []; for (let i = 0; i < 60; i++) d.push({ cardId: String(10000 + ((seed * 13 + i * 3) % 3000)), count: 1 }); return d; };
  const roomsArr = [];
  for (let i = 0; i < 300; i++) roomsArr.push({ _id: 'B' + i, status: 'ended', seats: [{ uid: 'x', deckEntries: mkDeck(i) }, { uid: 'y', deckEntries: mkDeck(i + 7) }] });
  const { app } = buildServer(PATCH, { rules, nameMapEntries: nm, docs: [] });
  const t0 = performance.now();
  await app.locals._archetypeEnrichRooms(roomsArr);
  const ms = performance.now() - t0;
  console.log('      600 副牌分類共 ' + ms.toFixed(1) + 'ms（沙盒；正式 VM 約再快 ~10×）');
  ok(roomsArr.every((d) => typeof d.seats[0].archetype === 'string' && typeof d.seats[1].archetype === 'string'),
    'enrich 沒把 archetype 填上');
  ok(ms < 3000, '600 副牌分類竟要 ' + ms.toFixed(0) + 'ms —— 量級不對，會拖慢 admin 分頁');
});

console.log('');
if (fail) { console.log('FAIL: ' + fail + ' / ' + (pass + fail)); process.exit(1); }
console.log('PASS: ' + pass + ' / ' + (pass + fail));
