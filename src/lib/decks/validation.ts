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
//
// v6.192：分組 key 不再是 Card.name 的逐字字串，而是 `sameNameKey(card.name)`
//   —— 唯一的差別是「結尾的括號冠名」（藝術版本）會併回本名，見下方 sameNameKey。

import type { Card } from '$lib/cards/types';
import type { Deck, DeckValidationResult } from './types';

const STANDARD_MARKS = new Set(['H', 'I', 'J']);

/**
 * v6.192「括號冠名 ＝ 同一張卡的藝術版本」——**站長 2026-08-15 裁定**：
 *   「老大的指令 和『老大的指令（烏羽）』算同名卡」
 *
 * 台灣官方在 M-P 215/M-P 發了「老大的指令（烏羽）」（I 標，id 19630）：
 * `rulesText` 與「老大的指令」**逐字相同**，括號內是卡圖上的角色。
 * ⇒ 牌組「同名卡最多 4 張」必須**共用同一份額度**（合計 4 張，不是各 4 張）。
 *
 * ⚠⚠ 這與「**前綴**冠名」是完全不同的兩件事，**絕不可混為一談**：
 *   官方裁定（`PTCG RULES/PTCG_RULES.md` L2686）明文
 *   ——「達摩狒狒」和「N的達摩狒狒」**視為兩種不同名稱的寶可夢**。
 *   `N的◯◯` / `赫普的◯◯` / `竹蘭的◯◯` 這種前綴**是卡名本身的一部分**，
 *   各自獨立算 4 張。本函式**只**動「結尾的括號段」，前綴冠名沒有括號 ⇒ 原樣回傳。
 *   （同理 ex / 非 ex / 超級進化 ex 因為卡名不同，仍各自獨立計算。）
 *
 * 為什麼敢一般化（而不是為「老大的指令」寫死一個特例）：
 *   1. 站內 v5.381 起，官網代碼匯入的 `stripArtSuffix()` 就已經用**同一條規則**
 *      把「老大的指令（赤日）」對應回「老大的指令」——本版把那份收斂進來，
 *      不再有第二份「去括號」邏輯（兩份必然漂移）。
 *   2. 全站卡庫 1506 個卡名裡，帶括號的**只有這一個**（見下方守衛），沒有反例。
 * ⚠ 但「沒有反例」不等於「永遠不會有」⇒ 例外表 + 枚舉守衛（見 EXCEPTIONS 註解）。
 */
const ART_SUFFIX_RE = /[（(][^（()）]*[）)]\s*$/;

/**
 * 「括號內不是插畫角色、而是真的另一張卡」的完整卡名 —— 放進來就原樣回傳、不併額度。
 *
 * ⚠ 今天是空的（卡庫裡找不到任何一張這種卡）。
 *   `scripts/test-v6192-same-name-art-variant.mjs` 會**枚舉卡庫裡每一個帶括號的卡名**，
 *   逐一比對一份「已人工判讀過」的清單 ——
 *   官方哪天發了新的括號卡名，那支守衛會直接紅燈，逼下一個人做決定，
 *   **不會**讓一般化規則靜默套用到一張其實不該併額度的卡上。
 */
export const SAME_NAME_PAREN_EXCEPTIONS: ReadonlySet<string> = new Set<string>([]);

/**
 * 牌組「同名卡最多 4 張」的**唯一**分組 key（v6.192 中央收斂）。
 * 牌組驗證 / UI 的 + 按鈕上限 / 官網代碼匯入的同名對應，全部走這一支。
 */
export function sameNameKey(name: string | undefined | null): string {
  const s = (name ?? '').trim();
  if (!s) return '';
  if (SAME_NAME_PAREN_EXCEPTIONS.has(s)) return s;
  const stripped = s.replace(ART_SUFFIX_RE, '').trim();
  // ⚠ 整個卡名就是一個括號段時不可回空字串（會讓所有這種卡併成同一組）。
  return stripped || s;
}

