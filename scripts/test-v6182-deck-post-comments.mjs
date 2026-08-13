// v6.182 守衛：牌組公布欄「玩家留言板」。
//
// 這個功能區的地雷全部是 v6.138~v6.140 已經踩過、而且**壞掉時不會有錯誤訊息**的那幾種：
//   ・具名子路徑被 `/api/deck-posts/:id` 這種單段 pattern 整個吃掉 → 永遠 404，連 log 都沒有
//   ・限流在內容驗證**之前**就被消耗 → 玩家把字改好，立刻撞 429
//   ・刪除不冪等 → 連點第二下噴「找不到」，玩家看到的是「明明刪掉了卻報錯」
//   ・留言區的錯誤寫進 detailError → 整份牌表被換成一行錯誤
//   ・留言數在列表頁逐筆去查 → 每頁 20 次的 N+1（v6.119 讀放大）
//   ・{@html} → 儲存型 XSS（留言是玩家自由輸入且公開顯示）
//
// ⚠ 本檔刻意**不只驗字串**：
//   ① 路由遮蔽用「把全檔註冊路徑照順序抓出來 → 跑一個 Express 語義的 router 模擬器」求值，
//      而且模擬器自己先用一組**已知會被遮蔽**的合成路由表自我驗證過（IRON_RULES Rule 25）。
//   ② 四支 handler 直接從原始碼抽出來，餵一個記憶體版的 mongo mock **真的跑**，
//      斷言的是「留言有沒有寫進去／計數變成多少／HTTP status 是什麼」，
//      不是「有沒有呼叫某個函式」（本站反覆踩過：斷言有呼叫 ≠ 那件事發生了）。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAP_PATH = join(ROOT, 'oracle-admin/server_admin_patch.js');
const PAGE_PATH = join(ROOT, 'src/routes/deck-posts/+page.svelte');
const SAP = readFileSync(SAP_PATH, 'utf8');

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

/** 取「從 anchor 起、到下一個 anchor 為止」的區段。兩端都必須找得到（-1 會靜默變成掃全檔）。 */
function section(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  ok(i >= 0, '切片起點 anchor 失效：' + startAnchor);
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  ok(j > i, '切片結尾 anchor 失效：' + endAnchor);
  return src.slice(i, j);
}

/** 括號配對抽出具名 function 的完整文字（先配對參數列圓括號，再配對主體大括號）。 */
function extractFn(src, name) {
  for (const sig of ['async function ' + name + '(', 'function ' + name + '(']) {
    const i = src.indexOf(sig);
    if (i < 0) continue;
    let p = 0, argEnd = -1;
    for (let k = i + sig.length - 1; k < src.length; k++) {
      if (src[k] === '(') p++;
      else if (src[k] === ')') { p--; if (p === 0) { argEnd = k; break; } }
    }
    ok(argEnd > 0, '參數列括號沒有配對完成：' + name);
    let depth = 0, started = false;
    for (let k = argEnd + 1; k < src.length; k++) {
      const c = src[k];
      if (c === '{') { depth++; started = true; }
      else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
    }
    throw new Error('主體括號沒有配對完成：' + name);
  }
  throw new Error('找不到函式 ' + name);
}

const DP = section(SAP, 'v6.138 批次1：牌組公布欄（deckPosts）後端', '[deck-posts] init failed');
ok(DP.length > 3000, '抓不到 deckPosts 區段 —— 掃描器自己壞了，以下所有斷言都不可信');

// ══════════════════════════════════════════════════════════════════════
console.log('\n① 路由不被 /:id 遮蔽（行為端：router 模擬器實跑）');
// ══════════════════════════════════════════════════════════════════════

/**
 * 把 `app.get('/path', ...)` / `app.post(...)` / `app.delete(...)` 依**檔案順序**抓出來。
 * Express 的比對就是註冊順序，而這些 app.xxx 全在同一輪同步註冊完，所以檔案順序＝註冊順序。
 */
function collectRoutes(src) {
  const out = [];
  const re = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) out.push({ method: m[1].toUpperCase(), path: m[2] });
  return out;
}

/**
 * Express 語義的比對器（單一 pattern）。
 * ⚠ 關鍵語義：`/a/:id` 只吃**同段數**的路徑 —— `/a/x/y` 不會被它吃掉；
 *   v6.138 真正踩到的是「`/a/具名字串` 與 `/a/:id` 段數相同」，`:id` 就把具名字串捕獲走了。
 */
function patternMatches(pattern, url) {
  const ps = pattern.split('/').filter(Boolean);
  const us = url.split('?')[0].split('/').filter(Boolean);
  if (ps.length !== us.length) return false;
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) { if (!us[i]) return false; continue; }
    if (ps[i] !== us[i]) return false;
  }
  return true;
}
/** 回「第一個命中的 pattern」，就是 Express 實際會執行的那一支。 */
function resolveRoute(routes, method, url) {
  for (const r of routes) if (r.method === method && patternMatches(r.path, url)) return r.path;
  return null;
}

