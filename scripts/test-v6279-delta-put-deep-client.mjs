// 守衛：v6.279 休閒 PUT 上行增量【client 端 3b：深層 diff】
//
// 這一版做了什麼：v6.278 把伺服器端的門打開（最多 8 段路徑＋陣列索引），本版讓 client 真的
//   送得出深路徑（gameState.players.0.hand …），並加上①自我調節的 CPU 保險②三分類診斷。
//
// 條目總覽：
//   【A】接線（行為端：真 room-oracle → 真 middleware，PUT 裡真的出現 3 段以上的路徑）
//   【B】⭐⭐ **兩端規則一致**：把伺服器區塊抽出來實跑 —— 常數逐值比對＋判定函式對拍
//        ＋ client 產出的每一條路徑都用伺服器的規則獨立複驗（前綴不相交／段數／長度／索引）
//   【C】⭐⭐⭐ round-trip fuzz **20,000 次**：client 深層 diff → 真 middleware apply
//        → canonical hash 與 client 的 newData **逐位元相同**、**零 422**
//   【D】⭐⭐ deep=false 的輸出與 **BASE(v6.278) 的 buildRoomPatch 逐位元相同**
//        （＝正對照 (a)/(c) 的根據：退回兩層時行為與 v6.270 一模一樣）
//   【E】正對照 (a)~(f)
//   【F】⭐ CPU 保險的行為端（快裝置不觸發／連續超標才觸發／不抖動／退的是兩層不是全量）
//   【G】診斷：三分類 bodyBytes＋diffMs；一般玩家 0 發／0 bytes（行為端實跑）
//   【H】perf：diff 的 p50/p99（Rule 32 —— 這一節就是量測腳本）
//   【I】突變 8 條，每條必須紅在**預期**的那條斷言（只捕捉 AssertionError）
//   【J】HEAD-FAIL：對 BASE(v6.278) blob 跑，各項各自紅
//   【K】自查：在 package.json test chain 裡／沒有 pin 死版本號
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '095ea93f4b85214ccd099d165b14ab608bcc568b';   // v6.278（本版的上一版）
const require_ = createRequire(import.meta.url);
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;

// ⚠ Windows checkout 可能是 CRLF；blob／CI 是 LF ⇒ 一律正規化，否則錨點在不同平台假紅。
const R = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const OC = R(path.join(ROOT, 'src/lib/game/oracle-client.ts'));
const RO = R(path.join(ROOT, 'src/lib/game/room-oracle.ts'));
const GP = R(path.join(ROOT, 'src/routes/game/+page.svelte'));
const SRV = R(path.join(ROOT, 'oracle-admin/server_admin_patch.js'));
const VERSION = /VERSION = '([\d.]+)'/.exec(R(path.join(ROOT, 'src/lib/version.ts')))[1];

let pass = 0, fail = 0;
async function T(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // 只捕捉 AssertionError（守衛安慰劑鐵律）
    fail++; console.log('  ✗ ' + name + '\n    ' + String(e.message).slice(0, 500));
  }
}

// ── 抽取器 ──────────────────────────────────────────────────────────────────
function extractBlock(src, sentS, sentE, minLen, label) {
  const i = src.indexOf(sentS);
  assert.ok(i >= 0, '抽不到 ' + label + ' 起點（' + sentS.slice(0, 48) + '）');
  const j = src.indexOf(sentE, i + sentS.length);
  assert.ok(j > i, '抽不到 ' + label + ' 終點');
  const out = src.slice(i, j + sentE.length);
  assert.ok(out.length >= minLen, label + ' 只抽到 ' + out.length + ' 字元（下限 ' + minLen + '）');
  return out;
}
const CB_S = '// >>> v6270-delta-put-client-core';
const CB_E = '// <<< v6270-delta-put-client-core';
const DEEP_S = '// >>> v6279-delta-put-deep-core';
const DEEP_E = '// <<< v6279-delta-put-deep-core';

/** client 出貨區塊實跑器（與 test-v6270 同款；再多回傳 v6.279 的新出口）。 */
function loadClientCore(srcOC, hooks = {}) {
  const block = extractBlock(srcOC, CB_S, CB_E, 4000, 'delta-put client 區塊');
  const js = ts2js(block.replace(/^export /gm, ''));
  const calls = [];
  const oracleUpsertRoom = hooks.oracleUpsertRoom ?? (async (code, data, ev) => {
    calls.push({ kind: 'full', code, body: JSON.parse(JSON.stringify({ data, expectedVersion: ev })) });
    return { ok: true, version: (ev ?? 0) + 1, room: { ...JSON.parse(JSON.stringify(data)), _version: (ev ?? 0) + 1, updatedAt: 999 } };
  });
  const oracleApi = hooks.oracleApi ?? (async () => { throw new Error('oracleApi 不該被呼叫'); });
  const oracleErrorStatus = (e) => (e && typeof e.status === 'number') ? e.status : null;
  const _noteRoomServerTime = () => {};
  const performance_ = hooks.performance ?? (typeof performance !== 'undefined' ? performance : undefined);
  const fn = new Function('oracleUpsertRoom', 'oracleApi', 'oracleErrorStatus', '_noteRoomServerTime', 'performance',
    '"use strict";' + js + `;const __out = { deltaPutBase, buildRoomPatch, deltaPutCanonHash, oracleUpsertRoomDelta,
      deltaPutDiag, deltaPutFuseTripped, _noteDeltaPutSentinel, _dpUtf8Len,
      DELTA_PUT_FULL_RATIO, DELTA_PUT_MAX_SET, DELTA_PUT_MAX_LOGAPPEND, DELTA_PUT_FUSE_LIMIT }
      // ⚠ v6.279 才有的出口：對 BASE(v6.278) blob 實跑時必須缺席（HEAD-FAIL 靠這個）
      ; for (const k of ['deltaPutDeepArmed','deltaPutBadSeg','deltaPutArrIdx','DELTA_PUT_MAX_PATH_SEGS',
          'DELTA_PUT_MAX_PATH_LEN','DELTA_PUT_MAX_SEG_LEN','DELTA_PUT_ARR_IDX_DIGITS',
          'DELTA_PUT_DEEP_SLOW_MS','DELTA_PUT_DEEP_SLOW_STREAK','DELTA_PUT_DEEP_MAX_TRIPS']) {
        try { __out[k] = eval(k); } catch (_e) { /* BASE 沒有 ⇒ undefined */ }
      }
      return __out;`);
  const m = fn((...a) => oracleUpsertRoom(...a), (...a) => oracleApi(...a), oracleErrorStatus, _noteRoomServerTime, performance_);
  m.calls = calls;
  return m;
}

// ── v6.278 真 middleware 實跑器 ──────────────────────────────────────────────
const DPBLOCK = extractBlock(SRV, '// >>> PTCG-DELTA-PUT-BLOCK-START', '// <<< PTCG-DELTA-PUT-BLOCK-END', 3000, '伺服器 delta-put 區塊');
const SRV_DB = { docs: {} };
async function makeServerMw(block = DPBLOCK) {
  const stack = [{ handle: function q() {} }, { route: { path: '/api/rooms/:code' } }];
  const app = { use(f) { stack.push({ handle: f }); } };
  app._router = { stack };
  const before = new Set(stack.map((l) => l.handle));
  const db = { collection: () => ({ findOne: async (qq) => {
    const d = SRV_DB.docs[qq && qq._id];
    return d === undefined ? null : structuredClone(d);
  } }) };
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + block + '\n})();')(app, db, { log() {}, warn() {} });
  const news = stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle);
  assert.equal(news.length, 1, '伺服器區塊應恰好掛 1 支 mw');
  return news[0];
}
const SERVER_MW = await makeServerMw();

// ── 伺服器端的**純判定**（規則一致性對拍用）──────────────────────────────────
const PURE_S = '      const _DP_MAX_SET = 256, _DP_MAX_DEL = 256';
const PURE_E = '        return base;\n      };\n';
function extractPure(block) {
  const i = block.indexOf(PURE_S); assert.ok(i >= 0, '抽不到伺服器純函式段起點');
  const j = block.indexOf(PURE_E, i); assert.ok(j > i, '抽不到伺服器純函式段終點');
  return block.slice(i, j + PURE_E.length);
}
const SRVP = new Function('"use strict";' + extractPure(DPBLOCK)
  + ';return { _dpApplyPatch, _dpCanonHash, _dpBadSeg, _dpArrIdx,'
  + ' _DP_MAX_PATH_SEGS, _DP_MAX_PATH_LEN, _DP_MAX_SET, _DP_MAX_DEL, _DP_MAX_LOGAPPEND };')();

