// v6.240 守衛：admin 兩支「撈太多」的端點必須真的在**伺服器端**分頁／全量統計。
//
// 站長回報兩件事：
//   【A】📈 賽事統計只顯示 500 筆 —— 真因是 /api/tournament/admin/stats 的 limit(500)。
//        ⚠ 那不是「顯示截斷」而已：這一頁的**每一個統計數字**（完成賽事／累計報名人次／
//        不重複玩家／對戰場數／冠軍榜／玩家戰績／主力寶可夢使用率／賽果分佈）
//        都是前端拿整包 archives 算的 ⇒ 限制筆數＝**統計本身失真**。
//   【B】🎮 Oracle 對戰的「已結束」8 萬多筆，一點就當掉 —— /api/admin/oracle/rooms
//        原本 find().toArray() 完全沒有上限，且 projection 還帶著 gameState.log。
//
// 本守衛一律斷言到**行為**（Rule 25/32）：把兩支 handler 從 patch 檔抽出來，
// 餵 82,431 筆假房間 / 1,234 筆假歸檔**真的跑**，並用「這次查詢實際物化了幾筆」
// 當儀器。禁「只驗字串存在」。每條主斷言在 BASE(v6.239) 都會紅。
//
// 另含突變測試：把 skip/limit 拿掉、把 limit(500) 加回去 ⇒ 對應斷言必須翻紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const verTs = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');

let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══ 抽取器（Rule 25：抽取器自己要有下限斷言，抽到空殼必須紅）══
function braceEnd(src, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return k + 1; }
  }
  assert.fail('括號配對失敗 @' + openIdx);
}
/** 取 app.get(...) 的那個 `async (req, res) => { ... }` 原文。 */
function arrowOf(anchor) {
  const i = pat.indexOf(anchor);
  assert.ok(i >= 0, '找不到端點錨點：' + anchor.slice(0, 60));
  const a = pat.indexOf('async (req, res) => {', i);
  assert.ok(a > i && a - i < 200, '端點錨點後找不到 handler');
  const txt = pat.slice(a, braceEnd(pat, pat.indexOf('{', a)));
  assert.ok(txt.length > 500, 'handler 抽太短（抽取器壞了？）: ' + txt.length);
  return txt;
}

// ══ 假 mongo driver（帶儀器：materialised = 這次真的被物化成物件的筆數）══
function getPath(doc, path) {
  let cur = [doc];
  for (const seg of path.split('.')) {
    const nx = [];
    for (const c of cur) {
      if (c == null) continue;
      if (Array.isArray(c)) { for (const it of c) if (it && it[seg] !== undefined) nx.push(it[seg]); }
      else if (c[seg] !== undefined) nx.push(c[seg]);
    }
    cur = nx;
  }
  return cur;
}
function condOk(vals, cond) {
  if (cond instanceof RegExp) return vals.some((v) => cond.test(String(v)));
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$gte' in cond) return vals.some((v) => v >= cond.$gte);
    if ('$in' in cond) return vals.some((v) => cond.$in.includes(v));
    if ('$ne' in cond) return vals.every((v) => v !== cond.$ne);
  }
  return vals.some((v) => v === cond);
}
function matchDoc(doc, filter) {
  for (const k of Object.keys(filter || {})) {
    if (k === '$or') { if (!filter.$or.some((f) => matchDoc(doc, f))) return false; continue; }
    if (!condOk(getPath(doc, k), filter[k])) return false;
  }
  return true;
}
function makeColl(docs, spy, sortKey) {
  return {
    find(filter, opts) {
      spy.finds.push({ filter, opts });
      const cur = { _skip: 0, _limit: Infinity, _sorted: false };
      cur.sort = () => { cur._sorted = true; return cur; };
      cur.skip = (n) => { cur._skip = n; return cur; };
      cur.limit = (n) => { cur._limit = n; return cur; };
      cur.project = () => cur;
      const rows = () => {
        let r = docs.filter((d) => matchDoc(d, filter || {}));
        r = r.slice().sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
        return r.slice(cur._skip, cur._limit === Infinity ? undefined : cur._skip + cur._limit);
      };
      cur.toArray = async () => { const out = rows(); spy.materialised += out.length; return out.map((d) => ({ ...d })); };
      cur[Symbol.asyncIterator] = async function* () { for (const d of rows()) { spy.materialised++; yield { ...d }; } };
      return cur;
    },
    countDocuments: async (f) => { spy.counts.push(f || {}); return docs.filter((d) => matchDoc(d, f || {})).length; },
    createIndex: async (keys) => { spy.indexes.push(keys); return 'ok'; },
    aggregate: () => ({ toArray: async () => [] }),
    findOne: async () => null,
  };
}
function mkRes() { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; return r; }; r.status = (c) => { r.code = c; return r; }; return r; }

