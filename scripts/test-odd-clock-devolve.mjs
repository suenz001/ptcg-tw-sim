// v6.020：奇異時鐘（退化進化【超】寶可夢）完整流程行為守衛。
//   主因 bug＝items_misc.ts 漏 import buildDevolvedInstance（TS2304 runtime 炸彈，玩家一走到退化就
//   ReferenceError 卡死）→ 由 test-ts2304-scan 封死；本 test 補「退化行為正確 + bench-choose validIids
//   只含合法目標（進化的【超】寶可夢）」。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.oc-s.js'); const E=join(ROOT,'.oc-e.ts'); const O=join(ROOT,'.oc-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { TRAINER_EFFECTS } from './src/lib/game/effects';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { TRAINER_EFFECTS, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const find=(pred)=>{for(const[id,c]of pool)if(pred(c))return c;return null;};
const isStage=(c,s)=>c.subtype===s||c.stage===s;
const psy2=find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Psychic'&&isStage(c,'Stage2'));
const anyStage1=find(c=>c.supertype==='Pokemon'&&isStage(c,'Stage1'));
const anyBasic=find(c=>c.supertype==='Pokemon'&&!c.evolvesFrom&&c.subtype!=='ex');
const nonPsyBasic=find(c=>c.supertype==='Pokemon'&&!c.evolvesFrom&&c.pokemonType!=='Psychic');
assert.ok(psy2&&anyStage1&&anyBasic&&nonPsyBasic,'測試素材齊全');
let nn=0;const inst=(c,extra={})=>({iid:'i'+(++nn),cardId:String(c.id),damage:0,energyAttached:[],...extra});

function baseState(active, bench){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],pendingSelection:null,
    players:[{name:'P1',active,bench,hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:inst(anyBasic),bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('bench-choose validIids 只含「進化的【超】寶可夢」(非超基礎不可選)',()=>{
  const s0=inst(anyBasic), s1=inst(anyStage1);
  const active=inst(psy2,{evolvedFromStack:[s0,s1]});
  const benchNonPsy=inst(nonPsyBasic);  // 非超基礎，不該進 validIids
  const st=baseState(active,[benchNonPsy]);
  const st1=TRAINER_EFFECTS.get('奇異時鐘')(st,0,pool);
  assert.ok(st1.pendingSelection,'應開 pending');
  assert.equal(st1.pendingSelection.type,'bench-choose');
  const vi=st1.pendingSelection.params?.validIids;
  assert.ok(Array.isArray(vi),'應有 validIids（原漏設→UI 顯示全場可選非法目標）');
  assert.deepEqual(vi,[active.iid],'validIids 只含進化超 active，實際='+JSON.stringify(vi));
});

T('完整流程 Stage2 退化 1 層：不 ReferenceError + 退成 Stage1 + 移除卡回手牌',()=>{
  const s0=inst(anyBasic), s1=inst(anyStage1);
  const active=inst(psy2,{evolvedFromStack:[s0,s1]});
  const st=baseState(active,[]);
  const st1=TRAINER_EFFECTS.get('奇異時鐘')(st,0,pool);
  // 選退化目標
  const st2=applyAction(st1,{type:'RESOLVE_SELECTION',selectedIids:[active.iid],actorIdx:0},pool);
  // Stage2 → modal-choice 選層數
  assert.equal(st2.pendingSelection?.type,'modal-choice','Stage2 應問退化層數');
  const st3=applyAction(st2,{type:'RESOLVE_SELECTION',selectedIids:['1'],actorIdx:0},pool);
  const a=st3.players[0].active;
  assert.equal(a.cardId,String(anyStage1.id),'退 1 層應變回 Stage1('+anyStage1.name+')，實際 cardId='+a.cardId);
  assert.ok(st3.players[0].hand.some(c=>c.cardId===String(psy2.id)),'移除的頂層卡('+psy2.name+')應回手牌');
  assert.equal(st3.pendingSelection,null,'流程結束無殘留 pending');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
