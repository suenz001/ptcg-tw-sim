// v6.281 守衛：Firestore 讀取減量【定案輪】
//
// ── 這一版在做什麼 ────────────────────────────────────────────────────────
// 2026-09-02 三份真實資料交叉定案：免費額度的大宗是首頁 config/homeChangelog
// （一份 404、根本不存在的文件）約 3.7 萬讀/天（官方明文：零結果查詢計 1 讀但
// 不顯示在用量儀表板）；儀表板看得到的 97.2% 是 admin 的 /feedbacks 全撈。
//   【A】home-changelog-cache：負結果 TTL 6h → 30 天＋快取綁站台版本（欄位 v，
//        版本一變即未命中；舊格式無 v 一律未命中）。正結果維持 6h。
//   【C】server_admin_patch.js：FEEDBACKS_TTL_MS 5 分鐘 → 30 分鐘（只改常數）。
//
// ── 怎麼證明（行為端實跑；時間流逝用「回撥快取的 at 欄位」模擬，不 mock Date）──
//  【0】自我驗證：空模組上核心斷言必紅；export 常數實際求值（不比對字面）
//  【A】負結果 29 天命中/31 天未命中；正結果 5h 命中/7h 未命中；版本綁定
//       （tamper v ＋ 雙 bundle 注入不同版本字串互證）；舊格式未命中；
//       時鐘倒退/形狀損毀/隱私模式不炸；fetch 失敗不寫快取；
//       負結果 6h 後仍命中（＝與 v6.273 的行為差異點，HEAD-FAIL 主力）
//  【C】FEEDBACKS_TTL_MS 實際求值 === 30 分鐘；快取段實跑：TTL 內 0 輪、
//       invalidateFeedbacksCache 後立刻重讀
//  【H】HEAD-FAIL：對 BASE（v6.280）blob 跑核心斷言，每一條各自紅在**指定的那一條**
//  【I】突變測試 5 條，每一條紅在指定斷言（附正對照）
//  【P】本守衛必須在 npm test chain 內（防「寫了守衛沒接上」）
//
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外（打錯字/抽取器壞掉）必須直接炸掉。
// ⚠ 不 pin 任何站台版本號：VERSION 動態抽自 src/lib/version.ts。
// Run: node scripts/test-v6281-firestore-read-reduction.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '3913d73a392ca0d5e791d126176124393cc6de39';   // v6.280（HEAD-FAIL 對照）

const P_HC = 'src/lib/home-changelog-cache.ts';
const P_SRV = 'oracle-admin/server_admin_patch.js';
const HC = readFileSync(join(ROOT, P_HC), 'utf8');
const SRV = readFileSync(join(ROOT, P_SRV), 'utf8');

