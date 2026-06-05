// 回歸測試網：M5 J 標 coverage 補實裝 3 招（v5.455）
// 薩戮德|後投 / 盔甲鳥|鋼鐵利刃 / 青銅鐘|金屬障礙
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-m5j-entry.ts');
const OUT = join(ROOT, '.tmp-m5j-bundle.mjs');
const SHIM = join(ROOT, '.tmp-m5j-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { createGame, applyAction } from './src/lib/game/engine';\n`);
await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(OUT).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const CID = { zarude:'19198', skarmory:'19202', bronzong:'19206', defender:'13163',
  flygon:'14432', eevee:'18068', darkE:'14430', metalE:'14434', fightE:'14104' };

let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `m${++iid}`, cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
const e = (cardId) => inst(cardId);
const energies = (...ids) => ids.map(e);
const atkIdx = (cid, name) => pool.get(String(cid))?.attacks?.findIndex(a => a.name === name) ?? -1;

function baseState(active0, extraP0 = {}, active1 = null, extraP1 = {}) {
  const state = createGame(
    { name: 'P1', entries: [{ cardId: CID.defender, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.defender, count: 1 }] }, pool);
  return { ...state, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    firstPlayerIdx: 1, isFirstTurn: false, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: 0,
    players: [
      { ...state.players[0], name:'P1', hand:[], deck:[], discard:[], prizes:[], bench:[], active: active0, ...extraP0 },
      { ...state.players[1], name:'P2', hand:[], deck:[], discard:[], prizes:[], bench:[], active: active1 ?? inst(CID.defender), ...extraP1 },
    ] };
}
function attack(st, cid, name, extra = {}) {
  const idx = atkIdx(cid, name);
  assert.notEqual(idx, -1, `${pool.get(String(cid))?.name} 應有招式 ${name}`);
  return applyAction(st, { type: 'ATTACK', attackIndex: idx, ...extra }, pool);
}
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  ✅ ${name}`); passed++; } catch (err) { console.log(`  ❌ ${name}: ${err.message}`); failed++; } }

// ── ① 薩戮德|後投 ──
test('薩戮德|後投：對手 active 30 + 自選 1 隻備戰受 30', () => {
  const benchMon = inst(CID.defender);
  const st = baseState(inst(CID.zarude, { energyAttached: energies(CID.darkE) }), { bench: [benchMon] });
  let n = attack(st, CID.zarude, '後投');
  assert.equal(n.players[1].active?.damage, 30, '對手 active 應受 30');
  assert.ok(n.pendingSelection, '應開 bench-choose pending');
  n = applyAction(n, { type: 'RESOLVE_SELECTION', effectKey: 'm5j-zarude-backthrow', selectedIids: [benchMon.iid], actorIdx: 0 }, pool);
  assert.equal(n.players[0].bench[0]?.damage, 30, '自方選定備戰應受 30');
});
test('薩戮德|後投：無備戰時不卡死、對手仍受 30', () => {
  const st = baseState(inst(CID.zarude, { energyAttached: energies(CID.darkE) }));
  const n = attack(st, CID.zarude, '後投');
  assert.equal(n.players[1].active?.damage, 30);
});

// ── ② 盔甲鳥|鋼鐵利刃 ──
test('盔甲鳥|鋼鐵利刃：手牌丟 2 張基本鋼 → 80 傷害', () => {
  const m1 = e(CID.metalE), m2 = e(CID.metalE);
  const st = baseState(inst(CID.skarmory, { energyAttached: energies(CID.metalE) }), { hand: [m1, m2] });
  const n = attack(st, CID.skarmory, '鋼鐵利刃', { discardedEnergyIids: [m1.iid, m2.iid] });
  assert.equal(n.players[1].active?.damage, 80, '應 2×40=80');
  assert.equal(n.players[0].hand.length, 0, '手牌 2 張鋼能量應已丟棄');
  assert.equal(n.players[0].discard.length, 2, '棄牌區應 +2');
});
test('盔甲鳥|鋼鐵利刃：不丟 → 0 傷害', () => {
  const m1 = e(CID.metalE);
  const st = baseState(inst(CID.skarmory, { energyAttached: energies(CID.metalE) }), { hand: [m1] });
  const n = attack(st, CID.skarmory, '鋼鐵利刃', { discardedEnergyIids: [] });
  assert.equal(n.players[1].active?.damage ?? 0, 0, '不丟應 0 傷害');
});

// ── ③ 青銅鐘|金屬障礙 ──
test('青銅鐘|金屬障礙：120 傷害 + 自身設下回合進化減傷旗標 100', () => {
  const st = baseState(inst(CID.bronzong, { energyAttached: energies(CID.metalE, CID.metalE, CID.metalE) }));
  const n = attack(st, CID.bronzong, '金屬障礙');
  assert.equal(n.players[1].active?.damage, 120, '應 120');
  assert.equal(n.players[0].active?.evolutionDamageReduceNextTurn, 100, '應設 evolutionDamageReduceNextTurn=100');
});

// ── ④ 引擎消費：進化攻擊者 -100，基礎攻擊者不減 ──
test('金屬障礙減傷：進化攻擊者 130 → 30（-100）', () => {
  const def = inst(CID.defender, { evolutionDamageReduceThisTurn: 100 });
  const st = baseState(inst(CID.flygon, { energyAttached: energies(CID.fightE, CID.fightE) }), {}, def);
  const n = attack(st, CID.flygon, '利刃之風');
  assert.equal(n.players[1].active?.damage, 30, '130-100 應為 30');
});
test('金屬障礙減傷：基礎攻擊者 20 不減（非進化）', () => {
  const def = inst(CID.defender, { evolutionDamageReduceThisTurn: 100 });
  const st = baseState(inst(CID.eevee, { energyAttached: energies(CID.fightE, CID.fightE) }), {}, def);
  const n = attack(st, CID.eevee, '咬');
  assert.equal(n.players[1].active?.damage, 20, '基礎攻擊者不受減傷，應 20');
});

console.log(`\nM5 J coverage fix: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
