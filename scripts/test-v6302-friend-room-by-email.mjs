// v6.302 守衛：好友清單多回 `roomId`（伺服器用 **email** 比對「這位好友此刻在哪一間休閒房」）
//
// 站長實測回報：好友明明在一般休閒對戰中，好友列的【🚪 加入房間】鈕卻是暗的、按不下去。
// 真因（本守衛的 A0 就是釘這個修法在不在）：v6.301 靠 `playerIdentity` 的 uid 在**瀏覽器端**比對，
// 而那個 uid 只有「一場對局結束」才會被寫入、又是 Oracle 匿名 JWT 的 per-瀏覽器 uid（會漂移）。
//
// 守什麼（server 端全部用 scripts/lib/friends-harness-v6282.mjs 把 FRIENDS 區塊抽出來**實跑**）：
//   【A】抽取器下限 ＋ 錦標賽區塊兩把既有 sha256（逐位元不可動）。
//   【B】語義：lobby／playing 房 ⇒ 正確 roomId；不在 ⇒ null；只看 p1／p2；ended 不算；
//        email 大小寫／空白正規化；⚠ 非 accepted 的關係**完全不帶**這個欄位。
//   【C】⭐⭐ N+1：100 好友 ⇒ rooms 查詢**恰 1 次**（10 人與 100 人數字相同）；
//        5 秒共用快照 ＋ in-flight 合併（併發三發仍 1 次）；projection 絕不含 gameState。
//   【D】⭐ 索引自驗：缺 &#123;status:1,updatedAt:-1&#125; ⇒ rooms **零查詢**，且回應**沒有 roomId 這個 key**
//        （⚠ 不是 null —— 那是「伺服器答不出來」，client 要退回 uid 比對）。
//   【E】隱私：回應零 email（含半個）、零房名、零房主；正對照證明掃描器抓得到。
//   【F】讓路：100 房 × 2 座位 ＝ 200 ⇒ 讓路節拍剛好多一次（拿掉就 0）。
//   【G】client 純函式（esbuild 轉譯 friend-rooms.ts **實跑**）：roomId 優先、
//        ⭐⭐ null 不退回 uid、欄位缺席才退回 uid、找不到房就灰掉。
//   【H】client friends-api 的 `toRow` **保留「欄位不存在 vs null」的差別**。
//   【I】client 零新請求：friend-rooms.ts 零 fetch／零 timer ＋ 200 tick 行為端計數。
//   【J】行為端 DOM（playwright）：三種 roomId 情境各自渲染成什麼。
//   【K】突變測試（沒紅 ＝ 守衛是安慰劑）。
//   【L】test chain ／ 版本一致 ／ 本守衛不 pin 死版本號。
//
// ⚠ 紀律：只捕 AssertionError；突變體必須紅在**預期那一條**；除了兩把「不得改動」的錦標賽鎖之外不 pin 任何 sha／版本號。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  readPatch, extractBlock, FR_START, FR_END,
  buildFriends, asUser, findEmails,
} from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readPatch(join(ROOT, 'oracle-admin/server_admin_patch.js'));
const P_FR = join(ROOT, 'src/lib/friends/friend-rooms.ts');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_CTX = join(ROOT, 'src/lib/friends/auth-ctx.ts');
const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const FR_TS = readFileSync(P_FR, 'utf8');
const API_TS = readFileSync(P_API, 'utf8');
const FRP = readFileSync(P_FRP, 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const VERTS = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const PKG = readFileSync(join(ROOT, 'package.json'), 'utf8');

let pass = 0, fail = 0;
const skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 700)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag),
    '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 300) + '（預期含「' + expectFrag + '」）');
};
const mutate = (src, a, b) => {
  const n = src.split(a).length - 1;
  assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90));
  return src.replace(a, b, 1);
};

