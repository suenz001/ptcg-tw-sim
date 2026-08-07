/**
 * v2.76 H 標 Wave 3 — 複雜批（28 張收尾）
 *
 * 嚴格按卡牌原文實裝。需新引擎機制者標 TODO 並 best-effort fallback。
 */

import type { PlayerState } from '../../types'; // v6.020：補 type-only import(TS2304 scanner)
import {
  regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle,
  ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS,
  getOwnBenchLimit,
  ATTACK_PRE_DISCARD_CHOICE,  // v5.060：克雷色利亞|弦月光芒 補若希望 prompt
  buildDevolvedInstance, // v5.984 中央退化建構
} from '../_shared';
import { markDamageCounterMovedFrom } from '../_shared'; // v5.947 移動指示物非治療
import { getKODefenderEnergyInDiscard, getKODefenderSnapshot, pluckOppEnergyActiveOrDiscard } from '../_shared'; // v5.776 KO對手戰鬥位能量搬移中央
import { placedBenchInstance } from '../_shared'; // v5.745 放場裸化+justPlaced中央
import type { AttackPostFn, AttackPreFn } from '../_shared';
import { hasOakEye } from '../_shared'; // v5.789 監視之眼 gate
import { clearActiveEffects } from '../_shared'; // v5.807 退化清附加效果(§II-C-13)

import { copyAttackPostDispatch } from '../_shared';
import { canApplyEffectToTarget } from '../../defense';
import { getAllAttachedTools } from '../_shared'; // v5.841 丟道具含 extraTools
import { relocateOwnCounterToOpp } from '../../effects'; // v5.825 改放指示物中央管線
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, applyOppActiveDebuffPost, statusPost, flipCoinsWithLog, canApplyAttackEffectToTarget, dealAttackDamageToTarget } from '../../effects';
// v3.08 美納斯｜平穩境地 — 對手寶可夢/附加卡 → 對手手牌 阻擋 helper
import { isReturnToHandBlockedByCalmGround as _calmGroundBlocks } from './v3080_deferred_wave_c'; // v5.985 傳「被回手卡持有者」idx
import { computeActiveRetreatCostFor } from '../../engine';  // v5.362：影繩結有效撤退費
import { startEnergyChain } from './v158_energy_chain';  // v5.884 能量攪拌重分配

// ══════════════════════════════════════════════════════════════════════════════
// helper
// ══════════════════════════════════════════════════════════════════════════════
function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    return updatePlayer(addLog(state, `${label}：自身丟棄全部能量`, aIdx), aIdx, p => {
      if (!p.active) return p;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...p.active.energyAttached] };
    });
  };
}