function fakeRes() {
  return { statusCode: 200, body: undefined, jsonCalled: false, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.jsonCalled = true; this.headersSent = true; return this; } };
}
/** 完整假伺服器：middleware → 核心 PUT（$set＋email 回填＋_version bump）。 */
function makeOracleApiOverRealServer() {
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
      if (res.statusCode === 409) return res.body;
      const e = new Error(`oracleApi ${pathArg} → ${res.statusCode}: ${JSON.stringify(res.body)}`);
      e.status = res.statusCode; throw e;
    }
    if (method === 'GET') {
      const doc = SRV_DB.docs[code];
      if (!doc) { const e = new Error('404'); e.status = 404; throw e; }
      res.json({ room: JSON.parse(JSON.stringify({ ...doc, seats: (doc.seats || []).map((s) => (s && s.email != null) ? { ...s, email: null } : s) })) });
      return res.body;
    }
    if (method === 'PUT') {
      const doc = SRV_DB.docs[code];
      const data = req.body && req.body.data, ev = req.body && req.body.expectedVersion;
      if (!data || typeof data !== 'object') { const e = new Error('400 missing data'); e.status = 400; throw e; }
      if (!doc) { const e = new Error('404'); e.status = 404; throw e; }
      if (ev !== undefined && ev !== doc._version) return { conflict: true, currentVersion: doc._version, room: null };
      const d = JSON.parse(JSON.stringify(data));
      if (Array.isArray(d.seats) && Array.isArray(doc.seats)) {
        for (let i = 0; i < d.seats.length; i++) {
          const s = d.seats[i], o = doc.seats[i];
          if (s && typeof s === 'object' && s.uid && s.email == null && o && o.uid === s.uid && o.email != null) s.email = o.email;
        }
      }
      const out = { ...doc };
      for (const k of Object.keys(d)) out[k] = d[k];
      out._version = doc._version + 1; out.updatedAt = doc.updatedAt + 1;
      SRV_DB.docs[code] = out;
      return { ok: true, version: out._version, room: JSON.parse(JSON.stringify({ ...out, seats: (out.seats || []).map((s) => (s && s.email != null) ? { ...s, email: null } : s) })) };
    }
    throw new Error('未支援的 method ' + method);
  };
  api.log = log;
  return api;
}

// ── 參照 canonical（獨立實作）──
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
const clientViewOf = (doc) => JSON.parse(JSON.stringify({ ...doc, seats: (doc.seats || []).map((s) => (s && s.email != null) ? { ...s, email: null } : s) }));

// ── ⭐ 真形狀 fixture：GameState.players 是**長度 2 的陣列**（src/lib/game/types.ts）──
function mkCard(i, extra = {}) {
  return { iid: 'i' + i, cardId: 'sv' + (1000 + i), name: '寶可夢' + i, damage: 0,
    attachedEnergy: [], tools: [], status: null, evolvedFrom: null, ...extra };
}
function makeGameDoc(logN = 80, deckN = 30) {
  const log = [];
  for (let i = 0; i < logN; i++) log.push({ t: i, msg: '第 ' + i + ' 手：「沸騰鬥志」造成 120 點傷害' });
  const mkPlayer = (tag, benchN) => ({
    name: tag, prizes: 6, deck: Array.from({ length: deckN }, (_, i) => mkCard(tag + 'd' + i)),
    hand: Array.from({ length: 7 }, (_, i) => mkCard(tag + 'h' + i)),
    discard: [], lostZone: [], active: mkCard(tag + 'a', { damage: 30 }),
    bench: Array.from({ length: benchN }, (_, i) => mkCard(tag + 'b' + i)),
    flags: { energyAttachedThisTurn: false, supporterUsed: false, retreatUsed: false },
    stadium: null,
  });
  return {
    _id: 'ROOM', _version: 7, createdAt: 100, updatedAt: 111, status: 'playing',
    name: '練習房', hostUid: 'u1', memberUids: ['u1', 'u2'], idleTimeoutSec: 180,
    heartbeats: { u1: 11, u2: 22 },
    seats: [
      { role: 'p1', uid: 'u1', email: 'a@b.c', name: '甲', deckEntries: null, deckId: 'd1', ready: true, firstChoicePreference: 'random' },
      { role: 'p2', uid: 'u2', email: null, name: '乙', deckEntries: null, deckId: 'd2', ready: true, firstChoicePreference: 'random' },
    ],
    gameState: {
      id: 'g1', log, turn: 3, phase: 'playing', activePlayerIndex: 0, firstPlayerIdx: 0,
      setupDone: [true, true], mulliganCounts: [0, 1], pendingSelection: null, stadium: null,
      players: [mkPlayer('A', 3), mkPlayer('B', 2)],
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 【A】接線（行為端）
// ══════════════════════════════════════════════════════════════════════════
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
  return new Function('module', 'exports', 'require', 'console', 'setTimeout', code + '\nreturn module.exports;')(
    mod, mod.exports, req, { warn() {}, error() {}, log() {} }, (fn) => fn());
}
function makeWorld(srcOC = OC, srcRO = RO) {
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(srcOC, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev, opts) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: ev === undefined ? { data } : { data, expectedVersion: ev }, timeoutMs: opts?.timeoutMs }) });
  const ocStub = {
    oracleAuth: async () => ({ uid: 'u1' }), oracleApi: api,
    oracleGetRoom: async (code) => {
      const res = await api(`/api/rooms/${code.toUpperCase()}`).catch((e) => { if (e && e.status === 404) return null; throw e; });
      if (res === null) return null;
      M._noteDeltaPutSentinel(res);
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
  return { api, M, ROM: loadRoomOracle(srcRO, ocStub) };
}

console.log('══ 【A】接線（行為端） ═════════════════════════════════════════');
await T('A1 v6279 深層區塊抽得出來、編得過，且新出口都在', () => {
  const b = extractBlock(OC, DEEP_S, DEEP_E, 3000, 'v6279 深層區塊');
  assert.ok(ts2js(b.replace(/^export /gm, '')).length > 800);
  const M = loadClientCore(OC);
  for (const k of ['deltaPutDeepArmed', 'deltaPutBadSeg', 'deltaPutArrIdx']) {
    assert.equal(typeof M[k], 'function', '缺少出口 ' + k);
  }
  assert.equal(M.DELTA_PUT_MAX_PATH_SEGS, 8);
});
await T('A2 ⭐⭐ 行為端：真 room-oracle 的 pushGameState 送出的 PUT 裡真的有 **3 段以上**的路徑', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc() };
  const { api, ROM } = makeWorld();
  const st = JSON.parse(JSON.stringify(clientViewOf(SRV_DB.docs.ROOM).gameState));
  st.turn = 4;
  st.players[0].active.damage = 90;                 // ← gameState.players.0.active.damage（5 段）
  st.players[1].hand = st.players[1].hand.slice(1); // ← 長度變了 ⇒ 整包 set（4 段）
  st.log = st.log.concat([{ t: 999, msg: '新事件' }]);
  await ROM.pushGameState('room', st);
  const puts = api.log.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1, 'PUT 次數 ' + puts.length);
  assert.equal(puts[0].body.patchProto, 1, '沒送 patch：' + JSON.stringify(Object.keys(puts[0].body)));
  const paths = Object.keys(puts[0].body.patch.set);
  const deep = paths.filter((p) => p.split('.').length >= 3);
  assert.ok(deep.length > 0, '一條深路徑都沒有 ⇒ 這一版等於沒做事：' + JSON.stringify(paths));
  assert.ok(paths.includes('gameState.players.0.active.damage'),
    '沒有鑽到 players.0.active.damage：' + JSON.stringify(paths));
  assert.ok(paths.includes('gameState.players.1.hand'),
    '長度變動的陣列應整包 set 在父物件上：' + JSON.stringify(paths));
  assert.ok(puts[0].body.patch.logAppend && puts[0].body.patch.logAppend.length === 1, 'log 應仍走 append');
  // 落庫必須完全正確
  assert.equal(SRV_DB.docs.ROOM.gameState.players[0].active.damage, 90);
  assert.equal(SRV_DB.docs.ROOM.gameState.players[1].hand.length, 6);
  assert.equal(SRV_DB.docs.ROOM.gameState.log.length, makeGameDoc().gameState.log.length + 1);
  assert.equal(SRV_DB.docs.ROOM.seats[0].email, 'a@b.c', 'email 被洗掉了');
  assert.equal(SRV_DB.docs.ROOM._version, 8);
});
await T('A3 ⚠ room-oracle.ts 的 oracleTx 與 BASE **逐位元相同**（本版零接觸）', () => {
  const AN_S = 'const TX_TIMEOUT_RETRY_MAX', AN_E = "\n  throw new Error('oracleTx: max retries exhausted');\n}";
  const tx = extractBlock(RO, AN_S, AN_E, 700, 'oracleTx');
  assert.ok(/deltaPutBase/.test(tx) && /oracleUpsertRoomDelta/.test(tx), 'oracleTx 沒接 delta');
  assert.ok(tx.indexOf('deltaPutBase') < tx.indexOf('await fn(data)'), '差分基底必須在 fn 之前快照');
  assert.equal((tx.match(/await /g) || []).length, 6,
    'oracleTx 的 await 次數變了（成功路徑不可多任何一次 await）：' + (tx.match(/await /g) || []).length);
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const b = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room-oracle.ts');
    assert.ok(b.ok, 'BASE blob 讀不到');
    assert.equal(tx, extractBlock(b.out, AN_S, AN_E, 700, 'BASE oracleTx'), 'oracleTx 與 BASE 不同（語義必須逐字不變）');
    assert.equal(createHash('sha256').update(RO, 'utf8').digest('hex'),
      createHash('sha256').update(b.out, 'utf8').digest('hex'), 'room-oracle.ts 整檔被動到了');
  } else {
    shallowSkip('v6279-A3 oracleTx 與 BASE blob 逐位元比對', '同一件事另有 history-free 判準：上面的 await 次數＋快照順序');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 【B】⭐⭐ 兩端規則一致
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【B】⭐⭐ 兩端規則一致（client 產的路徑，伺服器一定吃得下） ═══');
const MC = loadClientCore(OC);
await T('B1 常數逐值相同（client export vs 伺服器區塊實跑取值）', () => {
  assert.equal(MC.DELTA_PUT_MAX_PATH_SEGS, SRVP._DP_MAX_PATH_SEGS, '段數上限兩端不同');
  assert.equal(MC.DELTA_PUT_MAX_PATH_LEN, SRVP._DP_MAX_PATH_LEN, '路徑長度上限兩端不同');
  assert.equal(MC.DELTA_PUT_MAX_SET, SRVP._DP_MAX_SET, 'set 條數上限兩端不同');
  assert.equal(MC.DELTA_PUT_MAX_LOGAPPEND, SRVP._DP_MAX_LOGAPPEND, 'logAppend 上限兩端不同');
});
const SEG_CASES = ['', 'a', 'ab', '0', '1', '9', '01', '007', '-1', '+1', '1.5', '1e3', ' 1', '1 ',
  '000000000', '999999999', '1000000000', '12345678901', '0x1', 'NaN', 'Infinity', '__proto__',
  'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'players', 'hand',
  '中文鍵', 'a.b', 'a'.repeat(255), 'a'.repeat(256), 'a'.repeat(257), '​', '﻿0'];
await T('B2 ⭐⭐ 判定函式對拍：_dpArrIdx / _dpBadSeg 兩端對 ' + SEG_CASES.length + ' 個字串**逐一相同**', () => {
  let n = 0;
  for (const s of SEG_CASES) {
    assert.equal(MC.deltaPutArrIdx(s), SRVP._dpArrIdx(s), '索引判定不同：' + JSON.stringify(s));
    assert.equal(MC.deltaPutBadSeg(s), SRVP._dpBadSeg(s), '段名判定不同：' + JSON.stringify(s));
    n++;
  }
  assert.ok(n === SEG_CASES.length && n >= 30, '對拍樣本只有 ' + n + ' 個（掃描器自驗）');
  // 正對照：對拍真的抓得到差異（否則是恆真式）
  assert.notEqual(MC.deltaPutArrIdx('01'), MC.deltaPutArrIdx('1'), '規範性判定失效');
  assert.equal(MC.deltaPutArrIdx('01'), -1);
  assert.equal(MC.deltaPutBadSeg('__proto__'), true);
});
/** 用**伺服器的規則**獨立複驗 client 產出的每一條路徑（不是靠 middleware 回 200）。 */
function auditPaths(base, patch) {
  const all = Object.keys(patch.set).concat(patch.del);
  for (const p of all) {
    assert.ok(typeof p === 'string' && p.length <= SRVP._DP_MAX_PATH_LEN, '路徑過長：' + p.slice(0, 60));
    const segs = p.split('.');
    assert.ok(segs.length <= SRVP._DP_MAX_PATH_SEGS, '段數超限（' + segs.length + '）：' + p);
    for (const s of segs) assert.equal(SRVP._dpBadSeg(s), false, '非法段名：' + p);
    // 走一次伺服器的父節點規則
    let cur = base;
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      if (Array.isArray(cur)) {
        const idx = SRVP._dpArrIdx(s);
        assert.ok(idx >= 0 && idx < cur.length, '陣列索引越界／非規範：' + p);
        cur = cur[idx];
      } else {
        assert.ok(cur !== null && typeof cur === 'object', '中間節點不是物件：' + p);
        assert.ok(Object.prototype.hasOwnProperty.call(cur, s), '中間節點缺席（伺服器絕不自動建）：' + p);
        cur = cur[s];
      }
      assert.ok(cur !== null && typeof cur === 'object', '中間節點是 null／純量：' + p);
    }
    // ⚠⚠ 剛好 2 段時伺服器走的是 v1.29 舊分支：父節點是陣列一律 dp-set-into-nonobject
    if (segs.length === 2) {
      assert.ok(!Array.isArray(cur), '2 段路徑的父節點是陣列（伺服器舊分支一律拒）：' + p);
      assert.ok(cur === null || cur === undefined || (typeof cur === 'object' && !Array.isArray(cur)),
        '2 段路徑的父節點不是純物件：' + p);
    }
    if (segs.length >= 3 && Array.isArray(cur)) {
      const idx = SRVP._dpArrIdx(segs[segs.length - 1]);
      assert.ok(idx >= 0 && idx < cur.length, '寫入陣列的索引越界：' + p);
      assert.ok(!patch.del.includes(p), '⚠ 對陣列 del（伺服器一律拒）：' + p);
    }
  }
  // ⭐ 路徑集合互不為前綴（否則「先 del 後 set」的順序可能互相踩到）
  const sorted = all.slice().sort();
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(!sorted[i].startsWith(sorted[i - 1] + '.'),
      '路徑互為前綴：' + sorted[i - 1] + ' ⊂ ' + sorted[i]);
  }
  assert.equal(new Set(all).size, all.length, '有重複路徑');
}
await T('B3 ⭐ 代表性盤面：client 產出的每一條路徑都通過**伺服器規則**的獨立複驗', () => {
  const doc = makeGameDoc();
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.players[0].active.damage = 120;
  next.gameState.players[0].flags.supporterUsed = true;
  next.gameState.players[1].bench[0].tools = [{ iid: 't1' }];
  delete next.gameState.players[1].flags.retreatUsed;
  next.gameState.turn = 4;
  const patch = MC.buildRoomPatch(prev, next, true);
  assert.ok(patch, 'diff 回 null');
  auditPaths(prev, patch);
  assert.ok(Object.keys(patch.set).some((p) => p.split('.').length >= 5), '沒有 5 段路徑：' + JSON.stringify(Object.keys(patch.set)));
  assert.ok(patch.del.includes('gameState.players.1.flags.retreatUsed'), '深層刪欄沒進 del：' + JSON.stringify(patch.del));
});

