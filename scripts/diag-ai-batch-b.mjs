// AI 對戰強化 批次 B：三條純診斷掃描（不進 CI，不動 src/，只產清單）。
//
//   B1 印刷傷害欄位不是純數字（空字串、30×、120+ 等）的招式：
//      AI 的 scoreOfAttack 是走引擎實打（evaluateAttack），還是回落到 estimateDamage 的欄位估值？
//      回落條件（ai.ts）＝ `!ev.ok || ev.unresolved`；回落值＝ parseInt(damage) || 0（暗黑底牌另有特例）。
//      ⇒ 風險＝「試打會開選擇視窗（unresolved）」且欄位估值 0 或只有底數 的招式。
//   B2 「在下個自己的回合，…無法使用招式」類限制：實作掛在哪一種機制、換到備戰時會不會被清除。
//      依據：PTCG RULES/PTCG_RULES.md 第 1518 行（烈火爆進：換到備戰再撤退回場 ⇒ 可以使用）。
//   B3 AI 在「所有可用招式都打不出傷害」時仍送出 ATTACK 的比例（實戰模擬量測）。
//      ⚠ 判準用平均值 oppDamage／prizes，不用 dealt（evaluateAttack 的 dealt 是最後一次試打的值）。
//
// 用法：node scripts/diag-ai-batch-b.mjs [--games-per-pair 4] [--out 報告.md]
//   報告預設寫到 stdout；--out 另存 markdown。
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import {
  buildAiBundle, loadLivePool, playGame, seeded, pct, firstPlayerOf,
} from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const GAMES_PER_PAIR = Number(arg('--games-per-pair', 4));
const OUT = arg('--out', null);

const mod = await buildAiBundle(ROOT, { extraExports: [
  "export { evaluateAttack, estimateIfPromoted, isPointlessAttack } from './src/lib/game/ai-eval';",
  "export { computeActiveRetreatCostFor } from './src/lib/game/engine';",
  "export { CLEAR_ON_EXIT_FLAGS } from './src/lib/game/instance-flags';",
] });
const pool = loadLivePool(ROOT);
const HIJ = new Set(['H', 'I', 'J']);
const report = [];
const P = (s = '') => { report.push(s); };

// ─────────────────────────────────────────────────────────────────────────────
// 共用：合成盤面（我方戰鬥位＝受測卡、能量剛好付得起、雙方各 2 隻備戰）
// ─────────────────────────────────────────────────────────────────────────────
const BASIC_ENERGY = { Grass: '14102', Psychic: '14103', Fighting: '14104', Fire: '14428',
  Darkness: '14430', Metal: '14434', Water: '18519', Lightning: '18520' };
const FILLER = '17038';              // 卡比獸（基礎、無特性、160 HP）：對手戰鬥位與雙方備戰
let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'd' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => inst(cid);
const baseGame = () => mod.createGame({ name: 'P1', entries: [{ cardId: FILLER, count: 1 }] },
  { name: 'P2', entries: [{ cardId: FILLER, count: 1 }] }, pool);
function energiesFor(cost) {
  return (cost ?? []).map((t) => en(BASIC_ENERGY[t] ?? BASIC_ENERGY.Psychic));
}
function probeState(card, atk, extraEnergy = 0) {
  const s = baseGame();
  const e = energiesFor(atk.cost);
  for (let i = 0; i < extraEnergy; i++) e.push(en(BASIC_ENERGY.Psychic));
  const mix = () => [en(BASIC_ENERGY.Fire), inst(FILLER), en(BASIC_ENERGY.Water), inst(FILLER), en(BASIC_ENERGY.Psychic)];
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s.players[0], hand: mix(), deck: [...mix(), ...mix()], discard: mix(),
        prizes: Array.from({ length: 6 }, () => inst(FILLER)),
        active: inst(card.id, e), bench: [inst(FILLER, [en(BASIC_ENERGY.Psychic)]), inst(FILLER)],
        energyAttachedThisTurn: true },
      { ...s.players[1], hand: mix(), deck: [...mix(), ...mix()], discard: mix(),
        prizes: Array.from({ length: 6 }, () => inst(FILLER)),
        active: inst(FILLER), bench: [inst(FILLER), inst(FILLER)] }] };
}
/** 在固定亂數下執行 fn，結束後還原 Math.random（不干擾外面的亂數序列）。 */
function withSeed(seed, fn) {
  const orig = Math.random; Math.random = seeded(seed);
  try { return fn(); } finally { Math.random = orig; }
}