T('⭐⭐⭐ 模擬器自我驗證：它必須真的偵測得出「被 /:id 遮蔽」', () => {
  // 合成一組**已知壞掉**的路由表（v6.138 當初寫錯的那個形狀）。
  const bad = [
    { method: 'GET', path: '/api/deck-posts/:id' },
    { method: 'GET', path: '/api/deck-posts/comments' },
  ];
  ok(resolveRoute(bad, 'GET', '/api/deck-posts/comments') === '/api/deck-posts/:id',
    '模擬器抓不出同段數遮蔽 —— 它壞了，① 的其他斷言全部不可信');
  // 反向：段數不同就不該被吃掉（否則模擬器過度敏感，會給出假紅）
  ok(resolveRoute(bad, 'GET', '/api/deck-posts/x/comments') === null,
    '模擬器把不同段數也判成命中 —— 語義錯了');
  // 參數路由本身要會命中（否則下面「命中 :cid」的斷言是矇對的）
  ok(resolveRoute(bad, 'GET', '/api/deck-posts/abc') === '/api/deck-posts/:id', '模擬器連參數路由都不會命中');
});

const ROUTES = collectRoutes(SAP);
ok(ROUTES.length > 50, '抓到的路由太少（' + ROUTES.length + '）—— collectRoutes 壞了');

T('⭐⭐⭐ 三條留言端點都真的被命中（不是被 /api/deck-posts/:id 吃掉）', () => {
  ok(resolveRoute(ROUTES, 'GET', '/api/deck-posts-comments?postId=dp_1') === '/api/deck-posts-comments',
    'GET 留言列表沒有命中自己的路由');
  ok(resolveRoute(ROUTES, 'POST', '/api/deck-posts-comments') === '/api/deck-posts-comments',
    'POST 新增留言沒有命中自己的路由');
  ok(resolveRoute(ROUTES, 'DELETE', '/api/deck-posts-comments/dc_abc') === '/api/deck-posts-comments/:cid',
    'DELETE 刪除留言沒有命中 /:cid');
  ok(resolveRoute(ROUTES, 'GET', '/api/admin/deck-posts-comments') === '/api/admin/deck-posts-comments',
    'admin 留言巡檢沒有命中自己的路由');
});

T('⭐⭐ 既有端點沒有被新路由影響（正對照）', () => {
  ok(resolveRoute(ROUTES, 'GET', '/api/deck-posts/dp_1') === '/api/deck-posts/:id', '明細端點被改動了');
  ok(resolveRoute(ROUTES, 'GET', '/api/deck-posts-mine') === '/api/deck-posts-mine', '我的投稿端點被影響');
  ok(resolveRoute(ROUTES, 'POST', '/api/admin/deck-posts/recount') === '/api/admin/deck-posts/recount',
    'recount 端點被遮蔽（它是 4 段，不可與 /api/admin/deck-posts 相撞）');
});

