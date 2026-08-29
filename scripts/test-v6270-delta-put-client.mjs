// 守衛：v6.270 休閒 PUT 上行增量【階段 2：client 端】
//
// 條目總覽：
//   【A】client 區塊抽得出來＋room-oracle 接線是**行為端**（sentinel on ⇒ 真的送出 patch）
//   【B】正對照（站長硬約束）：
//        (a) 哨兵缺席 ⇒ 請求序列與 BASE **逐字相同**（BASE blob 對跑；淺複製時 shallowSkip
//            並以「無 patchProto／body 形狀」的 history-free 判準頂上）
//        (b) 熔斷後 ⇒ 全量，行為與 BASE 相同
//        (c) 錦標賽 tApi 逐位元不變（BASE blob ＋ history-free 雙判準）＋ server_admin_patch.js 未動
//        (d) Firestore 版 room.ts／firebase.ts 未動（sha256 內嵌，VERSION-gated）
//        (e) 一般玩家（匿名／未登入）診斷 0 發（行為端實跑）
//   【C】端到端 round-trip：client diff → **v6.268 真 middleware** 套用 → canonical hash
//        固定案例 ＋ 隨機突變 fuzz 10,000 次
//   【D】三態的 client 行為（409＝交回 oracleTx 重試；422/400＝當場改送全量；正常）＋熔斷
//   【E】60% 門檻／上限／「哨兵以最近一次 GET 為準」
//   【F】bodyBytes（patch/full 分開統計）＋ casual-delta-fuse 指紋接線（行為端）
//   【G】perf：48KB 代表性房 doc 的 client 端新增 CPU p99
//   【H】dump 補 phantom 欄位（實跑 casualSummary；既有欄位一個不少）
//   【I】突變 8 條 —— 每一條必須紅在**預期的那一條斷言**（只捕捉 AssertionError）
//   【J】HEAD-FAIL：對 BASE（v6.269）blob 跑，各項各自紅（淺複製時 shallowSkip）
//   【K】自查：守衛在 package.json test chain 裡
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = 'd9f9b4351b5642095d59d7a2db9037064989855a';   // v6.269
const require_ = createRequire(import.meta.url);
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;

// ⚠ Windows checkout 的工作樹可能是 CRLF（git autocrlf），而 blob／CI 是 LF ⇒
//   讀檔一律正規化成 LF，否則 sha 錨定與 '\n' 錨點在不同平台上會假紅。
const R = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const OC = R(path.join(ROOT, 'src/lib/game/oracle-client.ts'));
const RO = R(path.join(ROOT, 'src/lib/game/room-oracle.ts'));
const GP = R(path.join(ROOT, 'src/routes/game/+page.svelte'));
const SRV = R(path.join(ROOT, 'oracle-admin/server_admin_patch.js'));
const DUMP_PATH = path.join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs');
const VERSION = /VERSION = '([\d.]+)'/.exec(R(path.join(ROOT, 'src/lib/version.ts')))[1];

// ── 零接觸錨定（VERSION-gated 整檔 sha256；停用時明講，不是靜默）──
const SRV_SHA_V6269 = '8b0ae33d7643c462843d12eaf41ca92e756570f61c224d590a01afea885318c4';
const ROOMTS_SHA_V6269 = '8a5df9f8c3a9f08e1a77331b7969cb852f2c6ac955385187d71f6c50d32df2d5';
const FIREBASE_SHA_V6269 = '24edb0f99c00cdca5fb2e60c4e9eddfdd5be6792bfe20db0519b50684230bed4';

let pass = 0, fail = 0;
async function T(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // 只捕捉 AssertionError（守衛安慰劑鐵律）
    fail++; console.log('  ✗ ' + name + '\n    ' + String(e.message).slice(0, 400));
  }
}

// ── 抽取器 ──────────────────────────────────────────────────────────────────
function extractBlock(src, sentS, sentE, minLen, label) {
  const i = src.indexOf(sentS);
  assert.ok(i >= 0, '抽不到 ' + label + ' 起點（' + sentS.slice(0, 48) + '）');
  const j = src.indexOf(sentE, i + sentS.length);
  assert.ok(j > i, '抽不到 ' + label + ' 終點');
  const out = src.slice(i, j + sentE.length);   // 含首尾錨點（v6246 同款；錨點行都是註解/程式尾）
  assert.ok(out.length >= minLen, label + ' 只抽到 ' + out.length + ' 字元（下限 ' + minLen + '）');
  return out;
}
const CB_S = '// >>> v6270-delta-put-client-core';
const CB_E = '// <<< v6270-delta-put-client-core';

// ── client 區塊實跑器：把抽出的 TS 區塊接上可注入的 oracleApi/oracleUpsertRoom ──
function loadClientCore(srcOC, hooks = {}) {
  const block = extractBlock(srcOC, CB_S, CB_E, 4000, 'v6270 client 區塊');
  const js = ts2js(block.replace(/^export /gm, ''));
  const calls = [];
  const oracleUpsertRoom = hooks.oracleUpsertRoom ?? (async (code, data, ev, opts) => {
    calls.push({ kind: 'full', code, body: JSON.parse(JSON.stringify({ data, expectedVersion: ev })) });
    return { ok: true, version: (ev ?? 0) + 1, room: { ...JSON.parse(JSON.stringify(data)), _version: (ev ?? 0) + 1, updatedAt: 999 } };
  });
  const oracleApi = hooks.oracleApi ?? (async () => { throw new Error('oracleApi 不該被呼叫'); });
  const oracleErrorStatus = (e) => (e && typeof e.status === 'number') ? e.status : null;
  const _noteRoomServerTime = () => {};
  const fn = new Function('oracleUpsertRoom', 'oracleApi', 'oracleErrorStatus', '_noteRoomServerTime',
    '"use strict";' + js + `;return { deltaPutBase, buildRoomPatch, deltaPutCanonHash, oracleUpsertRoomDelta,
      deltaPutDiag, deltaPutFuseTripped, _noteDeltaPutSentinel, _dpUtf8Len,
      DELTA_PUT_FULL_RATIO, DELTA_PUT_MAX_SET, DELTA_PUT_MAX_LOGAPPEND, DELTA_PUT_FUSE_LIMIT };`);
  const m = fn((...a) => oracleUpsertRoom(...a), (...a) => oracleApi(...a), oracleErrorStatus, _noteRoomServerTime);
  m.calls = calls;
  return m;
}

// ── v6.268 真 middleware 實跑器（同 test-v6268 手法）──
const DPBLOCK = extractBlock(SRV, '// >>> PTCG-DELTA-PUT-BLOCK-START', '// <<< PTCG-DELTA-PUT-BLOCK-END', 3000, '伺服器 delta-put 區塊');
const SRV_DB = { docs: {} };
async function makeServerMw() {
  const stack = [{ handle: function q() {} }, { route: { path: '/api/rooms/:code' } }];
  const app = { use(f) { stack.push({ handle: f }); } };
  app._router = { stack };
  const before = new Set(stack.map((l) => l.handle));
  const db = { collection: () => ({ findOne: async (qq) => {
    const d = SRV_DB.docs[qq && qq._id];
    return d === undefined ? null : structuredClone(d);
  } }) };
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + DPBLOCK + '\n})();')(app, db, { log() {}, warn() {} });
  const news = stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle);
  assert.equal(news.length, 1, '伺服器區塊應恰好掛 1 支 mw');
  return news[0];
}
const SERVER_MW = await makeServerMw();
function fakeRes() {
  return { statusCode: 200, body: undefined, jsonCalled: false, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.jsonCalled = true; this.headersSent = true; return this; } };
}
/** 完整假伺服器：middleware → 核心 PUT（$set + email 回填 + _version bump）。 */
function makeOracleApiOverRealServer(opts = {}) {
  const log = [];
  const api = async (pathArg, options) => {
    const method = options?.method ?? 'GET';
    const body = options?.body === undefined ? undefined : JSON.parse(JSON.stringify(options.body));
    log.push({ method, path: pathArg, body });
    const m = /^\/api\/rooms\/([^/?]+)/.exec(pathArg);
    const code = m ? m[1].toUpperCase() : null;
    const req = { method, originalUrl: pathArg, url: pathArg, body };
    const res = fakeRes();
    let nexted = false;
    await SERVER_MW(req, res, () => { nexted = true; });
    if (!nexted) {
      if (res.statusCode === 409) return res.body;   // oracleApi 對 409 回 json（既有行為）
      const e = new Error(`oracleApi ${pathArg} → ${res.statusCode}: ${JSON.stringify(res.body)}`);
      e.status = res.statusCode;
      throw e;
    }
    // 核心端點模擬
    if (method === 'GET') {
      const doc = SRV_DB.docs[code];
      if (!doc) { const e = new Error(`oracleApi ${pathArg} → 404: room not found`); e.status = 404; throw e; }
      // v1.20 email 剝除（PTCG-ROOMS-OUT 的 GET 出口）
      const out = { room: JSON.parse(JSON.stringify({ ...doc, seats: (doc.seats || []).map((s) => (s && s.email != null) ? { ...s, email: null } : s) })) };
      res.json(out);   // 讓 middleware 對 GET 的 res.json 包裝（真哨兵 deltaPut:1）生效
      return res.body;
    }
    if (method === 'PUT') {
      const doc = SRV_DB.docs[code];
      const data = req.body && req.body.data;
      const ev = req.body && req.body.expectedVersion;
      if (!data || typeof data !== 'object') { const e = new Error(`oracleApi ${pathArg} → 400: missing data`); e.status = 400; throw e; }
      if (!doc) { const e = new Error(`oracleApi ${pathArg} → 404`); e.status = 404; throw e; }
      if (ev !== undefined && ev !== doc._version) {
        return { conflict: true, currentVersion: doc._version, room: null };
      }
      // v1.20 keep-email（全量路徑）＋ $set 語義
      const d = JSON.parse(JSON.stringify(data));
      if (Array.isArray(d.seats) && Array.isArray(doc.seats)) {
        for (let i = 0; i < d.seats.length; i++) {
          const s = d.seats[i], o = doc.seats[i];
          if (s && typeof s === 'object' && s.uid && s.email == null && o && o.uid === s.uid && o.email != null) s.email = o.email;
        }
      }
      const out = { ...doc };
      for (const k of Object.keys(d)) out[k] = d[k];
      out._version = doc._version + 1;
      out.updatedAt = doc.updatedAt + 1;
      SRV_DB.docs[code] = out;
      return { ok: true, version: out._version, room: JSON.parse(JSON.stringify({ ...out, seats: (out.seats || []).map((s) => (s && s.email != null) ? { ...s, email: null } : s) })) };
    }
    throw new Error('未支援的 method ' + method);
  };
  api.log = log;
  return api;
}

