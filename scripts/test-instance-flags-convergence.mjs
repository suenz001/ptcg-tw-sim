// v5.531：旗標清理收斂至 instance-flags.ts 單一來源。驗 clearActiveEffects 清全部 CLEAR_ON_EXIT_FLAGS、
//   保留身分/附加；scrubBenchStatus 只清 BENCH_SCRUB_LOCK_FLAGS(鎖)、保留 buff/受傷類。
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-if.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-if.ts'); const O = join(ROOT, '.ent-if.mjs');
writeFileSync(E, `export { clearActiveEffects } from './src/lib/game/effects/_shared';
export { CLEAR_ON_EXIT_FLAGS, BENCH_SCRUB_LOCK_FLAGS } from './src/lib/game/instance-flags';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { clearActiveEffects, CLEAR_ON_EXIT_FLAGS, BENCH_SCRUB_LOCK_FLAGS } = await import(pathToFileURL(O).href);
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① CLEAR_ON_EXIT_FLAGS=64、BENCH_SCRUB_LOCK_FLAGS=10 且為子集',()=>{
  assert.equal(CLEAR_ON_EXIT_FLAGS.length,64,'CLEAR_ON_EXIT 應 64，實際'+CLEAR_ON_EXIT_FLAGS.length);
  assert.equal(BENCH_SCRUB_LOCK_FLAGS.length,10,'SCRUB 應 10');
  for(const k of BENCH_SCRUB_LOCK_FLAGS) assert(CLEAR_ON_EXIT_FLAGS.includes(k),'子集破壞 '+k);
});

T('②★ clearActiveEffects 清除【全部】CLEAR_ON_EXIT 旗標，保留身分/附加/傷害/進化',()=>{
  // 建一個把所有 64 旗標都設真值的 instance + 身分欄位
  const inst={ iid:'x1', cardId:'9999', damage:120, energyAttached:[{iid:'e1',cardId:'14102'}],
    toolAttached:{iid:'t1',cardId:'tool'}, extraTools:[{iid:'t2',cardId:'tool2'}],
    evolvedFromStack:[{iid:'pre',cardId:'1'}], fossilOnField:true, abilityUsedThisTurn:true, justPlaced:true };
  for(const k of CLEAR_ON_EXIT_FLAGS) inst[k]= (typeof inst[k]==='undefined') ? 1 : inst[k]; // 設真值
  const out=clearActiveEffects(inst);
  for(const k of CLEAR_ON_EXIT_FLAGS) assert(out[k]===undefined,'★ 旗標 '+k+' 應被清，實際='+out[k]);
  // 身分/附加/傷害/進化/追蹤 保留
  assert.equal(out.iid,'x1'); assert.equal(out.cardId,'9999'); assert.equal(out.damage,120);
  assert.equal(out.energyAttached.length,1,'能量保留'); assert(out.toolAttached,'道具保留');
  assert.equal(out.extraTools.length,1,'extraTools 保留'); assert.equal(out.evolvedFromStack.length,1,'進化堆保留');
  assert.equal(out.fossilOnField,true,'fossilOnField 保留'); assert.equal(out.abilityUsedThisTurn,true,'特性使用標記保留');
  // ⚠ justPlaced 在 CLEAR_ON_EXIT? 不在(由 clearTurnFlags 管)→應保留
  assert.equal(out.justPlaced,true,'justPlaced 不在退場清單→保留(clearTurnFlags 管)');
});

T('③ BENCH_SCRUB_LOCK_FLAGS 全部符合「攻擊/撤退鎖」命名(無 buff/受傷類混入)',()=>{
  const LOCK=/^(cantAttack|cantRetreat|blockedAttackNames|attackFailureFlipCount|pointySpin|attackCostIncrease|retreatCostIncrease|paralyzeFang)/;
  for(const k of BENCH_SCRUB_LOCK_FLAGS) assert(LOCK.test(k),'非鎖旗標混入 scrub: '+k);
  // 確認 buff/受傷類【不在】scrub
  for(const k of ['damageBonusThisTurn','damageBonusPending','immuneToAllAttackNextTurn','takeExtraDamageThisTurn','damageReduceNextHit'])
    assert(!BENCH_SCRUB_LOCK_FLAGS.includes(k),k+' 不該在 scrub');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
