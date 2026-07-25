/**
 * v6.012（Fable P1-1 批1 Foundation）：中央 selection filter 求值器。
 *
 * 目的：pending 的 filter DSL（'ex'/'BasicEnergy:DistinctTypes'/'Supporter:TOP6'…）的「候選卡過濾」
 *   邏輯原本 inline 各實作在 +page.svelte(UI) 與 ai.ts(AI) 兩份 → 會漂移（v5.874/v6.008 兩度出事）。
 *   本模組收斂成單一求值器，供三端共用：UI 產候選、AI 產候選、engine sanitize 閘做語義驗證。
 *
 * ⚠批1 只收錄 deck-search 的「純單卡 predicate 子集」（不依賴 pending.params / validIids 的）。
 *   TOP 類（依 params iid 集合）、name-prefix、Evolution/Pokemon(validIids 交集)、hand-discard/discard-search
 *   各 zone 留待批2–4。未收錄者 evaluateSelectionFilter 回 null → caller 走原 inline fallback（三態安全遷移）。
 * ⚠批1 為零 consumer（純新增+單元測試），ai/UI/engine 接線在後續批次。
 * ⚠語義以 +page.svelte(UI) 為 canonical（多輪玩家回報都修在 UI 端），逐字對齊 HEAD。
 * ⚠依賴方向：批1 selection-filter → engine（此時 engine 尚未 import 本檔，無循環）。批5 engine 閘要呼叫
 *   evaluator 時會形成循環，屆時把 isBasicPokemonCard/isRulePokemon/isBasicEnergyOfType/getBasicEnergyType
 *   下沉搬進本檔、engine 改 re-export（Check O 純度）。批1 先不動 engine。
 */
import type { Card } from './types';
import type { EnergyType } from '$lib/cards/types';
import { RULE_BOX_SUBTYPES } from './types';

// ─── 卡片述詞 helper（v6.018 批5：從 engine.ts 下沉；engine 改 re-export，解 engine↔selection-filter 循環）───
/** 台灣卡牌中文屬性名稱 → EnergyType（pokemonType 欄位遺漏時備用）。export 供 engine 內部 isEnergyOfType 等使用。 */
export const ZH_ENERGY_TYPE: Record<string, EnergyType> = {
  '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '格': 'Fighting', '鬥': 'Fighting',
  '惡': 'Darkness', '鋼': 'Metal',
  '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless',
};
export function isBasicPokemonCard(card: Card | undefined): card is Card {
  if (!card || card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false; // 道具卡
  if (card.subtype === 'Stage1' || card.subtype === 'Stage2') return false; // v2.62 加固
  return !card.evolvesFrom;
}
export function isRulePokemon(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.supertype !== 'Pokemon') return false;
  const tags = card.tags ?? [];
  if (tags.includes('規則盒')) return true;
  for (const t of tags) { if (RULE_BOX_SUBTYPES.has(t)) return true; }
  if (card.subtype && RULE_BOX_SUBTYPES.has(card.subtype)) return true;
  if (card.rulesText?.includes('擁有規則')) return true;
  if (card.name.endsWith('ex') || card.name.endsWith('EX')) return true;
  return false;
}
export function isBasicEnergyOfType(ec: Card | undefined, type: EnergyType): boolean {
  if (!ec || ec.supertype !== 'Energy' || ec.subtype !== 'Basic') return false;
  if (ec.pokemonType === type) return true;
  const m = ec.name.match(/【(.+?)】/);
  if (!m) return false;
  return ZH_ENERGY_TYPE[m[1]] === type;
}
export function getBasicEnergyType(ec: Card | undefined): EnergyType | null {
  if (!ec || ec.supertype !== 'Energy' || ec.subtype !== 'Basic') return null;
  if (ec.pokemonType) return ec.pokemonType as EnergyType;
  const m = ec.name.match(/【(.+?)】/);
  if (!m) return null;
  return (ZH_ENERGY_TYPE[m[1]] as EnergyType) ?? null;
}

export type SelectionFilterZone = 'deck-search' | 'hand-discard' | 'discard-search';

