// ⭐v6.594 牌組公布欄明細：縮圖／文字兩種牌表（站長 2026-10-23 核准第一期）
//
// 這支只放「純邏輯」（分組、排序、前後卡、顯示方式的記憶），畫面在 src/routes/deck-posts/+page.svelte。
//   ・一個牌組條目＝一格（精確卡號，同名不同印刷不合併；不依張數展開成 60 張）。
//   ・順序：寶可夢 → 物品 → 寶可夢道具 → 支援者 → 競技場 → 能量，同類依卡名 —— 判準只有一份（$lib/decks/deck-order.ts，
//     與牌組編輯器、匯出圖片相同）。分組標題沿用寶可夢／訓練家／能量／未知卡片，並顯示每組總張數。
//   ・⭐v6.597 站長裁定：訓練家底下再分小標題「物品／寶可夢道具／支援者／競技場」（各自張數；沒有的類別不顯示）。
//     items 仍是整組攤平的順序（大圖前後卡照這個順序走），subs 只是同一批卡依類別切開來顯示。
//   ・查不到的卡（已輪替、尚未收錄）放最後「未知卡片」，維持原本條目順序；沒有圖片網址 ⇒ 不能開大圖。
//   ・大圖的上一張／下一張只在「這副牌、目前顯示順序、有圖片」的卡之間移動（不跳到同名的其他版本）。

import type { Card } from '$lib/cards/types';
import { compareDeckCards, deckCardRank, DECK_RANK } from '$lib/decks/deck-order';

export type DetailGroupName = '寶可夢' | '訓練家' | '能量' | '未知卡片';
export interface DetailItem {
  /** 條目在投稿裡的位置＋卡號（each 的 key；同一張卡號出現兩次也不會撞） */
  key: string;
  cardId: string;
  name: string;
  /** 卡包代號＋卡號（次要資訊） */
  sub: string;
  count: number;
  /** 官方卡圖網址；空字串＝沒有圖（未知卡片或資料缺圖）⇒ 只顯示文字、不能開大圖 */
  imageUrl: string;
}
export type DetailSubName = '物品' | '寶可夢道具' | '支援者' | '競技場';
export interface DetailSub { name: DetailSubName; total: number; items: DetailItem[] }
export interface DetailGroup { group: DetailGroupName; total: number; items: DetailItem[]; subs?: DetailSub[] }

const GROUP_ORDER: DetailGroupName[] = ['寶可夢', '訓練家', '能量', '未知卡片'];
function groupOfRank(rank: number): DetailGroupName {
  return rank === DECK_RANK.pokemon ? '寶可夢' : rank === DECK_RANK.energy ? '能量' : '訓練家';
}
const SUB_OF_RANK: Record<number, DetailSubName> = {
  [DECK_RANK.item]: '物品', [DECK_RANK.tool]: '寶可夢道具', [DECK_RANK.supporter]: '支援者', [DECK_RANK.stadium]: '競技場',
};

/**
 * 投稿的 entries ＋ 查卡函式 → 分組後的牌表。
 * lookup 由頁面提供（含 v6.193 舊卡號對照：先查原卡號、查不到再查對照後的保留版）。
 */
export function buildDetailGroups(
  entries: ReadonlyArray<{ cardId: string; count: number }>,
  lookup: (cardId: string) => Card | undefined,
): DetailGroup[] {
  const known: { card: Card; item: DetailItem }[] = [];
  const unknown: DetailItem[] = [];
  entries.forEach((e, i) => {
    const c = lookup(e.cardId);
    const key = i + '_' + e.cardId;
    if (!c) {
      unknown.push({ key, cardId: e.cardId, name: '（本站沒有這張卡 · id ' + e.cardId + '）', sub: '', count: e.count, imageUrl: '' });
      return;
    }
    known.push({ card: c, item: { key, cardId: e.cardId, name: c.name, sub: [c.setCode, c.collectorNumber].filter(Boolean).join(' '),
      count: e.count, imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : '' } });
  });
  // Array.prototype.sort 是穩定排序 ⇒ 同類同名（不同印刷）維持投稿裡的先後
  known.sort((a, b) => compareDeckCards(a.card, b.card));
  const groups = new Map<DetailGroupName, DetailItem[]>();
  const subs = new Map<DetailSubName, DetailItem[]>();   // 訓練家的小類別（已排序 ⇒ 依序出現就是 物品 → 寶可夢道具 → 支援者 → 競技場）
  for (const k of known) {
    const rank = deckCardRank(k.card);
    const g = groupOfRank(rank);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(k.item);
    const sub = SUB_OF_RANK[rank];
    if (g === '訓練家' && sub) {
      if (!subs.has(sub)) subs.set(sub, []);
      subs.get(sub)!.push(k.item);
    }
  }
  if (unknown.length) groups.set('未知卡片', unknown);
  const sum = (items: DetailItem[]) => items.reduce((n, x) => n + x.count, 0);
  return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => {
    const items = groups.get(g)!;
    const out: DetailGroup = { group: g, total: sum(items), items };
    if (g === '訓練家') out.subs = [...subs.entries()].map(([name, its]) => ({ name, total: sum(its), items: its }));
    return out;
  });
}

/** 可以開大圖的卡（有圖片網址），依畫面順序攤平 —— 上一張／下一張就在這裡面移動 */
export function zoomableItems(groups: ReadonlyArray<DetailGroup>): DetailItem[] {
  const out: DetailItem[] = [];
  for (const g of groups) for (const it of g.items) if (it.imageUrl) out.push(it);
  return out;
}

/** 從 key 往前（-1）或往後（+1）一格；到頭／到尾或找不到 ⇒ null（不繞回） */
export function stepZoomKey(list: ReadonlyArray<DetailItem>, key: string | null, dir: -1 | 1): string | null {
  if (!key) return null;
  const i = list.findIndex((x) => x.key === key);
  if (i < 0) return null;
  const j = i + dir;
  return j >= 0 && j < list.length ? list[j].key : null;
}

/** 顯示方式的記憶（每台瀏覽器各自記；讀寫失敗 ⇒ 預設縮圖、不影響瀏覽） */
export type DetailView = 'thumb' | 'text';
export const DETAIL_VIEW_KEY = 'ptcg_dp_detail_view_v1';
export function loadDetailView(): DetailView {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(DETAIL_VIEW_KEY) === 'text') return 'text';
  } catch { /* 無痕、被封鎖 ⇒ 預設 */ }
  return 'thumb';
}
export function saveDetailView(v: DetailView): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(DETAIL_VIEW_KEY, v); } catch { /* 存不進去就算了 */ }
}
