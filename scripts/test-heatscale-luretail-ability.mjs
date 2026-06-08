// 熱浪鱗粉(火神蛾)/誘導之尾(超能妙喵) v5.510 改為寶可夢上的 regA 啟動特性(碧綠之舞 pattern)。
//   發動時自動丟手牌資源(基本火能量/悠哉尾草棒)+執行效果；按鈕 gate 在 getUsableAbilities。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-hl.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-hl.ts'); const O = join(ROOT, '.ent-hl.mjs');
writeFileSync(E, `export { createGame, applyAction, getUsableAbilities } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getUsableAbilities } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const VOLC='16595' /*火神蛾 熱浪鱗粉*/, ESPUR='16803' /*超能妙喵 誘導之尾*/, FIRE='18518', SLOW='17120' /*悠哉尾草棒*/, DEF='19159', OPPB='14319';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(activeId, hand, oppActiveStatus=undefined, oppBench=[]){
  const s=createGame({name:'P1',entries:[{cardId:activeId,count:1}]},{name:'P2',entries:[{cardId:DEF,count:1}]},pool);
  const myActive=inst(activeId,{energyAttached:[inst(FIRE)]});
  return {st:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand,deck:[inst(activeId)],discard:[],prizes:Array.from({length:6},()=>inst(activeId)),bench:[inst(activeId)],active:myActive},
             {...s.players[1],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),bench:oppBench.length?oppBench:[inst(DEF)],active:inst(DEF,oppActiveStatus?{status:oppActiveStatus}:{})}]},
    activeIid:myActive.iid};
}
const hasAbil=(st,name)=>JSON.stringify(getUsableAbilities(st,pool)).includes(name);
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 熱浪鱗粉按鈕在寶可夢上(getUsableAbilities)：火神蛾active+手牌火能量+對手非灼傷',()=>{
  const fire=inst(FIRE); const {st}=mk(VOLC,[fire]);
  assert(hasAbil(st,'熱浪鱗粉'),'應顯示熱浪鱗粉按鈕(在寶可夢上)');
});
T('②★ USE_ABILITY 火神蛾 → 自動丟手牌火能量 + 對手灼傷',()=>{
  const fire=inst(FIRE); const {st,activeIid}=mk(VOLC,[fire]);
  const n=applyAction(st,{type:'USE_ABILITY',iid:activeIid,abilityIndex:0},pool);
  assert.equal(n.players[1].active?.status,'burned','對手 active 應灼傷');
  assert(n.players[0].discard.some(c=>c.iid===fire.iid),'火能量應從手牌丟到棄牌');
  assert(!n.players[0].hand.some(c=>c.iid===fire.iid),'手牌應已無該火能量');
});
T('③ 手牌無火能量 → 不顯示按鈕',()=>{
  const {st}=mk(VOLC,[inst(OPPB)]); // 手牌放非能量
  assert(!hasAbil(st,'熱浪鱗粉'),'無火能量不應顯示');
});
T('④ 對手已灼傷 → 不顯示按鈕',()=>{
  const {st}=mk(VOLC,[inst(FIRE)],'burned');
  assert(!hasAbil(st,'熱浪鱗粉'),'對手已灼傷不應顯示');
});
T('⑤★ 誘導之尾按鈕在寶可夢上+USE_ABILITY自動丟悠哉尾草棒並開互換picker',()=>{
  const slow=inst(SLOW); const {st,activeIid}=mk(ESPUR,[slow],undefined,[inst(DEF),inst(OPPB)]);
  assert(hasAbil(st,'誘導之尾'),'應顯示誘導之尾按鈕');
  const n=applyAction(st,{type:'USE_ABILITY',iid:activeIid,abilityIndex:0},pool);
  assert(n.players[0].discard.some(c=>c.iid===slow.iid),'悠哉尾草棒應丟到棄牌');
  assert(n.pendingSelection,'應開對手備戰互換 picker');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
