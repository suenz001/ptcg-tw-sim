/** v5.847 超級耿鬼ex|空無強風 選1能量改附備戰改 picker — 原自動取末端能量。
 *  多能量時玩家選要改附哪個。選 e1 應移 e1、留 e2。HEAD 自動取末端 e2 → FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.gv-s.js'),E=join(ROOT,'.gv-e.ts'),O=join(ROOT,'.gv-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); let bE=null;
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null){pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);if(!bE&&c.supertype==='Energy'&&c.subtype==='Basic')bE=String(c.id);}}}
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★空無強風:帶 e1,e2 選 e1 改附備戰 → 移 e1、留 e2', () => {
  const g=byName.get('超級耿鬼ex'); assert.ok(g,'查無超級耿鬼ex');
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:{iid:'A',cardId:String(g.id),damage:0,energyAttached:[{cardId:bE,iid:'e1'},{cardId:bE,iid:'e2'}]},bench:[{iid:'BN',cardId:String(g.id),damage:0,energyAttached:[]}],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:{iid:'B',cardId:String(g.id),damage:0,energyAttached:[]},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};
  st=ATTACK_POST.get('超級耿鬼ex|空無強風')(st,0,pool,{})||st;
  assert.ok(st.pendingSelection && st.pendingSelection.type==='active-energy-discard', `應開選能量 picker,實 ${st.pendingSelection&&st.pendingSelection.type}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['e1']},pool);
  assert.ok(st.pendingSelection && st.pendingSelection.type==='bench-choose', `應開選備戰,實 ${st.pendingSelection&&st.pendingSelection.type}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['BN']},pool);
  const bn=st.players[0].bench.find(b=>b.iid==='BN');
  assert.deepEqual(bn.energyAttached.map(e=>e.iid),['e1'],`備戰應得 e1,實 ${bn.energyAttached.map(e=>e.iid)}`);
  assert.deepEqual(st.players[0].active.energyAttached.map(e=>e.iid),['e2'],`active 應留 e2`);
});
console.log('\n空無強風改附 picker(v5.847):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