// ══ fixture：82,431 筆房間（跨 200 天）══
const NOW = Date.now();
const DAY = 86400000;
const ROOM_N = 82431;
const rooms = [];
for (let i = 0; i < ROOM_N; i++) {
  // 前 400 筆是 lobby/playing，其餘全是 ended（貼近線上：ended 佔絕大多數）
  const status = i < 200 ? 'playing' : (i < 400 ? 'lobby' : 'ended');
  rooms.push({
    _id: 'R' + String(i).padStart(6, '0'), roomName: '房間' + i, status,
    updatedAt: NOW - Math.floor((i / ROOM_N) * 200 * DAY),
    seats: [{ uid: 'u' + i, name: '玩家' + i, email: 'p' + i + '@x.tw', deckEntries: [{ cardId: 'c' + (i % 7), count: 4 }] }, null],
    gameState: { turn: 5, log: new Array(200).fill('log line') },
  });
}
const endedWithin7d = rooms.filter((r) => r.status === 'ended' && r.updatedAt >= NOW - 7 * DAY).length;
assert.ok(endedWithin7d > 0 && endedWithin7d < ROOM_N, 'fixture 壞了：7 天內的 ended 應介於 0 與全部之間，實得 ' + endedWithin7d);
const endedTotal = rooms.filter((r) => r.status === 'ended').length;

// ══ 建 rooms handler ══
let roomsPreSrc = null, roomsArrowSrc = null;
await T('前提：v6.240 的 rooms 分頁區塊抽得出來（BASE 必紅）', () => {
  const g = pat.indexOf("app.get('/api/admin/oracle/rooms', requireFirebaseAdmin");
  assert.ok(g >= 0, '找不到 /api/admin/oracle/rooms 端點');
  // 啟動時建索引的那一行（必須在端點註冊之前、且不在 handler 內）
  const ix = pat.lastIndexOf("db.collection('rooms').createIndex({ status: 1, updatedAt: -1 })", g);
  assert.ok(ix >= 0 && ix < g, 'rooms 的 {status,updatedAt} 索引不在啟動段（沒有它，分頁會退化成整集合掃描）');
  roomsPreSrc = pat.slice(pat.lastIndexOf('\n', ix), g);
  assert.ok(roomsPreSrc.length > 60 && roomsPreSrc.length < 600, 'pre 區段長度異常: ' + roomsPreSrc.length);
  roomsArrowSrc = arrowOf("app.get('/api/admin/oracle/rooms', requireFirebaseAdmin");
  assert.ok(roomsArrowSrc.includes('const ROOMS_RANGE_MS'), '找不到 ROOMS_RANGE_MS —— 端點沒有時間範圍');
  assert.ok(roomsArrowSrc.includes('countDocuments'), 'handler 沒有算總筆數 → 前端顯示不出「共 N 筆」');
  // ⚠ handler 必須自給自足（既有守衛 v6.229 是把 app.get 整段抽出來跑，依賴外層變數會抽出空殼）
  for (const k of ['ROOMS_MAX_PAGE_SIZE', 'ROOMS_LEGACY_CAP', '_escapeRegExpLiteral']) {
    assert.ok(roomsArrowSrc.includes('const ' + k) || roomsArrowSrc.includes('function ' + k),
      k + ' 沒有定義在 handler 內 —— 會讓既有的 v6.229 守衛抽出空殼');
  }
});

