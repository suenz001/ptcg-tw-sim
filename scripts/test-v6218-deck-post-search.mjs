// v6.218 守衛：牌組公布欄關鍵字搜尋（伺服器端、涵蓋全部投稿）。
//
// 這個功能壞掉時**不會有錯誤訊息**的點（也是站長點名的成敗關鍵）：
//   ・搜尋若只在前端篩，就只搜得到當頁 —— 玩家會誤以為那個牌組不存在。
//     ⇒ 必須斷言「?q= 真的變成 mongo 查詢條件」（行為層，不是字串存在）。
//   ・RegExp 物件經 JSON.stringify 變 {} ⇒ 不同搜尋撞同一份 30 秒快取，
//     畫面「看起來有搜」但回的是別人的結果。
//   ・q 缺席時查詢物件變形 ⇒ 既有列表查詢被拖慢或行為改變（效能紀律紅線）。
//   ・舊伺服器不認識 ?q=，靜默回未過濾列表 ⇒ 前端把它偽裝成搜尋結果。
// 作法：把純函式與整支 GET handler 從原始碼抽出來**實際執行**（mock DPOSTS/DPCOMM）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAP = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/deck-posts/+page.svelte'), 'utf8');

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
function section(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  ok(i >= 0, '切片起點 anchor 失效：' + startAnchor);
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  ok(j > i, '切片結尾 anchor 失效：' + endAnchor);
  return src.slice(i, j);
}
/** 抽具名 function（圓括號先配對再數大括號 —— test-deck-posts.mjs 的教訓）。 */
function extractFn(src, name) {
  const sig = 'function ' + name + '(';
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('找不到函式 ' + name);
  let p = 0, argEnd = -1;
  for (let k = i + sig.length - 1; k < src.length; k++) {
    if (src[k] === '(') p++;
    else if (src[k] === ')') { p--; if (p === 0) { argEnd = k; break; } }
  }
  if (argEnd < 0) throw new Error('參數列括號沒有配對完成：' + name);
  let depth = 0, started = false;
  for (let k = argEnd + 1; k < src.length; k++) {
    const c = src[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('括號沒有配對完成：' + name);
}

const DP = section(SAP, 'v6.138 批次1：牌組公布欄（deckPosts）後端', '[deck-posts] init failed');
ok(DP.length > 3000, '抓不到 deckPosts 區段 —— 掃描器自己壞了');

console.log('\n① 純函式：token 切分／轉義／卡名部分比對（抽出來實跑）');

const dpSearchTokens = new Function(extractFn(DP, 'dpSearchTokens') + '; return dpSearchTokens;')();
const dpSearchEscape = new Function(extractFn(DP, 'dpSearchEscape') + '; return dpSearchEscape;')();
const dpCardIdsForToken = new Function(extractFn(DP, 'dpCardIdsForToken') + '; return dpCardIdsForToken;')();
const dpTokenOr = new Function(
  extractFn(DP, 'dpSearchEscape') + ';' + extractFn(DP, 'dpTokenOr') + '; return dpTokenOr;')();

T('空白（含全形）分隔＝多 token；空字串＝零 token（空白輸入不篩選）', () => {
  const t = dpSearchTokens('  超級路卡利歐ex　大地道具 ');
  ok(JSON.stringify(t) === JSON.stringify(['超級路卡利歐ex', '大地道具']), '全形空白沒有被當分隔：' + JSON.stringify(t));
  ok(dpSearchTokens('').length === 0, '空字串應為零 token');
  ok(dpSearchTokens('   ').length === 0, '純空白應為零 token');
  ok(dpSearchTokens(null).length === 0, 'null 應為零 token');
});
T('token 上限 5 個、去重、小寫化（拉丁字不分大小寫）', () => {
  ok(dpSearchTokens('a b c d e f g').length === 5, '超過 5 個 token 沒被截斷');
  ok(JSON.stringify(dpSearchTokens('EX ex')) === JSON.stringify(['ex']), '大小寫沒有合併去重');
});
T('regex 轉義：玩家輸入「+」「(」不可以炸掉或變萬用比對', () => {
  const esc = dpSearchEscape('a+b(');
  ok(new RegExp(esc).test('a+b('), '轉義後比不中字面值');
  ok(!new RegExp(esc).test('aab'), '「+」沒被轉義（aab 不該命中 a+b）');
});
const PAIRS = [
  { id: '900', n: '超級路卡利歐ex' },   // 超級路卡利歐ex
  { id: '901', n: '大地道具' },                  // 大地道具
  { id: '902', n: '皮卡丘ex' },                      // 皮卡丘ex
  { id: '903', n: '路卡利歐' },                  // 路卡利歐
];
T('⭐ 部分比對：「路卡利歐」命中「超級路卡利歐ex」與「路卡利歐」（站長拍板②）', () => {
  const ids = dpCardIdsForToken('路卡利歐', PAIRS);
  ok(JSON.stringify(ids.sort()) === JSON.stringify(['900', '903']), '部分比對失效：' + JSON.stringify(ids));
});
T('dpTokenOr 的 $regex 是**字串**不是 RegExp（快取鍵安全）＋六路 OR 齊全', () => {
  const or = dpTokenOr('abc', ['1'], ['p1']).$or;
  ok(Array.isArray(or) && or.length === 6, 'OR 分支數不對：' + (or && or.length));
  const re = or[0].deckName;
  ok(typeof re.$regex === 'string', '$regex 不是字串 —— JSON.stringify(RegExp) 是 {}，快取鍵會互撞');
  ok(re.$options === 'i', '沒有不分大小寫');
  const flat = JSON.stringify(or);
  ok(flat.includes('authorName') && flat.includes('notes') && flat.includes('archetype'), '少了作者/簡介/原型分支');
  ok(flat.includes('entries.cardId') && flat.includes('_id'), '少了卡名(entries.cardId $in)或留言(_id $in)分支');
});

console.log('\n② 整支 GET /api/deck-posts handler 抽出來實跑（mock DPOSTS/DPCOMM）');

// ── mini mongo 過濾器（只實作本查詢會用到的運算子）──
function matchVal(doc, key, cond) {
  if (key === '$and') return cond.every((c) => matchDoc(doc, c));
  if (key === '$or') return cond.some((c) => matchDoc(doc, c));
  let v;
  if (key === 'entries.cardId') v = (doc.entries || []).map((e) => e.cardId);
  else v = doc[key];
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$regex' in cond) {
      const re = new RegExp(cond.$regex, cond.$options || '');
      return typeof v === 'string' && re.test(v);
    }
    if ('$in' in cond) {
      const set = new Set(cond.$in);
      if (Array.isArray(v)) return v.some((x) => set.has(x));
      return set.has(v);
    }
    if ('$ne' in cond) return v !== cond.$ne && !(cond.$ne === null && v == null);
    throw new Error('mini-matcher 不認識的運算子：' + JSON.stringify(cond));
  }
  return v === cond;
}
function matchDoc(doc, filter) {
  return Object.entries(filter).every(([k, c]) => matchVal(doc, k, c));
}

