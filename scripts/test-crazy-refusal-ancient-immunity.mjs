/** v5.885 鐵毒蛾|瘋狂拒絕:下回合此卡不受「古代」寶可夢招式傷害(中央 immuneToAncientAttack*,
 *  鏡射 immuneToBasicAttack)。原 damageReduceNextHit=200 兩面錯(非古代也被減/古代>200穿)。
 *  HEAD-FAIL:HEAD 用-200,古代打30不免疫(30-200=0剛好但機制錯)+非古代也被減。此測驗:古代=0免疫、非古代=正常。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cra-s.js'), E = join(ROOT, '.cra-e.ts'), O = join(ROOT, '.cra-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const IRON='鐵毒蛾', ANC='11039', NONANC='14323', FIRE='18518', GRASS='11173';
const ironId = [...pool].find(([id,c])=>c.name===IRON)?.[0];
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass=0, fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// 攻擊者 active(古代或非古代) vs defender 鐵毒蛾(immuneToAncientAttackThisTurn)
function mk(attackerCid, energyCids) {
  const atk = inst(attackerCid); atk.energyAttached = energyCids.map(c=>inst(c));
  const def = inst(ironId, { immuneToAncientAttackThisTurn: true });
  return { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ATK',active:atk,bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
             {name:'DEF',active:def,bench:[inst(GRASS)],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}] };
}
const atkIdxOf = (cid,name)=> pool.get(cid).attacks.findIndex(a=>a.name===name);
T('★古代攻擊者(破空焰 撞倒30) → 對鐵毒蛾 0 傷(免疫)', () => {
  assert.ok(ironId,'找到鐵毒蛾');
  const out = mod.applyAction(mk(ANC,[FIRE]), { type:'ATTACK', attackIndex: atkIdxOf(ANC,'撞倒') }, pool);
  assert.equal(out.players[1].active.damage, 0, '古代招式傷害免疫→0');
  assert.ok(out.log.some(l=>(l.message||'').includes('不受「古代」')), '有免疫 log');
});
T('★非古代攻擊者(蓮葉童子 頭錘30) → 正常 30 傷(不被 -200 誤減)', () => {
  const out = mod.applyAction(mk(NONANC,[GRASS,FIRE]), { type:'ATTACK', attackIndex: atkIdxOf(NONANC,'頭錘') }, pool);
  assert.equal(out.players[1].active.damage, 30, '非古代正常造成 30(原-200會誤減為0)');
});
T('★瘋狂拒絕 regPost 設 immuneToAncientAttackNextTurn(非 damageReduceNextHit)', () => {
  const fn = mod.ATTACK_POST.get('鐵毒蛾|瘋狂拒絕');
  assert.ok(fn, '有 regPost');
  const st = { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ME',active:inst(ironId),bench:[],hand:[],deck:[],discard:[],prizes:[inst(GRASS)]},
             {name:'OP',active:inst(NONANC),bench:[],hand:[],deck:[],discard:[],prizes:[inst(GRASS)]}] };
  const out = fn(st, 0, pool, {});
  assert.equal(out.players[0].active.immuneToAncientAttackNextTurn, true, '設古代免疫旗標');
  assert.ok(!out.players[0].active.damageReduceNextHit, '不再用 -200 減傷');
});

console.log('\n瘋狂拒絕 古代免疫(v5.885):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