function buildRoomsHandler(arrowSrc = roomsArrowSrc) {
  const spy = { finds: [], counts: [], indexes: [], materialised: 0 };
  const coll = makeColl(rooms, spy, 'updatedAt');
  const db = { collection: (n) => (n === 'rooms' ? coll : makeColl([], spy, 'updatedAt')) };
  const f = new Function('db', 'summarizeRoom', 'enrichSeats', 'getCardNameMap', 'app', 'console',
    '"use strict";\n' + roomsPreSrc + '\nreturn (' + arrowSrc + ');');
  const h = f(db, () => {}, async () => {}, async () => new Map([['c1', '皮卡丘'], ['c2', '噴火龍ex']]), { locals: {} }, console);
  return { h, spy };
}
const call = async (h, query) => { const res = mkRes(); await h({ query }, res); assert.ok(res.body && !res.body.error, 'handler 回錯誤: ' + (res.body && res.body.error)); return res.body; };

await T('【B】① 伺服器端只回一頁：82,431 筆下只物化 50 筆，總筆數/總頁數正確（BASE 必紅）', async () => {
  const { h, spy } = buildRoomsHandler();
  const b = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50' });
  assert.strictEqual(b.rooms.length, 50, '一頁應該只回 50 筆，實得 ' + b.rooms.length);
  assert.strictEqual(b.total, endedTotal, 'total 應為 ' + endedTotal + '，實得 ' + b.total);
  assert.strictEqual(b.totalPages, Math.ceil(endedTotal / 50), 'totalPages 錯');
  assert.strictEqual(b.paged, true, 'paged 哨兵必須為 true（前端靠它分辨舊伺服器）');
  // ⭐ 儀器：BASE 會在這裡物化 82,031 筆（＝當掉的原因）
  assert.ok(spy.materialised <= 50, '這次查詢物化了 ' + spy.materialised + ' 筆 —— 伺服器端沒有真的分頁');
});

await T('【B】② 翻頁真的翻得到不同資料；末頁不足補滿；超界夾回最後一頁', async () => {
  const { h } = buildRoomsHandler();
  const p1 = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50' });
  const p2 = await call(h, { status: 'ended', range: 'all', page: '2', pageSize: '50' });
  assert.notStrictEqual(p1.rooms[0]._id, p2.rooms[0]._id, '第 2 頁與第 1 頁內容相同 —— skip 沒生效');
  const ids = new Set(p1.rooms.map((r) => r._id));
  assert.ok(!p2.rooms.some((r) => ids.has(r._id)), '兩頁內容重疊');
  const last = Math.ceil(endedTotal / 50);
  const pl = await call(h, { status: 'ended', range: 'all', page: String(last), pageSize: '50' });
  assert.strictEqual(pl.rooms.length, endedTotal - (last - 1) * 50, '末頁筆數錯');
  const over = await call(h, { status: 'ended', range: 'all', page: '999999', pageSize: '50' });
  assert.strictEqual(over.page, last, '超界頁碼應夾回最後一頁，實得 ' + over.page);
});

await T('【B】③ 時間範圍真的改變查詢條件（不是只改標籤）', async () => {
  const { h, spy } = buildRoomsHandler();
  const all = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50' });
  const fAll = spy.finds[spy.finds.length - 1].filter;
  assert.ok(!('updatedAt' in fAll), 'range=all 不該加時間條件');
  assert.strictEqual(all.total, endedTotal);

  const w7 = await call(h, { status: 'ended', range: '7d', page: '1', pageSize: '50' });
  const f7 = spy.finds[spy.finds.length - 1].filter;
  assert.ok(f7.updatedAt && typeof f7.updatedAt.$gte === 'number', 'range=7d 沒有把 updatedAt.$gte 放進查詢');
  const drift = Math.abs((NOW - 7 * DAY) - f7.updatedAt.$gte);
  assert.ok(drift < 60000, '7 天的起點算錯（差 ' + drift + 'ms）');
  assert.strictEqual(w7.total, endedWithin7d, '7 天內的 total 應為 ' + endedWithin7d + '，實得 ' + w7.total);
  assert.ok(w7.total < all.total, '縮小範圍後總筆數竟然沒變少 —— 範圍條件沒生效');
  assert.ok(w7.rooms.every((r) => r.updatedAt >= NOW - 7 * DAY - 60000), '回傳的房間有超出 7 天範圍');

  // counts 必須套同一個範圍，否則 toolbar 數字與列表互相矛盾
  assert.strictEqual(w7.counts.ended, endedWithin7d, 'counts 沒有套用時間範圍（' + w7.counts.ended + ' ≠ ' + endedWithin7d + '）');
  assert.strictEqual(all.counts.ended, endedTotal, 'range=all 的 counts 應為全量');
});

