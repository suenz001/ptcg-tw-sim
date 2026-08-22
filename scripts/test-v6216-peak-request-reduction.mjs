// v6.216 守衛：尖峰請求減量三件 —— 全部斷言到「行為層」（實跑，不是 grep 字串）
//
//   ① gzip 壓縮等級必須是 1（zlib 速度檔）且 threshold/SSE filter 原封保留
//      → 把 server_admin_patch.js 的 PTCG-GZIP-HOIST-BLOCK 抽出來在模擬 Express stack 上實跑，
//        檢查「實際傳給 compression() 的 options」。
//   ② 聊天輪詢增量化：帶 since 且沒有新訊息 → 實際回 204；有新訊息/舊 client 不帶 since/
//      解析不了/DB 例外 → 實際 next() 走既有全量端點（fail-open）
//      → 抽出 PTCG-CHAT-SINCE-BLOCK 實跑 middleware 本人。
//   ③ 前端：subscribeMessages 實際帶 since、收到 204(null) 實際不 callback、節奏實際維持 1500；
//      盤面輪詢實際在「等待自己輸入」時回 1000、等對手時仍 500（esbuild 轉譯後實跑）。
//
// HEAD-FAIL（於 BASE=v6.215 實跑過，紅）：
//   ①BASE 的 compression options 沒有 level ⇒ 斷言 level===1 紅。
//   ②BASE 沒有 CHAT-SINCE 區塊 ⇒ 抽取紅。
//   ③BASE 的 subscribeMessages 不帶 since ⇒ 「第二發帶 since」紅；BASE 無
//     computeCasualRoomPollMs/casualWaitingSelfInput ⇒ 抽取紅；BASE 的 subscribeRoom
//     無第 4 參數 ⇒ waiting=true 時仍回 500 ⇒ 斷言 1000 紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');
const PG = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function T(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

// esbuild：CI 的 build job 會 npm ci＋補裝 esbuild；抓不到就直接紅（fail-open 會變假綠）
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;

// ── 共用：模擬 Express stack（逐行對齊 server.js 的實際註冊順序，同 test-v6178）──
function makeStack() {
  return [
    { handle: function query() {} },
    { handle: function expressInit() {} },
    { handle: function corsMiddleware() {} },
    { handle: function jsonParser() {} },
    { route: { path: '/api/health' } },
    { route: { path: '/api/auth/anonymous' } },
    { route: { path: '/api/rooms' } },
    { route: { path: '/api/rooms/:code' } },
    { route: { path: '/api/rooms/:code/messages' } },
    { route: { path: '/api/rooms/:code/stream' } },
  ];
}
function makeApp() {
  const stack = makeStack();
  const app = { use(fn) { stack.push({ handle: fn }); } };
  app._router = { stack };
  Object.defineProperty(app, 'router', {
    get() { throw new Error("'app.router' is deprecated!"); },
  });
  app.__stack = stack;
  return app;
}
function extractBlock(src, sentS, sentE) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  if (si < 0 || ei <= si) return null;
  const nl = src.indexOf('\n', si);
  return src.slice(nl + 1, ei);
}

