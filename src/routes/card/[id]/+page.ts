import { error } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { Card } from '$lib/cards/types';
import type { EntryGenerator, PageLoad } from './$types';

// SEO B-2 Phase 0 試水：只預渲染少數幾張卡，驗證 SSR 隔離 + 部署 + 索引可行性。
//   {id,set} 直接帶版本碼，load 只 fetch 該版本 JSON（Phase 1 全量時改為 build 期 id→set 索引）。
const PHASE0_CARDS = [
  { id: '18360', set: 'MJ' },   // 凱羅斯（基礎寶可夢，含招式）
  { id: '18362', set: 'MJ' },   // 新葉喵ex
  { id: '18376', set: 'MJ' },   // 傷藥（訓練家／道具）
  { id: '18382', set: 'MJ' },   // 基本【草】能量
  { id: '9771', set: 'SV5K' },  // 毒薔薇（含特性）
];

export const entries: EntryGenerator = () => PHASE0_CARDS.map((c) => ({ id: c.id }));

export const load: PageLoad = async ({ params, fetch }) => {
  const entry = PHASE0_CARDS.find((c) => c.id === params.id);
  if (!entry) throw error(404, `卡牌 #${params.id} 尚未開放（Phase 0 試水）`);
  const res = await fetch(`${base}/cards/${entry.set}.json`);
  if (!res.ok) throw error(404, '找不到卡牌版本資料');
  const cards: Card[] = await res.json();
  const card = cards.find((c) => String(c.id) === params.id);
  if (!card) throw error(404, `找不到卡牌 #${params.id}`);
  return { card };
};
