/** v5.866 險惡廢墟(Stadium)中央偵測：本回合方將【基礎】(非惡)放到自己備戰時放2個傷害指示物。
 *  原散在 6 處 applyBenchPlaceSideEffects,多條放備戰路徑(從棄牌放備戰 bench-from-discard-samename
 *  等)漏呼叫 → 沒觸發險惡廢墟。改 applyAction 出口統一偵測(新 iid=新放置,排除互換/進化保留iid)。
 *
 *  HEAD-FAIL：從棄牌放備戰(bench-from-discard-samename)在 HEAD 未呼叫 helper → 放的基礎沒吃 2
 *            指示物;修後中央偵測 → 吃 20。PLAY_BASIC 驗證中央不回歸+不重複。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rr-s.js'), E = join(ROOT, '.rr-e.ts'), O = join(ROOT, '.rr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const RUINS = '14020', BASIC = '14086', PE = '14103';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...e });
function mk({ stadium = true, handBasics = [], discardBasics = [], pending = null } = {}) {
  const hand = handBasics.map(() => inst(BASIC));
  const discard = discardBasics.map(() => inst(BASIC));
  return {
    st: {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: pending,
      activeStadium: stadium ? { cardId: RUINS, iid: 'stad' } : null,
      players: [
        { name: 'P1', active: inst(BASIC), bench: [], hand, deck: [], discard, prizes: [1, 1, 1, 1, 1, 1] },
        { name: 'P2', active: inst(BASIC), bench: [], hand: [], deck: [inst(PE)], discard: [], prizes: [1, 1, 1, 1, 1, 1] },
      ],
    }, hand, discard,
  };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('PLAY_BASIC 放基礎到備戰(險惡廢墟)-> 受 20（中央生效,不回歸）', () => {
  const { st, hand } = mk({ handBasics: [1] });
  const out = applyAction(st, { type: 'PLAY_BASIC', iid: hand[0].iid }, pool);
  const b = out.players[0].bench.find(c => c.cardId === BASIC);
  assert.ok(b, '應放到備戰'); assert.strictEqual(b.damage, 20, `應 20,實際 ${b.damage}`);
});

T('★從棄牌放備戰(bench-from-discard-samename,險惡廢墟)-> 受 20（HEAD 漏 helper=0）', () => {
  const targetName = pool.get(BASIC)?.name;
  const { st, discard } = mk({ discardBasics: [1], pending: { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0, effectKey: 'bench-from-discard-samename', minCount: 0, maxCount: 1, params: { validIids: [], targetName, label: 'test' } } });
  st.pendingSelection.params.validIids = [discard[0].iid];
  const out = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [discard[0].iid] }, pool);
  const b = out.players[0].bench.find(c => c.cardId === BASIC);
  assert.ok(b, '應放到備戰'); assert.strictEqual(b.damage, 20, `應 20(HEAD-FAIL:0),實際 ${b.damage}`);
});

T('idempotent:第2次 PLAY_BASIC 不會讓第1隻再+20', () => {
  const { st, hand } = mk({ handBasics: [1, 1] });
  let s = applyAction(st, { type: 'PLAY_BASIC', iid: hand[0].iid }, pool);
  s = applyAction(s, { type: 'PLAY_BASIC', iid: hand[1].iid }, pool);
  const benches = s.players[0].bench.filter(c => c.cardId === BASIC);
  assert.strictEqual(benches.length, 2, '2 隻在備戰');
  for (const b of benches) assert.strictEqual(b.damage, 20, `每隻應剛好 20,實際 ${b.damage}(重複觸發會變40)`);
});

T('無險惡廢墟 -> 放基礎不受傷', () => {
  const { st, hand } = mk({ stadium: false, handBasics: [1] });
  const out = applyAction(st, { type: 'PLAY_BASIC', iid: hand[0].iid }, pool);
  const b = out.players[0].bench.find(c => c.cardId === BASIC);
  assert.strictEqual(b.damage, 0, `無場地應 0,實際 ${b.damage}`);
});

console.log('\n險惡廢墟放備戰中央偵測(v5.866):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
