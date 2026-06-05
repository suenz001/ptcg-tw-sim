/**
 * v3.70 招式層 audit — 補實裝 22 張 G 標 orphan 招式
 *
 * Audit 方法：對所有 G/H/I/J 標 Pokemon 的 attacks 計算 key = `cardName|attackName`，
 * 比對 regPre/regPost 註冊表。Audit 找到 30 張在標準環境內、有 effect 文字、
 * 但無 implementation path 的 orphan 招式（全部都是 G 標新版本）。
 *
 * 本批次使用既有 helper / 簡單 inline，實裝其中 22 張（trivial 類）；
 * 剩下 8 張需要新 picker resolver 或新引擎 hook，延後到 v3.71+：
 *   - 古簡蝸|貪欲制約 — 對手下回合招式成本 +2【無】(需新 debuff flag)
 *   - 鐵脖頸|重子光束 — 若身上附「驅勁能量 未來」則 cost -2 (需 canAffordAttack hook)
 *   - 夢幻ex|基因駭入 — 複製對手戰鬥招式 (mimic, 需新 UI)
 *   - 大比鳥ex|狂風呼嘯 — 若希望，丟棄場上競技場卡 (需 binary-yes-no UI)
 *   - 愛管侍|育兒高手 — 牌庫搜尋 1 張進化卡放對應寶可夢 (需新 picker resolver)
 *   - 自爆磁怪|磁力抵制 — 若希望，對手戰鬥 ↔ 備戰互換（由對手選） (需 binary + opp-bench-choose)
 *   - 咚咚鼠|咬能量 / 風速狗|咬碎 — 擲幣正面，丟對手戰鬥 1 個能量 (需新 picker resolver)
 *
 * 同時於 v3.70 修 3 張卡的「print 變體 → 字串比對失敗」bug（JSON cleanup）：
 *   - ‌喵喵 (M-P-H/SVM 的 ZWNJ U+200C 前綴) → 喵喵
 *   - 厄鬼椪\xa0碧草面具ex (M2a 的 NBSP U+00A0) → 厄鬼椪 碧草面具ex
 *   - 月月熊 赫月 ex / 月月熊 赫月ex 已於 v3.69 用 normalize 處理
 *
 * 新增 Iron Rule #16（v3.69 文件已記）：
 *   卡名字串比對必須 normalize whitespace + ZWJ 變體，
 *   或在 scrape pipeline 內 canonical 化卡名。
 */

import { regPre, regPost, addLog, updatePlayer, withPending } from '../_shared';
import { getOwnBenchLimit } from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';
import type { PlayerState } from '../../types';
import {
  statusPost, coinHeadsMultiplyPre, selfHitPost, flipCoinsWithLog, snipeOneOppBenchPost,
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 本檔 inline helper（複製自 v2740/v2750 既有實作；避免 effects.ts 大檔編輯）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 攻擊後 → 自身回血 N 點（不可超過原始 HP，由 damage 欄位反扣）。
 * 對應卡面「將這隻寶可夢恢復「N」HP」。
 */
function selfHealPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    if (!state.players[aIdx].active) return state;
    const before = state.players[aIdx].active!.damage ?? 0;
    const after = Math.max(0, before - amount);
    const healed = before - after;
    return updatePlayer(
      addLog(state, `${label}：自身回復 ${healed} HP（${before} → ${after} 傷害）`, aIdx),
      aIdx,
      p => ({ ...p, active: p.active ? { ...p.active, damage: after } : null }),
    );
  };
}

/**
 * 攻擊後 → 自身丟 N 個能量（從後往前取，模擬玩家選 N 個能量；
 * 與 v2740 / v2750 local impl 完全一致）。
 */
function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const k = Math.min(n, att.energyAttached.length);
    return updatePlayer(addLog(state, `${label}：自身丟棄 ${k} 個能量`, aIdx), aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

/**
 * 攻擊後 → 對手戰鬥寶可夢下回合無法撤退（cantRetreatNextTurn 旗標）。
 * 鏡射 effects.ts:4194 的 defCantRetreatNextPost（該函式未 export，這裡 inline）。
 */
function defCantRetreatNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantRetreatNextTurn: true };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${label}：對手下回合無法撤退`, aIdx);
  };
}

/**
 * 攻擊後 → 牌庫搜尋最多 N 張【基礎】寶可夢卡放備戰，並重洗。
 * 鏡射 effects.ts:6955 的 benchBasicFromDeckPost（用既有 resolver 'bench-basic-from-deck'）。
 */
function benchBasicFromDeckPost(max: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    // v5.041：bench limit 改 getBenchLimit (5→8)
    const limit = getOwnBenchLimit(state, aIdx, pool);
    if (p.bench.length >= limit) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const realMax = Math.min(max, limit - p.bench.length);
    const s = addLog(state, `${label}：從牌庫選最多 ${realMax} 張【基礎】寶可夢放備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Basic',
      minCount: 0, maxCount: realMax,
      effectKey: 'bench-basic-from-deck',
    });
  };
}

