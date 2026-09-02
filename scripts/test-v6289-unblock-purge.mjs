// v6.289 守衛：解除封鎖（unblock）的**真刪分支**也一併刪 dm:<fid> 私聊（站長裁定，與 v6.288 的 remove 同一條紀律）。
//   ⚠ 行為端實跑（FRIENDS＋DM 區塊抽出來用假 db 跑），不是只 grep 字串。
//   【A】錦標賽區塊 sha256（兩把既有）＋ HEAD-FAIL 錨點（BASE v6.288 的 unblock 沒接 _frPurgeDm ⇒ A0 與 B1 必紅）
//   【B】unblock 冷卻外（deleteOne 真刪）⇒ 只刪 room==='dm:'+fid；**lobby 逐 id 一筆不少**、**別段 dm 一筆不少**；
//        冷卻內（還原成 rejected）⇒ **不刪**；deletedCount===0 ⇒ 不刪；_frPurgeDm 丟例外 ⇒ unblock 仍 200；
//        被封鎖方／陌生人打 unblock ⇒ 零刪除
//   【C】≥4 個惡意突變各自要紅在預期那條（兩條分支都刪／$regex 前綴／不看 deletedCount／purge 改 throw／無過濾／拿掉呼叫）
//   【D】靜態：purge 只在 unblock 的 deleteOne 之後；rejected 還原分支零 purge；_frPurgeDm 出現 3 次；block／reject／accept 零 purge
//   【E】client：解除封鎖二次確認文案含「對話」「無法復原」（突變拿掉「對話」要紅）；解除好友文案不變
//   【F】test chain；version.ts 與 admin.html 一致（不 pin 版本）
//   ⚠ 只捕 assert.AssertionError；其他例外直接炸（不吞）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  readPatch, extractBlock, FR_START, FR_END,
  buildFriends, makeFakeDb, asUser,
} from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const P_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');
const DM_START = '// >>> PTCG-FRIENDS-DM-BLOCK-START';
const DM_END = '// <<< PTCG-FRIENDS-DM-BLOCK-END';
const TOURN_TAIL_SHA256 = '495221f1dbf51dea9020284147fcf9b271d2baeccdac8d3b4745110c409dca02';   // 與 test-v6272 ⑨／test-v6288 A1 同一把
const TOURN_ANCHOR_SHA256 = '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd'; // 與 test-v6278 I1／test-v6288 A1 同一把
const UNBLOCK_PURGE_LINE = "        if (del && del.deletedCount > 0) await _frPurgeDm(cur.fid || _frFid(cur._id), 'unblock');\n";
const UNBLOCK_DEL_LINE = "        const del = await c.deleteOne({ _id: cur._id, status: 'blocked', blockedBy: me.email });\n";
const UNBLOCK_CONFIRM = '<span class="confirm">解除封鎖後關係會歸零，要重新邀請才會成為好友；和這位玩家的私聊對話也會一起刪除，無法復原。</span>';
const REMOVE_CONFIRM = '<span class="confirm">確定解除好友？雙方名單都會移除，和這位好友的私聊對話也會一起刪除，無法復原。</span>';

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 600)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 200) + '（預期含「' + expectFrag + '」）');
  console.log('    ✓ 突變「' + name + '」紅在：' + String(err.message).slice(0, 90));
};
const mutate = (src, a, b) => { const n = src.split(a).length - 1; assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 80)); return src.replace(a, b, 1); };

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】錦標賽區塊 sha256 ＋ HEAD-FAIL 錨點');
const PATCH = readPatch(P_SRV);
const FR = extractBlock(PATCH, FR_START, FR_END, 15000);
const DM = extractBlock(PATCH, DM_START, DM_END, 8000);
const SRC = FR + '\n' + DM;
const PAGE = readFileSync(P_PAGE, 'utf8');
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256）；FRIENDS／DM 區塊都在第一支 /api/tournament 之前', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");
  assert.ok(first > 0);
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(FR_END) < PATCH.indexOf(DM_START) && PATCH.indexOf(DM_END) < first, '區塊位置不對');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗');
});
await T('A0 HEAD-FAIL 錨點：FRIENDS 區塊有 _frPurgeDm（v6.288 就有），且 unblock 的 deleteOne 之後接 _frPurgeDm(…, \'unblock\')（BASE v6.288 沒有 ⇒ 這一條必紅）', () => {
  assert.ok(FR.includes('async function _frPurgeDm('), 'FRIENDS 區塊沒有 _frPurgeDm');
  assert.ok(FR.includes(UNBLOCK_DEL_LINE) && FR.includes(UNBLOCK_PURGE_LINE), 'unblock 沒接 _frPurgeDm（v6.289 裁定）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】伺服器行為端：unblock 真刪分支刪 dm:<fid>；lobby／別段 dm 一筆不少；冷卻內不刪；deletedCount=0 不刪；purge 炸掉仍 200');
const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'fB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'fC', email: 'carol@example.com', name: '卡蘿' },
};
function frHash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x7fffffff;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= (c * 31 + i) & 0xffff; h2 = Math.imul(h2, 0x01000193) >>> 0; }
  const h3 = Math.imul(h1 ^ h2, 0x9e3779b1) >>> 0;
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0')).slice(0, 24);
}
const mkRow = (e1, e2, status, extra) => {
  const [a, b] = e1 < e2 ? [e1, e2] : [e2, e1]; const _id = a + '|' + b;
  return Object.assign({ _id, fid: frHash(_id), a, b, status: status || 'accepted', requester: a, blockedBy: null, nickA: '暱稱A', nickB: '暱稱B', addedVia: 'battle', createdAt: 1, updatedAt: 1 }, extra || {});
};
const AB = mkRow(U.A.email, U.B.email), AC = mkRow(U.A.email, U.C.email), BC = mkRow(U.B.email, U.C.email);
const N_LOBBY = 300, N_AB = 40, N_AC = 30, N_BC = 25;
function chatSeed() {
  const out = [];
  for (let i = 0; i < N_LOBBY; i++) out.push({ _id: 'l' + i, room: 'lobby', uid: 'u', name: 'n', text: 't' + i, ts: 1000 + i });
  const dm = (row, n, tag) => { for (let i = 0; i < n; i++) out.push({ _id: tag + i, room: 'dm:' + row.fid, side: i % 2 ? 'b' : 'a', text: tag + i, ts: 500 + i, expireAt: new Date(1_800_000_000_000) }); };
  dm(AB, N_AB, 'ab'); dm(AC, N_AC, 'ac'); dm(BC, N_BC, 'bc');
  return out;
}
// A 封鎖 B（冷卻外：沒有 rejectedAt）／（冷卻內：帶 1 秒前的 rejectedAt）
const BLK = (extra) => mkRow(U.A.email, U.B.email, 'blocked', Object.assign({ blockedBy: U.A.email }, extra || {}));
const seedAll = (rows) => ({ tournamentConfig: [{ _id: 'friendsConfig', enabled: true, dm: true }], friendships: (rows || [BLK(), AC, BC]).map((r) => structuredClone(r)), tournamentChat: chatSeed() });
const ids = (db, pred) => db.snapshot('tournamentChat').filter((d) => pred(d.room)).map((d) => d._id).sort();
const lobbyIds0 = ids(makeFakeDb(seedAll()), (r) => r === 'lobby');
const acIds0 = ids(makeFakeDb(seedAll()), (r) => r === 'dm:' + AC.fid);
const bcIds0 = ids(makeFakeDb(seedAll()), (r) => r === 'dm:' + BC.fid);
const delOps = (db) => db._log.filter((l) => l.name === 'tournamentChat' && /^(deleteMany|deleteOne)$/.test(l.op));
async function unblockAB(src, opts) {
  const o = opts || {};
  const H = buildFriends(src, o.db ? { db: o.db } : { seed: o.seed || seedAll() });
  const r = await H.call('post', '/api/friends/unblock', asUser(o.who || U.A), { fid: o.fid || AB.fid });
  return { H, r };
}
function assertOthersIntact(H, why) {
  assert.deepStrictEqual(ids(H.db, (r) => r === 'lobby'), lobbyIds0, '⚠⚠ lobby 訊息被刪到了（' + why + '）');
  assert.deepStrictEqual(ids(H.db, (r) => r === 'dm:' + AC.fid), acIds0, '⚠⚠ 別段對話（A|C）被刪到了（' + why + '）');
  assert.deepStrictEqual(ids(H.db, (r) => r === 'dm:' + BC.fid), bcIds0, '⚠⚠ 別段對話（B|C）被刪到了（' + why + '）');
}
// 冷卻外真刪：完整斷言（B1 與突變共用）
async function assertUnblockPurges(src, why) {
  const { H, r } = await unblockAB(src);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.removed, true);
  assert.deepStrictEqual(H.db.snapshot('friendships').map((d) => d._id).sort(), [AC._id, BC._id].sort(), 'friendships 刪錯列');
  assert.strictEqual(ids(H.db, (x) => x === 'dm:' + AB.fid).length, 0, 'dm:AB 沒被刪（unblock 冷卻外＝真刪分支，v6.289 裁定要刪）');
  assertOthersIntact(H, why);
  const dm = delOps(H.db);
  assert.strictEqual(dm.length, 1, 'tournamentChat 的刪除呼叫數：' + dm.length);
  assert.strictEqual(dm[0].op, 'deleteMany');
  assert.deepStrictEqual(dm[0].f, { room: 'dm:' + AB.fid }, 'filter 必須是等值 room：' + JSON.stringify(dm[0].f));
  assert.ok(!H.logs.some((l) => l.includes('purge dm failed')), '不該有 purge 失敗 log：' + JSON.stringify(H.logs));
  return H;
}
// 冷卻內還原成 rejected：不刪（B2 與突變共用）
async function assertCooldownKeeps(src, why) {
  const { H, r } = await unblockAB(src, { seed: seedAll([BLK({ rejectedAt: Date.now() - 1000 }), AC, BC]) });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.removed, true);
  const row = H.db.snapshot('friendships').find((d) => d._id === AB._id);
  assert.ok(row && row.status === 'rejected' && row.blockedBy === null, 'unblock（冷卻內）應還原成 rejected：' + JSON.stringify(row));
  assert.strictEqual(ids(H.db, (x) => x === 'dm:' + AB.fid).length, N_AB, 'unblock（冷卻內）刪到對話了（列還在，不可刪）');
  assertOthersIntact(H, why);
  assert.strictEqual(delOps(H.db).length, 0, '冷卻內不得有任何 tournamentChat 刪除呼叫');
  return H;
}
// friendships.deleteOne 回 deletedCount:0（模擬 findOne 與 deleteOne 之間那一列被改掉）⇒ 不刪（B3 與突變共用）
function dbWithDeleteZero() {
  const db = makeFakeDb(seedAll());
  const col = db.collection.bind(db);
  db.collection = (name) => {
    const c = col(name);
    if (name !== 'friendships') return c;
    return Object.assign({}, c, { deleteOne: async (f) => { db._log.push({ name, op: 'deleteOne', f, faked: 0 }); return { deletedCount: 0 }; } });
  };
  return db;
}
async function assertDeleteZeroKeeps(src, why) {
  const db = dbWithDeleteZero();
  const { H, r } = await unblockAB(src, { db });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  assert.ok(H.db._log.some((l) => l.name === 'friendships' && l.op === 'deleteOne' && l.faked === 0), '假 deleteOne 沒被走到（掃描器自驗）');
  assert.strictEqual(ids(H.db, (x) => x === 'dm:' + AB.fid).length, N_AB, 'deletedCount=0 仍刪對話（' + why + '）');
  assertOthersIntact(H, why);
  assert.strictEqual(delOps(H.db).length, 0, 'deletedCount=0 不得有任何 tournamentChat 刪除呼叫');
  return H;
}
// _frPurgeDm 內 deleteMany 丟例外 ⇒ unblock 仍 200、列已刪、只 log（B4 與突變共用）
async function assertPurgeThrowStill200(src) {
  const db = makeFakeDb(seedAll(), { throwOn: (name, op) => name === 'tournamentChat' && op === 'deleteMany' });
  const { H, r } = await unblockAB(src, { db });
  assert.strictEqual(r.code, 200, 'unblock 應 200（purge 失敗不可讓 unblock 變 500）：' + JSON.stringify(r.body));
  assert.strictEqual(r.body.removed, true);
  assert.ok(!H.db.snapshot('friendships').some((d) => d._id === AB._id), '關係列應已刪');
  assert.ok(H.logs.some((l) => l.includes('purge dm failed (unblock')), '刪對話失敗要 log 且 why=unblock：' + JSON.stringify(H.logs));
  assertOthersIntact(H, 'B4');
  return H;
}

