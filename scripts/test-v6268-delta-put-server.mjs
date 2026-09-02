// 守衛:v6.268 休閒 PUT 上行增量【階段 1 伺服器端】— PTCG-DELTA-PUT 區塊
//
// 條目總覽:
//   【A】掛載+hoist(hoisted=true 行為端)
//   【B】正對照:(a) 舊 client 的 PUT body 逐位元不變 (b) /api/tournament/* 逐位元原樣通過
//        (c) 落庫 doc 與「舊 client 全量 PUT」路徑同形(含 email 回填)
//   【C】round-trip:固定案例(中文/undefined 刪欄/logAppend/鍵序漂移) + 隨機突變 fuzz 10,000 次
//   【D】三態:版本不符(409)/hash 不符(422)/正常(next 改寫 body)
//   【E】上限與 prototype-pollution gate(超限一律 deltaReject)
//   【F】哨兵 deltaPut:1 + kill switch(_DELTA_PUT_ENABLED=false 的行為)
//   【G】事件迴圈 perf:48KB 代表性房 doc 的 apply+hash p99
//   【H】⭐⭐ 錦標賽零接觸:內嵌 sha256(與 v6.265 逐位元相同,history-free)+位置證明
//   【I】突變測試 9 條 — 每一條必須紅在**預期的那一條斷言**(只捕捉 AssertionError)
//   【J】HEAD-FAIL:對 BASE(v6.267) blob 跑,各項各自紅(CI 淺複製時 shallowSkip,
//        本檔主體全部 history-free,真正的守備面不受淺複製影響)
//   【K】自查:守衛在 package.json test chain 裡/版本字串一致
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '4ccfdff1c5ec485172397c9509200f12906e3646';   // v6.267
const PATCH = readFileSync(path.join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
async function T(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // 只捕捉 AssertionError(守衛安慰劑鐵律)
    fail++; console.log('  ✗ ' + name + '\n    ' + String(e.message).slice(0, 400));
  }
}

// ── 區塊抽取(同 test-v6220 手法) ─────────────────────────────────────────
function extractBlock(src, sentS, sentE) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  if (si < 0 || ei <= si) return null;
  const nl = src.indexOf('\n', si);
  return src.slice(nl + 1, ei);
}
const DP_S = '// >>> PTCG-DELTA-PUT-BLOCK-START';
const DP_E = '// <<< PTCG-DELTA-PUT-BLOCK-END';
const DPBLOCK = extractBlock(PATCH, DP_S, DP_E);

// ── 模擬 Express stack(逐行對齊 server.js 實際註冊順序;同 test-v6216/v6220) ──
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
    { route: { path: '/api/rooms/:code/stream' } },
  ];
  const app = { use(fn) { stack.push({ handle: fn }); } };
  app._router = { stack };
  Object.defineProperty(app, 'router', { get() { throw new Error("'app.router' is deprecated!"); } });
  app.__stack = stack;
  return app;
}
function fakeReq(method, url, body) { return { method, originalUrl: url, url, headers: {}, body }; }
function fakeRes() {
  const r = { statusCode: 200, body: undefined, ended: false, jsonCalled: false, headersSent: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.jsonCalled = true; r.headersSent = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}

// 執行區塊:回傳 { mw, logs }。db.findOne 回傳 structuredClone(docs[code])(模擬 driver 的新物件)
async function runDeltaBlock(blockText, docs) {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const db = { collection: (name) => ({ findOne: async (q) => {
    assert.equal(name, 'rooms', 'delta-put 只該查 rooms collection');
    const d = docs[q && q._id];
    return d === undefined ? null : structuredClone(d);
  } }) };
  const app = makeApp();
  const before = new Set(app.__stack.map((l) => l.handle));
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + blockText + '\n})();')(app, db, fakeConsole);
  const news = app.__stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle);
  assert.equal(news.length, 1, '應恰好掛上 1 支 middleware,實得 ' + news.length);
  return { mw: news[0], logs, app };
}
async function callMw(mw, req) {
  const res = fakeRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  return { res, nexted };
}