export interface SelectionFilterCtx {
  /** pending.params 原封傳入（TOP 類 iid 集合等；批1 未用）。 */
  params?: Record<string, unknown>;
  /** 僅 UI DistinctTypes 互動用：已勾選卡推出的能量屬性集合，evaluator 排除這些屬性。AI/engine 不傳。 */
  excludeEnergyTypes?: ReadonlySet<string>;
}

/** 批1 收錄的 deck-search 純 predicate（key = filter 字串）。逐字對齊 +page.svelte HEAD selectionItems。 */
const DECK_SEARCH_PREDICATES: Record<string, (card: Card, ctx: SelectionFilterCtx) => boolean> = {
  // 基礎/階段/寶可夢型（v2.132：階段用 stage ?? subtype，避免 ex 進化被 subtype='ex' 排除）
  'Basic':        (c) => isBasicPokemonCard(c),
  'Basic:HP70':   (c) => isBasicPokemonCard(c) && (c.hp ?? 0) <= 70,
  'BasicNonRule': (c) => isBasicPokemonCard(c) && !isRulePokemon(c),
  'PokemonNonRule': (c) => c.supertype === 'Pokemon' && !isRulePokemon(c),
  'Stage1':       (c) => c.supertype === 'Pokemon' && (c.stage ?? c.subtype) === 'Stage1',
  'Stage2':       (c) => c.supertype === 'Pokemon' && (c.stage ?? c.subtype) === 'Stage2',
  'PsychicBasic': (c) => c.supertype === 'Pokemon' && !c.evolvesFrom && c.pokemonType === 'Psychic',
  'Resistance:Fighting': (c) => c.supertype === 'Pokemon' && c.resistance?.type === 'Fighting',
  'ex':           (c) => c.supertype === 'Pokemon' && c.subtype === 'ex',
  'MegaEx':       (c) => c.supertype === 'Pokemon' && c.subtype === 'ex' && c.name.startsWith('超級'),
  'TeraPokemon':  (c) => c.supertype === 'Pokemon' && !!c.tags?.includes('太晶'),
  'ColorlessPokeHP100': (c) => c.supertype === 'Pokemon' && c.pokemonType === 'Colorless' && (c.hp ?? 999) <= 100,
  // 能量
  'Energy':       (c) => c.supertype === 'Energy',
  'BasicEnergy':  (c) => c.supertype === 'Energy' && c.subtype === 'Basic',
  // v6.008：基本能量 pokemonType 恒 null → 屬性一律走 getBasicEnergyType（卡名【X】推），禁直讀 pokemonType。
  //   set-level 屬性互異：UI 傳 excludeEnergyTypes（已勾選屬性）排除；AI/engine 端不傳 → 只判「是基本能量」，
  //   由 caller 端 post-dedup / sanitizeSelectionSet 做互異（與現行 ai.ts 行為一致）。
  'BasicEnergy:DistinctTypes': (c, ctx) => {
    if (!(c.supertype === 'Energy' && c.subtype === 'Basic')) return false;
    const t = getBasicEnergyType(c);
    if (!t) return false;
    return !(ctx.excludeEnergyTypes && ctx.excludeEnergyTypes.has(t));
  },
  // 訓練家
  'Item':         (c) => c.supertype === 'Trainer' && c.subtype === 'Item',
  'Supporter':    (c) => c.supertype === 'Trainer' && c.subtype === 'Supporter',
  'Tool':         (c) => c.supertype === 'Trainer' && c.subtype === 'PokemonTool',
  'PokemonTool':  (c) => c.supertype === 'Trainer' && c.subtype === 'PokemonTool',
  'Stadium':      (c) => c.supertype === 'Trainer' && c.subtype === 'Stadium',
  'Trainer':      (c) => c.supertype === 'Trainer',
  'AnyTrainer':   (c) => c.supertype === 'Trainer',
  // 具名寶可夢（卡名前綴/包含）
  'CynthiaPokemon': (c) => c.supertype === 'Pokemon' && c.name.includes('竹蘭的'),
  'MarniePokemon':  (c) => c.supertype === 'Pokemon' && c.name.startsWith('瑪俐的'),
  'ErikaPokemon':   (c) => c.supertype === 'Pokemon' && c.name.startsWith('莉佳的'),
  'RocketSupporter': (c) => c.supertype === 'Trainer' && c.subtype === 'Supporter' && c.name.includes('火箭隊'),
  'RocketBasic':    (c) => c.supertype === 'Pokemon' && !c.evolvesFrom && c.name.includes('火箭隊的'),
  // 組合(寶可夢或基本能量)。⚠草:Bug#20 移除 !evolvesFrom(任意階段草寶可夢);鬥:基礎鬥寶可夢(有 !evolvesFrom)。
  //   基本能量屬性走名稱【X】(基本能量 pokemonType 恒 null,v6.008)。ai.ts 兩處殘留 !evolvesFrom(草)+死碼→本收斂修正。
  'GrassBasicOrGrassEnergy': (c) => {
    if (c.supertype === 'Pokemon' && c.pokemonType === 'Grass') return true;
    if (c.supertype === 'Energy' && c.subtype === 'Basic') return c.pokemonType === 'Grass' || c.name.includes('【草】');
    return false;
  },
  'FightingBasicOrFightingEnergy': (c) => {
    if (c.supertype === 'Pokemon' && !c.evolvesFrom && c.pokemonType === 'Fighting') return true;
    if (c.supertype === 'Energy' && c.subtype === 'Basic') return c.pokemonType === 'Fighting' || c.name.includes('【鬥】') || c.name.includes('【格】');
    return false;
  },
};

