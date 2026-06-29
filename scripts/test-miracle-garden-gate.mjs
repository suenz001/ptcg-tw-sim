/**
 * 神秘花園 使用 gate — §17.41.F 官方裁定（v5.767）
 * 卡面：「若從手牌將1張能量卡丟棄，則可從牌庫抽卡直到手牌張數＝場上【超】寶可夢數量為止。」
 * 只有在「丟 1 張能量後會實際抽到 ≥1 張」時才可使用，否則白丟能量＝不可使用。
 *   (#2) 手牌張數已達場上【超】數 → 不可用（丟後抽 0）
 *   (#3) 場上無【超】寶可夢 → 不可用
 *   (#4) 牌庫沒有卡 → 不可用
 *   (正常) 場上【超】≥手牌 + 牌庫有卡 → 可用，抽到手牌＝【超】數
 * 驗 HEAD FAIL：未修版本在 (#2)(#3)(#4) 會誤丟能量（hand 少 1、discard 多 1）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.mg-s.js'), E = join(ROOT, '.mg-e.ts'), O = join(ROOT, '.mg-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

// 找一張 live 的【超】基礎寶可夢、一張非【超】基礎寶可夢、基本能量、神秘花園
function findCard(pred) { for (const c of pool.values()) if (pred(c)) return String(c.id); return null; }
const GARDEN = '14083'; // 神秘花園 (M1S)
const PSYCHIC = findCard(c => c.supertype === 'Pokemon' && c.pokemonType === 'Psychic' && c.subtype === 'Basic' && c.hp);
const NONPSY = findCard(c => c.supertype === 'Pokemon' && c.pokemonType && c.pokemonType !== 'Psychic' && c.subtype === 'Basic' && c.hp);
const ENERGY = findCard(c => c.supertype === 'Energy' && (c.subtype === 'Basic' || /基本/.test(c.name || '')));
assert(PSYCHIC && NONPSY && ENERGY && pool.get(GARDEN), `缺測試卡: psy=${PSYCHIC} nonpsy=${NONPSY} en=${ENERGY} garden=${!!pool.get(GARDEN)}`);

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));

// 建構：P0 即將使用神秘花園。可調 active/bench 屬性、手牌張數、牌庫張數。
function mk({ active, bench = [], handExtra = 0, deckN = 5 }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: PSYCHIC, count: 1 }] }, { name: 'P2', entries: [{ cardId: NONPSY, count: 1 }] }, pool);
  // 手牌固定含 1 張能量 + handExtra 張能量（都是能量，方便控制手牌張數）
  const hand = [inst(ENERGY), ...Array.from({ length: handExtra }, () => inst(ENERGY))];
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 3,
    activeStadium: inst(GARDEN), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false],
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand, deck: Array.from({ length: deckN }, () => inst(ENERGY)), discard: [], prizes: prize(6), active, bench },
      { ...s.players[1], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6), bench: [], active: inst(NONPSY) }] };
}
const USE = { type: 'USE_STADIUM' };

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// 正常：1 隻【超】active + 手牌 1 張能量 → 可用（丟後 hand 0，抽到 1）
T('正常:1超+手牌1→可用(開picker,能量未丟)', () => {
  const st = mk({ active: inst(PSYCHIC), handExtra: 0, deckN: 5 });
  const out = applyAction(st, USE, pool);
  assert.ok(out.pendingSelection && out.pendingSelection.effectKey === 'miracle-garden-draw', '應開能量丟棄 picker');
  assert.equal(out.players[0].hand.length, 1, '開 picker 階段手牌不應變動');
  assert.equal(out.players[0].discard.length, 0, '尚未丟能量');
});

// (#3) 場上無【超】寶可夢 → 不可用（能量不丟）
T('#3 無【超】寶可夢→不可用(能量不丟)', () => {
  const st = mk({ active: inst(NONPSY), handExtra: 2, deckN: 5 });
  const out = applyAction(st, USE, pool);
  assert.equal(out.pendingSelection, null, '不應開 picker');
  assert.equal(out.players[0].hand.length, 3, '手牌不應減少(能量沒被丟)');
  assert.equal(out.players[0].discard.length, 0, '不應丟能量');
});

// (#2) 手牌張數已達場上【超】數 → 不可用：1 隻【超】+手牌 2 張(psychic1<hand2)
T('#2 手牌≥【超】數→不可用(能量不丟)', () => {
  const st = mk({ active: inst(PSYCHIC), handExtra: 1, deckN: 5 }); // psychic=1, hand=2
  const out = applyAction(st, USE, pool);
  assert.equal(out.pendingSelection, null, '不應開 picker');
  assert.equal(out.players[0].hand.length, 2, '手牌不應減少');
  assert.equal(out.players[0].discard.length, 0, '不應丟能量');
});

// (#4) 牌庫沒有卡 → 不可用
T('#4 空牌庫→不可用(能量不丟)', () => {
  const st = mk({ active: inst(PSYCHIC), handExtra: 0, deckN: 0 });
  const out = applyAction(st, USE, pool);
  assert.equal(out.pendingSelection, null, '不應開 picker');
  assert.equal(out.players[0].hand.length, 1, '手牌不應減少');
  assert.equal(out.players[0].discard.length, 0, '不應丟能量');
});

// 邊界：psychic=hand（2 隻【超】+手牌 2 張）→ 可用（丟後 hand1，抽到 2，抽 1）
T('邊界:【超】數==手牌數→可用', () => {
  const st = mk({ active: inst(PSYCHIC), bench: [inst(PSYCHIC)], handExtra: 1, deckN: 5 }); // psychic=2, hand=2
  const out = applyAction(st, USE, pool);
  assert.ok(out.pendingSelection && out.pendingSelection.effectKey === 'miracle-garden-draw', '【超】數==手牌數應可用');
});

console.log('\n神秘花園 gate(§17.41.F):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
