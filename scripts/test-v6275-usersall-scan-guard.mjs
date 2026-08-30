/**
 * v6.275 守衛：/api/admin/firebase/users-all 收斂單一掃描來源 ＋ 全站「無上限讀取」枚舉掃描器
 *
 * 事故背景：v6.272 宣稱「全站無上限的 Firestore 查詢就是那 5 個」，但站長 2026-08-30 dump 的
 *   nginx 計時 log 抓到 /api/admin/firebase/users-all 一發 **15.7 秒、回應 1.24MB** ——
 *   它是 Firebase **Auth** 的 listUsers 逐頁全量掃描（不是 Firestore 讀取、不消耗讀取額度），
 *   v6.272 的枚舉只掃 Firestore 字面所以漏掉（Rule 25：掃描器自身要先驗）。
 *   慢的真因：v0.95 的快取在 TTL 過期後的第一發要**同步等**整輪循序 HTTPS 掃描，
 *   且它與 /api/admin/stats 的 users 統計**各自**掃一輪。
 *
 * 本守衛五個面向（歷史上踩過**九次**守衛安慰劑，紀律照舊）：
 *   【A】全站無上限讀取掃描器（白名單制）：每一條白名單附**結構性證明**（不是文字理由）；
 *        掃描器先吃「合成壞樣本」正對照自驗，再配下限斷言；BASE blob 上必紅（HEAD-FAIL）。
 *   【B】行為端實跑：抽 helpers＋users-all handler 餵可計數 listUsers stub ——
 *        共用掃描（兩端點一輪）／過期回舊值／force 同步等新／capped 標明／欄位口徑。
 *   【C】事件迴圈：讓路（adminScanYield）實測＋「拿掉讓路」突變必翻紅（連續同步段筆數）。
 *   【D】admin.html 行為端：renderUsers 真的執行，capped 警示必須渲染進 DOM（v6.154 教訓）。
 *   【E】錦標賽區塊逐位元未動（內嵌 sha256，與 v6.271~v6.274 同值；自我驗證非恆真）。
 *   只捕捉 assert.AssertionError；其他例外一律讓它炸。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const BASE_SHA = '4edf9e7f8ec13892d9abd4d22d9f675fbc6b8b54';   // v6.274（本版 BASE；users-all 未修）
const V6271_SHA = '866c4dcf61d876dd06c45e1215a50f4a4ad4f910';  // v6.271（v6.272 修的 Firestore 無上限還在）

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  PASS ' + n); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); }
    else throw e;   // ⚠ 非斷言例外一律讓它炸：吞掉就是安慰劑
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═════════════════════════════════════════════════════════════════════════════
// 【A】全站無上限讀取掃描器
// ═════════════════════════════════════════════════════════════════════════════
console.log('【A】無上限讀取掃描器（白名單制＋合成正對照＋下限斷言）');

/** 剝註解（行內 // 只在引號平衡時剝，保住 'https://…'）。 */
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return s.split('\n').map((line) => {
    let inS = false, inD = false, inB = false;
    for (let i = 0; i < line.length - 1; i++) {
      const c = line[i];
      if (c === "'" && !inD && !inB) inS = !inS;
      else if (c === '"' && !inS && !inB) inD = !inD;
      else if (c === '`' && !inS && !inD) inB = !inB;
      else if (c === '/' && line[i + 1] === '/' && !inS && !inD && !inB) return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

/** 取「從 idx 起到第一個頂層分號」的語句窗口（400 字上限，跨行）。 */
function stmtWindow(s, idx) {
  const end = Math.min(s.length, idx + 400);
  let depth = 0;
  for (let i = idx; i < end; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 0) return s.slice(idx, i); }
    else if ((c === ';' || c === ',') && depth <= 0) return s.slice(idx, i + 1);
  }
  return s.slice(idx, end);
}

/**
 * 掃描一份原始碼，回傳所有 Firestore／Auth 讀取點與其分類。
 * 分類：count（1 讀）／limited（有 .limit(N)）／single-doc（.doc(x).get()）／
 *       write（update/delete/set/batch，不是讀取）／ref-only（語句內沒有 .get()，承接變數另行追蹤）／
 *       unbounded（讀取且無上限 ⇒ 必須在白名單，否則 violation）。
 * listUsers：每個呼叫點分類 paged（單頁、pageToken 回給呼叫端）或 capped-loop（迴圈有上限常數）
 *       或 unbounded-loop（violation）。
 */
function scanReads(rawSrc) {
  const s = stripComments(rawSrc);
  const out = { fsReads: [], listUsers: [], refVars: [], anchors: 0 };

  // ── adminDb 鏈（直接鏈 + 承接變數一步追蹤）──
  let i = -1;
  while ((i = s.indexOf('adminDb.', i + 1)) >= 0) {
    out.anchors++;
    const win = stmtWindow(s, i);
    const item = { at: i, win: win.slice(0, 160) };
    if (/\.(update|delete|set|add)\s*\(/.test(win) && !/\.get\s*\(\s*\)/.test(win)) { item.kind = 'write'; }
    else if (win.includes('adminDb.batch()')) { item.kind = 'write'; }
    else if (win.includes('.listCollections()')) { item.kind = 'list-collections'; }
    else if (!/\.get\s*\(\s*\)/.test(win)) {
      item.kind = 'ref-only';
      // ⚠ win 從 adminDb. 起：承接變數名要往前看（A1 正對照抓到的盲點）
      const before = s.slice(Math.max(0, i - 80), i);
      const m = /(?:const|let|var)\s+(\w+)\s*=\s*$/.exec(before);
      if (m) out.refVars.push(m[1]);
    }
    else if (/\.count\s*\(\s*\)\s*\.get\s*\(\s*\)/.test(win)) item.kind = 'count';
    else if (/\.limit\s*\(/.test(win)) item.kind = 'limited';
    // 單 doc：鏈尾是 .doc(...)（.doc 參數可含嵌套括號 ⇒ 用「最後的 .doc( 在最後的 .collection( 之後」判定）
    else if (win.lastIndexOf('.doc(') > win.lastIndexOf('.collection(')) item.kind = 'single-doc';
    else item.kind = 'unbounded';
    out.fsReads.push(item);
  }
  // ── 承接變數的 .get() 語句（拆鏈樣式，v6.272 的 _q0 就是）──
  for (const v of [...new Set(out.refVars)]) {
    let j = -1;
    const re = new RegExp('(?:await\\s+)?' + v + '\\s*\\.');
    while ((j = s.indexOf(v + '.', j + 1)) >= 0) {
      const win = stmtWindow(s, j);
      if (!/\.get\s*\(\s*\)/.test(win)) continue;
      const item = { at: j, win: win.slice(0, 160), via: v };
      if (/\.count\s*\(\s*\)\s*\.get\s*\(\s*\)/.test(win)) item.kind = 'count';
      else if (/\.limit\s*\(/.test(win)) item.kind = 'limited';
      else if (win.lastIndexOf('.doc(') > win.lastIndexOf('.collection(')) item.kind = 'single-doc';
      else item.kind = 'unbounded';
      out.fsReads.push(item);
    }
  }
  // ── adminAuth.listUsers ──
  let k = -1;
  while ((k = s.indexOf('adminAuth.listUsers(', k + 1)) >= 0) {
    out.anchors++;
    // 找包住這個呼叫的最內層 function（往回找最近的 function 關鍵字，往後配對大括號）
    const fnStart = s.lastIndexOf('function', k);
    let body = '';
    if (fnStart >= 0) {
      const open = s.indexOf('{', fnStart);
      let depth = 0;
      for (let x = open; x < s.length; x++) {
        if (s[x] === '{') depth++;
        else if (s[x] === '}') { depth--; if (depth === 0) { body = s.slice(fnStart, x + 1); break; } }
      }
    }
    const item = { at: k, win: stmtWindow(s, k).slice(0, 120) };
    const looped = /(while|do)\s*[({]/.test(body) && body.includes('pageToken');
    if (!looped) item.kind = 'paged';                                    // 單頁：pageToken 交還呼叫端
    else if (/<\s*RAW_USERS_MAX/.test(body) || /<\s*50000/.test(body)) item.kind = 'capped-loop';
    else item.kind = 'unbounded-loop';
    out.listUsers.push(item);
  }
  return out;
}

// ── 白名單：每條附「結構性證明」函式（回傳 true 才放行；不是文字理由）──
const WHITELIST = [
  {
    name: "users/{uid}/decks（單一玩家的子集合：讀取量＝該玩家牌組數，被 .doc(uid) 錨定，不隨全站成長）",
    match: (it) => /adminDb\.collection\('users'\)\.doc\([^)]+\)\.collection\('decks'\)/.test(it.win.replace(/\s+/g, '')) ||
                   /collection\('users'\)\.doc\(/.test(it.win.replace(/\s+/g, '')) && /collection\('decks'\)/.test(it.win.replace(/\s+/g, '')),
    prove: (it) => {
      // 結構性證明：鏈型必須是 collection('users').doc(<非空表達式>).collection('decks')…get()
      const flat = it.win.replace(/\s+/g, '');
      return /collection\('users'\)\.doc\([^)]+\)\.collection\('decks'\)/.test(flat);
    },
    expect: 3,   // L937（users/:uid/decks）／L2178（by-email decks）／L2270 區（player-profile decks）
  },
  {
    name: "feedbacks.where('uid','==',uid)（等值 where 錨定單一玩家：讀取量＝該玩家回饋數）",
    match: (it) => /collection\('feedbacks'\)\.where\('uid'/.test(it.win.replace(/\s+/g, '')),
    prove: (it) => /collection\('feedbacks'\)\.where\('uid','==',[^)]+\)/.test(it.win.replace(/\s+/g, '')),
    expect: 1,
  },
];

const scan = scanReads(SRV);

await T('A1 掃描器自驗（合成壞樣本正對照）：無上限 .get()／拆鏈無上限／無上限 listUsers 迴圈全部要 flag', () => {
  const bad = `
    const snap = await adminDb.collection('rooms').where('status','==','ended').get();
    const q = adminDb.collection('feedbacks').orderBy('createdAt','desc');
    const all = await q.get();
    async function fetchAllX() {
      const out = [];
      let pageToken;
      do {
        const r = await adminAuth.listUsers(1000, pageToken);
        out.push(...r.users);
        pageToken = r.pageToken || undefined;
      } while (pageToken);
      return out;
    }`;
  const r = scanReads(bad);
  const unb = r.fsReads.filter((x) => x.kind === 'unbounded');
  assert.strictEqual(unb.length, 2, '合成樣本應 flag 2 個無上限 Firestore 讀取（直接鏈＋拆鏈），實得 ' + unb.length);
  assert.strictEqual(r.listUsers.filter((x) => x.kind === 'unbounded-loop').length, 1,
    '合成樣本的無上限 listUsers 迴圈沒被 flag —— 掃描器對 v6.272 漏掉的那一類是瞎的');
  // 好樣本不誤報
  const good = `
    const a = await adminDb.collection('x').limit(300).get();
    const b = await adminDb.collection('x').count().get();
    const c = await adminDb.collection('x').doc(id).get();
    async function scanCapped() {
      const users = [];
      let pageToken = undefined;
      while (users.length < RAW_USERS_MAX) {
        const result = await adminAuth.listUsers(1000, pageToken);
        users.push(...result.users);
        pageToken = result.pageToken;
        if (!pageToken) break;
      }
      return users;
    }`;
  const g = scanReads(good);
  assert.strictEqual(g.fsReads.filter((x) => x.kind === 'unbounded').length, 0, '好樣本被誤報');
  assert.strictEqual(g.listUsers.filter((x) => x.kind !== 'capped-loop').length, 0, '有上限迴圈被誤判');
});

await T('A2 下限斷言：掃描錨點與讀取點數量（掃描器壞掉時這裡要紅，不能安慰劑綠燈）', () => {
  assert.ok(scan.anchors >= 25, '只掃到 ' + scan.anchors + ' 個錨點（adminDb.＋listUsers），掃描器壞了？');
  assert.ok(scan.fsReads.length >= 20, '只解析出 ' + scan.fsReads.length + ' 個 Firestore 語句');
  assert.strictEqual(scan.listUsers.length, 2,
    'adminAuth.listUsers 呼叫點應恰好 2 個（scanAllAuthUsers＋單頁 /firebase/users），實得 ' +
    scan.listUsers.length + ' —— 新增呼叫點必須回來補證明');
});

await T('A3 ⭐⭐⭐ 全站無上限讀取＝0（白名單外）；每條白名單附結構性證明且命中數精確', () => {
  const unb = scan.fsReads.filter((x) => x.kind === 'unbounded');
  const unclaimed = [];
  const claims = new Map(WHITELIST.map((w) => [w.name, 0]));
  for (const it of unb) {
    const w = WHITELIST.find((w) => w.match(it));
    if (!w) { unclaimed.push(it.win); continue; }
    assert.ok(w.prove(it), '白名單「' + w.name + '」的結構性證明對這一筆不成立：' + it.win);
    claims.set(w.name, claims.get(w.name) + 1);
  }
  assert.deepStrictEqual(unclaimed, [], '白名單外的無上限 Firestore 讀取：\n' + unclaimed.join('\n'));
  for (const w of WHITELIST) {
    assert.strictEqual(claims.get(w.name), w.expect,
      '白名單「' + w.name + '」命中 ' + claims.get(w.name) + ' 筆（應 ' + w.expect + '）—— 死條目或新增消費點');
  }
  // listUsers：不得有無上限迴圈
  const badLU = scan.listUsers.filter((x) => x.kind === 'unbounded-loop');
  assert.deepStrictEqual(badLU.map((x) => x.win), [], '無上限的 listUsers 全量迴圈（v6.272 漏掉的那一類）');
});

await T('A4 firestore-write-audit 的函式體證明：auditCollection 內的每個 .get() 都在 .count() 之後（每 query 1 讀）', () => {
  const i = SRV.indexOf('async function tryCount(query)');
  assert.ok(i >= 0, '找不到 tryCount');
  const seg = SRV.slice(i, SRV.indexOf('app.get', i));
  const gets = [...seg.matchAll(/\.get\s*\(\s*\)/g)];
  assert.ok(gets.length >= 1, 'tryCount 段沒有 .get()？');
  for (const m of gets) {
    const before = seg.slice(Math.max(0, m.index - 60), m.index);
    assert.ok(before.includes('.count()'), 'firestore-write-audit 有不經 count() 的 .get()：…' + before.slice(-40));
  }
});

await T('A5 client 端（src/）讀取檔案集合＝v6.273 已列管清單（新增檔案必須回來列管）', () => {
  const hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = dir + '/' + f;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) { walk(rel); continue; }
      if (!/\.(ts|svelte)$/.test(f)) continue;
      const txt = readFileSync(join(ROOT, rel), 'utf8');
      if (/\b(getDocs|getDoc|onSnapshot)\s*\(/.test(txt)) hits.push(rel);
    }
  };
  walk('src');
  const KNOWN = [
    'src/lib/decks/cloud.ts', 'src/lib/decks/favoritesCloud.ts', 'src/lib/game/broadcast.ts',
    'src/lib/game/oracle-client.ts', 'src/lib/game/room-oracle.ts', 'src/lib/game/room.ts',
    'src/lib/tracking.ts', 'src/routes/+page.svelte', 'src/routes/admin/feedbacks/+page.svelte',
    'src/routes/decks/+page.svelte', 'src/routes/game/+page.svelte',
  ];
  assert.ok(hits.length >= 7, 'client 端只掃到 ' + hits.length + ' 檔（下限斷言）：' + hits.join(','));
  const extra = hits.filter((h) => !KNOWN.includes(h));
  assert.deepStrictEqual(extra, [], '出現 v6.273 清單外的 client 端 Firestore 讀取檔案（要重新枚舉）：' + extra);
});

// ═════════════════════════════════════════════════════════════════════════════
// 【B】行為端：抽 helpers ＋ users-all handler 實跑（stub listUsers 計數）
// ═════════════════════════════════════════════════════════════════════════════
console.log('【B】行為端實跑（共用掃描／過期回舊值／force／capped／口徑）');

function extractBraced(src, anchor, from = 0) {
  const i = src.indexOf(anchor, from);
  assert.ok(i >= 0, '找不到錨點: ' + anchor.slice(0, 60));
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return { start: i, end: k + 1, text: src.slice(i, k + 1) }; }
  }
  assert.fail('括號配對失敗: ' + anchor.slice(0, 60));
}

/** 從一份 server_admin_patch 原始碼組出可實跑的環境（helpers＋users-all 端點＋stats 的 users 段）。 */
function buildEnv(src, { auth, DateImpl, yieldSpy }) {
  const h = extractBraced(src, 'const USERS_STATS_TTL_MS');   // 只為定位起點
  const g = extractBraced(src, 'async function getUsersStatsCached()');
  const helpers = src.slice(h.start, g.end);
  // users-all 區（宣告＋映射＋端點）：BASE 與新版錨點不同，各自取
  let uaStart = src.indexOf('const _usersAllView');
  if (uaStart < 0) uaStart = src.indexOf('let _usersAllCache');       // BASE（v0.95 結構）
  assert.ok(uaStart >= 0, '找不到 users-all 區塊起點');
  const ep = extractBraced(src, "app.get('/api/admin/firebase/users-all'");
  const uaEnd = src.indexOf(');', ep.end) + 2;
  const uaSeg = src.slice(uaStart, uaEnd);
  assert.ok(uaSeg.length > 500 && uaSeg.length < 9000, 'users-all 區塊長度異常: ' + uaSeg.length);
  const routes = {};
  const appStub = { get: (path, ...fns) => { routes[path] = fns[fns.length - 1]; } };
  const factory = new Function('adminAuth', 'Date', 'console', 'app', 'requireFirebaseAdmin', 'requireFb', 'adminScanYield',
    '"use strict";\n' + helpers + '\n' + uaSeg + '\nreturn { getUsersStatsCached };');
  const env = factory(auth, DateImpl, console, appStub, () => {}, () => {},
    yieldSpy || ((n) => (n % 200 !== 0 ? null : new Promise((r) => setImmediate(r)))));
  env.routes = routes;
  env.handler = routes["/api/admin/firebase/users-all"];
  assert.ok(typeof env.handler === 'function', 'users-all handler 沒註冊到 app stub');
  return env;
}

function makeAuthStub(state) {
  return {
    calls: 0,
    async listUsers(_n, tok) {
      this.calls++;
      if (state.pageDelay) await sleep(state.pageDelay);
      const p = tok ? Number(tok) : 0;
      const users = [];
      for (let i = 0; i < state.perPage; i++) {
        const k = p * state.perPage + i;
        users.push({
          uid: 'u' + k,
          email: k % 4 === 0 ? ('u' + k + '@x.tw') : undefined,
          emailVerified: k % 8 === 0,
          displayName: k % 4 === 0 ? ('玩家' + k) : null,
          providerData: k % 4 === 0 ? [{ providerId: 'password' }] : [],
          disabled: false,
          metadata: {
            creationTime: new Date(state.nowRef.now - 10 * 86400000).toUTCString(),
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
function mkRes() { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; }; r.status = (c) => { r.code = c; return r; }; return r; }

await T('B1 ⭐⭐ 共用掃描：users-all＋stats 並發首次共 1 輪（5 頁）；TTL 內雙端點再打都是 0 輪', async () => {
  const nowRef = { now: Date.UTC(2026, 7, 30, 12, 0, 0) };
  const state = { pages: 5, perPage: 100, pageDelay: 3, nowRef };
  const auth = makeAuthStub(state);
  const env = buildEnv(SRV, { auth, DateImpl: makeFakeDate(nowRef) });
  const res1 = mkRes();
  const [stats] = await Promise.all([env.getUsersStatsCached(), env.handler({ query: {} }, res1)]);
  assert.strictEqual(auth.calls, 5, '兩端點並發冷啟動應共用同一輪掃描（實掃 ' + auth.calls + ' 頁，修前是 10）');
  assert.strictEqual(stats.total, 500, 'stats 口徑');
  assert.strictEqual(res1.body.users.length, 500, 'users-all 筆數');
  assert.strictEqual(res1.body.capped, false, '5 頁遠低於上限，capped 應為 false');
  assert.strictEqual(res1.body.cachedAt, nowRef.now, 'cachedAt＝掃描時刻');
  // 口徑：欄位映射與 v0.95 逐字同款（fixture 手算期望）
  assert.deepStrictEqual(res1.body.users[0], {
    uid: 'u0', email: 'u0@x.tw', emailVerified: true, displayName: '玩家0',
    anonymous: false, createdAt: new Date(nowRef.now - 10 * 86400000).toUTCString(),
    lastSignIn: new Date(nowRef.now - 3600000).toUTCString(), disabled: false,
  }, 'users-all 欄位映射口徑改變');
  assert.deepStrictEqual(Object.keys(res1.body.users[1]).sort(),
    ['anonymous', 'createdAt', 'disabled', 'displayName', 'email', 'emailVerified', 'lastSignIn', 'uid'], '欄位集合改變');
  const res2 = mkRes();
  await env.handler({ query: {} }, res2);
  await env.getUsersStatsCached();
  assert.strictEqual(auth.calls, 5, 'TTL 內不得重掃');
  assert.strictEqual(res2.body.users, res1.body.users, 'TTL 內應回同一份映射（per-掃描 memo）');
  globalThis.__b1 = { env, auth, state, nowRef, res1 };
});

await T('B2 ⭐⭐ HEAD-FAIL 主斷言：TTL 過期那一發**立即回舊值**（BASE 會同步等一整輪＝線上的 15 秒）', async () => {
  assert.ok(globalThis.__b1, 'B1 沒建起共用環境（BASE 上 B1 已先紅）');
  const { env, auth, state, nowRef } = globalThis.__b1;
  state.pages = 6; state.pageDelay = 40;      // 之後的掃描 6 頁 × 40ms ≥ 240ms
  nowRef.now += 6 * 60 * 1000;                 // 超過 5 分鐘 TTL
  const t0 = Date.now();
  const res = mkRes();
  await env.handler({ query: {} }, res);
  const ms = Date.now() - t0;
  assert.ok(ms < 100, '過期那一發應立即回舊值（實測 ' + ms + 'ms；同步等完整掃描需 ≥240ms）——這就是線上那兩發 15 秒');
  assert.strictEqual(res.body.users.length, 500, '回的應是舊值（500 筆）');
  await sleep(6 * 40 + 200);                   // 等背景刷新完
  const res3 = mkRes();
  await env.handler({ query: {} }, res3);
  assert.strictEqual(res3.body.users.length, 600, '背景刷新後下一發應拿到新掃描（600 筆），實得 ' + res3.body.users.length);
  assert.strictEqual(auth.calls, 5 + 6, '背景刷新應只多掃一輪 6 頁');
  console.log('        量化：過期發回應 ' + ms + 'ms（修前＝同步等完整掃描；線上實測 14.6~15.7 秒）');
});

await T('B3 ?refresh=1 必須同步等**新**資料（站長刪帳號後要立刻看到）', async () => {
  assert.ok(globalThis.__b1, 'B1 沒建起共用環境（BASE 上 B1 已先紅）');
  const { env, auth, state, nowRef } = globalThis.__b1;
  state.pages = 7; state.pageDelay = 5;
  nowRef.now += 6 * 60 * 1000;
  const res = mkRes();
  await env.handler({ query: { refresh: '1' } }, res);
  assert.strictEqual(res.body.users.length, 700, 'force 應拿到最新掃描（700 筆），實得 ' + res.body.users.length);
  assert.strictEqual(res.body.cachedAt, nowRef.now, 'force 後 cachedAt 應為新掃描時刻');
});

await T('B4 ⭐ capped：掃描達上限時回 capped:true（受控降上限副本觸發；正對照＝正常版 false）', async () => {
  // 受控副本：RAW_USERS_MAX 50000 → 2500（只為在測試中真的走到 capped 分支）
  const smallSrc = SRV.replace('const RAW_USERS_MAX = 50000;', 'const RAW_USERS_MAX = 2500;');
  assert.notStrictEqual(smallSrc, SRV, 'RAW_USERS_MAX 錨點不見了');
  const nowRef = { now: Date.UTC(2026, 7, 30, 15, 0, 0) };
  const auth = makeAuthStub({ pages: 10, perPage: 1000, pageDelay: 0, nowRef });
  const env = buildEnv(smallSrc, { auth, DateImpl: makeFakeDate(nowRef) });
  const res = mkRes();
  await env.handler({ query: {} }, res);
  assert.strictEqual(res.body.capped, true, '達上限應回 capped:true（絕不靜默截斷）');
  assert.strictEqual(res.body.users.length, 3000, '上限退出點應在 3000 筆（迴圈語義），實得 ' + res.body.users.length);
  assert.ok(auth.calls < 10, '達上限後不得把 10 頁全掃完（實掃 ' + auth.calls + ' 頁）');
});

// ═════════════════════════════════════════════════════════════════════════════
// 【C】事件迴圈：讓路實測 ＋「拿掉讓路」突變必翻紅
// ═════════════════════════════════════════════════════════════════════════════
console.log('【C】事件迴圈讓路（20k 筆映射）＋突變');

async function runYieldProbe(src) {
  const nowRef = { now: Date.UTC(2026, 7, 30, 18, 0, 0) };
  const auth = makeAuthStub({ pages: 20, perPage: 1000, pageDelay: 0, nowRef });
  const yields = [];
  let last = 0;
  const yieldSpy = (n) => {
    if (n % 200 !== 0) return null;
    yields.push(n - last); last = n;
    return new Promise((r) => setImmediate(r));
  };
  const env = buildEnv(src, { auth, DateImpl: makeFakeDate(nowRef), yieldSpy });
  // 阻塞取樣：1ms 目標間隔的 setTimeout 鏈，量實際間隔
  const gaps = [];
  let tPrev = process.hrtime.bigint();
  let sampling = true;
  (function probe() {
    if (!sampling) return;
    setTimeout(() => {
      const t = process.hrtime.bigint();
      gaps.push(Number(t - tPrev) / 1e6);
      tPrev = t;
      probe();
    }, 1);
  })();
  const res = mkRes();
  const t0 = Date.now();
  await env.handler({ query: {} }, res);
  const total = Date.now() - t0;
  sampling = false;
  await sleep(10);
  gaps.sort((a, b) => a - b);
  const p99 = gaps[Math.floor(gaps.length * 0.99)] || 0;
  const max = gaps[gaps.length - 1] || 0;
  return { yields, maxRun: yields.length ? Math.max(...yields) : res.body.users.length, total, p99, max, n: res.body.users.length };
}

await T('C1 讓路真的發生：20,000 筆映射讓路 ≥ 90 次，兩次讓路間連續同步段 ≤ 200 筆', async () => {
  const r = await runYieldProbe(SRV);
  globalThis.__c1 = r;
  assert.strictEqual(r.n, 20000, 'fixture 應 20k 筆');
  assert.ok(r.yields.length >= 90, '讓路只有 ' + r.yields.length + ' 次（20k/200 應約 100 次）');
  assert.ok(r.maxRun <= 200, '兩次讓路間最長同步段 ' + r.maxRun + ' 筆（應 ≤200）');
  console.log('        量化：20k 筆映射 讓路 ' + r.yields.length + ' 次、總耗時 ' + r.total +
    'ms、事件迴圈間隔 p99 ' + r.p99.toFixed(1) + 'ms / max ' + r.max.toFixed(1) + 'ms（沙盒；取樣含 stub 資料生成段，映射段的阻塞由 maxRun 斷言鎖住）');
});

await T('C2 ⭐ 突變「拿掉讓路」必翻紅：讓路 0 次、整段 20,000 筆變成單一連續同步塊', async () => {
  const mutLine = '      const _y = adminScanYield(out.length); if (_y) await _y;   // ⚠ 每 200 筆讓路（v6.242）';
  assert.ok(SRV.includes(mutLine), '找不到讓路行（錨點漂移）');
  const mutant = SRV.replace(mutLine, '');
  const r = await runYieldProbe(mutant);
  assert.strictEqual(r.yields.length, 0, '突變體居然還在讓路？（' + r.yields.length + ' 次）——偵測器是安慰劑');
  assert.strictEqual(r.maxRun, 20000, '突變體的連續同步段應為整段 20000 筆');
  console.log('        突變體：讓路 0 次、事件迴圈間隔 max ' + r.max.toFixed(1) + 'ms（正版 ' +
    globalThis.__c1.max.toFixed(1) + 'ms）');
});

// ═════════════════════════════════════════════════════════════════════════════
// 【D】admin.html 行為端：renderUsers 真的執行，capped 警示渲染進 DOM
// ═════════════════════════════════════════════════════════════════════════════
console.log('【D】admin.html renderUsers 實跑（v6.154 教訓：斷言到 DOM/渲染輸出層）');

function runRenderUsers(meta, users) {
  const fn = extractBraced(ADMIN, 'function renderUsers(el)');
  const factory = new Function('_usersMeta', 'allUsers', 'rebuildUidEmailMap', 'tvSearchBox', 'tvDefine', 'tvSetRows', 'tvTh', 'renderUsersRows', 'document', 'Date',
    '"use strict";\n' + fn.text + '\nreturn renderUsers;');
  const render = factory(meta, users, () => {}, () => '<input>', () => {}, () => {}, () => '<th></th>', () => '', { getElementById: () => null }, Date);
  const el = { innerHTML: '' };
  render(el);
  return el.innerHTML;
}
const FIX_USERS = [{ uid: 'u1', email: 'a@b.c', anonymous: false }, { uid: 'u2', email: null, anonymous: true }];

await T('D1 ⭐ capped=true：警示元素真的被渲染出來（含「不是全部帳號」）＋資料時間', () => {
  const html = runRenderUsers({ cachedAt: Date.UTC(2026, 7, 30, 6, 0, 0), capped: true }, FIX_USERS);
  assert.ok(html.includes('users-capped-warn'), 'capped 警示元素沒渲染（靜默截斷 —— v6.243 的大坑）');
  assert.ok(html.includes('不是全部帳號'), '警示文案缺「不是全部帳號」');
  assert.ok(html.includes('users-data-at') && html.includes('資料時間'), '資料時間沒渲染');
});
await T('D2 正對照 capped=false：不出現警示（不能嚇站長）；沒有 cachedAt（舊伺服器）不出現資料時間', () => {
  const a = runRenderUsers({ cachedAt: Date.UTC(2026, 7, 30, 6, 0, 0), capped: false }, FIX_USERS);
  assert.ok(!a.includes('users-capped-warn'), '未截斷卻顯示警示');
  assert.ok(a.includes('users-data-at'), '未截斷仍應顯示資料時間');
  const b = runRenderUsers({ cachedAt: null, capped: false }, FIX_USERS);
  assert.ok(!b.includes('users-data-at'), '舊伺服器（無 cachedAt）不應顯示資料時間');
});
await T('D3 fetchAllUsers 接線行為端：回應的 cachedAt/capped 真的寫進 _usersMeta（舊伺服器欄位缺席＝false）', async () => {
  const decl = ADMIN.indexOf('let _usersFetchPromise = null;');
  assert.ok(decl >= 0);
  const fn = extractBraced(ADMIN, 'async function fetchAllUsers(force)');
  const seg = ADMIN.slice(decl, fn.end);
  assert.ok(seg.includes('let _usersMeta'), '_usersMeta 宣告不在抽取段內');
  const factory = new Function('api',
    '"use strict";\n' + seg + '\nreturn { fetchAllUsers, meta: () => _usersMeta };');
  const env1 = factory(async () => ({ users: [{ uid: 'x' }], cachedAt: 12345, capped: true }));
  const u = await env1.fetchAllUsers(false);
  assert.strictEqual(u.length, 1);
  assert.deepStrictEqual(env1.meta(), { cachedAt: 12345, capped: true }, '回應 meta 沒被記下（畫面會永遠不顯示警示）');
  const env2 = factory(async () => ({ users: [] }));       // 舊伺服器：無 cachedAt/capped
  await env2.fetchAllUsers(false);
  assert.deepStrictEqual(env2.meta(), { cachedAt: null, capped: false }, '舊伺服器欄位缺席應視為未截斷');
});

// ═════════════════════════════════════════════════════════════════════════════
// 【E】錦標賽區塊逐位元未動（內嵌 sha256）＋【F】BASE 對照（HEAD-FAIL 載體）
// ═════════════════════════════════════════════════════════════════════════════
console.log('【E】錦標賽區塊 sha256 ＋【F】BASE 對照');

const TOURN_TAIL_SHA256 = '34a8448b7de92a1f9a3a30c02c01ecd274409e1520fcc73fe5e92d6da47cc12c';   // v6.271 起同值
function tournTail(src) {
  const i = src.indexOf("app.get('/api/tournament");
  if (i < 0) throw new assert.AssertionError({ message: '找不到第一支 /api/tournament 端點' });
  return src.slice(i);
}
await T('E1 ★★★ 錦標賽區塊（第一支 /api/tournament 起至檔尾）sha256 與 v6.271~v6.274 相同', () => {
  assert.strictEqual(createHash('sha256').update(tournTail(SRV), 'utf8').digest('hex'), TOURN_TAIL_SHA256,
    '錦標賽區塊被動到了 —— 本版承諾逐位元未動');
});
await T('E2 ★ 自我驗證非恆真：多一個空白 sha256 就不同', () => {
  assert.notStrictEqual(createHash('sha256').update(tournTail(SRV) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256);
});

if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【F】BASE(' + BASE_SHA.slice(0, 8) + ') 對照（掃描器在 BASE 上必紅／修後行為對比）',
    '【A】的掃描器自驗與白名單、【B】【C】【D】的行為斷言不需要歷史，仍在守');
} else {
  const baseSrv = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  await T('F1 ⭐ 掃描器在 BASE（v6.274）上必紅：users-all 的無上限 listUsers 迴圈被 flag', () => {
    assert.ok(baseSrv.ok, '讀不到 BASE blob');
    const r = scanReads(baseSrv.out);
    const bad = r.listUsers.filter((x) => x.kind === 'unbounded-loop');
    assert.strictEqual(bad.length, 1, 'BASE 應恰有 1 個無上限 listUsers 迴圈（fetchAllFirebaseUsers），實得 ' + bad.length);
  });
  await T('F2 ⭐⭐ 修前行為量化：BASE 的 users-all 在 TTL 過期後**同步等**完整掃描；且兩端點各掃一輪', async () => {
    const nowRef = { now: Date.UTC(2026, 7, 30, 12, 0, 0) };
    const state = { pages: 5, perPage: 100, pageDelay: 40, nowRef };
    const auth = makeAuthStub(state);
    const env = buildEnv(baseSrv.out, { auth, DateImpl: makeFakeDate(nowRef) });
    const res1 = mkRes();
    await Promise.all([env.getUsersStatsCached(), env.handler({ query: {} }, res1)]);
    assert.strictEqual(auth.calls, 10, 'BASE 兩端點冷啟動應各掃一輪（10 頁）＝修前的雙倍 Auth 請求，實得 ' + auth.calls);
    nowRef.now += 6 * 60 * 1000;
    state.pageDelay = 40;
    const t0 = Date.now();
    const res2 = mkRes();
    await env.handler({ query: {} }, res2);
    const ms = Date.now() - t0;
    assert.ok(ms >= 150, 'BASE 過期那一發應同步等掃描（實測 ' + ms + 'ms）—— 若這裡很快代表 BASE 抽錯');
    console.log('        修前：過期發同步等 ' + ms + 'ms（5 頁 × 40ms stub；線上 ~N 頁 × ~300ms ≈ 15 秒）；' +
      '冷啟動 Auth 頁數 10（修後 5）');
  });
  const v271 = readBaseBlob(ROOT, V6271_SHA, 'oracle-admin/server_admin_patch.js');
  await T('F3 ⭐ 正對照（歷史真兇）：掃描器在 v6.271 上抓到 v6.272 修掉的無上限 Firestore 讀取（≥3）', () => {
    assert.ok(v271.ok, '讀不到 v6.271 blob');
    const r = scanReads(v271.out);
    const unb = r.fsReads.filter((x) => x.kind === 'unbounded' && !WHITELIST.some((w) => w.match(x)));
    assert.ok(unb.length >= 3, 'v6.271 應至少 3 個白名單外無上限讀取（feedbacks×2＋rooms），實得 ' +
      unb.length + '：\n' + unb.map((x) => x.win.slice(0, 80)).join('\n'));
    assert.ok(unb.some((x) => x.win.includes("feedbacks")), 'v6.271 的 feedbacks 全撈沒被抓到');
    assert.ok(r.listUsers.filter((x) => x.kind === 'unbounded-loop').length >= 1, 'v6.271 的 users-all 沒被抓到');
  });
}

console.log('\n=== v6.275 users-all 收斂＋無上限讀取掃描器：' + pass + ' PASS, ' + fail + ' FAIL ===');
if (fail) process.exit(1);
