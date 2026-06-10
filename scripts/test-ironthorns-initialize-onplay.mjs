// v5.524：鐵荊棘ex|初始化 在戰鬥場時，對手規則寶可夢(喵喵ex)上備戰的 on-play 特性「殺手鐧捕捉」應被消除。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-it2.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-it2.ts'); const O = join(ROOT, '.ent-it2.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const MEOWTH='18038', IRONTHORNS='16753';
// 找一張支援者(讓殺手鐧捕捉有目標) + 一張普通基礎當我方active/對手非鐵荊棘active
let SUPPORTER=null, PLAINBASIC=null;
for (const [id,c] of pool){ if(!SUPPORTER&&c.supertype==='Trainer'&&c.subtype==='Supporter')SUPPORTER=id;
  if(!PLAINBASIC&&c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&(c.hp>=60&&c.hp<=120)&&!(c.abilities||[]).length)PLAINBASIC=id; }
assert(SUPPORTER&&PLAINBASIC,'fixtures');
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

function mkState(oppActiveCid){
  const s=createGame({name:'P1',entries:[{cardId:PLAINBASIC,count:1}]},{name:'P2',entries:[{cardId:oppActiveCid,count:1}]},pool);
  const meowth=inst(MEOWTH);
  return {state:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:undefined,
    players:[{...s.players[0],hand:[meowth],deck:[inst(SUPPORTER),inst(SUPPORTER)],discard:[],prizes:Array.from({length:6},()=>inst(PLAINBASIC)),bench:[],active:inst(PLAINBASIC)},
             {...s.players[1],hand:[],deck:[inst(oppActiveCid)],discard:[],prizes:Array.from({length:6},()=>inst(oppActiveCid)),bench:[],active:inst(oppActiveCid)}]}, meowthIid:meowth.iid};
}

T('①★ 對手 鐵荊棘ex 在戰鬥場 → 喵喵ex 上備戰，殺手鐧捕捉【被初始化消除】(無 deck-search、未記發動)',()=>{
  const {state,meowthIid}=mkState(IRONTHORNS);
  const n=applyAction(state,{type:'PLAY_BASIC',iid:meowthIid},pool);
  assert(n.players[0].bench.some(c=>c.cardId===MEOWTH),'喵喵ex 應已上備戰');
  assert(!n.pendingSelection,'初始化下不該開任何殺手鐧捕捉提示(modal/deck-search)，實際='+JSON.stringify(n.pendingSelection?.type));
  assert(!(n.players[0].abilityNamesUsedThisTurn||[]).includes('殺手鐧捕捉'),'初始化下殺手鐧捕捉不該被記為已發動');
});

T('② 對照：對手非鐵荊棘ex → 喵喵ex 上備戰，殺手鐧捕捉【正常觸發】(開 deck-search)',()=>{
  const {state,meowthIid}=mkState(PLAINBASIC);
  const n=applyAction(state,{type:'PLAY_BASIC',iid:meowthIid},pool);
  assert(n.players[0].bench.some(c=>c.cardId===MEOWTH),'喵喵ex 應已上備戰');
  assert(!!n.pendingSelection && (n.pendingSelection.type==='modal-choice'||n.pendingSelection.type==='deck-search'),'無初始化時殺手鐧捕捉應觸發提示(modal-choice/deck-search)，實際='+JSON.stringify(n.pendingSelection?.type));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