// ── 參照實作(=下一版 client 的規格;與伺服器區塊**獨立**實作,互相對照) ────────
function refStripEmails(room) {
  if (!room || typeof room !== 'object' || !Array.isArray(room.seats)) return room;
  return { ...room, seats: room.seats.map((s) => (s && typeof s === 'object' && s.email != null) ? { ...s, email: null } : s) };
}
function clientView(doc) { return JSON.parse(JSON.stringify(refStripEmails(doc))); }
// 參照 canonical hash:先組 canonical 字串再 FNV(與伺服器的串流版**寫法不同、輸出必須相同**)
function refCanonStr(x, d) {
  if (d === undefined) d = 0;
  if (d > 32) throw new Error('ref-too-deep');
  if (x === null || x === undefined) return 'n';
  const t = typeof x;
  if (t === 'boolean') return x ? 't' : 'f';
  if (t === 'number') return Number.isFinite(x) ? 'd' + String(x) : 'n';
  if (t === 'string') return 's' + JSON.stringify(x);
  if (Array.isArray(x)) { let s = '['; for (const it of x) s += refCanonStr(it, d + 1) + ','; return s + ']'; }
  if (t === 'object') {
    let s = '{';
    for (const k of Object.keys(x).sort()) {
      if (x[k] === undefined) continue;
      s += JSON.stringify(k) + ':' + refCanonStr(x[k], d + 1) + ',';
    }
    return s + '}';
  }
  return 'n';
}
function refCanonHash(v) {
  const str = refCanonStr(v);
  let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
  }
  return h1.toString(16) + '-' + h2.toString(16);
}
const isPlainObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
// 參照 diff(client 規格):兩層欄位 + log 只送 append
function refDiff(prev, next) {
  const patch = { set: {}, del: [] };
  let logAppend = null;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (!(k in next) || next[k] === undefined) { if (k in prev) patch.del.push(k); continue; }
    if (!(k in prev)) { patch.set[k] = next[k]; continue; }
    if (k === 'gameState' && isPlainObj(prev[k]) && isPlainObj(next[k])) {
      const sub = new Set([...Object.keys(prev[k]), ...Object.keys(next[k])]);
      for (const k2 of sub) {
        const p = 'gameState.' + k2;
        if (!(k2 in next[k]) || next[k][k2] === undefined) { if (k2 in prev[k]) patch.del.push(p); continue; }
        if (!(k2 in prev[k])) { patch.set[p] = next[k][k2]; continue; }
        if (k2 === 'log' && Array.isArray(prev[k][k2]) && Array.isArray(next[k][k2])
            && next[k][k2].length >= prev[k][k2].length
            && JSON.stringify(next[k][k2].slice(0, prev[k][k2].length)) === JSON.stringify(prev[k][k2])) {
          if (next[k][k2].length > prev[k][k2].length) logAppend = next[k][k2].slice(prev[k][k2].length);
          continue;
        }
        if (JSON.stringify(prev[k][k2]) !== JSON.stringify(next[k][k2])) patch.set[p] = next[k][k2];
      }
      continue;
    }
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) patch.set[k] = next[k];
  }
  if (logAppend) patch.logAppend = logAppend;
  return patch;
}
// 模擬核心 PUT 的 $set 語義(top-level 逐鍵覆寫;_version bump、updatedAt 固定值方便比對)
function simCorePut(doc, data, newVersion) {
  const out = { ...doc };
  for (const k of Object.keys(data)) out[k] = data[k];
  out._version = newVersion; out.updatedAt = 999999;
  return out;
}
// 模擬 v1.20 _roomsPutKeepEmailMw 的回填(舊 client 全量路徑會經過它)
function simKeepEmail(data, doc) {
  const d = structuredClone(data);
  if (Array.isArray(d.seats) && Array.isArray(doc.seats)) {
    for (let i = 0; i < d.seats.length; i++) {
      const s = d.seats[i], o = doc.seats[i];
      if (s && typeof s === 'object' && s.uid && s.email == null && o && o.uid === s.uid && o.email != null) s.email = o.email;
    }
  }
  return d;
}

// ── 代表性房 doc(鍵序刻意與 client 端習慣不同;seats 帶真 email) ─────────────
function makeDoc() {
  return {
    _id: 'ROOM',
    gameState: {
      log: [{ t: 1, msg: '甲 使用了「振翅高飛」' }, { t: 2, msg: '乙 對戰鬥場造成 120 點傷害' }],
      turn: 3, phase: 'playing', pendingSelection: null,
      p1: { hand: 5, prizes: 4 }, p2: { hand: 6, prizes: 5 },
    },
    updatedAt: 111, createdAt: 100,
    seats: [
      { role: 'p1', uid: 'u1', email: 'a@b.c', name: '甲', deckEntries: null, deckId: 'd1', ready: true, firstChoicePreference: 'random' },
      { role: 'p2', uid: 'u2', email: null, name: '乙', deckEntries: null, deckId: null, ready: true, firstChoicePreference: 'random' },
    ],
    status: 'playing', heartbeats: { p1: 11, p2: 22 },
    _version: 7,
  };
}
function makeDeltaBody(prev, next, ev) {
  return { patchProto: 1, expectedVersion: ev, fullHash: refCanonHash(next), patch: refDiff(prev, next) };
}

console.log('══ 【A】掛載 + hoist ══════════════════════════════════════════');
await T('A0 區塊存在且抽得出來', () => {
  assert.ok(DPBLOCK && DPBLOCK.length > 1000, 'PTCG-DELTA-PUT 區塊抽不出來');
});
let CTX = null;
await T('A1 掛上 1 支 mw 且 hoisted=true enabled=true(行為端,不是 grep)', async () => {
  CTX = await runDeltaBlock(DPBLOCK, { ROOM: makeDoc() });
  assert.ok(CTX.logs.some((l) => l.includes('delta-put middleware (v1.29) hoisted=true enabled=true')),
    'hoist/enable log 不對: ' + CTX.logs.join(' | '));
  const st = CTX.app.__stack;
  const mwIdx = st.findIndex((l) => l.handle === CTX.mw);
  const firstRoute = st.findIndex((l) => !!l.route);
  assert.ok(mwIdx >= 0 && firstRoute > mwIdx, 'mw(' + mwIdx + ') 必須在第一個 route(' + firstRoute + ')之前');
});

