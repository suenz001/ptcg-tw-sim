// v6.243 守衛 —— `/api/admin/stats/players/:email` 的 `recentLimit` 到底控制什麼
//
// ⚠⚠ 本版最重要的結論是「上一輪的掃描筆記寫錯了」：
//   v6.242 的 docs/changelog-internal.md【F】表把這一支列為
//   「同一份資料同時餵了『常用卡 Top 20 ＋ 勝率走勢』」。**實際上不是。**
//   ① `recentLimit` 只套在 `find(...).sort({endedAt:-1}).limit(recentLimit)` 這一條，
//      它的產物只有 `recentMatches`（畫面上的「最近 30 場對戰」表格）＝ 純顯示。
//   ② `summary`（總場次/勝/負/平/勝率）與 `topCards`（常用卡 Top 20）走的是
//      **另外兩支 mongo aggregate**，`$match` 只有 email 條件、之後沒有任何
//      `$limit`/`$skip`/`$sample` ⇒ 本來就是該玩家的**生涯全量**。
//   ③ 個人戰績頁**根本沒有「勝率走勢」這個區塊**（admin.html 的 showPlayerDetail 只有
//      總覽卡片＋最近 N 場表格＋常用卡 Top 20＋儲存的牌組）。
//   ⇒ 這一版不動聚合、不動顯示上限，只把**不變量鎖進守衛**，避免將來有人照那張錯表
//     去「修」它 —— 最可能的錯誤修法是把顯示列表也改成全量，那會讓回應體積暴增
//     （每筆 matchRecord 都帶雙方 60 張的 cardCounts）。
//
// 斷言一律到**行為**（Rule 25/32）：把 handler 從出貨檔抽出來真的跑，
// 用「這次查詢實際物化幾筆 / aggregate 的 $match 之後有沒有截斷 / 回應體積」當儀器。
// 沒有 HEAD-FAIL 的功能性缺陷可修（因為出貨碼本來就是對的），所以改用**突變測試**當正對照：
//   突變 A：在 summaryPipeline 的 $match 後插 { $limit: 30 } ⇒ ①②③ 必須翻紅
//   突變 B：把 recentMatches 換成全量 ⇒ ④⑤ 必須翻紅
// 另有一條真正的 HEAD-FAIL：⑧ 斷言 changelog-internal 已更正那句錯誤描述（BASE 上必紅）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const admRaw = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'latin1');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const verTs = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const internal = readFileSync(join(ROOT, 'docs/changelog-internal.md'), 'utf8');

