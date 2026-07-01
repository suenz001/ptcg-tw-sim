/** v5.826 雪絨蛾|極寒旋風:選1個自身【水】能量改附於備戰(原簡化未實作);古舊/稜鏡視為水。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sn-s.js'),E=join(ROOT,'.sn-e.ts'),O=join(ROOT,'.sn-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const SNO='14701', POKE='14443', WATER='18519', FIRE='14428', ANCIENT='17212';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const drive=(actEnergies)=>{
  const es=actEnergies.map((cid,i)=>inst(cid,{iid:'e'+i}));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(SNO,{iid:'act',energyAttached:es}),bench:[inst(POKE,{iid:'bt'})],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(POKE,{iid:'o'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  let s=mod.ATTACK_POST.get('雪絨蛾|極寒旋風')(st,0,pool,{});
  // 若開了 pending(選能量或 bench),逐步 resolve 到底
  let guard=0;
  while(s.pendingSelection && guard++<4){
    const ps=s.pendingSelection;
    if(ps.type==='active-energy-discard'){ s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[ps.params.validIids[0]]},pool); }
    else if(ps.type==='bench-choose'){ s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:['bt']},pool); }
    else break;
  }
  return s;
};
T('★水能量(基本水)移到備戰、火留原位', () => {
  const s=drive([WATER,FIRE]);
  const bt=s.players[0].bench.find(b=>b.iid==='bt');
  assert.strictEqual(bt.energyAttached.length,1,'備戰應收到1能量');
  assert.strictEqual(String(bt.energyAttached[0].cardId),WATER,'應是水能量');
  assert.ok(s.players[0].active.energyAttached.some(e=>String(e.cardId)===FIRE),'火應留在active');
});
T('★古舊能量(視為水)可移到備戰', () => {
  const s=drive([ANCIENT]);
  const bt=s.players[0].bench.find(b=>b.iid==='bt');
  assert.strictEqual(bt.energyAttached.length,1,'古舊(視為水)應可移');
});
T('★只有火能量→無水可移(不移轉)', () => {
  const s=drive([FIRE]);
  const bt=s.players[0].bench.find(b=>b.iid==='bt');
  assert.strictEqual(bt.energyAttached.length,0,'無水能量不應移轉');
});
console.log('\n雪絨蛾移水能量(v5.826):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
