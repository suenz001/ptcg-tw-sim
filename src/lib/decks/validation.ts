// PTCG Standard deck validation.
// Rules implemented:
//   - Exactly 60 cards total.
//   - At most 4 cards with the same name, except Basic Energy which is unlimited.
//   - At least 1 Basic Pokémon (otherwise you can't legally start the game).
//   - Every card must be Standard-legal (regulationMark in H/I/J)，但有例外：
//     a) 基本能量：所有屬性的基本能量在標準賽不受任何構築限制（即使 G 標）。
//     b) Reprint exception 名單（v3.61）：以下 8 張卡因為在 H/I/J 標有重印過、
//        舊版本（含 G 標）依然合法可用。判斷依「卡名」，因為重印版與舊版同名。
//          - 寶可夢交替 / 寶可裝置3.0 / 寶可夢捕捉器 / 高級球
//          - 粉碎之錘 / 能量轉移 / 老大的指令 / 裁判
//   - 一副牌最多只能放 1 張 ACE SPEC 卡（不管 Trainer 還是 Energy，全部共用 1 張
//     的名額；例如：不公印章 + 富裕能量 算 2 張 ACE SPEC → 違規）。
//
// We key the "same name" check off Card.name. That matches real tournament
// rules — copies across different sets still count together, and reprints
// with identical zh-TW names are one entry. ex / 非 ex / 超級進化 ex 因為
// JSON 的 name 不同（如「甲賀忍蛙」/「甲賀忍蛙ex」/「超級甲賀忍蛙ex」），
// 各自獨立計算 4 張上限。

import type { Card } from '$lib/cards/types';
import type { Deck, DeckValidationResult } from './types';

const STANDARD_MARKS = new Set(['H', 'I', 'J']);

/**
 * v3.61：「Reprint exception」— 重印於 H/I/J 標、舊版本（含 G 標）也合法的卡名清單。
 * 加入新例外時：去 https://www.ptcg.com.tw 確認該卡確實有 H/I/J 標的版本。
 */
const STANDARD_REPRINT_LEGAL_NAMES = new Set<string>([
  '寶可夢交替',     // Switch — G 標 SV5a/SV9a/SVK 等仍合法（H/I/J 有重印）
  '寶可裝置3.0',    // Pokégear 3.0
  '寶可夢捕捉器',   // Pokémon Catcher
  '高級球',         // Ultra Ball
  '粉碎之錘',       // Crushing Hammer
  '能量轉移',       // Energy Switch
  '老大的指令',     // Boss's Orders
  '裁判',           // Judge
  '神奇糖果',       // v3.62 Rare Candy — I 標 M1S 082/063 + MC 655/742 重印，舊版含 G 標仍合法
  '能量回收',       // v3.63 Energy Recycler — I 標 M4 104/083 + MC 636/742 + SV11W 079/086 重印
]);

export function isStandardReprintLegal(card: Card): boolean {
  return STANDARD_REPRINT_LEGAL_NAMES.has(card.name);
}

export function isBasicEnergy(card: Card): boolean {
  return card.supertype === 'Energy' && card.subtype === 'Basic';
}

/**
 * ACE SPEC 是 PTCG 特殊規則卡（不公印章、頂尖捕捉器、富裕能量、古舊能量 等）。
 * 一副牌無論 trainer/energy 只能放 1 張。tag 由 scraper 透過官網 list filter
 * （trainersTag=104 / energiesTag=104）統一補上；參見 tag-filters.js。
 */
export function isAceSpec(card: Card): boolean {
  return !!card.tags?.includes('ACE SPEC');
}

