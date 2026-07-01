/** v5.827 巨翅飛魚|呼朋引伴 用中央 getOwnBenchLimit(零之大空洞+太晶=8)非硬寫5。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.cf-s.js'),E=join(ROOT,'.cf-e.ts'),O=join(ROOT,'.cf-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const FISH='16644', ZERO='14844', TERA='14677', POKE='14443';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(stadium, benchN)=>{
  const bench=[inst(TERA,{iid:'tera'})];  // 太晶在備戰
  for(let i=1;i<benchN;i++) bench.push(inst(POKE,{iid:'b'+i}));
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    activeStadium: stadium ? { cardId: ZERO, iid:'st' } : null,
    players:[{name:'P1',active:inst(FISH,{iid:'act'}),bench,hand:[],deck:[inst(POKE),inst(POKE)],discard:[],prizes:[1]},
             {name:'P2',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
};
T('★零之大空洞+太晶+6備戰→仍可放(上限8)', () => {
  const r=ATTACK_POST.get('巨翅飛魚|呼朋引伴')(mk(true,6),0,pool,{});
  assert.ok(r.pendingSelection,'上限8下6備戰應可放(開picker)');
  assert.strictEqual(r.pendingSelection.type,'deck-search');
});
T('★無零之大空洞+5備戰→備戰滿不可放(上限5,對照)', () => {
  const r=ATTACK_POST.get('巨翅飛魚|呼朋引伴')(mk(false,5),0,pool,{});
  assert.ok(!r.pendingSelection,'上限5下5備戰應已滿');
});
T('★零之大空洞+太晶+8備戰→已滿(上限8)', () => {
  const r=ATTACK_POST.get('巨翅飛魚|呼朋引伴')(mk(true,8),0,pool,{});
  assert.ok(!r.pendingSelection,'8備戰達上限8應滿');
});
console.log('\n呼朋引伴bench上限(v5.827):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