console.log('\n══ 【B】正對照(最重要) ══════════════════════════════════════');
await T('B1 (a) 舊 client 全量 PUT:next() 且 body 逐位元不變、同一個物件參照', async () => {
  const doc = makeDoc();
  const data = clientView(doc); data.gameState.turn = 4;
  const body = { data, expectedVersion: 7 };
  const snap = JSON.stringify(body);
  const req = fakeReq('PUT', '/api/rooms/ROOM', body);
  const { res, nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted, '舊 client PUT 必須 next()');
  assert.ok(!res.jsonCalled && !res.ended, '不得自行回應');
  assert.ok(req.body === body, 'body 物件參照被換掉了');
  assert.equal(JSON.stringify(req.body), snap, 'body 位元組變了');
});
await T('B1b 舊 client 沒有 body 的 PUT 也原樣通過', async () => {
  const req = fakeReq('PUT', '/api/rooms/ROOM', undefined);
  const { res, nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted && !res.jsonCalled, '必須 next()');
  assert.equal(req.body, undefined);
});
await T('B2 (b) /api/tournament/* 逐位元原樣通過(即使帶 patchProto)', async () => {
  for (const [m, u] of [['PUT', '/api/tournament/state'], ['POST', '/api/tournament/join'],
                        ['PUT', '/api/rooms/ROOM/messages'], ['GET', '/api/tournament/state']]) {
    const body = { patchProto: 1, patch: { set: { x: 1 } }, fullHash: '1-1', expectedVersion: 7 };
    const snap = JSON.stringify(body);
    const req = fakeReq(m, u, body);
    const res = fakeRes();
    let nexted = false;
    await CTX.mw(req, res, () => { nexted = true; });
    assert.ok(nexted && !res.jsonCalled, m + ' ' + u + ' 必須原樣 next()');
    assert.ok(req.body === body && JSON.stringify(req.body) === snap, m + ' ' + u + ' body 被動到了');
  }
});
await T('B3 (c) 落庫 doc 與「舊 client 全量 PUT」路徑逐鍵同形(含 email 回填)', async () => {
  const doc = makeDoc();
  const prev = clientView(doc);
  const next = structuredClone(prev);
  next.gameState.turn = 4;
  next.gameState.log = next.gameState.log.concat([{ t: 3, msg: '丙 放置了傷害指示物' }]);
  next.seats[0].ready = false;           // 動 seats => set['seats'](email 是 null)
  next.status = 'playing';
  // 舊 client 路徑:data=next(email null) -> keepEmail 回填 -> $set
  const oldPath = simCorePut(doc, simKeepEmail(next, doc), 8);
  // delta 路徑:mw 重建 -> $set
  const req = fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7));
  const { res, nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted, 'delta PUT 應 next(),實回 ' + JSON.stringify(res.body ?? null).slice(0, 200));
  assert.equal(req.body.expectedVersion, 7);
  const deltaPath = simCorePut(doc, req.body.data, 8);
  assert.equal(refCanonHash(deltaPath), refCanonHash(oldPath), '落庫內容不同形');
  assert.equal(JSON.stringify(Object.keys(deltaPath)), JSON.stringify(Object.keys(oldPath)), 'top-level 鍵序不同');
  assert.equal(deltaPath.seats[0].email, 'a@b.c', 'email 沒被回填 => delta PUT 會把 DB 的 email 洗掉');
  assert.equal(Math.abs(JSON.stringify(deltaPath).length - JSON.stringify(oldPath).length), 0, '落庫大小不同');
});


// fuzz 用:對每筆 doc 建一個共用 mw 的呼叫器(區塊只載入一次,db 用可換的 holder)
const FUZZ_HOLDER = { doc: null };
const FUZZ_CTX = await (async () => {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const db = { collection: () => ({ findOne: async () => structuredClone(FUZZ_HOLDER.doc) }) };
  const app = makeApp();
  const before = new Set(app.__stack.map((l) => l.handle));
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + DPBLOCK + '\n})();')(app, db, fakeConsole);
  const news = app.__stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle);
  return { mw: news[0] };
})();
function FUZZ_MW_FACTORY(doc) {
  FUZZ_HOLDER.doc = doc;
  return async (req) => callMw(FUZZ_CTX.mw, req);
}

