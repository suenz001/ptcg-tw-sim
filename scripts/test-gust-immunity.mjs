// v5.700 回歸測試：trainer 類「強制換對手戰鬥位(gust)」要過濾免疫的對手備戰。
//   緊張感(斧牙龍)/融合為雪(浩大鯨ex)卡面=「對手從手牌使出物品卡或支援者卡時不受影響」
//   → item 捕捉器(寶可夢捕捉器/反擊捕捉器) 與 supporter(火箭隊的坂木) 都不該把它們拉上場。
//   破口:這些 opp-bench-choose 沒帶 validIids 過濾(對照頂尖捕捉器/老大的指令已過濾)。
//   item 級=isImmuneToOppTrainer(緊張感/融合為雪);supporter 級=isImmuneToOppSupporter(+化石/廣域堡壘)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-gust.js'); writeFileSync(S,'export const base="";export const assets="";');
const E = join(ROOT,'.ent-gust.ts'); const O = join(ROOT,'.ent-gust.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const PCATCHER='10304', CCATCHER='11139', SAKAKI='12843', BOSS='10073';
const AXEW='17013' /*斧牙龍|緊張感*/, BUD='14443' /*含羞苞 Basic*/, ROCKET='12784' /*火箭隊的咩利羊 Basic*/;
let iid=0; const inst=(cid,x={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...x});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
// 自方 active/bench=活躍卡(預設含羞苞);對手 bench=[斧牙龍(緊張感), 含羞苞]
function base(trainerId, {myPrizes=1,oppPrizes=1,myActive=BUD,myBench=[BUD]}={}){
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  const axew=inst(AXEW); const oppBud=inst(BUD);
  const myBenchInst=myBench.map(c=>inst(c));
  const st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[inst(trainerId)], deck:[inst(BUD)], discard:[], prizes:Array.from({length:myPrizes},()=>inst(BUD)), active:inst(myActive), bench:myBenchInst },
      { ...s.players[1], hand:[], deck:[inst(BUD)], discard:[], prizes:Array.from({length:oppPrizes},()=>inst(BUD)), active:inst(BUD), bench:[axew, oppBud] },
    ] };
  return { st, axewIid:axew.iid, oppBudIid:oppBud.iid, myBenchInst };
}
function assertFiltered(label, ps, axewIid, oppBudIid){
  const validIids=ps?.params?.validIids;
  assert(ps && ps.type==='opp-bench-choose', `${label}: 應開啟 opp-bench-choose (實際 ${ps?.type})`);
  assert(Array.isArray(validIids), `${label}: 必須帶 params.validIids(HEAD 漏=undefined)`);
  assert(!validIids.includes(axewIid), `${label}: validIids 不該含緊張感斧牙龍(免疫)`);
  assert(validIids.includes(oppBudIid), `${label}: validIids 應含普通含羞苞`);
}
// 單段:打出 trainer 後直接開 opp gust (捕捉器/老大的指令)
function runDirect(label, trainerId, opts={}){
  const b=base(trainerId, opts);
  const hi=b.st.players[0].hand[0].iid;
  const orig=Math.random; Math.random=()=>0; // 寶可夢捕捉器擲幣正面
  let out; try{ out=applyAction(b.st,{type:'PLAY_TRAINER',iid:hi},pool); } finally { Math.random=orig; }
  assertFiltered(label, out.pendingSelection, b.axewIid, b.oppBudIid);
}
// 兩段:坂木先自換(bench-choose)→RESOLVE→opp gust
function runSakaki(label){
  const b=base(SAKAKI, {myActive:ROCKET, myBench:[ROCKET]});
  const hi=b.st.players[0].hand[0].iid;
  let out=applyAction(b.st,{type:'PLAY_TRAINER',iid:hi},pool);
  assert(out.pendingSelection?.type==='bench-choose', `${label}: 第一段應為自換 bench-choose (實際 ${out.pendingSelection?.type})`);
  const selfIid=b.myBenchInst[0].iid;
  out=applyAction(out,{type:'RESOLVE_SELECTION',selectedIids:[selfIid],actorIdx:0},pool);
  assertFiltered(label, out.pendingSelection, b.axewIid, b.oppBudIid);
}
T('寶可夢捕捉器(item,擲幣正面) → validIids 排除緊張感斧牙龍', ()=> runDirect('寶可夢捕捉器', PCATCHER));
T('反擊捕捉器(item,我方獎賞多) → validIids 排除緊張感斧牙龍', ()=> runDirect('反擊捕捉器', CCATCHER, {myPrizes:3,oppPrizes:1}));
T('火箭隊的坂木(supporter,自換後opp gust) → validIids 排除緊張感斧牙龍', ()=> runSakaki('火箭隊的坂木'));
T('【對照】老大的指令(supporter,已正確) → validIids 排除斧牙龍', ()=> runDirect('老大的指令', BOSS));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
