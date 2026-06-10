// v5.538 鐵之防禦強化(metalShield)是「對手回合」型減傷；與全金屬實驗室+防護充能三疊加應 -90。
//   核心 bug：metalShieldNextTurn 原在 nextP(自己下回合)promote→對手攻擊時沒生效→只 -60。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-mr.js');writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-mr.ts');const O=join(ROOT,'.ent-mr.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const GENE='13011',LAB='9911',METAL='14434',GARC='12702';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
// 引擎主管線疊加(旗標直接設好): P0攻擊→P1防守
function mkEngine(def={}, stadium=LAB){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:GARC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:stadium?inst(stadium):undefined,
    players:[{...s.players[0],hand:[],deck:[inst(GARC)],bench:[inst(GARC)],active:inst(GENE,{energyAttached:[inst(METAL),inst(METAL),inst(METAL)]})},
             {...s.players[1],metalShieldThisTurn:def.metalShield,hand:[],deck:[inst(GARC)],bench:[inst(GARC)],active:inst(GENE,{...(def.drnh!=null?{damageReduceNextHit:def.drnh}:{})})}]};
}
const atk=st=>applyAction(st,{type:'ATTACK',attackIndex:0},pool);
const end=st=>applyAction(st,{type:'END_TURN'},pool);
const dmg=r=>r.players[1].active?.damage;
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① 引擎疊加: 全金屬+鐵之防禦+防護充能 → 150-90=60',()=>{
  assert.equal(dmg(atk(mkEngine({metalShield:true,drnh:30},LAB))),60);
});
T('② 引擎: 只全金屬 → 120 / 全金屬+鐵之防禦 → 90 / 全金屬+防護充能 → 90',()=>{
  assert.equal(dmg(atk(mkEngine({},LAB))),120);
  assert.equal(dmg(atk(mkEngine({metalShield:true},LAB))),90);
  assert.equal(dmg(atk(mkEngine({drnh:30},LAB))),90);
});

// ★ 全流程: A(P0)設 metalShieldNextTurn+防護充能旗標 → END_TURN(promote) → B(P1)攻擊A
function mkFlow(){
  const s=createGame({name:'A',entries:[{cardId:GARC,count:1}]},{name:'B',entries:[{cardId:GARC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:inst(LAB),
    players:[{...s.players[0],metalShieldNextTurn:true,hand:[],deck:[inst(GARC)],bench:[inst(GARC)],
              active:inst(GENE,{damageReduceNextHit:30})},  // A:鐵之防禦(NextTurn)+防護充能(drnh)
             {...s.players[1],hand:[],deck:[inst(GARC)],bench:[inst(GARC)],
              active:inst(GENE,{energyAttached:[inst(METAL),inst(METAL),inst(METAL)]})}]};  // B攻擊方
}
T('③★ 全流程: 鐵之防禦+防護充能+全金屬 → END_TURN後B攻擊A → 150-90=60(修前=90)',()=>{
  const afterEnd=end(mkFlow());
  assert.equal(afterEnd.activePlayerIndex,1,'應B回合');
  assert.equal(afterEnd.players[0].metalShieldThisTurn,true,'A的metalShield應promote為ThisTurn');
  const r=atk(afterEnd);  // B(P1)打 A(P0) — 但 atk 用 attackIndex0=防護充能；defender=A=players[0]
  assert.equal(r.players[0].active?.damage,60,'A受傷應60(150-90)，實際='+r.players[0].active?.damage);
});
T('④ 清除: B回合結束(A回合開始) → A.metalShieldThisTurn 清除',()=>{
  const bturn=end(mkFlow());            // A END_TURN → B回合, A.ThisTurn=true
  const aturn=end(bturn);               // B END_TURN → A回合, 應清除 A.ThisTurn
  assert(!aturn.players[0].metalShieldThisTurn,'A回合A.metalShieldThisTurn應已清除');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
