import { error } from '@sveltejs/kit';
import { getCardMap, getStdCardIds } from '$lib/server/cardIndex';
import type { EntryGenerator, PageServerLoad } from './$types';

// SEO B-2 Phase 1：預渲染所有標準 H/I/J 卡。資料於建置期用 $lib/server/cardIndex 讀檔（Node fs），
//   不經 fetch、不進 client bundle。client-nav 走預渲染好的 __data.json。
export const entries: EntryGenerator = () => getStdCardIds().map((id) => ({ id }));

export const load: PageServerLoad = ({ params }) => {
  const card = getCardMap().get(params.id);
  if (!card) throw error(404, `找不到卡牌 #${params.id}`);
  return { card };
};
