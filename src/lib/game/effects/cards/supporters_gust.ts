/**
 * 支援者（Supporter）— 呼叫對手（Gust 系列）
 *
 * v2.24 (Session 38bd)：從 effects.ts 抽離，模組化第 6 波。
 *
 * 「Gust 類」支援者：選擇對手備戰寶可夢 → 與對手戰鬥寶可夢互換位置。
 *
 * v6.191：官方在 M-P 215/M-P 發了「老大的指令（烏羽）」（I 標），rulesText 與
 * 「老大的指令」逐字相同（「選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。」）。
 * ⚠ reg key 是**卡名**逐字比對，冠名不同 = 兩個 key，不會自動生效 ⇒ 收斂成
 * registerGustSupporter() factory 各登錄一次，**禁複製第二份 gate/effect**。
 *
 * 注意：同機制的物品卡「頂尖捕捉器」放在 items_misc.ts（item vs supporter 分開分類）。
 */

import { tryPromptPromoteActive } from '../_shared';
import { promoteOppBenchToActive } from '../_shared';  // ⭐ v6.174 換場目標解析失敗一律 no-op + 據實 log
import {
  reg, regR, regG,
  addLog, updatePlayer, withPending,
  clearActiveEffects,
} from '../_shared';
// v3.06 對手 trainer 免疫 helper（斧牙龍｜緊張感 / 浩大鯨ex｜融合為雪）
import { isImmuneToOppTrainer as _isImmuneOppTrainer_unused } from './v3060_deferred_wave_b';
void _isImmuneOppTrainer_unused;
// v3.08 對手 supporter 免疫綜合 helper（含廣域堡壘 — 超甲狂犀戰鬥場時整體免疫）
import { isImmuneToOppSupporter } from './v3080_deferred_wave_c';
// v6.191 Gust 系卡名單一來源（葉子模組，零 import，ai.ts 也讀同一份）
import { GUST_SUPPORTER_NAMES } from '../../gust-supporters';

// ══════════════════════════════════════════════════════════════════════════════
// 老大的指令 — 選 1 隻對手備戰寶可夢與其戰鬥寶可夢互換
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Gust 系支援者的中央登錄 factory（gate ＋ effect ＋ log 全部同一份）。
 * ⚠ 新的冠名版本一律加進 GUST_SUPPORTER_NAMES，禁另寫一份 regG/reg。
 */
function gustValidOppBenchIids(
  st: import('../../types').GameState, idx: 0 | 1, pool: Map<string, import('$lib/cards/types').Card>,
): string[] {
  const oppIdx = (1 - idx) as 0 | 1;
  // v2.388 陳舊的鰭之化石被動 — 不受對手支援者影響：filter 排除
  // v3.06 緊張感 / 融合為雪 — 對手 trainer 免疫：filter 排除
  // v3.08 廣域堡壘 — 超甲狂犀戰鬥場時，整個自方場上對 supporter 免疫
  return st.players[oppIdx].bench.filter(b => {
    const card = pool.get(b.cardId);
    if (b.fossilOnField && card?.name === '陳舊的鰭之化石') return false;
    if (isImmuneToOppSupporter(st, oppIdx, b, pool)) return false;
    return true;
  }).map(b => b.iid);
}

function registerGustSupporter(cardName: string): void {
  regG(cardName, (st, idx, pool) => gustValidOppBenchIids(st, idx, pool).length > 0);
  reg(cardName, (st, idx, pool) => {
    const oppIdx = (1 - idx) as 0 | 1;
    const validIids = gustValidOppBenchIids(st, idx, pool);
    if (validIids.length === 0) {
      return addLog(st, `${cardName}：對手備戰區沒有可呼叫的寶可夢（化石/緊張感/融合為雪/廣域堡壘 免疫）`, idx);
    }
    st = addLog(st, `${cardName}：選擇要呼叫的對手備戰寶可夢`, idx);
    return withPending(st, {
      type: 'opp-bench-choose',
      actorIdx: idx, sourcePlayerIdx: oppIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'gust-opp',
      params: { validIids },
    });
  });
}

// 卡名清單來自葉子模組 gust-supporters.ts（ai.ts 也讀同一份 —— 禁在這裡再抄一份）。
for (const _n of GUST_SUPPORTER_NAMES) registerGustSupporter(_n);

// ⭐ v6.174：原本是「**先** addLog 宣告已經換好 → **後**才 findIndex，找不到就靜默 return p」，
//   目標解析失敗時 log 會騙玩家（實戰已出現 `呼叫 ? 到對手戰鬥場`）。收斂到中央
//   promoteOppBenchToActive：解析失敗 = 完全 no-op + 據實 log。
regR('gust-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // label 空字串＝維持既有成功 log 逐字格式「將對手戰鬥場的 X 換到備戰區，呼叫 Y 到對手戰鬥場」
  const afterSt = promoteOppBenchToActive(st, oppIdx, iids[0], pool, '', idx).state;
  // v5.245：自方換位 ON_PROMOTE_TO_ACTIVE prompt（火箭隊的坂木自換 + 對換場景：
  //   self-swap 已 set 自方 active.movedToActiveThisTurn=true，gust-opp 完成後 prompt 自方特性。
  //   老大的指令場景：自方 active 沒換場 → helper 內 movedToActiveThisTurn check 會 skip）
  return tryPromptPromoteActive(afterSt, idx, pool);
});
