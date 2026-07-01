/** v5.823 tagged「以任意方式」附能(密勒頓未來/太樂巴戈斯太晶)改走 startEnergyChain(targetIids)分散;
 *  多目標開 energy-distribute 且 validIids 只含標籤寶可夢(排除非標籤)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.tg-s.js'),E=join(ROOT,'.tg-e.ts'),O=join(ROOT,'.tg-o.mjs');
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
const MILLE='12410', TERA='11273', F1='16751', F2='16752', T1='14677', T2='14691', POKE='14443';
const FIRE='14428', WATER='18519', GRASS='14102';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const drive=(atkCard,attackKey,bench,deckEs)=>{
  const b=bench.map((cid,i)=>inst(cid,{iid:'b'+i}));
  const deck=deckEs.map((e,i)=>inst(e,{iid:'e'+i}));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(atkCard,{iid:'act'}),bench:b,hand:[],deck,discard:[],prizes:[1]},
             {name:'P2',active:inst(POKE,{iid:'o'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  let s=mod.ATTACK_POST.get(attackKey)(st,0,pool,{});
  s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:deck.map(d=>d.iid)},pool);
  return {s, benchIids:b.map(x=>x.iid)};
};
T('★密勒頓暴衝高點:分散到「未來」+排除非未來(含羞苞)', () => {
  // bench: b0=鐵臂膀(未來) b1=鐵荊棘(未來) b2=含羞苞(非未來)
  const {s,benchIids}=drive(MILLE,'密勒頓|暴衝高點',[F1,F2,POKE],[FIRE,WATER]);
  assert.strictEqual(s.pendingSelection?.type,'energy-distribute',`應開分散,實際 ${s.pendingSelection?.type}`);
  const vi=s.pendingSelection.params.validIids;
  assert.ok(vi.includes(benchIids[0])&&vi.includes(benchIids[1]),'未來寶可夢應為合法目標');
  assert.ok(!vi.includes(benchIids[2]),'非未來(含羞苞)不應是合法目標');
});
T('★太樂巴戈斯稜鏡充能:3各不同屬性→分散到「太晶」+排除非太晶', () => {
  const {s,benchIids}=drive(TERA,'太樂巴戈斯|稜鏡充能',[T1,T2,POKE],[FIRE,WATER,GRASS]);
  assert.strictEqual(s.pendingSelection?.type,'energy-distribute',`應開分散,實際 ${s.pendingSelection?.type}`);
  const vi=s.pendingSelection.params.validIids;
  assert.ok(vi.includes(benchIids[0])&&vi.includes(benchIids[1]),'太晶寶可夢應為合法目標');
  assert.ok(!vi.includes(benchIids[2]),'非太晶(含羞苞)不應是合法目標');
});
console.log('\ntagged附能分散(v5.823):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
