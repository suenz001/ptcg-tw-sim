// v6.306 守衛：首頁 homeChangelog 的「靜態檔閘門」＋ firestore.rules 的 meta 缺口
//
// ── 這一版在做什麼 ────────────────────────────────────────────────────────
// Firestore 讀取 4.3 萬/5 萬（85.6%），連續兩版減量（v6.273 6h TTL、v6.281 30 天＋綁版本）
// 都沒降。真兇：首頁每次 mount 都 getDoc(config/homeChangelog)——文件根本不存在，但零結果
// 照樣計 1 讀。v6.281 的「綁站台版本」被出版頻率打死（58 小時 23 版 ⇒ 等效 TTL ≈ 2.5h）；
// 更根本的是 localStorage 策略只救得了回訪者，匿名／內嵌瀏覽器／爬蟲那批母體零命中。
//   【閘門】static/changelog.html（首頁本來就 fetch）最後一行帶 <!-- ptcg-override-gen:N -->：
//          N = 0 ⇒ **連 getDoc 都不發**；N ≠ 0 ⇒ 才讀，且以 N 當快取 key（取代站台版本）。
//   【rules】firestore.rules 沒有 /users/{uid}/meta/{docId}（規則不遞迴）⇒ cloud.ts 的
//          readCloudDecksRev 一律 permission-denied ⇒ v6.273 的牌組減量從未生效。本版補上。
//
// ── 怎麼證明（⭐ 行為端；前兩版都「綠燈但沒效果」，所以本檔一條字串守衛都不寫）──
//  【0】自我驗證：解析器對壞樣本回 0；空模組上核心斷言必紅
//  【S】static/changelog.html 最後一行確實帶訊號、解析得出、且值就是程式實際看到的那個值
//  【B】首頁接線**實跑**（抽 +page.svelte 兩段接線 ＋ 真 home-changelog-cache ＋ getDoc spy）：
//       訊號 0 ⇒ 0 次 getDoc（localStorage 空／隱私模式／舊格式／fetch 失敗／HTTP 500 全部 0）；
//       正對照：訊號 1 ⇒ 恰 1 次、第二次 0 次（負快取）、訊號 2 ⇒ 再 1 次（快取 key 換）
//  【N】⭐⭐ 網路層（playwright；沒有瀏覽器就 SHALLOW-SKIP 並在結尾列出）：真瀏覽器、真
//       localStorage、真 reload、真重建 bundle（換版本字串），攔 firestore.googleapis.com：
//       (i) 全新 context (ii) reload (iii) 換版本重建 bundle ⇒ 三種情境都 0 個請求；
//       正對照：訊號 1 ⇒ 恰 1 個、reload 0 個；閘門拿掉的突變版 ⇒ ≥1 個（攔截器真的看得到）
//  【R】firestore.rules：users 區塊內有 meta 子集合、read/write 條件與 decks 逐字相同；
//       集合名由 cloud.ts 實際使用的 doc() 路徑抽出（兩邊接起來，改名會紅）
//  【H】HEAD-FAIL：四個檔各自還原成 BASE（v6.305）blob，各自紅在**指定的那一條**
//  【M】突變 8 條，每一條紅在指定斷言（expectRe）；只捕 assert.AssertionError
//  【P】接線自檢（在 npm test chain 內；本檔不 pin 版本號、不整檔 sha256）
// Run: node scripts/test-v6306-home-changelog-gate.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'e3233caea4b4f3daab92b49b636bf9e6e0d03846';   // v6.305（HEAD-FAIL 對照；取不到 ⇒ SHALLOW-SKIP，不 fail-open）

const P_HC = 'src/lib/home-changelog-cache.ts';
const P_HP = 'src/routes/+page.svelte';
const P_CL = 'static/changelog.html';
const P_RULES = 'firestore.rules';
const P_CLOUD = 'src/lib/decks/cloud.ts';
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const HC = rd(P_HC), HP = rd(P_HP), CL = rd(P_CL), RULES = rd(P_RULES), CLOUD = rd(P_CLOUD);

