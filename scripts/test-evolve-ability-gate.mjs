// v5.706 回歸測試:「完成進化時可用1次」特性(精神抽出/龐克練肌/搜尋寶石/能量舞步/脫殼/合金建造)
//   的 evolvedThisTurn gate 要同時在 USE_ABILITY 前置 gate 與 getUsableAbilities 一致。
//   破口:合金建造只在 getUsableAbilities(擋按鈕)有 gate,USE_ABILITY 前置清單漏→後端可在非剛進化發動。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-eg.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-eg.ts'); const O=join(ROOT,'.ent-eg.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const DURALUDON='11067', METALE='11180', BUD='14443';
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
function mk(evolvedThisTurn){
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  const act=inst(DURALUDON,[],{evolvedThisTurn, abilityUsedThisTurn:false});
  return { st:{ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[ {...s.players[0], active:act, bench:[], hand:[], deck:[inst(BUD)], discard:[en(METALE),en(METALE)], prizes:[inst(BUD)]},
      {...s.players[1], active:inst(BUD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]} ] }, aIid:act.iid };
}
T('合金建造 evolvedThisTurn=false → USE_ABILITY 應被拒(無效果)[驗HEAD FAIL]', ()=>{
  const {st,aIid}=mk(false);
  const out=applyAction(st,{type:'USE_ABILITY',iid:aIid,abilityIndex:0},pool);
  assert(!out.pendingSelection, '非剛進化不該開能量附加 picker');
  assert(!out.players[0].active.abilityUsedThisTurn, '非剛進化不該標記已用特性');
});
T('對照:合金建造 evolvedThisTurn=true → USE_ABILITY 生效(開 picker)', ()=>{
  const {st,aIid}=mk(true);
  const out=applyAction(st,{type:'USE_ABILITY',iid:aIid,abilityIndex:0},pool);
  assert(out.pendingSelection, '剛進化應開能量附加 picker');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
