// ════════════════════════════════════════════════════════════════════════════
// v6.254 迴歸測試：超級皮可西ex｜光之翼 —— 不受「對手的寶可夢特性效果」影響
//
// 卡面（static/cards/M3.json，id 18007，J 標，逐字）：
//   「這隻寶可夢不會受到對手的寶可夢特性效果的影響。」
//
// 官方裁定（PTCG RULES/PTCG_RULES.md）：
//   L2818「對手的戰鬥場上有特性『初始化』處於生效狀態的鐵荊棘ex時，自己的超級皮可西ex的
//         特性『光之翼』會消除嗎？」→「不會消除。」
//   L2733「…若從手牌抽出超級皮可西ex重疊在自己場上的皮皮身上讓其進化，特性『光之翼』
//         會生效嗎？」→「會生效。」
//   L2722/2723「使用黑夜魔靈的特性『咒詛炸彈』時，可以選擇特性『光之翼』處於生效狀態的
//         對手的超級皮可西ex…？」→「可以。／但…不受特性的效果影響，因此在讓黑夜魔靈
//         [昏厥]後，即會結束招式處理。」
//
// 豁免範圍（站長 2026-08-28 裁定 ＋ 卡面逐字）：
//   ✅ 對手的寶可夢特性：初始化／暗夜羽擊(passive)／對手側黏著束縛
//   ❌ 競技場卡：火箭隊的監視塔／傳說的熔岩洞（不是「寶可夢的特性」）
//   ❌ 招式效果：招式版暗夜羽擊（abilityNullifiedThisTurn）
//   ❌ 自己這一側的寶可夢特性（卡面寫「**對手的**」）
// ════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6254-s.js'), E = join(ROOT, '.v6254-e.ts'), O = join(ROOT, '.v6254-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { isAbilityHolderEffective, isInitializeNullified, isAbilityNullifiedBySticky,\n"
+ "  isAbilityNullifiedByPassive, hasEffectiveOppAbilityImmunity } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
+ "export { canApplyEffectToTarget, hasEffectiveAbilityByInst } from './src/lib/game/defense';\n"
+ "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
+ "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const { isAbilityHolderEffective, isAbilityNullifiedBySticky, isAbilityNullifiedByPassive,
        hasEffectiveOppAbilityImmunity, canApplyEffectToTarget, applyAction } = mod;

// ── 卡池（live only）──────────────────────────────────────────────────────────
const DIR = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
assert.ok(pool.size > 3000, `卡池只讀到 ${pool.size} 張 — 掃描器壞了？`);

const findId = (name, pred) => { for (const [id, c] of pool) if (c.name === name && (!pred || pred(c))) return id; return null; };
const ab = n => c => (c.abilities ?? []).some(a => a.name === n);
const ID = {
  PIXY: findId('超級皮可西ex', ab('光之翼')),
  IRON: findId('鐵荊棘ex', ab('初始化')),
  MOON: findId('振翼髮', ab('暗夜羽擊')),
  SEA:  findId('海兔獸', ab('黏著束縛')),
  BOMB: findId('黑夜魔靈', ab('咒詛炸彈')),
  LAT:  findId('拉帝亞斯ex', ab('天空徑線')),
  CAVE: findId('傳說的熔岩洞'),
  TOWER: findId('火箭隊的監視塔'),
};
for (const [k, v] of Object.entries(ID)) assert.ok(v, `找不到卡：${k}`);

let seq = 0;
const I = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId, damage: 0, energyAttached: [], ...extra });
const mkState = (p0, p1, stadiumId) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  activeStadium: stadiumId ? { cardId: stadiumId, ownerIdx: 0 } : null,
  players: [
    { name: 'A', active: p0.active, bench: p0.bench ?? [], hand: [], deck: [], discard: [], prizes: ['a','b','c','d','e','f'] },
    { name: 'B', active: p1.active, bench: p1.bench ?? [], hand: [], deck: [], discard: [], prizes: ['a','b','c','d','e','f'] },
  ],
});
const C = id => pool.get(id);

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log('  ✅ ' + name); }
  catch (e) {
    // ⚠ 只吞 assert.AssertionError；其餘（TypeError/ReferenceError…）照丟，
    //   否則「程式壞掉」會被誤記成「一條斷言紅」。
    if (!(e instanceof assert.AssertionError)) throw e;
    fail++; console.log('  ❌ ' + name + '\n      ' + e.message);
  }
};

