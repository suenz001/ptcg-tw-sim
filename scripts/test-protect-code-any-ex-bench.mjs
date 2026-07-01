// v5.828 驗證：密勒頓「防護代碼」——
//   Bug#2：卡面「自己的所有『未來』寶可夢不受『寶可夢【ex】』招式的傷害」= 任意 ex（不限 tag）。
//           舊實作誤要求 attacker.tags.includes('未來')→ 對一般 ex（如拉普拉斯ex）完全不擋。
//   Bug#1：ex 狙擊打「備戰」的未來寶可夢漏免疫（canApplyEffectToTarget isBench:true 不呼叫
//           resolveActiveAttackGuard）。收斂：兩旗標補進 canApplyEffectToTarget 1b-3（active+bench）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-pcae.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-pcae.ts'); const O = join(ROOT,'.ent-pcae.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';
export { canApplyEffectToTarget } from './src/lib/game/defense';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, canApplyEffectToTarget } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const LAPRAS='14085'/*拉普拉斯ex Water Basic 無未來tag; 招式1 衝浪 3水 140*/;
const IRONARM='16751'/*鐵臂膀 未來 Lightning Basic HP140*/;
const MUNNA='14086'/*願增猿 Psychic Basic 非ex*/;
const WATER='11175'/*基本水能量*/;
let iid=0; const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// ── Part A：engine 端到端（active，任意 ex）──────────────────────────────
// 拉普拉斯ex 衝浪(140) 打 鐵臂膀(未來,HP140,active) with immuneToExAttackTagThisTurn='未來'
// 修正後：0 傷害（active 存活）；HEAD：140→KO（active=null）。
T('A. engine：一般 ex(拉普拉斯ex)衝浪 vs 未來 active(防護代碼) → 完全免疫(0傷害存活)',()=>{
  const s=createGame({name:'A',entries:[{cardId:LAPRAS,count:1}]},{name:'B',entries:[{cardId:IRONARM,count:1}]},pool);
  const atk=inst(LAPRAS,{energyAttached:[inst(WATER),inst(WATER),inst(WATER)]});
  const def=inst(IRONARM,{immuneToExAttackTagThisTurn:'未來'});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(LAPRAS)),bench:[],active:atk},
             {...s.players[1],hand:[],deck:[inst(IRONARM)],discard:[],prizes:Array.from({length:6},()=>inst(IRONARM)),bench:[],active:def}]};
  let r=applyAction(st,{type:'ATTACK',attackIndex:1},pool);
  if(r.pendingSelection) r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:r.pendingSelection.effectKey,selectedIids:[],actorIdx:0},pool);
  assert(r.players[1].active, '鐵臂膀應存活(防護代碼免疫一般ex),實際 active='+JSON.stringify(r.players[1].active));
  assert.equal(r.players[1].active.damage,0,'應 0 傷害,實際 '+r.players[1].active.damage);
});

// ── Part B：canApplyEffectToTarget 述詞（狙擊/延後傷害路徑）────────────────
function guard(attCid, targetInst, isBench){
  const state={activeStadium:null,players:[
    {active:inst(attCid),bench:[]},
    {active:inst(IRONARM),bench:[]}]};
  return canApplyEffectToTarget(state,0,targetInst,pool.get(IRONARM),'attack-damage',pool,{isBench});
}
T('B1. 防護代碼 active(isBench:false)：一般 ex 狙擊 → blocked(any-ex 修)',()=>{
  const g=guard(LAPRAS, inst(IRONARM,{immuneToExAttackTagThisTurn:'未來'}), false);
  assert(g.blocked,'應 blocked,實際 '+JSON.stringify(g));
});
T('B2. 防護代碼 BENCH(isBench:true)：一般 ex 狙擊備戰未來寶可夢 → blocked(bug#1 核心)',()=>{
  const g=guard(LAPRAS, inst(IRONARM,{immuneToExAttackTagThisTurn:'未來'}), true);
  assert(g.blocked,'應 blocked,實際 '+JSON.stringify(g));
});
T('B3. 對照：非 ex(願增猿)狙擊備戰未來寶可夢 → NOT blocked',()=>{
  const g=guard(MUNNA, inst(IRONARM,{immuneToExAttackTagThisTurn:'未來'}), true);
  assert(!g.blocked,'非 ex 不應 blocked,實際 '+JSON.stringify(g));
});
T('B4. 塗層攻擊 BENCH：基礎寶可夢(願增猿)狙擊備戰(immuneToBasicAttack) → blocked(bug#1)',()=>{
  const g=guard(MUNNA, inst(IRONARM,{immuneToBasicAttackThisTurn:true}), true);
  assert(g.blocked,'基礎攻擊應被塗層擋,實際 '+JSON.stringify(g));
});
T('B5. 對照：塗層攻擊 vs 一般 ex(拉普拉斯ex 亦基礎)→ blocked(拉普拉斯ex stage=Basic)',()=>{
  const g=guard(LAPRAS, inst(IRONARM,{immuneToBasicAttackThisTurn:true}), true);
  assert(g.blocked,'拉普拉斯ex 是 Basic 應被塗層擋,實際 '+JSON.stringify(g));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
