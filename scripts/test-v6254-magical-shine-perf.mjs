// ════════════════════════════════════════════════════════════════════════════
// v6.254 效能量測（IRON_RULES Rule 32：效能數字必須附量測腳本）
//
// 量的是什麼：光之翼豁免加在 isAbilityHolderEffective（全站最熱路徑之一）之後，
//   「一般盤面（場上沒有任何特性型消除源）」的每次呼叫成本**不可以**變成 O(n) 掃全場。
//
// 本檔在 CI 只做「防 O(n) 爆炸」的寬鬆上限斷言（共用 runner 速度不可預期，
// 嚴格門檻會變成假紅）。v6.254 開發時在沙盒量到的 A/B（BASE 312ec9a9 vs 修後，
// 各 9 輪取最小值、N=200k）：
//   情境                                    BASE      FIXED       Δ
//   一般盤面 × 光之翼持有者                218.8 ns   210.9 ns    -3.6%
//   一般盤面 × 一般卡                      210.4 ns   203.4 ns    -3.3%
//   對手初始化在場 × 光之翼持有者          447.1 ns   291.5 ns   -34.8%（豁免先短路，變快）
//   對手初始化在場 × 一般規則寶可夢        422.9 ns   463.5 ns   +9.6%（多一次卡面早退判斷）
// 換算到**完整 applyAction(ATTACK)**（7 輪取最小、N=3000，才是玩家真的感受到的單位）：
//   對手戰鬥場有鐵荊棘ex：42.28 → 42.03 µs（-0.6%）
//   一般盤面：            41.75 → 41.35 µs（-0.9%）
//   ⇒ 微觀的 +40 ns 在動作層級量不出來（一次動作 ~42 µs）。
// ════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6254p-s.js'), E = join(ROOT, '.v6254p-e.ts'), O = join(ROOT, '.v6254p-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { isAbilityHolderEffective, applyAction } = await import(pathToFileURL(O).href);

const DIR = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
assert.ok(pool.size > 3000, `卡池只讀到 ${pool.size} 張 — 掃描器壞了？`);
const fid = (nm, p) => { for (const [i, c] of pool) if (c.name === nm && (!p || p(c))) return i; return null; };
const hasAb = nm => c => (c.abilities ?? []).some(a => a.name === nm);
const PIXY = fid('超級皮可西ex', hasAb('光之翼'));
const IRON = fid('鐵荊棘ex', hasAb('初始化'));
const LAT  = fid('拉帝亞斯ex', hasAb('天空徑線'));
assert.ok(PIXY && IRON && LAT, '找不到量測用卡片');

let seq = 0;
const I = id => ({ iid: 'i' + (++seq), cardId: id, damage: 0, energyAttached: [{ cardId: 'E', type: 'Psychic' }] });
const mk = (a0, a1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
  log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A', active: a0, bench: [I(LAT), I(LAT), I(LAT), I(LAT), I(LAT)], hand: [], deck: [], discard: [], prizes: ['a','b','c','d','e','f'] },
    { name: 'B', active: a1, bench: [I(LAT), I(LAT), I(LAT), I(LAT), I(LAT)], hand: [], deck: [], discard: [], prizes: ['a','b','c','d','e','f'] },
  ],
});

const N = 100000;
const measure = (inst, card, st, loc) => {
  const an = card.abilities[0].name;
  for (let i = 0; i < 20000; i++) isAbilityHolderEffective(st, inst, card, 0, an, loc, pool);  // warm
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = process.hrtime.bigint();
    let acc = 0;
    for (let i = 0; i < N; i++) acc += isAbilityHolderEffective(st, inst, card, 0, an, loc, pool) ? 1 : 0;
    const ns = Number(process.hrtime.bigint() - t0) / N;
    if (ns < best) best = ns;
    if (acc < 0) throw new Error('unreachable');
  }
  return best;
};

const rows = [];
{
  const p = I(PIXY); rows.push(['一般盤面 × 光之翼持有者', measure(p, pool.get(PIXY), mk(p, I(LAT)), 'active')]);
}
{
  const l = I(LAT); rows.push(['一般盤面 × 一般卡', measure(l, pool.get(LAT), mk(l, I(LAT)), 'active')]);
}
{
  const p = I(PIXY); rows.push(['對手初始化在場 × 光之翼持有者', measure(p, pool.get(PIXY), mk(p, I(IRON)), 'active')]);
}
{
  const l = I(LAT); rows.push(['對手初始化在場 × 一般規則寶可夢', measure(l, pool.get(LAT), mk(l, I(IRON)), 'active')]);
}
console.log('\n═══ v6.254 效能量測：isAbilityHolderEffective ═══');
for (const [k, v] of rows) console.log('  ' + k.padEnd(34) + v.toFixed(1).padStart(9) + ' ns/call');

// 動作層級（玩家真的感受到的單位）
const measureAction = withIron => {
  const run = () => { seq = 0; const a = I(PIXY); const st = mk(a, I(withIron ? IRON : LAT));
    applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool); };
  for (let i = 0; i < 300; i++) run();
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) run();
    const us = Number(process.hrtime.bigint() - t0) / 1000 / 1000;
    if (us < best) best = us;
  }
  return best;
};
const actIron = measureAction(true), actPlain = measureAction(false);
console.log('\n═══ v6.254 效能量測：完整 applyAction(ATTACK) ═══');
console.log('  對手戰鬥場有鐵荊棘ex          ' + actIron.toFixed(2).padStart(9) + ' µs/action');
console.log('  一般盤面                      ' + actPlain.toFixed(2).padStart(9) + ' µs/action');

// ⚠ 上限刻意寬鬆（CI runner 速度不可預期）：這條只用來擋「有人把它寫成 O(n) 掃全場」，
//   不是用來抓微觀回歸 —— 微觀回歸請用上面 JSDoc 的 A/B 手法對 BASE blob 重量一次。
let fail = 0;
const T = (name, fn) => { try { fn(); console.log('  ✅ ' + name); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; fail++; console.log('  ❌ ' + name + '\n      ' + e.message); } };
console.log('');
T('P1 一般盤面每次呼叫 < 20 µs（防 O(n) 掃全場）', () => {
  assert.ok(rows[0][1] < 20000, rows[0][0] + ' = ' + rows[0][1].toFixed(1) + ' ns/call');
  assert.ok(rows[1][1] < 20000, rows[1][0] + ' = ' + rows[1][1].toFixed(1) + ' ns/call');
});
T('P2 消除源在場時每次呼叫 < 40 µs', () => {
  assert.ok(rows[2][1] < 40000, rows[2][0] + ' = ' + rows[2][1].toFixed(1) + ' ns/call');
  assert.ok(rows[3][1] < 40000, rows[3][0] + ' = ' + rows[3][1].toFixed(1) + ' ns/call');
});
T('P3 完整 applyAction(ATTACK) < 5 ms', () => {
  assert.ok(actIron < 5000, '有鐵荊棘ex：' + actIron.toFixed(2) + ' µs');
  assert.ok(actPlain < 5000, '一般盤面：' + actPlain.toFixed(2) + ' µs');
});
console.log('');
if (fail > 0) process.exit(1);
