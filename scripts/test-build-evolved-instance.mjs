// v5.742：buildEvolvedInstance 中央進化建構 — 與 engine 正規 EVOLVE 一致(drift-lock),
//   且修各卡站漏 extraTools(丟卡)/iid/fossilOnField。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-bz.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-bz.ts'); const O=join(ROOT,'.ent-bz.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';
export { RESOLVERS, buildEvolvedInstance } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, RESOLVERS, buildEvolvedInstance }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); const evoOf=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);
    if(!byName.has(c.name))byName.set(c.name,String(c.id));
    if(c.evolvesFrom&&!evoOf.has(c.evolvesFrom))evoOf.set(c.evolvesFrom,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyId=byName.get([...byName.keys()][0]);
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// 找一對 Basic + 其進化(evolvesFrom)
let baseName=null, evoId=null;
for(const[id,c]of pool){ if(c.supertype==='Pokemon'&&c.subtype==='Stage1'&&c.evolvesFrom&&byName.has(c.evolvesFrom)){
  const bid=byName.get(c.evolvesFrom); if(pool.get(bid)?.subtype==='Basic'){evoId=id;baseName=c.evolvesFrom;break;} } }
const baseId=byName.get(baseName);

// (1) drift-lock:engine EVOLVE 結果 ≡ buildEvolvedInstance
T('drift-lock:engine 正規EVOLVE 結果與 buildEvolvedInstance 關鍵欄位一致',()=>{
  assert.ok(baseId&&evoId,'需 Basic+Stage1 配對');
  const energy=inst(anyId);
  const base=inst(baseId,{damage:30,status:'asleep',energyAttached:[energy]});
  const evoCardInst=inst(evoId);
  // 用 helper 算
  const stateForHelper={activeStadium:null};
  const h=buildEvolvedInstance(base, evoCardInst, stateForHelper, pool);
  // 驅動 engine EVOLVE
  let g=createGame({name:'A',entries:[{cardId:baseId,count:1}]},{name:'B',entries:[{cardId:baseId,count:1}]},pool);
  g={...g,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...g.players[0],active:base,bench:[],hand:[evoCardInst],deck:[inst(baseId)],discard:[],prizes:[]},
             {...g.players[1],active:inst(baseId),bench:[],hand:[],deck:[inst(baseId)],discard:[],prizes:[]}]};
  g=applyAction(g,{type:'EVOLVE',fromIid:base.iid,toIid:evoCardInst.iid},pool);
  const e=g.players[0].active;
  assert.equal(e.cardId,String(evoId),'engine 應已進化');
  // 關鍵欄位一致
  for(const k of ['cardId','iid','damage']) assert.equal(h[k],e[k],`欄位 ${k}: helper=${h[k]} engine=${e[k]}`);
  assert.equal(!!h.status, !!e.status, 'status 一致(都清除)');
  assert.equal(h.evolvedThisTurn, e.evolvedThisTurn, 'evolvedThisTurn 一致');
  assert.equal(h.fossilOnField, e.fossilOnField, 'fossilOnField 一致');
});

// (2) extraTools 保留(石居蟹覺醒,驗 HEAD 漏)
T('石居蟹覺醒:進化保留 extraTools(修丟卡)+清狀態',()=>{
  const fn=RESOLVERS.get('crab-awaken-evolve'); assert.ok(fn);
  const cb=byName.get('石居蟹'), cev=evoOf.get('石居蟹');
  if(!cb||!cev){console.log('  (無石居蟹鏈跳過)');return;}
  const tool=inst(anyId);
  const base=inst(cb,{status:'asleep',damage:20,extraTools:[tool],energyAttached:[inst(anyId)]});
  const evo=inst(cev);
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],
    players:[{name:'A',hand:[],deck:[evo],discard:[],prizes:[],bench:[],active:base},{name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};
  st=fn(st,0,[evo.iid],{},pool);
  const a=st.players[0].active;
  assert.equal(a.cardId,String(cev),'應進化');
  assert.ok(!a.status,'狀態清除');
  assert.equal((a.extraTools||[]).length,1,'extraTools 應保留(實際='+JSON.stringify(a.extraTools)+')');
  assert.equal(a.extraTools[0].iid,tool.iid,'extraTools 應為原 tool');
});

// (3) iid 穩定(進化體 iid = base.iid)
T('覺醒進化:進化體 iid = base.iid(身份穩定,修dup-iid風險)',()=>{
  const fn=RESOLVERS.get('crab-awaken-evolve');
  const cb=byName.get('石居蟹'), cev=evoOf.get('石居蟹');
  if(!cb||!cev){return;}
  const base=inst(cb); const evo=inst(cev);
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],
    players:[{name:'A',hand:[],deck:[evo],discard:[],prizes:[],bench:[],active:base},{name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};
  st=fn(st,0,[evo.iid],{},pool);
  assert.equal(st.players[0].active.iid, base.iid, '進化體應沿用 base.iid');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
