// v5.500 三合一磁怪|過度放電：從棄牌區選任意基本能量(非僅雷)附於自己雷寶可夢
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-ov.ts'); const O=join(ROOT,'.ent-ov.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine'; import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const MAGNEZONE='14706', LTNG_POKE='17973', FIRE='14428', WATER='18519';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(FIRE));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

function mk(discardCards){
  const s=createGame({name:'P1',entries:[{cardId:LTNG_POKE,count:1}]},{name:'P2',entries:[{cardId:LTNG_POKE,count:1}]},pool);
  const magnezone=inst(MAGNEZONE);
  return { st:{...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:[inst(FIRE)], discard:discardCards.map(c=>inst(c)), prizes:prize(6),
        bench:[magnezone], active:inst(LTNG_POKE) },
      { ...s.players[1], hand:[], deck:[inst(FIRE)], discard:[], prizes:prize(6), bench:[], active:inst(LTNG_POKE) },
    ] }, magIid:magnezone.iid };
}
// 棄牌區只有火/水基本能量(無雷) → 應仍可選(filter BasicEnergy)
T('過度放電：棄牌區火/水能量(無雷) → 開 picker filter=BasicEnergy(可選任意基本能量)〔核心bug〕', ()=>{
  const { st, magIid }=mk([FIRE, WATER, FIRE]);
  const out=applyAction(st, { type:'USE_ABILITY', iid:magIid, abilityIndex:0 }, pool);
  assert(out.pendingSelection, '應開 picker(先前因 filter 雷而 bail「無基本雷能量」)，實際無 pending');
  assert.equal(out.pendingSelection.type, 'discard-search');
  assert.equal(out.pendingSelection.filter, 'BasicEnergy', "filter 應 BasicEnergy(任意)，實際="+out.pendingSelection.filter);
  assert.equal(out.pendingSelection.effectKey, 'overvolt-attach-pick-target');
});
T('過度放電：棄牌區有雷能量也正常(回歸)', ()=>{
  // 用火能量代雷測 maxCount；有 3 張能量 → maxCount 3
  const { st, magIid }=mk([FIRE, WATER]);
  const out=applyAction(st, { type:'USE_ABILITY', iid:magIid, abilityIndex:0 }, pool);
  assert(out.pendingSelection, '應開 picker');
  assert.equal(out.pendingSelection.maxCount, 2, 'maxCount 應=min(3,棄牌2)=2，實際'+out.pendingSelection.maxCount);
});
T('過度放電：棄牌區無基本能量 → 不開 picker', ()=>{
  const itemId=[...pool].find(([,c])=>c.supertype==='Trainer')?.[0];
  const { st, magIid }=mk([itemId, itemId]);
  const out=applyAction(st, { type:'USE_ABILITY', iid:magIid, abilityIndex:0 }, pool);
  assert(!out.pendingSelection, '無基本能量應不開 picker');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
