#!/usr/bin/env node
/**
 * AI vs AI 自動模擬 — 抓出卡住 / 異常狀態
 *
 * 用 esbuild 把 TS source 打包成單一 ESM，然後 Node 直接跑。
 * 執行：node scripts/sim-ai-battle.mjs [局數=100]
 */

import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROUNDS = Number(process.argv[2] ?? 100);
const MAX_TURNS_PER_GAME = 200;   // 超過視為卡住
const VERBOSE = process.argv.includes('--verbose');

console.log(`⚔️  AI vs AI 模擬 — ${ROUNDS} 局\n`);

// ── Step 1: 打包 engine + ai 為 ESM ────────────────────────────────────────
const OUT = '/tmp/ptcg-work/repo/.tmp-sim-bundle.mjs';

// 建一個臨時入口，從 src 匯出需要的函式
const entry = `
  export { createGame, applyAction, hasPendingActions } from './src/lib/game/engine';
  export { GameActions } from './src/lib/game/actions';
  export { getAIAction } from './src/lib/game/ai';
`;
const ENTRY_PATH = '/tmp/ptcg-work/repo/.tmp-sim-entry.ts';
writeFileSync(ENTRY_PATH, entry);

await build({
  entryPoints: [ENTRY_PATH],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: {
    '$lib': '/tmp/ptcg-work/repo/src/lib',
    '$app/paths': '/tmp/ptcg-work/repo/scripts/shim-app-paths.mjs',
  },
  external: [],
  logLevel: 'warning',
});

unlinkSync(ENTRY_PATH);
const mod = await import(pathToFileURL(OUT).href);
const { createGame, applyAction, hasPendingActions, GameActions, getAIAction } = mod;

