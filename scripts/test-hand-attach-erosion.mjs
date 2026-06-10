// v5.539 中央 fireOnHandEnergyAttached：從手牌用「特性/招式」填能也要觸發對手附能被動
//   （耿鬼ex|侵蝕詛咒）。涵蓋：碧綠之舞(特性,inline) + 充溢之力(招式,走 v158 startEnergyChain)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-hae.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-hae.ts'); const O = join(ROOT,'.ent-hae.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const GENGAR='9817', OGERPON_GRASS='10430', GROUDON='12377', GARC='12702';
const E_GRASS='11173', E_FIGHT='11178', E_PSY='11177';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function mk(p0active, handEnergyId, p1activeId, p0activeExtra={}){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:GENGAR,count:1}]},pool);
  const energy=inst(handEnergyId);
  const act=inst(p0active, p0activeExtra);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[energy],deck:Array.from({length:8},()=>inst(GARC)),discard:[],
              prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:act},
             {...s.players[1],hand:[],deck:[inst(p1activeId)],discard:[],
              prizes:Array.from({length:6},()=>inst(p1activeId)),bench:[],active:inst(p1activeId)}],
    _eIid:energy.iid,_tIid:act.iid};
}
T('① 碧綠之舞(特性填能)+對手耿鬼ex → 厄鬼椪被放20傷',()=>{
  const st=mk(OGERPON_GRASS, E_GRASS, GENGAR);
  const r=applyAction(st,{type:'USE_ABILITY',iid:st._tIid,abilityIndex:0},pool);
  const me=r.players[0].active;
  assert.equal(me?.energyAttached?.length,1,'草能量應已從手牌附上，實際='+me?.energyAttached?.length);
  assert.equal(me?.damage,20,'侵蝕詛咒應放20傷，實際='+me?.damage);
});
T('② 對照組：碧綠之舞 + 對手無耿鬼ex → 不放傷(只附能)',()=>{
  const st=mk(OGERPON_GRASS, E_GRASS, GARC);
  const r=applyAction(st,{type:'USE_ABILITY',iid:st._tIid,abilityIndex:0},pool);
  const me=r.players[0].active;
  assert.equal(me?.energyAttached?.length,1,'草能量應已附上');
  assert.equal(me?.damage??0,0,'無侵蝕詛咒不應放傷，實際='+me?.damage);
});
T('③ 充溢之力(招式填能,走v158)+對手耿鬼ex → 固拉多被放20傷',()=>{
  const st=mk(GROUDON, E_FIGHT, GENGAR, {energyAttached:[inst(E_PSY)]});
  let r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  // 招式 regPost 開 hand-discard picker（v158-energy-chain-start）→ 選鬥能量附能
  if(r.pendingSelection) r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'v158-energy-chain-start',selectedIids:[st._eIid],actorIdx:0},pool);
  const me=r.players[0].active;
  assert.equal(me?.energyAttached?.length,2,'鬥能量應從手牌附上(1付費+1新)，實際='+me?.energyAttached?.length);
  assert.equal(me?.damage,20,'侵蝕詛咒應放20傷，實際='+me?.damage);
});
T('④ 對照組：充溢之力 + 對手無耿鬼ex → 不放傷',()=>{
  const st=mk(GROUDON, E_FIGHT, GARC, {energyAttached:[inst(E_PSY)]});
  let r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  if(r.pendingSelection) r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'v158-energy-chain-start',selectedIids:[st._eIid],actorIdx:0},pool);
  const me=r.players[0].active;
  assert.equal(me?.energyAttached?.length,2,'鬥能量應附上');
  assert.equal(me?.damage??0,0,'無侵蝕詛咒不應放傷，實際='+me?.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
