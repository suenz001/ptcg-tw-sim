#!/usr/bin/env node
/**
 * v6.472 守衛：後台「📡 監控」一鍵切換全站卡圖來源（縮圖站 ↔ 官方原圖）
 *
 * 站長（2026-10-03）：「圖片改成用 github 上面的 webp 讀取，感覺並沒有比直接從官網讀取快，反而體感變慢了，
 *   可以讓我在 admin 設定監控的地方一鍵切換嗎？」→ 選「全站一起切」。
 *
 * 設計：設定存在 Firestore `config/cardPolicy.thumbSource`（玩家端本來就會讀這份，有 10 分鐘快取 ⇒ 不多一次讀取）；
 *   policy-loader 讀到後交給 thumb.ts 的 setThumbSourcePref（寫 localStorage），thumb.ts 載入時同步讀 localStorage
 *   ⇒ 第一張圖就用對的來源。後台卡牌政策的兩個儲存鈕改 merge，否則會把 thumbSource 洗掉。
 *
 * 判準
 *   【A】thumb.ts 實跑（假 localStorage）：預設縮圖；localStorage='official' 時原樣回官方網址；setThumbSourcePref 切換＋寫回
 *   【B】policy-loader：讀到文件時把 thumbSource 交給 setThumbSourcePref；文件不存在時重設成縮圖  ★HEAD-FAIL
 *   【C】admin.html：monSetThumbSrc 實跑（假 setDoc）——只寫 thumbSource、merge:true；監控頁有兩顆按鈕；
 *        卡牌政策「儲存／清除」也改 merge:true（實跑抽出 onclick 本體不易，改以逐字判準＋計數鎖住）  ★HEAD-FAIL
 *
 * Run: node scripts/test-v6472-thumb-source-switch.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.471
const BASE_SHA = 'c98ffbf2';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const tmps = [];
process.on('exit', () => { for (const p of tmps) { try { rmSync(p, { recursive: true, force: true }); } catch {} } });

const OFFICIAL = 'https://asia.pokemon-card.com/tw/card-img/tw00018360.png';
const THUMB = 'https://suenz001.github.io/ptcg-tw-sim-img/w450/tw00018360.webp';

/** 每次都重新打包一份 thumb.ts（模組層狀態要從頭來），globalThis.localStorage 先設好 */
async function loadThumb(src, initial) {
  const d = mkdtempSync(join(tmpdir(), 'v6472-')); tmps.push(d);
  const f = join(d, 'thumb.ts'); writeFileSync(f, src);
  const o = join(d, 'thumb.mjs');
  await build({ entryPoints: [f], outfile: o, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
  const store = new Map(initial == null ? [] : [['ptcg_thumb_src_v1', initial]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const M = await import(pathToFileURL(o).href + '?' + Math.random());
  return { M, store };
}

console.log('【A】thumb.ts 實跑');
const THUMB_SRC = rd('src/lib/cards/thumb.ts');
{
  const { M } = await loadThumb(THUMB_SRC, null);
  ok('★[A1] 預設（沒設定）＝縮圖站', M.cardThumb(OFFICIAL) === THUMB, M.cardThumb(OFFICIAL));
}
{
  const { M } = await loadThumb(THUMB_SRC, 'official');
  ok('★★★[A2] localStorage=official 時，載入當下就用官方原圖（第一張圖就對，不會先載縮圖再換）', M.cardThumb(OFFICIAL) === OFFICIAL, M.cardThumb(OFFICIAL));
}
{
  const { M, store } = await loadThumb(THUMB_SRC, null);
  const f = typeof M.setThumbSourcePref === 'function' ? M.setThumbSourcePref : null;
  ok('★★[A3] 有 setThumbSourcePref', !!f);
  if (f) {
    f('official');
    const a = M.cardThumb(OFFICIAL), sa = store.get('ptcg_thumb_src_v1');
    f('thumb'); const b = M.cardThumb(OFFICIAL), sb = store.get('ptcg_thumb_src_v1');
    f('奇怪的值'); const c = M.cardThumb(OFFICIAL);
    f(undefined); const d = M.cardThumb(OFFICIAL);
    ok('★★[A4] 切換立即生效並寫回 localStorage；非 official 一律＝縮圖', a === OFFICIAL && sa === 'official' && b === THUMB && sb === 'thumb' && c === THUMB && d === THUMB, JSON.stringify({ a, sa, b, sb, c, d }));
  }
  ok('[A5] 非官方網址（站內圖）照舊原樣回傳', M.cardThumb('/img/x.png') === '/img/x.png');
}
{
  // localStorage 讀取會 throw（無痕／被封鎖）⇒ 退回縮圖、不炸
  const d = mkdtempSync(join(tmpdir(), 'v6472-')); tmps.push(d);
  const f = join(d, 'thumb.ts'); writeFileSync(f, THUMB_SRC); const o = join(d, 'thumb.mjs');
  await build({ entryPoints: [f], outfile: o, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
  globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  let r = null, err = null;
  try { const M = await import(pathToFileURL(o).href + '?' + Math.random()); r = M.cardThumb(OFFICIAL); M.setThumbSourcePref?.('official'); } catch (e) { err = e.message; }
  ok('★[A6] localStorage 被封鎖：不丟例外、維持縮圖', err === null && r === THUMB, String(err ?? r));
}

const CHECKS = [
  ['★★★[B1] policy-loader 讀到文件時把 thumbSource 交給 setThumbSourcePref；文件不存在時重設成縮圖', true, (S) =>
    /import \{ setThumbSourcePref \} from '\.\/thumb';/.test(S.loader)
    && /if \(!snap\.exists\(\)\) \{ setThumbSourcePref\(undefined\); writeCache\(null\); return; \}/.test(S.loader)
    && /setThumbSourcePref\(data\?\.thumbSource\);/.test(S.loader)],
  ['★★★[C1] 監控頁有「🖼️ 卡圖來源（全站）」與兩顆按鈕', true, (S) =>
    S.admin.includes('🖼️ 卡圖來源（全站）') && S.admin.includes(`onclick="monSetThumbSrc(\\'thumb\\', this)"`) && S.admin.includes(`onclick="monSetThumbSrc(\\'official\\', this)"`)],
  ['★★★[C2] 卡牌政策的「儲存」「清除」都改 merge:true（不會洗掉 thumbSource）；全檔寫 cardPolicy 的 setDoc 一律 merge', true, (S) => {
    const all = [...S.admin.matchAll(/setDoc\(doc\(dbF, 'config', 'cardPolicy'\), ([^\n]*)\);/g)].map((m) => m[1]);
    return all.length === 3 && all.every((x) => /\}, \{ merge: true \}$/.test(x.trim()));
  }],
];
const load = (g) => ({ loader: g('src/lib/cards/policy-loader.ts'), admin: g('oracle-admin/admin.html') });
const CUR = load(rd);
console.log('\n【B／C】原始碼');
for (const [n, , fn] of CHECKS) { let r = false; try { r = !!fn(CUR); } catch {} ok(n, r); }

console.log('\n【B2】policy-loader 實跑（假 Firestore、假 localStorage）');
{
  const d = mkdtempSync(join(tmpdir(), 'v6472-loader-')); tmps.push(d);
  let DOC = { exists: false, data: null }, reads = 0;
  globalThis.__v6472fs = { getDoc: async () => { reads++; return { exists: () => DOC.exists, data: () => DOC.data }; } };
  const stub = { name: 'stub', setup(b) {
    b.onResolve({ filter: /^\$lib\/firebase$/ }, () => ({ path: 'fb', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'fs', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: a.path === 'fb' ? 'export const db = {};' : 'export const doc = (d,a,b)=>a+"/"+b; export const getDoc = (...x)=>globalThis.__v6472fs.getDoc(...x);' }));
  } };
  const out = join(d, 'loader.mjs');
  await build({ entryPoints: [join(ROOT, 'src/lib/cards/policy-loader.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', plugins: [stub], logLevel: 'error' });
  const store = new Map();
  globalThis.window = globalThis.window || {};
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const fresh = async () => import(pathToFileURL(out).href + '?' + Math.random());
  const expire = () => { const c = JSON.parse(store.get('ptcg_card_policy_v1')); c.at -= 11 * 60 * 1000; store.set('ptcg_card_policy_v1', JSON.stringify(c)); };
  DOC = { exists: true, data: { allowedMarks: ['H', 'I', 'J'], lockedSets: [], thumbSource: 'official' } };
  await (await fresh()).loadCardPolicyOnce(); const k1 = store.get('ptcg_thumb_src_v1'), r1 = reads;
  await (await fresh()).loadCardPolicyOnce(); const r2 = reads;   // 快取命中：不重讀
  DOC = { exists: true, data: { allowedMarks: ['H', 'I', 'J'], lockedSets: [], thumbSource: 'thumb' } };
  expire(); await (await fresh()).loadCardPolicyOnce(); const k3 = store.get('ptcg_thumb_src_v1');
  DOC = { exists: true, data: { allowedMarks: ['H', 'I', 'J'], lockedSets: [], thumbSource: 'official' } };
  expire(); await (await fresh()).loadCardPolicyOnce();
  DOC = { exists: false, data: null };
  expire(); await (await fresh()).loadCardPolicyOnce(); const k5 = store.get('ptcg_thumb_src_v1');
  ok('★★★[B2] 讀到 official 就記下；快取期間不多讀一次；過期重讀會切回；文件不存在重設成縮圖',
    k1 === 'official' && r1 === 1 && r2 === 1 && k3 === 'thumb' && k5 === 'thumb', JSON.stringify({ k1, r1, r2, k3, k5 }));
}

console.log('\n【C】monSetThumbSrc 實跑（假 setDoc）');
{
  const i = CUR.admin.indexOf('window.monSetThumbSrc = async function (src, btn) {');
  const j = CUR.admin.indexOf('\n};\n', i);
  ok('[C3 前提] 抽得到 monSetThumbSrc', i > 0 && j > i);
  if (i > 0 && j > i) {
    const body = CUR.admin.slice(i, j + 3);
    const calls = []; let reloaded = 0;
    const win = {};
    new Function('window', 'setDoc', 'doc', 'dbF', 'loadMonitor', 'alert', body)(win,
      async (ref, data, opt) => { calls.push({ ref, data, opt }); }, (_db, a, b) => `${a}/${b}`, {}, async () => { reloaded++; }, () => {});
    await win.monSetThumbSrc('official', null);
    await win.monSetThumbSrc('thumb', null);
    await win.monSetThumbSrc('<script>', null);
    ok('★★★[C3] 只寫 config/cardPolicy 的 thumbSource、merge:true；非 official 一律寫 thumb；寫完重畫監控頁',
      calls.length === 3 && calls.every((c) => c.ref === 'config/cardPolicy' && c.opt?.merge === true && Object.keys(c.data).join() === 'thumbSource')
      && calls.map((c) => c.data.thumbSource).join() === 'official,thumb,thumb' && reloaded === 3, JSON.stringify(calls));
  }
}

console.log('\n【H】HEAD-FAIL：同一批判準餵 v6.471');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6472 H', '需要 v6.471 commit');
else {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const BASE = load(g);
  const wrong = CHECKS.filter(([, hf, fn]) => { let r = false; try { r = !!fn(BASE); } catch {} return hf && r; }).map(([n]) => n);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.471 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
  const { M } = await loadThumb(g('src/lib/cards/thumb.ts'), 'official');
  ok('★★[HEAD-FAIL A2] v6.471：設成 official 也照樣回縮圖（沒有開關）', M.cardThumb(OFFICIAL) === THUMB, M.cardThumb(OFFICIAL));
}

console.log(`\n=== v6.472 卡圖來源開關: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6472-thumb-source-switch ===');
process.exit(fail ? 1 : 0);
