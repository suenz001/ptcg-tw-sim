// v6.242 守衛 —— 休閒側 matchRecords 的 .limit(20000) 移除（站長裁定「一起處理」）
//
// 兩支端點（牌組原型【總表】/api/admin/deck-archetype-stats 與
// 【明細】/api/admin/deck-archetype-detail）的休閒來源原本是
// `.sort({endedAt:-1}).limit(20000).toArray()` —— 那是**統計聚合**不是列表顯示，
// 限制筆數＝統計數字本身失真（只算最新 20000 場）。
//
// ⚠⚠ 本版與 v6.241（錦標賽側）最大的差異：**cursor 解決記憶體、不解決時間**。
//   mongo 是一批一批送的；一批進到 node 之後，批內每次 cursor.next() 都是
//   「已解決的 promise」⇒ await 只排空 microtask，事件迴圈**不會**去跑玩家的 socket
//   回呼 ⇒ 整批期間玩家一律被擋住。⇒ 必須每 N 筆 setImmediate 讓路（adminScanYield）。
//
// 一律斷言到**行為**（Rule 25/32）：真的把 handler 抽出來跑，用
//   ①「這次查詢實際物化幾筆 / 有沒有走 toArray」②「並行探針被延遲多久」當儀器。
// 含 HEAD-FAIL（BASE v6.241 上主斷言全紅）、突變測試、正對照。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const verTs = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');

function braceEnd(s, i) { let d = 0; for (let k = i; k < s.length; k++) { const c = s[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return k + 1; } } return s.length; }
function arrowOf(anchor) {
  const i = pat.indexOf(anchor);
  assert.ok(i >= 0, '找不到端點錨點：' + anchor.slice(0, 60));
  const a = pat.indexOf('async (req, res) => {', i);
  assert.ok(a > i && a - i < 200, '端點錨點後找不到 handler');
  const txt = pat.slice(a, braceEnd(pat, pat.indexOf('{', a)));
  // Rule 25：掃描器自己要有下限斷言，抽壞了不可以靜默全綠
  assert.ok(txt.length > 2000, 'handler 抽太短（抽取器壞了？）: ' + txt.length);
  return txt;
}

// ══ 假 mongo driver ══════════════════════════════════════════════════════
//   ⚠ 真 driver 是「一批進記憶體 → 批內逐筆反序列化」；批內的 next() 是已解決的 promise。
//     模擬這一點才量得出「純 cursor 仍會整批阻塞」——否則探針會假裝一切安好。
function makeColl(docs, spy, batchSize) {
  return {
    find(filter, opts) {
      spy.projection = opts && opts.projection;
      const cur = { _limit: Infinity };
      cur.sort = () => cur; cur.skip = () => cur; cur.batchSize = () => cur;
      cur.limit = (n) => { cur._limit = n; return cur; };
      const rows = () => (cur._limit === Infinity ? docs : docs.slice(0, cur._limit));
      cur.toArray = async () => { const o = rows().map((d) => JSON.parse(JSON.stringify(d))); spy.toArray += o.length; return o; };
      cur[Symbol.asyncIterator] = async function* () {
        const r = rows();
        for (let i = 0; i < r.length; i += batchSize) {
          await new Promise((res) => setTimeout(res, 0));      // 批間的網路往返（真 macrotask）
          const end = Math.min(i + batchSize, r.length);
          for (let k = i; k < end; k++) { spy.iter++; yield JSON.parse(JSON.stringify(r[k])); }
        }
      };
      return cur;
    },
  };
}
const mkRes = () => { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; return r; }; r.status = (c) => { r.code = c; return r; }; return r; };

const RULE = { _id: 'R1', name: '皮卡丘' };
const NAMES = new Map([['c1', '皮卡丘'], ['c2', '老大的指令']]);
const stubs = {
  getCardNameMap: async () => NAMES,
  TRULES: { find: () => ({ sort: () => ({ toArray: async () => [RULE] }) }) },
  deckToSets: (ref) => {
    const e = Array.isArray(ref) ? ref.map((x) => [x.cardId, x.count]) : Object.entries(ref);
    return { names: new Set(e.map(([id]) => NAMES.get(String(id)) || String(id))) };
  },
  classifyDeck: () => ({ rule: RULE, all: [RULE] }),
  buildCasualCleanFilter: (o) => ({ _cleanFilterUsed: true, _opts: o }),
  casualSideResult: (winner, isP1) => ((winner === 0) === isP1 ? 'win' : 'loss'),
  tournSideResult: () => 'win',
  getCardAttrMap: async () => new Map(),
  getPokemonNameSet: async () => new Set(['皮卡丘']),
  getSupportPokemonNames: async () => new Set(),
};

