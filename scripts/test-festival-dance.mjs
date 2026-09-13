#!/usr/bin/env node
/**
 * Regression tests for 祭典樂舞 state-machine flow.
 * Run: node scripts/test-festival-dance.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-festival-test-bundle.mjs');
const ENTRY_PATH = join(REPO_ROOT, '.tmp-festival-test-entry.ts');

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
  applin: '10426',      // 裹蜜蟲：祭典樂舞 / 朋友之環
  goldeen: '10440',    // 角金魚：HP50
  swirlix: '10465',    // 綿綿泡芙：HP50
  stadium: '10513',    // 祭典會場
  grass: '17217',      // 基本【草】能量
};

let iidCounter = 0;
function inst(cardId, extra = {}) {
  iidCounter += 1;
  return { iid: `t${iidCounter}`, cardId, damage: 0, energyAttached: [], ...extra };
}

function baseFestivalState({ attackerBenchCount }) {
  const attackerActive = inst(CID.applin, { energyAttached: [inst(CID.grass)] });
  const attackerBench = Array.from({ length: attackerBenchCount }, () => inst(CID.swirlix));
  const defenderActive = inst(CID.goldeen);
  const defenderBench = [inst(CID.swirlix)];
  const stadium = inst(CID.stadium);

  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.applin, count: 1 }, { cardId: CID.grass, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.goldeen, count: 1 }, { cardId: CID.swirlix, count: 1 }] },
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
    pendingPrizes: [0, 0],
    activeStadium: stadium,
    activeStadiumOwnerIdx: 0,
    festivalDanceUsedThisTurn: [false, false],
    players: [
      {
        ...state.players[0],
        name: 'P1',
        active: attackerActive,
        bench: attackerBench,
        hand: [],
        deck: [],
        discard: [],
        prizes: [inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass)],
      },
      {
        ...state.players[1],
        name: 'P2',
        active: defenderActive,
        bench: defenderBench,
        hand: [],
        deck: [],
        discard: [],
        prizes: [inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass), inst(CID.grass)],
      },
    ],
  };
  return state;
}

function assertFestivalLog(state) {
  assert.ok(
    state.log.some((entry) => entry.message.includes('祭典樂舞')),
    'expected a 祭典樂舞 continuation log',
  );
}

// Baseline: non-KO first attack should immediately reopen main phase for the second attack.
{
  let state = baseFestivalState({ attackerBenchCount: 1 }); // 朋友之環 = 20, no KO
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(state.turnPhase, 'main', 'non-KO first attack should keep turn in main for the second attack');
  assert.equal(state.festivalDanceUsedThisTurn?.[0], true, 'first Festival Dance attack should reserve/consume the second-attack flag');
  assertFestivalLog(state);
}

// Card text: if the first attack KOs the opponent Active, place the next Active first, then use the second attack.
{
  let state = baseFestivalState({ attackerBenchCount: 3 }); // 朋友之環 = 60, KOs HP50 active
  const prizesBefore = state.players[0].prizes.length;
  const handBefore = state.players[0].hand.length;
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  // ⭐v6.377 守衛過期修正（不是出貨碼 bug —— 祭典樂舞流程實測正確）：
  //   ① v2.98 起 pendingPrizes 是 [number, number]（types.ts:899），舊寫法拿整個陣列跟 1 比；
  //   ② v5.466「自動給獎賞」之後 KO 當下獎賞就**直接進攻擊方手牌**，pendingPrizes 恆為 [0,0]
  //      （effects.ts:12342 的註解寫明，v6.377 實測確認：prizes 6→5、hand 0→1）。
  //   ⇒ 改成 `state.pendingPrizes[0]` 也還是紅的。正解是把斷言上移到**行為層**：
  //     KO 之後攻擊方獎賞區少 1 張、手牌多 1 張。
  //   ⚠ 只斷言 `deepEqual(pendingPrizes, [0,0])` 是不夠的 —— 那在「KO 完全沒給獎賞」時也會過。
  assert.deepEqual(state.pendingPrizes, [0, 0], 'v5.466 自動給獎賞：KO 當下就進手牌，不留 pending');
  assert.equal(state.players[0].prizes.length, prizesBefore - 1, 'KO 後攻擊方獎賞區應少 1 張');
  assert.equal(state.players[0].hand.length, handBefore + 1, 'KO 後攻擊方應多拿到 1 張獎賞卡進手牌');
  assert.equal(state.players[1].active, null, 'defending active should be KOed');
  assert.equal(state.festivalDanceUsedThisTurn?.[0], true, 'KO first attack should still reserve Festival Dance second attack');

  // v6.377：TAKE_PRIZES 現在要 playerIdx（types.ts:1405）。自動給獎賞之後這一步是 no-op，
  //   但保留它才守得住「即使攻擊方已把獎賞收下，仍必須等防守方補位才回到 main」。
  state = applyAction(state, { type: 'TAKE_PRIZES', count: 1, playerIdx: 0 }, pool);
  assert.equal(state.turnPhase, 'end', 'must still wait for defender to send a new Active before second attack');

  const newActiveIid = state.players[1].bench[0].iid;
  state = applyAction(state, { type: 'SEND_NEW_ACTIVE', iid: newActiveIid, senderIdx: 1 }, pool);
  assert.equal(state.players[1].active?.iid, newActiveIid, 'defender should have a new Active');
  assert.equal(state.turnPhase, 'main', 'after prizes + new Active, Festival Dance should return to main for second attack');
  assert.equal(state.activePlayerIndex, 0, 'second attack should still belong to original attacker');
  assertFestivalLog(state);

  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(state.turnPhase, 'end', 'after the second Festival Dance attack, the turn should end normally');
}

console.log('✅ festival dance regression tests passed');
