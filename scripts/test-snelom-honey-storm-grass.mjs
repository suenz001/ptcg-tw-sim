/**
 * 蜜集大蛇ex|蜜糖風暴 — 草能量數 host-aware 回歸保護（v5.684）
 * 卡面：「增加自己的所有寶可夢身上附加的【草】能量的數量×30點傷害。」
 * 生效版在 effects.ts:7081 selfAllEnergyMultiplyPre(host-aware)，本來就正確認列
 *   基本草(name fallback)/繁茂草=2/古舊/稜鏡(Basic)。本檔同版移除 lopunny 內一份
 *   pokemonType==='Grass'(漏算基本草) 的【重複註冊死碼】(從未生效)，此測確保刪後行為不變。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.hs-s.mjs'), E = join(ROOT, '.hs-e.ts'), O = join(ROOT, '.hs-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const SNELOM = '10907' /*蜜集大蛇ex 蜜糖風暴*/, GRASS = '11173' /*基本草能量*/, ANCIENT = '17212' /*古舊(視為草)*/, PSY = '11177' /*基本超(非草)*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const en = (cid) => inst(cid);
function mk(activeEnergy, benchEnergy = []) {
  const s = createGame({ name: 'P1', entries: [{ cardId: SNELOM, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(SNELOM, { energyAttached: activeEnergy }), bench: benchEnergy.length ? [inst(DEF, { energyAttached: benchEnergy })] : [] }, { ...s.players[1], active: inst(DEF) }] };
}
const dmg = (st) => ATTACK_PRE.get('蜜集大蛇ex|蜜糖風暴')(st, 0, pool).damage;

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('基本草能量正確認列：active 2 草 + bench 1 草 = 3 → 30+90=120', () => {
  assert.equal(dmg(mk([en(GRASS), en(GRASS)], [en(GRASS)])), 120);
});
T('古舊能量(視為草)也算：1 古舊 → 30+30=60', () => {
  assert.equal(dmg(mk([en(ANCIENT)])), 60);
});
T('baseline：無草能量(基本超) → 30', () => {
  assert.equal(dmg(mk([en(PSY)])), 30);
});

console.log('\n蜜糖風暴 草能量數 host-aware(回歸保護):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
