// ════════════════════════════════════════════════════════════════════════════
// v6.255 效能量測（IRON_RULES Rule 32：效能數字必須附量測腳本）
//
// 這一版動到的三個熱路徑：
//   (a) v3001 OPP_ABILITY_EFFECT_IMMUNE_ABILITIES 多一個名字（Set.has，O(1)）
//   (b) defense.ts canApplyEffectToTarget 加 isInstOnSide —— **刻意排在**
//       hasEffectiveAbilityByInst / isAbilityHolderEffective 之後
//       ⇒ 一般盤面（target 沒印光之翼／化隱）0 次呼叫、0 配置。
//   (c) engine ATTACK 主管線多兩個純算術（減法 + Math.max）—— 只在「防守方存活」分支。
//
// 開發時在沙盒量到的 A/B（BASE fa30fb59 vs 修後，同一台、同 workload）：
//
//   (1) 本檔三條（各程序內 5 輪取最小，再跨 4 次程序取最小，N=200k）ns/call：
//         情境                                          BASE     v6.255
//         canApplyEffectToTarget 一般盤面               63.5       63.9    持平
//         canApplyEffectToTarget 對手化隱              200.6      195.9    持平
//         isAbilityHolderEffective 化隱×暗夜羽擊       256.3      327.3    +28%
//       ⇒ 只有第三條變慢，而且是**刻意的**：那條路徑要多問兩張競技場卡
//         （hasEffectiveOppAbilityImmunity）才能判斷豁免成不成立。
//       ⇒ 隔離量測（把 isTargetOnActorOwnSide 從化隱那條拿掉再量）：第二條 198.7 vs 195.9
//         ⇒ 新加的 owner 驗證**量不出來**（先問對面 ⇒ 對手戰鬥位 1 次比對就早退）。
//
//   (2) 完整 applyAction(ATTACK)（7 輪取最小、N=3000）µs/action：
//         對手戰鬥位是化隱   BASE 248.07 → v6.255 245.34
//         一般盤面           BASE 239.19 → v6.255 237.55
//       ⇒ 動作層級量不出差異（差在雜訊內，HEAD 甚至略快）。
//
//   (3) getUsableAbilities（scripts/perf-v6253.mjs，各 3 輪取最小、N=60000）µs/call：
//         情境      v6.252 fe0dcb0d   v6.253 312ec9a9   v6.254 fa30fb59   v6.255
//         worst          3.682            9.461            10.110          9.832
//         typical        5.191            6.036             5.911          5.839
//       ⇒ 這是 v6.255 對 v6.253 效能敘事的**獨立複驗**（Fable 5 回報 3.8→9.5 worst，成立）。
//   ⚠ 沙盒 CPU 約為正式 VM 的 1/10 量級（Rule 32），上表只可拿來比相對值。
//
// 本檔在 CI 只做「防 O(n) 爆炸」的寬鬆上限斷言（共用 runner 速度不可預期，
// 嚴格門檻會變成假紅）。
// ════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6255p-s.js'), E = join(ROOT, '.v6255p-e.ts'), O = join(ROOT, '.v6255p-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { canApplyEffectToTarget } from './src/lib/game/defense';\n"
  + "export { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { canApplyEffectToTarget, isAbilityHolderEffective, applyAction } = await import(pathToFileURL(O).href);

const DIR = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let n = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++n), cardId: String(cid), damage: 0, energyAttached: [] });
const P = (name, a, b) => ({ name, active: a, bench: b, hand: [],
  deck: Array.from({ length: 20 }, () => en('14103')), discard: [],
  prizes: Array.from({ length: 6 }, () => en('14103')) });
const mkS = (p0, p1, stadium = null) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 9,
  isFirstTurn: false, firstPlayerIdx: 0, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], log: [], pendingSelection: null,
  activeStadium: stadium ? inst(stadium) : null, players: [p0, p1] });