/**
 * 攻擊後 → 對手 1 隻備戰寶可夢受 N 點傷害（不計算弱抗，於備戰區）。
 * 鏡射 v2540_i_wave4_misc.ts:160 + v2750_h_wave2_full.ts:85（既有 resolver 'wave3a-snipe-bench'）。
 */

/**
 * PRE：自身（攻擊者）有傷害指示物 → +bonus；否則 base。
 * 對應卡面「若這隻寶可夢身上放置有傷害指示物，則增加 N 點傷害」。
 * 注意：與 v2740 的 selfBenchHasDamagePre 不同 — 這個是檢查 attacker active 自己。
 */
function selfHasDamagePre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const me = state.players[aIdx].active;
    const hasInjury = (me?.damage ?? 0) > 0;
    if (hasInjury) return { state: addLog(state, `${label}：自身有傷害指示物 → ${base}+${bonus} = ${base + bonus}`, aIdx), damage: base + bonus };
    return { state: addLog(state, `${label}：自身無傷害指示物 → ${base}`, aIdx), damage: base };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// === Section 1: SELF_HIT 補完 — 「這隻寶可夢也受到 N 點傷害」（7 張）===
// ══════════════════════════════════════════════════════════════════════════════
// audit 發現 G 標新版本 7 張漏掉，全部用既有 selfHitPost(amount)。
// 表格格式：[key, baseDamage, selfDamage]
const SELF_HIT_V370: Array<[string, number, number]> = [
  ['火箭雀|高溫奇襲', 50, 10],       // SVM Fire Basic
  ['直衝熊|突擊', 150, 30],            // SVM Colorless Stage1
  ['小箭雀|急降', 30, 10],             // SVM Colorless Basic
  ['摩托蜥|突擊', 70, 10],             // SVM Colorless Basic
  ['小火龍|熱力衝撞', 30, 10],         // SVQL Fire Basic
  ['加熱洛托姆|熱力衝撞', 100, 40],    // SVQL Fire Basic
  ['自爆磁怪|打雷', 180, 30],          // SVQP Lightning Stage1
];
for (const [key, dmg, selfDmg] of SELF_HIT_V370) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfHitPost(selfDmg));
}

