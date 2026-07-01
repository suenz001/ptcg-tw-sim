/** v5.824 移指示物到對手戰鬥場補免疫gate(蠱惑挪移/火箭鏡面):化隱對手不被放置。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.mc-s.js'),E=join(ROOT,'.mc-e.ts'),O=join(ROOT,'.mc-o.mjs');
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
const WING='11239', WOB='12908', ANCIENT='16621', ROCKET='14675', HID='19149', LAP='14085';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const drive=(atk,attackKey,srcCard,oppActiveCard)=>{
  const src=inst(srcCard,{iid:'src',damage:30});
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(atk,{iid:'act'}),bench:[src],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(oppActiveCard,{iid:'oppAct'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  let s=mod.ATTACK_POST.get(attackKey)(st,0,pool,{});
  s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:['src']},pool);
  return {s, srcDmg: s.players[0].bench.find(b=>b.iid==='src')?.damage};
};
T('★蠱惑挪移→化隱對手:不被放置(來源亦不清,gate-first)', () => {
  const {s,srcDmg}=drive(WING,'振翼髮|蠱惑挪移',ANCIENT,HID);
  assert.strictEqual(s.players[1].active.damage,0,'化隱對手不應被放指示物');
  assert.strictEqual(srcDmg,0,'source-first:化隱時來源指示物仍應移除(Q2758)');
});
T('★蠱惑挪移→一般對手:正常移轉30(對照)', () => {
  const {s}=drive(WING,'振翼髮|蠱惑挪移',ANCIENT,LAP);
  assert.strictEqual(s.players[1].active.damage,30,'一般對手應被移轉30');
});
T('★火箭鏡面→化隱對手:不被放置', () => {
  const {s,srcDmg}=drive(WOB,'火箭隊的果然翁|火箭鏡面',ROCKET,HID);
  assert.strictEqual(s.players[1].active.damage,0,'化隱對手不應被放指示物');
  assert.strictEqual(srcDmg,0,'source-first:化隱時來源指示物仍應移除(Q2758)');
});
T('★火箭鏡面→一般對手:正常移轉30(對照)', () => {
  const {s}=drive(WOB,'火箭隊的果然翁|火箭鏡面',ROCKET,LAP);
  assert.strictEqual(s.players[1].active.damage,30,'一般對手應被移轉30');
});
console.log('\n移指示物到對手免疫(v5.824):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
