// 土龍節節|逃跑抽出 官方QA:牌庫0不可用。getUsableAbilities不列+USE_ABILITY拒絕;牌庫≥1可用。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-ed.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-ed.ts'); const O = join(ROOT, '.ent-ed.mjs');
writeFileSync(E, `export { createGame, applyAction, getUsableAbilities } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getUsableAbilities } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const TURTLE='9827'/*土龍節節 逃跑抽出*/, EN='18520';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function base(deck){
  const s=createGame({name:'P1',entries:[{cardId:TURTLE,count:1}]},{name:'P2',entries:[{cardId:TURTLE,count:1}]},pool);
  const tur=inst(TURTLE);
  return {state:{...s,phase:'playing',turnPhase:'main',turn:2,activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck,discard:[],prizes:Array.from({length:6},()=>inst(TURTLE)),bench:[],active:tur},
             {...s.players[1],hand:[],deck:[inst(TURTLE)],discard:[],prizes:Array.from({length:6},()=>inst(TURTLE)),bench:[],active:inst(TURTLE)}]}, tur};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 牌庫0：getUsableAbilities 不列逃跑抽出',()=>{
  const {state}=base([]); // 空牌庫
  const ab=getUsableAbilities(state,pool);
  assert(!ab.some(a=>a.abilityName==='逃跑抽出'),'牌庫0不該列逃跑抽出，實際='+JSON.stringify(ab.map(a=>a.abilityName)));
});
T('②★ 牌庫0：USE_ABILITY 拒絕(state不變,特性沒發動)',()=>{
  const {state,tur}=base([]);
  const n=applyAction(state,{type:'USE_ABILITY',iid:tur.iid,abilityIndex:0},pool);
  assert(n.players[0].active && n.players[0].active.iid===tur.iid,'土龍節節應仍在場(特性沒發動回牌庫)');
  assert.equal(n.players[0].hand.length,0,'牌庫0不該抽到牌');
});
T('③ 牌庫≥1：getUsableAbilities 有列 + USE_ABILITY 可發動',()=>{
  const {state,tur}=base([inst(EN),inst(EN),inst(EN),inst(EN)]); // 4張
  const ab=getUsableAbilities(state,pool);
  assert(ab.some(a=>a.abilityName==='逃跑抽出'),'牌庫≥1應列逃跑抽出');
  const n=applyAction(state,{type:'USE_ABILITY',iid:tur.iid,abilityIndex:0},pool);
  assert.equal(n.players[0].hand.length,3,'應抽3張，實際'+n.players[0].hand.length);
  assert(!n.players[0].active || n.players[0].active.iid!==tur.iid,'土龍節節應回牌庫(active清空或換)');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
