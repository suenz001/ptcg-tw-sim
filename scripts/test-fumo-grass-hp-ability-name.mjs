/** v5.897 怖納噬草｜雜草魂 HP 加成(依對手已取獎賞×50)原用 card.name==='怖納噬草' 判斷,
 *  誤套到同名的「恐慌牢籠版」(id 14359,特性是進化混亂非雜草魂)→玩家回報進化時被加血。
 *  修:改判「這張卡實際有『雜草魂』特性」才加。
 *  HEAD-FAIL:HEAD 恐慌牢籠版也被加 50×prizes。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.fg-s.js'), E = join(ROOT, '.fg-e.ts'), O = join(ROOT, '.fg-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getEffectiveHP } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { getEffectiveHP } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || f === 'card-set-map.json' || f.includes('_') || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const PANIC = '14359';  // 恐慌牢籠版(進化混亂,不該加血)
const GRASS = '12328';  // 雜草魂版(該加血)
const POKE = '14319';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// state:對手(idx1)已取 2 張獎賞(prizes 剩 4);怖納噬草在我方(idx0) active
function mkState(cardId) {
  const active = inst(cardId);
  return {
    state: {
      players: [
        { name:'ME', active, bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE),inst(POKE),inst(POKE),inst(POKE),inst(POKE),inst(POKE)] },
        { name:'OP', active:inst(POKE), bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE),inst(POKE),inst(POKE),inst(POKE)] }, // 剩4=已取2
      ],
    }, active,
  };
}

T('★恐慌牢籠版(id 14359) 不吃雜草魂 HP 加成 = base 100(HEAD-FAIL:被加 2×50=200)', () => {
  const { state, active } = mkState(PANIC);
  const hp = getEffectiveHP(active, pool, state);
  assert.equal(hp, 100, `恐慌牢籠版應維持 base 100,實際 ${hp}`);
});

T('雜草魂版(id 12328) 正確加成 = 100 + 2×50 = 200', () => {
  const { state, active } = mkState(GRASS);
  const hp = getEffectiveHP(active, pool, state);
  assert.equal(hp, 200, `雜草魂版應 100+100=200,實際 ${hp}`);
});

T('雜草魂版 對手未取獎賞 → base 100', () => {
  const active = inst(GRASS);
  const state = { players:[
    { name:'ME', active, bench:[], hand:[], deck:[], discard:[], prizes:[] },
    { name:'OP', active:inst(POKE), bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE),inst(POKE),inst(POKE),inst(POKE),inst(POKE),inst(POKE)] },
  ]};
  assert.equal(getEffectiveHP(active, pool, state), 100);
});

console.log('\n怖納噬草雜草魂/恐慌牢籠 HP 消歧義(v5.897):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
