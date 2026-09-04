/**
 * v6.272 守衛：Firestore 讀取減量【P1：admin 端止血】
 *
 * 站長回報：「firebase 資料量已經逼近免費額度的上限」，且吃緊的是**讀取數**
 * （官方免費額度：Document reads 50,000 per day，https://cloud.google.com/firestore/pricing）。
 *
 * 真凶三處（全在 oracle-admin/server_admin_patch.js，全是 admin 端，玩家零關係）：
 *   ① /api/admin/firebase/rooms 按「已結束 / 全部」是**無上限 .get()**
 *      —— 註解還寫「admin SDK 不吃 client quota」，那是**錯的**：
 *      Admin SDK 繞過的是**安全規則**，讀取照樣計費。
 *   ② 上面那支再對**每一間房**打一次 count() messages ⇒ 每點一次 ≈ 2 × N 次讀取。
 *   ③ /api/admin/stats 與 /api/admin/firebase/feedback **每開一次就全撈 feedbacks**。
 *
 * ⚠⚠ 本檔的紀律（歷史上踩過**九次**守衛安慰劑）：
 *   ・能實跑的一律實跑（把 handler 抽出來餵假 Firestore，用**讀取次數**當儀器）；
 *   ・截斷提示斷言到 **DOM 層**（v6.154 教訓：22 條守衛全綠但分頁根本打不開）；
 *   ・否定型一律配正對照；
 *   ・「逐位元未動」用**內嵌 sha256**（淺複製下也在守）；
 *   ・只捕捉 assert.AssertionError（其他例外一律讓它炸出來，不可被當成 PASS）；
 *   ・不 pin 死版本號當唯一判準（第九種安慰劑）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import * as cheerio from 'cheerio';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const VERTS = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const BASE_SHA = '866c4dcf61d876dd06c45e1215a50f4a4ad4f910';   // v6.271

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;   // ⚠ 非斷言例外一律讓它炸：吞掉就是安慰劑
  }
}
async function TA(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
    else throw e;
  }
}

// ── 原始碼抽取（大括號配對，不是 regex 猜）─────────────────────────────────
// ⚠ HEAD-FAIL 紀律：在 BASE 上跑時錨點不存在 ⇒ 丟 AssertionError（不是 Error），
//   讓**每一條各自紅**，而不是整支在第一個缺口就中止。
function braceEnd(src, openIdx) {
  let d = 0;
  for (let k = openIdx; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return k + 1; }
  }
  throw new assert.AssertionError({ message: '括號沒配對 @' + openIdx });
}
function arrowOf(src, anchor, minLen = 500) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new assert.AssertionError({ message: '找不到端點錨點：' + anchor.slice(0, 70) });
  const a = src.indexOf('async (req, res) => {', i);
  if (a < 0 || a - i > 400) throw new assert.AssertionError({ message: '端點錨點後找不到 handler：' + anchor.slice(0, 70) });
  const txt = src.slice(a, braceEnd(src, src.indexOf('{', a)));
  if (txt.length < minLen) throw new assert.AssertionError({ message: 'handler 抽太短（抽取器壞了？）: ' + txt.length });
  return txt;
}
function sliceBetween(src, startMark, endMark, minLen = 200) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new assert.AssertionError({ message: '找不到起點：' + startMark.slice(0, 60) });
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new assert.AssertionError({ message: '找不到終點：' + endMark.slice(0, 60) });
  const out = src.slice(a, b + endMark.length);
  if (out.length < minLen) throw new assert.AssertionError({ message: '抽太短（' + out.length + '）：' + startMark.slice(0, 40) });
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 假 Firestore（儀器：spy.reads ＝ 依**官方計費規則**算出來的讀取次數）
//   ・一般查詢：回幾份文件算幾次；「minimum charge of one document read for each query」
//   ・count()：「one read operation for each batch of up to 1000 index entries」，最低 1
//   ・缺複合索引：FAILED_PRECONDITION —— 在讀到任何文件**之前**就被拒絕 ⇒ 0 次讀取
//   出處 https://cloud.google.com/firestore/pricing
// ══════════════════════════════════════════════════════════════════════════
function makeFirestore(store, spy, opts = {}) {
  const indexes = new Set(opts.indexes || ['status|createdAt', 'status|updatedAt']);
  function resolve(rows, st) {
    let r = rows.filter((d) => st.filters.every(([f, op, v]) => {
      const x = d[f];
      if (op === '==') return x === v;
      if (op === '>') return x > v;
      if (op === '>=') return x >= v;
      return true;
    }));
    if (st.order) {
      const [f, dir] = st.order;
      r = r.slice().sort((a, b) => (dir === 'desc' ? 1 : -1) * (((b[f] ?? 0) > (a[f] ?? 0)) ? 1 : ((b[f] ?? 0) < (a[f] ?? 0)) ? -1 : 0));
    } else {
      r = r.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)));   // Firestore 無 orderBy ⇒ __name__ 順序
    }
    if (st.limit !== Infinity) r = r.slice(0, st.limit);
    return r;
  }
  function needIndex(st) {
    if (!st.filters.length || !st.order) return;
    const key = st.filters[0][0] + '|' + st.order[0];
    if (!indexes.has(key)) {
      const e = new Error('9 FAILED_PRECONDITION: The query requires an index. (' + key + ')');
      e.code = 9;
      throw e;
    }
  }
  function mkQuery(name, rows, st) {
    return {
      where: (f, op, v) => mkQuery(name, rows, { ...st, filters: [...st.filters, [f, op, v]] }),
      orderBy: (f, d) => mkQuery(name, rows, { ...st, order: [f, d || 'asc'] }),
      limit: (n) => mkQuery(name, rows, { ...st, limit: n }),
      get: async () => {
        needIndex(st);
        const docs = resolve(rows, st);
        spy.reads += Math.max(1, docs.length);
        spy.ops.push({ kind: 'get', coll: name, n: docs.length, limit: st.limit, order: st.order && st.order[0] });
        return {
          empty: docs.length === 0, size: docs.length,
          docs: docs.map((d) => ({ id: d._id, exists: true, data: () => { const c = { ...d }; delete c._id; return c; } })),
        };
      },
      count: () => ({
        get: async () => {
          needIndex(st);
          const docs = resolve(rows, st);
          spy.reads += Math.max(1, Math.ceil(docs.length / 1000));
          spy.ops.push({ kind: 'count', coll: name, n: docs.length });
          return { data: () => ({ count: docs.length }) };
        },
      }),
    };
  }
  const empty = { filters: [], order: null, limit: Infinity };
  return {
    collection(name) {
      const rows = store[name] || [];
      return Object.assign(mkQuery(name, rows, empty), {
        doc: (id) => ({
          collection: (sub) => mkQuery(name + '/' + id + '/' + sub, (store[name + '/*/' + sub] || {})[id] || [], empty),
          get: async () => { spy.reads += 1; spy.ops.push({ kind: 'doc', coll: name }); const d = rows.find((x) => x._id === id); return { exists: !!d, id, data: () => d }; },
          update: async () => { spy.writes++; },
          delete: async () => { spy.writes++; },
        }),
      });
    },
  };
}
const mkSpy = () => ({ reads: 0, writes: 0, ops: [] });
const mkRes = () => { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; return r; }; r.status = (c) => { r.code = c; return r; }; return r; };