// ── 參照 canonical（獨立實作，與兩端都要相同）──
function refCanonStr(x, d = 0) {
  if (d > 32) throw new Error('ref-too-deep');
  if (x === null || x === undefined) return 'n';
  const t = typeof x;
  if (t === 'boolean') return x ? 't' : 'f';
  if (t === 'number') return Number.isFinite(x) ? 'd' + String(x) : 'n';
  if (t === 'string') return 's' + JSON.stringify(x);
  if (Array.isArray(x)) { let s = '['; for (const it of x) s += refCanonStr(it, d + 1) + ','; return s + ']'; }
  if (t === 'object') {
    let s = '{';
    for (const k of Object.keys(x).sort()) { if (x[k] === undefined) continue; s += JSON.stringify(k) + ':' + refCanonStr(x[k], d + 1) + ','; }
    return s + '}';
  }
  return 'n';
}
const sameJson = (a, b) => refCanonStr(a) === refCanonStr(b);

// ── 代表性房 doc ─────────────────────────────────────────────────────────────
function makeDoc(pad = 60) {
  const log = [];
  for (let i = 0; i < pad; i++) log.push({ t: i, msg: '第 ' + i + ' 手：對戰紀錄中文填充字串補齊補齊補齊' });
  return {
    _id: 'ROOM', _version: 7, createdAt: 100, updatedAt: 111, status: 'playing',
    heartbeats: { p1: 11, p2: 22 },
    seats: [
      { role: 'p1', uid: 'u1', email: 'a@b.c', name: '甲', deckEntries: null, deckId: 'd1', ready: true, firstChoicePreference: 'random' },
      { role: 'p2', uid: 'u2', email: null, name: '乙', deckEntries: null, deckId: null, ready: true, firstChoicePreference: 'random' },
    ],
    gameState: {
      id: 'g1', log, turn: 3, phase: 'playing', pendingSelection: null,
      players: [{ hand: ['a', 'b', 'c'], board: 'x'.repeat(2000) }, { hand: ['d'], board: 'y'.repeat(2000) }],
    },
  };
}
const clientViewOf = (doc) => JSON.parse(JSON.stringify({ ...doc, seats: (doc.seats || []).map((s) => (s && s.email != null) ? { ...s, email: null } : s) }));

// ── room-oracle 實跑器（v6.265 的 CJS 手法；oracle-client stub 可帶真 delta 函式）──
function loadRoomOracle(roSrc, ocStub) {
  const code = esbuild.transformSync(roSrc, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const stubs = {
    './oracle-client': ocStub,
    '$lib/firebase': { auth: { currentUser: null } },
    './engine': { createGame: () => ({ id: 'x', phase: 'setup' }) },
    './sync-guards': { shouldSkipStalePush: () => false },
    '$lib/ui/stale-keep': { adoptOrKeep: (p, n) => ({ data: n ?? p, stale: n == null }) },
    './room': {
      SEAT_LAYOUT_VERSION: 1, TOTAL_SEATS: 10, SPECTATOR_SEATS: 8, HEARTBEAT_STALE_MS: 1,
      generateRoomCode: () => 'AAAA', findMySeatIdx: () => 0, countDeckCards: () => 60,
      bothPlayersReady: () => true, isSeatStale: () => false,
      LOBBY_HOST_AWAY_MS: 1, LOBBY_HOST_STALE_MS: 1, hostPresence: () => 'ok',
      isLobbyHostDead: () => false, isLobbyTooOld: () => false,
    },
  };
  const mod = { exports: {} };
  const req = (id) => { if (!(id in stubs)) throw new Error('未預期的 import：' + id); return stubs[id]; };
  const f = new Function('module', 'exports', 'require', 'console', 'setTimeout',
    code + '\nreturn module.exports;');
  return f(mod, mod.exports, req, { warn() {}, error() {}, log() {} }, (fn) => fn());
}
/** 建一組「真 client 區塊 ＋ 真 middleware 伺服器 ＋ 真 room-oracle」的完整線上環境。 */
function makeWorld(srcOC = OC, srcRO = RO) {
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(srcOC, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev, opts) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: ev === undefined ? { data } : { data, expectedVersion: ev }, timeoutMs: opts?.timeoutMs }) });
  const ocStub = {
    oracleAuth: async () => ({ uid: 'u1' }), oracleApi: api,
    oracleGetRoom: async (code) => {
      const res = await api(`/api/rooms/${code.toUpperCase()}`).catch((e) => { if (e && e.status === 404) return null; throw e; });
      if (res === null) return null;
      M._noteDeltaPutSentinel(res);   // ⭐ 與出貨版 oracleGetRoom 同一個掛點（下面 A3 驗出貨版原始碼真的有）
      return res.room;
    },
    oracleUpsertRoom: async (code, data, ev, opts) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: ev === undefined ? { data } : { data, expectedVersion: ev }, timeoutMs: opts?.timeoutMs }),
    oracleDeleteRoom: async () => {}, oracleListRooms: async () => [],
    oraclePollRoom: () => () => {}, oracleListMessages: async () => [],
    oracleCurrentUid: () => 'u1', oracleListRoomsCombined: async () => [],
    ROOMS_UNCHANGED: Symbol('u'), ROOMS_COMBINED_UNSUPPORTED: Symbol('c'),
    isOracleTimeout: () => false, isOracleUploadBudgetTimeout: () => false,
    ORACLE_SIDEEFFECT_TIMEOUT_MS: 60000,
    deltaPutBase: M.deltaPutBase, oracleUpsertRoomDelta: M.oracleUpsertRoomDelta,
  };
  const ROM = loadRoomOracle(srcRO, ocStub);
  return { api, M, ROM };
}

