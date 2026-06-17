import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url)); const E=join(ROOT,'.sw.ts'),O=join(ROOT,'.sw.mjs'),S=join(ROOT,'.st.js');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { abilityUsedAfterSwap } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { abilityUsedAfterSwap }=await import(pathToFileURL(O).href);
const card=(abil)=>({abilities: abil ? abil.map(n=>({name:n,effect:'',label:''})) : undefined});
let pass=0,fail=0; const T=(n,c)=>{try{assert(c);console.log('PASS',n);pass++}catch(e){console.log('FAIL',n);fail++}};
// 舊沒用過特性 → undefined(可用)
T('舊沒用過→可用', abilityUsedAfterSwap({abilityUsedThisTurn:false}, card(['無力充能']), card(['百花齊放']))===undefined);
// Q2: 舊用過 無力充能, 新 百花齊放(不同名) → undefined(可用)
T('Q2 不同名特性→可用', abilityUsedAfterSwap({abilityUsedThisTurn:true}, card(['無力充能']), card(['百花齊放']))===undefined);
// Q3: 舊用過 百花齊放, 新 百花齊放(同名) → true(擋)
T('Q3 同名特性→擋', abilityUsedAfterSwap({abilityUsedThisTurn:true}, card(['百花齊放']), card(['百花齊放']))===true);
// 新無特性 → undefined
T('新無特性→可用(無意義)', abilityUsedAfterSwap({abilityUsedThisTurn:true}, card(['百花齊放']), card(null))===undefined);
// 舊無特性卻 abilityUsed(理論不會) → undefined
T('舊無特性→可用', abilityUsedAfterSwap({abilityUsedThisTurn:true}, card(null), card(['百花齊放']))===undefined);
console.log(`\n=== abilityUsedAfterSwap ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
