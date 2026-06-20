// v5.641 阿蜜的目光：玩家層級「下個對手回合」減傷 -30，涵蓋所有寶可夢(含新上場/備戰)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-ami.ts'); const O = join(ROOT,'.ent-ami.mjs');
writeFileSync(E, `export { createGame, applyAction, applyDefenderReductionsBlockA } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, applyAction, applyDefenderReductionsBlockA } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const AMI='17199', VAN='14443';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

function base(){
  const s=createGame({name:'P1',entries:[{cardId:VAN,count:1}]},{name:'P2',entries:[{cardId:VAN,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[inst(AMI)], deck:[inst(VAN)], discard:[], prizes:[inst(VAN)], active:inst(VAN), bench:[inst(VAN)] },
      { ...s.players[1], hand:[], deck:[inst(VAN)], discard:[], prizes:[inst(VAN)], active:inst(VAN), bench:[] },
    ] };
}

T('打出阿蜜的目光 → 玩家層級 flatDamageReduceNextTurn=30', ()=>{
  const st=base(); const hi=st.players[0].hand[0].iid;
  const out=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  assert.equal(out.players[0].flatDamageReduceNextTurn,30,'應設玩家層級 NextTurn=30');
  assert(!out.players[0].active.damageReduceNextHit,'不應再用 active instance 旗標');
});
T('END_TURN(進對手回合) → promote 成 flatDamageReduceThisTurn=30', ()=>{
  const st=base(); const hi=st.players[0].hand[0].iid;
  let out=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  out=applyAction(out,{type:'END_TURN'},pool);
  assert.equal(out.players[0].flatDamageReduceThisTurn,30,'對手回合開始應 promote 成 ThisTurn=30');
});
// 中央減傷:玩家有 flatDamageReduceThisTurn → 任一寶可夢(此處 active 本身無 instance 旗標)受招式傷害 -30
function callBlockA(defenderPlayer, baseDmg){
  const st=base();
  const defCard=pool.get(VAN), atkCard=pool.get(VAN);
  const r=applyDefenderReductionsBlockA(st, st, defenderPlayer, st.players[1], defCard, atkCard, baseDmg, false, false, 0, 1, [], pool);
  return r.baseDamage;
}
T('【核心】中央減傷:玩家旗標→該方寶可夢(無 instance 旗標,模擬新上場)受傷 -30', ()=>{
  const def={ active:inst(VAN), bench:[inst(VAN)], flatDamageReduceThisTurn:30 };
  assert.equal(callBlockA(def,100),70,'100 應減成 70');
});
T('控制組:無玩家旗標 → 不減傷', ()=>{
  const def={ active:inst(VAN), bench:[inst(VAN)] };
  assert.equal(callBlockA(def,100),100,'無旗標應維持 100');
});
T('減傷不會變負', ()=>{
  const def={ active:inst(VAN), bench:[], flatDamageReduceThisTurn:30 };
  assert.equal(callBlockA(def,20),0,'20-30 應為 0');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
