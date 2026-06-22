/**
 * effectiveHPInline 收斂為委派 engine.getEffectiveHP（v5.677）
 * 原 effects.ts 本地 effectiveHPInline 漏三項 hook（fossilOnField=60 / isToolsJammed / 怪顎龍暴龍根性+150）
 * → markFaintByEffect 與 ~17 處效果KO/狙擊 HP 判定對這些卡誤算（如效果昏厥打不死附特殊能量的怪顎龍）。
 * markFaintByEffect 內部用 effectiveHPInline，收斂後其 damage 必 == getEffectiveHP（單一來源）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.eh-s.mjs'), E = join(ROOT, '.eh-e.ts'), O = join(ROOT, '.eh-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, getEffectiveHP } from './src/lib/game/engine';\nexport { markFaintByEffect } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { getEffectiveHP, markFaintByEffect } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GUAGE = '18071' /*怪顎龍|暴龍根性 180HP, 附特殊能量+150*/, ROCKET = '17213' /*火箭隊能量(特殊)*/, BASIC = '11177' /*基本超*/;
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const en = (cid) => inst(cid);

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★怪顎龍+特殊能量：markFaintByEffect 應 = getEffectiveHP = 330 (180+150)；HEAD 漏暴龍根性 → markFaint=180 FAIL', () => {
  const i = inst(GUAGE, { energyAttached: [en(ROCKET)] });
  const eff = getEffectiveHP(i, pool);
  assert.equal(eff, 330, 'getEffectiveHP 應含暴龍根性 +150');
  assert.equal(markFaintByEffect(i, pool).damage, eff, 'markFaintByEffect 應對齊 getEffectiveHP');
});

T('★fossilOnField：markFaintByEffect 應 = 60（HEAD 漏 fossil 早退 → 用 card.hp 180 FAIL）', () => {
  const i = inst(GUAGE, { fossilOnField: true });
  assert.equal(getEffectiveHP(i, pool), 60, 'fossil 永遠 60');
  assert.equal(markFaintByEffect(i, pool).damage, 60, 'markFaintByEffect 對 fossil 應 60');
});

T('baseline 一般寶可夢(無特殊能量)：markFaint = getEffectiveHP = 180', () => {
  const i = inst(GUAGE, { energyAttached: [en(BASIC)] });
  assert.equal(getEffectiveHP(i, pool), 180, '無特殊能量 → 不加暴龍根性');
  assert.equal(markFaintByEffect(i, pool).damage, 180);
});

console.log('\neffectiveHP 收斂(委派 getEffectiveHP):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
