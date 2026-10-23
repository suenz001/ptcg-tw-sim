import type { Card } from '$lib/cards/types';
import type { GameAction, GameState } from './types';
import type { Seat } from './modal-slots';
import { actionResponsibility } from './action-responsibility';
import { getAIAction } from './ai';
import { damageDistributeCandidates } from './selection-candidates';
import { attackGatePendingFor } from './attack-gate';

/**
 * 超時收尾入口：每次只產生一個必要動作，由伺服器經版本 CAS 套用後再重新判斷。
 * 禁止以完整 AI 主階段幫玩家出牌、進化、發動特性或開始攻擊。
 */
export function timeoutAction(g: GameState, pool: Map<string, Card>, seat: Seat): GameAction | null {
  if (!actionResponsibility(g).includes(seat)) return null;
  if (g.pendingSelection) {
    const action = getAIAction(g, pool, seat);
    const sel = g.pendingSelection;
    // 既有對戰 AI 的分配策略偏好備戰；必要收尾必須尊重視窗真正允許的候選（也可能只有戰鬥位）。
    // minCount>0 的分配不可用空選擇跳過，更不能讓多於六張的能量分配只搬六張。
    // 不碰 abraRemove 的移除上限／可選零語意，只補一般放置／能量改附的合法選擇。
    if (action?.type === 'RESOLVE_SELECTION' && sel.type === 'damage-distribute'
      && sel.params?.abraRemove !== true && action.selectedIids.length < sel.minCount) {
      const candidates = damageDistributeCandidates(sel.params, g.players[sel.sourcePlayerIdx]);
      if (candidates.length) {
        return { type: 'RESOLVE_SELECTION', selectedIids: Array.from({ length: sel.maxCount }, () => candidates[0].iid),
          senderIdx: seat, pendingToken: sel.token };
      }
      return null;
    }
    return action?.type === 'RESOLVE_SELECTION' ? { ...action, senderIdx: seat } : null;
  }
  const owed = g.pendingPrizes?.[seat] ?? 0;
  if (owed > 0) return { type: 'TAKE_PRIZES', count: owed, playerIdx: seat };
  if (g.players[seat].active === null) {
    const action = getAIAction(g, pool, seat);
    return action?.type === 'SEND_NEW_ACTIVE' ? { ...action, senderIdx: seat } : null;
  }
  // ⭐v6.595 已通過出招前的擲幣、正在等選擇（宣告了就要出招，引擎此時不接受 END_TURN）⇒ 用預設選擇把那一招打完
  //   （不帶選擇內容 ＝ 引擎各招的既定預設：「若希望」型不付、借招自動挑）
  const gatedAttack = attackGatePendingFor(g, seat);
  if (gatedAttack != null) return { type: 'ATTACK', attackIndex: gatedAttack };
  return g.activePlayerIndex === seat ? { type: 'END_TURN' } : null;
}
