// 自對局評估（診斷用，不進 CI）：新版 AI vs 基準版 AI 的勝率差。
//
// 【單變因】基準版直接取自 git HEAD 的 ai.ts —— 兩版之間**只差這一批的改動**，
//   所以勝率差可以歸因到這一批，而不是「不知道哪裡變了」。
//
// 【判準】不是「勝率 > 50% 就算贏」。小樣本下勝率點估計非常吵，
//   門檻是**勝率差的 95% 信賴區間下界 > 0**（Wilson score interval，對極端比例比
//   常態近似穩健）。下界沒過就是「這批看不出有效」，不是「有效但樣本不夠」。
//
// 【先後手公平】PTCG 先攻有優勢，所以每個配對都跑兩半：新版先攻一半、後攻一半。
//   只讓新版當先攻的話，量到的是先攻優勢不是 AI 強度。
//
// 用法：node scripts/eval-ai-selfplay.mjs [每組場數] [配對索引]
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-ev-s.js'), E = join(ROOT, '.x-ev-e.ts'), O = join(ROOT, '.x-ev-o.mjs');
const BASE = join(ROOT, 'src/lib/game/_ai_baseline.ts');
process.on('exit', () => { for (const p of [S, E, O, BASE]) { try { unlinkSync(p); } catch {} } });

// 基準版 = git HEAD 的 ai.ts（不是磁碟上的 —— 磁碟上那份已經是新版了）。
// ⚠沙盒的測試工作區是 `git archive` 展開的、沒有 .git，所以允許用環境變數指定檔案：
//   AI_BASELINE_SRC=/path/to/head_ai.ts node scripts/eval-ai-selfplay.mjs
const headAI = process.env.AI_BASELINE_SRC && existsSync(process.env.AI_BASELINE_SRC)
  ? readFileSync(process.env.AI_BASELINE_SRC, 'utf8')
  : execFileSync('git', ['-C', ROOT, 'cat-file', '-p', 'HEAD:src/lib/game/ai.ts'],
      { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
writeFileSync(BASE, headAI);

writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { getAIAction as aiNew } from './src/lib/game/ai';\n"
  + "export { getAIAction as aiOld } from './src/lib/game/_ai_baseline';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, aiNew, aiOld } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

const PRESET_SRC = readFileSync(join(ROOT, 'src/lib/decks/presets.ts'), 'utf8');
function presetEntries(id) {
  const i = PRESET_SRC.indexOf(`id: '${id}'`);
  if (i < 0) throw new Error('找不到預組 ' + id);
  const j = PRESET_SRC.indexOf('entries: [', i);
  const k = PRESET_SRC.indexOf('\n  ],', j);
  return [...PRESET_SRC.slice(j, k).matchAll(/cardId:\s*'(\d+)',\s*count:\s*(\d+)/g)]
    .map((m) => ({ cardId: m[1], count: Number(m[2]) }));
}

const MATCHUPS = [
  ['N的索羅亞克', '__preset_n_zoroark__'],
  ['魔靈多龍', '__preset_marrune_dragapult__'],
  ['超級耿鬼ex', '__preset_mbg__'],
  ['竹蘭的烈咬陸鯊EX', '__preset_cynthia_garchomp__'],
];

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 跑一場：newSeat 指定新版 AI 坐哪一側。回傳 'new' | 'old' | 'draw'。 */
function playOne(seed, entries, newSeat) {
  const orig = Math.random;
  Math.random = seeded(seed);
  try {
    let st = createGame({ name: 'A', entries }, { name: 'B', entries }, pool);
    let rejected = 0;
    for (let i = 0; i < 20000 && st.phase !== 'game-over'; i++) {
      let actor;
      if (st.phase === 'setup') {
        const mul = st.pendingMulliganDraw ?? [0, 0];
        actor = mul[0] > 0 ? 0 : (mul[1] > 0 ? 1 : (!st.setupDone[0] ? 0 : (!st.setupDone[1] ? 1 : 0)));
      } else if (st.pendingSelection) actor = st.pendingSelection.actorIdx;
      else if (st.players[0].active === null && st.players[0].bench.length > 0) actor = 0;
      else if (st.players[1].active === null && st.players[1].bench.length > 0) actor = 1;
      else actor = st.activePlayerIndex;
      const fn = actor === newSeat ? aiNew : aiOld;
      const act = fn(st, pool, actor);
      if (!act) break;
      const next = applyAction(st, act, pool);
      if (next === st) { if (++rejected > 8) break; continue; }
      rejected = 0; st = next;
    }
    if (st.phase !== 'game-over' || st.winner == null) return 'draw';
    return st.winner === newSeat ? 'new' : 'old';
  } catch {
    return 'draw';   // 例外不計入任一方，避免把 crash 算成勝負
  } finally { Math.random = orig; }
}

/** Wilson score interval 下界（比常態近似對極端比例穩健）。 */
function wilsonLower(wins, n, z = 1.96) {
  if (n === 0) return 0;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (c - s) / d;
}

const N = Number(process.argv[2] ?? 40);
const only = process.argv[3] != null ? Number(process.argv[3]) : null;
// 沙盒單次執行有時間上限，用 seed 偏移分批跑再把場次相加（各批 seed 不重疊）
const seedOff = Number(process.argv[4] ?? 0);
const list = only != null ? [MATCHUPS[only]] : MATCHUPS;

let totalNew = 0, totalOld = 0, totalDraw = 0;
for (const [name, id] of list) {
  const entries = presetEntries(id);
  let nw = 0, ow = 0, dr = 0;
  for (let s = 0; s < N; s++) {
    // 前一半新版先攻、後一半新版後攻 —— 否則量到的是先攻優勢
    const r = playOne(7717 + (s + seedOff) * 104729, entries, s < N / 2 ? 0 : 1);
    if (r === 'new') nw++; else if (r === 'old') ow++; else dr++;
  }
  totalNew += nw; totalOld += ow; totalDraw += dr;
  const dec = nw + ow;
  const lo = wilsonLower(nw, dec);
  console.log(`${name}：新版 ${nw} 勝 / 基準 ${ow} 勝 / 未分出 ${dr}`
    + `　→ 勝率 ${dec ? (nw / dec * 100).toFixed(1) : '—'}%（95% CI 下界 ${(lo * 100).toFixed(1)}%）`);
}

const dec = totalNew + totalOld;
const lo = wilsonLower(totalNew, dec);
console.log('\n=== 合計 ===');
console.log(`新版 ${totalNew} 勝 / 基準 ${totalOld} 勝 / 未分出 ${totalDraw}（有效 ${dec} 場）`);
console.log(`新版勝率 ${dec ? (totalNew / dec * 100).toFixed(1) : '—'}%，95% CI 下界 ${(lo * 100).toFixed(1)}%`);
console.log(lo > 0.5
  ? '✅ 下界 > 50% → 這批確實讓 AI 變強（不是抽樣雜訊）'
  : '⚠ 下界未超過 50% → 樣本內看不出顯著提升；要嘛加大樣本，要嘛這批沒效果。');
