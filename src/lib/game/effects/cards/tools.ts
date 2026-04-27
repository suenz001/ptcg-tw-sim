/**
 * 寶可夢道具（Pokemon Tool）效果模組
 *
 * v2.09 (Session 38b6)：從 effects.ts 抽離 Session 33 的 TOOL_* 登錄表 + 附加
 * 機制，作為模組化第三波（第一波 _shared、第二波 white_lily_akamatsu）。
 *
 * 本檔包含：
 *   - toolAttachEffect(toolName) — 附加道具到己方寶可夢的 EffectFn 工廠
 *   - reg('氣球' / '龐克頭盔') — 兩張有特殊原因需顯式登錄的道具
 *   - regR('attach-tool') — heal-target 選擇後把道具 attach 到目標寶可夢
 *   - TOOL_* 八張登錄表（HP_BONUS / ATTACK_BONUS / DEFENSE_REDUCE_BY_TYPE /
 *     PREVENT_KO / ON_KO / PRIZE_BONUS / ON_DAMAGED / RETREAT_MOD）
 *   - TOOL_BOTH_SIDES_RETREAT_PLUS Set
 *   - 每張具體道具的效果登錄（英雄斗篷、勇氣護符、極限腰帶、豪華斗篷 …）
 *   - 自動 attach reg 區塊（將所有在 TOOL_* 中登錄的道具自動補 attach effect）
 *
 * 下游：
 *   - engine.ts 透過 effects.ts re-export 取用 TOOL_* Maps
 *   - effects.ts 的 effectiveHPInline() 仍需 TOOL_HP_BONUS 計算有效 HP
 *
 * 註：本檔為 side-effect 模組 — import 它即完成所有登錄。
 *
 * 搬遷原則：內容逐字 copy 自原 effects.ts，不更動任何邏輯；只把 莉莉艾的珍珠
 * 從檔尾搬前（使其也被自動登記區覆蓋），於是可拿掉原先的 if-guard。
 */

import type { Card, EnergyType } from '$lib/cards/types';
import type { GameState, CardInstance } from '../../types';
import type { EffectFn } from '../_shared';
import {
  TRAINER_EFFECTS,
  reg, regR,
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// Session 33 — 寶可夢道具（Tool）效果登錄表
//
// 設計：每個 tool 的效果都是一小段「在 ATTACK 流程特定時機觸發」的 hook。
// 引擎在 ATTACK handler 查表呼叫，沒註冊的 tool 沒效果。
//
// 觸發點（依序）：
//   1. TOOL_HP_BONUS            — 防守方有效 HP 增加（影響 KO 判定）
//   2. TOOL_ATTACK_BONUS        — 攻擊方 +N 傷害（weakness 後）
//   3. TOOL_DEFENSE_REDUCE_BY_TYPE — 攻擊屬性符合時防守方 -N，觸發後丟棄道具
//   4. TOOL_PREVENT_KO          — 滿血被 KO 時保留 HP，觸發後丟棄道具
//   5. TOOL_ON_KO               — 被 KO 時的額外效果（如抽牌、移能量）
//   6. TOOL_PRIZE_BONUS         — 被 KO 時對手多獲 N 張獎賞
//   7. TOOL_ON_DAMAGED          — 被打到但未 KO 時觸發（如反傷、抽牌）
//   8. TOOL_RETREAT_MOD         — 撤退成本修正
// ══════════════════════════════════════════════════════════════════════════════

export const TOOL_HP_BONUS = new Map<string, (holderCard: Card) => number>();
export const TOOL_ATTACK_BONUS = new Map<string, (
  attackerCard: Card, attackerInst: CardInstance,
  defenderCard: Card, defenderInst: CardInstance
) => number>();
export const TOOL_DEFENSE_REDUCE_BY_TYPE = new Map<string, {
  amount: number;
  types: EnergyType[];
  discardOnTrigger: boolean;
  /** v2.176: holder 自身屬性過濾 — 只在 holder 屬於這些屬性時觸發；空 = 無 holder 限制 */
  holderTypes?: EnergyType[];
}>();
/**
 * v2.176: 防守方道具 — 攻擊方擁有特性時 -N（神聖護符）
 * Hook：fn(attackerCard) => amount。回傳 0 = 不觸發。
 */
export const TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY = new Map<string, (
  attackerCard: Card
) => number>();
export const TOOL_PREVENT_KO = new Map<string, (
  holderInst: CardInstance, holderCard: Card, incomingDamage: number
) => { prevent: boolean; leaveHP: number }>();
export const TOOL_ON_KO = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, pool: Map<string, Card>
) => GameState>();
export const TOOL_PRIZE_BONUS = new Map<string, (holderCard: Card) => number>();
export const TOOL_ON_DAMAGED = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, damage: number, pool: Map<string, Card>
) => GameState>();
export const TOOL_RETREAT_MOD = new Map<string, (
  holderCard: Card, holderInst: CardInstance
) => { reduceBy?: number; zero?: boolean }>();

