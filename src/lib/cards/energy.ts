import type { EnergyType } from './types';

/** Traditional Chinese name for each energy type (as used on zh-TW cards) */
export const ENERGY_LABEL: Record<EnergyType, string> = {
  Grass: '草',
  Fire: '火',
  Water: '水',
  Lightning: '雷',
  Psychic: '超',
  Fighting: '鬥',
  Darkness: '惡',
  Metal: '鋼',
  Fairy: '妖',
  Dragon: '龍',
  Colorless: '無'
};

/** CSS color per energy (for chips/badges; not official game art) */
export const ENERGY_COLOR: Record<EnergyType, string> = {
  Grass: '#6bb34c',
  Fire: '#e05a2b',
  Water: '#4a92d4',
  Lightning: '#e8c423',
  Psychic: '#9b4ea0',
  Fighting: '#a65a2a',
  Darkness: '#3f3a5c',
  Metal: '#8d8f94',
  Fairy: '#e38bbd',
  Dragon: '#c8a332',
  Colorless: '#c8c2b5'
};

/**
 * ⭐v6.512 屬性色塊上的字色：依對比自動挑白字或深字（站長：「暗色系在卡圖放大又看不到字了，請你研究好配色」）。
 *   雷、無、草、龍、妖、水、鋼、火這些較淺的屬性色上，白字對比只有 1.7～3.7（看不清楚）⇒ 改深字；
 *   超、鬥、惡這些較深的維持白字。兩種字色挑對比高的那一個（WCAG 相對亮度公式），色塊本身的顏色不變。
 */
export const ENERGY_TEXT_DARK = '#1a1a1a';
function _relLum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
/** 給一個 #rrggbb 底色，回傳對比較高的字色（白字或 ENERGY_TEXT_DARK） */
export function readableTextOn(bgHex: string): string {
  const L = _relLum(bgHex);
  const withWhite = 1.05 / (L + 0.05), withDark = (L + 0.05) / (_relLum(ENERGY_TEXT_DARK) + 0.05);
  return withWhite >= withDark ? '#ffffff' : ENERGY_TEXT_DARK;
}
export const ENERGY_TEXT_COLOR: Record<EnergyType, string> = Object.fromEntries(
  (Object.keys(ENERGY_COLOR) as EnergyType[]).map((t) => [t, readableTextOn(ENERGY_COLOR[t])])
) as Record<EnergyType, string>;
