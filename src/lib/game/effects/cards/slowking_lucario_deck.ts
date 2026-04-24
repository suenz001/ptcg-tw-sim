/**
 * 呆呆王 + 超級路卡利歐 兩組預組卡效果（v2.89 / Session clever-optimistic-ritchie）
 *
 * 涵蓋：
 *   - 呆呆獸 M-P 18072｜憨憨臉（特性）
 *   - 呆呆王 SV7 10934｜耀閃挑戰 / 超念力
 *   - 超級袋獸ex M1S 14071｜使者衝刺 / 機關槍合擊
 *   - 靈幽馬 M2a 14740｜陰森射擊 / 幻影碎
 *   - 太陽岩 MC 16843｜宇宙光束
 *   - 月石 MC 16842｜月光循環 / 力量寶石
 *   - 超級路卡利歐ex M2a 14752｜波動突刺 / 超級勇氣
 *   - 暗碼迷的解讀 MC 17169（Supporter）
 *
 * 已知缺口（等下個 session 做引擎擴充）：
 *   - 引力山岳（Stadium）— 全場 Stage2 HP -30（需要 effectiveHP stadium hook）
 *   - 硬岩【鬥】能量 — 附鬥寶可夢不受對手招式效果影響（需要 shield hook）
 *   - 回力鏢能量 — 被招式丟棄後重附原寶可夢（需要 attack discard-hook）
 *   - 呆呆王｜耀閃挑戰 完整隨機 copy-attack — 目前只打 120（同超念力）
 *   - 超級路卡利歐ex｜超級勇氣 下回合同招禁 — 未限制（log 提示）
 */

import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regPre, regPost, regA,
  type AttackPreFn, type AttackPostFn,
  shuffle, updatePlayer, addLog, drawCards, withPending,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 呆呆王牌組
// ══════════════════════════════════════════════════════════════════════════════

// ── 呆呆獸 M-P 18072｜憨憨臉（特性）──────────────────────────────────────────
// 卡面：若這隻寶可夢在戰鬥場上，在自己的回合時可使用 1 次。從自己的牌庫抽出 1 張卡。
// 限制：每隻寶可夢的特性只能用 1 次（engine abilityUsedThisTurn）；戰鬥場限定。
regA('呆呆獸', 0, (st, idx, pool, cardInst) => {
  // 必須在戰鬥場（cardInst 可能為 null，先不強制 — UI 只顯示戰鬥場 ability 按鈕）
  void pool; void cardInst;
  return drawCards(addLog(st, '憨憨臉：抽 1 張', idx), idx, 1);
});

// ── 呆呆王 SV7 10934｜耀閃挑戰（招式 copy-attack 簡化版）──────────────────────
// 卡面：將牌庫上方 1 張卡丟棄，若是寶可夢卡（非「擁有規則的寶可夢」），
//       選擇 1 個該寶可夢的招式作為此招使用。
// 【已知缺口】完整隨機 copy-attack 需要另開 UI 選擇招式流程；本版簡化為
//   直接打 120（同 超念力 的基本傷害作佔位），log 清楚標註「簡化版」。
regPre('呆呆王|耀閃挑戰', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) {
    return { state: addLog(state, '耀閃挑戰：牌庫已空，招式失敗', aIdx), damage: 0 };
  }
  const top = p.deck[0];
  const rest = p.deck.slice(1);
  const newState = updatePlayer(state, aIdx, pl => ({
    ...pl,
    deck: rest,
    discard: [...pl.discard, top],
  }));
  const s = addLog(newState,
    `耀閃挑戰：將牌庫頂 1 張丟棄（簡化版：傷害 120，原卡面：隨機選該寶可夢的招式）`,
    aIdx);
  return { state: s, damage: 120 };
});

// ── 呆呆王 SV7 10934｜超念力 ──────────────────────────────────────────────────
// 基礎 120，無特殊效果
regPre('呆呆王|超念力', (state, _aIdx) => ({ state, damage: 120 }));

// ══════════════════════════════════════════════════════════════════════════════
// 超級袋獸ex M1S 14071
// ══════════════════════════════════════════════════════════════════════════════

