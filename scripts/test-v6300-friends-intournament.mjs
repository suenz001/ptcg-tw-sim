// v6.300 守衛：好友清單多回布林 `inTournament`（「這位好友此刻是否正在錦標賽對戰中」）
// HEAD-FAIL：BASE v6.299 的 FRIENDS 區塊沒有 _frTournPlayingEmails／_frTournIdxReady ⇒ A0 必紅並提前結束。
//
// 守什麼（全部行為端；伺服器區塊用 scripts/lib/friends-harness-v6282.mjs 把 FRIENDS 區塊抽出來實跑）：
//   【A】抽取器下限 ＋ 錦標賽區塊兩把既有 sha256（與 test-v6272 ⑨／test-v6278 I1 同一把）。
//   【B】語義：playing ⇒ true；pending／finished 賽事／沒報名 ⇒ false；報名列 email 為 null ⇒ false（fail-closed）；
//        TREGS email 大小寫不同仍對得上（_frNormEmail）；⚠ 非 accepted 的關係**完全不帶**這個欄位。
//   【C】⭐⭐ N+1 防護：100 個好友 ⇒ tournamentEvents／tournamentMatches／tournamentRegistrations 各恰 1 發，
//        且與好友人數無關（10 人與 100 人數字相同）；沒有賽事在進行 ⇒ ②③ **零**查詢；5 秒共用快照＋in-flight 合併。
//   【D】⭐⭐ 索引不存在 ⇒ 整段跳過、一律 false、**零掃描**（三支索引各自缺一次都測）；正對照＝拿掉自驗要紅。
//   【E】隱私：只回布林；賽事名稱／房號／matchId／對手 uid 哨兵零出現；回應零 email（含半個 email）。
//   【F】讓路：> 200 筆（250 場 playing ＋ 250 筆報名）⇒ ticks 的確切次數。
//   【G】8 個突變各自打紅預期那一條。
//   【H】test chain ＋ 版本一致（不 pin 死版本號）＋ 本版零 createIndex 新增。
//
// ⚠ 紀律：只捕 AssertionError；突變體必須紅在**預期那一條**；不 pin 版本號／sha 當唯一判準。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  readPatch, extractBlock, FR_START, FR_END,
  buildFriends, makeFakeDb, asUser, findEmails,
} from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readPatch(join(ROOT, 'oracle-admin/server_admin_patch.js'));
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const VERTS = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const PKG = readFileSync(join(ROOT, 'package.json'), 'utf8');

let pass = 0, fail = 0;
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
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 300) + '（預期含「' + expectFrag + '」）');
};
const mutate = (src, a, b) => { const n = src.split(a).length - 1; assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90)); return src.replace(a, b, 1); };

// ── 共用假資料 ──────────────────────────────────────────────────────────────
const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'uB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'uC', email: 'carol@example.com', name: '卡蘿' },
  D: { uid: 'uD', email: 'dave@example.com', name: '大衛' },
};
// 哨兵：這些字串只存在於 DB 假資料，**任何回應都不該出現**（賽事名／房號／matchId／對手 uid）
const S_EVENT = 'ZQXEVENTNAME';
const S_ROOM = 'ZQXROOMCODE';
const S_MATCH = 'ZQXMATCHID';
const S_OPPUID = 'ZQXOPPONENTUID';
function frHash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x7fffffff;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= (c * 31 + i) & 0xffff; h2 = Math.imul(h2, 0x01000193) >>> 0; }
  const h3 = Math.imul(h1 ^ h2, 0x9e3779b1) >>> 0;
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0')).slice(0, 24);
}
const mkRow = (e1, e2, status, extra) => {
  const [a, b] = e1 < e2 ? [e1, e2] : [e2, e1]; const _id = a + '|' + b;
  return Object.assign({ _id, fid: frHash(_id), a, b, status: status || 'accepted', requester: a, blockedBy: null, nickA: '快照A', nickB: '快照B', addedVia: 'battle', createdAt: 1, updatedAt: 1 }, extra || {});
};
const CFG = { _id: 'friendsConfig', enabled: true, dm: true };
// ⚠ 三支索引全部是**既有**的（錦標賽區塊早就建好），本版一個都不新增。
const FULL_IDX = {
  tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }],
  tournamentEvents: [{ status: 1 }],
  tournamentMatches: [{ eventId: 1, status: 1 }],
};
const reg = (email, uid, eventId, name, at) => ({ _id: eventId + '__' + uid, eventId, uid, email, name: name || null, registeredAt: at || 5 });
const match = (id, eventId, status, p1uid, p2uid, extra) =>
  Object.assign({ _id: id, eventId, status, p1uid, p2uid, round: 1, idx: 0 }, extra || {});
