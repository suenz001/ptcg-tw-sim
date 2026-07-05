/** v5.873 延續 v5.872(恐慌牢籠):promptPlayAbilities 系列還有兩個 prompt resolver 用 index-only
 *  ABILITY_EFFECTS.get(卡名|index) → 漏 regAByName 特性(確認後無效果):
 *    - resolve-promote-active-ability-prompt (on-promote,_shared.ts)
 *    - resolve-retreat-to-bench-ability-prompt (on-retreat-to-bench,v3050)
 *  gate 已用 hasAbilityFn 能偵測,但 resolver 拿不到 fn。改 getAbilityFn(by-name+by-index)。
 *  目前這兩 set 成員都 regA(潛在 bug),但用 active regAByName 特性(白海獅|沖刷)直測 resolver 機制:
 *  HEAD resolver ABILITY_EFFECTS.get('白海獅|0')=undefined(沖刷是 regAByName)→ 確認後無沖刷 log;
 *  修後 getAbilityFn 找到 → 執行沖刷。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.op-s.js'), E = join(ROOT, '.op-e.ts'), O = join(ROOT, '.op-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const SEALEO = '17996' /*白海獅 沖刷(regAByName,active)*/, FILLER = '18519';
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk(effectKey) {
  const sealeo = inst(SEALEO);
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], activeStadium: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: {
      type: 'modal-choice', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1, effectKey,
      params: { label: 'x', options: [{ id: 'yes', text: 'y' }, { id: 'no', text: 'n' }],
        abilityKey: '白海獅|0', abilityName: '沖刷', cardName: '白海獅', targetIid: sealeo.iid },
    },
    players: [
      { name: 'P1', active: sealeo, bench: [inst(FILLER)], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'P2', active: inst(FILLER), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
    ],
  };
}
const hasChongxiLog = (st) => st.log.some(l => (typeof l === 'string' ? l : (l?.message || l?.text || JSON.stringify(l))).includes('沖刷'));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★on-promote resolver:確認 regAByName 特性(白海獅|沖刷)→ 執行(getAbilityFn)', () => {
  const out = applyAction(mk('resolve-promote-active-ability-prompt'), { type: 'RESOLVE_SELECTION', selectedIids: ['yes'] }, pool);
  assert.ok(hasChongxiLog(out), 'HEAD ABILITY_EFFECTS.get(index)=undefined→無沖刷log;修後應執行沖刷');
});
T('★on-retreat-to-bench resolver:確認 regAByName 特性 → 執行(getAbilityFn)', () => {
  const out = applyAction(mk('resolve-retreat-to-bench-ability-prompt'), { type: 'RESOLVE_SELECTION', selectedIids: ['yes'] }, pool);
  assert.ok(hasChongxiLog(out), 'HEAD 無沖刷log;修後應執行沖刷');
});
T('選「不使用」→ 不執行(無沖刷log)', () => {
  const out = applyAction(mk('resolve-promote-active-ability-prompt'), { type: 'RESOLVE_SELECTION', selectedIids: ['no'] }, pool);
  assert.ok(!hasChongxiLog(out), '不使用不執行');
});

console.log('\non-promote/on-retreat resolver by-name(v5.873):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