T('⭐⭐ 留言端點一律用獨立前綴，全檔不得出現 /api/deck-posts/:id/… 或 /api/deck-posts/comments', () => {
  for (const r of ROUTES) {
    ok(!/^\/api\/deck-posts\/(comments|comment)$/.test(r.path),
      '出現了會被 /:id 吃掉的具名子路徑：' + r.path);
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n② 記憶體 mongo mock ＋ 抽出 handler 實跑');
// ══════════════════════════════════════════════════════════════════════

/** 極小的 mongo 查詢比對（只支援本段 handler 真的用到的運算子）。 */
function matchQuery(doc, q) {
  for (const k of Object.keys(q || {})) {
    const cond = q[k];
    const v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond && v === cond.$ne) return false;
      if ('$lt' in cond && !(v < cond.$lt)) return false;
      if ('$gt' in cond && !(v > cond.$gt)) return false;
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      const known = ['$ne', '$lt', '$gt', '$in'];
      for (const op of Object.keys(cond)) {
        if (!known.includes(op)) throw new Error('mock 不支援的查詢運算子 ' + op + ' —— 補上再說，別讓它靜默通過');
      }
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}
function makeColl(name) {
  const docs = [];
  const api = {
    _docs: docs,
    async insertOne(d) {
      if (docs.some((x) => x._id === d._id)) { const e = new Error('dup'); e.code = 11000; throw e; }
      docs.push({ ...d }); return { insertedId: d._id };
    },
    async findOne(q) { const d = docs.find((x) => matchQuery(x, q)); return d ? { ...d } : null; },
    async updateOne(q, u) {
      const d = docs.find((x) => matchQuery(x, q));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      if (u.$set) Object.assign(d, u.$set);
      if (u.$inc) for (const k of Object.keys(u.$inc)) d[k] = (d[k] || 0) + u.$inc[k];
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(q) {
      const i = docs.findIndex((x) => matchQuery(x, q));
      if (i < 0) return { deletedCount: 0 };
      docs.splice(i, 1); return { deletedCount: 1 };
    },
    async countDocuments(q) { return docs.filter((x) => matchQuery(x, q || {})).length; },
    find(q) {
      let r = docs.filter((x) => matchQuery(x, q || {})).map((x) => ({ ...x }));
      const cur = {
        sort(sp) { const k = Object.keys(sp)[0], dir = sp[k]; r = r.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * dir); return cur; },
        skip(n) { r = r.slice(n); return cur; },
        limit(n) { r = r.slice(0, n); return cur; },
        async toArray() { return r; },
      };
      return cur;
    },
    aggregate(pipe) {
      let r = docs.slice();
      for (const st of pipe) {
        if (st.$match) r = r.filter((x) => matchQuery(x, st.$match));
        else if (st.$group) {
          const key = String(st.$group._id).replace(/^\$/, '');
          const g = new Map();
          for (const d of r) g.set(d[key], (g.get(d[key]) || 0) + 1);
          r = [...g.entries()].map(([_id, n]) => ({ _id, n }));
        } else throw new Error('mock aggregate 不支援 ' + Object.keys(st)[0]);
      }
      return { async toArray() { return r; } };
    },
    createIndex() { return Promise.resolve(); },
    _name: name,
  };
  return api;
}
function makeRes() {
  const res = { statusCode: 200, body: null, headers: {}, ended: false };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

/** 把留言板那幾支 handler 抽出來，注入 mock 依賴後回傳可呼叫的物件。 */
function buildHandlers(deps) {
  const src = [
    extractFn(DP, 'dpCommentNormalize'),
    extractFn(DP, 'dpCommentPublic'),
    extractFn(DP, 'dpCommentList'),
    extractFn(DP, 'dpCommentCreate'),
    extractFn(DP, 'dpCommentDelete'),
    extractFn(DP, 'dpAdminRecount'),
    extractFn(DP, 'dpPublic'),
  ].join('\n\n');
  const f = new Function('D', `
    const { DPOSTS, DPCOMM, DPLIKES, DPDOWNS, _dpListCache, dpIdentity, dpIdentitySoft,
            dpRate, dpRateRefund, dpIp, isTournAdmin, tournIdentity, getLastRegisteredNick,
            DP_CMT_MAX, DP_CMT_PAGE, DP_CMT_PER_MIN, DP_CMT_RESERVED_NAME } = D;
    ${src}
    return { dpCommentNormalize, dpCommentPublic, dpCommentList, dpCommentCreate, dpCommentDelete, dpAdminRecount, dpPublic };
  `);
  return f(deps);
}

/** 一整套乾淨的測試環境。 */
function makeEnv(opts = {}) {
  const DPOSTS = makeColl('deckPosts');
  const DPCOMM = makeColl('deckPostComments');
  const DPLIKES = makeColl('deckPostLikes');
  const DPDOWNS = makeColl('deckPostDownloads');
  const rateCalls = [];
  const refundCalls = [];
  const buckets = new Map();
  const env = {
    DPOSTS, DPCOMM, DPLIKES, DPDOWNS, rateCalls, refundCalls,
    _dpListCache: new Map(),
    // 這一發要用哪個身分（測試逐案設定）
    identity: { uid: 'u1', email: 'u1@x.com', name: 'U1', verified: true },
    admins: ['admin@x.com'],
    rateLimit: opts.rateLimit ?? 999,
  };
  env.deps = {
    DPOSTS, DPCOMM, DPLIKES, DPDOWNS,
    _dpListCache: env._dpListCache,
    async dpIdentity() { return env.identity; },
    async dpIdentitySoft() { return env.identity && !env.identity.error ? env.identity : null; },
    dpRate(key) {
      rateCalls.push(key);
      const n = (buckets.get(key) || 0) + 1;
      if (n > env.rateLimit) { buckets.set(key, n - 1); return false; }
      buckets.set(key, n); return true;
    },
    dpRateRefund(key) { refundCalls.push(key); buckets.set(key, Math.max(0, (buckets.get(key) || 0) - 1)); },
    dpIp() { return '1.2.3.4'; },
    isTournAdmin(id) { return !!(id && id.verified && id.email && env.admins.includes(String(id.email).toLowerCase())); },
    async tournIdentity() { return env.identity; },
    async getLastRegisteredNick() { return '報名暱稱'; },
    DP_CMT_MAX: 300, DP_CMT_PAGE: 50, DP_CMT_PER_MIN: 10, DP_CMT_RESERVED_NAME: '系統管理員',
  };
  env.H = buildHandlers(env.deps);
  return env;
}
async function seedPost(env, id = 'dp_1') {
  await env.DPOSTS.insertOne({ _id: id, status: 'published', uid: 'author', likeCount: 0, downloadCount: 0, commentCount: 0 });
  return id;
}
async function post(env, text, postId = 'dp_1') {
  const res = makeRes();
  await env.H.dpCommentCreate({ body: { postId, text }, headers: {} }, res);
  return res;
}
async function del(env, cid) {
  const res = makeRes();
  await env.H.dpCommentDelete({ params: { cid }, headers: {} }, res);
  return res;
}
async function liveCount(env, postId = 'dp_1') {
  return await env.DPCOMM.countDocuments({ postId, status: { $ne: 'deleted' } });
}
async function storedCount(env, postId = 'dp_1') {
  return (await env.DPOSTS.findOne({ _id: postId })).commentCount;
}

// ⚠ 以下全部用 TA（await 版）。同步版的 T 塞 async fn 會讓例外逃走 ⇒ 恆為假綠。
console.log('\n③ 未登入不能留言｜④ 空白／超長被拒｜限流在驗證之後才消耗');

await TA('⭐⭐⭐ 環境自我驗證：mock 能寫入、能讀回', async () => {
  const env = makeEnv();
  await seedPost(env);
  const r = await post(env, 'hello');
  // ⚠ handler 自己的 try/catch 會把 ReferenceError 吞成 500 ——
  //   沙盒少注入一個閉包變數時，下游會表現成「筆數不對」這種看不出真因的症狀。
  ok(r.statusCode !== 500, '沙盒少注入了閉包相依（handler 內部 throw）：' + JSON.stringify(r.body));
  ok(r.statusCode === 200, '基本留言就失敗了：' + JSON.stringify(r.body));
  ok((await liveCount(env)) === 1, 'mock 沒有真的把留言寫進去');
  ok((await storedCount(env)) === 1, 'commentCount 沒有 +1');
});

await TA('⭐⭐⭐ 未登入／匿名不能留言（dpIdentity 回錯就直接擋，且一個字都沒寫進 DB）', async () => {
  for (const bad of [
    { error: '需要登入', code: 401 },
    { error: '請用 email 帳號登入後再操作', code: 403 },
  ]) {
    const env = makeEnv();
    await seedPost(env);
    env.identity = bad;
    const r = await post(env, '我要亂留言');
    ok(r.statusCode === bad.code, '未登入留言竟然回 ' + r.statusCode);
    ok((await env.DPCOMM.countDocuments({})) === 0, '未登入竟然寫進了留言');
    ok(env.rateCalls.length === 0, '未登入的請求也消耗了限流額度');
  }
});

await TA('⭐⭐⭐ 空白留言被拒，而且**沒有消耗限流額度**（v6.140 教訓）', async () => {
  for (const t of ['', '   ', '\n\n\n', '\r\n \r\n', '\t ']) {
    const env = makeEnv();
    await seedPost(env);
    const r = await post(env, t);
    ok(r.statusCode === 400, JSON.stringify(t) + ' 竟然被接受（' + r.statusCode + '）');
    ok(/空白/.test(String(r.body && r.body.error)), '錯誤訊息不是「留言不能空白」：' + JSON.stringify(r.body));
    ok((await env.DPCOMM.countDocuments({})) === 0, '空白留言竟然寫進 DB');
    ok(env.rateCalls.length === 0,
      '內容驗證失敗卻已經消耗限流額度 —— 玩家改好內容立刻撞 429（v6.140 踩過）');
  }
});

await TA('⭐⭐⭐ 超長留言被拒且不消耗額度；剛好上限可以過', async () => {
  const env = makeEnv();
  await seedPost(env);
  const r = await post(env, 'a'.repeat(301));
  ok(r.statusCode === 400, '301 字竟然被接受');
  ok(env.rateCalls.length === 0, '超長被拒卻消耗了限流額度');
  const env2 = makeEnv();
  await seedPost(env2);
  const r2 = await post(env2, 'a'.repeat(300));
  ok(r2.statusCode === 200, '剛好 300 字被擋掉了（上限判斷寫成 >= 了）：' + JSON.stringify(r2.body));
});

await TA('⭐⭐ 內容前後空白會被去掉（存進去的是 trim 過的）', async () => {
  const env = makeEnv();
  await seedPost(env);
  await post(env, '   有內容   \n ');
  const c = (await env.DPCOMM.find({}).toArray())[0];
  ok(c.text === '有內容', '沒有 trim：' + JSON.stringify(c.text));
});

await TA('⭐⭐ 限流真的會擋（正對照：驗證通過的留言才算額度）', async () => {
  const env = makeEnv({ rateLimit: 2 });
  await seedPost(env);
  ok((await post(env, 'a')).statusCode === 200, '第 1 則');
  ok((await post(env, 'b')).statusCode === 200, '第 2 則');
  const r = await post(env, 'c');
  ok(r.statusCode === 429, '第 3 則沒有被限流擋下（限流形同虛設）');
  ok((await liveCount(env)) === 2, '被限流擋下的留言竟然還是寫進去了');
});

await TA('⭐⭐ 投稿不存在／已下架時回 404，且**額度照扣不退**（退了就能無限免費打 DB）', async () => {
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_h', status: 'hidden', commentCount: 0 });
  const r = await post(env, 'hi', 'dp_h');
  ok(r.statusCode === 404, '對已下架的投稿留言竟然成功');
  ok(env.rateCalls.length === 1, '404 這一發沒有消耗額度');
  ok(env.refundCalls.length === 0,
    '404 之後退回了額度 —— 淨消耗變 0，拿假 postId 跑迴圈就能無限打 DB（Fable 5 review 指出）');
  const r2 = await post(env, 'hi', 'dp_nope');
  ok(r2.statusCode === 404, '對不存在的投稿留言竟然成功');
});

await TA('⭐⭐ 刪除的 no-op 同樣不退額度（理由同上）', async () => {
  const env = makeEnv();
  await seedPost(env);
  const r = await del(env, 'dc_不存在');
  ok(r.statusCode === 200 && r.body.changed === false, '刪不存在的留言竟然噴錯');
  ok(env.refundCalls.length === 0, 'no-op 退回了額度 —— 拿假 cid 跑迴圈可無限打 DB');
});

await TA('⭐⭐⭐ 留言已寫入但計數 +1 失敗時，**不可以回 500**（玩家重送會變兩則）', async () => {
  const env = makeEnv();
  await seedPost(env);
  const real = env.DPOSTS.updateOne.bind(env.DPOSTS);
  env.DPOSTS.updateOne = async () => { throw new Error('DB 抖了一下'); };
  const r = await post(env, '寫得進去但計數失敗');
  env.DPOSTS.updateOne = real;
  ok(r.statusCode === 200, '計數失敗竟然讓整支端點回 ' + r.statusCode + '（玩家會重送 ⇒ 同一則變兩則）');
  ok((await liveCount(env)) === 1, '留言沒有真的寫進去，這個測試沒有意義');
});

await TA('⭐⭐ 一般玩家不能頂著「系統管理員」的名字留言', async () => {
  const env = makeEnv();
  await seedPost(env);
  env.deps.getLastRegisteredNick = async () => '系統管理員';
  env.H = buildHandlers(env.deps);
  const r = await post(env, '我假裝是站長');
  ok(r.body.comment.authorName !== '系統管理員',
    '一般玩家把報名暱稱取成「系統管理員」就能冒名（Fable 5 review 指出）');
  ok(r.body.comment.admin === false, '一般玩家的留言被標成 admin');
  // 正對照：真的 admin 要掛得上
  const env2 = makeEnv();
  await seedPost(env2);
  env2.identity = { uid: 'adm', email: 'admin@x.com', name: 'A', verified: true };
  const r2 = await post(env2, '站長說話');
  ok(r2.body.comment.authorName === '系統管理員' && r2.body.comment.admin === true,
    'admin 的留言沒有掛上「系統管理員」');
});

await TA('⭐ 半形／全形空白也擋得住冒名（正規化後比對）', async () => {
  for (const n of ['系 統 管 理 員', '系統管理員 ', '\u3000系統管理員']) {
    const env = makeEnv();
    await seedPost(env);
    env.deps.getLastRegisteredNick = async () => n;
    env.H = buildHandlers(env.deps);
    const r = await post(env, 'x');
    ok(r.body.comment.authorName !== '系統管理員', JSON.stringify(n) + ' 竟然冒名成功');
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n⑤ 刪除：冪等｜⑥ 權限：作者或 admin');
// ══════════════════════════════════════════════════════════════════════

await TA('⭐⭐⭐ 刪除連點兩次不報錯（冪等），第二次 changed:false', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, '要刪的留言')).body.comment.id;
  const a = await del(env, cid);
  ok(a.statusCode === 200 && a.body.ok === true && a.body.changed === true, '第一次刪除異常：' + JSON.stringify(a.body));
  const b = await del(env, cid);
  ok(b.statusCode === 200, '第二次刪除竟然回 ' + b.statusCode + ' —— 「成功卻報錯」（v6.140 教訓）');
  ok(b.body.ok === true && b.body.changed === false, '第二次刪除的 changed 應為 false：' + JSON.stringify(b.body));
  const c = await del(env, 'dc_根本不存在');
  ok(c.statusCode === 200 && c.body.changed === false, '刪除不存在的留言竟然噴錯：' + c.statusCode);
});

await TA('⭐⭐⭐ 連點刪除不會把 commentCount 扣成負的（只有真的轉換才 -1）', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, 'x')).body.comment.id;
  ok((await storedCount(env)) === 1, '+1 沒發生');
  await del(env, cid); await del(env, cid); await del(env, cid);
  ok((await storedCount(env)) === 0, 'commentCount 被連點扣成 ' + (await storedCount(env)));
  ok((await liveCount(env)) === 0, '留言沒有真的被軟刪');
});

await TA('⭐⭐⭐ 別人不能刪我的留言（403），而且留言還活著', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, '我的留言')).body.comment.id;
  env.identity = { uid: 'u2', email: 'u2@x.com', name: 'U2', verified: true };
  const r = await del(env, cid);
  ok(r.statusCode === 403, '別人竟然刪得掉（' + r.statusCode + '）');
  ok((await liveCount(env)) === 1, '403 之後留言竟然消失了');
  ok((await storedCount(env)) === 1, '403 之後計數竟然變了');
});

