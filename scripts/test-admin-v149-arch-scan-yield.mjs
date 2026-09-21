// server patch v1.49 守衛：admin 原型搜尋不可卡住全站事件迴圈（錦標賽 lag 實錄）
//
// 實錄（站長回報「今天錦標賽 lag」；nginx ptcg-time.log，UTC）：
//   13:22:13／13:35:40 —— admin `/api/admin/oracle/rooms?status=ended&range=7d&q=未分類` 花 1.235／1.273 秒，
//   **同一秒**全站其他請求（錦標賽 state／event／chat、休閒房輪詢，共 3＋20 筆）全部在 node 裡等了 1.00～1.06 秒。
//   ⇒ v1.46 的原型搜尋 `.limit(5000).toArray()` 後同步逐座位分類，整段沒讓出事件迴圈（違反 Rule 30／v6.242）。
//   v1.48 的對戰歷史原型搜尋是同一個寫法。
// 修法：兩個端點共用中央 `_archetypeScanIds`（cursor 逐筆＋每 200 筆 adminScanYield 讓路＋邊掃邊分類）。
// 另加 `[loop-lag]`：事件迴圈遲到 ≥ 300ms 印一行（自帶 ISO 時間），讓 17:44:13 那種找不到元兇的卡頓查得到。
//
// 驗法：抽真的分類核心＋端點，用「可 async 迭代、每筆都是已解決 promise」的假游標（＝真 mongodb 一批之內的行為），
//   掃描期間另跑一條 setImmediate 探針，數探針在掃描中被執行幾次（沒讓路 ⇒ 0～1 次）。
// 【HEAD-FAIL】BASE（v1.48）：B1～B4、C1～C3 紅。
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = normEol(readFileSync(resolve(ROOT, process.env.V149_PATCH || 'oracle-admin/server_admin_patch.js'), 'utf8'));

let pass = 0, fail = 0; const failed = [];
async function T(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; failed.push(name.split(' ')[0]); console.log('  FAIL ' + name + ' :: ' + (e && e.message)); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function sliceBetween(src, a, b, what) {
  const s = src.indexOf(a); ok(s >= 0, '抽不到 ' + what);
  const e = src.indexOf(b, s); ok(e > s, '抽不到 ' + what + '（終點）');
  return src.slice(s, e);
}
function extractAppGet(src, needle, what) {
  const g = src.indexOf(needle); ok(g >= 0, '抽不到 ' + what);
  let i = src.indexOf('{', g), depth = 0, end = -1;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } } }
  ok(end > 0, what + ' 大括號配對失敗');
  const close = src.indexOf(');', end); ok(close > 0, what + ' 收尾');
  return src.slice(g, close + 2);
}
function extractYield(src) {
  const i = src.indexOf('const ADMIN_SCAN_YIELD_EVERY'); ok(i >= 0, '抽不到 ADMIN_SCAN_YIELD_EVERY');
  const j = src.indexOf('\n  }', src.indexOf('function adminScanYield', i)); ok(j > i, '抽不到 adminScanYield');
  return src.slice(i, j + 4);
}

// ── 假資料：60 張牌表、規則 3 條（分類成本與線上同級）──
const NAMEMAP = [];
for (let i = 0; i < 400; i++) NAMEMAP.push([String(1000 + i), '卡' + i]);
const RULES = [
  { _id: 'r1', name: '雙龍特調', includes: ['卡1'], enabled: true, priority: 1 },
  { _id: 'r2', name: '沙奈朵', includes: ['卡3'], excludes: ['卡4'], enabled: true, priority: 2 },
  { _id: 'r3', name: '密勒頓', includes: ['卡5', '卡6', '卡7'], enabled: true, priority: 3 },
];
const deck = (seed) => Array.from({ length: 20 }, (_, k) => ({ cardId: String(1000 + ((seed * 7 + k * 13) % 400)), count: 3 }));
const N = 5000;
const ROOMS = Array.from({ length: N }, (_, i) => ({ _id: 'R' + i, status: 'ended', updatedAt: Date.now() - i * 10, seats: [{ uid: 'a', deckEntries: deck(i) }, { uid: 'b', deckEntries: deck(i + 1) }] }));
const MRS = Array.from({ length: N }, (_, i) => ({ _id: 'M' + i, roomCode: 'X' + i, endedAt: Date.now() - i * 10,
  p1: { cardCounts: Object.fromEntries(deck(i).map((e) => [e.cardId, 3])) }, p2: { cardCounts: Object.fromEntries(deck(i + 2).map((e) => [e.cardId, 3])) } }));