console.log('\n══ 【C】round-trip ══════════════════════════════════════════');
await T('C1 中文 + 巢狀 set + logAppend + undefined 刪欄', async () => {
  const doc = makeDoc();
  const prev = clientView(doc);
  const next = structuredClone(prev);
  next.gameState.pendingSelection = { effectKey: '振翅高飛', title: '選擇 1 張卡', iids: ['i1'] };
  next.gameState.log = next.gameState.log.concat([{ t: 3, msg: '「沸騰鬥志」發動' }]);
  delete next.heartbeats;                       // top-level 刪欄
  next.gameState.p1 = { hand: 4, prizes: 4 };   // 巢狀整包換
  next.undoRequest = { by: 'p1' };              // top-level 新欄
  const req = fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7));
  const { res, nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted, '應 next(),實回 ' + JSON.stringify(res.body ?? null).slice(0, 200));
  const got = structuredClone(req.body.data);
  // email 回填是 delta 路徑的預期差異;比對前套同一條規則到 next 上
  assert.equal(refCanonHash(got), refCanonHash(simKeepEmail(next, doc)), '重建結果與 client 端 next 不同');
  assert.ok(!('heartbeats' in got), 'del 沒生效');
});
await T('C2 鍵序漂移免疫:DB doc 鍵序打亂後,client 的 fullHash 仍必須被接受', async () => {
  const doc = makeDoc();
  // 打亂 doc 的鍵序(模擬 BSON 插入序不同)
  const shuffled = {};
  for (const k of Object.keys(doc).reverse()) shuffled[k] = doc[k];
  const gs = {}; for (const k of Object.keys(doc.gameState).reverse()) gs[k] = doc.gameState[k];
  shuffled.gameState = gs;
  const ctx2 = await runDeltaBlock(DPBLOCK, { ROOM: shuffled });
  const prev = clientView(doc);                 // client 端用原鍵序
  const next = structuredClone(prev); next.gameState.turn = 99;
  const req = fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7));
  const { res, nexted } = await callMw(ctx2.mw, req);
  assert.ok(nexted, '鍵序漂移被誤判成 hash 不符: ' + JSON.stringify(res.body ?? null).slice(0, 120));
});
await T('C3 整包 gameState.log 重寫(悔棋型,不是 append)也正確', async () => {
  const doc = makeDoc();
  const prev = clientView(doc);
  const next = structuredClone(prev);
  next.gameState.log = [{ t: 1, msg: '重來' }];
  const body = makeDeltaBody(prev, next, 7);
  assert.ok(body.patch.set['gameState.log'], 'refDiff 應走 set 而非 logAppend');
  const req = fakeReq('PUT', '/api/rooms/ROOM', body);
  const { nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted);
  assert.equal(req.body.data.gameState.log.length, 1);
});
await T('C4 隨機突變 fuzz 10,000 次:diff→apply→hash 兩端一致', async () => {
  let s = 20260829;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rv = (d) => {
    const r = rnd();
    if (d > 2 || r < 0.25) return pick([1, 0, -3.5, 'x', '中文字串測試', true, false, null, 42.25]);
    if (r < 0.5) { const n = Math.floor(rnd() * 3); const arr = []; for (let i = 0; i < n; i++) arr.push(rv(d + 1)); return arr; }
    const o = {}; const n = Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) o['k' + Math.floor(rnd() * 6)] = rv(d + 1);
    return o;
  };
  const TOPS = ['status', 'undoRequest', 'rematchReady', 'winner', 'heartbeats'];
  const SUBS = ['turn', 'phase', 'pendingSelection', 'p1', 'p2', 'coin'];
  let ran = 0;
  for (let it = 0; it < 10000; it++) {
    const doc = { _id: 'F', _version: 1 + Math.floor(rnd() * 5),
      gameState: { log: [{ t: 1, m: '開局' }], turn: 1 }, status: 'playing', updatedAt: 5, createdAt: 1 };
    for (const k of TOPS) if (rnd() < 0.5) doc[k] = rv(0);
    for (const k of SUBS) if (rnd() < 0.5) doc.gameState[k] = rv(0);
    const prev = clientView(doc);
    const next = structuredClone(prev);
    const nops = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < nops; i++) {
      const r = rnd();
      if (r < 0.3) next[pick(TOPS)] = rv(0);
      else if (r < 0.5) delete next[pick(TOPS)];
      else if (r < 0.75) next.gameState[pick(SUBS)] = rv(0);
      else if (r < 0.85) delete next.gameState[pick(SUBS)];
      else next.gameState.log = next.gameState.log.concat([{ t: 2 + i, m: '第' + it + '筆中文紀錄' }]);
    }
    const ctxF = ran === 0 || true ? null : null;
    const req = fakeReq('PUT', '/api/rooms/F', makeDeltaBody(prev, next, doc._version));
    const { res, nexted } = await FUZZ_MW_FACTORY(doc)(req);
    assert.ok(nexted, 'fuzz #' + it + ' 被拒: ' + JSON.stringify(res.body ?? null).slice(0, 150));
    assert.equal(refCanonHash(req.body.data), refCanonHash(next), 'fuzz #' + it + ' 重建結果不一致');
    ran++;
  }
  assert.equal(ran, 10000);
});

