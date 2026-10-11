/**
 * 自設「下個對手回合」防守旗標的 promote 時機（v5.658）
 * 純樸(免疫對手招式效果)/防護代碼(免疫帶tag的ex傷害)原誤放在 nextP promote → 對手回合不生效。
 * 修:移到 owner(設旗標方)END_TURN promote(同 metalShield)。白日夢設在對手身上→仍 nextP(不動,做 regression)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.oi-s.mjs'), E = join(ROOT, '.oi-e.ts'), O = join(ROOT, '.oi-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const DEF = '13163'; let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mk(api, p0ex = {}, p1ex = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: api, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF, p0ex), bench: [inst(DEF)] },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF, p1ex), bench: [inst(DEF)] }] };
}
const endTurn = (st) => applyAction(st, { type: 'END_TURN' }, pool);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// ⭐v6.538（IRON_RULES Rule 40）：骨紋巨聲鱷｜純樸 改為常駐特性（站長 2026-10-12；Q&A L1933），
//   immuneToAttackEffectsNextTurn／ThisTurn 旗標整組退休 ⇒ 原本兩條「純樸旗標 promote／清除」沒有觀測對象。
//   意圖（純樸在對手回合有效）改由 test-v6538-simplicity-ability 驗：特性常駐、不需旗標、對手回合與備戰都有效。
//   這裡改驗「旗標確實退休」：END_TURN 不會再憑空長出它。
T('★純樸旗標已退休：END_TURN 不會產生 immuneToAttackEffectsThisTurn', () => {
  const n = endTurn(mk(0, { immuneToAttackEffectsNextTurn: true }));
  assert.equal(n.players[0].active.immuneToAttackEffectsThisTurn, undefined, '退休的旗標又被 promote 了（引擎還在處理它）');
});
T('★防護代碼:設旗標方(P0)END_TURN → immuneToExAttackTagThisTurn=未來', () => {
  const n = endTurn(mk(0, { immuneToExAttackTagNextTurn: '未來' }));
  assert.equal(n.players[0].active.immuneToExAttackTagThisTurn, '未來');
  assert.equal(n.players[0].active.immuneToExAttackTagNextTurn, undefined);
});
T('白日夢(設在對手身上,不動):P0 END_TURN→P1 回合,P1 promote 成 ThisTurn', () => {
  const n = endTurn(mk(0, {}, { endTurnOnOppAttachEnergyNextTurn: true }));
  assert.equal(n.players[1].active.endTurnOnOppAttachEnergyThisTurn, true, '白日夢應在受影響者(對手)回合開始 promote');
});
console.log('\n對手回合型防守旗標 promote 時機:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