// ── HP 加成 ──────────────────────────────────────────────────────────────────
TOOL_HP_BONUS.set('英雄斗篷', () => 100);
TOOL_HP_BONUS.set('勇氣護符', (card) => !card.evolvesFrom ? 50 : 0);
TOOL_HP_BONUS.set('豪華斗篷', (card) => {
  const isRulePoke = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX')
    || !!card.rulesText?.includes('擁有規則');
  return isRulePoke ? 0 : 100;
});
// 驅勁能量 古代/未來：簡化 — 不檢查「古代/未來」標籤，附上就生效（UI 層不會附錯）
TOOL_HP_BONUS.set('驅勁能量 古代', () => 60);
// Wave 42：竹蘭的力量負重（道具）— 「竹蘭的」寶可夢 HP +70
TOOL_HP_BONUS.set('竹蘭的力量負重', (card) => card.name.includes('竹蘭的') ? 70 : 0);

// ── 攻擊加成（我方帶此道具 → 打出時 +N）────────────────────────────────────
TOOL_ATTACK_BONUS.set('極限腰帶', (_a, _ai, defCard) => {
  const isEx = defCard.subtype === 'ex' || defCard.name.endsWith('ex') || defCard.name.endsWith('EX');
  return isEx ? 50 : 0;
});
TOOL_ATTACK_BONUS.set('鎖鏈糬', (_a, atkInst) => atkInst.status === 'poisoned' ? 40 : 0);
TOOL_ATTACK_BONUS.set('驅勁能量 未來', () => 20);
// v2.133 電氣球：附有的「皮卡丘ex」對對手戰鬥場的「寶可夢ex」+50
TOOL_ATTACK_BONUS.set('電氣球', (attCard, _ai, defCard) => {
  if (attCard.name !== '皮卡丘ex') return 0;
  const isDefEx = defCard.subtype === 'ex' || defCard.name.endsWith('ex') || defCard.name.endsWith('EX');
  return isDefEx ? 50 : 0;
});
// v2.170 活力頭帶：使用招式 +10 傷害
TOOL_ATTACK_BONUS.set('活力頭帶', () => 10);
// v2.170 赫普的講究頭帶：「赫普的」寶可夢招式 +30
//   注意：「能量減少 1 個【無】」部分需要 cost hook，本版未實裝（已記入 SKIPPED）
TOOL_ATTACK_BONUS.set('赫普的講究頭帶', (atkCard) =>
  atkCard.name?.startsWith('赫普的') ? 30 : 0);

