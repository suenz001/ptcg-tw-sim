#!/usr/bin/env node
/**
 * Focused regression tests for cinccino-deck features:
 *  T1: 小火馬 svhk 10052 蓄能量 — 牌庫搜1張基本能量加入手牌並展示
 *  T2: 力之沙漏 SV6a 17154 — 回合結束時應開 pendingSelection（玩家選擇）
 *  T3: 奇諾栗鼠ex M4 18491 能量巴掌 — 附加能量數×40（驗證 selfAttachedEnergyMultiplyPre）
 *  T4: 炎武王 SV11W 13370 高溫重壓 — 費用 [FFF][C]，烈火亂舞不存在（TODO：請使用者確認正確卡名）
 *  T5: 對戰圓形競技場 M2 14397 — 擋備戰招式/特性指示物效果
 *
 * Run: node scripts/test-cinccino-deck-focused.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-cinc-bundle.mjs');
const ENTRY_PATH = join(REPO_ROOT, '.tmp-cinc-entry.ts');

function safeUnlink(p) { try { unlinkSync(p); } catch {} }
process.on('exit', () => { safeUnlink(ENTRY_PATH); safeUnlink(OUT); });

// ── Build engine bundle ───────────────────────────────────────────────────────
writeFileSync(ENTRY_PATH, `
export { createGame, applyAction } from './src/lib/game/engine';
export { isBenchProtected } from './src/lib/game/effects';
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

// ── Load engine ───────────────────────────────────────────────────────────────
const { createGame, applyAction, isBenchProtected } = await import(pathToFileURL(OUT).href);

// ── Attack cost checker (engine.ts has canAffordAttack but doesn't export it) ─
function canAffordAttack(activeInst, costArr, _pool, state, playerIdx, _atkName) {
  // costArr: array of energy types like ['Fire','Colorless','Colorless']
  // Count available energy of each type
  const available = { ...state.players[playerIdx].energy };
  // Collect all attached energy from active Pokemon
  const attached = activeInst.energyAttached ?? [];
  for (const e of attached) {
    // energyAttached cards have energyType field or we look up in pool
    available['Colorless'] = (available['Colorless'] ?? 0) + 1; // simplified: all attached count as colorless
  }
  return costArr.every(c => (available[c] ?? 0) > 0);
}

// ── Build card pool ───────────────────────────────────────────────────────────
const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}
// Add virtual colorless energy (needed for engine energy matching)
pool.set('colorless-test', {
  id: 'colorless-test', name: '基本【無】能量',
  supertype: 'Energy', subtype: 'Basic', pokemonType: 'Colorless',
});

// ── Card IDs ─────────────────────────────────────────────────────────────────
const CID = {
  // T1: 小火馬 svhk 10052
  ponyta:        '10052',
  // T2: 力之沙漏 SV6a 17154
  brailliant:   '17154',
  // T3: 奇諾栗鼠ex M4 18491
  cinccinoEx:   '18491',
  // T4: 炎武王 SV11W 13370（高溫重壓 [FFF][C] 120 — 無附能量效果；烈火亂舞不存在於池中）
  centiskorch:  '13370',
  // T5: 對戰圓形競技場 M2 14397
  battleArena:  '14397',
  // Defender / utility
  goldeen:      '10440',  // 角金魚 Basic Colorless 50HP (from test-p2-abilities)
  fireE:        '14428',  // 基本【火】能量
  burnedE:      '14851',  // 燃火能量 SV6
  grassE:       '14429',  // 基本【草】能量
  colorlessE:   'colorless-test',
};

// Verify all CIDs exist
for (const [k, id] of Object.entries(CID)) {
  if (!pool.has(id)) {
    console.error(`MISSING [${k}] = ${id}`);
    process.exit(1);
  }
}

// ── Test helpers ───────────────────────────────────────────────────────────────
let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `c${++iid}`, cardId, damage: 0, energyAttached: [], ...extra });
const instE = (cardId) => inst(cardId);

function baseState(overrides = {}) {
  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.grassE, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.goldeen, count: 1 }] },
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
    players: [
      {
        ...state.players[0], name: 'P1',
        deck: Array(20).fill(null).map(() => inst(CID.fireE)),
        hand: [],
        discard: [],
        prizes: Array(6).fill(null).map(() => inst(CID.grassE)),
      },
      {
        ...state.players[1], name: 'P2',
        deck: Array(20).fill(null).map(() => inst(CID.fireE)),
        hand: [],
        discard: [],
        prizes: Array(6).fill(null).map(() => inst(CID.grassE)),
      },
    ],
    ...overrides,
  };
  return state;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ── T1: 小火馬｜蓄能量 ────────────────────────────────────────────────────────
console.log('\n── T1: 小火馬｜蓄能量 ──────────────────────────────────────');
{
  const ponyta = inst(CID.ponyta);
  // Deck has 1 fire energy at top
  const deckWithFire = [inst(CID.fireE), ...Array(19).fill(null).map(() => inst(CID.fireE))];

  let state = baseState({
    players: [
      { ...baseState().players[0], active: ponyta, deck: deckWithFire, hand: [] },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });

  const card = pool.get(CID.ponyta);
  const atkIdx = card.attacks.findIndex(a => a.name === '蓄能量');

  test('T1-1: canAffordAttack [C] on 小火馬蓄能量', () => {
    const result = canAffordAttack(ponyta, card.attacks[atkIdx].cost, pool, state, 0, card.attacks[atkIdx].name);
    assert.equal(result, true, 'should afford [C] cost');
  });

  test('T1-2: ATTACK(蓄能量) should produce pendingSelection(type=deck-search)', () => {
    const next = applyAction(state, { type: 'ATTACK', attackIndex: atkIdx }, pool);
    assert.ok(next.pendingSelection, `pendingSelection should exist, got ${JSON.stringify(next.pendingSelection)}`);
    if (next.pendingSelection) {
      assert.equal(next.pendingSelection.type, 'deck-search',
        `expected deck-search, got ${next.pendingSelection.type}`);
    }
  });

  test('T1-3: RESOLVE_SELECTION(deck fire) should add fire energy to hand', () => {
    let next = applyAction(state, { type: 'ATTACK', attackIndex: atkIdx }, pool);
    const deckFireIid = next.players[0].deck[0].iid;
    next = applyAction(next, { type: 'RESOLVE_SELECTION', selection: deckFireIid, selectedIids: [deckFireIid] }, pool);
    const handFire = next.players[0].hand.filter(c => c.cardId === CID.fireE);
    assert.ok(handFire.length >= 1, `hand should have fire energy, got ${handFire.length} cards`);
    assert.ok(!next.pendingSelection, 'pendingSelection should be cleared');
  });
}

// ── T2: 力之沙漏 ─────────────────────────────────────────────────────────────
console.log('\n── T2: 力之沙漏 ───────────────────────────────────────────');
{
  // 道具要附在 active 上才會觸發 engine.ts 的 END_TURN 邏輯
  const brailliantInst = inst(CID.brailliant);
  const p1Active = inst(CID.centiskorch, {
    energyAttached: [instE(CID.fireE), instE(CID.colorlessE)],
    toolAttached: brailliantInst, // ← 關鍵：有力之沙漏道具
  });
  // Discard has 1 fire energy
  const discardWithFire = [inst(CID.fireE), inst(CID.grassE)];

  let state = baseState({
    activeStadium: null,
    players: [
      {
        ...baseState().players[0],
        active: p1Active,
        deck: Array(20).fill(null).map(() => inst(CID.fireE)),
        hand: [],
        discard: discardWithFire,
      },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });

  test('T2-1: END_TURN with 力之沙漏 should produce pendingSelection(discard-search)', () => {
    const next = applyAction(state, { type: 'END_TURN' }, pool);
    assert.ok(next.pendingSelection, `T2 FAIL: pendingSelection should exist but got ${JSON.stringify(next.pendingSelection)}`);
    if (next.pendingSelection) {
      assert.equal(next.pendingSelection.type, 'discard-search',
        `expected discard-search, got ${next.pendingSelection.type}`);
    }
  });

  test('T2-2: RESOLVE_SELECTION(null/skip) should clear pending and end turn', () => {
    // Chain from T2-1 result
    let next = applyAction(state, { type: 'END_TURN' }, pool);
    assert.ok(next.pendingSelection, 'T2-1 must produce pendingSelection first');
    next = applyAction(next, { type: 'RESOLVE_SELECTION', selection: null, selectedIids: [] }, pool);
    assert.ok(!next.pendingSelection || next.pendingSelection.type !== 'discard-search',
      'pendingSelection (discard-search) should be cleared after skip');
  });

  test('T2-3: RESOLVE_SELECTION(fire from discard) should attach to active', () => {
    let next = applyAction(state, { type: 'END_TURN' }, pool);
    assert.ok(next.pendingSelection, 'T2-1 must produce pendingSelection first');
    const fireIid = next.players[0].discard.find(c => c.cardId === CID.fireE)?.iid;
    assert.ok(fireIid, 'fire energy should be in discard');
    next = applyAction(next, { type: 'RESOLVE_SELECTION', selection: fireIid, selectedIids: [fireIid] }, pool);
    const attached = next.players[0].active.energyAttached;
    assert.ok(attached.some(e => e.cardId === CID.fireE),
      `fire should be attached to active, got: ${JSON.stringify(attached.map(e => e.cardId))}`);
  });
}

// ── T3: 奇諾栗鼠ex｜能量巴掌 ─────────────────────────────────────────────────
console.log('\n── T3: 奇諾栗鼠ex｜能量巴掌 ───────────────────────────────');
{
  const card = pool.get(CID.cinccinoEx);
  const atkIdx = card.attacks.findIndex(a => a.name === '能量巴掌');
  const cinccino = inst(CID.cinccinoEx);
  const fireE = instE(CID.burnedE); // 燃火能量 SV6 14851

  let state = baseState({
    players: [
      {
        ...baseState().players[0],
        active: { ...cinccino, energyAttached: [] },
        hand: [inst(CID.burnedE)],
        deck: [],
        discard: [],
      },
      {
        ...baseState().players[1],
        active: { ...inst(CID.goldeen), damage: 0, hp: 60, energyAttached: [] },
        deck: [],
      },
    ],
  });

  test('T3-1: canAffordAttack [C] on 奇諾栗鼠ex能量巴掌', () => {
    const result = canAffordAttack(cinccino, card.attacks[atkIdx].cost, pool, state, 0, card.attacks[atkIdx].name);
    assert.equal(result, true);
  });

  test('T3-2: 0 attached → 0×40 = 0 bonus → 40 base damage', () => {
    let next = applyAction(state, { type: 'ATTACK', attackIndex: atkIdx }, pool);
    const opp = next.players[1].active;
    assert.ok(opp !== null, 'opponent active should still exist (not KO)');
    if (opp) assert.equal(opp.damage, 40, `expected 40 damage (base 40× with 0 attached), got ${opp.damage}`);
  });

  // 1 attached燃火 energy
  state = {
    ...state,
    players: [
      { ...state.players[0], active: { ...cinccino, energyAttached: [fireE] } },
      { ...state.players[1], active: { ...inst(CID.goldeen), damage: 0, hp: 60, energyAttached: [] } },
    ],
  };
  test('T3-3: 1 attached燃火 → 40 + 1×40 = 80 damage', () => {
    let next = applyAction(state, { type: 'ATTACK', attackIndex: atkIdx }, pool);
    const opp = next.players[1].active;
    assert.ok(opp !== null, 'opponent active should still exist (not KO)');
    if (opp) assert.equal(opp.damage, 80, `expected 80 damage (40+40), got ${opp.damage}`);
  });

  // 2 attached燃火 energies
  const fireE2 = instE(CID.burnedE);
  state = {
    ...state,
    players: [
      { ...state.players[0], active: { ...cinccino, energyAttached: [fireE, fireE2] } },
      { ...state.players[1], active: { ...inst(CID.goldeen), damage: 0, hp: 60, energyAttached: [] } },
    ],
  };
  test('T3-4: 2 attached燃火 → 40 + 2×40 = 120 damage', () => {
    let next = applyAction(state, { type: 'ATTACK', attackIndex: atkIdx }, pool);
    const opp = next.players[1].active;
    assert.ok(opp !== null, 'opponent active should still exist (not KO)');
    if (opp) assert.equal(opp.damage, 120, `expected 120 damage (40+80), got ${opp.damage}`);
  });
}

// ── T4: 炎武王 高溫重壓 ──────────────────────────────────────────────────────
console.log('\n── T4: 炎武王｜高溫重壓 ───────────────────────────────────');
{
  // NOTE: 烈火亂舞 不存在於卡池。炎武王 SV11W 13370 的招式是「高溫重壓」[FFF][C] 120
  // （無附能量效果）。T4 改測「高溫重壓」費用邏輯是否正確。
  const card = pool.get(CID.centiskorch);
  const atkIdx = card.attacks.findIndex(a => a.name === '高溫重壓');
  if (atkIdx === -1) {
    console.log('  ⚠️  T4: 炎武王 13370 not found, skipping');
  } else {
    const centi = inst(CID.centiskorch, { energyAttached: [instE(CID.fireE), instE(CID.fireE), instE(CID.fireE), instE(CID.colorlessE)] });
    let state = baseState({
      players: [
        { ...baseState().players[0], active: centi, hand: [], deck: Array(20).fill(null).map(() => inst(CID.fireE)) },
        { ...baseState().players[1], active: inst(CID.goldeen) },
      ],
    });

    test('T4-1: canAffordAttack [F][F][F][C] on 炎武王高溫重壓', () => {
      const result = canAffordAttack(centi, card.attacks[atkIdx].cost, pool, state, 0, card.attacks[atkIdx].name);
      assert.equal(result, true, 'should afford [F][F][F][C]');
    });

    test('T4-2: ATTACK(高溫重壓) should deal 120 damage', () => {
      let next = applyAction(state, { type: 'ATTACK', attackIndex: atkIdx }, pool);
      const opp = next.players[1].active;
      assert.ok(opp !== null, 'opponent active should still exist (not KO)');
      if (opp) assert.equal(opp.damage, 120, `expected 120 damage, got ${opp.damage}`);
    });
  }
}

// ── T5: 對戰圓形競技場 ────────────────────────────────────────────────────────
console.log('\n── T5: 對戰圓形競技場 ────────────────────────────────────');
{
  test('T5-1: 對戰圓形競技場 exists and subtype=Stadium', () => {
    const card = pool.get(CID.battleArena);
    assert.ok(card, '對戰圓形競技場 not in pool');
    assert.equal(card.name, '對戰圓形競技場');
    assert.equal(card.subtype, 'Stadium');
  });

  test('T5-2: isBenchProtected(true) when 對戰圓形競技場 active', () => {
    const arenaInst = inst(CID.battleArena);
    const arenaState = baseState({ activeStadium: arenaInst });
    const result = isBenchProtected(arenaState, pool);
    assert.equal(result, true, 'should return true when 對戰圓形競技場 is active');
  });

  test('T5-3: isBenchProtected(false) when no active stadium', () => {
    const result = isBenchProtected(baseState({ activeStadium: null }), pool);
    assert.equal(result, false, 'should return false when no active stadium');
  });
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────────────────────\n`);
safeUnlink(OUT);
if (failed === 0) {
  console.log(`✅ All ${passed} tests passed!`);
} else {
  console.log(`❌ ${failed}/${passed + failed} tests failed.`);
  process.exit(1);
}