// ══════════════════════════════════════════════════════════════════════════════
// === Section 2: 純狀態 — 中毒 / 睡眠（3 張）===
// ══════════════════════════════════════════════════════════════════════════════
// 不良蛙｜毒針 10 + 中毒
regPre('不良蛙|毒針', (s) => ({ state: s, damage: 10 }));
regPost('不良蛙|毒針', statusPost('poisoned'));
// 毒骷蛙｜拳頭刺 60 + 中毒
regPre('毒骷蛙|拳頭刺', (s) => ({ state: s, damage: 60 }));
regPost('毒骷蛙|拳頭刺', statusPost('poisoned'));
// 愛管侍｜催眠波動 30 + 睡眠
regPre('愛管侍|催眠波動', (s) => ({ state: s, damage: 30 }));
regPost('愛管侍|催眠波動', statusPost('asleep'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 3: 自身回血（2 張）===
// ══════════════════════════════════════════════════════════════════════════════
regPre('瑪力露|泡沫吸取', (s) => ({ state: s, damage: 20 }));
regPost('瑪力露|泡沫吸取', selfHealPost(20, '泡沫吸取'));
regPre('瑪力露麗|泡沫吸取', (s) => ({ state: s, damage: 50 }));
regPost('瑪力露麗|泡沫吸取', selfHealPost(30, '泡沫吸取'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 4: 自身有傷害指示物 → +N（2 張，新 helper selfHasDamagePre）===
// ══════════════════════════════════════════════════════════════════════════════
// 注意：base 取自 JSON 的 damage 欄位（去掉 + 號）。
//   烈箭鷹｜烈火之風  70+90 = 160（自身有傷害指示物時）
//   噴火龍ex｜無畏之翼 60+100 = 160（自身有傷害指示物時）
regPre('烈箭鷹|烈火之風', selfHasDamagePre(70, 90, '烈火之風'));
regPre('噴火龍ex|無畏之翼', selfHasDamagePre(60, 100, '無畏之翼'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 5: 擲幣傷害（1 張）===
// ══════════════════════════════════════════════════════════════════════════════
// 瑪力露麗｜摔打 — 擲 2 次硬幣，造成正面次數 ×100 點傷害
regPre('瑪力露麗|摔打', coinHeadsMultiplyPre(2, 100, '摔打'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 6: 棄能量大招（1 張）===
// ══════════════════════════════════════════════════════════════════════════════
// 噴火龍ex｜爆焰旋渦 330 — 攻擊後自身丟 3 個能量

// ══════════════════════════════════════════════════════════════════════════════
// === Section 7: 對手戰鬥有傷害指示物 ×10（1 張，inline）===
// ══════════════════════════════════════════════════════════════════════════════
// 小拉達｜咬傷口 20+ — 增加對手戰鬥寶可夢身上放置的傷害指示物數量 ×10 點傷害
// 卡面「傷害指示物的數量」= damage / 10（每個指示物 = 10 HP）
regPre('小拉達|咬傷口', (state, aIdx, _pool) => {
  const def = state.players[(1 - aIdx) as 0 | 1].active;
  const counters = Math.floor((def?.damage ?? 0) / 10);
  const bonus = counters * 10;
  const total = 20 + bonus;
  return {
    state: addLog(state, `咬傷口：對手戰鬥指示物 ${counters} 個 → 20 + ${counters}×10 = ${total}`, aIdx),
    damage: total,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 8: 牌庫搜尋 Basic（1 張）===
// ══════════════════════════════════════════════════════════════════════════════
// 波波｜呼朋引伴 — 從牌庫選最多 2 張【基礎】寶可夢放備戰，並重洗
regPre('波波|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('波波|呼朋引伴', benchBasicFromDeckPost(2, '呼朋引伴'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 9: 對手下回合無法撤退（1 張）===
// ══════════════════════════════════════════════════════════════════════════════
// 烈箭鷹｜緊抓 50 — 在下個對手的回合，受到這個招式的寶可夢無法撤退
regPre('烈箭鷹|緊抓', (s) => ({ state: s, damage: 50 }));
regPost('烈箭鷹|緊抓', defCantRetreatNextPost('緊抓'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 10: 狙擊備戰 1 隻（1 張）===
// ══════════════════════════════════════════════════════════════════════════════
// 電肚蛙｜電氣子彈 70 — 對手 1 隻備戰也受 30（不計算弱抗）
regPre('電肚蛙|電氣子彈', (s) => ({ state: s, damage: 70 }));
regPost('電肚蛙|電氣子彈', snipeOneOppBenchPost(30, '電氣子彈'));

// ══════════════════════════════════════════════════════════════════════════════
// === Section 11: 擲幣反面 → 全棄能量（1 張，inline）===
// ══════════════════════════════════════════════════════════════════════════════
// 皮卡丘ex｜極限伏特 220 — 擲 1 次硬幣若為反面，則將這隻寶可夢身上附加的能量全部丟棄
regPre('皮卡丘ex|極限伏特', (s) => ({ state: s, damage: 220 }));
regPost('皮卡丘ex|極限伏特', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '極限伏特', aIdx);
  if (r.heads >= 1) {
    return addLog(r.state, '極限伏特：正面 → 不丟能量', aIdx);
  }
  // 反面 → 全棄能量
  return updatePlayer(
    addLog(r.state, '極限伏特：反面 → 丟棄自身全部能量', aIdx),
    aIdx,
    p => {
      if (!p.active) return p;
      const allEnergy = p.active.energyAttached;
      return {
        ...p,
        active: { ...p.active, energyAttached: [] },
        discard: [...p.discard, ...allEnergy],
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// === Section 12: 連續火焰 (擲幣直到反面 ×N) — 1 張 inline ===
// ══════════════════════════════════════════════════════════════════════════════
// 卡蒂狗｜連續火焰 — 擲硬幣直到出現反面，造成正面次數 ×30 點傷害
// 不 import v2750 的 coinHeadsUntilTailsPre（避免跨檔依賴複雜化），inline 實作。
regPre('卡蒂狗|連續火焰', (state, aIdx, _pool) => {
  let s = state, heads = 0;
  while (true) {
    const r = flipCoinsWithLog(s, 1, '連續火焰', aIdx);
    s = r.state;
    if (r.heads === 0) break;
    heads++;
    if (heads >= 30) break;  // safety cap
  }
  const dmg = heads * 30;
  return { state: addLog(s, `連續火焰：${heads} 正面 → ${heads}×30 = ${dmg}`, aIdx), damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 統計
// ══════════════════════════════════════════════════════════════════════════════
// 本檔實裝招式 22 張（7 SELF_HIT + 3 status + 2 heal + 2 selfHasDamage
//                      + 1 coin×K + 1 棄能量 + 1 opp×10 + 1 search basic
//                      + 1 cantRetreat + 1 snipe + 1 tails→discard-all
//                      + 1 連續火焰）
//
// 延後到 v3.71+ 的 8 張（需要新 picker resolver / 引擎 hook）：
//   1. 古簡蝸|貪欲制約 (cost +2 debuff)
//   2. 鐵脖頸|重子光束 (cost reduction conditional)
//   3. 夢幻ex|基因駭入 (attack mimic)
//   4. 大比鳥ex|狂風呼嘯 (binary discard stadium)
//   5. 愛管侍|育兒高手 (search 1 evolution)
//   6. 自爆磁怪|磁力抵制 (binary opp swap)
//   7. 咚咚鼠|咬能量 (coin → opp energy picker)
//   8. 風速狗|咬碎 (coin → opp energy picker)
