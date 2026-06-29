import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rh-s.js'), E = join(ROOT, '.rh-e.ts'), O = join(ROOT, '.rh-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';\nexport { getEffectiveHP } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST, ATTACK_PRE, getEffectiveHP } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const YVELTAL = '18029', WILLDUN = '14086', CAPE = '17158', ENERGY = '14102';
const hpOf = cid => Number(pool.get(cid)?.hp ?? 0);
let MANYULA = null;
for (const [id, c] of pool) if ((c.attacks || []).some(a => a.name === '報應爪')) { MANYULA = id; break; }
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const cape = () => ({ iid: 't' + (++nn), cardId: CAPE });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));
const mkSt = (p0active, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
  players: [ { name: 'P1', active: p0active, bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) }, p1 ] });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('前提:英雄斗篷提升有效HP', () => {
  assert.ok(getEffectiveHP(inst(WILLDUN, { toolAttached: cape() }), pool, null) > getEffectiveHP(inst(WILLDUN), pool, null));
});
T('死亡靈魂:有效剩餘>50(附斗篷)→不誤KO', () => {
  const st = mkSt(inst(YVELTAL), { name: 'P2', active: inst(WILLDUN, { damage: hpOf(WILLDUN) - 40, toolAttached: cape() }), bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) });
  const out = ATTACK_POST.get('伊裴爾塔爾ex|死亡靈魂')(st, 0, pool, {});
  assert.ok(out.players[1].active && out.players[1].active.cardId === WILLDUN, '有效剩餘>50→不該昏厥(HEAD base剩40誤KO)');
});
T('死亡靈魂控制:無道具有效剩40→正常KO', () => {
  const st = mkSt(inst(YVELTAL), { name: 'P2', active: inst(WILLDUN, { damage: hpOf(WILLDUN) - 40 }), bench: [inst(WILLDUN)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) });
  const out = ATTACK_POST.get('伊裴爾塔爾ex|死亡靈魂')(st, 0, pool, {});
  assert.ok(out.players[1].discard.some(c => c.cardId === WILLDUN), '有效剩40≤50→應昏厥');
});
T('報應爪:自身有效剩餘>50(附斗篷)→不誤+170', () => {
  assert.ok(MANYULA, '找不到 瑪狃拉|報應爪');
  const st = mkSt(inst(MANYULA, { damage: hpOf(MANYULA) - 40, toolAttached: cape() }), { name: 'P2', active: inst(WILLDUN), bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) });
  const r = ATTACK_PRE.get('瑪狃拉|報應爪')(st, 0, pool, {});
  assert.equal(r.damage, 20, '有效剩>50→不+170,應=20(HEAD base剩40誤=190)');
});
T('報應爪控制:無道具有效剩40→+170=190', () => {
  const st = mkSt(inst(MANYULA, { damage: hpOf(MANYULA) - 40 }), { name: 'P2', active: inst(WILLDUN), bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) });
  const r = ATTACK_PRE.get('瑪狃拉|報應爪')(st, 0, pool, {});
  assert.equal(r.damage, 190, '有效剩40≤50→+170=190');
});
console.log('\n剩餘HP門檻用有效HP(v5.778):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
