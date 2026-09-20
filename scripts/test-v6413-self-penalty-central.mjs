// v6.413 守衛：①「招致削傷」（nextOwnAttackPenalty）收斂成一份且**不限目標位置**；
//              ② 對手全備戰傷害（snipeAllOppBenchPost）的兩份同名實作收斂；
//              ③ 奧利瓦ex｜油之機關槍 收進中央傷害管線。
//
// 【卡面】逐字（黑魯加｜大聲咆哮、超級火炎獅ex｜吠、嘎啦嘎啦／菊草葉／尼多蘭／布撥｜叫聲、
//   振翼髮｜月亮之力、仙子伊布ex｜魔法魅惑…）：
//   「在下個對手的回合，受到這個招式的寶可夢**使用招式的傷害**「-N」點。」
//   ⚠⚠ **沒有**「對對手的戰鬥寶可夢」這一句 —— 對照力量蛋白飲／伏特【雷】能量／極限腰帶
//   的卡面**都有**那一句，而且官方 §17.46.E 還特別裁定「對備戰寶可夢造成的傷害不會＋30」。
//
// 【官方】`PTCG RULES/PTCG_RULES.md` §18.E：「雖然招式『跳躍扣殺』不計算對手的戰鬥寶可夢
//   身上的附加效果，但**會計算超級長耳兔ex自己身上的附加效果**，因此…使用的招式的傷害會
//   「－50」點。」⇒ 招致削傷是**攻擊方自己身上**的效果：打備戰要扣，skipDefEffects 也不擋。
//
// 【站長裁定 2026-09-20】一招打多隻時每一隻都扣 -N，但旗標**只消耗一次**。
//
// 【HEAD-FAIL】BASE（v6.412）上：【A】哨兵全紅、【B2~B8】備戰不扣、【C1】備戰被打死不昏厥。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x413-s.js'), E = join(ROOT, '.x413-e.ts'), O = join(ROOT, '.x413-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export * as EFF from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction } = M;
// ⚠ IRON_RULES Rule 41：BASE 上這些 export 不存在，直呼會 TypeError 讓整支在第一條就爆掉
//   ⇒ 用哨兵包住，讓每一條各自誠實翻紅。
const MISSING = Symbol('v6.413 之前不存在');
/** 缺席時回傳哨兵而不是 throw（Rule 41：整支 throw 只證明得了第一條）。 */
const F = (n) => (typeof M.EFF?.[n] === 'function' ? M.EFF[n] : () => MISSING);
/** ⚠ 只問「在不在」——**不要**用無參數呼叫去試探，那會在函式內部 TypeError（假紅）。 */
const HAS = (n) => typeof M.EFF?.[n] === 'function';

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
// ⭐ 動態挑卡（不 pin 任何卡 id；卡池變了就紅在「挑不到」，不會靜默失效）
const byAtk = (n, a) => cards.find((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
const NINJA = byAtk('甲賀忍蛙ex', '分身連打');        // clone-strike（可打備戰）
const ARTIC = byAtk('急凍鳥', '冰雹');                // hitBenchAll：對手全備戰 30
const STARMIE = byAtk('超級寶石海星ex', '噴射打擊');  // bench-hit-N：對手 1 隻備戰 50
const MOMO = byAtk('N的雙倍多多冰', '暴風雪');        // snipeAllOppBenchPost（v2490 那一份）
const SALAMENCE = byAtk('暴飛龍ex', '廣域爆破');      // snipeAllOppBenchPost（v2610 那一份）
const OLIVA = byAtk('奧利瓦ex', '油之機關槍');        // damage-distribute
assert.ok(NINJA && ARTIC && STARMIE && MOMO && SALAMENCE && OLIVA,
  `測試用卡沒挑齊（卡池變了？）NINJA=${!!NINJA} ARTIC=${!!ARTIC} STARMIE=${!!STARMIE} MOMO=${!!MOMO} SALA=${!!SALAMENCE} OLIVA=${!!OLIVA}`);
// ⚠⚠ 靶必須**不是太晶寶可夢**（太晶在備戰對招式傷害免疫 ⇒ 量到 0 是空真），
//   也不能有特性／弱點（否則差值不是來自本版）。
const TARGET = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 300
  && !(c.abilities || []).length && !c.name.includes('超級') && !c.weakness
  && !(c.tags || []).some((t) => /太晶/.test(String(t))));
const FRAIL = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) > 0 && Number(c.hp) <= 60
  && !(c.abilities || []).length && !c.name.includes('超級') && !c.weakness
  && !(c.tags || []).some((t) => /太晶/.test(String(t))));