// ══ fixture：5,000 間 Firebase 房（貼近「ended 永久保留」的形狀）══════════
const NOW = Date.now();
const ROOM_N = 5000;
const fbRooms = [];
const fbMsgs = {};
for (let i = 0; i < ROOM_N; i++) {
  const status = i < 3 ? 'playing' : (i < 8 ? 'lobby' : 'ended');
  const id = 'F' + String(i).padStart(5, '0');
  fbRooms.push({ _id: id, roomName: '房' + i, status, updatedAt: NOW - i * 60000, createdAt: NOW - i * 60000 - 900000, seats: [{ uid: 'u' + i }, null] });
  fbMsgs[id] = Array.from({ length: i % 7 }, (_, j) => ({ _id: 'm' + j, text: 'hi' }));
}
const endedTotal = fbRooms.filter((r) => r.status === 'ended').length;
assert.ok(endedTotal > 300 && endedTotal < ROOM_N, 'fixture 壞了：ended 應該遠多於 300 又不是全部（實得 ' + endedTotal + '）');
const feedbacks = Array.from({ length: 137 }, (_, i) => ({ _id: 'fb' + i, content: '意見' + i, createdAt: NOW - i * 3600000, reply: i % 4 === 0 ? '已回' : null, uid: 'u' + i }));
const unrepliedTruth = feedbacks.filter((f) => !f.reply).length;

function newStore() { return { rooms: fbRooms, feedbacks, 'rooms/*/messages': fbMsgs }; }

// ══════════════════════════════════════════════════════════════════════════
// ① 抽取＋建 handler
// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 抽取 /api/admin/firebase/rooms handler（BASE 上常數不存在 ⇒ 必紅）');
let roomsArrow = null;
T('[前提] handler 抽得出來，且 cap 常數定義在 handler **內部**（不然既有 v6.229 守衛會抽出空殼）', () => {
  roomsArrow = arrowOf(SRV, "app.get('/api/admin/firebase/rooms', requireFirebaseAdmin");
  for (const k of ['FB_ROOMS_CAP_DEFAULT', 'FB_ROOMS_CAP_MAX']) {
    assert.ok(roomsArrow.includes('const ' + k), k + ' 沒有定義在 handler 內');
  }
  assert.ok(/\.limit\(_cap\)/.test(roomsArrow), 'handler 裡沒有任何 .limit(_cap) —— 上限根本沒加');
});

function buildRooms(arrowSrc = roomsArrow, opts = {}) {
  const spy = mkSpy();
  const adminDb = makeFirestore(newStore(), spy, opts);
  const h = new Function('adminDb', 'tsToMillis', 'summarizeRoom', 'enrichSeats', 'console',
    '"use strict"; return (' + arrowSrc + ');')(
    adminDb, (v) => (typeof v === 'number' ? v : null), () => {}, async () => {}, console);
  return { h, spy };
}
const callRooms = async (h, query) => {
  const res = mkRes();
  await h({ query }, res);
  assert.ok(res.body && !res.body.error, 'handler 回錯誤: ' + (res.body && res.body.error));
  return res.body;
};

// ══════════════════════════════════════════════════════════════════════════
// ② ⭐⭐ 讀取次數：修前 vs 修後（spy 實測，不是推估）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n② 讀取次數（spy 實測；官方計費規則見檔頭）');

/** 逐字重建 v6.271 的行為（無上限 .get() ＋ 每房 count() ＋ 3 個 counts）。 */
async function baselineEnded() {
  const spy = mkSpy();
  const db = makeFirestore(newStore(), spy, {});
  const snap = await db.collection('rooms').where('status', '==', 'ended').get();
  const ids = snap.docs.map((d) => d.id);
  await Promise.all(ids.map((id) => db.collection('rooms').doc(id).collection('messages').count().get()));
  await Promise.all(['lobby', 'playing', 'ended'].map((s) => db.collection('rooms').where('status', '==', s).count().get()));
  return spy.reads;
}
let BEFORE_ENDED = 0;
await TA('[基準] 重建 v6.271 行為：點一次「已結束」的讀取次數 ≈ 2 × N', async () => {
  BEFORE_ENDED = await baselineEnded();
  assert.ok(BEFORE_ENDED >= 2 * endedTotal, '基準重建錯了（' + BEFORE_ENDED + ' < 2×' + endedTotal + '）⇒ 下面的比較會失真');
});
await TA('[基準-對照] BASE blob 的真 handler 跑出來的讀取次數與重建值同一量級（拿得到歷史時才驗）', async () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6272 ② BASE blob 對照', '同一件事由上面的行為重建涵蓋'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  if (!b.ok) { shallowSkip('v6272 ② BASE blob 對照', 'blob 讀不到'); return; }
  const baseArrow = arrowOf(b.out, "app.get('/api/admin/firebase/rooms', requireFirebaseAdmin");
  assert.ok(!/\.limit\(/.test(baseArrow.split('const rooms =')[0]),
    'BASE 的查詢竟然已經有 limit —— 那本版的前提就不成立了');
  const { h, spy } = buildRooms(baseArrow);
  await callRooms(h, { status: 'ended' });
  assert.ok(spy.reads >= 2 * endedTotal, 'BASE handler 實測只讀了 ' + spy.reads + ' 次（預期 ≥ ' + 2 * endedTotal + '）');
  assert.ok(Math.abs(spy.reads - BEFORE_ENDED) <= 3, '重建值 ' + BEFORE_ENDED + ' 與真 BASE ' + spy.reads + ' 差太多');
});

