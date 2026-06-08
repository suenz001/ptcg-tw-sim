// v5.503 護城龍|太古防壁：對手≤2能量招式對「備戰」的傷害也要擋(噴射打擊備戰50繞過)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-tb.ts'); const O=join(ROOT,'.ent-tb.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine'; import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const STARMIE='17998', WATER='18519', DURALUDON='19204', BENCHPOKE='14086'; // 超級寶石海星ex/水/護城龍/願增猿
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(WATER));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// P0=攻擊方 超級寶石海星ex 附 1 水; P1=防守方 active+備戰(50目標 + 護城龍)
function mk(attackerEnergy){
  const starmie=inst(STARMIE,{energyAttached:Array.from({length:attackerEnergy},()=>inst(WATER))});
  const benchTarget=inst(BENCHPOKE);
  const s=createGame({name:'P1',entries:[{cardId:STARMIE,count:1}]},{name:'P2',entries:[{cardId:STARMIE,count:1}]},pool);
  return { st:{...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:[inst(WATER)], discard:[], prizes:prize(6), bench:[], active:starmie },
      { ...s.players[1], hand:[], deck:[inst(WATER)], discard:[], prizes:prize(6),
        bench:[benchTarget, inst(DURALUDON)], active:inst(BENCHPOKE) },
    ] }, benchTargetIid:benchTarget.iid };
}
// 攻擊→開 bench-hit pending→選備戰目標→bench-hit-N
function attackAndHitBench(attackerEnergy){
  const { st, benchTargetIid }=mk(attackerEnergy);
  let out=applyAction(st, { type:'ATTACK', attackIndex:0 }, pool); // 噴射打擊
  // 若開了 pending(選備戰目標)，resolve 選 benchTarget
  if(out.pendingSelection){
    out=applyAction(out, { type:'RESOLVE_SELECTION', effectKey:out.pendingSelection.effectKey, selectedIids:[benchTargetIid], actorIdx:0 }, pool);
  }
  const bt=out.players[1].bench.find(b=>b.iid===benchTargetIid);
  return { out, benchDmg: bt?bt.damage:'(KO/missing)' };
}
T('攻擊方1水(≤2) → 太古防壁擋備戰50傷害(備戰目標 damage=0)〔核心bug〕', ()=>{
  const { benchDmg }=attackAndHitBench(1);
  assert.equal(benchDmg, 0, '太古防壁應擋住備戰傷害，實際備戰目標 damage='+benchDmg);
});
T('攻擊方1水 → 戰鬥場也被太古防壁擋(active damage=0)〔回歸〕', ()=>{
  const { out }=attackAndHitBench(1);
  assert.equal(out.players[1].active?.damage ?? 0, 0, '戰鬥場應被太古防壁擋');
});
T('攻擊方3水(>2) → 太古防壁不擋,備戰受50', ()=>{
  const { benchDmg }=attackAndHitBench(3);
  assert.equal(benchDmg, 50, '>2能量太古防壁不擋,備戰應受50，實際='+benchDmg);
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
