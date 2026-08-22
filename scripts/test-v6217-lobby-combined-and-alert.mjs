// v6.217 守衛：尖峰請求減量第二批 —— 全部斷言到「行為層」（實跑，不是 grep 字串）
//
//   ①② 休閒大廳列表合併+204：
//      後端：抽 server_admin_patch.js 的 PTCG-ROOMS-COMBINED-BLOCK 在模擬 Express stack 實跑 ——
//        status=lobby,playing 一發回兩組($in 查詢+projection)、帶同 h 實際回 204、
//        playing 房噪音欄位(updatedAt/_version/heartbeats)變動仍 204、lobby 房心跳變動必回 200、
//        單一 status/POST/無 Authorization/DB 例外一律 next()（fail-open）、hoist 到第一個 route 前。
//      前端：esbuild 轉譯後實跑 subscribeOpenRooms —— 一發合併、204 沿用上一包**重跑過濾**
//        （過期 lobby 房要消失）、UNSUPPORTED 當發退回兩支舊輪詢、節奏維持 2000ms；
//        oracleListRoomsCombined 三態（200+combined / 204 / 200 無旗標）。
//   ④ 跨房提醒 /event 輪詢 60000ms（原 30000）。
//   ⑤ 觀戰輪詢 4000ms —— 由更新後的 test-v6161 harness 實跑釘住，此處驗 +page.svelte 常數已改。
//
// HEAD-FAIL（於 BASE=v6.216(3d5c3b89) 實跑過，紅）：
//   ① BASE 沒有 ROOMS-COMBINED 區塊 ⇒ 抽取紅。
//   ② BASE 的 oracle-client.ts 沒有 oracleListRoomsCombined ⇒ 抽取紅；
//      BASE 的 subscribeOpenRooms 無合併路徑 ⇒ 「一發合併」紅。
//   ④ BASE 是 setInterval(poll, 30000) ⇒ 60000 斷言紅。
//   ⑤ BASE 觀戰 2000 ⇒ 更新後的 v6161 守衛斷言 4000 紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');
const PG = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function T(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;

// ── 模擬 Express stack（同 test-v6178/test-v6216）──
function makeApp() {
  const stack = [
    { handle: function query() {} },
    { handle: function expressInit() {} },
    { handle: function corsMiddleware() {} },
    { handle: function jsonParser() {} },
    { route: { path: '/api/health' } },
    { route: { path: '/api/auth/anonymous' } },
    { route: { path: '/api/rooms' } },
    { route: { path: '/api/rooms/:code' } },
    { route: { path: '/api/rooms/:code/messages' } },
  ];
  const app = { use(fn) { stack.push({ handle: fn }); } };
  app._router = { stack };
  Object.defineProperty(app, 'router', { get() { throw new Error("'app.router' is deprecated!"); } });
  app.__stack = stack;
  return app;
}
function extractBlock(src, sentS, sentE) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  if (si < 0 || ei <= si) return null;
  const nl = src.indexOf('\n', si);
  return src.slice(nl + 1, ei);
}

// ═══ ①② 後端 middleware ═══
console.log('①② 後端：GET /api/rooms?status=lobby,playing —— 合併查詢＋內容未變 204');
const RCBLOCK = extractBlock(PATCH, '// >>> PTCG-ROOMS-COMBINED-BLOCK-START', '// <<< PTCG-ROOMS-COMBINED-BLOCK-END');

