/**
 * 沙鐵皮|磁場炸裂 — 卡面僅「不計算弱點」→ 應 skipWeakness(只跳弱點),抵抗力仍計(v5.783)
 * HEAD 誤用 skipWeakRes(連抵抗力一起跳)。驗:PRE 回傳 skipWeakness=true 且 skipWeakRes 不為 true。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sm-s.js'), E = join(ROOT, '.sm-e.ts'), O = join(ROOT, '.sm-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const SANDYGAST = '12775' === '12775' ? null : null; // placeholder
// 找 沙鐵皮 id
let SAND = null;
for (const [id, c] of pool) if (c.name === '沙鐵皮' && (c.attacks||[]).some(a=>a.name==='磁場炸裂')) { SAND = id; break; }
const ENERGY = '18519';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const eng = () => ({ iid: 'e' + (++nn), cardId: ENERGY, damage: 0, energyAttached: [] });
function mk(nEnergy) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    players: [
      { name: 'P1', active: inst(SAND, { energyAttached: Array.from({length:nEnergy}, eng) }), bench: [], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'P2', active: inst(SAND), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ] };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
T('前提:找到 沙鐵皮|磁場炸裂', () => { assert.ok(SAND, '找不到 沙鐵皮'); });
T('★≥3能量(90):skipWeakness=true 且 skipWeakRes 不為 true', () => {
  const r = ATTACK_PRE.get('沙鐵皮|磁場炸裂')(mk(3), 0, pool, {});
  assert.equal(r.damage, 90, '3能量應 90');
  assert.equal(r.skipWeakness, true, '應只跳弱點');
  assert.notEqual(r.skipWeakRes, true, '不應跳抵抗力(HEAD=skipWeakRes:true)');
});
T('★<3能量(20):skipWeakness=true 且 skipWeakRes 不為 true', () => {
  const r = ATTACK_PRE.get('沙鐵皮|磁場炸裂')(mk(1), 0, pool, {});
  assert.equal(r.damage, 20, '1能量應 20');
  assert.equal(r.skipWeakness, true);
  assert.notEqual(r.skipWeakRes, true, '不應跳抵抗力(HEAD=skipWeakRes:true)');
});
console.log('\n沙鐵皮磁場炸裂只跳弱點(v5.783):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