let AFTER_ENDED = 0, AFTER_ALL = 0;
await TA('★★★[核心] 點一次「✅ 已結束」的讀取次數 ≤ 310（BASE 是 ' + '2×N' + '，必紅）', async () => {
  const { h, spy } = buildRooms();
  const b = await callRooms(h, { status: 'ended' });
  AFTER_ENDED = spy.reads;
  assert.strictEqual(b.rooms.length, 300, '應該只回 300 筆，實得 ' + b.rooms.length);
  assert.ok(spy.reads <= 310, '讀取了 ' + spy.reads + ' 次 —— 上限沒生效');
  assert.ok(spy.reads < BEFORE_ENDED / 10, '只省了 ' + (BEFORE_ENDED - spy.reads) + ' 次（' + BEFORE_ENDED + '→' + spy.reads + '）⇒ 減量不成立');
});
await TA('★★★[核心] 點一次「全部」的讀取次數 ≤ 310（BASE 是整個 rooms collection）', async () => {
  const { h, spy } = buildRooms();
  const b = await callRooms(h, {});
  AFTER_ALL = spy.reads;
  assert.strictEqual(b.rooms.length, 300, '「全部」應該只回 300 筆，實得 ' + b.rooms.length);
  assert.ok(spy.reads <= 310, '讀取了 ' + spy.reads + ' 次');
  const getOps = spy.ops.filter((o) => o.kind === 'get');
  assert.strictEqual(getOps.length, 1, '清單查詢應該只有 1 發（實得 ' + getOps.length + '）');
  assert.strictEqual(getOps[0].limit, 300, '清單查詢沒有帶 limit（limit=' + getOps[0].limit + '）');
});
await TA('★★[必須是最新的那幾筆] 回的 300 筆是 updatedAt 最新的 300 筆，不是隨機 300 筆', async () => {
  const { h } = buildRooms();
  const b = await callRooms(h, {});
  const want = fbRooms.slice().sort((x, y) => y.updatedAt - x.updatedAt).slice(0, 300).map((r) => r._id).join(',');
  const got = b.rooms.map((r) => r._id).join(',');
  assert.strictEqual(got.slice(0, 80), want.slice(0, 80), '排序不是 updatedAt desc —— 站長會看到一堆老房');
  assert.strictEqual(got, want, '排序／取樣範圍不對（前 80 字相同但整體不同）');
  assert.strictEqual(b.orderedBy, 'updatedAt', 'orderedBy 應為 updatedAt，實得 ' + b.orderedBy);
});
await TA('★★[?cap=] 站長要看更多時可以放寬，但硬上限 1000 擋著', async () => {
  const { h } = buildRooms();
  assert.strictEqual((await callRooms(h, { cap: '50' })).rooms.length, 50, 'cap=50 沒生效');
  assert.strictEqual((await callRooms(h, { cap: '99999' })).rooms.length, 1000, 'cap 沒有被 FB_ROOMS_CAP_MAX 夾住');
  assert.strictEqual((await callRooms(h, { cap: '-3' })).rooms.length, 300, '負數 cap 應退回預設');
  assert.strictEqual((await callRooms(h, { cap: 'abc' })).rooms.length, 300, '亂填 cap 應退回預設');
});

// ══════════════════════════════════════════════════════════════════════════
// ③ ⭐⭐⭐ 截斷必須被標明（哨兵層）＋ admin 數字不變
// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ 截斷哨兵 ＋ admin 數字不變');
await TA('★★★[誠實] 被截斷時 truncated=true 且回報全量真值 matchedTotal（絕不靜默截斷）', async () => {
  const { h } = buildRooms();
  const b = await callRooms(h, { status: 'ended' });
  assert.strictEqual(b.capped, true, '沒有 capped 哨兵 ⇒ 新舊伺服器分不出來');
  assert.strictEqual(b.truncated, true, '截斷了卻沒回報 truncated');
  assert.strictEqual(b.matchedTotal, endedTotal, 'matchedTotal 應為全量 ' + endedTotal + '，實得 ' + b.matchedTotal);
  assert.strictEqual(b.cap, 300);
});
await TA('★★[正對照] 沒截斷時不可以誤報 truncated（否則提示變成狼來了）', async () => {
  const { h } = buildRooms();
  const b = await callRooms(h, { status: 'lobby' });
  assert.strictEqual(b.truncated, false, 'lobby 只有 5 間卻回報被截斷');
  assert.strictEqual(b.rooms.length, 5, 'lobby 應回 5 間，實得 ' + b.rooms.length);
  assert.strictEqual(b.matchedTotal, 5);
});
await TA('★★★[數字不變] 三狀態 counts 仍是**全量真值**，與清單上限無關', async () => {
  const { h } = buildRooms();
  for (const q of [{}, { status: 'ended' }, { status: 'lobby' }, { cap: '10' }]) {
    const b = await callRooms(h, q);
    assert.strictEqual(b.counts.ended, endedTotal, JSON.stringify(q) + ' 的 counts.ended 變了：' + b.counts.ended);
    assert.strictEqual(b.counts.lobby, 5, JSON.stringify(q) + ' 的 counts.lobby 變了');
    assert.strictEqual(b.counts.playing, 3, JSON.stringify(q) + ' 的 counts.playing 變了');
  }
});
await TA('★★[排序退階要誠實] 缺複合索引時退階，且**退階不多花讀取**', async () => {
  // 只有 {status,createdAt} 這條索引時：退到 createdAt，並誠實回報
  const a = buildRooms(roomsArrow, { indexes: ['status|createdAt'] });
  const ba = await callRooms(a.h, { status: 'ended' });
  assert.strictEqual(ba.orderedBy, 'createdAt', '應退階到 createdAt，實得 ' + ba.orderedBy);
  assert.ok(a.spy.reads <= 310, '退階後讀取 ' + a.spy.reads + ' 次 —— 失敗的查詢不該計費、上限也不該失效');
  // 一條複合索引都沒有時：退到 __name__（等於隨機取樣），一定要講出來
  const c = buildRooms(roomsArrow, { indexes: [] });
  const bc = await callRooms(c.h, { status: 'ended' });
  assert.strictEqual(bc.orderedBy, '__name__', '沒索引時應誠實回報 __name__，實得 ' + bc.orderedBy);
  assert.strictEqual(bc.rooms.length, 300);
  assert.ok(c.spy.reads <= 310, '無索引路徑讀取 ' + c.spy.reads + ' 次');
});

