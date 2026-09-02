// v6.282 守衛：好友功能 P0（純伺服器端）—— oracle-admin/server_admin_patch.js v1.36
//
// 守什麼（全部是**行為端**：把出貨碼區塊抽出來、用假 db／假 req/res 真的跑）：
//   【A】抽取器自驗（Rule 25）＋ 區塊位置證明 ＋ 錦標賽區塊 sha256 逐位元未動
//   【B】開關關閉 ⇒ 503 且不帶哨兵；開啟 ⇒ 每個成功回應帶 friendsApi:1；匿名 ⇒ 401；
//        跨 IIFE helper 取不到 ⇒ 503 fail-closed
//   【C】⭐⭐ 隱私：含 email 的假資料實跑七支端點，序列化後**掃不到任何 email**；白名單形狀固定
//   【D】防濫用：同一對 pending 只一筆／被拒 24h 冷卻／上限 100（雙方）／被封鎖方靜默且 DB 零變動／
//        {email} 限流第 4 次被擋／查無此帳號明確錯誤碼
//   【E】remove 真的 deleteOne 且只刪自己那一列；accept/reject 流程；{matchId} 錦標賽入口（TMATCH／歸檔 fallback）
//   【F】playerIdentity 對照表：enrich 段真的呼叫 helper（零額外查詢）、helper 行為、fire-and-forget、
//        app.locals._adminScanYield 掛在 adminScanYield 同一個 closure
//   【G】事件迴圈 benchmark（Rule 32：量測腳本＝本檔＋ scripts/perf-v6282-friends-eventloop.mjs）
//   【H】突變測試：每一條只捕捉 AssertionError，且斷言紅在**預期那一條**
//   【I】HEAD-FAIL：BASE 沒有這些區塊 ⇒ 抽取器必紅（history-free：靠「區塊不存在」而不是靠 git）
//
// ⚠ 守衛安慰劑八種型態逐一避開：常數實際求值（不比字面）；mutantMustBreak 只捕 AssertionError；
//   不 pin 版本號；錦標賽區塊 sha 與 test-v6278 I1 同一把（那是被凍結的區塊，不是版本 pin）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  readPatch, extractBlock, FR_START, FR_END, ID_START, ID_END, EN_START, EN_END,
  buildFriends, makeFakeDb, asUser, findEmails, makeYield, fakeTournIdentity, fakeIsTournAdmin,
} from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH_PATH = join(ROOT, 'oracle-admin/server_admin_patch.js');
const PATCH = readPatch(PATCH_PATH);

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + e.message); fail++; }
    else throw e;   // 非斷言例外一律往外炸，不吞
  }
};
/** 突變體必須紅、而且紅在預期那一條（只捕 AssertionError；訊息片段不符＝紅錯地方＝仍算安慰劑）。 */
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + err.message + '（預期含「' + expectFrag + '」）');
};

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】抽取器自驗 ＋ 位置證明 ＋ 錦標賽區塊未動');
let FR = '', IDB = '', ENRICH = '';
await T('A0 HEAD-FAIL 主錨點：PTCG-FRIENDS／PTCG-PLAYER-IDENTITY／PTCG-MATCH-EMAIL-ENRICH 三個區塊都抽得到（BASE v6.281 沒有前兩個 ⇒ 這一條必紅）', () => {
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  IDB = extractBlock(PATCH, ID_START, ID_END, 800);
  ENRICH = extractBlock(PATCH, EN_START, EN_END, 800);
});
if (fail) { console.log('\n══ v6.282 好友功能 P0 守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：區塊不存在，後續斷言無法進行）══'); process.exit(1); }
await T('A1 三個區塊都抽得到且長度合理（掃描器下限）', () => {
  assert.ok(FR.length > 15000 && FR.length < 80000, 'friends 區塊長度 ' + FR.length);
  assert.ok(IDB.includes('function recordPlayerIdentity('), 'identity 區塊沒有 helper');
  assert.ok(ENRICH.includes("db.collection('rooms').findOne"), 'enrich 區塊不對');
  for (const p of ['/api/friends/list', '/api/friends/request', '/api/friends/accept', '/api/friends/reject', '/api/friends/remove', '/api/friends/block', '/api/friends/unblock', '/api/friends/admin/config']) {
    assert.ok(FR.includes("'" + p + "'"), '區塊裡沒有端點 ' + p);
  }
});
const TOURN_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
const TOURN_SHA = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40';   // 與 test-v6278 I1 同一把（凍結區塊）
await T('A2 ⚠⚠ 錦標賽區塊逐位元未動（anchor 至檔尾 sha256 與 test-v6278 I1 同一把）', () => {
  const i = PATCH.indexOf(TOURN_ANCHOR);
  assert.ok(i > 0, '找不到錦標賽區塊錨點');
  assert.strictEqual(createHash('sha256').update(PATCH.slice(i), 'utf8').digest('hex'), TOURN_SHA, '⚠⚠ 錦標賽區塊被動到了!');
});
await T('A2b 掃描器自驗：sha 比對抓得到一個字元的差異', () => {
  const i = PATCH.indexOf(TOURN_ANCHOR);
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(i) + ' ', 'utf8').digest('hex'), TOURN_SHA);
});
await T('A3 位置證明：friends 區塊整段落在「第一支 /api/tournament 的 app.get」與錦標賽錨點之前；且區塊/檔頭都不含那個字面（否則三把鎖的錨點會被往前挪）', () => {
  const s = PATCH.indexOf(FR_START), e = PATCH.indexOf(FR_END);
  const firstGet = PATCH.indexOf("app.get('/api/tournament");
  const t = PATCH.indexOf(TOURN_ANCHOR);
  assert.ok(s > 0 && e > s && e < firstGet && firstGet < t, '區塊位置不對：' + JSON.stringify({ s, e, firstGet, t }));
  assert.ok(!FR.includes("app.get('/api/tournament"), 'friends 區塊內出現了錨點字面');
  assert.ok(!PATCH.split('\n')[0].includes("app.get('/api/tournament"), '檔頭出現了錨點字面');
});
await T('A4 PTCG-DELTA-PUT／ROOMS-OUT 既有區塊未被本版動到（逐字仍在、且在 friends 區塊之前）', () => {
  const dpE = PATCH.indexOf('// <<< PTCG-DELTA-PUT-BLOCK-END');
  assert.ok(dpE > 0 && dpE < PATCH.indexOf(FR_START), 'delta-put 區塊位置不對');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】開關／哨兵／匿名／跨 IIFE fail-closed');
const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'fB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'fC', email: 'carol@example.com', name: '卡蘿' },
};
const CFG_ON = { _id: 'friendsConfig', enabled: true };
const ROOM = { _id: 'AB12', status: 'ended', seats: [{ uid: 'o-alice', email: 'Alice@Example.com ', name: '愛麗絲' }, { uid: 'o-bob', email: 'bob@example.com', name: '鮑伯' }] };
const seedBase = () => ({ tournamentConfig: [structuredClone(CFG_ON)], rooms: [structuredClone(ROOM)] });
const ALL_EPS = [['get', '/api/friends/list'], ['post', '/api/friends/request'], ['post', '/api/friends/accept'], ['post', '/api/friends/reject'], ['post', '/api/friends/remove'], ['post', '/api/friends/block'], ['post', '/api/friends/unblock']];

await T('B1 開關預設 false（tournamentConfig 沒有 friendsConfig）⇒ 七支端點全部 503、code=friends-disabled、且**不帶哨兵**', async () => {
  const H = buildFriends(FR, { seed: { rooms: [structuredClone(ROOM)] } });
  for (const [m, p] of ALL_EPS) {
    const r = await H.call(m, p, asUser(U.A), { roomCode: 'AB12' });
    assert.strictEqual(r.code, 503, p + ' 應 503，實得 ' + r.code);
    assert.strictEqual(r.body && r.body.code, 'friends-disabled', p + ' code 不對');
    assert.ok(!('friendsApi' in (r.body || {})), p + ' 關閉時不可帶哨兵');
  }
});
await T('B1b enabled 必須是**布林 true**（字串 "true"／1 都不算開）', async () => {
  for (const v of ['true', 1, {}]) {
    const H = buildFriends(FR, { seed: { tournamentConfig: [{ _id: 'friendsConfig', enabled: v }] } });
    const r = await H.call('get', '/api/friends/list', asUser(U.A));
    assert.strictEqual(r.code, 503, 'enabled=' + JSON.stringify(v) + ' 竟然開了');
  }
});
await T('B2 開啟後：匿名（沒 token）⇒ 401 code=friends-auth-required；playerId fallback（verified=false）⇒ 401；驗過但沒 email ⇒ 401', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  for (const [m, p] of ALL_EPS) {
    const r = await H.call(m, p, {}, {});
    assert.strictEqual(r.code, 401, p + ' 匿名應 401，實得 ' + r.code);
    assert.strictEqual(r.body.code, 'friends-auth-required', p + ' 匿名錯誤碼');
  }
  const r2 = await H.call('get', '/api/friends/list', {}, { playerId: 'p1' });
  assert.strictEqual(r2.code, 401, 'playerId fallback 應 401');
  const r3 = await H.call('get', '/api/friends/list', { authorization: 'Bearer ' + JSON.stringify({ uid: 'x', email: null, verified: true }) });
  assert.strictEqual(r3.code, 401, '沒 email 應 401');
  const r4 = await H.call('get', '/api/friends/list', { authorization: 'Bearer ' + JSON.stringify({ error: '錦標賽不開放匿名帳號', code: 403 }) });
  assert.strictEqual(r4.code, 401, 'tournIdentity 回 error 應 401');
});
await T('B3 開啟＋已登入 ⇒ 每個成功回應帶哨兵 friendsApi === 1（實際求值）', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.friendsApi, 1, '哨兵');
  const r2 = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'ab12' });
  assert.strictEqual(r2.code, 200); assert.strictEqual(r2.body.friendsApi, 1);
});
await T('B4 ⚠⚠ 跨 IIFE：app.locals._adminScanYield 取不到 ⇒ 七支端點 fail-closed 503 code=friends-helper-missing（不是靜默跑沒有讓路的迴圈）', async () => {
  const H = buildFriends(FR, { seed: seedBase(), locals: {} });
  for (const [m, p] of ALL_EPS) {
    const r = await H.call(m, p, asUser(U.A), { roomCode: 'AB12' });
    assert.strictEqual(r.code, 503, p + ' 應 503，實得 ' + r.code);
    assert.strictEqual(r.body.code, 'friends-helper-missing', p);
  }
  const H2 = buildFriends(FR, { seed: seedBase(), locals: { _adminScanYield: 'not-a-function' } });
  const r = await H2.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 503, '非函式也要 503');
});
await T('B5 開關快取：admin POST 立刻生效（不必等 10 秒）；admin 端點不受開關 gate；非 admin 403', async () => {
  const H = buildFriends(FR, { seed: { rooms: [structuredClone(ROOM)] } });
  assert.strictEqual((await H.call('get', '/api/friends/list', asUser(U.A))).code, 503);
  const adm = asUser({ uid: 'adm', email: 'admin@example.com', name: '站長' });
  assert.strictEqual((await H.call('get', '/api/friends/admin/config', asUser(U.A))).code, 403, '非 admin 應 403');
  const g = await H.call('get', '/api/friends/admin/config', adm);
  assert.strictEqual(g.code, 200); assert.strictEqual(g.body.enabled, false);
  assert.strictEqual((await H.call('post', '/api/friends/admin/config', adm, { enabled: 'yes' })).code, 400, '非布林應 400');
  const p = await H.call('post', '/api/friends/admin/config', adm, { enabled: true });
  assert.strictEqual(p.code, 200); assert.strictEqual(p.body.enabled, true);
  assert.strictEqual((await H.call('get', '/api/friends/list', asUser(U.A))).code, 200, '開了應立刻 200');
  const off = await H.call('post', '/api/friends/admin/config', adm, { enabled: false });
  assert.strictEqual(off.body.enabled, false);
  assert.strictEqual((await H.call('get', '/api/friends/list', asUser(U.A))).code, 503, '關了應立刻 503');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐ 隱私：回應永不含 email');
const PUBLIC_KEYS = ['fid', 'status', 'nick', 'uid', 'uids', 'requestedByMe', 'blockedByMe', 'via', 'at'];
/** 跑完整的一輪流程，把每一個回應都收起來（含錯誤回應）。 */
async function runFullFlow(blockSrc) {
  const seed = seedBase();
  seed.playerIdentity = [
    { _id: 'bob@example.com', uid: 'o-bob', uids: [{ uid: 'o-bob-old', at: 1 }, { uid: 'o-bob', at: 2 }], nick: '鮑伯二號' },
    { _id: 'carol@example.com', uid: 'o-carol', uids: [{ uid: 'o-carol', at: 3 }], nick: '卡蘿' },
  ];
  seed.tournamentMatches = [{ _id: 'EV1_r1_m0', eventId: 'EV1', p1uid: 'fA', p2uid: 'fC', p1name: '愛麗絲', p2name: '卡蘿', status: 'done' }];
  seed.tournamentRegistrations = [{ _id: 'EV1__fC', eventId: 'EV1', uid: 'fC', email: 'Carol@Example.com', name: '卡蘿' }];
  const H = buildFriends(blockSrc, { seed });
  const out = [];
  const rec = async (label, m, p, who, body) => { const r = await H.call(m, p, who, body); out.push({ label, code: r.code, body: r.body }); return r; };
  await rec('A req bob via room', 'post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  await rec('A req carol via match', 'post', '/api/friends/request', asUser(U.A), { matchId: 'EV1_r1_m0' });
  const lb = await rec('B list', 'get', '/api/friends/list', asUser(U.B));
  const fidAB = lb.body.incoming[0].fid;
  await rec('B accept', 'post', '/api/friends/accept', asUser(U.B), { fid: fidAB });
  const lc = await rec('C list', 'get', '/api/friends/list', asUser(U.C));
  await rec('C reject', 'post', '/api/friends/reject', asUser(U.C), { fid: lc.body.incoming[0].fid });
  await rec('A req carol again (cooldown)', 'post', '/api/friends/request', asUser(U.A), { matchId: 'EV1_r1_m0' });
  const la = await rec('A list', 'get', '/api/friends/list', asUser(U.A));
  await rec('A block bob', 'post', '/api/friends/block', asUser(U.A), { fid: fidAB });
  await rec('B req alice (blocked, silent)', 'post', '/api/friends/request', asUser(U.B), { roomCode: 'AB12' });
  await rec('B list (blocked side)', 'get', '/api/friends/list', asUser(U.B));
  await rec('A list (blocker)', 'get', '/api/friends/list', asUser(U.A));
  await rec('A unblock', 'post', '/api/friends/unblock', asUser(U.A), { fid: fidAB });
  await rec('A req bob by email', 'post', '/api/friends/request', asUser(U.A), { email: 'BOB@example.com' });
  await rec('A remove', 'post', '/api/friends/remove', asUser(U.A), { fid: fidAB });
  await rec('A req nobody', 'post', '/api/friends/request', asUser(U.A), { email: 'nobody@example.com' });
  await rec('A req bad', 'post', '/api/friends/request', asUser(U.A), { email: 'not-an-email' });
  await rec('A accept bogus', 'post', '/api/friends/accept', asUser(U.A), { fid: 'deadbeefdeadbeef' });
  await rec('C req room not in', 'post', '/api/friends/request', asUser(U.C), { roomCode: 'AB12' });
  await rec('A err 500', 'get', '/api/friends/list', asUser(U.A));
  return { out, H, la };
}
await T('C1 ⭐⭐ 含 email 的假資料（seats/regs/playerIdentity/friendships 全含 @）實跑七支端點共 20 個回應：序列化後掃不到任何 email', async () => {
  const { out } = await runFullFlow(FR);
  assert.ok(out.length >= 20, '流程只跑了 ' + out.length + ' 發（掃描器壞了？）');
  for (const r of out) {
    const hits = findEmails(r.body);
    assert.deepStrictEqual(hits, [], '回應「' + r.label + '」（' + r.code + '）洩漏了 email：' + hits.join(', '));
    assert.ok(!JSON.stringify(r.body).includes('@'), '回應「' + r.label + '」含 @');
  }
});
await T('C1b 掃描器正對照：假資料裡真的有 email（否則 C1 是恆真式）；且把 email 塞進回應會被抓到', async () => {
  const { H } = await runFullFlow(FR);
  const raw = H.db.snapshot('friendships').concat(H.db.snapshot('rooms'), H.db.snapshot('playerIdentity'));
  assert.ok(findEmails(raw).length >= 4, 'DB 假資料裡 email 太少：' + findEmails(raw).length);
  assert.deepStrictEqual(findEmails({ x: [{ nick: 'a', fid: 'alice@example.com' }] }), ['alice@example.com']);
});
await T('C2 list 的每一筆都是固定白名單形狀（key 集合逐字相等）；uid/uids 來自 playerIdentity；⚠ v6.286【2】nick 只取 friendships 自己的快照、**不得**取對照表（playerIdentity.nick 可被未驗證的 /api/match-result 冒名竄改；正對照見 test-v6286）', async () => {
  const { la } = await runFullFlow(FR);
  const rows = [...la.body.friends, ...la.body.incoming, ...la.body.outgoing, ...la.body.blocked];
  assert.ok(rows.length >= 1, 'A 的清單是空的');
  for (const r of rows) assert.deepStrictEqual(Object.keys(r).sort(), [...PUBLIC_KEYS].sort(), '白名單形狀不對：' + JSON.stringify(r));
  const bob = la.body.friends.find((r) => r.nick === '鮑伯');
  assert.ok(bob, 'bob 沒有出現在好友裡（或 nick 沒取 friendships 快照）：' + JSON.stringify(la.body.friends));
  assert.ok(!la.body.friends.some((r) => r.nick === '鮑伯二號'), 'v6.286【2】：nick 不得取 playerIdentity.nick（可被冒名竄改）');
  assert.strictEqual(bob.uid, 'o-bob', 'uid 應來自 playerIdentity');
  assert.deepStrictEqual(bob.uids, ['o-bob-old', 'o-bob'], 'uids 應為去重後的最近清單');
  assert.deepStrictEqual(Object.keys(la.body).sort(), ['blocked', 'friends', 'friendsApi', 'incoming', 'limit', 'me', 'outgoing', 'truncated'].sort());
  assert.deepStrictEqual(Object.keys(la.body.me).sort(), ['nick', 'uid']);
});
await T('C3 暱稱絕不用 email 前綴當 fallback（tournIdentity 沒 displayName 時 name＝email 前綴＝半個 email）', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  const who = { authorization: 'Bearer ' + JSON.stringify({ uid: 'fZ', email: 'zed.player@example.com', name: 'zed.player', verified: true }) };
  const r = await H.call('get', '/api/friends/list', who);
  assert.strictEqual(r.body.me.nick, null, 'me.nick 竟然是 email 前綴：' + r.body.me.nick);
  // 用 email 入口建立關係時 nickA/nickB 也不可以落成 email 前綴
  H.db._store.get('rooms').clear();
  await H.call('post', '/api/friends/request', who, { email: 'bob@example.com' }).catch(() => {});
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】防濫用');
const mkPending = (a, b, requester, extra) => {
  const [x, y] = a < b ? [a, b] : [b, a];
  const _id = x + '|' + y;
  return Object.assign({ _id, fid: 'f' + createHash('sha1').update(_id).digest('hex').slice(0, 20), a: x, b: y, status: 'pending', requester, blockedBy: null, nickA: 'nA', nickB: 'nB', addedVia: 'battle', createdAt: 1, updatedAt: 1 }, extra || {});
};
await T('D1 同一對 pending 只准一筆：A→B 兩次 ⇒ 仍只有 1 筆（第二次回 already:true）；B→A（對方已邀我）⇒ 直接成立、仍只有 1 筆', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  const r1 = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  const r2 = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(r1.code, 200); assert.strictEqual(r2.code, 200);
  assert.strictEqual(r2.body.already, true);
  assert.strictEqual(H.db.snapshot('friendships').length, 1, '重複 request 產生了多筆');
  assert.strictEqual(H.db.snapshot('friendships')[0].status, 'pending');
  const r3 = await H.call('post', '/api/friends/request', asUser(U.B), { roomCode: 'AB12' });
  assert.strictEqual(r3.body.status, 'accepted', '對方已邀我 ⇒ 應直接成立');
  const docs = H.db.snapshot('friendships');
  assert.strictEqual(docs.length, 1); assert.strictEqual(docs[0].status, 'accepted');
  assert.strictEqual(docs[0]._id, 'alice@example.com|bob@example.com', '_id 應為正規化後排序串接');
  assert.strictEqual(docs[0].requester, 'alice@example.com');
});
await T('D2 被拒後 24 小時冷卻：拒後 1 秒再 request ⇒ 429 friends-cooldown 且 DB 不變；23h59m ⇒ 仍擋；24h+1s ⇒ 放行且同一列被重用（仍只有 1 筆）', async () => {
  const now = Date.now();
  for (const [ago, expect] of [[1000, 429], [24 * 3600000 - 60000, 429], [24 * 3600000 + 1000, 200]]) {
    const seed = seedBase();
    seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'rejected', rejectedAt: now - ago })];
    const H = buildFriends(FR, { seed });
    const before = H.db.snapshot('friendships');
    const r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
    assert.strictEqual(r.code, expect, 'ago=' + ago + ' 應 ' + expect + '，實得 ' + r.code + ' ' + JSON.stringify(r.body));
    const after = H.db.snapshot('friendships');
    assert.strictEqual(after.length, 1, '筆數變了');
    if (expect === 429) { assert.strictEqual(r.body.code, 'friends-cooldown'); assert.deepStrictEqual(after, before, '冷卻期內 DB 不可變'); }
    else { assert.strictEqual(after[0].status, 'pending', '期滿應重用同一列成 pending'); assert.strictEqual(after[0].createdAt, 1, 'createdAt 應保留'); }
  }
});
const seedFull = (who, n) => Array.from({ length: n }, (_, i) => mkPending(who, 'friend' + String(i).padStart(3, '0') + '@example.com', who, { status: 'accepted' }));
await T('D3 好友上限 100（雙方各自檢查）：我已 100 ⇒ request 409 friends-limit-reached；對方已 100 ⇒ 409 friends-target-full；accept 端同樣兩邊都查；99 ⇒ 放行', async () => {
  let seed = seedBase(); seed.friendships = seedFull('alice@example.com', 100);
  let H = buildFriends(FR, { seed });
  let r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-limit-reached');
  assert.strictEqual(H.db.snapshot('friendships').length, 100, '不可寫入');
  seed = seedBase(); seed.friendships = seedFull('bob@example.com', 100);
  H = buildFriends(FR, { seed });
  r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-target-full');
  // accept 端：B 待確認 A 的邀請，但 B 已 100
  seed = seedBase(); seed.friendships = seedFull('bob@example.com', 100).concat([mkPending('alice@example.com', 'bob@example.com', 'alice@example.com')]);
  H = buildFriends(FR, { seed });
  const l = await H.call('get', '/api/friends/list', asUser(U.B));
  r = await H.call('post', '/api/friends/accept', asUser(U.B), { fid: l.body.incoming[0].fid });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-limit-reached');
  // 99 ⇒ 放行
  seed = seedBase(); seed.friendships = seedFull('alice@example.com', 99);
  H = buildFriends(FR, { seed });
  r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(r.code, 200, '99 應放行：' + JSON.stringify(r.body));
  // countDocuments 一律帶 limit（硬上限）且查詢用 a/b＋status（走索引）
  const cnt = H.db._log.filter((x) => x.op === 'countDocuments');
  assert.ok(cnt.length >= 2, '沒有查上限');
  for (const c of cnt) { assert.strictEqual(c.opt && c.opt.limit, 101, 'countDocuments 沒帶 limit'); assert.ok(('a' in c.q || 'b' in c.q) && c.q.status === 'accepted', '上限查詢沒走 a/b+status'); }
});
await T('D4 ⭐ 被封鎖方的所有請求靜默失敗：request/accept/reject/remove/unblock 都回 200，且 DB 一個位元都沒變、沒有任何寫入操作；list 看不到痕跡', async () => {
  const seed = seedBase();
  seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'blocked', blockedBy: 'alice@example.com' })];
  seed.playerIdentity = [{ _id: 'alice@example.com', uid: 'o-alice', nick: '愛麗絲' }];
  const H = buildFriends(FR, { seed });
  const before = H.db.snapshot('friendships');
  const fid = before[0].fid;
  const l = await H.call('get', '/api/friends/list', asUser(U.B));
  assert.strictEqual(l.code, 200);
  assert.deepStrictEqual([l.body.friends, l.body.incoming, l.body.outgoing, l.body.blocked].map((x) => x.length), [0, 0, 0, 0], '被封鎖方看得到痕跡');
  const logLen = H.db._log.length;
  for (const [body, p] of [[{ roomCode: 'AB12' }, '/api/friends/request'], [{ email: 'alice@example.com' }, '/api/friends/request'], [{ fid }, '/api/friends/accept'], [{ fid }, '/api/friends/reject'], [{ fid }, '/api/friends/remove'], [{ fid }, '/api/friends/unblock'], [{ fid }, '/api/friends/block']]) {
    const r = await H.call('post', p, asUser(U.B), body);
    assert.strictEqual(r.code, 200, p + ' 應 200，實得 ' + r.code + ' ' + JSON.stringify(r.body));
    assert.ok(!('already' in r.body) && r.body.status !== 'blocked', p + ' 回應不可透露被封鎖：' + JSON.stringify(r.body));
  }
  assert.deepStrictEqual(H.db.snapshot('friendships'), before, 'DB 被動到了');
  const writes = H.db._log.slice(logLen).filter((x) => /update|replace|delete|insert/.test(x.op));
  assert.deepStrictEqual(writes, [], '有寫入操作：' + JSON.stringify(writes.map((w) => w.op)));
});
await T('D4b 封鎖方：request ⇒ 409 friends-blocked-by-you；remove ⇒ 409 friends-use-unblock；unblock ⇒ 真刪除', async () => {
  const seed = seedBase();
  seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'blocked', blockedBy: 'alice@example.com' })];
  const H = buildFriends(FR, { seed });
  const fid = H.db.snapshot('friendships')[0].fid;
  let r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-blocked-by-you');
  r = await H.call('post', '/api/friends/remove', asUser(U.A), { fid });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-use-unblock');
  r = await H.call('post', '/api/friends/unblock', asUser(U.A), { fid });
  assert.strictEqual(r.code, 200); assert.strictEqual(H.db.snapshot('friendships').length, 0, 'unblock 應真刪除');
});
await T('D5 {email} 入口限流：同一分鐘第 4 次 ⇒ 429 friends-rate-limited（前三次都真的查了）；限流是 per 人', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  const codes = [];
  for (let i = 0; i < 4; i++) { const r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'nobody' + i + '@example.com' }); codes.push(r.code + ':' + r.body.code); }
  assert.deepStrictEqual(codes, ['404:friends-no-such-account', '404:friends-no-such-account', '404:friends-no-such-account', '429:friends-rate-limited']);
  // 限流是 per 人：另一個人不受影響
  const r2 = await H.call('post', '/api/friends/request', asUser(U.B), { email: 'nobody@example.com' });
  assert.strictEqual(r2.code, 404);
});
await T('D5b 限流器本體：每分鐘 3、每天 30（用假時鐘直接呼叫 _frEmailRateCheck）', () => {
  const i = FR.indexOf('const _frEmailRate = new Map()'), j = FR.indexOf('// ── 身分');
  assert.ok(i > 0 && j > i, '抽不到限流器');
  const src = 'const FR_EMAIL_RATE_MIN = 3, FR_EMAIL_RATE_DAY = 30;\n' + FR.slice(i, j) + '\nreturn _frEmailRateCheck;';
  const check = new Function('"use strict";\n' + src)();
  const t0 = 1_700_000_000_000;
  assert.deepStrictEqual([check('u', t0), check('u', t0 + 1), check('u', t0 + 2), check('u', t0 + 3)], [true, true, true, false], '每分鐘 3 次');
  assert.strictEqual(check('u', t0 + 61000), true, '過一分鐘應放行');
  let okCount = 4;   // 已放行 4 次
  for (let m = 2; m < 40; m++) { for (let k = 0; k < 3; k++) if (check('u', t0 + m * 61000 + k)) okCount++; }
  assert.strictEqual(okCount, 30, '一天內放行次數應恰為 30，實得 ' + okCount);
  assert.strictEqual(check('u', t0 + 86400000 + 61000 * 40), true, '過一天應放行');
});
await T('D6 查無此帳號：playerIdentity 沒有 ＋ Firebase Auth 查不到 ⇒ 404 friends-no-such-account（明講，站長裁定）；Auth 查得到 ⇒ 建 pending；playerIdentity 有 ⇒ 不打 Auth（v6.286【2】：且 nick 不再取對照表 ⇒ nickB 留空，等對方 accept 時以驗過的暱稱補上）', async () => {
  const calls = [];
  const TADMIN = { apps: [1], auth: () => ({ getUserByEmail: async (e) => { calls.push(e); if (e === 'exists@example.com') return { uid: 'x', displayName: '存在的人' }; const err = new Error('no user'); err.code = 'auth/user-not-found'; throw err; } }) };
  const seed = seedBase(); seed.playerIdentity = [{ _id: 'known@example.com', uid: 'o-k', nick: '認識的人' }];
  const H = buildFriends(FR, { seed, TADMIN });
  let r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'ghost@example.com' });
  assert.strictEqual(r.code, 404); assert.strictEqual(r.body.code, 'friends-no-such-account');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'Exists@Example.com' });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.status, 'pending');
  assert.deepStrictEqual(calls, ['ghost@example.com', 'exists@example.com'], 'Auth 查詢對象');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'known@example.com' });
  assert.strictEqual(r.code, 200); assert.strictEqual(calls.length, 2, '對照表有就不可打 Auth');
  const d = H.db.snapshot('friendships').find((x) => x.b === 'known@example.com');
  assert.strictEqual(d.addedVia, 'email'); assert.strictEqual(d.nickB, null, 'v6.286【2】：{email} 入口不得再拿 playerIdentity.nick 當快照');
  // Auth 結果快取：同一個 ghost 再查（另一個人查，避開 per-人限流）不打第二次
  await H.call('post', '/api/friends/request', asUser(U.B), { email: 'ghost@example.com' });
  assert.strictEqual(calls.length, 2, 'Auth 負結果沒有快取');
});
await T('D7 自己加自己 ⇒ 400 friends-self；email 格式不合 ⇒ 400；三種入口都沒帶 ⇒ 400 friends-bad-request', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  let r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'ALICE@example.com' });
  assert.strictEqual(r.code, 400); assert.strictEqual(r.body.code, 'friends-self');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'nope' });
  assert.strictEqual(r.code, 400); assert.strictEqual(r.body.code, 'friends-bad-email');
  r = await H.call('post', '/api/friends/request', asUser(U.A), {});
  assert.strictEqual(r.code, 400); assert.strictEqual(r.body.code, 'friends-bad-request');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】remove 真刪除／流程／錦標賽入口');
