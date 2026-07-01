/** v5.822 「以任意方式附能」改走 startEnergyChain 分散(先前強制單一目標)。
 *  風妖精ex能量之禮(any-own)/逐電犬輸電衝刺(bench-only):多目標時應開 energy-distribute 而非 heal-target。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.da-s.js'),E=join(ROOT,'.da-e.ts'),O=join(ROOT,'.da-o.mjs');
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
const FAIRY='16515', DOG='16740', POKE='14443', FIRE='14428', WATER='18519', LIGHT='18520';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const drive=(atkCard,attackKey,benchN,deckEs)=>{
  const bench=Array.from({length:benchN},(_,i)=>inst(POKE,{iid:'b'+i}));
  const deck=deckEs.map((e,i)=>inst(e,{iid:'e'+i}));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(atkCard,{iid:'act'}),bench,hand:[],deck,discard:[],prizes:[1]},
             {name:'P2',active:inst(POKE,{iid:'o'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  let s=mod.ATTACK_POST.get(attackKey)(st,0,pool,{});
  s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:deck.map(d=>d.iid)},pool);
  return s;
};
T('★風妖精ex能量之禮:active+1bench(2目標)→開 energy-distribute(非 heal-target)', () => {
  const s=drive(FAIRY,'風妖精ex|能量之禮',1,[FIRE,WATER]);
  assert.strictEqual(s.pendingSelection?.type,'energy-distribute',`應開分散,實際 ${s.pendingSelection?.type}`);
});
T('★風妖精ex:只1隻寶可夢(active)→直接全附(無 modal),牌庫清空', () => {
  const s=drive(FAIRY,'風妖精ex|能量之禮',0,[FIRE,WATER]);
  assert.ok(!s.pendingSelection,'單一目標不應開 modal');
  assert.strictEqual(s.players[0].active.energyAttached.length,2,'2 能量應全附 active');
  assert.strictEqual(s.players[0].deck.filter(c=>c.cardId===FIRE||c.cardId===WATER).length,0,'能量應離開牌庫');
});
T('★逐電犬輸電衝刺:2 bench(bench-only)→開 energy-distribute', () => {
  const s=drive(DOG,'逐電犬|輸電衝刺',2,[LIGHT,LIGHT]);
  assert.strictEqual(s.pendingSelection?.type,'energy-distribute',`應開分散(bench-only),實際 ${s.pendingSelection?.type}`);
});
console.log('\n以任意方式附能分散(v5.822):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
