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
  /**
   * 寶可夢的特徵標籤。
   * - '太晶' (v2.48)：太晶寶可夢在備戰區不會受到【招式】的【傷害】；招式內的
   *   「指示物放置」效果（例：多龍巴魯托ex｜幻影奇襲 的 6 個 counter）不受太晶保護。
   *   來源：scraper 從 .skillInformation .skill 區塊的 tag 白名單抓進來。
   * - '古代' (v2.67)：古代寶可夢用於 故勒頓｜原生亂打、覺醒戰鼓 等倍率招式。
   *   來源：pokemon-card.com 單張卡片頁面的 HTML 不含「古代」字樣，必須透過
   *   list search 的 pokemonTag[]=105 篩選結果回填；scrape-set.js 在爬完後
   *   自動呼叫 collectAncientPokemonIds() 對本批次 ID 做白名單比對。
   */
  tags?: string[];
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
  regulationMark?: string;
  cardCount: number;
  supertypeCounts: Partial<Record<Supertype, number>>;
  coverImageUrl: string;
  scrapedAt: string | null;
  /**
   * 卡包台灣版發售日 (YYYY-MM-DD)，可選。
   * 來源：asia.pokemon-card.com/tw/card-search 的「發售日」欄。
   * 用途：/cards index 頁內每個 H/I/J 區塊依此降序排序（新→舊）。
   * 沒填的 set 會排在該區塊最末端（fallback 用 code 字典序）。
   */
  releaseDate?: string;
}