/** 剝掉註解再解析（Rule 25.4）—— 註解裡出現的字串不可以被當成程式碼證據。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/([^:'"\\])\/\/.*$/gm, '$1');
function braceEnd(s, i) { let d = 0; for (let k = i; k < s.length; k++) { const c = s[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return k + 1; } } return s.length; }
function arrowOf(anchor) {
  const i = pat.indexOf(anchor);
  assert.ok(i >= 0, '找不到端點錨點：' + anchor.slice(0, 70));
  const a = pat.indexOf('async (req, res) => {', i);
  assert.ok(a > i && a - i < 200, '端點錨點後找不到 handler');
  const txt = pat.slice(a, braceEnd(pat, pat.indexOf('{', a)));
  assert.ok(txt.length > 1500, 'handler 抽太短（抽取器壞了？）: ' + txt.length);   // Rule 25：掃描器要有下限斷言
  return txt;
}

// ══ 迷你 aggregate 直譯器 ════════════════════════════════════════════════
//   只實作這兩條 pipeline 真的用到的 stage/運算子；遇到沒實作的一律 throw，
//   絕不靜默略過（否則「聚合被改壞」會長得跟「測試沒測到」一模一樣）。
const nn = (v) => (v === undefined ? null : v);
const truthy = (v) => !(v === false || v === null || v === undefined || v === 0);
const eqv = (x, y) => nn(x) === nn(y);
function fieldPath(doc, path) { let c = doc; for (const k of String(path).split('.')) { if (c === null || c === undefined) return undefined; c = c[k]; } return c; }
function evalExpr(e, doc) {
  if (typeof e === 'string') return e.startsWith('$') ? fieldPath(doc, e.slice(1)) : e;
  if (e === null || typeof e === 'number' || typeof e === 'boolean') return e;
  if (Array.isArray(e)) return e.map((x) => evalExpr(x, doc));
  const keys = Object.keys(e);
  if (keys.length === 1 && keys[0].startsWith('$')) {
    const op = keys[0], a = e[op];
    if (op === '$eq') { const [x, y] = a.map((v) => evalExpr(v, doc)); return eqv(x, y); }
    if (op === '$ne') { const [x, y] = a.map((v) => evalExpr(v, doc)); return !eqv(x, y); }
    if (op === '$gt') { const [x, y] = a.map((v) => evalExpr(v, doc)); return Number(x) > Number(y); }
    if (op === '$cond') {
      if (Array.isArray(a)) return truthy(evalExpr(a[0], doc)) ? evalExpr(a[1], doc) : evalExpr(a[2], doc);
      return truthy(evalExpr(a.if, doc)) ? evalExpr(a.then, doc) : evalExpr(a.else, doc);
    }
    if (op === '$and') return a.every((x) => truthy(evalExpr(x, doc)));
    if (op === '$or') return a.some((x) => truthy(evalExpr(x, doc)));
    if (op === '$not') { const v = Array.isArray(a) ? evalExpr(a[0], doc) : evalExpr(a, doc); return !truthy(v); }
    if (op === '$ifNull') { const v = evalExpr(a[0], doc); return (v === null || v === undefined) ? evalExpr(a[1], doc) : v; }
    if (op === '$objectToArray') { const o = evalExpr(a, doc); if (o === null || o === undefined) return null; return Object.entries(o).map(([k, v]) => ({ k, v })); }
    if (op === '$divide') { const [x, y] = a.map((v) => evalExpr(v, doc)); return Number(x) / Number(y); }
    throw new Error('迷你直譯器沒實作的聚合運算子：' + op);
  }
  const out = {}; for (const k of keys) out[k] = evalExpr(e[k], doc); return out;
}
function matchDoc(q, doc) {
  for (const [k, v] of Object.entries(q)) {
    if (k === '$or') { if (!v.some((s) => matchDoc(s, doc))) return false; continue; }
    if (k === '$and') { if (!v.every((s) => matchDoc(s, doc))) return false; continue; }
    if (k.startsWith('$')) throw new Error('迷你直譯器沒實作的 match 運算子：' + k);
    const dv = fieldPath(doc, k);
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((x) => x.startsWith('$'))) {
      for (const [op, arg] of Object.entries(v)) {
        if (op === '$in') { if (!arg.some((a) => eqv(dv, a))) return false; }
        else if (op === '$ne') { if (eqv(dv, arg)) return false; }
        else if (op === '$gte') { if (!(dv >= arg)) return false; }
        else if (op === '$type') { if (arg === 'string' && typeof dv !== 'string') return false; }
        else if (op === '$exists') { if ((dv !== undefined) !== !!arg) return false; }
        else throw new Error('迷你直譯器沒實作的 match 運算子：' + op);
      }
      continue;
    }
    if (!eqv(dv, v)) return false;
  }
  return true;
}
function projectDoc(spec, doc) {
  const out = {}; let keepId = true;
  for (const [k, v] of Object.entries(spec)) {
    if (k === '_id') { if (v === 0 || v === false) keepId = false; else out._id = doc._id; continue; }
    if (v === 1 || v === true) { const dv = fieldPath(doc, k); if (dv !== undefined) out[k] = dv; continue; }
    if (v === 0 || v === false) throw new Error('迷你直譯器沒實作 $project 排除欄位');
    const r = evalExpr(v, doc); if (r !== undefined) out[k] = r;
  }
  if (keepId && !('_id' in out) && '_id' in doc) out._id = doc._id;
  return out;
}
function groupDocs(spec, docs) {
  const map = new Map();
  for (const d of docs) {
    const id = nn(evalExpr(spec._id, d));
    const key = JSON.stringify(id);
    let acc = map.get(key);
    if (!acc) { acc = { _id: id }; for (const f of Object.keys(spec)) if (f !== '_id') acc[f] = 0; map.set(key, acc); }
    for (const [f, e] of Object.entries(spec)) {
      if (f === '_id') continue;
      const op = Object.keys(e)[0];
      if (op !== '$sum') throw new Error('迷你直譯器沒實作的 $group 累加器：' + op);
      acc[f] += Number(evalExpr(e.$sum, d)) || 0;
    }
  }
  return [...map.values()];
}
/** 跑 pipeline，並把「這次查詢的形狀」記進 spy —— 這就是儀器。 */
function runPipeline(docs, pipeline, spy) {
  const rec = { input: docs.length, afterMatch: null, truncatedBeforeGroup: null, stages: pipeline.map((s) => Object.keys(s)[0]) };
  // 儀器：第一個 $group（統計母體收斂點）之前，有沒有任何會截斷母體的 stage
  const gi = pipeline.findIndex((s) => '$group' in s);
  const head = gi < 0 ? pipeline : pipeline.slice(0, gi);
  rec.truncatedBeforeGroup = head.some((s) => '$limit' in s || '$skip' in s || '$sample' in s);
  let cur = docs.map((d) => JSON.parse(JSON.stringify(d)));
  let seenMatch = false;
  for (const st of pipeline) {
    const op = Object.keys(st)[0];
    if (op === '$match') { cur = cur.filter((d) => matchDoc(st.$match, d)); if (!seenMatch) { rec.afterMatch = cur.length; seenMatch = true; } }
    else if (op === '$project') cur = cur.map((d) => projectDoc(st.$project, d));
    else if (op === '$group') cur = groupDocs(st.$group, cur);
    else if (op === '$unwind') {
      const p = String(st.$unwind).replace(/^\$/, ''); const out = [];
      for (const d of cur) { const arr = fieldPath(d, p); if (!Array.isArray(arr)) continue; for (const el of arr) out.push({ ...d, [p]: el }); }
      cur = out;
    } else if (op === '$sort') {
      const ent = Object.entries(st.$sort);
      cur = cur.slice().sort((a, b) => { for (const [k, dir] of ent) { const x = fieldPath(a, k), y = fieldPath(b, k); if (x === y) continue; return (x > y ? 1 : -1) * dir; } return 0; });
    } else if (op === '$limit') cur = cur.slice(0, st.$limit);
    else throw new Error('迷你直譯器沒實作的 stage：' + op);
  }
  rec.out = cur.length;
  spy.agg.push(rec);
  return cur;
}

