#!/usr/bin/env node
/**
 * AI vs AI 自動模擬 — 抓出卡住 / 異常狀態，並印出勝負原因分布與過程指標（批次 A1／A2）。
 *
 * 用 esbuild 把 TS source 打包成單一 ESM，然後 Node 直接跑（共用 scripts/lib/ai-sim-harness.mjs）。
 * 執行：node scripts/sim-ai-battle.mjs [局數=100] [--verbose]
 *
 * ⚙ 批次 A（2026-09-26）：
 *   - A1：winReason 分五類印占比（另列「輸的那一側」的敗因）。
 *   - A2：首次可攻擊回合／攻擊可用率／ATTACK 連續性／主打手主招打出比例，分勝局／敗局。
 *   - 修掉 setup 階段「雙方 setupDone 都為 true 時固定問 0」造成約 25% 局被誤判卡住的量尺 bug
 *     （改由 harness 的 nextAction：優先者回 null 時改問另一方）。
 *   - 牌組改讀 presets.ts 的 PRESET_DECKS（舊版手抄 cardId 清單，且載入了非 live 卡包）。
 */
import { fileURLToPath } from 'node:url';
import {
  buildAiBundle, loadLivePool, presetById, playGame, newAggregate, addToAggregate, printAggregate, firstPlayerOf,
} from './lib/ai-sim-harness.mjs';

const ROUNDS = Number(process.argv[2] ?? 100);
const VERBOSE = process.argv.includes('--verbose');
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

console.log(`⚔️  AI vs AI 模擬 — ${ROUNDS} 局\n`);

const mod = await buildAiBundle(REPO_ROOT);
const pool = loadLivePool(REPO_ROOT);
const ai = (st, idx) => mod.aiNew(st, pool, idx);

// 與舊版相同的三副牌：超級耿鬼ex／超級蒂安希ex 改從 PRESET_DECKS 讀；
// 破空焰ex 不是內建預組，沿用舊版手抄清單（保持與歷史數字可比）。
const FIRE_ENTRIES = [
  ['16622', 3], ['16597', 2], ['16554', 4], ['16555', 2], ['16593', 2], ['16592', 2], ['16607', 2],
  ['17122', 4], ['17119', 3], ['17141', 3], ['17111', 2], ['17105', 2], ['17143', 1],
  ['17134', 3], ['17127', 1], ['17195', 2], ['17200', 4], ['17165', 3], ['17198', 1],
  ['17216', 14],
].map(([cardId, count]) => ({ cardId, count }));
const DECKS = {
  MBG: presetById(mod, '__preset_mbg__'),
  MBD: presetById(mod, '__preset_mbd__'),
  FIRE: { id: '__sim_fire__', name: '破空焰ex', entries: FIRE_ENTRIES },
};
// ⚠ 手抄清單的卡若不在 live 卡池，createGame 會少牌 ⇒ 開跑前先檢查，免得量到的是殘缺牌組
for (const [k, d] of Object.entries(DECKS)) {
  const missing = d.entries.filter((e) => !pool.has(String(e.cardId))).map((e) => e.cardId);
  const total = d.entries.reduce((s, e) => s + e.count, 0);
  if (missing.length || total !== 60) console.log(`⚠ 牌組 ${k}：${total} 張，live 卡池缺 ${missing.join(',') || '無'}`);
}
const matchups = [['MBG', 'MBD'], ['MBG', 'FIRE'], ['MBD', 'FIRE'], ['FIRE', 'MBG']];

const stats = { total: 0, ended: 0, no_action: 0, stuck_loop: 0, maxiter: 0, exception: 0,
  earlyWin: 0, p1Wins: 0, p2Wins: 0, draws: 0, turnSum: 0, samples: [] };
const agg = newAggregate();

for (let r = 0; r < ROUNDS; r++) {
  const [a, b] = matchups[r % matchups.length];
  const seed = 9001 + r * 7919;
  // 指定先攻＋每局歸零 AI 試打種子 ⇒ 異常範例的「局 r」可以單獨重跑重現
  const res = playGame({ mod, pool, decks: [DECKS[a], DECKS[b]], agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed) });
  stats.total++;
  stats[res.outcome]++;
  addToAggregate(agg, res);
  if (res.outcome === 'ended') {
    stats.turnSum += res.turns;
    if (res.turns <= 5) stats.earlyWin++;
    if (res.winner === 0) stats.p1Wins++; else if (res.winner === 1) stats.p2Wins++; else stats.draws++;
  }
  if (res.outcome !== 'ended' || res.turns <= 3 || VERBOSE) stats.samples.push({ r, deck1: a, deck2: b, ...res });
}

console.log('══════ 統計 ══════');
console.log(`  總局數:       ${stats.total}`);
console.log(`  正常結束:     ${stats.ended}`);
console.log(`  卡住無動作:   ${stats.no_action}  ← 若 > 0 是 AI bug`);
console.log(`  卡住迴圈:     ${stats.stuck_loop}  ← 若 > 0 是 AI bug`);
console.log(`  例外崩潰:     ${stats.exception}`);
console.log(`  超過步數上限: ${stats.maxiter}`);
console.log(`  異常早結束(≤5 回合): ${stats.earlyWin}`);
console.log(`  P1 勝 / P2 勝 / 平手: ${stats.p1Wins} / ${stats.p2Wins} / ${stats.draws}`);
console.log(`  平均回合:     ${stats.ended ? (stats.turnSum / stats.ended).toFixed(1) : 'N/A'}`);

printAggregate(agg, `${ROUNDS} 局，三副舊基準牌`);

if (stats.samples.length > 0) {
  console.log('\n══════ 異常範例（前 10）══════');
  stats.samples.slice(0, 10).forEach((s) => {
    console.log(`  局 ${s.r} [${s.deck1} vs ${s.deck2}]  outcome=${s.outcome}`);
    if (s.outcome === 'ended') console.log(`    turn=${s.turns} winner=${s.winner} reason=${s.reason}`);
    if (s.outcome === 'stuck_loop' || s.outcome === 'no_action') console.log(`    最後動作=${JSON.stringify(s.lastAction)}`);
    if (s.outcome === 'exception') console.log(`    error=${s.error}`);
  });
}
