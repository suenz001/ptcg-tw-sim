// >>> v6636-printed-cost-filter
// 只讀卡面費用；不計算對戰中的減費、供能或可否出招。
import type { Card } from './types';

export type CostKind = 'retreat' | 'attack';
export type CostSelections = { retreat: ReadonlySet<number>; attack: ReadonlySet<number> };

function retreatCount(card: Card): number | null {
  if (card.supertype !== 'Pokemon') return null;
  // 爬蟲對零撤退省略欄位；空陣列也接受。其他錯誤形狀不當成零。
  if (card.retreatCost === undefined) return 0;
  return Array.isArray(card.retreatCost) ? card.retreatCost.length : null;
}

/** 同組取聯集、不同組取交集；任一招式符合即可。 */
export function matchesPrintedCosts(card: Card, retreat: ReadonlySet<number>, attack: ReadonlySet<number>): boolean {
  if (retreat.size === 0 && attack.size === 0) return true;
  if (card.supertype !== 'Pokemon') return false;
  if (retreat.size > 0) {
    const count = retreatCount(card);
    if (count === null || !retreat.has(count)) return false;
  }
  return attack.size === 0 || !!card.attacks?.some(a => Array.isArray(a.cost) && attack.has(a.cost.length));
}

/** 基本選項固定保留，卡池出現更高費用時自然擴充；只在卡池改變時計算。 */
export function printedCostOptions(cards: readonly Card[], kind: CostKind): number[] {
  let max = kind === 'retreat' ? 4 : 5;
  for (const card of cards) {
    if (card.supertype !== 'Pokemon') continue;
    if (kind === 'retreat') max = Math.max(max, retreatCount(card) ?? 0);
    else for (const a of card.attacks ?? []) if (Array.isArray(a.cost)) max = Math.max(max, a.cost.length);
  }
  return Array.from({ length: max + 1 }, (_, n) => n);
}

export function togglePrintedCost(selected: ReadonlySet<number>, value: number): Set<number> {
  const next = new Set(selected);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

export function readCostFilterSearch(search: string, retreatOptions: readonly number[], attackOptions: readonly number[]): CostSelections {
  const sp = new URLSearchParams(search);
  const read = (key: string, options: readonly number[]) => {
    const allowed = new Set(options.map(String));
    return new Set((sp.get(key) ?? '').split(',').filter(s => allowed.has(s)).map(Number));
  };
  return { retreat: read('retreat', retreatOptions), attack: read('attack', attackOptions) };
}

/** 與既有搜尋網址串接，保留卡包、頁碼、開啟卡片與其他參數；空選擇移除本組參數。 */
export function writeCostFilterSearch(search: string, selected: CostSelections): string {
  const sp = new URLSearchParams(search);
  for (const key of ['retreat', 'attack'] as const) {
    sp.delete(key);
    if (selected[key].size) sp.set(key, [...selected[key]].sort((a, b) => a - b).join(','));
  }
  const out = sp.toString();
  return out ? '?' + out : '';
}
// <<< v6636-printed-cost-filter
