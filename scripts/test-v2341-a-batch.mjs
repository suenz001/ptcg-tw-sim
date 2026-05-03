#!/usr/bin/env node
/**
 * v2.341 A 批 ex 卡牌 focused regression
 *
 * 缺口分析（卡文已確認）：
 *   缺失（需實作）：
 *     1. 鐵荊棘ex｜初始化 — 封鎖場上「擁有規則的寶可夢」（rule-box = 獎賞 2 張以上的 ex/V/GX/VMAX/VSTAR/MegaEvolution）的特性；未來寶可夢排除

 *     2. 鐵荊棘ex｜伏特旋風 — 140 + 移自己能量至備戰
 *     3. 耿鬼ex｜侵蝕詛咒 — 被動：對手附能時放 2 個傷害指示物
 *     4. 耿鬼ex｜戲法舞步 — 160 + 移對手能量至對手備戰（optional）
 *     5. 幸福蛋ex｜幸福切換 — 移自己基本能量至另一隻自己 Pokémon
 *     6. 來悲粗茶ex｜熬返 — 展示棄牌區基本草能量，×2 傷害，洗回牌庫
 *     7. 倫琴貓ex｜突刺目光 — 120 + 對手手牌選 1 張丟棄
 *   已實裝（不需測試）：
 *     ✅ 幸福蛋ex｜報恩（regPre + regPost drawToHandPost）
 *     ✅ 來悲粗茶ex｜抹茶飛濺（regPost healAllOwnPost）
 *     ✅ 倫琴貓ex｜伏特強襲（regPost selfDiscardAllEnergyPost）
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-v2341a-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-v2341a-entry.ts');
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

// Card IDs (verified from static/cards/*.json)
const CID = {
  // A 批重點卡
  ironBarricade:  '10280', // 鐵荊棘ex SV5a 033/066 (Lightning Basic ex, Future)
  genghost:       '9817',  // 耿鬼ex SV5K 047/071 (Darkness Stage2 ex)
  chanseyEx:     '10499',  // 幸福蛋ex SV6 085/101 (Colorless Stage1 ex)
  wyrdeerEx:     '10256',  // 來悲粗茶ex SV5a 009/066 (Grass Stage1 ex)
  lopunnyEx:     '10455',  // 倫琴貓ex SV6 041/101 (Lightning Stage2 ex)
  // 測試用精靈
  yanmega:       '10469',  // 願增猿 SV6 055/101 (Psychic Basic — 1 prize, 不受初始化影響)
  ironLeaves:    '9857',   // 鐵斑葉ex SV5M 016/071 (Future Pokemon, ability: 迅速游標)
  palkiaEx:    '12479',    // 波爾凱尼恩ex SV9 017/100 (Fire Basic ex -- 2 prizes, rule-box, active ability: 燒灼蒸汽)
  pikachuEx:   '13137',   // 皮卡丘ex SVQP 001/023 (passive: 勤奮之心)
  defenderHP:  '14426',    // 蒼響 M-P-I 030/M-P (HP 130, basic non-ex, non-Future)
  grassE:      '14102',    // 基本【草】能量 M-P-I
  fireE:       '14428',    // 基本【火】能量 M-P-I（亦作 Colorless 用）
  lightningE:  '18520',    // 基本【雷】能量 M-P-J
  darkE:       '14430',    // 基本【惡】能量 M-P-I
  fightingE:   '14104',    // 基本【闘】能量 M-P-I
};
let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `a${++iid}`, cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
const instE = (cardId) => inst(cardId);
function baseState(overrides = {}) {
  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.fireE, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.defenderHP, count: 1 }] },
    pool,
  );
  return {
    ...state,
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    firstPlayerIdx: 1, isFirstTurn: false, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: 0,
    players: [
      { ...state.players[0], name: 'P1', hand: [], deck: [], discard: [], prizes: Array(6).fill(null).map(() => inst(CID.grassE)) },
      { ...state.players[1], name: 'P2', hand: [], deck: [], discard: [], prizes: Array(6).fill(null).map(() => inst(CID.grassE)), active: inst(CID.defenderHP) },
    ],
    ...overrides,
  };
}

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  ✅ ${name}`); passed++; } catch(e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; } }
const atkIdx = (cid, name) => pool.get(String(cid))?.attacks?.findIndex(a => a.name === name) ?? -1;
const hasPending = (s) => typeof s.pendingSelection === 'object' && s.pendingSelection !== null;
const noPending = (s) => typeof s.pendingSelection === 'undefined' || s.pendingSelection === null;

// ── T1: 鐵荊棘ex｜初始化 — 波爾凱尼恩ex 的 active ability 被封鎖 ──────────────────
// SKIP: 燒灼蒸汽尚未實裝，此測試目前是假阳性（通過只是因為技能不存在）。
// 實作順序：① 先實裝 燒灼蒸汽 (T1→RED) ② 再實裝 初始化 (T1→GREEN)。
test.skip('T1 鐵荊棘ex｜初始化 blocks 波爾凱尼恩ex 燒灼蒸汽 when active [SKIP - pre-req not met]', () => {
  // P1: 波爾凱尼恩ex (rule-box Basic ex, not Future) active -- ability should be blocked
  // P2: 鐵荊棘ex active
  const palkia = inst(CID.palkiaEx);
  const ironBarricade = inst(CID.ironBarricade);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: palkia, bench: [] },
      { ...baseState().players[1], active: ironBarricade, bench: [] },
    ],
  });
  // 燒灼蒸汽: USE_ABILITY should be blocked by 初始化
  const next = applyAction(st, { type: 'USE_ABILITY', iid: palkia.iid, abilityIndex: 0 }, pool);
  // Ability should be blocked -> no pendingSelection created
  assert.ok(noPending(next), 'pendingSelection should be undefined (ability blocked by 初始化)');
});

// ── T2: 鐵荊棘ex｜初始化例外 — Future Pokemon 不被封鎖 ─────────────────────────
test('T2 鐵荊棘ex｜初始化 does NOT block 鐵斑葉ex (Future) ability', () => {
  // P1: 鐵斑葉ex (Future, rule-box) active — ability should NOT be blocked
  // P2: 鐵荊棘ex active
  const ironLeaves = inst(CID.ironLeaves);
  const ironBarricade = inst(CID.ironBarricade);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: ironLeaves, bench: [] },
      { ...baseState().players[1], active: ironBarricade, bench: [] },
    ],
  });
  const next = applyAction(st, { type: 'USE_ABILITY', iid: ironLeaves.iid, abilityIndex: 0 }, pool);
  // Future Pokémon should NOT be blocked → pendingSelection should be created
  assert.ok(hasPending(next), 'Future Pokémon ability should NOT be blocked (pendingSelection should exist)');
});

// ── T3: 鐵荊棘ex｜伏特旋風 — 140 damage + energy move to bench ──────────────────
test('T3 鐵荊棘ex｜伏特旋風 deals 140 and creates energy-move pending selection', () => {
  // Need Lightning + Colorless + Colorless; give P0 Lightning + Fire(instead of Colorless) energy attached
  const lightning = instE(CID.lightningE);
  const fire = instE(CID.fireE);
  // ironBarricade has Lightning + Fire (Fire can count as Colorless)
  const ironBarricade = inst(CID.ironBarricade, { energyAttached: [lightning, fire] });
  const bench = inst(CID.defenderHP);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: ironBarricade, bench: [bench], hand: [fire, fire] },
      { ...baseState().players[1], active: inst(CID.defenderHP) },
    ],
  });
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.ironBarricade, '伏特旋風') }, pool);
  assert.equal(next.players[1].active?.damage, 140, 'should deal 140 damage');
  assert.ok(hasPending(next), 'should create energy-move pending selection');
});

// ── T4: 幸福蛋ex｜幸福切換 — move basic energy between own Pokémon ───────────────
test('T4 幸福蛋ex｜幸福切換 creates pending to choose source energy and target', () => {
  const chansey = inst(CID.chanseyEx, { energyAttached: [instE(CID.fireE)] });
  const bench = inst(CID.defenderHP);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: chansey, bench: [bench] },
      { ...baseState().players[1], active: inst(CID.defenderHP) },
    ],
  });
  const next = applyAction(st, { type: 'USE_ABILITY', iid: chansey.iid, abilityIndex: 0 }, pool);
  // Should create pending selection for energy move
  assert.ok(hasPending(next), 'should create energy-move pending selection');
});

// ── T5: 耿鬼ex｜侵蝕詛咒 — opponent energy attach places 2 damage ───────────────
test('T5 耿鬼ex｜侵蝕詛咒 places 2 damage counters on opponent when they attach energy', () => {
  // P1: attacker with Dark energy in hand to attach
  // P2: 耿鬼ex active, opponent (P1) attaches energy to their own Pokémon
  const darkE = instE(CID.darkE);
  const genghost = inst(CID.genghost);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: inst(CID.defenderHP), hand: [darkE] },
      { ...baseState().players[1], active: genghost, bench: [] },
    ],
  });
  const targetIid = st.players[0].active ? st.players[0].active.iid : '';
  const next = applyAction(st, {
    type: 'ATTACH_ENERGY', actorIdx: 0, energyIid: darkE.iid, targetIid,
  }, pool);
  // Genghost ability should place 2 damage counters on the target Pokémon
  assert.equal(next.players[0].active?.damage, 2,
    '侵蝕詛咒 should place 2 damage counters on opponent Pokémon when they attach energy');
});

// ── T6: 耿鬼ex｜戲法舞步 — 160 damage + optional opponent energy move ────────────
test('T6 耿鬼ex｜戲法舞步 deals 160 damage and creates opp-energy-move pending', () => {
  // Need Darkness + Darkness; give P1 dark + dark in hand
  const dark1 = instE(CID.darkE), dark2 = instE(CID.darkE);
  const genghost = inst(CID.genghost, { energyAttached: [instE(CID.fireE)] }); // 附1個能量（可被移走）
  const oppBench = inst(CID.defenderHP);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: inst(CID.defenderHP), bench: [oppBench] },
      { ...baseState().players[1], active: genghost, bench: [], hand: [dark1, dark2] },
    ],
  });
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.genghost, '戲法舞步') }, pool);
  assert.equal(next.players[0].active?.damage, 160, 'should deal 160 damage');
  // "若希望" = optional, so it should still create pending selection for the energy move
  assert.ok(hasPending(next), '戲法舞步 should create pending selection (optional, player chooses)');
});

// ── T7: 來悲粗茶ex｜熬返 — show grass energy, deal N×2 damage, shuffle back ───
test('T7 來悲粗茶ex｜熬返 places N×2 damage on opponent and shuffles grass energies back', () => {
  // P1: 來悲粗茶ex active, with 3 basic Grass energies in discard
  const wyrdeer = inst(CID.wyrdeerEx);
  const g1 = instE(CID.grassE), g2 = instE(CID.grassE), g3 = instE(CID.grassE);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: wyrdeer, discard: [g1, g2, g3, inst(CID.fireE)] },
      { ...baseState().players[1], active: inst(CID.defenderHP), bench: [] },
    ],
  });
  // 3 grass energies → 3×2 = 6 damage, then those 3 energies go back to deck (shuffled)
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.wyrdeerEx, '熬返') }, pool);
  assert.equal(next.players[1].active?.damage, 6, '3 grass energies × 2 = 6 damage');
  // The 3 grass energies should be back in deck (shuffled back, so deck size increases by 3)
  // discard should now have fireE only (grass energies gone from discard)
  const discardGrassCount = next.players[0].discard.filter(e => String(e.cardId) === String(CID.grassE)).length;
  assert.equal(discardGrassCount, 0, 'grass energies should be removed from discard (shuffled back)');
});

// ── T8: 倫琴貓ex｜突刺目光 — 120 damage + opponent hand discard 1 ───────────────
test('T8 倫琴貓ex｜突刺目光 deals 120 and creates opponent-hand-discard pending', () => {
  // Need Colorless + Colorless; give P1 fire (as colorless) in hand
  const fire = instE(CID.fireE);
  const oppCard = inst(CID.grassE);
  const lopunny = inst(CID.lopunnyEx);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: inst(CID.defenderHP), hand: [oppCard] },
      { ...baseState().players[1], active: lopunny, bench: [], hand: [fire, fire] },
    ],
  });
  const next = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx(CID.lopunnyEx, '突刺目光') }, pool);
  assert.equal(next.players[0].active?.damage, 120, 'should deal 120 damage');
  // Should create pending to choose 1 card from opponent's hand to discard
  assert.ok(hasPending(next), 'should create opponent-hand-discard pending');
  assert.equal(next.pendingSelection.type, 'hand-discard', 'should be hand-discard pending');
  assert.equal(next.pendingSelection.sourcePlayerIdx, 0, 'source should be opponent (P1)');
});

// ── T9: 初始化的 鐵荊棘ex 自己也是 rule-box，但自己不應被封鎖（特例） ──────────
test('T9 鐵荊棘ex｜初始化 does NOT block 鐵荊棘ex own ability', () => {
  // 鐵荊棘ex itself has 初始化 ability — it should still be usable
  // (the ability says "這隻寶可夢" so it's not suppressed for self)
  const ironBarricade = inst(CID.ironBarricade);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: ironBarricade, bench: [] },
      { ...baseState().players[1], active: inst(CID.defenderHP) },
    ],
  });
  // 初始化 is an active ability — using it should create pending
  const next = applyAction(st, { type: 'USE_ABILITY', iid: ironBarricade.iid, abilityIndex: 0 }, pool);
  // Self should NOT be blocked → pendingSelection should be created
  assert.ok(hasPending(next), '鐵荊棘ex own 初始化 ability should NOT be blocked');
});

// ── T10: 幸福切換 energy move resolver — move basic energy from active to bench ──
test('T10 幸福切換 resolver moves energy from active to bench target', () => {
  const chansey = inst(CID.chanseyEx, { energyAttached: [instE(CID.fireE)] });
  const bench = inst(CID.defenderHP);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: chansey, bench: [bench] },
      { ...baseState().players[1], active: inst(CID.defenderHP) },
    ],
  });
  const energyIid = chansey.energyAttached[0].iid;
  let next = applyAction(st, { type: 'USE_ABILITY', iid: chansey.iid, abilityIndex: 0 }, pool);
  assert.ok(hasPending(next), 'should create pending');
  // Step 1: resolve energy choice
  next = applyAction(next, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [energyIid] }, pool);
  assert.ok(hasPending(next), 'should create second pending for target choice');
  // Step 2: resolve target (bench)
  next = applyAction(next, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [bench.iid] }, pool);
  // Energy should be moved to bench
  const moved = next.players[0].bench.find(b => b.iid === bench.iid);
  assert.equal(moved?.energyAttached[0]?.iid, energyIid, 'energy should be moved to bench target');
  // Active should have no energy
  assert.equal(next.players[0].active?.energyAttached.length, 0, 'active should have no energy after move');
});

// ── T11: 侵蝕詛咒 NOT triggered when 耿鬼ex is opponent's (not own) ─────────────
test('T11 侵蝕詛咒 does NOT trigger when OWN Genghost is on bench (only when on field)', () => {
  // P1: attacker attaches energy to their own Pokémon
  // P2: Genghost on bench (not active) — ability should NOT trigger
  const darkE = instE(CID.darkE);
  const genghost = inst(CID.genghost);
  let st = baseState({
    players: [
      { ...baseState().players[0], active: inst(CID.defenderHP), hand: [darkE] },
      { ...baseState().players[1], active: inst(CID.defenderHP), bench: [genghost] },
    ],
  });
  const targetIid = st.players[0].active ? st.players[0].active.iid : '';
  const next = applyAction(st, {
    type: 'ATTACH_ENERGY', actorIdx: 0, energyIid: darkE.iid, targetIid,
  }, pool);
  // Genghost is not active → should NOT place damage counters
  assert.equal(next.players[0].active?.damage, 0,
    '侵蝕詛咒 should NOT trigger when Genghost is on bench (only active)');
});

console.log('\n────────────────────────────────────────────────────────────');
if (failed > 0) { console.log(`\n❌ ${failed}/${passed + failed} tests failed.`); process.exit(1); }
console.log(`\n✅ All ${passed} tests passed!`);
