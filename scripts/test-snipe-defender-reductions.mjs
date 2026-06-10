// v5.544 驗證：狙擊/延後型招式(走中央 dealAttackDamageToTarget)正確套各種防守方減傷
//   玩偶捕捉(超,80,中央函式打 active) × 果實道具福祿果(超-60+丟棄) / 全金屬實驗室(鋼-30) / 堅硬身軀(特性-20)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-sdr.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-sdr.ts'); const O = join(ROOT,'.ent-sdr.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const DOLL='19176'/*詛咒娃娃 玩偶捕捉 超80*/, REGI='16970'/*雷吉斯奇魯ex 鋼230 弱火*/, SHELL='18422'/*鐵殼蛹 草80 堅硬身軀-20*/;
const FULU='17148'/*福祿果 超-60丟棄*/, METALLAB='9911'/*全金屬實驗室*/, E_PSY='11177';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
// P0 攻擊方(詛咒娃娃+超能量+空牌庫); P1 防守方
function run(defActive, {tool=null, stadium=null}={}){
  const s=createGame({name:'A',entries:[{cardId:DOLL,count:1}]},{name:'B',entries:[{cardId:defActive,count:1}]},pool);
  const da=inst(defActive); if(tool) da.toolAttached=inst(tool);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    activeStadium: stadium?inst(stadium):null,
    players:[{...s.players[0],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(DOLL)),bench:[],active:inst(DOLL,{energyAttached:[inst(E_PSY)]})},
             {...s.players[1],hand:[],deck:[inst(defActive)],discard:[],prizes:Array.from({length:6},()=>inst(defActive)),bench:[],active:da}]};
  let r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  if(r.pendingSelection) r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:r.pendingSelection.effectKey,selectedIids:[],actorIdx:0},pool);
  return r;
}
T('① 果實道具 福祿果(超-60)：玩偶捕捉80 → 20 + 福祿果丟到棄牌區',()=>{
  const r=run(REGI,{tool:FULU});
  assert.equal(r.players[1].active?.damage,20,'應80-60=20,實際'+r.players[1].active?.damage);
  assert(r.players[1].discard.some(c=>c.cardId===FULU),'福祿果應已丟到棄牌區');
  assert(!r.players[1].active?.toolAttached,'福祿果應已從寶可夢移除');
});
T('② 競技場 全金屬實驗室(鋼-30)：玩偶捕捉80 → 50',()=>{
  const r=run(REGI,{stadium:METALLAB});
  assert.equal(r.players[1].active?.damage,50,'應80-30=50,實際'+r.players[1].active?.damage);
});
T('③ 特性 堅硬身軀(-20)：玩偶捕捉80打鐵殼蛹(80HP) → 60(存活,非KO)',()=>{
  const r=run(SHELL);
  assert(r.players[1].active && r.players[1].active.cardId===SHELL,'鐵殼蛹應存活(減傷後60<80HP)');
  assert.equal(r.players[1].active?.damage,60,'應80-20=60,實際'+r.players[1].active?.damage);
});
T('④ 對照(無減傷)：玩偶捕捉80打雷吉斯奇魯ex → 80',()=>{
  const r=run(REGI);
  assert.equal(r.players[1].active?.damage,80,'無減傷應80,實際'+r.players[1].active?.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
