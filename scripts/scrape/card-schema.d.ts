/**
 * Schema for a single PTCG card in our database.
 *
 * Design principles:
 * - All user-visible text is Traditional Chinese (zh-TW).
 * - `id` is stable across scrapes and matches asia.pokemon-card.com's internal
 *   numeric ID; we also expose set-code-based IDs for human readability.
 * - `effects` is intentionally absent here — it's filled in by the rule engine
 *   layer later, separate from scraping.
 * - Optional fields are only present when they apply to the supertype (e.g.
 *   HP/weakness only on Pokémon).
 */

export type EnergyType =
  | 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic'
  | 'Fighting' | 'Darkness' | 'Metal' | 'Fairy' | 'Dragon'
  | 'Colorless';

export type Supertype = 'Pokemon' | 'Trainer' | 'Energy';

export type PokemonSubtype = 'Basic' | 'Stage1' | 'Stage2' | 'VSTAR' | 'ex' | 'MegaEvolution' | 'Other';
export type TrainerSubtype = 'Item' | 'Supporter' | 'Stadium' | 'PokemonTool';
export type EnergySubtype = 'Basic' | 'Special';

export interface Attack {
  name: string;
  /** e.g. ['Water', 'Water', 'Colorless'] — preserves order as shown on card */
  cost: EnergyType[];
  /** Raw as shown on card: '40', '40+', '40×', or '' if none */
  damage: string;
  /** Effect text in zh-TW, empty string if no effect */
  effect: string;
}

export interface Ability {
  name: string;
  effect: string;
  /** "特性" for modern Ability, "古代特性"/"Poké-Power" etc. for older variants */
  label: string;
}

export interface Card {
  // === Identification ===
  /** asia.pokemon-card.com internal numeric ID, e.g. "12780" */
  id: string;
  name: string;
  supertype: Supertype;
  subtype: PokemonSubtype | TrainerSubtype | EnergySubtype;

  // === Set metadata ===
  setCode: string;            // "SV10" — empty if we couldn't determine
  collectorNumber: string;    // "001/098" as printed
  regulationMark?: string;    // "I" / "J" etc. — Pokémon only, standard rotation

  // === Pokémon-only ===
  hp?: number;
  pokemonType?: EnergyType;   // The elemental type printed at top-right
  evolvesFrom?: string;       // Pre-evolution name in zh-TW
  pokedexNumber?: number;
  species?: string;           // "蓑衣蟲寶可夢"
  weakness?: { type: EnergyType; value: string };    // e.g. {type:'Lightning', value:'×2'}
  resistance?: { type: EnergyType; value: string };
  retreatCost?: EnergyType[]; // Array of energies, length = retreat cost
  abilities?: Ability[];
  attacks?: Attack[];

  // === Trainer / special Energy ===
  /** Full rules text for Trainer/Energy cards (the effect box on the card) */
  rulesText?: string;

  // === Misc ===
  illustrator?: string;
  imageUrl: string;           // CDN URL to the card face PNG
  sourceUrl: string;          // Page we scraped from

  /** When this record was scraped (ISO 8601) */
  scrapedAt: string;
}
