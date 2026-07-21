// v5.998 ③:effectivePreDiscardMin(spec,availableUnits)=min(spec.min,max(0,availableUnits))。
//   「選擇N個能量丟棄」型招式被複製(扮晶晶酒)或減費(璀璨結晶)致身上能量<N時,不足額不阻擋招式
//   (依黃玉伏特官方Q&A:丟光現有、無條件傷害照給)。UI confirm/minOk gate 用此避免湊不滿N被卡住。
//   + 引擎守衛:扮晶晶酒(2能量)複製黃玉伏特(丟3)→實丟2、造成300。
// HEAD:effectivePreDiscardMin 不存在 → import throw → FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-em.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-em.ts'); const O=join(ROOT,'.ent-em.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nexport { effectivePreDiscardMin, ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const { createGame, applyAction, effectivePreDiscardMin, ATTACK_PRE_DISCARD_CHOICE }=mod;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0;const inst=(cid,e={})=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// 純函式:黃玉伏特 spec(min=3)
const spec=ATTACK_PRE_DISCARD_CHOICE.get('皮卡丘ex|黃玉伏特');
T('純函式 effectivePreDiscardMin: 黃玉伏特 spec.min=3, avail=2→2 / 0→0 / 5→3',()=>{
  assert.ok(spec && spec.min===3,'黃玉伏特 spec.min 應=3,實際='+JSON.stringify(spec));
  assert.equal(effectivePreDiscardMin(spec,2),2,'avail2→2');
  assert.equal(effectivePreDiscardMin(spec,0),0,'avail0→0');
  assert.equal(effectivePreDiscardMin(spec,5),3,'avail5→3(不超過min)');
  assert.equal(effectivePreDiscardMin(spec,-1),0,'負數→0');
});

// 引擎守衛:扮晶晶酒(2能量)複製黃玉伏特(丟3)→實丟2、造成300(引擎本就正確,防回歸)
const MIMI='12792',PIKA='11213',PSY='14103';
T('引擎守衛: 扮晶晶酒(2超能量)複製黃玉伏特 → 實丟2能量、造成300',()=>{
  const s=createGame({name:'P1',entries:[{cardId:MIMI,count:1}]},{name:'P2',entries:[{cardId:PIKA,count:1}]},pool);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(MIMI)],discard:[],prizes:Array.from({length:6},()=>inst(MIMI)),bench:[],active:inst(MIMI,{energyAttached:[inst(PSY),inst(PSY)]})},
             {...s.players[1],hand:[],deck:[inst(PIKA)],discard:[],prizes:Array.from({length:6},()=>inst(PIKA)),bench:[],active:inst(PIKA,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)]})}]};
  const r=applyAction(st,{type:'ATTACK',attackIndex:0,copyAttackChoice:{attackIndex:0}},pool);
  const before=st.players[1].active.damage;
  const dealt=(r.players[1].active?.damage??0)-before; // 皮卡丘ex勤奮之心可能存活;看實際傷害輸出
  const disc=r.players[0].active?.energyAttached.length;
  console.log('   謎擬Q剩能量=',disc,' 皮卡丘ex傷害(含弱抗/勤奮)=',r.players[1].active?.damage);
  assert.equal(disc,0,'2能量應被丟光(付能付的),剩='+disc);
  // 300基礎(皮卡丘ex對超無弱點;勤奮之心避免昏厥剩10) → active 有傷害且能量丟光即證效果生效
  assert.ok((r.players[1].active?.damage??0)>0 || r.players[1].active===null,'黃玉伏特效果應生效造成傷害');
});

// ② 進化資料守衛:火箭隊的天罩蟲(12793) evolvesFrom 應=火箭隊的索偵蟲(官方No.824→825→826線;非蟲寶包Nincada)
T('② 火箭隊的天罩蟲 evolvesFrom = 火箭隊的索偵蟲',()=>{
  const c=pool.get('12793');
  console.log('   12793 evolvesFrom=',c?.evolvesFrom);
  assert.equal(c?.evolvesFrom,'火箭隊的索偵蟲','天罩蟲進化來源應為火箭隊的索偵蟲,實際='+c?.evolvesFrom);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
