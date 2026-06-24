// v5.709 回歸:腎上腺腦力(願增猿特性,放指示物效果KO對手戰鬥位)獎賞要含多餘花粉(deferred)+奇跡之吻
//   (卡面「對手戰鬥寶可夢昏厥時」不分招式/特性)。原 inline koPrizeCount 漏。脆弱蛻殼/道具不適用(卡面限招式傷害)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-ab.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-ab.ts'); const O=join(ROOT,'.ent-ab.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const BUD='14443', TOGE='14726';
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
function mk(oppActive, atkBench){
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  const st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], log:[],
    players:[ {...s.players[0], active:inst(BUD), bench:atkBench, hand:[], deck:[inst(BUD)], discard:[], prizes:Array.from({length:6},()=>inst(BUD))},
      {...s.players[1], active:oppActive, bench:[inst(BUD)], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]} ] };
  st.pendingSelection={ type:'opp-poke-choose', actorIdx:0, sourcePlayerIdx:1, minCount:1, maxCount:1, effectKey:'adrenal-brain-target', params:{ includeActive:true, amount:200 } };
  return st;
}
const taken=(out)=>6-out.players[0].prizes.length;
T('腎上腺腦力效果KO + 多餘花粉(deferred:2) + 奇跡之吻(正面) → 拿4(1+2+1)[驗HEAD FAIL]', ()=>{
  const oppA=inst(BUD,[],{deferredPrizeBonusThisTurn:2});
  const st=mk(oppA, [inst(TOGE)]);
  const orig=Math.random; Math.random=()=>0; let out; try{ out=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[oppA.iid],actorIdx:0},pool); } finally{Math.random=orig;}
  assert(!out.players[1].active, '對手戰鬥位應被KO');
  assert.equal(taken(out), 4, `應拿4(1base+2多餘花粉+1奇跡),實 ${taken(out)}`);
});
T('對照:無 deferred 無奇跡 → 拿1', ()=>{
  const oppA=inst(BUD);
  const st=mk(oppA, [inst(BUD)]);
  const out=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[oppA.iid],actorIdx:0},pool);
  assert.equal(taken(out), 1, `應拿1,實 ${taken(out)}`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
