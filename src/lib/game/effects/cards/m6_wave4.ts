/**
 * M6「綠寶石風暴」— 招式實裝 批次 4（v6.063）：3 招
 *
 * 選件判準同前三批（卡面措辭與既有卡逐字相同）；本批既有範本 96／14／9 張。
 * 為此把 `registerSelfDiscardMultiply` 與 `oppDiscardRandomHand` 兩個 local helper
 * 加上 export（零搬移、零行為變更）。
 *
 * ⚠ 本批刻意**不含**電擊獸｜呼朋引伴（範本 29 張）：它的既有 handler 依賴
 *   `isBasicPokemonCard`（定義在 engine.ts），若把 helper 搬到 effects.ts 會造成
 *   effects→engine 的反向 import（分層問題）。留待單獨一批處理，不在新卡批次裡硬塞。
 */

import { regPre, regPost } from '../_shared';
import {
  registerSelfDiscardMultiply, oppDiscardChosenConcealedPost, applyStatusToOppActive,
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 1 攻擊後強制丟棄自身 N 個能量（既有 96 張，中央 registerSelfDiscardMultiply）
//   加熱洛托姆ex｜強力閃焰 damage='170'：選擇2個這隻寶可夢身上附加的能量，將其丟棄。
//   參數：base=170、per=0（丟能量不加傷）、max=2、min=2 → 卡面「選擇2個」＝強制剛好 2 個。
//   ⚠ helper 的註解明載：per=0 的「強制 N 個 cost」型**必須傳 min=max**，否則會變成「最多 N 個」。
// ══════════════════════════════════════════════════════════════════════════════
registerSelfDiscardMultiply('加熱洛托姆ex|強力閃焰', '強力閃焰', 170, 0, 2, 'all', false, 2);

// ══════════════════════════════════════════════════════════════════════════════
// 2 「不看正面」從對手手牌**選擇** 1 張丟棄（中央 oppDiscardChosenConcealedPost）
//   好啦魷｜拍落 damage='10'：在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。
//   ⚠⚠ 這裡**不是隨機**。卡面明寫「選擇」，攻方盲選位置（看卡背）；站上 v3.9998 已對
//     逐字相同的 太陽伊布ex｜精神出局 做過此裁定。
//     本檔第一版誤用 oppDiscardRandomHand，原因是照抄了 滑滑小子｜拍落 —— 但**那張本身就是
//     既有 bug**。教訓：「措辭相同＋既有範本多」不等於安全，範本本身可能是錯的；
//     照抄前要先確認該範本有沒有對應的裁定紀錄（本例 effects.ts v3.9998 註解就寫著）。
// ══════════════════════════════════════════════════════════════════════════════
regPost('好啦魷|拍落', oppDiscardChosenConcealedPost(1, '拍落'));

// ══════════════════════════════════════════════════════════════════════════════
// 3 中毒且改變每次檢查的傷害（既有 9 張，範本：超級毒藻龍ex｜致死猛毒）
//   阿利多斯｜劇痛毒 damage=''：將對手的戰鬥寶可夢【中毒】。
//     因這個【中毒】而放置的傷害指示物的數量改為4個。
//   ⚠⚠ `poisonDamagePerCheckup` 的單位是**傷害點數**，不是指示物個數：
//      範本 致死猛毒 卡面寫「16個」→ 既有實作傳 160。故本卡「4個」要傳 **40**（4×10）。
//      直覺傳 4 會少算 10 倍（與「凹洞放N個指示物漏×10」是同一型陷阱）。
//   applyStatusToOppActive 內含完整免疫 gate（kind='attack-effect'）。
// ══════════════════════════════════════════════════════════════════════════════
regPre('阿利多斯|劇痛毒', (s) => ({ state: s, damage: 0 }));
regPost('阿利多斯|劇痛毒', (state, aIdx, pool) =>
  applyStatusToOppActive(state, aIdx, 'poisoned', pool, {
    kind: 'attack-effect', label: '劇痛毒', poisonDamagePerCheckup: 40,
  }));
