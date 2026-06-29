import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dt-s.js'), E = join(ROOT, '.dt-e.ts'), O = join(ROOT, '.dt-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const WILLDUN = '14086', TOOL_A = '14089', TOOL_B = '14467', ENERGY = '14102';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));
function mk(defActive) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    players: [
      { name: 'P1', active: inst(WILLDUN), bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: defActive, bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ] };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
T('★削落:對手2道具→全數丟棄', () => {
  const t1 = { iid: 'tA', cardId: TOOL_A }, t2 = { iid: 'tB', cardId: TOOL_B };
  const st = mk(inst(WILLDUN, { toolAttached: t1, extraTools: [t2] }));
  const r = ATTACK_PRE.get('拉達|削落')(st, 0, pool, {});
  const d = r.state.players[1].active;
  assert.ok(!d.toolAttached, 'toolAttached 應已丟');
  assert.equal((d.extraTools ?? []).length, 0, 'extraTools 應清空(HEAD殘留)');
  assert.ok(r.state.players[1].discard.some(c => c.iid === 'tA') && r.state.players[1].discard.some(c => c.iid === 'tB'), '兩道具全進棄牌(HEAD漏tB)');
  assert.equal(r.damage, 20);
});
T('控制:削落單道具→丟該道具', () => {
  const st = mk(inst(WILLDUN, { toolAttached: { iid: 'tC', cardId: TOOL_A } }));
  const r = ATTACK_PRE.get('拉達|削落')(st, 0, pool, {});
  assert.ok(!r.state.players[1].active.toolAttached && r.state.players[1].discard.some(c => c.iid === 'tC'));
});
T('破壞船錨共用同修正:2道具全丟', () => {
  const t1 = { iid: 'tD', cardId: TOOL_A }, t2 = { iid: 'tE', cardId: TOOL_B };
  const st = mk(inst(WILLDUN, { toolAttached: t1, extraTools: [t2] }));
  const r = ATTACK_PRE.get('破破舵輪|破壞船錨')(st, 0, pool, {});
  assert.ok(r.state.players[1].discard.some(c => c.iid === 'tD') && r.state.players[1].discard.some(c => c.iid === 'tE'));
});
console.log('\n削落類丟對手道具全數丟棄(v5.779):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
