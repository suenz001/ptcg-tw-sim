// v5.601 暗夜羽擊(振翼髮) 應消除 戰鬥場大竺葵 繁茂(草能量×2)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.mb-e.ts'),O=join(ROOT,'.mb-o.mjs'),S=join(ROOT,'.mb-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { countEnergyTypeBloomAware, hasBloomOnField } from './src/lib/game/effects';\nexport { getEnergyDiscardUnits } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const {countEnergyTypeBloomAware, hasBloomOnField, getEnergyDiscardUnits}=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let MEGA=null, FLUTTER=null, GRASS=null, FILLER='14319';
for(const [id,c] of pool){
  if(!MEGA && (c.abilities||[]).some(a=>a.name==='繁茂')) MEGA=id;
  if(!FLUTTER && (c.abilities||[]).some(a=>a.name==='暗夜羽擊')) FLUTTER=id;
  if(!GRASS && c.supertype==='Energy' && c.subtype==='Basic' && /【草】/.test(c.name||'')) GRASS=id;
}
if(!MEGA||!FLUTTER||!GRASS){console.log('找不到 MEGA='+MEGA+' FLUTTER='+FLUTTER+' GRASS='+GRASS);process.exit(1);}
console.log('大竺葵(繁茂)='+MEGA+' | 振翼髮(暗夜羽擊)='+FLUTTER+' | 基本草='+GRASS);
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const ck=(l,c,e)=>{if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');}};
// 大竺葵 active 附 2 基本草；對手 active = 普通 or 振翼髮
function mk(oppActiveCid){
  const mega=inst(MEGA,[en(GRASS),en(GRASS)]);
  return { state:{ phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:mega, bench:[], hand:[], deck:[], discard:[], prizes:[], name:'P0' },
      { active:inst(oppActiveCid), bench:[], hand:[], deck:[], discard:[], prizes:[], name:'P1' },
    ] }, mega };
}
console.log('1) 對手普通寶可夢 → 繁茂生效：2 基本草算 4');
{ const {state,mega}=mk(FILLER);
  ck('hasBloomOnField=true', hasBloomOnField(state,0,pool)===true);
  ck('countEnergyTypeBloomAware Grass = 4', countEnergyTypeBloomAware(mega,'Grass',state,0,pool)===4, '='+countEnergyTypeBloomAware(mega,'Grass',state,0,pool));
  ck('getEnergyDiscardUnits(草)=2', getEnergyDiscardUnits(GRASS, mega, pool, state, 0)===2, '='+getEnergyDiscardUnits(GRASS, mega, pool, state, 0));
}
console.log('2) 對手振翼髮(暗夜羽擊) → 繁茂被消除：2 基本草算 2');
{ const {state,mega}=mk(FLUTTER);
  ck('hasBloomOnField=false(被消除)', hasBloomOnField(state,0,pool)===false);
  ck('countEnergyTypeBloomAware Grass = 2(無×2)', countEnergyTypeBloomAware(mega,'Grass',state,0,pool)===2, '='+countEnergyTypeBloomAware(mega,'Grass',state,0,pool));
  ck('getEnergyDiscardUnits(草)=1(無×2)', getEnergyDiscardUnits(GRASS, mega, pool, state, 0)===1, '='+getEnergyDiscardUnits(GRASS, mega, pool, state, 0));
}
console.log('\n暗夜羽擊×繁茂 收斂 PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
