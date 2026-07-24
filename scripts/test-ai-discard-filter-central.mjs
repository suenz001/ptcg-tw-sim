// v6.016（Fable P1-1 批4）：AI hand-discard / discard-search 接中央 selection-filter 求值器，
//   修 Fable 盤點的三家族 AI 真 bug（HEAD FAIL、修後 PASS）：
//   ① discard-search 缺 filter → fallthrough 亂撿不符卡面的卡（豐收漁網撿到支援者、電氣發電機撿到特殊能量）。
//   ② discard-search 硬讀 actorPlayer.discard 不看 sourcePlayerIdx + 不讀 params.validIids
//      → 惡作劇作畫等「從對手棄牌區選卡」招式 AI 送錯 iid → resolver 找不到 → 招式靜默失效。
//   ③ hand-discard 缺 BasicEnergy:<T> → 妖火紅狐|閃焰魔法丟錯手牌能量。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.aidf-s.js'); const E=join(ROOT,'.aidf-e.ts'); const O=join(ROOT,'.aidf-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { getAIAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const find=(pred)=>{for(const[id,c]of pool)if(pred(c))return c;return null;};
const BASIC=find(c=>c.supertype==='Pokemon'&&!c.evolvesFrom&&c.subtype!=='ex');
const supporter=find(c=>c.supertype==='Trainer'&&c.subtype==='Supporter');
const fireE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【火】'));
const waterE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【水】'));
const lightE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【雷】'));
const waterPoke=find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Water');
const specialE=find(c=>c.supertype==='Energy'&&c.subtype!=='Basic');
let nn=0;const inst=(c)=>({iid:'i'+(++nn),cardId:String(c.id),damage:0,energyAttached:[]});
function baseState(pending, p0, p1){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],pendingSelection:pending,
    players:[{name:'AI',active:inst(BASIC),bench:[],hand:p0.hand||[],deck:[],discard:p0.discard||[],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:inst(BASIC),bench:[],hand:p1.hand||[],deck:[],discard:p1.discard||[],prizes:[1,1,1,1,1,1]}]};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① discard-search 豐收漁網(WaterPokemonOrBasicWaterEnergy)只選水寶可夢/基本水能量(HEAD 撿到支援者)',()=>{
  assert.ok(supporter&&fireE&&waterPoke&&waterE,'測試素材齊全');
  const dS=inst(supporter),dF=inst(fireE),dW=inst(waterPoke),dWe=inst(waterE);
  const st=baseState({type:'discard-search',actorIdx:0,sourcePlayerIdx:0,filter:'WaterPokemonOrBasicWaterEnergy',minCount:0,maxCount:2,effectKey:'x',params:{}},
    {discard:[dS,dF,dW,dWe]},{});
  const act=getAIAction(st,pool,0);
  const sel=new Set(act?.selectedIids||[]);
  const okSet=new Set([dW.iid,dWe.iid]);
  assert.ok([...sel].every(i=>okSet.has(i)),'選到不符卡面的卡:'+[...sel].join(','));
  assert.equal(sel.size,2,'應選滿 2 張水目標');
});

T('② discard-search 電氣發電機(BasicEnergy:Lightning)排除特殊能量(HEAD 撿到特殊能量)',()=>{
  if(!specialE){ console.log('   (無特殊能量可測，略過)'); return; }
  assert.ok(lightE,'有基本雷能量');
  const dSp=inst(specialE),dL=inst(lightE);
  const st=baseState({type:'discard-search',actorIdx:0,sourcePlayerIdx:0,filter:'BasicEnergy:Lightning',minCount:0,maxCount:1,effectKey:'x',params:{}},
    {discard:[dSp,dL]},{});
  const act=getAIAction(st,pool,0);
  assert.deepEqual(act?.selectedIids,[dL.iid],'應只選基本雷，實際='+JSON.stringify(act?.selectedIids));
});

T('③ discard-search 惡作劇作畫構型:讀 sourcePlayerIdx 對手棄牌區 + validIids(HEAD 送自己棄牌區 iid)',()=>{
  assert.ok(lightE&&supporter,'素材齊');
  const mine=inst(supporter);        // AI 自己棄牌區的卡（HEAD 會誤選這張）
  const oppE=inst(lightE);           // 對手棄牌區的能量（正解）
  const st=baseState({type:'discard-search',actorIdx:0,sourcePlayerIdx:1,filter:'Energy',minCount:0,maxCount:1,effectKey:'prank-paint-pick-energy',params:{validIids:[oppE.iid]}},
    {discard:[mine]},{discard:[oppE]});
  const act=getAIAction(st,pool,0);
  assert.deepEqual(act?.selectedIids,[oppE.iid],'應選對手棄牌區能量(∈validIids)，實際='+JSON.stringify(act?.selectedIids));
});

T('④ hand-discard 妖火紅狐(BasicEnergy:Fire,無 validIids)丟基本火而非其他能量(HEAD 丟 index0 的水)',()=>{
  assert.ok(fireE&&waterE,'素材齊');
  const hW=inst(waterE),hF=inst(fireE);   // 水放 index 0（HEAD 價值排序同分保序→選水）
  const st=baseState({type:'hand-discard',actorIdx:0,sourcePlayerIdx:0,filter:'BasicEnergy:Fire',minCount:1,maxCount:1,effectKey:'delphox-flare-magic',params:{}},
    {hand:[hW,hF]},{});
  const act=getAIAction(st,pool,0);
  assert.deepEqual(act?.selectedIids,[hF.iid],'應丟基本火，實際='+JSON.stringify(act?.selectedIids));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
