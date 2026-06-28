// v5.754:on-retreat(回備戰)特性 prompt 加 isAbilityHolderEffective gate(bench位)。
//   現有 ON_RETREAT 持有者全 Stage1 非ex → 初始化/黏著束縛都不適用(暗夜羽擊只擋active)→ 對現有卡 no-op;
//   此為 enforced 不變量(鐵律:特性套用前必查 holder-effective)+ 未來防呆。
//   故:①正常流程不破(海豚俠全能變身仍提示) ②單元證 gate 邏輯(rule-box在bench遇初始化→false)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-or.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-or.ts'); const O=join(ROOT,'.e-or.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';
export { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, isAbilityHolderEffective }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const enId=(()=>{for(const[id,c]of pool)if(c.supertype==='Energy'&&(c.subtype==='Basic'||!c.subtype))return id;})();
const anyB=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic'))return id;})();
const DOLPHIN='16686'; // 海豚俠 全能變身 Stage1
const TETSU='11581';   // 鐵荊棘ex 初始化
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('正常:海豚俠回備戰時全能變身仍提示(gate對Stage1非ex no-op)',()=>{
  const dolphin=inst(DOLPHIN,{energyAttached:[inst(enId)]}); // 1能量可撤退
  let g=createGame({name:'A',entries:[{cardId:DOLPHIN,count:1}]},{name:'B',entries:[{cardId:anyB,count:1}]},pool);
  g={...g,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...g.players[0],active:dolphin,bench:[inst(anyB)],hand:[],deck:[inst(anyB)],discard:[],prizes:[inst(anyB)]},
             {...g.players[1],active:inst(anyB),bench:[],hand:[],deck:[inst(anyB)],discard:[],prizes:[inst(anyB)]}]};
  // 撤退到 bench[0]
  const benchIid=g.players[0].bench[0].iid;
  const r=applyAction(g,{type:'RETREAT',newActiveIid:benchIid},pool);
  // 全能變身應開提示(海豚俠 Stage1 非ex,gate 不擋)
  assert.ok(r.pendingSelection,'海豚俠回備戰應提示全能變身(正常流程不破)');
});
T('單元:isAbilityHolderEffective rule-box在bench遇對手初始化→false(gate會擋)',()=>{
  const COBAL='18482'; // 勾帕路翁ex=一般 ex(非未來,會被初始化消除)
  const ruleBoxCard=pool.get(COBAL);
  const st={phase:'playing',activePlayerIndex:0,activeStadium:null,
    players:[{active:inst(COBAL),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {active:inst(TETSU),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  // ownerIdx=0 的 rule-box 在 bench;對手(idx1)有鐵荊棘ex初始化 active
  const eff=isAbilityHolderEffective(st, st.players[0].active, ruleBoxCard, 0, '金屬之路', 'bench', pool);
  assert.equal(eff, false, 'rule-box 在 bench 遇對手初始化應 false(被消除)→ gate 會擋');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);process.exit(fail?1:0);