// ══════════════════════════════════════════════════════════════════════════
// 【C】⭐⭐⭐ round-trip fuzz 20,000 次（真 middleware，零 422，逐位元相同）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【C】⭐⭐⭐ round-trip fuzz 20,000 次（真 v6.278 middleware） ═════');
async function serveDelta(doc, next, patch, ev = doc._version) {
  SRV_DB.docs = { ROOM: doc };
  const body = { patchProto: 1, patch, fullHash: MC.deltaPutCanonHash(next), expectedVersion: ev };
  const req = { method: 'PUT', originalUrl: '/api/rooms/ROOM', url: '/api/rooms/ROOM', body: JSON.parse(JSON.stringify(body)) };
  const res = fakeRes();
  let nexted = false;
  await SERVER_MW(req, res, () => { nexted = true; });
  return { req, res, nexted };
}
function expectAfterEmailKeep(doc, next) {
  const expect = JSON.parse(JSON.stringify(next));
  if (Array.isArray(expect.seats) && Array.isArray(doc.seats)) {
    for (let k = 0; k < expect.seats.length; k++) {
      const a = expect.seats[k], o = doc.seats[k];
      if (a && a.uid && a.email == null && o && o.uid === a.uid && o.email != null) a.email = o.email;
    }
  }
  return expect;
}
let FUZZ_STAT = null;
await T('C1 ⭐⭐⭐ fuzz 20,000 次：深層 diff → 真 middleware → canonical hash 逐位元相同、零 422', async () => {
  let s = 20260901;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rv = (d) => {
    const r = rnd();
    if (d > 2 || r < 0.3) return pick([1, 0, -3.5, 'x', '中文字串測試', true, false, null, 42.25, '']);
    if (r < 0.55) { const n = Math.floor(rnd() * 4); const a = []; for (let i = 0; i < n; i++) a.push(rv(d + 1)); return a; }
    const o = {}; const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) o['k' + Math.floor(rnd() * 6)] = rv(d + 1);
    return o;
  };
  const mkP = (tag) => ({ name: tag, prizes: 6,
    active: rnd() < 0.3 ? null : { iid: tag + 'a', damage: Math.floor(rnd() * 200), tools: [], status: null, flags: { asleep: false } },
    bench: Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ iid: tag + 'b' + i, damage: 0, tools: [] })),
    hand: Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => tag + 'h' + i),
    deck: Array.from({ length: Math.floor(rnd() * 12) }, (_, i) => ({ iid: tag + 'd' + i })),
    discard: [], flags: { e: false, s: rnd() < 0.5 } });
  let ran = 0, rejected = 0, deepPaths = 0, nullPatch = 0;
  const seen = { arrIdx: 0, deepDel: 0, activeNull: 0, lenChange: 0, playersSwap: 0 };
  for (let it = 0; it < 20000; it++) {
    const doc = { _id: 'ROOM', _version: 1 + Math.floor(rnd() * 5), status: 'playing',
      createdAt: 1, updatedAt: 5, heartbeats: { u1: 1, u2: 2 },
      seats: [{ role: 'p1', uid: 'u1', email: rnd() < 0.5 ? 'a@b.c' : null, name: '甲' },
              { role: 'p2', uid: 'u2', email: null, name: '乙' }],
      gameState: { id: 'g', turn: 1, phase: 'playing', pendingSelection: null,
        log: [{ t: 1, m: '開局' }, { t: 2, m: '中文' }],
        setupDone: [true, true], players: [mkP('A'), mkP('B')] } };
    if (rnd() < 0.3) doc.undoRequest = rv(0);
    const prev = clientViewOf(doc);
    const next = JSON.parse(JSON.stringify(prev));
    const nops = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < nops; i++) {
      const r = rnd(), pi = rnd() < 0.5 ? 0 : 1, P = next.gameState.players[pi];
      if (r < 0.10) { P.active = P.active === null ? { iid: 'new', damage: 0, tools: [], status: null, flags: { asleep: true } } : null; seen.activeNull++; }
      else if (r < 0.20) { if (P.active) { P.active.damage = Math.floor(rnd() * 300); seen.arrIdx++; } }
      else if (r < 0.28) { P.bench.push({ iid: 'nb' + i, damage: 0, tools: [] }); seen.lenChange++; }
      else if (r < 0.34) { if (P.bench.length) P.bench.pop(); seen.lenChange++; }
      else if (r < 0.42) { if (P.bench.length) { P.bench[Math.floor(rnd() * P.bench.length)].damage = Math.floor(rnd() * 100); seen.arrIdx++; } }
      else if (r < 0.50) { P.hand = P.hand.concat(['新卡' + i]); seen.lenChange++; }
      else if (r < 0.56) { if (P.deck.length) P.deck[0] = { iid: 'z' + i }; seen.arrIdx++; }
      else if (r < 0.62) { delete P.flags.s; seen.deepDel++; }
      else if (r < 0.66) { P.flags.newFlag = rv(0); }
      else if (r < 0.70) { next.gameState.players = [mkP('C'), mkP('D')]; seen.playersSwap++; }
      else if (r < 0.74) { next.gameState.players = [next.gameState.players[1], next.gameState.players[0]]; seen.playersSwap++; }
      else if (r < 0.80) { next.gameState.log = next.gameState.log.concat([{ t: 9, m: '第' + it + '筆中文紀錄' }]); }
      else if (r < 0.84) { next.gameState.log = [{ t: 1, m: '悔棋重寫' + it }]; }
      else if (r < 0.88) { next.gameState.turn = it; }
      else if (r < 0.91) { delete next.gameState.pendingSelection; seen.deepDel++; }
      else if (r < 0.94) { next.gameState.pendingSelection = rv(0); }
      else if (r < 0.96) { next.undoRequest = rv(0); }
      else if (r < 0.98) { delete next.undoRequest; }
      else { next.status = pick(['playing', 'ended', 'lobby']); }
    }
    // ⚠ undefined：JSON round-trip 會丟掉 —— 出貨路徑也是先 round-trip 再 diff
    if (rnd() < 0.05) next.gameState.willBeDropped = undefined;
    const nextJ = JSON.parse(JSON.stringify(next));
    const patch = MC.buildRoomPatch(prev, nextJ, true);
    if (!patch) { nullPatch++; continue; }
    auditPaths(prev, patch);
    if (Object.keys(patch.set).some((p) => p.split('.').length >= 3)) deepPaths++;
    const { req, res, nexted } = await serveDelta(doc, nextJ, patch, doc._version);
    if (!nexted) { rejected++; assert.fail('fuzz #' + it + ' 被拒（422/409）：' + JSON.stringify(res.body ?? null).slice(0, 200)); }
    assert.ok(sameJson(req.body.data, expectAfterEmailKeep(doc, nextJ)), 'fuzz #' + it + ' 重建不一致');
    ran++;
  }
  FUZZ_STAT = { ran, rejected, deepPaths, nullPatch, seen };
  assert.equal(rejected, 0, '有 ' + rejected + ' 次 422');
  assert.ok(ran >= 19000, '實際跑到的只有 ' + ran + ' 次（掃描器自驗）');
  assert.ok(deepPaths > ran * 0.5, '只有 ' + deepPaths + ' 次產生深路徑 ⇒ fuzz 沒真的測到深層');
  for (const k of Object.keys(seen)) assert.ok(seen[k] > 50, 'fuzz 沒涵蓋到 ' + k + '（只有 ' + seen[k] + ' 次）');
  console.log('     跑 ' + ran + ' 次｜零 422｜其中 ' + deepPaths + ' 次含深路徑｜diff 回 null ' + nullPatch + ' 次');
  console.log('     覆蓋：active null↔物件 ' + seen.activeNull + '｜陣列索引改值 ' + seen.arrIdx
    + '｜長度變動 ' + seen.lenChange + '｜整包換 players ' + seen.playersSwap + '｜深層刪欄 ' + seen.deepDel);
});
await T('C2 ⭐ 回捲：下鑽到一半才發現不可細分時，不可留下殘骸（log 重複 append 是真的會發生的）', () => {
  const doc = makeGameDoc(5);
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.log = next.gameState.log.concat([{ t: 99, msg: '新的一則' }]);   // 先進 logAppend
  next.gameState['a.b'] = 1;   // ⚠ 同一層出現含 '.' 的鍵 ⇒ gameState 這一層必須整包 set
  const patch = MC.buildRoomPatch(prev, next, true);
  assert.ok(patch, 'diff 回 null');
  assert.ok(patch.set['gameState'], 'gameState 應整包 set：' + JSON.stringify(Object.keys(patch.set)));
  assert.ok(!patch.logAppend, '⚠⚠ 整包 set 了還留著 logAppend ⇒ 伺服器會把 log append 第二次：' + JSON.stringify(patch.logAppend));
  assert.ok(!Object.keys(patch.set).some((p) => p.startsWith('gameState.')), '殘骸沒回捲：' + JSON.stringify(Object.keys(patch.set)));
});
await T('C3 ⭐ 深層 diff 對「整個 players 換掉」與「players 長度變了」都退成整包 set', () => {
  const doc = makeGameDoc(4, 3);
  const prev = clientViewOf(doc);
  const n1 = JSON.parse(JSON.stringify(prev));
  n1.gameState.players = [n1.gameState.players[0]];   // 長度 2 → 1
  const p1 = MC.buildRoomPatch(prev, n1, true);
  assert.ok(p1 && p1.set['gameState.players'], '長度變動應整包 set：' + JSON.stringify(Object.keys(p1.set)));
  const n2 = JSON.parse(JSON.stringify(prev));
  n2.gameState.players = 'not-an-array';
  const p2 = MC.buildRoomPatch(prev, n2, true);
  assert.ok(p2 && p2.set['gameState.players'] === 'not-an-array', '型別變了應整包 set');
});