console.log('\n═══ v6.254 光之翼：不受對手寶可夢特性效果影響 ═══\n');

// ══ A. 卡面 / 官方裁定 逐字守衛 ══════════════════════════════════════════════
console.log('── A. 卡面與官方裁定 ──');
T('A1 超級皮可西ex 資料欄位與光之翼 effect 逐字', () => {
  const c = C(ID.PIXY);
  assert.equal(String(c.id), '18007');
  assert.equal(c.regulationMark, 'J');
  assert.equal(c.subtype, 'ex');
  assert.equal(c.stage, 'Stage1');
  assert.equal(c.pokemonType, 'Psychic');
  const a = c.abilities.find(x => x.name === '光之翼');
  assert.equal(a.effect, '這隻寶可夢不會受到對手的寶可夢特性效果的影響。');
});
T('A0 中央豁免述詞 hasEffectiveOppAbilityImmunity 有被 export（否則下面全是 TypeError）', () => {
  assert.equal(typeof hasEffectiveOppAbilityImmunity, 'function', 'v3001_g3_wave3 沒有 export 中央豁免述詞');
});
T('A2 官方 PTCG_RULES.md L2818 / L2733 逐字仍在（裁定來源沒被改掉）', () => {
  const p = join(ROOT, 'PTCG RULES', 'PTCG_RULES.md');
  if (!existsSync(p)) { console.log('      (PTCG RULES 未解出，跳過逐字比對但仍檢查卡面)'); return; }
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  assert.ok(lines.length > 2900, `規則檔只有 ${lines.length} 行 — 掃描器壞了？`);
  assert.ok(lines[2817].includes('特性「光之翼」會消除嗎') && lines[2818].includes('不會消除'),
    'L2818/L2819 不是預期的「光之翼會消除嗎／不會消除」');
  assert.ok(lines[2732].includes('特性「光之翼」會生效嗎') && lines[2733].includes('會生效'),
    'L2733/L2734 不是預期的「光之翼會生效嗎／會生效」');
});

