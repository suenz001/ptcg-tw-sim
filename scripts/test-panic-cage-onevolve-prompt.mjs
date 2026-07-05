/** v5.872 怖納噬草|恐慌牢籠(on-evolve 特性,「進化時可使用1次,對手戰鬥場混亂」)修玩家回報:
 *  進化時沒彈確認視窗、也沒混亂。根因:恐慌牢籠用 regAByName 註冊到 ABILITY_EFFECTS_BY_NAME
 *  (因3張同名怖納噬草別版 index-0 是雜草魂,須 by-name 消歧義),但 promptPlayAbilities gate
 *  只查 ABILITY_EFFECTS.has(名|index)(regA)→ 查不到 → continue → 永不彈窗;resolver 同樣
 *  ABILITY_EFFECTS.get(index) 拿不到 fn。修:gate 改 hasAbilityFn、resolver 改 getAbilityFn(兩 map)。
 *
 *  HEAD-FAIL:HEAD promptPlayAbilities 對恐慌牢籠回原 state(無 pendingSelection);修後開 modal。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pc-s.js'), E = join(ROOT, '.pc-e.ts'), O = join(ROOT, '.pc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { promptPlayAbilities } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, promptPlayAbilities } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const PANIC = '14359' /*怖納噬草 恐慌牢籠(I)*/, DEF = '14319' /*對手 active*/;
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk() {
  const evo = inst(PANIC); // 剛進化的怖納噬草(在戰鬥場)
  return {
    st: {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
      players: [
        { name: 'P1', active: evo, bench: [], hand: [], deck: [inst(DEF)], discard: [], prizes: [1,1,1,1,1,1], abilityNamesUsedThisTurn: [] },
        { name: 'P2', active: inst(DEF), bench: [], hand: [], deck: [inst(DEF)], discard: [], prizes: [1,1,1,1,1,1] },
      ],
    }, evo,
  };
}
const card = pool.get(PANIC);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★恐慌牢籠 進化時彈「是否使用特性」modal(regAByName 也被偵測)', () => {
  const { st, evo } = mk();
  const out = promptPlayAbilities(st, 0, card, evo, pool, true);
  assert.ok(out.pendingSelection, 'HEAD 無 prompt→null;修後應開 modal');
  assert.equal(out.pendingSelection.type, 'modal-choice', 'modal-choice 確認視窗');
  assert.equal(out.pendingSelection.effectKey, 'resolve-play-ability-prompt', 'on-evolve 確認 prompt');
});

T('★確認使用 → 對手戰鬥寶可夢【混亂】', () => {
  const { st, evo } = mk();
  const opened = promptPlayAbilities(st, 0, card, evo, pool, true);
  const out = applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: ['yes'] }, pool);
  assert.equal(out.players[1].active.status, 'confused', '確認後對手 active 應混亂');
});

T('選「不使用」→ 對手不混亂', () => {
  const { st, evo } = mk();
  const opened = promptPlayAbilities(st, 0, card, evo, pool, true);
  const out = applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: ['no'] }, pool);
  assert.notEqual(out.players[1].active.status, 'confused', '不使用不混亂');
});

console.log('\n恐慌牢籠 on-evolve prompt(v5.872):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