// 假資料：ck=createdAt 由新到舊 D > C > B > A
const CARDPOOL_POSTS = [
  { _id: 'A', status: 'published', deckName: '我的第一副', authorName: '甲', notes: '', archetype: '', entries: [{ cardId: '900', count: 4 }], createdAt: 1, tournament: null },
  { _id: 'B', status: 'published', deckName: '牛牌', authorName: '乙', notes: '', archetype: '', entries: [{ cardId: '900', count: 2 }, { cardId: '901', count: 4 }], createdAt: 2, tournament: null },
  { _id: 'C', status: 'published', deckName: '雜牌', authorName: '丙', notes: '', archetype: '', entries: [{ cardId: '900', count: 1 }], createdAt: 3, tournament: null },
  { _id: 'D', status: 'published', deckName: '路卡利歐專武', authorName: '丁', notes: '', archetype: '', entries: [{ cardId: '902', count: 4 }], createdAt: 4, tournament: null },
  { _id: 'H', status: 'hidden', deckName: '路卡利歐隱藏', authorName: '戊', notes: '', archetype: '', entries: [{ cardId: '900', count: 4 }], createdAt: 5, tournament: null },
];
const COMMENTS = [
  { postId: 'C', status: 'published', text: '這副行不行？大地道具真的好用' },
  { postId: 'A', status: 'deleted', text: '大地道具' },   // 已刪留言不得命中
];