// ── 特定屬性防禦（防守方帶此道具 → 特定屬性攻擊 -60，觸發即丟棄） ─────────
TOOL_DEFENSE_REDUCE_BY_TYPE.set('福祿果', { amount: 60, types: ['Psychic'], discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('巧可果', { amount: 60, types: ['Fire'],    discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('千香果', { amount: 60, types: ['Water'],   discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('刺耳果', { amount: 60, types: ['Darkness'], discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('霹霹果', { amount: 60, types: ['Metal'],   discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('莓榴果', { amount: 60, types: ['Dragon'],  discardOnTrigger: true });

// v2.176 渾厚鱗片：附有這張卡的【龍】寶可夢，受到對手【草】【火】【水】【雷】招式 -50（不丟棄）
TOOL_DEFENSE_REDUCE_BY_TYPE.set('渾厚鱗片', {
  amount: 50,
  types: ['Grass', 'Fire', 'Water', 'Lightning'],
  discardOnTrigger: false,
  holderTypes: ['Dragon'],
});

// v2.176 神聖護符：附有這張卡的寶可夢，受到對手擁有特性的寶可夢招式 -30（不丟棄）
TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY.set('神聖護符', (attackerCard) => {
  return (attackerCard.abilities && attackerCard.abilities.length > 0) ? 30 : 0;
});

// ── 防 KO（滿血被 KO 時留 10 HP） ─────────────────────────────────────────
TOOL_PREVENT_KO.set('倖存鍛鍊器', (inst, card) => {
  const hp = card.hp ?? 0;
  if (inst.damage === 0 && hp > 10) return { prevent: true, leaveHP: 10 };
  return { prevent: false, leaveHP: 0 };
});

// ── 被 KO 時效果 ───────────────────────────────────────────────────────────
TOOL_ON_KO.set('希望護身符', (state, dIdx) => {
  // 從牌庫抽 3 張（簡化為固定抽頂 3 張；原文為「任意選擇最多 3 張」）
  state = addLog(state, '希望護身符：從牌庫抽 3 張', dIdx);
  return updatePlayer(state, dIdx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, deck: shuffle(p.deck.slice(3)), hand: [...p.hand, ...taken] };
  });
});
TOOL_ON_KO.set('沉重接力棒', (state, dIdx, _aIdx, pool) => {
  // 只對【撤退】所需 4 能量的寶可夢生效
  // 注意：此 hook 在 KO 後呼叫，被 KO 的 active 已經進棄牌。要從棄牌找能量。
  // 簡化：移除棄牌區最近丟進去的基本能量（最多 3 張），改附於第一個備戰。
  const player = state.players[dIdx];
  if (player.bench.length === 0) return state;
  // 找棄牌區最後 N 張基本能量（剛剛被 KO 時一起丟進去的）
  const revIds: string[] = [];
  for (let i = player.discard.length - 1; i >= 0 && revIds.length < 3; i--) {
    const c = player.discard[i];
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic') {
      revIds.push(c.iid);
    } else {
      break; // 非能量則停止（只看最上面的批次）
    }
  }
  if (revIds.length === 0) return state;
  const benchTarget = player.bench[0];
  const benchName = benchTarget ? (pool.get(benchTarget.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  state = addLog(state, `沉重接力棒：將 ${revIds.length} 張基本能量附加到 ${benchName}`, dIdx);
  return updatePlayer(state, dIdx, p => {
    const energies = p.discard.filter(c => revIds.includes(c.iid));
    const newDiscard = p.discard.filter(c => !revIds.includes(c.iid));
    const target = p.bench[0];
    const newBench = [...p.bench];
    newBench[0] = { ...target, energyAttached: [...target.energyAttached, ...energies] };
    return { ...p, discard: newDiscard, bench: newBench };
  });
});

// ── 被擊倒時對手多獲 1 張獎賞 ─────────────────────────────────────────────
TOOL_PRIZE_BONUS.set('豪華斗篷', (card) => {
  const isRulePoke = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX')
    || !!card.rulesText?.includes('擁有規則');
  return isRulePoke ? 0 : 1;
});

// ── 莉莉艾的珍珠（Pokemon Tool） ────────────────────────────────────────────
// 裝備者若為「擁有規則」寶可夢（ex / 超級ex），被擊倒時對手取得的獎勵牌 -1。
// 實作：TOOL_PRIZE_BONUS 回傳負值（已由 engine Math.max(0, ...) clamp）。
// 其他寶可夢裝備時無效果（回 0）。
// v2.09：從 effects.ts 底部搬到這，統一讓自動登記區塊處理 attach effect，
// 不需原先的 if (!TRAINER_EFFECTS.has(...)) guard。
TOOL_PRIZE_BONUS.set('莉莉艾的珍珠', (card) => {
  const isRulePoke = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX')
    || !!card.rulesText?.includes('擁有規則');
  return isRulePoke ? -1 : 0;
});

// ── 受傷（未 KO）觸發 ──────────────────────────────────────────────────────
TOOL_ON_DAMAGED.set('幸運頭盔', (state, dIdx) => {
  state = addLog(state, '幸運頭盔：抽 2 張', dIdx);
  return updatePlayer(state, dIdx, p => {
    const taken = p.deck.slice(0, 2);
    return { ...p, deck: p.deck.slice(2), hand: [...p.hand, ...taken] };
  });
});
// v2.170 凸凸頭盔：受傷時對攻擊方 +20 傷害（2 個傷害指示物）
TOOL_ON_DAMAGED.set('凸凸頭盔', (state, _dIdx, aIdx) => {
  return updatePlayer(addLog(state, '凸凸頭盔：對攻擊方放置 2 個傷害指示物（+20）', null), aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 20 } };
  });
});
// v2.170 火箭隊的催眠裝置：受傷時若 holder 為「火箭隊的」寶可夢，將攻擊方睡眠
TOOL_ON_DAMAGED.set('火箭隊的催眠裝置', (state, dIdx, aIdx, _dmg, pool) => {
  const dp = state.players[dIdx];
  const holder = dp.active;
  if (!holder) return state;
  const holderCard = pool.get(holder.cardId);
  if (!holderCard?.name?.startsWith('火箭隊的')) return state;
  return updatePlayer(addLog(state, '火箭隊的催眠裝置：將攻擊方睡眠', null), aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, status: 'asleep' } };
  });
});
// v2.170 逆境保險：受傷時若 holder 弱點屬性 = 攻擊方屬性，從牌庫抽 3 張
TOOL_ON_DAMAGED.set('逆境保險', (state, dIdx, aIdx, _dmg, pool) => {
  const dp = state.players[dIdx];
  const ap = state.players[aIdx];
  if (!dp.active || !ap.active) return state;
  const dCard = pool.get(dp.active.cardId);
  const aCard = pool.get(ap.active.cardId);
  if (!dCard || !aCard) return state;
  const weakness = dCard.weakness?.[0]?.type;
  if (!weakness || weakness !== aCard.pokemonType) return state;
  return updatePlayer(addLog(state, '逆境保險：弱點屬性匹配 → 抽 3 張', dIdx), dIdx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, deck: p.deck.slice(taken.length), hand: [...p.hand, ...taken] };
  });
});
TOOL_ON_DAMAGED.set('奢華炸彈', (state, dIdx, aIdx) => {
  // 反彈 120 傷害到攻擊方，且道具丟棄
  state = updatePlayer(state, dIdx, p => {
    if (!p.active || !p.active.toolAttached) return p;
    const tool = p.active.toolAttached;
    return { ...p, active: { ...p.active, toolAttached: undefined }, discard: [...p.discard, tool] };
  });
  state = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 120 } };
  });
  return addLog(state, '奢華炸彈：反彈 120 傷害！', null);
});

