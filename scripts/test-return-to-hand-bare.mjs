// v5.705 回歸測試：寶可夢回手牌/牌庫時主體要「完全裸化」(只留 iid+cardId),否則殘留旗標
//   會隨 PLAY_BASIC 重打({...inst} 只覆寫~9欄位)回到場上。手動黑名單清~13個會漏 immune*/
//   nextOwnAttackPenalty/takeExtra 等。改用中央白名單 toBareCard。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-rh.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-rh.ts'); const O=join(ROOT,'.ent-rh.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const VORTEX='10507', BUD='14443';
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
T('旋風回收機回手牌:主體完全裸化(無殘留 immune*/nextOwnAttackPenalty)[驗HEAD FAIL]', ()=>{
  const dirtyActive=inst(BUD,[],{immuneToAllAttackThisTurn:true, nextOwnAttackPenalty:50, takeExtraPrizeThisKO:1, weaknessOverride:'None'});
  const aIid=dirtyActive.iid;
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  let st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[ {...s.players[0], active:dirtyActive, bench:[inst(BUD)], hand:[inst(VORTEX)], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]},
      {...s.players[1], active:inst(BUD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]} ] };
  const hi=st.players[0].hand[0].iid;
  let out=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  assert(out.pendingSelection?.type==='heal-target','應開 picker 選回收目標');
  out=applyAction(out,{type:'RESOLVE_SELECTION',selectedIids:[aIid],actorIdx:0},pool);
  const returned=out.players[0].hand.find(c=>c.iid===aIid);
  assert(returned,'主體應回到手牌');
  for(const flag of ['immuneToAllAttackThisTurn','nextOwnAttackPenalty','takeExtraPrizeThisKO','weaknessOverride']){
    assert(returned[flag]===undefined, `回手牌的卡不該殘留 ${flag}(=${returned[flag]})`);
  }
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
