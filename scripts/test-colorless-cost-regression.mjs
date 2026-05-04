#!/usr/bin/env node
/**
 * Regression: 【無】費用可由任意能量支付；有色費用仍必須由對應屬性能量支付。
 * Run: node scripts/test-colorless-cost-regression.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-colorless-cost-test-bundle.mjs');
const ENTRY_PATH = join(REPO_ROOT, '.tmp-colorless-cost-test-entry.ts');

function safeUnlink(path) {
  try { unlinkSync(path); } catch {}
}
process.on('exit', () => { safeUnlink(ENTRY_PATH); safeUnlink(OUT); });

writeFileSync(ENTRY_PATH, `export { createGame, canAffordAttack } from './src/lib/game/engine';`);

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

const { createGame, canAffordAttack } = await import(pathToFileURL(OUT).href);
const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT, 'static/cards', f), 'utf8'))) {
    pool.set(String(c.id), c);
  }
}

const CID = {
  megaKangaskhanEx: '14071', // 超級袋獸ex｜機關槍合擊 [C,C,C]
  water: '18519',           // 基本【水】能量
  dark: '14152',            // 基本【惡】能量
  fire: '13185',            // 基本【火】能量
  mist: '9912',             // 薄霧能量：提供 1 個【無】
};

let iidCounter = 0;
function inst(cardId, extra = {}) {
  iidCounter += 1;
  return { iid: `cc${iidCounter}`, cardId, damage: 0, energyAttached: [], ...extra };
}
function instE(cardId) { return inst(cardId); }

function baseState(attackerInst) {
  let state = createGame(
    { name: 'P1', entries: [{ cardId: CID.megaKangaskhanEx, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.megaKangaskhanEx, count: 1 }] },
    pool,
  );
  return {
    ...state,
    phase: 'playing',
    turnPhase: 'main',
    activePlayerIndex: 0,
    firstPlayerIdx: 1,
    isFirstTurn: false,
    players: [
      { ...state.players[0], active: attackerInst, bench: [], hand: [], deck: [], discard: [] },
      { ...state.players[1], active: inst(CID.megaKangaskhanEx), bench: [], hand: [], deck: [], discard: [] },
    ],
  };
}

const kangCard = pool.get(CID.megaKangaskhanEx);
const attack = kangCard.attacks.find((a) => a.name === '機關槍合擊');
assert.deepEqual(attack.cost, ['Colorless', 'Colorless', 'Colorless'], '卡表確認：機關槍合擊費用應為 [C,C,C]');

{
  const kang = inst(CID.megaKangaskhanEx, {
    energyAttached: [instE(CID.water), instE(CID.mist), instE(CID.dark)],
  });
  const ok = canAffordAttack(kang, [...attack.cost], pool, baseState(kang), 0, '機關槍合擊');
  assert.equal(ok, true, '超級袋獸ex：基本【水】+薄霧+基本【惡】共 3 顆能量應可支付 [C,C,C]');
}

{
  const kang = inst(CID.megaKangaskhanEx, {
    energyAttached: [instE(CID.water), instE(CID.dark)],
  });
  const ok = canAffordAttack(kang, [...attack.cost], pool, baseState(kang), 0, '機關槍合擊');
  assert.equal(ok, false, '超級袋獸ex：只有 2 顆任意能量不能支付 [C,C,C]');
}

{
  const kang = inst(CID.megaKangaskhanEx, {
    energyAttached: [instE(CID.water), instE(CID.fire)],
  });
  const ok = canAffordAttack(kang, ['Water', 'Colorless'], pool, baseState(kang), 0, 'mixed-cost-test');
  assert.equal(ok, true, '混合費用 [W,C]：基本【水】支付 W，基本【火】應可支付 C');
}

{
  const kang = inst(CID.megaKangaskhanEx, {
    energyAttached: [instE(CID.fire), instE(CID.dark)],
  });
  const ok = canAffordAttack(kang, ['Water', 'Colorless'], pool, baseState(kang), 0, 'mixed-cost-test');
  assert.equal(ok, false, '混合費用 [W,C]：沒有【水】時，即使有 2 顆其他能量也不能支付 W');
}

console.log('✅ colorless cost regression passed');
