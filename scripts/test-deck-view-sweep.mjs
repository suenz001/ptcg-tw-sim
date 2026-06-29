// v5.496 牌庫搜尋型無符合卡 → 仍開 deck-search 檢視 picker（filter:any, maxCount:0）+ 可不選
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-dvs.ts'); const O = join(ROOT,'.ent-dvs.mjs');
writeFileSync(E, `export { createGame } from './src/lib/game/engine';
export { openDeckViewReshuffle } from './src/lib/game/effects/_shared';
export { ATTACK_POST } from './src/lib/game/effects/_shared';
import './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, openDeckViewReshuffle, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyItem=[...pool].find(([,c])=>c.supertype==='Trainer')?.[0];
const anyBasicPoke=[...pool].find(([,c])=>c.supertype==='Pokemon'&&c.subtype==='Basic'&&!c.evolvesFrom)?.[0];
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

function mkState(deckCards, activeCid, extra={}){
  const s=createGame({name:'P1',entries:[{cardId:anyItem,count:1}]},{name:'P2',entries:[{cardId:anyItem,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:deckCards.map(c=>inst(c)), discard:[], prizes:Array.from({length:6},()=>inst(anyItem)),
        bench:[inst(anyBasicPoke)], active:activeCid?inst(activeCid,extra):inst(anyBasicPoke) },
      { ...s.players[1], hand:[], deck:[inst(anyItem)], discard:[], prizes:Array.from({length:6},()=>inst(anyItem)), bench:[], active:inst(anyBasicPoke) },
    ] };
}

// ── helper 單元 ──
T('helper: 牌庫非空 → deck-search view-picker(any, max0)', ()=>{
  const st=mkState([anyItem,anyItem]);
  const out=openDeckViewReshuffle(st, 0, '測試');
  assert(out.pendingSelection?.type==='deck-search','應開 deck-search');
  assert.equal(out.pendingSelection.filter,'any','filter=any 全牌庫');
  assert.equal(out.pendingSelection.maxCount,0,'maxCount=0 僅檢視');
  assert.equal(out.pendingSelection.effectKey,'search-to-hand-reshuffle');
});
T('helper: 牌庫全空 → 略過(無 picker)', ()=>{
  const st=mkState([]);
  const out=openDeckViewReshuffle(st, 0, '測試');
  assert(!out.pendingSelection,'空牌庫應略過');
});

// ── 代表卡 wiring：亮光增長（燈火幽靈|亮光增長）──
const zengGuang=ATTACK_POST.get('燈火幽靈|亮光增長');
assert(zengGuang,'找不到亮光增長 ATTACK_POST');
T('亮光增長: 牌庫無燈火幽靈(有其他卡) → 開檢視 picker', ()=>{
  const out=zengGuang(mkState([anyItem,anyItem,anyItem]), 0, pool);
  assert(out.pendingSelection?.type==='deck-search' && out.pendingSelection.filter==='any',
    '應開 view-picker，實際='+(out.pendingSelection?.type||'略過'));
});
T('亮光增長: 牌庫全空 → 略過', ()=>{
  const out=zengGuang(mkState([]), 0, pool);
  assert(!out.pendingSelection,'空牌庫應略過');
});

// ── 洛托呼喚 ──
const lotom=ATTACK_POST.get('洛托姆|洛托呼喚');
assert(lotom,'找不到洛托呼喚 ATTACK_POST');
T('洛托呼喚: 牌庫無洛托姆(有其他卡) → 開檢視 picker', ()=>{
  const out=lotom(mkState([anyItem,anyItem]), 0, pool);
  assert(out.pendingSelection?.type==='deck-search' && out.pendingSelection.filter==='any',
    '應開 view-picker，實際='+(out.pendingSelection?.type||'略過'));
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
