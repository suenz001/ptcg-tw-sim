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
