// v6.071 M6「綠寶石風暴」實裝 批次 9 —— 化身團結×4、綠寶石風暴、母親的誘引
//
// ⚠ 卡面逐字取自 static/cards/M6.json，未經簡化。
// ⚠ 本批兩項 Wilson 已裁定（2026-07-31），註解中標明依據，勿自行更動語意。

import { regA, regPre, addLog, withPending, rejectAbilityUse } from '../_shared';
import { canApplyEffectToTarget } from '../../defense'; // v5.839 換位免疫 gate
import { flipCoinsWithLog, countOwnFireLightningEnergyUnion } from '../../effects';

// ── 1. 化身團結（龍捲雲／雷電雲／土地雲／眷戀雲，共 4 張）────────────────────
// 卡面：若自己的場上有「龍捲雲」「雷電雲」「土地雲」「眷戀雲」，
//        則這隻寶可夢使用招式所需的【無】能量全部消除。
//   ⭐ Wilson 裁定：四種**都要**同時在場（AND）。
//   實作在 effects.ts 的中央 ABILITY_COLORLESS_COST_ZERO（key = 特性名），
//   engine canAffordAttack 讀該 map；本檔不需要註冊 —— 四張共用同一個條件述詞。
//   ⚠ 龍捲雲（M6）是【無】屬性 → 火箭隊的監視塔在場時它的特性被消除；
//     engine 的 isColorlessAbilityBlocked gate 已涵蓋這條路徑（cost-modifier 專用 gate）。

// ── 2. 超級烈空坐ex｜綠寶石風暴 50× ────────────────────────────────────────
// 卡面：造成自己的所有寶可夢身上附加的【火】與【雷】能量的數量×50點傷害。
//   ⭐ Wilson 裁定：**同一張能量卡只算一次（取聯集）** —— 一張古舊能量算 1 個，
//     不是「火 1 + 雷 1 = 2」。中央述詞見 effects.ts countOwnFireLightningEnergyUnion。
//   ⚠ 單位數 host-aware（火箭隊=2、燃火附進化=3、新衝天 on Stage2=2、繁茂基本草=2）。
regPre('超級烈空坐ex|綠寶石風暴', (state, aIdx, pool) => {
  const n = countOwnFireLightningEnergyUnion(state, aIdx, pool);
  const dmg = n * 50;
  return {
    state: addLog(state, `綠寶石風暴：自己場上【火】與【雷】能量 ${n} 個 × 50 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 3. 尼多后｜母親的誘引（特性）─────────────────────────────────────────────
// 卡面：在自己的回合時可使用1次。擲1次硬幣若為正面，
//        則選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。
//   範本 鐵掌力士｜大力捕捉器（特性版 gust）逐字相同（差在多一次擲幣）。
//   ⚠ C-05 方向（v5.995／官方 §17.3.D）：效果對象是**被選的備戰寶可夢**，
//     原戰鬥位的「不受效果影響」不擋互換；免疫 gate 過濾在備戰候選端。
//   ⚠ kind 用 'ability-effect'（這是特性不是招式）；counterPlacement:false
//     （互換位置不是「放置傷害指示物」，對戰圓形競技場不該擋，v6.028）。
//   「每回合 1 次」由 engine 的 ABILITY_USED 一次性規則管控。
regA('尼多后', 0, (st, idx, pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  if (!opp.active) return rejectAbilityUse(st, '母親的誘引：對手戰鬥場無寶可夢', idx);
  if (opp.bench.length === 0) return rejectAbilityUse(st, '母親的誘引：對手備戰區無寶可夢', idx);
  // ⚠ 擲幣先於「有無合法目標」的判定？—— 卡面順序是「擲1次硬幣若為正面，則選擇…」，
  //   擲幣是無條件的第一步，反面就結束（且已消耗當回合這次特性）。
  const r = flipCoinsWithLog(st, 1, '母親的誘引', idx);
  st = r.state;
  if (!r.heads) return addLog(st, '母親的誘引：反面 → 沒有效果', idx);
  const validIids = opp.bench
    .filter(b => !canApplyEffectToTarget(st, idx, b, pool.get(b.cardId), 'ability-effect', pool,
                                         { isBench: true, counterPlacement: false }).blocked)
    .map(b => b.iid);
  if (validIids.length === 0) {
    return addLog(st, '母親的誘引：正面，但對手備戰寶可夢皆不受特性效果影響，無法互換', idx);
  }
  return withPending(addLog(st, '母親的誘引：正面 → 選 1 隻對手備戰與戰鬥場互換', idx), {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',        // 復用既有中央 resolver（supporters_gust.ts）
    params: { validIids },
  });
});
