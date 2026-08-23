// v6.220 守衛：【A】gameState.log 增量下發 ＋【B】seats[].email 不下發玩家端
//
// 全部斷言到「行為層」——把 server_admin_patch.js 的 PTCG-ROOMS-OUT 區塊與
// oracle-client.ts 的 v6220-log-delta-client-core 區塊抽出來**實跑**，
// 用同一份資料讓「伺服器轉換 → 走線(JSON round-trip) → client 重組」整條管線跑起來，
// 逐則比對重組結果與伺服器完整 log。
//
// 涵蓋情境：
//   多輪成長增量（含「版本變了但 log 沒長」的空增量）／悔棋(log 變短)／
//   等長但內容不同／舊 client 不帶參數／空 log／gameState 缺席(大廳)／
//   觀戰與重連第一發(無前綴)／伺服器回壞 fh 時 client 立即改抓全量(oraclePollRoom 實跑)
// 突變測試（守衛必須變紅的證明，做成正反對照）：
//   ①client 重組故意錯一格(前綴反轉,長度不變) → fh 端到端複驗必須攔下(ok:false)
//   ②server 切片故意多切一則 → client 複驗必須攔下(ok:false)
// 【B】：GET 單房/GET 列表/PUT 回應/v1.17 combined 列表 email 全剝、DB 原 doc 不被改；
//   PUT 回填(uid 相同才回填、不同不回填、沒缺 email 不查 DB)；/api/match-result 伺服器補 email。
// 量測（Rule 32）：第 9 回合等級房間 doc，全量 vs 增量 wire 大小（raw + gzip level 1），
//   腳本即本檔（scripts/test-v6220-log-delta-and-email-privacy.mjs），數字隨測試輸出。
//
// HEAD-FAIL（於 BASE=62023cbc(v6.219) 實跑過，紅）：
//   BASE 沒有 PTCG-ROOMS-OUT 區塊 / v6220-log-delta-client-core 標記 /
//   PTCG-MATCH-EMAIL-ENRICH 區塊 / oraclePollRoom 不帶 logSince ⇒ 抽取與行為斷言全紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function T(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;
const wire = (x) => JSON.parse(JSON.stringify(x));   // 模擬走線：序列化→反序列化

function extractBlock(src, sentS, sentE) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  if (si < 0 || ei <= si) return null;
  const nl = src.indexOf('\n', si);
  return src.slice(nl + 1, ei);
}

// ── 模擬 Express stack（同 test-v6216/v6217，逐行對齊 server.js 的實際註冊順序）──
function makeStack() {
  return [
    { handle: function query() {} },
    { handle: function expressInit() {} },
    { handle: function corsMiddleware() {} },
    { handle: function jsonParser() {} },
    { route: { path: '/api/health' } },
    { route: { path: '/api/auth/anonymous' } },
    { route: { path: '/api/rooms' } },
    { route: { path: '/api/rooms/:code' } },
    { route: { path: '/api/rooms/:code/messages' } },
    { route: { path: '/api/rooms/:code/stream' } },
  ];
}
function makeApp() {
  const stack = makeStack();
  const app = { use(fn) { stack.push({ handle: fn }); } };
  app._router = { stack };
  Object.defineProperty(app, 'router', { get() { throw new Error("'app.router' is deprecated!"); } });
  app.__stack = stack;
  return app;
}
function fakeReq(method, url, body, headers) {
  return { method, originalUrl: url, url, headers: headers || {}, body };
}
function fakeRes() {
  const r = { statusCode: 200, body: undefined, ended: false, jsonCalled: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.jsonCalled = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}

// ═════════ 抽出 server 端 PTCG-ROOMS-OUT 區塊並實跑 ═════════
const ROBLOCK = extractBlock(PATCH, '// >>> PTCG-ROOMS-OUT-BLOCK-START', '// <<< PTCG-ROOMS-OUT-BLOCK-END');
const dbFixture = { calls: [], findOneResult: null };
async function runRoomsOutBlock(blockText) {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const db = { collection: (name) => ({ findOne: async (q, o) => { dbFixture.calls.push({ name, q, o }); return dbFixture.findOneResult; } }) };
  const app = makeApp();
  const before = new Set(app.__stack.map((l) => l.handle));
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + blockText + '\n})();')(app, db, fakeConsole);
  const news = app.__stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle);
  ok(news.length === 2, '應掛上 2 支 middleware，實得 ' + news.length);
  ok(logs.some((l) => l.includes('rooms-out transform middleware (v1.20) hoisted=true')), 'hoist 失敗: ' + logs.join('|'));
  let outMw = null, keepMw = null;
  for (const h of news) {
    const req = fakeReq('GET', '/api/rooms/PROBE');
    const res = fakeRes(); const orig = res.json;
    await h(req, res, () => {});
    if (res.json !== orig) outMw = h; else keepMw = h;
  }
  ok(outMw && keepMw && outMw !== keepMw, '分不出 out-mw / put-keep-mw');
  return { outMw, keepMw, logs };
}

