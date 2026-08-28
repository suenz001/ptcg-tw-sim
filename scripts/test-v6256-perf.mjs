// ════════════════════════════════════════════════════════════════════════════
// v6.256 效能量測（IRON_RULES Rule 32：效能數字必須附量測腳本）
//
// 這一版動到的是**傷害管線熱路徑**：把「寫 damageTakenLastOppTurn」從
//   engine 1 處 ＋ effects.ts 1 處（另外 6 條根本沒寫）
// 收斂成 effects/_shared.ts 的 withAttackDamageTaken。
//
// 成本模型：原本就在做的物件 spread **維持 1 次**，額外只多
//   「1 次函式呼叫 ＋ 1 次減法 ＋ 1 次 Math.max ＋ 1 次字串比較」，
//   每「一隻被打到的寶可夢」一次（多目標招式最多 6 隻）。無迴圈、無新配置。
//
// 沙盒 A/B（同一台、同 workload；BASE = 20d4d6df）：見下方 CI 執行時的實測輸出。
// ⚠ 沙盒 CPU 約為正式 VM 的 1/10 量級（Rule 32），只可比相對值。
//
// CI 只做寬鬆上限斷言（共用 runner 速度不可預期，嚴格門檻＝假紅）。
// ════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6256p-s.js'), E = join(ROOT, '.v6256p-e.ts'), O = join(ROOT, '.v6256p-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const DIR = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const ID = { DIALGA: '11072', PIKA: '14704', HYDRA: '11252', HERA: '14322', UBO: '17976',
             eP: '14103', eM: '14434', eD: '14430' };
let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: Array.from({ length: 20 }, () => en(ID.eP)), discard: [],
  prizes: Array.from({ length: 6 }, () => en(ID.eP)) });
const mkS = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 5,
  isFirstTurn: false, firstPlayerIdx: 0, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, players: [p0, p1] });

const bench5 = () => [inst(ID.UBO), inst(ID.UBO), inst(ID.UBO), inst(ID.UBO), inst(ID.UBO)];
// (1) engine 主管線：單體攻擊、防守方存活（＝這一版動到的那一行）
const mkMain = () => mkS(mkP('P0', inst(ID.DIALGA, [en(ID.eP), en(ID.eM), en(ID.eP)]), bench5()),
                         mkP('P1', inst(ID.PIKA), bench5()));
// (2) effects.ts 多目標：三首惡龍ex｜黑曜石（主傷害 ＋ 對手 2 隻備戰各 130 ＝ 3 次寫入）
const mkMulti = () => mkS(mkP('P0', inst(ID.HYDRA, [en(ID.eP), en(ID.eD), en(ID.eM), en(ID.eP)]), bench5()),
                          mkP('P1', inst(ID.PIKA), [inst(ID.HERA), inst(ID.HERA), inst(ID.UBO)]));

function bench(label, make, action, resolve, N, rounds = 5) {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const states = Array.from({ length: 64 }, make);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      let st = applyAction(states[i & 63], action, pool);
      if (resolve && st.pendingSelection) {
        applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: resolve(st) }, pool);
      }
    }
    const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
    if (us < best) best = us;
  }
  console.log(`  ${label}: ${best.toFixed(2)} µs/action`);
  return best;
}

console.log('v6.256 效能量測（每輪取最小值）');
const a = bench('engine 主管線 單體攻擊（防守方存活）', mkMain, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, null, 2000);
const b = bench('多目標 黑曜石（1 主傷害 + 2 備戰，3 次中央寫入）', mkMulti,
  { type: 'ATTACK', attackIndex: 1, actorIdx: 0 },
  (st) => st.players[1].bench.slice(0, 2).map(c => c.iid), 2000);

// 寬鬆上限：只擋「O(n) 爆炸」，不擋雜訊（Rule 32：沙盒約為正式 VM 的 1/10）
assert.ok(a < 4000, `engine 主管線 ${a.toFixed(2)}µs 遠超上限 ⇒ 疑似演算法級退化`);
assert.ok(b < 6000, `多目標管線 ${b.toFixed(2)}µs 遠超上限 ⇒ 疑似演算法級退化`);
console.log('✅ v6.256 perf guard PASS');
