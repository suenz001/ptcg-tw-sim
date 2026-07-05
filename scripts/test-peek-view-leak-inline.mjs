/** v5.877 反向 view-leak:突刺目光(倫琴貓ex H)/舌引(大舌頭 H)的「查看對手手牌」原用公開 addLog+卡名
 *  →洩漏整副對手手牌給觀戰者。v5.876 收斂 peekOppHandPost 時漏掉這兩張(它們是 inline 自訂 impl)。
 *  修:改 addPrivateLog(actor 私訊看卡名、公開 message 只張數)。丟棄/放備戰的最終動作 log 仍公開含卡名(不變)。
 *
 *  HEAD-FAIL:HEAD 公開 message 含對手卡名 → publicHasName=true → ★FAIL;修後公開只張數、privateMessage 才含名。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pkv-s.js'), E = join(ROOT, '.pkv-e.ts'), O = join(ROOT, '.pkv-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const POKE = '14319', WATER_E = '18519';
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk(oppHandCids) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    players: [
      { name: 'ATK', active: inst(POKE), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'OPP', active: inst(POKE), bench: [], hand: oppHandCids.map(inst), deck: [], discard: [], prizes: [1,1,1,1,1,1] },
    ],
  };
}
const pubMsg = (l) => (typeof l === 'string' ? l : (l?.message || ''));
const privMsg = (l) => (typeof l === 'string' ? '' : (l?.privateMessage || ''));
const publicHasName = (st, nm) => st.log.some(l => pubMsg(l).includes(nm));
const privateHasName = (st, nm) => st.log.some(l => privMsg(l).includes(nm));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const waterName = pool.get(WATER_E)?.name ?? '基本【水】能量';

for (const [atk, label] of [['倫琴貓ex|突刺目光','突刺目光'], ['大舌頭|舌引','舌引']]) {
  T(`★${atk} 查看對手手牌:公開 log 不洩漏卡名、私訊揭示卡名`, () => {
    const fn = ATTACK_POST.get(atk);
    assert.ok(fn, `${atk} 應有 regPost`);
    const out = fn(mk([WATER_E, WATER_E]), 0, pool, {});
    // HEAD:公開 message 含「— ${waterName}」→ 洩漏 → 此斷言 FAIL
    assert.ok(!publicHasName(out, waterName), `公開 log 不應洩漏對手卡名「${waterName}」(HEAD 會 FAIL)`);
    // actor 仍應在私訊看到卡名(權益)
    assert.ok(privateHasName(out, waterName), `actor 私訊應揭示對手卡名「${waterName}」`);
    // 公開仍應有「查看對手手牌」張數提示
    assert.ok(out.log.some(l => pubMsg(l).includes('查看對手手牌')), '公開應有查看提示(張數)');
  });
}
T('突刺目光 對手手牌為空 → 不洩漏', () => {
  const out = ATTACK_POST.get('倫琴貓ex|突刺目光')(mk([]), 0, pool, {});
  assert.ok(!publicHasName(out, waterName), '空手牌無洩漏');
});

console.log('\n反向 view-leak(v5.877 突刺目光/舌引):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
