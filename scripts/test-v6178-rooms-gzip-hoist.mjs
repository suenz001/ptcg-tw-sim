// v6.178 守衛：gzip 必須真的套用到 /api/rooms/*（休閒對戰＝全站 94% 流量）
//
// 背景（v0.75 踩過、v6.178 才發現沒修完的坑）：
//   oracle_admin_update.sh 把整份 server_admin_patch.js 插在 server.js 的 `app.listen()` 之前，
//   而休閒對戰的 /api/rooms、/api/rooms/:code（含 PUT / DELETE / messages）全部是在 start() 裡、
//   遠早於 patch 就註冊完的。Express 依「註冊順序」逐層走 layer ⇒ 掛在 stack 尾端的
//   `app.use(compression())` 對 /api/rooms/* **永遠輪不到**。
//   實測：/api/rooms/:CODE 26.9KB/req、/api/rooms 11.8KB/req（都沒有 gzip），
//        而有 gzip 的 /api/tournament/state 只有 1.9KB/req。
//
// ⚠ 所以本守衛**不是**去 grep「有沒有寫 app.use(compression)」——那是 v0.75 就有的、而且沒生效。
//   本守衛把 patch 裡那一段 gzip 區塊**原封抽出來實跑**在一個模擬 Express router stack 上，
//   然後斷言「compression 的 layer 位置真的排在 /api/rooms 路由之前」。
//   （「有呼叫某函式」≠「那件事發生了」。）
//
// HEAD-FAIL：把 v6.177 的 server_admin_patch.js 放進來跑，②的順序斷言必定失敗。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
async function TA(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// ── 抽出 gzip 區塊 ────────────────────────────────────────────────────────────
//   ①優先用哨兵註解（新版）；②抓不到就退回「從 try { 到 catch 收尾」的舊版形狀，
//   讓 HEAD 版也抽得出來、也跑得起來 —— 這樣 HEAD-FAIL 才會失敗在「順序」而不是「找不到」。
const SENT_S = '// >>> PTCG-GZIP-HOIST-BLOCK-START';
const SENT_E = '// <<< PTCG-GZIP-HOIST-BLOCK-END';
function extractBlock() {
  const si = P.indexOf(SENT_S), ei = P.indexOf(SENT_E);
  if (si >= 0 && ei > si) {
    const nl = P.indexOf('\n', si);
    return P.slice(nl + 1, ei);
  }
  const a = P.indexOf('let _compression;');
  if (a < 0) return null;
  const tryStart = P.lastIndexOf('try {', a);
  const b = P.indexOf("gzip 啟用失敗", a);
  if (tryStart < 0 || b < 0) return null;
  const close = P.indexOf('\n    }', b);
  if (close < 0) return null;
  return P.slice(tryStart, close + '\n    }'.length);
}
const BLOCK = extractBlock();

console.log('① gzip 區塊抽得出來、而且沒有踩「hoist 之後 req.path 會是 undefined」的雷');

T('⭐ 抽得到 gzip 區塊', () => {
  ok(BLOCK && BLOCK.includes('_compression'), '抽不到 gzip 區塊（結構改了，請重新檢視本守衛）');
});

T('⭐⭐ filter 不得用 req.path —— compression 被搬到 expressInit 之後、但別依賴 express 原型', () => {
  ok(BLOCK, '沒有區塊');
  ok(!/req\.path/.test(BLOCK),
    'filter 用了 req.path。req.path 是 express 在 expressInit 裡掛上 request 原型才有的；\n'
    + '      這一段的定位靠的是 router stack 的位置，不該對 express 原型做假設。請改用 req.originalUrl / req.url。');
});

T('⭐ 整份 patch 只能註冊一次 compression（重複註冊＝壓兩次）', () => {
  const n = (P.match(/require\('compression'\)/g) || []).length;
  ok(n === 1, 'require(\'compression\') 出現 ' + n + ' 次');
});

T('⭐ log 要能讓站長從 pm2 log 直接看出有沒有生效', () => {
  ok(BLOCK && BLOCK.includes('hoisted='),
    'log 沒有輸出 hoisted 狀態 —— 上線後沒有任何辦法確認「搬過去了沒」');
});

// ── 模擬 Express router stack 並實跑 ──────────────────────────────────────────
function makeStack() {
  // 逐行對齊 /opt/ptcg/api/server.js 的實際註冊順序：
  //   cors → express.json → /api/health → /api/auth/anonymous → /api/rooms* → ...（patch 在最後）
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
function makeApp(kind) {
  const stack = makeStack();
  const app = { use(fn) { stack.push({ handle: fn }); } };
  if (kind === 'express5') {
    // Express 5：沒有 _router，改名為 router
    app.router = { stack };
  } else {
    // Express 4：_router 是真的；app.router 是「會 throw 的 deprecated getter」
    app._router = { stack };
    Object.defineProperty(app, 'router', {
      get() { throw new Error("'app.router' is deprecated!"); },
    });
  }
  app.__stack = stack;
  return app;
}
function makeCompressionStub() {
  const compression = (opts) => {
    const mw = function compressionMw(req, res, next) { if (next) next(); };
    mw.__gzipOpts = opts;
    return mw;
  };
  compression.filter = () => true;
  return compression;
}
async function runBlock(app) {
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
  const stub = makeCompressionStub();
  const requireStub = (name) => { if (name === 'compression') return stub; throw new Error('no ' + name); };
  const fn = new Function('app', 'require', 'console',
    '"use strict"; return (async () => {\n' + BLOCK + '\n})();');
  await fn(app, requireStub, fakeConsole);
  const stack = app.__stack;
  const gzipIdx = stack.findIndex((l) => l && l.handle && l.handle.__gzipOpts);
  const firstRouteIdx = stack.findIndex((l) => !!(l && l.route));
  return { logs, stack, gzipIdx, firstRouteIdx, opts: gzipIdx >= 0 ? stack[gzipIdx].handle.__gzipOpts : null };
}

console.log('\n② ⭐⭐⭐ 實跑：compression 的 layer 必須排在 /api/rooms 路由之前（v0.75 沒修到的那一半）');

await TA('⭐⭐⭐ Express 4 形狀：compression 排在第一個路由之前', async () => {
  const r = await runBlock(makeApp('express4'));
  ok(r.gzipIdx >= 0, 'compression 根本沒被 app.use 掛上');
  ok(r.gzipIdx < r.firstRouteIdx || r.firstRouteIdx < 0,
    '⚠ compression 的 layer index=' + r.gzipIdx + '，第一個路由 index=' + r.firstRouteIdx + '。\n'
    + '      Express 依註冊順序走 layer ⇒ /api/rooms/* 會先把回應 end 掉，compression 永遠輪不到。\n'
    + '      這正是「休閒對戰 26.9KB/req 完全沒有 gzip、錦標賽卻有」的原因。\n'
    + '      修法：app.use 之後把該 layer 從 stack 尾端 splice 到第一個 route layer 之前。');
});

await TA('⭐⭐ 而且要排在 Express 內建 middleware（query / expressInit）與 cors / express.json 之後', async () => {
  const r = await runBlock(makeApp('express4'));
  ok(r.gzipIdx >= 4,
    'compression 被插到 index ' + r.gzipIdx + ' —— 插得太前面了。\n'
    + '      expressInit 之前拿到的 req 還沒被 express 加工，且 express.json 應先於壓縮層。');
  for (let i = 0; i < r.gzipIdx; i++) {
    ok(!r.stack[i].route, 'index ' + i + ' 已經是路由，compression 卻排在它後面');
  }
});

await TA('⭐⭐ /api/rooms 的每一條路由都排在 compression 之後', async () => {
  const r = await runBlock(makeApp('express4'));
  const roomIdx = r.stack
    .map((l, i) => (l && l.route && String(l.route.path).startsWith('/api/rooms') ? i : -1))
    .filter((i) => i >= 0);
  ok(roomIdx.length >= 4, '模擬 stack 裡的 /api/rooms 路由數異常：' + roomIdx.length);
  for (const i of roomIdx) ok(i > r.gzipIdx, '/api/rooms 路由 index=' + i + ' 在 compression(' + r.gzipIdx + ') 之前');
});

await TA('⭐ 搬過去的必須是「同一個」layer 物件（不是重掛一份新的）', async () => {
  const r = await runBlock(makeApp('express4'));
  const tail = r.stack[r.stack.length - 1];
  ok(!(tail && tail.handle && tail.handle.__gzipOpts), 'stack 尾端還留著一份 compression —— 變成掛了兩層');
  ok(r.stack.filter((l) => l && l.handle && l.handle.__gzipOpts).length === 1, 'compression layer 出現超過一次');
});

await TA('⭐ Express 5 形狀（app.router、沒有 _router）同樣要搬得動', async () => {
  const r = await runBlock(makeApp('express5'));
  ok(r.gzipIdx >= 0 && r.gzipIdx < r.firstRouteIdx,
    'Express 5 形狀下沒搬成功（gzipIdx=' + r.gzipIdx + ' firstRouteIdx=' + r.firstRouteIdx + '）');
});

await TA('⭐ Express 4 的 app.router 是會 throw 的 getter —— 碰到它不可以整段掛掉', async () => {
  const r = await runBlock(makeApp('express4'));
  ok(!r.logs.some((l) => l.includes('gzip 啟用失敗')), '區塊自己拋了例外：' + r.logs.join(' | '));
});

await TA('⭐ pm2 log 要印出 hoisted=true', async () => {
  const r = await runBlock(makeApp('express4'));
  ok(r.logs.some((l) => l.includes('hoisted=true')), 'log 沒有 hoisted=true：' + r.logs.join(' | '));
});

await TA('⭐⭐ 正對照：判準抓得到「只 app.use、沒搬」的樣本（否則本守衛是假綠）', async () => {
  const app = makeApp('express4');
  const stub = makeCompressionStub();
  app.use(stub({ threshold: 1024 }));
  const gzipIdx = app.__stack.findIndex((l) => l && l.handle && l.handle.__gzipOpts);
  const firstRouteIdx = app.__stack.findIndex((l) => !!(l && l.route));
  ok(gzipIdx > firstRouteIdx, '正對照失效：沒搬的樣本竟然也通過順序判準 ⇒ 上面那些斷言等於沒作用');
});

console.log('\n③ 壓縮不得套到不該套的端點（SSE 會被 gzip 緩衝打死）');

await TA('⭐⭐ Content-Type text/event-stream 不壓', async () => {
  const r = await runBlock(makeApp('express4'));
  ok(r.opts && typeof r.opts.filter === 'function', '沒有 filter');
  const res = { getHeader: () => 'text/event-stream' };
  ok(r.opts.filter({ url: '/api/rooms/ABCD/stream' }, res) === false, 'SSE 的 Content-Type 竟然被判為可壓');
});

await TA('⭐⭐ 路徑以 /stream 結尾一律不壓（filter 跑在寫 header 時，不能只賭 Content-Type 已設好）', async () => {
  const r = await runBlock(makeApp('express4'));
  const res = { getHeader: () => 'application/json' };
  ok(r.opts.filter({ url: '/api/rooms/ABCD/stream?token=xxx' }, res) === false, '/api/rooms/:code/stream 被判為可壓');
  ok(r.opts.filter({ originalUrl: '/api/rooms/ABCD/messages/stream?token=x&since=1' }, res) === false,
    '/api/rooms/:code/messages/stream 被判為可壓');
});

await TA('⭐⭐ 一般 JSON 端點要壓（否則這一版等於什麼都沒做）', async () => {
  const r = await runBlock(makeApp('express4'));
  const res = { getHeader: () => 'application/json; charset=utf-8' };
  ok(r.opts.filter({ url: '/api/rooms/ABCD?since=12' }, res) === true, '/api/rooms/:code 沒被判為可壓');
  ok(r.opts.filter({ url: '/api/rooms?status=playing' }, res) === true, '/api/rooms 沒被判為可壓');
  ok(r.opts.filter({ url: '/api/tournament/state?room=x' }, res) === true, '/api/tournament/state 沒被判為可壓（本來就有）');
});

await TA('⭐ threshold 維持 1KB（小回應壓了反而虧、又白花 CPU）', async () => {
  const r = await runBlock(makeApp('express4'));
  ok(r.opts.threshold === 1024, 'threshold=' + r.opts.threshold);
});

console.log('\n④ nginx upstream keepalive 的操作單（設定檔不在 repo，只能交給站長手動改）');

T('⭐ docs/nginx-keepalive-runbook.md 存在且含可直接貼上的設定片段', () => {
  const f = join(ROOT, 'docs/nginx-keepalive-runbook.md');
  ok(existsSync(f), 'nginx 設定不在 repo，操作單就是唯一的交付物，不可以不見');
  const md = readFileSync(f, 'utf8');
  ok(/keepalive\s+64;/.test(md), '缺 keepalive N 這一行');
  // ⚠⚠ Node 的 http.Server 預設 keepAliveTimeout = 5000ms。upstream 的 keepalive_timeout
  //   只要大於它，就會出現「Node 先關、nginx 才寫」的競態 ⇒ upstream prematurely closed。
  //   GET 會被 nginx 自動改送新連線，但 PUT/POST 預設不重試 —— 而 PUT /api/rooms/:code
  //   （存盤面）正是休閒對戰最熱的寫入路徑 ⇒ 玩家直接吃 502。
  ok(/keepalive_timeout\s+3s;/.test(md),
    'upstream 的 keepalive_timeout 必須小於 Node 預設的 5 秒（用 3s）——\n'
    + '      大於 5 秒會製造出原本不存在的 502（而且專打 PUT /api/rooms/:code 這條熱寫入路徑）');
  ok(!/keepalive_timeout\s+(6\d|[1-9]\d{2,})s;/.test(md), '出現 >5s 的 upstream keepalive_timeout');
  ok(/keepAliveTimeout/.test(md), '操作單沒有寫明 3s 這個數字是怎麼來的（Node 預設 5 秒）');
  ok(/1\.15\.3/.test(md), '缺 nginx 版本需求說明（upstream 內的 keepalive_timeout 需要 1.15.3+）');
  ok(/proxy_http_version\s+1\.1;/.test(md), '缺 proxy_http_version 1.1');
  ok(/proxy_set_header\s+Connection\s+"";/.test(md), '缺 proxy_set_header Connection ""（少這行 keepalive 完全不會生效）');
  ok(/nginx -t/.test(md), '缺語法檢查步驟');
  ok(/\.bak/.test(md), '缺備份步驟 —— 站長不是工程師，一定要能原樣還原');
});

console.log('\n=== v6.178 休閒對戰 gzip 掛載順序守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
