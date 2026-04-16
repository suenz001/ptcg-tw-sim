// Client-facing mirror of scripts/scrape/card-schema.d.ts.
// Kept separately so the scraper and the app can evolve independently if needed,
// but they should stay structurally compatible — if you change one, change both.

export type EnergyType =
  | 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic'
  | 'Fighting' | 'Darkness' | 'Metal' | 'Fairy' | 'Dragon'
  | 'Colorless';

export type Supertype = 'Pokemon' | 'Trainer' | 'Energy';

export interface Attack {
  name: string;
  cost: EnergyType[];
  damage: string;
  effect: string;
}

export interface Ability {
  name: string;
  effect: string;
  label: string;
}

export interface Card {
  id: string;
  name: string;
  supertype: Supertype;
  subtype: string;
  setCode: string;
  collectorNumber: string;
  regulationMark?: string;
  hp?: number;
  pokemonType?: EnergyType;
  evolvesFrom?: string;
  pokedexNumber?: number;
  species?: string;
  weakness?: { type: EnergyType; value: string };
  resistance?: { type: EnergyType; value: string };
  retreatCost?: EnergyType[];
  abilities?: Ability[];
  attacks?: Attack[];
  rulesText?: string;
  illustrator?: string;
  imageUrl: string;
  sourceUrl: string;
  scrapedAt: string;
}

/** Entry in static/cards/index.json — summary of a single expansion set. */
export interface SetSummary {
  code: string;
  name: string;
  cardCount: number;
  supertypeCounts: Partial<Record<Supertype, number>>;
  coverImageUrl: string;
  scrapedAt: string | null;
}