let pass = 0, fail = 0;
const T = async (n, f) => {
  try { await f(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
const esbuild = await import('esbuild');

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const CACHE_KEY = 'ptcg_home_cl_cache_v1';

// ── 假 localStorage（與 test-v6273 同款）─────────────────────────────────
function makeLS(opts = {}) {
  const store = new Map(opts.seed || []);
  return {
    store,
    getItem: (k) => { if (opts.throwOnAccess) throw new Error('SecurityError: private mode'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (opts.throwOnAccess || opts.throwOnWrite) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    removeItem: (k) => { if (opts.throwOnAccess) throw new Error('SecurityError'); store.delete(k); },
  };
}

// ── bundler：可用 verOverride 注入任意「站台版本字串」（版本綁定就靠這個測）──
//   不帶 verOverride 時吃真的 src/lib/version.ts（相對路徑 ./version 由 esbuild 解析）。
//   BASE（v6.273 版）沒有 import ./version，同一支 bundler 也照樣打得動。
async function bundleHC(srcText, verOverride) {
  const plugins = [];
  if (verOverride !== undefined) {
    plugins.push({ name: 'ver-stub', setup(b) {
      b.onResolve({ filter: /^\.\/version$/ }, () => ({ path: 'ver-stub', namespace: 'stub' }));
      b.onLoad({ filter: /^ver-stub$/, namespace: 'stub' }, () => ({
        contents: `export const VERSION = ${JSON.stringify(verOverride)};`, loader: 'js' }));
    } });
  }
  const out = await esbuild.build({
    stdin: { contents: srcText, loader: 'ts', resolveDir: join(ROOT, 'src/lib'), sourcefile: 'mod.ts' },
    bundle: true, format: 'cjs', write: false, platform: 'neutral', logLevel: 'silent', plugins,
  });
  const m = { exports: {} };
  new Function('module', 'exports', out.outputFiles[0].text)(m, m.exports);
  return m.exports;
}

// ── 時間流逝模擬：回撥快取的 at 欄位（其餘欄位一個位元不動）─────────────
function rewindAt(ls, ms) {
  const raw = ls.store.get(CACHE_KEY);
  assert.ok(raw, 'rewindAt：快取根本沒被寫入');
  const o = JSON.parse(raw);
  o.at -= ms;
  ls.store.set(CACHE_KEY, JSON.stringify(o));
}
function tamper(ls, fn) {
  const raw = ls.store.get(CACHE_KEY);
  assert.ok(raw, 'tamper：快取根本沒被寫入');
  const o = JSON.parse(raw);
  fn(o);
  ls.store.set(CACHE_KEY, JSON.stringify(o));
}

// ══════════════════════════════════════════════════════════════════════════
// 核心斷言函式（【A】【H】【I】共用；訊息前綴＝紅點定位錨）
// ══════════════════════════════════════════════════════════════════════════
async function assertNeg30d(mod) {
  const ls = makeLS(); globalThis.localStorage = ls;
  let calls = 0; const f = async () => { calls++; return null; };
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 1, 'NEG-FIRST：第一次應恰 1 次 fetch');
  rewindAt(ls, 29 * DAY);
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 1, 'NEG-29D：負結果 29 天內應命中（0 次 fetch）');
  rewindAt(ls, 2 * DAY);   // 累計 31 天
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 2, 'NEG-31D：負結果 31 天應過期、重新 fetch');
}
async function assertNeg6h(mod) {   // 與 v6.273 的差異點（BASE 上必紅在這條）
  const ls = makeLS(); globalThis.localStorage = ls;
  let calls = 0; const f = async () => { calls++; return null; };
  await mod.loadHomeChangelogOverride(f);
  rewindAt(ls, 6 * HOUR + 60_000);
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 1, 'NEG-6H：負結果 6 小時後應仍命中（v6.273 的 6h TTL 零命中正是本版要修的）');
}
async function assertPos6h(mod) {
  const ls = makeLS(); globalThis.localStorage = ls;
  let calls = 0; const f = async () => { calls++; return '<b>公告</b>'; };
  const g1 = await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(g1, '<b>公告</b>', 'POS-GET：第一次應拿到 override');
  rewindAt(ls, 5 * HOUR);
  const g2 = await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 1, 'POS-5H：正結果 5 小時內應命中（0 次 fetch）');
  assert.strictEqual(g2, '<b>公告</b>', 'POS-5H：命中拿到的內容不對');
  rewindAt(ls, 2 * HOUR);  // 累計 7 小時
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 2, 'POS-7H：正結果 7 小時應過期（絕不可套負結果的 30 天——admin 改公告要 6h 內全站生效）');
}
async function assertVerBind(mod, modOther) {
  const ls = makeLS(); globalThis.localStorage = ls;
  let calls = 0; const f = async () => { calls++; return null; };
  await mod.loadHomeChangelogOverride(f);
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 1, 'VER-SAME：同版本剛寫入應命中');
  tamper(ls, (o) => { o.v = '0.000'; });   // at 全新、只有版本不同
  await mod.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 2, 'VER-DIFF：版本字串不同應未命中（不論快取多新）');
  // 雙 bundle 互證：另一個版本的模組寫的快取，本版讀必須未命中
  let callsOther = 0;
  await modOther.loadHomeChangelogOverride(async () => { callsOther++; return null; });
  assert.strictEqual(callsOther, 1, 'VER-CROSS-W：對照模組應 fetch 一次並寫入自己的版本');
  let calls3 = 0;
  await mod.loadHomeChangelogOverride(async () => { calls3++; return null; });
  assert.strictEqual(calls3, 1, 'VER-CROSS：別的站台版本寫的快取，本版應未命中（重讀一次）');
}
async function assertOldFormat(mod) {
  globalThis.localStorage = makeLS({ seed: [[CACHE_KEY, JSON.stringify({ at: Date.now() - 1000, html: null })]] });
  let calls = 0;
  await mod.loadHomeChangelogOverride(async () => { calls++; return null; });
  assert.strictEqual(calls, 1, 'OLD-FMT：舊格式快取（無 v 欄位，v6.273~v6.280 寫入）必須視為未命中');
}
function assertSrvTtl(srvSrc) {
  const m = srvSrc.match(/const FEEDBACKS_TTL_MS = ([^;]+?);/);
  assert.ok(m, 'SRV-TTL：server_admin_patch.js 找不到 FEEDBACKS_TTL_MS 宣告');
  const v = new Function('return (' + m[1] + ');')();   // 實際求值，不比對字面
  assert.strictEqual(v, 30 * 60 * 1000, 'SRV-TTL：FEEDBACKS_TTL_MS 實際求值應為 30 分鐘，實得 ' + v);
  assert.ok(/function invalidateFeedbacksCache\(\)/.test(srvSrc),
    'SRV-INV：invalidateFeedbacksCache 不見了（admin 回覆/刪除後要立刻看到）');
}