let pass = 0, fail = 0;
const skipped = [];
const T = async (n, f) => {
  try { await f(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
const esbuild = await import('esbuild');
const CACHE_KEY = 'ptcg_home_cl_cache_v1';

// ── 工具：bundle 真模組／TS→JS／假 localStorage ───────────────────────────
async function bundleHC(srcText) {
  const out = await esbuild.build({
    stdin: { contents: srcText, loader: 'ts', resolveDir: join(ROOT, 'src/lib'), sourcefile: 'mod.ts' },
    bundle: true, format: 'cjs', write: false, platform: 'neutral', logLevel: 'silent',
  });
  const m = { exports: {} };
  new Function('module', 'exports', out.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const ts2js = (seg) => esbuild.transformSync(seg, { loader: 'ts', format: 'esm' }).code;
function makeLS(opts = {}) {
  const store = new Map(opts.seed || []);
  return {
    store,
    getItem: (k) => { if (opts.throwOnAccess) throw new Error('SecurityError: private mode'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (opts.throwOnAccess) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    removeItem: (k) => { if (opts.throwOnAccess) throw new Error('SecurityError'); store.delete(k); },
  };
}
// 新舊簽名分流（BASE 的 loadHomeChangelogOverride 是 (fetchOverride)，本版是 (gen, fetchOverride)）
const call = (mod, gen, f) => (mod.loadHomeChangelogOverride.length >= 2
  ? mod.loadHomeChangelogOverride(gen, f) : mod.loadHomeChangelogOverride(f));

// ── 首頁接線抽取（兩段；抽不到就紅在 WIRING）───────────────────────────
function sliceBetween(src, start, end, tag) {
  const a = src.indexOf(start);
  if (a < 0) throw new assert.AssertionError({ message: `WIRING：${tag} 找不到起點「${start.trim().slice(0, 50)}」` });
  const b = src.indexOf(end, a);
  if (b < 0) throw new assert.AssertionError({ message: `WIRING：${tag} 找不到終點` });
  return src.slice(a, b + end.length);
}
function extractHomeWiring(pageSrc) {
  const fetchSeg = sliceBetween(pageSrc,
    '    const changelogGen: Promise<number> = fetch(`${base}/changelog.html?v=${VERSION}`)',
    '.catch(() => 0);', 'changelog fetch 段');
  const overrideSeg = sliceBetween(pageSrc,
    '      changelogGen.then((gen) => loadHomeChangelogOverride(gen, async () => {',
    ".catch(() => { /* 沒設定/讀取失敗 → 用程式內建 */ });", 'override 接線段');
  assert.ok(fetchSeg.includes('parseOverrideGen(t)'), 'WIRING：fetch 段沒有把 changelog.html 內容交給 parseOverrideGen');
  assert.ok(overrideSeg.includes("getDoc(doc(db, 'config', 'homeChangelog'))"), 'WIRING：override 段沒有 getDoc(config/homeChangelog)');
  return { fetchJs: ts2js(fetchSeg), overrideJs: ts2js(overrideSeg) };
}
/** 把兩段接線組成可注入依賴的 runner：回 { getDocCalls, gen, changelogBuiltin, changelogOverride } */
function buildHomeRunner(pageSrc) {
  const { fetchJs, overrideJs } = extractHomeWiring(pageSrc);
  return new Function('__deps', `return (async () => {
    const { fetch, base, VERSION, parseOverrideGen, loadHomeChangelogOverride, getDoc, doc, db } = __deps;
    let changelogBuiltin = '', changelogOverride = '';
    ${fetchJs}
    ${overrideJs}
    const gen = await changelogGen;
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    return { gen, changelogBuiltin, changelogOverride };
  })`);
}
/** 假 fetch：回指定內容（或 HTTP 狀態／reject） */
const fakeFetch = (body, opts = {}) => async () => {
  if (opts.reject) throw new Error('net down');
  return { ok: opts.status ? opts.status < 400 : true, status: opts.status || 200, text: async () => body };
};
/** getDoc spy：docs 是 { 'config/homeChangelog': {html} }；計數＝Firestore 讀取數（零結果也算 1） */
function makeFS(docs = {}) {
  const spy = { calls: 0 };
  const doc = (_db, ...seg) => ({ path: seg.join('/') });
  const getDoc = async (ref) => {
    spy.calls++;
    const d = docs[ref.path];
    return { exists: () => d !== undefined, data: () => d };
  };
  return { spy, doc, getDoc };
}
async function runHome({ pageSrc = HP, hcSrc = HC, changelogBody = CL, fetchOpts = {}, ls, docs = {}, version = 'T' }) {
  const mod = await bundleHC(hcSrc);
  globalThis.localStorage = ls || makeLS();
  const fs = makeFS(docs);
  const out = await buildHomeRunner(pageSrc)({
    fetch: fakeFetch(changelogBody, fetchOpts), base: '/b', VERSION: version, parseOverrideGen: mod.parseOverrideGen,
    loadHomeChangelogOverride: mod.loadHomeChangelogOverride, getDoc: fs.getDoc, doc: fs.doc, db: {},
  })();
  return { ...out, calls: fs.spy.calls, mod };
}
const withGen = (n) => CL.replace(/<!--\s*ptcg-override-gen:\d+\s*-->/, `<!-- ptcg-override-gen:${n} -->`);
const withoutSignal = () => CL.replace(/<!--\s*ptcg-override-gen:\d+\s*-->\n?/, '');

// ── 核心斷言（【B】【H】【M】共用；訊息前綴＝紅點定位錨）──────────────────
async function assertGate0Module(mod) {   // 模組層：gen=0 絕不呼叫 fetchOverride
  for (const ls of [makeLS(), makeLS({ throwOnAccess: true })]) {
    globalThis.localStorage = ls;
    let calls = 0;
    const got = await call(mod, 0, async () => { calls++; return '<b>x</b>'; });
    assert.strictEqual(calls, 0, 'GATE-0：訊號 0 竟然呼叫了 fetchOverride（' + calls + ' 次）—— 這就是 4.3 萬讀/天的來源');
    assert.strictEqual(got, null, 'GATE-0：訊號 0 應回 null');
  }
}
async function assertSignalParse(mod, clText) {
  assert.ok(/<!--\s*ptcg-override-gen:\d+\s*-->/.test(clText), 'SIGNAL：static/changelog.html 沒有 <!-- ptcg-override-gen:N --> 訊號');
  // ⚠ 放在**最後一行**而不是第一行：test-v6248 ⑩ 用「檔案以 <details open> 開頭」判定最新一則展開，
  //   首行註解會讓它紅；parseOverrideGen 是整檔 regex，位置無關。
  const lastLine = clText.trimEnd().split('\n').pop();
  assert.ok(/ptcg-override-gen:\d+/.test(lastLine), 'SIGNAL：訊號必須在最後一行（' + lastLine.slice(0, 40) + '）');
  assert.strictEqual((clText.match(/ptcg-override-gen:/g) || []).length, 1, 'SIGNAL：訊號必須恰好出現一次');
  const g = mod.parseOverrideGen(clText);
  assert.ok(Number.isSafeInteger(g) && g >= 0, 'SIGNAL：解析結果不是非負整數：' + g);
  assert.strictEqual(mod.parseOverrideGen(''), 0, 'SIGNAL-MISSING：空內容應解析為 0（fail-closed）');
  assert.strictEqual(mod.parseOverrideGen(withoutSignal()), 0, 'SIGNAL-MISSING：沒有訊號應解析為 0（fail-closed：不發請求）');
  assert.strictEqual(mod.parseOverrideGen(undefined), 0, 'SIGNAL-MISSING：非字串應解析為 0');
  return g;
}
function assertRules(rulesText, cloudText) {
  // 集合名從 cloud.ts 真正用的 doc() 路徑抽出：doc(db, 'users', uid, '<coll>', 'decks')
  const m = /doc\(db,\s*'users',\s*uid,\s*'([a-zA-Z]+)',\s*'decks'\)/.exec(cloudText);
  assert.ok(m, 'RULES-META：cloud.ts 找不到 doc(db, "users", uid, "<coll>", "decks") 的 rev 路徑');
  const coll = m[1];
  const UA = 'match /users/{userId} {';
  const ua = rulesText.indexOf(UA);
  assert.ok(ua >= 0, 'RULES-META：rules 找不到 match /users/{userId}');
  // 括號配對抓出 users 區塊（⚠ 從區塊本體的 { 起算，不是 {userId} 的 {）
  let depth = 0, ub = -1;
  for (let i = ua + UA.length - 1; i < rulesText.length; i++) {
    if (rulesText[i] === '{') depth++;
    else if (rulesText[i] === '}') { depth--; if (depth === 0) { ub = i; break; } }
  }
  assert.ok(ub > ua, 'RULES-META：users 區塊括號不配對');
  const users = rulesText.slice(ua, ub + 1);
  const metaRe = new RegExp('match /' + coll + '/\\{[a-zA-Z]+\\} \\{([\\s\\S]*?)\\}');
  const mm = metaRe.exec(users);
  assert.ok(mm, `RULES-META：/users/{userId} 區塊內沒有 match /${coll}/{docId}（Firestore 規則不遞迴 ⇒ readCloudDecksRev 一律 permission-denied）`);
  const decks = /match \/decks\/\{deckId\} \{([\s\S]*?)\}/.exec(users);
  assert.ok(decks, 'RULES-META：users 區塊內找不到 decks 子集合（對照組）');
  const norm = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('allow ')).sort().join('|');
  assert.ok(norm(mm[1]).includes('allow read'), 'RULES-META：meta 沒有 allow read');
  assert.ok(norm(mm[1]).includes('allow write'), 'RULES-META：meta 沒有 allow write（bumpCloudDecksRev 會寫不進去）');
  assert.strictEqual(norm(mm[1]), norm(decks[1]), 'RULES-META：meta 的 allow 條件必須與 decks 逐字相同（鏡射），實得：' + norm(mm[1]));
}
async function expectRedAt(re, fn) {
  try { await fn(); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
    return { red: true, hit: re.test(e.message), msg: e.message };
  }
  return { red: false, hit: false, msg: '(綠燈)' };
}
function mutate(src, old, neu, tag) {
  const n = src.split(old).length - 1;
  assert.strictEqual(n, 1, `[${tag}] 突變錨點出現 ${n} 次（要求恰 1）—— 突變根本沒種進去`);
  return src.replace(old, neu);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('【0】自我驗證（Rule 25：先證明斷言不是安慰劑）');
const MOD = await bundleHC(HC);
await T('0-1 [正對照] 空模組上 GATE-0 斷言必炸（TypeError 也算「不是綠」）', async () => {
  const empty = await bundleHC('export const x = 1;');
  let threw = false;
  try { await assertGate0Module(empty); } catch { threw = true; }
  ok(threw, '空模組上 assertGate0Module 竟然綠 —— 斷言沒在測東西');
});
await T('0-2 解析器：壞樣本一律 0、合法樣本取值、負數／小數／超大數 0', () => {
  assert.strictEqual(MOD.parseOverrideGen('<!-- ptcg-override-gen:7 -->\n<details>'), 7);
  assert.strictEqual(MOD.parseOverrideGen('<!--ptcg-override-gen:12-->'), 12);
  assert.strictEqual(MOD.parseOverrideGen('<!-- ptcg-override-gen:0 -->'), 0);
  assert.strictEqual(MOD.parseOverrideGen('<!-- ptcg-override-gen:-1 -->'), 0);
  assert.strictEqual(MOD.parseOverrideGen('<!-- ptcg-override-gen:1.5 -->'), 0);
  assert.strictEqual(MOD.parseOverrideGen('<!-- ptcg-override-gen:99999999999999999999 -->'), 0);
  assert.strictEqual(MOD.parseOverrideGen('<details>ptcg-override-gen:3</details>'), 0, '不在 HTML 註解裡的字樣不算訊號');
  assert.strictEqual(MOD.parseOverrideGen(null), 0);
});
await T('0-3 [正對照] 抽取器對 BASE 樣式的接線（沒有 changelogGen）紅在 WIRING', async () => {
  const r = await expectRedAt(/WIRING/, () => extractHomeWiring(HP.replace('changelogGen.then((gen) => loadHomeChangelogOverride(gen, async () => {', 'loadHomeChangelogOverride(async () => {')));
  ok(r.red && r.hit, '抽取器對舊接線竟然沒紅：' + r.msg);
});
await T('0-4 [正對照] rules 斷言對「沒有 meta 區塊」的 rules 紅在 RULES-META', async () => {
  const stripped = RULES.replace(/\s*\/\/ v6\.306[\s\S]*?match \/meta\/\{docId\} \{[\s\S]*?\}\n/, '\n');
  ok(!/match \/meta\//.test(stripped), '正對照樣本製作失敗（meta 還在）');
  const r = await expectRedAt(/RULES-META/, () => assertRules(stripped, CLOUD));
  ok(r.red && r.hit, 'rules 斷言對缺 meta 的樣本竟然沒紅：' + r.msg);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('【S】static/changelog.html 的訊號');
let LIVE_GEN = -1;
await T('S1 最後一行帶 <!-- ptcg-override-gen:N -->（恰一次），解析得出；缺訊號一律 0（fail-closed）', async () => {
  LIVE_GEN = await assertSignalParse(MOD, CL);
  console.log('       目前線上訊號 gen = ' + LIVE_GEN + (LIVE_GEN === 0 ? '（⇒ 首頁 0 次 Firestore 讀取）' : '（⇒ 首頁會讀 Firestore、以 gen 當快取 key）'));
});
await T('S2 訊號行不會影響 changelog 的結構（檔案仍以 <details open> 開頭——test-v6248 ⑩ 靠這個；條目數不變）', () => {
  const body = withoutSignal();
  ok(CL.startsWith('<details open>') && body.startsWith('<details open>'), '檔案必須以 <details open> 開頭（訊號不可放首行）');
  assert.strictEqual((CL.match(/<details\b/g) || []).length, (body.match(/<details\b/g) || []).length);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('【B】首頁接線實跑（getDoc spy；訊號 0 ⇒ 0 讀，不論 localStorage 狀態）');
await T('B0 模組層：gen=0 絕不呼叫 fetchOverride（localStorage 空／隱私模式）', () => assertGate0Module(MOD));
const genZeroBody = withGen(0);
await T('B1 ⭐⭐ 訊號 0＋localStorage 空（首訪）→ 0 次 getDoc；內建 changelog 仍正常顯示', async () => {
  const r = await runHome({ changelogBody: genZeroBody });
  assert.strictEqual(r.calls, 0, 'GATE-0-WIRE：首訪竟然打了 Firestore（' + r.calls + ' 次）');
  assert.strictEqual(r.gen, 0);
  ok(r.changelogBuiltin.includes('<details open>'), '內建 changelog 沒有套上');
  ok(!r.changelogBuiltin.includes('__BASE__'), '__BASE__ 沒替換');
  assert.strictEqual(r.changelogOverride, '');
});
await T('B2 ⭐⭐ 訊號 0＋隱私模式（localStorage 一律 throw）→ 0 次（localStorage 不持久的那批母體）', async () => {
  const r = await runHome({ changelogBody: genZeroBody, ls: makeLS({ throwOnAccess: true }) });
  assert.strictEqual(r.calls, 0, 'GATE-0-WIRE：隱私模式竟然打了 Firestore（' + r.calls + ' 次）');
});
await T('B3 訊號 0＋舊格式快取（v 欄位／過期）→ 0 次（不會因為「未命中」就去讀）', async () => {
  for (const seed of [
    JSON.stringify({ at: Date.now() - 1000, html: null, v: '6.281' }),
    JSON.stringify({ at: Date.now() - 40 * 24 * 3600 * 1000, html: null, g: 1 }),
    '{{{not json',
  ]) {
    const r = await runHome({ changelogBody: genZeroBody, ls: makeLS({ seed: [[CACHE_KEY, seed]] }) });
    assert.strictEqual(r.calls, 0, 'GATE-0-WIRE：快取未命中時竟然去讀了（seed=' + seed.slice(0, 30) + '）');
  }
});
await T('B4 changelog.html 載入失敗（reject／HTTP 500／空內容）→ 訊號視為 0 → 0 次', async () => {
  for (const [opts, body] of [[{ reject: true }, genZeroBody], [{ status: 500 }, withGen(1)], [{}, '']]) {
    const r = await runHome({ changelogBody: body, fetchOpts: opts });
    assert.strictEqual(r.calls, 0, 'FETCH-FAIL-0：changelog.html 載入失敗竟然還去讀 Firestore（' + JSON.stringify(opts) + '）');
    assert.strictEqual(r.gen, 0, 'FETCH-FAIL-0：載入失敗的 gen 應為 0');
  }
});
await T('B5 ⭐ 正對照：訊號 1 → 恰 1 次；同一 localStorage 再載 → 0 次（負快取）；訊號 2 → 再 1 次（快取 key 換）', async () => {
  const ls = makeLS();
  const r1 = await runHome({ changelogBody: withGen(1), ls });
  assert.strictEqual(r1.calls, 1, 'GEN1-READ：訊號 1 應恰 1 次 getDoc，實得 ' + r1.calls);
  assert.strictEqual(r1.gen, 1);
  const r2 = await runHome({ changelogBody: withGen(1), ls });
  assert.strictEqual(r2.calls, 0, 'NEG-CACHE：同世代第二次應命中負快取（0 次），實得 ' + r2.calls);
  const r3 = await runHome({ changelogBody: withGen(2), ls });
  assert.strictEqual(r3.calls, 1, 'GEN-BIND：世代 1→2 應重讀一次，實得 ' + r3.calls);
  const r4 = await runHome({ changelogBody: withGen(2), ls, version: 'OTHER' });
  assert.strictEqual(r4.calls, 0, 'GEN-BIND：同世代、不同站台版本字串應仍命中（v6.281 的版本綁定已被世代取代），實得 ' + r4.calls);
});
await T('B6 正對照：訊號 1＋override 存在 → 套上 changelogOverride（__BASE__ 替換），內建也照常', async () => {
  const r = await runHome({ changelogBody: withGen(1), docs: { 'config/homeChangelog': { html: '<a href="__BASE__/x">k</a>' } } });
  assert.strictEqual(r.calls, 1);
  assert.strictEqual(r.changelogOverride, '<a href="/b/x">k</a>', 'override 沒套用或 __BASE__ 沒替換：' + r.changelogOverride);
  ok(r.changelogBuiltin.includes('<details open>'));
});
await T('B7 正對照：訊號 1＋隱私模式 → 每次 1 次（與 v6.281 行為相同；閘門只在 0 時生效）', async () => {
  const ls = makeLS({ throwOnAccess: true });
  const r1 = await runHome({ changelogBody: withGen(1), ls });
  const r2 = await runHome({ changelogBody: withGen(1), ls });
  assert.strictEqual(r1.calls + r2.calls, 2);
});
await T('B8 ⭐ 線上實際訊號（S1 解析值）走完整接線的讀取數 = (gen === 0 ? 0 : 1)', async () => {
  const r = await runHome({ changelogBody: CL });
  assert.strictEqual(r.calls, LIVE_GEN === 0 ? 0 : 1, 'LIVE：線上訊號 ' + LIVE_GEN + ' 的首頁讀取數不對：' + r.calls);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('【N】網路層（playwright：真瀏覽器／真 localStorage／真 reload／真重建 bundle）');
let hasPw = false, pw = null;
try { pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright'); hasPw = true; } catch { hasPw = false; }
if (!hasPw) {
  console.log('  ⚠⚠ SKIP【N】：這台機器沒有 Playwright，網路層斷言沒有跑（【B】的 getDoc spy 仍在守；沙盒實跑證據見 docs/changelog-internal.md v6.306）');
  skipped.push('【N】playwright 網路層（沒有 playwright 模組）');
} else {
  // 頁面 = 抽取的兩段真接線 ＋ 真 home-changelog-cache.ts ＋ Firestore 替身（getDoc 發真 HTTP 到
  //   firestore.googleapis.com 的 REST 路徑；playwright route 在網路層攔截並計數，不出網）。
  const OUT = '/tmp/v6306-net';
  mkdirSync(OUT, { recursive: true });
  async function buildPage({ pageSrc, hcSrc, version }) {
    const { fetchJs, overrideJs } = extractHomeWiring(pageSrc);
    const entry = `
      import { loadHomeChangelogOverride, parseOverrideGen } from './home-changelog-cache';
      const VERSION = ${JSON.stringify(version)}; const base = '';
      const db = {}; const doc = (_db, ...seg) => ({ path: seg.join('/') });
      async function getDoc(ref) {
        const r = await fetch('https://firestore.googleapis.com/v1/projects/ptcg-tw-sim/databases/(default)/documents/' + ref.path);
        if (r.status === 404) return { exists: () => false, data: () => undefined };
        const j = await r.json();
        return { exists: () => true, data: () => ({ html: j && j.fields && j.fields.html && j.fields.html.stringValue }) };
      }
      let changelogBuiltin = '', changelogOverride = '';
      window.__result = (async () => {
        ${fetchJs}
        ${overrideJs}
        const gen = await changelogGen;
        for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
        return { gen, builtin: changelogBuiltin.length, override: changelogOverride };
      })();
    `;
    // 真 home-changelog-cache（或突變版）以虛擬檔提供
    const out = await esbuild.build({
      stdin: { contents: entry, loader: 'ts', resolveDir: join(ROOT, 'src/lib'), sourcefile: 'entry.ts' },
      bundle: true, format: 'iife', write: false, platform: 'browser', logLevel: 'silent',
      plugins: [{ name: 'hc-src', setup(b) {
        b.onResolve({ filter: /^\.\/home-changelog-cache$/ }, () => ({ path: 'hc', namespace: 'hc' }));
        b.onLoad({ filter: /^hc$/, namespace: 'hc' }, () => ({ contents: hcSrc, loader: 'ts', resolveDir: join(ROOT, 'src/lib') }));
      } }],
    });
    writeFileSync(join(OUT, 'app.js'), out.outputFiles[0].text);
    writeFileSync(join(OUT, 'index.html'), '<!doctype html><html><body><div id="cl"></div><script src="/app.js"></script></body></html>');
  }
  let changelogServed = CL;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/index.html') { res.setHeader('content-type', 'text/html'); res.end(readFileSync(join(OUT, 'index.html'))); return; }
    if (u.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.setHeader('cache-control', 'no-store'); res.end(readFileSync(join(OUT, 'app.js'))); return; }
    if (u.pathname === '/changelog.html') { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(changelogServed); return; }
    res.statusCode = 404; res.end('nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  // 沙盒：PLAYWRIGHT_MODULE 指到 playwright-core、PW_EXECUTABLE 指到 headless shell 可執行檔
  const browser = await pw.chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
  async function newCtx(fsDoc) {
    const ctx = await browser.newContext();
    const hits = [];
    await ctx.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('firestore.googleapis.com')) {
        hits.push(url);
        const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
        if (fsDoc) await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ fields: { html: { stringValue: fsDoc } } }) });
        else await route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }) });
        return;
      }
      await route.continue();
    });
    return { ctx, hits };
  }
  async function load(page) {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    return page.evaluate(() => window.__result);
  }
  try {
    await buildPage({ pageSrc: HP, hcSrc: HC, version: '6.306-test' });
    changelogServed = CL;
    await T('N0 [正對照] 攔截器真的看得到 Firestore 請求：閘門拿掉的突變版 → ≥1 個 firestore.googleapis.com 請求', async () => {
      const mutated = mutate(HC, '  if (!isLiveGen(gen)) return null;', '  // mutated: gate removed', 'N0');
      await buildPage({ pageSrc: HP, hcSrc: mutated, version: '6.306-test' });
      const { ctx, hits } = await newCtx(null);
      const page = await ctx.newPage();
      const r = await load(page);
      await ctx.close();
      ok(hits.length >= 1, 'N0：閘門拿掉竟然 0 個請求 —— 攔截器根本沒看到請求，下面的 0 全是假的');
      console.log('       閘門拿掉（突變版）：' + hits.length + ' 個 firestore 請求（gen=' + r.gen + '）');
      await buildPage({ pageSrc: HP, hcSrc: HC, version: '6.306-test' });   // 還原
    });
    await T('N1 ⭐⭐⭐ (i) 全新 context（localStorage 空）→ 0 個 firestore 請求；(ii) reload → 0；(iii) 換版本字串重建 bundle 再載 → 0', async () => {
      assert.strictEqual(MOD.parseOverrideGen(changelogServed), LIVE_GEN);
      const { ctx, hits } = await newCtx(null);
      const page = await ctx.newPage();
      const r1 = await load(page);
      const n1 = hits.length;
      await page.reload({ waitUntil: 'load' });
      const r2 = await page.evaluate(() => window.__result);
      const n2 = hits.length - n1;
      await buildPage({ pageSrc: HP, hcSrc: HC, version: '9.999-rebuilt' });
      await page.reload({ waitUntil: 'load' });
      const r3 = await page.evaluate(() => window.__result);
      const n3 = hits.length - n1 - n2;
      const lsAfter = await page.evaluate((k) => localStorage.getItem(k), CACHE_KEY);
      await ctx.close();
      console.log(`       (i) 全新 context：${n1} 個｜(ii) reload：${n2} 個｜(iii) 換版本重建 bundle：${n3} 個｜gen=${r1.gen}/${r2.gen}/${r3.gen}｜builtin ${r1.builtin} chars｜localStorage=${lsAfter}`);
      if (LIVE_GEN === 0) {
        assert.strictEqual(n1, 0, 'NET-0：(i) 全新 context 竟然發了 ' + n1 + ' 個 Firestore 請求');
        assert.strictEqual(n2, 0, 'NET-0：(ii) reload 竟然發了 ' + n2 + ' 個');
        assert.strictEqual(n3, 0, 'NET-0：(iii) 換版本重建 bundle 竟然發了 ' + n3 + ' 個');
        assert.strictEqual(lsAfter, null, 'NET-0：訊號 0 不該寫任何快取');
      } else {
        assert.strictEqual(n1, 1, 'NET-LIVE：(i) 應恰 1 個'); assert.strictEqual(n2, 0, 'NET-LIVE：(ii) 應 0 個'); assert.strictEqual(n3, 0, 'NET-LIVE：(iii) 同世代換版本仍應 0 個');
      }
      ok(r1.builtin > 1000 && r3.builtin > 1000, '內建 changelog 沒有載入（builtin=' + r1.builtin + '）');
      await buildPage({ pageSrc: HP, hcSrc: HC, version: '6.306-test' });
    });
    await T('N2 ⭐ 正對照：訊號改 1 → 全新 context 恰 1 個請求；reload → 0（負快取）；訊號 2 → reload 恰 1；override 存在時內容有套上', async () => {
      changelogServed = withGen(1);
      const { ctx, hits } = await newCtx(null);
      const page = await ctx.newPage();
      await load(page);
      const n1 = hits.length;
      await page.reload({ waitUntil: 'load' });
      const n2 = hits.length - n1;
      changelogServed = withGen(2);
      await page.reload({ waitUntil: 'load' });
      const n3 = hits.length - n1 - n2;
      await ctx.close();
      console.log(`       訊號 1 全新 context：${n1} 個｜reload：${n2} 個｜訊號 2 reload：${n3} 個`);
      assert.strictEqual(n1, 1, 'NET-GEN1：訊號 1 全新 context 應恰 1 個，實得 ' + n1);
      assert.strictEqual(n2, 0, 'NET-NEG-CACHE：reload 應 0 個（負快取），實得 ' + n2);
      assert.strictEqual(n3, 1, 'NET-GEN-BIND：訊號 2 應重讀恰 1 個，實得 ' + n3);
      // override 存在
      changelogServed = withGen(3);
      const c2 = await newCtx('<b>公告__BASE__</b>');
      const p2 = await c2.ctx.newPage();
      const r = await load(p2);
      await c2.ctx.close();
      assert.strictEqual(c2.hits.length, 1);
      assert.strictEqual(r.override, '<b>公告</b>', 'override 沒套上：' + r.override);
      changelogServed = CL;
    });
  } finally {
    await browser.close();
    server.close();
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('【R】firestore.rules：users/{uid}/meta 子集合（規則不遞迴）');
await T('R1 ⭐ users 區塊內有 match /meta/{docId}，allow read/write 與 decks 逐字相同；集合名接自 cloud.ts 的 doc() 路徑', () => assertRules(RULES, CLOUD));
await T('R2 cloud.ts 的 readCloudDecksRev / bumpCloudDecksRev 仍走 users/{uid}/meta/decks（兩邊要一起改）', () => {
  ok(/getDoc\(doc\(db, 'users', uid, 'meta', 'decks'\)\)/.test(CLOUD), 'readCloudDecksRev 的路徑變了');
  ok(/setDoc\(doc\(db, 'users', uid, 'meta', 'decks'\)/.test(CLOUD), 'bumpCloudDecksRev 的路徑變了');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('【H】HEAD-FAIL（四個檔各自還原成 BASE=v6.305，各自紅在指定斷言）');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6306 H1~H4 HEAD-FAIL 全節', '【M】突變測試不需要歷史、仍在守');
} else {
  const bHC = readBaseBlob(ROOT, BASE_SHA, P_HC), bHP = readBaseBlob(ROOT, BASE_SHA, P_HP);
  const bCL = readBaseBlob(ROOT, BASE_SHA, P_CL), bRULES = readBaseBlob(ROOT, BASE_SHA, P_RULES);
  await T('H0 BASE blob 四個都拿得到', () => ok(bHC.ok && bHP.ok && bCL.ok && bRULES.ok, 'BASE blob 拿不到'));
  await T('H1 BASE home-changelog-cache.ts（無閘門）→ 紅在 GATE-0', async () => {
    const r = await expectRedAt(/GATE-0/, async () => assertGate0Module(await bundleHC(bHC.out)));
    ok(r.red, 'BASE 竟然已有閘門？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
  await T('H2 BASE +page.svelte（舊接線）→ 紅在 WIRING', async () => {
    const r = await expectRedAt(/WIRING/, () => extractHomeWiring(bHP.out));
    ok(r.red, 'BASE 首頁竟然抽得到新接線？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
  await T('H3 BASE static/changelog.html（無訊號）→ 紅在 SIGNAL', async () => {
    const r = await expectRedAt(/SIGNAL/, () => assertSignalParse(MOD, bCL.out));
    ok(r.red, 'BASE 的 changelog.html 竟然已有訊號？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
  await T('H4 BASE firestore.rules（無 meta）→ 紅在 RULES-META', async () => {
    const r = await expectRedAt(/RULES-META/, () => assertRules(bRULES.out, CLOUD));
    ok(r.red, 'BASE 的 rules 竟然已有 meta？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('【M】突變測試（每一條紅在指定斷言；附正對照）');
await T('M1 突變：模組閘門拿掉 → 紅在 GATE-0（正對照：訊號 1 路徑仍綠）', async () => {
  const m = mutate(HC, '  if (!isLiveGen(gen)) return null;', '  // mutated: gate removed', 'M1');
  const mod = await bundleHC(m);
  const r = await expectRedAt(/GATE-0/, () => assertGate0Module(mod));
  ok(r.red && r.hit, 'M1 突變沒被 GATE-0 抓到：' + r.msg);
  const r2 = await runHome({ hcSrc: m, changelogBody: withGen(1) });
  assert.strictEqual(r2.calls, 1);
});
await T('M2 突變：缺訊號時解析成 1（fail-open）→ 紅在 SIGNAL-MISSING', async () => {
  const m = mutate(HC, '  if (!m) return 0;', '  if (!m) return 1;', 'M2');
  const r = await expectRedAt(/SIGNAL-MISSING/, async () => assertSignalParse(await bundleHC(m), CL));
  ok(r.red && r.hit, 'M2 突變沒被 SIGNAL-MISSING 抓到：' + r.msg);
});
await T('M3 突變：讀快取不比世代 → 紅在 GEN-BIND（admin 改 override 會被 30 天負快取卡死）', async () => {
  const m = mutate(HC, '    if (o.g !== gen) return { hit: false, html: null };', '    // mutated: no generation check', 'M3');
  const r = await expectRedAt(/GEN-BIND/, async () => {
    const ls = makeLS();
    await runHome({ hcSrc: m, changelogBody: withGen(1), ls });
    const r3 = await runHome({ hcSrc: m, changelogBody: withGen(2), ls });
    assert.strictEqual(r3.calls, 1, 'GEN-BIND：世代 1→2 應重讀一次，實得 ' + r3.calls);
  });
  ok(r.red && r.hit, 'M3 突變沒被 GEN-BIND 抓到：' + r.msg);
});
await T('M4 突變：寫快取漏掉 g → 紅在 NEG-CACHE（自己寫的自己讀不回 ⇒ 訊號≠0 時每次都讀）', async () => {
  const m = mutate(HC, 'JSON.stringify({ at: now, html, g: gen })', 'JSON.stringify({ at: now, html })', 'M4');
  const r = await expectRedAt(/NEG-CACHE/, async () => {
    const ls = makeLS();
    await runHome({ hcSrc: m, changelogBody: withGen(1), ls });
    const r2 = await runHome({ hcSrc: m, changelogBody: withGen(1), ls });
    assert.strictEqual(r2.calls, 0, 'NEG-CACHE：同世代第二次應命中負快取（0 次），實得 ' + r2.calls);
  });
  ok(r.red && r.hit, 'M4 突變沒被 NEG-CACHE 抓到：' + r.msg);
});
await T('M5 突變：首頁接線不看訊號、世代寫死 1 → 紅在 GATE-0-WIRE', async () => {
  const m = mutate(HP, 'return parseOverrideGen(t); })', 'return parseOverrideGen(t) || 1; })', 'M5');
  const r = await expectRedAt(/GATE-0-WIRE/, async () => {
    const out = await runHome({ pageSrc: m, changelogBody: genZeroBody });
    assert.strictEqual(out.calls, 0, 'GATE-0-WIRE：首訪竟然打了 Firestore（' + out.calls + ' 次）');
  });
  ok(r.red && r.hit, 'M5 突變沒被 GATE-0-WIRE 抓到：' + r.msg);
});
await T('M6 突變：changelog.html 訊號行拿掉 → 紅在 SIGNAL（正對照：程式端仍是 0 讀，fail-closed）', async () => {
  const r = await expectRedAt(/SIGNAL/, () => assertSignalParse(MOD, withoutSignal()));
  ok(r.red && r.hit, 'M6 突變沒被 SIGNAL 抓到：' + r.msg);
  const out = await runHome({ changelogBody: withoutSignal() });
  assert.strictEqual(out.calls, 0, '缺訊號時程式端應 fail-closed（0 讀）');
});
await T('M7 突變：rules 的 meta 區塊拿掉／write 條件放寬 → 各紅在 RULES-META', async () => {
  const gone = RULES.replace(/\s*\/\/ v6\.306[\s\S]*?match \/meta\/\{docId\} \{[\s\S]*?\}\n/, '\n');
  const r1 = await expectRedAt(/RULES-META/, () => assertRules(gone, CLOUD));
  ok(r1.red && r1.hit, 'M7a 拿掉 meta 沒被抓到：' + r1.msg);
  const loose = mutate(RULES, "      match /meta/{docId} {\n        allow read: if isSelf(userId) || isAdmin();\n        allow write: if isSelf(userId) || isAdmin();",
    "      match /meta/{docId} {\n        allow read: if isSelf(userId) || isAdmin();\n        allow write: if true;", 'M7b');
  const r2 = await expectRedAt(/RULES-META/, () => assertRules(loose, CLOUD));
  ok(r2.red && r2.hit, 'M7b write 放寬沒被抓到：' + r2.msg);
});
await T('M8 突變：changelog.html HTTP 失敗時 fail-open 成世代 1 → 紅在 FETCH-FAIL-0', async () => {
  const m = mutate(HP, "      .then((r) => (r.ok ? r.text() : ''))",
    "      .then((r) => (r.ok ? r.text() : '<!-- ptcg-override-gen:1 -->'))", 'M8');
  const r = await expectRedAt(/FETCH-FAIL-0/, async () => {
    const out = await runHome({ pageSrc: m, changelogBody: genZeroBody, fetchOpts: { status: 500 } });
    assert.strictEqual(out.calls, 0, 'FETCH-FAIL-0：changelog.html 載入失敗竟然還去讀 Firestore');
  });
  ok(r.red && r.hit, 'M8 突變沒被 FETCH-FAIL-0 抓到：' + r.msg);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('【P】接線自檢');
await T('P1 本守衛在 npm test chain 內', () => {
  const pkg = JSON.parse(rd('package.json'));
  ok(String(pkg.scripts && pkg.scripts.test).includes('test-v6306-home-changelog-gate.mjs'), '守衛沒接進 package.json 的 test chain —— 寫了等於沒寫');
});
await T('P2 本檔不 pin 站台版本號當判準、不整檔 sha256 鎖', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  ok(!/\b[0-9a-f]{64}\b/.test(self) && !/createHash\(/.test(self), '本檔出現整檔雜湊鎖');
  ok(!/VERSION\s*===\s*'6\./.test(self), '本檔拿版本號當判準');
});

if (skipped.length) console.log('\n⚠⚠ SHALLOW/ENV-SKIP：' + skipped.join('；'));
console.log(`\n${fail === 0 ? '✅' : '❌'} v6.306 home-changelog-gate：${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
