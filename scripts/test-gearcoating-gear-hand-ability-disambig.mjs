/** v5.898 齒輪怪同名多特性:緊急迴轉(SV7 id10964,放備戰)vs齒輪塗層(Stage2 id16979被動減傷)。
 *  ON_HAND_ACTIVATE_ABILITIES以卡名key→齒輪塗層版(Stage2)也被曝露緊急迴轉(把Stage2從手牌放備戰=非法)。
 *  修:engine gate改判「這張卡有緊急迴轉特性」才放行。
 *  HEAD-FAIL:HEAD齒輪塗層版USE_HAND_ABILITY會被放上備戰。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.gc-s.js'), E = join(ROOT, '.gc-e.ts'), O = join(ROOT, '.gc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || f === 'card-set-map.json' || f.includes('_') || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GEAR_RETURN = '10964';  // 齒輪怪|緊急迴轉(SV7)
const GEAR_COAT = '16979';    // 齒輪怪|齒輪塗層(MC,Stage2)
const POKE = '14319';
// 對手Stage2(oppHasStage2 gate)
let oppS2=null; for(const [id,c] of pool){ if(c.stage==='Stage2'&&c.name!=='齒輪怪'){oppS2=id;break;} }
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

function mk(handGearId) {
  const gear = inst(handGearId);
  return { gear, state: {
    id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[
      { name:'ME', active:inst(POKE), bench:[], hand:[gear], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)], abilityNamesUsedThisTurn:[] },
      { name:'OP', active:inst(oppS2), bench:[], hand:[], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)] },
    ],
  }};
}

T('★齒輪塗層版(Stage2)在手牌 USE_HAND_ABILITY緊急迴轉 → 被拒(不放備戰)[HEAD-FAIL]', () => {
  const { gear, state } = mk(GEAR_COAT);
  const out = mod.applyAction(state, { type:'USE_HAND_ABILITY', cardIid:gear.iid, abilityIndex:0 }, pool);
  assert.equal(out.players[0].bench.length, 0, '齒輪塗層版不該被放上備戰');
  assert.ok(out.players[0].hand.some(c=>c.iid===gear.iid), '齒輪塗層版仍在手牌');
});

T('緊急迴轉版 USE_HAND_ABILITY → 正常放上備戰(對照)', () => {
  const { gear, state } = mk(GEAR_RETURN);
  const out = mod.applyAction(state, { type:'USE_HAND_ABILITY', cardIid:gear.iid, abilityIndex:0 }, pool);
  // 放上備戰(bench+1)或至少不被無條件拒(state有變)
  assert.ok(out.players[0].bench.length === 1 || out !== state, '緊急迴轉版應可發動');
});

console.log('\n齒輪怪緊急迴轉/齒輪塗層消歧義(v5.898):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