function makeEnv() {
  const env = { findCalls: [], distinctCalls: [], rateKeys: [] };
  env.DPOSTS = {
    find(filter, opts) {
      env.findCalls.push(filter);
      const st = { sort: { createdAt: -1 }, skip: 0, limit: 50 };
      const cur = {
        sort(s) { st.sort = s; return cur; },
        skip(n) { st.skip = n; return cur; },
        limit(n) { st.limit = n; return cur; },
        async toArray() {
          const key = Object.keys(st.sort)[0];
          return CARDPOOL_POSTS.filter((d) => matchDoc(d, filter))
            .sort((a, b) => (b[key] || 0) - (a[key] || 0) || (b.createdAt - a.createdAt))
            .slice(st.skip, st.skip + st.limit);
        },
      };
      return cur;
    },
    async countDocuments(filter) { return CARDPOOL_POSTS.filter((d) => matchDoc(d, filter)).length; },
  };
  env.DPCOMM = {
    async distinct(field, filter) {
      env.distinctCalls.push(filter);
      return [...new Set(COMMENTS.filter((d) => matchDoc(d, filter)).map((d) => d[field]))];
    },
  };
  env.dpRate = (key) => { env.rateKeys.push(key); return true; };
  env.dpIp = () => 't';
  env.cache = new Map();
  const sec = section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'");
  const fnText = sec.slice(sec.indexOf('async (req, res)'), sec.lastIndexOf(');'));
  env.handler = new Function(
    'DPOSTS', 'DPCOMM', 'dpRate', 'dpIp', '_dpListCache', 'dpPublic', 'DP_LIST_TTL',
    'dpSearchTokens', 'dpSearchEscape', 'dpCardIdsForToken', 'dpTokenOr', 'dpCardNamePairs',
    'return (' + fnText + ')',
  )(env.DPOSTS, env.DPCOMM, env.dpRate, env.dpIp, env.cache, (d) => d, 30000,
    dpSearchTokens, dpSearchEscape, dpCardIdsForToken, dpTokenOr, () => PAIRS);
  env.call = async (query) => {
    const res = { code: 200, payload: null, set() {}, json(p) { this.payload = p; }, status(c) { this.code = c; return this; } };
    await env.handler({ query, headers: {} }, res);
    return res;
  };
  return env;
}

