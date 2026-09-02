// v6.287 守衛：好友私聊【P0：伺服器端＋admin 檢視】（HEAD-FAIL：BASE v6.286 沒有 FRIENDS-DM 區塊 ⇒ A0 必紅並提前結束）
//
// 守什麼（全部行為端；伺服器區塊用 scripts/lib/friends-harness-v6282.mjs 把 FRIENDS＋FRIENDS-DM 兩段抽出來實跑）：
//   【A】抽取器下限＋錦標賽區塊兩把 sha256（與 test-v6272 ⑨／test-v6278 I1 同）＋ DM 區塊位置在錦標賽區塊之前。
//   【B】⭐⭐ 出貨碼 send 寫進去的 doc：expireAt **是 Date**（TTL 只刪 Date 型別）、值＝now＋90 天、ts 是數字；
//        createIndex {expireAt:1}+expireAfterSeconds:0 真的被呼叫；正對照＝改成 Date.now() 數字要紅、拿掉 createIndex 要紅。
//   【C】⭐⭐ 既有 pruneLobbyChat 與 admin chat/clear（**出貨碼抽出來實跑**）對 room:'dm:*' 假資料筆數不變；
//        正對照＝把 clear 的 room:'lobby' 過濾拿掉要紅；靜態枚舉：本檔所有對 tournamentChat 的刪除都帶 room:'lobby'。
//   【D】玩家端回應永不含 email（含 email 假資料實跑，序列化掃 `@` 與 local-part 半個 email）；admin 端點**可以**含 email（分開斷言）。
//   【E】授權：C 拿 A|B 的 fid 打 send／list ⇒ 403 且 DB 零寫入；pending／rejected／已解除 ⇒ 403 零寫入；
//        被封鎖方 send ⇒ 200 但零寫入、list ⇒ 403；封鎖方 ⇒ 403。正對照＝_frFindMine 不看 a/b 要紅。
//   【F】限流三層各自被打紅（1.2 秒／20 分／500 日）；打錯字（空白）不吃額度；200 字截斷；\s+ 折單空白。
//   【G】開關：dm 子開關關 ⇒ 503 且不帶哨兵；總開關關 ⇒ 503；兩者都關時不驗 token；admin dm-config GET/POST 兩端接線。
//   【H】since 無新訊息 ⇒ 204 零 body；有 ⇒ 只回更新的、升序；首發最新 50＋before 分頁＋hasMore；mine 方向正確。
//   【I】admin 總覽：> 200 段對話時 adminScanYield 的 ticks **確切次數**；硬上限截斷誠實回報；正對照＝拿掉讓路要紅。
//   【J】admin.html：loadMonitor 真的多打 GET dm-config、三態都畫得出來；monSetFriendsDm 真的 POST 且 body 只有 {dm}；
//        monLoadDms／monLoadDmThread 真的打對端點；含 <img onerror> 的假訊息渲染後 DOM 沒有 img（純文字渲染契約）；
//        兩端接線：UI 送出的 (method,path,body) 原封餵進伺服器 routes 表 ⇒ 子開關真的切換、總覽真的回資料。
//   【K】test chain／版本一致（不 pin 版本號）。
//
// ⚠ 紀律：只捕 AssertionError；突變體必須紅在**預期那一條**；不 pin 版本號／sha 當唯一判準；資料量拉到足以觸發被測分支（> 200 筆）。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import {
  readPatch, extractBlock, FR_START, FR_END,
  buildFriends, makeFakeDb, makeFakeApp, mkRes, asUser, findEmails, makeYield, fakeTournIdentity, fakeIsTournAdmin,
} from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const P_ADMIN = join(ROOT, 'oracle-admin/admin.html');
const PATCH = readPatch(P_SRV);
const ADMIN = readFileSync(P_ADMIN, 'utf8');
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
const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'fB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'fC', email: 'carol@example.com', name: '卡蘿' },
  AD: { uid: 'fAd', email: 'admin@example.com', name: '管理員' },
};
const admin = asUser(U.AD);
/** friendships 假列（與出貨碼 request 寫出來的形狀一致；fid 走出貨碼同款 FNV 雜湊，所以「fid 由兩個 email 算得出來」在測試裡也成立）。 */
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
const AB = mkRow(U.A.email, U.B.email, 'accepted');
const seedOn = (rows) => ({ tournamentConfig: [{ _id: 'friendsConfig', enabled: true, dm: true }], friendships: rows || [structuredClone(AB)] });
const writesTo = (db, name) => db._log.filter((l) => l.name === name && /^(insertOne|updateOne|replaceOne|deleteOne|deleteMany)$/.test(l.op)).length;

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】抽取器 ＋ 錦標賽區塊 sha256 ＋ 位置');
let FR = '', DM = '', SRC = '';
await T('A0 HEAD-FAIL 錨點：FRIENDS 區塊與 FRIENDS-DM 區塊都抽得到（BASE v6.286 沒有 DM 區塊 ⇒ 這一條必紅）', () => {
  const probe = makeFakeDb({}).collection('probe');
  assert.ok(typeof probe.insertOne === 'function' && typeof probe.aggregate === 'function' && typeof probe.find({}).sort === 'function' && typeof mkRes().end === 'function',
    'HEAD-FAIL：scripts/lib/friends-harness-v6282.mjs 沒有 v6.287 的擴充（insertOne／aggregate／sort／res.end）');
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  DM = extractBlock(PATCH, DM_START, DM_END, 8000);
  assert.ok(DM.includes("app.post('/api/friends/dm/send'") && DM.includes("app.get('/api/friends/dm/list'") && DM.includes("app.get('/api/friends/admin/dm'"), 'DM 區塊缺端點');
  SRC = FR + '\n' + DM;
});
if (!DM) { console.log('\n══ v6.287 守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：DM 區塊抽不到，後續無法進行）══'); process.exit(1); }
const TOURN_TAIL_SHA256 = '495221f1dbf51dea9020284147fcf9b271d2baeccdac8d3b4745110c409dca02';   // 與 test-v6272 ⑨ 同一把
const TOURN_ANCHOR_SHA256 = '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd'; // 與 test-v6278 I1 同一把
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256）；DM 區塊整段在 FRIENDS 之後、第一支 /api/tournament 之前', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");
  assert.ok(first > 0, '找不到第一支 /api/tournament 端點');
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(FR_END) < PATCH.indexOf(DM_START) && PATCH.indexOf(DM_END) < first, 'DM 區塊位置不對');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗');
});
await T('A2 DM 區塊只用 _frFail 當 500 出口（零 e.message 外洩）；沿用 tournamentChat 且 room 前綴 dm:', () => {
  assert.strictEqual((DM.match(/res\.status\(500\)/g) || []).length, 0, 'DM 區塊不得有自己的 500 出口');
  assert.ok((DM.match(/_frFail\(res, e, '/g) || []).length >= 5, '每支端點都要走 _frFail');
  assert.ok(DM.includes("const FR_DM_COLL = 'tournamentChat';") && DM.includes("const FR_DM_ROOM_PREFIX = 'dm:';"));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】expireAt 型別是 Date（TTL 只刪 Date）＋ TTL 索引真的建了');
const NOW0 = 1_800_000_000_000;
async function sendOnce(src, seed, who, fid, text, now) {
  const H = buildFriends(src, { seed });
  const realNow = Date.now; Date.now = () => (now || NOW0);
  try { const r = await H.call('post', '/api/friends/dm/send', asUser(who), { fid, text }); return { H, r }; }
  finally { Date.now = realNow; }
}
await T('B1 ⭐⭐ send 寫進 tournamentChat 的 doc：expireAt instanceof Date、＝now＋90 天；ts 是數字；room=dm:<fid>；side 相對 pair；不存 email', async () => {
  const { H, r } = await sendOnce(SRC, seedOn(), U.A, AB.fid, '哈囉');
  assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.friendsDm, 1);
  const docs = H.db.snapshot('tournamentChat');
  assert.strictEqual(docs.length, 1);
  const d = docs[0];
  assert.ok(d.expireAt instanceof Date, 'expireAt 型別不是 Date（MongoDB TTL 只刪 Date；數字永遠不會過期）：' + typeof d.expireAt);
  assert.strictEqual(d.expireAt.getTime(), NOW0 + 90 * 86400000, 'expireAt 不是 90 天');
  assert.strictEqual(typeof d.ts, 'number'); assert.strictEqual(d.ts, NOW0);
  assert.strictEqual(d.room, 'dm:' + AB.fid); assert.strictEqual(d.side, 'a'); assert.strictEqual(d.text, '哈囉');
  assert.deepStrictEqual(findEmails(d), [], 'doc 不得存 email：' + JSON.stringify(d));
  assert.ok(!('uid' in d) && !('email' in d) && !('name' in d), 'doc 只准 room/side/text/ts/expireAt');
});
await T('B1m 正對照：expireAt 改成 Date.now() 數字 ⇒ B1 紅在型別那一條', async () => {
  const bad = mutate(SRC, 'expireAt: new Date(now + FR_DM_TTL_MS)', 'expireAt: now + FR_DM_TTL_MS');
  await mutantMustBreak('expireAt 數字', async () => {
    const { H } = await sendOnce(bad, seedOn(), U.A, AB.fid, 'x');
    assert.ok(H.db.snapshot('tournamentChat')[0].expireAt instanceof Date, 'expireAt 型別不是 Date');
  }, 'expireAt 型別不是 Date');
});
await T('B2 啟動時真的呼叫 createIndex：tournamentChat {expireAt:1}+expireAfterSeconds:0、friendships {fid:1}（安慰劑型態 12：只驗查詢形狀不驗前置條件）', () => {
  const H = buildFriends(SRC, { seed: seedOn() });
  const ci = H.db._log.filter((l) => l.op === 'createIndex');
  const ttl = ci.find((l) => l.name === 'tournamentChat' && JSON.stringify(l.keys) === '{"expireAt":1}');
  assert.ok(ttl, '沒有對 tournamentChat 建 {expireAt:1}');
  const fid = ci.find((l) => l.name === 'friendships' && JSON.stringify(l.keys) === '{"fid":1}');
  assert.ok(fid, '沒有對 friendships 建 {fid:1}（admin 用 fid $in 反查）');
  assert.ok(/createIndex\(\{ expireAt: 1 \}, \{ expireAfterSeconds: 0 \}\)/.test(DM), 'expireAfterSeconds 必須是 0（expireAt 本身就是到期時間）');
  assert.ok(!/createIndex\(\{ ts: 1 \}, \{ expireAfterSeconds/.test(DM), '不得在 ts（數字）上建 TTL —— 那是 tournamentClientDiag 從未生效的寫法');
});
await T('B2m 正對照：拿掉 TTL 那行 createIndex ⇒ B2 紅', async () => {
  const bad = mutate(SRC, "      db.collection(FR_DM_COLL).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { /* best-effort，已存在即略過 */ });\n", '');
  await mutantMustBreak('無 TTL 索引', () => {
    const H = buildFriends(bad, { seed: seedOn() });
    assert.ok(H.db._log.some((l) => l.op === 'createIndex' && l.name === 'tournamentChat' && JSON.stringify(l.keys) === '{"expireAt":1}'), '沒有對 tournamentChat 建 {expireAt:1}');
  }, '沒有對 tournamentChat 建 {expireAt:1}');
});
await T('B3 ⭐ 讀碼判定：tournamentClientDiag 的 TTL 建在 ts 上、而 insertOne 寫的 ts 是 Date.now() 數字 ⇒ 那個 7 天 TTL 從未生效（本版不修，只記錄）', () => {
  const i = PATCH.indexOf("const TCDIAG = db.collection('tournamentClientDiag');");
  assert.ok(i > 0);
  const seg = PATCH.slice(i, i + 20000);
  assert.ok(/TCDIAG\.createIndex\(\{ ts: 1 \}, \{ expireAfterSeconds: 604800 \}\)/.test(seg), 'TCDIAG TTL 索引寫法變了（若已改成 Date 欄位，請把這條與 B2 的註解一起更新）');
  assert.ok(/TCDIAG\.insertOne\(\{ ts: now,/.test(seg) && /now = Date\.now\(\)/.test(seg), 'TCDIAG 寫入的 ts 來源變了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】既有修剪排程與 admin 清空（出貨碼實跑）不會誤刪 dm:*');
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new assert.AssertionError({ message: '括號沒配對：' + anchor });
}
function handlerSrc(src, anchor) {
  const i = src.indexOf(anchor); if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  const j = src.indexOf('\n    });', i); if (j < 0) throw new assert.AssertionError({ message: '找不到 handler 結尾：' + anchor });
  return src.slice(i, j + '\n    });'.length);
}
const chatSeed = (lobbyN, dmN) => {
  const lobby = [], dm = [];
  for (let i = 0; i < lobbyN; i++) lobby.push({ _id: 'l' + i, room: 'lobby', uid: 'u', name: 'n', text: 't' + i, ts: 1000 + i });
  for (let i = 0; i < dmN; i++) dm.push({ _id: 'd' + i, room: 'dm:' + (i % 7 === 0 ? AB.fid : 'f' + i), side: i % 2 ? 'a' : 'b', text: 'dm' + i, ts: 500 + i, expireAt: new Date(NOW0) });
  return { tournamentChat: [...lobby, ...dm] };
};
const countRoom = (db, pred) => db.snapshot('tournamentChat').filter((d) => pred(d.room)).length;
await T('C1 ⭐⭐ pruneLobbyChat（出貨碼抽出來實跑）：lobby 900 → 約 800，dm:* 300 筆一筆不少', async () => {
  const src = fnSrc(PATCH, 'async function pruneLobbyChat() {');
  assert.ok(src.includes("deleteMany({ room: 'lobby'"), '抽到的不是那支函式');
  const db = makeFakeDb(chatSeed(900, 300));
  const prune = new Function('TCHAT', 'console', '"use strict";\n' + src + '\nreturn pruneLobbyChat;')(db.collection('tournamentChat'), { log() {} });
  await prune();
  // ⚠ 出貨碼的語義是「保留比第 801 新的」（skip(KEEP) 取到第 801 則、deleteMany ts:{$lt} 不含它）⇒ 實際留 801；不是本版的事，照實斷言範圍
  const lobbyLeft = countRoom(db, (r) => r === 'lobby');
  assert.ok(lobbyLeft >= 800 && lobbyLeft <= 801, 'lobby 沒被修剪到約 800（' + lobbyLeft + '）⇒ 抽出來的函式沒真的跑');
  assert.strictEqual(countRoom(db, (r) => String(r).startsWith('dm:')), 300, '⚠⚠ 修剪排程刪到私聊了');
});
await T('C2 ⭐⭐ POST /api/tournament/admin/chat/clear（出貨碼抽出來實跑）：lobby 全清、dm:* 一筆不少；非 admin 403 零刪除', async () => {
  const src = handlerSrc(PATCH, "app.post('/api/tournament/admin/chat/clear'");
  const run = async (hsrc, headers) => {
    const db = makeFakeDb(Object.assign(chatSeed(50, 300), { tournamentConfig: [] }));
    const app = makeFakeApp({});
    new Function('app', 'TCHAT', 'TCONFIG', 'tournIdentity', 'isTournAdmin', '"use strict";\n' + hsrc)(app, db.collection('tournamentChat'), db.collection('tournamentConfig'), fakeTournIdentity, fakeIsTournAdmin);
    const res = mkRes();
    await app.routes.post['/api/tournament/admin/chat/clear']({ headers, body: {}, query: {} }, res);
    return { db, res };
  };
  const ok = await run(src, admin);
  assert.strictEqual(ok.res.code, 200, JSON.stringify(ok.res.body));
  assert.strictEqual(countRoom(ok.db, (r) => r === 'lobby'), 0, 'lobby 沒清空 ⇒ 抽出來的 handler 沒真的跑');
  assert.strictEqual(countRoom(ok.db, (r) => String(r).startsWith('dm:')), 300, '⚠⚠ admin 清空大廳刪到私聊了');
  const no = await run(src, asUser(U.A));
  assert.strictEqual(no.res.code, 403); assert.strictEqual(countRoom(no.db, () => true), 350);
  // 正對照（history-free）：把過濾拿掉 ⇒ 私聊會被刪 ⇒ 上面那條抓得到
  await mutantMustBreak('clear 不過濾 lobby', async () => {
    const bad = await run(mutate(src, "await TCHAT.deleteMany({ room: 'lobby' });", 'await TCHAT.deleteMany({});'), admin);
    assert.strictEqual(countRoom(bad.db, (r) => String(r).startsWith('dm:')), 300, '⚠⚠ admin 清空大廳刪到私聊了');
  }, '刪到私聊了');
});
await T('C3 靜態枚舉：本檔所有對 tournamentChat／TCHAT 的刪除呼叫都帶 room:\'lobby\'，唯一例外＝v6.288 remove 的 _frPurgeDm 等值 `{ room: \'dm:\' + fid }`（掃描器下限 ≥ 3）；oracle-admin/ 其他檔零引用', () => {
  const stripped = PATCH.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const dels = [...stripped.matchAll(/(TCHAT|collection\(FR_DM_COLL\)|collection\('tournamentChat'\))\.(deleteMany|deleteOne|updateMany|drop|remove)\(([^)]*)\)/g)];
  assert.ok(dels.length >= 3, '掃描器壞了？只掃到 ' + dels.length + ' 個刪除呼叫');
  // v6.288 站長裁定「解除好友連對話一起刪」：唯一被授權的例外是 remove → _frPurgeDm 的**等值** room（行為端在 test-v6288 B1：lobby 逐 id 不少、別段對話不少）
  const PURGE_FILTER = "{ room: 'dm:' + fid }";
  const purges = dels.filter((m) => m[3].trim() === PURGE_FILTER);
  assert.strictEqual(purges.length, 1, 'dm 等值刪除必須恰一處（_frPurgeDm）：' + purges.length);
  for (const m of dels) assert.ok(/room:\s*'lobby'/.test(m[3]) || m[3].trim() === PURGE_FILTER, '這個刪除沒有限定 lobby（也不是 v6.288 授權的等值 dm 刪除）：' + m[0].slice(0, 120));
  const others = readdirSync(join(ROOT, 'oracle-admin')).filter((f) => f !== 'server_admin_patch.js' && /\.(js|cjs|mjs|sh|bat)$/.test(f));
  for (const f of others) assert.ok(!readFileSync(join(ROOT, 'oracle-admin', f), 'utf8').includes('tournamentChat'), f + ' 也碰 tournamentChat（要逐一確認不會刪私聊）');
  const tdir = join(ROOT, 'oracle-admin/tournament');
  for (const f of readdirSync(tdir)) assert.ok(!readFileSync(join(tdir, f), 'utf8').includes('tournamentChat'), 'oracle-admin/tournament/' + f + ' 也碰 tournamentChat');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】玩家端回應永不含 email；admin 端點可以（兩條白名單分開）');
const LOCAL_PARTS = ['alice', 'bob', 'carol', 'example.com'];
const scanHalf = (body) => LOCAL_PARTS.filter((p) => JSON.stringify(body).includes(p));
async function convo() {
  const seed = seedOn();
  const H = buildFriends(SRC, { seed });
  const realNow = Date.now; let t = NOW0;
  Date.now = () => t;
  try {
    for (let i = 0; i < 6; i++) { t += 1500; const who = i % 2 ? U.B : U.A; const r = await H.call('post', '/api/friends/dm/send', asUser(who), { fid: AB.fid, text: '第 ' + i + ' 則 by ' + who.name }); assert.strictEqual(r.code, 200, JSON.stringify(r.body)); }
  } finally { Date.now = realNow; }
  return H;
}
await T('D1 ⭐⭐ send／list（首發、since、before）／403／429／400 的每一個回應：掃不到 `@`、掃不到 local-part（半個 email）', async () => {
  const H = await convo();
  const bodies = [];
  bodies.push((await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid })).body);
  bodies.push((await H.call('get', '/api/friends/dm/list', asUser(U.B), {}, { fid: AB.fid, since: String(NOW0 + 1500) })).body);
  bodies.push((await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, before: String(NOW0 + 6000) })).body);
  bodies.push((await H.call('get', '/api/friends/dm/list', asUser(U.C), {}, { fid: AB.fid })).body);
  bodies.push((await H.call('post', '/api/friends/dm/send', asUser(U.C), { fid: AB.fid, text: 'x' })).body);
  bodies.push((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '   ' })).body);
  bodies.push((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'a' })).body);
  bodies.push((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'b' })).body);   // 1.2 秒內 ⇒ 429
  assert.ok(bodies.length >= 8 && bodies.every((b) => b !== null), '有回應是空的：' + JSON.stringify(bodies));
  for (const b of bodies) {
    assert.deepStrictEqual(findEmails(b), [], '玩家端回應出現 email：' + JSON.stringify(b));
    assert.deepStrictEqual(scanHalf(b), [], '玩家端回應出現半個 email：' + JSON.stringify(b));
  }
  const first = bodies[0];
  assert.strictEqual(first.friendsDm, 1); assert.strictEqual(first.messages.length, 6);
  for (const m of first.messages) assert.deepStrictEqual(Object.keys(m).sort(), ['id', 'mine', 'text', 'ts'], '玩家端白名單形狀：' + JSON.stringify(m));
});
await T('D1m 正對照：list 改用 admin 白名單 _frDmAdminRow ⇒ D1 紅在 email', async () => {
  const bad = mutate(SRC, 'res.json({ friendsDm: 1, fid: r.fid, messages: docs.map((m) => _frDmPublic(m, r.side)), hasMore, serverNow: Date.now() });',
    'res.json({ friendsDm: 1, fid: r.fid, messages: docs.map((m) => _frDmAdminRow(m, r.cur)), hasMore, serverNow: Date.now() });');
  await mutantMustBreak('list 走 admin 白名單', async () => {
    const H = buildFriends(bad, { seed: seedOn() });
    await sendOnce(bad, null, U.A, AB.fid, 'x').catch(() => {});
    const realNow = Date.now; Date.now = () => NOW0;
    try { await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' }); } finally { Date.now = realNow; }
    const b = (await H.call('get', '/api/friends/dm/list', asUser(U.B), {}, { fid: AB.fid })).body;
    assert.deepStrictEqual(findEmails(b), [], '玩家端回應出現 email：' + JSON.stringify(b));
  }, '玩家端回應出現 email');
});
await T('D2 admin 端點（總覽＋展開）**可以**含 email：from＝發言者 email、pair a/b；非 admin 403 且回應無 email', async () => {
  const H = await convo();
  const ov = await H.call('get', '/api/friends/admin/dm', admin);
  assert.strictEqual(ov.code, 200, JSON.stringify(ov.body)); assert.strictEqual(ov.body.friendsDm, 1);
  assert.strictEqual(ov.body.conversations.length, 1);
  const c0 = ov.body.conversations[0];
  assert.strictEqual(c0.a, U.A.email); assert.strictEqual(c0.b, U.B.email); assert.strictEqual(c0.count, 6); assert.strictEqual(c0.status, 'accepted');
  assert.strictEqual(c0.last, NOW0 + 9000); assert.strictEqual(c0.first, NOW0 + 1500);
  const th = await H.call('get', '/api/friends/admin/dm', admin, {}, { fid: AB.fid });
  assert.strictEqual(th.code, 200); assert.strictEqual(th.body.messages.length, 6);
  assert.deepStrictEqual(th.body.messages.map((m) => m.from), [U.A.email, U.B.email, U.A.email, U.B.email, U.A.email, U.B.email], 'from 方向錯');
  assert.ok(findEmails(th.body).length >= 2, 'admin 端點應含 email（這條證明兩份白名單沒混）');
  assert.strictEqual(typeof th.body.messages[0].expireAt, 'number');
  const no = await H.call('get', '/api/friends/admin/dm', asUser(U.A));
  assert.strictEqual(no.code, 403); assert.deepStrictEqual(findEmails(no.body), []);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】授權：每次讀寫都過 _frFindMine（fid 不是憑證）');
await T('E1 ⭐⭐ fid 越權：C（與 A|B 無關）與 C（A 的好友）拿 A|B 的 fid 打 send／list ⇒ 403 friends-dm-not-friends 且 tournamentChat 零寫入', async () => {
  const seed = seedOn([structuredClone(AB), mkRow(U.A.email, U.C.email, 'accepted')]);
  const H = buildFriends(SRC, { seed });
  for (const who of [U.C, { uid: 'fZ', email: 'zed@example.com', name: 'Z' }]) {
    const s = await H.call('post', '/api/friends/dm/send', asUser(who), { fid: AB.fid, text: '偷看' });
    assert.strictEqual(s.code, 403, who.email + ' send：' + JSON.stringify(s.body)); assert.strictEqual(s.body.code, 'friends-dm-not-friends');
    const l = await H.call('get', '/api/friends/dm/list', asUser(who), {}, { fid: AB.fid });
    assert.strictEqual(l.code, 403, who.email + ' list：' + JSON.stringify(l.body));
  }
  assert.strictEqual(writesTo(H.db, 'tournamentChat'), 0, '越權請求寫進 DB 了');
  // 正常人仍可用（證明不是全部都 403）
  const realNow = Date.now; Date.now = () => NOW0;
  try { assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'ok' })).code, 200); } finally { Date.now = realNow; }
});
await T('E1m 正對照：_frFindMine 不看 a/b（只用 fid 查）⇒ E1 紅', async () => {
  const bad = mutate(SRC, 'return await c.findOne({ fid, $or: [{ a: me }, { b: me }] });', 'return await c.findOne({ fid });');
  await mutantMustBreak('fid 當憑證', async () => {
    const H = buildFriends(bad, { seed: seedOn() });
    const s = await H.call('post', '/api/friends/dm/send', asUser(U.C), { fid: AB.fid, text: '偷看' });
    assert.strictEqual(s.code, 403, 'C send 應 403');
  }, 'C send 應 403');
});
await T('E2 非 accepted：pending／rejected／關係已解除 ⇒ send 與 list 都 403、零寫入；正對照＝拿掉 accepted 檢查要紅', async () => {
  for (const st of ['pending', 'rejected', null]) {
    const seed = seedOn(st ? [mkRow(U.A.email, U.B.email, st)] : []);
    const H = buildFriends(SRC, { seed });
    const s = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'hi' });
    assert.strictEqual(s.code, 403, st + ' send：' + JSON.stringify(s.body));
    const l = await H.call('get', '/api/friends/dm/list', asUser(U.B), {}, { fid: AB.fid });
    assert.strictEqual(l.code, 403, st + ' list：' + JSON.stringify(l.body));
    assert.strictEqual(writesTo(H.db, 'tournamentChat'), 0, st + '：寫進 DB 了');
  }
  const bad = mutate(SRC, "if (cur.status !== 'accepted') return { deny: 'not-friends', cur };", '');
  await mutantMustBreak('不檢查 accepted', async () => {
    const H = buildFriends(bad, { seed: seedOn([mkRow(U.A.email, U.B.email, 'pending')]) });
    const s = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'hi' });
    assert.strictEqual(s.code, 403, 'pending send 應 403');
  }, 'pending send 應 403');
});
await T('E3 封鎖：被封鎖方 send ⇒ 200 {ok,friendsDm:1} 但零寫入、list ⇒ 403（與被解除好友一模一樣）；封鎖方 send／list ⇒ 403', async () => {
  const seed = seedOn([mkRow(U.A.email, U.B.email, 'blocked', { blockedBy: U.A.email })]);
  const H = buildFriends(SRC, { seed });
  const s = await H.call('post', '/api/friends/dm/send', asUser(U.B), { fid: AB.fid, text: '在嗎' });
  assert.strictEqual(s.code, 200, JSON.stringify(s.body)); assert.deepStrictEqual(s.body, { ok: true, friendsDm: 1 });
  assert.strictEqual(writesTo(H.db, 'tournamentChat'), 0, '被封鎖方的訊息寫進 DB 了');
  const l = await H.call('get', '/api/friends/dm/list', asUser(U.B), {}, { fid: AB.fid });
  assert.strictEqual(l.code, 403); assert.strictEqual(l.body.code, 'friends-dm-not-friends');
  // 與「關係已解除」的回應逐字相同（不洩漏封鎖）
  const H2 = buildFriends(SRC, { seed: seedOn([]) });
  const l2 = await H2.call('get', '/api/friends/dm/list', asUser(U.B), {}, { fid: AB.fid });
  assert.deepStrictEqual(l.body, l2.body, '被封鎖方看到的回應與被解除好友不同 ⇒ 洩漏封鎖');
  assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' })).code, 403);
  assert.strictEqual((await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid })).code, 403);
});
await T('E4 匿名／playerId fallback ⇒ 401（走 _frGate）；fid 格式不對 ⇒ 403（_frFindMine 回 null）', async () => {
  const H = buildFriends(SRC, { seed: seedOn() });
  assert.strictEqual((await H.call('post', '/api/friends/dm/send', {}, { fid: AB.fid, text: 'x', playerId: 'anon' })).code, 401);
  assert.strictEqual((await H.call('get', '/api/friends/dm/list', {}, {}, { fid: AB.fid })).code, 401);
  assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: 'ZZ', text: 'x' })).code, 403);
  assert.strictEqual((await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: { $ne: null } })).code, 403);
  assert.strictEqual(writesTo(H.db, 'tournamentChat'), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】限流三層 ＋ 文字正規化');
async function withClock(fn) {
  const realNow = Date.now; let t = NOW0;
  const clock = { get: () => t, add: (ms) => { t += ms; }, set: (v) => { t = v; } };
  Date.now = () => t;
  try { return await fn(clock); } finally { Date.now = realNow; }
}
await T('F1 ⭐ 1.2 秒間隔：連發第二則 429 friends-dm-rate-gap 且零寫入；1.3 秒後恢復', async () => {
  await withClock(async (clock) => {
    const H = buildFriends(SRC, { seed: seedOn() });
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '1' })).code, 200);
    clock.add(1100);
    const r = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '2' });
    assert.strictEqual(r.code, 429, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'friends-dm-rate-gap');
    assert.strictEqual(H.db.snapshot('tournamentChat').length, 1, '429 仍寫進 DB');
    clock.add(200);
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '3' })).code, 200);
    // 另一個人不受影響（per-email）
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.B), { fid: AB.fid, text: 'B' })).code, 200);
  });
});
await T('F2 ⭐ 每分鐘 20 則：第 21 則 429 friends-dm-rate-minute；一分鐘後恢復', async () => {
  await withClock(async (clock) => {
    const H = buildFriends(SRC, { seed: seedOn() });
    for (let i = 0; i < 20; i++) { clock.add(1300); assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'm' + i })).code, 200, '第 ' + (i + 1) + ' 則'); }
    clock.add(1300);
    const r = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'm21' });
    assert.strictEqual(r.code, 429, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'friends-dm-rate-minute');
    assert.strictEqual(H.db.snapshot('tournamentChat').length, 20);
    clock.add(60000);
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'm22' })).code, 200);
  });
});
await T('F3 ⭐ 每天 500 則：第 501 則 429 friends-dm-rate-day（間隔 3.1 分鐘 ⇒ 不會先撞到分鐘限）；24 小時後恢復', async () => {
  await withClock(async (clock) => {
    const H = buildFriends(SRC, { seed: seedOn() });
    for (let i = 0; i < 500; i++) { clock.add(3100); const r = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'd' + i }); assert.strictEqual(r.code, 200, '第 ' + (i + 1) + ' 則：' + JSON.stringify(r.body)); }
    clock.add(3100);
    const r = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'd501' });
    assert.strictEqual(r.code, 429, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'friends-dm-rate-day');
    assert.strictEqual(H.db.snapshot('tournamentChat').length, 500);
    clock.add(86400000);
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'd502' })).code, 200);
  });
});
await T('F3m 正對照：把 1.2 秒改 0 ⇒ F1 紅；把 20 改 999 ⇒ F2 紅；把 500 改 999 ⇒ F3 紅（三層各自被守）', async () => {
  const bad1 = mutate(SRC, 'const FR_DM_RATE_GAP_MS = 1200, FR_DM_RATE_MIN = 20, FR_DM_RATE_DAY = 500;', 'const FR_DM_RATE_GAP_MS = 0, FR_DM_RATE_MIN = 20, FR_DM_RATE_DAY = 500;');
  await mutantMustBreak('無間隔', () => withClock(async (clock) => {
    const H = buildFriends(bad1, { seed: seedOn() });
    await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '1' }); clock.add(100);
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '2' })).code, 429, '第二則應 429');
  }), '第二則應 429');
  const bad2 = mutate(SRC, 'const FR_DM_RATE_GAP_MS = 1200, FR_DM_RATE_MIN = 20, FR_DM_RATE_DAY = 500;', 'const FR_DM_RATE_GAP_MS = 1200, FR_DM_RATE_MIN = 999, FR_DM_RATE_DAY = 500;');
  await mutantMustBreak('無分鐘限', () => withClock(async (clock) => {
    const H = buildFriends(bad2, { seed: seedOn() });
    for (let i = 0; i < 21; i++) { clock.add(1300); await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'm' }); }
    assert.strictEqual(H.db.snapshot('tournamentChat').length, 20, '第 21 則應被擋');
  }), '第 21 則應被擋');
  const bad3 = mutate(SRC, 'const FR_DM_RATE_GAP_MS = 1200, FR_DM_RATE_MIN = 20, FR_DM_RATE_DAY = 500;', 'const FR_DM_RATE_GAP_MS = 1200, FR_DM_RATE_MIN = 20, FR_DM_RATE_DAY = 999;');
  await mutantMustBreak('無日限', () => withClock(async (clock) => {
    const H = buildFriends(bad3, { seed: seedOn() });
    for (let i = 0; i < 501; i++) { clock.add(3100); await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'd' }); }
    assert.strictEqual(H.db.snapshot('tournamentChat').length, 500, '第 501 則應被擋');
  }), '第 501 則應被擋');
});
await T('F4 文字：空白／只有空白 ⇒ 400 且**不吃額度**（緊接著的正常訊息 200）；\\s+ 折單空白；> 200 字截到 200；非字串當空白', async () => {
  await withClock(async (clock) => {
    const H = buildFriends(SRC, { seed: seedOn() });
    for (const t of ['', '   \n\t ', null, undefined, 123, { x: 1 }]) {
      const r = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: t });
      assert.strictEqual(r.code, 400, JSON.stringify(t) + ' ⇒ ' + JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'friends-dm-empty');
    }
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '  哈囉\n\n  世界\t！  ' })).code, 200, '400 之後立刻發正常訊息應 200（不吃額度）');
    clock.add(1300);
    assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '字'.repeat(250) })).code, 200);
    const docs = H.db.snapshot('tournamentChat').sort((x, y) => x.ts - y.ts);
    assert.strictEqual(docs[0].text, '哈囉 世界 ！'); assert.strictEqual(docs[1].text.length, 200);
    assert.strictEqual(writesTo(H.db, 'tournamentChat'), 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】開關：dm 子開關（預設 false）＋ admin dm-config');
await T('G1 ⭐ 子開關關（或缺席）⇒ send／list 503 friends-dm-disabled 且**不帶哨兵**；總開關關 ⇒ 503 friends-disabled；預設 false', async () => {
  for (const cfg of [{ _id: 'friendsConfig', enabled: true }, { _id: 'friendsConfig', enabled: true, dm: false }, { _id: 'friendsConfig', enabled: true, dm: 'true' }]) {
    const H = buildFriends(SRC, { seed: { tournamentConfig: [cfg], friendships: [structuredClone(AB)] } });
    const s = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' });
    assert.strictEqual(s.code, 503, JSON.stringify(cfg) + ' ⇒ ' + JSON.stringify(s.body)); assert.strictEqual(s.body.code, 'friends-dm-disabled');
    assert.ok(!('friendsDm' in s.body) && !('friendsApi' in s.body), '503 不得帶哨兵：' + JSON.stringify(s.body));
    const l = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid });
    assert.strictEqual(l.code, 503); assert.ok(!('friendsDm' in l.body));
    assert.strictEqual(writesTo(H.db, 'tournamentChat'), 0);
  }
  const H2 = buildFriends(SRC, { seed: { tournamentConfig: [{ _id: 'friendsConfig', enabled: false, dm: true }], friendships: [structuredClone(AB)] } });
  const s2 = await H2.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' });
  assert.strictEqual(s2.code, 503); assert.strictEqual(s2.body.code, 'friends-disabled');
  const H3 = buildFriends(SRC, { seed: { tournamentConfig: [], friendships: [structuredClone(AB)] } });
  assert.strictEqual((await H3.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' })).code, 503, '沒有設定文件 ⇒ 預設關');
});
await T('G1m 正對照：拿掉子開關檢查 ⇒ G1 紅（dm:false 時竟然 200）', async () => {
  const bad = mutate(SRC, "      if (!(await friendsDmEnabled())) { res.status(503).json({ error: '好友私聊尚未開放', code: 'friends-dm-disabled' }); return null; }\n", '');
  await mutantMustBreak('無子開關', async () => {
    const H = buildFriends(bad, { seed: { tournamentConfig: [{ _id: 'friendsConfig', enabled: true }], friendships: [structuredClone(AB)] } });
    const s = await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' });
    assert.strictEqual(s.code, 503, 'dm 關著應 503');
  }, 'dm 關著應 503');
});
await T('G2 開關順序：兩個開關都關時**不驗 token**（tournIdentity 零呼叫）；開著才驗', async () => {
  let calls = 0;
  const ti = async (req) => { calls++; return fakeTournIdentity(req); };
  const H = buildFriends(SRC, { seed: { tournamentConfig: [{ _id: 'friendsConfig', enabled: true, dm: false }], friendships: [structuredClone(AB)] }, tournIdentity: ti });
  await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' });
  await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid });
  assert.strictEqual(calls, 0, '開關關著還去驗 Firebase token（每發一次網路往返）');
  const H2 = buildFriends(SRC, { seed: seedOn(), tournIdentity: ti });
  await H2.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid });
  assert.strictEqual(calls, 1);
});
await T('G3 admin GET/POST /api/friends/admin/dm-config：非 admin 403 且開關不動；dm 非 boolean 400；POST 後立刻生效（不等 10 秒快取）；不受開關 gate', async () => {
  const H = buildFriends(SRC, { seed: { tournamentConfig: [], friendships: [structuredClone(AB)] } });
  let g = await H.call('get', '/api/friends/admin/dm-config', admin);
  assert.strictEqual(g.code, 200, JSON.stringify(g.body)); assert.deepStrictEqual([g.body.enabled, g.body.dm, g.body.friendsDm], [false, false, 1]);
  assert.strictEqual((await H.call('post', '/api/friends/admin/dm-config', asUser(U.A), { dm: true })).code, 403);
  assert.strictEqual((await H.call('post', '/api/friends/admin/dm-config', admin, { dm: 'true' })).code, 400);
  assert.strictEqual((await H.call('post', '/api/friends/admin/dm-config', admin, {})).code, 400);
  assert.strictEqual((await H.call('get', '/api/friends/admin/dm-config', admin)).body.dm, false, '非 admin／400 的 POST 不可改到開關');
  let p = await H.call('post', '/api/friends/admin/dm-config', admin, { dm: true });
  assert.strictEqual(p.code, 200); assert.strictEqual(p.body.dm, true); assert.strictEqual(p.body.enabled, false, '子開關開了不等於總開關開');
  // 總開關仍關 ⇒ 玩家端 503 friends-disabled；把總開關也打開 ⇒ 200
  assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' })).body.code, 'friends-disabled');
  await H.call('post', '/api/friends/admin/config', admin, { enabled: true });
  const realNow = Date.now; Date.now = () => NOW0;
  try { assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' })).code, 200); } finally { Date.now = realNow; }
  p = await H.call('post', '/api/friends/admin/dm-config', admin, { dm: false });
  assert.strictEqual(p.body.dm, false);
  assert.strictEqual((await H.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'y' })).code, 503, 'POST 後應立刻生效');
  const cfg = H.db.snapshot('tournamentConfig').find((d) => d._id === 'friendsConfig');
  assert.strictEqual(cfg.enabled, true, 'dm-config 不可動到 enabled'); assert.strictEqual(cfg.dm, false);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】since ⇒ 204 零 body；分頁；mine 方向');
await T('H1 ⭐ since=最後一則 ts ⇒ 204、body null、零哨兵；有更新的 ⇒ 200 只回更新的（升序）', async () => {
  const H = await convo();
  const r = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, since: String(NOW0 + 9000) });
  assert.strictEqual(r.code, 204, JSON.stringify(r.body)); assert.strictEqual(r.body, null, '204 必須零 body'); assert.strictEqual(r.ended, true, '204 要 end()');
  const r2 = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, since: String(NOW0 + 6000) });
  assert.strictEqual(r2.code, 200); assert.deepStrictEqual(r2.body.messages.map((m) => m.ts), [NOW0 + 7500, NOW0 + 9000]);
  assert.deepStrictEqual(r2.body.messages.map((m) => m.mine), [true, false], 'A 看：第 4 則是 A 發的、第 5 則是 B 發的');
  const r3 = await H.call('get', '/api/friends/dm/list', asUser(U.B), {}, { fid: AB.fid, since: String(NOW0 + 6000) });
  assert.deepStrictEqual(r3.body.messages.map((m) => m.mine), [false, true], 'B 看的 mine 應相反');
});
await T('H1m 正對照：204 改成 200 空陣列 ⇒ H1 紅', async () => {
  const bad = mutate(SRC, 'if (!docs.length) return res.status(204).end();', 'if (!docs.length) return res.json({ friendsDm: 1, messages: [] });');
  await mutantMustBreak('204 變 200', async () => {
    const H = buildFriends(bad, { seed: seedOn() });
    const r = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, since: '5' });
    assert.strictEqual(r.code, 204, '無新訊息應 204');
  }, '無新訊息應 204');
});
await T('H2 首發回最新 50 則（升序）＋ hasMore；before 分頁往前翻到底 hasMore=false；每頁 ≤ 50（硬上限）', async () => {
  const msgs = [];
  for (let i = 0; i < 120; i++) msgs.push({ _id: 'm' + i, room: 'dm:' + AB.fid, side: i % 2 ? 'b' : 'a', text: 't' + i, ts: NOW0 + i * 1000, expireAt: new Date(NOW0) });
  msgs.push({ _id: 'other', room: 'dm:' + 'deadbeefdeadbeefdeadbeef', side: 'a', text: '別人的', ts: NOW0 + 999999, expireAt: new Date(NOW0) });
  const seed = Object.assign(seedOn(), { tournamentChat: msgs });
  const H = buildFriends(SRC, { seed });
  const p1 = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid });
  assert.strictEqual(p1.code, 200); assert.strictEqual(p1.body.messages.length, 50); assert.strictEqual(p1.body.hasMore, true);
  assert.deepStrictEqual([p1.body.messages[0].text, p1.body.messages[49].text], ['t70', 't119']);
  assert.ok(!JSON.stringify(p1.body).includes('別人的'), '撈到別的 room');
  const p2 = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, before: String(p1.body.messages[0].ts) });
  assert.strictEqual(p2.body.messages.length, 50); assert.deepStrictEqual([p2.body.messages[0].text, p2.body.messages[49].text], ['t20', 't69']); assert.strictEqual(p2.body.hasMore, true);
  const p3 = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, before: String(p2.body.messages[0].ts) });
  assert.strictEqual(p3.body.messages.length, 20); assert.strictEqual(p3.body.hasMore, false);
  const s = await H.call('get', '/api/friends/dm/list', asUser(U.A), {}, { fid: AB.fid, since: String(NOW0) });
  assert.strictEqual(s.body.messages.length, 50, 'since 也要有 50 上限'); assert.strictEqual(s.body.messages[0].text, 't1');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【I】admin 總覽：> 200 段對話的讓路次數 ＋ 硬上限');
