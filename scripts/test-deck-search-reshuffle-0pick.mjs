// v5.963 守衛:deck-search 型卡的「0-pick(跳過)」路徑必須重洗牌庫(否則看完整副牌庫→順序全知可利用)。
//   測 sage-evolve/cresselia-attach-energy/deck-energy-attach-self 的 0-pick 都改走 openDeckViewReshuffle
//   →應開重洗 pending(effectKey='search-to-hand-reshuffle')。HEAD 只 log 不洗→無此 pending。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.dsr-e.ts'),O=join(ROOT,'.dsr-o.mjs'),S=join(ROOT,'.dsr-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
let pass=0,fail=0; const chk=(n,c)=>{if(c)pass++;else{fail++;console.log('  ❌',n);}};

function run0pick(effectKey, params){
  const d1=inst('19245'),d2=inst('14086'),d3=inst('18519');
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingPrizes:[0,0],
    players:[{name:'P0',active:inst('19246'),bench:[],hand:[],deck:[d1,d2,d3],discard:[],prizes:[]},
             {name:'P1',active:inst('14086'),bench:[],hand:[],deck:[],discard:[],prizes:[]}],
    pendingSelection:{type:'deck-search',actorIdx:0,sourcePlayerIdx:0,minCount:0,maxCount:2,effectKey,params}};
  return applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[]},pool);
}
// ① sage-evolve
let out=run0pick('sage-evolve',{});
chk('①賽吉 0-pick → 開重洗 pending', out.pendingSelection?.effectKey==='search-to-hand-reshuffle');
// ② cresselia-attach-energy
out=run0pick('cresselia-attach-energy',{});
chk('②充溢之光 0-pick → 開重洗 pending', out.pendingSelection?.effectKey==='search-to-hand-reshuffle');
// ③ deck-energy-attach-self (label param)
out=run0pick('deck-energy-attach-self',{label:'力量充能'});
chk('③力量充能 0-pick → 開重洗 pending', out.pendingSelection?.effectKey==='search-to-hand-reshuffle');

console.log(`deck-search-reshuffle-0pick:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
