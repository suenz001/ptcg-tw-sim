/**
 * Regulation mark mapping for each set code.
 * Verified by visually inspecting the bottom-left corner of actual card images
 * from asia.pokemon-card.com/tw/.
 *
 * Standard format (as of 2026-02-06): H, I, J are legal; G is rotated out.
 */

export type RegulationMark = 'G' | 'H' | 'I' | 'J';

/** Map every known set code to its regulation mark. */
export const SET_REGULATION_MARK: Record<string, RegulationMark> = {
  // ── G mark (rotated out) ──────────────────────────────────────────
  SV1S: 'G', SV1V: 'G', SV1a: 'G',
  SV2P: 'G', SV2D: 'G', SV2a: 'G',
  SV3: 'G',  SV3a: 'G',
  SV4K: 'G', SV4M: 'G', SV4a: 'G',

  // ── H mark ────────────────────────────────────────────────────────
  SV5K: 'H', SV5M: 'H', SV5a: 'H',
  SV6: 'H',  SV6a: 'H',
  SV7: 'H',  SV7a: 'H',
  SV8: 'H',  SV8a: 'H',
  MJ: 'H',

  // ── I mark ────────────────────────────────────────────────────────
  SV9: 'I',  SV9a: 'I',
  SV10: 'I',
  SV11B: 'I', SV11W: 'I',
  M1S: 'I',  M1L: 'I',
  M2: 'I',   M2a: 'I',
  MBD: 'I',  MBG: 'I',

  // ── J mark ────────────────────────────────────────────────────────
  MC: 'J',
  M3: 'J',
  M4: 'J',
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
