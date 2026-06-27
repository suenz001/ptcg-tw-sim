// 神奇糖果(rare-candy-evolve)進化基礎→2階時,應清除特殊狀態(PDF §I-A-05)。
//   原 `status: pk.status` 把基底混亂/睡眠/麻痺帶到進化體→玩家報「神奇糖果進化無法解除混亂」。
//   v5.738 修:清狀態,暈眩山谷在場且基底混亂時保留混亂(例外)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-rc.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-rc.ts'); const O=join(ROOT,'.ent-rc.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
let STAGE2=null, BASIC=null, DAZE=null;
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);
    if(!STAGE2&&c.subtype==='Stage2')STAGE2=String(c.id);
    if(!BASIC&&c.supertype==='Pokemon'&&c.subtype==='Basic')BASIC=String(c.id);
    if(!DAZE&&c.name==='暈眩山谷')DAZE=String(c.id);}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function mk(baseStatus, stadium){
  const s=createGame({name:'A',entries:[{cardId:BASIC,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
  const base=inst(BASIC,{status:baseStatus, secondaryStatus:'poisoned'}); const stage2=inst(STAGE2);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    activeStadium: stadium?inst(stadium):null,
    players:[{...s.players[0],hand:[stage2],deck:[inst(BASIC)],discard:[],prizes:[],bench:[],active:base},{...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:[],bench:[],active:inst(BASIC)}],
    pendingSelection:{type:'hand-choose',actorIdx:0,sourcePlayerIdx:0,minCount:1,maxCount:1,effectKey:'rare-candy-evolve',params:{stage2Iid:stage2.iid}},
    _base:base.iid,_stage2:stage2.iid};
}
T('神奇糖果進化混亂基礎→進化體無混亂(且secondary中毒也清)',()=>{
  let r=mk('confused', null);
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'rare-candy-evolve',selectedIids:[r._base],actorIdx:0},pool);
  const a=r.players[0].active;
  assert.equal(a.cardId,STAGE2,'應已進化為2階');
  assert.ok(!a.status,'混亂應清除,實際status='+a.status);
  assert.ok(!a.secondaryStatus,'secondary中毒也應清,實際='+a.secondaryStatus);
});
T('神奇糖果進化睡眠基礎→無睡眠',()=>{
  let r=mk('asleep', null);
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'rare-candy-evolve',selectedIids:[r._base],actorIdx:0},pool);
  assert.ok(!r.players[0].active.status,'睡眠應清,實際='+r.players[0].active.status);
});
T('暈眩山谷在場:神奇糖果進化混亂基礎→保留混亂(例外)',()=>{
  if(!DAZE){console.log('  (無暈眩山谷卡,跳過)');return;}
  let r=mk('confused', DAZE);
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'rare-candy-evolve',selectedIids:[r._base],actorIdx:0},pool);
  assert.equal(r.players[0].active.status,'confused','暈眩山谷應保留混亂,實際='+r.players[0].active.status);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
