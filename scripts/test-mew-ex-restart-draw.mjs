/** v5.813 夢幻ex|重啟:從牌庫抽到手牌滿3張(先前未實作,使用無效果)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.mr-s.js'),E=join(ROOT,'.mr-e.ts'),O=join(ROOT,'.mr-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const POKE='14443', MEW='11131';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(handN,deckN)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(MEW,{iid:'mew'}),bench:[],hand:Array.from({length:handN},()=>inst(POKE)),deck:Array.from({length:deckN},()=>inst(POKE)),discard:[],prizes:[1]},
           {name:'P2',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
T('★手牌1→抽到滿3(補2)', () => {
  const r=applyAction(mk(1,5),{type:'USE_ABILITY',iid:'mew',abilityIndex:0},pool);
  assert.strictEqual(r.players[0].hand.length,3,'手牌應抽到3');
  assert.strictEqual(r.players[0].deck.length,3,'牌庫應-2');
});
T('★手牌已4張→不抽(已滿3)', () => {
  const r=applyAction(mk(4,5),{type:'USE_ABILITY',iid:'mew',abilityIndex:0},pool);
  assert.strictEqual(r.players[0].hand.length,4,'已超過3不應抽');
});
T('★牌庫不足:手牌1+牌庫1→只抽到2', () => {
  const r=applyAction(mk(1,1),{type:'USE_ABILITY',iid:'mew',abilityIndex:0},pool);
  assert.strictEqual(r.players[0].hand.length,2,'牌庫只1張→手牌2');
});
console.log('\n夢幻ex重啟(v5.813):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
