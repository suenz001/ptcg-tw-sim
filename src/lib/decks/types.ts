// Deck model for the local (M1) deck editor.
// Stored in localStorage keyed by `ptcg-tw-sim:decks`; later persisted to
// Firestore per-user when Auth lands.

export interface DeckEntry {
  /** Card.id — the zh-TW site's numeric id (as string). */
  cardId: string;
  /** Copies of this card in the deck (1..4, unlimited for Basic Energy). */
  count: number;
  /**
   * v4.947 Phase 1：AI role hint（hybrid 系統）。
   *   - preset / 玩家自訂可手工標註精確 role
   *   - 沒標的卡 → AI 走 classifyRole() heuristic 自動推斷
   * 用於 AI 能量分配 / 進化順序 / SEND_NEW_ACTIVE 決策（Phase 2 接入）。
   * 取用方一律呼叫 src/lib/game/ai-roles.ts:getCardRole()，內部處理優先級。
   */
  role?: import('$lib/game/ai-roles').PokemonRole;
}

export interface Deck {
  id: string;
  name: string;
  entries: DeckEntry[];
  createdAt: string;
  updatedAt: string;
  notes?: string;
  /** v5.352：玩家自訂排序索引（牌組編輯器上下移動寫入）。未設者排在已設者之後（沿用 createdAt）。 */
  order?: number;
}

export interface DeckValidationResult {
  totalCount: number;
  legal: boolean;
  /** Hard rule violations; non-empty means the deck can't be used. */
  issues: string[];
  /** Soft problems worth surfacing (e.g. set rotation approaching). */
  warnings: string[];
}
