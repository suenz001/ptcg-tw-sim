// 迷唇姐|邀請之吻:卡面「牌庫選1基礎放備戰,然後選1個迷唇姐身上的能量改附於新上場的寶可夢」。
//   原只放基礎、能量搬移寫「請手動」未實裝。v5.737 補:放基礎→選能量→自動附到新上場那隻。
//   直接驅動 RESOLVE_SELECTION 鏈(繞過 ATTACK gating,專測 resolver)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-ik.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-ik.ts'); const O=join(ROOT,'.ent-ik.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);}}
const KISS='10442', PSY='14103', GARC='12702', BASIC='18523';
let iid=0;const inst=(cid,e={})=>({iid:`k${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function mk(pending){
  const s=createGame({name:'P1',entries:[{cardId:KISS,count:1}]},{name:'P2',entries:[{cardId:GARC,count:1}]},pool);
  const e1=inst(PSY),e2=inst(PSY); const basic=inst(BASIC);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[basic,inst(GARC),inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:inst(KISS,{energyAttached:[e1,e2]})},
             {...s.players[1],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:inst(GARC)}],
    pendingSelection:pending, _e1:e1.iid, _basic:basic.iid};
}
T('放基礎→搬1能量到新上場',()=>{
  let r=mk({type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter:'Basic',minCount:0,maxCount:1,effectKey:'invite-kiss-place'});
  const basicIid=r._basic, e1=r._e1;
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'invite-kiss-place',selectedIids:[basicIid],actorIdx:0},pool);
  assert.ok(r.pendingSelection,'放基礎後應開選能量picker,實際='+JSON.stringify(r.pendingSelection?.effectKey));
  assert.equal(r.pendingSelection.effectKey,'invite-kiss-move-energy');
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'invite-kiss-move-energy',selectedIids:[e1],actorIdx:0},pool);
  const me=r.players[0]; const nb=me.bench.find(c=>c.iid===basicIid);
  assert.ok(nb,'基礎應放備戰');
  assert.equal(nb.energyAttached.length,1,'新上場應拿1能量,實際='+nb.energyAttached.length);
  assert.equal(me.active.energyAttached.length,1,'迷唇姐應剩1能量,實際='+me.active.energyAttached.length);
});
T('迷唇姐無能量:只放基礎,不開能量picker',()=>{
  let r=mk({type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter:'Basic',minCount:0,maxCount:1,effectKey:'invite-kiss-place'});
  r.players[0].active.energyAttached=[];
  const basicIid=r._basic;
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'invite-kiss-place',selectedIids:[basicIid],actorIdx:0},pool);
  assert.ok(!r.pendingSelection,'無能量不該開picker');
  assert.ok(r.players[0].bench.find(c=>c.iid===basicIid),'基礎仍應放備戰');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
