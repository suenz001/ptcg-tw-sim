// v5.707 回歸:中央 koTargetByAttackEffect(效果KO,深淵之瞳/手之力量等共用)的獎賞要走 koPrizesAdjusted
//   (脆弱蛻殼0/多餘花粉)+觸發奇跡之吻。原用 prizesForKOLocal(純count)漏這些。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-ek.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-ek.ts'); const O=join(ROOT,'.ent-ek.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, koTargetByAttackEffect } from './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const m=await import(pathToFileURL(O).href);
const koTargetByAttackEffect=m.koTargetByAttackEffect;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const BUD='14443', TOGE='14726'/*波克基斯奇跡之吻*/, SHED='14063'/*脆弱蛻殼*/;
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
// attacker(0) bench=atkBench, prizes 6; defender(1) active=target, bench=[含羞苞]
function mk(targetId, atkBench){
  const target=inst(targetId);
  const st={ phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false, turn:3,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null, log:[],
    players:[ {name:'P1', active:inst(BUD), bench:atkBench, hand:[], deck:[inst(BUD)], discard:[], prizes:Array.from({length:6},()=>inst(BUD))},
      {name:'P2', active:target, bench:[inst(BUD)], hand:[], deck:[inst(BUD)], discard:[], prizes:Array.from({length:6},()=>inst(BUD))} ] };
  return { st, target };
}
const taken=(out)=>6-out.players[0].prizes.length;
T('koTargetByAttackEffect 對手active效果KO + 奇跡之吻(正面) → 拿2[驗HEAD FAIL]', ()=>{
  const {st,target}=mk(BUD, [inst(TOGE)]);
  const orig=Math.random; Math.random=()=>0; let out; try{ out=koTargetByAttackEffect(st,0,target,true,pool,'測試'); } finally{Math.random=orig;}
  assert(!out.players[1].active, '對手active應KO');
  assert.equal(taken(out), 2, `應拿2(1base+1奇跡),實 ${taken(out)}`);
});
T('koTargetByAttackEffect 脆弱蛻殼(對ex攻擊方) → 拿0[驗HEAD FAIL]', ()=>{
  const {st,target}=mk(SHED, [inst(BUD)]);
  st.players[0].active=inst('11067'); // attacker=鋁鋼橋龍ex(脆弱蛻殼僅對 ex 攻擊方觸發)
  const out=koTargetByAttackEffect(st,0,target,true,pool,'測試');
  assert(!out.players[1].active, '脫殼忍者應KO');
  assert.equal(taken(out), 0, `脆弱蛻殼應拿0,實 ${taken(out)}`);
});
T('對照:無奇跡之吻 → 拿1', ()=>{
  const {st,target}=mk(BUD, [inst(BUD)]);
  const out=koTargetByAttackEffect(st,0,target,true,pool,'測試');
  assert.equal(taken(out), 1, `應拿1,實 ${taken(out)}`);
});
T('多餘花粉(deferredPrizeBonusThisTurn) 效果KO也+N[驗HEAD FAIL]', ()=>{
  const {st}=mk(BUD,[inst(BUD)]);
  const target=inst(BUD,[],{deferredPrizeBonusThisTurn:2}); st.players[1].active=target;
  const out=koTargetByAttackEffect(st,0,target,true,pool,'測試');
  assert.equal(taken(out), 3, `1base+2多餘花粉=3,實 ${taken(out)}`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