// 假游標：可 async 迭代，而且每一筆 next() 都是**已解決**的 promise（真 mongodb 在同一批之內就是這樣）
// ⇒ 只靠 `for await` 不會讓出事件迴圈；必須靠 setImmediate 讓路。toArray 也支援（BASE 用它）。
function makeCursor(docs, spy) {
  const st = { filter: null, sortSpec: null, lim: Infinity, batch: null };
  const cur = {
    sort(s) { st.sortSpec = s; return cur; }, skip() { return cur; },
    limit(n) { st.lim = n; return cur; }, batchSize(n) { st.batch = n; spy.batchSize = n; return cur; },
    async toArray() { spy.toArray++; return docs.slice(0, st.lim === Infinity ? undefined : st.lim).map((d) => JSON.parse(JSON.stringify(d))); },
    [Symbol.asyncIterator]() {
      spy.iter++;
      let i = 0; const lim = st.lim;
      return { next() { if (i >= docs.length || i >= lim) return Promise.resolve({ done: true }); return Promise.resolve({ done: false, value: docs[i++] }); },
        return() { return Promise.resolve({ done: true }); } };
    },
  };
  return cur;
}
function makeDb(roomDocs, mrDocs, spy) {
  const filterDocs = (docs, f) => docs.filter((d) => !f || !f.status || d.status === f.status);
  return {
    collection: (n) => ({
      find: (filter, opts) => {
        const docs = n === 'rooms' ? filterDocs(roomDocs, filter) : (n === 'matchRecords' ? mrDocs : []);
        spy.finds.push({ n, filter, opts });
        // 非原型掃描的查詢（列表本身）走小資料：回空，避免干擾量測
        const isScan = opts && opts.projection && (opts.projection['seats.deckEntries'] === 1 || opts.projection['p1.cardCounts'] === 1);
        return makeCursor(isScan ? docs : [], isScan ? spy : { finds: [], toArray: 0, iter: 0 });
      },
      countDocuments: async () => 0,
      aggregate: () => ({ toArray: async () => [] }),
      createIndex: async () => 'ok',
    }),
  };
}
function build(patchSrc, spy, withYield = true) {
  const coreFns = sliceBetween(patchSrc, 'function deckToSets(cardCounts, nameMap) {', '\n    function sanitizeRule', '分類核心');
  const start = patchSrc.indexOf('const _roomArchCache = new Map();'); ok(start >= 0, '抽不到 _roomArchCache');
  const ep = extractAppGet(patchSrc, "app.get('/api/rooms-archetypes'", '大廳原型端點');
  const archBlock = patchSrc.slice(start, patchSrc.indexOf(ep) + ep.length);
  const roomsEp = extractAppGet(patchSrc, "app.get('/api/admin/oracle/rooms',", 'admin 房間端點');
  const mrEp = extractAppGet(patchSrc, "app.get('/api/admin/match-records',", '對戰歷史端點');
  const handlers = {};
  const app = { locals: {}, get: (p, ...rest) => { handlers[p] = rest[rest.length - 1]; } };
  const nameMap = new Map(NAMEMAP);
  new Function('app', 'db', 'getCardNameMap', 'getEnabledRulesCached', 'summarizeRoom', 'enrichSeats', 'requireFirebaseAdmin',
    (withYield ? extractYield(patchSrc) + '\n' : '') + coreFns + '\n' + archBlock + '\n' + roomsEp + '\n' + mrEp)(
    app, makeDb(ROOMS, MRS, spy), async () => nameMap, async () => RULES, (r) => r, async () => {}, () => {});
  return handlers;
}
async function callWithProbe(h, query) {
  let probes = 0, stop = false;
  const probe = () => { if (stop) return; probes++; setImmediate(probe); };
  setImmediate(probe);
  let out = null; const res = { json: (x) => { out = x; return res; }, status: () => res };
  await h({ query }, res);
  stop = true;
  ok(out && !out.error, '端點回錯誤：' + (out && out.error));
  return { out, probes };
}

console.log('\n【A】前提');
await T('A1 抽得出分類核心、兩個端點與 adminScanYield（掃描器下限）', () => {
  const spy = { finds: [], toArray: 0, iter: 0 };
  const h = build(PATCH, spy);
  ok(typeof h['/api/admin/oracle/rooms'] === 'function' && typeof h['/api/admin/match-records'] === 'function', '端點沒註冊');
});

