// v5.968 sw-policy 純函式守衛:version-skew 白屏防護核心決策
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const O = join(ROOT, '.xswp.mjs');
process.on('exit', () => { try { unlinkSync(O); } catch {} });
await build({ entryPoints:[join(ROOT,'src/lib/sw-policy.ts')], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', logLevel:'error' });
const { cachesToDelete, isChunkLoadError } = await import(pathToFileURL(O).href);

let pass=0;
// ① 保留現行版 + 最近一個舊版,刪更舊的
{
  const keys=['ptcg-tw-sim-100','ptcg-tw-sim-200','ptcg-tw-sim-300'];
  const del=cachesToDelete(keys,'ptcg-tw-sim-300');
  assert.deepStrictEqual(del.sort(),['ptcg-tw-sim-100'],'應只刪最舊,保留 300(現行)+200(前一版)');
  assert.ok(!del.includes('ptcg-tw-sim-200'),'前一版必須保留(舊分頁靠它命中舊 chunk)');
  console.log('  ✅ ① 保留現行+前一版,刪更舊'); pass++;
}
// ② 只有現行版時不刪任何
{
  assert.deepStrictEqual(cachesToDelete(['ptcg-tw-sim-300'],'ptcg-tw-sim-300'),[]);
  console.log('  ✅ ② 只有現行版→不刪'); pass++;
}
// ③ 非本站前綴的雜 cache 要刪(不算前一版)
{
  const keys=['ptcg-tw-sim-300','ptcg-tw-sim-200','other-cache','sw-precache-v1'];
  const del=cachesToDelete(keys,'ptcg-tw-sim-300');
  assert.ok(del.includes('other-cache')&&del.includes('sw-precache-v1'),'非本站前綴一律刪');
  assert.ok(del.includes('ptcg-tw-sim-200')===false,'仍保留前一版');
  console.log('  ✅ ③ 非本站前綴刪除、仍保留前一版'); pass++;
}
// ④ chunk load error 偵測各瀏覽器樣本
{
  const yes=[
    'Failed to fetch dynamically imported module: https://x/_app/immutable/chunks/abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'ChunkLoadError: Loading chunk 3 failed',
  ];
  const no=['TypeError: x is not a function','NetworkError when attempting to fetch resource','',null];
  for(const m of yes) assert.ok(isChunkLoadError(m),'應判為 chunk error: '+m);
  for(const m of no) assert.ok(!isChunkLoadError(m),'不應判為 chunk error: '+m);
  console.log('  ✅ ④ chunk load error 偵測(4 正樣本/4 負樣本)'); pass++;
}
console.log(`\nPASS ${pass}/4 — sw-policy`);
