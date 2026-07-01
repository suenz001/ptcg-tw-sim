// v5.831 驗證：夢妖魔ex|漩渦言靈(戰鬥場,對手回合對手戰鬥寶可夢回備戰→混亂新上場)
//   須在對手用「招式自我互換」(do-switch / self-swap-active-bench)回備戰時也觸發，非只 RETREAT。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const VORTEX='14354'/*夢妖魔ex 漩渦言靈*/, MUNNA='14086', LAPRAS='14085';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const confused=(inst2)=>inst2 && (inst2.status==='confused'||inst2.secondaryStatus==='confused'||inst2.tertiaryStatus==='confused');

function base(effectKey){
  // P0(mover, active player) self-swaps; P1 active = 夢妖魔ex(漩渦言靈)
  const newActiveBench=inst(LAPRAS);
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    pendingSelection:{type:'bench-choose',actorIdx:0,sourcePlayerIdx:0,minCount:1,maxCount:1,effectKey},
    players:[
      {name:'A',active:inst(MUNNA),bench:[newActiveBench],hand:[],deck:[],discard:[],prizes:[]},
      {name:'B',active:inst(VORTEX),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    ], _benchIid:newActiveBench.iid};
}
T('A. self-swap-active-bench：對手回合自我互換 → 新上場混亂',()=>{
  const st=base('self-swap-active-bench');
  const r=mod.applyAction(st,{type:'RESOLVE_SELECTION',effectKey:'self-swap-active-bench',selectedIids:[st._benchIid],actorIdx:0},pool);
  assert(r.players[0].active && r.players[0].active.cardId===LAPRAS,'新上場應為拉普拉斯ex');
  assert(confused(r.players[0].active),'新上場應混亂,實際 status='+JSON.stringify({s:r.players[0].active.status,s2:r.players[0].active.secondaryStatus}));
});
T('B. do-switch：對手回合自我互換 → 新上場混亂',()=>{
  const st=base('do-switch');
  const r=mod.applyAction(st,{type:'RESOLVE_SELECTION',effectKey:'do-switch',selectedIids:[st._benchIid],actorIdx:0},pool);
  assert(r.players[0].active && r.players[0].active.cardId===LAPRAS,'新上場應為拉普拉斯ex');
  assert(confused(r.players[0].active),'新上場應混亂,實際 status='+JSON.stringify({s:r.players[0].active.status,s2:r.players[0].active.secondaryStatus}));
});
T('C. 對照：無漩渦言靈時不混亂(P1 active 換成一般寶可夢)',()=>{
  const st=base('do-switch'); st.players[1].active=inst(MUNNA);
  const r=mod.applyAction(st,{type:'RESOLVE_SELECTION',effectKey:'do-switch',selectedIids:[st._benchIid],actorIdx:0},pool);
  assert(!confused(r.players[0].active),'無漩渦言靈不應混亂');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
