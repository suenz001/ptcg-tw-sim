// v6.001:象徵鳥|反射壁 卡面「在下個對手的回合,這隻寶可夢受到招式的傷害-40」=自身防護(同樹林龜
//   甲殼衝撞/橡實果硬化家族)。原誤用 defNextAtkReducePost(對手削攻)=v5.997魔法魅惑的反向錯誤。
//   改 selfDmgReducePost:象徵鳥自身 damageReduceNextHit=40、對手不被設 nextOwnAttackPenalty。
//   HEAD(defNextAtkReducePost)→對手被設penalty、自身無減傷→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-mw.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-mw.ts'); const O=join(ROOT,'.ent-mw.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const MIRROR='13392',PSY='14103',BASIC='14093'; // 象徵鳥(反射壁 cost=無×1) / 時拉比
const IDX=pool.get(MIRROR).attacks.findIndex(a=>a.name==='反射壁');
let iid=0;const inst=(cid,e={})=>({iid:'w'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('反射壁後:象徵鳥自身 damageReduceNextHit=40、對手不被設 nextOwnAttackPenalty(自身防護)',()=>{
  const s=createGame({name:'A',entries:[{cardId:MIRROR,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(MIRROR)],discard:[],prizes:Array.from({length:6},()=>inst(MIRROR)),bench:[],active:inst(MIRROR,{energyAttached:[inst(PSY)]})},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC,{energyAttached:[inst(PSY),inst(PSY)]})}]};
  const r=applyAction(st,{type:'ATTACK',attackIndex:IDX},pool);
  const me=r.players[0].active, opp=r.players[1].active;
  console.log('   象徵鳥 damageReduceNextHit=',me?.damageReduceNextHit,' 對手 nextOwnAttackPenalty=',opp?.nextOwnAttackPenalty);
  assert.equal(me?.damageReduceNextHit,40,'象徵鳥自身應有減傷40(selfDmgReducePost),實際='+me?.damageReduceNextHit);
  assert.ok(!opp?.nextOwnAttackPenalty,'對手不應被設削攻penalty(那是錯版defNextAtkReducePost),實際='+opp?.nextOwnAttackPenalty);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
