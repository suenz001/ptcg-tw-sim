// v5.964 守衛(deck-search 完整性 round2):①女服務生 filter='BasicEnergy:TOP_N'(原generic顯示整副)
//   ②女服務生複製守衛:選 top6 外的能量→fail-closed 不附加、留牌庫(HEAD 會開 waitress-attach→複製)
//   ③cipher-geek 防呆 0-pick 不掉卡(reservedSecond 洗回,總卡數不變)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.di-e.ts'),O=join(ROOT,'.di-o.mjs'),S=join(ROOT,'.di-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nexport { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, TRAINER_EFFECTS } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const LGT='19248';  // 基本雷能量(id 需存在;用 fallback 若無)
// 找一張 live 基本能量 cardId
let BASIC=null; for(const [id,c] of pool){ if(c.supertype==='Energy'&&c.subtype==='Basic'){BASIC=id;break;} }
let pass=0,fail=0; const chk=(n,c)=>{if(c)pass++;else{fail++;console.log('  ❌',n);}};

function allIids(state){
  const out=[];
  for(const p of state.players){
    const zs=[p.active,...(p.bench||[]),...(p.hand||[]),...(p.deck||[]),...(p.discard||[]),...(p.prizes||[])];
    for(const c of zs){ if(!c)continue; out.push(c.iid); for(const e of (c.energyAttached||[]))out.push(e.iid); }
  }
  return out;
}
function baseState(deck){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingPrizes:[0,0],setupDone:[true,true],
    players:[{name:'P0',active:inst('19246'),bench:[],hand:[],deck,discard:[],prizes:[]},{name:'P1',active:inst('14086'),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
}

// ① reg filter
{
  const deck=[inst('14086'),inst('14086'),inst('14086'),inst('14086'),inst('14086'),inst('14086'),inst(BASIC)];
  const out=TRAINER_EFFECTS.get('女服務生')(baseState(deck),0,pool);
  chk('①女服務生 filter=BasicEnergy:TOP_N', out.pendingSelection?.filter==='BasicEnergy:TOP_N' && (out.pendingSelection?.params?.topIids||[]).length===6);
}
// ② 複製守衛:選 top6 外的能量 E(第7張) → 應 fail-closed(不開 waitress-attach、E 留牌庫)
{
  const top6=[inst('14086'),inst('14086'),inst('14086'),inst('14086'),inst('14086'),inst('14086')];
  const E=inst(BASIC); const deck=[...top6,E];
  const st=baseState(deck);
  st.pendingSelection={type:'deck-search',actorIdx:0,sourcePlayerIdx:0,minCount:0,maxCount:1,effectKey:'waitress-pick-energy',params:{topIids:top6.map(c=>c.iid)}};
  const out=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[E.iid]},pool);
  const noAttach = out.pendingSelection?.effectKey!=='waitress-attach';
  const eInDeck = out.players[0].deck.some(c=>c.iid===E.iid);
  const uniq = allIids(out).length===new Set(allIids(out)).size;
  chk('②女服務生 top6外能量 fail-closed(不附加/留牌庫/iid唯一)', noAttach && eInDeck && uniq);
}
// ③ cipher-geek 單步(v6.006)不掉卡 + 排序(先選=上方第2位、後選=最上方)
{
  const a=inst('14086'),b=inst('14086'),c=inst('14086');
  const deck=[a,b,c];
  const st=baseState(deck);
  const before=allIids(st).length;
  st.pendingSelection={type:'deck-search',actorIdx:0,sourcePlayerIdx:0,minCount:2,maxCount:2,effectKey:'cipher-geek-arrange-top',params:{}};
  const out=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[a.iid,b.iid]},pool);
  const after=allIids(out).length; const d=out.players[0].deck;
  // 選取序[a,b]→後選 b 最上方、先選 a 第2位、c 為 rest;總卡數守恆、無殘留 pending
  chk('③cipher-geek 單步不掉卡+排序(後選最上/先選第2)', after===before && d.length===3 && d[0].iid===b.iid && d[1].iid===a.iid && d[2].iid===c.iid && !out.pendingSelection);
}
console.log(`deck-search-integrity-964:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
