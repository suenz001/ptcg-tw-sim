// energyMultiplyPre 火箭隊能量「個/單位」計數(數量=個語意,火箭隊=2) — v5.669
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.em-s.mjs'),E=join(ROOT,'.em-e.ts'),O=join(ROOT,'.em-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame, applyAction } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const MARILL='16768',ELEGANT='17057',ROCKET='14853',W='18519',PSY='14103',TANK='16916';
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function base(p0Active,p1Active){
  const s=createGame({name:'P1',entries:[{cardId:MARILL,count:1}]},{name:'P2',entries:[{cardId:TANK,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {...s.players[0],hand:[],deck:[inst(TANK)],discard:[],prizes:Array.from({length:6},()=>inst(TANK)),active:p0Active,bench:[]},
      {...s.players[1],hand:[],deck:[inst(TANK)],discard:[],prizes:Array.from({length:6},()=>inst(TANK)),active:p1Active,bench:[]}]};
}
const dmg=(o)=>o.players[1].active.damage;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★能量氣球(超,self)+火箭隊能量 → 火箭隊算2超 → 60+2×40=140', () => {
  const st=base(inst(MARILL,{energyAttached:[inst(ROCKET),inst(W)]}),inst(TANK));
  assert.equal(dmg(applyAction(st,{type:'ATTACK',attackIndex:0},pool)),140);
});
T('控制:能量氣球+基本超+水×2 → 1超 → 100', () => {
  const st=base(inst(MARILL,{energyAttached:[inst(PSY),inst(W),inst(W)]}),inst(TANK));
  assert.equal(dmg(applyAction(st,{type:'ATTACK',attackIndex:0},pool)),100);
});
T('★能量粉碎(優雅貓,all opp)對手火箭隊+水 → 單位數3 → 3×40=120', () => {
  const st=base(inst(ELEGANT,{energyAttached:[inst(W),inst(W)]}),inst(TANK,{energyAttached:[inst(ROCKET),inst(W)]}));
  assert.equal(dmg(applyAction(st,{type:'ATTACK',attackIndex:1},pool)),120);
});
T('控制:能量粉碎對手基本超+水(2張普通) → 2單位 → 80', () => {
  const st=base(inst(ELEGANT,{energyAttached:[inst(W),inst(W)]}),inst(TANK,{energyAttached:[inst(PSY),inst(W)]}));
  assert.equal(dmg(applyAction(st,{type:'ATTACK',attackIndex:1},pool)),80);
});

console.log('\nenergyMultiplyPre 火箭隊計數:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
