/**
 * v4.947 Phase 1 — AI Pokemon Role 分類基礎設施
 *
 * 把寶可夢按「在這個牌組裡扮演什麼角色」分類，讓 AI 做能量分配 / 進化順序 /
 * 換場決策 / 特性使用評估時可以查 role 而非 hard-code 每張卡。
 *
 * **設計哲學（hybrid）**：
 *   1. Preset / 玩家自訂 deck 可在 DeckEntry.role 手工標註（精確）
 *   2. 沒標註 → 走 classifyRole() heuristic 自動推斷（fallback）
 *   3. 取用方一律呼叫 getCardRole(cardId, deck, pool) — 內部處理優先級
 *
 * **Phase 1 範圍**：純新增基礎設施。**ai.ts 暫不引用此模組**，
 *   先讓 type / API 穩定下來，Phase 2 才把現有 hard-code 分批遷移過來。
 *
 * **Phase 2 預定接入點**（依優先序）：
 *   1. ai.ts 能量分配 — 取代「附 active」邏輯，改「附主打手」
 *   2. ai.ts 進化順序 — 改主打手優先（vs 現「第一個 evolvable」）
 *   3. ai.ts SEND_NEW_ACTIVE — pickBestActive 改 role-aware（不送 utility 上戰鬥場送死）
 *
 * 每個接入點上線前都要用 AI 內戰模擬（task #183）驗證勝率不退化。
 */

import type { Card } from '$lib/cards/types';
import type { Deck } from '$lib/decks/types';
import { isRulePokemon } from './engine';

// ─────────────────────────────────────────────────────────────────────────────
// Role enum
// ─────────────────────────────────────────────────────────────────────────────

export type PokemonRole =
  /**
   * 主打手：牌組的主要輸出寶可夢，能量該優先給它。
   * 典型：HP≥210 + rule-box（ex / Mega / V / VSTAR）+ 最強招式 dmg≥150
   * 例：多龍巴魯托ex（幻影奇襲 200+6）/ 超級妙蛙花ex（叢林拋擲 200）/ 厄鬼椪（激流水泵 120+120）
   */
  | 'main-attacker'

  /**
   * 副打手：主打手缺席時頂上的次要輸出，或對特定屬性的 counter。
   * 典型：HP 90-200 + 最強招式 dmg 60-149
   * 例：閃焰王牌（瞬間爆發力）/ 各種 Stage1 中堅輸出
   */
  | 'sub-attacker'

  /**
   * 功能角色：特性提供加成 / 搜牌 / 移能量 / 抽牌，攻擊不是主任務。
   * 典型：最強招式 dmg<60 + 有 utility 特性（搜牌 / 改附能量 / 抽牌 / 放上場 等）
   * 例：N的索羅亞克ex（交易：弃 1 抽 2）/ 樹才怪（搜支援者）/ 厄鬼椪「召喚戰術」階段
   * 注意：超級妙蛙花ex 雖有「日光轉移」utility 特性，但其招式 dmg=200 仍屬 main-attacker。
   */
  | 'utility'

  /**
   * 工具人：1-2 張、特定 counter 用（如克勞修ex 對 ex 弱抗）。
   * Phase 1 暫不實作（需 deck-context 分析張數 + meta 知識）。
   */
  | 'tech'

  /**
   * 自訂 deck 沒標 + heuristic 不確定 — AI 退回 linear 決策（現有行為）。
   */
  | 'unknown';

// ─────────────────────────────────────────────────────────────────────────────
// classifyRole() — 自動 heuristic 推斷
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utility 特性的關鍵字 — ability text 含這些字 → 候選功能角色。
 * 來源：歸納既有 PTCG 卡面常見的 utility 文字 pattern。
 */
const UTILITY_ABILITY_KEYWORDS = [
  '搜尋牌庫',      // 從自己的牌庫搜尋
  '搜出',          // 搜出 N 張
  '搜到',          // 搜到加手牌
  '改附於',        // 移動能量（妙蛙花ex 日光轉移 / 瑪力露麗ex 收集泡泡）
  '改放於',        // 移動指示物
  '放置於備戰',    // 把卡放上備戰
  '放置於手牌',    // 放回手牌
  '加入手牌',      // 搜入手牌
  '抽出',          // 抽 N 張
  '回到手牌',      // 回手
  '從棄牌',        // 棄牌復活 / 棄牌搜出
  '查看',          // 查看牌庫頂
  '翻為正面',      // 翻牌類
];

/** 取得寶可夢卡的最強招式 damage（parse 純數字部分）。 */
function maxAttackDamage(card: Card): number {
  if (!card.attacks || card.attacks.length === 0) return 0;
  let max = 0;
  for (const a of card.attacks) {
    const d = parseInt(a.damage ?? '0') || 0;
    if (d > max) max = d;
  }
  return max;
}

