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

/** Check if a set code is legal in the current Standard format. */
export function isStandardLegal(setCode: string): boolean {
  const mark = SET_REGULATION_MARK[setCode];
  return mark != null && STANDARD_MARKS.has(mark);
}

/** All set codes that are legal in Standard. */
export const STANDARD_SETS: string[] = Object.entries(SET_REGULATION_MARK)
  .filter(([, mark]) => STANDARD_MARKS.has(mark))
  .map(([code]) => code);