// ── expectRedAt：斷言「紅、而且紅在預期的那一條」；只捕 AssertionError ──
async function expectRedAt(re, fn) {
  try { await fn(); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
    return { red: true, hit: re.test(e.message), msg: e.message };
  }
  return { red: false, hit: false, msg: '(綠燈)' };
}

// ══════════════════════════════════════════════════════════════════════════
console.log('【0】自我驗證（Rule 25：先證明斷言不是安慰劑）');
await T('0-1 [正對照] 空模組上核心斷言必炸（bundler/斷言不是安慰劑）', async () => {
  const empty = await bundleHC('export const x = 1;');
  let threw = false;
  try { await assertNeg30d(empty); } catch { threw = true; }   // TypeError 也算「不是綠」
  ok(threw, '空模組上 assertNeg30d 竟然綠 —— 斷言沒在測東西');
});
await T('0-2 export 常數實際求值：正 6h / 負 30 天', async () => {
  const mod = await bundleHC(HC);
  assert.strictEqual(mod.HOME_CL_TTL_MS, 6 * HOUR, 'HOME_CL_TTL_MS 應為 6 小時');
  assert.strictEqual(mod.HOME_CL_NEG_TTL_MS, 30 * DAY, 'HOME_CL_NEG_TTL_MS 應為 30 天');
});
await T('0-3 [正對照] rewindAt/tamper 對「沒寫過快取」的 store 必紅', async () => {
  const r = await expectRedAt(/rewindAt/, async () => rewindAt(makeLS(), 1000));
  ok(r.red && r.hit, 'rewindAt 對空 store 竟然沒紅：' + r.msg);
});

console.log('【A】home-changelog-cache（負 30 天＋版本綁定，行為實跑）');
const MOD = await bundleHC(HC);
await T('A1 ⭐ 負結果 29 天命中（0 fetch）／31 天未命中（重新 fetch）', () => assertNeg30d(MOD));
await T('A2 ⭐ 負結果 6 小時後仍命中（v6.273 是零命中 —— 本版的核心差異）', () => assertNeg6h(MOD));
await T('A3 正結果 TTL 維持 6h：5 小時命中／7 小時未命中', () => assertPos6h(MOD));
await T('A4 ⭐ 版本綁定：tamper v／雙 bundle 不同版本互證，一律未命中', async () => {
  await assertVerBind(MOD, await bundleHC(HC, '9.999-test'));
});
await T('A5 舊格式（無 v 欄位）→ 未命中', () => assertOldFormat(MOD));
await T('A6 時鐘倒退（at 在未來、版本正確）→ 未命中', async () => {
  const ls = makeLS(); globalThis.localStorage = ls;
  let calls = 0; const f = async () => { calls++; return null; };
  await MOD.loadHomeChangelogOverride(f);
  tamper(ls, (o) => { o.at = Date.now() + HOUR; });
  await MOD.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 2, 'CLOCK-BACK：未來時間戳的快取竟然被採信（v6.198 教訓）');
});
await T('A7 形狀損毀（html 非 null 非 string／爛 JSON）→ 未命中且不炸', async () => {
  const mod = MOD;
  const goodV = JSON.parse((() => { const ls = makeLS(); globalThis.localStorage = ls; mod.writeCachedOverride(null); return ls.store.get(CACHE_KEY); })()).v;
  for (const bad of ['{{{not json', JSON.stringify({ at: Date.now() - 1000, html: 123, v: goodV }), JSON.stringify({ at: 'x', html: null, v: goodV })]) {
    globalThis.localStorage = makeLS({ seed: [[CACHE_KEY, bad]] });
    let calls = 0;
    await mod.loadHomeChangelogOverride(async () => { calls++; return null; });
    assert.strictEqual(calls, 1, 'SHAPE：損毀快取（' + bad.slice(0, 24) + '）沒有 fallback 成照舊 fetch');
  }
});
await T('A8 隱私模式（localStorage 一律 throw）→ 每次照舊 fetch，不炸', async () => {
  globalThis.localStorage = makeLS({ throwOnAccess: true });
  let calls = 0; const f = async () => { calls++; return null; };
  await MOD.loadHomeChangelogOverride(f);
  await MOD.loadHomeChangelogOverride(f);
  assert.strictEqual(calls, 2, 'PRIVATE：隱私模式下應每次都 fetch（行為與修前相同）');
});
await T('A9 fetch 失敗 → 例外往上丟且不寫快取', async () => {
  const ls = makeLS(); globalThis.localStorage = ls;
  let threw = false;
  await MOD.loadHomeChangelogOverride(async () => { throw new Error('net down'); }).catch(() => { threw = true; });
  ok(threw, 'FETCH-FAIL：失敗應往上丟給呼叫端 .catch');
  ok(!ls.store.has(CACHE_KEY), 'FETCH-FAIL：失敗竟然寫了快取（會把網路錯誤釘 30 天！）');
});

