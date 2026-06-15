// 飛翔型(咕咕鴿/喇叭啄鳥)：擲幣正面→傷害+下回合免疫，反面→招式失敗(0傷)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.fly-e.ts'),O=join(ROOT,'.fly-o.mjs'),S=join(ROOT,'.fly-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const {applyAction}=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
function findAtk(nameInc, atkName){
  for(const [id,c] of pool){ if(c.supertype==='Pokemon'&&c.name&&c.name.includes(nameInc)){
    const idx=(c.attacks||[]).findIndex(a=>a.name===atkName); if(idx>=0) return {id,idx,dmg:(c.attacks[idx].damage||'')}; } }
  return null;
}
const GUGU=findAtk('咕咕鴿','飛翔');
const BIRD=findAtk('喇叭啄鳥','飛翔');
let OPP=null, EN=null;
for(const [id,c] of pool){
  if(!OPP && c.supertype==='Pokemon' && (c.subtype==='Basic'||c.stage==='Basic') && Number(c.hp)>=200 && !c.evolvesFrom) OPP=id;
  if(!EN && c.supertype==='Energy' && c.subtype==='Basic') EN=id;
}
if(!GUGU||!BIRD||!OPP||!EN){ console.log('找不到卡:',{GUGU,BIRD,OPP,EN}); process.exit(1); }
console.log('咕咕鴿|飛翔 id='+GUGU.id+' idx='+GUGU.idx+' dmg='+GUGU.dmg+' | 喇叭啄鳥|飛翔 id='+BIRD.id+' idx='+BIRD.idx+' dmg='+BIRD.dmg+' | OPP='+OPP+' EN='+EN);
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0;
const ck=(l,c,e)=>{ if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');} };
const ORND=Math.random; const setR=v=>{Math.random=()=>v;}; const rstR=()=>{Math.random=ORND;};
function mk(attackerId, extra={}){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(attackerId,[en(EN),en(EN)]), bench:[], hand:[], deck:Array.from({length:8},()=>en(EN)), discard:[], prizes:Array.from({length:6},()=>en(EN)), name:'P0' },
      { active:inst(OPP), bench:[], hand:[], deck:Array.from({length:8},()=>en(EN)), discard:[], prizes:Array.from({length:6},()=>en(EN)), name:'P1' },
    ], ...extra };
}
function attack(attackerId, atkIdx, randVal, queue){
  let s=mk(attackerId, queue?{_retryInjectedFlipsQueue:queue}:{});
  setR(randVal);
  s=applyAction(s,{type:'ATTACK',attackIndex:atkIdx},pool);
  rstR();
  return s;
}
console.log('1) 咕咕鴿|飛翔 正面 → 對手受 40 傷害 + 自身下回合免疫');
{ const s=attack(GUGU.id,GUGU.idx,0.1);
  ck('對手 active damage=40', s.players[1].active.damage===40, 'damage='+s.players[1].active.damage);
  ck('自身 immuneToAllAttackNextTurn=true', s.players[0].active.immuneToAllAttackNextTurn===true, JSON.stringify(s.players[0].active.immuneToAllAttackNextTurn));
}
console.log('2) 咕咕鴿|飛翔 反面 → 招式失敗 0 傷 + 不設免疫');
{ const s=attack(GUGU.id,GUGU.idx,0.9);
  ck('對手 active damage=0', s.players[1].active.damage===0, 'damage='+s.players[1].active.damage);
  ck('自身未設免疫', !s.players[0].active.immuneToAllAttackNextTurn, JSON.stringify(s.players[0].active.immuneToAllAttackNextTurn));
}
console.log('3) 喇叭啄鳥|飛翔 正面 → 對手受 30 傷害 + 免疫');
{ const s=attack(BIRD.id,BIRD.idx,0.1);
  ck('對手 active damage=30', s.players[1].active.damage===30, 'damage='+s.players[1].active.damage);
  ck('自身 immune', s.players[0].active.immuneToAllAttackNextTurn===true, '');
}
console.log('4) 重試徽章注入：random 反面 但 action._retryInjectedFlips=[正面] → 仍 40 傷');
{ let s=mk(GUGU.id); setR(0.9);
  s=applyAction(s,{type:'ATTACK',attackIndex:GUGU.idx,_retryInjectedFlips:['正面']},pool); rstR();
  ck('injected 覆蓋 random → 40 傷', s.players[1].active.damage===40, 'damage='+s.players[1].active.damage);
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