await T('【B】④ 搜尋在伺服器端做：搜得到「不在第 1 頁」的房間', async () => {
  const { h } = buildRoomsHandler();
  const target = rooms.filter((r) => r.status === 'ended')[40000];   // 深埋在第 800 頁附近
  const b = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50', q: target._id });
  assert.ok(b.rooms.some((r) => r._id === target._id), '伺服器端搜尋沒找到目標房（q 沒送到 DB？）');
  assert.strictEqual(b.q, target._id, '回應應回帶 q');
  const byName = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50', q: '玩家40400' });
  assert.ok(byName.total >= 1, '玩家名搜尋失效');
  // 正則字元不可以炸掉查詢（未跳脫的 '(' 會讓 new RegExp throw → 整支 500）
  const weird = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50', q: 'a(b[c' });
  assert.strictEqual(weird.total, 0, '正則特殊字元應被跳脫成字面值');
});

await T('【B】⑤ 沒帶 page（舊快取頁面）⇒ 走舊路徑但有 2000 筆硬上限，且誠實回報被截斷', async () => {
  const { h, spy } = buildRoomsHandler();
  const b = await call(h, { status: 'ended' });
  assert.strictEqual(b.paged, false, '沒帶 page 不該宣稱自己分頁了');
  // ⚠ 舊路徑會把含 gameState.log 的 doc 整包讀進**共用的** node 行程（實測 ~1.2GB / 沙盒 OOM），
  //   有機會拖累玩家 ⇒ 一定要有上限（Rule 30）。
  assert.strictEqual(b.rooms.length, 2000, '舊路徑應被 ROOMS_LEGACY_CAP 擋在 2000 筆，實得 ' + b.rooms.length);
  assert.strictEqual(b.truncated, true, '截斷了卻沒有 truncated 哨兵 —— 不可以靜默回一份截斷列表假裝是全部');
  assert.strictEqual(b.counts.ended, endedTotal, '舊路徑的 counts 仍應是全量真值（' + endedTotal + '）');
  assert.strictEqual(spy.counts.length, 3, '舊路徑不該多打 total 的 countDocuments（實打 ' + spy.counts.length + ' 次）');
  assert.ok(spy.materialised <= 2000, '舊路徑物化了 ' + spy.materialised + ' 筆 —— 上限沒生效');
  // 房間數少於上限時不得誤報截斷
  const b2 = await call(h, { status: 'lobby' });
  assert.strictEqual(b2.truncated, false, '沒截斷卻回報 truncated');
});

await T('【B】⑥ 索引：{status:1,updatedAt:-1} 在啟動時就真的被建（不是放在 request handler 內）', async () => {
  const { h, spy } = buildRoomsHandler();           // 建 handler ＝ 執行 patch 的模組層級程式碼
  assert.strictEqual(spy.indexes.length, 1, '啟動時應建 1 條索引（實得 ' + spy.indexes.length + ' 條）');
  assert.deepStrictEqual(spy.indexes[0], { status: 1, updatedAt: -1 }, '索引鍵不對');
  await call(h, { status: 'ended', range: '7d', page: '1' });
  await call(h, { status: 'ended', range: '7d', page: '2' });
  assert.strictEqual(spy.indexes.length, 1, 'createIndex 跑進 request handler 了（每發都建一次：' + spy.indexes.length + '）');
  // v6.119 守衛的既有要求：每個 createIndex 那一行都要有 catch（索引已存在會拋）
  for (const l of pat.split('\n').filter((x) => x.includes('createIndex'))) {
    assert.ok(/catch/.test(l), 'createIndex 沒有 catch：' + l.trim().slice(0, 80));
  }
});

await T('【B】⑦ 突變測試：把 skip/limit 拿掉 ⇒ ①與②必須翻紅', async () => {
  const mutated = roomsArrowSrc.replace('_cur = _cur.skip((_page - 1) * _pageSize).limit(_pageSize);', '_cur = _cur;');
  assert.notStrictEqual(mutated, roomsArrowSrc, '突變沒套用（錨點改了？）');
  const { h, spy } = buildRoomsHandler(mutated);
  const b = await call(h, { status: 'ended', range: 'all', page: '1', pageSize: '50' });
  assert.ok(b.rooms.length > 50 || spy.materialised > 50,
    '拿掉 skip/limit 之後守衛竟然還是綠的 —— 這條斷言擋不住回歸');
});

// ══════════════════════ 【A】賽事統計 ══════════════════════
const ARC_N = 1234;
const archives = [];
for (let i = 0; i < ARC_N; i++) {
  archives.push({
    _id: 'arch_e' + i, eventId: 'e' + i, eventName: '賽事' + i, finishedAt: NOW - i * 3600000,
    startedAt: NOW - i * 3600000 - 5400000, createdAt: NOW - i * 3600000 - 7200000,
    playerCount: 8, communityEvent: i % 3 === 0, championUid: 'u' + (i % 50), championName: '冠軍' + (i % 50),
    players: [{ uid: 'u' + (i % 50), name: '冠軍' + (i % 50), email: 'c' + (i % 50) + '@x.tw', deckEntries: [{ cardId: 'c1', count: 4 }] }],
    matches: [{ round: 1, idx: 0, p1uid: 'u' + (i % 50), p2uid: 'v' + i, winnerUid: 'u' + (i % 50), status: 'done' }],
  });
}
const champs = archives.map((a) => ({ _id: 'champ_' + a.eventId, eventId: a.eventId, eventName: a.eventName, championUid: a.championUid, championName: a.championName, finishedAt: a.finishedAt }));

let statsArrowSrc = null;
await T('前提：賽事統計 handler 抽得出來且已無 limit(500)（BASE 必紅）', () => {
  statsArrowSrc = arrowOf("app.get('/api/tournament/admin/stats', async (req, res) => {");
  assert.ok(!/TARCHIVE\.find\(\{\}\)\.sort\(\{ finishedAt: -1 \}\)\.limit\(500\)/.test(statsArrowSrc),
    '賽事歸檔還套著 limit(500) —— 統計數字會是「只算最新 500 場」的錯數字');
  assert.ok(statsArrowSrc.includes('countDocuments'), '沒有回傳全量總場數，前端無從得知有沒有被截斷');
});

function buildStatsHandler(arrowSrc = statsArrowSrc) {
  const spy = { finds: [], counts: [], indexes: [], materialised: 0 };
  const TARCHIVE = makeColl(archives, spy, 'finishedAt');
  const TCHAMPS = makeColl(champs, spy, 'finishedAt');
  const f = new Function('TARCHIVE', 'TCHAMPS', 'tournIdentity', 'isTournAdmin', 'console',
    '"use strict"; return (' + arrowSrc + ');');
  const h = f(TARCHIVE, TCHAMPS, async () => ({ uid: 'admin', email: 'a@x.tw' }), () => true, console);
  return { h, spy };
}

await T('【A】① 分頁 + 前端逐頁累積 ⇒ 拿到**全量** 1,234 場（BASE 只會拿到 500）', async () => {
  const { h } = buildStatsHandler();
  // 直接把 admin.html 的中央 helper 抽出來真的跑（不是重寫一份）
  const s = adm.indexOf('const TS_ARCHIVE_PAGE_SIZE');
  assert.ok(s >= 0, 'admin.html 沒有 TS_ARCHIVE_PAGE_SIZE —— 前端沒有逐頁累積');
  const fnI = adm.indexOf('async function fetchAllTournamentStats(', s);
  assert.ok(fnI > s, '找不到 fetchAllTournamentStats');
  const helperSrc = adm.slice(s, braceEnd(adm, adm.indexOf('{', adm.indexOf(')', fnI))));
  assert.ok(helperSrc.length > 400 && helperSrc.length < 4000, 'helper 長度異常: ' + helperSrc.length);
  let apiCalls = 0;
  const api = async (path) => {
    apiCalls++;
    const q = Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''));
    const res = mkRes(); await h({ query: q }, res); return res.body;
  };
  const run = new Function('api', '"use strict";\n' + helperSrc + '\nreturn fetchAllTournamentStats;')(api);
  const out = await run(null);
  assert.strictEqual(out.archives.length, ARC_N, '累積後應為全量 ' + ARC_N + ' 場，實得 ' + out.archives.length);
  assert.strictEqual(out.total, ARC_N, 'total 應為 ' + ARC_N);
  assert.strictEqual(new Set(out.archives.map((a) => a.eventId)).size, ARC_N, '有重複或漏掉的賽事');
  assert.ok(apiCalls >= 2 && apiCalls <= 20, '應該分成數頁抓（實際 ' + apiCalls + ' 發）');
  assert.strictEqual(out.champions.length, champs.length, '名人堂應在第 1 頁一次回齊');
  // ⭐ 統計正確性的正對照：全量算出來的「不重複玩家」與 fixture 期望一致（500 場時必然算錯）
  const uniq = new Set(); for (const a of out.archives) for (const p of a.players) uniq.add(p.email);
  assert.strictEqual(uniq.size, 50, '不重複玩家算錯');
  const communityN = out.archives.filter((a) => a.communityEvent).length;
  assert.strictEqual(communityN, archives.filter((a) => a.communityEvent).length, '社群賽場數（全量）算錯');
});

