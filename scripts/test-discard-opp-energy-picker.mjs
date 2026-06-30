/** 丟對手能量改 picker 讓攻擊方選(吼叫尾ex咬碎) v5.800
 * 卡面「選擇1個對手能量丟棄」原自動取末張(違反 v5.663 選能量須picker)。
 * 2+ 候選→開 active-energy-discard picker；1 候選→直接丟。HEAD:自動丟末張(無 pending)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.de-s.js'),E=join(ROOT,'.de-e.ts'),O=join(ROOT,'.de-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', GRASS='14102', ANCIENT='17212';
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(oppEnergies)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(POKE,{energyAttached:oppEnergies}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});

T('★對手2種能量→咬碎開 picker(非自動丟末張)', () => {
  const g=inst(GRASS), a=inst(ANCIENT);
  const out=ATTACK_POST.get('吼叫尾ex|咬碎')(mk([g,a]),0,pool);
  assert.ok(out.pendingSelection, '2 能量應開 picker(HEAD 自動丟,無 pending)');
  assert.equal(out.pendingSelection.type,'active-energy-discard');
  assert.equal(out.pendingSelection.effectKey,'discard-opp-active-energy-pick');
  assert.equal(out.players[1].active.energyAttached.length, 2, '選之前不該已丟');
});

T('resolver:選古舊能量→只丟古舊(尊重玩家選擇)', () => {
  const g=inst(GRASS), a=inst(ANCIENT);
  let st=ATTACK_POST.get('吼叫尾ex|咬碎')(mk([g,a]),0,pool);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[a.iid]},pool);
  const left=st.players[1].active.energyAttached.map(e=>e.cardId);
  assert.deepEqual(left,[GRASS],`應只剩基本草(丟了選的古舊),實得 ${JSON.stringify(left)}`);
  assert.ok(st.players[1].discard.some(c=>c.cardId===ANCIENT),'古舊應進棄牌');
});

T('1 能量→直接丟(無 picker)', () => {
  const g=inst(GRASS);
  const out=ATTACK_POST.get('吼叫尾ex|咬碎')(mk([g]),0,pool);
  assert.ok(!out.pendingSelection, '1 能量不該開 picker');
  assert.equal(out.players[1].active.energyAttached.length, 0, '應已丟');
});

console.log('\n丟對手能量picker(v5.800):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
