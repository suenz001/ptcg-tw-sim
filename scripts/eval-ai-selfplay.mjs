// 自對局評估（診斷用，不進 CI）：新版 AI vs 基準版 AI 的勝率差。
//
// 【單變因】基準版直接取自 git HEAD 的 ai.ts —— 兩版之間**只差這一批的改動**，
//   所以勝率差可以歸因到這一批，而不是「不知道哪裡變了」。
//
// 【判準】不是「勝率 > 50% 就算贏」。小樣本下勝率點估計非常吵，
//   門檻是**勝率差的 95% 信賴區間下界 > 0**（Wilson score interval，對極端比例比
//   常態近似穩健）。下界沒過就是「這批看不出有效」，不是「有效但樣本不夠」。
//   ⚠ 而且這個工具只能用來「否決」，不能用來「認可」（離線評估排序不可信，見批次 A 說明）。
//
// 【⭐先後手公平：必須「同一個 seed 跑兩次鏡像」】
//   PTCG 先攻有優勢。每個 seed 跑兩場，新版分別坐 0 與坐 1。同一副牌、同一個隨機序列，
//   先攻優勢在兩場之間完全抵銷，剩下的差異才是 AI 強度。
//   ⭐ 先攻方用 firstPlayerOf(seed) 明確指定（兩場同一個值），並在每局開始把 AI 試打的 _simSeed 歸零
//     ⇒ 同 seed 可重現；A/A（兩邊同一份程式）時每個 seed 恰好一勝一敗（fable 審查後修正）。
//   ⚠新增測試方法時務必先跑 A/A（兩邊同一份程式碼）確認結果落在 50% 附近，
//     否則量到的是工具的偏差。
//
// 【批次 A3（2026-09-26）】
//   - 預設每組 seed 數 40 → 400（每個 seed 兩場鏡像 ⇒ 每組 800 場）。
//     Kaggle 實例：150 局看到 54.7% 差點出貨，400 局配信賴區間是 50.5% ± 4.9%。
//   - 每一行都印出 95% 信賴區間 [下界, 上界] 與寬度；有效場數 < 400 印警告「此樣本量下的結論不可信」。
//   - 「該誰行動」改走共用 harness（修掉 setup 階段固定問 0 ⇒ 被記成「未分出」的量尺 bug）。
//
// 用法：node scripts/eval-ai-selfplay.mjs [每組 seed 數=400] [配對索引] [seed 偏移]
//   沙盒單次執行有時間上限時，可用 seed 偏移分批跑再把場次相加（各批 seed 不重疊）。
//   基準版＝git HEAD 的整組 AI 模組（src/lib/game/ai*.ts）；可用 AI_BASELINE_REV=<commit> 指定別的版本。
import { fileURLToPath } from 'node:url';
import {
  buildAiBundle, loadLivePool, presetById, playGame, wilson, pct, MIN_TRUSTED_GAMES, firstPlayerOf,
} from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mod = await buildAiBundle(ROOT, { withBaseline: true });
const pool = loadLivePool(ROOT);
const aiNew = (st, idx) => mod.aiNew(st, pool, idx);
const aiOld = (st, idx) => mod.aiOld(st, pool, idx);

const MATCHUPS = [
  ['N的索羅亞克', '__preset_n_zoroark__'],
  ['魔靈多龍', '__preset_marrune_dragapult__'],
  ['超級耿鬼ex', '__preset_mbg__'],
  ['竹蘭的烈咬陸鯊EX', '__preset_cynthia_garchomp__'],
];

/** 跑一場：newSeat 指定新版 AI 坐哪一側。回傳 'new' | 'old' | 'draw'（未分出：平手／卡住／例外）。 */
function playOne(seed, deck, newSeat) {
  const agents = newSeat === 0 ? [aiNew, aiOld] : [aiOld, aiNew];
  // maxRejects 8：沿用舊版「連續被拒 8 次就放棄」的口徑
  const r = playGame({ mod, pool, decks: [deck, deck], agents, seed, maxRejects: 8, firstPlayer: firstPlayerOf(seed) });
  if (r.outcome !== 'ended' || r.winner == null) return 'draw';
  return r.winner === newSeat ? 'new' : 'old';
}

/** 一行結果：勝率、95% CI、寬度，樣本不足時加警告。 */
function line(label, nw, ow, dr) {
  const dec = nw + ow;
  const [lo, hi] = wilson(nw, dec);
  const warn = dec < MIN_TRUSTED_GAMES ? `　⚠ 有效 ${dec} 場 < ${MIN_TRUSTED_GAMES}：此樣本量下的結論不可信` : '';
  return `${label}：新版 ${nw} 勝 / 基準 ${ow} 勝 / 未分出 ${dr}`
    + `　→ 勝率 ${dec ? pct(nw / dec) : '—'}（95% CI ${pct(lo)}～${pct(hi)}，寬 ±${((hi - lo) * 50).toFixed(1)}pp）${warn}`;
}

const N = Number(process.argv[2] ?? 400);
const only = process.argv[3] != null ? Number(process.argv[3]) : null;
const seedOff = Number(process.argv[4] ?? 0);
const list = only != null ? [MATCHUPS[only]] : MATCHUPS;

let totalNew = 0, totalOld = 0, totalDraw = 0;
for (const [name, id] of list) {
  const deck = presetById(mod, id);
  let nw = 0, ow = 0, dr = 0;
  for (let s = 0; s < N; s++) {
    // ⭐每個 seed 跑兩次鏡像：同一局分別讓新版坐 0 與坐 1，先攻優勢完全抵銷
    const seed = 7717 + (s + seedOff) * 104729;
    for (const seat of [0, 1]) {
      const r = playOne(seed, deck, seat);
      if (r === 'new') nw++; else if (r === 'old') ow++; else dr++;
    }
  }
  totalNew += nw; totalOld += ow; totalDraw += dr;
  console.log(line(name, nw, ow, dr));
}

const dec = totalNew + totalOld;
const [lo] = wilson(totalNew, dec);
console.log('\n=== 合計 ===');
console.log(line('合計', totalNew, totalOld, totalDraw));
console.log(dec < MIN_TRUSTED_GAMES
  ? `⚠ 有效場數不足 ${MIN_TRUSTED_GAMES}，不論勝率多少都不下結論。`
  : (lo > 0.5
    ? '✅ 下界 > 50% → 樣本內確實較強（⚠ 只能當「沒有變差」的佐證，不能當出貨理由）'
    : '⚠ 下界未超過 50% → 樣本內看不出顯著提升；要嘛加大樣本，要嘛這批沒效果。'));