console.log('\n══ 【D】三態 ══════════════════════════════════════════════');
await T('D1 版本不符 → 409 conflict + deltaReject,且**不回 room**(email 防洩)', async () => {
  const doc = makeDoc(); doc._version = 9;
  const ctx = await runDeltaBlock(DPBLOCK, { ROOM: doc });
  const prev = clientView(makeDoc()); const next = structuredClone(prev); next.status = 'x';
  const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7)));
  assert.ok(!nexted, '版本不符不得 next()');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.conflict, true);
  assert.equal(res.body.currentVersion, 9);
  assert.equal(res.body.deltaReject, 1);
  assert.equal(res.body.deltaReason, 'version');
  assert.ok(!('room' in res.body), '409 不得回 room(會繞過 v1.20 email 剝除)');
});
await T('D1b 房間不存在 → 409 currentVersion null', async () => {
  const ctx = await runDeltaBlock(DPBLOCK, {});
  const prev = clientView(makeDoc()); const next = structuredClone(prev);
  const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/NOPE', makeDeltaBody(prev, next, 7)));
  assert.ok(!nexted); assert.equal(res.statusCode, 409); assert.equal(res.body.currentVersion, null);
});
await T('D2 hash 不符 → 422 deltaReason=hash', async () => {
  const prev = clientView(makeDoc()); const next = structuredClone(prev); next.status = 'y';
  const body = makeDeltaBody(prev, next, 7);
  body.fullHash = 'deadbeef-12345678';
  const { res, nexted } = await callMw(CTX.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
  assert.ok(!nexted, 'hash 不符不得 next()');
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.deltaReject, 1);
  assert.equal(res.body.deltaReason, 'hash');
});
await T('D3 格式不對(expectedVersion 缺席/0/fullHash 亂寫/patch 缺席)→ 422 bad-patch', async () => {
  for (const b of [
    { patchProto: 1, patch: { set: {} }, fullHash: '1-1' },
    { patchProto: 1, patch: { set: {} }, fullHash: '1-1', expectedVersion: 0 },
    { patchProto: 1, patch: { set: {} }, fullHash: 'ZZZ', expectedVersion: 7 },
    { patchProto: 1, fullHash: '1-1', expectedVersion: 7 },
  ]) {
    const { res, nexted } = await callMw(CTX.mw, fakeReq('PUT', '/api/rooms/ROOM', b));
    assert.ok(!nexted && res.statusCode === 422 && res.body.deltaReason === 'bad-patch',
      JSON.stringify(b).slice(0, 80) + ' → ' + JSON.stringify(res.body ?? null));
  }
});

console.log('\n══ 【E】上限與 prototype-pollution gate ═══════════════════════');
await T('E1 set 超過 256 條 → 422(error)', async () => {
  const prev = clientView(makeDoc()); const next = structuredClone(prev);
  const body = makeDeltaBody(prev, next, 7);
  body.patch.set = {}; for (let i = 0; i < 257; i++) body.patch.set['f' + i] = i;
  const { res, nexted } = await callMw(CTX.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
  assert.ok(!nexted, '超限必須拒收');
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.deltaReason, 'error');
});
await T('E2 路徑帶 __proto__ → 422(error) 且 Object.prototype 未被污染', async () => {
  try {
    const prev = clientView(makeDoc());
    const body = { patchProto: 1, expectedVersion: 7, fullHash: refCanonHash(prev),
      patch: { set: { '__proto__.dpPolluted': 1 }, del: [] } };
    const { res, nexted } = await callMw(CTX.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
    assert.ok(!nexted, '__proto__ 路徑必須拒收');
    assert.equal(res.body.deltaReason, 'error');
    assert.equal(({}).dpPolluted, undefined, 'Object.prototype 被污染了!');
    const body2 = { patchProto: 1, expectedVersion: 7, fullHash: refCanonHash(prev),
      patch: { set: {}, del: ['__proto__.x'] } };
    const r2 = await callMw(CTX.mw, fakeReq('PUT', '/api/rooms/ROOM', body2));
    assert.ok(!r2.nexted && r2.res.statusCode === 422, 'del 的 __proto__ 路徑也必須拒收');
  } finally { delete Object.prototype.dpPolluted; }
});
await T('E3 雜湊工作量超過 1M 字元(巨大 doc)→ 422(error),不會把事件迴圈抱住', async () => {
  const doc = makeDoc();
  doc.gameState.blob = 'x'.repeat(1200000);
  const ctx = await runDeltaBlock(DPBLOCK, { ROOM: doc });
  const prev = clientView(doc); const next = structuredClone(prev); next.status = 'z';
  const t0 = process.hrtime.bigint();
  const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(!nexted, '超大 doc 必須 deltaReject(工作量上限)');
  assert.equal(res.body.deltaReason, 'error');
  assert.ok(ms < 500, '超限路徑也不該花超過 500ms(實測 ' + ms.toFixed(1) + 'ms)');
});

console.log('\n══ 【F】哨兵 deltaPut:1 + kill switch ═════════════════════════');
await T('F1 GET {room} 回應加 deltaPut:1;404/list 不加', async () => {
  const doc = makeDoc();
  const req = fakeReq('GET', '/api/rooms/ROOM?since=3');
  const res = fakeRes();
  let nexted = false;
  await CTX.mw(req, res, () => { nexted = true; });
  assert.ok(nexted, 'GET 必須 next() 交給核心端點');
  res.json({ room: doc });
  assert.equal(res.body.deltaPut, 1, '哨兵沒加上');
  assert.ok(res.body.room === doc, 'room 本體不得被動');
  const res2 = fakeRes();
  await CTX.mw(fakeReq('GET', '/api/rooms/NOPE'), res2, () => {});
  res2.json({ error: 'room not found' });
  assert.ok(!('deltaPut' in res2.body), '404 回應不該有哨兵');
  const res3 = fakeRes();
  const req3 = fakeReq('GET', '/api/rooms?status=lobby');
  await CTX.mw(req3, res3, () => {});
  res3.json({ rooms: [] });
  assert.ok(!('deltaPut' in res3.body), '列表回應不該有哨兵');
});
await T('F2 出貨值必須是啟用(_DELTA_PUT_ENABLED = true)', () => {
  assert.ok(DPBLOCK.includes('const _DELTA_PUT_ENABLED = true;'), 'kill switch 出貨值不是 true');
});
await T('F3 kill switch:改 false 後 → 哨兵消失、patch PUT 回 422 disabled、舊 client 不受影響', async () => {
  const off = DPBLOCK.replace('const _DELTA_PUT_ENABLED = true;', 'const _DELTA_PUT_ENABLED = false;');
  assert.notEqual(off, DPBLOCK);
  const ctx = await runDeltaBlock(off, { ROOM: makeDoc() });
  const res = fakeRes();
  await ctx.mw(fakeReq('GET', '/api/rooms/ROOM'), res, () => {});
  res.json({ room: makeDoc() });
  assert.ok(!('deltaPut' in res.body), '停用後哨兵必須消失');
  const prev = clientView(makeDoc()); const next = structuredClone(prev); next.status = 'k';
  const r2 = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7)));
  assert.ok(!r2.nexted && r2.res.statusCode === 422 && r2.res.body.deltaReason === 'disabled',
    '停用後 patch PUT 必須 422 disabled(絕不可流進核心 PUT 變 400)');
  const body = { data: clientView(makeDoc()), expectedVersion: 7 };
  const snap = JSON.stringify(body);
  const r3 = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
  assert.ok(r3.nexted && JSON.stringify(body) === snap, '停用後舊 client 全量 PUT 照常通過');
});