console.log('【C】server_admin_patch.js（feedbacks 快取 TTL 30 分鐘）');
await T('C1 FEEDBACKS_TTL_MS 實際求值 === 30 分鐘；invalidateFeedbacksCache 仍在', () => assertSrvTtl(SRV));
function buildFeedbackCache(srvSrc) {
  const a = srvSrc.indexOf('  const FEEDBACKS_TTL_MS =');
  assert.ok(a >= 0, 'C2 抽取：找不到 FEEDBACKS_TTL_MS');
  const endMark = 'function invalidateFeedbacksCache() { _feedbacksCache.at = 0; _feedbacksCache.data = null; }';
  const b = srvSrc.indexOf(endMark, a);
  assert.ok(b >= 0, 'C2 抽取：找不到 invalidateFeedbacksCache 定義');
  const seg = srvSrc.slice(a, b + endMark.length);
  assert.ok(seg.length > 600, 'C2 抽取：只抽到 ' + seg.length + ' 字元 —— 抽取器壞了？');
  let gets = 0;
  const adminDb = { collection: (name) => ({ orderBy: () => ({ limit: () => ({ get: async () => {
    assert.strictEqual(name, 'feedbacks', 'C2：撈錯 collection');
    gets++;
    return { docs: [{ id: 'f1', data: () => ({ content: 'hi', createdAt: 1 }) }] };
  } }) }) }) };
  const api = new Function('adminDb', 'tsToMillis', 'console',
    '"use strict";\n' + seg + '\nreturn { getFeedbacksCached, invalidateFeedbacksCache };')(
    adminDb, (v) => (typeof v === 'number' ? v : null), console);
  return { ...api, getGets: () => gets };
}
await T('C2 快取段實跑：TTL 內 0 輪；invalidate 後立刻重讀（站長回覆後要馬上看到）', async () => {
  const f = buildFeedbackCache(SRV);
  await f.getFeedbacksCached();
  await f.getFeedbacksCached();
  assert.strictEqual(f.getGets(), 1, 'C2：TTL 內第二次竟然又全撈了');
  f.invalidateFeedbacksCache();
  await f.getFeedbacksCached();
  assert.strictEqual(f.getGets(), 2, 'C2：invalidate 後沒有立刻重讀 —— 站長會看到自己的回覆消失');
});

