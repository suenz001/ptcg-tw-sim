// v6.415 守衛：傷害免疫的判準**收斂成一份**（IRON_RULES Rule 38），並修掉備戰不擲幣的真 bug。
//
// 【卡面】逐字：
//   ・奇諾栗鼠ex｜順滑大衣：「**這隻寶可夢**受到招式的傷害時，自己擲1次硬幣。
//     若為正面，則這隻寶可夢不會受到那個傷害。」
//   ・吉雉雞｜腎上腺費洛蒙：「若這隻寶可夢身上附有【惡】能量卡，則這隻寶可夢受到招式的
//     傷害時，自己擲1次硬幣。若為正面，則這隻寶可夢不會受到那個傷害。」
//   ⚠⚠ 兩張都**沒有**「在戰鬥場」⇒ **備戰也適用**。
//
// 【真 bug】`dealAttackDamageToTarget` 原本只在 `isActive` 時補 `passiveImmunityDamageBlock`
//   ＋ `passiveCoinImmunity` ⇒ **備戰目標完全不擲幣**。
//   實測（甲賀忍蛙ex｜分身連打 120 打備戰的奇諾栗鼠ex，40 次）：修正前免疫 0 次、擲幣 0 次。
//   而同樣打備戰的 `hitBenchAll`／`bench-hit-N`／`snipe-60-ex` **有**擲幣段
//   ⇒ 典型的「判準多份、其中一份漏掉一層」。
//
// 【收斂】四條備戰路徑＋戰鬥位路徑全部改走中央閘 `resolveMultiTargetDamageGuard`
//   （四層：中立中心 → PASSIVE_IMMUNITY → canApplyEffectToTarget → 擲幣型免疫）。
//   死碼 `manualDamageImmunity`（同樣四層的第二份、全 src 零呼叫端）一併刪除。
//
// 【HEAD-FAIL】BASE（v6.414）上 B2／B3／B4／C1／C2／C3 紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x415-s.js'), E = join(ROOT, '.x415-e.ts'), O = join(ROOT, '.x415-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const { applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) cards.push(c);
  }
}
const byAtk = (n, a) => cards.find((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
const byAb = (n) => cards.find((c) => (c.abilities || []).some((x) => x.name === n));
const NINJA = byAtk('甲賀忍蛙ex', '分身連打');   // clone-strike → dealAttackDamageToTarget
const ARTIC = byAtk('急凍鳥', '冰雹');            // hitBenchAll
const STARMIE = byAtk('超級寶石海星ex', '噴射打擊'); // bench-hit-N
const CHILLET = byAb('順滑大衣');                 // 奇諾栗鼠ex（擲幣型免疫，卡面無「在戰鬥場」）
const PHEROMOSA = byAb('腎上腺費洛蒙');           // 吉雉雞（需附【惡】能量）
assert.ok(NINJA && ARTIC && STARMIE && CHILLET,
  `測試用卡沒挑齊：NINJA=${!!NINJA} ARTIC=${!!ARTIC} STARMIE=${!!STARMIE} 順滑大衣=${!!CHILLET}`);
const TARGET = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 300
  && !(c.abilities || []).length && !c.name.includes('超級') && !c.weakness
  && !(c.tags || []).some((t) => /太晶/.test(String(t))));
assert.ok(TARGET, '找不到「無弱點、非太晶、無特性」的高 HP 靶');

let n = 0, pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const en = (t = 'Colorless') => {
  const e = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
    && (c.energyType === t || (c.name || '').includes(KANJI[t] || '草')))
    || cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  return { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] };
};

/**
 * 跑一次攻擊。`holder` 指定擲幣免疫特性的持有者放在哪（'active' | 'bench' | null）。
 * 回傳目標吃到的傷害（免疫時為 0）。
 */
