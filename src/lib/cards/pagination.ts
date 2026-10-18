// v6.586：「全部卡牌」的分頁範圍與網址處理；只切顯示範圍，不改搜尋或卡牌資料。
export function readCardsPage(search: string): number {
  const raw = new URLSearchParams(search).get('page') ?? '';
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : 1;
}

export function cardsPageRange(total: number, requested: number, size: number) {
  const count = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const limit = Number.isFinite(size) ? Math.max(1, Math.trunc(size)) : 1;
  const pages = Math.max(1, Math.ceil(count / limit));
  const page = Math.min(pages, Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1);
  const start = (page - 1) * limit;
  return { page, pages, start, end: Math.min(count, start + limit), total: count };
}

export function writeCardsPageSearch(search: string, page: number): string {
  const params = new URLSearchParams(search);
  if (Number.isSafeInteger(page) && page > 1) params.set('page', String(page));
  else params.delete('page');
  const out = params.toString();
  return out ? '?' + out : '';
}