await TA('⭐⭐⭐ admin 可以刪任何人的留言（公開版面必須有管理手段）', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, '要被站長刪掉的留言')).body.comment.id;
  env.identity = { uid: 'adm', email: 'admin@x.com', name: 'A', verified: true };
  const r = await del(env, cid);
  ok(r.statusCode === 200 && r.body.changed === true, 'admin 刪不掉（' + r.statusCode + '）');
  ok((await liveCount(env)) === 0, 'admin 刪除後留言還在');
  const doc = await env.DPCOMM.findOne({ _id: cid });
  ok(doc.status === 'deleted' && doc.deletedBy === 'admin', '沒有留下 admin 刪除的痕跡：' + JSON.stringify(doc));
});

await TA('⭐ 未登入不能刪留言', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, 'x')).body.comment.id;
  env.identity = { error: '需要登入', code: 401 };
  const r = await del(env, cid);
  ok(r.statusCode === 401, '未登入竟然刪得掉');
  ok((await liveCount(env)) === 1, '未登入刪除竟然生效了');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n⑦ 留言數：與明細一致、不漂移、可對帳');
// ══════════════════════════════════════════════════════════════════════

await TA('⭐⭐⭐ 任意新增/刪除序列之後，commentCount 恆等於實際未刪筆數', async () => {
  const env = makeEnv();
  await seedPost(env);
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push((await post(env, 'c' + i)).body.comment.id);
  await del(env, ids[0]);
  await del(env, ids[0]);           // 連點
  await del(env, ids[3]);
  env.identity = { uid: 'adm', email: 'admin@x.com', name: 'A', verified: true };
  await del(env, ids[5]);           // admin 刪
  env.identity = { uid: 'u1', email: 'u1@x.com', name: 'U1', verified: true };
  await post(env, '再一則');
  const live = await liveCount(env), stored = await storedCount(env);
  ok(live === stored, 'commentCount(' + stored + ') 與實際未刪筆數(' + live + ') 漂移了');
  ok(live === 5, '算出來的筆數不對：' + live);
});