// v2.210 手持循環扇：受傷未 KO 時，holder 從 attacker.active 選 1 個能量，
//   改附到 attacker 的 1 隻備戰寶可夢。對攻擊方不利（抽走主力能量）。
// 卡面：「附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，選擇 1 個
//   使用招式的寶可夢身上附加的能量，改附於對手的備戰寶可夢身上。」
// 觸發：holder 在戰鬥場 + 受到對手招式傷害（已由 engine ATTACK 流程確保）
// actor = dIdx（防守方/holder 端做選擇）
// 兩段 pending：
//   1. modal-choice：列出 attacker.active 的能量為 options
//   2. opp-bench-choose：選 attacker 備戰寶可夢
TOOL_ON_DAMAGED.set('手持循環扇', (state, dIdx, aIdx, _dmg, pool) => {
  const ap = state.players[aIdx];
  if (!ap.active || ap.active.energyAttached.length === 0) {
    // 攻擊方戰鬥位無能量 → 無效果
    return state;
  }
  if (ap.bench.length === 0) {
    // 攻擊方無備戰寶可夢 → 沒地方放，無效果
    return state;
  }
  // 列出能量選項
  const energyOptions = ap.active.energyAttached.map((e, i) => ({
    id: `${i}`,
    text: `${pool.get(e.cardId)?.name ?? '能量'}`,
  }));
  state = addLog(state,
    '手持循環扇：選 1 個攻擊方能量改附到攻擊方備戰',
    dIdx);
  return withPending(state, {
    type: 'modal-choice',
    actorIdx: dIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cycle-fan-step1-pick-energy',
    params: { label: '手持循環扇：選 1 個攻擊方戰鬥位能量', options: energyOptions },
  });
});
// resolver step 1: 移除選中能量，開 step 2 選 attacker bench
regR('cycle-fan-step1-pick-energy', (st, dIdx, iids, _params, _pool) => {
  const aIdx = (1 - dIdx) as 0 | 1;
  const ap = st.players[aIdx];
  const choiceIdx = parseInt(iids[0] ?? '-1', 10);
  if (isNaN(choiceIdx) || choiceIdx < 0 || !ap.active || choiceIdx >= ap.active.energyAttached.length) {
    return addLog(st, '手持循環扇：選擇無效，效果取消', dIdx);
  }
  const removed = ap.active.energyAttached[choiceIdx];
  // 從 attacker.active 移除能量
  st = updatePlayer(st, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: {
        ...p.active,
        energyAttached: [
          ...p.active.energyAttached.slice(0, choiceIdx),
          ...p.active.energyAttached.slice(choiceIdx + 1),
        ],
      },
    };
  });
  // 開 step 2：選 attacker 備戰；用 params 暫存被移除的能量 CardInstance
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cycle-fan-step2-place-energy',
    params: { energy: removed },
  });
});
// resolver step 2: 把暫存能量附到選中的 attacker 備戰
regR('cycle-fan-step2-place-energy', (st, dIdx, iids, params, pool) => {
  const aIdx = (1 - dIdx) as 0 | 1;
  const targetIid = iids[0];
  const energy = params?.energy as CardInstance | undefined;
  if (!targetIid || !energy) {
    return addLog(st, '手持循環扇：缺少能量或目標，效果取消', dIdx);
  }
  const ap = st.players[aIdx];
  const target = ap.bench.find(c => c.iid === targetIid);
  if (!target) {
    return addLog(st, '手持循環扇：找不到目標備戰寶可夢，效果取消', dIdx);
  }
  const energyName = pool.get(energy.cardId)?.name ?? '能量';
  const targetName = pool.get(target.cardId)?.name ?? '?';
  st = addLog(st,
    `手持循環扇：${energyName} 改附到 ${targetName}（攻擊方備戰）`,
    dIdx);
  return updatePlayer(st, aIdx, p => ({
    ...p,
    bench: p.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energy] }
      : c),
  }));
});

