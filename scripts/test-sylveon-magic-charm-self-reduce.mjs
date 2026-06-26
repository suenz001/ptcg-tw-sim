// 仙子伊布ex|魔法魅惑:卡面「在下個對手回合,使出此招的寶可夢受招式傷害-100」=自身防護。
//   應 selfDmgReducePost(100)(同族龍捲雲暴風障壁/振翼髮月亮之力);誤用 defNextAtkReducePost
//   (在對手active設nextOwnAttackPenalty,削弱對手攻擊→對手附免疫能量時guard擋掉,仙子伊布沒被保護)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-sm.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-sm.ts'); const O=join(ROOT,'.ent-sm.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const liveSet=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!liveSet.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const SYLV='11107', GARC='12702', PSY='14103';
let iid=0;const inst=(cid,e={})=>({iid:`s${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const MAGIC_IDX = pool.get(SYLV).attacks.findIndex(a=>a.name==='魔法魅惑');
function setup(){
  const s=createGame({name:'P1',entries:[{cardId:SYLV,count:1}]},{name:'P2',entries:[{cardId:GARC,count:1}]},pool);
  const act=inst(SYLV,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)]});
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:act},
             {...s.players[1],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:inst(GARC,{energyAttached:[inst(PSY),inst(PSY)]})}]};
}
T('① 魔法魅惑後:自身(仙子伊布)有 damageReduceNextHit=100,對手 active 無 nextOwnAttackPenalty',()=>{
  let r=applyAction(setup(),{type:'ATTACK',attackIndex:MAGIC_IDX},pool);
  const me=r.players[0].active, opp=r.players[1].active;
  console.log('   自身 damageReduceNextHit=',me?.damageReduceNextHit,' 對手 nextOwnAttackPenalty=',opp?.nextOwnAttackPenalty);
  assert.equal(me?.damageReduceNextHit,100,'自身應有減傷100(selfDmgReducePost),實際='+me?.damageReduceNextHit);
  assert.ok(!opp?.nextOwnAttackPenalty,'對手不應被設削攻penalty(那是錯版defNextAtkReducePost),實際='+opp?.nextOwnAttackPenalty);
});
T('② 基礎傷害仍為160',()=>{
  let r=applyAction(setup(),{type:'ATTACK',attackIndex:MAGIC_IDX},pool);
  assert.equal(r.players[1].active.damage,160,'魔法魅惑base應160,實際='+r.players[1].active.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