// 枚舉 live H/I/J 寶可夢的招式（同名同招同文字只取一張印刷）
const uniq = new Map();
for (const c of pool.values()) {
  if (c.supertype !== 'Pokemon' || !HIJ.has(c.regulationMark)) continue;
  (c.attacks ?? []).forEach((a, i) => {
    const k = `${c.name}|${a.name}|${a.effect ?? ''}|${a.damage ?? ''}`;
    if (!uniq.has(k)) uniq.set(k, { card: c, atk: a, idx: i });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// B1
// ─────────────────────────────────────────────────────────────────────────────
const isPureNumber = (d) => /^\d+$/.test(String(d ?? '').trim());
const b1 = [];
for (const { card, atk, idx } of uniq.values()) {
  const dmg = String(atk.damage ?? '').trim();
  if (isPureNumber(dmg)) continue;
  const st = probeState(card, atk);
  const avail = mod.getAvailableAttacks(st, pool);
  const fallback = parseInt(dmg, 10) || 0;
  let row = { name: card.name, atk: atk.name, dmg, fallback, text: (atk.effect ?? '').replace(/\s+/g, ''),
    avail: avail.includes(idx), ok: null, unresolved: null, oppDamage: null };
  if (row.avail) {
    const ev = withSeed(4242, () => mod.evaluateAttack(st, 0, idx, pool));
    Object.assign(row, { ok: ev.ok, unresolved: ev.unresolved, oppDamage: ev.oppDamage });
  }
  // 路徑：引擎實打＝ ok && !unresolved；其餘＝回落欄位估值
  row.path = row.avail && row.ok && !row.unresolved ? 'engine' : (row.avail ? 'fallback' : 'probe-unusable');
  // 風險：走回落、卡面有「傷害」、而回落值是 0（或是 × 招式只剩底數）
  row.risk = row.path === 'fallback' && /傷害/.test(row.text) && (fallback === 0 || /×/.test(dmg));
  b1.push(row);
}
const b1by = (p) => b1.filter((r) => r.path === p);
P('## B1 印刷傷害非純數字的招式：AI 走哪條路徑');
P(`- live H/I/J 不重複招式共 ${uniq.size} 個；傷害欄非純數字 ${b1.length} 個。`);
P(`- 引擎實打（ok 且未開選擇視窗）：${b1by('engine').length}　回落欄位估值：${b1by('fallback').length}　`
  + `合成盤面打不出（條件不符，實戰才判）：${b1by('probe-unusable').length}`);
P(`- ⚠ 風險（回落＋卡面有傷害＋估值 0 或 × 只剩底數）：${b1.filter((r) => r.risk).length}`);
P('');
// 內建預組裡出現的卡名（AI 實際會駕駛到的）
const presetNames = new Set();
for (const d of mod.PRESET_DECKS) for (const e of d.entries) { const c = pool.get(String(e.cardId)); if (c) presetNames.add(c.name); }
const riskRows = b1.filter((x) => x.risk).sort((a, b) => (presetNames.has(b.name) - presetNames.has(a.name)) || a.name.localeCompare(b.name));
P(`- 其中出現在 56 副內建預組裡的：${riskRows.filter((r) => presetNames.has(r.name)).length} 個（排在表格最前面）`);
P('');
P('| 卡 | 招式 | 在預組 | 傷害欄 | 回落估值 | 卡面 |');
P('|---|---|---|---|---|---|');
for (const r of riskRows) {
  P(`| ${r.name} | ${r.atk} | ${presetNames.has(r.name) ? '⭐是' : ''} | \`${r.dmg || '空'}\` | ${r.fallback} | ${r.text.slice(0, 70)} |`);
}
P('');
P('<details><summary>全部回落欄位估值的招式（含無風險者）</summary>');
P('');
for (const r of b1by('fallback')) P(`- ${r.name}｜${r.atk}（\`${r.dmg || '空'}\` → 估 ${r.fallback}）${r.unresolved ? ' 開選擇視窗' : ' 試打失敗'}`);
P('</details>');
P('');

// ─────────────────────────────────────────────────────────────────────────────
// B2
// ─────────────────────────────────────────────────────────────────────────────
const CLEAR = new Set(mod.CLEAR_ON_EXIT_FLAGS);
const b2 = [];
for (const { card, atk, idx } of uniq.values()) {
  const t = (atk.effect ?? '').replace(/‌/g, '');
  // ⚠ fable 審查：卡面有兩種寫法 ——「無法使用招式」（全部招式）與「無法使用「X」」（單招）；初版只掃前者，漏了 26 張
  const next = /下個自己的回合/.test(t) && /無法使用(招式|「)/.test(t);
  const lastSelf = /上個自己的回合/.test(t) && /無法使用這個招式/.test(t);
  if (!next && !lastSelf) continue;
  const scope = lastSelf ? '玩家層級冷卻（自己的寶可夢使出了「X」）'
    : (/自己的所有寶可夢無法使用招式/.test(t) ? '自己全場（所有寶可夢）' : '這隻寶可夢');
  const coin = /擲\d次硬幣/.test(t);
  // 試打（擲幣型最多試 12 個 seed，找一次有觸發限制的）
  let row = { name: card.name, atk: atk.name, scope, coin, mech: '未觸發', cleared: null, blockedNext: null };
  for (let seed = 1; seed <= (coin ? 12 : 1); seed++) {
    const st = probeState(card, atk, 2);   // 多給 2 顆能量：讓撤退付得起
    if (!mod.getAvailableAttacks(st, pool).includes(idx)) { row.mech = '合成盤面無法使用'; break; }
    const res = withSeed(seed, () => driveAfterAttack(st, idx));
    if (!res) { row.mech = '推進失敗'; break; }
    const { atkState, myTurn, attackerIid } = res;
    const me0 = atkState.players[0];
    const a0 = [me0.active, ...me0.bench].find((c) => c?.iid === attackerIid);
    const flags = [];
    if (a0?.cantAttackPending) flags.push('cantAttackPending');
    if (a0?.blockedAttackNamesNextTurn?.length) flags.push('blockedAttackNamesNextTurn');
    if (me0.noAttacksNextTurn || me0.noAttacksPending) flags.push('玩家旗標(noAttacks*)');
    if (a0?.attackUsedThisTurn === atk.name || a0?.attackUsedLastSelfTurn === atk.name) {
      if (lastSelf) flags.push('attackUsedLastSelfTurn(玩家層級冷卻)');
    }
    // 也把玩家物件上新增的欄位列出來（找其他玩家層級機制）
    const pBefore = new Set(Object.keys(st.players[0]));
    for (const k of Object.keys(me0)) if (!pBefore.has(k) && /attack|Attack/.test(k)) flags.push('玩家新欄位:' + k);
    if (!flags.length) continue;
    row.mech = flags.join('＋');
    if (myTurn) {
      // 下個自己的回合：限制是否生效（戰鬥位若還是牠）
      //   listed＝getAvailableAttacks 還列不列為可用（UI 按鈕與 AI 候選都讀它）
      //   engineBlocks＝真的送 ATTACK 時引擎擋不擋（回合沒結束、沒造成傷害）
      const act = myTurn.players[0].active;
      if (act?.iid === attackerIid) {
        row.listedNext = mod.getAvailableAttacks(myTurn, pool).includes(idx);
        const tryAtk = withSeed(5, () => mod.applyAction(myTurn, { type: 'ATTACK', attackIndex: idx }, pool));
        // 擋下的判準：引擎原樣退回，或最後一則 log 是「無法使用」且對手戰鬥位沒有受傷
        //   ⚠ 不能用「回合有沒有結束」判：cantAttackThisTurn 的擋法是寫 log＋turnPhase:'end'（engine.ts 約 5381 行）
        const lastMsg = String(tryAtk.log?.[tryAtk.log.length - 1]?.message ?? '');
        row.engineBlocks = tryAtk === myTurn || (/無法使用/.test(lastMsg)
          && tryAtk.players[1].active?.damage === myTurn.players[1].active?.damage);
        row.blockedNext = !row.listedNext && row.engineBlocks;
      }
      // 撤退到備戰 ⇒ 牠身上的限制旗標要被清掉（官方 L1518）
      const b = myTurn.players[0].bench[0];
      if (act?.iid === attackerIid && b) {
        let rt = mod.applyAction(myTurn, { type: 'RETREAT', newActiveIid: b.iid }, pool);
        // 撤退會開選擇視窗（多屬性能量要選丟哪幾個）⇒ 交給 AI 選完，才看得到實體真的搬到備戰
        for (let k = 0; k < 10 && rt !== myTurn && rt.pendingSelection; k++) {
          const a2 = mod.aiNew(rt, pool, rt.pendingSelection.actorIdx); if (!a2) break;
          rt = mod.applyAction(rt, a2, pool);
        }
        if (rt !== myTurn) {
          const moved = rt.players[0].bench.find((c) => c.iid === attackerIid);
          row.cleared = moved ? !(moved.cantAttackThisTurn || moved.cantAttackPending || moved.blockedAttackNamesThisTurn?.length) : null;
          if (lastSelf) row.cleared = null;   // 玩家層級冷卻本來就不隨離場清（卡面主詞是「自己的寶可夢」）
        }
      }
    }
    // 靜態：旗標在不在「離場清除」清單
    //   只對「這隻寶可夢」的實體旗標有意義；玩家層級冷卻／玩家旗標刻意不在清單內 ⇒ 記「—」（初版誤印「是」）
    const instFlags = flags.filter((f) => /^[a-zA-Z]+$/.test(f));
    row.inClearList = scope === '這隻寶可夢' && instFlags.length ? instFlags.every((f) => CLEAR.has(f)) : null;
    break;
  }
  // 判定：主詞「這隻寶可夢」⇒ 必須是跟著實體、離場清除的旗標；任何一種都必須「下回合列表也不列、引擎也擋」
  let okMech;
  if (scope === '這隻寶可夢') okMech = (row.mech.includes('cantAttackPending') || row.mech.includes('blockedAttackNamesNextTurn')) && row.inClearList !== false;
  else if (scope.startsWith('玩家層級')) okMech = row.mech.includes('玩家層級');
  else okMech = row.mech.includes('玩家');
  row.verdict = okMech && row.blockedNext !== false ? '✅' : '⚠';
  b2.push(row);
}
/** 我方打出招式 → 對手回合什麼都不做 → 回到我方主階段。回傳攻擊後盤面與下個自己回合的盤面。 */
function driveAfterAttack(st0, idx) {
  const attackerIid = st0.players[0].active.iid;
  let st = mod.applyAction(st0, { type: 'ATTACK', attackIndex: idx }, pool);
  if (st === st0) return null;
  let atkState = null;
  for (let i = 0; i < 400; i++) {
    if (st.phase === 'game-over') return { atkState: atkState ?? st, myTurn: null, attackerIid };
    if (!atkState && st.activePlayerIndex === 1) atkState = st;
    if (st.pendingSelection) { const a = mod.aiNew(st, pool, st.pendingSelection.actorIdx); if (!a) return null; st = mod.applyAction(st, a, pool); continue; }
    if (st.players[0].active === null || st.players[1].active === null) {
      const who = st.players[0].active === null ? 0 : 1;
      const a = mod.aiNew(st, pool, who); if (!a) return null; st = mod.applyAction(st, a, pool); continue;
    }
    if (st.activePlayerIndex === 1 && st.turnPhase === 'main') { st = mod.applyAction(st, { type: 'END_TURN' }, pool); continue; }
    if (st.activePlayerIndex === 0 && st.turnPhase === 'main' && atkState) return { atkState, myTurn: st, attackerIid };
    const a = mod.aiNew(st, pool, st.activePlayerIndex); if (!a) return null;
    const nx = mod.applyAction(st, a, pool); if (nx === st) return null; st = nx;
  }
  return null;
}
P('## B2「下個自己的回合無法使用招式」類限制：機制與離場清除');
P(`- 依據：PTCG_RULES.md 第 1518 行（換到備戰再撤退回場 ⇒ 可以使用）。live H/I/J 共 ${b2.length} 個招式。`);
const bad2 = b2.filter((r) => r.verdict !== '✅');
P(`- ⚠ 需要人工看的：${bad2.length} 個（主詞與機制對不上，或合成盤面沒觸發）`);
P('');
P('- 欄位：「下回合仍列為可用」＝ getAvailableAttacks（UI 按鈕與 AI 候選）還列不列；「引擎擋下」＝真的送出時引擎擋不擋；');
P('  「撤退實測清除」＝實際撤退到備戰後旗標是否消失（撤退沒有完成、或玩家層級不適用時為 —）；「在離場清除清單」＝實體旗標在 CLEAR_ON_EXIT_FLAGS（靜態；玩家層級為 —）。');
P('');
P('| 卡 | 招式 | 卡面主詞 | 實作機制 | 下回合仍列為可用 | 引擎擋下 | 撤退實測清除 | 在離場清除清單 | 判定 |');
P('|---|---|---|---|---|---|---|---|---|');
const yn = (v) => (v == null ? '—' : (v ? '是' : '否'));
for (const r of [...bad2, ...b2.filter((x) => x.verdict === '✅')]) {
  P(`| ${r.name} | ${r.atk}${r.coin ? '（擲幣）' : ''} | ${r.scope} | ${r.mech} | ${r.listedNext ? '**是**' : yn(r.listedNext)} | ${yn(r.engineBlocks)} | ${yn(r.cleared)} | ${yn(r.inClearList)} | ${r.verdict} |`);
}
P('');

// ─────────────────────────────────────────────────────────────────────────────
// B3 實戰模擬：「全部招式都打不出傷害」時 AI 仍送 ATTACK 的比例
// ─────────────────────────────────────────────────────────────────────────────
// 側效果／「打不動」判定：v6.430 起一律用 ai-eval 的中央 isPointlessAttack 與 AttackEval.sideEffectKeys
//   （原型曾寫在這裡；判準只能有一份，IRON_RULES Rule 38）。
const presets = mod.PRESET_DECKS;
const b3 = { decisions: 0, allZero: 0, allZeroAttack: 0, allZeroNoSide: 0, allZeroNoSideAttack: 0,
  retreatWouldFire: 0, randomExcluded: 0, retreatActual: 0, endTurnActual: 0, byDeck: new Map(), sideKinds: new Map(), examples: new Map(), games: 0 };
function makeObserver(deckName) {
  return (st, idx) => {
    const act = mod.aiNew(st, pool, idx);
    if (!act || st.phase !== 'playing' || st.pendingSelection || st.activePlayerIndex !== idx
        || st.turnPhase !== 'main' || !st.players[idx].active) return act;
    const atks = mod.getAvailableAttacks(st, pool);
    // 分母＝「這回合的收尾決定」（攻擊／撤退／結束回合），而且當下有招可用
    //   ⚠ fable 審查：初版只在 act === ATTACK 時才計 ⇒ 再問「其中送 ATTACK 的比例」恆 100%，量不到 AI。
    if (!atks.length || !['ATTACK', 'RETREAT', 'END_TURN'].includes(act.type)) return act;
    b3.decisions++;
    const evs = atks.map((i) => ({ i, ev: mod.evaluateAttack(st, idx, i, pool) }));
    const zero = evs.every(({ ev }) => ev.ok && !ev.unresolved && !ev.ko && ev.prizes === 0 && ev.oppDamage === 0);
    if (!zero) return act;
    b3.allZero++;
    if (act.type === 'ATTACK') b3.allZeroAttack++;
    const d = b3.byDeck.get(deckName) ?? { zero: 0, noSide: 0 }; d.zero++;
    for (const { ev } of evs) for (const k of ev.sideEffectKeys) b3.sideKinds.set(k, (b3.sideKinds.get(k) ?? 0) + 1);
    if (evs.some(({ ev }) => ev.usedRandom)) b3.randomExcluded++;
    if (evs.every(({ ev }) => mod.isPointlessAttack(ev))) {
      b3.allZeroNoSide++; d.noSide++;
      // 範例：我方戰鬥位｜可用招式 → 對手戰鬥位（看得出是對手免疫、還是招式本身就打不動）
      const me0 = st.players[idx], op0 = st.players[1 - idx];
      const eff = mod.getEffectiveAttacks(st, me0.active, pool);
      const key = `${pool.get(me0.active.cardId)?.name}｜${atks.map((i) => eff[i]?.atk?.name).join('／')} → ${pool.get(op0.active?.cardId)?.name ?? '無'}`;
      b3.examples.set(key, (b3.examples.get(key) ?? 0) + 1);
      if (act.type === 'ATTACK') b3.allZeroNoSideAttack++;
      else if (act.type === 'RETREAT') b3.retreatActual++;
      else if (act.type === 'END_TURN') b3.endTurnActual++;
      // 批次 C 若擋下 ATTACK，會落到撤退分支：預估撤退分支是否成立（撤退費 ≤ 2、換上去能擊倒或傷害 ≥ 門檻）
      const me = st.players[idx];
      if (mod.canRetreat(st, pool) && me.bench.length) {
        const cost = mod.computeActiveRetreatCostFor(st, idx, pool);
        const minGain = cost === 0 ? 1 : 60;
        if (cost <= 2 && me.bench.some((b) => { const o = mod.estimateIfPromoted(st, idx, b, pool); return o.ok && (o.ko || o.dealt >= minGain); })) b3.retreatWouldFire++;
      }
    }
    b3.byDeck.set(deckName, d);
    return act;
  };
}
const t0 = Date.now();
for (let a = 0; a < presets.length; a++) {
  for (const off of [1, 7, 19]) {   // 每副牌對 3 副不同的預組
    const b = (a + off) % presets.length;
    for (let g = 0; g < GAMES_PER_PAIR; g++) {
      const seat = g % 2;
      const decks = seat === 0 ? [presets[a], presets[b]] : [presets[b], presets[a]];
      const agents = seat === 0
        ? [makeObserver(presets[a].name), makeObserver(presets[b].name)]
        : [makeObserver(presets[b].name), makeObserver(presets[a].name)];
      const seed = 31337 + a * 1009 + off * 97 + g;
      playGame({ mod, pool, decks, agents, seed, firstPlayer: firstPlayerOf(seed) });
      b3.games++;
    }
  }
}
P('## B3 所有可用招式都打不出傷害時，AI 仍送出 ATTACK 的比例');
P(`- 模擬：56 副預組 × 3 個對手 × ${GAMES_PER_PAIR} 局 = ${b3.games} 局（${((Date.now() - t0) / 1000).toFixed(0)} 秒）。`);
P('- 判準：每一招都 `ok && !unresolved && !ko && prizes === 0 && oppDamage === 0`（平均值，不用 dealt）。');
P(`- 有招可用時的收尾決定（攻擊／撤退／結束回合）：${b3.decisions}；其中「全部招式零傷害」：${b3.allZero}（${pct(b3.decisions ? b3.allZero / b3.decisions : NaN)}）`);
P(`- ⭐ B3 比例＝全零時仍送 ATTACK：${b3.allZeroAttack} / ${b3.allZero} = ${pct(b3.allZero ? b3.allZeroAttack / b3.allZero : NaN)}`
  + '（v6.430 之前攻擊分支只要有招可發就一定 return ATTACK，結構上必然是 100%；v6.430 起只有「零傷害但有其他效果或用到亂數」的才會出招）');
P(`- 再排除「有其他盤面效果」與「用到亂數」的（中央 isPointlessAttack，v6.430）：${b3.allZeroNoSide} 次 ⇒ 批次 C 會擋下的範圍`
  + `（其中因用到亂數而不擋：全零決策點裡 ${b3.randomExcluded} 次）`);
P(`- ⭐ 批次 C 驗收：「打不動」時 AI 仍送 ATTACK：${b3.allZeroNoSideAttack} / ${b3.allZeroNoSide}（v6.430 之後應為 0）；`
  + `實際撤退 ${b3.retreatActual} 次、結束回合 ${b3.endTurnActual} 次（撤退分支預估會成立：${b3.retreatWouldFire} 次）`);
P('');
P('側效果種類（零傷害招式在試打前後有變化的欄位；次數）：' + ([...b3.sideKinds].map(([k, v]) => `${k} ${v}`).join('、') || '無'));
P('');
P('全零且無側效果的盤面（我方戰鬥位｜可用招式 → 對手戰鬥位；前 25 名）：');
P('');
for (const [k, v] of [...b3.examples].sort((x, y) => y[1] - x[1]).slice(0, 25)) P(`- ${k}：${v} 次`);
P('');
P('| 牌組（該側） | 全零決策點 | 其中無側效果 |');
P('|---|---|---|');
for (const [k, v] of [...b3.byDeck].sort((x, y) => y[1].zero - x[1].zero).slice(0, 20)) P(`| ${k} | ${v.zero} | ${v.noSide} |`);
P('');

const text = report.join('\n');
console.log(text);
if (OUT) { writeFileSync(OUT, text); console.error(`\n報告已存：${OUT}`); }
