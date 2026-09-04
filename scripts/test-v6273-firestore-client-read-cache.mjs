// v6.273 守衛：Firestore 讀取減量【P2：client 端】
//
// ── 這一版在做什麼 ────────────────────────────────────────────────────────
// 站長回報「每日讀取幾乎都是 45000 到 48000」（免費額度 50,000/日）。v6.272 已做
// admin 端止血；本版處理 client 端三大宗：
//   ① config/homeChangelog：每次首頁載入 1 讀（不分匿名）——實查文件根本不存在，
//      全站每天花上萬次讀取去「確認它不存在」。→ localStorage TTL 快取（6h，含負結果）。
//   ② users/{uid}/decks：每次進 /decks（含匿名）與對戰頁（Google）整批 getDocs，
//      每副牌 1 讀。→ users/{uid}/meta/decks 單一 rev 文件；沒變（1 讀）就跳過全拉。
//   ③ config/broadcast：每場線上對局 1 讀 → 10 分鐘記憶體快取。
//
// ── 這支守衛怎麼證明（行為端實跑，不是「字串存在」）──────────────────────
//  【0】掃描器/抽取器自我驗證（Rule 25）
//  【A】home-changelog-cache **實跑**：命中/過期/損毀/隱私模式/時鐘倒退/失敗不快取/正對照
//  【B】+page.svelte 接線段**實跑**：快取空→恰 1 讀且 override 有套用；命中→0 讀
//  【C】cloud.ts 新 helpers **實跑**：五種 fail-open 邊界 + bump/record 語意 + 讀寫次數
//  【D】decks/+page.svelte onMount merge 段**實跑**：跳過分支牌組不消失；
//       first-time push 建 meta；cloud 掛掉 fallback local；merge 語意逐字不變
//  【E】game/+page.svelte 段**實跑**：Google 跳過/全拉；匿名分支零 Firestore 呼叫
//  【F】broadcast **實跑**：TTL 內 0 讀；過期重讀；失敗不快取；不存在也快取
//  【G】⭐⭐ 典型 session 讀取量（spy 實測絕對值）＋ BASE 對照（淺複製時大聲跳過）
//  【H】HEAD-FAIL：對真 BASE blob 跑核心斷言，每一條**各自**紅
//  【I】突變測試（6 條），每一條都必須紅在指定的那一條斷言
//
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外（打錯字/抽取器壞掉）必須直接炸掉。
// Run: node scripts/test-v6273-firestore-client-read-cache.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'd7761cce38ff2352b766763324ede99ba833067e';   // v6.272（BASE 對照用）

const P_HC = join(ROOT, 'src/lib/home-changelog-cache.ts');
const P_HP = join(ROOT, 'src/routes/+page.svelte');
const P_CL = join(ROOT, 'src/lib/decks/cloud.ts');
const P_DK = join(ROOT, 'src/routes/decks/+page.svelte');
const P_GP = join(ROOT, 'src/routes/game/+page.svelte');
const P_BC = join(ROOT, 'src/lib/game/broadcast.ts');

const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const HC = readOr(P_HC);       // 新檔：不存在時空字串 ⇒ 各條各自紅
const HP = readFileSync(P_HP, 'utf8');
const CL = readFileSync(P_CL, 'utf8');
const DK = readFileSync(P_DK, 'utf8');
const GP = readFileSync(P_GP, 'utf8');
const BC = readFileSync(P_BC, 'utf8');

let pass = 0, fail = 0;
const T = async (n, f) => {
  try { await f(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
const esbuild = await import('esbuild');

// ══════════════════════════════════════════════════════════════════════════
// 共用：假 localStorage / 假 Firestore（讀取計數依官方計費：query 最低 1 讀）
// ══════════════════════════════════════════════════════════════════════════
function makeLS(opts = {}) {
  const store = new Map(opts.seed || []);
  return {
    store,
    getItem: (k) => { if (opts.throwOnAccess) throw new Error('SecurityError: private mode'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (opts.throwOnAccess || opts.throwOnWrite) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    removeItem: (k) => { if (opts.throwOnAccess) throw new Error('SecurityError'); store.delete(k); },
  };
}
function makeFS(seedDocs = {}) {
  const docs = new Map(Object.entries(seedDocs));
  const spy = { reads: 0, writes: 0, getDocCalls: 0, getDocsCalls: 0, failGet: false, failGetDocs: false, failSet: false };
  const api = {
    doc: (_db, ...segs) => ({ __path: segs.join('/') }),
    collection: (_db, ...segs) => ({ __path: segs.join('/') }),
    getDoc: async (ref) => {
      spy.getDocCalls++;
      if (spy.failGet) throw new Error('unavailable');
      spy.reads += 1;
      const v = docs.get(ref.__path);
      return { exists: () => v !== undefined, data: () => v };
    },
    getDocs: async (col) => {
      spy.getDocsCalls++;
      if (spy.failGetDocs) throw new Error('unavailable');
      const prefix = col.__path + '/';
      const depth = col.__path.split('/').length + 1;
      const rows = [...docs].filter(([k]) => k.startsWith(prefix) && k.split('/').length === depth)
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
      spy.reads += Math.max(rows.length, 1);   // 官方：空查詢也計最低 1 讀
      return { docs: rows };
    },
    setDoc: async (ref, val, o) => {
      if (spy.failSet) throw new Error('unavailable');
      spy.writes += 1;
      const prev = docs.get(ref.__path);
      docs.set(ref.__path, o && o.merge ? { ...(prev || {}), ...val } : { ...val });
    },
    deleteDoc: async (ref) => { spy.writes += 1; docs.delete(ref.__path); },
    serverTimestamp: () => ({ __ts: true }),
  };
  return { api, spy, docs };
}

// ── bundler：把 .ts 模組原始碼（字串）打包成可實跑的 CJS，stub 掉外部依賴 ──
async function bundleTs(srcText, resolveDir) {
  const stubPlugin = {
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'fs-stub', namespace: 'stub' }));
      b.onResolve({ filter: /^\$lib\/firebase$/ }, () => ({ path: 'db-stub', namespace: 'stub' }));
      b.onResolve({ filter: /\.\/cardIdMigration$/ }, () => ({ path: 'mig-stub', namespace: 'stub' }));
      b.onLoad({ filter: /^fs-stub$/, namespace: 'stub' }, () => ({
        contents: `
          export const doc = (...a) => globalThis.__V6273_FS__.doc(...a);
          export const getDoc = (...a) => globalThis.__V6273_FS__.getDoc(...a);
          export const getDocs = (...a) => globalThis.__V6273_FS__.getDocs(...a);
          export const setDoc = (...a) => globalThis.__V6273_FS__.setDoc(...a);
          export const deleteDoc = (...a) => globalThis.__V6273_FS__.deleteDoc(...a);
          export const collection = (...a) => globalThis.__V6273_FS__.collection(...a);
          export const serverTimestamp = (...a) => globalThis.__V6273_FS__.serverTimestamp(...a);
        `, loader: 'js',
      }));
      b.onLoad({ filter: /^db-stub$/, namespace: 'stub' }, () => ({ contents: `export const db = { __tag: 'db' };`, loader: 'js' }));
      b.onLoad({ filter: /^mig-stub$/, namespace: 'stub' }, () => ({ contents: `export const migrateDeck = (d) => d;`, loader: 'js' }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents: srcText, loader: 'ts', resolveDir, sourcefile: 'mod.ts' },
    bundle: true, format: 'cjs', write: false, platform: 'neutral', logLevel: 'silent',
    plugins: [stubPlugin],
  });
  const code = out.outputFiles[0].text;
  const m = { exports: {} };
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports;
}

// ── 段落抽取（v6267 同款：字串/樣板感知的括號配對）─────────────────────────
function matchBlock(src, startIdx, open, close) {
  const i = src.indexOf(open, startIdx);
  assert.ok(i >= 0, '找不到起始的 ' + open);
  let depth = 0, inStr = null, inTpl = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k], p = src[k - 1];
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '`' && p !== '\\') { inTpl ^= 1; continue; }
    if (inTpl) continue;
    if ((c === '"' || c === "'") && p !== '\\') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  assert.fail('括號沒有配對到底');
}
function sliceBetween(src, startMark, endMark, minLen, label) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new assert.AssertionError({ message: `[${label}] 找不到起點：` + startMark.slice(0, 70) });
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new assert.AssertionError({ message: `[${label}] 找不到終點：` + endMark.slice(0, 70) });
  const out = src.slice(a, b);
  if (out.length < minLen) throw new assert.AssertionError({ message: `[${label}] 只抽到 ${out.length} 字元（下限 ${minLen}）—— 抽取器壞了？` });
  return out;
}
const ts2js = (s) => esbuild.transformSync(s, { loader: 'ts' }).code;

