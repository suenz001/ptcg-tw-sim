import type { Card } from './types';
import type { CardInstance } from '$lib/game/types';

// 只顯示卡片身分與張數；不推算提供的屬性、單位或效果是否生效。
export const SPECIAL_ENERGY_NAMES: Readonly<Record<string, string>> = {
  '伏特【雷】能量': '伏特', '古舊能量': '古舊', '回力鏢能量': '回力鏢',
  '增強【草】能量': '增強', '富裕能量': '富裕', '感應【超】能量': '感應',
  '扣殺能量': '扣殺', '新衝天能量': '新衝天', '暗影【惡】能量': '暗影',
  '泡沫【水】能量': '泡沫', '火箭隊能量': '火箭隊', '燃料【火】能量': '燃料',
  '燃火能量': '燃火', '硬岩【鬥】能量': '硬岩', '磁鐵【鋼】能量': '磁鐵',
  '稜鏡能量': '稜鏡', '薄霧能量': '薄霧',
};

export interface AttachedEnergyGroup {
  key: string;
  cardId: string;
  name: string;
  shortName: string;
  special: boolean;
  count: number;
}

export function attachedEnergyGroups(inst: CardInstance, pool: ReadonlyMap<string, Card>): AttachedEnergyGroup[] {
  const groups = new Map<string, AttachedEnergyGroup>();
  const seen = new Set<string>();
  for (const energy of inst.energyAttached ?? []) {
    if (seen.has(energy.iid)) continue;
    seen.add(energy.iid);
    const card = pool.get(energy.cardId);
    const name = card?.name ?? '未知能量';
    const special = card?.subtype !== 'Basic';
    // 同名異圖合併；未知卡不猜名稱，也不把不同未知卡混成同一種。
    const key = `${special ? 'special' : 'basic'}:${card?.name ?? energy.cardId}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { key, cardId: energy.cardId, name, special,
      shortName: SPECIAL_ENERGY_NAMES[name] ?? name.replace(/能量$/, ''), count: 1 });
  }
  return [...groups.values()];
}

export function basicEnergyOnly(inst: CardInstance, pool: ReadonlyMap<string, Card>): CardInstance {
  return { ...inst, energyAttached: inst.energyAttached.filter(e => pool.get(e.cardId)?.subtype === 'Basic') };
}
