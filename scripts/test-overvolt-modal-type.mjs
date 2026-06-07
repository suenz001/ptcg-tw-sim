// v5.501 過度放電分配 modal 顯示「實際選中的能量屬性」(非寫死雷)
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
const LTNG_POKE='17973', FIRE='14428', WATER='18519', LTNG_E='18520'; // 奇樹的電海燕/火/水/雷能量
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(FIRE));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// 2 隻雷寶可夢 + 棄牌區能量 + discard-search pending(overvolt-attach-pick-target)
function mk(discardEnergies){
  const ens=discardEnergies.map(c=>inst(c));
  const s=createGame({name:'P1',entries:[{cardId:LTNG_POKE,count:1}]},{name:'P2',entries:[{cardId:LTNG_POKE,count:1}]},pool);
  return { st:{...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    pendingSelection:{ type:'discard-search', actorIdx:0, sourcePlayerIdx:0, filter:'BasicEnergy',
      minCount:1, maxCount:3, effectKey:'overvolt-attach-pick-target', params:{label:'過度放電'} },
    players:[
      { ...s.players[0], hand:[], deck:[inst(FIRE)], discard:ens, prizes:prize(6),
        bench:[inst(LTNG_POKE)], active:inst(LTNG_POKE) },
      { ...s.players[1], hand:[], deck:[inst(FIRE)], discard:[], prizes:prize(6), bench:[], active:inst(LTNG_POKE) },
    ] }, eiids:ens.map(e=>e.iid) };
}
function resolve(discardEnergies){
  const { st, eiids }=mk(discardEnergies);
  return applyAction(st, { type:'RESOLVE_SELECTION', effectKey:'overvolt-attach-pick-target', selectedIids:eiids, actorIdx:0 }, pool);
}
T('選混合能量(火+水) → energy-distribute modal energyTypeName 留空(顯示通用「能量」)〔核心bug〕', ()=>{
  const out=resolve([FIRE, WATER]);
  assert.equal(out.pendingSelection?.type,'energy-distribute','應開分配 modal');
  assert.equal(out.pendingSelection.params.energyTypeName, '', "混合應留空，實際='"+out.pendingSelection.params.energyTypeName+"'");
});
T('選單一火能量(火+火) → energyTypeName=火', ()=>{
  const out=resolve([FIRE, FIRE]);
  assert.equal(out.pendingSelection.params.energyTypeName, '火', "應=火，實際='"+out.pendingSelection.params.energyTypeName+"'");
});
T('選單一雷能量(雷+雷) → energyTypeName=雷(回歸)', ()=>{
  const out=resolve([LTNG_E, LTNG_E]);
  assert.equal(out.pendingSelection.params.energyTypeName, '雷', "應=雷，實際='"+out.pendingSelection.params.energyTypeName+"'");
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