// ═══ ① gzip level=1 ═══
console.log('① gzip 壓縮等級 → 1（速度檔），threshold / SSE filter 原封保留');
const GZBLOCK = extractBlock(PATCH, '// >>> PTCG-GZIP-HOIST-BLOCK-START', '// <<< PTCG-GZIP-HOIST-BLOCK-END');
async function runGzipBlock() {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const stub = (opts) => { const mw = function compressionMw() {}; mw.__gzipOpts = opts; return mw; };
  stub.filter = () => true;
  const requireStub = (name) => { if (name === 'compression') return stub; throw new Error('no ' + name); };
  const app = makeApp();
  await new Function('app', 'require', 'console',
    '"use strict"; return (async () => {\n' + GZBLOCK + '\n})();')(app, requireStub, fakeConsole);
  const gi = app.__stack.findIndex((l) => l && l.handle && l.handle.__gzipOpts);
  return { logs, app, opts: gi >= 0 ? app.__stack[gi].handle.__gzipOpts : null };
}
await T('⭐⭐⭐ 實際傳給 compression() 的 options.level === 1（不是預設 6）', async () => {
  ok(GZBLOCK, '抽不到 gzip 區塊');
  const r = await runGzipBlock();
  ok(r.opts, 'compression 沒被掛上');
  ok(r.opts.level === 1, 'level=' + r.opts.level + ' —— 沒設 level 就是 zlib 預設 6，尖峰壓縮 CPU 是 level 1 的 2~3 倍');
});
await T('⭐⭐ 正對照：threshold 1024 與 SSE filter 沒有被這次改動弄丟', async () => {
  const r = await runGzipBlock();
  ok(r.opts.threshold === 1024, 'threshold=' + r.opts.threshold);
  ok(typeof r.opts.filter === 'function', 'filter 不見了');
  ok(r.opts.filter({ url: '/api/rooms/AB/stream' }, { getHeader: () => 'application/json' }) === false, '/stream 竟可壓');
  ok(r.opts.filter({ url: '/api/rooms/AB' }, { getHeader: () => 'application/json' }) === true, '一般 JSON 端點不壓了');
  ok(r.logs.some((l) => l.includes('hoisted=true')), 'gzip hoist 壞了：' + r.logs.join('|'));
});