// ── Step 2: 載入 pool ──────────────────────────────────────────────────────
const cardsDir = '/tmp/ptcg-work/repo/static/cards';
const pool = new Map();
for (const f of readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(cardsDir, f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}

// ── Step 3: 讀 preset 牌組（直接從 presets.ts）──────────────────────────────
const PRESETS = {
  MBG: { name: '超級耿鬼ex', entries: [
    ['14129',4],['14130',2],['14151',1],['14131',2],['14132',2],['14133',1],
    ['14134',2],['14135',1],['14136',1],['14137',1],['14138',1],
    ['14139',3],['14140',4],['14141',3],['14142',1],['14143',1],['14144',1],
    ['14145',1],['14146',2],['14147',2],['14148',4],['14149',2],['14150',4],
    ['14152',14],
  ].map(([cardId, count]) => ({ cardId, count })) },
  MBD: { name: '超級蒂安希ex', entries: [
    ['14105',2],['14106',1],['14107',1],['14108',1],['14109',1],['14127',1],
    ['14110',2],['14111',1],['14112',3],['14113',3],['14114',1],
    ['14115',1],['14116',1],['14117',3],['14118',4],['14119',1],['14120',1],
    ['14121',4],['14122',2],['14123',4],['14124',2],['14125',4],['14126',2],
    ['14128',14],
  ].map(([cardId, count]) => ({ cardId, count })) },
  FIRE: { name: '破空焰ex', entries: [
    ['16622',3],['16597',2],['16554',4],['16555',2],['16593',2],['16592',2],['16607',2],
    ['17122',4],['17119',3],['17141',3],['17111',2],['17105',2],['17143',1],
    ['17134',3],['17127',1],['17195',2],['17200',4],['17165',3],['17198',1],
    ['17216',14],
  ].map(([cardId, count]) => ({ cardId, count })) },
};

// ── Step 4: 模擬一局 ───────────────────────────────────────────────────────
function simulateGame(deck1Key, deck2Key, seed) {
  Math.__mulberry_seed = seed; // 可選：用確定性 RNG
  const d1 = PRESETS[deck1Key];
  const d2 = PRESETS[deck2Key];
  let state = createGame({ name: d1.name, entries: d1.entries }, { name: d2.name, entries: d2.entries }, pool);

  let iter = 0;
  let lastStateHash = '';
  let stuckCount = 0;
  const log = [];

  while (state.phase !== 'game-over' && iter < MAX_TURNS_PER_GAME * 20) {
    iter++;
    // 決定哪位 AI 該行動
    let actorIdx;
    if (state.phase === 'setup') {
      // 有待決 mulligan 的玩家優先；否則看 setupDone
      const mul = state.pendingMulliganDraw ?? [0, 0];
      if (mul[0] > 0) actorIdx = 0;
      else if (mul[1] > 0) actorIdx = 1;
      else actorIdx = !state.setupDone[0] ? 0 : (!state.setupDone[1] ? 1 : 0);
    } else if (state.pendingSelection) {
      actorIdx = state.pendingSelection.actorIdx;
    } else {
      // 防守方可能需要送新出場
      if (state.players[0].active === null && state.players[0].bench.length > 0) actorIdx = 0;
      else if (state.players[1].active === null && state.players[1].bench.length > 0) actorIdx = 1;
      else actorIdx = state.activePlayerIndex;
    }

    const action = getAIAction(state, pool, actorIdx);
    if (!action) {
      log.push({ iter, phase: state.phase, turn: state.turn, event: 'NO_ACTION', state: snapshot(state) });
      return { outcome: 'stuck_no_action', iter, state, log };
    }

    const hash = JSON.stringify({ p: state.phase, t: state.turnPhase, tn: state.turn, a: state.activePlayerIndex, ha: state.players[0].hand.length, hb: state.players[1].hand.length, act: action.type });
    if (hash === lastStateHash) {
      stuckCount++;
      if (stuckCount > 30) {
        log.push({ iter, phase: state.phase, turn: state.turn, event: 'STUCK_LOOP', action });
        return { outcome: 'stuck_loop', iter, state, log, action };
      }
    } else {
      stuckCount = 0;
    }
    lastStateHash = hash;

    try {
      state = applyAction(state, action, pool);
    } catch (e) {
      return { outcome: 'exception', iter, state, log, error: e.message };
    }

    if (VERBOSE) log.push({ iter, phase: state.phase, turn: state.turn, action: action.type });
  }

  if (state.phase === 'game-over') {
    return { outcome: 'ended', winner: state.winner, reason: state.winReason, turns: state.turn, iter, state };
  }
  return { outcome: 'maxiter', iter, state };
}

function snapshot(s) {
  return {
    phase: s.phase, turnPhase: s.turnPhase, turn: s.turn,
    activePlayer: s.activePlayerIndex,
    pendingSelection: s.pendingSelection?.type ?? null,
    pendingPrizes: s.pendingPrizes,
    p1: { hand: s.players[0].hand.length, deck: s.players[0].deck.length, active: !!s.players[0].active, bench: s.players[0].bench.length, prizes: s.players[0].prizes.length },
    p2: { hand: s.players[1].hand.length, deck: s.players[1].deck.length, active: !!s.players[1].active, bench: s.players[1].bench.length, prizes: s.players[1].prizes.length },
  };
}

// ── Step 5: 跑 N 局 ───────────────────────────────────────────────────────
const matchups = [
  ['MBG', 'MBD'],
  ['MBG', 'FIRE'],
  ['MBD', 'FIRE'],
  ['FIRE', 'MBG'],
];

const stats = {
  total: 0, ended: 0, stuck_no_action: 0, stuck_loop: 0, maxiter: 0, exception: 0,
  earlyWin: 0, // 5 回合內結束 = 可能異常
  p1Wins: 0, p2Wins: 0,
  avgTurns: 0, samples: [],
};

for (let r = 0; r < ROUNDS; r++) {
  const [a, b] = matchups[r % matchups.length];
  const result = simulateGame(a, b, r);
  stats.total++;
  stats[result.outcome]++;
  if (result.outcome === 'ended') {
    stats.avgTurns += result.turns;
    if (result.turns <= 5) stats.earlyWin++;
    if (result.winner === 0) stats.p1Wins++;
    else if (result.winner === 1) stats.p2Wins++;
  }
  if (result.outcome !== 'ended' || result.turns <= 3) {
    stats.samples.push({ r, deck1: a, deck2: b, ...result });
  }
}
stats.avgTurns = stats.ended > 0 ? (stats.avgTurns / stats.ended).toFixed(1) : 'N/A';

console.log('\n══════ 統計 ══════');
console.log(`  總局數:       ${stats.total}`);
console.log(`  正常結束:     ${stats.ended}`);
console.log(`  卡住無動作:   ${stats.stuck_no_action}  ← 若 > 0 是 AI bug`);
console.log(`  卡住迴圈:     ${stats.stuck_loop}  ← 若 > 0 是 AI bug`);
console.log(`  例外崩潰:     ${stats.exception}`);
console.log(`  超過迭代上限: ${stats.maxiter}`);
console.log(`  異常早輸(≤5): ${stats.earlyWin}`);
console.log(`  P1 勝 / P2 勝: ${stats.p1Wins} / ${stats.p2Wins}`);
console.log(`  平均回合:     ${stats.avgTurns}`);

if (stats.samples.length > 0) {
  console.log('\n══════ 異常範例（前 10）══════');
  stats.samples.slice(0, 10).forEach(s => {
    console.log(`  局 ${s.r} [${s.deck1} vs ${s.deck2}]  outcome=${s.outcome}`);
    if (s.outcome === 'ended') console.log(`    早結束 turn=${s.turns} winner=${s.winner} reason=${s.reason}`);
    if (s.outcome === 'stuck_no_action') { console.log(`    最後 state:`, s.log[s.log.length-1]?.state); }
    if (s.outcome === 'stuck_loop') { console.log(`    action=${JSON.stringify(s.action)}`); }
    if (s.outcome === 'exception') { console.log(`    error=${s.error}`); }
  });
}

// 清理
try { unlinkSync(OUT); } catch {}
