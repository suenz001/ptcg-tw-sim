// 對手池評估（批次 A4；診斷用，不進 CI，不動 src/）。
//
// 【輸出】對戰矩陣：列＝「受測 AI（工作樹的 ai.ts）」拿哪一副牌，
//   欄＝「基準 AI（git HEAD 的 ai.ts）」拿哪一副牌，最後一欄是「隨機合法動作 agent」（地板）。
//   每一格＝受測 AI 的勝率（每個 seed 跑兩場鏡像，新版分別坐先攻與後攻，先攻優勢抵銷）。
//
// 【⭐判準：看矩陣的最低格，不看平均】
//   Kaggle 實例：某隊整體勝率 57.28%，對某一個原型只有 25.58%，而那個原型是官方前 10 裡兩隊的主力。
//   這個工具的用途只有兩個：
//     1. 抓災難：某一格崩掉（< 30%，或對隨機 agent 沒有壓倒性勝率）
//     2. 抓回歸：用 --compare 對照舊矩陣，某一格顯著下降（兩比例 z < −1.96）
//   ⚠ 不能用「平均上升」當出貨理由——離線評估的排序本身不可信（有人把上線大輸 162 分的版本評在贏家之上）。
//
// 【⚠ 同一副牌的格子（對角線）在 A/A 時必然是 50%】
//   兩邊同一份程式碼＋同一副牌＋同一個 seed ⇒ 兩場鏡像的勝方座位相同 ⇒ 恰好一勝一敗。
//   所以對角線只有在受測 AI 與基準 AI 真的不同時才有資訊量。
//
// 用法：node scripts/eval-ai-pool.mjs [--seeds 50] [--save out.json] [--compare old.json] [--only 列索引]
//   --seeds：每一格跑幾個 seed（×2 場鏡像）。預設 50 ⇒ 每格 100 場（抓崩盤夠用；單格 95% CI 約 ±10pp）。
//   ⚠ 沙盒沒有 .git 時用 AI_BASELINE_SRC=/path/to/head_ai.ts 指定基準版。
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildAiBundle, loadLivePool, presetById, playGame, makeRandomAgent, wilson, twoPropZ, pct, padW,
  newAggregate, addToAggregate, printAggregate, MIN_TRUSTED_GAMES,
} from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('--seeds', 50));
const SAVE = arg('--save', null);
const COMPARE = arg('--compare', null);
const ONLY = arg('--only', null);

// 對手池（站長核可的建議組合）；隨機 agent 另外加在最後一欄
const DECK_IDS = [
  ['胡地', '__preset_alakazam__'],
  ['呆呆王', '__preset_slowking__'],
  ['超級路卡利歐', '__preset_mega_lucario__'],
  ['瑪俐的長毛巨魔ex', '__preset_marnie_scrafty__'],
  ['魔靈多龍', '__preset_marrune_dragapult__'],
];
const DISASTER = 0.30;          // 任一格低於 30% ⇒ 災難
const RANDOM_FLOOR = 0.90;      // 對隨機 agent 應該壓倒性勝利；低於 90% ⇒ 那副牌的 AI 駕駛有根本問題

const mod = await buildAiBundle(ROOT, { withBaseline: true });
const pool = loadLivePool(ROOT);
const aiNew = (st, idx) => mod.aiNew(st, pool, idx);
const aiOld = (st, idx) => mod.aiOld(st, pool, idx);
const decks = DECK_IDS.map(([name, id]) => ({ name, deck: presetById(mod, id) }));
const cols = [...decks.map((d) => d.name), '隨機agent'];

const cells = {};   // cells[row][col] = { w, l, d }
const agg = newAggregate();   // 只統計受測 AI 那一側（A1／A2 在更多樣牌組上的版本）
const t0 = Date.now();
const rows = ONLY != null ? [decks[Number(ONLY)]] : decks;
for (const row of rows) {
  cells[row.name] = {};
  for (let c = 0; c < cols.length; c++) {
    const isRandom = c === decks.length;
    // 隨機欄：隨機 agent 拿與列相同的牌（地板＝同一副牌、對手亂打）
    const oppDeck = isRandom ? row.deck : decks[c].deck;
    const oppAgent = isRandom ? makeRandomAgent(mod, pool) : aiOld;
    let w = 0, l = 0, d = 0;
    for (let s = 0; s < SEEDS; s++) {
      const seed = 424243 + s * 104729 + c * 7;
      for (const seat of [0, 1]) {
        const agents = seat === 0 ? [aiNew, oppAgent] : [oppAgent, aiNew];
        const deckPair = seat === 0 ? [row.deck, oppDeck] : [oppDeck, row.deck];
        const r = playGame({ mod, pool, decks: deckPair, agents, seed });
        if (!isRandom) addToAggregate(agg, r, [seat]);
        if (r.outcome !== 'ended' || r.winner == null) d++;
        else if (r.winner === seat) w++; else l++;
      }
    }
    cells[row.name][cols[c]] = { w, l, d };
  }
  process.stderr.write(`  列「${row.name}」完成（累計 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）\n`);
}

