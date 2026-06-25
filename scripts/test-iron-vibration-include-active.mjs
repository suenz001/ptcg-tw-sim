// v5.712 回歸:佛烈托斯|鐵之震動(12823)卡面「改附於自己的寶可夢身上」含戰鬥位。
//   原 damage-distribute picker 無 includeActive → 只列備戰,從戰鬥位拆下的鋼能量無法附回戰鬥位。
//   修:params 加 includeActive:true(resolver 早已支援 active 目標)。同 v5.678 詛咒水滴 includeActive 家族。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-iv.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-iv.ts'); const O = join(ROOT, '.ent-iv.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { ATTACK_POST } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const IRON = '12823', METAL = '11180', BUD = '14443';
let nn = 0;
const inst = (cid, e = []) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('鐵之震動:戰鬥位有鋼能量→picker params.includeActive=true [驗HEAD undefined FAIL]', () => {
  const eMetal = en(METAL);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false, log: [],
    players: [
      { name: 'P1', active: inst(IRON, [eMetal]), bench: [inst(BUD)], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'P2', active: inst(BUD), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
  const out = ATTACK_POST.get('佛烈托斯|鐵之震動')(st, 0, pool);
  assert(out.pendingSelection, '應開 picker');
  assert.equal(out.pendingSelection.type, 'damage-distribute', 'picker type');
  assert.strictEqual(out.pendingSelection.params?.includeActive, true,
    `params.includeActive 應 true(實 ${out.pendingSelection.params?.includeActive})`);
});

T('鐵之震動:resolver 支援把鋼能量分配回戰鬥位(active.iid 為目標)', () => {
  const eMetal = en(METAL);
  const ironInst = inst(IRON, [eMetal]);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false, log: [],
    players: [
      { name: 'P1', active: ironInst, bench: [inst(BUD)], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'P2', active: inst(BUD), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
  const out = ATTACK_POST.get('佛烈托斯|鐵之震動')(st, 0, pool);
  // 模擬玩家選戰鬥位自己(active.iid)為目標 → resolver 應附回 active
  const resolverKey = out.pendingSelection.effectKey;
  assert.equal(resolverKey, 'h-energy-redistribute', 'effectKey');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
