// 回歸測試網：小灰怪|挪動一下 改附「不受招式效果影響」寶可夢→丟棄能量(官方判例 v5.461)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.mm-e.ts'),O=join(ROOT,'.mm-o.mjs'),S=join(ROOT,'.mm-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const CID={minccino:'13731',def:'13163',mistE:'9912',psyE:'17220',basicE:'14104'};
let iid=0;const inst=(cid,e={})=>({iid:`m${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function setup(targetTools){
  const srcE=inst(CID.basicE); const source=inst(CID.def,{energyAttached:[srcE]});
  const target=inst(CID.def,{energyAttached:targetTools});
  let s=createGame({name:'P1',entries:[{cardId:CID.def,count:1}]},{name:'P2',entries:[{cardId:CID.def,count:1}]},pool);
  s={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:1,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],name:'P1',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(CID.minccino,{energyAttached:[inst(CID.psyE)]})},
             {...s.players[1],name:'P2',hand:[],deck:[],discard:[],prizes:[],bench:[target],active:source}]};
  return {s, srcE, source, target};
}
let pass=0,fail=0;const test=(n,f)=>{try{f();console.log(`  ✅ ${n}`);pass++;}catch(e){console.log(`  ❌ ${n}: ${e.message}`);fail++;}};

test('改附「薄霧能量(免疫)」目標 → 能量丟棄、目標不附上(官方判例)', ()=>{
  const {s,srcE,target}=setup([inst(CID.mistE)]);
  let n=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  assert.ok(n.pendingSelection,'應可發動(可選免疫目標)');
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'minccino-shuffle-pick-energy-anywhere',selectedIids:[srcE.iid],actorIdx:0},pool);
  assert.ok((n.pendingSelection?.params?.validIids||[]).includes(target.iid),'免疫目標應在可選清單');
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'minccino-shuffle-attach-anywhere',selectedIids:[target.iid],actorIdx:0},pool);
  const tgt=n.players[1].bench[0]; const src=n.players[1].active;
  assert.equal(src.energyAttached.length,0,'來源能量已移走');
  assert.equal(tgt.energyAttached.length,1,'免疫目標只剩薄霧(改附能量沒附上)');
  assert.equal(n.players[1].discard.length,1,'改附能量丟入對手棄牌區');
});
test('對照：改附「非免疫」目標 → 正常附上(不丟棄)', ()=>{
  const {s,srcE,target}=setup([]);  // 目標無薄霧=非免疫
  let n=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'minccino-shuffle-pick-energy-anywhere',selectedIids:[srcE.iid],actorIdx:0},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'minccino-shuffle-attach-anywhere',selectedIids:[target.iid],actorIdx:0},pool);
  const tgt=n.players[1].bench[0]; const src=n.players[1].active;
  assert.equal(src.energyAttached.length,0,'來源能量已移走');
  assert.equal(tgt.energyAttached.length,1,'非免疫目標正常附上1能量');
  assert.equal(n.players[1].discard.length,0,'非免疫不丟棄');
});
console.log(`\nminccino mist: ${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
