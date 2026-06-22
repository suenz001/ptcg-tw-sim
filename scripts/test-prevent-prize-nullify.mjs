/**
 * 防守型特性被「特性消除」壓制 — 批次1：被KO/獎賞類 gate（v5.655）
 * (1) 無回歸：脆弱蛻殼(脫殼忍者)對 ex 攻擊者仍正常阻止獎賞（gate 不破壞正常）。
 * (2) gate 條件：振翼髮｜暗夜羽擊在對手戰鬥場時，我方 active 防守特性(鬆口氣/脆弱蛻殼)被 isAbilityHolderEffective 判為失效
 *     → engine PASSIVE_ON_KO / PASSIVE_PREVENT_PRIZE 與 effects koPrizesAdjusted 的 gate 即依此跳過。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pn-s.js'), E = join(ROOT, '.pn-e.ts'), O = join(ROOT, '.pn-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, isAbilityHolderEffective } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const BRAMBLE = '16826' /*振翼髮 暗夜羽擊*/, SHEDINJA = '14063' /*脫殼忍者 脆弱蛻殼60HP*/, WILLDUN = '10619' /*願增猿ex 鬆口氣210HP*/, LAPRAS = '14085' /*拉普拉斯ex 衝浪140(ex,無消除)*/, W = '18519';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(W));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// (1) 無回歸：拉普拉斯ex(ex,非振翼髮) KO 脫殼忍者 → 脆弱蛻殼正常 → 0 獎賞
T('無回歸:ex攻擊者KO脫殼忍者→脆弱蛻殼阻止獎賞(prizes不變)', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: LAPRAS, count: 1 }] }, { name: 'P2', entries: [{ cardId: SHEDINJA, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(W)], discard: [], prizes: prize(6), bench: [], active: inst(LAPRAS, { energyAttached: [inst(W), inst(W), inst(W)] }) },
      { ...s.players[1], hand: [], deck: [inst(W)], discard: [], prizes: prize(6), bench: [], active: inst(SHEDINJA) }] };
  const out = applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(out.players[0].prizes.length, 6, '脆弱蛻殼應阻止獎賞,prizes=' + out.players[0].prizes.length);
});

// (2) gate 條件：對手戰鬥場有振翼髮(暗夜羽擊) → 我方 active 特性判為失效
function effState(oppActiveCid) {
  return { players: [
    { active: inst(oppActiveCid), bench: [] },                         // P0 = 對手(可能是振翼髮)
    { active: inst(WILLDUN), bench: [] },                              // P1 = 我方 active 願增猿ex
  ] };
}
T('★振翼髮在對手場→願增猿ex「鬆口氣」isAbilityHolderEffective=false(會被gate跳過)', () => {
  const st = effState(BRAMBLE);
  const eff = isAbilityHolderEffective(st, st.players[1].active, pool.get(WILLDUN), 1, '鬆口氣', 'active', pool);
  assert.equal(eff, false, '暗夜羽擊應使對手 active 鬆口氣失效');
});
T('對照:對手非振翼髮(拉普拉斯ex)→鬆口氣 isAbilityHolderEffective=true(正常觸發)', () => {
  const st = effState(LAPRAS);
  const eff = isAbilityHolderEffective(st, st.players[1].active, pool.get(WILLDUN), 1, '鬆口氣', 'active', pool);
  assert.equal(eff, true, '無壓制者時鬆口氣應有效');
});
T('★振翼髮在對手場→脫殼忍者「脆弱蛻殼」isAbilityHolderEffective=false', () => {
  const st = { players: [{ active: inst(BRAMBLE), bench: [] }, { active: inst(SHEDINJA), bench: [] }] };
  const eff = isAbilityHolderEffective(st, st.players[1].active, pool.get(SHEDINJA), 1, '脆弱蛻殼', 'active', pool);
  assert.equal(eff, false, '暗夜羽擊應使對手 active 脆弱蛻殼失效');
});

console.log('\n防守特性壓制(批次1 被KO/獎賞):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
