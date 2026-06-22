/**
 * 電燈怪|錯亂閃光 — 混亂自傷指示物改 8 個（v5.679）
 * 卡面：將對手戰鬥寶可夢混亂；因這個混亂而放置的傷害指示物數量改為 8 個（=80 自傷，非預設 30）。
 * 實裝：CardInstance.confusionSelfDamageCounters（預設 3）；engine 混亂自傷讀它 ×10；
 *       applyStatusToActive 套混亂時重置（一般混亂回 30）；錯亂閃光套混亂後設 8。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cs-s.mjs'), E = join(ROOT, '.cs-e.ts'), O = join(ROOT, '.cs-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const LANTURN = '10926' /*電燈怪 錯亂閃光*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const hasConf = (c) => c.status === 'confused' || c.secondaryStatus === 'confused' || c.tertiaryStatus === 'confused';

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

// ---- (a) 錯亂閃光 設 confusionSelfDamageCounters = 8 ----
T('★錯亂閃光：對手混亂 + confusionSelfDamageCounters===8（HEAD 缺 → undefined FAIL）', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: LANTURN, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(LANTURN) }, { ...s.players[1], active: inst(DEF) }] };
  const out = ATTACK_POST.get('電燈怪|錯亂閃光')(st, 0, pool);
  const da = out.players[1].active;
  assert.ok(hasConf(da), '對手應【混亂】');
  assert.equal(da.confusionSelfDamageCounters, 8, '混亂自傷指示物應改為 8');
});

// ---- (b) 混亂自傷讀 flag → 80 ----
function runConfusedSelfHit(counters) {
  const s = createGame({ name: 'P1', entries: [{ cardId: LANTURN, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const extra = counters != null ? { confusionSelfDamageCounters: counters } : {};
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], active: inst(LANTURN, { status: 'confused', damage: 0, ...extra }), bench: [inst(DEF)], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)) },
      { ...s.players[1], active: inst(DEF), bench: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)) }] };
  const orig = Math.random; Math.random = () => 0.99; // 反面（tails）→ 混亂自傷
  try { return applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool); } finally { Math.random = orig; }
}
T('★混亂自傷：confusionSelfDamageCounters=8 → 自身 80 傷（HEAD 硬編 30 FAIL）', () => {
  const out = runConfusedSelfHit(8);
  assert.equal(out.players[0].active.damage, 80, '8 個指示物 = 80 自傷');
});
T('baseline 混亂自傷：無 flag → 預設 30', () => {
  const out = runConfusedSelfHit(null);
  assert.equal(out.players[0].active.damage, 30, '預設 3 個 = 30 自傷');
});

// ---- (c) 錯亂閃光設8後，被一般招式再混亂 → flag 重置(回預設) ----
T('★重置：錯亂閃光(8)後再被一般混亂招式 → confusionSelfDamageCounters 清除(回預設30)', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: LANTURN, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  let st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(LANTURN) }, { ...s.players[1], active: inst(DEF) }] };
  st = ATTACK_POST.get('電燈怪|錯亂閃光')(st, 0, pool);
  assert.equal(st.players[1].active.confusionSelfDamageCounters, 8, '先被錯亂閃光設 8');
  // 一般混亂招式(statusPost confused)再施加 → applyStatusToActive 重置覆蓋
  st = ATTACK_POST.get('人造細胞卵|腦力震動')(st, 0, pool);
  assert.equal(st.players[1].active.confusionSelfDamageCounters, undefined, '一般再混亂應清除覆蓋 → 回預設');
});

console.log('\n錯亂閃光混亂自傷:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
