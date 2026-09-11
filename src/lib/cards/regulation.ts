/**
 * Regulation mark mapping for each set code.
 * Verified by visually inspecting the bottom-left corner of actual card images
 * from asia.pokemon-card.com/tw/.
 *
 * ⭐⭐⭐ v6.340 起，「哪些標可以打」與「哪些卡包暫不開放」**不再是寫死的常數**，
 * 而是一份可以由後台調整的《卡牌政策》（見下方 `CardPolicy`）。
 * 程式內建的預設值 `DEFAULT_CARD_POLICY` 仍然是唯一的 fallback：
 * 讀不到後台設定時一律退回它，**絕不會退回「全部放行」**。
 */

/**
 * 卡面左下角的賽制標記。
 * ⚠ v6.340 從 `'F'|'G'|'H'|'I'|'J'` 擴充到 A~K：
 *   M6a「30th CELEBRATION」收了 A/C/D/E/F/G 標的舊收藏卡（例：A 標 索爾迦雷歐GX），
 *   而下一個賽季會啟用 K 標。型別太窄會逼消費端到處 `as`，反而繞過檢查。
 */
export type RegulationMark = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';

/** 依時序排列的全部標記（後台的勾選清單、篩選鈕順序都以它為準）。 */
export const ALL_REGULATION_MARKS: readonly RegulationMark[] =
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

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

// ══════════════════════════════════════════════════════════════════════════════
// ⭐⭐⭐ 卡牌政策（v6.340）—— 全站唯一的「哪些卡能打」來源
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 站長可以在後台調整的兩件事。
 *
 * - `allowedMarks`：目前賽季可用的標。今天是 H/I/J；明年賽季改成 I/J/K 時，
 *   站長只要把 H 的勾取消即可，不必等我出版本。
 * - `lockedSets`：已經進卡庫、但**暫時不開放組牌／對戰**的卡包。
 *   M6a「30th CELEBRATION」在卡效果實裝完成、站長決定開放之前都留在這裡。
 */
export interface CardPolicy {
  allowedMarks: readonly string[];
  lockedSets: readonly string[];
}

/**
 * ⭐ 程式內建的預設政策 —— **唯一的 fallback**。
 *
 * ⚠⚠ 後台設定讀不到（離線／Firestore 掛／權限被改／欄位格式壞掉）時一律用它，
 *   **絕對不可以退回「全部放行」**：這是合法性判定，fail-open 等於讓退標卡打標準賽。
 *
 * ⚠ 這份 `lockedSets` 必須與 `scripts/lib/deck-locked-sets.mjs` 的 `DECK_LOCKED_SETS`
 *   永遠相同（一個給 runtime、一個給守衛；跨 .ts/.mjs 沒辦法共用同一個 export，
 *   同 version.ts 與 admin.html SITE_VERSION_HINT 的處理方式）。
 *   `scripts/test-v6333-m6a-unmarked.mjs` 與 `scripts/test-v6340-card-policy.mjs`
 *   各有一條逐項比對，漂移就會紅。
 */
export const DEFAULT_CARD_POLICY: CardPolicy = Object.freeze({
  allowedMarks: Object.freeze(['H', 'I', 'J']) as readonly string[],
  lockedSets: Object.freeze(['M6a']) as readonly string[],
});

let _allowedMarks: ReadonlySet<string> = new Set(DEFAULT_CARD_POLICY.allowedMarks);
let _lockedSets: ReadonlySet<string> = new Set(DEFAULT_CARD_POLICY.lockedSets);

/** 目前生效的政策（複本，外部改不到內部狀態）。 */
export function getCardPolicy(): CardPolicy {
  return { allowedMarks: [..._allowedMarks], lockedSets: [..._lockedSets] };
}

/**
 * 標記字串的正規化：去空白＋轉大寫；**不在 `ALL_REGULATION_MARKS` 裡一律回 null**。
 * ⚠ 原本只檢查「單一 A~Z 字母」，於是 Firestore 若被寫進 'L'，L 標卡會變成合法、
 *   卻沒有任何一顆篩選鈕列得出它（`regMarkFilterKeys()` 只列 A~K）——
 *   那些卡只有【不限】看得到。收斂成同一份清單就不會有這種半套狀態。
 */
function normalizeMark(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return (ALL_REGULATION_MARKS as readonly string[]).includes(s) ? s : null;
}

/** 卡包代號的正規化：去空白；空字串或非字串一律回 null。 */
function normalizeSetCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/**
 * ⭐⭐⭐ 套用後台政策。**整包驗證、整包套用**：任何一項不合格就整包忽略、回 `false`，
 * 目前生效的政策維持不變（fail-closed）。
 *
 * ⚠⚠ `allowedMarks` 空陣列視為**不合格**：全部關掉會讓站上每一張卡都變成不合法，
 *   那不是任何人想要的設定，而且一旦寫進 Firestore 就會讓所有人打不了牌。
 *   要「關掉某個標」請留下其餘的標。
 * ⚠ `lockedSets` 允許空陣列 —— 那正是「把 M6a 開放」的操作。
 */