await T('【A】② 沒帶 page ⇒ 與 v6.239 逐字相同（第 1 頁、500 筆）', async () => {
  const { h } = buildStatsHandler();
  const res = mkRes(); await h({ query: {} }, res);
  assert.strictEqual(res.body.archives.length, 500, '舊 client 應照舊拿到 500 筆，實得 ' + res.body.archives.length);
  assert.strictEqual(res.body.paged, false);
  assert.strictEqual(res.body.total, ARC_N, '即使舊路徑也要回真實總數（站長才知道被截斷）');
  assert.strictEqual(res.body.archives[0].eventId, 'e0', '排序（finishedAt desc）改變了');
});

await T('【A】③ 突變測試：把 limit(500) 加回去 ⇒ ①必須翻紅', async () => {
  const mutated = statsArrowSrc.replace('.skip((_arcPage - 1) * _pgSize).limit(_pgSize)', '.limit(500)');
  assert.notStrictEqual(mutated, statsArrowSrc, '突變沒套用（錨點改了？）');
  const { h } = buildStatsHandler(mutated);
  const seen = new Set();
  for (let p = 1; p <= 7; p++) { const res = mkRes(); await h({ query: { page: String(p), pageSize: '200' } }, res); for (const a of res.body.archives) seen.add(a.eventId); }
  assert.ok(seen.size < ARC_N, '把 limit(500) 加回去之後仍然拿得到全量 —— 這條斷言擋不住回歸');
});

