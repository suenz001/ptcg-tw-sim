// v5.710 回歸:密勒頓(M5 19171)光子纜線卡面「基本【雷】能量」,原實作 filter 任意基本(preview光子密碼殘留)
//   →誤搬非雷基本能量。限基本【雷】。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-pc.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-pc.ts'); const O=join(ROOT,'.ent-pc.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { PASSIVE_ON_KO } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { PASSIVE_ON_KO }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const MIRIETON='19171', BUD='14443', ELE='18520', WATER='18519';
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
const fn=PASSIVE_ON_KO.get('光子纜線');
T('光子纜線 PASSIVE_ON_KO 已綁(live 19171 特性有觸發)', ()=>{ assert(typeof fn==='function','光子纜線 應在 PASSIVE_ON_KO'); });
T('光子纜線:身上 基本雷+基本水 → basicEnergyIids 只含雷(不搬水)[驗HEAD FAIL]', ()=>{
  const eLe=en(ELE), eWa=en(WATER);
  const defInst=inst(MIRIETON,[eLe,eWa]);
  const st={ phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false, log:[],
    players:[ {name:'P1', active:inst(BUD), bench:[], hand:[], deck:[], discard:[], prizes:[inst(BUD)]},
      {name:'P2', active:null, bench:[inst(BUD)], hand:[], deck:[], discard:[], prizes:[inst(BUD)]} ] };
  const out=fn(st, 1, 0, pool, pool.get(MIRIETON), defInst);
  const ids=out.pendingSelection?.validIids||[];
  assert(ids.includes(eLe.iid), '應含基本雷');
  assert(!ids.includes(eWa.iid), `不該含基本水(實 ${JSON.stringify(ids)})`);
  assert.equal(ids.length, 1, '只 1 張雷');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
