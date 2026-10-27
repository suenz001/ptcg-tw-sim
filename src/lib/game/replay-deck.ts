import type { GameState } from './types';
import { HIDDEN_CARD_ID } from './replay-record';

/** 只讀目前復盤格的牌庫；第一張就是下次抽牌。不補推舊檔的隱藏資料。 */
export function replayDeckOrder(isReplay: boolean, state: GameState | null, seat: number | null, revealAll: boolean, viewerSeat: unknown) {
  if (!isReplay || !state || (seat !== 0 && seat !== 1)) return null;
  const deck = state.players?.[seat]?.deck;
  if (!Array.isArray(deck)) return null;
  const allowed = revealAll || viewerSeat === seat;
  const rows = deck.map((inst, index) => ({
    position: index + 1,
    cardId: allowed && typeof inst?.cardId === 'string' && inst.cardId && inst.cardId !== HIDDEN_CARD_ID ? inst.cardId : null,
  }));
  return { rows, hidden: rows.filter(row => !row.cardId).length };
}
