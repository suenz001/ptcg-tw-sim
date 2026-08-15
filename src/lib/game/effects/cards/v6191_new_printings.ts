// v6.191 官方卡牌檢索完整性補收 —— 新卡效果實裝
//
// 來源：台灣官方卡牌檢索（asia.pokemon-card.com/tw）逐張比對後，H/I/J 標共缺 5 張：
//   ・M-P 212/M-P 探探鼠（J）        ← 既有卡名的另一印刷（M4 068/083 已實裝）
//   ・M-P 213/M-P 特殊紅牌（J）      ← 既有卡名的另一印刷（M4 072/083 已實裝）
//   ・M-P 214/M-P 玳蘿（J）          ← ⭐ 全新卡名 ＋ 全新 gate 維度
//   ・M-P 215/M-P 老大的指令（I）    ← 既有卡名的另一印刷（v6.191 補收時站內先收成
//                                       「老大的指令（烏羽）」，v6.193 站長裁定改回本名）
//   ・SV8a 172/187 探險家的嚮導（H）  ← 既有卡名的另一印刷（SV5K/SV8a/MC 已實裝）
//
// ⚠ reg key 是**卡名**，所以「另一印刷」只要卡片進 DB 就自動生效，這裡不必再登錄。
// ⚠ 卡面逐字取自 static/cards（台灣官方中文 rulesText），未經簡化。
// ⚠「老大的指令」不在本檔登錄 —— 它走的是同一條中央管線，收斂在 supporters_gust.ts
//    的 registerGustSupporter() factory（禁再抄一份）。

import type { CardInstance } from '../../types';
import type { GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import { reg, regR, regG, addLog } from '../_shared';
import { withPending } from '../_shared';
import { isMegaExCard } from '../../selection-filter';
import { startEnergyChain } from './v158_energy_chain';

// ══════════════════════════════════════════════════════════════════════════════
// 玳蘿（Supporter / M-P 214/M-P / J 標）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面（逐字）：
//   這張卡必須在上個對手的回合自己的「超級進化寶可夢【ex】」【昏厥】了才可使用。
//
//   從自己的牌庫選擇最多2張基本能量卡，附於自己的1隻「超級進化寶可夢【ex】」身上。並且重洗牌庫。
//
// ⭐「超級進化寶可夢【ex】」一律走中央述詞 isMegaExCard（selection-filter.ts，
//    與 prizesForKO 給 3 張獎賞／deck-search 'MegaEx' filter／飯匙蛇｜激動力量 同一條）。
//
// ⭐ gate（判準①：訓練家卡效果完全無法執行 ⇒「不可以使用」）：
//    ・上個對手的回合沒有自己的 Mega ex 昏厥 → 卡面前提不成立
//    ・牌庫 0 張 → 官方 L821 電氣發生器「不可以」
//    ・場上沒有「超級進化寶可夢【ex】」 → 官方 L805 電氣發生器（備戰無【雷】寶可夢）「不可以」
//    ⚠「牌庫裡有沒有基本能量卡」是**隱藏資訊**，不進 gate（fail-to-find 由 picker 端處理）。
//
// ⭐「昏厥」的計算口徑與同家族（八朔／不公印章／火箭隊的阿波羅）完全一致：
//    只計對手主回合中的「招式 KO」＋「主動特性 KO」，不含寶可夢檢查階段（中毒／灼傷等），
//    因為寶可夢檢查不屬於任何一方的回合。計數由中央 recordOppKO 累積。

/** 自方場上（含戰鬥位）的「超級進化寶可夢【ex】」。玳蘿 gate 與目標白名單共用同一份述詞。 */
export function megaExOnOwnField(
  st: GameState, idx: 0 | 1, pool: Map<string, Card>,
): CardInstance[] {
  const p = st.players[idx];
  const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  return all.filter((c) => isMegaExCard(pool.get(c.cardId)));
}

/** 上個對手的回合自己的「超級進化寶可夢【ex】」昏厥次數（招式 KO ＋ 主動特性 KO）。 */
export function megaExKOdInLastOppTurn(st: GameState, idx: 0 | 1): number {
  return (st.oppAttackKOdMyMegaExInLastOppTurn?.[idx] ?? 0)
    + (st.oppAbilityKOdMyMegaExInLastOppTurn?.[idx] ?? 0);
}

regG('玳蘿', (st, idx, pool) => {
  if (megaExKOdInLastOppTurn(st, idx) <= 0) return false;
  if (st.players[idx].deck.length === 0) return false;
  return megaExOnOwnField(st, idx, pool).length > 0;
});

reg('玳蘿', (st, idx) => {
  st = addLog(st, '玳蘿：從牌庫選最多 2 張基本能量卡，附於自己的 1 隻「超級進化寶可夢【ex】」', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    // 判準②：**帶條件**的牌庫搜尋（基本能量卡）可宣告「找不到」⇒ 可選 0（同 赤松／能量硬幣）。
    minCount: 0, maxCount: 2,
    effectKey: 'v6191-daitaro-pick',
    params: {
      titleOverride: '玳蘿：從牌庫選最多 2 張基本能量卡（接著選要附給哪隻「超級進化寶可夢【ex】」）',
      allowSkipZero: true,
    },
  });
});

// ⭐ 卡面是「附於自己的**1隻**『超級進化寶可夢【ex】』身上」＝ 選好的能量**全部附同一隻**，
//    不是「以任意方式」分散 ⇒ 中央 startEnergyChain 的 singleTarget:true 分支（v6.105）。
//    能量從牌庫取出／重洗牌庫／0 張的處理／場上無合法目標的 leftover log 全部由它負責。
regR('v6191-daitaro-pick', (st, idx, iids, _params, pool) => {
  const targetIids = megaExOnOwnField(st, idx, pool).map((c) => c.iid);
  return startEnergyChain(st, idx, iids, {
    label: '玳蘿',
    source: 'deck',
    scope: 'any-own',
    filterType: 'Any',
    targetIids,
    singleTarget: true,
  }, pool);
});
