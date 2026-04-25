#!/usr/bin/env node
/**
 * AI vs AI 自動模擬（sandbox 版）— 抓出卡住 / 異常狀態
 * 對 sim-ai-battle.mjs 的差異：
 *   - 用 process.cwd() / __dirname 而非 hardcoded E:/ 路徑
 *   - matchups 加入 v2.133 的 ELECTRIC_SPIDER + MEGA_KANGASKHAN_OGERPON 兩組
 *   - 從 PRESET_DECKS 動態拉牌組（不需手刻 cardId 列表）
 * 執行：node scripts/sim-sandbox.mjs [局數=20]
 */

import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const ROUNDS = Number(process.argv[2] ?? 20);
const MAX_TURNS_PER_GAME = 200;
const VERBOSE = process.argv.includes('--verbose');

console.log(`⚔️  AI vs AI 模擬 (sandbox) — ${ROUNDS} 局\n`);

const OUT = resolve(ROOT, '.tmp-sim-bundle.mjs');
const ENTRY_PATH = resolve(ROOT, '.tmp-sim-entry.ts');

const entry = `
  export { createGame, applyAction, hasPendingActions } from './src/lib/game/engine';
  export { GameActions } from './src/lib/game/actions';
  export { getAIAction } from './src/lib/game/ai';
  export { PRESET_DECKS } from './src/lib/decks/presets';
`;
writeFileSync(ENTRY_PATH, entry);

await build({
  entryPoints: [ENTRY_PATH],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: {
    '$lib': resolve(ROOT, 'src/lib'),
    '$app/paths': resolve(ROOT, 'scripts/shim-app-paths.mjs'),
  },
  external: [],
  logLevel: 'warning',
});

unlinkSync(ENTRY_PATH);
const mod = await import(pathToFileURL(OUT).href);
const { createGame, applyAction, getAIAction, PRESET_DECKS } = mod;

const cardsDir = resolve(ROOT, 'static/cards');
const pool = new Map();
for (const f of readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(cardsDir, f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}

console.log(`✓ Loaded ${pool.size} cards, ${PRESET_DECKS.length} preset decks`);

const ELECTRIC = PRESET_DECKS.find(d => d.id === '__preset_electric_spider__');
const KANGASKHAN = PRESET_DECKS.find(d => d.id === '__preset_mega_kangaskhan_ogerpon__');
const RAKI = PRESET_DECKS.find(d => d.id === '__preset_raki_typhlosion__');
const ROCKET_HK = PRESET_DECKS.find(d => d.id === '__preset_rocket_honchkrow__');
const DRAGAPULT = PRESET_DECKS.find(d => d.name?.includes('魔靈多龍'));
const N_ZOROARK = PRESET_DECKS.find(d => d.name === 'N的索羅亞克');

if (!RAKI || !ROCKET_HK) {
  console.error('找不到 v2.135 新預組:', 'RAKI=', !!RAKI, 'ROCKET_HK=', !!ROCKET_HK);
  process.exit(1);
}

const matchups = [
  [RAKI, ROCKET_HK],
  [RAKI, KANGASKHAN ?? DRAGAPULT],
  [ROCKET_HK, RAKI],
  [ROCKET_HK, N_ZOROARK ?? ELECTRIC],
  [RAKI, DRAGAPULT ?? KANGASKHAN],
  [ROCKET_HK, ELECTRIC ?? KANGASKHAN],
];

function simulateGame(d1, d2, seed) {
  let state = createGame({ name: d1.name, entries: d1.entries }, { name: d2.name, entries: d2.entries }, pool);
  let iter = 0;
  let lastStateHash = '';
  let stuckCount = 0;
  const log = [];

  while (state.phase !== 'game-over' && iter < MAX_TURNS_PER_GAME * 20) {
    iter++;
    let actorIdx;
    if (state.phase === 'setup') {
      const mul = state.pendingMulliganDraw ?? [0, 0];
      if (mul[0] > 0) actorIdx = 0;
      else if (mul[1] > 0) actorIdx = 1;
      else actorIdx = !state.setupDone[0] ? 0 : (!state.setupDone[1] ? 1 : 0);
    } else if (state.pendingSelection) {
      actorIdx = state.pendingSelection.actorIdx;
    } else {
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
      return { outcome: 'exception', iter, state, log, error: e.message, stack: e.stack };
    }

    log.push({ iter, ph: state.phase, t: state.turnPhase, tn: state.turn, ap: state.activePlayerIndex, act: action.type, actor: actorIdx, p1A: !!state.players[0].active, p1B: state.players[0].bench.length, p2A: !!state.players[1].active, p2B: state.players[1].bench.length });
    if (log.length > 80) log.shift();
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

const stats = {
  total: 0, ended: 0, stuck_no_action: 0, stuck_loop: 0, maxiter: 0, exception: 0,
  earlyWin: 0, p1Wins: 0, p2Wins: 0,
  avgTurns: 0, samples: [],
};

for (let r = 0; r < ROUNDS; r++) {
  const [d1, d2] = matchups[r % matchups.length];
  const result = simulateGame(d1, d2, r);
  stats.total++;
  stats[result.outcome]++;
  if (result.outcome === 'ended') {
    stats.avgTurns += result.turns;
    if (result.turns <= 5) stats.earlyWin++;
    if (result.winner === 0) stats.p1Wins++;
    else if (result.winner === 1) stats.p2Wins++;
  }
  if (result.outcome !== 'ended' || result.turns <= 3) {
    stats.samples.push({ r, deck1: d1.name, deck2: d2.name, ...result });
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
    if (s.outcome === 'stuck_loop') {
      console.log(`    action=${JSON.stringify(s.action)}`);
      console.log(`    state=`, snapshot(s.state));
      console.log(`    最後 8 步：`);
      s.log.slice(-8).forEach(L => console.log(`      `, L));
    }
    if (s.outcome === 'exception') {
      console.log(`    error=${s.error}`);
      if (s.stack) console.log(`    stack=${s.stack.split('\n').slice(0, 5).join(' | ')}`);
    }
  });
}

try { unlinkSync(OUT); } catch {}
