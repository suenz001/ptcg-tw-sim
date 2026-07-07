// v5.901 驗證：棄世猴|幽靈打擊 卡面「在對手 1 隻備戰寶可夢身上放置 5 個傷害指示物」= 招式效果(attack-effect)。
//   放指示物太晶備戰【不擋】(太晶只免疫傷害)。原用 hitBenchPickPost(attack-damage)→太晶備戰誤擋(玩家回報打不到)。
//   HEAD-FAIL：HEAD 對太晶備戰放不了(damage 0)；修後放 5 個(damage 50)。對照非太晶備戰兩版都應成功。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.fgs-s.js'), E = join(ROOT, '.fgs-e.ts'), O = join(ROOT, '.fgs-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const FUMO='19183'/*棄世猴 幽靈打擊 100+備戰放5指示物*/, TERA='10597'/*普隆隆姆ex 太晶 280HP*/, NORM='16970'/*雷吉斯奇魯ex 非太晶 230HP*/, E_PSY='11177', REGI_ACT='16970';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// P0 棄世猴(2超能量) vs P1 active + 1 隻備戰(benchCid)
function run(benchCid){
  const s=createGame({name:'A',entries:[{cardId:FUMO,count:1}]},{name:'B',entries:[{cardId:REGI_ACT,count:1}]},pool);
  const benchInst=inst(benchCid);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(FUMO)),bench:[],active:inst(FUMO,{energyAttached:[inst(E_PSY),inst(E_PSY)]})},
             {...s.players[1],hand:[],deck:[inst(REGI_ACT)],discard:[],prizes:Array.from({length:6},()=>inst(REGI_ACT)),bench:[benchInst],active:inst(REGI_ACT)}]};
  let r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  // 幽靈打擊 regPost 開 opp-bench-choose picker → 選那隻備戰
  if(r.pendingSelection){
    const pick=r.players[1].bench[0]?.iid;
    r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:r.pendingSelection.effectKey,selectedIids:[pick],actorIdx:0},pool);
  }
  return r;
}
T('① 對太晶備戰(普隆隆姆ex)放 5 個指示物 → damage 50(太晶不擋放指示物)',()=>{
  const r=run(TERA);
  const b=r.players[1].bench.find(c=>c.cardId===TERA);
  assert(b,'太晶備戰應仍在場(50<280 不KO)');
  assert.equal(b.damage,50,'應放5指示物=50,實際 '+b.damage+'(HEAD 被太晶誤擋=0→FAIL)');
});
T('② 對照:對非太晶備戰(雷吉斯奇魯ex)放 5 個 → damage 50',()=>{
  const r=run(NORM);
  const b=r.players[1].bench.find(c=>c.cardId===NORM);
  assert(b,'備戰應仍在場');
  assert.equal(b.damage,50,'應50,實際 '+b.damage);
});
console.log(`\n=== 幽靈打擊太晶備戰放指示物(v5.901): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
