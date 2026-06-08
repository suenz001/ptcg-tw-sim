// 超級路卡利歐ex|波動突刺：附能量(單一+/-分配到備戰)後再造130傷害(log效果在前)。v5.508 改金屬製造者式。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-pt.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-pt.ts'); const O = join(ROOT, '.ent-pt.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const LUC='14752', WAIL='19159', ODDISH='14319', FIG='11178';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(discardFightN){
  const s=createGame({name:'P1',entries:[{cardId:LUC,count:1}]},{name:'P2',entries:[{cardId:WAIL,count:1}]},pool);
  const disc=Array.from({length:discardFightN},()=>inst(FIG));
  const bench=inst(ODDISH);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(LUC)],discard:disc,prizes:Array.from({length:6},()=>inst(LUC)),bench:[bench],active:inst(LUC,{energyAttached:[inst(FIG)]})},
             {...s.players[1],hand:[],deck:[inst(WAIL)],discard:[],prizes:Array.from({length:6},()=>inst(WAIL)),bench:[inst(WAIL)],active:inst(WAIL)}]};
  return {st, discIids:disc.map(c=>c.iid), benchIid:bench.iid};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 選2鬥能量 → +/-分配到備戰走路草 → 附2能量後造130；log效果在傷害前',()=>{
  const {st,discIids,benchIid}=mk(2);
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert(n.pendingSelection?.type==='discard-search','應開 discard-search 選能量');
  n=applyAction(n,{type:'RESOLVE_SELECTION',selectedIids:[discIids[0],discIids[1]]},pool);
  assert(n.pendingSelection?.type==='energy-distribute','選完能量應開 energy-distribute(+/-) 分配');
  n=applyAction(n,{type:'RESOLVE_SELECTION',selectedIids:[benchIid,benchIid]},pool);
  const bench=n.players[0].bench.find(c=>c.cardId===ODDISH);
  assert.equal(bench.energyAttached.length,2,'走路草應附 2 鬥能量，實際'+bench.energyAttached.length);
  assert.equal(n.players[1].active?.damage,130,'對手應受130，實際'+n.players[1].active?.damage);
  // log 順序：附能量行 在 造成傷害行 之前
  const msgs=n.log.map(l=>String(l.message));
  const attachI=msgs.findIndex(m=>m.includes('附到備戰'));
  const dmgI=msgs.findIndex(m=>m.includes('造成 130'));
  assert(attachI>=0 && dmgI>=0 && attachI<dmgI, `log應先附能量(${attachI})後傷害(${dmgI}): `+msgs.filter(m=>m.includes('波動突刺')||m.includes('造成 130')).join(' | '));
});
T('② 選0能量(略過附加) → 直接造130',()=>{
  const {st,benchIid}=mk(2);
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',selectedIids:[]},pool);
  assert.equal(n.players[1].active?.damage,130,'選0仍應造130，實際'+n.players[1].active?.damage);
  assert.equal(n.players[0].bench.find(c=>c.cardId===ODDISH).energyAttached.length,0,'未選不應附能量');
});
T('③ 棄牌區無鬥能量 → 直接造130(不開picker)',()=>{
  const {st}=mk(0);
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert(!n.pendingSelection,'棄牌區無鬥能量不應開picker');
  assert.equal(n.players[1].active?.damage,130,'仍應造130，實際'+n.players[1].active?.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