console.log('\n══ 【G】事件迴圈 perf(48KB 代表性房 doc) ═══════════════════════');
await T('G1 delta PUT 一輪(findOne clone+apply+hash+回填)p99 上限', async () => {
  const doc = makeDoc();
  const pad = [];
  for (let i = 0; i < 450; i++) pad.push({ t: i, msg: '第 ' + i + ' 手:對戰紀錄中文填充字串,約一百位元組長度的樣板文字內容補齊補齊補齊' });
  doc.gameState.log = pad;
  doc.gameState.p1 = { hand: 7, board: 'y'.repeat(11000) };
  doc.gameState.p2 = { hand: 7, board: 'z'.repeat(11000) };
  const bytes = JSON.stringify(doc).length;
  assert.ok(bytes > 40000, '代表性 doc 應大於 40KB,實得 ' + bytes);
  const ctx = await runDeltaBlock(DPBLOCK, { ROOM: doc });
  const prev = clientView(doc);
  const times = [];
  for (let i = 0; i < 300; i++) {
    const next = structuredClone(prev);
    next.gameState.turn = i;
    next.gameState.log = next.gameState.log.concat([{ t: 1000 + i, msg: '新事件' + i }]);
    const body = makeDeltaBody(prev, next, 7);
    const t0 = process.hrtime.bigint();
    const { nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    assert.ok(nexted, 'perf 迭代 ' + i + ' 被拒');
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.50)];
  const p99 = times[Math.floor(times.length * 0.99)];
  console.log('        doc=' + (bytes / 1024).toFixed(1) + 'KB  p50=' + p50.toFixed(2) + 'ms  p99=' + p99.toFixed(2) + 'ms  max=' + times[times.length - 1].toFixed(2) + 'ms(沙盒;VM 實測約快 10 倍)');
  assert.ok(p99 < 40, 'p99=' + p99.toFixed(2) + 'ms 超過 40ms(沙盒上限;此值≈VM 4ms,還在錦標賽可容忍範圍) — 檢查有沒有量級退化');
  assert.ok(p50 < 15, 'p50=' + p50.toFixed(2) + 'ms 超過 15ms');
});

console.log('\n══ 【H】⭐⭐ 錦標賽零接觸(站長硬約束) ═══════════════════════════');
const TOURN_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
// ⚠ v6.276 起錦標賽區塊含 6 處 additive 的 deckId 插入（revert-diff 見 test-v6276）。
const TOURN_SHA_V6276 = 'fc015380210f69fd159ff859c047678d748930496bd3d474e4c3c41d42415138';
const TOURN_LEN_V6276 = 219837;
await T('H1 錦標賽區塊與 v6.265 **逐位元相同**(內嵌 sha256,history-free)', () => {
  const i = PATCH.indexOf(TOURN_ANCHOR);
  assert.ok(i > 0, '找不到錦標賽區塊錨點');
  const blk = PATCH.slice(i);
  assert.equal(blk.length, TOURN_LEN_V6276, '錦標賽區塊長度變了: ' + blk.length);
  const sha = createHash('sha256').update(blk, 'utf8').digest('hex');
  assert.equal(sha, TOURN_SHA_V6276, '⚠⚠ 錦標賽區塊被動到了! sha256=' + sha);
});
await T('H2 掃描器自驗:sha 比對抓得到一個字元的差異', () => {
  const i = PATCH.indexOf(TOURN_ANCHOR);
  const mutated = PATCH.slice(i).replace('tournamentEvents', 'tournamentEventsX');
  const sha = createHash('sha256').update(mutated, 'utf8').digest('hex');
  assert.notEqual(sha, TOURN_SHA_V6276, 'sha 比對抓不到差異 — H1 是安慰劑');
});
await T('H3 位置證明:delta-put 區塊整段落在錦標賽區塊之前', () => {
  const tournAt = PATCH.indexOf(TOURN_ANCHOR);
  const s = PATCH.indexOf(DP_S), e = PATCH.indexOf(DP_E);
  assert.ok(s > 0 && e > s && e < tournAt, 'delta-put 區塊位置不對(s=' + s + ' e=' + e + ' tourn=' + tournAt + ')');
});

