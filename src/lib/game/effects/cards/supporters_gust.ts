/**
 * 支援者（Supporter）— 呼叫對手（Gust 系列）
 *
 * v2.24 (Session 38bd)：從 effects.ts 抽離，模組化第 6 波。
 *
 * 「Gust 類」支援者：選擇對手備戰寶可夢 → 與對手戰鬥寶可夢互換位置。
 * 目前只有「老大的指令」一張，保留獨立模組未來擴充（例如：Boss's Orders 變體、
 * 新版呼叫類支援者等）。
 *
 * 注意：同機制的物品卡「頂尖捕捉器」放在 items_misc.ts（item vs supporter 分開分類）。
 */

import { tryPromptPromoteActive } from '../_shared';
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

// ══════════════════════════════════════════════════════════════════════════════
// 老大的指令 — 選 1 隻對手備戰寶可夢與其戰鬥寶可夢互換
// ══════════════════════════════════════════════════════════════════════════════

regG('老大的指令', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // v2.388 陳舊的鰭之化石被動 — 不受對手支援者影響：filter 排除
  // v3.06 緊張感 / 融合為雪 — 對手 trainer 免疫：filter 排除
  // v3.08 廣域堡壘 — 超甲狂犀戰鬥場時，整個自方場上對 supporter 免疫
  const validBench = st.players[oppIdx].bench.filter(b => {
    const card = pool.get(b.cardId);
    if (b.fossilOnField && card?.name === '陳舊的鰭之化石') return false;
    if (isImmuneToOppSupporter(st, oppIdx, b, pool)) return false;
    return true;
  });
  return validBench.length > 0;
});
reg('老大的指令', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // v2.388 陳舊的鰭之化石被動 — 不受對手支援者影響：filter 排除
  // v3.06 緊張感 / 融合為雪 — 對手 trainer 免疫：filter 排除
  // v3.08 廣域堡壘 — 超甲狂犀戰鬥場時，整個自方場上對 supporter 免疫
  const validIids = st.players[oppIdx].bench.filter(b => {
    const card = pool.get(b.cardId);
    if (b.fossilOnField && card?.name === '陳舊的鰭之化石') return false;
    if (isImmuneToOppSupporter(st, oppIdx, b, pool)) return false;
    return true;
  }).map(b => b.iid);
  if (validIids.length === 0) {
    return addLog(st, '老大的指令：對手備戰區沒有可呼叫的寶可夢（化石/緊張感/融合為雪/廣域堡壘 免疫）', idx);
  }
  st = addLog(st, '老大的指令：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',
    params: { validIids },
  });
});

regR('gust-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const oppPlayer = st.players[oppIdx];
  const target = oppPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = oppPlayer.active ? (pool.get(oppPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `將對手戰鬥場的 ${oldName} 換到備戰區，呼叫 ${newName} 到對手戰鬥場`, idx);
  const afterSt = updatePlayer(st, oppIdx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
    // v3.812：preserve justPlaced + playedFromHand
    return { ...p, active: { ...p.bench[bIdx] }, bench: newBench };
  });
  // v5.245：自方換位 ON_PROMOTE_TO_ACTIVE prompt（火箭隊的坂木自換 + 對換場景：
  //   self-swap 已 set 自方 active.movedToActiveThisTurn=true，gust-opp 完成後 prompt 自方特性。
  //   老大的指令場景：自方 active 沒換場 → helper 內 movedToActiveThisTurn check 會 skip）
  return tryPromptPromoteActive(afterSt, idx, pool);
});
