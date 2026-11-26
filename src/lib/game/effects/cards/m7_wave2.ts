/**
 * v6.672 M7「波導探求者」招式實裝 —— 批次 2（新機制或卡面與既有卡不完全相同的招式）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M7.json`（台灣官方中文），未經簡化。
 * ⚠ 能共用中央管線的一律共用（Rule 38），每一招旁註明照的是哪一張同型卡。
 * ⚠ 傷害以卡面為準：純數字的交給引擎讀卡面；「N+」「N×」「N-」要改寫傷害的才寫 regPre。
 */

import {
  regPost, regPre, regR, addLog, withPending, updatePlayer, shuffle, joinCardNames,
  countSpecialConditions, mandatoryTargetCount, getAllAttachedTools, ATTACK_PRE_DISCARD_CHOICE,
  dispatchCopiedAttack, copyAttackPostDispatch, getOwnBenchLimit,
} from '../_shared';
import {
  countOwnPokemon, hitBenchAllForCard, dealAttackDamageToTarget, discardStadiumPost,
  registerHandRevealAttack, registerSelfDiscardMultiply, discardOppActiveEnergyPost,
  selfSwapPost, snipeOneOppBenchPost, preDiscardEnergyEligible, queueAttackEnergyPayment,
} from '../../effects';
import { computeActiveRetreatCostFor, getEffectiveHP, isBasicEnergyOfType } from '../../engine';
import { isBasicPokemonCard, isBasicPokemonOnField, isMegaExCard } from '../../selection-filter';
import { copyAttackCandidates, copyAttackCooldownNote, pickCopiedAttack } from '../../copy-attack';
import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';

const oppOf = (aIdx: 0 | 1) => (1 - aIdx) as 0 | 1;

// ══════════════════════════════════════════════════════════════════════════════
// ① 計數傷害
// ══════════════════════════════════════════════════════════════════════════════
// 008 蜥蜴王ex｜刺殺利刃 160+：增加對手的戰鬥寶可夢處於特殊狀態的數量×50點傷害。
//   ⚠ 特殊狀態有三槽（status／secondary／tertiary）⇒ 走中央 countSpecialConditions（同 搖籃百合｜瘴氣之風）。
regPre('蜥蜴王ex|刺殺利刃', (state, aIdx) => {
  const n = countSpecialConditions(state.players[oppOf(aIdx)].active);
  const dmg = 160 + n * 50;
  return { state: addLog(state, `刺殺利刃：對手戰鬥寶可夢特殊狀態 ${n} 種 → 160 + ${n}×50 = ${dmg}`, aIdx), damage: dmg };
});

// 011 敏捷蟲｜忍者劈斬 50×：造成對手的場上的進化寶可夢的數量×50點傷害。
//   「進化寶可夢」＝場上的 1 階／2 階進化（場上的化石算基礎，不算進化）。
regPre('敏捷蟲|忍者劈斬', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, oppOf(aIdx), pool, (c, inst) =>
    !isBasicPokemonOnField(inst, c) && (c.stage === 'Stage1' || c.stage === 'Stage2'));
  return { state: addLog(state, `忍者劈斬：對手場上進化寶可夢 ${n} 隻 → ${n * 50}`, aIdx), damage: n * 50 };
});

// 058 騎士蝸牛｜騎兵突刺 50×：造成對手的場上的【基礎】寶可夢的數量×50點傷害。
//   ⚠ 場上視角 ⇒ 中央 isBasicPokemonOnField（化石算基礎，同 投擲猴｜聯合投擲）。
regPre('騎士蝸牛|騎兵突刺', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, oppOf(aIdx), pool, (c, inst) => isBasicPokemonOnField(inst, c));
  return { state: addLog(state, `騎兵突刺：對手場上【基礎】寶可夢 ${n} 隻 → ${n * 50}`, aIdx), damage: n * 50 };
});

