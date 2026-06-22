/**
 * 從手牌附能特性 → 對手附能被動(耿鬼ex|侵蝕詛咒)觸發收斂（v5.662）
 * bug:激動渦輪/無力充能/火焰蹈舞/返回重載等「從手牌附能」resolver 只呼叫 applyMagearnaHandAttachHeal(自方治癒)
 *   漏 fireOnHandEnergyAttached → 對手侵蝕詛咒(放2指示物)/麻痺門牙 沒觸發。
 * 端到端:對手 active=耿鬼ex(侵蝕詛咒),用激動渦輪(花舞鳥ex)從手牌附火能量給備戰火寶可夢 → 該寶可夢應+20(2指示物)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.he-s.mjs'), E = join(ROOT, '.he-e.ts'), O = join(ROOT, '.he-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const ORI = '14336' /*花舞鳥ex 激動渦輪*/, MEGA = '14331' /*超級噴火龍X(Fire Mega ex,gate)*/, TGT = '14329' /*小火龍(火)*/, FIRE = '14428', GENGAR = '16916' /*耿鬼ex 侵蝕詛咒*/, DEF = '14786';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mk(oppActiveCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: FIRE, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const ori = inst(ORI), mega = inst(MEGA), tgt = inst(TGT), fire = inst(FIRE);
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [fire], deck: [inst(FIRE)], discard: [], prizes: Array.from({ length: 6 }, () => inst(FIRE)), active: ori, bench: [mega, tgt] },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(oppActiveCid), bench: [] }] },
    oriIid: ori.iid, fireIid: fire.iid, tgtIid: tgt.iid };
}
function runExcitingTurbo(o) {
  const { st, oriIid, fireIid, tgtIid } = o;
  let n = applyAction(st, { type: 'USE_ABILITY', iid: oriIid, abilityIndex: 0 }, pool);
  assert.equal(n.pendingSelection?.effectKey, 'exciting-turbo-pick-target', '應開選能量 picker');
  n = applyAction(n, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [fireIid] }, pool);
  assert.equal(n.pendingSelection?.effectKey, 'exciting-turbo-commit', '應開選目標 picker');
  n = applyAction(n, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [tgtIid] }, pool);
  return n;
}
let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★激動渦輪從手牌附能 + 對手耿鬼ex侵蝕詛咒 → 被附能寶可夢 +20(2指示物)', () => {
  const o = mk(GENGAR); const n = runExcitingTurbo(o);
  const tgt = n.players[0].bench.find(b => b.iid === o.tgtIid);
  assert.ok(tgt.energyAttached.some(e => e.iid === o.fireIid), '火能量應已附上');
  assert.equal(tgt.damage, 20, '侵蝕詛咒應放 2 指示物 = +20(原漏 fireOnHandEnergyAttached 會是 0)');
});

T('控制:對手非侵蝕詛咒 → 被附能寶可夢無額外傷害', () => {
  const o = mk(DEF); const n = runExcitingTurbo(o);
  const tgt = n.players[0].bench.find(b => b.iid === o.tgtIid);
  assert.ok(tgt.energyAttached.some(e => e.iid === o.fireIid));
  assert.equal(tgt.damage, 0);
});

console.log('\n從手牌附能→對手反應:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
