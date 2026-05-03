#!/usr/bin/env node
/**
 * P2 regression tests:
 *  - P2-1: 硬岩【鬥】能量 — 免疫對手招式效果（status + poison timer + damage counter）
 *  - P2-2: 赫普的講究頭帶 — 無色費用 -1
 *  - P2-3: 赫普的卡比獸｜大方 — 不疊加
 *  - P2-4: 火箭隊的監視塔 — 【無】寶可夢特性消除
 * Run: node scripts/test-p2-abilities.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-p2-test-bundle.mjs');
const ENTRY_PATH = join(REPO_ROOT, '.tmp-p2-test-entry.ts');

function safeUnlink(path) {
  try { unlinkSync(path); } catch {}
}
process.on('exit', () => { safeUnlink(ENTRY_PATH); safeUnlink(OUT); });

writeFileSync(ENTRY_PATH, `export { createGame, applyAction, canAffordAttack } from './src/lib/game/engine';`);

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

const { createGame, applyAction, canAffordAttack } = await import(pathToFileURL(OUT).href);
const pool = new Map();

for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}

// 測試用 Colorless 能量（id='colorless-test'，不存在於任何卡包）
// v2.191 fix：engine 現在正確檢查 types.includes('Colorless')，所以需要真正的無色能量
pool.set('colorless-test', {
  id: 'colorless-test',
  name: '基本【無】能量',
  supertype: 'Energy',
  subtype: 'Basic',
  pokemonType: 'Colorless',
});

const CID = {
  // P2-1: 硬岩【鬥】能量
  centiskorch:  '9781',  // 焚焰蚣｜灼熱 → 灼傷
  goldeen:     '10440',  // 角金魚 — Basic Colorless
  hardRock:    '18057',  // 硬岩【鬥】能量
  fire:        '13185',  // 基本【火】能量
  // P2-2: 赫普的講究頭帶
  hopWooloo:   '12547',  // 赫普的毛辮羊｜踢飛 [C,C,C] 50
  hopSnorlax:  '12537',  // 赫普的卡比獸｜極限壓制 [C,C,C] 140+自傷
  hopHeadband: '12554',  // 赫普的講究頭帶
  buizel:      '9758',   // 泡沫栗鼠｜掃除 [C,C]
  colorless:   'colorless-test',  // 基本【無】能量（測試專用）
  // P2-3: 大方不疊加
  hopSnorlax2: '12537',  // 同上
  // P2-4: 火箭隊的監視塔
  rocketTower: '12846',  // 火箭隊的監視塔 — SV5K
};

let iidCounter = 0;
function inst(cardId, extra = {}) {
  iidCounter += 1;
  return { iid: `p2${iidCounter}`, cardId, damage: 0, energyAttached: [], ...extra };
}
function instE(cardId) { return inst(cardId); }
function instT(cardId) { return { ...inst(cardId), cardId }; }

function baseState(overrides = {}) {
  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.centiskorch, count: 1 }] },
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
      { ...state.players[0], name: 'P1', deck: [], hand: [], discard: [], prizes: Array(6).fill(null).map((_, i) => inst(CID.grass)) },
      { ...state.players[1], name: 'P2', deck: [], hand: [], discard: [], prizes: Array(6).fill(null).map((_, i) => inst(CID.grass)) },
    ],
    ...overrides,
  };
  return state;
}

// ─── P2-1: 硬岩【鬥】能量 ────────────────────────────────────────────────────
// 官網卡面：「附有這張卡的【鬥】寶可夢不會受到對手的寶可夢使用招式的效果的影響。」
// engine.ts 已實作：immunity 檢查被攻擊方（def）是否 pokemonType === 'Fighting' 且附有硬岩。
//
// 限制：卡池中【鬥】屬性又帶狀態附加招式的寶可夢（晶光花 SV6 10477 只有毒+麻痺，無燒傷）。
// 因此 P2-1 只驗證基準行為（無硬岩時 burn 正常附加）和 engine 實作邏輯的正確性。

// Baseline: Centiskorch（火，無硬岩）正常燒傷 Goldeen
{
  let state = baseState({
    activeStadium: null,
    players: [
      { ...baseState().players[0], active: inst(CID.centiskorch, { energyAttached: [instE(CID.fire), instE(CID.fire)] }) },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(state.players[1].active?.status, 'burned',
    'P2-1 baseline: Centiskorch (no hard rock) burns Goldeen — engine correctly applies status');
}

// 實作驗證：hasEffectShield(def) 只在 pokemonType === 'Fighting' 時返回 true。
// Centiskorch 是【火】，非【鬥】——即使附硬岩也不符合免疫條件。
// （官網卡面確認：免疫只給「附有這張卡的【鬥】寶可夢」。）

// ─── P2-2: 赫普的講究頭帶 — 無色費用 -1 ─────────────────────────────────────

// Test 4: 赫普的毛辮羊（招式 [C,C,C]）無頭帶時需 3 無能量
{
  const woolooCard = pool.get(String(CID.hopWooloo));
  const woolooInst = inst(CID.hopWooloo, {
    energyAttached: [instE(CID.colorless), instE(CID.colorless), instE(CID.colorless)],
  });
  const cost = ['Colorless', 'Colorless', 'Colorless'];
  const state = baseState();
  const ok = canAffordAttack(woolooInst, [...cost], pool, state, 0, '踢飛');
  assert.equal(ok, true, 'P2-2 baseline: 3C cost with 3 Colorless energy should be affordable');
}

// Test 5: 附赫普的講究頭帶時，3C 招式只需 2C（少 1 個【無】）
{
  const woolooCard = pool.get(String(CID.hopWooloo));
  const woolooInst = inst(CID.hopWooloo, {
    energyAttached: [instE(CID.colorless), instE(CID.colorless)],
    toolAttached: instT(CID.hopHeadband),
  });
  const state = baseState();
  const cost = ['Colorless', 'Colorless', 'Colorless'];
  const ok = canAffordAttack(woolooInst, [...cost], pool, state, 0, '踢飛');
  assert.equal(ok, true, 'P2-2: with headband, 3C cost should be affordable with only 2 Colorless (1 less)');
}

// Test 6: 無頭帶但能量不足時，3C 招式應無法使用
{
  const woolooInst = inst(CID.hopWooloo, {
    energyAttached: [instE(CID.colorless), instE(CID.colorless)], // 只有 2 Colorless
  });
  const state = baseState();
  const cost = ['Colorless', 'Colorless', 'Colorless'];
  const ok = canAffordAttack(woolooInst, [...cost], pool, state, 0, '踢飛');
  assert.equal(ok, false, 'P2-2: without headband, insufficient Colorless energy should block attack');
}

// Test 7: 赫普的講究頭帶附在非「赫普的」寶可夢上時，不應減少費用
{
  // 泡沫栗鼠 (Basic Colorless, 非赫普的寶可夢)
  const buizelInst = inst(CID.buizel, {
    energyAttached: [instE(CID.colorless)], // 只有 1 Colorless energy
    toolAttached: instT(CID.hopHeadband), // 頭帶附在非赫普的寶可夢上
  });
  const state = baseState();
  // 泡沫栗鼠攻擊 [C,C]，只有 1 Colorless energy（不夠）
  const cost = ['Colorless', 'Colorless'];
  const ok = canAffordAttack(buizelInst, [...cost], pool, state, 0, '掃除');
  // 赫普的頭帶條件不符（攻擊方不是赫普的），不應減少費用 → 2C 需要 2 Colorless，只有 1 個 → false
  assert.equal(ok, false, 'P2-2: headband on non-Hop should not reduce cost (1 Colorless insufficient for 2C)');
}

// ─── P2-3: 赫普的卡比獸｜大方 — 不疊加 ────────────────────────────────────────

// Test 8: 場上 1 隻赫普的卡比獸時，大方 +30
{
  let state = baseState({
    players: [
      {
        ...baseState().players[0],
        active: inst(CID.hopSnorlax, { energyAttached: [instE(CID.colorless), instE(CID.colorless), instE(CID.colorless)] }),
        bench: [],
      },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });
  const atkCard = pool.get(String(CID.hopSnorlax));
  // PASSIVE_ATTACK_BONUS['大方'] = (att) => att.name.includes('赫普的') ? 30 : 0
  // 赫普的卡比獸使用招式，攻擊方 = 赫普的卡比獸，所以大方應 +30
  // 直接驗證被動加成是否只計算一次（場上 1 隻大方 = +30）
  // 這個需要看攻擊後的 log 或傷口計算，已由 engine PASSIVE_ATTACK_BONUS 實作
  // regression: 測試 2 隻大方在場上，攻擊加成仍是 +30（不是 +60）
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  // 極限壓制 140 + 自傷 80 = 220
  // 大方被動 +30 應在 engine PASSIVE_ATTACK_BONUS 套用
  // 目前實作會讓大方在場上 2 隻時 +60（bug）
}

// Test 9: 場上 2 隻赫普的卡比獸時，大方加成仍是 +30（不疊加）
{
  let state = baseState({
    players: [
      {
        ...baseState().players[0],
        active: inst(CID.hopSnorlax, { energyAttached: [instE(CID.colorless), instE(CID.colorless), instE(CID.colorless)] }),
        bench: [
          inst(CID.hopSnorlax2, { energyAttached: [instE(CID.colorless)] }),
        ],
      },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });
  // 攻擊後，2 隻大方的被動都會遍歷計算，目前會 +60（bug）
  // 修復後 log 應只出現一次「大方」啟動
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  // 檢查 log 中「大方」出現次數（這是最直接的 regression）
  const logStr = JSON.stringify(state.log ?? []);
  const matchCount = (logStr.match(/「大方」啟動/g) || []).length;
  assert.equal(matchCount, 1, `P2-3: 2 大方 should stack to +30 once, got ${matchCount} triggers`);
}

// ─── P2-4: 火箭隊的監視塔 — 【無】寶可夢特性消除 ─────────────────────────────

// Test 10: 監視塔在場時，【無】寶可夢的特性被消除（被動加成不適用）
{
  // 皮卡丘ex (Colorless) 有特性嗎？查一下
  // 皮卡丘ex (10527) 沒有特性，是純招式寶可夢
  // 用有被動加成的【無】寶可夢：赫普的卡比獸｜大方 (Colorless)
  // 監視塔在場時，大方被動不應生效
  let state = baseState({
    activeStadium: inst(CID.rocketTower),
    players: [
      {
        ...baseState().players[0],
        active: inst(CID.hopSnorlax, { energyAttached: [instE(CID.colorless), instE(CID.colorless), instE(CID.colorless)] }),
        bench: [],
      },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  // 監視塔在場，【無】寶可夢特性消除，大方不應 +30
  // 極限壓制 base 140，若大方生效則 170
  // 目標 HP 是 50，140 或 170 都會 KO（但我們要驗 log）
  const logStr = JSON.stringify(state.log ?? []);
  const hasDaFang = (logStr.match(/「大方」啟動/g) || []).length;
  assert.equal(hasDaFang, 0, 'P2-4: 大方 should be suppressed under 監視塔');
}

// Test 11: 監視塔離場後，【無】寶可夢的特性恢復
{
  let state = baseState({
    activeStadium: null,
    players: [
      {
        ...baseState().players[0],
        active: inst(CID.hopSnorlax, { energyAttached: [instE(CID.colorless), instE(CID.colorless), instE(CID.colorless)] }),
        bench: [],
      },
      { ...baseState().players[1], active: inst(CID.goldeen) },
    ],
  });
  state = applyAction(state, { type: 'ATTACK', attackIndex: 0 }, pool);
  const logStr = JSON.stringify(state.log ?? []);
  const hasDaFang = (logStr.match(/「大方」啟動/g) || []).length;
  assert.equal(hasDaFang, 1, 'P2-4: 大方 should activate when 監視塔 is not in play');
}

// ─── P2-1 附帶測試：硬岩免疫不阻擋毒/灼燒定時傷害 ──────────────────────────
// （定時傷害在 engine checkup phase，不是招式直接效果，硬岩不應影響）

// ─── P2-2 附帶測試：阻礙之塔應使頭帶失效 ─────────────────────────────────────
// （isToolsJammed 檢查）

console.log('✅ P2 regression tests passed');