// ══════════════════════════════════════════════════════════════════════════
// 【D】deep=false 與 BASE 的 buildRoomPatch 逐位元相同
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【D】⭐⭐ deep=false ＝ v6.270 兩層（與 BASE blob 逐位元對拍） ═══');
function fuzzPairs(n, seed) {
  let s = seed;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rv = (d) => { const r = rnd();
    if (d > 2 || r < 0.3) return pick([1, 0, 'x', '中文', true, null, 3.5]);
    if (r < 0.6) { const k = Math.floor(rnd() * 3); const a = []; for (let i = 0; i < k; i++) a.push(rv(d + 1)); return a; }
    const o = {}; const k = Math.floor(rnd() * 3); for (let i = 0; i < k; i++) o['k' + Math.floor(rnd() * 5)] = rv(d + 1); return o; };
  const out = [];
  const TOPS = ['status', 'undoRequest', 'winner', 'heartbeats'], SUBS = ['turn', 'phase', 'players', 'coin'];
  for (let i = 0; i < n; i++) {
    const b = { _id: 'R', _version: 1, status: 'playing', gameState: { log: [{ t: 1, m: 'a' }], turn: 1 },
      seats: [{ role: 'p1', uid: 'u1', email: null }] };
    for (const k of TOPS) if (rnd() < 0.5) b[k] = rv(0);
    for (const k of SUBS) if (rnd() < 0.5) b.gameState[k] = rv(0);
    const nx = JSON.parse(JSON.stringify(b));
    const ops = 1 + Math.floor(rnd() * 4);
    for (let j = 0; j < ops; j++) {
      const r = rnd();
      if (r < 0.25) nx[pick(TOPS)] = rv(0);
      else if (r < 0.4) delete nx[pick(TOPS)];
      else if (r < 0.65) nx.gameState[pick(SUBS)] = rv(0);
      else if (r < 0.75) delete nx.gameState[pick(SUBS)];
      else if (r < 0.9) nx.gameState.log = nx.gameState.log.concat([{ t: j, m: '中文' + i }]);
      else nx.gameState.log = [{ t: 1, m: '重寫' + i }];
    }
    out.push([b, nx]);
  }
  return out;
}
await T('D1 ⭐⭐ fuzz 6,000 次：buildRoomPatch(...,false) 與 BASE 的產出 JSON **逐位元相同**', () => {
  const pairs = fuzzPairs(6000, 424242);
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    // history-free 頂替：兩層產出的路徑段數必須全部 ≤ 2，且 round-trip 正確
    let deep = 0;
    for (const [b, n] of pairs) {
      const p = MC.buildRoomPatch(b, n, false);
      if (!p) continue;
      for (const k of Object.keys(p.set).concat(p.del)) if (k.split('.').length > 2) deep++;
    }
    assert.equal(deep, 0, 'deep=false 竟然產出 ' + deep + ' 條深路徑');
    shallowSkip('v6279-D1 與 BASE buildRoomPatch 逐位元對拍', 'history-free 判準：deep=false 產出的路徑段數全部 ≤ 2');
    return;
  }
  const b = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/oracle-client.ts');
  assert.ok(b.ok, 'BASE blob 讀不到');
  const MB = loadClientCore(b.out.replace(/\r\n/g, '\n'));
  let same = 0, n2 = 0;
  for (const [bb, nn] of pairs) {
    const a = MC.buildRoomPatch(bb, nn, false), c = MB.buildRoomPatch(bb, nn);
    assert.equal(JSON.stringify(a), JSON.stringify(c), '兩層產出與 BASE 不同：' + JSON.stringify(a) + ' vs ' + JSON.stringify(c));
    same++;
    if (a) n2++;
  }
  assert.equal(same, 6000);
  assert.ok(n2 > 5000, '掃描器自驗：只有 ' + n2 + ' 對真的產出了 patch');
  // 正對照：同一批資料，deep=true 必須產出**不同**的東西（否則上面是恆真式）
  let diff = 0;
  for (const [bb, nn] of pairs) {
    if (JSON.stringify(MC.buildRoomPatch(bb, nn, true)) !== JSON.stringify(MB.buildRoomPatch(bb, nn))) diff++;
  }
  assert.ok(diff > 100, '正對照失敗：deep=true 竟然也跟 BASE 一樣（' + diff + ' 對不同）⇒ 上面那條是恆真式');
  console.log('     6,000 對兩層產出逐位元相同；同一批 deep=true 有 ' + diff + ' 對不同（正對照）');
});