const seedOf = (o) => Object.assign({ tournamentConfig: [structuredClone(CFG)] }, o || {});
const ops = (db, name, re) => db._log.filter((l) => l.name === name && (re || /^(find|findOne|countDocuments|aggregate)$/).test(l.op));
const list = (H, who) => H.call('get', '/api/friends/list', asUser(who || U.A));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】抽取器下限 ＋ 錦標賽區塊 sha256（HEAD-FAIL 錨點）');
let FR = '';
await T('A0 HEAD-FAIL 錨點：FRIENDS 區塊有 _frTournIdxReady／_frTournPlayingScan／_frTournPlayingEmails ＋ list 會設 p.inTournament（BASE v6.299 全都沒有 ⇒ 這一條必紅）', () => {
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  assert.ok(FR.includes('async function _frTournIdxReady('), 'HEAD-FAIL：FRIENDS 區塊沒有索引自驗 _frTournIdxReady');
  assert.ok(FR.includes('async function _frTournPlayingScan('), 'HEAD-FAIL：沒有 _frTournPlayingScan');
  assert.ok(FR.includes('async function _frTournPlayingEmails('), 'HEAD-FAIL：沒有 _frTournPlayingEmails（5 秒共用快照）');
  assert.ok(/p\.inTournament = /.test(FR), 'HEAD-FAIL：list 沒有設 p.inTournament');
});
if (!FR || !FR.includes('async function _frTournPlayingEmails(')) {
  console.log('\n══ v6.300 守衛：' + pass + ' PASS / ' + (fail || 1) + ' FAIL（HEAD-FAIL：本版改動不在，後續無法進行）══');
  process.exit(1);
}
const TOURN_TAIL_SHA256 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';   // 與 test-v6272 ⑨ 同一把
const TOURN_ANCHOR_SHA256 = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40'; // 與 test-v6278 I1 同一把
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256）；好友區塊整段在第一支 /api/tournament 之前', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");
  assert.ok(first > 0, '找不到第一支 /api/tournament 端點');
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(FR_END) < first, '好友區塊必須整段在錦標賽區塊之前');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗');
});
await T('A2 ⚠ 用字面而不是引用錦標賽區塊的常數（那些宣告在本區塊之後 ⇒ 會 TDZ）；本版**零** createIndex 新增', () => {
  assert.ok(FR.includes("const FR_EV_COLL = 'tournamentEvents';"), '沒有用字面宣告 tournamentEvents');
  assert.ok(FR.includes("const FR_MATCH_COLL = 'tournamentMatches';"), '沒有用字面宣告 tournamentMatches');
  const stripped = FR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert.ok(!/\bTEVENTS\b|\bTMATCH\b|\bTREGS\b/.test(stripped), '區塊內引用了錦標賽區塊的常數（TDZ 風險）');
  const ci = FR.split('\n').filter((l) => l.includes('createIndex('));
  assert.strictEqual(ci.length, 3, '本版不該增減 createIndex 呼叫，實得 ' + ci.length + ' 行');
  for (const l of ci) assert.ok(/catch/.test(l), 'createIndex 沒有 catch（test-v6119 的既有紀律）：' + l.trim().slice(0, 90));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】語義：playing ⇒ true；其餘一律 false；非 accepted 不帶欄位');
const baseSeed = () => seedOf({
  friendships: [mkRow(U.A.email, U.B.email, 'accepted'), mkRow(U.A.email, U.C.email, 'accepted'), mkRow(U.A.email, U.D.email, 'accepted')],
  tournamentEvents: [{ _id: 'EVLIVE', status: 'running', name: S_EVENT }, { _id: 'EVOLD', status: 'finished', name: S_EVENT + 'OLD' }],
  tournamentMatches: [
    match(S_MATCH + '_1', 'EVLIVE', 'playing', U.B.uid, S_OPPUID, { roomId: S_ROOM }),
    match(S_MATCH + '_2', 'EVLIVE', 'pending', U.C.uid, S_OPPUID + '2'),
    match(S_MATCH + '_3', 'EVOLD', 'playing', U.D.uid, S_OPPUID + '3', { roomId: S_ROOM + 'OLD' }),
  ],
  tournamentRegistrations: [
    reg(U.B.email, U.B.uid, 'EVLIVE', '鮑伯', 5), reg(U.C.email, U.C.uid, 'EVLIVE', '卡蘿', 5),
    reg(U.D.email, U.D.uid, 'EVOLD', '大衛', 5),
  ],
});
const byNick = (body, nick) => body.friends.find((f) => f.nick === nick);
await T('B1 ⭐ 好友正在 running 賽事的 playing 對戰 ⇒ inTournament true；配到對戰但還沒進場（pending）⇒ false', async () => {
  const H = buildFriends(FR, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.friends.length, 3);
  assert.strictEqual(byNick(r.body, '鮑伯').inTournament, true, '正在錦標賽對戰中的好友應為 true');
  assert.strictEqual(byNick(r.body, '卡蘿').inTournament, false, 'pending（還沒進場）不算「正在對戰中」');
});
await T('B2 ⭐ 已結束賽事裡殘留的 playing 對戰 ⇒ false（只看 status:running 的賽事）', async () => {
  const H = buildFriends(FR, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(byNick(r.body, '大衛').inTournament, false, '已結束賽事的殘留對戰被算成「正在對戰中」');
});
await T('B3 ⭐ 報名列的 email 是 null（未驗證身分的 playerId fallback 寫的）⇒ false（fail-closed，不猜）', async () => {
  const s = baseSeed();
  s.tournamentRegistrations = [reg(null, U.B.uid, 'EVLIVE', '鮑伯', 5)];
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(byNick(r.body, '快照B').inTournament, false, 'email 為 null 的報名列竟然對上了');
});
await T('B4 ⭐ TREGS 的 email 沒有正規化：大小寫不同仍要對得上（_frNormEmail）', async () => {
  const s = baseSeed();
  s.tournamentRegistrations = [reg('Bob@Example.COM', U.B.uid, 'EVLIVE', null, 5)];
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(byNick(r.body, '快照B').inTournament, true, '大小寫不同就對不上了（應該過 _frNormEmail）');
});
await T('B5 ⚠⚠ 非 accepted 的關係**完全不帶** inTournament 欄位（待確認／送出中／被我封鎖）', async () => {
  const s = baseSeed();
  s.friendships = [
    mkRow(U.A.email, U.B.email, 'pending', { requester: U.B.email }),                     // 待我確認
    mkRow(U.A.email, U.C.email, 'pending', { requester: U.A.email }),                     // 我送出的
    mkRow(U.A.email, U.D.email, 'blocked', { blockedBy: U.A.email }),                     // 我封鎖的
  ];
  s.tournamentMatches = [
    match(S_MATCH + '_1', 'EVLIVE', 'playing', U.B.uid, S_OPPUID),
    match(S_MATCH + '_2', 'EVLIVE', 'playing', U.C.uid, S_OPPUID + '2'),
    match(S_MATCH + '_3', 'EVLIVE', 'playing', U.D.uid, S_OPPUID + '3'),
  ];
  s.tournamentRegistrations = [reg(U.B.email, U.B.uid, 'EVLIVE', null, 5), reg(U.C.email, U.C.uid, 'EVLIVE', null, 5), reg(U.D.email, U.D.uid, 'EVLIVE', null, 5)];
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  const all = [].concat(r.body.incoming, r.body.outgoing, r.body.blocked);
  assert.strictEqual(all.length, 3, '三種非 accepted 關係都要在（掃描器下限）');
  for (const p of all) assert.ok(!('inTournament' in p), '⚠⚠ 非 accepted 的關係帶了 inTournament：' + JSON.stringify(p));
  assert.strictEqual(r.body.friends.length, 0);
});
await T('B6 好友沒報名任何進行中賽事 ⇒ false；且欄位型別一律是布林（不是 undefined／字串）', async () => {
  const s = baseSeed();
  s.tournamentMatches = []; s.tournamentRegistrations = [];
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(r.body.friends.length, 3);
  for (const f of r.body.friends) assert.strictEqual(typeof f.inTournament, 'boolean', 'inTournament 不是布林：' + JSON.stringify(f));
  assert.ok(r.body.friends.every((f) => f.inTournament === false));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐ N+1 防護 ／ 沒有賽事時零查詢 ／ 5 秒共用快照');
function manyFriends(n, playingCount) {
  const rows = [], regs = [], matches = [];
  for (let i = 0; i < n; i++) {
    const e = 'p' + String(i).padStart(3, '0') + '@example.com';
    rows.push(mkRow(U.A.email, e, 'accepted'));
    regs.push(reg(e, 'u' + i, 'EVLIVE', 'N' + i, 100 + i));
    if (i < playingCount) matches.push(match('M' + i, 'EVLIVE', 'playing', 'u' + i, S_OPPUID + i));
  }
  return seedOf({
    friendships: rows, tournamentEvents: [{ _id: 'EVLIVE', status: 'running', name: S_EVENT }],
    tournamentMatches: matches, tournamentRegistrations: regs,
  });
}
const qcount = (db) => ({
  ev: ops(db, 'tournamentEvents').length,
  match: ops(db, 'tournamentMatches').length,
  regFind: ops(db, 'tournamentRegistrations', /^(find|findOne|countDocuments)$/).length,
  regAgg: ops(db, 'tournamentRegistrations', /^aggregate$/).length,
});
await T('C1 ⭐⭐ 100 個好友（其中 40 個正在對戰）⇒ tournamentEvents 1 發、tournamentMatches 1 發、tournamentRegistrations 1 發 find（＋v6.295 暱稱 aggregate 1 發）', async () => {
  const H = buildFriends(FR, { seed: manyFriends(100, 40), dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.friends.length, 100);
  assert.strictEqual(r.body.friends.filter((f) => f.inTournament).length, 40, '對戰中人數不對：' + r.body.friends.filter((f) => f.inTournament).length);
  assert.deepStrictEqual(qcount(H.db), { ev: 1, match: 1, regFind: 1, regAgg: 1 }, '⚠⚠ N+1！查詢次數＝' + JSON.stringify(qcount(H.db)));
});
await T('C2 ⭐⭐ 查詢次數與好友人數**無關**：10 人與 100 人的四個數字逐一相同', async () => {
  const H10 = buildFriends(FR, { seed: manyFriends(10, 4), dbOpts: { indexes: FULL_IDX } });
  await list(H10);
  const H100 = buildFriends(FR, { seed: manyFriends(100, 40), dbOpts: { indexes: FULL_IDX } });
  await list(H100);
  assert.deepStrictEqual(qcount(H10.db), qcount(H100.db), '⚠⚠ 查詢次數隨好友人數變動（N+1）：10人 ' + JSON.stringify(qcount(H10.db)) + ' vs 100人 ' + JSON.stringify(qcount(H100.db)));
  assert.deepStrictEqual(qcount(H10.db), { ev: 1, match: 1, regFind: 1, regAgg: 1 });
});
await T('C3 ⭐ 沒有賽事在進行 ⇒ tournamentMatches 與 tournamentRegistrations(find) **零**查詢（絕大多數時間的情況）', async () => {
  const s = manyFriends(100, 0);
  s.tournamentEvents = [{ _id: 'EVOLD', status: 'finished', name: S_EVENT }];
  const H = buildFriends(FR, { seed: s, dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.strictEqual(r.code, 200);
  const q = qcount(H.db);
  assert.strictEqual(q.ev, 1, 'tournamentEvents 應該只查 1 發');
  assert.strictEqual(q.match, 0, '沒有進行中賽事卻查了 tournamentMatches：' + q.match);
  assert.strictEqual(q.regFind, 0, '沒有進行中賽事卻查了 tournamentRegistrations：' + q.regFind);
  assert.ok(r.body.friends.every((f) => f.inTournament === false));
});
await T('C4 ⭐ 5 秒共用快照：連續兩發 list ⇒ 那三發查詢仍各只有 1 次（不是新增輪詢）', async () => {
  const H = buildFriends(FR, { seed: manyFriends(20, 5), dbOpts: { indexes: FULL_IDX } });
  await list(H); await list(H); await list(H);
  const q = qcount(H.db);
  assert.strictEqual(q.ev, 1, '快照沒生效：tournamentEvents 查了 ' + q.ev + ' 次');
  assert.strictEqual(q.match, 1, '快照沒生效：tournamentMatches 查了 ' + q.match + ' 次');
  assert.strictEqual(q.regFind, 1, '快照沒生效：tournamentRegistrations 查了 ' + q.regFind + ' 次');
});
await T('C5 ⭐ in-flight 合併：三發**併發**的 list ⇒ 那三發查詢仍各只有 1 次（同時段多少人開清單都只打一輪）', async () => {
  const H = buildFriends(FR, { seed: manyFriends(20, 5), dbOpts: { indexes: FULL_IDX, ioDelay: true } });
  const rs = await Promise.all([list(H), list(H), list(H)]);
  for (const r of rs) assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  const q = qcount(H.db);
  assert.strictEqual(q.match, 1, 'in-flight 沒合併：tournamentMatches 查了 ' + q.match + ' 次');
  assert.strictEqual(q.regFind, 1, 'in-flight 沒合併：tournamentRegistrations 查了 ' + q.regFind + ' 次');
  for (const r of rs) assert.strictEqual(r.body.friends.filter((f) => f.inTournament).length, 5);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐ 索引不存在 ⇒ 整段跳過、一律 false、零掃描');
const IDX_CASES = [
  ['tournamentEvents {status:1}', { tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }], tournamentMatches: [{ eventId: 1, status: 1 }] }],
  ['tournamentMatches {eventId:1,status:1}', { tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }], tournamentEvents: [{ status: 1 }] }],
  ['tournamentRegistrations {eventId:1}', { tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }], tournamentEvents: [{ status: 1 }], tournamentMatches: [{ eventId: 1, status: 1 }] }],
];
for (const [label, idx] of IDX_CASES) {
  await T('D1 缺「' + label + '」⇒ 對三張表**零**查詢、inTournament 全 false、留一行 warn', async () => {
    const H = buildFriends(FR, { seed: baseSeed(), dbOpts: { indexes: idx, noAutoIndex: true } });
    const r = await list(H);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const q = qcount(H.db);
    assert.strictEqual(q.ev, 0, '⚠⚠ 沒有索引卻還是查了 tournamentEvents（＝全表掃）');
    assert.strictEqual(q.match, 0, '⚠⚠ 沒有索引卻還是查了 tournamentMatches（＝全表掃）');
    assert.strictEqual(q.regFind, 0, '⚠⚠ 沒有索引卻還是查了 tournamentRegistrations（＝全表掃）');
    assert.ok(r.body.friends.length === 3 && r.body.friends.every((f) => f.inTournament === false), '索引缺席時 inTournament 必須一律 false');
    assert.ok(H.logs.some((l) => l.includes('[friends]') && l.includes('正在錦標賽對戰中')), '索引缺席應留一行 warn 讓站長查得到');
  });
}
await T('D2 ⭐⭐ 正對照：拿掉索引自驗那一行 ⇒ D1 紅在「全表掃」', async () => {
  const bad = mutate(FR, '      if (!(await _frTournIdxReady())) return null;\n', '');
  await mutantMustBreak('無索引自驗', async () => {
    const H = buildFriends(bad, { seed: baseSeed(), dbOpts: { indexes: IDX_CASES[0][1], noAutoIndex: true } });
    await list(H);
    assert.strictEqual(ops(H.db, 'tournamentEvents').length, 0, '⚠⚠ 沒有索引卻還是查了 tournamentEvents（＝全表掃）');
  }, '全表掃');
});
await T('D3 索引自驗的三個 key 字串與實際查詢用的欄位一致（不得漂移）', () => {
  assert.ok(FR.includes(`const FR_EV_IDX_KEY = '{"status":1}';`), 'FR_EV_IDX_KEY 變了');
  assert.ok(FR.includes(`const FR_MATCH_IDX_KEY = '{"eventId":1,"status":1}';`), 'FR_MATCH_IDX_KEY 變了');
  assert.ok(FR.includes(`const FR_REG_EV_IDX_KEY = '{"eventId":1}';`), 'FR_REG_EV_IDX_KEY 變了');
  assert.ok(/\.find\(\{ status: 'running' \}/.test(FR), '賽事查詢不是 { status: "running" }');
  assert.ok(/eventId: \{ \$in: evIds \}, status: 'playing'/.test(FR), '對戰查詢不是 { eventId:$in, status:"playing" }');
  assert.ok(/eventId: \{ \$in: evIds \}, uid: \{ \$in:/.test(FR), '報名查詢不是 { eventId:$in, uid:$in }（走反方向才不會 FETCH 全部歷史報名）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】隱私：只回布林、零賽事資訊、零 email');
await T('E1 ⭐⭐⭐ 賽事名稱／房號／matchId／對手 uid 的哨兵在回應中**零**出現；inTournament 一律是布林', async () => {
  const H = buildFriends(FR, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  const s = JSON.stringify(r.body);
  for (const [name, sent] of [['賽事名稱', S_EVENT], ['房號', S_ROOM], ['matchId', S_MATCH], ['對手 uid', S_OPPUID]]) {
    assert.strictEqual(s.split(sent).length - 1, 0, '⚠⚠⚠ 回應洩漏了' + name + '：' + s.slice(0, 400));
  }
  for (const f of r.body.friends) assert.strictEqual(typeof f.inTournament, 'boolean', 'inTournament 不是布林：' + JSON.stringify(f));
  // 掃描器正對照：這些哨兵本來就在 DB 假資料裡（否則 E1 是恆真式）
  const dbTxt = JSON.stringify(H.db.snapshot('tournamentEvents').concat(H.db.snapshot('tournamentMatches')));
  for (const sent of [S_EVENT, S_ROOM, S_MATCH, S_OPPUID]) assert.ok(dbTxt.includes(sent), '掃描器正對照：DB 裡沒有哨兵 ' + sent);
});
await T('E2 ⭐ 回應零 email（含半個 email）—— 新欄位不得把對方 email 帶出去', async () => {
  const H = buildFriends(FR, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
  const r = await list(H);
  assert.deepStrictEqual(findEmails(r.body), [], '洩漏 email：' + JSON.stringify(r.body).slice(0, 400));
  assert.ok(!JSON.stringify(r.body).includes('@'), '回應含 @');
  for (const lp of ['alice', 'bob', 'carol', 'dave']) assert.ok(!JSON.stringify(r.body).includes(lp), '洩漏半個 email「' + lp + '」');
  assert.ok(findEmails(H.db.snapshot('friendships').concat(H.db.snapshot('tournamentRegistrations'))).length >= 3, '掃描器正對照：DB 假資料裡 email 太少');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】讓路節拍（> 200 筆才觸發得到）');
function bigSeed() {
  const rows = [], regs = [], matches = [];
  for (let i = 0; i < 250; i++) {
    const e = 'q' + String(i).padStart(3, '0') + '@example.com';
    rows.push(mkRow(U.A.email, e, 'accepted'));
    regs.push(reg(e, 'u' + i, 'EVLIVE', 'N' + i, 100 + i));
    matches.push(match('M' + i, 'EVLIVE', 'playing', 'u' + i, S_OPPUID + i));
  }
  return seedOf({ friendships: rows, tournamentEvents: [{ _id: 'EVLIVE', status: 'running', name: S_EVENT }], tournamentMatches: matches, tournamentRegistrations: regs });
}
await T('F1 ⭐ 250 好友＋250 場 playing＋250 筆報名 ⇒ ticks 恰 4（好友迴圈 1 ＋ 暱稱迴圈 1 ＋ 對戰迴圈 1 ＋ 報名迴圈 1；playerIdentity 空 ⇒ 0）', async () => {
  const yc = { ticks: 0 };
  const H = buildFriends(FR, { seed: bigSeed(), yieldCounter: yc, dbOpts: { indexes: FULL_IDX, ioDelay: true } });
  const r = await list(H);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.friends.length, 250);
  assert.strictEqual(r.body.friends.filter((f) => f.inTournament).length, 250);
  assert.strictEqual(yc.ticks, 4, '讓路節拍：預期 4 次（好友／暱稱／對戰／報名各 1），實得 ' + yc.ticks);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】突變：每一個都要紅在預期那一條');
await T('G1 突變：只認 pending 的對戰 ⇒ B1 紅', async () => {
  const bad = mutate(FR, "status: 'playing' },\n        { projection: { p1uid: 1, p2uid: 1 } }", "status: 'pending' },\n        { projection: { p1uid: 1, p2uid: 1 } }");
  await mutantMustBreak('只認 pending', async () => {
    const H = buildFriends(bad, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
    const r = await list(H);
    assert.strictEqual(byNick(r.body, '鮑伯').inTournament, true, '正在錦標賽對戰中的好友應為 true');
  }, '正在錦標賽對戰中的好友應為 true');
});
await T('G2 突變：不篩 running（連已結束賽事都算）⇒ B2 紅', async () => {
  const bad = mutate(FR, "find({ status: 'running' }, { projection: { _id: 1 } })", 'find({}, { projection: { _id: 1 } })');
  await mutantMustBreak('不篩 running', async () => {
    const H = buildFriends(bad, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
    const r = await list(H);
    assert.strictEqual(byNick(r.body, '大衛').inTournament, false, '已結束賽事的殘留對戰被算成「正在對戰中」');
  }, '已結束賽事的殘留對戰');
});
await T('G3 突變：非 accepted 也帶 inTournament ⇒ B5 紅', async () => {
  const bad = mutate(FR,
    "          if (d.status === 'accepted') { p.inTournament = !!(tplay && tplay.has(_oe)); friends.push(p); }\n",
    "          p.inTournament = !!(tplay && tplay.has(_oe));\n          if (d.status === 'accepted') { friends.push(p); }\n");
  await mutantMustBreak('非 accepted 也帶', async () => {
    const s = baseSeed();
    s.friendships = [mkRow(U.A.email, U.B.email, 'pending', { requester: U.B.email })];
    const H = buildFriends(bad, { seed: s, dbOpts: { indexes: FULL_IDX } });
    const r = await list(H);
    for (const p of r.body.incoming) assert.ok(!('inTournament' in p), '⚠⚠ 非 accepted 的關係帶了 inTournament：' + JSON.stringify(p));
  }, '非 accepted 的關係帶了 inTournament');
});
await T('G4 突變：報名 email 不過 _frNormEmail ⇒ B4（大小寫）紅', async () => {
  const bad = mutate(FR, '          const e = _frNormEmail(r.email);\n', '          const e = r.email;\n');
  await mutantMustBreak('email 不正規化', async () => {
    const s = baseSeed();
    s.tournamentRegistrations = [reg('Bob@Example.COM', U.B.uid, 'EVLIVE', null, 5)];
    const H = buildFriends(bad, { seed: s, dbOpts: { indexes: FULL_IDX } });
    const r = await list(H);
    assert.strictEqual(byNick(r.body, '快照B').inTournament, true, '大小寫不同就對不上了（應該過 _frNormEmail）');
  }, '大小寫不同就對不上了');
});
await T('G5 突變：inTournament 回對方 email 而不是布林 ⇒ E2 紅在洩漏 email', async () => {
  const bad = mutate(FR, 'p.inTournament = !!(tplay && tplay.has(_oe));', 'p.inTournament = (tplay && tplay.has(_oe)) ? _oe : false;');
  await mutantMustBreak('回 email 不回布林', async () => {
    const H = buildFriends(bad, { seed: baseSeed(), dbOpts: { indexes: FULL_IDX } });
    const r = await list(H);
    assert.deepStrictEqual(findEmails(r.body), [], '洩漏 email：' + JSON.stringify(r.body).slice(0, 400));
  }, '洩漏 email');
});
await T('G6 突變：拿掉共用快照（每發都重查）⇒ C4 紅', async () => {
  const bad = mutate(FR, '      if (_frTournSnap.at && now - _frTournSnap.at < FR_TOURN_TTL_MS) return _frTournSnap.emails;\n', '');
  await mutantMustBreak('無共用快照', async () => {
    const H = buildFriends(bad, { seed: manyFriends(20, 5), dbOpts: { indexes: FULL_IDX } });
    await list(H); await list(H); await list(H);
    assert.strictEqual(ops(H.db, 'tournamentMatches').length, 1, '快照沒生效：tournamentMatches 查了 ' + ops(H.db, 'tournamentMatches').length + ' 次');
  }, '快照沒生效');
});
await T('G7 突變：拿掉報名迴圈的讓路 ⇒ F1 紅', async () => {
  const bad = mutate(FR, '        const w = y(++j); if (w) await w;   // ⚠ 每 200 筆讓路（v6.242）\n', '        ++j;\n');
  await mutantMustBreak('報名迴圈無讓路', async () => {
    const yc = { ticks: 0 };
    const H = buildFriends(bad, { seed: bigSeed(), yieldCounter: yc, dbOpts: { indexes: FULL_IDX, ioDelay: true } });
    await list(H);
    assert.strictEqual(yc.ticks, 4, '讓路節拍：預期 4 次（好友／暱稱／對戰／報名各 1），實得 ' + yc.ticks);
  }, '讓路節拍');
});
await T('G8 突變：沒有進行中賽事時仍往下查 ⇒ C3 紅在「沒有進行中賽事卻查了」', async () => {
  const bad = mutate(FR, '      if (!evIds.length) return new Set();', '      if (!evIds.length) evIds.push(null);');
  await mutantMustBreak('空賽事仍往下查', async () => {
    const s = manyFriends(100, 0);
    s.tournamentEvents = [{ _id: 'EVOLD', status: 'finished', name: S_EVENT }];
    const H = buildFriends(bad, { seed: s, dbOpts: { indexes: FULL_IDX } });
    await list(H);
    assert.strictEqual(ops(H.db, 'tournamentMatches').length, 0, '沒有進行中賽事卻查了 tournamentMatches：' + ops(H.db, 'tournamentMatches').length);
  }, '沒有進行中賽事卻查了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】test chain ／ 版本一致（不 pin 版本號）');
await T('H1 本守衛在 package.json 的 test chain（只加進 iron-rules-audit 等於沒加）', () => {
  const t = JSON.parse(PKG).scripts.test;
  assert.ok(t.includes('scripts/test-v6300-friends-intournament.mjs'), '沒有加進 npm test 的 chain');
});
await T('H2 版本一致：version.ts ＝ admin.html SITE_VERSION_HINT（比較而非 pin 死數字）', () => {
  const V = /VERSION = '([\d.]+)'/.exec(VERTS)[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'admin.html hint ' + H + ' ≠ version.ts ' + V);
});
await T('H3 FRIENDS 區塊版號 log 有對應的變更條目（同樣不 pin 死版本號）', () => {
  const m = /console\.log\('\[friends\] endpoints registered \(v(\d+)\.(\d+)\)/.exec(PATCH);
  assert.ok(m, '少了版號 log');
  assert.ok(PATCH.includes('v' + m[1] + '.' + m[2] + '（v6.'), '版號 log v' + m[1] + '.' + m[2] + ' 在區塊開頭找不到對應的變更條目');
});
await T('H4 ⚠ 本守衛自己不 pin 死版本號（除了兩把既有的錦標賽 sha256，那兩把是「不得改動」的鎖）', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = self.split('\n').filter((l) => !/SHA256|^\/\/|測試站|v6\.300 守衛|console\.log/.test(l)).join('\n');
  const pins = [...body.matchAll(/['"`]6\.\d{3}['"`]/g)].map((x) => x[0]);
  assert.deepStrictEqual(pins, [], '守衛裡 pin 了版本號：' + pins.join(', '));
});

console.log('\n══ v6.300 好友「正在錦標賽對戰中」守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