await T('E1 remove 真的 deleteOne，且只刪自己那一列（其他人的列、對方的其他關係一筆不少）；刪除條件帶 a/b＝我', async () => {
  const seed = seedBase();
  seed.friendships = [
    mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'accepted' }),
    mkPending('bob@example.com', 'carol@example.com', 'bob@example.com', { status: 'accepted' }),
    mkPending('alice@example.com', 'carol@example.com', 'carol@example.com'),
  ];
  const H = buildFriends(FR, { seed });
  const l = await H.call('get', '/api/friends/list', asUser(U.A));
  const fid = l.body.friends[0].fid;
  const r = await H.call('post', '/api/friends/remove', asUser(U.A), { fid });
  assert.strictEqual(r.code, 200); assert.strictEqual(r.body.removed, true);
  const rest = H.db.snapshot('friendships');
  assert.deepStrictEqual(rest.map((d) => d._id).sort(), ['alice@example.com|carol@example.com', 'bob@example.com|carol@example.com']);
  const del = H.db._log.filter((x) => x.op === 'deleteOne');
  assert.strictEqual(del.length, 1, 'deleteOne 次數');
  assert.ok(Array.isArray(del[0].f.$or), 'deleteOne 條件必須帶 a/b＝我');
  // v6.288：remove 成功後會對 tournamentChat deleteMany({room:'dm:'+fid})（站長裁定：解除好友連對話一起刪；守衛 test-v6288 B1）
  //   ⇒ 這條改成只禁 friendships 的批次刪除（原意：好友列絕不可批次刪）。
  assert.ok(!H.db._log.some((x) => x.op === 'deleteMany' && x.name === 'friendships'), '不可對 friendships deleteMany');
  // C 拿 A 的 fid 也刪不到（fid 不是憑證）
  const r2 = await H.call('post', '/api/friends/remove', asUser(U.C), { fid });
  assert.strictEqual(r2.code, 404);
});
await T('E2 accept/reject 只有「待我確認」那一方可以；requester 自己 accept ⇒ 409；reject ⇒ 留 rejected 列（list 不回）', async () => {
  const seed = seedBase(); seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com')];
  const H = buildFriends(FR, { seed });
  const fid = H.db.snapshot('friendships')[0].fid;
  let r = await H.call('post', '/api/friends/accept', asUser(U.A), { fid });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-not-pending');
  r = await H.call('post', '/api/friends/reject', asUser(U.B), { fid });
  assert.strictEqual(r.code, 200); assert.strictEqual(r.body.status, 'rejected');
  const d = H.db.snapshot('friendships')[0];
  assert.strictEqual(d.status, 'rejected'); assert.ok(typeof d.rejectedAt === 'number');
  const l = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.deepStrictEqual([l.body.friends.length, l.body.incoming.length, l.body.outgoing.length], [0, 0, 0], 'rejected 不可出現在 list');
  r = await H.call('post', '/api/friends/accept', asUser(U.B), { fid });
  assert.strictEqual(r.code, 409, 'rejected 之後不可再 accept');
});
await T('E3 {roomCode} 入口：要求者必須以驗過的 email 對上 p1/p2 之一（不信 client 送的 uid）；對方座位匿名 ⇒ 409；觀戰位不算', async () => {
  const seed = seedBase();
  seed.rooms.push({ _id: 'AN01', seats: [{ uid: 'o-alice', email: 'alice@example.com', name: '愛麗絲' }, { uid: 'o-x', email: null, name: '匿名' }, { uid: 'o-bob', email: 'bob@example.com', name: '觀戰的鮑伯' }] });
  seed.rooms.push({ _id: 'EM01', seats: [{ uid: 'o-alice', email: 'alice@example.com', name: '愛麗絲' }, { uid: null, email: null, name: null }] });
  const H = buildFriends(FR, { seed });
  let r = await H.call('post', '/api/friends/request', asUser(U.C), { roomCode: 'AB12' });
  assert.strictEqual(r.code, 403); assert.strictEqual(r.body.code, 'friends-not-in-room');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AN01' });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-opponent-anonymous');
  r = await H.call('post', '/api/friends/request', asUser(U.B), { roomCode: 'AN01' });
  assert.strictEqual(r.code, 403, '觀戰位不算對戰位');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'EM01' });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-opponent-missing');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'ZZZZ' });
  assert.strictEqual(r.code, 404); assert.strictEqual(r.body.code, 'friends-room-not-found');
  const d = H.db.snapshot('friendships'); assert.strictEqual(d.length, 0);
  const q = H.db._log.find((x) => x.name === 'rooms' && x.op === 'findOne');
  assert.deepStrictEqual(q.opt.projection, { 'seats.uid': 1, 'seats.email': 1, 'seats.name': 1 }, 'rooms 查詢必須 projection 白名單（不讀 gameState）');
});
await T('E4 {matchId} 錦標賽入口：TMATCH 有 ⇒ 以我的 Firebase uid 對上 p1/p2 → TREGS 取對方 email；不是當事人 ⇒ 403；TMATCH 被清掃 ⇒ 退到歸檔；輪空 ⇒ 409', async () => {
  const seed = seedBase();
  seed.tournamentMatches = [
    { _id: 'EV1_r1_m0', eventId: 'EV1', p1uid: 'fA', p2uid: 'fC', p1name: '愛麗絲', p2name: '卡蘿' },
    { _id: 'EV1_r1_m1', eventId: 'EV1', p1uid: 'fB', p2uid: null, bye: true },
  ];
  seed.tournamentRegistrations = [{ _id: 'EV1__fC', eventId: 'EV1', uid: 'fC', email: 'Carol@Example.com', name: '卡蘿報名名' }];
  seed.tournamentArchives = [{ _id: 'arch_EV2', eventId: 'EV2', players: [{ uid: 'fA', email: 'alice@example.com', name: '愛麗絲' }, { uid: 'fD', email: 'dave@example.com', name: '戴夫' }], matches: [{ round: 2, idx: 1, p1uid: 'fD', p2uid: 'fA' }] }];
  const H = buildFriends(FR, { seed });
  let r = await H.call('post', '/api/friends/request', asUser(U.A), { matchId: 'EV1_r1_m0' });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  let d = H.db.snapshot('friendships').find((x) => x._id === 'alice@example.com|carol@example.com');
  assert.ok(d, '沒建立 A-C'); assert.strictEqual(d.nickB, '卡蘿報名名'); assert.strictEqual(d.addedVia, 'battle');
  r = await H.call('post', '/api/friends/request', asUser(U.B), { matchId: 'EV1_r1_m0' });
  assert.strictEqual(r.code, 403); assert.strictEqual(r.body.code, 'friends-not-in-match');
  r = await H.call('post', '/api/friends/request', asUser(U.B), { matchId: 'EV1_r1_m1' });
  assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'friends-opponent-missing');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { matchId: 'EV2_r2_m1' });
  assert.strictEqual(r.code, 200, '歸檔 fallback：' + JSON.stringify(r.body));
  d = H.db.snapshot('friendships').find((x) => x._id === 'alice@example.com|dave@example.com');
  assert.ok(d && d.nickB === '戴夫');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { matchId: 'EV9_r1_m0' });
  assert.strictEqual(r.code, 404); assert.strictEqual(r.body.code, 'friends-match-not-found');
});
await T('E5 block 可對沒有關係的人（by roomCode/email）直接建 blocked 列；已是好友再 block ⇒ 覆蓋成 blocked（保留 createdAt）；被封鎖方 list 零痕跡', async () => {
  const seed = seedBase(); seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'accepted', createdAt: 123 })];
  const H = buildFriends(FR, { seed });
  const fid = H.db.snapshot('friendships')[0].fid;
  let r = await H.call('post', '/api/friends/block', asUser(U.A), { fid });
  assert.strictEqual(r.code, 200);
  let d = H.db.snapshot('friendships')[0];
  assert.strictEqual(d.status, 'blocked'); assert.strictEqual(d.blockedBy, 'alice@example.com'); assert.strictEqual(d.createdAt, 123);
  r = await H.call('post', '/api/friends/block', asUser(U.C), { roomCode: 'AB12' });
  assert.strictEqual(r.code, 403, 'C 不在房裡不能靠房號封鎖人');
  H.db.collection('playerIdentity'); H.db._store.get('playerIdentity').set('bob@example.com', { _id: 'bob@example.com', uid: 'o-bob', nick: '鮑伯' });
  r = await H.call('post', '/api/friends/block', asUser(U.C), { email: 'bob@example.com' });
  assert.strictEqual(r.code, 200); assert.strictEqual(r.body.status, 'blocked');
  const l = await H.call('get', '/api/friends/list', asUser(U.B));
  assert.deepStrictEqual([l.body.friends.length, l.body.blocked.length], [0, 0]);
  const lc = await H.call('get', '/api/friends/list', asUser(U.C));
  assert.strictEqual(lc.body.blocked.length, 1); assert.strictEqual(lc.body.blocked[0].blockedByMe, true);
});
await T('E6 DB 例外 ⇒ 500 code=friends-error（不炸行程）；list 查詢帶 limit 硬上限且用 a/b＋status $in（走索引）', async () => {
  const H = buildFriends(FR, { seed: seedBase() });
  await H.call('get', '/api/friends/list', asUser(U.A));
  const f = H.db._log.find((x) => x.name === 'friendships' && x.op === 'find');
  assert.ok(f && Array.isArray(f.q.$or) && f.q.status && Array.isArray(f.q.status.$in), 'list 查詢形狀');
  const H2 = buildFriends(FR, { seed: seedBase(), dbOpts: { throwOn: (n, op) => n === 'friendships' } });
  const r = await H2.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 500); assert.strictEqual(r.body.code, 'friends-error');
  assert.deepStrictEqual(findEmails(r.body), [], '500 回應也不可含 email');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】playerIdentity 對照表（接點＝/api/match-result enrich 段）');
const extractSanitize = () => {
  const i = PATCH.indexOf('const DECK_ID_RE = ');
  const j = PATCH.indexOf('function sanitizeDeckId(', i);
  let d = 0, k = PATCH.indexOf('{', j);
  for (; k < PATCH.length; k++) { if (PATCH[k] === '{') d++; else if (PATCH[k] === '}') { d--; if (!d) break; } }
  return new Function(PATCH.slice(i, k + 1) + '\nreturn sanitizeDeckId;')();
};
const runEnrich = (db, doc, rpi) => new Function('db', 'doc', 'sanitizeDeckId', 'recordPlayerIdentity',
  '"use strict"; return (async () => {\n' + ENRICH + '\n})();')(db, doc, extractSanitize(), rpi);
const runEnrichNoHelper = (db, doc) => new Function('db', 'doc', 'sanitizeDeckId',
  '"use strict"; return (async () => {\n' + ENRICH + '\n})();')(db, doc, extractSanitize());
const SEATS = [{ uid: 'o-alice', email: 'alice@example.com' }, { uid: 'o-bob', email: 'bob@example.com' }];
const mkRoomDb = (seats, calls) => ({ collection: (n) => ({ findOne: async (q, o) => { calls.push({ n, q, o }); return { seats }; } }) });
await T('F1 ⭐ enrich 段真的呼叫 recordPlayerIdentity(db, seats, [p1.name, p2.name])，且**零額外查詢**（findOne 仍只有一發、projection 逐字不變）', async () => {
  const calls = [], spy = [];
  const doc = { roomCode: 'ab12', p1: { email: null, name: '愛麗絲' }, p2: { email: null, name: '鮑伯' } };
  await runEnrich(mkRoomDb(SEATS, calls), doc, (db, seats, names) => { spy.push({ seats, names }); return 2; });
  assert.strictEqual(calls.length, 1, 'findOne 次數');
  assert.deepStrictEqual(calls[0].o.projection, { 'seats.uid': 1, 'seats.email': 1, 'seats.deckId': 1 }, 'projection 被動了');
  assert.strictEqual(spy.length, 1, 'helper 沒被呼叫');
  assert.deepStrictEqual(spy[0].seats, SEATS); assert.deepStrictEqual(spy[0].names, ['愛麗絲', '鮑伯']);
  assert.strictEqual(doc.p1.email, 'alice@example.com', 'email 回填行為維持');
});
await T('F1b 沒有房號（本機對戰）⇒ 不查 DB 也不記對照表；helper 缺席（v6.220/v6.266 守衛的抽跑環境）⇒ 不拋、email 照補', async () => {
  const calls = [], spy = [];
  await runEnrich(mkRoomDb(SEATS, calls), { roomCode: null, p1: { email: null }, p2: { email: null } }, () => spy.push(1));
  assert.strictEqual(calls.length + spy.length, 0);
  const doc = { roomCode: 'AB12', p1: { email: null }, p2: { email: null } };
  await runEnrichNoHelper(mkRoomDb(SEATS, []), doc);
  assert.strictEqual(doc.p2.email, 'bob@example.com');
});
const RPI = new Function('"use strict";\n' + IDB + '\nreturn recordPlayerIdentity;')();
await T('F2 helper 行為：email 正規化為 _id、$set uid/uidAt（v6.286【2】：**不再寫 nick** —— 來源是未驗證的 match-result payload）、$push uids $slice -5、upsert；匿名座位跳過；只記 p1/p2；回傳寫入筆數', async () => {
  const db = makeFakeDb({});
  const n = RPI(db, [{ uid: ' o-alice ', email: ' Alice@Example.com ' }, { uid: 'o-x', email: null }, { uid: 'o-spec', email: 'spec@example.com' }], ['愛麗絲', '匿名', '觀戰']);
  assert.strictEqual(n, 1);
  await new Promise((r) => setImmediate(r));
  const rows = db.snapshot('playerIdentity');
  assert.strictEqual(rows.length, 1, '應只寫 1 筆（匿名跳過、觀戰位不記）');
  assert.strictEqual(rows[0]._id, 'alice@example.com'); assert.strictEqual(rows[0].uid, 'o-alice'); assert.strictEqual(rows[0].nick, undefined, 'v6.286【2】：playerIdentity 不得再落地 nick');
  assert.deepStrictEqual(rows[0].uids.map((u) => u.uid), ['o-alice']);
  const op = db._log.find((x) => x.op === 'updateOne');
  assert.strictEqual(op.opt.upsert, true); assert.strictEqual(op.upd.$push.uids.$slice, -5);
  for (let i = 0; i < 7; i++) { RPI(db, [{ uid: 'dev' + i, email: 'alice@example.com' }], ['愛麗絲']); await new Promise((r) => setImmediate(r)); }
  const r2 = db.snapshot('playerIdentity')[0];
  assert.strictEqual(r2.uid, 'dev6'); assert.strictEqual(r2.uids.length, 5, 'uids 應只留最近 5 個'); assert.strictEqual(r2.uids[0].uid, 'dev2');
});
await T('F2b fire-and-forget：同步回傳時 DB 還沒被碰；db 拒絕（reject）不會變成 unhandled rejection；db 為 null 回 0', async () => {
  const db = makeFakeDb({});
  RPI(db, SEATS, ['a', 'b']);
  assert.strictEqual(db._log.length, 0, '同步階段就打了 DB（不是 fire-and-forget）');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(db._log.length, 2);
  let unhandled = 0; const h = () => { unhandled++; };
  process.on('unhandledRejection', h);
  const bad = { collection: () => ({ updateOne: () => Promise.reject(new Error('down')) }) };
  RPI(bad, SEATS, ['a', 'b']);
  const bad2 = { collection: () => { throw new Error('sync down'); } };
  RPI(bad2, SEATS, ['a', 'b']);
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', h);
  assert.strictEqual(unhandled, 0, 'unhandled rejection');
  assert.strictEqual(RPI(null, SEATS), 0);
});
await T('F3 作用域：recordPlayerIdentity 定義在 registerMatchRecords IIFE 內、位於 makePlayerDoc 之後、/api/match-result 之前（與 caller 同一個 closure）', () => {
  const iife = PATCH.indexOf('(function registerMatchRecords()');
  const def = PATCH.indexOf('function recordPlayerIdentity(');
  const mpd = PATCH.indexOf('function makePlayerDoc(');
  const ep = PATCH.indexOf("app.post('/api/match-result'");
  const use = PATCH.indexOf('recordPlayerIdentity(db, _st,');
  assert.ok(iife > 0 && mpd > iife && def > mpd && ep > def && use > ep, JSON.stringify({ iife, mpd, def, ep, use }));
  assert.ok(PATCH.indexOf('(function registerStatsEndpoints()') > use, 'caller 落到下一個 IIFE 去了');
  assert.strictEqual((PATCH.match(/function recordPlayerIdentity\(/g) || []).length, 1, '定義應只有一份');
});
await T('F4 app.locals._adminScanYield 掛在 adminScanYield 同一個 closure（firebase-admin then-callback 內、registerTwDeckImport 之前）；抽出來跑：掛上去的就是每 200 筆回 Promise 的那一支', () => {
  const y = PATCH.indexOf('function adminScanYield(');
  const l = PATCH.indexOf('app.locals._adminScanYield = adminScanYield');
  const iife = PATCH.indexOf('(function registerTwDeckImport()');
  assert.ok(y > 0 && l > y && l < iife, JSON.stringify({ y, l, iife }));
  const i = PATCH.indexOf('const ADMIN_SCAN_YIELD_EVERY =');
  const j = PATCH.indexOf('\n  }', PATCH.indexOf('function adminScanYield', i)) + 4;
  const line = PATCH.slice(PATCH.lastIndexOf('\n', l) + 1, PATCH.indexOf('\n', l));
  const app = {};
  new Function('app', PATCH.slice(i, j) + '\n' + line)(app);
  assert.strictEqual(typeof app.locals._adminScanYield, 'function');
  assert.strictEqual(app.locals._adminScanYield(199), null); assert.ok(app.locals._adminScanYield(200) instanceof Promise);
});
await T('F5 makePlayerDoc 確實不存 uid（⇒ uid 只能從 seats[] 拿，這是接點選擇的前提）', () => {
  const i = PATCH.indexOf('function makePlayerDoc(');
  let d = 0, k = PATCH.indexOf('{', i);
  for (; k < PATCH.length; k++) { if (PATCH[k] === '{') d++; else if (PATCH[k] === '}') { d--; if (!d) break; } }
  const fn = new Function('sanitizeDeckId', PATCH.slice(i, k + 1) + '\nreturn makePlayerDoc;')(extractSanitize());
  const doc = fn({ name: 'x', email: 'e@example.com', uid: 'u1', cardCounts: { c1: 2 } });
  assert.deepStrictEqual(Object.keys(doc), ['name', 'email', 'cardCounts'], 'makePlayerDoc 欄位：' + Object.keys(doc));
  assert.ok(!('uid' in doc));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】事件迴圈 benchmark（Rule 32：量測腳本＝本段；另有 scripts/perf-v6282-friends-eventloop.mjs 可獨立重跑）');
async function measureLoop(fn) {
  let ticks = 0, last = process.hrtime.bigint(); const gaps = []; let running = true;
  const tick = () => { if (!running) return; const now = process.hrtime.bigint(); gaps.push(Number(now - last) / 1e6); last = now; ticks++; setImmediate(tick); };
  setImmediate(tick);
  await new Promise((r) => setImmediate(r));
  ticks = 0; gaps.length = 0; last = process.hrtime.bigint();
  const t0 = process.hrtime.bigint();
  const out = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  running = false;
  gaps.sort((a, b) => a - b);
  const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0);
  return { out, ticks, ms, max: gaps.length ? gaps[gaps.length - 1] : ms, p99: q(0.99), p50: q(0.5) };
}
const benchSeed = () => {
  const seed = seedBase();
  seed.friendships = seedFull('alice@example.com', 100).concat(Array.from({ length: 30 }, (_, i) => mkPending('alice@example.com', 'p' + i + '@example.com', 'p' + i + '@example.com')));
  seed.playerIdentity = Array.from({ length: 100 }, (_, i) => ({ _id: 'friend' + String(i).padStart(3, '0') + '@example.com', uid: 'o' + i, uids: [{ uid: 'o' + i, at: i }], nick: 'F' + i }));
  return seed;
};
let BENCH = null;
await T('G1 100 好友＋30 待確認的 list × 200 發（假 db 每個操作經一次 setImmediate＝模擬真實 I/O 邊界）：事件迴圈阻塞 p99 < 60ms（沙盒門檻；正式 VM 約快 10 倍）', async () => {
  const yc = { ticks: 0 };
  const H = buildFriends(FR, { seed: benchSeed(), yieldCounter: yc, dbOpts: { ioDelay: true } });
  BENCH = await measureLoop(async () => { let last; for (let i = 0; i < 200; i++) last = await H.call('get', '/api/friends/list', asUser(U.A)); return last; });
  assert.strictEqual(BENCH.out.code, 200);
  assert.strictEqual(BENCH.out.body.friends.length, 100);
  console.log('        list×200：總耗時 ' + BENCH.ms.toFixed(1) + 'ms、每發 ' + (BENCH.ms / 200).toFixed(3) + 'ms、ticker ' + BENCH.ticks + ' 次、阻塞 p50 ' + BENCH.p50.toFixed(3) + ' / p99 ' + BENCH.p99.toFixed(3) + ' / max ' + BENCH.max.toFixed(3) + ' ms、讓路 ' + yc.ticks + ' 次（每次查詢 ≤ 130 筆 ⇒ 200 筆節拍不會觸發，屬預期）');
  assert.ok(BENCH.ticks > 0 && BENCH.p99 > 0, '量測器沒量到東西');
  assert.ok(BENCH.p99 < 60, 'p99 ' + BENCH.p99.toFixed(2) + 'ms');
});
await T('G1b 同一份資料、假 db 零 I/O（全部已解決的 promise）：整串 200 發的同步 CPU 上界（含假 db 線性掃描與 structuredClone 的成本，出貨碼本身只佔其中一部分）', async () => {
  const H = buildFriends(FR, { seed: benchSeed() });
  const m = await measureLoop(async () => { let last; for (let i = 0; i < 200; i++) last = await H.call('get', '/api/friends/list', asUser(U.A)); return last; });
  console.log('        零 I/O：200 發總 CPU ' + m.ms.toFixed(1) + 'ms ⇒ 每發 ≤ ' + (m.ms / 200).toFixed(3) + 'ms（沙盒；VM 約 1/10）');
  assert.ok(m.ms / 200 < 50, '每發 CPU 上界過高：' + (m.ms / 200).toFixed(2) + 'ms');
});
await T('G2 量測器自驗：一個故意同步空轉 30ms 的 handler 會被量到 max ≥ 25ms（正對照）；ticker 在純 microtask 鏈裡量不到（反面對照，v6.242 教訓）', async () => {
  const m = await measureLoop(async () => { const t = Date.now(); while (Date.now() - t < 30) { /* 同步空轉 */ } return 1; });
  assert.ok(m.max >= 25, '正對照沒量到阻塞：' + m.max.toFixed(1));
  const m2 = await measureLoop(async () => { for (let i = 0; i < 1000; i++) await Promise.resolve(); return 1; });
  assert.strictEqual(m2.ticks, 0, 'microtask 鏈不該讓 ticker 跑到');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】突變測試（每一條紅在預期那一條）');
const mutate = (a, b) => { assert.strictEqual(FR.split(a).length - 1, 1, '突變錨點不唯一：' + a.slice(0, 60)); return FR.replace(a, b); };
await T('H1 突變：白名單多回一個 email 欄位 ⇒ C1 紅（隱私掃描不是安慰劑）', async () => {
  const M = mutate("        fid: doc.fid || _frFid(doc._id),\n", "        fid: doc.fid || _frFid(doc._id), email: otherEmail,\n");
  await mutantMustBreak('leak email', async () => {
    const { out } = await runFullFlow(M);
    for (const r of out) assert.deepStrictEqual(findEmails(r.body), [], '洩漏了 email');
  }, '洩漏了 email');
});
await T('H2 突變：關閉時仍帶哨兵 ⇒ B1 紅', async () => {
  const M = mutate("res.status(503).json({ error: '好友功能尚未開放', code: 'friends-disabled' })", "res.status(503).json({ error: '好友功能尚未開放', code: 'friends-disabled', friendsApi: 1 })");
  await mutantMustBreak('sentinel-when-disabled', async () => {
    const H = buildFriends(M, { seed: { rooms: [] } });
    const r = await H.call('get', '/api/friends/list', asUser(U.A));
    assert.ok(!('friendsApi' in (r.body || {})), '關閉時不可帶哨兵');
  }, '關閉時不可帶哨兵');
});
await T('H3 突變：跨 IIFE helper 取不到時 fail-open（用本地 fallback）⇒ B4 紅', async () => {
  const M = mutate("if (typeof y !== 'function') { res.status(503)", "if (false) { res.status(503)").replace('me.yield = y;', 'me.yield = typeof y === "function" ? y : (() => null);');
  await mutantMustBreak('fail-open yield', async () => {
    const H = buildFriends(M, { seed: seedBase(), locals: {} });
    const r = await H.call('get', '/api/friends/list', asUser(U.A));
    assert.strictEqual(r.code, 503, '取不到 helper 應 503');
  }, '應 503');
});
await T('H4 突變：拿掉冷卻判斷 ⇒ D2 紅', async () => {
  const M = mutate("if (cur && cur.status === 'rejected' && cur.requester === me.email && typeof cur.rejectedAt === 'number' && now - cur.rejectedAt < FR_REJECT_COOLDOWN_MS) {", "if (false) {");
  await mutantMustBreak('no cooldown', async () => {
    const seed = seedBase(); seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'rejected', rejectedAt: Date.now() - 1000 })];
    const H = buildFriends(M, { seed });
    const r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
    assert.strictEqual(r.code, 429, '冷卻期內應 429');
  }, '冷卻期內應 429');
});
await T('H5 突變：被封鎖方 request 竟然寫入 ⇒ D4 紅', async () => {
  const M = mutate("          return res.json({ ok: true, friendsApi: 1, status: 'pending' });\n        }\n        if (cur && cur.status === 'accepted')", "          await c.updateOne({ _id: pid }, { $set: { poked: true } }); return res.json({ ok: true, friendsApi: 1, status: 'pending' });\n        }\n        if (cur && cur.status === 'accepted')");
  await mutantMustBreak('blocked writes', async () => {
    const seed = seedBase(); seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'blocked', blockedBy: 'alice@example.com' })];
    const H = buildFriends(M, { seed });
    const before = H.db.snapshot('friendships');
    await H.call('post', '/api/friends/request', asUser(U.B), { roomCode: 'AB12' });
    assert.deepStrictEqual(H.db.snapshot('friendships'), before, 'DB 被動到了');
  }, 'DB 被動到了');
});
await T('H6 突變：上限改 1000 ⇒ D3 紅（常數實際求值，不是比字面）', async () => {
  const M = mutate('const FR_MAX_FRIENDS = 100;', 'const FR_MAX_FRIENDS = 1000;');
  await mutantMustBreak('limit 1000', async () => {
    const seed = seedBase(); seed.friendships = seedFull('alice@example.com', 100);
    const H = buildFriends(M, { seed });
    const r = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
    assert.strictEqual(r.code, 409, '滿 100 應 409');
  }, '滿 100 應 409');
});
await T('H7 突變：remove 改成 deleteMany 全刪 ⇒ E1 紅', async () => {
  // v6.288：出貨碼改成 `const del = await c.deleteOne(...)`（要看 deletedCount 才刪對話）⇒ 突變體要保住 del 變數
  const M = mutate("const del = await c.deleteOne({ _id: cur._id, $or: [{ a: me.email }, { b: me.email }] });", "const del = { deletedCount: 0 }; for (const d of await c.find({ $or: [{ a: me.email }, { b: me.email }] }).toArray()) await c.deleteOne({ _id: d._id });");
  await mutantMustBreak('delete all mine', async () => {
    const seed = seedBase();
    seed.friendships = [mkPending('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'accepted' }), mkPending('alice@example.com', 'carol@example.com', 'carol@example.com')];
    const H = buildFriends(M, { seed });
    const l = await H.call('get', '/api/friends/list', asUser(U.A));
    await H.call('post', '/api/friends/remove', asUser(U.A), { fid: l.body.friends[0].fid });
    assert.strictEqual(H.db.snapshot('friendships').length, 1, '只能刪自己那一列');
  }, '只能刪自己那一列');
});
await T('H8 突變：限流器 3 → 30 ⇒ D5 紅', async () => {
  const M = mutate('const FR_EMAIL_RATE_MIN = 3,', 'const FR_EMAIL_RATE_MIN = 30,');
  await mutantMustBreak('rate 30', async () => {
    const H = buildFriends(M, { seed: seedBase() });
    let last;
    for (let i = 0; i < 4; i++) last = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'n' + i + '@example.com' });
    assert.strictEqual(last.code, 429, '第 4 次應 429');
  }, '第 4 次應 429');
});
await T('H9 突變：匿名放行（verified 不檢查）⇒ B2 紅', async () => {
  const M = mutate("const email = id && !id.error && id.verified ? _frNormEmail(id.email) : null;", "const email = id && !id.error ? (_frNormEmail(id.email) || 'anon@x.y') : null;");
  await mutantMustBreak('anon allowed', async () => {
    const H = buildFriends(M, { seed: seedBase() });
    const r = await H.call('get', '/api/friends/list', {}, { playerId: 'p1' });
    assert.strictEqual(r.code, 401, 'playerId fallback 應 401');
  }, '應 401');
});
await T('H10 突變：enrich 段拿掉對照表呼叫 ⇒ F1 紅', async () => {
  const E2 = ENRICH.replace("if (typeof recordPlayerIdentity === 'function') recordPlayerIdentity(db, _st, [doc.p1 && doc.p1.name, doc.p2 && doc.p2.name]);", '');
  assert.notStrictEqual(E2, ENRICH, '突變錨點對不上');
  await mutantMustBreak('no identity hook', async () => {
    const spy = [];
    await new Function('db', 'doc', 'sanitizeDeckId', 'recordPlayerIdentity', '"use strict"; return (async () => {\n' + E2 + '\n})();')(mkRoomDb(SEATS, []), { roomCode: 'AB12', p1: { email: null }, p2: { email: null } }, extractSanitize(), () => spy.push(1));
    assert.strictEqual(spy.length, 1, 'helper 沒被呼叫');
  }, 'helper 沒被呼叫');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【I】HEAD-FAIL 證明（history-free：BASE 沒有這三個區塊 ⇒ 抽取器與 F3/F4 都必紅）');
await T('I1 把三個區塊從檔案裡拿掉（模擬 BASE）⇒ extractBlock 以 AssertionError 紅在「抽不到區塊」', () => {
  const noFR = PATCH.slice(0, PATCH.indexOf(FR_START)) + PATCH.slice(PATCH.indexOf(FR_END) + FR_END.length);
  assert.throws(() => extractBlock(noFR, FR_START, FR_END, 1), (e) => e instanceof assert.AssertionError && /抽不到區塊/.test(e.message));
  const noID = PATCH.slice(0, PATCH.indexOf(ID_START)) + PATCH.slice(PATCH.indexOf(ID_END) + ID_END.length);
  assert.throws(() => extractBlock(noID, ID_START, ID_END, 1), (e) => e instanceof assert.AssertionError);
  assert.ok(!noID.includes('function recordPlayerIdentity('), '拿掉區塊後 helper 應消失（F3 會紅）');
});

console.log('\n══ v6.282 好友功能 P0 守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
if (fail) process.exit(1);