// ══════════════════════════════════════════════════════════════════════════
// 【E】正對照 (a)~(f)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【E】正對照 (a)~(f) ═════════════════════════════════════════');
await T('E-a ⭐⭐ 舊伺服器（deltaPutDeep 缺席）⇒ 維持**兩層**，請求數與 BASE 相同、不多打請求', async () => {
  // ⚠ 刻意用「log 很大、players 很小」的房：兩層 patch 才不會被 60% 門檻退成全量，
  //   這樣才驗得到「送的是兩層 patch」而不只是「沒送深路徑」。
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(OC, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });   // ⚠ v6.268~v6.277 的伺服器：只有 deltaPut
  assert.equal(M.deltaPutDeepArmed(), false, '舊伺服器竟然武裝了深層');
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.players[0].active.damage = 50;
  const before = api.log.length;
  const r = await M.oracleUpsertRoomDelta('room', next, 7, M.deltaPutBase(prev));
  assert.ok(r && r.ok, '沒成功：' + JSON.stringify(r).slice(0, 150));
  const reqs = api.log.slice(before);
  assert.equal(reqs.length, 1, '多打了請求：' + reqs.length);
  assert.equal(reqs[0].body.patchProto, 1, '舊伺服器竟然退成全量（兩層應該仍然送得出去）：'
    + JSON.stringify(Object.keys(reqs[0].body)));
  const paths = Object.keys(reqs[0].body.patch.set);
  assert.ok(paths.every((p) => p.split('.').length <= 2), '舊伺服器竟然收到深路徑：' + JSON.stringify(paths));
  assert.equal(SRV_DB.docs.ROOM.gameState.players[0].active.damage, 50, '兩層路徑也必須寫得進去');
});
await T('E-a2 哨兵完全缺席（v6.267 以前）⇒ 全量，且 deltaPutBase 連複製都不做', () => {
  const M = loadClientCore(OC);
  const trap = new Proxy({}, { ownKeys() { throw new Error('不該被列舉'); }, getOwnPropertyDescriptor() { throw new Error('不該被讀'); } });
  assert.equal(M.deltaPutBase(trap), null, '哨兵缺席還去讀 room');
  assert.equal(M.deltaPutDeepArmed(), false);
});
await T('E-b 熔斷後 ⇒ 全量（deltaPutBase 回 null）', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc() };
  const api = makeOracleApiOverRealServer();
  const bad = async (p, o) => {
    if (o?.method === 'PUT' && o.body && o.body.patchProto === 1) o = { ...o, body: { ...o.body, fullHash: 'deadbeef-1234' } };
    return api(p, o);
  };
  const M = loadClientCore(OC, { oracleApi: bad,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  for (let i = 0; i < 3; i++) {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 100 + i;
    const r = await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
    assert.ok(r && r.ok, '第 ' + i + ' 發應退全量成功');
  }
  assert.ok(M.deltaPutFuseTripped(), '3 次拒收後應熔斷（最後防線不可失效）');
  assert.equal(M.deltaPutBase(clientViewOf(SRV_DB.docs.ROOM)), null, '熔斷後必須回 null ⇒ 全量');
});
await T('E-d ⭐⭐ 錦標賽 tApi 逐位元不變＋零 delta 識別字（錦標賽零接觸）', () => {
  const AN = '  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {';
  const i = GP.indexOf(AN);
  assert.ok(i > 0, '找不到 tApi 錨點');
  const seg = GP.slice(i, GP.indexOf('\n  }\n', i) + 4);
  assert.ok(seg.length > 300, 'tApi 抽取太短');
  for (const kw of ['patchProto', 'deltaPut', 'oracleUpsertRoomDelta', 'buildRoomPatch', 'deltaPutDeep']) {
    assert.ok(!seg.includes(kw), 'tApi 出現 ' + kw);
  }
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const b = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
    assert.ok(b.ok);
    const bs = b.out.replace(/\r\n/g, '\n');
    const j = bs.indexOf(AN);
    assert.equal(seg, bs.slice(j, bs.indexOf('\n  }\n', j) + 4), 'tApi 與 BASE 不同');
  } else {
    shallowSkip('v6279-E-d tApi 與 BASE blob 逐位元比對', 'history-free 判準（零 delta 識別字）仍在守');
  }
  // 伺服器檔完全沒動（本版是純 client 版）
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
    assert.ok(b.ok);
    assert.equal(createHash('sha256').update(SRV, 'utf8').digest('hex'),
      createHash('sha256').update(b.out.replace(/\r\n/g, '\n'), 'utf8').digest('hex'),
      '⚠⚠ server_admin_patch.js 被動到了（本版只做 client）');
  }
});
await T('E-e ⭐⭐ Firestore 讀取零增加：room.ts／firebase.ts 與 BASE 逐位元相同、零 delta 識別字', () => {
  const rt = R(path.join(ROOT, 'src/lib/game/room.ts'));
  const fb = R(path.join(ROOT, 'src/lib/firebase.ts'));
  for (const [name, s] of [['room.ts', rt], ['firebase.ts', fb]]) {
    for (const kw of ['deltaPut', 'patchProto', 'buildRoomPatch']) assert.ok(!s.includes(kw), name + ' 出現 ' + kw);
  }
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    for (const [p, cur] of [['src/lib/game/room.ts', rt], ['src/lib/firebase.ts', fb]]) {
      const b = readBaseBlob(ROOT, BASE_SHA, p);
      assert.ok(b.ok, '讀不到 ' + p);
      assert.equal(createHash('sha256').update(cur, 'utf8').digest('hex'),
        createHash('sha256').update(b.out.replace(/\r\n/g, '\n'), 'utf8').digest('hex'), p + ' 被動到了（Firestore 讀取紅線）');
    }
  } else {
    shallowSkip('v6279-E-e room.ts/firebase.ts 與 BASE 逐位元比對', 'history-free 判準（零 delta 識別字）仍在守');
  }
  // 本版 oracleApi 的請求種類沒有新增（沒有任何新端點）
  assert.ok(!OC.includes('/api/rooms/deep'), '出現了新端點');
});

// ══════════════════════════════════════════════════════════════════════════
// 【F】⭐ CPU 保險（行為端）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【F】⭐ CPU 保險：快裝置不觸發／連續超標才觸發／退兩層不是全量 ═══');
/**
 * 可控時鐘：把 performance.now 換成腳本控制的假時鐘。
 * ⚠ 出貨碼一次 diff 會呼叫 now() **兩次**（_t0 與結束）⇒ 第 2 次**先推進再回傳**，
 *   差值才等於 msPerDiff()。（第一版寫成「先回傳再推進」，量到的一律是 0 ——
 *   那會讓 CPU 保險的每一條斷言都變成恆真式。）
 */