// ── decks 頁 onMount merge 段（工作樹或 BASE 皆可抽；BASE 版沒有新 helper 也跑得動）──
function buildDecksMergeRunner(pageSrc, label) {
  const seg = sliceBetween(pageSrc,
    '      // Load local decks first so UI is responsive immediately',
    '      if (decks.length === 0) {', 600, label);
  let js = ts2js(seg);
  js = js.replace(/import\((['"])\$lib\/decks\/storage\1\)/g, '__deps.importStorage()');
  assert.ok(!/import\(/.test(js), `[${label}] 動態 import 沒替換乾淨`);
  return new Function('__deps', `return (async (user) => {
    let decks = []; let syncStatus = 'idle';
    const { loadDecks, withTimeout, loadDecksFromCloud, syncDeckToCloud, sortDecks,
            cloudDecksUnchanged, bumpCloudDecksRev, recordCloudDecksRev } = __deps;
    ${js}
    return { decks, syncStatus };
  })`);
}
// ── game 頁 decks 同步段 ──
function buildGameSyncRunner(pageSrc, label) {
  const seg = sliceBetween(pageSrc,
    '      if (u && !u.isAnonymous) {',
    '      // v4.935 Firebase 額度分流 trigger', 400, label);
  const js = ts2js(seg);
  return new Function('__deps', `return (async (u) => {
    let decks = [];
    const { loadDecks, loadDecksFromCloud, sortDecks, saveDecks,
            cloudDecksUnchanged, recordCloudDecksRev } = __deps;
    ${js}
    return { decks };
  })`);
}
// ── 首頁 override 接線段（工作樹新版）：跑完後讀 holder ──
function buildHomeWiringRunner2(pageSrc) {
  // v6.306：接線改為「先等 changelog.html 的世代訊號，再決定要不要讀 Firestore」
  const start = '      changelogGen.then((gen) => loadHomeChangelogOverride(gen, async () => {';
  const end = ".catch(() => { /* 沒設定/讀取失敗 → 用程式內建 */ });";
  const a = pageSrc.indexOf(start);
  if (a < 0) throw new assert.AssertionError({ message: '首頁找不到 loadHomeChangelogOverride 接線' });
  const b = pageSrc.indexOf(end, a);
  if (b < 0) throw new assert.AssertionError({ message: '首頁接線段找不到終點 .catch' });
  const seg = pageSrc.slice(a, b + end.length);
  const js = ts2js(seg);
  return new Function('__deps', `return (async () => {
    const { loadHomeChangelogOverride, getDoc, doc, db, base, changelogGen } = __deps;
    let changelogOverride = null;
    await (${'async () => { ' + js + ' }'})();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));   // changelogGen.then(...) 多一層 microtask
    return { changelogOverride };
  })`);
}
// BASE 版首頁 getDoc 接線段（量化對照用）
function buildHomeWiringRunnerBase(pageSrc) {
  const start = "      getDoc(doc(db, 'config', 'homeChangelog')).then((snap) => {";
  const end = ".catch(() => { /* 沒設定 → 用程式內建 */ });";
  const a = pageSrc.indexOf(start);
  if (a < 0) throw new assert.AssertionError({ message: 'BASE 首頁找不到 getDoc 接線' });
  const b = pageSrc.indexOf(end, a);
  if (b < 0) throw new assert.AssertionError({ message: 'BASE 首頁接線段找不到終點' });
  const seg = pageSrc.slice(a, b + end.length);
  const js = ts2js(seg);
  return new Function('__deps', `return (async () => {
    const { getDoc, doc, db, base } = __deps;
    let changelogOverride = null;
    await (${'async () => { ' + js + ' }'})();
    await new Promise((r) => setTimeout(r, 0));
    return { changelogOverride };
  })`);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('【0】掃描器/抽取器自我驗證（Rule 25）');
await T('0-1 抽取器對工作樹三個頁面都抽得到段落（長度下限）', () => {
  buildDecksMergeRunner(DK, '0-1 decks');
  buildGameSyncRunner(GP, '0-1 game');
  buildHomeWiringRunner2(HP);
});
await T('0-2 [正對照] 括號配對器不被字串/樣板騙倒；壞樣本抽取會紅', () => {
  const s = 'f({ a: "}{", b: `${x})(`, c: 1 })';
  assert.strictEqual(matchBlock(s, 0, '{', '}'), '{ a: "}{", b: `${x})(`, c: 1 }');
  let threw = false;
  try { sliceBetween('abc', 'zzz', 'yyy', 1, '0-2'); } catch (e) { threw = e instanceof assert.AssertionError; }
  assert.ok(threw, '對不存在的錨點竟然沒紅');
});
await T('0-3 [正對照] 假 Firestore 的讀取計數會動（含空查詢最低 1 讀）', async () => {
  const { api, spy } = makeFS({ 'users/U/decks/d1': { id: 'd1' } });
  await api.getDoc(api.doc({}, 'config', 'x'));
  assert.strictEqual(spy.reads, 1, 'getDoc 沒計 1 讀');
  await api.getDocs(api.collection({}, 'users', 'U', 'decks'));
  assert.strictEqual(spy.reads, 2, '1 份文件的 getDocs 沒計 1 讀');
  await api.getDocs(api.collection({}, 'users', 'EMPTY', 'decks'));
  assert.strictEqual(spy.reads, 3, '空查詢沒計最低 1 讀');
});

// ══════════════════════════════════════════════════════════════════════════
// 【A】home-changelog-cache 行為實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('【A】home-changelog-cache（localStorage TTL 快取）');
async function loadHomeCacheMod(srcText) {
  return bundleTs(srcText, join(ROOT, 'src/lib'));
}
// v6.306：簽名改為 (gen, fetchOverride)；gen=0 是「不讀 Firestore」的閘門（由 test-v6306 專門守），
//   本檔【A】【B】一律用 HC_GEN=1（＝admin 啟用 override 時的快取行為），語意與 v6.273 相同。
const HC_GEN = 1;
// 供【I】突變重用的斷言函式 ─ A2：TTL 內第二次呼叫必須 0 次 fetch
async function assertA2(mod) {
  globalThis.localStorage = makeLS();
  let calls = 0;
  const fetcher = async () => { calls++; return null; };
  await mod.loadHomeChangelogOverride(HC_GEN, fetcher);
  assert.strictEqual(calls, 1, '第一次應恰 1 次 fetch');
  await mod.loadHomeChangelogOverride(HC_GEN, fetcher);
  assert.strictEqual(calls, 1, 'TTL 內第二次應 0 次 fetch（快取沒生效）');
}
await T('A1 快取未命中 → 恰 1 次 fetch，並把負結果（null）寫進快取', async () => {
  const mod = await loadHomeCacheMod(HC);
  const ls = makeLS(); globalThis.localStorage = ls;
  let calls = 0;
  const got = await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return null; });
  assert.strictEqual(calls, 1); assert.strictEqual(got, null);
  const raw = ls.store.get('ptcg_home_cl_cache_v1');
  assert.ok(raw, '快取沒寫進 localStorage');
  const o = JSON.parse(raw);
  assert.strictEqual(o.html, null, '負結果沒存成 null');
  assert.ok(typeof o.at === 'number' && Math.abs(Date.now() - o.at) < 5000, 'at 時間戳不對');
});
await T('A2 ⭐ TTL 內第二次載入 → 0 次 fetch（讀取真的省下來）', async () => {
  await assertA2(await loadHomeCacheMod(HC));
});
await T('A3 TTL 過期（6h+1s 前寫的）→ 重新 fetch', async () => {
  const mod = await loadHomeCacheMod(HC);
  const past = Date.now() - (mod.HOME_CL_TTL_MS + 1000);
  globalThis.localStorage = makeLS({ seed: [['ptcg_home_cl_cache_v1', JSON.stringify({ at: past, html: null })]] });
  let calls = 0;
  await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return null; });
  assert.strictEqual(calls, 1, 'TTL 過期竟然沒有重新 fetch');
});
await T('A4 快取損毀（爛 JSON / 形狀不對）→ 照舊 fetch，不炸', async () => {
  const mod = await loadHomeCacheMod(HC);
  for (const bad of ['{{{not json', JSON.stringify({ at: 'x', html: null }), JSON.stringify({ at: Date.now(), html: 123 })]) {
    globalThis.localStorage = makeLS({ seed: [['ptcg_home_cl_cache_v1', bad]] });
    let calls = 0;
    await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return null; });
    assert.strictEqual(calls, 1, '損毀快取（' + bad.slice(0, 20) + '）沒有 fallback 成照舊 fetch');
  }
});
await T('A5 隱私模式（localStorage 一律 throw）→ 每次照舊 fetch，不炸', async () => {
  const mod = await loadHomeCacheMod(HC);
  globalThis.localStorage = makeLS({ throwOnAccess: true });
  let calls = 0;
  await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return null; });
  await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return null; });
  assert.strictEqual(calls, 2, '隱私模式下應每次都 fetch（行為與修前相同）');
});
await T('A6 時鐘倒退（快取 at 在未來）→ 視為過期重新 fetch（v6.198 教訓）', async () => {
  const mod = await loadHomeCacheMod(HC);
  globalThis.localStorage = makeLS({ seed: [['ptcg_home_cl_cache_v1', JSON.stringify({ at: Date.now() + 3600_000, html: 'stale' })]] });
  let calls = 0;
  const got = await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return null; });
  assert.strictEqual(calls, 1, '未來時間戳的快取竟然被採信');
  assert.strictEqual(got, null);
});
await T('A7 [正對照] override 有內容：第一次 fetch 拿到、TTL 內第二次由快取拿到同樣內容', async () => {
  const mod = await loadHomeCacheMod(HC);
  globalThis.localStorage = makeLS();
  let calls = 0;
  const g1 = await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return '<b>公告</b>'; });
  const g2 = await mod.loadHomeChangelogOverride(HC_GEN, async () => { calls++; return '<b>公告</b>'; });
  assert.strictEqual(g1, '<b>公告</b>'); assert.strictEqual(g2, '<b>公告</b>');
  assert.strictEqual(calls, 1, '第二次應來自快取');
});
await T('A8 fetch 失敗 → 例外往上丟且不寫快取（下次載入再試）', async () => {
  const mod = await loadHomeCacheMod(HC);
  const ls = makeLS(); globalThis.localStorage = ls;
  let threw = false;
  await mod.loadHomeChangelogOverride(HC_GEN, async () => { throw new Error('net down'); }).catch(() => { threw = true; });
  assert.ok(threw, '失敗應往上丟給呼叫端 .catch');
  assert.ok(!ls.store.has('ptcg_home_cl_cache_v1'), '失敗竟然寫了快取（會把網路錯誤釘 6 小時）');
});

