// v5.711 回歸:烈箭鷹|氣旋競爭 + 尖牙籠|整隻咬「依/判對手撤退費」改用有效撤退費
//   (computeActiveRetreatCostFor,含鼓擊/咒縛火焰/磁鐵鋼/浮遊等修正),不再用 base retreatCost.length。
//   v5.690 audit 漏網兩張。用 retreatCostIncreaseThisTurn(鼓擊式 +N) 觸發 有效≠base。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-rc.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-rc.ts'); const O = join(ROOT, '.ent-rc.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { ATTACK_PRE } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const HAWK = '10980', FANG = '18424';
const R0 = '14443', R1 = '14086';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const mkState = (atkCid, defCid, defFlags = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false, log: [],
  activeStadium: null,
  players: [
    { name: 'P1', active: inst(atkCid), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    { name: 'P2', active: inst(defCid, defFlags), bench: [], hand: [], deck: [], discard: [], prizes: [] },
  ],
});
const dmg = (key, st) => ATTACK_PRE.get(key)(st, 0, pool).damage;

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('氣旋競爭:對手base撤退1+鼓擊+1→有效2≥2→220 [驗HEAD base=1<2=110 FAIL]', () => {
  const d = dmg('烈箭鷹|氣旋競爭', mkState(HAWK, R1, { retreatCostIncreaseThisTurn: 1 }));
  assert.equal(d, 220, `應 220 實 ${d}`);
});
T('氣旋競爭:對手base撤退1無修正→有效1<2→110 (sanity)', () => {
  const d = dmg('烈箭鷹|氣旋競爭', mkState(HAWK, R1));
  assert.equal(d, 110, `應 110 實 ${d}`);
});
T('氣旋競爭:對手base撤退0+鼓擊+2→有效2≥2→220 [驗HEAD base=0=110 FAIL]', () => {
  const d = dmg('烈箭鷹|氣旋競爭', mkState(HAWK, R0, { retreatCostIncreaseThisTurn: 2 }));
  assert.equal(d, 220, `應 220 實 ${d}`);
});
T('整隻咬:對手base撤退0+鼓擊+1→有效1≠0→80 [驗HEAD base=0==0=160 FAIL]', () => {
  const d = dmg('尖牙籠|整隻咬', mkState(FANG, R0, { retreatCostIncreaseThisTurn: 1 }));
  assert.equal(d, 80, `應 80 實 ${d}`);
});
T('整隻咬:對手base撤退0無修正→有效0→160 (sanity)', () => {
  const d = dmg('尖牙籠|整隻咬', mkState(FANG, R0));
  assert.equal(d, 160, `應 160 實 ${d}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
