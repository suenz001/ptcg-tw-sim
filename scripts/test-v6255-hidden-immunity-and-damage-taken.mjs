/**
 * v6.255 守衛（三件事，各自都要能單獨紅）：
 *
 *  A/B. 【化隱】一起豁免「對手的寶可夢特性」型特性消除（站長裁定 2026-08-28 逐字：「一起豁免」）
 *       卡面（static/cards/M5.json 逐字，4 張印刷、全部 J 標）：
 *         斯魔茶 19149 / 來悲粗茶 19150 / 怨影娃娃 19175 / 詛咒娃娃 19176
 *         特性「化隱」：「這隻寶可夢不會受到對手的招式與特性的效果的影響。」
 *       ⚠⚠ 官方 `PTCG RULES/PTCG_RULES.md` 對「化隱 × 特性消除」**零裁定**
 *          （已全文逐字搜尋），本條是**站長裁定**、依卡面字面推論，日後可翻案。
 *       範圍逐字限定：競技場卡（監視塔／熔岩洞）與招式旗標**不**豁免（正對照在 B4/B6）。
 *
 *  C.   【damageTakenLastOppTurn】防 KO 時改記「實際扣到的」（站長裁定逐字：「改成實際扣到的」）
 *       官方 L1933-1934：激動競技場在場、請假王ex 對滿血皮卡丘ex 使出「偉大橫掃」，
 *       因「勤奮之心」以剩餘 HP 10 留在場上時，皮卡丘ex 身上放置的傷害指示物為「22 個」
 *       ＝ 有效 HP−10，不是招式的全額傷害。
 *       唯一讀取點：超級赫拉克羅斯ex｜重裝角擊（M2 14322/18578，I 標）
 *       卡面：「增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。」
 *
 *  D.   【defense.ts 零行為差異收斂】canApplyEffectToTarget step1/1b 原本只用 `1 - actorIdx`
 *       推 target 持有者，沒驗證 target 真的在對面。卡面寫「**對手的**…」⇒ 補 isInstOnSide。
 *       ⚠ 這不是修現存 bug：對 BASE fa30fb59 插探針跑完整 575 支 npm test，
 *         沒有任何一次「target 在 actorIdx 自己這一側且印著光之翼／化隱」。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.v6255-e.ts'), O = join(ROOT, '.v6255-o.mjs'), S = join(ROOT, '.v6255-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction, getUsableAbilities } from './src/lib/game/engine';
export { isAbilityHolderEffective, hasEffectiveOppAbilityImmunity, isAbilityNullifiedByPassive } from './src/lib/game/effects/cards/v3001_g3_wave3';
export { canApplyEffectToTarget } from './src/lib/game/defense';
export { canApplyAttackEffectToTarget } from './src/lib/game/effects';
export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';
import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, isAbilityHolderEffective, hasEffectiveOppAbilityImmunity, isAbilityNullifiedByPassive,
        canApplyEffectToTarget, canApplyAttackEffectToTarget, ATTACK_POST, ATTACK_PRE } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const liveCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark)) liveCards.push(c);
  }
}

const ID = {
  HID: ['19149', '19150', '19175', '19176'],  // 斯魔茶／來悲粗茶／怨影娃娃／詛咒娃娃（化隱）
  SHINE: '18007',   // 超級皮可西ex（光之翼）
  MOON: '11597',    // 振翼髮（暗夜羽擊 passive）
  PLAIN: '16782',   // 拉帝亞斯（Basic・無特性）
  UBO: '17976',     // 帕底亞 烏波（HP60・無特性 Basic）
  CAVE: '19623',    // 傳說的熔岩洞（進化寶可夢特性全消）
  WATCH: '14849',   // 火箭隊的監視塔（【無】寶可夢特性全消）
  CRAB: '13741',    // 岩殿居蟹（結實・HP150・Stage1）
  PIKA: '14704',    // 皮卡丘ex（勤奮之心・HP200・要求滿血）
  HAWL: '14754',    // 超級摔角鷹人ex（堅忍之軀・擲幣・HP250・不要求滿血）
  SURV: '10306',    // 倖存鍛鍊器
  DIALGA: '11072',  // 帝牙盧卡（光炮尾 160＝attacks[1]）
  MLATI: '14069',   // 超級拉帝亞斯ex（幻想脈衝 300＝attacks[1]）
  HERA: '14322',    // 超級赫拉克羅斯ex（重裝角擊＝attacks[0]・HP280）
  eGrass: '14102', eP: '14103', eFire: '14428', eMetal: '14434', eLight: '18520',
};

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: Array.from({ length: 12 }, () => en(ID.eP)), discard: [],
  prizes: Array.from({ length: 6 }, () => en(ID.eP)) });
const mkS = (p0, p1, stadium = null) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 5,
  isFirstTurn: false, firstPlayerIdx: 0, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], log: [], pendingSelection: null,
  activeStadium: stadium ? inst(stadium) : null, players: [p0, p1] });

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS', n); pass++; } catch (e) {
  if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else { throw e; } } };

const HID_TEXT = '這隻寶可夢不會受到對手的招式與特性的效果的影響。';
const SHINE_TEXT = '這隻寶可夢不會受到對手的寶可夢特性效果的影響。';

// ══════════════════════════════════════════════════════════════════════
console.log('A. 卡面枚舉（含掃描器下限斷言與正對照）');

const scanAbility = (cards, pred) => {
  const out = [];
  for (const c of cards) for (const ab of (c.abilities ?? [])) if (pred(ab, c)) out.push({ c, ab });
  return out;
};

T('A1 ⭐化隱：live H/I/J 恰好 4 張印刷，四張 effect 逐字相同', () => {
  const hits = scanAbility(liveCards, ab => ab.name === '化隱');
  assert.equal(hits.length, 4, `化隱印刷張數應為 4，實得 ${hits.length}（${hits.map(h => h.c.id).join(',')}）`);
  assert.deepEqual(hits.map(h => String(h.c.id)).sort(), ['19149', '19150', '19175', '19176']);
  for (const h of hits) {
    assert.equal(h.ab.effect, HID_TEXT, `${h.c.name}(${h.c.id}) 化隱卡面文字變了`);
    assert.equal(h.c.regulationMark, 'J', `${h.c.id} 應為 J 標`);
  }
});

T('A2 光之翼：卡面文字沒變（v6.254 前提）', () => {
  const hits = scanAbility(liveCards, ab => ab.name === '光之翼');
  assert.ok(hits.length >= 1, `光之翼掃不到＝掃描器壞了（實得 ${hits.length}）`);
  for (const h of hits) assert.equal(h.ab.effect, SHINE_TEXT, `${h.c.id} 光之翼卡面文字變了`);
});

T('A3 掃描器下限＋正對照：「不會受到…特性…」的特性只有這兩支符合豁免措辭', () => {
  // 掃描條件：特性 effect 同時含「不會受到」與「特性」；下限斷言避免掃描器靜默壞掉。
  const wide = scanAbility(liveCards, ab => {
    const e = (ab.effect ?? '').replace(/[​-‍﻿]/g, '');
    return e.includes('不會受到') && e.includes('特性');
  });
  assert.ok(wide.length >= 10, `掃描器下限：應 ≥10 筆，實得 ${wide.length}`);
  const names = new Set(wide.map(w => w.ab.name));
  assert.deepEqual([...names].sort(), ['光之翼', '化隱', '礎石之勢'].sort(),
    `符合寬鬆措辭的特性名單變了：${[...names].join('/')}`);
  // 正對照：礎石之勢卡面主詞是「招式的傷害」不是「特性的效果」⇒ 不得進豁免名單
  const kiseki = wide.find(w => w.ab.name === '礎石之勢');
  assert.ok(kiseki.ab.effect.includes('招式的傷害'), '礎石之勢卡面措辭變了');
  assert.ok(!kiseki.ab.effect.includes('特性的效果'), '礎石之勢不該寫「特性的效果」');
});

T('A4 lint：豁免名單原始碼逐字含「光之翼」與「化隱」（＋抓得到的正對照）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
  const RE = /const OPP_ABILITY_EFFECT_IMMUNE_ABILITIES[^=]*=\s*new Set<string>\(\[([^\]]*)\]\)/;
  const m = RE.exec(src);
  assert.ok(m, '找不到 OPP_ABILITY_EFFECT_IMMUNE_ABILITIES 宣告（anchor 失效）');
  assert.ok(m[1].includes("'光之翼'"), '名單漏了光之翼');
  assert.ok(m[1].includes("'化隱'"), '名單漏了化隱（v6.255 站長裁定「一起豁免」）');
  // 正對照：樣式在缺項樣本上真的會抓不到
  const fake = "const OPP_ABILITY_EFFECT_IMMUNE_ABILITIES: ReadonlySet<string> = new Set<string>(['光之翼']);";
  assert.ok(!RE.exec(fake)[1].includes("'化隱'"), 'A4 樣式恆真＝安慰劑');
});

// ══════════════════════════════════════════════════════════════════════
console.log('B. 化隱 × 特性消除源（豁免範圍逐字限定）');

const sceneMoonVsHidden = (hid, stadium = null) =>
  mkS(mkP('P0', inst(ID.MOON)), mkP('P1', inst(hid)), stadium);

for (const hid of ID.HID) {
  const nm = pool.get(hid).name;
  T(`B1 ⭐⭐⭐${nm}(${hid})：對手戰鬥場振翼髮｜暗夜羽擊 不再消除化隱`, () => {
    const s = sceneMoonVsHidden(hid);
    assert.equal(isAbilityHolderEffective(s, s.players[1].active, pool.get(hid), 1, '化隱', 'active', pool),
      true, '化隱應豁免「對手的寶可夢特性」型消除（v6.255 站長裁定）');
  });
  T(`B2 ⭐⭐${nm}：暗夜羽擊在場時，化隱仍擋 attack-effect 與 ability-effect`, () => {
    const s = sceneMoonVsHidden(hid);
    const t = s.players[1].active, tc = pool.get(hid);
    assert.equal(canApplyEffectToTarget(s, 0, t, tc, 'attack-effect', pool, { isBench: false }).blocked, true);
    assert.equal(canApplyEffectToTarget(s, 0, t, tc, 'ability-effect', pool, { isBench: false }).blocked, true);
    // legacy helper（effects.ts canApplyAttackEffectToTarget）走同一支中央述詞 ⇒ 必須同答案
    assert.equal(canApplyAttackEffectToTarget(s, 0, t, tc, pool).blocked, true,
      'legacy helper 與 unified 分歧＝出現了平行實作');
  });
}

T('B3 ⭐行為端：暗夜羽擊在場時，對手招式的狀態效果仍被化隱擋（完整 ATTACK 流程）', () => {
  // P0 振翼髮｜飛來橫禍：「將2個傷害指示物以任意方式放置於對手的備戰寶可夢身上。」
  //   → 備戰全是化隱 ⇒ 沒有合法目標，不得開 picker、不得放指示物。
  const s = mkS(mkP('P0', inst(ID.MOON, [en(ID.eP)])),
                mkP('P1', inst(ID.PLAIN), [inst(ID.HID[0]), inst(ID.HID[2])]));
  const r = applyAction(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  for (const b of r.players[1].bench) {
    assert.equal(b.damage, 0, `化隱備戰不該被放指示物（${pool.get(b.cardId).name} damage=${b.damage}）`);
  }
});

T('B4 ⭐正對照（不得過度修）：競技場卡【傳說的熔岩洞】仍消除進化型化隱', () => {
  for (const hid of ['19150', '19176']) {   // 來悲粗茶／詛咒娃娃 = Stage1 進化
    const s = sceneMoonVsHidden(hid, ID.CAVE);
    assert.equal(isAbilityHolderEffective(s, s.players[1].active, pool.get(hid), 1, '化隱', 'active', pool),
      false, `${pool.get(hid).name} 是進化寶可夢，熔岩洞應消除（競技場卡不豁免）`);
    assert.equal(canApplyEffectToTarget(s, 0, s.players[1].active, pool.get(hid), 'attack-effect', pool,
      { isBench: false }).blocked, false, '化隱失效 ⇒ 招式效果打得到');
  }
  for (const hid of ['19149', '19175']) {   // 斯魔茶／怨影娃娃 = Basic，熔岩洞打不到
    const s = sceneMoonVsHidden(hid, ID.CAVE);
    assert.equal(isAbilityHolderEffective(s, s.players[1].active, pool.get(hid), 1, '化隱', 'active', pool), true);
  }
});

T('B5 ⭐正對照：v6.254 四條不得回歸（光之翼 × 兩張競技場卡 / 招式旗標 / 自己這一側）', () => {
  const shine = pool.get(ID.SHINE);
  const mk = (stadium, flag) => mkS(mkP('P0', inst(ID.MOON)),
    mkP('P1', inst(ID.SHINE, [], flag ? { abilityNullifiedThisTurn: true } : {})), stadium);
  assert.equal(isAbilityHolderEffective(mk(null, false), mk(null, false).players[1].active, shine, 1, '光之翼', 'active', pool),
    true, '光之翼應豁免暗夜羽擊');
  // 超級皮可西ex 是【超】屬性 Stage1 ⇒【傳說的熔岩洞】(進化全消) 打得到；
  // 【火箭隊的監視塔】只消除【無】寶可夢，對它天生無效（v6.254 用合成卡驗那一支，本檔不重複）。
  {
    const s = mk(ID.CAVE, false);
    assert.equal(isAbilityHolderEffective(s, s.players[1].active, shine, 1, '光之翼', 'active', pool),
      false, '競技場卡【傳說的熔岩洞】仍應消除光之翼');
  }
  const sf = mk(null, true);
  assert.equal(isAbilityHolderEffective(sf, sf.players[1].active, shine, 1, '光之翼', 'active', pool),
    false, '招式版暗夜羽擊（abilityNullifiedThisTurn）仍應消除光之翼');
});

T('B6 ⭐正對照：招式旗標 abilityNullifiedThisTurn 仍消除化隱（招式那半不在評估點豁免）', () => {
  for (const hid of ID.HID) {
    const s = mkS(mkP('P0', inst(ID.PLAIN)), mkP('P1', inst(hid, [], { abilityNullifiedThisTurn: true })));
    assert.equal(isAbilityHolderEffective(s, s.players[1].active, pool.get(hid), 1, '化隱', 'active', pool),
      false, `${pool.get(hid).name}：招式旗標仍應消除化隱（見 hasEffectiveOppAbilityImmunity JSDoc）`);
  }
});

T('B7 ⭐⭐⭐招式那半是靠**施加點**擋的：招式版特性消除對有效化隱寫不上旗標', () => {
  const post = ATTACK_POST.get('振翼髮|暗夜羽擊');
  assert.ok(post, '振翼髮|暗夜羽擊 的 regPost 不見了（本條前提消失）');
  // (a) 化隱有效 ⇒ 旗標寫不上去
  const s1 = mkS(mkP('P0', inst(ID.MOON, [en(ID.eP)])), mkP('P1', inst(ID.HID[1])));
  const r1 = post(s1, 0, pool);
  assert.ok(!r1.players[1].active.abilityNullifiedNextTurn,
    '化隱有效時，招式版特性消除不該施加得上（施加點的 attack-effect 免疫閘）');
  // (b) 正對照：化隱被熔岩洞消除時（來悲粗茶=Stage1）⇒ 旗標設得上去，證明 (a) 不是恆真
  const s2 = mkS(mkP('P0', inst(ID.MOON, [en(ID.eP)])), mkP('P1', inst(ID.HID[1])), ID.CAVE);
  const r2 = post(s2, 0, pool);
  assert.ok(r2.players[1].active.abilityNullifiedNextTurn,
    '正對照失效：化隱已被熔岩洞消除，旗標應該設得上去');
});

// ⚠⚠ B10/B11 是**述詞層**的守衛，不是行為層 —— 因為 isAbilityHolderEffective 的
//   step 0b/0c（競技場卡）與 step 1（招式旗標）排在 step 2（暗夜羽擊）**之前**，
//   會把 hasEffectiveOppAbilityImmunity 內部同名檢查的效果整個遮蔽掉。
//   突變測試（把那兩條從 hasEffectiveOppAbilityImmunity 拿掉）在行為層看不出差異，
//   但會讓 isAbilityNullifiedByPassive（UI gate ＋ USE_ABILITY 派發那一路，
//   它**沒有**自己的競技場卡／招式旗標檢查）給出相反答案 ⇒ 在這裡鎖住。
T('B10 ⭐⭐豁免範圍不得擴大到競技場卡（isAbilityNullifiedByPassive 視角）', () => {
  // 來悲粗茶＝Stage1 進化 ⇒ 熔岩洞消除它的化隱 ⇒ 沒有豁免可言 ⇒ 暗夜羽擊照消除。
  const s = mkS(mkP('P0', inst(ID.MOON)), mkP('P1', inst('19150')), ID.CAVE);
  assert.equal(isAbilityNullifiedByPassive(s, 1, s.players[1].active, pool.get('19150'), '化隱', 'active', pool),
    true, '競技場卡在場時化隱不該還有豁免（豁免範圍被擴大了）');
  // 正對照：沒有競技場卡時，同一句必須是 false（證明這條不是恆真）
  const s2 = mkS(mkP('P0', inst(ID.MOON)), mkP('P1', inst('19150')));
  assert.equal(isAbilityNullifiedByPassive(s2, 1, s2.players[1].active, pool.get('19150'), '化隱', 'active', pool),
    false, '正對照：無競技場卡時化隱應豁免暗夜羽擊');
});
T('B11 ⭐⭐豁免範圍不得擴大到招式旗標（isAbilityNullifiedByPassive 視角）', () => {
  const s = mkS(mkP('P0', inst(ID.MOON)), mkP('P1', inst('19149', [], { abilityNullifiedThisTurn: true })));
  assert.equal(isAbilityNullifiedByPassive(s, 1, s.players[1].active, pool.get('19149'), '化隱', 'active', pool),
    true, '招式旗標在身上時化隱不該還有豁免（豁免範圍被擴大了）');
  const s2 = mkS(mkP('P0', inst(ID.MOON)), mkP('P1', inst('19149')));
  assert.equal(isAbilityNullifiedByPassive(s2, 1, s2.players[1].active, pool.get('19149'), '化隱', 'active', pool),
    false, '正對照：沒有旗標時化隱應豁免暗夜羽擊');
});
T('B8 ⭐正對照：沒有任何消除源時，化隱四張行為與 BASE 相同（都有效、都擋）', () => {
  for (const hid of ID.HID) {
    const s = mkS(mkP('P0', inst(ID.PLAIN)), mkP('P1', inst(hid)));
    assert.equal(isAbilityHolderEffective(s, s.players[1].active, pool.get(hid), 1, '化隱', 'active', pool), true);
    assert.equal(canApplyEffectToTarget(s, 0, s.players[1].active, pool.get(hid), 'attack-effect', pool,
      { isBench: false }).blocked, true);
  }
});

T('B9 事實記錄：化隱四張都不是規則寶可夢、也沒有【2階進化】⇒ 初始化／黏著束縛本來就打不到', () => {
  for (const hid of ID.HID) {
    const c = pool.get(hid);
    assert.ok(['Basic', 'Stage1'].includes(c.stage ?? c.subtype), `${c.name} stage 變了：${c.stage}`);
    assert.ok(!/ex$/.test(c.name), `${c.name} 變成規則寶可夢了 ⇒ 初始化那條要重新評估`);
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log('C. damageTakenLastOppTurn ＝ 實際扣到的');

const atkDialga = () => inst(ID.DIALGA, [en(ID.eP), en(ID.eMetal), en(ID.eP)]);
const runAttack = (defActive, atkActive, attackIndex) => {
  const s = mkS(mkP('P0', atkActive, [inst(ID.UBO)]), mkP('P1', defActive, [inst(ID.UBO)]));
  return applyAction(s, { type: 'ATTACK', attackIndex, actorIdx: 0 }, pool);
};

T('C1 ⭐⭐⭐防 KO（岩殿居蟹｜結實 HP150 被 160 打）⇒ 記 140 不是 160', () => {
  const r = runAttack(inst(ID.CRAB), atkDialga(), 1);
  assert.equal(r.players[1].active?.damage, 140, '結實留 HP10 ⇒ 指示物 140');
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 140);
});

T('C2 ⭐⭐⭐帶既有傷害的防 KO（超級摔角鷹人ex 堅忍之軀 HP250，先有 100 傷害，再被 160 打）', () => {
  // ⚠ 結實／勤奮之心／倖存鍛鍊器卡面都要求「HP 是全滿的狀態下」⇒ 帶傷情境必須用擲幣型
  //   堅忍之軀（卡面沒有滿血限制）。強制正面。
  // 受招前 damage=100，堅忍之軀留 HP10 ⇒ damage 變 240 ⇒ 這一擊實際扣到 140（不是全額 160）
  const ORND = Math.random;
  Math.random = () => 0.1;   // 正面
  try {
    const r = runAttack(inst(ID.HAWL, [], { damage: 100 }), atkDialga(), 1);
    assert.equal(r.players[1].active?.damage, 240, '堅忍之軀留 HP10 ⇒ 指示物 240');
    assert.equal(r.players[1].active?.damageTakenLastOppTurn, 140,
      '實際扣到的 = 240 − 100 = 140（BASE 記全額 160）');
  } finally { Math.random = ORND; }
});

T('C3 ⭐⭐⭐倖存鍛鍊器（道具型防 KO）也走同一條', () => {
  const r = runAttack(inst(ID.CRAB, [], { toolAttached: inst(ID.SURV) }), atkDialga(), 1);
  assert.equal(r.players[1].active?.damage, 140);
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 140);
});

T('C4 ⭐正對照：**非防 KO** 的一般傷害記法完全不變（＝ baseDamage）', () => {
  const r = runAttack(inst(ID.PIKA), atkDialga(), 1);   // 200HP 吃 160 ⇒ 沒到致命線
  assert.equal(r.players[1].active?.damage, 160);
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 160, '一般情況必須仍是全額 baseDamage');
  assert.ok(!r.log.some(l => (l.message ?? '').includes('勤奮之心')), '沒到致命線不該叫防 KO');
});

T('C5 ⭐正對照：連續兩擊（都沒防 KO）仍照樣累加', () => {
  const s = mkS(mkP('P0', atkDialga(), [inst(ID.UBO)]),
                mkP('P1', inst(ID.PIKA, [], { damageTakenLastOppTurn: 30 }), [inst(ID.UBO)]));
  const r = applyAction(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 190, '30 + 160 = 190');
});

T('C6 ⭐⭐行為端：重裝角擊讀到的是實際扣到的（防 KO 後 100+270，不是 100+300）', () => {
  // P0 超級拉帝亞斯ex｜幻想脈衝 300（attacks[1]）打 P1 滿血超級赫拉克羅斯ex(HP280)＋倖存鍛鍊器
  //   ⇒ 防 KO 留 HP10 ⇒ 實際扣到 270。
  const s = mkS(mkP('P0', inst(ID.MLATI, [en(ID.eFire), en(ID.eP), en(ID.eP)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.HERA, [en(ID.eGrass), en(ID.eGrass)], { toolAttached: inst(ID.SURV) }),
                    [inst(ID.UBO)]));
  const r = applyAction(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  assert.equal(r.players[1].active?.damage, 270, '倖存鍛鍊器留 HP10 ⇒ 指示物 270');
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 270);
  const pre = ATTACK_PRE.get('超級赫拉克羅斯ex|重裝角擊');
  assert.ok(pre, '重裝角擊 regPre 不見了');
  const out = pre({ ...r, activePlayerIndex: 1 }, 1, pool, {});
  assert.equal(out.damage, 370, '重裝角擊 = 100 + 實際扣到的 270（BASE 會是 100+300=400）');
});

T('C7 lint：本欄位的讀取點枚舉（下限斷言 ＋ 正對照）', () => {
  const files = ['src/lib/game/engine.ts', 'src/lib/game/effects.ts', 'src/lib/game/types.ts',
                 'src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts'];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  let readSites = 0, total = 0;
  for (const f of files) {
    const src = strip(readFileSync(join(ROOT, f), 'utf8'));
    for (const line of src.split('\n')) {
      if (!line.includes('damageTakenLastOppTurn')) continue;
      total++;
      // 「讀」＝ 出現在 `?? 0` 取值運算式且不是同一行的寫入 key
      if (/\.damageTakenLastOppTurn\s*\?\?\s*0/.test(line) && !/damageTakenLastOppTurn:/.test(line)) readSites++;
    }
  }
  assert.ok(total >= 5, `掃描器下限：damageTakenLastOppTurn 出現次數應 ≥5，實得 ${total}（掃描器壞了？）`);
  const hookSrc = strip(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts'), 'utf8'));
  assert.ok(/const dmgTaken = a\?\.damageTakenLastOppTurn \?\? 0;/.test(hookSrc),
    '唯一讀取點（重裝角擊）不見了 ⇒ 這條守衛的前提消失');
  // 正對照：樣式真的抓得到「多一個讀取點」
  assert.ok(/\.damageTakenLastOppTurn\s*\?\?\s*0/.test('const x = a?.damageTakenLastOppTurn ?? 0;'), '讀取樣式恆假＝安慰劑');
  assert.ok(readSites >= 1, `讀取點掃描結果為 ${readSites}，掃描器壞了`);
});

T('C8 lint：engine 主管線必須用「實際扣到的」而不是 baseDamage（＋正對照）', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  const src = strip(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const BAD = /const accumDmgTaken = \(defenderState\.active!\.damageTakenLastOppTurn \?\? 0\) \+ \(baseDamage > 0 \? baseDamage : 0\);/;
  assert.ok(!BAD.test(src), 'engine.ts 又回到「記全額 baseDamage」的寫法');
  assert.ok(/const _actualDamageTaken = Math\.max\(0, _survivedDamage - _damageBeforeThisAttack\);/.test(src),
    '「實際扣到的」算式不見了');
  assert.ok(BAD.test(strip('const accumDmgTaken = (defenderState.active!.damageTakenLastOppTurn ?? 0) + (baseDamage > 0 ? baseDamage : 0);')),
    'C8 樣式抓不到已知違規樣本＝安慰劑');
});

// ══════════════════════════════════════════════════════════════════════
console.log('D. defense.ts：「對手的」必須真的是對手（零行為差異收斂）');

T('D1 ⭐⭐⭐自己這一側的化隱持有者，不該被自己的 ability-effect 擋', () => {
  for (const hid of ID.HID) {
    const s = mkS(mkP('P0', inst(hid)), mkP('P1', inst(ID.PLAIN)));
    const g = canApplyEffectToTarget(s, 0, s.players[0].active, pool.get(hid), 'ability-effect', pool, { isBench: false });
    assert.equal(g.blocked, false, `${pool.get(hid).name}：卡面寫「對手的」，自己這一側不該被擋`);
  }
});

T('D2 ⭐⭐⭐自己這一側的光之翼持有者，不該被自己的 ability-effect 擋', () => {
  const s = mkS(mkP('P0', inst(ID.SHINE)), mkP('P1', inst(ID.PLAIN)));
  const g = canApplyEffectToTarget(s, 0, s.players[0].active, pool.get(ID.SHINE), 'ability-effect', pool, { isBench: false });
  assert.equal(g.blocked, false, '光之翼卡面寫「對手的寶可夢特性」⇒ 自己這一側不該被擋');
});

T('D3 ⭐正對照：對手側照擋（不得過度修）', () => {
  const s = mkS(mkP('P0', inst(ID.PLAIN)), mkP('P1', inst(ID.SHINE), [inst(ID.HID[3])]));
  assert.equal(canApplyEffectToTarget(s, 0, s.players[1].active, pool.get(ID.SHINE), 'ability-effect', pool,
    { isBench: false }).blocked, true, '對手戰鬥位的光之翼必須照擋');
  assert.equal(canApplyEffectToTarget(s, 0, s.players[1].bench[0], pool.get(ID.HID[3]), 'ability-effect', pool,
    { isBench: true }).blocked, true, '對手備戰的化隱必須照擋');
});

T('D4 ⭐正對照：target 不在任何一側（KO 前快照等）⇒ fail-closed，維持 BASE 的照擋', () => {
  const s = mkS(mkP('P0', inst(ID.PLAIN)), mkP('P1', inst(ID.PLAIN)));
  const ghost = inst(ID.HID[0]);   // 沒放進任何一方場上
  assert.equal(canApplyEffectToTarget(s, 0, ghost, pool.get(ID.HID[0]), 'attack-effect', pool,
    { isBench: false }).blocked, true, '找不到 target 時必須維持舊行為（fail-closed）');
});

T('D5 lint：isTargetOnActorOwnSide 必須排在 hasEffectiveAbilityByInst 之後（效能：一般盤面 0 次呼叫）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/defense.ts'), 'utf8');
  const RE = /hasEffectiveAbilityByInst\(state, _msIdx, target, pool, '光之翼'\)\s*\n\s*&& !isTargetOnActorOwnSide\(state, actorIdx, target\)/;
  assert.ok(RE.test(src), '光之翼那條的 isTargetOnActorOwnSide 不見了或順序被調到前面（會變成熱路徑）');
  assert.ok(/isAbilityHolderEffective\(state, target, targetCard, dIdxHy, '化隱', locHy, pool\)\s*\n\s*&& !isTargetOnActorOwnSide\(state, actorIdx, target\)/.test(src),
    '化隱那條的 isTargetOnActorOwnSide 不見了或順序被調到前面');
  // 正對照：樣式在「順序顛倒」的樣本上抓不到
  const fake = "if (!isTargetOnActorOwnSide(state, actorIdx, target)\n        && hasEffectiveAbilityByInst(state, _msIdx, target, pool, '光之翼')) {";
  assert.ok(!RE.test(fake), 'D5 樣式恆真＝安慰劑');
});

// ══════════════════════════════════════════════════════════════════════
console.log('E. 守衛自身：v6.253 的 C5 不得再是恆真斷言');

T('E1 lint：test-v6253 不得再出現 `!(listed && blocked)` 這種恆真寫法（＋正對照）', () => {
  const src = readFileSync(join(ROOT, 'scripts/test-v6253-nullifier-and-survive.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  const BAD = /assert\.ok\(!\(listed && blocked\)/;
  assert.ok(!BAD.test(src), 'C5 又變回恆真安慰劑寫法');
  assert.ok(/assert\.equal\(listed, !blocked,/.test(src), 'C5 的「同一答案」雙向斷言不見了');
  assert.ok(BAD.test('  assert.ok(!(listed && blocked), "x");'), 'E1 樣式抓不到已知違規樣本＝安慰劑');
});

console.log(`\n═══ v6.255 化隱豁免 ＋ 實際扣到的傷害 ＋ 對手側驗證：${pass} passed, ${fail} failed ═══`);
process.exitCode = fail ? 1 : 0;
