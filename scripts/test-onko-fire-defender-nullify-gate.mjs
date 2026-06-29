/**
 * v5.756：fireDefenderOnKO ③ PASSIVE_ON_KO 補 gate isAbilityHolderEffective。
 * engine.ts 主管線(v5.655)已 gate,但 effects.ts fireDefenderOnKO(手動/inline 傷害 KO 路徑,
 *   狙擊/分配傷害等 8 caller)的 ③ 區塊漏 gate → 被KO者(桃歹郎 最後鎖鏈)特性被暗夜羽擊/初始化
 *   消除時仍誤觸發。本測試直接驅動 fireDefenderOnKO(call-site 級,非僅單元述詞)。
 * (1) 無回歸:對手非振翼髮 → 桃歹郎被KO,最後鎖鏈正常觸發(pendingSelection=deck-search)。
 * (2) ★gate:對手戰鬥場振翼髮(暗夜羽擊) → 最後鎖鏈被壓制跳過(pendingSelection=null)。HEAD 會 FAIL。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = process.env.PTCG_SRC_ROOT || fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ok-s.js'), E = join(ROOT, '.ok-e.ts'), O = join(ROOT, '.ok-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { fireDefenderOnKO } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, fireDefenderOnKO } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const BRAMBLE = '16826', TODE = '14775', LAPRAS = '14085', W = '18519';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
function mkState(p0ActiveCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: p0ActiveCid, count: 1 }] }, { name: 'P2', entries: [{ cardId: TODE, count: 1 }] }, pool);
  const tode = inst(TODE);
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, activeStadium: null, pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(W)], discard: [], bench: [], active: inst(p0ActiveCid) },
      { ...s.players[1], hand: [], deck: [inst(W), inst(W)], discard: [], bench: [], active: tode }] }, tode };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
T('無回歸:對手非振翼髮→桃歹郎被KO最後鎖鏈觸發(deck-search pending)', () => {
  const { st, tode } = mkState(LAPRAS);
  const out = fireDefenderOnKO(st, 1, 0, pool, tode, true, true);
  assert.equal(out.pendingSelection?.type, 'deck-search', '最後鎖鏈應正常觸發 deck-search,實得 ' + (out.pendingSelection?.type ?? 'null'));
});
T('★gate:對手振翼髮暗夜羽擊→桃歹郎最後鎖鏈被壓制(無 pending)', () => {
  const { st, tode } = mkState(BRAMBLE);
  const out = fireDefenderOnKO(st, 1, 0, pool, tode, true, true);
  assert.equal(out.pendingSelection, null, '暗夜羽擊壓制下最後鎖鏈不應觸發,卻得 pending=' + (out.pendingSelection?.type ?? 'null'));
});
console.log('\nfireDefenderOnKO PASSIVE_ON_KO gate:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