// ═══ ② chat since-204 middleware ═══
console.log('② 聊天輪詢：帶 since 無新訊息 → 實際 204；其餘一律 fail-open 走既有全量端點');
const CSBLOCK = extractBlock(PATCH, '// >>> PTCG-CHAT-SINCE-BLOCK-START', '// <<< PTCG-CHAT-SINCE-BLOCK-END');
async function runChatBlock(dbBehavior) {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const findOneCalls = [];
  const db = { collection: (name) => ({ findOne: async (q, o) => {
    findOneCalls.push({ name, q, o });
    if (dbBehavior && dbBehavior.throws) throw new Error('db down');
    return dbBehavior ? dbBehavior.result : null;
  } }) };
  const app = makeApp();
  const before = new Set(app.__stack.map((l) => l.handle));
  await new Function('app', 'db', 'console',
    '"use strict"; return (async () => {\n' + CSBLOCK + '\n})();')(app, db, fakeConsole);
  const li = app.__stack.findIndex((l) => l && l.handle && !l.route && !before.has(l.handle));
  return { logs, app, mw: li >= 0 ? app.__stack[li].handle : null, mwIdx: li, findOneCalls };
}
async function callMw(mw, method, url) {
  const res = { _status: null, _ended: false, _json: null,
    status(c) { this._status = c; return this; },
    end() { this._ended = true; return this; },
    json(x) { this._json = x; return this; } };
  let nexted = false;
  await mw({ method, originalUrl: url, url }, res, () => { nexted = true; });
  return { res, nexted };
}
await T('⭐⭐⭐ 帶 since 且沒有更新的訊息 → 實際回 204 且不進既有端點', async () => {
  ok(CSBLOCK, '抽不到 CHAT-SINCE 區塊（BASE=v6.215 沒有這一段 ⇒ HEAD-FAIL 紅點）');
  const r = await runChatBlock({ result: null });
  ok(r.mw, 'middleware 沒被掛上');
  const c = await callMw(r.mw, 'GET', '/api/rooms/abcd/messages?limit=100&since=1700000000000');
  ok(c.res._status === 204 && c.res._ended, '沒有回 204（status=' + c.res._status + ' ended=' + c.res._ended + '）');
  ok(!c.nexted, '回了 204 卻還 next() —— 既有端點會再回一次全量');
  const q = r.findOneCalls[0];
  ok(q && q.name === 'messages' && q.q.roomCode === 'ABCD', '查錯 collection/房號：' + JSON.stringify(q && q.q));
  ok(q.q.createdAt && q.q.createdAt.$gt === 1700000000000, 'since 沒進查詢條件：' + JSON.stringify(q.q));
  ok(q.o && q.o.projection && q.o.projection._id === 1, '沒用 projection —— 判斷「有沒有新」不需要整份 doc');
});
await T('⭐⭐ 正對照：有新訊息 → next() 交給既有端點回全量（格式不變）', async () => {
  const r = await runChatBlock({ result: { _id: 'x' } });
  const c = await callMw(r.mw, 'GET', '/api/rooms/ABCD/messages?since=5');
  ok(c.nexted, '有新訊息卻沒 next()');
  ok(c.res._status !== 204 && !c.res._ended, '有新訊息卻回了 204 —— 玩家會永遠看不到新聊天');
});
await T('⭐⭐ 正對照：舊 client 不帶 since → next()（fail-open 全量），且完全不查 DB', async () => {
  const r = await runChatBlock({ result: null });
  const c = await callMw(r.mw, 'GET', '/api/rooms/ABCD/messages?limit=100');
  ok(c.nexted && c.res._status !== 204, '舊 client 被攔下來了 —— 舊版聊天會壞');
  ok(r.findOneCalls.length === 0, '不帶 since 也查了 DB（多餘查詢）');
});
await T('⭐ since 解析不了 / 非 GET / 別的路徑 → 一律 next()', async () => {
  const r = await runChatBlock({ result: null });
  ok((await callMw(r.mw, 'GET', '/api/rooms/AB/messages?since=abc')).nexted, 'since=abc 沒 fail-open');
  ok((await callMw(r.mw, 'POST', '/api/rooms/AB/messages?since=5')).nexted, 'POST 被攔了（送訊息會壞）');
  ok((await callMw(r.mw, 'GET', '/api/rooms/AB?since=5')).nexted, '房間輪詢被攔了');
  ok((await callMw(r.mw, 'GET', '/api/rooms/AB/messages/stream?since=5')).nexted, 'SSE 路徑被攔了');
});
await T('⭐ DB 例外 → next()（fail-open，聊天退化成全量而不是壞掉）', async () => {
  const r = await runChatBlock({ throws: true });
  const c = await callMw(r.mw, 'GET', '/api/rooms/AB/messages?since=5');
  ok(c.nexted && c.res._status !== 204, 'DB 掛了聊天就跟著掛 —— 必須 fail-open');
});
await T('⭐⭐ middleware 實際被 hoist 到第一個 route layer 之前（不搬永遠輪不到）', async () => {
  const r = await runChatBlock({ result: null });
  const fr = r.app.__stack.findIndex((l) => !!(l && l.route));
  ok(r.mwIdx >= 0 && fr >= 0 && r.mwIdx < fr, 'mwIdx=' + r.mwIdx + ' firstRoute=' + fr + ' —— 既有 messages route 先 end 掉回應');
  ok(r.mwIdx >= 2, '插得太前面（在 expressInit 之前）');
  ok(r.logs.some((l) => l.includes('hoisted=true')), 'log 沒印 hoisted=true：' + r.logs.join('|'));
});