// ══ B. 中央述詞：豁免生效（HEAD 必紅，各項各自紅）══════════════════════════
console.log('\n── B. 豁免生效（HEAD-FAIL 各項各自紅）──');
T('B1 對手戰鬥場鐵荊棘ex｜初始化 ⇒ 光之翼「不會消除」（官方 L2818）', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: pixy }, { active: I(ID.IRON) });
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'active', pool), true);
});
T('B2 光之翼在【備戰】、對手初始化在戰鬥場 ⇒ 仍不消除（初始化涵蓋雙方「場上」）', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: I(ID.LAT), bench: [pixy] }, { active: I(ID.IRON) });
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'bench', pool), true);
});
T('B3 對手戰鬥場振翼髮｜暗夜羽擊(passive) ⇒ 光之翼不消除', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: pixy }, { active: I(ID.MOON) });
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'active', pool), true);
});
T('B4 canApplyEffectToTarget(ability-effect) 在對手初始化下仍擋（免疫沒被連根拔掉）', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: I(ID.IRON) }, { active: pixy });
  const g = canApplyEffectToTarget(st, 0, pixy, C(ID.PIXY), 'ability-effect', pool, { isBench: false });
  assert.equal(g.blocked, true);
  assert.ok(String(g.reason).includes('光之翼'), '理由應提到光之翼：' + g.reason);
});
T('B5 isAbilityNullifiedByPassive（UI gate / USE_ABILITY dispatch）與中央閘同答案', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: pixy }, { active: I(ID.IRON) });
  assert.equal(isAbilityNullifiedByPassive(st, 0, pixy, C(ID.PIXY), '光之翼', 'active', pool), false);
});
T('B6 對手備戰海兔獸｜黏著束縛 ⇒ 【2階】光之翼持有者豁免（合成卡驗分支）', () => {
  // ⚠ 現行卡池沒有「2階 + 光之翼」的真卡（超級皮可西ex 是 Stage1）；
  //   這裡用合成卡只為驗證中央述詞的 own/opp 分支，不宣稱任何真卡行為。
  const p2 = new Map(pool);
  p2.set('SYN2', { id: 'SYN2', name: '合成2階光翼', supertype: 'Pokemon', stage: 'Stage2',
    evolvesFrom: '合成1階', abilities: [{ name: '光之翼', effect: '這隻寶可夢不會受到對手的寶可夢特性效果的影響。' }] });
  p2.set('SYN1', { id: 'SYN1', name: '合成1階', supertype: 'Pokemon', stage: 'Stage1', evolvesFrom: '合成基礎' });
  const syn = I('SYN2');
  const st = mkState({ active: I(ID.LAT), bench: [syn] }, { active: I(ID.LAT), bench: [I(ID.SEA)] });
  assert.equal(isAbilityNullifiedBySticky(st, syn, p2.get('SYN2'), true, p2, 0), false, '對手側海兔獸應被豁免');
  const st2 = mkState({ active: I(ID.LAT), bench: [syn, I(ID.SEA)] }, { active: I(ID.LAT) });
  assert.equal(isAbilityNullifiedBySticky(st2, syn, p2.get('SYN2'), true, p2, 0), true, '自己側海兔獸不該被豁免');
});

