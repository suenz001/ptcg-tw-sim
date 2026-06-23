/**
 * 銅鏡怪|鏡面攻擊 — 對手與本身同屬性 +30（v5.685）
 * 同名招式兩 LIVE 卡：M5(鋼系,卡面判對手【鋼】+30) / SV5K(超系,判對手【超】+30)。
 * 單一 key 無法區分，但兩版判定屬性=該版自身屬性 → 改判「對手 pokemonType === 攻擊者自身 pokemonType」統一。
 * 原寫死【超】→ M5 鋼版誤判(打鋼不加、打超反加)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.br-s.mjs'), E = join(ROOT, '.br-e.ts'), O = join(ROOT, '.br-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const BRONZE_M5 = '19205' /*銅鏡怪 鋼系*/, BRONZE_SV5K = '9798' /*銅鏡怪 超系*/,
      METAL_OPP = '14377' /*鋼對手*/, PSY_OPP = '14353' /*夢妖 超對手*/, WATER_OPP = '14339' /*小海獅 水對手*/;
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function dmgVS(attackerCid, defCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: attackerCid, count: 1 }] }, { name: 'P2', entries: [{ cardId: defCid, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(attackerCid) }, { ...s.players[1], active: inst(defCid) }] };
  return ATTACK_PRE.get('銅鏡怪|鏡面攻擊')(st, 0, pool).damage;
}

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★M5 銅鏡怪(鋼) 打【鋼】對手 → +30=40（HEAD 寫死判超 → 10 FAIL）', () => assert.equal(dmgVS(BRONZE_M5, METAL_OPP), 40));
T('★M5 銅鏡怪(鋼) 打【超】對手 → 不加=10（HEAD 判超 → 誤加 40 FAIL）', () => assert.equal(dmgVS(BRONZE_M5, PSY_OPP), 10));
T('M5 銅鏡怪(鋼) 打【水】對手 → 10', () => assert.equal(dmgVS(BRONZE_M5, WATER_OPP), 10));
T('SV5K 銅鏡怪(超) 打【超】對手 → +30=40', () => assert.equal(dmgVS(BRONZE_SV5K, PSY_OPP), 40));
T('SV5K 銅鏡怪(超) 打【水】對手 → 10', () => assert.equal(dmgVS(BRONZE_SV5K, WATER_OPP), 10));

console.log('\n銅鏡怪鏡面攻擊 同屬性+30:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