await T('B1 ⭐⭐ A 解除封鎖 B（冷卻外）⇒ 200 removed:true；friendships 只少那一列；dm:AB 40 → 0；lobby 300 筆逐 id 相同；A|C／B|C 對話逐 id 相同；只有一次 deleteMany 且 filter 等值 room', async () => {
  assert.strictEqual(lobbyIds0.length, N_LOBBY, '種子壞了'); assert.strictEqual(acIds0.length, N_AC); assert.strictEqual(bcIds0.length, N_BC);
  const H = await assertUnblockPurges(SRC, 'B1');
  console.log('    lobby 逐 id 比對：' + ids(H.db, (r) => r === 'lobby').length + '/' + N_LOBBY + '；dm:A|C ' + ids(H.db, (r) => r === 'dm:' + AC.fid).length + '/' + N_AC + '；dm:B|C ' + ids(H.db, (r) => r === 'dm:' + BC.fid).length + '/' + N_BC + '；dm:A|B ' + ids(H.db, (r) => r === 'dm:' + AB.fid).length + '/' + N_AB);
  const r2 = await H.call('post', '/api/friends/unblock', asUser(U.A), { fid: AB.fid });   // 再打一次 ⇒ 404、零新刪除
  assert.strictEqual(r2.code, 404); assert.strictEqual(delOps(H.db).length, 1);
});
await T('B2 ⭐⭐ 冷卻內（blocked 列帶 rejectedAt 1 秒前）⇒ 還原成 rejected（列還在）；dm:AB 40 仍在；lobby／別段不少；零刪除呼叫', async () => {
  const H = await assertCooldownKeeps(SRC, 'B2');
  console.log('    冷卻內：friendships 列 status=' + H.db.snapshot('friendships').find((d) => d._id === AB._id).status + '；dm:A|B ' + ids(H.db, (r) => r === 'dm:' + AB.fid).length + '/' + N_AB + '；tournamentChat 刪除呼叫 ' + delOps(H.db).length);
});
await T('B3 ⭐ friendships.deleteOne 回 deletedCount:0 ⇒ 不刪對話、零 tournamentChat 刪除呼叫', async () => { await assertDeleteZeroKeeps(SRC, 'B3'); });
await T('B4 ⭐ _frPurgeDm 內 deleteMany 丟例外 ⇒ unblock 仍 200 removed:true、關係列已刪、log 含 purge dm failed (unblock', async () => { await assertPurgeThrowStill200(SRC); });
await T('B5 越權：被封鎖方 B 打 unblock ⇒ 靜默 200、列還在、零刪除；陌生人 C 拿 AB 的 fid ⇒ 404 零刪除；block（accepted→blocked）本身不刪', async () => {
  const { H, r } = await unblockAB(SRC, { who: U.B });
  assert.strictEqual(r.code, 200); assert.deepStrictEqual(r.body, { ok: true, friendsApi: 1 });
  assert.ok(H.db.snapshot('friendships').some((d) => d._id === AB._id && d.status === 'blocked'), '被封鎖方不得動到列');
  assert.strictEqual(ids(H.db, (x) => x === 'dm:' + AB.fid).length, N_AB, '⚠⚠ 被封鎖方竟能刪掉對話'); assert.strictEqual(delOps(H.db).length, 0); assertOthersIntact(H, 'B5-b');
  const { H: H2, r: r2 } = await unblockAB(SRC, { who: U.C });
  assert.strictEqual(r2.code, 404); assert.strictEqual(delOps(H2.db).length, 0); assert.strictEqual(ids(H2.db, (x) => x === 'dm:' + AB.fid).length, N_AB);
  const H3 = buildFriends(SRC, { seed: seedAll([AB, AC, BC]) });
  const b = await H3.call('post', '/api/friends/block', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(b.code, 200); assert.strictEqual(b.body.status, 'blocked');
  assert.strictEqual(ids(H3.db, (x) => x === 'dm:' + AB.fid).length, N_AB, '封鎖刪到對話了'); assert.strictEqual(delOps(H3.db).length, 0); assertOthersIntact(H3, 'B5-block');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】惡意突變（每個都必須紅在預期那條）');
const PURGE_CALL = "const r = await db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid });";
const REJ_RESTORE = "          await c.updateOne({ _id: cur._id, status: 'blocked', blockedBy: me.email }, { $set: { status: 'rejected', blockedBy: null, updatedAt: _now } });\n          return res.json({ ok: true, friendsApi: 1, removed: true });\n";
await T('C1 兩條分支都刪（冷卻內還原成 rejected 的分支也呼叫 purge）⇒ 紅在「冷卻內刪到對話」', async () => {
  const bad = mutate(SRC, REJ_RESTORE, REJ_RESTORE.replace('          return res.json', "          await _frPurgeDm(cur.fid || _frFid(cur._id), 'unblock');\n          return res.json"));
  await mutantMustBreak('兩條分支都刪', () => assertCooldownKeeps(bad, 'C1'), '冷卻內）刪到對話了');
});
await T('C2 purge 改成前綴 $regex \'^dm:\' ⇒ 紅在「別段對話被刪」', async () => {
  const bad = mutate(SRC, PURGE_CALL, "const r = await db.collection('tournamentChat').deleteMany({ room: { $regex: '^dm:' } });");
  await mutantMustBreak('前綴刪除', () => assertUnblockPurges(bad, 'C2'), '別段對話');
});
await T('C3 不看 deletedCount（無條件呼叫 purge）⇒ 紅在「deletedCount=0 仍刪對話」', async () => {
  const bad = mutate(SRC, UNBLOCK_PURGE_LINE, "        await _frPurgeDm(cur.fid || _frFid(cur._id), 'unblock');\n");
  await mutantMustBreak('不看 deletedCount', () => assertDeleteZeroKeeps(bad, 'C3'), 'deletedCount=0 仍刪對話');
});
await T('C4 _frPurgeDm 拿掉 try/catch（會 throw）⇒ 紅在「unblock 應 200」', async () => {
  const bad = mutate(SRC, "      try {\n        " + PURGE_CALL + "\n        return (r && typeof r.deletedCount === 'number') ? r.deletedCount : 0;\n      } catch (e) {\n        console.warn('[friends] purge dm failed (' + why + ', fid=' + fid + '): ' + (e && e.message));\n        return -1;\n      }\n",
    "      " + PURGE_CALL + "\n      return (r && typeof r.deletedCount === 'number') ? r.deletedCount : 0;\n");
  await mutantMustBreak('purge 會 throw', () => assertPurgeThrowStill200(bad), 'unblock 應 200');
});
await T('C5 purge 拿掉 filter（deleteMany({})）⇒ 紅在「lobby 被刪」', async () => {
  const bad = mutate(SRC, PURGE_CALL, "const r = await db.collection('tournamentChat').deleteMany({});");
  await mutantMustBreak('無過濾', () => assertUnblockPurges(bad, 'C5'), 'lobby 訊息被刪到了');
});
await T('C6 unblock 拿掉 purge 呼叫（＝退回 v6.288 語義）⇒ 紅在「dm:AB 沒被刪」', async () => {
  const bad = mutate(SRC, UNBLOCK_PURGE_LINE, '');
  await mutantMustBreak('不刪對話', () => assertUnblockPurges(bad, 'C6'), 'dm:AB 沒被刪');
});
await T('C7 purge 的 why 寫錯（\'remove\'）⇒ 紅在「why=unblock」（log 可追溯是哪條路徑刪的）', async () => {
  const bad = mutate(SRC, UNBLOCK_PURGE_LINE, UNBLOCK_PURGE_LINE.replace("'unblock'", "'remove'"));
  await mutantMustBreak('why 寫錯', () => assertPurgeThrowStill200(bad), 'why=unblock');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】靜態枚舉（補行為端測不到的形狀）');
await T('D1 unblock handler：deleteOne 緊接 purge 行、purge 只在 deletedCount>0 之後；冷卻內還原分支零 purge；_frPurgeDm 出現 3 次；block／reject／accept 零 purge；兩區塊批次刪除恰一處', () => {
  const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const handler = (anchor) => { const i = FR.indexOf(anchor); assert.ok(i > 0, anchor); const j = FR.indexOf('\n    });', i); return FR.slice(i, j); };
  const ub = handler("app.post('/api/friends/unblock'");
  assert.ok(ub.includes(UNBLOCK_DEL_LINE), 'unblock 的 deleteOne 必須把結果接住（const del = …）');
  assert.ok(ub.includes(UNBLOCK_PURGE_LINE), 'unblock 的 purge 必須只接在 deletedCount>0 之後');
  assert.ok(ub.indexOf(UNBLOCK_DEL_LINE) < ub.indexOf(UNBLOCK_PURGE_LINE), 'purge 必須在 deleteOne 之後');
  const rejI = ub.indexOf("if (typeof cur.rejectedAt === 'number' && _now - cur.rejectedAt < FR_REJECT_COOLDOWN_MS) {");
  assert.ok(rejI > 0, '找不到冷卻內分支');
  const rejBody = ub.slice(rejI, ub.indexOf('\n        }\n', rejI));
  assert.ok(rejBody.includes("status: 'rejected'") && rejBody.includes('return res.json'), '冷卻內分支形狀變了：' + rejBody.slice(0, 200));
  assert.ok(!rejBody.includes('_frPurgeDm'), '⚠⚠ 冷卻內還原成 rejected 的分支不得刪對話');
  assert.strictEqual([...ub.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').matchAll(/_frPurgeDm\(/g)].length, 1, 'unblock handler 內 purge 呼叫恰 1 次');
  const calls = [...stripped.matchAll(/_frPurgeDm\(/g)].length;
  assert.strictEqual(calls, 3, '_frPurgeDm 出現次數（定義 1＋remove 1＋unblock 1）：' + calls);
  for (const p of ["app.post('/api/friends/block'", "app.post('/api/friends/reject'", "app.post('/api/friends/accept'", "app.post('/api/friends/request'"]) assert.ok(!handler(p).includes('_frPurgeDm'), p + ' 不得刪對話');
  const dels = [...stripped.matchAll(/\.(deleteMany|updateMany|drop|remove)\(([^)]*)\)/g)];
  assert.strictEqual(dels.length, 1, '兩區塊內的批次刪除呼叫數：' + dels.length + ' ⇒ ' + dels.map((m) => m[0]).join(' | '));
  assert.strictEqual(dels[0][2].trim(), "{ room: 'dm:' + fid }", 'filter 字面不對：' + dels[0][0]);
  const purge = FR.slice(FR.indexOf('async function _frPurgeDm('), FR.indexOf('async function _frFindMine('));
  assert.ok(!/\$regex|startsWith|RegExp/.test(purge), 'purge 不得用前綴／正則');
  assert.ok(PATCH.includes("console.log('[friends] endpoints registered (v1.40)"), 'FRIENDS 區塊版號 log 沒 bump 到 v1.40');
});
await T('D1m 掃描器自驗：把 purge 塞進冷卻內分支 ⇒ D1 紅在「冷卻內…不得刪對話」', async () => {
  const bad = mutate(FR, REJ_RESTORE, REJ_RESTORE.replace('          return res.json', "          await _frPurgeDm(cur.fid || _frFid(cur._id), 'unblock');\n          return res.json"));
  const i = bad.indexOf("app.post('/api/friends/unblock'"); const ub = bad.slice(i, bad.indexOf('\n    });', i));
  const rejI = ub.indexOf("if (typeof cur.rejectedAt === 'number' && _now - cur.rejectedAt < FR_REJECT_COOLDOWN_MS) {");
  const rejBody = ub.slice(rejI, ub.indexOf('\n        }\n', rejI));
  assert.ok(rejBody.includes('_frPurgeDm'), '掃描器抓不到塞進冷卻內分支的 purge ⇒ D1 的那條斷言是安慰劑');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】client：/friends 頁解除封鎖二次確認文案');
await T('E1 解除封鎖二次確認文案逐字（含「對話」「無法復原」）；解除好友文案不變；兩段文案都只在 confirm span 內', () => {
  assert.ok(PAGE.includes(UNBLOCK_CONFIRM), '解除封鎖的二次確認文案不對（v6.289 要明講對話也會刪）');
  assert.ok(PAGE.includes(REMOVE_CONFIRM), '解除好友的二次確認文案被動到了');
  const ub = PAGE.slice(PAGE.indexOf("confirmKind === 'unblock'}"), PAGE.indexOf('{/if}', PAGE.indexOf("confirmKind === 'unblock'}")));
  assert.ok(ub.includes('對話') && ub.includes('無法復原'), 'unblock 確認區塊沒提對話／無法復原');
  assert.ok(ub.includes('確定解除封鎖'), '確認鈕不見了');
  assert.ok(!/[{}<>]/.test(UNBLOCK_CONFIRM.replace(/<\/?span[^>]*>/g, '')), '文案含 Svelte 模板特殊字元');
});
await T('E1m 正對照：文案拿掉「對話」那一句 ⇒ E1 紅', async () => {
  const bad = mutate(PAGE, UNBLOCK_CONFIRM, '<span class="confirm">解除封鎖後關係會歸零，要重新邀請才會成為好友。</span>');
  await mutantMustBreak('文案沒提對話', () => { assert.ok(bad.includes(UNBLOCK_CONFIRM), '解除封鎖的二次確認文案不對（v6.289 要明講對話也會刪）'); }, '解除封鎖的二次確認文案不對');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】test chain／版本');
await T('F1 本守衛在 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不 pin 版本）', () => {
  const pk = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pk.scripts.test.includes('node scripts/test-v6289-unblock-purge.mjs'), '沒進 test chain');
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'))[1];
  assert.strictEqual(H, V, 'admin.html SITE_VERSION_HINT=' + H + ' 與 version.ts=' + V + ' 不同步');
});

console.log('\n══ v6.289 解除封鎖刪私聊守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
if (fail) process.exit(1);
