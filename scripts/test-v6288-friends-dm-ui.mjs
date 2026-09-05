// v6.288 守衛：好友私聊【P1：玩家看得到的面板】＋ 解除好友連對話一起刪
//   （HEAD-FAIL：BASE v6.287 沒有 dm-poller.ts／dm-session.ts／DmPanel.svelte、FRIENDS 區塊沒有 _frPurgeDm ⇒ A0 必紅並提前結束）
//
// 守什麼（全部以行為端為主；靜態只用在行為端測不到的地方）：
//   【A】HEAD-FAIL 錨點＋錦標賽區塊兩把 sha256（與 test-v6272 ⑨／test-v6278 I1／test-v6287 A1 同一把）。
//   【B】⭐⭐ 伺服器（FRIENDS＋DM 區塊抽出來實跑）：remove 成功 ⇒ 只刪 room==='dm:'+fid；**lobby 一筆都沒少（逐 id 比對）**、
//        別段對話一筆都沒少；正對照＝把過濾拿掉要紅、改成前綴 $regex 也要紅、不刪也要紅。block **不刪**；unblock 也不刪（授權只有 remove）。
//        刪對話失敗（假 db 丟例外）⇒ remove 仍 200 且關係列已刪（正對照：拿掉 try/catch ⇒ 500 ⇒ 紅）。越權／被封鎖方／pending 各自零誤刪。
//        靜態：兩區塊內對 tournamentChat 的批次刪除恰一處、filter 字面就是 `{ room: 'dm:' + fid }`；purge 只接在 deletedCount>0 之後。
//   【C】friends-api.ts（esbuild 實跑）：dm list 204 ⇒ ok+noNew、可用性仍 on（**不可判成不支援**）；503 friends-dm-disabled ⇒ dm-disabled 且
//        好友可用性仍 on、入口仍顯示；dm 端點 404 ⇒ 只記私聊自己的負向、**不碰**好友負向快取（localStorage 零寫入）；sendDm 的 URL／body／429／403；正對照。
//   【D】⭐⭐ dm-session＋dm-poller（假 fetch＋假 timer 逐 tick 實跑）：開面板恰一發；3 秒一發 since=最後一則 ts；hidden ⇒ 15 秒；
//        **關掉 ⇒ 200 個 tick 零請求**（含在途回應遲到也不再排、切換好友舊 poller 不復活）；send ⇒ POST＋立刻一發 since（去重）；
//        429 只掛一行、輪詢照常；403 ⇒ 停輪詢；首發 503/404/401 ⇒ 不輪詢；沒 token 零請求；loadMore 用 before；
//        正對照＝stop 不清 timer／close 不 stop／hidden 同 3 秒／since 恆 0／204 當不支援 各自紅在預期那條。
//   【E】靜態：DmPanel＋/friends 頁零 {@html}、each 穩定 key、DmPanel **零 @media**、手機開關是 JS `Math.min(innerWidth, innerHeight) <= 600`
//        （門檻從 game/+page.svelte 的 isPortraitMobile 出貨碼抽出來比對）、二次確認文案明講「對話也會一起刪除」、
//        onMount 清理呼叫 closeDm、DmPanel 只在 {#if dmState} 內；svelte 編譯零錯誤；DmPanel／頁面零 setTimeout。
//   【F】框架安全：game/+page.svelte 與 MobilePortraitBattle.svelte 零 DmPanel／dm-session／dm-poller／friendsDm 引用（history-free 不變量；
//        逐位元未動由 test-v6272 ⑩ 的 PREV_ALLOWED 清單守）。
//   【G】test chain／版本一致（不 pin 版本號）。
//
// ⚠ 紀律：只捕 AssertionError；突變體必須紅在**預期那一條**；不 pin 版本號／sha 當唯一判準；資料量拉到足以觸發被測分支。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { stripCommentsChecked } from './lib/strip-comments.mjs';   // ⭐v6.311 行級剝註解（含護欄）
import { sectionInner } from './lib/strip-markup-sections.mjs';     // ⭐v6.317 先剝 HTML 註解再抽 script（開頭標籤限行首）
import {
  readPatch, extractBlock, FR_START, FR_END,
  buildFriends, makeFakeDb, asUser,
} from './lib/friends-harness-v6282.mjs';

