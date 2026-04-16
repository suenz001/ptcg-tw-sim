/**
 * Regulation mark mapping — plain JS version for Node.js scripts.
 * Mirror of src/lib/cards/regulation.ts — keep both in sync.
 */

/** @type {Record<string, string>} */
export const SET_REGULATION_MARK = {
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

export const STANDARD_MARKS = new Set(['H', 'I', 'J']);

export function isStandardLegal(setCode) {
  const mark = SET_REGULATION_MARK[setCode];
  return mark != null && STANDARD_MARKS.has(mark);
}

export const STANDARD_SETS = Object.entries(SET_REGULATION_MARK)
  .filter(([, mark]) => STANDARD_MARKS.has(mark))
  .map(([code]) => code);
