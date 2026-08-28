// v6.258 效能量測（Rule 32：效能數字必須附量測腳本）
//   比較 BASE(e0c80a56) 與 v6.258 的 ATTACK 主管線耗時。
//   用法：node perf_v6258_passive_dispatch.mjs <treeRoot> <label>
//   兩棵樹各跑一次，取相同 fixture、相同次數。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const LABEL = process.argv[3] ?? ROOT;
const S = join(ROOT, '.perf-s.js'), E = join(ROOT, '.perf-e.ts'), O = join(ROOT, '.perf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const DIR = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let seq = 0;
const I = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId, damage: 0, energyAttached: [], ...extra });
const EN = id => ({ iid: 'e' + (++seq), cardId: id });
// 最壞情況盤面：攻擊方滿場 6 隻，全部帶被動加成特性（每隻都會進 dispatch 迴圈）
const mkState = () => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A',
      active: I('16513', { energyAttached: [EN('14102'), EN('14102'), EN('14102'), EN('14102')] }), // 君主蛇ex 青草命令
      bench: ['16504', '16504', '13993', '12078', '14796'].map(x => I(x)),                          // 全是被動加成持有者
      hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, () => I('14797')) },
    { name: 'B', active: I('13986'), bench: [I('14797')], hand: [], deck: [], discard: [],          // 超級路卡利歐ex HP340
      prizes: Array.from({ length: 6 }, () => I('14797')) },
  ],
});

const N = 4000;
// warmup（JIT）
for (let i = 0; i < 500; i++) applyAction(mkState(), { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
const samples = [];
for (let r = 0; r < 5; r++) {
  const states = Array.from({ length: N }, mkState);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) applyAction(states[i], { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  const t1 = process.hrtime.bigint();
  samples.push(Number(t1 - t0) / 1e6 / N);
}
samples.sort((a, b) => a - b);
// 正確性錨：這個盤面應該真的有跑到被動加成（否則量的是空管線）
const chk = applyAction(mkState(), { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
const bonusLogs = chk.log.filter(l => /啟動：/.test(l.message ?? '')).length;
console.log(`${LABEL}: N=${N}×5  median=${samples[2].toFixed(4)} ms/attack  min=${samples[0].toFixed(4)}  max=${samples[4].toFixed(4)}  被動加成 log 筆數=${bonusLogs}`);