// ── 共用假資料 ───────────────────────────────────────────────────────────────
const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'uB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'uC', email: 'carol@example.com', name: '卡蘿' },
  D: { uid: 'uD', email: 'dave@example.com', name: '大衛' },
  E: { uid: 'uE', email: 'erin@example.com', name: '艾琳' },
};
// 哨兵：只存在於 DB 的房間 doc，**任何回應都不該出現**（房名／房主／盤面）
const S_ROOMNAME = 'ZQXROOMNAME';
const S_HOSTNAME = 'ZQXHOSTNAME';
const S_GAMESTATE = 'ZQXGAMESTATE';
function frHash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x7fffffff;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= (c * 31 + i) & 0xffff; h2 = Math.imul(h2, 0x01000193) >>> 0; }
  const h3 = Math.imul(h1 ^ h2, 0x9e3779b1) >>> 0;
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0')).slice(0, 24);
}
const mkRow = (e1, e2, status) => {
  const [a, b] = e1 < e2 ? [e1, e2] : [e2, e1]; const _id = a + '|' + b;
  return { _id, fid: frHash(_id), a, b, status: status || 'accepted', requester: a, blockedBy: status === 'blocked' ? e1 : null, nickA: '快照A', nickB: '快照B', addedVia: 'battle', createdAt: 1, updatedAt: 1 };
};
const mkRoom = (id, status, emails, at) => ({
  _id: id, status, updatedAt: at === undefined ? 100 : at,
  roomName: S_ROOMNAME + '-' + id, hostName: S_HOSTNAME + '-' + id,
  seats: emails.map((e) => ({ uid: e ? 'uid_' + e : null, email: e })),
  gameState: { log: [S_GAMESTATE, S_GAMESTATE, S_GAMESTATE] },
});
const CFG = { _id: 'friendsConfig', enabled: true, dm: true };
// ⚠ 三支錦標賽索引與 rooms 那一支**全部都是既有的**，本版一支都沒有新增。
const ROOM_IDX = { status: 1, updatedAt: -1 };
const FULL_IDX = {
  rooms: [ROOM_IDX],
  tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }],
  tournamentEvents: [{ status: 1 }],
  tournamentMatches: [{ eventId: 1, status: 1 }],
};
const NO_ROOM_IDX = {
  rooms: [{ someOther: 1 }],
  tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }],
  tournamentEvents: [{ status: 1 }],
  tournamentMatches: [{ eventId: 1, status: 1 }],
};
const seedOf = (o) => Object.assign({ tournamentConfig: [structuredClone(CFG)] }, o || {});
const roomFinds = (db) => db._log.filter((l) => l.name === 'rooms' && l.op === 'find');
const list = (H, who) => H.call('get', '/api/friends/list', asUser(who || U.A));
const byNick = (body, fidOwner) => body.friends.find((f) => f.fid === frHash([U.A.email, fidOwner].sort().join('|')));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】抽取器下限 ＋ 錦標賽區塊 sha256（HEAD-FAIL 錨點）');
let FR = '';
await T('A0 ⭐⭐⭐ HEAD-FAIL 錨點：FRIENDS 區塊有 _frRoomIdxReady／_frRoomScan／_frRoomsByEmail ＋ list 會寫 p.roomId（BASE v6.301 全都沒有 ⇒ 必紅）', () => {
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  assert.ok(FR.includes('async function _frRoomIdxReady('), 'HEAD-FAIL：沒有 rooms 索引自驗 _frRoomIdxReady');
  assert.ok(FR.includes('async function _frRoomScan('), 'HEAD-FAIL：沒有 _frRoomScan');
  assert.ok(FR.includes('async function _frRoomsByEmail('), 'HEAD-FAIL：沒有 _frRoomsByEmail（5 秒共用快照）');
  assert.ok(/p\.roomId = /.test(FR), 'HEAD-FAIL：list 沒有寫 p.roomId');
  assert.ok(FR.includes('const rmap = await _frRoomsByEmail(me.yield);'), 'HEAD-FAIL：list 沒有取房間快照');
});
if (!FR || !FR.includes('async function _frRoomsByEmail(')) {
  console.log('\n══ v6.302 守衛：' + pass + ' PASS / ' + (fail || 1) + ' FAIL（HEAD-FAIL：本版伺服器端改動不在，後續無法進行）══');
  process.exit(1);
}
const TOURN_TAIL_SHA256 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';   // 與 test-v6272 ⑨ 同一把
const TOURN_ANCHOR_SHA256 = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40'; // 與 test-v6278 I1 同一把
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256）；好友區塊整段仍在第一支 /api/tournament 之前', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");
  assert.ok(first > 0, '找不到第一支 /api/tournament 端點');
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(FR_END) < first, '好友區塊必須整段在錦標賽區塊之前');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗：多一個空白就該不同');
});
await T('A2 ⚠ 用字面而不是引用外層常數（會 TDZ）；本版**零** createIndex 新增；沿用大廳列表端點的同一條查詢形狀', () => {
  assert.ok(FR.includes("const FR_ROOM_COLL = 'rooms';"), '沒有用字面宣告 rooms');
  assert.ok(FR.includes("const FR_ROOM_STATUSES = ['lobby', 'playing'];"), '狀態清單與大廳列表端點不一致');
  assert.ok(PATCH.includes("find({ status: { $in: ['lobby', 'playing'] } }, { projection: { 'seats.deckEntries': 0, gameState: 0 } })"),
    '⚠ 大廳列表端點（_roomsCombinedMw）的查詢形狀變了 ⇒ 本版「沿用同一條路徑」的前提要重新查證');
  const ci = FR.split('\n').filter((l) => l.includes('createIndex('));
  assert.strictEqual(ci.length, 3, '本版不該增減 createIndex 呼叫，實得 ' + ci.length + ' 行');
  // ⚠ 只認「對 rooms 這張表建索引」這一種違規；friendships／TREGS 那 3 支既有的照舊。
  assert.ok(!ci.some((l) => /FR_ROOM_COLL|'rooms'/.test(l)), '本版不該自己建 rooms 索引（那是 v6.240 建的既有索引）：' + ci.join(' | ').slice(0, 200));
  assert.ok(FR.includes('const FR_ROOM_IDX_KEY = ') && FR.includes('_frRoomIdxReady'), '沒有 rooms 索引自驗 ⇒ 可能會 COLLSCAN');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】語義：lobby／playing ⇒ 正確 roomId；不在 ⇒ null；非 accepted 不帶欄位');
const semSeed = () => seedOf({
  friendships: [
    mkRow(U.A.email, U.B.email, 'accepted'),   // B：在 lobby 房 RMLOB
    mkRow(U.A.email, U.C.email, 'accepted'),   // C：在 playing 房 RMPLAY
    mkRow(U.A.email, U.D.email, 'accepted'),   // D：坐在 RMPLAY 的**觀戰位**（座位 2）
    mkRow(U.A.email, U.E.email, 'pending'),    // E：待確認 ⇒ 完全不帶欄位
  ],
  rooms: [
    mkRoom('RMLOB', 'lobby', ['  BOB@Example.COM  ', null], 300),
    mkRoom('RMPLAY', 'playing', ['someone@example.com', U.C.email, U.D.email], 200),
    mkRoom('RMEND', 'ended', [U.E.email, U.D.email], 400),
  ],
});
await T('B1 ⭐⭐⭐ 好友在 **lobby** 房 ⇒ 回那間房的房號（⚠ email 前後空白＋大小寫不同仍要對得上）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  assert.strictEqual(r.code, 200, 'HTTP ' + r.code);
  assert.strictEqual(byNick(r.body, U.B.email).roomId, 'RMLOB', '好友在 lobby 房卻沒回房號');
});
await T('B2 ⭐⭐⭐ 好友在 **playing** 房（p2 座位）⇒ 回那間房的房號', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  assert.strictEqual(byNick(r.body, U.C.email).roomId, 'RMPLAY', '好友在 playing 房卻沒回房號');
});
await T('B3 ⭐⭐ 好友坐在**觀戰位**（座位 2）⇒ 不算「他在這間房」；ended 房也不算 ⇒ roomId 是 **null**（欄位要在）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  const d = byNick(r.body, U.D.email);
  assert.ok('roomId' in d, '欄位不見了 —— 那會讓 client 誤以為「伺服器答不出來」而退回 uid 比對');
  assert.strictEqual(d.roomId, null, '觀戰位／ended 房竟然被算成「他在這間房」：' + d.roomId);
});
await T('B4 ⭐⭐ 非 accepted（待確認／送出中／封鎖）⇒ **完全不帶** roomId 欄位（維持既有可見度規則）', async () => {
  const s = semSeed();
  s.friendships.push(mkRow(U.A.email, 'zoe@example.com', 'blocked'));
  s.rooms.push(mkRoom('RMZOE', 'lobby', ['zoe@example.com', U.E.email], 500));
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  const others = [].concat(r.body.incoming, r.body.outgoing, r.body.blocked);
  assert.ok(others.length >= 2, '假資料不對，只有 ' + others.length + ' 筆非 accepted');
  for (const p of others) assert.ok(!('roomId' in p), '非 accepted 的關係竟然帶了 roomId：' + JSON.stringify(p).slice(0, 160));
});
await T('B5 ⭐ 同一個人同時出現在兩間房 ⇒ 取 updatedAt 最新的那一間（先到先得，行為穩定不抖動）', async () => {
  const s = seedOf({
    friendships: [mkRow(U.A.email, U.B.email, 'accepted')],
    rooms: [mkRoom('OLD', 'lobby', [U.B.email, null], 10), mkRoom('NEW', 'lobby', [U.B.email, null], 999)],
  });
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  assert.strictEqual(byNick(r.body, U.B.email).roomId, 'NEW', '沒有取最近有活動的那一間');
});
await T('B6 ⭐ 髒資料不得爆掉：房間沒有 seats／seats 有 null／email 不合格 ⇒ 200 且 roomId 為 null', async () => {
  const s = seedOf({
    friendships: [mkRow(U.A.email, U.B.email, 'accepted')],
    rooms: [
      { _id: 'BAD1', status: 'lobby', updatedAt: 5 },
      { _id: 'BAD2', status: 'lobby', updatedAt: 4, seats: [null, undefined] },
      { _id: 'BAD3', status: 'lobby', updatedAt: 3, seats: [{ uid: 'x', email: 'not-an-email' }, { uid: 'y', email: 12345 }] },
    ],
  });
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  assert.strictEqual(r.code, 200, 'HTTP ' + r.code);
  assert.strictEqual(byNick(r.body, U.B.email).roomId, null, 'roomId=' + byNick(r.body, U.B.email).roomId);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】N+1 防護 ＋ 5 秒共用快照 ＋ in-flight 合併');
function manyFriends(n, inRooms) {
  const friendships = [], rooms = [];
  for (let i = 0; i < n; i++) {
    const e = 'friend' + String(i).padStart(3, '0') + '@example.com';
    friendships.push(mkRow(U.A.email, e, 'accepted'));
    if (i < inRooms) rooms.push(mkRoom('R' + i, i % 2 ? 'playing' : 'lobby', [e, 'x' + i + '@example.com'], 1000 - i));
  }
  return seedOf({ friendships, rooms });
}
await T('C1 ⭐⭐⭐ **100 個好友 ⇒ rooms 查詢恰 1 次**（固定一發，與好友人數完全無關）', async () => {
  const H = buildFriends(FR, { seed: manyFriends(100, 40), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  assert.strictEqual(r.body.friends.length, 100, '好友數不對：' + r.body.friends.length);
  assert.strictEqual(r.body.friends.filter((f) => f.roomId).length, 40, '配對到房間的人數不對：' + r.body.friends.filter((f) => f.roomId).length);
  assert.strictEqual(roomFinds(H.db).length, 1, '⚠⚠ N+1！rooms 查詢了 ' + roomFinds(H.db).length + ' 次');
  console.log('        100 好友 / 40 人在房 ⇒ rooms find = ' + roomFinds(H.db).length + ' 次');
});
await T('C2 ⭐⭐ 10 個好友與 100 個好友的 rooms 查詢次數**完全相同**（正對照：證明 C1 不是碰巧）', async () => {
  const H10 = buildFriends(FR, { seed: manyFriends(10, 5), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  await list(H10);
  const H100 = buildFriends(FR, { seed: manyFriends(100, 40), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  await list(H100);
  assert.strictEqual(roomFinds(H10.db).length, roomFinds(H100.db).length,
    '10 人 ' + roomFinds(H10.db).length + ' 次 vs 100 人 ' + roomFinds(H100.db).length + ' 次 ⇒ 與好友人數有關 ＝ N+1');
});
await T('C3 ⭐⭐ **併發**三發 list（同一輪事件迴圈一起發）⇒ rooms 仍**恰 1 次**（in-flight 合併）', async () => {
  const H = buildFriends(FR, { seed: manyFriends(100, 40), dbOpts: { indexes: FULL_IDX, noAutoIndex: true, ioDelay: true } });
  const rs = await Promise.all([list(H), list(H), list(H)]);
  for (const r of rs) assert.strictEqual(r.code, 200, 'HTTP ' + r.code);
  for (const r of rs) assert.strictEqual(r.body.friends.filter((f) => f.roomId).length, 40, '併發時有一發的結果不對');
  assert.strictEqual(roomFinds(H.db).length, 1, '併發三發竟然查了 ' + roomFinds(H.db).length + ' 次 ⇒ in-flight 沒有合併');
});
await T('C4 ⭐ 連續三發（5 秒內）⇒ rooms 仍恰 1 次（共用快照）', async () => {
  const H = buildFriends(FR, { seed: manyFriends(50, 20), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  await list(H); await list(H); await list(H);
  assert.strictEqual(roomFinds(H.db).length, 1, '5 秒內三發竟然查了 ' + roomFinds(H.db).length + ' 次');
});
await T('C5 ⭐⭐ projection **只取 _id 與 seats.email**，絕不撈 gameState（房間 doc 的大宗）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  await list(H);
  const f = roomFinds(H.db)[0];
  assert.ok(f && f.opt && f.opt.projection, 'rooms 查詢沒有 projection ⇒ 會把整包 gameState 讀進 node');
  assert.deepStrictEqual(Object.keys(f.opt.projection).sort(), ['_id', 'seats.email'],
    'projection 欄位不對：' + JSON.stringify(f.opt.projection));
  assert.ok(!('gameState' in f.opt.projection), 'projection 竟然提到 gameState');
  assert.deepStrictEqual(f.q, { status: { $in: ['lobby', 'playing'] } }, '查詢條件與大廳列表端點不一致：' + JSON.stringify(f.q));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】索引自驗：缺索引 ⇒ 零查詢，而且是「欄位缺席」不是 null');
await T('D1 ⭐⭐⭐ 缺 rooms {status:1,updatedAt:-1} 索引 ⇒ rooms **零查詢**（絕不 COLLSCAN）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: NO_ROOM_IDX, noAutoIndex: true } });
  const r = await list(H);
  assert.strictEqual(r.code, 200, 'HTTP ' + r.code);
  assert.strictEqual(roomFinds(H.db).length, 0, '沒有索引卻查了 ' + roomFinds(H.db).length + ' 次 rooms ⇒ COLLSCAN');
});
await T('D2 ⭐⭐⭐ 缺索引 ⇒ 每一筆好友**都沒有 roomId 這個 key**（⚠ 不是 null！null 會讓 client 直接灰掉，欄位缺席才會退回 uid 比對）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: NO_ROOM_IDX, noAutoIndex: true } });
  const r = await list(H);
  for (const p of r.body.friends) assert.ok(!('roomId' in p), '缺索引時竟然帶了 roomId 欄位（值＝' + p.roomId + '）');
  // 正對照：有索引時同一批人是有 key 的 ⇒ 證明 D2 不是「本來就沒人有 key」
  const H2 = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r2 = await list(H2);
  assert.ok(r2.body.friends.every((p) => 'roomId' in p), '正對照失敗：有索引時也沒有 roomId 欄位 ⇒ D2 是安慰劑');
});
await T('D3 ⭐ 索引自驗失敗會退避（不是每一發都去問 indexes()）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: NO_ROOM_IDX, noAutoIndex: true } });
  await list(H); await list(H); await list(H);
  const n = H.db._log.filter((l) => l.name === 'rooms' && l.op === 'indexes').length;
  assert.strictEqual(n, 1, '三發 list 竟然問了 ' + n + ' 次 rooms.indexes()（應該只有第一次）');
});
await T('D4 ⭐ rooms 查詢丟例外 ⇒ 200 且欄位缺席（fail-graceful，絕不 500）', async () => {
  const H = buildFriends(FR, {
    seed: semSeed(),
    dbOpts: { indexes: FULL_IDX, noAutoIndex: true, throwOn: (n, op) => n === 'rooms' && op === 'find' },
  });
  const r = await list(H);
  assert.strictEqual(r.code, 200, 'rooms 查詢炸掉竟然讓整支 list 變成 HTTP ' + r.code);
  for (const p of r.body.friends) assert.ok(!('roomId' in p), '查詢炸掉時不該寫 roomId 欄位');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】隱私：只多一個房號字串');
await T('E1 ⭐⭐⭐ 回應**零 email**（含半個 email）—— 假資料裡到處都是 email', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  const hits = findEmails(r.body);
  assert.deepStrictEqual(hits, [], '回應裡出現 email：' + hits.join(', '));
  const s = JSON.stringify(r.body);
  for (const frag of ['alice', 'bob', 'carol', 'dave', 'example.com']) {
    assert.ok(!s.includes(frag), '回應裡出現半個 email 片段「' + frag + '」');
  }
});
await T('E2 ⭐⭐⭐ 回應**零房名／零房主／零盤面**（房名房主一律由 client 從自己的 openRooms 取）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  const s = JSON.stringify(r.body);
  for (const sen of [S_ROOMNAME, S_HOSTNAME, S_GAMESTATE]) {
    assert.ok(!s.includes(sen), '回應裡出現哨兵「' + sen + '」');
  }
  assert.ok(s.includes('RMLOB'), '正對照：房號本來就該回（否則 E2 只是因為回應是空的）');
});
await T('E3 ⭐ 掃描器自驗：把哨兵塞進回應就一定要被抓到（否則 E1／E2 是安慰劑）', () => {
  assert.notDeepStrictEqual(findEmails({ x: 'someone@example.com' }), [], 'email 掃描器壞了');
  assert.ok(JSON.stringify({ roomName: S_ROOMNAME }).includes(S_ROOMNAME), '哨兵掃描器壞了');
});
await T('E4 ⭐ accepted 那一筆的欄位清單：只比 v6.301 多一個 roomId（沒有夾帶別的東西）', async () => {
  const H = buildFriends(FR, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
  const r = await list(H);
  const keys = Object.keys(byNick(r.body, U.B.email)).sort();
  assert.deepStrictEqual(keys,
    ['alias', 'at', 'blockedByMe', 'fid', 'inTournament', 'nick', 'requestedByMe', 'roomId', 'status', 'uid', 'uids', 'via'],
    '回應欄位清單變了：' + keys.join(','));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】讓路：100 房 × 2 座位 ＝ 200 ⇒ 剛好多讓路一次');
await T('F1 ⭐⭐ 滿載（100 房、每房 2 個座位）⇒ 房間迴圈讓路 1 次；沒有房間時 0 次（增量可歸因）', async () => {
  const mk = (nRooms) => {
    const friendships = [mkRow(U.A.email, U.B.email, 'accepted')];
    const rooms = [];
    for (let i = 0; i < nRooms; i++) rooms.push(mkRoom('R' + i, 'lobby', ['a' + i + '@example.com', 'b' + i + '@example.com'], 1000 - i));
    return seedOf({ friendships, rooms });
  };
  const y0 = { ticks: 0 };
  const H0 = buildFriends(FR, { seed: mk(0), yieldCounter: y0, dbOpts: { indexes: FULL_IDX, noAutoIndex: true, ioDelay: true } });
  await list(H0);
  const y1 = { ticks: 0 };
  const H1 = buildFriends(FR, { seed: mk(100), yieldCounter: y1, dbOpts: { indexes: FULL_IDX, noAutoIndex: true, ioDelay: true } });
  await list(H1);
  assert.strictEqual(y1.ticks - y0.ticks, 1, '100 房（200 座位）的讓路增量應為 1，實得 ' + (y1.ticks - y0.ticks) + '（0 房 ' + y0.ticks + ' / 100 房 ' + y1.ticks + '）');
  console.log('        讓路節拍：0 房 ' + y0.ticks + ' 次 → 100 房 ' + y1.ticks + ' 次（增量 1）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】【H】【I】client 純函式（esbuild 轉譯後**實跑**）');
const require_ = createRequire(import.meta.url);
let esbuild = null;
try { esbuild = require_('esbuild'); } catch { esbuild = null; }
let LIB = null, API = null, libErr = '';
if (!esbuild) {
  skipped.push('【G】【H】【I2】client 純函式實跑（沒有 esbuild）');
  console.log('  ⚠⚠ SKIP：這台機器沒有 esbuild');
} else {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'v6302-'));
    await esbuild.build({ entryPoints: [P_FR], bundle: true, format: 'cjs', platform: 'node', outfile: join(dir, 'fr.cjs'), logLevel: 'silent' });
    LIB = require_(join(dir, 'fr.cjs'));
    await esbuild.build({
      entryPoints: [P_API], bundle: true, format: 'cjs', platform: 'node', outfile: join(dir, 'api.cjs'), logLevel: 'silent',
      nodePaths: [join(ROOT, 'node_modules')],
      define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
    });
    API = require_(join(dir, 'api.cjs'));
  } catch (e) { libErr = String((e && e.message) || e).slice(0, 200); }
}
// ⚠⚠ HEAD-FAIL 紀律：BASE 的 friend-rooms.ts 沒有 buildFriendRoomIdIndex ——
//   這裡**不可以**丟一般 Error（T 只捕 AssertionError ⇒ 整支會 crash，看起來像「只紅了一條」）。
//   一律用 assert 讓每一條各自翻紅。
const libDead = async (names) => {
  const why = libErr ? ('載入失敗：' + libErr) : '缺 buildFriendRoomIdIndex（v6.302 的房號索引）';
  for (const n of names) await T(n, () => { assert.ok(false, 'HEAD-FAIL：client 端本版改動不在 ⇒ 這一節無法執行（' + why + '）'); });
};
if (esbuild && (!LIB || !LIB.buildFriendRoomIdIndex)) {
  await libDead(['G1 roomId 主路徑', 'G2 找不到房就灰掉', 'G3 ⭐⭐⭐ null 不退回 uid', 'G4 ⭐⭐⭐ 欄位缺席才退回 uid',
                 'G5 房號索引規則', 'G6 沒給 byId ⇒ fail-closed', 'G7 inTournament 文案',
                 'I2 零 fetch 零 timer', 'I3 200 tick 零請求',
                 'K8 突變：null 與缺席混為一談', 'K9 突變：拿掉退路', 'K10 突變：FriendsPanel 少傳索引']);
}

const ROOMS = [
  { roomId: 'RLOB', status: 'lobby', roomName: '等待中的房', hostName: '房主一', seats: [{ uid: 'seatB' }, { uid: null }] },
  { roomId: 'RPLAY', status: 'playing', roomName: '', hostName: '房主二', seats: [{ uid: 'seatC' }, { uid: 'seatX' }] },
  { roomId: 'REND', status: 'ended', roomName: '結束的房', hostName: '房主三', seats: [{ uid: 'seatD' }, { uid: null }] },
];
if (LIB && LIB.buildFriendRoomIdIndex) {
  const byUid = LIB.buildFriendRoomIndex(ROOMS);
  const byId = LIB.buildFriendRoomIdIndex(ROOMS);
  await T('G1 ⭐⭐⭐ 主路徑：伺服器回的 roomId 在 openRooms 裡找得到 ⇒ 可點，而且拿到**現在的** status／房名／房主', () => {
    const a = LIB.friendRoomState({ roomId: 'RLOB', uid: null, uids: [] }, byUid, byId);
    assert.strictEqual(a.kind, 'join', 'lobby 房應該是 join，實得 ' + a.kind);
    assert.ok(LIB.friendRoomClickable(a), '配對到 lobby 房卻不可點');
    assert.strictEqual(a.room.roomName, '等待中的房');
    assert.strictEqual(a.room.hostName, '房主一');
    const b = LIB.friendRoomState({ roomId: 'RPLAY', uid: null, uids: [] }, byUid, byId);
    assert.strictEqual(b.kind, 'spectate', 'playing 房應該是 spectate，實得 ' + b.kind);
    assert.strictEqual(b.room.roomName, '房主二', '房名空白時應退回房主名');
  });
  await T('G2 ⭐⭐⭐ roomId 有值但 **openRooms 裡找不到那間房**（好友剛離開／房剛關）⇒ 灰掉（openRooms 才是「現在」）', () => {
    const s = LIB.friendRoomState({ roomId: 'GONE', uid: 'seatB', uids: ['seatC'] }, byUid, byId);
    assert.strictEqual(s.kind, 'none', '找不到那間房卻不是 none：' + s.kind);
    assert.strictEqual(s.room, null);
    assert.ok(!LIB.friendRoomClickable(s), '找不到那間房卻還可以點');
  });
  await T('G3 ⭐⭐⭐ **roomId === null ⇒ 直接灰掉，絕不退回 uid 比對**（站長裁定「改成 email 比對」，不是「兩者都用」）', () => {
    // ⚠ 這一筆的 uid 是**對得上** RLOB 的 —— 舊路徑會放行，新路徑必須擋下來。
    const s = LIB.friendRoomState({ roomId: null, uid: 'seatB', uids: ['seatC'] }, byUid, byId);
    assert.strictEqual(s.kind, 'none', 'roomId 是 null 卻仍然用 uid 配到房 ⇒ 沒有以伺服器為準：' + s.kind);
    // 正對照：同一筆把 roomId 欄位拿掉（＝舊伺服器）就會命中 ⇒ 證明這條斷言不是因為 uid 本來就配不到
    const t = LIB.friendRoomState({ uid: 'seatB', uids: ['seatC'] }, byUid, byId);
    assert.strictEqual(t.kind, 'join', '正對照失敗：欄位缺席時 uid 也配不到 ⇒ G3 是安慰劑');
  });
  await T('G4 ⭐⭐⭐ roomId **欄位不存在**（undefined＝舊伺服器／伺服器答不出來）⇒ 退回 v6.301 的 uid 比對', () => {
    const a = LIB.friendRoomState({ uid: 'seatC', uids: [] }, byUid, byId);
    assert.strictEqual(a.kind, 'spectate', '欄位缺席時沒有退回 uid 比對：' + a.kind);
    const b = LIB.friendRoomState({ uid: 'nope', uids: ['seatB'] }, byUid, byId);
    assert.strictEqual(b.kind, 'join', 'uids（最近 5 個）那條退路也要能用：' + b.kind);
  });
  await T('G5 ⭐ 房號索引的規則與 uid 索引一致：ended 不進、空房號不進、髒資料不爆掉', () => {
    assert.ok(!byId.has('REND'), 'ended 的房竟然進了索引');
    assert.strictEqual(byId.size, 2, '索引大小不對：' + byId.size);
    assert.doesNotThrow(() => LIB.buildFriendRoomIdIndex(null));
    assert.doesNotThrow(() => LIB.buildFriendRoomIdIndex([null, undefined, {}, { roomId: '' }, { roomId: 'X' }]));
    assert.strictEqual(LIB.buildFriendRoomIdIndex([{ roomId: 'X', status: 'lobby' }]).get('X').hostName, '', '缺 hostName 應退成空字串而不是爆掉');
  });
  await T('G6 ⭐ 呼叫端沒給房號索引 ⇒ 主路徑 fail-closed（none），不會偷偷退回 uid', () => {
    const s = LIB.friendRoomState({ roomId: 'RLOB', uid: 'seatB', uids: [] }, byUid, null);
    assert.strictEqual(s.kind, 'none', '沒給 byId 卻配到房 ⇒ 偷偷走了 uid：' + s.kind);
  });
  await T('G7 ⭐ inTournament 只在**兩條路都沒配到房**時才影響文案；配到房一律以房間為準', () => {
    const a = LIB.friendRoomState({ roomId: 'RLOB', inTournament: true }, byUid, byId);
    assert.strictEqual(a.kind, 'join', '配到房卻被 inTournament 蓋掉：' + a.kind);
    const b = LIB.friendRoomState({ roomId: null, inTournament: true }, byUid, byId);
    assert.strictEqual(b.kind, 'tournament', 'roomId 為 null 且在錦標賽 ⇒ 應顯示錦標賽文案：' + b.kind);
    assert.ok(!LIB.friendRoomClickable(b), '錦標賽狀態竟然可以點');
  });
  await T('I2 ⭐⭐ friend-rooms.ts 仍然**零 fetch／零 timer／零 import**（本檔是純函式，不可以自己去打 API）', () => {
    const stripped = FR_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const bad of ['fetch(', 'setInterval(', 'setTimeout(', 'XMLHttpRequest', 'import ']) {
      assert.ok(!stripped.includes(bad), 'friend-rooms.ts 出現「' + bad + '」');
    }
  });
  await T('I3 ⭐⭐ **200 tick 零請求**：把 fetch／timer 全換成計數器，跑 200 次「房間更新 ＋ 全好友重算」⇒ 一發都沒有', () => {
    const calls = { fetch: 0, timer: 0 };
    const g = globalThis;
    const of = g.fetch, os = g.setInterval, ot = g.setTimeout;
    g.fetch = () => { calls.fetch++; return Promise.resolve({}); };
    g.setInterval = () => { calls.timer++; return 0; };
    g.setTimeout = () => { calls.timer++; return 0; };
    try {
      const rows = [];
      for (let i = 0; i < 100; i++) rows.push({ roomId: i % 3 === 0 ? ('R' + i) : (i % 3 === 1 ? null : undefined), uid: 'u' + i, uids: [] });
      let hits = 0;
      for (let t = 0; t < 200; t++) {
        const rooms = [];
        for (let i = 0; i < 100; i++) rooms.push({ roomId: 'R' + i, status: i % 2 ? 'playing' : 'lobby', roomName: 'n' + i, hostName: 'h' + i, seats: [{ uid: 'u' + i }, { uid: null }] });
        const bu = LIB.buildFriendRoomIndex(rooms), bi = LIB.buildFriendRoomIdIndex(rooms);
        for (const r of rows) if (LIB.friendRoomClickable(LIB.friendRoomState(r, bu, bi))) hits++;
        }
      assert.ok(hits > 0, '正對照失敗：200 tick 跑下來一個都沒配到 ⇒ 這條測試根本沒在跑');
      assert.strictEqual(calls.fetch, 0, '200 tick 竟然打了 ' + calls.fetch + ' 發 fetch');
      assert.strictEqual(calls.timer, 0, '200 tick 竟然裝了 ' + calls.timer + ' 個 timer');
      console.log('        200 tick × 100 房 × 100 好友：fetch ' + calls.fetch + ' 發、timer ' + calls.timer + ' 個（配對成功 ' + hits + ' 次）');
    } finally { g.fetch = of; g.setInterval = os; g.setTimeout = ot; }
  });
}
if (API && API.__esModule !== undefined || API) {
  await T('H1 ⭐⭐⭐ friends-api 的 `toRow` **保留「欄位不存在 vs null」的差別**（伺服器沒回 key ⇒ 屬性缺席；回 null ⇒ 值是 null）', () => {
    const parse = API.parseFriendsListForTest || null;
    // ⚠ toRow 沒有 export ⇒ 用原始碼等價條件 ＋ 下面 H2 的行為端補足（不做只驗字串的安慰劑）
    // ⚠ 一定要先剝註解：本檔的註解裡就寫著「不可以寫成 `roomId: ... ?? null`」，不剝會抓到自己的說明（假紅）。
    const code = API_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    assert.ok(/Object\.prototype\.hasOwnProperty\.call\(r, 'roomId'\)/.test(code),
      'toRow 沒有用 hasOwnProperty 判斷 ⇒ 「沒回 key」與「回 null」會被壓成同一種值');
    assert.ok(!/roomId:[^\n]*\?\?[^\n]*null/.test(code), 'toRow 用了 ?? null ⇒ 差別被壓掉了');
    assert.ok(/roomId\?: string \| null;/.test(API_TS), 'FriendRow 沒有 roomId 欄位（或型別不是 optional）');
    void parse;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【I1】【J】行為端 DOM（playwright）');
let chromium = null;
try { chromium = require_(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch { chromium = null; }
const LIST_BASE = {
  friendsApi: 1, me: { uid: 'me', nick: '我' },
  friends: [
    // ① 主路徑：伺服器回的房號在 openRooms 裡找得到 ⇒ 可點
    { fid: 'f1', status: 'accepted', nick: '小明', alias: null, uid: null, uids: [], roomId: 'RLOB', requestedByMe: false, blockedByMe: false, via: 'battle', at: 1 },
    // ② ⭐⭐ 伺服器說「不在任何房」，但 uid 對得上 RLOB ⇒ **必須灰掉**
    { fid: 'f2', status: 'accepted', nick: '阿華', alias: null, uid: 'seatB', uids: [], roomId: null, requestedByMe: false, blockedByMe: false, via: 'battle', at: 2 },
    // ③ 舊伺服器（沒有 roomId 欄位）＋ uid 對得上 ⇒ 退回 uid 比對 ⇒ 可點
    { fid: 'f3', status: 'accepted', nick: '老王', alias: null, uid: 'seatC', uids: [], requestedByMe: false, blockedByMe: false, via: 'battle', at: 3 },
    // ④ 伺服器回了房號，但那間房已經不在 openRooms 裡 ⇒ 灰掉
    { fid: 'f4', status: 'accepted', nick: '阿宅', alias: null, uid: 'seatB', uids: [], roomId: 'GONE', requestedByMe: false, blockedByMe: false, via: 'email', at: 4 },
  ],
  incoming: [], outgoing: [], blocked: [],
  limit: 100, truncated: false,
};
if (!chromium || !esbuild) {
  skipped.push('【I1】【J】行為端 DOM（缺 playwright／esbuild）');
  console.log('  ⚠⚠ SKIP：缺 playwright 或 esbuild ⇒ DOM 行為沒有跑（其餘各節仍在守）');
} else {
  const { compile } = await import('svelte/compiler');
  const dir = mkdtempSync(join(tmpdir(), 'v6302pw-'));
  let pwFatal = '';
  const HARNESS = `<script>
  import P from './FriendsPanel.js';
  let rooms = $state(null);
  globalThis.__setRooms = (r) => { rooms = r; };
  globalThis.__joins = [];
  const onjoin = (id) => { globalThis.__joins.push(id); };
</script>
<P embedded {rooms} onjoinroom={onjoin} />
`;
  writeFileSync(join(dir, 'FriendsPanel.js'), compile(FRP, { generate: 'client', filename: 'FriendsPanel.svelte', runes: true, css: 'injected' }).js.code);
  writeFileSync(join(dir, 'Harness.js'), compile(HARNESS, { generate: 'client', filename: 'Harness.svelte', runes: true, css: 'injected' }).js.code);
  writeFileSync(join(dir, 'fb.js'), 'export const auth = globalThis.__auth;\n');
  writeFileSync(join(dir, 'fbauth.js'), 'export function onAuthStateChanged(a, cb){ setTimeout(()=>cb(globalThis.__auth.currentUser),0); return ()=>{}; }\n');
  writeFileSync(join(dir, 'entry.js'),
    "import { mount, flushSync } from 'svelte';\nimport H from './Harness.js';\n"
    + "globalThis.__mount = (t, props) => mount(H, { target: t, props });\n"
    + "globalThis.__flush = flushSync;\n");
  try {
    await esbuild.build({
      entryPoints: [join(dir, 'entry.js')], bundle: true, format: 'iife', outfile: join(dir, 'bundle.js'), logLevel: 'silent',
      alias: {
        '$lib/firebase': join(dir, 'fb.js'), 'firebase/auth': join(dir, 'fbauth.js'),
        '$lib/friends/friends-api': P_API, '$lib/friends/auth-ctx': P_CTX,
        '$lib/friends/friend-rooms': P_FR, '$lib/ui/stale-keep': join(ROOT, 'src/lib/ui/stale-keep.ts'),
      },
      nodePaths: [join(ROOT, 'node_modules')], loader: { '.ts': 'ts' },
      define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
    });
  } catch (e) { pwFatal = String((e && e.message) || e).slice(0, 200); }
  let bundle = '';
  if (!pwFatal) { try { bundle = readFileSync(join(dir, 'bundle.js'), 'utf8'); } catch (e) { pwFatal = String((e && e.message) || e).slice(0, 200); } }
  if (pwFatal) {
    for (const n of ['I1 200 tick 零請求（DOM）', 'J1 主路徑可點', 'J2 null 灰掉', 'J3 欄位缺席退回 uid', 'J4 點下去走既有流程']) {
      // ⚠⚠ 同上：一律用 assert，丟一般 Error 會讓整支 crash（後面每一條都不會跑）。
      await T(n, () => { assert.ok(false, '元件打包失敗 ⇒ 行為端無法執行：' + pwFatal); });
    }
  }
  let browser = null;
  try { browser = pwFatal ? null : await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] }); }
  catch (e) {
    skipped.push('【I1】【J】行為端 DOM（瀏覽器起不來：' + String(e && e.message).slice(0, 80) + '）');
    console.log('  ⚠⚠ SKIP：瀏覽器起不來 ⇒ DOM 行為沒有跑');
  }
  if (browser) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const newPage = async () => {
      const pg = await ctx.newPage();
      await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' }));
      await pg.goto('https://t.local/');
      await pg.evaluate((L) => {
        window.__calls = [];
        window.fetch = async (url) => {
          window.__calls.push(String(url));
          return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => L };
        };
        window.__auth = { currentUser: { uid: 'me', isAnonymous: false, getIdToken: async () => 'tok' } };
      }, LIST_BASE);
      await pg.addScriptTag({ content: bundle });
      await pg.evaluate((rs) => { window.__mount(document.getElementById('app'), {}); window.__setRooms(rs); }, ROOMS);
      await pg.waitForTimeout(400);
      return pg;
    };
    // ⚠ 這個守衛的假清單只有「好友」一區（incoming／outgoing／blocked 都空）⇒ `.row` 就是那 4 列。
    const snapshot = (pg) => pg.evaluate(() => [...document.querySelectorAll('.fr-panel .row')].map((x) => {
      const b = x.querySelector('.fr-join'); const rm = x.querySelector('.fr-room'); const nk = x.querySelector('.nick');
      return {
        nick: nk ? nk.textContent.trim() : '',
        label: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null,
        room: rm ? rm.textContent.trim() : null,
      };
    }));
    const pg = await newPage();
    await T('J0 掃描器自驗：好友區真的渲染出 4 列、暱稱順序如預期（不然後面每一條都是空跑）', async () => {
      const s = await snapshot(pg);
      assert.deepStrictEqual(s.map((x) => x.nick), ['小明', '阿華', '老王', '阿宅'], '好友列數／順序不對：' + JSON.stringify(s.map((x) => x.nick)));
    });
    await T('J1 ⭐⭐⭐ 主路徑：伺服器回 roomId ＝ RLOB ⇒ 按鈕可按，而且顯示**現在的**房名與房主', async () => {
      const s = await snapshot(pg);
      assert.strictEqual(s[0].label, '🚪 加入房間', '第一列的按鈕文字：' + s[0].label);
      assert.strictEqual(s[0].disabled, false, '主路徑配到 lobby 房卻是停用的');
      assert.ok(s[0].room && s[0].room.includes('等待中的房') && s[0].room.includes('房主一'),
        '⚠ 房名／房主名沒有顯示出來（seats[].email 是 client 自報的，這一行是玩家自保的依據）：' + s[0].room);
    });
    await T('J2 ⭐⭐⭐ 伺服器回 roomId ＝ **null**（但這一筆的 uid 對得上 RLOB）⇒ 按鈕**必須停用**、不顯示房間', async () => {
      const s = await snapshot(pg);
      assert.strictEqual(s[1].disabled, true, '⚠⚠ roomId 是 null 卻還可以按 ⇒ 又退回 uid 比對了');
      assert.strictEqual(s[1].room, null, 'roomId 是 null 卻顯示了房間資訊');
    });
    await T('J3 ⭐⭐ **舊伺服器**（沒有 roomId 欄位）＋ uid 對得上 ⇒ 退回 uid 比對 ⇒ 按鈕可按（相容退路還活著）', async () => {
      const s = await snapshot(pg);
      assert.strictEqual(s[2].label, '👁 觀戰', '第三列的按鈕文字：' + s[2].label);
      assert.strictEqual(s[2].disabled, false, '舊伺服器的退路壞了 ⇒ 部署順序（server 先上）期間所有人都按不到');
    });
    await T('J4 ⭐⭐ 伺服器回的房號在 openRooms 裡找不到（好友剛離開）⇒ 停用', async () => {
      const s = await snapshot(pg);
      assert.strictEqual(s[3].disabled, true, '找不到那間房卻還可以按');
    });
    await T('J5 ⭐ 點下去真的把**伺服器給的房號**交給既有流程（不是別間房）', async () => {
      const got = await pg.evaluate(() => {
        globalThis.__joins.length = 0;
        document.querySelectorAll('.fr-panel .row')[0].querySelector('.fr-join').click();
        return globalThis.__joins.slice();
      });
      assert.deepStrictEqual(got, ['RLOB'], '點下去傳出的房號：' + JSON.stringify(got));
    });
    await T('I1 ⭐⭐⭐ **200 次房間更新（≈ 6.7 分鐘的大廳輪詢）⇒ 對 /api/rooms、/api/friends 零額外請求**', async () => {
      const before = await pg.evaluate(() => window.__calls.slice());
      assert.strictEqual(before.length, 1, '掛載後的請求本來就不對：' + JSON.stringify(before));
      const after = await pg.evaluate((base) => {
        for (let i = 0; i < 200; i++) {
          window.__setRooms(base.concat([{ roomId: 'X' + i, status: 'lobby', roomName: 'x' + i, hostName: 'h' + i, seats: [{ uid: 'q' + i }, { uid: null }] }]));
          window.__flush();
        }
        return { calls: window.__calls.slice(), btn: document.querySelectorAll('.fr-panel .row')[0].querySelector('.fr-join').textContent.trim() };
      }, ROOMS);
      assert.strictEqual(after.calls.length, 1, '200 次更新之後總請求數變成 ' + after.calls.length + '：' + JSON.stringify(after.calls.slice(0, 6)));
      assert.strictEqual(after.calls.filter((u) => /\/api\/rooms|\/api\/friends/.test(u)).length, 1, '多打了 /api/rooms 或 /api/friends');
      assert.strictEqual(after.btn, '🚪 加入房間', '正對照：畫面沒有跟著房間更新走 ⇒ 「零請求」只是因為根本沒接上');
      console.log('        200 tick 後總 fetch 次數 = ' + after.calls.length + '（＝掛載時那一發 list，零額外請求）');
    });
    await ctx.close();
    await browser.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【K】突變測試（沒紅 ＝ 守衛是安慰劑）');
await T('K1 突變：把 roomId 寫在 status 判斷**之前**（＝所有關係都帶）⇒ B4 必紅', async () => {
  // ⚠ 這個突變體刻意寫成「不動 if/else 鏈的結構」—— 之前試過把賦值挪到 else 之前，
  //   結果 else 被新的 if 接走、incoming/blocked 全空，迴圈根本沒東西可掃 ⇒ 那才是真正的安慰劑。
  const bad = mutate(FR, '          const _oe = d.a === me.email ? d.b : d.a;',
    '          const _oe = d.a === me.email ? d.b : d.a;\n          if (rmap) p.roomId = rmap.get(_oe) || null;');
  await mutantMustBreak('非 accepted 也帶 roomId', async () => {
    const s = semSeed();
    s.friendships.push(mkRow(U.A.email, 'zoe@example.com', 'blocked'));
    s.rooms.push(mkRoom('RMZOE', 'lobby', ['zoe@example.com', U.E.email], 500));
    const H = buildFriends(bad, { seed: s, dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
    const r = await list(H);
    const others = [].concat(r.body.incoming, r.body.outgoing, r.body.blocked);
    // ⚠ 掃描器自驗：沒有這一行的話，「非 accepted 全部消失」也會靜靜地全綠。
    assert.ok(others.length >= 2, '掃描器自驗失敗：非 accepted 只有 ' + others.length + ' 筆');
    for (const p of others) {
      assert.ok(!('roomId' in p), '非 accepted 的關係竟然帶了 roomId：' + JSON.stringify(p).slice(0, 160));
    }
  }, '非 accepted 的關係竟然帶了 roomId');
});
await T('K2 突變：把「答不出來就不寫欄位」改成「一律寫 null」⇒ D2 必紅（client 會全部灰掉、退不回 uid 比對）', async () => {
  const bad = mutate(FR, 'if (rmap) p.roomId = rmap.get(_oe) || null;', 'p.roomId = (rmap && rmap.get(_oe)) || null;');
  await mutantMustBreak('缺索引仍寫 null', async () => {
    const H = buildFriends(bad, { seed: semSeed(), dbOpts: { indexes: NO_ROOM_IDX, noAutoIndex: true } });
    const r = await list(H);
    for (const p of r.body.friends) assert.ok(!('roomId' in p), '缺索引時竟然帶了 roomId 欄位（值＝' + p.roomId + '）');
  }, '缺索引時竟然帶了 roomId 欄位');
});
await T('K3 突變：拿掉索引自驗 ⇒ D1 必紅（會對 8 萬筆 rooms COLLSCAN）', async () => {
  const bad = mutate(FR, '      if (!(await _frRoomIdxReady())) return null;\n      const rooms = await db.collection(FR_ROOM_COLL)',
    '      await _frRoomIdxReady();\n      const rooms = await db.collection(FR_ROOM_COLL)');
  await mutantMustBreak('無索引仍查', async () => {
    const H = buildFriends(bad, { seed: semSeed(), dbOpts: { indexes: NO_ROOM_IDX, noAutoIndex: true } });
    await list(H);
    assert.strictEqual(roomFinds(H.db).length, 0, '沒有索引卻查了 ' + roomFinds(H.db).length + ' 次 rooms ⇒ COLLSCAN');
  }, 'COLLSCAN');
});
await T('K4 突變：拿掉 5 秒快照與 in-flight 合併（每發都自己掃）⇒ C3／C4 必紅（N 發 list ＝ N 發 rooms）', async () => {
  const bad = mutate(FR, '      if (_frRoomSnap.at && now - _frRoomSnap.at < FR_ROOM_TTL_MS) return _frRoomSnap.byEmail;\n      if (_frRoomInflight) return _frRoomInflight;',
    '      if (false) return _frRoomSnap.byEmail;');
  await mutantMustBreak('沒有快照', async () => {
    const H = buildFriends(bad, { seed: manyFriends(50, 20), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
    await list(H); await list(H); await list(H);
    assert.strictEqual(roomFinds(H.db).length, 1, '5 秒內三發竟然查了 ' + roomFinds(H.db).length + ' 次');
  }, '5 秒內三發竟然查了');
});
await T('K5 突變：projection 改成整包（撈 gameState）⇒ C5 必紅', async () => {
  const bad = mutate(FR, "{ projection: { _id: 1, 'seats.email': 1 } }", '{}');
  await mutantMustBreak('撈整包', async () => {
    const H = buildFriends(bad, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
    await list(H);
    const f = roomFinds(H.db)[0];
    assert.ok(f && f.opt && f.opt.projection, 'rooms 查詢沒有 projection ⇒ 會把整包 gameState 讀進 node');
  }, '沒有 projection');
});
await T('K6 突變：把「只看 p1／p2」改成看所有座位 ⇒ B3 必紅（觀戰位會被當成「他在這間房」）', async () => {
  const bad = mutate(FR, 'const n = code ? Math.min(FR_ROOM_SEAT_SLOTS, seats.length) : 0;', 'const n = code ? seats.length : 0;');
  await mutantMustBreak('看所有座位', async () => {
    const H = buildFriends(bad, { seed: semSeed(), dbOpts: { indexes: FULL_IDX, noAutoIndex: true } });
    const r = await list(H);
    assert.strictEqual(byNick(r.body, U.D.email).roomId, null, '觀戰位／ended 房竟然被算成「他在這間房」：' + byNick(r.body, U.D.email).roomId);
  }, '觀戰位／ended 房竟然被算成');
});
await T('K7 突變：房間迴圈拿掉讓路 ⇒ F1 必紅', async () => {
  const bad = mutate(FR, '          const w = y(++k); if (w) await w;   // ⚠ 每 200 個座位讓路（v6.242）', '          k++;');
  await mutantMustBreak('房間迴圈無讓路', async () => {
    const mk = (nRooms) => {
      const friendships = [mkRow(U.A.email, U.B.email, 'accepted')]; const rooms = [];
      for (let i = 0; i < nRooms; i++) rooms.push(mkRoom('R' + i, 'lobby', ['a' + i + '@example.com', 'b' + i + '@example.com'], 1000 - i));
      return seedOf({ friendships, rooms });
    };
    const y0 = { ticks: 0 };
    const H0 = buildFriends(bad, { seed: mk(0), yieldCounter: y0, dbOpts: { indexes: FULL_IDX, noAutoIndex: true, ioDelay: true } });
    await list(H0);
    const y1 = { ticks: 0 };
    const H1 = buildFriends(bad, { seed: mk(100), yieldCounter: y1, dbOpts: { indexes: FULL_IDX, noAutoIndex: true, ioDelay: true } });
    await list(H1);
    assert.strictEqual(y1.ticks - y0.ticks, 1, '100 房（200 座位）的讓路增量應為 1，實得 ' + (y1.ticks - y0.ticks));
  }, '讓路增量應為 1');
});
if (LIB && LIB.buildFriendRoomIdIndex) {
  await T('K8 ⭐⭐⭐ 突變（client）：把 roomId 判斷改成 `if (row?.roomId)`（＝把 null 與欄位缺席混為一談）⇒ G3 必紅', async () => {
    const src = FR_TS.replace('if (row && row.roomId !== undefined) {', 'if (row && row.roomId) {');
    assert.notStrictEqual(src, FR_TS, '突變錨點不存在 ⇒ 掃描器瞎了');
    const d = mkdtempSync(join(tmpdir(), 'v6302m8-'));
    writeFileSync(join(d, 'fr.ts'), src);
    await esbuild.build({ entryPoints: [join(d, 'fr.ts')], bundle: true, format: 'cjs', platform: 'node', outfile: join(d, 'fr.cjs'), logLevel: 'silent' });
    const M = require_(join(d, 'fr.cjs'));
    await mutantMustBreak('null 與缺席混為一談', () => {
      const bu = M.buildFriendRoomIndex(ROOMS), bi = M.buildFriendRoomIdIndex(ROOMS);
      const s = M.friendRoomState({ roomId: null, uid: 'seatB', uids: ['seatC'] }, bu, bi);
      assert.strictEqual(s.kind, 'none', 'roomId 是 null 卻仍然用 uid 配到房 ⇒ 沒有以伺服器為準：' + s.kind);
    }, '沒有以伺服器為準');
  });
  await T('K9 ⭐⭐ 突變（client）：把「欄位缺席退回 uid」拿掉 ⇒ G4 必紅（新舊 server 交替部署期間所有人都按不到）', async () => {
    const src = FR_TS.replace('  } else if (row && byUid) {\n    // ② 欄位缺席才退回 uid 比對。\n    hit = lookupHit(row, byUid);\n  }',
      '  }');
    assert.notStrictEqual(src, FR_TS, '突變錨點不存在 ⇒ 掃描器瞎了');
    const d = mkdtempSync(join(tmpdir(), 'v6302m9-'));
    writeFileSync(join(d, 'fr.ts'), src);
    await esbuild.build({ entryPoints: [join(d, 'fr.ts')], bundle: true, format: 'cjs', platform: 'node', outfile: join(d, 'fr.cjs'), logLevel: 'silent' });
    const M = require_(join(d, 'fr.cjs'));
    await mutantMustBreak('拿掉退路', () => {
      const bu = M.buildFriendRoomIndex(ROOMS), bi = M.buildFriendRoomIdIndex(ROOMS);
      const a = M.friendRoomState({ uid: 'seatC', uids: [] }, bu, bi);
      assert.strictEqual(a.kind, 'spectate', '欄位缺席時沒有退回 uid 比對：' + a.kind);
    }, '欄位缺席時沒有退回 uid 比對');
  });
  await T('K10 ⭐⭐ 突變（client）：FriendsPanel 少傳房號索引 ⇒ G6 的等價條件必紅（新伺服器的每個人都會被判成沒配到房）', () => {
    assert.ok(/friendRoomState\(r, roomIndex, roomIdIndex\)/.test(FRP),
      'FriendsPanel 沒有把房號索引傳給 friendRoomState ⇒ 主路徑一律配不到房');
    assert.ok(/buildFriendRoomIdIndex\(rooms\)/.test(FRP), 'FriendsPanel 沒有建房號索引');
    const bad = FRP.replace('friendRoomState(r, roomIndex, roomIdIndex)', 'friendRoomState(r, roomIndex)');
    assert.notStrictEqual(bad, FRP, '突變錨點不存在');
    assert.ok(!/friendRoomState\(r, roomIndex, roomIdIndex\)/.test(bad), '突變後條件仍成立 ⇒ 這條是安慰劑');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【L】test chain ／ 版本一致（不 pin 版本號）');
await T('L1 本守衛在 package.json 的 test chain', () => {
  const t = JSON.parse(PKG).scripts.test;
  assert.ok(t.includes('scripts/test-v6302-friend-room-by-email.mjs'), '沒有加進 npm test 的 chain');
});
await T('L2 版本一致：version.ts ＝ admin.html SITE_VERSION_HINT（比較而非 pin 死數字）', () => {
  const V = /VERSION = '([\d.]+)'/.exec(VERTS)[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'admin.html hint ' + H + ' ≠ version.ts ' + V);
});
await T('L3 FRIENDS 區塊版號 log 有對應的變更條目（同樣不 pin 死版本號）', () => {
  const m = /console\.log\('\[friends\] endpoints registered \(v(\d+)\.(\d+)\)/.exec(PATCH);
  assert.ok(m, '少了版號 log');
  assert.ok(PATCH.includes('v' + m[1] + '.' + m[2] + '（v6.'), '版號 log v' + m[1] + '.' + m[2] + ' 在區塊內找不到對應的變更條目');
});
await T('L4 ⚠ 本守衛自己不 pin 死版本號（除了兩把既有的錦標賽 sha256，那兩把是「不得改動」的鎖）', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = self.split('\n').filter((l) => !/SHA256|^\/\/|console\.log|守衛：|v6\.30\d 守衛/.test(l)).join('\n');
  const pins = [...body.matchAll(/['"`]6\.\d{3}['"`]/g)].map((x) => x[0]);
  assert.deepStrictEqual(pins, [], '守衛裡 pin 了版本號：' + pins.join(', '));
});

if (skipped.length) console.log('\n⚠⚠ 本次跳過：' + skipped.join('；'));
console.log('\n══ v6.302 好友清單 roomId（伺服器用 email 比對）守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
