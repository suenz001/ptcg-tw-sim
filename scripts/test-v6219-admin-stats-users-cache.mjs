// v6.219 守衛：/api/admin/stats 的 users 統計必須走快取（第二發不重掃）且口徑不變。
//
// 事故背景：nginx 計時 log（2026-08-22）全站最慢前三筆全是 /api/admin/stats
//   （14.7~15.9 秒、全部耗在 node 內）。真因是 adminAuth.listUsers(1000) 逐頁「循序」
//   掃全部使用者（上限 50 頁）—— 是 await 的網路 I/O（不卡事件迴圈、不卡玩家），
//   但 admin 每開總覽就等 15 秒＋對 Firebase Auth 打 ~50 發。v6.219 改為
//   5 分鐘快取 + single-flight + 過期先回舊值背景刷新，聚合算法一字未動。
//
// 本守衛斷言到「行為層」：把 patch 檔裡的快取 helpers 與整支 handler 抽出來真的跑，
//   用可計數的 listUsers stub 驗證（不是只驗字串存在）：
//   ① 正對照：冷啟動真的掃了全部頁（計數器有動 ⇒ 儀器沒壞）且數字與 fixture
//      獨立計算的期望值完全一致（口徑一致）。
//   ② ⭐HEAD-FAIL 主斷言：第二發不重掃（計數器不動）且耗時 < 冷啟動一半
//      —— BASE 上第二發會再掃一輪，這條在 BASE 必紅。
//   ③ TTL 過期後：先回舊值（admin 不等掃描）、背景刷新完成後下一發拿到新值。
//   ④ oracle(mongo) 與 feedback 統計不受快取波及 —— 每一發都即時重查。
//   ⑤ admin.html 的用戶統計區要讀 users.at 標示資料時間（數字會延遲 ⇒ 必須標示）。
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 抽取：錨點 + 大括號深度配對（範圍內無 template literal / 字串大括號，已人工確認）──
function extractBraced(src, anchor, from = 0) {
  const i = src.indexOf(anchor, from);
  assert.ok(i >= 0, '找不到錨點: ' + anchor.slice(0, 48));
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return { start: i, end: k + 1, text: src.slice(i, k + 1) }; }
  }
  assert.fail('括號配對失敗: ' + anchor.slice(0, 48));
}

// ── fixture：可計數、可改頁數的 listUsers stub（5 頁 × 100 人）──
//   k%4===0 有 email（會員 125）；k%2===0 一小時前登入（active24h 250）；total 500。
function makeAuthStub(state) {
  return {
    calls: 0,
    async listUsers(_n, tok) {
      this.calls++;
      await sleep(state.pageDelay);
      const p = tok ? Number(tok) : 0;
      const users = [];
      for (let i = 0; i < state.perPage; i++) {
        const k = p * state.perPage + i;
        users.push({
          uid: 'u' + k,
          email: k % 4 === 0 ? ('u' + k + '@x.tw') : undefined,
          metadata: {
            lastSignInTime: (k % 2 === 0)
              ? new Date(state.nowRef.now - 3600000).toUTCString()
              : new Date(state.nowRef.now - 3 * 86400000).toUTCString(),
          },
        });
      }
      return { users, pageToken: p + 1 < state.pages ? String(p + 1) : undefined };
    },
  };
}
function makeFakeDate(nowRef) {
  const RD = Date;
  function FD(...args) { return args.length ? new RD(...args) : new RD(nowRef.now); }
  FD.now = () => nowRef.now;
  return FD;
}

// ── 抽 helpers（BASE 沒有 ⇒ 這裡直接紅）──
let helpersSrc = null;
await T('v6.219 快取 helpers 存在且抽得出來（BASE 必紅）', () => {
  const hStart = pat.indexOf('const USERS_STATS_TTL_MS');
  assert.ok(hStart >= 0, '找不到 USERS_STATS_TTL_MS —— users 統計快取不存在');
  const g = extractBraced(pat, 'async function getUsersStatsCached()');
  assert.ok(g.start > hStart, 'getUsersStatsCached 應在 TTL 常數之後');
  helpersSrc = pat.slice(hStart, g.end);
  // Rule 25：抽取器下限斷言（抽到空殼時要紅，不能安慰劑綠燈）
  assert.ok(helpersSrc.length > 800 && helpersSrc.length < 8000, 'helpers 長度異常: ' + helpersSrc.length);
  assert.ok(helpersSrc.includes('listUsers(1000, pageToken)'), '掃描迴圈不在 helpers 內（口徑載體遺失）');
});