// ── 印矩陣 ────────────────────────────────────────────────────────────────
const W = 18;
console.log(`\n══════ A4 對手池矩陣（受測 AI 勝率；每格 ${SEEDS * 2} 場鏡像）══════`);
console.log(padW('受測↓ ／ 基準→', 18) + cols.map((c) => padW(c, W)).join(''));
let minCell = null;
const flags = [];
for (const row of rows) {
  let lineStr = padW(row.name, 18);
  for (const col of cols) {
    const { w, l, d } = cells[row.name][col];
    const n = w + l;
    const p = n ? w / n : NaN;
    lineStr += padW(`${pct(p, 0)}${d ? `(未${d})` : ''}`, W);
    const isRandom = col === '隨機agent';
    if (!isRandom && n && (!minCell || p < minCell.p)) minCell = { row: row.name, col, p, n, w };
    if (!isRandom && n && p < DISASTER) flags.push(`🔴 災難格：${row.name} vs ${col} 只有 ${pct(p)}（${w}/${n}）`);
    if (isRandom && n && p < RANDOM_FLOOR) flags.push(`🔴 地板失守：${row.name} 對隨機 agent 只有 ${pct(p)}（${w}/${n}）`);
  }
  console.log(lineStr);
}
const all = rows.flatMap((r) => cols.filter((c) => c !== '隨機agent').map((c) => cells[r.name][c]));
const tw = all.reduce((s, x) => s + x.w, 0), tn = all.reduce((s, x) => s + x.w + x.l, 0);
if (minCell) {
  const [lo, hi] = wilson(minCell.w, minCell.n);
  console.log(`\n⭐ 最低格：${minCell.row} vs ${minCell.col} = ${pct(minCell.p)}（95% CI ${pct(lo)}～${pct(hi)}）← 看這一格，不看平均`);
}
console.log(`  （平均 ${tn ? pct(tw / tn) : '—'} 只供參考${tn < MIN_TRUSTED_GAMES ? `；⚠ 合計有效 ${tn} 場 < ${MIN_TRUSTED_GAMES}，不可信` : ''}）`);
for (const f of flags) console.log(f);
if (!flags.length) console.log('  無災難格、地板未失守。');

// ── 對照舊矩陣（抓回歸）──────────────────────────────────────────────────
if (COMPARE) {
  const old = JSON.parse(readFileSync(COMPARE, 'utf8'));
  console.log(`\n══════ 對照 ${COMPARE}（z < −1.96 ＝ 顯著下降）══════`);
  if (old.seeds !== SEEDS) console.log(`  ⚠ 舊矩陣每格 ${old.seeds} 個 seed、這次 ${SEEDS} 個：樣本量不同，請用相同 --seeds 重跑再比`);
  let regress = 0;
  for (const row of rows) for (const col of cols) {
    const a = old.cells?.[row.name]?.[col], b = cells[row.name][col];
    if (!a) continue;
    const na = a.w + a.l, nb = b.w + b.l;
    const z = twoPropZ(a.w, na, b.w, nb);
    const mark = z < -1.96 ? '🔴 回歸' : (z > 1.96 ? '（上升，僅供參考）' : '');
    if (z < -1.96) regress++;
    console.log(`  ${padW(row.name + ' vs ' + col, 34)} ${pct(na ? a.w / na : NaN)} → ${pct(nb ? b.w / nb : NaN)}  z=${z.toFixed(2)} ${mark}`);
  }
  console.log(regress ? `🔴 共 ${regress} 格顯著下降 ⇒ 否決` : '✅ 沒有任何一格顯著下降（⚠ 這不是出貨理由，只是沒有被否決）');
}

printAggregate(agg, `受測 AI 那一側，${rows.length} 副牌 × ${cols.length - 1} 副對手`);

if (SAVE) {
  writeFileSync(SAVE, JSON.stringify({ seeds: SEEDS, cols, cells, createdAt: new Date().toISOString() }, null, 2));
  console.log(`\n已存矩陣：${SAVE}（之後用 --compare 對照）`);
}