await T('【A】④ champion-report 也是全量（統計端點，limit 會讓數字本身錯）', async () => {
  const arrowSrc = arrowOf("app.get('/api/admin/champion-report', requireFirebaseAdmin");
  assert.ok(!/\.limit\(500\)/.test(arrowSrc), 'champion-report 還套著 limit(500)');
  const spy = { finds: [], counts: [], indexes: [], materialised: 0 };
  const arcColl = makeColl(archives, spy, 'finishedAt');
  const db = { collection: () => arcColl };
  const f = new Function('db', 'getCardNameMap', 'TRULES', 'classifyDeck', 'deckToSets', 'app', 'console',
    '"use strict"; return (' + arrowSrc + ');');
  const h = f(db, async () => new Map([['c1', '皮卡丘']]), { find: () => ({ sort: () => ({ toArray: async () => [] }) }) },
    () => ({ rule: { name: '皮卡丘' } }), () => new Set(), { locals: { _detectCutPlacements: () => ({ finals: new Set(), top4: new Set(['u1']), top8: new Set() }) } }, console);
  const res = mkRes();
  await h({ query: {} }, res);
  assert.ok(res.body && !res.body.error, 'handler 回錯誤: ' + (res.body && res.body.error));
  assert.strictEqual(res.body.events.length, ARC_N, '應涵蓋全部 ' + ARC_N + ' 場，實得 ' + res.body.events.length);
  assert.strictEqual(res.body.scannedEvents, ARC_N, 'scannedEvents 口徑錯');
});

