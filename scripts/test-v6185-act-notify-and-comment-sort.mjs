// v6.185 守衛：①牌組公布欄「最新留言」排序 + lastCommentAt 不漂移
//              ②對戰通知「輪到我需要操作」單一述詞（補位／對手效果要我選擇／開局／取獎賞）
//
// ⚠ 本檔刻意**不驗字串存在**（v6.154 教訓：只驗字串存在的守衛擋不住「接線沒接上」）：
//   ・deck-posts 那半段把 4 支 handler 從原始碼抽出來，餵記憶體 mongo mock **真的跑**，
//     斷言的是「DB 裡的 lastCommentAt 變成多少」「列表回來的順序是什麼」。
//   ・通知那半段把對戰頁的 tCurrentActorSeat/setupActorSeat **原文抽出來**，
//     和真正的 notify-core + notify.ts glue 一起 bundle，用假的 Notification 攔截，
//     斷言的是「有沒有真的發出通知、出不出聲」，不是「有沒有呼叫某個函式」。
//
// ⚠ 掃描器自我驗證（IRON_RULES Rule 25）：extractFn / mongo mock / 排序器
//   都先用一組**已知答案**的合成輸入驗過自己，否則以下斷言全部不可信。
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAP = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const DPPAGE = readFileSync(join(ROOT, 'src/routes/deck-posts/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (!c) throw new Error(m); }
function T(n, fn) { try { fn(); console.log('  ✓ ' + n); pass++; } catch (e) { console.log('  ✗ ' + n + '\n      ' + (e && e.message)); fail++; } }
async function TA(n, fn) { try { await fn(); console.log('  ✓ ' + n); pass++; } catch (e) { console.log('  ✗ ' + n + '\n      ' + (e && e.message)); fail++; } }

/** 括號配對抽出具名 function 的完整文字（沿用 v6.182 守衛的作法）。 */
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

console.log('\n⓪ 掃描器自我驗證');
T('⭐⭐⭐ extractFn 自我驗證：抓得到完整主體、抓不到就要 throw（不是靜默回空字串）', () => {
  const s = 'function a(x){ if(x){return {y:1};} return 0; }\nfunction b(){}';
  ok(extractFn(s, 'a') === 'function a(x){ if(x){return {y:1};} return 0; }', 'extractFn 主體配對錯了：' + extractFn(s, 'a'));
  let threw = false; try { extractFn(s, 'zzz'); } catch { threw = true; }
  ok(threw, 'extractFn 找不到函式時沒有 throw ⇒ 下游全部假綠');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n① 牌組公布欄「最新留言」排序 + lastCommentAt 不漂移');
// ══════════════════════════════════════════════════════════════════════

/** mongo BSON 排序語義：missing/null 排在數字**之前**（ascending）。 */
function bsonCmp(a, b) {
  const rank = (v) => (v === undefined || v === null ? 0 : 1);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}
function sortDocs(docs, spec) {
  const keys = Object.keys(spec);
  return docs.slice().sort((x, y) => {
    for (const k of keys) { const c = bsonCmp(x[k], y[k]) * spec[k]; if (c) return c; }
    return 0;
  });
}
T('⭐⭐⭐ 排序器自我驗證：descending 時「欄位缺席」必須排在 0 之後', () => {
  const r = sortDocs([{ _id: 'miss' }, { _id: 'zero', v: 0 }, { _id: 'big', v: 9 }], { v: -1 }).map((d) => d._id);
  ok(JSON.stringify(r) === '["big","zero","miss"]', '排序器沒有模擬出 mongo 的 null 語義：' + JSON.stringify(r));
  const t = sortDocs([{ a: 1, b: 1 }, { a: 1, b: 5 }], { a: -1, b: -1 }).map((d) => d.b);
  ok(JSON.stringify(t) === '[5,1]', '排序器不支援第二排序鍵');
});

function matchQuery(doc, q) {
  for (const k of Object.keys(q || {})) {
    const cond = q[k], v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond && v === cond.$ne) return false;
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      if ('$exists' in cond && (v !== undefined) !== cond.$exists) return false;
      const known = ['$ne', '$in', '$exists'];
      for (const op of Object.keys(cond)) if (!known.includes(op)) throw new Error('mock 不支援查詢運算子 ' + op);
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}
function makeColl() {
  const docs = [];
  const api = {
    _docs: docs,
    async insertOne(d) { docs.push({ ...d }); return { insertedId: d._id }; },
    async findOne(q) { const d = docs.find((x) => matchQuery(x, q)); return d ? { ...d } : null; },
    async updateOne(q, u) {
      const d = docs.find((x) => matchQuery(x, q));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      const known = ['$set', '$inc', '$max'];
      for (const op of Object.keys(u)) if (!known.includes(op)) throw new Error('mock 不支援更新運算子 ' + op);
      if (u.$set) Object.assign(d, u.$set);
      if (u.$inc) for (const k of Object.keys(u.$inc)) d[k] = (d[k] || 0) + u.$inc[k];
      // mongo 的 $max：欄位缺席時直接寫入；否則取較大者（單調前進）
      if (u.$max) for (const k of Object.keys(u.$max)) {
        d[k] = (typeof d[k] === 'number') ? Math.max(d[k], u.$max[k]) : u.$max[k];
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async countDocuments(q) { return docs.filter((x) => matchQuery(x, q || {})).length; },
    find(q) {
      let r = docs.filter((x) => matchQuery(x, q || {})).map((x) => ({ ...x }));
      const cur = {
        sort(sp) { r = sortDocs(r, sp); return cur; },
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
          for (const d of r) {
            const cur = g.get(d[key]) || { _id: d[key] };
            for (const f of Object.keys(st.$group)) {
              if (f === '_id') continue;
              const spec = st.$group[f];
              if (spec.$sum != null) cur[f] = (cur[f] || 0) + (typeof spec.$sum === 'number' ? spec.$sum : (d[String(spec.$sum).replace(/^\$/, '')] || 0));
              else if (spec.$max != null) { const v = d[String(spec.$max).replace(/^\$/, '')] || 0; cur[f] = Math.max(cur[f] || 0, v); }
              else throw new Error('mock aggregate 不支援累加器 ' + Object.keys(spec)[0]);
            }
            g.set(d[key], cur);
          }
          r = [...g.values()];
        } else throw new Error('mock aggregate 不支援 ' + Object.keys(st)[0]);
      }
      return { async toArray() { return r; } };
    },
    createIndex() { return Promise.resolve(); },
  };
  return api;
}
function makeRes() {
  const res = { statusCode: 200, body: null, headers: {}, ended: false };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  return res;
}

T('⭐⭐ mock 自我驗證：$max 單調（較舊的時間戳不會把較新的蓋回去）、$inc 正常', async () => {
  const c = makeColl();
  await c.insertOne({ _id: 'x', n: 0 });
  await c.updateOne({ _id: 'x' }, { $inc: { n: 1 }, $max: { t: 500 } });
  await c.updateOne({ _id: 'x' }, { $inc: { n: 1 }, $max: { t: 300 } });
  const d = c._docs[0];
  ok(d.n === 2, '$inc 壞了');
  ok(d.t === 500, '$max 不是單調（' + d.t + '）⇒ 下面的漂移斷言不可信');
});

/** 把 deck-posts 那段的 handler 抽出來、注入 mock 依賴。 */
const DP = (() => {
  const i = SAP.indexOf('v6.138 批次1：牌組公布欄（deckPosts）後端');
  const j = SAP.indexOf('[deck-posts] init failed', i);
  ok(i >= 0 && j > i, '抓不到 deckPosts 區段');
  return SAP.slice(i, j);
})();
ok(DP.length > 3000, 'deckPosts 區段太短，掃描器壞了');

/** 從真正的 `app.get('/api/deck-posts', …)` handler 原文裡把 sort 白名單那一行**求值**出來。 */
function evalSortSpec(sortParam) {
  const k = DP.indexOf("app.get('/api/deck-posts',");
  ok(k > 0, '找不到列表端點');
  const seg = DP.slice(k, k + 3000);
  const m = seg.match(/const sort = \(\{[\s\S]*?\}\)\[[^\]]*\] \|\| \{[^}]*\};/);
  ok(m, '抓不到列表端點的 sort 白名單那一行（掃描器 anchor 失效）');
  // eslint-disable-next-line no-new-func
  const f = new Function('req', m[0] + '\nreturn sort;');
  return f({ query: { sort: sortParam } });
}

T('⭐⭐⭐ 列表端點的 sort 白名單真的認得 comments（求值真正的那一行，不是字串比對）', () => {
  const spec = evalSortSpec('comments');
  ok(JSON.stringify(spec) === JSON.stringify({ lastCommentAt: -1, createdAt: -1 }),
    '「最新留言」的排序條件不是 {lastCommentAt:-1, createdAt:-1}：' + JSON.stringify(spec));
  ok(JSON.stringify(evalSortSpec('new')) === JSON.stringify({ createdAt: -1 }), '既有的「最新」排序被改壞了');
  ok(JSON.stringify(evalSortSpec('likes')) === JSON.stringify({ likeCount: -1, createdAt: -1 }), '既有的「最多讚」排序被改壞了');
  ok(JSON.stringify(evalSortSpec('亂填')) === JSON.stringify({ createdAt: -1 }), '未知 sort 值沒有退回預設');
});

T('⭐⭐⭐ 「最新留言」排序：有留言的在前、無留言的在後且彼此依發布時間穩定', () => {
  const spec = evalSortSpec('comments');
  const docs = [
    { _id: 'A無留言舊', lastCommentAt: 0, createdAt: 100 },
    { _id: 'B有留言舊', lastCommentAt: 500, createdAt: 200 },
    { _id: 'C無留言新', lastCommentAt: 0, createdAt: 900 },
    { _id: 'D有留言新', lastCommentAt: 800, createdAt: 300 },
  ];
  const r = sortDocs(docs, spec).map((d) => d._id);
  ok(JSON.stringify(r) === JSON.stringify(['D有留言新', 'B有留言舊', 'C無留言新', 'A無留言舊']),
    '「最新留言」排序不正確：' + JSON.stringify(r));
  // 穩定性：同一批資料排兩次結果必須一致（沒有任何隨機/浮動）
  ok(JSON.stringify(sortDocs(docs, spec).map((d) => d._id)) === JSON.stringify(r), '排序不穩定');
});

T('⭐⭐ 新投稿一定寫 lastCommentAt: 0（不能留空 —— 缺席在 descending 會排到 0 之後、名次分裂）', () => {
  const seg = DP.slice(DP.indexOf('commentCount: 0,'), DP.indexOf('commentCount: 0,') + 600);
  ok(/lastCommentAt:\s*0/.test(seg), '新投稿沒有把 lastCommentAt 初始化成 0');
  // 行為端：缺席與 0 在 descending 下確實不同群 ⇒ 上面那條不是形式主義
  const r = sortDocs([{ _id: 'zero', lastCommentAt: 0, createdAt: 1 }, { _id: 'miss', createdAt: 9 }],
    { lastCommentAt: -1, createdAt: -1 }).map((d) => d._id);
  ok(JSON.stringify(r) === '["zero","miss"]', '缺席欄位與 0 竟然同群 —— 初始化那條就沒有意義了');
});

function buildDpHandlers(deps) {
  const src = [
    extractFn(DP, 'dpCommentNormalize'),
    extractFn(DP, 'dpCommentPublic'),
    extractFn(DP, 'dpCommentCreate'),
    extractFn(DP, 'dpCommentDelete'),
    extractFn(DP, 'dpAdminRecount'),
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  const f = new Function('D', `
    const { DPOSTS, DPCOMM, DPLIKES, DPDOWNS, _dpListCache, dpIdentity, dpIdentitySoft,
            dpRate, dpRateRefund, dpIp, isTournAdmin, tournIdentity, getLastRegisteredNick,
            DP_CMT_MAX, DP_CMT_PAGE, DP_CMT_PER_MIN, DP_CMT_RESERVED_NAME } = D;
    ${src}
    return { dpCommentCreate, dpCommentDelete, dpAdminRecount };
  `);
  return f(deps);
}
function buildBackfill(deps) {
  // eslint-disable-next-line no-new-func
  const f = new Function('D', `
    const { DPOSTS, DPCOMM, _dpListCache } = D;
    ${extractFn(DP, 'dpBackfillLastCommentAt')}
    return dpBackfillLastCommentAt;
  `);
  return f(deps);
}
function makeEnv() {
  const DPOSTS = makeColl(), DPCOMM = makeColl(), DPLIKES = makeColl(), DPDOWNS = makeColl();
  const env = { DPOSTS, DPCOMM, DPLIKES, DPDOWNS, identity: { uid: 'u1', email: 'u1@x.com', name: 'U1', verified: true }, admins: ['u1@x.com'] };
  env.deps = {
    DPOSTS, DPCOMM, DPLIKES, DPDOWNS, _dpListCache: new Map(),
    async dpIdentity() { return env.identity; },
    async dpIdentitySoft() { return env.identity; },
    dpRate() { return true; },
    dpRateRefund() {},
    dpIp() { return '1.2.3.4'; },
    isTournAdmin(id) { return !!(id && id.verified && env.admins.includes(String(id.email).toLowerCase())); },
    async tournIdentity() { return env.identity; },
    async getLastRegisteredNick() { return '暱稱'; },
    DP_CMT_MAX: 300, DP_CMT_PAGE: 50, DP_CMT_PER_MIN: 10, DP_CMT_RESERVED_NAME: '系統管理員',
  };
  env.H = buildDpHandlers(env.deps);
  return env;
}
async function addComment(env, text, postId = 'dp_1') {
  const res = makeRes();
  await env.H.dpCommentCreate({ body: { postId, text }, headers: {} }, res);
  ok(res.statusCode === 200, '留言寫入失敗（可能是沙盒少注入相依）：' + JSON.stringify(res.body));
  return res.body.comment.id;
}
async function lca(env, postId = 'dp_1') { return (await env.DPOSTS.findOne({ _id: postId })).lastCommentAt; }

await TA('⭐⭐⭐ 新增留言 → lastCommentAt 真的被寫進 deckPosts（行為端，不是驗字串）', async () => {
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_1', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0, lastCommentAt: 0 });
  const t0 = await lca(env);
  ok(t0 === 0, '前置條件壞了');
  await addComment(env, '第一則');
  const t1 = await lca(env);
  ok(typeof t1 === 'number' && t1 > 0, '新增留言後 lastCommentAt 沒有被更新（' + t1 + '）');
  ok((await env.DPOSTS.findOne({ _id: 'dp_1' })).commentCount === 1, 'commentCount 沒有 +1（既有行為被改壞）');
});

await TA('⭐⭐⭐ 刪掉「最後一則」留言 → lastCommentAt 退回前一則（不漂移，不會永遠停在已刪那則）', async () => {
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_1', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0, lastCommentAt: 0 });
  const c1 = await addComment(env, '舊');
  // 手動把第一則的時間往前推，確保兩則時間不同（同一毫秒內建立時無法區分先後）
  env.DPCOMM._docs.find((d) => d._id === c1).createdAt -= 10_000;
  const t1 = env.DPCOMM._docs.find((d) => d._id === c1).createdAt;
  const c2 = await addComment(env, '新');
  const t2 = await lca(env);
  ok(t2 > t1, '第二則沒有推進 lastCommentAt');
  const res = makeRes();
  await env.H.dpCommentDelete({ params: { cid: c2 }, headers: {} }, res);
  ok(res.statusCode === 200 && res.body.changed === true, '刪除沒有成功');
  ok(await lca(env) === t1, '刪掉最後一則後 lastCommentAt 沒有退回前一則 ⇒ 排序永久漂移（現在是 ' + (await lca(env)) + '，應為 ' + t1 + '）');
  ok((await env.DPOSTS.findOne({ _id: 'dp_1' })).commentCount === 1, 'commentCount -1 的既有行為被改壞');
});

await TA('⭐⭐ 刪光所有留言 → lastCommentAt 回到 0（不是留著舊值、也不是欄位消失）', async () => {
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_1', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0, lastCommentAt: 0 });
  const c1 = await addComment(env, '唯一一則');
  await env.H.dpCommentDelete({ params: { cid: c1 }, headers: {} }, makeRes());
  const v = await lca(env);
  ok(v === 0, '刪光後 lastCommentAt 應為 0，實際 ' + JSON.stringify(v) + '（缺席會讓它在 descending 排到 0 之後）');
});

await TA('⭐⭐ 刪掉「不是最後一則」的留言 → lastCommentAt 不變（正對照，防止修成一刪就歸零）', async () => {
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_1', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0, lastCommentAt: 0 });
  const c1 = await addComment(env, '舊');
  env.DPCOMM._docs.find((d) => d._id === c1).createdAt -= 10_000;
  await addComment(env, '新');
  const before = await lca(env);
  await env.H.dpCommentDelete({ params: { cid: c1 }, headers: {} }, makeRes());
  ok(await lca(env) === before, '刪掉舊留言竟然改動了 lastCommentAt（' + (await lca(env)) + ' ≠ ' + before + '）');
});

await TA('⭐⭐⭐ 對帳端點 recount 修得回人為製造的 lastCommentAt 漂移，並回填舊投稿缺席的欄位', async () => {
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_1', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0, lastCommentAt: 0 });
  await env.DPOSTS.insertOne({ _id: 'dp_old', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0 }); // 舊投稿：欄位缺席
  await addComment(env, 'x');
  const good = await lca(env);
  // 人為製造漂移：把快照打壞（模擬「+1 那一發失敗」「刪到最後一則時重算失敗」）
  await env.DPOSTS.updateOne({ _id: 'dp_1' }, { $set: { lastCommentAt: 1, commentCount: 99 } });
  const res = makeRes();
  await env.H.dpAdminRecount({ headers: {} }, res);
  ok(res.statusCode === 200, 'recount 失敗：' + JSON.stringify(res.body));
  ok(await lca(env) === good, 'recount 沒有把 lastCommentAt 修回來（' + (await lca(env)) + ' ≠ ' + good + '）');
  ok((await env.DPOSTS.findOne({ _id: 'dp_1' })).commentCount === 1, 'recount 沒有把 commentCount 修回來');
  const oldDoc = await env.DPOSTS.findOne({ _id: 'dp_old' });
  ok(oldDoc.lastCommentAt === 0, '舊投稿（欄位缺席）沒有被回填成 0，實際 ' + JSON.stringify(oldDoc.lastCommentAt));
});

await TA('⭐⭐⭐ 啟動時自動回填 lastCommentAt：v6.182 起就有留言的舊投稿不會排到「沒有留言」的後面', async () => {
  // ⚠ 這是「上線當天就壞」的路徑：舊 doc 沒有這個欄位，descending 會把它排在 0 之後
  //   ⇒ 有留言的舊投稿反而墊底。靠站長手打一個沒有按鈕的 recount 端點才會好 ⇒ 必須自己補。
  const env = makeEnv();
  await env.DPOSTS.insertOne({ _id: 'dp_有留言舊', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 1 });  // 欄位缺席
  await env.DPOSTS.insertOne({ _id: 'dp_沒留言舊', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0 });  // 欄位缺席
  await env.DPOSTS.insertOne({ _id: 'dp_新', status: 'published', uid: 'a', likeCount: 0, downloadCount: 0, commentCount: 0, lastCommentAt: 0 });
  await env.DPCOMM.insertOne({ _id: 'dc_1', postId: 'dp_有留言舊', status: 'published', createdAt: 777 });
  await env.DPCOMM.insertOne({ _id: 'dc_2', postId: 'dp_有留言舊', status: 'deleted', createdAt: 999 });   // 軟刪的不可以算進去

  // 前置：證明「不回填」時排序確實是壞的（否則這條測試沒有意義）
  const spec = evalSortSpec('comments');
  const bad = sortDocs(env.DPOSTS._docs.map((d) => ({ ...d, createdAt: 0 })), spec).map((d) => d._id);
  ok(bad.indexOf('dp_有留言舊') > bad.indexOf('dp_新'), '前置條件不成立：欄位缺席竟然沒有排到 0 後面');

  const fn = buildBackfill(env.deps);
  const n = await fn();
  ok(n === 2, '回填筆數不對（' + n + '），應為 2 筆缺席的 doc');
  ok((await env.DPOSTS.findOne({ _id: 'dp_有留言舊' })).lastCommentAt === 777, '有留言的舊投稿沒有補上最後一則留言的時間');
  ok((await env.DPOSTS.findOne({ _id: 'dp_沒留言舊' })).lastCommentAt === 0, '沒留言的舊投稿沒有補成 0');
  const good = sortDocs(env.DPOSTS._docs.map((d) => ({ ...d, createdAt: 0 })), spec).map((d) => d._id);
  ok(good[0] === 'dp_有留言舊', '回填後有留言的舊投稿仍然沒有排到最前面：' + JSON.stringify(good));
  // 冪等：再跑一次應該 0 筆（不會每次啟動都重掃重寫）
  ok((await fn()) === 0, '回填不冪等 ⇒ 每次啟動都會全表重寫');
});

T('⭐ 前端排序列有「最新留言」按鈕，且沿用既有 .sorts 樣式與 changeSort 接線', () => {
  ok(/changeSort\('comments'\)/.test(DPPAGE), '前端沒有接上 comments 排序');
  ok(/class:active=\{sort === 'comments'\}/.test(DPPAGE), '「最新留言」按鈕沒有沿用既有的 active 樣式');
  ok(/'new' \| 'likes' \| 'downloads' \| 'comments'/.test(DPPAGE), 'sort 型別沒有加上 comments ⇒ tsc 會擋');
  const seg = DPPAGE.slice(DPPAGE.indexOf('<div class="sorts">'), DPPAGE.indexOf('<div class="sorts">') + 700);
  ok(/最新留言/.test(seg), '「最新留言」按鈕不在既有的 .sorts 容器內（樣式會不一致）');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n② 對戰通知：「不需要操作 → 需要操作」單一述詞（行為端實跑決策核心）');
// ══════════════════════════════════════════════════════════════════════

T('⭐⭐⭐ 對戰頁**不再**用回合換手 edge 發通知（那是補位不跳通知的真因）', () => {
  ok(!/notifyTurn\s*\(/.test(PAGE), '對戰頁還在呼叫 notifyTurn（edge-trigger）⇒ 補位／選擇／開局一律漏通知');
  ok(/notifyAct\(room, buildActNeed\(/.test(PAGE), '對戰頁沒有接上 level 掃描的 notifyAct');
  // ⚠「誰該動作」只能有一份判準：必須是 tCurrentActorSeat 的結果，不可以就地再拄一份條件
  const i = PAGE.indexOf('notifyAct(room, buildActNeed(');
  const seg = PAGE.slice(i - 400, i + 200);
  ok(/tCurrentActorSeat\(g\)/.test(seg), '通知沒有用 tCurrentActorSeat（與伺服器逐行同步的那份判準）算誰該動作');
  ok(/resetActNotify\(\)/.test(seg), '離開對戰時沒有清鏈式狀態 ⇒ 下一場第一個需求會被誤判成延續而漏響');
});

const S = join(ROOT, '.v6185-s.js'), E = join(ROOT, '.v6185-e.ts'), O = join(ROOT, '.v6185-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* ignore */ } } });

let M = null, buildErr = '';
try {
  const { build } = await import('esbuild');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, [
    "export { decideActNotify, buildActNeed, ACT_RING_BURST_MAX, ACT_RING_BURST_WINDOW_MS } from './src/lib/notify-core';",
    "export { notifyAct, resetActNotify, saveNotifyEnabled } from './src/lib/notify';",
    '// ⭐ 從對戰頁**原文**抽出來的「誰該動作」判準（與伺服器 currentActorSeat 逐行同步的那一份）',
    extractFn(PAGE, 'setupActorSeat'),
    extractFn(PAGE, 'tCurrentActorSeat'),
    'export { setupActorSeat, tCurrentActorSeat };',
  ].join('\n'));
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
} catch (e) { buildErr = String((e && e.message) || e); }

// ── 瀏覽器 API 的假替身（必須在 import 之前裝好）──
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { hidden: true };
const FIRED = [];
class FakeNotification { constructor(title, opts) { FIRED.push({ title, ...(opts || {}) }); } }
FakeNotification.permission = 'granted';
globalThis.Notification = FakeNotification;
// ⚠ node ≥21 的 navigator 是唯讀 getter，直接指派會 throw
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });

if (!buildErr) {
  try { M = await import(pathToFileURL(O).href); } catch (e) { buildErr = String((e && e.message) || e); }
}
if (buildErr) {
  console.log('  ✗ ⭐⭐⭐ 通知模組載入失敗（buildActNeed / decideActNotify / notifyAct 不存在？）\n      ' + buildErr);
  fail++;
}

if (M) {
  const { buildActNeed, notifyAct, resetActNotify, saveNotifyEnabled, tCurrentActorSeat, ACT_RING_BURST_MAX } = M;
  T('⭐⭐⭐ 通知模組必要的 export 都在（少一個 ⇒ 補位／選擇／開局通知整條不存在）', () => {
    for (const n of ['buildActNeed', 'decideActNotify', 'notifyAct', 'resetActNotify', 'tCurrentActorSeat', 'setupActorSeat', 'saveNotifyEnabled']) {
      ok(typeof M[n] === 'function', '缺少 export：' + n);
    }
    ok(typeof M.ACT_RING_BURST_MAX === 'number', '缺少爆量上限常數 ACT_RING_BURST_MAX');
  });
  saveNotifyEnabled(true);
  const ROOM = 'mr_1', ME = 0, OPP = 1;

  /** 合成盤面。預設：對手回合、雙方都有戰鬥寶可夢、沒有 pending。 */
  const G = (o = {}) => ({
    phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: OPP,
    players: [
      { active: { iid: 'me-a' }, bench: [{ iid: 'me-b' }] },
      { active: { iid: 'op-a' }, bench: [{ iid: 'op-b' }] },
    ],
    pendingPrizes: [0, 0], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true],
    mulliganPostBenchOpen: [false, false], openingChoicePending: [false, false],
    ...o,
  });
  /** 走一次「盤面落地 → 掃描 → 決定要不要通知」，回傳這一步發出的通知（沒有則 null）。 */
  async function step(g) {
    const before = FIRED.length;
    notifyAct(ROOM, buildActNeed(g, ME, g ? tCurrentActorSeat(g) : null, ROOM));
    await new Promise((r) => setTimeout(r, 0));   // showIntent 是 async
    return FIRED.length > before ? FIRED[FIRED.length - 1] : null;
  }
  const rings = (a) => a.filter((x) => x && x.silent !== true).length;
  function fresh() { FIRED.length = 0; resetActNotify(); globalThis.document.hidden = true; }

  await TA('⭐⭐⭐ 環境自我驗證：背景時「輪到我的回合」真的會發出通知（否則以下全部不可信）', async () => {
    fresh();
    ok(await step(G()) === null, '對手回合竟然發了通知');
    const n = await step(G({ activePlayerIndex: ME }));
    ok(n && /輪到你行動/.test(n.title), '輪到我的回合沒有發出通知：' + JSON.stringify(n));
    ok(n.tag === 'ptcg-t-turn-' + ROOM, '沒有沿用同房間同 tag（通知會疊加而不是覆蓋）');
  });

  await TA('⭐⭐⭐ ②站長回報的缺口：戰鬥寶可夢昏厥、要放上新的戰鬥寶可夢時會通知', async () => {
    fresh();
    ok(await step(G()) === null, '前置：對手回合不該通知');
    const n = await step(G({ players: [{ active: null, bench: [{ iid: 'me-b' }] }, { active: { iid: 'op-a' }, bench: [] }] }));
    ok(n, '補位（SEND_NEW_ACTIVE）完全沒有通知 —— 這就是站長回報的 bug');
    ok(/戰鬥寶可夢/.test(n.title), '補位通知的內容不對：' + n.title);
    ok(n.silent !== true, '第一次通知就靜默 ⇒ 玩家不會發現');
  });

  await TA('⭐⭐⭐ ③補位完成後**馬上**輪到我 ⇒ 不會連續響第二次（站長點名的難題）', async () => {
    fresh();
    await step(G());                                                             // 對手回合，我沒事
    await step(G({ players: [{ active: null, bench: [{ iid: 'b' }] }, { active: { iid: 'op-a' }, bench: [] }] }));  // 昏厥→補位
    await step(G({ activePlayerIndex: ME }));                                      // 補完，緊接著換我的回合
    ok(FIRED.length === 2, '應該送出 2 則（第二則只是更新內容），實際 ' + FIRED.length);
    ok(rings(FIRED) === 1, '連續響了 ' + rings(FIRED) + ' 次 —— 通知轟炸');
    ok(FIRED[1].silent === true && FIRED[1].renotify !== true, '第二則沒有降級成靜默更新');
    ok(FIRED[0].tag === FIRED[1].tag, '兩則 tag 不同 ⇒ 通知中心會堆兩則');
  });

  await TA('⭐⭐⭐ ④正對照：補位後對手還有動作、之後才輪到我 ⇒ **仍然要響**（防止修成漏通知）', async () => {
    fresh();
    await step(G());
    await step(G({ players: [{ active: null, bench: [{ iid: 'b' }] }, { active: { iid: 'op-a' }, bench: [] }] }));  // 補位 → 響
    await step(G());                                                              // 我補完了，對手還在打他的回合（我不需要操作）
    await step(G());                                                              // 對手又做了一件事
    await step(G({ activePlayerIndex: ME }));                                      // 他結束回合 → 輪到我
    ok(rings(FIRED) === 2, '應該響 2 次（補位 1 次＋輪到我 1 次），實際 ' + rings(FIRED) + ' 次 ⇒ 該通知卻被吃掉');
  });

  await TA('⭐⭐⭐ ⑤對手回合中、因為對手的卡片效果要我做選擇 ⇒ 會通知', async () => {
    fresh();
    await step(G());
    const n = await step(G({ pendingSelection: { actorIdx: ME, sourcePlayerIdx: OPP, token: 11 } }));
    ok(n, '對手效果要我做選擇時沒有通知');
    ok(/選擇/.test(n.title), '文案不對：' + n.title);
    // 反面：pending 是**對手**要選的（我只是在等）⇒ 絕不通知
    fresh();
    await step(G());
    ok(await step(G({ pendingSelection: { actorIdx: OPP, sourcePlayerIdx: ME, token: 12 } })) === null,
      '對手在做選擇時竟然通知我 ⇒ 通知轟炸');
  });

  await TA('⭐⭐ 同一個選擇視窗被輪詢重複看到 ⇒ 只發一次；換成新的視窗（token 變）⇒ 才算新需求', async () => {
    fresh();
    await step(G());
    await step(G({ pendingSelection: { actorIdx: ME, token: 11 } }));
    await step(G({ pendingSelection: { actorIdx: ME, token: 11 } }));
    await step(G({ pendingSelection: { actorIdx: ME, token: 11 } }));
    ok(FIRED.length === 1, '同一個 picker 被重複觀察就重複通知（' + FIRED.length + ' 則）⇒ 轟炸');
  });

  await TA('⭐⭐ 取獎賞卡、開局階段輪到我 ⇒ 都會通知（同一個述詞涵蓋，不必各加一個通知點）', async () => {
    fresh();
    await step(G());
    const p = await step(G({ pendingPrizes: [1, 0] }));
    ok(p && /獎賞/.test(p.title), '該我選取獎賞卡時沒有通知：' + JSON.stringify(p));
    fresh();
    const s = await step(G({ phase: 'setup', setupDone: [false, false], activePlayerIndex: OPP }));
    ok(s && /開局/.test(s.title), '開局階段輪到我時沒有通知：' + JSON.stringify(s));
  });

  await TA('⭐⭐ ⑥既有行為不變：前景一律不發、關閉/無權限不發、game-over 不發', async () => {
    fresh();
    globalThis.document.hidden = false;
    await step(G());
    await step(G({ activePlayerIndex: ME }));
    ok(FIRED.length === 0, '前景竟然發了通知（v6.022 的「不干擾」規則被改壞）');
    fresh();
    saveNotifyEnabled(false);
    await step(G()); await step(G({ activePlayerIndex: ME }));
    ok(FIRED.length === 0, '玩家關掉通知偏好還是發了');
    saveNotifyEnabled(true);
    fresh();
    FakeNotification.permission = 'default';
    await step(G()); await step(G({ activePlayerIndex: ME }));
    ok(FIRED.length === 0, '沒有通知權限還是發了');
    FakeNotification.permission = 'granted';
    fresh();
    await step(G()); 
    ok(await step(G({ phase: 'game-over', activePlayerIndex: ME })) === null, '對局已結束還叫玩家回來操作');
  });

  await TA('⭐⭐⭐ 爆量上限只降級成靜默、**絕不 drop**（該通知被吃掉比重複通知嚴重）', async () => {
    fresh();
    // 造出遠超上限的「需求出現→消失」交替
    for (let i = 0; i < ACT_RING_BURST_MAX + 4; i++) {
      await step(G());                                                            // 不需要操作
      await step(G({ turn: 5 + i, activePlayerIndex: ME }));                       // 輪到我（每次都是新 key）
    }
    const want = ACT_RING_BURST_MAX + 4;
    ok(FIRED.length === want, '有通知被 drop 掉了（送出 ' + FIRED.length + ' / 應為 ' + want + '）');
    ok(rings(FIRED) === ACT_RING_BURST_MAX, '出聲次數 ' + rings(FIRED) + '，應被壓在上限 ' + ACT_RING_BURST_MAX);
    ok(FIRED[want - 1].silent === true, '超過上限的那幾則沒有降級成靜默');
  });

  await TA('⭐⭐⭐ 雙方同時昏厥：我是 P2 也要收到補位通知（tCurrentActorSeat 只會點名一個座位）', async () => {
    fresh();
    // 站在 P2（idx 1）的視角重跑一次
    const both = { players: [{ active: null, bench: [{ iid: 'a' }] }, { active: null, bench: [{ iid: 'b' }] }] };
    const seat = tCurrentActorSeat(G(both));
    ok(seat === 0, '前置條件變了：tCurrentActorSeat 雙方皆空時不再固定回 0（實際 ' + seat + '）');
    notifyAct(ROOM, buildActNeed(G(both), 1, seat, ROOM));
    await new Promise((r) => setTimeout(r, 0));
    ok(FIRED.length === 1 && /戰鬥寶可夢/.test(FIRED[0].title),
      'P2 在雙方同時昏厥時收不到補位通知（伺服器只點名 P1）：' + JSON.stringify(FIRED));
    // 反面：備戰區是空的（等著判輸，沒有任何操作可做）⇒ 不打擾
    fresh();
    notifyAct(ROOM, buildActNeed(G({ players: [{ active: null, bench: [] }, { active: { iid: 'x' }, bench: [] }] }), ME, 0, ROOM));
    await new Promise((r) => setTimeout(r, 0));
    ok(FIRED.length === 0, '備戰區空、根本沒得補位還通知 ⇒ 純打擾');
  });

  await TA('⭐⭐⭐ 離開對戰再回來 ⇒ 第一個需求照響（殘留的鏈式狀態不可以把它吃掉）', async () => {
    fresh();
    await step(G());
    await step(G({ players: [{ active: null, bench: [{ iid: 'b' }] }, { active: { iid: 'op-a' }, bench: [] }] }));
    ok(rings(FIRED) === 1, '前置條件壞了');
    resetActNotify();                       // ← 對戰頁在離開對戰時做的事
    FIRED.length = 0;
    const n = await step(G({ activePlayerIndex: ME }));
    ok(n && n.silent !== true, '重新進場後第一個需求被殘留狀態吃成靜默/沒發 ⇒ 漏通知');
  });
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
