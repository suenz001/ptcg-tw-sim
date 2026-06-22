/**
 * 危險光線（道具）狀態施加收斂（v5.674）
 * 危險光線 = Item，讓對手戰鬥寶可夢同時【灼傷】+【混亂】。收斂到中央 applyStatusToOppActive(kind:'item-effect')：
 *   ① 道具不被化隱／純樸擋（卡面只擋「對手招式或特性效果」）— Wilson 裁定。HEAD 舊版誤加化隱 gate → 本測 FAIL。
 *   ② 憨憨臉（混亂免疫）等來源無關免疫照常 — HEAD 舊版漏查憨憨臉 → 本測 FAIL。
 *   ③ 狀態欄位雙格共存（混亂 status 主格 / 灼傷 secondaryStatus）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dr-s.mjs'), E = join(ROOT, '.dr-e.ts'), O = join(ROOT, '.dr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const RAYS = '17118', SLOW = '18072', HIDE = '19175', BUBBLE = '18502', ATK = '14047', NORM = '14705', WATER = '14339';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mk(oppCid, oppActiveExtra = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: ATK, count: 1 }] }, { name: 'P2', entries: [{ cardId: NORM, count: 1 }] }, pool);
  const rays = inst(RAYS), oppA = inst(oppCid, oppActiveExtra);
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [rays], deck: [inst(ATK)], discard: [], prizes: Array.from({ length: 6 }, () => inst(ATK)), active: inst(ATK), bench: [] },
      { ...s.players[1], hand: [], deck: [inst(NORM)], discard: [], prizes: Array.from({ length: 6 }, () => inst(NORM)), active: oppA, bench: [] }] },
    raysIid: rays.iid };
}
const play = (o) => applyAction(o.st, { type: 'PLAY_TRAINER', iid: o.raysIid }, pool);
const oppActive = (n) => n.players[1].active;
const hasStatus = (c, st) => c.status === st || c.secondaryStatus === st || c.tertiaryStatus === st;
let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('一般寶可夢 → 灼傷 + 混亂 雙格共存（行動類混亂在 status 主格）', () => {
  const a = oppActive(play(mk(NORM)));
  assert.ok(hasStatus(a, 'confused'), '應混亂'); assert.ok(hasStatus(a, 'burned'), '應灼傷');
  assert.equal(a.status, 'confused', '混亂應在 status 主格');
});
T('道具不被化隱擋（怨影娃娃）→ 照樣灼傷+混亂（HEAD 舊版 FAIL）', () => {
  const a = oppActive(play(mk(HIDE)));
  assert.ok(hasStatus(a, 'confused'), '化隱不該擋道具→混亂'); assert.ok(hasStatus(a, 'burned'), '化隱不該擋道具→灼傷');
});
T('憨憨臉免疫混亂（呆呆獸）→ 只灼傷不混亂（HEAD 舊版 FAIL）', () => {
  const a = oppActive(play(mk(SLOW)));
  assert.ok(!hasStatus(a, 'confused'), '憨憨臉免疫混亂'); assert.ok(hasStatus(a, 'burned'), '灼傷照中');
  assert.equal(a.status, 'burned', '混亂被免→灼傷落 status 主格');
});
T('控制:【水】寶可夢附泡沫水 → 灼傷+混亂皆被特殊能量免疫', () => {
  const a = oppActive(play(mk(WATER, { energyAttached: [inst(BUBBLE)] })));
  assert.ok(!hasStatus(a, 'confused')); assert.ok(!hasStatus(a, 'burned'));
});
console.log('\n危險光線(道具狀態收斂):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