function buildHelpers(auth, DateImpl) {
  const factory = new Function('adminAuth', 'Date', 'console',
    '"use strict";\n' + helpersSrc + '\nreturn { computeUsersStats, getUsersStatsCached, _usersStatsCache };');
  return factory(auth, DateImpl, console);
}

const EXPECT = { enabled: true, total: 500, members: 125, anonymous: 375, active24h: 250 };
const cmpNums = (u) => {
  for (const k of ['enabled', 'total', 'members', 'anonymous', 'active24h']) {
    assert.strictEqual(u[k], EXPECT[k], `${k}: ${u[k]} ≠ ${EXPECT[k]}（口徑改變！）`);
  }
};

// ── ③ helpers 單獨行為：single-flight / TTL / stale-while-revalidate ──
await T('③a 冷啟動 single-flight：兩發並發只掃一輪，數字=口徑期望值', async () => {
  const nowRef = { now: Date.UTC(2026, 7, 23, 12, 0, 0) };
  const state = { pages: 5, perPage: 100, pageDelay: 5, nowRef };
  const auth = makeAuthStub(state);
  const env = buildHelpers(auth, makeFakeDate(nowRef));
  const [a, b] = await Promise.all([env.getUsersStatsCached(), env.getUsersStatsCached()]);
  assert.strictEqual(auth.calls, 5, '並發兩發應共用同一輪掃描（實掃 ' + auth.calls + ' 頁）');
  assert.strictEqual(a, b, '並發兩發應拿到同一份結果');
  cmpNums(a);
  assert.strictEqual(a.at, nowRef.now, 'at 應為計算時刻');
  // TTL 內再打：不重掃
  await env.getUsersStatsCached();
  assert.strictEqual(auth.calls, 5, 'TTL 內不得重掃');
  globalThis.__t3env = { env, auth, state, nowRef, first: a };
});

await T('③b TTL 過期：先立即回舊值，背景刷新後下一發拿到新值', async () => {
  const { env, auth, state, nowRef, first } = globalThis.__t3env;
  state.pages = 6;                       // 之後的掃描會多 100 人 → total 600
  state.pageDelay = 30;
  nowRef.now += 6 * 60 * 1000;           // 超過 5 分鐘 TTL
  const t0 = Date.now();
  const stale = await env.getUsersStatsCached();
  const staleMs = Date.now() - t0;
  assert.strictEqual(stale.at, first.at, '過期那一發應先回舊值（不讓 admin 等 15 秒級掃描）');
  assert.ok(staleMs < 100, '回舊值應該立即（實測 ' + staleMs + 'ms；完整掃描需 ≥180ms）');
  await sleep(6 * 30 + 150);             // 等背景刷新（6 頁 × 30ms + 餘裕）
  const fresh = await env.getUsersStatsCached();
  assert.strictEqual(fresh.total, 600, '背景刷新後應拿到新掃描結果（實得 ' + fresh.total + '）');
  assert.strictEqual(fresh.at, nowRef.now, '新結果的 at 應更新');
  assert.strictEqual(auth.calls, 5 + 6, '背景刷新應只多掃一輪 6 頁');
});

// ── ①②④ 整支 handler 實跑 ──
const h = extractBraced(pat, "app.get('/api/admin/stats', requireFirebaseAdmin, async (req, res) => {");
const arrowIdx = pat.indexOf('async (req, res) => {', h.start);
const handlerSrc = pat.slice(arrowIdx, h.end);
assert.ok(handlerSrc.length > 1000 && handlerSrc.length < 12000, 'handler 長度異常: ' + handlerSrc.length);

