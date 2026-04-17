// Deck model for the local (M1) deck editor.
// Stored in localStorage keyed by `ptcg-tw-sim:decks`; later persisted to
// Firestore per-user when Auth lands.

export interface DeckEntry {
  /** Card.id — the zh-TW site's numeric id (as string). */
  cardId: string;
  /** Copies of this card in the deck (1..4, unlimited for Basic Energy). */
  count: number;
}

export interface Deck {
  id: string;
  name: string;
  entries: DeckEntry[];
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface DeckValidationResult {
  totalCount: number;
  legal: boolean;
  /** Hard rule violations; non-empty means the deck can't be used. */
  issues: string[];
  /** Soft problems worth surfacing (e.g. set rotation approaching). */
  warnings: string[];
}