// ══ 假 mongo collection ══════════════════════════════════════════════════
function makeColl(docs, spy) {
  return {
    find(filter, opts) {
      spy.find.push({ filter, projection: opts && opts.projection, limit: Infinity });
      const rec = spy.find[spy.find.length - 1];
      const cur = { _limit: Infinity, _sort: null };
      cur.sort = (s) => { cur._sort = s; return cur; };
      cur.skip = () => cur; cur.batchSize = () => cur;
      cur.limit = (n) => { cur._limit = n; rec.limit = n; return cur; };
      cur.toArray = async () => {
        await new Promise((r) => setTimeout(r, 0));                 // 模擬真 I/O（不要在同一個 tick 交出結果）
        let rows = docs.filter((d) => matchDoc(filter, d));
        rec.matched = rows.length;
        if (cur._sort) { const ent = Object.entries(cur._sort); rows = rows.slice().sort((a, b) => { for (const [k, dir] of ent) { const x = fieldPath(a, k), y = fieldPath(b, k); if (x === y) continue; return (x > y ? 1 : -1) * dir; } return 0; }); }
        if (cur._limit !== Infinity) rows = rows.slice(0, cur._limit);
        rec.materialized = rows.length;
        spy.materialized += rows.length;
        return rows.map((d) => JSON.parse(JSON.stringify(d)));
      };
      return cur;
    },
    aggregate(pipeline) {
      return { toArray: async () => { await new Promise((r) => setTimeout(r, 0)); const out = runPipeline(docs, pipeline, spy); spy.materialized += out.length; return out; } };
    },
  };
}
const mkRes = () => { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; return r; }; r.status = (c) => { r.code = c; return r; }; return r; };