console.log('══ 【A】抽取＋接線（行為端） ═══════════════════════════════════');
await T('A1 v6270 client 區塊存在、抽得出來、esbuild 編得過', () => {
  const b = extractBlock(OC, CB_S, CB_E, 4000, 'v6270 client 區塊');
  assert.ok(ts2js(b.replace(/^export /gm, '')).length > 1000);
});
await T('A2 ⭐⭐ 行為端：sentinel on ⇒ 真 room-oracle 的 pushGameState 真的送出 patch，且落庫正確', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const { api, ROM } = makeWorld();
  const st = { ...clientViewOf(SRV_DB.docs.ROOM).gameState, turn: 4 };
  st.log = st.log.concat([{ t: 999, msg: '新事件' }]);
  await ROM.pushGameState('room', st);
  const puts = api.log.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1, 'PUT 次數 ' + puts.length);
  assert.equal(puts[0].body.patchProto, 1, '沒送 patch：' + JSON.stringify(Object.keys(puts[0].body)));
  assert.ok(puts[0].body.patch && puts[0].body.patch.logAppend, 'log 應走 logAppend');
  assert.equal(SRV_DB.docs.ROOM.gameState.turn, 4, '落庫 turn 不對');
  assert.equal(SRV_DB.docs.ROOM.gameState.log.length, makeDoc().gameState.log.length + 1, '落庫 log 沒 append');
  assert.equal(SRV_DB.docs.ROOM.seats[0].email, 'a@b.c', 'email 被洗掉了');
  assert.equal(SRV_DB.docs.ROOM._version, 8);
});
await T('A3 出貨碼接線（不是只有 harness）：oracleGetRoom/oracleGetRoomDelta 有 _noteDeltaPutSentinel；oracleTx 有 delta 分支', () => {
  const g1 = OC.slice(OC.indexOf('export async function oracleGetRoom('), OC.indexOf('export async function oracleGetRoomDelta('));
  assert.ok(/_noteDeltaPutSentinel\(res\)/.test(g1), 'oracleGetRoom 沒接哨兵');
  const g2 = OC.slice(OC.indexOf('export async function oracleGetRoomDelta('), OC.indexOf('export async function oracleUpsertRoom('));
  assert.ok(/_noteDeltaPutSentinel\(res\)/.test(g2), 'oracleGetRoomDelta 沒接哨兵');
  const tx = extractBlock(RO, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
  assert.ok(/deltaPutBase/.test(tx) && /oracleUpsertRoomDelta/.test(tx), 'oracleTx 沒接 delta');
  assert.ok(/const dpBase = \(typeof deltaPutBase === 'function'\)/.test(tx), 'deltaPutBase 缺 typeof 防衛（會弄壞 test-v6245/6246 的抽取 harness）');
  // 快照必須在 fn 之前（fn 可能就地改 room）
  assert.ok(tx.indexOf('deltaPutBase') < tx.indexOf('await fn(data)'), '差分基底必須在 fn 之前快照');
});

console.log('\n══ 【C】端到端 round-trip（真 middleware） ═════════════════════');
const MC = loadClientCore(OC);   // 純函式用（不打網路）
function roundTrip(doc, mutate) {
  const prev = clientViewOf(doc);
  const next = mutate(JSON.parse(JSON.stringify(prev)));
  const patch = MC.buildRoomPatch(prev, next);
  return { prev, next, patch };
}
async function serveDelta(doc, next, patch, ev = doc._version) {
  SRV_DB.docs = { ROOM: doc };
  const body = { patchProto: 1, patch, fullHash: MC.deltaPutCanonHash(next), expectedVersion: ev };
  const req = { method: 'PUT', originalUrl: '/api/rooms/ROOM', url: '/api/rooms/ROOM', body: JSON.parse(JSON.stringify(body)) };
  const res = fakeRes();
  let nexted = false;
  await SERVER_MW(req, res, () => { nexted = true; });
  return { req, res, nexted };
}
await T('C1 固定案例：中文／巢狀 set／logAppend／top-level 刪欄／新欄 → 重建與 next 同形（email 回填為預期差異）', async () => {
  const doc = makeDoc();
  const { next, patch } = roundTrip(doc, (n) => {
    n.gameState.turn = 4;
    n.gameState.log = n.gameState.log.concat([{ t: 999, msg: '「沸騰鬥志」發動' }]);
    n.gameState.players = [{ hand: ['a'] }, { hand: ['d', 'e'] }];
    n.undoRequest = { by: 'p1' };
    delete n.heartbeats;
    return n;
  });
  assert.ok(patch, 'patch 應可建');
  assert.ok(patch.logAppend && patch.logAppend.length === 1, 'log 應走 append');
  assert.ok(patch.del.includes('heartbeats'), 'top-level 刪欄應進 del');
  const { req, res, nexted } = await serveDelta(doc, next, patch);
  assert.ok(nexted, '被拒：' + JSON.stringify(res.body ?? null).slice(0, 200));
  const expect = JSON.parse(JSON.stringify(next));
  expect.seats[0].email = 'a@b.c';   // email 回填（v1.20 規則）
  assert.ok(sameJson(req.body.data, expect), '重建結果與 next 不同形');
});
await T('C2 悔棋型 log 整包重寫（前綴不同）→ 走 set 不走 append，仍然正確', async () => {
  const doc = makeDoc();
  const { next, patch } = roundTrip(doc, (n) => { n.gameState.log = [{ t: 1, msg: '重來' }]; return n; });
  assert.ok(patch && !patch.logAppend && patch.set['gameState.log'], '應走 set');
  const { req, nexted } = await serveDelta(doc, next, patch);
  assert.ok(nexted);
  assert.equal(req.body.data.gameState.log.length, 1);
});
await T('C3 鍵序漂移免疫：DB doc 鍵序打亂後仍被接受', async () => {
  const doc = makeDoc();
  const shuffled = {};
  for (const k of Object.keys(doc).reverse()) shuffled[k] = doc[k];
  const gs = {}; for (const k of Object.keys(doc.gameState).reverse()) gs[k] = doc.gameState[k];
  shuffled.gameState = gs;
  const { next, patch } = roundTrip(doc, (n) => { n.gameState.turn = 99; return n; });
  const { nexted, res } = await serveDelta(shuffled, next, patch);
  assert.ok(nexted, '鍵序漂移被誤判 hash 不符：' + JSON.stringify(res.body ?? null).slice(0, 120));
});
await T('C4 ⭐⭐ 隨機突變 fuzz 10,000 次：client diff → 真 middleware apply → hash 兩端一致', async () => {
  let s = 20260830;
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
  const SUBS = ['turn', 'phase', 'pendingSelection', 'players', 'coin'];
  let ran = 0, patched = 0;
  for (let it = 0; it < 10000; it++) {
    const doc = { _id: 'ROOM', _version: 1 + Math.floor(rnd() * 5),
      gameState: { log: [{ t: 1, m: '開局' }], turn: 1 }, status: 'playing', updatedAt: 5, createdAt: 1,
      seats: [{ role: 'p1', uid: 'u1', email: rnd() < 0.5 ? 'a@b.c' : null }, { role: 'p2', uid: 'u2', email: null }] };
    for (const k of TOPS) if (rnd() < 0.5) doc[k] = rv(0);
    for (const k of SUBS) if (rnd() < 0.5) doc.gameState[k] = rv(0);
    const prev = clientViewOf(doc);
    const next = JSON.parse(JSON.stringify(prev));
    const nops = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < nops; i++) {
      const r = rnd();
      if (r < 0.3) next[pick(TOPS)] = rv(0);
      else if (r < 0.45) delete next[pick(TOPS)];
      else if (r < 0.7) next.gameState[pick(SUBS)] = rv(0);
      else if (r < 0.8) delete next.gameState[pick(SUBS)];
      else if (r < 0.9) next.gameState.log = next.gameState.log.concat([{ t: 2 + i, m: '第' + it + '筆中文紀錄' }]);
      else next.gameState.log = [{ t: 1, m: '悔棋重寫' + it }];
    }
    const patch = MC.buildRoomPatch(prev, next);
    assert.ok(patch, 'fuzz #' + it + '：diff 竟然回 null');
    const { req, res, nexted } = await serveDelta(doc, next, patch, doc._version);
    assert.ok(nexted, 'fuzz #' + it + ' 被拒：' + JSON.stringify(res.body ?? null).slice(0, 150));
    // email 回填規則套到 next 上再比
    const expect = JSON.parse(JSON.stringify(next));
    if (Array.isArray(expect.seats)) for (let k = 0; k < expect.seats.length; k++) {
      const a = expect.seats[k], o = doc.seats[k];
      if (a && a.uid && a.email == null && o && o.uid === a.uid && o.email != null) a.email = o.email;
    }
    assert.ok(sameJson(req.body.data, expect), 'fuzz #' + it + ' 重建不一致');
    ran++; patched++;
  }
  assert.equal(ran, 10000);
  console.log('     fuzz 10,000 次全數 round-trip 一致');
});
await T('C5 client canonical hash 與伺服器逐字元同款（打亂鍵序仍同值；與獨立參照實作對照）', () => {
  for (const v of [makeDoc(), { a: [1, 2, { b: '中' }], c: null }, { gameState: { log: [] } }]) {
    const h = MC.deltaPutCanonHash(v);
    const shuffled = JSON.parse(JSON.stringify(v));   // 鍵序同 → 先驗自反
    assert.equal(MC.deltaPutCanonHash(shuffled), h);
    // 與參照字串版 FNV 對照
    const str = refCanonStr(v);
    let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
    }
    assert.equal(h, h1.toString(16) + '-' + h2.toString(16), '與參照實作不同');
  }
});

