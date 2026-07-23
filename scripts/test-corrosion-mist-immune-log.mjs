// v6.002:腐蝕液/火焰咒詛「全場丟對手道具/特殊能量」,當對手寶可夢帶薄霧能量(不受招式效果影響)時,
//   正確跳過(免疫,薄霧能量不被丟),但 log 原本誤報「對手場上無道具或特殊能量」/「沒有特殊能量」。
//   修:被免疫且有可丟項時 log 顯示免疫原因。HEAD(誤報「無/沒有」)→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-cm.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-cm.ts'); const O=join(ROOT,'.ent-cm.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const TOX='18483',BLADE='11202',MIST='12462',BASIC='14093',PSY='14103',TOOL='14089';
let iid=0;const inst=(cid,e={})=>({iid:'m'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const lastLog=(r)=>{const L=r.log||[];const s=L.slice(-4).map(l=>typeof l==='string'?l:l.message).join(' | ');return s;};
function mk(atkCid,energyN,oppMistAndTool){
  const s=createGame({name:'A',entries:[{cardId:atkCid,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
  const oppE=[inst(MIST)]; const oppExtra=oppMistAndTool?{toolAttached:inst(TOOL)}:{};
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
    setupDone:[true,true],pendingSelection:null,pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(atkCid)],discard:[],prizes:Array.from({length:6},()=>inst(atkCid)),bench:[],active:inst(atkCid,{energyAttached:Array.from({length:energyN},()=>inst(PSY))})},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC,{energyAttached:oppE,...oppExtra})}]};
}

T('腐蝕液: 對手帶薄霧能量+道具 → 免疫(不丟)且 log 顯示免疫原因(非「無道具或特殊能量」)',()=>{
  const r=applyAction(mk(TOX,2,true),{type:'ATTACK',attackIndex:0},pool);
  const opp=r.players[1].active;
  const log=lastLog(r);
  console.log('   對手薄霧能量仍在=',opp?.energyAttached.some(e=>e.cardId===MIST),' 道具仍在=',!!opp?.toolAttached,' log=',log);
  assert.ok(opp?.energyAttached.some(e=>e.cardId===MIST),'薄霧能量應被免疫不丟');
  assert.ok(opp?.toolAttached,'道具(免疫host)應不被丟');
  assert.ok(!log.includes('對手場上無道具或特殊能量'),'不應誤報「無道具或特殊能量」');
  assert.ok(log.includes('無法丟棄')||log.includes('免疫'),'應顯示免疫原因,log='+log);
});

T('火焰咒詛: 對手帶薄霧能量 → 免疫(不丟)且 log 顯示免疫原因(非「沒有特殊能量」)',()=>{
  const r=applyAction(mk(BLADE,1,false),{type:'ATTACK',attackIndex:0},pool);
  const opp=r.players[1].active;
  const log=lastLog(r);
  console.log('   對手薄霧能量仍在=',opp?.energyAttached.some(e=>e.cardId===MIST),' log=',log);
  assert.ok(opp?.energyAttached.some(e=>e.cardId===MIST),'薄霧能量應被免疫不丟');
  assert.ok(!log.includes('對手全場沒有特殊能量'),'不應誤報「沒有特殊能量」');
  assert.ok(log.includes('無法丟棄')||log.includes('免疫'),'應顯示免疫原因,log='+log);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