function buildHandler(arrowSrc, docs) {
  const spy = { find: [], agg: [], materialized: 0 };
  const coll = makeColl(docs, spy);
  const db = { collection: () => coll };
  const base = { db, console };
  return { h: new Function(...Object.keys(base), '"use strict"; return (' + arrowSrc + ');')(...Object.values(base)), spy };
}
const call = async (h, email, query) => {
  const res = mkRes();
  await h({ params: { email: encodeURIComponent(email) }, query: query || {} }, res);
  assert.ok(res.body && !res.body.error, 'handler 回錯誤: ' + (res.body && res.body.error));
  return res.body;
};

// ══ fixture ══════════════════════════════════════════════════════════════
//   全站 25,000 筆；目標玩家 137 場（>30 才驗得出「顯示 30、統計 137」的分野）。
//   ⚠ 目標玩家的場次**散落**在全站資料裡，且輪流當 p1/p2 —— 這樣才驗得到
//     $match 的 email 過濾與 $cond 的「取自己那一側」都真的在做事。
const ME = 'target@example.com';
const MINE = 137, TOTAL = 25000, DISPLAY = 30;
const NEWEST = 1700000000000;
const mineIdx = Array.from({ length: MINE }, (_, j) => j * 7 + 3);     // 散落
const mineRank = new Map(mineIdx.map((gi, j) => [gi, j]));             // 0 = 最新
const docs = Array.from({ length: TOTAL }, (_, i) => {
  const endedAt = NEWEST - i * 60000;
  if (!mineRank.has(i)) {
    return { _id: 'x' + i, endedAt, winner: i % 2, roomCode: 'R' + i,
             p1: { email: 'other' + i + '@x.com', name: 'O', cardCounts: { c_other: 4 } },
             p2: { email: 'other' + (i + 1) + '@x.com', name: 'O2', cardCounts: { c_other: 4 } } };
  }
  const j = mineRank.get(i);
  const isP1 = j % 2 === 0;
  const winner = (j % 5 === 0) ? null : 0;                              // j%5==0 平局；否則 p1 勝
  const myCards = { c_all: 4 };
  if (j >= DISPLAY) myCards.old_only = 2;                               // 只出現在「顯示視窗之外」的舊場
  const meSide = { email: ME, name: '我', cardCounts: myCards };
  const oppSide = { email: 'rival@x.com', name: '對手', cardCounts: { c_opp: 4 } };
  return { _id: 'm' + j, endedAt, winner, roomCode: 'R' + i,
           p1: isP1 ? meSide : oppSide, p2: isP1 ? oppSide : meSide };
});
// fixture 自身的期望值（照 fixture 定義算，不是照 pipeline 算）
let expWin = 0, expLoss = 0, expDraw = 0;
for (let j = 0; j < MINE; j++) {
  if (j % 5 === 0) expDraw++; else if (j % 2 === 0) expWin++; else expLoss++;
}
const expOldOnlyDecks = MINE - DISPLAY;

