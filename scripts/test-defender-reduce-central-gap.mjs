// 重現：中央 dealAttackDamageToTarget(狙擊/延後型攻擊用)沒套防守方減傷(damageReduceNextHit 等)
//   對照組=引擎主管線攻擊(破壞光束)→正確 -30；gap=玩偶捕捉(走中央 helper)→沒 -30
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-drc.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-drc.ts'); const O = join(ROOT,'.ent-drc.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const DEF='14322'/*超級赫拉克羅斯ex 280HP 弱火*/, YVELTAL='10617'/*伊裴爾塔爾 破壞光束100*/, DOLL='19176'/*詛咒娃娃 玩偶捕捉80*/;
const E_DARK='11179', E_PSY='11177';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// P0=攻擊方; P1=防守方(active=DEF,可帶 damageReduceNextHit)
function run(attackerId, attackIndex, energyTypes, reduceN){
  const s=createGame({name:'A',entries:[{cardId:attackerId,count:1}]},{name:'B',entries:[{cardId:DEF,count:1}]},pool);
  const atkEnergy=energyTypes.map(t=>inst(t));
  const defActive=inst(DEF, reduceN>0 ? {damageReduceNextHit:reduceN} : {});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[]/*空牌庫:玩偶捕捉直接造傷*/,discard:[],prizes:Array.from({length:6},()=>inst(DEF)),
              bench:[],active:inst(attackerId,{energyAttached:atkEnergy})},
             {...s.players[1],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),bench:[],active:defActive}]};
  let r=applyAction(st,{type:'ATTACK',attackIndex},pool);
  // 若延後型開了 picker → 空選 resolve
  if(r.pendingSelection) r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:r.pendingSelection.effectKey,selectedIids:[],actorIdx:0},pool);
  return r.players[1].active?.damage ?? 0;
}

T('① 對照組(引擎主管線 破壞光束100)：有 damageReduceNextHit:30 → 70 (引擎正確套-30)',()=>{
  const noReduce=run(YVELTAL,1,[E_DARK,E_DARK,E_PSY],0);
  const withReduce=run(YVELTAL,1,[E_DARK,E_DARK,E_PSY],30);
  assert.equal(noReduce,100,'無減傷應100,實際'+noReduce);
  assert.equal(withReduce,70,'引擎應套-30=70,實際'+withReduce);
});
T('② ★修後：玩偶捕捉80(走中央 dealAttackDamageToTarget) + damageReduceNextHit:30 → 50(套-30)',()=>{
  const noReduce=run(DOLL,0,[E_PSY],0);
  const withReduce=run(DOLL,0,[E_PSY],30);
  assert.equal(noReduce,80,'無減傷應80,實際'+noReduce);
  // 重現 bug：應該是50(80-30),但中央 helper 沒套→仍80
  console.log(`   → 玩偶捕捉 有減傷實際傷害=${withReduce}（應為50,bug=沒套防守方減傷）`);
  assert.equal(withReduce,50,'修後:中央減傷-30→50,實際'+withReduce);;
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
