// v5.856 泡沫【水】能量卡面「附有的【水】寶可夢不會陷入特殊狀態,並將受到的特殊狀態全部恢復」。
//   clearSpecialEnergyProtectedStatuses 的 cleanInst 原只清 status+secondaryStatus、漏第三槽 tertiaryStatus;
//   三狀態制(睡眠+中毒+灼傷)下附泡沫水後第三槽灼傷不被清=違反「全部恢復」。補 tertiary 分支。
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
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const cid=(nm)=>{for(const[id,c]of pool)if(c.name===nm)return id;return null;};
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
const BUBBLE=cid('泡沫【水】能量');
let WATER=null,NONWATER=null;
for(const[id,c]of pool){ if(c.supertype==='Pokemon'&&!c.evolvesFrom){ if(!WATER&&c.pokemonType==='Water')WATER=id; if(!NONWATER&&c.pokemonType&&c.pokemonType!=='Water')NONWATER=id; } }
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
function attach(holderCid){
  const active=inst(holderCid,{status:'asleep',secondaryStatus:'poisoned',tertiaryStatus:'burned'});
  const bub=inst(BUBBLE);
  const st={ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null,
    players:[ {name:'A',active,bench:[],hand:[bub],deck:[],discard:[],prizes:[],energyAttachedThisTurn:false}, {name:'B',active:inst(holderCid),bench:[],hand:[],deck:[],discard:[],prizes:[]} ]};
  return applyAction(st,{type:'ATTACH_ENERGY',energyIid:bub.iid,targetIid:active.iid},pool).players[0].active;
}
T('泡沫水附【水】寶可夢(三狀態:睡眠+中毒+灼傷)→ 全部恢復,含第三槽灼傷 [HEAD FAIL:tertiary 灼傷殘留]', ()=>{
  const a=attach(WATER);
  assert.equal(a.status,undefined,'睡眠應清');
  assert.equal(a.secondaryStatus,undefined,'中毒應清');
  assert.equal(a.tertiaryStatus,undefined,'灼傷(第三槽)應清');
});
T('控制:泡沫水附非【水】寶可夢 → 免疫不生效,狀態不清(卡面限【水】)', ()=>{
  const a=attach(NONWATER);
  assert.equal(a.status,'asleep','非水:睡眠不清');
  assert.equal(a.tertiaryStatus,'burned','非水:灼傷不清');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
