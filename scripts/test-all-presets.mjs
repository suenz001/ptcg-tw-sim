#!/usr/bin/env node
/**
 * All Preset Deck Matchup Tester
 * 兩兩對戰：37 preset decks → N*(N-1) = 1332 games
 * 每場先手隨機，雙方皆為 AI (getAIAction)
 * 追蹤：勝率、bug次數、stuck次數、平手
 *
 * Run: node scripts/test-all-presets.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-all-presets-bundle.mjs');
const ENTRY_PATH = join(REPO_ROOT, '.tmp-all-presets-entry.ts');

function safeUnlink(path) {
  try { unlinkSync(path); } catch {}
}
process.on('exit', () => { safeUnlink(ENTRY_PATH); safeUnlink(OUT); });

writeFileSync(ENTRY_PATH, `
export { createGame, applyAction } from './src/lib/game/engine';
export { getAIAction } from './src/lib/game/ai';
`);

await build({
  entryPoints: [ENTRY_PATH],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: {
    '$lib': join(REPO_ROOT, 'src/lib'),
    '$app/paths': join(REPO_ROOT, 'scripts/shim-app-paths.mjs'),
  },
  external: [],
  logLevel: 'warning',
});
safeUnlink(ENTRY_PATH);

const { createGame, applyAction, getAIAction } = await import(new URL(OUT, 'file://').href);

// ── Load card pool ────────────────────────────────────────────────────────────
const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}
console.error(`[info] Pool loaded: ${pool.size} cards`);

// ── Parse presets.ts manually ─────────────────────────────────────────────────
const src = readFileSync(join(REPO_ROOT, 'src/lib/decks/presets.ts'), 'utf8');

// Extract deck entries by finding the "entries: [...]" block
function extractEntries(block) {
  const entries = [];
  // Find "entries: [" then count brackets to find the closing ]
  const start = block.indexOf('entries: [');
  if (start === -1) return null;
  let depth = 0;
  let i = start + 'entries: ['.length;
  let inString = false;
  while (i < block.length) {
    const ch = block[i];
    if (ch === '"' && block[i-1] !== '\\') inString = !inString;
    if (!inString) {
      if (ch === '[') depth++;
      else if (ch === ']') {
        if (depth === 0) { i++; break; }
        depth--;
      } else if (ch === '{') {
        depth++;
        // capture the whole entry object
        let entryDepth = 1;
        let j = i + 1;
        while (j < block.length && entryDepth > 0) {
          const ec = block[j];
          if (ec === '"' && block[j-1] !== '\\') inString = !inString;
          if (!inString) {
            if (ec === '{') entryDepth++;
            else if (ec === '}') { entryDepth--; if (entryDepth === 0) break; }
          }
          j++;
        }
        const entryStr = block.slice(i, j + 1);
        const cidMatch = /cardId:\s*'([^']+)'/.exec(entryStr);
        const cntMatch = /count:\s*(\d+)/.exec(entryStr);
        if (cidMatch && cntMatch) {
          entries.push({ cardId: cidMatch[1], count: parseInt(cntMatch[1]) });
        }
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return entries;
}

const DECK_VARS = [
  'GENGAR', 'DIANCIE', 'CYNTHIA_GARCHOMP', 'MARRUNE_DRAGAPULT', 'ALAKAZAM',
  'MARNIE_SCRAFTY', 'ROCKET_MEWTWO', 'THUNDER_DRUM', 'SLOWKING', 'MEGA_LUCARIO',
  'OLIVA', 'ALLOY_BRIDGE_DRAGON', 'STARMIE', 'N_ZOROARK', 'BLAZIKEN_DRAGAPULT',
  'OKIDOGI', 'SALAZZLE', 'CERULEDGE', 'MEGA_GRENINJA', 'ELECTRIC_SPIDER',
  'MEGA_KANGASKHAN_OGERPON', 'RAKI_TYPHLOSION', 'ROCKET_HONCHKROW', 'MEGA_LOPUNNY',
  'HONEY_SERPERIOR', 'FLAREON', 'FESTIVAL_LEAD', 'STEVEN_METAGROSS',
  'DUDUNSPARCE_DRAGAPULT', 'MEGANIUM', 'ESPEON', 'METAGROSS_ROCKET',
  'KANGASKHAN_BOUFFALANT', 'LILLIE_CLEFAIRY', 'MEGA_VENUSAUR', 'MEGA_KANGASKHAN_ABSOL',
  'BRONZONG_DRAGAPULT',
];

const deckSpecs = [];
for (const v of DECK_VARS) {
  // Find the deck const block (from "const V_DECK:" to the closing "};")
  const deckRe = new RegExp(`const\\s+${v}_DECK\\s*:\\s*Omit<[^>]+>\\s*=\\s*\\{`, 'g');
  const match = deckRe.exec(src);
  if (!match) {
    console.error(`[warn] Could not find deck block for ${v}`);
    continue;
  }
  const start = match.index;
  // Find the matching closing };
  let depth = 0;
  let i = start;
  let found = false;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { found = true; break; }
    }
    i++;
  }
  if (!found) continue;
  const block = src.slice(start, i + 1);

  const idMatch = /id:\s*'([^']+)'/.exec(block);
  const nameMatch = /name:\s*'([^']+)'/.exec(block);
  const entries = extractEntries(block);

  if (!idMatch || !nameMatch || !entries || entries.length === 0) {
    console.error(`[warn] Failed to parse ${v}: id=${!!idMatch} name=${!!nameMatch} entries=${entries?.length}`);
    continue;
  }

  deckSpecs.push({ id: idMatch[1], name: nameMatch[1], entries });
}

console.error(`[info] Loaded ${deckSpecs.length} deck specs`);
for (const d of deckSpecs) {
  const total = d.entries.reduce((s, e) => s + e.count, 0);
  console.error(`  ${d.id}: ${d.name} (${total} cards, ${d.entries.length} types)`);
}

// ── Game Loop ─────────────────────────────────────────────────────────────────
const MAX_TURNS = 200;
const MAX_ACTIONS = 4000;

function runGame(spec1, spec2) {
  let state;
  try {
    state = createGame(
      { name: spec1.name, entries: spec1.entries },
      { name: spec2.name, entries: spec2.entries },
      pool
    );
  } catch (e) {
    return { error: `createGame: ${e.message}`, winner: null, turns: 0 };
  }

  let actionCount = 0;
  const errors = [];

  while (state.phase !== 'game-over' && actionCount < MAX_ACTIONS) {
    if (state.phase === 'setup') {
      // Setup phase: both players act simultaneously — call both every round
      let progressMade = false;
      for (const pIdx of [0, 1]) {
        if (state.setupDone[pIdx] && (state.pendingMulliganDraw?.[pIdx] ?? 0) === 0) continue;
        const aiAction = getAIAction(state, pool, pIdx);
        if (aiAction !== null) {
          try {
            state = applyAction(state, aiAction, pool);
          } catch (e) {
            errors.push(`apply:${aiAction.type}: ${e.message}`);
            return { error: errors[errors.length-1], winner: null, turns: state.turn, errors };
          }
          actionCount++;
          progressMade = true;
        }
      }
      if (!progressMade) {
        // Both players have nothing to do but phase isn't 'playing' → stuck
        errors.push(`setup_stuck@turn=${state.turn},setupDone=[${state.setupDone}],mulligan=[${state.pendingMulliganDraw}]`);
        return { error: errors[errors.length-1], winner: null, turns: state.turn, errors };
      }
      continue;
    }

    // Playing phase: mimic browser tickAI shouldAct logic for both AI players.
    // Important: after KO, the defending player may need to SEND_NEW_ACTIVE even
    // though it is not their turn. Calling only activePlayerIndex causes false stuck.
    let playerIdx = null;
    if (state.pendingPrizes > 0) {
      playerIdx = state.activePlayerIndex;
    } else if (state.pendingSelection) {
      playerIdx = state.pendingSelection.actorIdx;
    } else if (state.players[0].active === null && state.players[0].bench.length > 0) {
      playerIdx = 0;
    } else if (state.players[1].active === null && state.players[1].bench.length > 0) {
      playerIdx = 1;
    } else {
      playerIdx = state.activePlayerIndex;
    }

    const aiAction = getAIAction(state, pool, playerIdx);

    if (aiAction === null) {
      if (state.turnPhase === 'end' && state.pendingPrizes === 0 && !state.pendingSelection) {
        // Browser fallback only works when no forced choice/new active is pending.
        try {
          state = applyAction(state, { type: 'END_TURN' }, pool);
        } catch (e) {
          errors.push(`END_TURN: ${e.message}`);
          break;
        }
        actionCount++;
        continue;
      }
      errors.push(`AI_null@phase=${state.phase},turnPhase=${state.turnPhase},player=${playerIdx},turn=${state.turn},activeNull=[${state.players[0].active===null},${state.players[1].active===null}],pendingPrizes=${state.pendingPrizes},pendingSelection=${state.pendingSelection?.kind ?? ''}`);
      break;
    }

    const before = JSON.stringify(state);
    try {
      state = applyAction(state, aiAction, pool);
    } catch (e) {
      errors.push(`apply:${aiAction.type}: ${e.message}`);
      break;
    }
    const after = JSON.stringify(state);
    if (before === after) {
      errors.push(`no_state_change:${aiAction.type}@turn=${state.turn},phase=${state.phase},turnPhase=${state.turnPhase},player=${playerIdx}`);
      break;
    }
    actionCount++;
  }

  if (actionCount >= MAX_ACTIONS) {
    return { error: `max_actions(${MAX_ACTIONS})`, winner: null, turns: state.turn };
  }
  if (state.phase !== 'game-over') {
    return { error: `not_over@turn=${state.turn},phase=${state.phase}`, winner: null, turns: state.turn, errors };
  }

  return {
    winner: state.winner,
    turns: state.turn,
    actions: actionCount,
    errors,
  };
}

// ── Run all matchups ───────────────────────────────────────────────────────────
const N = deckSpecs.length;
const pairs = [];
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    pairs.push([i, j]);
  }
}

const TOTAL_PAIRS = pairs.length;
let totalGames = 0;
let totalBugs = 0;
const BUG_GAMES = [];

const stats = new Map();
for (const d of deckSpecs) {
  stats.set(d.id, { id: d.id, name: d.name, wins: 0, losses: 0, ties: 0, bugs: 0, games: 0 });
}

const PROGRESS_INTERVAL = Math.max(1, Math.floor(TOTAL_PAIRS / 20));
console.error(`\n[info] Running ${TOTAL_PAIRS} pairs × 2 = ${TOTAL_PAIRS * 2} games...`);
console.error('──────────────────────────────────────────');

for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
  const [i, j] = pairs[pairIdx];
  const specA = deckSpecs[i];
  const specB = deckSpecs[j];

  // A (P1) vs B (P2)
  const r1 = runGame(specA, specB);
  totalGames++;
  stats.get(specA.id).games++;
  stats.get(specB.id).games++;
  const w1 = r1.winner ?? null; // null = tie / error
  if (w1 === 0) { stats.get(specA.id).wins++; stats.get(specB.id).losses++; }
  else if (w1 === 1) { stats.get(specB.id).wins++; stats.get(specA.id).losses++; }
  else { stats.get(specA.id).ties++; stats.get(specB.id).ties++; }
  if (r1.error || (r1.errors && r1.errors.length > 0)) {
    totalBugs++;
    stats.get(specA.id).bugs++;
    BUG_GAMES.push({ p1: specA.name, p2: specB.name, side: 'A_P1', error: r1.error, errors: r1.errors || [], turns: r1.turns || 0 });
  }

  // B (P1) vs A (P2)
  const r2 = runGame(specB, specA);
  totalGames++;
  stats.get(specB.id).games++;
  stats.get(specA.id).games++;
  const w2 = r2.winner ?? null;
  if (w2 === 0) { stats.get(specB.id).wins++; stats.get(specA.id).losses++; }
  else if (w2 === 1) { stats.get(specA.id).wins++; stats.get(specB.id).losses++; }
  else { stats.get(specB.id).ties++; stats.get(specA.id).ties++; }
  if (r2.error || (r2.errors && r2.errors.length > 0)) {
    totalBugs++;
    stats.get(specB.id).bugs++;
    BUG_GAMES.push({ p1: specB.name, p2: specA.name, side: 'B_P1', error: r2.error, errors: r2.errors || [], turns: r2.turns || 0 });
  }

  if ((pairIdx + 1) % PROGRESS_INTERVAL === 0 || pairIdx + 1 === TOTAL_PAIRS) {
    process.stderr.write(`  ${pairIdx + 1}/${TOTAL_PAIRS} pairs (${totalGames} games, ${totalBugs} bugs)\n`);
  }
}

console.error('──────────────────────────────────────────');
console.error(`[done] ${totalGames} games, ${totalBugs} bugs\n`);

// ── Rank ─────────────────────────────────────────────────────────────────────
const ranked = [...stats.values()]
  .map(d => ({
    id: d.id,
    name: d.name,
    games: d.games,
    wins: d.wins,
    ties: d.ties,
    losses: d.losses,
    bugs: d.bugs,
    winRate: d.games > 0 ? (d.wins / d.games * 100).toFixed(1) : '0.0',
  }))
  .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

// ── Output JSON ──────────────────────────────────────────────────────────────
const output = { totalGames, totalBugs, bugGames: BUG_GAMES, rankings: ranked };
process.stdout.write(JSON.stringify(output, null, 2));