function bigSeed(convN, perConv) {
  const rows = [], chat = [];
  for (let i = 0; i < convN; i++) {
    const row = mkRow('u' + i + '@example.com', 'v' + i + '@example.com', 'accepted');
    rows.push(row);
    for (let j = 0; j < (perConv || 1); j++) chat.push({ _id: 'c' + i + '_' + j, room: 'dm:' + row.fid, side: j % 2 ? 'b' : 'a', text: 'x', ts: NOW0 + i * 10 + j, expireAt: new Date(NOW0) });
  }
  return { tournamentConfig: [{ _id: 'friendsConfig', enabled: true, dm: true }], friendships: rows, tournamentChat: chat };
}
await T('I1 ⭐⭐ 400 段對話：conversations=400、最後訊息在前、a/b/nick/count 正確；adminScanYield ticks **恰好 4**（對話迴圈 2＋friendships 反查 2）', async () => {
  const yc = { ticks: 0 };
  const H = buildFriends(SRC, { seed: bigSeed(400, 2), yieldCounter: yc });
  const r = await H.call('get', '/api/friends/admin/dm', admin);
  assert.strictEqual(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.strictEqual(r.body.conversations.length, 400); assert.strictEqual(r.body.truncated, false);
  assert.strictEqual(r.body.conversations[0].a, 'u399@example.com'); assert.strictEqual(r.body.conversations[0].count, 2); assert.strictEqual(r.body.conversations[0].nickA, '暱稱A');
  assert.strictEqual(r.body.conversations[399].b, 'v0@example.com');
  assert.strictEqual(yc.ticks, 4, '讓路次數不對：' + yc.ticks + '（資料量 400 > 200 才測得到）');
});
await T('I1m 正對照：拿掉對話迴圈的讓路 ⇒ ticks 變 2 ⇒ I1 紅', async () => {
  const bad = mutate(SRC, "          rows.push({ fid: String(g._id).slice(FR_DM_ROOM_PREFIX.length), count: g.count, first: g.first, last: g.last });\n          const w = y(++n); if (w) await w;", "          rows.push({ fid: String(g._id).slice(FR_DM_ROOM_PREFIX.length), count: g.count, first: g.first, last: g.last });");
  await mutantMustBreak('無讓路', async () => {
    const yc = { ticks: 0 };
    const H = buildFriends(bad, { seed: bigSeed(400, 1), yieldCounter: yc });
    await H.call('get', '/api/friends/admin/dm', admin);
    assert.strictEqual(yc.ticks, 4, '讓路次數不對');
  }, '讓路次數不對');
});
await T('I2 硬上限：501 段 ⇒ 回 500 段、truncated:true、cap:500（誠實回報）；關係已解除的對話 status=gone 仍列出', async () => {
  const seed = bigSeed(501, 1); seed.friendships.splice(0, 1);   // 最舊那段的關係刪掉
  const H = buildFriends(SRC, { seed });
  const r = await H.call('get', '/api/friends/admin/dm', admin);
  assert.strictEqual(r.body.conversations.length, 500); assert.strictEqual(r.body.truncated, true); assert.strictEqual(r.body.cap, 500);
  assert.ok(!r.body.conversations.some((c) => c.a === 'u0@example.com'), '被截掉的應是最舊的一段');
  const seed2 = bigSeed(3, 1); seed2.friendships.splice(0, 1);
  const H2 = buildFriends(SRC, { seed: seed2 });
  const r2 = await H2.call('get', '/api/friends/admin/dm', admin);
  const gone = r2.body.conversations.find((c) => c.status === 'gone');
  assert.ok(gone && gone.a === null && gone.count === 1, '關係已解除的對話要以 status=gone 列出：' + JSON.stringify(r2.body.conversations));
});
await T('I3 展開單一對話：最多 200 則（before 分頁）、讓路 ticks=1、hasMore；讓路 helper 缺席 ⇒ 503 fail-closed', async () => {
  const yc = { ticks: 0 };
  const H = buildFriends(SRC, { seed: bigSeed(1, 250), yieldCounter: yc });
  const fid = H.db.snapshot('friendships')[0].fid;
  const r = await H.call('get', '/api/friends/admin/dm', admin, {}, { fid });
  assert.strictEqual(r.code, 200); assert.strictEqual(r.body.messages.length, 200); assert.strictEqual(r.body.hasMore, true); assert.strictEqual(yc.ticks, 1);
  const r2 = await H.call('get', '/api/friends/admin/dm', admin, {}, { fid, before: String(r.body.messages[0].ts) });
  assert.strictEqual(r2.body.messages.length, 50); assert.strictEqual(r2.body.hasMore, false);
  const H3 = buildFriends(SRC, { seed: bigSeed(1, 1), locals: {} });
  assert.strictEqual((await H3.call('get', '/api/friends/admin/dm', admin)).code, 503);
  assert.strictEqual((await H3.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' })).code, 503);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【J】admin.html：私聊開關＋檢視 UI（DOM／行為層；兩端接線；純文字渲染）');
function blockSrc(src, anchor, endMark) {
  const i = src.indexOf(anchor); if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  const j = src.indexOf(endMark, i); if (j < 0) throw new assert.AssertionError({ message: '找不到結尾：' + endMark });
  return src.slice(i, j + endMark.length);
}
function adminHarness(adminSrc) {
  const parts = [
    'const window = { monHours: 24, SITE_VERSION_HINT: "0.0" };',
    fnSrc(adminSrc, 'function escapeHtml(s) {'),
    blockSrc(adminSrc, 'const MON_REASON_INFO = {', '\n};\n'),
    fnSrc(adminSrc, 'function monReasonInfo(reason) {'),
    fnSrc(adminSrc, 'function monMs(v) {'),
    fnSrc(adminSrc, 'function monStat(st, key) {'),
    fnSrc(adminSrc, 'function monPerfCells(r) {'),
    fnSrc(adminSrc, 'function monStaleBadge(r) {'),
    fnSrc(adminSrc, 'function monSampleBlock(dg) {'),
    fnSrc(adminSrc, 'function monCasualBlock(cg) {'),
    fnSrc(adminSrc, 'window.verLE = function (a, b) {') + ';',
    'const verLE = window.verLE;',
    fnSrc(adminSrc, 'function _dmFmtTs(ms) {'),
  ].join('\n');
  const src = [
    'const __els = {}; const __calls = []; const __alerts = []; let __confirm = true;',
    'const __el = (id) => (__els[id] || (__els[id] = { innerHTML: "" }));',
    'const document = { getElementById: (id) => __el(id) };',
    'const alert = (m) => __alerts.push(m); const confirm = () => __confirm;',
    'let __resp = {};',
    'async function api(u, options) { __calls.push({ url: u, method: (options && options.method) || "GET", body: options && options.body }); const k = Object.keys(__resp).sort((a, b) => b.length - a.length).find((x) => u.includes(x)); return k ? (typeof __resp[k] === "function" ? await __resp[k](u, options) : __resp[k]) : { error: "404" }; }',
    parts,
    fnSrc(adminSrc, 'async function loadMonitor() {'),
    fnSrc(adminSrc, 'window.monSetFriendsDm = async function (enabled, btn) {') + ';',
    fnSrc(adminSrc, 'window.monLoadDms = async function (btn) {') + ';',
    fnSrc(adminSrc, 'window.monLoadDmThread = async function (fid, before) {') + ';',
    'return { loadMonitor, monSetFriendsDm: window.monSetFriendsDm, monLoadDms: window.monLoadDms, monLoadDmThread: window.monLoadDmThread,',
    '  html: (id) => __el(id || "tab-monitor").innerHTML, calls: () => __calls.slice(), alerts: () => __alerts.slice(),',
    '  setResp: (r) => { __resp = r; }, setConfirm: (v) => { __confirm = v; } };',
  ].join('\n');
  return new Function(src)();
}
const BASE_RESP = { longpoll: { config: {} }, redact: { enabled: false }, 'clientdiag?hours': { hours: 24, byReason: [], rows: [] }, 'clientdiag?mode=casual': { hours: 24, byReason: [], rows: [] }, 'friends/admin/config': { enabled: true, friendsApi: 1, maxFriends: 100 } };
await T('J1 ⭐⭐ loadMonitor 真的多打一發 GET /api/friends/admin/dm-config、渲染 #mon-friends-dm（已啟用／關閉／讀不到）；#mon-friends 仍恰有 2 顆按鈕（兄弟不是子）', async () => {
  for (const [why, fd, expectTxt, nBtn] of [['已啟用', { enabled: true, dm: true, friendsDm: 1, retentionDays: 90 }, '已啟用', 3], ['關閉', { enabled: true, dm: false, friendsDm: 1, retentionDays: 90 }, '關閉', 3], ['舊伺服器 404', null, '讀不到', 0]]) {
    const h = adminHarness(ADMIN);
    h.setResp(Object.assign({}, BASE_RESP, fd ? { 'friends/admin/dm-config': fd } : {}));
    await h.loadMonitor();
    const gets = h.calls().filter((c) => c.url === '/api/friends/admin/dm-config' && c.method === 'GET');
    assert.strictEqual(gets.length, 1, why + '：loadMonitor 沒有打 GET /api/friends/admin/dm-config（打了：' + h.calls().map((c) => c.url).join(',') + '）');
    const $ = cheerio.load(h.html());
    assert.strictEqual($('#mon-friends-dm').length, 1, why + '：沒有 #mon-friends-dm');
    assert.ok($('#mon-friends-dm-state').text().includes(expectTxt), why + '：狀態字樣不對：' + $('#mon-friends-dm-state').text());
    assert.strictEqual($('#mon-friends-dm button').length, nBtn, why + '：按鈕數');
    assert.strictEqual($('#mon-friends button').length, 2, why + '：#mon-friends 內的按鈕數變了（test-v6286 1a 也在守）');
    assert.strictEqual($('#mon-friends #mon-friends-dm').length, 0, '必須是兄弟節點');
    if (fd) {
      assert.ok($('#mon-friends-dm button').toArray().filter((b) => /monSetFriendsDm\((true|false), this\)/.test($(b).attr('onclick') || '')).length === 2, '開關按鈕沒接 monSetFriendsDm');
      assert.ok($('#mon-friends-dm button').toArray().some((b) => /monLoadDms\(this\)/.test($(b).attr('onclick') || '')), '沒有檢視按鈕');
      assert.strictEqual($('#mon-dm-list').length + $('#mon-dm-thread').length, 2);
    }
  }
});
await T('J2 ⭐⭐ monSetFriendsDm 真的 POST /api/friends/admin/dm-config、body 只有 {dm}、成功後重讀；失敗 alert＋按鈕還原；confirm 取消 ⇒ 零請求', async () => {
  const h = adminHarness(ADMIN);
  h.setResp(Object.assign({}, BASE_RESP, { 'friends/admin/dm-config': { ok: true, dm: true, enabled: true, friendsDm: 1 } }));
  const btn = { textContent: '啟用好友私聊', disabled: false };
  await h.monSetFriendsDm(true, btn);
  const posts = h.calls().filter((c) => c.method === 'POST');
  assert.strictEqual(posts.length, 1); assert.strictEqual(posts[0].url, '/api/friends/admin/dm-config', '打錯端點：' + posts[0].url);
  assert.deepStrictEqual(JSON.parse(posts[0].body), { dm: true }, 'body 形狀');
  assert.ok(h.calls().some((c) => c.method === 'GET' && c.url === '/api/friends/admin/dm-config'), '成功後沒有重讀');
  await h.monSetFriendsDm(false, btn);
  assert.deepStrictEqual(JSON.parse(h.calls().filter((c) => c.method === 'POST')[1].body), { dm: false });
  const h2 = adminHarness(ADMIN); h2.setResp(BASE_RESP);
  const btn2 = { textContent: '關閉', disabled: false };
  await h2.monSetFriendsDm(false, btn2);
  assert.strictEqual(h2.alerts().length, 1); assert.strictEqual(btn2.disabled, false); assert.strictEqual(btn2.textContent, '關閉');
  const h3 = adminHarness(ADMIN); h3.setResp(BASE_RESP); h3.setConfirm(false);
  await h3.monSetFriendsDm(true, { textContent: 'x' });
  assert.strictEqual(h3.calls().length, 0);
});
await T('J3 ⭐⭐⭐ 兩端接線：UI 送出的 (method,path,body) 原封餵進伺服器 routes ⇒ 子開關 false→true→false；UI 的 GET dm／?fid= 也真的打到伺服器並把回應畫出來', async () => {
  const h = adminHarness(ADMIN);
  h.setResp(Object.assign({}, BASE_RESP, { 'friends/admin/dm-config': { ok: true, dm: true, enabled: true, friendsDm: 1 } }));
  await h.monSetFriendsDm(true, { textContent: 'x' }); await h.monSetFriendsDm(false, { textContent: 'x' });
  const sent = h.calls().filter((c) => c.method === 'POST');
  const S = buildFriends(SRC, { seed: { tournamentConfig: [{ _id: 'friendsConfig', enabled: true }], friendships: [structuredClone(AB)] } });
  let g = await S.call('get', sent[0].url, admin); assert.strictEqual(g.body.dm, false, '初始應為關');
  let r = await S.call('post', sent[0].url, admin, JSON.parse(sent[0].body)); assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.dm, true);
  const realNow = Date.now; Date.now = () => NOW0;
  try { assert.strictEqual((await S.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: '<img src=x onerror=alert(1)> 你好 & <b>粗</b>' })).code, 200); } finally { Date.now = realNow; }
  r = await S.call('post', sent[1].url, admin, JSON.parse(sent[1].body)); assert.strictEqual(r.body.dm, false);
  assert.strictEqual((await S.call('post', '/api/friends/dm/send', asUser(U.A), { fid: AB.fid, text: 'x' })).code, 503, '關了之後應 503');
  // 檢視：UI 打的 URL 轉交伺服器 routes，再把伺服器回應交回 UI 渲染
  const h2 = adminHarness(ADMIN);
  h2.setResp({ 'friends/admin/dm': async (u) => { const q = {}; const qs = u.split('?')[1] || ''; for (const kv of qs.split('&')) { if (!kv) continue; const [k, v] = kv.split('='); q[k] = decodeURIComponent(v); } return (await S.call('get', '/api/friends/admin/dm', admin, {}, q)).body; } });
  await h2.monLoadDms({ textContent: '📨' });
  assert.deepStrictEqual(h2.calls().map((c) => c.url), ['/api/friends/admin/dm'], '總覽打錯端點');
  let $ = cheerio.load(h2.html('mon-dm-list'));
  assert.strictEqual($('tbody tr').length, 1, '總覽沒畫出對話列：' + h2.html('mon-dm-list').slice(0, 300));
  assert.ok($('tbody tr').text().includes(U.A.email) && $('tbody tr').text().includes(U.B.email) && $('tbody tr').text().includes('1'), '列內容');
  const onclick = $('tbody tr button').attr('onclick') || '';
  const m = /monLoadDmThread\('([0-9a-f]+)', 0\)/.exec(onclick);
  assert.ok(m && m[1] === AB.fid, '展開按鈕沒帶 fid：' + onclick);
  await h2.monLoadDmThread(m[1], 0);
  assert.strictEqual(h2.calls()[1].url, '/api/friends/admin/dm?fid=' + AB.fid, '展開打錯端點：' + h2.calls()[1].url);
  $ = cheerio.load(h2.html('mon-dm-thread'));
  assert.strictEqual($('img').length, 0, '⚠⚠ 玩家訊息被當 HTML 渲染（<img onerror> 進 DOM）');
  assert.strictEqual($('b').length, 1, '玩家訊息裡的 <b> 不得變成元素（畫面上只該有 from 那一個 <b>）');
  assert.ok($.text().includes('<img src=x onerror=alert(1)> 你好 & <b>粗</b>'), '訊息要以純文字原樣顯示：' + $.text());
  assert.ok($.text().includes(U.A.email), '展開畫面要標發言者');
  // 分頁按鈕（hasMore）帶 before
  const h3 = adminHarness(ADMIN);
  h3.setResp({ 'friends/admin/dm': { friendsDm: 1, fid: AB.fid, pair: { a: 'a@x.io', b: 'b@x.io', status: 'accepted' }, messages: [{ id: '1', side: 'a', from: 'a@x.io', text: 'hi', ts: 777 }], hasMore: true } });
  await h3.monLoadDmThread(AB.fid, 0);
  const more = cheerio.load(h3.html('mon-dm-thread'))('button').attr('onclick') || '';
  assert.ok(more.includes("monLoadDmThread('" + AB.fid + "', 777)"), '載入更早按鈕沒帶 before：' + more);
  await h3.monLoadDmThread(AB.fid, 777);
  assert.strictEqual(h3.calls()[1].url, '/api/friends/admin/dm?fid=' + AB.fid + '&before=777');
  assert.strictEqual((await h3.monLoadDmThread('<script>', 0), h3.calls().length), 2, 'fid 格式不對不可發請求');
});
await T('J3m 正對照：展開畫面的 text 不經 escapeHtml ⇒ J3 紅在 img', async () => {
  const bad = mutate(ADMIN, "+ '<b>' + escapeHtml(String(m.from || ('側 ' + (m.side || '?')))) + '</b>：' + escapeHtml(String(m.text || '')) + '</div>';", "+ '<b>' + escapeHtml(String(m.from || ('側 ' + (m.side || '?')))) + '</b>：' + String(m.text || '') + '</div>';");
  await mutantMustBreak('不跳脫', async () => {
    const h = adminHarness(bad);
    h.setResp({ 'friends/admin/dm': { friendsDm: 1, fid: AB.fid, pair: null, messages: [{ id: '1', side: 'a', from: 'a@x.io', text: '<img src=x onerror=alert(1)>', ts: 1 }], hasMore: false } });
    await h.monLoadDmThread(AB.fid, 0);
    assert.strictEqual(cheerio.load(h.html('mon-dm-thread'))('img').length, 0, '⚠⚠ 玩家訊息被當 HTML 渲染');
  }, '被當 HTML 渲染');
});
await T('J4 fd 那一發經過 _ok()（舊伺服器 404 不會被當成「關閉」）；SITE_VERSION_HINT 與 version.ts 一致（不 pin 版本）', () => {
  const lm = fnSrc(ADMIN, 'async function loadMonitor() {');
  assert.ok(/fd = _ok\(_r\[7\]\)/.test(lm), 'fd 沒經過 _ok()');
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'hint ' + H + ' ≠ version.ts ' + V);
  assert.strictEqual(readFileSync(P_ADMIN).includes(Buffer.from('\r\n')), false, 'admin.html 出現 CRLF');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【K】test chain');
await T('K1 本守衛在 package.json 的 test chain', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.includes('node scripts/test-v6287-friends-dm.mjs'), '沒進 test chain');
});

console.log('\n══ v6.287 好友私聊 P0 守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