/**
 * v6.082「兩張合一」競技場（M6 傳說的海溝／山頂／熔岩洞）。
 *
 * 官方這三張場地卡是**兩張實體卡拼成一個場地**（卡面編號寫成兩個號碼），
 * Wilson 裁定（2026-08-01）：
 *   1. 牌組中兩張實體卡**各算 1 張**（一套佔 2 張）
 *   2. 同名 4 張上限 ⇒ 最多 4 張 ＝ **2 套**
 *   3. 編輯器 ＋／－ 一次 **±2**，牌組驗證要求張數為**偶數**
 *
 * ⚠ 這份名單必須與 `src/lib/game/effects/_shared.ts` 的 `LEGEND_STADIUM_NAMES` 一致
 *   —— 兩處分開是為了不讓牌組驗證層 import 整個對戰引擎（bundle 體積）。
 *   `scripts/test-two-card-stadium.mjs` 有守衛比對兩份清單，新增卡時兩邊都要改。
 */
export const TWO_CARD_STADIUM_NAMES = new Set<string>([
  '傳說的海溝',
  '傳說的山頂',
  '傳說的熔岩洞',
]);

/** 這張卡是不是「兩張實體卡合成一個場地」型（左右各一張、要成套） */
export function isTwoCardStadium(card: Card | undefined): boolean {
  return !!card && TWO_CARD_STADIUM_NAMES.has(card.name);
}

/**
 * v6.093「傳說」競技場：**左右各是一張獨立的卡片**（Wilson 2026-08-01 裁定）
 *   「傳說的山頂(左) 當作編號073那張、傳說的山頂(右) 當作編號074那張，
 *     等於完全就當成是2張牌來處理」
 *
 * 官方 collectorNumber（`static/cards/M6.json`，唯一權威）本來就標成兩個編號：
 *   傳說的海溝 071/076 + 072/076 ／ 傳說的山頂 073/076 + 074/076 ／ 傳說的熔岩洞 075/076 + 076/076
 *
 * ⭐ **卡名刻意維持相同**（兩筆都叫「傳說的山頂」）——
 *   這讓三個場地效果 hook、reg key、官方「同名卡最多 4 張」規則全部自動保持正確，
 *   左右改由 **cardId** 區分。左半沿用原本的 id，右半是新增的 id
 *   （舊牌組存的正是左半 id → 遷移時只要把一半換成右半即可）。
 */
export const TWO_CARD_STADIUM_PAIR_IDS: Readonly<Record<string, string>> = {
  '19621': '19624', '19624': '19621',   // 傳說的海溝   071/076 ↔ 072/076
  '19622': '19625', '19625': '19622',   // 傳說的山頂   073/076 ↔ 074/076
  '19623': '19626', '19626': '19623',   // 傳說的熔岩洞 075/076 ↔ 076/076
};
/** 左半的 cardId（＝編號較小的那張、也是舊牌組存的那個 id） */
export const TWO_CARD_STADIUM_LEFT_IDS: ReadonlySet<string> = new Set(['19621', '19622', '19623']);