// ══════════════════════════════════════════════════════════════════════════
// ④ ⭐⭐ 每房 count()：預設不算，?msgCounts=1 才算
// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 每房 count() messages（N 次額外讀取）');
await TA('★★★ 預設**不算**訊息數 ⇒ 一次 count() 都不打（BASE 會打 N 次）', async () => {
  const { h, spy } = buildRooms();
  const b = await callRooms(h, { status: 'ended' });
  const msgCounts = spy.ops.filter((o) => o.kind === 'count' && o.coll.includes('/messages'));
  assert.strictEqual(msgCounts.length, 0, '預設仍打了 ' + msgCounts.length + ' 次每房 count()');
  assert.strictEqual(b.msgCounts, false, '回應沒說清楚訊息數沒算');
  assert.ok(b.rooms.every((r) => r.messageCount === undefined), 'messageCount 應該是 undefined（admin.html 有既有退路）');
});
await TA('★★[正對照] ?msgCounts=1 時真的算得出來，而且只算這一頁（最多 cap 次）', async () => {
  const { h, spy } = buildRooms();
  const b = await callRooms(h, { status: 'ended', msgCounts: '1' });
  const msgCounts = spy.ops.filter((o) => o.kind === 'count' && o.coll.includes('/messages'));
  assert.strictEqual(msgCounts.length, 300, '應該剛好對這 300 間房各算一次，實得 ' + msgCounts.length);
  assert.strictEqual(b.msgCounts, true);
  const sample = b.rooms.find((r) => r._id === 'F00300');
  if (sample) assert.strictEqual(sample.messageCount, fbMsgs['F00300'].length, '訊息數算錯了');
  assert.ok(b.rooms.some((r) => typeof r.messageCount === 'number'), '開了開關卻沒有任何 messageCount');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ ⭐⭐ feedbacks 快取（比照 v1.19 getUsersStatsCached）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ feedbacks 快取');
function buildFeedback() {
  const spy = mkSpy();
  const adminDb = makeFirestore(newStore(), spy, {});
  const cacheSrc = sliceBetween(SRV, '  const FEEDBACKS_TTL_MS =',
    'function invalidateFeedbacksCache() { _feedbacksCache.at = 0; _feedbacksCache.data = null; }', 600);
  const fbArrow = arrowOf(SRV, "app.get('/api/admin/firebase/feedback', requireFirebaseAdmin");
  const statsBlk = sliceBetween(SRV, '        // feedback 統計\n',
    '        } catch (e) { feedback = { enabled: true, error: e.message }; }', 400);
  const src = '"use strict";\n' + cacheSrc
    + '\nconst feedbackHandler = ' + fbArrow + ';'
    + '\nasync function statsFeedback(h24) { let feedback = { enabled: false };\n' + statsBlk + '\n return feedback; }'
    + '\nreturn { getFeedbacksCached, invalidateFeedbacksCache, feedbackHandler, statsFeedback, FEEDBACKS_TTL_MS };';
  const api = new Function('adminDb', 'tsToMillis', 'admin', 'console', src)(
    adminDb, (v) => (typeof v === 'number' ? v : null),
    { firestore: { Timestamp: { fromMillis: (m) => m } } }, console);
  return { ...api, spy };
}
await TA('[前提] feedbacks 快取三件套抽得出來（BASE 上不存在 ⇒ 必紅）', async () => {
  const f = buildFeedback();
  assert.strictEqual(typeof f.getFeedbacksCached, 'function');
  assert.strictEqual(typeof f.invalidateFeedbacksCache, 'function');
  assert.strictEqual(f.FEEDBACKS_TTL_MS, 1800000, 'TTL 應為 30 分鐘（v6.281 站長裁定），實得 ' + f.FEEDBACKS_TTL_MS);
});
await TA('★★★[核心] 開總覽 ＋ 開意見回饋分頁 5 次 ⇒ feedbacks 只被讀一輪（BASE 是每次全撈）', async () => {
  const f = buildFeedback();
  await f.statsFeedback(NOW - 86400000);
  const afterStats = f.spy.ops.filter((o) => o.kind === 'get' && o.coll === 'feedbacks').length;
  assert.strictEqual(afterStats, 1, '第一次應該撈 1 輪，實得 ' + afterStats);
  for (let i = 0; i < 5; i++) { const r = mkRes(); await f.feedbackHandler({ query: {} }, r); assert.ok(r.body.feedback.length === feedbacks.length, '快取回來的列表少了'); }
  await f.statsFeedback(NOW - 86400000);
  const total = f.spy.ops.filter((o) => o.kind === 'get' && o.coll === 'feedbacks').length;
  assert.strictEqual(total, 1, '快取沒生效：feedbacks 被全撈了 ' + total + ' 輪');
  // 沒有快取的話會是 7 輪 × 137 筆 = 959 次讀取
  const readsIfNoCache = 7 * feedbacks.length;
  assert.ok(f.spy.reads < readsIfNoCache / 3, '讀取 ' + f.spy.reads + ' 次，沒有明顯低於「不快取」的 ' + readsIfNoCache + ' 次');
});
await TA('★★★[數字不變] 未回覆數與 v6.271 的算法逐一致（正對照：自己算一遍）', async () => {
  const f = buildFeedback();
  const out = await f.statsFeedback(NOW - 86400000);
  assert.strictEqual(out.unreplied, unrepliedTruth, '未回覆數變了：' + out.unreplied + ' ≠ ' + unrepliedTruth);
  assert.strictEqual(out.total, feedbacks.length, '意見總數變了');
  assert.ok(typeof out.unrepliedAt === 'number' && out.unrepliedAt > 0, '沒有回報資料時間 ⇒ 站長不知道那是快取值');
  assert.strictEqual(out.unrepliedTruncated, false, '137 筆不該被 2000 上限截斷');
  // total / new24h 必須仍走 count()（精確、與快取無關）
  assert.ok(f.spy.ops.some((o) => o.kind === 'count' && o.coll === 'feedbacks'), 'total/new24h 沒有走 count() aggregation');
});
await TA('★★★[不可過期資料] 站長按下回覆／刪除後**立刻**重新讀（不是等 5 分鐘）', async () => {
  const f = buildFeedback();
  await f.statsFeedback(NOW - 86400000);
  const before = f.spy.ops.filter((o) => o.kind === 'get' && o.coll === 'feedbacks').length;
  f.invalidateFeedbacksCache();
  const r = mkRes(); await f.feedbackHandler({ query: {} }, r);
  const after = f.spy.ops.filter((o) => o.kind === 'get' && o.coll === 'feedbacks').length;
  assert.strictEqual(after, before + 1, '失效之後沒有重新讀（' + before + '→' + after + '）');
  assert.ok(r.body.feedback.length === feedbacks.length, '重新讀之後列表壞了');
});
T('★★[接線] reply / delete 兩支端點真的有呼叫 invalidateFeedbacksCache()', () => {
  const reply = arrowOf(SRV, "app.put('/api/admin/firebase/feedbacks/:id/reply', requireFirebaseAdmin", 300);
  const del = arrowOf(SRV, "app.delete('/api/admin/firebase/feedbacks/:id', requireFirebaseAdmin", 150);
  assert.ok(reply.length > 300 && del.length > 150, '抽取器抽到空殼（reply ' + reply.length + ' / del ' + del.length + '）');
  assert.ok(reply.includes('invalidateFeedbacksCache()'), 'reply 端點沒有讓快取失效 ⇒ 站長寫完回覆會看到舊資料');
  assert.ok(del.includes('invalidateFeedbacksCache()'), 'delete 端點沒有讓快取失效');
});
T('★[scope] 快取 helper 與它的四個消費點在**同一個 closure**（v6.269 的跨 IIFE runtime 炸彈）', () => {
  const defI = SRV.indexOf('async function getFeedbacksCached()');
  assert.ok(defI > 0, '找不到 getFeedbacksCached 定義');
  const iife = SRV.indexOf('(function registerMatchRecords()');
  assert.ok(iife > 0, '找不到 registerMatchRecords IIFE ⇒ 這條斷言失效');
  assert.ok(defI < iife, 'helper 被寫進 IIFE 裡了');
  for (const use of ['const _fbAll = await getFeedbacksCached();', 'invalidateFeedbacksCache();']) {
    let k = -1, n = 0;
    while ((k = SRV.indexOf(use, k + 1)) >= 0) { n++; assert.ok(k < iife, use + ' 的第 ' + n + ' 個消費點掉進別的 closure 了'); }
    assert.ok(n >= 2, use + ' 只找到 ' + n + ' 個消費點（掃描器壞了？）');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ ⭐ 錯誤註解已更正
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 錯誤註解更正');
T('★★ 「admin SDK 不吃 client quota」那行錯誤註解已移除，且旁邊寫清楚真相＋官方出處', () => {
  assert.ok(!SRV.includes(".get(); // v0.20: 拿掉 limit 300 — admin SDK 不吃 client quota"),
    '那行錯誤註解還掛在無上限的 .get() 旁邊');
  const i = SRV.indexOf("app.get('/api/admin/firebase/rooms', requireFirebaseAdmin");
  assert.ok(i > 0, '找不到端點');
  const head = SRV.slice(Math.max(0, i - 3000), i);
  assert.ok(/繞過的是\s*\*\*Firestore 安全規則/.test(head), '沒有寫清楚「Admin SDK 繞過的是安全規則」');
  assert.ok(/讀取照樣計費/.test(head), '沒有寫清楚「讀取照樣計費」');
  assert.ok(head.includes('https://cloud.google.com/firestore/pricing'), '沒有附官方計費文件出處');
  assert.ok(head.includes('Document reads 50,000 per day'), '沒有引用官方的免費額度數字');
  assert.ok(/batch of up to 1000 index entries/.test(head), '沒有引用官方的 count() 計費規則');
  assert.ok(/skipped document/.test(head), '沒有寫下「offset 會對跳過的每一筆計費」這條關鍵限制');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑦ ⭐⭐⭐ admin.html：截斷提示真的畫得出來（DOM 層，不是字串存在）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ admin.html DOM／行為層（v6.154 教訓）');
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  return src.slice(i, braceEnd(src, src.indexOf('{', src.indexOf(')', i))));
}
function adminHarness(mutate) {
  const parts = [
    'let statusFilter = "ended";',
    'let oracleRoomsCounts = null, oracleRoomsSrv = null, oracleRoomsPage = 1, oracleRoomsRange = "7d", oracleRoomsSearch = "";',
    'let firebaseRoomsCounts = null, firebaseRoomsSrv = null, firebaseRoomsPage = 1, firebaseRoomsMsgCounts = false;',
    'let oracleRoomsCache = [], firebaseRoomsCache = [];',
    'const ROOMS_PAGE_SIZE = 50;',
    'const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;" }[c]));',
    'const renderRoomRow = (r) => "<tr><td>" + r._id + "</td></tr>";',
    'let __apiUrls = [];',
    'let __apiResp = () => ({});',
    'async function api(u) { __apiUrls.push(u); return __apiResp(u); }',
    'const primeEmailMap = () => {};',
    'const ensureCardIndex = async () => {}; const ensureCardTags = async () => {};',
    'let currentTab = "firebase-rooms";',
    'const __els = {};',
    'const document = { getElementById: (id) => (__els[id] = __els[id] || { id, innerHTML: "" }) };',
    fnSrc(ADMIN, 'function renderRoomsTab(el, source, rooms) {'),
    fnSrc(ADMIN, 'async function loadFirebaseRooms() {'),
    'const window = {};',
    (() => {
      const k = ADMIN.indexOf('window.toggleFirebaseMsgCounts = function() {');
      if (k < 0) throw new assert.AssertionError({ message: 'admin.html 沒有 toggleFirebaseMsgCounts' });
      return ADMIN.slice(k, braceEnd(ADMIN, ADMIN.indexOf('{', k + 40))) + ';';
    })(),
  ].join('\n');
  const body = mutate ? mutate(parts) : parts;
  return new Function('"use strict";\n' + body
    + '\nreturn { renderRoomsTab, loadFirebaseRooms, toggle: window.toggleFirebaseMsgCounts,'
    + '  setResp: (f) => { __apiResp = f; }, urls: () => __apiUrls.slice(), el: (id) => __els[id],'
    + '  setSrv: (v) => { firebaseRoomsSrv = v; }, setCounts: (v) => { firebaseRoomsCounts = v; } };')();
}
const SRV_OK = { capped: true, cap: 300, truncated: true, matchedTotal: 4992, orderedBy: 'updatedAt', msgCounts: false };
const ROOMS_300 = Array.from({ length: 300 }, (_, i) => ({ _id: 'F' + i, status: 'ended', roomName: 'r' + i, updatedAt: NOW - i }));

T('[前提] admin.html 抽得出 renderRoomsTab / loadFirebaseRooms / toggleFirebaseMsgCounts（BASE 上第三個不存在 ⇒ 必紅）', () => {
  const h = adminHarness(null);
  assert.strictEqual(typeof h.renderRoomsTab, 'function');
  assert.strictEqual(typeof h.loadFirebaseRooms, 'function');
  assert.strictEqual(typeof h.toggle, 'function', 'toggleFirebaseMsgCounts 不存在');
});
T('★★★[DOM] 被截斷時，畫面上真的有 #firebase-rooms-notice，而且寫著「不是全部」＋全量筆數', () => {
  const h = adminHarness(null);
  h.setSrv(SRV_OK); h.setCounts({ lobby: 5, playing: 3, ended: 4992 });
  const el = { innerHTML: '' };
  h.renderRoomsTab(el, 'firebase', ROOMS_300);
  const $ = cheerio.load(el.innerHTML);
  assert.strictEqual($('#firebase-rooms-notice').length, 1, '畫面上根本沒有截斷提示這個容器');
  const t = $('#firebase-rooms-notice').text().replace(/\s+/g, ' ');
  assert.ok(t.length > 20, '提示容器是空的（' + t.length + ' 字）');
  assert.ok(t.includes('這不是全部'), '沒有明講「這不是全部」：' + t.slice(0, 160));
  assert.ok(/4,992/.test(t), '沒有寫出全量筆數 4,992：' + t.slice(0, 160));
  assert.ok(/300/.test(t), '沒有寫出目前顯示幾筆：' + t.slice(0, 160));
});
T('★★★[DOM／正對照] 沒截斷時不可以嚇人：要說「已全部顯示」，且不得出現「這不是全部」', () => {
  const h = adminHarness(null);
  h.setSrv({ ...SRV_OK, truncated: false, matchedTotal: 5 }); h.setCounts({ lobby: 5, playing: 0, ended: 0 });
  const el = { innerHTML: '' };
  h.renderRoomsTab(el, 'firebase', ROOMS_300.slice(0, 5));
  const t = cheerio.load(el.innerHTML)('#firebase-rooms-notice').text().replace(/\s+/g, ' ');
  assert.ok(t.includes('已全部顯示'), '沒截斷時沒有正面告知：' + t.slice(0, 160));
  assert.ok(!t.includes('這不是全部'), '沒截斷卻說「這不是全部」⇒ 狼來了');
});
T('★★★[DOM] 排序退到 __name__（等於隨機取樣）時一定要講明白', () => {
  const h = adminHarness(null);
  h.setSrv({ ...SRV_OK, orderedBy: '__name__' }); h.setCounts({ lobby: 5, playing: 3, ended: 4992 });
  const el = { innerHTML: '' };
  h.renderRoomsTab(el, 'firebase', ROOMS_300);
  const t = cheerio.load(el.innerHTML)('#firebase-rooms-notice').text().replace(/\s+/g, ' ');
  assert.ok(/依房號取樣/.test(t), '沒有講明白這不是最新的那幾筆：' + t.slice(0, 200));
  // 正對照：updatedAt 正常時不可以出現這句話
  const h2 = adminHarness(null);
  h2.setSrv(SRV_OK); h2.setCounts({ lobby: 5, playing: 3, ended: 4992 });
  const el2 = { innerHTML: '' }; h2.renderRoomsTab(el2, 'firebase', ROOMS_300);
  assert.ok(!/依房號取樣/.test(cheerio.load(el2.innerHTML)('#firebase-rooms-notice').text()), '正常排序卻報「依房號取樣」');
});
T('★★★[DOM／不可誤傷] Oracle 分頁**不得**出現這個提示（那支是 Mongo，沒有 Firestore 額度問題）', () => {
  const h = adminHarness(null);
  h.setSrv(SRV_OK);
  const el = { innerHTML: '' };
  h.renderRoomsTab(el, 'oracle', ROOMS_300);
  assert.strictEqual(cheerio.load(el.innerHTML)('#firebase-rooms-notice').length, 0, 'Oracle 分頁也長出 Firebase 的提示了');
});
T('★★[DOM／向後相容] 舊伺服器（沒有 capped 哨兵）⇒ 不畫提示，行為與 v6.271 相同', () => {
  const h = adminHarness(null);
  h.setSrv(null); h.setCounts({ lobby: 5, playing: 3, ended: 4992 });
  const el = { innerHTML: '' };
  h.renderRoomsTab(el, 'firebase', ROOMS_300);
  const $ = cheerio.load(el.innerHTML);
  assert.strictEqual($('#firebase-rooms-notice').length, 0, '舊伺服器不該畫截斷提示（會亂講）');
  assert.ok($('table').length >= 1, '舊伺服器路徑連表格都不見了');
});
await TA('★★★[行為] loadFirebaseRooms 預設**不要**訊息數；按下開關後真的重抓且帶 msgCounts=1', async () => {
  const h = adminHarness(null);
  h.setResp(() => ({ rooms: ROOMS_300, counts: { lobby: 5, playing: 3, ended: 4992 }, ...SRV_OK }));
  await h.loadFirebaseRooms();
  const u1 = h.urls().at(-1);
  assert.ok(u1.startsWith('/api/admin/firebase/rooms'), '打錯端點：' + u1);
  assert.ok(!u1.includes('msgCounts'), '預設就送了 msgCounts（那是 N 次額外讀取）：' + u1);
  assert.ok(u1.includes('status=ended'), 'status 沒送出去：' + u1);
  h.toggle();
  await new Promise((r) => setTimeout(r, 0));
  const u2 = h.urls().at(-1);
  assert.ok(u2.includes('msgCounts=1'), '按了開關卻沒有帶 msgCounts=1：' + u2);
  assert.ok(h.urls().length >= 2, '按開關沒有重抓（只打了 ' + h.urls().length + ' 發）');
});
await TA('★★[行為] capped 哨兵有被存進 firebaseRoomsSrv（不然畫面永遠不知道被截斷）', async () => {
  const h = adminHarness(null);
  h.setResp(() => ({ rooms: ROOMS_300, counts: { lobby: 5, playing: 3, ended: 4992 }, ...SRV_OK }));
  await h.loadFirebaseRooms();
  const t = cheerio.load(h.el('tab-firebase-rooms').innerHTML)('#firebase-rooms-notice').text();
  assert.ok(t.includes('這不是全部'), 'load 完之後畫面上沒有截斷提示 ⇒ 端到端沒接上：' + t.slice(0, 120));
});
T('★★[DOM] 意見回饋分頁標示資料時間與截斷（快取值不可假裝是即時值）', () => {
  const i = ADMIN.indexOf('function renderFeedback(el) {');
  assert.ok(i > 0, '找不到 renderFeedback');
  const seg = ADMIN.slice(i, braceEnd(ADMIN, ADMIN.indexOf('{', ADMIN.indexOf(')', i))));
  assert.ok(seg.includes('feedback-cache-note'), 'renderFeedback 沒有資料時間容器');
  assert.ok(seg.includes('${fbNote}'), '容器做出來了卻沒插進 innerHTML（v6.154 同型錯誤）');
  const a = seg.indexOf('const fbNote =');
  const b = seg.indexOf('el.innerHTML = `', a);
  assert.ok(a > 0 && b > a, 'fbNote 抽取器壞了（a=' + a + ', b=' + b + '）');
  const f = new Function('feedbackSrv', '"use strict"; ' + seg.slice(a, b) + ' return fbNote;');
  const $ = cheerio.load(f({ at: NOW, truncated: true }));
  assert.strictEqual($('#feedback-cache-note').length, 1, '資料時間容器沒畫出來');
  assert.ok($('#feedback-cache-note').text().includes('資料時間'), '沒寫資料時間');
  assert.ok($('#feedback-cache-note').text().includes('這不是全部'), '截斷時沒明講');
  assert.ok(!cheerio.load(f({ at: NOW, truncated: false }))('#feedback-cache-note').text().includes('這不是全部'), '沒截斷卻說「這不是全部」');
  assert.strictEqual(f(null), '', '舊伺服器（沒有 at）不該亂標');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑧ ⭐⭐ 突變測試（每一條都要紅在**指定**的那條斷言上）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ 突變測試');
async function mutRooms(from, to, probe, why) {
  const mutated = roomsArrow.replace(from, to);
  assert.notStrictEqual(mutated, roomsArrow, '突變沒套用（錨點改了？）：' + from.slice(0, 50));
  const { h, spy } = buildRooms(mutated);
  const res = mkRes();
  await h({ query: { status: 'ended' } }, res);
  assert.ok(probe(res.body || {}, spy), why);
}
await TA('M1 拿掉 .limit(_cap) ⇒「讀取次數 ≤ 310」必紅', () =>
  mutRooms(".orderBy('updatedAt', 'desc').limit(_cap).get();\n        } catch (e1) {",
    ".orderBy('updatedAt', 'desc').get();\n        } catch (e1) {",
    (b, spy) => spy.reads > 310 && b.rooms.length > 300, '拿掉上限之後讀取次數竟然還是 ≤310 ⇒ 那條斷言擋不住回歸'));
await TA('M2 把 msgCounts 改成永遠算 ⇒「預設一次 count() 都不打」必紅', () =>
  mutRooms("const _msgCounts = String(req.query.msgCounts || '') === '1';",
    'const _msgCounts = true;',
    (b, spy) => spy.ops.filter((o) => o.kind === 'count' && o.coll.includes('/messages')).length > 0,
    '改成永遠算之後守衛還是綠的'));
await TA('M3 把 truncated 寫死 false ⇒「截斷必須被標明」必紅', () =>
  mutRooms('truncated: rooms.length >= _cap || (_matchedTotal != null && _matchedTotal > rooms.length)',
    'truncated: false',
    (b) => b.truncated === false, '寫死 false 之後 truncated 竟然還是 true'));
await TA('M4 把 matchedTotal 寫成清單長度（＝謊報全量）⇒「回報全量真值」必紅', () =>
  mutRooms('const _matchedTotal = (_sq && _sq !== \'all\')', 'const _matchedTotal = rooms.length; const _unused = (_sq && _sq !== \'all\')',
    (b) => b.matchedTotal === 300 && b.matchedTotal !== endedTotal, '謊報之後 matchedTotal 竟然還是全量'));
await TA('M5 把 FEEDBACKS_TTL_MS 改成 0 ⇒「快取只讀一輪」必紅', async () => {
  const patched = SRV.replace('const FEEDBACKS_TTL_MS = 30 * 60 * 1000;', 'const FEEDBACKS_TTL_MS = 0;');
  assert.notStrictEqual(patched, SRV, '突變沒套用');
  const spy = mkSpy();
  const adminDb = makeFirestore(newStore(), spy, {});
  const cacheSrc = sliceBetween(patched, '  const FEEDBACKS_TTL_MS =',
    'function invalidateFeedbacksCache() { _feedbacksCache.at = 0; _feedbacksCache.data = null; }', 600);
  const fbArrow = arrowOf(patched, "app.get('/api/admin/firebase/feedback', requireFirebaseAdmin");
  const api = new Function('adminDb', 'tsToMillis', 'console',
    '"use strict";\n' + cacheSrc + '\nreturn ' + fbArrow + ';')(adminDb, (v) => v, console);
  for (let i = 0; i < 4; i++) { const r = mkRes(); await api({ query: {} }, r); }
  const n = spy.ops.filter((o) => o.kind === 'get' && o.coll === 'feedbacks').length;
  assert.ok(n > 1, 'TTL=0 之後仍然只撈了 ' + n + ' 輪 ⇒ 那條斷言擋不住回歸');
});
T('M6 admin.html 把 ${fbNoticeHtml} 從 innerHTML 拿掉 ⇒ DOM 斷言必紅', () => {
  const h = adminHarness((p) => p.replace('    ${fbNoticeHtml}\n', ''));
  const el = { innerHTML: '' };
  h.setSrv(SRV_OK); h.setCounts({ lobby: 5, playing: 3, ended: 4992 });
  h.renderRoomsTab(el, 'firebase', ROOMS_300);
  assert.strictEqual(cheerio.load(el.innerHTML)('#firebase-rooms-notice').length, 0,
    '把提示從 innerHTML 拿掉之後，DOM 裡竟然還找得到它 ⇒ 那條斷言是安慰劑');
});
await TA('M7 admin.html 拿掉 msgCounts 參數 ⇒「按開關要帶 msgCounts=1」必紅', async () => {
  const h = adminHarness((p) => p.replace("if (firebaseRoomsMsgCounts) _fp.set('msgCounts', '1');", ''));
  h.setResp(() => ({ rooms: ROOMS_300, counts: { lobby: 5, playing: 3, ended: 4992 }, ...SRV_OK }));
  h.toggle();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!h.urls().at(-1).includes('msgCounts=1'), '拿掉之後 URL 竟然還有 msgCounts=1');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑨ ⭐⭐ 錦標賽區塊逐位元未動（內嵌 sha256，淺複製下也在守）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ 錦標賽區塊逐位元未動');
const TOURN_TAIL_SHA256 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3' /* v6.276 重釘：報名/歸檔 6 處 additive 插入，revert-diff 見 test-v6276 */;
function tournTail(src) {
  const i = src.indexOf("app.get('/api/tournament");
  if (i < 0) throw new assert.AssertionError({ message: '找不到第一支 /api/tournament 端點' });
  return src.slice(i);
}
T('★★★[核心] 從第一支 /api/tournament 端點到檔尾（24 萬字元）sha256 與 v6.271 相同', () => {
  const cur = tournTail(SRV);
  assert.ok(cur.length > 200000, '抽到的區塊只有 ' + cur.length + ' 字元 ⇒ 下面的比對會變成恆真式');
  assert.strictEqual(createHash('sha256').update(cur, 'utf8').digest('hex'), TOURN_TAIL_SHA256,
    '錦標賽區塊被動到了（站長最高紅線：絕不可拖累錦標賽伺服）');
});
T('★★[自我驗證] 上面那條不是恆真：多一個空白 sha256 就不同', () => {
  assert.notStrictEqual(createHash('sha256').update(tournTail(SRV) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑩ 玩家端零改動 ＋ 版本一致 ＋ 行尾
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑩ 玩家端零改動 / 版本 / 行尾');
// ⚠ v6.275 修正：原本比 BASE(v6.271) vs HEAD —— v6.273/v6.274 有正當的玩家端改動之後，
//   這條在「有完整歷史」的環境就永遠紅（CI 淺複製 skip 才一直綠 ⇒ 第九種安慰劑：pin 死版本）。
//   改為比「上一版（PREV_SHA）的 blob」vs「**工作樹實際內容**」（不是 HEAD，避免建 commit 前後的雞生蛋），
//   預期差異清單 PREV_ALLOWED 由每一版主動維護：admin-only 版＝只有 version.ts；
//   動了玩家端的版本必須把動過的檔案列進來（列不齊就紅 —— 這正是守護意圖）。
const PREV_SHA = 'e3233caea4b4f3daab92b49b636bf9e6e0d03846';   // v6.305（v6.306 的上一版）
// ⭐⭐v6.306：首頁 homeChangelog 靜態檔閘門（changelog.html 檔尾訊號 0 ⇒ 連 getDoc 都不發）——
//   home-changelog-cache.ts 簽名改 (gen, fetchOverride)、+page.svelte 接線改「先等訊號」、
//   static/changelog.html 檔尾加訊號；＋ changelog 三步搬運（rules 修正對玩家有感，放一則）。
//   ⚠ 本版**沒有動** src/routes/game/**、broadcast.ts（同型、刻意留到下一版）、server_admin_patch.js。
//   ⚠ firestore.rules 不在 src/static 掃描範圍（由 test-v6306 R 段守）。
//   ⚠ 這一節只掃 src/ 與 static/ 兩個目錄、而且是**從 BASE 的檔案清單出發**逐檔比 ——
//     scripts/ 與 oracle-admin/ 底下的改動（新守衛、SITE_VERSION_HINT）**不可以**列進來。
//   ⚠ 少列一個就紅、多列一個也紅（deepStrictEqual）—— 這條清單就是「這一版動了什麼」的宣告。
const PREV_ALLOWED = [
  'src/lib/home-changelog-cache.ts',
  'src/lib/version.ts',
  'src/routes/+page.svelte',
  'static/changelog-archive.html',
  'static/changelog-bodies.html',
  'static/changelog.html',
];
T('★★[玩家端零改動] src/ 與 static/ 的工作樹內容，相對上一版只有 ' + PREV_ALLOWED.join(',') + ' 不同', () => {
  if (!hasBaseCommit(ROOT, PREV_SHA)) { shallowSkip('v6272 ⑩ 玩家端逐檔 blob 比對', '需要歷史 commit'); return; }
  const ls = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', PREV_SHA, '--', 'src', 'static'],
    { maxBuffer: 1 << 28 }).toString('utf8').trim().split('\n');
  const base = new Map(ls.map((l) => { const [meta, p] = l.split('\t'); return [p, meta.split(' ')[2]]; }));
  assert.ok(base.size > 100, '掃描器壞了？只列到 ' + base.size + ' 個玩家端檔案');
  const diff = [];
  for (const [p, sha] of base) {
    let cur = null;
    try {
      const buf = readFileSync(join(ROOT, p));
      cur = createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
    } catch { diff.push(p + '(刪除)'); continue; }
    if (cur !== sha) diff.push(p);
  }
  assert.deepStrictEqual(diff.sort(), PREV_ALLOWED, '玩家端被動到了：' + diff.join(', '));
});
T('版本一致：version.ts = admin.html SITE_VERSION_HINT', () => {
  const V = /VERSION = '([\d.]+)'/.exec(VERTS)[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'hint ' + H + ' ≠ version.ts ' + V);
});
T('admin.html 維持 LF（test-v6189 靠 "\\n};\\n" 定位函式）', () => {
  const raw = readFileSync(join(ROOT, 'oracle-admin/admin.html'));
  assert.strictEqual(raw.indexOf('\r\n'.charCodeAt(0) === 13 ? Buffer.from('\r\n') : ''), -1, 'CRLF 檢查器寫壞了');
  assert.strictEqual(raw.includes(Buffer.from('\r\n')), false, 'admin.html 出現 CRLF');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑪ ⭐⭐ 量化報告（Rule 32：效能／成本數字必須附量測腳本 —— 這支就是那支腳本）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑪ 量化：admin 點一次各分頁的 Firestore 讀取次數（spy 實測，fixture ' + ROOM_N.toLocaleString() + ' 房 / ' + feedbacks.length + ' 則意見）');
await TA('量化報告', async () => {
  const rows = [];
  rows.push(['🔥 Firebase 對戰「✅ 已結束」', BEFORE_ENDED, AFTER_ENDED]);
  rows.push(['🔥 Firebase 對戰「全部」', BEFORE_ENDED, AFTER_ALL]);
  // 總覽（stats 的 feedback 段）：修前每次全撈；修後 TTL 內 0
  const f = buildFeedback();
  await f.statsFeedback(NOW - 86400000); const s1 = f.spy.reads;
  const r0 = f.spy.reads; await f.statsFeedback(NOW - 86400000); const s2 = f.spy.reads - r0;
  rows.push(['📊 總覽 /api/admin/stats（feedback 段）第 1 次', 2 + feedbacks.length, s1]);
  rows.push(['📊 總覽 /api/admin/stats（feedback 段）第 2 次起（5 分鐘內）', 2 + feedbacks.length, s2]);
  const g = buildFeedback();
  const rr = mkRes(); await g.feedbackHandler({ query: {} }, rr); const d1 = g.spy.reads;
  const b0 = g.spy.reads; const rr2 = mkRes(); await g.feedbackHandler({ query: {} }, rr2); const d2 = g.spy.reads - b0;
  rows.push(['💬 意見回饋分頁 第 1 次', feedbacks.length, d1]);
  rows.push(['💬 意見回饋分頁 第 2 次起（5 分鐘內）', feedbacks.length, d2]);
  console.log('      ┌─ 分頁 ────────────────────────────────────────┬── 修前 ──┬── 修後 ──┬── 省下 ──┐');
  for (const [n, a, b] of rows) {
    console.log('      │ ' + n.padEnd(44) + ' │ ' + String(a).padStart(8) + ' │ ' + String(b).padStart(8)
      + ' │ ' + (a > 0 ? (100 * (a - b) / a).toFixed(1) + '%' : '-').padStart(8) + ' │');
  }
  console.log('      └───────────────────────────────────────────────┴──────────┴──────────┴──────────┘');
  console.log('      ⚠ 修前的「已結束」是 2 × N（N = 已結束房數，永久保留 ⇒ 只會越長越大）；修後有上界 303。');
  console.log('      ⚠ 官方免費額度 50,000 讀/日（https://cloud.google.com/firestore/pricing）。');
  assert.ok(AFTER_ENDED > 0 && s1 > 0 && d1 > 0, '量測器壞了：修後讀取次數是 0 ⇒ 上面的表都是假的');
  // ⚠ 總覽第 2 次還剩 2 次，是**刻意保留**的 total / new24h 兩發 count()
  //   （精確值、算法一字未動）；真正省掉的是「把 feedbacks 整包撈回來」那一段。
  assert.strictEqual(s2, 2, '總覽第 2 次應剩下 total/new24h 兩發 count()，實得 ' + s2);
  assert.strictEqual(d2, 0, '意見回饋第 2 次應該 0 次讀取（快取），實得 ' + d2);
  assert.ok(AFTER_ENDED < BEFORE_ENDED / 10 && s2 < s1 / 10 && d2 === 0, '量級檢核失敗：減量沒有到一個數量級');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
if (fail) process.exit(1);