let arrow = null;
await T('前提：handler 抽得出來，且 recentLimit 只套在顯示用的 find 上', () => {
  arrow = arrowOf("app.get('/api/admin/stats/players/:email', requireFirebaseAdmin");
  assert.ok(/const recentLimit = Math\.min\(parseInt\(req\.query\.recent\) \|\| 30, 200\)/.test(arrow), 'recentLimit 的預設 30／上限 200 被動過');
  const code = stripComments(arrow);
  const uses = [...code.matchAll(/recentLimit/g)].length;
  assert.strictEqual(uses, 2, 'recentLimit 在程式碼裡出現 ' + uses + ' 次（應為：宣告 1 ＋ 顯示用 limit 1）—— 多出來的那次很可能又把統計綁回顯示上限');
  // 正對照：剝註解器要真的有剝到東西（出貨碼那行「// summary（全部對戰，不限 recentLimit）」）
  assert.ok([...arrow.matchAll(/recentLimit/g)].length === 3, '出貨碼的「不限 recentLimit」註解不見了？剝註解器的正對照失效');
  assert.ok(/\.sort\(\{ endedAt: -1 \}\)\.limit\(recentLimit\)\.toArray\(\)/.test(arrow), '顯示列表不再是 sort+limit(recentLimit)');
});

await T('① 統計母體＝該玩家生涯全量：summary 吃到 137 場（不是 30 場）', async () => {
  const { h, spy } = buildHandler(arrow, docs);
  const b = await call(h, ME);
  assert.strictEqual(b.summary.matches, MINE, 'summary.matches=' + b.summary.matches + '，應為 ' + MINE);
  assert.strictEqual(b.summary.wins, expWin, 'wins 錯');
  assert.strictEqual(b.summary.losses, expLoss, 'losses 錯');
  assert.strictEqual(b.summary.draws, expDraw, 'draws 錯');
  assert.ok(Math.abs(b.summary.winRate - expWin / (expWin + expLoss)) < 1e-12, '勝率錯');
  // 儀器：aggregate 的 $match 之後、$group 之前不得有任何截斷母體的 stage
  for (const a of spy.agg) {
    assert.strictEqual(a.afterMatch, MINE, 'aggregate $match 後只剩 ' + a.afterMatch + ' 筆');
    assert.strictEqual(a.truncatedBeforeGroup, false, 'aggregate 在 $group 之前有 $limit/$skip/$sample —— 統計母體被截斷');
  }
});

await T('② 常用卡 Top 20 吃到全量：只出現在「第 31 場以後」的卡必須進得了統計', async () => {
  const { h } = buildHandler(arrow, docs);
  const b = await call(h, ME);
  const all = b.topCards.find((c) => c.cardId === 'c_all');
  const old = b.topCards.find((c) => c.cardId === 'old_only');
  assert.ok(all, 'topCards 找不到 c_all');
  assert.strictEqual(all.deckCount, MINE, 'c_all 出現牌組數=' + all.deckCount + '，應為 ' + MINE);
  assert.strictEqual(all.totalCount, MINE * 4, 'c_all 累計張數錯');
  assert.ok(old, 'topCards 沒有 old_only —— 常用卡只看得到最近 ' + DISPLAY + ' 場（統計失真）');
  assert.strictEqual(old.deckCount, expOldOnlyDecks, 'old_only 出現牌組數=' + old.deckCount + '，應為 ' + expOldOnlyDecks);
  assert.strictEqual(old.totalCount, expOldOnlyDecks * 2, 'old_only 累計張數錯');
});

await T('③ 統計只吃這位玩家：對手／其他玩家的卡一張都不得混進來', async () => {
  const { h } = buildHandler(arrow, docs);
  const b = await call(h, ME);
  assert.ok(!b.topCards.some((c) => c.cardId === 'c_other'), '別的玩家的卡混進 topCards —— email 過濾失效');
  assert.ok(!b.topCards.some((c) => c.cardId === 'c_opp'), '對手那一側的卡混進 topCards —— $cond 取錯側');
  assert.strictEqual(b.topCards.length, 2, 'topCards 應只有 c_all / old_only 兩張，實得 ' + b.topCards.length);
});