function mkRes() { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; }; r.status = (c) => { r.code = c; return r; }; return r; }
function mkMongo(counter) {
  return { collection: (name) => ({ countDocuments: async () => { counter.n++; return name === 'messages' ? 42 : 10; } }) };
}
function mkFirestore() {
  return { collection: (name) => {
    const o = {};
    o.where = () => o;
    o.count = () => ({ get: async () => ({ data: () => ({ count: name === 'feedbacks' ? 9 : 7 }) }) });
    o.get = async () => ({ docs: [{ data: () => ({}) }, { data: () => ({ reply: 'x' }) }, { data: () => ({ reply: null }) }] });
    return o;
  } };
}

await T('①②④ handler 實跑：冷啟掃 5 頁口徑正確；第二發不重掃且快；mongo/feedback 每發即時（②在 BASE 必紅）', async () => {
  const nowRef = { now: Date.now() };
  const auth = makeAuthStub({ pages: 5, perPage: 100, pageDelay: 30, nowRef });
  const env = helpersSrc ? buildHelpers(auth, Date) : { getUsersStatsCached: undefined };
  const dbCalls = { n: 0 };
  const mk = new Function('db', 'fbInitialized', 'admin', 'adminDb', 'adminAuth', 'getUsersStatsCached', 'console',
    '"use strict"; return (' + handlerSrc + ');');
  const handler = mk(mkMongo(dbCalls), true, { firestore: { Timestamp: { fromMillis: (m) => m } } },
    mkFirestore(), auth, env.getUsersStatsCached, console);

  const res1 = mkRes();
  const t0 = Date.now();
  await handler({}, res1);
  const e1 = Date.now() - t0;
  assert.ok(res1.body && !res1.body.error, 'handler 回錯誤: ' + (res1.body && res1.body.error));
  // ① 正對照：計數器有動、數字與 fixture 期望一致（口徑）
  assert.strictEqual(auth.calls, 5, '冷啟動應掃滿 5 頁（計數器儀器檢核）');
  cmpNums(res1.body.users);
  assert.strictEqual(typeof res1.body.users.at, 'number', 'users.at 必須存在（admin 畫面要標資料時間）');
  assert.strictEqual(res1.body.oracle.total, 30, 'oracle 統計數字');
  assert.strictEqual(res1.body.oracle.messages, 42, 'messages 數字');
  assert.strictEqual(res1.body.feedback.unreplied, 2, 'feedback.unreplied 口徑');
  assert.strictEqual(dbCalls.n, 5, '第一發應打 5 個 mongo count');

  // ② ⭐HEAD-FAIL：第二發不得重掃 listUsers，且耗時 < 冷啟一半
  const res2 = mkRes();
  const t1 = Date.now();
  await handler({}, res2);
  const e2 = Date.now() - t1;
  assert.strictEqual(auth.calls, 5,
    '第二發重掃了 listUsers（共 ' + auth.calls + ' 頁）—— users 統計沒有走快取，admin 每開總覽都要等 ~15 秒');
  assert.ok(e2 < e1 / 2, `第二發應遠快於冷啟動（冷啟 ${e1}ms、第二發 ${e2}ms）`);
  for (const k of ['total', 'members', 'anonymous', 'active24h']) {
    assert.strictEqual(res2.body.users[k], res1.body.users[k], '快取回的數字必須與第一發一致');
  }
  // ④ mongo/feedback 不被快取波及：第二發仍即時重查
  assert.strictEqual(dbCalls.n, 10, '第二發也要打滿 5 個 mongo count（對戰統計必須維持即時）');
});

// ── ⑤ admin.html 契約 ──
await T('⑤ admin 總覽的用戶統計區標示資料時間（讀 users.at；BASE 必紅）', () => {
  const i = adm.indexOf('👤 用戶統計');
  assert.ok(i >= 0, '找不到用戶統計區');
  const seg = adm.slice(i - 50, i + 500);
  assert.ok(seg.includes('u.at'), '用戶統計區沒有讀 users.at —— 快取會讓數字延遲，必須標示資料時間');
  assert.ok(seg.includes('資料時間'), '缺「資料時間」字樣');
});
await T('版本一致：admin.html SITE_VERSION_HINT = version.ts VERSION', () => {
  const V = /VERSION = '([\d.]+)'/.exec(verTs)[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(adm)[1];
  assert.strictEqual(H, V, `hint ${H} ≠ version.ts ${V}`);
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
