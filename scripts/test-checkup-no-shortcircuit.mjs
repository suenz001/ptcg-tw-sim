/**
 * v5.764 §11 規則:寶可夢檢查(checkup)必須完整結算雙方所有特殊狀態。
 * 原本 poison/burn 致死時 early-return + 跳過剩餘 checkup → 對手中毒/灼傷不結算、
 * 雙方睡眠不擲幣醒、麻痺不解除(多停一回合)。本測試:雙方 active 都中毒、aIdx(P0)中毒死,
 * 驗 dIdx(P1)的中毒「也」結算(damage +10)。HEAD 因 early-return 會是 0 → FAIL。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cu-s.js'), E = join(ROOT, '.cu-e.ts'), O = join(ROOT, '.cu-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
// 找一張低HP(<=70)基礎 + 一張高HP(>=200)基礎
function findBasic(pred) { for (const [id, c] of pool) { if (c.supertype === 'Pokemon' && (c.subtype === 'Basic' || c.stage === 'Basic' || !c.evolvesFrom) && c.hp && pred(+c.hp)) return id; } return null; }
const LOW = findBasic(h => h >= 50 && h <= 70), HIGH = findBasic(h => h >= 200);
const W = '18519';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
function mkState() {
  const lowHP = +pool.get(LOW).hp;
  const s = createGame({ name: 'A', entries: [{ cardId: LOW, count: 1 }] }, { name: 'B', entries: [{ cardId: HIGH, count: 1 }] }, pool);
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 4,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(W)], discard: [], prizes: Array.from({length:6},()=>inst(W)), bench: [inst(LOW)], active: inst(LOW, { status: 'poisoned', damage: lowHP - 10 }) },
      { ...s.players[1], hand: [], deck: [inst(W)], discard: [], prizes: Array.from({length:6},()=>inst(W)), bench: [], active: inst(HIGH, { status: 'poisoned', damage: 0 }) }] } };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★A(中毒死)+B(中毒) → END_TURN:A 死、B 的中毒也結算(+10)', () => {
  const { st } = mkState();
  const out = applyAction(st, { type: 'END_TURN' }, pool);
  assert.equal(out.players[0].active, null, 'A active 應因中毒死=null');
  assert.ok(out.players[1].active, 'B active 應還在');
  assert.equal(out.players[1].active.damage, 10, 'B 的中毒應結算 +10(HEAD early-return 會是 0),實得 ' + out.players[1].active.damage);
});
console.log('\ncheckup 不短路(雙方狀態完整結算):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