console.log('\n【B】掃描期間必須讓出事件迴圈（5000 筆 ⇒ 至少讓路 20 次）');
await T('B1 ⭐⭐⭐【HEAD-FAIL】🎮 Oracle 對戰「已結束＋搜 未分類」：探針在掃描期間跑得到（≥ 20 次）', async () => {
  const spy = { finds: [], toArray: 0, iter: 0 };
  const h = build(PATCH, spy)['/api/admin/oracle/rooms'];
  const { out, probes } = await callWithProbe(h, { status: 'ended', range: 'all', page: '1', pageSize: '50', q: '未分類' });
  ok(out.archScan && out.archScan.scanned === N, '沒有掃完 5000 間：' + JSON.stringify(out.archScan));
  ok(probes >= 20, '掃描期間探針只跑了 ' + probes + ' 次 ⇒ 整段卡住事件迴圈（全站其他請求都得等）');
});
await T('B2 ⭐⭐⭐【HEAD-FAIL】📜 對戰歷史「搜 未分類」：探針在掃描期間跑得到（≥ 20 次）', async () => {
  const spy = { finds: [], toArray: 0, iter: 0 };
  const h = build(PATCH, spy)['/api/admin/match-records'];
  const { out, probes } = await callWithProbe(h, { limit: '50', q: '未分類' });
  ok(out.archScan && out.archScan.scanned === N, '沒有掃完 5000 筆：' + JSON.stringify(out.archScan));
  ok(probes >= 20, '掃描期間探針只跑了 ' + probes + ' 次 ⇒ 整段卡住事件迴圈');
});
await T('B3 ⭐⭐【HEAD-FAIL】正式游標路徑：用 async 迭代＋batchSize 200，不可 toArray 整包拉進來', async () => {
  const spy = { finds: [], toArray: 0, iter: 0 };
  const hs = build(PATCH, spy);
  await callWithProbe(hs['/api/admin/oracle/rooms'], { status: 'ended', range: 'all', page: '1', pageSize: '50', q: '未分類' });
  await callWithProbe(hs['/api/admin/match-records'], { limit: '50', q: '未分類' });
  ok(spy.iter === 2, '原型掃描沒有走游標逐筆（iter=' + spy.iter + '）');
  ok(spy.batchSize === 200, 'batchSize 應為 200，實得 ' + spy.batchSize);
  ok(spy.toArray === 0, '原型掃描仍呼叫了 toArray（整包拉進記憶體再同步分類）');
});
await T('B4 ⭐【HEAD-FAIL】兩個端點共用同一支中央 _archetypeScanIds（Rule 38：不各寫一份）', () => {
  const rooms = extractAppGet(PATCH, "app.get('/api/admin/oracle/rooms',", 'admin 房間端點');
  const mr = extractAppGet(PATCH, "app.get('/api/admin/match-records',", '對戰歷史端點');
  ok(rooms.includes('_archetypeScanIds') && mr.includes('_archetypeScanIds'), '有端點沒走中央 helper');
  ok(!/\.limit\(ROOMS_ARCH_SCAN_CAP\)\.toArray\(\)/.test(rooms) && !/\.limit\(MR_ARCH_SCAN_CAP\)\.toArray\(\)/.test(mr), '還有 limit(CAP).toArray() 殘留');
});
await T('B5 正確性不變：命中結果與「不讓路的同步版」逐筆相同（讓路不能改變答案）', async () => {
  const spy = { finds: [], toArray: 0, iter: 0 };
  const h = build(PATCH, spy)['/api/admin/oracle/rooms'];
  const { out } = await callWithProbe(h, { status: 'ended', range: 'all', page: '1', pageSize: '50', q: '雙龍' });
  // 同步參考答案：直接用抽出來的核心逐間分類
  const coreFns = sliceBetween(PATCH, 'function deckToSets(cardCounts, nameMap) {', '\n    function sanitizeRule', '分類核心');
  const as = PATCH.indexOf('    function archetypeNameOf(entries, nameMap, rules) {'); ok(as >= 0, '抽不到 archetypeNameOf');
  let ai = PATCH.indexOf('{', as), ad = 0, ae = -1;
  for (; ai < PATCH.length; ai++) { if (PATCH[ai] === '{') ad++; else if (PATCH[ai] === '}') { ad--; if (ad === 0) { ae = ai + 1; break; } } }
  const arch = PATCH.slice(as, ae);
  const f = new Function('app', 'db', 'getCardNameMap', 'getEnabledRulesCached', coreFns + '\n' + arch + '\nreturn archetypeNameOf;')({ locals: {}, get() {}, post() {} }, null, async () => new Map(), async () => []);
  const nm = new Map(NAMEMAP);
  const want = ROOMS.filter((r) => r.seats.some((s) => { const a = f(s.deckEntries, nm, RULES); return a != null && a.includes('雙龍'); })).length;
  ok(want > 0 && want < N, '參考答案不具鑑別度：' + want);
  ok(out.archScan.matched === want, '讓路版命中 ' + out.archScan.matched + '，同步參考 ' + want);
});

