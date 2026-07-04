/** v5.869 索羅亞克|欺詐「選擇1個對手的戰鬥寶可夢持有的招式，作為這個招式使用」。
 *  原實作 pickHighestAttack 自動挑最高傷害,不讀 copyAttackChoice → 玩家無法選(違卡面「選擇」)。
 *  修:regPre 讀 action.copyAttackChoice(同皮可西揮指/阿響試著模仿),無 choice 才 fallback 最高。
 *  UI:game/+page.svelte intercept 白名單加欺詐。
 *
 *  HEAD-FAIL:對手戰鬥場=幕下力士(推擊10/正面對決30),玩家選 index0(推擊)→應複製10;
 *           HEAD 忽略 choice → 自動挑最高30 → FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.zf-s.js'), E = join(ROOT, '.zf-e.ts'), O = join(ROOT, '.zf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const ZOROARK = '13416' /*索羅亞克|欺詐*/, RIKISHI = '14087' /*幕下力士:推擊10(idx0)/正面對決30(idx1)*/;
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk() {
  const oppActive = inst(RIKISHI);
  return {
    st: {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
      players: [
        { name: 'ATK', active: inst(ZOROARK), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
        { name: 'OPP', active: oppActive, bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      ],
    }, oppActive,
  };
}
const pre = ATTACK_PRE.get('索羅亞克|欺詐');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★玩家選 index0(推擊10) → 複製傷害 10(非自動挑最高30)', () => {
  const { st, oppActive } = mk();
  const r = pre(st, 0, pool, { type: 'ATTACK', copyAttackChoice: { pokeIid: oppActive.iid, attackIndex: 0 } });
  assert.strictEqual(r.damage, 10, `選推擊應複製10,實際${r.damage}(HEAD 忽略 choice→30)`);
});

T('玩家選 index1(正面對決30) → 複製傷害 30', () => {
  const { st, oppActive } = mk();
  const r = pre(st, 0, pool, { type: 'ATTACK', copyAttackChoice: { pokeIid: oppActive.iid, attackIndex: 1 } });
  assert.strictEqual(r.damage, 30, `選正面對決應複製30,實際${r.damage}`);
});

T('無 choice(AI/舊 state) → fallback 自動挑最高30', () => {
  const { st } = mk();
  const r = pre(st, 0, pool, { type: 'ATTACK' });
  assert.strictEqual(r.damage, 30, `無choice應fallback最高30,實際${r.damage}`);
});

console.log('\n索羅亞克|欺詐 玩家選招式(v5.869):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
