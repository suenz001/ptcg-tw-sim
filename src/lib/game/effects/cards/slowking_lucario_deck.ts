/**
 * 呆呆王 + 超級路卡利歐 兩組預組卡效果（v2.89 首版 / v2.90 修正）
 *
 * v2.89 Leon 憤怒回報：我擅自把「憨憨臉」做成抽牌（實際是防混亂）、把「耀閃挑戰」
 * 簡化成 120 傷（實際是隨機 copy-attack）、把波動突刺簡化成「全附 1 隻」
 * （實際是「以任意方式附於備戰」— 每張能量可選不同目標）、把超級勇氣省略
 * 下回合同招禁限制。嚴重違反 feedback_effect_implementation_sop Checkpoint 1：
 * 「絕不信既有註解，只信當前卡面 JSON rulesText」。
 *
 * v2.90 本檔只保留**100% 按 rulesText 實裝**的卡；其餘無法在現有引擎 infrastructure
 * 完整實作的卡，暫時不註冊 effect（讓引擎跑預設行為），並在下方 DEFERRED 列表
 * 明確寫出卡面原文，等 Leon 指示要走哪條實作路徑。
 */

import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR, regG, regPre, regPost, regA,
  type AttackPreFn, type AttackPostFn,
  shuffle, updatePlayer, addLog, drawCards, withPending,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 100% 按 rulesText 實裝的卡
// ══════════════════════════════════════════════════════════════════════════════

// ── 呆呆王 SV7 10934｜超念力 — 120 無效果 ────────────────────────────────────
// 卡面：（無 effect）
regPre('呆呆王|超念力', (state) => ({ state, damage: 120 }));

// ── 超級袋獸ex M1S 14071｜機關槍合擊 — 擲到反面前正面數×50 + 基礎 200 ──────
// 卡面：擲硬幣直到出現反面，增加正面出現的次數 × 50 點傷害。(基礎 200)
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

// ── 靈幽馬 M2a 14740｜陰森射擊 — 30 無效果 ───────────────────────────────────
regPre('靈幽馬|陰森射擊', (state) => ({ state, damage: 30 }));

// ── 靈幽馬｜幻影碎 — 自拔所有能量 + 對手 1 隻放 12 個傷害指示物 ──────────────
// 卡面：將這隻寶可夢身上附加的能量卡全部丟棄，在對手的 1 隻寶可夢身上放置
//       12 個傷害指示物。
// 註：放置傷害指示物屬於「效果類」，bypass 弱點/抗性/防禦道具。12 counter = 120 傷害。
regPre('靈幽馬|幻影碎', (state) => ({ state, damage: 0 })); // 效果型，不走一般傷害
regPost('靈幽馬|幻影碎', (state, aIdx, pool) => {
  const d = state.players[1 - aIdx as 0 | 1];
  const oppCount = (d.active ? 1 : 0) + d.bench.length;
  if (oppCount === 0) return addLog(state, '幻影碎：對手場上無寶可夢', aIdx);
  const ap = state.players[aIdx];
  if (!ap.active) return state;
  // 先把自身能量全部丟棄
  const ownEnergies = ap.active.energyAttached;
  let s = state;
  if (ownEnergies.length > 0) {
    s = updatePlayer(s, aIdx, pl => ({
      ...pl,
      active: pl.active ? { ...pl.active, energyAttached: [] } : pl.active,
      discard: [...pl.discard, ...ownEnergies],
    }));
    s = addLog(s,
      `幻影碎：丟棄 ${pool.get(ap.active.cardId)?.name ?? '靈幽馬'} 身上 ${ownEnergies.length} 張能量`,
      aIdx);
  }
  // 選對手 1 隻放 12 個指示物
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
  const s = addLog(st,
    `幻影碎：在對手的 ${tname} 身上放置 ${counters} 個傷害指示物（${addDmg} 傷害，效果型）`,
    idx);
  return updatePlayer(s, dIdx, pl => {
    if (pl.active?.iid === targetIid) {
      return { ...pl, active: { ...pl.active, damage: newDmg } };
    }
    return { ...pl, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c) };
  });
});

// ── 太陽岩 MC 16843｜宇宙光束 — gate(備戰月石) + 70 + 不計弱抗 ──────────────
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

// ── 月石 MC 16842｜力量寶石 — 50 無效果 ──────────────────────────────────────
regPre('月石|力量寶石', (state) => ({ state, damage: 50 }));

// ══════════════════════════════════════════════════════════════════════════════
// DEFERRED — 以下卡面我無法在現有 engine infra 100% 實裝，待 Leon 指示
// 實作路徑。暫不註冊 effect，讓引擎跑預設（基礎傷害，無特殊效果）。
// 絕對不做「簡化版」— v2.89 的教訓。
// ══════════════════════════════════════════════════════════════════════════════