// ══ C. 正對照：豁免範圍不得溢出（行為必須與 BASE 完全相同）══════════════════
console.log('\n── C. 正對照：豁免不得溢出（與 BASE 相同）──');
T('C1 ⭐競技場卡【傳說的熔岩洞】⇒ 光之翼照樣被消除（不是寶可夢的特性）', () => {
  assert.equal(typeof hasEffectiveOppAbilityImmunity, 'function', '中央豁免述詞未 export');
  const pixy = I(ID.PIXY);
  const st = mkState({ active: pixy }, { active: I(ID.MOON) }, ID.CAVE);
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'active', pool), false);
  assert.equal(hasEffectiveOppAbilityImmunity(st, pixy, C(ID.PIXY), 'active', pool), false);
});
T('C2 ⭐熔岩洞在場 ⇒ canApplyEffectToTarget 不再免疫（v6.196 行為原封不動）', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: I(ID.IRON) }, { active: pixy }, ID.CAVE);
  assert.equal(canApplyEffectToTarget(st, 0, pixy, C(ID.PIXY), 'ability-effect', pool, { isBench: false }).blocked, false);
});
T('C3 ⭐競技場卡【火箭隊的監視塔】對【無】光之翼持有者照樣消除（合成卡驗分支）', () => {
  const p2 = new Map(pool);
  p2.set('SYNC', { id: 'SYNC', name: '合成無屬光翼', supertype: 'Pokemon', stage: 'Basic', pokemonType: 'Colorless',
    subtype: 'ex', abilities: [{ name: '光之翼', effect: '這隻寶可夢不會受到對手的寶可夢特性效果的影響。' }] });
  const syn = I('SYNC');
  const noTower = mkState({ active: syn }, { active: I(ID.IRON) });
  assert.equal(isAbilityHolderEffective(noTower, syn, p2.get('SYNC'), 0, '光之翼', 'active', p2), true, '無監視塔時應豁免初始化');
  const st = mkState({ active: syn }, { active: I(ID.IRON) }, ID.TOWER);
  assert.equal(isAbilityHolderEffective(st, syn, p2.get('SYNC'), 0, '光之翼', 'active', p2), false, '監視塔應消除');
});
T('C4 ⭐招式版暗夜羽擊（abilityNullifiedThisTurn）⇒ 光之翼被消除（招式不是特性）', () => {
  const pixy = I(ID.PIXY, { abilityNullifiedThisTurn: true });
  const st = mkState({ active: pixy }, { active: I(ID.SEA) });
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'active', pool), false);
});
T('C5 ⭐【自己這一側】的鐵荊棘ex｜初始化 ⇒ 照樣消除（卡面寫「對手的」）', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: I(ID.IRON), bench: [pixy] }, { active: I(ID.LAT) });
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'bench', pool), false);
});
T('C6 ⭐沒有光之翼的規則寶可夢（拉帝亞斯ex｜天空徑線）在對手初始化下仍被消除', () => {
  const lat = I(ID.LAT);
  const st = mkState({ active: lat }, { active: I(ID.IRON) });
  assert.equal(isAbilityHolderEffective(st, lat, C(ID.LAT), 0, '天空徑線', 'active', pool), false);
  assert.equal(isAbilityNullifiedByPassive(st, 0, lat, C(ID.LAT), '天空徑線', 'active', pool), true);
});
T('C7 ⭐沒有光之翼的卡在對手暗夜羽擊(passive)下仍被消除', () => {
  const lat = I(ID.LAT);
  const st = mkState({ active: lat }, { active: I(ID.MOON) });
  assert.equal(isAbilityHolderEffective(st, lat, C(ID.LAT), 0, '天空徑線', 'active', pool), false);
});
T('C8 hasEffectiveOppAbilityImmunity 對沒印光之翼的卡一律 false（否定型的正對照）', () => {
  assert.equal(typeof hasEffectiveOppAbilityImmunity, 'function', '中央豁免述詞未 export');
  const lat = I(ID.LAT);
  const st = mkState({ active: lat }, { active: I(ID.IRON) });
  assert.equal(hasEffectiveOppAbilityImmunity(st, lat, C(ID.LAT), 'active', pool), false);
  const pixy = I(ID.PIXY);
  const st2 = mkState({ active: pixy }, { active: I(ID.IRON) });
  assert.equal(hasEffectiveOppAbilityImmunity(st2, pixy, C(ID.PIXY), 'active', pool), true,
    '正對照：真的抓得到光之翼（否則 C8 是恆真安慰劑）');
});
T('C9 ⭐無任何消除源時 ⇒ 光之翼有效（與 BASE 相同）', () => {
  const pixy = I(ID.PIXY);
  const st = mkState({ active: pixy }, { active: I(ID.LAT) });
  assert.equal(isAbilityHolderEffective(st, pixy, C(ID.PIXY), 0, '光之翼', 'active', pool), true);
});
T('C10 ⭐熔岩洞在場 ⇒ isAbilityNullifiedByPassive 仍回報「被消除」（豁免自己先沒了）', () => {
  const pixy = I(ID.PIXY);
  const noCave = mkState({ active: pixy }, { active: I(ID.IRON) });
  assert.equal(isAbilityNullifiedByPassive(noCave, 0, pixy, C(ID.PIXY), '光之翼', 'active', pool), false,
    '正對照：無熔岩洞時應豁免（否則 C10 是恆真安慰劑）');
  const st = mkState({ active: pixy }, { active: I(ID.IRON) }, ID.CAVE);
  assert.equal(isAbilityNullifiedByPassive(st, 0, pixy, C(ID.PIXY), '光之翼', 'active', pool), true);
});
T('C11 ⭐監視塔在場對【無】光之翼持有者 ⇒ isAbilityNullifiedByPassive 仍回報「被消除」', () => {
  const p2 = new Map(pool);
  p2.set('SYNC2', { id: 'SYNC2', name: '合成無屬光翼2', supertype: 'Pokemon', stage: 'Basic', pokemonType: 'Colorless',
    subtype: 'ex', abilities: [{ name: '光之翼', effect: '這隻寶可夢不會受到對手的寶可夢特性效果的影響。' }] });
  const syn = I('SYNC2');
  const noTower = mkState({ active: syn }, { active: I(ID.IRON) });
  assert.equal(isAbilityNullifiedByPassive(noTower, 0, syn, p2.get('SYNC2'), '光之翼', 'active', p2), false,
    '正對照：無監視塔時應豁免');
  const st = mkState({ active: syn }, { active: I(ID.IRON) }, ID.TOWER);
  assert.equal(isAbilityNullifiedByPassive(st, 0, syn, p2.get('SYNC2'), '光之翼', 'active', p2), true);
});
T('C12 ⭐招式版暗夜羽擊旗標 ⇒ isAbilityNullifiedByPassive 仍回報「被消除」', () => {
  const clean = I(ID.PIXY);
  const stC = mkState({ active: clean }, { active: I(ID.IRON) });
  assert.equal(isAbilityNullifiedByPassive(stC, 0, clean, C(ID.PIXY), '光之翼', 'active', pool), false,
    '正對照：沒有旗標時應豁免');
  const flagged = I(ID.PIXY, { abilityNullifiedThisTurn: true });
  const st = mkState({ active: flagged }, { active: I(ID.IRON) });
  assert.equal(isAbilityNullifiedByPassive(st, 0, flagged, C(ID.PIXY), '光之翼', 'active', pool), true);
});

