/** v5.874 AI opp-bench-choose handler 尊重 params.validIids(對齊 UI +page.svelte + opp-poke-choose)。
 *  原直接用 srcPlayer.bench 挑 HP 最低,忽略 validIids → snipe-60-ex(只限ex)/gust-opp(排除化隱)/
 *  lucia-show/wave3a-snipe/頂級球 等設 validIids 的卡,AI 會選到非法目標(打非ex/化隱保護的備戰)。
 *
 *  HEAD-FAIL:validIids 只含 bench[1](高HP),但 AI 挑 HP 最低 bench[0](不在 validIids)→ 非法;
 *           修後 AI 只從 validIids 選 → bench[1]。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ob-s.js'), E = join(ROOT, '.ob-e.ts'), O = join(ROOT, '.ob-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { getAIAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const POKE = '14319';
let nn = 0;
const inst = (cid, dmg = 0) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: dmg, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null });
// AI=0(actor);對手=1(srcPlayer bench)。b0 高傷(HP低=AI 預設會挑);b1 無傷。validIids 只含 b1。
function mk(validSubset) {
  const b0 = inst(POKE, 80), b1 = inst(POKE, 0);
  const params = validSubset ? { validIids: [b1.iid] } : {};
  return {
    st: {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [],
      pendingSelection: { type: 'opp-bench-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'snipe-60-ex', params },
      players: [
        { name: 'AI', active: inst(POKE), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
        { name: 'OPP', active: inst(POKE), bench: [b0, b1], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      ],
    }, b0, b1,
  };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★opp-bench-choose validIids 限 b1 → AI 選 b1(不選 HP 最低但非法的 b0)', () => {
  const { st, b0, b1 } = mk(true);
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'RESOLVE_SELECTION');
  assert.deepEqual(act.selectedIids, [b1.iid], `應選 validIids 內的 b1,不選 HP 最低但非法的 b0(HEAD 選 b0)`);
});
T('無 validIids → AI 仍挑 HP 最低 b0(不回歸)', () => {
  const { st, b0 } = mk(false);
  const act = getAIAction(st, pool, 0);
  assert.deepEqual(act.selectedIids, [b0.iid], 'no-validIids 維持挑 HP 最低');
});

console.log('\nAI opp-bench-choose validIids(v5.874):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