function mkFakeClock(msPerDiff) {
  let t = 0, flip = 0;
  return { now: () => { if (flip++ % 2 === 1) t += msPerDiff(); return t; } };
}
function mkSlowWorld(msPerDiff) {
  const perf = mkFakeClock(msPerDiff);
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(OC, { performance: perf, oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  return { api, M };
}
async function pushOnce(M, api, turn) {
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.turn = turn;
  next.gameState.players[0].active.damage = (turn * 7) % 200;
  const r = await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
  const puts = api.log.filter((c) => c.method === 'PUT');
  return { r, last: puts[puts.length - 1] };
}
const kindOf = (put) => (!put || !('patchProto' in put.body)) ? 'full'
  : (Object.keys(put.body.patch.set).some((p) => p.split('.').length >= 3) ? 'deep' : 'two');
await T('F1 快裝置（每次 5ms）連 20 發都不觸發保險，全程走深層', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  const { api, M } = mkSlowWorld(() => 5);
  for (let i = 0; i < 20; i++) {
    const { last } = await pushOnce(M, api, 10 + i);
    assert.equal(kindOf(last), 'deep', '第 ' + i + ' 發不是深層');
  }
  const dg = M.deltaPutDiag();
  assert.equal(dg.deep.off, false, '快裝置竟然被降級');
  assert.equal(dg.deep.trips, 0);
  assert.ok(dg.diffMs && dg.diffMs.n === 20 && dg.diffMs.p50 === 5, 'diffMs 沒量到：' + JSON.stringify(dg.diffMs));
});
await T('F2 ⭐⭐ 慢裝置（每次 60ms）：**連續第 3 次**才降級；降級後走**兩層**（不是全量）', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  const { api, M } = mkSlowWorld(() => 60);
  const kinds = [];
  for (let i = 0; i < 6; i++) { const { last } = await pushOnce(M, api, 20 + i); kinds.push(kindOf(last)); }
  assert.deepStrictEqual(kinds, ['deep', 'deep', 'deep', 'two', 'two', 'two'],
    '降級時機不對（應在連續第 3 次超標之後）：' + kinds.join(','));
  const dg = M.deltaPutDiag();
  assert.equal(dg.deep.off, true);
  assert.equal(dg.deep.trips, 1);
  assert.equal(dg.fused, false, '⚠ CPU 保險不可以觸發熔斷（那是給伺服器拒收用的）');
  assert.equal(SRV_DB.docs.ROOM.gameState.turn, 25, '降級後仍然要寫得進去');
});
await T('F3 ⭐ 一次超標不算：慢-慢-快-慢-慢 不會降級（「連續」不是「累計」）', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  let seq = [60, 60, 5, 60, 60], i = 0;
  const { api, M } = mkSlowWorld(() => seq[Math.min(i, seq.length - 1)]);
  for (i = 0; i < 5; i++) { const { last } = await pushOnce(M, api, 30 + i); assert.equal(kindOf(last), 'deep', '第 ' + i + ' 發應仍是深層'); }
  assert.equal(M.deltaPutDiag().deep.off, false, '不連續也降級 ⇒ 會誤傷正常裝置');
});
await T('F4 ⭐⭐ 不抖動：換房只重新武裝 DELTA_PUT_DEEP_MAX_TRIPS 次，之後永久兩層', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  const { api, M } = mkSlowWorld(() => 60);
  const trips = [];
  for (let room = 0; room < 5; room++) {
    // 換房（不同 code）⇒ 重新武裝（若還有額度）
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 200 + room;
    await M.oracleUpsertRoomDelta('r' + room, next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
    for (let k = 0; k < 4; k++) {
      const p2 = clientViewOf(SRV_DB.docs.ROOM);
      const n2 = JSON.parse(JSON.stringify(p2)); n2.gameState.turn = 300 + room * 10 + k;
      await M.oracleUpsertRoomDelta('r' + room, n2, SRV_DB.docs.ROOM._version, M.deltaPutBase(p2));
    }
    trips.push(M.deltaPutDiag().deep.trips);
  }
  assert.deepStrictEqual(trips, [1, 2, 2, 2, 2], '重新武裝次數失控（會反覆抖動）：' + trips.join(','));
  assert.equal(M.deltaPutDiag().deep.off, true);
  assert.equal(M.DELTA_PUT_DEEP_MAX_TRIPS, 2);
});
await T('F5 ⚠ 量測本身不是成本：成功路徑沒有多任何 await／請求／計時器', () => {
  // ⚠ 先剝註解 —— 註解裡寫「不要用 console.time」不該被當成「用了 console.time」
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  const block = strip(extractBlock(OC, CB_S, CB_E, 4000, 'client 區塊'));
  for (const kw of ['console.time', 'setInterval', 'requestIdleCallback', 'PerformanceObserver']) {
    assert.ok(!block.includes(kw), '量測用了 ' + kw + '（會變成成本）');
  }
  assert.equal((block.match(/setTimeout\(/g) || []).length, 0, 'client 區塊出現 setTimeout');
  // 掃描器自驗：剝註解之後仍抓得到真的呼叫
  assert.ok(strip('const a = 1;  // console.time\nconsole.time("x");').includes('console.time'), '剝註解器把程式也剝掉了');
  assert.ok(!strip('// console.time("x")').includes('console.time'), '剝註解器沒作用');
  // 出貨路徑（oracleUpsertRoomDelta）的 await 只有既有那些
  const raw = extractBlock(OC, CB_S, CB_E, 4000, 'client 區塊');
  const fn = extractBlock(raw, 'export async function oracleUpsertRoomDelta(', '\n// <<< v6270-delta-put-client-core', 1000, 'oracleUpsertRoomDelta');
  const awaits = (fn.match(/await /g) || []).length;
  assert.equal(awaits, 1, 'oracleUpsertRoomDelta 的 await 次數變成 ' + awaits + '（成功路徑不可多任何一次 await）');
  assert.ok(/_dpNow\(\) - _t0/.test(fn), '沒有用兩次時鐘相減量 diff 耗時');
});

// ══════════════════════════════════════════════════════════════════════════
// 【G】診斷
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【G】診斷：三分類 bodyBytes＋diffMs；一般玩家 0 發／0 bytes ═══');
await T('G1 ⭐⭐ bodyBytes 分得出三種：deep／two／full（且 patch 仍是 v6.270 的合併窗）', async () => {
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(OC, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: ev === undefined ? { data } : { data, expectedVersion: ev } }) });
  // ① 深層
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  let prev = clientViewOf(SRV_DB.docs.ROOM);
  let next = JSON.parse(JSON.stringify(prev)); next.gameState.players[0].active.damage = 70;
  await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
  // ② 兩層（伺服器撤掉 deep 哨兵）
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  prev = clientViewOf(SRV_DB.docs.ROOM);
  next = JSON.parse(JSON.stringify(prev)); next.gameState.players[0].active.damage = 80;
  await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
  // ③ 全量（開局情境：base 還沒有 gameState ⇒ patch ≈ 全量 ⇒ 60% 門檻退全量）
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  SRV_DB.docs.ROOM = { ...SRV_DB.docs.ROOM, status: 'lobby', gameState: null };
  prev = clientViewOf(SRV_DB.docs.ROOM);
  next = JSON.parse(JSON.stringify(prev));
  next.status = 'playing';
  next.gameState = makeGameDoc(400, 60).gameState;
  await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
  const b = M.deltaPutDiag().bytes;
  assert.ok(b && b.deep && b.two && b.full, '三分類不齊：' + JSON.stringify(b));
  assert.equal(b.deep.n, 1); assert.equal(b.two.n, 1); assert.equal(b.full.n, 1);
  assert.equal(b.patch.n, 2, 'patch 合併窗（deep+two）語義變了 ⇒ 舊判讀會被靜默改意思');
  assert.ok(b.deep.p50 < b.two.p50, '深層竟然沒比兩層小：deep=' + b.deep.p50 + ' two=' + b.two.p50);
  assert.ok(b.two.p50 < b.full.p50, '兩層竟然沒比全量小');
  // 位元組數 ＝ 實送 body 的 UTF-8 長度
  const puts = api.log.filter((c) => c.method === 'PUT');
  const deepPut = puts.find((c) => c.body.patchProto === 1 && Object.keys(c.body.patch.set).some((p) => p.split('.').length >= 3));
  assert.equal(b.deep.p50, Buffer.byteLength(JSON.stringify(deepPut.body), 'utf8'), 'deep bodyBytes 不等於實送位元組');
  const fullPut = puts.find((c) => !('patchProto' in c.body));
  assert.equal(b.full.p50, Buffer.byteLength(JSON.stringify(fullPut.body), 'utf8'), 'full bodyBytes 不等於實送位元組');
});
// ── +page.svelte 休閒函式 harness（v6.261/v6.270 手法）──
function softFn(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) return null;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}
async function mkCasualHarness(pageSrc, { diag = null, fuse = false } = {}) {
  const CONSTS = ['CASUAL_DIAG_REASONS', 'CASUAL_DIAG_MAX_PER_PAGE', 'CASUAL_SLOW_PUSH_P95_MS', 'CASUAL_PUSH_MIN_CALLS', 'PERF_SAMPLE_RATE'];
  const constLines = CONSTS.map((k) => {
    const m = new RegExp('^\\s*const ' + k + ' = [^\\n]*$', 'm').exec(pageSrc);
    assert.ok(m, '抓不到 ' + k);
    return m[0].trim().replace(/\s*\/\/.*$/, '');
  }).join('\n');
  const anchors = ['function _sampleStats(src: number[]): _PStat | null {',
    'function _pushSample(arr: number[], ms: number): void {',
    'function _casualDiagSend(reason: string, now: number): boolean {',
    'function _casualDiagPayload(reason: string, now: number): any {',
    'function _casualRecordPush(ms: number, ok: boolean): void {',
    'function _casualDeltaDiag(', 'function _casualNoteDeltaFuse('];
  const parts = anchors.map((a) => softFn(pageSrc, a));
  assert.ok(parts.every(Boolean), '函式抽不齊：' + anchors.filter((a, i) => !parts[i]));
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
  return new Function(ts2js(PRELUDE + parts.join('\n') + '\n' + EXPORTS))();
}
const REAL_DIAG = { fused: false, rejects: 0, lastReason: null,
  bytes: { patch: { n: 9, p50: 1500, p95: 2000, max: 2100 }, full: { n: 1, p50: 41000, p95: 41000, max: 41000 },
    deep: { n: 8, p50: 1400, p95: 1900, max: 2000 }, two: { n: 1, p50: 12000, p95: 12000, max: 12000 } },
  diffMs: { n: 9, p50: 2, p95: 6, max: 9 },
  deep: { srv: true, off: false, trips: 0, streak: 0 } };