// fixture：一 lobby 一 playing（欄位形狀貼近真 doc；gameState/seats.deckEntries 由 projection 剔，
// 所以 fixture 直接不含它們——middleware 拿到的就是 projection 後的 doc）
const mkRooms = () => ([
  { _id: 'AAAA', _version: 3, status: 'lobby', roomName: '練習房', hostUid: 'u1', hostName: '甲',
    schemaVersion: 2, createdAt: 1000, updatedAt: 2000, visible: true,
    heartbeats: { 0: 1500 }, seats: [{ role: 'p1', uid: 'u1', name: '甲' }] },
  { _id: 'BBBB', _version: 99, status: 'playing', roomName: '對戰房', hostUid: 'u2', hostName: '乙',
    schemaVersion: 2, createdAt: 900, updatedAt: 5000, visible: true,
    heartbeats: { 0: 4900, 1: 4800 }, seats: [{ role: 'p1', uid: 'u2', name: '乙' }, { role: 'p2', uid: 'u3', name: '丙' }] },
]);
async function runRcBlock(roomsProvider) {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const findCalls = [];
  const db = { collection: (name) => ({ find: (q, o) => {
    findCalls.push({ name, q, o });
    return { limit: () => ({ sort: () => ({ toArray: async () => {
      if (roomsProvider.throws) throw new Error('db down');
      return roomsProvider.rooms();
    } }) }) };
  } }) };
  const app = makeApp();
  const before = new Set(app.__stack.map((l) => l.handle));
  await new Function('app', 'db', 'console',
    '"use strict"; return (async () => {\n' + RCBLOCK + '\n})();')(app, db, fakeConsole);
  const li = app.__stack.findIndex((l) => l && l.handle && !l.route && !before.has(l.handle));
  return { logs, app, mw: li >= 0 ? app.__stack[li].handle : null, mwIdx: li, findCalls };
}
async function callMw(mw, method, url, auth = 'Bearer tok') {
  const res = { _status: null, _ended: false, _json: null,
    status(c) { this._status = c; return this; },
    end() { this._ended = true; return this; },
    json(x) { this._json = x; this._ended = true; return this; } };
  let nexted = false;
  const headers = auth === null ? {} : { authorization: auth };
  await mw({ method, originalUrl: url, url, headers }, res, () => { nexted = true; });
  return { res, nexted };
}
await T('⭐⭐⭐ 合併請求一發回兩組：200 {rooms, combined:true, h}，查詢用 $in＋projection 剔大欄位', async () => {
  ok(RCBLOCK, '抽不到 ROOMS-COMBINED 區塊（BASE=v6.216 沒有這一段 ⇒ HEAD-FAIL 紅點）');
  const r = await runRcBlock({ rooms: mkRooms });
  ok(r.mw, 'middleware 沒被掛上');
  const c = await callMw(r.mw, 'GET', '/api/rooms?status=lobby%2Cplaying');
  ok(c.res._status === 200 && c.res._json, '沒回 200 JSON（status=' + c.res._status + '）');
  ok(!c.nexted, '回了 200 卻還 next()');
  ok(c.res._json.combined === true, '回應缺 combined:true 哨兵 —— client 會誤判成舊伺服器而退回兩支輪詢');
  ok(Array.isArray(c.res._json.rooms) && c.res._json.rooms.length === 2, 'rooms 不是兩筆');
  ok(typeof c.res._json.h === 'string' && c.res._json.h.length > 0, '沒回 digest h');
  const q = r.findCalls[0];
  ok(q && q.name === 'rooms', '查錯 collection：' + (q && q.name));
  ok(q.q.status && Array.isArray(q.q.status.$in) && q.q.status.$in.join(',') === 'lobby,playing',
    '查詢不是 $in：' + JSON.stringify(q.q));
  ok(q.o && q.o.projection && q.o.projection['seats.deckEntries'] === 0 && q.o.projection.gameState === 0,
    'projection 沒剔 seats.deckEntries/gameState（回應會爆體積+洩盤面）：' + JSON.stringify(q.o));
});
await T('⭐⭐⭐ 帶同一個 h 再打 → 實際回 204 零 body；內容變了 → 200 新 h', async () => {
  const r = await runRcBlock({ rooms: mkRooms });
  const c1 = await callMw(r.mw, 'GET', '/api/rooms?status=lobby%2Cplaying');
  const h = c1.res._json.h;
  const c2 = await callMw(r.mw, 'GET', '/api/rooms?status=lobby%2Cplaying&h=' + encodeURIComponent(h));
  ok(c2.res._status === 204 && c2.res._ended && !c2.nexted, '同 h 沒回 204（status=' + c2.res._status + '）');
  ok(c2.res._json === null, '204 卻帶了 body');
  // 內容變化（新房間出現）→ 200
  const rooms2 = mkRooms(); rooms2.push({ _id: 'CCCC', _version: 1, status: 'lobby', roomName: '新房', hostUid: 'u9', hostName: '丁', schemaVersion: 2, createdAt: 3000, updatedAt: 3000, heartbeats: { 0: 3000 }, seats: [] });
  const r2 = await runRcBlock({ rooms: () => rooms2 });
  const c3 = await callMw(r2.mw, 'GET', '/api/rooms?status=lobby%2Cplaying&h=' + encodeURIComponent(h));
  ok(c3.res._status === 200 && c3.res._json && c3.res._json.h !== h, '新房間出現卻還回 204 —— 玩家會看不到新房');
});
await T('⭐⭐⭐ 噪音欄位不觸發重傳：playing 房 updatedAt/_version/heartbeats 變動後仍 204', async () => {
  const r = await runRcBlock({ rooms: mkRooms });
  const h = (await callMw(r.mw, 'GET', '/api/rooms?status=lobby%2Cplaying')).res._json.h;
  const noisy = mkRooms();
  noisy[1].updatedAt = 999999; noisy[1]._version = 100; noisy[1].heartbeats = { 0: 999998, 1: 999997 };
  noisy[0].updatedAt = 888888; noisy[0]._version = 7;   // lobby 房的 updatedAt/_version 也是噪音
  const r2 = await runRcBlock({ rooms: () => noisy });
  const c = await callMw(r2.mw, 'GET', '/api/rooms?status=lobby%2Cplaying&h=' + encodeURIComponent(h));
  ok(c.res._status === 204, '對戰中每一手都 bump updatedAt/_version ⇒ 不剔它們 204 永遠不命中（status=' + c.res._status + '）');
});
await T('⭐⭐ 正對照：lobby 房 heartbeats 變動必回 200（isLobbyHostDead 靠新心跳把死房判活）', async () => {
  const r = await runRcBlock({ rooms: mkRooms });
  const h = (await callMw(r.mw, 'GET', '/api/rooms?status=lobby%2Cplaying')).res._json.h;
  const hb = mkRooms(); hb[0].heartbeats = { 0: 700000 };
  const r2 = await runRcBlock({ rooms: () => hb });
  const c = await callMw(r2.mw, 'GET', '/api/rooms?status=lobby%2Cplaying&h=' + encodeURIComponent(h));
  ok(c.res._status === 200, 'lobby 房心跳被當噪音剔掉 —— client 拿舊心跳會把活房誤判成死房而隱藏');
});
await T('⭐⭐ fail-open：單一 status／POST／無 Authorization／DB 例外 → 一律 next() 不攔', async () => {
  const r = await runRcBlock({ rooms: mkRooms });
  ok((await callMw(r.mw, 'GET', '/api/rooms?status=lobby')).nexted, '舊 client 的 ?status=lobby 被攔了');
  ok((await callMw(r.mw, 'GET', '/api/rooms?status=playing')).nexted, '舊 client 的 ?status=playing 被攔了');
  ok((await callMw(r.mw, 'GET', '/api/rooms')).nexted, '不帶 status 被攔了');
  ok((await callMw(r.mw, 'POST', '/api/rooms?status=lobby%2Cplaying')).nexted, 'POST 被攔了');
  ok((await callMw(r.mw, 'GET', '/api/rooms/ABCD?status=lobby%2Cplaying')).nexted, '單房輪詢被攔了');
  ok((await callMw(r.mw, 'GET', '/api/rooms?status=lobby%2Cplaying', null)).nexted, '無 Authorization 沒交給核心 requireAuth');
  const rt = await runRcBlock({ rooms: mkRooms, throws: true });
  const ce = await callMw(rt.mw, 'GET', '/api/rooms?status=lobby%2Cplaying');
  ok(ce.nexted && ce.res._status === null, 'DB 掛了沒有 fail-open（大廳會直接壞掉而不是退回舊行為）');
});
await T('⭐⭐ middleware 實際被 hoist 到第一個 route layer 之前，且 log 印 hoisted=true', async () => {
  const r = await runRcBlock({ rooms: mkRooms });
  const fr = r.app.__stack.findIndex((l) => !!(l && l.route));
  ok(r.mwIdx >= 0 && fr >= 0 && r.mwIdx < fr, 'mwIdx=' + r.mwIdx + ' firstRoute=' + fr + ' —— 核心 /api/rooms 會先把回應 end 掉');
  ok(r.mwIdx >= 2, '插得太前面（在 expressInit 之前，res.json 都還沒裝上）');
  ok(r.logs.some((l) => l.includes('combined-list middleware (v1.17) hoisted=true')), 'log 沒印 hoisted=true：' + r.logs.join('|'));
});