// ══════════════════════════════════════════════════════════════════════════
// 【B】+page.svelte 接線段實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('【B】首頁接線（快取空→1 讀＋override 套用；命中→0 讀）');
async function homeWiringDeps(fsSeed, seedCachedHtml) {
  const mod = await loadHomeCacheMod(HC);
  const { api, spy } = makeFS(fsSeed);
  globalThis.localStorage = makeLS();
  // v6.281：快取已綁站台版本（沒有 v 欄位的手工 seed 一律視為未命中）⇒ 暖快取一律走
  //   writeCachedOverride round-trip，命中語意由模組自己保證（更行為端，不弱化斷言）。
  if (seedCachedHtml !== undefined) mod.writeCachedOverride(seedCachedHtml, HC_GEN);
  return { deps: { loadHomeChangelogOverride: mod.loadHomeChangelogOverride, getDoc: api.getDoc, doc: api.doc, db: {}, base: '/b', changelogGen: Promise.resolve(HC_GEN) }, spy };
}
await T('B1 快取空＋override 存在 → 恰 1 讀，且 changelogOverride 套上（__BASE__ 有替換）', async () => {
  const run = buildHomeWiringRunner2(HP);
  const { deps, spy } = await homeWiringDeps({ 'config/homeChangelog': { html: '<a href="__BASE__/x">k</a>' } });
  const out = await run(deps)();
  assert.strictEqual(spy.reads, 1, '應恰 1 讀（實得 ' + spy.reads + '）');
  assert.strictEqual(out.changelogOverride, '<a href="/b/x">k</a>', 'override 沒套用或 __BASE__ 沒替換：' + out.changelogOverride);
});
await T('B2 ⭐ 快取命中（負結果）→ 0 讀，且不覆蓋內建（changelogOverride 維持 null）', async () => {
  const run = buildHomeWiringRunner2(HP);
  const { deps, spy } = await homeWiringDeps({}, null);
  const out = await run(deps)();
  assert.strictEqual(spy.reads, 0, '快取命中竟然還打了 Firestore（' + spy.reads + ' 讀）');
  assert.strictEqual(out.changelogOverride, null);
});
await T('B3 [正對照] 快取命中（有 override）→ 0 讀且 override 照樣套用（不會讓公告消失）', async () => {
  const run = buildHomeWiringRunner2(HP);
  const { deps, spy } = await homeWiringDeps({}, '<b>__BASE__/y</b>');
  const out = await run(deps)();
  assert.strictEqual(spy.reads, 0);
  assert.strictEqual(out.changelogOverride, '<b>/b/y</b>', '快取命中時 override 沒套用 —— admin 公告會消失！');
});

