// v6.003:所有丟棄對手卡片的招式,成功 log 須顯示丟了哪張卡名(Wilson 規則,作紀錄)。
//   腐蝕液/火焰咒詛原只記數量→改 joinCardNames 顯示卡名。HEAD(只記「N張」)→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-dn.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-dn.ts'); const O=join(ROOT,'.ent-dn.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const TOX='18483',BLADE='11202',PRISM='14852',TOOL='14089',BASIC='14093',PSY='14103';
const PRISM_NAME=pool.get(PRISM)?.name, TOOL_NAME=pool.get(TOOL)?.name;
let iid=0;const inst=(cid,e={})=>({iid:'n'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const lastLog=(r)=>{const L=r.log||[];return L.slice(-3).map(l=>typeof l==='string'?l:l.message).join(' | ');};
function mk(atkCid,energyN,opp){
  const s=createGame({name:'A',entries:[{cardId:atkCid,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
    setupDone:[true,true],pendingSelection:null,pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(atkCid)],discard:[],prizes:Array.from({length:6},()=>inst(atkCid)),bench:[],active:inst(atkCid,{energyAttached:Array.from({length:energyN},()=>inst(PSY))})},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:opp}]};
}

T('腐蝕液: 丟棄對手道具+特殊能量 → log 顯示卡名(稜鏡能量、反擊增幅器)',()=>{
  const opp=inst(BASIC,{energyAttached:[inst(PRISM)],toolAttached:inst(TOOL)});
  const r=applyAction(mk(TOX,2,opp),{type:'ATTACK',attackIndex:0},pool);
  const log=lastLog(r);
  console.log('   log=',log);
  assert.ok(log.includes(PRISM_NAME),'log 應含特殊能量卡名「'+PRISM_NAME+'」');
  assert.ok(log.includes(TOOL_NAME),'log 應含道具卡名「'+TOOL_NAME+'」');
  assert.ok(!/移除對手場上所有道具 & 特殊能量（\d+ 張）/.test(log),'不應只記數量');
});

T('火焰咒詛: 丟棄對手特殊能量 → log 顯示卡名(稜鏡能量)',()=>{
  const opp=inst(BASIC,{energyAttached:[inst(PRISM)]});
  const r=applyAction(mk(BLADE,1,opp),{type:'ATTACK',attackIndex:0},pool);
  const log=lastLog(r);
  console.log('   log=',log);
  assert.ok(log.includes(PRISM_NAME),'log 應含特殊能量卡名「'+PRISM_NAME+'」');
  assert.ok(!/丟棄對手全場 \d+ 張特殊能量/.test(log),'不應只記數量');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
