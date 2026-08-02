// 回歸測試網：先攻第一回合可用招式白名單 + 後攻最初回合限定 (v5.460)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.ft-e.ts'),O=join(ROOT,'.ft-o.mjs'),S=join(ROOT,'.ft-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const CID={exeggcute:'16480',volbeat:'10418',illumise:'10419',def:'13163',e:'14104'};
let iid=0;const inst=(cid,ex={})=>({iid:`f${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...ex});
const atkIdx=(cid,name)=>pool.get(String(cid)).attacks.findIndex(a=>a.name===name);
function mk({active0, firstTurn, aIdx=0, firstIdx=0, deck0=[]}){
  const s=createGame({name:'P1',entries:[{cardId:CID.def,count:1}]},{name:'P2',entries:[{cardId:CID.def,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:aIdx,firstPlayerIdx:firstIdx,isFirstTurn:firstTurn,turn:firstTurn?1:3,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],name:'P1',hand:[],deck:deck0,discard:[],prizes:[],bench:[],active:active0},
             {...s.players[1],name:'P2',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(CID.def)}]};
}
const proceeded=(base,next)=>next.log.length>base.log.length || !!next.pendingSelection;
let pass=0,fail=0;const test=(n,f)=>{try{f();console.log(`  ✅ ${n}`);pass++;}catch(e){console.log(`  ❌ ${n}: ${e.message}`);fail++;}};

test('蛋蛋|早熟進化：先攻第一回合可用(白名單 bypass)', ()=>{
  const st=mk({active0:inst(CID.exeggcute,{energyAttached:[inst(CID.e)]}),firstTurn:true,aIdx:0,firstIdx:0,deck0:[inst(CID.def)]});
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.exeggcute,'早熟進化')},pool);
  assert.ok(proceeded(st,n),'早熟進化先攻第一回合應可使用(不被擋)');
});
test('電螢蟲|急速信號：先攻第一回合可用(白名單 bypass)', ()=>{
  const st=mk({active0:inst(CID.volbeat,{energyAttached:[inst(CID.e)]}),firstTurn:true,aIdx:0,firstIdx:0,deck0:[inst(CID.def)]});
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.volbeat,'急速信號')},pool);
  assert.ok(proceeded(st,n),'急速信號先攻第一回合應可使用');
});
test('對照：電螢蟲|聯合攻擊 先攻第一回合仍被擋(非白名單)', ()=>{
  const st=mk({active0:inst(CID.volbeat,{energyAttached:[inst(CID.e),inst(CID.e)]}),firstTurn:true,aIdx:0,firstIdx:0});
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.volbeat,'聯合攻擊')},pool);
  assert.ok(!proceeded(st,n),'非白名單招式先攻第一回合應被擋');
});
test('甜甜螢|慢芬香：非最初回合應被擋(後攻最初回合限定)', ()=>{
  const st=mk({active0:inst(CID.illumise,{energyAttached:[inst(CID.e)]}),firstTurn:false,aIdx:0,firstIdx:0});
  st.players[1].bench=[inst(CID.def)];
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.illumise,'慢芬香')},pool);
  assert.notEqual(n.pendingSelection?.type,'opp-bench-choose','慢芬香非最初回合應被擋(不開彈回 pending)');
});
// ⚠⚠ v6.103 註記：本案例手工塞 { isFirstTurn:true, activePlayerIndex:1 } —— **真實 END_TURN
//   產生不出這種盤面**（finalize 無條件寫 isFirstTurn:false），所以它一路綠燈卻沒抓到
//   engine 那兩處死招。走真實流程的版本在 scripts/test-v6103-second-player-first-turn.mjs，
//   **那份才是本機制的權威守衛**；這裡保留作為判準的單元級對照。
test('甜甜螢|慢芬香：後攻方最初回合可用', ()=>{
  const s=createGame({name:'P1',entries:[{cardId:CID.def,count:1}]},{name:'P2',entries:[{cardId:CID.def,count:1}]},pool);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:1,firstPlayerIdx:0,isFirstTurn:true,turn:1,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],name:'P1',hand:[],deck:[],discard:[],prizes:[],bench:[inst(CID.def)],active:inst(CID.def)},
             {...s.players[1],name:'P2',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(CID.illumise,{energyAttached:[inst(CID.e)]})}]};
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.illumise,'慢芬香')},pool);
  assert.equal(n.pendingSelection?.type,'opp-bench-choose','慢芬香後攻最初回合應可用(開彈回 pending)');
});
console.log(`\nfirst-turn attacks: ${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