console.log('\n══ 【D】三態的 client 行為 ＋ 熔斷 ═══════════════════════════');
await T('D1 409（版本不符）→ oracleTx 下一輪重 GET 重 diff，最終成功；patch 不在 409 當場重送', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const realApi = makeOracleApiOverRealServer();
  let putCount = 0;
  const wrapped = async (p, o) => {
    if ((o?.method ?? 'GET') === 'PUT' && ++putCount === 1) {
      // 模擬他人搶先寫入 ⇒ 第一發 PUT 撞 409
      SRV_DB.docs.ROOM = { ...SRV_DB.docs.ROOM, heartbeats: { p1: 99, p2: 22 }, _version: SRV_DB.docs.ROOM._version + 1, updatedAt: 112 };
    }
    return realApi(p, o);
  };
  const M3 = loadClientCore(OC, { oracleApi: wrapped,
    oracleUpsertRoom: async (code, data, ev) => wrapped(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  const stub = {
    oracleAuth: async () => ({ uid: 'u1' }), oracleApi: wrapped,
    oracleGetRoom: async (code) => { const r = await wrapped(`/api/rooms/${code.toUpperCase()}`); M3._noteDeltaPutSentinel(r); return r.room; },
    oracleUpsertRoom: async (code, data, ev) => wrapped(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }),
    oracleDeleteRoom: async () => {}, oracleListRooms: async () => [], oraclePollRoom: () => () => {},
    oracleListMessages: async () => [], oracleCurrentUid: () => 'u1', oracleListRoomsCombined: async () => [],
    ROOMS_UNCHANGED: Symbol('u'), ROOMS_COMBINED_UNSUPPORTED: Symbol('c'),
    isOracleTimeout: () => false, isOracleUploadBudgetTimeout: () => false, ORACLE_SIDEEFFECT_TIMEOUT_MS: 60000,
    deltaPutBase: M3.deltaPutBase, oracleUpsertRoomDelta: M3.oracleUpsertRoomDelta,
  };
  const RO2 = loadRoomOracle(RO, stub);
  const st = { ...clientViewOf(SRV_DB.docs.ROOM).gameState, turn: 5 };
  await RO2.pushGameState('room', st);
  assert.equal(putCount, 2, 'PUT 次數應為 2（409 後下一輪重 GET 重 diff），實得 ' + putCount);
  const puts = realApi.log.filter((c) => c.method === 'PUT');
  assert.ok(puts.every((c) => c.body.patchProto === 1), '兩發都應是 patch（409 不該退全量）');
  assert.equal(SRV_DB.docs.ROOM.gameState.turn, 5, '最終沒寫進去');
  assert.equal(SRV_DB.docs.ROOM.heartbeats.p1, 99, '重 diff 應以他人寫入後的房間為基底');
  assert.ok(!M3.deltaPutFuseTripped(), '409 不可以累進熔斷');
  assert.equal(M3.deltaPutDiag().rejects, 0, '409 不算 deltaReject');
});
await T('D2 422（hash 不符）→ 當場改送全量（同一 attempt），對局不中斷；連續計數 +1', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  // 讓 client 的 hash 一定不符：把 client 區塊的 fullHash 換成壞值 → 用 hook 攔 body
  const api = makeOracleApiOverRealServer();
  let mangled = 0;
  const bad = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1) { o = { ...o, body: { ...o.body, fullHash: 'deadbeef-1234' } }; mangled++; }
    return api(p, o);
  };
  const M4 = loadClientCore(OC, { oracleApi: bad,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M4._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const base = M4.deltaPutBase(prev);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 6;
  const r = await M4.oracleUpsertRoomDelta('room', next, 7, base);
  assert.ok(r && r.ok, '422 後應改送全量成功：' + JSON.stringify(r).slice(0, 120));
  assert.equal(mangled, 1);
  assert.equal(SRV_DB.docs.ROOM.gameState.turn, 6, '全量沒落庫');
  const dg = M4.deltaPutDiag();
  assert.equal(dg.rejects, 1);
  assert.equal(dg.lastReason, 'hash', 'lastReason=' + dg.lastReason);
  assert.ok(!M4.deltaPutFuseTripped(), '一次拒收不該熔斷');
});
await T('D3 400（middleware 被整個撤掉）→ 同樣改送全量', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const api = makeOracleApiOverRealServer();
  const no400 = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1) {
      const e = new Error(`oracleApi ${p} → 400: missing data`); e.status = 400; throw e;
    }
    return api(p, o);
  };
  const M5 = loadClientCore(OC, { oracleApi: no400,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M5._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 8;
  const r = await M5.oracleUpsertRoomDelta('room', next, 7, M5.deltaPutBase(prev));
  assert.ok(r && r.ok);
  assert.equal(SRV_DB.docs.ROOM.gameState.turn, 8);
  assert.equal(M5.deltaPutDiag().lastReason, 'http-400');
});
await T('D4 ⭐⭐ 連 3 次 deltaReject → 本 session 熔斷：之後 deltaPutBase 回 null（全走全量、零多餘序列化）', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const api = makeOracleApiOverRealServer();
  const bad = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1) o = { ...o, body: { ...o.body, fullHash: 'deadbeef-1234' } };
    return api(p, o);
  };
  const M6 = loadClientCore(OC, { oracleApi: bad,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M6._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  for (let i = 0; i < 3; i++) {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 100 + i;
    const r = await M6.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M6.deltaPutBase(prev));
    assert.ok(r && r.ok, '第 ' + i + ' 發應退全量成功');
  }
  assert.ok(M6.deltaPutFuseTripped(), '3 次拒收後應熔斷');
  assert.equal(M6.deltaPutBase(clientViewOf(SRV_DB.docs.ROOM)), null, '熔斷後 deltaPutBase 必須回 null');
  // 熔斷後即使硬塞 base，也照 D 系列不會再走 patch？——出貨路徑是 oracleTx 拿 base=null ⇒ 全量
  assert.equal(M6.deltaPutDiag().fused, true);
});
await T('D5 成功送達 patch ⇒ 連續拒收歸零（「連 3 次」是連續不是累計）', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const api = makeOracleApiOverRealServer();
  let sabotage = true;
  const flaky = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1 && sabotage) o = { ...o, body: { ...o.body, fullHash: 'deadbeef-1234' } };
    return api(p, o);
  };
  const M7 = loadClientCore(OC, { oracleApi: flaky,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M7._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  const push = async (turn) => {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = turn;
    return M7.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M7.deltaPutBase(prev));
  };
  await push(1); await push(2);                 // 2 連拒
  sabotage = false; await push(3);              // 成功 patch → 歸零
  sabotage = true; await push(4); await push(5); // 又 2 連拒 —— 若沒歸零這裡就熔斷了
  assert.ok(!M7.deltaPutFuseTripped(), '成功後沒歸零 ⇒ 熔斷提早發生');
  assert.equal(M7.deltaPutDiag().rejects, 4);
});

console.log('\n══ 【E】60% 門檻／上限／哨兵語義 ═══════════════════════════════');
await T('E1 ⭐ 開局情境（整包重寫）：patch > 全量 60% ⇒ 直接送全量', async () => {
  SRV_DB.docs = { ROOM: { ...makeDoc(0), status: 'lobby', gameState: null } };   // 開局前的房
  const { api, ROM } = makeWorld();
  const st = makeDoc(40).gameState;   // 整包新盤面
  const ok = await ROM.startGame('room', { ...st, id: 'newgame' });
  assert.ok(ok, 'startGame 應成功');
  const puts = api.log.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.ok(!('patchProto' in puts[0].body), '整包重寫竟然送了 patch（60% 門檻沒作用）');
  assert.ok('data' in puts[0].body && 'expectedVersion' in puts[0].body, '全量 body 形狀不對');
});
await T('E2 上限：gameState 子鍵變更超過 256 個 ⇒ 送全量（絕不賭伺服器收不收）', () => {
  const base = { gameState: {} , _id: 'R', _version: 1 };
  const next = { gameState: {}, _id: 'R', _version: 1 };
  for (let i = 0; i < 300; i++) next.gameState['k' + i] = i;
  const p = MC.buildRoomPatch(base, next);
  assert.equal(p, null, '超限應回 null（呼叫端送全量）');
});
await T('E3 ⭐ 哨兵以最近一次 GET 為準：deltaPut 消失（kill switch 撤掉）⇒ 下一發變全量', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const { api, M, ROM } = makeWorld();
  const st1 = { ...clientViewOf(SRV_DB.docs.ROOM).gameState, turn: 4 };
  await ROM.pushGameState('room', st1);
  assert.equal(api.log.filter((c) => c.method === 'PUT' && c.body.patchProto === 1).length, 1, '第一發應為 patch');
  // 模擬 kill switch 撤掉：GET 回應不再帶 deltaPut
  M._noteDeltaPutSentinel({ room: {} });   // 最近一次 GET 沒哨兵
  assert.equal(M.deltaPutBase(clientViewOf(SRV_DB.docs.ROOM)), null, '哨兵消失後 deltaPutBase 必須回 null');
});
await T('E4 哨兵缺席時 deltaPutBase 完全不複製（零多餘 CPU 的結構性證明）', () => {
  const M8 = loadClientCore(OC);
  // 從未看過哨兵 ⇒ null（連 JSON.parse 都不做 —— 用超大物件會 throw 的 proxy 驗證）
  const trap = new Proxy({}, { ownKeys() { throw new Error('不該被列舉'); }, getOwnPropertyDescriptor() { throw new Error('不該被讀'); } });
  assert.equal(M8.deltaPutBase(trap), null, '哨兵缺席還去讀 room');
});