await TA('⭐⭐⭐ 就算真的漂移了，admin 的 recount 端點能用明細把它修回來', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, 'a')).body.comment.id;
  await post(env, 'b');
  await del(env, cid);
  // 人為製造漂移（模擬歷史資料／中途失敗）
  await env.DPOSTS.updateOne({ _id: 'dp_1' }, { $set: { commentCount: 99 } });
  ok((await storedCount(env)) === 99, '漂移沒製造成功，這個測試沒有意義');
  env.identity = { uid: 'adm', email: 'admin@x.com', name: 'A', verified: true };
  const res = makeRes();
  await env.H.dpAdminRecount({ query: {}, headers: {} }, res);
  ok(res.statusCode === 200, 'recount 失敗：' + JSON.stringify(res.body));
  ok(res.body.fixed === 1, 'recount 沒有修到任何一筆：' + JSON.stringify(res.body));
  ok((await storedCount(env)) === 1, 'recount 之後 commentCount 還是 ' + (await storedCount(env)) + '（應為 1，軟刪的不能算回來）');
});

await TA('⭐⭐ 非 admin 不能 recount', async () => {
  const env = makeEnv();
  const res = makeRes();
  await env.H.dpAdminRecount({ query: {}, headers: {} }, res);
  ok(res.statusCode === 403, '一般玩家竟然可以觸發全站對帳');
});

