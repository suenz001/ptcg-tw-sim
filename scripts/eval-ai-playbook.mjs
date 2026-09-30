// 打法表效果評估（AI 從回放學打法 批次 5；診斷用，不進 CI，不動 src/）。
//
// 問題：N的索羅亞克ex 打法表（static/ai-playbooks/n-zoroark-ex.json，v6.038 起接上「備戰優先序」）到底有沒有讓 AI 變強？
// 做法：同一份 AI 程式（工作樹 ai.ts），只差「有沒有載入打法表」，配對 seed 對打：
//   受測方拿 N的索羅亞克 預組；對手是同一份 AI（通用，打法表對它的牌組不適用 ⇒ 等於沒有）拿對手池的牌。
//   每個 seed 兩場（受測方先攻一場、後攻一場，先攻方固定由 seed 決定 ⇒ 先攻優勢抵銷）。
//   同一個 seed 跑「有表」與「無表」兩次 ⇒ 配對差 d = 勝(有表) − 勝(無表) ∈ {−1, 0, 1}。
// 判準（專案紀錄 project-ai-learn-from-replays 批次 5）：每個對手 500 場，勝率差的 95% CI **下界 > 0** 才算有效；
//   點估計為正不算數。三個對手都要看，另外看「任何一個對手顯著變差」（上界 < 0）＝否決。
//
// 用法：node scripts/eval-ai-playbook.mjs [--seeds 250] [--opps 0,1,2] [--save out.json]
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf, pct } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('--seeds', 250));
const SAVE = arg('--save', null);
const OPPS_ALL = [
  ['胡地', '__preset_alakazam__'],
  ['瑪俐的長毛巨魔ex', '__preset_marnie_scrafty__'],
  ['魔靈多龍', '__preset_marrune_dragapult__'],
  ['呆呆王', '__preset_slowking__'],
  ['超級路卡利歐', '__preset_mega_lucario__'],
];
const OPPS = String(arg('--opps', '0,1,2')).split(',').map(Number).map((i) => OPPS_ALL[i]);

const mod = await buildAiBundle(ROOT, { extraExports: [
  "export { setPlaybook, clearPlaybook, isUsablePlaybook, playbookApplies, getPlaybook } from './src/lib/game/ai-playbook';",
] });
const pool = loadLivePool(ROOT);
const PB = JSON.parse(readFileSync(join(ROOT, 'static/ai-playbooks/n-zoroark-ex.json'), 'utf8'));
if (!mod.isUsablePlaybook(PB)) throw new Error('打法表格式不合法');
const ZDECK = presetById(mod, '__preset_n_zoroark__');
const ai = (st, idx) => mod.aiNew(st, pool, idx);

function run(withTable, oppDeck, seed, seat) {
  if (withTable) mod.setPlaybook(PB); else mod.clearPlaybook();
  if (mod.__resetNew) mod.__resetNew();
  const decks = seat === 0 ? [ZDECK, oppDeck] : [oppDeck, ZDECK];
  const r = playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed) });
  mod.clearPlaybook();
  if (r.outcome !== 'ended' || r.winner == null) return null;
  return r.winner === seat ? 1 : 0;
}

const out = { seeds: SEEDS, gamesPerOpp: SEEDS * 2, at: new Date().toISOString(), rows: [] };
const t0 = Date.now();
for (const [oname, oid] of OPPS) {
  const oppDeck = presetById(mod, oid);
  let wA = 0, wB = 0, n = 0, und = 0, changed = 0; const ds = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 777001 + s * 104729;
    for (const seat of [0, 1]) {
      const a = run(true, oppDeck, seed, seat), b = run(false, oppDeck, seed, seat);
      if (a == null || b == null) { und++; continue; }
      n++; wA += a; wB += b; ds.push(a - b); if (a !== b) changed++;
    }
    if ((s + 1) % 25 === 0) process.stdout.write(`  ${oname} ${s + 1}/${SEEDS} 有表 ${pct(wA / n)} 無表 ${pct(wB / n)}（${((Date.now() - t0) / 1000).toFixed(0)}s）\n`);
  }
  const mean = ds.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(ds.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const row = { opp: oname, n, undecided: und, winWith: wA / n, winWithout: wB / n, diff: mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, changedGames: changed };
  out.rows.push(row);
  console.log(`【${oname}】n=${n}（未分出 ${und}） 有表 ${pct(row.winWith)}／無表 ${pct(row.winWithout)}  差 ${pct(mean)}  95%CI [${pct(row.lo)}, ${pct(row.hi)}]  結果不同的場 ${changed}`);
}
const pass = out.rows.every((r) => r.lo > 0);
const veto = out.rows.some((r) => r.hi < 0);
out.verdict = veto ? 'VETO（有對手顯著變差）' : pass ? 'PASS（每個對手 CI 下界 > 0）' : '未達門檻（CI 跨 0）';
console.log('\n判定：' + out.verdict + `  （總耗時 ${((Date.now() - t0) / 60000).toFixed(1)} 分）`);
if (SAVE) writeFileSync(SAVE, JSON.stringify(out, null, 2));
