#!/usr/bin/env node
/**
 * 全 preset 交叉 sim — 找 bug + 排名 AI 最擅長的牌組
 *
 * 跑法：所有 preset 兩兩對打，雙向（A→B + B→A）消除先攻優勢，
 *       每對重複 ROUNDS_PER_PAIR 次。
 *
 * 執行：node scripts/sim-tournament.mjs [每對局數=1]
 */

import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const ROUNDS_PER_PAIR = Number(process.argv[2] ?? 1);
const MAX_TURNS_PER_GAME = 200;

console.log(`🏆 PTCG 全 preset 錦標賽 — 每對局數 ${ROUNDS_PER_PAIR}\n`);

const OUT = resolve(ROOT, '.tmp-tour-bundle.mjs');
const ENTRY_PATH = resolve(ROOT, '.tmp-tour-entry.ts');
const entry = `
  export { createGame, applyAction } from './src/lib/game/engine';
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
console.log(`✓ Loaded ${pool.size} cards, ${PRESET_DECKS.length} preset decks\n`);

function simulateGame(d1, d2) {
  let state = createGame({ name: d1.name, entries: d1.entries },
                         { name: d2.name, entries: d2.entries }, pool);
  let iter = 0;
  let lastHash = '';
  let stuckCount = 0;

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
    if (!action) return { outcome: 'stuck_no_action', iter };

    const hash = JSON.stringify({ p: state.phase, t: state.turnPhase, tn: state.turn,
      a: state.activePlayerIndex, ha: state.players[0].hand.length,
      hb: state.players[1].hand.length, act: action.type });
    if (hash === lastHash) {
      stuckCount++;
      if (stuckCount > 30) return { outcome: 'stuck_loop', iter, action };
    } else stuckCount = 0;
    lastHash = hash;

    try {
      state = applyAction(state, action, pool);
    } catch (e) {
      return { outcome: 'exception', iter, error: e.message };
    }
  }

  if (state.phase === 'game-over') {
    return { outcome: 'ended', winner: state.winner, turns: state.turn };
  }
  return { outcome: 'maxiter', iter };
}

// ── 跑錦標賽 ─────────────────────────────────────────────────────────────────
const stats = new Map(); // deckName → { wins, losses, ties, total }
for (const d of PRESET_DECKS) {
  stats.set(d.name, { wins: 0, losses: 0, draws: 0, total: 0,
                      asP1Wins: 0, asP1Total: 0, asP2Wins: 0, asP2Total: 0,
                      avgTurnsWon: [], bugs: 0 });
}
const bugSamples = [];
let totalGames = 0;
let totalBugs = 0;
const startTime = Date.now();

for (let i = 0; i < PRESET_DECKS.length; i++) {
  for (let j = 0; j < PRESET_DECKS.length; j++) {
    if (i === j) continue;
    const d1 = PRESET_DECKS[i];
    const d2 = PRESET_DECKS[j];
    for (let r = 0; r < ROUNDS_PER_PAIR; r++) {
      totalGames++;
      const res = simulateGame(d1, d2);
      const s1 = stats.get(d1.name);
      const s2 = stats.get(d2.name);
      s1.total++; s2.total++;
      s1.asP1Total++; s2.asP2Total++;

      if (res.outcome === 'ended') {
        if (res.winner === 0) {
          s1.wins++; s2.losses++; s1.asP1Wins++;
          s1.avgTurnsWon.push(res.turns);
        } else if (res.winner === 1) {
          s2.wins++; s1.losses++; s2.asP2Wins++;
          s2.avgTurnsWon.push(res.turns);
        } else {
          s1.draws++; s2.draws++;
        }
      } else {
        // stuck / exception / maxiter — 算雙方各 1 bug、各算一次平局
        s1.bugs++; s2.bugs++;
        totalBugs++;
        s1.draws++; s2.draws++;
        if (bugSamples.length < 20) {
          bugSamples.push({ d1: d1.name, d2: d2.name, ...res });
        }
      }
    }
  }
}
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// ── 排序輸出 ─────────────────────────────────────────────────────────────────
const ranking = [...stats.entries()].map(([name, s]) => {
  const winRate = s.total > 0 ? (s.wins / s.total * 100) : 0;
  const p1Rate = s.asP1Total > 0 ? (s.asP1Wins / s.asP1Total * 100) : 0;
  const p2Rate = s.asP2Total > 0 ? (s.asP2Wins / s.asP2Total * 100) : 0;
  const avgTurns = s.avgTurnsWon.length > 0
    ? (s.avgTurnsWon.reduce((a, b) => a + b, 0) / s.avgTurnsWon.length).toFixed(1) : '–';
  return { name, ...s, winRate, p1Rate, p2Rate, avgTurns };
}).sort((a, b) => b.winRate - a.winRate);

console.log(`\n✓ 完成 ${totalGames} 局，共 ${elapsed}s\n`);
console.log('══════════ 牌組勝率排名 (按總勝率) ══════════');
console.log('排名 牌組                       勝/敗/平  勝率   先攻勝率 後攻勝率 平均勝場回合 bug');
console.log('---- -------------------------- --------  -----  -------- -------- ------------ ---');
ranking.forEach((r, i) => {
  const rank = String(i + 1).padStart(2, ' ');
  const name = r.name.padEnd(26, '　');
  const wld = `${r.wins}/${r.losses}/${r.draws}`.padEnd(8, ' ');
  const wr = r.winRate.toFixed(1).padStart(5, ' ');
  const p1 = r.p1Rate.toFixed(1).padStart(7, ' ');
  const p2 = r.p2Rate.toFixed(1).padStart(7, ' ');
  const avg = String(r.avgTurns).padStart(11, ' ');
  const bug = String(r.bugs).padStart(3, ' ');
  console.log(`${rank}.  ${name} ${wld} ${wr}%  ${p1}% ${p2}% ${avg} ${bug}`);
});

console.log(`\n總場數: ${totalGames}, 總 bug: ${totalBugs}`);

if (bugSamples.length > 0) {
  console.log('\n══════ Bug 範例（前 20）══════');
  bugSamples.forEach((b, i) => {
    console.log(`  ${i+1}. [${b.d1} vs ${b.d2}] outcome=${b.outcome} iter=${b.iter}` +
                (b.error ? ` error=${b.error}` : '') +
                (b.action ? ` action=${b.action.type}` : ''));
  });
}

try { unlinkSync(OUT); } catch {}
