// ⭐v6.582 棄牌區分類頁籤（站長 2026-10-17：參考 PTCGCodex 的棄牌區分類）
//
// 棄牌區檢視視窗（桌機與手機直式共用同一份，v6.451）上方多一排頁籤：
//   全部／寶可夢／物品／支援者／道具／競技場／能量，每個頁籤標出張數。
// 分類只看卡片本身的 supertype／subtype（公開資訊），不碰盤面、不碰引擎。
//
// 唯一判準（Rule 38）：畫面的頁籤、張數、篩選全部只呼叫 discardCategory 這一支。
//   ・寶可夢：supertype === 'Pokemon'
//   ・道具：Trainer 且 subtype === 'PokemonTool'（卡庫的道具只有這個值，test-v6211）
//   ・支援者：Trainer 且 subtype === 'Supporter'
//   ・競技場：Trainer 且 subtype === 'Stadium'
//   ・物品：其餘 Trainer（含化石等物品卡）
//   ・能量：supertype === 'Energy'
//   ・查不到卡（卡庫還沒載入）⇒ 'other'：只出現在「全部」，不會被誤歸到任何一類

export type DiscardCategory = 'pokemon' | 'item' | 'supporter' | 'tool' | 'stadium' | 'energy' | 'other';
export type DiscardTab = 'all' | Exclude<DiscardCategory, 'other'>;

type CardLike = { supertype?: string; subtype?: string } | null | undefined;

/** 頁籤順序與標籤（畫面照這個順序畫） */
export const DISCARD_TABS: ReadonlyArray<{ key: DiscardTab; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: '' },
  { key: 'pokemon', label: '寶可夢', icon: '🐾' },
  { key: 'item', label: '物品', icon: '🧪' },
  { key: 'supporter', label: '支援者', icon: '🧑' },
  { key: 'tool', label: '道具', icon: '🔧' },
  { key: 'stadium', label: '競技場', icon: '🏟️' },
  { key: 'energy', label: '能量', icon: '⚡' },
];

/** 一張卡屬於哪一類（唯一判準） */
export function discardCategory(c: CardLike): DiscardCategory {
  if (!c) return 'other';
  if (c.supertype === 'Pokemon') return 'pokemon';
  if (c.supertype === 'Energy') return 'energy';
  if (c.supertype === 'Trainer') {
    if (c.subtype === 'PokemonTool') return 'tool';
    if (c.subtype === 'Supporter') return 'supporter';
    if (c.subtype === 'Stadium') return 'stadium';
    return 'item';
  }
  return 'other';
}

/** 這張卡在這個頁籤底下要不要顯示 */
export function discardTabMatches(tab: DiscardTab, c: CardLike): boolean {
  return tab === 'all' || discardCategory(c) === tab;
}

/** 每個頁籤的張數（以「張」計，不是合併後的格數；全部＝棄牌區總張數） */
export function discardTabCounts(cardIds: readonly string[], getCard: (id: string) => CardLike): Record<DiscardTab, number> {
  const out: Record<DiscardTab, number> = { all: 0, pokemon: 0, item: 0, supporter: 0, tool: 0, stadium: 0, energy: 0 };
  for (const id of cardIds) {
    out.all++;
    const k = discardCategory(getCard(id));
    if (k !== 'other') out[k]++;
  }
  return out;
}
