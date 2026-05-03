#!/usr/bin/env node
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-m2dragon-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-m2dragon-entry.ts');
function safeUnlink(p) { try { unlinkSync(p); } catch {} }
process.on('exit', () => { safeUnlink(ENTRY); safeUnlink(OUT); });

writeFileSync(ENTRY, `
export { createGame, applyAction } from './src/lib/game/engine';
`);
await build({
  entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(REPO_ROOT, 'src/lib'), '$app/paths': join(REPO_ROOT, 'scripts/shim-app-paths.mjs') },
  logLevel: 'warning',
});
safeUnlink(ENTRY);
const { createGame, applyAction } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) pool.set(String(c.id), c);
}

const CID = {
  dragonite: '14786', dragonair: '14785', dratini: '14784',
  oricorio: '14336', camerupt: '13970', charizardX: '14331',
  charmeleonSvql: '13162', charmanderM2: '14329', defender: '14786',
  fireE: '14428', waterE: '18519', lightningE: '18520', grassE: '14429',
};
let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `m2c${++iid}`, cardId, damage: 0, energyAttached: [], ...extra });
const instE = (cardId) => inst(cardId);
function baseState(overrides = {}) {
  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.fireE, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.defender, count: 1 }] },
    pool,
  );
  return {
    ...state,
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    firstPlayerIdx: 1, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: 0,
    players: [
      { ...state.players[0], name: 'P1', hand: [], deck: [], discard: [], prizes: Array(6).fill(null).map(() => inst(CID.grassE)) },
      { ...state.players[1], name: 'P2', hand: [], deck: [], discard: [], prizes: Array(6).fill(null).map(() => inst(CID.grassE)), active: inst(CID.defender) },
    ],
    ...overrides,
  };
}
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  ✅ ${name}`); passed++; } catch(e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; } }
const atkIdx = (cid, name) => pool.get(cid)?.attacks?.findIndex(a => a.name === name) ?? -1;

console.log('\n── M2/M2a Dragon + Charizard batch ─────────────────────────');

test('超級快龍ex｜天空搬運 switches active with bench', () => {
  const dragonite = inst(CID.dragonite);
  const bench = inst(CID.charmanderM2);
  let st = baseState({ players: [
    { ...baseState().players[0], active: dragonite, bench: [bench] },
    { ...baseState().players[1], active: inst(CID.defender) },
  ]});
  let next = applyAction(st, { type: 'USE_ABILITY', iid: dragonite.iid, abilityIndex: 0 }, pool);
  assert.equal(next.pendingSelection?.effectKey, 'sky-carry-switch');
  next = applyAction(next, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [bench.iid] }, pool);
  assert.equal(next.players[0].active?.iid, bench.iid);
  assert.equal(next.players[0].bench[0]?.iid, dragonite.iid);
});

test('超級快龍ex｜龍之滑翔 discards 2 self energies and deals 330', () => {
  const e1 = instE(CID.waterE), e2 = instE(CID.lightningE), e3 = instE(CID.lightningE);
  let st = baseState({ players: [
    { ...baseState().players[0], active: inst(CID.dragonite, { energyAttached: [e1, e2, e3] }) },
    { ...baseState().players[1], active: inst(CID.defender) },
  ]});
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.dragonite, '龍之滑翔'), discardedEnergyIids: [e1.iid, e2.iid] }, pool);
  assert.equal(next.players[0].active?.energyAttached.length, 1);
  assert.equal(next.players[0].discard.filter(c => [e1.iid, e2.iid].includes(c.iid)).length, 2);
  assert.equal(next.players[1].active?.damage, 330);
});

test('哈克龍｜進化指引 searches 1 evolution Pokemon to hand', () => {
  const dragonair = inst(CID.dragonair, { energyAttached: [instE(CID.waterE)] });
  const evo = inst(CID.dragonite);
  let st = baseState({ players: [
    { ...baseState().players[0], active: dragonair, deck: [evo], hand: [] },
    { ...baseState().players[1], active: inst(CID.defender) },
  ]});
  let next = applyAction(st, { type: 'USE_ABILITY', iid: dragonair.iid, abilityIndex: 0 }, pool);
  assert.equal(next.pendingSelection?.effectKey, 'dragonair-evolution-guide');
  next = applyAction(next, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [evo.iid] }, pool);
  assert.equal(next.players[0].hand[0]?.iid, evo.iid);
});

test('花舞鳥ex｜激動渦輪 attaches hand basic Fire to benched Fire when Fire Mega ex present', () => {
  const oricorio = inst(CID.oricorio);
  const mega = inst(CID.charizardX);
  const target = inst(CID.charmanderM2);
  const fire = instE(CID.fireE);
  let st = baseState({ players: [
    { ...baseState().players[0], active: oricorio, bench: [mega, target], hand: [fire] },
    { ...baseState().players[1], active: inst(CID.defender) },
  ]});
  let next = applyAction(st, { type: 'USE_ABILITY', iid: oricorio.iid, abilityIndex: 0 }, pool);
  assert.equal(next.pendingSelection?.effectKey, 'exciting-turbo-pick-target');
  next = applyAction(next, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [fire.iid] }, pool);
  assert.equal(next.pendingSelection?.effectKey, 'exciting-turbo-commit');
  next = applyAction(next, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [target.iid] }, pool);
  const attachedTarget = next.players[0].bench.find(b => b.iid === target.iid);
  assert.equal(attachedTarget?.energyAttached[0]?.iid, fire.iid);
  assert.equal(next.players[0].hand.length, 0);
});

test('超級噴火駝ex｜炙燒 does 240 when defender is burned', () => {
  let st = baseState({ players: [
    { ...baseState().players[0], active: inst(CID.camerupt, { energyAttached: [instE(CID.fireE)] }) },
    { ...baseState().players[1], active: inst(CID.defender, { status: 'burned' }) },
  ]});
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.camerupt, '炙燒') }, pool);
  assert.equal(next.players[1].active?.damage, 240);
});

test('超級噴火龍Xex｜烈獄狂火X discards selected own Fire energies ×90', () => {
  const e1 = instE(CID.fireE), e2 = instE(CID.fireE), e3 = instE(CID.fireE);
  const bench = inst(CID.charmanderM2, { energyAttached: [e3] });
  let st = baseState({ players: [
    { ...baseState().players[0], active: inst(CID.charizardX, { energyAttached: [e1, e2] }), bench: [bench] },
    { ...baseState().players[1], active: inst(CID.defender) },
  ]});
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.charizardX, '烈獄狂火X'), discardedEnergyIids: [e1.iid, e3.iid] }, pool);
  assert.equal(next.players[1].active?.damage, 180);
  assert.equal(next.players[0].discard.filter(c => [e1.iid, e3.iid].includes(c.iid)).length, 2);
});

test('火恐龍 SVQL｜大字爆炎 discards 1 self energy', () => {
  const e1 = instE(CID.fireE), e2 = instE(CID.fireE), e3 = instE(CID.fireE);
  let st = baseState({ players: [
    { ...baseState().players[0], active: inst(CID.charmeleonSvql, { energyAttached: [e1, e2, e3] }) },
    { ...baseState().players[1], active: inst(CID.defender) },
  ]});
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.charmeleonSvql, '大字爆炎') }, pool);
  assert.equal(next.players[1].active?.damage, 90);
  assert.equal(next.players[0].active?.energyAttached.length, 2);
  assert.equal(next.players[0].discard.at(-1)?.iid, e3.iid);
});

console.log('\n────────────────────────────────────────────────────────────');
if (failed > 0) { console.log(`\n❌ ${failed}/${passed + failed} tests failed.`); process.exit(1); }
console.log(`\n✅ All ${passed} tests passed!`);