console.log('【H】HEAD-FAIL（BASE=v6.280 上必須各自紅在指定斷言）');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6281 H1~H4 HEAD-FAIL 全節', '【I】突變測試不需要歷史、仍在守');
} else {
  const bHC = readBaseBlob(ROOT, BASE_SHA, P_HC);
  const bSRV = readBaseBlob(ROOT, BASE_SHA, P_SRV);
  await T('H0 BASE blob 拿得到', () => { ok(bHC.ok && bSRV.ok, 'BASE blob 拿不到'); });
  const bMod = await bundleHC(bHC.out);
  await T('H1 BASE 上「負結果 6h 仍命中」紅在 NEG-6H', async () => {
    const r = await expectRedAt(/NEG-6H/, () => assertNeg6h(bMod));
    ok(r.red, 'BASE 竟然已有 30 天負快取？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
  await T('H2 BASE 上「舊格式未命中」紅在 OLD-FMT（BASE 會命中舊格式）', async () => {
    const r = await expectRedAt(/OLD-FMT/, () => assertOldFormat(bMod));
    ok(r.red, 'BASE 竟然拒收無 v 的快取？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
  await T('H3 BASE 上「負結果 29 天命中」紅在 NEG-29D', async () => {
    const r = await expectRedAt(/NEG-29D/, () => assertNeg30d(bMod));
    ok(r.red, 'BASE 的 6h TTL 竟然撐過 29 天？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
  await T('H4 BASE 上「TTL=30 分鐘」紅在 SRV-TTL（BASE 求值是 300000）', async () => {
    const r = await expectRedAt(/SRV-TTL/, () => assertSrvTtl(bSRV.out));
    ok(r.red, 'BASE 的 FEEDBACKS_TTL_MS 竟然已是 30 分鐘？'); ok(r.hit, '紅的位置不對：' + r.msg);
  });
}

console.log('【I】突變測試（每一條紅在指定斷言；附正對照）');
function mutate(src, old, neu, tag) {
  const n = src.split(old).length - 1;
  assert.strictEqual(n, 1, `[${tag}] 突變錨點出現 ${n} 次（要求恰 1）—— 突變根本沒種進去`);
  return src.replace(old, neu);
}
await T('I1 突變：TTL 選擇恆用 6h → 紅在 NEG-29D（正對照：正結果測試仍綠）', async () => {
  const m = mutate(HC, 'const ttl = o.html === null ? HOME_CL_NEG_TTL_MS : HOME_CL_TTL_MS;',
    'const ttl = HOME_CL_TTL_MS;', 'I1');
  const mod = await bundleHC(m);
  const r = await expectRedAt(/NEG-29D/, () => assertNeg30d(mod));
  ok(r.red && r.hit, 'I1 突變沒被 NEG-29D 抓到：' + r.msg);
  await assertPos6h(mod);   // 正對照：這個突變不影響正結果路徑
});
await T('I2 突變：拿掉版本檢查 → 紅在 OLD-FMT（正對照：30 天 TTL 測試仍綠）', async () => {
  const m = mutate(HC, "    if (o.v !== VERSION) return { hit: false, html: null };",
    '    // mutated: no version check', 'I2');
  const mod = await bundleHC(m);
  const r = await expectRedAt(/OLD-FMT/, () => assertOldFormat(mod));
  ok(r.red && r.hit, 'I2 突變沒被 OLD-FMT 抓到：' + r.msg);
  await assertNeg30d(mod);   // 正對照：版本檢查拿掉不影響 TTL 語意
});
await T('I3 突變：負 TTL 常數改 1h → 紅在 NEG-29D', async () => {
  const m = mutate(HC, 'export const HOME_CL_NEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;',
    'export const HOME_CL_NEG_TTL_MS = 60 * 60 * 1000;', 'I3');
  const r = await expectRedAt(/NEG-29D/, async () => assertNeg30d(await bundleHC(m)));
  ok(r.red && r.hit, 'I3 突變沒被 NEG-29D 抓到：' + r.msg);
});
await T('I4 突變：寫入端漏掉 v 欄位 → 紅在 NEG-29D（自己寫的自己讀不回）', async () => {
  const m = mutate(HC, "JSON.stringify({ at: now, html, v: VERSION })",
    'JSON.stringify({ at: now, html })', 'I4');
  const r = await expectRedAt(/NEG-29D/, async () => assertNeg30d(await bundleHC(m)));
  ok(r.red && r.hit, 'I4 突變沒被抓到（漏寫 v ⇒ 每次都是未命中 ⇒ 讀取減量整個失效）：' + r.msg);
});
await T('I5 突變：伺服器 TTL 改回 5 分鐘 → 紅在 SRV-TTL', async () => {
  const m = mutate(SRV, 'const FEEDBACKS_TTL_MS = 30 * 60 * 1000;',
    'const FEEDBACKS_TTL_MS = 5 * 60 * 1000;', 'I5');
  const r = await expectRedAt(/SRV-TTL/, () => assertSrvTtl(m));
  ok(r.red && r.hit, 'I5 突變沒被 SRV-TTL 抓到：' + r.msg);
});

console.log('【P】接線自檢');
await T('P1 本守衛在 npm test chain 內', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  ok(String(pkg.scripts && pkg.scripts.test).includes('test-v6281-firestore-read-reduction.mjs'),
    '守衛沒接進 package.json 的 test chain —— 寫了等於沒寫');
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} v6.281 firestore-read-reduction：${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
