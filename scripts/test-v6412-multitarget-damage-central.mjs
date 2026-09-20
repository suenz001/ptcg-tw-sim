// v6.412 守衛：多目標招式的傷害管線**收斂成一份**（IRON_RULES Rule 38）。
//
// 【問題】站內打「對手戰鬥位」的招式傷害管線原本有四份各自獨立的實作：
//   ① engine.ts 攻擊主管線　② effects.ts `dealAttackDamageToTarget`
//   ③ `regR('clone-strike-multi-hit')` 的 inline　④ `regR('snipe-multi')` 的 inline
//   ③④ 兩份**缺了一大塊**，而且是玩家看得到的：
//     ・攻擊方 11 項加成只做了 TOOL_ATTACK_BONUS ⇒ 力量蛋白飲／伏特【雷】能量／回合加傷／
//       招致削傷／格拉吉歐的決戰／PASSIVE_ATTACK_BONUS／化朗鎮／空手道王演練／烏栗／腎上腺力量 **全漏**
//     ・防守方 Block A（威嚇之顎／同步脈衝／鐵之防禦…）整塊沒有
//     ・下次被擊減傷（鐵羽毛類）、變硬 兩項沒有
//     ・順序也相反：inline 是「弱點 → 道具」，官方與 engine 主管線是「加成 → 弱點」
//
// 【v6.412 收斂】③④ 的 inline 整段刪掉，改成逐目標呼叫 ②；②新增 `skipDefEffects` 選項
//   （原本只有 engine 有這個旗標）承接 `flat` 型招式（雙刃劍／出奇一擊）。
//
// 【官方依據】`PTCG RULES/PTCG_RULES.md`
//   §18.E：「雖然招式『跳躍扣殺』不計算對手的戰鬥寶可夢身上的附加效果，但**會計算
//     超級長耳兔ex自己身上的附加效果**」⇒ skipDefEffects **不**擋攻擊方加成（本檔【C】段）。
//   §17.46.E：力量蛋白飲「對對手的備戰寶可夢造成的傷害**不會**『＋30』點」⇒ 只對戰鬥位（B9）。
//
// 【HEAD-FAIL】BASE（v6.411）上【A】【B】幾乎整段紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x412-s.js'), E = join(ROOT, '.x412-e.ts'), O = join(ROOT, '.x412-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { dealAttackDamageToTarget, applyAttackerActiveDamageBonuses } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction } = M;
const MISSING = Symbol('v6.412 之前不存在');
const deal = typeof M.dealAttackDamageToTarget === 'function' ? M.dealAttackDamageToTarget : () => MISSING;

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
// ⭐ 動態挑卡（不 pin 任何卡 id）
const byAtk = (n, a) => cards.find((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
const NINJA = byAtk('甲賀忍蛙ex', '分身連打');          // clone-strike，【鬥】
const TRIO = byAtk('三海地鼠ex', '三色炮');              // clone-strike，【雷】
const KYUREM = byAtk('酋雷姆', '三重冰霜');              // snipe-multi，非規則
const IRONHEAD = byAtk('鐵頭殼ex', '雙刃劍');            // snipe-multi，flat
assert.ok(NINJA && TRIO && KYUREM && IRONHEAD, '測試用卡沒挑齊（卡池變了？）');
// ⚠⚠ 靶必須**不是太晶寶可夢** —— 太晶在備戰區對招式傷害免疫，
//   拿它當備戰靶的話 B9 會量到 0（空真），看起來像「加成沒有外溢」其實是「根本沒打到」。
const TARGET = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 300
  && !(c.abilities || []).length && !c.name.includes('超級') && !c.weakness
  && !(c.tags || []).some((t) => /太晶/.test(String(t))));
assert.ok(TARGET, '找不到「無弱點、非太晶、無特性」的高 HP 靶');

let n = 0, pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const en = (t) => {
  const e = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
    && (c.energyType === t || (c.name || '').includes(KANJI[t] || '草')))
    || cards.find((c) => c.supertype === 'Energy');
  return { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] };
};
const namedEnergy = (nm) => { const e = cards.find((c) => c.supertype === 'Energy' && c.name === nm); return e ? { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] } : null; };
const namedCard = (nm) => cards.find((c) => c.name === nm);

