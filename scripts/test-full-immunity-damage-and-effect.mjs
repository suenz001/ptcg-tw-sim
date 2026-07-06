/** v5.888 卡面「不會受到招式的傷害與效果的影響」的完全免疫卡,須用中央 immuneToAllAttackNextTurn
 *  (engine 同時擋傷害+POST效果),非 damageReduceNextHit:999(只擋傷害→狀態/換位等效果會漏)。
 *  修:變隱龍|隱形攻擊、托戈德瑪爾|尖刺電光(v2740 coinHeadsImmunePost)、小灰怪|躲藏(inline)。
 *  HEAD-FAIL:HEAD 這3卡設 damageReduceNextHit:999,且 immuneToAllAttack 才擋效果、999不擋。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.fi-s.js'), E = join(ROOT, '.fi-e.ts'), O = join(ROOT, '.fi-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const SKORUPI='14361', POKE='14319', FIGHT='11178', GRASS='11173';
const idOf = n => [...pool].find(([id,c])=>c.name===n)?.[0];
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass=0, fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const heads = () => { const o=Math.random; Math.random=()=>0; return ()=>{Math.random=o;}; };

// A) 3 卡 regPost 設 immuneToAllAttackNextTurn(非 damageReduceNextHit)
for (const [card, atk] of [['變隱龍','隱形攻擊'],['托戈德瑪爾','尖刺電光'],['小灰怪','躲藏']]) {
  T(`★${card}|${atk} 擲正面 → 設 immuneToAllAttackNextTurn(非 999 減傷)`, () => {
    const fn = mod.ATTACK_POST.get(`${card}|${atk}`);
    assert.ok(fn, `${card} 有 regPost`);
    const st = { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
      players:[{name:'ME',active:inst(idOf(card)),bench:[],hand:[],deck:[],discard:[],prizes:[inst(GRASS)]},
               {name:'OP',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[inst(GRASS)]}] };
    const r = heads();
    const out = fn(st, 0, pool, {});
    r();
    assert.equal(out.players[0].active.immuneToAllAttackNextTurn, true, '設完全免疫旗標');
    assert.ok(!out.players[0].active.damageReduceNextHit, '不再用 999 減傷');
  });
}

// B) 整合:defender 有 immuneToAllAttackThisTurn → 對手毒招 → 傷害0 且不中毒(效果也擋)
T('★immuneToAllAttack → 對手毒招:傷害0 且不中毒(效果被擋,非只擋傷害)', () => {
  const atk = inst(SKORUPI); atk.energyAttached=[inst(FIGHT)];
  const def = inst(POKE, { immuneToAllAttackThisTurn: true });
  const st = { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ATK',active:atk,bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
             {name:'DEF',active:def,bench:[inst(GRASS)],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}] };
  const ai = pool.get(SKORUPI).attacks.findIndex(a=>a.name==='毒擊');
  const out = mod.applyAction(st, { type:'ATTACK', attackIndex: ai }, pool);
  assert.equal(out.players[1].active.damage, 0, '傷害免疫→0');
  const st1 = out.players[1].active;
  const noPoison = st1.status !== 'poisoned' && st1.secondaryStatus !== 'poisoned' && st1.tertiaryStatus !== 'poisoned';
  assert.ok(noPoison, '中毒效果也被免疫(immuneToAllAttack 擋效果;若用999則會中毒)');
});
console.log('\n完全免疫傷害與效果(v5.888):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