console.log('\n══ 【B】正對照（站長硬約束） ═══════════════════════════════════');
function collectTxRequests(srcRO, srcOC, sentinelOn) {
  // 只抽 oracleTx ＋ 假 GET/PUT，記錄請求序列（method/body 逐字）
  const txBlock = extractBlock(srcRO, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
  const js = ts2js(txBlock);
  const reqs = [];
  const doc = clientViewOf(makeDoc());
  const oracleGetRoom = async () => JSON.parse(JSON.stringify(doc));
  const oracleUpsertRoom = async (code, data, ev, opts) => {
    reqs.push(JSON.stringify({ kind: 'full', code, data, ev, timeoutMs: opts?.timeoutMs ?? null }));
    return { ok: true, version: ev + 1, room: { ...data, _version: ev + 1 } };
  };
  const isOracleTimeout = () => false, isOracleUploadBudgetTimeout = () => false;
  // 新版 oracleTx 內的 delta 識別字：BASE 沒有；新版有 → 依 sentinelOn 決定是否注入
  const extra = sentinelOn ? (() => {
    const M9 = loadClientCore(srcOC, { oracleApi: async (p, o) => { reqs.push(JSON.stringify({ kind: 'api', p, body: o.body })); return { ok: true, version: 99, room: {} }; },
      oracleUpsertRoom });
    M9._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
    return { deltaPutBase: M9.deltaPutBase, oracleUpsertRoomDelta: M9.oracleUpsertRoomDelta };
  })() : {};
  const mk = new Function('oracleGetRoom', 'oracleUpsertRoom', 'isOracleTimeout', 'isOracleUploadBudgetTimeout', 'setTimeout', 'deltaPutBase', 'oracleUpsertRoomDelta',
    js + '\n;return oracleTx;');
  const oracleTx = mk(oracleGetRoom, oracleUpsertRoom, isOracleTimeout, isOracleUploadBudgetTimeout, (fn) => fn(), extra.deltaPutBase, extra.oracleUpsertRoomDelta);
  return (async () => {
    await oracleTx('ROOM', (d) => ({ ...d, gameState: { ...d.gameState, turn: 4 } }));
    return reqs;
  })();
}
await T('B1 (a) ⭐⭐ 哨兵缺席 ⇒ 請求序列與 BASE **逐字相同**', async () => {
  const now = await collectTxRequests(RO, OC, false);
  assert.equal(now.length, 1, '哨兵缺席仍應只有一發全量 PUT');
  assert.ok(now[0].startsWith('{"kind":"full"'), '哨兵缺席竟然不是全量：' + now[0].slice(0, 80));
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const bRO = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room-oracle.ts');
    assert.ok(bRO.ok, 'BASE blob 讀不到');
    const base = await collectTxRequests(bRO.out, OC, false);
    assert.equal(JSON.stringify(now), JSON.stringify(base), '與 BASE 的請求序列不同');
  } else {
    shallowSkip('v6270-B1 與 BASE 的請求序列逐字比對', '同一件事另有 history-free 判準：本條上兩行的「單發全量、無 patchProto」');
  }
});
await T('B2 (b) 熔斷後 ⇒ 行為與 BASE 相同（全量、請求數相同）', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const { api, M, ROM } = makeWorld();
  // 直接讓熔斷成立：連 3 次拒收（用假 fullHash 打真 middleware）
  const bad = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1) o = { ...o, body: { ...o.body, fullHash: 'deadbeef-1234' } };
    return api(p, o);
  };
  const Mx = loadClientCore(OC, { oracleApi: bad,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  Mx._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  for (let i = 0; i < 3; i++) {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 50 + i;
    await Mx.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, Mx.deltaPutBase(prev));
  }
  assert.ok(Mx.deltaPutFuseTripped());
  // 熔斷後：跑一發 push，PUT 必須是單發全量（與 BASE 形狀相同）
  const before = api.log.length;
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 77;
  const r = await Mx.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, Mx.deltaPutBase(prev));
  assert.ok(r && r.ok);
  const newPuts = api.log.slice(before).filter((c) => c.method === 'PUT');
  assert.equal(newPuts.length, 1, '熔斷後仍應單發');
  assert.ok(!('patchProto' in newPuts[0].body) && 'data' in newPuts[0].body, '熔斷後 body 形狀必須與 BASE 相同');
});
const TAPI_ANCHOR = '  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {';
await T('B3 (c) ⭐⭐ 錦標賽 tApi 逐位元不變 ＋ 零 delta 識別字 ＋ server_admin_patch.js 未動', () => {
  const i = GP.indexOf(TAPI_ANCHOR);
  assert.ok(i > 0, '找不到 tApi 錨點');
  const seg = GP.slice(i, GP.indexOf('\n  }\n', i) + 4);
  assert.ok(seg.length > 300, 'tApi 抽取太短');
  for (const kw of ['patchProto', 'deltaPut', 'oracleUpsertRoomDelta', 'buildRoomPatch']) {
    assert.ok(!seg.includes(kw), 'tApi 出現 ' + kw);
  }
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const b = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
    assert.ok(b.ok);
    const j = b.out.indexOf(TAPI_ANCHOR);
    const bseg = b.out.slice(j, b.out.indexOf('\n  }\n', j) + 4);
    assert.equal(seg, bseg, 'tApi 與 BASE 不同');
  } else {
    shallowSkip('v6270-B3 tApi 與 BASE blob 逐位元比對', 'history-free 判準（零 delta 識別字）仍在上面守著');
  }
  if (VERSION === '6.270') {
    const sha = createHash('sha256').update(SRV, 'utf8').digest('hex');
    assert.equal(sha, SRV_SHA_V6269, '⚠⚠ server_admin_patch.js 被動到了（本版只做 client）sha=' + sha);
  } else {
    console.log('     （VERSION=' + VERSION + '：server_admin_patch.js 的整檔 sha 錨定已停用 —— 這是宣告不是靜默）');
  }
  // 不分版本恆在守：delta-put 區塊本身仍必須存在且 kill switch 為 true（伺服器端由 test-v6268 守）
  assert.ok(SRV.includes('PTCG-DELTA-PUT-BLOCK-START'));
});
await T('B4 (d) ⭐⭐ Firestore 版 room.ts／firebase.ts 未動（零新增讀取的結構性證明）', () => {
  const rt = R(path.join(ROOT, 'src/lib/game/room.ts'));
  const fb = R(path.join(ROOT, 'src/lib/firebase.ts'));
  for (const [name, s] of [['room.ts', rt], ['firebase.ts', fb]]) {
    for (const kw of ['deltaPut', 'patchProto', 'buildRoomPatch']) assert.ok(!s.includes(kw), name + ' 出現 ' + kw);
  }
  if (VERSION === '6.270') {
    assert.equal(createHash('sha256').update(rt, 'utf8').digest('hex'), ROOMTS_SHA_V6269, '⚠⚠ room.ts 被動到了（Firestore 讀取數紅線）');
    assert.equal(createHash('sha256').update(fb, 'utf8').digest('hex'), FIREBASE_SHA_V6269, '⚠⚠ firebase.ts 被動到了');
  } else {
    console.log('     （VERSION=' + VERSION + '：room.ts/firebase.ts 的整檔 sha 錨定已停用 —— 這是宣告不是靜默）');
  }
});