await T('G2 ⭐ payload 接線（實跑）：push 帶 bodyBytes 三分類＋diffMs＋deep 狀態', async () => {
  const h = await mkCasualHarness(GP, { diag: REAL_DIAG });
  h._casualDiagSend('casual-slow-push', Date.now());
  const p = h.posted()[0];
  assert.ok(p && p.push, '沒送出');
  assert.ok(p.push.bodyBytes && p.push.bodyBytes.deep && p.push.bodyBytes.two && p.push.bodyBytes.full,
    'bodyBytes 三分類沒帶出來：' + JSON.stringify(p.push.bodyBytes));
  assert.equal(p.push.bodyBytes.deep.p50, 1400);
  assert.equal(p.push.bodyBytes.two.p50, 12000);
  assert.ok(p.push.diffMs && p.push.diffMs.p95 === 6, 'diffMs 沒帶出來：' + JSON.stringify(p.push.diffMs));
  assert.ok(p.push.deep && p.push.deep.srv === true, 'deep 狀態沒帶出來：' + JSON.stringify(p.push.deep));
  assert.equal(p.delta, null, '非 fuse 指紋 delta 應為 null');
  const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
  assert.ok(bytes < 1200, '單發 payload ' + bytes + ' bytes 超標');
  console.log('     單發 payload ' + bytes + ' bytes');
});
await T('G3 ⭐⭐ (f) 一般玩家 0 發／0 bytes：匿名／未登入即使指標很糟也一發不送（含正對照）', async () => {
  const slow = { ...REAL_DIAG, deep: { srv: true, off: true, trips: 2, streak: 0 } };
  for (const user of [{ isAnonymous: true }, null]) {
    const h = await mkCasualHarness(GP, { diag: slow, fuse: true });
    h.setUser(user);
    for (let i = 0; i < 30; i++) h._casualRecordPush(99999, true);
    assert.equal(h.posted().length, 0, JSON.stringify(user) + ' 竟然送出 ' + h.posted().length + ' 發');
  }
  const h3 = await mkCasualHarness(GP, { diag: slow, fuse: true });
  for (let i = 0; i < 30; i++) h3._casualRecordPush(99999, true);
  assert.ok(h3.posted().length > 0, '正對照失敗：登入者反而送不出（上面那條是恆真式）');
  // ⭐ 0 bytes 的第二層證明：哨兵缺席時連量都不量（deltaPutDiag().bytes 為 null）
  const M = loadClientCore(OC);
  assert.equal(M.deltaPutDiag().bytes, null, '沒送過任何 PUT 竟然就有 bytes');
  assert.equal(M.deltaPutDiag().diffMs, null, '沒送過任何 PUT 竟然就有 diffMs');
});
await T('G4 dump 的 casualSummary 把三分類整包帶出（dump 端零改動的接線證明）', () => {
  const DUMP = require_(path.join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'));
  const row = { ts: 1756500000000, uid: 'u1', email: 'x@y.z', room: 'AB12', reason: 'casual-perf-sample',
    diag: JSON.stringify({ reason: 'casual-perf-sample', mode: 'casual', room: 'AB12', ver: VERSION,
      push: { n: 12, p50: 900, p95: 4000, max: 9000, fail: 0, inflight: 0,
        bodyBytes: REAL_DIAG.bytes, diffMs: REAL_DIAG.diffMs, deep: REAL_DIAG.deep },
      board: { phase: 'playing', turn: 3, logLen: 9, seat: 0, spectator: false },
      claim: null, env: { ua: 'TESTUA' } }) };
  const out = DUMP.casualSummary([row]);
  assert.equal(out.list[0].push.bodyBytes.deep.p50, 1400, '三分類沒隨 push 整包帶出');
  assert.equal(out.list[0].push.diffMs.p95, 6, 'diffMs 沒帶出');
});

// ══════════════════════════════════════════════════════════════════════════
// 【H】perf（Rule 32：這一節就是量測腳本）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【H】perf：diff＋hash＋序列化的 p50/p99（沙盒 CPU） ═══════════');
await T('H1 48KB 代表性房 doc：深層 vs 兩層的 p50/p99（並列印省了多少位元組）', () => {
  const doc = makeGameDoc(350, 60);
  const prev = clientViewOf(doc);
  const bytes = Buffer.byteLength(JSON.stringify(prev), 'utf8');
  assert.ok(bytes > 40000, '代表性 doc 應大於 40KB，實得 ' + bytes);
  const run = (deep) => {
    const times = [], sizes = [];
    for (let i = 0; i < 300; i++) {
      const next = JSON.parse(JSON.stringify(prev));
      next.gameState.turn = i;
      next.gameState.players[i % 2].active.damage = (i * 13) % 250;
      next.gameState.log = next.gameState.log.concat([{ t: 9000 + i, msg: '第 ' + i + ' 手：新事件' }]);
      const t0 = process.hrtime.bigint();
      const patch = MC.buildRoomPatch(prev, next, deep);
      const body = { patchProto: 1, patch, fullHash: MC.deltaPutCanonHash(next), expectedVersion: 7 };
      const s = JSON.stringify(body);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      sizes.push(Buffer.byteLength(s, 'utf8'));
      assert.ok(patch, 'perf 迭代 ' + i + ' diff 失敗');
    }
    times.sort((a, b) => a - b); sizes.sort((a, b) => a - b);
    return { p50: times[150], p99: times[296], max: times[299], b50: sizes[150] };
  };
  const D = run(true), W = run(false);
  console.log('     doc=' + (bytes / 1024).toFixed(1) + 'KB（沙盒 CPU，正式裝置更快）');
  console.log('     兩層 p50=' + W.p50.toFixed(2) + 'ms p99=' + W.p99.toFixed(2) + 'ms max=' + W.max.toFixed(2) + 'ms  body p50=' + W.b50.toLocaleString() + ' bytes');
  console.log('     深層 p50=' + D.p50.toFixed(2) + 'ms p99=' + D.p99.toFixed(2) + 'ms max=' + D.max.toFixed(2) + 'ms  body p50=' + D.b50.toLocaleString() + ' bytes'
    + '  ⇒ 相對兩層再省 ' + (100 - D.b50 / W.b50 * 100).toFixed(1) + '%');
  assert.ok(D.p99 < 40, '深層 p99=' + D.p99.toFixed(2) + 'ms 超過沙盒上限 40ms');
  assert.ok(D.p99 < W.p99 * 3, '深層 p99 比兩層貴超過 3 倍（' + D.p99.toFixed(2) + ' vs ' + W.p99.toFixed(2) + '）');
  assert.ok(D.b50 < W.b50 * 0.5, '深層沒有比兩層省一半以上：' + D.b50 + ' vs ' + W.b50);
  assert.ok(D.p99 < MC.DELTA_PUT_DEEP_SLOW_MS, '沙盒的 p99 已經超過 CPU 保險門檻 ⇒ 門檻訂太低會誤傷');
});

// ══════════════════════════════════════════════════════════════════════════
// 【I】突變測試
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【I】突變測試（每條必須紅在預期的那條斷言） ═══════════════════');
async function expectRed(name, fn) {
  await T(name, async () => {
    let redAt = null;
    try { await fn(); } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; redAt = String(e.message); }
    assert.ok(redAt !== null, '突變體竟然全綠 —— 守衛是安慰劑');
    console.log('     └ 紅在：' + redAt.split('\n')[0].slice(0, 110));
  });
}
function mutOC(find, replace) {
  const m = OC.replace(find, replace);
  assert.notEqual(m, OC, '突變沒套上：' + String(find).slice(0, 70));
  return m;
}
await expectRed('M1 陣列長度不同也硬鑽索引 ⇒ 被伺服器**最後防線 canonical hash 複驗**擋下（422）', async () => {
  const mut = mutOC('const isArr = !isObj && Array.isArray(bv) && Array.isArray(nv) && bv.length === nv.length;',
    'const isArr = !isObj && Array.isArray(bv) && Array.isArray(nv);');
  const M = loadClientCore(mut);
  const doc = makeGameDoc(4, 3);
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.players[0].bench = next.gameState.players[0].bench.slice(1);
  const patch = M.buildRoomPatch(prev, next, true);
  const { res, nexted } = await serveDelta(doc, next, patch);
  assert.ok(nexted, '被伺服器拒：' + JSON.stringify(res.body ?? null).slice(0, 120));
});
await expectRed('M2 對陣列元素 del ⇒ auditPaths 的「禁 del 進陣列」必紅', async () => {
  const M = loadClientCore(OC);
  const doc = makeGameDoc(4, 3);
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.players[0].active.damage = 10;
  const patch = M.buildRoomPatch(prev, next, true);
  patch.del.push('gameState.players.0.bench.0');   // 人工注入伺服器一定拒的路徑
  auditPaths(prev, patch);
});
await expectRed('M3 段數上限改 999 ⇒ auditPaths 的段數斷言必紅（伺服器仍只收 8 段）', async () => {
  const mut = mutOC('export const DELTA_PUT_MAX_PATH_SEGS = 8;', 'export const DELTA_PUT_MAX_PATH_SEGS = 999;');
  const M = loadClientCore(mut);
  const doc = makeGameDoc(3, 2);
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev));
  // 造一條 9 段的路徑：gameState.players.0.active.flags.a.b.c.d
  prev.gameState.players[0].active.flags = { a: { b: { c: { d: 1 } } } };
  next.gameState.players[0].active.flags = { a: { b: { c: { d: 2 } } } };
  const patch = M.buildRoomPatch(prev, next, true);
  assert.ok(patch, 'diff 回 null');
  auditPaths(prev, patch);
  const { res, nexted } = await serveDelta(doc, next, patch);
  assert.ok(nexted, '被伺服器拒：' + JSON.stringify(res.body ?? null).slice(0, 120));
});
await expectRed('M4 不回捲 ⇒ C2「logAppend 殘骸」必紅', async () => {
  const mut = mutOC('  if (!ok) _dpRollback(ctx, mark);   ', '  if (false) _dpRollback(ctx, mark);   ');
  const M = loadClientCore(mut);
  const doc = makeGameDoc(5);
  const prev = clientViewOf(doc);
  const next = JSON.parse(JSON.stringify(prev));
  next.gameState.log = next.gameState.log.concat([{ t: 99, msg: '新的一則' }]);
  next.gameState['a.b'] = 1;
  const patch = M.buildRoomPatch(prev, next, true);
  assert.ok(!patch.logAppend, '⚠⚠ 整包 set 了還留著 logAppend：' + JSON.stringify(patch.logAppend));
});
await expectRed('M5 忽略 deltaPutDeep 哨兵 ⇒ E-a「舊伺服器維持兩層」必紅', async () => {
  const mut = mutOC("_dpSentinelDeep = _dpSentinel && (b as { deltaPutDeep?: unknown }).deltaPutDeep === 1;",
    "_dpSentinelDeep = _dpSentinel;");
  SRV_DB.docs = { ROOM: makeGameDoc() };
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(mut, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1 });
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.players[0].active.damage = 50;
  await M.oracleUpsertRoomDelta('room', next, 7, M.deltaPutBase(prev));
  const put = api.log.filter((c) => c.method === 'PUT').pop();
  const paths = Object.keys(put.body.patch ? put.body.patch.set : {});
  assert.ok(paths.every((p) => p.split('.').length <= 2), '舊伺服器竟然收到深路徑：' + JSON.stringify(paths));
});
await expectRed('M6 CPU 保險改成「累計」而非「連續」⇒ F3 必紅', async () => {
  const mut = mutOC('      _dpDeepSlowStreak = 0;   // 一次在門檻內就歸零 ——「連續」不是「累計」',
    '      void 0;   // 突變：不歸零');
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  let seq = [60, 60, 5, 60, 60], i = 0;
  const api = makeOracleApiOverRealServer();
  const perf = mkFakeClock(() => seq[Math.min(i, seq.length - 1)]);
  const M = loadClientCore(mut, { performance: perf, oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  for (i = 0; i < 5; i++) {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 30 + i;
    next.gameState.players[0].active.damage = i * 3;
    await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
  }
  assert.equal(M.deltaPutDiag().deep.off, false, '不連續也降級 ⇒ 會誤傷正常裝置');
});
await expectRed('M7 CPU 保險改成退**全量**（而不是退兩層）⇒ F2 必紅', async () => {
  const mut = mutOC('  const _deep = _dpSentinelDeep && !_dpDeepOff;',
    '  const _deep = _dpSentinelDeep && !_dpDeepOff;\n  if (_dpDeepOff) return oracleUpsertRoom(code, data, expectedVersion, opts);');
  SRV_DB.docs = { ROOM: makeGameDoc(300, 3) };
  const api = makeOracleApiOverRealServer();
  const perf = mkFakeClock(() => 60);
  const M = loadClientCore(mut, { performance: perf, oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  const kinds = [];
  for (let i = 0; i < 6; i++) {
    const prev = clientViewOf(SRV_DB.docs.ROOM);
    const next = JSON.parse(JSON.stringify(prev)); next.gameState.turn = 20 + i;
    next.gameState.players[0].active.damage = (i * 7) % 200;
    await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
    kinds.push(kindOf(api.log.filter((c) => c.method === 'PUT').pop()));
  }
  assert.deepStrictEqual(kinds, ['deep', 'deep', 'deep', 'two', 'two', 'two'], '降級後應退兩層不是全量：' + kinds.join(','));
});
await expectRed('M8 bodyBytes 不分深/兩層（都記 two）⇒ G1 必紅', async () => {
  const mut = mutOC("    const c = _dpKind === 'deep' ? _dpBytesDeep : _dpBytesTwo;", '    const c = _dpBytesTwo;');
  SRV_DB.docs = { ROOM: makeGameDoc() };
  const api = makeOracleApiOverRealServer();
  const M = loadClientCore(mut, { oracleApi: api,
    oracleUpsertRoom: async (code, data, ev) => api(`/api/rooms/${code.toUpperCase()}`, { method: 'PUT', body: { data, expectedVersion: ev } }) });
  M._noteDeltaPutSentinel({ room: {}, deltaPut: 1, deltaPutDeep: 1 });
  const prev = clientViewOf(SRV_DB.docs.ROOM);
  const next = JSON.parse(JSON.stringify(prev)); next.gameState.players[0].active.damage = 70;
  await M.oracleUpsertRoomDelta('room', next, SRV_DB.docs.ROOM._version, M.deltaPutBase(prev));
  const b = M.deltaPutDiag().bytes;
  assert.ok(b && b.deep && b.deep.n === 1, '深層統計不見了（被記成兩層）：' + JSON.stringify(b));
});

// ══════════════════════════════════════════════════════════════════════════
// 【J】HEAD-FAIL
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【J】HEAD-FAIL（對 BASE v6.278 blob，各項各自紅） ══════════════');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bOC = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/oracle-client.ts');
  const bGP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  assert.ok(bOC.ok && bGP.ok, 'BASE blob 讀不到');
  const bOCs = bOC.out.replace(/\r\n/g, '\n'), bGPs = bGP.out.replace(/\r\n/g, '\n');
  await expectRed('J1 BASE 沒有 v6279 深層區塊 ⇒ A1 紅', () => {
    extractBlock(bOCs, DEEP_S, DEEP_E, 3000, 'v6279 深層區塊');
  });
  await expectRed('J2 BASE 的 buildRoomPatch 產不出深路徑 ⇒ A2/B3 紅', () => {
    const MB = loadClientCore(bOCs);
    const doc = makeGameDoc();
    const prev = clientViewOf(doc);
    const next = JSON.parse(JSON.stringify(prev));
    next.gameState.players[0].active.damage = 120;
    const p = MB.buildRoomPatch(prev, next, true);
    assert.ok(p && Object.keys(p.set).some((k) => k.split('.').length >= 3),
      'BASE 竟然產出深路徑：' + JSON.stringify(Object.keys(p ? p.set : {})));
  });
  await expectRed('J3 BASE 沒有 deltaPutDeepArmed／CPU 保險 ⇒ F 全節紅', () => {
    const MB = loadClientCore(bOCs);
    assert.equal(typeof MB.deltaPutDeepArmed, 'function', 'BASE 竟然有 deltaPutDeepArmed');
  });
  await expectRed('J4 BASE 的 diag 沒有三分類／diffMs ⇒ G1 紅', () => {
    const MB = loadClientCore(bOCs);
    const d = MB.deltaPutDiag();
    assert.ok('diffMs' in d && d.deep !== undefined, 'BASE 的 deltaPutDiag 竟然有 diffMs/deep');
  });
  await expectRed('J5 BASE 的 payload 沒有 diffMs ⇒ G2 紅', async () => {
    const h = await mkCasualHarness(bGPs, { diag: REAL_DIAG });
    h._casualDiagSend('casual-slow-push', Date.now());
    const p = h.posted()[0];
    assert.ok(p && p.push && p.push.diffMs !== undefined, 'BASE payload 竟然有 diffMs');
  });
  await expectRed('J6 BASE 的 test chain 沒有本守衛、版本是 6.278 ⇒ K1/K2 紅', () => {
    const bp = readBaseBlob(ROOT, BASE_SHA, 'package.json');
    const bv = readBaseBlob(ROOT, BASE_SHA, 'src/lib/version.ts');
    assert.ok(bp.ok && bv.ok);
    assert.ok(JSON.parse(bp.out).scripts.test.includes('test-v6279-delta-put-deep-client.mjs'), 'BASE 竟然有本守衛');
    assert.notEqual(/VERSION = '([\d.]+)'/.exec(bv.out)[1], '6.278', 'BASE 版本竟然不是 6.278');
  });
} else {
  shallowSkip('v6279-J HEAD-FAIL 全節', '需要 BASE blob；出貨判準（A/B/C/F/G/H）全部 history-free，仍在守');
}

// ══════════════════════════════════════════════════════════════════════════
// 【K】自查
// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【K】自查 ═══════════════════════════════════════════════════');
await T('K1 守衛在 package.json 的 test chain 裡（CI 的 iron-rules-audit 是 continue-on-error，不算數）', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(String(pkg.scripts.test).includes('node scripts/test-v6279-delta-put-deep-client.mjs'), '本守衛沒進 npm test chain');
});
await T('K2 版本一致（version.ts ＝ admin.html hint）；admin.html 維持 LF', () => {
  const adm = readFileSync(path.join(ROOT, 'oracle-admin/admin.html'));
  const ma = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(adm.toString('utf8'));
  assert.ok(ma && ma[1] === VERSION, 'admin.html hint(' + (ma && ma[1]) + ') ≠ version.ts(' + VERSION + ')');
  assert.equal(adm.includes(Buffer.from('\r\n')), false, 'admin.html 出現 CRLF');
});
await T('K3 ⚠ 本守衛沒有 pin 死任何 v6.xxx 版本號（第九種安慰劑）', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = self.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const hits = body.match(/['"]6\.\d{3}['"]/g) || [];
  const bad = hits.filter((h) => h !== "'6.278'");   // 唯一允許：HEAD-FAIL 確認 BASE 是哪一版
  assert.deepStrictEqual(bad, [], '出現不該寫死的版本號字面量：' + bad.join(','));
  assert.ok(hits.length > 0, 'HEAD-FAIL 的 BASE 版本斷言不見了（掃描器自驗）');
});
await T('K4 fuzz 真的跑到 20,000 次（掃描器自驗，不是靜默跳過）', () => {
  assert.ok(FUZZ_STAT && FUZZ_STAT.ran + FUZZ_STAT.nullPatch === 20000,
    'fuzz 次數不對：' + JSON.stringify(FUZZ_STAT));
  assert.equal(FUZZ_STAT.rejected, 0);
});

console.log('\n────────────────────────────────');
console.log('test-v6279-delta-put-deep-client: ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