// 模擬「out-mw → 核心端點 res.json({room})」→ 走線
async function serveGetSingle(outMw, doc, params) {
  const url = '/api/rooms/' + doc._id + (params ? '?' + params : '');
  const req = fakeReq('GET', url);
  const res = fakeRes();
  let nexted = false;
  await outMw(req, res, () => { nexted = true; });
  ok(nexted, 'out-mw 不該對 GET 自己回應');
  res.json({ room: wire(doc) });
  ok(res.jsonCalled, 'res.json 沒被呼叫');
  return wire(res.body);
}

// ═════════ 抽出 client 端 v6220-log-delta-client-core 並實跑 ═════════
const CCBLOCK = extractBlock(OC, '// >>> v6220-log-delta-client-core', '// <<< v6220-log-delta-client-core');
function evalClientCore(tsText) {
  const js = ts2js(tsText.replace(/^export /gm, ''));
  return new Function('"use strict";\n' + js + '\nreturn { logChainHash, mergePolledRoomLog };')();
}

// ═════════ 測試資料：貼近真 doc 的房間與 log ═════════
function mkEntry(turn, i) {
  const e = {
    turn,
    playerIndex: i % 3 === 2 ? null : i % 2,
    message: `第${turn}回合 動作${i}：使用了招式「範例攻擊」，對戰鬥場的寶可夢造成 ${i * 10} 點傷害，並抽了 2 張卡。`,
    timestamp: 1756000000000 + i * 1500,
  };
  if (i % 4 === 1) e.privateMessage = `私有訊息 ${i}：搜到「範例卡片${i}號」加入手牌（給對手看過）`;
  if (i % 5 === 3) e.sourceIid = 'iid_' + i;
  return e;
}
function mkRoomDoc(nLog) {
  const log = [];
  for (let i = 0; i < nLog; i++) log.push(mkEntry(1 + Math.floor(i / 22), i));
  return {
    _id: 'AB12', _version: 40, createdAt: 1756000000000, updatedAt: 1756000300000,
    status: 'playing', schemaVersion: 2, hostUid: 'u1',
    seats: [
      { role: 'p1', uid: 'u1', email: 'alice@example.com', name: '甲', ready: true, deckEntries: null },
      { role: 'p2', uid: 'u2', email: 'bob@example.com', name: '乙', ready: true, deckEntries: null },
      { role: 'spectator', uid: 'u3', email: 'spec@example.com', name: '丙', ready: false, deckEntries: null },
    ],
    memberUids: ['u1', 'u2', 'u3'],
    gameState: {
      id: 'g1', phase: 'playing', turn: 9, activePlayerIndex: 0,
      players: [
        { name: '甲', filler: 'x'.repeat(9000) },   // 模擬盤面其餘 ~40% 體積
        { name: '乙', filler: 'y'.repeat(9000) },
      ],
      log,
    },
  };
}

console.log('═══ 【A】伺服器轉換 → 走線 → client 重組：端到端行為 ═══');
ok(ROBLOCK, 'HEAD-FAIL：抽不到 PTCG-ROOMS-OUT 區塊（BASE 沒有此實作）');
ok(CCBLOCK, 'HEAD-FAIL：抽不到 v6220-log-delta-client-core 區塊');
const C = evalClientCore(CCBLOCK);
const { outMw, keepMw } = await runRoomsOutBlock(ROBLOCK);

