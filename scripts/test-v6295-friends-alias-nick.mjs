// v6.295 守衛：好友備註名（alias）＋ 可信的「最新暱稱」（HEAD-FAIL：BASE v6.294 沒有 _frAlias／_frLatestNicks ⇒ A0 必紅並提前結束）
//
// 守什麼（全部行為端；伺服器區塊用 scripts/lib/friends-harness-v6282.mjs 把 FRIENDS＋FRIENDS-DM 兩段抽出來實跑）：
//   【A】抽取器下限 ＋ 錦標賽區塊兩把 sha256（與 test-v6272 ⑨／test-v6278 I1 同）。
//   【B】alias 端點：設定／讀回、淨化（控制字元／零寬／> 20 字／全空白／非字串）、只准 accepted、
//        被封鎖方靜默零寫入、$unset 只動我自己那一側、越權 fid ⇒ 404、gate（503／401／helper-missing）／500 不含 email。
//   【C】⭐⭐⭐ **對方看不到我的備註名**：兩側各填不同哨兵，分別以 A／B 身分實跑 list ＋ dm/list ＋ **admin 四支端點**，
//        斷言對方的哨兵零出現；admin 兩個哨兵都零出現。正對照＝把 _frPublic 改成回對方那一側 ⇒ 必紅。
//   【D】最新暱稱：優先序四階各自實跑；索引不存在 ⇒ 整段跳過且**零** aggregate（正對照＝拿掉自驗要紅）；
//        N+1 防護（10 個好友 ⇒ TREGS 查詢次數恰 1）；$in 內容必須恰好是這次的好友（不得掃全表）；
//        只取最新一筆；name＝email 前綴 ⇒ 不採用；讓路節拍確切次數。
//   【E】回應永不含 email（含 alias 路徑的完整流程）。
//   【F】突變各自打紅預期那一條。
//   【G】本守衛在 package.json 的 test chain ＋ 版本一致（不 pin 版本號）。
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
const DM_START = '// >>> PTCG-FRIENDS-DM-BLOCK-START';
const DM_END = '// <<< PTCG-FRIENDS-DM-BLOCK-END';

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
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 260) + '（預期含「' + expectFrag + '」）');
};
const mutate = (src, a, b) => { const n = src.split(a).length - 1; assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90)); return src.replace(a, b, 1); };

const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'fB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'fC', email: 'carol@example.com', name: '卡蘿' },
  AD: { uid: 'fAd', email: 'admin@example.com', name: '管理員' },
};
const admin = asUser(U.AD);
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
const AB = mkRow(U.A.email, U.B.email, 'accepted');   // a=alice, b=bob
const CFG = { _id: 'friendsConfig', enabled: true, dm: true };
const seedOn = (rows, regs) => {
  const s = { tournamentConfig: [structuredClone(CFG)], friendships: rows || [structuredClone(AB)] };
  if (regs) s.tournamentRegistrations = regs;
  return s;
};
const REG_IDX = { tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }] };
const writesTo = (db, name) => db._log.filter((l) => l.name === name && /^(insertOne|updateOne|replaceOne|deleteOne|deleteMany)$/.test(l.op)).length;
const rowOf = (H, id) => H.db.snapshot('friendships').find((d) => d._id === id);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】抽取器下限 ＋ 錦標賽區塊 sha256');
let FR = '', DM = '', SRC = '';
await T('A0 HEAD-FAIL 錨點：FRIENDS 區塊有 _frAlias／_frLatestNicks／POST /api/friends/alias／_frRegIndexReady，且假 db 有 v6.295 的 indexes()（BASE v6.294 全都沒有 ⇒ 這一條必紅）', () => {
  const probe = makeFakeDb({}).collection('probe');
  assert.strictEqual(typeof probe.indexes, 'function', 'HEAD-FAIL：scripts/lib/friends-harness-v6282.mjs 沒有 v6.295 的 indexes()');
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  DM = extractBlock(PATCH, DM_START, DM_END, 8000);
  assert.ok(FR.includes('function _frAlias('), 'HEAD-FAIL：FRIENDS 區塊沒有 _frAlias');
  assert.ok(FR.includes('async function _frLatestNicks('), 'HEAD-FAIL：FRIENDS 區塊沒有 _frLatestNicks');
  assert.ok(FR.includes("app.post('/api/friends/alias'"), 'HEAD-FAIL：沒有 POST /api/friends/alias');
  assert.ok(FR.includes('async function _frRegIndexReady('), 'HEAD-FAIL：沒有索引自驗 _frRegIndexReady');
  SRC = FR + '\n' + DM;
});
if (!FR || !FR.includes('function _frAlias(')) {
  console.log('\n══ v6.295 守衛：' + pass + ' PASS / ' + (fail || 1) + ' FAIL（HEAD-FAIL：本版改動不在，後續無法進行）══');
  process.exit(1);
}
const TOURN_TAIL_SHA256 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';   // 與 test-v6272 ⑨ 同一把
const TOURN_ANCHOR_SHA256 = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40'; // 與 test-v6278 I1 同一把
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256）；好友／DM 兩區塊整段都在第一支 /api/tournament 之前', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");
  assert.ok(first > 0, '找不到第一支 /api/tournament 端點');
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(DM_END) < first, '好友區塊必須整段在錦標賽區塊之前');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗');
});
await T('A2 alias 端點沿用既有 500 出口（區塊內 res.status(500) 仍只有 _frFail 一處）；每個 createIndex 那一行都帶 catch（test-v6119 的既有紀律）', () => {
  const stripped = FR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert.strictEqual((stripped.match(/res\.status\(500\)/g) || []).length, 1, '區塊內 500 出口必須只有 _frFail 一處');
  assert.ok(/_frFail\(res, e, 'alias'\)/.test(FR), 'alias 端點沒走 _frFail');
  const ci = FR.split('\n').filter((l) => l.includes('createIndex'));
  assert.ok(ci.some((l) => l.includes('FR_REG_COLL')), '沒有為 tournamentRegistrations 建索引');
  for (const l of ci) assert.ok(/catch/.test(l), 'createIndex 沒有 catch：' + l.trim().slice(0, 90));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】alias 端點：設定／淨化／狀態閘／$unset 只動自己那一側');
const setAlias = (H, who, fid, alias) => H.call('post', '/api/friends/alias', asUser(who), { fid, alias });

await T('B0 ⚠⚠ 接線：list 的逐欄 projection 必須含 aliasByA／aliasByB（漏掉 ⇒ 端點寫得進去、清單永遠讀不到 —— 第一版就是這樣被抓到的）', async () => {
  const list = FR.slice(FR.indexOf("app.get('/api/friends/list'"), FR.indexOf("app.post('/api/friends/request'"));
  const m = /projection: \{([^}]*)\}/.exec(list);
  assert.ok(m, 'list 的 find 找不到 projection（抽取器壞了？）');
  for (const f of ['aliasByA', 'aliasByB']) assert.ok(m[1].includes(f), 'list 的 projection 少了 ' + f + '：' + m[1].trim().slice(0, 200));
  // 行為端正對照：把 projection 裡的兩個欄位拿掉 ⇒ list 讀不到 alias
  const bad = mutate(FR, 'nickA: 1, nickB: 1, aliasByA: 1, aliasByB: 1,', 'nickA: 1, nickB: 1,');
  const H = buildFriends(bad + '\n' + DM, { seed: seedOn([mkRow(U.A.email, U.B.email, 'accepted', { aliasByA: 'X備註' })]), dbOpts: { indexes: REG_IDX } });
  const f0 = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f0.alias, null, '掃描器自驗：拿掉 projection 後 list 應該就讀不到 alias（否則這條斷言沒在守）');
});