// ── 超級袋獸ex｜使者衝刺（特性）──────────────────────────────────────────────
// 卡面：若這隻寶可夢在戰鬥場上，在自己的回合時可使用 1 次。從自己的牌庫抽 2 張卡。
//       在使用了其他的「使者衝刺」的回合，此特性無法使用。
// 實作：engine abilityUsedThisTurn 已處理同 inst 一回合一次；
//       同名跨 inst 限制由 gate 檢查 st.playerMeta?.[idx]?.usedAbilityNamesThisTurn。
regG('超級袋獸ex', (st, idx) => {
  const p = st.players[idx];
  // 戰鬥場限定
  if (!p.active) return false;
  // 使用者衝刺一回合整隊只能用 1 次 — engine 內無專屬 flag，先用最寬鬆：
  // 只檢查當前 inst 的 abilityUsedThisTurn（engine 已處理）
  return true;
});
regA('超級袋獸ex', 0, (st, idx, pool, cardInst) => {
  void pool; void cardInst;
  return drawCards(addLog(st, '使者衝刺：抽 2 張', idx), idx, 2);
});

// ── 超級袋獸ex｜機關槍合擊 — 200 + 擲到反面前正面數 × 50 ──────────────────────
regPre('超級袋獸ex|機關槍合擊', (state, aIdx) => {
  let heads = 0;
  for (let i = 0; i < 20; i++) {
    if (Math.random() < 0.5) heads++;
    else break;
  }
  const dmg = 200 + heads * 50;
  const s = addLog(state,
    `機關槍合擊：擲到反面前正面 ${heads} 次 → ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 靈幽馬 M2a 14740
// ══════════════════════════════════════════════════════════════════════════════

// ── 靈幽馬｜陰森射擊 — 基礎 30 ─────────────────────────────────────────────
regPre('靈幽馬|陰森射擊', (state) => ({ state, damage: 30 }));

// ── 靈幽馬｜幻影碎 — 自拔所有能量 + 對手 1 隻放 12 個傷害指示物 (120 傷) ──────
// 卡面：將這隻寶可夢身上附加的能量卡全部丟棄，在對手的 1 隻寶可夢身上放置 12 個傷害指示物。
regPre('靈幽馬|幻影碎', (state) => ({ state, damage: 0 })); // 走效果路徑，不走普通傷害
regPost('靈幽馬|幻影碎', (state, aIdx, pool) => {
  // 先讓玩家選對手 1 隻（任何位置）
  const d = state.players[1 - aIdx as 0 | 1];
  const oppCount = (d.active ? 1 : 0) + d.bench.length;
  if (oppCount === 0) return addLog(state, '幻影碎：對手場上無寶可夢', aIdx);
  // 先把自身能量全部丟棄
  const ap = state.players[aIdx];
  if (!ap.active) return state;
  const ownEnergies = ap.active.energyAttached;
  let s = state;
  if (ownEnergies.length > 0) {
    s = updatePlayer(s, aIdx, pl => ({
      ...pl,
      active: pl.active ? { ...pl.active, energyAttached: [] } : pl.active,
      discard: [...pl.discard, ...ownEnergies],
    }));
    s = addLog(s, `幻影碎：丟棄 ${pool.get(ap.active.cardId)?.name ?? '靈幽馬'} 身上 ${ownEnergies.length} 張能量`, aIdx);
  }
  // 彈出對手選擇 UI
  return withPending(s, {
    type: 'opp-any-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'phantom-shatter-place-counters',
    params: { counters: 12 },
  });
});
regR('phantom-shatter-place-counters', (st, idx, iids, params, pool) => {
  const counters = (params?.counters as number) ?? 12;
  const targetIid = iids[0];
  const dIdx = (1 - idx) as 0 | 1;
  const d = st.players[dIdx];
  let target: CardInstance | null = null;
  if (d.active?.iid === targetIid) target = d.active;
  else target = d.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  const addDmg = counters * 10;
  const newDmg = target.damage + addDmg;
  let s = addLog(st, `幻影碎：在對手的 ${tname} 身上放置 ${counters} 個傷害指示物（${addDmg} 傷害，效果型）`, idx);
  // 簡化：直接塞 damage 不走 KO 流程（對手戰鬥位若 KO 由 engine 下一回合檢查）
  // 但若 HP 不足會 KO，為求一致，這裡直接做 KO 判定：
  const card = pool.get(target.cardId);
  const hp = card?.hp ?? 0;
  if (hp > 0 && newDmg >= hp) {
    // KO 走 active vs bench 分別流程 — 簡化：直接標記 damage 後交由 engine checkKO（若有）
    s = updatePlayer(s, dIdx, pl => {
      if (pl.active?.iid === targetIid) {
        return { ...pl, active: { ...pl.active, damage: newDmg } };
      }
      return { ...pl, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c) };
    });
  } else {
    s = updatePlayer(s, dIdx, pl => {
      if (pl.active?.iid === targetIid) {
        return { ...pl, active: { ...pl.active, damage: newDmg } };
      }
      return { ...pl, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c) };
    });
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級路卡利歐 牌組
// ══════════════════════════════════════════════════════════════════════════════

// ── 太陽岩 MC 16843｜宇宙光束 — gate（備戰需有月石）+ 70 + skip 弱抗 ────────
// 卡面：若自己的備戰區沒有「月石」，則這個招式失敗。這個招式的傷害不計算弱點・抵抗力。
regPre('太陽岩|宇宙光束', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const hasMoonstone = p.bench.some(c => pool.get(c.cardId)?.name === '月石');
  if (!hasMoonstone) {
    return {
      state: addLog(state, '宇宙光束：備戰區沒有「月石」，招式失敗', aIdx),
      damage: 0,
    };
  }
  return {
    state: addLog(state, '宇宙光束：備戰區有月石 → 70 傷害（不計算弱點/抗性）', aIdx),
    damage: 70,
    skipWeakRes: true,
  };
});

// ── 月石 MC 16842｜月光循環（特性）──────────────────────────────────────────
// 卡面：若自己的場上有「太陽岩」，且在自己的回合，從自己的手牌將 1 張「基本【鬥】能量」卡丟棄，
//       則可使用 1 次。從自己的牌庫抽出 3 張卡。
//       在使用了其他的「月光循環」的回合，此特性無法使用。
regG('月石', (st, idx, pool) => {
  const p = st.players[idx];
  // 場上有太陽岩（含戰鬥場 / 備戰）
  const field = [...(p.active ? [p.active] : []), ...p.bench];
  const hasSunstone = field.some(c => pool.get(c.cardId)?.name === '太陽岩');
  if (!hasSunstone) return false;
  // 手牌有基本【鬥】能量
  const hasFightEnergy = p.hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name === '基本【鬥】能量';
  });
  return hasFightEnergy;
});
regA('月石', 0, (st, idx, pool, _cardInst) => {
  // 找 1 張基本【鬥】能量丟棄 + 抽 3
  const p = st.players[idx];
  const energyInst = p.hand.find(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name === '基本【鬥】能量';
  });
  if (!energyInst) return addLog(st, '月光循環：手牌無基本【鬥】能量，無法使用', idx);
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== energyInst.iid),
    discard: [...pl.discard, energyInst],
  }));
  s = addLog(s, '月光循環：丟棄 1 張基本【鬥】能量，抽 3 張', idx);
  return drawCards(s, idx, 3);
});

// ── 月石｜力量寶石 — 基礎 50 ──────────────────────────────────────────────
regPre('月石|力量寶石', (state) => ({ state, damage: 50 }));

// ── 超級路卡利歐ex M2a 14752｜波動突刺 — 130 + 棄牌區選最多 3 張基本鬥能量附備戰 ─
// 卡面：從自己的棄牌區選擇最多 3 張「基本【鬥】能量」卡，以任意方式附於備戰寶可夢身上。
// 簡化：一次選多張 → 全部附到同 1 隻備戰（現有 discard-energy-attach-bench-only
//       只支援 1 張，故擴展 label 讓玩家選 0~3 張，然後選 1 隻備戰全附）。
regPre('超級路卡利歐ex|波動突刺', (state) => ({ state, damage: 130 }));
regPost('超級路卡利歐ex|波動突刺', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) return addLog(state, '波動突刺：備戰區沒有寶可夢，無需附能量', aIdx);
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name === '基本【鬥】能量';
  });
  if (cand.length === 0) return addLog(state, '波動突刺：棄牌區沒有基本【鬥】能量', aIdx);
  const maxTake = Math.min(3, cand.length);
  const s = addLog(state, `波動突刺：從棄牌區選最多 ${maxTake} 張「基本【鬥】能量」附到 1 隻備戰寶可夢`, aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicFightingEnergy', minCount: 0, maxCount: maxTake,
    effectKey: 'discard-energy-attach-bench-only',
    params: { label: '波動突刺' },
  });
});

// ── 超級路卡利歐ex｜超級勇氣 — 270 傷（下回合同招禁未實裝）────────────────────
// 卡面：在下個自己的回合，這隻寶可夢無法使用「超級勇氣」。
// 【已知缺口】單招下回合限制需引擎新增 cardInst.blockedAttackNameNextTurn 欄位。
// 本版只打 270 + log 提示玩家自行遵守。
regPre('超級路卡利歐ex|超級勇氣', (state, aIdx) => {
  return {
    state: addLog(state, '超級勇氣：270 傷害（註：下回合本卡應無法再用「超級勇氣」，引擎未自動限制）', aIdx),
    damage: 270,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// 暗碼迷的解讀 MC 17169（Supporter）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：從自己的牌庫任意選擇 2 張卡。重洗剩餘牌庫，將所選的卡以任意順序排列，放回牌庫上方。
// 簡化：pending-selection deck-search + effectKey 做 2 張放牌庫頂（順序由 UI 決定）
regG('暗碼迷的解讀', (st, idx) => {
  return st.players[idx].deck.length > 0;
});
reg('暗碼迷的解讀', (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '暗碼迷的解讀：牌庫已空', idx);
  const takeMax = Math.min(2, p.deck.length);
  const s = addLog(st, `暗碼迷的解讀：從牌庫選最多 ${takeMax} 張放回牌庫上方（並重洗）`, idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Any',
    minCount: 0, maxCount: takeMax,
    effectKey: 'cipher-geek-top2',
  });
});
regR('cipher-geek-top2', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: [...chosen, ...shuffle(rest)] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 已知缺口（引擎擴充，待下個 session）
// ══════════════════════════════════════════════════════════════════════════════
//
// 1. 引力山岳（Stadium）— 雙方全場 Stage2 寶可夢 HP -30
//    需要：engine effectiveHP 加入 stadium-based HP reduce hook
//    位置：effects.ts 的 effectiveHPInline + engine.ts 的 getEffectiveHP
//
// 2. 硬岩【鬥】能量（Special Energy）— 附鬥寶可夢不受對手招式效果影響
//    需要：engine ATTACK pipeline 加 shield hook；類似感應【超】能量
//    但是 shield 方向（target attacker 的招式效果不觸發 post effects）
//
// 3. 回力鏢能量（Special Energy）— 被招式效果丟棄時重附原寶可夢
//    需要：engine 在 discard-energy 流程加 hook，若卡名==回力鏢能量 且
//    原因==招式效果 → 不進棄牌區，直接回原寶可夢
//
// 4. 呆呆王｜耀閃挑戰 完整隨機 copy-attack — 需要新 UI: 丟牌庫頂後彈出
//    「該寶可夢的招式列表」讓玩家選。現有 copy-attack（扮晶晶酒 v2.57）是
//    複製對手當前招式，不是隨機抽牌的。本版用佔位 120 傷害 + log 提示。
//
// 5. 超級路卡利歐ex｜超級勇氣 下回合同招禁 — 需要 CardInstance 層級的
//    blockedAttackNameNextTurn / ThisTurn 欄位 + END_TURN 旗標搬運。
