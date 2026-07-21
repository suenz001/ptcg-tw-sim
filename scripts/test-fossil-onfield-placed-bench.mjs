// v6.000:化石採掘場等走 placedBenchInstance 的化石放置路徑,fossilOnField 被 toBareCard 剝掉→
//   getEffectiveHP=0→化石顯示0/0且hp>0判KO落空致「打不死」(玩家:多龍巴魯托ex幻影奇襲放指示物打不死)。
//   修:placedBenchInstance 保留 fossilOnField(持久定義屬性)。HEAD 剝掉→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-fb.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-fb.ts'); const O=join(ROOT,'.ent-fb.mjs');
writeFileSync(E,`export { createGame, applyAction, getEffectiveHP } from './src/lib/game/engine';\nexport { placedBenchInstance } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, getEffectiveHP, placedBenchInstance }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const SHIELD='19216',FIN='18046',BASIC='14093'; // 盾甲化石(J)/鰭之化石(J)/時拉比(基礎)
let iid=0;const inst=(cid,e={})=>({iid:'k'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① placedBenchInstance 保留 fossilOnField → getEffectiveHP=60(化石採掘場路徑)',()=>{
  const raw=inst(SHIELD,{fossilOnField:true,justPlaced:true});
  const placed=placedBenchInstance(raw);
  console.log('   placed.fossilOnField=',placed.fossilOnField,' getEffectiveHP=',getEffectiveHP(placed,pool));
  assert.equal(placed.fossilOnField,true,'fossilOnField 應保留,實際='+placed.fossilOnField);
  assert.equal(getEffectiveHP(placed,pool),60,'化石有效HP應60,實際='+getEffectiveHP(placed,pool));
});

T('② 非化石基礎經 placedBenchInstance 不會誤帶 fossilOnField',()=>{
  const placed=placedBenchInstance(inst(BASIC));
  assert.ok(!placed.fossilOnField,'一般基礎不應有 fossilOnField');
  assert.equal(getEffectiveHP(placed,pool),80,'時拉比HP80');
});

T('③ 全流程:對手備戰化石(60傷=6指示物)→ 任一action後 sanityKOSweep 昏厥(打得死)',()=>{
  // P1 備戰放 化石採掘場路徑產出的化石(placedBenchInstance),已受60傷; P0 END_TURN 觸發雙邊sweep
  const s=createGame({name:'A',entries:[{cardId:BASIC,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
  const fossil={...placedBenchInstance(inst(FIN,{fossilOnField:true})),damage:60};
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:6,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[fossil],active:inst(BASIC)}]};
  console.log('   化石 getEffectiveHP=',getEffectiveHP(fossil,pool),' damage=',fossil.damage);
  const r=applyAction(st,{type:'END_TURN'},pool);
  const stillThere=r.players[1].bench.some(b=>b.iid===fossil.iid);
  console.log('   END_TURN後 化石仍在備戰=',stillThere,'(false=已昏厥打得死)');
  assert.ok(!stillThere,'60傷化石(60HP)應被sanityKOSweep昏厥,實際仍在='+stillThere);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