function fire(atkCard, atkName, opts = {}) {
  const aIdx = opts.aIdx ?? 0, dIdx = (1 - aIdx);
  const ai = (atkCard.attacks || []).findIndex((x) => x.name === atkName);
  assert.ok(ai >= 0, '找不到招式 ' + atkName);
  const es = (atkCard.attacks[ai].cost || []).map((t) => en(t));
  for (let k = 0; k < 4; k++) es.push(en('Colorless'));
  const a = inst(atkCard.id, es);
  const holderEnergy = opts.holderEnergy ? [en(opts.holderEnergy)] : [];
  const holderInst = opts.holderCardId ? inst(opts.holderCardId, holderEnergy) : null;
  const defActive = opts.holderAt === 'active' && holderInst ? holderInst : inst(TARGET.id);
  const defBench = opts.holderAt === 'bench' && holderInst ? [holderInst, inst(TARGET.id)] : [inst(TARGET.id), inst(TARGET.id)];
  const PA = { name: 'PA', active: a, bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [] };
  const PD = { name: 'PD', active: defActive, bench: defBench, hand: [], deck: [inst(TARGET.id)], discard: [], prizes: [] };
  const players = aIdx === 0 ? [PA, PD] : [PD, PA];
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: aIdx, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players,
  };
  const act = (x) => { const o = applyAction(st, x, pool); st = o?.state ?? o; };
  act({ type: 'ATTACK', attackIndex: ai });
  let r = 0;
  while (st.pendingSelection && r++ < 8) {
    const ps = st.pendingSelection;
    const V = ps.params?.validIids || ps.validIids || [];
    const prefer = opts.holderAt === 'bench'
      ? [st.players[dIdx].bench[0]?.iid, st.players[dIdx].active?.iid]
      : [st.players[dIdx].active?.iid, st.players[dIdx].bench[0]?.iid];
    const pick = (ps.type === 'opp-poke-choose' || ps.type === 'opp-bench-choose')
      ? prefer.filter(Boolean).slice(0, ps.maxCount ?? 1)
      : (V.length ? V.slice(0, ps.maxCount ?? 1) : prefer.filter(Boolean).slice(0, ps.maxCount ?? 1));
    act({ type: 'RESOLVE_SELECTION', selectedIids: pick });
  }
  // ⚠⚠ **必須用 iid 追蹤**，不能用位置：持有者被 KO 之後 `bench[0]` 會變成**別的**寶可夢
  //   （它沒被打 ⇒ damage 0 ⇒ 誤判成「免疫」）。實測踩過：吉雉雞 HP 120 被 120 打死、
  //   奇諾栗鼠ex 在戰鬥位吃弱點 ×2 = 240 = HP 也死 ⇒ 兩條都量成「40 次全免疫」。
  const holderIid = holderInst?.iid ?? null;
  const dp = st.players[dIdx];
  const found = holderIid
    ? (dp.active?.iid === holderIid ? dp.active : dp.bench.find((x) => x.iid === holderIid))
    : (opts.holderAt === 'bench' ? dp.bench[0] : dp.active);
  const logs = (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));
  // immune ＝ 還在場上且一點傷害都沒吃到；hit ＝ 吃到傷害，或已經被擊倒離場。
  const immune = !!found && (found.damage ?? 0) === 0;
  const hit = !found || (found.damage ?? 0) > 0;
  return { immune, hit, dmg: found?.damage ?? null, koed: !found, logs };
}

