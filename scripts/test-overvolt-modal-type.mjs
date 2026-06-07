// v5.502 過度放電改用 startEnergyChain(仿X啟動)：混合屬性逐屬性分波,每波 modal 顯示該波實際屬性
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-ovm.ts'); const O=join(ROOT,'.ent-ovm.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine'; import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const LTNG_POKE='17973', FIRE='14428', WATER='18519', LTNG_E='18520';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(FIRE));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// nLtng 隻雷寶可夢(含active) + 棄牌區能量 + discard-search pending
function mk(discardEnergies, nLtng){
  const ens=discardEnergies.map(c=>inst(c));
  const s=createGame({name:'P1',entries:[{cardId:LTNG_POKE,count:1}]},{name:'P2',entries:[{cardId:LTNG_POKE,count:1}]},pool);
  const bench=[]; for(let i=1;i<nLtng;i++) bench.push(inst(LTNG_POKE));
  return { st:{...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    pendingSelection:{ type:'discard-search', actorIdx:0, sourcePlayerIdx:0, filter:'BasicEnergy',
      minCount:1, maxCount:3, effectKey:'overvolt-attach-pick-target', params:{label:'過度放電'} },
    players:[
      { ...s.players[0], hand:[], deck:[inst(FIRE)], discard:ens, prizes:prize(6),
        bench, active:inst(LTNG_POKE) },
      { ...s.players[1], hand:[], deck:[inst(FIRE)], discard:[], prizes:prize(6), bench:[], active:inst(LTNG_POKE) },
    ] }, eiids:ens.map(e=>e.iid) };
}
function resolve(discardEnergies, nLtng){
  const { st, eiids }=mk(discardEnergies, nLtng);
  return applyAction(st, { type:'RESOLVE_SELECTION', effectKey:'overvolt-attach-pick-target', selectedIids:eiids, actorIdx:0 }, pool);
}
// ① 混合屬性 + 2 雷目標 → 逐屬性分波,第一波顯示實際屬性(非空,火或水)〔核心:看得出屬性〕
T('混合(火+水)+2雷目標 → 分波 modal 顯示實際屬性(第一波非空)', ()=>{
  const out=resolve([FIRE, WATER], 2);
  assert.equal(out.pendingSelection?.type, 'energy-distribute', '應開分配 modal');
  const tn=out.pendingSelection.params.energyTypeName;
  assert(tn==='火'||tn==='水', "第一波應顯示實際屬性(火/水)非空/非雷，實際='"+tn+"'");
});
T('單一火(火+火)+2雷目標 → energyTypeName=火', ()=>{
  const out=resolve([FIRE, FIRE], 2);
  assert.equal(out.pendingSelection.params.energyTypeName, '火');
});
T('單一雷(雷+雷)+2雷目標 → energyTypeName=雷', ()=>{
  const out=resolve([LTNG_E, LTNG_E], 2);
  assert.equal(out.pendingSelection.params.energyTypeName, '雷');
});
// ② 1 雷目標 → 直接全附(無 picker),能量到目標
T('1 雷目標 → 直接全附(無分配 modal),能量到雷寶可夢', ()=>{
  const out=resolve([FIRE, WATER], 1);
  assert(!out.pendingSelection || out.pendingSelection.type!=='energy-distribute', '1 目標不該開分配 modal');
  const totalE=(out.players[0].active?.energyAttached.length||0)+out.players[0].bench.reduce((a,b)=>a+b.energyAttached.length,0);
  assert(totalE>=2, '2 張能量應附到場上，實際'+totalE);
});
// ③ 0 雷目標 → 能量留棄牌區
T('0 雷目標 → 能量留棄牌區', ()=>{
  const itemId=[...pool].find(([,c])=>c.supertype==='Trainer')?.[0];
  const ens=[inst(FIRE),inst(WATER)];
  const s=createGame({name:'P1',entries:[{cardId:itemId,count:1}]},{name:'P2',entries:[{cardId:itemId,count:1}]},pool);
  const st={...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    pendingSelection:{ type:'discard-search', actorIdx:0, sourcePlayerIdx:0, filter:'BasicEnergy',
      minCount:1, maxCount:3, effectKey:'overvolt-attach-pick-target', params:{label:'過度放電'} },
    players:[
      { ...s.players[0], hand:[], deck:[inst(itemId)], discard:ens, prizes:prize(6), bench:[], active:inst(itemId) },
      { ...s.players[1], hand:[], deck:[inst(itemId)], discard:[], prizes:prize(6), bench:[], active:inst(itemId) },
    ] };
  const out=applyAction(st, { type:'RESOLVE_SELECTION', effectKey:'overvolt-attach-pick-target', selectedIids:ens.map(e=>e.iid), actorIdx:0 }, pool);
  assert(!out.pendingSelection, '無雷目標應不開 modal');
  assert.equal(out.players[0].discard.length, 2, '能量應留棄牌區(2張)，實際'+out.players[0].discard.length);
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
