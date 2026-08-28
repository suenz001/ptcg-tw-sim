// ══════════════════════════════════════════════════════════════════════════════
// v6.258 效能量測（IRON RULES Rule 32：效能數字必須附量測腳本）
//
// 量什麼：ATTACK 主管線（`applyAction`）——傷害計算是全站最熱的路徑，
//        攻擊方場上最多 6 隻、每隻的每個特性都會進 collectPassiveAttackBonuses 迴圈。
//
// v6.258 動了什麼：
//   ・engine.ts / effects.ts / mega_decks.ts 三份手抄迴圈 → 收斂成一支
//     collectPassiveAttackBonuses（**呼叫次數不變**，只是換成同一份程式）。
//   ・迴圈內新增一個 `PASSIVE_ATTACK_SELF_SUBJECT.has(ab.name)`，且它排在
//     `if (!fn) continue` **之後** ⇒ 只有 12 個已註冊的被動加成特性才會執行到，
//     一般卡是 0 次（早退，Rule 31）。
//
// BASE(e0c80a56) ↔ v6.258 並排實測（同機、同 fixture、N=4000×5 取中位數）：
//   BASE 0.1825 / 0.1843 ms/attack；v6.258 0.1771 / 0.1742 ms/attack ⇒ 無退化。
//   （量測腳本：scripts/perf_v6258_passive_dispatch.mjs，可對任一棵樹重跑）
//
// ⚠ 本檔在 CI 只有單一版本 ⇒ 斷言的是**絕對上限**（抓數量級退化），不是精密比較。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.p6258-s.js'), E = join(ROOT, '.p6258-e.ts'), O = join(ROOT, '.p6258-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { collectPassiveAttackBonuses } from './src/lib/game/effects';\n"
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

let seq = 0;
const I = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId, damage: 0, energyAttached: [], ...extra });
const EN = id => ({ iid: 'e' + (++seq), cardId: id });
// 最壞情況：攻擊方滿場，每一隻都印著被動加成特性 ⇒ dispatch 迴圈每一格都要跑
const mkState = () => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A',
      active: I('16513', { energyAttached: [EN('14102'), EN('14102'), EN('14102'), EN('14102')] }), // 君主蛇ex 青草命令
      bench: ['16504', '16504', '13993', '12078', '14796'].map(x => I(x)),
      hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, () => I('14797')) },
    { name: 'B', active: I('13986'), bench: [I('14797')], hand: [], deck: [], discard: [],
      prizes: Array.from({ length: 6 }, () => I('14797')) },
  ],
});

// ⚠ 正對照：這個 fixture 必須真的走到被動加成，否則量到的是空管線（Rule 33）
{
  const chk = mod.applyAction(mkState(), { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  const n = chk.log.filter(l => /」啟動：/.test(l.message ?? '')).length;
  assert.ok(n >= 2, `fixture 沒有觸發被動加成（只有 ${n} 筆）⇒ 這支量測是安慰劑`);
}

const N = 3000;
for (let i = 0; i < 500; i++) mod.applyAction(mkState(), { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
const samples = [];
for (let r = 0; r < 3; r++) {
  const states = Array.from({ length: N }, mkState);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) mod.applyAction(states[i], { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  samples.push(Number(process.hrtime.bigint() - t0) / 1e6 / N);
}
samples.sort((a, b) => a - b);
const per = samples[1];
console.log(`── v6.258 效能量測（滿場 6 隻、每隻都有被動加成特性）──`);
console.log(`  applyAction ATTACK：${N} 次 ×3 ⇒ 中位 ${per.toFixed(5)} ms/attack（min ${samples[0].toFixed(5)} / max ${samples[2].toFixed(5)}）`);

// 中央 dispatch 單獨計時（呼叫端每次攻擊只呼叫 1 次）
{
  const st = mkState();
  const atk = st.players[0].active, aCard = pool.get(atk.cardId), dCard = pool.get(st.players[1].active.cardId);
  for (let i = 0; i < 5000; i++) mod.collectPassiveAttackBonuses(st, st.players[0], 0, atk, aCard, dCard, pool);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 50000; i++) mod.collectPassiveAttackBonuses(st, st.players[0], 0, atk, aCard, dCard, pool);
  const pd = Number(process.hrtime.bigint() - t0) / 1e6 / 50000;
  console.log(`  collectPassiveAttackBonuses：50000 次 ⇒ ${pd.toFixed(6)} ms/call`);
  assert.ok(pd < 0.05, `中央 dispatch 退化：${pd.toFixed(6)} ms/call（門檻 0.05）`);
}
// 絕對上限：沙盒實測 BASE 與 v6.258 同為 0.17~0.19 ms/attack；門檻放約 10 倍吸收 CI 抖動。
assert.ok(per < 2.0, `ATTACK 主管線退化：${per.toFixed(5)} ms/attack（門檻 2.0）`);
console.log('\n✅ v6.258 效能量測通過（無數量級退化）');