// ══════════════════════════════════════════════════════════════════════════
// 【C】cloud.ts 新 helpers 實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('【C】cloud.ts（meta rev：五種 fail-open 邊界 + bump/record 語意）');
const LS_KEY = 'ptcg_decks_cloud_rev_v1';
async function loadCloudMod(srcText) {
  return bundleTs(srcText, join(ROOT, 'src/lib/decks'));
}
function seedRev(uid, rev) { return [[LS_KEY, JSON.stringify({ uid, rev })]]; }
// 供【I】突變重用 ─ C1：本地牌組空 → 必回 false 且 0 讀（快取損毀防護）
async function assertC1(mod) {
  globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r1') });
  const { api, spy } = makeFS({ 'users/U1/meta/decks': { rev: 'r1' } });
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 0), false, '本地 0 副竟然跳過全拉（牌組會憑空消失）');
  assert.strictEqual(spy.reads, 0, '本地空時不該花讀取');
}
// C4：meta rev 與本地不同 → false（要全拉）
async function assertC4(mod) {
  globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r-OLD') });
  const { api } = makeFS({ 'users/U1/meta/decks': { rev: 'r-NEW' } });
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 3), false, '雲端變了竟然還跳過全拉（換裝置同步會失效）');
}
// C9：bump 的 meta 寫入失敗 → 本地 rev 必須清掉（下次全拉）
async function assertC9(mod) {
  globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r1') });
  const { api, spy } = makeFS({});
  spy.failSet = true;
  globalThis.__V6273_FS__ = api;
  await mod.bumpCloudDecksRev('U1');
  assert.ok(!globalThis.localStorage.store.has(LS_KEY), 'meta 寫失敗但本地 rev 沒清 → 之後會拿舊 rev 誤跳過');
}
await T('C1 ⭐⭐ 本地牌組空（快取損毀）→ false 且 0 讀（絕不憑快取跳過）', async () => {
  await assertC1(await loadCloudMod(CL));
});
await T('C2 無本地 rev（首次/換裝置）→ false 且 0 讀（連 meta 都不必讀）', async () => {
  const mod = await loadCloudMod(CL);
  globalThis.localStorage = makeLS();
  const { api, spy } = makeFS({ 'users/U1/meta/decks': { rev: 'r1' } });
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 5), false);
  assert.strictEqual(spy.reads, 0, '沒 rev 記錄還去讀 meta ＝ 白花 1 讀');
});
await T('C3 rev 一致 → true 且恰 1 讀', async () => {
  const mod = await loadCloudMod(CL);
  globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r1') });
  const { api, spy } = makeFS({ 'users/U1/meta/decks': { rev: 'r1' } });
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 30), true);
  assert.strictEqual(spy.reads, 1, '應恰 1 讀（實得 ' + spy.reads + '）');
});
await T('C4 ⭐⭐ 雲端 rev 變了 → false（換裝置存檔後另一台一定看得到）', async () => {
  await assertC4(await loadCloudMod(CL));
});
await T('C5 meta 文件不存在 / 欄位缺 → false（老帳號 fail-open 全拉）', async () => {
  const mod = await loadCloudMod(CL);
  globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r1') });
  const { api } = makeFS({});
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 3), false, 'meta 不存在竟然跳過');
  const { api: api2 } = makeFS({ 'users/U1/meta/decks': { other: 1 } });
  globalThis.__V6273_FS__ = api2;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 3), false, 'meta 缺 rev 欄位竟然跳過');
});
await T('C6 meta 讀取失敗（網路）→ false、不炸（照舊全拉）', async () => {
  const mod = await loadCloudMod(CL);
  globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r1') });
  const { api, spy } = makeFS({ 'users/U1/meta/decks': { rev: 'r1' } });
  spy.failGet = true;
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 3), false);
});
await T('C7 換帳號（localStorage 記的是別人的 uid）→ false 且 0 讀', async () => {
  const mod = await loadCloudMod(CL);
  globalThis.localStorage = makeLS({ seed: seedRev('U-OTHER', 'r1') });
  const { api, spy } = makeFS({ 'users/U1/meta/decks': { rev: 'r1' } });
  globalThis.__V6273_FS__ = api;
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 3), false, '別人的 rev 竟然被拿來跳過');
  assert.strictEqual(spy.reads, 0);
});
await T('C8 bump：meta setDoc(merge) 到 users/{uid}/meta/decks，本地 rev 同步更新', async () => {
  const mod = await loadCloudMod(CL);
  globalThis.localStorage = makeLS();
  const { api, spy, docs } = makeFS({});
  globalThis.__V6273_FS__ = api;
  await mod.bumpCloudDecksRev('U1');
  assert.strictEqual(spy.writes, 1, '應恰 1 寫');
  const meta = docs.get('users/U1/meta/decks');
  assert.ok(meta && typeof meta.rev === 'string' && meta.rev, 'meta.rev 沒寫進去');
  const localRec = JSON.parse(globalThis.localStorage.store.get(LS_KEY));
  assert.strictEqual(localRec.rev, meta.rev, '本地 rev 與雲端 meta 不同步');
  assert.strictEqual(localRec.uid, 'U1');
  // 之後 cloudDecksUnchanged 應直接 true（存檔本人下次進頁只要 1 讀）
  assert.strictEqual(await mod.cloudDecksUnchanged('U1', 2), true);
});
await T('C9 ⭐ bump 的 meta 寫入失敗 → 本地 rev 清掉（fail-open，下次必全拉）', async () => {
  await assertC9(await loadCloudMod(CL));
});
await T('C10 recordCloudDecksRev：meta 已有 → 0 寫只記本地；meta 缺 → 一次性建立（1 寫）', async () => {
  const mod = await loadCloudMod(CL);
  // 情境 a：meta 已有
  globalThis.localStorage = makeLS();
  const a = makeFS({ 'users/U1/meta/decks': { rev: 'rX' } });
  globalThis.__V6273_FS__ = a.api;
  await mod.recordCloudDecksRev('U1');
  assert.strictEqual(a.spy.writes, 0, 'meta 已存在不該再寫');
  assert.strictEqual(JSON.parse(globalThis.localStorage.store.get(LS_KEY)).rev, 'rX');
  // 情境 b：meta 缺（老帳號遷移）
  globalThis.localStorage = makeLS();
  const b = makeFS({});
  globalThis.__V6273_FS__ = b.api;
  await mod.recordCloudDecksRev('U1');
  assert.strictEqual(b.spy.writes, 1, '遷移應恰 1 寫');
  assert.ok(b.docs.get('users/U1/meta/decks')?.rev, '遷移沒建 meta');
});
await T('C11 [不變性] loadDecksFromCloud 仍是整批 getDocs（讀 N 份文件、經 migrateDeck）', async () => {
  const mod = await loadCloudMod(CL);
  const { api, spy } = makeFS({ 'users/U1/decks/d1': { id: 'd1', updatedAt: '1' }, 'users/U1/decks/d2': { id: 'd2', updatedAt: '2' } });
  globalThis.__V6273_FS__ = api;
  const got = await mod.loadDecksFromCloud('U1');
  assert.strictEqual(got.length, 2);
  assert.strictEqual(spy.reads, 2, '2 副牌應計 2 讀');
});
await T('C12 [不變性] meta 文件不會被 loadDecksFromCloud 撈成一副牌（獨立子集合）', async () => {
  const mod = await loadCloudMod(CL);
  const { api } = makeFS({ 'users/U1/decks/d1': { id: 'd1' }, 'users/U1/meta/decks': { rev: 'r' } });
  globalThis.__V6273_FS__ = api;
  const got = await mod.loadDecksFromCloud('U1');
  assert.strictEqual(got.length, 1, 'meta 被誤當牌組撈進來了！');
});

