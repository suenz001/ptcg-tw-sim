#!/usr/bin/env node
/**
 * v6.525／server v1.62 守衛：休閒對戰「回到我之前的房間」（站長 2026-10-11）。
 *
 * 玩家回報：開房後把網頁關掉重開、重新登入，前面開的舊房間進不去。
 * 站長：「要讓開房的房主可以回去他開過房的舊房間（當然如果他要開新房間也是可以的）」。
 *
 * 【S】伺服器 v1.62（實跑哨兵區塊 v162-casual-reclaim）
 *   S1 casualReclaimPlan：email 相同且有人坐的 p1／p2 座位才認得回；同一個 uid 已坐另一位 ⇒ lobby 清掉、對戰中拒絕；
 *      離座（uid 空）、觀戰位、已結束、別人的房都拒絕；email 不分大小寫；同 uid 不寫入
 *   S2 POST /api/my-room/reclaim-seat：未登入 401；CAS（_version）衝突會重試；成功只寫那幾個欄位
 *   S3 GET  /api/my-room：快照有房號還要再用主鍵確認（離座的不算）；快照答不出來 ⇒ 不帶 roomId
 * 【C】玩家端
 *   C1 myRoomsFromList：自己的房不套大廳的死房／過久／私密房過濾；只認 p1／p2；排除已結束、別人的、現在在的那間
 *   C2 mergeMyOldRooms：同一間以 uid 來源為準
 *   C3 fetchMyCasualRoom／reclaimCasualSeat：帶 Bearer、匿名不發請求、舊伺服器回 undefined
 *   C4 room-oracle：大廳輪詢第二個參數是未過濾的原始列表；joinRoom 回到自己的對戰中房不受「未開放觀戰」限制（別人仍然擋）
 *   C5 頁面：回到房間（email 來源先認座位、失敗不進房）；開新房只釋放 status==='lobby' 的舊房；畫面區塊與接線
 * 【H】BASE（v6.524-後的 09c0234e）：S、C 逐條紅
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：admin v1.83（09c0234e）。
const BASE_SHA = '09c0234e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ── 伺服器 ──────────────────────────────────────────────────────────────────
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  return a >= 0 && b > a ? src.slice(a, b) : '';
}
function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  return end > i ? src.slice(i, end + indent.length + 2) : null;
}
const constLine = (src, name) => { const m = new RegExp('\\n\\s*const ' + name + ' = [^\\n]*').exec(src); return m ? m[0] : ''; };

function loadServer(PATCH, deps) {
  const blk = sentinel(PATCH, 'v162-casual-reclaim');
  if (!blk) return null;
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; }, locals: {} };
  const pre = constLine(PATCH, 'FR_EMAIL_RE') + '\nconst FR_ROOM_SEAT_SLOTS = 2;\nconst FR_ROOM_CAP = 100;\nconst FR_ROOM_STATUSES = ["lobby", "playing"];\n' + grabFn(PATCH, '_frNormEmail');
  const f = new Function('app', 'db', 'tournIdentity', '_frRoomsByEmail', '_frRoomIdxReady', 'console',
    pre + '\n' + blk + '\nreturn { casualReclaimPlan, casualSeatByEmail };');
  const fns = f(app, deps.db, deps.tournIdentity, deps.roomsByEmail, deps.idxReady || (async () => true), { log() {}, warn() {} });
  return { ...fns, routes };
}
async function call(h, req) {
  let out = null, code = 200;
  const res = { status: (c) => { code = c; return res; }, json: (x) => { out = x; return res; } };
  await h(req, res);
  return { code, out };
}
const ME = 'me@x.com';
const seat = (uid, email, extra) => Object.assign({ role: 'p', uid, email, name: uid ? 'N' + uid : null, deckEntries: null, deckId: uid ? 'd' : null, ready: !!uid, firstChoicePreference: 'random' }, extra || {});

async function judgeServer(PATCH) {
  const r = {};
  try {
    // S1 純函式
    const S = loadServer(PATCH, { db: null, tournIdentity: async () => ({}), roomsByEmail: async () => null });
    if (!S) return { S1: false, S2: false, S3: false };
    const P = S.casualReclaimPlan;
    const lobby = { status: 'lobby', hostUid: 'OLD', seats: [seat('OLD', 'Me@X.com'), seat(null, null), seat(null, null)] };
    const a = P(lobby, ME, 'NEW', 1000);
    const ghost = { status: 'lobby', hostUid: 'OLD', seats: [seat('OLD', ME), seat('NEW', null), seat(null, null)] };
    const b = P(ghost, ME, 'NEW', 1000);
    const play = { status: 'playing', hostUid: 'OLD', seats: [seat('OLD', ME), seat('NEW', null)] };
    const c = P(play, ME, 'NEW', 1000);
    const play2 = { status: 'playing', hostUid: 'H', seats: [seat('H', 'h@x.com'), seat('OLD', ME)] };
    const d = P(play2, ME, 'NEW', 1000);
    const left = P({ status: 'lobby', seats: [seat(null, ME), seat('Z', 'z@x.com')] }, ME, 'NEW', 1);
    const spect = P({ status: 'lobby', seats: [seat('A', 'a@x.com'), seat(null, null), seat('OLD', ME)] }, ME, 'NEW', 1);
    const ended = P({ status: 'ended', seats: [seat('OLD', ME)] }, ME, 'NEW', 1);
    const same = P(lobby, ME, 'OLD', 1);
    // Fable 審查 P2-1：對戰中、自己還殘留在觀戰位 ⇒ 清掉觀戰位、認回對戰位（不是 409）
    const specLeft = P({ status: 'playing', hostUid: 'OLD', heartbeats: null, seats: [seat('OLD', ME), seat('Q', 'q@x.com'), seat('NEW', null)] }, ME, 'NEW', 5);
    // Fable 審查 P2-4：心跳整個物件覆寫（null／既有物件都要對）
    const hbKeep = P({ status: 'lobby', hostUid: 'OLD', heartbeats: { 1: 77 }, seats: [seat('OLD', ME), seat('Q', 'q@x.com')] }, ME, 'NEW', 9);
    r.S1 = a.ok && a.changed && a.seatIdx === 0 && a.set.seats[0].uid === 'NEW' && a.set.seats[0].name === 'NOLD' && a.set.seats[0].deckId === 'd'
      && a.set.hostUid === 'NEW' && JSON.stringify(a.set.heartbeats) === '{"0":1000}' && JSON.stringify(a.set.memberUids) === '["NEW"]'
      && !Object.keys(a.set).some((k) => k.indexOf('.') >= 0)
      && specLeft.ok && specLeft.set.seats[0].uid === 'NEW' && specLeft.set.seats[2].uid === null && JSON.stringify(specLeft.set.heartbeats) === '{"0":5}'
      && hbKeep.ok && JSON.stringify(hbKeep.set.heartbeats) === '{"0":9,"1":77}'
      && b.ok && b.set.seats[0].uid === 'NEW' && b.set.seats[1].uid === null && b.set.seats[1].deckId === null && JSON.stringify(b.set.memberUids) === '["NEW"]'
      && !c.ok && c.status === 409
      && d.ok && d.seatIdx === 1 && d.set.seats[1].uid === 'NEW' && !('hostUid' in d.set) && JSON.stringify(d.set.memberUids) === '["H","NEW"]'
      && !left.ok && left.status === 403 && !spect.ok && spect.status === 403 && !ended.ok && ended.status === 409
      && same.ok && !same.changed && Object.keys(same.set).length === 0;
    r.d1 = JSON.stringify({ specLeft: specLeft.ok ? specLeft.set.heartbeats : specLeft.status, hbKeep: hbKeep.ok && hbKeep.set.heartbeats, a: a.ok && a.set.memberUids, b: b.ok, c: c.status, d: d.ok && d.set.memberUids, left: left.status, spect: spect.status, ended: ended.status, same: same.changed });
    // S2 reclaim 端點（假 DB：第一次 CAS 失敗、第二次成功）
    let doc = { _id: 'ABCD', status: 'lobby', hostUid: 'OLD', _version: 7, seats: [seat('OLD', ME), seat(null, null)] };
    const upd = [];
    let failOnce = true;
    const db = { collection: () => ({
      findOne: async (q) => (q._id === doc._id ? JSON.parse(JSON.stringify(doc)) : null),
      updateOne: async (f, u) => {
        upd.push({ f, u });
        if (failOnce) { failOnce = false; doc._version += 1; return { matchedCount: 0 }; }
        if (f._version !== doc._version) return { matchedCount: 0 };
        doc = { ...doc, ...u.$set }; return { matchedCount: 1 };
      },
    }) };
    let ident = { uid: 'F1', email: ME, verified: true };
    const S2 = loadServer(PATCH, { db, tournIdentity: async () => ident, roomsByEmail: async () => null });
    const h = S2.routes['POST /api/my-room/reclaim-seat'];
    ident = { error: 'x', code: 401 };
    const un = await call(h, { body: { roomCode: 'abcd', uid: 'NEW' } });
    ident = { uid: 'F2', email: 'p@x.com', verified: false };   // playerId fallback（未驗證）也不行
    const unv = await call(h, { body: { roomCode: 'abcd', uid: 'NEW' } });
    ident = { uid: 'F1', email: ME, verified: true };
    const okr = await call(h, { body: { roomCode: 'abcd', uid: 'NEW' } });
    const bad = await call(h, { body: { roomCode: 'ab cd', uid: 'NEW' } });
    const nf = await call(h, { body: { roomCode: 'ZZZZ', uid: 'NEW' } });
    const last = upd[upd.length - 1];
    r.S2 = un.code === 401 && unv.code === 401 && okr.code === 200 && okr.out && okr.out.ok === true && okr.out.seatIdx === 0
      && upd.length === 2 && last.f._version === 8 && last.u.$set._version === 9 && doc.seats[0].uid === 'NEW' && doc.hostUid === 'NEW'
      && bad.code === 400 && nf.code === 404;
    r.d2 = JSON.stringify({ un: un.code, unv: unv.code, okr, upd: upd.length, bad: bad.code, nf: nf.code });
    // S3 my-room
    let room = { _id: 'QQQQ', status: 'lobby', seats: [seat('OLD', ME), seat(null, null)] };
    let list3 = [];
    const db3 = { collection: () => ({
      findOne: async (q) => (q._id === room._id ? room : null),
      find: () => ({ limit: () => ({ sort: () => ({ toArray: async () => list3 }) }) }),
    }) };
    let snap = new Map([[ME, 'QQQQ']]);
    const S3 = loadServer(PATCH, { db: db3, tournIdentity: async () => ({ uid: 'F1', email: 'ME@x.com', verified: true }), roomsByEmail: async () => snap });
    const g = S3.routes['GET /api/my-room'];
    const m1 = await call(g, { headers: {} });
    room = { ...room, seats: [seat(null, ME), seat('Z', 'z@x.com')] };
    const m2 = await call(g, { headers: {} });
    // Fable 審查 P2-2：快照指到我已離座的房，但另一間（較舊）我還坐著 ⇒ 要找到那一間
    list3 = [{ _id: 'QQQQ', seats: [seat(null, ME), seat('Z', 'z@x.com')] }, { _id: 'OLDR', seats: [seat('X', 'x@x.com'), seat('ME2', ME)] }];
    const m2b = await call(g, { headers: {} });
    list3 = [];
    snap = null;
    const m3 = await call(g, { headers: {} });
    snap = new Map();
    const m4 = await call(g, { headers: {} });
    r.S3 = m1.out && m1.out.myRoomApi === 1 && m1.out.roomId === 'QQQQ' && m2.out.roomId === null && m2b.out.roomId === 'OLDR'
      && m3.out && m3.out.myRoomApi === 1 && !('roomId' in m3.out) && m4.out.roomId === null;
    r.d3 = JSON.stringify({ m1: m1.out, m2: m2.out, m2b: m2b.out, m3: m3.out, m4: m4.out });
  } catch (e) { r.err = e.message; }
  return r;
}

// ── 玩家端 ──────────────────────────────────────────────────────────────────
function cjs(srcText, stubs, extraGlobals) {
  const code = transformSync(srcText.replace(/import\.meta/g, 'globalThis.__IM'), { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const mod = { exports: {} };
  const req = (id) => { if (!(id in stubs)) throw new Error('未預期的 import：' + id); return stubs[id]; };
  return new Function('module', 'exports', 'require', 'console', 'setTimeout', 'document', code + '\nreturn module.exports;')(
    mod, mod.exports, req, { warn() {}, error() {}, log() {} }, extraGlobals.setTimeout, undefined);
}
const findMySeatIdx = (seats, uid) => { if (!uid) return -1; for (let i = 0; i < seats.length; i++) if (seats[i] && seats[i].uid === uid) return i; return -1; };

async function judgeClient(files) {
  const r = {};
  try {
    // C1／C2／C3：casual-reclaim
    if (!files.cr) { r.C1 = r.C2 = r.C3 = r.C6 = false; }
    else {
      let user = { isAnonymous: false, email: ME, getIdToken: async () => 'TOK' };
      const CR = cjs(files.cr, { '$lib/firebase': { auth: { get currentUser() { return user; } } }, './room': { findMySeatIdx, SEAT_LAYOUT_VERSION: 2 } }, { setTimeout });
      const now = Date.now();
      const raw = [
        { roomId: 'A1', roomName: '我的房（房主關頁 10 分鐘，大廳已藏）', status: 'lobby', schemaVersion: 2, createdAt: now - 20 * 60000, heartbeats: { 0: now - 10 * 60000 }, seats: [{ uid: 'ME' }, { uid: null }] },
        { roomId: 'A2', roomName: '我的私密房', status: 'lobby', schemaVersion: 2, visible: false, seats: [{ uid: 'ME' }, { uid: null }] },
        { roomId: 'A3', roomName: '我在 P2 的對戰', status: 'playing', schemaVersion: 2, spectatorsAllowed: false, seats: [{ uid: 'X' }, { uid: 'ME' }] },
        { roomId: 'B1', roomName: '我只是觀戰', status: 'playing', schemaVersion: 2, seats: [{ uid: 'X' }, { uid: 'Y' }, { uid: 'ME' }] },
        { roomId: 'B2', roomName: '別人的房', status: 'lobby', schemaVersion: 2, seats: [{ uid: 'X' }, { uid: null }] },
        { roomId: 'B3', roomName: '已結束', status: 'ended', schemaVersion: 2, seats: [{ uid: 'ME' }, { uid: 'X' }] },
        { roomId: 'B4', roomName: '舊版', status: 'lobby', schemaVersion: 1, seats: [{ uid: 'ME' }, { uid: null }] },
        { roomId: 'A4', roomName: '現在在的', status: 'lobby', schemaVersion: 2, seats: [{ uid: 'ME' }, { uid: null }] },
      ];
      const mine = CR.myRoomsFromList(raw, 'ME', 'a4');
      r.C1 = mine.map((x) => x.roomId + ':' + x.status + ':' + x.seatIdx + ':' + x.via).join(',') === 'A1:lobby:0:uid,A2:lobby:0:uid,A3:playing:1:uid'
        && mine[0].lastSeenAt === now - 10 * 60000 && mine[1].lastSeenAt === null
        && CR.myRoomsFromList(raw, null).length === 0 && CR.myRoomsFromList(null, 'ME').length === 0;
      const em = { roomId: 'A1', roomName: 'A1', status: null, seatIdx: null, via: 'email' };
      const em2 = { roomId: 'C9', roomName: 'C9', status: null, seatIdx: null, via: 'email' };
      const mg = CR.mergeMyOldRooms(mine, em, null), mg2 = CR.mergeMyOldRooms(mine, em2, null), mg3 = CR.mergeMyOldRooms([], em2, 'c9');
      r.C2 = mg.length === 3 && mg[0].via === 'uid' && mg2.length === 4 && mg2[3].roomId === 'C9' && mg3.length === 0;
      // C6：開新房可以釋放的舊房（Fable 審查 P2-3）
      if (typeof CR.releasableOldRooms !== 'function') r.C6 = false;
      else {
        const T = 1000000, AW = 90000;
        const L = [
          { roomId: 'R1', status: 'lobby', via: 'uid', lastSeenAt: T - 200000 },   // 心跳停了 ⇒ 放
          { roomId: 'R2', status: 'lobby', via: 'uid', lastSeenAt: T - 30000 },    // 還有分頁在用 ⇒ 不放
          { roomId: 'R3', status: 'lobby', via: 'uid', lastSeenAt: null },          // 沒心跳紀錄 ⇒ 放
          { roomId: 'R4', status: 'playing', via: 'uid', lastSeenAt: null },        // 對戰中 ⇒ 不放
          { roomId: 'R5', status: 'lobby', via: 'email', lastSeenAt: null },        // 別的瀏覽器的 ⇒ 不放
          { roomId: 'R6', status: null, via: 'uid', lastSeenAt: null },             // 狀態不明 ⇒ 不放
          { roomId: 'NEWR', status: 'lobby', via: 'uid', lastSeenAt: null },        // 剛開的 ⇒ 不放
        ];
        r.C6 = CR.releasableOldRooms(L, 'newr', T, AW).map((x) => x.roomId).join(',') === 'R1,R3';
      }
      // C3：fetch
      globalThis.__IM = { env: { VITE_ORACLE_API_URL: 'https://api.x' } };
      const calls = [];
      const fk = (resp) => async (url, init) => { calls.push({ url, init }); return resp; };
      const jr = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
      const f1 = await CR.fetchMyCasualRoom(fk(jr(200, { myRoomApi: 1, roomId: 'abcd' })));
      const f2 = await CR.fetchMyCasualRoom(fk(jr(200, { myRoomApi: 1, roomId: null })));
      const f3 = await CR.fetchMyCasualRoom(fk(jr(200, { myRoomApi: 1 })));
      const f4 = await CR.fetchMyCasualRoom(fk(jr(404, { error: 'x' })));
      const nCalls = calls.length;
      user = { isAnonymous: true, email: null, getIdToken: async () => 'T' };
      const f5 = await CR.fetchMyCasualRoom(fk(jr(200, { myRoomApi: 1, roomId: 'X' })));
      const anonNoCall = calls.length === nCalls;
      user = { isAnonymous: false, email: ME, getIdToken: async () => 'TOK' };
      const rc1 = await CR.reclaimCasualSeat('abcd', 'NEW', fk(jr(200, { myRoomApi: 1, ok: true, seatIdx: 1 })));
      const rcCall = calls[calls.length - 1];
      const rc2 = await CR.reclaimCasualSeat('abcd', 'NEW', fk(jr(403, { error: '這間房沒有你的座位' })));
      r.C3 = f1 === 'ABCD' && f2 === null && f3 === undefined && f4 === undefined && f5 === undefined && anonNoCall
        && calls[0].url === 'https://api.x/api/my-room' && calls[0].init.headers.Authorization === 'Bearer TOK'
        && rc1.ok && rc1.seatIdx === 1 && rcCall.url === 'https://api.x/api/my-room/reclaim-seat' && rcCall.init.method === 'POST'
        && JSON.parse(rcCall.init.body).roomCode === 'ABCD' && JSON.parse(rcCall.init.body).uid === 'NEW'
        && !rc2.ok && rc2.error === '這間房沒有你的座位';
      r.d3 = JSON.stringify({ f1, f2, f3, f4, f5, anonNoCall, rc1, rc2 });
    }
    // C4：room-oracle
    {
      const server = { doc: null };
      const UNCH = Symbol('u'), UNSUP = Symbol('c');
      let me = 'ME';
      const listRooms = [
        { _id: 'A1', status: 'lobby', schemaVersion: 2, createdAt: 0, heartbeats: { 0: 0 }, seats: [{ uid: 'ME' }, { uid: null }] },
        { _id: 'B2', status: 'lobby', schemaVersion: 2, createdAt: Date.now(), seats: [{ uid: 'X' }, { uid: null }] },
      ];
      const RO = cjs(files.ro, {
        './oracle-client': {
          oracleAuth: async () => ({ uid: me }), oracleApi: async () => ({}),
          oracleGetRoom: async () => (server.doc ? JSON.parse(JSON.stringify(server.doc)) : null),
          oracleUpsertRoom: async (c, d) => { server.doc = { ...d, _version: (server.doc._version || 0) + 1 }; return { ok: true, version: server.doc._version, room: server.doc }; },
          oracleDeleteRoom: async () => {}, oracleListRooms: async () => [], oraclePollRoom: () => () => {}, oracleListMessages: async () => [],
          oracleCurrentUid: () => me, oracleListRoomsCombined: async () => ({ rooms: listRooms, h: 'h1' }),
          ROOMS_UNCHANGED: UNCH, ROOMS_COMBINED_UNSUPPORTED: UNSUP,
          isOracleTimeout: () => false, isOracleUploadBudgetTimeout: () => false, ORACLE_SIDEEFFECT_TIMEOUT_MS: 60000,
          deltaPutBase: () => null, oracleUpsertRoomDelta: async () => { throw new Error('no'); },
        },
        '$lib/firebase': { auth: { currentUser: null } },
        './engine': { createGame: () => ({}) },
        './sync-guards': { shouldSkipStalePush: () => false, mergeForSetupPush: (a) => a },
        '$lib/ui/stale-keep': { adoptOrKeep: (p, n) => ({ data: n ?? p, stale: n == null }) },
        './room': {
          SEAT_LAYOUT_VERSION: 2, TOTAL_SEATS: 10, SPECTATOR_SEATS: 8, HEARTBEAT_STALE_MS: 1,
          generateRoomCode: () => 'AAAA', findMySeatIdx, countDeckCards: () => 60, bothPlayersReady: () => true, isSeatStale: () => false,
          LOBBY_HOST_AWAY_MS: 1, LOBBY_HOST_STALE_MS: 1, hostPresence: () => 'online',
          isLobbyHostDead: (rm) => rm._id === 'A1' || rm.roomId === 'A1', isLobbyTooOld: () => false,
        },
      }, { setTimeout: () => 0 });
      // 大廳輪詢：callback 第二個參數＝未過濾（含被藏起來的 A1）
      const got = await new Promise((resolve) => {
        const off = RO.subscribeOpenRooms((rooms, raw) => { off(); resolve({ rooms, raw }); });
        setTimeout(() => resolve(null), 500);
      });
      const pollOk = !!got && got.rooms.map((x) => x.roomId).join(',') === 'B2' && Array.isArray(got.raw)
        && got.raw.map((x) => x.roomId).join(',') === 'A1,B2';
      // joinRoom：對戰中、未開放觀戰 —— 自己的座位 ⇒ 進得去；別人 ⇒ 仍擋
      server.doc = { _version: 3, status: 'playing', schemaVersion: 2, spectatorsAllowed: false, seats: [{ uid: 'X', name: 'x' }, { uid: 'ME', name: 'm' }, { uid: null }], memberUids: ['X', 'ME'] };
      let joinMine = null, joinMineErr = null;
      try { joinMine = await RO.joinRoom('qq', '我'); } catch (e) { joinMineErr = e.message; }
      me = 'OTHER';
      let joinOther = null;
      try { await RO.joinRoom('qq', '他'); } catch (e) { joinOther = e.message; }
      // releaseLobbySeat：等待中 ⇒ 清掉我的座位；已經開打 ⇒ 一個字都不寫（不可以變成投降）
      let relLobby = false, relPlay = null, playDocAfter = null;
      if (typeof RO.releaseLobbySeat === 'function') {
        me = 'ME';
        server.doc = { _version: 1, status: 'lobby', schemaVersion: 2, seats: [{ uid: 'ME', name: 'm' }, { uid: 'X', name: 'x' }], memberUids: ['ME', 'X'] };
        relLobby = (await RO.releaseLobbySeat('qq')) === true && server.doc.seats[0].uid === null && JSON.stringify(server.doc.memberUids) === '["X"]';
        server.doc = { _version: 4, status: 'playing', schemaVersion: 2, seats: [{ uid: 'ME', name: 'm' }, { uid: 'X', name: 'x' }], memberUids: ['ME', 'X'], gameState: { phase: 'main' } };
        const before = JSON.stringify(server.doc);
        relPlay = await RO.releaseLobbySeat('qq');
        playDocAfter = JSON.stringify(server.doc) === before;
      }
      r.C4 = relLobby && relPlay === false && playDocAfter === true && pollOk && !joinMineErr && !!joinMine && findMySeatIdx(joinMine.seats, 'ME') === 1 && joinOther === '此房對戰中未開放觀戰';
      r.d4 = JSON.stringify({ relLobby, relPlay, playDocAfter, pollOk, got: got && { rooms: got.rooms.map((x) => x.roomId), raw: got.raw && got.raw.map((x) => x.roomId) }, joinMineErr, joinOther });
    }
    // C5：頁面
    {
      const P = files.page;
      const fnBody = (name) => {
        const i = P.indexOf('function ' + name + '(');
        if (i < 0) return null;
        let d = 0, j = P.indexOf('{', P.indexOf(')', i));
        for (; j < P.length; j++) { if (P[j] === '{') d++; else if (P[j] === '}') { d--; if (d === 0) break; } }
        const st = P.slice(Math.max(0, i - 6), i) === 'async ' ? i - 6 : i;   // 連前面的 async 一起抽
        return P.slice(st, j + 1);
      };
      const ret = fnBody('handleReturnToOldRoom'), rel = fnBody('releaseOldLobbyRooms');
      let c5 = false, d5 = '';
      if (ret && rel) {
        const h = new Function('reclaimCasualSeat', 'oracleAuth', 'releaseLobbySeat', 'handleJoinRoom', 'ctx',
          'const releasableOldRooms = ctx.releasableOldRooms, LOBBY_HOST_AWAY_MS = 90000;\n'
          + 'let onlineLoading = false, onlineError = "", myUid = ctx.myUid, myName = { trim: () => "我" }, joinInput = "", myOldRoomsByUid = [1], myEmailOldRoom = { x: 1 };\n'
          + transformSync(ret + '\n' + rel, { loader: 'ts', target: 'node18' }).code + '\n'
          + 'return { ret: handleReturnToOldRoom, rel: releaseOldLobbyRooms, st: () => ({ onlineError, joinInput, myOldRoomsByUid, myEmailOldRoom }) };');
        const log = [];
        let reclaimOk = true;
        const mk = () => h(async (code, uid) => { log.push('reclaim ' + code + ' ' + uid); return reclaimOk ? { ok: true, seatIdx: 0 } : { ok: false, error: '不行' }; },
          async () => ({ uid: 'AU' }), async (code) => { log.push('release ' + code); return true; }, async () => { log.push('join'); },
          { myUid: 'U9', releasableOldRooms: (list, nc) => list.filter((x) => x.via === 'uid' && x.status === 'lobby' && x.roomId !== nc && x.lastSeenAt === null) });
        const A = mk();
        await A.ret({ roomId: 'E1', via: 'email', status: null });
        const s1 = A.st();
        reclaimOk = false;
        const B = mk();
        await B.ret({ roomId: 'E2', via: 'email', status: null });
        const s2 = B.st();
        const C = mk();
        await C.ret({ roomId: 'U1', via: 'uid', status: 'lobby' });
        reclaimOk = true;
        const D = mk();
        D.rel([{ roomId: 'L1', via: 'uid', status: 'lobby', lastSeenAt: null }, { roomId: 'P1', via: 'uid', status: 'playing', lastSeenAt: null },
          { roomId: 'N1', via: 'email', status: null, lastSeenAt: null }, { roomId: 'L2', via: 'email', status: 'lobby', lastSeenAt: null },
          { roomId: 'L3', via: 'uid', status: 'lobby', lastSeenAt: 1 }, { roomId: 'NEW', via: 'uid', status: 'lobby', lastSeenAt: null }], 'NEW');
        await new Promise((res) => setTimeout(res, 20));
        const s4 = D.st();
        const L = log.join('|');
        c5 = L === 'reclaim E1 U9|join|reclaim E2 U9|join|release L1'
          && s1.joinInput === 'E1' && s2.onlineError === '不行' && s2.joinInput === '' && s4.myOldRoomsByUid.length === 0 && s4.myEmailOldRoom === null;
        d5 = L;
      }
      const wire = /\(rooms, raw\) => \{[\s\S]{0,400}myOldRoomsByUid = myRoomsFromList\(raw, myUid\)/.test(P)
        && /roomCode = await createRoom\([^\n]*\);\n\s*releaseOldLobbyRooms\(_oldRooms, roomCode\);/.test(P)
        && /\{#if myOldRooms\.length > 0\}[\s\S]{0,900}onclick=\{\(\) => handleReturnToOldRoom\(r\)\}/.test(P)
        && /amIHost = !!myUid && findMySeatIdx\(_joined\?\.seats \?\? \[\], myUid\) === 0;/.test(P)
        // Fable 審查 P1-1：進房前（列表、手輸房號、回到房間都走這裡）伺服器說是我 email 的房 ⇒ 先認座位
        && /if \(myEmailOldRoom && myEmailOldRoom\.roomId === _code\) \{\n\s*const _uid = myUid \|\| \(await oracleAuth\(\)\)\.uid;\n\s*await reclaimCasualSeat\(_code, _uid\)\.catch\(\(\) => null\);\n\s*\}\n\s*const _joined = await joinRoom\(/.test(P)
        && /releasableOldRooms\(list, newCode, Date\.now\(\), LOBBY_HOST_AWAY_MS\)/.test(P);
      r.C5 = c5 && wire;
      r.d5 = JSON.stringify({ c5, wire, d5 });
    }
  } catch (e) { r.err = e.message + ' ' + (e.stack || '').split('\n')[1]; }
  return r;
}

const PATCH = rd('oracle-admin/server_admin_patch.js');
const FILES = { cr: (() => { try { return rd('src/lib/game/casual-reclaim.ts'); } catch { return null; } })(), ro: rd('src/lib/game/room-oracle.ts'), page: rd('src/routes/game/+page.svelte') };
const HS = await judgeServer(PATCH);
const HC = await judgeClient(FILES);
if (HS.err) console.log('伺服器實跑錯誤：' + HS.err);
if (HC.err) console.log('玩家端實跑錯誤：' + HC.err);
console.log('【S】伺服器 v1.62');
ok('★★★[S1] 認回座位的規則：email 相同且有人坐的 p1／p2 才行；殘留的自己 lobby 清掉、對戰中拒絕；離座／觀戰／已結束拒絕；同 uid 不寫', !!HS.S1, HS.d1);
ok('★★★[S2] reclaim-seat：未登入或未驗證 401；_version CAS 衝突會重試；房號格式 400、找不到 404', !!HS.S2, HS.d2);
ok('★★★[S3] my-room：快照有房號還要確認座位仍有人坐；快照答不出來不帶 roomId', !!HS.S3, HS.d3);
console.log('【C】玩家端');
ok('★★★[C1] 自己的房不套大廳的死房／過久／私密房過濾；只認 p1／p2；排除已結束、別人的、舊版、現在在的那間', !!HC.C1);
ok('★★[C2] 合併兩個來源：同一間以 uid 來源為準；現在在的那間不列', !!HC.C2);
ok('★★★[C6] 開新房只釋放：同瀏覽器、等待中、心跳停超過門檻的舊房（還在用的、對戰中、狀態不明、別的瀏覽器的都不動）', !!HC.C6);
ok('★★★[C3] 伺服器呼叫：帶 Bearer、匿名一發都不送、舊伺服器／錯誤回 undefined、認回座位送房號與 uid', !!HC.C3, HC.d3);
ok('★★★[C4] room-oracle：大廳輪詢第二個參數是未過濾原始列表；回到自己的對戰中房不受「未開放觀戰」限制，別人仍擋；releaseLobbySeat 只在等待中動', !!HC.C4, HC.d4);
ok('★★★[C5] 頁面：email 來源先認座位（失敗不進房）；進房前認座位；開新房走中央判準與 releaseLobbySeat；接線都在', !!HC.C5, HC.d5);

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const b = (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? x.out.replace(/\r\n/g, '\n') : null; };
  const BP = b('oracle-admin/server_admin_patch.js'), BRO = b('src/lib/game/room-oracle.ts'), BPG = b('src/routes/game/+page.svelte');
  if (BP && BRO && BPG) {
    const BS = await judgeServer(BP);
    const BC = await judgeClient({ cr: null, ro: BRO, page: BPG });
    ok('★★★[H1] BASE：S1～S3、C1～C6 逐條紅', !BS.S1 && !BS.S2 && !BS.S3 && !BC.C1 && !BC.C2 && !BC.C3 && !BC.C4 && !BC.C5 && !BC.C6,
      JSON.stringify({ S1: BS.S1, S2: BS.S2, S3: BS.S3, C1: BC.C1, C2: BC.C2, C3: BC.C3, C4: BC.C4, C5: BC.C5, C6: BC.C6, err: BC.err }));
  } else shallowSkip('v6525 H', '讀不到 BASE blob');
} else shallowSkip('v6525 H', '需要 09c0234e commit');

console.log(`\n=== v6.525／server v1.62 回到我之前的房間：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