// ═══ ③ 前端 ═══
console.log('③-a subscribeMessages：實際帶 since、204 實際不 callback、節奏實際維持 1500ms');
function extractFn(src, name, endMark) {
  const i = src.indexOf('function ' + name + '(');
  ok(i >= 0, '抽不到 ' + name + '（BASE 沒有 ⇒ HEAD-FAIL 紅點）');
  const start = src.lastIndexOf('\n', i) + 1;
  const j = src.indexOf(endMark, i);
  ok(j >= 0, name + ' 結尾抽取失敗');
  return src.slice(start, j + endMark.length).replace(/^export /, '');
}
await T('⭐⭐⭐ 第一發全量→之後每一發帶 since=最後一則 createdAt；204(null) 不 callback；節奏恆 1500', async () => {
  const js = ts2js(extractFn(RO, 'subscribeMessages', '\n}'));
  const calls = []; const cbs = []; const delays = [];
  let timerCb = null; let responses = [];
  const stub = async (code, limit, since) => { calls.push({ code, limit, since }); return responses.shift(); };
  const fakeSetTimeout = (cb, d) => { delays.push(d); timerCb = cb; return 1; };
  const sub = new Function('oracleListMessages', 'MESSAGES_LIMIT', 'setTimeout', 'clearTimeout', 'console',
    js + '\n;return subscribeMessages;')(stub, 100, fakeSetTimeout, () => {}, console);
  const m = (t) => ({ _id: 'm' + t, uid: 'u1', text: 'hi', kind: 'chat:小明', createdAt: t, roomCode: 'ABCD' });
  responses = [[m(1000), m(2000)]];
  const unsub = sub('abcd', (msgs) => cbs.push(msgs));
  await new Promise((r) => setTimeout(r, 20));
  ok(calls.length === 1 && calls[0].since === undefined, '第一發就帶了 since=' + calls[0].since + ' —— 進房會載不到歷史訊息');
  ok(cbs.length === 1 && cbs[0].length === 2, '第一發全量沒 callback（cbs=' + cbs.length + '）');
  ok(cbs[0][1].name === '小明', 'kind→name 解析壞了：' + JSON.stringify(cbs[0][1]));
  responses = [null];                       // 伺服器 204
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(calls[1] && calls[1].since === 2000, '第二發沒帶 since（=' + (calls[1] && calls[1].since) + '）—— 伺服器每 1.5s 照舊回全量 100 則，這一版等於沒做');
  ok(cbs.length === 1, '204 之後還 callback —— 聊天每 1.5s 重畫一次');
  responses = [[m(1000), m(2000), m(3000)]]; // 有新訊息 → 全量
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(cbs.length === 2 && cbs[1].length === 3, '有新訊息時沒 callback 全量');
  responses = [null];
  timerCb(); await new Promise((r) => setTimeout(r, 20));
  ok(calls[3] && calls[3].since === 3000, 'since 沒有跟著最新一則前進（=' + (calls[3] && calls[3].since) + '）');
  ok(delays.length >= 3 && delays.every((d) => d === 1500), '輪詢節奏變了：' + JSON.stringify(delays) + ' —— 本版明令不動 1.5s 節奏');
  const n = delays.length; unsub(); timerCb = null;
  ok(delays.length === n, 'unsubscribe 後還在排下一發');
});
await T('⭐ oracleListMessages 帶 since 時 204→null；不帶 since 的既有呼叫端型別/行為不變', async () => {
  // overload 宣告行也叫 function oracleListMessages( —— 抓「async function」那行實作
  const oi = OC.indexOf('export async function oracleListMessages(');
  ok(oi >= 0, '抽不到 oracleListMessages 實作（BASE 是同步簽名 ⇒ HEAD-FAIL 紅點）');
  const oj = OC.indexOf('\n}', oi);
  const js = ts2js(OC.slice(oi, oj + 2).replace('export ', ''));
  const urls = [];
  const api = async (path) => { urls.push(path); return path.includes('since=') ? undefined : { messages: [] }; };
  const fn = new Function('oracleApi', js + '\n;return oracleListMessages;')(api);
  ok((await fn('ab', 100, 1234)) === null, '204 沒轉成 null');
  ok(urls[0].includes('/api/rooms/AB/messages?limit=100&since=1234'), 'URL 沒帶 since：' + urls[0]);
  const r2 = await fn('ab', 100);
  ok(Array.isArray(r2), '不帶 since 的呼叫端拿到的不再是陣列（會炸掉 oraclePollMessages）');
  ok(!urls[1].includes('since='), '不帶 since 卻送了 since：' + urls[1]);
});

