/**
 * 激流水泵（厄鬼椪 水井面具ex）— 放回能量觸發備戰 120 的「放回張數」收斂（v5.653）
 * 官方 QA：附 2 能量 + 璀璨結晶（太晶 -1 費），放回 2 個能量也能對備戰造成 120。
 * 正解：required = min(3, 身上能量總單位)；璀璨結晶只減使用招式費用、不改放回張數。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.hp-s.js'), E = join(ROOT, '.hp-e.ts'), O = join(ROOT, '.hp-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GEN = '16695', CRYSTAL = '17151', W = '18519', DEF = '13163';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(DEF));
function mk(nWater, withCrystal) {
  const s = createGame({ name: 'P1', entries: [{ cardId: GEN, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const energies = Array.from({ length: nWater }, () => inst(W));
  const gen = inst(GEN, { energyAttached: energies, ...(withCrystal ? { toolAttached: inst(CRYSTAL) } : {}) });
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(W)], discard: [], prizes: prize(6), bench: [], active: gen },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: prize(6), bench: [inst(DEF)], active: inst(DEF) }] };
  return { st, energies };
}
function attack(st, discardedIids) {
  let out = applyAction(st, { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: discardedIids }, pool);
  if (out.pendingSelection && out.pendingSelection.type === 'opp-bench-choose') {
    const b0 = out.players[1].bench[0] && out.players[1].bench[0].iid;
    out = applyAction(out, { type: 'RESOLVE_SELECTION', effectKey: out.pendingSelection.effectKey, selectedIids: [b0], actorIdx: 0 }, pool);
  }
  return out;
}
const benchDmg = (out) => (out.players[1].bench[0] && out.players[1].bench[0].damage) || 0;
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('QA: crystal + 2 water, return 2 -> bench 120', () => {
  const { st, energies } = mk(2, true);
  assert.equal(benchDmg(attack(st, energies.map(e => e.iid))), 120);
});
T('FIX: crystal + 3 water, return only 2 -> NO bench (need 3)', () => {
  const { st, energies } = mk(3, true);
  assert.equal(benchDmg(attack(st, energies.slice(0, 2).map(e => e.iid))), 0);
});
T('crystal + 3 water, return 3 -> bench 120', () => {
  const { st, energies } = mk(3, true);
  assert.equal(benchDmg(attack(st, energies.map(e => e.iid))), 120);
});
T('no crystal + 3 water, return 3 -> bench 120 (baseline)', () => {
  const { st, energies } = mk(3, false);
  assert.equal(benchDmg(attack(st, energies.map(e => e.iid))), 120);
});
T('return 0 -> no bench', () => {
  const { st } = mk(3, false);
  assert.equal(benchDmg(attack(st, [])), 0);
});
console.log('\n激流水泵放回張數收斂：PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
