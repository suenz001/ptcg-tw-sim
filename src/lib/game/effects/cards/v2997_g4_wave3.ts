/**
 * v2.997 Group 4 Wave 3 — 10 張條件 passive + 能量計算類特性實裝（Group 4 最後一波）
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 4，Wave 3 主要是「條件 passive / 能量計算」
 * 類特性，無需 regA（主動特性 button），全部走 engine.ts 的 hook 點完成。
 *
 * 本檔案以「導出 helper / 集中註解」為主，實際 hook 在 engine.ts canAffordAttack /
 * canEvolve / PLAY_BASIC / canUseAttack 等位置呼叫。詳見 effects.ts 末段定義的
 * 5 個 cost helper：
 *   getCorphishPreparationEffectiveCost      — 好勝毛蟹｜事先準備
 *   getWiglettPreparationEffectiveCost       — 輕身鱈｜事先準備
 *   getSkeledirgeRowdyContestEffectiveCost   — 熾焰咆哮虎ex｜喧鬧競技
 *   getAzumarillSparkleSplashEffectiveCost   — 瑪力露麗｜亮亮泡
 *   getSonidoTuningResonanceEffectiveCost    — 音波龍｜調諧迴響
 *
 * 已實裝（10 張中的 8 張完整 + 2 張 deferred）：
 *
 *   A. 能量計算類 5 張（getXxxEffectiveCost helper，engine canAffordAttack hook）：
 *     1. 好勝毛蟹｜事先準備      — 招式所需【無】減自方棄牌「海岱」張數
 *     2. 輕身鱈｜事先準備        — 同上（共用 helper 邏輯）
 *     3. 熾焰咆哮虎ex｜喧鬧競技 — 招式所需【無】減對手備戰寶可夢數量（最多 5）
 *     4. 瑪力露麗｜亮亮泡        — 自方場上有「太晶」寶可夢時，「捨身衝撞」cost 改為 1【超】
 *     5. 音波龍｜調諧迴響        — 雙方手牌張數相同時，「恐慌嚎鳴」cost 全部消除
 *
 *   B. 條件 passive 3 張：
 *     6. 請假王ex｜懶怠個性      — 對手場上沒有 ex/V → 無法使用招式（engine getAvailableAttacks + ATTACK handler）
 *     7. 小嘴蝸｜刺激進化        — 自方場上有「蓋蓋蟲」→ bypass isFirstTurn / justPlaced gate
 *     8. 蓋蓋蟲｜刺激進化        — 自方場上有「小嘴蝸」→ bypass isFirstTurn / justPlaced gate
 *
 *   C. Rule marker 1 張：
 *     9. 海豚俠ex｜全能靈魂      — 禁止從手牌 PLAY_BASIC（engine PLAY_BASIC handler 加 gate）
 *
 *   D. Deferred 1 張：
 *    10. 齒輪怪｜緊急迴轉        — 「手牌中觸發特性」需要新的 ON_HAND_ACTIVATE 機制 + UI 改動
 *                                  風險過高（engine 沒現成 hook，需獨立 wave）→ Deferred
 *
 * 設計原則：
 *   - 所有 cost helper pattern 同 v2.133 getKyuremElectroplasmaEffectiveCost
 *     - 任何招式都生效（不限定特定招式名）的兩張：好勝毛蟹/輕身鱈、熾焰咆哮虎ex
 *     - 限定特定招式名：瑪力露麗（捨身衝撞）、音波龍（恐慌嚎鳴）
 *   - 刺激進化：在 EVOLVE handler + getEvolvableTargets 兩處鏡射（engine.ts:1674 / 5066）
 *   - 懶怠個性：在 getAvailableAttacks（engine.ts:4980 區）+ ATTACK handler（engine.ts:2659）兩處檢查
 *   - 全能靈魂：在 PLAY_BASIC handler（engine.ts:1534）加 gate，傳回原 state（不改變）
 *
 *   - 揭示資訊（Iron Rule 8）：cost helper 改寫為公開行為（雙方都看得到），不需 addLog
 *     懶怠個性 / 全能靈魂 觸發時 engine 會 addLog 公開原因
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';

// 導出 sentinel 防止 unused import warnings
export type _v2997Sentinel = PlayerState | GameState | Card | CardInstance;

// 本檔案不直接 reg* 任何東西，所有實裝都是 effects.ts 的 export helper +
// engine.ts 的 hook。保留此檔做為「Wave 3 集中註解」+ 自動載入觸發點。
//
// 為了讓 effects.ts:357 區的 import './effects/cards/v2997_g4_wave3' 不報錯，
// 必須有實際 export（即上方 _v2997Sentinel 型別）。
