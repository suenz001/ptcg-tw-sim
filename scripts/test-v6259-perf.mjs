// ══════════════════════════════════════════════════════════════════════════════
// v6.259 效能量測（IRON RULES Rule 32：效能數字必須附量測腳本）
//
// 量什麼：**KO 路徑**——這一版把「被 KO 者自身特性的獎賞修正」接進兩條算獎賞的管線
//        （engine.ts 主 ATTACK 的 inline 計算 ＋ effects.ts koPrizesAdjusted），
//        所以熱路徑就是「一發打死對手戰鬥位的 applyAction」。
//
// v6.259 動了什麼（呼叫次數）：
//   ・每次 KO **新增 1 次** koVictimAbilityPrizeAdjust 呼叫。
//   ・該函式第一行 `if (!koByAttackDamage || !koInst || !koCard?.abilities) return`，
//     沒有特性的卡直接早退；有特性的卡才進迴圈，而迴圈裡
//     `PASSIVE_KO_PRIZE_ADJUST.get(ab.name)` 沒中就 continue（不呼叫任何述詞）。
//     ⇒ 對「沒有獎賞修正特性」的絕大多數卡，增量是一次 Map.get（Rule 31 早退機制）。
//   ・同時**移除**了原本 PASSIVE_ON_KO 裡鬆口氣的 claw-back（陣列複製 ×3）。
//
// ⚠ 這支可以直接對 BASE 樹重跑做並排比較（BASE 沒有 koVictimAbilityPrizeAdjust 時
//   自動跳過單函式那段，applyAction 那段照量）。
//
// ⚠ CI 只有單一版本 ⇒ 斷言是**絕對上限**（抓數量級退化），不是精密比較。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.p6259-s.js'), E = join(ROOT, '.p6259-e.ts'), O = join(ROOT, '.p6259-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export * as EFF from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const DIR = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
assert.ok(pool.size > 3000, `卡池只讀到 ${pool.size} 張 — fixture 壞了？`);

const LUCARIO = '13986', MUNNA_EX = '11628', MOMO_EX = '11630', PIDGEY = '14797', E_FIGHT = '14104';
let seq = 0;
const I = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId, damage: 0, energyAttached: [], ...extra });
const EN = id => ({ iid: 'e' + (++seq), cardId: id });
/** 最壞情況：被 KO 的那隻**有**獎賞修正特性（鬆口氣），條件也成立 ⇒ 走完整條路 */
const mkState = () => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A', active: I(LUCARIO, { energyAttached: [EN(E_FIGHT), EN(E_FIGHT)] }),
      bench: [], hand: Array.from({ length: 5 }, () => I(PIDGEY)), deck: [], discard: [],
      prizes: Array.from({ length: 6 }, () => I(PIDGEY)) },
    { name: 'B', active: I(MUNNA_EX), bench: [I(MOMO_EX), I(PIDGEY)], hand: [], deck: [], discard: [],
      prizes: Array.from({ length: 6 }, () => I(PIDGEY)) },
  ],
});

// ⚠ 正對照：fixture 必須真的 KO 而且真的走到獎賞修正，否則量到的是空管線
{
  const chk = mod.applyAction(mkState(), { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  assert.strictEqual(chk.players[1].active, null, 'fixture 沒有把對手打死 ⇒ 這支量測是安慰劑');
  assert.ok(chk.log.some(l => (l.message ?? '').includes('願增猿ex')),
    'fixture 的被 KO 者不是願增猿ex ⇒ 量不到本版新增的路徑');
}

const N = 3000;
for (let i = 0; i < 500; i++) mod.applyAction(mkState(), { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
const samples = [];
for (let r = 0; r < 3; r++) {
  const states = Array.from({ length: N }, mkState);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) mod.applyAction(states[i], { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  samples.push(Number(process.hrtime.bigint() - t0) / 1e6 / N);
}
samples.sort((a, b) => a - b);
const per = samples[1];
console.log('── v6.259 效能量測（一發 KO 對手戰鬥位，被 KO 者帶獎賞修正特性）──');
console.log(`  applyAction ATTACK(KO)：${N} 次 ×3 ⇒ 中位 ${per.toFixed(5)} ms/attack（min ${samples[0].toFixed(5)} / max ${samples[2].toFixed(5)}）`);

// 中央述詞單獨計時（每次 KO 只呼叫 1 次）— BASE 樹沒有這支，跳過即可
if (typeof mod.EFF.koVictimAbilityPrizeAdjust === 'function') {
  const st = mkState();
  const inst = st.players[1].active, card = pool.get(MUNNA_EX);
  const f = mod.EFF.koVictimAbilityPrizeAdjust;
  for (let i = 0; i < 5000; i++) f(st, inst, card, 1, pool, true);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 50000; i++) f(st, inst, card, 1, pool, true);
  const pd = Number(process.hrtime.bigint() - t0) / 1e6 / 50000;
  console.log(`  koVictimAbilityPrizeAdjust（命中）：50000 次 ⇒ ${pd.toFixed(6)} ms/call`);
  assert.ok(pd < 0.05, `中央述詞退化：${pd.toFixed(6)} ms/call（門檻 0.05）`);

  // 早退對照：沒有特性的卡（絕大多數）——應該比命中還快一個檔次
  const p2 = pool.get(PIDGEY), i2 = st.players[1].bench[1];
  for (let i = 0; i < 5000; i++) f(st, i2, p2, 1, pool, true);
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 50000; i++) f(st, i2, p2, 1, pool, true);
  const pd2 = Number(process.hrtime.bigint() - t1) / 1e6 / 50000;
  console.log(`  koVictimAbilityPrizeAdjust（無特性早退）：50000 次 ⇒ ${pd2.toFixed(6)} ms/call`);
  assert.ok(pd2 < 0.01, `早退路徑退化：${pd2.toFixed(6)} ms/call（門檻 0.01）`);
} else {
  console.log('  （這棵樹沒有 koVictimAbilityPrizeAdjust ⇒ 應該是 BASE，跳過單函式量測）');
}

// 絕對上限：沙盒實測 BASE 與 v6.259 同量級；門檻放約 10 倍吸收 CI 抖動。
assert.ok(per < 2.0, `ATTACK(KO) 路徑退化：${per.toFixed(5)} ms/attack（門檻 2.0）`);
console.log('\n✅ v6.259 效能量測通過（無數量級退化）');