// ══ D. 行為端 E2E（官方 L2722/2723）══════════════════════════════════════════
console.log('\n── D. 行為端 E2E：黑夜魔靈｜咒詛炸彈 × 超級皮可西ex ──');
const runBomb = (targetId, opts = {}) => {
  seq = 0;
  const bomb = I(ID.BOMB), tgt = I(targetId);
  // opts.ownInit  = 攻擊方(p0)戰鬥場放鐵荊棘ex ⇒ 對「目標(p1)」而言是**對手的**初始化
  // opts.defInit  = 防守方(p1)戰鬥場放鐵荊棘ex、目標退到 p1 備戰 ⇒ 對目標而言是**自己這一側**的初始化
  const p0 = opts.ownInit ? { active: I(ID.IRON), bench: [bomb] } : { active: I(ID.LAT), bench: [bomb] };
  const p1 = opts.defInit ? { active: I(ID.IRON), bench: [tgt] } : { active: tgt };
  const st = mkState(p0, p1, opts.stadium);
  let s = applyAction(st, { type: 'USE_ABILITY', iid: bomb.iid, abilityIndex: 0, actorIdx: 0 }, pool);
  assert.ok(s.pendingSelection, '咒詛炸彈應開啟 picker');
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [tgt.iid], actorIdx: 0 }, pool);
  const find = st2 => st2.players[1].active?.iid === tgt.iid ? st2.players[1].active
    : st2.players[1].bench.find(b => b.iid === tgt.iid);
  return { s, tgt: find(s) };
};
T('D1 ⭐對手戰鬥場初始化在場 ⇒ 皮可西 0 傷害、黑夜魔靈仍昏厥（官方 L2722/2723）', () => {
  const { s, tgt } = runBomb(ID.PIXY, { ownInit: true });
  assert.equal(tgt.damage, 0, '皮可西不該吃到指示物');
  assert.equal(s.players[0].bench.length, 0, '黑夜魔靈應已昏厥離場');
  assert.ok(s.log.some(l => String(l.message).includes('光之翼')), 'log 應說明被光之翼擋下');
});
T('D2 ⭐正對照：目標換成拉帝亞斯ex（無光之翼）⇒ 照樣吃 130', () => {
  const { tgt } = runBomb(ID.LAT, { ownInit: true });
  assert.equal(tgt.damage, 130);
});
T('D3 ⭐正對照：沒有初始化時的皮可西 ⇒ 一樣 0 傷害（與 BASE 相同）', () => {
  const { tgt } = runBomb(ID.PIXY, {});
  assert.equal(tgt.damage, 0);
});
T('D4 ⭐正對照：初始化在【皮可西自己這一側】⇒ 光之翼被消除，吃滿 130（與 BASE 相同）', () => {
  // 卡面只豁免「**對手的**寶可夢特性」。這裡鐵荊棘ex 與皮可西同陣營 ⇒ 不豁免。
  const { s, tgt } = runBomb(ID.PIXY, { defInit: true });
  assert.equal(tgt.damage, 130);
  assert.ok(!s.log.some(l => String(l.message).includes('光之翼 免疫')), '不該出現光之翼擋下的 log');
});