/**
 * 批4 收錄的 hand-discard 純 predicate（逐字對齊 +page.svelte / ai.ts 的 hand-discard case canonical）。
 * ⚠不收錄 'Pokemon'（多張卡無 validIids、UI 現行 fallthrough 顯示全部手牌＝既有 UI-也-錯 bug，屬獨立卡效果 audit，非本次「UI/AI 兩份漂移」收斂範疇）。
 * 'Item' 收錄當防禦（現役唯一使用者枇琶恒帶 validIids 全遮蔽→零行為變更）。
 * BasicEnergy:<T> / Energy:<T> 走 prefix 規則（isBasicEnergyOfType）。
 */
const HAND_DISCARD_PREDICATES: Record<string, (card: Card, ctx: SelectionFilterCtx) => boolean> = {
  'Energy':              (c) => c.supertype === 'Energy',
  'BasicEnergy':         (c) => c.supertype === 'Energy' && c.subtype === 'Basic',
  'BasicPsychicEnergy':  (c) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【超】'),
  'BasicFightingEnergy': (c) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【鬥】'),
  'Item':                (c) => c.supertype === 'Trainer' && c.subtype === 'Item',
};

/**
 * 批4 收錄的 discard-search 純 predicate（逐字對齊 +page.svelte discard-search case canonical）。
 * ⚠'Basic' 收斂 isBasicPokemonCard（F6：現役 DB 無 supertype=Pokemon+subtype=Other → 與 UI 手刻
 *   「!evolvesFrom && !Stage1/2」外延等價，零行為變更；等價掃描測試背書）。
 * BasicEnergy:<T>（原 UI 內嵌 zhMap）/ Energy:<T> / Pokemon:Types= / Pokemon:<T> 走 prefix 規則。
 */
