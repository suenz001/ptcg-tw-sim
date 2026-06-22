/**
 * 三層狀態:燒傷解除只清「燒傷所在那格」（v5.659）
 * bug:checkup 解燒傷時 else-if 認 secondary||tertiary 卻一律清 secondaryStatus → 燒傷在 tertiary 時誤清 secondary(中毒)。
 * 場景:睡眠(status)+中毒(secondary)+灼傷(tertiary),擲幣正面解燒傷 → 中毒應保留、燒傷清除。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.bc-s.mjs'), E = join(ROOT, '.bc-e.ts'), O = join(ROOT, '.bc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const BIG = '10619' /*願增猿ex HP210,夠高不會被checkup打死*/, DEF = '13163';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mk(p0Active) {
  const s = createGame({ name: 'P1', entries: [{ cardId: BIG, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(BIG)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: p0Active, bench: [inst(DEF)] },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF), bench: [inst(DEF)] }] };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★睡眠+中毒(secondary)+灼傷(tertiary),checkup正面解燒傷 → 中毒保留、燒傷清除', () => {
  const st = mk(inst(BIG, { status: 'asleep', secondaryStatus: 'poisoned', tertiaryStatus: 'burned' }));
  const orig = Math.random; Math.random = () => 0; // 強制擲幣正面(解燒傷/醒睡)
  let out;
  try { out = applyAction(st, { type: 'END_TURN' }, pool); } finally { Math.random = orig; }
  const a = out.players[0].active;
  assert.equal(a.tertiaryStatus, undefined, '燒傷(tertiary)應被解除');
  assert.equal(a.secondaryStatus, 'poisoned', '中毒(secondary)不應被誤清(這是 bug 修正點)');
});

T('控制:灼傷在 secondary,checkup正面解燒傷 → secondary 清除', () => {
  const st = mk(inst(BIG, { secondaryStatus: 'burned' }));
  const orig = Math.random; Math.random = () => 0;
  let out; try { out = applyAction(st, { type: 'END_TURN' }, pool); } finally { Math.random = orig; }
  assert.equal(out.players[0].active.secondaryStatus, undefined, '燒傷在 secondary 應正常清除');
});

console.log('\n三層狀態燒傷解除:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
