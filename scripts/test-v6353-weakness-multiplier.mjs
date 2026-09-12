#!/usr/bin/env node
/**
 * v6.353 守衛：弱點**倍率**參數化 + 甜甜螢｜絕佳費洛蒙（M6a 004/103）
 *
 * 卡面逐字（static/cards/M6a.json，id 19916 的 `abilities[].effect`）：
 *   「若自己的場上有「電螢蟲」則生效。只要這隻寶可夢在場上，
 *     雙方的戰鬥寶可夢的弱點以「×3」計算傷害。」
 *
 * ⭐ 全部**行為端**：真的建盤面 → 跑 ATTACK → 看盤面上的 damage 數字。
 *   被動特性沒有 handler，所以「registry 有沒有 key」完全不能當覆蓋率（Rule 33）。
 * ⭐ 每一條效果斷言都配哨兵：同一盤面的對照組數字必須是「未套用時的值」，
 *   證明差異真的來自這個特性，而不是招式根本沒跑（付不出費用 ⇒ ATTACK 靜默 return ⇒ 假綠）。
 * ⚠ 禁止恆真斷言：每一條都能被 __m6a/mutcheck_v6353.mjs 的某一個突變打紅。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6353-s.js'), E = join(ROOT, '.v6353-e.ts'), O = join(ROOT, '.v6353-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, createGame, getUsableAbilities, getEffectiveAttacks } from './src/lib/game/engine';\n"
  + "export { weaknessMultiplier, WEAKNESS_MULTIPLIER_ABILITIES, WEAKNESS_MULTIPLIER_DEFAULT, applyWeakRes } from './src/lib/game/effects';\n"
  + "export { estimateAttackDamage } from './src/lib/game/damage-estimate';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getUsableAbilities, weaknessMultiplier,
  WEAKNESS_MULTIPLIER_ABILITIES, WEAKNESS_MULTIPLIER_DEFAULT, applyWeakRes, estimateAttackDamage } = M;

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('fixture 找不到 id ' + id); return c; };

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [],
  abilityNamesUsedThisTurn: [], ...o,
});
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P(p0), P(p1)], ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const act = (st, a) => {
  const orig = Math.random; Math.random = () => 0.1;
  try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: [] }; }
  finally { Math.random = orig; }
};
const atkIndexOf = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const energyForCost = (card, atkName) =>
  ((card.attacks || []).find((a) => a.name === atkName)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ── fixtures ────────────────────────────────────────────────────────────────
const ILLUM  = byId(19916);                 // 甜甜螢（M6a 004/103）— 唯一有「絕佳費洛蒙」的印刷
const VOL_M  = byId(19915);                 // 電螢蟲（M6a 003/103）
const VOL_SV = byId(10418);                 // 電螢蟲（SV6）— 卡面只寫卡名 ⇒ 另一種印刷也算
const UXIE   = byId(20056);                 // 由克希（M6a）— 全站唯一「+20」型弱點
const ARTI   = all.find((c) => String(c.setCode) === 'M6a' && c.name === '急凍鳥'
  && (c.attacks || []).some((a) => a.name === '冰雹'));   // 【水】；冰雹 = 對手全體各 30
const okBasic = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶');
/** 弱點【水】×2、HP≥120（吃 90 不昏厥） */
const WEAK_W = all.find((c) => okBasic(c) && c.weakness?.type === 'Water' && c.weakness?.value === '×2' && Number(c.hp) >= 120);
/** 弱點【草】×2、HP≥120 */
const WEAK_G = all.find((c) => okBasic(c) && c.weakness?.type === 'Grass' && c.weakness?.value === '×2' && Number(c.hp) >= 120);
/** 無弱點無抵抗力、HP≥120 —— 哨兵用（證明「×2」不是憑空冒出來的） */
const NEUT   = all.find((c) => okBasic(c) && !c.weakness && !c.resistance && Number(c.hp) >= 120);
/** 乾淨的【無】屬性對照靶 */
const PLAIN  = all.find((c) => okBasic(c) && Number(c.hp) >= 80 && c.pokemonType === 'Colorless');

