// 越橘的一步棋（支援者）卡面「無法在自己的最初回合使用」：先攻第1+後攻第1(turn===1)都不可用，第2回合起可用。
//   原 gate 用 st.isFirstTurn 只擋先攻第1 → 後攻第1(turn仍1,isFirstTurn=false)誤放行。修：isOwnFirstTurn(turn===1)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.lb-e.ts'),O=join(ROOT,'.lb-o.mjs'),S=join(ROOT,'.lb-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { TRAINER_GUARDS } from './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { TRAINER_GUARDS } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const guard = TRAINER_GUARDS.get('越橘的一步棋');
if(!guard){ console.log('找不到越橘 guard'); process.exit(1); }
let iid=0; const inst=(cid)=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
const EN='14102';
function mk(turn, isFirstTurn, activeIdx){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:activeIdx, firstPlayerIdx:0, turn, isFirstTurn,
    activeStadium:null, setupDone:[true,true],
    players:[
      {active:inst(EN), bench:[], hand:[], deck:Array.from({length:10},()=>inst(EN)), discard:[], prizes:[], name:'P0'},
      {active:inst(EN), bench:[], hand:[], deck:Array.from({length:10},()=>inst(EN)), discard:[], prizes:[], name:'P1'},
    ] };
}
let pass=0,fail=0; const ck=(l,c,e)=>{c?(pass++,console.log('  PASS',l)):(fail++,console.log('  FAIL',l,e||''));};
// 先攻方(idx0)最初回合：turn1, isFirstTurn=true, active=0
ck('先攻方最初回合(turn1)→不可用', guard(mk(1,true,0),0,pool)===false);
// 後攻方(idx1)最初回合：turn1, isFirstTurn=false, active=1 ← 修前 bug(可用)
ck('後攻方最初回合(turn1,isFirstTurn=false)→不可用[修正點]', guard(mk(1,false,1),1,pool)===false);
// 先攻方第2回合：turn2
ck('先攻方第2回合(turn2)→可用', guard(mk(2,false,0),0,pool)===true);
// 後攻方第2回合：turn3(後攻方第2個動作回合,turn 在後攻END_TURN+1)
ck('後攻方第2回合(turn3)→可用', guard(mk(3,false,1),1,pool)===true);
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