// ── 撤退成本修正 ──────────────────────────────────────────────────────────
TOOL_RETREAT_MOD.set('緊急滑板', (card, inst) => {
  const hp = card.hp ?? 0;
  const remaining = hp - inst.damage;
  if (remaining <= 30) return { zero: true };
  return { reduceBy: 1 };
});
TOOL_RETREAT_MOD.set('驅勁能量 未來', () => ({ zero: true }));
// 氣球 已有既存 engine 支援（retreat -2），這裡補註冊好保持一致性
TOOL_RETREAT_MOD.set('氣球', () => ({ reduceBy: 2 }));

// ── 重力之玉：雙方撤退 +1（需要 engine 層在計算兩側時查對面 tool） ─────
// 用一個獨立的 flag 標記，engine 計算撤退時若雙方任一 active 帶此 tool，則 +1
export const TOOL_BOTH_SIDES_RETREAT_PLUS = new Set<string>();
TOOL_BOTH_SIDES_RETREAT_PLUS.add('重力之玉');

// ══════════════════════════════════════════════════════════════════════════════
// 道具附加機制：toolAttachEffect + 氣球 / 龐克頭盔 reg + attach-tool resolver
// （從 effects.ts line 1295-1344 區塊搬入，邏輯不變）
// ══════════════════════════════════════════════════════════════════════════════