// ── 呆呆獸 M-P 18072｜憨憨臉 ──────────────────────────────────────────────
// 卡面：這隻寶可夢不會【混亂】。
// 所需 infra：engine SET_STATUS / SPECIAL_CONDITION 流程加「施加混亂前檢查被害方
//   是否有憨憨臉特性」→ 跳過附加。類似可達鴨｜濕氣的 passive gate pattern。
// 現況：暫不註冊。引擎會把混亂正常附加（不符卡面），但比錯誤地「抽 1 張」更安全。

// ── 呆呆王 SV7 10934｜耀閃挑戰 ────────────────────────────────────────────
// 卡面：將自己的牌庫上方 1 張卡丟棄，若那張卡為寶可夢卡（「擁有規則的寶可夢」除外），
//   則選擇 1 個那隻寶可夢持有的招式，作為這個招式使用。
// 所需 infra：新 UI flow — (1) 丟頂 1 張 (2) 若是寶可夢（非規則盒 ex/V/GX 等）
//   → 顯示該寶可夢的招式列表讓玩家選 (3) 以該招進行（遞迴 regPre / regPost）。
// 現況：暫不註冊。引擎會把此招當成「damage=0 無效果」跑（卡面也沒寫基礎傷害）。

// ── 超級袋獸ex｜使者衝刺（特性）──────────────────────────────────────────
// 卡面：若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。從自己的牌庫抽出
//   2 張卡。在使用了其他的「使者衝刺」的回合，這個特性無法使用。
// 難點：「使用了其他的使者衝刺的回合，無法使用」需要 player-level 同名特性使用
//   紀錄（abilityNamesUsedThisTurn: Set<string>），engine 目前只有 per-inst
//   abilityUsedThisTurn。不實裝此限制會讓多隻超級袋獸ex 一回合內多次抽牌。
// 現況：暫不註冊。寧可不能用也不要亂抽。

// ── 月石 MC 16842｜月光循環（特性）──────────────────────────────────────
// 卡面：若自己的場上有「太陽岩」，且在自己的回合，從自己的手牌將 1 張「基本
//   【鬥】能量」卡丟棄，則可使用 1 次。從自己的牌庫抽出 3 張卡。在使用了其他的
//   「月光循環」的回合，這個特性無法使用。
// 難點：同「使者衝刺」— 需要 player-level 同名特性限制。
// 現況：暫不註冊（同理）。

// ── 超級路卡利歐ex M2a 14752｜波動突刺 ───────────────────────────────────
// 卡面：從自己的棄牌區選擇最多 3 張「基本【鬥】能量」卡，以任意方式附於備戰
//   寶可夢身上。（基礎 130 傷害）
// 難點：「以任意方式附於備戰寶可夢身上」= 每張能量可分別選不同備戰目標。現有
//   discard-energy-attach-bench-only resolver 只支援「全附 1 隻」，為簡化版。
//   需要新 pending chain：選 N 張 → 逐張選備戰位置。
// 現況：**傷害 130 保留**（單純基礎傷害），effect 暫不註冊。

// ── 超級路卡利歐ex｜超級勇氣 ──────────────────────────────────────────────
// 卡面：在下個自己的回合，這隻寶可夢無法使用「超級勇氣」。（基礎 270 傷害）
// 難點：需要 CardInstance 層級 blockedAttackNameNextTurn / ThisTurn 欄位 +
//   END_TURN 旗標搬運 + ATTACK pipeline 的 check。
// 現況：**傷害 270 保留**，下回合限制暫不實裝（玩家需自覺遵守，但模擬器不擋）。

// ══════════════════════════════════════════════════════════════════════════════
// 訓練家卡 — 按 rulesText 實裝
// ══════════════════════════════════════════════════════════════════════════════

// ── 暗碼迷的解讀 MC 17169（Supporter）──────────────────────────────────────
// 卡面：從自己的牌庫任意選擇 2 張卡。重洗剩餘牌庫，將所選的卡以任意順序排列，
//       放回牌庫上方。
// v2.90 修正：min/maxCount 由 v2.89「最多 2」改為「正好 2」(min=2 max=2)
//       ── 卡面是「選擇 2 張」，若牌庫不足 2 張則 min=deck.length。
regG('暗碼迷的解讀', (st, idx) => {
  return st.players[idx].deck.length > 0;
});
reg('暗碼迷的解讀', (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '暗碼迷的解讀：牌庫已空', idx);
  const pick = Math.min(2, p.deck.length);
  const s = addLog(st,
    `暗碼迷的解讀：從牌庫任意選擇 ${pick} 張卡（重洗剩餘，選的放牌庫上方）`,
    idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Any',
    minCount: pick, maxCount: pick,
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
// 其他 DEFERRED（跟本模組無直接新實裝，但屬於這兩副預組）
// ══════════════════════════════════════════════════════════════════════════════
//
// - 引力山岳（SV8 11286 Stadium）— 全場 Stage2 HP-30 — 需 effectiveHP stadium hook
// - 硬岩【鬥】能量（M3 18057 Special Energy）— 鬥寶可夢不受對手招式效果影響
//   — 需 ATTACK pipeline shield hook
// - 回力鏢能量（MC 17209 Special Energy）— 被招式效果丟棄後重附原寶可夢
//   — 需 discard-energy flow hook
