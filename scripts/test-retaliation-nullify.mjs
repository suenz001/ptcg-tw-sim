/**
 * 防守型特性被「特性消除」壓制 — 批次2：受傷反擊類（v5.656）
 * 振翼髮｜暗夜羽擊壓制對手戰鬥位特性 → 布里卡隆｜尖刺盔甲(受傷時對攻擊方放指示物)應失效。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rn-s.js'), E = join(ROOT, '.rn-e.ts'), O = join(ROOT, '.rn-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const BRAMBLE = '16826' /*振翼髮 暗夜羽擊 + 飛來橫禍90*/, CHESNAUGHT = '18427' /*布里卡隆 尖刺盔甲180HP*/, WAILORD = '16651' /*吼吼鯨 衝浪60(非振翼髮)*/, GRASS = '14102', W = '18519';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(W));
// P0 攻擊者(+3能量)攻擊 P1 布里卡隆(尖刺盔甲, 附1草, 180HP→非致命)。回傳攻擊方自身 damage
function attackerDamageAfter(atkCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: atkCid, count: 1 }] }, { name: 'P2', entries: [{ cardId: CHESNAUGHT, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(W)], discard: [], prizes: prize(6), bench: [], active: inst(atkCid, { energyAttached: [inst(W), inst(W), inst(W)] }) },
      { ...s.players[1], hand: [], deck: [inst(W)], discard: [], prizes: prize(6), bench: [], active: inst(CHESNAUGHT, { energyAttached: [inst(GRASS)] }) }] };
  const out = applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool);
  return out.players[0].active ? out.players[0].active.damage : -1;
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★振翼髮(暗夜羽擊)打布里卡隆 → 尖刺盔甲被壓制,攻擊方不受反擊(0)', () => {
  assert.equal(attackerDamageAfter(BRAMBLE), 0, '尖刺盔甲應失效→攻擊方0傷');
});
T('對照:吼吼鯨(非振翼髮)打布里卡隆 → 尖刺盔甲正常,攻擊方受30(1草×30)', () => {
  assert.equal(attackerDamageAfter(WAILORD), 30, '尖刺盔甲應放30傷於攻擊方');
});

console.log('\n防守特性壓制(批次2 受傷反擊):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