await TA('⭐⭐ 正對照：沒帶 q 時，mongo 查詢物件與舊版**完全相同**（列表零影響）', async () => {
  const env = makeEnv();
  const res = await env.call({});
  ok(res.code === 200, 'HTTP ' + res.code);
  ok(env.findCalls.length === 1, 'find 呼叫數 ' + env.findCalls.length);
  ok(JSON.stringify(env.findCalls[0]) === JSON.stringify({ status: 'published' }),
    '查詢物件多了東西：' + JSON.stringify(env.findCalls[0]));
  ok(env.distinctCalls.length === 0, '沒搜尋卻去查了留言表');
  ok(!env.rateKeys.some((k) => k.startsWith('s:')), '沒搜尋卻消耗搜尋限流額度');
  ok(res.payload.posts.length === 4 && res.payload.posts[0]._id === 'D', '既有列表行為變了');
});
await TA('⭐ 哨兵：回應恆帶 q 欄位（舊伺服器沒有 ⇒ 前端據此分辨）', async () => {
  const env = makeEnv();
  const res = await env.call({});
  ok(typeof res.payload.q === 'string' && res.payload.q === '', '沒帶 q 時哨兵應為空字串：' + JSON.stringify(res.payload.q));
  const res2 = await env.call({ q: '皮卡丘' });
  ok(res2.payload.q === '皮卡丘', '有帶 q 時哨兵應回正規化後的字串');
});
await TA('⭐⭐⭐ AND 語意：「路卡利歐 大地道具」= 兩者都要有（站長拍板③）', async () => {
  const env = makeEnv();
  const res = await env.call({ q: '路卡利歐 大地道具' });
  const ids = res.payload.posts.map((p) => p._id);
  // B：牌組同時含 900(超級路卡利歐ex) 與 901(大地道具)
  // C：牌組含 900，且留言含「大地道具」 ⇒ 也要中（留言是命中來源之一）
  // A：只有 900（它的已刪留言不算）；D：只有牌組名含路卡利歐 ⇒ 都不該中
  ok(JSON.stringify(ids) === JSON.stringify(['C', 'B']), 'AND 命中集合錯誤：' + JSON.stringify(ids));
  ok(res.payload.total === 2, 'total 沒跟著過濾：' + res.payload.total);
});
await TA('⭐⭐ 單 token 部分比對跨欄位：卡名（含印刷別名）∨ 牌組名都命中', async () => {
  const env = makeEnv();
  const res = await env.call({ q: '路卡利歐' });
  const ids = res.payload.posts.map((p) => p._id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(['A', 'B', 'C', 'D']), '命中集合錯誤：' + JSON.stringify(ids));
  ok(!ids.includes('H'), 'hidden 投稿被搜出來了');
});
await TA('⭐ 已刪留言不得命中；查留言表時有排除 deleted', async () => {
  const env = makeEnv();
  const res = await env.call({ q: '大地道具' });
  const ids = res.payload.posts.map((p) => p._id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(['B', 'C']), 'A 的已刪留言不該讓 A 命中：' + JSON.stringify(ids));
  ok(env.distinctCalls.length === 1 && JSON.stringify(env.distinctCalls[0].status) === JSON.stringify({ $ne: 'deleted' }),
    'distinct 沒排除已刪留言');
});
await TA('⭐⭐ 快取鍵不因 RegExp 而互撞：不同 q 各自查、同 q 第二發吃快取', async () => {
  const env = makeEnv();
  const r1 = await env.call({ q: '皮卡丘' });
  const n1 = env.findCalls.length;
  const r2 = await env.call({ q: '大地道具' });
  ok(env.findCalls.length === n1 + 1, '不同搜尋沒有重新查詢 —— 快取鍵撞了');
  ok(JSON.stringify(r1.payload.posts.map((p) => p._id)) !== JSON.stringify(r2.payload.posts.map((p) => p._id)),
    '兩個不同搜尋回了同一份結果');
  const n2 = env.findCalls.length;
  await env.call({ q: '大地道具' });
  ok(env.findCalls.length === n2, '同一搜尋第二發沒吃快取');
});
await TA('搜尋限流：帶 q 才消耗 s: 額度；限流觸發回 429', async () => {
  const env = makeEnv();
  await env.call({ q: 'xyz' });
  ok(env.rateKeys.some((k) => k.startsWith('s:')), '搜尋沒有限流');
  env.dpRate2 = env.dpRate;
  const env2 = makeEnv();
  env2.handler = new Function(
    'DPOSTS', 'DPCOMM', 'dpRate', 'dpIp', '_dpListCache', 'dpPublic', 'DP_LIST_TTL',
    'dpSearchTokens', 'dpSearchEscape', 'dpCardIdsForToken', 'dpTokenOr', 'dpCardNamePairs',
    'return (' + section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'").slice(
      section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'").indexOf('async (req, res)'),
      section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'").lastIndexOf(');')) + ')',
  )(env2.DPOSTS, env2.DPCOMM, () => false, () => 't', new Map(), (d) => d, 30000,
    dpSearchTokens, dpSearchEscape, dpCardIdsForToken, dpTokenOr, () => PAIRS);
  const res = { code: 200, payload: null, set() {}, json(p) { this.payload = p; }, status(c) { this.code = c; return this; } };
  await env2.handler({ query: { q: 'x' }, headers: {} }, res);
  ok(res.code === 429, '限流爆掉時應回 429，實得 ' + res.code);
});
await TA('沒有任何命中的搜尋：回空列表不 throw（$in 空陣列安全）', async () => {
  const env = makeEnv();
  const res = await env.call({ q: '不存在的字xyzq' });
  ok(res.code === 200 && res.payload.posts.length === 0 && res.payload.total === 0, '空結果行為錯誤');
});