function assertLogsEqual(a, b, tag) {
  ok(Array.isArray(a) && Array.isArray(b), tag + '：log 不是陣列');
  ok(a.length === b.length, tag + `：長度 ${a.length} != ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    ok(JSON.stringify(a[i]) === JSON.stringify(b[i]), tag + `：第 ${i} 則不同`);
  }
}

await T('⭐⭐⭐ 多輪對局逐步增量：12 輪重組結果與伺服器全量「逐則」相同，且第 2 輪起真的走增量（正對照）', async () => {
  const doc = mkRoomDoc(6);
  let clientLog = null;   // client 端「已採納的完整 log」（鏈基準）
  let deltaRounds = 0;
  for (let round = 1; round <= 12; round++) {
    if (round > 1) {   // 每輪長 0~3 則（第 5 輪刻意 0 則=只有版本 bump，如心跳）
      const grow = round === 5 ? 0 : (round % 3) + 1;
      const base = doc.gameState.log.length;
      for (let k = 0; k < grow; k++) doc.gameState.log.push(mkEntry(9, base + k));
      doc._version++;
    }
    let params = 'since=' + (doc._version - 1);
    if (clientLog && clientLog.length > 0) {
      params += `&logSince=${clientLog.length}&logh=${encodeURIComponent(C.logChainHash(clientLog, clientLog.length))}`;
    }
    const body = await serveGetSingle(outMw, doc, params);
    if (body.logDelta) {
      deltaRounds++;
      ok(body.room.gameState.log.length === doc.gameState.log.length - body.logDelta.since,
        '增量包長度不對');
    }
    const merged = C.mergePolledRoomLog(clientLog, body.room, body.logDelta ?? null);
    ok(merged.ok, `第 ${round} 輪重組失敗（不該發生）`);
    clientLog = merged.nextLog;
    assertLogsEqual(merged.room.gameState.log, doc.gameState.log, `第 ${round} 輪`);
  }
  ok(deltaRounds >= 10, `12 輪只有 ${deltaRounds} 輪走增量 —— 增量機制沒生效（安慰劑）`);
  ok(doc.gameState.log.length >= 20, '掃描下限：測試資料 log 太短，掃描器可能壞了');
});

await T('⭐⭐⭐ 悔棋（伺服器 log 變短）→ 伺服器回全量（無 logDelta），重組後逐則相同', async () => {
  const doc = mkRoomDoc(9);
  const clientLog = doc.gameState.log.map((e) => wire(e));   // client 已有 9 則
  doc.gameState.log = doc.gameState.log.slice(0, 5);          // 悔棋：伺服器只剩 5 則
  doc._version++;
  const params = `since=1&logSince=${clientLog.length}&logh=${encodeURIComponent(C.logChainHash(clientLog, clientLog.length))}`;
  const body = await serveGetSingle(outMw, doc, params);
  ok(!body.logDelta, '悔棋後竟然還回增量');
  const merged = C.mergePolledRoomLog(clientLog, body.room, body.logDelta ?? null);
  ok(merged.ok, '全量重組失敗');
  assertLogsEqual(merged.room.gameState.log, doc.gameState.log, '悔棋');
});

await T('⭐⭐⭐ 長度相同但內容不同（前綴不符）→ 伺服器回全量，不會靜默錯亂', async () => {
  const doc = mkRoomDoc(8);
  const clientLog = doc.gameState.log.map((e) => wire(e));
  doc.gameState.log[3] = { ...doc.gameState.log[3], message: '這一則被整包換掉了（重置/重開一局）' };
  const params = `since=1&logSince=${clientLog.length}&logh=${encodeURIComponent(C.logChainHash(clientLog, clientLog.length))}`;
  const body = await serveGetSingle(outMw, doc, params);
  ok(!body.logDelta, '前綴內容不同竟然還回增量');
  const merged = C.mergePolledRoomLog(clientLog, body.room, body.logDelta ?? null);
  ok(merged.ok && JSON.stringify(merged.room.gameState.log[3]) === JSON.stringify(doc.gameState.log[3]),
    '全量覆蓋失敗');
});

await T('⭐⭐ 舊 client（不帶參數）→ 回全量且無 logDelta；觀戰/重連第一發（無前綴）同樣全量', async () => {
  const doc = mkRoomDoc(7);
  for (const params of [null, 'since=1']) {
    const body = await serveGetSingle(outMw, doc, params);
    ok(!body.logDelta, '沒帶 logSince 竟有 logDelta');
    assertLogsEqual(body.room.gameState.log, doc.gameState.log, '舊 client/第一發');
  }
});

await T('⭐ 空 log 與 gameState 缺席（大廳房）：原樣全量、不炸', async () => {
  const d1 = mkRoomDoc(0);
  const b1 = await serveGetSingle(outMw, d1, 'since=1&logSince=0&logh=x');
  ok(!b1.logDelta && Array.isArray(b1.room.gameState.log) && b1.room.gameState.log.length === 0, '空 log 案例失敗');
  const d2 = mkRoomDoc(0); d2.gameState = null; d2.status = 'lobby';
  const b2 = await serveGetSingle(outMw, d2, 'since=1&logSince=3&logh=abc');
  ok(!b2.logDelta && b2.room.gameState === null, 'gameState null 案例失敗');
  const m2 = C.mergePolledRoomLog([{ a: 1 }], b2.room, b2.logDelta ?? null);
  ok(m2.ok && m2.nextLog === null, 'gameState null 時 client 鏈應重置為 null');
});

await T('⭐ 參數解析不了（logSince 非數字/logh 空）→ 全量 fail-open', async () => {
  const doc = mkRoomDoc(6);
  for (const p of ['since=1&logSince=abc&logh=zz', 'since=1&logSince=3&logh=', 'since=1&logSince=-2&logh=zz']) {
    const body = await serveGetSingle(outMw, doc, p);
    ok(!body.logDelta, `參數 ${p} 竟回增量`);
    assertLogsEqual(body.room.gameState.log, doc.gameState.log, '解析失敗案例');
  }
});

console.log('═══ 突變測試：故意弄錯一格，守衛必須攔得住（紅） ═══');
await T('⭐⭐⭐ 突變①client 重組錯一格（前綴反轉、長度不變）→ fh 端到端複驗必須拒收 ok:false', async () => {
  const doc = mkRoomDoc(10);
  const clientLog = doc.gameState.log.map((e) => wire(e));
  doc.gameState.log.push(mkEntry(9, 10)); doc._version++;
  const params = `since=1&logSince=${clientLog.length}&logh=${encodeURIComponent(C.logChainHash(clientLog, clientLog.length))}`;
  const body = await serveGetSingle(outMw, doc, params);
  ok(body.logDelta, '正對照：這一輪必須是增量');
  // 正對照：正確版重組成功
  ok(C.mergePolledRoomLog(clientLog, wire(body.room), body.logDelta).ok === true, '正確版竟重組失敗');
  // 突變版：前綴 slice 後 reverse（長度不變 ⇒ total 檢查擋不住，必須靠 fh）
  const MUT = CCBLOCK.replace('const full = prevLog.slice(0, n).concat(lg);',
                              'const full = prevLog.slice(0, n).reverse().concat(lg);');
  ok(MUT !== CCBLOCK, '突變點沒替換到（原始碼變了？）');
  const M = evalClientCore(MUT);
  const mm = M.mergePolledRoomLog(clientLog.map((e) => wire(e)), wire(body.room), body.logDelta);
  ok(mm.ok === false, '突變版重組竟被接受 —— fh 端到端複驗失守，玩家會看到錯亂的戰鬥紀錄');
});

await T('⭐⭐⭐ 突變②server 切片多切一則 → client 複驗必須拒收 ok:false（會觸發 client 改抓全量）', async () => {
  const MUTSRV = ROBLOCK.replace('log: log.slice(logSince) }', 'log: log.slice(logSince + 1) }');
  ok(MUTSRV !== ROBLOCK, '突變點沒替換到');
  const mut = await runRoomsOutBlock(MUTSRV);
  const doc = mkRoomDoc(10);
  const clientLog = doc.gameState.log.map((e) => wire(e));
  doc.gameState.log.push(mkEntry(9, 10), mkEntry(9, 11)); doc._version++;
  const params = `since=1&logSince=${clientLog.length}&logh=${encodeURIComponent(C.logChainHash(clientLog, clientLog.length))}`;
  const body = await serveGetSingle(mut.outMw, doc, params);
  ok(body.logDelta, '正對照：突變 server 仍回增量標記');
  const mm = C.mergePolledRoomLog(clientLog, body.room, body.logDelta);
  ok(mm.ok === false, '伺服器少送一則竟被接受 —— total/fh 檢查失守');
});

console.log('═══ oraclePollRoom 實跑（接線層：真的送 logSince、真的重組、壞 fh 真的改抓全量） ═══');
function extractFn(src, startAnchor, endAnchor) {
  const s = src.indexOf(startAnchor);
  ok(s >= 0, 'HEAD-FAIL：抽不到 ' + startAnchor.slice(0, 40));
  const e = src.indexOf(endAnchor, s);
  ok(e > s, '找不到結尾錨點 ' + endAnchor.slice(0, 30));
  let seg = src.slice(s, e);
  seg = seg.slice(0, seg.lastIndexOf('}') + 1);
  return seg.replace('export function', 'function');
}
await T('⭐⭐⭐ 輪詢三發實跑：全量→增量→UNCHANGED；送出的請求真的帶 logSince；交給 callback 的一律是完整 log', async () => {
  const pollSrc = extractFn(OC, 'export function oraclePollRoom(', '\n// ── Messages');
  const sdrSrc = extractFn(OC, 'export function shouldDeliverRoomPoll(', '\n\n/**');
  const scope = ts2js(sdrSrc + '\n' + pollSrc);
  const ROOM_UNCHANGED_SIM = Symbol('room-unchanged');
  const doc = mkRoomDoc(8);
  const fetchLog = [];
  const oracleGetRoom = async () => { fetchLog.push('full'); return (await serveGetSingle(outMw, doc, null)).room; };
  let tamperNext = false;
  const oracleGetRoomDelta = async (code, since, logKnown) => {
    if (since === doc._version) { fetchLog.push('204'); return ROOM_UNCHANGED_SIM; }
    let params = 'since=' + since;
    if (logKnown && logKnown.len > 0) params += `&logSince=${logKnown.len}&logh=${encodeURIComponent(logKnown.h)}`;
    fetchLog.push(params.includes('logSince=') ? 'delta-req' : 'plain-req');
    const body = await serveGetSingle(outMw, doc, params);
    if (tamperNext && body.logDelta) { body.logDelta = { ...body.logDelta, fh: 'bogus-0-0' }; tamperNext = false; fetchLog.push('tampered'); }
    return body;
  };
  let scheduled = null; const waiters = [];
  const fakeSetTimeout = (fn) => { scheduled = fn; const w = waiters.shift(); if (w) w(); return 1; };
  const waitTick = () => new Promise((r) => waiters.push(r));
  const mk = new Function('oracleGetRoom', 'oracleGetRoomDelta', 'logChainHash', 'mergePolledRoomLog',
    'ROOM_UNCHANGED', 'setTimeout', 'clearTimeout', 'console',
    '"use strict";\n' + scope + '\nreturn oraclePollRoom;');
  const pollRoom = mk(oracleGetRoom, oracleGetRoomDelta, C.logChainHash, C.mergePolledRoomLog,
    ROOM_UNCHANGED_SIM, fakeSetTimeout, () => {}, { warn: () => {} });
  const deliveries = [];
  let p = waitTick();
  const unsub = pollRoom('AB12', (room) => deliveries.push(room), 50);
  await p;   // tick1（第一發全量）
  ok(deliveries.length === 1 && fetchLog.includes('full'), '第一發應全量遞送');
  assertLogsEqual(deliveries[0].gameState.log, doc.gameState.log, 'tick1');
  // tick2：長 2 則 → 必須送 delta 請求、callback 拿到完整重組 log
  doc.gameState.log.push(mkEntry(9, 8), mkEntry(9, 9)); doc._version++;
  p = waitTick(); scheduled(); await p;
  ok(deliveries.length === 2, 'tick2 沒遞送');
  ok(fetchLog.includes('delta-req'), '輪詢沒有帶 logSince —— 接線沒接上');
  assertLogsEqual(deliveries[1].gameState.log, doc.gameState.log, 'tick2（重組後）');
  // tick3：沒變 → UNCHANGED，不遞送
  p = waitTick(); scheduled(); await p;
  ok(deliveries.length === 2 && fetchLog.includes('204'), 'tick3 應走 204/UNCHANGED 不遞送');
  // tick4：伺服器回壞 fh → client 必須丟棄並立刻改抓全量，玩家照樣拿到正確 log
  doc.gameState.log.push(mkEntry(9, 10)); doc._version++;
  tamperNext = true;
  const fullsBefore = fetchLog.filter((x) => x === 'full').length;
  p = waitTick(); scheduled(); await p;
  ok(fetchLog.includes('tampered'), '正對照：壞 fh 案例沒被觸發');
  ok(fetchLog.filter((x) => x === 'full').length === fullsBefore + 1, '壞 fh 後沒有立刻改抓全量');
  ok(deliveries.length === 3, '壞 fh 後這一輪沒遞送');
  assertLogsEqual(deliveries[2].gameState.log, doc.gameState.log, 'tick4（fail-open 全量）');
  // tick5：鏈已重置後繼續增量正常
  doc.gameState.log.push(mkEntry(9, 11)); doc._version++;
  p = waitTick(); scheduled(); await p;
  assertLogsEqual(deliveries[3].gameState.log, doc.gameState.log, 'tick5');
  unsub();
});

console.log('═══ 【B】seats[].email 不下發玩家端 ═══');
await T('⭐⭐⭐ GET 單房/GET 列表/PUT 回應：email 全剝為 null；DB 原 doc 一個字都沒被改', async () => {
  const doc = mkRoomDoc(3);
  const bodyGet = await serveGetSingle(outMw, doc, null);
  ok(bodyGet.room.seats.every((s) => s.email === null), 'GET 單房 email 沒剝');
  ok(doc.seats[0].email === 'alice@example.com', '原 doc 被就地改壞（strip 必須 copy）');
  ok(bodyGet.room.seats[0].name === '甲' && bodyGet.room.seats[0].uid === 'u1', '剝 email 誤傷其他欄位');
  // GET 列表
  const reqL = fakeReq('GET', '/api/rooms?status=lobby');
  const resL = fakeRes();
  await outMw(reqL, resL, () => {});
  resL.json({ rooms: [wire(doc), wire(doc)] });
  ok(resL.body.rooms.every((r) => r.seats.every((s) => s.email === null)), 'GET 列表 email 沒剝');
  // PUT 回應
  const reqP = fakeReq('PUT', '/api/rooms/AB12');
  const resP = fakeRes();
  await outMw(reqP, resP, () => {});
  resP.json({ ok: true, version: 41, room: wire(doc) });
  ok(resP.body.ok === true && resP.body.room.seats.every((s) => s.email === null), 'PUT 回應 email 沒剝');
  // 非 rooms 路徑不包裝
  const reqM = fakeReq('GET', '/api/rooms/AB12/messages?limit=50');
  const resM = fakeRes(); const orig = resM.json;
  await outMw(reqM, resM, () => {});
  ok(resM.json === orig, 'messages 路徑不該被包裝');
});

await T('⭐⭐⭐ PUT 回填：uid 相同且沒帶 email → 回填 DB 值；uid 不同不回填；沒缺 email 不查 DB', async () => {
  dbFixture.calls.length = 0;
  dbFixture.findOneResult = { seats: [{ uid: 'u1', email: 'alice@example.com' }, { uid: 'u2', email: 'bob@example.com' }, null] };
  const body = { data: { seats: [
    { role: 'p1', uid: 'u1', email: null, name: '甲' },
    { role: 'p2', uid: 'u9', email: null, name: '新人' },   // 換人：不回填
    { role: 'spectator', uid: null, email: null, name: null },
  ] } };
  const req = fakeReq('PUT', '/api/rooms/AB12', body);
  let nexted = false;
  await keepMw(req, fakeRes(), () => { nexted = true; });
  ok(nexted, 'put-keep 應 next()');
  ok(dbFixture.calls.length === 1 && dbFixture.calls[0].q._id === 'AB12', '應查一次 rooms doc');
  ok(body.data.seats[0].email === 'alice@example.com', 'uid 相同沒回填 —— DB 的 email 會被洗掉');
  ok(body.data.seats[1].email === null, 'uid 不同竟回填（會把 email 給錯人）');
  // 沒缺 email → 不查 DB
  dbFixture.calls.length = 0;
  const body2 = { data: { seats: [{ uid: 'u1', email: 'alice@example.com' }] } };
  await keepMw(fakeReq('PUT', '/api/rooms/AB12', body2), fakeRes(), () => {});
  ok(dbFixture.calls.length === 0, '沒缺 email 竟還查 DB（白吃一次查詢）');
  // DB 掛掉 → fail-open 照常 next()
  dbFixture.findOneResult = null;
  const body3 = { data: { seats: [{ uid: 'u1', email: null }] } };
  let n3 = false;
  await keepMw(fakeReq('PUT', '/api/rooms/AB12', body3), fakeRes(), () => { n3 = true; });
  ok(n3 && body3.data.seats[0].email === null, 'DB 查無 doc 時應照常寫入');
});

await T('⭐⭐ v1.17 combined 大廳列表：email 同樣剝除（該 mw 直接回應、不經 rooms-out 層）', async () => {
  const RCBLOCK = extractBlock(PATCH, '// >>> PTCG-ROOMS-COMBINED-BLOCK-START', '// <<< PTCG-ROOMS-COMBINED-BLOCK-END');
  ok(RCBLOCK, '抽不到 combined 區塊');
  ok(RCBLOCK.includes('_stripSeatEmails17'), 'HEAD-FAIL：combined 區塊沒有 email 剝除');
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: () => {} };
  const rooms = [wire(mkRoomDoc(2))]; rooms[0].status = 'lobby';
  const db = { collection: () => ({ find: () => ({ limit: () => ({ sort: () => ({ toArray: async () => rooms.map(wire) }) }) }) }) };
  const app = makeApp();
  const before = new Set(app.__stack.map((l) => l.handle));
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + RCBLOCK + '\n})();')(app, db, fakeConsole);
  const mw = app.__stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle)[0];
  ok(mw, 'combined mw 沒掛上');
  const req = fakeReq('GET', '/api/rooms?status=lobby%2Cplaying', undefined, { authorization: 'Bearer x' });
  // ⚠ combined mw 自己 parse query string：真實 URL 是未編碼逗號
  req.originalUrl = req.url = '/api/rooms?status=lobby,playing';
  const res = fakeRes();
  await mw(req, res, () => { throw new Error('combined 形狀不該 next()'); });
  ok(res.body && res.body.combined === true && Array.isArray(res.body.rooms), 'combined 回應形狀不對');
  ok(res.body.rooms[0].seats.every((s) => s.email === null), 'combined 列表 email 沒剝');
});

await T('⭐⭐ /api/match-result 伺服器補 email：從房間 doc 回填；client 有送則優先；無房號不查 DB；DB 掛不影響寫入', async () => {
  const MEBLOCK = extractBlock(PATCH, '// >>> PTCG-MATCH-EMAIL-ENRICH-START', '// <<< PTCG-MATCH-EMAIL-ENRICH-END');
  ok(MEBLOCK, 'HEAD-FAIL：抽不到 match-email-enrich 區塊');
  const run = (db, doc) => new Function('db', 'doc', '"use strict"; return (async () => {\n' + MEBLOCK + '\n})();')(db, doc);
  const mkDb = (seats, calls, throws) => ({ collection: (n) => ({ findOne: async (q, o) => {
    calls.push({ n, q, o }); if (throws) throw new Error('db down'); return { seats };
  } }) });
  const seats = [{ uid: 'u1', email: 'alice@example.com' }, { uid: 'u2', email: 'bob@example.com' }];
  // 新 client：兩邊都 null → 都補
  let calls = [];
  let doc = { roomCode: 'ab12', p1: { email: null }, p2: { email: null } };
  await run(mkDb(seats, calls), doc);
  ok(calls.length === 1 && calls[0].q._id === 'AB12', '應以大寫房號查一次 rooms');
  ok(doc.p1.email === 'alice@example.com' && doc.p2.email === 'bob@example.com', '沒補到 email');
  // 舊 client：有送就優先
  calls = [];
  doc = { roomCode: 'AB12', p1: { email: 'from-client@x.tw' }, p2: { email: null } };
  await run(mkDb(seats, calls), doc);
  ok(doc.p1.email === 'from-client@x.tw' && doc.p2.email === 'bob@example.com', 'client 送的值被蓋掉/另一邊沒補');
  // 本機對戰（無房號）→ 不查
  calls = [];
  doc = { roomCode: null, p1: { email: 'me@x.tw' }, p2: { email: null } };
  await run(mkDb(seats, calls), doc);
  ok(calls.length === 0 && doc.p2.email === null, '無房號竟查 DB');
  // DB 掛 → 不拋、維持 null
  doc = { roomCode: 'AB12', p1: { email: null }, p2: { email: null } };
  await run(mkDb(seats, [], true), doc);
  ok(doc.p1.email === null, 'DB 掛時應維持 null 且不拋例外');
});

console.log('═══ 量測（Rule 32：腳本=本檔；沙盒 CPU ≈ VM 的 1/10，此處量的是 bytes 與行為，非時間） ═══');
await T('⭐ wire 減量：第 9 回合等級房間（202 則 log），輪詢增量 vs 全量', async () => {
  const doc = mkRoomDoc(201);
  const clientLog = doc.gameState.log.map((e) => wire(e));
  doc.gameState.log.push(mkEntry(9, 201)); doc._version++;   // 新到 1 則
  const fullBody = await serveGetSingle(outMw, doc, 'since=1');
  const params = `since=1&logSince=${clientLog.length}&logh=${encodeURIComponent(C.logChainHash(clientLog, clientLog.length))}`;
  const deltaBody = await serveGetSingle(outMw, doc, params);
  ok(deltaBody.logDelta, '量測輪竟不是增量');
  const fullRaw = Buffer.byteLength(JSON.stringify(fullBody));
  const deltaRaw = Buffer.byteLength(JSON.stringify(deltaBody));
  const fullGz = gzipSync(JSON.stringify(fullBody), { level: 1 }).length;
  const deltaGz = gzipSync(JSON.stringify(deltaBody), { level: 1 }).length;
  const logRaw = Buffer.byteLength(JSON.stringify(doc.gameState.log));
  console.log(`      [量測] log 佔比：log=${(logRaw / 1024).toFixed(1)}KB / doc=${(fullRaw / 1024).toFixed(1)}KB = ${Math.round((logRaw / fullRaw) * 100)}%`);
  console.log(`      [量測] 全量回應 raw=${(fullRaw / 1024).toFixed(1)}KB gzip1=${(fullGz / 1024).toFixed(2)}KB`);
  console.log(`      [量測] 增量回應 raw=${(deltaRaw / 1024).toFixed(1)}KB gzip1=${(deltaGz / 1024).toFixed(2)}KB`);
  console.log(`      [量測] wire 減量：raw −${Math.round((1 - deltaRaw / fullRaw) * 100)}%、gzip1 −${Math.round((1 - deltaGz / fullGz) * 100)}%`);
  ok(deltaRaw < fullRaw * 0.6, '增量回應沒有省到 40% 以上（log 佔 60% 的房間至少該省掉整個 log）');
  const m = C.mergePolledRoomLog(clientLog, deltaBody.room, deltaBody.logDelta);
  ok(m.ok, '量測輪重組失敗');
  assertLogsEqual(m.room.gameState.log, doc.gameState.log, '量測輪');
});

console.log(`\n══ 結果：${pass} PASS / ${fail} FAIL ══`);
if (fail > 0) process.exit(1);
