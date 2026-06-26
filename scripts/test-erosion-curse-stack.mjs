// v5.725 侵蝕詛咒疊加：場上多張耿鬼ex,對手每次從手牌附能應「每張各放2指示物」累加。
//   參考雪妖女冰冷之帳(數場上張數疊加);卡面「只要這隻寶可夢在場上」=每個持有者各自獨立觸發。
//   根因:fireOnHandEnergyAttached 原以特性名全域去重(processed.has(ab.name))→2張耿鬼ex只觸發1次(只20)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-ecs.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-ecs.ts'); const O = join(ROOT,'.ent-ecs.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const GENGAR='9817', OGERPON_GRASS='10430', GARC='12702';
const E_GRASS='11173';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
// p1field: 陣列,P1(耿鬼ex 持有者)場上的卡id(第0個=active,其餘=bench)
function mk(p1field){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:GENGAR,count:1}]},pool);
  const energy=inst(E_GRASS);
  const act=inst(OGERPON_GRASS);
  const p1insts=p1field.map(id=>inst(id));
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[energy],deck:Array.from({length:8},()=>inst(GARC)),discard:[],
              prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:act},
             {...s.players[1],hand:[],deck:[inst(GARC)],discard:[],
              prizes:Array.from({length:6},()=>inst(GARC)),bench:p1insts.slice(1),active:p1insts[0]}],
    _eIid:energy.iid,_tIid:act.iid};
}
// 用碧綠之舞(特性填能,abilityIndex 0)從手牌附草能 → 觸發對手耿鬼ex侵蝕詛咒
const fire=(st)=>{const r=applyAction(st,{type:'USE_ABILITY',iid:st._tIid,abilityIndex:0},pool);
  const me=r.players[0].active;
  assert.equal(me?.energyAttached?.length,1,'草能量應已附上,實際='+me?.energyAttached?.length);
  return me?.damage??0;};
T('① 1張耿鬼ex(active) → 放20傷',()=>{
  assert.equal(fire(mk([GENGAR])),20,'單張應20');
});
T('② 2張耿鬼ex(active+bench) → 疊加放40傷',()=>{
  assert.equal(fire(mk([GENGAR,GENGAR])),40,'兩張應40(2×20),HEAD去重只20');
});
T('③ 3張耿鬼ex(active+2 bench) → 疊加放60傷',()=>{
  assert.equal(fire(mk([GENGAR,GENGAR,GENGAR])),60,'三張應60');
});
T('④ 對照:0張耿鬼ex(對手非耿鬼) → 不放傷',()=>{
  assert.equal(fire(mk([GARC])),0,'無耿鬼ex不放傷');
});
T('⑤ 1張耿鬼ex在bench(active非耿鬼) → 仍放20(在場上即生效)',()=>{
  assert.equal(fire(mk([GARC,GENGAR])),20,'bench耿鬼ex也算在場');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
