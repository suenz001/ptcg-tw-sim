// v5.741：各進化路徑(覺醒/緊急進化/壯偉碩木/早熟進化等)清除特殊狀態,
//   收斂中央 evolvedStatusAfter(暈眩山谷例外保留混亂)。取代手寫 status: base.status。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-es.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-es.ts'); const O=join(ROOT,'.ent-es.mjs');
writeFileSync(E,`import './src/lib/game/engine';
export { RESOLVERS, evolvedStatusAfter } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { RESOLVERS, evolvedStatusAfter }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); const evoOf=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);
    if(!byName.has(c.name))byName.set(c.name,String(c.id));
    if(c.evolvesFrom&&!evoOf.has(c.evolvesFrom))evoOf.set(c.evolvesFrom,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const anyId=byName.get([...byName.keys()][0]);
function gs(active0, stadium){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    activeStadium:stadium?inst(stadium):null,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],log:[],
    players:[{name:'A',hand:[],deck:[],discard:[],prizes:[],bench:[],active:active0},
             {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};
}
// 單元:predicate
T('evolvedStatusAfter:無暈眩山谷→清除(回{})',()=>{
  const base=inst(anyId,{status:'asleep'});
  assert.deepEqual(evolvedStatusAfter(base, gs(base,null), pool), {});
});
T('evolvedStatusAfter:暈眩山谷+混亂→保留',()=>{
  const DAZE=byName.get('暈眩山谷'); if(!DAZE){console.log('  (無暈眩山谷,跳過)');return;}
  const base=inst(anyId,{status:'confused'});
  assert.deepEqual(evolvedStatusAfter(base, gs(base,DAZE), pool), {status:'confused'});
});
T('evolvedStatusAfter:暈眩山谷+睡眠→清除(只保留混亂)',()=>{
  const DAZE=byName.get('暈眩山谷'); if(!DAZE){return;}
  const base=inst(anyId,{status:'asleep'});
  assert.deepEqual(evolvedStatusAfter(base, gs(base,DAZE), pool), {});
});
// end-to-end:石居蟹覺醒
T('石居蟹覺醒進化:基礎睡眠→進化體無狀態(end-to-end)',()=>{
  const fn=RESOLVERS.get('crab-awaken-evolve'); assert.ok(fn,'無 crab-awaken-evolve');
  const baseId=byName.get('石居蟹'), evoId=evoOf.get('石居蟹');
  if(!baseId||!evoId){console.log('  (pool無石居蟹進化鏈,跳過)');return;}
  const base=inst(baseId,{status:'asleep',secondaryStatus:'poisoned',damage:20,energyAttached:[inst(anyId)]});
  const evo=inst(evoId);
  let st=gs(base,null); st.players[0].deck=[evo];
  st=fn(st,0,[evo.iid],{},pool);
  const a=st.players[0].active;
  assert.equal(a.cardId,String(evoId),'應已進化');
  assert.ok(!a.status&&!a.secondaryStatus,'進化應清狀態,實際='+[a.status,a.secondaryStatus]);
  assert.equal(a.damage,20,'應保留傷害');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
