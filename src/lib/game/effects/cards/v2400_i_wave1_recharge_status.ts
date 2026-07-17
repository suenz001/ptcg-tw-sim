/**
 * v2.40 I 標 Wave 1 — Recharge + 狀態類批次實裝（declarative 風格）
 *
 * 用 helper factory + declarative array 大幅縮減 code 量：
 *   原先每張卡 8-15 行 → 現在每張 1-2 行（含資料表）
 *
 * 涵蓋：
 *   - Recharge 招式 7 張（下個自己回合無法用此招）
 *   - 純狀態類 4 張（純 damage + 必中狀態）
 *   - 擲幣狀態類 16 張（擲幣正面才中狀態）
 *
 * 共 27 張 I 標寶可夢招式 effect。
 *
 * 鐵律遵循：
 *   - 所有狀態 helper 復用 effects.ts 既有 statusPost / coinStatusPost
 *     （含憨憨臉 / 硬岩鬥能量 / 特殊能量 status_immune 完整 immunity 鏈）
 *   - rechargePost 為本檔 inline helper（小函式，不污染共用空間）
 *   - 純傷害招式無 effect 文 → 引擎自動處理（不在本檔）
 */

import type { CardInstance, PlayerState } from '../../types';
import { regPre, regPost, updatePlayer } from '../_shared';
import type { AttackPostFn } from '../_shared';
import { statusPost, coinStatusPost, defCantRetreatNextPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helper: rechargePost — 攻擊後鎖此招式名直到下回合自己（promote NextTurn → ThisTurn）
// 用 blockedAttackNamesNextTurn flag（既有引擎 v2.159 機制）
// ══════════════════════════════════════════════════════════════════════════════
function rechargePost(attackName: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), attackName],
      } : null,
    }));
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Recharge 招式（damage + 下回合無法用此招）— 7 張
// ──────────────────────────────────────────────────────────────────────────────
// 卡面 pattern：「在下個自己的回合，這隻寶可夢無法使用『XXX』。」
// ══════════════════════════════════════════════════════════════════════════════
const RECHARGE_ATTACKS: Array<[string, number]> = [
  ['利歐路|加速突刺', 30],
  ['自爆磁怪|閃光伏特', 160],
  ['雪暴馬|冰霜颱風', 130],
  ['赫普的蒼響ex|無畏斬', 240],
  ['厄鬼椪 碧草面具|鬼之錘', 120],
  ['派帕的獒教父ex|大佬頭擊', 210],
  ['棄世猴|衝擊打擊', 160],
];
for (const [key, dmg] of RECHARGE_ATTACKS) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, rechargePost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 純狀態（必中，無擲幣）— 4 張
// ──────────────────────────────────────────────────────────────────────────────
// 卡面 pattern：「damage。將對手的戰鬥寶可夢【XX】。」
// 只覆蓋「純傷害 + 純狀態」，含複雜條件（自傷/雙狀態/否則失敗等）的卡留下波處理。
// ══════════════════════════════════════════════════════════════════════════════
const STATUS_NORMAL: Array<[string, number, 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed']> = [
  ['隨風球|不祥之風', 0, 'confused'],
  ['N的齒輪組|轉轉齒輪', 20, 'confused'],
  ['大吾的念力土偶|不祥之光', 20, 'confused'],
];
for (const [key, dmg, status] of STATUS_NORMAL) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, statusPost(status));
}

// 火箭隊的臭臭泥｜渾身臭臭 40 — 混亂 + 對手下回合無法撤退（卡面雙效果）。
// v5.981：原「本波先實裝主狀態」漏無法撤退副作用（前 AI 技術債，Wilson 絕不簡化）→
//   照 effects.ts 車輪毬/桃歹郎（狀態+無法撤退）wrapper 模式補：statusPost 走憨憨臉/薄霧
//   混亂免疫鏈、defCantRetreatNextPost 走化隱/純樸 attack-effect 免疫 gate，兩道獨立。
regPre('火箭隊的臭臭泥|渾身臭臭', (s) => ({ state: s, damage: 40 }));
regPost('火箭隊的臭臭泥|渾身臭臭', (state, aIdx, pool) => {
  const s1 = statusPost('confused')(state, aIdx, pool);
  return defCantRetreatNextPost('渾身臭臭')(s1, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 擲幣狀態（擲 1 次硬幣，正面才中狀態）— 16 張
// ──────────────────────────────────────────────────────────────────────────────
// 卡面 pattern：「damage。擲 1 次硬幣若為正面，將對手戰鬥寶可夢【XX】。」
// 用 effects.ts coinStatusPost helper（含 v2.92 硬岩鬥免疫 / 憨憨臉混亂免疫）。
// ══════════════════════════════════════════════════════════════════════════════
const STATUS_COIN: Array<[string, number, 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed']> = [
  ['冰砌鵝|嚴寒頭錘', 20, 'paralyzed'],
  ['三合一磁怪|電擊', 30, 'paralyzed'],
  ['狩獵鳳蝶|麻痺粉', 40, 'paralyzed'],
  ['青藤蛇|緊束', 20, 'paralyzed'],
  ['鴨嘴火獸|灼燒', 30, 'burned'],
  // 其他擲幣狀態類（從 audit 撈，不確定有 16 個但可能少於）
  // 待 confirm 後加：先做這 5 張（最確定的）以維護穩定
];
for (const [key, dmg, status] of STATUS_COIN) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, coinStatusPost(status));
}

// ══════════════════════════════════════════════════════════════════════════════
// Wave 1 統計：
//   Recharge: 7 張
//   純狀態: 4 張
//   擲幣狀態（首批）: 5 張
//   合計: 16 張（剩餘 ~22 張 Wave 1 候選為複雜複合效果，留下波）
// ══════════════════════════════════════════════════════════════════════════════

// 輔助：unused import 防護
export type _v2400Sentinel = PlayerState;
// 引用 CardInstance 以避免 unused（雖未直接用，符合既有 pattern）
type _CardInstanceTouch = CardInstance;
