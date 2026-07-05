/** v5.876 「查看對手的手牌」是玩家權益(重要戰略資訊)。原純查看型(妙喵看透/小貓怪好奇心/豆豆鴿偵察/
 *  咕咕+蜻蜻蜓靜默之翼/催眠貘)只 addLog(公開卡名=洩漏給觀戰者)、算張數型(能量吸管/奇跡棉花)只 log 數量
 *  (玩家看不到實際手牌)。中央 openPeekOppHandView 開 hand-choose picker(sourcePlayerIdx=對手,maxCount0
 *  純查看,參考枇琶),公開 log 只張數不洩漏卡名。
 *
 *  HEAD-FAIL:妙喵看透 HEAD 只 addLog 不開 picker;能量吸管 HEAD 只 log 張數不開 picker。修後都開 view picker。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pk-s.js'), E = join(ROOT, '.pk-e.ts'), O = join(ROOT, '.pk-o.mjs');
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
const logText = (l) => typeof l === 'string' ? l : (l?.message || l?.text || JSON.stringify(l));
const publicHasName = (st, nm) => st.log.some(l => logText(l).includes(nm));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

for (const [atk, label] of [['妙喵|看透','看透'],['小貓怪|好奇心','好奇心'],['蜻蜻蜓|靜默之翼','靜默之翼'],['狩獵鳳蝶|能量吸管','能量吸管'],['風妖精ex|奇跡棉花','奇跡棉花']]) {
  T(`★${atk} → 開 view picker(sourcePlayerIdx=對手,maxCount0 純查看)`, () => {
    const fn = ATTACK_POST.get(atk);
    assert.ok(fn, `${atk} 應有 regPost`);
    const waterName = pool.get(WATER_E)?.name ?? '基本【水】能量';
    const out = fn(mk([WATER_E, WATER_E]), 0, pool, {});
    const ps = out.pendingSelection;
    assert.ok(ps, 'HEAD 只 log 不開 picker;修後應開 view picker');
    assert.equal(ps.type, 'hand-choose');
    assert.equal(ps.sourcePlayerIdx, 1, '揭示對手手牌');
    assert.equal(ps.maxCount, 0, '純查看');
    assert.equal(ps.effectKey, 'peek-opp-hand-view-only');
    // 公開 log 不含對手卡名(隱私)
    assert.ok(!publicHasName(out, waterName), `公開 log 不應洩漏對手卡名「${waterName}」`);
  });
}
T('對手手牌為空 → 不開 picker', () => {
  const out = ATTACK_POST.get('妙喵|看透')(mk([]), 0, pool, {});
  assert.ok(!out.pendingSelection, '空手牌無 picker');
});

console.log('\n查看對手手牌 view UI(v5.876):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