console.log('\n══ 【F】bodyBytes ＋ casual-delta-fuse 指紋（行為端） ═══════════');
await T('F1 patch 與全量的 bodyBytes 分開統計、能分辨；數字＝實送 body 的 UTF-8 位元組', async () => {
  SRV_DB.docs = { ROOM: makeDoc() };
  const api = makeOracleApiOverRealServer();
  const Mf = loadClientCore(OC, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: ev === undefined ? { data } : { data, expectedVersion: ev } }) });
  Mf._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  // 一發 patch
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 4;
  await Mf.oracleUpsertRoomDelta('room', next, 7, Mf.deltaPutBase(prev));
  // 一發全量（重開局：gameState 整包換新 ⇒ patch ≈ 全量 ⇒ 60% 門檻退全量）
  const prev2 = clientViewOf(SRV_DB.docs.ROOM);
  const next2 = JSON.parse(JSON.stringify(prev2));
  const fresh = makeDoc(80).gameState;
  next2.gameState = { ...fresh, id: 'g2', players: [{ hand: ['x'], board: 'q'.repeat(2000) }, { hand: ['y'], board: 'w'.repeat(2000) }] };
  await Mf.oracleUpsertRoomDelta('room', next2, SRV_DB.docs.ROOM._version, Mf.deltaPutBase(prev2));
  const dg = Mf.deltaPutDiag();
  assert.ok(dg.bytes && dg.bytes.patch && dg.bytes.full, 'patch/full 沒分開統計：' + JSON.stringify(dg.bytes));
  assert.equal(dg.bytes.patch.n, 1);
  assert.equal(dg.bytes.full.n, 1);
  assert.ok(dg.bytes.patch.p50 < dg.bytes.full.p50, 'patch 位元組竟然不小於全量');
  // 位元組數 = 實送 body 的 UTF-8 長度
  const sentPatch = api.log.filter((c) => c.method === 'PUT' && c.body.patchProto === 1)[0];
  assert.equal(dg.bytes.patch.p50, Buffer.byteLength(JSON.stringify(sentPatch.body), 'utf8'), 'patch bodyBytes 不等於實送位元組');
  const sentFull = api.log.filter((c) => c.method === 'PUT' && !('patchProto' in c.body))[0];
  assert.equal(dg.bytes.full.p50, Buffer.byteLength(JSON.stringify(sentFull.body), 'utf8'), 'full bodyBytes 不等於實送位元組');
});
// ── +page.svelte 休閒函式 harness（v6.261 手法＋v6.270 的兩支新函式一起抽）──
function softFn(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) return null;
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}
async function mkCasualHarness(pageSrc, { withDelta = true, fuse = false, diag = null } = {}) {
  const CONSTS = ['CASUAL_DIAG_REASONS', 'CASUAL_DIAG_MAX_PER_PAGE', 'CASUAL_SLOW_PUSH_P95_MS', 'CASUAL_PUSH_MIN_CALLS', 'PERF_SAMPLE_RATE'];
  const constLines = CONSTS.map((k) => {
    const m = new RegExp('^\\s*const ' + k + ' = [^\\n]*$', 'm').exec(pageSrc);
    assert.ok(m, '抓不到 ' + k);
    return m[0].trim().replace(/\s*\/\/.*$/, '');
  }).join('\n');
  const anchors = [
    'function _sampleStats(src: number[]): _PStat | null {',
    'function _pushSample(arr: number[], ms: number): void {',
    'function _casualDiagSend(reason: string, now: number): boolean {',
    'function _casualDiagPayload(reason: string, now: number): any {',
    'function _casualRecordPush(ms: number, ok: boolean): void {',
  ];
  const deltaAnchors = [
    'function _casualDeltaDiag(',
    'function _casualNoteDeltaFuse(',
  ];
  const parts = anchors.map((a) => softFn(pageSrc, a));
  assert.ok(parts.every(Boolean), '六支既有函式抽不齊：' + anchors.filter((a, i) => !parts[i]));
  let deltaParts = [];
  if (withDelta) {
    deltaParts = deltaAnchors.map((a) => softFn(pageSrc, a));
    assert.ok(deltaParts.every(Boolean), 'v6270 新函式抽不到（BASE 上必紅）：' + deltaAnchors.filter((a, i) => !deltaParts[i]));
  }
  const PRELUDE = `
    let isTournament = false, isTournSpectator = false;
    let mode = 'online', roomCode = 'AB12';
    let myPlayerIndex = 0, mySeatIdx = 0;
    let firebaseUser = { isAnonymous: false };
    let game = { phase: 'playing', turn: 7, log: new Array(120).fill(0) };
    let roomData = { idleTimeoutSec: 180 };
    let battleLayout = 'classic';
    const VERSION = '${VERSION}';
    const document = { visibilityState: 'visible' };
    const window = { innerWidth: 1280, innerHeight: 800 };
    const navigator = { userAgent: 'TESTUA', hardwareConcurrency: 8, deviceMemory: 8 };
    const __posted = [];
    function _tPostClientDiag(p) { __posted.push(p); }
    function _tSendClientDiag(reason) { _casualDiagSend(reason, Date.now()); }
    function oldestPushInFlightAgeMs() { return 0; }
    function deltaPutFuseTripped() { return ${fuse ? 'true' : 'false'}; }
    function deltaPutDiag() { return ${JSON.stringify(diag)}; }
    let _casualPushSamples = [], _casualPushFail = 0, _casualDiagSent = 0;
    let _casualSlowSent = false, _casualClaimSent = false;
    let _casualSampleRoom = '', _casualSampleArmed = false, _casualSampleSent = false;
    let _casualClaimGranted = null, _casualPhantomSent = false, _casualPhantom = null;
    let _casualDeltaFuseSent = false;
    let _startGameWon = null, _startGameReadyMs = null;
    ${constLines}
  `;
  const EXPORTS = `
    return { _casualDiagSend, _casualDiagPayload, _casualRecordPush,
      posted: () => __posted.slice(), clearPosted: () => { __posted.length = 0; },
      setUser: (u) => { firebaseUser = u; } };
  `;
  const ts = PRELUDE + parts.join('\n') + '\n' + deltaParts.join('\n') + '\n' + EXPORTS;
  const js = ts2js(ts);
  return new Function(js)();
}
await T('F2 ⭐ payload 接線（實跑）：push.bodyBytes 有 patch/full；delta 只在 casual-delta-fuse 有值', async () => {
  const diag = { fused: true, rejects: 3, lastReason: 'hash', bytes: { patch: { n: 5, p50: 1500, p95: 2000, max: 2100 }, full: { n: 2, p50: 40000, p95: 41000, max: 41000 } } };
  const h = await mkCasualHarness(GP, { fuse: true, diag });
  h._casualDiagSend('casual-slow-push', Date.now());
  const p1 = h.posted()[0];
  assert.ok(p1, '沒送出');
  assert.ok(p1.push && p1.push.bodyBytes, 'push.bodyBytes 缺席：' + JSON.stringify(p1.push));
  assert.equal(p1.push.bodyBytes.patch.p50, 1500);
  assert.equal(p1.push.bodyBytes.full.p50, 40000);
  assert.equal(p1.delta, null, '非 fuse 指紋 delta 應為 null');
  h.clearPosted();
  h._casualDiagSend('casual-delta-fuse', Date.now());
  const p2 = h.posted()[0];
  assert.ok(p2 && p2.delta && p2.delta.lastReason === 'hash', 'casual-delta-fuse 沒帶 delta 統計：' + JSON.stringify(p2 && p2.delta));
  assert.equal(p2.mode, 'casual');
  const bytes = Buffer.byteLength(JSON.stringify(p2), 'utf8');
  assert.ok(bytes < 1200, '單發 payload ' + bytes + ' bytes 超標');
});
await T('F3 ⭐ 熔斷指紋接線（實跑 _casualRecordPush）：熔斷 ⇒ 恰好送 1 發 casual-delta-fuse；不熔斷 ⇒ 0 發', async () => {
  const h = await mkCasualHarness(GP, { fuse: true, diag: { fused: true, rejects: 3, lastReason: 'hash', bytes: null } });
  for (let i = 0; i < 5; i++) h._casualRecordPush(100, true);
  const fuses = h.posted().filter((p) => p.reason === 'casual-delta-fuse');
  assert.equal(fuses.length, 1, '熔斷指紋送了 ' + fuses.length + ' 發（應恰好 1）');
  const h2 = await mkCasualHarness(GP, { fuse: false, diag: null });
  for (let i = 0; i < 5; i++) h2._casualRecordPush(100, true);
  assert.equal(h2.posted().filter((p) => p.reason === 'casual-delta-fuse').length, 0, '沒熔斷也送 ⇒ 恆真式');
});
await T('F4 (e) ⭐⭐ 一般玩家 0 發：匿名／未登入即使熔斷也一發不送（正對照：登入者送得出）', async () => {
  for (const user of [{ isAnonymous: true }, null]) {
    const h = await mkCasualHarness(GP, { fuse: true, diag: { fused: true, rejects: 3, lastReason: 'hash', bytes: null } });
    h.setUser(user);
    for (let i = 0; i < 5; i++) h._casualRecordPush(100, true);
    assert.equal(h.posted().length, 0, JSON.stringify(user) + ' 竟然送出 ' + h.posted().length + ' 發');
  }
  const h3 = await mkCasualHarness(GP, { fuse: true, diag: { fused: true, rejects: 3, lastReason: 'hash', bytes: null } });
  for (let i = 0; i < 5; i++) h3._casualRecordPush(100, true);
  assert.equal(h3.posted().length, 1, '正對照失敗：登入者反而送不出（上面那條是恆真式）');
});
await T('F5 CASUAL_DIAG_REASONS 單行含 casual-delta-fuse；dump 的 isCasualReason 實跑認得它', () => {
  const m = /^\s*const CASUAL_DIAG_REASONS = \[[^\n]*\];/m.exec(GP);
  assert.ok(m, 'CASUAL_DIAG_REASONS 不是單行（v6.261 守衛的抽取器會抽到半截）');
  assert.ok(m[0].includes("'casual-delta-fuse'"), '清單沒有 casual-delta-fuse');
  const DUMP = require_(DUMP_PATH);
  assert.equal(DUMP.isCasualReason('casual-delta-fuse'), true, 'dump 分帳不認得 ⇒ 會被錯算進錦標賽批');
});