// ── 讓路 helper：從出貨碼抽出來真的用（不是在測試裡另寫一份）──────────────
function extractYield() {
  const i = pat.indexOf('const ADMIN_SCAN_YIELD_EVERY =');
  assert.ok(i > 0, '找不到 ADMIN_SCAN_YIELD_EVERY —— 讓路節拍沒實作？');
  const j = pat.indexOf('\n  }', pat.indexOf('function adminScanYield', i));
  const src = pat.slice(i, j + 4);
  assert.ok(/setImmediate/.test(src), '讓路沒有用 setImmediate（microtask 對 I/O 沒有幫助）');
  return new Function(src + '\nreturn { adminScanYield, ADMIN_SCAN_YIELD_EVERY };')();
}

function buildHandler(arrowSrc, extra, docs, batchSize) {
  const spy = { toArray: 0, iter: 0, projection: null };
  const casual = makeColl(docs, spy, batchSize || 8000);
  const arc = makeColl([], { toArray: 0, iter: 0 }, 8000);
  const db = { collection: (n) => (n === 'matchRecords' ? casual : arc) };
  let Y = null;
  try { Y = extractYield(); } catch (e) { Y = null; }
  const base = { db, console, ...stubs, ...(Y || {}), ...(extra || {}) };
  const names = Object.keys(base), vals = Object.values(base);
  return { h: new Function(...names, '"use strict"; return (' + arrowSrc + ');')(...vals), spy };
}
const call = async (h, query) => { const res = mkRes(); await h({ query }, res); assert.ok(res.body && !res.body.error, 'handler 回錯誤: ' + (res.body && res.body.error)); return res.body; };

// ── fixture：25,000 筆（>20000 才驗得出上限被拿掉）；c2 只在 p1 那副 ⇒ 採用率必為 50% ──
const CASUAL_N = 25000;
const casualDocs = Array.from({ length: CASUAL_N }, (_, i) => ({
  _id: 'm' + i, endedAt: Date.now() - i * 1000, winner: i % 2,
  p1: { cardCounts: { c1: 4, c2: 2 } }, p2: { cardCounts: { c1: 3 } },
}));

