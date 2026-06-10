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
  /**
   * v5.533：台灣官網「牌組編輯器／匯出為官網代碼」專用的卡片 id。
   * 絕大多數卡的 id 本身就是台灣官網 cardId，無需此欄位。
   * 但少數特典卡（M-P-J 的「古歷」「超級妖火紅狐ex」）的資料是從香港官網抓的，
   * 其 id 為港版 id，台灣官網 deck-builder 不認得 → 匯出會失敗。
   * 對這類卡額外登錄台灣官網對應 id，匯出時優先採用；不影響遊戲內 id（避免破壞已存牌組）。
   */
  twDeckBuildId?: string;
  hp?: number;
  pokemonType?: EnergyType;
  evolvesFrom?: string;
  /**
   * 寶可夢的進化階段，獨立於 subtype。
   * - 'Basic' / 'Stage1' / 'Stage2'
   * - 來源：官網 H1 文字（基礎 / 1階進化 / 2階進化）。
   * - 為何需要：scraper 的 refinePokemonSubtype() 會把 ex 卡的 subtype 覆寫為 'ex'，
   *   丟失原始的階段資訊。stage 保留原始值，讓 /cards 篩選與引擎判定都能正確區分
   *   「基礎 ex」與「進化 ex」。
   * - v2.75 新增。對 subtype=Basic/Stage1/Stage2 的卡，stage 與 subtype 同值（冗餘但方便）。
   *   對 subtype=ex 的卡，stage 保留原始的 Basic/Stage1/Stage2。
   *   寶可夢道具（subtype=Other）不設 stage。
   */
  stage?: 'Basic' | 'Stage1' | 'Stage2';
  pokedexNumber?: number;
  species?: string;
  weakness?: { type: EnergyType; value: string };
  resistance?: { type: EnergyType; value: string };
  retreatCost?: EnergyType[];
  abilities?: Ability[];
  attacks?: Attack[];
  /**
   * 卡牌的特徵標籤。同一張卡可能有多個 tag。Pokemon / Trainer / Energy 三種
   * supertype 都能帶 tag。來源分兩層：
   *
   *  (a) 從單張卡片頁面 HTML 可直接偵測的（parse-card.js 處理）：
   *    - '太晶' (v2.48)：太晶寶可夢在備戰區不會受到【招式】的【傷害】；招式內的
   *      「指示物放置」效果（例：多龍巴魯托ex｜幻影奇襲 的 6 個 counter）不受太晶保護。
   *      來源：.skillInformation .skill 區塊的 tag 白名單。
   *    - '訓練家冠名' (v2.71 改名自 v2.68 的 '訓練家的寶可夢'，並擴展到 Trainer)：
   *      卡名開頭是「XX的」格式（v2.71 前寶可夢會有 <XX的> 包裝，v2.71 起 JSON 統一
   *      strip 掉 <>）。範圍含兩類：
   *        - 冠名寶可夢（例：阿響的凱羅斯、火箭隊的超夢ex、竹蘭的烈咬陸鯊ex、
   *          莉莉艾的皮皮ex、青木的土龍節節ex）；
   *        - 冠名訓練家卡（例：赫普的包包、N的ＰＰ提升劑、老大的指令、暗碼迷的解讀）。
   *      用於特定支援者/場地的 grouping 檢查（例：火箭隊當家、阿響 等 effect 會查
   *      場上的「XX的」寶可夢），以及 /cards 檢索系統的「訓練家冠名」篩選。
   *
   *  (b) 需要透過 list filter 回填的（tag-filters.js + scrape-set.js post-hook）：
   *    - '古代' (v2.67 Pokemon / v2.68 Trainer+Energy)：原生亂打、覺醒戰鼓、地盤崩壞
   *      等倍率招式要查場上「古代」寶可夢數量；部分 Supporter/Item（探險家的嚮導、
   *      大地之容器、奧琳博士的氣魄…）帶古代 tag，與古代寶可夢效果連動。
   *    - '未來' (v2.68)：鐵系寶可夢（鐵頭殼、鐵手腕等）用於鐵頭殼ex｜未來決戰 等倍率
   *      招式；部分未來 Supporter/Item（重新啟動箱、暗碼迷的解讀 等）帶未來 tag。
   *    - 'ACE SPEC' (v2.68)：ACE SPEC 訓練家（不公印章、頂尖捕捉器…）與特殊能量
   *      （富裕能量、古舊能量、新衝天能量）— PTCG 規則：一副牌最多 1 張 ACE SPEC。
   *      註：目前尚未在牌組編輯器實裝「最多 1 張」的限制 guard — 未盡事項。
   *
   *    來源：pokemon-card.com 單張卡片頁面的 HTML 不含這些字樣（只體現在版型/配色），
   *    必須透過 list search 的 pokemonTag / trainersTag / energiesTag filter 取得
   *    ID 白名單；scrape-set.js 在爬完後自動呼叫 tag-filters.js 的
   *    collectAllTaggedIds() 對本批次 ID 做白名單比對。
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
