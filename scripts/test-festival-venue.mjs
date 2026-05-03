#!/usr/bin/env node
/**
 * Regression tests for 祭典會場 special-condition immunity/recovery.
 * Run: node scripts/test-festival-venue.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-festival-test-venue-bundle.mjs');
const ENTRY_PATH = join(REPO_ROOT, '.tmp-festival-test-venue-entry.ts');

function safeUnlink(path) {
  try { unlinkSync(path); } catch {}
}

process.on('exit', () => {
  safeUnlink(ENTRY_PATH);
  safeUnlink(OUT);
});

writeFileSync(ENTRY_PATH, `
  export { createGame, applyAction } from './src/lib/game/engine';
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

const { createGame, applyAction } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}

const CID = {
  centiskorch: '9781', // 焚焰蚣：灼熱 — 將對手的戰鬥寶可夢【灼傷】
  goldeen: '10440',   // 角金魚：無狀態免疫文字的 Basic
  stadium: '10513',   // 祭典會場
  fire: '13185',      // 基本【火】能量
  grass: '17217',     // 基本【草】能量
};

let iidCounter = 0;
function inst(cardId, extra = {}) {
  iidCounter += 1;
  return { iid: `fv${iidCounter}`, cardId, damage: 0, energyAttached: [], ...extra };
}

function baseState({ stadiumInPlay = true, defenderHasEnergy = false, defenderStatus = undefined, attackerHand = [] } = {}) {
  const attackerActive = inst(CID.centiskorch, { energyAttached: [inst(CID.fire), inst(CID.fire)] });
  const defenderActive = inst(CID.goldeen, {
    status: defenderStatus,
    energyAttached: defenderHasEnergy ? [inst(CID.grass)] : [],
  });

  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.centiskorch, count: 1 }, { cardId: CID.fire, count: 2 }] },
    { name: 'P2', entries: [{ cardId: CID.goldeen, count: 1 }, { cardId: CID.grass, count: 1 }] },
    pool,
  );

  state = {
    ...state,
    phase: 'playing',
    turnPhase: 'main',
    activePlayerIndex: 0,
    firstPlayerIdx: 1,
    isFirstTurn: false,
    setupDone: [true, true],
    pendingMulliganDraw: [0, 0],
    pendingPrizes: 0,
    activeStadium: stadiumInPlay ? inst(CID.stadium) : null,
    activeStadiumOwnerIdx: stadiumInPlay ? 0 : undefined,
    players: [
      {
        ...state.players[0],
        name: 'P1',
        active: attackerActive,
        bench: [],
        hand: attackerHand,
        deck: [],
        discard: [],
        prizes: [inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass)],
        energyAttachedThisTurn: false,
      },
      {
        ...state.players[1],
        name: 'P2',
        active: defenderActive,
        bench: [],
        hand: [],
        deck: [],
        discard: [],
        prizes: [inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass)],
      },
    ],
  };
  return state;
}

// Baseline: 祭典會場只保護「身上附有能量卡」的寶可夢；無能量仍會陷入特殊狀態。
{
  let state = baseState({ stadiumInPlay: true, defenderHasEnergy: false });
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(state.players[1].active?.status, 'burned', 'no-energy Pokémon should still be burnable under 祭典會場');
}

// 卡面：雙方所有身上附有能量卡的寶可夢不會陷入特殊狀態。
{
  let state = baseState({ stadiumInPlay: true, defenderHasEnergy: true });
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(state.players[1].active?.status, undefined, 'energy-attached Pokémon should not become burned while 祭典會場 is in play');
}

// Stadium 離場/不存在時，免疫效果不適用。
{
  let state = baseState({ stadiumInPlay: false, defenderHasEnergy: true });
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(state.players[1].active?.status, 'burned', 'without 祭典會場, attached energy alone should not prevent burn');
}

// 卡面：並將受到的特殊狀態全部恢復 — 祭典會場進場時清除已帶能量寶可夢的狀態。
{
  const stadium = inst(CID.stadium);
  let state = baseState({ stadiumInPlay: false, defenderHasEnergy: true, defenderStatus: 'burned', attackerHand: [stadium] });
  state = applyAction(state, { type: 'PLAY_TRAINER', iid: stadium.iid }, pool);
  assert.equal(state.activeStadium?.iid, stadium.iid, '祭典會場 should be placed as active stadium');
  assert.equal(state.players[1].active?.status, undefined, 'playing 祭典會場 should recover status from energy-attached Pokémon');
}

// 卡面：附上能量後符合「身上附有能量卡」條件，也應恢復既有特殊狀態。
{
  const energy = inst(CID.grass);
  let state = baseState({ stadiumInPlay: true, defenderHasEnergy: false, defenderStatus: 'burned', attackerHand: [energy] });
  state.activePlayerIndex = 1;
  state.players[1].hand = [energy];
  state.players[1].energyAttachedThisTurn = false;
  const targetIid = state.players[1].active.iid;
  state = applyAction(state, { type: 'ATTACH_ENERGY', energyIid: energy.iid, targetIid }, pool);
  assert.equal(state.players[1].active?.energyAttached.length, 1, 'energy should attach to the statused Pokémon');
  assert.equal(state.players[1].active?.status, undefined, 'attaching energy under 祭典會場 should recover existing status');
}

console.log('✅ festival venue regression tests passed');
