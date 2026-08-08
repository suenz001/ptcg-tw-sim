/** v5.846 密勒頓|光子纜線 KO 觸發選能量改 picker — 原 ≥3 張 auto-pick 前 2(deferred 技術債)。
 *  玩家從棄牌區選 2 張雷能量(discard-search→photon-code-pick-energy)→ 選備戰。
 *  選 e2,e3 應移 e2,e3、留 e1。HEAD 無此 resolver → 不動 FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.pc-s.js'),E=join(ROOT,'.pc-e.ts'),O=join(ROOT,'.pc-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); let lightning=null, poke=null;
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null){pool.set(String(c.id),c);if(!lightning&&c.supertype==='Energy'&&c.subtype==='Basic'&&(c.pokemonType==='Lightning'||/【雷】/.test(c.name||'')))lightning=String(c.id);if(!poke&&(c.supertype==='Pokémon'||c.supertype==='Pokemon'))poke=String(c.id);}}}
const en=(iid)=>({cardId:lightning,iid});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★光子纜線:選 e2,e3 → 移 e2,e3 到備戰、留 e1', () => {
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:1,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    players:[
      {name:'P1',active:{iid:'A',cardId:poke,damage:0,energyAttached:[]},bench:[{iid:'BN',cardId:poke,damage:0,energyAttached:[]}],hand:[],deck:[],discard:[en('e1'),en('e2'),en('e3')],prizes:[1,1,1,1,1,1]},
      {name:'P2',active:{iid:'B',cardId:poke,damage:0,energyAttached:[]},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}],
    // v6.129：validIids 必須在 params —— PendingSelection 型別沒有頂層 validIids，UI/AI/engine
    //   三端只讀 params.validIids。本測試原本照抄了錯誤寫法，等於把 bug 固化成契約。
    pendingSelection:{type:'discard-search',actorIdx:0,sourcePlayerIdx:0,minCount:2,maxCount:2,
      filter:'BasicEnergy:Lightning',effectKey:'photon-code-pick-energy',
      params:{label:'光子纜線',validIids:['e1','e2','e3']}}};
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['e2','e3']},pool);
  assert.ok(st.pendingSelection && st.pendingSelection.effectKey==='m5-mirieton-photon-code', `應開 bench-choose,實 ${st.pendingSelection&&st.pendingSelection.effectKey}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['BN']},pool);
  const bn=st.players[0].bench.find(b=>b.iid==='BN');
  const moved=bn.energyAttached.map(e=>e.iid).sort();
  assert.deepEqual(moved,['e2','e3'],`備戰應得 e2,e3,實 ${moved}`);
  const disc=st.players[0].discard.map(e=>e.iid).sort();
  assert.deepEqual(disc,['e1'],`棄牌應剩 e1,實 ${disc}`);
});
console.log('\n光子纜線選能量 picker(v5.846):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