console.log('\n══ 【H】dump 補 phantom 欄位（實跑） ═══════════════════════════');
function dumpFixtureRows() {
  const mk = (reason, obj) => ({ ts: 1756500000000, uid: 'u' + reason, email: 'x@y.z', room: 'AB12', reason,
    diag: JSON.stringify({ reason, mode: 'casual', room: 'AB12', ver: '6.270',
      push: { n: 12, p50: 900, p95: 4000, max: 9000, fail: 1, inflight: 0, bodyBytes: { patch: { n: 5, p50: 1500, p95: 2000, max: 2100 }, full: null } },
      board: { phase: 'setup', turn: 1, logLen: 3, seat: 0, spectator: false },
      claim: null, ...obj, env: { ua: 'TESTUA' } }) });
  return [
    mk('casual-phantom-adopt', { phantom: { won: true, readyMs: 7100, localSrv: 111, incomingSrv: 222 } }),
    mk('casual-slow-push', { phantom: null }),
    mk('casual-delta-fuse', { delta: { fused: true, rejects: 3, lastReason: 'hash', bytes: null } }),
  ];
}
await T('H1 ⭐ casualSummary 的 list 帶出 phantom{won,readyMs,localSrv,incomingSrv}', () => {
  const DUMP = require_(DUMP_PATH);
  const out = DUMP.casualSummary(dumpFixtureRows());
  const row = out.list.find((r) => r.reason === 'casual-phantom-adopt');
  assert.ok(row, '找不到 phantom 列');
  assert.ok(row.phantom, 'phantom 欄位仍被丟掉（BASE 上必紅）');
  assert.equal(row.phantom.won, true);
  assert.equal(row.phantom.readyMs, 7100);
  assert.equal(row.phantom.localSrv, 111);
  assert.equal(row.phantom.incomingSrv, 222);
});
await T('H2 既有欄位一個不少、數字不變（只補欄位，不動統計）', () => {
  const DUMP = require_(DUMP_PATH);
  const out = DUMP.casualSummary(dumpFixtureRows());
  assert.equal(out.rows, 3);
  assert.equal(out.players, 3);
  assert.equal(out.push.rowsWithPush, 3);
  assert.equal(out.push.p50.length, 3);
  const row = out.list[0];
  for (const k of ['ts', 'tsLocal', 'email', 'uid', 'room', 'reason', 'label', 'ver', 'push', 'board', 'claim', 'ua', 'hc', 'dm', 'truncated']) {
    assert.ok(k in row, '既有欄位 ' + k + ' 不見了');
  }
  // bodyBytes 走 push 整包帶出（dump 端零改動的接線證明）
  assert.equal(out.list[0].push.bodyBytes.patch.p50, 1500, 'bodyBytes 沒隨 push 整包帶出');
});

console.log('\n══ 【G】perf：client 端新增 CPU（48KB 代表性房 doc） ═══════════');
await T('G1 快照＋diff＋hash＋patch 序列化的 p99（沙盒上限 40ms / p50 15ms）', () => {
  const doc = makeDoc(450);
  doc.gameState.players = [{ hand: ['a'], board: 'y'.repeat(11000) }, { hand: ['b'], board: 'z'.repeat(11000) }];
  const prev = clientViewOf(doc);
  const bytes = JSON.stringify(prev).length;
  assert.ok(bytes > 40000, '代表性 doc 應大於 40KB，實得 ' + bytes);
  const times = [];
  for (let i = 0; i < 300; i++) {
    const t0 = process.hrtime.bigint();
    const base = JSON.parse(JSON.stringify(prev));           // deltaPutBase
    const data = { ...prev, gameState: { ...prev.gameState, turn: i, log: prev.gameState.log.concat([{ t: 9999, msg: '新事件' + i }]) } };
    const fullStr = JSON.stringify(data);
    const next = JSON.parse(fullStr);
    const patch = MC.buildRoomPatch(base, next);
    const body = { patchProto: 1, patch, fullHash: MC.deltaPutCanonHash(next), expectedVersion: 7 };
    JSON.stringify(body);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    assert.ok(patch, 'perf 迭代 ' + i + ' diff 失敗');
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)], p99 = times[Math.floor(times.length * 0.99)];
  console.log('     doc=' + (bytes / 1024).toFixed(1) + 'KB  p50=' + p50.toFixed(2) + 'ms  p99=' + p99.toFixed(2) + 'ms  max=' + times[times.length - 1].toFixed(2) + 'ms（沙盒）');
  assert.ok(p99 < 40, 'p99=' + p99.toFixed(2) + 'ms 超過 40ms（沙盒上限）—— 檢查有沒有量級退化');
  assert.ok(p50 < 15, 'p50=' + p50.toFixed(2) + 'ms 超過 15ms');
});

