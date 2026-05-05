/**
 * v2.39 / v2.382 — J 標訓練家實裝索引（純註解，不註冊任何 reg / regG）
 *
 * 此檔原為 v2.39 的 stub batch，但經 v2.382 查證，其實所有 5 張卡都已實裝在
 * 既有架構中：
 *
 *   1. 陳舊的顎之化石（Item, M3 18045）—
 *      已實裝於 effects/cards/items_misc.ts（FOSSIL_NAMES_LOCAL）
 *      + engine.ts FOSSIL_ITEM_NAMES set + PLAY_FOSSIL / DISCARD_FOSSIL action。
 *      用 regG=false 阻擋一般 Item 路徑，走獨立化石 action 把 Item 視為 HP60 寶可夢放備戰。
 *      被動效果（戰鬥場時對手招式 -30）仍未實裝（v2.4+ 補 PASSIVE_FOSSIL_DAMAGE_REDUCE）。
 *
 *   2. 陳舊的鰭之化石（Item, M3 18046）— 同上 items_misc.ts FOSSIL_NAMES_LOCAL。
 *      被動效果（不受對手支援者影響）仍未實裝。
 *
 *   3. 密阿雷市（Stadium, M3 18054）—
 *      已實裝於 engine.ts:2235 USE_STADIUM case + stadiums.ts:106 resolver
 *      'miarey-city-place'。每回合 1 次牌庫搜基礎放備戰，使用後回合結束（v2.172）。
 *
 *   4. 昂主花葉蒂（Stadium, M4 18499）—
 *      v2.382 補實裝：超級花葉蒂ex HP +150（engine.ts getEffectiveHP + effects.ts
 *      effectiveHPInline 雙處鏡射 hook，仿激動競技場 +30 pattern）。
 *      stadiums.ts STATIC_PASSIVE_STADIUMS 已列出（行為標籤）。
 *
 *   5. 稜鏡塔（Stadium, M4 18500）—
 *      已實裝於 engine.ts:2086 USE_STADIUM case + mega_decks.ts:390 resolver
 *      'prism-tower-draw1'。每回合 1 次棄 2 張手牌抽 1 張（v2.102）。
 *
 * 結論：本檔僅作為 audit / 後續維護的「實裝索引」說明文件，不再註冊任何 reg。
 * effects.ts 仍 import 此檔以確保模組載入但無 side-effect（純註解）。
 */

import type { PlayerState } from '../../types';

// 輔助：避免 unused import 警告（純註解檔需此 sentinel）
export type _v2390Sentinel = PlayerState;