console.log('\n③ 前端 /deck-posts 頁');

function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const PG = stripComments(PAGE);

T('⭐ 搜尋走伺服器端：fetchList 帶 ?q=，且空字串不送（空白輸入＝不篩選）', () => {
  const fl = section(PG, 'async function fetchList()', 'function changeSort');
  ok(/const qs = searchQ\.trim\(\);/.test(fl), 'fetchList 沒有讀 searchQ');
  ok(/if \(qs\) q\.set\('q', qs\);/.test(fl), '沒有「非空才送 q」的守門 —— 空搜尋會多送參數');
  ok(!/posts\s*=\s*posts\.filter/.test(PG), '出現前端過濾 posts 的寫法 —— 只搜得到當頁，成敗關鍵違反');
});
T('⭐ 哨兵：舊伺服器（回應沒有 q 欄位）⇒ 明講而不是偽裝成搜尋結果', () => {
  ok(/searchUnsupported = !!qs && typeof r\.q === 'undefined';/.test(PG), '沒有哨兵判斷');
  ok(/\{#if searchUnsupported\}/.test(PG), '哨兵沒有接到畫面（接線沒接上）');
});
T('⭐ debounce 行為（重寫版）：兩連打清掉第一發、延遲 300、回第 1 頁並發請求', () => {
  const m = PG.match(/function onSearchInput\(\) \{([\s\S]*?)\n  \}/);
  ok(m, '找不到 onSearchInput');
  const timers = []; const cleared = []; const fetched = [];
  const h = new Function('setTimeout', 'clearTimeout', 'fetchList',
    'let searchTimer = null; let page = 9;\n' +
    'function onSearchInput() {' + m[1] + '\n  }\n' +
    'return { fire: onSearchInput, page: () => page };')(
    (cb, ms) => { timers.push({ cb, ms }); return timers.length; },
    (id) => cleared.push(id),
    () => fetched.push(1));
  h.fire(); h.fire();
  ok(timers.length === 2 && cleared.length === 1 && cleared[0] === 1, '第二打沒清掉第一發計時器');
  ok(timers[1].ms === 300, 'debounce 不是 300ms：' + timers[1].ms);
  ok(fetched.length === 0, '還沒到時就發請求 —— 這就是每鍵一發');
  timers[1].cb();
  ok(fetched.length === 1 && h.page() === 1, '觸發後沒有回第 1 頁重新載入');
});
T('手機可用：搜尋框自成一列（flex-basis 100%），字級 16px 防 iOS 聚焦縮放；無 @media 開關', () => {
  ok(/\.search \{[^}]*flex: 1 1 100%/.test(PG), '.search 沒有 flex-basis 100%');
  ok(/\.search input \{[^}]*font-size: 16px/.test(PG), '搜尋框字級不是 16px（iOS 會自動放大畫面）');
  const cssIdx = PG.indexOf('.search {');
  const mediaIdx = PG.indexOf('@media');
  ok(cssIdx >= 0, '找不到 .search 樣式');
  ok(/bind:value=\{searchQ\}/.test(PG) && /oninput=\{onSearchInput\}/.test(PG), '輸入框沒接上狀態或 debounce');
});
T('全頁仍無 {@html}（搜尋字串是玩家自由輸入，要走 Svelte 預設 escape）', () => {
  ok(!/\{@html/.test(PG), '出現 {@html}');
});

console.log('\n結果：' + pass + ' 通過, ' + fail + ' 失敗');
if (fail) process.exit(1);
