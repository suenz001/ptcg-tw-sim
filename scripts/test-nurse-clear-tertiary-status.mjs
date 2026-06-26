// 寶可夢中心的姐姐(及所有 clearStatus 治療):卡面「特殊狀態也全部恢復」應清三階層狀態。
//   healResolver clearStatus 原只清 status+secondaryStatus 漏 tertiaryStatus(睡+毒+燒三重時殘留燒傷)。
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-nt.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-nt.ts'); const O=join(ROOT,'.ent-nt.mjs');
writeFileSync(E,`import './src/lib/game/engine';
export { TRAINER_EFFECTS, RESOLVERS } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function run(){
  const tgt={iid:'T',cardId:'9999',damage:90,energyAttached:[],status:'asleep',secondaryStatus:'poisoned',tertiaryStatus:'burned',poisonDamagePerCheckup:2};
  const st={players:[{active:tgt,bench:[],hand:[],deck:[],discard:[],prizes:[]},{active:null,bench:[],hand:[],deck:[],discard:[],prizes:[]}],log:[],activePlayerIndex:0};
  const reg=M.TRAINER_EFFECTS.get('寶可夢中心的姐姐');
  const r1=reg(st,0,new Map());
  const params=r1.pendingSelection.params;
  const rr=M.RESOLVERS.get(r1.pendingSelection.effectKey);
  return rr({...st,pendingSelection:{params}},0,['T'],params,new Map()).players[0].active;
}
T('① 姐姐治療三重狀態(睡+毒+燒)→ 三格全清 + 回60(90→30)',()=>{
  const a=run();
  assert.equal(a.damage,30,'傷害應90-60=30,實際='+a.damage);
  assert.ok(!a.status,'status應清,實際='+a.status);
  assert.ok(!a.secondaryStatus,'secondaryStatus應清,實際='+a.secondaryStatus);
  assert.ok(!a.tertiaryStatus,'tertiaryStatus應清(HEAD漏清=殘留burned),實際='+a.tertiaryStatus);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