console.log('\n【C】[loop-lag] 事件迴圈卡頓紀錄');
function loadLag(src) {
  const s = src.indexOf('(function startLoopLagLog() {'); if (s < 0) return null;
  const e = src.indexOf('})();', s); ok(e > s, 'startLoopLagLog 收尾');
  return src.slice(s, e + 5);
}
await T('C1 ⭐【HEAD-FAIL】遲到 ≥ 300ms 印一行（含 ISO 時間與毫秒數）；遲到 250ms 不印', () => {
  const body = loadLag(PATCH); ok(body, '找不到 startLoopLagLog');
  let tick = null, unref = false; const clock = { t: 1_000_000 }; const logs = [];
  new Function('setInterval', 'Date', 'console', body)(
    (fn, ms) => { tick = fn; ok(ms === 500, '節拍應為 500ms'); return { unref() { unref = true; } }; },
    Object.assign(function (x) { return new globalThis.Date(x); }, { now: () => clock.t }),
    { warn: (m) => logs.push(m), log() {} });
  ok(tick && unref, '沒有排計時器或沒 unref（會擋住行程結束）');
  clock.t += 500; tick(); ok(logs.length === 0, '準時也印了');
  clock.t += 750; tick(); ok(logs.length === 0, '遲到 250ms 不該印');
  clock.t += 1800; tick();
  ok(logs.length === 1 && /\[loop-lag\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z 事件迴圈卡住約 1300ms/.test(logs[0]), JSON.stringify(logs));
});
await T('C2 【HEAD-FAIL】正對照：判準真的量得到（把門檻調到 5000ms 就不印 ⇒ 上一條不是恆真）', () => {
  const body = loadLag(PATCH); ok(body, '找不到 startLoopLagLog');
  const mut = body.replace('LAG_WARN_MS = 300', 'LAG_WARN_MS = 5000');
  ok(mut !== body, '突變錨點失效');
  let tick = null; const clock = { t: 0 }; const logs = [];
  new Function('setInterval', 'Date', 'console', mut)((fn) => { tick = fn; return {}; },
    Object.assign(function (x) { return new globalThis.Date(x); }, { now: () => clock.t }), { warn: (m) => logs.push(m) });
  clock.t += 2300; tick();
  ok(logs.length === 0, '門檻調高後仍印 ⇒ 判準沒有在看遲到量');
});
await T('C3 【HEAD-FAIL】放在外層作用域、只啟動一次（不在任何端點或 IIFE 內重複註冊）', () => {
  ok((PATCH.match(/\(function startLoopLagLog\(\) \{/g) || []).length === 1, '應恰好一處');
  const i = PATCH.indexOf('(function startLoopLagLog() {');
  ok(PATCH.lastIndexOf('function adminScanYield(n)', i) > 0 && i - PATCH.lastIndexOf('function adminScanYield(n)', i) < 3000, '不在 adminScanYield 旁（外層作用域）');
});

console.log('\n【D】突變');
await T('D1 突變：拿掉讓路（_archYield 恆回 null）⇒ B1 紅', async () => {
  const m = PATCH.replace(/const _archYield = \(n\) => \(\(typeof adminScanYield === 'function'\)\n\s*\? adminScanYield\(n\)\n\s*: \(\(n % 200 !== 0\) \? null : new Promise\(\(r\) => setImmediate\(r\)\)\)\);/, 'const _archYield = (n) => null;');
  ok(m !== PATCH, '突變錨點失效');
  const spy = { finds: [], toArray: 0, iter: 0 };
  const h = build(m, spy)['/api/admin/oracle/rooms'];
  const { probes } = await callWithProbe(h, { status: 'ended', range: 'all', page: '1', pageSize: '50', q: '未分類' });
  ok(probes < 20, '突變存活（探針 ' + probes + ' 次）—— 探針量不到讓路');
});

console.log(`\nserver v1.49 原型掃描讓路守衛：PASS ${pass} / FAIL ${fail}` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