// ══════════════════════════════════════════════════════════════════════════
// 【D】decks/+page.svelte onMount merge 段實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('【D】/decks 進頁同步（跳過分支牌組不消失；fail-open 全拉）');
async function decksDeps({ localDecks, fsSeed, lsSeed, cloudSrc = CL }) {
  const mod = await bundleTs(cloudSrc, join(ROOT, 'src/lib/decks'));
  const { api, spy, docs } = makeFS(fsSeed);
  globalThis.__V6273_FS__ = api;
  globalThis.localStorage = makeLS({ seed: lsSeed });
  const calls = { loadCloud: 0, pushDeck: 0, saveLocal: 0 };
  const deps = {
    loadDecks: () => localDecks.slice(),
    withTimeout: (p) => p,
    loadDecksFromCloud: async (uid) => { calls.loadCloud++; return mod.loadDecksFromCloud(uid); },
    syncDeckToCloud: async (uid, d) => { calls.pushDeck++; return mod.syncDeckToCloud(uid, d); },
    sortDecks: (arr) => arr.slice(),
    cloudDecksUnchanged: mod.cloudDecksUnchanged,
    bumpCloudDecksRev: mod.bumpCloudDecksRev,
    recordCloudDecksRev: mod.recordCloudDecksRev,
    importStorage: () => Promise.resolve({ saveDecks: () => { calls.saveLocal++; } }),
  };
  return { deps, spy, docs, calls, mod };
}
const D_LOCAL = [
  { id: 'a', name: 'A', updatedAt: '2026-01-02' },
  { id: 'b', name: 'B', updatedAt: '2026-01-03' },
  { id: 'c', name: 'C', updatedAt: '2026-01-04' },
];
// 供【I】突變重用 ─ D1：跳過分支牌組必須原封不動
async function assertD1(pageSrc, cloudSrc = CL) {
  const run = buildDecksMergeRunner(pageSrc, 'D1');
  const { deps, spy, calls } = await decksDeps({
    localDecks: D_LOCAL,
    fsSeed: { 'users/U1/meta/decks': { rev: 'r1' }, 'users/U1/decks/a': { id: 'a' } },
    lsSeed: seedRev('U1', 'r1'),
    cloudSrc,
  });
  const out = await run(deps)({ uid: 'U1' });
  assert.strictEqual(calls.loadCloud, 0, '跳過分支竟然還整批 getDocs');
  assert.strictEqual(spy.reads, 1, '跳過分支應恰 1 讀（meta），實得 ' + spy.reads);
  assert.strictEqual(out.decks.length, 3, '⚠⚠ 跳過分支把玩家牌組弄掉了！實剩 ' + out.decks.length + ' 副');
  assert.deepStrictEqual(out.decks.map((d) => d.id).sort(), ['a', 'b', 'c']);
  assert.strictEqual(out.syncStatus, 'synced');
  assert.strictEqual(spy.writes, 0, '跳過分支不該寫任何雲端資料');
}
await T('D1 ⭐⭐ 快取命中（rev 一致）→ 1 讀、0 getDocs、牌組原封不動、零雲端寫入', async () => {
  await assertD1(DK);
});
await T('D2 rev 變了 → 照舊全拉＋merge by updatedAt（newer wins）＋事後記 rev', async () => {
  const run = buildDecksMergeRunner(DK, 'D2');
  const { deps, spy, calls } = await decksDeps({
    localDecks: D_LOCAL,
    fsSeed: {
      'users/U1/meta/decks': { rev: 'r-NEW' },
      'users/U1/decks/a': { id: 'a', name: 'A-cloud', updatedAt: '2026-01-09' },  // 雲端較新 → 雲端贏
      'users/U1/decks/d': { id: 'd', name: 'D-cloud', updatedAt: '2026-01-01' },  // 另一台新增的牌組
    },
    lsSeed: seedRev('U1', 'r-OLD'),
  });
  const out = await run(deps)({ uid: 'U1' });
  assert.strictEqual(calls.loadCloud, 1, '應整批全拉');
  const byId = new Map(out.decks.map((d) => [d.id, d]));
  assert.strictEqual(byId.size, 4, '合併後應 4 副（a,b,c,d），實得 ' + byId.size);
  assert.strictEqual(byId.get('a').name, 'A-cloud', 'merge by updatedAt 壞了（較新的雲端版沒贏）');
  await new Promise((r) => setTimeout(r, 0));  // recordCloudDecksRev 是 fire-and-forget
  assert.strictEqual(JSON.parse(globalThis.localStorage.store.get(LS_KEY)).rev, 'r-NEW', '全拉後沒記下新 rev');
});
await T('D3 首次上雲（cloud 空、local 有）→ 全部 push ＋ 建 meta', async () => {
  const run = buildDecksMergeRunner(DK, 'D3');
  const { deps, docs, calls } = await decksDeps({ localDecks: D_LOCAL.slice(0, 2), fsSeed: {}, lsSeed: [] });
  const out = await run(deps)({ uid: 'U1' });
  assert.strictEqual(calls.pushDeck, 2, '首次上雲應 push 2 副');
  assert.strictEqual(out.decks.length, 2);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(docs.get('users/U1/meta/decks')?.rev, '首次上雲後沒建 meta（之後永遠比對不了）');
});
await T('D4 ⭐⭐ 雲端掛掉（getDocs throw）→ 牌組 fallback local、syncStatus=error（不消失）', async () => {
  const run = buildDecksMergeRunner(DK, 'D4');
  const { deps, spy } = await decksDeps({
    localDecks: D_LOCAL,
    fsSeed: { 'users/U1/meta/decks': { rev: 'r-NEW' } },
    lsSeed: seedRev('U1', 'r-OLD'),
  });
  spy.failGetDocs = true;
  const out = await run(deps)({ uid: 'U1' });
  assert.strictEqual(out.decks.length, 3, '⚠⚠ 雲端掛掉把玩家本地牌組洗掉了！');
  assert.strictEqual(out.syncStatus, 'error');
});
await T('D5 換裝置第一次（local 空、無 rev、cloud 有）→ 全拉、牌組完整到手', async () => {
  const run = buildDecksMergeRunner(DK, 'D5');
  const { deps, spy, calls } = await decksDeps({
    localDecks: [],
    fsSeed: {
      'users/U1/meta/decks': { rev: 'rZ' },
      'users/U1/decks/a': { id: 'a', name: 'A', updatedAt: '1' },
      'users/U1/decks/b': { id: 'b', name: 'B', updatedAt: '2' },
    },
    lsSeed: [],
  });
  const out = await run(deps)({ uid: 'U1' });
  assert.strictEqual(calls.loadCloud, 1);
  assert.strictEqual(out.decks.length, 2, '換裝置第一次沒拿到雲端牌組');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(JSON.parse(globalThis.localStorage.store.get(LS_KEY)).rev, 'rZ', '換裝置全拉後沒記 rev（下次還要整批拉）');
  // 之後同裝置再進頁（此 wrapper 的 loadDecks 固定回空陣列 → local 空必全拉：fail-open 驗證）
  const again = await run(deps)({ uid: 'U1' });
  assert.strictEqual(calls.loadCloud, 2, 'local 空時第二次進頁也必須全拉（fail-open），實 loadCloud=' + calls.loadCloud);
  assert.strictEqual(again.decks.length, 2, 'local 空 fail-open 全拉後牌組沒到手');
});