/** 判斷寶可夢有沒有「utility 風格」特性。 */
function hasUtilityAbility(card: Card): boolean {
  if (!card.abilities || card.abilities.length === 0) return false;
  for (const ab of card.abilities) {
    const txt = (ab as { text?: string }).text ?? '';
    if (!txt) continue;
    if (UTILITY_ABILITY_KEYWORDS.some(kw => txt.includes(kw))) return true;
  }
  return false;
}

/**
 * Heuristic 角色分類 — 純靠卡面屬性推斷，不看 deck context。
 *
 * **判定順序**（由強到弱優先級）：
 *   1. main-attacker：rule-box + HP≥210 + maxDmg≥150  /  或 HP≥150 + maxDmg≥150（非 ex 也算）
 *   2. sub-attacker： HP≥80 + maxDmg 60-149
 *   3. utility：     maxDmg<60 + 有 utility ability
 *   4. unknown：     上述都不命中
 *
 * **設計考量**：
 *   - 即使有 utility 特性，只要招式 dmg≥150 仍歸 main-attacker（超級妙蛙花ex 案例）
 *   - dmg='' 或無法 parse 的（如 N 的索羅亞克ex 暗黑底牌）視為 0 → 可能被誤判，
 *     由 Phase 2 後續手工標 role 修正
 *   - HP 門檻 210 是粗略基準，未來可由 AI 內戰模擬調整
 */
export function classifyRole(card: Card | undefined | null): PokemonRole {
  if (!card || card.supertype !== 'Pokemon') return 'unknown';

  const hp = card.hp ?? 0;
  const maxDmg = maxAttackDamage(card);
  const isRuleBox = isRulePokemon(card);

  // 1. main-attacker: 兩條入口
  //    (a) rule-box + HP≥210 + maxDmg≥150 — 標準 meta 主打手
  //    (b) HP≥150 + maxDmg≥150 — 非 ex 高血量強輸出（如閃焰王牌 Mega）
  if (isRuleBox && hp >= 210 && maxDmg >= 150) return 'main-attacker';
  if (hp >= 150 && maxDmg >= 150) return 'main-attacker';

  // 2. sub-attacker: 中等 HP + 中等 dmg
  if (hp >= 80 && maxDmg >= 60 && maxDmg < 150) return 'sub-attacker';

  // 3. utility: 攻擊弱 + 有 utility 特性
  if (maxDmg < 60 && hasUtilityAbility(card)) return 'utility';

  // 4. fallback
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// getCardRole() — hybrid：先查 deck 手工標，再 fallback heuristic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 取得寶可夢卡在指定 deck 內的 role。
 *
 * **優先級**：
 *   1. deck.entries[].role 手工標註（preset 或玩家自訂）→ 直接用
 *   2. 沒標 → 呼叫 classifyRole() 做 heuristic 推斷
 *
 * **用法**（Phase 2 之後）：
 *   const role = getCardRole(inst.cardId, currentDeck, pool);
 *   if (role === 'main-attacker') { ... 優先附能量 ... }
 *
 * @param cardId  Card.id (零之大空洞、N的索羅亞克ex 等 metadata 看 pool.get(cardId))
 * @param deck    當前牌組（含 entries 內的 role 標註）— null 代表沒 deck 上下文（純 heuristic）
 * @param pool    卡片池（用來 fetch Card object 給 classifyRole）
 */
export function getCardRole(
  cardId: string,
  deck: Deck | null | undefined,
  pool: Map<string, Card>,
): PokemonRole {
  // 1. 手工標註優先
  if (deck) {
    const entry = deck.entries.find(e => e.cardId === cardId);
    if (entry?.role) return entry.role;
  }
  // 2. fallback heuristic
  const card = pool.get(cardId);
  return classifyRole(card);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for AI（Phase 2 將大量使用）
// ─────────────────────────────────────────────────────────────────────────────

/** 從 inst 集合中找出 role = main-attacker 的（按出現順序）。 */
export function findMainAttackers<T extends { cardId: string }>(
  insts: T[],
  deck: Deck | null | undefined,
  pool: Map<string, Card>,
): T[] {
  return insts.filter(i => getCardRole(i.cardId, deck, pool) === 'main-attacker');
}

/** 從 inst 集合中找出 role = sub-attacker 的。 */
export function findSubAttackers<T extends { cardId: string }>(
  insts: T[],
  deck: Deck | null | undefined,
  pool: Map<string, Card>,
): T[] {
  return insts.filter(i => getCardRole(i.cardId, deck, pool) === 'sub-attacker');
}

/** 從 inst 集合中找出 role = utility 的。 */
export function findUtilities<T extends { cardId: string }>(
  insts: T[],
  deck: Deck | null | undefined,
  pool: Map<string, Card>,
): T[] {
  return insts.filter(i => getCardRole(i.cardId, deck, pool) === 'utility');
}