function parseDmg(s: string): number {
  const m = (s ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 喵喵|亂抓 — name 前有 zero-width non-joiner（U+200C）
//    擲 3 次硬幣 ×20
// ══════════════════════════════════════════════════════════════════════════════

// v5.844 清除跨檔重複死碼(生效版在 effects.ts,原 喵喵|亂抓)

// ══════════════════════════════════════════════════════════════════════════════
// 2. 骨紋巨聲鱷|純樸 — 「這隻寶可夢不會受到對手的寶可夢使用招式的效果的影響」
//    這是招式宣告本身（damage 0）→ 設置自身 immuneToAttackEffectsThisTurn flag
//    引擎暫無此精確 flag — 使用既有 damageReduceNextHit + log 提示
// ══════════════════════════════════════════════════════════════════════════════
regPre('骨紋巨聲鱷|純樸', (s) => ({ state: s, damage: 0 }));
regPost('骨紋巨聲鱷|純樸', (state, aIdx, _pool) => {
  // v2.78 用新 flag immuneToAttackEffectsNextTurn — engine 在 ATTACK_POST 階段 skip
  return updatePlayer(addLog(state, '純樸：下回合不受對手寶可夢使用招式的附加效果影響（傷害仍結算）', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, immuneToAttackEffectsNextTurn: true } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 帝牙海獅|凍結獠牙 60 — 全場效果，下回合「身上附加的能量為 2 個以下」全部寶可夢無法使用招式
//    [TODO engine] 嚴謹實作需新增 player-level flag low-energy-cant-attack-next-opp-turn
//    暫用 best-effort：在 defender (opp active) 上設 cantAttackPending（只擋戰鬥場）+ 記 log
// ══════════════════════════════════════════════════════════════════════════════
regPre('帝牙海獅|凍結獠牙', (s) => ({ state: s, damage: 60 }));
regPost('帝牙海獅|凍結獠牙', (state, aIdx, _pool) => {
  // v2.78 用 player-level state.lowEnergyCantAttackNextTurn[opp] = true
  // engine 在 ATTACK PRE 階段：state.lowEnergyCantAttackThisTurn[aIdx] && energy ≤ 2 → 失敗
  const dIdx = (1 - aIdx) as 0 | 1;
  const cur = state.lowEnergyCantAttackNextTurn ?? [false, false];
  const newN: [boolean, boolean] = [cur[0], cur[1]];
  newN[dIdx] = true;
  return addLog({ ...state, lowEnergyCantAttackNextTurn: newN }, '凍結獠牙：下回合對手所有能量 ≤2 寶可夢無法使用招式', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 皮可西|揮指 — 選擇 1 個對手戰鬥寶可夢的招式作為此招使用
//    用 v2.119 N的索羅亞克ex 暗黑底牌 模式：fallback 自動挑印刷傷害最高
// ══════════════════════════════════════════════════════════════════════════════
function pickHighestAttack(candidates: CardInstance[], pool: Map<string, Card>, selfKey: string) {
  let best: { cardName: string; attackName: string; damage: number } | null = null;
  for (const c of candidates) {
    const card = pool.get(c.cardId);
    if (!card?.attacks) continue;
    for (const atk of card.attacks) {
      const key = `${card.name}|${atk.name}`;
      if (key === selfKey) continue;
      const d = parseDmg(atk.damage);
      if (!best || d > best.damage) best = { cardName: card.name!, attackName: atk.name!, damage: d };
    }
  }
  return best;
}
regPre('皮可西|揮指', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return { state: addLog(state, '揮指：對手戰鬥場無寶可夢', aIdx), damage: 0 };
  // v5.178：讀 action.copyAttackChoice (UI rocketCommandPicker 帶) 讓玩家自選
  //   - 有 choice + 匹配 da.iid + 招式有效 → 用該招式
  //   - 否則 fallback 自動挑印刷最高（同高傲指令 v2680 L184-200 模式）
  const choice = (action as { copyAttackChoice?: { pokeIid: string; attackIndex: number } } | undefined)?.copyAttackChoice;
  let best: { cardName: string; attackName: string; damage: number } | null = null;
  if (choice && choice.pokeIid === da.iid && choice.attackIndex >= 0) {
    const daCard = pool.get(da.cardId);
    const atk = daCard?.attacks?.[choice.attackIndex];
    if (daCard && atk && atk.name && atk.name !== '揮指') {
      const m = (atk.damage ?? '').match(/^(\d+)/);
      best = { cardName: daCard.name!, attackName: atk.name, damage: m ? parseInt(m[1], 10) : 0 };
    }
  }
  if (!best) best = pickHighestAttack([da], pool, '皮可西|揮指');
  if (!best) return { state: addLog(state, '揮指：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${best.cardName}|${best.attackName}`;
  const pickMode = choice ? '玩家選擇' : '自動挑印刷最高';
  let s = addLog(state, `揮指：${pickMode}「${copiedKey}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    return { state: sub.state, damage: sub.damage, skipWeakRes: false, skipDefEffects: sub.skipDefEffects };
  }
  return { state: s, damage: best.damage };
});
regPost('皮可西|揮指', copyAttackPostDispatch);

// ══════════════════════════════════════════════════════════════════════════════
// 5. 艾姆利多|神之爆炸 160 — 自方備戰沒有「由克希」「亞克諾姆」失敗
// ══════════════════════════════════════════════════════════════════════════════
regPre('艾姆利多|神之爆炸', (state, aIdx, pool) => {
  const bench = state.players[aIdx].bench;
  const hasYukushi = bench.some(b => pool.get(b.cardId)?.name === '由克希');
  const hasAknom = bench.some(b => pool.get(b.cardId)?.name === '亞克諾姆');
  if (!hasYukushi || !hasAknom) {
    return { state: addLog(state, '神之爆炸：自方備戰缺「由克希」或「亞克諾姆」 → 招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, '神之爆炸：條件成立 → 160', aIdx), damage: 160 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 克雷色利亞|弦月光芒 80+ — 完整實作（v5.878~v5.882，見下方 regPre/regPost）
//   卡面：「若希望，選擇1張自己的反面朝上的獎賞卡，翻到正面。這個情況下，增加80點傷害。
//        （在對戰結束前，那張獎賞卡維持正面朝上。）」
//   Yes → 翻 1 張反面獎賞成 faceUp（維持到對戰結束、公開 log 卡名、顯示於獎賞區）+ 80+80 = 160。
//   No / 無反面獎賞可翻 → 80 base。
//   獎賞 faceUp 機制：CardInstance.faceUp + engine addPendingPrize 遇 faceUp 開逐張取獎 picker
//   讓取獎方選要不要取翻開的那張（見 reference-prize-faceup-cresselia）。
// ══════════════════════════════════════════════════════════════════════════════
ATTACK_PRE_DISCARD_CHOICE.set('克雷色利亞|弦月光芒', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 80, damagePerEnergy: 0,
  choicePrompt: '是否選擇 1 張自己反面朝上的獎賞卡翻到正面（增加 80 點傷害）？',
  choiceYesLabel: '是（翻 1 獎賞 / +80 傷害）',
  choiceNoLabel: '否（僅 80 傷害）',
});
// v5.881：卡面「若希望，選擇1張自己的反面朝上的獎賞卡，翻到正面（增加80點傷害），那張獎賞卡維持
//   正面朝上到對戰結束」。招式效果（翻獎賞）須「先於傷害結算、也先於取 KO 獎賞」發生（Wilson 裁定，
//   參考甲賀忍蛙ex｜忍之利刃 registerDamageThenOptionalDeckSearchToHand 的延後傷害範本）：
//   regPre 傷害設 0（延後）；regPost 先翻獎賞(faceUp+公開 log)、最後才用中央 dealAttackDamageToTarget
//   造傷害（免疫/弱抗/KO/取獎一次到位）→ KO 取獎時 faceUp 已就位、玩家能選要不要取翻開的那張。
regPre('克雷色利亞|弦月光芒', (state) => ({ state, damage: 0 }));
regPost('克雷色利亞|弦月光芒', (state, aIdx, pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  const p = state.players[aIdx];
  const faceDownIdx = p.prizes.findIndex(pr => !pr.faceUp);
  let s = state;
  let dmg = 80;
  if (choseYes && faceDownIdx !== -1) {
    // 先翻獎賞（效果先於傷害/取獎）：翻開 1 張反面獎賞成正面，faceUp 維持到對戰結束、對雙方公開 log 卡名。
    const flippedName = pool.get(p.prizes[faceDownIdx].cardId)?.name ?? '?';
    s = updatePlayer(state, aIdx, pp => ({
      ...pp,
      prizes: pp.prizes.map((pr, i) => (i === faceDownIdx ? { ...pr, faceUp: true } : pr)),
    }));
    s = addLog(s, `弦月光芒：將自己 1 張獎賞卡翻到正面 — ${flippedName}（維持到對戰結束）`, aIdx);
    dmg = 160;
  } else {
    s = addLog(s, choseYes ? '弦月光芒：無反面朝上的獎賞可翻 → 80' : '弦月光芒：選擇「否」，不翻獎賞 → 80', aIdx);
  }
  // 翻獎賞之後才造傷害 → KO 取獎（addPendingPrize）在翻面後發生，faceUp 已就位。
  const dIid = s.players[(1 - aIdx) as 0 | 1].active?.iid;
  return dIid ? dealAttackDamageToTarget(s, aIdx, dIid, dmg, pool, { kind: 'attack-damage', label: '弦月光芒' }) : s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 長毛巨魔|影繩結 50× — 對手戰鬥場撤退費數 ×50
// ══════════════════════════════════════════════════════════════════════════════
regPre('長毛巨魔|影繩結', (state, aIdx, pool) => {
  const dIdx = (1-aIdx) as 0|1;
  // v5.362：有效撤退費（含咒縛火焰等修正），對齊瑪夏多影繩結 / 幻影迷宮，不再用 base retreatCost.length
  const retreatCost = computeActiveRetreatCostFor(state, dIdx, pool);
  return { state: addLog(state, `影繩結：對手撤退費 ${retreatCost} → ${retreatCost}×50 = ${retreatCost*50}`, aIdx), damage: retreatCost * 50 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 吼叫尾|唱歌鼓勵 — 自方備戰 1 隻「古代」回 100 HP
// ══════════════════════════════════════════════════════════════════════════════
regPre('吼叫尾|唱歌鼓勵', (s) => ({ state: s, damage: 0 }));
regPost('吼叫尾|唱歌鼓勵', (state, aIdx, pool) => {
  const ancientBench = state.players[aIdx].bench.filter(b => pool.get(b.cardId)?.tags?.includes('古代'));
  if (ancientBench.length === 0) return addLog(state, '唱歌鼓勵：自備戰無古代寶可夢', aIdx);
  return withPending(addLog(state, '唱歌鼓勵：選 1 自備戰古代寶可夢回 100 HP', aIdx), {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    // v5.929 卡面限「備戰區的『古代』寶可夢」→ 傳 validIids 限定候選(比照美洛耶塔治癒旋律),
    //   否則前端 heal-target 無 validIids 會列出戰鬥位+全備戰,可治非法目標。
    params: { validIids: ancientBench.map((c) => c.iid) },
    effectKey: 'h-wave3-heal-100',
  });
});
regR('h-wave3-heal-100', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const tIid = iids[0];
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active && p.active.iid === tIid ? { ...p.active, damage: Math.max(0, (p.active.damage ?? 0) - 100) } : p.active,
    bench: p.bench.map(b => b.iid === tIid ? { ...b, damage: Math.max(0, (b.damage ?? 0) - 100) } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 振翼髮|蠱惑挪移 — 自備戰古代 1 隻指示物→對手戰鬥
// ══════════════════════════════════════════════════════════════════════════════
regPre('振翼髮|蠱惑挪移', (s) => ({ state: s, damage: 0 }));
regPost('振翼髮|蠱惑挪移', (state, aIdx, pool) => {
  if (hasOakEye(state, pool)) return addLog(state, '蠱惑挪移：被探探鼠的監視之眼擋下，傷害指示物無法改放', aIdx); // v5.789
  const ancientWithDmg = state.players[aIdx].bench.filter(b => {
    const card = pool.get(b.cardId);
    return card?.tags?.includes('古代') && (b.damage ?? 0) > 0;
  });
  if (ancientWithDmg.length === 0) return addLog(state, '蠱惑挪移：自備戰無「古代」+ 有指示物', aIdx);
  return withPending(addLog(state, '蠱惑挪移：選 1 自備戰古代寶可夢，指示物全移到對手戰鬥場', aIdx), {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-move-bench-dmg-to-opp-active',
  });
});
regR('h-wave3-move-bench-dmg-to-opp-active', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const tIid = iids[0];
  const dIdx = (1 - aIdx) as 0 | 1;
  const sourceB = state.players[aIdx].bench.find(b => b.iid === tIid);
  if (!sourceB) return state;
  const dmg = sourceB.damage ?? 0;
  if (dmg === 0) return state;
  // v5.825：改走中央 relocateOwnCounterToOpp(source-first)。
  const oppActive = state.players[dIdx].active;
  if (!oppActive) return addLog(state, '蠱惑挪移：對手戰鬥場無寶可夢', aIdx);
  return relocateOwnCounterToOpp(state, aIdx, tIid, oppActive.iid, dmg, 'attack-effect', '蠱惑挪移', pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 勾魂眼|傷害集結 — 對手備戰任意指示物→對手戰鬥
// ══════════════════════════════════════════════════════════════════════════════
regPre('勾魂眼|傷害集結', (s) => ({ state: s, damage: 0 }));
regPost('勾魂眼|傷害集結', (state, aIdx, pool) => {
  if (hasOakEye(state, pool)) return addLog(state, '傷害集結：被探探鼠的監視之眼擋下，傷害指示物無法改放', aIdx); // v5.789
  const dIdx = (1 - aIdx) as 0 | 1;
  let totalDmg = 0;
  for (const b of state.players[dIdx].bench) totalDmg += b.damage ?? 0;
  if (totalDmg === 0) return addLog(state, '傷害集結：對手備戰無指示物', aIdx);
  const _gouSrc = state.players[dIdx].bench.filter(b => (b.damage ?? 0) > 0).map(b => b.iid);  // v5.947 記錄被清 0 的來源
  let s = updatePlayer(state, dIdx, p => ({
    ...p,
    bench: p.bench.map(b => ({ ...b, damage: 0 })),
    active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + totalDmg } : null,
  }));
  s = markDamageCounterMovedFrom(s, ..._gouSrc);  // v5.947 對手備戰指示物是移動(非治療)→不算 healedThisTurn
  return addLog(s, `傷害集結：對手備戰所有 ${totalDmg} 點指示物 → 對手戰鬥場`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 密勒頓ex|抵制伏特 60+ — 對手戰鬥有指示物 +100
// ══════════════════════════════════════════════════════════════════════════════
regPre('密勒頓ex|抵制伏特', (state, aIdx, _pool) => {
  const dDmg = state.players[(1-aIdx) as 0|1].active?.damage ?? 0;
  if (dDmg > 0) return { state: addLog(state, '抵制伏特：對手戰鬥有指示物 → 60+100 = 160', aIdx), damage: 160 };
  return { state: addLog(state, '抵制伏特：對手戰鬥無指示物 → 60', aIdx), damage: 60 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 智揮猩|掌握弱點 — 下回合本招式對方弱點變【無】
//    實作：regPost 設 defender weaknessOverrideTypeNextTurn='Colorless'（engine 6729 消費，
//    下回合弱點屬性改為【無】，×2 仍計算），對齊卡面。無需額外新 flag。（v5.843 更正過時 TODO）
// ══════════════════════════════════════════════════════════════════════════════
regPre('智揮猩|掌握弱點', (s) => ({ state: s, damage: 0 }));
// v6.046：卡面「…**受到這個招式的寶可夢**弱點改為【無】屬性」＝對受招者施加的招式效果
//   → 收斂中央 applyOppActiveDebuffPost（原直接寫旗標漏免疫 gate）。
regPost('智揮猩|掌握弱點', applyOppActiveDebuffPost(
  '掌握弱點',
  (a) => ({ ...a, weaknessOverrideTypeNextTurn: 'Colorless' }),
  '掌握弱點：下回合 defender 弱點屬性改為【無】（×2 仍計算）',
));

// ══════════════════════════════════════════════════════════════════════════════
// 13. 泡沫栗鼠|掃除 — 棄對手 ≤2 道具
// ══════════════════════════════════════════════════════════════════════════════
regPre('泡沫栗鼠|掃除', (s) => ({ state: s, damage: 0 }));
// v5.849：掃除選對手道具 options — 只列對手、過化隱/純樸免疫 gate、含 extraTools(多重轉接)。
function buildScavengeOptions(state: import('../../types').GameState, aIdx: 0 | 1, pool: Map<string, any>) {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];
  const all: { inst: CardInstance; pos: string; isBench: boolean }[] = [
    ...(dp.active ? [{ inst: dp.active, pos: '戰鬥', isBench: false }] : []),
    ...dp.bench.map(b => ({ inst: b, pos: '備戰', isBench: true })),
  ];
  const opts: { id: string; text: string; inspectIid?: string; inspectPlayerIdx?: 0 | 1 }[] = [];
  for (const { inst, pos, isBench } of all) {
    // v6.028：丟道具不是放指示物 → 對戰圓形不擋
    if (canApplyEffectToTarget(state, aIdx, inst, pool.get(inst.cardId), 'attack-effect', pool, { isBench, counterPlacement: false }).blocked) continue;
    const ownerName = pool.get(inst.cardId)?.name ?? '?';
    for (const t of getAllAttachedTools(inst)) {
      opts.push({ id: `${dIdx}:${inst.iid}:${t.iid}`, text: `🔧 對手 ${pos} ${ownerName} 的「${pool.get(t.cardId)?.name ?? '?'}」`, inspectIid: inst.iid, inspectPlayerIdx: dIdx });
    }
  }
  return opts;
}
// v5.849：卡面「選擇最多 2 張對手道具丟棄」→ 玩家手選(原 UX 簡化自動選前 2)。picksLeft 連續選,對齊道具拆除器。
regPost('泡沫栗鼠|掃除', (state, aIdx, pool) => {
  const opts = buildScavengeOptions(state, aIdx, pool);
  if (opts.length === 0) return addLog(state, '掃除：對手場上無可丟棄的道具', aIdx);
  return withPending(addLog(state, '掃除：從對手場上選 1 張道具丟棄（最多 2 張）', aIdx), {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'scavenge-tool-pick',
    params: { label: '掃除（第 1 張，最多 2 張）', options: opts, picksLeft: 2 },
  });
});
regR('scavenge-tool-pick', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const choice = iids[0];
  if (choice === 'end') return addLog(state, '掃除：玩家選擇不丟第 2 張', aIdx);
  const segs = choice.split(':');
  const pIdx = parseInt(segs[0]) as 0 | 1;
  const targetIid = segs[1];
  const toolIid = segs[2];
  let removedTool: any = undefined; let ownerName = '?';
  const rm = (inst: CardInstance): CardInstance => {
    if (inst.toolAttached?.iid === toolIid) { removedTool = inst.toolAttached; ownerName = pool.get(inst.cardId)?.name ?? '?'; return { ...inst, toolAttached: undefined }; }
    const found = (inst.extraTools ?? []).find(x => x.iid === toolIid);
    if (found) { removedTool = found; ownerName = pool.get(inst.cardId)?.name ?? '?'; return { ...inst, extraTools: (inst.extraTools ?? []).filter(x => x.iid !== toolIid) }; }
    return inst;
  };
  let s = updatePlayer(state, pIdx, pp => ({
    ...pp,
    active: pp.active && pp.active.iid === targetIid ? rm(pp.active) : pp.active,
    bench: pp.bench.map(b => b.iid === targetIid ? rm(b) : b),
  }));
  if (!removedTool) return addLog(s, '掃除：找不到目標道具', aIdx);
  s = updatePlayer(s, pIdx, pp => ({ ...pp, discard: [...pp.discard, { ...removedTool, damage: 0, energyAttached: [] }] }));
  s = addLog(s, `掃除：丟棄 ${ownerName} 身上的道具（${pool.get(removedTool.cardId)?.name ?? '?'}）`, aIdx);
  const picksLeft = (params?.picksLeft as number ?? 1) - 1;
  if (picksLeft >= 1) {
    const opts2 = buildScavengeOptions(s, aIdx, pool);
    if (opts2.length > 0) {
      opts2.push({ id: 'end', text: '✋ 結束（不丟第 2 張）' });
      s = withPending(s, {
        type: 'modal-choice', actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1, effectKey: 'scavenge-tool-pick',
        params: { label: '掃除（第 2 張）', options: opts2, picksLeft: 0 },
      });
    }
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 熔蟻獸|滑燒火焰 130 — 擲 3 次硬幣，反面數 = 棄自身能量數
// ══════════════════════════════════════════════════════════════════════════════
regPre('熔蟻獸|滑燒火焰', (s) => ({ state: s, damage: 130 }));
regPost('熔蟻獸|滑燒火焰', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 3, '滑燒火焰', aIdx);
  const tails = 3 - r.heads;
  if (tails === 0) return r.state;
  return updatePlayer(addLog(r.state, `滑燒火焰：${tails} 反面 → 棄 ${tails} 個能量`, aIdx), aIdx, p => {
    if (!p.active || p.active.energyAttached.length === 0) return p;
    const k = Math.min(tails, p.active.energyAttached.length);
    const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
    const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
    return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. 魔牆人偶|相仿秀 — 查對手手牌 + 若希望，選 1 張支援者作為此招使用
// ══════════════════════════════════════════════════════════════════════════════
regPre('魔牆人偶|相仿秀', (s) => ({ state: s, damage: 0 }));
regPost('魔牆人偶|相仿秀', (state, aIdx, pool) => {
  // v5.868 修玩家回報：原實作「自動執行對手手牌第一張支援者」— 既沒讓玩家「查看對手手牌」，
  //   也沒讓玩家「選擇 1 張」（違卡面「查看對手的手牌。若希望，選擇1張其中的支援者卡…」+ 絕不簡化）。
  //   改為開 hand-choose picker(sourcePlayerIdx=對手 → 揭示對手手牌供查看),validIids 只放支援者,
  //   minCount=0 = 「若希望」可不選。選到的支援者只「複製其效果」，該支援者卡留在對手手牌(卡面無棄牌字樣)。
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) {
    return addLog(state, '相仿秀：對手手牌為空，無可查看', aIdx);
  }
  const suppIids = oppHand.filter(c => pool.get(c.cardId)?.subtype === 'Supporter').map(c => c.iid);
  const s = addLog(state, `相仿秀：查看對手手牌（共 ${oppHand.length} 張，其中支援者 ${suppIids.length} 張）`, aIdx);
  // v5.875 修：卡面「查看對手的手牌」是無條件的(對手手牌是重要戰略資訊)。原 v5.868 在「沒有支援者」時
  //   直接 return → 玩家完全看不到對手手牌。改為一律開 hand-choose picker(參考枇琶 v2.41 Leon 裁定:
  //   即使無可選卡也開 UI 讓玩家查看整副手牌):有支援者 → maxCount1 可選 1 張複製;無支援者 → maxCount0
  //   純查看(footer「不選/跳過」)。整副手牌由 UI +page.svelte 揭露區塊(hand-choose + sourcePlayerIdx!=
  //   actorIdx)顯示;picker 主格顯示可選的支援者。
  return withPending(s, {
    type: 'hand-choose', actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: suppIids.length > 0 ? 1 : 0,
    effectKey: 'mrmime-copycat-pick',
    params: {
      validIids: suppIids,
      titleOverride: suppIids.length > 0
        ? '相仿秀：查看對手手牌，選 1 張支援者卡複製其效果（可不選）'
        : '相仿秀：查看對手手牌（沒有支援者可複製，確認後結束）',
    },
  });
});
regR('mrmime-copycat-pick', (state, aIdx, iids, _params, pool) => {
  const pickedIid = iids[0];
  if (!pickedIid) return addLog(state, '相仿秀：未選擇支援者 — 跳過複製', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  const picked = state.players[dIdx].hand.find(c => c.iid === pickedIid);
  const card = picked ? pool.get(picked.cardId) : undefined;
  if (!card || card.subtype !== 'Supporter') {
    return addLog(state, '相仿秀：選擇的不是支援者卡，效果失敗', aIdx);
  }
  const fn = TRAINER_EFFECTS.get(card.name);
  if (!fn) {
    return addLog(state, `相仿秀：對手支援者「${card.name}」的效果未實裝（跳過）`, aIdx);
  }
  const s = addLog(state, `相仿秀：複製對手手牌支援者「${card.name}」的效果（該卡仍留在對手手牌）`, aIdx);
  return fn(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 鐵武者|莊嚴之劍 100+ — 本回合用過「未來」支援者 +100
//    [TODO engine] 需追蹤 supporterUsedTagsThisTurn — 目前無
//    Best-effort: 自方棄牌頂端是否為「未來」支援者
// ══════════════════════════════════════════════════════════════════════════════
regPre('鐵武者|莊嚴之劍', (state, aIdx, _pool) => {
  // v2.84 engine 追蹤 supporterTagsUsedThisTurn 改 object 結構
  const sup = state.supporterTagsUsedThisTurn;
  const tags = aIdx === 0 ? (sup?.p1 ?? []) : (sup?.p2 ?? []);
  const hasFutureSupp = tags.includes('未來');
  if (hasFutureSupp) return { state: addLog(state, '莊嚴之劍：本回合用過未來支援者 → 100+100 = 200', aIdx), damage: 200 };
  return { state: addLog(state, '莊嚴之劍：本回合未使出未來支援者 → 100', aIdx), damage: 100 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. 優雅貓|能量攪拌 110 — 選自己場上任意數量能量,以任意方式改附於自己的寶可夢
//    v5.884：原僅 log 未實作 → active-energy-discard(scope all-own)選要移動的能量 → resolver 從場上
//    移除暫存 discard → 中央 startEnergyChain(source discard/scope any-own)逐張選目標重新分配。
// ══════════════════════════════════════════════════════════════════════════════
regPre('優雅貓|能量攪拌', (s) => ({ state: s, damage: 110 }));
regPost('優雅貓|能量攪拌', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const allEnergyIids = [...(p.active ? [p.active] : []), ...p.bench].flatMap(pk => pk.energyAttached.map(e => e.iid));
  if (allEnergyIids.length === 0) return addLog(state, '能量攪拌：自方場上無能量可移動', aIdx);
  return withPending(addLog(state, '能量攪拌：選擇自己場上任意數量能量，以任意方式改附於自己的寶可夢', aIdx), {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: allEnergyIids.length,
    effectKey: 'elegant-cat-energy-stir',
    // v6.125 卡面：「選擇自己的場上寶可夢身上附加的**任意數量**的能量卡，以**任意方式**改附…」→ 可 0 張
    params: { scope: 'all-own', validIids: allEnergyIids, allowSkipZero: true, titleOverride: '能量攪拌：選擇要移動的能量（可不選），之後逐張選附加目標' },
  });
});
regR('elegant-cat-energy-stir', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(state, '能量攪拌：未選擇能量', aIdx);
  const pickSet = new Set(iids);
  const p0 = state.players[aIdx];
  const moved = [...(p0.active ? [p0.active] : []), ...p0.bench].flatMap(pk => pk.energyAttached.filter(e => pickSet.has(e.iid)));
  if (moved.length === 0) return addLog(state, '能量攪拌：選中的能量已不存在', aIdx);
  // 從場上移除選中能量 → 暫存 discard，再由 startEnergyChain(source=discard) 逐張重新分配到自方寶可夢。
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => !pickSet.has(e.iid)) } : null,
    bench: p.bench.map(bb => ({ ...bb, energyAttached: bb.energyAttached.filter(e => !pickSet.has(e.iid)) })),
    discard: [...p.discard, ...moved],
  }));
  s = addLog(s, `能量攪拌：移動 ${moved.length} 張能量，以任意方式改附於自己的寶可夢`, aIdx);
  return startEnergyChain(s, aIdx, moved.map(e => e.iid), { label: '能量攪拌', source: 'discard', scope: 'any-own' }, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. 轟擂金剛猩|鼓擊 60 — 下回合 defender 招式 + 撤退費各 +1 無能量
//    [TODO engine] 無精確 flag — 用 cantRetreatNextTurn 替代撤退；招式 cost +1 暫不做
// ══════════════════════════════════════════════════════════════════════════════
regPre('轟擂金剛猩|鼓擊', (s) => ({ state: s, damage: 60 }));
// v5.806：收斂中央 applyOppActiveDebuffPost(原漏招式效果免疫 gate)。
regPost('轟擂金剛猩|鼓擊', applyOppActiveDebuffPost(
  '鼓擊',
  (a) => ({ ...a, attackCostIncreaseColorlessNextTurn: 1, retreatCostIncreaseNextTurn: 1 }),
  '鼓擊：下回合 defender 招式+撤退費各 +1【無】能量',
));

// ══════════════════════════════════════════════════════════════════════════════
// 19. 迷唇姐|邀請之吻 — 牌庫挑 1 基礎放備戰(重洗),移迷唇姐身上 1 能量到新上場(v5.737 invite-kiss-place 完整實作,非簡化)
// ══════════════════════════════════════════════════════════════════════════════
regPre('迷唇姐|邀請之吻', (s) => ({ state: s, damage: 0 }));
regPost('迷唇姐|邀請之吻', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  // v3.80：支援零之大空洞
  const space = Math.max(0, getOwnBenchLimit(state, aIdx, pool) - p.bench.length);
  if (space === 0 || p.deck.length === 0) return state;
  return withPending(addLog(state, '邀請之吻：從牌庫挑 1 張【基礎】寶可夢放備戰（重洗）', aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'invite-kiss-place',  // v5.737：放基礎→自動接「搬1能量到新上場」(原 wave5 通用 resolver 只放基礎,漏能量搬移)
  });
});
// v5.737 迷唇姐|邀請之吻 第1段:放1基礎到備戰,記「新上場」iid;若迷唇姐(active)有能量,開「選1能量」picker(限active能量)
regR('invite-kiss-place', (state, aIdx, _iidsP, _params, _poolP) => {
  const iids = _iidsP;
  if (!iids || iids.length === 0) {
    return updatePlayer(addLog(state, '邀請之吻：未選擇基礎寶可夢；重洗牌庫', aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const targetCardId = iids[0];
  let newIid: string | null = null;
  let s2 = updatePlayer(addLog(state, '邀請之吻：將 1 張基礎寶可夢放置於備戰（重洗牌庫）', aIdx), aIdx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    const placed = picked.map(c => ({ ...c, justPlaced: true, damage: 0 } as CardInstance));
    if (placed[0]) newIid = placed[0].iid;
    return { ...p, deck: shuffle(rest), bench: [...p.bench, ...placed.map(placedBenchInstance)] };
  });
  void targetCardId;
  const act = s2.players[aIdx].active;
  if (!newIid || !act || (act.energyAttached?.length ?? 0) === 0) return s2;  // 沒放成功 / 迷唇姐無能量 → 結束
  // 開「選1個迷唇姐身上的能量」picker（限 active 能量），resolver 自動附到新上場那隻
  return withPending(addLog(s2, '邀請之吻：選擇 1 個迷唇姐身上的能量，改附於新上場的寶可夢', aIdx), {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'invite-kiss-move-energy',
    params: { newIid, scope: 'all-own', validIids: act.energyAttached.map(e => e.iid), titleOverride: '邀請之吻：選擇 1 個迷唇姐身上的能量改附於新上場' },
  });
});
// v5.737 第2段:把選到的能量從迷唇姐(active)移除,附到新上場（params.newIid）那隻備戰
regR('invite-kiss-move-energy', (state, aIdx, iids, params, pool) => {
  const energyIid = iids?.[0];
  const newIid = params?.newIid as string | undefined;
  if (!energyIid || !newIid) return state;
  const act = state.players[aIdx].active;
  const energy = act?.energyAttached.find(e => e.iid === energyIid);
  if (!energy) return state;
  const energyName = pool.get(energy.cardId)?.name ?? '能量';
  let s2 = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => e.iid !== energyIid) } : null,
    bench: p.bench.map(c => c.iid === newIid ? { ...c, energyAttached: [...c.energyAttached, energy] } : c),
  }));
  const tgtName = pool.get(s2.players[aIdx].bench.find(c => c.iid === newIid)?.cardId ?? '')?.name ?? '新上場的寶可夢';
  return addLog(s2, `邀請之吻：將 ${energyName} 從迷唇姐改附於 ${tgtName}`, aIdx);
});


// ══════════════════════════════════════════════════════════════════════════════
// 20. 引夢貘人|白日夢 80 — 下回合對手附能量於受招式者，則對手回合結束
//    [TODO engine] 需新引擎機制（trigger end-turn on attach energy）
//    Fallback: 在 defender 上設 paralyzeFangPending 模擬「附能量觸發傷害」（變相懲罰）
// ══════════════════════════════════════════════════════════════════════════════
regPre('引夢貘人|白日夢', (s) => ({ state: s, damage: 80 }));
// v5.806：收斂中央 applyOppActiveDebuffPost(原漏招式效果免疫 gate)。
regPost('引夢貘人|白日夢', applyOppActiveDebuffPost(
  '白日夢',
  (a) => ({ ...a, endTurnOnOppAttachEnergyNextTurn: true }),
  '白日夢：下回合若對手附能量於受招式者，則對手回合結束',
));

// ══════════════════════════════════════════════════════════════════════════════
// 21. 超能豔鴕|奧密之眼 — 對手 1 進化寶可移除 1 進化卡使其退化（回對手手牌）
// ══════════════════════════════════════════════════════════════════════════════
regPre('超能豔鴕|奧密之眼', (s) => ({ state: s, damage: 0 }));
regPost('超能豔鴕|奧密之眼', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋進化卡回對手手牌
  if (_calmGroundBlocks(state, (1 - aIdx) as 0 | 1, pool)) { // v5.985 被回手的是對手的卡
    return addLog(state, '奧密之眼：對手場上有【平穩境地】，效果無效', aIdx);
  }
  const evolvedAll: CardInstance[] = [...(opp.active ? [opp.active] : []), ...opp.bench]
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.stage && card.stage !== 'Basic';
    });
  if (evolvedAll.length === 0) return addLog(state, '奧密之眼：對手場上無進化寶可', aIdx);
  return withPending(addLog(state, '奧密之眼：選 1 對手進化寶可，移除頂進化卡回對手手', aIdx), {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-devolve',
    // v5.984：原缺 validIids → UI 列出對手全部寶可夢，選到【基礎】時退化 no-op 但移除卡照樣
    //   push 進手牌＝憑空複製一張卡(場上還在)。限定只能選有進化堆疊的目標。
    params: { validIids: evolvedAll.filter(c => (c.evolvedFromStack?.length ?? 0) > 0).map(c => c.iid) },
  });
});
regR('h-wave3-devolve', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const tIid = iids[0];
  // v5.808：招式退化是招式效果 → 受化隱/純樸等免疫;選到免疫目標則不退化(bench 傳 isBench)。
  {
    const _dp = state.players[dIdx];
    const _tgt = _dp.active?.iid === tIid ? _dp.active : _dp.bench.find(b => b.iid === tIid);
    if (_tgt) {
      // v6.028：退化不是放指示物 → 對戰圓形不擋
      const _g = canApplyEffectToTarget(state, aIdx, _tgt, pool.get(_tgt.cardId), 'attack-effect', pool, { isBench: _dp.active?.iid !== tIid, counterPlacement: false });
      if (_g.blocked) return addLog(state, `奧密之眼：${pool.get(_tgt.cardId)?.name ?? '?'}｜${_g.reason}`, aIdx);
    }
  }
  // v5.984：收斂中央 buildDevolvedInstance。原手刻兩處嚴重問題：
  //   ① removedCard 用 sourcePoke.iid＝與場上退化後的寶可夢 dup-iid(其他退化站皆用唯一新 iid;
  //      撞 iid 會讓 EVOLVE 以 toIid 找錯卡、手牌選取/去重錯亂)。
  //   ② devolveOne 對【基礎】/無堆疊目標 no-op，但 removedCard 仍無條件 push＝憑空複製卡。
  //   現改為：helper 回傳 null(深度不足)即取消，不動手牌；成功才 push 唯一 iid 的 removedCards。
  const _dp2 = state.players[dIdx];
  const _target = _dp2.active?.iid === tIid ? _dp2.active : _dp2.bench.find(b => b.iid === tIid);
  if (!_target) return state;
  const _dv = buildDevolvedInstance(_target, 1, state, pool);
  if (!_dv) return addLog(state, '奧密之眼：所選非進化寶可夢，取消', aIdx);
  return updatePlayer(state, dIdx, p => ({
    ...p,
    active: p.active?.iid === tIid ? _dv.devolved : p.active,
    bench: p.bench.map(b => b.iid === tIid ? _dv.devolved : b),
    hand: [...p.hand, ..._dv.removedCards],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 22. 帕底亞 肯泰羅|上搗角擊 30 — 若希望，選擇 2 個對手戰鬥的【2階進化】寶可夢身上的能量，放回對手手牌。
// v3.27：從自動取末端改為 picker；minCount=0 對應「若希望」可選 0∼2 張。
// gate：卡面限 2 階進化，非 2 階則 picker 不開。
// ══════════════════════════════════════════════════════════════════════════════
regPre('帕底亞 肯泰羅|上搗角擊', (s) => ({ state: s, damage: 30 }));
regPost('帕底亞 肯泰羅|上搗角擊', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '上搗角擊：選擇「否」 — 不放回對手能量', aIdx);
  const _cb: AttackPostFn = (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.776：對手戰鬥位被本招式傷害 KO（active=null）→ 官方順序「效果先於昏厥」，仍可把 KO 前戰鬥位能量
  //   （此刻在棄牌區，_koDefenderSnapshot）放回對手手牌。
  // v5.986 平穩境地：提前到 KO 分支之前(原 gate 在 KO early-return 之後→KO 分支繞過)。
  //   被回手的是「對手」的卡(含 KO 前戰鬥位能量快照) → 我方側有平穩境地則擋。
  if (_calmGroundBlocks(state, (1 - aIdx) as 0 | 1, pool)) {
    return addLog(state, '對手能量回手效果：我方場上有【平穩境地】，無效', aIdx);
  }
  if (!state.players[dIdx].active) {
    const _snap = getKODefenderSnapshot(state, dIdx);
    const _snapCard = _snap ? pool.get(_snap.cardId) : null;
    if (_snapCard?.stage !== 'Stage2') return addLog(state, '上搗角擊：對手戰鬥場（已昏厥）非 2 階進化，沒有附加效果', aIdx);
    const _koE = getKODefenderEnergyInDiscard(state, dIdx).map(e => e.iid);
    if (_koE.length === 0) return addLog(state, '上搗角擊：對手戰鬥無可放回的能量', aIdx);
    const _capKO = Math.min(2, _koE.length);
    return withPending(addLog(state, '上搗角擊：對手戰鬥寶可夢已昏厥 — 可從棄牌區將其能量放回對手手牌', aIdx), {
      type: 'active-energy-discard', actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 0, maxCount: _capKO,
      effectKey: 'v327-tauros-thrust',
      params: { fromDiscard: true, validIids: _koE, titleOverride: `選擇要放回對手手牌的能量（0∼${_capKO} 張，已昏厥戰鬥位）` },
    });
  }
  const da = state.players[dIdx].active;
  if (!da) return state;
  const card = pool.get(da.cardId);
  if (card?.stage !== 'Stage2') return addLog(state, '上搗角擊：對手戰鬥場非 2 階進化，沒有附加效果', aIdx);
  if (da.energyAttached.length === 0) return addLog(state, '上搗角擊：對手戰鬥無能量', aIdx);
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋
  if (_calmGroundBlocks(state, (1 - aIdx) as 0 | 1, pool)) { // v5.985 被回手的是對手的卡
    return addLog(state, '上搗角擊：對手場上有【平穩境地】，能量回手效果無效', aIdx);
  }
  const cap = Math.min(2, da.energyAttached.length);
  const s = addLog(state, `上搗角擊：選擇 0∼${cap} 個對手戰鬥位能量放回對手手牌`, aIdx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: cap,
    effectKey: 'v327-tauros-thrust',
    params: { titleOverride: `選擇要放回對手手牌的能量（0∼${cap} 張）` },
  });
};
  return _cb(state, aIdx, pool);
});
regR('v327-tauros-thrust', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '上搗角擊：玩家選擇不發動效果', idx);
  const dIdx = (1 - idx) as 0 | 1;
  // v5.776：能量可能在對手 active(未KO)或棄牌區(已被本招式KO)→ source-agnostic pluck。
  let dp = st.players[dIdx];
  const moved: CardInstance[] = [];
  for (const iid of iids) {
    const r = pluckOppEnergyActiveOrDiscard(dp, iid);
    if (r.energy) { dp = r.player; moved.push(r.energy); }
  }
  if (moved.length === 0) return st;
  const names = moved.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...dp, hand: [...dp.hand, ...moved] };
  return addLog({ ...st, players }, `上搗角擊：將對手戰鬥位的 ${names}（${moved.length} 張）放回對手手牌`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 23. 密勒頓|防護代碼 40 — 下回合自方所有「未來」寶可不受 ex 招式傷害
//    [TODO engine] 玩家層級 flag — 暫無，best-effort log only
// ══════════════════════════════════════════════════════════════════════════════
regPre('密勒頓|防護代碼', (s) => ({ state: s, damage: 40 }));
regPost('密勒頓|防護代碼', (state, aIdx, pool) => {
  // v2.78 對自方所有「未來」寶可夢設 immuneToExAttackTagNextTurn = '未來'
  return updatePlayer(addLog(state, '防護代碼：下回合自方所有未來寶可不受【ex】寶可夢招式傷害', aIdx), aIdx, p => ({
    ...p,
    active: p.active && pool.get(p.active.cardId)?.tags?.includes('未來') ? { ...p.active, immuneToExAttackTagNextTurn: '未來' } : p.active,
    bench: p.bench.map(b => pool.get(b.cardId)?.tags?.includes('未來') ? { ...b, immuneToExAttackTagNextTurn: '未來' } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 24. 塗標客|惡作劇作畫 — 從對手棄牌區選最多 3 張能量,以任意方式附於對手的寶可夢身上
//    v5.884：原自動取前 3 張全附對手戰鬥位 → 改玩家選(從對手棄牌選能量,再逐張選對手寶可夢附加)。
// ══════════════════════════════════════════════════════════════════════════════
regPre('塗標客|惡作劇作畫', (s) => ({ state: s, damage: 0 }));
regPost('塗標客|惡作劇作畫', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const energyIids = opp.discard.filter(c => pool.get(c.cardId)?.supertype === 'Energy').map(c => c.iid);
  const hasOppTarget = !!opp.active || opp.bench.length > 0;
  if (energyIids.length === 0 || !hasOppTarget) return addLog(state, '惡作劇作畫：對手棄牌區無能量或對手無寶可夢', aIdx);
  return withPending(addLog(state, `惡作劇作畫：從對手棄牌區選最多 ${Math.min(3, energyIids.length)} 張能量（之後逐張選對手寶可夢附加）`, aIdx), {
    type: 'discard-search',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,  // 從對手(dIdx)棄牌區選,由攻擊方(aIdx)決定
    filter: 'Energy',
    minCount: 0, maxCount: Math.min(3, energyIids.length),
    effectKey: 'prank-paint-pick-energy',
    // v6.125 卡面：「從對手的棄牌區選擇最多3張能量卡，**以任意方式**附於對手的寶可夢身上。」→ 可選 0
    params: { validIids: energyIids, allowSkipZero: true },
  });
});
// helper:逐張把 buffered 能量(仍在對手棄牌區)附到攻擊方選的對手寶可夢
function prankPaintDistribute(state: GameState, aIdx: 0 | 1, energyQueue: string[], pool: Map<string, Card>): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (energyQueue.length === 0) return state;
  const opp = state.players[dIdx];
  const validTargets = [...(opp.active ? [opp.active.iid] : []), ...opp.bench.map(b => b.iid)];
  if (validTargets.length === 0) return addLog(state, '惡作劇作畫：對手無寶可夢可附加，剩餘能量留在棄牌區', aIdx);
  const eName = pool.get(state.players[dIdx].discard.find(c => c.iid === energyQueue[0])?.cardId ?? '')?.name ?? '能量';
  return withPending(addLog(state, `惡作劇作畫：選 1 隻對手寶可夢附加「${eName}」（剩 ${energyQueue.length} 張）`, aIdx), {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'prank-paint-attach-one',
    params: { validIids: validTargets, includeActive: true, queue: energyQueue },
  });
}
regR('prank-paint-pick-energy', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(state, '惡作劇作畫：未選擇能量，效果結束', aIdx);
  return prankPaintDistribute(state, aIdx, iids, pool);
});
regR('prank-paint-attach-one', (state, aIdx, targetIids, params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const queue = (params?.queue as string[]) ?? [];
  const energyIid = queue[0];
  const targetIid = targetIids[0];
  if (!energyIid) return state;
  const energy = state.players[dIdx].discard.find(c => c.iid === energyIid);
  if (!energy || !targetIid) return prankPaintDistribute(state, aIdx, queue.slice(1), pool);
  // 從對手棄牌區移除該能量 → 附到選中的對手寶可夢
  let s = updatePlayer(state, dIdx, p => ({
    ...p,
    discard: p.discard.filter(c => c.iid !== energyIid),
    active: p.active && p.active.iid === targetIid ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] } : p.active,
    bench: p.bench.map(b => b.iid === targetIid ? { ...b, energyAttached: [...b.energyAttached, energy] } : b),
  }));
  const tName = pool.get([...(s.players[dIdx].active ? [s.players[dIdx].active] : []), ...s.players[dIdx].bench].find(pk => pk?.iid === targetIid)?.cardId ?? '')?.name ?? '?';
  s = addLog(s, `惡作劇作畫：將「${pool.get(energy.cardId)?.name ?? '能量'}」附於對手的 ${tName}`, aIdx);
  return prankPaintDistribute(s, aIdx, queue.slice(1), pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 25. 厄鬼椪 碧草面具ex|萬葉陣雨 30+ — 雙方戰鬥能量數合計 ×30
//    （Wave 2 audit 因字符邊界誤報，這裡確認註冊）
// ══════════════════════════════════════════════════════════════════════════════
// Wave 2 已註冊，此處 skip

// ══════════════════════════════════════════════════════════════════════════════
// 26. 呆呆王|付諸東流 70 — 若希望，選擇 2 個對手戰鬥寶可夢身上的能量，放回對手手牌。
// v3.27：從自動取末端改為 picker；minCount=0 對應「若希望」可選 0∼2 張。
// ══════════════════════════════════════════════════════════════════════════════
regPre('呆呆王|付諸東流', (s) => ({ state: s, damage: 70 }));
regPost('呆呆王|付諸東流', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '付諸東流：選擇「否」 — 不放回對手能量', aIdx);
  const _cb: AttackPostFn = (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.776：對手戰鬥位被本招式傷害 KO（active=null）→ 官方順序「效果先於昏厥」，仍可把 KO 前戰鬥位能量
  //   （此刻在棄牌區，_koDefenderSnapshot）放回對手手牌。
  // v5.986 平穩境地：提前到 KO 分支之前(原 gate 在 KO early-return 之後→KO 分支繞過)。
  //   被回手的是「對手」的卡(含 KO 前戰鬥位能量快照) → 我方側有平穩境地則擋。
  if (_calmGroundBlocks(state, (1 - aIdx) as 0 | 1, pool)) {
    return addLog(state, '對手能量回手效果：我方場上有【平穩境地】，無效', aIdx);
  }
  if (!state.players[dIdx].active) {
    const _koE = getKODefenderEnergyInDiscard(state, dIdx).map(e => e.iid);
    if (_koE.length === 0) return addLog(state, '付諸東流：對手戰鬥無可放回的能量', aIdx);
    const _capKO = Math.min(2, _koE.length);
    return withPending(addLog(state, '付諸東流：對手戰鬥寶可夢已昏厥 — 可從棄牌區將其能量放回對手手牌', aIdx), {
      type: 'active-energy-discard', actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 0, maxCount: _capKO,
      effectKey: 'v327-slowking-flush',
      params: { fromDiscard: true, validIids: _koE, titleOverride: `選擇要放回對手手牌的能量（0∼${_capKO} 張，已昏厥戰鬥位）` },
    });
  }
  const da = state.players[dIdx].active;
  if (!da || da.energyAttached.length === 0) return addLog(state, '付諸東流：對手戰鬥無能量', aIdx);
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋
  if (_calmGroundBlocks(state, (1 - aIdx) as 0 | 1, pool)) { // v5.985 被回手的是對手的卡
    return addLog(state, '付諸東流：對手場上有【平穩境地】，能量回手效果無效', aIdx);
  }
  const cap = Math.min(2, da.energyAttached.length);
  const s = addLog(state, `付諸東流：選擇 0∼${cap} 個對手戰鬥位能量放回對手手牌`, aIdx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: cap,
    effectKey: 'v327-slowking-flush',
    params: { titleOverride: `選擇要放回對手手牌的能量（0∼${cap} 張）` },
  });
};
  return _cb(state, aIdx, pool);
});
regR('v327-slowking-flush', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '付諸東流：玩家選擇不發動效果', idx);
  const dIdx = (1 - idx) as 0 | 1;
  // v5.776：能量可能在對手 active(未KO)或棄牌區(已被本招式KO)→ source-agnostic pluck。
  let dp = st.players[dIdx];
  const moved: CardInstance[] = [];
  for (const iid of iids) {
    const r = pluckOppEnergyActiveOrDiscard(dp, iid);
    if (r.energy) { dp = r.player; moved.push(r.energy); }
  }
  if (moved.length === 0) return st;
  const names = moved.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...dp, hand: [...dp.hand, ...moved] };
  return addLog({ ...st, players }, `付諸東流：將對手戰鬥位的 ${names}（${moved.length} 張）放回對手手牌`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 27. 下石鳥|墜擊射 — 棄全能量，對手 1 隻寶可受 120（不計弱抗）
// ══════════════════════════════════════════════════════════════════════════════
regPre('下石鳥|墜擊射', (s) => ({ state: s, damage: 0, skipWeakRes: true }));
regPost('下石鳥|墜擊射', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('墜擊射')(state, aIdx, pool);
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = s.players[dIdx];
  if (!opp.active && opp.bench.length === 0) return s;
  return withPending(addLog(s, '墜擊射：選 1 對手寶可受 120', aIdx), {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-hit-any-120',
  });
});
regR('h-wave3-hit-any-120', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  // v5.437：改走中央 dealAttackDamageToTarget（免疫/弱抗/KO/受傷反擊一次到位；
  //   原本只有 guard 無 KO/弱抗）。卡面「120 點傷害，[備戰不計弱抗]」→ active 計弱點。
  let s = state;
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, 120, pool, { kind: 'attack-damage', label: '墜擊射' });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// 纏紅鶴ex|[ex規則] — 不是招式效果，是 ex KO 規則描述，無需實裝

// ══════════════════════════════════════════════════════════════════════════════
// Wave 3 統計：28 張收尾
// ══════════════════════════════════════════════════════════════════════════════