export function isBasicPokemon(card: Card): boolean {
  // 「基礎寶可夢」= 沒有 evolvesFrom 的寶可夢卡。
  // ex 基礎（subtype === 'ex'）同樣算基礎，不能用 subtype === 'Basic' 判斷。
  // 道具卡（subtype === 'Other'）是 Pokemon supertype 但非寶可夢，排除。
  if (card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false;
  return !card.evolvesFrom;
}

/**
 * v3.61 計算牌組內「指定卡名」的同名總張數（含跨版本累計）。
 * 不含基本能量（基本能量無上限、不同屬性的基本能量名稱本來就不同）。
 *
 * 用途：檢查同名卡片是否超過 4 張上限（呱呱泡蛙 SV5a + 呱呱泡蛙 M4 → 累計擋）。
 */
export function sameNameTotal(
  deck: Deck,
  name: string,
  cardsById: Map<string, Card>,
): number {
  let n = 0;
  for (const e of deck.entries) {
    const c = cardsById.get(e.cardId);
    if (c && !isBasicEnergy(c) && c.name === name) n += e.count;
  }
  return n;
}

/**
 * v3.61：計算這張卡「目前還能再加幾張」。UI 用此值決定 + 按鈕是否禁用，
 * 並在玩家碰到上限時給明確提示（同名 4 張上限 / ACE SPEC 1 張上限）。
 *
 * 規則：
 *   - 基本能量：無上限（Infinity）
 *   - ACE SPEC：deck-wide 1 張上限（不論卡名都互相算）
 *   - 一般卡片：4 張同名上限（跨版本累計）
 */
export function remainingCapacity(
  deck: Deck,
  card: Card,
  cardsById: Map<string, Card>,
): number {
  if (isBasicEnergy(card)) return Infinity;
  if (isAceSpec(card)) {
    return Math.max(0, 1 - aceSpecCount(deck, cardsById));
  }
  return Math.max(0, 4 - sameNameTotal(deck, card.name, cardsById));
}

export function validateDeck(
  deck: Deck,
  cardsById: Map<string, Card>
): DeckValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  let total = 0;
  let basicPokemonCount = 0;
  const byName = new Map<string, number>();
  const missingIds: string[] = [];

  for (const entry of deck.entries) {
    const card = cardsById.get(entry.cardId);
    if (!card) {
      missingIds.push(entry.cardId);
      continue;
    }
    total += entry.count;

    if (!isBasicEnergy(card)) {
      byName.set(card.name, (byName.get(card.name) ?? 0) + entry.count);
    }
    if (isBasicPokemon(card)) basicPokemonCount += entry.count;

    if (card.regulationMark && !STANDARD_MARKS.has(card.regulationMark)) {
      // v3.61：兩類例外免被擋
      //   1) 基本能量在標準賽不受任何構築限制（含 G 標）
      //   2) Reprint exception 名單：H/I/J 有重印的舊卡，舊版本仍合法
      if (!isBasicEnergy(card) && !isStandardReprintLegal(card)) {
        issues.push(`${card.name} 為 ${card.regulationMark} 標，已退出標準賽`);
      }
    }
  }

  if (missingIds.length) {
    issues.push(`牌組中有 ${missingIds.length} 張卡片查無資料（卡池可能已更新）`);
  }

  if (total !== 60) {
    issues.push(`牌組需要恰好 60 張（目前 ${total} 張）`);
  }

  for (const [name, n] of byName) {
    if (n > 4) issues.push(`${name} 不得超過 4 張（目前 ${n}，跨版本/招式/語言累計）`);
  }

  if (basicPokemonCount === 0) {
    issues.push('牌組至少需要 1 隻基礎寶可夢');
  }

  // ACE SPEC：一副牌全部共用 1 張的名額（Trainer + Energy 合計 ≤ 1）。
  const aceSpecNames: string[] = [];
  let aceSpecTotal = 0;
  for (const entry of deck.entries) {
    const card = cardsById.get(entry.cardId);
    if (!card || !isAceSpec(card)) continue;
    aceSpecTotal += entry.count;
    aceSpecNames.push(`${card.name}×${entry.count}`);
  }
  if (aceSpecTotal > 1) {
    issues.push(`ACE SPEC 卡一副牌最多 1 張（目前 ${aceSpecTotal} 張：${aceSpecNames.join('、')}）`);
  }

  return {
    totalCount: total,
    legal: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * 計算目前牌組內已放入的 ACE SPEC 總張數（跨卡名累計）。
 * UI 用這個值決定「+」按鈕是否要禁用。
 */
export function aceSpecCount(
  deck: Deck,
  cardsById: Map<string, Card>
): number {
  let n = 0;
  for (const entry of deck.entries) {
    const card = cardsById.get(entry.cardId);
    if (card && isAceSpec(card)) n += entry.count;
  }
  return n;
}

/**
 * Returns the maximum allowed copies of a given card.
 * Used by the UI to block "+" presses beyond the legal limit.
 * - 基本能量：無上限
 * - ACE SPEC：同名 1 張（另外整副牌只能放 1 張 ACE SPEC — 由 deck-wide
 *   guard 處理，不在這裡）
 * - 其他：4
 *
 * v3.61：仍保留為「per-card.id 的卡面層上限」（給 modal 顯示用）。
 *   實際的「同名跨版本累計上限」改用 remainingCapacity()。
 */
export function maxCopies(card: Card): number {
  if (isBasicEnergy(card)) return Infinity;
  if (isAceSpec(card)) return 1;
  return 4;
}
