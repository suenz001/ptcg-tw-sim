// v6.006:暗碼迷的解讀 線上穩健化——原「兩步 chained deck-search + step1 從牌庫移出選中卡 +
//   把整個 CardInstance 暫存進 pending.params」(全站唯一此模式)在線上 live-room 造成客戶端卡在
//   picker(選不了卡/當掉→閒置判負;CSD子龍 vs 大吾 R2 dump 佐證:伺服器已解完、finalState 無殘留
//   pending,客戶端 desync 卡死)。改為單一 deck-search 一次選 2 張,單一 RESOLVE 完成、依選取序放回
//   牌庫上方(先選=上方第2位、後選=最上方)、其餘重洗。無 chained pending、不中途移卡、不暫存 CardInstance。
//   HEAD:①開 pending effectKey='cipher-geek-pick-second'(非 arrange-top) ②RESOLVE 後仍有第二個
//   pending(cipher-geek-pick-top) → 兩斷言皆 FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.cg-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.cg-e.ts'); const O=join(ROOT,'.cg-o.mjs');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nexport { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, TRAINER_EFFECTS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0;const inst=(cid)=>({iid:'g'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
function allIids(state){const out=[];for(const p of state.players){for(const c of [p.active,...(p.bench||[]),...(p.hand||[]),...(p.deck||[]),...(p.discard||[]),...(p.prizes||[])]){if(!c)continue;out.push(c.iid);for(const e of (c.energyAttached||[]))out.push(e.iid);}}return out;}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// 牌庫 5 張(a..e);打出暗碼迷 → 應開單一 deck-search(min/max=2, effectKey=cipher-geek-arrange-top)
const A=inst('14093'),B=inst('14103'),C=inst('14102'),D=inst('14430'),Ecard=inst('14087');
function mk(){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,pendingChainQueue:undefined,setupDone:[true,true],pendingPrizes:[0,0],
    players:[{name:'P0',active:inst('14093'),bench:[],hand:[],deck:[A,B,C,D,Ecard],discard:[],prizes:[]},
             {name:'P1',active:inst('14093'),bench:[],hand:[],deck:[inst('14093')],discard:[],prizes:[]}]};
}

T('① 打出暗碼迷 → 單一 deck-search(min=max=2, effectKey=cipher-geek-arrange-top)',()=>{
  const st=mk();
  const out=TRAINER_EFFECTS.get('暗碼迷的解讀')(st,0,pool);
  const ps=out.pendingSelection;
  console.log('   pending effectKey=',ps?.effectKey,'min=',ps?.minCount,'max=',ps?.maxCount,'type=',ps?.type);
  assert.equal(ps?.effectKey,'cipher-geek-arrange-top','應為單步 arrange-top(HEAD 為兩步 cipher-geek-pick-second)');
  assert.equal(ps?.minCount,2,'應一次選 2 張');
  assert.equal(ps?.maxCount,2,'應一次選 2 張');
});

T('② 單一 RESOLVE 選 [A,B] → 無殘留 pending + 牌庫頂=[B,A,...]（後選 B 最上方、先選 A 第2位）+ 不掉卡',()=>{
  let st=mk();
  const before=allIids(st).length;
  st=TRAINER_EFFECTS.get('暗碼迷的解讀')(st,0,pool);
  // 依點選序 A 先、B 後
  const out=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[A.iid,B.iid]},pool);
  const after=allIids(out).length;
  const d=out.players[0].deck;
  console.log('   after pending=',out.pendingSelection?.effectKey??'null','| deckTop=',d.slice(0,2).map(c=>c.iid),'| total',before,'->',after);
  assert.ok(!out.pendingSelection,'單步應無殘留 pending(HEAD 兩步→仍有 cipher-geek-pick-top)');
  assert.equal(after,before,'總卡數守恆(不可能掉卡)');
  assert.equal(d.length,5,'牌庫仍 5 張');
  assert.equal(d[0].iid,B.iid,'後選 B 應在最上方');
  assert.equal(d[1].iid,A.iid,'先選 A 應在上方第 2 位');
  // 其餘 3 張(C/D/E)在底部(順序被重洗,只驗集合)
  const restSet=new Set(d.slice(2).map(c=>c.iid));
  assert.ok(restSet.has(C.iid)&&restSet.has(D.iid)&&restSet.has(Ecard.iid),'其餘 3 張應在牌庫底(重洗)');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
