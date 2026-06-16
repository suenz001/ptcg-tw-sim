// v5.619 超級差不多娃娃ex｜萬花筒華爾滋：從牌庫選最多正面×2 張基本能量(任意屬性)分配自己寶可夢。
//   收斂到 startEnergyChain(source='deck')：混屬性逐屬性分波(每波顯示實際屬性)、同屬性單 +/-、1目標全附。
//   原 bug：自訂 energy-distribute 對混屬性只顯示通用「基本」，玩家看不出屬性→填到錯的寶可夢。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-kw.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-kw.ts'); const O=join(ROOT,'.ent-kw.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine'; import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='17973', FIRE='14428', WATER='18519';
let iid=0; const inst=(cid,e=[])=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:e});
const prize=n=>Array.from({length:n},()=>inst(FIRE));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// deckEnergies 放牌庫;nTargets 隻寶可夢(含active);開 deck-search pending → resolve 選那些能量 iid
function mk(deckEnergies, nTargets){
  const ens=deckEnergies.map(c=>inst(c));
  const s=createGame({name:'P1',entries:[{cardId:POKE,count:1}]},{name:'P2',entries:[{cardId:POKE,count:1}]},pool);
  const bench=[]; for(let i=1;i<nTargets;i++) bench.push(inst(POKE));
  return { st:{...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    pendingSelection:{ type:'deck-search', actorIdx:0, sourcePlayerIdx:0, filter:'BasicEnergy',
      minCount:0, maxCount:ens.length, effectKey:'kaleido-waltz-distribute-stage1', params:{label:'萬花筒華爾滋'} },
    players:[
      { ...s.players[0], hand:[], deck:[...ens, inst(POKE)], discard:[], prizes:prize(6), bench, active:inst(POKE) },
      { ...s.players[1], hand:[], deck:[inst(POKE)], discard:[], prizes:prize(6), bench:[], active:inst(POKE) },
    ] }, eiids:ens.map(e=>e.iid) };
}
function resolve(deckEnergies, nTargets, selN){
  const { st, eiids }=mk(deckEnergies, nTargets);
  const sel = selN===undefined ? eiids : eiids.slice(0,selN);
  return applyAction(st, { type:'RESOLVE_SELECTION', effectKey:'kaleido-waltz-distribute-stage1', selectedIids:sel, actorIdx:0 }, pool);
}
// ① 核心：混合(火+水)+2目標 → 逐屬性分波,第一波顯示實際屬性(火或水)、非通用「基本」
T('混合(火+水)+2目標 → 分波 modal 顯示實際屬性(非「基本」)', ()=>{
  const out=resolve([FIRE, WATER], 2);
  assert.equal(out.pendingSelection?.type, 'energy-distribute', '應開分配 modal');
  const tn=out.pendingSelection.params.energyTypeName;
  assert(tn==='火'||tn==='水', "第一波應顯示實際屬性(火/水),實際='"+tn+"'");
  assert(tn!=='基本', '不可再是通用「基本」標籤');
});
// ② 同屬性(火+火)+2目標 → 單 +/-,energyTypeName=火
T('同屬性(火+火)+2目標 → energyTypeName=火', ()=>{
  const out=resolve([FIRE, FIRE], 2);
  assert.equal(out.pendingSelection?.type,'energy-distribute');
  assert.equal(out.pendingSelection.params.energyTypeName, '火');
});
// ③ 1目標 → 直接全附(無 picker),2 張能量到該寶可夢,牌庫不再含這些能量
T('1目標 → 全附(無 modal),能量到寶可夢、離開牌庫', ()=>{
  const out=resolve([FIRE, WATER], 1);
  assert(!out.pendingSelection, '1目標不應開 modal');
  assert.equal(out.players[0].active.energyAttached.length, 2, 'active 應有 2 能量');
  const deckEnergy=out.players[0].deck.filter(c=>c.cardId===FIRE||c.cardId===WATER).length;
  assert.equal(deckEnergy, 0, '能量應已離開牌庫');
});
// ④ 0 選擇 → 不開 modal,能量未附(留牌庫)
T('0 選擇 → 不開 modal,能量未附加', ()=>{
  const out=resolve([FIRE, WATER], 2, 0);
  assert(!out.pendingSelection, '未選不應開 modal');
  assert.equal(out.players[0].active.energyAttached.length, 0, 'active 不應有能量');
});
console.log(`\n=== 萬花筒華爾滋 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