await T('④ 顯示列表仍然只回 ' + DISPLAY + ' 筆，而且是最新的 ' + DISPLAY + ' 筆', async () => {
  const { h, spy } = buildHandler(arrow, docs);
  const b = await call(h, ME, { recent: '30' });
  assert.strictEqual(b.recentMatches.length, DISPLAY, 'recentMatches=' + b.recentMatches.length + ' 筆（顯示列表被放大了？回應體積會炸）');
  assert.deepStrictEqual(b.recentMatches.map((m) => m._id), Array.from({ length: DISPLAY }, (_, j) => 'm' + j), '不是最新的 ' + DISPLAY + ' 場');
  assert.ok(b.recentMatches.every((m) => m.p1.email === ME || m.p2.email === ME), '顯示列表混進別人的對戰');
  const f = spy.find[0];
  assert.strictEqual(f.limit, DISPLAY, 'find 的 limit=' + f.limit);
  assert.strictEqual(f.matched, MINE, 'find 的 filter 命中 ' + f.matched + ' 筆（應為該玩家的 ' + MINE + ' 筆）');
  assert.strictEqual(f.materialized, DISPLAY, 'find 物化了 ' + f.materialized + ' 筆');
});

await T('⑤ 儀器：這次查詢實際物化幾筆 —— 不可以把全站 ' + TOTAL + ' 筆讀進 node', async () => {
  const { h, spy } = buildHandler(arrow, docs);
  const b = await call(h, ME);
  // node 端物化 = 顯示 30 筆 + summary 1 列 + topCards ≤50 列
  assert.ok(spy.materialized <= DISPLAY + 1 + 50, 'node 端物化了 ' + spy.materialized + ' 筆（上限 ' + (DISPLAY + 51) + '）');
  assert.strictEqual(spy.materialized, DISPLAY + 1 + 2, '物化筆數=' + spy.materialized + '，與預期不符');
  const bytes = Buffer.byteLength(JSON.stringify(b), 'utf8');
  assert.ok(bytes < 60000, '回應體積 ' + bytes + ' bytes 過大');
  console.log('    〔量測〕node 端物化 ' + spy.materialized + ' 筆／回應 ' + bytes + ' bytes／mongo 端掃描 ' + spy.agg[0].input + ' 筆');
});

await T('⑥ ?recent 的邊界：上限 200、預設 30、非法值不得放行全量', async () => {
  const { h } = buildHandler(arrow, docs);
  assert.strictEqual((await call(h, ME, {})).recentMatches.length, DISPLAY, '沒帶 ?recent 時不是預設 30');
  assert.strictEqual((await call(h, ME, { recent: '10' })).recentMatches.length, 10, '?recent=10 失效');
  assert.strictEqual((await call(h, ME, { recent: '99999' })).recentMatches.length, Math.min(200, MINE), '?recent 沒有被壓在 200');
  assert.strictEqual((await call(h, ME, { recent: 'abc' })).recentMatches.length, DISPLAY, '?recent=abc 應落回 30');
  assert.strictEqual((await call(h, ME, { recent: '0' })).recentMatches.length, DISPLAY, '?recent=0 應落回 30');
});

