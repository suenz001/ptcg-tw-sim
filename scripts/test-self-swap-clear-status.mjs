/**
 * 自身互換(將這隻寶可夢與備戰互換)時，退到備戰的舊 active 須 clearActiveEffects(v5.790)
 * h-wave2-self-swap(遠古巨蜓陀螺音波/大電海燕ex迴旋充能/狡兔三窟/內部噴射)原直接 push 舊 active
 * → 中毒/灼傷/睡眠等殘留備戰。驗:互換後備戰上的舊 active 無 status。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sc-s.js'), E = join(ROOT, '.sc-e.ts'), O = join(ROOT, '.sc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const TORNADOS='11112' /*遠古巨蜓陀螺音波*/, BIG='14335', ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(attackerCid, statusObj) {
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{name:'P1',active:inst(attackerCid,statusObj),bench:[inst(BIG)],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
             {name:'P2',active:inst(BIG),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]};
}
const RESOLVE=(iids)=>({type:'RESOLVE_SELECTION',selectedIids:iids});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

function swapDemoted(extra) {
  const st=mk(TORNADOS, extra);
  const opened=ATTACK_POST.get('遠古巨蜓|陀螺音波')(st,0,pool,{});
  assert.ok(opened.pendingSelection,'應開 bench-choose');
  const benchIid=opened.players[0].bench[0].iid;
  const out=applyAction(opened, RESOLVE([benchIid]), pool);
  assert.equal(out.players[0].active.cardId, BIG, '新 active 應為原備戰');
  return out.players[0].bench.find(b=>b.cardId===TORNADOS);
}
T('★陀螺音波:減傷buff(damageReduceNextHit)互換→退場備戰清除', () => {
  const d=swapDemoted({ damageReduceNextHit: 30 });
  assert.ok(d, '退場陀螺音波在備戰');
  assert.ok(!d.damageReduceNextHit, 'damageReduceNextHit 應清除(HEAD scrub不清RECEIVE→殘留)');
});
T('★陀螺音波:招式效果免疫(immuneToAttackEffectsThisTurn)互換→退場清除', () => {
  const d=swapDemoted({ immuneToAttackEffectsThisTurn: true });
  assert.ok(!d.immuneToAttackEffectsThisTurn, '免疫旗標應清除(HEAD 殘留)');
});
T('陀螺音波:狀態(中毒)互換→退場無中毒(本就被sweep,確認不回歸)', () => {
  const d=swapDemoted({ status:'asleep', secondaryStatus:'poisoned' });
  assert.ok(!d.status && !d.secondaryStatus, '狀態應無');
});

console.log('\n自身互換退場清狀態(v5.790):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
