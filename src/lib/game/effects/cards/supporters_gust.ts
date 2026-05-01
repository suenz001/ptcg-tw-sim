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

import {
  reg, regR, regG,
  addLog, updatePlayer, withPending,
  clearActiveEffects,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 老大的指令 — 選 1 隻對手備戰寶可夢與其戰鬥寶可夢互換
// ══════════════════════════════════════════════════════════════════════════════

regG('老大的指令', (st, idx) => st.players[(1 - idx) as 0 | 1].bench.length > 0);
reg('老大的指令', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[oppIdx].bench.length === 0) {
    return addLog(st, '老大的指令：對手備戰區沒有寶可夢', idx);
  }
  st = addLog(st, '老大的指令：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',
  });
});

regR('gust-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const oppPlayer = st.players[oppIdx];
  const target = oppPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = oppPlayer.active ? (pool.get(oppPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `將對手戰鬥場的 ${oldName} 換到備戰區，呼叫 ${newName} 到對手戰鬥場`, idx);
  return updatePlayer(st, oppIdx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: { ...p.bench[bIdx], justPlaced: false, playedFromHand: false }, bench: newBench };
  });
});
