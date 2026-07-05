/** v5.875 相仿秀「查看對手的手牌」是無條件的(對手手牌=重要戰略資訊)。v5.868 在「對手無支援者」時
 *  直接 return → 玩家看不到對手手牌。參考枇琶 v2.41(Leon 裁定:即使無可選卡也開 UI 讓玩家查看整副手牌)
 *  改為一律開 hand-choose picker(sourcePlayerIdx=對手):有支援者 maxCount1、無支援者 maxCount0 純查看。
 *
 *  HEAD-FAIL:對手手牌只有非支援者時 HEAD 不開 picker(pendingSelection=null);修後開 picker(可看手牌)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.mv-s.js'), E = join(ROOT, '.mv-e.ts'), O = join(ROOT, '.mv-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const MRMIME = '9872', LILLIE = '14090' /*支援者*/, POKE = '14319' /*非支援者*/;
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk(oppHandCids) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    players: [
      { name: 'ATK', active: inst(MRMIME), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'OPP', active: inst(POKE), bench: [], hand: oppHandCids.map(inst), deck: [], discard: [], prizes: [1,1,1,1,1,1] },
    ],
  };
}
const fraud = ATTACK_POST.get('魔牆人偶|相仿秀');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('有支援者 → 開 picker(sourcePlayerIdx=對手,可選支援者)', () => {
  const out = fraud(mk([LILLIE, POKE]), 0, pool, {});
  const ps = out.pendingSelection;
  assert.ok(ps, '應開 picker'); assert.equal(ps.type, 'hand-choose');
  assert.equal(ps.sourcePlayerIdx, 1, '揭示對手手牌');
  assert.equal(ps.maxCount, 1, '可選 1 張支援者');
  assert.equal(ps.params.validIids.length, 1, '候選=1 支援者');
});
T('★對手只有非支援者 → 仍開 picker(讓玩家查看整副手牌,maxCount0)', () => {
  const out = fraud(mk([POKE, POKE, POKE]), 0, pool, {});
  const ps = out.pendingSelection;
  assert.ok(ps, 'HEAD 無 picker(看不到手牌);修後應開 picker 供查看');
  assert.equal(ps.type, 'hand-choose');
  assert.equal(ps.sourcePlayerIdx, 1, '揭示對手手牌(整副由 UI 揭露區塊顯示)');
  assert.equal(ps.maxCount, 0, '無支援者→純查看 maxCount0');
  assert.equal(ps.params.validIids.length, 0, '無可選');
});
T('對手手牌為空 → 不開 picker(無可查看)', () => {
  const out = fraud(mk([]), 0, pool, {});
  assert.ok(!out.pendingSelection, '空手牌無 picker');
});

console.log('\n相仿秀無條件查看對手手牌(v5.875):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