// ── 抽整個函式（header 需含函式體開頭的 '{'）──────────────────────────────
function extractFnBlock(src, header, minLen, label) {
  const i = src.indexOf(header);
  if (i < 0) throw new assert.AssertionError({ message: `[${label}] 找不到 ` + header.trim().slice(0, 60) });
  const body = matchBlock(src, i, '{', '}');
  const out = src.slice(i, src.indexOf(body, i) + body.length);
  if (out.length < minLen) throw new assert.AssertionError({ message: `[${label}] 只抽到 ${out.length} 字元 —— 抽取器壞了？` });
  return out;
}
await T('D6 saveAllDecksToCloud 實跑：2 副 dirty → push 2 次、bump 恰 1 次（整批一次）', async () => {
  const fnSrc = extractFnBlock(DK, '  async function saveAllDecksToCloud() {', 300, 'D6');
  let js = ts2js(fnSrc).replace(/import\((['"])\$lib\/decks\/storage\1\)/g, '__deps.importStorage()');
  assert.ok(!/import\(/.test(js), 'D6 動態 import 沒替換乾淨');
  const calls = { push: 0, bump: 0, fav: 0 };
  const runner = new Function('__deps', `
    const { firebaseUser, decks, favorites, withTimeout, syncDeckToCloud, bumpCloudDecksRev, saveFavoritesToCloud, alert } = __deps;
    let dirtyDeckIds = __deps.dirtyDeckIds; let syncStatus = 'idle'; let syncError = '';
    ${js}
    return (async () => { await saveAllDecksToCloud(); return { syncStatus, dirtyCount: dirtyDeckIds.size }; })();
  `);
  const out = await runner({
    firebaseUser: { uid: 'U1' },
    decks: D_LOCAL, favorites: new Set(['x']),
    dirtyDeckIds: new Set(['a', 'b']),
    withTimeout: (p) => p,
    syncDeckToCloud: async () => { calls.push++; },
    bumpCloudDecksRev: async () => { calls.bump++; },
    saveFavoritesToCloud: async () => { calls.fav++; },
    alert: () => {},
    importStorage: () => Promise.resolve({ saveDecks: () => {} }),
  });
  assert.strictEqual(calls.push, 2, 'dirty 2 副應 push 2 次');
  assert.strictEqual(calls.bump, 1, 'bump 應恰 1 次（整批一次，不是每副一次），實得 ' + calls.bump);
  assert.strictEqual(out.dirtyCount, 0, '存檔後 dirty 沒清空');
  assert.strictEqual(out.syncStatus, 'synced');
});
await T('D6b 0 副 dirty → 0 push、0 bump（沒寫入就不 bump，省 1 寫）', async () => {
  const fnSrc = extractFnBlock(DK, '  async function saveAllDecksToCloud() {', 300, 'D6b');
  let js = ts2js(fnSrc).replace(/import\((['"])\$lib\/decks\/storage\1\)/g, '__deps.importStorage()');
  const calls = { push: 0, bump: 0 };
  const runner = new Function('__deps', `
    const { firebaseUser, decks, favorites, withTimeout, syncDeckToCloud, bumpCloudDecksRev, saveFavoritesToCloud, alert } = __deps;
    let dirtyDeckIds = __deps.dirtyDeckIds; let syncStatus = 'idle'; let syncError = '';
    ${js}
    return (async () => { await saveAllDecksToCloud(); return {}; })();
  `);
  await runner({
    firebaseUser: { uid: 'U1' }, decks: D_LOCAL, favorites: new Set(),
    dirtyDeckIds: new Set(),
    withTimeout: (p) => p,
    syncDeckToCloud: async () => { calls.push++; },
    bumpCloudDecksRev: async () => { calls.bump++; },
    saveFavoritesToCloud: async () => {},
    alert: () => {},
    importStorage: () => Promise.resolve({ saveDecks: () => {} }),
  });
  assert.strictEqual(calls.push, 0);
  assert.strictEqual(calls.bump, 0, '沒有任何寫入卻 bump 了（白花 1 寫）');
});
await T('D7 dropDeck 實跑：刪除成功 → bump 1 次；刪除失敗 → 不 bump、syncStatus=error', async () => {
  const fnSrc = extractFnBlock(DK, '  async function dropDeck(deckId: string) {', 150, 'D7');
  const js = ts2js(fnSrc);
  const mk = (removeImpl) => {
    const calls = { bump: 0 };
    const runner = new Function('__deps', `
      const { firebaseUser, withTimeout, removeDeckFromCloud, bumpCloudDecksRev } = __deps;
      let syncStatus = 'idle'; let syncError = '';
      ${js}
      return (async () => { await dropDeck('a'); return { syncStatus }; })();
    `);
    return { calls, run: () => runner({ firebaseUser: { uid: 'U1' }, withTimeout: (p) => p, removeDeckFromCloud: removeImpl, bumpCloudDecksRev: async () => { calls.bump++; } }) };
  };
  const okCase = mk(async () => {});
  const r1 = await okCase.run();
  assert.strictEqual(okCase.calls.bump, 1, '刪除成功應 bump 1 次');
  assert.strictEqual(r1.syncStatus, 'synced');
  const badCase = mk(async () => { throw new Error('net'); });
  const r2 = await badCase.run();
  assert.strictEqual(badCase.calls.bump, 0, '刪除失敗不該 bump（雲端沒變）');
  assert.strictEqual(r2.syncStatus, 'error');
});

// ══════════════════════════════════════════════════════════════════════════
// 【E】game/+page.svelte 段實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('【E】對戰頁進頁同步（Google 跳過/全拉；匿名零 Firestore）');
async function gameDeps({ localDecks, fsSeed, lsSeed }) {
  const mod = await bundleTs(CL, join(ROOT, 'src/lib/decks'));
  const { api, spy } = makeFS(fsSeed);
  globalThis.__V6273_FS__ = api;
  globalThis.localStorage = makeLS({ seed: lsSeed });
  const calls = { loadCloud: 0, saveLocal: 0, unchanged: 0, record: 0 };
  const deps = {
    loadDecks: () => localDecks.slice(),
    loadDecksFromCloud: async (uid) => { calls.loadCloud++; return mod.loadDecksFromCloud(uid); },
    sortDecks: (a) => a.slice(),
    saveDecks: () => { calls.saveLocal++; },
    cloudDecksUnchanged: async (...a) => { calls.unchanged++; return mod.cloudDecksUnchanged(...a); },
    recordCloudDecksRev: async (...a) => { calls.record++; return mod.recordCloudDecksRev(...a); },
  };
  return { deps, spy, calls };
}
await T('E1 ⭐ Google＋rev 一致 → 恰 1 讀、0 getDocs、牌組用 localStorage', async () => {
  const run = buildGameSyncRunner(GP, 'E1');
  const { deps, spy, calls } = await gameDeps({
    localDecks: D_LOCAL,
    fsSeed: { 'users/U1/meta/decks': { rev: 'r1' }, 'users/U1/decks/a': { id: 'a' } },
    lsSeed: seedRev('U1', 'r1'),
  });
  const out = await run(deps)({ uid: 'U1', isAnonymous: false });
  assert.strictEqual(calls.loadCloud, 0, '跳過分支竟然還整批 getDocs');
  assert.strictEqual(spy.reads, 1, '應恰 1 讀，實得 ' + spy.reads);
  assert.strictEqual(out.decks.length, 3, '⚠⚠ 跳過分支把對戰頁牌組弄掉了！');
});
await T('E2 Google＋rev 變了 → 全拉 merge（newer wins）＋記 rev', async () => {
  const run = buildGameSyncRunner(GP, 'E2');
  const { deps, calls } = await gameDeps({
    localDecks: D_LOCAL,
    fsSeed: {
      'users/U1/meta/decks': { rev: 'r-NEW' },
      'users/U1/decks/a': { id: 'a', name: 'A-cloud', updatedAt: '2026-01-09' },
    },
    lsSeed: seedRev('U1', 'r-OLD'),
  });
  const out = await run(deps)({ uid: 'U1', isAnonymous: false });
  assert.strictEqual(calls.loadCloud, 1);
  const a = out.decks.find((d) => d.id === 'a');
  assert.strictEqual(a.name, 'A-cloud', 'merge by updatedAt 壞了');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(JSON.parse(globalThis.localStorage.store.get(LS_KEY)).rev, 'r-NEW');
});
await T('E3 Google＋雲端掛掉 → fallback localStorage（不洗成空）', async () => {
  const run = buildGameSyncRunner(GP, 'E3');
  const { deps, spy } = await gameDeps({
    localDecks: D_LOCAL,
    fsSeed: { 'users/U1/meta/decks': { rev: 'r-NEW' } },
    lsSeed: seedRev('U1', 'r-OLD'),
  });
  spy.failGetDocs = true;
  const out = await run(deps)({ uid: 'U1', isAnonymous: false });
  assert.strictEqual(out.decks.length, 3, '⚠⚠ 雲端掛掉把對戰頁牌組洗掉了！');
});
await T('E4 ⭐ 匿名 → 純 localStorage、零 Firestore 呼叫（0 讀）', async () => {
  const run = buildGameSyncRunner(GP, 'E4');
  const { deps, spy, calls } = await gameDeps({
    localDecks: D_LOCAL.slice(0, 1),
    fsSeed: { 'users/U1/meta/decks': { rev: 'r1' } },
    lsSeed: seedRev('U1', 'r1'),
  });
  const out = await run(deps)({ uid: 'U1', isAnonymous: true });
  assert.strictEqual(spy.reads, 0, '匿名在對戰頁不該有任何 Firestore 讀取');
  assert.strictEqual(calls.unchanged + calls.loadCloud + calls.record, 0, '匿名不該碰任何 cloud helper');
  assert.strictEqual(out.decks.length, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// 【F】broadcast 10 分鐘記憶體快取實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('【F】config/broadcast（10 分鐘記憶體快取）');
const BC_DOC = { enabled: true, text: '公告', turns: [1, 3] };
async function freshBroadcast(srcText, fsSeed) {
  const mod = await bundleTs(srcText, join(ROOT, 'src/lib/game'));
  const { api, spy } = makeFS(fsSeed);
  globalThis.__V6273_FS__ = api;
  return { mod, spy };
}
// 供【I】突變重用 ─ F3：TTL 過期必須重新讀
async function assertF3(srcText) {
  const { mod, spy } = await freshBroadcast(srcText, { 'config/broadcast': BC_DOC });
  await mod.getBroadcastConfig();
  assert.strictEqual(spy.reads, 1);
  const origNow = Date.now;
  try {
    Date.now = () => origNow() + 11 * 60 * 1000;   // 快轉 11 分鐘
    await mod.getBroadcastConfig();
  } finally { Date.now = origNow; }
  assert.strictEqual(spy.reads, 2, 'TTL 過期竟然沒重新讀（admin 改廣播會永遠不生效）');
}
await T('F1 第一場：恰 1 讀，且 parse 語意與修前逐字相同（enabled/text/turns 過濾）', async () => {
  const { mod, spy } = await freshBroadcast(BC, { 'config/broadcast': { enabled: true, text: '公告', turns: [1, 'x', 0, 3.5, 3] } });
  const cfg = await mod.getBroadcastConfig();
  assert.strictEqual(spy.reads, 1);
  assert.deepStrictEqual(cfg, { enabled: true, text: '公告', turns: [1, 3] }, 'parse 語意變了：' + JSON.stringify(cfg));
});
await T('F2 ⭐ 10 分鐘內第二場：0 讀、拿到同一份設定', async () => {
  const { mod, spy } = await freshBroadcast(BC, { 'config/broadcast': BC_DOC });
  const c1 = await mod.getBroadcastConfig();
  const c2 = await mod.getBroadcastConfig();
  assert.strictEqual(spy.reads, 1, 'TTL 內第二場竟然又讀了（實 ' + spy.reads + ' 讀）');
  assert.deepStrictEqual(c2, c1);
});
await T('F3 TTL 過期（11 分鐘後）→ 重新讀', async () => {
  await assertF3(BC);
});
await T('F4 讀取失敗 → 回 EMPTY 且不快取（下一場再試，容錯語意不變）', async () => {
  const { mod, spy } = await freshBroadcast(BC, { 'config/broadcast': BC_DOC });
  spy.failGet = true;
  const c1 = await mod.getBroadcastConfig();
  assert.deepStrictEqual(c1, { enabled: false, text: '', turns: [] });
  spy.failGet = false;
  const c2 = await mod.getBroadcastConfig();
  assert.strictEqual(c2.enabled, true, '恢復後下一場應讀到真設定（失敗不該被快取住）');
});
await T('F5 文件不存在 → EMPTY 是有效結果、照樣快取（第二場 0 讀）', async () => {
  const { mod, spy } = await freshBroadcast(BC, {});
  await mod.getBroadcastConfig();
  await mod.getBroadcastConfig();
  assert.strictEqual(spy.reads, 1, '「不存在」的負結果沒被快取');
});

// ══════════════════════════════════════════════════════════════════════════
// 【G】⭐⭐ 典型 session 讀取量（spy 實測，不是推估）
//   session ＝ 首頁 → /decks → 對戰頁（含 1 場線上對局） → /decks
//   玩家設定：Google 帳號、雲端 30 副牌、當日非首次進站（快取皆暖）、牌組無變動
// ══════════════════════════════════════════════════════════════════════════
console.log('【G】典型 session 讀取量（spy 實測）');
function thirtyDecks(uid) {
  const seed = {};
  for (let i = 0; i < 30; i++) seed[`users/${uid}/decks/d${i}`] = { id: 'd' + i, name: '牌組' + i, updatedAt: '2026-01-01' };
  return seed;
}
async function runSession({ hpSrc, dkSrc, gpSrc, bcSrc, clSrc, hcSrc, warmCache, anonymous, deckCount }) {
  const uid = 'U1';
  const fsSeed = {
    ...(deckCount === 30 ? thirtyDecks(uid) : { [`users/${uid}/decks/d0`]: { id: 'd0', updatedAt: '1' } }),
    'users/U1/meta/decks': { rev: 'r1' },
    'config/broadcast': BC_DOC,
    // config/homeChangelog：不存在（與正式站實查一致）
  };
  const { api, spy } = makeFS(fsSeed);
  globalThis.__V6273_FS__ = api;
  const lsSeed = warmCache ? [...seedRev(uid, 'r1')] : [];
  globalThis.localStorage = makeLS({ seed: lsSeed });
  // v6.281：暖快取走 writeCachedOverride round-trip（快取綁版本，手工舊格式=未命中）。
  //   BASE 對照（hcSrc===null）不看 localStorage，不需要 seed。
  // v6.306：世代訊號取自真的 static/changelog.html（＝線上實際行為；訊號 0 ⇒ 首頁 0 讀）
  const homeGen = hcSrc === null ? 0 : (await bundleTs(hcSrc, join(ROOT, 'src/lib'))).parseOverrideGen(readFileSync(join(ROOT, 'static/changelog.html'), 'utf8'));
  if (warmCache && hcSrc !== null) {
    (await bundleTs(hcSrc, join(ROOT, 'src/lib'))).writeCachedOverride(null, homeGen);
  }
  const localDecks = Array.from({ length: deckCount }, (_, i) => ({ id: 'd' + i, name: '牌組' + i, updatedAt: '2026-01-01' }));
  const cloudMod = await bundleTs(clSrc, join(ROOT, 'src/lib/decks'));
  const bcMod = await bundleTs(bcSrc, join(ROOT, 'src/lib/game'));
  const steps = [];
  const mark = (label, before) => steps.push(label + '=' + (spy.reads - before));

  // ① 首頁
  let before = spy.reads;
  if (hcSrc !== null) {   // 修後：走 loadHomeChangelogOverride 接線
    const hcMod = await bundleTs(hcSrc, join(ROOT, 'src/lib'));
    const run = buildHomeWiringRunner2(hpSrc);
    await run({ loadHomeChangelogOverride: hcMod.loadHomeChangelogOverride, getDoc: api.getDoc, doc: api.doc, db: {}, base: '', changelogGen: Promise.resolve(homeGen) })();
  } else {                // BASE：直接 getDoc 接線
    const run = buildHomeWiringRunnerBase(hpSrc);
    await run({ getDoc: api.getDoc, doc: api.doc, db: {}, base: '' })();
  }
  mark('首頁', before);

  // ② /decks
  const mkDecksDeps = () => ({
    loadDecks: () => localDecks.slice(),
    withTimeout: (p) => p,
    loadDecksFromCloud: cloudMod.loadDecksFromCloud,
    syncDeckToCloud: cloudMod.syncDeckToCloud,
    sortDecks: (a) => a.slice(),
    cloudDecksUnchanged: cloudMod.cloudDecksUnchanged,
    bumpCloudDecksRev: cloudMod.bumpCloudDecksRev,
    recordCloudDecksRev: cloudMod.recordCloudDecksRev,
    importStorage: () => Promise.resolve({ saveDecks: () => {} }),
  });
  before = spy.reads;
  const dOut1 = await buildDecksMergeRunner(dkSrc, 'G decks①')(mkDecksDeps())({ uid });
  assert.strictEqual(dOut1.decks.length, deckCount, 'session 中 /decks 牌組數不對：' + dOut1.decks.length);
  mark('/decks①', before);

  // ③ 對戰頁（進頁同步 ＋ 1 場線上對局讀 broadcast）
  before = spy.reads;
  const gDeps = {
    loadDecks: () => localDecks.slice(),
    loadDecksFromCloud: cloudMod.loadDecksFromCloud,
    sortDecks: (a) => a.slice(),
    saveDecks: () => {},
    cloudDecksUnchanged: cloudMod.cloudDecksUnchanged,
    recordCloudDecksRev: cloudMod.recordCloudDecksRev,
  };
  const gOut = await buildGameSyncRunner(gpSrc, 'G game')(gDeps)({ uid, isAnonymous: !!anonymous });
  assert.strictEqual(gOut.decks.length, deckCount, 'session 中對戰頁牌組數不對');
  await bcMod.getBroadcastConfig();
  mark('對戰頁+1場', before);

  // ④ 回 /decks
  before = spy.reads;
  await new Promise((r) => setTimeout(r, 0));
  const dOut2 = await buildDecksMergeRunner(dkSrc, 'G decks②')(mkDecksDeps())({ uid });
  assert.strictEqual(dOut2.decks.length, deckCount);
  mark('/decks②', before);

  return { total: spy.reads, steps: steps.join('、'), writes: spy.writes };
}
let G_NEW_GOOGLE = null, G_NEW_ANON = null;
await T('G1 ⭐⭐ 修後（Google、30 副、快取暖）：整個 session 恰 4 讀', async () => {
  const r = await runSession({ hpSrc: HP, dkSrc: DK, gpSrc: GP, bcSrc: BC, clSrc: CL, hcSrc: HC, warmCache: true, anonymous: false, deckCount: 30 });
  G_NEW_GOOGLE = r;
  console.log('       修後 Google session：' + r.steps + '｜合計 ' + r.total + ' 讀、' + r.writes + ' 寫');
  assert.strictEqual(r.total, 4, '修後 session 應恰 4 讀（首頁 0＋decks 1＋game 1＋broadcast 1＋decks 1），實得 ' + r.total);
  assert.strictEqual(r.writes, 0, '無變動 session 不該有任何寫入');
});
await T('G2 ⭐ 修後（匿名、1 副、快取暖）：整個 session 恰 3 讀（對戰頁 0 讀牌組）', async () => {
  const r = await runSession({ hpSrc: HP, dkSrc: DK, gpSrc: GP, bcSrc: BC, clSrc: CL, hcSrc: HC, warmCache: true, anonymous: true, deckCount: 1 });
  G_NEW_ANON = r;
  console.log('       修後 匿名 session：' + r.steps + '｜合計 ' + r.total + ' 讀');
  assert.strictEqual(r.total, 3, '修後匿名 session 應恰 3 讀，實得 ' + r.total);
});
await T('G3 修前（BASE）對照：同一 session 92 讀（Google/30 副）——淺複製時大聲跳過', async () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('G3 BASE session 對照', '修後絕對值由 G1/G2 在守'); return; }
  const bHP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/+page.svelte');
  const bDK = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte');
  const bGP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  const bBC = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/broadcast.ts');
  const bCL = readBaseBlob(ROOT, BASE_SHA, 'src/lib/decks/cloud.ts');
  assert.ok(bHP.ok && bDK.ok && bGP.ok && bBC.ok && bCL.ok, 'BASE blob 拿不到');
  const r = await runSession({ hpSrc: bHP.out, dkSrc: bDK.out, gpSrc: bGP.out, bcSrc: bBC.out, clSrc: bCL.out, hcSrc: null, warmCache: true, anonymous: false, deckCount: 30 });
  console.log('       修前 Google session：' + r.steps + '｜合計 ' + r.total + ' 讀');
  assert.strictEqual(r.total, 92, '修前 session 應 92 讀（1＋30＋30＋1＋30），實得 ' + r.total);
  if (G_NEW_GOOGLE) console.log(`       ⭐ 對比：${r.total} 讀 → ${G_NEW_GOOGLE.total} 讀（省 ${(100 * (1 - G_NEW_GOOGLE.total / r.total)).toFixed(1)}%）`);
});

// ══════════════════════════════════════════════════════════════════════════
// 【H】HEAD-FAIL：對真 BASE blob 跑核心斷言，每一條各自紅
// ══════════════════════════════════════════════════════════════════════════
console.log('【H】HEAD-FAIL（BASE 上必須紅）');
async function expectRed(fn) {
  try { await fn(); return false; } catch { return true; }   // BASE 上「紅」可以是任何失敗形式
}
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('H1~H6 HEAD-FAIL 全節', '【I】突變測試不需要歷史、仍在守');
} else {
  const bHP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/+page.svelte').out;
  const bDK = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte').out;
  const bGP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte').out;
  const bBC = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/broadcast.ts').out;
  const bCL = readBaseBlob(ROOT, BASE_SHA, 'src/lib/decks/cloud.ts').out;
  const bHC = readBaseBlob(ROOT, BASE_SHA, 'src/lib/home-changelog-cache.ts');   // BASE 沒這個檔
  await T('H1 BASE 沒有 home-changelog-cache（A2 在 BASE 上紅）', async () => {
    assert.ok(!bHC.ok || await expectRed(async () => assertA2(await bundleTs(bHC.out, join(ROOT, 'src/lib')))), 'BASE 竟然已有快取模組？');
    assert.ok(await expectRed(async () => assertA2(await bundleTs('export const x=1;', join(ROOT, 'src/lib')))), '空模組上 A2 竟然綠 —— A2 沒在測東西');
  });
  await T('H2 BASE cloud.ts 沒有 cloudDecksUnchanged（C1 在 BASE 上紅）', async () => {
    assert.ok(await expectRed(async () => assertC1(await loadCloudMod(bCL))), 'C1 在 BASE 上竟然綠');
  });
  await T('H3 BASE /decks 每次進頁都整批 getDocs（D1 在 BASE 上紅）', async () => {
    assert.ok(await expectRed(() => assertD1(bDK, bCL)), 'D1 在 BASE 上竟然綠');
  });
  await T('H4 BASE 對戰頁每次都整批 getDocs（E1 式斷言在 BASE 上紅）', async () => {
    assert.ok(await expectRed(async () => {
      const run = buildGameSyncRunner(bGP, 'H4');
      const mod = await bundleTs(bCL, join(ROOT, 'src/lib/decks'));
      const { api, spy } = makeFS({ 'users/U1/meta/decks': { rev: 'r1' }, 'users/U1/decks/a': { id: 'a', updatedAt: '1' } });
      globalThis.__V6273_FS__ = api;
      globalThis.localStorage = makeLS({ seed: seedRev('U1', 'r1') });
      let loadCloud = 0;
      await run({
        loadDecks: () => D_LOCAL.slice(),
        loadDecksFromCloud: async (uid) => { loadCloud++; return mod.loadDecksFromCloud(uid); },
        sortDecks: (a) => a.slice(), saveDecks: () => {},
        cloudDecksUnchanged: undefined, recordCloudDecksRev: undefined,
      })({ uid: 'U1', isAnonymous: false });
      assert.strictEqual(loadCloud, 0, 'BASE 一定整批拉');
    }), 'H4 在 BASE 上竟然綠');
  });
  await T('H5 BASE broadcast 每場都讀（F2 在 BASE 上紅）', async () => {
    assert.ok(await expectRed(async () => {
      const { mod, spy } = await freshBroadcast(bBC, { 'config/broadcast': BC_DOC });
      await mod.getBroadcastConfig(); await mod.getBroadcastConfig();
      assert.strictEqual(spy.reads, 1);
    }), 'F2 在 BASE 上竟然綠');
  });
  await T('H6 BASE 首頁沒有 loadHomeChangelogOverride 接線（B 抽取在 BASE 上紅）', async () => {
    assert.ok(await expectRed(() => buildHomeWiringRunner2(bHP)), 'BASE 首頁竟然抽得到新接線');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 【I】突變測試：每一條必須紅在指定的那一條斷言（附精確定位正對照）
// ══════════════════════════════════════════════════════════════════════════
console.log('【I】突變測試（6 條）');
function mutate(src, old, neu, tag) {
  const n = src.split(old).length - 1;
  assert.strictEqual(n, 1, `[${tag}] 突變錨點出現 ${n} 次（要求恰 1）—— 突變根本沒種進去`);
  return src.replace(old, neu);
}
await T('I1 突變：拿掉「本地空必全拉」防護 → C1 紅（快取損毀防護在守）', async () => {
  const m = mutate(CL, '  if (!(localDeckCount > 0)) return false;', '  // mutated', 'I1');
  assert.ok(await expectRed(async () => assertC1(await loadCloudMod(m))), 'I1 突變沒被 C1 抓到');
});
await T('I2 突變：rev 比對恆 true → C4 紅、C1 仍綠（定位精確）', async () => {
  const m = mutate(CL, '  return cloudRev !== null && cloudRev === localRev;', '  return true;', 'I2');
  const mod = await loadCloudMod(m);
  assert.ok(await expectRed(() => assertC4(mod)), 'I2 突變沒被 C4 抓到（換裝置同步會失效）');
  await assertC1(mod);   // 精確定位：C1 不受此突變影響、應仍綠
});
await T('I3 突變：/decks 跳過分支把牌組洗成空 → D1 紅（牌組不消失在守）', async () => {
  const m = mutate(DK, '          decks = sortDecks(local);', '          decks = [];', 'I3');
  assert.ok(await expectRed(() => assertD1(m)), 'I3 突變沒被 D1 抓到 —— 守衛擋不住「牌組消失」！');
});
await T('I4 突變：broadcast 快取永不過期 → F3 紅', async () => {
  const m = mutate(BC, 'if (_bcCache && now >= _bcCache.at && now - _bcCache.at < BROADCAST_TTL_MS) return _bcCache.cfg;',
    'if (_bcCache) return _bcCache.cfg;', 'I4');
  assert.ok(await expectRed(() => assertF3(m)), 'I4 突變沒被 F3 抓到（admin 改廣播會永不生效）');
});
await T('I5 突變：快取寫入變 no-op → A2 紅（「有沒有真的省到讀取」在守）', async () => {
  const m = mutate(HC, "  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, html, g: gen })); } catch { /* 隱私模式等 → 下次照舊讀 */ }",
    '  // mutated no-op', 'I5');
  assert.ok(await expectRed(async () => assertA2(await bundleTs(m, join(ROOT, 'src/lib')))), 'I5 突變沒被 A2 抓到');
});
await T('I6 突變：bump 失敗不清本地 rev → C9 紅（fail-open 在守）', async () => {
  const m = mutate(CL, '    clearLocalDecksRev();                          // meta 沒寫成 → 本地記錄作廢，下次全拉', '    // mutated', 'I6');
  assert.ok(await expectRed(async () => assertC9(await loadCloudMod(m))), 'I6 突變沒被 C9 抓到');
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} v6.273 firestore-client-read-cache：${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