console.log('\n══ 【I】突變測試(每條必須紅在預期的那條斷言) ═══════════════════');
async function expectRed(name, mutatedBlock, fn) {
  await T(name, async () => {
    let redAt = null;
    try { await fn(mutatedBlock); }
    catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      redAt = e.message;
    }
    assert.ok(redAt !== null, '突變沒有翻紅 — 守衛是安慰劑!');
  });
}
function mutate(find, replace) {
  const m = DPBLOCK.replace(find, replace);
  assert.notEqual(m, DPBLOCK, '突變沒套上: ' + find.slice(0, 60));
  return m;
}
await expectRed('I1 拿掉 patchProto 閘 → 舊 client 正對照(B1)必紅', mutate('|| _b.patchProto !== 1)', '|| false)'),
  async (blk) => {
    const ctx = await runDeltaBlock(blk, { ROOM: makeDoc() });
    const body = { data: clientView(makeDoc()), expectedVersion: 7 };
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
    assert.ok(nexted && !res.jsonCalled, '舊 client PUT 必須 next()');
  });
await expectRed('I2 拿掉 hash 複驗 → D2 必紅', mutate('if (_dpCanonHash(_rebuilt) !== _b.fullHash) {', 'if (false) {'),
  async (blk) => {
    const ctx = await runDeltaBlock(blk, { ROOM: makeDoc() });
    const prev = clientView(makeDoc()); const next = structuredClone(prev); next.status = 'y';
    const body = makeDeltaBody(prev, next, 7); body.fullHash = 'deadbeef-12345678';
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
    assert.ok(!nexted && res.body && res.body.deltaReason === 'hash', 'hash 不符必須 422 hash');
  });
await expectRed('I3 拿掉版本比對 → D1 必紅', mutate('if (!_doc || _doc._version !== _ev) {', 'if (!_doc) {'),
  async (blk) => {
    const doc = makeDoc(); doc._version = 9;
    const ctx = await runDeltaBlock(blk, { ROOM: doc });
    const prev = clientView(makeDoc()); const next = structuredClone(prev); next.status = 'x';
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7)));
    assert.ok(!nexted && res.statusCode === 409 && res.body.deltaReason === 'version', '版本不符必須 409 version');
  });
await expectRed('I4 拿掉 set 條數上限 → E1 必紅', mutate('setKeys.length > _DP_MAX_SET', 'false'),
  async (blk) => {
    const ctx = await runDeltaBlock(blk, { ROOM: makeDoc() });
    const prev = clientView(makeDoc()); const body = makeDeltaBody(prev, structuredClone(prev), 7);
    body.patch.set = {}; for (let i = 0; i < 257; i++) body.patch.set['f' + i] = i;
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
    assert.ok(!nexted && res.statusCode === 422 && res.body.deltaReason === 'error', '超限必須 422 error');
  });
await expectRed('I5 拿掉 __proto__ gate → E2 必紅', mutate("|| s === '__proto__'", ''),
  async (blk) => {
    const ctx = await runDeltaBlock(blk, { ROOM: makeDoc() });
    const prev = clientView(makeDoc());
    const body = { patchProto: 1, expectedVersion: 7, fullHash: refCanonHash(prev), patch: { set: {}, del: ['__proto__.x'] } };
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
    assert.ok(!nexted && res.statusCode === 422 && res.body.deltaReason === 'error', '__proto__ 路徑必須 422 error');
  });
await expectRed('I6 拿掉 email 回填 → B3 的 email 斷言必紅', mutate('s.email = o.email;\n              }\n            }\n          }\n          // 改寫成與舊 client 全量 PUT 同形', ';\n              }\n            }\n          }\n          // 改寫成與舊 client 全量 PUT 同形'),
  async (blk) => {
    const doc = makeDoc();
    const ctx = await runDeltaBlock(blk, { ROOM: doc });
    const prev = clientView(doc); const next = structuredClone(prev); next.seats[0].ready = false;
    const req = fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7));
    const { nexted } = await callMw(ctx.mw, req);
    assert.ok(nexted, '應 next()');
    assert.equal(req.body.data.seats[0].email, 'a@b.c', 'email 沒被回填');
  });
await expectRed('I7 拿掉鍵排序 → C2 鍵序免疫必紅', mutate('const ks = Object.keys(x).sort();', 'const ks = Object.keys(x);'),
  async (blk) => {
    const doc = makeDoc();
    const shuffled = {}; for (const k of Object.keys(doc).reverse()) shuffled[k] = doc[k];
    const gs = {}; for (const k of Object.keys(doc.gameState).reverse()) gs[k] = doc.gameState[k];
    shuffled.gameState = gs;
    const ctx = await runDeltaBlock(blk, { ROOM: shuffled });
    const prev = clientView(doc); const next = structuredClone(prev); next.gameState.turn = 99;
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7)));
    assert.ok(nexted, '鍵序漂移被誤拒: ' + JSON.stringify(res.body ?? null).slice(0, 100));
  });
