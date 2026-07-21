// v5.998 ①:nextOwnAttackPenalty(受招削攻,魔法魅惑/大聲咆哮/叫聲家族)在擁有者 END_TURN 未消耗即清除。
//   卡面「在下個對手的回合…使用招式傷害-N」只限那一個對手回合;若該回合不出招,回合結束應清除,
//   不可殘留到之後回合。HEAD(無清除機制)→旗標殘留→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-np.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-np.ts'); const O=join(ROOT,'.ent-np.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const BASIC='14093'; // 時拉比(基礎)
let iid=0;const inst=(cid,e={})=>({iid:'n'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// P0 是被上個對手回合設了 nextOwnAttackPenalty 的一方;本回合(P0回合)沒攻擊就 END_TURN → 應清除
function mk(){
  const s=createGame({name:'P1',entries:[{cardId:BASIC,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:6,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),
              bench:[inst(BASIC,{nextOwnAttackPenalty:100})],active:inst(BASIC,{nextOwnAttackPenalty:100})},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
}

T('① P0 未攻擊即 END_TURN → active+備戰的 nextOwnAttackPenalty 皆清除',()=>{
  const r=applyAction(mk(),{type:'END_TURN'},pool);
  const a=r.players[0].active, b=r.players[0].bench[0];
  console.log('   END_TURN後 active penalty=',a?.nextOwnAttackPenalty,' bench penalty=',b?.nextOwnAttackPenalty);
  assert.ok(!a?.nextOwnAttackPenalty,'active nextOwnAttackPenalty 應被清除,實際='+a?.nextOwnAttackPenalty);
  assert.ok(!b?.nextOwnAttackPenalty,'備戰 nextOwnAttackPenalty 應被清除,實際='+b?.nextOwnAttackPenalty);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
