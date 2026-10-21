import type { GameState } from './types';
import { promoteWaitSeat, type Seat } from './modal-slots';

/**
 * 個人操作時計的責任集合。與閒置判負的「單一優先人」不同：
 * 引擎容許兩人同時取獎，或一人取獎、另一人補位；兩人都有待辦時各計自己的時間。
 * setup 不計個人額度，沿用既有開局／閒置規則。
 * 不以 pendingSelection 的真偽直接退回回合方，未知 owner 必須停止計時而非誤罰。
 */
export function actionResponsibility(g: GameState | null | undefined): Seat[] {
  if (!g || g.phase !== 'playing') return [];
  if (g.pendingSelection) {
    const owner = g.pendingSelection.actorIdx;
    return owner === 0 || owner === 1 ? [owner] : [];
  }
  const result: Seat[] = [];
  const waiting = promoteWaitSeat(g);
  for (const seat of [0, 1] as const) {
    const p = g.players[seat];
    const prize = (g.pendingPrizes?.[seat] ?? 0) > 0;
    const promote = p?.active === null && p.bench.length > 0 && waiting !== seat;
    if (prize || promote) result.push(seat);
  }
  if (result.length) return result;
  // 無寶可夢可補位屬終局結算，不可把系統停滯時間算給任一玩家。
  if (!g.players[0]?.active || !g.players[1]?.active) return [];
  return g.activePlayerIndex === 0 || g.activePlayerIndex === 1 ? [g.activePlayerIndex] : [];
}

/** turn 每後攻回合才遞增；必須包含座位才能識別半回合。 */
export function actionTurnKey(g: GameState): string {
  return `${g.gameStartTime ?? 0}:${g.turn}:${g.activePlayerIndex}`;
}
