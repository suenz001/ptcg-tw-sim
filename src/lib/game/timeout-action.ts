import type { Card } from '$lib/cards/types';
import type { GameAction, GameState } from './types';
import type { Seat } from './modal-slots';
import { actionResponsibility } from './action-responsibility';
import { getAIAction } from './ai';

/**
 * 超時收尾入口：每次只產生一個必要動作，由伺服器經版本 CAS 套用後再重新判斷。
 * 禁止以完整 AI 主階段幫玩家出牌、進化、發動特性或開始攻擊。
 */
export function timeoutAction(g: GameState, pool: Map<string, Card>, seat: Seat): GameAction | null {
  if (!actionResponsibility(g).includes(seat)) return null;
  if (g.pendingSelection) {
    const action = getAIAction(g, pool, seat);
    return action?.type === 'RESOLVE_SELECTION' ? { ...action, senderIdx: seat } : null;
  }
  const owed = g.pendingPrizes?.[seat] ?? 0;
  if (owed > 0) return { type: 'TAKE_PRIZES', count: owed, playerIdx: seat };
  if (g.players[seat].active === null) {
    const action = getAIAction(g, pool, seat);
    return action?.type === 'SEND_NEW_ACTIVE' ? { ...action, senderIdx: seat } : null;
  }
  return g.activePlayerIndex === seat ? { type: 'END_TURN' } : null;
}
