// ⭐v6.492 守衛：攻擊方被反擊打昏 ⇒ 走中央昏厥結算（站長裁定 2026-10-06）
//
// 原本 engine 兩處（存活分支、龐克頭盔）與 effects.fireDefenderOnDamaged 一處各自就地處理，只給基本獎賞張數；
// 昏厥分支的反擊則留給 sanityKOSweep（簡化版）。都沒有擲 波克基斯｜奇跡之吻（卡面「對手的戰鬥寶可夢昏厥時」不限原因）。
// 中央 koAttackerAfterRetaliation ⇒ koTargetAfterAttackDamage（kind='ability-effect'：不是「受到對手招式的傷害」）。
//
// R1 凸凸頭盔（沒打昏對手、存活分支）把攻擊方打昏 ＋ 防守方有波克基斯（正面）⇒ 防守方 1＋1 張
// R2 同上、沒有波克基斯 ⇒ 1 張（正對照：不會憑空多拿）
// R3 攻擊方身上有古舊能量 ⇒ 不 −1（反擊不是「受到對手招式的傷害」），古舊「每場 1 次」也不算用掉
// R4 龐克頭盔把攻擊方打昏 ＋ 波克基斯（正面）⇒ 1＋1
// R5 雙方同時昏厥（攻擊方打昏對手、自己被凸凸頭盔打昏）＋ 波克基斯（正面）⇒ 攻擊方拿 2、防守方拿 1＋1
// R6 攻擊方沒有備戰 ⇒ 終局，防守方獲勝
// R7 中央 helper 單元：反擊沒有讓傷害增加 ⇒ 不動；有增加且達 HP ⇒ 昏厥＋奇跡之吻
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6492-s.mjs'), E = join(ROOT, '.v6492-e.ts'), O = join(ROOT, '.v6492-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport * as EFF from './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, EFF } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const need = (id, name) => { assert.equal(pool.get(id)?.name, name, `fixture：${id} 應為 ${name}`); return id; };
const CACNEA = need('13698', '沙鈴仙人掌'), KOKO = need('12116', '卡璞・鳴鳴ex'), HELMET = need('12211', '凸凸頭盔');
const KISS = need('11227', '波克基斯'), PUNK = need('14146', '龐克頭盔'), ANC = need('17212', '古舊能量'), DEF = '13163';
const eid = (t) => String([...pool.values()].find(c => c.supertype === 'Energy' && c.name === `基本【${t}】能量`).id);
const GRASS = eid('草');
// 【惡】、基礎、非規則、HP ≥ 120（龐克頭盔的持有者，要撐得住突刺 50）
const DARKMON = [...pool.values()].find(c => c.supertype === 'Pokemon' && c.pokemonType === 'Darkness' && c.stage === 'Basic'
  && Number(c.hp) >= 120 && !/ex$/.test(c.name) && ['H', 'I', 'J'].includes(c.regulationMark) && !(c.abilities ?? []).length);
assert.ok(DARKMON, 'fixture：找不到【惡】基礎寶可夢');
let nn = 0; const inst = (cid, x = {}) => ({ iid: 'v92_' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function board(p0, p1) {
  const s = createGame({ name: 'A', entries: [{ cardId: DEF, count: 1 }] }, { name: 'B', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5, log: [],
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [inst(CACNEA)], ...p0 },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [inst(CACNEA)], ...p1 }] };
}
const withHeads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const takenA = (s) => 6 - s.players[0].prizes.length;
const takenB = (s) => 6 - s.players[1].prizes.length;
const attacker = (x = {}) => inst(CACNEA, { damage: 90, energyAttached: [inst(GRASS), inst(GRASS)], ...x });   // HP100，再吃 20 就昏厥
const STAB = 1;   // 沙鈴仙人掌｜突刺 50（卡面無效果文字）
assert.equal(pool.get(CACNEA).attacks[STAB].name, '突刺');

