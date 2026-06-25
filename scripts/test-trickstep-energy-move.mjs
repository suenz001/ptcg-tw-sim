// v5.717 回歸:耿鬼ex/超能妙喵 戲法舞步「對手戰鬥能量改附對手備戰」。
//   原耿鬼ex trick-step-energy(stage1先移除)+trick-step-dst(stage2從已移除active找→undefined→return)
//   → 能量從對手戰鬥場消失、沒附到備戰(玩家回報)。修:pick不移除+attach一步移除+附。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-ts.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-ts.ts'); const O = join(ROOT, '.ent-ts.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';\nexport { activeEnergyDiscardCandidates } from './src/lib/game/selection-candidates';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { applyAction, activeEnergyDiscardCandidates } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const GENGAR='16916', DARK='11179', WATER='18519', BUD='14443', WAILORD='19159';
let nn=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});

let pass=0, fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('戲法舞步:對手戰鬥能量移到對手備戰(能量不消失) [驗HEAD消失FAIL]', () => {
  const oppWater = en(WATER);
  const oppActive = inst(WAILORD,[oppWater]); // 吼鯨王HP380 不被160KO,保留能量可移
  const oppBench = inst(BUD);
  const st = {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
    players:[
      { name:'P1', active:inst(GENGAR,[en(DARK),en(DARK)]), bench:[inst(BUD)], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD)] },
      { name:'P2', active:oppActive, bench:[oppBench], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD)] },
    ],
  };
  // ATTACK atk[0] 戲法舞步(不帶 discardedEnergyIids → 預設發動)
  let out = applyAction(st, { type:'ATTACK', attackIndex:0 }, pool);
  assert(out.pendingSelection, `ATTACK 後應開能量 picker(實 ${out.pendingSelection?.type})`);
  assert.equal(out.pendingSelection.type, 'active-energy-discard');
  // ★ v5.718：把 engine 產生的 picker params 餵給前端候選函式,確認玩家「選得到」能量(非空)。
  //   原誤傳 targetIid=對手active → 候選空 → 玩家連能量都選不到(本斷言鎖住)。
  const _cand = activeEnergyDiscardCandidates(out.pendingSelection.params, out.players[1]);
  assert(_cand.length >= 1, `戲法舞步 picker 應列出對手戰鬥位能量(玩家選得到),實候選數 ${_cand.length}`);
  assert(_cand.some(e => e.iid === oppWater.iid), '對手戰鬥位的水能量應在可選候選中');
  // 選對手戰鬥能量
  out = applyAction(out, { type:'RESOLVE_SELECTION', selectedIids:[oppWater.iid] }, pool);
  assert(out.pendingSelection, `選能量後應開 bench-choose(實 ${out.pendingSelection?.type})`);
  assert.equal(out.pendingSelection.type, 'bench-choose');
  // 選對手備戰目標
  out = applyAction(out, { type:'RESOLVE_SELECTION', selectedIids:[oppBench.iid] }, pool);
  // 驗證:對手 active 能量 -1, 對手 bench 目標 +1(能量沒消失)
  const oppA = out.players[1].active;
  const oppB = out.players[1].bench.find(b=>b.iid===oppBench.iid);
  console.log('   對手active能量:', oppA?.energyAttached.length, '| 備戰目標能量:', oppB?.energyAttached.length,
    '| 能量去向:', oppB?.energyAttached.some(e=>e.iid===oppWater.iid) ? '✓在備戰' : '✗消失');
  assert.equal(oppA?.energyAttached.length, 0, '對手戰鬥位能量應 -1(=0)');
  assert.equal(oppB?.energyAttached.length, 1, '對手備戰目標應 +1(=1,能量沒消失)');
  assert(oppB?.energyAttached.some(e=>e.iid===oppWater.iid), '移動的能量應在備戰目標身上');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
