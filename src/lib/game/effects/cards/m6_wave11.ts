// v6.078 M6「綠寶石風暴」實裝 批次 11 —— 新機制招式（5 張 / 5 招）
//
// ⚠ 卡面逐字取自 static/cards/M6.json 的 `effect` 欄（台灣官方中文），未經簡化。
// ⚠ 三個機制都在 effects.ts 收斂成中央 helper，既有同措辭的舊卡（燒火蚣／石居蟹／
//   夢妖／伊布／火箭隊的沙基拉斯／配樂之笛）同版一起接同一個來源，避免複製碼漂移。

import { registerDirectEvolveAwaken, registerBugPanicAttack,
         openLureOutOppTopN, resolveLureOutOppTopN } from '../../effects';
import { regPre, regPost, regR } from '../_shared';

// ── 1. 蟲蟲恐慌（雨翅蛾 / 三蜜蜂 / 圓絲蛛，共 3 張）────────────────────────
// 卡面：將自己的牌庫下方7張卡翻到正面，造成其中持有招式「蟲蟲恐慌」的寶可夢卡的
//        張數×50點傷害。將翻到正面的寶可夢卡放回牌庫並重洗。將剩餘卡丟棄。
//   ⭐ 三張與 M5 燒火蚣措辭逐字相同 → 共用 registerBugPanicAttack。
//   ⚠ 計數判準是「卡上有名為『蟲蟲恐慌』的招式」，不是硬編這四張卡名 ——
//     未來卡包再出同招式的寶可夢會自動計入（卡面就是這樣寫的）。
//   ⚠ 傷害倍率張數（限有此招式者）≠ 洗回牌庫的張數（全部寶可夢卡），兩者範圍不同。
registerBugPanicAttack('雨翅蛾');
registerBugPanicAttack('三蜜蜂');
registerBugPanicAttack('圓絲蛛');

// ── 2. 穿山鼠｜覺醒 ────────────────────────────────────────────────────────
// 卡面：從自己的牌庫選擇1張從這隻寶可夢進化而來的卡，放置於這隻寶可夢身上完成進化。
//        並且重洗牌庫。
//   ⭐ 與石居蟹｜覺醒／夢妖｜覺醒／伊布｜覺醒措辭逐字相同 → 共用 registerDirectEvolveAwaken。
//   ⚠ 招式效果進化不受「該回合放置／進化速度」限制（不是 EVOLVE 動作）。
registerDirectEvolveAwaken('穿山鼠|覺醒', '穿山鼠', 0, 'sandshrew-awaken-evolve');

// ── 3. 勾魂眼｜引誘出來 ────────────────────────────────────────────────────
// 卡面：將對手的牌庫上方5張卡翻到正面，從其中選擇任意數量的【基礎】寶可夢卡，
//        放置於對手的備戰區。將剩餘卡放回牌庫並重洗。
//   ⭐ 與訓練家「配樂之笛」措辭逐字相同 → 共用 openLureOutOppTopN / resolveLureOutOppTopN。
//   ⚠ 對手備戰上限走 getOwnBenchLimit（零之大空洞＋太晶 = 8），禁硬編 5。
//   ⚠ 效果目標是「對手的牌庫／備戰區」不是對手某隻寶可夢 → 不套化隱免疫 gate
//     （canApplyEffectToTarget 保護的是「這隻寶可夢」）。與配樂之笛既有行為一致。
regPre('勾魂眼|引誘出來', (s) => ({ state: s, damage: 0 }));
regPost('勾魂眼|引誘出來', (state, aIdx, pool) =>
  openLureOutOppTopN(state, aIdx, pool, '引誘出來', 'sableye-lure-out', 5));
regR('sableye-lure-out', (state, aIdx, iids, _params, pool) =>
  resolveLureOutOppTopN(state, aIdx, iids, pool, '引誘出來', 5));
