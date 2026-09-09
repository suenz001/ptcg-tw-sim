/**
 * Regulation mark mapping for each set code.
 * Verified by visually inspecting the bottom-left corner of actual card images
 * from asia.pokemon-card.com/tw/.
 *
 * Standard format (as of 2026-02-06): H, I, J are legal; G is rotated out.
 */

export type RegulationMark = 'F' | 'G' | 'H' | 'I' | 'J';

/** Map every known set code to its regulation mark. */
export const SET_REGULATION_MARK: Record<string, RegulationMark> = {
  // ── G mark (rotated out) ──────────────────────────────────────────
  SV1S: 'G', SV1V: 'G', SV1a: 'G',
  SV2P: 'G', SV2D: 'G', SV2a: 'G',
  SV3: 'G',  SV3a: 'G',
  SV4K: 'G', SV4M: 'G', SV4a: 'G',
  // v2.115: SVC/SVD/SVP1 完全無現行賽制可用卡，已刪除整個 set（Leon 指示）

  // ── H mark ────────────────────────────────────────────────────────
  SV5K: 'H', SV5M: 'H', SV5a: 'H',
  SV6: 'H',  SV6a: 'H',
  SV7: 'H',  SV7a: 'H',
  SV8: 'H',
  // v2.115: SVM 發售於 2024/11/29（H 標啟用 2024/2/2 之後），歸 H 標；
  // 會按 releaseDate 自然排在 SV8（2024/10/25）之後、SV8a（2024/12/20）之前。
  SVM: 'H',
  SV8a: 'H',
  SVK: 'H',  // 牌組構築BOX 樂園騰龍（2024-09-27，含 G/H/I 混合卡；per-card 以 .alpha 為準）
  SVPN: 'H', // Promo H 標（8 張，可能是特典 / 紀念）
  SVPS: 'H', // Promo H 標（8 張）
  svhk: 'H', // 朱紫擴充包 H 標 kai 系列（24 張）
  svhm: 'H', // 朱紫擴充包 H 標 mega 系列（24 張，含 F/H 混合）

  // ── I mark ────────────────────────────────────────────────────────
  SV9: 'I',  SV9a: 'I',
  SV10: 'I',
  SV11B: 'I', SV11W: 'I',
  SVQL: 'I', SVQP: 'I',  // ex 初階牌組（噴火龍 / 皮卡丘，2025-07-18）
  M1S: 'I',  M1L: 'I',
  M2: 'I',   M2a: 'I',
  MBD: 'I',  MBG: 'I',
  // v2.116: SVOD/SVOM 發售於 2025/3/7（I 標啟用 2025/2/7 之後、J 標啟用 2026/1/16 之前），
  // 歸 I 標；會按 releaseDate 自然排在 SV9（2025/2/7）之後、SV9a（2025/3/28）之前。
  SVOM: 'I',  // 瑪俐的莫魯貝可&長毛巨魔ex 初階牌組
  SVOD: 'I',  // 大吾的鐵啞鈴&巨金怪ex 初階牌組

  // ── J mark ────────────────────────────────────────────────────────
  MC: 'J',
  M3: 'J',
  M4: 'J',
  M6: 'J',   // 綠寶石風暴（2026-08-07）
  // v2.115: MJ 發售於 2026/2/26（J 標啟用 2026/1/16 之後），歸 J 標；
  // 會按 releaseDate 自然排在 M3（2026/2/6）之後（Leon 指示）。
  // 卡包內 H/I/J/G 混收，個別卡 regulationMark 依卡面真實值保留。
  MJ: 'J',

  // ── M-P 特典卡（promo）────────────────────────────────────────────
  // v2.116: 把 M-P 拆成 H/I/J 三包，依卡面 mark 分別排在各賽制最後（無日期）。
  // 原因：M-P 是 ongoing promo（不固定發售日），混合 H/I/J 標卡；按卡面 mark
  // 拆開後，H/I/J 三區 tile 可以分別固定在各 mark 群組最末。
  'M-P-H': 'H',
  'M-P-I': 'I',
  'M-P-J': 'J',
};

/** Marks currently legal in Standard format. */
export const STANDARD_MARKS: ReadonlySet<RegulationMark> = new Set(['H', 'I', 'J']);

/**
 * ⭐⭐⭐ v6.333 **全站唯一**的「這張卡的標能不能打標準賽」述詞。
 *
 * ⚠⚠ 為什麼一定要有這一份、而且所有消費點都必須呼叫它：
 *   原本這個判準被抄成三份（`decks/validation.ts` 的 local `STANDARD_MARKS`、
 *   `server/cardIndex.ts` 的 `STD_MARKS`、本檔的 `STANDARD_MARKS`），
 *   其中 validation 那一份寫成 **`if (card.regulationMark && !STANDARD_MARKS.has(...))`**
 *   ——「標是空的」時整段條件直接跳過 ＝ **fail-open**，等於把無標卡判成合法。
 *   在 M6a「30th CELEBRATION」之前站上剛好一張無標卡都沒有，所以這個洞一直沒發作；
 *   M6a 進卡庫後有 21 張官網 `.alpha` 顯示 n/a 的純收藏卡（皮卡丘 136/103、洛奇亞、
 *   N、小霞、烈空坐EX、達克萊伊＆克雷色利亞LEGEND …），站長 2026-09-09 明確指示
 *   「這些卡不能對戰」。
 *
 * ⇒ **標缺席一律 fail-closed（回 false）**。要判「不合法」時請寫
 *   `!isCardMarkStandardLegal(mark)`，**絕對不要**再寫 `mark && !SET.has(mark)`。
 */