let detailArrow = null, statsArrow = null;
await T('前提：兩支 handler 抽得出來，且休閒側已無 limit(20000).toArray()（BASE 必紅）', () => {
  detailArrow = arrowOf("app.get('/api/admin/deck-archetype-detail', requireFirebaseAdmin");
  statsArrow = arrowOf("app.get('/api/admin/deck-archetype-stats', requireFirebaseAdmin");
  for (const [n, s] of [['明細', detailArrow], ['總表', statsArrow]]) {
    assert.ok(!/\.sort\(\{ endedAt: -1 \}\)\.limit\(20000\)\.toArray\(\)/.test(s),
      n + '端點的休閒來源還套著 limit(20000).toArray() —— 統計數字會是「只算最新 20000 場」的錯數字');
    assert.ok(/for await \(const m of _cursor\)/.test(s), n + '端點的休閒來源沒有改用 cursor 逐筆');
    assert.ok(/adminScanYield\(/.test(s), n + '端點沒有讓路節拍 —— 全量掃描會整批擋住玩家');
  }
  // 全檔不得再有「matchRecords + limit(20000)」的組合（避免漏改第三處）
  const body = pat.split('\n').slice(1).join('\n');     // 第 1 行是版本沿革註解
  assert.strictEqual([...body.matchAll(/\.limit\(20000\)/g)].length, 0, '還有 limit(20000) 殘留');
});

await T('① 總表端點：25,000 場全部進入統計（BASE 只吃得到 20,000 場）', async () => {
  const { h, spy } = buildHandler(statsArrow, { _archStatsCache: new Map() }, casualDocs);
  const b = await call(h, { source: 'casual' });
  assert.strictEqual(b.scanned.casualMatches, CASUAL_N, '只掃到 ' + b.scanned.casualMatches + ' 場（應為 ' + CASUAL_N + '）');
  assert.strictEqual(b.scanned.casualDecks, CASUAL_N * 2, 'casualDecks 應為 ' + CASUAL_N * 2);
  const row = b.casual.rows.find((r) => r.ruleId === 'R1');
  assert.ok(row, '統計裡找不到原型 R1');
  assert.strictEqual(row.usage, CASUAL_N * 2, 'usage 應為 ' + CASUAL_N * 2 + '，實得 ' + row.usage);
  assert.strictEqual(row.wins + row.losses, CASUAL_N * 2, '勝負總數對不上');
});

await T('② 總表端點：儀器 —— 休閒側走 cursor，一筆都沒有 toArray 進記憶體', async () => {
  const { h, spy } = buildHandler(statsArrow, { _archStatsCache: new Map() }, casualDocs);
  await call(h, { source: 'casual' });
  assert.strictEqual(spy.toArray, 0, 'matchRecords 被 toArray 了 ' + spy.toArray + ' 筆 —— 那正是 v6.240 的 1.1GB 事故');
  assert.strictEqual(spy.iter, CASUAL_N, 'cursor 只吃到 ' + spy.iter + ' 筆');
  // projection 不可被順手改掉（少了它就會把整包 matchRecord 讀進來）
  assert.deepStrictEqual(spy.projection, { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 }, 'projection 被動過');
});

await T('③ 明細端點：25,000 場全部進入統計，採用率是全量真值', async () => {
  const { h, spy } = buildHandler(detailArrow,
    { _archDetailCache: new Map(), normCardName: (n) => String(n || ''), wilsonLower: () => 0 }, casualDocs);
  const b = await call(h, { ruleId: 'R1', source: 'casual' });
  assert.strictEqual(b.scannedSrc, CASUAL_N, '只掃到 ' + b.scannedSrc + ' 場');
  assert.strictEqual(b.sample.decks, CASUAL_N * 2, '進入統計的牌組副次錯');
  const c2 = b.cards.find((c) => c.name === '老大的指令');
  assert.ok(c2, '統計裡找不到 c2');
  assert.strictEqual(c2.nWith, CASUAL_N, '含 c2 的牌組數錯');
  assert.ok(Math.abs(c2.inclusion - 0.5) < 1e-9, '採用率應為 0.5，實得 ' + c2.inclusion);
  assert.strictEqual(spy.toArray, 0, '明細端點把 matchRecords toArray 了');
  assert.strictEqual(spy.iter, CASUAL_N, '明細端點 cursor 只吃到 ' + spy.iter + ' 筆');
});

await T('④ 淨化規則與 ?since 一字未動：仍走中央 buildCasualCleanFilter，且把 since/excludeAI 傳下去', async () => {
  let seen = null;
  const spyFilter = { ...stubs, buildCasualCleanFilter: (o) => { seen = o; return {}; } };
  const { h } = buildHandler(statsArrow, { _archStatsCache: new Map(), ...spyFilter }, casualDocs.slice(0, 10));
  await call(h, { source: 'casual', since: '1700000000000', excludeAI: 'false' });
  assert.ok(seen, '沒有呼叫 buildCasualCleanFilter —— 淨化規則被繞過了');
  assert.strictEqual(seen.since, 1700000000000, 'since 沒有傳進淨化 filter（時間範圍會失效）');
  assert.strictEqual(seen.excludeAI, false, 'excludeAI 沒有傳進淨化 filter');
});

// ══ ⭐ 事件迴圈：本版最關鍵的風險（Rule 30：絕不可讓玩家變慢）══════════════
//   ⚠ monitorEventLoopDelay 在**完全同步**的區段量不到東西（迴圈根本沒轉），
//     「沒東西」與「儀器壞了」長得一模一樣（Rule 33）⇒ 改用並行 setInterval 探針，
//     並在 handler 結束後多轉一次迴圈，否則被擋住的那一發永遠不會被記錄到。
function probe() {
  const lat = []; let last = process.hrtime.bigint();
  const t = setInterval(() => { const now = process.hrtime.bigint(); lat.push(Number(now - last) / 1e6 - 5); last = now; }, 5);
  if (t.unref) t.unref();
  return { stop: () => { clearInterval(t); lat.sort((a, b) => a - b); return lat; } };
}
async function measure(arrowSrc, extra, docs, batchSize) {
  const p = probe();
  await new Promise((r) => setTimeout(r, 60));            // 讓探針先跑穩
  const t0 = process.hrtime.bigint();
  const { h, spy } = buildHandler(arrowSrc, extra, docs, batchSize);
  const res = mkRes();
  await h({ query: { source: 'casual' } }, res);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  await new Promise((r) => setTimeout(r, 30));            // ⚠ 補跑被擋住的那一發
  const lat = p.stop();
  const q = (f) => lat[Math.min(lat.length - 1, Math.floor(lat.length * f))] || 0;
  return { ms, max: lat[lat.length - 1] || 0, p99: q(0.99), body: res.body, spy };
}

await T('⑤ ⭐ 事件迴圈實測：全量掃描期間，玩家探針不得被連續擋住（含「純 cursor 不夠」的正對照）', async () => {
  // ⚠ 量測用的 fixture 必須像線上資料：projection 之後每筆仍有雙方各約 22 種卡
  //   （用 25000 筆那組小 doc 量會低估反序列化成本，數字會漂亮得不像話）。
  const BIG = Array.from({ length: 60000 }, (_, i) => {
    const cc = () => { const o = {}; for (let j = 0; j < 22; j++) o['sv' + ((i + j) % 900)] = 1 + (j % 4); return o; };
    return { _id: 'b' + i, endedAt: Date.now() - i, winner: i % 2, p1: { cardCounts: cc() }, p2: { cardCounts: cc() } };
  });
  console.log('      ⚠ classifyDeck 在本守衛是 stub（比線上便宜）⇒ 下面的阻塞數字是**下界**；'
    + '線上每筆更貴，但讓路節拍是「每 N 筆」不是「每 N 毫秒」，比例關係不變。');
  const extra = { _archStatsCache: new Map() };
  // ⚠ 先跑一次暖機再量：第一發帶著 JIT 編譯與 GC 的成本，會讓「先量的那一組」無辜變差
  //   （實測 shipped 排第一時 max 會從 1.5ms 跳到 57ms）——那不是被測對象的問題，是儀器的。
  await measure(statsArrow, { _archStatsCache: new Map() }, BIG.slice(0, 12000), 8000);
  // (a) 出貨碼（cursor + 每 200 筆讓路）
  const shipped = await measure(statsArrow, extra, BIG, 8000);
  // (b) 正對照：把讓路拿掉 ⇒ 必須明顯更糟（否則代表探針壓根量不到東西＝儀器壞了，Rule 33）
  const noYield = statsArrow.replace(/\n\s*const _y = adminScanYield\(scanned\.casualMatches\); if \(_y\) await _y;/, '');
  assert.notStrictEqual(noYield, statsArrow, '突變錨點對不上（讓路那行寫法改了？）');
  const bare = await measure(noYield, { _archStatsCache: new Map() }, BIG, 8000);
  // (c) 改前：limit(20000).toArray() —— 一發連續同步阻塞
  const before = statsArrow.replace(
    /const _cursor = db\.collection\('matchRecords'\)\n(\s*)\.find\(q, \{ projection: \{ 'p1\.cardCounts': 1, 'p2\.cardCounts': 1, winner: 1 \} \}\)\n\s*\.sort\(\{ endedAt: -1 \}\);\n\s*for await \(const m of _cursor\) \{\n\s*scanned\.casualMatches\+\+;\n\s*const _y = adminScanYield\(scanned\.casualMatches\); if \(_y\) await _y;/,
    "const rows = await db.collection('matchRecords')\n$1.find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })\n$1.sort({ endedAt: -1 }).limit(20000).toArray();\n          scanned.casualMatches = rows.length;\n          for (const m of rows) {");
  assert.notStrictEqual(before, statsArrow, '「改前」重建錨點對不上');
  const old = await measure(before, { _archStatsCache: new Map() }, BIG, 8000);

  console.log('      fixture ' + BIG.length + ' 筆／mongo 一批 8000 筆（沙盒 CPU 約為正式 VM 的 10 倍慢）');
  console.log('      改前 limit(20000).toArray()：掃 ' + old.body.scanned.casualMatches
    + ' 筆、' + old.ms.toFixed(0) + ' ms，⭐玩家被擋 max ' + old.max.toFixed(1) + ' ms');
  console.log('      改後・無讓路（正對照）    ：掃 ' + bare.body.scanned.casualMatches
    + ' 筆、' + bare.ms.toFixed(0) + ' ms，⭐玩家被擋 max ' + bare.max.toFixed(1) + ' ms／p99 ' + bare.p99.toFixed(1));
  console.log('      改後・出貨碼（每 200 筆）  ：掃 ' + shipped.body.scanned.casualMatches
    + ' 筆、' + shipped.ms.toFixed(0) + ' ms，⭐玩家被擋 max ' + shipped.max.toFixed(1) + ' ms／p99 ' + shipped.p99.toFixed(1));

  // 正對照必須真的觸發得了（Rule 33）：沒有讓路時一定要量得到大於 40ms 的連續阻塞
  assert.ok(bare.max > 40, '正對照只量到 ' + bare.max.toFixed(1) + ' ms —— 探針壓根沒量到阻塞，儀器壞了');
  assert.ok(old.max > 40, '「改前」只量到 ' + old.max.toFixed(1) + ' ms —— 儀器壞了');
  // 出貨碼：阻塞必須明顯短於「沒讓路」，且絕對值要小（沙盒 <25ms ⇒ 正式 VM 約 <2.5ms）
  //   ⚠ 門檻取「相對」為主、「絕對」放寬：沙盒 CPU 會被鄰居干擾，絕對值抓太緊會變成
  //     隨機翻紅的守衛（而隨機紅的守衛下一步就是被人加 skip）。真正的訊號是倍數差。
  assert.ok(shipped.max < bare.max / 3, '出貨碼被擋 ' + shipped.max.toFixed(1)
    + ' ms，沒有比「不讓路」的 ' + bare.max.toFixed(1) + ' ms 明顯改善 —— 讓路沒生效');
  assert.ok(shipped.max < 60, '出貨碼仍被擋 ' + shipped.max.toFixed(1) + ' ms（沙盒上限 60ms ⇒ 正式 VM 約 6ms）');
  assert.ok(shipped.p99 < 25, '出貨碼 p99 被擋 ' + shipped.p99.toFixed(1) + ' ms');
  // 讓路的額外成本不可以太大（不然 admin 會等很久）
  assert.ok(shipped.ms < bare.ms * 1.3, '讓路讓總耗時多了 ' + ((shipped.ms / bare.ms - 1) * 100).toFixed(0) + '%');
});

await T('⑥ 讓路 helper 本身的單元行為：不到節拍回 null（連 microtask 都不排）、到了回 Promise', () => {
  const { adminScanYield, ADMIN_SCAN_YIELD_EVERY } = extractYield();
  assert.ok(ADMIN_SCAN_YIELD_EVERY >= 50 && ADMIN_SCAN_YIELD_EVERY <= 1000,
    '節拍 ' + ADMIN_SCAN_YIELD_EVERY + ' 不合理（太小＝每筆一輪迴圈；太大＝擋住玩家）');
  assert.strictEqual(adminScanYield(1), null, '不到節拍應回 null');
  assert.strictEqual(adminScanYield(ADMIN_SCAN_YIELD_EVERY - 1), null);
  assert.ok(adminScanYield(ADMIN_SCAN_YIELD_EVERY) instanceof Promise, '到節拍應回 Promise');
  assert.ok(adminScanYield(ADMIN_SCAN_YIELD_EVERY * 7) instanceof Promise);
});

await T('⑦ 突變測試：把 limit(20000).toArray() 加回去 ⇒ ①③ 必須翻紅', async () => {
  const MUT = (s) => s.replace(
    /const _cursor = db\.collection\('matchRecords'\)\n(\s*)\.find\(q, \{ projection: \{ 'p1\.cardCounts': 1, 'p2\.cardCounts': 1, winner: 1 \} \}\)\n\s*\.sort\(\{ endedAt: -1 \}\);\n\s*for await \(const m of _cursor\) \{\n\s*(scanned\.casualMatches\+\+|scannedSrc\+\+);\n\s*const _y = adminScanYield\([^)]*\); if \(_y\) await _y;/,
    (m, ind, counter) => "const rows = await db.collection('matchRecords')\n" + ind
      + ".find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })\n" + ind
      + ".sort({ endedAt: -1 }).limit(20000).toArray();\n          "
      + (counter.startsWith('scannedSrc') ? 'scannedSrc = rows.length;' : 'scanned.casualMatches = rows.length;')
      + "\n          for (const m of rows) {");
  const mutStats = MUT(statsArrow), mutDetail = MUT(detailArrow);
  assert.notStrictEqual(mutStats, statsArrow, '總表突變錨點對不上');
  assert.notStrictEqual(mutDetail, detailArrow, '明細突變錨點對不上');
  {
    const { h, spy } = buildHandler(mutStats, { _archStatsCache: new Map() }, casualDocs);
    const b = await call(h, { source: 'casual' });
    assert.strictEqual(b.scanned.casualMatches, 20000, '總表：突變後應只掃 20000 場');
    assert.strictEqual(spy.toArray, 20000, '總表：突變後應走 toArray 20000 筆');
  }
  {
    const { h, spy } = buildHandler(mutDetail,
      { _archDetailCache: new Map(), normCardName: (n) => String(n || ''), wilsonLower: () => 0 }, casualDocs);
    const b = await call(h, { ruleId: 'R1', source: 'casual' });
    assert.strictEqual(b.scannedSrc, 20000, '明細：突變後應只掃 20000 場');
    assert.strictEqual(spy.toArray, 20000, '明細：突變後應走 toArray 20000 筆');
  }
});

await T('⑧ admin.html：MI_SCAN_CAP.casual 不得再寫 20000（否則超過 2 萬場永遠誤報「已達查詢上限」）', () => {
  const m = /const MI_SCAN_CAP = \{ casual: \['casualMatches', ([^\]]+)\], tourn: \['tournEvents', ([^\]]+)\] \};/.exec(adm);
  assert.ok(m, '找不到 MI_SCAN_CAP（寫法改了？）');
  assert.strictEqual(m[1].trim(), 'Infinity', '休閒側仍寫 ' + m[1] + ' —— 已經沒有查詢上限了');
  assert.strictEqual(m[2].trim(), 'Infinity', '錦標賽側被改回 ' + m[2] + '（v6.241 已移除上限）');
});

