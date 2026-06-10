// v5.541 countAttachedEnergyAsUnits 收斂：依能量數(units,host-aware)計傷害/擲幣
//   燃火能量附進化=3、火箭隊=2、新衝天Stage2=2；玩家報職務猛攻沒把燃火能量算3
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-euc.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-euc.ts'); const O = join(ROOT,'.ent-euc.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';
export { countAttachedEnergyAsUnits } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const { createGame, applyAction, countAttachedEnergyAsUnits } = M;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const SANDY='17048' /*青木的土龍節節ex Stage1*/, ODDISH='14319'/*走路草 Basic*/;
const INFERNO='17207'/*燃火能量*/, E_FIGHT='11178', GARC='12702';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// ── 直接單元測 countAttachedEnergyAsUnits (確定性) ──
T('① 燃火能量 附進化(Stage1)→算3個',()=>{
  const host=inst(SANDY,{energyAttached:[inst(INFERNO)]});
  assert.equal(countAttachedEnergyAsUnits(host,pool),3,'應=3');
});
T('② 燃火能量+基本鬥 附進化→3+1=4',()=>{
  const host=inst(SANDY,{energyAttached:[inst(INFERNO),inst(E_FIGHT)]});
  assert.equal(countAttachedEnergyAsUnits(host,pool),4,'應=4');
});
T('③ 燃火能量 附基礎寶可夢(走路草)→只算1個',()=>{
  const host=inst(ODDISH,{energyAttached:[inst(INFERNO)]});
  assert.equal(countAttachedEnergyAsUnits(host,pool),1,'應=1');
});
T('④ 純基本能量 ×2 → 2個 (回歸)',()=>{
  const host=inst(SANDY,{energyAttached:[inst(E_FIGHT),inst(E_FIGHT)]});
  assert.equal(countAttachedEnergyAsUnits(host,pool),2,'應=2');
});

// ── 整招：職務猛攻 擲幣次數 = 能量數(units) ──
T('⑤ 職務猛攻 帶1張燃火能量(附進化)→擲3次硬幣(非1次)',()=>{
  const s=createGame({name:'A',entries:[{cardId:SANDY,count:1}]},{name:'B',entries:[{cardId:GARC,count:1}]},pool);
  const inferno=inst(INFERNO);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:Array.from({length:8},()=>inst(GARC)),discard:[],prizes:Array.from({length:6},()=>inst(GARC)),
              bench:[],active:inst(SANDY,{energyAttached:[inferno]})},
             {...s.players[1],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:inst(GARC)}]};
  const r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  const logTxt=(r.log||r.logs||[]).map(l=>typeof l==='string'?l:(l?.text??l?.message??'')).join('\n');
  assert(/職務猛攻：\d+\/3 次正面/.test(logTxt),'擲幣次數應為3(燃火能量附進化)，log='+(logTxt.match(/職務猛攻：[^\n]*/)||['(無)'])[0]);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