await T('B1 設定後從 list 讀得回來；⭐ alias 與「原暱稱」是**兩個欄位**（伺服器不合併：nick 仍是快照／TREGS，不會被 alias 蓋掉）', async () => {
  const H = buildFriends(SRC, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
  const r = await setAlias(H, U.A, AB.fid, '路卡利歐超強玩家');
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.alias, '路卡利歐超強玩家'); assert.strictEqual(r.body.friendsApi, 1);
  assert.strictEqual(rowOf(H, AB._id).aliasByA, '路卡利歐超強玩家', 'a 側（alice）的備註名應寫進 aliasByA');
  assert.strictEqual(rowOf(H, AB._id).aliasByB, undefined, '不得同時寫到對方那一側');
  const la = await H.call('get', '/api/friends/list', asUser(U.A));
  const f = la.body.friends[0];
  assert.strictEqual(f.alias, '路卡利歐超強玩家', 'list 沒回 alias');
  assert.strictEqual(f.nick, '快照B', '⚠ 伺服器把 alias 合併進 nick 了（下一版 UI 就顯示不出「原暱稱」）：' + f.nick);
});
await T('B2 淨化：控制字元／零寬字元／> 20 字／emoji 不切半／連續空白 各自的預期結果', async () => {
  const cases = [
    ['控制字元', 'A B\tC\nD', 'A B C D'],
    ['零寬字元', '路​卡‍利﻿歐', '路卡利歐'],
    ['超過 20 字', '一二三四五六七八九十一二三四五六七八九十壹貳參', '一二三四五六七八九十一二三四五六七八九十'],
    ['emoji 不切半', '\u{1F600}'.repeat(25), '\u{1F600}'.repeat(20)],
    ['連續空白折疊', '  小  明  ', '小 明'],
  ];
  for (const [why, input, want] of cases) {
    const H = buildFriends(SRC, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
    const r = await setAlias(H, U.A, AB.fid, input);
    assert.strictEqual(r.code, 200, why);
    assert.strictEqual(r.body.alias, want, why + ' 淨化結果不對：' + JSON.stringify(r.body.alias));
    assert.strictEqual(rowOf(H, AB._id).aliasByA, want, why + ' 落地值不對');
    assert.ok(Array.from(String(r.body.alias)).length <= 20, why + ' 超過 20 字上限');
  }
  for (const [why, input] of [['全空白', '   ​ \t '], ['非字串（數字）', 123], ['非字串（物件）', { a: 1 }], ['未帶欄位', undefined]]) {
    const H = buildFriends(SRC, { seed: seedOn([mkRow(U.A.email, U.B.email, 'accepted', { aliasByA: '舊備註' })]), dbOpts: { indexes: REG_IDX } });
    const r = await setAlias(H, U.A, AB.fid, input);
    assert.strictEqual(r.code, 200, why);
    assert.strictEqual(r.body.alias, null, why + ' 應回 null（＝清除）：' + JSON.stringify(r.body.alias));
    assert.strictEqual(rowOf(H, AB._id).aliasByA, undefined, why + ' 應 $unset 掉備註名，實得：' + JSON.stringify(rowOf(H, AB._id).aliasByA));
    assert.ok(!JSON.stringify(rowOf(H, AB._id)).includes('object Object'), why + ' 讓 [object Object] 落地了');
  }
});
await T('B3 非 accepted（pending／rejected／我封鎖的）⇒ 409 friends-alias-not-friend 且 DB **零寫入**', async () => {
  for (const st of ['pending', 'rejected']) {
    const H = buildFriends(SRC, { seed: seedOn([mkRow(U.A.email, U.B.email, st)]), dbOpts: { indexes: REG_IDX } });
    const r = await setAlias(H, U.A, AB.fid, '不該寫進去');
    assert.strictEqual(r.code, 409, st + ' 應 409，實得 ' + r.code + ' ' + JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'friends-alias-not-friend', st);
    assert.strictEqual(writesTo(H.db, 'friendships'), 0, st + ' 竟然寫了 DB');
  }
  const H2 = buildFriends(SRC, { seed: seedOn([mkRow(U.A.email, U.B.email, 'blocked', { blockedBy: U.A.email })]), dbOpts: { indexes: REG_IDX } });
  const r2 = await setAlias(H2, U.A, AB.fid, '不該寫進去');
  assert.strictEqual(r2.code, 409, '封鎖方應 409'); assert.strictEqual(writesTo(H2.db, 'friendships'), 0, '封鎖方竟然寫了 DB');
});
await T('B4 被封鎖方 ⇒ 200（靜默，不透露被封鎖）但 DB **零寫入**', async () => {
  const H = buildFriends(SRC, { seed: seedOn([mkRow(U.A.email, U.B.email, 'blocked', { blockedBy: U.A.email })]), dbOpts: { indexes: REG_IDX } });
  const r = await setAlias(H, U.B, AB.fid, '偷寫');
  assert.strictEqual(r.code, 200, '被封鎖方應靜默 200，實得 ' + r.code);
  assert.strictEqual(writesTo(H.db, 'friendships'), 0, '被封鎖方竟然寫了 DB');
  assert.ok(!JSON.stringify(H.db.snapshot('friendships')).includes('偷寫'), '被封鎖方的字串落地了');
});
await T('B5 ⚠⚠ 清除只 $unset **我自己那一側**：對方的 alias／nickA／nickB／status／requester 一個位元都不動', async () => {
  const row = mkRow(U.A.email, U.B.email, 'accepted', { aliasByA: 'A的備註', aliasByB: 'B的備註' });
  const H = buildFriends(SRC, { seed: seedOn([row]), dbOpts: { indexes: REG_IDX } });
  const before = structuredClone(rowOf(H, AB._id));
  const r = await setAlias(H, U.A, AB.fid, '');
  assert.strictEqual(r.code, 200);
  const after = rowOf(H, AB._id);
  assert.strictEqual(after.aliasByA, undefined, '我這一側沒被清掉');
  assert.strictEqual(after.aliasByB, 'B的備註', '⚠⚠ 動到了對方的備註名');
  for (const k of ['_id', 'fid', 'a', 'b', 'status', 'requester', 'blockedBy', 'nickA', 'nickB', 'addedVia', 'createdAt']) {
    assert.deepStrictEqual(after[k], before[k], '動到了既有欄位 ' + k);
  }
  assert.ok(after.updatedAt >= before.updatedAt, 'updatedAt 應更新');
  const H2 = buildFriends(SRC, { seed: seedOn([structuredClone(row)]), dbOpts: { indexes: REG_IDX } });
  await setAlias(H2, U.B, AB.fid, '  ');
  assert.strictEqual(rowOf(H2, AB._id).aliasByB, undefined);
  assert.strictEqual(rowOf(H2, AB._id).aliasByA, 'A的備註', '⚠⚠ B 清除時動到了 A 的備註名');
});
await T('B6 越權：C 拿 A|B 的 fid ⇒ 404 且零寫入；fid 格式不對／不存在 ⇒ 404', async () => {
  const H = buildFriends(SRC, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
  for (const [who, fid, why] of [[U.C, AB.fid, '第三人'], [U.A, 'zzz', '格式不對'], [U.A, 'deadbeefdeadbeef', '不存在']]) {
    const r = await setAlias(H, who, fid, 'X');
    assert.strictEqual(r.code, 404, why + ' 應 404，實得 ' + r.code);
  }
  assert.strictEqual(writesTo(H.db, 'friendships'), 0, '越權竟然寫了 DB');
});
await T('B7 gate：開關關閉 ⇒ 503 friends-disabled 且不帶哨兵；匿名／playerId ⇒ 401；讓路 helper 取不到 ⇒ 503 fail-closed；500 路徑固定文案不含 email', async () => {
  const off = buildFriends(SRC, { seed: { friendships: [structuredClone(AB)] }, dbOpts: { indexes: REG_IDX } });
  const r0 = await setAlias(off, U.A, AB.fid, 'X');
  assert.strictEqual(r0.code, 503); assert.strictEqual(r0.body.code, 'friends-disabled');
  assert.ok(!('friendsApi' in r0.body), '關閉時不可帶哨兵');
  const H = buildFriends(SRC, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
  const r1 = await H.call('post', '/api/friends/alias', {}, { fid: AB.fid, alias: 'X' });
  assert.strictEqual(r1.code, 401); assert.strictEqual(r1.body.code, 'friends-auth-required');
  const r1b = await H.call('post', '/api/friends/alias', {}, { playerId: 'fA', fid: AB.fid, alias: 'X' });
  assert.strictEqual(r1b.code, 401, 'playerId fallback 應 401');
  const H2 = buildFriends(SRC, { seed: seedOn(), locals: {}, dbOpts: { indexes: REG_IDX } });
  const r2 = await setAlias(H2, U.A, AB.fid, 'X');
  assert.strictEqual(r2.code, 503); assert.strictEqual(r2.body.code, 'friends-helper-missing');
  const E11000 = 'E11000 duplicate key error collection: ptcg.friendships index: _id_ dup key: { _id: "alice@example.com|bob@example.com" }';
  const inner = makeFakeDb(seedOn(), { indexes: REG_IDX });
  const boom = () => { throw new Error(E11000); };
  const db = { _store: inner._store, _log: inner._log, snapshot: (n) => inner.snapshot(n), collection: (n) => (n === 'friendships'
    ? { createIndex: () => Promise.reject(new Error(E11000)), findOne: boom, find: boom, countDocuments: boom, updateOne: boom, replaceOne: boom, deleteOne: boom, indexes: boom, aggregate: boom }
    : inner.collection(n)) };
  const H3 = buildFriends(SRC, { db });
  const r3 = await setAlias(H3, U.A, AB.fid, 'X');
  assert.strictEqual(r3.code, 500, JSON.stringify(r3.body)); assert.strictEqual(r3.body.code, 'friends-error');
  assert.deepStrictEqual(findEmails(r3.body), [], '500 回應含 email');
  for (const lp of ['alice', 'bob', 'E11000', 'dup key']) assert.ok(!JSON.stringify(r3.body).includes(lp), '500 回應洩漏「' + lp + '」');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐⭐ 對方看不到我給他取的備註名（兩側哨兵互掃）');
const SENT_A = 'ZQXSENTINELALPHA';   // A 給 B 取的備註名
const SENT_B = 'ZQXSENTINELBRAVO';   // B 給 A 取的備註名
const countIn = (obj, s) => (JSON.stringify(obj === undefined ? null : obj).split(s).length - 1);
async function crossFlow(src) {
  const H = buildFriends(src, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
  const sa = await setAlias(H, U.A, AB.fid, SENT_A);
  const sb = await setAlias(H, U.B, AB.fid, SENT_B);
  assert.strictEqual(sa.code, 200, JSON.stringify(sa.body)); assert.strictEqual(sb.code, 200, JSON.stringify(sb.body));
  await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '安安' });
  await H.call('post', '/api/friends/dm/send', asUser(U.B), { fid: AB.fid, text: '你好' });
  const asideA = [
    ['A list', await H.call('get', '/api/friends/list', asUser(U.A))],
    ['A dm/list', await H.call('get', '/api/friends/dm/list', asUser(U.A), null, { fid: AB.fid })],
  ];
  const asideB = [
    ['B list', await H.call('get', '/api/friends/list', asUser(U.B))],
    ['B dm/list', await H.call('get', '/api/friends/dm/list', asUser(U.B), null, { fid: AB.fid })],
  ];
  const asideAdmin = [
    ['admin dm 總覽', await H.call('get', '/api/friends/admin/dm', admin)],
    ['admin dm 展開', await H.call('get', '/api/friends/admin/dm', admin, null, { fid: AB.fid })],
    ['admin config', await H.call('get', '/api/friends/admin/config', admin)],
    ['admin dm-config', await H.call('get', '/api/friends/admin/dm-config', admin)],
  ];
  return { H, asideA, asideB, asideAdmin };
}
await T('C1 ⭐⭐⭐ A 的所有回應含 A 的哨兵、**零**含 B 的哨兵；B 反之（list ＋ dm/list 兩支各自實跑）', async () => {
  const { asideA, asideB } = await crossFlow(SRC);
  assert.strictEqual(countIn(asideA[0][1].body, SENT_A), 1, 'A 的 list 應恰含一次自己的備註名');
  for (const [label, r] of asideA) {
    assert.strictEqual(r.code, 200, label + ' 應 200：' + JSON.stringify(r.body));
    assert.strictEqual(countIn(r.body, SENT_B), 0, '⚠⚠⚠ ' + label + ' 洩漏了 B 給 A 取的備註名：' + JSON.stringify(r.body).slice(0, 400));
  }
  assert.strictEqual(countIn(asideB[0][1].body, SENT_B), 1, 'B 的 list 應恰含一次自己的備註名');
  for (const [label, r] of asideB) {
    assert.strictEqual(r.code, 200, label + ' 應 200：' + JSON.stringify(r.body));
    assert.strictEqual(countIn(r.body, SENT_A), 0, '⚠⚠⚠ ' + label + ' 洩漏了 A 給 B 取的備註名：' + JSON.stringify(r.body).slice(0, 400));
  }
});
await T('C2 ⚠⚠ admin 四支端點：**兩個哨兵都零出現**（站長不需要看玩家的私人備註）；但 admin 確實拿得到私聊內文與 email（掃描器正對照）', async () => {
  const { asideAdmin } = await crossFlow(SRC);
  for (const [label, r] of asideAdmin) {
    assert.strictEqual(r.code, 200, label + ' 應 200：' + JSON.stringify(r.body));
    assert.strictEqual(countIn(r.body, SENT_A), 0, '⚠⚠ ' + label + ' 帶了玩家的私人備註名（A 側）');
    assert.strictEqual(countIn(r.body, SENT_B), 0, '⚠⚠ ' + label + ' 帶了玩家的私人備註名（B 側）');
    assert.ok(!/alias/i.test(JSON.stringify(r.body)), label + ' 回應出現 alias 欄位');
  }
  const expand = asideAdmin.find((x) => x[0] === 'admin dm 展開')[1];
  assert.ok(JSON.stringify(expand.body).includes('安安'), '掃描器正對照：admin 展開本來就看得到私聊內文（否則 C2 是恆真式）');
  assert.ok(findEmails(expand.body).length >= 2, '掃描器正對照：admin 端點本來就帶 email（否則 C2 是恆真式）');
});
await T('C3 ⭐ 掃描器自驗：把哨兵直接塞進被掃的物件會被抓到（否則 C1／C2 是恆真式）', () => {
  assert.strictEqual(countIn({ x: [{ alias: SENT_B }] }, SENT_B), 1);
  assert.strictEqual(countIn({ x: null }, SENT_B), 0);
});
await T('C3m ⭐⭐⭐ 正對照：_frPublic 改成回**對方那一側** ⇒ C1 紅在「洩漏」', async () => {
  const bad = mutate(SRC, 'alias: _frAlias(doc.a === me ? doc.aliasByA : doc.aliasByB) || null,', 'alias: _frAlias(doc.a === me ? doc.aliasByB : doc.aliasByA) || null,');
  await mutantMustBreak('回對方那一側', async () => {
    const { asideA } = await crossFlow(bad);
    for (const [label, r] of asideA) assert.strictEqual(countIn(r.body, SENT_B), 0, '⚠⚠⚠ ' + label + ' 洩漏了 B 給 A 取的備註名');
  }, '洩漏了 B 給 A 取的備註名');
});
await T('C4 ⭐ DM／admin 區塊逐欄 projection 裡沒有 alias，而且整個 DM 區塊沒出現 alias 這個字（靜態保險）', () => {
  const projs = [...DM.matchAll(/projection: \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(projs.length >= 3, '掃描器下限：DM 區塊的 projection 只找到 ' + projs.length + ' 個');
  for (const p of projs) assert.ok(!/alias/i.test(p), 'admin 端的 projection 帶了 alias：' + p.trim().slice(0, 120));
  assert.ok(!/alias/i.test(DM), 'DM 區塊（含 admin 端點）不該出現 alias 這個字');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】最新暱稱：優先序四階 ／ 索引 fail-closed ／ N+1 ／ 讓路');
const reg = (email, name, at) => ({ _id: 'EV' + at + '__' + email, eventId: 'EV' + at, uid: 'u', email, name, registeredAt: at });
const aggOn = (db, name) => db._log.filter((l) => l.name === name && l.op === 'aggregate');

await T('D1 ⭐ 顯示優先序四階各自實跑：① alias ② TREGS 最新報名暱稱 ③ friendships 快照 ④「玩家」', async () => {
  let H = buildFriends(SRC, { seed: seedOn([mkRow(U.A.email, U.B.email, 'accepted', { aliasByA: '我的備註' })], [reg(U.B.email, 'TREGS暱稱', 5)]), dbOpts: { indexes: REG_IDX } });
  let f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f.alias, '我的備註', '①alias'); assert.strictEqual(f.nick, 'TREGS暱稱', '①的 nick 應是 TREGS（不得被 alias 合併掉）');
  H = buildFriends(SRC, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'TREGS暱稱', 5)]), dbOpts: { indexes: REG_IDX } });
  f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f.alias, null, '②alias'); assert.strictEqual(f.nick, 'TREGS暱稱', '②的 nick 應是 TREGS 而不是快照：' + f.nick);
  H = buildFriends(SRC, { seed: seedOn([structuredClone(AB)], []), dbOpts: { indexes: REG_IDX } });
  f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f.nick, '快照B', '③的 nick 應退回 friendships 快照：' + f.nick);
  H = buildFriends(SRC, { seed: seedOn([mkRow(U.A.email, U.B.email, 'accepted', { nickA: null, nickB: null })], []), dbOpts: { indexes: REG_IDX } });
  f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f.nick, '玩家', '④的 nick 應是「玩家」：' + f.nick);
  assert.strictEqual(f.alias, null, '④alias');
});
await T('D2 ⭐⭐ 索引不存在 ⇒ **整段跳過**：對 tournamentRegistrations **零**查詢（絕不全表掃），暱稱退回快照', async () => {
  const H = buildFriends(SRC, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'TREGS暱稱', 5)]), dbOpts: { noAutoIndex: true } });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.strictEqual(aggOn(H.db, 'tournamentRegistrations').length, 0, '⚠⚠ 沒有索引卻還是查了 tournamentRegistrations（＝全表掃）');
  assert.strictEqual(H.db._log.filter((l) => l.name === 'tournamentRegistrations' && /^(find|findOne|countDocuments)$/.test(l.op)).length, 0, '沒有索引卻還是查了（find 型）');
  assert.strictEqual(r.body.friends[0].nick, '快照B', '索引缺席時應退回快照：' + r.body.friends[0].nick);
  assert.ok(H.logs.some((l) => l.includes('[friends]') && l.includes('索引')), '索引缺席應留一行 warn 讓站長查得到');
});
await T('D2m ⭐ 正對照：拿掉索引自驗那一行 ⇒ D2 紅在「全表掃」', async () => {
  const bad = mutate(SRC, '      if (!(await _frRegIndexReady())) return out;\n', '');
  await mutantMustBreak('無索引自驗', async () => {
    const H = buildFriends(bad, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'X', 5)]), dbOpts: { noAutoIndex: true } });
    await H.call('get', '/api/friends/list', asUser(U.A));
    assert.strictEqual(aggOn(H.db, 'tournamentRegistrations').length, 0, '⚠⚠ 沒有索引卻還是查了 tournamentRegistrations（＝全表掃）');
  }, '全表掃');
});
await T('D3 ⭐ N+1 防護：10 個好友 ⇒ 對 tournamentRegistrations 的查詢次數恰 **1**（不是 10），且 $in 內容恰好是這 10 位（不得掃全表）', async () => {
  const rows = [], regs = [];
  for (let i = 0; i < 10; i++) {
    const e = 'p' + String(i).padStart(2, '0') + '@example.com';
    rows.push(mkRow(U.A.email, e, 'accepted'));
    regs.push(reg(e, '暱' + i, 100 + i));
  }
  regs.push(reg('outsider@example.com', '不相干', 999));
  const H = buildFriends(SRC, { seed: seedOn(rows, regs), dbOpts: { indexes: REG_IDX } });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.friends.length, 10);
  const aggs = aggOn(H.db, 'tournamentRegistrations');
  assert.strictEqual(aggs.length, 1, '⚠⚠ TREGS 查詢次數＝' + aggs.length + '（N+1！應該恰好 1 發批次查詢）');
  const all = H.db._log.filter((l) => l.name === 'tournamentRegistrations' && /^(find|findOne|countDocuments|aggregate)$/.test(l.op));
  assert.strictEqual(all.length, 1, '⚠⚠ TREGS 全部查詢次數＝' + all.length + '（含 find 型）');
  const m = aggs[0].pipeline[0].$match;
  assert.ok(m && m.email && Array.isArray(m.email.$in), '第一個 stage 必須是 $match email $in（否則就是掃全表）：' + JSON.stringify(aggs[0].pipeline[0]));
  assert.deepStrictEqual([...m.email.$in].sort(), rows.map((x) => (x.a === U.A.email ? x.b : x.a)).sort(), '$in 內容不是這次的好友清單');
  assert.ok(!r.body.friends.some((x) => x.nick === '不相干'), '撈到了不相干的人');
  assert.deepStrictEqual(r.body.friends.map((x) => x.nick).sort(), regs.slice(0, 10).map((x) => x.name).sort(), '暱稱沒套到 TREGS');
});
await T('D4 只取**最新**一筆（registeredAt 最大）；同一人多筆歷史報名不會取到舊的', async () => {
  const H = buildFriends(SRC, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, '很久以前', 1), reg(U.B.email, '最新暱稱', 9), reg(U.B.email, '中間那次', 5)]), dbOpts: { indexes: REG_IDX } });
  const f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f.nick, '最新暱稱', '沒有取最新一筆：' + f.nick);
});
await T('D5 ⭐ TREGS 的 name 等於 email 前綴 ⇒ 不採用（不露半個 email），退回快照', async () => {
  const H = buildFriends(SRC, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'bob', 5)]), dbOpts: { indexes: REG_IDX } });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.body.friends[0].nick, '快照B', 'email 前綴被當成暱稱回出去了：' + r.body.friends[0].nick);
  assert.ok(!JSON.stringify(r.body).includes('"bob"'), '半個 email 外洩');
});
await T('D6 已知限制（誠實記錄）：TREGS 的 email 沒有正規化，大小寫不同 ⇒ 查無 ⇒ 退回快照（fail-graceful，不是靜默錯配）', async () => {
  const H = buildFriends(SRC, { seed: seedOn([structuredClone(AB)], [reg('Bob@Example.com', '大小寫暱稱', 5)]), dbOpts: { indexes: REG_IDX } });
  const f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
  assert.strictEqual(f.nick, '快照B', '大小寫不同時應退回快照（若這條紅了代表行為改了，請同步更新區塊註解）：' + f.nick);
});
await T('D7 ⭐ 讓路節拍：250 好友＋250 筆 TREGS ⇒ ticks 恰 2（docs 迴圈 1 ＋ TREGS 迴圈 1；playerIdentity 空 ⇒ 0）', async () => {
  const rows = [], regs = [];
  for (let i = 0; i < 250; i++) {
    const e = 'q' + String(i).padStart(3, '0') + '@example.com';
    rows.push(mkRow(U.A.email, e, 'accepted')); regs.push(reg(e, 'N' + i, 10 + i));
  }
  const yc = { ticks: 0 };
  const H = buildFriends(SRC, { seed: seedOn(rows, regs), yieldCounter: yc, dbOpts: { indexes: REG_IDX, ioDelay: true } });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.friends.length, 250);
  assert.strictEqual(yc.ticks, 2, '讓路節拍：docs 迴圈與 TREGS 迴圈各應讓路 1 次，實得 ' + yc.ticks);
});
await T('D7m ⭐ 正對照：拿掉 TREGS 迴圈的讓路 ⇒ D7 紅在「讓路節拍」', async () => {
  const bad = mutate(SRC, '        const w = y(++k); if (w) await w;\n      }\n      return out;\n    }\n', '        ++k;\n      }\n      return out;\n    }\n');
  await mutantMustBreak('TREGS 迴圈無讓路', async () => {
    const rows = [], regs = [];
    for (let i = 0; i < 250; i++) { const e = 'q' + String(i).padStart(3, '0') + '@example.com'; rows.push(mkRow(U.A.email, e, 'accepted')); regs.push(reg(e, 'N' + i, 10 + i)); }
    const yc = { ticks: 0 };
    const H = buildFriends(bad, { seed: seedOn(rows, regs), yieldCounter: yc, dbOpts: { indexes: REG_IDX, ioDelay: true } });
    await H.call('get', '/api/friends/list', asUser(U.A));
    assert.strictEqual(yc.ticks, 2, '讓路節拍：docs 迴圈與 TREGS 迴圈各應讓路 1 次，實得 ' + yc.ticks);
  }, '讓路節拍');
});
await T('D8 啟動時真的對 tournamentRegistrations 呼叫 createIndex({email,registeredAt,name})，且與查詢的 hint／自驗字串逐字一致（不得漂移）', async () => {
  const H = buildFriends(SRC, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
  const idx = H.db._log.filter((l) => l.op === 'createIndex' && l.name === 'tournamentRegistrations').map((l) => JSON.stringify(l.keys));
  assert.deepStrictEqual(idx, ['{"email":1,"registeredAt":-1,"name":1}'], 'createIndex 沒建（或建錯）TREGS 索引：' + idx.join(' '));
  assert.ok(FR.includes('const FR_REG_IDX = { email: 1, registeredAt: -1, name: 1 };'), 'hint 常數變了');
  assert.ok(FR.includes('const FR_REG_IDX_KEY = \'{"email":1,"registeredAt":-1,"name":1}\';'), '索引自驗比對的 key 字串與 createIndex 不一致');
  assert.ok(/\], \{ hint: FR_REG_IDX,/.test(FR), 'aggregate 沒有把 hint 綁死在那支索引上');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】回應永不含 email（含 alias 路徑）');
await T('E1 ⭐ 含 email 假資料（friendships／TREGS／playerIdentity）跑完整 alias 流程 ⇒ 每個回應序列化後掃不到 email，也掃不到 local-part', async () => {
  const seed = seedOn([structuredClone(AB)], [reg(U.B.email, '鮑伯的暱稱', 5)]);
  // ⚠ uid 故意不含 email 的 local-part —— 否則下面「掃不到 local-part」那一條會被 uid 誤觸（uid 本來就會回給 client）
  seed.playerIdentity = [{ _id: U.B.email, uid: 'oXY1', uids: [{ uid: 'oXY1', at: 1 }], nick: '對照表暱稱' }];
  const H = buildFriends(SRC, { seed, dbOpts: { indexes: REG_IDX } });
  const out = [];
  out.push(['set', await setAlias(H, U.A, AB.fid, '小明')]);
  out.push(['list', await H.call('get', '/api/friends/list', asUser(U.A))]);
  out.push(['clear', await setAlias(H, U.A, AB.fid, '')]);
  out.push(['list2', await H.call('get', '/api/friends/list', asUser(U.A))]);
  out.push(['409', await setAlias(H, U.C, AB.fid, 'x')]);
  assert.ok(out.length >= 5, '流程只跑了 ' + out.length + ' 發（掃描器壞了？）');
  for (const [label, r] of out) {
    assert.deepStrictEqual(findEmails(r.body), [], label + ' 洩漏 email：' + JSON.stringify(r.body));
    assert.ok(!JSON.stringify(r.body).includes('@'), label + ' 含 @');
    for (const lp of ['alice', 'bob', 'carol']) assert.ok(!JSON.stringify(r.body).includes(lp), label + ' 洩漏半個 email「' + lp + '」');
  }
  assert.ok(findEmails(H.db.snapshot('friendships').concat(H.db.snapshot('tournamentRegistrations'))).length >= 3, '掃描器正對照：DB 假資料裡 email 太少');
  assert.ok(!out[1][1].body.friends.some((x) => x.nick === '對照表暱稱'), '⚠⚠ nick 又吃回 playerIdentity（v6.286【2】的裁定不可退回）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】突變（除了上面已就地做的 C3m／D2m／D7m，這裡再補七個）');
await T('F1 突變：alias 端點拿掉 accepted 閘 ⇒ B3 紅', async () => {
  const bad = mutate(SRC, "        if (cur.status !== 'accepted') return res.status(409).json({ error: '只能為好友設定備註名', code: 'friends-alias-not-friend', friendsApi: 1 });\n", '');
  await mutantMustBreak('無 accepted 閘', async () => {
    const H = buildFriends(bad, { seed: seedOn([mkRow(U.A.email, U.B.email, 'pending')]), dbOpts: { indexes: REG_IDX } });
    const r = await setAlias(H, U.A, AB.fid, '不該寫進去');
    assert.strictEqual(r.code, 409, 'pending 應 409，實得 ' + r.code);
  }, 'pending 應 409');
});
await T('F2 突變：欄位選錯邊（寫／清掉**對方**那一側）⇒ B5 紅', async () => {
  const bad = mutate(SRC, "        const field = cur.a === me.email ? 'aliasByA' : 'aliasByB';", "        const field = cur.a === me.email ? 'aliasByB' : 'aliasByA';");
  await mutantMustBreak('清對方那一側', async () => {
    const row = mkRow(U.A.email, U.B.email, 'accepted', { aliasByA: 'A的備註', aliasByB: 'B的備註' });
    const H = buildFriends(bad, { seed: seedOn([row]), dbOpts: { indexes: REG_IDX } });
    await setAlias(H, U.A, AB.fid, '');
    assert.strictEqual(rowOf(H, AB._id).aliasByB, 'B的備註', '⚠⚠ 動到了對方的備註名');
  }, '動到了對方的備註名');
});
await T('F3 突變：_frAlias 不清零寬字元 ⇒ B2 紅', async () => {
  const bad = mutate(SRC, ".replace(/[\\u200b-\\u200f\\u2060\\ufeff]/g, '')", '');
  await mutantMustBreak('零寬字元沒清', async () => {
    const H = buildFriends(bad, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
    const r = await setAlias(H, U.A, AB.fid, '路​卡‍利﻿歐');
    assert.strictEqual(r.body.alias, '路卡利歐', '零寬字元 淨化結果不對：' + JSON.stringify(r.body.alias));
  }, '零寬字元 淨化結果不對');
});
await T('F4 突變：上限從 20 放寬成 40 ⇒ B2 紅', async () => {
  const bad = mutate(SRC, 'const FR_ALIAS_MAX_LEN = 20;', 'const FR_ALIAS_MAX_LEN = 40;');
  await mutantMustBreak('上限 40', async () => {
    const H = buildFriends(bad, { seed: seedOn(), dbOpts: { indexes: REG_IDX } });
    const r = await setAlias(H, U.A, AB.fid, '一二三四五六七八九十一二三四五六七八九十壹貳參');
    assert.strictEqual(r.body.alias, '一二三四五六七八九十一二三四五六七八九十', '超過 20 字 淨化結果不對：' + JSON.stringify(r.body.alias));
  }, '超過 20 字 淨化結果不對');
});
await T('F5 突變：list 不套 TREGS 暱稱 ⇒ D1 的②紅', async () => {
  const bad = mutate(SRC, '          if (_ln) p.nick = _ln;\n', '');
  await mutantMustBreak('不套 TREGS', async () => {
    const H = buildFriends(bad, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'TREGS暱稱', 5)]), dbOpts: { indexes: REG_IDX } });
    const f = (await H.call('get', '/api/friends/list', asUser(U.A))).body.friends[0];
    assert.strictEqual(f.nick, 'TREGS暱稱', '②的 nick 應是 TREGS 而不是快照：' + f.nick);
  }, '②的 nick 應是 TREGS');
});
await T('F6 突變：$match 拿掉 email 條件（掃全表）⇒ D3 紅在「$match email $in」', async () => {
  const bad = mutate(SRC, '        { $match: { email: { $in: emails } } },', '        { $match: {} },');
  await mutantMustBreak('掃全表', async () => {
    const H = buildFriends(bad, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'X', 5)]), dbOpts: { indexes: REG_IDX } });
    await H.call('get', '/api/friends/list', asUser(U.A));
    const m = aggOn(H.db, 'tournamentRegistrations')[0].pipeline[0].$match;
    assert.ok(m && m.email && Array.isArray(m.email.$in), '第一個 stage 必須是 $match email $in（否則就是掃全表）');
  }, '$match email $in');
});
await T('F7 突變：_frLatestNicks 用 _frNick 取代 _frAuthNick（不擋 email 前綴）⇒ D5 紅', async () => {
  const bad = mutate(SRC, 'const nm = key ? _frAuthNick(r.name, key) : null;', 'const nm = key ? _frNick(r.name) : null;');
  await mutantMustBreak('不擋 email 前綴', async () => {
    const H = buildFriends(bad, { seed: seedOn([structuredClone(AB)], [reg(U.B.email, 'bob', 5)]), dbOpts: { indexes: REG_IDX } });
    const r = await H.call('get', '/api/friends/list', asUser(U.A));
    assert.strictEqual(r.body.friends[0].nick, '快照B', 'email 前綴被當成暱稱回出去了：' + r.body.friends[0].nick);
  }, 'email 前綴被當成暱稱回出去了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】test chain ／ 版本一致（不 pin 版本號）');
await T('G1 本守衛在 package.json 的 test chain（只加進 iron-rules-audit 等於沒加）', () => {
  const t = JSON.parse(PKG).scripts.test;
  assert.ok(t.includes('scripts/test-v6295-friends-alias-nick.mjs'), '沒有加進 npm test 的 chain');
});
await T('G2 版本一致：version.ts ＝ admin.html SITE_VERSION_HINT（比較而非 pin 死數字）', () => {
  const V = /VERSION = '([\d.]+)'/.exec(VERTS)[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'admin.html hint ' + H + ' ≠ version.ts ' + V);
});
await T('G3 FRIENDS 區塊版號 log 有對應的變更條目（同樣不 pin 死版本號）', () => {
  const m = /console\.log\('\[friends\] endpoints registered \(v(\d+)\.(\d+)\)/.exec(PATCH);
  assert.ok(m, '少了版號 log');
  assert.ok(PATCH.includes('v' + m[1] + '.' + m[2] + '（v6.'), '版號 log v' + m[1] + '.' + m[2] + ' 在區塊開頭找不到對應的變更條目');
});

console.log('\n══ v6.295 好友備註名＋最新暱稱守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