const DISCARD_SEARCH_PREDICATES: Record<string, (card: Card, ctx: SelectionFilterCtx) => boolean> = {
  'PokemonOrEnergy':      (c) => c.supertype === 'Pokemon' || c.supertype === 'Energy',
  'PokemonOrBasicEnergy': (c) => c.supertype === 'Pokemon' || (c.supertype === 'Energy' && c.subtype === 'Basic'),
  'PokemonNonExOrBasicEnergy': (c) => (c.supertype === 'Pokemon' && c.subtype !== 'ex') || (c.supertype === 'Energy' && c.subtype === 'Basic'),
  'WaterPokemonOrBasicWaterEnergy': (c) => {
    if (c.supertype === 'Pokemon' && c.pokemonType === 'Water') return true;
    if (c.supertype === 'Energy' && c.subtype === 'Basic' && (c.pokemonType === 'Water' || c.name.includes('【水】'))) return true;
    return false;
  },
  'FightingPokemonOrBasicFightingEnergy': (c) => {
    if (c.supertype === 'Pokemon' && c.pokemonType === 'Fighting') return true;
    if (c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【鬥】')) return true;
    return false;
  },
  'BasicEnergy':          (c) => c.supertype === 'Energy' && c.subtype === 'Basic',
  'BasicPsychicEnergy':   (c) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【超】'),
  'BasicFightingEnergy':  (c) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【鬥】'),
  'Energy':               (c) => c.supertype === 'Energy',
  'Pokemon':              (c) => c.supertype === 'Pokemon',
  'Basic':                (c) => isBasicPokemonCard(c),
  'Trainer':              (c) => c.supertype === 'Trainer',
  'Supporter':            (c) => c.supertype === 'Trainer' && c.subtype === 'Supporter',
  'Item':                 (c) => c.supertype === 'Trainer' && c.subtype === 'Item',
  'ColorlessPokeHP100':   (c) => c.supertype === 'Pokemon' && c.pokemonType === 'Colorless' && (c.hp ?? 999) <= 100,
  'Any':                  () => true,
};

/**
 * 單卡求值。回傳 null = 此 (zone, filter) 批1 未收錄 → caller 走原 inline fallback。
 * 遷移完成後 unknown 一律回 true（保留現行 fallthrough 語義）+ lint 守新增。
 */
/** deck-search 已收錄的「前綴型」filter（evaluateSelectionFilter 與 isKnownSelectionFilter 共用單一來源）。 */
const DECK_SEARCH_NAME_PREFIXES = ['Name:', 'Pokemon:NamePrefix=', 'Pokemon:NameContains=',
  'Pokemon:Name=', 'Pokemon:Names=', 'NameContains:', 'Card:', 'Basic:NamePrefix='] as const;

export function evaluateSelectionFilter(
  zone: SelectionFilterZone,
  filter: string,
  _inst: { iid: string },
  card: Card | undefined,
  ctx: SelectionFilterCtx = {},
): boolean | null {
  if (!card) return null;
  if (zone === 'deck-search') {
    const pred = DECK_SEARCH_PREDICATES[filter];
    if (pred) return pred(card, ctx);
    // v6.013 批2：卡名前綴規則(固定順序 specific 在 generic 前;根治 ai.ts 死碼——generic 'Pokemon:' 若排前
    //   會把 'Pokemon:NamePrefix=' 當屬性比對恒 false)。
    if (filter.startsWith('Name:')) return card.name === filter.slice(5);
    if (filter.startsWith('Pokemon:NamePrefix=')) return card.supertype === 'Pokemon' && card.name.startsWith(filter.slice(19));
    if (filter.startsWith('Pokemon:NameContains=')) return card.supertype === 'Pokemon' && card.name.includes(filter.slice(21));
    // v6.027：把剩下四種「值是卡名字串」的 filter 一併收進中央（逐字對齊 UI inline，零行為變更）。
    //   收進來的目的不只是收斂，更是讓 test-filter-yields-candidates（產能守衛）看得到它們——
    //   這類 filter 一旦「卡名」與「卡型條件」對不上（例：NameContains: 只列物品卡，卻拿去搜寶可夢），
    //   picker 會是空的、玩家體感「效果沒發動」，而引擎測試永遠是綠的。歷史上已重複發生兩次：
    //   v3.58「Pokemon:脫殼忍者」被 generic Pokemon:<屬性> 吃掉、v5.155～v6.025「NameContains:瓦斯彈」。
    if (filter.startsWith('Pokemon:Name=')) return card.supertype === 'Pokemon' && card.name === filter.slice('Pokemon:Name='.length);
    if (filter.startsWith('Pokemon:Names=')) {
      const ns = new Set(filter.slice('Pokemon:Names='.length).split(',').filter(Boolean));
      return card.supertype === 'Pokemon' && ns.has(card.name);
    }
    // NameContains:X ＝【化石採掘場】專用語義：牌庫中名稱含 X 的**物品卡**（v5.155 建立）。
    if (filter.startsWith('NameContains:')) {
      return card.supertype === 'Trainer' && card.subtype === 'Item' && card.name.includes(filter.slice('NameContains:'.length));
    }
    if (filter.startsWith('Card:')) return card.name === filter.slice(5);
    if (filter.startsWith('Basic:NamePrefix=')) return isBasicPokemonCard(card) && card.name.startsWith(filter.slice('Basic:NamePrefix='.length));
    return null;   // 其餘(TOP/Evolution/params/generic Pokemon:/BasicEnergy: 等)批次遷移 → caller fallback
  }
  if (zone === 'hand-discard') {
    const pred = HAND_DISCARD_PREDICATES[filter];
    if (pred) return pred(card, ctx);
    // BasicEnergy:<T> / Energy:<T>（基本能量+指定屬性；走 isBasicEnergyOfType，pokemonType 恒 null 時用卡名【X】）
    if (filter.startsWith('BasicEnergy:')) return isBasicEnergyOfType(card, filter.slice('BasicEnergy:'.length) as EnergyType);
    if (filter.startsWith('Energy:'))      return isBasicEnergyOfType(card, filter.slice('Energy:'.length) as EnergyType);
    return null;   // 'Pokemon' 等未收錄 → caller fallback（維持現行 fallthrough）
  }
  if (zone === 'discard-search') {
    const pred = DISCARD_SEARCH_PREDICATES[filter];
    if (pred) return pred(card, ctx);
    // prefix 規則：specific 在 generic 前（Pokemon:Types= 必須先於 Pokemon:）
    if (filter.startsWith('Pokemon:Types=')) {
      const ts = new Set(filter.slice('Pokemon:Types='.length).split(',').filter(Boolean));
      return card.supertype === 'Pokemon' && card.pokemonType != null && ts.has(card.pokemonType);
    }
    if (filter.startsWith('BasicEnergy:')) return isBasicEnergyOfType(card, filter.slice('BasicEnergy:'.length) as EnergyType);
    if (filter.startsWith('Energy:'))      return isBasicEnergyOfType(card, filter.slice('Energy:'.length) as EnergyType);
    if (filter.startsWith('Pokemon:'))     return card.supertype === 'Pokemon' && card.pokemonType === (filter.slice('Pokemon:'.length) as EnergyType);
    return null;
  }
  return null;
}

/** 此 (zone, filter) 是否已被中央求值器收錄（供 caller 判斷是否走 evaluator）。 */
export function isKnownSelectionFilter(zone: SelectionFilterZone, filter: string): boolean {
  // v6.027：deck-search 原本只判 exact，evaluator 支援的 prefix 規則全被漏掉 → engine Stage2 的
  //   語義再驗證涵蓋不到這些 filter（公平性防呆有洞）。此處與 evaluateSelectionFilter 對齊。
  if (zone === 'deck-search') return (filter in DECK_SEARCH_PREDICATES)
    || DECK_SEARCH_NAME_PREFIXES.some((p) => filter.startsWith(p));
  if (zone === 'hand-discard') return (filter in HAND_DISCARD_PREDICATES)
    || filter.startsWith('BasicEnergy:') || filter.startsWith('Energy:');
  if (zone === 'discard-search') return (filter in DISCARD_SEARCH_PREDICATES)
    || filter.startsWith('Pokemon:Types=') || filter.startsWith('BasicEnergy:') || filter.startsWith('Energy:') || filter.startsWith('Pokemon:');
  return false;
}

/**
 * set-level 約束（目前僅 BasicEnergy:DistinctTypes：選中集合屬性互異）。
 * 語義=sanitize（首見屬性保留、重複屬性濾掉），非 reject（v6.006：reject 殘留 pending 會線上軟鎖）。
 * 批1 為空殼：未收錄的 set 約束原樣回傳全 iid。
 */
export function sanitizeSelectionSet(
  zone: SelectionFilterZone,
  filter: string,
  insts: ReadonlyArray<{ iid: string; cardId: string }>,
  pool: Map<string, Card>,
): string[] {
  if (zone === 'deck-search' && filter === 'BasicEnergy:DistinctTypes') {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of insts) {
      const t = getBasicEnergyType(pool.get(it.cardId));
      if (!t || seen.has(t)) continue;
      seen.add(t); out.push(it.iid);
    }
    return out;
  }
  return insts.map(i => i.iid);
}
