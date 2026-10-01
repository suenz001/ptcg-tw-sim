#!/usr/bin/env node
/**
 * v6.463 守衛：build 後處理 scripts/route-preload.mjs —— 替 ssr=false 的路由殼補上該頁自己的 modulepreload
 *
 * 由來：fable 5.1 審查第 5 項＋本機量測（2026-10-01；300ms RTT、50Mbps、CPU 1/2、無 SW 冷進站）：
 *   /tournament 的頁面節點與 1.9MB 對戰主程式要等 start/app 下載執行完才開始抓；補 modulepreload 後
 *   「錦標賽對戰」畫面出現 3.15 秒 → 2.78 秒（4 輪平均）。CSS 預載會被重複下載，刻意不做。
 *
 * 【U】單元（假 manifest＋假節點檔＋假 build 目錄，不需要真的 build）
 *   U1 tournament.html：補上 layout 節點＋路由節點＋它們的**靜態** import 閉包；dynamicImports 不預載
 *   U2 不寫任何 CSS 預載（本機量到會重複下載）
 *   U3 已經有的 href 不重複；build 裡不存在的檔不寫
 *   U4 冪等：重跑一次結果逐字相同（不會越疊越多）
 *   U5 index.html／404.html 一個字都不動（可能是別的路徑的 SPA fallback）
 *   U6 找不到 manifest ⇒ 不丟例外、不改任何檔（絕不弄壞 build）
 *   U7 節點對應是讀 .svelte-kit/generated 的節點檔（不是寫死編號）：把節點編號對調也對
 * 【W】接線：package.json 的 build 在 seo-prerender-meta 之後跑 route-preload（HEAD-FAIL：v6.462 沒有）
 * 【B】真 build（有 build/ 與 manifest 才跑，否則 ENV-SKIP）：tournament.html 的預載全部指向真的存在的檔，且含路由節點
 *
 * 突變（實跑）：M1 closure 改成也走 dynamicImports ⇒ U1 紅；M2 拿掉「已存在不重複」⇒ U3／U4 紅。
 *
 * Run: node scripts/test-v6463-route-preload.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.462（2b4b3988）。
const BASE_SHA = '2b4b3988bc136395741fe0641dd4651ca5df53e7';
const SRC_PATH = join(ROOT, 'scripts/route-preload.mjs');
const SRC = readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const TMP = mkdtempSync(join(tmpdir(), 'rp6463-'));
let seq = 0;
async function load(src) {
  const f = join(TMP, `rp${++seq}.mjs`); writeFileSync(f, src);
  return import(pathToFileURL(f).href);
}

// ── 假 build ──
function fixture({ swap = false } = {}) {
  const d = join(TMP, 'fx' + (++seq)); const out = join(d, 'build'); const kit = join(d, '.svelte-kit');
  const L = swap ? 5 : 0, T = swap ? 0 : 5;   // U7：節點編號對調
  mkdirSync(join(kit, 'output/client/.vite'), { recursive: true });
  mkdirSync(join(kit, 'generated/client-optimized/nodes'), { recursive: true });
  mkdirSync(join(out, '_app/immutable/nodes'), { recursive: true }); mkdirSync(join(out, '_app/immutable/chunks'), { recursive: true }); mkdirSync(join(out, '_app/immutable/assets'), { recursive: true });
  writeFileSync(join(kit, `generated/client-optimized/nodes/${L}.js`), 'import * as universal from "../../../../src/routes/+layout.ts";\nexport { default as component } from "../../../../src/routes/+layout.svelte";');
  writeFileSync(join(kit, `generated/client-optimized/nodes/${T}.js`), 'export { default as component } from "../../../../src/routes/tournament/+page.svelte";');
  const N = (i) => `.svelte-kit/generated/client-optimized/nodes/${i}.js`;
  const manifest = {
    [N(L)]: { file: `_app/immutable/nodes/${L}.LAY.js`, imports: ['_shared.js'], css: ['_app/immutable/assets/0.css'], dynamicImports: ['_dyn.js'] },
    [N(T)]: { file: `_app/immutable/nodes/${T}.TOU.js`, imports: ['_shared.js', '_big.js'] },
    '_shared.js': { file: '_app/immutable/chunks/shared.js' },
    '_big.js': { file: '_app/immutable/chunks/big.js', imports: ['_gone.js', 'src/lib/firebase.ts'] },
    '_gone.js': { file: '_app/immutable/chunks/gone.js' },          // build 裡不存在 ⇒ 不得寫
    'src/lib/firebase.ts': { file: '_app/immutable/chunks/fb.js' },
    '_dyn.js': { file: '_app/immutable/chunks/dyn.js' },            // 動態 import ⇒ 不得預載
  };
  writeFileSync(join(kit, 'output/client/.vite/manifest.json'), JSON.stringify(manifest));
  for (const f of [`nodes/${L}.LAY.js`, `nodes/${T}.TOU.js`, 'chunks/shared.js', 'chunks/big.js', 'chunks/fb.js', 'chunks/dyn.js', 'assets/0.css']) writeFileSync(join(out, '_app/immutable', f), '//');
  const shell = '<!doctype html><html><head>\n\t\t<link href="./_app/immutable/chunks/shared.js" rel="modulepreload">\n\t</head><body></body></html>';
  for (const h of ['tournament.html', 'index.html', '404.html']) writeFileSync(join(out, h), shell);
  return { out, kit, L, T, shell };
}
const hrefs = (html) => [...html.matchAll(/<link href="\.\/([^"]+)" rel="([^"]+)"/g)].map((m) => m[1] + '|' + m[2]);

const mod = await load(SRC);
console.log('【U】單元');
{
  const fx = fixture(); const log = [];
  mod.run({ out: fx.out, kit: fx.kit, log: (s) => log.push(s) });
  const h = readFileSync(join(fx.out, 'tournament.html'), 'utf8'); const hs = hrefs(h);
  const want = [`_app/immutable/nodes/${fx.L}.LAY.js|modulepreload`, `_app/immutable/nodes/${fx.T}.TOU.js|modulepreload`, '_app/immutable/chunks/big.js|modulepreload', '_app/immutable/chunks/fb.js|modulepreload'];
  ok('★★★[U1] tournament.html 補上 layout＋路由節點＋靜態 import 閉包（含主程式 big.js）', want.every((w) => hs.includes(w)), JSON.stringify(hs));
  ok('★★[U1b] 動態 import（dyn.js）不預載', !hs.some((x) => x.includes('dyn.js')), JSON.stringify(hs));
  ok('★★[U2] 不寫任何 CSS 預載（本機量到會重複下載）', !/as="style"|\.css"/.test(h), JSON.stringify(hs));
  ok('★★[U3] 已有的 shared.js 不重複、build 裡不存在的 gone.js 不寫', hs.filter((x) => x.includes('shared.js')).length === 1 && !hs.some((x) => x.includes('gone.js')), JSON.stringify(hs));
  mod.run({ out: fx.out, kit: fx.kit, log: () => {} });
  ok('★★[U4] 冪等：重跑一次逐字相同', readFileSync(join(fx.out, 'tournament.html'), 'utf8') === h);
  ok('★★★[U5] index.html／404.html 一個字都不動', ['index.html', '404.html'].every((f) => readFileSync(join(fx.out, f), 'utf8') === fx.shell));
}
{
  const fx = fixture(); rmSync(join(fx.kit, 'output/client/.vite/manifest.json'));
  let threw = null; try { mod.run({ out: fx.out, kit: fx.kit, log: () => {} }); } catch (e) { threw = e; }
  ok('★★[U6] 找不到 manifest ⇒ 不丟例外、tournament.html 不變', !threw && readFileSync(join(fx.out, 'tournament.html'), 'utf8') === fx.shell, threw && threw.message);
}
{
  const fx = fixture({ swap: true }); mod.run({ out: fx.out, kit: fx.kit, log: () => {} });
  const hs = hrefs(readFileSync(join(fx.out, 'tournament.html'), 'utf8'));
  ok('★★[U7] 節點編號對調仍正確（讀節點檔判斷，不寫死編號）', hs.includes('_app/immutable/nodes/0.TOU.js|modulepreload') && hs.includes('_app/immutable/nodes/5.LAY.js|modulepreload'), JSON.stringify(hs));
}

console.log('\n【W】接線');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
ok('★★★[W1] build 在 seo-prerender-meta 之後跑 route-preload', /seo-prerender-meta\.mjs && node scripts\/route-preload\.mjs/.test(pkg.scripts.build), pkg.scripts.build);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const r = readBaseBlob(ROOT, BASE_SHA, 'package.json');
  if (r.ok) ok('★★[W2 HEAD-FAIL] v6.462 的 build 沒有 route-preload ⇒ W1 在 BASE 必紅', !JSON.parse(r.out).scripts.build.includes('route-preload'));
  else shallowSkip('v6463 W2', '讀不到 BASE blob');
} else shallowSkip('v6463 W2', '需要 v6.462 commit');

console.log('\n【B】真 build');
const bt = join(ROOT, 'build/tournament.html');
if (existsSync(bt) && bt && readFileSync(bt, 'utf8').includes('route-preload:start')) {
  const h = readFileSync(bt, 'utf8'); const block = h.slice(h.indexOf('route-preload:start'), h.indexOf('route-preload:end'));
  const hs = hrefs(block).map((x) => x.split('|')[0]);
  ok('★★[B1] tournament.html 的預載全部指向 build 裡真的存在的檔，且含路由節點', hs.length > 3 && hs.every((f) => existsSync(join(ROOT, 'build', f))) && hs.some((f) => f.includes('/nodes/')), JSON.stringify(hs.filter((f) => !existsSync(join(ROOT, 'build', f)))));
} else console.log('  ENV-SKIP B1（沒有含預載的 build/tournament.html；CI 的 build 步驟才會產生）');

console.log('\n【突變】');
const M1 = SRC.replace('for (const i of e.imports || []) walk(i);', 'for (const i of [...(e.imports || []), ...(e.dynamicImports || [])]) walk(i);');
ok('[M1 自驗] 突變有套上', M1 !== SRC);
if (M1 !== SRC) { const m = await load(M1); const fx = fixture(); m.run({ out: fx.out, kit: fx.kit, log: () => {} });
  ok('★★[M1] closure 也走 dynamicImports ⇒ U1b 必紅（dyn.js 被預載）', hrefs(readFileSync(join(fx.out, 'tournament.html'), 'utf8')).some((x) => x.includes('dyn.js'))); }
const M2 = SRC.replace("const has = (f) => html.includes('\"./' + f + '\"') || html.includes('\"/' + f + '\"');", 'const has = () => false;');
ok('[M2 自驗] 突變有套上', M2 !== SRC);
if (M2 !== SRC) { const m = await load(M2); const fx = fixture(); m.run({ out: fx.out, kit: fx.kit, log: () => {} });
  ok('★★[M2] 拿掉「已存在不重複」⇒ U3 必紅（shared.js 出現兩次）', hrefs(readFileSync(join(fx.out, 'tournament.html'), 'utf8')).filter((x) => x.includes('shared.js')).length > 1); }

rmSync(TMP, { recursive: true, force: true });
console.log(`\n=== v6.463 路由殼 modulepreload: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6463-route-preload ===');
process.exit(fail ? 1 : 0);
