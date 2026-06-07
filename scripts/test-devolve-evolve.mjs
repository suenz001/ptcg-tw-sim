// v5.497 對手退化(原始之翼/退化光線)不設 evolvedThisTurn → 對手下回合可再進化
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-dev.ts'); const O=join(ROOT,'.ent-dev.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';
export { RESOLVERS, ATTACK_POST } from './src/lib/game/effects/_shared';
import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, RESOLVERS, ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const BASE='17045', STAGE1='14465'; // 土龍弟弟 → 土龍節節
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyItem=[...pool].find(([,c])=>c.supertype==='Trainer')?.[0];
const prize=n=>Array.from({length:n},()=>inst(anyItem));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// 對手(P1) active = 土龍節節(已進化,stack=[土龍弟弟])
function evolvedOppState(){
  const baseInst=inst(BASE);
  const stage1=inst(STAGE1,{ evolvedFromStack:[baseInst], evolvedFromIid:baseInst.iid });
  const s=createGame({name:'P1',entries:[{cardId:anyItem,count:1}]},{name:'P2',entries:[{cardId:anyItem,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:[inst(anyItem)], discard:[], prizes:prize(6), bench:[], active:inst(BASE) },
      { ...s.players[1], hand:[], deck:[inst(anyItem)], discard:[], prizes:prize(6), bench:[], active:stage1 },
    ] };
}

// ① 原始之翼 resolver 退化對手 → 對手寶可夢 evolvedThisTurn 不為 true
const primalWing=RESOLVERS.get('archeops-primal-wing');
assert(primalWing,'找不到 archeops-primal-wing resolver');
T('原始之翼: 退化對手後 evolvedThisTurn 不為 true', ()=>{
  const st=evolvedOppState();
  const tIid=st.players[1].active.iid;
  const out=primalWing(st, 0, [tIid], {}, pool);
  const dev=out.players[1].active;
  assert.equal(dev.cardId, BASE, '應退化為土龍弟弟，實際 cardId='+dev.cardId);
  assert(!dev.evolvedThisTurn, 'evolvedThisTurn 不該為 true(否則對手下回合不能進化)，實際='+dev.evolvedThisTurn);
});

// ② 退化光線 ATTACK_POST 退化對手 active → 同
const beam=ATTACK_POST.get('念力土偶|退化光線');
assert(beam,'找不到退化光線 ATTACK_POST');
T('退化光線: 退化對手後 evolvedThisTurn 不為 true', ()=>{
  const out=beam(evolvedOppState(), 0, pool);
  const dev=out.players[1].active;
  assert.equal(dev.cardId, BASE, '應退化為土龍弟弟');
  assert(!dev.evolvedThisTurn, 'evolvedThisTurn 不該為 true，實際='+dev.evolvedThisTurn);
});

// ③ 整合：退化後的基礎(evolvedThisTurn=undefined) 換到其回合可 EVOLVE 回 stage1
function evolveTest(baseFlag){
  const baseInst=inst(BASE, baseFlag?{evolvedThisTurn:true}:{});
  const s=createGame({name:'P1',entries:[{cardId:anyItem,count:1}]},{name:'P2',entries:[{cardId:anyItem,count:1}]},pool);
  const evoCard=inst(STAGE1);
  const st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[evoCard], deck:[inst(anyItem)], discard:[], prizes:prize(6), bench:[], active:baseInst },
      { ...s.players[1], hand:[], deck:[inst(anyItem)], discard:[], prizes:prize(6), bench:[], active:inst(BASE) },
    ] };
  return applyAction(st, { type:'EVOLVE', fromIid:baseInst.iid, toIid:evoCard.iid }, pool);
}
T('整合: evolvedThisTurn=undefined → 可進化(土龍弟弟→土龍節節)〔修正效果〕', ()=>{
  const out=evolveTest(false);
  assert.equal(out.players[0].active.cardId, STAGE1, '應成功進化為土龍節節，實際='+out.players[0].active.cardId);
});
T('整合(對照): evolvedThisTurn=true → 進化被擋(維持土龍弟弟)', ()=>{
  const out=evolveTest(true);
  assert.equal(out.players[0].active.cardId, BASE, 'evolvedThisTurn=true 應擋住進化');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