await TA('⭐⭐⭐ 列表頁不做 N+1：dpPublic 是同步的、留言數直接讀 doc 上的欄位', async () => {
  const env = makeEnv();
  const out = env.H.dpPublic({ _id: 'dp_1', commentCount: 12, likeCount: 3, downloadCount: 4 });
  ok(!(out instanceof Promise), 'dpPublic 變成 async 了 —— 那就有機會在列表逐筆查 DB');
  ok(out.commentCount === 12, 'dpPublic 沒有回 commentCount：' + JSON.stringify(out));
  ok(out.commentCount !== undefined, '列表拿不到留言數，前端只能自己去查 ⇒ 必然 N+1');
  // 負數夾住（歷史漂移不該顯示成 -3）
  ok(env.H.dpPublic({ _id: 'x', commentCount: -3 }).commentCount === 0, 'commentCount 沒有夾在 0 以上');
  // uid / email 依舊不外流
  const leak = env.H.dpPublic({ _id: 'x', uid: 'SECRET', email: 'a@b.c', commentCount: 1 });
  ok(!JSON.stringify(leak).includes('SECRET') && !JSON.stringify(leak).includes('a@b.c'), 'dpPublic 外流了身分');
});

T('⭐⭐⭐ /api/deck-posts 列表 handler 完全沒有碰 deckPostComments（靜態把 N+1 釘死）', () => {
  const ep = section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'");
  ok(!/DPCOMM/.test(ep), '列表端點去查了留言表 —— 每頁 20 筆就是 20 次查詢（v6.119 讀放大）');
  ok(/projection:\s*\{[^}]*entries:\s*0/.test(ep), '列表 projection 被改壞了（正對照）');
});

await TA('⭐⭐ 留言列表端點本身：只查 1 次投稿 + 1 次留言，且不外流 uid/email', async () => {
  const env = makeEnv();
  await seedPost(env);
  for (let i = 0; i < 3; i++) await post(env, 'c' + i);
  const res = makeRes();
  await env.H.dpCommentList({ query: { postId: 'dp_1' }, headers: {} }, res);
  ok(res.statusCode === 200, '留言列表失敗：' + JSON.stringify(res.body));
  ok(res.body.comments.length === 3, '筆數不對：' + res.body.comments.length);
  ok(res.body.total === 3, 'total 不對：' + res.body.total);
  const s = JSON.stringify(res.body);
  ok(!s.includes('u1@x.com'), '留言列表外流了 email');
  ok(!/"uid"/.test(s), '留言列表外流了 uid');
  ok(res.body.comments.every((c) => c.mine === true), 'mine 沒有算對');
  // 升序顯示（最舊在前）
  const ts = res.body.comments.map((c) => c.createdAt);
  ok(ts.every((t, i) => i === 0 || t >= ts[i - 1]), '留言不是依時間升序');
});

