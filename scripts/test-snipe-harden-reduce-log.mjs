// v5.900 驗證：狙擊/延後型招式(走中央 dealAttackDamageToTarget)的「變硬」免傷與「下次被擊減傷」
//   都要寫進戰鬥 log（原漏 → 傷害歸 0 / 被減卻無任何說明；鏡射主引擎路徑 engine.ts 4837/4848）。
//   HEAD-FAIL：HEAD 傷害數值正確(0 / 50)但 log 完全沒有「變硬」/「下次被擊減傷」字樣 → log 斷言 FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.shr-s.js'), E = join(ROOT, '.shr-e.ts'), O = join(ROOT, '.shr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const DOLL = '19176', REGI = '16970', E_PSY = '11177';
let iid = 0; const inst = (cid, e = {}) => ({ iid: `a${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('  PASS', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
function run(defExtra = {}) {
  const s = createGame({ name: 'A', entries: [{ cardId: DOLL, count: 1 }] }, { name: 'B', entries: [{ cardId: REGI, count: 1 }] }, pool);
  const da = inst(REGI, defExtra);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], activeStadium: null,
    players: [
      { ...s.players[0], hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, () => inst(DOLL)), bench: [], active: inst(DOLL, { energyAttached: [inst(E_PSY)] }) },
      { ...s.players[1], hand: [], deck: [inst(REGI)], discard: [], prizes: Array.from({ length: 6 }, () => inst(REGI)), bench: [], active: da }] };
  let r = applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool);
  if (r.pendingSelection) r = applyAction(r, { type: 'RESOLVE_SELECTION', effectKey: r.pendingSelection.effectKey, selectedIids: [], actorIdx: 0 }, pool);
  return r;
}
const logStr = (r) => (r.log || []).map(l => typeof l === 'string' ? l : (l?.text ?? JSON.stringify(l))).join('\n');
T('(1) 對照(無減傷)：玩偶捕捉 80 -> 80', () => {
  const r = run();
  assert.equal(r.players[1].active?.damage, 80, '無減傷應 80,實際 ' + r.players[1].active?.damage);
});
T('(2) 變硬(<=100免傷)：玩偶捕捉 80 -> 0，且 log 出現「變硬」', () => {
  const r = run({ blockAttackDamageIfLTEThisTurn: 100 });
  assert.equal(r.players[1].active?.damage, 0, '80<=100 應歸 0,實際 ' + r.players[1].active?.damage);
  assert.ok(logStr(r).includes('變硬'), 'log 應說明變硬免傷(HEAD 漏寫->FAIL)');
});
T('(3) 下次被擊減傷(-30)：玩偶捕捉 80 -> 50，且 log 出現「下次被擊減傷 -30」', () => {
  const r = run({ damageReduceNextHit: 30 });
  assert.equal(r.players[1].active?.damage, 50, '80-30 應 50,實際 ' + r.players[1].active?.damage);
  assert.ok(logStr(r).includes('下次被擊減傷 -30'), 'log 應說明減傷 -30(HEAD 漏寫->FAIL)');
});
console.log(`\n=== 狙擊路徑減傷 log(v5.900): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
