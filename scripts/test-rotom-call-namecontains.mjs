// v5.639 洛托呼喚：picker filter 從 NamePrefix=洛托姆 改 NameContains=洛托姆
//   (清洗/切割/加熱/旋轉洛托姆 的「洛托姆」是字尾，prefix 比對會漏 → 無法呼叫)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-rc.ts'); const O = join(ROOT,'.ent-rc.mjs');
writeFileSync(E, `export { createGame } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyItem=[...pool].find(([,c])=>c.supertype==='Trainer')?.[0];
const ROTOM='14736', WASH='12778', MOW='12754', HEAT='12771', SPIN='14799';
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

function mkState(deckCards){
  const s=createGame({name:'P1',entries:[{cardId:anyItem,count:1}]},{name:'P2',entries:[{cardId:anyItem,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:deckCards.map(inst), discard:[], bench:[], active:inst(ROTOM) },
      { ...s.players[1], hand:[], deck:[inst(anyItem)], discard:[], bench:[], active:inst(anyItem) },
    ] };
}
const lotom=ATTACK_POST.get('洛托姆|洛托呼喚');
assert(lotom,'找不到洛托呼喚 ATTACK_POST');

T('牌庫有形態洛托姆(清洗/切割/加熱) → 開 picker，filter=Pokemon:NameContains=洛托姆', ()=>{
  const out=lotom(mkState([WASH,MOW,HEAT,anyItem]), 0, pool);
  assert(out.pendingSelection?.type==='deck-search', '應開 deck-search picker');
  assert.equal(out.pendingSelection.filter, 'Pokemon:NameContains=洛托姆',
    'filter 應為 NameContains，實際='+out.pendingSelection.filter);
});
T('NameContains 語意：清洗/切割/加熱/旋轉洛托姆 都 match（舊 NamePrefix 會全漏）', ()=>{
  const contains=(cid)=>{const c=pool.get(cid);return c.supertype==='Pokemon'&&c.name.includes('洛托姆');};
  const prefix=(cid)=>{const c=pool.get(cid);return c.supertype==='Pokemon'&&c.name.startsWith('洛托姆');};
  for(const id of [WASH,MOW,HEAT,SPIN]){
    assert(contains(id), pool.get(id).name+' 應被 NameContains 命中');
    assert(!prefix(id), pool.get(id).name+' 不應被舊 NamePrefix 命中（證明舊版會漏）');
  }
  assert(prefix(ROTOM)&&contains(ROTOM), '基礎洛托姆 兩種都該命中');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
