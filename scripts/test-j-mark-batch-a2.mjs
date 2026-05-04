#!/usr/bin/env node
/**
 * J 標 Batch A2 focused regression.
 * 卡文來源：static/cards/M3.json（網站卡牌資料庫原始來源）
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-j-batch-a2-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-j-batch-a2-entry.ts');
function safeUnlink(p) { try { unlinkSync(p); } catch {} }
process.on('exit', () => { safeUnlink(ENTRY); safeUnlink(OUT); });

writeFileSync(ENTRY, `export { createGame, applyAction } from './src/lib/game/engine';\n`);
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
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) {
    if (c?.id != null) pool.set(String(c.id), c);
  }
}

const CID = {
  volcanion: '18001',
  luxray: '18004',
  tyrunt: '18020',
  hawlucha: '18022',
  gengar: '18026',
  chienPao: '18030',
  defender: '11252', // HP330 ex dummy defender（弱點草，避免本批水/雷/鬥/惡傷害被弱點加倍）
  nonExDefender: '14426',
  waterE: '18519',
  lightningE: '18520',
  fightingE: '17215',
  darkE: '17214',
  colorlessE: '13443',
};
let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `a2_${++iid}`, cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
const e = (cardId) => inst(cardId);
const energies = (...ids) => ids.map((id) => e(id));
const atkIdx = (cid, name) => pool.get(String(cid))?.attacks?.findIndex((a) => a.name === name) ?? -1;

function baseState(active, extraP0 = {}, extraP1 = {}) {
  const state = createGame(
    { name: 'P1', entries: [{ cardId: CID.defender, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.defender, count: 1 }] },
    pool,
  );
  return {
    ...state,
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    firstPlayerIdx: 1, isFirstTurn: false, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: 0,
    players: [
      { ...state.players[0], name: 'P1', hand: [], deck: [], discard: [], prizes: Array(6).fill(null).map(() => inst(CID.colorlessE)), bench: [], active, ...extraP0 },
      { ...state.players[1], name: 'P2', hand: [], deck: [], discard: [], prizes: Array(6).fill(null).map(() => inst(CID.colorlessE)), bench: [], active: inst(CID.defender), ...extraP1 },
    ],
  };
}
function attack(st, cid, name) {
  const idx = atkIdx(cid, name);
  assert.notEqual(idx, -1, `${pool.get(String(cid))?.name} should have attack ${name}`);
  return applyAction(st, { type: 'ATTACK', attackIndex: idx }, pool);
}
function withRandom(values, fn) {
  const old = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  try { return fn(); } finally { Math.random = old; }
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}: ${err.stack || err.message}`); failed++; }
}

test('波爾凱尼恩｜強力蒸汽 flips once per attached Water energy and deals heads ×90', () => {
  const activeOneHead = inst(CID.volcanion, { energyAttached: energies(CID.waterE, CID.waterE, CID.colorlessE) });
  const oneHeadState = baseState(activeOneHead);
  const oneHead = withRandom([0.1, 0.9], () => attack(oneHeadState, CID.volcanion, '強力蒸汽'));
  assert.equal(oneHead.players[1].active?.damage, 90);

  const activeZeroHeads = inst(CID.volcanion, { energyAttached: energies(CID.waterE, CID.waterE, CID.colorlessE) });
  const zeroHeadsState = baseState(activeZeroHeads);
  const zeroHeads = withRandom([0.9, 0.9], () => attack(zeroHeadsState, CID.volcanion, '強力蒸汽'));
  assert.equal(zeroHeads.players[1].active?.damage, 0);
});

test('倫琴貓｜猛力進攻 deals prizes taken ×70', () => {
  const active = inst(CID.luxray, { energyAttached: energies(CID.lightningE, CID.colorlessE) });
  const st = baseState(active, { prizes: Array(3).fill(null).map(() => inst(CID.colorlessE)) }); // 已拿 3 張
  const next = attack(st, CID.luxray, '猛力進攻');
  assert.equal(next.players[1].active?.damage, 210);
});

test('寶寶暴龍｜勃然大怒 deals own damage counters ×20', () => {
  const active = inst(CID.tyrunt, { damage: 30, energyAttached: energies(CID.fightingE, CID.colorlessE) });
  const next = attack(baseState(active), CID.tyrunt, '勃然大怒');
  assert.equal(next.players[1].active?.damage, 60);
});

test('摔角鷹人｜復仇踢 adds 60 if any own benched Pokémon has damage counters', () => {
  const active = inst(CID.hawlucha, { energyAttached: energies(CID.fightingE) });
  const damagedBench = inst(CID.nonExDefender, { damage: 10 });
  const next = attack(baseState(active, { bench: [damagedBench] }), CID.hawlucha, '復仇踢');
  assert.equal(next.players[1].active?.damage, 90);
});

test('耿鬼｜意志劫持 deals 10 plus opponent bench count ×30', () => {
  const active = inst(CID.gengar, { energyAttached: energies(CID.darkE) });
  const next = attack(baseState(active, {}, { bench: [inst(CID.nonExDefender), inst(CID.nonExDefender)] }), CID.gengar, '意志劫持');
  assert.equal(next.players[1].active?.damage, 70);
});

test('古劍豹｜上升利刃 adds 80 when defender is ex, but not against non-ex', () => {
  const active = () => inst(CID.chienPao, { energyAttached: energies(CID.darkE, CID.darkE, CID.colorlessE) });
  const vsEx = attack(baseState(active()), CID.chienPao, '上升利刃');
  assert.equal(vsEx.players[1].active?.damage, 160);
  const vsNonEx = attack(baseState(active(), {}, { active: inst(CID.nonExDefender) }), CID.chienPao, '上升利刃');
  assert.equal(vsNonEx.players[1].active?.damage, 80);
});

console.log(`\nJ Batch A2: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
