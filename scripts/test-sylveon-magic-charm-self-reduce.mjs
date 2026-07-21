// 仙子伊布ex|魔法魅惑 / 振翼髮|月亮之力 家族:卡面「在下個對手的回合,【受到這個招式的寶可夢】
//   使用招式的傷害-N」— 主詞是【被此招打到的對手寶可夢】,減其【下回合出招輸出傷害】(綁該 instance)。
//   = 同族 defNextAtkReducePost(對手 active 設 nextOwnAttackPenalty)。v5.727 曾誤讀成「自身防護」
//   selfDmgReducePost(把 blanket 減傷掛在仙子伊布自己)→ 被打的對手昏厥換【同名替身】後仍套用(玩家實測 bug)。
//   v5.997 收斂回 defNextAtkReducePost。此 test HEAD(selfDmgReducePost 版) 必 FAIL。
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

const SYLV='11107';   // 仙子伊布ex HP270, 魔法魅惑 160(Psychic,C,C)
const GARC='12702';   // 竹蘭的烈咬陸鯊ex HP330 (非KO存活對象)
const CELE='14093';   // 時拉比 HP80, 日光刀 30(Grass) — KO對象 + 同名替身
const PSY='14103';    // 基本超能量
const GRASS='14102';  // 基本草能量
const MAGIC_IDX = pool.get(SYLV).attacks.findIndex(a=>a.name==='魔法魅惑');
const CELE_IDX  = pool.get(CELE).attacks.findIndex(a=>a.name==='日光刀');

let iid=0;const inst=(cid,e={})=>({iid:`s${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// P0=仙子伊布ex(3超能量); P1 由參數決定 active/bench
function setup(p1active,p1bench=[]){
  const s=createGame({name:'P1',entries:[{cardId:SYLV,count:1}]},{name:'P2',entries:[{cardId:GARC,count:1}]},pool);
  const me=inst(SYLV,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)]});
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:me},
             {...s.players[1],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:p1bench,active:p1active}]};
}

// ① 非KO:對手(330HP)存活 → 對手 active 被設 nextOwnAttackPenalty=100;仙子伊布【不】被掛 blanket 減傷
T('① 魔法魅惑後(對手存活):對手 active nextOwnAttackPenalty=100、仙子伊布無 damageReduceNextHit',()=>{
  const st=setup(inst(GARC,{energyAttached:[inst(PSY),inst(PSY)]}));
  const r=applyAction(st,{type:'ATTACK',attackIndex:MAGIC_IDX},pool);
  const me=r.players[0].active, opp=r.players[1].active;
  console.log('   對手 nextOwnAttackPenalty=',opp?.nextOwnAttackPenalty,' 仙子伊布 damageReduceNextHit=',me?.damageReduceNextHit);
  assert.equal(opp?.nextOwnAttackPenalty,100,'被打的對手應被設削攻100(defNextAtkReducePost),實際='+opp?.nextOwnAttackPenalty);
  assert.ok(!me?.damageReduceNextHit,'仙子伊布自身不應被掛 blanket 減傷(那是v5.727錯版),實際='+me?.damageReduceNextHit);
});

// ② 玩家實測場景:魔法魅惑 160 KO 對手(80HP)→ 對手放【同名】替身 → 仙子伊布不應仍有 blanket 減傷
T('② KO對手後放同名替身:替身無 nextOwnAttackPenalty、仙子伊布無殘留 damageReduceNextHit',()=>{
  const benchClone=inst(CELE,{energyAttached:[inst(GRASS)]});
  const st=setup(inst(CELE,{energyAttached:[inst(GRASS)]}),[benchClone]);
  let r=applyAction(st,{type:'ATTACK',attackIndex:MAGIC_IDX},pool);
  // 魔法魅惑 160 > 時拉比 80HP → 應 KO,對手 active 清空,需補位
  assert.ok(!r.players[1].active,'80HP時拉比應被160KO,active 應清空;實際='+JSON.stringify(r.players[1].active));
  // 放同名替身上場
  r=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:benchClone.iid,senderIdx:1},pool);
  const me=r.players[0].active, opp=r.players[1].active;
  console.log('   替身 cardId=',opp?.cardId,' nextOwnAttackPenalty=',opp?.nextOwnAttackPenalty,' 仙子伊布 damageReduceNextHit=',me?.damageReduceNextHit);
  assert.equal(opp?.cardId,CELE,'替身應為同名時拉比');
  assert.ok(!opp?.nextOwnAttackPenalty,'同名替身不應繼承削攻penalty,實際='+opp?.nextOwnAttackPenalty);
  assert.ok(!me?.damageReduceNextHit,'★玩家bug:仙子伊布不應有殘留 blanket 減傷(HEAD selfDmgReducePost=100),實際='+me?.damageReduceNextHit);
});

// ②b 端到端:替身下回合反打仙子伊布 → 應造成有效傷害(非被 blanket -100 歸零)
T('②b 同名替身反打仙子伊布 → 造成有效傷害(>0);HEAD 會被 blanket -100 歸零',()=>{
  const benchClone=inst(CELE,{energyAttached:[inst(GRASS)]});
  const st=setup(inst(CELE,{energyAttached:[inst(GRASS)]}),[benchClone]);
  let r=applyAction(st,{type:'ATTACK',attackIndex:MAGIC_IDX},pool);
  r=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:benchClone.iid,senderIdx:1},pool);
  // 轉到對手回合,替身時拉比用日光刀反打仙子伊布
  const before=r.players[0].active.damage;
  r={...r,activePlayerIndex:1,turnPhase:'main',isFirstTurn:false,turn:(r.turn||5)+1};
  r=applyAction(r,{type:'ATTACK',attackIndex:CELE_IDX},pool);
  const dealt=r.players[0].active.damage - before;
  console.log('   仙子伊布受到傷害=',dealt);
  assert.ok(dealt>0,'替身反打應造成有效傷害(>0);HEAD 版會被仙子伊布 blanket 減傷歸零,實際='+dealt);
});

// ④ 基礎傷害仍為 160(未被本次改動影響)
T('④ 魔法魅惑基礎傷害仍為 160',()=>{
  const st=setup(inst(GARC,{energyAttached:[inst(PSY),inst(PSY)]}));
  const r=applyAction(st,{type:'ATTACK',attackIndex:MAGIC_IDX},pool);
  assert.equal(r.players[1].active.damage,160,'魔法魅惑base應160,實際='+r.players[1].active.damage);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
