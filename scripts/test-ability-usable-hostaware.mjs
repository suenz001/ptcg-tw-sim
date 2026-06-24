// v5.702 回歸測試：特性「可用性 gate」(getUsableAbilities)的【X】能量存在判定要 host-aware,
//   與發動 handler(energyProvidesType)一致。bug:沖刷/金屬之路 gate 用 inline pokemonType/isEnergyOfType
//   漏古舊能量(全屬性)→備戰只有古舊能量時按鈕被擋,但發動 handler 認得→不一致。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-au.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-au.ts'); const O=join(ROOT,'.ent-au.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, getUsableAbilities } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, getUsableAbilities } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
// 動態找基本水/鋼能量 id
let waterE,metalE;
for(const[id,c]of pool){if(c.supertype==='Energy'&&c.subtype==='Basic'){
  if(!waterE&&(c.pokemonType==='Water'||/【水】/.test(c.name)))waterE=id;
  if(!metalE&&(c.pokemonType==='Metal'||/【鋼】/.test(c.name)))metalE=id;}}
const WALREIN='17996', KOBALON='18482', ANCIENT='10515', PRISM='13953', BUD='14443';
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
function mk(active, bench){
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[ {...s.players[0], active, bench, hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]},
      {...s.players[1], active:inst(BUD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]} ] };
}
const has=(st,name)=>getUsableAbilities(st,pool).some(a=>a.abilityName===name);

T('沖刷:備戰古舊能量(全屬性=提供水) → 沖刷可用[驗HEAD FAIL]', ()=>{
  const st=mk(inst(WALREIN), [inst(BUD,[en(ANCIENT)])]);
  assert(has(st,'沖刷'),'白海獅沖刷應可用(備戰古舊能量視為水)');
});
T('沖刷對照:備戰基本水能量 → 沖刷可用[HEAD亦PASS,防回歸]', ()=>{
  const st=mk(inst(WALREIN), [inst(BUD,[en(waterE)])]);
  assert(has(st,'沖刷'),'白海獅沖刷應可用(基本水)');
});
T('沖刷host-aware反向:備戰無任何水來源 → 沖刷不可用', ()=>{
  const st=mk(inst(WALREIN), [inst(BUD,[en(metalE)])]); // 只有鋼,無水
  assert(!has(st,'沖刷'),'無水能量時沖刷不該可用');
});
T('金屬之路:備戰古舊能量(提供鋼) → 可用[驗HEAD FAIL]', ()=>{
  const st=mk(inst(KOBALON,[],{movedToActiveThisTurn:true}), [inst(BUD,[en(ANCIENT)])]);
  assert(has(st,'金屬之路'),'金屬之路應可用(備戰古舊能量視為鋼)');
});
T('金屬之路對照:備戰基本鋼能量 → 可用[HEAD亦PASS]', ()=>{
  const st=mk(inst(KOBALON,[],{movedToActiveThisTurn:true}), [inst(BUD,[en(metalE)])]);
  assert(has(st,'金屬之路'),'金屬之路應可用(基本鋼)');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
