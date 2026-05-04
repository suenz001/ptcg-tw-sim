#!/usr/bin/env node
/**
 * J 標 Batch A1 focused regression.
 *
 * 卡文來源：static/cards/M3.json（網站卡牌資料庫原始來源）
 * - 圓絲蛛｜緊纏之絲：在下個對手的回合，受到這個招式的寶可夢無法撤退。
 * - 阿利多斯｜毒陣：將對手的戰鬥寶可夢【中毒】。在下個對手的回合，受到這個招式的寶可夢無法撤退。
 * - 君主蛇｜皇家指令：造成自己的場上寶可夢的數量×20點傷害。
 * - 彩粉蝶｜穿堂風：若場上有競技場卡，則增加60點傷害。
 * - 爆焰龜獸｜高溫吐息：擲1次硬幣若為正面，則增加80點傷害。
 * - 小貓怪｜雙重抓：擲2次硬幣，造成正面出現的次數×10點傷害。
 * - 妙喵｜小憩：將這隻寶可夢恢復「20」HP。
 * - 芳香精｜吸取之吻：將這隻寶可夢恢復「30」HP。
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-j-batch-a1-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-j-batch-a1-entry.ts');
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
  spinarak: '17978',
  ariados: '17979',
  serperior: '17983',
  vivillon: '17986',
  turtonator: '17994',
  shinx: '18002',
  espurr: '18009',
  aromatisse: '18012',
  defender: '13163', // 高 HP 測試防禦者，避免 160 傷害直接 KO 導致 active=null
  stadium: '14397',
  grassE: '18382',
  fireE: '18518',
  lightningE: '18520',
  psychicE: '17220',
  colorlessE: '13443', // 燃火能量：目前引擎以 Colorless unit 支付【無】費用
};

let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `j${++iid}`, cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
const e = (cardId) => inst(cardId);
const atkIdx = (cid, name) => pool.get(String(cid))?.attacks?.findIndex((a) => a.name === name) ?? -1;
const energies = (...ids) => ids.map((id) => e(id));

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
      { ...state.players[0], name: 'P1', hand: [], deck: [], discard: [], prizes: [], bench: [], active, ...extraP0 },
      { ...state.players[1], name: 'P2', hand: [], deck: [], discard: [], prizes: [], bench: [], active: inst(CID.defender), ...extraP1 },
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

test('圓絲蛛｜緊纏之絲 deals 10 and marks defender unable to retreat next turn', () => {
  const st = baseState(inst(CID.spinarak, { energyAttached: energies(CID.grassE) }));
  const next = attack(st, CID.spinarak, '緊纏之絲');
  assert.equal(next.players[1].active?.damage, 10);
  assert.equal(next.players[1].active?.cantRetreatNextTurn, true);
});

test('阿利多斯｜毒陣 poisons defender and marks unable to retreat next turn', () => {
  const st = baseState(inst(CID.ariados, { energyAttached: energies(CID.grassE) }));
  const next = attack(st, CID.ariados, '毒陣');
  assert.equal(next.players[1].active?.damage, 50);
  assert.equal(next.players[1].active?.status, 'poisoned');
  assert.equal(next.players[1].active?.cantRetreatNextTurn, true);
});

test('君主蛇｜皇家指令 deals own field count ×20', () => {
  const st = baseState(
    inst(CID.serperior, { energyAttached: energies(CID.grassE) }),
    { bench: [inst(CID.defender), inst(CID.defender), inst(CID.defender)] },
  );
  const next = attack(st, CID.serperior, '皇家指令');
  assert.equal(next.players[1].active?.damage, 80);
});

test('彩粉蝶｜穿堂風 deals 60 plus 60 when stadium is in play', () => {
  const stNoStadium = baseState(inst(CID.vivillon, { energyAttached: energies(CID.grassE) }));
  assert.equal(attack(stNoStadium, CID.vivillon, '穿堂風').players[1].active?.damage, 60);

  const stWithStadium = { ...baseState(inst(CID.vivillon, { energyAttached: energies(CID.grassE) })), activeStadium: inst(CID.stadium) };
  assert.equal(attack(stWithStadium, CID.vivillon, '穿堂風').players[1].active?.damage, 120);
});

test('爆焰龜獸｜高溫吐息 adds 80 damage on heads only', () => {
  const active = () => inst(CID.turtonator, { energyAttached: energies(CID.fireE, CID.fireE, CID.colorlessE) });
  const headsState = baseState(active());
  const heads = withRandom([0.1], () => attack(headsState, CID.turtonator, '高溫吐息'));
  assert.equal(heads.players[1].active?.damage, 160);
  const tailsState = baseState(active());
  const tails = withRandom([0.9], () => attack(tailsState, CID.turtonator, '高溫吐息'));
  assert.equal(tails.players[1].active?.damage, 80);
});

test('小貓怪｜雙重抓 deals 10 per heads across 2 flips', () => {
  const active = () => inst(CID.shinx, { energyAttached: energies(CID.lightningE) });
  const twoHeadsState = baseState(active());
  const twoHeads = withRandom([0.1, 0.1], () => attack(twoHeadsState, CID.shinx, '雙重抓'));
  assert.equal(twoHeads.players[1].active?.damage, 20);
  const oneHeadState = baseState(active());
  const oneHead = withRandom([0.1, 0.9], () => attack(oneHeadState, CID.shinx, '雙重抓'));
  assert.equal(oneHead.players[1].active?.damage, 10);
});

test('妙喵｜小憩 heals itself by 20', () => {
  const st = baseState(inst(CID.espurr, { damage: 50, energyAttached: energies(CID.colorlessE) }));
  const next = attack(st, CID.espurr, '小憩');
  assert.equal(next.players[0].active?.damage, 30);
});

test('芳香精｜吸取之吻 deals 50 and heals itself by 30', () => {
  const st = baseState(inst(CID.aromatisse, { damage: 40, energyAttached: energies(CID.psychicE, CID.colorlessE) }));
  const next = attack(st, CID.aromatisse, '吸取之吻');
  assert.equal(next.players[1].active?.damage, 50);
  assert.equal(next.players[0].active?.damage, 10);
});

console.log(`\nJ Batch A1: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
