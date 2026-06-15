// 錦標賽補位崩潰：gameState 存 MongoDB 後 endTurnContinueAfterKO undefined→null，
//   SEND_NEW_ACTIVE 原 !== undefined 對 null 為真 → 誤設 activePlayerIndex=null → END_TURN players[null].active 崩潰。
//   修法 != null。本網驗證 null/undefined 都不崩、能正常補位；有效 index 仍走 continue。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.sna-e.ts'),O=join(ROOT,'.sna-o.mjs'),S=join(ROOT,'.sna-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
// 找 2 隻基礎寶可夢 + 基本能量
const basics=[]; let EN=null;
for(const [id,c] of pool){
  if(basics.length<2 && c.supertype==='Pokemon' && (c.subtype==='Basic'||c.stage==='Basic') && !c.evolvesFrom) basics.push(id);
  if(!EN && c.supertype==='Energy' && c.subtype==='Basic') EN=id;
}
const [B0,B1]=basics;
let pass=0,fail=0; const ck=(l,c,e)=>{c?(pass++,console.log('  PASS',l)):(fail++,console.log('  FAIL',l,e||''));};
let iid=0; const inst=(cid)=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
function mk(endKo){
  const s=createGame({name:'P1',entries:[{cardId:B0,count:1}]},{name:'P2',entries:[{cardId:B1,count:1}]},pool);
  const benchMon=inst(B0);
  return {...s, phase:'playing', turnPhase:'end', activePlayerIndex:1, turn:4, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    endTurnContinueAfterKO: endKo,
    players:[
      {...s.players[0], active:null, bench:[benchMon], hand:[], deck:Array.from({length:10},()=>inst(EN)), discard:[], prizes:Array.from({length:5},()=>inst(EN))},
      {...s.players[1], active:inst(B1), bench:[inst(B1)], hand:[], deck:Array.from({length:10},()=>inst(EN)), discard:[], prizes:Array.from({length:5},()=>inst(EN))},
    ], benchIid:benchMon.iid};
}
function promote(endKo){
  const st=mk(endKo); const bid=st.benchIid;
  return applyAction(st,{type:'SEND_NEW_ACTIVE',iid:bid,senderIdx:0},pool);
}
console.log('基礎寶可夢 B0='+B0+' B1='+B1+' 能量='+EN);
console.log('1) endTurnContinueAfterKO = null（Mongo round-trip）→ 不崩 + 補位成功');
{ let ok=true,r; try{r=promote(null);}catch(e){ok=false;ck('不崩潰',false,e.message);} if(ok){ck('不崩潰',true); ck('P0 補位成功 active 已設', !!r.players[0].active, 'active='+JSON.stringify(r.players[0].active)); ck('activePlayerIndex 非 null', r.activePlayerIndex===0||r.activePlayerIndex===1, 'API='+r.activePlayerIndex);} }
console.log('2) endTurnContinueAfterKO = undefined → 同樣不崩 + 補位成功');
{ let ok=true,r; try{r=promote(undefined);}catch(e){ok=false;ck('不崩潰',false,e.message);} if(ok){ck('不崩潰',true); ck('P0 補位成功', !!r.players[0].active);} }
console.log('3) endTurnContinueAfterKO = 1（有效 self-KO continue）→ 不崩（走 continue 分支）');
{ let ok=true,r; try{r=promote(1);}catch(e){ok=false;ck('不崩潰',false,e.message);} if(ok){ck('不崩潰',true);} }
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
