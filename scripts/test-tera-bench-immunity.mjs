// 回歸測試網：太晶寶可夢在備戰區不受招式傷害（一勞永逸鎖，v5.462）
// 涵蓋打對手備戰傷害的招式：暗算/旋轉之尾/貫通鑽/雪爆發/瀝青加農炮
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.tb-e.ts'),O=join(ROOT,'.tb-o.mjs'),S=join(ROOT,'.tb-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const CID={sneasel:'14764',arbok:'12807',drilbur:'16858',kyurem:'16674',coalossal:'14757',
  tera:'16896',def:'13163',darkE:'14430',fightE:'14104',waterE:'18519'};
// 用實際基本水能量 cid（從 JSON 確認）；fallback 用 darkE 不行，需正確水
let iid=0;const inst=(cid,e={})=>({iid:`tb${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(active0,p0extra={},benchTera,benchTeraDmg=0){
  const s=createGame({name:'P1',entries:[{cardId:CID.def,count:1}]},{name:'P2',entries:[{cardId:CID.def,count:1}]},pool);
  const teraInst=inst(CID.tera,{damage:benchTeraDmg});
  return {st:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:1,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[],discard:[],prizes:[],bench:[],active:active0,...p0extra},
             {...s.players[1],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(CID.def)),bench:[teraInst],active:inst(CID.def)}]}, teraInst};
}
let pass=0,fail=0;const test=(n,f)=>{try{f();console.log(`  ✅ ${n}`);pass++;}catch(e){console.log(`  ❌ ${n}: ${e.message}`);fail++;}};
const atkIdx=(cid,name)=>pool.get(String(cid)).attacks.findIndex(a=>a.name===name);

test('暗算：太晶備戰(3指示物)免疫', ()=>{
  const {st,teraInst}=mk(inst(CID.sneasel,{energyAttached:[inst(CID.darkE),inst(CID.darkE)]}),{},true,30);
  let n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.sneasel,'暗算')},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'ambush-snipe-by-counters',selectedIids:[teraInst.iid],actorIdx:0},pool);
  assert.equal(n.players[1].bench[0].damage,30,'太晶備戰免疫(維持30)');
});
test('旋轉之尾：太晶備戰免疫(0)', ()=>{
  const {st,teraInst}=mk(inst(CID.arbok,{energyAttached:[inst(CID.darkE),inst(CID.darkE),inst(CID.darkE)]}),{},true,0);
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.arbok,'旋轉之尾')},pool);
  assert.equal(n.players[1].bench[0].damage,0,'太晶備戰免疫');
});
test('貫通鑽：太晶備戰(受傷)免疫', ()=>{
  const {st,teraInst}=mk(inst(CID.drilbur,{energyAttached:[inst(CID.fightE),inst(CID.fightE)]}),{},true,20);
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.drilbur,'貫通鑽')},pool);
  assert.equal(n.players[1].bench[0].damage,20,'太晶備戰免疫(維持20)');
});
test('雪爆發：太晶備戰免疫(對手取2獎賞→各20)', ()=>{
  const {st,teraInst}=mk(inst(CID.kyurem,{energyAttached:[inst(CID.waterE),inst(CID.waterE),inst(CID.darkE)]}),{},true,0);
  st.players[1].prizes=Array.from({length:4},()=>inst(CID.def)); // 對手已取2張→amount=20
  const n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.kyurem,'雪爆發')},pool);
  assert.equal(n.players[1].bench[0].damage,0,'太晶備戰免疫(雪爆發)');
});
test('瀝青加農炮：太晶備戰免疫(140)', ()=>{
  const fightDiscard=Array.from({length:10},()=>inst(CID.fightE));
  const {st,teraInst}=mk(inst(CID.coalossal,{energyAttached:[inst(CID.fightE)]}),{discard:fightDiscard},true,0);
  let n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.coalossal,'瀝青加農炮')},pool);
  assert.ok(n.pendingSelection,'瀝青加農炮應開選目標 pending');
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'wave15-asphalt-cannon',selectedIids:[teraInst.iid],actorIdx:0},pool);
  assert.equal(n.players[1].bench[0].damage,0,'太晶備戰免疫(瀝青加農炮)');
});
console.log(`\ntera bench immunity: ${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