const SIDE = (o) => ({ deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), ...o });
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;

/** P0 的急凍鳥用「冰雹」打 P1（對手全體各 30；戰鬥場走 mainline、備戰走中央 helper）。 */
const hail = (p0Bench, p1Active, p1Bench, p1ActExtra = {}) => {
  const st = mk(
    SIDE({ active: inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') }), bench: p0Bench.map((c) => inst(c.id)) }),
    SIDE({ active: inst(p1Active.id, p1ActExtra), bench: p1Bench.map((c) => inst(c.id)) }));
  return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
};
/** 鏡像：P1 的急凍鳥用「冰雹」打 P0（用來驗卡面的「**雙方**」）。 */
const hailRev = (p0Active, p0Bench, p1Bench = []) => {
  const st = mk(
    SIDE({ active: inst(p0Active.id), bench: p0Bench.map((c) => inst(c.id)) }),
    SIDE({ active: inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') }), bench: p1Bench.map((c) => inst(c.id)) }),
    { activePlayerIndex: 1 });
  return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
};
/** P0 的甜甜螢自己用「衝撞」(30【草】) 打 P1 戰鬥場 —— 驗「持有者在戰鬥場」。 */
const bodySlam = (p0Bench, p1Active, illumExtra = {}) => {
  const st = mk(
    SIDE({ active: inst(ILLUM.id, { energyAttached: energyForCost(ILLUM, '衝撞'), ...illumExtra }),
      bench: p0Bench.map((c) => inst(c.id)) }),
    SIDE({ active: inst(p1Active.id) }));
  return { st, r: act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ILLUM, '衝撞') }) };
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('【0】harness 自驗（掃描器／樣本先驗，Rule 25）');
{
  chk('0a 卡池載入（> 4000 張）', pool.size > 4000, String(pool.size));
  chk('0b 抓得到 M6a 甜甜螢／電螢蟲／急凍鳥／由克希',
    ILLUM?.name === '甜甜螢' && VOL_M?.name === '電螢蟲' && ARTI?.name === '急凍鳥' && UXIE?.name === '由克希',
    [ILLUM?.name, VOL_M?.name, ARTI?.name, UXIE?.name].join(','));
  chk('0c 兩張電螢蟲是不同印刷（M6a / SV6）', String(VOL_M.id) !== String(VOL_SV.id) && VOL_SV.name === '電螢蟲');
  chk(`0d 靶齊備：WEAK_W=${WEAK_W?.name} / WEAK_G=${WEAK_G?.name} / NEUT=${NEUT?.name} / PLAIN=${PLAIN?.name}`,
    !!WEAK_W && !!WEAK_G && !!NEUT && !!PLAIN);
  chk('0e 急凍鳥是【水】、甜甜螢是【草】（弱點比對的前提）',
    ARTI.pokemonType === 'Water' && ILLUM.pokemonType === 'Grass');
  chk('0f 基本能量 id 都查到', ['Grass', 'Water', 'Colorless'].every((k) => EID[k]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C1】卡面逐字錨：中央表的 face 必須逐字等於 static/cards 的 abilities[].effect');
{
  const spec = WEAKNESS_MULTIPLIER_ABILITIES.find((s) => s.ability === '絕佳費洛蒙');
  const face = (ILLUM.abilities || []).find((a) => a.name === '絕佳費洛蒙')?.effect;
  chk('C1a 中央表有「絕佳費洛蒙」這一列', !!spec);
  chk('C1b 卡面逐字相符', !!spec && spec.face === face, String(face));
  chk('C1c 倍率是卡面寫的 ×3', spec?.multiplier === 3, String(spec?.multiplier));
  chk('C1d 前提逐字是「電螢蟲」', JSON.stringify(spec?.requiresOwnOnField) === JSON.stringify(['電螢蟲']),
    JSON.stringify(spec?.requiresOwnOnField));
  chk('C1e 預設倍率是 2（PTCG_RULES.md L155）', WEAKNESS_MULTIPLIER_DEFAULT === 2, String(WEAKNESS_MULTIPLIER_DEFAULT));
  chk('C1f ⭐反安慰劑：絕佳費洛蒙是**被動**特性，不會出現在 getUsableAbilities',
    !getUsableAbilities(mk(SIDE({ active: inst(ILLUM.id), bench: [inst(VOL_M.id)] }), SIDE({ active: inst(PLAIN.id) })), pool)
      .some((u) => u.abilityName === '絕佳費洛蒙'));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】基準：沒有甜甜螢時，弱點仍然 ×2');
{
  const r = hail([PLAIN], WEAK_W, [PLAIN]);
  const n = hail([PLAIN], NEUT, [PLAIN]);
  chk('A0 哨兵：招式真的跑了 —— 中性靶（無弱點）吃到冰雹的基礎 30',
    D0(n)?.damage === 30, String(D0(n)?.damage));
  chk(`A1 ⭐基準：${WEAK_W.name} 對【水】是弱點 ⇒ 30 ×2 = 60`,
    D0(r)?.damage === 60, String(D0(r)?.damage));
  chk('A2 哨兵：中央述詞在這個盤面回傳的就是預設值 2',
    weaknessMultiplier(mk(SIDE({ active: inst(ARTI.id) }), SIDE({ active: inst(WEAK_W.id) })), 1, pool, WEAK_W) === 2);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 甜甜螢＋電螢蟲都在**自己備戰** ⇒ 對手戰鬥寶可夢的弱點變 ×3');
{
  const ctl = hail([PLAIN, PLAIN], WEAK_W, [PLAIN]);
  const phe = hail([ILLUM, VOL_M], WEAK_W, [PLAIN]);
  chk('B0 哨兵：對照組（自己備戰是兩張無特性卡）仍是 ×2 = 60',
    D0(ctl)?.damage === 60, String(D0(ctl)?.damage));
  chk('B1 哨兵：甜甜螢與電螢蟲真的在自己備戰（兩隻都在、都沒受傷）',
    phe.players[0].bench.length === 2
    && phe.players[0].bench.map((b) => pool.get(b.cardId).name).join(',') === '甜甜螢,電螢蟲'
    && phe.players[0].bench.every((b) => b.damage === 0),
    JSON.stringify(phe.players[0].bench.map((b) => pool.get(b.cardId).name + ':' + b.damage)));
  chk('B2 ⭐⭐行為端：對手戰鬥寶可夢 30 ×3 = 90',
    D0(phe)?.damage === 90, String(D0(phe)?.damage));
  chk('B3 哨兵：同一盤面的中性靶（沒有【水】弱點）**不受影響**，仍是 30',
    D0(hail([ILLUM, VOL_M], NEUT, [PLAIN]))?.damage === 30,
    String(D0(hail([ILLUM, VOL_M], NEUT, [PLAIN]))?.damage));
  // 卡面只寫卡名 ⇒ 另一種印刷的電螢蟲也算
  chk('B4 ⭐印刷無關：換成 SV6 的電螢蟲，一樣 ×3 = 90',
    D0(hail([ILLUM, VOL_SV], WEAK_W, [PLAIN]))?.damage === 90,
    String(D0(hail([ILLUM, VOL_SV], WEAK_W, [PLAIN]))?.damage));
  // 持有者在**對手**備戰時，對手自己的戰鬥寶可夢照樣 ×3（卡面「雙方」的另一半）
  chk('B5 ⭐持有者在對手側備戰 ⇒ 對手自己的戰鬥寶可夢一樣 ×3 = 90',
    D0(hail([PLAIN], WEAK_W, [ILLUM, VOL_M]))?.damage === 90,
    String(D0(hail([PLAIN], WEAK_W, [ILLUM, VOL_M]))?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐反對照：卡面前提「自己的場上有『電螢蟲』」不成立 ⇒ 仍然 ×2');
{
  chk('C2 只有甜甜螢、沒有電螢蟲 ⇒ 60',
    D0(hail([ILLUM, PLAIN], WEAK_W, [PLAIN]))?.damage === 60,
    String(D0(hail([ILLUM, PLAIN], WEAK_W, [PLAIN]))?.damage));
  chk('C3 只有電螢蟲、沒有甜甜螢 ⇒ 60',
    D0(hail([VOL_M, PLAIN], WEAK_W, [PLAIN]))?.damage === 60,
    String(D0(hail([VOL_M, PLAIN], WEAK_W, [PLAIN]))?.damage));
  // ⭐ 卡面「**自己**的場上」＝ 持有者那一側；電螢蟲在對面不算
  chk('C4 ⭐⭐主詞對照：甜甜螢在自己備戰、電螢蟲在**對手**場上 ⇒ 前提不成立，仍是 60',
    D0(hail([ILLUM, PLAIN], WEAK_W, [VOL_M]))?.damage === 60,
    String(D0(hail([ILLUM, PLAIN], WEAK_W, [VOL_M]))?.damage));
  chk('C5 哨兵：C4 那個盤面裡電螢蟲真的在對手備戰（吃了冰雹的 30）',
    (() => { const r = hail([ILLUM, PLAIN], WEAK_W, [VOL_M]);
      return r.players[1].bench.length === 1 && pool.get(r.players[1].bench[0].cardId).name === '電螢蟲'
        && r.players[1].bench[0].damage === 30; })());
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐ 卡面「**雙方**的戰鬥寶可夢」：甜甜螢在 A 方，A 方自己的戰鬥寶可夢被 B 打也 ×3');
{
  const ctl = hailRev(WEAK_W, [PLAIN, PLAIN]);
  const phe = hailRev(WEAK_W, [ILLUM, VOL_M]);
  chk('D0 哨兵：鏡像方向的招式真的跑了（對照組 = ×2 的 60）',
    A0(ctl)?.damage === 60, String(A0(ctl)?.damage));
  chk('D1 ⭐⭐行為端：持有者與受招者同一側 ⇒ 自己的戰鬥寶可夢也 30 ×3 = 90',
    A0(phe)?.damage === 90, String(A0(phe)?.damage));
  chk('D2 哨兵：甜甜螢與電螢蟲真的在被打的那一側備戰（各吃了 30）',
    phe.players[0].bench.length === 2 && phe.players[0].bench.every((b) => b.damage === 30),
    JSON.stringify(phe.players[0].bench.map((b) => b.damage)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐ 甜甜螢在**戰鬥場**也生效（卡面「只要這隻寶可夢在場上」）');
{
  const ctl = bodySlam([PLAIN], WEAK_G).r;      // 甜甜螢在戰鬥場但場上沒有電螢蟲
  const phe = bodySlam([VOL_M], WEAK_G).r;      // 甜甜螢在戰鬥場 + 電螢蟲在備戰
  chk('E0 哨兵：衝撞真的打出去了 —— 沒有電螢蟲時 30 ×2 = 60',
    D0(ctl)?.damage === 60, String(D0(ctl)?.damage));
  chk('E1 ⭐行為端：持有者在戰鬥場 ⇒ 30 ×3 = 90',
    D0(phe)?.damage === 90, String(D0(phe)?.damage));
  chk('E2 哨兵：中性靶在同一盤面仍是 30（差異真的來自弱點那一項）',
    D0(bodySlam([VOL_M], NEUT).r)?.damage === 30, String(D0(bodySlam([VOL_M], NEUT).r)?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】⭐ 特性被消除 ⇒ 回到 ×2');
{
  // ⚠ 甜甜螢 = Basic /【草】/ 非規則寶可夢 ⇒ 傳說的熔岩洞（消進化）、火箭隊的監視塔（消【無】）、
  //   鐵荊棘ex｜初始化（消規則寶可夢）、海兔獸｜黏著束縛（消備戰 2 階）**全都打不到它**。
  //   站上唯一對它有效的消除來源是「招式版暗夜羽擊」的 `abilityNullifiedThisTurn`
  //   （中央閘 isAbilityHolderEffective step 1，只對 **active** 位置的持有者生效）。
  const nul = bodySlam([VOL_M], WEAK_G, { abilityNullifiedThisTurn: true }).r;
  chk('F1 ⭐行為端：戰鬥場的甜甜螢特性被消除 ⇒ 回到 30 ×2 = 60',
    D0(nul)?.damage === 60, String(D0(nul)?.damage));
  chk('F2 哨兵：同一盤面沒有那個旗標時是 90（證明 F1 的差異來自消除，不是招式沒跑）',
    D0(bodySlam([VOL_M], WEAK_G).r)?.damage === 90);
  // ⭐位置對照：站上既有規則 —— 招式版暗夜羽擊只標記 active；備戰持有者不受它影響。
  chk('F3 ⭐位置對照：同一個旗標掛在**備戰**的甜甜螢上不生效（中央閘 step 1 只看 active）⇒ 仍是 90',
    (() => {
      const st = mk(
        SIDE({ active: inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') }),
          bench: [inst(ILLUM.id, { abilityNullifiedThisTurn: true }), inst(VOL_M.id)] }),
        SIDE({ active: inst(WEAK_W.id) }));
      return D0(act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') }))?.damage === 90;
    })());
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】⭐ 備戰被狙擊時**不算**弱點（不論有沒有甜甜螢）—— 證明 ① 沒有誤擴散');
{
  const ctl = hail([PLAIN, PLAIN], WEAK_W, [WEAK_W]);
  const phe = hail([ILLUM, VOL_M], WEAK_W, [WEAK_W]);
  chk('G0 哨兵：同一次冰雹，對手**戰鬥場**的同一張卡確實吃了弱點（60 / 90）',
    D0(ctl)?.damage === 60 && D0(phe)?.damage === 90,
    JSON.stringify([D0(ctl)?.damage, D0(phe)?.damage]));
  chk('G1 ⭐無甜甜螢：備戰的同一張卡只吃基礎 30（不是 60）',
    ctl.players[1].bench[0]?.damage === 30, String(ctl.players[1].bench[0]?.damage));
  chk('G2 ⭐⭐有甜甜螢：備戰的同一張卡**仍然**只吃 30（不是 90）—— 卡面只寫「戰鬥寶可夢」',
    phe.players[1].bench[0]?.damage === 30, String(phe.players[1].bench[0]?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【H】⭐ 傷害預估與實際傷害一致（UI 顯示的數字不可以跟實打不同）');
{
  for (const [tag, bench, want] of [['無甜甜螢', [PLAIN], 60], ['有甜甜螢＋電螢蟲', [VOL_M], 90]]) {
    const { st } = bodySlam(bench, WEAK_G);
    const est = estimateAttackDamage(st, atkIndexOf(ILLUM, '衝撞'), pool, 0);
    const real = act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ILLUM, '衝撞') });
    const actual = real.lastDealtDamage ?? 0;
    chk(`H1 ${tag}：預估 ${est.kind === 'exact' ? est.value : est.kind} === 實打 ${actual} === ${want}`,
      est.kind === 'exact' && est.value === actual && actual === want);
    const wk = (est.terms || []).find((t) => t.label === '弱點');
    chk(`H2 ${tag}：預估公式裡的「弱點」項是 ×${want / 30}（公式：${est.formula || '(無)'}）`,
      !!wk && wk.sign === '×' && wk.value === want / 30, JSON.stringify(wk));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【J】⭐ 倍率改寫與**弱點屬性**改寫正交可疊加（官方裁定 PTCG_RULES.md L1945／L2100）');
{
  // 鐮刀盔｜遠古真理「×4」＋ 掌握弱點／妖精領域（改屬性）⇒ 官方答「仍按 ×4 計算」。
  // 站上用同型的 weaknessOverrideTypeThisTurn（掌握弱點／覆蓋伏特）驗同一件事。
  const ovr = (bench) => {
    const st = mk(
      SIDE({ active: inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') }), bench: bench.map((c) => inst(c.id)) }),
      SIDE({ active: inst(NEUT.id, { weaknessOverrideTypeThisTurn: 'Water' }) }));
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
  };
  chk('J1 哨兵：本無弱點的靶被改寫成【水】弱點後，沒有甜甜螢時是 30 ×2 = 60',
    D0(ovr([PLAIN, PLAIN]))?.damage === 60, String(D0(ovr([PLAIN, PLAIN]))?.damage));
  chk('J2 ⭐⭐疊加：屬性被改寫 ＋ 絕佳費洛蒙 ⇒ 30 ×3 = 90',
    D0(ovr([ILLUM, VOL_M]))?.damage === 90, String(D0(ovr([ILLUM, VOL_M]))?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【K】⚠ 待站長裁示：「+N」型弱點（由克希 M6a 20056「+20」）維持原樣，不吃 ×3');
{
  // 全站 4170 筆 weakness 只有這 1 筆是「+20」；引擎從來沒讀過 weakness.value（一律當 ×2）。
  // 卡面說的是「弱點以『×3』計算」，官方對「+N」型**查無裁定** ⇒ 本版只改寫「×N」型。
  chk('K0 哨兵：由克希的弱點值真的是「+20」（卡面若改版這裡會紅）',
    UXIE.weakness?.value === '+20' && UXIE.weakness?.type === 'Psychic', JSON.stringify(UXIE.weakness));
  const ux = (bench) => {
    const st = mk(
      SIDE({ active: inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') }), bench: bench.map((c) => inst(c.id)) }),
      SIDE({ active: inst(UXIE.id, { weaknessOverrideTypeThisTurn: 'Water' }) }));
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
  };
  chk('K1 哨兵：沒有甜甜螢時由克希吃 30 ×2 = 60（站上既有行為：+N 被當成 ×2）',
    D0(ux([PLAIN, PLAIN]))?.damage === 60, String(D0(ux([PLAIN, PLAIN]))?.damage));
  chk('K2 ⭐有甜甜螢＋電螢蟲時**仍然**是 60（不是 90）—— 「+N」型不被改寫',
    D0(ux([ILLUM, VOL_M]))?.damage === 60, String(D0(ux([ILLUM, VOL_M]))?.damage));
  chk('K3 哨兵：同一盤面換成「×2」型的靶就是 90（證明 K2 不是因為特性沒生效）',
    D0(ovrX2())?.damage === 90, String(D0(ovrX2())?.damage));
  function ovrX2() {
    const st = mk(
      SIDE({ active: inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') }), bench: [inst(ILLUM.id), inst(VOL_M.id)] }),
      SIDE({ active: inst(WEAK_W.id) }));
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
  }
  chk('K4 述詞層：weaknessMultiplier 對「+N」型直接回預設 2、對「×2」型回 3',
    (() => {
      const st = mk(SIDE({ active: inst(ARTI.id), bench: [inst(ILLUM.id), inst(VOL_M.id)] }), SIDE({ active: inst(WEAK_W.id) }));
      return weaknessMultiplier(st, 1, pool, UXIE) === 2 && weaknessMultiplier(st, 1, pool, WEAK_W) === 3;
    })());
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【I】⭐ 中央性：全站沒有第二份「弱點倍率」，消費點數量釘死');
{
  const readSrc = (p) => readFileSync(join(ROOT, p), 'utf8');
  const ENG = readSrc('src/lib/game/engine.ts');
  const EFF = readSrc('src/lib/game/effects.ts');
  const countAll = (re) => {
    let n = 0;
    for (const f of walk(join(ROOT, 'src'))) {
      const t = readFileSync(f, 'utf8');
      n += (t.match(re) || []).length;
    }
    return n;
  };
  function* walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (/\.(ts|svelte)$/.test(e.name)) yield p;
    }
  }
  // ① 硬寫的「弱點 ×2」公式項：全站 0 處
  chk('I1 ⭐全站沒有任何硬寫的「×2(弱點)」公式項',
    countAll(/value:\s*2\s*,\s*label:\s*'弱點'/g) === 0,
    String(countAll(/value:\s*2\s*,\s*label:\s*'弱點'/g)));
  // ② 兩個消費點的硬寫倍率都不見了
  chk('I2 ⭐engine 主管線不再硬寫 `baseDamage *= 2`', !/baseDamage \*= 2;/.test(ENG));
  chk('I3 ⭐applyWeakRes 不再硬寫 `d *= 2`', !/\bd \*= 2;/.test(EFF));
  // ③ 呼叫點數量釘死：engine 1 處、effects 1 處（＋定義 1 處）
  const engCalls = (ENG.match(/weaknessMultiplier\(/g) || []).length;
  const effCalls = (EFF.match(/weaknessMultiplier\(/g) || []).length;
  chk(`I4 ⭐engine.ts 的 weaknessMultiplier( 恰好 1 處（實得 ${engCalls}）`, engCalls === 1);
  chk(`I5 ⭐effects.ts 的 weaknessMultiplier( 恰好 2 處＝定義 1＋消費 1（實得 ${effCalls}）`, effCalls === 2);
  chk('I6 ⭐全站 weaknessMultiplier( 出現次數 = 3（定義 1 + 消費 2），沒有第四個地方自己算',
    countAll(/weaknessMultiplier\(/g) === 3, String(countAll(/weaknessMultiplier\(/g)));
  // ④ 中央表只有一列（新增卡時這一條會提醒你連守衛一起補）
  chk('I7 中央表 WEAKNESS_MULTIPLIER_ABILITIES 目前恰好 1 列',
    WEAKNESS_MULTIPLIER_ABILITIES.length === 1, String(WEAKNESS_MULTIPLIER_ABILITIES.length));
  // ⑤ 兩個消費點真的共用同一份：applyWeakRes（狙擊管線）與主管線在同一盤面得到同一個倍率
  const stShared = mk(SIDE({ active: inst(ARTI.id), bench: [inst(ILLUM.id), inst(VOL_M.id)] }), SIDE({ active: inst(WEAK_W.id) }));
  chk('I8 ⭐⭐applyWeakRes（狙擊/多目標管線）同樣吃到 ×3：50 → 150',
    applyWeakRes(stShared, 0, stShared.players[1].active, WEAK_W, 50, pool) === 150,
    String(applyWeakRes(stShared, 0, stShared.players[1].active, WEAK_W, 50, pool)));
  const stPlain = mk(SIDE({ active: inst(ARTI.id), bench: [inst(PLAIN.id), inst(PLAIN.id)] }), SIDE({ active: inst(WEAK_W.id) }));
  chk('I9 哨兵：同一支 applyWeakRes 在沒有甜甜螢時是 50 → 100',
    applyWeakRes(stPlain, 0, stPlain.players[1].active, WEAK_W, 50, pool) === 100,
    String(applyWeakRes(stPlain, 0, stPlain.players[1].active, WEAK_W, 50, pool)));
}

console.log(`\nv6.353 弱點倍率參數化 + 甜甜螢｜絕佳費洛蒙：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