// ══════════════════════ admin.html 接線 ══════════════════════
await T('【B】⑧ admin.html 真的把 page/pageSize/range 送出去，且拿到伺服器分頁時不再自己 slice', () => {
  const i = adm.indexOf('async function loadOracleRooms()');
  assert.ok(i > 0, '找不到 loadOracleRooms');
  const seg = adm.slice(i, braceEnd(adm, adm.indexOf('{', adm.indexOf(')', i))));
  for (const k of ["_p.set('range'", "_p.set('page'", "_p.set('pageSize'"]) {
    assert.ok(seg.includes(k), 'loadOracleRooms 沒有送出 ' + k);
  }
  assert.ok(/oracleRoomsSrv = data\.paged \?/.test(seg), '沒有用 paged 哨兵判斷伺服器是否支援分頁');
  const r = adm.indexOf('function renderRoomsTab(');
  const rseg = adm.slice(r, braceEnd(adm, adm.indexOf('{', adm.indexOf(')', r))));
  assert.ok(/if \(srv\) \{[\s\S]{0,400}pageRooms = rooms;/.test(rseg),
    '伺服器端分頁時仍在前端 slice —— 那會把已經正確的一頁又切掉');
  assert.ok(rseg.includes('setOracleRoomsRange'), '沒有時間範圍切換 UI');
  assert.ok(rseg.includes("oracleRoomsRange === r ? ' active'"), '時間範圍按鈕沒有標示目前選項');
  const p = adm.indexOf('window.setRoomsPage = function');
  const pseg = adm.slice(p, p + 700);
  assert.ok(pseg.includes('loadOracleRooms()'), '翻頁沒有重新跟伺服器要那一頁（前端手上只有 50 筆）');
  const d = adm.indexOf('window.setOracleRoomsRange = function');
  assert.ok(d > 0, '沒有 setOracleRoomsRange');
  assert.ok(adm.slice(d, d + 400).includes('loadOracleRooms()'), '換範圍沒有重抓');
  // 預設值：站長要求預設近 7 天
  assert.ok(/let oracleRoomsRange = '7d';/.test(adm), '預設時間範圍不是近 7 天');
  // 搜尋要走伺服器（否則分頁後只搜得到當前 50 筆）
  const s = adm.indexOf('window.filterRoomsBySearch = function');
  const sseg = adm.slice(s, s + 1200);
  assert.ok(sseg.includes('oracleRoomsSearch = q') && sseg.includes('loadOracleRooms()'), '搜尋沒有送到伺服器');
});

await T('【A】⑤ 奪冠報告圖與賽事統計共用同一支全量 helper（口徑只有一份）', () => {
  const i = adm.indexOf('async function crLoadData()');
  assert.ok(i > 0, '找不到 crLoadData');
  const seg = adm.slice(i, i + 1200);
  assert.ok(seg.includes('fetchAllTournamentStats'), 'crLoadData 沒走全量 helper —— 報告圖會只涵蓋第一頁');
  assert.ok(!/api\('\/api\/tournament\/admin\/stats'\)/.test(seg), 'crLoadData 還在直接打未分頁的端點');
  // 全站不得再有「不帶 page 直接打」的呼叫點
  const bare = (adm.match(/api\('\/api\/tournament\/admin\/stats'\)/g) || []).length;
  assert.strictEqual(bare, 0, '還有 ' + bare + ' 處直接打未分頁端點（會拿到被截斷的 500 筆）');
});

await T('版本一致：admin.html SITE_VERSION_HINT = version.ts VERSION', () => {
  const V = /VERSION = '([\d.]+)'/.exec(verTs)[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(adm)[1];
  assert.strictEqual(H, V, `hint ${H} ≠ version.ts ${V}`);
});

await T('⚠ 資料保全：tournamentArchives / tournamentChampions 不得有 TTL 或批次刪除', () => {
  // 站長最在意的一點：那 500 筆以外的資料**有沒有被刪掉**。
  const ttl = [...pat.matchAll(/(\w+)\.createIndex\([^)]*expireAfterSeconds/g)].map((m) => m[1]);
  assert.ok(ttl.length > 0, '掃描器壞了？全檔應至少有 TCDIAG / TREPLAY 兩個 TTL 索引');
  for (const c of ttl) assert.ok(c !== 'TARCHIVE' && c !== 'TCHAMPS', c + ' 竟然有 TTL 索引（會自動過期刪除）');
  const dm = [...pat.matchAll(/(TARCHIVE|TCHAMPS)\.(deleteMany|drop)\b/g)];
  assert.strictEqual(dm.length, 0, '賽事歸檔出現批次刪除：' + dm.map((m) => m[0]).join(', '));
  const del = [...pat.matchAll(/(TARCHIVE|TCHAMPS)\.deleteOne\b/g)].length;
  assert.strictEqual(del, 3, '歸檔的 deleteOne 呼叫點應剛好 3 處（admin 手動刪歸檔 2 處 + 刪名人堂 1 處），實得 ' + del);
});

// ══ ⑨ benchmark（Rule 32：效能數字必須附量測腳本，這裡就是那支腳本）══
await T('⑨ benchmark：量「伺服器要讀進來 / 送出去」多少東西（改前 vs 改後）', () => {
  const SAMPLE = 4000;                       // 8 萬筆一次建在記憶體會被 OOM kill（實測 exit 137）
  const mk = (i) => ({
    _id: 'R' + i, roomName: '房間' + i, hostName: '主持' + i, hostUid: 'h' + i, status: 'ended',
    createdAt: NOW - i, updatedAt: NOW - i, _version: 12, schemaVersion: 3,
    seats: [0, 1].map((k) => ({ uid: 'u' + i + k, name: '玩家' + i + k, email: 'p' + i + k + '@example.tw',
      deckEntries: Array.from({ length: 18 }, (_, j) => ({ cardId: 'sv' + j, count: 2 })) })),
    memberUids: ['u' + i + '0', 'u' + i + '1'],
    // v6.220 實測：第 9 回合 202 則 log ≈ 29.2KB，佔房間 doc 約 60%（projection 有帶它）
    gameState: { turn: 9, phase: 'game-over', winner: 0, winReason: 'prize', players: [{ prize: 0 }, { prize: 3 }],
      log: Array.from({ length: 202 }, (_, j) => ({ turn: 1 + (j >> 4), playerIndex: j & 1, message: '玩家' + i + ' 使用招式 #' + j + '，造成 120 傷害。' })) },
  });
  const docs = Array.from({ length: SAMPLE }, (_, i) => mk(i));
  const readPerDoc = JSON.stringify(docs).length / SAMPLE;          // mongo→node 的量（含 log）
  const t0 = process.hrtime.bigint();
  const out = docs.map((d) => { const gs = d.gameState; d.gameStateSummary = { turn: gs.turn, winner: gs.winner, logCount: gs.log.length }; delete d.gameState; return d; });
  const body = JSON.stringify(out);
  const serMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint(); JSON.parse(body); const parseMs = Number(process.hrtime.bigint() - t1) / 1e6;
  const outPerDoc = body.length / SAMPLE;
  const S = (b) => (b / 1048576).toFixed(1) + ' MB';
  const N = 82031;                                                   // 站長回報的已結束房量級
  console.log('      改前（整包撈回來，' + N.toLocaleString() + ' 筆）：mongo→node ' + S(readPerDoc * N)
    + '、下行 JSON ' + S(outPerDoc * N) + '、node 序列化 ~' + (serMs * N / SAMPLE).toFixed(0)
    + 'ms、瀏覽器 parse ~' + (parseMs * N / SAMPLE).toFixed(0) + 'ms（線性外推自 ' + SAMPLE + ' 筆樣本）');
  console.log('      改後（伺服器端一頁 50 筆）  ：mongo→node ' + S(readPerDoc * 50)
    + '、下行 JSON ' + S(outPerDoc * 50) + '、node 序列化 ~' + (serMs * 50 / SAMPLE).toFixed(2)
    + 'ms、瀏覽器 parse ~' + (parseMs * 50 / SAMPLE).toFixed(2) + 'ms');
  console.log('      ⚠ 沙盒 CPU 約為正式 VM（ARM A1.Flex 4 OCPU）的 ~10 倍慢，數字要換算後才可推論線上（Rule 32）。');
  // 量級檢核：改前是「GB 級讀取 / 百 MB 級下行」，改後必須小三個數量級以上
  assert.ok(readPerDoc * N / (readPerDoc * 50) > 1000, '量級檢核失敗（外推公式壞了？）');
  assert.ok(outPerDoc * N > 50 * 1048576, '改前的下行量應為百 MB 級，實得 ' + S(outPerDoc * N) + ' —— fixture 不像線上資料');
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