console.log('\n══ 【I】突變測試（每條必須紅在預期的那條斷言） ═════════════════');
async function expectRed(name, fn) {
  await T(name, async () => {
    let redAt = null;
    try { await fn(); } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      redAt = String(e.message);
    }
    assert.ok(redAt !== null, '突變體竟然全綠 —— 守衛是安慰劑');
    console.log('     └ 紅在：' + redAt.slice(0, 100));
  });
}
await expectRed('M1 拿掉 60% 門檻 ⇒ E1（開局送 patch）翻紅', async () => {
  const mut = OC.replace('if (patchStr.length > fullBodyLen * DELTA_PUT_FULL_RATIO) { body = null; patchStr = null; }', ';');
  assert.notEqual(mut, OC, '突變沒生效');
  SRV_DB.docs = { ROOM: { ...makeDoc(0), status: 'lobby', gameState: null } };
  const { api, ROM } = makeWorld(mut, RO);
  await ROM.startGame('room', { ...makeDoc(40).gameState, id: 'newgame' });
  const puts = api.log.filter((c) => c.method === 'PUT');
  assert.ok(!('patchProto' in puts[0].body), '整包重寫竟然送了 patch（60% 門檻沒作用）');
});
await expectRed('M2 拿掉熔斷累進 ⇒ D4 翻紅', async () => {
  const mut = OC.replace('_dpRejectStreak++;', ';');
  assert.notEqual(mut, OC);
  SRV_DB.docs = { ROOM: makeDoc() };
  const api = makeOracleApiOverRealServer();
  const bad = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1) o = { ...o, body: { ...o.body, fullHash: 'deadbeef-1234' } };
    return api(p, o);
  };
  const Mm = loadClientCore(mut, { oracleApi: bad,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  Mm._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  for (let i = 0; i < 3; i++) {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 100 + i;
    await Mm.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, Mm.deltaPutBase(prev));
  }
  assert.ok(Mm.deltaPutFuseTripped(), '3 次拒收後應熔斷');
});
await expectRed('M3 無視哨兵（deltaPutBase 恆給基底）⇒ B1(a) 翻紅', async () => {
  const mut = OC.replace('if (!_dpSentinel || _dpFused) return null;', 'if (_dpFused) return null;');
  assert.notEqual(mut, OC);
  const now = await collectTxRequests(RO, mut, false);
  // sentinelOn=false 時我們不注入 delta 識別字 ⇒ 這條突變要用「有注入但哨兵未亮」驗
  const reqs = await (async () => {
    const txBlock = extractBlock(RO, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
    const js = ts2js(txBlock);
    const out = [];
    const doc = clientViewOf(makeDoc());
    const M9 = loadClientCore(mut, { oracleApi: async (p, o) => { out.push({ kind: 'api', body: o.body }); return { ok: true, version: 9, room: {} }; },
      oracleUpsertRoom: async (code, data, ev) => { out.push({ kind: 'full' }); return { ok: true, version: ev + 1, room: data }; } });
    // ⚠ 從未看過哨兵（模擬舊伺服器）
    const mk = new Function('oracleGetRoom', 'oracleUpsertRoom', 'isOracleTimeout', 'isOracleUploadBudgetTimeout', 'setTimeout', 'deltaPutBase', 'oracleUpsertRoomDelta', js + '\n;return oracleTx;');
    const tx = mk(async () => JSON.parse(JSON.stringify(doc)),
      async (code, data, ev) => { out.push({ kind: 'full' }); return { ok: true, version: ev + 1, room: data }; },
      () => false, () => false, (fn) => fn(), M9.deltaPutBase, M9.oracleUpsertRoomDelta);
    await tx('ROOM', (d) => ({ ...d, gameState: { ...d.gameState, turn: 4 } }));
    return out;
  })();
  assert.ok(reqs.every((r) => r.kind === 'full'), '哨兵缺席竟然送出了 patch：' + JSON.stringify(reqs.map((r) => r.kind)));
  void now;
});
await expectRed('M4 hash 演算法差一個常數 ⇒ C（round-trip）翻紅', async () => {
  const mut = OC.replace("h1 = Math.imul(h1 ^ c, 16777619) >>> 0;\n      h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;\n    }\n  };\n  const ser", "h1 = Math.imul(h1 ^ c, 16777618) >>> 0;\n      h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;\n    }\n  };\n  const ser");
  assert.notEqual(mut, OC, '突變沒生效（錨點沒對上）');
  const Mm = loadClientCore(mut);
  const doc = makeDoc();
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 4;
  const patch = Mm.buildRoomPatch(prev, next);
  SRV_DB.docs = { ROOM: doc };
  const body = { patchProto: 1, patch, fullHash: Mm.deltaPutCanonHash(next), expectedVersion: 7 };
  const req = { method: 'PUT', originalUrl: '/api/rooms/ROOM', url: '/api/rooms/ROOM', body };
  const res = fakeRes();
  let nexted = false;
  await SERVER_MW(req, res, () => { nexted = true; });
  assert.ok(nexted, 'hash 不符被伺服器擋下（422 ' + JSON.stringify(res.body) + '）');
});
await expectRed('M5 diff 漏掉 del ⇒ C1（top-level 刪欄）翻紅', async () => {
  const mut = OC.replace('if (!(k in next)) { if (k in base) del.push(k); continue; }', 'if (!(k in next)) { continue; }');
  assert.notEqual(mut, OC);
  const Mm = loadClientCore(mut);
  const doc = makeDoc();
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev)); delete next.heartbeats; next.gameState.turn = 4;
  const patch = Mm.buildRoomPatch(prev, next);
  assert.ok(patch && patch.del.includes('heartbeats'), 'top-level 刪欄應進 del');
});
await expectRed('M6 logAppend 不驗前綴 ⇒ C2（悔棋重寫）翻紅', async () => {
  const mut = OC.replace('for (let i = 0; i < bl.length; i++) { if (!_dpEq(bl[i], nl[i])) { prefix = false; break; } }', ';');
  assert.notEqual(mut, OC);
  const Mm = loadClientCore(mut);
  const doc = makeDoc();
  const prev = clientViewOf(doc);
  // 等長但內容不同的 log（悔棋型）→ 突變體會誤判 prefix 相同 → 不送 set → 重建錯
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.log = next.gameState.log.slice();
  next.gameState.log[0] = { t: 0, msg: '被改寫的第 0 手' };
  const patch = Mm.buildRoomPatch(prev, next);
  assert.ok(patch && patch.set['gameState.log'], '等長但內容不同的 log 應走 set 整欄重寫');
});
await expectRed('M7 _casualRecordPush 不再呼叫 _casualNoteDeltaFuse ⇒ F3 翻紅', async () => {
  const mut = GP.replace("if (typeof _casualNoteDeltaFuse === 'function') _casualNoteDeltaFuse();", ';');
  assert.notEqual(mut, GP);
  const h = await mkCasualHarness(mut, { fuse: true, diag: { fused: true, rejects: 3, lastReason: 'hash', bytes: null } });
  for (let i = 0; i < 5; i++) h._casualRecordPush(100, true);
  assert.equal(h.posted().filter((p) => p.reason === 'casual-delta-fuse').length, 1, '熔斷指紋沒送出');
});
await expectRed('M8 bodyBytes 不分 patch/full（全記 full）⇒ F1 翻紅', async () => {
  const mut = OC.replace("_dpNoteBytes('patch', _dpUtf8Len(patchStr));", "_dpNoteBytes('full', _dpUtf8Len(patchStr));");
  assert.notEqual(mut, OC);
  SRV_DB.docs = { ROOM: makeDoc() };
  const api = makeOracleApiOverRealServer();
  const Mm = loadClientCore(mut, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  Mm._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 4;
  await Mm.oracleUpsertRoomDelta('room', next, 7, Mm.deltaPutBase(prev));
  const dg = Mm.deltaPutDiag();
  assert.ok(dg.bytes && dg.bytes.patch && dg.bytes.patch.n === 1, 'patch 統計不見了（被記成 full）：' + JSON.stringify(dg.bytes));
});

console.log('\n══ 【J】HEAD-FAIL（對 BASE v6.269 blob，各項各自紅） ═══════════');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bOC = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/oracle-client.ts');
  const bRO = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room-oracle.ts');
  const bGP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  const bDU = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/tournament/dump-client-monitor.cjs');
  await expectRed('J1 BASE oracle-client 無 v6270 區塊 ⇒ A1 紅', () => {
    extractBlock(bOC.out, CB_S, CB_E, 4000, 'v6270 client 區塊');
  });
  await expectRed('J2 BASE room-oracle 的 oracleTx 沒接 delta ⇒ A3 紅', () => {
    const tx = extractBlock(bRO.out, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
    assert.ok(/deltaPutBase/.test(tx) && /oracleUpsertRoomDelta/.test(tx), 'oracleTx 沒接 delta');
  });
  await expectRed('J3 BASE +page 無 casual-delta-fuse ⇒ F5 紅', () => {
    const m = /^\s*const CASUAL_DIAG_REASONS = \[[^\n]*\];/m.exec(bGP.out);
    assert.ok(m && m[0].includes("'casual-delta-fuse'"), '清單沒有 casual-delta-fuse');
  });
  await expectRed('J4 BASE +page 的 payload 無 bodyBytes ⇒ F2 紅', async () => {
    const h = await mkCasualHarness(bGP.out, { withDelta: false, fuse: false, diag: null });
    h._casualDiagSend('casual-slow-push', Date.now());
    const p1 = h.posted()[0];
    assert.ok(p1 && p1.push && p1.push.bodyBytes !== undefined, 'push.bodyBytes 缺席');
  });
  await expectRed('J5 BASE dump 丟掉 phantom ⇒ H1 紅', () => {
    // 用 BASE 的 casualSummary 原始碼實跑（require 會吃到磁碟上的新版，所以這裡用 blob 建模組）
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', bDU.out.replace(/^#![^\n]*\n/, ''))(mod, mod.exports, require_);   // CJS 有 shebang，剝掉
    const out = mod.exports.casualSummary(dumpFixtureRows());
    const row = out.list.find((r) => r.reason === 'casual-phantom-adopt');
    assert.ok(row && row.phantom, 'phantom 欄位仍被丟掉（BASE 上必紅）');
  });
} else {
  shallowSkip('v6270-J HEAD-FAIL 全節', '需要 BASE blob；出貨判準（A/C/D/E/F/H）全部 history-free，仍在守');
}

console.log('\n══ 【K】自查 ═══════════════════════════════════════════════════');
await T('K1 守衛在 package.json 的 test chain 裡', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.includes('test-v6270-delta-put-client.mjs'), '沒進 test chain（CI 的 iron-rules-audit 是 continue-on-error，不進 chain 等於沒守）');
});

console.log(`\n═══ 結果：PASS ${pass} / FAIL ${fail} ═══`);
if (fail > 0) process.exit(1);