const BENCH = () => ['14735', '11246', '19183', '14704', '13741'].map(c => inst(c));
// 一般盤面：target 沒印豁免特性 ⇒ isInstOnSide 不該被呼叫到
const stPlain = mkS(P('P0', inst('16782', [en('14103')]), BENCH()), P('P1', inst('17976'), BENCH()));
// 豁免盤面：對手戰鬥位是化隱 ⇒ 每次都會走到 isInstOnSide
const stHidden = mkS(P('P0', inst('16782', [en('14103')]), BENCH()), P('P1', inst('19149'), BENCH()));
// 暗夜羽擊盤面：v6.255 新豁免路徑
const stMoon = mkS(P('P0', inst('11597', [en('14103')]), BENCH()), P('P1', inst('19149'), BENCH()));

const bench1 = (label, fn, N = 200000) => {
  for (let i = 0; i < 20000; i++) fn();
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) fn();
    const t1 = process.hrtime.bigint();
    best = Math.min(best, Number(t1 - t0) / N);
  }
  return [label, best];
};

const rows = [
  bench1('canApplyEffectToTarget 一般盤面（不該碰 isInstOnSide）',
    () => canApplyEffectToTarget(stPlain, 0, stPlain.players[1].active, pool.get('17976'), 'ability-effect', pool, { isBench: false })),
  bench1('canApplyEffectToTarget 對手化隱（會走 isInstOnSide）',
    () => canApplyEffectToTarget(stHidden, 0, stHidden.players[1].active, pool.get('19149'), 'ability-effect', pool, { isBench: false })),
  bench1('isAbilityHolderEffective 化隱 × 暗夜羽擊（v6.255 新豁免路徑）',
    () => isAbilityHolderEffective(stMoon, stMoon.players[1].active, pool.get('19149'), 1, '化隱', 'active', pool)),
];

console.log('\n═══ v6.255 效能量測（ns/call，5 輪取最小） ═══');
for (const [label, ns] of rows) console.log('  ' + ns.toFixed(1).padStart(9) + ' ns  ' + label);

const measureAction = (st) => {
  const base = mkS(P('P0', inst('11072', [en('14103'), en('14434'), en('14103')]), BENCH()),
                   P('P1', st ? inst('19149') : inst('17976'), BENCH()));
  for (let i = 0; i < 300; i++) applyAction(base, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  let best = Infinity;
  for (let r = 0; r < 7; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 3000; i++) applyAction(base, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 3000 / 1000);
  }
  return best;
};
const actHidden = measureAction(true), actPlain = measureAction(false);
console.log('\n═══ 完整 applyAction(ATTACK) ═══');
console.log('  對手戰鬥位是化隱      ' + actHidden.toFixed(2).padStart(9) + ' µs/action');
console.log('  一般盤面              ' + actPlain.toFixed(2).padStart(9) + ' µs/action');

let fail = 0;
const T = (name, fn) => { try { fn(); console.log('  ✅ ' + name); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; fail++; console.log('  ❌ ' + name + '\n      ' + e.message); } };
console.log('');
T('P1 一般盤面 canApplyEffectToTarget < 20 µs/call（防 O(n) 掃全場）', () => {
  assert.ok(rows[0][1] < 20000, rows[0][0] + ' = ' + rows[0][1].toFixed(1) + ' ns/call');
});
T('P2 豁免盤面兩條 < 40 µs/call', () => {
  assert.ok(rows[1][1] < 40000, rows[1][0] + ' = ' + rows[1][1].toFixed(1) + ' ns/call');
  assert.ok(rows[2][1] < 40000, rows[2][0] + ' = ' + rows[2][1].toFixed(1) + ' ns/call');
});
T('P3 完整 applyAction(ATTACK) < 5 ms', () => {
  assert.ok(actHidden < 5000, '對手化隱：' + actHidden.toFixed(2) + ' µs');
  assert.ok(actPlain < 5000, '一般盤面：' + actPlain.toFixed(2) + ' µs');
});
console.log('');
if (fail > 0) process.exit(1);
