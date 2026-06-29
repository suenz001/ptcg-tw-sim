/**
 * 影藏（超級耿鬼ex）獎賞 -1 須「影藏持有者處於有效狀態」— §17.42.B（v5.768）
 * 卡面：自己的【惡】寶可夢受對手「寶可夢ex」招式『傷害』昏厥時，被獲得獎賞卡 -1（須影藏處於有效狀態）。
 *   (A) 無回歸：ex 攻擊方傷害 KO 惡寶可夢、場上有有效影藏 → 獎賞 -1。
 *   (B) ★鐵荊棘ex｜初始化 在場 → 超級耿鬼ex（規則寶可夢）影藏失效 → 不 -1。
 *       驗 HEAD FAIL：未修版只查特性名存在 → 仍誤 -1。
 *   (C) 效果KO（koByAttackDamage=false）→ 不 -1（既有 gate）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.kh-s.js'), E = join(ROOT, '.kh-e.ts'), O = join(ROOT, '.kh-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { koPrizesAdjusted } from './src/lib/game/effects';\nexport { hasEffectiveKageHide } from './src/lib/game/effects/cards/v3001_g3_wave3';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { koPrizesAdjusted, hasEffectiveKageHide } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GENGAR = '15978';  // 超級耿鬼ex（影藏 holder, rule-box ex）
const IRONTHORNS = '16753'; // 鐵荊棘ex（初始化）
const LAPRAS = '14085';  // 拉普拉斯ex（一般 ex 攻擊方，無初始化）
const SNEASEL = '14421'; // 狃拉（惡基礎，base 獎賞 1）
assert(pool.get(GENGAR) && pool.get(IRONTHORNS) && pool.get(LAPRAS) && pool.get(SNEASEL), '缺測試卡');
assert(pool.get(SNEASEL).pokemonType === 'Darkness', '狃拉應為惡');

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });

// state：P0=攻擊方 active=attackerCid；P1=防守方 active=狃拉(被KO) + bench=超級耿鬼ex(影藏)
function mk(attackerCid) {
  return { ancientEnergyMinusOneUsed: [false, false], players: [
    { active: inst(attackerCid), bench: [], discard: [], hand: [], deck: [], prizes: [] },
    { active: inst(SNEASEL), bench: [inst(GENGAR)], discard: [], hand: [], deck: [], prizes: [] },
  ] };
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// (A) 無回歸：拉普拉斯ex 傷害 KO 狃拉，備戰有有效影藏 → base(1) -1 = 0
T('(A)無回歸:ex傷害KO惡+有效影藏→獎賞-1(=0)', () => {
  const s = mk(LAPRAS);
  const r = koPrizesAdjusted(s, s.players[1].active, pool.get(SNEASEL), 0, 1, pool, true);
  assert.equal(r.prizes, 0, '應 base1 -1 =0, 實=' + r.prizes);
  assert.equal(hasEffectiveKageHide(s, 1, pool), true, '影藏應有效');
});

// (B) ★鐵荊棘ex 初始化在場 → 影藏失效 → 不 -1（=base 1）
T('(B)★鐵荊棘ex初始化→影藏失效→不-1(=1)', () => {
  const s = mk(IRONTHORNS);
  const r = koPrizesAdjusted(s, s.players[1].active, pool.get(SNEASEL), 0, 1, pool, true);
  assert.equal(r.prizes, 1, '初始化消除影藏→不-1, 應=1, 實=' + r.prizes);
  assert.equal(hasEffectiveKageHide(s, 1, pool), false, '初始化下影藏應失效');
});

// (C) 效果KO（koByAttackDamage=false）→ 影藏不生效（既有 gate）
T('(C)效果KO→影藏不-1(=1)', () => {
  const s = mk(LAPRAS);
  const r = koPrizesAdjusted(s, s.players[1].active, pool.get(SNEASEL), 0, 1, pool, false);
  assert.equal(r.prizes, 1, '效果KO不套影藏, 應=1, 實=' + r.prizes);
});

console.log('\n影藏 holder-effective(§17.42.B):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
