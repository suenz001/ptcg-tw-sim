/** v5.867 AI deck-search filter 'BasicEnergy:<屬性>' 修正。
 *  Wilson 回報：AI 用「小霞的朝氣」(filter='BasicEnergy:Water')填能時把寶可夢填了上去。
 *  根因：ai.ts deck-search parser 缺 'BasicEnergy:' 分支 → 落到 return true(全牌庫)→ usefulness
 *  把基礎寶可夢排前 → 誤選寶可夢。HEAD-FAIL：修前 selectedIids 指向走路草;修後只指向水能量。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ai-s.js'), E = join(ROOT, '.ai-e.ts'), O = join(ROOT, '.ai-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { getAIAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const WATER_E = '18519', POKE = '14319';
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk(filter) {
  const waters = [inst(WATER_E), inst(WATER_E), inst(WATER_E)];
  const pokes = [inst(POKE), inst(POKE), inst(POKE)];
  const deck = [...pokes, ...waters];
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [],
    pendingSelection: { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter, minCount: 0, maxCount: 4, effectKey: 'm5-trainer-karunari-vigor-pick' },
    players: [
      { name: 'AI', active: inst(POKE), bench: [], hand: [], deck, discard: [], prizes: [1, 1, 1, 1, 1, 1] },
      { name: 'P2', active: inst(POKE), bench: [], hand: [], deck: [], discard: [], prizes: [1, 1, 1, 1, 1, 1] },
    ],
  };
}
const idsOf = (st, iids) => iids.map(iid => st.players[0].deck.find(c => c.iid === iid)?.cardId);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★小霞的朝氣 BasicEnergy:Water → AI 只選基本水能量(不選寶可夢)', () => {
  const st = mk('BasicEnergy:Water');
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'RESOLVE_SELECTION', '應回 RESOLVE_SELECTION');
  const picked = idsOf(st, act.selectedIids);
  assert.ok(act.selectedIids.length > 0, '應至少選到 1 張水能量');
  for (const cid of picked) assert.equal(cid, WATER_E, `只能選水能量,卻選到 cardId=${cid}(走路草=${POKE}=誤選寶可夢)`);
});

T('對照 BasicEnergy:Grass → 只選基本能量(不誤抓寶可夢)', () => {
  const st = mk('BasicEnergy:Grass');
  const act = getAIAction(st, pool, 0);
  const picked = idsOf(st, act.selectedIids);
  for (const cid of picked) {
    const c = pool.get(cid);
    assert.ok(c.supertype === 'Energy' && c.subtype === 'Basic', `只能選基本能量,卻選到 ${cid}`);
  }
});

console.log('\nAI deck-search 基本能量屬性 filter(v5.867):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