// ══ E. 結構守衛（含正對照）══════════════════════════════════════════════════
console.log('\n── E. 結構守衛 ──');
const srcW3 = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
T('E1 三個「寶可夢特性」型消除源都必須接上 holder 脈絡（含偽造正對照）', () => {
  assert.ok(/isInitializeNullified\(state, holderCard, pool, holderInst, holderOwnerIdx, location\)/.test(srcW3),
    '初始化沒把 holder 脈絡傳進去');
  assert.ok(/isOppActiveAbilityNullifiedByMoonsenne\(state, holderOwnerIdx, holderCard, abilityName, pool, holderInst\)/.test(srcW3),
    '暗夜羽擊(passive) 沒把 holderInst 傳進去');
  assert.ok(/isAbilityNullifiedBySticky\(state, holderInst, holderCard, true, pool, holderOwnerIdx\)/.test(srcW3),
    '黏著束縛沒把 holderOwnerIdx 傳進去');
  const fake = 'if (isInitializeNullified(state, holderCard, pool)) return false;';
  assert.ok(!/isInitializeNullified\(state, holderCard, pool, holderInst, holderOwnerIdx, location\)/.test(fake),
    'E1 樣式恆真＝安慰劑');
});
T('E2 豁免名單每一項都必須在 live H/I/J 卡池找得到、且卡面逐字含「不會受到對手」＋「特性」', () => {
  const m = srcW3.match(/OPP_ABILITY_EFFECT_IMMUNE_ABILITIES[^=]*=\s*new Set<string>\(\[([^\]]*)\]\)/);
  assert.ok(m, '找不到豁免名單常數（掃描器壞了？）');
  const names = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(names.length >= 1, '豁免名單是空的？');
  for (const n of names) {
    let hit = null;
    for (const c of pool.values()) {
      if (!'HIJ'.includes(c.regulationMark ?? '')) continue;
      const a = (c.abilities ?? []).find(x => x.name === n);
      if (a) { hit = a; break; }
    }
    assert.ok(hit, `豁免名單的「${n}」在 live H/I/J 卡池找不到`);
    assert.ok(hit.effect.includes('不會受到對手') && hit.effect.includes('特性'),
      `「${n}」卡面不符合豁免語意：${hit.effect}`);
  }
});
T('E3 ⭐豁免述詞本身不得把競技場卡算進去（原始碼＋行為雙重）', () => {
  const m = srcW3.match(/export function hasEffectiveOppAbilityImmunity\([\s\S]*?\n}/);
  assert.ok(m && m[0].length < 2000, 'anchor 可能失效');
  assert.ok(/isNullifiedByRocketWatchtower/.test(m[0]) && /isNullifiedByLegendCave/.test(m[0]),
    '豁免述詞沒有把兩張競技場卡當成「會消除掉豁免本身」的來源');
  assert.ok(/abilityNullifiedThisTurn/.test(m[0]), '豁免述詞沒有排除招式版暗夜羽擊');
  assert.ok(!/isAbilityHolderEffective/.test(m[0]), '豁免述詞不可回頭呼叫中央閘（會造成遞迴）');
});

console.log(`\n═══ v6.254 光之翼：${pass} passed, ${fail} failed ═══\n`);
if (fail > 0) process.exit(1);