/** 跑 N 次，回傳「傷害為 0（＝被免疫）」的次數與「有吃到傷害」的次數。 */
function sample(times, fn) {
  let immune = 0, hit = 0;
  for (let i = 0; i < times; i++) {
    const r = fn();
    if (r.immune) immune++;
    if (r.hit) hit++;
  }
  return { immune, hit };
}
const N = 40;

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：擲幣型免疫在**備戰**也要生效
//   ⚠ 擲幣是隨機的 ⇒ 用 40 次取樣。p=0.5 時「40 次一次都沒免疫」的機率是 2^-40，
//     所以「immune >= 1 且 hit >= 1」不會 flaky，而且兩邊都要求 ⇒ 不會被「永遠免疫」
//     這種反向壞法蒙混過去。
// ══════════════════════════════════════════════════════════════════════════════
T('B0.【正對照】沒有擲幣特性時，備戰靶必定吃滿傷害（否則下面是空真）', () => {
  const r = sample(12, () => fire(NINJA, '分身連打', { holderAt: 'bench', holderCardId: TARGET.id }));
  assert.strictEqual(r.immune, 0, `無特性的備戰靶竟然被免疫 ${r.immune} 次`);
  assert.strictEqual(r.hit, 12, `無特性的備戰靶沒有吃滿（hit=${r.hit}）`);
  // ⚠ 這一條同時證明「用 iid 追蹤」是對的：靶是高 HP 的 TARGET，不會被 KO 干擾。
});
T('B1.【正對照】奇諾栗鼠ex 在**戰鬥位**：擲幣免疫本來就有（v6.415 不得改壞）', () => {
  const r = sample(N, () => fire(NINJA, '分身連打', { holderAt: 'active', holderCardId: CHILLET.id }));
  assert.ok(r.immune >= 1 && r.hit >= 1, `戰鬥位擲幣不像隨機：免疫 ${r.immune}／受傷 ${r.hit}`);
});
T('B2. ⭐⭐⭐ 奇諾栗鼠ex 在**備戰**：也要擲幣免疫（HEAD-FAIL：BASE 上 40 次全部照吃）', () => {
  const r = sample(N, () => fire(NINJA, '分身連打', { holderAt: 'bench', holderCardId: CHILLET.id }));
  assert.ok(r.immune >= 1, `備戰完全沒有免疫過（免疫 ${r.immune}／受傷 ${r.hit}）——`
    + '卡面「這隻寶可夢受到招式的傷害時」沒有「在戰鬥場」，備戰也適用');
  assert.ok(r.hit >= 1, `備戰變成永遠免疫（免疫 ${r.immune}／受傷 ${r.hit}）—— 反向壞掉了`);
});
T('B3. ⭐⭐ 鏡像：aIdx=1 也必須成立（守衛只測 aIdx=0 是真退化）', () => {
  const r = sample(N, () => fire(NINJA, '分身連打', { aIdx: 1, holderAt: 'bench', holderCardId: CHILLET.id }));
  assert.ok(r.immune >= 1 && r.hit >= 1, `鏡像不成立：免疫 ${r.immune}／受傷 ${r.hit}`);
});
// ⚠ 誠實標記：B4／B5 在 BASE 上**也是綠的** —— 腎上腺費洛蒙走的是 `PASSIVE_COIN_AVOID`
//   （`applyDefenderCoinAvoid`），與順滑大衣的 `PASSIVE_IMMUNITY` 擲幣型是**兩張不同的表**，
//   本版沒有動到它。留這兩條是零回歸：收斂之後它必須照舊生效、前提條件也不能失效。
T('B4.【零回歸】吉雉雞｜腎上腺費洛蒙 在備戰＋附【惡】能量：擲幣免疫照舊生效', () => {
  if (!PHEROMOSA) { assert.ok(false, '找不到腎上腺費洛蒙的持有者（卡池變了？）'); return; }
  const r = sample(N, () => fire(NINJA, '分身連打', {
    holderAt: 'bench', holderCardId: PHEROMOSA.id, holderEnergy: 'Darkness',
  }));
  assert.ok(r.immune >= 1 && r.hit >= 1, `備戰不擲幣：免疫 ${r.immune}／受傷 ${r.hit}`);
});
T('B5.【負對照】腎上腺費洛蒙**沒有**附【惡】能量時不得免疫（卡面前提條件）', () => {
  if (!PHEROMOSA) { assert.ok(false, '找不到腎上腺費洛蒙的持有者'); return; }
  const r = sample(12, () => fire(NINJA, '分身連打', { holderAt: 'bench', holderCardId: PHEROMOSA.id }));
  assert.strictEqual(r.immune, 0, `沒附【惡】能量卻免疫了 ${r.immune} 次 —— 前提條件失效`);
});
T('B6.【零回歸】hitBenchAll（急凍鳥｜冰雹）路徑的備戰擲幣仍然正常', () => {
  const r = sample(N, () => fire(ARTIC, '冰雹', { holderAt: 'bench', holderCardId: CHILLET.id }));
  assert.ok(r.immune >= 1 && r.hit >= 1, `hitBenchAll 擲幣壞了：免疫 ${r.immune}／受傷 ${r.hit}`);
});
T('B7.【零回歸】bench-hit-N（超級寶石海星ex｜噴射打擊）路徑的備戰擲幣仍然正常', () => {
  const r = sample(N, () => fire(STARMIE, '噴射打擊', { holderAt: 'bench', holderCardId: CHILLET.id }));
  assert.ok(r.immune >= 1 && r.hit >= 1, `bench-hit-N 擲幣壞了：免疫 ${r.immune}／受傷 ${r.hit}`);
});
T('B8. ⭐⭐ 不得重複擲幣：同一次攻擊對同一隻只擲一次', () => {
  // ⚠ 擲兩次的話「免疫率」會從 1/2 變成 3/4（任一次正面就免疫）。
  //   用 200 次取樣，1/2 與 3/4 的區分在統計上非常穩（3σ 界線約 0.606）。
  const r = sample(200, () => fire(ARTIC, '冰雹', { holderAt: 'bench', holderCardId: CHILLET.id }));
  const rate = r.immune / (r.immune + r.hit);
  assert.ok(rate < 0.62,
    `免疫率 ${rate.toFixed(3)} 明顯高於 1/2 ⇒ 防守方被多擲了一次幣（免疫 ${r.immune}／受傷 ${r.hit}）`);
  assert.ok(rate > 0.38, `免疫率 ${rate.toFixed(3)} 明顯低於 1/2 ⇒ 擲幣層被跳過了`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】靜態（Rule 38：判準只能有一份）
// ══════════════════════════════════════════════════════════════════════════════
const EFF = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')), 'effects.ts');
const blockOf = (anchor, len = 7000) => {
  const i = EFF.indexOf(anchor);
  assert.ok(i >= 0, 'anchor 失效：' + anchor);
  return EFF.slice(i, i + len);
};
T('C1. ⭐⭐⭐ `passiveCoinImmunity` 全站**恰好一個**呼叫點（中央閘）', () => {
  const calls = (EFF.match(/passiveCoinImmunity\(/g) || []).length;
  // 定義本身也會命中一次 ⇒ 定義 1 + 呼叫 1 = 2
  assert.strictEqual(calls, 2,
    `passiveCoinImmunity 出現 ${calls} 次（應為「定義 1 ＋ 中央閘呼叫 1」）—— 又有人自己擲幣了`);
  const g = blockOf('export function resolveMultiTargetDamageGuard', 3000);
  assert.ok(/passiveCoinImmunity\(/.test(g), '中央閘裡沒有擲幣層 ⇒ 那唯一的呼叫點跑到別的地方了');
});
T('C2. ⭐⭐⭐ `dealAttackDamageToTarget` 走中央閘（不是只用 canApplyEffectToTarget）', () => {
  const b = blockOf('export function dealAttackDamageToTarget(', 3000);
  assert.ok(/resolveMultiTargetDamageGuard\(/.test(b),
    '沒有走中央閘 ⇒ 備戰目標又會漏掉擲幣與條件式完全免疫');
  assert.ok(!/isActive && kind === 'attack-damage'\)\s*\{\s*const _pb = passiveImmunityDamageBlock/.test(b),
    'active 專屬的第二份免疫段又回來了（判準兩份）');
});
T('C3. ⭐⭐ 四條備戰傷害路徑都走中央閘，且都不得自己擲幣', () => {
  for (const [nm, anchor] of [
    ['hitBenchAll', 'function hitBenchAll'],
    ['bench-hit-N', "regR('bench-hit-N'"],
    ['snipe-60-ex', "regR('snipe-60-ex'"],
  ]) {
    const b = blockOf(anchor, 8000);
    assert.ok(/resolveMultiTargetDamageGuard\(/.test(b), `${nm} 沒有走中央閘`);
    assert.ok(!/passiveCoinImmunity\(/.test(b), `${nm} 還自己擲幣（判準兩份）`);
    assert.ok(!/skipCoin:\s*true/.test(b), `${nm} 傳了 skipCoin ⇒ 那條路徑的備戰又不擲幣了`);
  }
});
T('C4. ⭐ 死碼 `manualDamageImmunity`（同樣四層的第二份）必須已刪除', () => {
  assert.ok(!/function manualDamageImmunity/.test(EFF), 'manualDamageImmunity 還在 ⇒ 第二份判準');
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/m5_preview.ts'), 'utf8');
  assert.ok(!/manualDamageImmunity/.test(src), 'm5_preview.ts 還 import 著它（TS2304 會紅）');
});
T('C5. ⭐ 自傷分流必須保留：中央閘是「對手側」語意', () => {
  const b = blockOf('function hitBenchAll', 8000);
  assert.ok(/attackerIdx !== targetIdx/.test(b),
    'hitBenchAll 的自傷分流不見了 —— 地震／燃燒熱浪會被自己的盾牌擋住');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】反安慰劑自檢
// ══════════════════════════════════════════════════════════════════════════════
T('D1. C1 的計數判準抓得到「多一個擲幣呼叫」的違規樣本', () => {
  // ⚠ 用**固定樣本**而不是 `EFF + 一行`：後者的期望值會跟著實際檔案的呼叫數漂移，
  //   在 BASE 上會以誤導的理由翻紅（安慰劑型態 9 的親戚）。
  const sample = 'export function passiveCoinImmunity() {}\nconst a = passiveCoinImmunity(s);\n';
  assert.strictEqual((sample.match(/passiveCoinImmunity\(/g) || []).length, 2, 'C1 的計數器壞了（合法樣本）');
  const bad = sample + 'const b = passiveCoinImmunity(s);\n';
  assert.strictEqual((bad.match(/passiveCoinImmunity\(/g) || []).length, 3, 'C1 的計數器抓不到多出來的呼叫');
});
T('D2. B 段的取樣判準抓得到「永遠免疫」與「永遠不免疫」兩種壞法', () => {
  const allImmune = { immune: 40, hit: 0 };
  const neverImmune = { immune: 0, hit: 40 };
  assert.ok(!(allImmune.immune >= 1 && allImmune.hit >= 1), '「永遠免疫」竟然通過 B2 的判準');
  assert.ok(!(neverImmune.immune >= 1 && neverImmune.hit >= 1), '「永遠不免疫」竟然通過 B2 的判準');
});

console.log(`\n=== v6.415 備戰擲幣免疫／免疫判準收斂：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