await T('⑨ ⚠ 資料保全：這一版沒有新增任何刪除 matchRecords 的路徑', () => {
  const body = pat.split('\n').slice(1).join('\n');
  const bulk = [...body.matchAll(/collection\('matchRecords'\)\s*\.?\s*\n?\s*\.(deleteMany|drop)\b/g)];
  assert.strictEqual(bulk.length, 0, 'matchRecords 出現批次刪除：' + bulk.map((x) => x[0]).join(', '));
  const one = [...body.matchAll(/collection\('matchRecords'\)\.deleteOne\b/g)].length;
  assert.strictEqual(one, 1, 'matchRecords 的 deleteOne 呼叫點應剛好 1 處（admin 手按的），實得 ' + one);
  const ttl = [...body.matchAll(/(\w+)\.createIndex\([^)]*expireAfterSeconds/g)].map((x) => x[1]);
  assert.ok(ttl.length > 0, '掃描器壞了？全檔應至少有兩個 TTL 索引');
  assert.ok(!/matchRecords[^\n]*expireAfterSeconds/.test(body), 'matchRecords 竟然有 TTL 索引');
});

await T('⑩ 版本一致：version.ts ≥ 6.242 且 admin.html SITE_VERSION_HINT 同步、行尾維持 LF', () => {
  const V = /VERSION = '([\d.]+)'/.exec(verTs)[1];
  // ⚠ 不寫死「等於 6.242」：那會讓下一版無故翻紅（v6.241 的守衛就是這樣壞的）。斷「不得倒退」。
  assert.ok(parseFloat(V) >= 6.242, 'version.ts 沒有 bump 到 6.242（實為 ' + V + '）');
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(adm)[1];
  assert.strictEqual(H, V, 'hint ' + H + ' ≠ version.ts ' + V);
  assert.ok(!adm.includes('\r'), 'admin.html 出現 CRLF');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