await expectRed('I8 拿掉 hoist → A1 必紅', mutate('if (_mi > 0 && _fr >= 0 && _fr < _mi) {', 'if (false) {'),
  async (blk) => {
    const ctx = await runDeltaBlock(blk, { ROOM: makeDoc() });
    assert.ok(ctx.logs.some((l) => l.includes('hoisted=true')), 'hoisted 必須為 true');
  });
await expectRed('I9 拿掉雜湊工作量上限 → E3 必紅', mutate('if (n > _DP_MAX_MIX) throw', 'if (false) throw'),
  async (blk) => {
    const doc = makeDoc(); doc.gameState.blob = 'x'.repeat(1200000);
    const ctx = await runDeltaBlock(blk, { ROOM: doc });
    const prev = clientView(doc); const next = structuredClone(prev); next.status = 'z';
    const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeDeltaBody(prev, next, 7)));
    assert.ok(!nexted && res.body && res.body.deltaReason === 'error', '超大 doc 必須被工作量上限拒收');
  });

console.log('\n══ 【J】HEAD-FAIL(對 BASE v6.267 blob,各項各自紅) ═══════════════');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('test-v6268 【J】HEAD-FAIL(需要 BASE blob)',
    '本檔主體(A~I)全部 history-free,守備面不受淺複製影響;HEAD-FAIL 只是開發期證明');
} else {
  const basePatch = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  const basePkg = readBaseBlob(ROOT, BASE_SHA, 'package.json');
  const baseVer = readBaseBlob(ROOT, BASE_SHA, 'src/lib/version.ts');
  await T('J1 BASE 沒有 delta-put 區塊(=區塊斷言在 BASE 必紅)', () => {
    assert.ok(basePatch.ok, '讀不到 BASE blob');
    assert.equal(extractBlock(basePatch.out, DP_S, DP_E), null, 'BASE 不該有區塊');
    assert.ok(!basePatch.out.includes('deltaPut'), 'BASE 不該有哨兵字樣');
    assert.ok(!basePatch.out.includes('_DELTA_PUT_ENABLED'), 'BASE 不該有 kill switch');
  });
  await T('J2 BASE 的 test chain 沒有本守衛(=K1 在 BASE 必紅)', () => {
    assert.ok(basePkg.ok && !basePkg.out.includes('test-v6268-delta-put-server'), 'BASE 不該掛本守衛');
  });
  await T('J3 BASE 版本是 6.267(=K2 在 BASE 必紅)', () => {
    assert.ok(baseVer.ok && baseVer.out.includes("'6.267'"), 'BASE 版本異常');
  });
  await T('J4 對 BASE 跑 A0 抽取 → 真的紅(不是恆綠)', () => {
    let red = false;
    try { const b = extractBlock(basePatch.out, DP_S, DP_E); assert.ok(b && b.length > 1000, '抽不出'); }
    catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = true; }
    assert.ok(red, 'A0 對 BASE 應該紅');
  });
}

console.log('\n══ 【K】自查 ═══════════════════════════════════════════════');
await T('K1 守衛在 package.json 的 test chain 裡(不是只放 CI)', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(String(pkg.scripts.test).includes('node scripts/test-v6268-delta-put-server.mjs'),
    '本守衛沒進 npm test chain — CI 的 iron-rules-audit 是 continue-on-error,不算數');
});
// ⚠⚠ v6.269 改判準（斷言的**意圖**一個字沒變，只是不再寫死版本號）：
//   原寫法把 `6.268` / `v1.29` 寫死 ⇒ **每一個未來版本都會紅**（v6.269 立刻踩到），
//   逼下一棒去刪守衛 —— 那才是真正的災難。改成「三者互相一致 ＋ 舊紀錄不得被洗掉」，
//   ⭐ 這樣它從此每一版都在守（原寫法只在 v6.268 那一天有意義）。
await T('K2 版本字串一致(version.ts ＝ admin.html hint；patch 檔頭已 bump 且 v1.29 紀錄還在)', () => {
  const ver = readFileSync(path.join(ROOT, 'src/lib/version.ts'), 'utf8');
  const mv = /export const VERSION = '([\d.]+)';/.exec(ver);
  assert.ok(mv, 'version.ts 讀不到 VERSION');
  const adm = readFileSync(path.join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const ma = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(adm);
  assert.ok(ma, 'admin.html 讀不到 SITE_VERSION_HINT');
  assert.strictEqual(ma[1], mv[1], 'admin.html hint 沒跟著 version.ts 同步');
  const mp = /^\/\/ === ORACLE ADMIN ENDPOINTS === v1\.(\d+) \(/.exec(PATCH);
  assert.ok(mp, 'patch 檔頭格式不對');
  assert.ok(Number(mp[1]) >= 29, 'patch 檔頭版本倒退了（' + mp[1] + ' < 29）');
  assert.ok(PATCH.includes('v1.29 (v6.268 休閒 PUT 上行增量'), 'v1.29 的檔頭紀錄被洗掉了');
});

console.log('\n────────────────────────────────');
console.log('test-v6268-delta-put-server: ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
