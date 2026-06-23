/**
 * energyProvidesType host-aware + 白海獅|沖刷（v5.682）
 * 「移動／選擇『【X】能量』」應納入「當下被視為提供 X 屬性」的特殊能量（古舊=全/稜鏡 on Basic=全/
 * 新衝天 on Stage2=全/燃火/火箭隊），而非只認基本【X】。沖刷(水)為玩家回報案例。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ep-s.mjs'), E = join(ROOT, '.ep-e.ts'), O = join(ROOT, '.ep-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { energyProvidesType } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, energyProvidesType } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const WALREIN = '17996', SEAL = '14339' /*小海獅 水 basic*/, GLOOM = '14320' /*臭臭花 Stage1*/,
      ANCIENT = '17212' /*古舊能量*/, PRISM = '17210' /*稜鏡能量*/, BWATER = '18519' /*基本水*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const H = (cid) => ({ cardId: String(cid) }); // host 輕量物件

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

// ---- energyProvidesType 單元 ----
T('古舊能量 on basic → 視為水 (true)', () => assert.equal(energyProvidesType(H(SEAL), H(ANCIENT), 'Water', pool), true));
T('稜鏡能量 on Basic → 視為水 (true)', () => assert.equal(energyProvidesType(H(SEAL), H(PRISM), 'Water', pool), true));
T('稜鏡能量 on 進化(Stage1) → 只提供無 → 非水 (false)', () => assert.equal(energyProvidesType(H(GLOOM), H(PRISM), 'Water', pool), false));
T('基本水 → 水 (true) / 火 (false)', () => { assert.equal(energyProvidesType(H(SEAL), H(BWATER), 'Water', pool), true); assert.equal(energyProvidesType(H(SEAL), H(BWATER), 'Fire', pool), false); });
T('古舊能量 → 任意屬性皆 true (超)', () => assert.equal(energyProvidesType(H(SEAL), H(ANCIENT), 'Psychic', pool), true));

// ---- 白海獅|沖刷 end-to-end ----
function abilityIdx(cid, name) { return (pool.get(String(cid))?.abilities || []).findIndex(a => a.name === name); }
function rinse(benchEnergyCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: WALREIN, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const walrein = inst(WALREIN);
  const benchSeal = inst(SEAL, { energyAttached: [inst(benchEnergyCid)] });
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: walrein, bench: [benchSeal] }, { ...s.players[1], active: inst(DEF) }] };
  const ai = abilityIdx(WALREIN, '沖刷');
  return { out: applyAction(st, { type: 'USE_ABILITY', iid: walrein.iid, abilityIndex: ai }, pool), benchIid: benchSeal.iid };
}
T('★沖刷：備戰古舊能量 → 視為水、可作來源(開 picker)（HEAD 只認基本水 → 無來源 FAIL）', () => {
  const { out, benchIid } = rinse(ANCIENT);
  assert.ok(out.pendingSelection, '應開選來源 picker');
  assert.deepEqual(out.pendingSelection?.params?.validIids, [benchIid], '古舊能量備戰寶可夢應為有效水能量來源');
});
T('沖刷 baseline：備戰基本水 → 可作來源', () => {
  const { out, benchIid } = rinse(BWATER);
  assert.deepEqual(out.pendingSelection?.params?.validIids, [benchIid]);
});

console.log('\nenergyProvidesType host-aware + 沖刷:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