// 033 智揮猩｜賢者的指令 60×：造成自己的備戰區的「超級進化寶可夢【ex】」的數量×60點傷害。
regPre('智揮猩|賢者的指令', (state, aIdx, pool) => {
  const n = state.players[aIdx].bench.filter(b => isMegaExCard(pool.get(b.cardId))).length;
  return { state: addLog(state, `賢者的指令：自己備戰區超級進化寶可夢ex ${n} 隻 → ${n * 60}`, aIdx), damage: n * 60 };
});

// 067 超級烈咬陸鯊Zex｜烈龍復仇者 30×：造成自己的棄牌區的【龍】寶可夢卡的張數×30點傷害。
regPre('超級烈咬陸鯊Zex|烈龍復仇者', (state, aIdx, pool) => {
  const n = state.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.pokemonType === 'Dragon';
  }).length;
  return { state: addLog(state, `烈龍復仇者：自己棄牌區【龍】寶可夢卡 ${n} 張 → ${n * 30}`, aIdx), damage: n * 30 };
});

// 056 大嘴娃｜大顎攻擊 30×：造成對手的手牌的張數×30點傷害。（同 水晶燈火靈｜意志統治者）
regPre('大嘴娃|大顎攻擊', (state, aIdx) => {
  const n = state.players[oppOf(aIdx)].hand.length;
  return { state: addLog(state, `大顎攻擊：對手手牌 ${n} 張 → ${n * 30}`, aIdx), damage: n * 30 };
});

// 055 古鼎鹿｜重磅衝撞 250-：減少對手的戰鬥寶可夢【撤退】所需的能量的數量×50點傷害。
//   ⚠ 撤退費用「有效值」（含各種增減）⇒ 中央 computeActiveRetreatCostFor（同 鐵包袱｜瞬風衝激）。
regPre('古鼎鹿|重磅衝撞', (state, aIdx, pool) => {
  const r = computeActiveRetreatCostFor(state, oppOf(aIdx), pool);
  const dmg = Math.max(0, 250 - r * 50);
  return { state: addLog(state, `重磅衝撞：對手撤退所需能量 ${r} 個 → 250 − ${r}×50 = ${dmg}`, aIdx), damage: dmg };
});