/** 跑一次完整攻擊（含把 picker 全部解掉）。 */
function fire(atk, atkName, opts = {}) {
  const ai = (atk.attacks || []).findIndex((x) => x.name === atkName);
  assert.ok(ai >= 0, '找不到招式 ' + atkName);
  const cost = atk.attacks[ai].cost || [];
  const es = cost.map((t) => en(t)).concat([en('Colorless'), en('Colorless'), en('Colorless')]);
  for (const extra of (opts.extraEnergy || [])) if (extra) es.push(extra);
  const a = inst(atk.id, es, opts.atkInst || {});
  if (opts.atkTool) a.toolAttached = { iid: 't' + (++n), cardId: String(opts.atkTool), damage: 0, energyAttached: [] };
  const d = inst(opts.defCardId ?? TARGET.id, [], opts.defInst || {});
  const P0 = { name: 'P1', active: a, bench: [inst(TARGET.id)], hand: (opts.hand || []), deck: [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [], ...(opts.atkPlayer || {}) };
  const P1 = { name: 'P2', active: d, bench: [inst(opts.benchCardId ?? TARGET.id)], hand: [], deck: [inst(TARGET.id)], discard: [], prizes: [] };
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: opts.stadium ? { iid: 'sd' + (++n), cardId: String(opts.stadium), damage: 0, energyAttached: [] } : null,
    players: [P0, P1],
  };
  let o = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); st = o?.state ?? o;
  let r = 0;
  while (st.pendingSelection && r++ < 8) {
    const ps = st.pendingSelection;
    const V = ps.params?.validIids || ps.validIids || [];
    // ⚠ 這一族的卡面是「對手的 N 隻寶可夢各受到…」＝**強制選滿**（v6.305 那一族）
    //   ⇒ 只送 1 個 iid 會被退回，量到 0。依 maxCount 補滿。
    const targets = opts.pickBench
      ? [st.players[1].bench[0]?.iid, st.players[1].active?.iid]
      : [st.players[1].active?.iid, st.players[1].bench[0]?.iid];
    const pick = ps.type === 'opp-poke-choose'
      ? targets.filter(Boolean).slice(0, ps.maxCount ?? 1)
      : V.slice(0, ps.maxCount ?? 1);
    const o2 = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: pick }, pool); st = o2?.state ?? o2;
  }
  // ⚠ 靶被 KO 時 active 變 null ⇒ 改從 log 取「造成 N 點傷害」的最後一筆（順序型斷言要用得到）
  const _texts = (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));
  // ⚠ 被擊倒時 log 是「…被擊倒！+N 張獎賞卡。【…= 400】」⇒ 沒有「造成 N 傷害」字樣，
  //   所以也從公式字串的 `= N】` 取（順序型斷言 B7 就是打到 KO 的那一擊）。
  const _m = _texts.map((t) => /造成 (\d+) (?:點)?傷害/.exec(t) || /=\s*(\d+)】/.exec(t)).filter(Boolean).pop();
  return {
    dmg: st.players[1].active?.damage ?? null,
    logDmg: _m ? Number(_m[1]) : null,
    benchDmg: st.players[1].bench[0]?.damage ?? null,
    penaltyAfter: st.players[0].active?.nextOwnAttackPenalty,
    reduceAfter: st.players[1].active?.damageReduceNextHit,
    logs: (st.log || []).map((l) => (typeof l === 'string' ? l : l.message)),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 【A】靜態：兩個 resolver 不得再有自己的 inline 傷害管線
// ══════════════════════════════════════════════════════════════════════════════
const EFF = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')), 'effects.ts');
const blockOf = (anchor) => {
  const i = EFF.indexOf(anchor);
  assert.ok(i >= 0, 'anchor 失效：' + anchor);
  const j = EFF.indexOf('\n});\n', i);
  assert.ok(j > i && j - i < 9000, `anchor 視窗異常（${j - i}）：${anchor}`);
  return EFF.slice(i, j);
};
T('A1. clone-strike-multi-hit 交給中央 dealAttackDamageToTarget（HEAD-FAIL：BASE 上是 inline）', () => {
  const b = blockOf("regR('clone-strike-multi-hit'");
  assert.ok(b.includes('dealAttackDamageToTarget('), '沒有交給中央 helper');
  for (const bad of ['applyWeakRes(', 'TOOL_ATTACK_BONUS', 'koPrizesAdjusted(', 'fireDefenderOnDamaged(', 'withAttackDamageTaken(']) {
    assert.ok(!b.includes(bad), `inline 管線還在（出現 ${bad}）⇒ 判準又變兩份`);
  }
});
T('A2. snipe-multi 交給中央 dealAttackDamageToTarget（HEAD-FAIL：BASE 上是 inline）', () => {
  const b = blockOf("regR('snipe-multi'");
  assert.ok(b.includes('dealAttackDamageToTarget('), '沒有交給中央 helper');
  for (const bad of ['applyWeakRes(', 'TOOL_ATTACK_BONUS', 'koPrizesAdjusted(', 'fireDefenderOnDamaged(', 'withAttackDamageTaken(']) {
    assert.ok(!b.includes(bad), `inline 管線還在（出現 ${bad}）⇒ 判準又變兩份`);
  }
});
T('A3. snipe-multi 的 flat 必須同時傳 noWeakness 與 skipDefEffects（卡面兩件事都要）', () => {
  const b = blockOf("regR('snipe-multi'");
  assert.ok(/noWeakness:\s*flat/.test(b), 'flat 沒有接上 noWeakness');
  assert.ok(/skipDefEffects:\s*flat/.test(b), 'flat 沒有接上 skipDefEffects');
});
T('A4. 中央 helper 有 skipDefEffects 選項，且**不**用它擋攻擊方加成（官方 §18.E）', () => {
  const i = EFF.indexOf('export function dealAttackDamageToTarget(');
  assert.ok(i >= 0, '找不到中央 helper');
  const j = EFF.indexOf('\nexport function ', i + 10);
  const b = EFF.slice(i, j);
  assert.ok(/skipDefEffects\?:\s*boolean/.test(b), '簽章沒有 skipDefEffects');
  assert.ok(/const _skipDef = opts\?\.skipDefEffects === true;/.test(b), '沒有取出旗標');
  // 攻擊方加成那一行**不得**被 _skipDef 擋住
  const line = b.split('\n').find((L) => L.includes('applyAttackerActiveDamageBonuses('));
  assert.ok(line, '找不到攻擊方加成的呼叫');
  const gate = b.split('\n')[b.split('\n').indexOf(line) - 1] || '';
  assert.ok(!/_skipDef/.test(gate) && !/_skipDef/.test(line),
    '攻擊方加成被 skipDefEffects 擋掉了 —— 違反官方 §18.E（跳躍扣殺仍計算自己身上的附加效果）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：收斂前漏掉的每一項，逐條實測
//   ⚠ 每一條都配「不帶那個效果」的基準，證明差異真的來自它（不是恆真）。
// ══════════════════════════════════════════════════════════════════════════════
const BASE_NINJA = fire(NINJA, '分身連打');
T('B0. 基準盤面成立：分身連打打得到對手戰鬥位', () => {
  assert.ok(BASE_NINJA.dmg > 0, `基準傷害 ${BASE_NINJA.dmg} —— 盤面沒搭起來，下面全是空真`);
});
T('B1.【力量蛋白飲】clone-strike 路徑補上攻擊方加成（+30）', () => {
  const r = fire(NINJA, '分身連打', { atkPlayer: { damageBoostFightingThisTurn: 30 } });
  assert.strictEqual(r.dmg - BASE_NINJA.dmg, 30, `力量蛋白飲沒加到（${BASE_NINJA.dmg} → ${r.dmg}）`);
});
T('B2.【招致削傷】-50 要生效，而且旗標要被消耗', () => {
  const r = fire(NINJA, '分身連打', { atkInst: { nextOwnAttackPenalty: 50 } });
  assert.strictEqual(BASE_NINJA.dmg - r.dmg, 50, `招致削傷沒扣到（${BASE_NINJA.dmg} → ${r.dmg}）`);
  assert.strictEqual(r.penaltyAfter, undefined, '旗標沒有被消耗 ⇒ 下一次攻擊還會再扣一次');
});
T('B3.【下次被擊減傷】防守方的鐵羽毛類 -30 要生效並被消耗', () => {
  const r = fire(NINJA, '分身連打', { defInst: { damageReduceNextHit: 30 } });
  assert.strictEqual(BASE_NINJA.dmg - r.dmg, 30, `減傷沒生效（${BASE_NINJA.dmg} → ${r.dmg}）`);
  assert.strictEqual(r.reduceAfter, undefined, '減傷旗標沒有被消耗');
});
T('B4.【變硬】最終傷害 ≤ N 時歸 0', () => {
  const r = fire(NINJA, '分身連打', { defInst: { blockAttackDamageIfLTEThisTurn: BASE_NINJA.dmg + 10 } });
  assert.strictEqual(r.dmg, 0, `變硬沒生效（傷害 ${r.dmg}）`);
});
T('B5.【伏特【雷】能量】三色炮（【雷】屬性）帶 1 張 ⇒ +20', () => {
  const volt = namedEnergy('伏特【雷】能量');
  assert.ok(volt, '找不到伏特【雷】能量');
  // ⚠ 三色炮的卡面是「從自己的**手牌**將最多 3 張能量卡丟棄，造成其張數×60」⇒ 手牌要有能量
  const hand3 = () => [en('Lightning'), en('Lightning'), en('Lightning')];
  const b = fire(TRIO, '三色炮', { hand: hand3() });
  const r = fire(TRIO, '三色炮', { hand: hand3(), extraEnergy: [volt] });
  assert.ok(b.dmg > 0, `基準 ${b.dmg} —— 盤面沒搭起來`);
  assert.strictEqual(r.dmg - b.dmg, 20, `伏特【雷】能量沒加到（${b.dmg} → ${r.dmg}）`);
});
T('B6.【格拉吉歐的決戰】snipe-multi 路徑：非規則寶可夢 +80', () => {
  const b = fire(KYUREM, '三重冰霜');
  const r = fire(KYUREM, '三重冰霜', { atkPlayer: { gladionDuelBonusThisTurn: true } });
  assert.ok(b.dmg > 0, `基準 ${b.dmg} —— 盤面沒搭起來`);
  assert.strictEqual(r.dmg - b.dmg, 80, `格拉吉歐的決戰沒加到（${b.dmg} → ${r.dmg}）`);
});
T('B7.【順序】加成必須在弱點**之前**（官方與 engine 主管線一致）', () => {
  // 盤面：帶極限腰帶（對 ex +50）打「弱點 ×2 的 ex」⇒ 正確是 (base+50)×2，錯誤是 base×2+50
  const belt = namedCard('極限腰帶');
  assert.ok(belt, '找不到極限腰帶');
  const atkType = NINJA.pokemonType;
  const weakEx = cards.find((c) => c.supertype === 'Pokemon' && /ex/i.test(c.subtype || '')
    && Number(c.hp) >= 300 && !(c.abilities || []).length && !c.name.includes('超級')
    && (c.weakness?.type === atkType || c.weakness?.[0]?.type === atkType));
  assert.ok(weakEx, `找不到弱點 ${atkType} 的 ex 靶`);
  const r = fire(NINJA, '分身連打', { atkTool: belt.id, defCardId: weakEx.id });
  const base = BASE_NINJA.dmg;
  // ⚠ 這一招同時打兩隻（卡面「對手的 2 隻各受到…」），而且這一擊多半直接 KO（active 變 null）
  //   ⇒ 從 log 找**戰鬥位那一隻**的那一行（含它的卡名），取公式結果或傷害數字。
  const line = r.logs.filter((x) => x.includes(weakEx.name)).pop();
  assert.ok(line, `log 裡找不到 ${weakEx.name} 的傷害行：` + r.logs.slice(-5).join(' | '));
  const mm = /=\s*(\d+)】/.exec(line) || /造成 (\d+) (?:點)?傷害/.exec(line);
  assert.ok(mm, '那一行沒有傷害數字：' + line);
  assert.strictEqual(Number(mm[1]), (base + 50) * 2,
    `順序錯了：實得 ${mm[1]}，(base+50)×2 應為 ${(base + 50) * 2}（若是 ${base * 2 + 50} 就是「弱點先於加成」的舊 inline 順序） :: ` + line);
});
T('B8.【flat＋§18.E】雙刃劍不計對手附加效果，但**仍計算攻擊方自己的**加成', () => {
  // ⚠ 用「回合加傷」當樣本：鐵頭殼ex 是 ex（規則寶可夢）⇒ 格拉吉歐的決戰依卡面本來就不適用。
  const b = fire(IRONHEAD, '雙刃劍');
  const r = fire(IRONHEAD, '雙刃劍', { atkInst: { damageBonusThisTurn: 80 } });
  assert.ok(b.dmg > 0, `基準 ${b.dmg} —— 盤面沒搭起來`);
  assert.strictEqual(r.dmg - b.dmg, 80,
    `flat 招式把攻擊方自己的加成也擋掉了（${b.dmg} → ${r.dmg}）—— 違反官方 §18.E`);
});
T('B9.【只對戰鬥位的加成不得外溢到備戰】力量蛋白飲對備戰不 +30（官方 §17.46.E）', () => {
  const bb = fire(NINJA, '分身連打', { pickBench: true });
  const rb = fire(NINJA, '分身連打', { pickBench: true, atkPlayer: { damageBoostFightingThisTurn: 30 } });
  assert.ok((bb.benchDmg ?? 0) > 0, `備戰基準 ${bb.benchDmg} —— 盤面沒搭起來`);
  assert.strictEqual(rb.benchDmg, bb.benchDmg,
    `力量蛋白飲外溢到備戰（${bb.benchDmg} → ${rb.benchDmg}）—— 官方明文「對備戰寶可夢不會 +30」`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】skipDefEffects 的契約（直呼中央 helper，帶／不帶旗標的差分）
// ══════════════════════════════════════════════════════════════════════════════
function mkDirect(defInst = {}) {
  const a = inst(NINJA.id, [en('Fighting')]);
  const d = inst(TARGET.id, [], defInst);
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'P1', active: a, bench: [], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'P2', active: d, bench: [inst(TARGET.id)], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
}
const dmgOf = (st) => st?.players?.[1]?.active?.damage ?? (st === MISSING ? 'MISSING' : null);
T('C1. skipDefEffects=true 跳過「下次被擊減傷」，且旗標**不消耗**（鏡射 engine）', () => {
  const st = mkDirect({ damageReduceNextHit: 30 });
  const iid = st.players[1].active.iid;
  const off = deal(st, 0, iid, 100, pool, { kind: 'attack-damage', label: 'T' });
  const on = deal(st, 0, iid, 100, pool, { kind: 'attack-damage', label: 'T', skipDefEffects: true });
  assert.strictEqual(dmgOf(off), 70, `不帶旗標應被減到 70，實得 ${dmgOf(off)}`);
  assert.strictEqual(dmgOf(on), 100, `帶旗標應跳過減傷得 100，實得 ${dmgOf(on)}`);
  assert.strictEqual(on.players[1].active.damageReduceNextHit, 30, 'skipDefEffects 時旗標竟然被消耗了');
});
T('C2. skipDefEffects=true 跳過「變硬」', () => {
  const st = mkDirect({ blockAttackDamageIfLTEThisTurn: 200 });
  const iid = st.players[1].active.iid;
  assert.strictEqual(dmgOf(deal(st, 0, iid, 100, pool, { label: 'T' })), 0, '不帶旗標時變硬應免傷');
  assert.strictEqual(dmgOf(deal(st, 0, iid, 100, pool, { label: 'T', skipDefEffects: true })), 100, '帶旗標時變硬應被跳過');
});
T('C3.【§18.E】skipDefEffects=true 仍然套用攻擊方自己的加成', () => {
  // ⚠ 用「回合加傷」：甲賀忍蛙ex 是 ex ⇒ 格拉吉歐的決戰依卡面不適用（那不是 bug）。
  const st = mkDirect();
  st.players[0].active.damageBonusThisTurn = 80;
  const iid = st.players[1].active.iid;
  const on = deal(st, 0, iid, 100, pool, { label: 'T', skipDefEffects: true });
  assert.strictEqual(dmgOf(on), 180, `攻擊方加成被 skipDefEffects 擋掉了（實得 ${dmgOf(on)}，應 180）`);
});
T('C4.【正對照】不帶 skipDefEffects 時，防守方效果照常生效（證明 C1/C2 不是恆真）', () => {
  const st = mkDirect({ damageReduceNextHit: 30, blockAttackDamageIfLTEThisTurn: 50 });
  const iid = st.players[1].active.iid;
  const off = deal(st, 0, iid, 100, pool, { label: 'T' });
  // 100 − 30（下次被擊減傷）= 70；70 > 變硬門檻 50 ⇒ 不免傷 ⇒ 70。
  assert.strictEqual(dmgOf(off), 70, `不帶旗標時兩項都該生效（應 70），實得 ${dmgOf(off)}`);
  const st2 = mkDirect({ damageReduceNextHit: 30, blockAttackDamageIfLTEThisTurn: 80 });
  const iid2 = st2.players[1].active.iid;
  // 100 − 30 = 70 ≤ 80 ⇒ 變硬免傷 ⇒ 0
  assert.strictEqual(dmgOf(deal(st2, 0, iid2, 100, pool, { label: 'T' })), 0, '變硬門檻 80 時應免傷');
});

console.log(`\n=== v6412 multitarget-damage-central: ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