// ═══ ①② 前端 ═══
console.log('①② 前端：subscribeOpenRooms 合併輪詢＋204 重跑過濾＋UNSUPPORTED 退回兩支');
function extractFn(src, name, endMark) {
  const i = src.indexOf('function ' + name + '(');
  ok(i >= 0, '抽不到 ' + name + '（BASE 沒有 ⇒ HEAD-FAIL 紅點）');
  const start = src.lastIndexOf('\n', i) + 1;
  const j = src.indexOf(endMark, i);
  ok(j >= 0, name + ' 結尾抽取失敗');
  return src.slice(start, j + endMark.length).replace(/^export /, '');
}
await T('⭐ oracleListRoomsCombined 三態：200+combined→{rooms,h}；204→UNCHANGED；200 無旗標→UNSUPPORTED', async () => {
  const decl = 'const ROOMS_UNCHANGED = Symbol("u");\nconst ROOMS_COMBINED_UNSUPPORTED = Symbol("n");\n';
  const js = decl + ts2js(extractFn(OC, 'oracleListRoomsCombined', '\n}'));
  const urls = [];
  let reply;
  const api = async (path) => { urls.push(path); return reply; };
  const fn = new Function('oracleApi', js + '\n;return { fn: oracleListRoomsCombined, U: ROOMS_UNCHANGED, N: ROOMS_COMBINED_UNSUPPORTED };')(api);
  reply = { rooms: [{ _id: 'A' }], combined: true, h: 'h1' };
  const r1 = await fn.fn(null);
  ok(r1 && r1.h === 'h1' && r1.rooms.length === 1, '200+combined 沒解析出 rooms/h');
  ok(urls[0].includes('/api/rooms?status=lobby%2Cplaying') && !urls[0].includes('h='), '第一發 URL 錯：' + urls[0]);
  reply = undefined;                              // oracleApi 對 204 回 undefined
  ok((await fn.fn('h1')) === fn.U, '204 沒轉成 ROOMS_UNCHANGED');
  ok(urls[1].includes('&h=h1'), '第二發沒帶 h：' + urls[1]);
  reply = { rooms: [] };                          // 舊伺服器：字面值查詢回空、無 combined
  ok((await fn.fn('h1')) === fn.N, '舊伺服器的 {rooms:[]} 沒判成 UNSUPPORTED —— 大廳會永遠顯示「沒有公開房間」');
});
function buildSubscribe(stubs) {
  const fns = extractFn(RO, 'filterAndSortOpenRooms', '\n}') + '\n' + extractFn(RO, 'subscribeOpenRooms', '\n}');
  const js = ts2js(fns);
  return new Function(
    'oracleListRoomsCombined', 'oracleListRooms', 'ROOMS_UNCHANGED', 'ROOMS_COMBINED_UNSUPPORTED',
    'adoptOrKeep', 'SEAT_LAYOUT_VERSION', 'isLobbyHostDead', 'isLobbyTooOld',
    'setTimeout', 'clearTimeout', 'console',
    js + '\n;return subscribeOpenRooms;',
  )(
    stubs.combined, stubs.legacy, stubs.U, stubs.N,
    (last, cur) => ({ data: cur !== null ? cur : last }),   // adoptOrKeep 的最小語義
    2, stubs.hostDead || (() => false), stubs.tooOld || (() => false),
    stubs.setTimeout, () => {}, { warn: () => {} },
  );
}
const U = Symbol('u'), N = Symbol('n');
const roomL = (id, extra) => ({ _id: id, status: 'lobby', schemaVersion: 2, createdAt: 100, ...extra });
const roomP = (id, extra) => ({ _id: id, status: 'playing', schemaVersion: 2, createdAt: 90, ...extra });
await T('⭐⭐⭐ 支援合併的伺服器：每 tick 只打 1 發合併請求（不再打兩支），節奏維持 2000ms', async () => {
  const calls = { combined: 0, legacy: [] }; const delays = []; let timerCb = null; let reply;
  const sub = buildSubscribe({
    U, N,
    combined: async (h) => { calls.combined++; calls.lastH = h; return reply; },
    legacy: async (s) => { calls.legacy.push(s); return []; },
    setTimeout: (cb, d) => { delays.push(d); timerCb = cb; return 1; },
  });
  const cbs = [];
  reply = { rooms: [roomL('AAAA'), roomP('BBBB')], h: 'h1' };
  const unsub = sub((rooms) => cbs.push(rooms));
  await new Promise((r) => setTimeout(r, 20));
  ok(calls.combined === 1 && calls.legacy.length === 0, '第一發不是單發合併（combined=' + calls.combined + ' legacy=' + calls.legacy.length + '）');
  ok(cbs.length === 1 && cbs[0].length === 2, '第一發沒 callback 兩房（' + (cbs[0] && cbs[0].length) + '）');
  ok(cbs[0][0].roomId === 'AAAA', 'lobby 房（createdAt 較新）沒排前面');
  reply = U;                                    // 伺服器 204
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(calls.combined === 2 && calls.lastH === 'h1', '第二發沒帶上一發的 h（=' + calls.lastH + '）—— 伺服器永遠回全量，這一版等於沒做');
  ok(cbs.length === 2 && cbs[1].length === 2, '204 之後沒 callback —— 死房/殭屍房過濾不會再跑');
  ok(delays.length >= 2 && delays.every((d) => d === 2000), '輪詢節奏變了：' + JSON.stringify(delays) + '（站長裁定維持 2 秒）');
  const n = delays.length; unsub(); timerCb = null;
  ok(delays.length === n, 'unsubscribe 後還在排下一發');
});
await T('⭐⭐⭐ 204 沿用上一包時**重跑過濾**：過期的 lobby 房要從列表消失（時間函數不能凍結）', async () => {
  let expired = false; let timerCb = null; let reply;
  const sub = buildSubscribe({
    U, N,
    combined: async () => reply,
    legacy: async () => [],
    tooOld: (r) => r.status === 'lobby' && expired,
    setTimeout: (cb) => { timerCb = cb; return 1; },
  });
  const cbs = [];
  reply = { rooms: [roomL('AAAA'), roomP('BBBB')], h: 'h1' };
  sub((rooms) => cbs.push(rooms));
  await new Promise((r) => setTimeout(r, 20));
  ok(cbs[0].length === 2, '前置：兩房都在');
  expired = true; reply = U;                    // 內容沒變（204），但 lobby 房已超過 10 分鐘
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(cbs.length === 2 && cbs[1].length === 1 && cbs[1][0].roomId === 'BBBB',
    '204 之後殭屍 lobby 房沒消失（' + JSON.stringify(cbs[1] && cbs[1].map((x) => x.roomId)) + '）—— 過濾必須每 tick 重跑');
});
await T('⭐⭐ 舊伺服器（UNSUPPORTED）：這一發就退回兩支舊輪詢，之後不再打合併端點', async () => {
  const calls = { combined: 0, legacy: [] }; let timerCb = null;
  const sub = buildSubscribe({
    U, N,
    combined: async () => { calls.combined++; return N; },
    legacy: async (s) => { calls.legacy.push(s); return s === 'lobby' ? [roomL('AAAA')] : [roomP('BBBB')]; },
    setTimeout: (cb) => { timerCb = cb; return 1; },
  });
  const cbs = [];
  sub((rooms) => cbs.push(rooms));
  await new Promise((r) => setTimeout(r, 20));
  ok(calls.combined === 1, '合併端點打了 ' + calls.combined + ' 次');
  ok(calls.legacy.join(',') === 'lobby,playing', 'UNSUPPORTED 當發沒有立刻退回兩支舊輪詢：' + calls.legacy.join(','));
  ok(cbs.length === 1 && cbs[0].length === 2, '退回舊路徑後沒 callback 合併結果');
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(calls.combined === 1 && calls.legacy.length === 4, '下一 tick 又去打合併端點（combined=' + calls.combined + '）—— 每 2 秒白打一發');
});
await T('⭐ 網路錯誤：不退回舊協定、不清空列表（沿用上一包重跑過濾）', async () => {
  const calls = { combined: 0, legacy: 0 }; let timerCb = null; let mode = 'ok';
  const sub = buildSubscribe({
    U, N,
    combined: async () => { calls.combined++; if (mode === 'err') throw new Error('net down'); return { rooms: [roomL('AAAA')], h: 'h1' }; },
    legacy: async () => { calls.legacy++; return []; },
    setTimeout: (cb) => { timerCb = cb; return 1; },
  });
  const cbs = []; const errs = [];
  sub((rooms) => cbs.push(rooms), (e) => errs.push(e));
  await new Promise((r) => setTimeout(r, 20));
  mode = 'err';
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(errs.length === 1, 'onError 沒被叫');
  ok(cbs.length === 2 && cbs[1].length === 1, '網路錯誤後列表被清空/凍結（cbs=' + cbs.length + '）—— v6.177 紀律');
  ok(calls.legacy === 0, '網路錯誤被當成「不支援」退回舊協定 —— 尖峰時減量會消失');
  mode = 'ok';
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(calls.combined === 3, '錯誤後沒有繼續走合併協定');
});

