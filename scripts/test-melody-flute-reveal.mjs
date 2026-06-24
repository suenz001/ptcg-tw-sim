// v5.704 回歸測試：配樂之笛翻對手牌庫頂5張,即使無基礎寶可夢也要開 deck-search picker
//   讓玩家看過揭示的5張再確認(比照集客/寶可裝置3.0 一律開 picker)。原 maxN===0 早退→直接洗回,玩家看不到揭示。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-mf.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-mf.ts'); const O=join(ROOT,'.ent-mf.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const FLUTE='10505', BUD='14443'; // 配樂之笛, 含羞苞(Basic)
let waterE; for(const[id,c]of pool)if(c.supertype==='Energy'&&c.subtype==='Basic'&&(c.pokemonType==='Water'||/【水】/.test(c.name)))waterE??=id;
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
// 自己手上配樂之笛;對手 active+bench空+牌庫頂5張為 deckTop(陣列 cardId)
function mk(oppDeckTop){
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  const oppDeck=[...oppDeckTop.map(cid=>inst(cid)), inst(BUD)];
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[ {...s.players[0], active:inst(BUD), bench:[], hand:[inst(FLUTE)], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]},
      {...s.players[1], active:inst(BUD), bench:[], hand:[], deck:oppDeck, discard:[], prizes:[inst(BUD)]} ] };
}
function play(st){ const hi=st.players[0].hand[0].iid; return applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool); }
T('對手牌庫頂5張無基礎寶可夢 → 仍開 deck-search picker 顯示5張[驗HEAD FAIL]', ()=>{
  const st=mk([waterE,waterE,waterE,waterE,waterE]); // 5 張基本水能量,無基礎寶可夢
  const out=play(st);
  assert(out.pendingSelection, '應開啟 pendingSelection(讓玩家看揭示),而非早退洗回');
  assert.equal(out.pendingSelection.type,'deck-search','應為 deck-search picker');
  assert.equal((out.pendingSelection.params?.top5Iids||[]).length,5,'應揭示對手牌庫頂5張');
});
T('對照:對手牌庫頂有基礎寶可夢 → 開 picker[HEAD亦PASS]', ()=>{
  const st=mk([BUD,waterE,waterE,waterE,waterE]);
  const out=play(st);
  assert(out.pendingSelection && out.pendingSelection.type==='deck-search','應開 picker');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
