import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sc-s.js'),E=join(ROOT,'.sc-e.ts'),O=join(ROOT,'.sc-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { selfCheckAbilityRegistry } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { selfCheckAbilityRegistry } = await import(pathToFileURL(O).href);
const r = selfCheckAbilityRegistry();
let pass=0,fail=0;
if(r.ok===true){pass++}else{fail++;console.log('  ✗ 期望 ok:true, 實得',JSON.stringify(r))}
if(Array.isArray(r.missing)&&r.missing.length===0){pass++}else{fail++;console.log('  ✗ 期望 missing 為空')}
console.log(`\n特性註冊自檢 test：PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