// ═══ ④⑤ 輪詢間隔常數 ═══
console.log('④⑤ 跨房提醒 60s／觀戰 4s（觀戰行為由更新後的 test-v6161 harness 實跑）');
await T('⭐ 跨房提醒 /event 輪詢＝60000ms（v6.217④，原 30000）', async () => {
  const i = PG.indexOf('tAlertPollTimer = setInterval(poll,');
  ok(i >= 0, '抽不到 tAlertPollTimer 的 setInterval');
  const seg = PG.slice(i, PG.indexOf('\n', i));
  ok(seg.includes('60000'), '間隔不是 60000：' + seg.trim() + '（BASE=30000 ⇒ HEAD-FAIL 紅點）');
  ok(!PG.includes('setInterval(poll, 30000)'), '還留著 30000 的舊呼叫');
});
await T('⭐ 觀戰輪詢檔位＝4000（v6.217⑤，原 2000；base tick 400 的整數倍）', async () => {
  const i = PG.indexOf('function tPollDesiredMs(');
  ok(i >= 0, '抽不到 tPollDesiredMs');
  const body = PG.slice(i, PG.indexOf('\n  }', i));
  ok(/if \(spectate\) return 4000;/.test(body), '觀戰檔位不是 4000（BASE=2000 ⇒ HEAD-FAIL 紅點）');
  ok(/spectate\) return 10000/.test(body), 'game-over 觀戰 10000 檔位被動到了（v6.146 既有行為）');
});

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ' — ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