/** 這張卡的另一半是哪個 cardId；不是兩張合一競技場則回 null */
export function twoCardStadiumPartnerCardId(cardId: string | undefined | null): string | null {
  if (!cardId) return null;
  return TWO_CARD_STADIUM_PAIR_IDS[cardId] ?? null;
}
/** 這張卡是左半(0)還是右半(1)；不是兩張合一競技場則回 null */
export function twoCardStadiumSide(cardId: string | undefined | null): 0 | 1 | null {
  if (!cardId || !(cardId in TWO_CARD_STADIUM_PAIR_IDS)) return null;
  return TWO_CARD_STADIUM_LEFT_IDS.has(cardId) ? 0 : 1;
}


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
  // v5.427：官方「過往系列中可使用之卡牌清單」補完（皆經 static/cards JSON 核實有 H/I/J 重印）
  '傷藥',           // Potion — MC:J / SVM:J 重印（舊版 MJ:G 仍合法）
  '精靈球',         // Poké Ball — MC:J / SVM:J
  '能量輸送',       // Energy Transfer — MC:J / SVM:J
  '反擊增幅器',     // Counter Catcher — M2a:H / MC:H / SV7a:H
  '能量回收器',     // Energy Retrieval — M2a:I / M3:I / MC:I（含「能量再利用」視為同一張，卡池無此別名）
  '慶祝開場樂',     // Festival Lead — SV-P-H:H
  '西餐廚師',       // Chef — MC:H / MJ:H / SVM:H
  '氣球',           // Air Balloon — M1L:I / MC:I / SV11B:I
  '除蟲噴霧',       // Bug Catching Set/Spray — M1L:I / MC:I
  '改造之錘',       // Enhanced Hammer — M2a:H / SV5a:H / SV6:H / SV8a:H
  '寶可夢中心的姐姐', // Nurse — SV-P-I:I
  '道具拆除器',     // Tool Scrapper — M2a:I / SV11W:I
]);

export function isStandardReprintLegal(card: Card): boolean {
  // v6.192：藝術版本冠名（「老大的指令（烏羽）」）與本名是同一張卡 ⇒ 重印例外一併適用。
  //   這條**只會放寬、不會收緊**（原本合法的卡名一個都不會變成不合法）。
  return STANDARD_REPRINT_LEGAL_NAMES.has(card.name)
      || STANDARD_REPRINT_LEGAL_NAMES.has(sameNameKey(card.name));
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
  // v6.192：兩端都過 sameNameKey ⇒ 「老大的指令」與「老大的指令（烏羽）」共用同一份額度。
  //   參數仍收原始卡名（呼叫端不必改），正規化在這裡做，避免呼叫端各自去括號。
  const key = sameNameKey(name);
  let n = 0;
  for (const e of deck.entries) {
    const c = cardsById.get(e.cardId);
    if (c && !isBasicEnergy(c) && sameNameKey(c.name) === key) n += e.count;
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

    // v6.093「兩張合一」競技場：左右是兩張獨立的卡 → 兩邊張數必須相等（否則有半張湊不成套）。
    //   （v6.082 原本是「同一個 cardId 的張數必須偶數」，拆成兩張卡後改成左右對稱檢查。）
    if (isTwoCardStadium(card)) {
      const partnerId = twoCardStadiumPartnerCardId(entry.cardId);
      if (partnerId) {
        // v6.094：用加總而非 find 單筆 —— 同一個 cardId 若出現多筆 entry（自製 JSON 匯入）會誤判。
        const partnerCount = deck.entries.filter(e => e.cardId === partnerId).reduce((n, e) => n + e.count, 0);
        if (partnerCount !== entry.count) {
          const side = twoCardStadiumSide(entry.cardId) === 0 ? '左' : '右';
          issues.push(`「${card.name}」的左右兩張要成套：目前${side}半 ${entry.count} 張、另一半 ${partnerCount} 張，張數必須相同`);
        }
      }
    }

    if (!isBasicEnergy(card)) {
      // v6.192：分組 key ＝ sameNameKey（括號冠名的藝術版本併回本名，共用 4 張額度）。
      const nameKey = sameNameKey(card.name);
      byName.set(nameKey, (byName.get(nameKey) ?? 0) + entry.count);
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
    // v6.192：`name` 已經是 sameNameKey（本名）⇒ 文案要講明「藝術版本」也一起算，
    //   否則玩家看到「老大的指令 不得超過 4 張（目前 8）」但編輯器裡本名只數得到 4 張。
    if (n > 4) issues.push(`${name} 不得超過 4 張（目前 ${n}，跨版本/招式/語言/藝術版本累計）`);
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