// 024 布土撥｜進擊伏特 50+：若對手的戰鬥寶可夢身上附有「寶可夢道具」卡，則增加80點傷害。（同 大朝北鼻｜進擊鐳射）
regPre('布土撥|進擊伏特', (state, aIdx) => {
  const def = state.players[oppOf(aIdx)].active;
  if (def && getAllAttachedTools(def).length > 0) {
    return { state: addLog(state, '進擊伏特：對手附有寶可夢道具 → +80', aIdx), damage: 130 };
  }
  return { state, damage: 50 };
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 牌庫丟棄 × 傷害
// ══════════════════════════════════════════════════════════════════════════════
// 036 布莉姆溫｜魔法觸手 100+：將雙方的牌庫上方各1張卡丟棄，增加其中訓練家卡的張數×100點傷害。
//   （同型：熔岩蝸牛ex｜大地灼燒「…其中能量卡的張數×140」—— PRE 算張數、POST 丟同兩張）
regPre('布莉姆溫|魔法觸手', (state, aIdx, pool) => {
  let n = 0;
  for (const idx of [aIdx, oppOf(aIdx)]) {
    const top = state.players[idx].deck[0];
    if (top && pool.get(top.cardId)?.supertype === 'Trainer') n++;
  }
  const dmg = 100 + n * 100;
  return { state: addLog(state, `魔法觸手：雙方牌庫上方各丟棄 1 張，其中訓練家卡 ${n} 張 → ${dmg}`, aIdx), damage: dmg };
});
regPost('布莉姆溫|魔法觸手', (state, aIdx, pool) => {
  const players = [...state.players] as GameState['players'];
  const milled: CardInstance[] = [];
  for (const idx of [aIdx, oppOf(aIdx)]) {
    const p = players[idx];
    if (p.deck.length === 0) continue;
    const top = p.deck[0];
    milled.push(top);
    players[idx] = { ...p, deck: p.deck.slice(1), discard: [...p.discard, top] };
  }
  if (milled.length === 0) return state;
  return addLog({ ...state, players }, `魔法觸手：雙方牌庫上方 1 張丟入棄牌區：${joinCardNames(milled, pool)}`, aIdx);
});

// 073 雷吉奇卡斯｜破壞捶擊 120+：若希望，將自己的牌庫上方最多10張卡丟棄，增加其張數×10點傷害。
//   ⚠ 玩家自己決定丟幾張（0～10）⇒ 出招前的數字選擇（與 波盪水｜蜿蜒割裂 同一個 stepper 介面），
//     payload 長度＝選的張數；牌庫不足時以牌庫張數為上限。
//   AI（沒傳選擇）：最多 10 張、但保留 3 張牌庫，避免把自己丟到抽不了牌而輸掉。
const DESTROY_HAMMER_KEY = '雷吉奇卡斯|破壞捶擊';
ATTACK_PRE_DISCARD_CHOICE.set(DESTROY_HAMMER_KEY, {
  min: 0, max: 10, scope: 'self-counter-stepper',
  baseDamage: 120, damagePerEnergy: 10,
  choicePrompt: '選擇要將自己的牌庫上方幾張卡丟棄（每張 +10 傷害；牌庫不足時以牌庫張數為上限）',
});
function destroyHammerCount(state: GameState, aIdx: 0 | 1, chosen: string[] | undefined): number {
  const deckN = state.players[aIdx].deck.length;
  const want = chosen === undefined ? Math.max(0, deckN - 3) : chosen.length;
  return Math.max(0, Math.min(10, want, deckN));
}
regPre(DESTROY_HAMMER_KEY, (state, aIdx, _pool, action) => {
  const n = destroyHammerCount(state, aIdx, action?.discardedEnergyIids);
  const dmg = 120 + n * 10;
  return { state: addLog(state, `破壞捶擊：選擇丟棄牌庫上方 ${n} 張 → 120 + ${n}×10 = ${dmg}`, aIdx), damage: dmg };
});
regPost(DESTROY_HAMMER_KEY, (state, aIdx, pool, action) => {
  const n = destroyHammerCount(state, aIdx, action?.discardedEnergyIids);
  if (n === 0) return state;
  const p = state.players[aIdx];
  const milled = p.deck.slice(0, n);
  return addLog(updatePlayer(state, aIdx, pl => ({ ...pl, deck: pl.deck.slice(n), discard: [...pl.discard, ...milled] })),
    `破壞捶擊：將自己的牌庫上方 ${milled.length} 張丟棄（${joinCardNames(milled, pool)}）`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 從手牌給對手看「吉憲的熱血」（中央 registerHandRevealAttack）
// ══════════════════════════════════════════════════════════════════════════════
// 018 沼王｜熱血頭擊 20+：若希望，從自己的手牌選擇1張「吉憲的熱血」，給對手看過。這個情況下，增加120點傷害。
registerHandRevealAttack({
  key: '沼王|熱血頭擊', label: '熱血頭擊',
  names: ['吉憲的熱血'], revealLabel: '「吉憲的熱血」',
  baseDamage: 20, max: 1,
  damageOf: (revealed) => 20 + (revealed.length > 0 ? 120 : 0),
  describe: (_r, dmg) => `20 + 120 = ${dmg} 傷害`,
  emptyText: '手牌中沒有「吉憲的熱血」',
});
// 020 浮潛鼬ex｜衝勁螺旋 40+：從自己的手牌將任意數量的「吉憲的熱血」給對手看過後，增加其張數×100點傷害。
//   然後，將給對手看過的「吉憲的熱血」放回牌庫並重洗。
const SURGE_KEY = '浮潛鼬ex|衝勁螺旋';
registerHandRevealAttack({
  key: SURGE_KEY, label: '衝勁螺旋',
  names: ['吉憲的熱血'], revealLabel: '「吉憲的熱血」',
  baseDamage: 40,
  damageOf: (revealed) => 40 + revealed.length * 100,
  describe: (r, dmg) => `40 + ${r.length}×100 = ${dmg} 傷害`,
  emptyText: '手牌中沒有「吉憲的熱血」',
});
regPost(SURGE_KEY, (state, aIdx, pool, action) => {
  const hand = state.players[aIdx].hand;
  const eligible = hand.filter(h => pool.get(h.cardId)?.name === '吉憲的熱血');
  const chosen = action?.discardedEnergyIids;
  // 與 PRE 同一條規則：玩家送了選擇就只認選的；沒送（AI）＝全部展示
  const shown = chosen === undefined ? eligible : eligible.filter(c => chosen.includes(c.iid));
  if (shown.length === 0) return state;
  const set = new Set(shown.map(c => c.iid));
  return addLog(updatePlayer(state, aIdx, p => ({ ...p, hand: p.hand.filter(c => !set.has(c.iid)), deck: shuffle([...p.deck, ...shown]) })),
    `衝勁螺旋：將給對手看過的「吉憲的熱血」${shown.length} 張放回牌庫並重洗`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 全體／分配／多目標
// ══════════════════════════════════════════════════════════════════════════════
// 021 幾何雪花｜冰雹：對手的所有寶可夢各受到20點傷害。[在備戰區不計算弱點・抵抗力。]
//   （同 急凍鳥｜冰雹 30：戰鬥場交給引擎主線、備戰走中央 hitBenchAllForCard）
regPre('幾何雪花|冰雹', (s) => ({ state: s, damage: 20 }));
regPost('幾何雪花|冰雹', (state, aIdx, pool) => hitBenchAllForCard(state, aIdx, oppOf(aIdx), 20, pool, '冰雹'));

// 029 恰雷姆｜瑜伽之力：將3個傷害指示物以任意方式放置於對手的寶可夢身上。
//   （同 來悲粗茶｜詛咒水滴「4個」：damage-distribute ＋ 共用 resolver，招式效果＝attack-effect）
regPost('恰雷姆|瑜伽之力', (state, aIdx) => {
  const opp = state.players[oppOf(aIdx)];
  if (!opp.active && opp.bench.length === 0) return state;
  return withPending(addLog(state, '瑜伽之力：將 3 個傷害指示物以任意方式放置於對手的寶可夢身上', aIdx), {
    type: 'damage-distribute', actorIdx: aIdx, sourcePlayerIdx: oppOf(aIdx),
    minCount: 3, maxCount: 3,
    effectKey: 'h-wave2-distribute-damage',
    params: { totalCounters: 3, target: 'opp', includeActive: true, label: '瑜伽之力' },
  });
});

// 054 超級晶光花ex｜毒晶寶石：在對手的2隻寶可夢身上放置傷害指示物直到各自的剩餘HP變為「60」為止。
//   ⚠ 放置傷害指示物＝招式效果（不是傷害，不計弱抗）⇒ 逐隻走 dealAttackDamageToTarget(kind:'attack-effect')，
//     與 恰雷姆ex｜氣功指壓「直到剩餘HP變為『50』」同一條算法（有效 HP − 60 − 已有傷害）。
//   ⚠ 「2隻」＝強制選滿（場上不足 2 隻就全選）⇒ 中央 mandatoryTargetCount。
regPost('超級晶光花ex|毒晶寶石', (state, aIdx) => {
  const opp = state.players[oppOf(aIdx)];
  const targets = [...(opp.active ? [opp.active.iid] : []), ...opp.bench.map(b => b.iid)];
  if (targets.length === 0) return state;
  const { minCount, maxCount } = mandatoryTargetCount(2, targets.length);
  return withPending(addLog(state, `毒晶寶石：選 ${maxCount} 隻對手寶可夢，放置傷害指示物直到剩餘 HP 為 60`, aIdx), {
    type: 'opp-poke-choose', actorIdx: aIdx, sourcePlayerIdx: oppOf(aIdx),
    minCount, maxCount,
    effectKey: 'm7-set-hp-to-60',
    params: { validIids: targets, label: '毒晶寶石', targetHP: 60 },
  });
});
regR('m7-set-hp-to-60', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string | undefined) ?? '毒晶寶石';
  const targetHP = (params?.targetHP as number | undefined) ?? 60;
  const valid = new Set((params?.validIids as string[] | undefined) ?? []);
  let s = state;
  for (const iid of [...new Set(iids)].filter(i => valid.has(i)).slice(0, 2)) {
    const d = s.players[oppOf(aIdx)];
    const inst = d.active?.iid === iid ? d.active : d.bench.find(b => b.iid === iid);
    if (!inst) continue;
    const name = pool.get(inst.cardId)?.name ?? '?';
    const need = getEffectiveHP(inst, pool, s) - targetHP - inst.damage;
    if (need <= 0) { s = addLog(s, `${label}：${name} 剩餘 HP 已在 ${targetHP} 以下，無效`, aIdx); continue; }
    s = addLog(s, `${label}：${name} 放置傷害指示物 +${need}（剩餘 HP ${targetHP}，招式效果非傷害）`, aIdx);
    s = dealAttackDamageToTarget(s, aIdx, iid, need, pool, { kind: 'attack-effect', label });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// 022 花舞鳥｜歡迎舞：查看對手的手牌，從其中選擇最多3張【基礎】寶可夢卡，放置於對手的備戰區。
//   （同型特性：莉莉艾的蝶結萌虻｜邀請眨眼「任意數量」⇒ 共用放置 resolver，張數上限 3 由 params 帶入）
//   ⚠ 查看對手手牌＝攻擊方看得到整副手牌（hand-choose，sourcePlayer＝對手）；公開 log 只寫張數。
regPost('花舞鳥|歡迎舞', (state, aIdx, pool) => {
  const oIdx = oppOf(aIdx);
  const opp = state.players[oIdx];
  if (opp.hand.length === 0) return addLog(state, '歡迎舞：對手手牌為空', aIdx);
  const cands = opp.hand.filter(c => isBasicPokemonCard(pool.get(c.cardId)));   // 手牌裡的卡 ⇒ 中央 isBasicPokemonCard（不是場上視角）
  const room = getOwnBenchLimit(state, oIdx, pool) - opp.bench.length;
  const maxPick = Math.max(0, Math.min(3, cands.length, room));
  const s = addLog(state, `歡迎舞：查看對手手牌（${opp.hand.length} 張），選最多 ${maxPick} 張【基礎】寶可夢放置於對手備戰區`, aIdx);
  return withPending(s, {
    type: 'hand-choose', actorIdx: aIdx, sourcePlayerIdx: oIdx,
    minCount: 0, maxCount: maxPick,
    effectKey: 'lillie-ribombee-invite-place',
    params: { validIids: cands.map(c => c.iid), label: '歡迎舞', maxPick: 3, titleOverride: `歡迎舞：查看對手手牌，選最多 ${maxPick} 張【基礎】寶可夢放置於對手備戰區` },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 「若希望，選擇1個這隻寶可夢身上附加的【X】能量，將其丟棄。這個情況下，〔追加效果〕」
//    ⭐ 站長裁定（2026-11-26）：「這個情況下」＝要**真的丟了**才有追加效果；身上沒有【X】能量 ⇒ 不能追加。
//       （與激流水泵「0 個能量也照打」是不同的情形，不可類推。）
// ══════════════════════════════════════════════════════════════════════════════
// 049 一擊武道熊師｜暗冥強擊 120+：…【惡】能量…增加140點傷害。
//   ⇒ 丟 0 或 1 個【惡】能量、每丟 1 張 +140 ＝ registerSelfDiscardMultiply(per=140, max=1, min=0, 'Darkness')：
//     沒有【惡】能量時 picker 沒有可勾的 ⇒ 只能 0 張 ⇒ 120（不會白拿 +140）。
registerSelfDiscardMultiply('一擊武道熊師|暗冥強擊', '暗冥強擊', 120, 140, 1, 'Darkness', false, 0);

// 050 連擊武道熊師｜水流連打 120：…【水】能量…對手的所有備戰寶可夢也各受到40點傷害。[在備戰區不計算弱點・抵抗力。]
//   PRE：玩家勾 0／1 個【水】能量（AI 沒傳 ⇒ 有就付）→ 登記付出（傷害之後才真的丟，v6.407）並記下「這次有付」；
//   POST：有付才打備戰（中央 hitBenchAllForCard）。
const WATER_COMBO_KEY = '連擊武道熊師|水流連打';
ATTACK_PRE_DISCARD_CHOICE.set(WATER_COMBO_KEY, {
  min: 0, max: 1, scope: 'attacker', baseDamage: 120, damagePerEnergy: 0,
  energyTypeFilter: 'Water', verb: 'discard',
});
regPre(WATER_COMBO_KEY, (state, aIdx, pool, action) => {
  const att = state.players[aIdx].active;
  if (!att) return { state: { ...state, _attackOptInPaid: undefined }, damage: 120 };
  const eligible = att.energyAttached.filter(e => preDiscardEnergyEligible(att, e, pool, { type: 'Water' }));
  const chosen = action?.discardedEnergyIids;
  const picked = (chosen === undefined ? eligible.slice(-1) : eligible.filter(e => chosen.includes(e.iid))).slice(0, 1);
  if (picked.length === 0) {
    const why = eligible.length === 0 ? '身上沒有【水】能量 ⇒ 不能追加效果' : '選擇不丟棄';
    return { state: addLog({ ...state, _attackOptInPaid: undefined }, `水流連打：${why} → 只造成 120`, aIdx), damage: 120 };
  }
  const s = queueAttackEnergyPayment(state, aIdx, picked, 'discard', '水流連打');
  return { state: addLog({ ...s, _attackOptInPaid: WATER_COMBO_KEY }, '水流連打：丟棄 1 個【水】能量 → 對手的所有備戰寶可夢也各受到 40', aIdx), damage: 120 };
});
regPost(WATER_COMBO_KEY, (state, aIdx, pool) => {
  const paid = state._attackOptInPaid === WATER_COMBO_KEY;
  const s: GameState = { ...state, _attackOptInPaid: undefined };
  if (!paid) return s;
  return hitBenchAllForCard(s, aIdx, oppOf(aIdx), 40, pool, '水流連打');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 其他效果
// ══════════════════════════════════════════════════════════════════════════════
// 043 鯰魚王｜激烈搖晃 180：將場上的競技場卡丟棄。若無法丟棄，則這個招式失敗。（同 無極汰那｜世界之末）
regPre('鯰魚王|激烈搖晃', (state, aIdx) => {
  if (!state.activeStadium) return { state: addLog(state, '激烈搖晃：場上沒有競技場卡，招式失敗', aIdx), damage: 0 };
  return { state, damage: 180 };
});
regPost('鯰魚王|激烈搖晃', discardStadiumPost('激烈搖晃', false));

// 061 普隆隆姆｜長程衝鋒 100：將這隻寶可夢身上附加的能量卡全部丟棄，對手的1隻備戰寶可夢也受到100點傷害。
//   丟光（forceAll，傷害之後才真的丟）＋ 狙擊備戰（同型：N的達摩狒狒｜火人加農炮「90」）
registerSelfDiscardMultiply('普隆隆姆|長程衝鋒', '長程衝鋒', 100, 0, 99, 'all', true);
regPost('普隆隆姆|長程衝鋒', snipeOneOppBenchPost(100, '長程衝鋒'));

// 064 沙漠蜻蜓｜沙漠之風 90：若希望，選擇2個對手的戰鬥寶可夢身上附加的能量，放回對手的牌庫並重洗。
//   「若希望」⇒ 出招前二選一（v5.063 binary-yes-no 慣例，AI／沒傳＝是）；
//   是 ⇒ 中央 discardOppActiveEnergyPost(…, count 2, dest 'deck')：攻擊方選哪 2 個（不足 2 個就全部），含招式效果免疫閘。
const DESERT_WIND_KEY = '沙漠蜻蜓|沙漠之風';
ATTACK_PRE_DISCARD_CHOICE.set(DESERT_WIND_KEY, {
  min: 0, max: null, scope: 'binary-yes-no', baseDamage: 90, damagePerEnergy: 0,
  choicePrompt: '是否選擇2個對手的戰鬥寶可夢身上附加的能量，放回對手的牌庫並重洗？',
  choiceYesLabel: '是（放回對手牌庫）', choiceNoLabel: '否',
});
regPost(DESERT_WIND_KEY, (state, aIdx, pool, action) => {
  const c = action?.discardedEnergyIids;
  const yes = c === undefined ? true : c.length >= 1;
  if (!yes) return addLog(state, '沙漠之風：選擇「否」 — 不放回能量', aIdx);
  return discardOppActiveEnergyPost('沙漠之風', 'any', 2, 'attack-effect', 'deck')(state, aIdx, pool);
});

// 062 拖拖蚓｜潛入補給：將這隻寶可夢與備戰寶可夢互換。然後，從自己的棄牌區選擇1張「基本【鋼】能量」卡，附於這隻寶可夢身上。
//   ⚠「這隻寶可夢」＝出招的拖拖蚓（換到備戰後仍是它）⇒ 先記下它的 iid，兩段 pending 依序排隊（v4.933 pendingChainQueue）。
//   ⚠ 棄牌區是已知區 ⇒ 有就必選 1 張（判準③）；沒有就只換位。
regPost('拖拖蚓|潛入補給', (state, aIdx, pool) => {
  const me = state.players[aIdx].active;
  if (!me) return state;
  const selfIid = me.iid;
  let s = selfSwapPost('潛入補給')(state, aIdx, pool);
  const cand = s.players[aIdx].discard.filter(c => {
    return isBasicEnergyOfType(pool.get(c.cardId), 'Metal');   // 中央述詞（基本能量 pokemonType 恆 null，不可直讀）
  });
  if (cand.length === 0) return addLog(s, '潛入補給：棄牌區沒有「基本【鋼】能量」', aIdx);
  return withPending(addLog(s, '潛入補給：從棄牌區選 1 張「基本【鋼】能量」附於這隻寶可夢', aIdx), {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Energy:Metal', minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-start',
    params: { label: '潛入補給', source: 'discard', scope: 'any-own', targetIids: [selfIid], validIids: cand.map(c => c.iid) },
  });
});

// 068 老翁龍｜力量氣息 30：從自己的牌庫選擇1張基本能量卡，附於自己的【龍】寶可夢身上。並且重洗牌庫。
//   （中央能量鏈：牌庫來源、目標限【龍】；牌庫有條件檢索可找不到 ⇒ 可選 0）
regPost('老翁龍|力量氣息', (state, aIdx) => {
  if (state.players[aIdx].deck.length === 0) return addLog(state, '力量氣息：牌庫為空', aIdx);
  return withPending(addLog(state, '力量氣息：從牌庫選 1 張基本能量附於自己的【龍】寶可夢', aIdx), {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy', minCount: 0, maxCount: 1,
    effectKey: 'v158-energy-chain-start',
    params: { label: '力量氣息', source: 'deck', scope: 'any-own', filterType: 'Dragon', singleTarget: true },
  });
});

// 072 小卡比獸｜沉沉行進：從自己的牌庫選擇最多3張【撤退】所需的能量為4個的寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。
regPost('小卡比獸|沉沉行進', (state, aIdx) => {
  if (state.players[aIdx].deck.length === 0) return addLog(state, '沉沉行進：牌庫為空', aIdx);
  return withPending(addLog(state, '沉沉行進：從牌庫選最多 3 張【撤退】所需能量為 4 個的寶可夢卡加入手牌', aIdx), {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'RetreatCost4', minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 034 迷布莉姆｜預知未來：查看自己或者對手的牌庫上方3張卡，以任意順序排列，放回牌庫上方。
//   先選看誰的牌庫（modal-choice），再走中央 reorder-deck-top-apply（targetIdx）。
regPost('迷布莉姆|預知未來', (state, aIdx) => {
  const mine = state.players[aIdx].deck.length, theirs = state.players[oppOf(aIdx)].deck.length;
  if (mine === 0 && theirs === 0) return addLog(state, '預知未來：雙方牌庫都沒有卡', aIdx);
  return withPending(addLog(state, '預知未來：選擇要查看自己或對手的牌庫上方 3 張', aIdx), {
    type: 'modal-choice', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'm7-future-sight-pick',
    params: {
      label: '預知未來',
      options: [
        { id: 'self', text: `自己的牌庫（${mine} 張）`, disabled: mine === 0 },
        { id: 'opp', text: `對手的牌庫（${theirs} 張）`, disabled: theirs === 0 },
      ],
    },
  });
});
regR('m7-future-sight-pick', (state, aIdx, iids) => {
  const tIdx = iids[0] === 'opp' ? oppOf(aIdx) : aIdx;
  const deck = state.players[tIdx].deck;
  if (deck.length === 0) return addLog(state, '預知未來：該牌庫沒有卡', aIdx);
  const realN = Math.min(3, deck.length);
  const top = deck.slice(0, realN);
  const who = tIdx === aIdx ? '自己' : '對手';
  return withPending(addLog(state, `預知未來：查看${who}的牌庫上方 ${realN} 張並重新排序`, aIdx), {
    type: 'reorder-deck-top', actorIdx: aIdx, sourcePlayerIdx: tIdx,
    minCount: realN, maxCount: realN,
    effectKey: 'reorder-deck-top-apply',
    params: { candidateIids: top.map(c => c.iid), allowDiscard: false, targetIdx: tIdx, titleOverride: `預知未來：排序${who}的牌庫上方 ${realN} 張` },
  });
});

// 052 烏賊王｜技能操控：選擇1個對手的戰鬥場的「超級進化寶可夢【ex】」持有的招式，作為這個招式使用。
//   借招中央管線（同 火箭隊的謎擬Ｑ｜扮晶晶酒）：候選＝copyAttackCandidates（copy-attack.ts 的 ownersFor 已登記本卡）。
const SKILL_CONTROL_KEY = '烏賊王|技能操控';
regPre(SKILL_CONTROL_KEY, (state, aIdx, pool, action) => {
  const oppActive = state.players[oppOf(aIdx)].active;
  const oppCard: Card | undefined = oppActive ? pool.get(oppActive.cardId) : undefined;
  if (!oppActive || !isMegaExCard(oppCard)) {
    return { state: addLog(state, `技能操控：對手的戰鬥寶可夢不是「超級進化寶可夢【ex】」，無法使用招式`, aIdx), damage: 0 };
  }
  const cands = copyAttackCandidates(SKILL_CONTROL_KEY, state, aIdx, pool);
  { const note = copyAttackCooldownNote(SKILL_CONTROL_KEY, state, aIdx, pool); if (note) state = addLog(state, note, aIdx); }
  const pick = pickCopiedAttack(cands, action);
  if (!pick.candidate) return { state: addLog(state, `技能操控：${oppCard?.name ?? '?'} 沒有可以使用的招式`, aIdx), damage: 0 };
  const copiedKey = `${pick.candidate.ownerName}|${pick.candidate.attackName}`;
  const s = addLog(state, `技能操控：使用 ${pick.candidate.ownerName} 的「${pick.candidate.attackName}」（${pick.byPlayer ? '玩家選擇' : '自動挑印刷最高'}）`, aIdx);
  return dispatchCopiedAttack(s, aIdx, pool, copiedKey, pick.candidate.damage, action, pick.restChain);
});
regPost(SKILL_CONTROL_KEY, copyAttackPostDispatch);
