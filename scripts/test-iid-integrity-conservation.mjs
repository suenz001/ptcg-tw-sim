// v6.011（Fable P1-3）:卡片守恆不變式 assertIidIntegrity——收集雙方所有 zone 的 iid,斷言
//   (1) 全域無重複 iid、(2) 每方總張數守恆。含 picker 的招式/訓練家若把卡「移出 zone 只存 pending.params
//   的 limbo」(v6.006 暗碼迷舊兩步結構),中途就會少 1 張 → 立刻現形。此測試驅動幾個歷史上有
//   limbo/dup 風險的流程(deck-search 2選/含 picker 附能),逐步斷言守恆。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.ii-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ii-e.ts'); const O=join(ROOT,'.ii-o.mjs');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nexport { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, TRAINER_EFFECTS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

// ── 可重用守恆 helper ────────────────────────────────────────────────
function collectIids(pl){
  const out=[];
  const push=c=>{ if(!c)return; out.push(c.iid);
    for(const e of (c.energyAttached||[]))out.push(e.iid);
    for(const t of (c.toolAttached?[c.toolAttached]:[]))out.push(t.iid);
    for(const t of (c.extraTools||[]))out.push(t.iid);
    for(const s of (c.evolvedFromStack||[]))out.push(s.iid);
  };
  push(pl.active);
  for(const b of (pl.bench||[]))push(b);
  for(const z of ['hand','deck','discard','prizes']) for(const c of (pl[z]||[])) if(c&&c.iid) out.push(c.iid);
  return out;
}
function assertIidIntegrity(state, expectPerPlayer, tag){
  const all=[];
  const counts=[];
  for(const pl of state.players){ const ids=collectIids(pl); counts.push(ids.length); all.push(...ids); }
  // (1) 全域無重複 iid
  const dup=all.length!==new Set(all).size;
  assert.ok(!dup, `${tag}: 發現重複 iid(複製卡/dup)`);
  // (2) 每方總張數守恆
  if(expectPerPlayer){ state.players.forEach((_,i)=>{ assert.equal(counts[i],expectPerPlayer[i],`${tag}: P${i} 張數 ${counts[i]}!=${expectPerPlayer[i]}(卡進 limbo/掉卡?)`); }); }
  return counts;
}

let nn=0;const inst=(cid)=>({iid:'k'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('暗碼迷的解讀 deck-search 2選 全程守恆(無 limbo/dup)',()=>{
  const hand=[inst('17169')]; // 暗碼迷的解讀
  const deck=Array.from({length:6},()=>inst('14093'));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],
    players:[{name:'P0',active:inst('14093'),bench:[],hand,deck,discard:[],prizes:Array.from({length:6},()=>inst('14093'))},
             {name:'P1',active:inst('14093'),bench:[],hand:[],deck:[inst('14093')],discard:[],prizes:Array.from({length:6},()=>inst('14093'))}]};
  const base=assertIidIntegrity(st,null,'開局');
  // 開 pending
  let s=TRAINER_EFFECTS.get('暗碼迷的解讀')(st,0,pool);
  assertIidIntegrity(s,base,'開pending(卡不可移出zone進limbo)'); // ★關鍵:舊兩步結構這裡就會少1張
  // resolve 選 2 張
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[s.players[0].deck[0].iid,s.players[0].deck[1].iid]},pool);
  assertIidIntegrity(s,base,'resolve後');
  assert.ok(!s.pendingSelection,'應無殘留 pending');
});

T('惡意超量/重複 selectedIids 經中央閘後仍守恆',()=>{
  const hand=[inst('17169')];
  const A=inst('14093'),B=inst('14103'),C=inst('14102'),D=inst('14430'),Ecard=inst('14087');
  const deck=[A,B,C,D,Ecard];
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],
    players:[{name:'P0',active:inst('14093'),bench:[],hand,deck,discard:[],prizes:Array.from({length:6},()=>inst('14093'))},
             {name:'P1',active:inst('14093'),bench:[],hand:[],deck:[inst('14093')],discard:[],prizes:Array.from({length:6},()=>inst('14093'))}]};
  const base=assertIidIntegrity(st,null,'開局2');
  let s=TRAINER_EFFECTS.get('暗碼迷的解讀')(st,0,pool);
  // 惡意:傳整副+重複
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[A.iid,A.iid,B.iid,C.iid,D.iid,Ecard.iid]},pool);
  assertIidIntegrity(s,base,'惡意payload resolve後');
  assert.equal(s.players[0].deck.length,5,'牌庫仍5張(無複製)');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
