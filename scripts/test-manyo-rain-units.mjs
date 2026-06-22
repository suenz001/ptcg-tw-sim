// 萬葉陣雨(碧草面具ex):雙方戰鬥能量「個」數(火箭隊=2 via getEnergyDiscardUnits) — v5.671
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.mr-s.mjs'),E=join(ROOT,'.mr-e.ts'),O=join(ROOT,'.mr-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame, applyAction } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const MASK='14677',ROCKET='14853',GRASS='14102',W='18519',TANK='16916';
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function base(p1Active){
  const s=createGame({name:'P1',entries:[{cardId:MASK,count:1}]},{name:'P2',entries:[{cardId:TANK,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {...s.players[0],hand:[],deck:[inst(TANK)],discard:[],prizes:Array.from({length:6},()=>inst(TANK)),active:inst(MASK,{energyAttached:[inst(GRASS),inst(GRASS),inst(GRASS)]}),bench:[]},
      {...s.players[1],hand:[],deck:[inst(TANK)],discard:[],prizes:Array.from({length:6},()=>inst(TANK)),active:p1Active,bench:[]}]};
}
const dmg=(o)=>o.players[1].active.damage;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★對手火箭隊+水 → 攻3草+對手(2+1)=6 → 30+6×30=210', () => {
  assert.equal(dmg(applyAction(base(inst(TANK,{energyAttached:[inst(ROCKET),inst(W)]})),{type:'ATTACK',attackIndex:0},pool)),210);
});
T('控制:對手2普通能量 → 3+2=5 → 180', () => {
  assert.equal(dmg(applyAction(base(inst(TANK,{energyAttached:[inst(W),inst(W)]})),{type:'ATTACK',attackIndex:0},pool)),180);
});
console.log('\n萬葉陣雨 單位計數:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