await T('⑦ 事件迴圈：這支 handler 的 node 端沒有逐筆迴圈（含正對照）', async () => {
  // ⚠ 統計是在 mongod 行程裡算完才回 node ⇒ node 端沒有「每筆做一點事」的迴圈可掛 adminScanYield。
  //   Rule 33：否定型斷言必須配「真的抓得到」的正對照 —— v6.242 那兩支就是有迴圈的。
  const LOOP = /for await \(const \w+ of/;
  assert.ok(!LOOP.test(arrow), '這支 handler 出現了 cursor 逐筆迴圈 —— 那就必須改掛中央 adminScanYield');
  const detail = arrowOf("app.get('/api/admin/deck-archetype-detail', requireFirebaseAdmin");
  assert.ok(LOOP.test(detail), '正對照失效：v6.242 的明細端點應該偵測得到 cursor 迴圈（偵測器壞了）');
  assert.ok(/adminScanYield\(/.test(detail), '正對照失效：v6.242 的明細端點應該有讓路節拍');
  // 實測：跑 handler 的同時用探針量事件迴圈被延遲多久（node 端）
  //   ⚠ 假 driver 是在 node 裡跑迷你直譯器，那個成本正式站沒有（真的在 mongod 行程算完才回）。
  //     所以量兩組：全站 25,000 筆（含直譯器成本）與只餵該玩家 137 筆（≈ node 端真實成本）。
  const mine = docs.filter((d) => d.p1.email === ME || d.p2.email === ME);
  const probe = async (set) => {
    const { h } = buildHandler(arrow, set);
    let worst = 0, last = process.hrtime.bigint();
    const iv = setInterval(() => { const now = process.hrtime.bigint(); worst = Math.max(worst, Number(now - last) / 1e6 - 5); last = now; }, 5);
    const t0 = Date.now(); await call(h, ME); const ms = Date.now() - t0;
    clearInterval(iv);
    return { ms, worst };
  };
  const a = await probe(docs), b2 = await probe(mine);
  console.log('    〔量測〕全站 ' + TOTAL + ' 筆進直譯器：' + a.ms + 'ms／探針最大延遲 ' + a.worst.toFixed(1) + 'ms（含假 driver 自己的成本，正式站沒有）');
  console.log('    〔量測〕只餵該玩家 ' + mine.length + ' 筆（≈ node 端真實成本）：' + b2.ms + 'ms／探針最大延遲 ' + b2.worst.toFixed(1) + 'ms');
  assert.ok(b2.worst < 40, 'node 端阻塞 ' + b2.worst.toFixed(1) + 'ms 已達需要讓路的量級');
});

await T('⑧ 上一輪寫錯的描述已更正（BASE 必紅）', () => {
  assert.ok(!/同一份資料同時餵了「常用卡 Top 20 ＋ 勝率走勢」/.test(internal),
    'docs/changelog-internal.md 還留著「同一份資料同時餵了常用卡＋勝率走勢」的錯誤描述 —— 那會讓下一輪照著錯表去改（最可能是把顯示列表也改成全量）');
  assert.ok(!/常用卡 Top 20 \+ 勝率走勢/.test(pat.slice(pat.indexOf('// 2.2 個人戰績頁'), pat.indexOf('// 2.2 個人戰績頁') + 400)),
    'server_admin_patch.js 的 2.2 註解還寫著「勝率走勢」—— 這一段根本沒有那個區塊，註解本身就是這次誤判的源頭');
  assert.ok(/v6\.243/.test(internal), 'changelog-internal 沒有 v6.243 段落');
  assert.ok(!/勝率走勢/.test(adm.slice(adm.indexOf('window.showPlayerDetail'), adm.indexOf('window.showPlayerDetail') + 6000)),
    '個人戰績 modal 真的有「勝率走勢」？那本測試的前提要重寫');
});

await T('⑨ player-profile 的 tournamentArchives limit(200)：確認不會失真，且沒有被改小', () => {
  const prof = arrowOf("app.get('/api/admin/player-profile', requireFirebaseAdmin");
  const m = prof.match(/ARCH\.find\([\s\S]{0,900}?\)\.sort\(\{ finishedAt: -1 \}\)\.limit\((\d+)\)/);
  assert.ok(m, '找不到 tournamentArchives 的查詢（形狀被改過？）');
  assert.ok(parseInt(m[1], 10) >= 200, 'tournamentArchives 的上限被改小到 ' + m[1] + ' —— 賽事戰績會開始失真');
  assert.ok(/'players\.email': email/.test(prof), 'tournamentArchives 的查詢少了 email 過濾');
  assert.ok(!/deckEntries/.test(stripComments(prof)), 'projection 又把 deckEntries 讀回來了（讀放大主因）');
  // 判準：全站 tournamentArchives 只有 875 筆（站長 2026-08-27 在 VM 實測），
  //   且此查詢有 players.email 過濾 ⇒ 單一玩家的上界就是全站賽事數。
  //   要撞到 200 必須是「一個人參加過全站 23% 的賽事」。⇒ 現況不會失真，本版**不動**。
});

await T('⑩ ⚠ 資料保全：這一版沒有新增任何刪除 matchRecords / tournamentArchives 的路徑', () => {
  const dels = [...pat.matchAll(/(deleteOne|deleteMany|drop)\s*\(/g)].length;
  assert.ok(dels <= 60, '刪除呼叫數 ' + dels + ' 異常（本版不應新增刪除路徑）');
  assert.ok(!/matchRecords'\)\.deleteMany/.test(pat), '出現 matchRecords.deleteMany');
  assert.ok(!/tournamentArchives'\)\.delete/.test(pat), '出現 tournamentArchives 的刪除');
});

await T('⑪ 版本一致：version.ts ≥ 6.243、admin.html SITE_VERSION_HINT 同步、行尾維持 LF', () => {
  const v = (verTs.match(/VERSION = '([\d.]+)'/) || [])[1];
  assert.ok(v && parseFloat(v) >= 6.243, 'version.ts=' + v);
  const hv = (adm.match(/window\.SITE_VERSION_HINT = '([\d.]+)'/) || [])[1];
  assert.strictEqual(hv, v, 'admin.html SITE_VERSION_HINT=' + hv + ' 與 version.ts=' + v + ' 不同步');
  assert.ok(!/\r/.test(admRaw), 'admin.html 出現 CR —— 行尾必須維持 LF');
});

// ══ 突變測試（正對照：把 bug 種回去，上面的儀器必須真的翻紅）══════════════
await T('突變 A：在 summaryPipeline 的 $match 後插 { $limit: 30 } ⇒ ①②③ 必須翻紅', async () => {
  const anchor = "{ $match: { $or: [{ 'p1.email': email }, { 'p2.email': email }] } },";
  assert.strictEqual(arrow.split(anchor).length - 1, 1, '突變錨點不唯一');
  const { h, spy } = buildHandler(arrow.replace(anchor, anchor + ' { $limit: 30 },'), docs);
  const b = await call(h, ME);
  assert.strictEqual(b.summary.matches, DISPLAY, '突變後 summary 應只剩 ' + DISPLAY + ' 場，實得 ' + b.summary.matches + '（儀器對「統計被截斷」不敏感）');
  assert.ok(!b.topCards.some((c) => c.cardId === 'old_only'), '突變後 old_only 不該還在 topCards');
  assert.ok(spy.agg.every((a) => a.truncatedBeforeGroup === true), '截斷偵測器沒有偵測到插進去的 $limit');
});

await T('突變 B：把 recentMatches 換成全量 ⇒ ④⑤ 必須翻紅（回應體積確實會炸）', async () => {
  const anchor = 'recentMatches: playerMatches,';
  assert.strictEqual(arrow.split(anchor).length - 1, 1, '突變錨點不唯一');
  const mutated = arrow.replace(anchor,
    "recentMatches: await db.collection('matchRecords').find({ $or: [{ 'p1.email': email }, { 'p2.email': email }] }).sort({ endedAt: -1 }).toArray(),");
  const { h, spy } = buildHandler(mutated, docs);
  const b = await call(h, ME);
  assert.strictEqual(b.recentMatches.length, MINE, '突變後顯示列表應變成全量 ' + MINE + ' 筆');
  assert.ok(spy.materialized > DISPLAY + 51, '突變後物化筆數 ' + spy.materialized + ' 應超過上限（⑤ 的儀器不敏感）');
  const { h: h0 } = buildHandler(arrow, docs);
  const base = Buffer.byteLength(JSON.stringify(await call(h0, ME)), 'utf8');
  const big = Buffer.byteLength(JSON.stringify(b), 'utf8');
  assert.ok(big > base * 2, '突變後回應體積 ' + big + ' 只有基準 ' + base + ' 的 ' + (big / base).toFixed(1) + ' 倍');
  console.log('    〔量測〕回應體積：現況 ' + base + ' bytes／若改成全量 ' + big + ' bytes（' + (big / base).toFixed(1) + ' 倍）');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
if (fail) process.exit(1);
