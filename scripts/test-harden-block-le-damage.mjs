/** v5.886 石丸子/鐵甲蛹|變硬「下個對手回合不受 N 以下招式的傷害」= 最終傷害≤N歸0、>N全額。
 *  原 damageReduceNextHit=N 對 >N 傷害誤減(-N)。中央 blockAttackDamageIfLTE*(鏡射免疫旗標)。
 *  HEAD-FAIL:HEAD 60傷被-40=20(誤減)、regPost 設 damageReduceNextHit 非新旗標。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.hb-s.js'), E = join(ROOT, '.hb-e.ts'), O = join(ROOT, '.hb-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const STONE='13817', RESHI='14335', HEATMOR='16591', FIRE='18518', GRASS='11173';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass=0, fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function mk(attackerCid, energyCids) {
  const atk = inst(attackerCid); atk.energyAttached = energyCids.map(c=>inst(c));
  const def = inst(STONE, { blockAttackDamageIfLTEThisTurn: 40 });
  return { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ATK',active:atk,bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
             {name:'DEF',active:def,bench:[inst(GRASS)],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}] };
}
const ai=(cid,name)=>pool.get(cid).attacks.findIndex(a=>a.name===name);
T('★30傷(≤40) → 0 免傷', () => {
  const out = mod.applyAction(mk(RESHI,[FIRE]), { type:'ATTACK', attackIndex: ai(RESHI,'烈焰') }, pool);
  assert.equal(out.players[1].active.damage, 0, '30≤40 → 0');
});
T('★60傷(>40) → 全額 60(不被誤減 -40 成 20)', () => {
  const out = mod.applyAction(mk(HEATMOR,[FIRE,FIRE]), { type:'ATTACK', attackIndex: ai(HEATMOR,'火之爪') }, pool);
  assert.equal(out.players[1].active.damage, 60, '60>40 → 全額 60(HEAD 會 -40=20)');
});
T('★石丸子|變硬 regPost 設 blockAttackDamageIfLTENextTurn=40(非 damageReduceNextHit)', () => {
  const fn = mod.ATTACK_POST.get('石丸子|變硬');
  const st = { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ME',active:inst(STONE),bench:[],hand:[],deck:[],discard:[],prizes:[inst(GRASS)]},
             {name:'OP',active:inst(RESHI),bench:[],hand:[],deck:[],discard:[],prizes:[inst(GRASS)]}] };
  const out = fn(st, 0, pool, {});
  assert.equal(out.players[0].active.blockAttackDamageIfLTENextTurn, 40, '設新旗標=40');
  assert.ok(!out.players[0].active.damageReduceNextHit, '不再用 damageReduceNextHit');
});
console.log('\n變硬條件免傷(v5.886):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