await TA('⭐⭐ 被下架／刪除的投稿看不到留言', async () => {
  const env = makeEnv();
  await seedPost(env);
  await post(env, 'x');
  await env.DPOSTS.updateOne({ _id: 'dp_1' }, { $set: { status: 'hidden' } });
  const res = makeRes();
  await env.H.dpCommentList({ query: { postId: 'dp_1' }, headers: {} }, res);
  ok(res.statusCode === 404, '下架的投稿還看得到留言（' + res.statusCode + '）');
});

await TA('⭐⭐ 已刪除的留言不會出現在列表', async () => {
  const env = makeEnv();
  await seedPost(env);
  const cid = (await post(env, '要刪的')).body.comment.id;
  await post(env, '留著的');
  await del(env, cid);
  const res = makeRes();
  await env.H.dpCommentList({ query: { postId: 'dp_1' }, headers: {} }, res);
  ok(res.body.comments.length === 1 && res.body.comments[0].text === '留著的',
    '軟刪的留言還在列表裡：' + JSON.stringify(res.body.comments));
});

await TA('⭐ isAdmin 只給真的 admin（前端據此畫刪除鈕）', async () => {
  const env = makeEnv();
  await seedPost(env);
  const res1 = makeRes();
  await env.H.dpCommentList({ query: { postId: 'dp_1' }, headers: {} }, res1);
  ok(res1.body.isAdmin === false, '一般玩家被標成 admin');
  env.identity = { uid: 'adm', email: 'admin@x.com', name: 'A', verified: true };
  const res2 = makeRes();
  await env.H.dpCommentList({ query: { postId: 'dp_1' }, headers: {} }, res2);
  ok(res2.body.isAdmin === true, 'admin 沒有被標出來 ⇒ 站長在公開頁面上看不到刪除鈕');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n⑧ 前端：XSS、錯誤隔離、留言數顯示、stale-keep');
// ══════════════════════════════════════════════════════════════════════

ok(existsSync(PAGE_PATH), '找不到 /deck-posts 頁 —— 掃描器自己壞了');
const RAW = readFileSync(PAGE_PATH, 'utf8');
/** 剝註解（否定型斷言的必要前置：註解裡寫「不得出現 {@html}」會讓掃描器假紅）。 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const P = stripComments(RAW);
T('⭐ 掃描器自我驗證：剝註解真的有作用且沒把檔案剝光', () => {
  ok(P.length < RAW.length, 'stripComments 什麼都沒剝掉');
  ok(P.length > RAW.length * 0.5, 'stripComments 剝掉一半以上 —— 它壞了');
  ok(!/儲存型 XSS/.test(P), '剝註解後仍看得到註解文字 —— 否定型斷言會被騙');
});

T('⭐⭐⭐ 全頁完全沒有 {@html}（留言是玩家自由輸入且公開顯示）', () => {
  ok(!/\{@html/.test(P), '出現了 {@html} —— 留言會變成儲存型 XSS');
});

T('⭐⭐⭐ 留言內容以純插值渲染（Svelte 預設跳脫）', () => {
  ok(/\{c\.text\}/.test(P), '留言內文不是以 {c.text} 純插值渲染');
  ok(/\{c\.authorName\}/.test(P), '留言者名稱不是以純插值渲染');
});

T('⭐⭐⭐ 留言區的錯誤只能寫 commentError，絕不可污染牌表／列表', () => {
  for (const fn of ['fetchComments', 'loadOlderComments', 'submitComment', 'deleteComment']) {
    const body = extractFn(P, fn);
    ok(!/\bdetailError\s*=/.test(body), fn + ' 寫了 detailError —— 整份牌表會被換成一行錯誤（v6.140 教訓）');
    ok(!/\bloadError\s*=/.test(body), fn + ' 寫了 loadError —— 會把整份牌表清掉');
    ok(!/\bmyError\s*=/.test(body), fn + ' 寫了 myError');
    ok(!/\bapiUnavailable\s*=/.test(body), fn + ' 直接改了 apiUnavailable —— 會把整頁 UI 藏起來');
  }
  ok(/let commentError = \$state\(''\)/.test(P), '沒有獨立的 commentError 狀態');
});

T('⭐⭐⭐ 載入失敗沿用 v6.177 中央 stale-keep，不清空也不自寫一套', () => {
  ok(/from '\$lib\/ui\/stale-keep'/.test(P), '沒有 import 中央的 stale-keep');
  const body = extractFn(P, 'fetchComments');
  ok(/adoptOrKeep\(comments,\s*next\)/.test(body), 'fetchComments 沒有走 adoptOrKeep');
  ok(!/comments\s*=\s*\[\]/.test(body), 'fetchComments 裡把 comments 清空了 —— 抓失敗會整區消失（v6.177 教訓）');
  ok(/next = null/.test(body), '失敗時沒有把 next 設成 null（stale-keep 的約定是用 null 表達「這一發不可信」）');
});

T('⭐⭐ 送出失敗時**不清空**玩家打的字', () => {
  const body = extractFn(P, 'submitComment');
  const iOk = body.indexOf("commentText = ''");
  const iCatch = body.indexOf('} catch');
  ok(iOk > 0 && iCatch > 0 && iOk < iCatch, '清空輸入框的位置不在成功路徑上 —— 失敗會把玩家打的字丟掉');
});

T('⭐⭐ 刪除只在伺服器回 changed 時才扣留言數（連點不會少算）', () => {
  const body = extractFn(P, 'deleteComment');
  ok(/r\.changed/.test(body) && /bumpCommentCount\(p\.id,\s*-1\)/.test(body),
    '刪除沒有依 changed 決定要不要扣留言數');
});

T('⭐⭐⭐ 列表與明細都顯示留言數（與愛心、下載數並列）', () => {
  const listRow = section(P, 'title="有多少位不同玩家收藏過這副牌"', '</button>');
  ok(/commentCount/.test(listRow), '「全部投稿」列表沒有顯示留言數');
  ok(/likeCount/.test(section(P, 'class="row2"', 'commentCount')), '愛心與留言數沒有並列（正對照）');
  const mine = section(P, 'mine-card', 'edit-box');
  ok(/commentCount/.test(mine), '「我的投稿」列表沒有顯示留言數');
  ok(/\{openPost\.commentCount \?\? 0\}/.test(P), '明細沒有顯示留言數');
});

T('⭐⭐ 未登入顯示「登入後可留言」，而不是壞掉的輸入框', () => {
  const sec = section(P, '<section class="comments">', '</section>');
  ok(/\{#if canPost\}/.test(sec), '留言輸入框沒有用 canPost 判斷');
  ok(/登入 email 帳號後可以留言/.test(sec), '未登入沒有顯示提示文字');
  const i = sec.indexOf('{#if canPost}');
  const j = sec.indexOf('登入 email 帳號後可以留言');
  ok(sec.slice(i, j).includes('{:else}'), '提示文字不在 canPost 的 else 分支裡');
});

T('⭐⭐ 手機直式：留言區靠 flex-wrap / 100% 寬自適應，沒有新增 @media 當手機開關', () => {
  const css = P.slice(P.indexOf('<style>'));
  ok(/\.cmt-form textarea \{[^}]*width: 100%/.test(css), '留言輸入框沒有 width:100%（手機會爆版）');
  ok(/\.cmt-form textarea \{[^}]*box-sizing: border-box/.test(css), '留言輸入框沒有 box-sizing:border-box');
  ok(/\.cmt-head \{[^}]*flex-wrap: wrap/.test(css), '留言表頭沒有 flex-wrap（手機窄螢幕會被擠出去）');
  ok(/\.cmt-text \{[^}]*overflow-wrap: anywhere/.test(css), '留言內文沒有斷字 —— 貼一長串英數字會把 modal 撐爆');
  // 本頁在 v6.139 只有「一個」@media（純調 padding）。新增的留言區不得再引入新的。
  const mediaCount = (css.match(/@media/g) || []).length;
  ok(mediaCount === 1, '@media 數量從 1 變成 ' + mediaCount + ' —— 手機／桌機不得靠 @media 切版');
});

T('⭐⭐ 前端呼叫的是連字號前綴 -comments，不是會被 /:id 吃掉的 /comments', () => {
  ok(/api\('-comments/.test(P), "沒有呼叫 api('-comments…')");
  ok(!/api\('\/comments/.test(P) && !/\/deck-posts\/comments/.test(P),
    '呼叫了 /api/deck-posts/comments —— 會被伺服器的 /:id 單段 pattern 整個吃掉（v6.138 教訓）');
});

T('⭐ 切換／關閉明細時，還在飛的留言回應會作廢（不會畫到另一篇上）', () => {
  ok(/commentSeq\+\+/.test(extractFn(P, 'closeDetail')), 'closeDetail 沒有遞增 commentSeq');
  ok(/commentSeq\+\+/.test(extractFn(P, 'openDetail')), 'openDetail 沒有遞增 commentSeq');
});

T('⭐⭐⭐ 代次守衛必須也蓋到**寫入路徑**（送出／刪除，不只讀取）', () => {
  // Fable 5 review 抓到：第一版只有 fetchComments 有代次，submitComment 送出中切到另一篇，
  //   遲到的成功回應照樣把 A 篇的留言接到 B 篇的列表上。
  for (const fn of ['submitComment', 'deleteComment']) {
    const body = extractFn(P, fn);
    ok(/const seq = commentSeq/.test(body), fn + ' 沒有捕獲 commentSeq');
    ok(/seq !== commentSeq/.test(body), fn + ' 捕獲了代次卻沒有比對 —— 等於沒做');
    // 比對必須發生在「寫回 comments」之前
    const iCmp = body.indexOf('seq !== commentSeq');
    const iWrite = body.search(/comments = /);
    ok(iWrite < 0 || iCmp < iWrite, fn + ' 先寫回 comments 才比對代次 —— 擋不住');
  }
});

T('⭐⭐ 明細標題的留言數與實際列表對齊（消費伺服器回的 total）', () => {
  ok(/typeof r\.total === 'number'/.test(extractFn(P, 'fetchComments')),
    'fetchComments 沒有用伺服器回的 total 校正標題數字 —— 會出現「畫了 5 則、標題寫 3」');
});

console.log('\nv6182 deck-post-comments：PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