T('R1 凸凸頭盔把攻擊方打昏（對手沒昏厥）＋ 波克基斯 正面 ⇒ 防守方 1＋1 張', () => withHeads(() => {
  const atk = attacker();
  let s = board({ active: atk }, { active: inst(KOKO, { toolAttached: inst(HELMET) }), bench: [inst(KISS)] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.ok(s.players[0].discard.some(c => c.iid === atk.iid), '前置：攻擊方已昏厥');
  assert.ok(s.log.some(l => /奇跡之吻/.test(l.message)), '應擲奇跡之吻');
  assert.equal(takenB(s), 2);
}));
T('R2 正對照：沒有波克基斯 ⇒ 1 張', () => withHeads(() => {
  let s = board({ active: attacker() }, { active: inst(KOKO, { toolAttached: inst(HELMET) }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.equal(takenB(s), 1);
  assert.ok(!s.log.some(l => /奇跡之吻/.test(l.message)));
}));
T('R3 攻擊方身上有古舊能量 ⇒ 不 −1（反擊不是「受到對手招式的傷害」）、每場 1 次不算用掉', () => withHeads(() => {
  let s = board({ active: attacker({ energyAttached: [inst(GRASS), inst(ANC)] }) }, { active: inst(KOKO, { toolAttached: inst(HELMET) }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.equal(takenB(s), 1);
  assert.equal((s.ancientEnergyMinusOneUsed ?? [false, false])[0], false);
}));
T('R4 龐克頭盔把攻擊方打昏 ＋ 波克基斯 正面 ⇒ 1＋1', () => withHeads(() => {
  const atk = inst(CACNEA, { damage: 70, energyAttached: [inst(GRASS), inst(GRASS)] });   // 再吃 40 就昏厥
  let s = board({ active: atk }, { active: inst(DARKMON.id, { toolAttached: inst(PUNK) }), bench: [inst(KISS)] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.ok(s.players[0].discard.some(c => c.iid === atk.iid), '前置：攻擊方已昏厥');
  assert.ok(s.log.some(l => /奇跡之吻/.test(l.message)), '應擲奇跡之吻');
  assert.equal(takenB(s), 2);
}));
T('R5 雙方同時昏厥（昏厥分支的反擊）＋ 波克基斯 正面 ⇒ 攻擊方拿 2、防守方拿 1＋1', () => withHeads(() => {
  const atk = attacker();
  let s = board({ active: atk }, { active: inst(KOKO, { damage: 160, toolAttached: inst(HELMET) }), bench: [inst(KISS)] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.equal(takenA(s), 2, '攻擊方打昏 ex 拿 2');
  assert.ok(s.players[0].discard.some(c => c.iid === atk.iid), '攻擊方也昏厥');
  assert.equal(takenB(s), 2, '防守方 1＋奇跡之吻 1');
  assert.ok(!s.log.some(l => /系統擊倒檢查/.test(l.message)), '不可再走 sanityKOSweep 的簡化版');
}));
T('R6 攻擊方沒有備戰 ⇒ 終局，防守方獲勝', () => withHeads(() => {
  let s = board({ active: attacker(), bench: [] }, { active: inst(KOKO, { toolAttached: inst(HELMET) }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.equal(s.phase, 'game-over');
  assert.equal(s.winner, 1);
}));
T('R7 中央 helper：沒有反擊增加的傷害 ⇒ 不動（自傷造成的昏厥交給 v6.421 流程）', () => {
  const s0 = board({ active: inst(CACNEA, { damage: 100 }) }, { active: inst(KOKO), bench: [inst(KISS)] });
  const s1 = EFF.koAttackerAfterRetaliation(s0, 0, 100, pool);
  assert.strictEqual(s1, s0);
  const s2 = withHeads(() => EFF.koAttackerAfterRetaliation(s0, 0, 80, pool));
  assert.equal(s2.players[0].active, null, '傷害有增加且達 HP ⇒ 昏厥');
  assert.equal(6 - s2.players[1].prizes.length, 2, '1＋奇跡之吻 1');
});

// ⭐v6.493 補：postFn 之後的共用反擊尾段（特性型受傷反擊：磨牙彩皮魚｜反擊 放 3 個指示物）
const BITE = need('11042', '磨牙彩皮魚');
T('R8 特性反擊（磨牙彩皮魚｜反擊，對手沒昏厥 ⇒ 共用反擊尾段）把攻擊方打昏 ＋ 波克基斯 正面 ⇒ 1＋1', () => withHeads(() => {
  const atk = inst(CACNEA, { damage: 80, energyAttached: [inst(GRASS), inst(GRASS)] });   // 再吃 30 就昏厥
  let s = board({ active: atk }, { active: inst(BITE), bench: [inst(KISS)] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.ok(s.players[0].discard.some(c => c.iid === atk.iid), '前置：攻擊方已昏厥');
  assert.ok(s.log.some(l => /奇跡之吻/.test(l.message)), '應擲奇跡之吻');
  assert.equal(takenB(s), 2);
  assert.ok(!s.log.some(l => /系統擊倒檢查/.test(l.message)), '不可再走 sanityKOSweep 的簡化版');
}));
T('R9 特性反擊在昏厥分支（雙方同時昏厥）＋ 波克基斯 正面 ⇒ 攻擊方 1、防守方 1＋1', () => withHeads(() => {
  const atk = inst(CACNEA, { damage: 80, energyAttached: [inst(GRASS), inst(GRASS)] });
  let s = board({ active: atk }, { active: inst(BITE, { damage: 70 }), bench: [inst(KISS)] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: STAB }, pool);
  assert.equal(takenA(s), 1);
  assert.ok(s.players[0].discard.some(c => c.iid === atk.iid), '攻擊方也昏厥');
  assert.equal(takenB(s), 2);
}));

console.log(`\nv6492 攻擊方被反擊打昏走中央結算：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