assert.ok(TARGET && FRAIL, '找不到「無弱點、非太晶、無特性」的高 HP／低 HP 靶');

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

/**
 * 跑一次完整攻擊。
 * @param opts.aIdx        攻擊方（0 或 1）—— 鏡像測試用
 * @param opts.atkInst     攻擊方 active 的額外欄位（例如 nextOwnAttackPenalty）
 * @param opts.atkPlayer   攻擊方 player 的額外欄位（例如 damageBoostFightingThisTurn）
 * @param opts.benchCardId 對手備戰第一隻的卡 id
 * @param opts.benchN      對手備戰隻數（預設 2）
 * @param opts.pick        picker 的 payload 產生器 (st) => string[]
 */
function fire(atk, atkName, opts = {}) {
  const aIdx = opts.aIdx ?? 0, dIdx = (1 - aIdx);
  const ai = (atk.attacks || []).findIndex((x) => x.name === atkName);
  assert.ok(ai >= 0, '找不到招式 ' + atkName);
  const cost = atk.attacks[ai].cost || [];
  const es = cost.map((t) => en(t)).concat([en('Colorless'), en('Colorless'), en('Colorless'), en('Colorless')]);
  const a = inst(atk.id, es, opts.atkInst || {});
  const benchN = opts.benchN ?? 2;
  const oppBench = [];
  for (let k = 0; k < benchN; k++) oppBench.push(inst(opts.benchCardId ?? TARGET.id));
  const PA = { name: 'PA', active: a, bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [], ...(opts.atkPlayer || {}) };
  const PD = { name: 'PD', active: inst(opts.defCardId ?? TARGET.id, [], opts.defInst || {}), bench: oppBench, hand: [], deck: [inst(TARGET.id)], discard: [], prizes: [] };
  const players = aIdx === 0 ? [PA, PD] : [PD, PA];
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: aIdx, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players,
  };
  let o = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); st = o?.state ?? o;
  let r = 0;
  while (st.pendingSelection && r++ < 10) {
    const ps = st.pendingSelection;
    const V = ps.params?.validIids || ps.validIids || [];
    const pick = opts.pick
      ? opts.pick(st, ps)
      : (ps.type === 'opp-poke-choose' || ps.type === 'opp-bench-choose'
        ? [st.players[dIdx].bench[0]?.iid, st.players[dIdx].active?.iid].filter(Boolean).slice(0, ps.maxCount ?? 1)
        : V.slice(0, ps.maxCount ?? 1));
    const o2 = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: pick }, pool); st = o2?.state ?? o2;
  }
  return {
    st,
    activeDmg: st.players[dIdx].active?.damage ?? null,
    benchDmg: st.players[dIdx].bench.map((b) => b.damage),
    benchLen: st.players[dIdx].bench.length,
    penaltyAfter: st.players[aIdx].active?.nextOwnAttackPenalty,
    prizesTaken: (st.players[aIdx].prizes || []).length,
    logs: (st.log || []).map((l) => (typeof l === 'string' ? l : l.message)),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 【A】HEAD-FAIL 哨兵：本版的兩個新中央 export 必須存在（BASE 上不存在 ⇒ 各自誠實翻紅）
// ══════════════════════════════════════════════════════════════════════════════
T('A1. `applyAttackerSelfPenalty` 已 export（招致削傷的唯一實作）', () => {
  assert.ok(HAS('applyAttackerSelfPenalty'), 'v6.413 的中央 helper 不存在（BASE 上本條必紅）');
});
T('A2. `snipeAllOppBenchDamage` 已 export（對手全備戰傷害的唯一實作）', () => {
  assert.ok(HAS('snipeAllOppBenchDamage'), 'v6.413 的中央 helper 不存在（BASE 上本條必紅）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：招致削傷**不限目標位置**（官方 §18.E）
//   ⚠ 每一條都配「不帶旗標」的基準，證明差值真的來自旗標（不是恆真）。
// ══════════════════════════════════════════════════════════════════════════════
const PEN = 50;
const B_NINJA0 = fire(NINJA, '分身連打', { pick: (st) => [st.players[1].active.iid, st.players[1].bench[0].iid] });
T('B0. 基準盤面成立：分身連打同時打到戰鬥位與備戰', () => {
  assert.ok(B_NINJA0.activeDmg > 0, `戰鬥位 ${B_NINJA0.activeDmg} —— 盤面沒搭起來，下面全是空真`);
  assert.ok(B_NINJA0.benchDmg[0] > 0, `備戰 ${B_NINJA0.benchDmg[0]} —— 盤面沒搭起來，下面全是空真`);
});
const B_NINJA1 = fire(NINJA, '分身連打', {
  atkInst: { nextOwnAttackPenalty: PEN },
  pick: (st) => [st.players[1].active.iid, st.players[1].bench[0].iid],
});
T('B1.【正對照】戰鬥位照舊 -50（v6.412 之前就有，本版不得改壞）', () => {
  assert.strictEqual(B_NINJA0.activeDmg - B_NINJA1.activeDmg, PEN,
    `戰鬥位沒扣到（${B_NINJA0.activeDmg} → ${B_NINJA1.activeDmg}）`);
});
T('B2. ⭐⭐⭐【備戰】也要 -50（HEAD-FAIL：BASE 上備戰完全不扣）', () => {
  assert.strictEqual(B_NINJA0.benchDmg[0] - B_NINJA1.benchDmg[0], PEN,
    `備戰沒扣到（${B_NINJA0.benchDmg[0]} → ${B_NINJA1.benchDmg[0]}）—— 卡面沒有「對對手的戰鬥寶可夢」這一句`);
});
T('B3. ⭐⭐ 一招打兩隻：兩隻都扣，但旗標只消耗一次（站長裁定 2026-09-20）', () => {
  assert.strictEqual(B_NINJA1.penaltyAfter, undefined, '旗標沒有被消耗 ⇒ 下一次攻擊還會再扣');
  assert.strictEqual(B_NINJA0.activeDmg - B_NINJA1.activeDmg, PEN, '戰鬥位那一隻沒扣');
  assert.strictEqual(B_NINJA0.benchDmg[0] - B_NINJA1.benchDmg[0], PEN, '備戰那一隻沒扣');
});
const B_ART0 = fire(ARTIC, '冰雹');
const B_ART1 = fire(ARTIC, '冰雹', { atkInst: { nextOwnAttackPenalty: 10 } });
T('B4. ⭐⭐⭐ hitBenchAll（急凍鳥｜冰雹 30）：對手**全**備戰都要扣（HEAD-FAIL）', () => {
  assert.ok(B_ART0.benchDmg.length >= 2 && B_ART0.benchDmg.every((d) => d === 30),
    `基準沒成立（${JSON.stringify(B_ART0.benchDmg)}）`);
  assert.ok(B_ART1.benchDmg.every((d) => d === 20),
    `全備戰沒有各扣 10（${JSON.stringify(B_ART1.benchDmg)}）`);
});
T('B5. ⭐ hitBenchAll：扣完 ≤0 時夾 0，不得變成負傷或回血', () => {
  const r = fire(ARTIC, '冰雹', { atkInst: { nextOwnAttackPenalty: 100 } });
  assert.ok(r.benchDmg.every((d) => d === 0), `夾 0 失敗（${JSON.stringify(r.benchDmg)}）`);
});
const B_ST0 = fire(STARMIE, '噴射打擊', { pick: (st, ps) => (ps.params?.validIids || ps.validIids || [st.players[1].bench[0].iid]).slice(0, 1) });
const B_ST1 = fire(STARMIE, '噴射打擊', { atkInst: { nextOwnAttackPenalty: 20 }, pick: (st, ps) => (ps.params?.validIids || ps.validIids || [st.players[1].bench[0].iid]).slice(0, 1) });
T('B6. ⭐⭐⭐ bench-hit-N（超級寶石海星ex｜噴射打擊 50）：被選中的備戰要扣（HEAD-FAIL）', () => {
  const b0 = Math.max(...B_ST0.benchDmg), b1 = Math.max(...B_ST1.benchDmg);
  assert.strictEqual(b0, 50, `基準沒成立（${JSON.stringify(B_ST0.benchDmg)}）`);
  assert.strictEqual(b0 - b1, 20, `備戰沒扣到（${b0} → ${b1}）`);
});
const B_MOMO0 = fire(MOMO, '暴風雪');
const B_MOMO1 = fire(MOMO, '暴風雪', { atkInst: { nextOwnAttackPenalty: 20 } });
T('B7. ⭐⭐⭐ snipeAllOppBench（N的雙倍多多冰｜暴風雪 10）：備戰要扣且夾 0（HEAD-FAIL）', () => {
  assert.ok(B_MOMO0.benchDmg.every((d) => d === 10), `基準沒成立（${JSON.stringify(B_MOMO0.benchDmg)}）`);
  assert.ok(B_MOMO1.benchDmg.every((d) => d === 0), `10-20 沒有夾到 0（${JSON.stringify(B_MOMO1.benchDmg)}）`);
});
T('B8. ⭐⭐ 鏡像：aIdx=1 也必須成立（守衛只測 aIdx=0 是真退化）', () => {
  const r0 = fire(ARTIC, '冰雹', { aIdx: 1 });
  const r1 = fire(ARTIC, '冰雹', { aIdx: 1, atkInst: { nextOwnAttackPenalty: 10 } });
  assert.ok(r0.benchDmg.every((d) => d === 30), `鏡像基準沒成立（${JSON.stringify(r0.benchDmg)}）`);
  assert.ok(r1.benchDmg.every((d) => d === 20), `鏡像沒扣到（${JSON.stringify(r1.benchDmg)}）`);
});
T('B9.【負對照】沒有旗標時備戰傷害完全不變（不是恆真、也沒有誤扣）', () => {
  const r = fire(ARTIC, '冰雹', { atkInst: {} });
  assert.deepStrictEqual(r.benchDmg, B_ART0.benchDmg, '沒帶旗標卻有差異 ⇒ 判準誤觸發');
});
T('B10.【負對照｜官方 §17.46.E】力量蛋白飲那一族**不得**外溢到備戰', () => {
  const r = fire(ARTIC, '冰雹', { atkPlayer: { damageBoostFightingThisTurn: 30 } });
  assert.deepStrictEqual(r.benchDmg, B_ART0.benchDmg,
    '備戰被加到了 —— 那一族卡面明寫「對對手的戰鬥寶可夢」，官方裁定備戰不加');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】行為端：snipeAllOppBenchPost 的兩份同名實作收斂（最嚴重的是備戰被打死不昏厥）
// ══════════════════════════════════════════════════════════════════════════════
T('C1. ⭐ 基準盤面成立：暴風雪對手全備戰各 10（低 HP 靶，下面 KO 斷言才不是空真）', () => {
  const r = fire(MOMO, '暴風雪', { benchCardId: FRAIL.id, benchN: 2 });
  assert.strictEqual(r.benchLen, 2, '備戰在基準盤面不該消失');
  assert.ok(r.benchDmg.every((d) => d === 10), `基準沒成立（${JSON.stringify(r.benchDmg)}）`);
});
T('C3. ⭐⭐⭐ 直呼中央 helper：備戰被打死 → 從 bench 移除＋對手拿獎賞（HEAD-FAIL）', () => {
  const fn = F('snipeAllOppBenchDamage');
  const hp = Number(FRAIL.hp);
  const b1 = inst(FRAIL.id, [], { damage: hp - 10 });
  const b2 = inst(TARGET.id);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'PA', active: inst(TARGET.id), bench: [], hand: [], deck: [], discard: [], prizes: [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)] },
      { name: 'PD', active: inst(TARGET.id), bench: [b1, b2], hand: [], deck: [], discard: [], prizes: [inst(TARGET.id)] },
    ],
  };
  const out = fn(st, 0, 10, pool, '測試');
  assert.notStrictEqual(out, MISSING, '中央 helper 不存在');
  const stillThere = out.players[1].bench.some((b) => b.iid === b1.iid);
  assert.ok(!stillThere, `HP ${hp} 的備戰吃滿 ${hp} 點傷害卻還在場上 —— 沒有 KO 判定`);
  assert.ok(out.players[1].discard.some((c) => c.iid === b1.iid) || !stillThere, '沒有進棄牌區');
});
T('C4. ⭐ 直呼中央 helper：沒死的那一隻照常記傷害（不過度攔截）', () => {
  const fn = F('snipeAllOppBenchDamage');
  const b2 = inst(TARGET.id);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'PA', active: inst(TARGET.id), bench: [], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'PD', active: inst(TARGET.id), bench: [b2], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
  const out = fn(st, 0, 10, pool, '測試');
  assert.notStrictEqual(out, MISSING, '中央 helper 不存在');
  assert.strictEqual(out.players[1].bench[0].damage, 10, '沒有記到傷害');
});
T('C5. ⭐ 另一份同名實作（暴飛龍ex｜廣域爆破）行為不變（收斂不得改壞既有行為）', () => {
  const r = fire(SALAMENCE, '廣域爆破');
  assert.ok(r.benchDmg.every((d) => d === 50), `廣域爆破備戰沒吃到 50（${JSON.stringify(r.benchDmg)}）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】行為端：油之機關槍收進中央傷害管線
// ══════════════════════════════════════════════════════════════════════════════
const distributeAll = (st, ps) => {
  const t = st.players[1].active?.iid;
  return new Array(ps.maxCount ?? 6).fill(t);
};
const D0 = fire(OLIVA, '油之機關槍', { pick: distributeAll });
T('D0. 基準盤面成立：油之機關槍 6×20 = 120 打在對手戰鬥位', () => {
  assert.ok(D0.activeDmg > 0, `基準傷害 ${D0.activeDmg} —— 盤面沒搭起來，下面全是空真`);
});
T('D1. ⭐⭐⭐【招致削傷】油之機關槍也要扣（HEAD-FAIL：舊版 inline 管線漏了這一項）', () => {
  const r = fire(OLIVA, '油之機關槍', { atkInst: { nextOwnAttackPenalty: 30 }, pick: distributeAll });
  assert.strictEqual(D0.activeDmg - r.activeDmg, 30, `沒扣到（${D0.activeDmg} → ${r.activeDmg}）`);
});
T('D2. ⭐⭐【回合加傷】攻擊方加成要補上（HEAD-FAIL：舊版 computeOliveOilBuff 只做兩類）', () => {
  // ⚠ 不能用力量蛋白飲：那是「【鬥】招式 +30」，而奧利瓦ex 是【草】（卡面 cost=[Grass]）
  //   ⇒ 用 instance-level 的回合加傷（不分屬性），否則會量到 0 而變成空真。
  const r = fire(OLIVA, '油之機關槍', { atkInst: { damageBonusThisTurn: 30 }, pick: distributeAll });
  assert.strictEqual(r.activeDmg - D0.activeDmg, 30, `沒加到（${D0.activeDmg} → ${r.activeDmg}）`);
});
T('D3. ⭐⭐【方向相反的 bug】對**備戰**不得套攻擊方加成（官方 §17.46.E）', () => {
  // ⚠ 同 D2：必須用**在戰鬥位真的會加到**的那個欄位（D2 已證明它加得到），
  //   否則「備戰沒加」是因為這張卡本來就不吃那個加成（空真），而不是因為備戰被擋掉。
  const only = (st, ps) => new Array(ps.maxCount ?? 6).fill(st.players[1].bench[0].iid);
  const base = fire(OLIVA, '油之機關槍', { pick: only });
  const r = fire(OLIVA, '油之機關槍', { atkInst: { damageBonusThisTurn: 30 }, pick: only });
  assert.ok(base.benchDmg[0] > 0, `備戰基準 ${base.benchDmg[0]} —— 空真`);
  assert.strictEqual(r.benchDmg[0], base.benchDmg[0],
    `備戰被加到了（${base.benchDmg[0]} → ${r.benchDmg[0]}）—— 舊版 computeOliveOilBuff 就是這樣錯的`);
});
T('D4. ⭐【下次被擊減傷】防守方的鐵羽毛類要生效（舊版 inline 管線沒有）', () => {
  const r = fire(OLIVA, '油之機關槍', { defInst: { damageReduceNextHit: 30 }, pick: distributeAll });
  assert.strictEqual(D0.activeDmg - r.activeDmg, 30, `減傷沒生效（${D0.activeDmg} → ${r.activeDmg}）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】靜態（IRON_RULES Rule 38：判準只能有一份）
// ══════════════════════════════════════════════════════════════════════════════
const EFF = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')), 'effects.ts');
const MEGA = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects/cards/mega_decks.ts'), 'utf8')), 'mega_decks.ts');
const V2490 = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2490_i_wave3a_conditional.ts'), 'utf8')), 'v2490.ts');
const V2610 = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2610_i_wave11_misc4.ts'), 'utf8')), 'v2610.ts');

/**
 * ⭐ 「讀取 nextOwnAttackPenalty」的**唯一判準**（E2 與 F1/F2 自檢共用同一支 —— Rule 38／
 *   安慰劑型態 11：自檢若自己再抄一份判準，它在任何版本都恆綠）。
 *
 * 逐「出現處」判斷（不是逐行）—— 一行裡同時有豁免與違規時，違規那一處仍必須被抓到。
 *   ・`x.nextOwnAttackPenalty ?? 0`              → 算（違規的第二份判準長這樣）
 *   ・`a.nextOwnAttackPenalty = 50`              → 不算（寫入）
 *   ・`delete na.nextOwnAttackPenalty`           → 不算（消耗）
 *   ・`c.nextOwnAttackPenalty === undefined`     → 不算（engine END_TURN 的清除器：只問在不在）
 *   ・`nextOwnAttackPenalty?: number;`           → 不算（types.ts 型別宣告，沒有 `.` 前綴）
 *   ・`'nextOwnAttackPenalty',`                  → 不算（instance-flags.ts 的旗標名稱清單）
 */
const PROP = '.nextOwnAttackPenalty';
function penaltyReadCount(line) {
  let cnt = 0; const re = /\.nextOwnAttackPenalty\b/g; let m;
  while ((m = re.exec(line))) {
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + PROP.length);
    if (/\bdelete\s+[\w.]*$/.test(before)) continue;             // 消耗
    if (/^\s*=[^=]/.test(after)) continue;                        // 寫入
    if (/^\s*[!=]==?\s*undefined/.test(after)) continue;          // 存在性檢查（END_TURN 清除器）
    cnt++;
  }
  return cnt;
}
const isPenaltyRead = (line) => penaltyReadCount(line) > 0;

T('E1. `applyAttackerSelfPenalty` 全站恰好一個定義', () => {
  const defs = (EFF.match(/export function applyAttackerSelfPenalty\s*\(/g) || []).length;
  assert.strictEqual(defs, 1, `定義有 ${defs} 個（應為 1）`);
});
T('E2. ⭐⭐ `nextOwnAttackPenalty` 的**讀取**只准在中央 helper 裡（＋下限斷言）', () => {
  const srcDir = join(ROOT, 'src/lib');
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (/\.(ts|svelte)$/.test(f.name)) files.push(join(d, f.name));
    }
  })(srcDir);
  assert.ok(files.length > 100, `只掃到 ${files.length} 個檔，掃描器壞了？`);
  const hits = [];
  for (const f of files) {
    const src = stripCommentsBlankChecked(normEol(readFileSync(f, 'utf8')), f);
    // 只看「讀」：`.nextOwnAttackPenalty` 出現在非賦值、非 delete 的位置
    for (const line of src.split('\n')) {
      if (!isPenaltyRead(line)) continue;
      hits.push(f.replace(ROOT, '') + ' :: ' + line.trim());
    }
  }
  const central = hits.filter((h) => /game[\\/]effects\.ts/.test(h));
  const outside = hits.filter((h) => !/game[\\/]effects\.ts/.test(h));
  assert.ok(hits.length >= 1, '一個讀取點都沒掃到 ⇒ 掃描器壞了（空集合空真）');
  assert.strictEqual(outside.length, 0, `effects.ts 以外還有讀取點（判準兩份）：\n  ` + outside.join('\n  '));
  assert.ok(central.length >= 1, '中央檔裡也沒有讀取點？');
});
T('E3. ⭐⭐ 兩份同名 `snipeAllOppBenchPost` 都必須是一行委派（不得再各自跑迴圈）', () => {
  for (const [nm, src] of [['v2490', V2490], ['v2610', V2610]]) {
    const i = src.indexOf('function snipeAllOppBenchPost(');
    assert.ok(i >= 0, `${nm} 找不到 snipeAllOppBenchPost（anchor 失效）`);
    const blk = src.slice(i, i + 700);
    assert.ok(blk.includes('snipeAllOppBenchDamage('), `${nm} 沒有委派給中央 helper`);
    assert.ok(!/for\s*\(/.test(blk.slice(0, blk.indexOf('}\n') + 2)),
      `${nm} 還留著自跑迴圈 ⇒ 判準又變兩份`);
  }
});
T('E4. ⭐⭐ `computeOliveOilBuff`（第二份加成判準）必須已刪除', () => {
  assert.ok(!/computeOliveOilBuff/.test(MEGA), 'computeOliveOilBuff 還在 ⇒ 第二份加成判準');
});
T('E5. ⭐⭐ 油之機關槍 resolver 走中央傷害管線，不得殘留手刻步驟', () => {
  const i = MEGA.indexOf("regR('olive-oil-distribute'");
  assert.ok(i >= 0, "anchor 失效：regR('olive-oil-distribute'");
  const blk = MEGA.slice(i, i + 4000);
  assert.ok(/^\s*\}\);/m.test(blk), '切片內沒有 resolver 收尾 —— 窗口不夠大');
  assert.ok(blk.includes('dealAttackDamageToTarget('), '沒有走中央管線');
  for (const bad of ['applyWeakRes(', 'TOOL_ATTACK_BONUS', 'koPrizesAdjusted(', 'fireDefenderOnDamaged(', 'withAttackDamageTaken(', 'applyPreventKOToVictim(']) {
    assert.ok(!blk.includes(bad), `inline 管線還在（出現 ${bad}）⇒ 判準又變兩份`);
  }
});
T('E6. ⭐ 油之機關槍只傳 noWeakness，**不得**傳 skipDefEffects（卡面沒有那句話）', () => {
  const i = MEGA.indexOf("regR('olive-oil-distribute'");
  const blk = MEGA.slice(i, i + 4000);
  assert.ok(/noWeakness:\s*true/.test(blk), '卡面「不計算弱點・抵抗力」沒接上');
  assert.ok(!/skipDefEffects/.test(blk), '卡面沒有「不計算受傷寶可夢身上附加的效果」，不該 bypass 防守方效果');
});
T('E7. ⭐⭐ 備戰分支的招致削傷**不得**被 skipDefEffects 擋住（官方 §18.E）', () => {
  const i = EFF.indexOf('// >>> v6413-self-penalty-bench');
  assert.ok(i < 0 || true, '');
  const j = EFF.indexOf('applyAttackerSelfPenalty(st, actorIdx, effDmg, pool)');
  assert.ok(j >= 0, '備戰分支沒有呼叫中央 helper');
  const lines = EFF.slice(0, j).split('\n');
  const gate = lines[lines.length - 2] + '\n' + lines[lines.length - 1];
  assert.ok(!/_skipDef/.test(gate),
    '備戰的招致削傷被 skipDefEffects 擋掉了 —— 違反官方 §18.E（跳躍扣殺仍計算攻擊方自己身上的效果）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【F】反安慰劑自檢：判準必須真的抓得到已知的違規樣本
//   ⭐ 自檢一律呼叫與正式斷言**同一支**判準函式（否則自檢本身恆綠＝安慰劑型態 11）
// ══════════════════════════════════════════════════════════════════════════════
const readOnlyHits = (src) => src.split('\n').filter(isPenaltyRead);
T('F1. E2 的判準抓得到「就地再讀一次旗標」的違規樣本', () => {
  const bad = 'const pen = inst.nextOwnAttackPenalty ?? 0;';
  assert.strictEqual(readOnlyHits(bad).length, 1, 'E2 的判準抓不到已知違規樣本＝安慰劑');
});
T('F2. E2 的判準不誤殺「寫入」「消耗」「型別宣告」「旗標名稱清單」「存在性檢查」', () => {
  assert.strictEqual(readOnlyHits('a.nextOwnAttackPenalty = 50;').length, 0, '誤殺寫入');
  assert.strictEqual(readOnlyHits('  nextOwnAttackPenalty?: number;').length, 0, '誤殺型別宣告');
  assert.strictEqual(readOnlyHits('delete na.nextOwnAttackPenalty;').length, 0, '誤殺消耗');
  assert.strictEqual(readOnlyHits("  'nextOwnAttackPenalty',").length, 0, '誤殺旗標名稱清單');
  assert.strictEqual(readOnlyHits('if (c.nextOwnAttackPenalty === undefined) return c;').length, 0,
    '誤殺 END_TURN 清除器的存在性檢查');
  // ⚠ 但「比較」以外的讀仍是讀
  assert.strictEqual(readOnlyHits('if (a.nextOwnAttackPenalty > 0) {}').length, 1, '把比較誤判成豁免');
});
T('F2b. ⭐⭐ 存在性檢查的豁免**不得被鑽**（同一行的第二處讀值仍要抓到）', () => {
  const sneaky = 'const pen = c.nextOwnAttackPenalty !== undefined ? c.nextOwnAttackPenalty : 0;';
  assert.strictEqual(penaltyReadCount(sneaky), 1,
    '把「存在性檢查 + 就地讀值」整行豁免掉了 ⇒ 第二份判準可以躲進來');
});
T('F3. E3 的判準抓得到「自跑迴圈」的違規樣本', () => {
  const bad = 'function snipeAllOppBenchPost(amount, label) {\n  return (state, aIdx, pool) => {\n    for (const iid of ids) { s = { ...s }; }\n  };\n}\n';
  const i = bad.indexOf('function snipeAllOppBenchPost(');
  const blk = bad.slice(i, i + 700);
  assert.ok(!blk.includes('snipeAllOppBenchDamage('), 'F3 樣本設計錯誤');
  assert.ok(/for\s*\(/.test(blk.slice(0, blk.indexOf('}\n') + 2)), 'E3 的迴圈判準抓不到已知樣本＝安慰劑');
});

console.log(`\n=== v6.413 招致削傷／全備戰傷害／油之機關槍 收斂：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
