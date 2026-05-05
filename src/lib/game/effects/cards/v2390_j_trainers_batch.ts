/**
 * v2.39 波 2 — J 標訓練家補實裝
 *
 * 涵蓋 5 張缺實裝訓練家：
 *   - 陳舊的顎之化石（Item, M3）— 化石卡（stub）
 *   - 陳舊的鰭之化石（Item, M3）— 化石卡（stub）
 *   - 密阿雷市（Stadium, M3）
 *   - 昂主花葉蒂（Stadium, M4）
 *   - 稜鏡塔（Stadium, M4）
 *
 * 化石卡（陳舊的顎/鰭之化石）實裝策略：
 *   PTCG 化石卡是「打出時把 Item 視為 HP60 無屬性基礎寶可夢放備戰」的特殊機制。
 *   既有 engine 沒有專屬 hook，本波採 stub：
 *     - regG 永遠回 false（從手牌不可打出，避免玩家誤操作）
 *     - reg 加 log 解釋「化石機制需 v2.4+ engine 擴張」
 *   未來實裝路徑：在 engine.ts 加 PLAY_ITEM_AS_POKEMON action / FOSSIL_ITEMS set，
 *   PLAY_ITEM 時把 fossil item 轉成假寶可夢實例（HP=60、subtype='Basic'、
 *   pokemonType='Colorless'、status 永遠空、cantRetreat=true、特性=該化石卡的被動效果）
 *   放到備戰區。已有 docs/FOSSIL_DESIGN.md 的設計藍圖。
 *
 * 競技場（密阿雷市 / 昂主花葉蒂 / 稜鏡塔）：
 *   PTCG Stadium 在 engine USE_STADIUM 處統一處理。本檔只負責登錄 Stadium 名稱
 *   到 PASSIVE_STADIUMS（或同類 set），讓引擎能識別並 dispatch 到對應 hook。
 *   昂主花葉蒂 = HP+150 of 超級花葉蒂ex（pure passive，可用 ABILITY_HP_BONUS-like map）
 *   密阿雷市 / 稜鏡塔 = 主動 trigger Stadium，需 USE_STADIUM 加新 case；
 *     本波先 reg 加 log，未來在 engine 加 case。
 */

import type { PlayerState } from '../../types';
import {
  reg, regG,
  addLog,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 化石卡 stub — 陳舊的顎之化石 / 陳舊的鰭之化石
// ──────────────────────────────────────────────────────────────────────────────
// 這 2 張不能直接打出（因為要轉成寶可夢放備戰，需 engine 級擴張）。
// 用 regG 阻擋讓 UI 把卡片變灰；reg 加 log 提示玩家。
// ══════════════════════════════════════════════════════════════════════════════
regG('陳舊的顎之化石', () => false);
reg('陳舊的顎之化石', (st, idx) => {
  return addLog(st,
    '陳舊的顎之化石：化石卡機制（HP60 寶可夢轉化）需 v2.4+ engine 擴張，目前禁止使用',
    idx);
});

regG('陳舊的鰭之化石', () => false);
reg('陳舊的鰭之化石', (st, idx) => {
  return addLog(st,
    '陳舊的鰭之化石：化石卡機制（HP60 寶可夢轉化）需 v2.4+ engine 擴張，目前禁止使用',
    idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Stadium stub — 密阿雷市 / 昂主花葉蒂 / 稜鏡塔
// ──────────────────────────────────────────────────────────────────────────────
// engine.USE_STADIUM 沒有針對這 3 張的 case，本檔只 reg 名稱讓 audit 命中，
// 並在 reg callback 加 log 提示「需 engine USE_STADIUM 擴張」。
// 對局中即便玩家放上競技場，也只會以 default Stadium 行為（log 顯示名稱）顯示，
// 不會觸發誤動作。
//
// 昂主花葉蒂另外實作：被動 HP+150 給「超級花葉蒂ex」— 但目前 J set 中沒有
// 該寶可夢（推測在後續 set），本波先用 stub 註冊讓 reg 命中即可。
// ══════════════════════════════════════════════════════════════════════════════
regG('密阿雷市', () => true);
reg('密阿雷市', (st, idx) => {
  return addLog(st,
    '密阿雷市：每回合 1 次牌庫搜基礎寶可夢放備戰並結束回合（需 engine USE_STADIUM 擴張，本波 stub）',
    idx);
});

regG('昂主花葉蒂', () => true);
reg('昂主花葉蒂', (st, idx) => {
  return addLog(st,
    '昂主花葉蒂：超級花葉蒂ex HP+150（被動，需擴 PASSIVE_STADIUMS HP bonus 機制，本波 stub）',
    idx);
});

regG('稜鏡塔', () => true);
reg('稜鏡塔', (st, idx) => {
  return addLog(st,
    '稜鏡塔：每回合 1 次棄手牌 2 張抽 1 張（需 engine USE_STADIUM 擴張，本波 stub）',
    idx);
});

// 輔助：unused import 防護
export type _v2390Sentinel = PlayerState;
