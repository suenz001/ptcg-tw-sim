/**
 * 自身/對手狀態施加收斂（v5.675）
 * 收斂目標：
 *  - applyStatusToSelfActive（自身狀態，不受化隱但套憨憨臉/不眠/特殊能量/祭典 + 欄位保留）
 *  - 琉琪亞的展示（Supporter 強制換場 + 混亂）改走 applyStatusToOppActive(item-effect)
 *    → 訓練家卡不被化隱擋，但補憨憨臉免疫（HEAD 舊版無 憨憨臉 check，會誤施加混亂）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sc-s.mjs'), E = join(ROOT, '.sc-e.ts'), O = join(ROOT, '.sc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { applyStatusToSelfActive } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, applyStatusToSelfActive } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const LUCIA = '17201' /*琉琪亞的展示 Supporter*/, SLOW = '18072' /*呆呆獸|憨憨臉*/,
      ATK = '14047' /*小磁怪*/, NORM = '14705' /*小磁怪(一般)*/;
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const hasStatus = (c, st) => c.status === st || c.secondaryStatus === st || c.tertiaryStatus === st;

// 我方手牌握 琉琪亞的展示；對手 active=NORM、備戰=[benchCid]
function mkLucia(benchCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: ATK, count: 1 }] }, { name: 'P2', entries: [{ cardId: NORM, count: 1 }] }, pool);
  const lucia = inst(LUCIA), benchT = inst(benchCid);
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [lucia], deck: [inst(ATK)], discard: [], prizes: Array.from({ length: 6 }, () => inst(ATK)), active: inst(ATK), bench: [] },
      { ...s.players[1], hand: [], deck: [inst(NORM)], discard: [], prizes: Array.from({ length: 6 }, () => inst(NORM)), active: inst(NORM), bench: [benchT] }] },
    luciaIid: lucia.iid, benchIid: benchT.iid };
}
function runLucia(o) {
  let n = applyAction(o.st, { type: 'PLAY_TRAINER', iid: o.luciaIid }, pool);
  assert.equal(n.pendingSelection?.effectKey, 'lucia-show', '應開對手備戰選擇 picker');
  n = applyAction(n, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [o.benchIid] }, pool);
  return n;
}

// 自身 state 工具（直接呼叫 applyStatusToSelfActive 單元測）
function selfState(activeExtra = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: ATK, count: 1 }] }, { name: 'P2', entries: [{ cardId: NORM, count: 1 }] }, pool);
  return { ...s, log: s.log ?? [], players: [
    { ...s.players[0], active: inst(ATK, activeExtra), bench: [] },
    { ...s.players[1], active: inst(NORM), bench: [] }] };
}

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('琉琪亞的展示：換一般備戰上場 → 上場並【混亂】(baseline)', () => {
  const o = mkLucia(NORM); const n = runLucia(o);
  const a = n.players[1].active;
  assert.equal(a.iid, o.benchIid, '備戰目標應換到戰鬥場');
  assert.ok(hasStatus(a, 'confused'), '新上場應【混亂】');
});

T('★琉琪亞的展示：換【憨憨臉】呆呆獸上場 → 不混亂(HEAD 舊版漏查 → FAIL)', () => {
  const o = mkLucia(SLOW); const n = runLucia(o);
  const a = n.players[1].active;
  assert.equal(a.iid, o.benchIid, '呆呆獸應換到戰鬥場');
  assert.ok(!hasStatus(a, 'confused'), '憨憨臉應免疫【混亂】');
});

T('applyStatusToSelfActive：自身混亂 → status 主格(baseline)', () => {
  const s = applyStatusToSelfActive(selfState(), 0, 'confused', pool, { label: '暴走' });
  assert.equal(s.players[0].active.status, 'confused');
});

T('★applyStatusToSelfActive：已中毒(secondary)時自身睡眠 → 保留中毒、睡眠進主格(欄位保留)', () => {
  const s = applyStatusToSelfActive(selfState({ secondaryStatus: 'poisoned' }), 0, 'asleep', pool, { label: '睡覺' });
  const a = s.players[0].active;
  assert.equal(a.status, 'asleep', '睡眠應在 status 主格');
  assert.ok(hasStatus(a, 'poisoned'), '原中毒不應被覆蓋');
});

console.log('\n自身/對手狀態收斂:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