export function setCardPolicy(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const raw = input as { allowedMarks?: unknown; lockedSets?: unknown };
  if (!Array.isArray(raw.allowedMarks) || !Array.isArray(raw.lockedSets)) return false;

  const marks: string[] = [];
  for (const m of raw.allowedMarks) {
    const n = normalizeMark(m);
    if (n == null) return false;         // 有一個壞的就整包退回
    marks.push(n);
  }
  if (marks.length === 0) return false;  // ⚠ 不接受「全部關掉」

  const sets: string[] = [];
  for (const s of raw.lockedSets) {
    const n = normalizeSetCode(s);
    if (n == null) return false;
    sets.push(n);
  }

  _allowedMarks = new Set(marks);
  _lockedSets = new Set(sets);
  return true;
}

/** 回到程式內建的預設政策（測試與「後台清空」用）。 */
export function resetCardPolicy(): void {
  _allowedMarks = new Set(DEFAULT_CARD_POLICY.allowedMarks);
  _lockedSets = new Set(DEFAULT_CARD_POLICY.lockedSets);
}

// ══════════════════════════════════════════════════════════════════════════════
// 判準（全站唯一）
// ══════════════════════════════════════════════════════════════════════════════

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
 *
 * ⭐ v6.340：判準改讀《卡牌政策》，語意不變（預設仍是 H/I/J）。
 */
export function isCardMarkStandardLegal(mark: string | null | undefined): boolean {
  if (!mark) return false;   // 無標（純收藏卡）＝ 不能對戰
  return _allowedMarks.has(mark);
}

/**
 * 這張卡是不是來自「暫不開放組牌」的卡包？
 * ⚠ `setCode` 缺席時**不可以**變成字串 "null"／"undefined" 去比對 ——
 *   站長若在後台的文字框誤打 `undefined`，會把所有沒有 setCode 的卡整批鎖掉。
 */
export function isDeckLockedCard(card: { setCode?: string | null } | null | undefined): boolean {
  const code = card?.setCode;
  return typeof code === 'string' && code.length > 0 && _lockedSets.has(code);
}

/** 從候選清單濾掉「暫不開放組牌」的卡。⚠ 只用於**可挑選**的清單，不可用在 poolById。 */
export function filterDeckSelectable<T extends { setCode?: string | null }>(cards: readonly T[]): T[] {
  if (_lockedSets.size === 0) return [...cards];
  return cards.filter((c) => !isDeckLockedCard(c));
}

/** Check if a set code is legal in the current Standard format. */
export function isStandardLegal(setCode: string): boolean {
  const mark = SET_REGULATION_MARK[setCode];
  return mark != null && _allowedMarks.has(mark);
}

/** All set codes that are legal in Standard.（⭐ v6.340 改成函式：政策會變。） */
export function standardSets(): string[] {
  return Object.entries(SET_REGULATION_MARK)
    .filter(([, mark]) => _allowedMarks.has(mark))
    .map(([code]) => code);
}

// ══════════════════════════════════════════════════════════════════════════════
// 賽季篩選鈕（`/cards` 與 `/decks` 共用同一份分組判準）
// ══════════════════════════════════════════════════════════════════════════════

/** 【無標】＝ 卡面完全沒有標記的純收藏卡。 */
export const NO_REG_MARK_KEY = 'none';
/** 【已退標】＝ 有標、但那個標不在目前的容許清單裡。 */
export const ROTATED_REG_MARK_KEY = 'rotated';

/**
 * ⭐ v6.333 賽季篩選鈕的分組 key（`/cards` 與 `/decks` 共用）。
 *
 * 沒有 regulationMark 的卡回 `'none'`（＝【無標】鈕），**不是** null／空字串 ——
 * 舊的篩選寫法是 `if (!c.regulationMark || !marks.has(...)) return false;`，
 * 無標卡在任何一顆鈕底下都會被濾掉，新加的【無標】鈕會永遠空的。
 *
 * ⭐⭐ v6.340 站長交辦：拿掉【G 標】鈕，改成一顆【已退標】。
 *   判準**不是**寫死 A~G，而是「有標、但不在目前容許清單裡」——
 *   今天容許 H/I/J，結果剛好等於 A~G；明年站長在後台關掉 H 之後，
 *   H 標卡會**自動**落進【已退標】，不必再改一次程式。
 *
 * ⚠ 站長 2026-09-09 裁定：【無標】只收**真的完全沒有標的**卡；
 *   M6a 帶舊標 A/C/D/E/F 的收藏卡有標，因此落在【已退標】而不是【無標】。
 */
export function cardRegMarkFilterKey(mark: string | null | undefined): string {
  if (!mark) return NO_REG_MARK_KEY;
  return isCardMarkStandardLegal(mark) ? String(mark) : ROTATED_REG_MARK_KEY;
}

/** 篩選鈕的順序：無標 → 已退標 → 目前容許的標（依 A~K 時序）。 */
export function regMarkFilterKeys(): string[] {
  const allowed = ALL_REGULATION_MARKS.filter((m) => _allowedMarks.has(m)) as string[];
  return [NO_REG_MARK_KEY, ROTATED_REG_MARK_KEY, ...allowed];
}

/** 篩選鈕的文字。 */
export function regMarkFilterLabel(key: string): string {
  if (key === NO_REG_MARK_KEY) return '無標';
  if (key === ROTATED_REG_MARK_KEY) return '已退標';
  return `${key} 標`;
}
