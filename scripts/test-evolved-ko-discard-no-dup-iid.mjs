// 兮雪卡死根因:進化體被KO棄牌時,頂層卡保留 evolvedFromStack(巢狀基底)+基底又spread成扁平棄牌卡
//   →棄牌堆同一基底兩份同iid;取回扁平那份上場→與棄牌巢狀那份iid碰撞→each_key_duplicate客戶端卡死。
//   修:KO棄牌頂層卡須 bare(清 evolvedFromStack)。本測試:KO進化體後棄牌堆不該有重複iid。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-ed.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-ed.ts'); const O=join(ROOT,'.ent-ed.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0;const inst=(cid,e={})=>({iid:`t${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function allIids(pl){
  const out=[]; const c=(x,z)=>{ if(!x)return; out.push(x.iid);
    for(const e of (x.energyAttached||[]))out.push(e.iid);
    for(const t of (x.extraTools||[]))out.push(t.iid); if(x.toolAttached)out.push(x.toolAttached.iid);
    for(const s of (x.evolvedFromStack||[]))out.push(s.iid); };
  c(pl.active,'a'); for(const b of pl.bench)c(b,'b'); for(const d of pl.discard||[])c(d,'d');
  return out;
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const GARC='12702', SHARK='14749'/*竹蘭烈咬陸鯊ex 攻擊方*/;
// 進化體:base 18523 → 18524,active=18524 帶 evolvedFromStack[base 18523(_base_ iid)]
function setupKO(){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:'18523',count:1}]},pool);
  const baseIid='zzz';
  const evolvedActive={iid:baseIid,cardId:'18524',damage:60,energyAttached:[],
    evolvedFromStack:[{iid:`${baseIid}_base_18523_abc`,cardId:'18523',damage:0,energyAttached:[]}]};
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(GARC)],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[],active:inst('10229',{energyAttached:[inst('14143'),inst('14143'),inst('14143')]})},
             {...s.players[1],hand:[],deck:[inst('18523')],discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[inst(GARC)],active:evolvedActive}]};
}
T('進化體被效果KO後,棄牌堆無重複iid(基底不該巢狀+扁平兩份)',()=>{
  let r=setupKO();
  // 直接給致命傷+sweep:用 applyAction END_TURN 觸發? 改用攻擊。巨金怪10229招式打死18524
  // 簡化:設 active damage>=HP 後跑任一 applyAction 讓 sanityKOSweep 收
  r.players[1].active.damage=999;
  r=applyAction(r,{type:'ATTACK',attackIndex:0},pool); // 觸發引擎處理(內含sweep)
  const ids=allIids(r.players[1]);
  const dup=ids.filter((x,i)=>ids.indexOf(x)!==i);
  console.log('   p2 全iid數='+ids.length+' 重複='+JSON.stringify([...new Set(dup)]));
  assert.equal(dup.length,0,'不該有重複iid,實際重複='+JSON.stringify([...new Set(dup)]));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
