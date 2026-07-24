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
import { isBasicPokemonCard, isRulePokemon, getBasicEnergyType } from './engine';

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
};

/**
 * 單卡求值。回傳 null = 此 (zone, filter) 批1 未收錄 → caller 走原 inline fallback。
 * 遷移完成後 unknown 一律回 true（保留現行 fallthrough 語義）+ lint 守新增。
 */
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
    return null;   // 批1 未收錄（TOP/name-prefix/Evolution/params 類）→ caller fallback
  }
  return null;     // hand-discard / discard-search 批4 才收
}

/** 此 (zone, filter) 是否已被中央求值器收錄（供 caller 判斷是否走 evaluator）。 */
export function isKnownSelectionFilter(zone: SelectionFilterZone, filter: string): boolean {
  if (zone === 'deck-search') return filter in DECK_SEARCH_PREDICATES;
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
