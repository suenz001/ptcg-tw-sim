/**
 * 撤退「歸0/免撤退」為最後覆蓋（v5.696）
 * 磁鐵【鋼】能量(撤退0)/一身輕/天空徑線/N的城堡/浮遊石 等「撤退歸0」效果，
 * 應蓋過 咒縛火焰(+1)/大網/重力之玉/鼓擊 等 +撤退（Wilson 裁定:撤退0為最後覆蓋）。
 * 原本磁鐵能量/浮遊石/一身輕在中段就設 cost=0、之後被 +撤退加回 → bug。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rf-s.mjs'), E = join(ROOT, '.rf-e.ts'), O = join(ROOT, '.rf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, computeActiveRetreatCostFor } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, computeActiveRetreatCostFor } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GENESECT = '14779' /*蓋諾賽克特ex Metal retreat2 (一身輕無)*/, MAGNET = '18503' /*磁鐵鋼能量*/,
      LAMP = '19180' /*超級水晶燈火靈ex 咒縛火焰 對手撤退+1*/, CHAR = '14416' /*小火龍 一身輕 retreat2*/,
      DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function st(atkCid, energyIds, oppCid) {
  const s = createGame({ name:'P1', entries:[{cardId:atkCid,count:1}] }, { name:'P2', entries:[{cardId:oppCid,count:1}] }, pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0,
    players:[{ ...s.players[0], active: inst(atkCid,{energyAttached:energyIds.map(e=>inst(e))}), bench:[] },
             { ...s.players[1], active: inst(oppCid), bench:[] }] };
}
const cost = (atk, en, opp) => computeActiveRetreatCostFor(st(atk, en, opp), 0, pool);
let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★磁鐵能量(撤退0) + 對手咒縛火焰(+1) → 0（HEAD 被+1蓋成1 FAIL）', () =>
  assert.equal(cost(GENESECT, [MAGNET], LAMP), 0));
T('★小火龍一身輕(0能量) + 對手咒縛火焰(+1) → 0（HEAD 1 FAIL）', () =>
  assert.equal(cost(CHAR, [], LAMP), 0));
// 對照組
T('對照：蓋諾賽克特ex 無磁鐵 + 咒縛火焰 → base2+1=3', () =>
  assert.equal(cost(GENESECT, [], LAMP), 3));
T('對照：磁鐵能量 + 對手普通(無咒縛) → 0', () =>
  assert.equal(cost(GENESECT, [MAGNET], DEF), 0));
T('對照：蓋諾賽克特ex 無磁鐵 + 對手普通 → base2', () =>
  assert.equal(cost(GENESECT, [], DEF), 2));

console.log('\n撤退歸0最後覆蓋:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
