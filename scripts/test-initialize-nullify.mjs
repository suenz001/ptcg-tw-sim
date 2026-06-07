/**
 * 回歸測試網：鐵荊棘ex｜初始化（passive 特性消除 — 規則寶可夢，未來除外）
 * v5.471 玩家回報：① 被消除特性 UI 仍顯示按鈕(按了沒效果) ② 初始化後天空徑線仍0費撤退。
 * 根因：初始化原只在 engine USE_ABILITY 單點檢查，中央 isAbilityNullifiedByPassive /
 *   isAbilityHolderEffective 不含 → UI(getUsableAbilities)+被動套用點(天空徑線/PASSIVE_*) 全漏。
 * 修法：初始化整合進兩個中央 helper；天空徑線+PASSIVE_* 改查 isAbilityHolderEffective。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.init-e.ts'), O = join(ROOT, '.init-o.mjs'), S = join(ROOT, '.init-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';
export { isAbilityNullifiedByPassive, isAbilityHolderEffective, isInitializeNullified } from './src/lib/game/effects/cards/v3001_g3_wave3';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { createGame, applyAction, isAbilityNullifiedByPassive, isAbilityHolderEffective, isInitializeNullified } = M;
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const CID = { tetsu: '16753', latias: '14735', ubo: '17976', def: '13163' };
let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const base = () => createGame({ name: 'P1', entries: [{ cardId: CID.def, count: 1 }] }, { name: 'P2', entries: [{ cardId: CID.def, count: 1 }] }, pool);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✅', n); pass++; } catch (e) { console.log('  ❌', n + ':', e.message); fail++; } };
T('isAbilityNullifiedByPassive：規則寶可夢 對手鐵荊棘ex在場→消除(UI按鈕擋住)', () => {
  const s = base(); const lat = inst(CID.latias);
  const st = { ...s, players: [{ ...s.players[0], active: lat, bench: [] }, { ...s.players[1], active: inst(CID.tetsu), bench: [] }] };
  assert.equal(isAbilityNullifiedByPassive(st, 0, lat, pool.get(CID.latias), '天空徑線', 'active', pool), true);
  const st2 = { ...s, players: [{ ...s.players[0], active: lat, bench: [] }, { ...s.players[1], active: inst(CID.ubo), bench: [] }] };
  assert.equal(isAbilityNullifiedByPassive(st2, 0, lat, pool.get(CID.latias), '天空徑線', 'active', pool), false);
});
T('isAbilityHolderEffective：拉帝亞斯ex holder 對手鐵荊棘ex→無效', () => {
  const s = base(); const lat = inst(CID.latias);
  const st = { ...s, players: [{ ...s.players[0], active: lat, bench: [] }, { ...s.players[1], active: inst(CID.tetsu), bench: [] }] };
  assert.equal(isAbilityHolderEffective(st, lat, pool.get(CID.latias), 0, '天空徑線', 'active', pool), false);
});
T('鐵荊棘ex 自己(未來)不被初始化消除', () => {
  const s = base(); const tetsu = inst(CID.tetsu);
  const st = { ...s, players: [{ ...s.players[0], active: tetsu, bench: [] }, { ...s.players[1], active: inst(CID.tetsu), bench: [] }] };
  assert.equal(isInitializeNullified(st, pool.get(CID.tetsu), pool), false);
});
T('非規則寶可夢不被初始化消除', () => {
  const s = base();
  const st = { ...s, players: [{ ...s.players[0], active: inst(CID.ubo), bench: [] }, { ...s.players[1], active: inst(CID.tetsu), bench: [] }] };
  assert.equal(isInitializeNullified(st, pool.get(CID.ubo), pool), false);
});
function retreatState(oppActiveCid) {
  const s = base();
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { ...s.players[0], hand: [], deck: [inst(CID.def)], discard: [], prizes: Array.from({ length: 6 }, () => inst(CID.def)), active: inst(CID.ubo, []), bench: [inst(CID.latias), inst(CID.def)] },
      { ...s.players[1], hand: [], deck: [inst(CID.def)], discard: [], prizes: Array.from({ length: 6 }, () => inst(CID.def)), active: inst(oppActiveCid), bench: [] }] };
}
T('天空徑線：無初始化→0 能量可免費撤退', () => {
  const st = retreatState(CID.ubo); const b = st.players[0].bench[1].iid;
  const n = applyAction(st, { type: 'RETREAT', newActiveIid: b }, pool);
  assert.notEqual(n.players[0].active?.cardId, CID.ubo);
});
T('天空徑線被初始化消除：對手鐵荊棘ex→0 能量無法撤退(費用恢復)', () => {
  const st = retreatState(CID.tetsu); const b = st.players[0].bench[1].iid;
  const n = applyAction(st, { type: 'RETREAT', newActiveIid: b }, pool);
  assert.equal(n.players[0].active?.cardId, CID.ubo);
});
console.log(`\n初始化特性消除：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
