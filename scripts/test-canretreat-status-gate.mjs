// canRetreat(前端撤退鈕顯示)應與 getRetreatBlockReason/引擎一致:麻痺/睡眠時不可撤退。
//   v5.738 收斂:canRetreat = getRetreatBlockReason()===null。原 canRetreat 漏查麻痺/睡眠→
//   玩家報「龍王蠍危害之尾麻痺對手後撤退鈕仍可按」。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-cg.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-cg.ts'); const O=join(ROOT,'.ent-cg.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { createGame, canRetreat } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0;const inst=(cid,e={})=>({iid:`g${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const V='18523',PSY='14103';
function mk(stt,extra={}){const s=M.createGame({name:'A',entries:[{cardId:V,count:1}]},{name:'B',entries:[{cardId:V,count:1}]},pool);
  const act=inst(V,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)],...extra}); if(stt)act.status=stt;
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(V)],discard:[],prizes:[],bench:[inst(V)],active:act},{...s.players[1],hand:[],deck:[inst(V)],discard:[],prizes:[],bench:[],active:inst(V)}]};}
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
T('無狀態→canRetreat true',()=>assert.equal(M.canRetreat(mk(null),pool),true));
T('麻痺→canRetreat false',()=>assert.equal(M.canRetreat(mk('paralyzed'),pool),false));
T('睡眠→canRetreat false',()=>assert.equal(M.canRetreat(mk('asleep'),pool),false));
T('cantRetreatNextTurn→canRetreat false',()=>assert.equal(M.canRetreat(mk(null,{cantRetreatNextTurn:true}),pool),false));
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