export function isCardMarkStandardLegal(mark: string | null | undefined): boolean {
  if (!mark) return false;   // 無標（純收藏卡）＝ 不能對戰
  return (STANDARD_MARKS as ReadonlySet<string>).has(mark);
}

/**
 * ⭐ v6.333 賽季篩選鈕的分組 key（`/cards` 用）。
 *
 * 沒有 regulationMark 的卡回 `'none'`（＝【無標】鈕），**不是** null／空字串 ——
 * 舊的篩選寫法是 `if (!c.regulationMark || !marks.has(...)) return false;`，
 * 無標卡在任何一顆鈕底下都會被濾掉，新加的【無標】鈕會永遠空的。
 *
 * ⚠ 站長 2026-09-09 裁定：【無標】**只收真的完全沒有標的**卡。
 *   M6a 帶舊標 A/C/D/E/F 的收藏卡回傳自己的標（'A'…），因此不會落進【無標】，
 *   也不會落進 G/H/I/J —— 它們只在【不限】看得到，這是站長選的行為。
 */
export const NO_REG_MARK_KEY = 'none';
export function cardRegMarkFilterKey(mark: string | null | undefined): string {
  return mark || NO_REG_MARK_KEY;
}

/**
 * ⭐⭐⭐ v6.333「已進卡庫、但**暫時不開放組牌**」的卡包（唯一來源）。
 *
 * **站長 2026-09-09 裁定（兩句）**：
 *   ①「M6a 可查卡，但暫不開放組牌」
 *   ②「m6a 全部的卡的功能都不要實裝」
 * ⇒ M6a「30th CELEBRATION」是**純資料**：玩家在卡牌資料庫查得到、【無標】篩選鈕也用得到，
 *   但牌組編輯器不給選、牌組合法性檢查會擋，卡效果一律不做。
 *
 * ⚠⚠ 為什麼一定要擋（這是公平性問題，不是功能缺口）：
 *   引擎結算招式是 `const preFn = ATTACK_PRE.get(key); if (preFn) {…}` —— **沒有 handler 就
 *   直接套卡面傷害、效果整段跳過、對戰紀錄一個字都不寫**（訓練家有
 *   `isTrainerPendingImplementation` 擋、特性沒實裝按鈕不會出現，唯獨招式沒有閘）。
 *   實測：M6a 之前「live H/I/J 有效果的招式 1691 招、未實裝 0」是站上**從沒破過的不變量**；
 *   M6a 一進來就變成 96 招未實裝，其中 15 招是**代價型**效果（自傷／下回合鎖招／丟光自己
 *   身上的能量），沒實裝等於**單方面對出招者有利** ——
 *   例：超夢ex｜超能之力 打 230 卻不鎖招、閃電鳥｜雷轟 打 210 卻不自傷、
 *       皮卡丘ex｜十萬伏特 打 200 卻不丟能量。卡片會比實體卡更強。
 *
 * ⚠ 這是「不能組牌」不是「從資料裡刪掉」：卡仍留在 pool / poolById / 對戰回放拿得到
 *   （同 $lib/cards/visibility 的下架卡分界）——只有**候選清單**與**牌組合法性**擋。
 *
 * ⚠⚠ 這份清單與 `scripts/lib/deck-locked-sets.mjs` 的 `DECK_LOCKED_SETS` 必須永遠相同
 *   （一個給 runtime、一個給守衛，跨 .ts/.mjs 沒辦法共用同一個 export ——
 *    同 version.ts 與 admin.html SITE_VERSION_HINT 的處理方式）。
 *   `scripts/test-v6333-m6a-unmarked.mjs` 有一條逐項比對，漂移就會紅。
 */
export const DECK_LOCKED_SETS: ReadonlySet<string> = new Set(['M6a']);

/** 這張卡是不是來自「暫不開放組牌」的卡包？ */
export function isDeckLockedCard(card: { setCode?: string | null } | null | undefined): boolean {
  return !!card && DECK_LOCKED_SETS.has(String(card.setCode));
}

/** 從候選清單濾掉「暫不開放組牌」的卡。⚠ 只用於**可挑選**的清單，不可用在 poolById。 */
export function filterDeckSelectable<T extends { setCode?: string | null }>(cards: readonly T[]): T[] {
  if (DECK_LOCKED_SETS.size === 0) return [...cards];
  return cards.filter((c) => !isDeckLockedCard(c));
}

/** Check if a set code is legal in the current Standard format. */
export function isStandardLegal(setCode: string): boolean {
  const mark = SET_REGULATION_MARK[setCode];
  return mark != null && STANDARD_MARKS.has(mark);
}

/** All set codes that are legal in Standard. */
export const STANDARD_SETS: string[] = Object.entries(SET_REGULATION_MARK)
  .filter(([, mark]) => STANDARD_MARKS.has(mark))
  .map(([code]) => code);