function toolAttachEffect(toolName: string): EffectFn {
  return (st, idx, _pool, toolInst) => {
    const p = st.players[idx];
    const allInPlay = [...(p.active ? [p.active] : []), ...p.bench];
    const validIids = allInPlay.filter(pk => !pk.toolAttached).map(pk => pk.iid);
    if (validIids.length === 0) return addLog(st, `${toolName}：沒有可附加道具的寶可夢`, idx);
    st = addLog(st, `${toolName}：選擇要附加的寶可夢`, idx);
    return withPending(st, {
      type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1, filter: '',
      effectKey: 'attach-tool',
      params: { toolInst, validIids },
    });
  };
}
reg('氣球', toolAttachEffect('氣球'));
reg('龐克頭盔', toolAttachEffect('龐克頭盔'));

regR('attach-tool', (st, idx, picked, params, pool) => {
  const targetIid = picked[0];
  const toolInst = params?.toolInst as CardInstance;
  if (!toolInst) return st;
  // Defensive check：target 已有道具則拒絕附加（一隻寶可夢只能附加一個道具）
  const p = st.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  const target = all.find(c => c.iid === targetIid);
  if (target?.toolAttached) {
    // 把本道具放回手牌（避免使用者損失道具）
    return updatePlayer(
      addLog(st, '附加失敗：目標寶可夢已有道具，道具回到手牌', idx),
      idx,
      pl => ({ ...pl, hand: [...pl.hand, toolInst] })
    );
  }
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const toolName = pool.get(toolInst.cardId)?.name ?? '道具';
  st = addLog(st, `🔧 ${toolName} 附加到 ${targetName}`, idx);
  return updatePlayer(st, idx, p => {
    const attach = (pk: CardInstance): CardInstance =>
      pk.iid === targetIid ? { ...pk, toolAttached: toolInst } : pk;
    return {
      ...p,
      active: p.active ? attach(p.active) : null,
      bench: p.bench.map(attach),
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 道具卡自動登記 attach effect（Wave 42 bugfix）
//
// 背景：任何登錄在 TOOL_* 映射中的道具，都需要 TRAINER_EFFECTS 中有對應的
// attach resolver，否則 engine 的 PLAY_TRAINER 會走到 isTool 分支但找不到
// effect 而 log「效果尚未實裝」，結果卡片既沒附上寶可夢、也沒回手牌，
// 直接從手牌消失。原本只有 氣球 / 龐克頭盔 有顯式 reg，其他（英雄斗篷、
// 勇氣護符、豪華斗篷、極限腰帶、鎖鏈糬、驅勁能量、倖存鍛鍊器、希望護身符、
// 沉重接力棒、幸運頭盔、奢華炸彈、緊急滑板、福祿果系列、重力之玉、
// 竹蘭的力量負重、莉莉艾的珍珠 …）都是隱性 broken，直到 Leon 實際測試到才發現。
// 這裡統一掃過所有 TOOL_* 結構，未被任何 reg() 蓋過者即註冊 toolAttachEffect。
// ══════════════════════════════════════════════════════════════════════════════

{
  const toolNames = new Set<string>([
    ...TOOL_HP_BONUS.keys(),
    ...TOOL_ATTACK_BONUS.keys(),
    ...TOOL_DEFENSE_REDUCE_BY_TYPE.keys(),
    ...TOOL_PREVENT_KO.keys(),
    ...TOOL_ON_KO.keys(),
    ...TOOL_PRIZE_BONUS.keys(),
    ...TOOL_ON_DAMAGED.keys(),
    ...TOOL_RETREAT_MOD.keys(),
    ...TOOL_BOTH_SIDES_RETREAT_PLUS,
  ]);
  for (const name of toolNames) {
    if (!TRAINER_EFFECTS.has(name)) {
      reg(name, toolAttachEffect(name));
    }
  }
}