console.log('③-b 盤面輪詢：等待自己輸入 1000ms、等對手/有 pending 仍 500ms、觀戰/背景檔位不變');
await T('⭐⭐⭐ subscribeRoom 實跑：waiting→1000、非 waiting→500、觀戰→4000、getter 丟例外→500', async () => {
  const js = ts2js(extractFn(RO, 'computeCasualRoomPollMs', '\n}') + '\n' + extractFn(RO, 'subscribeRoom', '\n}'));
  let interval = null;
  const pollStub = (code, cb, itv) => { interval = itv; return () => {}; };
  const sub = new Function('oraclePollRoom', js + '\n;return subscribeRoom;')(pollStub);
  let waiting = false, spect = false;
  sub('abcd', () => {}, () => spect, () => waiting);
  ok(typeof interval === 'function', 'intervalMs 不是函式（自適應沒接上）');
  ok(interval() === 500, '等對手動作的快檔變了：' + interval() + '（必須維持 500）');
  waiting = true;
  ok(interval() === 1000, '等待自己輸入沒降頻：' + interval() + '（預期 1000）');
  spect = true;
  ok(interval() === 4000, '觀戰檔位被動到了：' + interval());
  spect = false; waiting = false;
  sub('abcd', () => {}, () => false, () => { throw new Error('boom'); });
  ok(interval() === 500, 'getter 丟例外沒有 fail-open 回 500 快檔');
  const sub3 = sub('abcd', () => {}, () => false);   // 第 4 參數缺席（相容舊呼叫端）
  ok(interval() === 500, '沒傳 isWaitingSelfInput 時不是 500 —— 舊呼叫端行為被改變');
});
await T('⭐⭐⭐ casualWaitingSelfInput 實跑：只有「輪到我、無任何 pending」才 true', async () => {
  const js = ts2js(extractFn(PG, 'casualWaitingSelfInput', '\n  }'));
  const run = (mode, game, myPlayerIndex) =>
    new Function('mode', 'game', 'myPlayerIndex', js + '\n;return casualWaitingSelfInput();')(mode, game, myPlayerIndex);
  const base = { phase: 'playing', activePlayerIndex: 0 };
  ok(run('online', { ...base }, 0) === true, '輪到我、無 pending 竟不降頻（永遠 500ms＝這一版等於沒做）');
  ok(run('online', { ...base, pendingSelection: { actorIdx: 1 } }, 0) === false,
    '⭐對手正在為我方效果做選擇時降頻了 —— 對手的選擇會慢半拍才被看到');
  ok(run('online', { ...base, pendingSelection: { actorIdx: 0 } }, 0) === false, '有 pending（我方在選）也不可降頻（保守判準）');
  ok(run('online', { ...base, pendingChainQueue: [{ actorIdx: 1 }] }, 0) === false, 'pending 鏈非空時降頻了');
  ok(run('online', { ...base, activePlayerIndex: 1 }, 0) === false, '等對手回合也降頻了 —— 對手動作會慢半拍');
  ok(run('online', { ...base, phase: 'setup' }, 0) === false, 'setup（雙方並行動作）降頻了');
  ok(run('online', { ...base, phase: 'game-over' }, 0) === false, 'game-over 降頻判 true（無意義）');
  ok(run('online', { ...base }, null) === false, '身分未明（myPlayerIndex=null）也降頻了');
  ok(run('local', { ...base }, 0) === false, '本機模式不該回 true');
  ok(run('online', null, 0) === false, 'game=null 沒 fail-open');
});
await T('⭐ 接線：+page.svelte 的三處 subscribeRoom 呼叫全部接上 casualWaitingSelfInput', async () => {
  const lines = PG.split('\n').filter((l) => l.includes('subscribeRoom(roomCode, handleRoomUpdate'));
  ok(lines.length === 3, 'subscribeRoom 呼叫點數量變了：' + lines.length + '（本守衛寫時是 3 處，請檢查新呼叫點有沒有接）');
  for (const l of lines) ok(l.includes('casualWaitingSelfInput'), '這一處沒接自適應參數（永遠 500ms）：' + l.trim());
});

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ' — ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