const esbuild = await import('esbuild');
const { compile: svelteCompile } = await import('svelte/compiler');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_POLL = join(ROOT, 'src/lib/friends/dm-poller.ts');
const P_SESS = join(ROOT, 'src/lib/friends/dm-session.ts');
const P_PANEL = join(ROOT, 'src/routes/friends/DmPanel.svelte');
// ⭐⭐ v6.296：好友名單本體搬到共用元件（/friends 頁與線上大廳分頁共用同一份）。
//   底下原本掃 `/friends` 頁的名單相關斷言改掃這一份；私聊面板本身（DmPanel）仍只掛在 /friends 頁。
const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const P_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_MPB = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const DM_START = '// >>> PTCG-FRIENDS-DM-BLOCK-START';
const DM_END = '// <<< PTCG-FRIENDS-DM-BLOCK-END';

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
};
const mutate = (src, a, b) => { const n = src.split(a).length - 1; assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 80)); return src.replace(a, b, 1); };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點 ＋ 錦標賽區塊 sha256');
let PATCH = '', FR = '', DM = '', SRC = '', API = '', POLL = '', SESS = '', PANEL = '', PAGE = '', GAME = '', MPB = '', FRP = '';
await T('A0 HEAD-FAIL：dm-poller.ts／dm-session.ts／DmPanel.svelte 存在；FRIENDS 區塊有 _frPurgeDm（BASE v6.287 都沒有 ⇒ 這一條必紅）', () => {
  for (const p of [P_POLL, P_SESS, P_PANEL]) assert.ok(existsSync(p), '缺 ' + p);
  PATCH = readPatch(P_SRV);
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  DM = extractBlock(PATCH, DM_START, DM_END, 8000);
  SRC = FR + '\n' + DM;
  assert.ok(FR.includes('async function _frPurgeDm('), 'FRIENDS 區塊沒有 _frPurgeDm');
  API = readFileSync(P_API, 'utf8'); POLL = readFileSync(P_POLL, 'utf8'); SESS = readFileSync(P_SESS, 'utf8');
  PANEL = readFileSync(P_PANEL, 'utf8'); PAGE = readFileSync(P_PAGE, 'utf8'); GAME = readFileSync(P_GAME, 'utf8'); MPB = readFileSync(P_MPB, 'utf8');
  assert.ok(existsSync(P_FRP), '缺 ' + P_FRP);
  FRP = readFileSync(P_FRP, 'utf8');
  assert.ok(API.includes('export async function fetchDmMessages(') && API.includes('export async function sendDm('), 'friends-api.ts 沒有 dm 函式');
  assert.ok(PAGE.includes('DmPanel'), '/friends 頁沒接 DmPanel');
});
if (fail) { console.log('\n══ v6.288 守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新檔／新區塊不存在，後續無法進行）══'); process.exit(1); }
const TOURN_TAIL_SHA256 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';   // 與 test-v6272 ⑨ 同一把
const TOURN_ANCHOR_SHA256 = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40'; // 與 test-v6278 I1 同一把
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256）；FRIENDS／DM 區塊都在第一支 /api/tournament 之前', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");
  assert.ok(first > 0);
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(FR_END) < PATCH.indexOf(DM_START) && PATCH.indexOf(DM_END) < first, '區塊位置不對');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】伺服器：remove 刪 dm:<fid>；lobby 與別段對話一筆不少；block 不刪；unblock 真刪分支刪（v6.289 裁定）、冷卻內不刪');
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
const seedAll = (rows) => ({ tournamentConfig: [{ _id: 'friendsConfig', enabled: true, dm: true }], friendships: (rows || [AB, AC, BC]).map((r) => structuredClone(r)), tournamentChat: chatSeed() });
const ids = (db, pred) => db.snapshot('tournamentChat').filter((d) => pred(d.room)).map((d) => d._id).sort();
const lobbyIds0 = ids(makeFakeDb(seedAll()), (r) => r === 'lobby');
const delOps = (db) => db._log.filter((l) => l.name === 'tournamentChat' && /^(deleteMany|deleteOne)$/.test(l.op));
async function removeAB(src, who, fid, seed) {
  const H = buildFriends(src, { seed: seed || seedAll() });
  const r = await H.call('post', '/api/friends/remove', asUser(who || U.A), { fid: fid || AB.fid });
  return { H, r };
}
function assertOthersIntact(H, why) {
  assert.deepStrictEqual(ids(H.db, (r) => r === 'lobby'), lobbyIds0, '⚠⚠ lobby 訊息被刪到了（' + why + '）');
  assert.strictEqual(ids(H.db, (r) => r === 'dm:' + AC.fid).length, N_AC, '⚠⚠ 別段對話（A|C）被刪到了（' + why + '）');
  assert.strictEqual(ids(H.db, (r) => r === 'dm:' + BC.fid).length, N_BC, '⚠⚠ 別段對話（B|C）被刪到了（' + why + '）');
}
await T('B1 ⭐⭐ A 解除 AB ⇒ 200；friendships 只少那一列；dm:AB 40 → 0；lobby 300 筆逐 id 相同；A|C／B|C 對話一筆不少；只有一次 deleteMany 且 filter 等值 room', async () => {
  assert.strictEqual(lobbyIds0.length, N_LOBBY, '種子壞了');
  const { H, r } = await removeAB(SRC);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.removed, true);
  assert.deepStrictEqual(H.db.snapshot('friendships').map((d) => d._id).sort(), [AC._id, BC._id].sort(), 'friendships 刪錯列');
  assert.strictEqual(ids(H.db, (r) => r === 'dm:' + AB.fid).length, 0, 'dm:AB 沒被刪');
  assertOthersIntact(H, 'B1');
  const dm = delOps(H.db);
  assert.strictEqual(dm.length, 1, 'tournamentChat 的刪除呼叫數：' + dm.length);
  assert.strictEqual(dm[0].op, 'deleteMany');
  assert.deepStrictEqual(dm[0].f, { room: 'dm:' + AB.fid }, 'filter 必須是等值 room：' + JSON.stringify(dm[0].f));
  const r2 = await H.call('post', '/api/friends/remove', asUser(U.B), { fid: AB.fid });
  assert.strictEqual(r2.code, 404); assert.strictEqual(delOps(H.db).length, 1);
});
await T('B1m 正對照：filter 拿掉（deleteMany({})）⇒ 紅在「lobby 被刪」；改成前綴 $regex ⇒ 紅在「別段對話被刪」；拿掉 purge 呼叫 ⇒ 紅在「dm:AB 沒被刪」', async () => {
  const bad1 = mutate(SRC, "const r = await db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid });", "const r = await db.collection('tournamentChat').deleteMany({});");
  await mutantMustBreak('無過濾', async () => { const { H } = await removeAB(bad1); assertOthersIntact(H, 'm1'); }, 'lobby 訊息被刪到了');
  const bad2 = mutate(SRC, "const r = await db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid });", "const r = await db.collection('tournamentChat').deleteMany({ room: { $regex: '^dm:' } });");
  await mutantMustBreak('前綴刪除', async () => { const { H } = await removeAB(bad2); assertOthersIntact(H, 'm2'); }, '別段對話');
  const bad3 = mutate(SRC, "        if (del && del.deletedCount > 0) await _frPurgeDm(cur.fid || _frFid(cur._id), 'remove');\n", '');
  await mutantMustBreak('不刪對話', async () => { const { H } = await removeAB(bad3); assert.strictEqual(ids(H.db, (r) => r === 'dm:' + AB.fid).length, 0, 'dm:AB 沒被刪'); }, 'dm:AB 沒被刪');
});
await T('B2 ⭐ block 不刪：A 封鎖 B ⇒ dm:AB 40 仍在、lobby 不少、零刪除呼叫；被封鎖方 B 打 remove ⇒ 靜默 200 零刪除；封鎖方打 remove ⇒ 409 零刪除', async () => {
  const H = buildFriends(SRC, { seed: seedAll() });
  const b = await H.call('post', '/api/friends/block', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(b.code, 200, JSON.stringify(b.body)); assert.strictEqual(b.body.status, 'blocked');
  assert.strictEqual(ids(H.db, (r) => r === 'dm:' + AB.fid).length, N_AB, '⚠ 封鎖刪到對話了');
  assertOthersIntact(H, 'B2'); assert.strictEqual(delOps(H.db).length, 0, '封鎖不得有任何 tournamentChat 刪除呼叫');
  const rm = await H.call('post', '/api/friends/remove', asUser(U.B), { fid: AB.fid });
  assert.strictEqual(rm.code, 200); assert.deepStrictEqual(rm.body, { ok: true, friendsApi: 1 });
  assert.strictEqual(ids(H.db, (r) => r === 'dm:' + AB.fid).length, N_AB, '⚠⚠ 被封鎖方竟能刪掉對話'); assert.strictEqual(delOps(H.db).length, 0);
  const rm2 = await H.call('post', '/api/friends/remove', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(rm2.code, 409); assert.strictEqual(rm2.body.code, 'friends-use-unblock'); assert.strictEqual(delOps(H.db).length, 0);
});
await T('B2b unblock（v6.289 站長裁定改：冷卻外＝真刪那一列 ⇒ **一併刪對話**；冷卻內＝還原成 rejected ⇒ **不刪**）—— 細部斷言與突變在 test-v6289', async () => {
  const H = buildFriends(SRC, { seed: seedAll([mkRow(U.A.email, U.B.email, 'blocked', { blockedBy: U.A.email }), AC, BC]) });
  const u = await H.call('post', '/api/friends/unblock', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(u.code, 200, JSON.stringify(u.body)); assert.strictEqual(u.body.removed, true);
  assert.ok(!H.db.snapshot('friendships').some((d) => d._id === AB._id), 'unblock（冷卻外）應真刪那一列 —— 出貨碼語義變了？請同步更新 changelog-internal 的裁定說明');
  assert.strictEqual(ids(H.db, (r) => r === 'dm:' + AB.fid).length, 0, 'unblock（冷卻外）沒刪對話（v6.289 裁定：真刪分支要刪）');
  assertOthersIntact(H, 'B2b'); assert.strictEqual(delOps(H.db).length, 1);
  const H2 = buildFriends(SRC, { seed: seedAll([mkRow(U.A.email, U.B.email, 'blocked', { blockedBy: U.A.email, rejectedAt: Date.now() - 1000 }), AC, BC]) });
  const u2 = await H2.call('post', '/api/friends/unblock', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(u2.code, 200);
  const row = H2.db.snapshot('friendships').find((d) => d._id === AB._id);
  assert.ok(row && row.status === 'rejected', 'unblock（冷卻內）應還原成 rejected');
  assert.strictEqual(ids(H2.db, (r) => r === 'dm:' + AB.fid).length, N_AB, 'unblock（冷卻內）刪到對話了（列還在，不可刪）'); assert.strictEqual(delOps(H2.db).length, 0);
});
await T('B3 ⭐ 刪對話失敗（假 db 對 tournamentChat.deleteMany 丟例外）⇒ remove 仍 200 removed:true、friendships 那一列已刪、只 log 不炸', async () => {
  const db = makeFakeDb(seedAll(), { throwOn: (name, op) => name === 'tournamentChat' && op === 'deleteMany' });
  const H = buildFriends(SRC, { db });
  const r = await H.call('post', '/api/friends/remove', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.removed, true);
  assert.ok(!H.db.snapshot('friendships').some((d) => d._id === AB._id), '關係列應已刪');
  assert.ok(H.logs.some((l) => l.includes('purge dm failed')), '刪對話失敗要 log：' + JSON.stringify(H.logs));
  assertOthersIntact(H, 'B3');
});
await T('B3m 正對照：把 _frPurgeDm 的 try/catch 拿掉 ⇒ remove 變 500 ⇒ B3 紅', async () => {
  const bad = mutate(SRC, "      try {\n        const r = await db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid });\n        return (r && typeof r.deletedCount === 'number') ? r.deletedCount : 0;\n      } catch (e) {\n        console.warn('[friends] purge dm failed (' + why + ', fid=' + fid + '): ' + (e && e.message));\n        return -1;\n      }\n",
    "      const r = await db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid });\n      return (r && typeof r.deletedCount === 'number') ? r.deletedCount : 0;\n");
  await mutantMustBreak('purge 會 throw', async () => {
    const db = makeFakeDb(seedAll(), { throwOn: (name, op) => name === 'tournamentChat' && op === 'deleteMany' });
    const H = buildFriends(bad, { db });
    const r = await H.call('post', '/api/friends/remove', asUser(U.A), { fid: AB.fid });
    assert.strictEqual(r.code, 200, 'remove 應 200');
  }, 'remove 應 200');
});
await T('B4 越權與其他狀態：C 拿 AB 的 fid ⇒ 404 零刪除；pending 的取消邀請 ⇒ 200（deleteMany 0 筆）且別段不少；rejected 冷卻內 ⇒ 409 零刪除', async () => {
  const H = buildFriends(SRC, { seed: seedAll() });
  const r = await H.call('post', '/api/friends/remove', asUser(U.C), { fid: AB.fid });
  assert.strictEqual(r.code, 404); assert.strictEqual(delOps(H.db).length, 0); assert.strictEqual(ids(H.db, (x) => x === 'dm:' + AB.fid).length, N_AB);
  const pend = mkRow(U.A.email, U.B.email, 'pending', { requester: U.A.email });
  const H2 = buildFriends(SRC, { seed: seedAll([pend, AC, BC]) });
  for (const d of H2.db.snapshot('tournamentChat')) if (d.room === 'dm:' + AB.fid) H2.db._store.get('tournamentChat').delete(d._id);
  const r2 = await H2.call('post', '/api/friends/remove', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(r2.code, 200, JSON.stringify(r2.body)); assertOthersIntact(H2, 'B4-pending');
  const rej = mkRow(U.A.email, U.B.email, 'rejected', { requester: U.A.email, rejectedAt: Date.now() - 1000 });
  const H3 = buildFriends(SRC, { seed: seedAll([rej, AC, BC]) });
  const r3 = await H3.call('post', '/api/friends/remove', asUser(U.A), { fid: AB.fid });
  assert.strictEqual(r3.code, 409); assert.strictEqual(delOps(H3.db).length, 0);
});
await T('B5 靜態枚舉：兩區塊內對 tournamentChat 的批次刪除恰一處、字面 `{ room: \'dm:\' + fid }`；fid 先驗格式；purge 只接在 deletedCount>0 之後（remove＋unblock 各一）；block／reject／accept 零 purge；字面與 DM 區塊常數一致', () => {
  const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const dels = [...stripped.matchAll(/\.(deleteMany|updateMany|drop|remove)\(([^)]*)\)/g)];
  assert.strictEqual(dels.length, 1, '兩區塊內的批次刪除呼叫數：' + dels.length + ' ⇒ ' + dels.map((m) => m[0]).join(' | '));
  assert.strictEqual(dels[0][2].trim(), "{ room: 'dm:' + fid }", 'filter 字面不對：' + dels[0][0]);
  const purge = FR.slice(FR.indexOf('async function _frPurgeDm('), FR.indexOf('async function _frFindMine('));
  assert.ok(/if \(typeof fid !== 'string' \|\| !\/\^\[0-9a-f\]\{8,32\}\$\/\.test\(fid\)\) return 0;/.test(purge), 'purge 沒先驗 fid 格式');
  assert.ok(purge.includes("db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid })"), 'purge 的刪除呼叫形狀');
  assert.ok(!/\$regex|startsWith|RegExp/.test(purge), 'purge 不得用前綴／正則');
  assert.ok(FR.includes("        if (del && del.deletedCount > 0) await _frPurgeDm(cur.fid || _frFid(cur._id), 'remove');"), 'purge 必須只接在 deletedCount>0 之後');
  assert.ok(FR.includes("        if (del && del.deletedCount > 0) await _frPurgeDm(cur.fid || _frFid(cur._id), 'unblock');"), 'unblock 的 purge 必須只接在 deletedCount>0 之後（v6.289）');
  const calls = [...stripped.matchAll(/_frPurgeDm\(/g)].length;
  assert.strictEqual(calls, 3, '_frPurgeDm 出現次數（定義 1＋remove 呼叫 1＋unblock 呼叫 1）：' + calls);
  const handler = (anchor) => { const i = FR.indexOf(anchor); assert.ok(i > 0, anchor); const j = FR.indexOf('\n    });', i); return FR.slice(i, j); };
  for (const p of ["app.post('/api/friends/block'", "app.post('/api/friends/reject'", "app.post('/api/friends/accept'"]) assert.ok(!handler(p).includes('_frPurgeDm'), p + ' 不得刪對話');
  assert.ok(handler("app.post('/api/friends/remove'").includes('_frPurgeDm'), 'remove handler 沒接 purge');
  assert.ok(handler("app.post('/api/friends/unblock'").includes('_frPurgeDm'), 'unblock handler 沒接 purge（v6.289 裁定）');
  assert.ok(DM.includes("const FR_DM_COLL = 'tournamentChat';") && DM.includes("const FR_DM_ROOM_PREFIX = 'dm:';"), 'DM 區塊常數變了 ⇒ purge 的字面要跟著改');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】friends-api.ts：204／503 friends-dm-disabled／404 三態（實跑）');
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
function makeLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m }; }
/** 把 friends-api／dm-poller／dm-session 三支 .ts 轉 CJS 後串起來載入（可覆寫任一支原始碼做突變）。 */
function loadMods(fetchImpl, over = {}, { apiUrl = 'http://t.local', ls = makeLS() } = {}) {
  const src = { 'friends-api': over['friends-api'] || API, 'dm-poller': over['dm-poller'] || POLL, 'dm-session': over['dm-session'] || SESS };
  assert.ok(src['friends-api'].includes(API_MARKER), 'friends-api.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  src['friends-api'] = src['friends-api'].replace(API_MARKER, JSON.stringify(apiUrl));
  const mods = {};
  const req = (name) => { const k = name.replace(/^\.\//, ''); if (!mods[k]) throw new Error('dm 模組 import 了未知模組：' + name); return mods[k]; };
  for (const k of ['friends-api', 'dm-poller', 'dm-session']) {
    const js = esbuild.transformSync(src[k], { loader: 'ts', format: 'cjs' }).code;
    const m = { exports: {} };
    new Function('module', 'exports', 'require', 'fetch', 'localStorage', js)(m, m.exports, req, fetchImpl, ls);
    mods[k] = m.exports;
  }
  return mods;
}
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) }, json: async () => body });
const htmlRes = (status) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, json: async () => { throw new SyntaxError('Unexpected token <'); } });
const noBody = (status) => ({ status, ok: status < 400, headers: { get: () => null }, json: async () => { throw new Error('no body'); } });
const mkFetch = (fn) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return fn(calls.length, url, init); }; f.calls = calls; return f; };
const FID = 'abcdef1234567890abcdef12';
const CTX = { uid: 'FU', token: 'TOK' };
await T('C1 ⭐⭐ dm list since>0 回 204 零 body ⇒ ok+noNew；好友可用性＝on（**不可判成不支援**）、入口仍顯示；私聊可用性＝on', async () => {
  const f = mkFetch(() => noBody(204));
  const mod = loadMods(f)['friends-api'];
  const r = await mod.fetchDmMessages(CTX, FID, { since: 123 });
  assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(r.data.noNew, true); assert.deepStrictEqual(r.data.messages, []);
  assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/dm/list?fid=' + FID + '&since=123', f.calls[0].url);
  assert.strictEqual(mod.friendsAvailability('FU'), 'on', '204 之後好友可用性應為 on（不是 unsupported）');
  assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '204 之後入口不可藏');
  assert.strictEqual(mod.friendsDmAvailability(), 'on');
});
await T('C1m 正對照：把 204 分支拿掉 ⇒ 204 走到「2xx 非 JSON ⇒ 不支援」⇒ C1 紅', async () => {
  const bad = mutate(API, "  if (opts.dm && status === 204) {", "  if (false && opts.dm && status === 204) {");
  await mutantMustBreak('無 204 分支', async () => {
    const mod = loadMods(mkFetch(() => noBody(204)), { 'friends-api': bad })['friends-api'];
    const r = await mod.fetchDmMessages(CTX, FID, { since: 123 });
    assert.strictEqual(r.ok, true, '204 應為 ok');
  }, '204 應為 ok');
});
await T('C2 503 friends-dm-disabled ⇒ kind dm-disabled；好友可用性仍 on、入口仍顯示；私聊可用性＝disabled（TTL 內）；sendDm 同樣 dm-disabled', async () => {
  const f = mkFetch(() => jsonRes(503, { error: '好友私聊尚未開放', code: 'friends-dm-disabled' }));
  const mod = loadMods(f)['friends-api'];
  const r = await mod.fetchDmMessages(CTX, FID);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.kind, 'dm-disabled', JSON.stringify(r)); assert.strictEqual(r.code, 'friends-dm-disabled');
  assert.strictEqual(mod.friendsAvailability('FU'), 'on', '私聊沒開不可以把好友功能判成 disabled');
  assert.strictEqual(mod.friendsEntryVisible('FU', false), true);
  assert.strictEqual(mod.friendsDmAvailability(), 'disabled');
  assert.strictEqual(mod.friendsDmAvailability(Date.now() + mod.FRIENDS_DM_NEG_CACHE_TTL_MS + 1), 'unknown', '負向要有 TTL');
  const r2 = await mod.sendDm(CTX, FID, 'x');
  assert.strictEqual(r2.kind, 'dm-disabled');
});
await T('C3 ⭐ dm 端點 404 HTML（伺服器有好友、沒私聊）⇒ kind unsupported，但**好友的負向快取一個位元都不寫**（之前 on ⇒ 仍 on；之前 unknown ⇒ 仍 unknown，localStorage 零寫入）', async () => {
  const ls = makeLS();
  const f = mkFetch((n) => (n === 1 ? jsonRes(200, { friendsApi: 1, me: { uid: 'FU', nick: '我' }, friends: [], incoming: [], outgoing: [], blocked: [], limit: 100, truncated: false }) : htmlRes(404)));
  const mod = loadMods(f, {}, { ls })['friends-api'];
  assert.strictEqual((await mod.fetchFriendsList(CTX)).ok, true);
  const r = await mod.fetchDmMessages(CTX, FID);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.kind, 'unsupported');
  assert.strictEqual(mod.friendsAvailability('FU'), 'on', 'dm 404 把好友功能判成不支援了');
  assert.strictEqual(mod.friendsEntryVisible('FU', false), true, 'dm 404 把大廳入口藏起來了');
  assert.ok(String(ls.getItem('ptcg_friends_avail:FU')).includes('"on"'), 'localStorage 的好友快取被改寫：' + ls.getItem('ptcg_friends_avail:FU'));
  assert.strictEqual(mod.friendsDmAvailability(), 'unsupported');
  const ls2 = makeLS();
  const mod2 = loadMods(mkFetch(() => htmlRes(404)), {}, { ls: ls2 })['friends-api'];
  await mod2.fetchDmMessages(CTX, FID);
  assert.strictEqual(mod2.friendsAvailability('FU'), 'unknown', '之前 unknown 的不可因 dm 404 變 unsupported');
  assert.strictEqual(ls2._m.size, 0, 'dm 404 不可寫任何 localStorage：' + JSON.stringify([...ls2._m]));
});
await T('C3m 正對照：dm 404 改走一般路徑（remember unsupported）⇒ C3 紅在「判成不支援」', async () => {
  const bad = mutate(API, "  if (opts.dm) {\n    // ⚠⚠ dm 端點 404", "  if (false && opts.dm) {\n    // ⚠⚠ dm 端點 404");
  await mutantMustBreak('dm 404 寫好友負向', async () => {
    const mod = loadMods(mkFetch(() => htmlRes(404)), { 'friends-api': bad })['friends-api'];
    await mod.fetchDmMessages(CTX, FID);
    assert.strictEqual(mod.friendsAvailability('FU'), 'unknown', 'dm 404 把好友功能判成不支援了');
  }, '判成不支援');
});
await T('C4 sendDm：POST /api/friends/dm/send、body 恰 {fid,text}、空白折單空白＋截 200；空字串零請求；429 ⇒ busy＋伺服器文案；403 friends-dm-not-friends ⇒ rejected 且 code 保留；fid 格式不對零請求', async () => {
  const f = mkFetch((n) => {
    if (n === 1) return jsonRes(200, { ok: true, friendsDm: 1, id: 'm9', ts: 777 });
    if (n === 2) return jsonRes(429, { error: '發言太快，請稍候', code: 'friends-dm-rate-gap', friendsDm: 1 });
    return jsonRes(403, { error: '只能和目前的好友私聊', code: 'friends-dm-not-friends', friendsDm: 1 });
  });
  const mod = loadMods(f)['friends-api'];
  const r = await mod.sendDm(CTX, FID, '  哈囉\n\n  ' + '字'.repeat(250));
  assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.deepStrictEqual(r.data, { id: 'm9', ts: 777 });
  assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/dm/send'); assert.strictEqual(f.calls[0].init.method, 'POST');
  const body = JSON.parse(f.calls[0].init.body);
  assert.deepStrictEqual(Object.keys(body).sort(), ['fid', 'text']); assert.strictEqual(body.fid, FID);
  assert.ok(body.text.startsWith('哈囉 字') && body.text.length === 200, 'text 正規化：' + body.text.length);
  assert.strictEqual(f.calls[0].init.headers.Authorization, 'Bearer TOK');
  const e = await mod.sendDm(CTX, FID, '   ');
  assert.strictEqual(e.ok, false); assert.strictEqual(f.calls.length, 1, '空白不可發請求');
  const b = await mod.sendDm(CTX, FID, 'x');
  assert.strictEqual(b.kind, 'busy'); assert.strictEqual(b.message, '發言太快，請稍候');
  const n = await mod.sendDm(CTX, FID, 'y');
  assert.strictEqual(n.kind, 'rejected'); assert.strictEqual(n.code, 'friends-dm-not-friends');
  assert.strictEqual((await mod.sendDm(CTX, 'ZZ', 'y')).ok, false); assert.strictEqual(f.calls.length, 3, 'fid 格式不對不可發請求');
  assert.strictEqual(mod.friendsAvailability('FU'), 'on');
});
await T('C5 fetchDmMessages 的 URL：since=0 ⇒ 不帶 since；before ⇒ &before=；since 優先於 before；訊息正規化（白名單四欄）', async () => {
  const f = mkFetch(() => jsonRes(200, { friendsDm: 1, fid: FID, messages: [{ id: 'a', mine: true, text: 'x', ts: 5, extra: 1 }, { id: 'b', mine: 'no', text: 7, ts: '8' }], hasMore: true, serverNow: 99 }));
  const mod = loadMods(f)['friends-api'];
  const r = await mod.fetchDmMessages(CTX, FID);
  assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/dm/list?fid=' + FID);
  assert.deepStrictEqual(r.data.messages, [{ id: 'a', mine: true, text: 'x', ts: 5 }, { id: 'b', mine: false, text: '', ts: 0 }]);
  assert.strictEqual(r.data.hasMore, true); assert.strictEqual(r.data.noNew, false);
  await mod.fetchDmMessages(CTX, FID, { before: 55 });
  assert.strictEqual(f.calls[1].url, 'http://t.local/api/friends/dm/list?fid=' + FID + '&before=55');
  await mod.fetchDmMessages(CTX, FID, { since: 9, before: 55 });
  assert.strictEqual(f.calls[2].url, 'http://t.local/api/friends/dm/list?fid=' + FID + '&since=9');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】dm-session＋dm-poller：假 timer 逐 tick 實跑（開 3 秒／hidden 15 秒／關掉零請求）');
function makeTimers() {
  let id = 0; const pend = new Map();
  return {
    set: (fn, ms) => { const h = ++id; pend.set(h, { fn, ms }); return h; },
    clear: (h) => { pend.delete(h); },
    pending: () => [...pend.values()].map((p) => p.ms),
    /** 把目前所有排程一次點火（回點火數）。 */
    fire: () => { const e = [...pend.entries()]; pend.clear(); for (const [, p] of e) p.fn(); return e.length; },
  };
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
/** 一個假的私聊伺服器：since 增量／204／send／before。 */
function fakeServer(opts = {}) {
  const msgs = opts.msgs ? opts.msgs.slice() : [{ id: 'm1', mine: false, text: 'hi', ts: 100 }];
  const calls = [];
  const deferred = [];   // 讓某一發「晚點才回」
  const f = async (url, init) => {
    const u = new URL(url); const rec = { url: u.pathname + u.search, init }; calls.push(rec);
    const respond = () => {
      if (opts.respond) { const r = opts.respond(rec, calls.length); if (r) return r; }
      if (u.pathname === '/api/friends/dm/list') {
        const since = +(u.searchParams.get('since') || 0), before = +(u.searchParams.get('before') || 0);
        if (since > 0) { const nw = msgs.filter((m) => m.ts > since); return nw.length ? jsonRes(200, { friendsDm: 1, fid: FID, messages: nw, serverNow: 9 }) : noBody(204); }
        if (before > 0) return jsonRes(200, { friendsDm: 1, fid: FID, messages: msgs.filter((m) => m.ts < before).slice(-50), hasMore: false, serverNow: 9 });
        return jsonRes(200, { friendsDm: 1, fid: FID, messages: msgs.slice(-50), hasMore: !!opts.hasMore, serverNow: 9 });
      }
      if (u.pathname === '/api/friends/dm/send') { const b = JSON.parse(init.body); const m = { id: 'm' + (msgs.length + 1), mine: true, text: b.text, ts: 100 + msgs.length * 10 }; msgs.push(m); return jsonRes(200, { ok: true, friendsDm: 1, id: m.id, ts: m.ts }); }
      return htmlRes(404);
    };
    if (opts.defer && opts.defer(rec, calls.length)) return new Promise((res) => deferred.push(() => res(respond())));
    return respond();
  };
  return { f, calls, msgs, deferred, push: (m) => msgs.push(m) };
}
function makeSession(srv, over = {}, o = {}) {
  const T2 = makeTimers(); let hidden = false; const states = [];
  const mods = loadMods(srv.f, over);
  const sess = mods['dm-session'].createDmSession({
    getCtx: async () => (o.noCtx ? null : { uid: 'FU', token: 'TOK', fetchImpl: srv.f }),
    onChange: (s) => states.push(s),
    isHidden: () => hidden, setTimer: T2.set, clearTimer: T2.clear,
  });
  return { sess, T: T2, states, last: () => states[states.length - 1], setHidden: (v) => { hidden = v; }, mods };
}
await T('D1 ⭐ 開面板 ⇒ 恰一發 GET list（since=0）；狀態 loading→ready、訊息 1 則；排程恰一個 3000ms；pollMs=3000', async () => {
  const srv = fakeServer(); const S = makeSession(srv);
  S.sess.open(FID, '小明'); await flush();
  assert.strictEqual(srv.calls.length, 1, '開面板應恰一發'); assert.strictEqual(srv.calls[0].url, '/api/friends/dm/list?fid=' + FID);
  assert.strictEqual(S.states[0].status, 'loading'); assert.strictEqual(S.last().status, 'ready');
  assert.deepStrictEqual(S.last().messages, [{ id: 'm1', mine: false, text: 'hi', ts: 100 }]);
  assert.deepStrictEqual(S.T.pending(), [3000], '排程：' + JSON.stringify(S.T.pending()));
  assert.strictEqual(S.last().pollMs, 3000);
  S.sess.close();
});
await T('D2 ⭐ 每 3 秒一發 since=最後一則 ts；204 ⇒ 狀態仍 ready、零 notice、再排 3000；對方新訊息 ⇒ 追加且 since 前進；空對話 ⇒ since=1', async () => {
  const srv = fakeServer(); const S = makeSession(srv);
  S.sess.open(FID, '小明'); await flush();
  assert.strictEqual(S.T.fire(), 1); await flush();
  assert.strictEqual(srv.calls.length, 2); assert.strictEqual(srv.calls[1].url, '/api/friends/dm/list?fid=' + FID + '&since=100', srv.calls[1].url);
  assert.strictEqual(S.last().status, 'ready'); assert.strictEqual(S.last().notice, ''); assert.deepStrictEqual(S.T.pending(), [3000]);
  srv.push({ id: 'm2', mine: false, text: '在嗎', ts: 150 });
  S.T.fire(); await flush();
  assert.deepStrictEqual(S.last().messages.map((m) => m.id), ['m1', 'm2']);
  S.T.fire(); await flush();
  assert.strictEqual(srv.calls[3].url, '/api/friends/dm/list?fid=' + FID + '&since=150', 'since 沒前進：' + srv.calls[3].url);
  S.sess.close();
  const srv2 = fakeServer({ msgs: [] }); const S2 = makeSession(srv2);
  S2.sess.open(FID, '小明'); await flush(); S2.T.fire(); await flush();
  assert.strictEqual(srv2.calls[1].url, '/api/friends/dm/list?fid=' + FID + '&since=1', '空對話要用 since=1（走 204 分支）：' + srv2.calls[1].url);
  assert.strictEqual(S2.last().status, 'ready');
  S2.sess.close();
});
await T('D3 ⭐ document.hidden ⇒ 下一發排 15000（pollMs=15000）；回前景 poke ⇒ 立刻一發、之後回到 3000', async () => {
  const srv = fakeServer(); const S = makeSession(srv);
  S.sess.open(FID, '小明'); await flush();
  S.setHidden(true); S.T.fire(); await flush();
  assert.deepStrictEqual(S.T.pending(), [15000], 'hidden 時排程：' + JSON.stringify(S.T.pending())); assert.strictEqual(S.last().pollMs, 15000);
  const n = srv.calls.length;
  S.setHidden(false); S.sess.poke(); await flush();
  assert.strictEqual(srv.calls.length, n + 1, 'poke 應立刻一發'); assert.deepStrictEqual(S.T.pending(), [3000]);
  assert.strictEqual(S.last().pollMs, 3000);
  S.sess.close();
});
await T('D4 ⭐⭐ 關掉面板 ⇒ 排程清空、狀態 null、之後 200 個 tick **零請求**；在途回應遲到 ⇒ 不再排、不寫狀態；切換好友 ⇒ 舊 poller 不復活', async () => {
  const srv = fakeServer(); const S = makeSession(srv);
  S.sess.open(FID, '小明'); await flush();
  S.T.fire(); await flush();
  S.sess.close(); await flush();
  assert.strictEqual(S.last(), null, '關掉後狀態應為 null'); assert.deepStrictEqual(S.T.pending(), [], '關掉後仍有排程');
  const n = srv.calls.length; let fired = 0;
  for (let i = 0; i < 200; i++) { fired += S.T.fire(); await flush(); }
  assert.strictEqual(fired, 0, '關掉後還有 timer 被點火：' + fired);
  assert.strictEqual(srv.calls.length, n, '⚠⚠ 關掉面板後仍有請求：' + (srv.calls.length - n));
  const srv2 = fakeServer({ defer: (rec, k) => k === 2 }); const S2 = makeSession(srv2);
  S2.sess.open(FID, '小明'); await flush();
  S2.T.fire(); await flush();
  assert.strictEqual(srv2.deferred.length, 1, '第二發應被扣住');
  S2.sess.close(); const stateCount = S2.states.length;
  srv2.deferred[0](); await flush();
  for (let i = 0; i < 200; i++) { S2.T.fire(); await flush(); }
  assert.deepStrictEqual(S2.T.pending(), [], '在途回應遲到後又排了 timer');
  assert.strictEqual(S2.states.length, stateCount, '在途回應遲到後還寫了狀態');
  assert.strictEqual(srv2.calls.length, 2, '在途回應遲到後又發了請求');
  const srv3 = fakeServer(); const S3 = makeSession(srv3);
  S3.sess.open(FID, 'A'); await flush();
  S3.sess.open('0123456789abcdef01234567', 'B'); await flush();
  assert.deepStrictEqual(S3.T.pending(), [3000]);
  S3.T.fire(); await flush();
  assert.strictEqual(srv3.calls.filter((c) => c.url.includes('fid=' + FID)).length, 1, '切換後舊 fid 還在輪詢');
  S3.sess.close();
});
await T('D4m 正對照：(a) poller.stop 不清 timer ⇒ 紅在「關掉後仍有排程」；(b) session.close 不 stop ⇒ 同；(c) hidden 也 3000 ⇒ D3 紅；(d) since 恆 0 ⇒ D2 紅；(e) 204 當不支援 ⇒ D2 紅', async () => {
  const runD4 = async (over) => { const srv = fakeServer(); const S = makeSession(srv, over); S.sess.open(FID, 'x'); await flush(); S.T.fire(); await flush(); S.sess.close(); await flush();
    assert.deepStrictEqual(S.T.pending(), [], '關掉後仍有排程'); const n = srv.calls.length; for (let i = 0; i < 200; i++) { S.T.fire(); await flush(); } assert.strictEqual(srv.calls.length, n, '關掉面板後仍有請求'); };
  await mutantMustBreak('stop 不清 timer', () => runD4({ 'dm-poller': mutate(POLL, "    stop() {\n      active = false; gen++;\n      clear();\n    },", "    stop() {\n      active = false; gen++;\n    },") }), '關掉後仍有排程');
  await mutantMustBreak('close 不 stop', () => runD4({ 'dm-session': mutate(SESS, "    if (poller) { poller.stop(); poller = null; }", "    if (poller) { poller = null; }") }), '關掉後仍有排程');
  await mutantMustBreak('hidden 同 3 秒', async () => {
    const srv = fakeServer(); const S = makeSession(srv, { 'dm-poller': mutate(POLL, 'export const DM_POLL_HIDDEN_MS = 15000;', 'export const DM_POLL_HIDDEN_MS = 3000;') });
    S.sess.open(FID, 'x'); await flush(); S.setHidden(true); S.T.fire(); await flush();
    assert.deepStrictEqual(S.T.pending(), [15000], 'hidden 時排程');
  }, 'hidden 時排程');
  await mutantMustBreak('since 恆 0', async () => {
    const srv = fakeServer(); const S = makeSession(srv, { 'dm-session': mutate(SESS, 'first ? {} : { since: Math.max(1, last) }', '{}') });
    S.sess.open(FID, 'x'); await flush(); S.T.fire(); await flush();
    assert.strictEqual(srv.calls[1].url, '/api/friends/dm/list?fid=' + FID + '&since=100', 'since 沒帶');
  }, 'since 沒帶');
  await mutantMustBreak('204 當不支援', async () => {
    const srv = fakeServer(); const S = makeSession(srv, { 'friends-api': mutate(API, "  if (opts.dm && status === 204) {", "  if (false && opts.dm && status === 204) {") });
    S.sess.open(FID, 'x'); await flush(); S.T.fire(); await flush();
    assert.strictEqual(S.last().status, 'ready', '204 之後狀態應仍 ready');
  }, '204 之後狀態應仍 ready');
});
await T('D5 send：sending→POST→立刻一發 since（不自己塞、以 id 去重）；429 ⇒ notice＝伺服器文案、仍 ready、輪詢照常；403 ⇒ not-friends 且停輪詢', async () => {
  const srv = fakeServer(); const S = makeSession(srv);
  S.sess.open(FID, '小明'); await flush();
  const p = S.sess.send('哈囉');
  assert.strictEqual(S.last().sending, true, 'send 期間 sending 應為 true');
  await p; await flush();
  const urls = srv.calls.map((c) => c.url);
  assert.strictEqual(urls[1], '/api/friends/dm/send'); assert.strictEqual(urls[2], '/api/friends/dm/list?fid=' + FID + '&since=100', 'send 後應立刻一發 since：' + urls[2]);
  assert.deepStrictEqual(S.last().messages.map((m) => m.text), ['hi', '哈囉']); assert.strictEqual(S.last().sending, false);
  assert.deepStrictEqual(S.T.pending(), [3000]);
  S.T.fire(); await flush(); assert.strictEqual(S.last().messages.length, 2, '同一則不可重複');
  S.sess.close();
  const srv2 = fakeServer({ respond: (rec) => (rec.url === '/api/friends/dm/send' ? jsonRes(429, { error: '發言太快，請稍候', code: 'friends-dm-rate-gap', friendsDm: 1 }) : null) });
  const S2 = makeSession(srv2); S2.sess.open(FID, 'x'); await flush();
  await S2.sess.send('a'); await flush();
  assert.strictEqual(S2.last().status, 'ready'); assert.strictEqual(S2.last().notice, '發言太快，請稍候'); assert.deepStrictEqual(S2.T.pending(), [3000], '429 後輪詢應照常');
  S2.sess.close();
  const srv3 = fakeServer({ respond: (rec) => (rec.url === '/api/friends/dm/send' ? jsonRes(403, { error: '只能和目前的好友私聊', code: 'friends-dm-not-friends', friendsDm: 1 }) : null) });
  const S3 = makeSession(srv3); S3.sess.open(FID, 'x'); await flush();
  await S3.sess.send('a'); await flush();
  assert.strictEqual(S3.last().status, 'not-friends'); assert.ok(S3.last().blockMsg.length > 0); assert.deepStrictEqual(S3.T.pending(), [], '403 後應停輪詢');
  S3.sess.close();
});
await T('D6 首發失敗：503 friends-dm-disabled ⇒ dm-disabled 零排程；404 ⇒ unsupported 零排程；401 ⇒ auth 零排程；拿不到 token ⇒ auth 且**零請求**；5xx ⇒ error 可 retry', async () => {
  const cases = [
    ['dm-disabled', () => jsonRes(503, { error: '好友私聊尚未開放', code: 'friends-dm-disabled' })],
    ['unsupported', () => htmlRes(404)],
    ['auth', () => jsonRes(401, { error: '需要登入', code: 'friends-auth-required' })],
    ['error', () => htmlRes(502)],
  ];
  for (const [expect, resp] of cases) {
    const srv = fakeServer({ respond: () => resp() }); const S = makeSession(srv);
    S.sess.open(FID, 'x'); await flush();
    assert.strictEqual(S.last().status, expect, expect + '：' + JSON.stringify(S.last()));
    assert.ok(S.last().blockMsg.length > 0, expect + '：要有整面板說明');
    assert.deepStrictEqual(S.T.pending(), [], expect + '：不可繼續輪詢');
    assert.strictEqual(srv.calls.length, 1);
    S.sess.close();
  }
  const srv = fakeServer(); const S = makeSession(srv, {}, { noCtx: true });
  S.sess.open(FID, 'x'); await flush();
  assert.strictEqual(S.last().status, 'auth'); assert.strictEqual(srv.calls.length, 0, '沒 token 不可發請求'); assert.deepStrictEqual(S.T.pending(), []);
  S.sess.close();
  let n = 0; const srv2 = fakeServer({ respond: () => (++n === 1 ? htmlRes(502) : null) }); const S2 = makeSession(srv2);
  S2.sess.open(FID, 'x'); await flush(); assert.strictEqual(S2.last().status, 'error');
  S2.sess.retry(); await flush(); assert.strictEqual(S2.last().status, 'ready'); assert.strictEqual(srv2.calls.length, 2);
  S2.sess.close();
});
await T('D7 輪詢中的暫時性失敗（網路錯）⇒ 只掛 notice、仍 ready、下一發照排、恢復後清 notice；loadMore ⇒ before=最早 ts、前插、去重', async () => {
  let k = 0; const srv = fakeServer({ respond: (rec) => (rec.url.includes('since=') && ++k === 1 ? Promise.reject(new TypeError('Failed to fetch')) : null) });
  const S = makeSession(srv); S.sess.open(FID, 'x'); await flush();
  S.T.fire(); await flush();
  assert.strictEqual(S.last().status, 'ready'); assert.ok(S.last().notice.length > 0, '網路錯要掛 notice'); assert.deepStrictEqual(S.T.pending(), [3000]);
  S.T.fire(); await flush(); assert.strictEqual(S.last().notice, '', '恢復後 notice 要清');
  S.sess.close();
  const msgs = []; for (let i = 0; i < 60; i++) msgs.push({ id: 'k' + i, mine: i % 2 === 0, text: 't' + i, ts: 1000 + i });
  const srv2 = fakeServer({ msgs, hasMore: true }); const S2 = makeSession(srv2); S2.sess.open(FID, 'x'); await flush();
  assert.strictEqual(S2.last().messages.length, 50); assert.strictEqual(S2.last().hasMore, true);
  await S2.sess.loadMore(); await flush();
  assert.strictEqual(srv2.calls[1].url, '/api/friends/dm/list?fid=' + FID + '&before=1010', srv2.calls[1].url);
  assert.strictEqual(S2.last().messages.length, 60); assert.strictEqual(S2.last().messages[0].id, 'k0'); assert.strictEqual(S2.last().loadingMore, false);
  S2.sess.close();
});
await T('D8 在途只一發：list 還沒回來時 poke／timer 點火都不可再發第二發；回來後才排下一發', async () => {
  const srv = fakeServer({ defer: (rec, k) => k === 2 }); const S = makeSession(srv);
  S.sess.open(FID, 'x'); await flush();
  S.T.fire(); await flush();
  assert.strictEqual(srv.calls.length, 2); assert.strictEqual(srv.deferred.length, 1);
  S.sess.poke(); await flush(); S.T.fire(); await flush();
  assert.strictEqual(srv.calls.length, 2, '在途中 poke／點火不可再發：' + srv.calls.length);
  assert.deepStrictEqual(S.T.pending(), [], '在途中不可先排下一發');
  srv.deferred[0](); await flush();
  assert.deepStrictEqual(S.T.pending(), [3000], '回來後要排下一發');
  S.sess.close();
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】靜態：零 {@html}／each key／零 @media／JS 手機開關／文案／接線／編譯');
await T('E1 DmPanel 與 /friends 頁零 {@html}；DmPanel 的每個 each 用 (m.id)；/friends 頁的每個 each 仍用 (r.fid)（≥4）；訊息文字走 {m.text}', () => {
  assert.ok(!stripComments(PANEL).includes('{@html'), 'DmPanel 出現 {@html}');
  assert.ok(!stripComments(PAGE).includes('{@html'), '/friends 頁出現 {@html}');
  const pe = stripComments(PANEL).match(/\{#each[^}]*\}/g) || [];
  assert.ok(pe.length >= 1, 'DmPanel 沒有 each？');
  for (const e of pe) assert.ok(/\(m\.id\)\}$/.test(e), 'DmPanel 的 each 沒用 id 當 key：' + e);
  assert.ok(!stripComments(FRP).includes('{@html'), '好友名單共用元件出現 {@html}');
  const ge = stripComments(FRP).match(/\{#each[^}]*\}/g) || [];
  assert.ok(ge.length >= 4, '好友名單 each 少於 4');   // v6.296：名單本體在共用元件裡
  for (const e of ge) assert.ok(/\(r\.fid\)\}$/.test(e), '好友名單的 each 沒用 fid 當 key：' + e);
  assert.ok(/\{m\.text\}/.test(PANEL), '訊息文字要走 Svelte 預設 escape（{m.text}）');
});
await T('E2 ⭐⭐ 手機／桌機是 JS 分支：DmPanel.svelte **零 @media**、.desktop／.mobile 兩條規則都在且 .dm-panel 是 fixed；/friends 頁用 Math.min(innerWidth, innerHeight) <= N 且 N 與 game/+page.svelte 的 isPortraitMobile 相同；mobile prop 接 isMobile；resize 有掛有拆', () => {
  assert.strictEqual((stripComments(PANEL).match(/@media/g) || []).length, 0, 'DmPanel.svelte 出現 @media（禁用 @media 當手機開關）');
  const css = PANEL.slice(PANEL.lastIndexOf('<style'));
  assert.ok(/\.dm-panel\s*\{[^}]*position:\s*fixed/.test(css), '.dm-panel 不是 fixed（會擠到既有版面）');
  assert.ok(/\.dm-panel\.desktop\s*\{/.test(css) && /\.dm-panel\.mobile\s*\{[^}]*inset:\s*0/.test(css), '缺 .desktop／.mobile(inset:0) 兩條分支');
  assert.ok(/class="dm-panel \{mobile \? 'mobile' : 'desktop'\}"/.test(PANEL), '面板 class 沒依 mobile prop 切分支');
  const m = /isMobile = Math\.min\(window\.innerWidth, window\.innerHeight\) <= (\d+);/.exec(PAGE);
  assert.ok(m, '/friends 頁沒有 JS 手機開關');
  // ⭐v6.313 起門檻搬進單一來源 computeIsPortraitMobile(w, h, force)（回傳 Math.min(w, h) <= N || …）；仍抽同一個 N 比對，判準不變。
  const g = /function computeIsPortraitMobile\(w: number, h: number, force: boolean\): boolean \{\s*return Math\.min\(w, h\) <= (\d+)/.exec(GAME)
    || /isPortraitMobile = Math\.min\(w, h\) <= (\d+);/.exec(GAME);
  assert.ok(g, 'game/+page.svelte 的 isPortraitMobile 門檻抽不到（寫法變了？）');
  assert.strictEqual(m[1], g[1], '手機門檻與對戰頁不一致：' + m[1] + ' vs ' + g[1]);
  assert.ok(/<DmPanel [^>]*mobile=\{isMobile\}/.test(PAGE), 'DmPanel 沒接 mobile={isMobile}');
  assert.ok(/window\.addEventListener\('resize', onResize\)/.test(PAGE) && /window\.removeEventListener\('resize', onResize\)/.test(PAGE), 'resize 監聽沒掛／沒拆');
  const pageCss = PAGE.slice(PAGE.lastIndexOf('<style'));
  const medias = pageCss.match(/@media[^{]*\{([\s\S]*?)\n  \}/g) || [];
  assert.ok(medias.length >= 1, '/friends 頁既有的 @media（padding）抽不到 —— 掃描器壞了？');
  for (const blk of medias) assert.ok(!/dm-|DmPanel/.test(blk), '/friends 頁的 @media 碰到私聊面板：' + blk.slice(0, 100));
});
await T('E3 ⭐ 二次確認文案明講「對話也會一起刪除」且在 remove 分支內；onMount 清理呼叫 closeDm；act() 對同一 fid 成功後關面板；DmPanel 只在 {#if dmState} 內；💬 依 dmUnavailable 藏；session 接 document.hidden＋visibilitychange', () => {
  const i = FRP.indexOf("confirmKind === 'remove'}"); assert.ok(i > 0);
  const seg = FRP.slice(i, FRP.indexOf('{:else', i));
  assert.ok(seg.includes('對話也會一起刪除') && seg.includes('無法復原'), 'remove 二次確認沒明講對話會一起刪：' + seg.slice(0, 200));
  const om = PAGE.slice(PAGE.indexOf('onMount(() => {'), PAGE.indexOf('function openDm('));
  const ret = om.slice(om.lastIndexOf('return () => {'));
  assert.ok(ret.includes('closeDm();'), 'onMount 清理沒關面板（離開頁面會繼續輪詢）');
  assert.ok(/if \(dmState && dmState\.fid === fid\) closeDm\(\);/.test(PAGE), 'act() 成功後沒關同一位的面板');
  assert.ok(/\{#if dmState\}\s*<DmPanel /.test(PAGE), 'DmPanel 沒包在 {#if dmState} 內');
  assert.ok(/onclose=\{closeDm\}/.test(PAGE), 'DmPanel 的 onclose 沒接 closeDm');
  assert.ok(/function closeDm\(\) \{ dm\?\.close\(\); \}/.test(PAGE), 'closeDm 沒接 session.close');
  // v6.296：💬 的顯示條件抽成 showDm（外面有給 ondm ＋ 私聊沒被判為不可用）⇒ 求值，不比字面
  const sd = /const showDm = \$derived\(([^;]*)\);/.exec(FRP);
  assert.ok(sd, '好友名單沒有 showDm 的 $derived');
  const evShow = (hasOndm, unavail) => new Function('ondm', 'dmUnavailable', 'return (' + sd[1] + ');')(hasOndm ? () => {} : null, unavail);
  assert.strictEqual(evShow(true, false), true, '有 ondm 且私聊可用時 💬 必須出現');
  assert.strictEqual(evShow(true, true), false, '私聊不可用時 💬 必須藏（沿用 v6.288）');
  assert.strictEqual(evShow(false, false), false, '外面沒給 ondm（例如未接私聊的嵌入用法）時不得出現 💬');
  assert.ok(/\{#if showDm\}<button class="small dm-open"/.test(FRP), '💬 按鈕沒依 showDm 藏');
  assert.ok(/dm\.open\(r\.fid, r\.alias \|\| r\.nick\)/.test(PAGE), 'openDm 沒接 session.open（v6.296：標題優先用備註名）');
  const cs = PAGE.slice(PAGE.indexOf('dm = createDmSession({'), PAGE.indexOf('});', PAGE.indexOf('dm = createDmSession({')));
  assert.ok(/getCtx: ctx,/.test(cs) && /\.\.\.browserPollerDeps\(\),/.test(cs) && /onChange: \(s\) => \{ dmState = s;/.test(cs), 'session 沒接 getCtx／onChange／browserPollerDeps（真 timer／document.hidden）：' + cs);
  assert.ok(/if \(s && \(s\.status === 'dm-disabled' \|\| s\.status === 'unsupported'\)\) dmNegMsg = s\.blockMsg;/.test(cs), '私聊不可用的說明沒記到 dmNegMsg（關面板後 💬 會再露出）');
  assert.ok(/document\.addEventListener\('visibilitychange', onVis\)/.test(PAGE) && /document\.removeEventListener\('visibilitychange', onVis\)/.test(PAGE), 'visibilitychange 沒掛／沒拆');
  const bp = POLL.slice(POLL.indexOf('export function browserPollerDeps('), POLL.indexOf('export function createDmPoller('));
  assert.ok(/isHidden: \(\) => typeof document !== 'undefined' && document\.hidden === true/.test(bp), 'browserPollerDeps 的 isHidden 沒接 document.hidden');
  assert.ok(/setTimer: \(fn, ms\) => setTimeout\(fn, ms\)/.test(bp) && /clearTimer: \(h\) => clearTimeout\(/.test(bp), 'browserPollerDeps 沒接真 setTimeout／clearTimeout');
});
await T('E4 svelte 編譯（client、runes）零錯誤零警告；DmPanel 與 /friends 頁零 setTimeout／setInterval；dm-session 不自己開 timer（全走注入）；dm-poller 零 import、零 setInterval', () => {
  for (const [n, s] of [['DmPanel.svelte', PANEL], ['+page.svelte', PAGE]]) {
    const r = svelteCompile(s, { generate: 'client', filename: n, runes: true });
    assert.strictEqual(r.warnings.length, 0, n + ' 編譯警告：' + r.warnings.map((w) => w.code + ':' + w.message).join(' | '));
    const c = stripComments(s);
    assert.strictEqual((c.match(/setInterval\s*\(/g) || []).length, 0, n + ' 有 setInterval');
    assert.strictEqual((c.match(/setTimeout\s*\(/g) || []).length, 0, n + ' 有 setTimeout');
  }
  const sc = stripComments(SESS);
  assert.strictEqual((sc.match(/setInterval\s*\(|setTimeout\s*\(|requestAnimationFrame\s*\(/g) || []).length, 0, 'dm-session 自己開 timer（應全走注入）');
  assert.strictEqual((stripComments(POLL).match(/^\s*import\s/gm) || []).length, 0, 'dm-poller 不可 import');
  assert.strictEqual((stripComments(POLL).match(/setInterval\s*\(/g) || []).length, 0, 'dm-poller 不可用 setInterval（要串接 setTimeout 才能「在途只一發」）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】框架安全：對戰頁零私聊引用（逐位元未動由 test-v6272 ⑩ PREV_ALLOWED 守）');
// ⭐⭐⭐ v6.297 改寫（**不是放寬**）：私聊從這一版起**內嵌**在大廳／錦標賽的好友分頁裡，
//   所以「game/+page.svelte 一個 DmPanel 字元都不能有」這條字串比對必然紅。
//   ⚠⚠ 直接放寬＝把守護意圖丟掉。原本這條守的**因**是「私聊不可以被打包進對戰頁、對戰版面不可以被私聊污染」，
//   ⇒ 改成三條等價（而且更強）的條件：
//     ① MobilePortraitBattle.svelte **原條文一字不動**（它到現在都還沒碰過私聊）。
//     ② game/+page.svelte 的**靜態** import 一行都不得引用私聊模組（`import type` 除外＝編譯後消失）；
//        私聊只能經由動態 import() 進來 ⇒ 不會進對戰頁的主 chunk。
//     ③ 對戰版面分支區間（手機直式 ／ 三種桌機版面）零 Dm／零 friend。
//   ⭐ 更完整的版本在 scripts/test-v6297-tourn-friends-tab.mjs【D】：那裡是走**整張靜態相依圖**，
//     連「包一層 wrapper 再靜態 import」這種字串比對擋不住的繞道也擋得住（附兩個正對照）。
function staticImportLines(src) {
  // ⭐ v6.317：改走中央 helper（開頭標籤限行首、至少抽到 1 段）—— 與 test-v6190 同一族的形狀一併收斂
  // ⭐ v6.318：腳本內文的剝註解改走**行級** stripCommentsChecked —— 本檔的 stripComments 是區塊正則，
  //   game/+page.svelte 腳本 :208 的 `// … /api/tournament/*` 會讓它吃掉 177 行（今天 import 都在 :146 之前所以沒事，
  //   但 effects.ts 同一形狀已實際吃掉 3 個 import；第 13 種安慰劑的形狀不該留在 import 掃描路徑上）。
  const code = sectionInner(src, 'script', { label: 'game/+page.svelte', minSections: 1 });
  return stripCommentsChecked(code, { label: 'game/+page.svelte <script>', mustKeep: ["from 'svelte'"] })
    .split('\n').filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
}
function assertNoStaticDmImport(src) {
  const lines = staticImportLines(src);
  assert.ok(lines.length > 10, '掃描器下限：只抽到 ' + lines.length + ' 行靜態 import ⇒ 抽取器壞了');
  for (const l of lines) {
    for (const k of ['DmPanel', 'dm-session', 'dm-poller']) {
      assert.ok(!l.includes(k), '⚠⚠⚠ game/+page.svelte 用**靜態** import 引用了私聊模組（會被打包進對戰頁）：' + l.trim());
    }
  }
}
await T('F1 ⭐⭐⭐ 私聊不得進對戰頁的主 chunk：game/+page.svelte 的靜態 import 零私聊模組（動態 import() 才是唯一入口）；MobilePortraitBattle.svelte 原條文一字不動；對戰版面分支零 Dm／friend', () => {
  assert.ok(GAME.length > 500000, 'game/+page.svelte 太短，讀錯檔？');
  // ① MobilePortraitBattle：原條文
  for (const k of ['DmPanel', 'dm-session', 'dm-poller', 'friendsDm', 'fetchDmMessages', 'sendDm', 'createDmSession'])
    assert.ok(!MPB.includes(k), 'MobilePortraitBattle.svelte 出現 ' + k + '（對戰版面一行都不該動）');
  // ② 靜態 import 零私聊（正對照：塞一行進去必紅）
  assertNoStaticDmImport(GAME);
  const bad = GAME.replace('<script lang="ts">', "<script lang=\"ts\">\n  import DmPanel from '../friends/DmPanel.svelte';");
  let err = null; try { assertNoStaticDmImport(bad); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /靜態.*引用了私聊模組/.test(err.message), '掃描器抓不到塞進去的靜態 import：' + (err && err.message));
  // ③ 對戰版面分支零 Dm／friend
  const bs = '  {#if isPortraitMobile && game}\n', be = '{/if}<!-- /isPortraitMobile && playing -->';
  const i = GAME.indexOf(bs), j = GAME.indexOf(be, i);
  assert.ok(i > 0 && j > i, '找不到對戰版面分支錨點');
  const region = GAME.slice(i, j + be.length);
  assert.ok(region.length > 20000, '對戰版面區間只有 ' + region.length + ' 字元 ⇒ 錨點抓錯');
  for (const re of [/DmPanel/g, /dmState/g, /openDm/g, /friend/gi]) {
    assert.strictEqual((region.match(re) || []).length, 0, '⚠⚠ 對戰版面分支出現 ' + re.source);
  }
  // ④ 動態 import() 確實是唯一入口
  //   ⭐v6.311：整檔計數改走中央 helper 的**行級**剝註解 —— 本檔的 stripComments 用 block regex，
  //   game/+page.svelte :208 的 `// … /api/tournament/*` 會讓它一路吃掉 176 行真程式碼（第 13 種安慰劑），
  //   「恰一處」在那個洞裡就數不到 ⇒ 假綠方向。helper 自帶長度護欄＋正對照。
  const G4 = stripCommentsChecked(GAME, { label: 'game/+page.svelte', mustKeep: ["import('$lib/friends/dm-session')"] });
  for (const k of ["import('$lib/friends/dm-session')", "import('../friends/DmPanel.svelte')"])
    assert.strictEqual(G4.split(k).length - 1, 1, '動態 import 不是恰一處：' + k);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】test chain／版本');
await T('G1 本守衛在 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不 pin 版本）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.includes('node scripts/test-v6288-friends-dm-ui.mjs'), '沒進 test chain');
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'))[1];
  assert.strictEqual(H, V, 'hint ' + H + ' ≠ version.ts ' + V);
});

console.log('\n══ v6.288 好友私聊 P1 守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
